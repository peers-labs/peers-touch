#!/usr/bin/env python3
"""Two-actor Mobile Messaging journeys on simulator runtime cells."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    ArtifactSession,
    DriverError,
    GateError,
    ProvisioningError,
    REPO_ROOT,
    load_runtime_manifest,
    require_runtime_service,
)
from tooling.acceptance.core.redaction import redact_text
from tooling.acceptance.fixtures.chat_native_actors import ACTOR_PASSWORD
from tooling.acceptance.gates.mobile.messaging_journey import (
    MobileMessagingJourney,
    MessagingActor,
)
from tooling.acceptance.gates.mobile.simulator_e2e import (
    SimulatorCallbackRoutingGate,
    SimulatorGateBlocked,
    _redacted_markup,
    _validate_runtime_identity,
    _validate_source_identity,
)


ENVIRONMENT_ID = "mobile-direct-simulator"
SCENARIO_GATES = {
    "social-convergence": "mobile-simulator-social-convergence-e2e",
    "chat-contacts": "mobile-simulator-chat-contacts-e2e",
    "recovery": "mobile-simulator-recovery-e2e",
    "recovery-ui": "mobile-simulator-recovery-ui-e2e",
    "moments": "mobile-simulator-moments-e2e",
    "storage-cache-cleanup": "chat-storage-cache-clear-e2e",
    "storage-batch-clear": "chat-storage-mobile-batch-clear-e2e",
    "storage-conversation-clear": "chat-storage-delete-reclaim-e2e",
    "storage-retention": "chat-storage-retention-e2e",
}
CLIENT_ASSIGNMENTS = {
    "sim-ios": ("station", "alice"),
    "sim-ios-peer": ("station", "bob"),
}
SCENARIO_METADATA = {
    "social-convergence": {
        "phase": "W5 Simulator Social Convergence",
        "bom": ["W5", "W5-OWNER"],
        "spec": ["MS-AG06"],
    },
    "chat-contacts": {
        "phase": "W6A Simulator Chat Contacts And Groups",
        "bom": ["W5", "W5-OWNER", "W6A"],
        "spec": ["MS-AG04", "MS-AG06", "MS-AG09"],
    },
    "recovery": {
        "phase": "W4 Simulator Command And Draft Recovery",
        "bom": ["W4"],
        "spec": ["MS-AG04", "MS-AG09", "MS-AG10"],
    },
    "recovery-ui": {
        "phase": "W6D Simulator Recovery UI",
        "bom": ["W4", "W6D"],
        "spec": ["MS-AG04", "MS-AG08", "MS-AG09", "MS-AG10", "MS-AG11"],
    },
    "moments": {
        "phase": "W6B Simulator Moments Participation",
        "bom": ["W5", "W5-OWNER", "W6B"],
        "spec": ["MS-AG04", "MS-AG06", "MS-AG10"],
    },
    "storage-cache-cleanup": {
        "phase": "CSG-02 Mobile Cache Cleanup",
        "bom": ["CSG-G02"],
        "spec": ["chat-storage-cache-cleanup"],
    },
    "storage-batch-clear": {
        "phase": "CSG-BATCH Mobile Batch Clear",
        "bom": ["CSG-G07"],
        "spec": ["chat-storage-batch-clear"],
    },
    "storage-conversation-clear": {
        "phase": "CSG-05 Mobile Conversation Clear",
        "bom": ["CSG-G04"],
        "spec": ["chat-storage-conversation-clear"],
    },
    "storage-retention": {
        "phase": "CSG-03 Mobile Retention",
        "bom": ["CSG-G03"],
        "spec": ["chat-storage-retention"],
    },
}
OPTIONAL_DIAGNOSTIC_SCOPE = (
    "physical-device hardware behavior",
    "live provider browser authorization",
    "physical Keychain or AndroidKeyStore characteristics",
    "VoiceOver or TalkBack traversal",
    "OEM scheduler, picker, and pinned-hardware performance",
)


class SimulatorSocialGate(SimulatorCallbackRoutingGate):
    def __init__(
        self,
        scenario: str,
        **kwargs: Any,
    ) -> None:
        if scenario not in SCENARIO_GATES:
            raise ValueError(f"unsupported Mobile social scenario: {scenario}")
        self.gate_id = SCENARIO_GATES[scenario]
        super().__init__(**kwargs)
        self.scenario = scenario

    def execute(self) -> int:
        with ArtifactSession(
            repo_root=REPO_ROOT,
            gate_id=self.gate_id,
        ) as artifacts:
            status = "FAIL"
            completion_status = "PARTIAL"
            proof_status = "UNPROVEN"
            exit_code = 1
            result: dict[str, Any]
            try:
                manifest = self._load_social_manifest()
                result = self._run_social_journey(artifacts, manifest)
                status = "PASS"
                completion_status = "DONE"
                proof_status = "PROVEN"
                exit_code = 0
            except SimulatorGateBlocked as error:
                status = "BLOCKED"
                completion_status = "BLOCKED"
                result = self._result_base("BLOCKED")
                result.update(
                    {
                        "blockedReason": redact_text(error.reason),
                        "blockedResource": error.resource,
                    }
                )
                exit_code = 2
            except (DriverError, GateError, ProvisioningError) as error:
                result = self._result_base("FAIL")
                result.update(
                    {
                        "reason": redact_text(str(error)),
                        "errorType": type(error).__name__,
                    }
                )
            finally:
                self._cleanup_sessions(artifacts)

            if any(item["status"] == "failed" for item in self.cleanup):
                journey_succeeded = exit_code == 0
                status = "FAIL"
                completion_status = "PARTIAL"
                proof_status = "UNPROVEN"
                exit_code = 1
                result["cleanupReason"] = (
                    "simulator social cleanup was incomplete"
                )
                if journey_succeeded:
                    result["reason"] = result["cleanupReason"]
            result.update(
                {
                    "status": status,
                    "completionStatus": completion_status,
                    "proofStatus": proof_status,
                    "cleanup": list(self.cleanup),
                }
            )
            artifacts.write_json(
                f"mobile-simulator-social/{self.scenario}/lifecycle.json",
                {
                    "artifactKind": "mobile-simulator-social-lifecycle",
                    "gateId": self.gate_id,
                    "events": self.lifecycle,
                },
                role="mobile-simulator-social-lifecycle",
            )
            artifacts.write_json(
                f"mobile-simulator-social/{self.scenario}/result.json",
                result,
                role="mobile-simulator-social-result",
            )
            artifacts.complete(
                status=status,
                completion_status=completion_status,
                proof_status=proof_status,
                runtime={
                    "environment": ENVIRONMENT_ID,
                    "runtimeCell": self.gate_id,
                    "clients": sorted(
                        {
                            event["clientId"]
                            for event in self.lifecycle
                            if event.get("clientId")
                        }
                    ),
                    "physicalDeviceClaimed": False,
                },
            )

        stream = sys.stdout if exit_code == 0 else sys.stderr
        stream.write(f"{status}: {self.gate_id}\n")
        return exit_code

    def _load_social_manifest(self) -> dict[str, Any]:
        manifest_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
        if not manifest_path:
            raise SimulatorGateBlocked(
                "PT_ACCEPTANCE_RUNTIME_MANIFEST is required",
                f"{ENVIRONMENT_ID}:manifest",
            )
        try:
            manifest = load_runtime_manifest(
                Path(manifest_path),
                self.gate_id,
            )
            require_runtime_service(manifest, "station", "station")
        except ProvisioningError as error:
            raise SimulatorGateBlocked(
                str(error),
                f"{ENVIRONMENT_ID}:manifest",
            ) from error
        if manifest.get("environmentId") != ENVIRONMENT_ID:
            raise SimulatorGateBlocked(
                f"RuntimeManifest environment must be {ENVIRONMENT_ID}",
                f"{ENVIRONMENT_ID}:environment",
            )
        return manifest

    def _run_social_journey(
        self,
        artifacts: ArtifactSession,
        manifest: Mapping[str, Any],
    ) -> dict[str, Any]:
        source_identity = _validate_source_identity(manifest)
        resources = self._required_object(
            manifest,
            "mobileSimulator",
            "RuntimeManifest",
        )
        self._reject_credentials(manifest, resources)
        runtime_identity = _validate_runtime_identity(resources)
        appium = self._required_object(
            resources,
            "appium",
            f"{ENVIRONMENT_ID} resources",
        )
        server_url = self._required_text(
            appium,
            "serverUrl",
            f"{ENVIRONMENT_ID} Appium",
        )
        specs = self._client_specs(resources)
        sessions = {
            spec.client_id: self._start_social_session(
                artifacts,
                server_url,
                spec,
            )
            for spec in specs
        }
        actors = self._load_actors(artifacts, manifest)
        journey = MobileMessagingJourney(timeout_seconds=30)
        authentication = {
            client_id: journey.authenticate(
                sessions[client_id],
                actor,
                password=ACTOR_PASSWORD,
            )
            for client_id, actor in actors.items()
        }
        sender = actors["sim-ios"]
        receiver = actors["sim-ios-peer"]
        if self.scenario == "social-convergence":
            journey_result = journey.run_social_convergence(
                sender_session=sessions["sim-ios"],
                receiver_session=sessions["sim-ios-peer"],
                sender=sender,
                receiver=receiver,
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "chat-contacts":
            journey_result = journey.run_chat_contacts(
                sender_session=sessions["sim-ios"],
                receiver_session=sessions["sim-ios-peer"],
                sender=sender,
                receiver=receiver,
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "recovery":
            journey_result = self._run_recovery_journey(
                sender_session=sessions["sim-ios"],
                receiver_session=sessions["sim-ios-peer"],
                sender=sender,
                receiver=receiver,
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "recovery-ui":
            journey_result = self._run_recovery_ui_journey(
                session=sessions["sim-ios"],
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "moments":
            journey_result = self._run_moments_journey(
                sender_session=sessions["sim-ios"],
                receiver_session=sessions["sim-ios-peer"],
                sender=sender,
                receiver=receiver,
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "storage-cache-cleanup":
            journey_result = self._run_storage_cache_cleanup_journey(
                session=sessions["sim-ios"],
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "storage-batch-clear":
            journey_result = self._run_storage_batch_clear_journey(
                session=sessions["sim-ios"],
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "storage-conversation-clear":
            journey_result = self._run_storage_conversation_clear_journey(
                session=sessions["sim-ios"],
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "storage-retention":
            journey_result = self._run_storage_retention_journey(
                session=sessions["sim-ios"],
                journey_id=artifacts.run_id[-12:],
            )
        else:
            raise GateError(
                f"unsupported Mobile simulator scenario: {self.scenario}"
            )
        captures = {
            client_id: self._capture_client(
                artifacts,
                session,
                client_id,
            )
            for client_id, session in sessions.items()
        }
        return {
            **self._result_base("PASS"),
            "source": source_identity,
            "runtime": runtime_identity,
            "authentication": authentication,
            "journey": journey_result,
            "captures": captures,
        }

    def _start_social_session(
        self,
        artifacts: ArtifactSession,
        server_url: str,
        spec: Any,
    ) -> Any:
        session = self._create_session(server_url, spec)
        self.sessions.append(session)
        session.start()
        self._record(spec.client_id, "session-created")
        if spec.platform == "ios":
            self._preflight_ios(artifacts, session, spec)
        else:
            session.wait_for_ready()
            session.switch_to_app_webview()
            session.require_harness(list(spec.required_harness_actions))
        self._record(spec.client_id, "messaging-harness-ready")
        return session

    def _load_actors(
        self,
        artifacts: ArtifactSession,
        manifest: Mapping[str, Any],
    ) -> dict[str, MessagingActor]:
        raw_reference = manifest.get("actorManifest")
        if not isinstance(raw_reference, Mapping):
            raise SimulatorGateBlocked(
                "Mobile direct simulator actor manifest is missing",
                f"{ENVIRONMENT_ID}:actor-manifest",
            )
        try:
            reference = ArtifactRef.from_dict(raw_reference)
            if (
                reference.workspace_id != artifacts.store.workspace_id
                or reference.gate_id != self.gate_id
                or reference.run_id != artifacts.run_id
            ):
                raise ValueError("actor manifest identity mismatch")
            payload = artifacts.store.read_json(reference)
        except Exception as error:
            raise SimulatorGateBlocked(
                "Mobile direct simulator actor manifest is invalid",
                f"{ENVIRONMENT_ID}:actor-manifest",
            ) from error
        stations = self._required_object(
            payload,
            "stations",
            "Mobile social actor manifest",
        )
        actors: dict[str, MessagingActor] = {}
        for client_id, (service_id, role) in CLIENT_ASSIGNMENTS.items():
            service = require_runtime_service(manifest, service_id, "station")
            station = self._required_object(
                stations,
                service_id,
                f"Mobile social actor manifest {service_id}",
            )
            entries = station.get("actors")
            if not isinstance(entries, list):
                raise SimulatorGateBlocked(
                    f"Mobile direct actor manifest {service_id} has no actors",
                    f"{ENVIRONMENT_ID}:actor-manifest",
                )
            actor = next(
                (
                    item
                    for item in entries
                    if isinstance(item, Mapping) and item.get("role") == role
                ),
                None,
            )
            if not isinstance(actor, Mapping):
                raise SimulatorGateBlocked(
                    f"Mobile direct actor manifest has no {role}",
                    f"{ENVIRONMENT_ID}:actor-manifest",
                )
            actors[client_id] = MessagingActor(
                client_id=client_id,
                role=role,
                station_url=self._required_text(
                    service,
                    "endpoint",
                    f"Mobile social service {service_id}",
                ),
                station_peer_id=self._required_text(
                    service,
                    "runtimeIdentity",
                    f"Mobile social service {service_id}",
                ),
                ptid=self._required_text(
                    actor,
                    "ptid",
                    f"Mobile social actor {role}",
                ),
                account_ref=self._required_text(
                    actor,
                    "accountRef",
                    f"Mobile social actor {role}",
                ),
                federated_handle=self._required_text(
                    actor,
                    "federatedHandle",
                    f"Mobile social actor {role}",
                ),
                federation_id=self._required_text(
                    actor,
                    "federationId",
                    f"Mobile social actor {role}",
                ),
            )
        return actors

    def _run_storage_cache_cleanup_journey(
        self,
        *,
        session: Any,
        journey_id: str,
    ) -> dict[str, Any]:
        fixture_size = 2 * 1024 * 1024
        seeded = self._mapping(
            session.call_action(
                "storage.cache.seed",
                {"sizeBytes": fixture_size},
            ),
            "storage cache fixture",
        )
        if seeded.get("sizeBytes") != fixture_size:
            raise GateError("storage cache fixture size changed")

        draft = session.call_action(
            "reliability.draft.write",
            {
                "kind": "chat",
                "targetId": f"storage-{journey_id}-draft",
                "text": f"storage-{journey_id}-protected-draft",
            },
        )
        identity_before = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity before cache cleanup",
        )
        if not identity_before.get("active"):
            raise GateError("messaging runtime is inactive before cache cleanup")

        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        def click_storage_refresh() -> bool | None:
            clicked = session.execute_script(
                """
const button = document.querySelector('[data-chat-storage-refresh]');
if (!button) return false;
button.click();
return true;
"""
            )
            return True if clicked is True else None

        self._wait_for_value(
            click_storage_refresh,
            "storage refresh action",
        )
        before = self._wait_for_storage_snapshot(
            session,
            lambda value: int(value.get("cacheBytes") or 0) >= fixture_size,
            "seeded Mobile Chat cache measurement",
        )

        session.execute_script(
            """
const button = document.querySelector('[data-chat-storage-clear-cache]');
if (!button) throw new Error('storage clear action missing');
button.click();
return true;
"""
        )
        self._wait_for_storage_snapshot(
            session,
            lambda value: bool(value.get("confirmVisible")),
            "Mobile Chat cache confirmation",
        )
        session.execute_script(
            """
const button = document.querySelector(
  '[data-chat-storage-clear-confirm-apply]'
);
if (!button) throw new Error('storage clear confirmation action missing');
button.click();
return true;
"""
        )
        after = self._wait_for_storage_snapshot(
            session,
            lambda value: value.get("resultState") == "succeeded"
            and int(value.get("releasedBytes") or 0) > 0,
            "Mobile Chat cache cleanup result",
        )

        released_bytes = int(after.get("releasedBytes") or 0)
        if (
            int(after.get("physicalTotalBytes") or 0)
            >= int(before.get("physicalTotalBytes") or 0)
            or int(after.get("cacheBytes") or 0)
            >= int(before.get("cacheBytes") or 0)
        ):
            raise GateError("Mobile Chat cache cleanup did not reclaim physical bytes")

        retained = session.call_action("reliability.draft.read", {})
        self._require_drafts({"drafts": retained}, (draft,))
        identity_after = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity after cache cleanup",
        )
        if identity_after != identity_before:
            raise GateError("cache cleanup changed the active messaging identity")
        session.call_action(
            "reliability.draft.action",
            {"action": "discard"},
        )
        return {
            "scenario": "storage-cache-cleanup",
            "fixtureBytes": fixture_size,
            "physicalBytesBefore": int(before["physicalTotalBytes"]),
            "physicalBytesAfter": int(after["physicalTotalBytes"]),
            "cacheBytesBefore": int(before["cacheBytes"]),
            "cacheBytesAfter": int(after["cacheBytes"]),
            "releasedBytes": released_bytes,
            "draftPreserved": True,
            "messagingIdentityPreserved": True,
            "confirmationObserved": True,
        }

    def _run_storage_retention_journey(
        self,
        *,
        session: Any,
        journey_id: str,
    ) -> dict[str, Any]:
        fixture_size = 2 * 1024 * 1024
        fixture = self._mapping(
            session.call_action(
                "storage.retention.seed",
                {"oldPlaintextBytes": fixture_size},
            ),
            "storage retention fixture",
        )
        conversation_id = self._required_text(
            fixture,
            "conversationId",
            "storage retention fixture",
        )
        pruned_message_id = self._required_text(
            fixture,
            "prunedMessageId",
            "storage retention fixture",
        )
        protected_message_id = self._required_text(
            fixture,
            "protectedMessageId",
            "storage retention fixture",
        )
        recent_message_id = self._required_text(
            fixture,
            "recentMessageId",
            "storage retention fixture",
        )
        identity_before = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity before retention",
        )
        if not identity_before.get("active"):
            raise GateError("messaging runtime is inactive before retention")

        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector('[data-chat-storage-refresh]');
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "storage refresh action",
        )
        before = self._wait_for_storage_snapshot(
            session,
            lambda value: int(value.get("messageBytes") or 0) >= fixture_size
            and conversation_id in value.get("conversationIds", []),
            "seeded Mobile Chat retention measurement",
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const select = document.querySelector('[data-chat-storage-retention-select]');
if (!select) return false;
select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
select.click();
return true;
"""
            )
            or None,
            "retention selector",
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const label = document.querySelector(
  '[data-chat-storage-retention-option="30"]'
);
const option = label?.closest('[role="option"], .ant-select-item-option') || label;
if (!option) return false;
option.click();
return true;
"""
            )
            or None,
            "30 day retention option",
        )
        after = self._wait_for_storage_snapshot(
            session,
            lambda value: value.get("retentionPreset") == "4"
            and value.get("retentionResultState") == "succeeded"
            and int(value.get("retentionReleasedBytes") or 0) > 0,
            "completed Mobile Chat retention",
        )
        projection = self._mapping(
            session.call_action(
                "messaging.projection.read",
                {"conversationId": conversation_id},
            ),
            "messaging projection after retention",
        )
        messages_by_conversation = self._mapping(
            projection.get("messages"),
            "retention message projection map",
        )
        messages = messages_by_conversation.get(conversation_id)
        if not isinstance(messages, list):
            raise GateError("retention conversation messages are unavailable")
        message_ids = {
            str(message.get("messageId") or "")
            for message in messages
            if isinstance(message, Mapping)
        }
        if pruned_message_id in message_ids:
            raise GateError("retention left pruned plaintext visible")
        if protected_message_id not in message_ids or recent_message_id not in message_ids:
            raise GateError("retention removed protected or recent message state")

        restart = session.call_action("lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("retention restart was not acknowledged")
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        self._wait_for_storage_snapshot(
            session,
            lambda value: value.get("retentionPreset") == "4",
            "restart-stable Mobile Chat retention policy",
        )
        restored_projection = self._mapping(
            session.call_action(
                "messaging.projection.read",
                {"conversationId": conversation_id},
            ),
            "messaging projection after retention restart",
        )
        restored_messages = self._mapping(
            restored_projection.get("messages"),
            "retention restart message projection map",
        ).get(conversation_id)
        if not isinstance(restored_messages, list):
            raise GateError("retention restart messages are unavailable")
        restored_ids = {
            str(message.get("messageId") or "")
            for message in restored_messages
            if isinstance(message, Mapping)
        }
        if pruned_message_id in restored_ids:
            raise GateError("retention-pruned plaintext returned after restart")
        if protected_message_id not in restored_ids or recent_message_id not in restored_ids:
            raise GateError("retention protection changed after restart")
        identity_after = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity after retention",
        )
        if identity_after != identity_before:
            raise GateError("retention changed the active messaging identity")
        return {
            "scenario": "storage-retention",
            "journeyId": journey_id,
            "conversationId": conversation_id,
            "retentionPreset": after["retentionPreset"],
            "physicalBytesBefore": int(before["physicalTotalBytes"]),
            "physicalBytesAfter": int(after["physicalTotalBytes"]),
            "releasedBytes": int(after["retentionReleasedBytes"]),
            "prunedMessageAbsent": True,
            "protectedMessagePreserved": True,
            "recentMessagePreserved": True,
            "restartStable": True,
            "messagingIdentityPreserved": True,
        }

    def _run_storage_conversation_clear_journey(
        self,
        *,
        session: Any,
        journey_id: str,
    ) -> dict[str, Any]:
        fixture_size = 2 * 1024 * 1024
        fixture = self._mapping(
            session.call_action(
                "storage.conversation-clear.seed",
                {"plaintextBytes": fixture_size},
            ),
            "storage conversation clear fixture",
        )
        conversation_id = self._required_text(
            fixture,
            "conversationId",
            "storage conversation clear fixture",
        )
        message_id = self._required_text(
            fixture,
            "messageId",
            "storage conversation clear fixture",
        )
        identity_before = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity before conversation clear",
        )
        if not identity_before.get("active"):
            raise GateError(
                "messaging runtime is inactive before conversation clear"
            )

        session.call_action("messaging.reconcile")
        projection_before = self._mapping(
            session.call_action(
                "messaging.projection.read",
                {"conversationId": conversation_id},
            ),
            "conversation projection before clear",
        )
        messages_before = self._mapping(
            projection_before.get("messages"),
            "conversation message projection before clear",
        ).get(conversation_id)
        if not isinstance(messages_before, list) or not any(
            isinstance(message, Mapping)
            and message.get("messageId") == message_id
            for message in messages_before
        ):
            raise GateError("conversation clear fixture message is not visible")

        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector('[data-chat-storage-refresh]');
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "storage refresh before conversation clear",
        )
        before = self._wait_for_storage_snapshot(
            session,
            lambda value: int(value.get("messageBytes") or 0) >= fixture_size
            and conversation_id in value.get("conversationIds", []),
            "seeded Mobile conversation clear measurement",
        )

        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:chat"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:chat-conversation",
                    "sessionUlid": conversation_id,
                },
            },
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector('[data-chat-actions-open]');
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "conversation actions",
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector(
  '[data-chat-history-action="clear"]'
);
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "conversation clear action",
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = Array.from(document.querySelectorAll(
  '.ant-modal-confirm .ant-btn-primary'
)).find((candidate) => candidate.offsetParent !== null);
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "conversation clear confirmation",
        )
        clear_result = self._wait_for_value(
            lambda: session.execute_script(
                """
const result = document.querySelector(
  '[data-chat-conversation-clear-result="succeeded"]'
);
if (!result) return null;
return {
  releasedBytes: Number(
    result.getAttribute('data-chat-storage-released-bytes') || '0'
  ),
};
"""
            ),
            "conversation clear result",
            timeout_seconds=60,
        )
        released_bytes = int(clear_result.get("releasedBytes") or 0)
        if released_bytes <= 0:
            raise GateError(
                "conversation clear did not report released physical bytes"
            )
        session.execute_script(
            """
const button = Array.from(document.querySelectorAll(
  '.ant-modal-confirm .ant-btn-primary'
)).find((candidate) => candidate.offsetParent !== null);
button?.click();
"""
        )

        session.call_action("messaging.reconcile")
        projection_after = self._mapping(
            session.call_action(
                "messaging.projection.read",
                {"conversationId": conversation_id},
            ),
            "conversation projection after clear",
        )
        messages_after = self._mapping(
            projection_after.get("messages"),
            "conversation message projection after clear",
        ).get(conversation_id)
        if not isinstance(messages_after, list) or messages_after:
            raise GateError("conversation clear left plaintext projections")
        search_after = session.call_action(
            "messaging.search",
            {
                "conversationId": conversation_id,
                "query": "cccccccc",
                "limit": 20,
            },
        )
        if not isinstance(search_after, list) or search_after:
            raise GateError("conversation clear left searchable plaintext")

        restart = session.call_action("lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("conversation clear restart was not acknowledged")
        session.call_action("messaging.reconcile")
        projection_restarted = self._mapping(
            session.call_action(
                "messaging.projection.read",
                {"conversationId": conversation_id},
            ),
            "conversation projection after clear restart",
        )
        messages_restarted = self._mapping(
            projection_restarted.get("messages"),
            "conversation message projection after clear restart",
        ).get(conversation_id)
        if not isinstance(messages_restarted, list) or messages_restarted:
            raise GateError(
                "conversation clear plaintext returned after restart"
            )

        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector('[data-chat-storage-refresh]');
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "storage refresh after conversation clear",
        )
        after = self._wait_for_storage_snapshot(
            session,
            lambda value: int(value.get("physicalTotalBytes") or 0)
            < int(before.get("physicalTotalBytes") or 0),
            "Mobile conversation clear physical reclamation",
        )
        identity_after = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity after conversation clear",
        )
        if identity_after != identity_before:
            raise GateError(
                "conversation clear changed the active messaging identity"
            )
        return {
            "scenario": "storage-conversation-clear",
            "journeyId": journey_id,
            "conversationId": conversation_id,
            "messageId": message_id,
            "fixtureBytes": fixture_size,
            "physicalBytesBefore": int(before["physicalTotalBytes"]),
            "physicalBytesAfter": int(after["physicalTotalBytes"]),
            "releasedBytes": released_bytes,
            "plaintextAbsent": True,
            "searchEntryAbsent": True,
            "restartStable": True,
            "messagingIdentityPreserved": True,
        }

    def _seed_storage_batch(
        self,
        session: Any,
        count: int = 2,
    ) -> tuple[list[str], list[str]]:
        fixtures = [
            self._mapping(
                session.call_action(
                    "storage.conversation-clear.seed",
                    {"plaintextBytes": 2 * 1024 * 1024},
                ),
                "storage batch clear fixture",
            )
            for _ in range(count)
        ]
        conversation_ids = [
            self._required_text(
                fixture,
                "conversationId",
                "storage batch clear fixture",
            )
            for fixture in fixtures
        ]
        message_ids = [
            self._required_text(
                fixture,
                "messageId",
                "storage batch clear fixture",
            )
            for fixture in fixtures
        ]
        if len(set(conversation_ids)) != count:
            raise GateError("storage batch fixtures are not distinct")
        return conversation_ids, message_ids

    def _refresh_mobile_storage_rows(
        self,
        session: Any,
        conversation_ids: list[str],
    ) -> dict[str, Any]:
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector('[data-chat-storage-refresh]');
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "Mobile storage refresh",
        )
        return self._wait_for_storage_snapshot(
            session,
            lambda value: set(conversation_ids).issubset(
                set(value.get("conversationIds", []))
            ),
            "seeded Mobile storage conversations",
        )

    def _select_mobile_storage_rows(
        self,
        session: Any,
        conversation_ids: list[str],
    ) -> list[str]:
        session.execute_script(
            """
const button = document.querySelector('[data-chat-storage-batch-manage]');
if (!button) throw new Error('batch manage action missing');
button.click();
"""
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
return Boolean(document.querySelector(
  '[data-chat-storage-batch-actions]'
));
"""
            )
            or None,
            "Mobile batch selection controls",
        )
        for conversation_id in conversation_ids:
            selected = session.execute_script(
                """
const row = Array.from(document.querySelectorAll(
  '[data-chat-storage-conversation]'
)).find((candidate) => (
  candidate.getAttribute('data-chat-storage-conversation') === arguments[0]
));
const control = row?.querySelector(
  '[data-chat-storage-conversation-select]'
);
const checkbox = control?.matches('input')
  ? control
  : control?.querySelector('input');
if (!checkbox) return false;
checkbox.click();
return true;
""",
                conversation_id,
            )
            if selected is not True:
                raise GateError(
                    f"storage batch row is not selectable: {conversation_id}"
                )
            self._wait_for_value(
                lambda conversation_id=conversation_id: (
                    session.execute_script(
                        """
const row = Array.from(document.querySelectorAll(
  '[data-chat-storage-conversation]'
)).find((candidate) => (
  candidate.getAttribute('data-chat-storage-conversation') === arguments[0]
));
return row?.getAttribute('data-chat-storage-selected') === 'true';
""",
                        conversation_id,
                    )
                    or None
                ),
                f"selected Mobile storage row {conversation_id}",
            )
        return self._wait_for_value(
            lambda: (
                value
                if (
                    isinstance(
                        value := session.execute_script(
                            """
return Array.from(document.querySelectorAll(
  '[data-chat-storage-selected="true"]'
)).map((row) => (
  row.getAttribute('data-chat-storage-conversation') || ''
));
"""
                        ),
                        list,
                    )
                    and set(value) == set(conversation_ids)
                )
                else None
            ),
            "selected Mobile storage rows",
        )

    def _mobile_batch_confirmation(self, session: Any) -> dict[str, Any]:
        session.execute_script(
            """
const button = document.querySelector('[data-chat-storage-batch-clear]');
if (!button || button.disabled) {
  throw new Error('batch clear action unavailable');
}
button.click();
"""
        )
        return self._mapping(
            self._wait_for_value(
                lambda: session.execute_script(
                    """
const confirmation = document.querySelector(
  '[data-chat-storage-batch-confirm]'
);
const button = confirmation?.querySelector(
  '[data-chat-storage-batch-confirm-apply]'
);
if (!button || button.disabled) return null;
return {
  estimatedBytes: Number(
    confirmation.getAttribute(
      'data-chat-storage-batch-estimated-bytes'
    ) || '0'
  ),
  selectedCount: Number(
    confirmation.getAttribute(
      'data-chat-storage-batch-selected-count'
    ) || '0'
  ),
  scope: confirmation.getAttribute(
    'data-chat-storage-batch-scope'
  ) || '',
  text: confirmation.innerText || '',
};
"""
                ),
                "Mobile batch confirmation",
            ),
            "Mobile batch confirmation",
        )

    @staticmethod
    def _install_mobile_batch_progress_probe(session: Any) -> None:
        session.execute_script(
            """
window.__PT_CHAT_STORAGE_BATCH_PROGRESS__ = [];
window.__PT_CHAT_STORAGE_BATCH_PROGRESS_OBSERVER__?.disconnect();
const record = () => {
  const progress = document.querySelector(
    '[data-chat-storage-batch-progress]'
  );
  if (!progress) return;
  const value = {
    completed: Number(progress.getAttribute(
      'data-chat-storage-batch-completed'
    ) || '0'),
    total: Number(progress.getAttribute(
      'data-chat-storage-batch-total'
    ) || '0'),
    text: progress.innerText || '',
  };
  const values = window.__PT_CHAT_STORAGE_BATCH_PROGRESS__;
  const previous = values[values.length - 1];
  if (!previous
    || previous.completed !== value.completed
    || previous.total !== value.total) {
    values.push(value);
  }
};
const observer = new MutationObserver(record);
observer.observe(document.body, {
  attributes: true,
  childList: true,
  characterData: true,
  subtree: true,
});
window.__PT_CHAT_STORAGE_BATCH_PROGRESS_OBSERVER__ = observer;
record();
"""
        )

    @staticmethod
    def _mobile_batch_progress(session: Any) -> list[dict[str, Any]]:
        value = session.execute_script(
            """
window.__PT_CHAT_STORAGE_BATCH_PROGRESS_OBSERVER__?.disconnect();
return window.__PT_CHAT_STORAGE_BATCH_PROGRESS__ || [];
"""
        )
        return value if isinstance(value, list) else []

    def _wait_mobile_batch_result(
        self,
        session: Any,
        status: str,
    ) -> dict[str, Any]:
        return self._mapping(
            self._wait_for_value(
                lambda: session.execute_script(
                    """
const result = document.querySelector(
  `[data-chat-storage-batch-result="${arguments[0]}"]`
);
if (!result) return null;
return {
  succeeded: Number(
    result.getAttribute('data-chat-storage-batch-succeeded') || '0'
  ),
  failed: Number(
    result.getAttribute('data-chat-storage-batch-failed') || '0'
  ),
  releasedBytes: Number(
    result.getAttribute('data-chat-storage-released-bytes') || '0'
  ),
  retryVisible: Boolean(document.querySelector(
    '[data-chat-storage-batch-retry]'
  )),
  selected: Array.from(document.querySelectorAll(
    '[data-chat-storage-selected="true"]'
  )).map((row) => (
    row.getAttribute('data-chat-storage-conversation') || ''
  )),
};
""",
                    status,
                ),
                f"Mobile batch clear {status} result",
                timeout_seconds=120,
            ),
            f"Mobile batch clear {status} result",
        )

    def _run_storage_batch_clear_journey(
        self,
        *,
        session: Any,
        journey_id: str,
    ) -> dict[str, Any]:
        fixture_size = 2 * 1024 * 1024
        conversation_ids, message_ids = self._seed_storage_batch(session)

        identity_before = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity before storage batch clear",
        )
        if not identity_before.get("active"):
            raise GateError(
                "messaging runtime is inactive before storage batch clear"
            )
        session.call_action("messaging.reconcile")
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        before = self._refresh_mobile_storage_rows(session, conversation_ids)
        if int(before.get("messageBytes") or 0) < fixture_size * 2:
            raise GateError("Mobile batch fixture bytes are incomplete")
        session.call_action("storage.batch.scenario", {"delayMs": 400})
        selected_ids = self._select_mobile_storage_rows(
            session,
            conversation_ids,
        )
        estimated_reclaimable_bytes = sum(
            int(before.get("conversationReclaimableBytes", {}).get(
                conversation_id,
                0,
            ))
            for conversation_id in conversation_ids
        )

        confirmation = self._mobile_batch_confirmation(session)
        if (
            estimated_reclaimable_bytes <= 0
            or confirmation.get("estimatedBytes") != estimated_reclaimable_bytes
            or confirmation.get("selectedCount") != 2
            or confirmation.get("scope") != "current-device"
            or not str(confirmation.get("text") or "").strip()
        ):
            raise GateError("Mobile batch clear confirmation is incomplete")
        self._install_mobile_batch_progress_probe(session)
        session.execute_script(
            """
document.querySelector(
  '[data-chat-storage-batch-confirm-apply]'
)?.click();
"""
        )
        batch_result = self._wait_mobile_batch_result(session, "succeeded")
        progress = self._mobile_batch_progress(session)
        if (
            set(selected_ids) != set(conversation_ids)
            or batch_result.get("succeeded") != 2
            or batch_result.get("failed") != 0
            or int(batch_result.get("releasedBytes") or 0) <= 0
            or not isinstance(progress, list)
            or not any(
                isinstance(item, Mapping)
                and item.get("total") == 2
                and item.get("completed") in {0, 1}
                and bool(str(item.get("text") or "").strip())
                for item in progress
            )
        ):
            raise GateError("Mobile batch clear result is incomplete")

        partial_ids, partial_message_ids = self._seed_storage_batch(session)
        partial_snapshot = self._refresh_mobile_storage_rows(
            session,
            partial_ids,
        )
        partial_order = [
            conversation_id
            for conversation_id in partial_snapshot.get("conversationIds", [])
            if conversation_id in partial_ids
        ]
        if len(partial_order) != 2:
            raise GateError("Mobile partial-failure batch order is incomplete")
        session.call_action(
            "storage.batch.scenario",
            {
                "delayMs": 400,
                "failureConversationId": partial_order[1],
            },
        )
        self._select_mobile_storage_rows(session, partial_ids)
        partial_confirmation = self._mobile_batch_confirmation(session)
        self._install_mobile_batch_progress_probe(session)
        session.execute_script(
            """
document.querySelector(
  '[data-chat-storage-batch-confirm-apply]'
)?.click();
"""
        )
        partial_result = self._wait_mobile_batch_result(
            session,
            "partial_failure",
        )
        partial_progress = self._mobile_batch_progress(session)
        if (
            partial_confirmation.get("selectedCount") != 2
            or partial_confirmation.get("scope") != "current-device"
            or partial_result.get("succeeded") != 1
            or partial_result.get("failed") != 1
            or partial_result.get("retryVisible") is not True
            or set(partial_result.get("selected") or [])
            != {partial_order[1]}
            or not any(
                isinstance(item, Mapping)
                and item.get("completed") == 1
                and item.get("total") == 2
                for item in partial_progress
            )
        ):
            raise GateError("Mobile batch partial-failure UI is incomplete")
        session.execute_script(
            """
const button = document.querySelector('[data-chat-storage-batch-retry]');
if (!button || button.disabled) {
  throw new Error('batch retry action unavailable');
}
button.click();
"""
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const confirmation = document.querySelector(
  '[data-chat-storage-batch-confirm]'
);
return confirmation?.getAttribute(
  'data-chat-storage-batch-selected-count'
) === '1';
"""
            )
            or None,
            "Mobile failed-only batch retry confirmation",
        )
        session.execute_script(
            """
document.querySelector(
  '[data-chat-storage-batch-confirm-apply]'
)?.click();
"""
        )
        retry_result = self._wait_mobile_batch_result(session, "succeeded")
        if (
            retry_result.get("succeeded") != 1
            or retry_result.get("failed") != 0
        ):
            raise GateError("Mobile failed-only batch retry did not succeed")

        scope_ids, scope_message_ids = self._seed_storage_batch(session)
        scope_snapshot_before = self._refresh_mobile_storage_rows(
            session,
            scope_ids,
        )
        scope_order = [
            conversation_id
            for conversation_id in scope_snapshot_before.get(
                "conversationIds",
                [],
            )
            if conversation_id in scope_ids
        ]
        if len(scope_order) != 2:
            raise GateError("Mobile scope-change batch order is incomplete")
        session.call_action(
            "storage.batch.scenario",
            {
                "delayMs": 400,
                "scopeChangeConversationId": scope_order[1],
            },
        )
        self._select_mobile_storage_rows(session, scope_ids)
        self._mobile_batch_confirmation(session)
        self._install_mobile_batch_progress_probe(session)
        session.execute_script(
            """
document.querySelector(
  '[data-chat-storage-batch-confirm-apply]'
)?.click();
"""
        )
        scope_ui = self._mapping(
            self._wait_for_value(
                lambda: (
                    value
                    if (
                        isinstance(
                            value := session.execute_script(
                                """
return {
  actions: Boolean(document.querySelector(
    '[data-chat-storage-batch-actions]'
  )),
  result: Boolean(document.querySelector(
    '[data-chat-storage-batch-result]'
  )),
  summary: Boolean(document.querySelector(
    '[data-chat-storage-summary]'
  )),
};
"""
                            ),
                            Mapping,
                        )
                        and value == {
                            "actions": False,
                            "result": False,
                            "summary": False,
                        }
                    )
                    else None
                ),
                "Mobile batch scope-change reset",
            ),
            "Mobile batch scope-change reset",
        )
        scope_progress = self._mobile_batch_progress(session)
        scope_completed = max(
            (
                int(item.get("completed") or 0)
                for item in scope_progress
                if isinstance(item, Mapping) and item.get("total") == 2
            ),
            default=0,
        )
        restart_after_scope = session.call_action("lifecycle.restart")
        if restart_after_scope != {"requested": True, "scope": "webview"}:
            raise GateError("Mobile scope recovery restart was not acknowledged")
        session.call_action("messaging.reconcile")
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        scope_snapshot_after = self._refresh_mobile_storage_rows(
            session,
            [],
        )
        scope_conversation_ids = set(
            scope_snapshot_after.get("conversationIds", [])
        )
        remaining_scope_ids = [
            conversation_id
            for conversation_id in scope_ids
            if conversation_id in scope_conversation_ids
        ]
        if (
            scope_ui != {
                "actions": False,
                "result": False,
                "summary": False,
            }
            or scope_completed not in {0, 1}
            or len(remaining_scope_ids) != 2 - scope_completed
        ):
            raise GateError("Mobile batch scope-change isolation is incomplete")
        self._select_mobile_storage_rows(session, remaining_scope_ids)
        self._mobile_batch_confirmation(session)
        session.execute_script(
            """
document.querySelector(
  '[data-chat-storage-batch-confirm-apply]'
)?.click();
"""
        )
        scope_cleanup = self._wait_mobile_batch_result(session, "succeeded")
        if scope_cleanup.get("succeeded") != len(remaining_scope_ids):
            raise GateError("Mobile scope-change remainder cleanup is incomplete")

        all_conversation_ids = [
            *conversation_ids,
            *partial_ids,
            *scope_ids,
        ]
        all_message_ids = [
            *message_ids,
            *partial_message_ids,
            *scope_message_ids,
        ]

        for conversation_id in all_conversation_ids:
            projection = self._mapping(
                session.call_action(
                    "messaging.projection.read",
                    {"conversationId": conversation_id},
                ),
                "conversation projection after storage batch clear",
            )
            messages = self._mapping(
                projection.get("messages"),
                "conversation messages after storage batch clear",
            ).get(conversation_id)
            if not isinstance(messages, list) or messages:
                raise GateError("storage batch clear left plaintext projections")
            search = session.call_action(
                "messaging.search",
                {
                    "conversationId": conversation_id,
                    "query": "cccccccc",
                    "limit": 20,
                },
            )
            if not isinstance(search, list) or search:
                raise GateError("storage batch clear left searchable plaintext")

        restart = session.call_action("lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("storage batch clear restart was not acknowledged")
        session.call_action("messaging.reconcile")
        for conversation_id in all_conversation_ids:
            projection = self._mapping(
                session.call_action(
                    "messaging.projection.read",
                    {"conversationId": conversation_id},
                ),
                "conversation projection after storage batch restart",
            )
            messages = self._mapping(
                projection.get("messages"),
                "conversation messages after storage batch restart",
            ).get(conversation_id)
            if not isinstance(messages, list) or messages:
                raise GateError(
                    "storage batch-cleared plaintext returned after restart"
                )

        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector('[data-chat-storage-refresh]');
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "storage refresh after batch clear",
        )
        after = self._wait_for_storage_snapshot(
            session,
            lambda value: int(value.get("physicalTotalBytes") or 0)
            < int(before.get("physicalTotalBytes") or 0),
            "Mobile batch clear physical reclamation",
        )
        identity_after = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity after storage batch clear",
        )
        if identity_after != identity_before:
            raise GateError(
                "storage batch clear changed the active messaging identity"
            )
        return {
            "scenario": "storage-batch-clear",
            "journeyId": journey_id,
            "conversationIds": all_conversation_ids,
            "messageIds": all_message_ids,
            "fixtureBytes": fixture_size * len(all_conversation_ids),
            "estimatedReclaimableBytes": estimated_reclaimable_bytes,
            "physicalBytesBefore": int(before["physicalTotalBytes"]),
            "physicalBytesAfter": int(after["physicalTotalBytes"]),
            "releasedBytes": int(batch_result["releasedBytes"]),
            "succeeded": int(batch_result["succeeded"]),
            "failed": int(batch_result["failed"]),
            "confirmation": confirmation,
            "progress": progress,
            "partialFailure": partial_result,
            "partialRetry": retry_result,
            "scopeChange": {
                "completed": scope_completed,
                "progress": scope_progress,
                "remainingConversationIds": remaining_scope_ids,
            },
            "plaintextAbsent": True,
            "searchEntryAbsent": True,
            "restartStable": True,
            "messagingIdentityPreserved": True,
        }

    @classmethod
    def _wait_for_storage_snapshot(
        cls,
        session: Any,
        predicate: Any,
        description: str,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + 60
        last: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            value = session.execute_script(
                """
const summary = document.querySelector('[data-chat-storage-summary]');
if (!summary) return null;
const categories = {};
for (const item of document.querySelectorAll('[data-chat-storage-category]')) {
  categories[item.getAttribute('data-chat-storage-category')] = Number(
    item.getAttribute('data-chat-storage-category-bytes') || '0'
  );
}
const result = document.querySelector('[data-chat-storage-clear-result]');
const retention = document.querySelector('[data-chat-storage-retention-preset]');
const retentionResult = document.querySelector('[data-chat-storage-retention-result]');
return {
  physicalTotalBytes: Number(
    summary.getAttribute('data-chat-storage-physical-bytes') || '0'
  ),
  measuredAtUnixMs: Number(
    summary.getAttribute('data-chat-storage-measured-at') || '0'
  ),
  messageBytes: Number(categories.message || 0),
  cacheBytes: Number(categories.cache || 0),
  conversationIds: Array.from(document.querySelectorAll(
    '[data-chat-storage-conversation]'
  )).map((item) => item.getAttribute('data-chat-storage-conversation') || ''),
  conversationReclaimableBytes: Object.fromEntries(
    Array.from(document.querySelectorAll(
      '[data-chat-storage-conversation]'
    )).map((item) => [
      item.getAttribute('data-chat-storage-conversation') || '',
      Number(
        item.getAttribute('data-chat-storage-reclaimable-bytes') || '0'
      ),
    ])
  ),
  retentionPreset: retention?.getAttribute('data-chat-storage-retention-preset') || '',
  retentionResultState: retentionResult?.getAttribute(
    'data-chat-storage-retention-result'
  ) || '',
  retentionReleasedBytes: Number(
    retentionResult?.getAttribute('data-chat-storage-retention-released-bytes') || '0'
  ),
  confirmVisible: Boolean(
    document.querySelector('[data-chat-storage-clear-confirm]')
  ),
  resultState: result?.getAttribute('data-chat-storage-clear-result') || '',
  releasedBytes: Number(
    result?.getAttribute('data-chat-storage-released-bytes') || '0'
  ),
};
"""
            )
            if isinstance(value, Mapping):
                last = dict(value)
                if predicate(last):
                    return last
            time.sleep(0.25)
        raise GateError(
            f"timed out waiting for {description}: {redact_text(str(last))}"
        )

    def _run_recovery_journey(
        self,
        *,
        sender_session: Any,
        receiver_session: Any,
        sender: MessagingActor,
        receiver: MessagingActor,
        journey_id: str,
    ) -> dict[str, Any]:
        chat_draft = sender_session.call_action(
            "reliability.draft.write",
            {
                "kind": "chat",
                "targetId": f"recovery-{journey_id}-chat",
                "text": f"recovery-{journey_id}-chat-draft",
            },
        )
        moment_draft = sender_session.call_action(
            "reliability.draft.write",
            {
                "kind": "moment",
                "targetId": f"recovery-{journey_id}-moment",
                "text": f"recovery-{journey_id}-moment-draft",
                "audienceKind": 1,
            },
        )
        before = self._reliability_snapshot(
            sender_session.call_action("reliability.snapshot"),
            "recovery snapshot before restart",
        )
        self._require_drafts(before, (chat_draft, moment_draft))
        restart = sender_session.call_action("lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("recovery lifecycle restart was not acknowledged")
        restored = sender_session.call_action("reliability.draft.read", {})
        self._require_drafts({"drafts": restored}, (chat_draft, moment_draft))

        sender_session.call_action(
            "reliability.fixture.configure",
            {"mode": "lose-dispatch-response-and-readback"},
        )
        try:
            submission = self._mapping(
                sender_session.call_action(
                    "reliability.friendRequest.submit",
                    {
                        "receiverPtid": receiver.ptid,
                        "receiverHomeStationPeerId": (
                            receiver.station_peer_id
                        ),
                        "federationId": sender.federation_id,
                        "message": f"recovery-{journey_id}",
                    },
                ),
                "recovery submission",
            )
            command = self._mapping(
                submission.get("command"),
                "recovery command",
            )
            command_id = self._text(
                command.get("commandId"),
                "recovery command ID",
            )
            request_id = self._text(
                command.get("requestId"),
                "recovery request ID",
            )
            payload_sha256 = self._sha256(
                command.get("payloadSha256"),
                "recovery payload digest",
            )
            if command.get("state") not in {
                "unknown-outcome",
                "reconciling",
            }:
                raise GateError(
                    "response-loss fixture did not preserve unknown outcome"
                )
            unresolved = self._reliability_snapshot(
                sender_session.call_action("reliability.snapshot"),
                "unresolved recovery snapshot",
            )
            self._require_command(
                unresolved,
                command_id,
                payload_sha256,
                {"unknown-outcome", "reconciling"},
            )
            recovery_ui = self._wait_for_recovery_kind(
                sender_session,
                "command-recovery",
            )
        finally:
            sender_session.call_action(
                "reliability.fixture.configure",
                {"mode": "none"},
            )

        reconciled = self._mapping(
            sender_session.call_action("reliability.reconcile"),
            "recovery reconcile",
        )
        commands = reconciled.get("commands")
        if (
            not isinstance(commands, list)
            or not any(
                isinstance(item, Mapping)
                and item.get("commandId") == command_id
                and item.get("payloadSha256") == payload_sha256
                and item.get("checkpointReady") is True
                for item in commands
            )
            or not isinstance(reconciled.get("appliedCheckpoints"), int)
            or int(reconciled["appliedCheckpoints"]) < 1
        ):
            raise GateError("recovery checkpoint was not applied")
        relationship = self._wait_for_friend_request(
            receiver_session,
            request_id=request_id,
            sender_ptid=sender.ptid,
            receiver_ptid=receiver.ptid,
        )
        retained = self._reliability_snapshot(
            sender_session.call_action(
                "reliability.draft.action",
                {"action": "restore"},
            ),
            "restored draft snapshot",
        )
        self._require_drafts(retained, (chat_draft, moment_draft))
        discarded = self._reliability_snapshot(
            sender_session.call_action(
                "reliability.draft.action",
                {"action": "discard"},
            ),
            "discarded draft snapshot",
        )
        if discarded["drafts"]:
            raise GateError("recovery draft discard did not remove all rows")
        return {
            "scenario": "recovery",
            "commandId": command_id,
            "requestId": request_id,
            "payloadSha256": payload_sha256,
            "checkpointApplied": True,
            "receiverReadback": relationship,
            "draftRestartReadback": True,
            "draftDiscarded": True,
            "recoveryProjection": recovery_ui,
        }

    def _run_recovery_ui_journey(
        self,
        *,
        session: Any,
        journey_id: str,
    ) -> dict[str, Any]:
        draft = session.call_action(
            "reliability.draft.write",
            {
                "kind": "chat",
                "targetId": f"recovery-ui-{journey_id}",
                "text": f"recovery-ui-{journey_id}-draft",
            },
        )
        restart = session.call_action("lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("recovery UI restart was not acknowledged")
        snapshot = self._wait_for_recovery_kind(
            session,
            "draft-restore-pending",
        )
        self._require_drafts(
            self._reliability_snapshot(
                session.call_action("reliability.snapshot"),
                "recovery UI reliability snapshot",
            ),
            (draft,),
        )
        return {
            "scenario": "recovery-ui",
            "visibleState": "draft-restore-pending",
            "actions": ["restore", "discard"],
            "snapshot": snapshot,
        }

    def _run_moments_journey(
        self,
        *,
        sender_session: Any,
        receiver_session: Any,
        sender: MessagingActor,
        receiver: MessagingActor,
        journey_id: str,
    ) -> dict[str, Any]:
        text = f"mobile-moment-{journey_id}"
        published = self._mapping(
            sender_session.call_action(
                "moments.publish",
                {"text": text, "audienceKind": 1},
            ),
            "published Moment",
        )
        post_id = self._text(published.get("postId"), "published Moment ID")
        if (
            published.get("authorPtid") != sender.ptid
            or published.get("text") != text
        ):
            raise GateError("published Moment identity or content changed")

        receiver_post = self._wait_for_moment(
            receiver_session,
            post_id,
            text,
        )
        reactions = receiver_session.call_action(
            "moments.react",
            {"postId": post_id, "reactionKind": 1, "active": True},
        )
        if not self._reaction_active(reactions, 1):
            raise GateError("Moment reaction readback is incomplete")
        comment = self._mapping(
            receiver_session.call_action(
                "moments.comment",
                {
                    "postId": post_id,
                    "content": f"comment-{journey_id}",
                },
            ),
            "Moment comment",
        )
        comment_id = self._text(
            comment.get("commentId"),
            "Moment comment ID",
        )
        reply = self._mapping(
            sender_session.call_action(
                "moments.comment",
                {
                    "postId": post_id,
                    "content": f"reply-{journey_id}",
                    "replyToCommentId": comment_id,
                },
            ),
            "Moment reply",
        )
        reply_id = self._text(reply.get("commentId"), "Moment reply ID")
        comments = self._wait_for_comments(
            receiver_session,
            post_id,
            {comment_id, reply_id},
        )
        unreacted = receiver_session.call_action(
            "moments.react",
            {"postId": post_id, "reactionKind": 1, "active": False},
        )
        if self._reaction_active(unreacted, 1):
            raise GateError("Moment reaction rollback did not converge")

        draft = sender_session.call_action(
            "reliability.draft.write",
            {
                "kind": "moment",
                "targetId": f"moment-compose-{journey_id}",
                "text": f"moment-draft-{journey_id}",
                "audienceKind": 1,
            },
        )
        sender_session.call_action("lifecycle.restart")
        self._require_drafts(
            {
                "drafts": sender_session.call_action(
                    "reliability.draft.read",
                    {"kind": "moment"},
                )
            },
            (draft,),
        )
        sender_session.call_action(
            "reliability.draft.action",
            {"kind": "moment", "action": "discard"},
        )
        return {
            "scenario": "moments",
            "post": receiver_post,
            "reactionCommitted": True,
            "reactionRolledBack": True,
            "commentId": comment_id,
            "replyId": reply_id,
            "commentCount": len(comments),
            "draftRestartReadback": True,
            "senderPtid": sender.ptid,
            "receiverPtid": receiver.ptid,
        }

    def _wait_for_friend_request(
        self,
        session: Any,
        *,
        request_id: str,
        sender_ptid: str,
        receiver_ptid: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            projection = self._mapping(
                session.call_action("social.reconcile"),
                "receiver Social projection",
            )
            requests = projection.get("friendRequests")
            if not isinstance(requests, list):
                return None
            return next(
                (
                    dict(item)
                    for item in requests
                    if isinstance(item, Mapping)
                    and item.get("requestId") == request_id
                    and item.get("senderPtid") == sender_ptid
                    and item.get("receiverPtid") == receiver_ptid
                ),
                None,
            )

        return self._wait_for_value(read, "receiver Friend Request")

    def _wait_for_moment(
        self,
        session: Any,
        post_id: str,
        text: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            feed = self._mapping(
                session.call_action("moments.feed.read"),
                "receiver Moments feed",
            )
            posts = feed.get("posts")
            if not isinstance(posts, list):
                return None
            return next(
                (
                    dict(item)
                    for item in posts
                    if isinstance(item, Mapping)
                    and item.get("postId") == post_id
                    and item.get("text") == text
                ),
                None,
            )

        return self._wait_for_value(read, "receiver Moment")

    def _wait_for_comments(
        self,
        session: Any,
        post_id: str,
        expected_ids: set[str],
    ) -> list[dict[str, Any]]:
        def read() -> list[dict[str, Any]] | None:
            raw = session.call_action(
                "moments.comments.read",
                {"postId": post_id},
            )
            if not isinstance(raw, list):
                return None
            comments = [
                dict(item) for item in raw if isinstance(item, Mapping)
            ]
            actual = {
                str(item.get("commentId", "")) for item in comments
            }
            return comments if expected_ids.issubset(actual) else None

        return self._wait_for_value(read, "Moment comments")

    def _wait_for_recovery_kind(
        self,
        session: Any,
        kind: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            snapshot = self._mapping(
                session.call_action("recovery.snapshot"),
                "recovery projection",
            )
            states = snapshot.get("states")
            if not isinstance(states, list):
                return None
            return snapshot if any(
                isinstance(item, Mapping) and item.get("kind") == kind
                for item in states
            ) else None

        return self._wait_for_value(read, f"recovery state {kind}")

    @staticmethod
    def _wait_for_value(
        read: Any,
        label: str,
        timeout_seconds: float = 30.0,
    ) -> Any:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            value = read()
            if value is not None:
                return value
            time.sleep(0.25)
        raise GateError(f"{label} did not converge")

    @staticmethod
    def _reliability_snapshot(
        value: Any,
        label: str,
    ) -> dict[str, Any]:
        snapshot = SimulatorSocialGate._mapping(value, label)
        if (
            not isinstance(snapshot.get("runtime"), Mapping)
            or not isinstance(snapshot.get("commands"), list)
            or not isinstance(snapshot.get("drafts"), list)
            or not isinstance(snapshot.get("checkpoints"), list)
        ):
            raise GateError(f"{label} is incomplete")
        return snapshot

    @staticmethod
    def _require_drafts(
        snapshot: Mapping[str, Any],
        expected: tuple[Any, ...],
    ) -> None:
        drafts = snapshot.get("drafts")
        if not isinstance(drafts, list):
            raise GateError("reliability draft projection is unavailable")
        expected_rows = {
            (
                item.get("kind"),
                item.get("targetId"),
                item.get("payloadSha256"),
            )
            for item in expected
            if isinstance(item, Mapping)
        }
        actual_rows = {
            (
                item.get("kind"),
                item.get("targetId"),
                item.get("payloadSha256"),
            )
            for item in drafts
            if isinstance(item, Mapping)
        }
        if len(expected_rows) != len(expected) or not expected_rows.issubset(
            actual_rows
        ):
            raise GateError("reliability drafts changed identity")

    @staticmethod
    def _require_command(
        snapshot: Mapping[str, Any],
        command_id: str,
        payload_sha256: str,
        allowed_states: set[str],
    ) -> None:
        commands = snapshot.get("commands")
        if not isinstance(commands, list) or not any(
            isinstance(item, Mapping)
            and item.get("commandId") == command_id
            and item.get("payloadSha256") == payload_sha256
            and item.get("state") in allowed_states
            for item in commands
        ):
            raise GateError("recovery command identity changed")

    @staticmethod
    def _reaction_active(
        value: Any,
        reaction_kind: int,
    ) -> bool:
        if not isinstance(value, list):
            return False
        matched = next(
            (
                item
                for item in value
                if isinstance(item, Mapping)
                and item.get("kind") == reaction_kind
            ),
            None,
        )
        return bool(
            matched
            and matched.get("reactedByViewer") is True
            and int(str(matched.get("count", "0"))) >= 1
        )

    @staticmethod
    def _mapping(value: Any, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must be an object")
        return dict(value)

    @staticmethod
    def _text(value: Any, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise GateError(f"{label} must be non-empty")
        return value

    @staticmethod
    def _sha256(value: Any, label: str) -> str:
        if (
            not isinstance(value, str)
            or len(value) != 64
            or any(character not in "0123456789abcdef" for character in value)
        ):
            raise GateError(f"{label} must be lowercase SHA-256")
        return value

    def _capture_client(
        self,
        artifacts: ArtifactSession,
        session: Any,
        client_id: str,
    ) -> dict[str, Any]:
        session.switch_to_native()
        screenshot = artifacts.write_bytes(
            f"mobile-simulator-social/{self.scenario}/{client_id}/screenshot.png",
            session.screenshot_bytes(),
            media_type="image/png",
            role=f"mobile-simulator-social-screenshot/{client_id}",
        )
        session.switch_to_app_webview()
        dom = artifacts.write_bytes(
            f"mobile-simulator-social/{self.scenario}/{client_id}/web-dom.html",
            _redacted_markup(session.get_page_source()),
            media_type="text/html",
            role=f"mobile-simulator-social-dom/{client_id}",
        )
        return {
            "clientId": client_id,
            "screenshot": screenshot.to_dict(),
            "dom": dom.to_dict(),
        }

    @staticmethod
    def _required_object(
        owner: Mapping[str, Any],
        name: str,
        resource: str,
    ) -> dict[str, Any]:
        value = owner.get(name)
        if not isinstance(value, dict):
            raise SimulatorGateBlocked(
                f"{resource} requires object {name}",
                f"{ENVIRONMENT_ID}:{name}",
            )
        return value

    @staticmethod
    def _required_text(
        owner: Mapping[str, Any],
        name: str,
        resource: str,
    ) -> str:
        value = owner.get(name)
        if not isinstance(value, str) or not value.strip():
            raise SimulatorGateBlocked(
                f"{resource} requires {name}",
                f"{ENVIRONMENT_ID}:{name}",
            )
        return value.strip()

    def _result_base(self, status: str) -> dict[str, Any]:
        metadata = SCENARIO_METADATA[self.scenario]
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": self.gate_id,
            "gate": self.gate_id,
            "environment": ENVIRONMENT_ID,
            "runtimeCell": self.gate_id,
            "scenario": self.scenario,
            "status": status,
            "completionStatus": (
                "DONE"
                if status == "PASS"
                else "BLOCKED"
                if status == "BLOCKED"
                else "PARTIAL"
            ),
            "proofStatus": "PROVEN" if status == "PASS" else "UNPROVEN",
            "phase": metadata["phase"],
            "bom": list(metadata["bom"]),
            "spec": list(metadata["spec"]),
            "observedScope": [
                "two isolated simulator clients",
                "two actors bound to one source-attested Station",
                "production Mobile Harness actions",
            ],
            "unprovenScope": list(OPTIONAL_DIAGNOSTIC_SCOPE),
            "physicalDeviceClaimed": False,
            "stationMocksUsed": False,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--scenario",
        choices=sorted(SCENARIO_GATES),
        required=True,
    )
    args = parser.parse_args()
    gate: AcceptanceGate = SimulatorSocialGate(args.scenario)
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
