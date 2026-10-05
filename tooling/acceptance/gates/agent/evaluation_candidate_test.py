from __future__ import annotations

import json
import subprocess
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from tooling.acceptance.gates.agent.agent_v2_candidate_producer import (
    AgentV2CandidateAssembler,
    AgentV2RolePolicy,
    AgentV2RuntimeTuple,
)
from tooling.acceptance.gates.agent.evaluation_candidate import (
    CONTROL_PLANE_CELLS,
    MOBILE_MARKER,
    EvaluationCandidateError,
    EvaluationMobileAdapter,
    EvaluationRuntimeAdapter,
    ROOT,
    _environment_repository,
    _is_control_plane_tuple,
    _station_is_healthy,
    _validate_runtime_tuple_policy,
)
from tooling.acceptance.gates.agent.evaluation_development import authenticate_client
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientError,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_EVALUATION_GATE,
)


def runtime_tuple(
    *,
    cell: str,
    ordering: str = "single",
    profile: str,
    roles: tuple[str, ...],
) -> AgentV2RuntimeTuple:
    return AgentV2RuntimeTuple(
        gate=AGENT_V2_EVALUATION_GATE,
        row="evaluation-test",
        platform="desktop_app",
        runtime="direct_model",
        cell=cell,
        locale="en",
        ordering=ordering,
        sample_id="sample-001",
        role_policy=AgentV2RolePolicy((), roles, ()),
        runtime_attestation_profile=profile,
    )


class EvaluationCandidateTest(unittest.TestCase):
    def test_authentication_retries_transient_station_switch(self) -> None:
        class FakeClient:
            def __init__(self) -> None:
                self.configure_attempts = 0

            def configure_station(self, *, timeout: int):
                self.configure_attempts += 1
                if self.configure_attempts < 3:
                    raise FoundationClientError(
                        "Another Station switch is already in progress"
                    )
                return {"activeStationPeerId": "station-peer"}

            def harness(self, method, _payload, *, timeout):
                del timeout
                if method == "loginWithPassword":
                    return {"authenticated": True, "actorId": "ptid:alice"}
                if method == "navigateToAgent":
                    return {"navigated": True}
                raise AssertionError(f"unexpected harness method: {method}")

        client = FakeClient()
        with patch(
            "tooling.acceptance.gates.agent.evaluation_development.time.sleep"
        ) as sleep:
            login = authenticate_client(
                client,
                account="alice@example.invalid",
                password="fixture",
                skip_capability_session=True,
            )

        self.assertEqual(client.configure_attempts, 3)
        self.assertEqual(sleep.call_count, 2)
        self.assertEqual(login["stationPeerId"], "station-peer")

    def test_runtime_pair_reuses_native_identity_before_secondary_start(self) -> None:
        events: list[str] = []

        class FakeClient:
            def __init__(self, name: str) -> None:
                self.name = name
                self.actor_identity_root = ROOT / name

            def start(self) -> None:
                events.append(f"start:{self.name}")

        native = FakeClient("native")
        secondary = FakeClient("secondary")
        runtime_pair = SimpleNamespace(native=native, secondary=secondary)

        def fake_seed(_role, target_root, _station_url, *, fixture):
            del fixture
            events.append(f"seed:{target_root.name}")
            return target_root == secondary.actor_identity_root

        def fake_auth(client, **_kwargs):
            events.append(f"auth:{client.name}")
            return {
                "actorId": "ptid:alice",
                "stationPeerId": "station-peer",
                "stationAccepted": True,
            }

        def fake_persist(*_args, **_kwargs):
            events.append("persist:native")
            return {}

        with (
            patch(
                "tooling.acceptance.gates.agent.evaluation_candidate.seed_actor_identity",
                side_effect=fake_seed,
            ),
            patch(
                "tooling.acceptance.gates.agent.evaluation_candidate.authenticate_client",
                side_effect=fake_auth,
            ),
            patch(
                "tooling.acceptance.gates.agent.evaluation_candidate.persist_actor_identity",
                side_effect=fake_persist,
            ),
        ):
            EvaluationRuntimeAdapter(
                runtime_pair,
                {
                    "PT_STATION_URL": "https://station.invalid",
                    "CHAT_NATIVE_DEMO_PASSWORD": "pw",
                },
                "run-id",
                SimpleNamespace(api_key="fixture-key"),
                "http://provider.invalid",
                {},
            )

        self.assertEqual(
            events,
            [
                "seed:native",
                "start:native",
                "auth:native",
                "persist:native",
                "seed:secondary",
                "start:secondary",
                "auth:secondary",
            ],
        )

    def test_empty_env_repo_uses_sibling_environment_repository(self) -> None:
        self.assertEqual(
            _environment_repository({}),
            (ROOT.parent / "env").resolve(),
        )

    def test_station_health_timeout_is_treated_as_unhealthy(self) -> None:
        with patch(
            "tooling.acceptance.gates.agent.evaluation_candidate.subprocess.run",
            side_effect=subprocess.TimeoutExpired(["curl"], 10),
        ):
            self.assertFalse(_station_is_healthy("http://station.invalid/healthz"))

    def test_matrix_has_57_unique_tuples_with_exact_profile_partition(self) -> None:
        assembler = AgentV2CandidateAssembler(AGENT_V2_EVALUATION_GATE)

        self.assertEqual(len(assembler.runtime_tuples), 57)
        self.assertEqual(
            len({runtime_tuple.key for runtime_tuple in assembler.runtime_tuples}),
            57,
        )
        for item in assembler.runtime_tuples:
            _validate_runtime_tuple_policy(item)
            if item.platform == "mobile_contract":
                self.assertEqual(
                    item.role_policy.adapter_roles,
                    frozenset(
                        {"cell-results", "contract-evidence", "cleanup"}
                    ),
                )
                continue
            self.assertEqual(
                item.runtime_attestation_profile == "station_control_plane",
                item.cell in CONTROL_PLANE_CELLS,
            )

    def test_control_plane_rejections_forbid_turn_roles(self) -> None:
        item = runtime_tuple(
            cell="ERR-E02",
            profile="station_control_plane",
            roles=(
                "cell-results",
                "receiver-dom",
                "station-readback",
                "measurement-report",
                "side-effect-count",
                "replay",
                "cleanup",
            ),
        )
        self.assertTrue(_is_control_plane_tuple(item))
        _validate_runtime_tuple_policy(item)

        with self.assertRaisesRegex(
            EvaluationCandidateError,
            "station_control_plane",
        ):
            _validate_runtime_tuple_policy(
                runtime_tuple(
                    cell="ERR-E02",
                    profile="station_turn",
                    roles=(
                        "cell-results",
                        "receiver-dom",
                        "station-readback",
                        "runtime-events",
                        "turn-trace",
                        "metrics-lineage",
                        "measurement-report",
                        "side-effect-count",
                        "replay",
                        "cleanup",
                    ),
                )
            )

    def test_turn_backed_cells_require_turn_roles(self) -> None:
        _validate_runtime_tuple_policy(
            runtime_tuple(
                cell="R-09",
                ordering="A",
                profile="station_turn",
                roles=(
                    "cell-results",
                    "receiver-dom",
                    "station-readback",
                    "runtime-events",
                    "turn-trace",
                    "metrics-lineage",
                    "measurement-report",
                    "side-effect-count",
                    "replay",
                    "cleanup",
                ),
            )
        )

        with self.assertRaisesRegex(
            EvaluationCandidateError,
            "Turn role applicability drifted",
        ):
            _validate_runtime_tuple_policy(
                runtime_tuple(
                    cell="AS-07",
                    profile="station_turn",
                    roles=(
                        "cell-results",
                        "receiver-dom",
                        "station-readback",
                        "measurement-report",
                        "side-effect-count",
                        "replay",
                        "cleanup",
                    ),
                )
            )

    def test_mobile_contract_adapter_emits_only_contract_roles(self) -> None:
        report = {
            "testResults": [{
                "assertionResults": [{
                    "fullName": f"contracts {MOBILE_MARKER}",
                    "status": "passed",
                }],
            }],
        }

        def runner(*_args, **_kwargs):
            return subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=json.dumps(report),
                stderr="",
            )

        item = AgentV2CandidateAssembler(
            AGENT_V2_EVALUATION_GATE
        ).runtime_tuples[-1]
        observation = EvaluationMobileAdapter(
            runner=runner,
            now=lambda: datetime(2026, 9, 21, tzinfo=timezone.utc),
        ).observe(item)

        self.assertEqual(
            set(observation.role_observations),
            {"cell-results", "contract-evidence", "cleanup"},
        )
        self.assertEqual(
            observation.runtime_attestation.profile,
            "contract_only",
        )

    def test_formal_entrypoint_uses_dedicated_candidate_and_harness(self) -> None:
        runner = (
            ROOT
            / "tooling/acceptance/gates/agent/evaluation_development.py"
        ).read_text(encoding="utf-8")
        candidate = (
            ROOT
            / "tooling/acceptance/gates/agent/evaluation_candidate.py"
        ).read_text(encoding="utf-8")
        harness = (
            ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("evaluation_candidate import", runner)
        self.assertIn("main as candidate_main", runner)
        self.assertNotIn("def write_candidate(", runner)
        self.assertIn('"runEvaluationScenario"', candidate)
        self.assertNotIn("skip_capability_session=True", candidate)
        self.assertIn("runEvaluationScenario(", harness)
        self.assertIn("restart_foundation_station(", candidate)


if __name__ == "__main__":
    unittest.main(verbosity=2)
