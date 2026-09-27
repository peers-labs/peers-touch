#!/usr/bin/env python3
"""Inventory-driven zero-reference proof for Chat storage governance."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

from tooling.acceptance.core import ArtifactSession, REPO_ROOT


FULL_GATE_ID = "chat-storage-zero-legacy-e2e"
TASK_GATE_ID = "chat-storage-dead-contract-zero-e2e"
INVENTORY_PATH = (
    REPO_ROOT
    / "docs"
    / "architecture"
    / "chat-storage-governance"
    / "legacy-inventory.json"
)
EXPECTED_DIMENSIONS: tuple[str, ...] = (
    "production-source",
    "client-command-wrapper",
    "station-route-handler",
    "proto-generated",
    "schema-backfill",
    "test-fixture-mock",
    "acceptance-runner",
    "docs-locales-prototype",
    "build-runtime-registration",
)
TEXT_SUFFIXES = frozenset(
    {
        ".go",
        ".json",
        ".md",
        ".mjs",
        ".proto",
        ".py",
        ".rs",
        ".toml",
        ".ts",
        ".tsx",
        ".yaml",
        ".yml",
    }
)
SKIP_DIRS = frozenset(
    {
        ".git",
        ".next",
        "__pycache__",
        "dist",
        "node_modules",
        "reports",
        "target",
    }
)


@dataclass(frozen=True)
class Violation:
    entry_id: str
    dimension: str
    file: str
    line: int
    pattern: str
    snippet: str


@dataclass
class DimensionResult:
    files_scanned: int = 0
    violations: list[Violation] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.violations


@dataclass
class ScanResult:
    owner_task: str | None
    dimensions: dict[str, DimensionResult]

    @property
    def violations(self) -> list[Violation]:
        return [
            violation
            for dimension in EXPECTED_DIMENSIONS
            for violation in self.dimensions[dimension].violations
        ]

    @property
    def files_scanned(self) -> int:
        return sum(item.files_scanned for item in self.dimensions.values())

    @property
    def passed(self) -> bool:
        return all(item.passed for item in self.dimensions.values())


def _load_inventory(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("Chat storage legacy inventory must be an object")
    return value


def _tracked_paths(repo_root: Path) -> list[str]:
    completed = subprocess.run(
        [
            "git",
            "-C",
            str(repo_root),
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        check=False,
        capture_output=True,
    )
    if completed.returncode == 0:
        return sorted(
            path.decode("utf-8")
            for path in completed.stdout.split(b"\0")
            if path
        )
    return sorted(
        path.relative_to(repo_root).as_posix()
        for path in repo_root.rglob("*")
        if path.is_file()
        and not (SKIP_DIRS & set(path.relative_to(repo_root).parts))
    )


def _under_roots(relative_path: str, roots: Iterable[str]) -> bool:
    return any(
        relative_path == root.rstrip("/")
        or relative_path.startswith(f"{root.rstrip('/')}/")
        for root in roots
    )


def _is_test_or_fixture(relative_path: str) -> bool:
    path = Path(relative_path)
    parts = set(path.parts)
    return (
        "tests" in parts
        or "fixtures" in parts
        or "_test." in path.name
        or ".test." in path.name
        or path.name.startswith("test_")
    )


def _dimension_for(relative_path: str) -> str:
    path = Path(relative_path)
    if _is_test_or_fixture(relative_path):
        return "test-fixture-mock"
    if relative_path.startswith(("tooling/acceptance/", "tooling/scripts/")):
        return "acceptance-runner"
    if relative_path.startswith(
        (
            "docs/",
            "packages/locales/",
            "packages/prototypes/",
        )
    ):
        return "docs-locales-prototype"
    if relative_path.startswith("model/domain/chat/") or (
        relative_path.startswith("apps/station/frame/touch/model/chat/")
        and path.name.endswith((".pb.go", "_pb.ts"))
    ):
        return "proto-generated"
    if "schema" in path.name or "backfill" in path.name or "migration" in path.name:
        return "schema-backfill"
    if relative_path.startswith("apps/station/app/subserver/conversation/"):
        return "station-route-handler"
    if relative_path in {
        "Makefile",
        "Cargo.toml",
        "go.mod",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
    } or path.name in {"main.rs", "mod.rs"}:
        return "build-runtime-registration"
    if relative_path.startswith(("apps/desktop/src/", "apps/mobile/src/")):
        return "client-command-wrapper"
    return "production-source"


def _compile_pattern(value: str) -> re.Pattern[str]:
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
        return re.compile(
            rf"(?<![A-Za-z0-9_]){re.escape(value)}(?![A-Za-z0-9_])"
        )
    return re.compile(re.escape(value))


def _selected_entries(
    inventory: dict[str, Any],
    owner_task: str | None,
) -> list[dict[str, Any]]:
    entries = inventory.get("entries")
    owner_tasks = inventory.get("ownerTasks")
    if not isinstance(entries, list) or not isinstance(owner_tasks, dict):
        raise ValueError("Chat storage legacy inventory entries are invalid")
    selected: list[dict[str, Any]] = []
    for value in entries:
        if not isinstance(value, dict) or not isinstance(value.get("id"), str):
            raise ValueError("Chat storage legacy inventory entry is invalid")
        if owner_task is None or owner_tasks.get(value["id"]) == owner_task:
            selected.append(value)
    if owner_task is not None and not selected:
        raise ValueError(f"legacy inventory has no entries for {owner_task}")
    return selected


def scan_repository(
    repo_root: Path = REPO_ROOT,
    inventory_path: Path = INVENTORY_PATH,
    owner_task: str | None = None,
) -> ScanResult:
    inventory = _load_inventory(inventory_path)
    if inventory.get("dimensions") != list(EXPECTED_DIMENSIONS):
        raise ValueError("Chat storage legacy inventory dimensions changed")
    roots = inventory.get("scanRoots")
    if not isinstance(roots, list) or not roots:
        raise ValueError("Chat storage legacy inventory scanRoots are invalid")
    entries = _selected_entries(inventory, owner_task)
    patterns = [
        (str(entry["id"]), str(pattern), _compile_pattern(str(pattern)))
        for entry in entries
        for pattern in [*entry.get("symbols", []), *entry.get("routes", [])]
    ]
    dimensions = {
        dimension: DimensionResult() for dimension in EXPECTED_DIMENSIONS
    }
    inventory_relative = inventory_path.relative_to(repo_root).as_posix()

    for relative_path in _tracked_paths(repo_root):
        if relative_path == inventory_relative or not _under_roots(
            relative_path,
            roots,
        ):
            continue
        path = repo_root / relative_path
        if (
            path.suffix.lower() not in TEXT_SUFFIXES
            or not path.is_file()
            or SKIP_DIRS & set(path.parts)
        ):
            continue
        dimension = _dimension_for(relative_path)
        dimensions[dimension].files_scanned += 1
        try:
            lines = path.read_text(
                encoding="utf-8",
                errors="replace",
            ).splitlines()
        except OSError:
            continue
        for line_number, line in enumerate(lines, 1):
            for entry_id, label, pattern in patterns:
                if pattern.search(line):
                    dimensions[dimension].violations.append(
                        Violation(
                            entry_id=entry_id,
                            dimension=dimension,
                            file=relative_path,
                            line=line_number,
                            pattern=label,
                            snippet=line.strip()[:160],
                        )
                    )

    return ScanResult(owner_task=owner_task, dimensions=dimensions)


def _report(gate_id: str, result: ScanResult) -> dict[str, Any]:
    scoped = result.owner_task is not None
    return {
        "artifactKind": "acceptance-gate-evidence-report",
        "reportKind": "chat-storage-zero-legacy",
        "gateId": gate_id,
        "gate": gate_id,
        "phase": (
            "CSG-05 Chat Storage Legacy Hard Cut"
            if scoped
            else "CSG-06 Chat Storage Zero-Legacy Aggregate"
        ),
        "bom": ["CSG-G04" if scoped else "CSG-G06"],
        "spec": [
            (
                "chat-storage-conversation-clear"
                if scoped
                else "chat-storage-governance"
            )
        ],
        "status": "PASS" if result.passed else "FAIL",
        "completionStatus": "DONE" if result.passed else "PARTIAL",
        "proofStatus": "PROVEN" if result.passed else "UNPROVEN",
        "ownerTask": result.owner_task,
        "inventory": INVENTORY_PATH.relative_to(REPO_ROOT).as_posix(),
        "filesScanned": result.files_scanned,
        "violationCount": len(result.violations),
        "dimensions": {
            name: {
                "status": "PASS" if value.passed else "FAIL",
                "filesScanned": value.files_scanned,
                "violationCount": len(value.violations),
            }
            for name, value in result.dimensions.items()
        },
        "violations": [asdict(value) for value in result.violations],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--owner-task")
    args = parser.parse_args()
    gate_id = TASK_GATE_ID if args.owner_task else FULL_GATE_ID
    result = scan_repository(owner_task=args.owner_task)
    report = _report(gate_id, result)
    status = str(report["status"])
    with ArtifactSession(repo_root=REPO_ROOT, gate_id=gate_id) as artifacts:
        artifacts.write_json(
            "chat-storage/zero-legacy.json",
            report,
            role="chat-storage-zero-legacy",
        )
        artifacts.complete(
            status=status,
            completion_status=str(report["completionStatus"]),
            proof_status=str(report["proofStatus"]),
            runtime={
                "environment": "local",
                "ownerTask": args.owner_task,
            },
        )
    stream = sys.stdout if result.passed else sys.stderr
    stream.write(
        f"{status}: {gate_id} scanned {result.files_scanned} "
        f"dimension-file assignments with {len(result.violations)} violation(s)\n"
    )
    for violation in result.violations:
        stream.write(
            f"  [{violation.dimension}] {violation.file}:{violation.line} "
            f"[{violation.entry_id}:{violation.pattern}] {violation.snippet}\n"
        )
    return 0 if result.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
