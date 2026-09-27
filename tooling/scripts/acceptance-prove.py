#!/usr/bin/env python3
"""Run and validate one Agent V2 Gate through an explicit candidate handoff."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (  # noqa: E402
    ArtifactRef,
    validate_external_output_path,
)

AGENT_V2_CANDIDATE_PRODUCERS = {
    "agent-v2-home-command-center-e2e":
        "tooling/acceptance/gates/agent/home_command_center_candidate.py",
    "agent-v2-capability-binding-e2e":
        "tooling/acceptance/gates/agent/capability_binding_candidate.py",
    "agent-v2-governed-tool-loop-e2e":
        "tooling/acceptance/gates/agent/governed_tool_candidate.py",
    "agent-v2-mcp-lifecycle-e2e":
        "tooling/acceptance/gates/agent/mcp_lifecycle_candidate.py",
    "agent-v2-connector-invocation-e2e":
        "tooling/acceptance/gates/agent/connector_invocation_candidate.py",
    "agent-v2-evaluation-lab-e2e":
        "tooling/acceptance/gates/agent/evaluation_candidate.py",
}


def run_checked(command: list[str]) -> None:
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        env=os.environ.copy(),
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"subprocess failed with exit {completed.returncode}: "
            + " ".join(command)
        )


def _producer_manifest_path(stdout: str) -> Path:
    decoder = json.JSONDecoder()
    manifests: list[str] = []
    offset = 0
    while True:
        start = stdout.find("{", offset)
        if start < 0:
            break
        try:
            payload, length = decoder.raw_decode(stdout[start:])
        except json.JSONDecodeError:
            offset = start + 1
            continue
        if isinstance(payload, dict) and isinstance(payload.get("manifest"), str):
            manifests.append(payload["manifest"])
        offset = start + max(length, 1)
    if not manifests:
        raise RuntimeError("candidate producer did not emit an explicit manifest path")
    return Path(manifests[-1]).expanduser().resolve()


def _candidate_ref_from_manifest(
    manifest_path: Path,
    *,
    gate_id: str,
    artifact_root: Path,
) -> ArtifactRef:
    root = artifact_root.expanduser().resolve()
    manifest_path = manifest_path.expanduser().resolve()
    try:
        relative = manifest_path.relative_to(root)
    except ValueError as error:
        raise RuntimeError("candidate manifest escaped the configured artifact root") from error
    if (
        len(relative.parts) != 4
        or relative.parts[1] != gate_id
        or relative.parts[3] != "manifest.json"
    ):
        raise RuntimeError("candidate manifest path does not match Evidence Store layout")
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (
        payload.get("artifactKind") != "acceptance-run-manifest"
        or payload.get("gateId") != gate_id
        or payload.get("result", {}).get("proofStatus") != "CANDIDATE"
    ):
        raise RuntimeError("candidate producer did not finalize a CANDIDATE run")
    return ArtifactRef(
        workspace_id=relative.parts[0],
        gate_id=gate_id,
        run_id=relative.parts[2],
        path="manifest.json",
        sha256=hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        media_type="application/json",
    )


def run_candidate_producer(
    gate_id: str,
    producer_path: str,
    candidate_ref_file: Path,
    candidate_sha_file: Path,
) -> None:
    process = subprocess.Popen(
        [sys.executable, producer_path],
        cwd=REPO_ROOT,
        env=os.environ.copy(),
        stdout=subprocess.PIPE,
        text=True,
    )
    stdout_parts: list[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        stdout_parts.append(line)
        sys.stdout.write(line)
        sys.stdout.flush()
    returncode = process.wait()
    if returncode != 0:
        raise RuntimeError(
            f"candidate producer failed with exit {returncode}: {producer_path}"
        )
    artifact_root = os.environ.get("PT_ACCEPTANCE_ARTIFACT_ROOT", "").strip()
    if not artifact_root:
        raise RuntimeError("PT_ACCEPTANCE_ARTIFACT_ROOT is required")
    reference = _candidate_ref_from_manifest(
        _producer_manifest_path("".join(stdout_parts)),
        gate_id=gate_id,
        artifact_root=Path(artifact_root),
    )
    candidate_ref_file.write_text(
        json.dumps(reference.to_dict(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    candidate_sha_file.write_text(reference.sha256 + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gate", required=True)
    parser.add_argument("--gates", default="tooling/acceptance/gates.yaml")
    parser.add_argument("--proof-envelope-ref-out", required=True)
    parser.add_argument("--proof-envelope-sha-out")
    args = parser.parse_args()

    output_ref = validate_external_output_path(
        args.proof_envelope_ref_out,
        repo_root=REPO_ROOT,
    )
    output_sha = (
        validate_external_output_path(
            args.proof_envelope_sha_out,
            repo_root=REPO_ROOT,
        )
        if args.proof_envelope_sha_out
        else None
    )
    with tempfile.TemporaryDirectory(prefix="acceptance-proof-handoff-") as tmp:
        handoff = Path(tmp)
        candidate_ref_file = handoff / "candidate-ref.json"
        candidate_sha_file = handoff / "candidate.sha256"
        proof_ref_file = handoff / "proof-envelope-ref.json"
        proof_sha_file = handoff / "proof-envelope.sha256"
        producer_path = AGENT_V2_CANDIDATE_PRODUCERS.get(args.gate)
        if producer_path is None:
            run_checked(
                [
                    sys.executable,
                    "tooling/scripts/acceptance-run.py",
                    "--gates",
                    args.gates,
                    "--gate",
                    args.gate,
                    "--candidate-ref-out",
                    str(candidate_ref_file),
                    "--candidate-manifest-sha-out",
                    str(candidate_sha_file),
                ]
            )
        else:
            run_candidate_producer(
                args.gate,
                producer_path,
                candidate_ref_file,
                candidate_sha_file,
            )
        candidate_ref = ArtifactRef.from_dict(
            json.loads(candidate_ref_file.read_text(encoding="utf-8"))
        )
        candidate_sha = candidate_sha_file.read_text(encoding="utf-8").strip()
        if candidate_ref.sha256 != candidate_sha:
            raise RuntimeError("runner candidate ref/hash handoff mismatch")
        run_checked(
            [
                sys.executable,
                "tooling/scripts/acceptance-validate.py",
                "--candidate-ref-file",
                str(candidate_ref_file),
                "--candidate-manifest-sha256",
                candidate_sha,
                "--proof-envelope-ref-out",
                str(proof_ref_file),
                "--proof-envelope-sha-out",
                str(proof_sha_file),
            ]
        )
        proof_ref = ArtifactRef.from_dict(
            json.loads(proof_ref_file.read_text(encoding="utf-8"))
        )
        proof_sha = proof_sha_file.read_text(encoding="utf-8").strip()
        if proof_ref.sha256 != proof_sha:
            raise RuntimeError("validator proof ref/hash handoff mismatch")
        output_ref.parent.mkdir(parents=True, exist_ok=True)
        output_ref.write_text(
            json.dumps(proof_ref.to_dict(), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        if output_sha is not None:
            output_sha.parent.mkdir(parents=True, exist_ok=True)
            output_sha.write_text(proof_sha + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"acceptance prove failed: {error}", file=sys.stderr)
        raise SystemExit(1)
