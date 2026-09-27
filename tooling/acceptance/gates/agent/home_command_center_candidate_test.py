from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tooling.acceptance.core import (
    ENVIRONMENTS_DIR,
    BlockedError,
    EnvironmentContract,
    EvidenceStore,
    source_identity,
)
from tooling.acceptance.gates.agent.agent_v2_candidate_producer import (
    AgentV2CandidateAssembler,
)
from tooling.acceptance.gates.agent.home_command_center_candidate import (
    AGENT_V2_HOME_GATE,
    MOBILE_MARKER,
    HomeCommandCenterCandidateError,
    HomeMobileContractAdapter,
    _authenticate,
    observation_from_home_capture,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientError,
)
from tooling.acceptance.provisioners.home_station import HomeStationProvisioner


ROOT = Path(__file__).resolve().parents[4]
ACTOR_PTID = "ptid:v1:actor:peers:p:bob:fixture"
ACTOR_HASH = (
    "ca2888c0db411d23b034264c469f60c64158c6b5c84fce3ff3ccd22354d07812"
)
OBSERVED_AT = "2026-09-18T00:00:00.000000+00:00"


def _hash(value: str) -> str:
    import hashlib

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _capture(runtime_tuple):
    suffix = _hash(runtime_tuple.key)[:16]
    command_id = f"home-command-{suffix}"
    object_id = f"home-object-{suffix}"
    capture = {
        "state": {
            "scenarioExecutionId": f"home-execution-{suffix}",
            "cell": runtime_tuple.cell,
            "locale": runtime_tuple.locale,
            "ordering": runtime_tuple.ordering,
            "sampleId": runtime_tuple.sample_id,
            "actorPtid": ACTOR_PTID,
        },
        "runtime": {
            "scenarioExecutionId": f"home-execution-{suffix}",
            "actorPtid": ACTOR_PTID,
            "commandId": command_id,
            "commandKind": f"home:{runtime_tuple.cell}",
            "idempotencyKeyHash": _hash(f"home-key-{suffix}"),
            "objectIds": [object_id],
            "projectionRevision": "2",
            "observedAt": OBSERVED_AT,
        },
        "roles": {
            "receiver-dom": {
                "scenarioId": runtime_tuple.cell,
                "cellId": runtime_tuple.cell,
                "selector": "[data-pt-home]",
                "locale": runtime_tuple.locale,
                "textHash": _hash(f"receiver-{suffix}"),
                "expectedVisible": True,
                "visible": True,
            },
            "station-readback": {
                "entityKind": "home-projection",
                "entityIdHash": _hash(f"projection-{suffix}"),
                "revision": "2",
                "stateHash": _hash(f"state-{suffix}"),
            },
            "command-ids": {
                "commandId": command_id,
                "idempotencyKeyHash": _hash(f"home-key-{suffix}"),
                "objectIds": [object_id],
            },
            "projection-revisions": {
                "slice": "home",
                "beforeRevision": "1",
                "afterRevision": "2",
            },
            "measurement-report": {
                "metric": "home-command-center",
                "sampleIds": [runtime_tuple.sample_id],
                "threshold": "passed",
                "passed": True,
            },
            "side-effect-count": {
                "counterId": f"counter-{suffix}",
                "count": 1,
                "maximum": 1,
            },
            "replay": {
                "sourceHash": _hash(f"replay-{suffix}"),
                "replayHash": _hash(f"replay-{suffix}"),
                "equal": True,
            },
        },
        "assertions": {"scenarioPassed": True},
    }
    if runtime_tuple.cell in {"AS-02", "AS-13"}:
        capture["recovery"] = {"recovered": True}
    if runtime_tuple.cell == "R-11":
        capture["barrier"] = {
            "orderings": [
                {
                    "kind": "home-chat-idempotency",
                    "ordering": runtime_tuple.ordering,
                },
                {
                    "kind": "home-task-idempotency",
                    "ordering": runtime_tuple.ordering,
                },
            ]
        }
    return capture


def _mobile_runner(*_args, **_kwargs):
    return subprocess.CompletedProcess(
        args=[],
        returncode=0,
        stdout=json.dumps(
            {
                "success": True,
                "testResults": [
                    {
                        "assertionResults": [
                            {
                                "fullName": (
                                    "Modern Chat Agent V2 Mobile Foundation "
                                    f"contracts {MOBILE_MARKER} round-trips"
                                ),
                                "status": "passed",
                            }
                        ]
                    }
                ],
            }
        ),
        stderr="",
    )


class HomeCommandCenterCandidateTest(unittest.TestCase):
    def test_authentication_waits_for_in_progress_station_switch(self) -> None:
        class Client:
            spec = SimpleNamespace(runtime="browser")

            def __init__(self) -> None:
                self.configure_attempts = 0

            def configure_station(self, *, timeout: int) -> None:
                self.configure_attempts += 1
                if self.configure_attempts == 1:
                    raise FoundationClientError(
                        "Another Station switch is already in progress"
                    )

            def harness(self, method, _payload, *, timeout):
                if method == "loginWithPassword":
                    return {"authenticated": True, "actorId": ACTOR_PTID}
                if method == "getAcceptanceHarnessStatus":
                    return {"ready": True}
                raise AssertionError(method)

        client = Client()
        with patch(
            "tooling.acceptance.gates.agent."
            "home_command_center_candidate.time.sleep"
        ) as sleep:
            actor = _authenticate(
                client,
                {"CHAT_NATIVE_DEMO_PASSWORD": "fixture-password"},
            )

        self.assertEqual(actor, ACTOR_PTID)
        self.assertEqual(client.configure_attempts, 2)
        sleep.assert_called_once_with(0.25)

    def test_authentication_does_not_retry_other_station_failures(self) -> None:
        class Client:
            spec = SimpleNamespace(runtime="browser")

            def __init__(self) -> None:
                self.configure_attempts = 0

            def configure_station(self, *, timeout: int) -> None:
                self.configure_attempts += 1
                raise FoundationClientError("Station is offline")

        client = Client()
        with self.assertRaisesRegex(FoundationClientError, "offline"):
            _authenticate(
                client,
                {"CHAT_NATIVE_DEMO_PASSWORD": "fixture-password"},
            )
        self.assertEqual(client.configure_attempts, 1)

    def test_all_33_observations_pass_shared_candidate_assembler(self) -> None:
        assembler = AgentV2CandidateAssembler(AGENT_V2_HOME_GATE)
        mobile = HomeMobileContractAdapter(
            runner=_mobile_runner,
            now=lambda: datetime(2026, 9, 18, tzinfo=timezone.utc),
        )
        observations = []
        for runtime_tuple in assembler.runtime_tuples:
            if runtime_tuple.runtime_attestation_profile == "contract_only":
                observation = mobile.observe(runtime_tuple)
            else:
                observation = observation_from_home_capture(
                    runtime_tuple,
                    _capture(runtime_tuple),
                    {
                        "resourceKind": "home-fixture",
                        "resourceIdHash": _hash(runtime_tuple.key),
                        "status": "clean",
                    },
                    actor_identity_hash=ACTOR_HASH,
                    machine="test-machine",
                )
            observations.append((runtime_tuple, observation))

        self.assertEqual(len(observations), 33)
        self.assertEqual(
            len(
                {
                    observation.runtime_attestation.payload[
                        "scenarioExecutionId"
                    ]
                    for _, observation in observations
                }
            ),
            33,
        )

        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=ROOT)
            run = store.begin_run(
                AGENT_V2_HOME_GATE,
                source=source_identity(ROOT),
            )
            try:
                candidate = assembler.produce(
                    run,
                    observations,
                    candidate_name="home-command-center-test",
                )
                registration = json.loads(
                    candidate.read_text(encoding="utf-8")
                )
                self.assertEqual(registration["proofStatus"], "UNPROVEN")
            finally:
                run.close()

    def test_runtime_capture_rejects_unclean_fixture(self) -> None:
        runtime_tuple = next(
            runtime_tuple
            for runtime_tuple in AgentV2CandidateAssembler(
                AGENT_V2_HOME_GATE
            ).runtime_tuples
            if runtime_tuple.runtime_attestation_profile == "station_command"
        )
        with self.assertRaisesRegex(
            HomeCommandCenterCandidateError,
            "cleanup failed",
        ):
            observation_from_home_capture(
                runtime_tuple,
                _capture(runtime_tuple),
                {
                    "resourceKind": "home-fixture",
                    "resourceIdHash": _hash(runtime_tuple.key),
                    "status": "failed",
                },
                actor_identity_hash=ACTOR_HASH,
                machine="test-machine",
            )

    def test_mobile_contract_marker_is_bound_to_current_source(self) -> None:
        runtime_tuple = next(
            runtime_tuple
            for runtime_tuple in AgentV2CandidateAssembler(
                AGENT_V2_HOME_GATE
            ).runtime_tuples
            if runtime_tuple.runtime_attestation_profile == "contract_only"
        )
        observation = HomeMobileContractAdapter(
            runner=_mobile_runner,
            now=lambda: datetime(2026, 9, 18, tzinfo=timezone.utc),
        ).observe(runtime_tuple)

        contract = observation.role_observations["contract-evidence"]
        self.assertEqual(contract["assertionMarker"], MOBILE_MARKER)
        self.assertEqual(contract["status"], "passed")
        self.assertEqual(
            {entry["path"] for entry in contract["sourceFiles"]},
            {
                "apps/mobile/src/contracts/agentV2Contract.test.ts",
                "apps/mobile/src/gen/proto/domain/agent/home_pb.ts",
            },
        )

    def test_home_provisioner_allocates_native_and_browser_profile_two_clients(
        self,
    ) -> None:
        provisioner = HomeStationProvisioner(
            EnvironmentContract.from_yaml(
                ENVIRONMENTS_DIR / "home-station.yaml"
            )
        )
        with patch.object(
            provisioner,
            "_assert_client_ports_available",
        ):
            clients = provisioner._agent_v2_binding_clients(
                "home-run",
                1,
                {},
                runtime_name="home",
            )

        self.assertEqual(
            {client.runtime for client in clients},
            {"native-tauri", "browser"},
        )
        self.assertEqual(
            {client.profile for client in clients},
            {
                "agent-v2-home-native",
                "agent-v2-home-browser",
            },
        )
        with self.assertRaisesRegex(BlockedError, "requires the approved two"):
            provisioner._validate_agent_profile(
                AGENT_V2_HOME_GATE,
                "one",
                {
                    "PT_STATION_MODE": "remote",
                    "PT_STATION_DEPLOY_ENV": "station-two",
                },
            )
        provisioner.cleanup()

    def test_runner_does_not_import_historical_evidence(self) -> None:
        source = (
            ROOT
            / "tooling/acceptance/gates/agent/"
            "home_command_center_candidate.py"
        ).read_text(encoding="utf-8")

        self.assertNotIn("historical", source.lower())
        self.assertNotIn("import_evidence", source)
        self.assertNotIn("manual_j01", source)
        self.assertIn("AgentV2CandidateAssembler", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
