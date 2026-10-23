"""Producer → immutable Gate result → Reporter resource diagnostic checks."""

from __future__ import annotations

import importlib.util
import dataclasses
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import socket
import subprocess
import tempfile
from threading import Thread
import unittest
from unittest.mock import Mock, patch
import sys

from tooling.acceptance.core import EvidenceStore, REPO_ROOT, blocked_manifest, new_manifest
from tooling.acceptance.core.errors import BlockedError, EphemeralCapabilityBlocked, EphemeralLaunchTimeout
from tooling.acceptance.core.gate import AcceptanceGate
from tooling.acceptance.core.launch_context import (
    GateLaunchSpec, GateProcessLauncher, _blocked_error_from_response, _blocked_response,
)
from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.lease import RemoteGitSourceLease
from tooling.acceptance.core.provisioning import CredentialRef, EnvironmentContract
from tooling.acceptance.drivers.native.base import (
    NativeControlSnapshot, admit_local_native_input_mode,
)
from tooling.acceptance.drivers.native.macos import MacOSNativeDesktopAdapter
from tooling.acceptance.provisioners.home_station import HomeStationProvisioner
from tooling.acceptance.provisioners.native_desktop_macos import NativeDesktopMacOSProvisioner
from tooling.acceptance.provisioners.native_tauri_embedded_webdriver import (
    NativeTauriEmbeddedWebDriverProvisioner,
)


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
    def test_native_input_admission_records_actual_configuration(self) -> None:
        cases = (
            ("unsupported", "", "inputMode", "unsupported"),
            ("semantic-nonintrusive", "unsupported", "inputIsolation", "unsupported"),
            ("exclusive-native-input", "", "inputIsolation", "shared-user-session"),
            ("exclusive-native-input", "shared-user-session",
             "inputIsolation", "shared-user-session"),
        )
        for mode, isolation, field, actual in cases:
            with self.subTest(mode=mode, isolation=isolation):
                with self.assertRaises(BlockedError) as caught:
                    admit_local_native_input_mode(mode, isolation)
                details = caught.exception.diagnostic.to_dict()
                self.assertEqual(details["owner"], "native-input-policy")
                check = details["resourceChecks"][0]
                self.assertEqual(check["state"], "OBSERVED")
                self.assertEqual(check["observed"][field], actual)
                self.assertEqual(
                    check["resource"], "desktop-native-input-isolation",
                )
                self.assertNotIn("source", check["observed"])
                self.assertNotIn("device", check["observed"])
                self.assertTrue(details["recoveryAction"])

    def test_native_input_refusal_survives_command_sealing_and_reporter(self) -> None:
        class InputGate(AcceptanceGate):
            gate_id = "native-input-probe"
            phase = "native input"
            bom = ("synthetic",)
            spec = ("synthetic",)

            def run(self):
                MacOSNativeDesktopAdapter().require_exclusive_input(
                    "select file through native chooser",
                )

        runner = script_module("acceptance-run")
        reporter = script_module("acceptance-report")
        source = {"commit": "native-input-probe", "workspaceDigest": "clean"}
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
            with store.begin_run(InputGate.gate_id, source=source) as run:
                gate = InputGate()
                with patch.dict("os.environ", run.subprocess_environment()), \
                        patch.object(gate, "_print_blocked"):
                    self.assertEqual(gate.execute(), 2)
                result = runner.enrich_result_with_run_artifacts({
                    "id": gate.gate_id, "status": "blocked", "exit_code": 2,
                    "tier": "local-evidence", "cleanupStatus": "passed",
                }, run)
                run.finalize(result=result)
                delivered = {**result, "runManifest": run.manifest_ref.to_dict()}
            projected = reporter.result_diagnostic(delivered, source, store)
            self.assertEqual(projected["missingFields"], [])
            self.assertEqual(projected["status"], "blocked")
            self.assertEqual(delivered["proofStatus"], "UNPROVEN")
            check = projected["resourceChecks"][0]
            self.assertEqual(check["expected"]["inputMode"], "exclusive-native-input")
            self.assertEqual(check["observed"]["inputMode"], "semantic-nonintrusive")
            self.assertEqual(
                check["observed"]["operation"], "select file through native chooser",
            )
            self.assertIn("isolated GUI", projected["recoveryAction"])
            self.assertIn("Station Profile", projected["recoveryAction"])
            self.assertIn(
                "runManifest.result.blockedResource: mismatch",
                reporter.result_diagnostic(
                    {**delivered, "blockedResource": "made-up-device"}, source, store,
                )["missingFields"],
            )

    def test_operator_focus_refusals_seal_actual_pid_and_probe_state(self) -> None:
        runner = script_module("acceptance-run")
        reporter = script_module("acceptance-report")
        source = {"commit": "operator-focus-probe", "workspaceDigest": "clean"}
        controls = (
            NativeControlSnapshot(
                actual_frontmost_pid=42, title="private-title-not-evidence",
            ),
            NativeControlSnapshot(
                actual_frontmost_pid=41, error="AX probe unavailable",
                title="private-title-not-evidence",
            ),
        )
        for index, control in enumerate(controls):
            with self.subTest(control=control.actual_frontmost_pid):
                adapter = Mock(spec=MacOSNativeDesktopAdapter)
                adapter.focused_control.return_value = control
                with self.assertRaises(BlockedError) as caught:
                    NativeDesktopMacOSProvisioner._stable_operator_focus_identity(
                        adapter, 41, timeout_seconds=0, interval_seconds=0,
                    )
                error = caught.exception
                details = error.diagnostic.to_dict()
                check = details["resourceChecks"][0]
                self.assertEqual(check["expected"]["frontmostPid"], 41)
                self.assertEqual(
                    check["observed"]["frontmostPid"], control.actual_frontmost_pid,
                )
                self.assertNotIn("private-title-not-evidence", json.dumps(details))
                gate_id = f"operator-focus-probe-{index}"
                with tempfile.TemporaryDirectory() as directory:
                    store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
                    with store.begin_run(gate_id, source=source) as run:
                        result = runner.runtime_cell_failure_result(
                            gate_id=gate_id, command="operator-focus-probe",
                            environment="native-tauri-embedded-webdriver",
                            tier="local-evidence", runtime_cell="desktop-macos-native",
                            error=error, duration_seconds=0,
                        )
                        result["cleanupStatus"] = "passed"
                        result = runner.record_failure_observation(result, run)
                        result = runner.enrich_result_with_run_artifacts(result, run)
                        run.finalize(result=result)
                        delivered = {**result, "runManifest": run.manifest_ref.to_dict()}
                    projected = reporter.result_diagnostic(delivered, source, store)
                    self.assertEqual(projected["missingFields"], [])
                    self.assertEqual(projected["status"], "blocked")
                    self.assertEqual(delivered["proofStatus"], "UNPROVEN")

    def test_health_probe_records_real_success_and_connection_refusal(self) -> None:
        owner = HomeStationProvisioner(EnvironmentContract(id="home-station"))

        class Healthy(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(204)
                self.end_headers()

            def log_message(self, *args):
                pass

        with HTTPServer(("127.0.0.1", 0), Healthy) as server:
            server.timeout = 1
            worker = Thread(target=server.handle_request)
            worker.start()
            endpoint = f"http://127.0.0.1:{server.server_port}/healthz"
            try:
                observed = owner._station_health(endpoint, endpoint)
            finally:
                worker.join(timeout=2)
            self.assertFalse(worker.is_alive())
        self.assertTrue(observed["ready"])
        self.assertEqual(observed["statusCode"], 204)
        self.assertEqual(observed["endpoint"], endpoint)

        with socket.socket() as unavailable:
            unavailable.bind(("127.0.0.1", 0))
            endpoint = f"http://127.0.0.1:{unavailable.getsockname()[1]}/healthz"
        observed = owner._station_health(endpoint, endpoint)
        self.assertFalse(observed["ready"])
        self.assertEqual(observed["causeType"], "ConnectionRefusedError")
        self.assertIsInstance(observed["errno"], int)
        self.assertNotIn("statusCode", observed)

    def test_native_health_failure_survives_sealing_without_inventing_source_drift(self) -> None:
        class Unhealthy(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(503)
                self.send_header("X-Private-Detail", "private-response-not-evidence")
                self.end_headers()

            def log_message(self, *args):
                pass

        contract = EnvironmentContract.from_yaml(
            REPO_ROOT / "tooling/acceptance/environments/native-tauri-embedded-webdriver.yaml",
        )
        contract = dataclasses.replace(
            contract, services={"station-four": contract.services["station-four"]},
        )
        owner = NativeTauriEmbeddedWebDriverProvisioner(
            contract, station_profiles={"station-four": "chat-native-disposable"},
        )
        base = owner._new_base_manifest("health-probe")
        with HTTPServer(("127.0.0.1", 0), Unhealthy) as server:
            server.timeout = 1
            endpoint = f"http://127.0.0.1:{server.server_port}"
            worker = Thread(target=server.handle_request)
            worker.start()
            module = "tooling.acceptance.provisioners.native_tauri_embedded_webdriver."
            with patch(module + "resolve_reviewed_profile_environment", return_value=(
                Path("/reviewed/profile.env"), {
                    "PT_STATION_MODE": "remote", "PT_STATION_URL": endpoint,
                    "PT_STATION_HEALTH_URL": endpoint + "/healthz",
                    "PT_STATION_DEPLOY_ENV": "chat-native-disposable-station",
                },
            )), patch(module + "resolve_deployment_environment_path", return_value=Path("/reviewed/deploy.env")), patch(
                module + "load_env_file", return_value={},
            ), patch(module + "source_proto_digest", return_value="probe-protocol"), patch.object(
                owner, "acquire_profile_lease",
            ), patch.object(owner, "acquire_remote_git_source_lease"), patch(
                module + "produce_station_attestation",
            ) as source_attestation:
                try:
                    with self.assertRaises(BlockedError) as caught:
                        owner._provision_station_services(base)
                finally:
                    worker.join(timeout=2)
            self.assertFalse(worker.is_alive())
        source_attestation.assert_not_called()
        error = caught.exception
        details = error.diagnostic.to_dict()
        self.assertEqual(details["owner"], "native-tauri-embedded-webdriver-provisioner")
        observed = details["resourceChecks"][0]["observed"]
        self.assertEqual(observed["statusCode"], 503)
        self.assertEqual(observed["endpoint"], endpoint + "/healthz")
        self.assertFalse(observed["ready"])
        self.assertEqual(details["resourceChecks"][1]["state"], "NOT_EVALUATED")
        self.assertIn("chat-native-disposable", details["recoveryAction"])
        self.assertNotIn("private-response-not-evidence", json.dumps(details))
        runner = script_module("acceptance-run")
        reporter = script_module("acceptance-report")
        source = {"commit": base.source_commit, "workspaceDigest": base.workspace_digest}
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
            with store.begin_run("health-probe", source=source) as run:
                result = runner.runtime_cell_failure_result(
                    gate_id="health-probe", command="health-probe",
                    environment=contract.id, tier="local-evidence",
                    runtime_cell="health-probe", error=error, duration_seconds=0,
                )
                result["cleanupStatus"] = "passed"
                result = runner.record_failure_observation(result, run)
                result = runner.enrich_result_with_run_artifacts(result, run)
                run.finalize(result=result)
                delivered = {**result, "runManifest": run.manifest_ref.to_dict()}
            projected = reporter.result_diagnostic(delivered, source, store)
            self.assertEqual(projected["missingFields"], [])
            self.assertEqual(projected["status"], "blocked")
            self.assertEqual(delivered["proofStatus"], "UNPROVEN")

    def test_actual_remote_lease_handshake_timeout_seals_unknown_source_state(self) -> None:
        owner = HomeStationProvisioner(EnvironmentContract(id="home-station"))
        processes = []
        start_process = subprocess.Popen

        def observe_process(*args, **kwargs):
            process = start_process(*args, **kwargs)
            processes.append(process)
            return process

        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            environment = {
                "PT_DEPLOY_HOST": "127.0.0.1", "PT_DEPLOY_USER": "probe",
                "PT_DEPLOY_PATH": "/probe",
                "PT_DEPLOY_SSH_PORT": str(listener.getsockname()[1]),
            }
            with patch(
                "tooling.acceptance.core.provisioner.resolve_deployment_environment_path",
                return_value=Path("/probe.env"),
            ), patch(
                "tooling.acceptance.core.provisioner.load_env_file",
                return_value=environment,
            ), patch(
                "tooling.acceptance.core.provisioner.RemoteGitSourceLease",
                side_effect=lambda *args, **kwargs: RemoteGitSourceLease(
                    *args, **kwargs, acquire_timeout=0.1,
                ),
            ), patch(
                "tooling.acceptance.core.lease.subprocess.Popen",
                side_effect=observe_process,
            ):
                with self.assertRaises(BlockedError) as caught:
                    owner.acquire_remote_git_source_lease("handshake-probe", "probe-owner")
        error = caught.exception
        details = error.diagnostic.to_dict()
        self.assertEqual(details["owner"], "environment-provisioner:home-station")
        self.assertIn("SSH lease handshake timed out", error.reason)
        observed = details["resourceChecks"][0]["observed"]
        self.assertFalse(observed["leaseAcquired"])
        self.assertEqual(observed["host"], "127.0.0.1")
        self.assertEqual(details["resourceChecks"][1]["state"], "NOT_EVALUATED")
        self.assertEqual(len(processes), 1)
        self.assertIsNotNone(processes[0].poll())
        runner = script_module("acceptance-run")
        reporter = script_module("acceptance-report")
        source = {"commit": "handshake-probe", "workspaceDigest": "clean"}
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
            with store.begin_run("handshake-probe", source=source) as run:
                result = runner.runtime_cell_failure_result(
                    gate_id="handshake-probe", command="handshake-probe",
                    environment="home-station", tier="local-evidence",
                    runtime_cell="handshake-probe", error=error, duration_seconds=0,
                )
                result["cleanupStatus"] = "passed"
                result = runner.record_failure_observation(result, run)
                result = runner.enrich_result_with_run_artifacts(result, run)
                run.finalize(result=result)
                delivered = {**result, "runManifest": run.manifest_ref.to_dict()}
            projected = reporter.result_diagnostic(delivered, source, store)
            self.assertEqual(projected["missingFields"], [])
            self.assertEqual(projected["status"], "blocked")
            self.assertEqual(delivered["proofStatus"], "UNPROVEN")

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

    def test_sealed_supporting_json_values_preserve_diagnostics_and_hash_checks(self) -> None:
        runner = script_module("acceptance-run")
        reporter = script_module("acceptance-report")
        source = {"commit": "synthetic", "workspaceDigest": "clean"}
        values = [
            [{"artifactKind": "acceptance-runtime-manifest", "services": ["untrusted"]}],
            [], "supporting observation", 3, True, None,
        ]
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
                references = [
                    run.write_bytes(
                        f"reports/supporting-{index}.json",
                        json.dumps(value).encode(), media_type="application/json",
                    ) for index, value in enumerate(values)
                ]
                result = runner.record_failure_observation(result, run)
                result = runner.enrich_result_with_run_artifacts(result, run)
                # Mislabelled supporting metadata must not become a deployment.
                result["evidenceArtifacts"] += [
                    {"path": ref.to_dict(), "artifactKind": "service-deployment-attestation"}
                    for ref in references
                ]
                run.finalize(result=result)
                delivered = {**result, "runManifest": run.manifest_ref.to_dict()}
            projected = reporter.result_diagnostic(delivered, source, store)
            self.assertEqual(projected["missingFields"], [])
            self.assertEqual(projected["runtime"], {})
            self.assertEqual(projected["deployments"], [])
            supporting = [
                item for item in projected["evidence"]
                if item["artifact"] in [ref.to_dict() for ref in references]
            ]
            self.assertEqual(len(supporting), len(values))
            self.assertEqual(supporting[0]["jsonValueType"], "array")
            self.assertEqual(supporting[0]["itemCount"], 1)
            store.resolve(references[0]).write_text("[]")
            self.assertIn(
                "evidence: invalid reports/supporting-0.json",
                reporter.result_diagnostic(delivered, source, store)["missingFields"],
            )

    def test_sealed_source_observation_must_remain_a_json_object(self) -> None:
        reporter = script_module("acceptance-report")
        source = {"commit": "synthetic", "workspaceDigest": "clean"}
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
            with store.begin_run("producer", source=source) as run:
                ref = run.write_bytes(
                    "reports/source.json", b"[]", media_type="application/json",
                )
                result = {
                    "id": "producer", "status": "failed", "proofStatus": "UNPROVEN",
                    "sourceArtifact": ref.to_dict(), "reason": "synthetic",
                }
                run.finalize(result=result)
                delivered = {**result, "runManifest": run.manifest_ref.to_dict()}
            self.assertIn(
                "evidence: invalid reports/source.json",
                reporter.result_diagnostic(delivered, source, store)["missingFields"],
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

    def test_ordinary_command_failure_is_sealed_and_reporter_complete(self) -> None:
        class FailingGate(AcceptanceGate):
            gate_id = "synthetic-command-failure"
            phase = "synthetic command"
            bom = ("synthetic",)
            spec = ("synthetic",)

            def run(self):
                self.report.runtime["firstFailedStep"] = "synthetic.action"
                raise RuntimeError("observed command rejection")

        runner = script_module("acceptance-run")
        reporter = script_module("acceptance-report")
        source = {"commit": "synthetic", "workspaceDigest": "clean"}
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
            with store.begin_run(FailingGate.gate_id, source=source) as run:
                gate = FailingGate()
                with patch.dict("os.environ", run.subprocess_environment()), \
                        patch.object(gate, "_print_fail"):
                    self.assertEqual(gate.execute(), 1)
                result = runner.enrich_result_with_run_artifacts({
                    "id": gate.gate_id, "status": "failed", "exit_code": 1,
                    "tier": "local-evidence", "cleanupStatus": "passed",
                }, run)
                self.assertEqual(result["reason"], "observed command rejection")
                self.assertEqual(
                    result["diagnostic"]["owner"],
                    f"{Path(__file__).resolve()}::{FailingGate.__qualname__}",
                )
                self.assertEqual(result["diagnostic"]["resourceChecks"][0]["observed"]["firstFailedStep"],
                                 "synthetic.action")
                run.finalize(result=result)
                delivered = {**result, "runManifest": run.manifest_ref.to_dict()}
            self.assertEqual(reporter.result_diagnostic(delivered, source, store)["missingFields"], [])

    def test_script_command_failure_names_actual_implementation_owner(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "actual_gate.py"
            report = Path(directory) / "report.json"
            script.write_text(
                "from pathlib import Path\n"
                "import sys\n"
                "from tooling.acceptance.core.gate import AcceptanceGate\n"
                "class ScriptGate(AcceptanceGate):\n"
                "    gate_id = 'script-owner'\n"
                "    def run(self):\n"
                "        raise RuntimeError('actual script failure')\n"
                "gate = ScriptGate()\n"
                "gate.report_path = Path(sys.argv[1])\n"
                "raise SystemExit(gate.execute())\n",
            )
            completed = subprocess.run(
                [sys.executable, str(script), str(report)],
                cwd=REPO_ROOT, capture_output=True, text=True, timeout=10,
                env={**os.environ, "PYTHONPATH": str(REPO_ROOT)},
            )
            self.assertEqual(completed.returncode, 1, completed.stderr)
            diagnostic = json.loads(report.read_text())["diagnostic"]
            self.assertEqual(diagnostic["owner"], f"{script.resolve()}::ScriptGate")
            self.assertEqual(
                diagnostic["resourceChecks"][0]["observed"]["error"],
                "actual script failure",
            )

    def test_actual_command_timeout_is_not_a_missing_capability(self) -> None:
        launcher = GateProcessLauncher(termination_timeout_seconds=0.2)
        with self.assertRaises(EphemeralLaunchTimeout) as caught:
            launcher.run(
                GateLaunchSpec(
                    argv=(sys.executable, "-c", "import time;time.sleep(5)"),
                    timeout_seconds=0.05, required_capabilities=(),
                ), None,
            )
        runner = script_module("acceptance-run")
        reporter = script_module("acceptance-report")
        source = {"commit": "synthetic", "workspaceDigest": "clean"}
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
            with store.begin_run("synthetic-timeout", source=source) as run:
                result = runner.ephemeral_launch_failure_result(
                    gate_id="synthetic-timeout", command="synthetic", environment="local",
                    tier="local-evidence", error=caught.exception, duration_seconds=0.05,
                )
                result["status"] = "failed"
                result["completionStatus"] = "PARTIAL"
                result["cleanupStatus"] = "passed"
                result = runner.record_failure_observation(result, run)
                result = runner.enrich_result_with_run_artifacts(result, run)
                self.assertEqual(result["blockedResource"], "gate-command-process")
                observed = result["diagnostic"]["resourceChecks"][0]["observed"]
                self.assertTrue(observed["deadlineExceeded"])
                self.assertEqual(observed["processCleanup"], "completed")
                run.finalize(result=result)
                delivered = {**result, "runManifest": run.manifest_ref.to_dict()}
            self.assertEqual(reporter.result_diagnostic(delivered, source, store)["missingFields"], [])


if __name__ == "__main__":
    unittest.main()
