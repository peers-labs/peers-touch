from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import native_visible_e2e as gate  # noqa: E402
import native_visible_runner as runner  # noqa: E402


class NativeVisibleEvidenceTest(unittest.TestCase):
    def report(self, journey: str) -> dict[str, Any]:
        count = {"two-client": 2, "multi-device": 3, "recovery": 2, "group-mls": 3}[journey]
        names = {
            "two-client": ["alice", "bob"],
            "multi-device": ["alice", "bob1", "bob2"],
            "recovery": ["alice", "bob"],
            "group-mls": ["alice", "bob", "charlie"],
        }[journey]
        assertions: list[dict[str, Any]] = []
        if journey == "two-client":
            assertions = [
                {"id": "alice.to.bob", "status": "pass"},
                {"id": "bob.to.alice", "status": "pass"},
            ]
        elif journey == "multi-device":
            assertions = [{
                "id": "alice.to.bob1.bob2",
                "status": "pass",
                "receivers": [
                    {"client": "bob1", "messageUlid": "message-1"},
                    {"client": "bob2", "messageUlid": "message-1"},
                ],
            }]
        elif journey == "recovery":
            assertions = [
                {"id": "alice.to.bob", "status": "pass"},
                {"id": "reinstall.restore", "status": "pass"},
            ]
        else:
            assertions = [{"id": "group.mls.add-send-remove", "status": "pass"}]
        steps = [
            {
                "step": step,
                "client": names[index % count],
                "status": "pass",
                "startedAt": "2026-08-08T00:00:00+00:00",
                "finishedAt": "2026-08-08T00:00:01+00:00",
                "timeoutMs": 60_000,
                "durationMs": 1,
            }
            for index, step in enumerate(sorted(gate.REQUIRED_STEPS))
        ]
        return {
            "artifactKind": f"chat-native-{journey}-run",
            "producer": "chat-native-visible-runner",
            "automated": True,
            "runtime": "visible-native-desktop",
            "status": "pass",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "sampleEmissionAllowed": False,
            "dryRun": False,
            "apiOnly": False,
            "browserOnly": False,
            "capturedAt": "2026-08-08T00:00:00+00:00",
            "failure": "",
            "failureDiagnostics": [],
            "launchOrder": names,
            "station": {
                "url": "http://station",
                "commit": "commit-a",
                "workspaceDigest": "clean",
                "protoDigest": "proto-a",
                "attestation": "/tmp/attestation.json",
                "live": {"build_commit": "commit-a"},
            },
            "clients": [
                {
                    "name": name,
                    "ptid": f"ptid:{'bob' if name.startswith('bob') else name}",
                    "deviceId": f"device-{index}",
                    "profile": f"profile-{index}",
                    "gatewayPort": 3300 + index,
                    "rendererPort": 3500 + index,
                    "storageRoot": f"/tmp/storage-{index}",
                    "observerSocket": f"/tmp/observer-{index}.sock",
                    "commit": "commit-a",
                    "workspaceDigest": f"workspace-{index}",
                    "protoDigest": "proto-a",
                }
                for index, name in enumerate(names)
            ],
            "steps": steps,
            "assertions": assertions,
        }

    def test_accepts_all_complete_journey_shapes(self) -> None:
        for journey in runner.REPORT_NAMES:
            with self.subTest(journey=journey):
                gate.validate_report(self.report(journey), journey)

    def test_rejects_partial_stale_or_unbounded_evidence(self) -> None:
        mutations = (
            ("status", "failed", "source report must pass"),
            ("completionStatus", "PARTIAL", "must be complete"),
            ("proofStatus", "UNPROVEN", "must be proven"),
        )
        for field, value, error in mutations:
            report = self.report("two-client")
            report[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(gate.GateError, error):
                gate.validate_report(report, "two-client")
        report = self.report("two-client")
        report["steps"][0]["timeoutMs"] = 0
        with self.assertRaisesRegex(gate.GateError, "bounded timeout"):
            gate.validate_report(report, "two-client")

    def test_rejects_missing_source_identity_or_isolation(self) -> None:
        report = self.report("multi-device")
        report["station"]["workspaceDigest"] = "dirty"
        with self.assertRaisesRegex(gate.GateError, "dirty Station"):
            gate.validate_report(report, "multi-device")
        report = self.report("multi-device")
        report["clients"][1]["protoDigest"] = "other"
        with self.assertRaisesRegex(gate.GateError, "proto digests"):
            gate.validate_report(report, "multi-device")
        report = self.report("multi-device")
        report["clients"][1]["observerSocket"] = report["clients"][0]["observerSocket"]
        with self.assertRaisesRegex(gate.GateError, "distinct observerSocket"):
            gate.validate_report(report, "multi-device")

    def test_rejects_missing_steps_and_incomplete_multi_device_delivery(self) -> None:
        report = self.report("two-client")
        report["steps"] = [
            step for step in report["steps"] if step["step"] != "observer.ready"
        ]
        with self.assertRaisesRegex(gate.GateError, "observer.ready"):
            gate.validate_report(report, "two-client")
        report = self.report("multi-device")
        report["assertions"][0]["receivers"] = report["assertions"][0]["receivers"][:1]
        with self.assertRaisesRegex(gate.GateError, "both devices"):
            gate.validate_report(report, "multi-device")


class ComposerCleanupTest(unittest.TestCase):
    def test_failed_submission_clears_injected_composer_text(self) -> None:
        class Observer:
            def __init__(self) -> None:
                self.fills: list[str] = []

            def fill(self, selector: str, text: str, timeout: float = 0) -> None:
                self.fills.append(text)

            def click(self, selector: str, timeout: float = 0) -> None:
                raise runner.JourneyError("send failed")

        client = object.__new__(runner.NativeClient)
        client.observer = Observer()
        client.spec = runner.ClientSpec("alice", "alice@p.t", "ptid:alice", Path("."), 0)
        with self.assertRaisesRegex(runner.JourneyError, "send failed"):
            client.send_text("injected text")
        self.assertEqual(client.observer.fills, ["injected text", ""])


if __name__ == "__main__":
    unittest.main()
