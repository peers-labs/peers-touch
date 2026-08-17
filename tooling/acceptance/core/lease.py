from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import IO, Sequence

from .provisioning import utc_now


class ProfileLeaseUnavailable(RuntimeError):
    def __init__(self, resource: str, owner: str) -> None:
        self.resource = resource
        self.owner = owner
        detail = f" held by {owner}" if owner else ""
        super().__init__(f"profile lease {resource!r} is already held{detail}")


def _safe_resource(resource: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", resource.strip()).strip("-")
    if not safe:
        raise ValueError("profile lease resource is required")
    return safe


def lease_path(resource: str) -> Path:
    root = Path(
        os.environ.get(
            "PT_PROFILE_LEASE_DIR",
            "/tmp/peers-touch-profile-leases",
        )
    )
    return root / f"{_safe_resource(resource)}.lock"


class ProfileLease:
    def __init__(self, resource: str, owner: str) -> None:
        self.resource = _safe_resource(resource)
        self.owner = owner.strip() or "unknown"
        self.path = lease_path(self.resource)
        self._handle: IO[str] | None = None

    def acquire(self) -> None:
        if self._handle is not None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            handle.seek(0)
            try:
                metadata = json.load(handle)
            except (json.JSONDecodeError, OSError):
                metadata = {}
            handle.close()
            raise ProfileLeaseUnavailable(
                self.resource,
                str(metadata.get("owner") or ""),
            ) from error

        handle.seek(0)
        handle.truncate()
        json.dump(
            {
                "resource": self.resource,
                "owner": self.owner,
                "pid": os.getpid(),
                "acquiredAt": utc_now(),
            },
            handle,
            sort_keys=True,
        )
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
        self._handle = handle

    def release(self) -> None:
        handle = self._handle
        if handle is None:
            return
        self._handle = None
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()

    def __enter__(self) -> ProfileLease:
        self.acquire()
        return self

    def __exit__(self, *_: object) -> None:
        self.release()

    def __del__(self) -> None:
        # Explicit cleanup reports failures; interpreter teardown is best-effort.
        try:
            self.release()
        except Exception:
            pass


def run_with_lease(
    resource: str,
    owner: str,
    command: Sequence[str],
) -> int:
    if not command:
        raise ValueError("lease command is required")
    with ProfileLease(resource, owner):
        completed = subprocess.run(command, check=False)
    return completed.returncode


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--resource", required=True)
    parser.add_argument("--owner", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    try:
        return run_with_lease(args.resource, args.owner, command)
    except ProfileLeaseUnavailable as error:
        sys.stderr.write(f"BLOCKED: {error}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
