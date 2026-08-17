#!/usr/bin/env python3
"""Validate Agent LobeHub parity evidence-chain and migration-entry state."""

from __future__ import annotations

import argparse
import json
import re
import struct
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import artifact_session


ARTIFACT_KIND = "agent-lobehub-parity-evidence-chain-gate"
PHASE = "PLAN-P2/PLAN-P4 pre-implementation control"
BOM = ["BOM-012", "BOM-013", "BOM-014", "BOM-015"]
SPEC = ["SPEC-010", "SPEC-011", "SPEC-012", "SPEC-013", "SPEC-014"]
GATE = "Prototype and PLAN-P5 entry controls must remain fail-closed until Owner confirmation and EVID-012 authorization exist"

DEFAULT_LEDGER = "tmp/agent-lobehub-fullstack-ledger.md"
DEFAULT_OUTPUT_PREFIX = "reports/agent-lobehub-parity-evidence-chain-gate-latest"

REQUIRED_EVIDENCE = [
    "EVID-011-AA-pre",
    "EVID-011-AB-pre",
    "EVID-011-AC-pre",
    "EVID-011-AD-pre",
    "EVID-011-AE-pre",
    "EVID-011-AF-pre",
    "EVID-011-AG-pre",
    "EVID-011-AH-pre",
    "EVID-011-AI-pre",
    "EVID-011-AJ-pre",
    "EVID-011-AK-pre",
    "EVID-011-AL-pre",
    "EVID-011-AM-pre",
    "EVID-011-Z-owner",
    "EVID-011-AO-pre",
    "EVID-011-AP-pre",
    "EVID-011-AQ-pre",
    "EVID-011-AR-pre",
    "EVID-011-AS-pre",
    "EVID-011-AT-pre",
    "EVID-011-AU-pre",
    "EVID-011-AV-pre",
    "EVID-011-AW-pre",
    "EVID-011-AX-pre",
    "EVID-011-AY-pre",
    "EVID-011-AZ-pre",
    "EVID-011-BA-pre",
    "EVID-011-BB-pre",
    "EVID-011-BC-pre",
    "EVID-011-BD-pre",
    "EVID-011-BE-pre",
    "EVID-011-BF-pre",
    "EVID-011-BG-pre",
    "EVID-011-BH-pre",
    "EVID-011-BI-pre",
    "EVID-011-BJ-pre",
    "EVID-011-BK-pre",
    "EVID-011-BL-pre",
    "EVID-011-BM-pre",
    "EVID-011-BN-pre",
    "EVID-011-BO-pre",
    "EVID-011-BP-pre",
    "EVID-011-BQ-pre",
    "EVID-011-BR-pre",
    "EVID-011-BS-pre",
    "EVID-011-BT-pre",
    "EVID-011-BU-pre",
    "EVID-011-BV-pre",
    "EVID-011-BW-pre",
    "EVID-011-BX-pre",
    "EVID-011-BY-pre",
    "EVID-011-BZ-pre",
    "EVID-011-CA-pre",
    "EVID-011-CB-pre",
    "EVID-011-CI-pre",
    "EVID-011-CJ-pre",
    "EVID-011-CC-pre",
    "EVID-011-CK-pre",
    "EVID-011-CD-pre",
    "EVID-011-CL-pre",
    "EVID-011-CE-pre",
    "EVID-011-CM-pre",
    "EVID-011-CF-pre",
    "EVID-011-CN-pre",
    "EVID-011-CG-pre",
    "EVID-011-CO-pre",
    "EVID-011-CH-pre",
    "EVID-011-CP-pre",
    "EVID-011-SI-pre",
    "EVID-011-CQ-pre",
    "EVID-011-SS-pre",
    "EVID-011-CR-pre",
    "EVID-011-CS-pre",
    "EVID-011-GA-pre",
    "EVID-011-VD-pre",
    "EVID-011-VL-pre",
    "EVID-011-L23-pre",
    "EVID-011-CT-pre",
    "EVID-011-CU-pre",
    "EVID-011-CV-pre",
    "EVID-011-CW-pre",
    "EVID-011-CX-pre",
    "EVID-011-CY-pre",
    "EVID-011-CZ-pre",
    "EVID-011-DA-pre",
    "EVID-011-DB-pre",
    "EVID-011-DC-pre",
]

REQUIRED_FILES = {
    "manifest": "packages/prototypes/desktop/features/agent-lobehub-parity/prototype.manifest.ts",
    "prototypeSource": "packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx",
    "prototypeRegistry": "docs/architecture/prototypes/README.md",
    "prototypeReviewEntry": "docs/architecture/agent/prototype/README.md",
    "prototypeEvidence": "docs/architecture/agent/prototype-lobehub-parity/README.md",
    "prototypeRunbook": "docs/architecture/agent/prototype/owner-review-runbook.md",
    "ownerChecklist": "docs/architecture/agent/prototype/owner-review-checklist.md",
    "confirmationGapAudit": "docs/architecture/agent/lobehub-parity/prototype-confirmation-gap-audit.md",
    "planP5EntryGate": "docs/architecture/agent/lobehub-parity/plan-p5-entry-gate.md",
    "planP5ControlBoard": "docs/architecture/agent/lobehub-parity/plan-p5-implementation-control-board.md",
    "preImplementationReadiness": "docs/architecture/agent/lobehub-parity/pre-implementation-readiness.md",
    "ownerDecisionSnapshot": "docs/architecture/agent/lobehub-parity/owner-decision-status-snapshot.md",
    "visualComparisonLedger": "docs/architecture/agent/lobehub-parity/prototype-visual-comparison-ledger.md",
    "ownerDecisionPacket": "docs/architecture/agent/lobehub-parity/prototype-owner-review-decision-packet.md",
    "homeCompactRevision": "docs/architecture/agent/lobehub-parity/home-cb-compact-dashboard-revision.md",
    "homeCiCompactRevision": "docs/architecture/agent/lobehub-parity/home-ci-compact-dashboard-density-revision.md",
    "chatCompactRevision": "docs/architecture/agent/lobehub-parity/chat-cc-compact-new-topic-revision.md",
    "chatDaCompactRevision": "docs/architecture/agent/lobehub-parity/chat-da-compact-follow-up-revision.md",
    "chatDcHandoffFreshnessGuard": "docs/architecture/agent/lobehub-parity/chat-dc-handoff-freshness-guard.md",
    "profileCompactRevision": "docs/architecture/agent/lobehub-parity/profile-cd-compact-editor-revision.md",
    "profileDdCompactRevision": "docs/architecture/agent/lobehub-parity/profile-dd-compact-builder-follow-up-revision.md",
    "tasksCompactRevision": "docs/architecture/agent/lobehub-parity/tasks-ce-compact-default-revision.md",
    "pagesCompactRevision": "docs/architecture/agent/lobehub-parity/pages-cf-compact-default-revision.md",
    "resourcesCompactRevision": "docs/architecture/agent/lobehub-parity/resources-cg-compact-default-revision.md",
    "memoryCompactRevision": "docs/architecture/agent/lobehub-parity/memory-ch-compact-default-revision.md",
    "skillsCompactRevision": "docs/architecture/agent/lobehub-parity/skills-si-compact-default-revision.md",
    "settingsCompactRevision": "docs/architecture/agent/lobehub-parity/settings-ss-compact-default-revision.md",
}

REQUIRED_SURFACES = [
    "Home",
    "Agent Chat",
    "Agent Profile",
    "Tasks",
    "Pages",
    "Resources",
    "Memory",
    "Skills / Tools",
    "Image",
    "Settings",
    "Community",
]
DEFERRED_VISUAL_SURFACES = {"Image", "Community"}
ACTIVE_VISUAL_SURFACES = [surface for surface in REQUIRED_SURFACES if surface not in DEFERRED_VISUAL_SURFACES]
ALLOWED_ACTIVE_VISUAL_VERDICTS = {"revision-required", "acceptable-delta", "ready-for-owner-review"}
ALLOWED_VISUAL_DELTA_DISPOSITIONS = {"undecided", "confirmed", "revision-required", "deferred"}
ACTIVE_COMPACT_ARTIFACTS = {
    "Home": {"screenshot": "tmp/agent-lobehub-l2-screenshots/home-ci-compact-dashboard-scoped.png", "dom": "tmp/agent-lobehub-home-ci-dom.json", "compactFlag": "compactHome", "revisionDoc": "homeCiCompactRevision"},
    "Agent Chat": {"screenshot": "tmp/agent-lobehub-l2-screenshots/chat-da-compact-new-topic-scoped.png", "dom": "tmp/agent-lobehub-chat-da-dom.json", "compactFlag": "compactChat", "revisionDoc": "chatDaCompactRevision"},
    "Agent Profile": {"screenshot": "tmp/agent-lobehub-l2-screenshots/profile-dd-compact-builder-scoped.png", "dom": "tmp/agent-lobehub-profile-dd-dom.json", "compactFlag": "compactProfile", "revisionDoc": "profileDdCompactRevision"},
    "Tasks": {"screenshot": "tmp/agent-lobehub-l2-screenshots/tasks-cm-compact-tasks-scoped.png", "dom": "tmp/agent-lobehub-tasks-cm-dom.json", "compactFlag": "compactTasks", "revisionDoc": "tasksCompactRevision"},
    "Pages": {"screenshot": "tmp/agent-lobehub-l2-screenshots/pages-cn-compact-pages-scoped.png", "dom": "tmp/agent-lobehub-pages-cn-dom.json", "compactFlag": "compactPages", "revisionDoc": "pagesCompactRevision"},
    "Resources": {"screenshot": "tmp/agent-lobehub-l2-screenshots/resources-co-compact-explorer-scoped.png", "dom": "tmp/agent-lobehub-resources-co-dom.json", "compactFlag": "compactResources", "revisionDoc": "resourcesCompactRevision"},
    "Memory": {"screenshot": "tmp/agent-lobehub-l2-screenshots/memory-cp-compact-home-scoped.png", "dom": "tmp/agent-lobehub-memory-cp-dom.json", "compactFlag": "compactMemory", "revisionDoc": "memoryCompactRevision"},
    "Skills / Tools": {"screenshot": "tmp/agent-lobehub-l2-screenshots/skills-cq-compact-settings-scoped.png", "dom": "tmp/agent-lobehub-skills-cq-dom.json", "compactFlag": "compactSkills", "revisionDoc": "skillsCompactRevision"},
    "Settings": {"screenshot": "tmp/agent-lobehub-l2-screenshots/settings-cr-compact-provider-grid-scoped.png", "dom": "tmp/agent-lobehub-settings-cr-dom.json", "compactFlag": "compactSettings", "revisionDoc": "settingsCompactRevision"},
}

ACTIVE_REVIEW_SOURCE_REQUIREMENTS = [
    {
        "url": "?surface=home&state=compact-home&check=ci",
        "surface": "home",
        "component": "HomeSurface",
        "stateToken": "compact-home",
        "compactMarker": "is-compact-home",
    },
    {
        "url": "?surface=chat&check=da",
        "surface": "chat",
        "component": "ChatSurface",
        "stateToken": None,
        "compactMarker": "is-compact-chat",
    },
    {
        "url": "?surface=profile&check=dd",
        "surface": "profile",
        "component": "ProfileSurface",
        "stateToken": None,
        "compactMarker": "is-compact-profile",
    },
    {
        "url": "?surface=tasks&check=cm",
        "surface": "tasks",
        "component": "TasksSurface",
        "stateToken": None,
        "compactMarker": "is-compact-tasks",
    },
    {
        "url": "?surface=pages&check=cn",
        "surface": "pages",
        "component": "PagesSurface",
        "stateToken": None,
        "compactMarker": "is-compact-pages",
    },
    {
        "url": "?surface=resources&state=compact-resources&check=co",
        "surface": "resources",
        "component": "ResourcesSurface",
        "stateToken": "compact-resources",
        "compactMarker": "is-compact-resources",
    },
    {
        "url": "?surface=memory&state=compact-memory&check=cp",
        "surface": "memory",
        "component": "MemorySurface",
        "stateToken": "compact-memory",
        "compactMarker": "is-compact-memory",
    },
    {
        "url": "?surface=skills&state=compact-skills&check=cq",
        "surface": "skills",
        "component": "SkillsSurface",
        "stateToken": "compact-skills",
        "compactMarker": "is-compact-skills",
    },
    {
        "url": "?surface=settings&state=compact-settings&check=cr",
        "surface": "settings",
        "component": "SettingsSurface",
        "stateToken": "compact-settings",
        "compactMarker": "pt-settings-compact-layout",
    },
]
REQUIRED_REVIEW_EXECUTION_EVIDENCE = [
    "EVID-011-CJ-pre",
    "EVID-011-CK-pre",
    "EVID-011-DB-pre",
    "EVID-011-CL-pre",
    "EVID-011-DD-pre",
    "EVID-011-CM-pre",
    "EVID-011-CN-pre",
    "EVID-011-CO-pre",
    "EVID-011-CP-pre",
    "EVID-011-CQ-pre",
    "EVID-011-CR-pre",
    "EVID-011-CS-pre",
    "EVID-011-L23-pre",
    "EVID-011-CV-pre",
    "EVID-011-DC-pre",
    "EVID-011-DD-pre",
]

REQUIRED_PRE_CONFIRMATION_HANDOFF_EVIDENCE = [
    "EVID-011-CS-pre",
    "EVID-011-GA-pre",
    "EVID-011-L23-pre",
    "EVID-011-CT-pre",
    "EVID-011-CU-pre",
    "EVID-011-CV-pre",
    "EVID-011-CW-pre",
    "EVID-011-CX-pre",
    "EVID-011-CY-pre",
    "EVID-011-DB-pre",
    "EVID-011-DC-pre",
    "EVID-011-DD-pre",
]

REQUIRED_CANONICAL_PROTOTYPE_EVIDENCE = [
    "EVID-011-CS-pre",
    "EVID-011-GA-pre",
    "EVID-011-L23-pre",
    "EVID-011-CT-pre",
    "EVID-011-CU-pre",
    "EVID-011-CV-pre",
    "EVID-011-CW-pre",
    "EVID-011-CX-pre",
    "EVID-011-CY-pre",
    "EVID-011-DB-pre",
    "EVID-011-DC-pre",
    "EVID-011-DD-pre",
]
FORBIDDEN_STALE_HANDOFF_SNIPPETS = {
    "ownerDecisionSnapshot": [
        "through EVID-011-CS-pre / EVID-011-L23-pre / EVID-011-CT-pre",
        "active compact L2/L3 artifact validation and checklist/runbook scoped execution evidence validation.",
    ],
    "preImplementationReadiness": [
        "EVID-011-CS-pre / EVID-011-L23-pre / EVID-011-CT-pre |",
        "EVID-011-CV-pre / EVID-011-CW-pre |",
        "through `EVID-011-CT-pre`",
        "Chat `EVID-011-CK-pre`",
        "Chat `chat-ck-compact-new-topic-scoped.png`",
    ],
    "confirmationGapAudit": [
        "Agent Chat | EVID-011-CC-pre / EVID-011-CK-pre",
        "Compare CK against live Agent Chat",
        "Chat `EVID-011-CK-pre`",
    ],
    "prototypeEvidence": [
        "Agent Chat clean scoped artifact evidence: EVID-011-CK-pre promotes",
        "Agent Chat BT + CC/CK",
    ],
    "visualComparisonLedger": [
        "active compact-baseline gate now validates Agent Chat against `chat-ck-compact-new-topic-scoped.png`",
        "Chat CC/CK",
    ],
}
REQUIRED_ACTIVE_REVIEW_URLS = [
    "?surface=home&state=compact-home&check=ci",
    "?surface=chat&check=da",
    "?surface=profile&check=dd",
    "?surface=tasks&check=cm",
    "?surface=pages&check=cn",
    "?surface=resources&state=compact-resources&check=co",
    "?surface=memory&state=compact-memory&check=cp",
    "?surface=skills&state=compact-skills&check=cq",
    "?surface=settings&state=compact-settings&check=cr",
]
ALLOWED_REVIEW_URLS = {
    *REQUIRED_ACTIVE_REVIEW_URLS,
    "?surface=home&state=deep-home&check=bx",
    "?surface=chat&state=deep-chat&working=review&check=bt",
    "?surface=profile&state=deep-profile&check=bu",
    "?surface=tasks&state=deep-tasks&check=bv",
    "?surface=pages&state=deep-pages&check=bw",
    "?surface=resources&state=deep-resource&check=bp",
    "?surface=memory&state=deep-memory&check=bq",
    "?surface=memory&state=detail-missing&check=bq",
    "?surface=skills&state=deep-skills&check=br",
    "?surface=skills&state=import-failure&check=br",
    "?surface=settings&state=deep-settings&check=bs",
    "?surface=settings&tab=Service%20Model&state=service-picker&check=bs",
    "?surface=settings&tab=Storage&check=bs",
    "?surface=image&state=copy-failure",
    "?surface=community&category=workspace",
}

ALLOWED_TRACEABILITY_STATUS = {
    "not-started",
    "in-progress",
    "blocked",
    "implemented",
    "verified",
    "deferred",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def markdown_cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def png_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        data = path.read_bytes()[:24]
    except OSError:
        return None
    if len(data) < 24 or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    return struct.unpack(">II", data[16:24])


def table_rows(text: str, first_cell_prefix: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = markdown_cells(stripped)
        if cells and cells[0].startswith(first_cell_prefix):
            rows.append(cells)
    return rows


def prototype_registry_status(registry: str, prototype_id: str = "`agent-lobehub-parity`") -> str | None:
    for line in registry.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|") or prototype_id not in stripped:
            continue
        cells = markdown_cells(stripped)
        if len(cells) >= 7:
            return cells[6]
    return None


def visual_surface_rows(ledger: str) -> dict[str, dict[str, str]]:
    rows: dict[str, dict[str, str]] = {}
    for line in ledger.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = markdown_cells(stripped)
        if len(cells) < 8 or cells[0] in {"Surface", "---"}:
            continue
        if cells[0] not in REQUIRED_SURFACES:
            continue
        rows[cells[0]] = {
            "bomSpec": cells[1],
            "source": cells[2],
            "liveReference": cells[3],
            "prototypeReference": cells[4],
            "matched": cells[5],
            "delta": cells[6],
            "verdict": cells[7],
        }
    return rows


def visual_surface_shape(ledger: str) -> dict[str, Any]:
    counts = {surface: 0 for surface in REQUIRED_SURFACES}
    unknown_surfaces: list[str] = []
    for line in ledger.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = markdown_cells(stripped)
        if len(cells) < 8 or cells[0] in {"Surface", "---"}:
            continue
        surface = cells[0]
        if surface not in counts:
            unknown_surfaces.append(surface)
            continue
        counts[surface] += 1
    duplicate_surfaces = [surface for surface, count in counts.items() if count > 1]
    return {
        "duplicates": duplicate_surfaces,
        "unknownSurfaces": unknown_surfaces,
        "rowCounts": counts,
    }


def visual_verdict_coverage(rows: dict[str, dict[str, str]]) -> dict[str, list[str]]:
    return {
        "activeRevisionRequired": [
            surface
            for surface in ACTIVE_VISUAL_SURFACES
            if rows.get(surface, {}).get("verdict") == "revision-required"
        ],
        "activeAcceptableDelta": [
            surface
            for surface in ACTIVE_VISUAL_SURFACES
            if rows.get(surface, {}).get("verdict") == "acceptable-delta"
        ],
        "activeReadyForOwnerReview": [
            surface
            for surface in ACTIVE_VISUAL_SURFACES
            if rows.get(surface, {}).get("verdict") == "ready-for-owner-review"
        ],
        "deferredMarkedDeferred": [
            surface
            for surface in DEFERRED_VISUAL_SURFACES
            if rows.get(surface, {}).get("verdict") == "deferred"
        ],
    }


def visual_delta_checklist_rows(checklist: str) -> dict[str, dict[str, str]]:
    rows: dict[str, dict[str, str]] = {}
    in_section = False
    for line in checklist.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            in_section = stripped == "## Visual Delta Checklist"
            continue
        if not in_section or not stripped.startswith("|"):
            continue
        cells = markdown_cells(stripped)
        if len(cells) < 5 or cells[0] in {"Surface", "---"}:
            continue
        if cells[0] not in REQUIRED_SURFACES:
            continue
        rows[cells[0]] = {
            "lobehubReference": cells[1],
            "peersReference": cells[2],
            "comparisonAction": cells[3],
            "ownerDisposition": cells[4],
        }
    return rows


def visual_delta_checklist_shape(checklist: str) -> dict[str, Any]:
    counts = {surface: 0 for surface in REQUIRED_SURFACES}
    unknown_surfaces: list[str] = []
    in_section = False
    for line in checklist.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            in_section = stripped == "## Visual Delta Checklist"
            continue
        if not in_section or not stripped.startswith("|"):
            continue
        cells = markdown_cells(stripped)
        if len(cells) < 5 or cells[0] in {"Surface", "---"}:
            continue
        surface = cells[0]
        if surface not in counts:
            unknown_surfaces.append(surface)
            continue
        counts[surface] += 1
    duplicate_surfaces = [surface for surface, count in counts.items() if count > 1]
    return {
        "duplicates": duplicate_surfaces,
        "unknownSurfaces": unknown_surfaces,
        "rowCounts": counts,
    }


def visual_delta_anchor_coverage(rows: dict[str, dict[str, str]]) -> dict[str, list[str]]:
    return {
        "lobehubLive": [
            surface for surface, row in rows.items() if "app.lobehub.com" in row["lobehubReference"]
        ],
        "lobehubSource": [
            surface for surface, row in rows.items() if "external/lobehub" in row["lobehubReference"]
        ],
        "peersPrototype": [
            surface
            for surface, row in rows.items()
            if "agent-lobehub-parity" in row["peersReference"] or "surface=" in row["peersReference"]
        ],
    }


def visual_delta_disposition_coverage(rows: dict[str, dict[str, str]]) -> dict[str, list[str]]:
    return {
        "activeUndecided": [
            surface
            for surface in ACTIVE_VISUAL_SURFACES
            if rows.get(surface, {}).get("ownerDisposition", "").strip("`").lower() == "undecided"
        ],
        "deferredMarkedDeferred": [
            surface
            for surface in DEFERRED_VISUAL_SURFACES
            if rows.get(surface, {}).get("ownerDisposition", "").strip("`").lower() == "deferred"
        ],
    }


def review_urls(text: str) -> list[str]:
    return sorted(set(re.findall(r"\?surface=[^`\s;)]+(?:&[^`\s;)]+)*", text)))


def evidence_rows(ledger: str) -> list[list[str]]:
    return table_rows(ledger, "EVID-")


def traceability_rows(ledger: str) -> list[list[str]]:
    return table_rows(ledger, "BOM-")


def add_issue(
    issues: list[dict[str, Any]],
    *,
    category: str,
    failed_step: str,
    summary: str,
    path: str,
    proof_impact: str,
    evidence_details: dict[str, Any] | None = None,
) -> None:
    issues.append(
        {
            "category": category,
            "failedStep": failed_step,
            "summary": summary,
            "path": path,
            "proofImpact": proof_impact,
            "sourceArtifact": f"{DEFAULT_OUTPUT_PREFIX}.json",
            "sourceArtifactKind": ARTIFACT_KIND,
            "sourcePhase": PHASE,
            "sourceBom": BOM,
            "sourceSpec": SPEC,
            "sourceGate": GATE,
            "evidenceDetails": evidence_details or {},
        }
    )


def check_required_files(repo_root: Path, issues: list[dict[str, Any]]) -> dict[str, str]:
    contents: dict[str, str] = {}
    for key, relative in REQUIRED_FILES.items():
        text = read_text(repo_root / relative)
        if text is None:
            add_issue(
                issues,
                category="missing-file",
                failed_step=f"read-{key}",
                summary=f"required evidence-chain file is missing: {relative}",
                path=relative,
                proof_impact="Evidence-chain state cannot be audited without every required control document.",
            )
            continue
        contents[key] = text
    return contents


def check_evidence_rows(ledger_path: Path, ledger: str, issues: list[dict[str, Any]]) -> dict[str, Any]:
    rows = evidence_rows(ledger)
    ids = {row[0] for row in rows}
    for evidence_id in REQUIRED_EVIDENCE:
        if evidence_id not in ids:
            add_issue(
                issues,
                category="missing-evidence",
                failed_step="required-pre-evidence",
                summary=f"required pre-implementation evidence row is missing: {evidence_id}",
                path=str(ledger_path),
                proof_impact="Owner-review and PLAN-P5 entry controls cannot be trusted without the latest pre-evidence rows.",
            )
    malformed = [row[0] for row in rows if len(row) < 8]
    if malformed:
        add_issue(
            issues,
            category="malformed-evidence-row",
            failed_step="evidence-row-shape",
            summary="one or more Evidence rows do not contain the required fields",
            path=str(ledger_path),
            proof_impact="Every Evidence row must preserve BOM, Spec, Plan, Gate, artifact, result, and risk traceability.",
            evidence_details={"evidenceIds": malformed},
        )
    product_rows = [row[0] for row in rows if row[0] in {"EVID-012", "EVID-012-working"}]
    return {
        "evidenceCount": len(rows),
        "requiredEvidencePresent": sorted(evidence_id for evidence_id in REQUIRED_EVIDENCE if evidence_id in ids),
        "productEvidenceRows": product_rows,
    }


def check_traceability(ledger_path: Path, ledger: str, issues: list[dict[str, Any]]) -> dict[str, Any]:
    rows = traceability_rows(ledger)
    statuses: dict[str, str] = {}
    invalid: list[dict[str, str]] = []
    for row in rows:
        if len(row) < 3:
            invalid.append({"bom": row[0], "status": "", "reason": "traceability row has fewer than 10 columns"})
            continue
        # Some cells contain inline examples with literal pipe characters. The
        # status/risk columns are the stable tail columns, so read from the end.
        status = row[-2]
        statuses[row[0]] = status
        if status not in ALLOWED_TRACEABILITY_STATUS:
            invalid.append({"bom": row[0], "status": status, "reason": "status is outside the allowed set"})
    if invalid:
        add_issue(
            issues,
            category="traceability-status",
            failed_step="traceability-status-enum",
            summary="traceability table contains invalid status values",
            path=str(ledger_path),
            proof_impact="Traceability status must use only the goal-defined lifecycle values.",
            evidence_details={"invalidRows": invalid, "allowedStatuses": sorted(ALLOWED_TRACEABILITY_STATUS)},
        )
    return {"traceabilityCount": len(rows), "statuses": statuses}


def check_fail_closed_prototype_state(repo_root: Path, ledger: str, contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    owner_revision_required = "| EVID-011-Z-owner |" in ledger and "OWNER_DECISION: revision-required" in ledger
    registry_status = prototype_registry_status(contents.get("prototypeRegistry", ""))
    states = {
        "manifestPendingReview": bool(re.search(r"status:\s*['\"]pending-review['\"]", contents.get("manifest", ""))),
        "manifestDrafting": bool(re.search(r"status:\s*['\"]drafting['\"]", contents.get("manifest", ""))),
        "registryPendingReview": registry_status == "pending-review",
        "registryDrafting": registry_status == "drafting",
        "reviewEntryPendingReview": "**Status**: pending-review" in contents.get("prototypeReviewEntry", "")
        and "| Status | `pending-review` |" in contents.get("prototypeReviewEntry", ""),
        "reviewEntryDrafting": "**Status**: drafting" in contents.get("prototypeReviewEntry", "")
        and "| Status | `drafting` |" in contents.get("prototypeReviewEntry", ""),
        "ownerRevisionRequired": owner_revision_required,
        "entryGateBlocked": "blocked-before-owner-confirmation" in contents.get("planP5EntryGate", ""),
        "runbookDoesNotConfirm": "does not confirm the prototype" in contents.get("prototypeRunbook", ""),
        "registryStatus": registry_status,
    }
    pending_review_safe = states["manifestPendingReview"] and states["registryPendingReview"] and states["reviewEntryPendingReview"]
    revision_safe = (
        states["ownerRevisionRequired"]
        and states["manifestDrafting"]
        and states["registryDrafting"]
        and states["reviewEntryDrafting"]
    )
    fail_closed_safe = (pending_review_safe or revision_safe) and states["entryGateBlocked"] and states["runbookDoesNotConfirm"]
    if not fail_closed_safe:
        add_issue(
            issues,
            category="prototype-fail-closed-state",
            failed_step="prototype-state-consistency",
            summary="prototype fail-closed state is inconsistent",
            path=str(repo_root),
            proof_impact="Prototype migration readiness can only be claimed when manifest, registry, review docs and P5 gate agree on pending-review or revision-required drafting state.",
            evidence_details={
                "state": states,
                "pendingReviewSafe": pending_review_safe,
                "revisionSafe": revision_safe,
            },
        )
    return states


def check_visual_comparison_ledger(repo_root: Path, contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    ledger = contents.get("visualComparisonLedger", "")
    rows = visual_surface_rows(ledger)
    shape = visual_surface_shape(ledger)
    if shape["duplicates"] or shape["unknownSurfaces"]:
        add_issue(
            issues,
            category="invalid-visual-comparison-surface-shape",
            failed_step="visual-comparison-surface-shape",
            summary="visual comparison ledger contains duplicate or unknown surfaces",
            path=str(repo_root / REQUIRED_FILES["visualComparisonLedger"]),
            proof_impact="Evidence-chain readiness cannot prove deterministic L1/L2/L3 surface evidence if the visual comparison ledger has duplicate or unknown surface rows.",
            evidence_details=shape,
        )

    missing_surfaces = [surface for surface in REQUIRED_SURFACES if surface not in rows]
    if missing_surfaces:
        add_issue(
            issues,
            category="missing-visual-surface",
            failed_step="visual-comparison-surface-coverage",
            summary="visual comparison ledger is missing required surfaces",
            path=str(repo_root / REQUIRED_FILES["visualComparisonLedger"]),
            proof_impact="Evidence-chain readiness cannot prove surface-by-surface prototype review unless every required surface has a comparison row.",
            evidence_details={"missingSurfaces": missing_surfaces},
        )

    incomplete_fields: list[dict[str, str]] = []
    invalid_verdicts: list[dict[str, str]] = []
    for surface, row in rows.items():
        for field in ["source", "liveReference", "prototypeReference", "matched", "delta", "verdict"]:
            if not row.get(field) or row[field] in {"-", "TBD", "TODO"}:
                incomplete_fields.append({"surface": surface, "field": field})
        if "external/lobehub" not in row.get("source", ""):
            incomplete_fields.append({"surface": surface, "field": "source"})

        verdict = row.get("verdict", "")
        if surface in DEFERRED_VISUAL_SURFACES:
            if verdict != "deferred" or "Deferred by Owner" not in row.get("delta", ""):
                invalid_verdicts.append({"surface": surface, "verdict": verdict, "expected": "deferred by Owner"})
        elif verdict not in ALLOWED_ACTIVE_VISUAL_VERDICTS:
            invalid_verdicts.append(
                {
                    "surface": surface,
                    "verdict": verdict,
                    "expected": ", ".join(sorted(ALLOWED_ACTIVE_VISUAL_VERDICTS)),
                }
            )

    if incomplete_fields:
        add_issue(
            issues,
            category="incomplete-visual-evidence",
            failed_step="visual-comparison-required-fields",
            summary="visual comparison ledger has incomplete source/live/prototype/matched/delta/verdict evidence",
            path=str(repo_root / REQUIRED_FILES["visualComparisonLedger"]),
            proof_impact="Every surface row must preserve source-backed L1, live/prototype L2/L3 references and explicit deltas before Owner review.",
            evidence_details={"fields": incomplete_fields},
        )
    if invalid_verdicts:
        add_issue(
            issues,
            category="invalid-visual-verdict",
            failed_step="visual-comparison-verdicts",
            summary="visual comparison ledger has invalid verdicts for the current review scope",
            path=str(repo_root / REQUIRED_FILES["visualComparisonLedger"]),
            proof_impact="Active surfaces cannot stay blocked or deferred for pending-review; deferred surfaces must match the Owner-deferred scope.",
            evidence_details={"verdicts": invalid_verdicts},
        )

    verdicts = {surface: row["verdict"] for surface, row in rows.items()}
    return {
        "surfaceCount": len(rows),
        "activeSurfaces": ACTIVE_VISUAL_SURFACES,
        "deferredSurfaces": sorted(DEFERRED_VISUAL_SURFACES),
        "surfaceShape": shape,
        "verdicts": verdicts,
        "verdictCoverage": visual_verdict_coverage(rows),
    }


def check_active_compact_artifacts(repo_root: Path, contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    results: dict[str, Any] = {}
    invalid: list[dict[str, Any]] = []
    for surface, artifact in ACTIVE_COMPACT_ARTIFACTS.items():
        screenshot_path = repo_root / artifact["screenshot"]
        dom_path = repo_root / artifact["dom"]
        revision_doc_key = artifact["revisionDoc"]
        compact_flag = artifact["compactFlag"]
        dimensions = png_dimensions(screenshot_path)
        surface_result: dict[str, Any] = {
            "screenshot": artifact["screenshot"],
            "dom": artifact["dom"],
            "compactFlag": compact_flag,
            "revisionDoc": REQUIRED_FILES[revision_doc_key],
            "pngDimensions": dimensions,
            "revisionDocPresent": bool(contents.get(revision_doc_key)),
        }
        if dimensions is None:
            invalid.append({"surface": surface, "artifact": artifact["screenshot"], "reason": "missing-or-invalid-png"})

        try:
            dom = json.loads(dom_path.read_text(encoding="utf-8"))
            surface_result["domParsed"] = True
            surface_result["compactFlagValue"] = dom.get(compact_flag)
            surface_result["forbiddenHits"] = dom.get("forbiddenHits")
            if dom.get(compact_flag) is not True:
                invalid.append({"surface": surface, "artifact": artifact["dom"], "reason": "compact-flag-not-true", "flag": compact_flag})
            if dom.get("forbiddenHits") != []:
                invalid.append({"surface": surface, "artifact": artifact["dom"], "reason": "forbidden-hits-not-empty", "forbiddenHits": dom.get("forbiddenHits")})
        except (OSError, json.JSONDecodeError) as exc:
            surface_result["domParsed"] = False
            surface_result["domError"] = str(exc)
            invalid.append({"surface": surface, "artifact": artifact["dom"], "reason": "missing-or-invalid-dom-json", "error": str(exc)})

        if not surface_result["revisionDocPresent"]:
            invalid.append({"surface": surface, "artifact": REQUIRED_FILES[revision_doc_key], "reason": "missing-revision-doc"})
        results[surface] = surface_result

    if invalid:
        add_issue(
            issues,
            category="invalid-active-compact-artifact",
            failed_step="active-compact-l2-l3-artifact-validation",
            summary="active compact baseline L2/L3 artifacts are missing, invalid, or not fail-closed",
            path=str(repo_root),
            proof_impact="Evidence-chain readiness cannot rely on compact baseline evidence unless every active surface has a readable screenshot, parseable DOM JSON, compact marker and empty forbiddenHits.",
            evidence_details={"invalidArtifacts": invalid},
        )

    return {
        "requiredSurfaceCount": len(ACTIVE_COMPACT_ARTIFACTS),
        "invalidArtifacts": invalid,
        "surfaces": results,
    }


def check_visual_delta_checklist(repo_root: Path, contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    checklist = contents.get("ownerChecklist", "")
    shape = visual_delta_checklist_shape(checklist)
    if shape["duplicates"] or shape["unknownSurfaces"]:
        add_issue(
            issues,
            category="invalid-visual-delta-surface-shape",
            failed_step="visual-delta-checklist-surface-shape",
            summary="Owner checklist Visual Delta rows contain duplicate or unknown surfaces",
            path=str(repo_root / REQUIRED_FILES["ownerChecklist"]),
            proof_impact="Evidence-chain readiness cannot prove deterministic per-surface Owner review if the Visual Delta Checklist has duplicate or unknown surface rows.",
            evidence_details=shape,
        )

    rows = visual_delta_checklist_rows(checklist)
    missing_surfaces = [surface for surface in REQUIRED_SURFACES if surface not in rows]
    if missing_surfaces:
        add_issue(
            issues,
            category="missing-visual-delta-checklist",
            failed_step="visual-delta-checklist-surface-coverage",
            summary="Owner checklist is missing required Visual Delta Checklist surface rows",
            path=str(repo_root / REQUIRED_FILES["ownerChecklist"]),
            proof_impact="Evidence-chain readiness cannot prove Owner-review fidelity controls unless every surface has a side-by-side visual delta row.",
            evidence_details={"missingSurfaces": missing_surfaces},
        )

    incomplete_rows: list[dict[str, str]] = []
    invalid_dispositions: list[dict[str, str]] = []
    for surface, row in rows.items():
        if "side-by-side" not in row["comparisonAction"].lower():
            incomplete_rows.append({"surface": surface, "field": "comparisonAction"})
        if "app.lobehub.com" not in row["lobehubReference"]:
            incomplete_rows.append({"surface": surface, "field": "lobehubLiveReference"})
        if "external/lobehub" not in row["lobehubReference"]:
            incomplete_rows.append({"surface": surface, "field": "lobehubReference"})
        if "agent-lobehub-parity" not in row["peersReference"] and "surface=" not in row["peersReference"]:
            incomplete_rows.append({"surface": surface, "field": "peersReference"})
        disposition = row["ownerDisposition"].strip("`").lower()
        expected_disposition = "deferred" if surface in DEFERRED_VISUAL_SURFACES else "undecided"
        if disposition not in ALLOWED_VISUAL_DELTA_DISPOSITIONS or disposition != expected_disposition:
            invalid_dispositions.append(
                {
                    "surface": surface,
                    "disposition": disposition,
                    "expected": expected_disposition,
                }
            )
    if incomplete_rows:
        add_issue(
            issues,
            category="incomplete-visual-delta-checklist",
            failed_step="visual-delta-checklist-required-fields",
            summary="Owner checklist Visual Delta rows are missing side-by-side/source/prototype review anchors",
            path=str(repo_root / REQUIRED_FILES["ownerChecklist"]),
            proof_impact="Owner review controls must force side-by-side LobeHub vs Peers inspection before any confirmation can feed PLAN-P5.",
            evidence_details={"fields": incomplete_rows},
        )
    if invalid_dispositions:
        add_issue(
            issues,
            category="invalid-visual-delta-disposition",
            failed_step="visual-delta-disposition-fail-closed",
            summary="Owner checklist Visual Delta rows have dispositions that are unsafe for pre-confirmation review",
            path=str(repo_root / REQUIRED_FILES["ownerChecklist"]),
            proof_impact="Before Owner confirmation can feed PLAN-P5, active visual delta rows must remain undecided and only Owner-deferred surfaces may be marked deferred.",
            evidence_details={"dispositions": invalid_dispositions},
        )

    return {
        "surfaceCount": len(rows),
        "surfaceShape": shape,
        "surfaces": [surface for surface in REQUIRED_SURFACES if surface in rows],
        "dispositions": {
            surface: row["ownerDisposition"].strip("`").lower()
            for surface, row in rows.items()
        },
        "anchorCoverage": visual_delta_anchor_coverage(rows),
        "dispositionCoverage": visual_delta_disposition_coverage(rows),
    }


def check_review_execution_evidence(repo_root: Path, contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    docs = {
        "prototypeRunbook": contents.get("prototypeRunbook", ""),
        "ownerChecklist": contents.get("ownerChecklist", ""),
    }
    present: dict[str, list[str]] = {}
    urls_by_doc: dict[str, list[str]] = {}
    for doc_name, doc_text in docs.items():
        present[doc_name] = [
            evidence_id for evidence_id in REQUIRED_REVIEW_EXECUTION_EVIDENCE if evidence_id in doc_text
        ]
        missing = [
            evidence_id for evidence_id in REQUIRED_REVIEW_EXECUTION_EVIDENCE if evidence_id not in doc_text
        ]
        if missing:
            add_issue(
                issues,
                category="missing-review-execution-evidence",
                failed_step=f"{doc_name}-scoped-artifact-evidence",
                summary=f"{doc_name} is missing active scoped artifact review evidence IDs",
                path=str(repo_root / REQUIRED_FILES[doc_name]),
                proof_impact="Evidence-chain readiness cannot prove Owner review execution unless checklist/runbook point at the current scoped L2/L3 artifact baseline.",
                evidence_details={"missingEvidence": missing},
            )
        urls = review_urls(doc_text)
        urls_by_doc[doc_name] = urls
        invalid_urls = [url for url in urls if url not in ALLOWED_REVIEW_URLS]
        if invalid_urls:
            add_issue(
                issues,
                category="invalid-review-execution-url",
                failed_step=f"{doc_name}-review-url-allowlist",
                summary=f"{doc_name} contains unknown or stale prototype review URLs",
                path=str(repo_root / REQUIRED_FILES[doc_name]),
                proof_impact="Evidence-chain readiness cannot prove Owner review execution if checklist/runbook open unknown or stale prototype states.",
                evidence_details={"invalidUrls": invalid_urls},
            )
    combined_docs = "\n".join(docs.values())
    missing_active_urls = [url for url in REQUIRED_ACTIVE_REVIEW_URLS if url not in combined_docs]
    if missing_active_urls:
        add_issue(
            issues,
            category="missing-active-review-url",
            failed_step="active-surface-review-url-coverage",
            summary="Owner execution docs are missing current active compact review URLs",
            path=str(repo_root / REQUIRED_FILES["prototypeRunbook"]),
            proof_impact="Evidence-chain readiness cannot prove deterministic Owner review unless every active compact surface has its current review URL available.",
            evidence_details={"missingUrls": missing_active_urls},
        )
    return {
        "requiredEvidenceCount": len(REQUIRED_REVIEW_EXECUTION_EVIDENCE),
        "present": present,
        "requiredActiveUrlCount": len(REQUIRED_ACTIVE_REVIEW_URLS),
        "requiredActiveUrlsPresent": [
            url for url in REQUIRED_ACTIVE_REVIEW_URLS if url in combined_docs
        ],
        "urlsByDoc": urls_by_doc,
    }


def check_active_review_source_reachability(repo_root: Path, contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    source = contents.get("prototypeSource", "")
    results: dict[str, Any] = {}
    invalid: list[dict[str, Any]] = []
    for requirement in ACTIVE_REVIEW_SOURCE_REQUIREMENTS:
        surface = requirement["surface"]
        state_token = requirement["stateToken"]
        checks = {
            "surfaceTypePresent": f"| '{surface}'" in source,
            "initialSurfacePresent": f"'{surface}'" in source,
            "renderBranchPresent": f"surface === '{surface}' && <{requirement['component']}" in source,
            "stateTokenPresent": state_token is None or f"'{state_token}'" in source or f'"{state_token}"' in source,
            "compactMarkerPresent": requirement["compactMarker"] in source,
        }
        failed = [name for name, ok in checks.items() if not ok]
        results[requirement["url"]] = {
            "surface": surface,
            "component": requirement["component"],
            "stateToken": state_token,
            "compactMarker": requirement["compactMarker"],
            "checks": checks,
            "failedChecks": failed,
        }
        if failed:
            invalid.append(
                {
                    "url": requirement["url"],
                    "surface": surface,
                    "component": requirement["component"],
                    "stateToken": state_token,
                    "compactMarker": requirement["compactMarker"],
                    "failedChecks": failed,
                }
            )

    if invalid:
        add_issue(
            issues,
            category="invalid-active-review-source-reachability",
            failed_step="active-review-url-source-reachability",
            summary="active compact review URLs are not backed by reachable prototype source branches",
            path=str(repo_root / REQUIRED_FILES["prototypeSource"]),
            proof_impact="Evidence-chain readiness cannot prove Owner review execution if review URLs lack an implemented surface branch, handled state token, or compact DOM marker in the prototype source.",
            evidence_details={"invalidUrls": invalid},
        )

    return {
        "requiredUrlCount": len(ACTIVE_REVIEW_SOURCE_REQUIREMENTS),
        "reachableUrlCount": len(ACTIVE_REVIEW_SOURCE_REQUIREMENTS) - len(invalid),
        "invalidUrls": invalid,
        "urls": results,
    }


def check_pre_confirmation_handoff_evidence(repo_root: Path, contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    docs = {
        "confirmationGapAudit": contents.get("confirmationGapAudit", ""),
        "preImplementationReadiness": contents.get("preImplementationReadiness", ""),
    }
    present: dict[str, list[str]] = {}
    for doc_name, doc_text in docs.items():
        present[doc_name] = [
            evidence_id for evidence_id in REQUIRED_PRE_CONFIRMATION_HANDOFF_EVIDENCE if evidence_id in doc_text
        ]
        missing = [
            evidence_id for evidence_id in REQUIRED_PRE_CONFIRMATION_HANDOFF_EVIDENCE if evidence_id not in doc_text
        ]
        if missing:
            add_issue(
                issues,
                category="missing-pre-confirmation-handoff-evidence",
                failed_step=f"{doc_name}-latest-evidence-sync",
                summary=f"{doc_name} is missing latest pre-confirmation handoff evidence IDs",
                path=str(repo_root / REQUIRED_FILES[doc_name]),
                proof_impact="Evidence-chain readiness cannot prove PLAN-P5 remains safely blocked if gap/readiness docs do not point at the latest review-package, artifact, URL and source-reachability evidence.",
                evidence_details={"missingEvidence": missing},
            )

    return {
        "requiredEvidenceCount": len(REQUIRED_PRE_CONFIRMATION_HANDOFF_EVIDENCE),
        "present": present,
    }


def check_canonical_prototype_evidence(repo_root: Path, contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    prototype_evidence = contents.get("prototypeEvidence", "")
    present = [
        evidence_id for evidence_id in REQUIRED_CANONICAL_PROTOTYPE_EVIDENCE if evidence_id in prototype_evidence
    ]
    missing = [
        evidence_id for evidence_id in REQUIRED_CANONICAL_PROTOTYPE_EVIDENCE if evidence_id not in prototype_evidence
    ]
    if missing:
        add_issue(
            issues,
            category="missing-canonical-prototype-evidence",
            failed_step="canonical-prototype-evidence-sync",
            summary="canonical prototype evidence README is missing latest guard evidence IDs",
            path=str(repo_root / REQUIRED_FILES["prototypeEvidence"]),
            proof_impact="Evidence-chain readiness cannot prove the prototype review package is current if the canonical prototype evidence entry omits the latest review-package, artifact, URL, source-reachability and handoff-sync guards.",
            evidence_details={"missingEvidence": missing},
        )

    return {
        "requiredEvidenceCount": len(REQUIRED_CANONICAL_PROTOTYPE_EVIDENCE),
        "present": present,
    }


def check_handoff_summary_freshness(repo_root: Path, contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    stale_hits: list[dict[str, str]] = []
    for doc_name, snippets in FORBIDDEN_STALE_HANDOFF_SNIPPETS.items():
        doc_text = contents.get(doc_name, "")
        for snippet in snippets:
            if snippet in doc_text:
                stale_hits.append(
                    {
                        "doc": doc_name,
                        "path": str(repo_root / REQUIRED_FILES[doc_name]),
                        "snippet": snippet,
                    }
                )

    if stale_hits:
        add_issue(
            issues,
            category="stale-handoff-summary",
            failed_step="owner-p5-handoff-summary-freshness",
            summary="Owner/P5 handoff docs contain stale summary text from an older evidence chain",
            path=str(repo_root),
            proof_impact="Evidence-chain readiness cannot be trusted if handoff docs summarize readiness as only proven through older CT/CW evidence while later CU/CV/CW/CX/CY guards exist.",
            evidence_details={"staleHits": stale_hits},
        )

    return {
        "forbiddenSnippetCount": sum(len(snippets) for snippets in FORBIDDEN_STALE_HANDOFF_SNIPPETS.values()),
        "staleHits": stale_hits,
    }


def check_owner_and_product_authorization(
    repo_root: Path,
    ledger: str,
    evidence_state: dict[str, Any],
    contents: dict[str, str],
    issues: list[dict[str, Any]],
) -> dict[str, Any]:
    rows = evidence_rows(ledger)
    owner_rows = [row for row in rows if row[0] == "EVID-011-Z-owner"]
    owner_confirmed = any("OWNER_DECISION: confirmed" in " | ".join(row) or "OWNER_CONFIRMED" in " | ".join(row) for row in owner_rows)
    product_rows = evidence_state["productEvidenceRows"]
    blocked_gate = "blocked-before-owner-confirmation" in contents.get("planP5EntryGate", "")

    if product_rows and not owner_confirmed:
        add_issue(
            issues,
            category="unauthorized-product-evidence",
            failed_step="evid-012-before-owner-confirmation",
            summary="EVID-012 product evidence exists before Owner confirmation",
            path=str(repo_root / DEFAULT_LEDGER),
            proof_impact="PLAN-P5 product edits are forbidden until Owner confirmation and the EVID-012 entry gate pass.",
            evidence_details={"productEvidenceRows": product_rows, "ownerRows": [row[0] for row in owner_rows]},
        )
    if owner_confirmed and blocked_gate:
        add_issue(
            issues,
            category="stale-entry-gate",
            failed_step="confirmed-owner-but-gate-still-blocked",
            summary="Owner confirmation is present but PLAN-P5 entry gate still says blocked-before-owner-confirmation",
            path=str(repo_root / REQUIRED_FILES["planP5EntryGate"]),
            proof_impact="Confirmation state and P5 entry gate must be synchronized before any implementation evidence can be trusted.",
        )
    if not owner_confirmed and not blocked_gate:
        add_issue(
            issues,
            category="unsafe-entry-gate",
            failed_step="unconfirmed-owner-but-gate-not-blocked",
            summary="Owner confirmation is missing but PLAN-P5 entry gate is not fail-closed",
            path=str(repo_root / REQUIRED_FILES["planP5EntryGate"]),
            proof_impact="The migration gate must fail closed before Owner confirmation.",
        )

    forbidden_claim_patterns = [
        r"PLAN-P5 Implementation \| implemented",
        r"GATE-008 Product Migration Check \| verified",
        r"Product migration allowed \| PASS",
    ]
    forbidden_claims = []
    scan_text = "\n".join([ledger, contents.get("preImplementationReadiness", ""), contents.get("planP5ControlBoard", "")])
    for pattern in forbidden_claim_patterns:
        if re.search(pattern, scan_text):
            forbidden_claims.append(pattern)
    if forbidden_claims:
        add_issue(
            issues,
            category="forbidden-product-claim",
            failed_step="pre-confirmation-product-claim-scan",
            summary="found product-migration success claim before authorized EVID-012 evidence",
            path=str(repo_root),
            proof_impact="Docs/prototype evidence must not be used to claim GATE-008 or product migration completion.",
            evidence_details={"patterns": forbidden_claims},
        )

    return {
        "ownerEvidenceRows": [row[0] for row in owner_rows],
        "ownerConfirmed": owner_confirmed,
        "productEvidenceRows": product_rows,
        "entryGateBlockedBeforeOwnerConfirmation": blocked_gate,
        "forbiddenClaimPatternsFound": forbidden_claims,
    }


def build_report(repo_root: Path, ledger_path: Path) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    ledger = read_text(repo_root / ledger_path)
    if ledger is None:
        add_issue(
            issues,
            category="missing-ledger",
            failed_step="read-ledger",
            summary=f"ledger is missing: {ledger_path}",
            path=str(ledger_path),
            proof_impact="The Agent LobeHub parity work cannot be audited without the master ledger.",
        )
        ledger = ""
    contents = check_required_files(repo_root, issues)
    evidence_state = check_evidence_rows(ledger_path, ledger, issues)
    traceability_state = check_traceability(ledger_path, ledger, issues)
    pending_review_state = check_fail_closed_prototype_state(repo_root, ledger, contents, issues)
    visual_state = check_visual_comparison_ledger(repo_root, contents, issues)
    compact_artifact_state = check_active_compact_artifacts(repo_root, contents, issues)
    visual_delta_state = check_visual_delta_checklist(repo_root, contents, issues)
    review_execution_state = check_review_execution_evidence(repo_root, contents, issues)
    source_reachability_state = check_active_review_source_reachability(repo_root, contents, issues)
    pre_confirmation_handoff_state = check_pre_confirmation_handoff_evidence(repo_root, contents, issues)
    canonical_prototype_state = check_canonical_prototype_evidence(repo_root, contents, issues)
    handoff_summary_freshness_state = check_handoff_summary_freshness(repo_root, contents, issues)
    authorization_state = check_owner_and_product_authorization(repo_root, ledger, evidence_state, contents, issues)
    status = "pass" if not issues else "fail"
    readiness_claim = {
        "scope": "evidence-chain-consistency-only",
        "gateEvidenceProven": status == "pass",
        "prototypeConfirmed": False,
        "productMigrationAllowed": False,
        "evid012Authorized": False,
    }
    return {
        "schemaVersion": 1,
        "artifactKind": ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "readinessClaim": readiness_claim,
        "phase": PHASE,
        "bom": BOM,
        "spec": SPEC,
        "gate": GATE,
        "repoRoot": str(repo_root),
        "ledger": str(ledger_path),
        "summary": {
            "issueCount": len(issues),
            **evidence_state,
            **traceability_state,
        },
        "pendingReviewState": pending_review_state,
        "visualComparisonState": visual_state,
        "activeCompactArtifactState": compact_artifact_state,
        "visualDeltaChecklistState": visual_delta_state,
        "reviewExecutionEvidenceState": review_execution_state,
        "activeReviewSourceReachabilityState": source_reachability_state,
        "preConfirmationHandoffEvidenceState": pre_confirmation_handoff_state,
        "canonicalPrototypeEvidenceState": canonical_prototype_state,
        "handoffSummaryFreshnessState": handoff_summary_freshness_state,
        "authorizationState": authorization_state,
        "issue_breakdown": issues,
        "issueBreakdown": issues,
        "boundary": "This gate proves evidence-chain consistency only. It does not confirm the prototype, does not create EVID-012, does not edit product code, and does not prove GATE-008 product parity.",
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Agent LobeHub Parity Evidence Chain Gate",
        "",
        f"- Generated: `{report['generatedAt']}`",
        f"- Status: `{report['status']}`",
        f"- Completion: `{report['completionStatus']}`",
        f"- Proof: `{report['proofStatus']}`",
        f"- Readiness claim: `{report['readinessClaim']['scope']}`",
        f"- Prototype confirmed: `{report['readinessClaim']['prototypeConfirmed']}`",
        f"- Product migration allowed: `{report['readinessClaim']['productMigrationAllowed']}`",
        f"- EVID-012 authorized: `{report['readinessClaim']['evid012Authorized']}`",
        f"- Phase: `{report['phase']}`",
        f"- BOM: `{','.join(report['bom'])}`",
        f"- Spec: `{','.join(report['spec'])}`",
        f"- Gate: `{report['gate']}`",
        f"- Ledger: `{report['ledger']}`",
        "",
        "## Current Authorization State",
        "",
        f"- Owner confirmed: `{report['authorizationState']['ownerConfirmed']}`",
        f"- Product evidence rows: `{', '.join(report['authorizationState']['productEvidenceRows']) or 'none'}`",
        f"- PLAN-P5 gate blocked before Owner confirmation: `{report['authorizationState']['entryGateBlockedBeforeOwnerConfirmation']}`",
        "",
        "## Pending Review State",
        "",
        "| Check | Result |",
        "|---|---|",
    ]
    for key, value in report["pendingReviewState"].items():
        lines.append(f"| `{key}` | `{value}` |")
    lines.extend(["", "## Visual Comparison Ledger", ""])
    visual_state = report["visualComparisonState"]
    lines.append(f"- Surfaces present: `{visual_state['surfaceCount']}/{len(REQUIRED_SURFACES)}`")
    lines.append(f"- Active surfaces: `{len(visual_state['activeSurfaces'])}`")
    lines.append(f"- Deferred surfaces: `{', '.join(visual_state['deferredSurfaces'])}`")
    verdict_coverage = visual_state["verdictCoverage"]
    lines.append(f"- Active verdict `revision-required`: `{len(verdict_coverage['activeRevisionRequired'])}/{len(ACTIVE_VISUAL_SURFACES)}`")
    lines.append(f"- Active verdict `acceptable-delta`: `{len(verdict_coverage['activeAcceptableDelta'])}/{len(ACTIVE_VISUAL_SURFACES)}`")
    lines.append(f"- Active verdict `ready-for-owner-review`: `{len(verdict_coverage['activeReadyForOwnerReview'])}/{len(ACTIVE_VISUAL_SURFACES)}`")
    lines.append(f"- Deferred verdict `deferred`: `{len(verdict_coverage['deferredMarkedDeferred'])}/{len(DEFERRED_VISUAL_SURFACES)}`")
    lines.extend(["", "## Visual Delta Checklist", ""])
    visual_delta_state = report["visualDeltaChecklistState"]
    lines.append(f"- Surfaces present: `{visual_delta_state['surfaceCount']}/{len(REQUIRED_SURFACES)}`")
    anchor_coverage = visual_delta_state["anchorCoverage"]
    lines.append(f"- LobeHub live anchors present: `{len(anchor_coverage['lobehubLive'])}/{len(REQUIRED_SURFACES)}`")
    lines.append(f"- LobeHub source anchors present: `{len(anchor_coverage['lobehubSource'])}/{len(REQUIRED_SURFACES)}`")
    lines.append(f"- Peers prototype anchors present: `{len(anchor_coverage['peersPrototype'])}/{len(REQUIRED_SURFACES)}`")
    disposition_coverage = visual_delta_state["dispositionCoverage"]
    lines.append(f"- Active surfaces undecided: `{len(disposition_coverage['activeUndecided'])}/{len(ACTIVE_VISUAL_SURFACES)}`")
    lines.append(f"- Deferred surfaces marked deferred: `{len(disposition_coverage['deferredMarkedDeferred'])}/{len(DEFERRED_VISUAL_SURFACES)}`")
    lines.extend(["", "## Review Execution Evidence", ""])
    review_execution_state = report["reviewExecutionEvidenceState"]
    for doc_name, present in review_execution_state["present"].items():
        lines.append(f"- {doc_name}: `{len(present)}/{review_execution_state['requiredEvidenceCount']}`")
    lines.extend(["", "## Active Review Source Reachability", ""])
    source_state = report["activeReviewSourceReachabilityState"]
    lines.append(f"- Active review URLs reachable in source: `{source_state['reachableUrlCount']}/{source_state['requiredUrlCount']}`")
    lines.extend(["", "## Pre-Confirmation Handoff Evidence", ""])
    handoff_state = report["preConfirmationHandoffEvidenceState"]
    for doc_name, present in handoff_state["present"].items():
        lines.append(f"- {doc_name}: `{len(present)}/{handoff_state['requiredEvidenceCount']}`")
    lines.extend(["", "## Canonical Prototype Evidence", ""])
    canonical_state = report["canonicalPrototypeEvidenceState"]
    lines.append(f"- prototype-lobehub-parity README: `{len(canonical_state['present'])}/{canonical_state['requiredEvidenceCount']}`")
    lines.extend(["", "## Handoff Summary Freshness", ""])
    freshness_state = report["handoffSummaryFreshnessState"]
    lines.append(f"- Stale summary hits: `{len(freshness_state['staleHits'])}/{freshness_state['forbiddenSnippetCount']}`")
    lines.extend(["", "## Issues", ""])
    if not report["issue_breakdown"]:
        lines.append("- None.")
    else:
        for issue in report["issue_breakdown"]:
            lines.append(f"- `{issue['category']}` / `{issue['failedStep']}`: {issue['summary']}")
    lines.extend(["", "## Boundary", "", f"- {report['boundary']}"])
    return "\n".join(lines) + "\n"


def write_outputs(report: dict[str, Any], output_prefix: Path) -> tuple[Path, Path]:
    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = output_prefix.with_suffix(".json")
    md_path = output_prefix.with_suffix(".md")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--ledger", default=DEFAULT_LEDGER)
    parser.add_argument("--output-prefix")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    ledger_path = Path(args.ledger)
    report = build_report(repo_root, ledger_path)
    if args.output_prefix:
        json_path, md_path = write_outputs(
            report,
            Path(args.output_prefix),
        )
        json_output = str(json_path)
        markdown_output = str(md_path)
    else:
        json_output = str(Path(DEFAULT_OUTPUT_PREFIX).with_suffix(".json"))
        markdown_output = str(Path(DEFAULT_OUTPUT_PREFIX).with_suffix(".md"))
        with artifact_session(ARTIFACT_KIND) as session:
            session.write_json(json_output, report, role="report")
            session.write_bytes(
                markdown_output,
                render_markdown(report).encode("utf-8"),
                media_type="text/markdown",
                role="report-markdown",
            )
            session.complete(
                status=report["status"],
                completion_status=report["completionStatus"],
                proof_status=report["proofStatus"],
            )
    print(f"agent lobehub parity evidence-chain gate JSON: {json_output}")
    print(f"agent lobehub parity evidence-chain gate Markdown: {markdown_output}")
    print(f"status: {report['status']}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
