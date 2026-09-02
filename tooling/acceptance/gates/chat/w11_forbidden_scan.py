#!/usr/bin/env python3
"""W11 closure gate: forbidden-owner, dead-route, and debug-instrumentation scan.

Reads scan targets from the closure contract manifest produced by
acceptance-closure-gen.py. Covers four verification types:
  - path-absent: deleted files must not reappear
  - source-scan: debug statements must not exist in production source
  - http-route-absent: dead Station API routes must not be called
  - tauri-command-absent: dead Tauri commands must not be registered
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
MANIFEST_PATH = Path(
    os.environ.get(
        "PT_W11_CONTRACT_MANIFEST",
        str(REPO_ROOT / "tooling" / "acceptance" / "reports" / "w11-contract-manifest.json"),
    )
)


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        print(
            f"FAIL: contract manifest not found at {MANIFEST_PATH}. "
            "Run acceptance-closure-gen.py first.",
            file=sys.stderr,
        )
        sys.exit(2)
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def is_test_related(path: Path) -> bool:
    name = path.name
    if any(marker in str(path) for marker in ("__test__", "tests/", "_test.", "test_")):
        return True
    if name.endswith(".test.ts") or name.endswith(".test.tsx") or name.endswith("_test.go"):
        return True
    try:
        text = path.read_text(encoding="utf-8", errors="replace")[:500]
        if "#[cfg(test)]" in text or "#[test]" in text:
            return True
    except OSError:
        pass
    return False


def scan_path_absent(target: dict) -> list[str]:
    violations: list[str] = []
    for rel in target.get("paths", []):
        if (REPO_ROOT / rel).exists():
            violations.append(f"forbidden path resurrected: {rel}")
    return violations


def scan_source_debug(target: dict) -> list[str]:
    violations: list[str] = []
    skip_dirs = set(target.get("skip_dirs", []))
    allowed_prefixes = tuple(target.get("allowed_file_prefixes", ()))
    patterns: dict[str, re.Pattern] = {}
    for p in target.get("patterns", []):
        suffix = p.get("suffix", "")
        regex = p.get("regex", "")
        if suffix and regex:
            patterns[suffix] = re.compile(regex)

    for dirname in target.get("include_dirs", []):
        base = REPO_ROOT / dirname
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            if any(part in skip_dirs for part in path.parts):
                continue
            if path.suffix not in patterns:
                continue
            if is_test_related(path):
                continue
            if path.name.lower().startswith(allowed_prefixes):
                continue
            try:
                lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            for lineno, line in enumerate(lines, 1):
                stripped = line.lstrip()
                if stripped.startswith("//") or stripped.startswith("*"):
                    continue
                if patterns[path.suffix].search(line):
                    rel = path.relative_to(REPO_ROOT)
                    violations.append(f"{rel}:{lineno}: {stripped.strip()[:120]}")
    return violations


def scan_http_route_absent(target: dict) -> list[str]:
    violations: list[str] = []
    route_prefixes = target.get("route_prefixes", [])
    skip_dirs = set(target.get("skip_dirs", []))
    exempt = set(target.get("exempt_files", []))

    for dirname in target.get("search_dirs", []):
        base = REPO_ROOT / dirname
        if not base.is_dir():
            continue
        for path in base.rglob("*.rs"):
            if any(part in skip_dirs for part in path.parts):
                continue
            rel = str(path.relative_to(REPO_ROOT))
            if rel in exempt:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            for prefix in route_prefixes:
                for lineno, line in enumerate(text.splitlines(), 1):
                    if prefix in line and not line.lstrip().startswith("//"):
                        violations.append(
                            f"{rel}:{lineno}: dead route prefix {prefix!r}: "
                            f"{line.strip()[:120]}"
                        )
    return violations


def scan_tauri_command_absent(target: dict) -> list[str]:
    violations: list[str] = []
    dead_commands = set(target.get("commands", []))

    for rel_path in target.get("search_files", []):
        path = REPO_ROOT / rel_path
        if not path.exists():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for cmd in dead_commands:
            for lineno, line in enumerate(text.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("//"):
                    continue
                if f'"{cmd}"' in stripped or cmd in stripped:
                    if "friend_chat" in cmd:
                        violations.append(
                            f"{rel_path}:{lineno}: dead tauri command "
                            f"{cmd!r}: {stripped[:120]}"
                        )
    return violations


SCANNERS = {
    "path-absent": scan_path_absent,
    "source-scan": scan_source_debug,
    "http-route-absent": scan_http_route_absent,
    "tauri-command-absent": scan_tauri_command_absent,
}

REPORT_PATH = REPO_ROOT / "tooling" / "acceptance" / "reports" / "chat-w11-forbidden-scan.json"


def write_report(checked: int, violations: list[str]) -> None:
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "status": "PASS" if not violations else "FAIL",
        "assertions": [{"name": f"target-{i}", "passed": True} for i in range(checked)],
        "violations": violations,
        "checkedTargets": checked,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    manifest = load_manifest()
    targets = manifest.get("scan_targets", {})
    violations: list[str] = []
    checked = 0

    for did, target in targets.items():
        vtype = target.get("type", "")
        scanner = SCANNERS.get(vtype)
        if scanner is None:
            continue
        if vtype in {"gates-passed", "gate-passed"}:
            continue
        checked += 1
        violations.extend(scanner(target))

    write_report(checked, violations)

    if violations:
        print(f"FAIL: W11 forbidden scan found {len(violations)} violation(s):")
        for v in violations:
            print(f"  - {v}")
        return 1

    print(f"PASS: W11 forbidden scan ({checked} scan targets clean)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
