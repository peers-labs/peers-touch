"""Private instance state and target-scoped, process-held mutation locks."""

import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def atomic_json(file, value):
    file = Path(file)
    descriptor, temporary = tempfile.mkstemp(dir=file.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(value, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)
        directory = os.open(file.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def private_directory(root):
    root = Path(root).expanduser().absolute()
    if root.is_symlink():
        raise RuntimeError("RD_ROOT_SYMLINK")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    metadata = root.stat()
    if metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
        raise RuntimeError("RD_ROOT_PERMISSIONS")
    return root.resolve()


@contextlib.contextmanager
def instance_lock(target, project):
    directory = private_directory(Path.home() / ".peers-touch" / "install-locks")
    key = hashlib.sha256(f"{target}\0{project}".encode()).hexdigest()
    file = directory / key
    descriptor = os.open(file, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        metadata = os.fstat(descriptor)
        if metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
            raise RuntimeError("RD_LOCK_PERMISSIONS")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("RD_INSTANCE_BUSY") from error
        yield
    finally:
        os.close(descriptor)
