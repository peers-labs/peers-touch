#!/usr/bin/env python3
"""Prove the packaged macOS Desktop status-item lifecycle."""

from __future__ import annotations

import hashlib
import json
import os
import struct
import zlib
from pathlib import Path
from typing import Any, Mapping

from tooling.acceptance.core import (
    AcceptanceGate,
    EphemeralGateClient,
    GateError,
    REPORTS_DIR,
    load_runtime_manifest,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
GATE_ID = "desktop-shell-tray-e2e"
ENVIRONMENT_ID = "desktop-shell-native"
RUNTIME_CELL = "desktop-macos-native"
CAPABILITY_ID = "desktop.shell.status-item"
STATUS_HELP = "Peers Touch"
SHOW_MENU_ITEM = "Show Peers Touch"
ASSET_PATH = (
    REPO_ROOT
    / "apps"
    / "desktop"
    / "src-tauri"
    / "icons"
    / "tray-icon-macos.png"
)
TRAY_SOURCE_PATH = (
    REPO_ROOT
    / "apps"
    / "desktop"
    / "src-tauri"
    / "src"
    / "application"
    / "tray"
    / "mod.rs"
)
REPORT_PATH = REPORTS_DIR / f"{GATE_ID}.json"
EVIDENCE_DIR = REPORTS_DIR / "evidence" / GATE_ID


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_rgba_png(path: Path) -> dict[str, object]:
    content = path.read_bytes()
    if content[:8] != b"\x89PNG\r\n\x1a\n":
        raise GateError("macOS tray asset is not a PNG")
    offset = 8
    width = height = bit_depth = color_type = 0
    compressed = bytearray()
    while offset < len(content):
        if offset + 12 > len(content):
            raise GateError("macOS tray PNG is truncated")
        length = struct.unpack(">I", content[offset : offset + 4])[0]
        chunk_type = content[offset + 4 : offset + 8]
        chunk_data = content[offset + 8 : offset + 8 + length]
        offset += 12 + length
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(
                ">IIBB",
                chunk_data[:10],
            )
        elif chunk_type == b"IDAT":
            compressed.extend(chunk_data)
        elif chunk_type == b"IEND":
            break
    if (
        width <= 0
        or height <= 0
        or bit_depth != 8
        or color_type != 6
    ):
        raise GateError(
            "macOS tray PNG must be 8-bit RGBA"
        )
    raw = zlib.decompress(bytes(compressed))
    stride = width * 4
    expected = height * (stride + 1)
    if len(raw) != expected:
        raise GateError("macOS tray PNG scanline length is invalid")
    previous = bytearray(stride)
    alpha: list[int] = []
    cursor = 0
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        encoded = raw[cursor : cursor + stride]
        cursor += stride
        decoded = bytearray(stride)
        for index, value in enumerate(encoded):
            left = decoded[index - 4] if index >= 4 else 0
            up = previous[index]
            upper_left = previous[index - 4] if index >= 4 else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = up
            elif filter_type == 3:
                predictor = (left + up) // 2
            elif filter_type == 4:
                estimate = left + up - upper_left
                left_distance = abs(estimate - left)
                up_distance = abs(estimate - up)
                upper_left_distance = abs(estimate - upper_left)
                predictor = (
                    left
                    if left_distance <= up_distance
                    and left_distance <= upper_left_distance
                    else up
                    if up_distance <= upper_left_distance
                    else upper_left
                )
            else:
                raise GateError(
                    f"macOS tray PNG uses unknown filter {filter_type}"
                )
            decoded[index] = (value + predictor) & 0xFF
        alpha.extend(decoded[3::4])
        previous = decoded
    return {
        "width": width,
        "height": height,
        "sha256": hashlib.sha256(content).hexdigest(),
        "transparent": any(value == 0 for value in alpha),
        "opaque": any(value == 255 for value in alpha),
        "antialiased": any(0 < value < 255 for value in alpha),
    }


class DesktopShellTrayGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "DSTR-J01"
    bom = ("DSTR-01-SOURCE", "DSTR-02-FUNCTIONAL", "DSTR-03-FORMAL")
    spec = ("DSTR-A01", "DSTR-A02", "DSTR-A03", "DSTR-A04", "DSTR-A05", "DSTR-A06")
    report_path = REPORT_PATH
    evidence_dir = EVIDENCE_DIR

    def __init__(self) -> None:
        super().__init__()
        manifest_path = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_MANIFEST",
            "",
        ).strip()
        cell_manifest_path = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_CELL_MANIFEST",
            "",
        ).strip()
        if not manifest_path or not cell_manifest_path:
            raise GateError(
                "Desktop shell tray proof requires environment and runtime-cell manifests"
            )
        self.manifest = load_runtime_manifest(
            Path(manifest_path),
            self.gate_id,
        )
        self.cell_manifest = json.loads(
            Path(cell_manifest_path).read_text(encoding="utf-8")
        )
        self.client = EphemeralGateClient.from_environment()
        if self.client is None:
            raise GateError(
                "Desktop shell status-item capability is unavailable"
            )
        self.report.manifest = self.manifest

    def _invoke(self, operation: str) -> dict[str, Any]:
        response = self.client.invoke(
            CAPABILITY_ID,
            operation,
            {},
            timeout_seconds=60.0,
        )
        if not isinstance(response, Mapping):
            raise GateError(
                f"Desktop shell operation {operation!r} returned invalid data"
            )
        return dict(response)

    def run(self) -> dict[str, Any]:
        source = self.manifest.get("source")
        cell_source = self.cell_manifest.get("source")
        self.assert_condition(
            "environment_identity",
            self.manifest.get("environmentId") == ENVIRONMENT_ID
            and self.manifest.get("state") == "FIXTURE_READY",
        )
        self.assert_condition(
            "runtime_cell_identity",
            self.cell_manifest.get("cellId") == RUNTIME_CELL
            and self.cell_manifest.get("gateId") == self.gate_id
            and self.cell_manifest.get("state") == "LEASED",
        )
        self.assert_condition(
            "exact_clean_source",
            isinstance(source, dict)
            and isinstance(cell_source, dict)
            and source.get("workspaceDigest") == "clean"
            and cell_source.get("workspaceDigest") == "clean"
            and source.get("commit") == cell_source.get("commit"),
        )

        asset = inspect_rgba_png(ASSET_PATH)
        self.assert_condition(
            "retina_template_asset",
            asset["width"] == 88
            and asset["height"] == 36
            and asset["transparent"] is True
            and asset["opaque"] is True
            and asset["antialiased"] is True,
            json.dumps(asset, sort_keys=True),
        )
        tray_source = TRAY_SOURCE_PATH.read_text(encoding="utf-8")
        for source_contract in (
            "MACOS_TRAY_ICON_PNG",
            ".icon_as_template(true)",
            ".show_menu_on_left_click(false)",
            "restore_main_window",
        ):
            self.assert_condition(
                f"source_contract_{source_contract}",
                source_contract in tray_source,
            )

        initial = self._invoke("inspect")
        package = initial.get("package")
        status_item = initial.get("statusItem")
        window = initial.get("window")
        self.assert_condition(
            "packaged_binary_identity",
            isinstance(package, dict)
            and package.get("assetSha256") == asset["sha256"]
            and package.get("assetEmbedded") is True
            and initial.get("processExecutableSha256")
            == package.get("binarySha256")
            and isinstance(cell_source.get("binarySha256"), str)
            and len(cell_source["binarySha256"]) == 64,
        )
        self.assert_condition(
            "native_status_item_geometry",
            isinstance(status_item, dict)
            and status_item.get("role") == "AXMenuBarItem"
            and status_item.get("subrole") == "AXMenuExtra"
            and status_item.get("help") == STATUS_HELP
            and status_item.get("size")
            == {"width": 62.0, "height": 24.0},
            json.dumps(status_item, sort_keys=True),
        )
        self.assert_condition(
            "native_status_item_menu",
            isinstance(status_item, dict)
            and SHOW_MENU_ITEM in status_item.get("menuItems", [])
            and "Quit" in status_item.get("menuItems", []),
        )
        self.assert_condition(
            "initial_window_visible",
            initial.get("processAlive") is True
            and isinstance(window, dict)
            and int(window.get("windowCount", 0)) > 0,
        )

        hidden = self._invoke("hide-main-window")
        hidden_status = hidden.get("statusItem")
        hidden_window = hidden.get("window")
        self.assert_condition(
            "close_hides_without_exit",
            hidden.get("processAlive") is True
            and isinstance(hidden_window, dict)
            and hidden_window.get("windowCount") == 0
            and hidden_status == status_item,
        )

        restored = self._invoke("show-main-window")
        restored_window = restored.get("window")
        self.assert_condition(
            "status_item_restores_focused_window",
            restored.get("processAlive") is True
            and isinstance(restored_window, dict)
            and int(restored_window.get("windowCount", 0)) > 0
            and restored_window.get("frontmost") is True
            and restored_window.get("mainWindow") is True
            and restored_window.get("focusedWindow") is True,
            json.dumps(restored_window, sort_keys=True),
        )

        screenshot = self._invoke("capture-screenshot")
        self.assert_condition(
            "native_screenshot_supporting_evidence",
            isinstance(screenshot.get("artifact"), dict)
            and int(screenshot.get("byteLength", 0)) > 0,
        )
        return {
            "runtimeCell": RUNTIME_CELL,
            "sourceCommit": source["commit"],
            "asset": asset,
            "package": package,
            "statusItem": status_item,
            "hiddenWindow": hidden_window,
            "restoredWindow": restored_window,
            "evidence": {
                "nativeScreenshot": screenshot["artifact"],
            },
        }


if __name__ == "__main__":
    raise SystemExit(DesktopShellTrayGate().execute())
