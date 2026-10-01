from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from tooling.acceptance.core import EvidenceStore, source_identity
from tooling.acceptance.gates.agent.agent_v2_candidate_producer import (
    AgentV2CandidateAssembler,
    AgentV2RuntimeAttestation,
    AgentV2RuntimeTuple,
    AgentV2TupleObservation,
    load_gate_tuples,
)
from tooling.acceptance.gates.agent.capability_binding_candidate import (
    ACTOR_ACCOUNT,
    CapabilityBindingCandidateProducer,
    CapabilityBindingMobileAdapter,
    CapabilityBindingRetirementAdapter,
    CapabilityBindingRuntimeAdapter,
    ROOT,
    _deploy_acceptance_station,
    _load_script,
)


GATE_ID = "agent-v2-capability-binding-e2e"
HASH = "a" * 64
OBSERVED_AT = "2026-09-19T00:00:00.000000+00:00"


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _role_observation(
    runtime_tuple: AgentV2RuntimeTuple,
    role: str,
    suffix: str,
) -> dict[str, Any]:
    if role == "receiver-dom":
        return {
            "scenarioId": runtime_tuple.cell,
            "cellId": runtime_tuple.cell,
            "selector": "[data-pt-agent-capability]",
            "locale": runtime_tuple.locale,
            "textHash": _hash("receiver-" + suffix),
            "expectedVisible": True,
            "visible": True,
        }
    if role == "station-readback":
        return {
            "entityKind": "agent-capability-authority",
            "entityIdHash": _hash("entity-" + suffix),
            "revision": 1,
            "stateHash": _hash("state-" + suffix),
        }
    if role == "readiness-snapshots":
        state = "unknown" if runtime_tuple.cell == "TAX-05" else "ready"
        return {
            "snapshotId": "snapshot-" + suffix,
            "state": state,
            "authority": "station",
            "revision": 1,
        }
    if role == "zero-execution":
        return {
            "counterKind": "agent-turn-trace-delta",
            "count": 0,
            "expected": 0,
        }
    if role == "measurement-report":
        return {
            "metric": "capability-control-plane-duration-ms",
            "sampleIds": [runtime_tuple.sample_id],
            "threshold": "120000",
            "passed": True,
        }
    if role == "side-effect-count":
        return {
            "counterId": "agent-turn-trace-delta-" + suffix,
            "count": 0,
            "maximum": 0,
        }
    if role == "replay":
        replay_hash = _hash("replay-" + suffix)
        return {
            "sourceHash": replay_hash,
            "replayHash": replay_hash,
            "equal": True,
        }
    if role == "contract-evidence":
        return {
            "contractId": runtime_tuple.cell,
            "contractHash": _hash("contract-" + suffix),
            "platform": runtime_tuple.platform,
            "status": "passed",
            "roundTripEqual": True,
        }
    if role == "guard-report":
        return {
            "guardId": runtime_tuple.cell,
            "sourceInventoryHash": _hash("guard-" + suffix),
            "violationCount": 0,
            "passed": True,
        }
    if role == "cleanup":
        return {
            "resourceKind": "j02-fixture",
            "resourceIdHash": _hash("cleanup-" + suffix),
            "status": "clean",
        }
    raise AssertionError(f"unexpected role: {role}")


def _observation(runtime_tuple: AgentV2RuntimeTuple) -> AgentV2TupleObservation:
    suffix = _hash(runtime_tuple.key)[:16]
    execution_id = "execution-" + suffix
    roles = {
        role: _role_observation(runtime_tuple, role, suffix)
        for role in runtime_tuple.role_policy.adapter_roles
    }
    common = {
        "scenarioExecutionId": execution_id,
        "stationProfile": "two",
        "networkPath": "test",
        "machine": "test-machine",
        "coldWarmState": (
            "contract"
            if runtime_tuple.runtime_attestation_profile == "contract_only"
            else "neutral"
        ),
        "observedAt": OBSERVED_AT,
    }
    if runtime_tuple.runtime_attestation_profile == "station_control_plane":
        payload = {
            **common,
            "actorIdentityHash": HASH,
            "desktopMode": runtime_tuple.platform,
            "controlPlaneAttestation": {
                "authority": "station-capability-authority",
                "entityIdHash": _hash("entity-" + suffix),
                "readinessSnapshotId": "snapshot-" + suffix,
                "revision": 1,
                "stateHash": _hash("state-" + suffix),
                "zeroExecutionCount": 0,
            },
        }
    elif runtime_tuple.runtime_attestation_profile == "contract_only":
        payload = {
            **common,
            "contractAttestation": {
                "contractId": runtime_tuple.cell,
                "contractRunId": "contract-run-" + suffix,
                "contractHash": _hash("contract-" + suffix),
                "platform": runtime_tuple.platform,
                "toolchain": "vitest-generated-protobuf",
                "roundTripStatus": "passed",
            },
        }
    else:
        payload = {
            **common,
            "guardAttestation": {
                "guardId": runtime_tuple.cell,
                "sourceInventoryHash": _hash("guard-" + suffix),
                "violationCount": 0,
            },
        }
    return AgentV2TupleObservation(
        tuple_key=runtime_tuple.key,
        observed=True,
        passed=True,
        runtime_attestation=AgentV2RuntimeAttestation(
            runtime_tuple.runtime_attestation_profile,
            payload,
        ),
        role_observations=roles,
    )


class RecordingAdapter:
    def __init__(self) -> None:
        self.keys: list[str] = []

    def observe(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> AgentV2TupleObservation:
        self.keys.append(runtime_tuple.key)
        return _observation(runtime_tuple)


class CapabilityBindingCandidateTest(unittest.TestCase):
    def test_native_scenario_supplies_capability_session_to_readiness(self) -> None:
        scenario = (
            ROOT
            / "apps/desktop/src/acceptance/agent/capabilityBindingScenario.ts"
        ).read_text(encoding="utf-8")
        harness = (
            ROOT
            / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "input.platform !== 'desktop_app'",
            harness,
        )
        self.assertIn(
            "clientCapabilitySessionId,",
            harness,
        )
        self.assertIn(
            "loadAgent(agentId, readinessInput)",
            scenario,
        )
        self.assertIn(
            "client_capability_session_id: clientCapabilitySessionId",
            scenario,
        )

    def test_deploys_station_with_run_scoped_scenario_control(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["make", "station"],
            returncode=0,
            stdout="[OK] station start",
            stderr="",
        )
        with patch(
            "tooling.acceptance.gates.agent."
            "capability_binding_candidate.subprocess.run",
            return_value=completed,
        ) as run:
            _deploy_acceptance_station(
                {"PT_STATION_DEPLOY_ENV": "station-two"},
                "run-capability-binding",
            )

        self.assertEqual(run.call_args.args[0], ["make", "station"])
        self.assertEqual(
            run.call_args.kwargs["env"]["PT_ACCEPTANCE_ENVIRONMENT"],
            "home-station",
        )
        self.assertEqual(
            run.call_args.kwargs["env"][
                "PT_AGENT_CAPABILITY_SCENARIO_CONTROL"
            ],
            "1",
        )
        self.assertEqual(
            run.call_args.kwargs["env"]["PT_ACCEPTANCE_RUN_ID"],
            "run-capability-binding",
        )

    def test_runtime_adapter_prepares_selects_and_cleans_shared_agent(self) -> None:
        runtime_tuple = next(
            item
            for item in load_gate_tuples(GATE_ID)
            if item.runtime_attestation_profile == "station_control_plane"
        )

        class Client:
            def __init__(self, runtime: str) -> None:
                self.spec = SimpleNamespace(runtime=runtime)
                self.calls: list[tuple[str, dict[str, Any]]] = []

            def configure_station(self, *, timeout: int) -> None:
                self.calls.append(("configure_station", {"timeout": timeout}))

            def harness(
                self,
                method: str,
                payload: dict[str, Any],
                *,
                timeout: int,
            ) -> dict[str, Any]:
                self.calls.append((method, payload))
                if method == "loginWithPassword":
                    return {
                        "authenticated": True,
                        "actorId": "ptid:person:candidate",
                    }
                if method == "getAcceptanceHarnessStatus":
                    return {"ready": True}
                if method == "navigateToAgent":
                    return {"navigated": True}
                if method == "prepareCapabilityBindingCandidate":
                    return {
                        "agentId": "agent-candidate",
                        "agentName": "candidate-agent",
                        "providerId": "ollama",
                        "modelId": "model-candidate",
                        "priorSelection": "",
                        "priorSurface": "chat",
                    }
                if method == "cleanupCapabilityBindingCandidate":
                    return {"status": "clean", "failures": []}
                if method == "runCapabilityBindingScenario":
                    suffix = _hash(runtime_tuple.key)[:16]
                    return {
                        "runtime": {
                            "scenarioExecutionId": payload[
                                "scenarioExecutionId"
                            ],
                            "actorPtid": "ptid:person:candidate",
                            "observedAt": OBSERVED_AT,
                            "controlPlaneAttestation": {
                                "authority": "station-capability-authority",
                                "entityIdHash": _hash("entity-" + suffix),
                                "readinessSnapshotId": "snapshot-" + suffix,
                                "revision": 1,
                                "stateHash": _hash("state-" + suffix),
                                "zeroExecutionCount": 0,
                            },
                        },
                        "assertions": {"passed": True},
                        "roles": {
                            role: _role_observation(
                                runtime_tuple,
                                role,
                                suffix,
                            )
                            for role in runtime_tuple.role_policy.adapter_roles
                        },
                    }
                raise AssertionError(f"unexpected Harness method: {method}")

        native = Client("native")
        browser = Client("browser")
        adapter = CapabilityBindingRuntimeAdapter(
            SimpleNamespace(native=native, browser=browser),
            {
                "CHAT_NATIVE_DEMO_PASSWORD": "fixture-password",
                "PT_DEV_PROFILE": "two",
            },
            "run-1",
        )

        observation = adapter.observe(runtime_tuple)
        adapter.cleanup()

        self.assertTrue(observation.passed)
        scenario_call = next(
            payload
            for method, payload in (
                native.calls + browser.calls
            )
            if method == "runCapabilityBindingScenario"
        )
        self.assertEqual(scenario_call["agentName"], "candidate-agent")
        login_accounts = [
            payload["account"]
            for method, payload in native.calls + browser.calls
            if method == "loginWithPassword"
        ]
        self.assertEqual(login_accounts, [ACTOR_ACCOUNT, ACTOR_ACCOUNT])
        self.assertTrue(any(
            method == "cleanupCapabilityBindingCandidate"
            for method, _ in native.calls
        ))

    def test_collects_all_69_tuples_with_distinct_adapter_ownership(self) -> None:
        runtime = RecordingAdapter()
        mobile = RecordingAdapter()
        guard = RecordingAdapter()
        producer = CapabilityBindingCandidateProducer(runtime, mobile, guard)

        observations = producer.collect()

        self.assertEqual(len(observations), 69)
        self.assertEqual(len(runtime.keys), 60)
        self.assertEqual(len(mobile.keys), 8)
        self.assertEqual(len(guard.keys), 1)

    def test_complete_candidate_passes_full_semantic_validator(self) -> None:
        producer = CapabilityBindingCandidateProducer(
            RecordingAdapter(),
            RecordingAdapter(),
            RecordingAdapter(),
        )
        observations = producer.collect()
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=ROOT)
            run = store.begin_run(GATE_ID, source=source_identity(ROOT))
            candidate = AgentV2CandidateAssembler(GATE_ID).produce(
                run,
                observations,
                candidate_name="capability-binding-test",
            )
            self.assertTrue(candidate.is_file())
            registration = json.loads(candidate.read_text(encoding="utf-8"))
            self.assertEqual(registration["proofStatus"], "UNPROVEN")
            acceptance_run = _load_script(
                ROOT / "tooling/scripts/acceptance-run.py",
                "_capability_binding_test_acceptance_run",
            )
            acceptance_run.emit_agent_v2_candidate_metadata(
                run,
                GATE_ID,
                source_identity(ROOT),
            )
            run.finalize(
                result={
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "CANDIDATE",
                }
            )
            candidate_ref = run.manifest_ref
            run.close()
            validator = _load_script(
                ROOT / "tooling/scripts/acceptance-validate.py",
                "_capability_binding_test_validator",
            )
            validated = validator.validate_candidate(
                store,
                candidate_ref,
                candidate_ref.sha256,
            )
            self.assertEqual(
                validated["candidate"]["result"]["proofStatus"],
                "CANDIDATE",
            )

    def test_mobile_adapter_invokes_one_marker_per_tuple(self) -> None:
        commands: list[tuple[str, ...]] = []

        def runner(
            command: tuple[str, ...],
            **_: Any,
        ) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            marker = command[command.index("-t") + 1]
            full_name = marker.replace(r"\[", "[").replace(r"\]", "]")
            report = {
                "testResults": [{
                    "assertionResults": [{
                        "fullName": full_name,
                        "status": "passed",
                    }],
                }],
            }
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps(report),
                stderr="",
            )

        adapter = CapabilityBindingMobileAdapter(
            runner=runner,
            now=lambda: datetime(2026, 9, 19, tzinfo=timezone.utc),
        )
        mobile_tuples = [
            runtime_tuple
            for runtime_tuple in load_gate_tuples(GATE_ID)
            if runtime_tuple.runtime_attestation_profile == "contract_only"
        ]
        observations = [adapter.observe(item) for item in mobile_tuples]

        self.assertEqual(len(commands), 8)
        self.assertEqual(len({command[command.index("-t") + 1] for command in commands}), 8)
        self.assertEqual(
            len({
                item.runtime_attestation.payload["scenarioExecutionId"]
                for item in observations
            }),
            8,
        )

    def test_retirement_adapter_runs_all_scoped_guards(self) -> None:
        commands: list[tuple[str, ...]] = []

        def runner(
            command: tuple[str, ...],
            **_: Any,
        ) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            return subprocess.CompletedProcess(command, 0, stdout="passed", stderr="")

        runtime_tuple = next(
            item
            for item in load_gate_tuples(GATE_ID)
            if item.runtime_attestation_profile == "orchestration_guard"
        )
        observation = CapabilityBindingRetirementAdapter(
            runner=runner,
            now=lambda: datetime(2026, 9, 19, tzinfo=timezone.utc),
        ).observe(runtime_tuple)

        self.assertEqual(len(commands), 3)
        self.assertEqual(
            observation.role_observations["guard-report"]["violationCount"],
            0,
        )
        self.assertEqual(
            observation.role_observations["zero-execution"]["count"],
            0,
        )


if __name__ == "__main__":
    unittest.main()
