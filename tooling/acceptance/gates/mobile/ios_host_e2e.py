from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path

from .unified_host_suite import UnifiedHostSuiteGate


GATE_ID = "unified-client-ios-host-e2e"


def runtime_blockers(
    environment: Mapping[str, str],
    *,
    devicectl_path: str | None,
    device_inventory: str,
) -> list[str]:
    blockers: list[str] = []
    if not devicectl_path:
        blockers.append("xcode-devicectl-unavailable")
    if not any(
        re.search(r"\bphysical\b", line) and re.search(r"\bavailable\b", line)
        for line in device_inventory.splitlines()
    ):
        blockers.append("physical-ios-device-unavailable")
    if not environment.get("PT_IOS_APNS_PROVIDER_CONFIG", "").strip():
        blockers.append("apns-provider-config-unavailable")
    if not environment.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip():
        blockers.append("dedicated-suite-runtime-unavailable")
    return blockers


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reuse-suite-runtime", action="store_true")
    parser.add_argument("--runtime-evidence", type=Path)
    arguments = parser.parse_args(argv)
    xcrun = shutil.which("xcrun")
    devicectl_path = xcrun
    inventory = ""
    if xcrun:
        completed = subprocess.run(
            [xcrun, "devicectl", "list", "devices"],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
        if completed.returncode == 0:
            inventory = completed.stdout
        else:
            devicectl_path = None
    blockers = runtime_blockers(
        os.environ,
        devicectl_path=devicectl_path,
        device_inventory=inventory,
    )
    return UnifiedHostSuiteGate(
        platform="ios",
        reuse_suite_runtime=arguments.reuse_suite_runtime,
        runtime_evidence=arguments.runtime_evidence,
        blockers=blockers,
    ).execute()


if __name__ == "__main__":
    raise SystemExit(main())
