#!/usr/bin/env python3
"""Generate fail-closed Desktop browser runtime sampling preflight evidence."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ARTIFACT_KIND = "desktop-performance-browser-preflight"
PHASE = "P0b-2/P0b-7/P0c-5"
BOM = ["BOM-CON-02", "BOM-SMP-06", "BOM-GATE-03"]
SPEC = ["SPEC-INT-01", "SPEC-SMP-MAIN-01", "SPEC-GATE-03"]
GATE = "Browser-gateway runtime samples may be emitted only from a clean ready shell without blocking UI overlays"
DEFAULT_OUTPUT = "tooling/acceptance/reports/desktop-performance-browser-preflight.json"

REQUIRED_ANCHORS = ("primary", "context")
BLOCKING_TEXT_PATTERNS = (
    "Cancel\nFinish",
    "Choose Account",
    "Welcome back",
    "Session expired",
    "Session ended",
)

SNAPSHOT_EXPRESSION = r"""
(() => {
  const rectOf = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const isVisibleTextOwner = (element) => {
    for (let current = element; current && current.nodeType === Node.ELEMENT_NODE; current = current.parentElement) {
      const style = window.getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        Number(style.opacity) === 0 ||
        style.pointerEvents === "none"
      ) {
        return false;
      }
    }
    return true;
  };
  const visibleTextParts = [];
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (visibleTextParts.length < 400) {
      const node = walker.nextNode();
      if (!node) break;
      const value = (node.nodeValue || "").trim();
      const owner = node.parentElement;
      if (!value || !owner || !isVisibleTextOwner(owner)) continue;
      visibleTextParts.push(value);
    }
  }
  return {
    href: window.location.href,
    text: document.body ? document.body.innerText.slice(0, 4000) : "",
    visibleText: visibleTextParts.join("\n").slice(0, 4000),
    anchors: {
      primary: document.querySelectorAll("[data-pt-primary-nav]").length,
      secondary: document.querySelectorAll("[data-pt-secondary-tab]").length,
      section: document.querySelectorAll("[data-pt-section-item]").length,
      host: document.querySelectorAll("[data-pt-section-host]").length,
      context: document.querySelectorAll("[data-pt-context-menu-trigger]").length
    },
    buttons: Array.from(document.querySelectorAll("button,[role='button']"))
      .map((element) => ({
        text: (element.innerText || element.textContent || "").trim(),
        role: element.getAttribute("role"),
        ariaLabel: element.getAttribute("aria-label"),
        rect: rectOf(element)
      }))
      .filter((item) => item.text || item.ariaLabel)
      .slice(0, 80),
    eventCount: window.__PT_FRONTEND_TELEMETRY__?.getEvents?.().length ?? null
  };
})()
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_snapshot(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_cdp_helpers() -> Any:
    script = Path(__file__).parents[1] / "acceptance" / "gates" / "dashboard" / "federation_visible_surface.py"
    spec = importlib.util.spec_from_file_location("desktop_performance_cdp_helpers", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load CDP helpers from {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def first_page_websocket_url(host: str, port: int, target_url: str | None = None) -> str:
    with urllib.request.urlopen(f"http://{host}:{port}/json", timeout=5) as response:
        pages = json.loads(response.read().decode("utf-8"))
    if not isinstance(pages, list):
        raise RuntimeError(f"CDP /json endpoint did not return a page list: {type(pages).__name__}")
    page_targets: list[dict[str, Any]] = []
    for page in pages:
        if not (isinstance(page, dict) and page.get("type") == "page" and page.get("webSocketDebuggerUrl")):
            continue
        page_targets.append(page)
        if target_url and target_url in str(page.get("url") or ""):
            return str(page["webSocketDebuggerUrl"])
    if target_url:
        urls = [str(page.get("url") or "") for page in page_targets]
        raise RuntimeError(f"CDP endpoint has no page target matching {target_url!r}; page targets: {urls}")
    if page_targets:
        return str(page_targets[0]["webSocketDebuggerUrl"])
    raise RuntimeError("CDP endpoint has no page target")


def evaluate_snapshot_from_cdp(host: str, port: int, wait_seconds: float, target_url: str | None) -> dict[str, Any]:
    helpers = load_cdp_helpers()
    deadline = time.time() + max(0.0, wait_seconds)
    last_error: Exception | None = None
    while True:
        session = None
        try:
            session = helpers.CDPSession(first_page_websocket_url(host, port, target_url))
            session.send("Runtime.enable")
            result = session.send("Runtime.evaluate", {"expression": SNAPSHOT_EXPRESSION, "returnByValue": True})
            value = result.get("result", {}).get("value")
            if not isinstance(value, dict):
                raise RuntimeError(f"CDP snapshot expression returned {type(value).__name__}")
            return value
        except Exception as error:  # noqa: BLE001 - convert CDP failures into fail-closed artifacts in main.
            last_error = error
            if time.time() >= deadline:
                raise RuntimeError(f"failed to collect browser runtime snapshot from CDP: {last_error}") from error
            time.sleep(0.4)
        finally:
            if session is not None:
                session.close()


def normalize_snapshot(raw: dict[str, Any]) -> dict[str, Any]:
    anchors = raw.get("anchors") if isinstance(raw.get("anchors"), dict) else {}
    buttons = raw.get("buttons") if isinstance(raw.get("buttons"), list) else []
    text = raw.get("text") if isinstance(raw.get("text"), str) else ""
    visible_text = raw.get("visibleText") if isinstance(raw.get("visibleText"), str) else ""
    return {
        "url": raw.get("url") or raw.get("href"),
        "text": text,
        "visibleText": visible_text,
        "anchors": anchors,
        "buttons": buttons,
        "eventCount": raw.get("eventCount") if isinstance(raw.get("eventCount"), int) else raw.get("events"),
    }


def anchor_count(snapshot: dict[str, Any], anchor: str) -> int:
    value = snapshot.get("anchors", {}).get(anchor)
    return value if isinstance(value, int) else 0


def visible_button_labels(snapshot: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    for item in snapshot.get("buttons", []):
        if isinstance(item, str):
            label = item.strip()
        elif isinstance(item, dict):
            label = str(item.get("text") or "").strip()
        else:
            continue
        if label:
            labels.append(label)
    return labels


def detect_blocking_ui(snapshot: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    text = str(snapshot.get("visibleText") or snapshot.get("text") or "")
    for pattern in BLOCKING_TEXT_PATTERNS:
        if pattern in text:
            reasons.append(f"visible text contains blocking pattern: {pattern!r}")
    return reasons


def evaluate_snapshot(raw: dict[str, Any], source_artifact: str) -> dict[str, Any]:
    snapshot = normalize_snapshot(raw)
    missing_anchors = [anchor for anchor in REQUIRED_ANCHORS if anchor_count(snapshot, anchor) <= 0]
    blocking_reasons = detect_blocking_ui(snapshot)
    issues: list[dict[str, Any]] = []
    for anchor in missing_anchors:
        issues.append(
            {
                "category": "browser-runtime-preflight",
                "failedStep": f"browser-anchor:{anchor}",
                "status": "diagnostic incomplete",
                "completionStatus": "PARTIAL",
                "proofStatus": "UNPROVEN",
                "sampleEmissionAllowed": False,
                "summary": f"required browser runtime anchor is missing: {anchor}",
                "sourceArtifact": source_artifact,
                "sourceArtifactKind": ARTIFACT_KIND,
                "sourcePhase": PHASE,
                "sourceBom": BOM,
                "sourceSpec": SPEC,
                "sourceGate": GATE,
            }
        )
    for index, reason in enumerate(blocking_reasons):
        issues.append(
            {
                "category": "browser-runtime-preflight",
                "failedStep": f"browser-blocking-ui:{index + 1}",
                "status": "diagnostic incomplete",
                "completionStatus": "PARTIAL",
                "proofStatus": "UNPROVEN",
                "sampleEmissionAllowed": False,
                "summary": reason,
                "sourceArtifact": source_artifact,
                "sourceArtifactKind": ARTIFACT_KIND,
                "sourcePhase": PHASE,
                "sourceBom": BOM,
                "sourceSpec": SPEC,
                "sourceGate": GATE,
            }
        )
    proven = not issues
    report = {
        "schemaVersion": 1,
        "artifactKind": ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": "pass" if proven else "baseline preflight failure",
        "completionStatus": "DONE" if proven else "PARTIAL",
        "proofStatus": "PROVEN" if proven else "UNPROVEN",
        "sampleEmissionAllowed": proven,
        "phase": PHASE,
        "bom": BOM,
        "spec": SPEC,
        "gate": GATE,
        "snapshot": snapshot,
        "details": [
            {
                "step": issue["failedStep"],
                "status": "fail",
                "reason": issue["summary"],
            }
            for issue in issues
        ],
        "issue_breakdown": issues,
        "issueBreakdown": issues,
        "summary": {
            "status": "pass" if proven else "baseline preflight failure",
            "completionStatus": "DONE" if proven else "PARTIAL",
            "proofStatus": "PROVEN" if proven else "UNPROVEN",
            "sampleEmissionAllowed": proven,
            "missingAnchors": missing_anchors,
            "blockingReasonCount": len(blocking_reasons),
        },
        "recommended_review_commands": [
            {
                "purpose": "Inspect browser runtime preflight evidence.",
                "command": f"jq '{{status,proofStatus,summary,details}}' {source_artifact}",
            },
            {
                "purpose": "Re-run the full Phase 0 bundle after a clean runtime sample is uploaded.",
                "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
            },
        ],
    }
    report["recommendedReviewCommands"] = report["recommended_review_commands"]
    if issues:
        report["failedStep"] = issues[0]["failedStep"]
        report["reason"] = issues[0]["summary"]
    return report


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--snapshot", help="JSON snapshot captured from the browser runtime")
    source.add_argument("--cdp-port", type=int, help="Chrome DevTools Protocol port for an already-running browser")
    parser.add_argument("--cdp-host", default="127.0.0.1")
    parser.add_argument("--target-url", help="Required substring for selecting the CDP page target")
    parser.add_argument("--wait-seconds", type=float, default=8.0)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    output = Path(args.output)
    if args.snapshot:
        raw_snapshot = load_snapshot(Path(args.snapshot))
    else:
        raw_snapshot = evaluate_snapshot_from_cdp(args.cdp_host, args.cdp_port, args.wait_seconds, args.target_url)
    report = evaluate_snapshot(raw_snapshot, str(output))
    write_report(output, report)
    print(f"desktop browser performance preflight: {output}")
    print(f"status: {report['status']}")
    return 0 if report["proofStatus"] == "PROVEN" else 1


if __name__ == "__main__":
    raise SystemExit(main())
