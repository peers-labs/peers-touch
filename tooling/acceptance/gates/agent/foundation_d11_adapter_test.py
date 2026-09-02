from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Callable, Sequence

import yaml

from tooling.acceptance.gates.agent.foundation_candidate_producer import (
    FoundationCandidateError,
    FoundationRolePolicy,
    FoundationTuple,
    load_foundation_tuples,
)
from tooling.acceptance.gates.agent.foundation_d11_adapter import (
    D11FoundationAdapter,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
OBSERVED_AT = "2026-08-24T12:00:00.000000+00:00"


def _clean_report() -> dict[str, Any]:
    return {
        "mode": "enforcement",
        "status": "pass",
        "entrypointCount": 4,
        "atelierAliasCount": 2,
        "guardedEntrypointCount": 3,
        "knownDefectCount": 0,
        "knownDefects": [],
        "issues": [],
    }


class RecordingRunner:
    def __init__(
        self,
        report: dict[str, Any] | None = None,
        *,
        returncode: int = 0,
        before_return: Callable[[], None] | None = None,
        invoke_real_command: bool = False,
    ) -> None:
        self.report = report if report is not None else _clean_report()
        self.returncode = returncode
        self.before_return = before_return
        self.invoke_real_command = invoke_real_command
        self.calls: list[tuple[tuple[str, ...], Path]] = []

    def __call__(
        self, command: Sequence[str], cwd: Path
    ) -> subprocess.CompletedProcess[str]:
        normalized = tuple(command)
        self.calls.append((normalized, cwd))
        if self.invoke_real_command:
            return subprocess.run(
                normalized,
                cwd=cwd,
                capture_output=True,
                check=False,
                text=True,
            )
        if self.before_return is not None:
            self.before_return()
        return subprocess.CompletedProcess(
            normalized,
            self.returncode,
            stdout=json.dumps(self.report),
            stderr="",
        )


class D11FoundationAdapterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temporary.name)
        self.source_paths = (
            "src/route.go",
            "src/entry.go",
            "src/guard.go",
            "src/aliases.rs",
            "src/tool.go",
        )
        for index, relative in enumerate(self.source_paths):
            path = self.repo_root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"source-{index}\n", encoding="utf-8")
        self.fixture_path = self.repo_root / "fixture.yaml"
        self.fixture_path.write_text(
            yaml.safe_dump(
                {
                    "route_sets": [{"source": self.source_paths[0]}],
                    "entrypoints": [
                        {
                            "source": self.source_paths[1],
                            "guard": {"scope_source": self.source_paths[2]},
                        }
                    ],
                    "atelier_aliases": {"source": self.source_paths[3]},
                    "tooling_only": [{"source": self.source_paths[4]}],
                },
                sort_keys=True,
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _tuple(self, sample_id: str = "sample-1") -> FoundationTuple:
        return FoundationTuple(
            gate="agent-v2-kernel-foundation-e2e",
            row="foundation-d11",
            platform="station_web_rust",
            runtime="orchestration_guard",
            cell="AS-D11",
            locale="contract",
            ordering="single",
            sample_id=sample_id,
            role_policy=FoundationRolePolicy(
                always=("cell-results", "runtime-attestation-set", "cleanup"),
                required=("guard-report",),
                not_applicable=(
                    "receiver-dom",
                    "station-readback",
                    "runtime-events",
                    "measurement-report",
                    "side-effect-count",
                    "replay",
                    "contract-evidence",
                ),
            ),
            runtime_attestation_profile="orchestration_guard",
        )

    def _adapter(self, runner: RecordingRunner) -> D11FoundationAdapter:
        return D11FoundationAdapter(
            repo_root=self.repo_root,
            fixture_path=self.fixture_path,
            command_runner=runner,
            clock=lambda: OBSERVED_AT,
        )

    def _expected_inventory_hash(self) -> str:
        inventory = [
            {
                "path": "fixture",
                "sha256": hashlib.sha256(
                    self.fixture_path.read_bytes()
                ).hexdigest(),
            }
        ]
        for relative in sorted(self.source_paths):
            inventory.append(
                {
                    "path": relative,
                    "sha256": hashlib.sha256(
                        (self.repo_root / relative).read_bytes()
                    ).hexdigest(),
                }
            )
        return hashlib.sha256(
            json.dumps(
                inventory,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()

    def test_projects_clean_checker_report_without_fabricated_runtime_data(
        self,
    ) -> None:
        runner = RecordingRunner()
        observation = self._adapter(runner).observe_d11(self._tuple())

        expected_hash = self._expected_inventory_hash()
        self.assertTrue(observation.observed)
        self.assertTrue(observation.passed)
        self.assertEqual(
            set(observation.role_observations),
            {"cell-results", "cleanup", "guard-report"},
        )
        self.assertEqual(
            observation.runtime_attestation.profile,
            "orchestration_guard",
        )
        self.assertEqual(
            observation.runtime_attestation.payload["guardAttestation"],
            {
                "guardId": "AS-D11",
                "sourceInventoryHash": expected_hash,
                "violationCount": 0,
            },
        )
        self.assertEqual(
            observation.role_observations["guard-report"],
            {
                "guardId": "AS-D11",
                "sourceInventoryHash": expected_hash,
                "violationCount": 0,
                "passed": True,
            },
        )
        serialized = json.dumps(
            {
                "attestation": observation.runtime_attestation.to_dict(),
                "roles": observation.role_observations,
            },
            sort_keys=True,
        )
        for forbidden in (
            "actorIdentityHash",
            "clientSession",
            "conversationRuntimeBinding",
            "receiver-dom",
            "toolCallBinding",
            "turnAttempt",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_caches_one_checker_result_for_all_d11_tuples(self) -> None:
        runner = RecordingRunner()
        adapter = self._adapter(runner)

        first = adapter.observe_d11(self._tuple("sample-1"))
        second = adapter.observe_d11(self._tuple("sample-2"))

        self.assertEqual(len(runner.calls), 1)
        command, cwd = runner.calls[0]
        self.assertEqual(cwd, self.repo_root.resolve())
        self.assertEqual(command[0], sys.executable)
        self.assertEqual(
            command[1:3],
            (
                "tooling/scripts/review/agent-d11-entrypoints.py",
                "--json",
            ),
        )
        self.assertEqual(
            first.runtime_attestation.payload,
            second.runtime_attestation.payload,
        )

    def test_rejects_any_non_clean_checker_report_and_caches_failure(self) -> None:
        reports = (
            {**_clean_report(), "status": "fail"},
            {
                **_clean_report(),
                "issues": [
                    {
                        "code": "GUARD_ENFORCEMENT",
                        "item": "entry",
                    }
                ],
            },
            {
                **_clean_report(),
                "knownDefectCount": 1,
                "knownDefects": [{"code": "KNOWN_ROUTE_DEFECT"}],
            },
        )
        for report in reports:
            with self.subTest(report=report):
                runner = RecordingRunner(report)
                adapter = self._adapter(runner)
                for _ in range(2):
                    with self.assertRaisesRegex(
                        FoundationCandidateError,
                        "clean enforcement result",
                    ):
                        adapter.observe_d11(self._tuple())
                self.assertEqual(len(runner.calls), 1)

    def test_rejects_source_inventory_drift_during_checker_run(self) -> None:
        source = self.repo_root / self.source_paths[2]

        def mutate_source() -> None:
            source.write_text("changed-during-audit\n", encoding="utf-8")

        runner = RecordingRunner(before_return=mutate_source)
        adapter = self._adapter(runner)

        with self.assertRaisesRegex(
            FoundationCandidateError,
            "changed during the checker run",
        ):
            adapter.observe_d11(self._tuple())
        with self.assertRaises(FoundationCandidateError):
            adapter.observe_d11(self._tuple("sample-2"))
        self.assertEqual(len(runner.calls), 1)

    def test_rejects_non_d11_or_non_applicable_tuple_contract(self) -> None:
        runner = RecordingRunner()
        adapter = self._adapter(runner)
        wrong_row = self._tuple()
        object.__setattr__(wrong_row, "row", "foundation-browser-direct")

        with self.assertRaisesRegex(FoundationCandidateError, "cannot observe row"):
            adapter.observe_d11(wrong_row)
        self.assertEqual(runner.calls, [])


class D11FoundationAdapterIntegrationTest(unittest.TestCase):
    def test_real_checker_produces_all_d11_tuple_observations(self) -> None:
        runner = RecordingRunner(invoke_real_command=True)
        adapter = D11FoundationAdapter(
            command_runner=runner,
            clock=lambda: OBSERVED_AT,
        )
        runtime_tuples = tuple(
            item for item in load_foundation_tuples() if item.row == "foundation-d11"
        )

        observations = tuple(
            adapter.observe_d11(runtime_tuple)
            for runtime_tuple in runtime_tuples
        )

        self.assertEqual(len(runtime_tuples), 2)
        self.assertEqual(len(observations), 2)
        self.assertEqual(len(runner.calls), 1)
        self.assertTrue(all(observation.passed for observation in observations))


if __name__ == "__main__":
    unittest.main()
