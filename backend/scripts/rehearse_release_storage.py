"""Run migrations, compare a full PostgreSQL restore, then restart a local mobile API twice."""
import json
import os
import secrets
import socket
import subprocess
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

from app.mobile_gateway.passwords import encode
from scripts import verify_persistent_release as api


def run(*args, **options):
    return subprocess.check_output(args, **options)


def port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    suffix = secrets.token_hex(5)
    pg, kv = "qadam-pg-"+suffix, "qadam-kv-"+suffix
    password = secrets.token_hex(20)
    pgport, kvport, http = port(), port(), port()
    api.ORIGIN = f"http://127.0.0.1:{http}"
    env = {**os.environ, "BCC_DATABASE_URL": f"postgresql+asyncpg://postgres:{password}@127.0.0.1:{pgport}/practice",
           "BCC_REDIS_URL": f"redis://127.0.0.1:{kvport}/0", "BCC_ENVIRONMENT": "demo",
           "BCC_BOOTSTRAP_DEMO": "true", "BCC_MOBILE_ENABLED": "true", "BCC_MOBILE_AUTH_MODE":"password",
           "BCC_MOBILE_EPHEMERAL_STORE":"false", "BCC_INTEGRATIONS_ENABLED":"true",
           "BCC_INTEGRATIONS_ENVIRONMENT":"test", "BCC_INTEGRATIONS_TELEGRAM_MODE":"fake",
           "BCC_INTEGRATIONS_SIGNING_KEY":secrets.token_hex(32), "BCC_RENDER_TELEGRAM_TEST":"false"}
    users = {"client":"client_demo","admin":"admin_demo","platform":"platform_demo"}
    credentials = {k:secrets.token_urlsafe(24) for k in users}
    for k,pwd in credentials.items():
        env["BCC_MOBILE_"+k.upper()+"_HASH"]=encode(pwd)
    created=[]
    process=None
    with TemporaryDirectory(prefix="qadam-release-") as tmp:
        def start():
            return subprocess.Popen([sys.executable,"-m","uvicorn","app.mobile_gateway.app:factory",
                "--factory","--host","127.0.0.1","--port",str(http)],env=env,stdout=subprocess.DEVNULL)
        def stop(p):
            p.terminate()
            p.wait(timeout=30)
        try:
            for name, args in [(pg,["-p",f"127.0.0.1:{pgport}:5432","-e","POSTGRES_PASSWORD="+password,
                                      "-e","POSTGRES_DB=practice","postgres:16-alpine"]),
                               (kv,["-p",f"127.0.0.1:{kvport}:6379","redis:7-alpine"])]:
                run("docker","run","--rm","-d","--name",name,*args)
                created.append(name)
            for _ in range(60):
                if subprocess.run(["docker","exec",pg,"pg_isready","-U","postgres"],capture_output=True).returncode==0:
                    break
                time.sleep(1)
            run(sys.executable,"-m","alembic","upgrade","head",env=env)
            run(sys.executable,"-m","scripts.bootstrap_demo",env=env)
            process=start()
            api.ready()
            sessions={k:api.request("/mobile/v1/auth/login",body={"login":u,"password":credentials[k]})["token"] for k,u in users.items()}
            token=sessions["client"]
            paths=["/mobile/v1/account","/mobile/v1/wallet/operations"]
            ids=[]
            for phone,amt,active,expected in [("+77010000002","25000",False,"approved"),
                                              ("+77010000003","900000",True,"cooling_off"),
                                              ("+77010000004","250000",False,"blocked")]:
                attempt=api.transfer(token,phone,amt,active_call=active)
                result=attempt["result"]
                assert result["status"]==expected
                tx=result["transaction_id"]
                assert api.request("/mobile/v1/api/transfers/"+tx,sessions["admin"])["status"]==expected
                packet=api.request("/mobile/v1/protection/"+tx+"/packet",token)
                assert packet["transaction_id"]==tx and packet["status"]==expected
                if directory:=os.environ.get("QADAM_SYNTHETIC_EVIDENCE_DIR"):
                    dest=Path(directory)
                    dest.mkdir(parents=True,exist_ok=True)
                    (dest/(expected+".json")).write_text(json.dumps(packet,ensure_ascii=False),encoding="utf8")
                if not ids:
                    first=attempt
                ids.append(tx)
            api.expect_status("/mobile/v1/api/soc/feed",403,token)
            before=[api.request(path,token) for path in paths]
            for _ in range(2):
                stop(process)
                process=start()
                api.ready()
                assert [api.request(path,token) for path in paths]==before
                assert api.request("/mobile/v1/api/transfers/evaluate",token,first["body"])["transaction_id"]==ids[0]
                assert [api.request(path,token) for path in paths]==before
                for key,role in [("client","client"),("admin","admin"),("platform","platform_admin")]:
                    assert api.request("/mobile/v1/session",sessions[key])["role"]==role
            stop(process)
            process=None
            run("docker","exec",pg,"pg_dump","-U","postgres","-Fc","-f","/tmp/practice.dump","practice")
            backup=Path(tmp)/"practice.dump"
            run("docker","cp",pg+":/tmp/practice.dump",str(backup))
            run("docker","exec",pg,"createdb","-U","postgres","restorecheck")
            with backup.open("rb") as f:
                run("docker","exec","-i",pg,"pg_restore","--exit-on-error","-U","postgres","-d","restorecheck",stdin=f)
            def rows(database):
                dump=run("docker","exec",pg,"pg_dump","-U","postgres","--inserts","--no-owner",database)
                return sorted(line for line in dump.splitlines() if line and not line.startswith((b"--",b"\\restrict",b"\\unrestrict")))
            assert rows("practice")==rows("restorecheck")
            print("PASS: three roles, three decisions, two API restarts, same tokens and ledger, idempotent replay, full PostgreSQL restore")
        finally:
            if process is not None and process.poll() is None:
                stop(process)
            for name in reversed(created):
                subprocess.run(["docker","stop",name],stdout=subprocess.DEVNULL)


if __name__=="__main__":
    main()

