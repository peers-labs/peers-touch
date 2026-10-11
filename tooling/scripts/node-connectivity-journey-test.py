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

        self.assertEqual(len(observed_environments), 3)
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


if __name__ == "__main__":
    unittest.main()
