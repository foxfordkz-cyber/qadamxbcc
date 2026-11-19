"""Same-host OS lock; kernel releases it after process death. No token is stored."""

import hashlib
import os
import stat
import sys
import tempfile
from pathlib import Path
from typing import BinaryIO


class PollingLock:
    def __init__(self, bot_id: int, directory: Path | None = None) -> None:
        folder = directory or Path(tempfile.gettempdir()) / "bcc-shield-polling"
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = folder / (hashlib.sha256(str(bot_id).encode()).hexdigest() + ".lock")
        self.handle: BinaryIO | None = None

    def acquire(self) -> None:
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(self.path, flags, 0o600)
        handle = os.fdopen(fd, "r+b")
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise OSError("invalid lock file")
            if os.fstat(fd).st_size == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            raise RuntimeError("polling already running or local lock unavailable") from None
        self.handle = handle

    def close(self) -> None:
        if self.handle:
            # Closing the descriptor releases either OS lock. Do not unlink: another
            # process may already hold the inode, and unlink would permit a second lock.
            self.handle.close()
            self.handle = None
