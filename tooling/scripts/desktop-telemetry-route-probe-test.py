#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock


def load_module() -> Any:
    script = Path(__file__).with_name("desktop-telemetry-route-probe.py")
    spec = importlib.util.spec_from_file_location("desktop_telemetry_route_probe", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopTelemetryRouteProbeTest(unittest.TestCase):
    def test_default_runtime_closure_persists_typed_ref_without_artifact_root_path(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "artifact-root"
            runtime_closure = root / "runtime-closure.json"
            output = Path(tmp) / "route.json"
            artifact_ref = {
                "workspaceId": "workspace",
                "gateId": "desktop-telemetry-runtime-closure-gate",
                "runId": "run",
                "path": "report",
            }

            def fake_build_report(*args, **kwargs) -> dict:
                return {
                    "status": "diagnostic incomplete",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "runtimeClosureEvidence": {"path": str(runtime_closure)},
                }

            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-telemetry-route-probe.py",
                    "--output",
                    str(output),
                ]
                with mock.patch.object(
                    module,
                    "latest_artifact",
                    return_value=(runtime_closure, artifact_ref),
                ), mock.patch.object(module, "build_report", side_effect=fake_build_report), mock.patch.object(
                    module,
                    "render_markdown",
                    return_value="route\n",
                ):
                    module.main()
            finally:
                sys.argv = old_argv

            persisted = output.read_text(encoding="utf-8")

        self.assertNotIn(str(root), persisted)
        self.assertIn('"runtimeClosureArtifactRef"', persisted)
        self.assertIn('"workspaceId": "workspace"', persisted)

    def write_runtime_closure_report(self, root: Path, status: str = "diagnostic incomplete") -> Path:
        path = root / "desktop-telemetry-runtime-closure-gate.json"
        path.write_text(
            json.dumps(
                {
                    "artifactKind": "desktop-telemetry-runtime-closure-gate",
                    "status": status,
                    "completionStatus": "DONE" if status == "pass" else "PARTIAL",
                    "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
                    "phase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                    "bom": ["BOM-RUN-03", "BOM-RUN-04", "BOM-CON-03", "BOM-CON-04", "BOM-CAP-05", "BOM-RUN-05"],
                    "spec": [
                        "SPEC-GW-01",
                        "SPEC-STA-01",
                        "SPEC-STA-02",
                        "SPEC-DB-01",
                        "SPEC-DB-02",
                        "SPEC-STA-03",
                        "SPEC-MIRROR-01",
                    ],
                    "gate": "P0a Station runtime proof must use a managed Station+Postgres dependency closure before Gateway upload, route probe, query, rollup, mirror, or runtime sample emission can be trusted",
                    "sampleEmissionAllowed": status == "pass",
                    "managedRuntimeClosure": "compose-station-postgres" if status == "pass" else None,
                    "summary": {
                        "localRuntimeClosureProofStatus": "UNPROVEN",
                        "composeRuntimeClosureProofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
                        "dockerDaemonProofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
                        "failedCheckCount": 0 if status == "pass" else 3,
                          "checkReasons": {
                              "docker-daemon": "command exited 1" if status != "pass" else "docker daemon is reachable"
                          },
                          "failedCheckReasons": {"docker-daemon": "command exited 1"} if status != "pass" else {},
                          "localRuntimeClosure": {
                              "proofStatus": "UNPROVEN" if status != "pass" else "PROVEN",
                              "sampleEmissionAllowed": status == "pass",
                          },
                          "composeRuntimeClosure": {
                              "proofStatus": "UNPROVEN" if status != "pass" else "PROVEN",
                              "sampleEmissionAllowed": status == "pass",
                          },
                    },
                }
            ),
            encoding="utf-8",
        )
        return path

    def target_runtime_unproven(self) -> dict[str, Any]:
        return {
            "sourceKind": "target-station-runtime-route-fingerprint",
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "versionStatus": "diagnostic incomplete",
            "handlerTableStatus": "diagnostic incomplete",
            "handlerTableProofStatus": "UNPROVEN",
            "handlerCount": 0,
            "requiredRouteContracts": [],
            "matchedRouteContracts": [],
            "missingRouteContracts": [],
            "routeContractStatus": "diagnostic incomplete",
            "routeContractProofStatus": "UNPROVEN",
            "registeredTelemetryRoutes": [],
            "missingTelemetryRoutes": [],
        }

    def target_runtime_missing_routes(self, module: Any) -> dict[str, Any]:
        return {
            "sourceKind": "target-station-runtime-route-fingerprint",
            "status": "pass",
            "proofStatus": "PROVEN",
            "versionStatus": "pass",
            "versionProofStatus": "PROVEN",
            "version": {
                "service": "peers-touch-station",
                "build_commit": "abc123",
                "build_label": "dev",
                "build_time": "2026-07-07T00:00:00Z",
                "go_version": "go1.24.6",
            },
            "versionFingerprint": {
                "service": "peers-touch-station",
                "buildCommit": "abc123",
                "buildLabel": "dev",
                "buildTime": "2026-07-07T00:00:00Z",
                "goVersion": "go1.24.6",
            },
            "identityStatus": "pass",
            "identityProofStatus": "PROVEN",
            "identity": {
                "status": "pass",
                "proofStatus": "PROVEN",
                "requiredFields": ["service", "buildCommit", "buildTime"],
                "weakFields": [],
                "missingFields": [],
                "reason": "target Station runtime version identity has service, build commit, and build time",
            },
            "handlerTableStatus": "pass",
            "handlerTableProofStatus": "PROVEN",
            "handlerCount": 12,
            "requiredRouteContracts": module.REQUIRED_ROUTE_CONTRACTS,
            "matchedRouteContracts": [],
            "missingRouteContracts": module.REQUIRED_ROUTE_CONTRACTS,
            "routeContractStatus": "diagnostic incomplete",
            "routeContractProofStatus": "UNPROVEN",
            "registeredTelemetryRoutes": [],
            "missingTelemetryRoutes": module.REQUIRED_LOCAL_ROUTE_TOKENS,
        }

    def target_runtime_proven(self, module: Any) -> dict[str, Any]:
        return {
            "sourceKind": "target-station-runtime-route-fingerprint",
            "status": "pass",
            "proofStatus": "PROVEN",
            "versionStatus": "pass",
            "versionProofStatus": "PROVEN",
            "version": {
                "service": "peers-touch-station",
                "build_commit": "abc123",
                "build_label": "dev",
                "build_time": "2026-07-07T00:00:00Z",
                "go_version": "go1.24.6",
            },
            "versionFingerprint": {
                "service": "peers-touch-station",
                "buildCommit": "abc123",
                "buildLabel": "dev",
                "buildTime": "2026-07-07T00:00:00Z",
                "goVersion": "go1.24.6",
            },
            "identityStatus": "pass",
            "identityProofStatus": "PROVEN",
            "identity": {
                "status": "pass",
                "proofStatus": "PROVEN",
                "requiredFields": ["service", "buildCommit", "buildTime"],
                "weakFields": [],
                "missingFields": [],
                "reason": "target Station runtime version identity has service, build commit, and build time",
            },
            "handlerTableStatus": "pass",
            "handlerTableProofStatus": "PROVEN",
            "handlerCount": 12,
            "requiredRouteContracts": module.REQUIRED_ROUTE_CONTRACTS,
            "matchedRouteContracts": [{"expected": contract, "actual": contract} for contract in module.REQUIRED_ROUTE_CONTRACTS],
            "missingRouteContracts": [],
            "routeContractStatus": "pass",
            "routeContractProofStatus": "PROVEN",
            "registeredTelemetryRoutes": module.REQUIRED_LOCAL_ROUTE_TOKENS,
            "missingTelemetryRoutes": [],
        }

    def local_deployment_proven(self, module: Any) -> dict[str, Any]:
        return {
            "sourceKind": "local-station-deployable-source-route-registration",
            "status": "pass",
            "proofStatus": "PROVEN",
            "reason": "HEAD contains deployable frontend telemetry route contracts and related source paths are clean",
            "headRouteContractStatus": "pass",
            "headRouteContractProofStatus": "PROVEN",
            "headRegisteredRouteContracts": module.REQUIRED_ROUTE_CONTRACTS,
            "headMissingRouteContracts": [],
            "dirtyRelevantPaths": [],
        }

    def write_local_station_source(self, root: Path) -> None:
        main = root / "apps/station/app/main.go"
        subserver = root / "apps/station/app/subserver/frontend_telemetry/subserver.go"
        main.parent.mkdir(parents=True, exist_ok=True)
        subserver.parent.mkdir(parents=True, exist_ok=True)
        main.write_text(
            'server.WithSubServer("frontend_telemetry", frontendtelemetry.NewFrontendTelemetrySubServer)\n',
            encoding="utf-8",
        )
        subserver.write_text(
            "\n".join(
                [
                    'server.NewTypedHandler("frontend-telemetry-ingest", "/telemetry/frontend/events/batch", server.POST, s.handleIngest)',
                    'server.NewTypedHandler("frontend-telemetry-query", "/telemetry/frontend/events/query", server.POST, s.handleQuery)',
                    'server.NewTypedHandler("frontend-telemetry-rollup-query", "/telemetry/frontend/rollups/query", server.POST, s.handleRollupQuery)',
                ]
            ),
            encoding="utf-8",
        )

    def test_report_passes_when_station_auth_and_routes_are_available(self) -> None:
        module = load_module()
        probes = [
            {"path": module.INGEST_PATH, "status": 400, "body": "events must not be empty"},
            {"path": module.QUERY_PATH, "status": 200, "body": '{"events":[]}'},
            {"path": module.ROLLUP_PATH, "status": 200, "body": '{"rollups":[]}'},
        ]

        with tempfile.TemporaryDirectory() as tmp:
            runtime_closure = self.write_runtime_closure_report(Path(tmp), "pass")
            with mock.patch.object(module, "target_station_runtime_evidence", return_value=self.target_runtime_proven(module)), mock.patch.object(
                module, "local_source_deployment_evidence", return_value=self.local_deployment_proven(module)
            ), mock.patch.object(module, "station_login_token", return_value="token"), mock.patch.object(
                module, "probe_routes", return_value=probes
            ):
                report = module.build_report(
                    "http://station.local",
                    "b@p.t",
                    "1",
                    0.1,
                    runtime_closure_report=runtime_closure,
                )

        self.assertEqual(report["artifactKind"], "desktop-telemetry-route-probe")
        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertEqual(report["phase"], "P0a-4/P0a-5/P0a-6/P0c-5")
        self.assertEqual(report["bom"], module.BOM)
        self.assertEqual(report["spec"], module.SPEC)
        self.assertEqual(report["sourceArtifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(report["sourcePhase"], module.PHASE)
        self.assertEqual(report["sourceBom"], module.BOM)
        self.assertEqual(report["sourceSpec"], module.SPEC)
        self.assertEqual(report["sourceGate"], module.GATE)
        self.assertEqual(report["issue_breakdown"], [])
        self.assertEqual(report["issueBreakdown"], [])
        self.assertTrue(report["routeProofTrusted"])
        self.assertEqual(report["routeTrustBlockedProofs"], [])
        self.assertEqual(report["routeTrustBlockedProofCount"], 0)
        self.assertEqual(report["steps"][1]["detail"]["routes"], probes)
        self.assertEqual(report["summary"]["station"], "http://station.local")
        self.assertEqual(report["summary"]["status"], "pass")
        self.assertEqual(report["summary"]["authStatus"], "pass")
        self.assertEqual(report["summary"]["routeProbeStatus"], "pass")
        self.assertEqual(report["summary"]["requiredRouteCount"], 3)
        self.assertEqual(report["summary"]["probedRouteCount"], 3)
        self.assertEqual(report["summary"]["probedRoutes"], [module.INGEST_PATH, module.QUERY_PATH, module.ROLLUP_PATH])
        self.assertEqual(
            [item["status"] for item in report["summary"]["targetRuntimeRouteContractSummary"]],
            ["matched", "matched", "matched"],
        )
        self.assertEqual(report["summary"]["environmentClassification"], "target-station-routes-available")
        self.assertTrue(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["targetRuntimeProofStatus"], "PROVEN")
        self.assertTrue(report["summary"]["routeProofTrusted"])
        self.assertEqual(report["summary"]["routeTrustBlockedProofCount"], 0)
        markdown = module.render_markdown(report)
        self.assertIn("# Desktop Telemetry Route Probe", markdown)
        self.assertIn("- Status: `pass`", markdown)
        self.assertIn("- Source kind: `desktop-telemetry-route-probe`", markdown)
        self.assertIn("- Source phase: `P0a-4/P0a-5/P0a-6/P0c-5`", markdown)
        self.assertIn("- Source BOM: `BOM-CON-03,BOM-CON-04,BOM-CAP-05,BOM-RUN-05`", markdown)
        self.assertIn("- Source Spec: `SPEC-STA-01,SPEC-STA-02,SPEC-DB-01,SPEC-DB-02,SPEC-STA-03,SPEC-MIRROR-01`", markdown)
        self.assertIn(
            "- Probed routes: `/telemetry/frontend/events/batch,/telemetry/frontend/events/query,/telemetry/frontend/rollups/query`",
            markdown,
        )

    def test_route_probe_pass_is_unproven_when_runtime_closure_is_unproven(self) -> None:
        module = load_module()
        probes = [
            {"path": module.INGEST_PATH, "status": 400, "body": "events must not be empty"},
            {"path": module.QUERY_PATH, "status": 200, "body": '{"events":[]}'},
            {"path": module.ROLLUP_PATH, "status": 200, "body": '{"rollups":[]}'},
        ]

        with tempfile.TemporaryDirectory() as tmp:
            runtime_closure = self.write_runtime_closure_report(Path(tmp), "diagnostic incomplete")
            with mock.patch.object(module, "target_station_runtime_evidence", return_value=self.target_runtime_proven(module)), mock.patch.object(
                module, "local_source_deployment_evidence", return_value=self.local_deployment_proven(module)
            ), mock.patch.object(module, "station_login_token", return_value="token"), mock.patch.object(
                module, "probe_routes", return_value=probes
            ):
                report = module.build_report(
                    "http://station.local",
                    "b@p.t",
                    "1",
                    0.1,
                    runtime_closure_report=runtime_closure,
                )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["failedStep"], "runtime.closure")
        self.assertEqual(
            report["reason"],
            "Station telemetry routes responded, but route trust prerequisites are not all PROVEN",
        )
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertFalse(report["routeProofTrusted"])
        self.assertEqual(report["routeTrustBlockedProofCount"], 1)
        self.assertEqual(report["issueBreakdown"][0]["category"], "route-trust-prerequisite-unproven")
        self.assertEqual(report["issueBreakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(report["issueBreakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issueBreakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issueBreakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["issueBreakdown"][0]["sourceArtifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(report["runtimeClosureEvidence"]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["runtimeClosureEvidence"]["failedCheckReasons"], {"docker-daemon": "command exited 1"})
        self.assertEqual(report["issueBreakdown"][0]["runtimeClosureEvidence"]["failedCheckReasons"], {"docker-daemon": "command exited 1"})
        self.assertEqual(report["summary"]["routeProofTrusted"], False)
        self.assertEqual(report["summary"]["routeTrustBlockedProofCount"], 1)
        self.assertEqual(report["summary"]["routeTrustBlockedProofCount"], report["routeTrustBlockedProofCount"])
        self.assertEqual(report["routeTrustBlockedProofs"][0]["step"], "runtime.closure")
        self.assertEqual(report["routeTrustBlockedProofs"][0]["sourceBom"], module.BOM)
        self.assertEqual(report["summary"]["runtimeClosureProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["runtimeClosureDockerDaemonProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["runtimeClosureFailedCheckReasons"], {"docker-daemon": "command exited 1"})
        self.assertEqual(report["summary"]["runtimeClosureLocalRuntimeClosure"]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["runtimeClosureComposeRuntimeClosure"]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["failedStep"], "runtime.closure")
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        markdown = module.render_markdown(report)
        self.assertIn("- Status: `diagnostic incomplete`", markdown)
        self.assertIn("- Route proof trusted: `False`", markdown)
        self.assertIn("- Route trust blocked proof count: `1`", markdown)
        self.assertIn("## Route Trust Prerequisites", markdown)
        self.assertIn("- Runtime closure proof: `UNPROVEN`", markdown)
        self.assertIn('"docker-daemon": "command exited 1"', markdown)

    def test_route_probe_pass_is_unproven_when_route_trust_prerequisites_are_unproven(self) -> None:
        module = load_module()
        probes = [
            {"path": module.INGEST_PATH, "status": 400, "body": "events must not be empty"},
            {"path": module.QUERY_PATH, "status": 200, "body": '{"events":[]}'},
            {"path": module.ROLLUP_PATH, "status": 200, "body": '{"rollups":[]}'},
        ]

        with tempfile.TemporaryDirectory() as tmp:
            runtime_closure = self.write_runtime_closure_report(Path(tmp), "pass")
            with mock.patch.object(module, "target_station_runtime_evidence", return_value=self.target_runtime_unproven()), mock.patch.object(
                module, "station_login_token", return_value="token"
            ), mock.patch.object(module, "probe_routes", return_value=probes):
                report = module.build_report(
                    "http://station.local",
                    "b@p.t",
                    "1",
                    0.1,
                    "out.json",
                    runtime_closure_report=runtime_closure,
                )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertFalse(report["routeProofTrusted"])
        self.assertFalse(report["summary"]["routeProofTrusted"])
        blocked_steps = {proof["step"] for proof in report["routeTrustBlockedProofs"]}
        self.assertIn("target-runtime.identity", blocked_steps)
        self.assertIn("target-runtime.route-contracts", blocked_steps)
        self.assertNotIn("local-source.deployable-head", blocked_steps)
        self.assertNotIn("local-source.head-route-contracts", blocked_steps)
        self.assertEqual(report["summary"]["routeTrustBlockedProofs"], report["routeTrustBlockedProofs"])
        self.assertEqual(report["summary"]["routeTrustBlockedProofCount"], report["routeTrustBlockedProofCount"])
        for proof in report["routeTrustBlockedProofs"]:
            self.assertEqual(proof["sourceArtifact"], "out.json")
            self.assertEqual(proof["sourceArtifactKind"], module.ARTIFACT_KIND)
            self.assertEqual(proof["sourcePhase"], module.PHASE)
            self.assertEqual(proof["sourceBom"], module.BOM)
            self.assertEqual(proof["sourceSpec"], module.SPEC)
            self.assertEqual(proof["sourceGate"], module.GATE)

    def test_missing_ingest_route_is_partial_unproven_with_source_trace(self) -> None:
        module = load_module()

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_local_station_source(root)
            with mock.patch.object(module, "target_station_runtime_evidence", return_value=self.target_runtime_missing_routes(module)), mock.patch.object(
                module, "station_login_token", return_value="token"
            ), mock.patch.object(
                module,
                "probe_routes",
                side_effect=module.GateError(
                    "Station telemetry route missing path=/telemetry/frontend/events/batch status=404 body=404 page not found"
                ),
            ):
                report = module.build_report("http://station.local", "b@p.t", "1", 0.1, "out.json", repo_root=root)

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["failedStep"], "station.telemetry_routes")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertFalse(report["routeProofTrusted"])
        self.assertEqual(report["routeTrustBlockedProofCount"], len(report["routeTrustBlockedProofs"]))
        issue = report["issueBreakdown"][0]
        self.assertEqual(issue["category"], "station-telemetry-route-missing")
        self.assertEqual(issue["failedStep"], "station.telemetry_routes")
        self.assertEqual(issue["status"], "fail")
        self.assertEqual(issue["completionStatus"], "PARTIAL")
        self.assertEqual(issue["proofStatus"], "UNPROVEN")
        self.assertFalse(issue["sampleEmissionAllowed"])
        self.assertEqual(issue["sourceArtifact"], "out.json")
        self.assertEqual(issue["sourceArtifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(issue["sourcePhase"], module.PHASE)
        self.assertEqual(issue["sourceBom"], module.BOM)
        self.assertEqual(issue["sourceSpec"], module.SPEC)
        self.assertEqual(issue["sourceGate"], module.GATE)
        self.assertEqual(issue["evidenceDetails"], report["details"])
        self.assertEqual(issue["environmentClassification"], "target-station-handler-missing-while-local-source-registers-routes")
        self.assertEqual(issue["localSourceRouteEvidence"]["proofStatus"], "PROVEN")
        self.assertEqual(issue["targetRuntimeRouteEvidence"]["handlerTableProofStatus"], "PROVEN")
        self.assertEqual(issue["targetRuntimeRouteEvidence"]["missingTelemetryRoutes"], module.REQUIRED_LOCAL_ROUTE_TOKENS)
        self.assertEqual(issue["targetRuntimeRouteEvidence"]["routeContractProofStatus"], "UNPROVEN")
        self.assertEqual(issue["targetRuntimeRouteEvidence"]["missingRouteContracts"], module.REQUIRED_ROUTE_CONTRACTS)
        self.assertEqual(issue["localSourceRouteEvidence"]["registeredRoutes"], module.REQUIRED_LOCAL_ROUTE_TOKENS)
        self.assertEqual(issue["localSourceRouteEvidence"]["routeContractProofStatus"], "PROVEN")
        self.assertEqual(issue["localSourceRouteEvidence"]["registeredRouteContracts"], module.REQUIRED_ROUTE_CONTRACTS)
        self.assertEqual(report["localSourceRouteEvidence"]["proofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["status"], "fail")
        self.assertEqual(report["summary"]["authStatus"], "pass")
        self.assertEqual(report["summary"]["routeProbeStatus"], "fail")
        self.assertEqual(report["summary"]["requiredRoutes"], module.REQUIRED_LOCAL_ROUTE_TOKENS)
        self.assertEqual(report["summary"]["probedRouteCount"], 0)
        self.assertEqual(report["summary"]["localSourceProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["localSourceRegisteredRouteCount"], 3)
        self.assertEqual(report["summary"]["localSourceMissingRouteCount"], 0)
        self.assertEqual(report["summary"]["localSourceRouteContractProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["localSourceRegisteredRouteContractCount"], 3)
        self.assertEqual(report["summary"]["localSourceMissingRouteContractCount"], 0)
        self.assertEqual(report["summary"]["localSourceDeploymentProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["localSourceHeadRouteContractProofStatus"], "UNPROVEN")
        self.assertEqual(issue["localSourceDeploymentEvidence"]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["targetRuntimeProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["targetRuntimeVersionProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["targetRuntimeVersionFingerprint"]["buildCommit"], "abc123")
        self.assertEqual(report["summary"]["targetRuntimeIdentityProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["targetRuntimeHandlerTableStatus"], "pass")
        self.assertEqual(report["summary"]["targetRuntimeRouteContractProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["targetRuntimeMatchedRouteContractCount"], 0)
        self.assertEqual(report["summary"]["targetRuntimeMissingRouteContractCount"], 3)
        self.assertEqual(
            report["summary"]["targetRuntimeRouteContractSummary"],
            [
                {
                    "name": "frontend-telemetry-ingest",
                    "path": "/telemetry/frontend/events/batch",
                    "method": "POST",
                    "status": "missing",
                },
                {
                    "name": "frontend-telemetry-query",
                    "path": "/telemetry/frontend/events/query",
                    "method": "POST",
                    "status": "missing",
                },
                {
                    "name": "frontend-telemetry-rollup-query",
                    "path": "/telemetry/frontend/rollups/query",
                    "method": "POST",
                    "status": "missing",
                },
            ],
        )
        self.assertEqual(report["summary"]["targetRuntimeRegisteredRouteCount"], 0)
        self.assertEqual(report["summary"]["targetRuntimeMissingRouteCount"], 3)
        self.assertEqual(report["summary"]["failedStep"], "station.telemetry_routes")
        self.assertEqual(
            report["summary"]["environmentClassification"],
            "target-station-handler-missing-while-local-source-registers-routes",
        )
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(issue["recommendedReviewCommands"], report["recommendedReviewCommands"])
        self.assertTrue(any("/telemetry/frontend/events/batch" in item["command"] for item in report["recommendedReviewCommands"]))
        markdown = module.render_markdown(report)
        self.assertIn("- Status: `fail`", markdown)
        self.assertIn("- Completion: `PARTIAL`", markdown)
        self.assertIn("- Proof: `UNPROVEN`", markdown)
        self.assertIn(
            "- Environment classification: `target-station-handler-missing-while-local-source-registers-routes`",
            markdown,
        )
        self.assertIn("- Local source routes: `3/3`", markdown)
        self.assertIn("- Local source route contracts: `3/3`", markdown)
        self.assertIn("- Local source route contract proof: `PROVEN`", markdown)
        self.assertIn("- Local deployable source proof: `UNPROVEN`", markdown)
        self.assertIn("- Target runtime routes: `0/3`", markdown)
        self.assertIn("- Target runtime route contracts: `0/3`", markdown)
        self.assertIn("- Target runtime route contract proof: `UNPROVEN`", markdown)
        self.assertIn("POST /telemetry/frontend/events/batch", markdown)
        self.assertIn("- Version build commit: `abc123`", markdown)
        self.assertIn("- Identity proof: `PROVEN`", markdown)
        self.assertIn(
            "- Target runtime missing routes: `/telemetry/frontend/events/batch,/telemetry/frontend/events/query,/telemetry/frontend/rollups/query`",
            markdown,
        )
        self.assertIn("- Handler count: `12`", markdown)

    def test_local_source_route_evidence_is_unproven_when_routes_are_missing(self) -> None:
        module = load_module()

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = root / "apps/station/app/main.go"
            main.parent.mkdir(parents=True, exist_ok=True)
            main.write_text('server.WithSubServer("frontend_telemetry", frontendtelemetry.NewFrontendTelemetrySubServer)\n', encoding="utf-8")
            evidence = module.local_source_route_evidence(root)

        self.assertEqual(evidence["status"], "diagnostic incomplete")
        self.assertEqual(evidence["proofStatus"], "UNPROVEN")
        self.assertEqual(evidence["registeredRoutes"], [])
        self.assertEqual(evidence["missingRoutes"], module.REQUIRED_LOCAL_ROUTE_TOKENS)

    def test_local_source_deployment_evidence_is_unproven_when_routes_are_only_in_worktree(self) -> None:
        module = load_module()

        def fake_git_output(repo_root: Path, args: list[str]) -> Any:
            command = " ".join(args)
            if command.startswith("show HEAD:apps/station/app/main.go"):
                return module.subprocess.CompletedProcess(args, 0, stdout="package main\n", stderr="")
            if command.startswith("show HEAD:apps/station/app/subserver/frontend_telemetry/subserver.go"):
                return module.subprocess.CompletedProcess(
                    args,
                    128,
                    stdout="",
                    stderr="fatal: path 'apps/station/app/subserver/frontend_telemetry/subserver.go' exists on disk, but not in 'HEAD'",
                )
            if command.startswith("show HEAD:apps/station/app/subserver/frontend_telemetry/handler.go"):
                return module.subprocess.CompletedProcess(
                    args,
                    128,
                    stdout="",
                    stderr="fatal: path 'apps/station/app/subserver/frontend_telemetry/handler.go' exists on disk, but not in 'HEAD'",
                )
            if command.startswith("show HEAD:apps/station/app/subserver/frontend_telemetry/store.go"):
                return module.subprocess.CompletedProcess(
                    args,
                    128,
                    stdout="",
                    stderr="fatal: path 'apps/station/app/subserver/frontend_telemetry/store.go' exists on disk, but not in 'HEAD'",
                )
            if command.startswith("status --porcelain"):
                return module.subprocess.CompletedProcess(
                    args,
                    0,
                    stdout=(
                        " M apps/station/app/main.go\n"
                        "?? apps/station/app/subserver/frontend_telemetry/handler.go\n"
                        "?? apps/station/app/subserver/frontend_telemetry/store.go\n"
                        "?? apps/station/app/subserver/frontend_telemetry/subserver.go\n"
                    ),
                    stderr="",
                )
            raise AssertionError(command)

        with mock.patch.object(module, "git_output", side_effect=fake_git_output):
            evidence = module.local_source_deployment_evidence(Path("/repo"))

        self.assertEqual(evidence["status"], "diagnostic incomplete")
        self.assertEqual(evidence["proofStatus"], "UNPROVEN")
        self.assertEqual(evidence["headSourceFileProofStatus"], "UNPROVEN")
        self.assertEqual(evidence["headRouteContractProofStatus"], "UNPROVEN")
        self.assertEqual(evidence["headMissingRoutes"], module.REQUIRED_LOCAL_ROUTE_TOKENS)
        self.assertEqual(evidence["headMissingRouteContracts"], module.REQUIRED_ROUTE_CONTRACTS)
        self.assertEqual(
            evidence["dirtyRelevantPaths"],
            [
                {"path": "apps/station/app/main.go", "status": " M"},
                {"path": "apps/station/app/subserver/frontend_telemetry/handler.go", "status": "??"},
                {"path": "apps/station/app/subserver/frontend_telemetry/store.go", "status": "??"},
                {"path": "apps/station/app/subserver/frontend_telemetry/subserver.go", "status": "??"},
            ],
        )
        self.assertEqual(evidence["headFileErrors"][0]["path"], "apps/station/app/subserver/frontend_telemetry/subserver.go")
        self.assertEqual(
            [item["path"] for item in evidence["headFileErrors"]],
            [
                "apps/station/app/subserver/frontend_telemetry/subserver.go",
                "apps/station/app/subserver/frontend_telemetry/handler.go",
                "apps/station/app/subserver/frontend_telemetry/store.go",
            ],
        )

    def test_local_source_deployment_evidence_is_proven_when_head_contains_clean_contract(self) -> None:
        module = load_module()
        main_text = 'server.WithSubServer("frontend_telemetry", frontendtelemetry.NewFrontendTelemetrySubServer)\n'
        subserver_text = "\n".join(
            [
                'server.NewTypedHandler("frontend-telemetry-ingest", "/telemetry/frontend/events/batch", server.POST, s.handleIngest)',
                'server.NewTypedHandler("frontend-telemetry-query", "/telemetry/frontend/events/query", server.POST, s.handleQuery)',
                'server.NewTypedHandler("frontend-telemetry-rollup-query", "/telemetry/frontend/rollups/query", server.POST, s.handleRollupQuery)',
            ]
        )

        def fake_git_output(repo_root: Path, args: list[str]) -> Any:
            command = " ".join(args)
            if command.startswith("show HEAD:apps/station/app/main.go"):
                return module.subprocess.CompletedProcess(args, 0, stdout=main_text, stderr="")
            if command.startswith("show HEAD:apps/station/app/subserver/frontend_telemetry/subserver.go"):
                return module.subprocess.CompletedProcess(args, 0, stdout=subserver_text, stderr="")
            if command.startswith("show HEAD:apps/station/app/subserver/frontend_telemetry/handler.go"):
                return module.subprocess.CompletedProcess(args, 0, stdout="package frontend_telemetry\n", stderr="")
            if command.startswith("show HEAD:apps/station/app/subserver/frontend_telemetry/store.go"):
                return module.subprocess.CompletedProcess(args, 0, stdout="package frontend_telemetry\n", stderr="")
            if command.startswith("status --porcelain"):
                return module.subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            raise AssertionError(command)

        with mock.patch.object(module, "git_output", side_effect=fake_git_output):
            evidence = module.local_source_deployment_evidence(Path("/repo"))

        self.assertEqual(evidence["status"], "pass")
        self.assertEqual(evidence["proofStatus"], "PROVEN")
        self.assertEqual(evidence["headSourceFileProofStatus"], "PROVEN")
        self.assertEqual(evidence["headRouteContractProofStatus"], "PROVEN")
        self.assertEqual(evidence["headRegisteredRoutes"], module.REQUIRED_LOCAL_ROUTE_TOKENS)
        self.assertEqual(evidence["headRegisteredRouteContracts"], module.REQUIRED_ROUTE_CONTRACTS)
        self.assertEqual(evidence["dirtyRelevantPaths"], [])
        self.assertEqual(evidence["deployableSourcePaths"], [path.as_posix() for path in module.LOCAL_STATION_DEPLOYABLE_SOURCE_PATHS])

    def test_auth_failure_is_partial_unproven(self) -> None:
        module = load_module()

        with mock.patch.object(module, "target_station_runtime_evidence", return_value=self.target_runtime_unproven()), mock.patch.object(
            module, "station_login_token", side_effect=module.GateError("invalid password")
        ):
            report = module.build_report("http://station.local", "b@p.t", "bad", 0.1)

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["failedStep"], "station.auth_login")
        self.assertEqual(report["issueBreakdown"][0]["category"], "station-auth")
        self.assertEqual(report["issueBreakdown"][0]["status"], "fail")
        self.assertEqual(report["issueBreakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issueBreakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issueBreakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["authStatus"], "fail")
        self.assertEqual(report["summary"]["routeProbeStatus"], "not-run")
        self.assertEqual(report["summary"]["failedStep"], "station.auth_login")
        self.assertEqual(report["summary"]["environmentClassification"], "target-station-route-unproven")
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])

    def test_target_station_runtime_evidence_records_handler_table_routes(self) -> None:
        module = load_module()
        version = {
            "path": module.APP_META_VERSION_PATH,
            "status": 200,
            "body": {
                "service": "peers-touch-station",
                "build_commit": "abc",
                "build_label": "dev",
                "build_time": "2026-07-07T00:00:00Z",
                "go_version": "go1.24.6",
            },
        }
        handlers = {
            "path": module.DEBUG_HANDLERS_PATH,
            "status": 200,
            "body": {
                "handlers": [
                    {"Name": "frontend-telemetry-ingest", "Path": module.INGEST_PATH, "Method": "POST"},
                    {"Name": "frontend-telemetry-query", "Path": module.QUERY_PATH, "Method": "POST"},
                    {"Path": "/unrelated"},
                ]
            },
        }

        with mock.patch.object(module, "station_get_probe", side_effect=[version, handlers]):
            evidence = module.target_station_runtime_evidence("http://station.local", 0.1)

        self.assertEqual(evidence["status"], "pass")
        self.assertEqual(evidence["proofStatus"], "PROVEN")
        self.assertEqual(evidence["versionProofStatus"], "PROVEN")
        self.assertEqual(evidence["versionFingerprint"]["service"], "peers-touch-station")
        self.assertEqual(evidence["versionFingerprint"]["buildCommit"], "abc")
        self.assertEqual(evidence["versionFingerprint"]["buildLabel"], "dev")
        self.assertEqual(evidence["versionFingerprint"]["buildTime"], "2026-07-07T00:00:00Z")
        self.assertEqual(evidence["versionFingerprint"]["goVersion"], "go1.24.6")
        self.assertEqual(evidence["identityProofStatus"], "PROVEN")
        self.assertEqual(evidence["handlerTableProofStatus"], "PROVEN")
        self.assertEqual(evidence["routeContractProofStatus"], "UNPROVEN")
        self.assertEqual(len(evidence["matchedRouteContracts"]), 2)
        self.assertEqual(evidence["matchedRouteContracts"][0]["expected"]["method"], "POST")
        self.assertEqual(evidence["missingRouteContracts"], [module.REQUIRED_ROUTE_CONTRACTS[2]])
        self.assertEqual(evidence["registeredTelemetryRoutes"], [module.INGEST_PATH, module.QUERY_PATH])
        self.assertEqual(evidence["missingTelemetryRoutes"], [module.ROLLUP_PATH])
        self.assertEqual(evidence["routeRegistrationStatus"], "diagnostic incomplete")
        summary = module.route_contract_summary(
            evidence["requiredRouteContracts"],
            evidence["matchedRouteContracts"],
            evidence["missingRouteContracts"],
        )
        self.assertEqual([item["status"] for item in summary], ["matched", "matched", "missing"])

    def test_target_runtime_version_fingerprint_accepts_camel_and_snake_case(self) -> None:
        module = load_module()

        snake = module.target_runtime_version_fingerprint(
            {
                "service": "peers-touch-station",
                "build_commit": "abc",
                "build_label": "dev",
                "build_time": "2026-07-07T00:00:00Z",
                "go_version": "go1.24.6",
            }
        )
        camel = module.target_runtime_version_fingerprint(
            {
                "data": {
                    "service": "peers-touch-station",
                    "buildCommit": "def",
                    "buildLabel": "prod",
                    "buildTime": "2026-07-08T00:00:00Z",
                    "goVersion": "go1.24.7",
                }
            }
        )

        self.assertEqual(snake["buildCommit"], "abc")
        self.assertEqual(snake["goVersion"], "go1.24.6")
        self.assertEqual(camel["buildCommit"], "def")
        self.assertEqual(camel["buildLabel"], "prod")

    def test_target_runtime_identity_evidence_marks_unknown_build_as_unproven(self) -> None:
        module = load_module()

        evidence = module.target_runtime_identity_evidence(
            {
                "service": "peers-touch-station",
                "buildCommit": "unknown",
                "buildLabel": "dev",
                "buildTime": "unknown",
                "goVersion": "go1.24.6",
            }
        )

        self.assertEqual(evidence["status"], "diagnostic incomplete")
        self.assertEqual(evidence["proofStatus"], "UNPROVEN")
        self.assertEqual(evidence["missingFields"], ["buildCommit", "buildTime"])

    def test_handler_paths_from_response_accepts_upper_and_lower_path_keys(self) -> None:
        module = load_module()

        paths = module.handler_paths_from_response({"handlers": [{"Path": "/a"}, {"path": "/b"}, {"Path": ""}]})

        self.assertEqual(paths, ["/a", "/b"])

    def test_station_get_probe_converts_socket_timeout_to_unproven_probe(self) -> None:
        module = load_module()

        with mock.patch.object(module.urllib.request, "urlopen", side_effect=socket.timeout("timed out")):
            probe = module.station_get_probe("http://station.local", module.APP_META_VERSION_PATH, 0.1)

        self.assertEqual(probe["path"], module.APP_META_VERSION_PATH)
        self.assertEqual(probe["status"], "timeout")
        self.assertIn("timed out", probe["body"])

    def test_station_auth_timeout_writes_partial_unproven_report(self) -> None:
        module = load_module()

        with mock.patch.object(module, "target_station_runtime_evidence", return_value=self.target_runtime_unproven()), mock.patch.object(
            module.urllib.request, "urlopen", side_effect=socket.timeout("timed out")
        ):
            report = module.build_report("http://station.local", "b@p.t", "1", 0.1)

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["failedStep"], "station.auth_login")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertIn("timed out", report["reason"])
        self.assertEqual(report["issueBreakdown"][0]["sourceArtifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(report["issueBreakdown"][0]["sourcePhase"], module.PHASE)

    def test_station_login_device_type_obeys_station_length_constraint(self) -> None:
        module = load_module()

        self.assertLessEqual(len(module.STATION_LOGIN_DEVICE_TYPE), 20)

    def test_probe_routes_accepts_ingest_validation_error_as_route_present(self) -> None:
        module = load_module()
        responses = {
            module.INGEST_PATH: {"path": module.INGEST_PATH, "status": 400, "body": "events must not be empty"},
            module.QUERY_PATH: {"path": module.QUERY_PATH, "status": 200, "body": '{"events":[]}'},
            module.ROLLUP_PATH: {"path": module.ROLLUP_PATH, "status": 200, "body": '{"rollups":[]}'},
        }

        with mock.patch.object(module, "station_post_probe", side_effect=lambda station, path, token, payload, timeout: responses[path]):
            probes = module.probe_routes("http://station.local", "token", 0.1)

        self.assertEqual([probe["path"] for probe in probes], [module.INGEST_PATH, module.QUERY_PATH, module.ROLLUP_PATH])


if __name__ == "__main__":
    unittest.main()
