"""Run migrations, compare a full PostgreSQL restore, then restart a local mobile API twice."""

import json
import os
import secrets
import socket
import subprocess
import sys
import time
from collections.abc import Mapping
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import BinaryIO

from app.mobile_gateway.passwords import encode
from scripts import verify_persistent_release as api


def run(*args: str, env: Mapping[str, str] | None = None, stdin: BinaryIO | None = None) -> bytes:
    return subprocess.check_output(args, env=env, stdin=stdin)


def port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def main() -> None:
    suffix = secrets.token_hex(5)
    pg, kv = "qadam-pg-" + suffix, "qadam-kv-" + suffix
    password = secrets.token_hex(20)
    pgport, kvport, http = port(), port(), port()
    api.ORIGIN = f"http://127.0.0.1:{http}"
    env = {
        **os.environ,
        "BCC_DATABASE_URL": f"postgresql+asyncpg://postgres:{password}@127.0.0.1:{pgport}/practice",
        "BCC_REDIS_URL": f"redis://127.0.0.1:{kvport}/0?socket_timeout=120&socket_connect_timeout=30",
        "BCC_ENVIRONMENT": "demo",
        "BCC_BOOTSTRAP_DEMO": "true",
        "BCC_MOBILE_ENABLED": "true",
        "BCC_MOBILE_AUTH_MODE": "password",
        "BCC_MOBILE_EPHEMERAL_STORE": "false",
        "BCC_INTEGRATIONS_ENABLED": "true",
        "BCC_INTEGRATIONS_ENVIRONMENT": "test",
        "BCC_INTEGRATIONS_TELEGRAM_MODE": "fake",
        "BCC_INTEGRATIONS_SIGNING_KEY": secrets.token_hex(32),
        "BCC_RENDER_TELEGRAM_TEST": "false",
    }
    users = {"client": "client_demo", "admin": "admin_demo", "platform": "platform_demo"}
    credentials = {k: secrets.token_urlsafe(24) for k in users}
    for k, pwd in credentials.items():
        env["BCC_MOBILE_" + k.upper() + "_HASH"] = encode(pwd)
    created = []
    process = None
    with TemporaryDirectory(prefix="qadam-release-") as tmp:

        def start() -> subprocess.Popen[bytes]:
            return subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app.mobile_gateway.app:factory",
                    "--factory",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(http),
                ],
                env=env,
                stdout=subprocess.DEVNULL,
            )

        def stop(p: subprocess.Popen[bytes]) -> None:
            p.terminate()
            p.wait(timeout=30)

        try:
            for name, args in [
                (
                    pg,
                    [
                        "-p",
                        f"127.0.0.1:{pgport}:5432",
                        "-e",
                        "POSTGRES_PASSWORD=" + password,
                        "-e",
                        "POSTGRES_DB=practice",
                        "postgres:16-alpine",
                    ],
                ),
                (kv, ["-p", f"127.0.0.1:{kvport}:6379", "redis:7-alpine"]),
            ]:
                run("docker", "run", "--rm", "-d", "--name", name, *args)
                created.append(name)
            for _ in range(60):
                if (
                    subprocess.run(
                        ["docker", "exec", pg, "pg_isready", "-U", "postgres"], capture_output=True
                    ).returncode
                    == 0
                ):
                    break
                time.sleep(1)
            run(sys.executable, "-m", "alembic", "upgrade", "head", env=env)
            # Exercise the three canonical presets with a bounded isolated background cohort.
            run(
                sys.executable,
                "-c",
                """import asyncio
from redis.asyncio import Redis
from app.core.config import get_settings
from app.db.session import build_engine, build_session_factory
from scripts.seed_bcc import seed
async def prepare():
    settings=get_settings()
    db=build_engine(settings.database_url)
    cache=Redis.from_url(settings.redis_url)
    try:
        await seed(build_session_factory(db), cache,
                   n_background_accounts=48, n_background_transactions=60)
    finally:
        await cache.aclose()
        await db.dispose()
asyncio.run(prepare())""",
                env=env,
            )
            run(sys.executable, "-m", "scripts.bootstrap_demo", env=env)
            process = start()
            api.ready()
            sessions = {
                k: api.request(
                    "/mobile/v1/auth/login", body={"login": u, "password": credentials[k]}
                )["token"]
                for k, u in users.items()
            }
            token = sessions["client"]
            paths = ["/mobile/v1/account", "/mobile/v1/wallet/operations"]
            ids: list[str] = []
            for phone, amt, active, expected in [
                ("+77010000002", "25000", False, "approved"),
                ("+77010000003", "900000", True, "cooling_off"),
                ("+77010000004", "250000", False, "blocked"),
            ]:
                attempt = api.transfer(token, phone, amt, active_call=active)
                result = attempt["result"]
                assert result["status"] == expected
                tx = result["transaction_id"]
                assert (
                    api.request("/mobile/v1/api/transfers/" + tx, sessions["admin"])["status"]
                    == expected
                )
                packet = api.request("/mobile/v1/protection/" + tx + "/packet", token)
                assert packet["transaction_id"] == tx
                assert packet["status"] == expected
                if directory := os.environ.get("QADAM_SYNTHETIC_EVIDENCE_DIR"):
                    dest = Path(directory)
                    dest.mkdir(parents=True, exist_ok=True)
                    (dest / (expected + ".json")).write_text(
                        json.dumps(packet, ensure_ascii=False), encoding="utf8"
                    )
                if not ids:
                    first = attempt
                ids.append(tx)
            held_path = "/mobile/v1/protection/" + ids[1]
            api.request(held_path + "/end", token, {})
            api.request(held_path + "/answer", token, {"answer": "pressure"})
            cancelled = api.request(held_path + "/packet", token)
            assert cancelled["status"] == "cancelled"
            if directory:
                (Path(directory) / "cancelled.json").write_text(
                    json.dumps(cancelled, ensure_ascii=False), encoding="utf8"
                )
            api.expect_status("/mobile/v1/api/soc/feed", 403, token)
            before = [api.request(path, token) for path in paths]
            for _ in range(2):
                stop(process)
                process = start()
                api.ready()
                assert [api.request(path, token) for path in paths] == before
                assert (
                    api.request("/mobile/v1/api/transfers/evaluate", token, first["body"])[
                        "transaction_id"
                    ]
                    == ids[0]
                )
                assert [api.request(path, token) for path in paths] == before
                for key, role in [
                    ("client", "client"),
                    ("admin", "admin"),
                    ("platform", "platform_admin"),
                ]:
                    assert api.request("/mobile/v1/session", sessions[key])["role"] == role
            stop(process)
            process = None
            run(
                "docker",
                "exec",
                pg,
                "pg_dump",
                "-U",
                "postgres",
                "-Fc",
                "-f",
                "/tmp/practice.dump",
                "practice",
            )
            backup = Path(tmp) / "practice.dump"
            run("docker", "cp", pg + ":/tmp/practice.dump", str(backup))
            run("docker", "exec", pg, "createdb", "-U", "postgres", "restorecheck")
            with backup.open("rb") as f:
                run(
                    "docker",
                    "exec",
                    "-i",
                    pg,
                    "pg_restore",
                    "--exit-on-error",
                    "-U",
                    "postgres",
                    "-d",
                    "restorecheck",
                    stdin=f,
                )

            def query(database: str, sql: str) -> bytes:
                return run(
                    "docker",
                    "exec",
                    pg,
                    "psql",
                    "-U",
                    "postgres",
                    "-XAtq",
                    "-v",
                    "ON_ERROR_STOP=1",
                    "-d",
                    database,
                    "-c",
                    sql,
                )

            def catalogue(database: str) -> bytes:
                return query(
                    database,
                    """
                    SELECT table_name, column_name,
                           row_number() OVER (PARTITION BY table_name ORDER BY ordinal_position),
                           data_type, is_nullable,
                           column_default FROM information_schema.columns
                    WHERE table_schema='public' ORDER BY table_name, ordinal_position;
                    SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
                    FROM pg_constraint WHERE connamespace='public'::regnamespace
                    AND contype <> 'c'
                    ORDER BY conrelid::regclass::text, conname;
                    CREATE TEMP TABLE checks_to_compare(
                        relation text, name text, definition text, validated boolean
                    );
                    DO $block$ DECLARE item record; BEGIN
                      FOR item IN SELECT conrelid::regclass AS relation, conname, convalidated,
                            pg_get_constraintdef(oid) AS definition FROM pg_constraint
                            WHERE connamespace='public'::regnamespace AND contype='c'
                      LOOP
                        EXECUTE format('CREATE TEMP TABLE parsed_check (LIKE %s)', item.relation);
                        EXECUTE format('ALTER TABLE parsed_check ADD CONSTRAINT sample %s',
                                       item.definition);
                        INSERT INTO checks_to_compare
                            SELECT item.relation::text, item.conname, pg_get_constraintdef(oid),
                                   item.convalidated FROM pg_constraint
                            WHERE conrelid='pg_temp.parsed_check'::regclass AND conname='sample';
                        DROP TABLE pg_temp.parsed_check;
                      END LOOP;
                    END $block$;
                    SELECT * FROM checks_to_compare ORDER BY relation, name;
                    SELECT tablename, indexname, indexdef FROM pg_indexes
                    WHERE schemaname='public' ORDER BY tablename, indexname;
                    SELECT sequencename, increment_by, last_value FROM pg_sequences
                    WHERE schemaname='public' ORDER BY sequencename;
                """,
                )

            source_schema = catalogue("practice").splitlines()
            restored_schema = catalogue("restorecheck").splitlines()
            if source_schema != restored_schema:
                for line in sorted(set(source_schema).symmetric_difference(restored_schema))[:8]:
                    print("Changed schema entry:", line.split(b"|", 2)[:2], flush=True)
                raise AssertionError("schema or sequence mismatch")
            tables = (
                query(
                    "practice",
                    """
                SELECT quote_ident(tablename) FROM pg_tables
                WHERE schemaname='public' ORDER BY tablename
            """,
                )
                .decode()
                .splitlines()
            )
            # Compare canonical records. The order used by pg_dump in a script is not data.
            for table in tables:
                sql = (
                    "SELECT record FROM (SELECT to_jsonb(r)::text AS record "
                    f"FROM public.{table} r) t "
                    'ORDER BY record COLLATE "C"'
                )
                assert query("practice", sql) == query("restorecheck", sql), (
                    f"row mismatch in {table}"
                )
            print(
                "PASS: three roles, three decisions, two API restarts, same tokens and ledger, "
                "idempotent replay, full PostgreSQL restore"
            )
        finally:
            if process is not None and process.poll() is None:
                stop(process)
            for name in reversed(created):
                subprocess.run(["docker", "stop", name], stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
