"""Runner-owned bounded native supervisor lifecycle.

This module does not allocate runs, seal artifacts, merge results or publish.
Full runtime-capture admission belongs to the preflight coordinator; an exact
executable hash check here is necessary but is not historical runtime proof.
"""

from __future__ import annotations

import base64
import hashlib
import os
import signal
import socket
import stat
import subprocess
import time
from dataclasses import dataclass

from . import finalization_contracts as contracts
from .finalizer_worker import ControlChannel, DescriptorSend


class SupervisorFailure(RuntimeError):
    code = contracts.FinalizerFailureCode.SUPERVISOR_FAILED


def _open_anchored_regular(path: str) -> int:
    if (
        not os.path.isabs(path)
        or os.path.normpath(path) != path
        or os.path.realpath(path) != path
    ):
        raise SupervisorFailure("supervisor source path must be canonical realpath")
    directory = os.open(
        "/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    )
    try:
        components = path.split("/")[1:]
        for component in components[:-1]:
            child = os.open(
                component,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=directory,
            )
            os.close(directory)
            directory = child
        result = os.open(
            components[-1],
            os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=directory,
        )
        os.close(directory)
        return result
    except BaseException:
        os.close(directory)
        raise


def _open_anchored_directory(path: str) -> int:
    if not os.path.isabs(path) or os.path.normpath(path) != path:
        raise SupervisorFailure("supervisor cwd must be normalized and absolute")
    path = os.path.realpath(path)
    directory = os.open(
        "/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    )
    try:
        for component in path.split("/")[1:]:
            child = os.open(
                component,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=directory,
            )
            os.close(directory)
            directory = child
        return directory
    except BaseException:
        os.close(directory)
        raise


@dataclass(frozen=True)
class SupervisorExecutables:
    binary: str
    binary_sha256: str
    python: str
    python_sha256: str
    worker: str
    worker_sha256: str

    def verify(self) -> None:
        for path, expected in (
            (self.binary, self.binary_sha256),
            (self.python, self.python_sha256),
            (self.worker, self.worker_sha256),
        ):
            contracts.validate_sha256(expected)
            fd = _open_anchored_regular(path)
            try:
                before = os.fstat(fd)
                if not stat.S_ISREG(before.st_mode):
                    raise SupervisorFailure("supervisor source is not a regular file")
                digest = hashlib.sha256()
                while chunk := os.read(fd, 65536):
                    digest.update(chunk)
                after = os.fstat(fd)
                if (
                    before.st_size, before.st_mtime_ns, before.st_ctime_ns
                ) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                    raise SupervisorFailure("supervisor executable changed during verification")
                if digest.hexdigest() != expected:
                    raise SupervisorFailure("supervisor executable hash mismatch")
            finally:
                os.close(fd)


def _frame(payload: dict[str, object]) -> object:
    return contracts.supervisor_control_frame_from_bytes(
        contracts.canonical_json_bytes({
            **payload,
            "frameDigest": contracts.domain_separated_sha256(
                "pt.acceptance.finalization.supervisor-control-frame.v1", payload
            ),
        })
    )


class NativeSupervisor:
    """Own one process and its sockets; expose only contract-bound control I/O."""

    def __init__(
        self, executables: SupervisorExecutables, *, session_id: str,
        runtime_digest: str, temporary_directory: str,
    ):
        self.executables = executables
        self.session = contracts.SupervisorSession(session_id, runtime_digest)
        self.process: subprocess.Popen | None = None
        self.channel: ControlChannel | None = None
        self.descriptor_channel: socket.socket | None = None
        self.descriptor_send: DescriptorSend | None = None
        self.worker_pid: int | None = None
        self.worker_pgid: int | None = None
        self.frames: list[object] = []
        self.diagnostics: list[tuple[str, bytes, bool]] = []
        self.close_acknowledged = False
        self.supervisor_reaped = False
        self.executables.verify()
        cwd_fd = _open_anchored_directory(temporary_directory)
        observed = os.fstat(cwd_fd)
        if (
            not stat.S_ISDIR(observed.st_mode)
            or observed.st_uid != os.geteuid()
            or stat.S_IMODE(observed.st_mode) & 0o077
        ):
            os.close(cwd_fd)
            raise SupervisorFailure("supervisor cwd must be an owner-only directory")
        parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        self.channel = ControlChannel(parent)
        rights_parent, rights_child = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
        self.descriptor_channel = rights_parent
        try:
            self.process = subprocess.Popen(
                [
                    executables.binary, str(child.fileno()), session_id, runtime_digest,
                    executables.python, executables.worker, str(rights_child.fileno()),
                    str(cwd_fd),
                ],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, shell=False, close_fds=True,
                pass_fds=(child.fileno(), rights_child.fileno(), cwd_fd), cwd="/",
                env={"LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
            )
            child.close()
            rights_child.close()
            os.close(cwd_fd)
            cwd_fd = -1
            self.receive(deadline=time.monotonic() + 10)
            if self.session.state != "READY":
                raise SupervisorFailure("supervisor did not acknowledge READY")
        except BaseException:
            child.close()
            rights_child.close()
            if cwd_fd >= 0:
                os.close(cwd_fd)
            self._fail()
            self.close()
            raise

    def _fail(self) -> None:
        self.session.state = "FAILED"
        if self.session.failure_code is None:
            self.session.failure_code = contracts.FinalizerFailureCode.SUPERVISOR_FAILED

    def receive(self, *, deadline: float) -> object:
        try:
            if self.channel is None or self.process is None:
                raise SupervisorFailure("supervisor channel is unavailable")
            # A terminal frame may be queued after the sender has exited.
            # Decode that frame before treating reverse EOF as a failure;
            # CLOSED still requires CLOSE_ACK plus a consumed wait status.
            frame = self.channel.receive(
                deadline=deadline, request=self.session.request,
                expected_identity=(
                    self.session.request.identity if self.session.request is not None else None
                ),
            )
            self.frames.append(frame)
            self.session.accept(frame)
            if type(frame) is contracts.RequestAcceptedFrame and self.descriptor_send is not None:
                self.descriptor_send.accept(frame)
                self.descriptor_send = None
            if type(frame) is contracts.WorkerArmedFrame:
                self.worker_pid, self.worker_pgid = frame.pid, frame.pgid
            if type(frame) is contracts.WorkerDiagnosticFrame:
                self.diagnostics.append(
                    (
                        frame.stream,
                        base64.b64decode(
                            frame.chunk_base64.encode("ascii")
                        ),
                        frame.final_chunk,
                    )
                )
            if type(frame) in (
                contracts.WorkerExitedFrame, contracts.WorkerSignaledFrame,
                contracts.WorkerTimeoutFrame, contracts.WorkerCancelledFrame,
            ):
                self.worker_pid = self.worker_pgid = None
            if type(frame) is contracts.SupervisorCloseAckFrame:
                self.close_acknowledged = True
                # Pure protocol CLOSED is not actual process reaping.
                self.session.state = "CLOSING"
            return frame
        except BaseException:
            self._fail()
            raise

    def send(self, frame: object, *, deadline: float) -> None:
        try:
            if self.channel is None or self.process is None or self.process.poll() is not None:
                raise SupervisorFailure("supervisor is not live")
            self.session.accept(frame)
            self.channel.send(frame, deadline=deadline)
        except BaseException:
            self._fail()
            raise

    def send_descriptors(self, owner_fds: tuple[int, ...], *, deadline: float) -> None:
        """Duplicates remain owned until the native request-bound acceptance."""
        try:
            if self.session.request is None or self.descriptor_channel is None:
                raise SupervisorFailure("descriptor transfer requires an active request")
            if self.descriptor_send is not None:
                raise SupervisorFailure("descriptor transfer is already outstanding")
            self.descriptor_send = DescriptorSend(self.session.request.identity, owner_fds)
            frame = self.descriptor_send.send(self.descriptor_channel, deadline=deadline)
            self.session.accept(frame)
        except BaseException:
            if self.descriptor_send is not None:
                self.descriptor_send.close()
                self.descriptor_send = None
            self._fail()
            raise

    def execute(
        self, request: contracts.WorkerRequest, *, owner_fds: tuple[int, ...] = (),
    ) -> contracts.WorkerResult:
        deadline = time.monotonic() + contracts.worker_timeout_seconds(request) + 5
        payload = {
            "frameType": "WORKER_REQUEST", "identity": request.identity.to_dict(),
            "request": request.to_dict(),
        }
        frame = contracts.WorkerRequestFrame(
            request.identity, request,
            contracts.domain_separated_sha256(
                "pt.acceptance.finalization.supervisor-control-frame.v1", payload
            ),
        )
        result = None
        try:
            self.executables.verify()
            if len(owner_fds) != len(request.identity.descriptor_claims):
                raise SupervisorFailure("worker descriptor count does not match its request")
            self.send(frame, deadline=deadline)
            if owner_fds:
                self.send_descriptors(owner_fds, deadline=deadline)
            while self.session.request is not None:
                observed = self.receive(deadline=deadline)
                if type(observed) is contracts.WorkerResultFrame:
                    result = observed.result
            self.executables.verify()
            if self.session.failure_code is not None or result is None:
                raise SupervisorFailure("worker did not complete successfully")
            return result
        except BaseException:
            self._fail()
            self.close()
            raise

    def close(self) -> None:
        """CLOSED requires native CLOSE_ACK and consuming parent wait.

        On an unusable channel, EOF first lets the native owner kill and reap.
        Killing the supervisor without its ACK cannot prove its child was reaped,
        so that fallback keeps FAILED even when the supervisor itself is reaped.
        """
        if self.supervisor_reaped:
            return
        deadline = time.monotonic() + 5
        try:
            if self.process is not None and self.process.poll() is None and self.channel is not None:
                if self.session.request is not None and self.session.state == "REQUEST_ACTIVE":
                    cancel = _frame({
                        "frameType": "WORKER_CANCEL_REQUEST",
                        "identity": self.session.request.identity.to_dict(),
                        "reason": "SESSION_CLOSE",
                    })
                    self.send(cancel, deadline=deadline)
                    while self.session.request is not None:
                        self.receive(deadline=deadline)
                if self.session.request is None and self.session.state in ("READY", "FAILED"):
                    close = _frame({
                        "frameType": "SUPERVISOR_CLOSE",
                        "supervisorSessionId": self.session.supervisor_session_id,
                        "lastSequence": self.session.next_sequence - 1,
                    })
                    self.send(close, deadline=deadline)
                    self.receive(deadline=deadline)
        except (OSError, ValueError, TimeoutError, SupervisorFailure):
            self._fail()
        finally:
            if self.descriptor_send is not None:
                self.descriptor_send.close()
                self.descriptor_send = None
            if self.descriptor_channel is not None:
                self.descriptor_channel.close()
            if self.channel is not None:
                self.channel.channel.close()
            if self.process is not None:
                try:
                    self.process.wait(timeout=max(0.001, deadline - time.monotonic()))
                    self.supervisor_reaped = True
                except subprocess.TimeoutExpired:
                    # Direct child PID is owned by this Popen object. Worker PID
                    # reuse is not guessed after losing the supervisor channel.
                    self.process.send_signal(signal.SIGKILL)
                    try:
                        self.process.wait(timeout=5)
                        self.supervisor_reaped = True
                    except subprocess.TimeoutExpired:
                        self._fail()
            if self.close_acknowledged and self.supervisor_reaped:
                self.session.state = "CLOSED"
                self.session.closed_after_failure = self.session.failure_code is not None
            else:
                self._fail()

    def __enter__(self) -> "NativeSupervisor":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
