from __future__ import annotations

import json
import subprocess
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from tooling.acceptance.gates.agent.foundation_candidate_producer import (
    FoundationCandidateError,
    FoundationRolePolicy,
    FoundationTuple,
)
from tooling.acceptance.gates.agent.foundation_mobile_contract_adapter import (
    MOBILE_ADAPTER_ROLES,
    MOBILE_CELL_ASSERTIONS,
    MOBILE_CONTRACT_SOURCE_PATHS,
    MOBILE_TEST_COMMAND,
    MobileContractFoundationAdapter,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
OBSERVED_AT = datetime(2026, 8, 24, 12, 0, tzinfo=timezone.utc)


def _runtime_tuple(cell: str) -> FoundationTuple:
    return FoundationTuple(
        gate="agent-v2-kernel-foundation-e2e",
        row="foundation-mobile-contract",
        platform="mobile_contract",
        runtime="contract_only",
        cell=cell,
        locale="contract",
        ordering="default",
        sample_id="default",
        role_policy=FoundationRolePolicy(
            always=("cell-results", "runtime-attestation-set", "cleanup"),
            required=("contract-evidence",),
            not_applicable=(
                "receiver-dom",
                "station-readback",
                "runtime-events",
                "measurement-report",
                "side-effect-count",
                "replay",
                "guard-report",
            ),
        ),
        runtime_attestation_profile="contract_only",
    )


def _vitest_report(
    *,
    omitted: str | None = None,
    failed: str | None = None,
) -> str:
    assertions = []
    for cell, marker in MOBILE_CELL_ASSERTIONS.items():
        if cell == omitted:
            continue
        assertions.append(
            {
                "fullName": (
                    "Modern Chat Agent V2 Mobile Foundation contracts "
                    f"{marker} assertion"
                ),
                "status": "failed" if cell == failed else "passed",
            }
        )
    return json.dumps(
        {
            "success": failed is None,
            "testResults": [{"assertionResults": assertions}],
        }
    )


def _completed(
    stdout: str,
    *,
    returncode: int = 0,
    stderr: str = "",
) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(
        MOBILE_TEST_COMMAND,
        returncode,
        stdout=f"pnpm preamble\n{stdout}\n",
        stderr=stderr,
    )


class MobileContractFoundationAdapterTest(unittest.TestCase):
    def test_runs_vitest_once_and_emits_only_d12_mobile_roles(self) -> None:
        runner = mock.Mock(return_value=_completed(_vitest_report()))
        adapter = MobileContractFoundationAdapter(
            repo_root=REPO_ROOT,
            runner=runner,
            now=lambda: OBSERVED_AT,
        )

        observations = [
            adapter.observe_mobile_contract(_runtime_tuple(cell))
            for cell in MOBILE_CELL_ASSERTIONS
        ]

        runner.assert_called_once_with(
            MOBILE_TEST_COMMAND,
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
            timeout=120,
        )
        self.assertEqual(len(observations), 15)
        contract_hashes = {
            item.runtime_attestation.payload["contractAttestation"][
                "contractHash"
            ]
            for item in observations
        }
        self.assertEqual(len(contract_hashes), 1)
        self.assertRegex(contract_hashes.pop(), r"^[0-9a-f]{64}$")
        for cell, observation in zip(MOBILE_CELL_ASSERTIONS, observations):
            with self.subTest(cell=cell):
                self.assertTrue(observation.observed)
                self.assertTrue(observation.passed)
                self.assertEqual(
                    observation.runtime_attestation.profile,
                    "contract_only",
                )
                self.assertEqual(
                    set(observation.role_observations),
                    MOBILE_ADAPTER_ROLES,
                )
                self.assertEqual(
                    observation.role_observations["cell-results"]["cellId"],
                    cell,
                )
                source_files = observation.role_observations[
                    "contract-evidence"
                ]["sourceFiles"]
                self.assertEqual(
                    [item["path"] for item in source_files],
                    [path.as_posix() for path in MOBILE_CONTRACT_SOURCE_PATHS],
                )
                self.assertTrue(
                    all(
                        len(item["sha256"]) == 64
                        for item in source_files
                    )
                )

    def test_missing_or_failed_cell_result_fails_closed_and_is_not_rerun(self) -> None:
        for missing, failed, expected in (
            ("AS-15-P04", None, "missing=.*AS-15-P04"),
            (None, "AS-F10", "report did not succeed"),
        ):
            with self.subTest(missing=missing, failed=failed):
                runner = mock.Mock(
                    return_value=_completed(
                        _vitest_report(omitted=missing, failed=failed)
                    )
                )
                adapter = MobileContractFoundationAdapter(
                    repo_root=REPO_ROOT,
                    runner=runner,
                    now=lambda: OBSERVED_AT,
                )
                with self.assertRaisesRegex(FoundationCandidateError, expected):
                    adapter.observe_mobile_contract(
                        _runtime_tuple("AS-15-P01")
                    )
                with self.assertRaises(FoundationCandidateError):
                    adapter.observe_mobile_contract(
                        _runtime_tuple("AS-15-P02")
                    )
                self.assertEqual(runner.call_count, 1)

    def test_command_and_json_report_failures_are_closed(self) -> None:
        cases = (
            (_completed("{}", returncode=2, stderr="vitest failed"), "exit code 2"),
            (_completed("not json"), "no JSON report"),
            (
                _completed(
                    json.dumps({"success": True, "testResults": {}})
                ),
                "no testResults array",
            ),
        )
        for completed, expected in cases:
            with self.subTest(expected=expected):
                adapter = MobileContractFoundationAdapter(
                    repo_root=REPO_ROOT,
                    runner=mock.Mock(return_value=completed),
                    now=lambda: OBSERVED_AT,
                )
                with self.assertRaisesRegex(FoundationCandidateError, expected):
                    adapter.observe_mobile_contract(
                        _runtime_tuple("AS-15-P01")
                    )

    def test_unmapped_cell_wrong_profile_and_wrong_roles_fail_before_vitest(self) -> None:
        runner = mock.Mock(return_value=_completed(_vitest_report()))
        adapter = MobileContractFoundationAdapter(
            repo_root=REPO_ROOT,
            runner=runner,
            now=lambda: OBSERVED_AT,
        )

        with self.assertRaisesRegex(
            FoundationCandidateError,
            "no assertion mapping",
        ):
            adapter.observe_mobile_contract(_runtime_tuple("AS-15-UNKNOWN"))

        wrong_profile = _runtime_tuple("AS-15-P01")
        object.__setattr__(
            wrong_profile,
            "runtime_attestation_profile",
            "direct_runtime",
        )
        with self.assertRaisesRegex(FoundationCandidateError, "contract_only"):
            adapter.observe_mobile_contract(wrong_profile)

        wrong_roles = _runtime_tuple("AS-15-P01")
        object.__setattr__(
            wrong_roles,
            "role_policy",
            FoundationRolePolicy(
                always=("cell-results", "runtime-attestation-set", "cleanup"),
                required=("contract-evidence", "receiver-dom"),
                not_applicable=(),
            ),
        )
        with self.assertRaisesRegex(FoundationCandidateError, "D-12"):
            adapter.observe_mobile_contract(wrong_roles)
        runner.assert_not_called()

    def test_missing_exact_source_fails_after_successful_vitest(self) -> None:
        adapter = MobileContractFoundationAdapter(
            repo_root=Path("/definitely/missing/peers-ai-agent"),
            runner=mock.Mock(return_value=_completed(_vitest_report())),
            now=lambda: OBSERVED_AT,
        )

        with self.assertRaisesRegex(
            FoundationCandidateError,
            "source is unavailable",
        ):
            adapter.observe_mobile_contract(_runtime_tuple("AS-15-P01"))


if __name__ == "__main__":
    unittest.main()
