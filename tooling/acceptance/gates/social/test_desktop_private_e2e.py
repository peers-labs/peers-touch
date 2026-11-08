from __future__ import annotations

import inspect
import copy
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.social import desktop_private_e2e as module
from tooling.acceptance.gates.social.cross_station_support import (
    ValidatedSuiteResult,
)
from tooling.acceptance.gates.social.desktop_private_e2e import (
    EXPLICITLY_UNPROVEN_SCENARIOS,
    HISTORICAL_SCENARIOS,
    SAME_STATION_SCENARIO,
    INTERACTION_SCENARIOS,
    SOURCE_COMMANDS,
    SocialPrivateDesktopGate,
    _validate_attached_suite,
    _validate_comment_trace,
)


class SocialPrivateDesktopGateTest(unittest.TestCase):
    def _suite(self) -> ValidatedSuiteResult:
        payload = {
            "proofState": "UNPROVEN",
            "controlCommit": "a" * 40,
            "sourceCommit": "b" * 40,
            "scenarioResults": {
                scenario: {
                    "status": "PASS",
                    "evidenceRefs": [
                        f"{scenario}-receiver",
                    ],
                }
                for scenario in INTERACTION_SCENARIOS
            },
            "resourceReuse": {
                "provisioningRuns": 1,
                "clientLaunches": 3,
                "maxConcurrentNativeClients": 2,
                "newAccountRegistrations": 3,
                "stationBuilds": 0,
                "stationDeployments": 0,
                "desktopBuilds": 0,
                "clientReplacements": ["bob2"],
                "fixtureOnlyClients": ["eve"],
            },
            "runtimeManifest": {
                "state": "FIXTURE_READY",
                "runId": "css09-suite-runtime",
            },
            "cleanup": {"status": "CLEANED"},
            "suiteRuntimeReportDigest": "c" * 64,
        }
        return ValidatedSuiteResult(
            path=Path("/tmp/result.json"),
            payload=payload,
            suite_runtime_path=Path("/tmp/suite-runtime.json"),
            suite_runtime_report={},
            supporting_artifacts=(),
        )

    def test_gate_attaches_current_css09_suite_without_runtime_owner(
        self,
    ) -> None:
        gate = SocialPrivateDesktopGate()
        suite = self._suite()
        with (
            mock.patch.object(
                module,
                "run_source_commands",
                return_value=[{"name": "source-check"}],
            ) as run_commands,
            mock.patch.object(
                module,
                "load_suite_result",
                return_value=suite,
            ) as load_suite,
            mock.patch.object(module, "attach_suite_evidence") as attach,
            mock.patch.object(module, "_interaction_observations", return_value={}) as observations,
            mock.patch.object(module, "_validate_comment_trace") as validate_trace,
        ):
            result = gate.run()

        run_commands.assert_called_once_with(gate, SOURCE_COMMANDS)
        load_suite.assert_called_once_with()
        attach.assert_called_once_with(gate, suite)
        self.assertEqual(
            suite.payload["runtimeManifest"],
            gate.report.manifest,
        )
        self.assertEqual(list(INTERACTION_SCENARIOS), result["provenScope"])
        self.assertEqual(3, observations.call_count)
        validate_trace.assert_called_once_with({}, {}, {})
        self.assertEqual(
            list(EXPLICITLY_UNPROVEN_SCENARIOS),
            result["unprovenScenarios"],
        )
        self.assertEqual(
            list(HISTORICAL_SCENARIOS),
            result["historicalScenarios"],
        )

    def test_missing_same_station_result_is_rejected(self) -> None:
        suite = self._suite()
        suite.payload["scenarioResults"].pop(SAME_STATION_SCENARIO)

        with self.assertRaisesRegex(GateError, "same-Station regression"):
            _validate_attached_suite(suite.payload)

    def test_same_station_receiver_evidence_is_required(self) -> None:
        suite = self._suite()
        suite.payload["scenarioResults"][SAME_STATION_SCENARIO][
            "evidenceRefs"
        ] = []

        with self.assertRaisesRegex(GateError, "receiver-visible evidence"):
            _validate_attached_suite(suite.payload)

    def test_resource_expansion_is_rejected(self) -> None:
        suite = self._suite()
        suite.payload["resourceReuse"]["maxConcurrentNativeClients"] = 3

        with self.assertRaisesRegex(GateError, "resource budget"):
            _validate_attached_suite(suite.payload)

    def test_replacement_identity_drift_is_rejected(self) -> None:
        suite = self._suite()
        suite.payload["resourceReuse"]["clientReplacements"] = ["bob"]

        with self.assertRaisesRegex(GateError, "resource budget"):
            _validate_attached_suite(suite.payload)

    def test_runtime_manifest_is_required(self) -> None:
        suite = self._suite()
        suite.payload.pop("runtimeManifest")

        with self.assertRaisesRegex(GateError, "runtime manifest"):
            _validate_attached_suite(suite.payload)

    def test_old_w7_runtime_owner_path_is_absent(self) -> None:
        source = inspect.getsource(module)

        self.assertNotIn("run-social-desktop-acceptance-suite", source)
        self.assertNotIn("_runtime_owner_command", source)

    def _trace(self):
        cross = {"commentReactionActions": [], "commentReactionAssertions": [], "commentReactionReplays": []}
        replacement = {"commentReactionAssertions": []}
        local = {"commentReactionActions": [], "commentReactionAssertions": []}

        def row(actor, phase, depth, count, liked, post="p"):
            return {"actor": actor, "phase": phase, "depth": depth, "count": count, "liked": liked,
                    "postIdSha256": post * 64, "commentIdSha256": str(depth) * 64,
                    "commentTextSha256": str(depth) * 64, "tag": "button", "paintFrames": 2,
                    "automationSessionId": actor + "-session"}

        def action(actor, phase):
            return {"actor": actor, "action": phase, "tag": "button", "automationSessionId": actor + "-session"}

        for depth, label in ((0, "root"), (1, "reply")):
            for initiator in ("bob", "alice"):
                for operation, count in (("like", 1), ("unlike", 0)):
                    phase = f"{initiator}-{label}-{operation}"
                    cross["commentReactionActions"].append(action(initiator, phase))
                    for actor in ("alice", "bob"):
                        cross["commentReactionAssertions"].append(
                            row(actor, phase, depth, count, count == 1 and actor == initiator))
            for phase in (f"alice-{label}-retain", "durable-retry"):
                for actor in ("alice", "bob"):
                    cross["commentReactionAssertions"].append(row(actor, phase, depth, 1, actor == "alice"))
            replacement["commentReactionAssertions"].append(row("bob2", "replacement-readback", depth, 1, False))
            for operation, count in (("like", 1), ("unlike", 0)):
                phase = f"local-{label}-{operation}"
                local["commentReactionActions"].append(action("alice", phase))
                local["commentReactionAssertions"].append(row("alice", phase, depth, count, count == 1, "l"))
            projection = {"count": 1, "liked": True, "projectionRevision": "7"}
            cross["commentReactionReplays"].append({
                "nativeRetryCount": 2, "state": "REACTION_COMMITTED", "operation": "REACT",
                "commandIdSha256": "c" * 64, "commentIdSha256": str(depth) * 64,
                "replays": [projection, copy.deepcopy(projection)],
            })
        return cross, replacement, local

    def test_private_trace_requires_bilateral_reply_and_restart_proof(self) -> None:
        _validate_comment_trace(*self._trace())
        for actor, phase, depth in (
            ("alice", "bob-root-like", 0),
            ("bob", "alice-reply-unlike", 1),
            ("bob2", "replacement-readback", 1),
        ):
            trace = self._trace()
            observations = trace[1] if actor == "bob2" else trace[0]
            observations["commentReactionAssertions"] = [
                row for row in observations["commentReactionAssertions"]
                if (row["actor"], row["phase"], row["depth"]) != (actor, phase, depth)]
            with self.subTest(actor=actor, phase=phase), self.assertRaisesRegex(GateError, "convergence"):
                _validate_comment_trace(*trace)

    def test_harness_only_actions_cannot_prove_comment_like(self) -> None:
        trace = self._trace()
        trace[0]["commentReactionActions"][0]["tag"] = "harness"
        with self.assertRaisesRegex(GateError, "button activation"):
            _validate_comment_trace(*trace)

    def test_restart_must_read_the_original_comment_identity(self) -> None:
        trace = self._trace()
        trace[1]["commentReactionAssertions"][0]["commentIdSha256"] = "x" * 64
        with self.assertRaisesRegex(GateError, "target changed"):
            _validate_comment_trace(*trace)

    def test_duplicate_replay_cannot_increment_the_counter(self) -> None:
        trace = self._trace()
        trace[0]["commentReactionReplays"][0]["replays"][1]["count"] = 2
        with self.assertRaisesRegex(GateError, "retry changed"):
            _validate_comment_trace(*trace)

    def test_unpainted_dom_cannot_prove_comment_like(self) -> None:
        trace = self._trace()
        trace[0]["commentReactionAssertions"][0]["paintFrames"] = 0
        with self.assertRaisesRegex(GateError, "painted button"):
            _validate_comment_trace(*trace)


if __name__ == "__main__":
    unittest.main()
