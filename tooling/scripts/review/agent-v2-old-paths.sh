#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
fixture="$repo_root/tooling/acceptance/fixtures/agent_v2_old_paths.json"
mode="closure"
closures=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --inventory-only)
      mode="inventory"
      shift
      ;;
    --closure)
      closures="${2:?missing closure list}"
      shift 2
      ;;
    --fixture)
      fixture="${2:?missing fixture path}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: agent-v2-old-paths.sh [--inventory-only] [--closure C01,C02] [--fixture path]"
      exit 0
      ;;
    *)
      echo "agent-v2-old-paths: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$mode" == "closure" && -z "$closures" ]]; then
  echo "agent-v2-old-paths: --closure is required outside inventory mode" >&2
  exit 2
fi

python3 - "$repo_root" "$fixture" "$mode" "$closures" <<'PY'
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


root = Path(sys.argv[1])
fixture_path = Path(sys.argv[2])
mode = sys.argv[3]
requested = {value for value in sys.argv[4].split(",") if value}

try:
    contract = json.loads(fixture_path.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as error:
    raise SystemExit(f"agent-v2-old-paths: invalid fixture: {error}")

if contract.get("schema") != "agent-v2-old-paths/v1":
    raise SystemExit("agent-v2-old-paths: unsupported fixture schema")
allowed = set(contract.get("allowed_dispositions", []))
entries = contract.get("entries")
if not isinstance(entries, list) or not entries:
    raise SystemExit("agent-v2-old-paths: fixture entries are required")
discovery = contract.get("discovery")
if not isinstance(discovery, dict):
    raise SystemExit("agent-v2-old-paths: discovery contract is required")
discovery_pattern = discovery.get("pattern")
discovery_paths = discovery.get("paths")
if not isinstance(discovery_pattern, str) or not discovery_pattern:
    raise SystemExit("agent-v2-old-paths: discovery pattern is required")
if not isinstance(discovery_paths, list) or not discovery_paths:
    raise SystemExit("agent-v2-old-paths: discovery paths are required")

seen_ids: set[str] = set()
known_closures: set[str] = set()
unresolved: list[str] = []
inventory: list[dict[str, object]] = []
covered_matches: set[str] = set()

for entry in entries:
    if not isinstance(entry, dict):
        raise SystemExit("agent-v2-old-paths: entry must be an object")
    entry_id = entry.get("id")
    disposition = entry.get("disposition")
    pattern = entry.get("pattern")
    paths = entry.get("paths")
    closures = entry.get("closures")
    if not isinstance(entry_id, str) or not entry_id or entry_id in seen_ids:
        raise SystemExit(f"agent-v2-old-paths: invalid or duplicate id {entry_id!r}")
    seen_ids.add(entry_id)
    if disposition not in allowed:
        raise SystemExit(
            f"agent-v2-old-paths: {entry_id} has invalid disposition "
            f"{disposition!r}"
        )
    if not isinstance(pattern, str) or not pattern:
        raise SystemExit(f"agent-v2-old-paths: {entry_id} pattern is required")
    try:
        re.compile(pattern)
    except re.error as error:
        raise SystemExit(
            f"agent-v2-old-paths: {entry_id} pattern is invalid: {error}"
        )
    if not isinstance(paths, list) or not paths or not all(
        isinstance(path, str) and path for path in paths
    ):
        raise SystemExit(f"agent-v2-old-paths: {entry_id} paths are required")
    if not isinstance(closures, list) or not closures or not all(
        isinstance(closure, str) and closure for closure in closures
    ):
        raise SystemExit(
            f"agent-v2-old-paths: {entry_id} closures are required"
        )
    known_closures.update(closures)
    existing_paths = [path for path in paths if (root / path).exists()]
    completed = subprocess.run(
        [
            "rg",
            "-n",
            "--no-heading",
            "--with-filename",
            pattern,
            *existing_paths,
        ],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    ) if existing_paths else None
    if completed is not None and completed.returncode not in {0, 1}:
        raise SystemExit(
            f"agent-v2-old-paths: rg failed for {entry_id}: "
            f"{completed.stderr.strip()}"
        )
    matches = (
        [line for line in completed.stdout.splitlines() if line]
        if completed is not None and completed.returncode == 0
        else []
    )
    covered_matches.update(matches)
    inventory.append(
        {
            "id": entry_id,
            "closures": closures,
            "disposition": disposition,
            "matches": len(matches),
        }
    )
    if (
        mode == "closure"
        and requested.intersection(closures)
        and disposition == "deleted-authority"
        and matches
    ):
        unresolved.extend(f"{entry_id}: {line}" for line in matches)

existing_discovery_paths = [
    path for path in discovery_paths if (root / path).exists()
]
discovered = subprocess.run(
    [
        "rg",
        "-n",
        "--no-heading",
        "--with-filename",
        discovery_pattern,
        *existing_discovery_paths,
    ],
    cwd=root,
    text=True,
    capture_output=True,
    check=False,
) if existing_discovery_paths else None
if discovered is not None and discovered.returncode not in {0, 1}:
    raise SystemExit(
        "agent-v2-old-paths: discovery scan failed: "
        + discovered.stderr.strip()
    )
discovery_matches = (
    {line for line in discovered.stdout.splitlines() if line}
    if discovered is not None and discovered.returncode == 0
    else set()
)
unregistered_matches = sorted(discovery_matches - covered_matches)
unresolved.extend(
    f"unregistered-legacy-path: {line}" for line in unregistered_matches
)

unknown_closures = requested - known_closures
if unknown_closures:
    raise SystemExit(
        "agent-v2-old-paths: unknown closures: "
        + ", ".join(sorted(unknown_closures))
    )

print(
    json.dumps(
        {
            "artifactKind": "agent-v2-old-path-inventory",
            "mode": mode,
            "requestedClosures": sorted(requested),
            "entries": inventory,
            "discoveredMatches": len(discovery_matches),
            "unregisteredMatches": len(unregistered_matches),
            "unresolvedCount": len(unresolved),
        },
        sort_keys=True,
    )
)
if unresolved:
    print("\n".join(unresolved), file=sys.stderr)
    raise SystemExit(1)
PY
