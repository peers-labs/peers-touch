from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "tooling/scripts/review/agent-v2-old-paths.sh"


class AgentV2OldPathsTest(unittest.TestCase):
    def run_script(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(SCRIPT), *args],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_current_inventory_is_machine_readable(self) -> None:
        completed = self.run_script("--inventory-only")
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        self.assertEqual(report["artifactKind"], "agent-v2-old-path-inventory")
        self.assertGreaterEqual(len(report["entries"]), 8)
        self.assertEqual(report["unresolvedCount"], 0)
        entries = {entry["id"]: entry for entry in report["entries"]}
        self.assertEqual(
            entries["cli-profile-advertisement"]["disposition"],
            "retained-guarded-downstream",
        )
        self.assertEqual(
            entries["applet-ai-cross-domain-local-executor"]["disposition"],
            "retained-local-executor",
        )
        self.assertEqual(
            entries["applet-one-shot-synthetic-stream"]["disposition"],
            "retained-station-service",
        )
        self.assertEqual(
            entries["client-derived-diagnostic-authority"]["disposition"],
            "deleted-authority",
        )

    def test_completed_f1_closure_has_no_deleted_authority(self) -> None:
        completed = self.run_script("--closure", "C01,C02")
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        self.assertEqual(report["unresolvedCount"], 0)

    def test_f2_closures_are_registered_and_resolved(self) -> None:
        completed = self.run_script("--closure", "C03,C05,C06,C10")
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertNotIn("unknown closures", completed.stderr)
        self.assertNotIn("browser-one-shot-agent-turn", completed.stderr)
        self.assertNotIn("desktop-provider-readiness-inference", completed.stderr)
        self.assertNotIn("legacy-untyped-client-capability-session", completed.stderr)
        self.assertNotIn("shared-portability-resource-contract", completed.stderr)

    def test_unknown_closure_fails_closed(self) -> None:
        completed = self.run_script("--closure", "C99")
        self.assertEqual(completed.returncode, 1)
        self.assertIn("unknown closures", completed.stderr)

    def test_client_diagnostic_authority_blocks_c09(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy = root / "agentTurnDiagnostics.ts"
            legacy.write_text(
                "export function buildAgentTurnDiagnosticsExport() {}\n",
                encoding="utf-8",
            )
            fixture = root / "fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "schema": "agent-v2-old-paths/v1",
                        "allowed_dispositions": ["deleted-authority"],
                        "discovery": {
                            "pattern": "buildAgentTurnDiagnosticsExport",
                            "paths": [str(root)],
                        },
                        "entries": [
                            {
                                "id": "client-derived-diagnostic-authority",
                                "closures": ["C09"],
                                "disposition": "deleted-authority",
                                "pattern": "buildAgentTurnDiagnosticsExport",
                                "paths": [str(legacy)],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            completed = self.run_script(
                "--closure",
                "C09",
                "--fixture",
                str(fixture),
            )
        self.assertEqual(completed.returncode, 1)
        self.assertIn("client-derived-diagnostic-authority", completed.stderr)

    def test_invalid_disposition_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "schema": "agent-v2-old-paths/v1",
                        "allowed_dispositions": ["deleted-authority"],
                        "discovery": {
                            "pattern": "ChatStore",
                            "paths": [
                                "apps/desktop/src-tauri/src/application/chat"
                            ],
                        },
                        "entries": [
                            {
                                "id": "bad",
                                "closures": ["C01"],
                                "disposition": "unresolved",
                                "pattern": "ChatStore",
                                "paths": [
                                    "apps/desktop/src-tauri/src/application/chat"
                                ],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            completed = self.run_script(
                "--inventory-only",
                "--fixture",
                str(fixture),
            )
        self.assertEqual(completed.returncode, 1)
        self.assertIn("invalid disposition", completed.stderr)

    def test_unregistered_match_outside_declared_paths_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            declared = root / "declared.rs"
            discovered = root / "new_authority.rs"
            declared.write_text("struct Known;\n", encoding="utf-8")
            discovered.write_text("struct ChatStore;\n", encoding="utf-8")
            fixture = root / "fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "schema": "agent-v2-old-paths/v1",
                        "allowed_dispositions": ["deleted-authority"],
                        "discovery": {
                            "pattern": "ChatStore",
                            "paths": [str(root)],
                        },
                        "entries": [
                            {
                                "id": "known",
                                "closures": ["C01"],
                                "disposition": "deleted-authority",
                                "pattern": "ChatStore",
                                "paths": [str(declared)],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            completed = self.run_script(
                "--inventory-only",
                "--fixture",
                str(fixture),
            )
        self.assertEqual(completed.returncode, 1)
        self.assertIn("unregistered-legacy-path", completed.stderr)


if __name__ == "__main__":
    unittest.main()
