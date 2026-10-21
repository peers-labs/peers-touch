#!/usr/bin/env python3
"""Exact-source two-Station Federation lifecycle proof."""

from __future__ import annotations

import json
import tempfile
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
    call_async_harness,
    validate_suite_runtime_report,
)
from tooling.acceptance.gates.chat.mixed_native_runtime import (
    MixedNativeRuntime,
)
from tooling.acceptance.gates.chat.native_support import (
    cleanup_preserving_primary_failure,
)


GATE_ID = "federation-two-station-lifecycle-e2e"
ENVIRONMENT_ID = "cross-station-social-native"
STEP_TIMEOUT = 120.0
SCENARIO_IDS = (
    "create-join-context",
    "leave-context-removal",
    "rejoin-restart-context",
    "archive-context-removal",
)
RUNTIME_REUSE_CONTRACT = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "release-federation-lifecycle-functional",
        "scenarioIds": list(SCENARIO_IDS),
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 3,
        "minWarmReuseRate": 0.75,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": True,
    }
)
REQUIRED_ASSERTIONS = frozenset(
    {
        "owner_created_active_federation",
        "remote_station_joined",
        "two_station_projection_converged",
        "native_clients_render_shared_context",
        "invalid_join_rejected",
        "invalid_endpoint_rejected",
        "duplicate_join_is_idempotent",
        "non_owner_archive_rejected",
        "sequencer_leave_rejected",
        "non_owner_leave_converged",
        "left_context_removed_from_native_ui",
        "rejoin_converged",
        "restart_replayed_active_context",
        "owner_archive_converged",
        "archived_context_removed_from_native_ui",
        "source_bound_native_cells",
        "runtime_cleanup",
    }
)


class FederationTwoStationLifecycleGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "FED-LIFECYCLE"
    bom = ("FED-LIFECYCLE-01",)
    spec = (
        "docs/architecture/domains/federation/design.md",
        "docs/architecture/domains/federation/wire-protocol.md",
        "tooling/acceptance/features/federation-full-lifecycle.yaml",
    )

    def __init__(
        self,
        *,
        runtime: MixedNativeRuntime | None = None,
    ) -> None:
        super().__init__()
        self.runtime = runtime or MixedNativeRuntime.from_environment(
            self.gate_id
        )
        if self.runtime.manifest.get("environmentId") != ENVIRONMENT_ID:
            raise GateError(
                "Federation lifecycle proof requires the two-Station "
                "cross-station-social-native environment"
            )
        self.runtime_binding = self.runtime.desktop_binding
        self.report.manifest = self.runtime.manifest
        self.report.runtime.update(
            {
                "environment": ENVIRONMENT_ID,
                "runtimeCell": "desktop-macos-native",
                "journey": "federation-two-station-lifecycle",
                "cleanup": {},
            }
        )

    def run(self) -> dict[str, Any]:
        cleanup: dict[str, Any] = {}
        alice_id = "alice"
        bob_id = "federation-secondary-owner"
        source = self._mapping(
            self.runtime.manifest.get("source"),
            "Suite source identity",
        )
        source_commit = self._required_text(
            source.get("commit"),
            "Suite source commit",
        )
        suite_runtime_id = self._required_text(
            self.runtime.manifest.get("runId"),
            "Suite Runtime ID",
        )
        fixture_epoch = self._required_text(
            self.runtime.actor_manifest.get("runId"),
            "Suite Fixture Epoch",
        )
        ledger = SuiteRuntimeLedger(
            RUNTIME_REUSE_CONTRACT,
            suite_runtime_id=suite_runtime_id,
            source_digest=source_commit,
            fixture_epoch=fixture_epoch,
        )
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id=f"environment:{suite_runtime_id}",
        )
        scenario_results: dict[str, str] = {}
        try:
            alice_started = time.monotonic()
            alice = self.runtime.start_client(
                alice_id,
                window_slot=0,
                window_count=2,
            )
            ledger.record(
                SuiteRuntimeAction.CLIENT_LAUNCH,
                resource_id=f"client:{alice_id}",
                duration_seconds=time.monotonic() - alice_started,
            )
            ledger.record(
                SuiteRuntimeAction.LOGIN,
                resource_id=f"session:{alice_id}",
            )
            bob_started = time.monotonic()
            bob = self.runtime.start_client(
                bob_id,
                window_slot=1,
                window_count=2,
            )
            ledger.record(
                SuiteRuntimeAction.CLIENT_LAUNCH,
                resource_id=f"client:{bob_id}",
                duration_seconds=time.monotonic() - bob_started,
            )
            ledger.record(
                SuiteRuntimeAction.LOGIN,
                resource_id=f"session:{bob_id}",
            )
            self.report.add_actor(self.runtime.actor_runtime(alice_id))
            self.report.add_actor(self.runtime.actor_runtime(bob_id))
            if alice.station_peer_id == bob.station_peer_id:
                raise GateError(
                    "Federation lifecycle requires two distinct Stations"
                )

            run_id = str(self.runtime.manifest.get("runId") or "")
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="create-join-context",
            )
            created = self._action(
                alice_id,
                "createAcceptanceFederation",
                {
                    "name": f"Release 0.0.1 {run_id[-8:]}",
                    "description": (
                        "Acceptance-owned two-Station Federation lifecycle"
                    ),
                },
            )
            federation_id = self._required_text(
                created.get("federationId"),
                "created Federation ID",
            )
            owner_snapshot = self._snapshot(alice_id)
            owner_federation = self._federation(
                owner_snapshot,
                federation_id,
            )
            owner_capability = self._mapping(
                owner_federation.get("capability"),
                "owner Federation capability",
            )
            self.assert_condition(
                "owner_created_active_federation",
                owner_federation.get("status") == "active"
                and owner_federation.get("myRole") == "federation_owner"
                and owner_capability.get("canArchive") is True
                and owner_capability.get("canLeave") is True,
                json.dumps(owner_federation, sort_keys=True),
            )
            endpoint = self._sequencer_endpoint(owner_federation)

            invalid_join_error = self._action_rejection(
                bob_id,
                "joinAcceptanceFederation",
                {
                    "federationEndpoint": endpoint,
                    "federationId": f"{federation_id}-missing",
                },
                expected_codes=("NOT_FOUND",),
                expected_messages=(),
            )
            self.assert_condition(
                "invalid_join_rejected",
                bool(invalid_join_error),
                invalid_join_error,
            )
            invalid_endpoint_error = self._action_rejection(
                bob_id,
                "joinAcceptanceFederation",
                {
                    "federationEndpoint": "http://127.0.0.1:1",
                    "federationId": federation_id,
                },
                expected_codes=("UNAVAILABLE",),
                expected_messages=(),
            )
            self.assert_condition(
                "invalid_endpoint_rejected",
                bool(invalid_endpoint_error),
                invalid_endpoint_error,
            )

            joined = self._action(
                bob_id,
                "joinAcceptanceFederation",
                {
                    "federationEndpoint": endpoint,
                    "federationId": federation_id,
                },
            )
            self.assert_condition(
                "remote_station_joined",
                joined.get("status") == "active"
                and bool(joined.get("proposalId")),
                json.dumps(joined, sort_keys=True),
            )
            converged = self._wait_for_active_pair(
                federation_id,
                alice_id,
                bob_id,
                alice.station_peer_id,
                bob.station_peer_id,
            )
            self.assert_condition(
                "two_station_projection_converged",
                converged["owner"]["headSeq"]
                == converged["member"]["headSeq"],
                json.dumps(converged, sort_keys=True),
            )
            self._assert_visible_context(alice_id, federation_id)
            self._assert_visible_context(bob_id, federation_id)
            self.assert_condition(
                "native_clients_render_shared_context",
                True,
            )

            owner_head_before_duplicate = self._head_tuple(
                converged["owner"]
            )
            member_head_before_duplicate = self._head_tuple(
                converged["member"]
            )
            duplicate = self._action(
                bob_id,
                "joinAcceptanceFederation",
                {
                    "federationEndpoint": endpoint,
                    "federationId": federation_id,
                },
            )
            duplicate_pair = self._wait_for_active_pair(
                federation_id,
                alice_id,
                bob_id,
                alice.station_peer_id,
                bob.station_peer_id,
            )
            self.assert_condition(
                "duplicate_join_is_idempotent",
                duplicate.get("status") == "active"
                and self._head_tuple(duplicate_pair["owner"])
                == owner_head_before_duplicate
                and self._head_tuple(duplicate_pair["member"])
                == member_head_before_duplicate,
                json.dumps(
                    {
                        "join": duplicate,
                        "projection": duplicate_pair,
                    },
                    sort_keys=True,
                ),
            )

            archive_error = self._action_rejection(
                bob_id,
                "deleteAcceptanceFederation",
                {"federationId": federation_id},
                expected_codes=("FORBIDDEN",),
                expected_messages=(),
            )
            self.assert_condition(
                "non_owner_archive_rejected",
                bool(archive_error),
                archive_error,
            )
            sequencer_leave_error = self._action_rejection(
                alice_id,
                "leaveAcceptanceFederation",
                {
                    "federationId": federation_id,
                    "reason": "sequencer guard proof",
                },
                expected_codes=("CONFLICT",),
                expected_messages=(),
            )
            self.assert_condition(
                "sequencer_leave_rejected",
                bool(sequencer_leave_error),
                sequencer_leave_error,
            )
            self._complete_scenario(
                ledger,
                "create-join-context",
                ui_resource=(
                    f"native-federation-context:{federation_id}:active"
                ),
                receiver_resource=(
                    f"station-convergence:{federation_id}:"
                    f"{converged['owner']['headSeq']}"
                ),
            )
            scenario_results["create-join-context"] = "PASS"

            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="leave-context-removal",
            )
            left = self._action(
                bob_id,
                "leaveAcceptanceFederation",
                {
                    "federationId": federation_id,
                    "reason": "release lifecycle proof",
                },
            )
            owner_after_leave = self._wait_for_member_status(
                alice_id,
                federation_id,
                bob.station_peer_id,
                "left",
            )
            member_after_leave = self._wait_for_missing_context(
                bob_id,
                federation_id,
            )
            self.assert_condition(
                "non_owner_leave_converged",
                left.get("success") is True
                and owner_after_leave.get("status") == "active"
                and member_after_leave is True,
                json.dumps(owner_after_leave, sort_keys=True),
            )
            self._assert_missing_visible_context(
                bob_id,
                federation_id,
                evidence_label="left",
            )
            self.assert_condition(
                "left_context_removed_from_native_ui",
                True,
            )
            self._complete_scenario(
                ledger,
                "leave-context-removal",
                ui_resource=(
                    f"native-federation-context:{federation_id}:left"
                ),
                receiver_resource=(
                    f"station-membership:{bob.station_peer_id}:left"
                ),
            )
            scenario_results["leave-context-removal"] = "PASS"

            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="rejoin-restart-context",
            )
            rejoined = self._action(
                bob_id,
                "joinAcceptanceFederation",
                {
                    "federationEndpoint": endpoint,
                    "federationId": federation_id,
                },
            )
            rejoined_pair = self._wait_for_active_pair(
                federation_id,
                alice_id,
                bob_id,
                alice.station_peer_id,
                bob.station_peer_id,
            )
            self.assert_condition(
                "rejoin_converged",
                rejoined.get("status") == "active"
                and rejoined_pair["owner"]["headSeq"]
                == rejoined_pair["member"]["headSeq"]
                and self._head_tuple(rejoined_pair["owner"])[0]
                == owner_head_before_duplicate[0] + 2
                and self._head_hash(rejoined_pair["owner"])
                != owner_head_before_duplicate[1],
                json.dumps(rejoined_pair, sort_keys=True),
            )

            restart = self.runtime.restart_desktop_session(
                bob_id,
                window_slot=1,
                window_count=2,
                timeout_seconds=STEP_TIMEOUT,
            )
            ledger.record(
                SuiteRuntimeAction.CLIENT_REPLACEMENT,
                resource_id=f"client:{bob_id}:restart",
            )
            self._assert_visible_context(
                bob_id,
                federation_id,
                reconcile=False,
                evidence_label="restored",
            )
            self.assert_condition(
                "restart_replayed_active_context",
                restart.get("authenticated") is True
                and restart.get("stationPeerId") == bob.station_peer_id,
                json.dumps(restart, sort_keys=True),
            )
            self._complete_scenario(
                ledger,
                "rejoin-restart-context",
                ui_resource=(
                    f"native-federation-context:{federation_id}:restored"
                ),
                receiver_resource=(
                    f"station-convergence:{federation_id}:"
                    f"{rejoined_pair['owner']['headSeq']}"
                ),
            )
            scenario_results["rejoin-restart-context"] = "PASS"

            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="archive-context-removal",
            )
            archived = self._action(
                alice_id,
                "deleteAcceptanceFederation",
                {"federationId": federation_id},
            )
            owner_archived = self._wait_for_federation(
                alice_id,
                federation_id,
                status="archived",
            )
            member_archived = self._wait_for_federation(
                bob_id,
                federation_id,
                status="archived",
            )
            self.assert_condition(
                "owner_archive_converged",
                archived.get("success") is True
                and owner_archived.get("status") == "archived"
                and member_archived.get("status") == "archived"
                and owner_archived.get("headSeq")
                == member_archived.get("headSeq")
                and self._head_hash(owner_archived)
                == self._head_hash(member_archived)
                and self._head_tuple(owner_archived)[0]
                == self._head_tuple(rejoined_pair["owner"])[0] + 1
                and self._head_hash(owner_archived)
                != self._head_hash(rejoined_pair["owner"]),
                json.dumps(
                    {
                        "owner": owner_archived,
                        "member": member_archived,
                    },
                    sort_keys=True,
                ),
            )
            self._assert_missing_visible_context(
                alice_id,
                federation_id,
                evidence_label="owner-archived",
            )
            self._assert_missing_visible_context(
                bob_id,
                federation_id,
                evidence_label="member-archived",
            )
            self.assert_condition(
                "archived_context_removed_from_native_ui",
                True,
            )
            self._complete_scenario(
                ledger,
                "archive-context-removal",
                ui_resource=(
                    f"native-federation-context:{federation_id}:archived"
                ),
                receiver_resource=(
                    f"station-convergence:{federation_id}:archived"
                ),
            )
            scenario_results["archive-context-removal"] = "PASS"

            source_identity = self.runtime.source_identity()
            self.assert_condition(
                "source_bound_native_cells",
                source_identity.get("desktopRuntimeCell", {}).get("cellId")
                == "desktop-macos-native"
                and source_identity.get("orchestrator", {}).get(
                    "workspaceDigest"
                )
                == "clean",
                json.dumps(source_identity, sort_keys=True),
            )
        finally:
            cleanup = cleanup_preserving_primary_failure(
                lambda: self.runtime.cleanup(
                    save_desktop_log=self.save_app_log
                ),
                self.report,
                "Federation two-Station lifecycle",
            )
            self.report.runtime["cleanup"] = cleanup

        desktop_cleanup = self._mapping(
            cleanup.get("desktop"),
            "Desktop cleanup",
        )
        self.assert_condition(
            "runtime_cleanup",
            desktop_cleanup.get("portsReleased") is True
            and desktop_cleanup.get("processesReleased") is True
            and desktop_cleanup.get("storageReleased") is True
            and not cleanup.get("cleanupErrors"),
            json.dumps(cleanup, sort_keys=True),
        )
        if cleanup.get("cleanupErrors"):
            raise GateError(
                "Federation lifecycle cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
        suite_report = ledger.require_valid()
        validate_suite_runtime_report(
            suite_report,
            expected_contract=RUNTIME_REUSE_CONTRACT,
        )
        suite_artifact = self._attach_suite_report(suite_report)
        assertions = {item.name for item in self.report.assertions}
        missing = REQUIRED_ASSERTIONS - assertions
        if missing:
            raise GateError(
                f"Federation lifecycle assertions are missing: {sorted(missing)}"
            )
        return {
            "environment": ENVIRONMENT_ID,
            "runtimeCell": "desktop-macos-native",
            "federationId": federation_id,
            "ownerStationPeerId": alice.station_peer_id,
            "memberStationPeerId": bob.station_peer_id,
            "sourceIdentity": source_identity,
            "scenarioResults": scenario_results,
            "suiteRuntimeReport": suite_report,
            "suiteRuntimeArtifact": suite_artifact,
            "suiteRuntimeReportDigest": suite_report["reportDigest"],
            "cleanup": cleanup,
            "provenScope": [
                "create and cross-Station join",
                "bilateral member and ledger convergence",
                "ordinary Native client context visibility",
                "non-owner leave and rejoin",
                "native restart replay",
                "owner-only archive and context removal",
            ],
            "unprovenScope": [
                "quorum policy",
                "Mobile two-Station visual lifecycle journey",
                "physical-device and non-macOS Desktop behavior",
            ],
        }

    @staticmethod
    def _complete_scenario(
        ledger: SuiteRuntimeLedger,
        scenario_id: str,
        *,
        ui_resource: str,
        receiver_resource: str,
    ) -> None:
        ledger.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario_id,
            resource_id=ui_resource,
        )
        ledger.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario_id,
            resource_id=receiver_resource,
        )
        ledger.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario_id,
        )

    def _attach_suite_report(
        self,
        report: dict[str, Any],
    ) -> Any:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".json",
            delete=False,
        ) as output:
            json.dump(
                report,
                output,
                ensure_ascii=True,
                indent=2,
                sort_keys=True,
            )
            output.write("\n")
            path = Path(output.name)
        try:
            return self.report.add_evidence_file(
                "suite-runtime",
                path,
                destination_dir=self.evidence_dir,
            )
        finally:
            path.unlink(missing_ok=True)

    def _action(
        self,
        client_id: str,
        action: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        session = self.runtime.desktop_session(client_id)
        if session is None:
            raise GateError(f"Desktop client {client_id!r} is not active")
        return self._mapping(
            call_async_harness(
                session,
                action,
                dict(payload),
                namespace="moments",
                script_timeout=STEP_TIMEOUT,
            ),
            f"{client_id} {action}",
        )

    def _action_rejection(
        self,
        client_id: str,
        action: str,
        payload: Mapping[str, Any],
        *,
        expected_codes: tuple[str, ...],
        expected_messages: tuple[str, ...],
    ) -> str:
        try:
            self._action(client_id, action, payload)
        except GateError as error:
            message = str(error)
            normalized = message.lower()
            if (
                not any(
                    f"{code}:".lower() in normalized
                    for code in expected_codes
                )
                or (
                    expected_messages
                    and not any(
                        value in normalized
                        for value in expected_messages
                    )
                )
            ):
                raise
            return message
        raise GateError(
            f"{client_id} {action} unexpectedly succeeded"
        )

    def _snapshot(self, client_id: str) -> dict[str, Any]:
        return self._action(client_id, "federationFixtureSnapshot", {})

    def _wait_for_federation(
        self,
        client_id: str,
        federation_id: str,
        *,
        status: str,
    ) -> dict[str, Any]:
        return self.runtime.wait_until(
            lambda: (
                federation
                if (
                    federation := self._optional_federation(
                        self._snapshot(client_id),
                        federation_id,
                    )
                )
                and federation.get("status") == status
                else None
            ),
            f"{client_id} Federation {federation_id} status {status}",
            timeout_seconds=STEP_TIMEOUT,
        )

    def _wait_for_active_pair(
        self,
        federation_id: str,
        owner_id: str,
        member_id: str,
        owner_station_peer_id: str,
        member_station_peer_id: str,
    ) -> dict[str, dict[str, Any]]:
        expected = {owner_station_peer_id, member_station_peer_id}

        def converged() -> dict[str, dict[str, Any]] | None:
            owner = self._optional_federation(
                self._snapshot(owner_id),
                federation_id,
            )
            member = self._optional_federation(
                self._snapshot(member_id),
                federation_id,
            )
            if (
                owner is None
                or member is None
                or owner.get("status") != "active"
                or member.get("status") != "active"
                or self._active_member_ids(owner) != expected
                or self._active_member_ids(member) != expected
                or self._head_hash(owner) != self._head_hash(member)
                or len(self._head_hash(owner)) != 32
            ):
                return None
            owner_capability = self._mapping(
                owner.get("capability"),
                "owner Federation capability",
            )
            member_capability = self._mapping(
                member.get("capability"),
                "member Federation capability",
            )
            if (
                owner.get("myRole") != "federation_owner"
                or owner_capability.get("canArchive") is not True
                or owner_capability.get("canLeave") is not True
                or member.get("myRole") != "federation_member"
                or member_capability.get("canArchive") is not False
                or member_capability.get("canLeave") is not True
            ):
                return None
            return {"owner": owner, "member": member}

        return self.runtime.wait_until(
            converged,
            f"Federation {federation_id} active on both Stations",
            timeout_seconds=STEP_TIMEOUT,
        )

    def _wait_for_member_status(
        self,
        client_id: str,
        federation_id: str,
        station_peer_id: str,
        status: str,
    ) -> dict[str, Any]:
        def converged() -> dict[str, Any] | None:
            federation = self._optional_federation(
                self._snapshot(client_id),
                federation_id,
            )
            if federation is None:
                return None
            member = next(
                (
                    value
                    for value in self._sequence(
                        federation.get("members"),
                        "Federation members",
                    )
                    if isinstance(value, Mapping)
                    and value.get("stationPeerId") == station_peer_id
                ),
                None,
            )
            return (
                federation
                if isinstance(member, Mapping)
                and member.get("status") == status
                else None
            )

        return self.runtime.wait_until(
            converged,
            f"{station_peer_id} membership status {status}",
            timeout_seconds=STEP_TIMEOUT,
        )

    def _wait_for_missing_context(
        self,
        client_id: str,
        federation_id: str,
    ) -> bool:
        return bool(
            self.runtime.wait_until(
                lambda: (
                    self._optional_federation(
                        self._snapshot(client_id),
                        federation_id,
                    )
                    is None
                ),
                f"{client_id} Federation context removal",
                timeout_seconds=STEP_TIMEOUT,
            )
        )

    def _assert_visible_context(
        self,
        client_id: str,
        federation_id: str,
        *,
        reconcile: bool = True,
        evidence_label: str | None = None,
    ) -> None:
        if reconcile:
            self._reconcile_projection(client_id)
        session = self.runtime.desktop_session(client_id)
        if session is None:
            raise GateError(f"Desktop client {client_id!r} is not active")
        self._open_federation_settings(session)
        selector = f'[data-federation-context-id="{federation_id}"]'
        self.runtime.wait_until(
            lambda: self._visible_element(session, selector),
            f"{client_id} visible Federation context {federation_id}",
            timeout_seconds=STEP_TIMEOUT,
        )
        if (
            session.find_elements(
                '[data-pt-section-host="federation"] button'
            )
            or session.find_elements(
                '[data-federation-governance-action]'
            )
        ):
            raise GateError(
                f"{client_id} exposed Federation governance controls"
            )
        evidence_name = f"{client_id}-federation-{federation_id}"
        if evidence_label:
            evidence_name = f"{evidence_name}-{evidence_label}"
        self.save_screenshot(session, evidence_name)
        self.save_dom(session, evidence_name)

    def _assert_missing_visible_context(
        self,
        client_id: str,
        federation_id: str,
        *,
        evidence_label: str,
    ) -> None:
        self._reconcile_projection(client_id)
        session = self.runtime.desktop_session(client_id)
        if session is None:
            raise GateError(f"Desktop client {client_id!r} is not active")
        self._open_federation_settings(session)
        self.runtime.wait_until(
            lambda: self._visible_element(
                session,
                '[data-pt-section-host="federation"]',
            ),
            f"{client_id} visible Federation settings",
            timeout_seconds=STEP_TIMEOUT,
        )
        selector = f'[data-federation-context-id="{federation_id}"]'
        self.runtime.wait_until(
            lambda: self._visible_element(session, selector) is None,
            f"{client_id} visible Federation context removal {federation_id}",
            timeout_seconds=STEP_TIMEOUT,
        )
        self.save_screenshot(
            session,
            f"{client_id}-federation-{evidence_label}",
        )
        self.save_dom(
            session,
            f"{client_id}-federation-{evidence_label}",
        )

    def _open_federation_settings(self, session: Any) -> None:
        for selector, description in (
            (
                '[data-pt-primary-nav="settings"] [role="button"]',
                "visible Settings navigation",
            ),
            (
                '[data-pt-secondary-tab="federation"]',
                "visible Federation settings group",
            ),
        ):
            element = self.runtime.wait_until(
                lambda selector=selector: self._visible_element(
                    session,
                    selector,
                ),
                description,
                timeout_seconds=STEP_TIMEOUT,
            )
            element.click()
        self.runtime.wait_until(
            lambda: self._visible_element(
                session,
                '[data-pt-section-host="federation"]',
            ),
            "visible Federation settings section",
            timeout_seconds=STEP_TIMEOUT,
        )

    @staticmethod
    def _visible_element(session: Any, selector: str) -> Any | None:
        return next(
            (
                element
                for element in session.find_elements(selector)
                if element.is_displayed()
            ),
            None,
        )

    def _reconcile_projection(self, client_id: str) -> None:
        reconciled = self._action(
            client_id,
            "reconcileFederationProjection",
            {},
        )
        if reconciled.get("reconciled") is not True:
            raise GateError(
                f"{client_id} Federation projection did not reconcile"
            )

    @classmethod
    def _federation(
        cls,
        snapshot: Mapping[str, Any],
        federation_id: str,
    ) -> dict[str, Any]:
        federation = cls._optional_federation(snapshot, federation_id)
        if federation is None:
            raise GateError(f"Federation {federation_id} is missing")
        return federation

    @classmethod
    def _optional_federation(
        cls,
        snapshot: Mapping[str, Any],
        federation_id: str,
    ) -> dict[str, Any] | None:
        return next(
            (
                dict(value)
                for value in cls._sequence(
                    snapshot.get("federations"),
                    "Federation snapshot",
                )
                if isinstance(value, Mapping)
                and value.get("federationId") == federation_id
            ),
            None,
        )

    @classmethod
    def _active_member_ids(
        cls,
        federation: Mapping[str, Any],
    ) -> set[str]:
        return {
            str(member.get("stationPeerId") or "")
            for member in cls._sequence(
                federation.get("members"),
                "Federation members",
            )
            if isinstance(member, Mapping)
            and member.get("status") == "active"
        }

    @staticmethod
    def _head_hash(federation: Mapping[str, Any]) -> tuple[int, ...]:
        value = federation.get("headHash")
        if not isinstance(value, list) or any(
            not isinstance(item, int)
            or isinstance(item, bool)
            or item < 0
            or item > 255
            for item in value
        ):
            raise GateError("Federation head hash must be a byte array")
        return tuple(value)

    @classmethod
    def _head_tuple(
        cls,
        federation: Mapping[str, Any],
    ) -> tuple[int, tuple[int, ...]]:
        head_seq = federation.get("headSeq")
        if (
            not isinstance(head_seq, int)
            or isinstance(head_seq, bool)
            or head_seq < 0
        ):
            raise GateError("Federation head sequence must be non-negative")
        return head_seq, cls._head_hash(federation)

    @classmethod
    def _sequencer_endpoint(
        cls,
        federation: Mapping[str, Any],
    ) -> str:
        sequencer_id = cls._required_text(
            federation.get("sequencerStationPeerId"),
            "sequencer Station identity",
        )
        for member in cls._sequence(
            federation.get("members"),
            "Federation members",
        ):
            if (
                isinstance(member, Mapping)
                and member.get("stationPeerId") == sequencer_id
                and member.get("status") == "active"
            ):
                return cls._required_text(
                    member.get("stationUrl"),
                    "sequencer Station endpoint",
                )
        raise GateError("active sequencer Station endpoint is missing")

    @staticmethod
    def _mapping(value: object, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must be an object")
        return dict(value)

    @staticmethod
    def _sequence(value: object, label: str) -> list[object]:
        if not isinstance(value, list):
            raise GateError(f"{label} must be an array")
        return value

    @staticmethod
    def _required_text(value: object, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise GateError(f"{label} must be non-empty")
        return value.strip()


def main() -> int:
    return FederationTwoStationLifecycleGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
