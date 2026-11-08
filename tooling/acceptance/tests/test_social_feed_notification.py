"""Focused parent boundary checks; fake SSH never supplies product proof."""
import json
from pathlib import Path
from types import SimpleNamespace
import threading
import time
import unittest
from unittest.mock import patch

from tooling.acceptance.fixtures import social_feed_notification as parent


class FixtureTransport:
    def __init__(self):
        self.calls = []
        self.rule = None
        self.commit = "a" * 40
        self.cleanup_fails = False

    def run_argv(self, argv, **options):
        self.calls.append((argv, options))
        if argv[1] == "inspect":
            return SimpleNamespace(stdout=f"{self.commit}|pt-fixture|station|true|1")
        operation = argv[-1]
        if operation == "arm":
            self.rule = json.loads(options["input_text"])
            return SimpleNamespace(stdout="ARMED")
        if operation == "read":
            return SimpleNamespace(stdout=json.dumps(self.rule))
        if self.cleanup_fails:
            raise OSError("transport unavailable")
        self.rule = None
        return SimpleNamespace(stdout="CLEARED")


class ParentBoundaryTest(unittest.TestCase):
    def owner(self):
        return parent.SocialFeedNotificationHandler(
            deployment={
                "PT_DEPLOY_HOST": "fixture.invalid", "PT_DEPLOY_USER": "fixture",
                "PT_DEPLOY_ROLE": "station",
                "PT_DEPLOY_BUILD_CMD": "docker compose -p pt-fixture build station",
                "PEERS_AUTH_SECRET": "must-not-be-retained",
            },
            run_id="20261108T171148023763Z-afe5f8ecb507de907b142d87efb29c12",
            profile="fixture", commit="a" * 40, station="receiver", source_station="source",
        )

    def invoke(self, owner, operation, payload=None):
        return owner.invoke(
            operation, payload or {},
            deadline_monotonic=time.monotonic() + 10,
            cancellation=threading.Event(),
        )

    def test_actual_rule_uses_stdin_and_response_has_no_actor_or_deployment_secrets(self):
        transport, owner = FixtureTransport(), self.owner()
        with patch.object(parent, "_remote_transport", return_value=transport):
            self.assertEqual(self.invoke(owner, "arm", {
                "actorPtid": "ptid:author", "minimumHead": 7,
            }), {"armed": True})
            argv, options = transport.calls[-1]
            self.assertNotIn("ptid:author", " ".join(argv))
            self.assertEqual(json.loads(options["input_text"])["actor"], "ptid:author")
            self.assertNotIn("PEERS_AUTH_SECRET", owner._deployment)
            transport.rule.update(
                effectCount=1, observedHead=7, frameSha256="b" * 64,
                repairReads=1, maxEvents=32, maxThreads=31, maxBytes=1000,
                repairApplied=True, repairAfterSequence=6, repairVerifiedHead=7,
            )
            observation = self.invoke(owner, "read")
            self.assertEqual(observation["effectCount"], 1)
            self.assertEqual(observation["repairReads"], 1)
            self.assertNotIn("ptid:author", json.dumps(observation))
            self.assertNotIn("receiver", json.dumps(observation))
            owner.project_response("read", {"status": "OK", "result": observation})
            self.assertEqual(self.invoke(owner, "clear"), {"cleared": True})
            self.assertTrue(owner.close().closed)

    def test_foreign_live_image_is_rejected_before_creating_any_control(self):
        transport, owner = FixtureTransport(), self.owner()
        transport.commit = "b" * 40
        with patch.object(parent, "_remote_transport", return_value=transport):
            with self.assertRaises(parent.EphemeralCapabilityBlocked):
                self.invoke(owner, "arm", {"actorPtid": "ptid:author", "minimumHead": 7})
        self.assertEqual(len(transport.calls), 1)
        self.assertFalse(owner._root_may_exist)

    def test_changed_rule_identity_or_invalid_frame_never_projects_a_proof(self):
        for field, value in (
            ("actor", "ptid:foreign"), ("commit", "b" * 40),
            ("sourceStation", "foreign"), ("minimumHead", 8),
            ("effectCount", 2), ("repairReads", True), ("frameSha256", "bad"),
            ("repairApplied", True),
            ("unknown", "field"),
        ):
            with self.subTest(field=field):
                transport, owner = FixtureTransport(), self.owner()
                with patch.object(parent, "_remote_transport", return_value=transport):
                    self.invoke(owner, "arm", {"actorPtid": "ptid:author", "minimumHead": 7})
                    transport.rule[field] = value
                    with self.assertRaises(parent.EphemeralCapabilityBlocked):
                        self.invoke(owner, "read")
                    self.assertTrue(owner.close().closed)

    def test_cancelled_operation_cannot_touch_ssh_and_cleanup_failure_is_not_success(self):
        transport, owner = FixtureTransport(), self.owner()
        cancellation = threading.Event()
        cancellation.set()
        with patch.object(parent, "_remote_transport", return_value=transport):
            with self.assertRaises(parent.EphemeralCapabilityBlocked):
                owner.invoke("arm", {"actorPtid": "ptid:author", "minimumHead": 7},
                             deadline_monotonic=time.monotonic() + 10,
                             cancellation=cancellation)
            self.assertEqual(transport.calls, [])
            self.invoke(owner, "arm", {"actorPtid": "ptid:author", "minimumHead": 7})
            transport.cleanup_fails = True
            self.assertFalse(owner.close().closed)
            self.assertTrue(owner._root_may_exist)
            transport.cleanup_fails = False
            self.assertTrue(owner.close().closed)
            self.assertFalse(owner._root_may_exist)

    def test_control_shell_has_valid_posix_syntax(self):
        import subprocess
        checked = subprocess.run(
            ["sh", "-n"], input=parent.CONTROL_SCRIPT, text=True,
            capture_output=True, timeout=5,
        )
        self.assertEqual(checked.returncode, 0, checked.stderr)


if __name__ == "__main__":
    unittest.main()
