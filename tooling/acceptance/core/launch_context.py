"""Run-scoped, non-persistable capability channel for Acceptance Gates."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
from abc import ABC, abstractmethod
from collections import OrderedDict
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping, Optional

from .errors import (
    EphemeralCapabilityBlocked,
    EphemeralLaunchBindFailed,
    EphemeralLaunchCleanupFailed,
    EphemeralLaunchContextInvalid,
    EphemeralLaunchError,
    EphemeralLaunchHandshakeFailed,
    EphemeralLaunchProtocolError,
    EphemeralLaunchTimeout,
    EphemeralLaunchTransportUnsupported,
)


EPHEMERAL_CONTEXT_FD_ENV = "PT_ACCEPTANCE_EPHEMERAL_CONTEXT_FD"
EPHEMERAL_CONTEXT_WORKSPACE_ENV = "PT_ACCEPTANCE_EPHEMERAL_CONTEXT_WORKSPACE_ID"
EPHEMERAL_CONTEXT_GATE_ENV = "PT_ACCEPTANCE_EPHEMERAL_CONTEXT_GATE_ID"
EPHEMERAL_CONTEXT_EVIDENCE_RUN_ENV = (
    "PT_ACCEPTANCE_EPHEMERAL_CONTEXT_EVIDENCE_RUN_ID"
)
EPHEMERAL_CONTEXT_PROVISIONING_RUN_ENV = (
    "PT_ACCEPTANCE_EPHEMERAL_CONTEXT_PROVISIONING_RUN_ID"
)

DEFAULT_MAX_FRAME_BYTES = 64 * 1024
DEFAULT_MAX_CACHED_RESPONSES = 32
DEFAULT_MAX_REQUEST_IDS = 4096
DEFAULT_REQUEST_TIMEOUT_SECONDS = 30.0
DEFAULT_QUIESCE_TIMEOUT_SECONDS = 5.0
_LENGTH_PREFIX = struct.Struct("!I")


class EphemeralLaunchContextState(str, Enum):
    CREATED = "CREATED"
    SEALED = "SEALED"
    CHILD_BOUND = "CHILD_BOUND"
    ACTIVE = "ACTIVE"
    QUIESCING = "QUIESCING"
    QUIESCED = "QUIESCED"
    CLOSED = "CLOSED"
    BIND_FAILED = "BIND_FAILED"
    CHANNEL_FAILED = "CHANNEL_FAILED"
    CLEANUP_FAILED = "CLEANUP_FAILED"


@dataclass(frozen=True)
class EphemeralHandlerCleanup:
    closed: bool
    secrets_zeroized: bool


@dataclass(frozen=True)
class EphemeralCleanupResult:
    descriptors_closed: bool
    broker_stopped: bool
    handlers_closed: bool
    secrets_zeroized: bool
    quarantined_capabilities: tuple[str, ...] = ()
    errors: tuple[str, ...] = ()

    @property
    def succeeded(self) -> bool:
        return (
            self.descriptors_closed
            and self.broker_stopped
            and self.handlers_closed
            and self.secrets_zeroized
            and not self.errors
        )


class EphemeralCapabilityHandler(ABC):
    """Parent-owned operation allowlist and authority lifecycle."""

    @property
    @abstractmethod
    def allowed_operations(self) -> tuple[str, ...]:
        raise NotImplementedError

    @property
    @abstractmethod
    def sensitive_values(self) -> tuple[str, ...]:
        raise NotImplementedError

    @abstractmethod
    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        raise NotImplementedError

    @abstractmethod
    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        raise NotImplementedError

    @abstractmethod
    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        raise NotImplementedError

    @abstractmethod
    def close(self) -> EphemeralHandlerCleanup:
        raise NotImplementedError

    def __reduce__(self) -> object:
        raise TypeError("ephemeral capability handlers cannot be serialized")

    def __repr__(self) -> str:
        return f"<{type(self).__name__} ephemeral-handler>"


class GateLaunchBinding:
    """The exact non-secret projection allowed at child spawn."""

    def __init__(
        self,
        environment: Mapping[str, str],
        child_endpoint: socket.socket,
    ) -> None:
        self.environment = MappingProxyType(dict(environment))
        self.pass_fds = (child_endpoint.fileno(),)
        self._child_endpoint = child_endpoint
        self._closed = False

    def close_parent_copy(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._child_endpoint.close()

    def __reduce__(self) -> object:
        raise TypeError("ephemeral launch bindings cannot be serialized")

    def __repr__(self) -> str:
        return "<GateLaunchBinding ephemeral>"


@dataclass(frozen=True)
class GateLaunchSpec:
    argv: tuple[str, ...]
    timeout_seconds: float
    required_capabilities: tuple[str, ...]

    def __post_init__(self) -> None:
        if (
            not isinstance(self.argv, tuple)
            or not self.argv
            or any(not isinstance(value, str) or not value for value in self.argv)
        ):
            raise EphemeralLaunchContextInvalid(
                "launch argv must be a non-empty tuple of strings",
                operation="launch",
            )
        if not _is_positive_finite_timeout(self.timeout_seconds):
            raise EphemeralLaunchContextInvalid(
                "launch timeout must be a positive finite number",
                operation="launch",
            )
        _validate_unique_names(
            self.required_capabilities,
            field="required capabilities",
            allow_empty=True,
        )


class GateProcessLauncher:
    """Runs an argv-only Gate with bounded process termination."""

    def __init__(
        self,
        *,
        cwd: Optional[str] = None,
        environment: Optional[Mapping[str, str]] = None,
        termination_timeout_seconds: float = 5.0,
    ) -> None:
        if not _is_positive_finite_timeout(termination_timeout_seconds):
            raise EphemeralLaunchContextInvalid(
                "process termination timeout must be a positive finite number",
                operation="launch",
            )
        self._cwd = cwd
        self._environment = None if environment is None else dict(environment)
        self._termination_timeout_seconds = termination_timeout_seconds

    def run(
        self,
        spec: GateLaunchSpec,
        binding: Optional[GateLaunchBinding],
    ) -> subprocess.CompletedProcess[str]:
        has_context = binding is not None
        if bool(spec.required_capabilities) != has_context:
            raise EphemeralLaunchContextInvalid(
                "launch binding must match required capabilities",
                operation="launch",
            )
        if binding is not None and self._environment is None:
            binding.close_parent_copy()
            raise EphemeralLaunchContextInvalid(
                "context Gate launch requires an explicit child environment",
                operation="launch",
            )
        if (
            binding is not None
            and self._environment is not None
            and "PT_ACCEPTANCE_REDACTION_VALUES" in self._environment
        ):
            binding.close_parent_copy()
            raise EphemeralLaunchContextInvalid(
                "context Gate child environment contains parent redaction values",
                operation="launch",
            )

        environment = self._environment
        popen_options: dict[str, object] = {
            "cwd": self._cwd,
            "env": environment,
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "text": True,
            "shell": False,
            "close_fds": True,
        }
        if os.name == "posix":
            popen_options["start_new_session"] = True
        if binding is not None:
            environment = dict(
                os.environ if environment is None else environment
            )
            environment.update(binding.environment)
            popen_options["env"] = environment
            popen_options["pass_fds"] = binding.pass_fds

        try:
            launch_argv = (
                _isolated_python_argv(spec.argv)
                if binding is not None
                else spec.argv
            )
            process = subprocess.Popen(launch_argv, **popen_options)
        except OSError as error:
            raise EphemeralLaunchBindFailed(
                "failed to spawn Gate process",
                operation="gate_process",
            ) from error
        finally:
            if binding is not None:
                binding.close_parent_copy()

        try:
            stdout, stderr = process.communicate(timeout=spec.timeout_seconds)
        except subprocess.TimeoutExpired as error:
            self._terminate(process)
            raise EphemeralLaunchTimeout(
                "Gate process exceeded its launch timeout",
                operation="gate_process",
            ) from error
        except BaseException:
            self._terminate(process)
            raise
        self._kill_remaining_process_group(process)
        return subprocess.CompletedProcess(
            args=spec.argv,
            returncode=process.returncode,
            stdout=stdout,
            stderr=stderr,
        )

    def _terminate(self, process: subprocess.Popen[str]) -> None:
        self._signal_process_tree(process, force=False)
        try:
            process.communicate(timeout=self._termination_timeout_seconds)
        except subprocess.TimeoutExpired:
            self._signal_process_tree(process, force=True)
        except BaseException:
            self._signal_process_tree(process, force=True)
        else:
            self._kill_remaining_process_group(process)
            return
        try:
            process.communicate(timeout=self._termination_timeout_seconds)
        except subprocess.TimeoutExpired as error:
            raise EphemeralLaunchCleanupFailed(
                "Gate process did not stop after termination",
                operation="gate_process",
            ) from error
        except BaseException as error:
            raise EphemeralLaunchCleanupFailed(
                "Gate process could not be reaped after termination",
                operation="gate_process",
            ) from error
        self._kill_remaining_process_group(process)

    @staticmethod
    def _signal_process_tree(
        process: subprocess.Popen[str],
        *,
        force: bool,
    ) -> None:
        try:
            if os.name == "posix":
                os.killpg(
                    process.pid,
                    signal.SIGKILL if force else signal.SIGTERM,
                )
            elif force:
                process.kill()
            else:
                process.terminate()
        except ProcessLookupError:
            return
        except OSError as error:
            raise EphemeralLaunchCleanupFailed(
                "Gate process group could not be signalled",
                operation="gate_process",
            ) from error

    def _kill_remaining_process_group(
        self,
        process: subprocess.Popen[str],
    ) -> None:
        if os.name != "posix":
            return
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        except OSError as error:
            raise EphemeralLaunchCleanupFailed(
                "Gate process descendants could not be killed",
                operation="gate_process",
            ) from error
        deadline = time.monotonic() + self._termination_timeout_seconds
        while True:
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                return
            except PermissionError:
                pass
            except OSError as error:
                raise EphemeralLaunchCleanupFailed(
                    "Gate process-group extinction could not be verified",
                    operation="gate_process",
                ) from error
            if time.monotonic() >= deadline:
                raise EphemeralLaunchCleanupFailed(
                    "Gate process group survived forced termination",
                    operation="gate_process",
                )
            time.sleep(min(0.01, max(0.0, deadline - time.monotonic())))


class EphemeralGateLaunchContext:
    """Owns one POSIX channel, exact handlers, and their bounded lifecycle."""

    def __init__(
        self,
        *,
        required_capabilities: tuple[str, ...],
        max_frame_bytes: int = DEFAULT_MAX_FRAME_BYTES,
        max_cached_responses: int = DEFAULT_MAX_CACHED_RESPONSES,
        max_request_ids: int = DEFAULT_MAX_REQUEST_IDS,
        request_timeout_seconds: float = DEFAULT_REQUEST_TIMEOUT_SECONDS,
        quiesce_timeout_seconds: float = DEFAULT_QUIESCE_TIMEOUT_SECONDS,
        platform: Optional[str] = None,
    ) -> None:
        required = _validate_unique_names(
            required_capabilities,
            field="required capabilities",
        )
        if max_frame_bytes < 256:
            raise EphemeralLaunchContextInvalid(
                "frame byte budget must be at least 256",
                operation="create",
            )
        if max_cached_responses < 1:
            raise EphemeralLaunchContextInvalid(
                "response cache bound must be positive",
                operation="create",
            )
        if max_request_ids < max_cached_responses:
            raise EphemeralLaunchContextInvalid(
                "request id bound must cover the response cache",
                operation="create",
            )
        if not _is_positive_finite_timeout(
            request_timeout_seconds
        ) or not _is_positive_finite_timeout(quiesce_timeout_seconds):
            raise EphemeralLaunchContextInvalid(
                "request and quiesce timeouts must be positive finite numbers",
                operation="create",
            )

        self._required_capabilities = frozenset(required)
        self._handlers: dict[str, EphemeralCapabilityHandler] = {}
        self._state = EphemeralLaunchContextState.CREATED
        self._identity: Optional[dict[str, str]] = None
        self._max_frame_bytes = max_frame_bytes
        self._max_cached_responses = max_cached_responses
        self._max_request_ids = max_request_ids
        self._request_timeout_seconds = request_timeout_seconds
        self._quiesce_timeout_seconds = quiesce_timeout_seconds
        self._platform = platform if platform is not None else os.name
        self._parent_endpoint: Optional[socket.socket] = None
        self._child_endpoint: Optional[socket.socket] = None
        self._binding: Optional[GateLaunchBinding] = None
        self._broker: Optional[threading.Thread] = None
        self._broker_ready = threading.Event()
        self._stop = threading.Event()
        self._active_cancellation: Optional[threading.Event] = None
        self._active_worker: Optional[threading.Thread] = None
        self._active_handler: Optional[EphemeralCapabilityHandler] = None
        self._response_cache: OrderedDict[str, tuple[str, bytes]] = OrderedDict()
        self._request_digests: dict[str, str] = {}
        self._lock = threading.RLock()
        self._blocked_error: Optional[EphemeralCapabilityBlocked] = None
        self._channel_error: Optional[EphemeralLaunchError] = None
        self._quiesce_error: Optional[EphemeralLaunchCleanupFailed] = None
        self._cleanup_result: Optional[EphemeralCleanupResult] = None
        self._child_monotonic_offset = 0.0

    @property
    def state(self) -> EphemeralLaunchContextState:
        return self._state

    @property
    def cleanup_result(self) -> Optional[EphemeralCleanupResult]:
        return self._cleanup_result

    @property
    def blocked_error(self) -> Optional[EphemeralCapabilityBlocked]:
        with self._lock:
            return self._blocked_error

    @property
    def channel_error(self) -> Optional[EphemeralLaunchError]:
        with self._lock:
            return self._channel_error

    def register_capability(
        self,
        capability_id: str,
        handler: EphemeralCapabilityHandler,
    ) -> None:
        with self._lock:
            self._require_state(
                EphemeralLaunchContextState.CREATED,
                operation="register_capability",
            )
            _validate_name(capability_id, field="capability id")
            if capability_id in self._handlers:
                raise EphemeralLaunchContextInvalid(
                    "capability is already registered",
                    operation="register_capability",
                )
            if not isinstance(handler, EphemeralCapabilityHandler):
                raise EphemeralLaunchContextInvalid(
                    "capability handler must implement EphemeralCapabilityHandler",
                    operation="register_capability",
                )
            _validate_unique_names(
                handler.allowed_operations,
                field="allowed operations",
            )
            _validate_unique_names(
                handler.sensitive_values,
                field="sensitive values",
                allow_empty=True,
            )
            self._handlers[capability_id] = handler

    def seal(
        self,
        *,
        workspace_id: str,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
    ) -> None:
        with self._lock:
            self._require_state(
                EphemeralLaunchContextState.CREATED,
                operation="seal",
            )
            identity = {
                "workspaceId": _validate_name(workspace_id, field="workspace id"),
                "gateId": _validate_name(gate_id, field="gate id"),
                "evidenceRunId": _validate_name(
                    evidence_run_id,
                    field="evidence run id",
                ),
                "provisioningRunId": _validate_name(
                    provisioning_run_id,
                    field="provisioning run id",
                ),
            }
            if set(self._handlers) != self._required_capabilities:
                raise EphemeralLaunchContextInvalid(
                    "registered capabilities do not exactly match required capabilities",
                    operation="seal",
                )
            self._identity = identity
            self._state = EphemeralLaunchContextState.SEALED

    def bind_child(self) -> GateLaunchBinding:
        with self._lock:
            self._require_state(
                EphemeralLaunchContextState.SEALED,
                operation="bind_child",
            )
            if self._platform != "posix":
                self._state = EphemeralLaunchContextState.BIND_FAILED
                raise EphemeralLaunchTransportUnsupported(
                    "no secure ephemeral launch transport is available",
                    operation="bind_child",
                )
            try:
                parent_endpoint, child_endpoint = socket.socketpair()
                parent_endpoint.set_inheritable(False)
                child_endpoint.set_inheritable(False)
                parent_endpoint.settimeout(0.1)
            except OSError as error:
                self._state = EphemeralLaunchContextState.BIND_FAILED
                raise EphemeralLaunchBindFailed(
                    "failed to create anonymous launch channel",
                    operation="bind_child",
                ) from error

            assert self._identity is not None
            environment = {
                EPHEMERAL_CONTEXT_FD_ENV: str(child_endpoint.fileno()),
                EPHEMERAL_CONTEXT_WORKSPACE_ENV: self._identity["workspaceId"],
                EPHEMERAL_CONTEXT_GATE_ENV: self._identity["gateId"],
                EPHEMERAL_CONTEXT_EVIDENCE_RUN_ENV: self._identity["evidenceRunId"],
                EPHEMERAL_CONTEXT_PROVISIONING_RUN_ENV: self._identity[
                    "provisioningRunId"
                ],
            }
            self._parent_endpoint = parent_endpoint
            self._child_endpoint = child_endpoint
            self._binding = GateLaunchBinding(environment, child_endpoint)
            self._state = EphemeralLaunchContextState.CHILD_BOUND
            return self._binding

    def activate(self) -> None:
        with self._lock:
            self._require_state(
                EphemeralLaunchContextState.CHILD_BOUND,
                operation="activate",
            )
            self._broker = threading.Thread(
                target=self._broker_loop,
                name="ephemeral-gate-launch-broker",
                daemon=True,
            )
            self._broker.start()
        if not self._broker_ready.wait(self._quiesce_timeout_seconds):
            self._state = EphemeralLaunchContextState.CHANNEL_FAILED
            raise EphemeralLaunchBindFailed(
                "ephemeral launch broker did not become ready",
                operation="activate",
            )
        with self._lock:
            if self._channel_error is not None:
                raise self._channel_error
            self._state = EphemeralLaunchContextState.ACTIVE

    def quiesce(self) -> None:
        with self._lock:
            if self._state in (
                EphemeralLaunchContextState.QUIESCED,
                EphemeralLaunchContextState.CLOSED,
            ):
                return
            if self._state == EphemeralLaunchContextState.CLEANUP_FAILED:
                if self._quiesce_error is not None:
                    raise self._quiesce_error
                return
            self._state = EphemeralLaunchContextState.QUIESCING
            self._stop.set()
            if self._active_cancellation is not None:
                self._active_cancellation.set()
            self._close_endpoints()
            broker = self._broker

        if broker is not None and broker is not threading.current_thread():
            broker.join(self._quiesce_timeout_seconds)
        broker_stopped = broker is None or not broker.is_alive()
        worker_stopped = (
            self._active_worker is None or not self._active_worker.is_alive()
        )
        if not broker_stopped or not worker_stopped:
            errors = ["broker or capability handler exceeded quiesce deadline"]
            active_handler = self._active_handler
            quarantined_capabilities: tuple[str, ...] = ()
            if not worker_stopped and active_handler is not None:
                quarantined = _bounded_handler_quarantine(
                    active_handler,
                    reason="ephemeral capability handler exceeded quiesce deadline",
                    timeout_seconds=self._quiesce_timeout_seconds,
                )
                if not quarantined:
                    errors.append("active capability handler quarantine failed")
                else:
                    quarantined_capabilities = tuple(
                        capability_id
                        for capability_id, handler in self._handlers.items()
                        if handler is active_handler
                    )
            result = EphemeralCleanupResult(
                descriptors_closed=self._descriptors_closed(),
                broker_stopped=broker_stopped,
                handlers_closed=False,
                secrets_zeroized=False,
                quarantined_capabilities=quarantined_capabilities,
                errors=tuple(errors),
            )
            error = EphemeralLaunchCleanupFailed(
                "ephemeral launch context failed to quiesce",
                operation="quiesce",
                result=result,
            )
            with self._lock:
                self._cleanup_result = result
                self._quiesce_error = error
                self._state = EphemeralLaunchContextState.CLEANUP_FAILED
            raise error
        with self._lock:
            self._state = EphemeralLaunchContextState.QUIESCED

    def close(self) -> EphemeralCleanupResult:
        with self._lock:
            if self._state == EphemeralLaunchContextState.CLOSED:
                assert self._cleanup_result is not None
                return self._cleanup_result
            prior_cleanup = (
                self._cleanup_result
                if self._state == EphemeralLaunchContextState.CLEANUP_FAILED
                else None
            )
            if (
                prior_cleanup is None
                or not prior_cleanup.quarantined_capabilities
            ):
                self._require_state(
                    EphemeralLaunchContextState.QUIESCED,
                    operation="close",
                )

        errors = list(prior_cleanup.errors if prior_cleanup is not None else ())
        handlers_closed = True
        secrets_zeroized = True
        for handler in tuple(self._handlers.values()):
            try:
                handler_result = _bounded_handler_close(
                    handler,
                    self._quiesce_timeout_seconds,
                )
            except BaseException:
                handlers_closed = False
                secrets_zeroized = False
                errors.append("capability handler cleanup failed")
                continue
            handlers_closed = handlers_closed and handler_result.closed
            secrets_zeroized = (
                secrets_zeroized and handler_result.secrets_zeroized
            )
            if not handler_result.closed:
                errors.append("capability handler did not close")
            if not handler_result.secrets_zeroized:
                errors.append("capability handler did not verify zeroization")

        self._response_cache.clear()
        self._request_digests.clear()
        self._handlers.clear()
        result = EphemeralCleanupResult(
            descriptors_closed=self._descriptors_closed(),
            broker_stopped=self._broker is None or not self._broker.is_alive(),
            quarantined_capabilities=(
                prior_cleanup.quarantined_capabilities
                if prior_cleanup is not None
                else ()
            ),
            handlers_closed=handlers_closed,
            secrets_zeroized=secrets_zeroized,
            errors=tuple(errors),
        )
        with self._lock:
            self._cleanup_result = result
            self._identity = None
            self._state = (
                EphemeralLaunchContextState.CLOSED
                if result.succeeded
                else EphemeralLaunchContextState.CLEANUP_FAILED
            )
        if not result.succeeded:
            raise EphemeralLaunchCleanupFailed(
                "ephemeral launch context cleanup did not close all owners",
                operation="close",
                result=result,
            )
        return result

    def __reduce__(self) -> object:
        raise TypeError("ephemeral launch contexts cannot be serialized")

    def __repr__(self) -> str:
        return (
            "<EphemeralGateLaunchContext "
            f"state={self._state.value} capabilities={len(self._handlers)}>"
        )

    def _broker_loop(self) -> None:
        self._broker_ready.set()
        try:
            endpoint = self._parent_endpoint
            identity = self._identity
            if endpoint is None or identity is None:
                raise EphemeralLaunchBindFailed(
                    "ephemeral launch channel is not bound",
                    operation="broker",
                )
            handshake = _recv_frame(
                endpoint,
                self._max_frame_bytes,
                stop=self._stop,
                deadline_monotonic=(
                    time.monotonic() + self._request_timeout_seconds
                ),
            )
            if handshake.get("type") != "handshake" or any(
                handshake.get(key) != value for key, value in identity.items()
            ):
                raise EphemeralLaunchHandshakeFailed(
                    "ephemeral launch identity handshake failed",
                    operation="handshake",
                )
            child_monotonic = handshake.get("childMonotonic")
            child_process_id = handshake.get("childProcessId")
            if child_monotonic is not None or child_process_id is not None:
                if (
                    not _is_positive_finite_timeout(child_monotonic)
                    or not isinstance(child_process_id, int)
                    or child_process_id <= 0
                ):
                    raise EphemeralLaunchHandshakeFailed(
                        "ephemeral launch monotonic clock handshake failed",
                        operation="handshake",
                    )
                # Python 3.9 on macOS uses process-local monotonic origins.
                # Translate child absolute deadlines into the parent clock
                # domain before applying the existing no-extension clamp.
                if child_process_id != os.getpid():
                    self._child_monotonic_offset = (
                        time.monotonic() - float(child_monotonic)
                    )
            _send_frame(
                endpoint,
                {"type": "handshake", "status": "OK"},
                self._max_frame_bytes,
            )

            while not self._stop.is_set():
                request = _recv_frame(
                    endpoint,
                    self._max_frame_bytes,
                    stop=self._stop,
                    frame_timeout_seconds=self._request_timeout_seconds,
                )
                if request.get("type") == "close":
                    if set(request) != {"type", *identity} or any(
                        request.get(key) != value
                        for key, value in identity.items()
                    ):
                        raise EphemeralLaunchProtocolError(
                            "ephemeral launch close frame is invalid",
                            operation="broker",
                        )
                    _send_frame(
                        endpoint,
                        {"type": "close", "status": "OK"},
                        self._max_frame_bytes,
                    )
                    return
                response_bytes = self._dispatch_request(request)
                _send_encoded_frame(
                    endpoint,
                    response_bytes,
                    self._max_frame_bytes,
                )
        except EOFError:
            if not self._stop.is_set():
                self._channel_error = EphemeralLaunchProtocolError(
                    "ephemeral launch channel closed unexpectedly",
                    operation="broker",
                )
        except EphemeralLaunchError as error:
            self._channel_error = error
        except socket.timeout:
            if not self._stop.is_set():
                self._channel_error = EphemeralLaunchTimeout(
                    "ephemeral request frame exceeded its deadline",
                    operation="broker",
                )
        except OSError:
            if not self._stop.is_set():
                self._channel_error = EphemeralLaunchProtocolError(
                    "ephemeral launch channel failed",
                    operation="broker",
                )
        finally:
            if self._channel_error is not None and not self._stop.is_set():
                with self._lock:
                    if self._state == EphemeralLaunchContextState.ACTIVE:
                        self._state = EphemeralLaunchContextState.CHANNEL_FAILED
            self._stop.set()
            self._close_endpoints()

    def _dispatch_request(self, request: Mapping[str, Any]) -> bytes:
        assert self._identity is not None
        request_id = request.get("requestId")
        supplied_digest = request.get("requestDigest")
        if not isinstance(request_id, str) or not request_id:
            raise EphemeralLaunchProtocolError(
                "request id is required",
                operation="invoke",
            )
        if not isinstance(supplied_digest, str):
            raise EphemeralLaunchProtocolError(
                "request digest is required",
                operation="invoke",
            )
        digest_payload = dict(request)
        digest_payload.pop("requestDigest", None)
        expected_digest = _digest(digest_payload)
        if supplied_digest != expected_digest:
            raise EphemeralLaunchProtocolError(
                "request digest does not match request",
                operation="invoke",
            )
        cached = self._response_cache.get(request_id)
        if cached is not None:
            cached_digest, cached_response = cached
            if cached_digest != supplied_digest:
                raise EphemeralLaunchProtocolError(
                    "request id was reused with a conflicting digest",
                    operation="invoke",
                )
            self._response_cache.move_to_end(request_id)
            return cached_response
        prior_digest = self._request_digests.get(request_id)
        if prior_digest is not None:
            raise EphemeralLaunchProtocolError(
                "request id was replayed after its response was evicted",
                operation="invoke",
            )
        if len(self._request_digests) >= self._max_request_ids:
            raise EphemeralLaunchProtocolError(
                "ephemeral launch context exhausted its request id budget",
                operation="invoke",
            )
        self._request_digests[request_id] = supplied_digest
        if any(request.get(key) != value for key, value in self._identity.items()):
            raise EphemeralLaunchHandshakeFailed(
                "request identity does not match launch context",
                operation="invoke",
            )

        capability_id = request.get("capability")
        operation = request.get("operation")
        payload = request.get("payload")
        timeout_seconds = request.get("timeoutSeconds")
        requested_deadline = request.get("deadlineMonotonic")
        if (
            not isinstance(capability_id, str)
            or capability_id not in self._handlers
            or not isinstance(operation, str)
            or not isinstance(payload, dict)
        ):
            raise EphemeralLaunchProtocolError(
                "request capability, operation, or payload is invalid",
                operation="invoke",
            )
        handler = self._handlers[capability_id]
        if operation not in handler.allowed_operations:
            raise EphemeralLaunchProtocolError(
                "requested operation is not allowlisted",
                operation="invoke",
            )
        if not _is_positive_finite_timeout(
            timeout_seconds
        ) or not _is_positive_finite_timeout(requested_deadline):
            raise EphemeralLaunchProtocolError(
                "request timeout is invalid",
                operation="invoke",
            )
        now = time.monotonic()
        translated_deadline = (
            float(requested_deadline) + self._child_monotonic_offset
        )
        deadline_monotonic = min(
            translated_deadline,
            now + min(float(timeout_seconds), self._request_timeout_seconds),
        )
        if deadline_monotonic <= now:
            response = _error_response(
                request_id,
                EphemeralLaunchTimeout.code,
                "capability request exceeded its deadline",
            )
        else:
            response = self._invoke_handler(
                handler,
                operation,
                payload,
                deadline_monotonic,
                request_id,
            )
        encoded = _encode_frame_payload(response, self._max_frame_bytes)
        self._response_cache[request_id] = (supplied_digest, encoded)
        self._response_cache.move_to_end(request_id)
        while len(self._response_cache) > self._max_cached_responses:
            self._response_cache.popitem(last=False)
        return encoded

    def _invoke_handler(
        self,
        handler: EphemeralCapabilityHandler,
        operation: str,
        payload: Mapping[str, object],
        deadline_monotonic: float,
        request_id: str,
    ) -> Mapping[str, object]:
        cancellation = threading.Event()
        outcome: dict[str, object] = {}

        def run_handler() -> None:
            try:
                result = handler.invoke(
                    operation,
                    MappingProxyType(dict(payload)),
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                if not isinstance(result, Mapping):
                    raise TypeError("handler result must be a mapping")
                outcome["result"] = dict(result)
            except EphemeralCapabilityBlocked as error:
                outcome["blocked"] = error
            except TimeoutError as error:
                outcome["timeout"] = error
            except BaseException as error:
                outcome["error"] = error

        worker = threading.Thread(
            target=run_handler,
            name="ephemeral-capability-handler",
            daemon=True,
        )
        with self._lock:
            if self._active_worker is not None and self._active_worker.is_alive():
                raise EphemeralLaunchProtocolError(
                    "ephemeral launch context already has an in-flight request",
                    operation="invoke",
                )
            self._active_cancellation = cancellation
            self._active_worker = worker
            self._active_handler = handler
            worker.start()
        worker.join(max(0.0, deadline_monotonic - time.monotonic()))
        if time.monotonic() >= deadline_monotonic:
            cancellation.set()
            return _error_response(
                request_id,
                EphemeralLaunchTimeout.code,
                "capability request exceeded its deadline",
            )
        with self._lock:
            self._active_cancellation = None
            self._active_worker = None
            self._active_handler = None
        if "timeout" in outcome:
            return _error_response(
                request_id,
                EphemeralLaunchTimeout.code,
                "capability request exceeded its deadline",
            )
        blocked = outcome.get("blocked")
        if isinstance(blocked, EphemeralCapabilityBlocked):
            projected = _project_handler_response(
                handler,
                operation,
                _blocked_response(request_id, blocked),
                request_id=request_id,
                expected_status="BLOCKED",
                sensitive_values=self._all_sensitive_values(),
            )
            projected_blocked = _blocked_error_from_response(projected)
            with self._lock:
                self._blocked_error = projected_blocked
            return projected
        if "error" in outcome:
            handler_error = outcome["error"]
            return _error_response(
                request_id,
                EphemeralLaunchProtocolError.code,
                f"capability handler failed: {type(handler_error).__name__}: {handler_error}",
            )
        return _project_handler_response(
            handler,
            operation,
            {
                "requestId": request_id,
                "status": "OK",
                "result": outcome.get("result", {}),
                "error": None,
            },
            request_id=request_id,
            expected_status="OK",
            sensitive_values=self._all_sensitive_values(),
        )

    def _all_sensitive_values(self) -> tuple[str, ...]:
        return tuple(
            dict.fromkeys(
                value
                for registered_handler in self._handlers.values()
                for value in registered_handler.sensitive_values
                if value
            )
        )

    def _close_endpoints(self) -> None:
        if self._binding is not None:
            self._binding.close_parent_copy()
        for endpoint_name in ("_parent_endpoint", "_child_endpoint"):
            endpoint = getattr(self, endpoint_name)
            if endpoint is not None:
                try:
                    endpoint.close()
                except OSError:
                    pass

    def _descriptors_closed(self) -> bool:
        return all(
            endpoint is None or endpoint.fileno() == -1
            for endpoint in (self._parent_endpoint, self._child_endpoint)
        )

    def _require_state(
        self,
        expected: EphemeralLaunchContextState,
        *,
        operation: str,
    ) -> None:
        if self._state != expected:
            raise EphemeralLaunchContextInvalid(
                f"{operation} requires state {expected.value}",
                operation=operation,
            )


class EphemeralGateClient:
    """Child-side typed client for one inherited launch-context descriptor."""

    def __init__(
        self,
        descriptor: int,
        *,
        workspace_id: str,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
        max_frame_bytes: int = DEFAULT_MAX_FRAME_BYTES,
    ) -> None:
        try:
            os.set_inheritable(descriptor, False)
            self._endpoint = socket.socket(fileno=descriptor)
        except (OSError, ValueError) as error:
            raise EphemeralLaunchBindFailed(
                "inherited ephemeral context descriptor is invalid",
                operation="client_bind",
            ) from error
        self._identity = {
            "workspaceId": _validate_name(workspace_id, field="workspace id"),
            "gateId": _validate_name(gate_id, field="gate id"),
            "evidenceRunId": _validate_name(
                evidence_run_id,
                field="evidence run id",
            ),
            "provisioningRunId": _validate_name(
                provisioning_run_id,
                field="provisioning run id",
            ),
        }
        self._max_frame_bytes = max_frame_bytes
        self._request_lock = threading.Lock()
        self._request_deadlines: OrderedDict[str, float] = OrderedDict()
        self._closed = False
        self._endpoint.settimeout(DEFAULT_REQUEST_TIMEOUT_SECONDS)
        self._handshake()

    @classmethod
    def from_environment(
        cls,
        environment: Optional[Mapping[str, str]] = None,
    ) -> Optional["EphemeralGateClient"]:
        source = os.environ if environment is None else environment
        raw_descriptor = source.get(EPHEMERAL_CONTEXT_FD_ENV)
        if raw_descriptor is None:
            return None
        try:
            descriptor = int(raw_descriptor)
        except (TypeError, ValueError) as error:
            raise EphemeralLaunchBindFailed(
                "ephemeral context descriptor locator is invalid",
                operation="client_bind",
            ) from error
        required_values = {
            "workspace_id": source.get(EPHEMERAL_CONTEXT_WORKSPACE_ENV, ""),
            "gate_id": source.get(EPHEMERAL_CONTEXT_GATE_ENV, ""),
            "evidence_run_id": source.get(
                EPHEMERAL_CONTEXT_EVIDENCE_RUN_ENV,
                "",
            ),
            "provisioning_run_id": source.get(
                EPHEMERAL_CONTEXT_PROVISIONING_RUN_ENV,
                "",
            ),
        }
        return cls(descriptor, **required_values)

    def invoke(
        self,
        capability_id: str,
        operation: str,
        payload: Mapping[str, object],
        *,
        timeout_seconds: float,
        request_id: Optional[str] = None,
    ) -> Mapping[str, object]:
        if self._closed:
            raise EphemeralLaunchProtocolError(
                "ephemeral launch client is closed",
                operation="invoke",
            )
        if not _is_positive_finite_timeout(timeout_seconds):
            raise EphemeralLaunchProtocolError(
                "request timeout is invalid",
                operation="invoke",
            )
        if not isinstance(payload, Mapping):
            raise EphemeralLaunchProtocolError(
                "request payload must be a mapping",
                operation="invoke",
            )
        if not self._request_lock.acquire(blocking=False):
            raise EphemeralLaunchProtocolError(
                "ephemeral launch client already has an in-flight request",
                operation="invoke",
            )
        try:
            actual_request_id = request_id or os.urandom(16).hex()
            deadline = self._request_deadlines.get(actual_request_id)
            if deadline is None:
                deadline = time.monotonic() + float(timeout_seconds)
                if request_id is not None:
                    self._request_deadlines[actual_request_id] = deadline
                    self._request_deadlines.move_to_end(actual_request_id)
                    while (
                        len(self._request_deadlines)
                        > DEFAULT_MAX_CACHED_RESPONSES
                    ):
                        self._request_deadlines.popitem(last=False)
            elif request_id is not None:
                self._request_deadlines.move_to_end(actual_request_id)
            request: dict[str, object] = {
                "requestId": actual_request_id,
                **self._identity,
                "capability": _validate_name(
                    capability_id,
                    field="capability id",
                ),
                "operation": _validate_name(operation, field="operation"),
                "payload": dict(payload),
                "timeoutSeconds": timeout_seconds,
                "deadlineMonotonic": deadline,
            }
            request["requestDigest"] = _digest(request)
            self._endpoint.settimeout(timeout_seconds)
            _send_frame(self._endpoint, request, self._max_frame_bytes)
            response = _recv_frame(
                self._endpoint,
                self._max_frame_bytes,
                deadline_monotonic=deadline,
            )
        except socket.timeout as error:
            self._close_transport()
            raise EphemeralLaunchTimeout(
                "ephemeral capability request timed out",
                operation="invoke",
            ) from error
        except (OSError, EOFError) as error:
            self._close_transport()
            raise EphemeralLaunchProtocolError(
                "ephemeral capability channel failed",
                operation="invoke",
            ) from error
        except EphemeralLaunchProtocolError:
            self._close_transport()
            raise
        finally:
            self._request_lock.release()
        if response.get("requestId") != actual_request_id:
            raise EphemeralLaunchProtocolError(
                "ephemeral capability response id does not match",
                operation="invoke",
            )
        response_status = response.get("status")
        if response_status != "OK":
            error_data = response.get("error")
            code = (
                error_data.get("code")
                if isinstance(error_data, dict)
                else EphemeralLaunchProtocolError.code
            )
            if (
                response_status == "BLOCKED"
                and code == EphemeralCapabilityBlocked.code
            ):
                reason = error_data.get("message")
                resource = error_data.get("resource", "")
                if not isinstance(reason, str) or not isinstance(resource, str):
                    raise EphemeralLaunchProtocolError(
                        "ephemeral capability blocked response is invalid",
                        operation="invoke",
                    )
                raise EphemeralCapabilityBlocked(
                    reason,
                    resource=resource,
                    operation="invoke",
                )
            if code == EphemeralLaunchTimeout.code:
                raise EphemeralLaunchTimeout(
                    "ephemeral capability request timed out",
                    operation="invoke",
                )
            detail = ""
            if isinstance(error_data, dict):
                detail = f": {error_data.get('message', '')}"
            raise EphemeralLaunchProtocolError(
                f"ephemeral capability request was rejected{detail}",
                operation="invoke",
            )
        result = response.get("result")
        if not isinstance(result, dict):
            raise EphemeralLaunchProtocolError(
                "ephemeral capability response result is invalid",
                operation="invoke",
            )
        return result

    def close(self) -> None:
        if self._closed:
            return
        with self._request_lock:
            if self._closed:
                return
            try:
                deadline = (
                    time.monotonic() + DEFAULT_REQUEST_TIMEOUT_SECONDS
                )
                self._endpoint.settimeout(DEFAULT_REQUEST_TIMEOUT_SECONDS)
                _send_frame(
                    self._endpoint,
                    {"type": "close", **self._identity},
                    self._max_frame_bytes,
                )
                response = _recv_frame(
                    self._endpoint,
                    self._max_frame_bytes,
                    deadline_monotonic=deadline,
                )
            except (OSError, EOFError) as error:
                self._close_transport()
                raise EphemeralLaunchProtocolError(
                    "ephemeral launch close acknowledgement failed",
                    operation="close",
                ) from error
            except EphemeralLaunchProtocolError:
                self._close_transport()
                raise
            if response != {"type": "close", "status": "OK"}:
                self._close_transport()
                raise EphemeralLaunchProtocolError(
                    "ephemeral launch close acknowledgement is invalid",
                    operation="close",
                )
            self._close_transport()

    def _close_transport(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._endpoint.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self._endpoint.close()

    def __enter__(self) -> "EphemeralGateClient":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def __reduce__(self) -> object:
        raise TypeError("ephemeral launch clients cannot be serialized")

    def __repr__(self) -> str:
        return "<EphemeralGateClient ephemeral>"

    def _handshake(self) -> None:
        request: dict[str, object] = {
            "type": "handshake",
            **self._identity,
            "childMonotonic": time.monotonic(),
            "childProcessId": os.getpid(),
        }
        try:
            deadline = time.monotonic() + DEFAULT_REQUEST_TIMEOUT_SECONDS
            _send_frame(self._endpoint, request, self._max_frame_bytes)
            response = _recv_frame(
                self._endpoint,
                self._max_frame_bytes,
                deadline_monotonic=deadline,
            )
        except (OSError, EOFError, EphemeralLaunchProtocolError) as error:
            self._close_transport()
            raise EphemeralLaunchHandshakeFailed(
                "ephemeral launch handshake failed",
                operation="handshake",
            ) from error
        if response != {"type": "handshake", "status": "OK"}:
            self._close_transport()
            raise EphemeralLaunchHandshakeFailed(
                "ephemeral launch handshake was rejected",
                operation="handshake",
            )


def _validate_name(value: str, *, field: str) -> str:
    if not isinstance(value, str) or not value or value.strip() != value:
        raise EphemeralLaunchContextInvalid(
            f"{field} must be a non-empty canonical string",
            operation="validate",
        )
    return value


def _validate_unique_names(
    values: tuple[str, ...],
    *,
    field: str,
    allow_empty: bool = False,
) -> tuple[str, ...]:
    if not isinstance(values, tuple) or (not values and not allow_empty):
        raise EphemeralLaunchContextInvalid(
            f"{field} must be a tuple"
            + ("" if allow_empty else " with at least one value"),
            operation="validate",
        )
    validated = tuple(_validate_name(value, field=field) for value in values)
    if len(set(validated)) != len(validated):
        raise EphemeralLaunchContextInvalid(
            f"{field} must not contain duplicates",
            operation="validate",
        )
    return validated


def _isolated_python_argv(argv: tuple[str, ...]) -> tuple[str, ...]:
    if len(argv) < 2 or not re.fullmatch(
        r"python(?:\d+(?:\.\d+)*)?",
        Path(argv[0]).name,
    ):
        raise EphemeralLaunchTransportUnsupported(
            "context-enabled Gate must use a Python module, script, or -c argv",
            operation="gate_process",
        )

    bootstrap = str(Path(__file__).with_name("_gate_bootstrap.py"))
    if argv[1] == "-m":
        if len(argv) < 3 or not re.fullmatch(
            r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*",
            argv[2],
        ):
            raise EphemeralLaunchContextInvalid(
                "context Gate module argv is invalid",
                operation="gate_process",
            )
        target = ("--module", argv[2], *argv[3:])
    elif argv[1] == "-c":
        if len(argv) < 3:
            raise EphemeralLaunchContextInvalid(
                "context Gate -c argv is missing code",
                operation="gate_process",
            )
        target = ("--code", argv[2], *argv[3:])
    elif not argv[1].startswith("-") and Path(argv[1]).suffix == ".py":
        target = ("--script", argv[1], *argv[2:])
    else:
        raise EphemeralLaunchTransportUnsupported(
            "context-enabled Gate must use a Python module, script, or -c argv",
            operation="gate_process",
        )
    executable = sys.executable if argv[0] in {"python", "python3"} else argv[0]
    return (executable, "-I", "-S", bootstrap, *target)


def _project_handler_response(
    handler: EphemeralCapabilityHandler,
    operation: str,
    response: Mapping[str, object],
    *,
    request_id: str,
    expected_status: str,
    sensitive_values: tuple[str, ...],
) -> Mapping[str, object]:
    try:
        projected = handler.project_response(
            operation,
            MappingProxyType(dict(response)),
        )
    except BaseException as error:
        raise EphemeralLaunchProtocolError(
            "capability response projection failed",
            operation="invoke",
        ) from error
    if not isinstance(projected, Mapping):
        raise EphemeralLaunchProtocolError(
            "capability response projection must return a mapping",
            operation="invoke",
        )

    envelope = dict(projected)
    _validate_projected_response(
        envelope,
        request_id=request_id,
        expected_status=expected_status,
    )
    validated_sensitive_values = _validate_unique_names(
        sensitive_values,
        field="sensitive values",
        allow_empty=True,
    )
    if _contains_sensitive_value(envelope, validated_sensitive_values):
        raise EphemeralLaunchProtocolError(
            "capability response contains a declared sensitive value",
            operation="invoke",
        )
    return envelope


def _validate_projected_response(
    response: Mapping[str, object],
    *,
    request_id: str,
    expected_status: str,
) -> None:
    if set(response) != {"requestId", "status", "result", "error"}:
        raise EphemeralLaunchProtocolError(
            "capability response projection has an invalid envelope",
            operation="invoke",
        )
    if (
        response.get("requestId") != request_id
        or response.get("status") != expected_status
    ):
        raise EphemeralLaunchProtocolError(
            "capability response projection changed envelope identity or status",
            operation="invoke",
        )
    result = response.get("result")
    error = response.get("error")
    if not isinstance(result, Mapping):
        raise EphemeralLaunchProtocolError(
            "capability response projection result is invalid",
            operation="invoke",
        )
    if expected_status == "OK":
        if error is not None:
            raise EphemeralLaunchProtocolError(
                "successful capability response projection contains an error",
                operation="invoke",
            )
        return
    if result or not isinstance(error, Mapping):
        raise EphemeralLaunchProtocolError(
            "blocked capability response projection is invalid",
            operation="invoke",
        )
    if error.get("code") != EphemeralCapabilityBlocked.code:
        raise EphemeralLaunchProtocolError(
            "blocked capability response projection changed its error code",
            operation="invoke",
        )
    if not isinstance(error.get("message"), str):
        raise EphemeralLaunchProtocolError(
            "blocked capability response projection message is invalid",
            operation="invoke",
        )
    if "resource" in error and not isinstance(error.get("resource"), str):
        raise EphemeralLaunchProtocolError(
            "blocked capability response projection resource is invalid",
            operation="invoke",
        )


def _blocked_error_from_response(
    response: Mapping[str, object],
) -> EphemeralCapabilityBlocked:
    error = response["error"]
    assert isinstance(error, Mapping)
    reason = error["message"]
    resource = error.get("resource", "")
    assert isinstance(reason, str)
    assert isinstance(resource, str)
    return EphemeralCapabilityBlocked(
        reason,
        resource=resource,
        operation="invoke",
    )


def _contains_sensitive_value(
    value: object,
    sensitive_values: tuple[str, ...],
) -> bool:
    if isinstance(value, str):
        return any(sensitive in value for sensitive in sensitive_values)
    if isinstance(value, Mapping):
        return any(
            _contains_sensitive_value(key, sensitive_values)
            or _contains_sensitive_value(item, sensitive_values)
            for key, item in value.items()
        )
    if isinstance(value, (list, tuple)):
        return any(
            _contains_sensitive_value(item, sensitive_values)
            for item in value
        )
    return False


def _digest(payload: Mapping[str, object]) -> str:
    try:
        encoded = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise EphemeralLaunchProtocolError(
            "ephemeral capability payload is not serializable",
            operation="frame",
        ) from error
    return hashlib.sha256(encoded).hexdigest()


def _encode_frame_payload(
    payload: Mapping[str, object],
    max_frame_bytes: int,
) -> bytes:
    try:
        encoded = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise EphemeralLaunchProtocolError(
            "ephemeral launch frame is not serializable",
            operation="frame",
        ) from error
    if not encoded or len(encoded) > max_frame_bytes:
        raise EphemeralLaunchProtocolError(
            "ephemeral launch frame exceeds its byte budget",
            operation="frame",
        )
    return encoded


def _send_frame(
    endpoint: socket.socket,
    payload: Mapping[str, object],
    max_frame_bytes: int,
) -> None:
    _send_encoded_frame(
        endpoint,
        _encode_frame_payload(payload, max_frame_bytes),
        max_frame_bytes,
    )


def _send_encoded_frame(
    endpoint: socket.socket,
    encoded: bytes,
    max_frame_bytes: int,
) -> None:
    if not encoded or len(encoded) > max_frame_bytes:
        raise EphemeralLaunchProtocolError(
            "ephemeral launch frame exceeds its byte budget",
            operation="frame",
        )
    endpoint.sendall(_LENGTH_PREFIX.pack(len(encoded)) + encoded)


def _recv_frame(
    endpoint: socket.socket,
    max_frame_bytes: int,
    *,
    stop: Optional[threading.Event] = None,
    deadline_monotonic: Optional[float] = None,
    frame_timeout_seconds: Optional[float] = None,
) -> Mapping[str, Any]:
    if deadline_monotonic is not None and frame_timeout_seconds is not None:
        raise ValueError("frame deadline and timeout are mutually exclusive")
    if frame_timeout_seconds is None:
        prefix = _recv_exact(
            endpoint,
            _LENGTH_PREFIX.size,
            stop=stop,
            deadline_monotonic=deadline_monotonic,
        )
    else:
        first_byte = _recv_exact(
            endpoint,
            1,
            stop=stop,
            deadline_monotonic=None,
        )
        deadline_monotonic = time.monotonic() + frame_timeout_seconds
        prefix = first_byte + _recv_exact(
            endpoint,
            _LENGTH_PREFIX.size - 1,
            stop=stop,
            deadline_monotonic=deadline_monotonic,
        )
    (length,) = _LENGTH_PREFIX.unpack(prefix)
    if length < 1 or length > max_frame_bytes:
        raise EphemeralLaunchProtocolError(
            "ephemeral launch frame length is invalid",
            operation="frame",
        )
    encoded = _recv_exact(
        endpoint,
        length,
        stop=stop,
        deadline_monotonic=deadline_monotonic,
    )
    try:
        payload = json.loads(encoded.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise EphemeralLaunchProtocolError(
            "ephemeral launch frame is malformed",
            operation="frame",
        ) from error
    if not isinstance(payload, dict):
        raise EphemeralLaunchProtocolError(
            "ephemeral launch frame must contain an object",
            operation="frame",
        )
    return payload


def _is_positive_finite_timeout(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value > 0
    )


def _recv_exact(
    endpoint: socket.socket,
    size: int,
    *,
    stop: Optional[threading.Event],
    deadline_monotonic: Optional[float],
) -> bytes:
    chunks = bytearray()
    original_timeout = endpoint.gettimeout()
    try:
        while len(chunks) < size:
            if stop is not None and stop.is_set():
                raise EOFError
            if deadline_monotonic is not None:
                remaining_seconds = deadline_monotonic - time.monotonic()
                if remaining_seconds <= 0:
                    raise socket.timeout
                endpoint.settimeout(
                    remaining_seconds
                    if original_timeout is None
                    else min(original_timeout, remaining_seconds)
                )
            try:
                chunk = endpoint.recv(size - len(chunks))
            except socket.timeout:
                if (
                    deadline_monotonic is not None
                    and time.monotonic() >= deadline_monotonic
                ):
                    raise
                continue
            if not chunk:
                raise EOFError
            chunks.extend(chunk)
        return bytes(chunks)
    finally:
        try:
            endpoint.settimeout(original_timeout)
        except OSError:
            pass


def _error_response(
    request_id: str,
    code: str,
    message: str,
) -> Mapping[str, object]:
    return {
        "requestId": request_id,
        "status": "ERROR",
        "result": {},
        "error": {"code": code, "message": message},
    }


def _blocked_response(
    request_id: str,
    error: EphemeralCapabilityBlocked,
) -> Mapping[str, object]:
    error_data = {
        "code": error.code,
        "message": error.reason,
    }
    if error.resource:
        error_data["resource"] = error.resource
    return {
        "requestId": request_id,
        "status": "BLOCKED",
        "result": {},
        "error": error_data,
    }


def _bounded_handler_quarantine(
    handler: EphemeralCapabilityHandler,
    *,
    reason: str,
    timeout_seconds: float,
) -> bool:
    outcome: dict[str, object] = {}
    deadline = time.monotonic() + timeout_seconds

    def quarantine_handler() -> None:
        try:
            outcome["result"] = handler.quarantine(
                reason,
                deadline_monotonic=deadline,
            )
        except BaseException:
            outcome["failed"] = True

    worker = threading.Thread(
        target=quarantine_handler,
        name="ephemeral-capability-quarantine",
        daemon=True,
    )
    worker.start()
    worker.join(timeout_seconds)
    return (
        not worker.is_alive()
        and not outcome.get("failed")
        and outcome.get("result") is True
    )


def _bounded_handler_close(
    handler: EphemeralCapabilityHandler,
    timeout_seconds: float,
) -> EphemeralHandlerCleanup:
    outcome: dict[str, object] = {}

    def close_handler() -> None:
        try:
            outcome["result"] = handler.close()
        except BaseException:
            outcome["failed"] = True

    worker = threading.Thread(
        target=close_handler,
        name="ephemeral-capability-close",
        daemon=True,
    )
    worker.start()
    worker.join(timeout_seconds)
    result = outcome.get("result")
    if worker.is_alive() or outcome.get("failed") or not isinstance(
        result,
        EphemeralHandlerCleanup,
    ):
        raise EphemeralLaunchCleanupFailed(
            "capability handler cleanup failed",
            operation="handler_close",
        )
    return result
