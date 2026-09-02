from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import selectors
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import IO, Sequence

from .provisioning import utc_now


class ProfileLeaseUnavailable(RuntimeError):
    def __init__(self, resource: str, owner: str) -> None:
        self.resource = resource
        self.owner = owner
        detail = f" held by {owner}" if owner else ""
        super().__init__(f"profile lease {resource!r} is already held{detail}")


class RemoteGitSourceLeaseUnavailable(RuntimeError):
    def __init__(self, resource: str, reason: str) -> None:
        self.resource = resource
        self.reason = reason
        super().__init__(
            f"remote source lease {resource!r} is unavailable: {reason}"
        )


def normalize_lease_resource(resource: str) -> str:
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
    return root / f"{normalize_lease_resource(resource)}.lock"


class ProfileLease:
    def __init__(self, resource: str, owner: str) -> None:
        self.resource = normalize_lease_resource(resource)
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


def _remote_git_source_lease_script(
    deploy_path: str,
    owner: str,
) -> str:
    relative_path = Path(deploy_path.strip())
    if (
        not deploy_path.strip()
        or relative_path.is_absolute()
        or ".." in relative_path.parts
    ):
        raise ValueError(
            "remote deployment path must be relative to the remote home"
        )
    normalized_path = relative_path.as_posix()
    python_script = "\n".join(
        (
            "import fcntl",
            "import os",
            "import pathlib",
            "import signal",
            "import subprocess",
            "import sys",
            "",
            "repo = pathlib.Path.home() / sys.argv[1].strip('/')",
            "identity = subprocess.run(",
            "    ['git', '-C', str(repo), 'rev-parse', '--absolute-git-dir'],",
            "    capture_output=True,",
            "    text=True,",
            ")",
            "if identity.returncode != 0:",
            "    print('BLOCKED:not-a-git-worktree', flush=True)",
            "    raise SystemExit(72)",
            "git_dir = pathlib.Path(identity.stdout.strip())",
            "lease_path = git_dir / 'acceptance-profile.lock'",
            "index_path = git_dir / 'index.lock'",
            "lease = lease_path.open('a+', encoding='utf-8')",
            "try:",
            "    fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)",
            "except BlockingIOError:",
            "    lease.seek(0)",
            "    current_owner = lease.readline().strip()",
            "    print(f'BLOCKED:lease-held:{current_owner}', flush=True)",
            "    raise SystemExit(73)",
            "lease.seek(0)",
            "lease.truncate()",
            "lease.write(sys.argv[2] + '\\n')",
            "lease.flush()",
            "os.fsync(lease.fileno())",
            "try:",
            "    index_fd = os.open(",
            "        index_path,",
            "        os.O_CREAT | os.O_EXCL | os.O_WRONLY,",
            "        0o600,",
            "    )",
            "except FileExistsError:",
            "    print('BLOCKED:index-lock-exists', flush=True)",
            "    raise SystemExit(74)",
            "os.close(index_fd)",
            "",
            "def stop(*_args):",
            "    raise SystemExit(0)",
            "",
            "for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):",
            "    signal.signal(signum, stop)",
            "try:",
            "    print('READY', flush=True)",
            "    sys.stdin.readline()",
            "finally:",
            "    try:",
            "        index_path.unlink()",
            "    except FileNotFoundError:",
            "        pass",
        )
    )
    return (
        f"exec python3 -c {shlex.quote(python_script)} "
        f"{shlex.quote(normalized_path)} {shlex.quote(owner)}"
    )


class RemoteGitSourceLease:
    def __init__(
        self,
        resource: str,
        owner: str,
        *,
        host: str,
        user: str,
        deploy_path: str,
        port: int = 22,
        known_hosts_file: str = "",
        acquire_timeout: float = 15,
    ) -> None:
        self.resource = normalize_lease_resource(resource)
        self.owner = owner.strip() or "unknown"
        self.host = host.strip()
        self.user = user.strip()
        self.deploy_path = deploy_path.strip()
        self.port = port
        self.known_hosts_file = known_hosts_file.strip()
        self.acquire_timeout = acquire_timeout
        self._process: subprocess.Popen[str] | None = None
        if not self.host or not self.user or not self.deploy_path:
            raise ValueError(
                "remote source lease requires host, user, and deploy path"
            )

    def _command(self) -> list[str]:
        return [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ConnectionAttempts=1",
            "-o",
            "StrictHostKeyChecking=no",
            f"{self.user}@{self.host}",
            _remote_git_source_lease_script(
                self.deploy_path,
                self.owner,
            ),
        ]

    @staticmethod
    def _close_streams(process: subprocess.Popen[str]) -> None:
        for stream in (process.stdout, process.stderr):
            if stream is not None:
                stream.close()

    @staticmethod
    def _stop_process(process: subprocess.Popen[str]) -> None:
        if process.stdin is not None and not process.stdin.closed:
            process.stdin.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    def acquire(self) -> None:
        if self._process is not None:
            return
        try:
            process = subprocess.Popen(
                self._command(),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                start_new_session=True,
            )
        except OSError as error:
            raise RemoteGitSourceLeaseUnavailable(
                self.resource,
                f"cannot start SSH lease process: {error}",
            ) from error
        if process.stdout is None:
            self._stop_process(process)
            self._close_streams(process)
            raise RemoteGitSourceLeaseUnavailable(
                self.resource,
                "SSH stdout pipe was not created",
            )

        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + self.acquire_timeout
        response = ""
        try:
            while time.monotonic() < deadline:
                if selector.select(timeout=0.1):
                    response = process.stdout.readline().strip()
                    break
                if process.poll() is not None:
                    break
        finally:
            selector.close()

        if response == "READY" and process.poll() is None:
            self._process = process
            return

        self._stop_process(process)
        stderr = (
            process.stderr.read().strip()
            if process.stderr is not None
            else ""
        )
        self._close_streams(process)
        detail = response or stderr or "SSH lease handshake timed out"
        if detail.startswith("BLOCKED:lease-held:"):
            current_owner = detail.removeprefix("BLOCKED:lease-held:")
            detail = (
                f"deployment worktree is held by {current_owner}"
                if current_owner
                else "deployment worktree lease is already held"
            )
        elif detail == "BLOCKED:index-lock-exists":
            detail = "deployment worktree already has .git/index.lock"
        elif detail == "BLOCKED:not-a-git-worktree":
            detail = "deployment path is not a Git worktree"
        raise RemoteGitSourceLeaseUnavailable(self.resource, detail)

    def release(self) -> None:
        process = self._process
        if process is None:
            return
        self._process = None
        exited_early = process.poll() is not None
        if process.stdin is not None and not process.stdin.closed:
            process.stdin.close()
        try:
            returncode = process.wait(timeout=10)
        except subprocess.TimeoutExpired as error:
            self._stop_process(process)
            self._close_streams(process)
            raise RuntimeError(
                f"remote source lease {self.resource!r} did not release"
            ) from error

        stderr = (
            process.stderr.read().strip()
            if process.stderr is not None
            else ""
        )
        self._close_streams(process)
        if exited_early:
            raise RuntimeError(
                f"remote source lease {self.resource!r} exited before cleanup"
            )
        if returncode != 0:
            raise RuntimeError(
                f"remote source lease {self.resource!r} cleanup failed: "
                f"{stderr or f'exit {returncode}'}"
            )

    def __enter__(self) -> RemoteGitSourceLease:
        self.acquire()
        return self

    def __exit__(self, *_: object) -> None:
        self.release()

    def __del__(self) -> None:
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
