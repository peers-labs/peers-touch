"""Producer → immutable Gate result → Reporter resource diagnostic checks."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.core import EvidenceStore, REPO_ROOT, blocked_manifest, new_manifest
from tooling.acceptance.core.errors import BlockedError, EphemeralCapabilityBlocked
from tooling.acceptance.core.gate import AcceptanceGate
from tooling.acceptance.core.launch_context import _blocked_error_from_response, _blocked_response
from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import CredentialRef, EnvironmentContract
from tooling.acceptance.provisioners.home_station import HomeStationProvisioner


def script_module(name: str):
    spec = importlib.util.spec_from_file_location(name, REPO_ROOT / f"tooling/scripts/{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def diagnostic() -> ResourceDiagnostic:
    return ResourceDiagnostic(
        owner="synthetic-resource-owner",
        recovery_action="bind the reviewed synthetic endpoint",
        resource_checks=[
            {
                "resource": "service:synthetic", "expected": "reviewed endpoint",
                "state": "OBSERVED", "observed": {"configured": False},
            },
            {
                "resource": "service:later", "expected": "reachable endpoint",
                "state": "NOT_EVALUATED", "reason": "endpoint was not configured",
            },
        ],
    )


class ResourceDiagnosticTests(unittest.TestCase):
    def test_home_station_preserves_core_credential_diagnostic(self) -> None:
        variable = "PT_DIAGNOSTIC_TEST_CREDENTIAL"
        owner = HomeStationProvisioner(EnvironmentContract(
            id="home-station",
            credentials=(CredentialRef(id="required", source_ref=f"env:{variable}"),),
        ))
        with patch.dict("os.environ", {variable: ""}):
            with self.assertRaises(BlockedError) as caught:
                owner.prepare_credentials()
        diagnostic = caught.exception.diagnostic.to_dict()
        self.assertEqual(diagnostic["owner"], "environment-provisioner:home-station")
        self.assertFalse(diagnostic["resourceChecks"][0]["observed"]["environmentVariablePresent"])

    def test_actual_credential_probe_survives_durable_result_and_reporter(self) -> None:
        class CredentialProbe(EnvironmentProvisioner):
            environment_id = "credential-probe"

            def provision(self, gate_id):
                raise NotImplementedError

        variable = "PT_DIAGNOSTIC_TEST_CREDENTIAL"
        owner = CredentialProbe(EnvironmentContract(
            id="credential-probe",
            credentials=(CredentialRef(id="required", source_ref=f"env:{variable}"),),
        ))
        with patch.dict("os.environ", {variable: ""}):
            with self.assertRaises(BlockedError) as caught:
                owner.prepare_credentials()
        error = caught.exception
        check = error.diagnostic.to_dict()["resourceChecks"][0]
        self.assertFalse(check["observed"]["environmentVariablePresent"])
        runner = script_module("acceptance-run")
        reporter = script_module("acceptance-report")
        source = {"commit": "credential-probe", "workspaceDigest": "clean"}
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
            with store.begin_run("credential-probe", source=source) as run:
                result = runner.runtime_cell_failure_result(
                    gate_id="credential-probe", command="credential-probe",
                    environment="credential-probe", tier="local-evidence",
                    runtime_cell="credential-probe", error=error, duration_seconds=0,
                )
                result = runner.record_failure_observation(result, run)
                result = runner.enrich_result_with_run_artifacts(result, run)
                run.finalize(result=result)
                delivered = {**result, "runManifest": run.manifest_ref.to_dict()}
            self.assertEqual(
                reporter.result_diagnostic(delivered, source, store)["missingFields"],
                [],
            )

    def test_checks_are_copied_validated_and_cover_the_blocked_resource(self) -> None:
        original = diagnostic().to_dict()
        copied = ResourceDiagnostic.from_dict(original)
        original["resourceChecks"][0]["observed"]["configured"] = True
        self.assertFalse(copied.to_dict()["resourceChecks"][0]["observed"]["configured"])
        with self.assertRaisesRegex(ValueError, "does not cover"):
            BlockedError("unavailable", "unrecorded-resource", diagnostic=copied)
        for change in (
            lambda value: value.update(owner=""),
            lambda value: value["resourceChecks"].append(value["resourceChecks"][0]),
            lambda value: value["resourceChecks"][0].pop("observed"),
            lambda value: value["resourceChecks"][1].update(reason=""),
            lambda value: value["resourceChecks"][0].update(evidenceArtifact={}),
        ):
            invalid = diagnostic().to_dict()
            change(invalid)
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                ResourceDiagnostic.from_dict(invalid)

    def test_manifest_and_ephemeral_transport_preserve_owner_observations(self) -> None:
        details = diagnostic()
        base = new_manifest("synthetic", "producer", "synthetic", "synthetic", 1, "abc", "repo")
        manifest = blocked_manifest(
            base, "endpoint unavailable", "service:synthetic", diagnostic=details,
        )
        self.assertEqual(manifest.to_dict()["diagnostic"], details.to_dict())
        converted = _blocked_error_from_response(_blocked_response(
            "request", EphemeralCapabilityBlocked(
                "endpoint unavailable", resource="service:synthetic", diagnostic=details,
            ),
        ))
        self.assertEqual(converted.diagnostic.to_dict(), details.to_dict())

    def test_preparation_failure_survives_successful_cleanup_and_seals_complete_diagnostic(self) -> None:
        runner = script_module("acceptance-run")
        reporter = script_module("acceptance-report")
        source = {"commit": "synthetic", "workspaceDigest": "clean"}
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
            with store.begin_run("producer", source=source) as run:
                result = runner.runtime_cell_failure_result(
                    gate_id="producer", command="synthetic", environment="synthetic",
                    tier="local-evidence", runtime_cell="synthetic-cell",
                    error=BlockedError(
                        "endpoint unavailable", "service:synthetic", diagnostic=diagnostic(),
                    ), duration_seconds=1,
                )
                run.write_json("reports/cleanup.json", {
                    "artifactKind": "acceptance-cleanup-report", "status": "passed",
                })
                result["cleanupStatus"] = "passed"
                result = runner.record_failure_observation(result, run)
                result = runner.enrich_result_with_run_artifacts(result, run)
                self.assertEqual(result["sourceArtifact"]["path"], "reports/execution-failure.json")
                self.assertEqual(result["blockedResource"], "service:synthetic")
                run.finalize(result=result)
                delivered = {**result, "runManifest": run.manifest_ref.to_dict()}
            projected = reporter.result_diagnostic(delivered, source, store)
            self.assertEqual(projected["missingFields"], [])
            self.assertEqual(projected["status"], "blocked")
            mutated = {**delivered, "blockedResource": "made-up-device"}
            self.assertIn(
                "runManifest.result.blockedResource: mismatch",
                reporter.result_diagnostic(mutated, source, store)["missingFields"],
            )
            self.assertIn(
                "runManifest.source: mismatch",
                reporter.result_diagnostic(delivered, {"commit": "other"}, store)["missingFields"],
            )

    def test_command_gate_keeps_diagnostic_but_cleanup_replacement_clears_it(self) -> None:
        class SyntheticGate(AcceptanceGate):
            gate_id = "synthetic-command"

            def run(self):
                raise BlockedError(
                    "endpoint unavailable", "service:synthetic", diagnostic=diagnostic(),
                )

        with tempfile.TemporaryDirectory() as directory:
            gate = SyntheticGate()
            gate.report_path = Path(directory) / "report.json"
            with patch.object(gate, "_print_blocked"):
                self.assertEqual(gate.execute(), 2)
            payload = json.loads(gate.report_path.read_text())
            self.assertEqual(payload["diagnostic"], diagnostic().to_dict())
            with patch.object(gate, "_cleanup_drivers", return_value=["synthetic cleanup failure"]), \
                    patch.object(gate, "_print_fail"):
                self.assertEqual(gate.execute(), 1)
            self.assertNotIn("diagnostic", json.loads(gate.report_path.read_text()))


if __name__ == "__main__":
    unittest.main()
