#!/usr/bin/env python3
"""Runtime Cell Core self-tests (NDR-W1).

Acceptance Infra self-validation for the Native Desktop Runtime Cell contract,
manifest identity, and cross-platform matrix aggregation. Uses synthetic
contracts only; it does not exercise any business Domain.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (
    CellAdapterIdentity,
    CellDisplayIdentity,
    CellPlatformIdentity,
    CellSourceIdentity,
    CellTransportIdentity,
    ProvisioningError,
    RuntimeCellContract,
    RuntimeCellManifest,
    RuntimeCellState,
    parse_required_runtime_cells,
)


def _valid_linux_contract() -> dict:
    return {
        "id": "desktop-linux-native",
        "platform": "linux",
        "architecture": "x86_64",
        "isolation": {
            "kind": "container",
            "image_ref": "profile:acceptance-linux-image",
            "image_digest_required": True,
        },
        "transport": {"kind": "ssh", "target_ref": "profile:acceptance-linux"},
        "display": {
            "session_type": "x11",
            "physical_monitor_required": False,
            "connected_output_required": True,
            "fixed_geometry": "1920x1080",
        },
        "webdriver": {"kind": "tauri-embedded", "bind": "127.0.0.1"},
        "native_adapter": {
            "input": "x11-xtest",
            "window": "x11-ewmh",
            "screenshot": "webkitgtk-and-desktop",
        },
        "source": {"mode": "git-object-sync"},
        "lease": {"scope": "gui-session", "ttl_seconds": 5400},
        "cleanup": {"resources": ["ssh-tunnel", "processes", "ports"]},
    }


class RuntimeCellContractTests(unittest.TestCase):
    def test_valid_contract_parses(self) -> None:
        contract = RuntimeCellContract.from_dict(_valid_linux_contract())
        self.assertEqual(contract.cell_id, "desktop-linux-native")
        self.assertTrue(contract.requires_remote_loopback())
        self.assertEqual(contract.webdriver.bind, "127.0.0.1")

    def test_literal_ssh_target_is_rejected(self) -> None:
        data = _valid_linux_contract()
        data["transport"]["target_ref"] = "operator@192.0.2.10"
        with self.assertRaises(ProvisioningError):
            RuntimeCellContract.from_dict(data)

    def test_absolute_remote_path_target_is_rejected(self) -> None:
        data = _valid_linux_contract()
        data["transport"]["target_ref"] = "/srv/peers-touch/repo"
        with self.assertRaises(ProvisioningError):
            RuntimeCellContract.from_dict(data)

    def test_xvfb_session_is_rejected(self) -> None:
        data = _valid_linux_contract()
        data["display"]["session_type"] = "xvfb"
        with self.assertRaises(ProvisioningError):
            RuntimeCellContract.from_dict(data)

    def test_remote_non_loopback_webdriver_is_rejected(self) -> None:
        data = _valid_linux_contract()
        data["webdriver"]["bind"] = "0.0.0.0"
        with self.assertRaises(ProvisioningError):
            RuntimeCellContract.from_dict(data)

    def test_container_requires_digest_attestation(self) -> None:
        data = _valid_linux_contract()
        data["isolation"]["image_digest_required"] = False
        with self.assertRaises(ProvisioningError):
            RuntimeCellContract.from_dict(data)

    def test_non_positive_lease_ttl_is_rejected(self) -> None:
        data = _valid_linux_contract()
        data["lease"]["ttl_seconds"] = 0
        with self.assertRaises(ProvisioningError):
            RuntimeCellContract.from_dict(data)

    def test_platform_display_mismatch_is_rejected(self) -> None:
        data = _valid_linux_contract()
        data["display"]["session_type"] = "native-macos"
        with self.assertRaises(ProvisioningError):
            RuntimeCellContract.from_dict(data)

    def test_invalid_fixed_geometry_is_rejected(self) -> None:
        data = _valid_linux_contract()
        data["display"]["fixed_geometry"] = "1920 by 1080"
        with self.assertRaises(ProvisioningError):
            RuntimeCellContract.from_dict(data)

    def test_missing_native_adapter_field_fails(self) -> None:
        data = _valid_linux_contract()
        del data["native_adapter"]["input"]
        with self.assertRaises(ProvisioningError):
            RuntimeCellContract.from_dict(data)

    def test_unknown_platform_fails(self) -> None:
        data = _valid_linux_contract()
        data["platform"] = "solaris"
        with self.assertRaises(ProvisioningError):
            RuntimeCellContract.from_dict(data)

    def test_contract_roundtrip_omits_no_required_field(self) -> None:
        contract = RuntimeCellContract.from_dict(_valid_linux_contract())
        payload = contract.to_dict()
        self.assertEqual(payload["display"]["sessionType"], "x11")
        self.assertEqual(payload["transport"]["targetRef"], "profile:acceptance-linux")


def _ready_manifest() -> RuntimeCellManifest:
    digest = "a" * 64
    return RuntimeCellManifest(
        cell_id="desktop-linux-native",
        gate_id="synthetic-native-gate",
        run_id="run-1",
        state=RuntimeCellState.LEASED,
        platform=CellPlatformIdentity(
            os="linux",
            host_distribution="Ubuntu 20.04",
            host_kernel="5.4.0",
            isolation_kind="container",
            image_digest=digest,
            distribution="Ubuntu 22.04",
            architecture="x86_64",
            webview_backend="WebKitGTK",
            webview_version="2.44.0",
        ),
        transport=CellTransportIdentity(
            kind="ssh",
            host_identity_sha256=digest,
            host_key_sha256=digest,
            webdriver_local_port=4445,
            webdriver_remote_port=4445,
        ),
        display=CellDisplayIdentity(
            session_type="x11",
            display_id="display-1",
            seat="container",
            width=1920,
            height=1080,
            connected_output=True,
            desktop_user_identity_sha256=digest,
        ),
        source=CellSourceIdentity(
            mode="git-object-sync",
            commit="abc123",
            workspace_digest="clean",
            remote_source_digest=digest,
            remote_checkout_clean=True,
            binary_sha256=digest,
        ),
        native_adapter=CellAdapterIdentity(
            input_backend="x11-xtest",
            window_backend="x11-ewmh",
            screenshot_backend="webkitgtk-and-desktop",
            input_probe=True,
            focus_probe=True,
            point_ownership_probe=True,
            screenshot_probe=True,
        ),
        lease_owner_run_id="run-1",
        lease_expires_at="2026-08-24T05:00:00+00:00",
        cleanup_registered=True,
        cleanup_resources=("ssh-tunnel", "processes", "ports"),
    )


class RuntimeCellManifestTests(unittest.TestCase):
    def test_ready_manifest_matches_contract(self) -> None:
        contract = RuntimeCellContract.from_dict(_valid_linux_contract())
        manifest = _ready_manifest()
        self.assertTrue(manifest.is_ready_for_gate(contract))
        self.assertEqual(manifest.to_dict()["source"]["commit"], "abc123")
        self.assertTrue(
            manifest.to_dict()["nativeAdapter"]["inputProbe"]
        )

    def test_missing_image_digest_fails(self) -> None:
        from dataclasses import replace

        contract = RuntimeCellContract.from_dict(_valid_linux_contract())
        manifest = _ready_manifest()
        platform = replace(manifest.platform, image_digest="")
        with self.assertRaises(ProvisioningError):
            replace(manifest, platform=platform).validate(contract)

    def test_dirty_remote_checkout_fails(self) -> None:
        from dataclasses import replace

        contract = RuntimeCellContract.from_dict(_valid_linux_contract())
        manifest = _ready_manifest()
        source = replace(manifest.source, remote_checkout_clean=False)
        with self.assertRaises(ProvisioningError):
            replace(manifest, source=source).validate(contract)

    def test_incomplete_native_probes_fail(self) -> None:
        from dataclasses import replace

        contract = RuntimeCellContract.from_dict(_valid_linux_contract())
        manifest = _ready_manifest()
        for field in (
            "input_probe",
            "focus_probe",
            "point_ownership_probe",
            "screenshot_probe",
        ):
            with self.subTest(field=field):
                adapter = replace(
                    manifest.native_adapter,
                    **{field: False},
                )
                with self.assertRaises(ProvisioningError):
                    replace(manifest, native_adapter=adapter).validate(contract)


class RequiredRuntimeCellsTests(unittest.TestCase):
    def test_required_runtime_cells_parse_fail_closed(self) -> None:
        required = (
            "desktop-macos-native",
            "desktop-linux-native",
            "desktop-windows-native",
        )
        self.assertEqual(
            parse_required_runtime_cells("g", list(required)),
            required,
        )
        self.assertEqual(parse_required_runtime_cells("g", None), ())
        for invalid in (
            "desktop-linux-native",
            ["desktop-linux-native", "desktop-linux-native"],
            ["not a slug"],
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ProvisioningError):
                    parse_required_runtime_cells("g", invalid)


if __name__ == "__main__":
    unittest.main()
