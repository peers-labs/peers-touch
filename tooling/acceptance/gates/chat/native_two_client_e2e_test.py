from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch


def load_module() -> Any:
    path = Path(__file__).with_name("native_two_client_e2e.py")
    spec = importlib.util.spec_from_file_location("native_two_client_e2e", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NativeTwoClientEvidenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def valid_report(self) -> dict[str, Any]:
        evidence: dict[str, str] = {}
        for actor in ("alice", "bob"):
            for suffix in ("screenshot", "dom", "app-log"):
                path = self.root / f"{actor}-{suffix}.txt"
                path.write_text("evidence", encoding="utf-8")
                evidence[f"{actor}-{suffix}"] = str(path)
        return {
            "gate": "chat-native-two-client-e2e",
            "status": "PASS",
            "station_url": "http://station",
            "runtime": {
                "runtimeCell": "native-tauri-embedded-webdriver",
                "journey": "direct-delivered-receipt",
                "testedCommit": "commit-a",
                "testedWorkspaceDigest": "workspace-a",
                "stationLive": {"build_commit": "commit-a"},
                "steps": [
                    {"step": step, "status": "pass"}
                    for step in sorted(self.module.REQUIRED_STEPS)
                ],
            },
            "actors": {
                "alice": {
                    "name": "alice",
                    "runtime": "native-tauri-embedded-webdriver",
                    "port": 4445,
                    "gateway_port": 3030,
                    "profile": "alice",
                    "storage_root": "/tmp/alice",
                    "pid": 100,
                },
                "bob": {
                    "name": "bob",
                    "runtime": "native-tauri-embedded-webdriver",
                    "port": 4446,
                    "gateway_port": 3031,
                    "profile": "bob",
                    "storage_root": "/tmp/bob",
                    "pid": 101,
                },
            },
            "assertions": [
                {"name": name, "passed": True, "detail": ""}
                for name in sorted(self.module.REQUIRED_ASSERTIONS)
            ],
            "evidence": evidence,
        }

    def test_accepts_current_isolated_native_report(self) -> None:
        report = self.valid_report()
        with (
            patch.object(self.module, "current_commit", return_value="commit-a"),
            patch.object(
                self.module,
                "current_workspace_digest",
                return_value="workspace-a",
            ),
        ):
            self.module.validate_report(report)

    def test_rejects_stale_or_non_native_report(self) -> None:
        report = self.valid_report()
        report["runtime"]["runtimeCell"] = "browser"
        with self.assertRaisesRegex(self.module.GateError, "runtime cell"):
            self.module.validate_report(report)
        report = self.valid_report()
        with (
            patch.object(self.module, "current_commit", return_value="commit-b"),
            patch.object(
                self.module,
                "current_workspace_digest",
                return_value="workspace-a",
            ),
            self.assertRaisesRegex(self.module.GateError, "commit is stale"),
        ):
            self.module.validate_report(report)

    def test_rejects_shared_actor_resources_and_missing_receipt(self) -> None:
        report = self.valid_report()
        report["actors"]["bob"]["storage_root"] = "/tmp/alice"
        with (
            patch.object(self.module, "current_commit", return_value="commit-a"),
            patch.object(
                self.module,
                "current_workspace_digest",
                return_value="workspace-a",
            ),
            self.assertRaisesRegex(self.module.GateError, "distinct storage_root"),
        ):
            self.module.validate_report(report)
        report = self.valid_report()
        report["assertions"] = [
            assertion
            for assertion in report["assertions"]
            if assertion["name"] != "alice_to_bob_delivered"
        ]
        with (
            patch.object(self.module, "current_commit", return_value="commit-a"),
            patch.object(
                self.module,
                "current_workspace_digest",
                return_value="workspace-a",
            ),
            self.assertRaisesRegex(self.module.GateError, "required assertions"),
        ):
            self.module.validate_report(report)


if __name__ == "__main__":
    unittest.main()
