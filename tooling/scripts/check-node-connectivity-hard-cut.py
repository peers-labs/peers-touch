#!/usr/bin/env python3
"""Reject retired Node Connectivity data-plane contracts and implementations."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SEARCH_ROOTS = (
    "model/domain",
    "apps/station/frame/core/plugin/native",
    "apps/station/frame/touch/actor",
    "apps/station/frame/touch/federation",
    "apps/desktop/src-tauri/src",
    "apps/mobile/src-tauri/src",
)
RETIRED_PATHS = (
    "apps/station/frame/core/plugin/native/subserver/relay-client",
    "model/domain/federation/relay_transport.proto",
)
RETIRED_MARKERS = (
    "inbox_relay_mounts",
    "InboxRelayMounts",
    "inboxRelayMounts",
    "opaque Relay tunnel",
    "scoped opaque Relay tunnel",
    "/relay/forward",
    "StreamManager",
    "streamHandshake",
    "relay-client-token",
)
IGNORED_PARTS = frozenset({".git", "node_modules", "target", "__pycache__"})


def violations(root: Path) -> list[str]:
    found: list[str] = []
    for relative in RETIRED_PATHS:
        path = root / relative
        if path.is_file() or (path.is_dir() and any(item.is_file() for item in path.rglob("*"))):
            found.append(f"retired path remains: {relative}")
    for relative in SEARCH_ROOTS:
        search_root = root / relative
        if not search_root.exists():
            continue
        for path in sorted(item for item in search_root.rglob("*") if item.is_file()):
            if any(part in IGNORED_PARTS for part in path.parts):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for marker in RETIRED_MARKERS:
                if marker in text:
                    found.append(
                        f"retired marker {marker!r}: {path.relative_to(root)}"
                    )
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=REPO_ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    found = violations(root)
    if found:
        print("\n".join(found), file=sys.stderr)
        return 1
    print("NODE_CONNECTIVITY_HARD_CUT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
