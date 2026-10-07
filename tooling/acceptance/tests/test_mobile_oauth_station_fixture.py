from __future__ import annotations

import copy
import hashlib
import inspect
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from collections.abc import Mapping, Sequence
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core import (
    REPO_ROOT,
    ArtifactRef,
    BlockedError,
    workspace_id,
)
from tooling.acceptance.fixtures import mobile_native_reset
from tooling.acceptance.fixtures.mobile_oauth_station import (
    COMMANDS_ENVIRONMENT,
    HMAC_FD_ENVIRONMENT,
    MAXIMUM_OUTPUT_BYTES,
    MobileOAuthStationFixture,
    STATION_COMMAND_ENVIRONMENT_KEYS,
    StationCommandResult,
    StationFixtureConflict,
    StationFixtureError,
    SubprocessStationCommandExecutor,
    load_deployment_commands,
    operation_input_digest,
)
from tooling.acceptance.gates.mobile.proof_contracts import GATE_ID
from tooling.acceptance.gates.mobile.proof_contracts_test import (
    RUN_ID,
    fixture_lease,
    station_snapshot,
)


class FakeRunHandle:
    gate_id = GATE_ID
    run_id = RUN_ID

    def __init__(self) -> None:
        self.writes: list[tuple[str, dict, str | None, bool]] = []

    def write_json(
        self,
        relative_path: str,
        value: Mapping[str, object],
        *,
        role: str | None = None,
        redact: bool = True,
    ) -> ArtifactRef:
        payload = copy.deepcopy(dict(value))
        self.writes.append((relative_path, payload, role, redact))
        encoded = json.dumps(payload, sort_keys=True).encode("utf-8")
        return ArtifactRef(
            workspace_id=workspace_id(REPO_ROOT),
            gate_id=self.gate_id,
            run_id=self.run_id,
            path=relative_path,
            sha256=hashlib.sha256(encoded).hexdigest(),
            media_type="application/json",
        )


class FakeStationExecutor:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.conflict_service = ""
        self.fail_once_operation = ""
        self.failed_once = False

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
        service_id = command[0]
        operation = command[-1]
        payload = json.loads(input_text) if input_text else {}
        correlation_key = b""
        if pass_fds:
            correlation_key = os.read(pass_fds[0], 4096)
        self.calls.append(
            {
                "serviceId": service_id,
                "command": tuple(command),
                "operation": operation,
                "payload": payload,
                "hmacFd": environment.get(
                    "PT_MOBILE_OAUTH_ACCEPTANCE_HMAC_FD",
                    "",
                ),
                "environment": dict(environment),
                "correlationKey": correlation_key,
                "deadlineMonotonic": deadline_monotonic,
                "cancellation": cancellation,
            }
        )

        if (
            operation == self.fail_once_operation
            and not self.failed_once
        ):
            self.failed_once = True
            raise StationFixtureError("unknown outcome")
        if operation == "cleanup_run" and service_id == self.conflict_service:
            return StationCommandResult(
                returncode=1,
                stderr="mobile OAuth Acceptance cleanup conflict",
            )
        if operation in {"bootstrap", "teardown"}:
            return self._result({"operation": operation, "status": "DONE"})
        if operation in {"acquire_lease", "heartbeat_lease"}:
            lease = fixture_lease(service_id)
            if operation == "heartbeat_lease":
                lease.update(
                    {
                        "heartbeatAt": payload["heartbeatAt"],
                        "renewBefore": payload["renewBefore"],
                        "expiresAt": payload["expiresAt"],
                    }
                )
            return self._result(lease)
        if operation == "read_proof_snapshot":
            snapshot = station_snapshot(
                phase=payload["snapshotPhase"],
                service_id=service_id,
                variant_id=payload["variantId"],
            )
            snapshot["fixture"]["operationId"] = payload["operationId"]
            return self._result(snapshot)
        if operation in {
            "prepare_following_gate",
            "expire_awaiting_attempt",
            "cleanup_run",
        }:
            return self._result(
                {
                    "operationId": payload["operationId"],
                    "inputDigest": payload["inputDigest"],
                    "resourceKey": payload["lease"]["resourceKey"],
                    "holderRunId": payload["lease"]["holderRunId"],
                    "fenceToken": payload["lease"]["fenceToken"],
                    "runId": payload["lease"]["holderRunId"],
                    "gateId": GATE_ID,
                    "variantId": payload["variantId"],
                    "operation": payload["operation"],
                    "target": payload["target"],
                    "oauthState": payload["oauthState"],
                    "journalState": "COMMITTED",
                    "preconditionMatched": True,
                    "affectedRows": 1,
                    "before": {"state": "before"},
                    "after": {"state": "after"},
                }
            )
        return StationCommandResult(returncode=1, stderr="not allowlisted")

    @staticmethod
    def _result(payload: Mapping[str, object]) -> StationCommandResult:
        return StationCommandResult(
            returncode=0,
            stdout=json.dumps(payload),
        )


def target(service_id: str, client_id: str) -> dict[str, object]:
    return {
        "serviceId": service_id,
        "oauthAttemptRef": f"oauth-{client_id}",
        "accessAttemptRef": f"access-{client_id}",
        "deviceAlias": client_id,
        "lifecycleGeneration": 7,
    }


class MobileOAuthStationFixtureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.writer = FakeRunHandle()
        self.executor = FakeStationExecutor()
        self.fixture = MobileOAuthStationFixture(
            run_handle=self.writer,
            commands={
                "station-primary": ("station-primary",),
                "station-secondary": ("station-secondary",),
            },
            correlation_key=b"k" * 32,
            executor=self.executor,
            environment={},
        )

    def test_deployment_commands_require_exact_json_argv_map(self) -> None:
        commands = load_deployment_commands(
            {
                COMMANDS_ENVIRONMENT: json.dumps(
                    {
                        "station-primary": ["ssh", "primary", "adapter"],
                        "station-secondary": ["ssh", "secondary", "adapter"],
                    }
                )
            }
        )
        self.assertEqual(
            commands["station-primary"],
            ("ssh", "primary", "adapter"),
        )
        with self.assertRaises(BlockedError):
            load_deployment_commands(
                {COMMANDS_ENVIRONMENT: '{"station-primary":"ssh primary"}'}
            )
        with self.assertRaises(BlockedError):
            load_deployment_commands(
                {
                    COMMANDS_ENVIRONMENT: json.dumps(
                        {
                            "station-primary": ["adapter", "--operation"],
                            "station-secondary": ["adapter"],
                        }
                    )
                }
            )

    def test_operation_digest_matches_go_canonical_field_order(self) -> None:
        request = {
            "lease": {
                "resourceKey": (
                    "station/station-primary/mobile-oauth-fixture"
                ),
                "holderRunId": "run-1",
                "fenceToken": 7,
            },
            "variantId": "expiry-ios",
            "operation": "expire_awaiting_attempt",
            "target": {
                "lifecycleGeneration": 3,
                "deviceAlias": "alice-ios",
                "accessAttemptRef": "access-1",
                "oauthAttemptRef": "oauth-1",
                "serviceId": "station-primary",
            },
            "oauthState": "OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER",
        }
        self.assertEqual(
            operation_input_digest(request),
            "sha256:9140afc8b6ee69699a486f50d7525a91"
            "c177e41d3a70854fe5fbab5c93775bba",
        )

    def test_acquire_validates_before_run_handle_write(self) -> None:
        lease = self.fixture.acquire("station-primary")
        self.assertEqual(lease["fenceToken"], 11)
        self.assertEqual(
            self.writer.writes[0][0],
            "runtime/mobile/fixtures/station-primary/lease.json",
        )
        self.assertFalse(self.writer.writes[0][3])

        invalid = FakeStationExecutor()
        invalid.run = lambda *args, **kwargs: StationCommandResult(
            returncode=0,
            stdout='{"artifactKind":"mobile-oauth-fixture-lease"}',
        )
        fixture = MobileOAuthStationFixture(
            run_handle=FakeRunHandle(),
            commands={
                "station-primary": ("station-primary",),
                "station-secondary": ("station-secondary",),
            },
            correlation_key=b"k" * 32,
            executor=invalid,
            environment={},
        )
        with self.assertRaises(StationFixtureError):
            fixture.acquire("station-primary")
        self.assertEqual(fixture.run_handle.writes, [])

    def test_execute_retries_same_identity_and_uses_anonymous_hmac_pipe(
        self,
    ) -> None:
        self.fixture.acquire("station-primary")
        self.executor.fail_once_operation = "expire_awaiting_attempt"
        receipt = self.fixture.execute(
            "station-primary",
            operation_id="expiry-ios-operation",
            variant_id="expiry-ios",
            operation="expire_awaiting_attempt",
            target=target("station-primary", "alice-ios"),
            oauth_state="OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER",
            expected_provider="github",
        )
        retried = self.fixture.execute(
            "station-primary",
            operation_id="expiry-ios-operation",
            variant_id="expiry-ios",
            operation="expire_awaiting_attempt",
            target=target("station-primary", "alice-ios"),
            oauth_state="OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER",
            expected_provider="github",
        )
        self.assertEqual(retried, receipt)
        mutation_calls = [
            call
            for call in self.executor.calls
            if call["operation"] == "expire_awaiting_attempt"
        ]
        self.assertEqual(len(mutation_calls), 2)
        self.assertEqual(
            mutation_calls[0]["payload"]["operationId"],
            mutation_calls[1]["payload"]["operationId"],
        )
        self.assertEqual(
            mutation_calls[0]["payload"]["inputDigest"],
            mutation_calls[1]["payload"]["inputDigest"],
        )
        snapshot_calls = [
            call
            for call in self.executor.calls
            if call["operation"] == "read_proof_snapshot"
        ]
        self.assertEqual(len(snapshot_calls), 2)
        self.assertTrue(all(call["hmacFd"] for call in snapshot_calls))
        self.assertTrue(
            all(call["correlationKey"] == b"k" * 32 for call in snapshot_calls)
        )

    def test_reused_operation_id_with_changed_input_quarantines(self) -> None:
        self.fixture.acquire("station-primary")
        self.fixture.execute(
            "station-primary",
            operation_id="stable-operation",
            variant_id="expiry-ios",
            operation="expire_awaiting_attempt",
            target=target("station-primary", "alice-ios"),
            oauth_state="OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER",
            expected_provider="github",
        )
        with self.assertRaises(StationFixtureConflict):
            self.fixture.execute(
                "station-primary",
                operation_id="stable-operation",
                variant_id="expiry-ios",
                operation="expire_awaiting_attempt",
                target={
                    **target("station-primary", "alice-ios"),
                    "lifecycleGeneration": 8,
                },
                oauth_state="OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER",
                expected_provider="github",
            )
        self.assertEqual(
            self.fixture.leases["station-primary"]["state"],
            "QUARANTINED",
        )

    def test_cleanup_runs_in_reverse_order_and_quarantines_conflict(
        self,
    ) -> None:
        for service_id in ("station-primary", "station-secondary"):
            self.fixture.acquire(service_id)
        self.fixture.execute(
            "station-primary",
            operation_id="expiry-ios-operation",
            variant_id="expiry-ios",
            operation="expire_awaiting_attempt",
            target=target("station-primary", "alice-ios"),
            oauth_state="OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER",
            expected_provider="github",
        )

        self.executor.conflict_service = "station-primary"
        with self.assertRaises(StationFixtureConflict):
            self.fixture.cleanup()

        cleanup_services = [
            call["serviceId"]
            for call in self.executor.calls
            if call["operation"] == "cleanup_run"
        ]
        self.assertEqual(
            cleanup_services,
            ["station-secondary", "station-primary"],
        )
        self.assertIn("station-primary", self.fixture.quarantined)
        self.assertEqual(
            self.fixture.leases["station-primary"]["state"],
            "QUARANTINED",
        )
        self.assertEqual(set(self.fixture.correlation_key), {0})
        self.assertTrue(
            any(
                path
                == (
                    "evidence/mobile/cleanup/station/"
                    "station-secondary.json"
                )
                for path, _, _, _ in self.writer.writes
            )
        )

    def test_receipt_fence_mismatch_is_rejected(self) -> None:
        self.fixture.acquire("station-primary")
        original = self.executor.run

        def stale_run(*args: object, **kwargs: object) -> StationCommandResult:
            result = original(*args, **kwargs)
            command = args[0]
            if command[-1] == "expire_awaiting_attempt":
                payload = json.loads(result.stdout)
                payload["fenceToken"] += 1
                return StationCommandResult(
                    returncode=0,
                    stdout=json.dumps(payload),
                )
            return result

        self.executor.run = stale_run
        with self.assertRaises(StationFixtureConflict):
            self.fixture.execute(
                "station-primary",
                operation_id="stale-fence-operation",
                variant_id="expiry-ios",
                operation="expire_awaiting_attempt",
                target=target("station-primary", "alice-ios"),
                oauth_state="OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER",
                expected_provider="github",
            )
        self.assertEqual(
            self.fixture.leases["station-primary"]["state"],
            "QUARANTINED",
        )

    def test_cleanup_releases_empty_lease_and_is_idempotent(self) -> None:
        self.fixture.acquire("station-primary")
        first = self.fixture.cleanup()
        second = self.fixture.cleanup()

        self.assertEqual(first, ("station-primary",))
        self.assertEqual(second, first)
        self.assertEqual(
            [
                call["operation"]
                for call in self.executor.calls
                if call["serviceId"] == "station-primary"
            ][-3:],
            ["cleanup_run", "read_proof_snapshot", "teardown"],
        )

    def test_cleanup_uses_one_deadline_and_honors_cancellation(self) -> None:
        self.fixture.acquire("station-primary")
        self.executor.calls.clear()
        deadline = time.monotonic() + 1

        self.fixture.cleanup(
            deadline_monotonic=deadline,
            cancellation=threading.Event(),
        )

        cleanup_deadlines = [
            float(call["deadlineMonotonic"])
            for call in self.executor.calls
            if call["operation"]
            in {"cleanup_run", "read_proof_snapshot", "teardown"}
        ]
        self.assertEqual(cleanup_deadlines, [deadline, deadline, deadline])

        fixture = MobileOAuthStationFixture(
            run_handle=self.writer,
            commands={
                "station-primary": ("station-primary",),
                "station-secondary": ("station-secondary",),
            },
            correlation_key=b"c" * 32,
            executor=self.executor,
        )
        fixture.acquire("station-primary")
        self.executor.calls.clear()
        cancellation = threading.Event()
        cancellation.set()
        with self.assertRaises(StationFixtureConflict):
            fixture.cleanup(
                deadline_monotonic=time.monotonic() + 1,
                cancellation=cancellation,
            )
        self.assertFalse(
            any(call["operation"] == "cleanup_run" for call in self.executor.calls)
        )

    @unittest.skipUnless(os.name == "posix", "POSIX process-group contract")
    def test_subprocess_executor_uses_minimal_environment_and_hmac_fd(
        self,
    ) -> None:
        read_fd, write_fd = os.pipe()
        os.write(write_fd, b"correlation-key")
        os.close(write_fd)
        script = (
            "import json, os; "
            f"fd = int(os.environ[{HMAC_FD_ENVIRONMENT!r}]); "
            "value = os.read(fd, 4096).decode('utf-8'); "
            "print(json.dumps({'keys': sorted(os.environ), 'value': value}))"
        )
        try:
            result = SubprocessStationCommandExecutor().run(
                (sys.executable, "-c", script),
                input_text="",
                environment={
                    "HOME": os.environ.get("HOME", ""),
                    "PATH": os.environ.get("PATH", ""),
                    "AWS_SECRET_ACCESS_KEY": "ambient-secret-canary",
                    HMAC_FD_ENVIRONMENT: str(read_fd),
                },
                pass_fds=(read_fd,),
                deadline_monotonic=time.monotonic() + 3,
                cancellation=threading.Event(),
            )
        finally:
            os.close(read_fd)

        payload = json.loads(result.stdout)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(payload["value"], "correlation-key")
        self.assertNotIn("AWS_SECRET_ACCESS_KEY", payload["keys"])
        self.assertLessEqual(
            set(payload["keys"]),
            {*STATION_COMMAND_ENVIRONMENT_KEYS, HMAC_FD_ENVIRONMENT},
        )

    def test_fixture_filters_environment_before_executor_dispatch(self) -> None:
        fixture = MobileOAuthStationFixture(
            run_handle=self.writer,
            commands={
                "station-primary": ("station-primary",),
                "station-secondary": ("station-secondary",),
            },
            correlation_key=b"k" * 32,
            executor=self.executor,
            environment={
                "HOME": "/tmp/mobile-fixture-home",
                "PATH": "/usr/bin",
                "AWS_SECRET_ACCESS_KEY": "ambient-secret-canary",
                "PT_MOBILE_RESOURCE_LEASE_AUTH_KEY": "lease-secret-canary",
                "PT_ACCEPTANCE_REDACTION_VALUES": "raw-redaction-canary",
            },
        )

        fixture.bootstrap()

        for invocation in self.executor.calls:
            child_environment = invocation["environment"]
            self.assertEqual(
                child_environment,
                {
                    "HOME": "/tmp/mobile-fixture-home",
                    "PATH": "/usr/bin",
                },
            )

    @unittest.skipUnless(os.name == "posix", "POSIX process-group contract")
    def test_subprocess_executor_cancellation_reaps_resistant_process_group(
        self,
    ) -> None:
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
            cancellation = threading.Event()

            def cancel_when_descendant_starts() -> None:
                deadline = time.monotonic() + 3
                while not pid_path.exists():
                    if time.monotonic() >= deadline:
                        return
                    time.sleep(0.01)
                cancellation.set()

            cancel_thread = threading.Thread(
                target=cancel_when_descendant_starts,
                daemon=True,
            )
            cancel_thread.start()
            with self.assertRaisesRegex(StationFixtureError, "cancelled"):
                SubprocessStationCommandExecutor().run(
                    (sys.executable, "-c", script, str(pid_path)),
                    input_text="",
                    environment={
                        "HOME": os.environ.get("HOME", ""),
                        "PATH": os.environ.get("PATH", ""),
                    },
                    pass_fds=(),
                    deadline_monotonic=time.monotonic() + 5,
                    cancellation=cancellation,
                )
            cancel_thread.join(timeout=1)

            descendant_pid = int(pid_path.read_text(encoding="utf-8"))
            with self.assertRaises(
                ProcessLookupError,
                msg=f"descendant process {descendant_pid} survived cancellation",
            ):
                os.kill(descendant_pid, 0)

    @unittest.skipUnless(os.name == "posix", "POSIX process-group contract")
    def test_subprocess_executor_rejects_unbounded_output(self) -> None:
        with self.assertRaisesRegex(StationFixtureError, "output exceeded"):
            SubprocessStationCommandExecutor().run(
                (
                    sys.executable,
                    "-c",
                    f"import sys; sys.stdout.write('x' * {MAXIMUM_OUTPUT_BYTES + 1})",
                ),
                input_text="",
                environment={
                    "HOME": os.environ.get("HOME", ""),
                    "PATH": os.environ.get("PATH", ""),
                },
                pass_fds=(),
                deadline_monotonic=time.monotonic() + 3,
                cancellation=threading.Event(),
            )

    def test_source_has_no_direct_evidence_or_database_access(self) -> None:
        source = (
            __import__(
                "tooling.acceptance.fixtures.mobile_oauth_station",
                fromlist=["__file__"],
            )
            .__file__
        )
        text = Path(source).read_text(encoding="utf-8")
        self.assertNotIn("write_current_artifact", text)
        self.assertNotIn("current_artifact_ref", text)
        self.assertNotIn("psycopg", text)
        self.assertNotIn("sqlite", text)
        self.assertNotIn("shell=True", text)

    def test_mobile_reset_composes_station_and_actor_cleanup_in_reverse(self) -> None:
        events: list[str] = []

        class StationCleanup:
            run_id = RUN_ID
            run_handle = FakeRunHandle()
            leases: dict[str, dict[str, object]] = {}
            lease_refs: dict[str, ArtifactRef] = {}
            quarantined: dict[str, str] = {}

            def cleanup(self) -> tuple[str, ...]:
                events.append("oauth")
                return ("station-secondary", "station-primary")

        environment = {
            "PT_MOBILE_STATION_PRIMARY_URL": "https://primary.invalid",
            "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV": "primary",
            "PT_MOBILE_STATION_SECONDARY_URL": "https://secondary.invalid",
            "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV": "secondary",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(
                mobile_native_reset,
                "require_station_reset_authority",
                return_value={"validation": "current"},
            ),
            patch.object(
                mobile_native_reset,
                "verify_reset_target",
                side_effect=lambda url, deploy: events.append(
                    f"verify:{deploy}"
                ),
            ),
            patch.object(
                mobile_native_reset,
                "reset_fixture",
                side_effect=lambda deploy, roles: events.append(
                    f"reset:{deploy}:{','.join(roles)}"
                ),
            ),
        ):
            mobile_native_reset.cleanup_fixture(StationCleanup())

        self.assertEqual(
            events,
            [
                "verify:secondary",
                "reset:secondary:alice,bob",
                "verify:primary",
                "reset:primary:alice,bob",
                "oauth",
            ],
        )

    def test_mobile_reset_does_not_own_parent_resource_cleanup(self) -> None:
        parameters = inspect.signature(
            mobile_native_reset.cleanup_fixture
        ).parameters
        self.assertEqual(tuple(parameters), ("station_fixture",))
        source = inspect.getsource(mobile_native_reset.cleanup_fixture)
        for forbidden_owner in (
            "lease_broker",
            "browser_leases",
            "physical_device_leases",
            "provider_account_leases",
            "cleanup_correlation_channel",
        ):
            with self.subTest(forbidden_owner=forbidden_owner):
                self.assertNotIn(forbidden_owner, source)

    def test_mobile_reset_emits_fixture_outcomes_after_station_proof(self) -> None:
        for service_id in ("station-primary", "station-secondary"):
            self.fixture.acquire(service_id)
        environment = {
            "PT_MOBILE_STATION_PRIMARY_URL": "https://primary.invalid",
            "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV": "primary",
            "PT_MOBILE_STATION_SECONDARY_URL": "https://secondary.invalid",
            "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV": "secondary",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(
                mobile_native_reset,
                "require_station_reset_authority",
                return_value={"validation": "current"},
            ),
            patch.object(mobile_native_reset, "verify_reset_target"),
            patch.object(mobile_native_reset, "reset_fixture"),
        ):
            result = mobile_native_reset.cleanup_fixture(self.fixture)

        self.assertEqual(
            [outcome["leaseId"] for outcome in result.fixture_outcomes],
            ["fixture-station-secondary", "fixture-station-primary"],
        )
        self.assertTrue(
            all(
                outcome["finalState"] == "RELEASED"
                for outcome in result.fixture_outcomes
            )
        )
        written_paths = [path for path, _, _, _ in self.writer.writes]
        for service_id in ("station-secondary", "station-primary"):
            proof_path = f"evidence/mobile/cleanup/station/{service_id}.json"
            outcome_path = (
                "evidence/mobile/cleanup/leases/"
                f"fixture-{service_id}.json"
            )
            self.assertLess(
                written_paths.index(proof_path),
                written_paths.index(outcome_path),
            )

    def test_mobile_reset_emits_typed_fixture_quarantine_on_conflict(self) -> None:
        for service_id in ("station-primary", "station-secondary"):
            self.fixture.acquire(service_id)
        self.executor.conflict_service = "station-primary"
        environment = {
            "PT_MOBILE_STATION_PRIMARY_URL": "https://primary.invalid",
            "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV": "primary",
            "PT_MOBILE_STATION_SECONDARY_URL": "https://secondary.invalid",
            "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV": "secondary",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(
                mobile_native_reset,
                "require_station_reset_authority",
                return_value={"validation": "current"},
            ),
            patch.object(mobile_native_reset, "verify_reset_target"),
            patch.object(mobile_native_reset, "reset_fixture"),
            self.assertRaises(BlockedError),
        ):
            mobile_native_reset.cleanup_fixture(self.fixture)

        outcomes = {
            payload["leaseId"]: payload
            for path, payload, _, _ in self.writer.writes
            if path.startswith("evidence/mobile/cleanup/leases/")
        }
        self.assertEqual(
            outcomes["fixture-station-secondary"]["finalState"],
            "RELEASED",
        )
        self.assertEqual(
            outcomes["fixture-station-primary"]["finalState"],
            "QUARANTINED",
        )
        self.assertEqual(
            outcomes["fixture-station-primary"]["failureCode"],
            "LEASE_CLEANUP_FAILED",
        )


if __name__ == "__main__":
    unittest.main()
