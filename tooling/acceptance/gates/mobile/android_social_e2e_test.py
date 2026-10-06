from __future__ import annotations

import unittest
import threading
from unittest.mock import patch

from tooling.acceptance.core import (
    EnvironmentContract,
    EphemeralCapabilityBlocked,
)
from tooling.acceptance.gates.mobile.android_social_e2e import (
    CLIENT_ID,
    ENVIRONMENT_ID,
    GATE_ID,
    RUNTIME_REUSE,
    SCENARIO_IDS,
    AndroidSocialGate,
    _ActorController,
)
from tooling.acceptance.gates.mobile.messaging_journey import MessagingActor
from tooling.acceptance.provisioners import get_provisioner
from tooling.acceptance.provisioners.mobile_native import (
    MOBILE_NATIVE_ANDROID_SOCIAL_APPIUM_OPERATIONS,
    MOBILE_NATIVE_ANDROID_SOCIAL_FIXTURE,
    MobileAndroidPhysicalProvisioner,
    _mobile_social_ui_operation,
    load_mobile_native_preflight_spec,
)
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR


class _Session:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def call_action(self, action: str, payload: object = None) -> object:
        self.calls.append((action, payload))
        return {"loggedOut": True}


class _ParentSession:
    def execute_script(
        self,
        _script: str,
        *_args: object,
        **_kwargs: object,
    ) -> object:
        return {
            "exists": True,
            "text": "visible",
            "attributes": {"data-acceptance-id": "social-moments-page"},
        }


class AndroidSocialGateTests(unittest.TestCase):
    @staticmethod
    def _actor(role: str) -> MessagingActor:
        return MessagingActor(
            client_id=CLIENT_ID,
            role=role,
            station_url="https://station.example.test",
            station_peer_id="station-peer",
            ptid=f"ptid:{role}",
            account_ref=f"station-account:{role}",
            federated_handle=f"@{role}@station.example.test",
            federation_id="station-peer",
        )

    def test_runtime_reuse_matches_rc02_task_contract(self) -> None:
        self.assertEqual(RUNTIME_REUSE.scenario_ids, SCENARIO_IDS)
        self.assertEqual(RUNTIME_REUSE.max_provisioning_runs, 1)
        self.assertEqual(RUNTIME_REUSE.max_client_launches, 3)
        self.assertGreaterEqual(RUNTIME_REUSE.min_warm_reuse_rate, 0.8)
        self.assertFalse(RUNTIME_REUSE.allow_client_replacement)

    def test_gate_claim_is_physical_android_and_scope_limited(self) -> None:
        result = AndroidSocialGate()._result_base("PASS")
        self.assertEqual(result["gateId"], GATE_ID)
        self.assertEqual(result["environment"], ENVIRONMENT_ID)
        self.assertEqual(result["runtimeCell"], "MPS-RC02")
        self.assertTrue(result["physicalDeviceClaimed"])
        self.assertIn(
            "full SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN",
            result["unprovenScope"],
        )

    def test_actor_controller_logs_out_before_switch_without_reset(self) -> None:
        session = _Session()
        actors = {
            role: self._actor(role)
            for role in ("alice", "bob", "eve")
        }
        controller = _ActorController(session, actors)  # type: ignore[arg-type]
        with patch.object(
            controller.journey,
            "authenticate",
            side_effect=lambda _session, actor, **_kwargs: {
                "clientId": actor.client_id,
                "stationPeerId": actor.station_peer_id,
                "actorPtid": actor.ptid,
            },
        ) as authenticate:
            controller.activate("alice")
            controller.activate("alice")
            controller.activate("bob")

        self.assertEqual(authenticate.call_count, 2)
        self.assertEqual(
            session.calls,
            [
                (
                    "session.logout",
                    {"draftDisposition": "discard"},
                )
            ],
        )
        self.assertEqual(controller.active_role, "bob")

    def test_android_social_scenario_selects_one_physical_client(self) -> None:
        spec = load_mobile_native_preflight_spec(
            ENVIRONMENTS_DIR / "mobile-android-physical-runtime.yaml",
            gate_id=GATE_ID,
        )
        self.assertEqual(spec.scenario.id, "android-social")
        self.assertEqual(spec.scenario.client_ids, (CLIENT_ID,))
        self.assertEqual(spec.scenario.service_ids, ("station-primary",))
        self.assertEqual(
            spec.scenario.fixture_ids,
            (MOBILE_NATIVE_ANDROID_SOCIAL_FIXTURE,),
        )
        self.assertEqual(
            spec.scenario.appium_operations,
            MOBILE_NATIVE_ANDROID_SOCIAL_APPIUM_OPERATIONS,
        )
        self.assertEqual(
            [(client.id, client.platform) for client in spec.clients],
            [(CLIENT_ID, "android")],
        )

    def test_android_physical_environment_resolves_registered_provisioner(
        self,
    ) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "mobile-android-physical.yaml"
        )
        provisioner = get_provisioner(
            contract,
            station_profiles={"station-a": "three"},
        )
        self.assertIsInstance(
            provisioner,
            MobileAndroidPhysicalProvisioner,
        )
        self.assertEqual(provisioner.environment_id, ENVIRONMENT_ID)

    def test_parent_owned_social_ui_rejects_unscoped_selector(self) -> None:
        with self.assertRaisesRegex(
            EphemeralCapabilityBlocked,
            "acceptance-scoped",
        ):
            _mobile_social_ui_operation(
                _ParentSession(),  # type: ignore[arg-type]
                {
                    "uiAction": "query",
                    "input": {"selector": "body"},
                },
                deadline_monotonic=float("inf"),
                cancellation=threading.Event(),
            )

    def test_parent_owned_social_ui_returns_only_visible_projection(
        self,
    ) -> None:
        result = _mobile_social_ui_operation(
            _ParentSession(),  # type: ignore[arg-type]
            {
                "uiAction": "query",
                "input": {
                    "selector": (
                        '[data-acceptance-id="social-moments-page"]'
                    )
                },
            },
            deadline_monotonic=float("inf"),
            cancellation=threading.Event(),
        )
        self.assertEqual(result["text"], "visible")
        self.assertNotIn("serial", result)


if __name__ == "__main__":
    unittest.main()
