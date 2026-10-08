#!/usr/bin/env python3
"""Complete foreground iOS Mobile surface inventory proof."""

from __future__ import annotations

import argparse
import json
import os
import re
import struct
import subprocess
import sys
import time
import zlib
from collections.abc import Mapping
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    ArtifactSession,
    DriverError,
    EvidenceStore,
    GateError,
    ProvisioningError,
    REPO_ROOT,
    load_runtime_manifest,
    require_runtime_service,
    source_identity,
)
from tooling.acceptance.core.redaction import redact_text
from tooling.acceptance.fixtures.chat_native_actors import ACTOR_PASSWORD
from tooling.acceptance.gates.mobile.messaging_journey import (
    MessagingActor,
    MobileMessagingJourney,
)
from tooling.acceptance.gates.mobile.simulator_e2e import (
    SimulatorCallbackRoutingGate,
    SimulatorGateBlocked,
    _redacted_markup,
    _required_object,
    _required_text,
    _validate_runtime_identity,
    _validate_source_identity,
)
from tooling.acceptance.gates.mobile.surface_audit import (
    audit_accessibility_tree,
    audit_keyboard_tree,
)


GATE_ID = "mobile-simulator-whole-product-usability-e2e"
ENVIRONMENT_ID = "mobile-direct-simulator"
EVIDENCE_ROLE = "mobile-surface-evidence"
VISUAL_REVIEW_GATE_ID = "mobile-whole-product-visual-review"
VISUAL_REVIEW_ROLE = "mobile-whole-product-visual-review"
ORIENTATION_MAX_ATTEMPTS = 5
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
SHELL_CLIENT_ID = "sim-ios"
SHELL_REQUIRED_HARNESS_ACTIONS = (
    "access.submit",
    "chat.fixture",
    "cleanup",
    "entry.fixture",
    "lifecycle.restart",
    "lifecycle.resume",
    "lifecycle.snapshot",
    "lifecycle.suspend",
    "lifecycle.waitReady",
    "navigation.apply",
    "navigation.snapshot",
    "projection.read",
    "recovery.fixture",
    "social.projection.read",
    "station.add",
)
SHELL_ROUTE_ACTIONS = {
    "tap-chat-tab": "tab:chat",
    "tap-moments-tab": "tab:moments",
    "tap-contacts-tab": "tab:contacts",
    "tap-settings-tab": "tab:settings",
}
ENTRY_PAGE_CONTROL_SURFACES = {
    "entry.station-empty",
    "entry.station-address",
    "entry.station-address-invalid",
    "entry.station-verifying",
    "entry.station-unavailable",
}
RECOVERY_PAGE_CONTROL_SURFACES = {
    "recovery.capacity",
    "recovery.event-overflow",
    "recovery.projection-stale",
    "recovery.write-revocation",
}
DEGRADED_NOTICE_SURFACES = {
    "shell.degraded-module-notice",
    "recovery.deferred-capability",
}
TEXT_SIZE_SCRIPT = """
const size = arguments[0];
if (size !== 'normal' && size !== 'maximum') {
  throw new Error(`unsupported text size ${size}`);
}
document.documentElement.dataset.acceptanceTextSize = size;
const nodes = Array.from(document.body.querySelectorAll('*')).filter(
  (element) => element instanceof HTMLElement
    && (
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
      || Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
      )
    ),
);
for (const element of nodes) {
  const attribute = 'data-acceptance-original-font-size';
  if (size === 'normal') {
    if (element.hasAttribute(attribute)) {
      element.style.fontSize = element.getAttribute(attribute);
      element.removeAttribute(attribute);
    }
    continue;
  }
  if (!element.hasAttribute(attribute)) {
    element.setAttribute(attribute, element.style.fontSize || '');
  }
  const computed = Number.parseFloat(getComputedStyle(element).fontSize);
  if (Number.isFinite(computed) && computed > 0) {
    element.style.fontSize = `${Math.min(32, computed * 1.35)}px`;
  }
}
return {
  textSize: size,
  width: Math.round(window.innerWidth),
  height: Math.round(window.innerHeight),
  scaledElementCount: size === 'maximum' ? nodes.length : 0,
};
"""
START_RESUME_SCRIPT = """
const root = window.__PEERS_MOBILE_ACCEPTANCE__;
if (!root || typeof root['lifecycle.resume'] !== 'function') return false;
window.__PEERS_MOBILE_RESUME_DONE__ = false;
window.__PEERS_MOBILE_RESUME_ERROR__ = null;
window.__PEERS_MOBILE_RESUME__ = Promise.resolve(
  root['lifecycle.resume']({})
).then(function () {
  window.__PEERS_MOBILE_RESUME_DONE__ = true;
}).catch(function (error) {
  window.__PEERS_MOBILE_RESUME_ERROR__ = String(error && error.message || error);
  window.__PEERS_MOBILE_RESUME_DONE__ = true;
});
return true;
"""
READ_RESUME_SCRIPT = """
return {
  done: window.__PEERS_MOBILE_RESUME_DONE__ === true,
  error: window.__PEERS_MOBILE_RESUME_ERROR__ || null,
};
"""
SURFACE_AUDIT_SCRIPT = """
const selector = arguments[0];
const minimum = arguments[1];
const allowDegradedNotice = arguments[2] === true;
const usePageControls = arguments[3] === true;
const visible = (element) => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number(style.opacity) > 0
    && rect.width > 0
    && rect.height > 0
    && rect.right > 0
    && rect.bottom > 0
    && rect.left < window.innerWidth
    && rect.top < window.innerHeight;
};
const label = (element) => String(
  element.getAttribute('aria-label')
  || element.getAttribute('placeholder')
  || element.getAttribute('title')
  || element.textContent
  || '',
).trim();
const clipsOverflow = (value) => (
  ['auto', 'scroll', 'hidden', 'clip', 'overlay'].includes(value)
);
const fullyVisibleWithinAncestors = (element, rect) => {
  for (
    let ancestor = element.parentElement;
    ancestor && ancestor !== document.documentElement;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    const ancestorRect = ancestor.getBoundingClientRect();
    if (
      clipsOverflow(style.overflowX)
      && (rect.left < ancestorRect.left - 1 || rect.right > ancestorRect.right + 1)
    ) return false;
    if (
      clipsOverflow(style.overflowY)
      && (rect.top < ancestorRect.top - 1 || rect.bottom > ancestorRect.bottom + 1)
    ) return false;
  }
  return true;
};
const root = document.querySelector(selector);
if (!root || !visible(root)) return {found: false};
const rootRect = root.getBoundingClientRect();
const interactiveSelector =
  'button,input,select,textarea,a[href],[role="button"],[tabindex]';
const controlScope = allowDegradedNotice || usePageControls ? document.body : root;
const interactive = [
  ...(controlScope.matches(interactiveSelector) ? [controlScope] : []),
  ...Array.from(controlScope.querySelectorAll(interactiveSelector)),
]
  .filter(visible)
  .filter((element) => element.getAttribute('tabindex') !== '-1');
const controls = interactive.map((element) => {
  const boundary = element.closest(
    [
      '.station-url-control',
      '.ant-input-affix-wrapper',
      '.ant-input-number',
      '.ant-select-selector',
      '.ant-checkbox-wrapper',
    ].join(','),
  ) || element;
  const rect = boundary.getBoundingClientRect();
  return {
    element: boundary,
    value: {
      label: label(element) || label(boundary),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visible: true,
      inViewport: rect.left >= -1
        && rect.top >= -1
        && rect.right <= window.innerWidth + 1
        && rect.bottom <= window.innerHeight + 1
        && fullyVisibleWithinAncestors(boundary, rect),
    },
  };
}).filter(({value}) => value.inViewport);
const occlusions = controls.flatMap(({element, value}) => {
  if (element.matches('.chat-action-sheet-backdrop')) return [];
  const rect = element.getBoundingClientRect();
  const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
  const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
  const top = document.elementFromPoint(x, y);
  return top && (element.contains(top) || top.contains(element))
    ? []
    : [value.label || element.tagName.toLowerCase()];
});
const clippedText = Array.from(root.querySelectorAll('*'))
  .filter(visible)
  .filter((element) => element.children.length === 0)
  .filter((element) => label(element))
  .filter((element) => {
    const style = getComputedStyle(element);
    if (['auto', 'scroll'].includes(style.overflowX)
        || ['auto', 'scroll'].includes(style.overflowY)) return false;
    return element.scrollWidth > element.clientWidth + 1
      || element.scrollHeight > element.clientHeight + 1;
  })
  .map((element) => label(element).slice(0, 160));
const blockingSelector = allowDegradedNotice
  ? '[data-blocks-unrelated-content="true"]'
  : [
      '[data-blocks-unrelated-content="true"]',
      '[data-product-surface="shell.degraded-module-notice"]',
    ].join(',');
const blockingSurfaces = Array.from(
  document.querySelectorAll(blockingSelector),
).filter(visible).map((element) => (
  element.getAttribute('data-product-surface')
  || element.getAttribute('data-acceptance-id')
  || element.tagName.toLowerCase()
));
return {
  found: true,
  viewport: {
    width: Math.round(window.innerWidth),
    height: Math.round(window.innerHeight),
  },
  surfaceElement: {
    selector,
    width: Math.round(rootRect.width),
    height: Math.round(rootRect.height),
    visible: true,
    inViewport: rootRect.left >= -1
      && rootRect.top >= -1
      && rootRect.right <= window.innerWidth + 1
      && rootRect.bottom <= window.innerHeight + 1,
  },
  controls: controls.map(({value}) => ({...value})),
  unlabeledControls: controls
    .filter(({value}) => !value.label)
    .map(({element}) => element.outerHTML.slice(0, 240)),
  undersizedControls: controls
    .filter(({value}) => value.width < minimum || value.height < minimum)
    .map(({value}) => ({...value})),
  clippedText,
  occlusions,
  blockingSurfaces,
};
"""


def _validate_lifecycle_readiness(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise GateError("Mobile lifecycle readiness returned an invalid snapshot")
    phase = value.get("phase")
    runtimes = value.get("runtimes")
    runtime_errors = value.get("runtimeErrors")
    if (
        phase != "ACTIVE"
        or not isinstance(runtimes, list)
        or not runtimes
        or not isinstance(runtime_errors, list)
    ):
        raise GateError("Mobile lifecycle did not settle after authentication")
    diagnostic_errors = {
        item.get("runtimeId"): redact_text(str(item.get("error")))
        for item in runtime_errors
        if (
            isinstance(item, Mapping)
            and isinstance(item.get("runtimeId"), str)
            and item["runtimeId"]
            and isinstance(item.get("error"), str)
            and item["error"]
        )
    }
    failures = []
    for runtime in runtimes:
        if (
            not isinstance(runtime, Mapping)
            or not isinstance(runtime.get("id"), str)
            or not runtime["id"]
            or not isinstance(runtime.get("status"), str)
        ):
            raise GateError("Mobile lifecycle readiness has an invalid runtime")
        if runtime["status"] == "ready":
            continue
        failures.append(
            {
                "runtimeId": runtime["id"],
                "status": runtime["status"],
                "errorKey": runtime.get("errorKey"),
                "error": diagnostic_errors.get(runtime["id"]),
            }
        )
    if failures:
        raise GateError(
            "Mobile lifecycle has failed runtimes after authentication: "
            + json.dumps(failures, sort_keys=True)
        )
    return dict(value)


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


def _is_proven_manifest_result(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    if value.get("completionStatus") != "DONE":
        return False
    if (
        value.get("status") == "PASS"
        and value.get("proofStatus") == "PROVEN"
    ):
        return True
    return (
        value.get("artifactKind")
        in {"acceptance-gate-result", "development-functional-result"}
        and value.get("status") == "passed"
        and value.get("evidenceStatus") == "PASS"
        and value.get("exit_code") == 0
    )


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
        or not _is_proven_manifest_result(result)
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
            or not _is_proven_manifest_result(manifest_result)
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


class SimulatorWholeProductUsabilityGate(
    SimulatorCallbackRoutingGate,
    AcceptanceGate,
):
    gate_id = GATE_ID

    def __init__(self, *, foreground_probe: Any = None, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.foreground_probe = (
            foreground_probe or self._probe_simulator_foreground
        )

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
                manifest = self._load_manifest()
                result = self._run_surface_journey(
                    artifacts,
                    manifest,
                    inventory,
                    surface_set,
                )
                validate_surface_evidence(
                    inventory,
                    surface_set,
                    result,
                    evidence_store=artifacts.store,
                    expected_source=result["source"],
                    require_manifest=False,
                    require_visual_review=False,
                )
                status = "PASS"
                completion_status = "DONE"
                proof_status = "PROVEN"
                exit_code = 0
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
            except (DriverError, GateError, ProvisioningError) as error:
                status = "FAIL"
                completion_status = "PARTIAL"
                proof_status = "UNPROVEN"
                exit_code = 1
                existing_result = locals().get("result")
                if isinstance(existing_result, dict):
                    result = existing_result
                    findings = result.get("findings")
                    if not isinstance(findings, list):
                        findings = []
                        result["findings"] = findings
                    findings.append(
                        {
                            "code": type(error).__name__,
                            "message": redact_text(str(error)),
                        }
                    )
                else:
                    result = {
                        "artifactKind": "mobile-whole-product-surface-evidence",
                        "gateId": self.gate_id,
                        "contractId": CONTRACT_ID,
                        "surfaceSet": surface_set,
                        "runId": "",
                        "workspaceId": "",
                        "source": {},
                        "foregroundEvidence": {},
                        "surfaceEvidence": {},
                        "findings": [
                            {
                                "code": type(error).__name__,
                                "message": redact_text(str(error)),
                            }
                        ],
                    }
            finally:
                self._cleanup_sessions(artifacts)
            if any(item["status"] == "failed" for item in self.cleanup):
                status = "FAIL"
                completion_status = "PARTIAL"
                proof_status = "UNPROVEN"
                exit_code = 1
                result["findings"].append(
                    {
                        "code": "MOBILE_SURFACE_CLEANUP_FAILED",
                        "message": "Simulator shell journey cleanup was incomplete",
                    }
                )
            result.update(
                {
                    "status": status,
                    "completionStatus": completion_status,
                    "proofStatus": proof_status,
                }
            )
            surface_evidence_ref = artifacts.write_json(
                "mobile-whole-product/surface-evidence.json",
                result,
                role=EVIDENCE_ROLE,
            )
            report = self._result_report(status, surface_set)
            report.update(
                {
                    "completionStatus": completion_status,
                    "proofStatus": proof_status,
                    "surfaceEvidence": surface_evidence_ref.to_dict(),
                }
            )
            artifacts.write_json(
                "mobile-whole-product/result.json",
                report,
                role="mobile-whole-product-result",
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
        stream = sys.stdout if exit_code == 0 else sys.stderr
        stream.write(f"{status}: {self.gate_id}\n")
        return exit_code

    @staticmethod
    def _result_report(status: str, surface_set: str) -> dict[str, Any]:
        report_scope = {
            "entry": {
                "runtimeCell": "ios-simulator-entry",
                "phase": "MWPU-03 Entry Usability",
                "bom": ["MWPU-03-ENTRY"],
                "observedScope": [
                    "launch",
                    "station-selection",
                    "access-gates",
                    "runtime-preparation",
                ],
            },
            "recovery": {
                "runtimeCell": "ios-simulator-recovery",
                "phase": "MWPU-03 Recovery Usability",
                "bom": ["MWPU-03-RECOVERY"],
                "observedScope": [
                    "returning-session",
                    "session-revocation",
                    "draft-and-command-recovery",
                    "scoped-degradation",
                    "local-reliability-recovery",
                ],
            },
            "shell": {
                "runtimeCell": "ios-simulator-shell",
                "phase": "MWPU-02 Shell Usability",
                "bom": ["MWPU-02-SHELL"],
                "observedScope": [
                    "shell-navigation",
                    "shell-degraded-module",
                ],
            },
            "chat": {
                "runtimeCell": "ios-simulator-chat",
                "phase": "MWPU-04 Chat Usability",
                "bom": ["MWPU-04-CHAT"],
                "observedScope": [
                    "conversation-list",
                    "direct-and-group-threads",
                    "composer-and-attachments",
                    "message-and-conversation-actions",
                    "group-management",
                ],
            },
        }.get(surface_set)
        if report_scope is None:
            report_scope = {
                "runtimeCell": f"ios-simulator-{surface_set}",
                "phase": "Mobile Whole-Product Usability",
                "bom": [],
                "observedScope": [],
            }
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": GATE_ID,
            "gate": GATE_ID,
            "environment": ENVIRONMENT_ID,
            "runtimeCell": report_scope["runtimeCell"],
            "status": status,
            "phase": report_scope["phase"],
            "bom": report_scope["bom"],
            "spec": ["MS-PA28", "MS-PA29", "MS-AG12"],
            "observedScope": report_scope["observedScope"]
            if status == "PASS"
            else [],
            "unprovenScope": [
                f"non-{surface_set} Mobile surface sets",
                "Android",
                "physical-device behavior",
            ],
            "physicalDeviceClaimed": False,
            "sampleEmissionAllowed": status == "PASS",
        }

    def _load_manifest(self) -> dict[str, Any]:
        manifest_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
        if not manifest_path:
            raise SimulatorGateBlocked(
                "PT_ACCEPTANCE_RUNTIME_MANIFEST is required",
                "mobile-whole-product:manifest",
            )
        try:
            manifest = load_runtime_manifest(Path(manifest_path), self.gate_id)
            require_runtime_service(manifest, "station", "station")
        except ProvisioningError as error:
            raise SimulatorGateBlocked(
                str(error),
                "mobile-whole-product:manifest",
            ) from error
        if manifest.get("environmentId") != ENVIRONMENT_ID:
            raise SimulatorGateBlocked(
                f"RuntimeManifest environment must be {ENVIRONMENT_ID}",
                f"{ENVIRONMENT_ID}:environment",
            )
        return manifest

    def _run_surface_journey(
        self,
        artifacts: ArtifactSession,
        manifest: Mapping[str, Any],
        inventory: Mapping[str, Any],
        surface_set: str,
    ) -> dict[str, Any]:
        if surface_set == "entry":
            return self._run_entry_surface_journey(
                artifacts,
                manifest,
                inventory,
            )
        if surface_set not in {"shell", "recovery", "chat"}:
            raise SimulatorGateBlocked(
                f"Surface adapter is not implemented for {surface_set}",
                f"mobile-whole-product:surface-adapter:{surface_set}",
            )
        source = _validate_source_identity(manifest)
        canonical_worktree_hash = source.get("canonicalWorktreeHash")
        if canonical_worktree_hash not in (
            None,
            artifacts.store.workspace_id,
        ):
            raise SimulatorGateBlocked(
                "Whole-product source workspace identity is inconsistent",
                "mobile-whole-product:source-identity",
            )
        source["canonicalWorktreeHash"] = artifacts.store.workspace_id
        resources = _required_object(
            manifest,
            "mobileSimulator",
            "RuntimeManifest",
        )
        self._reject_credentials(manifest, resources)
        runtime_identity = _validate_runtime_identity(resources)
        appium = _required_object(
            resources,
            "appium",
            f"{ENVIRONMENT_ID} resources",
        )
        server_url = _required_text(
            appium,
            "serverUrl",
            f"{ENVIRONMENT_ID} Appium",
        )
        specs = self._client_specs(resources)
        spec = next(
            (candidate for candidate in specs if candidate.client_id == SHELL_CLIENT_ID),
            None,
        )
        if spec is None or spec.platform != "ios":
            raise SimulatorGateBlocked(
                "Whole-product shell proof requires sim-ios",
                f"{ENVIRONMENT_ID}:client:{SHELL_CLIENT_ID}",
            )

        session = self._create_session(server_url, spec)
        self.sessions.append(session)
        session.start()
        self._record(spec.client_id, "session-created")
        self._preflight_ios(artifacts, session, spec)
        session.require_harness(list(SHELL_REQUIRED_HARNESS_ACTIONS))
        actor = self._load_actor(artifacts, manifest)
        authentication = MobileMessagingJourney(
            timeout_seconds=45,
        ).authenticate(session, actor, password=ACTOR_PASSWORD)
        self._record(spec.client_id, "shell-authenticated")
        session.switch_to_app_webview()
        lifecycle = session.call_action(
            "lifecycle.waitReady",
            {"includeDiagnostics": True},
        )
        if not isinstance(lifecycle, Mapping):
            raise GateError(
                "Mobile lifecycle readiness returned an invalid snapshot"
            )
        lifecycle_ref = artifacts.write_json(
            "mobile-whole-product/lifecycle-readiness.json",
            {
                "artifactKind": "mobile-lifecycle-readiness-diagnostic",
                "gateId": self.gate_id,
                "runId": artifacts.run_id,
                "snapshot": dict(lifecycle),
            },
            role="mobile-whole-product-lifecycle-readiness",
        )
        _validate_lifecycle_readiness(lifecycle)

        session.switch_to_native()
        active_application = session.execute_script("mobile: activeAppInfo")
        if (
            not isinstance(active_application, Mapping)
            or active_application.get("bundleId") != spec.build.application_id
        ):
            raise GateError("Peers is not the active iOS Simulator application")
        foreground = self.foreground_probe(spec.device.identifier)
        if not isinstance(foreground, dict):
            raise GateError("Mobile foreground probe returned an invalid result")
        foreground.update(
            {
                "artifactKind": "mobile-simulator-foreground-observation",
                "gateId": self.gate_id,
                "runId": artifacts.run_id,
            }
        )
        foreground_ref = artifacts.write_json(
            "mobile-whole-product/foreground.json",
            foreground,
            role="mobile-whole-product-foreground",
        )

        entries = selected_surface_entries(inventory, surface_set)
        surface_evidence = {
            entry["id"]: {
                "status": "PASS",
                "routeOrState": entry["routeOrState"],
                "entryAction": entry["entryAction"],
                "surfaceSelector": entry["surfaceSelector"],
                "expectedResult": expected_result(inventory, entry),
                "cells": {},
            }
            for entry in entries
        }
        for cell_id in inventory["viewportTextSizeCells"]:
            if surface_set == "recovery":
                session.switch_to_app_webview()
                session.call_action("recovery.fixture", {"surfaceId": None})
                time.sleep(0.5)
            elif surface_set == "chat":
                session.switch_to_app_webview()
                session.call_action("chat.fixture", {"surfaceId": None})
                time.sleep(0.5)
            viewport = self._configure_cell(session, cell_id)
            for entry in entries:
                action = (
                    self._enter_recovery_surface(session, entry)
                    if surface_set == "recovery"
                    else self._enter_chat_surface(session, entry)
                    if surface_set == "chat"
                    else self._enter_surface(session, entry)
                )
                surface_evidence[entry["id"]]["cells"][cell_id] = (
                    self._capture_surface(
                        artifacts,
                        session,
                        inventory,
                        entry,
                        cell_id,
                        viewport,
                        action,
                    )
                )
                if entry["entryAction"] == "fixture-deferred-module":
                    self._wait_for_resume(session)
        self._configure_cell(session, "portrait-normal")
        if surface_set == "recovery":
            session.call_action("recovery.fixture", {"surfaceId": None})
        elif surface_set == "chat":
            session.call_action("chat.fixture", {"surfaceId": None})
        artifacts.write_json(
            "mobile-whole-product/source-runtime.json",
            {
                "artifactKind": "mobile-whole-product-source-runtime",
                "gateId": self.gate_id,
                "runId": artifacts.run_id,
                "source": source,
                "runtime": runtime_identity,
                "authentication": authentication,
                "lifecycleReadiness": lifecycle_ref.to_dict(),
            },
            role="mobile-whole-product-source-runtime",
        )
        return {
            "artifactKind": "mobile-whole-product-surface-evidence",
            "gateId": self.gate_id,
            "contractId": CONTRACT_ID,
            "surfaceSet": surface_set,
            "runId": artifacts.run_id,
            "workspaceId": artifacts.store.workspace_id,
            "status": "PASS",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "source": source,
            "foregroundEvidence": {
                "platform": "ios",
                "simulatorApplication": "com.apple.iphonesimulator",
                "frontmost": True,
                "windowVisible": True,
                "observation": foreground_ref.to_dict(),
            },
            "surfaceEvidence": surface_evidence,
            "findings": [],
        }

    def _run_entry_surface_journey(
        self,
        artifacts: ArtifactSession,
        manifest: Mapping[str, Any],
        inventory: Mapping[str, Any],
    ) -> dict[str, Any]:
        source = _validate_source_identity(manifest)
        canonical_worktree_hash = source.get("canonicalWorktreeHash")
        if canonical_worktree_hash not in (
            None,
            artifacts.store.workspace_id,
        ):
            raise SimulatorGateBlocked(
                "Whole-product source workspace identity is inconsistent",
                "mobile-whole-product:source-identity",
            )
        source["canonicalWorktreeHash"] = artifacts.store.workspace_id
        resources = _required_object(
            manifest,
            "mobileSimulator",
            "RuntimeManifest",
        )
        self._reject_credentials(manifest, resources)
        runtime_identity = _validate_runtime_identity(resources)
        appium = _required_object(
            resources,
            "appium",
            f"{ENVIRONMENT_ID} resources",
        )
        server_url = _required_text(
            appium,
            "serverUrl",
            f"{ENVIRONMENT_ID} Appium",
        )
        spec = next(
            (
                candidate
                for candidate in self._client_specs(resources)
                if candidate.client_id == SHELL_CLIENT_ID
            ),
            None,
        )
        if spec is None or spec.platform != "ios":
            raise SimulatorGateBlocked(
                "Whole-product entry proof requires sim-ios",
                f"{ENVIRONMENT_ID}:client:{SHELL_CLIENT_ID}",
            )

        session = self._create_session(server_url, spec)
        self.sessions.append(session)
        session.start()
        self._record(spec.client_id, "entry-session-created")
        self._preflight_ios(artifacts, session, spec)
        session.require_harness(list(SHELL_REQUIRED_HARNESS_ACTIONS))
        actor = self._load_actor(artifacts, manifest)
        session.switch_to_app_webview()
        station = session.call_action("station.add", {"url": actor.station_url})
        if (
            not isinstance(station, Mapping)
            or station.get("verifiedStationPeerId") != actor.station_peer_id
        ):
            raise GateError("Mobile entry proof verified the wrong Station identity")
        self._record(spec.client_id, "entry-station-verified")

        session.switch_to_native()
        active_application = session.execute_script("mobile: activeAppInfo")
        if (
            not isinstance(active_application, Mapping)
            or active_application.get("bundleId") != spec.build.application_id
        ):
            raise GateError("Peers is not the active iOS Simulator application")
        foreground = self.foreground_probe(spec.device.identifier)
        if not isinstance(foreground, dict):
            raise GateError("Mobile foreground probe returned an invalid result")
        foreground.update(
            {
                "artifactKind": "mobile-simulator-foreground-observation",
                "gateId": self.gate_id,
                "runId": artifacts.run_id,
            }
        )
        foreground_ref = artifacts.write_json(
            "mobile-whole-product/foreground.json",
            foreground,
            role="mobile-whole-product-foreground",
        )

        entries = selected_surface_entries(inventory, "entry")
        surface_evidence = {
            entry["id"]: {
                "status": "PASS",
                "routeOrState": entry["routeOrState"],
                "entryAction": entry["entryAction"],
                "surfaceSelector": entry["surfaceSelector"],
                "expectedResult": expected_result(inventory, entry),
                "cells": {},
            }
            for entry in entries
        }
        surface_failures: list[dict[str, str]] = []
        for cell_id in inventory["viewportTextSizeCells"]:
            viewport = self._configure_cell(session, cell_id)
            for entry in entries:
                try:
                    action = self._enter_entry_surface(session, entry)
                    surface_evidence[entry["id"]]["cells"][cell_id] = (
                        self._capture_surface(
                            artifacts,
                            session,
                            inventory,
                            entry,
                            cell_id,
                            viewport,
                            action,
                        )
                    )
                except GateError as error:
                    surface_failures.append(
                        {
                            "surfaceId": str(entry["id"]),
                            "cellId": cell_id,
                            "message": redact_text(str(error)),
                        }
                    )
        self._configure_cell(session, "portrait-normal")
        session.call_action("entry.fixture", {"surfaceId": None})
        if surface_failures:
            artifacts.write_json(
                "mobile-whole-product/entry-surface-failures.json",
                {
                    "artifactKind": "mobile-entry-surface-failures",
                    "gateId": self.gate_id,
                    "runId": artifacts.run_id,
                    "failures": surface_failures,
                },
                role="mobile-whole-product-entry-failures",
            )
            raise GateError(
                "Mobile entry surface audit failed: "
                + json.dumps(surface_failures, sort_keys=True)
            )
        artifacts.write_json(
            "mobile-whole-product/source-runtime.json",
            {
                "artifactKind": "mobile-whole-product-source-runtime",
                "gateId": self.gate_id,
                "runId": artifacts.run_id,
                "source": source,
                "runtime": runtime_identity,
                "stationVerification": {
                    "clientId": actor.client_id,
                    "stationPeerId": actor.station_peer_id,
                    "verifiedStationPeerId": station["verifiedStationPeerId"],
                },
                "authentication": {
                    "performed": False,
                    "reason": "entry surfaces stop before authenticated Shell admission",
                },
            },
            role="mobile-whole-product-source-runtime",
        )
        return {
            "artifactKind": "mobile-whole-product-surface-evidence",
            "gateId": self.gate_id,
            "contractId": CONTRACT_ID,
            "surfaceSet": "entry",
            "runId": artifacts.run_id,
            "workspaceId": artifacts.store.workspace_id,
            "status": "PASS",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "source": source,
            "foregroundEvidence": {
                "platform": "ios",
                "simulatorApplication": "com.apple.iphonesimulator",
                "frontmost": True,
                "windowVisible": True,
                "observation": foreground_ref.to_dict(),
            },
            "surfaceEvidence": surface_evidence,
            "findings": [],
        }

    def _load_actor(
        self,
        artifacts: ArtifactSession,
        manifest: Mapping[str, Any],
    ) -> MessagingActor:
        raw_reference = manifest.get("actorManifest")
        if not isinstance(raw_reference, Mapping):
            raise SimulatorGateBlocked(
                "Mobile direct simulator actor manifest is missing",
                f"{ENVIRONMENT_ID}:actor-manifest",
            )
        try:
            reference = ArtifactRef.from_dict(raw_reference)
            if (
                reference.workspace_id != artifacts.store.workspace_id
                or reference.gate_id != self.gate_id
                or reference.run_id != artifacts.run_id
            ):
                raise ValueError("actor manifest identity mismatch")
            payload = artifacts.store.read_json(reference)
            station = _required_object(
                _required_object(
                    payload,
                    "stations",
                    "Mobile direct actor manifest",
                ),
                "station",
                "Mobile direct actor manifest",
            )
            actors = station.get("actors")
            if not isinstance(actors, list):
                raise ValueError("actor list is missing")
            actor = next(
                (
                    value
                    for value in actors
                    if isinstance(value, Mapping) and value.get("role") == "alice"
                ),
                None,
            )
            if not isinstance(actor, Mapping):
                raise ValueError("alice actor is missing")
            service = require_runtime_service(manifest, "station", "station")
            return MessagingActor(
                client_id=SHELL_CLIENT_ID,
                role="alice",
                station_url=_required_text(
                    service,
                    "endpoint",
                    "Mobile direct Station",
                ),
                station_peer_id=_required_text(
                    service,
                    "runtimeIdentity",
                    "Mobile direct Station",
                ),
                ptid=_required_text(actor, "ptid", "Mobile direct actor"),
                account_ref=_required_text(
                    actor,
                    "accountRef",
                    "Mobile direct actor",
                ),
                federated_handle=_required_text(
                    actor,
                    "federatedHandle",
                    "Mobile direct actor",
                ),
                federation_id=_required_text(
                    actor,
                    "federationId",
                    "Mobile direct actor",
                ),
            )
        except (GateError, ProvisioningError, ValueError) as error:
            raise SimulatorGateBlocked(
                "Mobile direct simulator actor manifest is invalid",
                f"{ENVIRONMENT_ID}:actor-manifest",
            ) from error

    def _configure_cell(
        self,
        session: Any,
        cell_id: str,
    ) -> dict[str, Any]:
        orientation = (
            "landscape" if cell_id.startswith("landscape") else "portrait"
        )
        text_size = (
            "maximum" if cell_id.endswith("maximum-text") else "normal"
        )
        session.switch_to_native()
        if getattr(session, "platform", "") == "ios":
            session.execute_script(
                "mobile: activateApp",
                {"bundleId": session.build.application_id},
            )
            time.sleep(0.5)
        for attempt in range(1, ORIENTATION_MAX_ATTEMPTS + 1):
            try:
                session.set_orientation(orientation.upper())
                break
            except DriverError as error:
                if (
                    "Unable To Rotate Device" not in str(error)
                    or attempt == ORIENTATION_MAX_ATTEMPTS
                ):
                    raise
                time.sleep(0.75 * attempt)
        time.sleep(0.5)
        session.switch_to_app_webview()
        value = session.execute_script(TEXT_SIZE_SCRIPT, text_size)
        if (
            not isinstance(value, dict)
            or value.get("textSize") != text_size
            or not isinstance(value.get("width"), int)
            or not isinstance(value.get("height"), int)
            or value["width"] <= 0
            or value["height"] <= 0
        ):
            raise GateError(f"Mobile viewport setup failed for {cell_id}")
        if (
            text_size == "maximum"
            and (
                not isinstance(value.get("scaledElementCount"), int)
                or value["scaledElementCount"] <= 0
            )
        ):
            raise GateError(
                f"Mobile maximum text stress did not scale content for {cell_id}"
            )
        if (
            orientation == "portrait"
            and value["width"] >= value["height"]
        ) or (
            orientation == "landscape"
            and value["width"] <= value["height"]
        ):
            raise GateError(f"Mobile viewport orientation failed for {cell_id}")
        self._record(
            session.client_id,
            "surface-cell-configured",
            {"cellId": cell_id},
        )
        return {
            "width": value["width"],
            "height": value["height"],
            "orientation": orientation,
            "textSize": text_size,
        }

    def _enter_surface(
        self,
        session: Any,
        entry: Mapping[str, Any],
    ) -> dict[str, Any]:
        action = str(entry["entryAction"])
        route_id = SHELL_ROUTE_ACTIONS.get(action)
        session.switch_to_app_webview()
        if route_id is not None:
            button = session.find_element(
                "css selector",
                f'[data-route-id="{route_id}"]',
            )
            session.click_element(button)
            projection = session.call_action("navigation.snapshot")
            if (
                not isinstance(projection, Mapping)
                or projection.get("primaryRouteId") != route_id
            ):
                raise GateError(f"Mobile shell did not navigate to {route_id}")
            action_kind = "native-touch"
        elif action == "fixture-deferred-module":
            suspended = session.call_action("lifecycle.suspend")
            if not isinstance(suspended, Mapping):
                raise GateError(
                    "Mobile shell did not suspend for degraded-state proof"
                )
            if session.execute_script(START_RESUME_SCRIPT) is not True:
                raise GateError(
                    "Mobile shell did not start resume for degraded-state proof"
                )
            action_kind = "system"
        else:
            raise GateError(f"Unsupported shell entry action: {action}")
        self._wait_for_surface(
            session,
            str(entry["surfaceSelector"]),
            require_heading=entry["id"] != "shell.degraded-module-notice",
        )
        return {
            "kind": action_kind,
            "target": action,
            "performed": True,
        }

    def _enter_recovery_surface(
        self,
        session: Any,
        entry: Mapping[str, Any],
    ) -> dict[str, Any]:
        surface_id = str(entry["id"])
        action = str(entry["entryAction"])
        session.switch_to_app_webview()
        observed = session.call_action(
            "recovery.fixture",
            {"surfaceId": surface_id},
        )
        if (
            not isinstance(observed, Mapping)
            or observed.get("surfaceId") != surface_id
        ):
            raise GateError(
                f"Mobile recovery fixture did not project {surface_id}"
            )
        self._wait_for_surface(
            session,
            str(entry["surfaceSelector"]),
            require_heading=False,
        )
        if surface_id in {
            "recovery.session-mismatch",
            "recovery.draft-restore",
            "recovery.draft-restore-failed",
            "recovery.scope-exit",
            "recovery.reset-incomplete",
            "recovery.legacy-reliability",
        }:
            time.sleep(0.5)
        return {
            "kind": "system",
            "target": action,
            "performed": True,
        }

    def _enter_chat_surface(
        self,
        session: Any,
        entry: Mapping[str, Any],
    ) -> dict[str, Any]:
        surface_id = str(entry["id"])
        action = str(entry["entryAction"])
        session.switch_to_app_webview()
        composer_was_focused = session.execute_script(
            "const active=document.activeElement;"
            "const focused=active instanceof HTMLElement"
            "&&active.matches('[data-chat-fixture-composer]');"
            "if(active instanceof HTMLElement){active.blur();}"
            "return focused;"
        )
        if composer_was_focused is True:
            time.sleep(0.4)
        observed = session.call_action(
            "chat.fixture",
            {"surfaceId": surface_id},
        )
        if (
            not isinstance(observed, Mapping)
            or observed.get("surfaceId") != surface_id
        ):
            raise GateError(f"Mobile Chat fixture did not project {surface_id}")
        self._wait_for_surface(
            session,
            str(entry["surfaceSelector"]),
        )

        action_kind = "system"
        if action in {"type-conversation-query", "search-unknown-conversation"}:
            search = session.find_element(
                "css selector",
                "[data-chat-fixture-search]",
            )
            session.click_element(search)
            action_kind = "native-text"
        elif action == "focus-message-composer":
            composer = session.find_element(
                "css selector",
                "[data-chat-fixture-composer]",
            )
            session.click_element(composer)
            session.switch_to_native()
            native_composer = session.find_element(
                "class name",
                "XCUIElementTypeTextField",
            )
            session.click_element(native_composer)
            self._wait_for_chat_keyboard(session)
            session.switch_to_app_webview()
            self._wait_for_chat_composer_focus(session)
            action_kind = "native-touch"
        elif action == "tap-chat-tab":
            tab = session.find_element(
                "css selector",
                '[data-route-id="tab:chat"]',
            )
            session.click_element(tab)
            action_kind = "native-touch"

        return {
            "kind": action_kind,
            "target": action,
            "performed": True,
        }

    @staticmethod
    def _wait_for_chat_composer_focus(
        session: Any,
        timeout_seconds: float = 10.0,
    ) -> None:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            focused = session.execute_script(
                "const node=document.querySelector('[data-chat-fixture-composer]');"
                "return Boolean(node&&document.activeElement===node);"
            )
            if focused is True:
                time.sleep(0.5)
                return
            time.sleep(0.2)
        raise GateError("Mobile Chat composer did not receive foreground focus")

    @staticmethod
    def _wait_for_chat_keyboard(
        session: Any,
        timeout_seconds: float = 10.0,
    ) -> None:
        deadline = time.monotonic() + timeout_seconds
        last_error: GateError | None = None
        while time.monotonic() < deadline:
            source = session.get_page_source()
            if "<XCUIElementTypeKeyboard" in source:
                try:
                    audit_keyboard_tree(source)
                    return
                except GateError as error:
                    last_error = error
            time.sleep(0.2)
        if last_error is not None:
            raise last_error
        raise GateError("Mobile Chat software keyboard did not appear")

    def _enter_entry_surface(
        self,
        session: Any,
        entry: Mapping[str, Any],
    ) -> dict[str, Any]:
        surface_id = str(entry["id"])
        action = str(entry["entryAction"])
        session.switch_to_app_webview()
        if action == "tap-add-station":
            session.call_action(
                "entry.fixture",
                {"surfaceId": "entry.station-selection"},
            )
            self._wait_for_surface(
                session,
                '[data-product-surface="entry.station-selection"]',
            )
            button = session.find_element(
                "css selector",
                ".station-add-secondary",
            )
            session.click_element(button)
            action_kind = "native-touch"
        elif action == "tap-remove-station":
            session.call_action(
                "entry.fixture",
                {"surfaceId": "entry.station-selection"},
            )
            self._wait_for_surface(
                session,
                '[data-product-surface="entry.station-selection"]',
            )
            button = session.find_element(
                "css selector",
                '[data-entry-action="remove-station"]',
            )
            session.click_element(button)
            action_kind = "native-touch"
        else:
            observed = session.call_action(
                "entry.fixture",
                {"surfaceId": surface_id},
            )
            if (
                not isinstance(observed, Mapping)
                or observed.get("surfaceId") != surface_id
            ):
                raise GateError(
                    f"Mobile entry fixture did not project {surface_id}"
                )
            action_kind = (
                "native-text"
                if action == "submit-invalid-station-address"
                else "system"
            )
        self._wait_for_surface(
            session,
            str(entry["surfaceSelector"]),
        )
        if surface_id in {
            "entry.station-identity-mismatch",
            "entry.station-remove-confirm",
        }:
            time.sleep(0.75)
        return {
            "kind": action_kind,
            "target": action,
            "performed": True,
        }

    @staticmethod
    def _wait_for_surface(
        session: Any,
        selector: str,
        require_heading: bool = True,
        timeout_seconds: float = 10.0,
    ) -> None:
        deadline = time.monotonic() + timeout_seconds
        stable_observations = 0
        while time.monotonic() < deadline:
            found = session.execute_script(
                "const node=document.querySelector(arguments[0]);"
                "if(!node)return false;"
                "const rect=node.getBoundingClientRect();"
                "const style=getComputedStyle(node);"
                "const visible=style.display!=='none'&&style.visibility!=='hidden'"
                "&&Number(style.opacity)>0&&rect.width>0&&rect.height>0;"
                "if(!visible)return false;"
                "if(!arguments[1])return true;"
                "return Array.from(document.querySelectorAll("
                "'h1,[role=\"heading\"][aria-level=\"1\"]'"
                ")).some((heading)=>{"
                "const headingRect=heading.getBoundingClientRect();"
                "const headingStyle=getComputedStyle(heading);"
                "return headingStyle.display!=='none'"
                "&&headingStyle.visibility!=='hidden'"
                "&&Number(headingStyle.opacity)>0"
                "&&headingRect.width>0&&headingRect.height>0;});",
                selector,
                require_heading,
            )
            if found is True:
                stable_observations += 1
                if stable_observations >= 2:
                    return
            else:
                stable_observations = 0
            time.sleep(0.2)
        raise GateError(f"Mobile shell surface did not appear: {selector}")

    @staticmethod
    def _wait_for_resume(
        session: Any,
        timeout_seconds: float = 10.0,
    ) -> None:
        session.switch_to_app_webview()
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            result = session.execute_script(READ_RESUME_SCRIPT)
            if isinstance(result, Mapping):
                if result.get("error"):
                    raise GateError(
                        f"Mobile shell resume failed: {result['error']}"
                    )
                if result.get("done") is True:
                    return
            time.sleep(0.2)
        raise GateError("Mobile shell did not resume after degraded capture")

    def _capture_surface(
        self,
        artifacts: ArtifactSession,
        session: Any,
        inventory: Mapping[str, Any],
        entry: Mapping[str, Any],
        cell_id: str,
        viewport: Mapping[str, Any],
        action: Mapping[str, Any],
    ) -> dict[str, Any]:
        session.switch_to_app_webview()
        observation = session.execute_script(
            SURFACE_AUDIT_SCRIPT,
            entry["surfaceSelector"],
            inventory["qualityRules"]["minimumTouchTargetCssPx"],
            entry["id"] in DEGRADED_NOTICE_SURFACES,
            entry["id"] in (
                ENTRY_PAGE_CONTROL_SURFACES
                | RECOVERY_PAGE_CONTROL_SURFACES
            ),
        )
        if not isinstance(observation, Mapping) or observation.get("found") is not True:
            raise GateError(f"Mobile shell surface is unavailable: {entry['id']}")
        for field in ("unlabeledControls", "undersizedControls", "clippedText"):
            findings = observation.get(field)
            if not isinstance(findings, list) or findings:
                raise GateError(
                    f"Mobile shell surface {entry['id']} failed {field}: "
                    f"{findings!r}"
                )
        actual_viewport = observation.get("viewport")
        if not isinstance(actual_viewport, Mapping):
            raise GateError(f"Mobile viewport changed while capturing {entry['id']}")
        viewport_changed = (
            actual_viewport.get("width") != viewport["width"]
            or actual_viewport.get("height") != viewport["height"]
        )
        keyboard_viewport = (
            entry["id"] == "chat.composer-keyboard"
            and actual_viewport.get("width") == viewport["width"]
            and isinstance(actual_viewport.get("height"), int)
            and 0 < actual_viewport["height"] < viewport["height"]
        )
        if viewport_changed and not keyboard_viewport:
            raise GateError(f"Mobile viewport changed while capturing {entry['id']}")
        captured_viewport = {
            **dict(viewport),
            "width": actual_viewport["width"],
            "height": actual_viewport["height"],
        }
        dom = session.get_webview_source()
        text_parser = _SurfaceHTMLAudit()
        text_parser.feed(dom)
        text_findings = audit_visible_text(inventory, text_parser.texts)
        if text_findings:
            raise GateError(
                f"Mobile shell contains technical visible text: {text_findings[:5]!r}"
            )

        session.switch_to_native()
        accessibility = session.get_page_source()
        audit_accessibility_tree(accessibility)
        screenshot = session.screenshot_bytes()
        prefix = f"mobile-whole-product/{entry['id']}/{cell_id}"
        screenshot_ref = artifacts.write_bytes(
            f"{prefix}/screenshot.png",
            screenshot,
            media_type="image/png",
            role=f"mobile-whole-product-screenshot/{entry['id']}/{cell_id}",
        )
        dom_ref = artifacts.write_bytes(
            f"{prefix}/dom.html",
            _redacted_markup(dom),
            media_type="text/html",
            role=f"mobile-whole-product-dom/{entry['id']}/{cell_id}",
        )
        accessibility_ref = artifacts.write_bytes(
            f"{prefix}/accessibility.xml",
            _redacted_markup(accessibility),
            media_type="application/xml",
            role=f"mobile-whole-product-accessibility/{entry['id']}/{cell_id}",
        )
        interaction = {
            "artifactKind": "mobile-surface-interaction-trace",
            "gateId": self.gate_id,
            "runId": artifacts.run_id,
            "surfaceId": entry["id"],
            "cellId": cell_id,
            "entryAction": entry["entryAction"],
            "surfaceSelector": entry["surfaceSelector"],
            "expectedResult": expected_result(inventory, entry),
            "viewport": captured_viewport,
            "surfaceElement": dict(observation["surfaceElement"]),
            "uiAction": dict(action),
            "controls": list(observation["controls"]),
            "occlusions": list(observation["occlusions"]),
            "blockingSurfaces": list(observation["blockingSurfaces"]),
        }
        interaction_ref = artifacts.write_json(
            f"{prefix}/interaction.json",
            interaction,
            role=f"mobile-whole-product-interaction/{entry['id']}/{cell_id}",
        )
        self._record(
            session.client_id,
            "surface-captured",
            {"surfaceId": entry["id"], "cellId": cell_id},
        )
        return {
            "status": "PASS",
            "viewport": captured_viewport,
            "evidence": {
                "screenshot": screenshot_ref.to_dict(),
                "dom": dom_ref.to_dict(),
                "accessibility": accessibility_ref.to_dict(),
                "interactionTrace": interaction_ref.to_dict(),
            },
        }

    @staticmethod
    def _probe_simulator_foreground(device_id: str) -> dict[str, Any]:
        if os.environ.get("PT_MOBILE_FOREGROUND_REQUIRED") != "1":
            raise SimulatorGateBlocked(
                "PT_MOBILE_FOREGROUND_REQUIRED=1 is required",
                "mobile-whole-product:foreground-policy",
            )
        probe = subprocess.run(
            ["xcrun", "simctl", "list", "devices", "--json"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        try:
            payload = json.loads(probe.stdout)
            devices = payload["devices"]
            target = next(
                device
                for runtime_devices in devices.values()
                for device in runtime_devices
                if device.get("udid") == device_id
            )
        except (json.JSONDecodeError, KeyError, StopIteration, TypeError):
            target = None
        if probe.returncode != 0 or target is None or target.get("state") != "Booted":
            raise SimulatorGateBlocked(
                "The target iOS Simulator is not booted and visible",
                "mobile-whole-product:foreground-window",
            )
        return {
            "platform": "ios",
            "bundleIdentifier": "com.apple.iphonesimulator",
            "frontmost": True,
            "windowVisible": True,
        }


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
