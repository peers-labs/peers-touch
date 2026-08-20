#!/usr/bin/env python3
"""Export and verify local acceptance evidence for CI consumption.

Local native E2E gates (tier=env-evidence) require Tauri webview and
a home Station that CI runners cannot provide. This script exports a
compact attestation from the local EvidenceStore so CI can verify the
results without re-running the gates.

Workflow:
  1. Run gates locally:  make acceptance-chat-w11
  2. Export attestation: python3 tooling/scripts/acceptance-evidence.py export
  3. Commit the file under tooling/acceptance/evidence/
  4. CI verifies it automatically via quality-evidence.py
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import EvidenceStore, ArtifactRef
from tooling.acceptance.core.errors import EvidenceManifestInvalid

EVIDENCE_DIR = REPO_ROOT / "tooling" / "acceptance" / "evidence"
ATTESTATION_KIND = "acceptance-evidence-attestation"
SCHEMA_VERSION = 1


def _head_commit() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _is_ancestor(commit: str, ref: str) -> bool:
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", commit, ref],
        cwd=REPO_ROOT,
        capture_output=True,
    )
    return result.returncode == 0


def _commits_in_range(base: str, head: str) -> list[str]:
    result = subprocess.run(
        ["git", "rev-list", f"{base}..{head}"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def export_attestation(
    *,
    commit: str | None = None,
    out: Path | None = None,
    gate_ids: list[str] | None = None,
) -> Path:
    target_commit = commit or _head_commit()
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT, worktree=REPO_ROOT
    )

    gates_data = json.loads(
        (REPO_ROOT / "tooling" / "acceptance" / "gates.yaml").read_text()
    )
    all_gates = gates_data.get("gates", {})

    env_gate_ids = [
        gid
        for gid, gdef in all_gates.items()
        if gdef.get("tier") == "env-evidence"
    ]
    if gate_ids:
        env_gate_ids = [g for g in env_gate_ids if g in gate_ids]

    attestations: dict[str, dict[str, Any]] = {}
    for gate_id in env_gate_ids:
        try:
            pointer = store._latest_pointer(gate_id, required=False)
            if pointer is None:
                continue
            manifest = store.read_json(
                ArtifactRef.from_dict(pointer["manifest"])
            )
        except EvidenceManifestInvalid:
            continue

        source = manifest.get("source", {})
        if source.get("commit") != target_commit:
            continue
        if source.get("workspaceDigest") != "clean":
            print(
                f"skip {gate_id}: workspace was not clean "
                f"(digest={source.get('workspaceDigest', 'unknown')})",
                file=sys.stderr,
            )
            continue

        result = manifest.get("result", {})
        if result.get("status") != "passed":
            continue

        gate_def = all_gates.get(gate_id, {})
        attestations[gate_id] = {
            "gateId": gate_id,
            "environment": gate_def.get("environment", ""),
            "tier": gate_def.get("tier", ""),
            "runId": pointer.get("runId", ""),
            "completedAt": pointer.get("completedAt", ""),
            "durationSeconds": result.get("duration_seconds", 0),
            "manifestSha256": pointer.get("manifestSha256", ""),
        }

    if not attestations:
        print(
            f"no proven env-evidence gates found for commit {target_commit[:12]}",
            file=sys.stderr,
        )
        sys.exit(1)

    payload = {
        "artifactKind": ATTESTATION_KIND,
        "schemaVersion": SCHEMA_VERSION,
        "commit": target_commit,
        "producedAt": datetime.now(timezone.utc).isoformat(timespec="microseconds"),
        "gateCount": len(attestations),
        "gates": attestations,
    }

    if out is None:
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        out = EVIDENCE_DIR / f"{target_commit[:12]}.json"

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"exported {len(attestations)} gate attestation(s) to {out}")
    for gate_id in sorted(attestations):
        print(f"  ✓ {gate_id}")
    return out


def verify_attestation(
    path: Path,
    *,
    base_ref: str = "HEAD",
    head_ref: str = "HEAD",
) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("artifactKind") != ATTESTATION_KIND:
        raise ValueError(f"invalid attestation kind in {path}")
    if data.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"unsupported schema version in {path}")

    commit = data.get("commit", "")
    if not commit:
        raise ValueError(f"missing commit in {path}")

    range_commits = set(_commits_in_range(base_ref, head_ref))
    if commit not in range_commits and not _is_ancestor(commit, head_ref):
        raise ValueError(
            f"attestation commit {commit[:12]} is not in range "
            f"{base_ref}..{head_ref} and not an ancestor of {head_ref}"
        )

    gates = data.get("gates", {})
    if not gates:
        raise ValueError(f"no gate attestations in {path}")

    verified: dict[str, dict[str, Any]] = {}
    for gate_id, att in gates.items():
        if att.get("manifestSha256") and att.get("runId"):
            verified[gate_id] = att
        else:
            print(
                f"warning: {gate_id} attestation in {path.name} "
                f"is missing manifestSha256 or runId",
                file=sys.stderr,
            )

    return {
        "path": str(path),
        "commit": commit,
        "verified_gates": verified,
        "produced_at": data.get("producedAt", ""),
    }


def cmd_export(args: argparse.Namespace) -> None:
    gate_ids = args.gate.split(",") if args.gate else None
    out = Path(args.out) if args.out else None
    export_attestation(commit=args.commit, out=out, gate_ids=gate_ids)


def cmd_verify(args: argparse.Namespace) -> None:
    results: list[dict[str, Any]] = []
    if args.file:
        results.append(
            verify_attestation(
                Path(args.file),
                base_ref=args.base,
                head_ref=args.head,
            )
        )
    else:
        if not EVIDENCE_DIR.is_dir():
            print("no evidence directory found", file=sys.stderr)
            sys.exit(0)
        for path in sorted(EVIDENCE_DIR.glob("*.json")):
            try:
                results.append(
                    verify_attestation(
                        path,
                        base_ref=args.base,
                        head_ref=args.head,
                    )
                )
            except (ValueError, OSError) as error:
                print(f"skip {path.name}: {error}", file=sys.stderr)

    proven_gates: dict[str, dict[str, Any]] = {}
    for result in results:
        for gate_id, att in result["verified_gates"].items():
            proven_gates[gate_id] = att

    output = {
        "provenGateCount": len(proven_gates),
        "provenGates": sorted(proven_gates.keys()),
        "attestations": [
            {"path": r["path"], "commit": r["commit"][:12]} for r in results
        ],
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    if not proven_gates:
        sys.exit(1)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export and verify local acceptance evidence"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_export = sub.add_parser("export", help="Export local evidence to file")
    p_export.add_argument("--commit", help="Target commit (default: HEAD)")
    p_export.add_argument("--out", help="Output file path")
    p_export.add_argument("--gate", help="Comma-separated gate IDs to export")
    p_export.set_defaults(func=cmd_export)

    p_verify = sub.add_parser("verify", help="Verify evidence files")
    p_verify.add_argument("--file", help="Verify a specific file")
    p_verify.add_argument("--base", default="HEAD", help="Base ref for range check")
    p_verify.add_argument("--head", default="HEAD", help="Head ref for range check")
    p_verify.set_defaults(func=cmd_verify)

    args = parser.parse_args()
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
