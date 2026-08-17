#!/usr/bin/env python3
"""Validate Agent LobeHub Owner-review preparation package."""

from __future__ import annotations

import argparse
import json
import re
import struct
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import artifact_session, explicit_output_path


ARTIFACT_KIND = "agent-lobehub-owner-review-readiness-gate"
PHASE = "PLAN-P2 Owner review preparation / PLAN-P5 blocked precondition"
BOM = ["BOM-012", "BOM-015"]
SPEC = ["SPEC-010", "SPEC-013", "SPEC-014"]
GATE = "Owner review package must be complete while prototype remains fail-closed and PLAN-P5 remains blocked"

DEFAULT_LEDGER = "tmp/agent-lobehub-fullstack-ledger.md"
DEFAULT_OUTPUT_PREFIX = "reports/agent-lobehub-owner-review-readiness-gate-latest"

REQUIRED_FILES = {
    "manifest": "packages/prototypes/desktop/features/agent-lobehub-parity/prototype.manifest.ts",
    "prototypeSource": "packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx",
    "prototypeRegistry": "docs/architecture/prototypes/README.md",
    "reviewEntry": "docs/architecture/agent/prototype/README.md",
    "ownerRunbook": "docs/architecture/agent/prototype/owner-review-runbook.md",
    "ownerChecklist": "docs/architecture/agent/prototype/owner-review-checklist.md",
    "gapAudit": "docs/architecture/agent/lobehub-parity/prototype-confirmation-gap-audit.md",
    "preImplementationReadiness": "docs/architecture/agent/lobehub-parity/pre-implementation-readiness.md",
    "planP5EntryGate": "docs/architecture/agent/lobehub-parity/plan-p5-entry-gate.md",
    "ownerDecisionSnapshot": "docs/architecture/agent/lobehub-parity/owner-decision-status-snapshot.md",
    "prototypeEvidence": "docs/architecture/agent/prototype-lobehub-parity/README.md",
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
    "ledger": DEFAULT_LEDGER,
}

REQUIRED_SCENARIOS = [f"OR-{index:03d}" for index in range(1, 13)]
REQUIRED_OUTCOMES = ["confirmed", "revision-required", "deferred"]
REQUIRED_REVIEW_INPUTS = [
    "docs/architecture/agent/prototype/README.md",
    "docs/architecture/agent/prototype/owner-review-runbook.md",
    "docs/architecture/agent/prototype/owner-review-checklist.md",
    "docs/architecture/agent/lobehub-parity/prototype-confirmation-gap-audit.md",
    "docs/architecture/agent/lobehub-parity/plan-p5-entry-gate.md",
    "docs/architecture/agent/lobehub-parity/prototype-owner-review-decision-packet.md",
    "tmp/agent-lobehub-fullstack-ledger.md",
]
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
REQUIRED_REVIEW_ENTRY_EVIDENCE = [
    "EVID-010-PROTOTYPE-REBUILD-N",
    "EVID-011-AA-pre",
    "EVID-011-AE-pre",
    "EVID-011-AF-pre",
    "EVID-011-AG-pre",
    "EVID-011-AH-pre",
    "EVID-011-AI-pre",
    "EVID-011-AJ-pre",
    "EVID-011-AK-pre",
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
    "EVID-011-DD-pre",
]
REQUIRED_HANDOFF_EVIDENCE = [
    "EVID-011-AF-pre",
    "EVID-011-AG-pre",
    "EVID-011-AJ-pre",
    "EVID-011-AK-pre",
    "EVID-011-AL-pre",
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
    "EVID-011-DB-pre",
    "EVID-011-DC-pre",
    "EVID-011-DD-pre",
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
    "gapAudit": [
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

ACTIVE_COMPACT_ARTIFACTS = {
    "Home": {
        "screenshot": "tmp/agent-lobehub-l2-screenshots/home-ci-compact-dashboard-scoped.png",
        "dom": "tmp/agent-lobehub-home-ci-dom.json",
        "compactFlag": "compactHome",
        "revisionDoc": "homeCiCompactRevision",
    },
    "Agent Chat": {
        "screenshot": "tmp/agent-lobehub-l2-screenshots/chat-da-compact-new-topic-scoped.png",
        "dom": "tmp/agent-lobehub-chat-da-dom.json",
        "compactFlag": "compactChat",
        "revisionDoc": "chatDaCompactRevision",
    },
    "Agent Profile": {
        "screenshot": "tmp/agent-lobehub-l2-screenshots/profile-dd-compact-builder-scoped.png",
        "dom": "tmp/agent-lobehub-profile-dd-dom.json",
        "compactFlag": "compactProfile",
        "revisionDoc": "profileDdCompactRevision",
    },
    "Tasks": {
        "screenshot": "tmp/agent-lobehub-l2-screenshots/tasks-cm-compact-tasks-scoped.png",
        "dom": "tmp/agent-lobehub-tasks-cm-dom.json",
        "compactFlag": "compactTasks",
        "revisionDoc": "tasksCompactRevision",
    },
    "Pages": {
        "screenshot": "tmp/agent-lobehub-l2-screenshots/pages-cn-compact-pages-scoped.png",
        "dom": "tmp/agent-lobehub-pages-cn-dom.json",
        "compactFlag": "compactPages",
        "revisionDoc": "pagesCompactRevision",
    },
    "Resources": {
        "screenshot": "tmp/agent-lobehub-l2-screenshots/resources-co-compact-explorer-scoped.png",
        "dom": "tmp/agent-lobehub-resources-co-dom.json",
        "compactFlag": "compactResources",
        "revisionDoc": "resourcesCompactRevision",
    },
    "Memory": {
        "screenshot": "tmp/agent-lobehub-l2-screenshots/memory-cp-compact-home-scoped.png",
        "dom": "tmp/agent-lobehub-memory-cp-dom.json",
        "compactFlag": "compactMemory",
        "revisionDoc": "memoryCompactRevision",
    },
    "Skills / Tools": {
        "screenshot": "tmp/agent-lobehub-l2-screenshots/skills-cq-compact-settings-scoped.png",
        "dom": "tmp/agent-lobehub-skills-cq-dom.json",
        "compactFlag": "compactSkills",
        "revisionDoc": "skillsCompactRevision",
    },
    "Settings": {
        "screenshot": "tmp/agent-lobehub-l2-screenshots/settings-cr-compact-provider-grid-scoped.png",
        "dom": "tmp/agent-lobehub-settings-cr-dom.json",
        "compactFlag": "compactSettings",
        "revisionDoc": "settingsCompactRevision",
    },
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


def load_required_files(repo_root: Path, issues: list[dict[str, Any]]) -> dict[str, str]:
    contents: dict[str, str] = {}
    for key, relative in REQUIRED_FILES.items():
        text = read_text(repo_root / relative)
        if text is None:
            add_issue(
                issues,
                category="missing-file",
                failed_step=f"read-{key}",
                summary=f"required Owner review file is missing: {relative}",
                path=relative,
                proof_impact="Owner review readiness cannot be proven unless every review input is readable.",
            )
            continue
        contents[key] = text
    return contents


def check_review_preparation_state(contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    registry_status = prototype_registry_status(contents.get("prototypeRegistry", ""))
    states = {
        "manifestPendingReview": bool(re.search(r"status:\s*['\"]pending-review['\"]", contents.get("manifest", ""))),
        "manifestDrafting": bool(re.search(r"status:\s*['\"]drafting['\"]", contents.get("manifest", ""))),
        "registryPendingReview": registry_status == "pending-review",
        "registryDrafting": registry_status == "drafting",
        "reviewEntryPendingReview": "**Status**: pending-review" in contents.get("reviewEntry", "")
        and "| Status | `pending-review` |" in contents.get("reviewEntry", ""),
        "reviewEntryDrafting": "**Status**: drafting" in contents.get("reviewEntry", "")
        and "| Status | `drafting` |" in contents.get("reviewEntry", ""),
        "ownerRevisionRequired": "OWNER_DECISION: revision-required" in contents.get("ledger", ""),
        "planP5Blocked": "blocked-before-owner-confirmation" in contents.get("planP5EntryGate", ""),
    }
    pending_review_safe = (
        states["manifestPendingReview"]
        and states["registryPendingReview"]
        and states["reviewEntryPendingReview"]
    )
    revision_safe = (
        states["ownerRevisionRequired"]
        and states["manifestDrafting"]
        and states["registryDrafting"]
        and states["reviewEntryDrafting"]
    )
    fail_closed_safe = (pending_review_safe or revision_safe) and states["planP5Blocked"]
    if not fail_closed_safe:
        add_issue(
            issues,
            category="review-preparation-state",
            failed_step="review-preparation-state-consistency",
            summary="Owner review preparation state is inconsistent",
            path=".",
            proof_impact="Owner review preparation requires a consistent pending-review state or revision-required drafting state, with PLAN-P5 still blocked.",
            evidence_details={
                "state": states,
                "pendingReviewSafe": pending_review_safe,
                "revisionSafe": revision_safe,
            },
        )
    states["pendingReviewSafe"] = pending_review_safe
    states["revisionSafe"] = revision_safe
    states["failClosedSafe"] = fail_closed_safe
    states["registryStatus"] = registry_status
    return states


def check_review_package(contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    runbook = contents.get("ownerRunbook", "")
    checklist = contents.get("ownerChecklist", "")
    review_entry = contents.get("reviewEntry", "")
    gap_audit = contents.get("gapAudit", "")
    plan_p5_entry_gate = contents.get("planP5EntryGate", "")
    owner_decision_snapshot = contents.get("ownerDecisionSnapshot", "")
    prototype_evidence = contents.get("prototypeEvidence", "")

    missing_scenarios = [scenario for scenario in REQUIRED_SCENARIOS if scenario not in runbook]
    if missing_scenarios:
        add_issue(
            issues,
            category="missing-owner-scenario",
            failed_step="or-scenario-matrix",
            summary="Owner review runbook is missing required OR scenarios",
            path=REQUIRED_FILES["ownerRunbook"],
            proof_impact="Owner review is not executable unless OR-001..OR-012 are all present.",
            evidence_details={"missingScenarios": missing_scenarios},
        )

    combined_decision_docs = "\n".join([runbook, checklist, review_entry])
    missing_outcomes = [outcome for outcome in REQUIRED_OUTCOMES if outcome not in combined_decision_docs]
    if missing_outcomes:
        add_issue(
            issues,
            category="missing-decision-outcome",
            failed_step="decision-outcomes",
            summary="Owner decision docs are missing required decision outcomes",
            path=REQUIRED_FILES["reviewEntry"],
            proof_impact="Owner review must be able to record confirmed, revision-required, or deferred.",
            evidence_details={"missingOutcomes": missing_outcomes},
        )

    combined_inputs = "\n".join([runbook, checklist, review_entry, gap_audit])
    missing_inputs = [input_path for input_path in REQUIRED_REVIEW_INPUTS if input_path not in combined_inputs]
    if missing_inputs:
        add_issue(
            issues,
            category="missing-review-input",
            failed_step="review-inputs",
            summary="Owner review package is missing required input references",
            path=REQUIRED_FILES["reviewEntry"],
            proof_impact="Owner review cannot be reproduced if required input documents are not listed.",
            evidence_details={"missingInputs": missing_inputs},
        )

    missing_surfaces = [surface for surface in REQUIRED_SURFACES if surface not in checklist and surface not in runbook]
    if missing_surfaces:
        add_issue(
            issues,
            category="missing-surface-review",
            failed_step="surface-checklist",
            summary="Owner review package is missing required surface checks",
            path=REQUIRED_FILES["ownerChecklist"],
            proof_impact="The prototype cannot be claimed ready for Owner review if a required LobeHub surface is absent.",
            evidence_details={"missingSurfaces": missing_surfaces},
        )

    visual_delta_shape = visual_delta_checklist_shape(checklist)
    if visual_delta_shape["duplicates"] or visual_delta_shape["unknownSurfaces"]:
        add_issue(
            issues,
            category="invalid-visual-delta-surface-shape",
            failed_step="visual-delta-checklist-surface-shape",
            summary="Owner checklist Visual Delta rows contain duplicate or unknown surfaces",
            path=REQUIRED_FILES["ownerChecklist"],
            proof_impact="Owner review cannot make a deterministic per-surface decision if the Visual Delta Checklist has duplicate or unknown surface rows.",
            evidence_details=visual_delta_shape,
        )

    visual_delta_rows = visual_delta_checklist_rows(checklist)
    missing_visual_delta_surfaces = [surface for surface in REQUIRED_SURFACES if surface not in visual_delta_rows]
    if missing_visual_delta_surfaces:
        add_issue(
            issues,
            category="missing-visual-delta-checklist",
            failed_step="visual-delta-checklist-surface-coverage",
            summary="Owner checklist is missing required Visual Delta Checklist surface rows",
            path=REQUIRED_FILES["ownerChecklist"],
            proof_impact="Owner review cannot make a high-fidelity decision unless every surface has an explicit side-by-side LobeHub vs Peers comparison row.",
            evidence_details={"missingSurfaces": missing_visual_delta_surfaces},
        )

    incomplete_visual_delta_rows: list[dict[str, str]] = []
    invalid_visual_delta_dispositions: list[dict[str, str]] = []
    for surface, row in visual_delta_rows.items():
        if "side-by-side" not in row["comparisonAction"].lower():
            incomplete_visual_delta_rows.append({"surface": surface, "field": "comparisonAction"})
        if "app.lobehub.com" not in row["lobehubReference"]:
            incomplete_visual_delta_rows.append({"surface": surface, "field": "lobehubLiveReference"})
        if "external/lobehub" not in row["lobehubReference"]:
            incomplete_visual_delta_rows.append({"surface": surface, "field": "lobehubReference"})
        if "agent-lobehub-parity" not in row["peersReference"] and "surface=" not in row["peersReference"]:
            incomplete_visual_delta_rows.append({"surface": surface, "field": "peersReference"})
        disposition = row["ownerDisposition"].strip("`").lower()
        expected_disposition = "deferred" if surface in DEFERRED_VISUAL_SURFACES else "undecided"
        if disposition not in ALLOWED_VISUAL_DELTA_DISPOSITIONS or disposition != expected_disposition:
            invalid_visual_delta_dispositions.append(
                {
                    "surface": surface,
                    "disposition": disposition,
                    "expected": expected_disposition,
                }
            )
    if incomplete_visual_delta_rows:
        add_issue(
            issues,
            category="incomplete-visual-delta-checklist",
            failed_step="visual-delta-checklist-required-fields",
            summary="Owner checklist Visual Delta rows are missing side-by-side/source/prototype review anchors",
            path=REQUIRED_FILES["ownerChecklist"],
            proof_impact="Visual review rows must force side-by-side inspection against LobeHub and the Peers prototype, not vague surface memory.",
            evidence_details={"fields": incomplete_visual_delta_rows},
        )
    if invalid_visual_delta_dispositions:
        add_issue(
            issues,
            category="invalid-visual-delta-disposition",
            failed_step="visual-delta-disposition-fail-closed",
            summary="Owner checklist Visual Delta rows have dispositions that are unsafe for pre-confirmation review",
            path=REQUIRED_FILES["ownerChecklist"],
            proof_impact="Before Owner confirmation, active surfaces must remain undecided and only Owner-deferred surfaces may be marked deferred.",
            evidence_details={"dispositions": invalid_visual_delta_dispositions},
        )

    missing_review_entry_evidence = [
        evidence_id for evidence_id in REQUIRED_REVIEW_ENTRY_EVIDENCE if evidence_id not in review_entry
    ]
    if missing_review_entry_evidence:
        add_issue(
            issues,
            category="missing-review-entry-evidence",
            failed_step="review-entry-evidence",
            summary="Owner review entry is missing required latest evidence IDs",
            path=REQUIRED_FILES["reviewEntry"],
            proof_impact="Owner review entry must point reviewers at the latest automation and readiness evidence.",
            evidence_details={"missingEvidence": missing_review_entry_evidence},
        )

    handoff_docs = {
        "planP5EntryGate": plan_p5_entry_gate,
        "ownerDecisionSnapshot": owner_decision_snapshot,
    }
    for doc_name, doc_text in handoff_docs.items():
        missing_handoff_evidence = [
            evidence_id for evidence_id in REQUIRED_HANDOFF_EVIDENCE if evidence_id not in doc_text
        ]
        if missing_handoff_evidence:
            add_issue(
                issues,
                category="missing-handoff-evidence",
                failed_step=f"{doc_name}-evidence",
                summary=f"{doc_name} is missing required handoff evidence IDs",
                path=REQUIRED_FILES[doc_name],
                proof_impact="Owner/P5 handoff docs must point at the latest automation evidence before review.",
                evidence_details={"missingEvidence": missing_handoff_evidence},
            )

    review_execution_docs = {
        "ownerRunbook": runbook,
        "ownerChecklist": checklist,
    }
    review_execution_urls: dict[str, list[str]] = {}
    for doc_name, doc_text in review_execution_docs.items():
        missing_execution_evidence = [
            evidence_id for evidence_id in REQUIRED_REVIEW_EXECUTION_EVIDENCE if evidence_id not in doc_text
        ]
        if missing_execution_evidence:
            add_issue(
                issues,
                category="missing-review-execution-evidence",
                failed_step=f"{doc_name}-scoped-artifact-evidence",
                summary=f"{doc_name} is missing active scoped artifact review evidence IDs",
                path=REQUIRED_FILES[doc_name],
                proof_impact="Owner execution docs must keep reviewers on the current scoped L2/L3 artifact baseline instead of stale wide or historical captures.",
                evidence_details={"missingEvidence": missing_execution_evidence},
            )
        urls = review_urls(doc_text)
        review_execution_urls[doc_name] = urls
        invalid_urls = [url for url in urls if url not in ALLOWED_REVIEW_URLS]
        if invalid_urls:
            add_issue(
                issues,
                category="invalid-review-execution-url",
                failed_step=f"{doc_name}-review-url-allowlist",
                summary=f"{doc_name} contains unknown or stale prototype review URLs",
                path=REQUIRED_FILES[doc_name],
                proof_impact="Owner execution docs must open known prototype review states; stale query params can make side-by-side review point at the wrong surface.",
                evidence_details={"invalidUrls": invalid_urls},
            )

    combined_review_execution_docs = "\n".join(review_execution_docs.values())
    missing_active_review_urls = [
        url for url in REQUIRED_ACTIVE_REVIEW_URLS if url not in combined_review_execution_docs
    ]
    if missing_active_review_urls:
        add_issue(
            issues,
            category="missing-active-review-url",
            failed_step="active-surface-review-url-coverage",
            summary="Owner execution docs are missing current active compact review URLs",
            path=REQUIRED_FILES["ownerRunbook"],
            proof_impact="Owner review cannot be deterministic unless every active surface has its current compact review URL available.",
            evidence_details={"missingUrls": missing_active_review_urls},
        )

    missing_canonical_prototype_evidence = [
        evidence_id for evidence_id in REQUIRED_CANONICAL_PROTOTYPE_EVIDENCE if evidence_id not in prototype_evidence
    ]
    if missing_canonical_prototype_evidence:
        add_issue(
            issues,
            category="missing-canonical-prototype-evidence",
            failed_step="canonical-prototype-evidence-sync",
            summary="canonical prototype evidence README is missing latest guard evidence IDs",
            path=REQUIRED_FILES["prototypeEvidence"],
            proof_impact="The canonical prototype evidence entry must stay synchronized with the latest review-package, artifact, URL, source-reachability and handoff-sync guards.",
            evidence_details={"missingEvidence": missing_canonical_prototype_evidence},
        )

    boundary_docs = "\n".join([runbook, checklist, review_entry, gap_audit, prototype_evidence])
    boundary_checks = {
        "doesNotConfirm": "does not confirm" in boundary_docs,
        "migrationBlocked": "product migration remains blocked" in boundary_docs.lower()
        or "Product migration remains blocked" in boundary_docs,
        "noGate008Claim": "not GATE-008" in boundary_docs or "does not satisfy GATE-008" in boundary_docs,
    }
    for key, ok in boundary_checks.items():
        if not ok:
            add_issue(
                issues,
                category="missing-claim-boundary",
                failed_step=key,
                summary=f"Owner review package is missing claim boundary: {key}",
                path=REQUIRED_FILES["reviewEntry"],
                proof_impact="Review docs must clearly state that review preparation is not confirmation or product parity.",
                evidence_details={"boundaryChecks": boundary_checks},
            )

    return {
        "scenariosPresent": [scenario for scenario in REQUIRED_SCENARIOS if scenario in runbook],
        "outcomesPresent": [outcome for outcome in REQUIRED_OUTCOMES if outcome in combined_decision_docs],
        "reviewInputsPresent": [input_path for input_path in REQUIRED_REVIEW_INPUTS if input_path in combined_inputs],
        "surfacesPresent": [
            surface for surface in REQUIRED_SURFACES if surface in checklist or surface in runbook
        ],
        "visualDeltaSurfacesPresent": [
            surface for surface in REQUIRED_SURFACES if surface in visual_delta_rows
        ],
        "visualDeltaSurfaceShape": visual_delta_shape,
        "visualDeltaDispositions": {
            surface: row["ownerDisposition"].strip("`").lower()
            for surface, row in visual_delta_rows.items()
        },
        "visualDeltaAnchorCoverage": visual_delta_anchor_coverage(visual_delta_rows),
        "visualDeltaDispositionCoverage": visual_delta_disposition_coverage(visual_delta_rows),
        "reviewEntryEvidencePresent": [
            evidence_id for evidence_id in REQUIRED_REVIEW_ENTRY_EVIDENCE if evidence_id in review_entry
        ],
        "handoffEvidencePresent": {
            doc_name: [evidence_id for evidence_id in REQUIRED_HANDOFF_EVIDENCE if evidence_id in doc_text]
            for doc_name, doc_text in handoff_docs.items()
        },
        "reviewExecutionEvidencePresent": {
            doc_name: [evidence_id for evidence_id in REQUIRED_REVIEW_EXECUTION_EVIDENCE if evidence_id in doc_text]
            for doc_name, doc_text in review_execution_docs.items()
        },
        "reviewExecutionUrls": {
            "requiredActiveUrlsPresent": [
                url for url in REQUIRED_ACTIVE_REVIEW_URLS if url in combined_review_execution_docs
            ],
            "urlsByDoc": review_execution_urls,
        },
        "canonicalPrototypeEvidencePresent": [
            evidence_id for evidence_id in REQUIRED_CANONICAL_PROTOTYPE_EVIDENCE if evidence_id in prototype_evidence
        ],
        "boundaryChecks": boundary_checks,
    }


def check_visual_comparison_ledger(contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    ledger = contents.get("visualComparisonLedger", "")
    rows = visual_surface_rows(ledger)
    shape = visual_surface_shape(ledger)
    if shape["duplicates"] or shape["unknownSurfaces"]:
        add_issue(
            issues,
            category="invalid-visual-comparison-surface-shape",
            failed_step="visual-comparison-surface-shape",
            summary="visual comparison ledger contains duplicate or unknown surfaces",
            path=REQUIRED_FILES["visualComparisonLedger"],
            proof_impact="Owner review cannot rely on deterministic L1/L2/L3 surface evidence if the visual comparison ledger has duplicate or unknown surface rows.",
            evidence_details=shape,
        )

    missing_surfaces = [surface for surface in REQUIRED_SURFACES if surface not in rows]
    if missing_surfaces:
        add_issue(
            issues,
            category="missing-visual-surface",
            failed_step="visual-comparison-surface-coverage",
            summary="visual comparison ledger is missing required surfaces",
            path=REQUIRED_FILES["visualComparisonLedger"],
            proof_impact="Owner review cannot rely on surface-by-surface parity evidence unless every required surface has a ledger row.",
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
            path=REQUIRED_FILES["visualComparisonLedger"],
            proof_impact="Every surface row must preserve source-backed L1, live/prototype L2/L3 references and explicit deltas before Owner review.",
            evidence_details={"fields": incomplete_fields},
        )
    if invalid_verdicts:
        add_issue(
            issues,
            category="invalid-visual-verdict",
            failed_step="visual-comparison-verdicts",
            summary="visual comparison ledger has invalid verdicts for the current review scope",
            path=REQUIRED_FILES["visualComparisonLedger"],
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
            proof_impact="Owner review readiness cannot rely on compact baseline evidence unless every active surface has a readable screenshot, parseable DOM JSON, compact marker and empty forbiddenHits.",
            evidence_details={"invalidArtifacts": invalid},
        )

    return {
        "requiredSurfaceCount": len(ACTIVE_COMPACT_ARTIFACTS),
        "invalidArtifacts": invalid,
        "surfaces": results,
    }


def check_active_review_source_reachability(contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
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
            path=REQUIRED_FILES["prototypeSource"],
            proof_impact="Owner review URLs must map to an implemented surface branch, handled state token, and compact DOM marker before reviewers can rely on them.",
            evidence_details={"invalidUrls": invalid},
        )

    return {
        "requiredUrlCount": len(ACTIVE_REVIEW_SOURCE_REQUIREMENTS),
        "reachableUrlCount": len(ACTIVE_REVIEW_SOURCE_REQUIREMENTS) - len(invalid),
        "invalidUrls": invalid,
        "urls": results,
    }


def check_pre_confirmation_handoff_evidence(contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    docs = {
        "gapAudit": contents.get("gapAudit", ""),
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
                path=REQUIRED_FILES[doc_name],
                proof_impact="Pre-confirmation handoff docs must point at the latest review-package, artifact, URL and source-reachability evidence before Owner/P5 decisions can rely on them.",
                evidence_details={"missingEvidence": missing},
            )

    return {
        "requiredEvidenceCount": len(REQUIRED_PRE_CONFIRMATION_HANDOFF_EVIDENCE),
        "present": present,
    }


def check_handoff_summary_freshness(contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    stale_hits: list[dict[str, str]] = []
    for doc_name, snippets in FORBIDDEN_STALE_HANDOFF_SNIPPETS.items():
        doc_text = contents.get(doc_name, "")
        for snippet in snippets:
            if snippet in doc_text:
                stale_hits.append(
                    {
                        "doc": doc_name,
                        "path": REQUIRED_FILES[doc_name],
                        "snippet": snippet,
                    }
                )

    if stale_hits:
        add_issue(
            issues,
            category="stale-handoff-summary",
            failed_step="owner-p5-handoff-summary-freshness",
            summary="Owner/P5 handoff docs contain stale summary text from an older evidence chain",
            path=str([hit["path"] for hit in stale_hits]),
            proof_impact="Handoff docs must not summarize readiness as only proven through older CT/CW evidence when later CU/CV/CW/CX/CY guards exist.",
            evidence_details={"staleHits": stale_hits},
        )

    return {
        "forbiddenSnippetCount": sum(len(snippets) for snippets in FORBIDDEN_STALE_HANDOFF_SNIPPETS.values()),
        "staleHits": stale_hits,
    }


def check_no_owner_or_product_evidence(contents: dict[str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    ledger = contents.get("ledger", "")
    owner_rows = [
        line
        for line in ledger.splitlines()
        if re.match(r"^\|\s*EVID-011-Z-owner\s*\|", line)
    ]
    owner_confirmed = any("OWNER_DECISION: confirmed" in row or "OWNER_CONFIRMED" in row for row in owner_rows)
    product_evidence = bool(re.search(r"^\|\s*EVID-012(?:-working)?\s*\|", ledger, re.MULTILINE))
    if owner_confirmed:
        add_issue(
            issues,
            category="unexpected-owner-confirmation",
            failed_step="owner-confirmation-scan",
            summary="Owner confirmation already exists while readiness gate expects pre-confirmation review preparation",
            path=REQUIRED_FILES["ledger"],
            proof_impact="This gate validates pre-confirmation readiness only; confirmed state must use the PLAN-P5 entry gate.",
        )
    if product_evidence:
        add_issue(
            issues,
            category="unexpected-product-evidence",
            failed_step="evid-012-scan",
            summary="EVID-012 product evidence exists before Owner-review readiness completion",
            path=REQUIRED_FILES["ledger"],
            proof_impact="Product evidence must not exist before Owner confirmation and EVID-012 authorization.",
        )
    return {
        "ownerRows": [row.split("|")[1].strip() for row in owner_rows],
        "ownerConfirmed": owner_confirmed,
        "productEvidencePresent": product_evidence,
    }


def build_report(repo_root: Path) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    contents = load_required_files(repo_root, issues)
    pending_state = check_review_preparation_state(contents, issues)
    package_state = check_review_package(contents, issues)
    visual_state = check_visual_comparison_ledger(contents, issues)
    compact_artifact_state = check_active_compact_artifacts(repo_root, contents, issues)
    source_reachability_state = check_active_review_source_reachability(contents, issues)
    pre_confirmation_handoff_state = check_pre_confirmation_handoff_evidence(contents, issues)
    handoff_summary_freshness_state = check_handoff_summary_freshness(contents, issues)
    authorization_state = check_no_owner_or_product_evidence(contents, issues)
    status = "pass" if not issues else "fail"
    readiness_claim = {
        "scope": "owner-review-preparation-only",
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
        "pendingReviewState": pending_state,
        "reviewPackageState": package_state,
        "visualComparisonState": visual_state,
        "activeCompactArtifactState": compact_artifact_state,
        "activeReviewSourceReachabilityState": source_reachability_state,
        "preConfirmationHandoffEvidenceState": pre_confirmation_handoff_state,
        "handoffSummaryFreshnessState": handoff_summary_freshness_state,
        "authorizationState": authorization_state,
        "issue_breakdown": issues,
        "issueBreakdown": issues,
        "boundary": "This gate proves Owner review preparation package consistency only. It does not confirm the prototype, create EVID-012, edit product code, or prove GATE-008.",
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Agent LobeHub Owner Review Preparation Gate",
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
        "",
        "## Review Preparation State",
        "",
        "| Check | Result |",
        "|---|---|",
    ]
    for key, value in report["pendingReviewState"].items():
        lines.append(f"| `{key}` | `{value}` |")
    lines.extend(["", "## Review Package", ""])
    lines.append(f"- OR scenarios present: `{len(report['reviewPackageState']['scenariosPresent'])}/12`")
    lines.append(f"- Decision outcomes present: `{', '.join(report['reviewPackageState']['outcomesPresent'])}`")
    lines.append(f"- Review inputs present: `{len(report['reviewPackageState']['reviewInputsPresent'])}/{len(REQUIRED_REVIEW_INPUTS)}`")
    lines.append(f"- Surfaces present: `{len(report['reviewPackageState']['surfacesPresent'])}/{len(REQUIRED_SURFACES)}`")
    lines.append(
        f"- Visual delta checklist surfaces present: `{len(report['reviewPackageState']['visualDeltaSurfacesPresent'])}/{len(REQUIRED_SURFACES)}`"
    )
    anchor_coverage = report["reviewPackageState"]["visualDeltaAnchorCoverage"]
    lines.append(f"- Visual delta LobeHub live anchors present: `{len(anchor_coverage['lobehubLive'])}/{len(REQUIRED_SURFACES)}`")
    lines.append(f"- Visual delta LobeHub source anchors present: `{len(anchor_coverage['lobehubSource'])}/{len(REQUIRED_SURFACES)}`")
    lines.append(f"- Visual delta Peers prototype anchors present: `{len(anchor_coverage['peersPrototype'])}/{len(REQUIRED_SURFACES)}`")
    disposition_coverage = report["reviewPackageState"]["visualDeltaDispositionCoverage"]
    lines.append(f"- Visual delta active surfaces undecided: `{len(disposition_coverage['activeUndecided'])}/{len(ACTIVE_VISUAL_SURFACES)}`")
    lines.append(f"- Visual delta deferred surfaces marked deferred: `{len(disposition_coverage['deferredMarkedDeferred'])}/{len(DEFERRED_VISUAL_SURFACES)}`")
    lines.append(
        f"- Review entry evidence present: `{len(report['reviewPackageState']['reviewEntryEvidencePresent'])}/{len(REQUIRED_REVIEW_ENTRY_EVIDENCE)}`"
    )
    for doc_name, present in report["reviewPackageState"]["handoffEvidencePresent"].items():
        lines.append(f"- {doc_name} evidence present: `{len(present)}/{len(REQUIRED_HANDOFF_EVIDENCE)}`")
    for doc_name, present in report["reviewPackageState"]["reviewExecutionEvidencePresent"].items():
        lines.append(f"- {doc_name} scoped execution evidence present: `{len(present)}/{len(REQUIRED_REVIEW_EXECUTION_EVIDENCE)}`")
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
    lines.extend(["", "## Active Review Source Reachability", ""])
    source_state = report["activeReviewSourceReachabilityState"]
    lines.append(f"- Active review URLs reachable in source: `{source_state['reachableUrlCount']}/{source_state['requiredUrlCount']}`")
    lines.extend(["", "## Pre-Confirmation Handoff Evidence", ""])
    handoff_state = report["preConfirmationHandoffEvidenceState"]
    for doc_name, present in handoff_state["present"].items():
        lines.append(f"- {doc_name}: `{len(present)}/{handoff_state['requiredEvidenceCount']}`")
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
    output_prefix = explicit_output_path(output_prefix)
    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = output_prefix.with_suffix(".json")
    md_path = output_prefix.with_suffix(".md")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--output-prefix")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    report = build_report(repo_root)
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
    print(f"agent lobehub owner-review readiness gate JSON: {json_output}")
    print(f"agent lobehub owner-review readiness gate Markdown: {markdown_output}")
    print(f"status: {report['status']}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
