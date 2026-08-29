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
    resource: str = "",
    *,
    persistent: bool = False,
    expires_at_epoch: int = 0,
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
    normalized_resource = normalize_lease_resource(resource or normalized_path)
    python_script = "\n".join(
        (
            "import fcntl",
            "import os",
            "import pathlib",
            "import signal",
            "import sys",
            "import time",
            "",
            "lock_root = pathlib.Path.home() / '.cache/peers-touch/source-leases'",
            "lock_root.mkdir(parents=True, exist_ok=True)",
            "lease_path = lock_root / (sys.argv[3] + '.lock')",
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
            "",
            "def stop(*_args):",
            "    raise SystemExit(0)",
            "",
            "for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):",
            "    signal.signal(signum, stop)",
            "persistent = sys.argv[4] == 'persistent'",
            "expires_at = int(sys.argv[5])",
            "try:",
            "    if persistent:",
            "        child_pid = os.fork()",
            "        if child_pid:",
            "            lease.seek(0)",
            "            lease.truncate()",
            "            lease.write(sys.argv[2] + '\\n' + str(child_pid) + '\\n')",
            "            lease.flush()",
            "            os.fsync(lease.fileno())",
            "            print(f'READY:{child_pid}', flush=True)",
            "            os._exit(0)",
            "        os.setsid()",
            "        devnull = os.open('/dev/null', os.O_RDWR)",
            "        for descriptor in (0, 1, 2):",
            "            os.dup2(devnull, descriptor)",
            "        while time.time() < expires_at:",
            "            time.sleep(1)",
            "    else:",
            "        print('READY', flush=True)",
            "        sys.stdin.readline()",
            "finally:",
            "    fcntl.flock(lease.fileno(), fcntl.LOCK_UN)",
        )
    )
    return (
        f"exec python3 -c {shlex.quote(python_script)} "
        f"{shlex.quote(normalized_path)} {shlex.quote(owner)} "
        f"{shlex.quote(normalized_resource)} "
        f"{'persistent' if persistent else 'attached'} "
        f"{int(expires_at_epoch)}"
    )


def _remote_git_source_lease_release_script(
    resource: str,
    owner: str,
) -> str:
    normalized_resource = normalize_lease_resource(resource)
    python_script = "\n".join(
        (
            "import fcntl",
            "import os",
            "import pathlib",
            "import signal",
            "import sys",
            "import time",
            "",
            "lease_path = pathlib.Path.home() / '.cache/peers-touch/source-leases' / (sys.argv[2] + '.lock')",
            "if not lease_path.exists():",
            "    raise SystemExit(0)",
            "lease = lease_path.open('a+', encoding='utf-8')",
            "try:",
            "    fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)",
            "    lease.seek(0)",
            "    lease.truncate()",
            "    lease.flush()",
            "    os.fsync(lease.fileno())",
            "    fcntl.flock(lease.fileno(), fcntl.LOCK_UN)",
            "    print('RELEASED', flush=True)",
            "    raise SystemExit(0)",
            "except BlockingIOError:",
            "    pass",
            "lease.seek(0)",
            "lines = lease.read().splitlines()",
            "current_owner = lines[0] if lines else ''",
            "if current_owner != sys.argv[1]:",
            "    print(f'BLOCKED:lease-owner-mismatch:{current_owner}', flush=True)",
            "    raise SystemExit(73)",
            "pid = int(lines[1]) if len(lines) > 1 and lines[1].isdigit() else 0",
            "if pid:",
            "    command_path = pathlib.Path('/proc') / str(pid) / 'cmdline'",
            "    if command_path.exists():",
            "        command = command_path.read_bytes()",
            "        if sys.argv[1].encode() not in command or sys.argv[2].encode() not in command:",
            "            print('BLOCKED:lease-process-mismatch', flush=True)",
            "            raise SystemExit(73)",
            "    else:",
            "        try:",
            "            os.kill(pid, 0)",
            "        except ProcessLookupError:",
            "            print('BLOCKED:lease-process-missing', flush=True)",
            "            raise SystemExit(73)",
            "    os.kill(pid, signal.SIGTERM)",
            "deadline = time.monotonic() + 10",
            "while time.monotonic() < deadline:",
            "    try:",
            "        fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)",
            "        lease.seek(0)",
            "        lease.truncate()",
            "        lease.flush()",
            "        os.fsync(lease.fileno())",
            "        fcntl.flock(lease.fileno(), fcntl.LOCK_UN)",
            "        print('RELEASED', flush=True)",
            "        raise SystemExit(0)",
            "    except BlockingIOError:",
            "        time.sleep(0.1)",
            "print('BLOCKED:lease-release-timeout', flush=True)",
            "raise SystemExit(73)",
        )
    )
    return (
        f"exec python3 -c {shlex.quote(python_script)} "
        f"{shlex.quote(owner)} {shlex.quote(normalized_resource)}"
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
        persistent: bool = False,
        expires_at_epoch: int = 0,
    ) -> None:
        self.resource = normalize_lease_resource(resource)
        self.owner = owner.strip() or "unknown"
        self.host = host.strip()
        self.user = user.strip()
        self.deploy_path = deploy_path.strip()
        from tooling.acceptance.transports.ssh import SshTarget, SshTransport

        self.transport = SshTransport(
            SshTarget(
                host=self.host,
                user=self.user,
                port=port,
                known_hosts_file=known_hosts_file,
            )
        )
        self.acquire_timeout = acquire_timeout
        self.persistent = persistent
        self.expires_at_epoch = expires_at_epoch
        self._process: subprocess.Popen[str] | None = None
        self._acquired = False
        if not self.host or not self.user or not self.deploy_path:
            raise ValueError(
                "remote source lease requires host, user, and deploy path"
            )

    def _command(self) -> list[str]:
        return [
            *self.transport.command_prefix(),
            self.transport.target.destination,
            _remote_git_source_lease_script(
                self.deploy_path,
                self.owner,
                self.resource,
                persistent=self.persistent,
                expires_at_epoch=self.expires_at_epoch,
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
        if self._process is not None or self._acquired:
            return
        if self.persistent and self.expires_at_epoch <= int(time.time()):
            raise ValueError("persistent remote source lease requires a future expiry")
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

        if response == "READY" and process.poll() is None and not self.persistent:
            self._process = process
            self._acquired = True
            return
        if self.persistent and response.startswith("READY:"):
            try:
                int(response.removeprefix("READY:"))
                returncode = process.wait(timeout=10)
            except (ValueError, subprocess.TimeoutExpired):
                returncode = -1
            if returncode == 0:
                self._close_streams(process)
                self._acquired = True
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
        raise RemoteGitSourceLeaseUnavailable(self.resource, detail)

    def attach_persistent(self) -> None:
        if not self.persistent:
            raise ValueError("only persistent remote source leases can be attached")
        self._acquired = True

    def release(self) -> None:
        if self.persistent:
            if not self._acquired:
                return
            completed = subprocess.run(
                [
                    *self.transport.command_prefix(),
                    self.transport.target.destination,
                    _remote_git_source_lease_release_script(
                        self.resource,
                        self.owner,
                    ),
                ],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            if completed.returncode != 0:
                detail = completed.stdout.strip() or completed.stderr.strip()
                raise RuntimeError(
                    f"remote source lease {self.resource!r} cleanup failed: "
                    f"{detail or f'exit {completed.returncode}'}"
                )
            self._acquired = False
            return
        process = self._process
        if process is None:
            return
        self._process = None
        self._acquired = False
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
        if self.persistent:
            return
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
