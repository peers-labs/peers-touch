from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import native_visible_e2e as gate  # noqa: E402
import native_visible_runner as runner  # noqa: E402
from tooling.acceptance.core.errors import EvidenceRootForbidden  # noqa: E402


class ActorCredentialReferenceTest(unittest.TestCase):
    def test_resolves_the_actor_manifest_credential(self) -> None:
        with patch.dict(
            runner.os.environ,
            {"CHAT_LOGIN_SECRET": "runtime-only-value"},
            clear=True,
        ):
            credential = runner.resolve_actor_credential(
                {"credentialRefs": ["env:CHAT_LOGIN_SECRET"]}
            )

        self.assertEqual(credential, "runtime-only-value")

    def test_rejects_ambiguous_or_unresolved_actor_credentials(self) -> None:
        invalid = (
            ({}, "exactly one"),
            (
                {"credentialRefs": ["env:ONE", "env:TWO"]},
                "exactly one",
            ),
            ({"credentialRefs": ["file:/tmp/secret"]}, "env: source"),
            ({"credentialRefs": ["env:MISSING"]}, "unresolved"),
        )
        with patch.dict(runner.os.environ, {}, clear=True):
            for manifest, message in invalid:
                with self.subTest(manifest=manifest):
                    with self.assertRaisesRegex(
                        runner.JourneyError,
                        message,
                    ):
                        runner.resolve_actor_credential(manifest)


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
            "phase": "W8",
            "bom": [f"CHAT-NATIVE-{journey.upper()}"],
            "spec": ["chat-native-visible-clients"],
            "gate": f"chat-native-{journey}-e2e",
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
            "runtimeManifest": {
                "path": "/tmp/runtime-manifest.json",
                "runId": "run-1",
                "state": "FIXTURE_READY",
            },
            "station": {
                "url": "http://station",
                "commit": "commit-a",
                "workspaceDigest": "clean",
                "protoDigest": "proto-a",
                "attestation": {
                    "artifactKind": "acceptance-artifact-ref",
                    "workspaceId": "0123456789abcdef",
                    "gateId": f"chat-native-{journey}-e2e",
                    "runId": (
                        "20260808T000000000000Z-"
                        "0123456789abcdef0123456789abcdef"
                    ),
                    "path": "runtime/station-attestation.json",
                    "sha256": "0" * 64,
                    "mediaType": "application/json",
                },
                "live": {"build_commit": "commit-a"},
                "finalLive": {"build_commit": "commit-a"},
                "sourceStable": True,
            },
            "clients": [
                {
                    "name": name,
                    "ptid": f"ptid:{'bob' if name.startswith('bob') else name}",
                    "deviceId": f"device-{index}",
                    "profile": f"profile-{index}",
                    "gatewayPort": 3300 + index,
                    "rendererPort": 3500 + index,
                    "webdriverPort": 4400 + index,
                    "storageRoot": f"/tmp/storage-{index}",
                    "commit": "commit-a",
                    "workspaceDigest": f"workspace-{index}",
                    "protoDigest": "proto-a",
                }
                for index, name in enumerate(names)
            ],
            "cleanup": {
                "status": "pass",
                "storageReleased": True,
                "failures": [],
                "clients": [
                    {
                        "client": name,
                        "ports": {
                            "gateway": {
                                "port": 3300 + index,
                                "released": True,
                            },
                            "renderer": {
                                "port": 3500 + index,
                                "released": True,
                            },
                            "webdriver": {
                                "port": 4400 + index,
                                "released": True,
                            },
                        },
                    }
                    for index, name in enumerate(names)
                ],
            },
            "steps": steps,
            "assertions": assertions,
        }

    def test_accepts_all_complete_journey_shapes(self) -> None:
        for journey in runner.REPORT_NAMES:
            with self.subTest(journey=journey):
                gate.validate_report(self.report(journey), journey)

    def test_rejects_explicit_output_inside_repository(self) -> None:
        arguments = [
            "native_visible_e2e.py",
            "--journey",
            "two-client",
            "--source",
            "/missing/source.json",
            "--output",
            str(gate.REPO_ROOT / "tooling/forbidden.json"),
        ]
        with patch.object(sys, "argv", arguments), self.assertRaises(
            EvidenceRootForbidden
        ):
            gate.main()

    def test_accepts_short_live_commit_for_full_attestation(self) -> None:
        report = self.report("two-client")
        full_commit = "e09ac01b59f4956d901c8edc9420d48339599fc3"
        report["station"]["commit"] = full_commit
        report["station"]["live"]["build_commit"] = full_commit[:12]
        report["station"]["finalLive"]["build_commit"] = full_commit[:12]
        for client in report["clients"]:
            client["commit"] = full_commit
        gate.validate_report(report, "two-client")
        self.assertFalse(runner.commits_match("e09", full_commit))

    def test_rejects_station_source_drift_during_gate(self) -> None:
        report = self.report("two-client")
        report["station"]["sourceStable"] = False
        report["station"]["finalLive"]["build_commit"] = "other-commit"
        with self.assertRaisesRegex(gate.GateError, "source changed during Gate"):
            gate.validate_report(report, "two-client")

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
        report = self.report("two-client")
        report["steps"][0]["timeoutMs"] = gate.MAX_STEP_TIMEOUT_MS + 1
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
        report["clients"][1]["webdriverPort"] = report["clients"][0]["webdriverPort"]
        with self.assertRaisesRegex(gate.GateError, "distinct webdriverPort"):
            gate.validate_report(report, "multi-device")
        report = self.report("two-client")
        report["cleanup"]["clients"][0]["ports"]["gateway"]["released"] = False
        with self.assertRaisesRegex(gate.GateError, "gateway port must be released"):
            gate.validate_report(report, "two-client")

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


class ShellReadinessTest(unittest.TestCase):
    def test_existing_chat_navigation_does_not_repeat_plugin_wait(self) -> None:
        class Observer:
            def count(self, selector: str) -> int:
                return int(selector == runner.SELECTORS["chat_nav"])

            def click(self, selector: str, timeout: float = 0) -> None:
                raise AssertionError(f"unexpected click: {selector}")

            def wait_for(self, selector: str, timeout: float = 0) -> None:
                raise AssertionError(f"unexpected plugin wait: {selector}")

        client = object.__new__(runner.NativeClient)
        client.observer = Observer()
        client.spec = runner.ClientSpec("alice", "alice@p.t", "ptid:alice", Path("."), 0)
        client.wait_shell()


class NativeProcessLivenessTest(unittest.TestCase):
    def test_observer_wait_fails_immediately_when_desktop_exits(self) -> None:
        class ExitedProcess:
            returncode = 2

            def poll(self) -> int:
                return self.returncode

        client = object.__new__(runner.NativeClient)
        client.spec = runner.ClientSpec(
            "alice",
            "alice@p.t",
            "ptid:alice",
            Path("."),
            0,
        )
        client.process = ExitedProcess()
        client.webdriver_port = 65534
        with self.assertRaisesRegex(
            runner.JourneyError,
            "alice Desktop exited with 2",
        ):
            client.connect_observer()


class StationSourceStabilityTest(unittest.TestCase):
    def test_final_source_revalidation_records_and_rejects_drift(self) -> None:
        journey = object.__new__(runner.NativeVisibleJourney)
        journey.station_url = "http://station.example"
        journey.station_identity = {
            "commit": "expected-commit",
            "finalLive": None,
            "sourceStable": False,
        }
        with patch.object(
            runner,
            "read_json_url",
            return_value={"build_commit": "other-commit"},
        ), self.assertRaisesRegex(
            runner.JourneyError,
            "commit drifted during Gate",
        ):
            journey.verify_final_station_identity()

        self.assertFalse(journey.station_identity["sourceStable"])
        self.assertEqual(
            journey.station_identity["finalLive"]["build_commit"],
            "other-commit",
        )


class DeviceReadinessTest(unittest.TestCase):
    def test_device_identity_comes_from_active_messaging_engine(self) -> None:
        client = object.__new__(runner.NativeClient)
        client.spec = runner.ClientSpec("alice", "alice@p.t", "ptid:alice", Path("."), 0)
        client.gateway_command = lambda command: {
            "endpoint_device_id": "device-alice"
        }
        self.assertEqual(client.read_device_id(), "device-alice")
        self.assertEqual(client.device_id, "device-alice")

    def test_key_bundle_readiness_uses_runtime_publication_results(self) -> None:
        client = object.__new__(runner.NativeClient)
        client.spec = runner.ClientSpec("alice", "alice@p.t", "ptid:alice", Path("."), 0)
        client.gateway_command = lambda command: {
            "publish_prekeys": "Ok(None)",
            "publish_mls_key_packages": "Ok(())",
        }
        client.wait_bundle_published()

    def test_direct_session_readiness_uses_messaging_send_plan(self) -> None:
        client = object.__new__(runner.NativeClient)
        client.spec = runner.ClientSpec("alice", "alice@p.t", "ptid:alice", Path("."), 0)
        client.active_conversation_id = "direct-1"
        client.gateway_command = lambda command, args=None: {
            "prepare_send_plan": "Ok(PreparedMessagingSendPlan)"
        }
        client.wait_session_ready()


class NativeObserverFillTest(unittest.TestCase):
    def test_click_dispatches_inside_the_native_webview(self) -> None:
        observer = object.__new__(runner.NativeObserver)
        scripts: list[str] = []

        def evaluate(script: str) -> Any:
            scripts.append(script)
            return True

        observer.eval = evaluate
        observer.click("[data-chat-send]")
        self.assertIn("element.click()", scripts[0])
        self.assertIn("[data-chat-send]", scripts[0])

    def test_textarea_fill_uses_the_textarea_setter_and_input_event(self) -> None:
        observer = object.__new__(runner.NativeObserver)
        scripts: list[str] = []

        def evaluate(script: str) -> Any:
            scripts.append(script)
            return "TEXTAREA" if len(scripts) == 1 else True

        observer.eval = evaluate
        observer.fill('[data-pt-text-input="chat-composer"]', 'exact "plaintext"')

        self.assertEqual(len(scripts), 2)
        self.assertIn("HTMLTextAreaElement.prototype", scripts[1])
        self.assertIn("new InputEvent('input'", scripts[1])
        self.assertIn('exact \\"plaintext\\"', scripts[1])


class NativeObserverCountTest(unittest.TestCase):
    def test_count_uses_native_element_lookup_without_script_execution(self) -> None:
        class Driver:
            def find_elements(self, selector: str) -> list[str]:
                self.selector = selector
                return ["first", "second"]

            def execute_script(self, *_args: Any) -> Any:
                raise AssertionError("count must not execute renderer script")

        driver = Driver()
        observer = runner.NativeObserver(driver)

        self.assertEqual(observer.count("[data-ready]"), 2)
        self.assertEqual(driver.selector, "[data-ready]")


if __name__ == "__main__":
    unittest.main()
