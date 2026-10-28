#!/usr/bin/env python3
"""Prove the exact-source Linux Desktop user installation lifecycle."""

from __future__ import annotations

import json
import os
import signal
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from tooling.acceptance.core import AcceptanceGate, BlockedError, GateError


REPO_ROOT = Path(__file__).resolve().parents[4]
GATE_ID = "desktop-linux-install-native-e2e"
DEEP_LINK_SCHEME = "peers-touch-dev"
DESKTOP_FILE_NAME = "com.peers.touch.desktop.dev.desktop"


def _git(*args: str) -> str:
    completed = subprocess.run(
        ("git", *args),
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    if completed.returncode != 0:
        raise GateError(
            f"git {' '.join(args)} failed: {completed.stderr.strip()}"
        )
    return completed.stdout.strip()


def install_paths(root: Path) -> dict[str, Path]:
    data_home = root / "share"
    return {
        "data_home": data_home,
        "config_home": root / "config",
        "install_directory": root / "apps",
        "appimage": root / "apps" / "peers-dev.AppImage",
        "receipt": root / "apps" / "peers-dev.source.json",
        "bin_directory": root / "bin",
        "launcher": root / "bin" / "peers-dev",
        "desktop_entry": data_home / "applications" / DESKTOP_FILE_NAME,
        "icon": (
            data_home
            / "icons"
            / "hicolor"
            / "256x256"
            / "apps"
            / "com.peers.touch.desktop.dev.png"
        ),
    }


def inspect_installation(
    paths: dict[str, Path],
    source_commit: str,
) -> dict[str, Any]:
    required = (
        "appimage",
        "receipt",
        "launcher",
        "desktop_entry",
        "icon",
    )
    missing = [name for name in required if not paths[name].is_file()]
    if missing:
        raise GateError(f"Linux Desktop installation is incomplete: {missing}")

    receipt = json.loads(paths["receipt"].read_text(encoding="utf-8"))
    entry = paths["desktop_entry"].read_text(encoding="utf-8")
    launcher = paths["launcher"].read_text(encoding="utf-8")
    appimage_mode = stat.S_IMODE(paths["appimage"].stat().st_mode)
    launcher_mode = stat.S_IMODE(paths["launcher"].stat().st_mode)
    return {
        "sourceCommit": str(receipt.get("sourceCommit") or ""),
        "sourceCommitMatches": receipt.get("sourceCommit") == source_commit,
        "appimageExecutable": bool(appimage_mode & stat.S_IXUSR),
        "launcherExecutable": bool(launcher_mode & stat.S_IXUSR),
        "launcherTargetsAppImage": str(paths["appimage"]) in launcher,
        "desktopEntrySourceMatches": (
            f"X-Peers-Touch-Source-Commit={source_commit}" in entry
        ),
        "desktopEntryRegistersDeepLink": (
            f"MimeType=x-scheme-handler/{DEEP_LINK_SCHEME};" in entry
        ),
        "desktopEntryUsesLauncher": str(paths["launcher"]) in entry,
        "appimageInode": paths["appimage"].stat().st_ino,
        "appimageBytes": paths["appimage"].stat().st_size,
    }


def _terminate_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=10)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)


class LinuxDesktopInstallGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "ADL-01"
    bom = (
        "ADL-01-SOURCE",
        "ADL-01-INSTALL",
        "ADL-01-LAUNCH",
        "ADL-01-CLEANUP",
    )
    spec = (
        "ADL-LINUX-APPIMAGE",
        "ADL-LINUX-XDG",
        "ADL-LINUX-ATOMIC",
        "ADL-LINUX-DEEP-LINK",
    )

    def run(self) -> dict[str, Any]:
        if not sys.platform.startswith("linux"):
            raise BlockedError(
                reason="Linux Desktop install proof requires a Linux host",
                resource="desktop-linux-install:host",
            )
        if not os.environ.get("DISPLAY", "").strip():
            raise BlockedError(
                reason=(
                    "Linux Desktop install proof requires an active graphical "
                    "DISPLAY"
                ),
                resource="desktop-linux-install:display",
            )

        source_commit = _git("rev-parse", "HEAD")
        if len(source_commit) != 40:
            raise GateError("Linux Desktop install proof requires a Git commit")
        source_status = _git("status", "--porcelain=v1", "--untracked-files=no")
        if source_status:
            raise BlockedError(
                reason=(
                    "Linux Desktop install proof requires a clean tracked source "
                    "tree"
                ),
                resource="desktop-linux-install:source",
            )

        with tempfile.TemporaryDirectory(
            prefix="pt-desktop-linux-install-"
        ) as temporary:
            install_root = Path(temporary)
            paths = install_paths(install_root)
            environment = os.environ.copy()
            environment.update(
                {
                    "HOME": str(install_root),
                    "XDG_DATA_HOME": str(paths["data_home"]),
                    "XDG_CONFIG_HOME": str(paths["config_home"]),
                    "PT_DESKTOP_INSTALL_DIR": str(paths["install_directory"]),
                    "PT_DESKTOP_INSTALL_BIN_DIR": str(paths["bin_directory"]),
                    "PT_BUILD_SOURCE_COMMIT": source_commit,
                    "APPIMAGE_EXTRACT_AND_RUN": "1",
                }
            )
            log_path = install_root / "desktop-linux-install.log"
            process: subprocess.Popen[bytes] | None = None
            log_stream = log_path.open("wb")
            try:
                first_install = subprocess.run(
                    ("make", "desktop-install"),
                    cwd=REPO_ROOT,
                    env=environment,
                    text=True,
                    capture_output=True,
                    timeout=3600,
                    check=False,
                )
                log_stream.write(first_install.stdout.encode())
                log_stream.write(first_install.stderr.encode())
                log_stream.flush()
                self.assert_condition(
                    "first_install_succeeded",
                    first_install.returncode == 0,
                    (first_install.stdout + first_install.stderr)[-4000:],
                )

                first = inspect_installation(paths, source_commit)
                for name in (
                    "sourceCommitMatches",
                    "appimageExecutable",
                    "launcherExecutable",
                    "launcherTargetsAppImage",
                    "desktopEntrySourceMatches",
                    "desktopEntryRegistersDeepLink",
                    "desktopEntryUsesLauncher",
                ):
                    self.assert_condition(name, first[name] is True)

                association = subprocess.run(
                    (
                        "xdg-mime",
                        "query",
                        "default",
                        f"x-scheme-handler/{DEEP_LINK_SCHEME}",
                    ),
                    env=environment,
                    text=True,
                    capture_output=True,
                    timeout=30,
                    check=False,
                )
                self.assert_condition(
                    "deep_link_handler_readback",
                    association.returncode == 0
                    and association.stdout.strip() == DESKTOP_FILE_NAME,
                    association.stderr.strip(),
                )

                process = subprocess.Popen(
                    (str(paths["launcher"]),),
                    cwd=install_root,
                    env=environment,
                    stdout=log_stream,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
                time.sleep(5)
                self.assert_condition(
                    "installed_process_running",
                    process.poll() is None,
                )

                second_install = subprocess.run(
                    ("make", "desktop-install"),
                    cwd=REPO_ROOT,
                    env=environment,
                    text=True,
                    capture_output=True,
                    timeout=3600,
                    check=False,
                )
                log_stream.write(second_install.stdout.encode())
                log_stream.write(second_install.stderr.encode())
                log_stream.flush()
                self.assert_condition(
                    "second_install_succeeded",
                    second_install.returncode == 0,
                    (second_install.stdout + second_install.stderr)[-4000:],
                )
                second = inspect_installation(paths, source_commit)
                self.assert_condition(
                    "next_launch_uses_replaced_inode",
                    first["appimageInode"] != second["appimageInode"],
                )
                self.assert_condition(
                    "running_old_inode_survived_replacement",
                    process.poll() is None,
                )

                deep_link = subprocess.run(
                    (
                        "xdg-open",
                        f"{DEEP_LINK_SCHEME}://acceptance/install"
                        f"?source={source_commit}",
                    ),
                    env=environment,
                    text=True,
                    capture_output=True,
                    timeout=30,
                    check=False,
                )
                log_stream.write(deep_link.stdout.encode())
                log_stream.write(deep_link.stderr.encode())
                log_stream.flush()
                self.assert_condition(
                    "deep_link_dispatch_succeeded",
                    deep_link.returncode == 0,
                    deep_link.stderr.strip(),
                )

                for role, path in (
                    ("source-receipt", paths["receipt"]),
                    ("desktop-entry", paths["desktop_entry"]),
                ):
                    self.report.add_evidence_file(role, path)
                return {
                    "sourceCommit": source_commit,
                    "firstInstall": first,
                    "secondInstall": second,
                    "handler": association.stdout.strip(),
                    "temporaryRootIsolated": True,
                }
            finally:
                if process is not None:
                    _terminate_process(process)
                    self.assert_condition(
                        "installed_process_released",
                        process.poll() is not None,
                    )
                log_stream.close()
                if log_path.exists():
                    self.report.add_evidence_file("install-log", log_path)


def main() -> int:
    return LinuxDesktopInstallGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
