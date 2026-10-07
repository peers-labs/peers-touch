from __future__ import annotations

import unittest

from tooling.acceptance.core import ArtifactRef
from tooling.acceptance.gates.mobile.simulator_runtime_binding import (
    MobileSimulatorBindingActivation,
)
from tooling.acceptance.gates.mobile.simulator_settings_e2e import (
    GATE_ID,
    IOS_CLIENT,
    PEER_IOS_CLIENT,
    SimulatorSettingsGate,
)


RUN_ID = "20260920T120000000000Z-" + ("1" * 32)
WORKSPACE_ID = "a" * 16


def _proof(client_id: str, role: str) -> ArtifactRef:
    return ArtifactRef(
        workspace_id=WORKSPACE_ID,
        gate_id=GATE_ID,
        run_id=RUN_ID,
        path=f"runtime/bindings/{client_id}/{role}.json",
        sha256="b" * 64,
        media_type="application/json",
    )


def _activation(
    client_id: str,
    roles: tuple[str, ...],
) -> MobileSimulatorBindingActivation:
    return MobileSimulatorBindingActivation(
        client_id=client_id,
        launch_generation=1,
        identity={
            "runtime": "simulator",
            "instanceId": f"{client_id}-1",
            "identityDigest": "c" * 64,
        },
        scope={
            "generation": 1,
            "phase": "ACTIVE",
            "launchState": "station-selection",
            "activeStationPeerId": "station-primary-peer",
            "activeActorPtid": None,
            "runtimeStationPeerId": None,
            "deviceId": f"device-{client_id}",
            "social": {
                "stationPeerId": None,
                "actorPtid": None,
                "sessionCount": 0,
                "requestCount": 0,
                "messageThreadCount": 0,
            },
            "navigation": {
                "primaryRouteId": "tab:chat",
                "detailKeys": [],
                "overlayRouteId": None,
            },
        },
        active_binding_role="station-primary",
        binding_proofs={role: _proof(client_id, role) for role in roles},
    )


class _Binding:
    def __init__(self) -> None:
        self.profile = {
            "actorPtid": "ptid:alice",
            "profileRevision": "1",
            "displayName": "Alice",
            "note": "",
            "region": "",
            "timezone": "",
            "defaultVisibility": "followers",
            "manuallyApprovesFollowers": False,
            "messagePermission": "friends",
            "autoExpireDays": 30,
        }
        self.notification = {
            "category": 1,
            "enabled": True,
            "pushEnabled": True,
            "soundEnabled": True,
        }
        self.notification_revision = 1
        self.devices = {
            IOS_CLIENT: {
                "theme": "system",
                "fontSize": "medium",
                "compactMode": False,
                "mediaAutoDownload": True,
            },
            PEER_IOS_CLIENT: {
                "theme": "light",
                "fontSize": "small",
                "compactMode": True,
                "mediaAutoDownload": False,
            },
        }
        self.calls: list[tuple[str, str, object]] = []
        self.closed = False

    def create_bound_session(
        self,
        client_id: str,
    ) -> MobileSimulatorBindingActivation:
        roles = (
            ("station-primary", "station-secondary")
            if client_id == IOS_CLIENT
            else ("station-primary",)
        )
        return _activation(client_id, roles)

    def authenticate_fixture_actor(self, client_id: str) -> dict[str, object]:
        self.calls.append((client_id, "authenticate", None))
        return {
            "preAuthenticationScope": {},
            "login": {
                "session": {
                    "stationPeerId": "station-primary-peer",
                    "actorPtid": "ptid:alice",
                }
            },
        }

    def call_action(
        self,
        client_id: str,
        action: str,
        payload: object = None,
    ) -> object:
        self.calls.append((client_id, action, payload))
        if action == "settings.profile.read":
            return dict(self.profile)
        if action == "settings.profile.update":
            assert isinstance(payload, dict)
            self.profile.update(payload)
            self.profile["profileRevision"] = str(
                int(self.profile["profileRevision"]) + 1
            )
            return {"outcome": 1, "profile": dict(self.profile)}
        if action == "settings.notifications.read":
            return {
                "revision": str(self.notification_revision),
                "preferences": [dict(self.notification)],
            }
        if action == "settings.notifications.update":
            assert isinstance(payload, dict)
            self.notification.update(payload)
            self.notification_revision += 1
            return {
                "outcome": 1,
                "snapshot": {
                    "revision": str(self.notification_revision),
                    "preferences": [dict(self.notification)],
                },
            }
        if action == "settings.device.read":
            return dict(self.devices[client_id])
        if action == "settings.device.update":
            assert isinstance(payload, dict)
            self.devices[client_id] = dict(payload)
            return dict(payload)
        if action == "lifecycle.restart":
            return {"requested": True, "scope": "webview"}
        if action == "cleanup":
            return {"cleared": True}
        raise AssertionError(action)

    def close(self) -> tuple[str, ...]:
        self.closed = True
        return (PEER_IOS_CLIENT, IOS_CLIENT)


class SimulatorSettingsGateTests(unittest.TestCase):
    def test_same_account_converges_and_device_settings_remain_local(self) -> None:
        binding = _Binding()
        original_profile = dict(binding.profile)
        original_notification = dict(binding.notification)
        original_ios_device = dict(binding.devices[IOS_CLIENT])
        original_peer_device = dict(binding.devices[PEER_IOS_CLIENT])
        gate = SimulatorSettingsGate(binding_factory=lambda: binding)  # type: ignore[arg-type]

        result = gate._run_journey(binding, "journey-1")  # type: ignore[arg-type]

        self.assertEqual(result["actorPtid"], "ptid:alice")
        self.assertTrue(result["deviceIsolation"])
        self.assertTrue(result["sessionReplacementObserved"])
        self.assertEqual(binding.devices[PEER_IOS_CLIENT], original_peer_device)
        self.assertNotEqual(binding.devices[IOS_CLIENT], original_ios_device)
        self.assertEqual(
            set(result["bindingProofs"][IOS_CLIENT]),
            {"station-primary", "station-secondary"},
        )

        self.assertIsNone(gate._cleanup(binding))  # type: ignore[arg-type]
        self.assertEqual(
            {
                field: binding.profile[field]
                for field in original_profile
                if field != "profileRevision"
            },
            {
                field: value
                for field, value in original_profile.items()
                if field != "profileRevision"
            },
        )
        self.assertGreater(
            int(binding.profile["profileRevision"]),
            int(original_profile["profileRevision"]),
        )
        self.assertEqual(binding.notification, original_notification)
        self.assertEqual(binding.devices[IOS_CLIENT], original_ios_device)
        self.assertTrue(binding.closed)

    def test_cleanup_reports_restore_failure_without_skipping_runtime_close(
        self,
    ) -> None:
        binding = _Binding()
        gate = SimulatorSettingsGate(binding_factory=lambda: binding)  # type: ignore[arg-type]
        gate._active_clients.extend((IOS_CLIENT, PEER_IOS_CLIENT))
        gate._profile_restore = {"displayName": "Alice"}
        original_call_action = binding.call_action

        def fail_profile_restore(
            client_id: str,
            action: str,
            payload: object = None,
        ) -> object:
            if action == "settings.profile.update":
                raise RuntimeError("restore failed")
            return original_call_action(client_id, action, payload)

        binding.call_action = fail_profile_restore  # type: ignore[method-assign]

        error = gate._cleanup(binding)  # type: ignore[arg-type]

        self.assertEqual(error, "Profile restore: RuntimeError")
        self.assertTrue(binding.closed)
        self.assertEqual(
            next(
                item
                for item in gate.cleanup
                if item["resource"] == "Profile-restore"
            )["status"],
            "failed",
        )


if __name__ == "__main__":
    unittest.main()
