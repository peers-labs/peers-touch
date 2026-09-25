#!/usr/bin/env python3
"""Profile, Notification, and device-setting proof on two simulator clients."""

from __future__ import annotations

import sys
from collections.abc import Callable, Mapping
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactSession,
    DriverError,
    EphemeralCapabilityBlocked,
    GateError,
    REPO_ROOT,
)
from tooling.acceptance.core.redaction import redact_text
from tooling.acceptance.gates.mobile.simulator_runtime_binding import (
    MobileSimulatorBindingActivation,
    MobileSimulatorRuntimeBinding,
)


GATE_ID = "mobile-simulator-settings-e2e"
ENVIRONMENT_ID = "mobile-station-lifecycle-simulator"
IOS_CLIENT = "sim-ios"
PEER_IOS_CLIENT = "sim-ios-peer"
PRIMARY_BINDING = "station-primary"
PROFILE_FIELDS = (
    "displayName",
    "note",
    "region",
    "timezone",
    "defaultVisibility",
    "manuallyApprovesFollowers",
    "messagePermission",
    "autoExpireDays",
)
OPTIONAL_DIAGNOSTIC_SCOPE = (
    "Android runtime behavior",
    "physical-device hardware behavior",
    "physical Keychain or AndroidKeyStore characteristics",
    "VoiceOver or TalkBack traversal",
    "OEM scheduler and pinned-hardware performance",
)


class SimulatorSettingsGate(AcceptanceGate):
    gate_id = GATE_ID

    def __init__(
        self,
        *,
        binding_factory: (
            Callable[[], MobileSimulatorRuntimeBinding] | None
        ) = None,
    ) -> None:
        super().__init__()
        self.binding_factory = binding_factory or (
            lambda: MobileSimulatorRuntimeBinding.from_environment(
                gate_id=self.gate_id
            )
        )
        self.events: list[dict[str, Any]] = []
        self.cleanup: list[dict[str, Any]] = []
        self._active_clients: list[str] = []
        self._product_cleaned: set[str] = set()
        self._restore_owner_client = IOS_CLIENT
        self._profile_restore: dict[str, Any] | None = None
        self._notification_restore: dict[str, Any] | None = None
        self._device_restore: dict[str, Any] | None = None

    def run(self) -> dict[str, Any]:
        raise GateError(
            "SimulatorSettingsGate uses its evidence-aware execute entrypoint"
        )

    def execute(self) -> int:
        with ArtifactSession(
            repo_root=REPO_ROOT,
            gate_id=self.gate_id,
        ) as artifacts:
            status = "FAIL"
            completion_status = "PARTIAL"
            proof_status = "UNPROVEN"
            exit_code = 1
            result = self._result_base(status)
            binding: MobileSimulatorRuntimeBinding | None = None
            try:
                binding = self.binding_factory()
                result.update(self._run_journey(binding, artifacts.run_id[-12:]))
                status = "PASS"
                completion_status = "DONE"
                proof_status = "PROVEN"
                exit_code = 0
            except EphemeralCapabilityBlocked as error:
                status = "BLOCKED"
                completion_status = "BLOCKED"
                result.update(
                    {
                        "blockedReason": redact_text(error.reason),
                        "blockedResource": error.resource,
                    }
                )
                exit_code = 2
            except (DriverError, GateError) as error:
                result.update(
                    {
                        "reason": redact_text(str(error)),
                        "errorType": type(error).__name__,
                    }
                )
            except Exception as error:
                result.update(
                    {
                        "reason": (
                            "unexpected simulator Settings Gate failure: "
                            f"{type(error).__name__}"
                        ),
                        "errorType": type(error).__name__,
                    }
                )
            finally:
                cleanup_error = self._cleanup(binding)

            if cleanup_error is not None:
                journey_succeeded = exit_code == 0
                status = "FAIL"
                completion_status = "PARTIAL"
                proof_status = "UNPROVEN"
                exit_code = 1
                result["cleanupReason"] = cleanup_error
                if journey_succeeded:
                    result["reason"] = cleanup_error
            result.update(
                {
                    "status": status,
                    "completionStatus": completion_status,
                    "proofStatus": proof_status,
                    "cleanup": list(self.cleanup),
                }
            )
            artifacts.write_json(
                "mobile-simulator-settings/events.json",
                {
                    "artifactKind": "mobile-simulator-settings-events",
                    "gateId": self.gate_id,
                    "events": list(self.events),
                },
                role="mobile-simulator-settings-events",
            )
            artifacts.write_json(
                "mobile-simulator-settings/result.json",
                result,
                role="mobile-simulator-settings-result",
            )
            artifacts.complete(
                status=status,
                completion_status=completion_status,
                proof_status=proof_status,
                runtime={
                    "environment": ENVIRONMENT_ID,
                    "runtimeCell": "dual-ios-simulator",
                    "clients": list(self._active_clients),
                    "physicalDeviceClaimed": False,
                },
            )

        stream = sys.stdout if exit_code == 0 else sys.stderr
        stream.write(f"{status}: {self.gate_id}\n")
        return exit_code

    def _run_journey(
        self,
        binding: MobileSimulatorRuntimeBinding,
        journey_id: str,
    ) -> dict[str, Any]:
        ios = self._launch(
            binding,
            IOS_CLIENT,
            {PRIMARY_BINDING, "station-secondary"},
        )
        peer_ios = self._launch(
            binding,
            PEER_IOS_CLIENT,
            {PRIMARY_BINDING},
        )
        ios_device = self._mapping(
            binding.call_action(IOS_CLIENT, "settings.device.read"),
            "iOS device settings",
        )
        peer_device = self._mapping(
            binding.call_action(PEER_IOS_CLIENT, "settings.device.read"),
            "peer iOS device settings",
        )
        self._device_restore = dict(ios_device)

        actor_ptid = self._authenticate(
            binding,
            IOS_CLIENT,
            expected_station_peer_id=str(
                ios.scope["activeStationPeerId"]
            ),
        )
        profile = self._mapping(
            binding.call_action(IOS_CLIENT, "settings.profile.read"),
            "iOS Profile",
        )
        if profile.get("actorPtid") != actor_ptid:
            raise GateError("iOS Profile readback changed actor identity")
        self._profile_restore = {
            field: profile.get(field) for field in PROFILE_FIELDS
        }
        changed_profile = self._changed_profile(profile, journey_id)

        notifications = self._mapping(
            binding.call_action(
                IOS_CLIENT,
                "settings.notifications.read",
            ),
            "iOS Notification preferences",
        )
        preferences = notifications.get("preferences")
        if not isinstance(preferences, list) or not preferences:
            raise GateError("Notification preference snapshot is empty")
        original_notification = self._mapping(
            preferences[0],
            "Notification preference",
        )
        self._notification_restore = dict(original_notification)
        changed_notification = {
            "category": self._positive_integer(
                original_notification.get("category"),
                "Notification category",
            ),
            "enabled": not bool(original_notification.get("enabled")),
            "pushEnabled": not bool(
                original_notification.get("pushEnabled")
            ),
            "soundEnabled": not bool(
                original_notification.get("soundEnabled")
            ),
        }
        changed_device = self._changed_device(ios_device)

        profile_update = self._mapping(
            binding.call_action(
                IOS_CLIENT,
                "settings.profile.update",
                changed_profile,
            ),
            "Profile update",
        )
        self._require_profile(
            self._mapping(profile_update.get("profile"), "updated Profile"),
            actor_ptid,
            changed_profile,
        )
        notification_update = self._mapping(
            binding.call_action(
                IOS_CLIENT,
                "settings.notifications.update",
                changed_notification,
            ),
            "Notification preference update",
        )
        self._require_notification(
            self._mapping(
                notification_update.get("snapshot"),
                "updated Notification snapshot",
            ),
            changed_notification,
        )
        persisted_device = self._mapping(
            binding.call_action(
                IOS_CLIENT,
                "settings.device.update",
                changed_device,
            ),
            "updated iOS device settings",
        )
        if persisted_device != changed_device:
            raise GateError("iOS device settings update changed requested values")

        restart = binding.call_action(IOS_CLIENT, "lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("iOS settings restart was not acknowledged")
        restarted_device = self._mapping(
            binding.call_action(IOS_CLIENT, "settings.device.read"),
            "restarted iOS device settings",
        )
        if restarted_device != changed_device:
            raise GateError("iOS device settings did not survive restart")

        peer_actor_ptid = self._authenticate(
            binding,
            PEER_IOS_CLIENT,
            expected_station_peer_id=str(
                peer_ios.scope["activeStationPeerId"]
            ),
        )
        self._restore_owner_client = PEER_IOS_CLIENT
        if peer_actor_ptid != actor_ptid:
            raise GateError("second simulator resolved a different actor")
        second_profile = self._mapping(
            binding.call_action(PEER_IOS_CLIENT, "settings.profile.read"),
            "peer iOS Profile readback",
        )
        self._require_profile(
            second_profile,
            actor_ptid,
            changed_profile,
        )
        second_notifications = self._mapping(
            binding.call_action(
                PEER_IOS_CLIENT,
                "settings.notifications.read",
            ),
            "peer iOS Notification readback",
        )
        self._require_notification(
            second_notifications,
            changed_notification,
        )
        second_device = self._mapping(
            binding.call_action(PEER_IOS_CLIENT, "settings.device.read"),
            "peer iOS device settings readback",
        )
        if second_device != peer_device:
            raise GateError("device settings leaked across simulator clients")

        return {
            "scenario": "settings",
            "actorPtid": actor_ptid,
            "profileUpdate": profile_update,
            "profileReadback": second_profile,
            "notificationUpdate": notification_update,
            "notificationReadback": second_notifications,
            "deviceReadback": restarted_device,
            "deviceIsolation": True,
            "sessionReplacementObserved": True,
            "bindingProofs": {
                IOS_CLIENT: {
                    role: reference.to_dict()
                    for role, reference in ios.binding_proofs.items()
                },
                PEER_IOS_CLIENT: {
                    role: reference.to_dict()
                    for role, reference in peer_ios.binding_proofs.items()
                },
            },
        }

    def _launch(
        self,
        binding: MobileSimulatorRuntimeBinding,
        client_id: str,
        required_roles: set[str],
    ) -> MobileSimulatorBindingActivation:
        activation = binding.create_bound_session(client_id)
        self._active_clients.append(client_id)
        if (
            activation.active_binding_role != PRIMARY_BINDING
            or set(activation.binding_proofs) != required_roles
        ):
            raise GateError(
                f"{client_id} Runtime Binding proof closure is incomplete"
            )
        self._record(
            "client-launched",
            client_id,
            launchGeneration=activation.launch_generation,
            bindingRoles=sorted(activation.binding_proofs),
        )
        return activation

    def _authenticate(
        self,
        binding: MobileSimulatorRuntimeBinding,
        client_id: str,
        *,
        expected_station_peer_id: str,
    ) -> str:
        authentication = self._mapping(
            binding.authenticate_fixture_actor(client_id),
            f"{client_id} Fixture authentication",
        )
        login = self._mapping(
            authentication.get("login"),
            f"{client_id} login",
        )
        session = self._mapping(
            login.get("session"),
            f"{client_id} login session",
        )
        actor_ptid = session.get("actorPtid")
        if (
            not isinstance(actor_ptid, str)
            or not actor_ptid.startswith("ptid:")
            or session.get("stationPeerId") != expected_station_peer_id
        ):
            raise GateError(
                f"{client_id} login returned the wrong actor or Station scope"
            )
        self._record("authenticated", client_id, actorIdentityMatched=True)
        return actor_ptid

    def _cleanup(
        self,
        binding: MobileSimulatorRuntimeBinding | None,
    ) -> str | None:
        if binding is None:
            return None
        failures: list[str] = []
        restore_actions = (
            (
                self._restore_owner_client,
                "settings.profile.update",
                self._profile_restore,
                "Profile",
            ),
            (
                self._restore_owner_client,
                "settings.notifications.update",
                self._notification_restore,
                "Notification",
            ),
            (
                IOS_CLIENT,
                "settings.device.update",
                self._device_restore,
                "device settings",
            ),
        )
        for client_id, action, payload, label in restore_actions:
            if payload is None or client_id not in self._active_clients:
                continue
            try:
                binding.call_action(client_id, action, payload)
            except Exception as error:
                failures.append(f"{label} restore: {type(error).__name__}")
                self.cleanup.append(
                    {
                        "clientId": client_id,
                        "resource": f"{label}-restore",
                        "status": "failed",
                        "errorType": type(error).__name__,
                    }
                )
            else:
                self.cleanup.append(
                    {
                        "clientId": client_id,
                        "resource": f"{label}-restore",
                        "status": "passed",
                    }
                )

        for client_id in reversed(tuple(self._active_clients)):
            if client_id in self._product_cleaned:
                continue
            try:
                value = binding.call_action(client_id, "cleanup")
                if not isinstance(value, Mapping):
                    raise GateError("cleanup response is invalid")
            except Exception as error:
                failures.append(
                    f"{client_id} product cleanup: {type(error).__name__}"
                )
                self.cleanup.append(
                    {
                        "clientId": client_id,
                        "resource": "product-harness",
                        "status": "failed",
                        "errorType": type(error).__name__,
                    }
                )
            else:
                self._product_cleaned.add(client_id)
                self.cleanup.append(
                    {
                        "clientId": client_id,
                        "resource": "product-harness",
                        "status": "passed",
                    }
                )
        try:
            stopped = binding.close()
        except Exception as error:
            failures.append(
                f"Runtime Binding cleanup: {type(error).__name__}"
            )
            self.cleanup.append(
                {
                    "resource": "runtime-binding",
                    "status": "failed",
                    "errorType": type(error).__name__,
                }
            )
        else:
            self.cleanup.append(
                {
                    "resource": "runtime-binding",
                    "status": "passed",
                    "stoppedClients": list(stopped),
                }
            )
        return "; ".join(failures) if failures else None

    @staticmethod
    def _changed_profile(
        profile: Mapping[str, Any],
        journey_id: str,
    ) -> dict[str, Any]:
        return {
            "displayName": f"Acceptance {journey_id}",
            "note": f"settings-{journey_id}",
            "defaultVisibility": (
                "private"
                if profile.get("defaultVisibility") != "private"
                else "followers"
            ),
            "manuallyApprovesFollowers": not bool(
                profile.get("manuallyApprovesFollowers")
            ),
            "messagePermission": (
                "none"
                if profile.get("messagePermission") != "none"
                else "friends"
            ),
            "autoExpireDays": (
                90 if profile.get("autoExpireDays") != 90 else 30
            ),
        }

    @staticmethod
    def _changed_device(settings: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "theme": "dark" if settings.get("theme") != "dark" else "light",
            "fontSize": (
                "large" if settings.get("fontSize") != "large" else "small"
            ),
            "compactMode": not bool(settings.get("compactMode")),
            "mediaAutoDownload": not bool(
                settings.get("mediaAutoDownload")
            ),
        }

    @staticmethod
    def _require_profile(
        profile: Mapping[str, Any],
        actor_ptid: str,
        expected: Mapping[str, Any],
    ) -> None:
        if profile.get("actorPtid") != actor_ptid or any(
            profile.get(field) != value for field, value in expected.items()
        ):
            raise GateError("Profile readback did not converge")

    @classmethod
    def _require_notification(
        cls,
        snapshot: Mapping[str, Any],
        expected: Mapping[str, Any],
    ) -> None:
        preferences = snapshot.get("preferences")
        if not isinstance(preferences, list) or not any(
            isinstance(item, Mapping)
            and all(item.get(field) == value for field, value in expected.items())
            for item in preferences
        ):
            raise GateError("Notification preference readback did not converge")
        revision = snapshot.get("revision")
        if (
            not isinstance(revision, str)
            or not revision.isdigit()
            or int(revision) <= 0
        ):
            raise GateError("Notification preference revision is invalid")

    @staticmethod
    def _positive_integer(value: Any, label: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise GateError(f"{label} is invalid")
        return value

    @staticmethod
    def _mapping(value: Any, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must be an object")
        return dict(value)

    def _record(
        self,
        event: str,
        client_id: str,
        **details: Any,
    ) -> None:
        self.events.append(
            {
                "event": event,
                "clientId": client_id,
                **details,
            }
        )

    def _result_base(self, status: str) -> dict[str, Any]:
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": self.gate_id,
            "gate": self.gate_id,
            "environment": ENVIRONMENT_ID,
            "runtimeCell": "dual-ios-simulator",
            "scenario": "settings",
            "status": status,
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "phase": "W6C Simulator Profile And Settings",
            "bom": ["W5", "W5-OWNER", "W6C"],
            "spec": ["MS-AG02", "MS-AG05", "MS-AG06", "MS-AG10"],
            "observedScope": (
                [
                    "source-bound same-account isolated iOS Simulators",
                    "Profile and Notification owner readback on the second simulator",
                    "device-setting isolation and iOS restart persistence",
                ]
                if status == "PASS"
                else []
            ),
            "unprovenScope": list(OPTIONAL_DIAGNOSTIC_SCOPE),
            "physicalDeviceClaimed": False,
            "stationMocksUsed": False,
        }


def main() -> int:
    gate: AcceptanceGate = SimulatorSettingsGate()
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
