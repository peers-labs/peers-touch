from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from typing import Any

from tooling.acceptance.core import EvidenceStore, source_identity
from tooling.acceptance.gates.agent.agent_v2_candidate_producer import (
    AgentV2CandidateAssembler,
    AgentV2CandidateError,
    AgentV2RuntimeAttestation,
    AgentV2RuntimeTuple,
    AgentV2TupleObservation,
    ensure_evidence_safe,
    load_gate_tuples,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
GATE_ID = "agent-v2-home-command-center-e2e"
HASH = "a" * 64
OBSERVED_AT = "2026-09-18T00:00:00.000000+00:00"


def _load_script(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _observation(runtime_tuple: AgentV2RuntimeTuple) -> AgentV2TupleObservation:
    suffix = _hash(runtime_tuple.key)[:16]
    execution_id = f"execution-{suffix}"
    if runtime_tuple.runtime_attestation_profile == "contract_only":
        attestation = AgentV2RuntimeAttestation(
            "contract_only",
            {
                "scenarioExecutionId": execution_id,
                "contractAttestation": {
                    "contractId": runtime_tuple.cell,
                    "contractRunId": f"contract-run-{suffix}",
                    "contractHash": HASH,
                    "platform": runtime_tuple.platform,
                    "toolchain": "typescript",
                    "roundTripStatus": "passed",
                },
                "stationProfile": "two",
                "networkPath": "contract-only",
                "machine": "test-machine",
                "coldWarmState": "contract",
                "observedAt": OBSERVED_AT,
            },
        )
    else:
        command_id = f"command-{suffix}"
        attestation = AgentV2RuntimeAttestation(
            "station_command",
            {
                "scenarioExecutionId": execution_id,
                "actorIdentityHash": HASH,
                "commandAttestation": {
                    "commandId": command_id,
                    "commandKind": "home",
                    "idempotencyKeyHash": _hash(f"idempotency-{suffix}"),
                    "objectIds": [f"object-{suffix}"],
                    "projectionRevision": 2,
                },
                "stationProfile": "two",
                "desktopMode": runtime_tuple.platform,
                "networkPath": "station",
                "machine": "test-machine",
                "coldWarmState": "neutral",
                "observedAt": OBSERVED_AT,
            },
        )
    role_observations: dict[str, dict[str, Any]] = {}
    for role in runtime_tuple.role_policy.adapter_roles:
        if role == "receiver-dom":
            payload = {
                "scenarioId": runtime_tuple.cell,
                "cellId": runtime_tuple.cell,
                "selector": "[data-pt-home]",
                "locale": runtime_tuple.locale,
                "textHash": _hash(f"text-{suffix}"),
                "expectedVisible": True,
                "visible": True,
            }
        elif role == "station-readback":
            payload = {
                "entityKind": "home-projection",
                "entityIdHash": _hash(f"home-{suffix}"),
                "revision": 2,
                "stateHash": _hash(f"state-{suffix}"),
            }
        elif role == "command-ids":
            command = attestation.payload["commandAttestation"]
            payload = {
                "commandId": command["commandId"],
                "idempotencyKeyHash": command["idempotencyKeyHash"],
                "objectIds": command["objectIds"],
            }
        elif role == "projection-revisions":
            payload = {
                "slice": "home",
                "beforeRevision": 1,
                "afterRevision": 2,
            }
        elif role == "measurement-report":
            payload = {
                "metric": "home-command",
                "sampleIds": [runtime_tuple.sample_id],
                "threshold": "completed",
                "passed": True,
            }
        elif role == "side-effect-count":
            payload = {
                "counterId": f"side-effect-{suffix}",
                "count": 1,
                "maximum": 1,
            }
        elif role == "replay":
            replay_hash = _hash(f"replay-{suffix}")
            payload = {
                "sourceHash": replay_hash,
                "replayHash": replay_hash,
                "equal": True,
            }
        elif role == "cleanup":
            payload = {
                "resourceKind": "home-fixture",
                "resourceIdHash": _hash(f"cleanup-{suffix}"),
                "status": "clean",
            }
        elif role == "contract-evidence":
            payload = {
                "contractId": runtime_tuple.cell,
                "contractHash": HASH,
                "platform": runtime_tuple.platform,
                "status": "passed",
                "roundTripEqual": True,
            }
        else:
            raise AssertionError(f"unexpected role: {role}")
        role_observations[role] = payload
    return AgentV2TupleObservation(
        tuple_key=runtime_tuple.key,
        observed=True,
        passed=True,
        runtime_attestation=attestation,
        role_observations=role_observations,
    )


class AgentV2CandidateAssemblerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.store = EvidenceStore(self.root, worktree=REPO_ROOT)
        self.tuples = load_gate_tuples(GATE_ID)
        self.observations = tuple(
            (runtime_tuple, _observation(runtime_tuple))
            for runtime_tuple in self.tuples
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_complete_candidate_passes_full_validator(self) -> None:
        assembler = AgentV2CandidateAssembler(GATE_ID)
        run = self.store.begin_run(GATE_ID, source=source_identity(REPO_ROOT))
        candidate_path = assembler.produce(
            run,
            self.observations,
            candidate_name="home-candidate",
        )
        registration = json.loads(candidate_path.read_text(encoding="utf-8"))
        self.assertEqual(registration["proofStatus"], "UNPROVEN")

        acceptance_run = _load_script(
            REPO_ROOT / "tooling/scripts/acceptance-run.py",
            "_agent_v2_candidate_acceptance_run",
        )
        acceptance_run.emit_agent_v2_candidate_metadata(
            run,
            GATE_ID,
            source_identity(REPO_ROOT),
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
            REPO_ROOT / "tooling/scripts/acceptance-validate.py",
            "_agent_v2_candidate_full_validator",
        )
        validated = validator.validate_candidate(
            self.store,
            candidate_ref,
            candidate_ref.sha256,
        )
        self.assertEqual(validated["candidate"]["result"]["proofStatus"], "CANDIDATE")

    def test_duplicate_execution_identity_is_rejected(self) -> None:
        observations = list(self.observations)
        runtime_tuple, original = observations[1]
        payload = dict(original.runtime_attestation.payload)
        payload["scenarioExecutionId"] = observations[0][
            1
        ].runtime_attestation.payload["scenarioExecutionId"]
        observations[1] = (
            runtime_tuple,
            AgentV2TupleObservation(
                tuple_key=original.tuple_key,
                observed=True,
                passed=True,
                runtime_attestation=AgentV2RuntimeAttestation(
                    original.runtime_attestation.profile,
                    payload,
                ),
                role_observations=original.role_observations,
            ),
        )
        run = self.store.begin_run(GATE_ID, source=source_identity(REPO_ROOT))
        try:
            with self.assertRaisesRegex(
                AgentV2CandidateError,
                "duplicate scenario execution identity",
            ):
                AgentV2CandidateAssembler(GATE_ID).produce(
                    run,
                    observations,
                    candidate_name="duplicate",
                )
        finally:
            run.close()

    def test_duplicate_primary_execution_identity_is_rejected(self) -> None:
        observations = list(self.observations)
        runtime_tuple, original = observations[1]
        payload = copy.deepcopy(original.runtime_attestation.payload)
        payload["commandAttestation"]["commandId"] = observations[0][
            1
        ].runtime_attestation.payload["commandAttestation"]["commandId"]
        observations[1] = (
            runtime_tuple,
            AgentV2TupleObservation(
                tuple_key=original.tuple_key,
                observed=True,
                passed=True,
                runtime_attestation=AgentV2RuntimeAttestation(
                    original.runtime_attestation.profile,
                    payload,
                ),
                role_observations=original.role_observations,
            ),
        )
        run = self.store.begin_run(GATE_ID, source=source_identity(REPO_ROOT))
        try:
            with self.assertRaisesRegex(
                AgentV2CandidateError,
                "duplicate primary execution identity",
            ):
                AgentV2CandidateAssembler(GATE_ID).produce(
                    run,
                    observations,
                    candidate_name="duplicate-primary",
                )
        finally:
            run.close()

    def test_cleanup_fencing_token_is_safe_but_other_tokens_are_rejected(
        self,
    ) -> None:
        ensure_evidence_safe(
            {"operation": {"cleanupFencingToken": 7}},
            "executor-receipts",
        )
        with self.assertRaisesRegex(
            AgentV2CandidateError,
            "secret-bearing evidence field is forbidden",
        ):
            ensure_evidence_safe(
                {"operation": {"accessToken": "sensitive"}},
                "executor-receipts",
            )

    def test_missing_tuple_is_rejected(self) -> None:
        run = self.store.begin_run(GATE_ID, source=source_identity(REPO_ROOT))
        try:
            with self.assertRaisesRegex(AgentV2CandidateError, "expected 33"):
                AgentV2CandidateAssembler(GATE_ID).produce(
                    run,
                    self.observations[:-1],
                    candidate_name="missing",
                )
        finally:
            run.close()

    def test_profile_drift_is_rejected(self) -> None:
        observations = list(self.observations)
        runtime_tuple, original = observations[0]
        observations[0] = (
            runtime_tuple,
            AgentV2TupleObservation(
                tuple_key=original.tuple_key,
                observed=True,
                passed=True,
                runtime_attestation=AgentV2RuntimeAttestation(
                    "station_control_plane",
                    copy.deepcopy(original.runtime_attestation.payload),
                ),
                role_observations=original.role_observations,
            ),
        )
        run = self.store.begin_run(GATE_ID, source=source_identity(REPO_ROOT))
        try:
            with self.assertRaisesRegex(
                AgentV2CandidateError,
                "runtime attestation profile mismatch",
            ):
                AgentV2CandidateAssembler(GATE_ID).produce(
                    run,
                    observations,
                    candidate_name="profile-drift",
                )
        finally:
            run.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
