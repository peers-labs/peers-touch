#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core.errors import ProvisioningError
from tooling.acceptance.provisioners.native_desktop_linux import (
    NativeDesktopLinuxProvisioner,
)


def _provisioner(cell_id: str) -> NativeDesktopLinuxProvisioner:
    if cell_id != "desktop-linux-native":
        raise ProvisioningError(
            f"runtime-cell lifecycle is not implemented for {cell_id!r}"
        )
    return NativeDesktopLinuxProvisioner()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Manage one Native Desktop Acceptance runtime cell"
    )
    parser.add_argument(
        "action",
        choices=("ready", "status", "logs", "stop"),
    )
    parser.add_argument("--cell", required=True)
    parser.add_argument("--gate", default="runtime-cell-preflight")
    parser.add_argument("--tail", type=int, default=200)
    args = parser.parse_args()

    try:
        provisioner = _provisioner(args.cell)
        if args.action == "ready":
            payload: object = provisioner.ready(args.gate).to_dict()
        elif args.action == "status":
            payload = provisioner.status()
        elif args.action == "logs":
            sys.stdout.write(provisioner.logs(args.tail))
            return 0
        else:
            payload = provisioner.stop()
    except (OSError, ValueError, ProvisioningError) as error:
        sys.stderr.write(f"[ERROR] runtime-cell {args.action} failed: {error}\n")
        return 1

    sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
