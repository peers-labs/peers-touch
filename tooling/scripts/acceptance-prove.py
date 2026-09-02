#!/usr/bin/env python3
"""Run and validate one Agent V2 Gate through an explicit candidate handoff."""

from __future__ import annotations

import argparse
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
