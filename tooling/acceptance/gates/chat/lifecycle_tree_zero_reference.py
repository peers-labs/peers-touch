#!/usr/bin/env python3
"""CCU nine-dimensional zero-reference gate.

The inventory is the source of truth for deleted paths, forbidden symbols, and
the roots assigned to every CCU-D05 proof dimension.

GATE_ID: chat-lifecycle-tree-zero-reference-e2e
"""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parents[4]
GATE_ID = "chat-lifecycle-tree-zero-reference-e2e"
REPORT_PATH = REPO_ROOT / "tooling" / "acceptance" / "reports" / f"{GATE_ID}.json"
INVENTORY_PATH = (
    REPO_ROOT / "docs" / "architecture" / "chat-lifecycle" / "legacy-inventory.json"
)

EXPECTED_DIMENSIONS: tuple[str, ...] = (
    "tracked-source",
    "tauri-registry",
    "http-gateway-registry",
    "compiled-proto-descriptor",
    "generated-manifest",
    "mixed-client-runtime-trace",
    "store-schema-table",
    "test-fixture-script",
    "current-source-doc",
)

TEXT_SUFFIXES: frozenset[str] = frozenset(
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

SKIP_DIRS: frozenset[str] = frozenset(
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
    dimension: str
    file: str
    line: int
    pattern_label: str
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
        return sum(result.files_scanned for result in self.dimensions.values())

    @property
    def passed(self) -> bool:
        return all(result.passed for result in self.dimensions.values())


def _load_inventory(inventory_path: Path) -> dict[str, Any]:
    with inventory_path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("legacy inventory must be a JSON object")
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
        if path.is_file() and not (SKIP_DIRS & set(path.relative_to(repo_root).parts))
    )


def _under_roots(relative_path: str, roots: Iterable[str]) -> bool:
    return any(
        relative_path == root.rstrip("/")
        or relative_path.startswith(f"{root.rstrip('/')}/")
        for root in roots
    )


def _is_test_fixture_or_script(relative_path: str) -> bool:
    path = Path(relative_path)
    name = path.name
    parts = set(path.parts)
    return (
        relative_path.startswith("tooling/")
        or "tests" in parts
        or "fixtures" in parts
        or "scripts" in parts
        or "_test." in name
        or ".test." in name
        or name.startswith("test_")
    )


def _compile_inventory_patterns(
    inventory: dict[str, Any],
) -> list[tuple[str, re.Pattern[str]]]:
    patterns: list[tuple[str, re.Pattern[str]]] = []
    for key, label in (
        ("forbiddenImports", "forbidden import"),
        ("forbiddenIdentifiers", "forbidden identifier"),
        ("forbiddenCommands", "forbidden command"),
        ("forbiddenLegacyTables", "forbidden legacy table"),
    ):
        for value in inventory.get(key, []):
            patterns.append(
                (
                    f"{label}: {value}",
                    re.compile(rf"(?<![A-Za-z0-9_]){re.escape(value)}(?![A-Za-z0-9_])"),
                )
            )
    for value in inventory.get("forbiddenRoutes", []):
        patterns.append(
            (f"forbidden route: {value}", re.compile(re.escape(value)))
        )
    return patterns


def _inventory_contract_violations(
    inventory: dict[str, Any],
    dimensions: dict[str, DimensionResult],
) -> None:
    declared = inventory.get("requiredDimensions")
    roots = inventory.get("dimensionRoots")
    if declared != list(EXPECTED_DIMENSIONS):
        dimensions["tracked-source"].violations.append(
            Violation(
                dimension="tracked-source",
                file=INVENTORY_PATH.relative_to(REPO_ROOT).as_posix(),
                line=0,
                pattern_label="required dimension contract mismatch",
                snippet=f"declared={declared!r}",
            )
        )
    if not isinstance(roots, dict):
        dimensions["tracked-source"].violations.append(
            Violation(
                dimension="tracked-source",
                file=INVENTORY_PATH.relative_to(REPO_ROOT).as_posix(),
                line=0,
                pattern_label="dimension roots missing",
                snippet="dimensionRoots must be an object",
            )
        )
        return
    for dimension in EXPECTED_DIMENSIONS:
        value = roots.get(dimension)
        if not isinstance(value, list) or not value or not all(
            isinstance(root, str) and root for root in value
        ):
            dimensions[dimension].violations.append(
                Violation(
                    dimension=dimension,
                    file=INVENTORY_PATH.relative_to(REPO_ROOT).as_posix(),
                    line=0,
                    pattern_label="dimension roots missing",
                    snippet=f"dimensionRoots[{dimension!r}] must be a non-empty list",
                )
            )


def _scan_deleted_paths(
    repo_root: Path,
    inventory: dict[str, Any],
    dimensions: dict[str, DimensionResult],
) -> None:
    for relative_path in inventory.get("deletedPaths", []):
        path = repo_root / relative_path
        if path.exists() or path.is_symlink():
            dimensions["tracked-source"].violations.append(
                Violation(
                    dimension="tracked-source",
                    file=relative_path,
                    line=0,
                    pattern_label="declared deleted path exists",
                    snippet=relative_path,
                )
            )


def _scan_path_segments(
    tracked_paths: Iterable[str],
    inventory: dict[str, Any],
    dimensions: dict[str, DimensionResult],
) -> None:
    roots = inventory.get("compatibilityIdentifierRoots", [])
    forbidden = set(inventory.get("forbiddenCompatibilityPathSegments", []))
    for relative_path in tracked_paths:
        if not _under_roots(relative_path, roots):
            continue
        matched = forbidden & set(Path(relative_path).parts)
        for segment in sorted(matched):
            dimensions["tracked-source"].violations.append(
                Violation(
                    dimension="tracked-source",
                    file=relative_path,
                    line=0,
                    pattern_label="forbidden compatibility path segment",
                    snippet=segment,
                )
            )


def _dimension_paths(
    dimension: str,
    tracked_paths: Iterable[str],
    roots: Iterable[str],
) -> Iterable[str]:
    for relative_path in tracked_paths:
        if not _under_roots(relative_path, roots):
            continue
        if dimension == "test-fixture-script" and not _is_test_fixture_or_script(
            relative_path
        ):
            continue
        yield relative_path


def scan_repository(
    repo_root: Path = REPO_ROOT,
    inventory_path: Path = INVENTORY_PATH,
) -> ScanResult:
    inventory = _load_inventory(inventory_path)
    dimensions = {
        dimension: DimensionResult() for dimension in EXPECTED_DIMENSIONS
    }
    _inventory_contract_violations(inventory, dimensions)
    tracked_paths = _tracked_paths(repo_root)
    _scan_deleted_paths(repo_root, inventory, dimensions)
    _scan_path_segments(tracked_paths, inventory, dimensions)

    roots_by_dimension = inventory.get("dimensionRoots", {})
    exempt_paths = set(inventory.get("negativeAssertionPaths", []))
    patterns = _compile_inventory_patterns(inventory)
    compatibility_roots = inventory.get("compatibilityIdentifierRoots", [])
    suffixes = inventory.get("forbiddenCompatibilityIdentifierSuffixes", [])
    suffix_pattern = (
        re.compile(
            rf"\b[A-Za-z][A-Za-z0-9]*(?:{'|'.join(re.escape(value) for value in suffixes)})\b"
        )
        if suffixes
        else None
    )
    dimensions_by_path: dict[str, list[str]] = {}
    for dimension in EXPECTED_DIMENSIONS:
        roots = roots_by_dimension.get(dimension, [])
        for relative_path in _dimension_paths(dimension, tracked_paths, roots):
            if relative_path in exempt_paths:
                continue
            path = repo_root / relative_path
            if path.suffix.lower() not in TEXT_SUFFIXES or not path.is_file():
                continue
            dimensions[dimension].files_scanned += 1
            dimensions_by_path.setdefault(relative_path, []).append(dimension)

    for relative_path, path_dimensions in dimensions_by_path.items():
        path = repo_root / relative_path
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line_number, line in enumerate(lines, 1):
            for label, pattern in patterns:
                if not pattern.search(line):
                    continue
                for dimension in path_dimensions:
                    dimensions[dimension].violations.append(
                        Violation(
                            dimension=dimension,
                            file=relative_path,
                            line=line_number,
                            pattern_label=label,
                            snippet=line.strip()[:160],
                        )
                    )
            if not (
                suffix_pattern
                and "tracked-source" in path_dimensions
                and _under_roots(relative_path, compatibility_roots)
                and suffix_pattern.search(line)
            ):
                continue
            dimensions["tracked-source"].violations.append(
                Violation(
                    dimension="tracked-source",
                    file=relative_path,
                    line=line_number,
                    pattern_label="forbidden compatibility identifier suffix",
                    snippet=line.strip()[:160],
                )
            )

    return ScanResult(dimensions=dimensions)


def write_report(result: ScanResult, report_path: Path = REPORT_PATH) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "gate": GATE_ID,
        "status": "PASS" if result.passed else "FAIL",
        "filesScanned": result.files_scanned,
        "violationCount": len(result.violations),
        "dimensions": {
            name: {
                "status": "PASS" if dimension.passed else "FAIL",
                "filesScanned": dimension.files_scanned,
                "violationCount": len(dimension.violations),
            }
            for name, dimension in result.dimensions.items()
        },
        "violations": [asdict(violation) for violation in result.violations],
        "assertions": [
            {
                "name": f"{dimension}-zero-reference",
                "passed": result.dimensions[dimension].passed,
                "detail": (
                    f"{len(result.dimensions[dimension].violations)} violation(s)"
                    if not result.dimensions[dimension].passed
                    else (
                        f"{result.dimensions[dimension].files_scanned} "
                        "tracked file(s) scanned"
                    )
                ),
            }
            for dimension in EXPECTED_DIMENSIONS
        ],
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    result = scan_repository()
    write_report(result)
    if not result.passed:
        print(
            f"FAIL: {GATE_ID} found {len(result.violations)} legacy "
            f"reference(s) across {result.files_scanned} dimension-file scans:"
        )
        for violation in result.violations:
            print(
                f"  [{violation.dimension}] {violation.file}:{violation.line} "
                f"[{violation.pattern_label}] {violation.snippet}"
            )
        return 1
    print(
        f"PASS: {GATE_ID} -- all {len(EXPECTED_DIMENSIONS)} dimensions passed "
        f"across {result.files_scanned} tracked dimension-file scans"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
