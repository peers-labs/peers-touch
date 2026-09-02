#!/usr/bin/env python3
"""W11 closure gate: single-owner duplicate-contract scan.

Reads scan targets from the closure contract manifest. Verifies that
crypto, codec, and protocol algorithms have exactly one implementation
owner. App adapters may re-export or wrap for error-type adaptation, but
must not re-implement primitives.
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


def is_test_file(path: Path, text: str) -> bool:
    name = path.name
    if name.endswith("_test.rs") or "#[cfg(test)]" in text[:500]:
        return True
    if "tests" in path.parts:
        return True
    return False


def find_target(manifest: dict, vtype: str) -> dict | None:
    for target in manifest.get("scan_targets", {}).values():
        if target.get("type") == vtype:
            return target
    return None


def scan_duplicate_implementations(target: dict) -> list[str]:
    violations: list[str] = []
    skip_dirs = set(target.get("skip_dirs", []))
    functions = target.get("functions", [])
    types = target.get("types", [])

    for app_dir in target.get("check_dirs", []):
        base = REPO_ROOT / app_dir
        if not base.is_dir():
            continue
        for path in base.rglob("*.rs"):
            if any(part in skip_dirs for part in path.parts):
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if is_test_file(path, text):
                continue

            for signature in functions:
                if signature in text:
                    rel = path.relative_to(REPO_ROOT)
                    violations.append(
                        f"{rel}: re-implements core algorithm `{signature}`; "
                        f"delegate to messaging-core instead"
                    )

            for typedef in types:
                if typedef in text:
                    rel = path.relative_to(REPO_ROOT)
                    violations.append(
                        f"{rel}: duplicates core type `{typedef}`; "
                        f"use `pub use messaging_core::...` re-export instead"
                    )
    return violations


def scan_codec_duplicates(target: dict) -> list[str]:
    violations: list[str] = []
    skip_dirs = set(target.get("skip_dirs", []))
    duplicate_structs = target.get("duplicate_struct_check", [])

    search_dirs = [*target.get("check_dirs", []), target.get("owner_dir", "")]
    owners: dict[str, list[Path]] = {s: [] for s in duplicate_structs}

    for dirname in search_dirs:
        if not dirname:
            continue
        base = REPO_ROOT / dirname
        if not base.is_dir():
            continue
        for path in base.rglob("*.rs"):
            if any(part in skip_dirs for part in path.parts):
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if is_test_file(path, text):
                continue
            for struct_name in duplicate_structs:
                if f"struct {struct_name}" in text or f"enum {struct_name}" in text:
                    owners[struct_name].append(path)

    for struct_name, paths in owners.items():
        if len(paths) > 1:
            for owner in paths:
                rel = owner.relative_to(REPO_ROOT)
                violations.append(
                    f"{rel}: {struct_name} defined in multiple locations; "
                    f"must have a single owner"
                )
    return violations


def main() -> int:
    manifest = load_manifest()
    target = find_target(manifest, "no-duplicate-symbol")
    report_path = REPO_ROOT / "tooling" / "acceptance" / "reports" / "chat-w11-duplicate-scan.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)

    if target is None:
        report = {"status": "PASS", "assertions": [{"name": "no-duplicate-target", "passed": True}], "violations": []}
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print("PASS: W11 duplicate-scan (no no-duplicate-symbol target in contract)")
        return 0

    violations: list[str] = []
    violations.extend(scan_duplicate_implementations(target))
    violations.extend(scan_codec_duplicates(target))

    report = {
        "status": "PASS" if not violations else "FAIL",
        "assertions": [{"name": "single-crypto-codec-owner", "passed": not violations}],
        "violations": violations,
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if violations:
        print("FAIL: W11 duplicate-contract scan found violations:")
        for v in violations:
            print(f"  - {v}")
        return 1

    print("PASS: W11 duplicate-contract scan (single crypto/codec owner verified)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
