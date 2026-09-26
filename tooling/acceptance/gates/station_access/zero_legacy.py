#!/usr/bin/env python3
"""Station Access nine-dimensional zero-reference gate."""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

from tooling.acceptance.core import AcceptanceGate, GateError, REPO_ROOT


GATE_ID = "station-access-zero-legacy-e2e"
REPORT_RELATIVE_PATH = f"reports/{GATE_ID}.json"
INVENTORY_PATH = (
    REPO_ROOT
    / "docs"
    / "architecture"
    / "station-access-lifecycle"
    / "legacy-inventory.json"
)
EXPECTED_DIMENSIONS = (
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
    {".go", ".json", ".md", ".mjs", ".proto", ".py", ".rs", ".toml", ".ts", ".tsx", ".yaml", ".yml"}
)
SKIP_PARTS = frozenset(
    {".git", ".next", "__pycache__", "dist", "node_modules", "reports", "target"}
)


@dataclass(frozen=True)
class Violation:
    inventory_id: str
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


def load_inventory(
    inventory_path: Path = INVENTORY_PATH,
) -> dict[str, Any]:
    value = json.loads(inventory_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("legacy inventory must be a JSON object")
    if value.get("dimensions") != list(EXPECTED_DIMENSIONS):
        raise ValueError("legacy inventory dimensions do not match SAL-G04")
    if not isinstance(value.get("scanRoots"), list) or not value["scanRoots"]:
        raise ValueError("legacy inventory scanRoots must be non-empty")
    if not isinstance(value.get("entries"), list) or not value["entries"]:
        raise ValueError("legacy inventory entries must be non-empty")
    return value


def forbidden_values_by_entry(
    inventory_path: Path = INVENTORY_PATH,
) -> dict[str, tuple[str, ...]]:
    inventory = load_inventory(inventory_path)
    values: dict[str, tuple[str, ...]] = {}
    for entry in inventory["entries"]:
        entry_id = str(entry.get("id") or "")
        if not entry_id:
            raise ValueError("legacy inventory entry id is required")
        tokens = [
            value
            for key in ("symbols", "routes")
            for value in entry.get(key, [])
            if isinstance(value, str) and value
        ]
        if not tokens:
            raise ValueError(f"legacy inventory entry {entry_id} has no matcher")
        values[entry_id] = tuple(tokens)
    return values


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
    if completed.returncode != 0:
        raise RuntimeError("cannot enumerate tracked and untracked source")
    return sorted(
        item.decode("utf-8")
        for item in completed.stdout.split(b"\0")
        if item
    )


def _under_roots(relative_path: str, roots: Iterable[str]) -> bool:
    return any(
        relative_path == root.rstrip("/")
        or relative_path.startswith(f"{root.rstrip('/')}/")
        for root in roots
    )


def _is_test_fixture_or_mock(path: Path) -> bool:
    parts = set(path.parts)
    name = path.name
    return (
        "test" in parts
        or "tests" in parts
        or "fixture" in parts
        or "fixtures" in parts
        or "mock" in parts
        or "mocks" in parts
        or "_test." in name
        or ".test." in name
        or name.startswith("test_")
    )


def _dimensions_for(relative_path: str) -> tuple[str, ...]:
    path = Path(relative_path)
    value = path.as_posix()
    parts = set(path.parts)
    dimensions: list[str] = []
    is_test = _is_test_fixture_or_mock(path)

    if (
        value.startswith(("apps/", "model/", "packages/"))
        and not is_test
        and "gen" not in parts
        and "generated" not in parts
        and not path.name.endswith((".pb.go", "_pb.ts"))
        and path.suffix.lower() in TEXT_SUFFIXES
    ):
        dimensions.append("production-source")
    if value.startswith(("apps/desktop/", "apps/mobile/")):
        dimensions.append("client-command-wrapper")
    if value.startswith(
        ("apps/station/frame/touch/", "apps/station/app/subserver/federation/")
    ) and not path.name.endswith(".pb.go"):
        dimensions.append("station-route-handler")
    if (
        path.suffix == ".proto"
        or path.name.endswith((".pb.go", "_pb.ts"))
        or "gen" in parts
        or "generated" in parts
    ):
        dimensions.append("proto-generated")
    if any(
        marker in value.lower()
        for marker in ("schema", "migration", "backfill", "database", "storage")
    ):
        dimensions.append("schema-backfill")
    if is_test:
        dimensions.append("test-fixture-mock")
    if value.startswith(("tooling/acceptance/", "tooling/scripts/")):
        dimensions.append("acceptance-runner")
    if value.startswith(
        ("docs/", "packages/locales/", "packages/prototypes/")
    ):
        dimensions.append("docs-locales-prototype")
    if (
        value
        in {
            "Cargo.toml",
            "Makefile",
            "go.mod",
            "package.json",
            "pnpm-lock.yaml",
            "pnpm-workspace.yaml",
        }
        or value.startswith("tooling/acceptance/environments/")
        or value in {"tooling/acceptance/gates.yaml", "tooling/acceptance/registry.yaml"}
    ):
        dimensions.append("build-runtime-registration")
    return tuple(dict.fromkeys(dimensions))


def _patterns(
    inventory: dict[str, Any],
) -> tuple[tuple[str, str, re.Pattern[str]], ...]:
    compiled: list[tuple[str, str, re.Pattern[str]]] = []
    for entry in inventory["entries"]:
        entry_id = str(entry["id"])
        for symbol in entry.get("symbols", []):
            compiled.append(
                (
                    entry_id,
                    symbol,
                    re.compile(
                        rf"(?<![A-Za-z0-9_]){re.escape(symbol)}(?![A-Za-z0-9_])"
                    ),
                )
            )
        for route in entry.get("routes", []):
            compiled.append((entry_id, route, re.compile(re.escape(route))))
    return tuple(compiled)


def scan_repository(
    repo_root: Path = REPO_ROOT,
    inventory_path: Path = INVENTORY_PATH,
) -> ScanResult:
    inventory = load_inventory(inventory_path)
    dimensions = {
        dimension: DimensionResult() for dimension in EXPECTED_DIMENSIONS
    }
    roots = tuple(str(root) for root in inventory["scanRoots"])
    inventory_relative = inventory_path.relative_to(repo_root).as_posix()
    patterns = _patterns(inventory)

    for relative_path in _tracked_paths(repo_root):
        if (
            relative_path == inventory_relative
            or not _under_roots(relative_path, roots)
        ):
            continue
        path = repo_root / relative_path
        if (
            path.suffix.lower() not in TEXT_SUFFIXES
            or SKIP_PARTS.intersection(path.parts)
            or not path.is_file()
        ):
            continue
        path_dimensions = _dimensions_for(relative_path)
        if not path_dimensions:
            continue
        for dimension in path_dimensions:
            dimensions[dimension].files_scanned += 1
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        for line_number, line in enumerate(lines, 1):
            for inventory_id, label, pattern in patterns:
                if not pattern.search(line):
                    continue
                for dimension in path_dimensions:
                    dimensions[dimension].violations.append(
                        Violation(
                            inventory_id=inventory_id,
                            dimension=dimension,
                            file=relative_path,
                            line=line_number,
                            pattern=label,
                            snippet=line.strip()[:160],
                        )
                    )
    return ScanResult(dimensions=dimensions)


def build_report(result: ScanResult) -> dict[str, object]:
    return {
        "artifactKind": "acceptance-gate-evidence-report",
        "gateId": GATE_ID,
        "gate": GATE_ID,
        "status": "PASS" if result.passed else "FAIL",
        "completionStatus": "DONE" if result.passed else "PARTIAL",
        "proofStatus": "PROVEN" if result.passed else "UNPROVEN",
        "phase": "SAL-03",
        "bom": ["SAL-G04"],
        "spec": [
            "docs/architecture/station-access-lifecycle/acceptance-matrix.md",
            "docs/architecture/station-access-lifecycle/legacy-inventory.json",
        ],
        "sampleEmissionAllowed": result.passed,
        "filesScanned": result.files_scanned,
        "violationCount": len(result.violations),
        "dimensions": {
            name: {
                "status": "PASS" if item.passed else "FAIL",
                "filesScanned": item.files_scanned,
                "violationCount": len(item.violations),
            }
            for name, item in result.dimensions.items()
        },
        "violations": [asdict(item) for item in result.violations],
        "assertions": [
            {
                "name": f"{name}-zero-reference",
                "passed": item.passed,
                "detail": (
                    f"{item.files_scanned} file(s) scanned"
                    if item.passed
                    else f"{len(item.violations)} violation(s)"
                ),
            }
            for name, item in result.dimensions.items()
        ],
    }


class StationAccessZeroLegacyGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-03"
    bom = ("SAL-G04",)
    report_path = (
        REPO_ROOT / "tooling" / "acceptance" / "reports" / f"{GATE_ID}.json"
    )
    spec = (
        "docs/architecture/station-access-lifecycle/acceptance-matrix.md",
        "docs/architecture/station-access-lifecycle/legacy-inventory.json",
    )

    def run(self) -> dict[str, object]:
        result = scan_repository()
        report = build_report(result)
        for name, item in result.dimensions.items():
            self.report.add_assertion(
                f"{name}-zero-reference",
                item.passed,
                (
                    f"{item.files_scanned} file(s) scanned"
                    if item.passed
                    else f"{len(item.violations)} violation(s)"
                ),
            )
        self.report.runtime.update(
            {
                "filesScanned": result.files_scanned,
                "violationCount": len(result.violations),
                "dimensions": report["dimensions"],
                "violations": report["violations"],
            }
        )
        if not result.passed:
            first = result.violations[0]
            raise GateError(
                f"{len(result.violations)} legacy reference(s) remain; "
                f"first={first.file}:{first.line} {first.pattern}"
            )
        return {
            "dimensionsPassed": len(EXPECTED_DIMENSIONS),
            "filesScanned": result.files_scanned,
        }


def main() -> int:
    return StationAccessZeroLegacyGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
