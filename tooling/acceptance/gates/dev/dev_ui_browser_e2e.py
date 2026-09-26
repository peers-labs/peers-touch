#!/usr/bin/env python3
"""Prove the Peers Dev worktree ledger in a real browser runtime."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from tooling.acceptance.core import AcceptanceGate, GateError, load_runtime_manifest


GATE_ID = "dev-ui-browser-e2e"
ENVIRONMENT_ID = "dev-ui-local-browser"
ENDPOINT = "http://127.0.0.1:4177"
MAX_RESPONSE_BYTES = 1024 * 1024


def fetch_json(path: str) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{ENDPOINT}{path}",
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        raise GateError(f"Peers Dev request failed for {path}: {error}") from error
    if len(body) > MAX_RESPONSE_BYTES:
        raise GateError(f"Peers Dev response exceeds byte limit for {path}")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GateError(f"Peers Dev returned invalid JSON for {path}: {error}") from error
    if not isinstance(payload, dict):
        raise GateError(f"Peers Dev response must be an object for {path}")
    return payload


def validate_snapshot(
    snapshot: dict[str, Any],
    *,
    source_commit: str,
    workspace_id: str,
) -> dict[str, int]:
    server = snapshot.get("server")
    source = server.get("source") if isinstance(server, dict) else None
    freshness = snapshot.get("serverFreshness")
    discovery = snapshot.get("discovery")
    worktrees = snapshot.get("worktrees")
    if (
        not isinstance(source, dict)
        or source.get("workspaceId") != workspace_id
        or source.get("head") != source_commit
        or source.get("dirty") is not False
        or not isinstance(freshness, dict)
        or freshness.get("state") != "current"
        or not isinstance(discovery, dict)
        or discovery.get("error") is not None
        or not isinstance(discovery.get("count"), int)
        or not isinstance(worktrees, list)
    ):
        raise GateError("Peers Dev snapshot does not match the exact runtime source")

    current = next(
        (
            item
            for item in worktrees
            if isinstance(item, dict) and item.get("workspaceId") == workspace_id
        ),
        None,
    )
    if not isinstance(current, dict):
        raise GateError("Peers Dev snapshot omits the serving worktree")
    git = current.get("git")
    clocks = current.get("freshness")
    if (
        not isinstance(git, dict)
        or git.get("head") != source_commit
        or not isinstance(clocks, dict)
        or any(
            key not in clocks
            for key in (
                "lastReportedAt",
                "stateUpdatedAt",
                "checkedAt",
                "updatedAt",
            )
        )
    ):
        raise GateError("Peers Dev serving row lacks source or freshness fields")

    encoded = json.dumps(snapshot, sort_keys=True)
    if any(token in encoded for token in ("/Users/", ".peers-touch", "canonicalRoot")):
        raise GateError("Peers Dev public snapshot exposes a private machine path")
    return {
        "discoveredWorktrees": discovery["count"],
        "renderedWorktreeRows": len(worktrees),
    }


def count_refresh_requests(har_path: Path) -> int:
    try:
        har = json.loads(har_path.read_text(encoding="utf-8"))
        entries = har["log"]["entries"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise GateError(f"Playwright HAR is invalid: {error}") from error
    return sum(
        1
        for entry in entries
        if isinstance(entry, dict)
        and str(entry.get("request", {}).get("url", "")).endswith(
            ("/api/status", "/api/events")
        )
        and entry.get("response", {}).get("status") == 200
    )


class DevUiBrowserGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "DUI-J01"
    bom = ("DWF-DEV-UI-OBSERVABILITY",)
    spec = ("LDCP-D15",)

    def _manifest(self) -> dict[str, Any]:
        value = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
        if not value:
            raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        manifest = load_runtime_manifest(Path(value), self.gate_id)
        clients = manifest.get("clients")
        if (
            manifest.get("environmentId") != ENVIRONMENT_ID
            or manifest.get("profile", {}).get("resolvedName") != "dev-ui-local"
            or not isinstance(clients, list)
            or len(clients) != 1
            or clients[0].get("runtime") != "browser"
        ):
            raise GateError("Dev UI Runtime Manifest is invalid")
        return manifest

    def _capture(
        self,
        playwright: str,
        *,
        viewport: str,
        output: Path,
        wait_ms: int,
        har: Path | None = None,
    ) -> None:
        command = [
            playwright,
            "screenshot",
            "--browser",
            "chromium",
            "--viewport-size",
            viewport,
            "--wait-for-selector",
            "#worktree-list .worktree-band",
            "--wait-for-timeout",
            str(wait_ms),
            "--full-page",
        ]
        if har is not None:
            command.extend(["--save-har", str(har)])
        command.extend([f"{ENDPOINT}/", str(output)])
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if completed.returncode != 0 or not output.is_file():
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise GateError(f"Playwright capture failed: {detail}")

    def run(self) -> dict[str, Any]:
        manifest = self._manifest()
        source = manifest["source"]
        before = fetch_json("/api/status")
        counts = validate_snapshot(
            before,
            source_commit=source["commit"],
            workspace_id=before["server"]["source"]["workspaceId"],
        )
        playwright = shutil.which("playwright")
        if playwright is None:
            raise GateError("playwright CLI is required")

        with tempfile.TemporaryDirectory(prefix="pt-dev-ui-browser-") as temp:
            root = Path(temp)
            desktop = root / "desktop.png"
            mobile = root / "mobile.png"
            har = root / "desktop.har"
            self._capture(
                playwright,
                viewport="1440,900",
                output=desktop,
                wait_ms=16_500,
                har=har,
            )
            self._capture(
                playwright,
                viewport="390,844",
                output=mobile,
                wait_ms=1_000,
            )
            refresh_requests = count_refresh_requests(har)
            self.assert_condition(
                "browser_auto_refresh",
                refresh_requests >= 1,
                f"observed {refresh_requests} successful refresh transports",
            )
            self.assert_condition(
                "desktop_render_nonempty",
                desktop.stat().st_size > 10_000,
            )
            self.assert_condition(
                "mobile_render_nonempty",
                mobile.stat().st_size > 10_000,
            )
            desktop_ref = self.report.add_evidence_file(
                "desktop",
                desktop,
            )
            mobile_ref = self.report.add_evidence_file(
                "mobile",
                mobile,
            )

        after = fetch_json("/api/status")
        validate_snapshot(
            after,
            source_commit=source["commit"],
            workspace_id=before["server"]["source"]["workspaceId"],
        )
        self.assert_condition(
            "checked_time_advanced",
            after["discovery"]["checkedAt"] > before["discovery"]["checkedAt"],
        )
        self.assert_condition(
            "all_discovered_worktrees_visible",
            counts["renderedWorktreeRows"] >= counts["discoveredWorktrees"],
        )
        return {
            "environment": ENVIRONMENT_ID,
            "runtimeCell": "dev-ui-local",
            "endpoint": ENDPOINT,
            **counts,
            "refreshRequests": refresh_requests,
            "evidence": {
                "desktop": desktop_ref,
                "mobile": mobile_ref,
            },
        }


def main() -> int:
    return DevUiBrowserGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
