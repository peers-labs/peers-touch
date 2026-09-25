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
        super().__init__(**kwargs)
        self.scenario = scenario
        self.gate_id = SCENARIO_GATES[scenario]

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
