from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "tooling/scripts/node-connectivity-journey.py"
SPEC = importlib.util.spec_from_file_location(
    "node_connectivity_journey",
    SCRIPT,
)
assert SPEC is not None and SPEC.loader is not None
JOURNEY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(JOURNEY)


class NodeConnectivityJourneyTest(unittest.TestCase):
    def test_process_only_contracts_do_not_claim_receiver_visible_proof(
        self,
    ) -> None:
        for contract in (
            JOURNEY.DURABLE_EVENTS_RUNTIME_REUSE,
            JOURNEY.SHARED_ACCESS_RUNTIME_REUSE,
            JOURNEY.AGENT_FENCING_RUNTIME_REUSE,
            JOURNEY.OSS_FENCING_RUNTIME_REUSE,
        ):
            self.assertFalse(contract.require_receiver_visible_proof)

        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("SuiteRuntimeAction.UI_ACTION", source)
        self.assertNotIn("SuiteRuntimeAction.RECEIVER_ASSERTION", source)

    def test_cluster_runtime_contract_matches_ncp08(self) -> None:
        self.assertEqual(
            JOURNEY.CLUSTER_RUNTIME_REUSE.scenario_ids,
            (
                "NCP-G06-READINESS",
                "NCP-G06-AGENT",
                "NCP-G06-OSS",
            ),
        )
        self.assertEqual(
            JOURNEY.CLUSTER_RUNTIME_REUSE.max_client_launches,
            2,
        )
        self.assertFalse(
            JOURNEY.CLUSTER_RUNTIME_REUSE.require_receiver_visible_proof
        )

    def test_isolated_environment_rejects_repository_output(self) -> None:
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            JOURNEY.isolated_command_environment(REPO_ROOT)

    def test_ncp_g08_uses_external_cargo_target_for_every_command(self) -> None:
        observed_environments: list[dict[str, str]] = []

        def run_command(
            command: list[str],
            cwd: Path,
            timeout: int = 300,
            environment: dict[str, str] | None = None,
        ) -> dict[str, object]:
            del cwd, timeout
            self.assertIsNotNone(environment)
            observed_environments.append(dict(environment or {}))
            return {
                "command": command,
                "durationMs": 1,
                "status": "passed",
                "returnCode": 0,
            }

        with tempfile.TemporaryDirectory() as directory:
            work_root = Path(directory)
            with (
                mock.patch.object(
                    JOURNEY.tempfile,
                    "TemporaryDirectory",
                    return_value=contextlib.nullcontext(directory),
                ),
                mock.patch.object(JOURNEY, "run_command", side_effect=run_command),
                mock.patch.object(
                    JOURNEY.sys,
                    "argv",
                    [
                        str(SCRIPT),
                        "--closure",
                        "ncp-native-cut",
                        "--gate",
                        "NCP-G08",
                    ],
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(JOURNEY.main(), 0)

        self.assertEqual(len(observed_environments), 4)
        expected_target = str((work_root / "cargo-target").resolve())
        self.assertTrue(
            all(
                environment["CARGO_TARGET_DIR"] == expected_target
                for environment in observed_environments
            )
        )
        self.assertNotEqual(REPO_ROOT, Path(expected_target))
        self.assertNotIn(REPO_ROOT, Path(expected_target).parents)

    def test_durable_events_functional_uses_closed_test_set(self) -> None:
        observed: list[tuple[str, ...]] = []

        def run_events(
            tests: tuple[str, ...],
            **_: object,
        ) -> dict[str, object]:
            observed.append(tests)
            return {
                "command": ["go", "test"],
                "durationMs": 1,
                "status": "passed",
                "returnCode": 0,
            }

        output = io.StringIO()
        with (
            mock.patch.object(
                JOURNEY,
                "run_events_go_tests",
                side_effect=run_events,
            ),
            mock.patch.object(
                JOURNEY.sys,
                "argv",
                [
                    str(SCRIPT),
                    "--closure",
                    "ncp-durable-events",
                    "--functional",
                ],
            ),
            contextlib.redirect_stdout(output),
        ):
            self.assertEqual(JOURNEY.main(), 0)

        self.assertEqual(
            observed,
            [JOURNEY.DURABLE_EVENTS_FUNCTIONAL_TESTS],
        )
        report = json.loads(output.getvalue())
        self.assertEqual(report["closureId"], "ncp-durable-events")
        self.assertEqual(report["executionClass"], "functional")

    def test_shared_access_functional_uses_closed_test_sets(self) -> None:
        observed_frame: list[tuple[str, ...]] = []
        observed_oauth: list[tuple[str, ...]] = []

        def run_frame(
            tests: tuple[str, ...],
            **_: object,
        ) -> dict[str, object]:
            observed_frame.append(tests)
            return {
                "command": ["go", "test"],
                "durationMs": 1,
                "status": "passed",
                "returnCode": 0,
            }

        def run_oauth(
            tests: tuple[str, ...],
            **_: object,
        ) -> dict[str, object]:
            observed_oauth.append(tests)
            return {
                "command": ["go", "test"],
                "durationMs": 1,
                "status": "passed",
                "returnCode": 0,
            }

        output = io.StringIO()
        with (
            mock.patch.object(
                JOURNEY,
                "run_frame_access_go_tests",
                side_effect=run_frame,
            ),
            mock.patch.object(
                JOURNEY,
                "run_oauth_go_tests",
                side_effect=run_oauth,
            ),
            mock.patch.object(
                JOURNEY.sys,
                "argv",
                [
                    str(SCRIPT),
                    "--closure",
                    "ncp-shared-access",
                    "--functional",
                ],
            ),
            contextlib.redirect_stdout(output),
        ):
            self.assertEqual(JOURNEY.main(), 0)

        self.assertEqual(
            observed_frame,
            [JOURNEY.SHARED_ACCESS_FRAME_FUNCTIONAL_TESTS],
        )
        self.assertEqual(
            observed_oauth,
            [JOURNEY.SHARED_ACCESS_OAUTH_FUNCTIONAL_TESTS],
        )
        report = json.loads(output.getvalue())
        self.assertEqual(report["closureId"], "ncp-shared-access")
        self.assertEqual(report["executionClass"], "functional")

    def test_agent_fencing_functional_uses_closed_test_set(self) -> None:
        observed: list[tuple[str, ...]] = []
        observed_frame: list[tuple[str, ...]] = []

        def run_agent(
            tests: tuple[str, ...],
            **_: object,
        ) -> dict[str, object]:
            observed.append(tests)
            return {
                "command": ["go", "test"],
                "durationMs": 1,
                "status": "passed",
                "returnCode": 0,
            }

        def run_frame(
            tests: tuple[str, ...],
            **_: object,
        ) -> dict[str, object]:
            observed_frame.append(tests)
            return {
                "command": ["go", "test"],
                "durationMs": 1,
                "status": "passed",
                "returnCode": 0,
            }

        output = io.StringIO()
        with (
            mock.patch.object(
                JOURNEY,
                "run_agent_go_tests",
                side_effect=run_agent,
            ),
            mock.patch.object(
                JOURNEY,
                "run_agent_frame_go_tests",
                side_effect=run_frame,
            ),
            mock.patch.object(
                JOURNEY.sys,
                "argv",
                [
                    str(SCRIPT),
                    "--closure",
                    "ncp-agent-fencing",
                    "--functional",
                ],
            ),
            contextlib.redirect_stdout(output),
        ):
            self.assertEqual(JOURNEY.main(), 0)

        self.assertEqual(
            observed,
            [JOURNEY.AGENT_FENCING_FUNCTIONAL_TESTS],
        )
        self.assertEqual(
            observed_frame,
            [JOURNEY.AGENT_FENCING_FRAME_FUNCTIONAL_TESTS],
        )
        report = json.loads(output.getvalue())
        self.assertEqual(report["closureId"], "ncp-agent-fencing")
        self.assertEqual(report["executionClass"], "functional")


if __name__ == "__main__":
    unittest.main()
