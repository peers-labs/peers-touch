"""Bounded SSH command and tunnel lifecycle for remote Acceptance cells."""

from __future__ import annotations

import os
import re
import shlex
import signal
import socket
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from tooling.acceptance.core.errors import ProvisioningError


_HOST_PATTERN = re.compile(r"^[A-Za-z0-9._:%-]+$")
_USER_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
_REMOTE_PATH_PATTERN = re.compile(r"^/[A-Za-z0-9._/-]+$")


def _validate_atom(
    value: str,
    name: str,
    pattern: re.Pattern[str],
) -> str:
    normalized = value.strip()
    if not normalized or not pattern.fullmatch(normalized):
        raise ProvisioningError(f"SSH {name} is missing or invalid")
    return normalized


def available_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


@dataclass(frozen=True)
class SshTarget:
    host: str
    user: str
    port: int = 22
    known_hosts_file: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "host",
            _validate_atom(self.host, "host", _HOST_PATTERN),
        )
        object.__setattr__(
            self,
            "user",
            _validate_atom(self.user, "user", _USER_PATTERN),
        )
        if self.port < 1 or self.port > 65535:
            raise ProvisioningError("SSH port must be between 1 and 65535")
        if self.known_hosts_file and not Path(
            self.known_hosts_file
        ).expanduser().is_file():
            raise ProvisioningError(
                f"SSH known-hosts file does not exist: {self.known_hosts_file}"
            )

    @property
    def destination(self) -> str:
        return f"{self.user}@{self.host}"


class SshTunnel:
    def __init__(self, process: subprocess.Popen[bytes], local_port: int) -> None:
        self._process = process
        self.local_port = local_port

    @property
    def process_id(self) -> int:
        process = self._process
        return process.pid if process is not None else 0

    def is_alive(self) -> bool:
        process = self._process
        return process is not None and process.poll() is None

    def stop(self) -> None:
        process = self._process
        if process is None:
            return
        self._process = None
        try:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
        finally:
            for stream in (process.stdout, process.stderr):
                if stream is not None:
                    stream.close()

    def __enter__(self) -> "SshTunnel":
        return self

    def __exit__(self, *_: object) -> None:
        self.stop()


class SshTransport:
    """SSH transport with strict host verification and bounded operations."""

    def __init__(
        self,
        target: SshTarget,
        *,
        connect_timeout: int = 10,
    ) -> None:
        if connect_timeout <= 0:
            raise ProvisioningError("SSH connect timeout must be positive")
        self.target = target
        self.connect_timeout = connect_timeout

    def command_prefix(self) -> list[str]:
        command = [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            f"ConnectTimeout={self.connect_timeout}",
            "-o",
            "ConnectionAttempts=1",
            "-o",
            "StrictHostKeyChecking=yes",
            "-p",
            str(self.target.port),
        ]
        if self.target.known_hosts_file:
            command.extend(
                [
                    "-o",
                    "UserKnownHostsFile="
                    + str(Path(self.target.known_hosts_file).expanduser()),
                ]
            )
        return command

    def git_ssh_command(self) -> str:
        return shlex.join(self.command_prefix())

    def run_argv(
        self,
        argv: Sequence[str],
        *,
        timeout: float,
        check: bool = False,
        environment: Mapping[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        if not argv:
            raise ProvisioningError("remote SSH command is required")
        if timeout <= 0:
            raise ProvisioningError("remote SSH command timeout must be positive")
        completed = subprocess.run(
            [
                *self.command_prefix(),
                self.target.destination,
                shlex.join(str(argument) for argument in argv),
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=dict(environment) if environment is not None else None,
        )
        if check and completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise ProvisioningError(
                f"remote SSH command failed with exit {completed.returncode}: "
                f"{detail[-4000:]}"
            )
        return completed

    def copy_file(
        self,
        source: Path,
        remote_path: Path,
        *,
        timeout: float = 30,
    ) -> None:
        local_source = source.expanduser().resolve()
        remote_destination = str(remote_path)
        if not local_source.is_file():
            raise ProvisioningError(
                f"SSH copy source is missing or not a file: {local_source}"
            )
        if (
            not remote_path.is_absolute()
            or not _REMOTE_PATH_PATTERN.fullmatch(remote_destination)
        ):
            raise ProvisioningError("SSH copy destination is invalid")
        if timeout <= 0:
            raise ProvisioningError("SSH copy timeout must be positive")

        command = [
            "scp",
            "-q",
            "-o",
            "BatchMode=yes",
            "-o",
            f"ConnectTimeout={self.connect_timeout}",
            "-o",
            "ConnectionAttempts=1",
            "-o",
            "StrictHostKeyChecking=yes",
            "-P",
            str(self.target.port),
        ]
        if self.target.known_hosts_file:
            command.extend(
                [
                    "-o",
                    "UserKnownHostsFile="
                    + str(Path(self.target.known_hosts_file).expanduser()),
                ]
            )
        command.extend(
            (
                str(local_source),
                f"{self.target.destination}:{remote_destination}",
            )
        )
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise ProvisioningError(
                "SSH file copy failed with exit "
                f"{completed.returncode}: {detail[-4000:]}"
            )

    def start_local_forward(
        self,
        *,
        remote_port: int,
        local_port: int | None = None,
        timeout: float = 10,
    ) -> SshTunnel:
        if remote_port < 1 or remote_port > 65535:
            raise ProvisioningError("remote forward port is invalid")
        selected_local_port = local_port or available_local_port()
        if selected_local_port < 1 or selected_local_port > 65535:
            raise ProvisioningError("local forward port is invalid")
        return self._start_forward(
            direction="-L",
            specification=(
                f"127.0.0.1:{selected_local_port}:"
                f"127.0.0.1:{remote_port}"
            ),
            local_probe_port=selected_local_port,
            remote_probe_port=None,
            timeout=timeout,
        )

    def start_reverse_forward(
        self,
        *,
        local_port: int,
        remote_port: int,
        timeout: float = 10,
    ) -> SshTunnel:
        for name, port in (("local", local_port), ("remote", remote_port)):
            if port < 1 or port > 65535:
                raise ProvisioningError(f"{name} reverse-forward port is invalid")
        return self._start_forward(
            direction="-R",
            specification=(
                f"127.0.0.1:{remote_port}:127.0.0.1:{local_port}"
            ),
            local_probe_port=None,
            remote_probe_port=remote_port,
            timeout=timeout,
        )

    def remote_loopback_port_listening(
        self,
        port: int,
        *,
        timeout: float = 2,
    ) -> bool:
        if port < 1 or port > 65535:
            raise ProvisioningError("remote loopback probe port is invalid")
        try:
            probe = self.run_argv(
                (
                    "python3",
                    "-c",
                    (
                        "import socket,sys;"
                        "connection=socket.create_connection("
                        "('127.0.0.1',int(sys.argv[1])),0.5);"
                        "connection.close()"
                    ),
                    str(port),
                ),
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return False
        return probe.returncode == 0

    def _start_forward(
        self,
        *,
        direction: str,
        specification: str,
        local_probe_port: int | None,
        remote_probe_port: int | None,
        timeout: float,
    ) -> SshTunnel:
        process = subprocess.Popen(
            [
                *self.command_prefix(),
                "-o",
                "ExitOnForwardFailure=yes",
                "-o",
                "ServerAliveInterval=10",
                "-o",
                "ServerAliveCountMax=3",
                "-o",
                "TCPKeepAlive=yes",
                "-N",
                direction,
                specification,
                self.target.destination,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if process.poll() is not None:
                detail = (
                    process.stderr.read().decode("utf-8", errors="replace").strip()
                    if process.stderr is not None
                    else ""
                )
                if process.stderr is not None:
                    process.stderr.close()
                raise ProvisioningError(
                    "SSH forward exited before readiness: "
                    f"{detail[-4000:]}"
                )
            if remote_probe_port is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                if self.remote_loopback_port_listening(
                    remote_probe_port,
                    timeout=remaining,
                ):
                    return SshTunnel(process, 0)
                time.sleep(0.05)
            elif local_probe_port is not None:
                try:
                    with socket.create_connection(
                        ("127.0.0.1", local_probe_port),
                        timeout=0.2,
                    ):
                        return SshTunnel(process, local_probe_port)
                except OSError:
                    time.sleep(0.05)
        tunnel = SshTunnel(process, local_probe_port or 0)
        tunnel.stop()
        raise ProvisioningError(
            f"SSH forward did not become ready within {timeout}s"
        )
