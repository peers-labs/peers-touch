"""Social's concrete Native entry consumes its selected parent scope."""
import ast
import inspect
import os
import runpy
import tempfile
import textwrap
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from tooling.acceptance.core import GateError, validate_suite_runtime_report
from tooling.acceptance.core.evidence import EvidenceReport
from tooling.acceptance.core.errors import EvidenceConflict
from tooling.acceptance.core.suite_runtime import SuiteRuntimeLedger, SuiteRuntimeError
from tooling.acceptance.core.e2e_preflight import (
    PREFLIGHT_ENV, load_catalog, prepare_e2e, preflight_binding,
)
from tooling.acceptance.core.evidence_store import EvidenceStore, source_identity
from tooling.acceptance.core.execution_budget import ExecutionBudgetError
from tooling.acceptance.core.execution_graph import compile_graph
from tooling.acceptance.gates.social.public_feed_native import GATE_ID, Gate, RUNTIME_REUSE, SCENARIOS
from tooling.acceptance.gates.social.public_comment_revalidation import PublicCommentRevalidation

ROOT = Path(__file__).resolve().parents[4]


class PublicFeedNativeEntryTest(unittest.TestCase):
    def test_terminal_runtime_validation_binds_the_original_core_api(self):
        calls = [
            node for node in ast.walk(ast.parse(textwrap.dedent(inspect.getsource(Gate.run))))
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and node.func.id == "validate_suite_runtime_report"
        ]
        self.assertEqual(len(calls), 1)
        for call in calls:
            inspect.signature(validate_suite_runtime_report).bind(
                *[object() for _ in call.args],
                **{keyword.arg: object() for keyword in call.keywords},
            )

    def test_reopened_circle_waits_for_original_motion_before_revealing_last_member(self):
        gate = object.__new__(Gate)
        gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
        gate.clients = {"alice": Mock()}
        gate.active_social_scenario = "circle-members-pagination"
        gate.capture = Mock()
        element = Mock()
        observations = iter((False, True))
        events = []
        def script(text, target):
            self.assertIs(target, element)
            if "getAnimations" in text:
                settled = next(observations)
                events.append(("motion", settled))
                return settled
            self.assertIn("scrollIntoView", text)
            events.append(("reveal", True))
        gate.clients["alice"].execute_script.side_effect = script
        gate.clients["alice"].execute_async_script.side_effect = (
            lambda *_args: events.append(("two-paint-frames", True)) or True)
        def wait(predicate, _description, *, timeout):
            self.assertEqual(timeout, 30)
            self.assertFalse(predicate())
            self.assertTrue(predicate())
        with patch("tooling.acceptance.gates.social.public_feed_native.wait_until", side_effect=wait):
            gate.assert_circle_element_painted(element, "circle-last-member-painted")
        self.assertEqual(events, [
            ("motion", False), ("motion", True), ("reveal", True), ("two-paint-frames", True),
        ])
        gate.capture.assert_not_called()

    def test_circle_motion_timeout_retains_original_failure_and_attempts_paint_diagnostics(self):
        gate = object.__new__(Gate)
        gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
        gate.clients = {"alice": Mock()}
        gate.active_social_scenario = "circle-members-pagination"
        gate.capture = Mock(side_effect=RuntimeError("capture failed"))
        gate.clients["alice"].execute_script.side_effect = RuntimeError("geometry failed")
        failure = GateError("original Circle motion timeout")
        with patch("tooling.acceptance.gates.social.public_feed_native.wait_until", side_effect=failure):
            with self.assertRaises(GateError) as raised:
                gate.assert_circle_element_painted(Mock(), "circle-last-member-painted")
        self.assertIs(raised.exception, failure)
        gate.clients["alice"].execute_async_script.assert_not_called()
        gate.clients["alice"].execute_script.assert_called_once()
        gate.capture.assert_called_once_with(
            "alice", "circle-members-pagination-alice-circle-last-member-painted-failure")

    def test_tombstone_requires_an_original_ready_public_response_not_concealment(self):
        original = {
            "open": True, "status": "ready", "query": "deleted body", "filter": "social",
            "page": {"coverage": [{"sourceId": "station.social.public", "state": "SOURCE_STATE_READY"}]},
        }
        for change in (
            {"status": "idle"}, {"status": "loading"}, {"query": "previous query"},
            {"filter": "messages"}, {"page": None},
            {"page": {"items": [{"sourceId": "station.social.public"}],
                      "coverage": original["page"]["coverage"]}},
            {"page": {"coverage": [{"sourceId": "station.social.public", "state": "SOURCE_STATE_PARTIAL"}]}},
            {"page": {"coverage": [{"sourceId": "station.social.public", "state": "READY"}]}},
            {"page": {"coverage": [{"sourceId": "device.social", "state": "SOURCE_STATE_READY"}]}},
            {"page": {"coverage": []}},
        ):
            with self.subTest(change=change):
                gate = object.__new__(Gate)
                gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
                gate.report.runtime["search"] = {}
                gate.clients = {"bob": Mock()}
                gate.wait_js = Mock()
                gate.capture = Mock()
                failure = GateError("original completed response timeout")
                def wait(predicate, *_args, **_kwargs):
                    self.assertFalse(predicate())
                    raise failure
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.call_async_harness",
                    return_value={**original, **change},
                ), patch("tooling.acceptance.gates.social.public_feed_native.wait_until", side_effect=wait):
                    with self.assertRaises(GateError) as raised:
                        gate.assert_tombstone_search_removed("deleted body", ".exact-result")
                self.assertIs(raised.exception, failure)
                gate.wait_js.assert_not_called()
                self.assertNotIn("tombstonePresentedResponse", gate.report.runtime["search"])

    def test_tombstone_failure_observes_original_presentation_and_document_independently(self):
        for diagnostics_fail in (False, True):
            with self.subTest(diagnostics_fail=diagnostics_fail):
                gate = object.__new__(Gate)
                gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
                gate.report.runtime["search"] = {}
                gate.clients = {"bob": Mock()}
                failure = GateError("original retained Search timeout")
                gate.wait_js = Mock(side_effect=failure)
                gate.capture = Mock(side_effect=RuntimeError("capture failed") if diagnostics_fail else None)
                gate.receiver.execute_script.return_value = {"retained": True, "busy": "false"}
                if diagnostics_fail:
                    gate.receiver.execute_script.side_effect = RuntimeError("document failed")
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.call_async_harness",
                    return_value={"open": True, "query": "deleted body"},
                    side_effect=RuntimeError("presentation failed") if diagnostics_fail else None,
                ) as observe, patch(
                    "tooling.acceptance.gates.social.public_feed_native.wait_until",
                    side_effect=failure,
                ) as wait:
                    with self.assertRaises(GateError) as raised:
                        gate.assert_tombstone_search_removed("deleted body", ".exact-result")
                self.assertIs(raised.exception, failure)
                observe.assert_called_once_with(
                    gate.receiver, "deviceSearchPresentation", {},
                    namespace="chat", script_timeout=120)
                gate.receiver.execute_script.assert_called_once()
                gate.capture.assert_called_once_with("bob", "public-tombstone-bob-search-failure")
                self.assertEqual(wait.call_args.kwargs["timeout"], 120)
                if not diagnostics_fail:
                    self.assertTrue(gate.report.runtime["search"]["tombstoneFailureDocument"]["retained"])

    def test_tombstone_success_requires_qualified_empty_and_paint_without_failure_reads(self):
        gate = object.__new__(Gate)
        gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
        gate.report.runtime["search"] = {}
        gate.clients = {"bob": Mock()}
        gate.wait_js = Mock()
        gate.wait_surface = Mock(return_value={"painted": True})
        gate.capture = Mock()
        presentation = {
            "open": True, "status": "ready", "query": "deleted body", "filter": "social",
            # The original Harness uses protobuf toJson, including canonical
            # enum names and omission of the empty repeated items field.
            "page": {"coverage": [{"sourceId": "station.social.public", "state": "SOURCE_STATE_READY"}]},
        }
        def wait(predicate, *_args, **_kwargs):
            self.assertTrue(predicate())
        with patch(
            "tooling.acceptance.gates.social.public_feed_native.call_async_harness",
            return_value=presentation,
        ) as observe, patch(
            "tooling.acceptance.gates.social.public_feed_native.wait_until",
            side_effect=wait,
        ):
            gate.assert_tombstone_search_removed("deleted body", ".exact-result")
        expression = gate.wait_js.call_args.args[0]
        for required in (".exact-result", ".pt-search-empty", ".pt-search-error",
                         "aria-busy", "displayedQuery", "deleted body"):
            self.assertIn(required, expression)
        observe.assert_called_once_with(
            gate.receiver, "deviceSearchPresentation", {},
            namespace="chat", script_timeout=120)
        gate.capture.assert_not_called()
        gate.receiver.execute_script.assert_not_called()
        self.assertIs(gate.report.runtime["search"]["tombstonePresentedResponse"], presentation)

    def test_public_search_reference_uses_only_the_current_presented_social_response(self):
        gate = object.__new__(Gate)
        gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
        gate.clients = {"bob": Mock()}
        reference = {
            "resource": {"id": "public-post", "sourceSessionId": "original-session"},
            "sourceId": "station.social.public",
        }
        presentation = {
            "open": True, "query": "edited body", "filter": "social",
            "page": {"items": [reference]},
        }
        with patch(
            "tooling.acceptance.gates.social.public_feed_native.call_async_harness",
            return_value=presentation,
        ) as observe:
            self.assertIs(
                gate.presented_public_reference("edited body", "public-post"),
                reference,
            )
        observe.assert_called_once_with(
            gate.receiver, "deviceSearchPresentation", {},
            namespace="chat", script_timeout=120,
        )

    def test_public_search_reference_rejects_stale_intent_and_missing_original_reference(self):
        reference = {"resource": {"id": "public-post"}, "sourceId": "station.social.public"}
        original = {
            "open": True, "query": "edited body", "filter": "social",
            "page": {"items": [reference]},
        }
        for change in (
            {"open": False}, {"query": "previous body"}, {"filter": "messages"},
            {"page": None}, {"page": {}},
            {"page": {"items": [{"resource": {"id": "other-post"},
                                "sourceId": "station.social.public"}]}},
            {"page": {"items": [{"resource": {"id": "public-post"},
                                "sourceId": "device.messaging"}]}},
        ):
            with self.subTest(change=change):
                gate = object.__new__(Gate)
                gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
                gate.clients = {"bob": Mock()}
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.call_async_harness",
                    return_value={**original, **change},
                ):
                    with self.assertRaises(GateError):
                        gate.presented_public_reference("edited body", "public-post")

    def test_baseline_failure_observes_reads_and_document_independently_before_clear(self):
        for read_error, document_error, capture_error, clear_error in (
            (None, None, None, None),
            (RuntimeError("read unavailable"), None, None, None),
            (None, RuntimeError("document unavailable"), None, None),
            (None, None, RuntimeError("capture unavailable"), None),
            (RuntimeError("read unavailable"), RuntimeError("document unavailable"),
             RuntimeError("capture unavailable"), RuntimeError("clear unavailable")),
        ):
            with self.subTest(errors=(read_error, document_error, capture_error, clear_error)):
                gate = object.__new__(Gate)
                gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
                gate.manifest = {"runId": "original-run"}
                gate.ptids = {"alice": "ptid:author"}
                gate.begin_scenario = Mock()
                gate.complete_scenario = Mock()
                gate.publish_text_ui = Mock(return_value=10)
                failure = GateError("original receiver passive paint timeout")
                gate.await_painted_public_card = Mock(side_effect=[Mock(), failure])
                gate.capture_public_measurement = Mock()
                gate.capture = Mock(side_effect=capture_error)
                document = {"hidden": True, "visibilityState": "hidden", "feedCards": 4}
                client = Mock()
                client.execute_script = Mock(
                    return_value=document, side_effect=document_error)
                gate.clients = {"bob": client}
                sample = {"readCount": 0, "expired": False}
                operations = []

                def control(actor, *, action="read", **options):
                    operations.append(action)
                    if action == "read":
                        if read_error:
                            raise read_error
                        return sample
                    if action == "clear" and len(operations) > 1:
                        sample["expired"] = True
                        if clear_error:
                            raise clear_error
                    return {}

                gate.public_fault = Mock(side_effect=control)
                with self.assertRaises(GateError) as caught:
                    gate.baseline_read_scenario(Mock())
                self.assertIs(caught.exception, failure)
                observed = gate.report.runtime["publicFeedBaselineFailure"]
                if read_error is None:
                    self.assertEqual(observed["lastObservation"],
                                     {"readCount": 0, "expired": False})
                else:
                    self.assertNotIn("lastObservation", observed)
                if document_error is None:
                    self.assertEqual(observed["document"], document)
                else:
                    self.assertNotIn("document", observed)
                client.execute_script.assert_called_once()
                gate.capture.assert_called_once_with(
                    "bob", "normal-submit-readback-bob-baseline-failure")
                self.assertEqual(operations, ["clear", "arm", "read", "clear"])
                gate.complete_scenario.assert_not_called()
                gate.capture_public_measurement.assert_not_called()
                self.assertEqual(gate.await_painted_public_card.call_args.args,
                                 ("bob", "normal-submit-readback-original-run"))
                self.assertEqual(gate.await_painted_public_card.call_args.kwargs, {})

    def test_baseline_success_measures_original_reads_and_clears_once(self):
        gate = object.__new__(Gate)
        gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
        gate.manifest = {"runId": "original-run"}
        gate.ptids = {"alice": "ptid:author"}
        gate.begin_scenario = Mock()
        gate.complete_scenario = Mock()
        gate.publish_text_ui = Mock(return_value=10)
        gate.await_painted_public_card = Mock()
        gate.capture_public_measurement = Mock()
        gate.capture = Mock()
        gate.clients = {"bob": Mock()}
        sample = {"readCount": 1}
        gate.public_fault = Mock(side_effect=[{}, {}, sample, {}])
        self.assertEqual(gate.baseline_read_scenario(Mock()),
                         "normal-submit-readback-original-run")
        gate.capture_public_measurement.assert_called_once_with(
            "normal-submit-readback", 10, sample)
        gate.complete_scenario.assert_called_once()
        gate.clients["bob"].execute_script.assert_not_called()
        self.assertNotIn("publicFeedBaselineFailure", gate.report.runtime)
        self.assertEqual(
            [call.kwargs.get("action", "read") for call in gate.public_fault.call_args_list],
            ["clear", "arm", "read", "clear"],
        )

    def test_integrity_recovery_observes_rejection_then_next_original_cycle(self):
        for kind, code in (("corrupt-read-payload", "FEED_INVALID"),
                           ("rollback-read-head", "FEED_HEAD_ROLLBACK")):
            with self.subTest(kind=kind):
                gate = object.__new__(Gate)
                gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
                gate.manifest = {"runId": "original-run"}
                gate.ptids = {"alice": "ptid:author"}
                gate.begin_scenario = Mock()
                gate.complete_scenario = Mock()
                gate.assert_condition = Mock()
                gate.publish_text_ui = Mock(return_value=10)
                card = Mock()
                card.get_attribute.return_value = "original-post"
                gate.await_painted_public_card = Mock(return_value=card)
                gate.capture = Mock()
                gate.capture_public_measurement = Mock()
                fault = {
                    "kind": kind, "effectCount": 1, "rejection": code,
                    "expired": False, "boundedResponses": True,
                    "readCount": 2, "threadReadCount": 2,
                    "maxEventCount": 1, "maxThreadCount": 0, "maxResponseBytes": 800,
                }
                recovery = {
                    **fault, "kind": "observe-reads", "effectCount": 0, "rejection": "",
                    "readCount": 1, "threadReadCount": 1, "maxResponseBytes": 900,
                }
                reads = iter([fault, recovery])

                def control(actor, *, action="read", **options):
                    if action == "clear":
                        # An owner retiring its mutable rule cannot rewrite
                        # the already observed original rejection.
                        fault["expired"] = True
                        return {}
                    if action == "arm":
                        fault["expired"] = False
                        return {"armed": True}
                    return next(reads)

                gate.public_fault = Mock(side_effect=control)

                def wait(predicate, description, *, timeout):
                    self.assertEqual(timeout, 80)
                    self.assertIn(f"rejected original {kind}", description)
                    return predicate()

                with patch("tooling.acceptance.gates.social.public_feed_native.wait_until",
                           side_effect=wait):
                    gate.read_integrity_scenario(Mock(), kind=kind, original_text="retained")
                phases = gate.report.runtime["publicFeedIntegrity"][kind]
                self.assertEqual(phases["rejection"]["rejection"], code)
                self.assertFalse(phases["rejection"]["expired"])
                self.assertEqual(phases["recovery"]["kind"], "observe-reads")
                self.assertEqual(
                    [call.kwargs.get("action", "read") for call in gate.public_fault.call_args_list],
                    ["clear", "arm", "read", "clear", "arm", "read", "clear"],
                )
                self.assertEqual(gate.public_fault.call_args_list[4].kwargs, {
                    "action": "arm", "kind": "observe-reads", "target": "ptid:author",
                    "label": f"{kind}:recovery",
                })
                measurement = gate.capture_public_measurement.call_args.args[2]
                self.assertEqual(measurement["readCount"], 3)
                self.assertEqual(measurement["maxResponseBytes"], 900)
                self.assertTrue(measurement["boundedResponses"])
                self.assertTrue(all(call.args[1] for call in gate.assert_condition.call_args_list))
                gate.complete_scenario.assert_called_once()

    def test_integrity_recovery_failure_keeps_original_error_and_diagnostics(self):
        for observation_error, capture_error in (
            (None, None),
            (RuntimeError("observation unavailable"), RuntimeError("capture unavailable")),
        ):
            with self.subTest(diagnostics_fail=observation_error is not None):
                gate = object.__new__(Gate)
                gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
                gate.manifest = {"runId": "original-run"}
                gate.ptids = {"alice": "ptid:author"}
                gate.begin_scenario = Mock()
                gate.complete_scenario = Mock()
                gate.assert_condition = Mock()
                gate.publish_text_ui = Mock(return_value=10)
                card = Mock()
                card.get_attribute.return_value = "original-post"
                failure = GateError("original receiver recovery timeout")
                gate.await_painted_public_card = Mock(side_effect=[card, card, failure])
                gate.capture = Mock(side_effect=capture_error)
                fault = {
                    "effectCount": 1, "rejection": "FEED_INVALID",
                    "expired": False, "boundedResponses": True,
                }
                reads = iter([fault, observation_error or {"readCount": 0}])

                def control(actor, *, action="read", **options):
                    if action != "read":
                        return {}
                    result = next(reads)
                    if isinstance(result, Exception):
                        raise result
                    return result

                gate.public_fault = Mock(side_effect=control)
                with patch("tooling.acceptance.gates.social.public_feed_native.wait_until",
                           side_effect=lambda predicate, *_args, **_kwargs: predicate()):
                    with self.assertRaises(GateError) as caught:
                        gate.read_integrity_scenario(Mock(), kind="corrupt-read-payload",
                                                    original_text="retained")
                self.assertIs(caught.exception, failure)
                phases = gate.report.runtime["publicFeedIntegrity"]["corrupt-read-payload"]
                self.assertEqual(phases["rejection"], fault)
                if observation_error is None:
                    self.assertEqual(phases["lastObservation"], {"readCount": 0})
                else:
                    self.assertNotIn("lastObservation", phases)
                gate.complete_scenario.assert_not_called()
                gate.capture.assert_called_once_with(
                    "bob", "corrupt-read-payload-bob-integrity-failure")
                self.assertEqual(gate.public_fault.call_args.kwargs, {"action": "clear"})

    def test_lost_hint_timeout_retains_last_original_sample_before_clear(self):
        for effect, reads, observation_error, capture_error in (
            (0, 0, None, None),
            (1, 0, None, None),
            (1, 2, RuntimeError("receiver unavailable"), RuntimeError("capture unavailable")),
        ):
            with self.subTest(effect=effect, reads=reads):
                gate = object.__new__(Gate)
                gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
                gate.manifest = {"runId": "original-run"}
                gate.ptids = {"alice": "ptid:original-author"}
                gate.begin_scenario = Mock()
                gate.complete_scenario = Mock()
                gate.action = Mock(return_value={"verifiedSequence": "7", "pendingCount": 0})
                gate.public_fault = Mock(side_effect=[
                    {}, {}, observation_error or {"readCount": 3}, {},
                ])
                gate.publish_text_ui = Mock(return_value=12)
                gate.await_painted_public_card = Mock()
                gate.capture = Mock(side_effect=capture_error)
                sample = {"effectCount": effect, "repairReads": reads, "repairApplied": False}

                def control(operation, payload=None):
                    if operation == "read":
                        return sample
                    if operation == "clear":
                        # Retiring the remote rule must not mutate its retained sample.
                        sample["repairReads"] = 99
                    return {"armed": True} if operation == "arm" else {"cleared": True}

                gate.notification_control = Mock(side_effect=control)
                def assertion(name, condition, *args):
                    if not condition:
                        raise GateError(name)
                gate.assert_condition = assertion
                failure = GateError("original missed-hint timeout")
                def wait(predicate, description, **kwargs):
                    self.assertEqual(kwargs["timeout"], 75)
                    self.assertIsNone(predicate())
                    raise failure
                with patch("tooling.acceptance.gates.social.public_feed_native.time.monotonic",
                           side_effect=[10, 15]), \
                        patch("tooling.acceptance.gates.social.public_feed_native.wait_until",
                              side_effect=wait):
                    with self.assertRaises(GateError) as caught:
                        gate.lost_notification_scenario(Mock())
                self.assertIs(caught.exception, failure)
                self.assertEqual(gate.report.runtime["federationNotification"], {
                    "effectCount": effect, "repairReads": reads, "repairApplied": False,
                })
                self.assertEqual(
                    [call.args[0] for call in gate.notification_control.call_args_list],
                    ["arm", "read", "clear"],
                )
                self.assertEqual(gate.notification_control.call_args_list[0].args[1],
                    {"actorPtid": "ptid:original-author", "minimumHead": 8})
                gate.await_painted_public_card.assert_called_once_with(
                    "alice", "lost-federation-notification-original-run")
                gate.capture.assert_called_once_with(
                    "bob", "lost-federation-notification-bob-repair-failure")
                gate.complete_scenario.assert_not_called()
                if observation_error is None:
                    self.assertEqual(gate.report.runtime["federationNotificationReceiverReads"],
                                     {"readCount": 3})
                else:
                    self.assertNotIn("federationNotificationReceiverReads", gate.report.runtime)

    def test_relay_bilateral_capture_preserves_distinct_immutable_actor_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            worktree = base / "repo"
            worktree.mkdir()
            store = EvidenceStore(base / "artifacts", worktree=worktree)
            with store.begin_run(GATE_ID, source={"commit": "a" * 40}) as run:
                gate = object.__new__(Gate)
                gate.report = EvidenceReport(GATE_ID, "RUNNING", "unit-check", 0)
                gate.evidence_dir = None
                gate.manifest = {"runId": run.run_id}
                gate.clients = {}
                for actor in ("alice", "bob"):
                    client = Mock()
                    client.save_screenshot.side_effect = lambda path, actor=actor: Path(path).write_bytes(
                        f"controlled-{actor}-pixels".encode())
                    client.get_page_source.return_value = f"<p>controlled-{actor}-DOM</p>"
                    gate.clients[actor] = client
                gate.action = Mock(side_effect=[
                    {"verifiedSequence": "1"},
                    {"pendingCount": 0, "verifiedSequence": "2"},
                ])
                gate.publish_text_ui = Mock()
                card = Mock()
                card.get_attribute.return_value = "post"
                gate.await_card = Mock(return_value=card)
                gate.open_comments = Mock()
                gate.set_input = Mock()
                gate.click = Mock()
                gate.assert_comment_like = Mock()
                gate.await_painted_public_card = Mock(return_value=card)
                observation = {"directionBytes": [[0, 0], [1, 1], [1, 1]],
                               "stationLegs": [[0, 1], [2]], "plaintextObserved": False}
                gate.capability_client = Mock()
                gate.capability_client.invoke.side_effect = [
                    {"armed": True}, observation, {"cleared": True},
                ]
                def assert_condition(name, condition, *args):
                    if not condition:
                        raise GateError(name)
                gate.assert_condition = assert_condition
                refs = {}
                def write(relative, value, **_):
                    refs[relative] = run.write_bytes(relative, value, role=relative)
                    return run.run_dir / relative
                with patch("tooling.acceptance.core.evidence.current_artifact_path",
                           side_effect=lambda relative, **_: run.run_dir / relative), \
                        patch("tooling.acceptance.core.evidence.write_current_artifact", side_effect=write), \
                        patch("tooling.acceptance.core.evidence.current_artifact_ref",
                              side_effect=lambda relative, **_: refs[relative]):
                    gate.relay_opaque_scenario(Mock())
                    self.assertEqual(len(refs), 4)
                    for actor in ("alice", "bob"):
                        for suffix, value in (
                            ("screenshot.png", f"controlled-{actor}-pixels".encode()),
                            ("dom.html", f"<p>controlled-{actor}-DOM</p>".encode()),
                        ):
                            path = f"evidence/{GATE_ID}-relay-opaque-{actor}-{suffix}"
                            self.assertEqual(store.resolve(refs[path]).read_bytes(), value)
                    # The original naming failure remains rejected by the real
                    # store; repairing the caller must not permit overwrites.
                    gate.capture("bob", "duplicate-label")
                    with self.assertRaises(EvidenceConflict):
                        gate.capture("alice", "duplicate-label")
                self.assertEqual(
                    [call.args[1] for call in gate.capability_client.invoke.call_args_list],
                    ["arm", "finish", "clear"],
                )
                self.assertEqual(gate.report.runtime["relayOpaque"]["directionBytes"],
                                 [[0, 0], [1, 1], [1, 1]])

    def test_passive_public_paint_reveals_real_card_without_requesting_repair(self):
        for present, painted, frames in (
            (True, True, 2), (False, True, 2), (True, False, 2), (True, True, 1),
        ):
            with self.subTest(present=present, painted=painted, frames=frames):
                gate = object.__new__(Gate)
                gate.active_social_scenario = "normal-submit-readback"
                gate.report = SimpleNamespace(runtime={})
                client, card = Mock(), Mock()
                gate.clients = {"bob": client}
                gate.card = Mock(return_value=card if present else None)
                gate.action = Mock()
                gate.capture = Mock(side_effect=RuntimeError("capture unavailable"))
                state = {"revealed": False}
                client.execute_script.side_effect = lambda script, target: (
                    state.update(revealed=target is card)
                )
                client.execute_async_script.side_effect = lambda script, target: {
                    "painted": painted and state["revealed"], "paintFrames": frames,
                }
                failure = GateError("original passive paint timeout")

                def wait(predicate, description, **kwargs):
                    self.assertEqual(kwargs["timeout"], 80)
                    result = predicate()
                    if not result:
                        raise failure
                    return result

                accepted = present and painted and frames == 2
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.wait_until",
                    side_effect=wait,
                ):
                    if accepted:
                        self.assertIs(gate.await_painted_public_card("bob", "original-post"), card)
                        gate.capture.assert_not_called()
                    else:
                        with self.assertRaises(GateError) as caught:
                            gate.await_painted_public_card("bob", "original-post")
                        self.assertIs(caught.exception, failure)
                        gate.capture.assert_called_once_with(
                            "bob", "normal-submit-readback-bob-paint-failure",
                        )
                gate.action.assert_not_called()
                self.assertEqual(client.execute_script.call_count, 1 if present else 0)

    def test_offscreen_thread_acquires_comments_after_reveal_without_collapsing(self):
        for expanded in (True, False):
            with self.subTest(expanded=expanded):
                gate = object.__new__(Gate)
                state = {"revealed": False, "expanded": expanded}
                control, row, client = Mock(), Mock(), Mock()
                control.get_attribute.side_effect = lambda name: str(state["expanded"]).lower()
                control.click.side_effect = lambda: state.update(expanded=not state["expanded"])
                row.is_displayed.side_effect = lambda: state["revealed"] and state["expanded"]
                row.get_attribute.return_value = "confirmed-comment"
                client.find_elements.side_effect = lambda selector: [row] if (
                    state["revealed"] and state["expanded"]
                ) else []

                def execute(script, *args):
                    if "scrollIntoView" in script:
                        self.assertIs(args[0], control)
                        state["revealed"] = True
                        return None
                    return args == (row, "original-comment")

                client.execute_script.side_effect = execute
                gate.clients = {"bob": client}
                gate.visible_element = Mock(return_value=control)

                def wait(predicate, description, **kwargs):
                    result = predicate()
                    if not result:
                        raise GateError(description)
                    return result

                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.wait_until",
                    side_effect=wait,
                ):
                    gate.open_comments("bob", "original-post")
                    self.assertEqual(
                        gate.comment_selector("bob", "original-post", "original-comment"),
                        'original-post [data-comment-id="confirmed-comment"]',
                    )
                self.assertTrue(state["expanded"])
                self.assertEqual(control.click.call_count, 0 if expanded else 1)

    def test_missing_comment_row_captures_rendering_without_replacing_first_failure(self):
        for capture_error in (None, RuntimeError("capture unavailable")):
            with self.subTest(capture_error=capture_error):
                gate = object.__new__(Gate)
                gate.active_social_scenario = "native-restart"
                gate.report = SimpleNamespace(runtime={})
                gate.capture = Mock(side_effect=capture_error)
                gate.action = Mock()
                failure = GateError("original painted comment timeout")
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.wait_until",
                    side_effect=failure,
                ) as wait:
                    with self.assertRaises(GateError) as caught:
                        gate.comment_selector("bob", "original-post", "original-comment")
                self.assertIs(caught.exception, failure)
                self.assertEqual(wait.call_args.kwargs["timeout"], 120)
                gate.capture.assert_called_once_with("bob", "native-restart-bob-row-failure")
                gate.action.assert_not_called()

    def test_late_comment_read_requires_one_real_pending_response_and_clears_on_failure(self):
        for effects in (0, 1):
            with self.subTest(effects=effects):
                gate = Mock()
                gate.report = SimpleNamespace(runtime={}, cleanup=[])
                gate.clients = {"bob": Mock()}
                gate.clients["bob"].execute_script.return_value = "original-post"
                gate.action.side_effect = lambda actor, method, payload=None: {
                    "commentReadReconcileStatus": {"state": "held", "effectCount": effects, "reconciled": False},
                    "releaseCommentReadReconcile": {"state": "released", "effectCount": 1, "reconciled": True},
                }.get(method)
                probe = PublicCommentRevalidation(gate)
                probe.start = Mock()
                probe.draft = Mock()
                probe.capture = Mock()
                with patch("tooling.acceptance.gates.social.public_comment_revalidation.wait_until",
                           side_effect=lambda predicate, *args, **kwargs: predicate()):
                    if effects == 0:
                        with self.assertRaisesRegex(GateError, "one pending response"):
                            with probe.late_read("bob", "original-post", phase="late-create", rows=1):
                                self.fail("UI mutation ran without a real held response")
                    else:
                        failure = GateError("original UI mutation failed")
                        with self.assertRaises(GateError) as caught:
                            with probe.late_read("bob", "original-post", phase="late-create", rows=1):
                                raise failure
                        self.assertIs(caught.exception, failure)
                self.assertIn(unittest.mock.call("bob", "clearCommentReadReconcile"), gate.action.call_args_list)
                self.assertNotIn(unittest.mock.call("bob", "releaseCommentReadReconcile"), gate.action.call_args_list)
                probe.capture.assert_not_called()
                gate.start_client.assert_not_called()
                gate.prepare_fixture.assert_not_called()

    def test_comment_like_timeout_preserves_original_failure_and_actual_state(self):
        for present, observation_error, capture_error in (
            (True, None, None), (False, None, None),
            (True, RuntimeError("DOM unavailable"), RuntimeError("capture unavailable")),
        ):
            with self.subTest(present=present, observation_error=observation_error is not None):
                gate = object.__new__(Gate)
                gate.active_social_scenario = "comment-reactions"
                gate.report = SimpleNamespace(runtime={})
                client = Mock()
                actual = {"present": True, "count": "1", "pressed": "true",
                          "execution": "idle", "disabled": False}
                client.execute_script.return_value = actual
                client.execute_script.side_effect = observation_error
                gate.clients = {"bob": client}
                gate.comment_selector = Mock(return_value="original-comment")
                gate.visible_element = Mock(return_value=Mock() if present else None)
                gate.action = Mock(return_value={"pendingCount": 0, "verifiedSequence": "9"})
                gate.capture = Mock(side_effect=capture_error)
                failure = GateError("original LIKE timeout")
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.wait_until",
                    side_effect=failure,
                ) as wait:
                    with self.assertRaises(GateError) as caught:
                        gate.assert_comment_like("bob", "original-post", "original-comment", 2, True)
                self.assertIs(caught.exception, failure)
                self.assertEqual(wait.call_count, 1)
                self.assertEqual(wait.call_args.kwargs["timeout"], 120)
                if observation_error is None:
                    self.assertEqual(gate.report.runtime["commentLikeFailureObservations"], [{
                        "actor": "bob", "expected": {"count": 2, "liked": True},
                        "actual": actual if present else {"present": False},
                    }])
                else:
                    self.assertNotIn("commentLikeFailureObservations", gate.report.runtime)
                gate.action.assert_called_once_with("bob", "publicFeedStatus")
                self.assertEqual(gate.report.runtime["commentLikeNativeStatus"]["bob"]["pendingCount"], 0)
                gate.capture.assert_called_once_with("bob", "comment-reactions-bob-verification-failure")

    def test_settled_comment_like_does_not_add_failure_reads_or_captures(self):
        gate = object.__new__(Gate)
        gate.report = SimpleNamespace(runtime={})
        gate.comment_selector = Mock(return_value="original-comment")
        gate.action = Mock()
        gate.capture = Mock()
        with patch(
            "tooling.acceptance.gates.social.public_feed_native.wait_until",
            return_value=True,
        ) as wait:
            selector = gate.assert_comment_like("bob", "original-post", "original-comment", 2, True)
        self.assertIn("original-comment", selector)
        self.assertEqual(wait.call_args.kwargs["timeout"], 120)
        self.assertEqual(gate.report.runtime, {})
        gate.action.assert_not_called()
        gate.capture.assert_not_called()

    def test_poll_timeout_retains_actual_predicate_and_rendering_before_cleanup(self):
        for present, capture_error in (
            (True, None), (False, None), (True, RuntimeError("capture failed")),
        ):
            with self.subTest(present=present, capture_error=capture_error is not None):
                gate = object.__new__(Gate)
                gate.active_social_scenario = "poll-single-choice"
                gate.report = SimpleNamespace(runtime={})
                client = Mock()
                actual = {
                    "present": True, "state": "ready", "counts": [1, 1],
                    "choices": [], "voters": 2, "disabled": False,
                    "top": 40, "bottom": 300, "height": 260,
                    "viewportHeight": 600, "hitInside": True,
                }
                client.execute_script.return_value = actual
                gate.clients = {"bob": client}
                gate.visible_element = Mock(return_value=Mock() if present else None)
                gate.capture = Mock(side_effect=capture_error)
                failure = GateError("timed out waiting for bob verified poll counts and selection")
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.wait_until",
                    side_effect=failure,
                ) as wait:
                    with self.assertRaises(GateError) as caught:
                        gate.assert_poll("bob", "original-poll", "post", [1, 1], [1])
                self.assertIs(caught.exception, failure)
                self.assertEqual(wait.call_count, 1)
                self.assertEqual(wait.call_args.kwargs["timeout"], 120)
                self.assertEqual(gate.report.runtime["pollFailureObservations"], [{
                    "actor": "bob",
                    "expected": {"counts": [1, 1], "choices": [1], "closed": False},
                    "actual": actual if present else {"present": False},
                }])
                gate.capture.assert_called_once_with(
                    "bob", "poll-single-choice-bob-verification-failure")

    def test_poll_rendering_capture_is_attempted_when_state_observation_fails(self):
        gate = object.__new__(Gate)
        gate.active_social_scenario = "poll-single-choice"
        gate.report = SimpleNamespace(runtime={})
        gate.visible_element = Mock(side_effect=RuntimeError("state capture failed"))
        gate.capture = Mock()
        failure = GateError("original poll failure")
        with patch(
            "tooling.acceptance.gates.social.public_feed_native.wait_until",
            side_effect=failure,
        ):
            with self.assertRaises(GateError) as caught:
                gate.assert_poll("bob", "original-poll", "post", [1, 1], [1])
        self.assertIs(caught.exception, failure)
        gate.capture.assert_called_once_with(
            "bob", "poll-single-choice-bob-verification-failure")
        self.assertNotIn("pollFailureObservations", gate.report.runtime)

    def test_settled_poll_does_not_add_failure_observations_or_captures(self):
        gate = object.__new__(Gate)
        gate.report = SimpleNamespace(runtime={})
        gate.capture = Mock()
        with patch(
            "tooling.acceptance.gates.social.public_feed_native.wait_until",
            return_value=True,
        ) as wait:
            gate.assert_poll("bob", "original-poll", "post", [1, 1], [1])
        self.assertEqual(wait.call_args.kwargs["timeout"], 120)
        self.assertEqual(gate.report.runtime, {})
        gate.capture.assert_not_called()

    def test_original_circle_suite_declares_block_and_intermediate_epoch_without_extra_launches(self):
        self.assertIn("circle-block", SCENARIOS)
        self.assertIn("circle-account-epoch", SCENARIOS)
        ledger = SuiteRuntimeLedger(RUNTIME_REUSE, suite_runtime_id="circle-scope",
            source_digest="a" * 40, fixture_epoch="circle-scope")
        self.assertEqual(ledger.contract.max_client_launches, 4)
        self.assertEqual(tuple(ledger.contract.scenario_ids), SCENARIOS)

    def test_original_poll_checks_peer_availability_and_real_empty_activation(self):
        for disabled, aria_disabled, accepted in (
            (None, "true", True), ("true", None, True),
            (None, "false", False), (None, None, False),
        ):
            with self.subTest(disabled=disabled, aria_disabled=aria_disabled):
                gate = object.__new__(Gate)
                question = {"value": ""}
                publish = Mock()
                publish.get_attribute.side_effect = {
                    "disabled": disabled, "aria-disabled": aria_disabled,
                }.get
                field = Mock()
                field.get_attribute.side_effect = question.get
                card = Mock()
                card.get_attribute.return_value = "actual-object"
                lifecycle = {"open": True, "opens": 0, "reopenedReads": 0}

                def click(actor, selector):
                    if selector == '[data-action-id="compose.cancel"]':
                        lifecycle["open"] = False
                    elif selector == '[data-acceptance-id="social-composer-open"]':
                        lifecycle["open"] = True
                        lifecycle["opens"] += 1

                def visible(actor, selector):
                    if selector == 'textarea[data-moments-composer-input]':
                        return field if lifecycle["open"] else None
                    if selector.endswith('="social-poll-question"]'):
                        if lifecycle["opens"] == 2:
                            lifecycle["reopenedReads"] += 1
                            if lifecycle["reopenedReads"] == 1:
                                return None
                        return field if lifecycle["open"] else None
                    return publish

                gate.visible_element = Mock(side_effect=visible)
                gate.click = Mock(side_effect=click)
                gate.action = Mock(return_value={"pendingCount": 0, "verifiedSequence": "7"})
                gate.await_card = Mock(return_value=card)
                gate.set_input = Mock(side_effect=lambda actor, selector, value:
                    question.update(value=value) if selector.endswith('="social-poll-question"]') else None)

                def assert_condition(name, condition, *args):
                    if not condition:
                        raise GateError(name)

                gate.assert_condition = assert_condition
                if not accepted:
                    with self.assertRaisesRegex(GateError, "empty-poll-publication-disabled"):
                        gate.create_poll("original-poll")
                    gate.action.assert_not_called()
                    continue
                self.assertEqual(gate.create_poll("original-poll"), {
                    "alice": "actual-object", "bob": "actual-object",
                })
                self.assertEqual(gate.action.call_count, 2)
                self.assertEqual(lifecycle["reopenedReads"], 2)
                self.assertEqual(gate.click.call_args_list.count(
                    unittest.mock.call("alice", '[data-acceptance-id="social-composer-publish"]'),
                ), 2)

    def test_original_runner_accepts_the_capability_catalog_launch(self):
        runner = runpy.run_path(str(ROOT / "tooling/scripts/acceptance-run.py"))
        definition = runner["load_gate_definitions"](ROOT / "tooling/acceptance/gates.yaml")[GATE_ID]
        launch = runner["gate_launch_fields"](GATE_ID, definition)
        self.assertEqual(launch, {
            "argv": ["python3", "-m", "tooling.acceptance.gates.social.public_feed_native"],
            "ephemeralCapabilities": ["social-feed-notification", "social-relay-opaque"],
        })
        invalid = dict(definition)
        invalid["command"] = " ".join(invalid.pop("argv"))
        with self.assertRaisesRegex(SystemExit, "ephemeralCapabilities requires argv"):
            runner["gate_launch_fields"](GATE_ID, invalid)

    def binding(self):
        catalog = ROOT / "tooling/acceptance/gates.yaml"
        definitions = load_catalog(catalog)
        return preflight_binding(prepare_e2e(
            definitions, compile_graph(definitions, [GATE_ID]),
            source_identity(ROOT), repo_root=ROOT, catalog_path=catalog,
            execution_policy="development",
        ))

    def test_original_social_constructor_consumes_its_parent_scope(self):
        with patch.dict(os.environ, {PREFLIGHT_ENV: self.binding()}), patch.object(
            Gate, "__init__", return_value=None,
        ):
            gate = Gate()
        self.assertEqual(gate.e2e_preflight["selectedGateIds"], [GATE_ID])
        self.assertEqual(gate.e2e_preflight["dispatchGateIds"], [GATE_ID])

    def test_inherited_chat_identity_is_rejected_before_construction(self):
        with patch.dict(os.environ, {PREFLIGHT_ENV: self.binding()}), patch.object(
            Gate, "gate_id", "chat-device-search-native-e2e",
        ), patch.object(Gate, "__init__", return_value=None) as constructor:
            with self.assertRaisesRegex(ExecutionBudgetError, "outside E2E request closure"):
                Gate()
        constructor.assert_not_called()

    def test_original_run_binds_runner_workspace_digest_before_fixture_work(self):
        current = source_identity(ROOT)
        for workspace_digest, expected in (
            (current["workspaceDigest"], current["workspaceDigest"].removeprefix("sha256:")),
            ("clean", current["commit"]),
        ):
            with self.subTest(workspace_digest=workspace_digest):
                gate = object.__new__(Gate)
                gate.manifest = {
                    "source": {**current, "workspaceDigest": workspace_digest},
                    "runId": "source-binding-fixture",
                }
                gate.actor_manifest = {"runId": "source-binding-fixture"}
                gate.active_social_scenario = None
                gate.report = SimpleNamespace(runtime={})
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.SuiteRuntimeLedger",
                    wraps=SuiteRuntimeLedger,
                ) as ledger, patch.object(
                    gate, "verify_fixture_ready", side_effect=RuntimeError("fixture boundary"),
                ), patch.object(gate, "cleanup_clients", return_value={}):
                    with self.assertRaisesRegex(RuntimeError, "fixture boundary"):
                        gate.run()
                self.assertEqual(ledger.call_args.kwargs["source_digest"], expected)

    def test_original_run_retains_owned_cleanup_details_beside_primary_failure(self):
        current = source_identity(ROOT)
        gate = object.__new__(Gate)
        gate.manifest = {"source": current, "runId": "source-binding-fixture"}
        gate.actor_manifest = {"runId": "source-binding-fixture"}
        gate.active_social_scenario = None
        gate.report = SimpleNamespace(runtime={})
        cleanup = {"portsReleased": True, "processesReleased": True,
                   "storageReleased": True, "logsReleased": True,
                   "cleanupErrors": [{"resource": "session:alice", "error": "typed refusal"}]}
        with patch.object(gate, "verify_fixture_ready", side_effect=RuntimeError("fixture boundary")), \
             patch.object(gate, "cleanup_clients", return_value=cleanup):
            with self.assertRaisesRegex(RuntimeError, "fixture boundary"):
                gate.run()
        self.assertEqual(gate.report.runtime["cleanup"], cleanup)
        self.assertIn("cleanupFailure", gate.report.runtime)

    def test_original_run_rejects_invalid_workspace_digest_before_fixture_work(self):
        gate = object.__new__(Gate)
        gate.manifest = {
            "source": {"commit": "a" * 40, "workspaceDigest": "sha256:invalid"},
            "runId": "source-binding-fixture",
        }
        gate.actor_manifest = {"runId": "source-binding-fixture"}
        with patch.object(gate, "verify_fixture_ready") as fixture:
            with self.assertRaisesRegex(SuiteRuntimeError, "SUITE_RUNTIME_SOURCE_INVALID"):
                gate.run()
        fixture.assert_not_called()

    def test_station_source_uses_app_meta_contract_before_client_launch(self):
        commit = "a" * 40
        for version, accepted in (
            ({"build_commit": commit}, True),
            ({"build_commit": "b" * 40}, False),
            ({"commit": commit}, False),
            ({}, False),
        ):
            with self.subTest(version=version):
                gate = object.__new__(Gate)
                gate.manifest = {
                    "source": {"commit": commit, "workspaceDigest": "clean"},
                    "runId": "version-contract-fixture",
                }
                gate.actor_manifest = {"runId": "version-contract-fixture"}
                gate.client_specs = {
                    "alice": {"actor": "alice"},
                    "bob": {"actor": "bob"},
                    "bob2": {"actor": "bob"},
                }
                gate.active_social_scenario = None
                gate.report = SimpleNamespace(runtime={}, add_assertion=Mock())
                gate.clients = {"bob": Mock()}
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.read_station_version",
                    return_value=version,
                ), patch(
                    "tooling.acceptance.gates.social.public_feed_native.runtime_station_service",
                    side_effect=lambda manifest, actor: {
                        "endpoint": f"http://{actor}.invalid",
                        "runtimeIdentity": actor,
                    },
                ), patch.object(
                    gate, "verify_fixture_ready",
                ), patch.object(
                    gate, "start_client",
                ) as launch, patch(
                    "tooling.acceptance.gates.social.public_feed_native._prepare_portable_recovery",
                    return_value=("private-recovery-material", {"preparedEpoch": 1}),
                ) as prepare_recovery, patch.object(
                    gate, "source_identity", side_effect=RuntimeError("source identity boundary"),
                ), patch.object(gate, "cleanup_clients", return_value={}):
                    if accepted:
                        with self.assertRaisesRegex(RuntimeError, "source identity boundary"):
                            gate.run()
                        self.assertEqual(launch.call_count, 3)
                        self.assertEqual([call.args[0] for call in launch.call_args_list],
                                         ["alice", "bob", "bob2"])
                        prepare_recovery.assert_called_once()
                        self.assertTrue(callable(
                            launch.call_args_list[2].kwargs["prepare_authenticated_device"]))
                    else:
                        with self.assertRaisesRegex(GateError, "alice-station-source"):
                            gate.run()
                        launch.assert_not_called()
                        prepare_recovery.assert_not_called()

    def test_original_launch_restores_authenticated_device_before_engine_hydration(self):
        from tooling.acceptance.gates.chat.native_two_client_runner import NativeTwoClientGate

        gate = object.__new__(Gate)
        client = Mock()
        client.get_current_url.return_value = "tauri://localhost/"
        gate.runtime_binding = Mock()
        gate.runtime_binding.create_bound_session.return_value = client
        gate.client_specs = {"bob2": {"actor": "bob"}}
        gate.actor_specs = {"bob2": {
            "ptid": "ptid:bob", "accountRef": "station-account:bob",
        }}
        gate.manifest = {}
        gate.runtime_instances = []
        gate.runtime_instance_actors = {}
        gate.client_lifecycles = Mock()
        gate.station_access = {}
        gate.clients = {}
        gate.ptids = {}
        gate.device_ids = {}
        gate.account_login_client = None
        gate.report = SimpleNamespace(add_actor=Mock())
        calls = []
        recovered = False

        def harness(session, method, payload, **kwargs):
            self.assertIs(session, client)
            calls.append(method)
            if method == "loginWithPassword":
                return {"authenticated": True}
            if method == "hydrateActiveActor":
                if not recovered:
                    raise RuntimeError("messaging profile engine is not active")
                return {"actorPtid": "ptid:bob"}
            if method == "getRealtimeDevice":
                return {"active": True, "deviceId": "bob-second-device"}
            raise AssertionError(method)

        def restore(session):
            nonlocal recovered
            self.assertIs(session, client)
            gate.client_lifecycles.mark_authenticated.assert_called_once_with(client)
            calls.append("restore-original-device")
            recovered = True

        with patch.object(gate, "configure_station_access", return_value={}), patch.object(
            gate, "register_driver",
        ), patch(
            "tooling.acceptance.gates.chat.native_two_client_runner.runtime_station_service",
            return_value={"endpoint": "http://reviewed-station"},
        ), patch(
            "tooling.acceptance.gates.chat.native_two_client_runner.call_async_harness",
            return_value={"phase": "bound", "activeUrl": "http://reviewed-station"},
        ), patch(
            "tooling.acceptance.gates.chat.native_two_client_runner.async_harness",
            side_effect=harness,
        ):
            NativeTwoClientGate.start_client(
                gate, "bob2", prepare_authenticated_device=restore)
        self.assertEqual(calls, [
            "loginWithPassword", "restore-original-device",
            "hydrateActiveActor", "getRealtimeDevice",
        ])
        self.assertEqual(gate.ptids["bob2"], "ptid:bob")
        self.assertEqual(gate.device_ids["bob2"], "bob-second-device")

    def test_original_suite_recovery_failure_retains_launch_failure(self):
        gate = object.__new__(Gate)
        gate.manifest = {}
        gate.client_specs = {"alice": {}, "bob": {}, "bob2": {}}
        gate.clients = {"bob": Mock()}
        gate.report = SimpleNamespace(runtime={})
        gate.assert_condition = Mock()
        calls = []
        failure = RuntimeError("original-recovery-failure")

        def launch(actor, **kwargs):
            calls.append(actor)
            if actor == "bob2":
                kwargs["prepare_authenticated_device"](Mock())

        with patch(
            "tooling.acceptance.gates.social.public_feed_native.runtime_station_service",
            return_value={"endpoint": "http://reviewed-station"},
        ), patch(
            "tooling.acceptance.gates.social.public_feed_native.read_station_version",
            return_value={"build_commit": "a" * 40},
        ), patch(
            "tooling.acceptance.gates.social.public_feed_native._prepare_portable_recovery",
            return_value=("private-recovery-material", {"preparedEpoch": 1}),
        ), patch(
            "tooling.acceptance.gates.social.public_feed_native._restore_portable_recovery",
            side_effect=failure,
        ), patch.object(gate, "start_client", side_effect=launch):
            with self.assertRaises(RuntimeError) as raised:
                gate.start_suite_clients(Mock(), "a" * 40)
        self.assertIs(raised.exception, failure)
        self.assertEqual(calls, ["alice", "bob", "bob2"])
        self.assertNotIn("secondDeviceRecovery", gate.report.runtime)


if __name__ == "__main__":
    unittest.main()
