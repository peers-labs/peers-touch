from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.gates.mobile.three_client_product_journey_evidence import (
    REQUIRED_CLIENT_IDS,
    validate_journey_evidence,
)


class ThreeClientProductJourneyEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo_root = Path(self.temporary.name).resolve()
        self.evidence_dir = self.repo_root / "evidence"
        self.evidence_dir.mkdir()
        self.commit = "a" * 40
        self.source = {
            "canonicalWorktreeHash": "0123456789abcdef",
            "commit": self.commit,
            "workspaceDigest": "clean",
        }
        self.source_ref = {
            "head": self.commit,
            "dirty": False,
            "worktree": str(self.repo_root),
        }

    def write_file(self, name: str, value: str) -> dict[str, str]:
        path = self.evidence_dir / name
        path.write_text(value, encoding="utf-8")
        return {
            "path": str(path),
            "sha256": hashlib.sha256(value.encode()).hexdigest(),
        }

    def write_fixture(self) -> None:
        trace = []
        preflight_clients = []
        for sequence, client_id in enumerate(sorted(REQUIRED_CLIENT_IDS), start=1):
            screenshot = self.write_file(
                f"{sequence:03d}-{client_id}.png",
                f"screenshot:{client_id}",
            )
            source = self.write_file(
                f"{sequence:03d}-{client_id}.source.txt",
                f"source:{client_id}",
            )
            state_value = {"surface": "chat.direct-thread"}
            state = self.write_file(
                f"{sequence:03d}-{client_id}.state.json",
                json.dumps(state_value),
            )
            trace.append(
                {
                    "sequence": sequence,
                    "clientId": client_id,
                    "stepId": f"step-{sequence}",
                    "status": "PASS",
                    "startedAt": "2026-10-12T00:00:00.000Z",
                    "completedAt": "2026-10-12T00:00:01.000Z",
                    "result": state_value,
                    "evidence": {
                        "screenshot": screenshot,
                        "source": source,
                        "state": {**state, "value": state_value},
                    },
                }
            )
            preflight_clients.append(
                {
                    "clientId": client_id,
                    "foreground": {"visibilityState": "visible"},
                    "screenshot": screenshot,
                    "source": source,
                }
            )

        result = {
            "kind": "peers-touch-three-client-product-journey-result",
            "schemaVersion": 1,
            "phase": "chat",
            "status": "PASS",
            "source": self.source_ref,
            "stationUrl": "http://station.test",
            "scenarioIds": ["three-client-direct"],
            "interactionTrace": trace,
        }
        preflight = {
            "kind": "peers-touch-three-client-journey-preflight",
            "schemaVersion": 1,
            "phase": "chat",
            "status": "READY",
            "source": self.source_ref,
            "stationUrl": "http://station.test",
            "scenarioIds": ["three-client-direct"],
            "clients": preflight_clients,
        }
        suite_input = {
            "schemaVersion": 1,
            "kind": "peers-touch-three-client-suite-runtime-input",
            "suiteRuntimeId": "suite-1",
            "sourceDigest": self.commit,
            "fixtureEpoch": "fixture-1",
            "runtimeReuse": {},
            "events": [],
        }
        suite_runtime = {
            "artifactKind": "acceptance-suite-runtime-report",
            "result": "PASS",
            "proofState": "SUPPORTING",
        }
        for name, value in (
            ("result.json", result),
            ("preflight.json", preflight),
            ("interaction-trace.json", trace),
            ("suite-runtime-input.json", suite_input),
            ("suite-runtime.json", suite_runtime),
        ):
            (self.evidence_dir / name).write_text(
                json.dumps(value),
                encoding="utf-8",
            )

    def test_validates_exact_source_three_client_evidence(self) -> None:
        self.write_fixture()

        result = validate_journey_evidence(
            self.evidence_dir,
            "chat",
            repo_root=self.repo_root,
            current_source=self.source,
        )

        self.assertEqual(result["phase"], "chat")
        self.assertEqual(len(result["steps"]), 3)
        self.assertEqual(
            {step["clientId"] for step in result["steps"]},
            REQUIRED_CLIENT_IDS,
        )
        self.assertEqual(result["suiteRuntime"]["proofState"], "SUPPORTING")

    def test_rejects_artifact_hash_drift(self) -> None:
        self.write_fixture()
        screenshot = self.evidence_dir / "001-android-alice.png"
        screenshot.write_text("mutated", encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "sha256 does not match"):
            validate_journey_evidence(
                self.evidence_dir,
                "chat",
                repo_root=self.repo_root,
                current_source=self.source,
            )

    def test_rejects_missing_required_client(self) -> None:
        self.write_fixture()
        preflight_path = self.evidence_dir / "preflight.json"
        preflight = json.loads(preflight_path.read_text(encoding="utf-8"))
        preflight["clients"] = preflight["clients"][:-1]
        preflight_path.write_text(json.dumps(preflight), encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "required three clients"):
            validate_journey_evidence(
                self.evidence_dir,
                "chat",
                repo_root=self.repo_root,
                current_source=self.source,
            )


if __name__ == "__main__":
    unittest.main()
