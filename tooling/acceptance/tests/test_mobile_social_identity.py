from pathlib import Path
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from tooling.acceptance.core import EphemeralCapabilityBlocked
from tooling.acceptance.provisioners.mobile_social_identity import (
    MobileSocialIdentityHandler,
)


class MobileSocialIdentityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.session = Mock()
        self.session.device.identifier = "owned-simulator"
        self.session.transport.request.return_value = [
            {"id": "owned-session", "capabilities": {"udid": "owned-simulator"}}
        ]
        self.session.call_action.return_value = {"prepared": True}
        self.handler = MobileSocialIdentityHandler(
            session_factory=lambda _: self.session,
            station_url="https://station.example",
            station_peer_id="station-peer",
        )
        self.payload = {
            "clientId": "sim-ios", "sessionId": "owned-session", "role": "alice",
        }

    def test_only_owned_simulator_receives_retained_identity(self) -> None:
        seed = bytearray([7] * 32)
        identity = SimpleNamespace(
            fixture=SimpleNamespace(root=str(Path("/protected/fixture"))),
            actor=SimpleNamespace(ptid="ptid:alice"),
        )
        with (
            patch(
                "tooling.acceptance.provisioners.mobile_social_identity."
                "resolve_existing_preset_actor_identity",
                return_value=identity,
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_social_identity."
                "_read_private_seed",
                return_value=seed,
            ),
        ):
            result = self.handler.invoke(
                "prepare", self.payload,
                deadline_monotonic=time.monotonic() + 30,
                cancellation=threading.Event(),
            )
        self.assertEqual(result, {"prepared": True})
        self.assertEqual(seed, bytearray(32))
        self.assertEqual(self.session.session_id, "")
        self.assertEqual(
            self.session.call_action.call_args.args[0],
            "runtime.prepareActorIdentity",
        )
        self.assertNotIn("seedBase64", result)

    def test_foreign_simulator_is_rejected_before_reading_identity(self) -> None:
        self.session.transport.request.return_value[0]["capabilities"]["udid"] = (
            "foreign-simulator"
        )
        with (
            patch(
                "tooling.acceptance.provisioners.mobile_social_identity."
                "resolve_existing_preset_actor_identity",
            ) as resolve,
            self.assertRaises(EphemeralCapabilityBlocked),
        ):
            self.handler.invoke(
                "prepare", self.payload,
                deadline_monotonic=time.monotonic() + 30,
                cancellation=threading.Event(),
            )
        resolve.assert_not_called()

    def test_closed_handler_cannot_prepare_identity(self) -> None:
        self.handler.close()
        with self.assertRaises(EphemeralCapabilityBlocked):
            self.handler.invoke(
                "prepare", self.payload,
                deadline_monotonic=time.monotonic() + 30,
                cancellation=threading.Event(),
            )

    def test_projection_preserves_framework_envelope(self) -> None:
        envelope = {
            "requestId": "request-1", "status": "OK",
            "result": {"prepared": True}, "error": None,
        }
        self.assertEqual(self.handler.project_response("prepare", envelope), envelope)
        blocked = {
            "requestId": "request-2", "status": "BLOCKED", "result": None,
            "error": {"code": "FIXTURE_MISSING"},
        }
        self.assertEqual(self.handler.project_response("prepare", blocked), blocked)
