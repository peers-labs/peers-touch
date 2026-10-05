from __future__ import annotations

import importlib
import unittest
from pathlib import Path
from unittest import mock

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
        suite = _suite_result()
        with (
            mock.patch.object(module, "load_suite_result", return_value=suite),
            mock.patch.object(module, "attach_suite_evidence") as attach,
        ):
            result = gate.run()

        attach.assert_called_once_with(gate, suite)
        self.assertEqual("UNPROVEN", result["proofState"])
        self.assertEqual([], result["provenScope"])

    def test_native_gate_consumes_suite_without_launching_runtime(self) -> None:
        module = importlib.import_module(
            MODULE_PREFIX + "cross_station_native_e2e"
        )
        gate = module.Gate()
        suite = _suite_result()
        with (
            mock.patch.object(module, "load_suite_result", return_value=suite),
            mock.patch.object(module, "attach_suite_evidence") as attach,
            mock.patch.object(
                module,
                "optional_acceptance_runtime_manifest",
                return_value=None,
            ) as load_manifest,
        ):
            result = gate.run()

        attach.assert_called_once_with(gate, suite)
        load_manifest.assert_called_once_with()
        self.assertEqual(list(SCENARIO_IDS), result["provenScope"])
        self.assertEqual("UNPROVEN", result["suiteArtifactProofState"])

    def test_native_gate_attaches_validated_acceptance_manifest(self) -> None:
        module = importlib.import_module(
            MODULE_PREFIX + "cross_station_native_e2e"
        )
        gate = module.Gate()
        suite = _suite_result()
        manifest_path = Path("/tmp/runtime-manifest.json")
        manifest = {"state": "FIXTURE_READY", "runId": "runtime"}
        with (
            mock.patch.object(module, "load_suite_result", return_value=suite),
            mock.patch.object(module, "attach_suite_evidence"),
            mock.patch.object(
                module,
                "optional_acceptance_runtime_manifest",
                return_value=(manifest_path, manifest),
            ),
            mock.patch.object(
                gate.report,
                "add_evidence_file",
            ) as add_evidence,
        ):
            gate.run()

        self.assertEqual(manifest, gate.report.manifest)
        add_evidence.assert_called_once_with(
            "acceptance-runtime-manifest",
            manifest_path,
        )


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
