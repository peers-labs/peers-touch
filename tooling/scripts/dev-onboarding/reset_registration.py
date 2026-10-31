#!/usr/bin/env python3
"""Remove one onboarding clone's machine-dev registration.

The machine control plane keeps a shared registry across clones. Project
reset must delete only the acceptance clone's registration and its workspace
state, preserving unrelated registrations on a shared host.

Usage: reset_registration.py <canonical-root>

Exit code:
  0 when no registrations remain (or the registry is absent),
  1 when other registrations still exist.
"""

import json
import os
import pathlib
import shutil
import sys


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write("usage: reset_registration.py <canonical-root>\n")
        return 2

    target_root = os.path.realpath(sys.argv[1])
    dev = pathlib.Path.home() / ".peers-touch" / "dev"
    registry = dev / "registry.json"

    if not registry.exists():
        return 0

    data = json.loads(registry.read_text())
    registrations = data.get("registrations", [])
    removed = [
        reg for reg in registrations
        if os.path.realpath(reg.get("canonicalRoot", "")) == target_root
    ]
    data["registrations"] = [
        reg for reg in registrations if reg not in removed
    ]
    registry.write_text(json.dumps(data, indent=2) + "\n")

    for reg in removed:
        workspace_id = reg.get("workspaceId", "")
        workspace = dev / "workspaces" / workspace_id
        if workspace.parent == dev / "workspaces" and workspace.exists():
            shutil.rmtree(workspace)
            sys.stderr.write(f"removed workspace {workspace}\n")

    sys.stderr.write(f"removed {len(removed)} registration(s)\n")
    return 0 if not data["registrations"] else 1


if __name__ == "__main__":
    sys.exit(main())
