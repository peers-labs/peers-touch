#!/usr/bin/env python3
"""Publish canonical evidence for the Peers Dev progress browser journey."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
    REPO_ROOT,
    load_runtime_manifest,
)


GATE_ID = "peers-dev-ui-browser-e2e"
ENVIRONMENT_ID = "peers-dev-fixture-browser"
PROFILE_ID = "dev-ui-local"
DRIVER = Path(__file__).with_name("dev-ui-browser-e2e.mjs")
SCREENSHOTS = ("desktop.png", "narrow.png")


def validate_runtime_manifest(manifest: dict[str, Any]) -> None:
    clients = manifest.get("clients")
    if (
        manifest.get("environmentId") != ENVIRONMENT_ID
        or manifest.get("profile", {}).get("resolvedName") != PROFILE_ID
        or not isinstance(clients, list)
        or len(clients) != 1
        or clients[0].get("id") != "peers-dev-fixture-browser"
        or clients[0].get("runtime") != "browser"
        or clients[0].get("renderer_port") != 4177
    ):
        raise GateError("Peers Dev Runtime Manifest is invalid")


def validate_driver_summary(
    summary: dict[str, Any],
    output_directory: Path,
) -> dict[str, Path]:
    if (
        summary.get("ok") is not True
        or summary.get("viewports") != ["1440x1000", "390x844"]
        or summary.get("disconnectFallback") != "PASS"
        or summary.get("sseRecovery") != "PASS"
        or summary.get("singletonReuse") != "PASS"
        or summary.get("unregisteredVisible") != "PASS"
        or summary.get("screenshots") != list(SCREENSHOTS)
    ):
        raise GateError("Peers Dev browser journey summary is invalid")

    screenshots = {
        Path(filename).stem: output_directory / filename
        for filename in SCREENSHOTS
    }
    for name, screenshot in screenshots.items():
        if not screenshot.is_file() or screenshot.stat().st_size <= 10_000:
            raise GateError(f"Peers Dev {name} screenshot is missing or empty")
    return screenshots


class PeersDevUiBrowserGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "DEV-J02"
    bom = ("DWF-CAN03-DEV-UI",)
    spec = ("DWF-D20", "DWF-D27")

    def _manifest(self) -> dict[str, Any]:
        value = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
        if not value:
            raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        manifest = load_runtime_manifest(Path(value), self.gate_id)
        validate_runtime_manifest(manifest)
        return manifest

    def run(self) -> dict[str, Any]:
        manifest = self._manifest()
        client = manifest["clients"][0]
        endpoint = f"http://127.0.0.1:{client['renderer_port']}"
        with tempfile.TemporaryDirectory(prefix="pt-peers-dev-ui-browser-") as temp:
            output_directory = Path(temp)
            completed = subprocess.run(
                [
                    "node",
                    str(DRIVER),
                    "--endpoint",
                    endpoint,
                    "--output",
                    str(output_directory),
                ],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
            if completed.returncode != 0:
                detail = completed.stderr.strip() or completed.stdout.strip()
                raise GateError(f"Peers Dev browser journey failed: {detail}")

            lines = [line for line in completed.stdout.splitlines() if line.strip()]
            try:
                summary = json.loads(lines[-1])
            except (IndexError, json.JSONDecodeError) as error:
                raise GateError(
                    f"Peers Dev browser journey summary is invalid: {error}"
                ) from error

            screenshots = validate_driver_summary(summary, output_directory)
            evidence = {
                name: self.report.add_evidence_file(name, screenshot)
                for name, screenshot in screenshots.items()
            }

        for assertion in (
            "desktop_and_narrow_viewports",
            "disconnect_preserves_last_snapshot",
            "sse_recovers_after_disconnect",
            "unregistered_worktree_remains_visible",
            "machine_wide_listener_is_reused",
        ):
            self.assert_condition(assertion, True)
        return {
            "environment": ENVIRONMENT_ID,
            "runtimeCell": manifest["profile"]["resolvedName"],
            "viewports": summary["viewports"],
            "disconnectFallback": summary["disconnectFallback"],
            "sseRecovery": summary["sseRecovery"],
            "singletonReuse": summary["singletonReuse"],
            "unregisteredVisible": summary["unregisteredVisible"],
            "evidence": evidence,
        }


if __name__ == "__main__":
    raise SystemExit(PeersDevUiBrowserGate().execute())
