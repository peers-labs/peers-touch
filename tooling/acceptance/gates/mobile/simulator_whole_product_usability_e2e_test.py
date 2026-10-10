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
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from tooling.acceptance.core import (
    DriverError,
    EvidenceManifestInvalid,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    source_identity,
)
from tooling.acceptance.gates.mobile.simulator_whole_product_usability_e2e import (
    AUTHENTICATED_SURFACE_SETS,
    CONTRACT_ID,
    GATE_ID,
    SURFACE_AUDIT_SCRIPT,
    TEXT_SIZE_SCRIPT,
    VISUAL_REVIEW_GATE_ID,
    SimulatorWholeProductUsabilityGate,
    _is_proven_manifest_result,
    _validate_lifecycle_readiness,
    audit_visible_text,
    expected_result,
    load_surface_inventory,
    record_visual_review,
    selected_surface_entries,
    validate_station_entry_layout,
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
        self.platform = "ios"
        self.build = SimpleNamespace(
            application_id="com.peers.touch.mobile",
        )
        self.orientation = "PORTRAIT"
        self.route_id = "tab:chat"
        self.current_context = "WEBVIEW_com.peers.touch.mobile"
        self.clicked: list[str] = []
        self.lifecycle_actions: list[str] = []
        self.entry_surface_id: str | None = None
        self.recovery_surface_id: str | None = None
        self.chat_surface_id: str | None = None
        self.contacts_surface_id: str | None = None
        self.moments_surface_id: str | None = None
        self.settings_surface_id: str | None = None
        self.activated_apps: list[str] = []
        self.navigation_actions: list[str] = []
        self.orientation_actions: list[str] = []
        self.fixture_history: list[tuple[str, str | None]] = []

    def switch_to_native(self) -> None:
        self.current_context = "NATIVE_APP"

    def switch_to_app_webview(self) -> str:
        self.current_context = "WEBVIEW_com.peers.touch.mobile"
        return self.current_context

    def set_orientation(self, orientation: str) -> None:
        self.orientation = orientation

    def execute_script(self, script: str, *args: Any) -> Any:
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
        if script == "mobile: activateApp":
            self.activated_apps.append(args[0]["bundleId"])
            return None
        return True

    def find_element(self, using: str, value: str) -> str:
        if using not in {"css selector", "class name"}:
            raise AssertionError(using)
        return value

    def click_element(self, element_ref: str) -> None:
        self.clicked.append(element_ref)
        route_match = re.search(r'data-route-id="([^"]+)"', element_ref)
        if route_match:
            self.route_id = route_match.group(1)

    def call_action(
        self,
        action: str,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        if (
            action.endswith(".fixture")
            and not self.current_context.startswith("WEBVIEW")
        ):
            raise DriverError("Harness actions require WebView context")
        fixture_state = {
            "entry.fixture": "entry_surface_id",
            "recovery.fixture": "recovery_surface_id",
            "chat.fixture": "chat_surface_id",
            "contacts.fixture": "contacts_surface_id",
            "moments.fixture": "moments_surface_id",
            "settings.fixture": "settings_surface_id",
        }
        surface_id = (payload or {}).get("surfaceId")
        if action in fixture_state:
            self.fixture_history.append((action, surface_id))
        if action in fixture_state and surface_id is not None:
            overlapping = [
                state
                for fixture_action, state in fixture_state.items()
                if fixture_action != action and getattr(self, state) is not None
            ]
            if overlapping:
                raise DriverError("Acceptance surface fixtures overlap")
        if action == "navigation.snapshot":
            return {"primaryRouteId": self.route_id}
        if action == "navigation.apply":
            self.route_id = str((payload or {})["routeId"])
            self.navigation_actions.append(self.route_id)
            return {"primaryRouteId": self.route_id}
        if action == "orientation.apply":
            orientation = str((payload or {})["orientation"])
            self.orientation = orientation.upper()
            self.orientation_actions.append(orientation)
            width, height = (
                (852, 393)
                if orientation == "landscape"
                else (393, 852)
            )
            return {
                "orientation": orientation,
                "width": width,
                "height": height,
            }
        if action == "entry.fixture":
            self.entry_surface_id = (payload or {}).get("surfaceId")
            return {
                "surfaceId": self.entry_surface_id,
                "revision": 1,
            }
        if action == "recovery.fixture":
            self.recovery_surface_id = (payload or {}).get("surfaceId")
            return {
                "surfaceId": self.recovery_surface_id,
                "revision": 1,
            }
        if action == "chat.fixture":
            self.chat_surface_id = (payload or {}).get("surfaceId")
            return {
                "surfaceId": self.chat_surface_id,
                "revision": 1,
            }
        if action == "contacts.fixture":
            self.contacts_surface_id = (payload or {}).get("surfaceId")
            return {
                "surfaceId": self.contacts_surface_id,
                "revision": 1,
            }
        if action == "moments.fixture":
            self.moments_surface_id = (payload or {}).get("surfaceId")
            return {
                "surfaceId": self.moments_surface_id,
                "revision": 1,
            }
        if action == "settings.fixture":
            self.settings_surface_id = (payload or {}).get("surfaceId")
            return {
                "surfaceId": self.settings_surface_id,
                "revision": 1,
            }
        if action in {"lifecycle.suspend", "lifecycle.resume"}:
            self.lifecycle_actions.append(action)
            return {"snapshot": {"phase": action.removeprefix("lifecycle.")}}
        raise AssertionError(action)

    def get_page_source(self) -> str:
        return (
            '<AppiumAUT><XCUIElementTypeTextField x="20" y="420" '
            'width="300" height="44" /><XCUIElementTypeKeyboard '
            'x="0" y="500" width="393" height="352" /></AppiumAUT>'
        )


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
                "stationLayout": {
                    "launchCard": None,
                    "addressInput": None,
                    "placeholder": None,
                    "submit": None,
                    "helper": None,
                    "logo": None,
                    "stationStatusClasses": [],
                    "continueDisabled": None,
                },
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
        report = SimulatorWholeProductUsabilityGate._result_report("PASS", "shell")

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

    def test_entry_gate_emits_entry_specific_acceptance_report(self) -> None:
        report = SimulatorWholeProductUsabilityGate._result_report("PASS", "entry")

        self.assertEqual(report["runtimeCell"], "ios-simulator-entry")
        self.assertEqual(report["phase"], "MWPU-03 Entry Usability")
        self.assertEqual(report["bom"], ["MWPU-03-ENTRY"])
        self.assertEqual(
            report["observedScope"],
            [
                "launch",
                "station-selection",
                "access-gates",
                "runtime-preparation",
            ],
        )

    def test_recovery_gate_emits_recovery_specific_acceptance_report(self) -> None:
        report = SimulatorWholeProductUsabilityGate._result_report(
            "PASS",
            "recovery",
        )

        self.assertEqual(report["runtimeCell"], "ios-simulator-recovery")
        self.assertEqual(report["phase"], "MWPU-03 Recovery Usability")
        self.assertEqual(report["bom"], ["MWPU-03-RECOVERY"])
        self.assertIn("returning-session", report["observedScope"])
        self.assertIn("scoped-degradation", report["observedScope"])

    def test_contacts_gate_emits_contacts_specific_acceptance_report(self) -> None:
        report = SimulatorWholeProductUsabilityGate._result_report(
            "PASS",
            "contacts",
        )

        self.assertEqual(report["runtimeCell"], "ios-simulator-contacts")
        self.assertEqual(report["phase"], "MWPU-05 Contacts Usability")
        self.assertEqual(report["bom"], ["MWPU-05-CONTACTS"])
        self.assertIn("federated-people-search", report["observedScope"])
        self.assertIn("group-creation", report["observedScope"])

    def test_moments_gate_emits_moments_specific_acceptance_report(self) -> None:
        report = SimulatorWholeProductUsabilityGate._result_report(
            "PASS",
            "moments",
        )

        self.assertEqual(report["runtimeCell"], "ios-simulator-moments")
        self.assertEqual(report["phase"], "MWPU-06 Moments Usability")
        self.assertEqual(report["bom"], ["MWPU-06-MOMENTS"])
        self.assertIn(
            "composer-audience-media-and-draft",
            report["observedScope"],
        )
        self.assertIn(
            "detail-and-comment-continuity",
            report["observedScope"],
        )

    def test_settings_gate_emits_settings_specific_acceptance_report(self) -> None:
        report = SimulatorWholeProductUsabilityGate._result_report(
            "PASS",
            "settings",
        )

        self.assertEqual(report["runtimeCell"], "ios-simulator-settings")
        self.assertEqual(report["phase"], "MWPU-07 Settings Usability")
        self.assertEqual(report["bom"], ["MWPU-07-SETTINGS"])
        self.assertIn(
            "owner-scoped-save-and-conflict",
            report["observedScope"],
        )
        self.assertIn(
            "station-change-and-logout",
            report["observedScope"],
        )

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
        self.assertEqual(
            session.activated_apps,
            ["com.peers.touch.mobile"] * 3,
        )

    def test_shell_driver_falls_back_to_native_ios_scene_rotation(self) -> None:
        class TransientRotationSession(_ShellDriverSession):
            def __init__(self) -> None:
                super().__init__()
                self.orientation_attempts = 0

            def set_orientation(self, orientation: str) -> None:
                self.orientation_attempts += 1
                raise DriverError("Unable To Rotate Device")

        gate = SimulatorWholeProductUsabilityGate(
            foreground_probe=lambda: {},
        )
        session = TransientRotationSession()

        with patch(
            "tooling.acceptance.gates.mobile."
            "simulator_whole_product_usability_e2e.time.sleep"
        ):
            result = gate._configure_cell(session, "landscape-normal")

        self.assertEqual(session.orientation_attempts, 1)
        self.assertEqual(session.orientation_actions, ["landscape"])
        self.assertEqual(result["orientation"], "landscape")
        self.assertGreater(result["width"], result["height"])

    def test_shell_driver_uses_navigation_and_stable_degraded_fixture(self) -> None:
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
        self.assertEqual(
            session.recovery_surface_id,
            "recovery.deferred-capability",
        )
        self.assertEqual(session.route_id, "tab:chat")
        self.assertEqual(session.navigation_actions, ["tab:chat"])
        self.assertEqual(session.lifecycle_actions, [])

    def test_entry_driver_projects_states_and_uses_real_station_controls(self) -> None:
        inventory = load_surface_inventory()
        entries = {
            entry["id"]: entry
            for entry in selected_surface_entries(inventory, "entry")
        }
        gate = SimulatorWholeProductUsabilityGate(
            foreground_probe=lambda: {},
        )
        session = _ShellDriverSession()

        projected = gate._enter_entry_surface(
            session,
            entries["entry.access-pending"],
        )
        self.assertEqual(projected["kind"], "system")
        self.assertEqual(session.entry_surface_id, "entry.access-pending")

        address = gate._enter_entry_surface(
            session,
            entries["entry.station-address"],
        )
        self.assertEqual(address["kind"], "native-touch")
        self.assertIn(".station-add-secondary", session.clicked)

        removal = gate._enter_entry_surface(
            session,
            entries["entry.station-remove-confirm"],
        )
        self.assertEqual(removal["kind"], "native-touch")
        self.assertIn(
            '[data-entry-action="remove-station"]',
            session.clicked,
        )

    def test_recovery_driver_projects_each_declared_surface(self) -> None:
        inventory = load_surface_inventory()
        entries = {
            entry["id"]: entry
            for entry in selected_surface_entries(inventory, "recovery")
        }
        gate = SimulatorWholeProductUsabilityGate(
            foreground_probe=lambda: {},
        )
        session = _ShellDriverSession()

        action = gate._enter_recovery_surface(
            session,
            entries["recovery.projection-stale"],
        )

        self.assertEqual(action["kind"], "system")
        self.assertEqual(action["target"], "fixture-stale-projection")
        self.assertEqual(
            session.recovery_surface_id,
            "recovery.projection-stale",
        )

    def test_chat_driver_projects_declared_surfaces_and_focuses_composer(
        self,
    ) -> None:
        inventory = load_surface_inventory()
        entries = {
            entry["id"]: entry
            for entry in selected_surface_entries(inventory, "chat")
        }
        gate = SimulatorWholeProductUsabilityGate(
            foreground_probe=lambda: {},
        )
        session = _ShellDriverSession()

        action = gate._enter_chat_surface(
            session,
            entries["chat.composer-keyboard"],
        )

        self.assertEqual(action["kind"], "native-touch")
        self.assertEqual(action["target"], "focus-message-composer")
        self.assertEqual(session.chat_surface_id, "chat.composer-keyboard")
        self.assertIn("[data-chat-fixture-composer]", session.clicked)
        self.assertIn("XCUIElementTypeTextField", session.clicked)

    def test_contacts_driver_projects_declared_surfaces_and_uses_search(
        self,
    ) -> None:
        inventory = load_surface_inventory()
        entries = {
            entry["id"]: entry
            for entry in selected_surface_entries(inventory, "contacts")
        }
        gate = SimulatorWholeProductUsabilityGate(
            foreground_probe=lambda: {},
        )
        session = _ShellDriverSession()

        action = gate._enter_contacts_surface(
            session,
            entries["contacts.search-loading"],
        )

        self.assertEqual(action["kind"], "native-text")
        self.assertEqual(action["target"], "search-federated-person")
        self.assertEqual(
            session.contacts_surface_id,
            "contacts.search-loading",
        )
        self.assertIn(
            "[data-contacts-fixture-people-search]",
            session.clicked,
        )

    def test_moments_driver_projects_declared_surfaces_and_uses_composer(
        self,
    ) -> None:
        inventory = load_surface_inventory()
        entries = {
            entry["id"]: entry
            for entry in selected_surface_entries(inventory, "moments")
        }
        gate = SimulatorWholeProductUsabilityGate(
            foreground_probe=lambda: {},
        )
        session = _ShellDriverSession()

        action = gate._enter_moments_surface(
            session,
            entries["moments.composer-audience"],
        )

        self.assertEqual(action["kind"], "native-touch")
        self.assertEqual(action["target"], "change-moment-audience")
        self.assertEqual(
            session.moments_surface_id,
            "moments.composer-audience",
        )
        self.assertIn(
            "[data-moments-fixture-audience]",
            session.clicked,
        )
        self.assertEqual(
            session.fixture_history,
            [
                ("moments.fixture", "moments.composer-audience"),
                ("moments.fixture", None),
                ("moments.fixture", "moments.composer-audience"),
            ],
        )

    def test_settings_driver_opens_selected_detail_in_foreground(self) -> None:
        inventory = load_surface_inventory()
        entries = {
            entry["id"]: entry
            for entry in selected_surface_entries(inventory, "settings")
        }
        gate = SimulatorWholeProductUsabilityGate(
            foreground_probe=lambda: {},
        )
        session = _ShellDriverSession()

        action = gate._enter_settings_surface(
            session,
            entries["settings.privacy-security"],
        )

        self.assertEqual(action["kind"], "native-touch")
        self.assertEqual(action["target"], "tap-setting-privacy-security")
        self.assertEqual(session.settings_surface_id, "settings.summary")
        self.assertIn(
            '[data-settings-fixture-open="privacy-security"]',
            session.clicked,
        )

    def test_lifecycle_readiness_rejects_failed_runtime_with_diagnostic(
        self,
    ) -> None:
        snapshot = {
            "phase": "ACTIVE",
            "generation": 3,
            "runtimes": [
                {"id": "auth", "status": "ready", "errorKey": None},
                {
                    "id": "private-social",
                    "status": "failed",
                    "errorKey": "mobile.lifecycle.runtimeFailed",
                },
            ],
            "runtimeErrors": [
                {
                    "runtimeId": "private-social",
                    "error": "MOBILE_PRIVATE_SOCIAL_PREKEYS_UNAVAILABLE",
                }
            ],
        }

        with self.assertRaises(GateError) as raised:
            _validate_lifecycle_readiness(snapshot)
        self.assertIn("private-social", str(raised.exception))
        self.assertIn(
            "MOBILE_PRIVATE_SOCIAL_PREKEYS_UNAVAILABLE",
            str(raised.exception),
        )

    def test_lifecycle_readiness_accepts_only_ready_runtimes(self) -> None:
        snapshot = {
            "phase": "ACTIVE",
            "generation": 3,
            "runtimes": [
                {"id": "auth", "status": "ready", "errorKey": None},
                {"id": "private-social", "status": "ready", "errorKey": None},
            ],
            "runtimeErrors": [],
        }

        self.assertEqual(_validate_lifecycle_readiness(snapshot), snapshot)

    def test_surface_audit_uses_shell_controls_only_for_scoped_degradation(
        self,
    ) -> None:
        self.assertIn(
            "const controlScope = allowDegradedNotice || usePageControls "
            "? document.body : root;",
            SURFACE_AUDIT_SCRIPT,
        )
        self.assertIn(
            "controlScope.querySelectorAll(interactiveSelector)",
            SURFACE_AUDIT_SCRIPT,
        )
        self.assertIn(
            "controlScope.matches(interactiveSelector)",
            SURFACE_AUDIT_SCRIPT,
        )
        self.assertNotIn(
            "document.querySelectorAll(interactiveSelector)",
            SURFACE_AUDIT_SCRIPT,
        )
        self.assertIn("root.querySelectorAll('*')", SURFACE_AUDIT_SCRIPT)
        self.assertIn(
            '[data-product-surface="shell.degraded-module-notice"]',
            SURFACE_AUDIT_SCRIPT,
        )
        self.assertIn("fullyVisibleWithinAncestors", SURFACE_AUDIT_SCRIPT)
        self.assertIn("clipsOverflow(style.overflowX)", SURFACE_AUDIT_SCRIPT)
        self.assertIn("clipsOverflow(style.overflowY)", SURFACE_AUDIT_SCRIPT)
        self.assertIn("if (style.position === 'fixed') break;", SURFACE_AUDIT_SCRIPT)
        self.assertIn(
            "fullyVisibleWithinAncestors(boundary, rect)",
            SURFACE_AUDIT_SCRIPT,
        )
        self.assertIn(
            "controls: controls.map(({value}) => ({...value}))",
            SURFACE_AUDIT_SCRIPT,
        )
        self.assertNotIn(
            "controls: controls.map(({value}) => value)",
            SURFACE_AUDIT_SCRIPT,
        )
        self.assertIn(
            "element.matches('.chat-action-sheet-backdrop')",
            SURFACE_AUDIT_SCRIPT,
        )
        self.assertIn("stationLayout:", SURFACE_AUDIT_SCRIPT)
        self.assertIn("placeholder: stationPlaceholder", SURFACE_AUDIT_SCRIPT)
        self.assertIn("stationStatusClasses:", SURFACE_AUDIT_SCRIPT)
        self.assertIn(
            ".launch-brand-logo, .launch-hero-logo",
            SURFACE_AUDIT_SCRIPT,
        )

    def test_station_entry_layout_requires_human_usable_geometry_and_states(
        self,
    ) -> None:
        viewport = {
            "width": 393,
            "height": 852,
            "orientation": "portrait",
            "textSize": "normal",
        }
        layout = {
            "launchCard": {"bottom": 820},
            "addressInput": {"width": 168, "height": 44},
            "placeholder": "http://station.local:18080",
            "submit": {"width": 44, "height": 44},
            "helper": {"whiteSpace": "nowrap", "wrapped": False},
            "logo": {
                "borderWidth": 0,
                "filter": "drop-shadow(rgba(15, 23, 42, 0.1) 0px 7px 14px)",
            },
            "stationStatusClasses": [
                ["station-entry-status", "offline"],
            ],
            "continueDisabled": False,
        }
        observation = {"stationLayout": layout}

        validate_station_entry_layout(
            "entry.station-address",
            observation,
            viewport,
        )
        validate_station_entry_layout(
            "entry.station-address",
            {"stationLayout": {**layout, "helper": None}},
            viewport,
        )
        validate_station_entry_layout(
            "entry.station-address-invalid",
            observation,
            viewport,
        )
        validate_station_entry_layout(
            "entry.station-unavailable",
            observation,
            viewport,
        )

        invalid_cases = (
            (
                "entry.station-address",
                {**layout, "placeholder": "station.local:18080"},
            ),
            (
                "entry.station-address",
                {**layout, "addressInput": {"width": 96, "height": 44}},
            ),
            (
                "entry.station-address",
                {
                    **layout,
                    "helper": {"whiteSpace": "normal", "wrapped": True},
                },
            ),
            (
                "entry.station-unavailable",
                {
                    **layout,
                    "stationStatusClasses": [
                        ["station-entry-status", "online"],
                    ],
                },
            ),
            (
                "entry.station-selection",
                {**layout, "launchCard": {"bottom": 740}},
            ),
            (
                "entry.station-selection",
                {
                    **layout,
                    "logo": {"borderWidth": 4, "filter": "none"},
                },
            ),
        )
        for surface_id, invalid_layout in invalid_cases:
            with (
                self.subTest(surface_id=surface_id, layout=invalid_layout),
                self.assertRaises(GateError),
            ):
                validate_station_entry_layout(
                    surface_id,
                    {"stationLayout": invalid_layout},
                    viewport,
                )

    def test_surface_wait_accepts_any_visible_primary_heading(self) -> None:
        source = (
            REPO_ROOT
            / "tooling/acceptance/gates/mobile/"
            "simulator_whole_product_usability_e2e.py"
        ).read_text(encoding="utf-8")

        self.assertIn("document.querySelectorAll(", source)
        self.assertIn(")).some((heading)=>{", source)

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
        for launch_state in ("shell", "background", "resume"):
            self.assertIn(
                f"renderedLaunchState === '{launch_state}'",
                app,
            )

    def test_entry_product_selectors_are_present_in_production(self) -> None:
        app = (REPO_ROOT / "apps/mobile/src/App.tsx").read_text(
            encoding="utf-8"
        )
        station = (
            REPO_ROOT
            / "apps/mobile/src/features/station/StationSelector.tsx"
        ).read_text(encoding="utf-8")
        launch = (
            REPO_ROOT
            / "apps/mobile/src/features/station/StationLaunchScreen.tsx"
        ).read_text(encoding="utf-8")
        progress = (
            REPO_ROOT
            / "apps/mobile/src/features/station/EntryProgressScreen.tsx"
        ).read_text(encoding="utf-8")
        access = (
            REPO_ROOT
            / "apps/mobile/src/features/auth/AccessGateHost.tsx"
        ).read_text(encoding="utf-8")

        for surface_id in REQUIRED_SURFACE_IDS["entry"]:
            self.assertTrue(
                surface_id in app
                or surface_id in station
                or surface_id in launch
                or surface_id in progress
                or surface_id in access,
                surface_id,
            )

    def test_chat_product_selectors_are_present_in_foreground_components(
        self,
    ) -> None:
        fixture = (
            REPO_ROOT / "apps/mobile/src/acceptance/chatSurfaceFixture.ts"
        ).read_text(encoding="utf-8")
        fixture_surface = (
            REPO_ROOT
            / "apps/mobile/src/pages/chat/ChatAcceptanceSurface.tsx"
        ).read_text(encoding="utf-8")
        overlays = (
            REPO_ROOT / "apps/mobile/src/pages/chat/ChatOverlayHost.tsx"
        ).read_text(encoding="utf-8")
        page_content = (
            REPO_ROOT / "apps/mobile/src/pages/chat/ChatPageContent.tsx"
        ).read_text(encoding="utf-8")

        for surface_id in REQUIRED_SURFACE_IDS["chat"]:
            self.assertIn(surface_id, fixture, surface_id)
        self.assertIn("data-product-surface={surfaceId}", fixture_surface)
        self.assertIn(
            'data-product-surface="chat.message-actions"',
            overlays,
        )
        self.assertIn(
            'data-product-surface="chat.destructive-confirm"',
            overlays,
        )
        self.assertIn("data-product-surface={productSurface}", page_content)
        self.assertNotIn("copyable>{member.ptid}", overlays)
        self.assertNotIn("copyable>{candidate.peerPtid}", overlays)

    def test_contacts_product_selectors_are_present_in_foreground_components(
        self,
    ) -> None:
        fixture = (
            REPO_ROOT / "apps/mobile/src/acceptance/contactsSurfaceFixture.ts"
        ).read_text(encoding="utf-8")
        fixture_surface = (
            REPO_ROOT
            / "apps/mobile/src/pages/contacts/ContactsAcceptanceSurface.tsx"
        ).read_text(encoding="utf-8")
        page = (
            REPO_ROOT / "apps/mobile/src/pages/ContactsPage.tsx"
        ).read_text(encoding="utf-8")

        for surface_id in REQUIRED_SURFACE_IDS["contacts"]:
            self.assertIn(surface_id, fixture, surface_id)
        self.assertIn("data-product-surface={surfaceId}", fixture_surface)
        self.assertIn('data-acceptance-id="create-group"', fixture_surface)
        self.assertNotIn("copyable>{selectedContact.peerPtid}", page)
        self.assertNotIn("copyable>{contact.peerPtid}", page)

    def test_moments_product_selectors_are_present_in_foreground_components(
        self,
    ) -> None:
        fixture = (
            REPO_ROOT / "apps/mobile/src/acceptance/momentsSurfaceFixture.ts"
        ).read_text(encoding="utf-8")
        fixture_surface = (
            REPO_ROOT
            / "apps/mobile/src/pages/moments/MomentsAcceptanceSurface.tsx"
        ).read_text(encoding="utf-8")
        page = (
            REPO_ROOT / "apps/mobile/src/pages/MomentsPage.tsx"
        ).read_text(encoding="utf-8")

        for surface_id in REQUIRED_SURFACE_IDS["moments"]:
            self.assertIn(surface_id, fixture, surface_id)
        self.assertIn("data-product-surface={surfaceId}", fixture_surface)
        self.assertIn("[data-moments-fixture-comment]", (
            REPO_ROOT
            / "tooling/acceptance/gates/mobile/"
            "simulator_whole_product_usability_e2e.py"
        ).read_text(encoding="utf-8"))
        self.assertIn(
            'data-product-surface="moments.feed"',
            page,
        )

    def test_settings_product_selectors_are_present_in_foreground_components(
        self,
    ) -> None:
        fixture = (
            REPO_ROOT / "apps/mobile/src/acceptance/settingsSurfaceFixture.ts"
        ).read_text(encoding="utf-8")
        fixture_surface = (
            REPO_ROOT
            / "apps/mobile/src/pages/settings/SettingsAcceptanceSurface.tsx"
        ).read_text(encoding="utf-8")
        page = (
            REPO_ROOT / "apps/mobile/src/pages/SettingsPage.tsx"
        ).read_text(encoding="utf-8")

        for surface_id in REQUIRED_SURFACE_IDS["settings"]:
            self.assertIn(surface_id, fixture, surface_id)
        self.assertIn("data-product-surface={productSurface}", fixture_surface)
        self.assertIn('data-acceptance-id={unsaved', fixture_surface)
        self.assertIn('data-product-surface="settings.summary"', page)
        self.assertNotIn("actorPtid={authSession?.actorRef.ptid}", page)

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

    def test_all_surface_journey_continues_entry_session_after_login(
        self,
    ) -> None:
        inventory = load_surface_inventory()
        gate = SimulatorWholeProductUsabilityGate(
            foreground_probe=lambda: {},
        )
        expected = {"surfaceSet": "all"}

        with patch.object(
            gate,
            "_run_entry_surface_journey",
            return_value=expected,
        ) as run_entry:
            result = gate._run_surface_journey(
                SimpleNamespace(),
                {},
                inventory,
                "all",
            )

        self.assertEqual(result, expected)
        run_entry.assert_called_once_with(
            unittest.mock.ANY,
            {},
            inventory,
            continue_to_authenticated=True,
        )

    def test_authenticated_aggregate_captures_all_sets_in_one_session(
        self,
    ) -> None:
        inventory = json.loads(json.dumps(load_surface_inventory()))
        inventory["viewportTextSizeCells"] = ["portrait-normal"]
        gate = SimulatorWholeProductUsabilityGate(
            foreground_probe=lambda: {},
        )
        session = _ShellDriverSession()
        viewport = {
            "width": 393,
            "height": 852,
            "orientation": "portrait",
            "textSize": "normal",
        }

        def capture(*args: Any) -> dict[str, str]:
            entry = args[3]
            return {"surfaceId": str(entry["id"])}

        with (
            patch.object(
                gate,
                "_configure_cell",
                return_value=viewport,
            ) as configure,
            patch.object(
                gate,
                "_capture_surface",
                side_effect=capture,
            ) as capture_surface,
            patch(
                "tooling.acceptance.gates.mobile."
                "simulator_whole_product_usability_e2e.time.sleep"
            ),
        ):
            result = gate._capture_authenticated_surface_sets(
                SimpleNamespace(),
                session,
                inventory,
                AUTHENTICATED_SURFACE_SETS,
            )

        expected_ids = {
            surface_id
            for surface_set, surface_ids in REQUIRED_SURFACE_IDS.items()
            if surface_set != "entry"
            for surface_id in surface_ids
        }
        self.assertSetEqual(set(result), expected_ids)
        self.assertEqual(capture_surface.call_count, len(expected_ids))
        self.assertEqual(configure.call_count, 2)
        self.assertTrue(
            all(
                set(surface["cells"]) == {"portrait-normal"}
                for surface in result.values()
            )
        )
        self.assertIsNone(session.recovery_surface_id)
        self.assertIsNone(session.chat_surface_id)
        self.assertIsNone(session.contacts_surface_id)
        self.assertIsNone(session.moments_surface_id)
        self.assertIsNone(session.settings_surface_id)
        self.assertEqual(
            session.navigation_actions,
            [
                "tab:chat",
                "tab:chat",
                "tab:chat",
                "tab:chat",
                "tab:contacts",
                "tab:moments",
                "tab:settings",
            ],
        )
        self.assertEqual(
            session.fixture_history[:2],
            [
                ("moments.fixture", "moments.feed"),
                ("moments.fixture", None),
            ],
        )

    def test_landscape_moments_composer_preserves_top_safe_area(self) -> None:
        production_styles = (
            REPO_ROOT
            / "apps"
            / "mobile"
            / "src"
            / "pages"
            / "moments"
            / "MomentComposer.css"
        ).read_text(encoding="utf-8")
        fixture_styles = (
            REPO_ROOT
            / "apps"
            / "mobile"
            / "src"
            / "pages"
            / "moments"
            / "Moments.css"
        ).read_text(encoding="utf-8")
        production_landscape_rule = re.search(
            r"@media \(orientation: landscape\) \{\s*"
            r"\.moments-composer-backdrop\.moment-composer-overlay\s*"
            r">\s*\.moments-composer-card\.moment-composer-surface "
            r"\{(?P<body>.*?)\n  \}",
            production_styles,
            flags=re.DOTALL,
        )
        fixture_landscape_rule = re.search(
            r"@media \(orientation: landscape\) \{\s*"
            r"\.moments-fixture-composer \{(?P<body>.*?)\n  \}",
            fixture_styles,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(production_landscape_rule)
        self.assertIsNotNone(fixture_landscape_rule)
        self.assertIn(
            "max-height: calc(100dvh - var(--safe-area-top));",
            production_landscape_rule.group("body"),
        )
        self.assertIn(
            "max-height: calc(100dvh - var(--safe-area-top));",
            fixture_landscape_rule.group("body"),
        )
        production_header_rule = re.search(
            r"\.moment-composer-header \{(?P<body>.*?)\n\}",
            production_styles,
            flags=re.DOTALL,
        )
        fixture_header_rule = re.search(
            r"\.moments-fixture-sheet-header \{(?P<body>.*?)\n\}",
            fixture_styles,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(production_header_rule)
        self.assertIsNotNone(fixture_header_rule)
        self.assertIn(
            "position: sticky;",
            production_header_rule.group("body"),
        )
        self.assertIn(
            "position: sticky;",
            fixture_header_rule.group("body"),
        )

    def test_all_surface_report_names_final_frontier_scope(self) -> None:
        report = SimulatorWholeProductUsabilityGate._result_report(
            "PASS",
            "all",
        )

        self.assertEqual(report["runtimeCell"], "ios-simulator-all")
        self.assertEqual(report["bom"], ["MWPU-07-FRONTIER"])
        self.assertEqual(
            report["observedScope"],
            [
                "entry",
                "shell",
                "recovery",
                "chat",
                "contacts",
                "moments",
                "settings",
            ],
        )
        self.assertEqual(
            report["unprovenScope"],
            ["Android", "physical-device behavior"],
        )

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

    def test_accepts_successful_acceptance_run_manifest_result(self) -> None:
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
                        "artifactKind": "acceptance-gate-result",
                        "status": "passed",
                        "evidenceStatus": "PASS",
                        "exit_code": 0,
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                    }
                )
                run.publish_latest()

            result = validate_surface_evidence(
                inventory,
                "shell",
                value,
                evidence_store=store,
                expected_source=expected_source,
                require_visual_review=False,
            )

        self.assertEqual(result["surfaceSet"], "shell")

    def test_accepts_successful_development_functional_manifest_result(
        self,
    ) -> None:
        self.assertTrue(_is_proven_manifest_result({
            "artifactKind": "development-functional-result",
            "status": "passed",
            "evidenceStatus": "PASS",
            "exit_code": 0,
            "completionStatus": "DONE",
            "proofStatus": "NOT_APPLICABLE",
        }))

    def test_accepts_explicit_development_manifest_without_latest_pointer(
        self,
    ) -> None:
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
                        "artifactKind": "development-functional-result",
                        "status": "passed",
                        "evidenceStatus": "PASS",
                        "exit_code": 0,
                        "completionStatus": "DONE",
                        "proofStatus": "NOT_APPLICABLE",
                    }
                )
                manifest_ref = run.manifest_ref

            result = validate_surface_evidence(
                inventory,
                "shell",
                value,
                evidence_store=store,
                expected_source=expected_source,
                require_visual_review=False,
                run_manifest_reference=manifest_ref.to_dict(),
            )

        self.assertEqual(result["surfaceSet"], "shell")

    def test_records_review_for_explicit_development_surface_evidence(
        self,
    ) -> None:
        inventory = load_surface_inventory()
        expected_source = source_identity(REPO_ROOT)
        with tempfile.TemporaryDirectory() as temp_dir:
            store = EvidenceStore(Path(temp_dir), worktree=REPO_ROOT)
            with store.begin_run(GATE_ID, source=expected_source) as run:
                value = valid_surface_evidence(inventory, "shell", run)
                evidence_ref = run.write_json(
                    "mobile-whole-product/surface-evidence.json",
                    value,
                    role="mobile-surface-evidence",
                )
                run.finalize(
                    result={
                        "artifactKind": "development-functional-result",
                        "status": "passed",
                        "evidenceStatus": "PASS",
                        "exit_code": 0,
                        "completionStatus": "DONE",
                        "proofStatus": "NOT_APPLICABLE",
                    }
                )
                manifest_ref = run.manifest_ref

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
                surface_evidence_reference=evidence_ref.to_dict(),
                run_manifest_reference=manifest_ref.to_dict(),
            )
            result = validate_surface_evidence(
                inventory,
                "shell",
                value,
                evidence_store=store,
                expected_source=expected_source,
                run_manifest_reference=manifest_ref.to_dict(),
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
                "chat.social.composer.recording",
            ],
        )

        self.assertEqual(len(findings), 3)

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
