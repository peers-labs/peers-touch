#!/usr/bin/env python3
"""Generate a project-level acceptance domain coverage report."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core.errors import EvidenceManifestInvalid


def load(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def load_capabilities(root: Path) -> dict[str, dict[str, Any]]:
    capabilities: dict[str, dict[str, Any]] = {}
    for path in sorted((root / "capabilities").glob("*.yaml")):
        for capability in load(path).get("capabilities", []):
            capability_id = capability.get("id")
            if capability_id:
                capabilities[capability_id] = capability
    return capabilities


def domain_validation_status(
    root: Path,
    domain: dict[str, Any],
    store: Any,
) -> tuple[str, list[str]]:
    domain_id = domain.get("id", "")
    if domain.get("status") != "active":
        return "not_validated", []
    profile = load(root / "domains" / f"{domain_id}.yaml")
    validation_gate_id = str(profile.get("validation_gate_id") or "")
    if not validation_gate_id:
        return "missing_report", []
    try:
        report = store.read_json(
            store.latest_artifact_ref(validation_gate_id, "validation")
        )
    except EvidenceManifestInvalid:
        return "missing_report", []
    statuses = [capability.get("status", "unknown") for capability in report.get("capabilities", [])]
    if not statuses:
        return "missing_report", []
    if all(status == "proven" for status in statuses):
        return "evidence_proven", []
    if all(status == "structurally_valid" for status in statuses):
        return "structurally_valid", []
    missing = [
        capability.get("id", "")
        for capability in report.get("capabilities", [])
        if capability.get("status") != "proven"
    ]
    return "partial", missing


def render_markdown(root: Path, store: Any) -> str:
    index = load(root / "domains" / "index.yaml")
    capabilities = load_capabilities(root)
    lines = [
        "# Acceptance Project Coverage Report",
        "",
        "This report summarizes which product domains are managed by the project-level acceptance framework.",
        "",
        "## Domain Coverage",
        "",
        "| Domain | Status | Coverage | Validation | Capability Count | Notes |",
        "|--------|--------|----------|------------|------------------|-------|",
    ]

    for domain in index.get("domains", []):
        domain_id = domain.get("id", "")
        profile = load(root / "domains" / f"{domain_id}.yaml")
        capability_ids = profile.get("capabilities", [])
        validation, missing = domain_validation_status(root, domain, store)
        notes = domain.get("notes", "")
        if missing:
            notes = f"{notes} Missing proven capabilities: {', '.join(missing)}".strip()
        lines.append(
            "| {domain} | {status} | {coverage} | {validation} | {count} | {notes} |".format(
                domain=domain_id,
                status=domain.get("status", ""),
                coverage=domain.get("coverage", ""),
                validation=validation,
                count=len(capability_ids),
                notes=notes.replace("|", "/"),
            )
        )

    lines.extend(["", "## Active Capabilities", ""])
    for capability in sorted(capabilities.values(), key=lambda item: item.get("id", "")):
        lines.append(f"- `{capability.get('id')}` ({capability.get('domain')}, {capability.get('direction')})")

    lines.extend(
        [
            "",
            "## Onboarding Rule",
            "",
            "- New product domains start in `tooling/acceptance/domains/index.yaml` as `candidate` or `planned`.",
            "- A domain becomes `active` only after it has a profile, capabilities, feature contracts, registry mapping, gates, and a passing `make acceptance-validate DOMAIN=<domain>` structural result.",
            "- Evidence status becomes `evidence_proven` only after the domain runs its stable gates and `acceptance-validate --require-proven` passes.",
            "- Federation is the first validation domain, not the acceptance core.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    from tooling.acceptance.core import (
        RUN_GATE_ENV,
        ArtifactSession,
        EvidenceStore,
    )

    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="tooling/acceptance")
    args = parser.parse_args()

    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    markdown = render_markdown(REPO_ROOT / args.root, store)
    gate_id = os.environ.get(RUN_GATE_ENV) or "acceptance-coverage-report"
    with ArtifactSession(repo_root=REPO_ROOT, gate_id=gate_id) as session:
        reference = session.write_bytes(
            "reports/project-coverage-report.md",
            markdown.encode("utf-8"),
            media_type="text/markdown",
            role="coverage",
        )
        session.complete(
            status="passed",
            completion_status="DONE",
            proof_status="PROVEN",
        )
    print(f"[OK] wrote {json.dumps(reference.to_dict(), sort_keys=True)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
