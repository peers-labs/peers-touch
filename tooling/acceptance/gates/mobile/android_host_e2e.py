from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path

from .unified_host_suite import UnifiedHostSuiteGate, host_prerequisite_diagnostic


GATE_ID = "unified-client-android-host-e2e"


def runtime_blockers(
    environment: Mapping[str, str],
    *,
    adb_path: str | None,
    adb_devices: str,
    inventory_evaluated: bool = True,
) -> list[str]:
    blockers: list[str] = []
    if not adb_path:
        blockers.append("android-sdk-unavailable")
    physical_devices = [
        line
        for line in adb_devices.splitlines()
        if "\tdevice" in line and "emulator-" not in line
    ]
    if not inventory_evaluated:
        blockers.append("physical-android-device-inventory-not-evaluated")
    elif not physical_devices:
        blockers.append("physical-android-device-unavailable")
    if not environment.get("PT_ANDROID_FCM_PROVIDER_CONFIG", "").strip():
        blockers.append("fcm-provider-config-unavailable")
    if not environment.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip():
        blockers.append("dedicated-suite-runtime-unavailable")
    return blockers


def _adb_devices(adb_path: str | None) -> tuple[str, bool]:
    if not adb_path:
        return "", False
    try:
        completed = subprocess.run(
            [adb_path, "devices", "-l"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return "", False
    return (completed.stdout, True) if completed.returncode == 0 else ("", False)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reuse-suite-runtime", action="store_true")
    parser.add_argument("--runtime-evidence", type=Path)
    arguments = parser.parse_args(argv)
    adb_path = shutil.which("adb")
    inventory, inventory_evaluated = _adb_devices(adb_path)
    blockers = runtime_blockers(
        os.environ,
        adb_path=adb_path,
        adb_devices=inventory,
        inventory_evaluated=inventory_evaluated,
    )
    return UnifiedHostSuiteGate(
        platform="android",
        reuse_suite_runtime=arguments.reuse_suite_runtime,
        runtime_evidence=arguments.runtime_evidence,
        blockers=blockers,
        diagnostic=host_prerequisite_diagnostic(
            platform="android",
            tool_path=adb_path,
            physical_device_count=sum(
                "\tdevice" in line and "emulator-" not in line
                for line in inventory.splitlines()
            ),
            inventory_evaluated=inventory_evaluated,
            environment=dict(os.environ),
        ),
    ).execute()


if __name__ == "__main__":
    raise SystemExit(main())
