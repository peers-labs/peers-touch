#!/usr/bin/env python3
"""Prove bidirectional cross-Station private Moments on Desktop and iOS."""

from __future__ import annotations

import hashlib
import json
import re
import time
from collections.abc import Mapping
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
    call_async_harness,
)
from tooling.acceptance.gates.chat.mixed_native_runtime import (
    MixedNativeRuntime,
    compact_json,
)
from tooling.acceptance.gates.chat.native_support import (
    cleanup_preserving_primary_failure,
)
from tooling.acceptance.gates.mobile.simulator_runtime_binding import (
    MobileSimulatorRuntimeBinding,
)


GATE_ID = "social-cross-station-mobile-desktop-e2e"
REPORT_PATH = None
STEP_TIMEOUT = 120.0
PRIVATE_COMMENT_RETRY_MAX_ATTEMPTS = 3
PRIVATE_COMMENT_RETRY_MAX_DELAY_SECONDS = 5.0
PRIVATE_READ_TERMINAL_STATES = frozenset(
    {
        "DELETED_OR_REVOKED",
        "NOT_FOUND_OR_NOT_AUTHORIZED",
    }
)
PRIVATE_PUBLISH_RECONCILING_STATES = frozenset(
    {
        "PREPARING",
        "PUBLISHING",
        "UNKNOWN_COMMIT",
        "UNKNOWN_OUTCOME",
        "REMOTE_DELIVERY_PENDING",
        "REMOTE_DELIVERY_RETRYING",
    }
)
SCENARIO_IDS = (
    "desktop-publish-ios-receive",
    "ios-publish-desktop-receive",
    "comment-reaction-convergence",
    "unauthorized-denial",
    "revocation-and-restart",
)
RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "release-moments-functional",
        "scenarioIds": list(SCENARIO_IDS),
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 3,
        "minWarmReuseRate": 0.8,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": False,
    }
)


def revocation_restart_no_resurrection(
    restored: Mapping[str, Any],
    revoked: Mapping[str, Any],
    revoked_after_restart: Mapping[str, Any],
) -> bool:
    return (
        restored.get("state") == "CONTENT_READY"
        and revoked.get("state") in PRIVATE_READ_TERMINAL_STATES
        and revoked_after_restart.get("state")
        in PRIVATE_READ_TERMINAL_STATES
    )


class Gate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "R001-06 Cross-Station Desktop and iOS Moments"
    bom = ("SOC-SEC-RC09", "SOC-SEC-AS25")
    spec = (
        "docs/architecture/domains/social/core/acceptance-matrix.md",
        "docs/architecture/engineering/acceptance/execution-plans/"
        "20261017-release-0.0.1-mobile-ios-desktop/"
        "tasks/R001-06-MOMENTS.md",
    )
    report_path = REPORT_PATH
    evidence_dir = None

    def __init__(
        self,
        *,
        runtime: MixedNativeRuntime | None = None,
    ) -> None:
        super().__init__()
        self.runtime = runtime or MixedNativeRuntime.from_environment(
            self.gate_id
        )
        self.runtime_binding = self.runtime.desktop_binding
        self.mobile_binding = self._required_mobile_binding()
        self.report.manifest = self.runtime.manifest
        source = self.runtime.manifest.get("source")
        source_commit = (
            str(source.get("commit") or "")
            if isinstance(source, Mapping)
            else ""
        )
        fixture_epoch = str(
            self.runtime.actor_manifest.get("runId")
            or self.runtime.manifest.get("runId")
            or ""
        )
        self.ledger = SuiteRuntimeLedger(
            RUNTIME_REUSE,
            suite_runtime_id=fixture_epoch,
            source_digest=source_commit,
            fixture_epoch=fixture_epoch,
        )
        self.report.runtime.update(
            {
                "runtimeCell": "desktop-macos-native+ios-simulator",
                "journey": "SOC-SEC-AS25",
                "cleanup": {},
            }
        )

    def run(self) -> dict[str, Any]:
        desktop_id = "desktop-alice"
        mobile_id = "sim-ios"
        eve_id = "sim-ios-peer"
        cleanup: dict[str, Any] = {}
        suite_report: dict[str, Any] | None = None
        source_identity: dict[str, Any] = {}
        desktop_post_id = ""
        mobile_post_id = ""
        evidence: dict[str, Any] = {}
        completed = False

        self.ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id="social-cross-station-mobile-desktop",
        )
        try:
            for index, client_id in enumerate(
                (desktop_id, mobile_id, eve_id)
            ):
                self.runtime.start_client(
                    client_id,
                    window_slot=index,
                    window_count=3,
                )
                self.ledger.record(
                    SuiteRuntimeAction.CLIENT_LAUNCH,
                    resource_id=client_id,
                )
                self.report.add_actor(self.runtime.actor_runtime(client_id))

            desktop = self.runtime.identities[desktop_id]
            mobile = self.runtime.identities[mobile_id]
            eve = self.runtime.identities[eve_id]
            if desktop.station_service_id == mobile.station_service_id:
                raise GateError("Desktop and iOS clients share one Station")
            if mobile.station_service_id != eve.station_service_id:
                raise GateError("Bob and Eve must share the receiver Station")
            self._prepare_desktop_private_keys(desktop_id)
            self._wait_for_mobile_private_prekeys(mobile_id)
            self._wait_for_mobile_private_prekeys(eve_id)
            self._wait_for_mobile_social_projection(mobile_id)
            self._wait_for_mobile_social_projection(eve_id)
            self._wait_for_desktop_remote_actor(
                desktop_id,
                mobile_id,
            )
            source_identity = self.runtime.source_identity()

            desktop_text = f"as25-desktop-ios-{time.time_ns()}"
            self._scenario_start("desktop-publish-ios-receive")
            desktop_post_id = self._publish_desktop_private_text(
                desktop_id,
                desktop_text,
            )
            mobile_read = self._wait_for_mobile_private_read(
                mobile_id,
                desktop_post_id,
                expected_state="CONTENT_READY",
            )
            self._open_mobile_moments(mobile_id)
            self._wait_mobile_post_visible(
                mobile_id,
                desktop_post_id,
                desktop_text,
            )
            self._assert_private_identity(
                mobile_read,
                post_id=desktop_post_id,
                author_ptid=desktop.ptid,
                text=desktop_text,
            )
            evidence["desktopToIos"] = self._capture_mobile(
                mobile_id,
                "desktop-to-ios",
            )
            self.assert_condition("desktop_publish_ios_receive", True)
            self._scenario_end(
                "desktop-publish-ios-receive",
                ui_resource="mobile:open-moments-feed",
                receiver_resource="mobile:private-post-visible",
                supporting_resource="mobile:private-read-projection",
            )

            mobile_text = f"as25-ios-desktop-{time.time_ns()}"
            self._scenario_start("ios-publish-desktop-receive")
            mobile_post_id = self._publish_mobile_private_text_via_ui(
                mobile_id,
                mobile_text,
            )
            desktop_read = self._wait_for_desktop_private_read(
                desktop_id,
                mobile_post_id,
                expected_state="CONTENT_READY",
            )
            self._open_desktop_moments(desktop_id)
            self._wait_desktop_text_visible(desktop_id, mobile_text)
            evidence["desktopIdentity"] = self._wait_desktop_feed_identity(
                desktop_id,
                {
                    desktop_post_id: self._fixture_display_name(desktop_id),
                    mobile_post_id: self._fixture_display_name(mobile_id),
                },
            )
            self._assert_private_identity(
                desktop_read,
                post_id=mobile_post_id,
                author_ptid=mobile.ptid,
                text=mobile_text,
                hashed=True,
            )
            desktop_session = self.runtime.desktop_session(desktop_id)
            if desktop_session is None:
                raise GateError("Desktop receiver session is unavailable")
            evidence["iosToDesktop"] = {
                "screenshot": self.save_screenshot(
                    desktop_session,
                    "ios-to-desktop",
                ),
                "dom": self.save_dom(
                    desktop_session,
                    "ios-to-desktop",
                ),
            }
            self.assert_condition("ios_publish_desktop_receive", True)
            self._scenario_end(
                "ios-publish-desktop-receive",
                ui_resource="mobile:composer-publish",
                receiver_resource="desktop:private-post-visible",
                supporting_resource="desktop:private-read-projection",
            )

            self._scenario_start("comment-reaction-convergence")
            mobile_comment = f"as25-mobile-comment-{time.time_ns()}"
            self._submit_mobile_comment_via_ui(
                mobile_id,
                desktop_post_id,
                mobile_comment,
            )
            desktop_comments = self._wait_for_desktop_comment(
                desktop_id,
                desktop_post_id,
                mobile_comment,
            )
            desktop_comment = f"as25-desktop-comment-{time.time_ns()}"
            self._submit_desktop_comment(
                desktop_id,
                mobile_post_id,
                desktop_comment,
            )
            mobile_comments = self._wait_for_mobile_comment(
                mobile_id,
                mobile_post_id,
                desktop_comment,
            )
            self._react_mobile_via_ui(mobile_id, desktop_post_id)
            mobile_reaction = self._wait_for_mobile_reaction(
                mobile_id,
                desktop_post_id,
            )
            desktop_reaction = self._wait_for_desktop_reaction(
                desktop_id,
                desktop_post_id,
            )
            self.assert_condition(
                "comment_reaction_convergence",
                (
                    len(desktop_comments) >= 1
                    and len(mobile_comments) >= 1
                    and mobile_reaction.get("state")
                    == "REACTION_COMMITTED"
                    and desktop_reaction
                ),
            )
            self._scenario_end(
                "comment-reaction-convergence",
                ui_resource="mobile:comment-and-reaction",
                receiver_resource="desktop:interaction-visible",
                supporting_resource="source-authority:canonical-interactions",
            )

            self._scenario_start("unauthorized-denial")
            eve_read = self._wait_for_mobile_private_read(
                eve_id,
                desktop_post_id,
                expected_state="NOT_FOUND_OR_NOT_AUTHORIZED",
            )
            self._open_mobile_moments(eve_id)
            self._wait_mobile_post_absent(eve_id, desktop_post_id)
            self.assert_condition(
                "unauthorized_eve_denied",
                (
                    eve_read.get("contentKind") is None
                    and eve_read.get("textSha256") is None
                    and not eve_read.get("mediaStates")
                ),
                compact_json(eve_read),
            )
            self._scenario_end(
                "unauthorized-denial",
                ui_resource="mobile-eve:open-moments-feed",
                receiver_resource="mobile-eve:private-post-absent",
                supporting_resource="mobile-eve:uniform-denial",
            )

            self._scenario_start("revocation-and-restart")
            self.runtime.restart_client(
                mobile_id,
                timeout_seconds=STEP_TIMEOUT,
            )
            restored = self._wait_for_mobile_private_read(
                mobile_id,
                desktop_post_id,
                expected_state="CONTENT_READY",
            )
            self._desktop_moments_action(
                desktop_id,
                "deletePrivateMoment",
                {"postId": desktop_post_id},
            )
            revoked = self._wait_for_mobile_private_read(
                mobile_id,
                desktop_post_id,
                expected_state={
                    "DELETED_OR_REVOKED",
                    "NOT_FOUND_OR_NOT_AUTHORIZED",
                },
            )
            self.runtime.restart_client(
                mobile_id,
                timeout_seconds=STEP_TIMEOUT,
            )
            revoked_after_restart = self._wait_for_mobile_private_read(
                mobile_id,
                desktop_post_id,
                expected_state={
                    "DELETED_OR_REVOKED",
                    "NOT_FOUND_OR_NOT_AUTHORIZED",
                },
            )
            self._open_mobile_moments(mobile_id)
            self._wait_mobile_post_absent(mobile_id, desktop_post_id)
            evidence["revocation"] = self._capture_mobile(
                mobile_id,
                "revocation-after-restart",
            )
            self.assert_condition(
                "revocation_restart_no_resurrection",
                revocation_restart_no_resurrection(
                    restored,
                    revoked,
                    revoked_after_restart,
                ),
                compact_json(
                    {
                        "restoredState": restored.get("state"),
                        "revokedState": revoked.get("state"),
                        "revokedAfterRestartState": (
                            revoked_after_restart.get("state")
                        ),
                        "acceptedTerminalStates": sorted(
                            PRIVATE_READ_TERMINAL_STATES
                        ),
                    }
                ),
            )
            self._scenario_end(
                "revocation-and-restart",
                ui_resource="mobile:restart-open-feed",
                receiver_resource="mobile:revoked-post-absent",
                supporting_resource="mobile:revoked-private-read",
            )
            completed = True
        finally:
            cleanup = cleanup_preserving_primary_failure(
                lambda: self.runtime.cleanup(
                    save_desktop_log=self.save_app_log
                ),
                self.report,
                "Cross-Station Desktop and iOS Moments",
            )
            self.report.runtime["cleanup"] = cleanup
            if completed and not cleanup.get("cleanupErrors"):
                self.ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
                suite_report = self.ledger.require_valid()

        if cleanup.get("cleanupErrors"):
            raise GateError(
                "Cross-Station Desktop and iOS cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        if suite_report is None:
            raise GateError("Cross-Station Social Suite report is incomplete")
        return {
            "sourceIdentity": source_identity,
            "stationServiceIds": [
                self.runtime.identities[desktop_id].station_service_id,
                self.runtime.identities[mobile_id].station_service_id,
            ],
            "postIdentityDigests": {
                "desktop": self._sha256(desktop_post_id),
                "mobile": self._sha256(mobile_post_id),
            },
            "scenarioIds": list(SCENARIO_IDS),
            "suiteRuntime": suite_report,
            "evidence": evidence,
            "cleanup": cleanup,
            "provenScope": [
                "SOC-SEC-RC09 iOS subset",
                "SOC-SEC-AS25 Desktop and iOS",
            ],
            "unprovenScope": [
                "Android interoperability",
                "iOS to Android interoperability",
                "cross-Federation private delivery",
            ],
        }

    def _required_mobile_binding(self) -> MobileSimulatorRuntimeBinding:
        binding = self.runtime.mobile_binding
        if binding is None:
            raise GateError("Social mixed runtime has no Mobile binding")
        return binding

    def _scenario_start(self, scenario_id: str) -> None:
        self.ledger.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=scenario_id,
        )

    def _scenario_end(
        self,
        scenario_id: str,
        *,
        ui_resource: str,
        receiver_resource: str,
        supporting_resource: str,
    ) -> None:
        self.ledger.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario_id,
            resource_id=ui_resource,
        )
        self.ledger.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario_id,
            resource_id=receiver_resource,
        )
        self.ledger.record(
            SuiteRuntimeAction.SUPPORTING_OBSERVATION,
            scenario_id=scenario_id,
            resource_id=supporting_resource,
        )
        self.ledger.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario_id,
        )

    def _desktop_moments_action(
        self,
        client_id: str,
        action: str,
        payload: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        session = self.runtime.desktop_session(client_id)
        if session is None:
            raise GateError(f"Desktop client {client_id!r} is not active")
        value = call_async_harness(
            session,
            action,
            dict(payload or {}),
            namespace="moments",
            script_timeout=STEP_TIMEOUT,
        )
        if not isinstance(value, Mapping):
            raise GateError(
                f"Desktop Moments action {action!r} returned invalid data"
            )
        return dict(value)

    def _publish_desktop_private_text(
        self,
        client_id: str,
        text: str,
    ) -> str:
        draft_id = f"as25-desktop-{time.time_ns()}"
        staged = self._desktop_moments_action(
            client_id,
            "stageFriendsDraft",
            {
                "draftId": draft_id,
                "revision": 1,
                "text": text,
                "momentKind": "TEXT",
            },
        )
        if staged.get("present") is not True:
            raise GateError("Desktop private Moment draft was not retained")

        published = self.runtime.wait_until(
            lambda: self._settled_desktop_publish(client_id),
            "Desktop private Moment publication",
            timeout_seconds=STEP_TIMEOUT,
        )
        post_id = published.get("transientPostId")
        if (
            published.get("state") != "PUBLISHED"
            or not isinstance(post_id, str)
            or not post_id
        ):
            raise GateError(
                "Desktop private Moment did not reach PUBLISHED: "
                f"{compact_json(published)}"
            )
        return post_id

    def _prepare_desktop_private_keys(
        self,
        client_id: str,
    ) -> None:
        session = self.runtime.desktop_session(client_id)
        if session is None:
            raise GateError(f"Desktop client {client_id!r} is not active")
        value = call_async_harness(
            session,
            "prepareHistoricalRecoveryEpoch",
            {},
            namespace="secure-content-fixture",
            script_timeout=STEP_TIMEOUT,
        )
        if (
            not isinstance(value, Mapping)
            or not isinstance(value.get("recoveryEpoch"), int)
            or int(value["recoveryEpoch"]) < 1
            or not isinstance(
                value.get("recoveryPreKeyAvailable"),
                int,
            )
            or int(value["recoveryPreKeyAvailable"]) < 1
        ):
            raise GateError(
                "Desktop private Social recovery PreKeys are unavailable"
            )

    def _settled_desktop_publish(
        self,
        client_id: str,
    ) -> dict[str, Any] | None:
        published = self._desktop_moments_action(
            client_id,
            "publishPrivateDraft",
        )
        state = str(published.get("state") or "")
        if state in PRIVATE_PUBLISH_RECONCILING_STATES:
            return None
        return published

    def _publish_mobile_private_text_via_ui(
        self,
        client_id: str,
        text: str,
    ) -> str:
        before = self._mobile_action(
            client_id,
            "moments.private.snapshot",
        )
        before_ids = {
            str(item.get("postId"))
            for item in before.get("publish", ())
            if isinstance(item, Mapping) and item.get("postId")
        }
        self._open_mobile_moments(client_id)
        self._mobile_click(
            client_id,
            '[data-acceptance-id="social-composer-open"]',
            "Mobile Moment composer",
        )
        self._mobile_click(
            client_id,
            '[data-acceptance-id="social-audience-select"]',
            "Mobile audience selector",
        )
        self._mobile_click(
            client_id,
            '[data-audience-option="FRIENDS"]',
            "Mobile FRIENDS audience",
        )
        self._mobile_set_value(
            client_id,
            '[data-acceptance-id="social-composer-text"]',
            text,
            "Mobile Moment text",
        )
        self._mobile_click(
            client_id,
            '[data-acceptance-id="social-composer-publish"]',
            "Mobile Moment publish",
        )
        expected_text_sha256 = self._sha256(text)

        def published() -> str | None:
            snapshot = self._mobile_action(
                client_id,
                "moments.private.snapshot",
            )
            return next(
                (
                    str(item["postId"])
                    for item in snapshot.get("publish", ())
                    if (
                        isinstance(item, Mapping)
                        and item.get("state") == "PUBLISHED"
                        and item.get("postId")
                        and str(item["postId"]) not in before_ids
                        and item.get("textSha256") == expected_text_sha256
                    )
                ),
                None,
            )

        return str(
            self.runtime.wait_until(
                published,
                "Mobile private Moment publication",
                timeout_seconds=STEP_TIMEOUT,
            )
        )

    def _wait_for_mobile_private_read(
        self,
        client_id: str,
        post_id: str,
        *,
        expected_state: str | set[str],
    ) -> dict[str, Any]:
        expected = (
            {expected_state}
            if isinstance(expected_state, str)
            else set(expected_state)
        )

        def read() -> dict[str, Any] | None:
            snapshot = self._mobile_action(
                client_id,
                "moments.private.reconcile",
            )
            terminal_read = next(
                (
                    value
                    for value in snapshot.get("reads", ())
                    if (
                        isinstance(value, Mapping)
                        and value.get("postId") == post_id
                        and value.get("state") in expected
                        and value.get("state")
                        in PRIVATE_READ_TERMINAL_STATES
                    )
                ),
                None,
            )
            if terminal_read is not None:
                return dict(terminal_read)
            value = self._mobile_action(
                client_id,
                "moments.private.read",
                {"postId": post_id},
            )
            return value if value.get("state") in expected else None

        return dict(
            self.runtime.wait_until(
                read,
                f"{client_id} private Moment state {sorted(expected)}",
                timeout_seconds=STEP_TIMEOUT,
            )
        )

    def _wait_for_mobile_private_prekeys(
        self,
        client_id: str,
    ) -> dict[str, Any]:
        self._mobile_action(
            client_id,
            "moments.private.acceptance.prepareKeys",
        )

        def ready() -> dict[str, Any] | None:
            reconciled = self._mobile_action(
                client_id,
                "moments.private.reconcile",
            )
            report = reconciled.get("report")
            if not isinstance(report, Mapping):
                return None
            endpoint_available = report.get("endpointPrekeysAvailable")
            recovery_available = report.get("recoveryPrekeysAvailable")
            return (
                dict(report)
                if (
                    isinstance(endpoint_available, int)
                    and not isinstance(endpoint_available, bool)
                    and endpoint_available > 0
                    and isinstance(recovery_available, int)
                    and not isinstance(recovery_available, bool)
                    and recovery_available > 0
                )
                else None
            )

        return dict(
            self.runtime.wait_until(
                ready,
                f"{client_id} private Content PreKey inventory",
                timeout_seconds=STEP_TIMEOUT,
            )
        )

    def _wait_for_mobile_social_projection(
        self,
        client_id: str,
    ) -> dict[str, Any]:
        return dict(
            self.runtime.wait_until(
                lambda: (
                    value
                    if isinstance(
                        (
                            value := self._mobile_action(
                                client_id,
                                "social.reconcile",
                            )
                        ),
                        Mapping,
                    )
                    else None
                ),
                f"{client_id} Social projection",
                timeout_seconds=STEP_TIMEOUT,
            )
        )

    def _wait_for_desktop_remote_actor(
        self,
        desktop_id: str,
        remote_id: str,
    ) -> dict[str, Any]:
        remote = self.runtime.identities[remote_id]
        fixture = self.runtime.actor_fixture(remote_id)
        handle = fixture.get("federatedHandle")
        if not isinstance(handle, str) or not handle:
            raise GateError("Remote actor federated handle is unavailable")
        self._desktop_moments_action(
            desktop_id,
            "reconcileFederationProjection",
        )

        def resolved() -> dict[str, Any] | None:
            value = self._desktop_moments_action(
                desktop_id,
                "resolveFederatedActorIdentity",
                {
                    "federationId": remote.federation_id,
                    "federatedHandle": handle,
                },
            )
            return (
                value
                if (
                    value.get("actorPtid") == remote.ptid
                    and value.get("homeStationPeerId")
                    == remote.station_peer_id
                )
                else None
            )

        remote_actor = dict(
            self.runtime.wait_until(
                resolved,
                "Desktop remote Social actor resolution",
                timeout_seconds=STEP_TIMEOUT,
            )
        )
        friendship = self._desktop_moments_action(
            desktop_id,
            "friendshipProjection",
            {"actorPtid": remote.ptid},
        )
        if friendship.get("accepted") is not True:
            raise GateError(
                "Desktop remote friendship projection is not accepted"
            )
        return remote_actor

    def _wait_for_desktop_private_read(
        self,
        client_id: str,
        post_id: str,
        *,
        expected_state: str,
    ) -> dict[str, Any]:
        return dict(
            self.runtime.wait_until(
                lambda: (
                    value
                    if (
                        (
                            value := self._desktop_moments_action(
                                client_id,
                                "readPrivateMoment",
                                {"postId": post_id},
                            )
                        ).get("state")
                        == expected_state
                    )
                    else None
                ),
                f"{client_id} private Moment state {expected_state}",
                timeout_seconds=STEP_TIMEOUT,
            )
        )

    def _assert_private_identity(
        self,
        projection: Mapping[str, Any],
        *,
        post_id: str,
        author_ptid: str,
        text: str,
        hashed: bool = False,
    ) -> None:
        expected_post = self._sha256(post_id)
        expected_author = self._sha256(author_ptid)
        if hashed:
            valid = (
                projection.get("postIdSha256") == expected_post
                and projection.get("authorPtidSha256") == expected_author
            )
        else:
            valid = (
                projection.get("postId") == post_id
                and projection.get("authorPtid") == author_ptid
            )
        self.assert_condition(
            "canonical_private_moment_identity",
            (
                valid
                and projection.get("audienceKind") == "FRIENDS"
                and projection.get("textSha256") == self._sha256(text)
            ),
            compact_json(projection),
        )

    def _submit_mobile_comment_via_ui(
        self,
        client_id: str,
        post_id: str,
        text: str,
    ) -> None:
        post_token = self._selector_token(post_id, "Post")
        self._mobile_click(
            client_id,
            (
                f'[data-post-id="{post_token}"] '
                '[data-acceptance-id="social-thread-open"]'
            ),
            "Mobile private Moment thread",
        )
        thread = (
            '[data-acceptance-id="social-moment-thread"]'
            f'[data-post-id="{post_token}"]'
        )
        self._mobile_set_value(
            client_id,
            f'{thread} [data-acceptance-id="social-comment-input"]',
            text,
            "Mobile private Comment",
        )
        self._mobile_click(
            client_id,
            f'{thread} [data-acceptance-id="social-comment-send"]',
            "Mobile private Comment submit",
        )
        expected_text_sha256 = self._sha256(text)
        retry_attempts = 0
        retry_at: float | None = None

        def submitted() -> dict[str, Any] | None:
            nonlocal retry_attempts, retry_at
            snapshot = self._mobile_action(
                client_id,
                "moments.private.reconcile",
            )
            drafts = snapshot.get("commentDrafts")
            if not isinstance(drafts, list):
                return None
            draft = next(
                (
                    item
                    for item in drafts
                    if (
                        isinstance(item, Mapping)
                        and item.get("postId") == post_id
                        and item.get("textSha256") == expected_text_sha256
                    )
                ),
                None,
            )
            if not isinstance(draft, Mapping):
                return None
            if draft.get("state") == "COMMENT_POSTED":
                return {
                    "status": "posted",
                    "retryAttempts": retry_attempts,
                }
            if draft.get("errorCode") == "SOCIAL_PRIVATE_COMMENT_20008":
                now = time.monotonic()
                if retry_at is None:
                    retry_at = now + self._private_comment_retry_delay(
                        draft,
                        retry_attempts,
                    )
                    return None
                if now < retry_at:
                    return None
                if retry_attempts >= PRIVATE_COMMENT_RETRY_MAX_ATTEMPTS:
                    return {
                        "status": "failed",
                        "draft": dict(draft),
                        "retryAttempts": retry_attempts,
                    }
                self._mobile_click(
                    client_id,
                    f'{thread} [data-acceptance-id="social-comment-retry"]',
                    "Mobile private Comment retry",
                )
                retry_attempts += 1
                retry_at = now + self._private_comment_retry_delay(
                    draft,
                    retry_attempts,
                )
                return None
            if draft.get("errorCode") or draft.get("state") in {
                "COMMENT_FAILED",
                "COMMENT_RATE_LIMITED",
                "COMMENT_PARENT_UNAVAILABLE",
            }:
                return {"status": "failed", "draft": dict(draft)}
            return None

        outcome = dict(
            self.runtime.wait_until(
                submitted,
                "Mobile private Comment publication",
                timeout_seconds=STEP_TIMEOUT,
            )
        )
        if outcome.get("status") != "posted":
            raise GateError(
                "Mobile private Comment did not commit: "
                f"{compact_json(outcome)}"
            )

    @staticmethod
    def _private_comment_retry_delay(
        draft: Mapping[str, Any],
        retry_attempts: int,
    ) -> float:
        retry_after = draft.get("retryAfterSeconds")
        if (
            isinstance(retry_after, int)
            and not isinstance(retry_after, bool)
            and retry_after > 0
        ):
            return min(
                float(retry_after),
                PRIVATE_COMMENT_RETRY_MAX_DELAY_SECONDS,
            )
        return min(
            float(2**retry_attempts),
            PRIVATE_COMMENT_RETRY_MAX_DELAY_SECONDS,
        )

    def _submit_desktop_comment(
        self,
        client_id: str,
        post_id: str,
        text: str,
    ) -> None:
        result = self._desktop_moments_action(
            client_id,
            "submitPrivateCommentWithRetry",
            {
                "postId": post_id,
                "text": text,
            },
        )
        if (
            result.get("state") != "COMMENT_POSTED"
            or result.get("textSha256") != self._sha256(text)
        ):
            raise GateError("Desktop private Comment did not commit")

    def _wait_for_desktop_comment(
        self,
        client_id: str,
        post_id: str,
        text: str,
    ) -> list[dict[str, Any]]:
        expected = self._sha256(text)

        def read() -> list[dict[str, Any]] | None:
            result = self._desktop_moments_action(
                client_id,
                "readPrivateComments",
                {"postId": post_id, "refresh": True},
            )
            comments = result.get("comments")
            if not isinstance(comments, list):
                return None
            projected = [
                dict(item)
                for item in comments
                if isinstance(item, Mapping)
            ]
            return (
                projected
                if any(
                    item.get("state") == "COMMENT_POSTED"
                    and item.get("textSha256") == expected
                    for item in projected
                )
                else None
            )

        return list(
            self.runtime.wait_until(
                read,
                "Desktop private Comment convergence",
                timeout_seconds=STEP_TIMEOUT,
            )
        )

    def _wait_for_mobile_comment(
        self,
        client_id: str,
        post_id: str,
        text: str,
    ) -> list[dict[str, Any]]:
        expected_text_sha256 = self._sha256(text)

        def read() -> list[dict[str, Any]] | None:
            result = self._mobile_action(
                client_id,
                "moments.private.comments.read",
                {"postId": post_id, "limit": 20},
            )
            comments = result.get("comments")
            if not isinstance(comments, list):
                return None
            projected = [
                dict(item)
                for item in comments
                if isinstance(item, Mapping)
            ]
            return (
                projected
                if any(
                    item.get("state") == "COMMENT_POSTED"
                    and item.get("textSha256") == expected_text_sha256
                    for item in projected
                )
                else None
            )

        return list(
            self.runtime.wait_until(
                read,
                "Mobile private Comment convergence",
                timeout_seconds=STEP_TIMEOUT,
            )
        )

    def _react_mobile_via_ui(
        self,
        client_id: str,
        post_id: str,
    ) -> None:
        post_token = self._selector_token(post_id, "Post")
        self._open_mobile_moments(client_id)
        self._mobile_click(
            client_id,
            (
                f'[data-post-id="{post_token}"] '
                '[data-acceptance-id="social-reaction-open"]'
            ),
            "Mobile private Moment reaction",
        )
        self._mobile_click(
            client_id,
            (
                f'[data-post-id="{post_token}"] '
                '[data-reaction-picker-item="👍"]'
            ),
            "Mobile private Moment thumbs-up",
        )

    def _wait_for_mobile_reaction(
        self,
        client_id: str,
        post_id: str,
    ) -> dict[str, Any]:
        started_at = time.monotonic()

        def read() -> dict[str, Any] | None:
            snapshot = self._mobile_action(
                client_id,
                "moments.private.reconcile",
            )
            commands = snapshot.get("reactionCommands")
            if not isinstance(commands, list):
                return None
            command = next(
                (
                    dict(item)
                    for item in reversed(commands)
                    if (
                        isinstance(item, Mapping)
                        and item.get("postId") == post_id
                        and item.get("operation") == "REACT"
                    )
                ),
                None,
            )
            if command is None:
                if time.monotonic() - started_at < 5.0:
                    return None
                reads = snapshot.get("reads")
                post_read = next(
                    (
                        dict(item)
                        for item in reads
                        if (
                            isinstance(item, Mapping)
                            and item.get("postId") == post_id
                        )
                    ),
                    None,
                ) if isinstance(reads, list) else None
                return {
                    "status": "missing",
                    "postRead": post_read,
                    "runtimeErrorPresent": snapshot.get("errorPresent"),
                    "evidence": self._capture_mobile(
                        client_id,
                        "reaction-command-missing",
                    ),
                }
            state = command.get("state")
            if state == "REACTION_COMMITTED":
                return {"status": "committed", "command": command}
            if state == "REACTION_REJECTED":
                return {"status": "failed", "command": command}
            if state not in {
                "REACTION_PENDING",
                "REACTION_RETRYING",
                "REACTION_UNKNOWN_OUTCOME",
            }:
                return {"status": "invalid", "command": command}
            return None

        outcome = dict(
            self.runtime.wait_until(
                read,
                "Mobile private Reaction convergence",
                timeout_seconds=STEP_TIMEOUT,
            )
        )
        if outcome.get("status") != "committed":
            raise GateError(
                "Mobile private Reaction did not commit: "
                f"{compact_json(outcome)}"
            )
        return dict(outcome["command"])

    def _wait_for_desktop_reaction(
        self,
        client_id: str,
        post_id: str,
    ) -> bool:
        def read() -> bool | None:
            projection = self._desktop_moments_action(
                client_id,
                "readPrivateMoment",
                {"postId": post_id},
            )
            reactions = projection.get("reactions")
            return (
                True
                if (
                    projection.get("reactionsHydrated") is True
                    and isinstance(reactions, list)
                    and any(
                        isinstance(item, Mapping)
                        and int(item.get("count") or 0) >= 1
                        for item in reactions
                    )
                )
                else None
            )

        return bool(
            self.runtime.wait_until(
                read,
                "Desktop private Reaction convergence",
                timeout_seconds=STEP_TIMEOUT,
            )
        )

    def _mobile_action(
        self,
        client_id: str,
        action: str,
        payload: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        value = self.runtime.call_action(
            client_id,
            action,
            payload,
            timeout=STEP_TIMEOUT,
        )
        if not isinstance(value, Mapping):
            raise GateError(
                f"Mobile action {action!r} returned invalid data"
            )
        return dict(value)

    def _open_mobile_moments(self, client_id: str) -> None:
        self._mobile_click(
            client_id,
            '.mobile-tabbar button[data-route-id="tab:moments"]',
            "Mobile Moments tab",
        )
        settled_since: float | None = None

        def visible_page() -> bool | None:
            nonlocal settled_since
            if not (
                self._mobile_observe(
                    client_id,
                    '.mobile-tabbar button[data-route-id="tab:moments"].active',
                )
                and self._mobile_observe(
                    client_id,
                    '[data-acceptance-id="social-moments-page"]',
                )
            ):
                settled_since = None
                return None
            now = time.monotonic()
            if settled_since is None:
                settled_since = now
            return True if now - settled_since >= 0.5 else None

        self.runtime.wait_until(
            visible_page,
            "Mobile Moments page",
            timeout_seconds=STEP_TIMEOUT,
        )

    def _mobile_click(
        self,
        client_id: str,
        selector: str,
        description: str,
    ) -> None:
        self.runtime.wait_until(
            lambda: (
                observation
                if (
                    (
                        observation := self.mobile_binding.semantic_click(
                            client_id,
                            selector,
                        )
                    ).get("activated")
                    is True
                )
                else None
            ),
            description,
            timeout_seconds=STEP_TIMEOUT,
        )

    def _mobile_set_value(
        self,
        client_id: str,
        selector: str,
        value: str,
        description: str,
    ) -> None:
        self.runtime.wait_until(
            lambda: (
                observation
                if (
                    (
                        observation := (
                            self.mobile_binding.semantic_set_value(
                                client_id,
                                selector,
                                value,
                            )
                        )
                    ).get("updated")
                    is True
                )
                else None
            ),
            description,
            timeout_seconds=STEP_TIMEOUT,
        )

    def _mobile_observe(
        self,
        client_id: str,
        selector: str,
        *,
        expected_text: str = "",
    ) -> dict[str, object] | None:
        observation = self.mobile_binding.semantic_observe(
            client_id,
            selector,
            expected_text=expected_text,
        )
        return (
            observation
            if (
                observation.get("found") is True
                and observation.get("visible") is True
                and observation.get("matched") is True
            )
            else None
        )

    def _wait_mobile_post_visible(
        self,
        client_id: str,
        post_id: str,
        text: str,
    ) -> None:
        token = self._selector_token(post_id, "Post")
        self.runtime.wait_until(
            lambda: self._mobile_observe(
                client_id,
                f'[data-post-id="{token}"]',
                expected_text=text,
            ),
            "Mobile receiver-visible private Moment",
            timeout_seconds=STEP_TIMEOUT,
        )

    def _wait_mobile_post_absent(
        self,
        client_id: str,
        post_id: str,
    ) -> None:
        token = self._selector_token(post_id, "Post")
        settled_since: float | None = None

        def absent() -> bool | None:
            nonlocal settled_since
            if not self._mobile_observe(
                client_id,
                '.mobile-tabbar button[data-route-id="tab:moments"].active',
            ):
                settled_since = None
                return None
            observation = self.mobile_binding.semantic_observe(
                client_id,
                f'[data-post-id="{token}"]',
            )
            if observation.get("found") is not False:
                settled_since = None
                return None
            now = time.monotonic()
            if settled_since is None:
                settled_since = now
            return True if now - settled_since >= 1.0 else None

        self.runtime.wait_until(
            absent,
            "Mobile private Moment absence",
            timeout_seconds=STEP_TIMEOUT,
        )

    def _open_desktop_moments(self, client_id: str) -> None:
        session = self.runtime.desktop_session(client_id)
        if session is None:
            raise GateError("Desktop Moments session is unavailable")

        def open_page() -> bool | None:
            value = session.execute_script(
                """
const target = document.querySelector(
  '[data-pt-primary-nav="moments"] button, '
  + '[data-pt-primary-nav="moments"] [role="button"]'
);
if (!target) return false;
target.click();
return true;
"""
            )
            return True if value is True else None

        self.runtime.wait_until(
            open_page,
            "Desktop Moments navigation",
            timeout_seconds=STEP_TIMEOUT,
        )

    def _wait_desktop_text_visible(
        self,
        client_id: str,
        text: str,
    ) -> None:
        session = self.runtime.desktop_session(client_id)
        if session is None:
            raise GateError("Desktop Moments session is unavailable")

        def visible() -> bool | None:
            value = session.execute_script(
                """
const expected = arguments[0];
const nodes = Array.from(document.querySelectorAll(
  'p, span, div, a, button'
));
return nodes.some((node) => {
  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && rect.width > 0
    && rect.height > 0
    && (node.textContent || '').includes(expected);
});
""",
                text,
            )
            return True if value is True else None

        self.runtime.wait_until(
            visible,
            "Desktop receiver-visible private Moment",
            timeout_seconds=STEP_TIMEOUT,
        )

    def _fixture_display_name(self, client_id: str) -> str:
        display_name = self.runtime.actor_fixture(client_id).get(
            "displayName"
        )
        if not isinstance(display_name, str) or not display_name.strip():
            raise GateError(
                f"Actor fixture for {client_id!r} has no canonical display name"
            )
        return display_name

    def _wait_desktop_feed_identity(
        self,
        client_id: str,
        expected_by_post_id: Mapping[str, str],
    ) -> list[dict[str, str]]:
        session = self.runtime.desktop_session(client_id)
        if session is None:
            raise GateError("Desktop Moments session is unavailable")
        expected = [
            {"postId": post_id, "displayName": display_name}
            for post_id, display_name in expected_by_post_id.items()
        ]
        last_observation: list[dict[str, str]] = []

        def resolved() -> list[dict[str, str]] | None:
            nonlocal last_observation
            value = session.execute_script(
                """
const expected = arguments[0];
const cards = Array.from(document.querySelectorAll(
  '[data-acceptance-id="social-moment-card"]'
));
return expected.map(({ postId, displayName }) => {
  const card = cards.find((candidate) => candidate.dataset.postId === postId);
  const author = card?.querySelector(
    '[data-acceptance-id="social-moment-author"]'
  );
  const trust = card?.querySelector(
    '[data-acceptance-id="social-trust-meta"]'
  );
  return {
    postId,
    expectedDisplayName: displayName,
    authorText: (author?.textContent || '').trim(),
    sourceText: (trust?.textContent || '').replace(/\\s+/g, ' ').trim(),
  };
});
""",
                expected,
            )
            if not isinstance(value, list):
                return None
            last_observation = [
                {
                    "postId": str(row.get("postId") or ""),
                    "expectedDisplayName": str(
                        row.get("expectedDisplayName") or ""
                    ),
                    "authorText": str(row.get("authorText") or ""),
                    "sourceText": str(row.get("sourceText") or ""),
                }
                for row in value
                if isinstance(row, Mapping)
            ]
            if len(last_observation) != len(expected):
                return None
            for row in last_observation:
                identity_text = (
                    f"{row['authorText']} {row['sourceText']}"
                ).strip()
                if (
                    row["authorText"] != row["expectedDisplayName"]
                    or not row["sourceText"]
                    or "unknown" in identity_text.casefold()
                    or "unresolved" in identity_text.casefold()
                    or "未知用户" in identity_text
                    or "来源未解析" in identity_text
                    or "ptid:" in identity_text.casefold()
                    or re.search(r"@\S+@\S+", identity_text)
                    or re.search(
                        r"(?<!\d)(?:\d{1,3}\.){3}\d{1,3}"
                        r"(?::\d+)?(?!\d)",
                        identity_text,
                    )
                ):
                    return None
            return last_observation

        try:
            observation = self.runtime.wait_until(
                resolved,
                "Desktop human-readable Moment identities",
                timeout_seconds=STEP_TIMEOUT,
            )
        except GateError as error:
            raise GateError(
                "Desktop Moment identity did not converge: "
                f"{compact_json(last_observation)}"
            ) from error
        self.assert_condition(
            "desktop_feed_human_readable_identity",
            True,
            compact_json(observation),
        )
        return list(observation)

    def _capture_mobile(
        self,
        client_id: str,
        capture_id: str,
    ) -> dict[str, Any]:
        return {
            "screenshot": self.mobile_binding.capture_screenshot(
                client_id,
                capture_id,
            ).to_dict(),
            "dom": self.mobile_binding.capture_web_dom(
                client_id,
                capture_id,
            ).to_dict(),
        }

    @staticmethod
    def _selector_token(value: str, label: str) -> str:
        if re.fullmatch(r"[A-Za-z0-9:_-]+", value) is None:
            raise GateError(f"{label} identity cannot be used in a selector")
        return value

    @staticmethod
    def _sha256(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
