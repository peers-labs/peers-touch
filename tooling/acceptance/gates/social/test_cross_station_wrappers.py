from __future__ import annotations

import importlib
import json
import unittest
from pathlib import Path
from unittest import mock
from types import SimpleNamespace

from tooling.acceptance.gates.social.cross_station_support import (
    SCENARIO_IDS,
    ValidatedSuiteResult,
)


STATIC_MODULES = (
    "browser_zero_registration",
    "cross_station_contract",
    "cross_station_delivery",
    "cross_station_eventbus_contract",
    "cross_station_interaction",
    "cross_station_prekey",
    "cross_station_revocation_recovery",
)
ALL_MODULES = (
    *STATIC_MODULES,
    "cross_station_desktop_functional",
    "cross_station_mobile_desktop_e2e",
    "cross_station_native_e2e",
)
MODULE_PREFIX = "tooling.acceptance.gates.social."


def _suite_result() -> ValidatedSuiteResult:
    scenarios = {
        scenario_id: {
            "status": "PASS",
            "evidenceRefs": [f"{scenario_id}-receiver"],
        }
        for scenario_id in SCENARIO_IDS
    }
    payload = {
        "proofState": "UNPROVEN",
        "controlCommit": "a" * 40,
        "sourceCommit": "b" * 40,
        "scenarioResults": scenarios,
        "resourceReuse": {
            "provisioningRuns": 1,
            "clientLaunches": 3,
        },
        "runtimeManifest": {
            "state": "FIXTURE_READY",
            "runId": "css09-suite-runtime",
        },
        "cleanup": {"status": "CLEANED"},
        "suiteRuntimeReportDigest": "c" * 64,
    }
    return ValidatedSuiteResult(
        path=Path("/tmp/result.json"),
        payload=payload,
        suite_runtime_path=Path("/tmp/suite-runtime.json"),
        suite_runtime_report={},
        supporting_artifacts=(),
    )


class CrossStationStaticWrapperTest(unittest.TestCase):
    def test_static_wrappers_dispatch_only_declared_commands(self) -> None:
        for module_name in STATIC_MODULES:
            with self.subTest(module=module_name):
                module = importlib.import_module(MODULE_PREFIX + module_name)
                gate = module.Gate()
                with mock.patch.object(
                    module,
                    "run_source_commands",
                    return_value=[{"name": "focused"}],
                ) as run_commands:
                    result = gate.run()

                run_commands.assert_called_once_with(gate, module.COMMANDS)
                self.assertEqual([{"name": "focused"}], result["commands"])
                self.assertTrue(module.COMMANDS)
                self.assertTrue(
                    all(
                        command.argv
                        and isinstance(command.argv, tuple)
                        and command.timeout_seconds > 0
                        for command in module.COMMANDS
                    )
                )

    def test_browser_wrapper_uses_host_policy_tests_without_browser(self) -> None:
        module = importlib.import_module(
            MODULE_PREFIX + "browser_zero_registration"
        )
        command_text = "\n".join(
            " ".join(command.argv) for command in module.COMMANDS
        )

        self.assertIn("cross_station_eventbus_contract_test", command_text)
        self.assertIn("nativeRegistration.test.ts", command_text)
        self.assertNotIn("playwright", command_text.lower())

    def test_recovery_rust_tests_serialize_shared_keystore_access(self) -> None:
        module = importlib.import_module(
            MODULE_PREFIX + "cross_station_revocation_recovery"
        )
        recovery = next(
            command
            for command in module.COMMANDS
            if command.name == "recovery-desktop-rust"
        )

        self.assertEqual(
            ("--", "--test-threads=1"),
            recovery.argv[-2:],
        )


class CrossStationSuiteWrapperTest(unittest.TestCase):
    def test_desktop_functional_keeps_suite_unproven(self) -> None:
        module = importlib.import_module(
            MODULE_PREFIX + "cross_station_desktop_functional"
        )
        gate = module.Gate()
        gate.e2e_preflight = {"executionPolicy": "development"}
        suite = _suite_result()
        with (
            mock.patch.object(module, "load_suite_result", return_value=suite),
            mock.patch.object(module, "attach_suite_evidence") as attach,
        ):
            result = gate.run()

        attach.assert_called_once_with(gate, suite)
        self.assertEqual("UNPROVEN", result["proofState"])
        self.assertEqual([], result["provenScope"])

    def test_native_gate_runs_original_suite_once_on_prepared_binding(self) -> None:
        module = importlib.import_module(
            MODULE_PREFIX + "cross_station_native_e2e"
        )
        gate = module.Gate()
        suite = _suite_result()
        selected = SimpleNamespace(manifest={"runId": "provisioning"}, binding=mock.Mock(cell_id="desktop-macos-native"))
        prepared = mock.Mock()
        outcome = {**suite.payload, "suiteResult": str(suite.path)}
        with (
            mock.patch.object(module, "selected_native_runtime", return_value=selected),
            mock.patch.object(module, "PreparedSocialNativeRuntime", return_value=prepared),
            mock.patch.object(module, "current_run_directory", return_value=Path("/tmp/evidence")),
            mock.patch.object(module, "source_identity", return_value={}),
            mock.patch.object(module, "W7RuntimeOwner") as owner,
            mock.patch.object(module, "validate_suite_result", return_value=suite),
            mock.patch.object(module, "attach_suite_evidence") as attach,
        ):
            owner.return_value.run_social_cross_station_suite.return_value = outcome
            result = gate.run()

        owner.return_value.run_social_cross_station_suite.assert_called_once_with(prepared=prepared)
        prepared.cleanup.assert_called_once()
        attach.assert_called_once_with(gate, suite)
        self.assertEqual(
            selected.manifest,
            gate.report.manifest,
        )
        self.assertEqual(list(SCENARIO_IDS), result["provenScope"])
        self.assertEqual("UNPROVEN", result["suiteArtifactProofState"])

    def test_native_gate_failure_preserves_primary_and_cleans_once(self) -> None:
        module = importlib.import_module(MODULE_PREFIX + "cross_station_native_e2e")
        gate = module.Gate()
        failure = RuntimeError("original Suite failure")
        prepared = mock.Mock()
        prepared.cleanup.side_effect = RuntimeError("cleanup failed")
        with (
            mock.patch.object(module, "selected_native_runtime", return_value=SimpleNamespace(manifest={})),
            mock.patch.object(module, "PreparedSocialNativeRuntime", return_value=prepared),
            mock.patch.object(module, "current_run_directory", return_value=Path("/tmp/evidence")),
            mock.patch.object(module, "W7RuntimeOwner") as owner,
        ):
            owner.return_value.run_social_cross_station_suite.side_effect = failure
            with self.assertRaises(RuntimeError) as raised:
                gate.run()
        self.assertIs(failure, raised.exception)
        prepared.cleanup.assert_called_once()
        self.assertIn("cleanupFailure", gate.report.runtime)

    def test_native_gate_catalog_owns_preparation_and_shared_consumers(self) -> None:
        gate_catalog = json.loads(
            (
                Path(__file__).resolve().parents[2]
                / "gates.yaml"
            ).read_text(encoding="utf-8")
        )
        definition = gate_catalog["gates"]["social-cross-station-native-e2e"]

        self.assertEqual("cross-station-social-native", definition["environment"])
        self.assertEqual("env-evidence", definition["tier"])
        self.assertEqual(["desktop-macos-native"], definition["requiredRuntimeCells"])
        self.assertEqual("acceptance-binary", definition["runtimeCellArtifact"])
        for consumer in ("social-private-desktop-e2e", "social-cross-station-desktop-functional"):
            self.assertEqual(["social-cross-station-native-e2e"], gate_catalog["gates"][consumer]["dependsOn"])
            self.assertEqual("local", gate_catalog["gates"][consumer]["environment"])


class CrossStationMainContractTest(unittest.TestCase):
    def test_all_modules_expose_main_as_gate_execute(self) -> None:
        for module_name in ALL_MODULES:
            with self.subTest(module=module_name):
                module = importlib.import_module(MODULE_PREFIX + module_name)
                gate = mock.Mock()
                gate.execute.return_value = 17
                with mock.patch.object(module, "Gate", return_value=gate):
                    self.assertEqual(17, module.main())
                gate.execute.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
