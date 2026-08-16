#!/usr/bin/env python3
"""End-to-end Core Runtime validation using ChromeDriver against a local HTML page.

This gate proves the Core abstraction works end-to-end without requiring Tauri:
- ChromeDriver lifecycle (start/stop/find/screenshot)
- AcceptanceGate.execute() flow (pass + evidence collection + cleanup)
- EvidenceReport JSON schema compliance
- Assertion framework
- Automatic driver cleanup
"""

from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import AcceptanceGate, ActorRuntime, REPORTS_DIR
from tooling.acceptance.core.redaction import REDACTED
from tooling.acceptance.drivers import ChromeDriver


TEST_HTML = """<!DOCTYPE html>
<html>
<head><title>Acceptance Core Validation</title></head>
<body>
  <div id="root">
    <h1 data-pt-test="title">Peers Touch Acceptance Framework</h1>
    <button data-pt-test="action" onclick="document.getElementById('result').textContent='clicked'">Click Me</button>
    <div id="result">initial</div>
    <div id="sensitive">password=dom-secret Authorization: Bearer dom-token</div>
  </div>
  <script>
    window.__PT_ACCEPTANCE__ = {
      core: {
        async ping(payload) {
          return { pong: true, echo: payload, timestamp: Date.now() };
        }
      }
    };
  </script>
</body>
</html>
"""


class CoreValidationGate(AcceptanceGate):
    gate_id = "core-runtime-validation"

    def __init__(self, html_path: Path):
        super().__init__()
        self.html_path = html_path
        self.report_path = REPORTS_DIR / "core-runtime-validation.json"
        self.chrome = ChromeDriver(headless=True, width=1280, height=800)
        self.register_driver(self.chrome)

    def run(self) -> dict[str, Any]:
        self.chrome.start()
        self.report.add_actor(
            ActorRuntime(
                name="chrome",
                runtime="headless-chrome",
                profile="core-validation",
            )
        )
        self.report.runtime["api_token"] = "runtime-secret"
        self.chrome.navigate(f"file://{self.html_path}")
        self.chrome.wait_for_ready(timeout=10)

        title = self.chrome.execute_script("return document.title")
        self.assert_condition("page_title_correct", title == "Acceptance Core Validation", f"got={title}")

        h1 = self.chrome.find_element('[data-pt-test="title"]', timeout=5)
        self.assert_condition("title_visible", "Peers Touch" in h1.text, f"h1={h1.text}")

        root = self.chrome.execute_script("return Boolean(document.querySelector('#root'))")
        self.assert_condition("root_mounted", root is True)

        harness_loaded = self.chrome.execute_script(
            "return Boolean(window.__PT_ACCEPTANCE__ && window.__PT_ACCEPTANCE__.core)"
        )
        self.assert_condition("namespaced_harness_mounted", harness_loaded is True)

        pong = self.harness(self.chrome, "ping", {"msg": "hello"}, namespace="core", timeout=5)
        self.assert_condition("harness_ping_pong", pong is not None and pong.get("pong") is True, f"pong={pong}")
        self.assert_condition("harness_echo_correct", pong.get("echo", {}).get("msg") == "hello")

        btn = self.chrome.find_element('[data-pt-test="action"]', timeout=5)
        btn.click()
        time.sleep(0.3)
        result_text = self.chrome.execute_script(
            "return document.getElementById('result').textContent"
        )
        self.assert_condition("click_interaction_works", result_text == "clicked", f"result={result_text}")

        self.save_screenshot(self.chrome, "final-state")
        self.save_dom(self.chrome, "final-state")

        page_source_len = len(self.chrome.get_page_source())
        current_url = self.chrome.get_current_url()
        self.assert_condition("page_source_nonempty", page_source_len > 200, f"len={page_source_len}")

        return {
            "validation_target": "chrome-local-file",
            "page_title": title,
            "current_url": current_url,
            "page_source_length": page_source_len,
            "harness_ping_latency_ms": 0,
        }


def main() -> int:
    print("=" * 60)
    print("Core Runtime End-to-End Validation")
    print("=" * 60)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".html", delete=False, encoding="utf-8") as f:
        f.write(TEST_HTML)
        html_path = Path(f.name)

    try:
        gate = CoreValidationGate(html_path)
        rc = gate.execute()

        print(f"\nReturn code: {rc}")
        print(f"Report path: {gate.report_path}")

        if rc != 0:
            print("VALIDATION FAILED")
            return 1

        report = json.loads(gate.report_path.read_text(encoding="utf-8"))

        print("\nReport contents:")
        print(f"  gate: {report['gate']}")
        print(f"  status: {report['status']}")
        print(f"  duration_ms: {report['duration_ms']}")
        print(f"  assertions: {len(report['assertions'])} total")
        passed = sum(1 for a in report["assertions"] if a["passed"])
        failed = sum(1 for a in report["assertions"] if not a["passed"])
        print(f"    passed: {passed}, failed: {failed}")
        print(f"  evidence keys: {list(report['evidence'].keys())}")
        print(f"  error: {report['error']}")
        print(f"  actors: {list(report['actors'].keys())}")

        schema_ok = True
        required_fields = {"gate", "status", "started_at", "duration_ms", "runtime",
                           "actors", "assertions", "evidence", "error"}
        missing = required_fields - report.keys()
        if missing:
            print(f"\nSCHEMA ERROR: missing fields {missing}")
            schema_ok = False
        if report["actors"].get("chrome", {}).get("runtime") != "headless-chrome":
            print("\nACTOR ERROR: actor runtime was not serialized")
            schema_ok = False
        if report["runtime"].get("api_token") != REDACTED:
            print("\nREDACTION ERROR: structured runtime secret was not redacted")
            schema_ok = False

        for key, path in report["evidence"].items():
            full_path = REPO_ROOT / path
            if not full_path.exists():
                print(f"\nEVIDENCE ERROR: {key} file not found at {full_path}")
                schema_ok = False
            else:
                size = full_path.stat().st_size
                print(f"  evidence {key}: {path} ({size} bytes)")
                if full_path.suffix in {".html", ".json", ".log", ".md", ".txt"}:
                    evidence_text = full_path.read_text(encoding="utf-8")
                    if "dom-secret" in evidence_text or "dom-token" in evidence_text:
                        print(f"\nREDACTION ERROR: {key} contains a raw secret")
                        schema_ok = False

        if failed > 0:
            failed_names = [a["name"] for a in report["assertions"] if not a["passed"]]
            print(f"\nASSERTION FAILURES: {failed_names}")
            return 1

        if not schema_ok:
            print("\nSCHEMA VALIDATION FAILED")
            return 1

        driver_stopped = not gate.chrome.is_alive()
        print(f"\nDriver cleanup verified: is_alive={gate.chrome.is_alive()} (expected False)")
        if not driver_stopped:
            print("CLEANUP ERROR: ChromeDriver still alive after gate execute()")
            return 1

        print("\n" + "=" * 60)
        print("ALL CORE RUNTIME VALIDATIONS PASSED")
        print("=" * 60)
        return 0
    finally:
        html_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
