#!/usr/bin/env python3
"""Source-backed Foundation adapter for the MCA-D11 orchestration guard."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol, Sequence

import yaml

from tooling.acceptance.gates.agent.foundation_candidate_producer import (
    FoundationCandidateError,
    FoundationRuntimeAttestation,
    FoundationTuple,
    FoundationTupleObservation,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECKER_PATH = Path("tooling/scripts/review/agent-d11-entrypoints.py")
DEFAULT_FIXTURE_PATH = Path(
    "tooling/acceptance/fixtures/agent_d11_entrypoints.yaml"
)
EXPECTED_ROLES = frozenset({"cell-results", "cleanup", "guard-report"})


class CommandRunner(Protocol):
    def __call__(
        self, command: Sequence[str], cwd: Path
    ) -> subprocess.CompletedProcess[str]: ...


def _run_command(
    command: Sequence[str], cwd: Path
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        check=False,
        text=True,
    )


def _observed_at() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


@dataclass(frozen=True)
class _InventorySnapshot:
    source_inventory_hash: str
    observed_at: str
    report: Mapping[str, Any]


class D11FoundationAdapter:
    """Runs the reviewed D11 checker and projects only guard-applicable evidence."""

    def __init__(
        self,
        *,
        repo_root: Path = REPO_ROOT,
        fixture_path: Path = DEFAULT_FIXTURE_PATH,
        command_runner: CommandRunner = _run_command,
        clock: Callable[[], str] = _observed_at,
    ) -> None:
        self._repo_root = repo_root.resolve()
        self._fixture_path = (
            fixture_path.resolve()
            if fixture_path.is_absolute()
            else (self._repo_root / fixture_path).resolve()
        )
        self._command_runner = command_runner
        self._clock = clock
        self._cached_snapshot: _InventorySnapshot | None = None
        self._cached_error: FoundationCandidateError | None = None

    def observe_d11(
        self, runtime_tuple: FoundationTuple
    ) -> FoundationTupleObservation:
        self._validate_tuple_contract(runtime_tuple)
        snapshot = self._audit_snapshot()
        report = snapshot.report
        actual = json.dumps(
            {
                "atelierAliasCount": report["atelierAliasCount"],
                "entrypointCount": report["entrypointCount"],
                "guardedEntrypointCount": report["guardedEntrypointCount"],
                "knownDefectCount": report["knownDefectCount"],
                "violationCount": len(report["issues"]),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        guard_identity = {
            "guardId": runtime_tuple.cell,
            "sourceInventoryHash": snapshot.source_inventory_hash,
            "violationCount": 0,
        }
        return FoundationTupleObservation(
            tuple_key=runtime_tuple.key,
            observed=True,
            passed=True,
            runtime_attestation=FoundationRuntimeAttestation(
                profile="orchestration_guard",
                payload={
                    "guardAttestation": guard_identity,
                    "stationProfile": "source-worktree",
                    "networkPath": "local-source-audit",
                    "machine": "python-subprocess",
                    "coldWarmState": "neutral",
                    "observedAt": snapshot.observed_at,
                },
            ),
            role_observations={
                "cell-results": {
                    "cellId": runtime_tuple.cell,
                    "status": "passed",
                    "expected": (
                        "D11 enforcement passes with no issues or known defects"
                    ),
                    "actual": actual,
                },
                "cleanup": {
                    "resourceKind": "d11-source-audit-process",
                    "resourceIdHash": snapshot.source_inventory_hash,
                    "status": "clean",
                },
                "guard-report": {
                    **guard_identity,
                    "passed": True,
                },
            },
        )

    def _audit_snapshot(self) -> _InventorySnapshot:
        if self._cached_error is not None:
            raise self._cached_error
        if self._cached_snapshot is not None:
            return self._cached_snapshot

        try:
            before_hash = self._source_inventory_hash()
            command = (
                sys.executable,
                str(CHECKER_PATH),
                "--json",
                "--repo-root",
                str(self._repo_root),
                "--fixture",
                str(self._fixture_path),
            )
            try:
                result = self._command_runner(command, self._repo_root)
            except Exception as error:
                raise FoundationCandidateError(
                    f"D11 checker could not execute: {error}"
                ) from error
            report = self._validate_checker_result(result)
            after_hash = self._source_inventory_hash()
            if before_hash != after_hash:
                raise FoundationCandidateError(
                    "D11 fixture or source inventory changed during the checker run"
                )
            self._cached_snapshot = _InventorySnapshot(
                source_inventory_hash=after_hash,
                observed_at=self._clock(),
                report=report,
            )
        except FoundationCandidateError as error:
            self._cached_error = error
            raise
        return self._cached_snapshot

    def _validate_tuple_contract(self, runtime_tuple: FoundationTuple) -> None:
        if runtime_tuple.row != "foundation-d11":
            raise FoundationCandidateError(
                f"D11 adapter cannot observe row {runtime_tuple.row!r}"
            )
        if runtime_tuple.runtime_attestation_profile != "orchestration_guard":
            raise FoundationCandidateError(
                "D11 tuple must use orchestration_guard attestation"
            )
        if runtime_tuple.role_policy.adapter_roles != EXPECTED_ROLES:
            raise FoundationCandidateError(
                "D11 tuple role applicability differs from accepted D-13 policy"
            )

    def _validate_checker_result(
        self, result: subprocess.CompletedProcess[str]
    ) -> Mapping[str, Any]:
        if result.returncode != 0:
            raise FoundationCandidateError(
                f"D11 checker failed with exit code {result.returncode}"
            )
        try:
            report = json.loads(result.stdout)
        except (TypeError, json.JSONDecodeError) as error:
            raise FoundationCandidateError(
                f"D11 checker returned invalid JSON: {error}"
            ) from error
        if not isinstance(report, dict):
            raise FoundationCandidateError(
                "D11 checker JSON report must be an object"
            )
        required_counts = (
            "entrypointCount",
            "atelierAliasCount",
            "guardedEntrypointCount",
        )
        if (
            report.get("mode") != "enforcement"
            or report.get("status") != "pass"
            or report.get("issues") != []
            or report.get("knownDefectCount") != 0
            or report.get("knownDefects") != []
            or any(
                not isinstance(report.get(field), int)
                or report[field] < 0
                for field in required_counts
            )
        ):
            raise FoundationCandidateError(
                "D11 checker did not report a clean enforcement result"
            )
        return report

    def _source_inventory_hash(self) -> str:
        try:
            fixture_bytes = self._fixture_path.read_bytes()
            fixture = yaml.safe_load(fixture_bytes)
        except (OSError, yaml.YAMLError) as error:
            raise FoundationCandidateError(
                f"cannot load D11 fixture {self._fixture_path}: {error}"
            ) from error
        if not isinstance(fixture, dict):
            raise FoundationCandidateError("D11 fixture must be a mapping")

        sources = self._fixture_sources(fixture)
        inventory = [
            {
                "path": "fixture",
                "sha256": hashlib.sha256(fixture_bytes).hexdigest(),
            }
        ]
        for source in sorted(sources):
            path = Path(source)
            if path.is_absolute() or ".." in path.parts:
                raise FoundationCandidateError(
                    f"D11 source must be repo-relative: {source}"
                )
            full_path = self._repo_root / path
            try:
                digest = hashlib.sha256(full_path.read_bytes()).hexdigest()
            except OSError as error:
                raise FoundationCandidateError(
                    f"cannot hash D11 source {source}: {error}"
                ) from error
            inventory.append({"path": source, "sha256": digest})
        return hashlib.sha256(
            json.dumps(
                inventory,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()

    @staticmethod
    def _fixture_sources(fixture: Mapping[str, Any]) -> set[str]:
        sources: set[str] = set()

        def add_source(value: Any, label: str) -> None:
            if not isinstance(value, str) or not value:
                raise FoundationCandidateError(
                    f"D11 fixture {label} must be a non-empty source path"
                )
            sources.add(value)

        route_sets = fixture.get("route_sets")
        entrypoints = fixture.get("entrypoints")
        aliases = fixture.get("atelier_aliases")
        tooling_only = fixture.get("tooling_only")
        if (
            not isinstance(route_sets, list)
            or not isinstance(entrypoints, list)
            or not isinstance(aliases, dict)
            or not isinstance(tooling_only, list)
        ):
            raise FoundationCandidateError(
                "D11 fixture source inventory sections are malformed"
            )
        for index, item in enumerate(route_sets):
            if not isinstance(item, dict):
                raise FoundationCandidateError(
                    f"D11 fixture route_sets[{index}] must be a mapping"
                )
            add_source(item.get("source"), f"route_sets[{index}].source")
        for index, item in enumerate(entrypoints):
            if not isinstance(item, dict):
                raise FoundationCandidateError(
                    f"D11 fixture entrypoints[{index}] must be a mapping"
                )
            add_source(item.get("source"), f"entrypoints[{index}].source")
            guard = item.get("guard")
            if guard is not None:
                if not isinstance(guard, dict):
                    raise FoundationCandidateError(
                        f"D11 fixture entrypoints[{index}].guard must be a mapping"
                    )
                add_source(
                    guard.get("scope_source"),
                    f"entrypoints[{index}].guard.scope_source",
                )
        add_source(aliases.get("source"), "atelier_aliases.source")
        for index, item in enumerate(tooling_only):
            if not isinstance(item, dict):
                raise FoundationCandidateError(
                    f"D11 fixture tooling_only[{index}] must be a mapping"
                )
            add_source(item.get("source"), f"tooling_only[{index}].source")
        if not sources:
            raise FoundationCandidateError("D11 fixture source inventory is empty")
        return sources
