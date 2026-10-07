#!/usr/bin/env python3
"""Complete foreground iOS Mobile surface inventory proof."""

from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
import zlib
from collections.abc import Mapping
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    ArtifactSession,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    load_runtime_manifest,
    source_identity,
)
from tooling.acceptance.core.redaction import redact_text
from tooling.acceptance.gates.mobile.simulator_e2e import (
    SimulatorGateBlocked,
    _validate_source_identity,
)
from tooling.acceptance.gates.mobile.surface_audit import (
    audit_accessibility_tree,
)


GATE_ID = "mobile-simulator-whole-product-usability-e2e"
ENVIRONMENT_ID = "mobile-direct-simulator"
EVIDENCE_ROLE = "mobile-surface-evidence"
VISUAL_REVIEW_GATE_ID = "mobile-whole-product-visual-review"
VISUAL_REVIEW_ROLE = "mobile-whole-product-visual-review"
CONTRACT_ID = "mobile-whole-product-surface-inventory-v1"
INVENTORY_PATH = (
    REPO_ROOT
    / "tooling"
    / "acceptance"
    / "gates"
    / "mobile"
    / "whole_product_surface_inventory.json"
)
ARTIFACT_REF_FIELDS = {
    "artifactKind",
    "workspaceId",
    "gateId",
    "runId",
    "path",
    "sha256",
    "mediaType",
}


def load_surface_inventory(path: Path = INVENTORY_PATH) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise GateError("Mobile surface inventory is unreadable") from error
    if (
        not isinstance(value, dict)
        or value.get("schemaVersion") != 1
        or value.get("contractId") != CONTRACT_ID
        or not isinstance(value.get("surfaceSets"), dict)
        or not isinstance(value.get("functionalGates"), dict)
    ):
        raise GateError("Mobile surface inventory contract is invalid")
    return value


def selected_surface_entries(
    inventory: Mapping[str, Any],
    surface_set: str,
) -> tuple[dict[str, Any], ...]:
    sets = inventory.get("surfaceSets")
    if not isinstance(sets, dict):
        raise GateError("Mobile surface inventory has no surface sets")
    if surface_set == "all":
        raw_entries = [
            entry
            for entries in sets.values()
            if isinstance(entries, list)
            for entry in entries
        ]
    else:
        raw_entries = sets.get(surface_set)
        if not isinstance(raw_entries, list) or not raw_entries:
            raise GateError(f"Mobile surface set is unknown: {surface_set}")
    entries: list[dict[str, Any]] = []
    templates = inventory.get("expectedResultTemplates")
    cells = inventory.get("viewportTextSizeCells")
    if not isinstance(templates, dict) or not isinstance(cells, list) or not cells:
        raise GateError("Mobile surface expectation policy is incomplete")
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, dict):
            raise GateError("Mobile surface inventory entry must be an object")
        entry = dict(raw_entry)
        required = ("id", "kind", "routeOrState", "surfaceSelector", "entryAction")
        if any(
            not isinstance(entry.get(field), str) or not entry[field]
            for field in required
        ):
            raise GateError("Mobile surface inventory entry is incomplete")
        if not isinstance(templates.get(entry["kind"]), str):
            raise GateError(
                f"Mobile surface expected result is missing for {entry['id']}"
            )
        entries.append(entry)
    if len({entry["id"] for entry in entries}) != len(entries):
        raise GateError("Mobile surface inventory contains duplicate IDs")
    return tuple(entries)


def expected_result(
    inventory: Mapping[str, Any],
    entry: Mapping[str, Any],
) -> str:
    templates = inventory["expectedResultTemplates"]
    return str(templates[entry["kind"]]).format(
        surfaceId=entry["id"],
        routeOrState=entry["routeOrState"],
    )


def audit_visible_text(
    inventory: Mapping[str, Any],
    texts: list[str],
) -> list[dict[str, str]]:
    quality = inventory.get("qualityRules")
    patterns = (
        quality.get("forbiddenVisibleTextPatterns")
        if isinstance(quality, dict)
        else None
    )
    if not isinstance(patterns, list):
        raise GateError("Mobile surface text rules are invalid")
    compiled = [re.compile(pattern) for pattern in patterns]
    findings: list[dict[str, str]] = []
    for text in texts:
        normalized = text.strip()
        if not normalized:
            continue
        for pattern in compiled:
            if pattern.search(normalized):
                findings.append(
                    {"text": normalized[:160], "pattern": pattern.pattern}
                )
                break
    return findings


class _SurfaceHTMLAudit(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.attributes: list[dict[str, str]] = []
        self.texts: list[str] = []
        self.heading_count = 0
        self.action_count = 0

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        attributes = {
            name: value or ""
            for name, value in attrs
        }
        self.attributes.append(attributes)
        if tag in {"h1", "h2", "h3"} or attributes.get("role") == "heading":
            self.heading_count += 1
        if (
            tag in {"button", "a", "input", "textarea", "select"}
            or attributes.get("role") == "button"
        ):
            self.action_count += 1

    def handle_data(self, data: str) -> None:
        value = data.strip()
        if value:
            self.texts.append(value)


def _read_json_artifact(path: Path, *, role: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise GateError(f"Mobile {role} artifact is invalid JSON") from error
    if not isinstance(value, dict):
        raise GateError(f"Mobile {role} artifact must be an object")
    return value


def _validate_png(path: Path, *, orientation: str) -> None:
    try:
        payload = path.read_bytes()
    except OSError as error:
        raise GateError("Mobile screenshot artifact is unreadable") from error
    if len(payload) < 45 or payload[:8] != b"\x89PNG\r\n\x1a\n":
        raise GateError("Mobile screenshot artifact is not a PNG")
    offset = 8
    width = 0
    height = 0
    saw_idat = False
    saw_iend = False
    while offset < len(payload):
        if offset + 12 > len(payload):
            raise GateError("Mobile screenshot PNG is truncated")
        length = struct.unpack(">I", payload[offset : offset + 4])[0]
        chunk_type = payload[offset + 4 : offset + 8]
        data_start = offset + 8
        data_end = data_start + length
        crc_end = data_end + 4
        if crc_end > len(payload):
            raise GateError("Mobile screenshot PNG chunk is truncated")
        expected_crc = struct.unpack(">I", payload[data_end:crc_end])[0]
        actual_crc = zlib.crc32(chunk_type + payload[data_start:data_end])
        if expected_crc != actual_crc:
            raise GateError("Mobile screenshot PNG checksum is invalid")
        if chunk_type == b"IHDR":
            if length != 13 or width or height:
                raise GateError("Mobile screenshot PNG header is invalid")
            width, height = struct.unpack(">II", payload[data_start : data_start + 8])
        elif chunk_type == b"IDAT":
            saw_idat = True
        elif chunk_type == b"IEND":
            if length != 0:
                raise GateError("Mobile screenshot PNG terminator is invalid")
            saw_iend = True
            offset = crc_end
            break
        offset = crc_end
    if not saw_idat or not saw_iend or offset != len(payload):
        raise GateError("Mobile screenshot PNG structure is incomplete")
    if width <= 0 or height <= 0:
        raise GateError("Mobile screenshot dimensions are invalid")
    if orientation == "portrait" and width >= height:
        raise GateError("Mobile portrait screenshot has invalid geometry")
    if orientation == "landscape" and width <= height:
        raise GateError("Mobile landscape screenshot has invalid geometry")


def _selector_attribute(selector: str) -> tuple[str, str]:
    match = re.fullmatch(r'\[([a-zA-Z0-9_-]+)="([^"]+)"\]', selector)
    if not match:
        raise GateError(f"Mobile surface selector is unsupported: {selector}")
    return match.group(1), match.group(2)


def _validate_dom_artifact(
    path: Path,
    *,
    inventory: Mapping[str, Any],
    entry: Mapping[str, Any],
) -> None:
    try:
        payload = path.read_text(encoding="utf-8")
    except OSError as error:
        raise GateError("Mobile DOM artifact is unreadable") from error
    if not payload.strip():
        raise GateError("Mobile DOM artifact is empty")
    parser = _SurfaceHTMLAudit()
    parser.feed(payload)
    attribute, expected_value = _selector_attribute(str(entry["surfaceSelector"]))
    if not any(attrs.get(attribute) == expected_value for attrs in parser.attributes):
        raise GateError(f"Mobile DOM is missing surface selector {entry['id']}")
    text_findings = audit_visible_text(inventory, parser.texts)
    if text_findings:
        raise GateError(
            f"Mobile DOM contains technical visible text: {text_findings[:5]!r}"
        )
    if parser.heading_count == 0:
        raise GateError(f"Mobile DOM has no primary heading for {entry['id']}")
    if parser.action_count == 0:
        raise GateError(f"Mobile DOM has no usable action for {entry['id']}")


def _validate_interaction_artifact(
    path: Path,
    *,
    inventory: Mapping[str, Any],
    entry: Mapping[str, Any],
    cell_id: str,
    viewport: Mapping[str, Any],
    run_id: str,
) -> None:
    value = _read_json_artifact(path, role="interaction")
    required = {
        "artifactKind",
        "gateId",
        "runId",
        "surfaceId",
        "cellId",
        "entryAction",
        "surfaceSelector",
        "expectedResult",
        "viewport",
        "surfaceElement",
        "uiAction",
        "controls",
        "occlusions",
        "blockingSurfaces",
    }
    if set(value) != required:
        raise GateError("Mobile interaction artifact has an invalid shape")
    if (
        value.get("artifactKind") != "mobile-surface-interaction-trace"
        or value.get("gateId") != GATE_ID
        or value.get("runId") != run_id
        or value.get("surfaceId") != entry["id"]
        or value.get("cellId") != cell_id
        or value.get("entryAction") != entry["entryAction"]
        or value.get("surfaceSelector") != entry["surfaceSelector"]
        or value.get("expectedResult") != expected_result(inventory, entry)
        or value.get("viewport") != viewport
    ):
        raise GateError("Mobile interaction artifact identity is invalid")
    surface_element = value.get("surfaceElement")
    if (
        not isinstance(surface_element, dict)
        or set(surface_element)
        != {"selector", "width", "height", "visible", "inViewport"}
        or surface_element.get("selector") != entry["surfaceSelector"]
        or not isinstance(surface_element.get("width"), (int, float))
        or surface_element["width"] <= 0
        or not isinstance(surface_element.get("height"), (int, float))
        or surface_element["height"] <= 0
        or surface_element.get("visible") is not True
        or surface_element.get("inViewport") is not True
    ):
        raise GateError("Mobile interaction artifact surface is not visible")
    action = value.get("uiAction")
    if (
        not isinstance(action, dict)
        or set(action) != {"kind", "target", "performed"}
        or action.get("kind") not in {"native-touch", "native-text", "system"}
        or not isinstance(action.get("target"), str)
        or not action["target"]
        or action.get("performed") is not True
    ):
        raise GateError("Mobile interaction artifact has no real UI action")
    controls = value.get("controls")
    minimum = inventory["qualityRules"]["minimumTouchTargetCssPx"]
    if not isinstance(controls, list) or not controls:
        raise GateError("Mobile interaction artifact has no controls")
    for control in controls:
        if (
            not isinstance(control, dict)
            or set(control) != {"label", "width", "height", "visible", "inViewport"}
            or not isinstance(control.get("label"), str)
            or not control["label"]
            or not isinstance(control.get("width"), (int, float))
            or not isinstance(control.get("height"), (int, float))
            or control.get("visible") is not True
            or control.get("inViewport") is not True
            or control["width"] < minimum
            or control["height"] < minimum
        ):
            raise GateError("Mobile interaction artifact has an unusable control")
    if value.get("occlusions") != []:
        raise GateError("Mobile interaction artifact reports occluded content")
    if value.get("blockingSurfaces") != []:
        raise GateError("Mobile interaction artifact reports a blocking surface")


def _validate_artifact_ref(
    value: Any,
    *,
    evidence_store: EvidenceStore,
    gate_id: str,
    run_id: str,
    workspace_id: str,
) -> ArtifactRef:
    if not isinstance(value, dict) or set(value) != ARTIFACT_REF_FIELDS:
        raise GateError("Mobile surface evidence has an invalid ArtifactRef")
    if (
        value.get("artifactKind") != "acceptance-artifact-ref"
        or value.get("gateId") != gate_id
        or value.get("runId") != run_id
        or value.get("workspaceId") != workspace_id
        or not isinstance(value.get("path"), str)
        or not value["path"]
        or not re.fullmatch(r"[0-9a-f]{64}", str(value.get("sha256", "")))
        or not isinstance(value.get("mediaType"), str)
        or not value["mediaType"]
    ):
        raise GateError("Mobile surface ArtifactRef identity is invalid")
    reference = ArtifactRef.from_dict(value)
    evidence_store.resolve(reference)
    return reference


def _validate_visual_review(
    *,
    evidence_store: EvidenceStore,
    workspace_id: str,
    current_source: Mapping[str, str],
    surface_set: str,
    surface_evidence_ref: ArtifactRef,
    expected_surface_cells: list[str],
    expected_screenshot_refs: list[dict[str, Any]],
) -> None:
    manifest = evidence_store.latest(VISUAL_REVIEW_GATE_ID)
    artifacts = manifest.get("artifacts")
    result = manifest.get("result")
    review_run_id = manifest.get("runId")
    if (
        not isinstance(review_run_id, str)
        or not review_run_id
        or manifest.get("source") != current_source
        or not isinstance(artifacts, dict)
        or not isinstance(result, dict)
        or result.get("status") != "PASS"
        or result.get("completionStatus") != "DONE"
        or result.get("proofStatus") != "PROVEN"
    ):
        raise GateError("Mobile visual review run manifest is invalid")
    reference = _validate_artifact_ref(
        artifacts.get(VISUAL_REVIEW_ROLE),
        evidence_store=evidence_store,
        gate_id=VISUAL_REVIEW_GATE_ID,
        run_id=review_run_id,
        workspace_id=workspace_id,
    )
    review = _read_json_artifact(
        evidence_store.resolve(reference),
        role="visual review",
    )
    if (
        set(review)
        != {
            "artifactKind",
            "gateId",
            "surfaceEvidence",
            "surfaceSet",
            "source",
            "reviewer",
            "verdict",
            "findings",
            "reviewedSurfaceCells",
            "screenshotArtifactRefs",
        }
        or review.get("artifactKind") != "mobile-whole-product-visual-review"
        or review.get("gateId") != VISUAL_REVIEW_GATE_ID
        or review.get("surfaceEvidence") != surface_evidence_ref.to_dict()
        or review.get("surfaceSet") != surface_set
        or review.get("source") != current_source
        or review.get("verdict") != "PASS"
        or review.get("findings") != []
        or sorted(review.get("reviewedSurfaceCells", []))
        != sorted(expected_surface_cells)
        or sorted(
            review.get("screenshotArtifactRefs", []),
            key=lambda item: item.get("path", "") if isinstance(item, dict) else "",
        )
        != sorted(
            expected_screenshot_refs,
            key=lambda item: item["path"],
        )
    ):
        raise GateError("Mobile visual review verdict is invalid")
    reviewer = review.get("reviewer")
    if (
        not isinstance(reviewer, dict)
        or set(reviewer) != {"kind", "id"}
        or reviewer.get("kind") != "agent"
        or not isinstance(reviewer.get("id"), str)
        or not reviewer["id"]
    ):
        raise GateError("Mobile visual review owner is invalid")


def validate_surface_evidence(
    inventory: Mapping[str, Any],
    surface_set: str,
    value: Any,
    *,
    evidence_store: EvidenceStore | None = None,
    expected_source: Mapping[str, str] | None = None,
    require_manifest: bool = True,
    require_visual_review: bool = True,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise GateError("Mobile surface evidence must be an object")
    store = evidence_store or EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    current_source = dict(expected_source or source_identity(REPO_ROOT))
    required_top_level = {
        "artifactKind",
        "gateId",
        "contractId",
        "surfaceSet",
        "runId",
        "workspaceId",
        "status",
        "completionStatus",
        "proofStatus",
        "source",
        "foregroundEvidence",
        "surfaceEvidence",
        "findings",
    }
    if set(value) != required_top_level:
        raise GateError("Mobile surface evidence has an invalid top-level shape")
    if (
        value.get("artifactKind") != "mobile-whole-product-surface-evidence"
        or value.get("gateId") != GATE_ID
        or value.get("contractId") != CONTRACT_ID
        or value.get("surfaceSet") != surface_set
        or value.get("status") != "PASS"
        or value.get("completionStatus") != "DONE"
        or value.get("proofStatus") != "PROVEN"
    ):
        raise GateError("Mobile surface evidence identity is invalid")
    run_id = value.get("runId")
    if not isinstance(run_id, str) or not run_id:
        raise GateError("Mobile surface evidence run identity is missing")
    workspace_id = value.get("workspaceId")
    if not isinstance(workspace_id, str) or not re.fullmatch(
        r"[0-9a-f]{16}", workspace_id
    ):
        raise GateError("Mobile surface evidence workspace identity is invalid")
    source = value.get("source")
    if (
        not isinstance(source, dict)
        or set(source) != {"commit", "workspaceDigest", "canonicalWorktreeHash"}
        or not all(isinstance(source.get(field), str) and source[field] for field in source)
    ):
        raise GateError("Mobile surface evidence source identity is invalid")
    if source != current_source:
        raise GateError("Mobile surface evidence source is stale")
    foreground = value.get("foregroundEvidence")
    if (
        not isinstance(foreground, dict)
        or set(foreground)
        != {
            "platform",
            "simulatorApplication",
            "frontmost",
            "windowVisible",
            "observation",
        }
        or foreground.get("platform") != "ios"
        or foreground.get("simulatorApplication") != "com.apple.iphonesimulator"
        or foreground.get("frontmost") is not True
        or foreground.get("windowVisible") is not True
    ):
        raise GateError("Mobile surface evidence is not foreground iOS proof")
    foreground_reference = _validate_artifact_ref(
        foreground["observation"],
        evidence_store=store,
        gate_id=GATE_ID,
        run_id=run_id,
        workspace_id=workspace_id,
    )
    foreground_observation = _read_json_artifact(
        store.resolve(foreground_reference),
        role="foreground observation",
    )
    if (
        set(foreground_observation)
        != {
            "artifactKind",
            "gateId",
            "runId",
            "platform",
            "bundleIdentifier",
            "frontmost",
            "windowVisible",
        }
        or foreground_observation.get("artifactKind")
        != "mobile-simulator-foreground-observation"
        or foreground_observation.get("gateId") != GATE_ID
        or foreground_observation.get("runId") != run_id
        or foreground_observation.get("platform") != "ios"
        or foreground_observation.get("bundleIdentifier")
        != "com.apple.iphonesimulator"
        or foreground_observation.get("frontmost") is not True
        or foreground_observation.get("windowVisible") is not True
    ):
        raise GateError("Mobile foreground observation content is invalid")
    evidence = value.get("surfaceEvidence")
    if not isinstance(evidence, dict):
        raise GateError("Mobile surface evidence map is missing")
    required_roles = inventory.get("evidenceRequired")
    required_cells = inventory.get("viewportTextSizeCells")
    if (
        not isinstance(required_roles, list)
        or len(required_roles) != len(set(required_roles))
        or not isinstance(required_cells, list)
        or len(required_cells) != len(set(required_cells))
    ):
        raise GateError("Mobile surface evidence requirements are invalid")
    entries = selected_surface_entries(inventory, surface_set)
    expected_surface_ids = {entry["id"] for entry in entries}
    if set(evidence) != expected_surface_ids:
        raise GateError("Mobile surface evidence map does not match its surface set")
    missing: list[str] = []
    seen_paths = {foreground_reference.path}
    screenshot_refs: list[dict[str, Any]] = []
    for entry in entries:
        observed = evidence.get(entry["id"])
        if (
            not isinstance(observed, dict)
            or set(observed)
            != {
                "status",
                "routeOrState",
                "entryAction",
                "surfaceSelector",
                "expectedResult",
                "cells",
            }
            or observed.get("status") != "PASS"
        ):
            missing.append(entry["id"])
            continue
        if (
            observed.get("routeOrState") != entry["routeOrState"]
            or observed.get("entryAction") != entry["entryAction"]
            or observed.get("surfaceSelector") != entry["surfaceSelector"]
            or observed.get("expectedResult") != expected_result(inventory, entry)
        ):
            missing.append(f"{entry['id']}:contract")
            continue
        cells = observed.get("cells")
        if not isinstance(cells, dict) or set(cells) != set(required_cells):
            missing.append(f"{entry['id']}:cells")
            continue
        for cell_id in required_cells:
            cell = cells[cell_id]
            if (
                not isinstance(cell, dict)
                or set(cell) != {"status", "viewport", "evidence"}
                or cell.get("status") != "PASS"
            ):
                missing.append(f"{entry['id']}:{cell_id}")
                continue
            viewport = cell.get("viewport")
            expected_orientation = (
                "landscape" if cell_id.startswith("landscape") else "portrait"
            )
            expected_text_size = (
                "maximum" if cell_id.endswith("maximum-text") else "normal"
            )
            if (
                not isinstance(viewport, dict)
                or set(viewport)
                != {"width", "height", "orientation", "textSize"}
                or not isinstance(viewport.get("width"), int)
                or viewport["width"] <= 0
                or not isinstance(viewport.get("height"), int)
                or viewport["height"] <= 0
                or viewport.get("orientation") != expected_orientation
                or viewport.get("textSize") != expected_text_size
            ):
                missing.append(f"{entry['id']}:{cell_id}:viewport")
                continue
            refs = cell.get("evidence")
            if not isinstance(refs, dict) or set(refs) != set(required_roles):
                missing.append(f"{entry['id']}:{cell_id}:evidence")
                continue
            resolved: dict[str, Path] = {}
            for role in required_roles:
                reference = _validate_artifact_ref(
                    refs[role],
                    evidence_store=store,
                    gate_id=GATE_ID,
                    run_id=run_id,
                    workspace_id=workspace_id,
                )
                expected_prefix = (
                    f"mobile-whole-product/{entry['id']}/{cell_id}/"
                )
                if (
                    not reference.path.startswith(expected_prefix)
                    or reference.path in seen_paths
                ):
                    raise GateError(
                        "Mobile surface ArtifactRef is reused or mis-scoped"
                    )
                seen_paths.add(reference.path)
                if role == "screenshot":
                    screenshot_refs.append(reference.to_dict())
                resolved[role] = store.resolve(reference)
            _validate_png(
                resolved["screenshot"],
                orientation=expected_orientation,
            )
            _validate_dom_artifact(
                resolved["dom"],
                inventory=inventory,
                entry=entry,
            )
            audit_accessibility_tree(
                resolved["accessibility"].read_text(encoding="utf-8")
            )
            _validate_interaction_artifact(
                resolved["interactionTrace"],
                inventory=inventory,
                entry=entry,
                cell_id=cell_id,
                viewport=viewport,
                run_id=run_id,
            )
    if missing:
        raise GateError(
            "Mobile surface evidence is incomplete: " + ", ".join(missing)
        )
    findings = value.get("findings")
    if not isinstance(findings, list):
        raise GateError("Mobile surface evidence findings must be a list")
    if findings:
        raise GateError(f"Mobile surface evidence has findings: {findings[:5]!r}")
    expected_surface_cells = [
        f"{entry['id']}:{cell_id}"
        for entry in entries
        for cell_id in required_cells
    ]
    surface_evidence_ref: ArtifactRef | None = None
    if require_manifest:
        manifest = store.latest(GATE_ID)
        manifest_source = manifest.get("source")
        manifest_result = manifest.get("result")
        manifest_artifacts = manifest.get("artifacts")
        if (
            manifest.get("runId") != run_id
            or manifest_source != current_source
            or not isinstance(manifest_result, dict)
            or manifest_result.get("status") != "PASS"
            or manifest_result.get("completionStatus") != "DONE"
            or manifest_result.get("proofStatus") != "PROVEN"
            or not isinstance(manifest_artifacts, dict)
        ):
            raise GateError("Mobile surface evidence run manifest is invalid")
        surface_evidence_ref = _validate_artifact_ref(
            manifest_artifacts.get(EVIDENCE_ROLE),
            evidence_store=store,
            gate_id=GATE_ID,
            run_id=run_id,
            workspace_id=workspace_id,
        )
        if store.read_json(surface_evidence_ref) != value:
            raise GateError(
                "Mobile surface evidence does not match its run manifest artifact"
            )
        registered_refs = {
            json.dumps(reference, sort_keys=True)
            for reference in manifest_artifacts.values()
            if isinstance(reference, dict)
        }
        observed_refs = [foreground["observation"]]
        for surface in evidence.values():
            for cell in surface["cells"].values():
                observed_refs.extend(cell["evidence"].values())
        if any(
            json.dumps(reference, sort_keys=True) not in registered_refs
            for reference in observed_refs
        ):
            raise GateError(
                "Mobile surface evidence is not bound to the run manifest"
            )
    if require_visual_review:
        if surface_evidence_ref is None:
            raise GateError(
                "Mobile visual review requires a durable surface evidence manifest"
            )
        _validate_visual_review(
            evidence_store=store,
            workspace_id=workspace_id,
            current_source=current_source,
            surface_set=surface_set,
            surface_evidence_ref=surface_evidence_ref,
            expected_surface_cells=expected_surface_cells,
            expected_screenshot_refs=screenshot_refs,
        )
    return dict(value)


def record_visual_review(
    inventory: Mapping[str, Any],
    surface_set: str,
    decision: Any,
    *,
    evidence_store: EvidenceStore | None = None,
    expected_source: Mapping[str, str] | None = None,
) -> dict[str, str]:
    if not isinstance(decision, dict) or set(decision) != {
        "reviewer",
        "verdict",
        "findings",
    }:
        raise GateError("Mobile visual review decision has an invalid shape")
    reviewer = decision.get("reviewer")
    verdict = decision.get("verdict")
    findings = decision.get("findings")
    if (
        not isinstance(reviewer, dict)
        or set(reviewer) != {"kind", "id"}
        or reviewer.get("kind") != "agent"
        or not isinstance(reviewer.get("id"), str)
        or not reviewer["id"]
    ):
        raise GateError("Mobile visual review owner is invalid")
    if verdict not in {"PASS", "FAIL"} or not isinstance(findings, list):
        raise GateError("Mobile visual review decision is invalid")
    if (verdict == "PASS" and findings) or (verdict == "FAIL" and not findings):
        raise GateError("Mobile visual review verdict and findings disagree")
    allowed_surface_ids = {
        entry["id"] for entry in selected_surface_entries(inventory, surface_set)
    }
    allowed_cell_ids = set(inventory["viewportTextSizeCells"])
    for finding in findings:
        if (
            not isinstance(finding, dict)
            or set(finding) != {"surfaceId", "cellId", "severity", "message"}
            or finding.get("surfaceId") not in allowed_surface_ids
            or finding.get("cellId") not in allowed_cell_ids
            or finding.get("severity") not in {"blocker", "major", "minor"}
            or not isinstance(finding.get("message"), str)
            or not finding["message"].strip()
        ):
            raise GateError("Mobile visual review finding is invalid")

    store = evidence_store or EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    current_source = dict(expected_source or source_identity(REPO_ROOT))
    surface_evidence_ref = store.latest_artifact_ref(GATE_ID, EVIDENCE_ROLE)
    value = store.read_json(surface_evidence_ref)
    validate_surface_evidence(
        inventory,
        surface_set,
        value,
        evidence_store=store,
        expected_source=current_source,
        require_manifest=True,
        require_visual_review=False,
    )
    required_cells = inventory["viewportTextSizeCells"]
    entries = selected_surface_entries(inventory, surface_set)
    reviewed_surface_cells = [
        f"{entry['id']}:{cell_id}"
        for entry in entries
        for cell_id in required_cells
    ]
    screenshot_refs = [
        value["surfaceEvidence"][entry["id"]]["cells"][cell_id]["evidence"][
            "screenshot"
        ]
        for entry in entries
        for cell_id in required_cells
    ]
    review = {
        "artifactKind": "mobile-whole-product-visual-review",
        "gateId": VISUAL_REVIEW_GATE_ID,
        "surfaceEvidence": surface_evidence_ref.to_dict(),
        "surfaceSet": surface_set,
        "source": current_source,
        "reviewer": reviewer,
        "verdict": verdict,
        "findings": findings,
        "reviewedSurfaceCells": reviewed_surface_cells,
        "screenshotArtifactRefs": screenshot_refs,
    }
    with store.begin_run(
        VISUAL_REVIEW_GATE_ID,
        source=current_source,
    ) as review_run:
        review_ref = review_run.write_json(
            "mobile-whole-product/visual-review.json",
            review,
            role=VISUAL_REVIEW_ROLE,
        )
        review_run.finalize(
            result={
                "status": verdict,
                "completionStatus": "DONE",
                "proofStatus": "PROVEN" if verdict == "PASS" else "UNPROVEN",
            }
        )
        review_run.publish_latest()
    return review_ref.to_dict()


class SimulatorWholeProductUsabilityGate(AcceptanceGate):
    gate_id = GATE_ID

    def run(self) -> dict[str, Any]:
        raise GateError(
            "SimulatorWholeProductUsabilityGate uses its evidence-aware execute entrypoint"
        )

    def execute(self) -> int:
        with ArtifactSession(repo_root=REPO_ROOT, gate_id=self.gate_id) as artifacts:
            status = "BLOCKED"
            completion_status = "BLOCKED"
            proof_status = "UNPROVEN"
            exit_code = 2
            surface_set = os.environ.get("PT_MOBILE_SURFACE_SET", "all")
            inventory = load_surface_inventory()
            selected_surface_entries(inventory, surface_set)
            result: dict[str, Any]
            try:
                manifest_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
                if not manifest_path:
                    raise SimulatorGateBlocked(
                        "PT_ACCEPTANCE_RUNTIME_MANIFEST is required",
                        "mobile-whole-product:manifest",
                    )
                manifest = load_runtime_manifest(Path(manifest_path), self.gate_id)
                if manifest.get("environmentId") != ENVIRONMENT_ID:
                    raise SimulatorGateBlocked(
                        f"RuntimeManifest environment must be {ENVIRONMENT_ID}",
                        f"{ENVIRONMENT_ID}:environment",
                    )
                source = _validate_source_identity(manifest)
                result = {
                    "artifactKind": "mobile-whole-product-surface-evidence",
                    "gateId": self.gate_id,
                    "contractId": CONTRACT_ID,
                    "surfaceSet": surface_set,
                    "runId": str(manifest.get("runId") or ""),
                    "workspaceId": str(manifest.get("workspaceId") or ""),
                    "source": source,
                    "foregroundEvidence": {
                        "platform": "ios",
                        "simulatorApplication": "com.apple.iphonesimulator",
                        "frontmost": False,
                        "windowVisible": False,
                        "observation": None,
                    },
                    "surfaceEvidence": {},
                    "findings": [
                        {
                            "code": "MOBILE_SURFACE_JOURNEY_ADAPTER_PENDING",
                            "message": (
                                "The executable inventory is registered; "
                                "surface adapters close in the page Tasks."
                            ),
                        }
                    ],
                }
                raise SimulatorGateBlocked(
                    "Whole-product surface journey adapters are incomplete",
                    "mobile-whole-product:surface-adapters",
                )
            except SimulatorGateBlocked as error:
                result = locals().get(
                    "result",
                    {
                        "artifactKind": "mobile-whole-product-surface-evidence",
                        "gateId": self.gate_id,
                        "contractId": CONTRACT_ID,
                        "surfaceSet": surface_set,
                        "runId": "",
                        "workspaceId": "",
                        "source": {},
                        "foregroundEvidence": {},
                        "surfaceEvidence": {},
                        "findings": [],
                    },
                )
                result["status"] = status
                result["completionStatus"] = completion_status
                result["proofStatus"] = proof_status
                result["blockedReason"] = redact_text(error.reason)
                result["blockedResource"] = error.resource
            artifacts.write_json(
                "mobile-whole-product/surface-evidence.json",
                result,
                role=EVIDENCE_ROLE,
            )
            artifacts.complete(
                status=status,
                completion_status=completion_status,
                proof_status=proof_status,
                runtime={
                    "environment": ENVIRONMENT_ID,
                    "surfaceSet": surface_set,
                    "foregroundRequired": True,
                },
            )
        sys.stderr.write(f"{status}: {self.gate_id}\n")
        return exit_code


def main() -> int:
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--validate-evidence", action="store_true")
    action.add_argument("--record-visual-review", action="store_true")
    parser.add_argument("--surface-set", default="all")
    parser.add_argument("--without-visual-review", action="store_true")
    args = parser.parse_args()
    if args.validate_evidence:
        inventory = load_surface_inventory()
        validate_surface_evidence(
            inventory,
            args.surface_set,
            json.load(sys.stdin),
            require_visual_review=not args.without_visual_review,
        )
        sys.stdout.write(
            f"PASS: {GATE_ID} surface evidence ({args.surface_set})\n"
        )
        return 0
    if args.record_visual_review:
        if args.without_visual_review:
            parser.error(
                "--without-visual-review is valid only with --validate-evidence"
            )
        review_ref = record_visual_review(
            load_surface_inventory(),
            args.surface_set,
            json.load(sys.stdin),
        )
        sys.stdout.write(f"{json.dumps(review_ref, sort_keys=True)}\n")
        return 0
    if args.without_visual_review:
        parser.error(
            "--without-visual-review is valid only with --validate-evidence"
        )
    return SimulatorWholeProductUsabilityGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
