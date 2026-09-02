#!/usr/bin/env python3
"""Assemble the exact seven immutable Agent V2 proof envelopes."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (  # noqa: E402
    ArtifactRef,
    EvidenceStore,
    source_identity,
    validate_external_output_path,
)


def load_validator() -> Any:
    path = Path(__file__).with_name("acceptance-validate.py")
    spec = importlib.util.spec_from_file_location(
        "acceptance_validate_proof_contract", path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load proof validator: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--proof-envelope-ref-file",
        action="append",
        default=[],
    )
    parser.add_argument("--proof-set-ref-out", required=True)
    parser.add_argument("--proof-set-sha-out", required=True)
    args = parser.parse_args()

    validator = load_validator()
    contract = validator.load_agent_v2_contract()
    required_gates = set(contract["gates"])
    if len(args.proof_envelope_ref_file) != 7:
        raise RuntimeError("proof set requires exactly seven envelope refs")

    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    expected_source = source_identity(REPO_ROOT)
    expected_matrix = validator.matrix_identity(contract)
    gate_proofs: list[dict[str, Any]] = []
    seen_gates: set[str] = set()
    for ref_file in args.proof_envelope_ref_file:
        reference = validator.read_ref_file(ref_file)
        envelope = store.read_json(reference)
        validator.require(
            envelope.get("artifactKind") == "agent-v2-proof-envelope",
            "invalid proof envelope kind",
        )
        validator.require(
            envelope.get("proofStatus") == "PROVEN",
            "proof envelope is not PROVEN",
        )
        gate_id = envelope.get("gateId")
        validator.require(
            gate_id in required_gates,
            f"unexpected proof Gate: {gate_id}",
        )
        validator.require(
            gate_id not in seen_gates,
            f"duplicate proof Gate: {gate_id}",
        )
        seen_gates.add(gate_id)
        envelope = validator.validate_proof_envelope(
            store,
            reference,
            expected_gate_id=gate_id,
        )
        validator.require_exact_object(
            envelope.get("sourceIdentity"),
            expected_source,
            f"{gate_id} source identity",
        )
        validator.require_exact_object(
            envelope.get("runtimeMatrix"),
            expected_matrix,
            f"{gate_id} runtime matrix",
        )
        candidate_ref = ArtifactRef.from_dict(envelope["candidateManifest"])
        validator.require(
            candidate_ref.sha256
            == envelope.get("candidateManifestSha256"),
            f"{gate_id}: candidate hash pin mismatch",
        )
        runner_ref = ArtifactRef.from_dict(envelope["runnerAttestation"])
        validator.require(
            runner_ref.sha256 == envelope.get("runnerAttestationSha256"),
            f"{gate_id}: runner attestation hash pin mismatch",
        )
        validator_manifest_ref = ArtifactRef.from_dict(
            envelope["validatorRun"]
        )
        validator.require(
            validator_manifest_ref.sha256
            == envelope.get("validatorRunSha256"),
            f"{gate_id}: validator run hash pin mismatch",
        )
        store.read_run_manifest(
            validator_manifest_ref,
            manifest_sha256=validator_manifest_ref.sha256,
        )
        validator_ref = ArtifactRef.from_dict(
            envelope["validatorAttestation"]
        )
        validator.require(
            validator_ref.sha256
            == envelope.get("validatorAttestationSha256"),
            f"{gate_id}: validator attestation hash pin mismatch",
        )
        runner = store.read_json(runner_ref)
        validator_attestation = store.read_json(validator_ref)
        validator.require(
            runner["producer"]["kind"] == "runner"
            and validator_attestation["producer"]["kind"] == "validator"
            and runner["producer"]["processId"]
            != validator_attestation["producer"]["processId"]
            and runner["producer"]["invocationId"]
            != validator_attestation["producer"]["invocationId"]
            and candidate_ref.run_id != validator_manifest_ref.run_id,
            f"{gate_id}: producer/process/run separation failed",
        )
        gate_proofs.append(
            {
                "gateId": gate_id,
                "proofEnvelope": reference.to_dict(),
                "proofEnvelopeSha256": reference.sha256,
                "candidateManifest": candidate_ref.to_dict(),
                "validatorRun": validator_manifest_ref.to_dict(),
            }
        )

    validator.require(
        seen_gates == required_gates,
        f"proof set Gate mismatch: missing={sorted(required_gates - seen_gates)}",
    )
    proof_set_run = store.begin_run(
        "agent-v2-proof-set",
        source=expected_source,
    )
    try:
        proof_set_ref = proof_set_run.write_json(
            "proof/proof-set.json",
            {
                "artifactKind": "agent-v2-proof-set",
                "schemaVersion": 1,
                "proofStatus": "PROVEN",
                "sourceIdentity": expected_source,
                "runtimeMatrix": expected_matrix,
                "gateProofs": sorted(
                    gate_proofs, key=lambda item: item["gateId"]
                ),
                "createdAt": utc_now(),
            },
            role="proof-set",
            redact=False,
        )
        proof_set_run.finalize(
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            }
        )
        proof_set_run.close()
    except Exception:
        proof_set_run.close()
        raise

    ref_path = validate_external_output_path(
        args.proof_set_ref_out, repo_root=REPO_ROOT
    )
    sha_path = validate_external_output_path(
        args.proof_set_sha_out, repo_root=REPO_ROOT
    )
    ref_path.parent.mkdir(parents=True, exist_ok=True)
    sha_path.parent.mkdir(parents=True, exist_ok=True)
    ref_path.write_text(
        json.dumps(proof_set_ref.to_dict(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    sha_path.write_text(proof_set_ref.sha256 + "\n", encoding="utf-8")
    print("proof-set: " + json.dumps(proof_set_ref.to_dict(), sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"acceptance proof set failed: {error}", file=sys.stderr)
        raise SystemExit(1)
