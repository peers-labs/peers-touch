#!/usr/bin/env python3
"""Generate a project-level acceptance domain coverage report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


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


def domain_validation_status(repo_root: Path, root: Path, domain: dict[str, Any]) -> tuple[str, list[str]]:
    domain_id = domain.get("id", "")
    if domain.get("status") != "active":
        return "not_validated", []
    profile = load(root / "domains" / f"{domain_id}.yaml")
    report_path = repo_root / profile.get("report", f"tooling/acceptance/reports/{domain_id}-validation.json")
    report = load(report_path)
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


def render_markdown(repo_root: Path, root: Path, output: Path) -> None:
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
        validation, missing = domain_validation_status(repo_root, root, domain)
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
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="tooling/acceptance")
    parser.add_argument("--output", default="tooling/acceptance/reports/project-coverage-report.md")
    args = parser.parse_args()

    repo_root = Path.cwd()
    render_markdown(repo_root, repo_root / args.root, repo_root / args.output)
    print(f"[OK] wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
