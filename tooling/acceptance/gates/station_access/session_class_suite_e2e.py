#!/usr/bin/env python3
"""One reusable Native Suite for Station Access Session-class behavior."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
    validate_suite_runtime_report,
)
from tooling.acceptance.gates.chat.mixed_native_runtime import (
    MixedNativeRuntime,
    compact_json,
)
from tooling.acceptance.gates.chat.native_support import (
    async_harness,
    cleanup_preserving_primary_failure,
    enter_chat_page,
    message_snapshot,
    send_text,
    wait_until,
)


GATE_ID = "station-access-session-class-suite-e2e"
SCENARIO_IDS = (
    "same-station-chat",
    "cross-class-coexistence",
    "desktop-takeover",
    "mobile-takeover",
)
STEP_TIMEOUT = float(
    os.environ.get("STATION_ACCESS_STEP_TIMEOUT_SECONDS", "120")
)
RUNTIME_REUSE_CONTRACT = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "session-class-suite-functional",
        "scenarioIds": list(SCENARIO_IDS),
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 5,
        "minWarmReuseRate": 0.75,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": True,
    }
)


class StationAccessSessionClassSuiteGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-G05"
    bom = ("SAL-G05",)
    spec = ("SAL-J06", "SAL-C07", "D-21")
    report_path = None
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
        self.report.manifest = self.runtime.manifest
        self.evidence_store = EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        self.report.runtime.update(
            {
                "environment": "chat-mixed-native",
                "runtimeCell": "desktop-macos-native+dual-ios-simulator",
                "journey": "station-access-session-class-suite",
                "cleanup": {},
            }
        )

    def run(self) -> dict[str, Any]:
        source = self._mapping(
            self.runtime.manifest.get("source"),
            "Suite source identity",
        )
        source_commit = self._required_text(
            source.get("commit"),
            "Suite source commit",
        )
        fixture_epoch = self._required_text(
            self.runtime.actor_manifest.get("runId")
            or self.runtime.manifest.get("runId"),
            "Suite Fixture Epoch",
        )
        suite_runtime_id = self._required_text(
            self.runtime.manifest.get("runId"),
            "Suite Runtime ID",
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
        cleanup: dict[str, Any] = {}
        source_identity: dict[str, Any] = {}
        conversation_id = ""
        try:
            for index, client_id in enumerate(
                ("desktop-alice", "desktop-bob", "sim-ios")
            ):
                started_at = time.monotonic()
                self.runtime.start_client(
                    client_id,
                    window_slot=index,
                    window_count=3,
                )
                duration = time.monotonic() - started_at
                self.report.add_actor(
                    self.runtime.actor_runtime(client_id)
                )
                ledger.record(
                    SuiteRuntimeAction.CLIENT_LAUNCH,
                    resource_id=f"client:{client_id}",
                    duration_seconds=duration,
                )
                ledger.record(
                    SuiteRuntimeAction.LOGIN,
                    resource_id=f"session:{client_id}",
                )

            self.runtime.prepare_desktop_actor_identity(
                "desktop-bob",
                "desktop-bob-peer",
            )
            source_identity = self.runtime.source_identity()
            alice = self.runtime.identities["desktop-alice"]
            desktop_bob = self.runtime.identities["desktop-bob"]
            mobile_bob = self.runtime.identities["sim-ios"]
            self.assert_condition(
                "initial_suite_topology",
                (
                    alice.station_service_id
                    == desktop_bob.station_service_id
                    == mobile_bob.station_service_id
                    and desktop_bob.ptid == mobile_bob.ptid
                    and desktop_bob.device_id != mobile_bob.device_id
                ),
                compact_json(
                    {
                        "stationServiceId": alice.station_service_id,
                        "desktopBob": desktop_bob.device_id,
                        "mobileBob": mobile_bob.device_id,
                    }
                ),
            )

            scenario_id = "same-station-chat"
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id=scenario_id,
            )
            conversation_id = self.runtime.create_direct(
                "desktop-alice",
                "desktop-bob",
                federation_id=alice.federation_id,
                timeout_seconds=STEP_TIMEOUT,
            )
            text = f"micu-suite-chat-{time.time_ns()}"
            message_id, ui_resource = self._send_desktop_ui(
                "desktop-alice",
                conversation_id,
                text,
                scenario_id,
            )
            self.runtime.wait_for_message(
                "desktop-bob",
                conversation_id,
                message_id,
                lambda value: value.get("plaintext") == text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Desktop Bob receives Suite Chat",
            )
            self.runtime.wait_for_message(
                "sim-ios",
                conversation_id,
                message_id,
                lambda value: value.get("plaintext") == text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Mobile Bob receives Suite Chat",
            )
            desktop_receiver = self._assert_desktop_receiver(
                "desktop-bob",
                conversation_id,
                text,
                scenario_id,
            )
            mobile_receiver = self._assert_mobile_receiver(
                "sim-ios",
                conversation_id,
                message_id,
                text,
                scenario_id,
            )
            self._complete_scenario(
                ledger,
                scenario_id,
                ui_resource=ui_resource,
                receiver_resources=(desktop_receiver, mobile_receiver),
                supporting_resource=f"message:{message_id}",
            )
            scenario_results[scenario_id] = "PASS"

            scenario_id = "cross-class-coexistence"
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id=scenario_id,
            )
            self.assert_condition(
                "desktop_mobile_cross_class_coexistence",
                (
                    self._desktop_authenticated("desktop-bob")
                    and self._mobile_authenticated("sim-ios")
                ),
            )
            text = f"micu-suite-coexist-{time.time_ns()}"
            message_id, ui_resource = self._send_desktop_ui(
                "desktop-alice",
                conversation_id,
                text,
                scenario_id,
            )
            for client_id in ("desktop-bob", "sim-ios"):
                self.runtime.wait_for_message(
                    client_id,
                    conversation_id,
                    message_id,
                    lambda value, expected=text: (
                        value.get("plaintext") == expected
                    ),
                    kind="direct",
                    timeout_seconds=STEP_TIMEOUT,
                    description=f"{client_id} cross-class receiver",
                )
            desktop_receiver = self._assert_desktop_receiver(
                "desktop-bob",
                conversation_id,
                text,
                scenario_id,
            )
            mobile_receiver = self._assert_mobile_receiver(
                "sim-ios",
                conversation_id,
                message_id,
                text,
                scenario_id,
            )
            self._complete_scenario(
                ledger,
                scenario_id,
                ui_resource=ui_resource,
                receiver_resources=(desktop_receiver, mobile_receiver),
                supporting_resource=f"message:{message_id}",
            )
            scenario_results[scenario_id] = "PASS"

            scenario_id = "desktop-takeover"
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id=scenario_id,
            )
            started_at = time.monotonic()
            replacement_desktop = self.runtime.start_client(
                "desktop-bob-peer",
                window_slot=2,
                window_count=3,
            )
            ledger.record(
                SuiteRuntimeAction.CLIENT_REPLACEMENT,
                scenario_id=scenario_id,
                resource_id="client:desktop-bob-peer",
                duration_seconds=time.monotonic() - started_at,
            )
            self.report.add_actor(
                self.runtime.actor_runtime("desktop-bob-peer")
            )
            revoked_desktop = self.runtime.wait_until(
                lambda: (
                    state
                    if (
                        isinstance(
                            state := self.runtime.call_action(
                                "desktop-bob",
                                "identityState",
                                {},
                            ),
                            Mapping,
                        )
                        and state.get("authenticated") is False
                        and state.get("reason") == "revoked"
                    )
                    else None
                ),
                "predecessor Desktop Session revocation",
                timeout_seconds=STEP_TIMEOUT,
            )
            self.runtime.mark_desktop_auth_revoked("desktop-bob")
            self.assert_condition(
                "desktop_takeover_preserves_mobile",
                (
                    replacement_desktop.ptid == desktop_bob.ptid
                    and replacement_desktop.device_id
                    != desktop_bob.device_id
                    and self._mobile_authenticated("sim-ios")
                ),
                compact_json(revoked_desktop),
            )
            text = f"micu-suite-desktop-takeover-{time.time_ns()}"
            message_id, ui_resource = self._send_desktop_ui(
                "desktop-alice",
                conversation_id,
                text,
                scenario_id,
            )
            self.runtime.wait_for_message(
                "desktop-bob-peer",
                conversation_id,
                message_id,
                lambda value: value.get("plaintext") == text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="replacement Desktop receiver",
            )
            self.runtime.wait_for_message(
                "sim-ios",
                conversation_id,
                message_id,
                lambda value: value.get("plaintext") == text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="surviving Mobile receiver",
            )
            desktop_receiver = self._assert_desktop_receiver(
                "desktop-bob-peer",
                conversation_id,
                text,
                scenario_id,
            )
            mobile_receiver = self._assert_mobile_receiver(
                "sim-ios",
                conversation_id,
                message_id,
                text,
                scenario_id,
            )
            self._complete_scenario(
                ledger,
                scenario_id,
                ui_resource=ui_resource,
                receiver_resources=(desktop_receiver, mobile_receiver),
                supporting_resource=f"revocation:{desktop_bob.device_id}",
            )
            scenario_results[scenario_id] = "PASS"

            scenario_id = "mobile-takeover"
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id=scenario_id,
            )
            started_at = time.monotonic()
            replacement_mobile = self.runtime.start_client(
                "sim-ios-peer",
                window_slot=0,
                window_count=1,
            )
            ledger.record(
                SuiteRuntimeAction.CLIENT_REPLACEMENT,
                scenario_id=scenario_id,
                resource_id="client:sim-ios-peer",
                duration_seconds=time.monotonic() - started_at,
            )
            self.report.add_actor(
                self.runtime.actor_runtime("sim-ios-peer")
            )
            self.runtime.set_mobile_suspended("sim-ios", True)
            self.runtime.set_mobile_suspended("sim-ios", False)
            revoked_mobile = self.runtime.wait_until(
                lambda: (
                    scope
                    if (
                        (scope := self.runtime.scope_snapshot("sim-ios"))
                        .get("actorPtid")
                        is None
                        and scope.get("runtimeStationPeerId") is None
                    )
                    else None
                ),
                "predecessor Mobile Session revocation",
                timeout_seconds=STEP_TIMEOUT,
            )
            self.assert_condition(
                "mobile_takeover_preserves_desktop",
                (
                    replacement_mobile.ptid == mobile_bob.ptid
                    and replacement_mobile.device_id != mobile_bob.device_id
                    and self._desktop_authenticated("desktop-bob-peer")
                ),
                compact_json(revoked_mobile),
            )
            text = f"micu-suite-mobile-takeover-{time.time_ns()}"
            message_id, ui_resource = self._send_desktop_ui(
                "desktop-alice",
                conversation_id,
                text,
                scenario_id,
            )
            self.runtime.wait_for_message(
                "desktop-bob-peer",
                conversation_id,
                message_id,
                lambda value: value.get("plaintext") == text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="surviving Desktop receiver",
            )
            desktop_receiver = self._assert_desktop_receiver(
                "desktop-bob-peer",
                conversation_id,
                text,
                scenario_id,
            )
            self._complete_scenario(
                ledger,
                scenario_id,
                ui_resource=ui_resource,
                receiver_resources=(desktop_receiver,),
                supporting_resource=f"revocation:{mobile_bob.device_id}",
            )
            scenario_results[scenario_id] = "PASS"
        finally:
            cleanup = cleanup_preserving_primary_failure(
                lambda: self.runtime.cleanup(
                    save_desktop_log=self.save_app_log
                ),
                self.report,
                "Station Access Session-class Suite",
            )
            self.report.runtime["cleanup"] = cleanup

        if cleanup.get("cleanupErrors"):
            raise GateError(
                "Session-class Suite cleanup failed: "
                f"{compact_json(cleanup)}"
            )
        ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
        suite_report = ledger.require_valid()
        validate_suite_runtime_report(
            suite_report,
            expected_contract=RUNTIME_REUSE_CONTRACT,
        )
        suite_artifact = self._attach_suite_report(suite_report)
        return {
            "sourceIdentity": source_identity,
            "scenarioResults": scenario_results,
            "suiteRuntimeReport": suite_report,
            "suiteRuntimeArtifact": suite_artifact,
            "suiteRuntimeReportDigest": suite_report["reportDigest"],
            "conversationId": conversation_id,
            "cleanup": cleanup,
            "proven_scope": [
                "same-Station Desktop and Mobile Chat",
                "same-actor Desktop and Mobile Session coexistence",
                "same-class Desktop takeover",
                "same-class Mobile takeover",
                "one reusable Suite Runtime lifecycle",
            ],
            "unproven_scope": [
                "cross-Station and Relay-backed Chat",
                "Android and physical-device behavior",
                "Linux and Windows Desktop behavior",
            ],
        }

    def _send_desktop_ui(
        self,
        sender_id: str,
        conversation_id: str,
        text: str,
        evidence_key: str,
    ) -> tuple[str, str]:
        session = self._open_desktop_conversation(
            sender_id,
            conversation_id,
        )
        sent = send_text(session, text)
        message_id = self._required_text(
            sent.get("messageUlid"),
            "Desktop UI message ID",
        )
        refs = (
            self.save_screenshot(session, f"{evidence_key}-sender"),
            self.save_dom(session, f"{evidence_key}-sender"),
        )
        return message_id, self._artifact_set_resource(
            f"{evidence_key}-sender",
            refs,
        )

    def _assert_desktop_receiver(
        self,
        receiver_id: str,
        conversation_id: str,
        text: str,
        evidence_key: str,
    ) -> str:
        session = self._open_desktop_conversation(
            receiver_id,
            conversation_id,
        )
        visible = wait_until(
            lambda: message_snapshot(session, text),
            f"{receiver_id} visible receiver message",
            timeout=STEP_TIMEOUT,
        )
        if text not in str(visible.get("text") or ""):
            raise GateError("Desktop receiver text is not visible")
        refs = (
            self.save_screenshot(session, f"{evidence_key}-desktop-receiver"),
            self.save_dom(session, f"{evidence_key}-desktop-receiver"),
        )
        return self._artifact_set_resource(
            f"{evidence_key}-desktop-receiver",
            refs,
        )

    def _assert_mobile_receiver(
        self,
        receiver_id: str,
        conversation_id: str,
        message_id: str,
        text: str,
        evidence_key: str,
    ) -> str:
        self.runtime.wait_for_message(
            receiver_id,
            conversation_id,
            message_id,
            lambda value: value.get("plaintext") == text,
            kind="direct",
            timeout_seconds=STEP_TIMEOUT,
            description=f"{receiver_id} receiver projection before UI capture",
        )
        self._navigate_mobile_receiver(receiver_id, conversation_id)

        dom_ref = None
        recovery_attempted = False
        for attempt in range(1, 9):
            candidate = self.runtime.mobile_binding.capture_web_dom(
                receiver_id,
                f"{evidence_key}-{attempt}",
            )
            dom_text = self.evidence_store.resolve(candidate).read_text(
                encoding="utf-8",
                errors="replace",
            )
            if text in dom_text:
                dom_ref = candidate
                break
            if 'data-acceptance-id="mobile-route-unavailable"' in dom_text:
                lifecycle = self.runtime.call_action(
                    receiver_id,
                    "recovery.snapshot",
                    {},
                )
                if (
                    not recovery_attempted
                    and 'data-runtime-status="failed"' in dom_text
                    and self._is_deferred_capability_only(lifecycle)
                ):
                    self.runtime.restart_client(
                        receiver_id,
                        timeout_seconds=STEP_TIMEOUT,
                    )
                    self.runtime.wait_for_message(
                        receiver_id,
                        conversation_id,
                        message_id,
                        lambda value: value.get("plaintext") == text,
                        kind="direct",
                        timeout_seconds=STEP_TIMEOUT,
                        description=(
                            f"{receiver_id} receiver projection after "
                            "runtime recovery"
                        ),
                    )
                    self._navigate_mobile_receiver(
                        receiver_id,
                        conversation_id,
                    )
                    recovery_attempted = True
                    continue
                raise GateError(
                    f"{receiver_id} Mobile receiver route is unavailable: "
                    f"{compact_json(lifecycle)}"
                )
            time.sleep(0.5)
        if dom_ref is None:
            raise GateError(
                f"{receiver_id} Mobile receiver text is not visible"
            )
        screenshot_ref = self.runtime.mobile_binding.capture_screenshot(
            receiver_id,
            evidence_key,
        )
        return self._artifact_set_resource(
            f"{evidence_key}-mobile-receiver",
            (dom_ref.to_dict(), screenshot_ref.to_dict()),
        )

    def _navigate_mobile_receiver(
        self,
        receiver_id: str,
        conversation_id: str,
    ) -> None:
        self.runtime.call_action(
            receiver_id,
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:chat"},
        )
        self.runtime.call_action(
            receiver_id,
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:chat-conversation",
                    "sessionUlid": conversation_id,
                },
            },
        )
        expected_detail = (
            f"detail:chat-conversation:{conversation_id}"
        )
        self.runtime.wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self.runtime.call_action(
                            receiver_id,
                            "navigation.snapshot",
                            {},
                        ),
                        Mapping,
                    )
                    and expected_detail in snapshot.get("detailKeys", ())
                )
                else None
            ),
            f"{receiver_id} visible Chat detail route",
            timeout_seconds=STEP_TIMEOUT,
        )

    @staticmethod
    def _is_deferred_capability_only(value: object) -> bool:
        if not isinstance(value, Mapping):
            return False
        admission = value.get("writeAdmission")
        states = value.get("states")
        return (
            value.get("isWriteBlocked") is False
            and isinstance(admission, Mapping)
            and admission.get("open") is True
            and isinstance(states, list)
            and len(states) == 1
            and isinstance(states[0], Mapping)
            and states[0].get("kind") == "deferred-capability"
        )

    def _open_desktop_conversation(
        self,
        client_id: str,
        conversation_id: str,
    ) -> Any:
        session = self.runtime.desktop_session(client_id)
        if session is None:
            raise GateError(f"Desktop client {client_id!r} is not active")
        enter_chat_page(session)
        async_harness(
            session,
            "syncFriendSession",
            {"sessionUlid": conversation_id},
        )
        row = session.find_element(
            f'[data-pt-conversation-item="{conversation_id}"]',
            30,
        )
        row.click()
        wait_until(
            lambda: session.execute_script(
                """
                return document.querySelector(
                  `[data-chat-conversation-pane="${CSS.escape(arguments[0])}"]`
                )?.getAttribute('data-chat-conversation-pane') || '';
                """,
                conversation_id,
            )
            == conversation_id,
            f"{client_id} active conversation pane",
            timeout=STEP_TIMEOUT,
        )
        return session

    def _desktop_authenticated(self, client_id: str) -> bool:
        state = self.runtime.call_action(
            client_id,
            "identityState",
            {},
        )
        return (
            isinstance(state, Mapping)
            and state.get("authenticated") is True
        )

    def _mobile_authenticated(self, client_id: str) -> bool:
        scope = self.runtime.scope_snapshot(client_id)
        identity = self.runtime.identities[client_id]
        return (
            scope.get("phase") == "ACTIVE"
            and scope.get("actorPtid") == identity.ptid
            and scope.get("stationPeerId") == identity.station_peer_id
        )

    @staticmethod
    def _complete_scenario(
        ledger: SuiteRuntimeLedger,
        scenario_id: str,
        *,
        ui_resource: str,
        receiver_resources: tuple[str, ...],
        supporting_resource: str,
    ) -> None:
        ledger.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario_id,
            resource_id=ui_resource,
        )
        ledger.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario_id,
            resource_id=StationAccessSessionClassSuiteGate
            ._artifact_set_resource(
                f"{scenario_id}-receivers",
                receiver_resources,
            ),
        )
        ledger.record(
            SuiteRuntimeAction.SUPPORTING_OBSERVATION,
            scenario_id=scenario_id,
            resource_id=supporting_resource,
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

    @staticmethod
    def _artifact_set_resource(
        label: str,
        references: tuple[Any, ...],
    ) -> str:
        digest = hashlib.sha256(
            json.dumps(
                references,
                ensure_ascii=True,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()
        return f"artifact-set:{label}:{digest}"

    @staticmethod
    def _mapping(value: object, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must be an object")
        return dict(value)

    @staticmethod
    def _required_text(value: object, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise GateError(f"{label} must be a non-empty string")
        return value


def main() -> int:
    return StationAccessSessionClassSuiteGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
