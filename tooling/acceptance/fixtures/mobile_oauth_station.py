from __future__ import annotations

import hashlib
import json
import math
import os
import selectors
import signal
import subprocess
import threading
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from tooling.acceptance.core import ArtifactRef, BlockedError, RunHandle
from tooling.acceptance.gates.mobile.proof_contracts import (
    GATE_ID,
    ProofContractError,
    validate_contract_payload,
)


COMMANDS_ENVIRONMENT = "PT_MOBILE_OAUTH_ACCEPTANCE_COMMANDS"
SERVICES = ("station-primary", "station-secondary")
ALLOWED_OPERATIONS = (
    "prepare_following_gate",
    "expire_awaiting_attempt",
    "read_proof_snapshot",
    "cleanup_run",
)
COMMAND_TIMEOUT_SECONDS = 60.0
MAXIMUM_OUTPUT_BYTES = 1 << 20
PROCESS_POLL_SECONDS = 0.02
PROCESS_TERMINATION_SECONDS = 1.0
HMAC_FD_ENVIRONMENT = "PT_MOBILE_OAUTH_ACCEPTANCE_HMAC_FD"
STATION_COMMAND_ENVIRONMENT_KEYS = (
    "HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "PATH",
    "TMPDIR",
    "TZ",
    "__CF_USER_TEXT_ENCODING",
)


def _fixture_command_deadline(
    configured_timeout: float,
    deadline_monotonic: float | None,
    cancellation: threading.Event | None,
) -> float:
    if cancellation is not None and cancellation.is_set():
        raise StationFixtureError("Station Fixture command was cancelled")
    if not math.isfinite(configured_timeout) or configured_timeout <= 0:
        raise StationFixtureError(
            "Station Fixture command timeout must be positive and finite"
        )
    local_deadline = time.monotonic() + configured_timeout
    if deadline_monotonic is None:
        return local_deadline
    if (
        not math.isfinite(deadline_monotonic)
        or deadline_monotonic <= time.monotonic()
    ):
        raise StationFixtureError("Station Fixture command exceeded its deadline")
    return min(local_deadline, deadline_monotonic)


class StationFixtureError(RuntimeError):
    """The deployment-owned Station Fixture command failed closed."""


class StationFixtureConflict(StationFixtureError):
    """An operation identity, fence, or cleanup conflict quarantined a lease."""


class StationCommandExecutor(Protocol):
    def run(
        self,
        command: Sequence[str],
        *,
        input_text: str,
        environment: Mapping[str, str],
        pass_fds: tuple[int, ...],
        deadline_monotonic: float,
        cancellation: threading.Event | None,
    ) -> "StationCommandResult":
        ...


class ArtifactWriter(Protocol):
    gate_id: str
    run_id: str

    def write_json(
        self,
        relative_path: str,
        value: Mapping[str, Any],
        *,
        role: str | None = None,
        redact: bool = True,
    ) -> ArtifactRef:
        ...


@dataclass(frozen=True)
class StationCommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


class SubprocessStationCommandExecutor:
    def run(
        self,
        command: Sequence[str],
        *,
        input_text: str,
        environment: Mapping[str, str],
        pass_fds: tuple[int, ...],
        deadline_monotonic: float,
        cancellation: threading.Event | None,
    ) -> StationCommandResult:
        if os.name != "posix":
            raise StationFixtureError(
                "deployment-owned Station Fixture commands require POSIX "
                "process-group isolation"
            )
        if cancellation is not None and cancellation.is_set():
            raise StationFixtureError(
                "deployment-owned Station Fixture command was cancelled"
            )
        if (
            not math.isfinite(deadline_monotonic)
            or deadline_monotonic <= time.monotonic()
        ):
            raise StationFixtureError(
                "deployment-owned Station Fixture command exceeded its deadline"
            )
        child_environment = self._child_environment(environment, pass_fds)
        encoded_input = input_text.encode("utf-8")
        if len(encoded_input) > MAXIMUM_OUTPUT_BYTES:
            raise StationFixtureError(
                "deployment-owned Station Fixture command input exceeded its bound"
            )

        process: subprocess.Popen[bytes] | None = None
        try:
            process = subprocess.Popen(
                list(command),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=False,
                shell=False,
                close_fds=True,
                start_new_session=True,
                env=child_environment,
                pass_fds=pass_fds,
            )
            stdout, stderr = self._communicate_bounded(
                process,
                encoded_input,
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            self._kill_remaining_process_group(process)
        except OSError as error:
            if process is not None:
                self._terminate(process)
            raise StationFixtureError(
                "deployment-owned Station Fixture command outcome is unknown"
            ) from error
        except BaseException:
            if process is not None:
                self._terminate(process)
            raise
        finally:
            if process is not None:
                self._close_process_streams(process)

        return StationCommandResult(
            returncode=int(process.returncode),
            stdout=stdout.decode("utf-8", errors="replace"),
            stderr=stderr.decode("utf-8", errors="replace"),
        )

    @staticmethod
    def _child_environment(
        environment: Mapping[str, str],
        pass_fds: tuple[int, ...],
    ) -> dict[str, str]:
        child_environment = {
            name: environment[name]
            for name in STATION_COMMAND_ENVIRONMENT_KEYS
            if name in environment
        }
        hmac_fd = str(environment.get(HMAC_FD_ENVIRONMENT, "")).strip()
        if pass_fds:
            if (
                len(pass_fds) != 1
                or pass_fds[0] < 0
                or hmac_fd != str(pass_fds[0])
            ):
                raise StationFixtureError(
                    "Station Fixture HMAC descriptor injection is inconsistent"
                )
            child_environment[HMAC_FD_ENVIRONMENT] = hmac_fd
        elif hmac_fd:
            raise StationFixtureError(
                "Station Fixture HMAC descriptor locator has no inherited descriptor"
            )
        return child_environment

    def _communicate_bounded(
        self,
        process: subprocess.Popen[bytes],
        input_bytes: bytes,
        *,
        deadline_monotonic: float,
        cancellation: threading.Event | None,
    ) -> tuple[bytes, bytes]:
        if process.stdin is None or process.stdout is None or process.stderr is None:
            raise StationFixtureError(
                "deployment-owned Station Fixture command pipes are unavailable"
            )

        buffers = {"stdout": bytearray(), "stderr": bytearray()}
        selector = selectors.DefaultSelector()
        input_offset = 0
        for stream, label in (
            (process.stdout, "stdout"),
            (process.stderr, "stderr"),
        ):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, label)
        if input_bytes:
            os.set_blocking(process.stdin.fileno(), False)
            selector.register(process.stdin, selectors.EVENT_WRITE, "stdin")
        else:
            process.stdin.close()

        try:
            while selector.get_map() or process.poll() is None:
                if cancellation is not None and cancellation.is_set():
                    raise StationFixtureError(
                        "deployment-owned Station Fixture command was cancelled"
                    )
                remaining = deadline_monotonic - time.monotonic()
                if remaining <= 0:
                    raise StationFixtureError(
                        "deployment-owned Station Fixture command exceeded its deadline"
                    )

                for key, _ in selector.select(
                    min(PROCESS_POLL_SECONDS, remaining)
                ):
                    stream = key.fileobj
                    if key.data == "stdin":
                        try:
                            written = os.write(
                                stream.fileno(),
                                input_bytes[input_offset:],
                            )
                        except BrokenPipeError:
                            written = len(input_bytes) - input_offset
                        input_offset += written
                        if input_offset >= len(input_bytes):
                            selector.unregister(stream)
                            stream.close()
                        continue

                    try:
                        chunk = os.read(stream.fileno(), 65536)
                    except BlockingIOError:
                        continue
                    if not chunk:
                        selector.unregister(stream)
                        stream.close()
                        continue
                    target = buffers[str(key.data)]
                    target.extend(chunk)
                    if len(target) > MAXIMUM_OUTPUT_BYTES:
                        raise StationFixtureError(
                            "deployment-owned Station Fixture command output "
                            "exceeded its bound"
                        )
            process.wait(timeout=0)
            return bytes(buffers["stdout"]), bytes(buffers["stderr"])
        finally:
            selector.close()

    def _terminate(self, process: subprocess.Popen[bytes]) -> None:
        self._close_process_streams(process)
        self._signal_process_group(process, signal.SIGTERM)
        try:
            process.wait(timeout=PROCESS_TERMINATION_SECONDS)
        except subprocess.TimeoutExpired:
            pass
        self._signal_process_group(process, signal.SIGKILL)
        try:
            process.wait(timeout=PROCESS_TERMINATION_SECONDS)
        except subprocess.TimeoutExpired as error:
            raise StationFixtureError(
                "deployment-owned Station Fixture command could not be reaped"
            ) from error
        self._kill_remaining_process_group(process)

    @staticmethod
    def _signal_process_group(
        process: subprocess.Popen[bytes],
        signal_number: signal.Signals,
    ) -> None:
        try:
            os.killpg(process.pid, signal_number)
        except ProcessLookupError:
            return
        except PermissionError:
            # macOS may report EPERM briefly for a zombie-only group. The
            # bounded extinction probe remains authoritative.
            return
        except OSError as error:
            raise StationFixtureError(
                "deployment-owned Station Fixture process group could not be "
                "signalled"
            ) from error

    def _kill_remaining_process_group(
        self,
        process: subprocess.Popen[bytes],
    ) -> None:
        self._signal_process_group(process, signal.SIGKILL)
        deadline = time.monotonic() + PROCESS_TERMINATION_SECONDS
        while True:
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                return
            except PermissionError:
                pass
            except OSError as error:
                raise StationFixtureError(
                    "deployment-owned Station Fixture process-group extinction "
                    "could not be verified"
                ) from error
            if time.monotonic() >= deadline:
                raise StationFixtureError(
                    "deployment-owned Station Fixture process group survived "
                    "forced termination"
                )
            time.sleep(
                min(PROCESS_POLL_SECONDS, max(0.0, deadline - time.monotonic()))
            )

    @staticmethod
    def _close_process_streams(process: subprocess.Popen[bytes]) -> None:
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None and not stream.closed:
                stream.close()


@dataclass(frozen=True)
class PendingFixtureOperation:
    request: dict[str, Any]
    receipt: dict[str, Any]
    before: ArtifactRef
    after: ArtifactRef


def load_deployment_commands(
    environment: Mapping[str, str] | None = None,
) -> dict[str, tuple[str, ...]]:
    source = os.environ if environment is None else environment
    raw = str(source.get(COMMANDS_ENVIRONMENT, "")).strip()
    if not raw:
        raise BlockedError(
            reason=(
                "Mobile OAuth Station Fixture requires the deployment-owned "
                f"JSON command map {COMMANDS_ENVIRONMENT}"
            ),
            resource=f"fixture-command:{COMMANDS_ENVIRONMENT}",
        )
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise BlockedError(
            reason="Mobile OAuth Station Fixture command map is invalid JSON",
            resource=f"fixture-command:{COMMANDS_ENVIRONMENT}",
        ) from error
    if not isinstance(payload, dict) or set(payload) != set(SERVICES):
        raise BlockedError(
            reason=(
                "Mobile OAuth Station Fixture command map must contain exactly "
                "station-primary and station-secondary"
            ),
            resource=f"fixture-command:{COMMANDS_ENVIRONMENT}",
        )

    commands: dict[str, tuple[str, ...]] = {}
    for service_id in SERVICES:
        command = payload[service_id]
        if (
            not isinstance(command, list)
            or not command
            or any(not isinstance(part, str) or not part.strip() for part in command)
        ):
            raise BlockedError(
                reason=(
                    f"Mobile OAuth Station Fixture command for {service_id} "
                    "must be a non-empty JSON string array"
                ),
                resource=f"fixture-command:{service_id}",
            )
        if "--operation" in command:
            raise BlockedError(
                reason=(
                    f"Mobile OAuth Station Fixture command for {service_id} "
                    "must not preselect an operation"
                ),
                resource=f"fixture-command:{service_id}",
            )
        commands[service_id] = tuple(command)
    return commands


def operation_input_digest(request: Mapping[str, Any]) -> str:
    invite_code = str(request.get("inviteCode") or "")
    invite_digest = (
        hashlib.sha256(invite_code.encode("utf-8")).hexdigest()
        if invite_code
        else ""
    )
    lease = _required_mapping(request, "lease")
    canonical_input = {
        "resourceKey": _required_text(lease, "resourceKey"),
        "holderRunId": _required_text(lease, "holderRunId"),
        "fenceToken": _required_positive_int(lease, "fenceToken"),
        "variantId": _required_text(request, "variantId"),
        "operation": _required_text(request, "operation"),
        "target": _canonical_target(_required_mapping(request, "target")),
        "oauthState": _required_text(request, "oauthState"),
        "inviteDigest": invite_digest,
    }
    encoded = _go_json_bytes(
        canonical_input,
    )
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


class MobileOAuthStationFixture:
    """Run-scoped client for the deployment-owned Station OAuth adapter."""

    def __init__(
        self,
        *,
        run_handle: RunHandle | ArtifactWriter,
        commands: Mapping[str, Sequence[str]],
        correlation_key: bytes | bytearray,
        executor: StationCommandExecutor | None = None,
        environment: Mapping[str, str] | None = None,
        timeout: float = COMMAND_TIMEOUT_SECONDS,
    ) -> None:
        if run_handle.gate_id != GATE_ID:
            raise StationFixtureError(
                f"Station Fixture requires Gate {GATE_ID!r}"
            )
        if len(correlation_key) < 32:
            raise StationFixtureError(
                "Station Fixture provider-correlation key is too short"
            )
        if set(commands) != set(SERVICES) or any(
            not command
            or isinstance(command, str)
            or any(not isinstance(part, str) or not part for part in command)
            for command in commands.values()
        ):
            raise StationFixtureError(
                "Station Fixture requires commands for both declared Stations"
            )
        self.run_handle = run_handle
        self.run_id = run_handle.run_id
        self.commands = {
            service_id: tuple(commands[service_id])
            for service_id in SERVICES
        }
        self.correlation_key = bytearray(correlation_key)
        self.executor = executor or SubprocessStationCommandExecutor()
        source_environment = os.environ if environment is None else environment
        self.environment = {
            name: source_environment[name]
            for name in STATION_COMMAND_ENVIRONMENT_KEYS
            if name in source_environment
        }
        self.timeout = timeout
        self.leases: dict[str, dict[str, Any]] = {}
        self.pending: dict[str, list[PendingFixtureOperation]] = {
            service_id: [] for service_id in SERVICES
        }
        self.lease_refs: dict[str, ArtifactRef] = {}
        self.acquisition_order: list[str] = []
        self.quarantined: dict[str, str] = {}
        self._operation_digests: dict[tuple[str, str], str] = {}
        self._cleanup_result: tuple[str, ...] | None = None
        self._closed = False

    @classmethod
    def from_environment(
        cls,
        *,
        run_handle: RunHandle | ArtifactWriter,
        correlation_key: bytes | bytearray,
        environment: Mapping[str, str] | None = None,
        executor: StationCommandExecutor | None = None,
        timeout: float = COMMAND_TIMEOUT_SECONDS,
    ) -> "MobileOAuthStationFixture":
        return cls(
            run_handle=run_handle,
            commands=load_deployment_commands(environment),
            correlation_key=correlation_key,
            executor=executor,
            environment=environment,
            timeout=timeout,
        )

    def bootstrap(self) -> None:
        for service_id in SERVICES:
            self._invoke(service_id, "bootstrap", None)

    def acquire(
        self,
        service_id: str,
        *,
        heartbeat_at: datetime | None = None,
        lease_duration: timedelta = timedelta(minutes=10),
    ) -> dict[str, Any]:
        self._require_service_available(service_id)
        heartbeat = heartbeat_at or datetime.now(timezone.utc)
        renew_before = heartbeat + lease_duration / 2
        expires_at = heartbeat + lease_duration
        payload = self._invoke(
            service_id,
            "acquire_lease",
            {
                "runId": self.run_id,
                "gateId": GATE_ID,
                "resourceKey": (
                    f"station/{service_id}/mobile-oauth-fixture"
                ),
                "heartbeatAt": _utc_timestamp(heartbeat),
                "renewBefore": _utc_timestamp(renew_before),
                "expiresAt": _utc_timestamp(expires_at),
            },
        )
        lease = self._validate_payload(
            payload,
            expected_kind="mobile-oauth-fixture-lease",
        )
        self._require_lease_identity(service_id, lease)
        reference = self._write_payload(
            f"runtime/mobile/fixtures/{service_id}/lease.json",
            lease,
        )
        self.lease_refs[service_id] = reference
        self.leases[service_id] = lease
        if service_id not in self.acquisition_order:
            self.acquisition_order.append(service_id)
        return dict(lease)

    def heartbeat(
        self,
        service_id: str,
        *,
        heartbeat_at: datetime | None = None,
        lease_duration: timedelta = timedelta(minutes=10),
    ) -> dict[str, Any]:
        lease = self._lease(service_id)
        heartbeat = heartbeat_at or datetime.now(timezone.utc)
        payload = self._invoke(
            service_id,
            "heartbeat_lease",
            {
                "lease": _lease_identity(lease),
                "heartbeatAt": _utc_timestamp(heartbeat),
                "renewBefore": _utc_timestamp(
                    heartbeat + lease_duration / 2
                ),
                "expiresAt": _utc_timestamp(heartbeat + lease_duration),
            },
        )
        refreshed = self._validate_payload(
            payload,
            expected_kind="mobile-oauth-fixture-lease",
        )
        try:
            self._require_same_fence(lease, refreshed)
        except StationFixtureConflict:
            self._quarantine(service_id, "stale_fence")
            raise
        self.leases[service_id] = refreshed
        return dict(refreshed)

    def execute(
        self,
        service_id: str,
        *,
        operation_id: str,
        variant_id: str,
        operation: str,
        target: Mapping[str, Any],
        oauth_state: str,
        expected_provider: str,
        invite_code: str = "",
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> dict[str, Any]:
        if operation not in {
            "prepare_following_gate",
            "expire_awaiting_attempt",
        }:
            raise StationFixtureError(
                f"Station Fixture mutation {operation!r} is not allowed here"
            )
        lease = self._lease(service_id)
        request = self._operation_request(
            lease,
            operation_id=operation_id,
            variant_id=variant_id,
            operation=operation,
            target=target,
            oauth_state=oauth_state,
            invite_code=invite_code,
        )
        recovered = next(
            (
                pending.receipt
                for pending in self.pending[service_id]
                if pending.request["operationId"] == operation_id
            ),
            None,
        )
        if recovered is not None:
            return dict(recovered)
        before = self.snapshot(
            service_id,
            operation_id=operation_id,
            variant_id=variant_id,
            snapshot_phase="before",
            target=target,
            expected_provider=expected_provider,
            path=(
                f"runtime/mobile/fixtures/{service_id}/operations/"
                f"{operation_id}-before.json"
            ),
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        receipt = self._invoke_operation(
            service_id,
            request,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        try:
            self._validate_receipt(request, receipt)
        except StationFixtureConflict:
            self._quarantine(service_id, "operation_receipt_conflict")
            raise
        after = self.snapshot(
            service_id,
            operation_id=operation_id,
            variant_id=variant_id,
            snapshot_phase="post_action",
            target=target,
            expected_provider=expected_provider,
            path=f"evidence/mobile/{variant_id}/station/{service_id}.json",
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        self.pending[service_id].append(
            PendingFixtureOperation(
                request=request,
                receipt=receipt,
                before=before,
                after=after,
            )
        )
        return dict(receipt)

    def snapshot(
        self,
        service_id: str,
        *,
        operation_id: str,
        variant_id: str,
        snapshot_phase: str,
        target: Mapping[str, Any],
        expected_provider: str,
        path: str,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> ArtifactRef:
        lease = self._lease(service_id, allow_released=snapshot_phase == "post_cleanup")
        payload = self._invoke(
            service_id,
            "read_proof_snapshot",
            {
                "operationId": operation_id,
                "lease": _lease_identity(lease),
                "variantId": variant_id,
                "snapshotPhase": snapshot_phase,
                "target": dict(target),
                "expectedProvider": expected_provider,
            },
            correlation_key=True,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        snapshot = self._validate_payload(
            payload,
            expected_kind="station-oauth-proof-snapshot",
        )
        try:
            self._require_snapshot_identity(
                service_id,
                lease,
                variant_id,
                snapshot_phase,
                snapshot,
            )
        except StationFixtureConflict:
            self._quarantine(service_id, "proof_identity_conflict")
            raise
        return self._write_payload(path, snapshot)

    def cleanup(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> tuple[str, ...]:
        if self._cleanup_result is not None:
            return self._cleanup_result
        if self._closed:
            raise StationFixtureConflict(
                "Station Fixture cleanup cannot resume quarantined resources"
            )
        failures: list[str] = []
        completed: list[str] = []
        for service_id in reversed(self.acquisition_order):
            if service_id in self.quarantined:
                failures.append(f"{service_id}: quarantined")
                continue
            try:
                _fixture_command_deadline(
                    self.timeout,
                    deadline_monotonic,
                    cancellation,
                )
                self._cleanup_service(
                    service_id,
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                completed.append(service_id)
            except Exception as error:
                self._quarantine(service_id, _conflict_reason(error))
                failures.append(f"{service_id}: {_conflict_reason(error)}")
        self.close()
        if failures:
            raise StationFixtureConflict(
                "Station Fixture cleanup quarantined resources: "
                + "; ".join(failures)
            )
        self._cleanup_result = tuple(completed)
        return self._cleanup_result

    def teardown(self) -> None:
        failures: list[str] = []
        for service_id in reversed(SERVICES):
            if service_id in self.quarantined:
                continue
            try:
                self._invoke(service_id, "teardown", None)
            except StationFixtureError:
                failures.append(service_id)
        self.close()
        if failures:
            raise StationFixtureError(
                "Station Fixture adapter teardown failed for "
                + ", ".join(failures)
            )

    def close(self) -> None:
        if self._closed:
            return
        for index in range(len(self.correlation_key)):
            self.correlation_key[index] = 0
        self._closed = True

    def _cleanup_service(
        self,
        service_id: str,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        operations = self.pending[service_id]
        lease = self._lease(service_id)
        if operations:
            target_operation = operations[-1]
            variant_id = target_operation.request["variantId"]
            target = target_operation.request["target"]
            oauth_state = target_operation.request["oauthState"]
        else:
            variant_id, target = _empty_cleanup_target(service_id, self.run_id)
            oauth_state = "OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER"
        cleanup_request = self._operation_request(
            lease,
            operation_id=f"cleanup-{self.run_id}-{service_id}",
            variant_id=variant_id,
            operation="cleanup_run",
            target=target,
            oauth_state=oauth_state,
        )
        receipt = self._invoke_operation(
            service_id,
            cleanup_request,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        self._validate_receipt(cleanup_request, receipt)
        released = dict(lease)
        released["state"] = "RELEASED"
        released["quarantineReason"] = ""
        self.leases[service_id] = released

        post_cleanup = self.snapshot(
            service_id,
            operation_id=cleanup_request["operationId"],
            variant_id=variant_id,
            snapshot_phase="post_cleanup",
            target=target,
            expected_provider=_provider_for_client(
                str(target["deviceAlias"])
            ),
            path=f"evidence/mobile/cleanup/station/{service_id}.json",
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        for pending in operations:
            operation_payload = self._finalize_operation(
                pending,
                post_cleanup,
            )
            self._write_payload(
                f"runtime/mobile/fixtures/{service_id}/operations/"
                f"{pending.request['operationId']}.json",
                operation_payload,
            )
        operations.clear()
        self._invoke(
            service_id,
            "teardown",
            None,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )

    def _operation_request(
        self,
        lease: Mapping[str, Any],
        *,
        operation_id: str,
        variant_id: str,
        operation: str,
        target: Mapping[str, Any],
        oauth_state: str,
        invite_code: str = "",
    ) -> dict[str, Any]:
        request = {
            "operationId": operation_id,
            "inputDigest": "",
            "lease": _lease_identity(lease),
            "variantId": variant_id,
            "operation": operation,
            "target": dict(target),
            "oauthState": oauth_state,
        }
        if invite_code:
            request["inviteCode"] = invite_code
        request["inputDigest"] = operation_input_digest(request)
        operation_key = (str(target.get("serviceId") or ""), operation_id)
        previous = self._operation_digests.setdefault(
            operation_key,
            request["inputDigest"],
        )
        if previous != request["inputDigest"]:
            self._quarantine(
                str(target.get("serviceId") or ""),
                "operation_identity_conflict",
            )
            raise StationFixtureConflict(
                "Station Fixture operationId was reused with different input"
            )
        return request

    def _invoke_operation(
        self,
        service_id: str,
        request: Mapping[str, Any],
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> dict[str, Any]:
        try:
            return self._invoke(
                service_id,
                str(request["operation"]),
                request,
                retry_unknown=True,
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
        except StationFixtureConflict:
            self._quarantine(service_id, "operation_conflict")
            raise

    def _invoke(
        self,
        service_id: str,
        operation: str,
        payload: Mapping[str, Any] | None,
        *,
        correlation_key: bool = False,
        retry_unknown: bool = False,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> dict[str, Any]:
        self._require_service_available(service_id)
        if operation not in {
            "bootstrap",
            "teardown",
            "acquire_lease",
            "heartbeat_lease",
            *ALLOWED_OPERATIONS,
        }:
            raise StationFixtureError(
                f"Station Fixture operation {operation!r} is not allowlisted"
            )
        command = (*self.commands[service_id], "--operation", operation)
        input_text = (
            ""
            if payload is None
            else json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        )
        attempts = 2 if retry_unknown else 1
        command_deadline = _fixture_command_deadline(
            self.timeout,
            deadline_monotonic,
            cancellation,
        )
        for attempt in range(attempts):
            try:
                result = self._run_command(
                    command,
                    input_text=input_text,
                    correlation_key=correlation_key,
                    deadline_monotonic=command_deadline,
                    cancellation=cancellation,
                )
            except StationFixtureError:
                if (
                    attempt + 1 < attempts
                    and not (
                        cancellation is not None and cancellation.is_set()
                    )
                    and time.monotonic() < command_deadline
                ):
                    continue
                raise
            if result.returncode != 0:
                if _is_conflict(result.stderr):
                    raise StationFixtureConflict(
                        f"Station Fixture {operation} reported a conflict"
                    )
                raise StationFixtureError(
                    f"Station Fixture {operation} failed with exit "
                    f"{result.returncode}"
                )
            return _decode_command_output(result.stdout, operation)
        raise StationFixtureError(
            f"Station Fixture {operation} did not produce an outcome"
        )

    def _run_command(
        self,
        command: Sequence[str],
        *,
        input_text: str,
        correlation_key: bool,
        deadline_monotonic: float,
        cancellation: threading.Event | None,
    ) -> StationCommandResult:
        read_fd = -1
        write_fd = -1
        environment = dict(self.environment)
        pass_fds: tuple[int, ...] = ()
        try:
            if correlation_key:
                read_fd, write_fd = os.pipe()
                os.write(write_fd, self.correlation_key)
                os.close(write_fd)
                write_fd = -1
                environment[HMAC_FD_ENVIRONMENT] = str(read_fd)
                pass_fds = (read_fd,)
            return self.executor.run(
                command,
                input_text=input_text,
                environment=environment,
                pass_fds=pass_fds,
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
        finally:
            if write_fd >= 0:
                os.close(write_fd)
            if read_fd >= 0:
                os.close(read_fd)

    def _validate_payload(
        self,
        payload: Mapping[str, Any],
        *,
        expected_kind: str,
    ) -> dict[str, Any]:
        try:
            return validate_contract_payload(
                payload,
                expected_kind=expected_kind,
                expected_run_id=self.run_id,
                expected_gate_id=GATE_ID,
            )
        except ProofContractError as error:
            raise StationFixtureError(
                f"Station Fixture returned invalid {expected_kind}"
            ) from error

    def _write_payload(
        self,
        path: str,
        payload: Mapping[str, Any],
    ) -> ArtifactRef:
        validated = self._validate_payload(
            payload,
            expected_kind=str(payload.get("artifactKind") or ""),
        )
        return self.run_handle.write_json(
            path,
            validated,
            redact=False,
        )

    def _validate_receipt(
        self,
        request: Mapping[str, Any],
        receipt: Mapping[str, Any],
    ) -> None:
        expected = {
            "operationId": request["operationId"],
            "inputDigest": request["inputDigest"],
            "resourceKey": request["lease"]["resourceKey"],
            "holderRunId": request["lease"]["holderRunId"],
            "fenceToken": request["lease"]["fenceToken"],
            "runId": self.run_id,
            "gateId": GATE_ID,
            "variantId": request["variantId"],
            "operation": request["operation"],
            "target": request["target"],
            "oauthState": request["oauthState"],
            "journalState": "COMMITTED",
            "preconditionMatched": True,
        }
        for field, value in expected.items():
            if receipt.get(field) != value:
                raise StationFixtureConflict(
                    f"Station Fixture receipt identity mismatch: {field}"
                )
        if receipt.get("affectedRows") != 1:
            raise StationFixtureConflict(
                "Station Fixture receipt affectedRows must equal one"
            )

    def _require_lease_identity(
        self,
        service_id: str,
        lease: Mapping[str, Any],
    ) -> None:
        if (
            lease.get("serviceId") != service_id
            or lease.get("holderRunId") != self.run_id
            or lease.get("runId") != self.run_id
            or lease.get("resourceKey")
            != f"station/{service_id}/mobile-oauth-fixture"
        ):
            raise StationFixtureConflict(
                f"Station Fixture lease identity mismatch for {service_id}"
            )

    @staticmethod
    def _require_same_fence(
        expected: Mapping[str, Any],
        observed: Mapping[str, Any],
    ) -> None:
        for field in ("resourceKey", "holderRunId", "fenceToken"):
            if observed.get(field) != expected.get(field):
                raise StationFixtureConflict(
                    f"Station Fixture lease fence mismatch: {field}"
                )

    def _require_snapshot_identity(
        self,
        service_id: str,
        lease: Mapping[str, Any],
        variant_id: str,
        snapshot_phase: str,
        snapshot: Mapping[str, Any],
    ) -> None:
        if (
            snapshot.get("variantId") != variant_id
            or snapshot.get("snapshotPhase") != snapshot_phase
            or _required_mapping(snapshot, "service").get("serviceId")
            != service_id
            or snapshot.get("runId") != lease.get("holderRunId")
        ):
            raise StationFixtureConflict(
                "Station Fixture proof snapshot identity mismatch"
            )

    def _lease(
        self,
        service_id: str,
        *,
        allow_released: bool = False,
    ) -> dict[str, Any]:
        self._require_service_available(service_id)
        lease = self.leases.get(service_id)
        if lease is None:
            raise StationFixtureError(
                f"Station Fixture lease is missing for {service_id}"
            )
        if not allow_released and lease.get("state") == "RELEASED":
            raise StationFixtureError(
                f"Station Fixture lease is already released for {service_id}"
            )
        return lease

    def _require_service_available(self, service_id: str) -> None:
        if service_id not in SERVICES:
            raise StationFixtureError(
                f"Station Fixture service {service_id!r} is not declared"
            )
        if self._closed:
            raise StationFixtureError("Station Fixture correlation channel is closed")
        if service_id in self.quarantined:
            raise StationFixtureConflict(
                f"Station Fixture resource {service_id} is quarantined"
            )

    def _quarantine(self, service_id: str, reason: str) -> None:
        if service_id not in SERVICES:
            return
        self.quarantined[service_id] = reason
        lease = self.leases.get(service_id)
        if lease is not None:
            quarantined = dict(lease)
            quarantined["state"] = "QUARANTINED"
            quarantined["quarantineReason"] = reason
            self.leases[service_id] = quarantined

    def _finalize_operation(
        self,
        pending: PendingFixtureOperation,
        post_cleanup: ArtifactRef,
    ) -> dict[str, Any]:
        receipt = pending.receipt
        payload = {
            "artifactKind": "mobile-oauth-fixture-operation",
            "operationId": receipt["operationId"],
            "inputDigest": receipt["inputDigest"],
            "resourceKey": receipt["resourceKey"],
            "holderRunId": receipt["holderRunId"],
            "fenceToken": receipt["fenceToken"],
            "runId": receipt["runId"],
            "gateId": receipt["gateId"],
            "variantId": receipt["variantId"],
            "operation": receipt["operation"],
            "target": receipt["target"],
            "precondition": {
                "oauthState": receipt["oauthState"],
                "runOwned": True,
            },
            "result": {
                "journalState": receipt["journalState"],
                "preconditionMatched": receipt["preconditionMatched"],
                "affectedRows": receipt["affectedRows"],
                "before": pending.before.to_dict(),
                "after": pending.after.to_dict(),
                "postCleanup": post_cleanup.to_dict(),
            },
        }
        return self._validate_payload(
            payload,
            expected_kind="mobile-oauth-fixture-operation",
        )


def _required_mapping(
    owner: Mapping[str, Any],
    field: str,
) -> Mapping[str, Any]:
    value = owner.get(field)
    if not isinstance(value, Mapping):
        raise StationFixtureError(f"Station Fixture requires object {field!r}")
    return value


def _required_text(owner: Mapping[str, Any], field: str) -> str:
    value = owner.get(field)
    if not isinstance(value, str) or not value:
        raise StationFixtureError(f"Station Fixture requires text {field!r}")
    return value


def _required_positive_int(owner: Mapping[str, Any], field: str) -> int:
    value = owner.get(field)
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise StationFixtureError(
            f"Station Fixture requires positive integer {field!r}"
        )
    return value


def _lease_identity(lease: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "resourceKey": _required_text(lease, "resourceKey"),
        "holderRunId": _required_text(lease, "holderRunId"),
        "fenceToken": _required_positive_int(lease, "fenceToken"),
    }


def _canonical_target(target: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "serviceId": _required_text(target, "serviceId"),
        "oauthAttemptRef": _required_text(target, "oauthAttemptRef"),
        "accessAttemptRef": _required_text(target, "accessAttemptRef"),
        "deviceAlias": _required_text(target, "deviceAlias"),
        "lifecycleGeneration": _required_positive_int(
            target,
            "lifecycleGeneration",
        ),
    }


def _utc_timestamp(value: datetime) -> str:
    normalized = value.astimezone(timezone.utc)
    return normalized.isoformat(timespec="microseconds").replace("+00:00", "Z")


def _go_json_bytes(value: Mapping[str, Any]) -> bytes:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return (
        encoded.replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
        .encode("utf-8")
    )


def _decode_command_output(raw: str, operation: str) -> dict[str, Any]:
    if len(raw.encode("utf-8")) > MAXIMUM_OUTPUT_BYTES:
        raise StationFixtureError(
            f"Station Fixture {operation} output exceeded its bound"
        )
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise StationFixtureError(
            f"Station Fixture {operation} returned invalid JSON"
        ) from error
    if not isinstance(value, dict):
        raise StationFixtureError(
            f"Station Fixture {operation} returned a non-object payload"
        )
    return value


def _is_conflict(stderr: str) -> bool:
    normalized = stderr.lower()
    return any(
        marker in normalized
        for marker in (" conflict", "stale fence", "already committed")
    )


def _conflict_reason(error: Exception) -> str:
    if isinstance(error, StationFixtureConflict):
        return "cleanup_conflict"
    return "cleanup_failed"


def _provider_for_client(client_id: str) -> str:
    providers = {
        "alice-ios": "github",
        "bob-android": "github",
        "bob-ios": "google",
        "alice-android": "google",
    }
    try:
        return providers[client_id]
    except KeyError as error:
        raise StationFixtureError(
            f"Station Fixture client {client_id!r} is not declared"
        ) from error


def _empty_cleanup_target(
    service_id: str,
    run_id: str,
) -> tuple[str, dict[str, Any]]:
    clients = {
        "station-primary": ("expiry-ios", "alice-ios"),
        "station-secondary": ("success-ios-google", "bob-ios"),
    }
    try:
        variant_id, client_id = clients[service_id]
    except KeyError as error:
        raise StationFixtureError(
            f"Station Fixture service {service_id!r} is not declared"
        ) from error
    return variant_id, {
        "serviceId": service_id,
        "oauthAttemptRef": f"no-journal-oauth-{run_id}",
        "accessAttemptRef": f"no-journal-access-{run_id}",
        "deviceAlias": client_id,
        "lifecycleGeneration": 1,
    }
