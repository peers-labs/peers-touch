"""Private hold lifetime and scope checks; transports never prove product PASS."""
import json
from pathlib import Path
from types import SimpleNamespace
import threading
import time
import unittest
from unittest.mock import patch

from tooling.acceptance.fixtures import social_private_delivery as module


class HoldTransport:
    def __init__(self):
        self.calls, self.rule = [], None
        self.scope = "a" * 40 + "|pt-fixture|station|true|1|" + "b" * 16 + "|fixture"
        self.fail_arm, self.fail_clear = False, False

    def run_argv(self, argv, **options):
        self.calls.append((argv, options))
        if argv[1] == "inspect":
            return SimpleNamespace(returncode=0, stdout=self.scope)
        operation = argv[-1]
        if operation == "arm":
            self.rule = json.loads(options["input_text"])
            return SimpleNamespace(returncode=int(self.fail_arm), stdout="ARMED")
        if operation == "read":
            return SimpleNamespace(returncode=0, stdout=json.dumps(self.rule))
        if self.fail_clear:
            return SimpleNamespace(returncode=1, stdout="")
        self.rule = None
        return SimpleNamespace(returncode=0, stdout="CLEARED")


class PrivateHoldTest(unittest.TestCase):
    def owner(self, profile="fixture"):
        deployment = {
            "PT_DEPLOY_ROLE": "station", "PT_DEPLOY_HOST": "fixture.invalid",
            "PT_DEPLOY_USER": "fixture",
            "PT_DEPLOY_BUILD_CMD": "docker compose -p pt-fixture build station",
        }
        owner = module.SocialPrivateDeliveryHandler(
            repo_root=Path(__file__).resolve().parents[3], source_commit="a" * 40,
            run_id="b" * 16, source_deployment=deployment, receiver_deployment=deployment,
            source_station="source", receiver_station="receiver", receiver_origin="https://fixture.invalid",
            receiver_actor="ptid:bob", outsider_actor="ptid:eve", receiver_profile=profile,
        )
        owner._installed = {"source": "c" * 64, "receiver": "c" * 64}
        return owner

    def invoke(self, owner, operation, payload=None, cancellation=None):
        return owner.invoke(operation, payload or {}, deadline_monotonic=time.monotonic() + 10,
                            cancellation=cancellation or threading.Event())

    def test_rule_uses_stdin_and_retains_one_parent_scope_until_release(self):
        owner, transport = self.owner(), HoldTransport()
        with patch.object(module, "_remote_transport", return_value=transport):
            self.assertEqual(self.invoke(owner, "hold"), {"held": True})
            argv, options = transport.calls[-1]
            self.assertNotIn("ptid:bob", " ".join(argv))
            self.assertEqual(json.loads(options["input_text"])["actor"], "ptid:bob")
            self.assertEqual(transport.rule["expiresMillis"] - transport.rule["issuedMillis"], 90_000)
            transport.rule.update(effectCount=2, frameSha256="d" * 64)
            value = self.invoke(owner, "read-hold")
            self.assertEqual(value["effectCount"], 2)
            self.assertNotIn("ptid:bob", json.dumps(value))
            owner.project_response("read-hold", {"status": "OK", "result": value})
            self.assertEqual(self.invoke(owner, "release"), {"released": True})
            self.assertFalse(owner._hold_attempted)

    def test_foreign_runtime_or_profile_cannot_arm(self):
        for scope in ("foreign", HoldTransport().scope.replace("|fixture", "|other")):
            owner, transport = self.owner(), HoldTransport()
            transport.scope = scope
            with patch.object(module, "_remote_transport", return_value=transport):
                with self.assertRaises(module.EphemeralCapabilityBlocked):
                    self.invoke(owner, "hold")
            self.assertEqual(len(transport.calls), 1)
            self.assertFalse(owner._hold_attempted)
        with self.assertRaises(ValueError):
            self.owner("corpstable")

    def test_changed_rule_or_invalid_counter_never_projects(self):
        for key, value in (
            ("actor", "ptid:eve"), ("sourceStation", "foreign"), ("profile", "other"),
            ("effectCount", True), ("effectCount", -1), ("frameSha256", "foreign"),
            ("unknown", "field"),
        ):
            with self.subTest(key=key, value=value):
                owner, transport = self.owner(), HoldTransport()
                with patch.object(module, "_remote_transport", return_value=transport):
                    self.invoke(owner, "hold")
                    transport.rule[key] = value
                    with self.assertRaises(module.EphemeralCapabilityBlocked):
                        self.invoke(owner, "read-hold")
                    self.assertTrue(owner.close().closed)

    def test_unknown_arm_and_failed_cleanup_retain_owner_until_retry(self):
        owner, transport = self.owner(), HoldTransport()
        transport.fail_arm = transport.fail_clear = True
        with patch.object(module, "_remote_transport", return_value=transport):
            with self.assertRaises(module.EphemeralCapabilityBlocked):
                self.invoke(owner, "hold")
            self.assertTrue(owner._hold_attempted)
            self.assertFalse(owner.close().closed)
            self.assertTrue(owner._hold_scope)
            transport.fail_clear = False
            self.assertTrue(owner.close().closed)
            self.assertFalse(owner._hold_scope)

    def test_payload_and_cancellation_fail_before_transport(self):
        owner, transport = self.owner(), HoldTransport()
        cancelled = threading.Event()
        cancelled.set()
        with patch.object(module, "_remote_transport", return_value=transport):
            for payload, cancellation in (({"actor": "ptid:eve"}, None), ({}, cancelled)):
                with self.assertRaises(module.EphemeralCapabilityBlocked):
                    self.invoke(owner, "hold", payload, cancellation)
        self.assertEqual(transport.calls, [])
