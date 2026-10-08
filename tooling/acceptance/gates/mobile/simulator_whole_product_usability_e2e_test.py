from __future__ import annotations

import json
import os
import re
import struct
import subprocess
import tempfile
import unittest
import zlib
from pathlib import Path
from typing import Any
from unittest.mock import patch

from tooling.acceptance.core import (
    EvidenceManifestInvalid,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    source_identity,
)
from tooling.acceptance.gates.mobile.simulator_whole_product_usability_e2e import (
    CONTRACT_ID,
    GATE_ID,
    READ_RESUME_SCRIPT,
    START_RESUME_SCRIPT,
    TEXT_SIZE_SCRIPT,
    VISUAL_REVIEW_GATE_ID,
    SimulatorWholeProductUsabilityGate,
    audit_visible_text,
    expected_result,
    load_surface_inventory,
    record_visual_review,
    selected_surface_entries,
    validate_surface_evidence,
)

REQUIRED_SURFACE_IDS = {
    "entry": frozenset(
        """
        entry.app-boot entry.station-selection entry.station-empty
        entry.station-address entry.station-address-invalid entry.station-verifying
        entry.station-unavailable entry.station-identity-mismatch
        entry.station-remove-confirm entry.station-handshake entry.access-login
        entry.login-failed entry.session-expired entry.access-oauth
        entry.oauth-progress entry.oauth-failed entry.access-schema
        entry.access-pending entry.access-failed entry.access-unavailable
        entry.runtime-critical entry.runtime-preparing
        """.split()
    ),
    "shell": frozenset(
        """
        shell.chat-tab shell.moments-tab shell.contacts-tab shell.settings-tab
        shell.degraded-module-notice
        """.split()
    ),
    "recovery": frozenset(
        """
        recovery.session-valid-restore recovery.session-revoked
        recovery.session-mismatch recovery.draft-restore
        recovery.draft-restore-failed recovery.capacity recovery.command
        recovery.deferred-capability recovery.event-overflow
        recovery.projection-stale recovery.write-revocation recovery.scope-exit
        recovery.reset-incomplete recovery.device-local
        recovery.legacy-reliability recovery.legacy-read-only
        """.split()
    ),
    "chat": frozenset(
        """
        chat.list chat.list-loading chat.list-empty chat.list-error
        chat.list-unavailable chat.list-search chat.list-search-empty
        chat.direct-thread chat.group-thread chat.thread-empty
        chat.history-loading chat.history-error chat.thread-search
        chat.thread-search-empty chat.thread-search-error chat.composer-keyboard
        chat.attachment-ready chat.attachment-uploading chat.attachment-failed
        chat.voice-recording chat.voice-failed chat.message-pending
        chat.message-failed chat.message-uncertain chat.message-actions
        chat.conversation-actions chat.conversation-settings-pending
        chat.conversation-settings-saved chat.conversation-settings-failed
        chat.destructive-confirm chat.forward-picker chat.forward-pending
        chat.forward-failed chat.group-management chat.group-role-denied
        """.split()
    ),
    "contacts": frozenset(
        """
        contacts.list contacts.list-loading contacts.list-empty
        contacts.list-error contacts.local-search contacts.local-search-empty
        contacts.requests contacts.request-pending contacts.request-unknown
        contacts.request-failed contacts.profile contacts.profile-unavailable
        contacts.block-confirm contacts.add-friend contacts.add-friend-empty
        contacts.search-loading contacts.search-unavailable
        contacts.search-duplicate contacts.search-pending contacts.search-failed
        contacts.search-permission-denied contacts.create-group
        contacts.group-pending contacts.group-failed contacts.group-role-denied
        """.split()
    ),
    "moments": frozenset(
        """
        moments.feed moments.feed-loading moments.feed-error moments.feed-empty
        moments.filtered-empty moments.unavailable moments.feed-loading-more
        moments.feed-retained-error moments.policy-hidden moments.composer
        moments.composer-audience moments.composer-media-uploading
        moments.composer-media-ready moments.composer-media-error
        moments.composer-pending moments.composer-rollback
        moments.composer-draft-restored moments.composer-draft-failed
        moments.reaction-pending moments.reaction-rollback
        moments.detail-comments moments.detail-loading
        moments.detail-unavailable moments.detail-hidden moments.detail-deleted
        moments.comments-loading moments.comments-empty moments.comments-error
        moments.comments-loading-more moments.comments-pending
        moments.comments-failed
        """.split()
    ),
    "settings": frozenset(
        """
        settings.summary settings.summary-loading settings.summary-error
        settings.account-info settings.notifications settings.privacy-security
        settings.safety-number settings.blocked-users settings.chat-settings
        settings.chat-background settings.station-connection settings.encryption
        settings.language settings.about settings.detail-dirty
        settings.detail-saving settings.detail-saved settings.detail-conflict
        settings.detail-unavailable settings.permission-loading
        settings.permission-denied settings.detail-failed
        settings.storage-manage settings.storage-confirm
        settings.storage-progress settings.storage-partial-failure
        settings.storage-retention settings.storage-clear-confirm
        settings.storage-clear-failed settings.station-change
        settings.unsaved-exit settings.logout-confirm
        """.split()
    ),
}


class _ShellDriverSession:
    client_id = "sim-ios"

    def __init__(self) -> None:
        self.orientation = "PORTRAIT"
        self.route_id = "tab:chat"
        self.current_context = "WEBVIEW_com.peers.touch.mobile"
        self.clicked: list[str] = []
        self.lifecycle_actions: list[str] = []

    def switch_to_native(self) -> None:
        self.current_context = "NATIVE_APP"

    def switch_to_app_webview(self) -> str:
        self.current_context = "WEBVIEW_com.peers.touch.mobile"
        return self.current_context

    def set_orientation(self, orientation: str) -> None:
        self.orientation = orientation

    def execute_script(self, script: str, *args: Any) -> Any:
        if script == READ_RESUME_SCRIPT and not self.current_context.startswith(
            "WEBVIEW"
        ):
            raise DriverError("execute/sync is unavailable in native context")
        if script == TEXT_SIZE_SCRIPT:
            width, height = (
                (852, 393)
                if self.orientation == "LANDSCAPE"
                else (393, 852)
            )
            return {
                "textSize": args[0],
                "width": width,
                "height": height,
                "scaledElementCount": 1 if args[0] == "maximum" else 0,
            }
        if script == READ_RESUME_SCRIPT:
            return {"done": True, "error": None}
        return True

    def find_element(self, using: str, value: str) -> str:
        if using != "css selector":
            raise AssertionError(using)
        return value

    def click_element(self, element_ref: str) -> None:
        self.clicked.append(element_ref)
        route_match = re.search(r'data-route-id="([^"]+)"', element_ref)
        if route_match:
            self.route_id = route_match.group(1)

    def call_action(self, action: str) -> Any:
        if action == "navigation.snapshot":
            return {"primaryRouteId": self.route_id}
        if action in {"lifecycle.suspend", "lifecycle.resume"}:
            self.lifecycle_actions.append(action)
            return {"snapshot": {"phase": action.removeprefix("lifecycle.")}}
        raise AssertionError(action)


def png_bytes(width: int, height: int) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload))
        )

    rows = b"".join(
        b"\x00" + (b"\x00\x00\x00\xff" * width)
        for _ in range(height)
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(
            b"IHDR",
            struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0),
        )
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def valid_surface_evidence(
    inventory: dict[str, Any],
    surface_set: str,
    run: Any,
) -> dict[str, Any]:
    evidence: dict[str, Any] = {}
    for entry in selected_surface_entries(inventory, surface_set):
        cells: dict[str, Any] = {}
        for cell_id in inventory["viewportTextSizeCells"]:
            orientation = (
                "landscape" if cell_id.startswith("landscape") else "portrait"
            )
            text_size = (
                "maximum" if cell_id.endswith("maximum-text") else "normal"
            )
            width = 852 if orientation == "landscape" else 393
            height = 393 if orientation == "landscape" else 852
            prefix = f"mobile-whole-product/{entry['id']}/{cell_id}"
            selector_match = re.fullmatch(
                r'\[([a-zA-Z0-9_-]+)="([^"]+)"\]',
                entry["surfaceSelector"],
            )
            assert selector_match is not None
            selector_attribute, selector_value = selector_match.groups()
            dom = (
                f'<main {selector_attribute}="{selector_value}">'
                f"<h1>{entry['id']}</h1><button>Continue</button></main>"
            ).encode()
            accessibility = (
                f'<AppiumAUT><XCUIElementTypeApplication x="0" y="0" '
                f'width="{width}" height="{height}">'
                '<XCUIElementTypeButton label="Continue" x="10" y="10" '
                'width="44" height="44" visible="true" />'
                "</XCUIElementTypeApplication></AppiumAUT>"
            ).encode()
            viewport = {
                "width": width,
                "height": height,
                "orientation": orientation,
                "textSize": text_size,
            }
            interaction = {
                "artifactKind": "mobile-surface-interaction-trace",
                "gateId": GATE_ID,
                "runId": run.run_id,
                "surfaceId": entry["id"],
                "cellId": cell_id,
                "entryAction": entry["entryAction"],
                "surfaceSelector": entry["surfaceSelector"],
                "expectedResult": expected_result(inventory, entry),
                "viewport": viewport,
                "surfaceElement": {
                    "selector": entry["surfaceSelector"],
                    "width": width,
                    "height": height,
                    "visible": True,
                    "inViewport": True,
                },
                "uiAction": {
                    "kind": "native-touch",
                    "target": entry["entryAction"],
                    "performed": True,
                },
                "controls": [
                    {
                        "label": "Continue",
                        "width": 44,
                        "height": 44,
                        "visible": True,
                        "inViewport": True,
                    }
                ],
                "occlusions": [],
                "blockingSurfaces": [],
            }
            cells[cell_id] = {
                "status": "PASS",
                "viewport": viewport,
                "evidence": {
                    "screenshot": run.write_bytes(
                        f"{prefix}/screenshot.png",
                        png_bytes(width, height),
                        media_type="image/png",
                    ).to_dict(),
                    "dom": run.write_bytes(
                        f"{prefix}/dom.html", dom, media_type="text/html"
                    ).to_dict(),
                    "accessibility": run.write_bytes(
                        f"{prefix}/accessibility.xml",
                        accessibility,
                        media_type="application/xml",
                    ).to_dict(),
                    "interactionTrace": run.write_bytes(
                        f"{prefix}/interaction.json",
                        json.dumps(interaction).encode(),
                        media_type="application/json",
                    ).to_dict(),
                },
            }
        evidence[entry["id"]] = {
            "status": "PASS",
            "routeOrState": entry["routeOrState"],
            "entryAction": entry["entryAction"],
            "surfaceSelector": entry["surfaceSelector"],
            "expectedResult": expected_result(inventory, entry),
            "cells": cells,
        }
    foreground = run.write_bytes(
        "mobile-whole-product/foreground.json",
        json.dumps(
            {
                "artifactKind": "mobile-simulator-foreground-observation",
                "gateId": GATE_ID,
                "runId": run.run_id,
                "platform": "ios",
                "bundleIdentifier": "com.apple.iphonesimulator",
                "frontmost": True,
                "windowVisible": True,
            }
        ).encode(),
        media_type="application/json",
    ).to_dict()
    return {
        "artifactKind": "mobile-whole-product-surface-evidence",
        "gateId": GATE_ID,
        "contractId": CONTRACT_ID,
        "surfaceSet": surface_set,
        "runId": run.run_id,
        "workspaceId": run.store.workspace_id,
        "status": "PASS",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "source": source_identity(REPO_ROOT),
        "foregroundEvidence": {
            "platform": "ios",
            "simulatorApplication": "com.apple.iphonesimulator",
            "frontmost": True,
            "windowVisible": True,
            "observation": foreground,
        },
        "surfaceEvidence": evidence,
        "findings": [],
    }


class WholeProductSurfaceContractTests(unittest.TestCase):
    def test_shell_gate_emits_canonical_acceptance_report(self) -> None:
        report = SimulatorWholeProductUsabilityGate._result_report("PASS")

        self.assertEqual(
            report["artifactKind"],
            "acceptance-gate-evidence-report",
        )
        self.assertEqual(report["bom"], ["MWPU-02-SHELL"])
        self.assertEqual(
            report["spec"],
            ["MS-PA28", "MS-PA29", "MS-AG12"],
        )
        self.assertTrue(report["sampleEmissionAllowed"])

    def test_foreground_probe_requires_the_declared_booted_simulator(self) -> None:
        completed = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=json.dumps(
                {
                    "devices": {
                        "ios": [
                            {
                                "udid": "simulator-1",
                                "state": "Booted",
                            }
                        ]
                    }
                }
            ),
            stderr="",
        )
        with (
            patch.dict(os.environ, {"PT_MOBILE_FOREGROUND_REQUIRED": "1"}),
            patch(
                "tooling.acceptance.gates.mobile."
                "simulator_whole_product_usability_e2e.subprocess.run",
                return_value=completed,
            ),
        ):
            self.assertEqual(
                SimulatorWholeProductUsabilityGate
                ._probe_simulator_foreground("simulator-1"),
                {
                    "platform": "ios",
                    "bundleIdentifier": "com.apple.iphonesimulator",
                    "frontmost": True,
                    "windowVisible": True,
                },
            )

    def test_shell_driver_configures_each_required_viewport_cell(self) -> None:
        gate = SimulatorWholeProductUsabilityGate(
            foreground_probe=lambda: {},
        )
        session = _ShellDriverSession()

        with patch(
            "tooling.acceptance.gates.mobile."
            "simulator_whole_product_usability_e2e.time.sleep"
        ):
            self.assertEqual(
                gate._configure_cell(session, "portrait-normal"),
                {
                    "width": 393,
                    "height": 852,
                    "orientation": "portrait",
                    "textSize": "normal",
                },
            )
            self.assertEqual(
                gate._configure_cell(session, "portrait-maximum-text"),
                {
                    "width": 393,
                    "height": 852,
                    "orientation": "portrait",
                    "textSize": "maximum",
                },
            )
            self.assertEqual(
                gate._configure_cell(session, "landscape-normal"),
                {
                    "width": 852,
                    "height": 393,
                    "orientation": "landscape",
                    "textSize": "normal",
                },
            )

    def test_shell_driver_uses_real_navigation_and_degraded_state(self) -> None:
        inventory = load_surface_inventory()
        entries = {
            entry["id"]: entry
            for entry in selected_surface_entries(inventory, "shell")
        }
        gate = SimulatorWholeProductUsabilityGate(
            foreground_probe=lambda: {},
        )
        session = _ShellDriverSession()

        action = gate._enter_surface(session, entries["shell.contacts-tab"])
        self.assertEqual(action["kind"], "native-touch")
        self.assertEqual(session.route_id, "tab:contacts")
        self.assertEqual(
            session.clicked,
            ['[data-route-id="tab:contacts"]'],
        )
        degraded = gate._enter_surface(
            session,
            entries["shell.degraded-module-notice"],
        )
        self.assertEqual(degraded["kind"], "system")
        self.assertEqual(session.lifecycle_actions, ["lifecycle.suspend"])
        session.switch_to_native()
        gate._wait_for_resume(session)
        self.assertTrue(session.current_context.startswith("WEBVIEW"))

    def test_resume_script_avoids_webkit_incompatible_trailing_argument_comma(
        self,
    ) -> None:
        self.assertNotIn("root['lifecycle.resume']({}),", START_RESUME_SCRIPT)
        self.assertNotIn("=>", START_RESUME_SCRIPT)

    def test_shell_product_selectors_are_present_in_production(self) -> None:
        shell = (
            REPO_ROOT / "apps/mobile/src/components/MobileShell.tsx"
        ).read_text(encoding="utf-8")
        notice = (
            REPO_ROOT
            / "apps/mobile/src/components/recovery/DeferredCapabilityNotice.tsx"
        ).read_text(encoding="utf-8")
        settings = (
            REPO_ROOT / "apps/mobile/src/pages/SettingsPage.tsx"
        ).read_text(encoding="utf-8")
        app = (REPO_ROOT / "apps/mobile/src/App.tsx").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            "data-product-surface={`shell.${activeTab}-tab`}",
            shell,
        )
        self.assertIn("data-route-id={descriptor.routeId}", shell)
        self.assertIn(
            'data-product-surface="shell.degraded-module-notice"',
            notice,
        )
        self.assertNotIn("ptidDisplay", settings)
        self.assertIn("settings-profile-subtitle", settings)
        self.assertIn(
            "launchState === 'shell' || launchState === 'resume'",
            app,
        )

    def test_inventory_covers_every_surface_set_and_contract_cell(self) -> None:
        inventory = load_surface_inventory()

        self.assertEqual(
            set(inventory["surfaceSets"]),
            {
                "entry",
                "shell",
                "recovery",
                "chat",
                "contacts",
                "moments",
                "settings",
            },
        )
        entries = selected_surface_entries(inventory, "all")
        for surface_set, required_ids in REQUIRED_SURFACE_IDS.items():
            actual_ids = {
                entry["id"]
                for entry in selected_surface_entries(inventory, surface_set)
            }
            self.assertSetEqual(actual_ids, required_ids, surface_set)
        self.assertEqual(
            len(entries),
            sum(len(required_ids) for required_ids in REQUIRED_SURFACE_IDS.values()),
        )
        self.assertEqual(len({entry["id"] for entry in entries}), len(entries))
        for entry in entries:
            self.assertTrue(expected_result(inventory, entry))

    def test_inventory_covers_current_route_and_setting_sources(self) -> None:
        inventory = load_surface_inventory()
        route_states = {
            entry["routeOrState"]
            for entry in selected_surface_entries(inventory, "all")
        }
        navigation_source = (
            REPO_ROOT
            / "apps/mobile/src/app/navigation/navigationDescriptors.ts"
        ).read_text(encoding="utf-8")
        setting_source = (
            REPO_ROOT / "apps/mobile/src/app/navigation/navigationStore.ts"
        ).read_text(encoding="utf-8")
        route_ids = {
            "tab:chat",
            "tab:moments",
            "tab:contacts",
            "tab:settings",
            "detail:chat-conversation",
            "detail:group-conversation",
            "detail:contact-profile",
            "detail:moment",
            "detail:setting",
            "overlay:add-friend",
            "overlay:create-group",
        }
        for route_id in route_ids:
            self.assertIn(f"'{route_id}'", navigation_source)
            self.assertTrue(
                any(state.startswith(route_id) for state in route_states),
                route_id,
            )
        for setting_id in (
            "account-info",
            "notifications",
            "privacy-security",
            "safety-number",
            "blocked-users",
            "chat-settings",
            "chat-background",
            "station-connection",
            "encryption",
            "language",
            "about",
        ):
            self.assertIn(f"'{setting_id}'", setting_source)
            self.assertIn(f"detail:setting:{setting_id}", route_states)

    def test_accepts_complete_source_bound_foreground_evidence(self) -> None:
        inventory = load_surface_inventory()
        expected_source = source_identity(REPO_ROOT)
        with tempfile.TemporaryDirectory() as temp_dir:
            store = EvidenceStore(Path(temp_dir), worktree=REPO_ROOT)
            with store.begin_run(GATE_ID, source=expected_source) as run:
                value = valid_surface_evidence(inventory, "shell", run)
                run.write_json(
                    "mobile-whole-product/surface-evidence.json",
                    value,
                    role="mobile-surface-evidence",
                )
                run.finalize(
                    result={
                        "status": "PASS",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                    }
                )
                run.publish_latest()
                review_ref = record_visual_review(
                    inventory,
                    "shell",
                    {
                        "reviewer": {"kind": "agent", "id": "test-agent"},
                        "verdict": "PASS",
                        "findings": [],
                    },
                    evidence_store=store,
                    expected_source=expected_source,
                )
                result = validate_surface_evidence(
                    inventory,
                    "shell",
                    value,
                    evidence_store=store,
                    expected_source=expected_source,
                )

        self.assertEqual(result["surfaceSet"], "shell")
        self.assertEqual(review_ref["gateId"], VISUAL_REVIEW_GATE_ID)

    def test_requires_an_independent_visual_review_after_surface_capture(self) -> None:
        inventory = load_surface_inventory()
        expected_source = source_identity(REPO_ROOT)
        with tempfile.TemporaryDirectory() as temp_dir:
            store = EvidenceStore(Path(temp_dir), worktree=REPO_ROOT)
            with store.begin_run(GATE_ID, source=expected_source) as run:
                value = valid_surface_evidence(inventory, "shell", run)
                run.write_json(
                    "mobile-whole-product/surface-evidence.json",
                    value,
                    role="mobile-surface-evidence",
                )
                run.finalize(
                    result={
                        "status": "PASS",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                    }
                )
                run.publish_latest()

            validate_surface_evidence(
                inventory,
                "shell",
                value,
                evidence_store=store,
                expected_source=expected_source,
                require_visual_review=False,
            )
            with self.assertRaisesRegex(
                (GateError, EvidenceManifestInvalid),
                "visual-review|visual review|latest pointer",
            ):
                validate_surface_evidence(
                    inventory,
                    "shell",
                    value,
                    evidence_store=store,
                    expected_source=expected_source,
                )

    def test_rejects_visual_review_with_findings(self) -> None:
        inventory = load_surface_inventory()
        expected_source = source_identity(REPO_ROOT)
        with tempfile.TemporaryDirectory() as temp_dir:
            store = EvidenceStore(Path(temp_dir), worktree=REPO_ROOT)
            with store.begin_run(GATE_ID, source=expected_source) as run:
                value = valid_surface_evidence(inventory, "shell", run)
                run.write_json(
                    "mobile-whole-product/surface-evidence.json",
                    value,
                    role="mobile-surface-evidence",
                )
                run.finalize(
                    result={
                        "status": "PASS",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                    }
                )
                run.publish_latest()
            record_visual_review(
                inventory,
                "shell",
                {
                    "reviewer": {"kind": "agent", "id": "test-agent"},
                    "verdict": "FAIL",
                    "findings": [
                        {
                            "surfaceId": "shell.chat-tab",
                            "cellId": "portrait-normal",
                            "severity": "major",
                            "message": "Primary action is visually occluded.",
                        }
                    ],
                },
                evidence_store=store,
                expected_source=expected_source,
            )

            with self.assertRaisesRegex(GateError, "run manifest"):
                validate_surface_evidence(
                    inventory,
                    "shell",
                    value,
                    evidence_store=store,
                    expected_source=expected_source,
                )

    def test_rejects_missing_surface_or_evidence_role(self) -> None:
        inventory = load_surface_inventory()
        expected_source = source_identity(REPO_ROOT)
        with tempfile.TemporaryDirectory() as temp_dir:
            store = EvidenceStore(Path(temp_dir), worktree=REPO_ROOT)
            with store.begin_run(GATE_ID, source=expected_source) as run:
                value = valid_surface_evidence(inventory, "shell", run)
                surface_id = next(iter(value["surfaceEvidence"]))
                first_cell = inventory["viewportTextSizeCells"][0]
                del value["surfaceEvidence"][surface_id]["cells"][first_cell][
                    "evidence"
                ]["dom"]

                with self.assertRaisesRegex(GateError, "incomplete"):
                    validate_surface_evidence(
                        inventory,
                        "shell",
                        value,
                        evidence_store=store,
                        expected_source=expected_source,
                    )

    def test_rejects_forged_artifact_reference_and_foreground_flag(self) -> None:
        inventory = load_surface_inventory()
        expected_source = source_identity(REPO_ROOT)
        with tempfile.TemporaryDirectory() as temp_dir:
            store = EvidenceStore(Path(temp_dir), worktree=REPO_ROOT)
            with store.begin_run(GATE_ID, source=expected_source) as run:
                value = valid_surface_evidence(inventory, "shell", run)
                surface_id = next(iter(value["surfaceEvidence"]))
                first_cell = inventory["viewportTextSizeCells"][0]
                value["surfaceEvidence"][surface_id]["cells"][first_cell][
                    "evidence"
                ]["screenshot"] = "x"

                with self.assertRaisesRegex(GateError, "ArtifactRef"):
                    validate_surface_evidence(
                        inventory,
                        "shell",
                        value,
                        evidence_store=store,
                        expected_source=expected_source,
                    )

                value = valid_surface_evidence(inventory, "shell", run)
                value["foregroundEvidence"]["frontmost"] = False
                with self.assertRaisesRegex(GateError, "foreground"):
                    validate_surface_evidence(
                        inventory,
                        "shell",
                        value,
                        evidence_store=store,
                        expected_source=expected_source,
                    )

    def test_rejects_journey_contract_drift(self) -> None:
        inventory = load_surface_inventory()
        expected_source = source_identity(REPO_ROOT)
        with tempfile.TemporaryDirectory() as temp_dir:
            store = EvidenceStore(Path(temp_dir), worktree=REPO_ROOT)
            with store.begin_run(GATE_ID, source=expected_source) as run:
                value = valid_surface_evidence(inventory, "shell", run)
                surface_id = next(iter(value["surfaceEvidence"]))
                value["surfaceEvidence"][surface_id][
                    "entryAction"
                ] = "fixture-bypass"

                with self.assertRaisesRegex(GateError, "incomplete"):
                    validate_surface_evidence(
                        inventory,
                        "shell",
                        value,
                        evidence_store=store,
                        expected_source=expected_source,
                    )

    def test_rejects_stale_source_and_unresolved_artifact(self) -> None:
        inventory = load_surface_inventory()
        expected_source = source_identity(REPO_ROOT)
        with tempfile.TemporaryDirectory() as temp_dir:
            store = EvidenceStore(Path(temp_dir), worktree=REPO_ROOT)
            with store.begin_run(GATE_ID, source=expected_source) as run:
                value = valid_surface_evidence(inventory, "shell", run)
                value["source"] = {**expected_source, "commit": "f" * 40}
                with self.assertRaisesRegex(GateError, "stale"):
                    validate_surface_evidence(
                        inventory,
                        "shell",
                        value,
                        evidence_store=store,
                        expected_source=expected_source,
                    )

                value = valid_surface_evidence(inventory, "shell", run)
                surface_id = next(iter(value["surfaceEvidence"]))
                first_cell = inventory["viewportTextSizeCells"][0]
                value["surfaceEvidence"][surface_id]["cells"][first_cell][
                    "evidence"
                ]["screenshot"]["path"] = "missing/screenshot.png"
                with self.assertRaises(EvidenceManifestInvalid):
                    validate_surface_evidence(
                        inventory,
                        "shell",
                        value,
                        evidence_store=store,
                        expected_source=expected_source,
                    )

    def test_rejects_raw_identity_and_untranslated_key(self) -> None:
        inventory = load_surface_inventory()

        findings = audit_visible_text(
            inventory,
            [
                "Alice",
                "ptid:v1:actor:peers:p:alice:0123456789abcdef",
                "mobile.chat.messagePlaceholder",
            ],
        )

        self.assertEqual(len(findings), 2)

    def test_contract_trace_registers_the_dedicated_gate(self) -> None:
        acceptance_root = Path(__file__).resolve().parents[2]
        feature = json.loads(
            (
                acceptance_root
                / "features/mobile-native-accessibility-performance.yaml"
            ).read_text(encoding="utf-8")
        )
        capabilities = json.loads(
            (acceptance_root / "capabilities/mobile.yaml").read_text(
                encoding="utf-8"
            )
        )
        capability = next(
            item
            for item in capabilities["capabilities"]
            if item["id"] == "mobile-native-quality"
        )
        registry = json.loads(
            (acceptance_root / "registry.yaml").read_text(encoding="utf-8")
        )
        rule = next(
            item
            for item in registry["rules"]
            if item["id"] == "mobile-whole-product-usability"
        )
        catalog = json.loads(
            (acceptance_root / "gates.yaml").read_text(encoding="utf-8")
        )
        plan = json.loads(
            (acceptance_root / "plans/mobile-shell.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertIn(GATE_ID, feature["required_gates"])
        self.assertIn(GATE_ID, capability["required_gates"])
        self.assertIn(GATE_ID, capability["evidence"]["proven_by"])
        self.assertEqual(rule["require"], [GATE_ID])
        self.assertIn(GATE_ID, catalog["gates"])
        self.assertEqual(
            catalog["gates"][GATE_ID]["environment"],
            "mobile-direct-simulator",
        )
        self.assertEqual(
            catalog["gates"][GATE_ID]["provisioner"],
            "mobile-direct-simulator",
        )
        self.assertIn(GATE_ID, plan["selected_gates"])
        self.assertIn("MS-PA28", plan["product_assertions"])
        self.assertIn("MS-PA29", plan["product_assertions"])


if __name__ == "__main__":
    unittest.main()
