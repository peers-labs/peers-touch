#!/usr/bin/env python3
"""Same-Station Social parity on one USB-authorized Android device."""

from __future__ import annotations

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
    EphemeralCapabilityBlocked,
    EphemeralGateClient,
    EvidenceError,
    GateError,
    ProvisioningError,
    REPO_ROOT,
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
    load_runtime_manifest,
    require_runtime_service,
)
from tooling.acceptance.core.redaction import redact_text
from tooling.acceptance.fixtures.chat_native_actors import ACTOR_PASSWORD
from tooling.acceptance.gates.mobile.appium import AppiumSession
from tooling.acceptance.gates.mobile.messaging_journey import (
    MessagingActor,
    MobileMessagingJourney,
)


GATE_ID = "mobile-social-android-native"
ENVIRONMENT_ID = "mobile-android-physical"
CLIENT_ID = "alice-android"
SCENARIO_IDS = (
    "rc02-home-explore",
    "rc02-search-profile",
    "rc02-circles-publish",
    "rc02-thread-reaction",
    "rc02-recovery-lifecycle",
    "rc02-native-quality",
)
RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "mps-android-same-station-functional",
        "scenarioIds": list(SCENARIO_IDS),
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 3,
        "minWarmReuseRate": 0.8,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": False,
    }
)


class AndroidSocialBlocked(Exception):
    def __init__(self, reason: str, resource: str) -> None:
        super().__init__(reason)
        self.reason = reason
        self.resource = resource


class _ActorController:
    def __init__(
        self,
        session: AppiumSession,
        actors: Mapping[str, MessagingActor],
    ) -> None:
        self.session = session
        self.actors = actors
        self.journey = MobileMessagingJourney(timeout_seconds=45)
        self.active_role = ""
        self.authentications: list[dict[str, str]] = []

    def activate(self, role: str) -> None:
        if self.active_role == role:
            return
        if self.active_role:
            self.session.call_action(
                "session.logout",
                {"draftDisposition": "discard"},
            )
            self.active_role = ""
        authentication = self.journey.authenticate(
            self.session,
            self.actors[role],
            password=ACTOR_PASSWORD,
        )
        self.authentications.append(authentication)
        self.active_role = role

    def mark_logged_out(self) -> None:
        self.active_role = ""


class _ActorScopedSession:
    def __init__(self, controller: _ActorController, role: str) -> None:
        self.controller = controller
        self.role = role

    def call_action(
        self,
        action: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        self.controller.activate(self.role)
        value = self.controller.session.call_action(action, payload)
        if action == "session.logout":
            self.controller.mark_logged_out()
        return value

    def social_ui(
        self,
        action: str,
        payload: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.controller.activate(self.role)
        return self.controller.session.social_ui(action, payload)

    def background_app(self, duration_seconds: float = 1.0) -> None:
        self.controller.activate(self.role)
        self.controller.session.background_app(duration_seconds)


class AndroidSocialGate(AcceptanceGate):
    gate_id = GATE_ID

    def __init__(
        self,
        *,
        capability_client: EphemeralGateClient | None = None,
    ) -> None:
        AcceptanceGate.__init__(self)
        self.scenario = "android-social-parity"
        self.environment_id = ENVIRONMENT_ID
        self.capability_client = capability_client
        self.lifecycle: list[dict[str, Any]] = []
        self.cleanup: list[dict[str, Any]] = []
        self.suite_runtime_ledger: SuiteRuntimeLedger | None = None
        self._session: AppiumSession | None = None

    def run(self) -> dict[str, Any]:
        raise GateError(
            "AndroidSocialGate uses its evidence-aware execute entrypoint"
        )

    def execute(self) -> int:
        with ArtifactSession(repo_root=REPO_ROOT, gate_id=self.gate_id) as artifacts:
            status = "FAIL"
            completion_status = "PARTIAL"
            proof_status = "UNPROVEN"
            exit_code = 1
            result: dict[str, Any]
            try:
                manifest = self._load_android_manifest()
                result = self._run_android_suite(artifacts, manifest)
                status = "PASS"
                completion_status = "DONE"
                proof_status = "PROVEN"
                exit_code = 0
            except AndroidSocialBlocked as error:
                status = "BLOCKED"
                completion_status = "BLOCKED"
                exit_code = 2
                result = self._result_base("BLOCKED")
                result.update(
                    {
                        "blockedReason": redact_text(error.reason),
                        "blockedResource": error.resource,
                    }
                )
            except (
                DriverError,
                EphemeralCapabilityBlocked,
                EvidenceError,
                GateError,
                ProvisioningError,
            ) as error:
                result = self._result_base("FAIL")
                result.update(
                    {
                        "reason": redact_text(str(error)),
                        "errorType": type(error).__name__,
                    }
                )
            finally:
                self._cleanup_android_runtime()

            cleanup_failed = any(
                item["status"] == "failed" for item in self.cleanup
            )
            if self.suite_runtime_ledger is not None and not cleanup_failed:
                self.suite_runtime_ledger.record(
                    SuiteRuntimeAction.CLEANUP_COMPLETE,
                )
            if self.suite_runtime_ledger is not None:
                suite_report = self.suite_runtime_ledger.report()
                suite_ref = artifacts.write_json(
                    "mobile-android-social/suite-runtime.json",
                    suite_report,
                    role="mobile-social-android-suite-runtime",
                )
                result["suiteRuntime"] = {
                    "report": suite_ref.to_dict(),
                    "result": suite_report["result"],
                    "proofState": suite_report["proofState"],
                    "reportDigest": suite_report["reportDigest"],
                }
                cleanup_failed = (
                    cleanup_failed or suite_report["result"] != "PASS"
                )
            if cleanup_failed:
                status = "FAIL"
                completion_status = "PARTIAL"
                proof_status = "UNPROVEN"
                exit_code = 1
                result["cleanupReason"] = (
                    "Android Social physical runtime cleanup was incomplete"
                )
                result.setdefault("reason", result["cleanupReason"])

            result.update(
                {
                    "status": status,
                    "completionStatus": completion_status,
                    "proofStatus": proof_status,
                    "cleanup": list(self.cleanup),
                }
            )
            artifacts.write_json(
                "mobile-android-social/lifecycle.json",
                {
                    "artifactKind": "mobile-social-android-lifecycle",
                    "gateId": self.gate_id,
                    "events": self.lifecycle,
                },
                role="mobile-social-android-lifecycle",
            )
            artifacts.write_json(
                "mobile-android-social/result.json",
                result,
                role="mobile-social-android-result",
            )
            artifacts.complete(
                status=status,
                completion_status=completion_status,
                proof_status=proof_status,
                runtime={
                    "environment": self.environment_id,
                    "runtimeCell": "MPS-RC02",
                    "clients": [CLIENT_ID],
                    "physicalDeviceClaimed": status == "PASS",
                },
            )

        stream = sys.stdout if exit_code == 0 else sys.stderr
        stream.write(f"{status}: {self.gate_id}\n")
        return exit_code

    def _load_android_manifest(self) -> dict[str, Any]:
        manifest_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
        if not manifest_path:
            raise AndroidSocialBlocked(
                "PT_ACCEPTANCE_RUNTIME_MANIFEST is required",
                f"{self.environment_id}:manifest",
            )
        try:
            manifest = load_runtime_manifest(
                Path(manifest_path),
                self.gate_id,
            )
            require_runtime_service(
                manifest,
                "station-primary",
                "station",
            )
        except ProvisioningError as error:
            raise AndroidSocialBlocked(
                str(error),
                f"{self.environment_id}:manifest",
            ) from error
        if manifest.get("environmentId") != self.environment_id:
            raise AndroidSocialBlocked(
                f"RuntimeManifest environment must be {self.environment_id}",
                f"{self.environment_id}:environment",
            )
        return manifest

    def _run_android_suite(
        self,
        artifacts: ArtifactSession,
        manifest: Mapping[str, Any],
    ) -> dict[str, Any]:
        source = self._required_object(manifest, "source", "RuntimeManifest")
        source_commit = self._required_text(
            source,
            "commit",
            "RuntimeManifest source",
        )
        resources = self._required_object(
            manifest,
            "mobileNative",
            "RuntimeManifest",
        )
        if resources.get("scenario") != "android-social":
            raise AndroidSocialBlocked(
                "RuntimeManifest scenario must be android-social",
                f"{self.environment_id}:scenario",
            )
        session, device_facts = self._start_physical_session(
            artifacts,
            resources,
        )
        self._session = session
        actors = self._load_android_actors(artifacts, manifest)
        controller = _ActorController(session, actors)
        scoped = {
            role: _ActorScopedSession(controller, role)
            for role in ("alice", "bob", "eve")
        }
        journey = controller.journey
        fixture_epoch = self._required_text(
            manifest,
            "runId",
            "Android Social RuntimeManifest",
        )
        ledger = SuiteRuntimeLedger(
            RUNTIME_REUSE,
            suite_runtime_id=f"mps-11a-{artifacts.run_id[-12:]}",
            source_digest=source_commit,
            fixture_epoch=fixture_epoch,
        )
        self.suite_runtime_ledger = ledger
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id=f"{self.environment_id}:{fixture_epoch}",
        )
        ledger.record(
            SuiteRuntimeAction.ACCOUNT_PROVISION,
            resource_id="actors:alice,bob,eve:existing",
        )
        ledger.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id=f"client:{CLIENT_ID}",
        )

        state: dict[str, Any] = {}
        journey_id = artifacts.run_id[-12:]
        runners = (
            (
                "rc02-home-explore",
                lambda: self._run_ios_home_explore(
                    scoped["alice"],
                    scoped["bob"],
                    actors["alice"],
                    journey_id,
                    state,
                ),
            ),
            (
                "rc02-search-profile",
                lambda: self._run_ios_search_profile(
                    scoped["alice"],
                    actors["bob"],
                ),
            ),
            (
                "rc02-circles-publish",
                lambda: self._run_ios_circles_publish(
                    scoped["alice"],
                    scoped["bob"],
                    actors["alice"],
                    actors["bob"],
                    journey,
                    journey_id,
                    state,
                ),
            ),
            (
                "rc02-thread-reaction",
                lambda: self._run_ios_thread_reaction(
                    scoped["bob"],
                    journey_id,
                    state,
                ),
            ),
            (
                "rc02-recovery-lifecycle",
                lambda: self._run_android_recovery_lifecycle(
                    scoped["alice"],
                    scoped["eve"],
                    actors["eve"],
                    journey_id,
                    state,
                ),
            ),
            (
                "rc02-native-quality",
                lambda: self._run_android_native_quality(
                    scoped["bob"],
                    session,
                ),
            ),
        )
        results: list[dict[str, Any]] = []
        for scenario_id, runner in runners:
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id=scenario_id,
            )
            started_at = time.monotonic()
            scenario_result = runner()
            duration_seconds = time.monotonic() - started_at
            ledger.record(
                SuiteRuntimeAction.UI_ACTION,
                scenario_id=scenario_id,
                resource_id=str(scenario_result["uiAction"]),
                duration_seconds=duration_seconds,
            )
            ledger.record(
                SuiteRuntimeAction.RECEIVER_ASSERTION,
                scenario_id=scenario_id,
                resource_id=str(scenario_result["receiverAssertion"]),
            )
            ledger.record(
                SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                scenario_id=scenario_id,
                resource_id=str(scenario_result["supportingObservation"]),
            )
            ledger.record(
                SuiteRuntimeAction.SCENARIO_END,
                scenario_id=scenario_id,
            )
            results.append({"scenarioId": scenario_id, **scenario_result})

        return {
            **self._result_base("PASS"),
            "source": {"commit": source_commit},
            "device": device_facts,
            "authentication": controller.authentications,
            "journey": {
                "scenario": "android-social-parity",
                "runtimeCell": "MPS-RC02",
                "actors": {
                    role: actor.ptid for role, actor in actors.items()
                },
                "scenarios": results,
                "unprovenScope": [
                    "iOS current-run proof",
                    "cross-Station or Relay delivery",
                    "Desktop interoperability",
                    "full SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN",
                ],
            },
        }

    def _start_physical_session(
        self,
        artifacts: ArtifactSession,
        resources: Mapping[str, Any],
    ) -> tuple[AppiumSession, dict[str, Any]]:
        if self.capability_client is None:
            raise AndroidSocialBlocked(
                "Android Social requires the Appium launch capability",
                "mobile-runtime:ephemeral-launch-context",
            )
        source = self._required_object(
            resources,
            "sourceArtifacts",
            "Mobile source artifacts",
        )
        applications = self._required_object(
            source,
            "applications",
            "Mobile source artifacts",
        )
        clients = self._required_object(
            source,
            "clients",
            "Mobile source artifacts",
        )
        runtime_clients = self._required_object(
            resources,
            "clients",
            "Mobile runtime resources",
        )
        if set(clients) != {CLIENT_ID} or set(runtime_clients) != {CLIENT_ID}:
            raise AndroidSocialBlocked(
                "Android Social requires one physical client",
                "mobile-runtime:scenario-clients",
            )
        application = self._required_object(
            applications,
            "android",
            "Android source application",
        )
        source_client = self._required_object(
            clients,
            CLIENT_ID,
            "Android source client",
        )
        runtime_client = self._required_object(
            runtime_clients,
            CLIENT_ID,
            "Android runtime client",
        )
        facts = self._required_object(
            runtime_client,
            "deviceFacts",
            "Android runtime client",
        )
        if (
            facts.get("physical") is not True
            or facts.get("authorized") is not True
            or facts.get("kernelQemu") not in {"", "0"}
            or facts.get("abi") != "arm64-v8a"
        ):
            raise AndroidSocialBlocked(
                "Android physical device facts are invalid",
                "mobile-runtime:physical-device",
            )
        build_ref = ArtifactRef.from_dict(
            self._required_object(
                application,
                "buildAttestation",
                "Android source application",
            )
        )
        device_ref = ArtifactRef.from_dict(
            self._required_object(
                source_client,
                "physicalDeviceLease",
                "Android source client",
            )
        )
        callback_scheme = self._required_text(
            self._required_object(
                resources,
                "applications",
                "Mobile runtime resources",
            )["android"],
            "callbackScheme",
            "Android runtime application",
        )
        session = AppiumSession(
            self.capability_client,
            client_id=CLIENT_ID,
            platform="android",
            physical_device_lease=device_ref,
            build_attestation=build_ref,
            callback_scheme=callback_scheme,
            gate_id=self.gate_id,
            installation_trace_field="installationTrace",
        )
        session.start()
        session.wait_for_ready()
        session.switch_to_native()
        session.verify_installed_build_identity(session.installation_trace)
        session.switch_to_app_webview()
        harness = self._required_object(
            resources,
            "harness",
            "Mobile runtime resources",
        )
        required_actions = harness.get("requiredActions")
        if not isinstance(required_actions, list):
            raise AndroidSocialBlocked(
                "Android Social Harness actions are invalid",
                "mobile-runtime:harness-actions",
            )
        session.require_harness(required_actions)
        self.lifecycle.append(
            {"clientId": CLIENT_ID, "event": "physical-harness-ready"}
        )
        artifacts.write_json(
            "mobile-android-social/device-facts.json",
            {
                "artifactKind": "mobile-social-android-device-facts",
                "gateId": self.gate_id,
                "clientId": CLIENT_ID,
                **facts,
            },
            role="mobile-social-android-device-facts",
        )
        return session, dict(facts)

    def _load_android_actors(
        self,
        artifacts: ArtifactSession,
        manifest: Mapping[str, Any],
    ) -> dict[str, MessagingActor]:
        raw_ref = manifest.get("actorManifest")
        if not isinstance(raw_ref, Mapping):
            raise AndroidSocialBlocked(
                "Android Social actor manifest is missing",
                f"{self.environment_id}:actor-manifest",
            )
        reference = ArtifactRef.from_dict(raw_ref)
        if (
            reference.workspace_id != artifacts.store.workspace_id
            or reference.gate_id != self.gate_id
            or reference.run_id != artifacts.run_id
        ):
            raise AndroidSocialBlocked(
                "Android Social actor manifest identity is invalid",
                f"{self.environment_id}:actor-manifest",
            )
        payload = artifacts.store.read_json(reference)
        stations = self._required_object(
            payload,
            "stations",
            "Android Social actor manifest",
        )
        station = self._required_object(
            stations,
            "station-primary",
            "Android Social actor manifest",
        )
        entries = station.get("actors")
        if not isinstance(entries, list):
            raise AndroidSocialBlocked(
                "Android Social actor entries are missing",
                f"{self.environment_id}:actor-manifest",
            )
        service = require_runtime_service(
            manifest,
            "station-primary",
            "station",
        )
        station_url = self._required_text(
            service,
            "endpoint",
            "Android Social Station",
        )
        station_peer_id = self._required_text(
            service,
            "runtimeIdentity",
            "Android Social Station",
        )
        actors: dict[str, MessagingActor] = {}
        for role in ("alice", "bob", "eve"):
            actor = next(
                (
                    item
                    for item in entries
                    if isinstance(item, Mapping)
                    and item.get("role") == role
                ),
                None,
            )
            if not isinstance(actor, Mapping):
                raise AndroidSocialBlocked(
                    f"Android Social actor {role!r} is missing",
                    f"{self.environment_id}:actor-manifest",
                )
            actors[role] = MessagingActor(
                client_id=CLIENT_ID,
                role=role,
                station_url=station_url,
                station_peer_id=station_peer_id,
                ptid=self._required_text(
                    actor,
                    "ptid",
                    f"Android Social actor {role}",
                ),
                account_ref=self._required_text(
                    actor,
                    "accountRef",
                    f"Android Social actor {role}",
                ),
                federated_handle=self._required_text(
                    actor,
                    "federatedHandle",
                    f"Android Social actor {role}",
                ),
                federation_id=self._required_text(
                    actor,
                    "federationId",
                    f"Android Social actor {role}",
                ),
            )
        return actors

    def _run_ios_home_explore(
        self,
        sender_session: _ActorScopedSession,
        receiver_session: _ActorScopedSession,
        sender: MessagingActor,
        journey_id: str,
        state: dict[str, Any],
    ) -> dict[str, Any]:
        text = f"mps11a-public-{journey_id}"
        published = self._mapping(
            sender_session.call_action(
                "moments.publish",
                {"text": text, "audienceKind": 1},
            ),
            "Android public seed Moment",
        )
        post_id = self._text(
            published.get("postId"),
            "Android public seed post ID",
        )
        state["publicPostId"] = post_id
        state["publicPostText"] = text
        receiver_session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._wait_ui(
            receiver_session,
            '[data-acceptance-id="social-moments-page"]',
            "Android Moments page",
        )
        self._click_ui(
            receiver_session,
            '[data-acceptance-id="social-feed-scope-explore"]',
            "Android Explore tab",
        )
        self._wait_ui_attribute(
            receiver_session,
            '[data-acceptance-id="social-moments-page"]',
            "data-feed-scope",
            "explore",
            "Android Explore scope",
        )
        self._click_ui(
            receiver_session,
            '[data-acceptance-id="social-explore-sort-hot"]',
            "Android Explore hot sort",
        )
        self._click_ui(
            receiver_session,
            '[data-acceptance-id="social-feed-scope-home"]',
            "Android Home tab",
        )
        self._wait_ui_attribute(
            receiver_session,
            '[data-acceptance-id="social-moments-page"]',
            "data-feed-scope",
            "home",
            "Android Home scope",
        )
        receiver_post = self._wait_for_moment(
            receiver_session,
            post_id,
            text,
        )
        self._wait_post_visible(receiver_session, post_id, text)
        return {
            "uiAction": "android-moments-home-explore-switch",
            "receiverAssertion": f"receiver-post:{post_id}",
            "supportingObservation": f"timeline-author:{sender.ptid}",
            "post": receiver_post,
        }

    def _run_ios_search_profile(
        self,
        session: _ActorScopedSession,
        receiver: MessagingActor,
    ) -> dict[str, Any]:
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._wait_ui(
            session,
            '[data-acceptance-id="social-moments-page"]',
            "Android Moments page before Search",
        )
        self._click_ui(
            session,
            '[data-acceptance-id="social-search-open"]',
            "Android Social Search",
        )
        self._wait_ui(
            session,
            '[data-acceptance-id="social-search-page"]',
            "Android Social Search page",
        )
        self._set_ui_value(
            session,
            '[data-acceptance-id="social-search-input"] input',
            receiver.federated_handle,
            "Android Social Search query",
        )
        self._click_ui(
            session,
            '[data-acceptance-id="social-search-input"] '
            ".ant-input-search-button",
            "Android Social Search submit",
        )
        result_selector = (
            '[data-acceptance-id="social-search-result"]'
            f'[data-actor-ptid="{receiver.ptid}"]'
        )
        self._wait_ui(session, result_selector, "Android Social Search result")
        self._click_ui(session, result_selector, "Android Social Search result")
        profile_selector = (
            '[data-acceptance-id="social-profile-page"]'
            f'[data-profile-actor-ptid="{receiver.ptid}"]'
        )
        self._wait_ui(session, profile_selector, "Android Social Profile")
        self._wait_ui(
            session,
            '[data-acceptance-id="social-profile-authored-posts"]',
            "Android Social authored posts",
        )
        return {
            "uiAction": f"android-search-open-profile:{receiver.ptid}",
            "receiverAssertion": f"profile-visible:{receiver.ptid}",
            "supportingObservation": (
                f"federation:{receiver.federation_id}"
            ),
        }

    def _run_ios_circles_publish(
        self,
        sender_session: _ActorScopedSession,
        receiver_session: _ActorScopedSession,
        sender: MessagingActor,
        receiver: MessagingActor,
        journey: MobileMessagingJourney,
        journey_id: str,
        state: dict[str, Any],
    ) -> dict[str, Any]:
        conversation_id = journey._create_direct(
            sender_session,
            receiver_session,
            sender,
            receiver,
        )
        group_id = f"mps11a-group-{journey_id}"
        sender_session.call_action(
            "messaging.createGroup",
            {
                "conversationId": group_id,
                "name": f"MPS11A {journey_id}",
                "memberPtids": [sender.ptid, receiver.ptid],
                "federationId": sender.federation_id,
            },
        )
        sender_session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circles-open"]',
            "Android Social Circles",
        )
        self._wait_ui(
            sender_session,
            '[data-acceptance-id="social-circles-page"]',
            "Android Social Circles page",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circle-create-open"]',
            "Android Create Circle",
        )
        circle_name = f"MPS11A {journey_id}"
        renamed_circle = f"{circle_name} renamed"
        self._set_ui_value(
            sender_session,
            '[data-acceptance-id="social-circle-create-name"]',
            circle_name,
            "Android Circle name",
        )
        self._set_ui_value(
            sender_session,
            '[data-acceptance-id="social-circle-create-description"]',
            "MPS-11A Android same-Station audience",
            "Android Circle description",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circle-create-submit"]',
            "Android Create Circle submit",
        )
        circle_id = self._wait_ui_attribute_value(
            sender_session,
            '[data-acceptance-id="social-circle-detail"]',
            "data-circle-id",
            "Android Circle detail",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circle-add-members"]',
            "Android Add Circle members",
        )
        self._set_ui_value(
            sender_session,
            '[data-acceptance-id="social-circle-member-search"] input',
            receiver.federated_handle,
            "Android Circle member search",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circle-member-search"] '
            ".ant-input-search-button",
            "Android Circle member search submit",
        )
        candidate_selector = (
            '[data-acceptance-id="social-circle-member-candidate"]'
            f'[data-actor-ptid="{receiver.ptid}"]'
        )
        self._wait_ui(
            sender_session,
            candidate_selector,
            "Android Circle member candidate",
        )
        self._click_ui(
            sender_session,
            candidate_selector,
            "Android Circle member candidate",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circle-members-submit"]',
            "Android Circle members submit",
        )
        self._set_ui_value(
            sender_session,
            '[data-acceptance-id="social-circle-name"]',
            renamed_circle,
            "Android renamed Circle",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circle-save"]',
            "Android Save Circle",
        )
        before = self._mapping(
            sender_session.call_action("moments.private.snapshot"),
            "Android private Moment snapshot before publish",
        )
        before_ids = {
            item.get("postId")
            for item in before.get("publish", [])
            if isinstance(item, Mapping) and item.get("postId")
        }
        sender_session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-composer-open"]',
            "Android Moment composer",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-audience-select"]',
            "Android Audience sheet",
        )
        self._click_ui(
            sender_session,
            '[data-audience-option="CIRCLE"]',
            "Android Circle audience",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-audience-target-done"]',
            "Android Circle target",
        )
        private_text = f"mps11a-circle-{journey_id}"
        self._set_ui_value(
            sender_session,
            '[data-acceptance-id="social-composer-text"]',
            private_text,
            "Android private Moment text",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-composer-publish"]',
            "Android publish private Moment",
        )
        private_post = self._wait_new_private_post(
            sender_session,
            before_ids,
        )
        private_post_id = self._text(
            private_post.get("postId"),
            "Android private Moment post ID",
        )
        state.update(
            {
                "privatePostId": private_post_id,
                "privatePostText": private_text,
                "circleId": circle_id,
                "groupId": group_id,
                "conversationId": conversation_id,
            }
        )
        receiver_session.call_action("moments.private.reconcile")
        receiver_read = self._mapping(
            receiver_session.call_action(
                "moments.private.read",
                {"postId": private_post_id},
            ),
            "Android receiver private Moment readback",
        )
        if receiver_read.get("state") != "CONTENT_READY":
            raise GateError(
                "Android receiver private Moment did not reach CONTENT_READY"
            )
        receiver_session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._wait_post_visible(receiver_session, private_post_id, "")
        return {
            "uiAction": f"android-circle-create-publish:{circle_id}",
            "receiverAssertion": f"private-post:{private_post_id}",
            "supportingObservation": (
                f"circle-member:{receiver.ptid};group:{group_id}"
            ),
            "circleId": circle_id,
            "privatePostId": private_post_id,
            "receiverState": receiver_read["state"],
        }

    def _run_ios_thread_reaction(
        self,
        session: _ActorScopedSession,
        journey_id: str,
        state: Mapping[str, Any],
    ) -> dict[str, Any]:
        post_id = self._text(
            state.get("privatePostId"),
            "Android private post state",
        )
        for index in range(11):
            session.call_action(
                "moments.private.comment.submit",
                {
                    "draftId": f"mps11a-{journey_id}-comment-{index}",
                    "draftRevision": 1,
                    "postId": post_id,
                    "text": f"MPS11A comment {index}",
                    "mentions": [],
                },
            )
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._wait_post_visible(session, post_id, "")
        self._click_ui_for_post(
            session,
            post_id,
            "social-thread-open",
            "Android Moment thread",
        )
        thread_selector = (
            '[data-acceptance-id="social-moment-thread"]'
            f'[data-post-id="{post_id}"]'
        )
        self._wait_ui(session, thread_selector, "Android Moment thread")
        self._wait_ui_attribute(
            session,
            f"{thread_selector} [data-comment-total]",
            "data-comment-visible",
            "10",
            "Android default ten comments",
        )
        self._set_ui_value(
            session,
            f'{thread_selector} [data-acceptance-id="social-comment-input"]',
            f"MPS11A UI comment {journey_id}",
            "Android inline comment",
        )
        self._click_ui(
            session,
            f'{thread_selector} [data-acceptance-id="social-comment-send"]',
            "Android inline comment submit",
        )
        self._wait_ui_text(
            session,
            thread_selector,
            f"MPS11A UI comment {journey_id}",
            "Android inline comment readback",
        )
        for reaction_kind in range(1, 6):
            self._click_ui_for_post(
                session,
                post_id,
                "social-reaction-open",
                "Android Reaction picker",
            )
            self._click_ui(
                session,
                (
                    '[data-acceptance-id="social-reaction-choice"]'
                    f'[data-reaction-kind="{reaction_kind}"]'
                ),
                f"Android Reaction kind {reaction_kind}",
            )
        return {
            "uiAction": f"android-thread-comment-reactions:{post_id}",
            "receiverAssertion": f"inline-comment-visible:{post_id}",
            "supportingObservation": "comments-default-visible:10",
            "postId": post_id,
            "reactionKinds": [1, 2, 3, 4, 5],
        }

    def _run_android_recovery_lifecycle(
        self,
        alice: _ActorScopedSession,
        eve: _ActorScopedSession,
        eve_actor: MessagingActor,
        journey_id: str,
        state: Mapping[str, Any],
    ) -> dict[str, Any]:
        alice.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._click_ui(
            alice,
            '[data-acceptance-id="social-composer-open"]',
            "Open composer for Android recovery",
        )
        draft_text = f"MPS11A recovery draft {journey_id}"
        self._set_ui_value(
            alice,
            '[data-acceptance-id="social-composer-text"]',
            draft_text,
            "Android recovery draft",
        )
        restart = self._mapping(
            alice.call_action("lifecycle.restart"),
            "Android lifecycle restart",
        )
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("Android lifecycle restart was not acknowledged")
        self._wait_ui_text(
            alice,
            '[data-acceptance-id="social-composer"]',
            draft_text,
            "Android restored Moment draft",
        )
        alice.call_action(
            "session.logout",
            {"draftDisposition": "discard"},
        )
        scope = self._mapping(
            eve.call_action("lifecycle.scope.read"),
            "Android Eve lifecycle scope",
        )
        if scope.get("activeActorPtid") != eve_actor.ptid:
            raise GateError("Android account switch did not activate Eve")
        private_snapshot = self._mapping(
            eve.call_action("moments.private.snapshot"),
            "Android Eve private Moment snapshot",
        )
        old_post_id = self._text(
            state.get("privatePostId"),
            "Android private post state",
        )
        snapshot_text = json.dumps(private_snapshot, sort_keys=True)
        if old_post_id in snapshot_text or draft_text in snapshot_text:
            raise GateError("Android account switch exposed old-scope state")
        return {
            "uiAction": "android-composer-restart-account-switch",
            "receiverAssertion": f"new-scope:{eve_actor.ptid}",
            "supportingObservation": "old-scope-plaintext-absent",
            "activeActorPtid": eve_actor.ptid,
            "draftRestored": True,
        }

    def _run_android_native_quality(
        self,
        bob: _ActorScopedSession,
        session: AppiumSession,
    ) -> dict[str, Any]:
        bob.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._wait_ui(
            bob,
            '[data-acceptance-id="social-moments-page"]',
            "Android Moments page",
        )
        self._click_ui(
            bob,
            '[data-acceptance-id="social-composer-open"]',
            "Android composer",
        )
        composer_metrics = bob.social_ui("metrics")
        self._set_ui_value(
            bob,
            '[data-acceptance-id="social-composer-text"]',
            "keyboard probe",
            "Android keyboard probe",
        )
        keyboard_composer_metrics = bob.social_ui("metrics")
        keyboard = bob.social_ui("keyboard-state")
        back = bob.social_ui("system-back")
        bob.background_app(1.0)
        self._wait_ui(
            bob,
            '[data-acceptance-id="social-moments-page"]',
            "Android Moments page after background",
        )
        restart = self._mapping(
            bob.call_action("lifecycle.restart"),
            "Android quality restart",
        )
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("Android quality restart was not acknowledged")
        self._wait_ui(
            bob,
            '[data-acceptance-id="social-moments-page"]',
            "Android Moments page after restart",
        )
        metrics = bob.social_ui("metrics")
        if (
            int(metrics.get("viewportWidth", 0)) < 320
            or int(metrics.get("viewportHeight", 0)) < 480
            or float(metrics.get("viewportOffsetTop", -1)) < 0
            or metrics.get("tabCount") != 2
            or int(metrics.get("cardCount", 101)) > 100
            or metrics.get("searchLabelled") is not True
            or metrics.get("circlesLabelled") is not True
            or metrics.get("composerLabelled") is not True
            or float(metrics.get("scopeWidth", 0))
            < float(metrics.get("pageWidth", 0)) - 40
            or metrics.get("flatFeed") is not True
            or composer_metrics.get("composerBottomSheet") is not True
            or composer_metrics.get("composerInputDominant") is not True
            or composer_metrics.get("composerBottomAnchored") is not True
            or float(composer_metrics.get("composerInputHeight", 0)) < 220
            or not (
                40
                <= float(composer_metrics.get("composerAudienceHeight", 0))
                <= 44
            )
            or not (
                42
                <= float(composer_metrics.get("composerHeaderHeight", 0))
                <= 46
            )
            or not (
                30
                <= float(composer_metrics.get("composerPublishHeight", 0))
                <= 34
            )
            or not (
                48
                <= float(composer_metrics.get("composerBottomClearance", 0))
                <= 96
            )
            or abs(float(composer_metrics.get("composerTabbarGap", 99))) > 2
            or keyboard_composer_metrics.get("composerBottomSheet") is not True
            or back != {"pressed": True}
        ):
            raise GateError("Android native quality metrics are invalid")
        session.switch_to_native()
        accessibility = session.capture_native_accessibility()
        screenshot = session.capture_screenshot("rc02-native-quality")
        session.switch_to_app_webview()
        return {
            "uiAction": "android-keyboard-back-background-restart",
            "receiverAssertion": "android-native-ax-and-screenshot",
            "supportingObservation": "android-safe-area-bounded-feed",
            "keyboardObserved": keyboard.get("shown") is True,
            "metrics": metrics,
            "composerMetrics": composer_metrics,
            "keyboardComposerMetrics": keyboard_composer_metrics,
            "accessibility": accessibility.to_dict(),
            "screenshot": screenshot.to_dict(),
        }

    def _wait_ui(
        self,
        session: _ActorScopedSession,
        selector: str,
        label: str,
    ) -> dict[str, Any]:
        return self._wait_social_ui(
            lambda: session.social_ui("query", {"selector": selector}),
            lambda value: value.get("exists") is True,
            label,
        )

    def _click_ui(
        self,
        session: _ActorScopedSession,
        selector: str,
        label: str,
    ) -> None:
        result = self._wait_social_ui(
            lambda: session.social_ui("click", {"selector": selector}),
            lambda value: value.get("clicked") is True,
            label,
        )
        if result.get("clicked") is not True:
            raise GateError(f"{label} was not clicked")

    def _click_ui_for_post(
        self,
        session: _ActorScopedSession,
        post_id: str,
        action_id: str,
        label: str,
    ) -> None:
        selector = (
            '[data-acceptance-id="social-moment-card"]'
            f'[data-post-id="{post_id}"] '
            f'[data-acceptance-id="{action_id}"]'
        )
        self._click_ui(session, selector, label)

    def _set_ui_value(
        self,
        session: _ActorScopedSession,
        selector: str,
        value: str,
        label: str,
    ) -> None:
        result = self._wait_social_ui(
            lambda: session.social_ui(
                "set-value",
                {"selector": selector, "value": value},
            ),
            lambda item: item.get("updated") is True,
            label,
        )
        if result.get("updated") is not True:
            raise GateError(f"{label} was not updated")

    def _select_antd_option(
        self,
        session: _ActorScopedSession,
        selector: str,
        option_value: int,
        label: str,
    ) -> None:
        self._wait_social_ui(
            lambda: session.social_ui(
                "select-option",
                {"selector": selector, "optionValue": option_value},
            ),
            lambda value: value.get("selected") is True,
            label,
        )

    def _wait_ui_attribute(
        self,
        session: _ActorScopedSession,
        selector: str,
        attribute: str,
        expected: str,
        label: str,
    ) -> dict[str, Any]:
        return self._wait_social_ui(
            lambda: session.social_ui("query", {"selector": selector}),
            lambda value: (
                value.get("attributes", {}).get(attribute) == expected
            ),
            label,
        )

    def _wait_ui_attribute_value(
        self,
        session: _ActorScopedSession,
        selector: str,
        attribute: str,
        label: str,
    ) -> str:
        result = self._wait_social_ui(
            lambda: session.social_ui("query", {"selector": selector}),
            lambda value: bool(
                value.get("attributes", {}).get(attribute)
            ),
            label,
        )
        return str(result["attributes"][attribute])

    def _wait_ui_text(
        self,
        session: _ActorScopedSession,
        selector: str,
        expected: str,
        label: str,
    ) -> dict[str, Any]:
        return self._wait_social_ui(
            lambda: session.social_ui("query", {"selector": selector}),
            lambda value: expected in str(value.get("text") or ""),
            label,
        )

    def _wait_post_visible(
        self,
        session: _ActorScopedSession,
        post_id: str,
        text: str,
    ) -> dict[str, Any]:
        return self._wait_social_ui(
            lambda: session.social_ui(
                "post-query",
                {"postId": post_id},
            ),
            lambda value: (
                value.get("exists") is True
                and (not text or text in str(value.get("text") or ""))
            ),
            f"Moment {post_id}",
        )

    def _wait_for_moment(
        self,
        session: _ActorScopedSession,
        post_id: str,
        text: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            feed = self._mapping(
                session.call_action("moments.feed.read"),
                "Android receiver Moments feed",
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

        return self._wait_for_value(read, "Android receiver Moment")

    def _wait_new_private_post(
        self,
        session: _ActorScopedSession,
        before_ids: set[Any],
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            snapshot = session.call_action("moments.private.snapshot")
            if not isinstance(snapshot, Mapping):
                return None
            publish = snapshot.get("publish")
            if not isinstance(publish, list):
                return None
            return next(
                (
                    dict(item)
                    for item in publish
                    if isinstance(item, Mapping)
                    and item.get("state") == "PUBLISHED"
                    and item.get("postId")
                    and item.get("postId") not in before_ids
                ),
                None,
            )

        return self._wait_for_value(read, "Android published private Moment")

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
    def _wait_social_ui(
        read: Any,
        predicate: Any,
        label: str,
        timeout_seconds: float = 30.0,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        latest: dict[str, Any] = {}
        while time.monotonic() < deadline:
            latest = read()
            if predicate(latest):
                return latest
            time.sleep(0.25)
        raise GateError(f"{label} did not become ready: {latest!r}")

    @staticmethod
    def _mapping(value: Any, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must be an object")
        return dict(value)

    @staticmethod
    def _text(value: Any, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise GateError(f"{label} must be a non-empty string")
        return value.strip()

    @staticmethod
    def _required_object(
        owner: Mapping[str, Any],
        name: str,
        resource: str,
    ) -> dict[str, Any]:
        value = owner.get(name)
        if not isinstance(value, Mapping):
            raise AndroidSocialBlocked(
                f"{resource} requires object {name}",
                f"{ENVIRONMENT_ID}:{name}",
            )
        return dict(value)

    @staticmethod
    def _required_text(
        owner: Mapping[str, Any],
        name: str,
        resource: str,
    ) -> str:
        value = owner.get(name)
        if not isinstance(value, str) or not value.strip():
            raise AndroidSocialBlocked(
                f"{resource} requires {name}",
                f"{ENVIRONMENT_ID}:{name}",
            )
        return value.strip()

    def _cleanup_android_runtime(self) -> None:
        session = self._session
        if session is not None:
            try:
                try:
                    session.call_action(
                        "session.logout",
                        {"draftDisposition": "discard"},
                    )
                except Exception:
                    pass
                session.stop()
            except Exception as error:
                self.cleanup.append(
                    {
                        "resource": "physical-appium-session",
                        "status": "failed",
                        "errorType": type(error).__name__,
                    }
                )
            else:
                self.cleanup.append(
                    {
                        "resource": "physical-appium-session",
                        "status": "cleaned",
                    }
                )
            self._session = None
        if self.capability_client is not None:
            try:
                self.capability_client.close()
            except Exception as error:
                self.cleanup.append(
                    {
                        "resource": "ephemeral-capability-client",
                        "status": "failed",
                        "errorType": type(error).__name__,
                    }
                )
            else:
                self.cleanup.append(
                    {
                        "resource": "ephemeral-capability-client",
                        "status": "cleaned",
                    }
                )
            self.capability_client = None

    def _result_base(self, status: str) -> dict[str, Any]:
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": self.gate_id,
            "gate": self.gate_id,
            "environment": self.environment_id,
            "runtimeCell": "MPS-RC02",
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
            "phase": "MPS-11A Android Same-Station Social",
            "bom": ["MPS-11A", "MPS-RC02"],
            "spec": [
                "MPS-PA01",
                "MPS-PA02",
                "MPS-PA03",
                "MPS-PA04",
                "MPS-PA05",
                "MPS-PA06",
                "MPS-PA07",
                "MPS-PA08",
                "MPS-PA09",
                "MPS-PA14",
                "MPS-PA15",
                "MPS-PA18",
                "MPS-PA19",
            ],
            "observedScope": [
                "one USB-authorized physical Android device",
                "Alice, Bob and Eve on one exact-source Station",
                "real Mobile UI actions and receiver-visible Social assertions",
                "keyboard, system back, background, restart and native evidence",
            ],
            "unprovenScope": [
                "iOS current-run proof",
                "cross-Station or Relay delivery",
                "Desktop interoperability",
                "full SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN",
            ],
            "physicalDeviceClaimed": status == "PASS",
            "stationMocksUsed": False,
        }


def main() -> int:
    client = EphemeralGateClient.from_environment()
    gate: AcceptanceGate = AndroidSocialGate(capability_client=client)
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
