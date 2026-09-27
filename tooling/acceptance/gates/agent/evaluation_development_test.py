from __future__ import annotations

import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.gates.agent.evaluation_development import (
    ACTOR_ACCOUNTS,
    AGENT_V2_EVALUATION_GATE,
    EvaluationDevelopmentError,
    ROOT,
    _stable_identity_key_path,
    begin_attestation_run,
    evaluate_evaluation_journey,
    persist_actor_identity,
)


def valid_capture() -> dict[str, object]:
    return {
        "prepare": {
            "assertions": {
                "nativeCreateStartResultVisible": True,
                "cancellationAcknowledged": True,
                "retryLineageComplete": True,
                "schedulerUnique": True,
            },
            "receiver-dom": {"resultVisible": True},
            "station-readback": {
                "entityKind": "evaluation-run-lineage",
                "ownerActorId": "ptid:alice",
                "primary": {
                    "run": {"runId": "run-parent", "status": 8},
                    "attempts": [],
                    "results": [],
                },
                "cancelled": {
                    "run": {"runId": "run-cancel", "status": 7},
                    "attempts": [{
                        "attemptId": "attempt-cancel",
                        "cancellationAckAt": {"seconds": "1"},
                    }],
                    "results": [],
                },
                "child": {
                    "run": {
                        "runId": "run-child",
                        "parentRunId": "run-parent",
                        "status": 6,
                    },
                    "attempts": [{
                        "attemptId": "attempt-child",
                        "sourceAttemptId": "attempt-parent",
                        "sourceResultId": "result-parent",
                        "turnId": "turn-child",
                    }],
                    "results": [],
                },
            },
            "runtime-events": {
                "primary": {"events": [{"sequence": "1"}]},
                "cancelled": {"events": [{"sequence": "1"}]},
                "child": {"events": [{"sequence": "1"}]},
            },
            "turn-trace": {
                "complete": True,
                "lineage": [{
                    "turnTraceId": "trace-1",
                    "attemptId": "attempt-parent",
                    "resultId": "result-parent",
                }],
            },
            "metrics-lineage": {
                "childParentRunId": "run-parent",
                "parentMetrics": {"totalCases": 3, "terminalCases": 3},
                "parentMetricsAfterRetry": {
                    "totalCases": 3,
                    "terminalCases": 3,
                },
            },
            "side-effect-count": {
                "attemptCount": 3,
                "uniqueAttemptCount": 3,
                "schedulerClaimCount": 3,
                "uniqueSchedulerClaimCount": 3,
            },
            "replay": {
                "primaryRunId": "run-parent",
                "cancelledRunId": "run-cancel",
                "childRunId": "run-child",
            },
        },
        "recovery": {
            "assertions": {
                "actorRestored": True,
                "nativeRowsRestored": True,
                "stationTerminalReadbackRestored": True,
                "eventCursorRestored": True,
            },
            "receiver-dom": {"labVisible": True},
            "station-readback": {"runs": []},
            "runtime-events": {"runs": []},
        },
        "isolation": {
            "assertions": {
                "distinctActor": True,
                "directReadDenied": True,
                "ownerRunsHidden": True,
                "ownerBenchmarkHidden": True,
                "mutationsDenied": True,
            },
        },
        "cleanup": {
            "status": "clean",
            "retentionConflictObserved": True,
            "resourceDeletionComplete": True,
        },
        "cell-results": [],
    }


class EvaluationDevelopmentTest(unittest.TestCase):
    def test_attestation_run_context_is_ready_before_provisioning(
        self,
    ) -> None:
        keys = (
            "PT_ACCEPTANCE_ARTIFACT_ROOT",
            "PT_ACCEPTANCE_WORKSPACE_ID",
            "PT_ACCEPTANCE_GATE_ID",
            "PT_ACCEPTANCE_RUN_ID",
            "PT_ACCEPTANCE_APPROVED_PROFILE",
        )
        previous = {key: os.environ.get(key) for key in keys}
        try:
            with tempfile.TemporaryDirectory() as directory:
                artifact_root = Path(directory) / "attestation"
                run = begin_attestation_run(artifact_root)
                try:
                    self.assertEqual(
                        os.environ["PT_ACCEPTANCE_ARTIFACT_ROOT"],
                        str(artifact_root),
                    )
                    self.assertEqual(
                        os.environ["PT_ACCEPTANCE_WORKSPACE_ID"],
                        run.store.workspace_id,
                    )
                    self.assertEqual(
                        os.environ["PT_ACCEPTANCE_GATE_ID"],
                        AGENT_V2_EVALUATION_GATE,
                    )
                    self.assertEqual(
                        os.environ["PT_ACCEPTANCE_RUN_ID"],
                        run.run_id,
                    )
                    self.assertEqual(
                        os.environ["PT_ACCEPTANCE_APPROVED_PROFILE"],
                        "two",
                    )
                    self.assertEqual(run.state, "ACTIVE")
                    self.assertTrue(run.run_dir.is_dir())
                finally:
                    run.close()
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_reused_identity_validates_fixture_not_transient_run_keys(
        self,
    ) -> None:
        station_peer_id = "station-peer"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_root = root / "fixtures"
            fixture = fixture_root / "alice"
            fixture_actor_identity = fixture / "actor-identity"
            fixture_key = _stable_identity_key_path(
                fixture_actor_identity,
                station_peer_id,
                "ptid:alice",
            )
            fixture_key.parent.mkdir(parents=True)
            fixture_key.write_text(
                "ab" * 32,
                encoding="utf-8",
            )
            metadata = {
                "schemaVersion": 1,
                "profile": "two",
                "account": ACTOR_ACCOUNTS["alice"],
                "actorId": "ptid:alice",
                "stationUrl": "https://station.example",
            }
            (fixture / "fixture.json").write_text(
                json.dumps(metadata),
                encoding="utf-8",
            )
            transient_identity = root / "transient"
            transient_identity.mkdir()
            (transient_identity / "old.key").write_text(
                "cd" * 32,
                encoding="utf-8",
            )
            (transient_identity / "current.key").write_text(
                "ef" * 32,
                encoding="utf-8",
            )

            with patch(
                "tooling.acceptance.gates.agent."
                "evaluation_development.IDENTITY_FIXTURE_ROOT",
                fixture_root,
            ):
                observed = persist_actor_identity(
                    "alice",
                    transient_identity,
                    "https://station.example/",
                    "ptid:alice",
                    station_peer_id,
                    station_accepted=True,
                )

            self.assertEqual(observed, metadata)
            self.assertEqual(
                list(fixture_key.parent.glob("*.key")),
                [fixture_key],
            )

    def test_new_identity_persists_only_station_scoped_actor_key(
        self,
    ) -> None:
        station_peer_id = "station-peer"
        actor_id = "ptid:bob"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_root = root / "fixtures"
            source_root = root / "transient"
            stable_key = _stable_identity_key_path(
                source_root,
                station_peer_id,
                actor_id,
            )
            stable_key.parent.mkdir(parents=True)
            stable_key.write_text("ab" * 32, encoding="utf-8")
            (stable_key.parent / "proxy-scoped.key").write_text(
                "cd" * 32,
                encoding="utf-8",
            )

            with patch(
                "tooling.acceptance.gates.agent."
                "evaluation_development.IDENTITY_FIXTURE_ROOT",
                fixture_root,
            ):
                persist_actor_identity(
                    "bob",
                    source_root,
                    "https://station.example",
                    actor_id,
                    station_peer_id,
                    station_accepted=True,
                )

            persisted_root = fixture_root / "bob/actor-identity"
            persisted_keys = list(persisted_root.rglob("*.key"))
            self.assertEqual(len(persisted_keys), 1)
            self.assertEqual(
                persisted_keys[0].relative_to(persisted_root),
                stable_key.relative_to(source_root),
            )
            self.assertEqual(
                persisted_keys[0].read_text(encoding="utf-8"),
                "ab" * 32,
            )

    def test_identity_is_not_persisted_before_station_acceptance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_root = root / "fixtures"
            source_root = root / "transient"
            stable_key = _stable_identity_key_path(
                source_root,
                "station-peer",
                "ptid:carol",
            )
            stable_key.parent.mkdir(parents=True)
            stable_key.write_text("ab" * 32, encoding="utf-8")

            with (
                patch(
                    "tooling.acceptance.gates.agent."
                    "evaluation_development.IDENTITY_FIXTURE_ROOT",
                    fixture_root,
                ),
                self.assertRaisesRegex(
                    EvaluationDevelopmentError,
                    "Station acceptance proof is required",
                ),
            ):
                persist_actor_identity(
                    "bob",
                    source_root,
                    "https://station.example",
                    "ptid:carol",
                    "station-peer",
                    station_accepted=False,
                )

            self.assertFalse((fixture_root / "bob").exists())

    def test_runtime_actor_pair_avoids_conflicted_alice_identity(self) -> None:
        self.assertEqual(
            ACTOR_ACCOUNTS,
            {
                "alice": "bob@p.t",
                "bob": "carol@p.t",
            },
        )

    def test_accepts_complete_j06_capture(self) -> None:
        capture = valid_capture()
        assertions = evaluate_evaluation_journey(capture)

        self.assertTrue(all(assertions.values()))

    def test_rejects_missing_cancellation_ack(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["prepare"]["station-readback"]["cancelled"]["attempts"][0][
            "cancellationAckAt"
        ] = None

        with self.assertRaisesRegex(
            EvaluationDevelopmentError,
            "cancellationAcknowledged",
        ):
            evaluate_evaluation_journey(capture)

    def test_rejects_incomplete_retry_lineage(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["prepare"]["station-readback"]["child"]["attempts"][0][
            "sourceResultId"
        ] = ""

        with self.assertRaisesRegex(
            EvaluationDevelopmentError,
            "retryLineageUnique",
        ):
            evaluate_evaluation_journey(capture)

    def test_rejects_duplicate_scheduler_or_attempt_identity(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["prepare"]["side-effect-count"]["uniqueSchedulerClaimCount"] = 2

        with self.assertRaisesRegex(
            EvaluationDevelopmentError,
            "schedulerAndAttemptUnique",
        ):
            evaluate_evaluation_journey(capture)

    def test_rejects_actor_isolation_or_cleanup_gap(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["isolation"]["assertions"]["ownerRunsHidden"] = False
        capture["cleanup"]["retentionConflictObserved"] = False

        with self.assertRaisesRegex(
            EvaluationDevelopmentError,
            "actorIsolationAssertionsPass.*retentionAndCleanupComplete",
        ):
            evaluate_evaluation_journey(capture)

    def test_runner_targets_production_harness_and_keeps_candidate_unproven(
        self,
    ) -> None:
        source = (
            ROOT
            / "tooling/acceptance/gates/agent/evaluation_development.py"
        ).read_text(encoding="utf-8")

        self.assertIn("AGENT_V2_EVALUATION_GATE", source)
        self.assertIn('"runEvaluationDevelopment"', source)
        self.assertIn('"phase": "prepare"', source)
        self.assertIn('"phase": "isolate"', source)
        self.assertIn('"phase": "recover"', source)
        self.assertIn('"phase": "cleanup"', source)
        self.assertIn('"providerApiKey": provider_fixture.api_key', source)
        self.assertNotIn("mca-j03-fixture-key", source)
        self.assertIn('"proofStatus": "UNPROVEN"', source)
        self.assertIn("--formal-candidate", source)
        self.assertIn("evaluation_candidate import", source)
        self.assertNotIn("def write_candidate(", source)
        self.assertIn("source_identity(ROOT)", source)
        self.assertNotIn("useEvaluationStore", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
