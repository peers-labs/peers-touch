from __future__ import annotations

import json
import os
import pickle
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from typing import Mapping
from unittest.mock import MagicMock, call, patch

import tooling.acceptance.core.launch_context as launch_context_module
from tooling.acceptance.core import (
    EPHEMERAL_CONTEXT_FD_ENV,
    EphemeralCapabilityBlocked,
    EphemeralCapabilityHandler,
    EphemeralCleanupResult,
    EphemeralGateClient,
    EphemeralGateLaunchContext,
    EphemeralHandlerCleanup,
    EphemeralLaunchBindFailed,
    EphemeralLaunchCleanupFailed,
    EphemeralLaunchContextInvalid,
    EphemeralLaunchContextState,
    EphemeralLaunchHandshakeFailed,
    EphemeralLaunchProtocolError,
    EphemeralLaunchTimeout,
    EphemeralLaunchTransportUnsupported,
    GateLaunchSpec,
    GateProcessLauncher,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
IDENTITY = {
    "workspace_id": "synthetic-workspace",
    "gate_id": "synthetic-gate",
    "evidence_run_id": "evidence-run-a",
    "provisioning_run_id": "provisioning-run-b",
}


def controlled_child_environment() -> dict[str, str]:
    return {}


class SyntheticHandler(EphemeralCapabilityHandler):
    def __init__(self, *, secret: str = "parent-only-canary") -> None:
        self.secret = bytearray(secret.encode("utf-8"))
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.closed = False
        self.quarantine_calls: list[tuple[str, float]] = []
        self.projected_statuses: list[str] = []

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return ("echo", "derive")

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return (self.secret.decode("utf-8"),)

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        self.calls.append((operation, dict(payload)))
        if operation == "derive":
            return {"accepted": bool(self.secret), "deadlineSet": deadline_monotonic > 0}
        return {"echo": dict(payload)}

    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        self.projected_statuses.append(str(response.get("status")))
        return response

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        self.quarantine_calls.append((reason, deadline_monotonic))
        return True

    def close(self) -> EphemeralHandlerCleanup:
        for index in range(len(self.secret)):
            self.secret[index] = 0
        self.closed = True
        return EphemeralHandlerCleanup(closed=True, secrets_zeroized=not any(self.secret))


class BlockingHandler(SyntheticHandler):
    def __init__(self) -> None:
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()
        self.cancelled = threading.Event()

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return ("block",)

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        self.started.set()
        while not self.release.wait(0.01):
            if cancellation.is_set():
                self.cancelled.set()
                return {"cancelled": True}
        return {"released": True}


class DeadlineRecordingHandler(SyntheticHandler):
    def __init__(self) -> None:
        super().__init__()
        self.deadlines: list[float] = []
        self.dispatch_times: list[float] = []

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        self.deadlines.append(deadline_monotonic)
        self.dispatch_times.append(time.monotonic())
        return super().invoke(
            operation,
            payload,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )


class SynchronousTimeoutHandler(SyntheticHandler):
    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        self.calls.append((operation, dict(payload)))
        if payload.get("timeout"):
            raise TimeoutError("synthetic synchronous timeout")
        return {"accepted": True}


class UnresponsiveHandler(BlockingHandler):
    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        self.started.set()
        self.release.wait()
        return {"released": True}


class FailedCleanupHandler(SyntheticHandler):
    def close(self) -> EphemeralHandlerCleanup:
        return EphemeralHandlerCleanup(closed=False, secrets_zeroized=False)


class BlockedHandler(SyntheticHandler):
    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        raise EphemeralCapabilityBlocked(
            "synthetic capability is busy",
            resource="synthetic-resource",
        )


class SecretResultHandler(SyntheticHandler):
    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        return {"nested": {"leaked": self.secret.decode("utf-8")}}


class CrossHandlerSecretResultHandler(SecretResultHandler):
    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return ()


class SecretBlockedMetadataHandler(SyntheticHandler):
    def __init__(self) -> None:
        super().__init__()
        self.raw_blocked_error: EphemeralCapabilityBlocked | None = None

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        secret = self.secret.decode("utf-8")
        self.raw_blocked_error = EphemeralCapabilityBlocked(
            f"blocked by {secret}",
            resource=f"resource:{secret}",
        )
        raise self.raw_blocked_error


class SanitizedBlockedMetadataHandler(SecretBlockedMetadataHandler):
    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        self.projected_statuses.append(str(response.get("status")))
        return {
            "requestId": response["requestId"],
            "status": response["status"],
            "result": {},
            "error": {
                "code": EphemeralCapabilityBlocked.code,
                "message": "synthetic capability is unavailable",
                "resource": "sanitized-resource",
            },
        }


def new_context(
    handler: EphemeralCapabilityHandler,
    **kwargs: object,
) -> EphemeralGateLaunchContext:
    context = EphemeralGateLaunchContext(
        required_capabilities=("synthetic.echo",),
        **kwargs,
    )
    context.register_capability("synthetic.echo", handler)
    context.seal(**IDENTITY)
    return context


def connect_client(
    context: EphemeralGateLaunchContext,
) -> tuple[EphemeralGateClient, object]:
    binding = context.bind_child()
    child_descriptor = os.dup(binding.pass_fds[0])
    context.activate()
    binding.close_parent_copy()
    client = EphemeralGateClient(child_descriptor, **IDENTITY)
    return client, binding


def close_context(
    context: EphemeralGateLaunchContext,
    client: EphemeralGateClient | None = None,
) -> EphemeralCleanupResult:
    if client is not None:
        client.close()
    context.quiesce()
    return context.close()


def receive_test_frame(endpoint: socket.socket) -> dict[str, object]:
    prefix = endpoint.recv(4)
    if len(prefix) != 4:
        raise AssertionError("test peer did not receive a frame prefix")
    size = struct.unpack("!I", prefix)[0]
    body = bytearray()
    while len(body) < size:
        chunk = endpoint.recv(size - len(body))
        if not chunk:
            raise AssertionError("test peer received an incomplete frame")
        body.extend(chunk)
    value = json.loads(bytes(body).decode("utf-8"))
    if not isinstance(value, dict):
        raise AssertionError("test peer received a non-object frame")
    return value


def send_test_frame(
    endpoint: socket.socket,
    payload: Mapping[str, object],
) -> None:
    encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    endpoint.sendall(struct.pack("!I", len(encoded)) + encoded)


def wait_for_pid_file(path: Path, timeout_seconds: float = 3) -> int:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if path.exists():
            return int(path.read_text(encoding="utf-8"))
        time.sleep(0.01)
    raise AssertionError(f"descendant pid file was not created: {path}")


def wait_for_pid_exit(pid: int, timeout_seconds: float = 3) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        time.sleep(0.01)
    return False


class LaunchContextContractTests(unittest.TestCase):
    def test_launch_boundaries_reject_non_finite_timeouts(self) -> None:
        for invalid_timeout in (float("nan"), float("inf")):
            with self.subTest(
                boundary="gate-spec",
                invalid_timeout=invalid_timeout,
            ), self.assertRaises(EphemeralLaunchContextInvalid):
                GateLaunchSpec(
                    argv=(sys.executable, "-c", "pass"),
                    timeout_seconds=invalid_timeout,
                    required_capabilities=(),
                )

            with self.subTest(
                boundary="process-launcher",
                invalid_timeout=invalid_timeout,
            ), self.assertRaises(EphemeralLaunchContextInvalid):
                GateProcessLauncher(
                    termination_timeout_seconds=invalid_timeout,
                )

            for timeout_name in (
                "request_timeout_seconds",
                "quiesce_timeout_seconds",
            ):
                with self.subTest(
                    boundary=timeout_name,
                    invalid_timeout=invalid_timeout,
                ), self.assertRaises(EphemeralLaunchContextInvalid):
                    EphemeralGateLaunchContext(
                        required_capabilities=("synthetic.echo",),
                        **{timeout_name: invalid_timeout},
                    )

    def test_registry_must_exactly_match_before_seal(self) -> None:
        context = EphemeralGateLaunchContext(
            required_capabilities=("synthetic.echo", "synthetic.other"),
        )
        context.register_capability("synthetic.echo", SyntheticHandler())

        with self.assertRaises(EphemeralLaunchContextInvalid):
            context.seal(**IDENTITY)

        self.assertEqual(context.state, EphemeralLaunchContextState.CREATED)

    def test_registry_rejects_duplicate_and_post_seal_registration(self) -> None:
        context = EphemeralGateLaunchContext(
            required_capabilities=("synthetic.echo",),
        )
        context.register_capability("synthetic.echo", SyntheticHandler())
        with self.assertRaises(EphemeralLaunchContextInvalid):
            context.register_capability("synthetic.echo", SyntheticHandler())

        context.seal(**IDENTITY)
        with self.assertRaises(EphemeralLaunchContextInvalid):
            context.register_capability("synthetic.other", SyntheticHandler())

    def test_context_handler_and_binding_are_not_serializable(self) -> None:
        handler = SyntheticHandler()
        context = new_context(handler)
        binding = context.bind_child()

        for value in (handler, context, binding):
            with self.subTest(value=type(value).__name__):
                with self.assertRaises(TypeError):
                    pickle.dumps(value)

        binding.close_parent_copy()
        context.quiesce()
        context.close()
        self.assertNotIn("parent-only-canary", repr(context))
        self.assertNotIn("parent-only-canary", repr(handler))

    @unittest.skipUnless(os.name == "posix", "POSIX socketpair contract")
    def test_binding_projects_one_non_inheritable_descriptor(self) -> None:
        context = new_context(SyntheticHandler())
        binding = context.bind_child()

        self.assertEqual(len(binding.pass_fds), 1)
        self.assertFalse(os.get_inheritable(binding.pass_fds[0]))
        self.assertEqual(
            binding.environment[EPHEMERAL_CONTEXT_FD_ENV],
            str(binding.pass_fds[0]),
        )

        binding.close_parent_copy()
        context.quiesce()
        result = context.close()
        self.assertTrue(result.succeeded)

    def test_unsupported_backend_fails_before_binding(self) -> None:
        context = new_context(SyntheticHandler(), platform="nt")

        with self.assertRaises(EphemeralLaunchTransportUnsupported):
            context.bind_child()

        self.assertEqual(context.state, EphemeralLaunchContextState.BIND_FAILED)


@unittest.skipUnless(os.name == "posix", "POSIX socketpair contract")
class LaunchContextProtocolTests(unittest.TestCase):
    def test_silent_peer_cannot_stall_handshake_past_deadline(self) -> None:
        parent_endpoint, child_endpoint = socket.socketpair()
        descriptor = child_endpoint.detach()
        started = time.monotonic()
        try:
            with patch(
                "tooling.acceptance.core.launch_context."
                "DEFAULT_REQUEST_TIMEOUT_SECONDS",
                0.05,
            ), self.assertRaises(EphemeralLaunchHandshakeFailed):
                EphemeralGateClient(descriptor, **IDENTITY)
        finally:
            parent_endpoint.close()

        self.assertLess(time.monotonic() - started, 0.5)

    def test_partial_response_cannot_stall_invoke_past_deadline(self) -> None:
        parent_endpoint, child_endpoint = socket.socketpair()
        descriptor = child_endpoint.detach()
        release = threading.Event()
        failures: list[BaseException] = []

        def serve_partial_response() -> None:
            try:
                parent_endpoint.settimeout(1)
                receive_test_frame(parent_endpoint)
                send_test_frame(
                    parent_endpoint,
                    {"type": "handshake", "status": "OK"},
                )
                request = receive_test_frame(parent_endpoint)
                response = json.dumps(
                    {
                        "requestId": request["requestId"],
                        "status": "OK",
                        "result": {},
                        "error": {},
                    },
                    separators=(",", ":"),
                ).encode("utf-8")
                parent_endpoint.sendall(
                    struct.pack("!I", len(response)) + response[:1]
                )
                release.wait(1)
            except BaseException as error:
                failures.append(error)

        peer = threading.Thread(target=serve_partial_response, daemon=True)
        peer.start()
        client = EphemeralGateClient(descriptor, **IDENTITY)
        started = time.monotonic()
        try:
            with self.assertRaises(EphemeralLaunchTimeout):
                client.invoke(
                    "synthetic.echo",
                    "echo",
                    {},
                    timeout_seconds=0.05,
                )
        finally:
            release.set()
            parent_endpoint.close()
            peer.join(1)

        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual(failures, [])

    def test_partial_request_cannot_stall_parent_broker_past_deadline(
        self,
    ) -> None:
        handler = SyntheticHandler()
        context = new_context(handler, request_timeout_seconds=0.05)
        binding = context.bind_child()
        child_descriptor = os.dup(binding.pass_fds[0])
        context.activate()
        binding.close_parent_copy()
        endpoint = socket.socket(fileno=child_descriptor)
        try:
            send_test_frame(
                endpoint,
                {
                    "type": "handshake",
                    "workspaceId": IDENTITY["workspace_id"],
                    "gateId": IDENTITY["gate_id"],
                    "evidenceRunId": IDENTITY["evidence_run_id"],
                    "provisioningRunId": IDENTITY["provisioning_run_id"],
                },
            )
            self.assertEqual(
                receive_test_frame(endpoint),
                {"type": "handshake", "status": "OK"},
            )

            started = time.monotonic()
            endpoint.sendall(struct.pack("!I", 64) + b"{")
            deadline = time.monotonic() + 0.5
            while context.channel_error is None and time.monotonic() < deadline:
                time.sleep(0.01)
        finally:
            endpoint.close()

        self.assertLess(time.monotonic() - started, 0.5)
        self.assertIsInstance(context.channel_error, EphemeralLaunchTimeout)
        self.assertEqual(handler.calls, [])
        context.quiesce()
        self.assertTrue(context.close().succeeded)

    def test_partial_acknowledgement_cannot_stall_close_past_deadline(
        self,
    ) -> None:
        parent_endpoint, child_endpoint = socket.socketpair()
        descriptor = child_endpoint.detach()
        release = threading.Event()
        failures: list[BaseException] = []

        def serve_partial_close() -> None:
            try:
                parent_endpoint.settimeout(1)
                receive_test_frame(parent_endpoint)
                send_test_frame(
                    parent_endpoint,
                    {"type": "handshake", "status": "OK"},
                )
                receive_test_frame(parent_endpoint)
                response = b'{"type":"close","status":"OK"}'
                parent_endpoint.sendall(
                    struct.pack("!I", len(response)) + response[:1]
                )
                release.wait(1)
            except BaseException as error:
                failures.append(error)

        peer = threading.Thread(target=serve_partial_close, daemon=True)
        peer.start()
        try:
            with patch(
                "tooling.acceptance.core.launch_context."
                "DEFAULT_REQUEST_TIMEOUT_SECONDS",
                0.05,
            ):
                client = EphemeralGateClient(descriptor, **IDENTITY)
                started = time.monotonic()
                with self.assertRaises(EphemeralLaunchProtocolError):
                    client.close()
        finally:
            release.set()
            parent_endpoint.close()
            peer.join(1)

        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual(failures, [])

    def test_client_invokes_allowlisted_operation_and_replays_cached_response(self) -> None:
        handler = SyntheticHandler()
        context = new_context(handler)
        client, _binding = connect_client(context)

        first = client.invoke(
            "synthetic.echo",
            "echo",
            {"value": 7},
            timeout_seconds=1,
            request_id="request-a",
        )
        replay = client.invoke(
            "synthetic.echo",
            "echo",
            {"value": 7},
            timeout_seconds=1,
            request_id="request-a",
        )

        self.assertEqual(first, {"echo": {"value": 7}})
        self.assertEqual(replay, first)
        self.assertEqual(len(handler.calls), 1)
        self.assertEqual(handler.projected_statuses, ["OK"])
        self.assertTrue(close_context(context, client).succeeded)

    def test_child_absolute_deadline_is_preserved_through_request_frame(
        self,
    ) -> None:
        handler = DeadlineRecordingHandler()
        context = new_context(handler, request_timeout_seconds=2)
        client, _binding = connect_client(context)
        wire_deadlines: list[float] = []
        original_send_frame = launch_context_module._send_frame

        def delayed_send_frame(
            endpoint: socket.socket,
            payload: Mapping[str, object],
            max_frame_bytes: int,
        ) -> None:
            if payload.get("operation") == "echo":
                wire_deadlines.append(float(payload["deadlineMonotonic"]))
                time.sleep(0.05)
            original_send_frame(endpoint, payload, max_frame_bytes)

        with patch.object(
            launch_context_module,
            "_send_frame",
            side_effect=delayed_send_frame,
        ):
            result = client.invoke(
                "synthetic.echo",
                "echo",
                {},
                timeout_seconds=0.5,
            )

        self.assertEqual(result, {"echo": {}})
        self.assertEqual(handler.deadlines, wire_deadlines)
        self.assertLess(handler.dispatch_times[0], handler.deadlines[0])
        self.assertTrue(close_context(context, client).succeeded)

    def test_cross_process_deadline_translates_to_parent_monotonic_clock(
        self,
    ) -> None:
        handler = DeadlineRecordingHandler()
        context = new_context(handler, request_timeout_seconds=1_000)
        assert context._identity is not None
        parent_deadline = time.monotonic() + 100
        child_monotonic_offset = min(500.0, parent_deadline / 2)
        child_deadline = parent_deadline - child_monotonic_offset
        context._child_monotonic_offset = child_monotonic_offset
        request: dict[str, object] = {
            "requestId": "cross-process-clock",
            **context._identity,
            "capability": "synthetic.echo",
            "operation": "echo",
            "payload": {},
            "timeoutSeconds": 1_000,
            "deadlineMonotonic": child_deadline,
        }
        request["requestDigest"] = launch_context_module._digest(request)

        encoded = context._dispatch_request(request)
        response = json.loads(encoded.decode("utf-8"))

        self.assertEqual(response["status"], "OK")
        self.assertGreater(child_deadline, 0)
        self.assertEqual(handler.deadlines, [parent_deadline])

    def test_request_expired_on_arrival_returns_encoded_typed_timeout(
        self,
    ) -> None:
        handler = SyntheticHandler()
        context = new_context(handler)
        assert context._identity is not None
        request: dict[str, object] = {
            "requestId": "expired-on-arrival",
            **context._identity,
            "capability": "synthetic.echo",
            "operation": "echo",
            "payload": {},
            "timeoutSeconds": 1,
            "deadlineMonotonic": time.monotonic() - 0.01,
        }
        request["requestDigest"] = launch_context_module._digest(request)

        encoded = context._dispatch_request(request)
        response = json.loads(encoded.decode("utf-8"))

        self.assertEqual(response["status"], "ERROR")
        self.assertEqual(
            response["error"]["code"],
            EphemeralLaunchTimeout.code,
        )
        self.assertEqual(handler.calls, [])

    def test_synchronous_handler_timeout_is_typed_for_child(self) -> None:
        handler = SynchronousTimeoutHandler()
        context = new_context(handler)
        client, _binding = connect_client(context)

        with self.assertRaises(EphemeralLaunchTimeout) as raised:
            client.invoke(
                "synthetic.echo",
                "echo",
                {"timeout": True},
                timeout_seconds=1,
            )

        self.assertEqual(raised.exception.code, "EPHEMERAL_LAUNCH_TIMEOUT")
        self.assertEqual(raised.exception.operation, "invoke")
        self.assertTrue(close_context(context, client).succeeded)

    def test_synchronous_timeout_clears_worker_for_next_request(self) -> None:
        handler = SynchronousTimeoutHandler()
        context = new_context(handler)
        client, _binding = connect_client(context)

        with self.assertRaises(EphemeralLaunchTimeout):
            client.invoke(
                "synthetic.echo",
                "echo",
                {"timeout": True},
                timeout_seconds=1,
            )

        self.assertIsNone(context._active_worker)
        self.assertIsNone(context._active_cancellation)
        self.assertIsNone(context._active_handler)
        self.assertEqual(
            client.invoke(
                "synthetic.echo",
                "echo",
                {"timeout": False},
                timeout_seconds=1,
            ),
            {"accepted": True},
        )
        self.assertEqual(len(handler.calls), 2)
        self.assertTrue(close_context(context, client).succeeded)

    def test_handler_completion_after_absolute_deadline_is_rejected(self) -> None:
        context = new_context(SyntheticHandler())

        with patch.object(
            launch_context_module.time,
            "monotonic",
            side_effect=(10.5, 11.1),
        ):
            response = context._invoke_handler(
                context._handlers["synthetic.echo"],
                "echo",
                {},
                11.0,
                "late-completion",
            )

        self.assertEqual(response["status"], "ERROR")
        self.assertEqual(
            response["error"]["code"],
            EphemeralLaunchTimeout.code,
        )

    def test_conflicting_replay_fails_closed_without_second_handler_call(self) -> None:
        handler = SyntheticHandler()
        context = new_context(handler)
        client, _binding = connect_client(context)
        client.invoke(
            "synthetic.echo",
            "echo",
            {"value": 1},
            timeout_seconds=1,
            request_id="request-a",
        )

        with self.assertRaises(EphemeralLaunchProtocolError):
            client.invoke(
                "synthetic.echo",
                "echo",
                {"value": 2},
                timeout_seconds=1,
                request_id="request-a",
            )

        self.assertEqual(len(handler.calls), 1)
        close_context(context, client)

    def test_unknown_capability_and_operation_fail_closed(self) -> None:
        for capability, operation in (
            ("synthetic.unknown", "echo"),
            ("synthetic.echo", "unknown"),
        ):
            with self.subTest(capability=capability, operation=operation):
                context = new_context(SyntheticHandler())
                client, _binding = connect_client(context)
                with self.assertRaises(EphemeralLaunchProtocolError):
                    client.invoke(
                        capability,
                        operation,
                        {},
                        timeout_seconds=1,
                    )
                close_context(context, client)

    def test_handler_blocked_response_preserves_typed_blocked_semantics(self) -> None:
        handler = BlockedHandler()
        context = new_context(handler)
        client, _binding = connect_client(context)

        with self.assertRaises(EphemeralCapabilityBlocked) as raised:
            client.invoke(
                "synthetic.echo",
                "echo",
                {},
                timeout_seconds=1,
            )

        self.assertEqual(raised.exception.reason, "synthetic capability is busy")
        self.assertEqual(raised.exception.resource, "synthetic-resource")
        self.assertEqual(raised.exception.code, "EPHEMERAL_CAPABILITY_BLOCKED")
        self.assertEqual(handler.projected_statuses, ["BLOCKED"])
        self.assertTrue(close_context(context, client).succeeded)

    def test_secret_in_projected_success_result_closes_channel_before_frame(self) -> None:
        context = new_context(SecretResultHandler())
        client, _binding = connect_client(context)

        with self.assertRaises(EphemeralLaunchProtocolError):
            client.invoke(
                "synthetic.echo",
                "echo",
                {},
                timeout_seconds=1,
            )

        self.assertIsInstance(context.channel_error, EphemeralLaunchProtocolError)
        self.assertTrue(close_context(context).succeeded)

    def test_sensitive_values_are_scanned_across_all_registered_handlers(
        self,
    ) -> None:
        secret = "cross-handler-secret-canary"
        context = EphemeralGateLaunchContext(
            required_capabilities=("synthetic.echo", "synthetic.secret-owner"),
        )
        context.register_capability(
            "synthetic.echo",
            CrossHandlerSecretResultHandler(secret=secret),
        )
        context.register_capability(
            "synthetic.secret-owner",
            SyntheticHandler(secret=secret),
        )
        context.seal(**IDENTITY)
        client, _binding = connect_client(context)

        with self.assertRaises(EphemeralLaunchProtocolError):
            client.invoke(
                "synthetic.echo",
                "echo",
                {},
                timeout_seconds=1,
            )

        self.assertIsInstance(context.channel_error, EphemeralLaunchProtocolError)
        self.assertTrue(close_context(context).succeeded)

    def test_secret_in_projected_blocked_metadata_closes_channel_before_frame(self) -> None:
        context = new_context(SecretBlockedMetadataHandler())
        client, _binding = connect_client(context)

        with self.assertRaises(EphemeralLaunchProtocolError):
            client.invoke(
                "synthetic.echo",
                "echo",
                {},
                timeout_seconds=1,
            )

        self.assertIsInstance(context.channel_error, EphemeralLaunchProtocolError)
        self.assertIsNone(context.blocked_error)
        self.assertTrue(close_context(context).succeeded)

    def test_parent_blocked_error_contains_only_scanned_projected_metadata(self) -> None:
        handler = SanitizedBlockedMetadataHandler()
        context = new_context(handler)
        client, _binding = connect_client(context)

        with self.assertRaises(EphemeralCapabilityBlocked) as raised:
            client.invoke(
                "synthetic.echo",
                "echo",
                {},
                timeout_seconds=1,
            )

        blocked_error = context.blocked_error
        self.assertIsInstance(blocked_error, EphemeralCapabilityBlocked)
        assert blocked_error is not None
        self.assertEqual(
            (blocked_error.reason, blocked_error.resource),
            ("synthetic capability is unavailable", "sanitized-resource"),
        )
        self.assertEqual(
            (raised.exception.reason, raised.exception.resource),
            ("synthetic capability is unavailable", "sanitized-resource"),
        )
        assert handler.raw_blocked_error is not None
        self.assertIn("parent-only-canary", handler.raw_blocked_error.reason)
        self.assertIn("parent-only-canary", handler.raw_blocked_error.resource)
        self.assertIsNot(blocked_error, handler.raw_blocked_error)
        self.assertNotIn("parent-only-canary", blocked_error.reason)
        self.assertNotIn("parent-only-canary", blocked_error.resource)
        self.assertTrue(close_context(context, client).succeeded)

    def test_each_identity_dimension_rejects_handshake_mismatch(self) -> None:
        for identity_field in IDENTITY:
            with self.subTest(identity_field=identity_field):
                context = new_context(SyntheticHandler())
                binding = context.bind_child()
                child_descriptor = os.dup(binding.pass_fds[0])
                context.activate()
                binding.close_parent_copy()

                wrong_identity = dict(IDENTITY)
                wrong_identity[identity_field] = f"wrong-{identity_field}"
                with self.assertRaises(EphemeralLaunchHandshakeFailed):
                    EphemeralGateClient(child_descriptor, **wrong_identity)

                context.quiesce()
                context.close()

    def test_oversized_request_is_rejected_before_handler_invocation(self) -> None:
        handler = SyntheticHandler()
        context = new_context(handler, max_frame_bytes=512)
        client, _binding = connect_client(context)

        with self.assertRaises(EphemeralLaunchProtocolError):
            client.invoke(
                "synthetic.echo",
                "echo",
                {"large": "x" * 1024},
                timeout_seconds=1,
            )

        self.assertEqual(handler.calls, [])
        close_context(context, client)

    def test_malformed_frame_closes_channel_without_handler_invocation(self) -> None:
        handler = SyntheticHandler()
        context = new_context(handler)
        binding = context.bind_child()
        child_descriptor = os.dup(binding.pass_fds[0])
        context.activate()
        binding.close_parent_copy()
        endpoint = socket.socket(fileno=child_descriptor)
        handshake = json.dumps(
            {
                "type": "handshake",
                "workspaceId": IDENTITY["workspace_id"],
                "gateId": IDENTITY["gate_id"],
                "evidenceRunId": IDENTITY["evidence_run_id"],
                "provisioningRunId": IDENTITY["provisioning_run_id"],
            },
            separators=(",", ":"),
        ).encode("utf-8")
        endpoint.sendall(struct.pack("!I", len(handshake)) + handshake)
        response_size = struct.unpack("!I", endpoint.recv(4))[0]
        endpoint.recv(response_size)

        endpoint.sendall(struct.pack("!I", 1) + b"{")
        endpoint.settimeout(1)
        self.assertEqual(endpoint.recv(1), b"")
        endpoint.close()

        self.assertEqual(handler.calls, [])
        self.assertIsInstance(
            context.channel_error,
            EphemeralLaunchProtocolError,
        )
        context.quiesce()
        context.close()

    def test_unexpected_child_eof_remains_a_protocol_failure(self) -> None:
        context = new_context(SyntheticHandler())
        binding = context.bind_child()
        child_descriptor = os.dup(binding.pass_fds[0])
        context.activate()
        binding.close_parent_copy()
        endpoint = socket.socket(fileno=child_descriptor)
        handshake = {
            "type": "handshake",
            "workspaceId": IDENTITY["workspace_id"],
            "gateId": IDENTITY["gate_id"],
            "evidenceRunId": IDENTITY["evidence_run_id"],
            "provisioningRunId": IDENTITY["provisioning_run_id"],
        }
        encoded = json.dumps(handshake, separators=(",", ":")).encode("utf-8")
        endpoint.sendall(struct.pack("!I", len(encoded)) + encoded)
        response_size = struct.unpack("!I", endpoint.recv(4))[0]
        endpoint.recv(response_size)

        endpoint.close()
        deadline = time.monotonic() + 1
        while context.channel_error is None and time.monotonic() < deadline:
            time.sleep(0.01)

        self.assertIsInstance(
            context.channel_error,
            EphemeralLaunchProtocolError,
        )
        context.quiesce()
        context.close()

    def test_evicted_request_id_cannot_execute_again(self) -> None:
        for replay_value in (1, 3):
            handler = SyntheticHandler()
            context = new_context(handler, max_cached_responses=1)
            client, _binding = connect_client(context)
            client.invoke(
                "synthetic.echo",
                "echo",
                {"value": 1},
                timeout_seconds=1,
                request_id="request-a",
            )
            client.invoke(
                "synthetic.echo",
                "echo",
                {"value": 2},
                timeout_seconds=1,
                request_id="request-b",
            )

            with self.subTest(replay_value=replay_value), self.assertRaises(
                EphemeralLaunchProtocolError
            ):
                client.invoke(
                    "synthetic.echo",
                    "echo",
                    {"value": replay_value},
                    timeout_seconds=1,
                    request_id="request-a",
                )

            self.assertEqual(len(handler.calls), 2)
            close_context(context)

    def test_request_id_budget_fails_closed_before_handler_execution(self) -> None:
        handler = SyntheticHandler()
        context = new_context(
            handler,
            max_cached_responses=1,
            max_request_ids=2,
        )
        client, _binding = connect_client(context)
        for request_id in ("request-a", "request-b"):
            client.invoke(
                "synthetic.echo",
                "echo",
                {},
                timeout_seconds=1,
                request_id=request_id,
            )

        with self.assertRaises(EphemeralLaunchProtocolError):
            client.invoke(
                "synthetic.echo",
                "echo",
                {},
                timeout_seconds=1,
                request_id="request-c",
            )

        self.assertEqual(len(handler.calls), 2)
        close_context(context)

    def test_one_in_flight_request_applies_backpressure(self) -> None:
        handler = BlockingHandler()
        context = new_context(handler, request_timeout_seconds=2)
        client, _binding = connect_client(context)
        result: dict[str, object] = {}

        def invoke_blocking() -> None:
            result.update(
                client.invoke(
                    "synthetic.echo",
                    "block",
                    {},
                    timeout_seconds=2,
                )
            )

        worker = threading.Thread(target=invoke_blocking)
        worker.start()
        self.assertTrue(handler.started.wait(1))
        with self.assertRaises(EphemeralLaunchProtocolError):
            client.invoke(
                "synthetic.echo",
                "block",
                {},
                timeout_seconds=1,
            )
        handler.release.set()
        worker.join(2)

        self.assertEqual(result, {"released": True})
        self.assertTrue(close_context(context, client).succeeded)

    def test_invalid_timeout_is_rejected_before_transport_use(self) -> None:
        context = new_context(SyntheticHandler())
        client, _binding = connect_client(context)

        for invalid_timeout in (0, float("nan"), float("inf")):
            with self.subTest(
                invalid_timeout=invalid_timeout,
            ), self.assertRaises(EphemeralLaunchProtocolError):
                client.invoke(
                    "synthetic.echo",
                    "echo",
                    {},
                    timeout_seconds=invalid_timeout,
                )

        self.assertTrue(close_context(context, client).succeeded)

    def test_request_timeout_cancels_handler_and_cleanup_remains_bounded(self) -> None:
        handler = BlockingHandler()
        context = new_context(
            handler,
            request_timeout_seconds=0.1,
            quiesce_timeout_seconds=1,
        )
        client, _binding = connect_client(context)

        with self.assertRaises(EphemeralLaunchTimeout):
            client.invoke(
                "synthetic.echo",
                "block",
                {},
                timeout_seconds=0.1,
            )

        self.assertTrue(handler.cancelled.wait(1))
        self.assertTrue(close_context(context, client).succeeded)


@unittest.skipUnless(os.name == "posix", "POSIX socketpair contract")
class LaunchContextProcessTests(unittest.TestCase):
    def test_real_child_normal_close_is_acknowledged(self) -> None:
        context = new_context(SyntheticHandler())
        binding = context.bind_child()
        script = """
from tooling.acceptance.core import EphemeralGateClient

with EphemeralGateClient.from_environment():
    pass
"""
        context.activate()
        completed = GateProcessLauncher(
            cwd=REPO_ROOT,
            environment=controlled_child_environment(),
        ).run(
            GateLaunchSpec(
                argv=(sys.executable, "-c", script),
                timeout_seconds=5,
                required_capabilities=("synthetic.echo",),
            ),
            binding,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIsNone(context.channel_error)
        self.assertTrue(close_context(context).succeeded)

    def test_parent_blocked_error_survives_nonzero_child_exit(self) -> None:
        context = new_context(BlockedHandler())
        binding = context.bind_child()
        script = """
from tooling.acceptance.core import (
    EphemeralCapabilityBlocked,
    EphemeralGateClient,
)

try:
    with EphemeralGateClient.from_environment() as client:
        client.invoke(
            "synthetic.echo",
            "echo",
            {},
            timeout_seconds=2,
        )
except EphemeralCapabilityBlocked:
    raise SystemExit(7)
"""
        context.activate()
        completed = GateProcessLauncher(
            cwd=REPO_ROOT,
            environment=controlled_child_environment(),
        ).run(
            GateLaunchSpec(
                argv=(sys.executable, "-c", script),
                timeout_seconds=5,
                required_capabilities=("synthetic.echo",),
            ),
            binding,
        )

        self.assertEqual(completed.returncode, 7, completed.stderr)
        blocked_error = context.blocked_error
        self.assertIsInstance(blocked_error, EphemeralCapabilityBlocked)
        assert blocked_error is not None
        self.assertEqual(blocked_error.reason, "synthetic capability is busy")
        self.assertEqual(blocked_error.resource, "synthetic-resource")
        with self.assertRaises(AttributeError):
            setattr(context, "blocked_error", None)
        self.assertIsNone(context.channel_error)
        context.quiesce()
        self.assertIs(context.blocked_error, blocked_error)
        self.assertTrue(context.close().succeeded)

    def test_bootstrap_closes_context_descriptor_before_gate_grandchild(self) -> None:
        secret = "synthetic-secret-canary-9f146"
        handler = SyntheticHandler(secret=secret)
        context = new_context(handler)
        binding = context.bind_child()
        unrelated_read, unrelated_write = os.pipe()
        child_environment = {"SYNTHETIC_UNRELATED_FD": str(unrelated_read)}
        script = """
import json
import os
import subprocess
import sys
from tooling.acceptance.core import EphemeralGateClient

context_fd = int(os.environ["PT_ACCEPTANCE_EPHEMERAL_CONTEXT_FD"])
context_inheritable = os.get_inheritable(context_fd)
grandchild = subprocess.run(
    [
        sys.executable,
        "-c",
        "import os,sys; "
        "\\ntry: os.fstat(int(sys.argv[1]))"
        "\\nexcept OSError: raise SystemExit(0)"
        "\\nraise SystemExit(9)",
        str(context_fd),
    ],
    close_fds=False,
    capture_output=True,
    text=True,
)
unrelated_open = True
try:
    os.fstat(int(os.environ["SYNTHETIC_UNRELATED_FD"]))
except OSError:
    unrelated_open = False

with EphemeralGateClient.from_environment() as client:
    result = client.invoke(
        "synthetic.echo",
        "derive",
        {},
        timeout_seconds=2,
        request_id="child-request",
    )
print(json.dumps({
    "contextInheritable": context_inheritable,
    "grandchildReturncode": grandchild.returncode,
    "result": result,
    "unrelatedOpen": unrelated_open,
}))
"""
        context.activate()
        completed = GateProcessLauncher(
            cwd=REPO_ROOT,
            environment=child_environment,
        ).run(
            GateLaunchSpec(
                argv=(sys.executable, "-c", script),
                timeout_seconds=5,
                required_capabilities=("synthetic.echo",),
            ),
            binding,
        )
        os.close(unrelated_read)
        os.close(unrelated_write)

        self.assertEqual(completed.returncode, 0, completed.stderr)
        child_result = json.loads(completed.stdout)
        self.assertEqual(
            child_result,
            {
                "contextInheritable": False,
                "grandchildReturncode": 0,
                "result": {"accepted": True, "deadlineSet": True},
                "unrelatedOpen": False,
            },
        )
        self.assertNotIn(secret, completed.stdout)
        self.assertNotIn(secret, completed.stderr)
        self.assertEqual(len(handler.calls), 1)
        self.assertTrue(close_context(context).succeeded)

    def test_launcher_uses_exact_context_popen_contract(self) -> None:
        context = new_context(SyntheticHandler())
        binding = context.bind_child()
        inherited_descriptor = binding.pass_fds[0]
        process = MagicMock()
        process.returncode = 0

        def communicate(*, timeout: float) -> tuple[str, str]:
            self.assertEqual(timeout, 3)
            with self.assertRaises(OSError):
                os.fstat(inherited_descriptor)
            return "stdout", "stderr"

        process.communicate.side_effect = communicate
        launcher = GateProcessLauncher(
            cwd=str(REPO_ROOT),
            environment={"SYNTHETIC": "1"},
        )
        spec = GateLaunchSpec(
            argv=(sys.executable, "synthetic_gate.py", "--run"),
            timeout_seconds=3,
            required_capabilities=("synthetic.echo",),
        )

        with patch(
            "tooling.acceptance.core.launch_context.subprocess.Popen",
            return_value=process,
        ) as popen, patch(
            "tooling.acceptance.core.launch_context.os.killpg",
            side_effect=ProcessLookupError(),
        ) as killpg:
            completed = launcher.run(spec, binding)

        popen.assert_called_once()
        killpg.assert_called_once_with(process.pid, signal.SIGKILL)
        args, options = popen.call_args
        launch_argv = args[0]
        self.assertEqual(launch_argv[:3], (sys.executable, "-I", "-S"))
        self.assertEqual(
            launch_argv[-3:],
            ("--script", "synthetic_gate.py", "--run"),
        )
        self.assertFalse(options["shell"])
        self.assertTrue(options["close_fds"])
        self.assertTrue(options["start_new_session"])
        self.assertEqual(options["pass_fds"], (inherited_descriptor,))
        self.assertEqual(
            options["env"][EPHEMERAL_CONTEXT_FD_ENV],
            str(inherited_descriptor),
        )
        self.assertEqual(completed.stdout, "stdout")
        context.quiesce()
        self.assertTrue(context.close().succeeded)

    def test_context_launcher_requires_explicit_environment_before_spawn(
        self,
    ) -> None:
        context = new_context(SyntheticHandler())
        binding = context.bind_child()
        inherited_descriptor = binding.pass_fds[0]

        with patch(
            "tooling.acceptance.core.launch_context.subprocess.Popen",
        ) as popen, self.assertRaisesRegex(
            EphemeralLaunchContextInvalid,
            "requires an explicit child environment",
        ):
            GateProcessLauncher(cwd=str(REPO_ROOT)).run(
                GateLaunchSpec(
                    argv=(sys.executable, "-c", "pass"),
                    timeout_seconds=3,
                    required_capabilities=("synthetic.echo",),
                ),
                binding,
            )

        popen.assert_not_called()
        with self.assertRaises(OSError):
            os.fstat(inherited_descriptor)
        context.quiesce()
        self.assertTrue(context.close().succeeded)

    def test_context_launcher_rejects_parent_redaction_values_before_spawn(
        self,
    ) -> None:
        context = new_context(SyntheticHandler())
        binding = context.bind_child()
        inherited_descriptor = binding.pass_fds[0]

        with patch(
            "tooling.acceptance.core.launch_context.subprocess.Popen",
        ) as popen, self.assertRaisesRegex(
            EphemeralLaunchContextInvalid,
            "contains parent redaction values",
        ):
            GateProcessLauncher(
                cwd=str(REPO_ROOT),
                environment={
                    "PT_ACCEPTANCE_REDACTION_VALUES": "parent-only-canary",
                },
            ).run(
                GateLaunchSpec(
                    argv=(sys.executable, "-c", "pass"),
                    timeout_seconds=3,
                    required_capabilities=("synthetic.echo",),
                ),
                binding,
            )

        popen.assert_not_called()
        with self.assertRaises(OSError):
            os.fstat(inherited_descriptor)
        context.quiesce()
        self.assertTrue(context.close().succeeded)

    def test_context_child_does_not_inherit_ambient_secret_canaries(self) -> None:
        credential_canary = "ambient-provider-credential-canary"
        redaction_canary = "ambient-parent-redaction-canary"
        context = new_context(SyntheticHandler())
        binding = context.bind_child()
        script = """
import json
import os
from tooling.acceptance.core import EphemeralGateClient

with EphemeralGateClient.from_environment():
    print(json.dumps({
        "credentialPresent": "PT_PROVIDER_CREDENTIAL" in os.environ,
        "redactionValuesPresent": "PT_ACCEPTANCE_REDACTION_VALUES" in os.environ,
    }))
"""
        context.activate()
        with patch.dict(
            os.environ,
            {
                "PT_PROVIDER_CREDENTIAL": credential_canary,
                "PT_ACCEPTANCE_REDACTION_VALUES": redaction_canary,
            },
        ):
            completed = GateProcessLauncher(
                cwd=REPO_ROOT,
                environment=controlled_child_environment(),
            ).run(
                GateLaunchSpec(
                    argv=(sys.executable, "-c", script),
                    timeout_seconds=5,
                    required_capabilities=("synthetic.echo",),
                ),
                binding,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(
            json.loads(completed.stdout),
            {
                "credentialPresent": False,
                "redactionValuesPresent": False,
            },
        )
        self.assertNotIn(credential_canary, completed.stdout)
        self.assertNotIn(redaction_canary, completed.stdout)
        self.assertNotIn(credential_canary, completed.stderr)
        self.assertNotIn(redaction_canary, completed.stderr)
        self.assertTrue(close_context(context).succeeded)

    def test_context_launcher_rejects_non_python_argv_before_spawn(self) -> None:
        context = new_context(SyntheticHandler())
        binding = context.bind_child()

        with patch(
            "tooling.acceptance.core.launch_context.subprocess.Popen",
        ) as popen:
            with self.assertRaises(EphemeralLaunchTransportUnsupported):
                GateProcessLauncher(
                    cwd=str(REPO_ROOT),
                    environment=controlled_child_environment(),
                ).run(
                    GateLaunchSpec(
                        argv=("synthetic-gate", "--run"),
                        timeout_seconds=3,
                        required_capabilities=("synthetic.echo",),
                    ),
                    binding,
                )

        popen.assert_not_called()
        context.quiesce()
        self.assertTrue(context.close().succeeded)

    def test_context_launcher_accepts_python_script_argv(self) -> None:
        context = new_context(SyntheticHandler())
        binding = context.bind_child()
        context.activate()
        with tempfile.TemporaryDirectory() as directory:
            script_path = Path(directory) / "synthetic_gate.py"
            script_path.write_text(
                "from tooling.acceptance.core import EphemeralGateClient\n"
                "with EphemeralGateClient.from_environment() as client:\n"
                "    client.invoke('synthetic.echo', 'echo', {}, timeout_seconds=5)\n",
                encoding="utf-8",
            )
            completed = GateProcessLauncher(
                cwd=REPO_ROOT,
                environment=controlled_child_environment(),
            ).run(
                GateLaunchSpec(
                    argv=(sys.executable, str(script_path)),
                    timeout_seconds=10,
                    required_capabilities=("synthetic.echo",),
                ),
                binding,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertTrue(close_context(context).succeeded)

    def test_launcher_preserves_no_context_argv_path(self) -> None:
        completed = GateProcessLauncher(cwd=str(REPO_ROOT)).run(
            GateLaunchSpec(
                argv=(
                    sys.executable,
                    "-c",
                    "import sys; sys.stdout.write('no-context')",
                ),
                timeout_seconds=3,
                required_capabilities=(),
            ),
            None,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout, "no-context")

    @unittest.skipUnless(os.name == "posix", "POSIX process-group contract")
    def test_successful_gate_kills_detached_stdio_descendant(self) -> None:
        self._assert_completed_gate_kills_descendant(returncode=0)

    @unittest.skipUnless(os.name == "posix", "POSIX process-group contract")
    def test_nonzero_gate_kills_detached_stdio_descendant(self) -> None:
        self._assert_completed_gate_kills_descendant(returncode=7)

    def _assert_completed_gate_kills_descendant(self, *, returncode: int) -> None:
        script = """
import subprocess
import sys
import time
from pathlib import Path

descendant = subprocess.Popen(
    [
        sys.executable,
        "-c",
        "import os, signal, sys, time; from pathlib import Path; "
        "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        "Path(sys.argv[1]).write_text(str(os.getpid()), encoding='utf-8'); "
        "time.sleep(60)",
        sys.argv[1],
    ],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
while not Path(sys.argv[1]).exists():
    time.sleep(0.01)
raise SystemExit(int(sys.argv[2]))
"""
        with tempfile.TemporaryDirectory() as directory:
            pid_path = Path(directory) / "descendant.pid"
            completed = GateProcessLauncher().run(
                GateLaunchSpec(
                    argv=(
                        sys.executable,
                        "-c",
                        script,
                        str(pid_path),
                        str(returncode),
                    ),
                    timeout_seconds=3,
                    required_capabilities=(),
                ),
                None,
            )

            descendant_pid = wait_for_pid_file(pid_path)
            self.assertEqual(completed.returncode, returncode)
            with self.assertRaises(
                ProcessLookupError,
                msg=f"descendant process {descendant_pid} survived Gate exit",
            ):
                os.kill(descendant_pid, 0)

    def test_launcher_fails_closed_when_process_group_survives_sigkill(
        self,
    ) -> None:
        process = MagicMock()
        process.pid = 1234
        launcher = GateProcessLauncher(termination_timeout_seconds=0.1)

        with patch(
            "tooling.acceptance.core.launch_context.os.killpg",
            return_value=None,
        ) as killpg, patch(
            "tooling.acceptance.core.launch_context.time.monotonic",
            side_effect=(10.0, 10.1),
        ), patch(
            "tooling.acceptance.core.launch_context.time.sleep",
        ):
            with self.assertRaisesRegex(
                EphemeralLaunchCleanupFailed,
                "survived forced termination",
            ):
                launcher._kill_remaining_process_group(process)

        self.assertEqual(
            killpg.call_args_list,
            [
                call(1234, signal.SIGKILL),
                call(1234, 0),
            ],
        )

    def test_spawn_failure_is_typed_and_closes_parent_binding_copy(self) -> None:
        context = new_context(SyntheticHandler())
        binding = context.bind_child()
        inherited_descriptor = binding.pass_fds[0]
        context.activate()
        spec = GateLaunchSpec(
            argv=(sys.executable, "missing-synthetic-gate.py"),
            timeout_seconds=3,
            required_capabilities=("synthetic.echo",),
        )

        with patch(
            "tooling.acceptance.core.launch_context.subprocess.Popen",
            side_effect=OSError("synthetic spawn failure"),
        ):
            with self.assertRaises(EphemeralLaunchBindFailed) as raised:
                GateProcessLauncher(
                    cwd=str(REPO_ROOT),
                    environment=controlled_child_environment(),
                ).run(spec, binding)

        self.assertEqual(raised.exception.operation, "gate_process")
        with self.assertRaises(OSError):
            os.fstat(inherited_descriptor)
        context.quiesce()
        self.assertTrue(context.close().succeeded)

    def test_timeout_terminates_real_descendant_process_group(self) -> None:
        script = """
import subprocess
import sys
import time
from pathlib import Path

descendant = subprocess.Popen(
    [
        sys.executable,
        "-c",
        "import os, signal, sys, time; from pathlib import Path; "
        "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        "Path(sys.argv[1]).write_text(str(os.getpid()), encoding='utf-8'); "
        "time.sleep(60)",
        sys.argv[1],
    ],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
while not Path(sys.argv[1]).exists():
    time.sleep(0.01)
time.sleep(60)
"""
        with tempfile.TemporaryDirectory() as directory:
            pid_path = Path(directory) / "descendant.pid"
            spec = GateLaunchSpec(
                argv=(sys.executable, "-c", script, str(pid_path)),
                timeout_seconds=0.3,
                required_capabilities=(),
            )

            with self.assertRaises(EphemeralLaunchTimeout):
                GateProcessLauncher(
                    termination_timeout_seconds=0.5,
                ).run(spec, None)

            descendant_pid = wait_for_pid_file(pid_path)
            with self.assertRaises(
                ProcessLookupError,
                msg=(
                    f"descendant process {descendant_pid} survived "
                    "timeout cleanup"
                ),
            ):
                os.kill(descendant_pid, 0)

    def test_cancellation_terminates_real_descendant_process_group(self) -> None:
        script = """
import subprocess
import sys
import time
from pathlib import Path

descendant = subprocess.Popen(
    [
        sys.executable,
        "-c",
        "import os, signal, sys, time; from pathlib import Path; "
        "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        "Path(sys.argv[1]).write_text(str(os.getpid()), encoding='utf-8'); "
        "time.sleep(60)",
        sys.argv[1],
    ],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
while not Path(sys.argv[1]).exists():
    time.sleep(0.01)
time.sleep(60)
"""

        class CancellingProcess:
            def __init__(
                self,
                process: subprocess.Popen[str],
                pid_path: Path,
            ) -> None:
                self._process = process
                self._pid_path = pid_path
                self._cancelled = False

            @property
            def pid(self) -> int:
                return self._process.pid

            @property
            def returncode(self) -> int | None:
                return self._process.returncode

            def communicate(self, *, timeout: float) -> tuple[str, str]:
                if not self._cancelled:
                    self._cancelled = True
                    wait_for_pid_file(self._pid_path)
                    raise KeyboardInterrupt
                return self._process.communicate(timeout=timeout)

        real_popen = subprocess.Popen
        with tempfile.TemporaryDirectory() as directory:
            pid_path = Path(directory) / "descendant.pid"
            spec = GateLaunchSpec(
                argv=(sys.executable, "-c", script, str(pid_path)),
                timeout_seconds=5,
                required_capabilities=(),
            )

            def cancelling_popen(
                *args: object,
                **kwargs: object,
            ) -> CancellingProcess:
                process = real_popen(*args, **kwargs)
                return CancellingProcess(process, pid_path)

            with patch(
                "tooling.acceptance.core.launch_context.subprocess.Popen",
                side_effect=cancelling_popen,
            ):
                with self.assertRaises(KeyboardInterrupt):
                    GateProcessLauncher(
                        termination_timeout_seconds=0.5,
                    ).run(spec, None)

            descendant_pid = wait_for_pid_file(pid_path)
            with self.assertRaises(
                ProcessLookupError,
                msg=(
                    f"descendant process {descendant_pid} survived "
                    "cancellation cleanup"
                ),
            ):
                os.kill(descendant_pid, 0)

    def test_launcher_terminates_timed_out_process(self) -> None:
        process = MagicMock()
        process.pid = 1234
        process.communicate.side_effect = (
            subprocess.TimeoutExpired(cmd=("synthetic-gate",), timeout=0.01),
            subprocess.TimeoutExpired(cmd=("synthetic-gate",), timeout=0.1),
            ("", ""),
        )
        spec = GateLaunchSpec(
            argv=("synthetic-gate",),
            timeout_seconds=0.01,
            required_capabilities=(),
        )

        with patch(
            "tooling.acceptance.core.launch_context.subprocess.Popen",
            return_value=process,
        ), patch(
            "tooling.acceptance.core.launch_context.os.killpg",
            side_effect=(None, None, ProcessLookupError()),
        ) as killpg:
            with self.assertRaises(EphemeralLaunchTimeout):
                GateProcessLauncher(
                    termination_timeout_seconds=0.1,
                ).run(spec, None)

        self.assertEqual(
            killpg.call_args_list[:2],
            [
                call(1234, signal.SIGTERM),
                call(1234, signal.SIGKILL),
            ],
        )
        self.assertEqual(process.communicate.call_count, 3)

    def test_launcher_terminates_and_reaps_on_cancellation(self) -> None:
        process = MagicMock()
        process.pid = 1234
        process.communicate.side_effect = (
            KeyboardInterrupt(),
            ("", ""),
        )
        spec = GateLaunchSpec(
            argv=("synthetic-gate",),
            timeout_seconds=1,
            required_capabilities=(),
        )

        with patch(
            "tooling.acceptance.core.launch_context.subprocess.Popen",
            return_value=process,
        ), patch(
            "tooling.acceptance.core.launch_context.os.killpg",
            side_effect=(None, ProcessLookupError()),
        ) as killpg:
            with self.assertRaises(KeyboardInterrupt):
                GateProcessLauncher(
                    termination_timeout_seconds=0.1,
                ).run(spec, None)

        self.assertEqual(
            killpg.call_args_list,
            [
                call(1234, signal.SIGTERM),
                call(1234, signal.SIGKILL),
            ],
        )
        self.assertEqual(process.communicate.call_count, 2)

    def test_launcher_kills_group_after_cleanup_communicate_exception(self) -> None:
        process = MagicMock()
        process.pid = 1234
        process.communicate.side_effect = (
            RuntimeError("synthetic cancellation"),
            RuntimeError("synthetic cleanup interruption"),
            ("", ""),
        )
        spec = GateLaunchSpec(
            argv=("synthetic-gate",),
            timeout_seconds=1,
            required_capabilities=(),
        )

        with patch(
            "tooling.acceptance.core.launch_context.subprocess.Popen",
            return_value=process,
        ), patch(
            "tooling.acceptance.core.launch_context.os.killpg",
            side_effect=(None, None, ProcessLookupError()),
        ) as killpg:
            with self.assertRaisesRegex(RuntimeError, "synthetic cancellation"):
                GateProcessLauncher(
                    termination_timeout_seconds=0.1,
                ).run(spec, None)

        self.assertEqual(
            killpg.call_args_list[:2],
            [
                call(1234, signal.SIGTERM),
                call(1234, signal.SIGKILL),
            ],
        )
        self.assertEqual(process.communicate.call_count, 3)

    def test_windows_launcher_uses_direct_child_cleanup_without_session_option(
        self,
    ) -> None:
        process = MagicMock()
        process.communicate.side_effect = (KeyboardInterrupt(), ("", ""))
        spec = GateLaunchSpec(
            argv=("synthetic-gate",),
            timeout_seconds=1,
            required_capabilities=(),
        )

        with patch(
            "tooling.acceptance.core.launch_context.os.name",
            "nt",
        ), patch(
            "tooling.acceptance.core.launch_context.subprocess.Popen",
            return_value=process,
        ) as popen:
            with self.assertRaises(KeyboardInterrupt):
                GateProcessLauncher(
                    termination_timeout_seconds=0.1,
                ).run(spec, None)

        self.assertNotIn("start_new_session", popen.call_args.kwargs)
        process.terminate.assert_called_once_with()
        process.kill.assert_not_called()


class LaunchContextCleanupTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "posix", "POSIX socketpair contract")
    def test_quiesce_and_close_are_idempotent_and_ordered(self) -> None:
        handler = SyntheticHandler()
        context = new_context(handler)
        client, _binding = connect_client(context)
        client.close()

        context.quiesce()
        context.quiesce()
        self.assertEqual(context.state, EphemeralLaunchContextState.QUIESCED)
        self.assertFalse(handler.closed)

        first = context.close()
        second = context.close()
        self.assertIs(first, second)
        self.assertTrue(handler.closed)
        self.assertTrue(first.succeeded)
        self.assertEqual(context.state, EphemeralLaunchContextState.CLOSED)

    @unittest.skipUnless(os.name == "posix", "POSIX socketpair contract")
    def test_failed_handler_cleanup_is_typed_and_reported(self) -> None:
        context = new_context(FailedCleanupHandler())
        client, _binding = connect_client(context)
        client.close()
        context.quiesce()

        with self.assertRaises(EphemeralLaunchCleanupFailed) as raised:
            context.close()

        self.assertIsInstance(raised.exception.result, EphemeralCleanupResult)
        self.assertFalse(raised.exception.result.succeeded)
        self.assertEqual(context.state, EphemeralLaunchContextState.CLEANUP_FAILED)

    @unittest.skipUnless(os.name == "posix", "POSIX socketpair contract")
    def test_unresponsive_handler_causes_typed_quiesce_failure(self) -> None:
        handler = UnresponsiveHandler()
        context = new_context(
            handler,
            request_timeout_seconds=0.05,
            quiesce_timeout_seconds=0.05,
        )
        client, _binding = connect_client(context)
        with self.assertRaises(EphemeralLaunchTimeout):
            client.invoke(
                "synthetic.echo",
                "block",
                {},
                timeout_seconds=0.05,
            )

        with self.assertRaises(EphemeralLaunchCleanupFailed) as raised:
            context.quiesce()

        self.assertFalse(raised.exception.result.succeeded)
        self.assertFalse(raised.exception.result.handlers_closed)
        self.assertEqual(
            raised.exception.result.quarantined_capabilities,
            ("synthetic.echo",),
        )
        self.assertEqual(context.state, EphemeralLaunchContextState.CLEANUP_FAILED)
        self.assertEqual(len(handler.quarantine_calls), 1)
        reason, deadline = handler.quarantine_calls[0]
        self.assertIn("quiesce deadline", reason)
        self.assertGreater(deadline, 0)
        handler.release.set()
        client.close()
        self.assertTrue(client._closed)

    @unittest.skipUnless(os.name == "posix", "POSIX socketpair contract")
    def test_fenced_quiesce_failure_still_closes_all_handlers(self) -> None:
        active_handler = UnresponsiveHandler()
        idle_handler = SyntheticHandler(secret="idle-secret")
        context = EphemeralGateLaunchContext(
            required_capabilities=("synthetic.echo", "synthetic.other"),
            request_timeout_seconds=0.05,
            quiesce_timeout_seconds=0.05,
        )
        context.register_capability("synthetic.echo", active_handler)
        context.register_capability("synthetic.other", idle_handler)
        context.seal(**IDENTITY)
        client, _binding = connect_client(context)
        try:
            with self.assertRaises(EphemeralLaunchTimeout):
                client.invoke(
                    "synthetic.echo",
                    "block",
                    {},
                    timeout_seconds=0.05,
                )

            with self.assertRaises(EphemeralLaunchCleanupFailed):
                context.quiesce()

            active_handler.release.set()
            with self.assertRaises(EphemeralLaunchCleanupFailed) as raised:
                context.close()

            self.assertTrue(active_handler.closed)
            self.assertTrue(idle_handler.closed)
            self.assertTrue(raised.exception.result.handlers_closed)
            self.assertTrue(raised.exception.result.secrets_zeroized)
            self.assertEqual(
                raised.exception.result.quarantined_capabilities,
                ("synthetic.echo",),
            )
            self.assertIn(
                "broker or capability handler exceeded quiesce deadline",
                raised.exception.result.errors,
            )
        finally:
            active_handler.release.set()
            try:
                client.close()
            except EphemeralLaunchProtocolError:
                pass

    def test_close_requires_prior_quiesce(self) -> None:
        context = new_context(SyntheticHandler())
        with self.assertRaises(EphemeralLaunchContextInvalid):
            context.close()

    def test_client_absence_is_not_an_implicit_context(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(EphemeralGateClient.from_environment())


if __name__ == "__main__":
    unittest.main(verbosity=2)
