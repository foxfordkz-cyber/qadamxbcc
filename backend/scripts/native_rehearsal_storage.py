"""Isolated PostgreSQL/Redis on local Linux or WSL; never touches existing clusters."""

import os
import subprocess
from pathlib import Path
from typing import BinaryIO


class NativeStorage:
    def __init__(self, pgport: int, redisport: int) -> None:
        self.prefix = ["wsl.exe", "-d", "Ubuntu", "--exec"] if os.name == "nt" else []
        self.pgport, self.redisport = pgport, redisport
        self.folder = self.call("mktemp", "-d", "/tmp/saq-rehearsal.XXXXXX").decode().strip()
        self.bin = "/usr/lib/postgresql/16/bin/"
        self.pg_started = self.redis_started = False

    def call(self, *args: str, stdin: BinaryIO | None = None, data: bytes | None = None) -> bytes:
        result = subprocess.run(
            [*self.prefix, *args],
            stdin=stdin,
            input=data,
            capture_output=True,
            check=False,
            timeout=180,
        )
        if result.returncode:
            # Do not include command arguments, passwords, or database rows in exceptions.
            raise RuntimeError(
                f"Native storage command {Path(args[0]).name} failed ({result.returncode})"
            )
        return result.stdout

    def start(self, password: str) -> None:
        password_file = self.folder + "/bootstrap-password"
        # WSL stdin can be a root-owned descriptor that initdb cannot reopen.
        self.call(
            "sh",
            "-c",
            'umask 077; cat > "$1"',
            "bootstrap",
            password_file,
            data=(password + "\n").encode(),
        )
        try:
            self.call(
                self.bin + "initdb",
                "-D",
                self.folder + "/pg",
                "-U",
                "postgres",
                "--auth-local=trust",
                "--auth-host=scram-sha-256",
                "--pwfile=" + password_file,
            )
        finally:
            self.call("unlink", password_file)
        self.call(
            self.bin + "pg_ctl",
            "-D",
            self.folder + "/pg",
            "-l",
            self.folder + "/pg.log",
            "-o",
            f"-h 127.0.0.1 -p {self.pgport} -k {self.folder}",
            "-w",
            "start",
        )
        self.pg_started = True
        self.pg("createdb", "-U", "postgres", "practice")
        self.call(
            "redis-server",
            "--bind",
            "127.0.0.1",
            "--port",
            str(self.redisport),
            "--dir",
            self.folder,
            "--pidfile",
            self.folder + "/redis.pid",
            "--logfile",
            self.folder + "/redis.log",
            "--daemonize",
            "yes",
            "--appendonly",
            "yes",
        )
        self.redis_started = True

    def pg(self, command: str, *args: str, stdin: BinaryIO | None = None) -> bytes:
        return self.call(
            self.bin + command, "-h", self.folder, "-p", str(self.pgport), *args, stdin=stdin
        )

    def backup(self, destination: Path) -> None:
        destination.write_bytes(self.pg("pg_dump", "-U", "postgres", "-Fc", "practice"))

    def close(self) -> None:
        try:
            if self.redis_started:
                self.call("redis-cli", "-p", str(self.redisport), "shutdown", "save")
        finally:
            if self.pg_started:
                self.call(
                    self.bin + "pg_ctl", "-D", self.folder + "/pg", "-m", "fast", "-w", "stop"
                )
        # Leave private files for diagnosis; never recursively remove a calculated cluster path.
        print("Native rehearsal services stopped; private artifacts retained in", self.folder)
