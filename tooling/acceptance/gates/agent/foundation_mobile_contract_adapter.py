#!/usr/bin/env python3
"""Source-bound Mobile contract adapter for Agent V2 Foundation evidence."""

from __future__ import annotations

import hashlib
import json
import subprocess
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tooling.acceptance.core.redaction import redact_text
from tooling.acceptance.gates.agent.foundation_candidate_producer import (
    REPO_ROOT,
    FoundationCandidateError,
    FoundationRuntimeAttestation,
    FoundationTuple,
    FoundationTupleObservation,
)

MOBILE_ROW = "foundation-mobile-contract"
MOBILE_TEST_PATH = Path("apps/mobile/src/contracts/agentV2Contract.test.ts")
MOBILE_GENERATED_CONTRACT_PATHS = (
    Path("apps/mobile/src/gen/proto/domain/actor/actor_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/agent_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/agent_config_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/capability_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/evaluation_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/home_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/turn_stream_pb.ts"),
)
MOBILE_CONTRACT_SOURCE_PATHS = (
    MOBILE_TEST_PATH,
    *MOBILE_GENERATED_CONTRACT_PATHS,
)
MOBILE_CELL_ASSERTIONS = {
    cell: f"[foundation-mobile-cell:{cell}]"
    for cell in (
        "AS-15-P01",
        "AS-15-P02",
        "AS-15-P03",
        "AS-15-P04",
        "AS-15-P05",
        "AS-15-P06",
        "AS-15-P07",
        "AS-15-P08",
        "AS-15-P09",
        "AS-15-P10",
        "AS-15-P11",
        "AS-F10",
        "BASE-EXECUTOR_UNAVAILABLE",
        "BASE-PERMISSION_DENIED",
        "BASE-TARGET_DISCONNECTED",
    )
}
MOBILE_ADAPTER_ROLES = frozenset(
    {"cell-results", "cleanup", "contract-evidence"}
)
MOBILE_TEST_COMMAND = (
    "pnpm",
    "--dir",
    "apps/mobile",
    "test:agent-contract",
    "--reporter=json",
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _source_digest(repo_root: Path) -> tuple[str, dict[str, str]]:
    digest = hashlib.sha256()
    file_hashes: dict[str, str] = {}
    for relative_path in MOBILE_CONTRACT_SOURCE_PATHS:
        source_path = repo_root / relative_path
        try:
            content = source_path.read_bytes()
        except OSError as error:
            raise FoundationCandidateError(
                f"Mobile contract source is unavailable: {relative_path}: {error}"
            ) from error
        source_hash = hashlib.sha256(content).hexdigest()
        file_hashes[relative_path.as_posix()] = source_hash
        digest.update(relative_path.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(content)
        digest.update(b"\0")
    return digest.hexdigest(), file_hashes


def _parse_vitest_report(stdout: str) -> Mapping[str, Any]:
    for line in reversed(stdout.splitlines()):
        candidate = line.strip()
        if not candidate.startswith("{"):
            continue
        try:
            report = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(report, Mapping) and "testResults" in report:
            return report
    raise FoundationCandidateError(
        "Mobile contract Vitest output contains no JSON report"
    )


def _assertion_statuses(report: Mapping[str, Any]) -> dict[str, str]:
    test_results = report.get("testResults")
    if not isinstance(test_results, list):
        raise FoundationCandidateError(
            "Mobile contract Vitest report has no testResults array"
        )

    statuses: dict[str, str] = {}
    for test_result in test_results:
        if not isinstance(test_result, Mapping):
            continue
        assertions = test_result.get("assertionResults")
        if not isinstance(assertions, list):
            continue
        for assertion in assertions:
            if not isinstance(assertion, Mapping):
                continue
            full_name = assertion.get("fullName")
            status = assertion.get("status")
            if not isinstance(full_name, str) or not isinstance(status, str):
                continue
            matching_cells = [
                cell
                for cell, marker in MOBILE_CELL_ASSERTIONS.items()
                if marker in full_name
            ]
            if len(matching_cells) > 1:
                raise FoundationCandidateError(
                    f"Mobile contract assertion maps to multiple cells: {full_name}"
                )
            if not matching_cells:
                continue
            cell = matching_cells[0]
            if cell in statuses:
                raise FoundationCandidateError(
                    f"Mobile contract cell marker is duplicated: {cell}"
                )
            statuses[cell] = status
    return statuses


class MobileContractFoundationAdapter:
    """Runs and binds the complete generated-protobuf Mobile contract suite."""

    def __init__(
        self,
        *,
        repo_root: Path = REPO_ROOT,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
        now: Callable[[], datetime] = _utc_now,
        timeout_seconds: int = 120,
    ) -> None:
        self._repo_root = repo_root
        self._runner = runner
        self._now = now
        self._timeout_seconds = timeout_seconds
        self._run_attempted = False
        self._run_error: FoundationCandidateError | None = None
        self._statuses: dict[str, str] = {}
        self._contract_hash = ""
        self._source_hashes: dict[str, str] = {}
        self._observed_at = ""

    def _run_contract_suite_once(self) -> None:
        if self._run_attempted:
            if self._run_error is not None:
                raise self._run_error
            return

        self._run_attempted = True
        try:
            completed = self._runner(
                MOBILE_TEST_COMMAND,
                cwd=self._repo_root,
                capture_output=True,
                text=True,
                check=False,
                timeout=self._timeout_seconds,
            )
            if completed.returncode != 0:
                output = redact_text(
                    "\n".join((completed.stdout, completed.stderr)).strip()
                )
                raise FoundationCandidateError(
                    "Mobile contract Vitest command failed "
                    f"with exit code {completed.returncode}: {output[-2000:]}"
                )

            report = _parse_vitest_report(completed.stdout)
            if report.get("success") is not True:
                raise FoundationCandidateError(
                    "Mobile contract Vitest report did not succeed"
                )
            statuses = _assertion_statuses(report)
            missing = sorted(set(MOBILE_CELL_ASSERTIONS) - set(statuses))
            failed = sorted(
                cell for cell, status in statuses.items() if status != "passed"
            )
            if missing or failed:
                raise FoundationCandidateError(
                    "Mobile contract cell results are incomplete; "
                    f"missing={missing}, failed={failed}"
                )

            self._contract_hash, self._source_hashes = _source_digest(
                self._repo_root
            )
            self._statuses = statuses
            observed_at = self._now()
            if observed_at.tzinfo is None:
                raise FoundationCandidateError(
                    "Mobile contract observation time must be timezone-aware"
                )
            self._observed_at = observed_at.isoformat(timespec="microseconds")
        except FoundationCandidateError as error:
            self._run_error = error
            raise
        except (OSError, subprocess.SubprocessError) as error:
            self._run_error = FoundationCandidateError(
                f"Mobile contract Vitest execution failed: {error}"
            )
            raise self._run_error from error

    def observe_mobile_contract(
        self, runtime_tuple: FoundationTuple
    ) -> FoundationTupleObservation:
        if runtime_tuple.row != MOBILE_ROW:
            raise FoundationCandidateError(
                f"Mobile adapter rejects non-Mobile row: {runtime_tuple.row}"
            )
        if runtime_tuple.cell not in MOBILE_CELL_ASSERTIONS:
            raise FoundationCandidateError(
                f"Mobile contract cell has no assertion mapping: {runtime_tuple.cell}"
            )
        if runtime_tuple.runtime_attestation_profile != "contract_only":
            raise FoundationCandidateError(
                "Mobile contract tuple must use contract_only attestation"
            )
        if runtime_tuple.role_policy.adapter_roles != MOBILE_ADAPTER_ROLES:
            raise FoundationCandidateError(
                "Mobile contract tuple role policy differs from D-12"
            )

        self._run_contract_suite_once()
        marker = MOBILE_CELL_ASSERTIONS[runtime_tuple.cell]
        source_files = [
            {
                "path": path,
                "sha256": source_hash,
            }
            for path, source_hash in self._source_hashes.items()
        ]
        runtime_attestation = FoundationRuntimeAttestation(
            "contract_only",
            {
                "contractAttestation": {
                    "contractId": runtime_tuple.cell,
                    "contractHash": self._contract_hash,
                    "platform": runtime_tuple.platform,
                    "toolchain": "vitest-generated-protobuf",
                    "roundTripStatus": "passed",
                },
                "stationProfile": "contract-only",
                "networkPath": "generated-protobuf-contract",
                "machine": "mobile-contract-runner",
                "coldWarmState": "contract",
                "observedAt": self._observed_at,
            },
        )
        return FoundationTupleObservation(
            tuple_key=runtime_tuple.key,
            observed=True,
            passed=self._statuses[runtime_tuple.cell] == "passed",
            runtime_attestation=runtime_attestation,
            role_observations={
                "cell-results": {
                    "cellId": runtime_tuple.cell,
                    "status": "passed",
                    "expected": marker,
                    "actual": "passed",
                },
                "cleanup": {
                    "resourceKind": "mobile-contract-test-process",
                    "resourceIdHash": hashlib.sha256(
                        " ".join(MOBILE_TEST_COMMAND).encode("utf-8")
                    ).hexdigest(),
                    "status": "clean",
                },
                "contract-evidence": {
                    "contractId": runtime_tuple.cell,
                    "contractHash": self._contract_hash,
                    "platform": runtime_tuple.platform,
                    "status": "passed",
                    "roundTripEqual": True,
                    "assertionMarker": marker,
                    "sourceFiles": source_files,
                },
            },
        )
