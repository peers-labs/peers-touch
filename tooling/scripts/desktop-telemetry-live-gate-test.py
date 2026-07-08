#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path


def load_gate_module():
    script = Path(__file__).with_name("desktop-telemetry-live-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_telemetry_live_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopTelemetryLiveGateTest(unittest.TestCase):
    def runtime_closure_step(self) -> dict:
        return {"name": "runtime.closure", "status": "pass", "detail": {"proofStatus": "PROVEN", "sampleEmissionAllowed": True}}

    def runtime_closure_evidence(self, status: str = "diagnostic incomplete") -> dict:
        return {
            "path": "tooling/acceptance/reports/desktop-telemetry-runtime-closure-gate.json",
            "sourceArtifactKind": "desktop-telemetry-runtime-closure-gate",
            "sourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
            "sourceBom": ["BOM-RUN-03", "BOM-RUN-04"],
            "sourceSpec": ["SPEC-GW-01", "SPEC-STA-01"],
            "sourceGate": "Managed Station+Postgres runtime closure is required",
            "status": status,
            "completionStatus": "DONE" if status == "pass" else "PARTIAL",
            "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
            "sampleEmissionAllowed": status == "pass",
            "managedRuntimeClosure": "compose-station-postgres" if status == "pass" else None,
            "localRuntimeClosureProofStatus": "UNPROVEN",
            "composeRuntimeClosureProofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
            "dockerDaemonProofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
            "failedCheckCount": 0 if status == "pass" else 3,
            "checkReasons": {}
            if status == "pass"
            else {
                "local-dev-station-entrypoint": "local station entrypoint starts without managed DB",
                "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                "docker-daemon": "command exited 1",
            },
            "failedCheckReasons": {}
            if status == "pass"
            else {
                "local-dev-station-entrypoint": "local station entrypoint starts without managed DB",
                "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                "docker-daemon": "command exited 1",
            },
            "localRuntimeClosure": {
                "proofStatus": "UNPROVEN",
                "sampleEmissionAllowed": False,
                "failedChecks": []
                if status == "pass"
                else ["local-dev-station-entrypoint", "local-dev-store-dsn"],
                "failedCheckReasons": {}
                if status == "pass"
                else {
                    "local-dev-station-entrypoint": "local station entrypoint starts without managed DB",
                    "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                },
            },
            "composeRuntimeClosure": {
                "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
                "sampleEmissionAllowed": status == "pass",
                "failedChecks": [] if status == "pass" else ["docker-daemon"],
                "failedCheckReasons": {} if status == "pass" else {"docker-daemon": "command exited 1"},
            },
              "blockedDownstreamProofs": []
              if status == "pass"
              else [
                  {
                      "step": "gateway.frontend_telemetry_upload",
                      "status": "blocked",
                      "completionStatus": "PARTIAL",
                      "proofStatus": "UNPROVEN",
                      "sampleEmissionAllowed": False,
                      "blockedByStep": "runtime.closure",
                      "sourceArtifact": "tooling/acceptance/reports/desktop-telemetry-runtime-closure-gate.json",
                      "sourceArtifactKind": "desktop-telemetry-runtime-closure-gate",
                      "sourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                      "sourceBom": ["BOM-RUN-03", "BOM-RUN-04"],
                      "sourceSpec": ["SPEC-GW-01", "SPEC-STA-01"],
                      "sourceGate": "Managed Station+Postgres runtime closure is required",
                  },
                  {
                      "step": "station.raw_query",
                      "status": "blocked",
                      "completionStatus": "PARTIAL",
                      "proofStatus": "UNPROVEN",
                      "sampleEmissionAllowed": False,
                      "blockedByStep": "runtime.closure",
                      "sourceArtifact": "tooling/acceptance/reports/desktop-telemetry-runtime-closure-gate.json",
                      "sourceArtifactKind": "desktop-telemetry-runtime-closure-gate",
                      "sourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                      "sourceBom": ["BOM-RUN-03", "BOM-RUN-04"],
                      "sourceSpec": ["SPEC-GW-01", "SPEC-STA-01"],
                      "sourceGate": "Managed Station+Postgres runtime closure is required",
                  },
              ],
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

    def stub_target_runtime_missing_routes(self, module) -> None:
        def fake_station_get_probe(station, path, timeout=10.0):
            if path == module.APP_META_VERSION_PATH:
                return {
                    "path": path,
                    "status": 200,
                    "body": {
                        "service": "peers-touch-station",
                        "build_commit": "unknown",
                        "build_label": "dev",
                        "build_time": "unknown",
                        "go_version": "go1.24.6",
                    },
                }
            if path == module.DEBUG_HANDLERS_PATH:
                return {
                    "path": path,
                    "status": 200,
                    "body": {"handlers": [{"Path": "/actor/login"}, {"path": "/debug/list-all-handlers"}]},
                }
            raise AssertionError(f"unexpected probe path {path}")

        module.station_get_probe = fake_station_get_probe

    def test_artifact_kind_is_stable(self) -> None:
        module = load_gate_module()

        self.assertEqual(module.ARTIFACT_KIND, "desktop-telemetry-live-gate")

    def test_pass_status_is_done_and_proven(self) -> None:
        module = load_gate_module()
        report = {"status": "pass"}

        module.apply_status_metadata(report)

        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])

    def test_preflight_failure_stays_partial_and_unproven(self) -> None:
        module = load_gate_module()
        report = {"status": "baseline preflight failure"}

        module.apply_status_metadata(report)

        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["status"], "baseline preflight failure")
        self.assertEqual(report["summary"]["completionStatus"], "PARTIAL")
        self.assertEqual(report["summary"]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])

    def test_failure_stays_partial_and_unproven(self) -> None:
        module = load_gate_module()
        report = {"status": "fail"}

        module.apply_status_metadata(report)

        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["status"], "fail")
        self.assertEqual(report["summary"]["completionStatus"], "PARTIAL")
        self.assertEqual(report["summary"]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])

    def test_runtime_closure_evidence_preserves_failed_check_reasons(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "runtime-closure.json"
            path.write_text(
                json.dumps(
                    {
                        "artifactKind": module.RUNTIME_CLOSURE_ARTIFACT_KIND,
                        "phase": module.RUNTIME_CLOSURE_PHASE,
                        "bom": module.RUNTIME_CLOSURE_BOM,
                        "spec": module.RUNTIME_CLOSURE_SPEC,
                        "gate": module.RUNTIME_CLOSURE_GATE,
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "sampleEmissionAllowed": False,
                        "managedRuntimeClosure": None,
                        "summary": {
                            "localRuntimeClosureProofStatus": "UNPROVEN",
                            "composeRuntimeClosureProofStatus": "UNPROVEN",
                            "dockerDaemonProofStatus": "UNPROVEN",
                            "failedCheckCount": 3,
                            "checkReasons": {
                                "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                "docker-daemon": "command exited 1",
                            },
                            "failedCheckReasons": {
                                "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                "docker-daemon": "command exited 1",
                            },
                            "localRuntimeClosure": {
                                "proofStatus": "UNPROVEN",
                                "sampleEmissionAllowed": False,
                                "failedChecks": ["local-dev-store-dsn"],
                            },
                            "composeRuntimeClosure": {
                                "proofStatus": "UNPROVEN",
                                "sampleEmissionAllowed": False,
                                "failedChecks": ["docker-daemon"],
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            evidence = module.runtime_closure_evidence(path)

        self.assertEqual(evidence["proofStatus"], "UNPROVEN")
        self.assertIn("docker-daemon", evidence["failedCheckReasons"])
        self.assertIn("local-dev-store-dsn", evidence["checkReasons"])
        self.assertEqual(evidence["localRuntimeClosure"]["failedChecks"], ["local-dev-store-dsn"])
        self.assertEqual(evidence["composeRuntimeClosure"]["failedChecks"], ["docker-daemon"])

    def test_create_temp_account_uses_station_password_constraints(self) -> None:
        module = load_gate_module()
        calls = []

        def fake_station_post_no_auth(station, path, payload):
            calls.append((station, path, payload))
            return {"ok": True}

        module.station_post_no_auth = fake_station_post_no_auth

        email, password = module.create_temp_account("http://station.local")

        self.assertEqual(calls[0][0], "http://station.local")
        self.assertEqual(calls[0][1], "/actor/sign-up")
        self.assertEqual(calls[0][2]["email"], email)
        self.assertEqual(calls[0][2]["password"], password)
        self.assertGreaterEqual(len(password), 8)
        self.assertLessEqual(len(password), 20)
        self.assertRegex(password, re.compile(r"^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>/?]{8,20}$"))

    def test_temp_account_failure_is_not_misclassified_as_gateway_auth(self) -> None:
        module = load_gate_module()
        report = {
            "gateway": "http://127.0.0.1:3030",
            "station": "http://station.local",
            "mirrorPrefix": "tooling/acceptance/reports/desktop-performance-runtime-attempt",
            "createTempAccount": True,
                "steps": [self.runtime_closure_step(), {"name": "preflight.gateway_station", "status": "pass"}],
        }

        module.record_failure(report, module.GateError("Station /actor/sign-up failed status=400 body=password is too long"))
        module.apply_status_metadata(report)

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["failedStep"], "station.create_temp_account")
        self.assertEqual(report["issueBreakdown"][0]["category"], "station-temp-account")
        live_gate_command = next(
            item["command"]
            for item in report["recommendedReviewCommands"]
            if "desktop-telemetry-live-gate.py" in item["command"]
        )
        self.assertIn("--create-temp-account", live_gate_command)
        self.assertIn("--mirror-prefix tooling/acceptance/reports/desktop-performance-runtime-attempt", live_gate_command)
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")

    def test_station_login_token_uses_direct_station_auth(self) -> None:
        module = load_gate_module()
        calls = []

        def fake_station_post_no_auth(station, path, payload):
            calls.append((station, path, payload))
            return {"data": {"tokens": {"access_token": "station-token"}}}

        module.station_post_no_auth = fake_station_post_no_auth

        token = module.station_login_token("http://station.local", "u@example.test", "Secret123!")

        self.assertEqual(token, "station-token")
        self.assertEqual(calls[0][0], "http://station.local")
        self.assertEqual(calls[0][1], "/actor/login")
        self.assertEqual(
            calls[0][2],
            {
                "email": "u@example.test",
                "password": "Secret123!",
                "device_type": module.STATION_LOGIN_DEVICE_TYPE,
            },
        )
        self.assertLessEqual(len(module.STATION_LOGIN_DEVICE_TYPE), 20)

    def test_gateway_auth_without_token_is_allowed_before_station_auth(self) -> None:
        module = load_gate_module()

        report = {
            "steps": [
                self.runtime_closure_step(),
                {"name": "preflight.gateway_station", "status": "pass"},
                {"name": "gateway.auth_login", "status": "pass", "detail": {"actorId": "1"}},
            ]
        }

        module.record_failure(report, module.GateError("auth response missing token fields=['status']"))
        module.apply_status_metadata(report)

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["failedStep"], "station.auth_login")
        self.assertEqual(report["issueBreakdown"][0]["category"], "station-auth")
        self.assertEqual(report["issueBreakdown"][0]["proofImpact"], "Station raw/rollup query proof cannot start.")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")

    def test_station_route_404_upload_failure_is_classified_as_station_capability_gap(self) -> None:
        module = load_gate_module()
        self.stub_target_runtime_missing_routes(module)
        error = (
            "gateway command frontend_telemetry_upload failed envelope={'data': None, "
            "'error': {'code': 'NOT_FOUND', 'details': {'body': '404 page not found', "
            "'status': 404}, 'message': 'frontend telemetry upload failed'}, 'ok': False}"
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_local_station_source(root)
            report = {
                "repoRoot": str(root),
                "station": "http://station.local",
                "steps": [
                    self.runtime_closure_step(),
                    {"name": "preflight.gateway_station", "status": "pass"},
                    {"name": "gateway.auth_login", "status": "pass"},
                    {"name": "station.auth_login", "status": "pass"},
                    {"name": "station.telemetry_routes", "status": "pass"},
                ],
            }
            module.record_failure(report, module.GateError(error))
        module.apply_status_metadata(report)

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["failedStep"], "gateway.frontend_telemetry_upload")
        self.assertEqual(report["issueBreakdown"][0]["category"], "station-telemetry-route-missing")
        self.assertEqual(report["issueBreakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issueBreakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issueBreakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["localSourceRouteEvidence"]["proofStatus"], "PROVEN")
        self.assertEqual(
            report["issueBreakdown"][0]["environmentClassification"],
            "target-station-handler-missing-while-local-source-registers-routes",
        )
        self.assertEqual(report["issueBreakdown"][0]["localSourceRouteEvidence"]["proofStatus"], "PROVEN")
        self.assertEqual(report["issueBreakdown"][0]["targetRuntimeRouteEvidence"]["handlerTableProofStatus"], "PROVEN")
        self.assertEqual(report["issueBreakdown"][0]["blockedBy"][0]["blockedStep"], "gateway.frontend_telemetry_upload")
        self.assertEqual(report["issueBreakdown"][0]["blockedBy"][0]["blockedByStep"], "station.telemetry_routes")
        self.assertEqual(report["summary"]["blockedStep"], "gateway.frontend_telemetry_upload")
        self.assertEqual(report["summary"]["blockedByStep"], "station.telemetry_routes")
        self.assertEqual(report["summary"]["targetRuntimeProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["targetRuntimeMissingRouteCount"], 3)
        self.assertIn("Station runtime returned 404", report["issueBreakdown"][0]["summary"])
        self.assertIn("PARTIAL/UNPROVEN", report["issueBreakdown"][0]["proofImpact"])
        self.assertTrue(
            any(
                "/debug/list-all-handlers" in item["command"]
                for item in report["recommendedReviewCommands"]
            )
        )
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")

    def test_station_telemetry_routes_probe_fails_closed_on_missing_route(self) -> None:
        module = load_gate_module()
        self.stub_target_runtime_missing_routes(module)
        calls = []

        def fake_station_post_probe(station, path, token, payload):
            calls.append((station, path, token, payload))
            return 404, "404 page not found"

        module.station_post_probe = fake_station_post_probe

        with self.assertRaises(module.GateError) as raised:
            module.assert_station_telemetry_routes("http://station.local", "token")

        self.assertIn(module.FRONTEND_TELEMETRY_INGEST_PATH, str(raised.exception))
        self.assertEqual(calls[0][1], module.FRONTEND_TELEMETRY_INGEST_PATH)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_local_station_source(root)
            report = {
                "repoRoot": str(root),
                "station": "http://station.local",
                "steps": [
                    self.runtime_closure_step(),
                    {"name": "preflight.gateway_station", "status": "pass"},
                    {"name": "gateway.auth_login", "status": "pass"},
                    {"name": "station.auth_login", "status": "pass"},
                ],
            }
            module.record_failure(report, raised.exception)
        module.apply_status_metadata(report)

        self.assertEqual(report["failedStep"], "station.telemetry_routes")
        self.assertEqual(report["issueBreakdown"][0]["category"], "station-telemetry-route-missing")
        self.assertEqual(report["issueBreakdown"][0]["status"], "fail")
        self.assertEqual(report["issueBreakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issueBreakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issueBreakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["localSourceRouteEvidence"]["proofStatus"], "PROVEN")
        self.assertEqual(
            report["issueBreakdown"][0]["environmentClassification"],
            "target-station-handler-missing-while-local-source-registers-routes",
        )
        self.assertEqual(report["issueBreakdown"][0]["localSourceRouteEvidence"]["proofStatus"], "PROVEN")
        self.assertEqual(report["issueBreakdown"][0]["targetRuntimeRouteEvidence"]["handlerCount"], 2)
        self.assertEqual(report["issueBreakdown"][0]["targetRuntimeRouteEvidence"]["routeContractProofStatus"], "UNPROVEN")
        self.assertEqual(report["issueBreakdown"][0]["targetRuntimeRouteEvidence"]["missingRouteContracts"], module.REQUIRED_ROUTE_CONTRACTS)
        self.assertEqual(report["issueBreakdown"][0]["targetRuntimeRouteEvidence"]["versionFingerprint"]["buildCommit"], "unknown")
        self.assertEqual(report["issueBreakdown"][0]["targetRuntimeRouteEvidence"]["identityProofStatus"], "UNPROVEN")
        self.assertEqual(report["issueBreakdown"][0]["targetRuntimeRouteEvidence"]["identity"]["missingFields"], ["buildCommit", "buildTime"])
        self.assertEqual(report["summary"]["targetRuntimeHandlerTableStatus"], "pass")
        self.assertEqual(report["summary"]["localSourceRouteContractProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["localSourceRegisteredRouteContractCount"], 3)
        self.assertEqual(report["summary"]["targetRuntimeRouteContractProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["targetRuntimeMatchedRouteContractCount"], 0)
        self.assertEqual(report["summary"]["targetRuntimeMissingRouteContractCount"], 3)
        self.assertEqual(report["summary"]["targetRuntimeVersionProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["targetRuntimeVersionFingerprint"]["buildCommit"], "unknown")
        self.assertEqual(report["summary"]["targetRuntimeIdentityProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["targetRuntimeIdentity"]["missingFields"], ["buildCommit", "buildTime"])
        self.assertEqual(report["summary"]["targetRuntimeMissingRoutes"], module.REQUIRED_LOCAL_ROUTE_TOKENS)
        self.assertEqual(report["issueBreakdown"][0]["blockedBy"][0]["blockedStep"], "gateway.frontend_telemetry_upload")
        self.assertEqual(report["issueBreakdown"][0]["blockedBy"][0]["blockedPhase"], "P0a-3")
        self.assertEqual(report["issueBreakdown"][0]["blockedBy"][0]["blockedByStep"], "station.telemetry_routes")
        self.assertEqual(report["issueBreakdown"][0]["blockedBy"][0]["blockedByPhase"], "P0a-4")
        self.assertEqual(report["summary"]["blockedStep"], "gateway.frontend_telemetry_upload")
        self.assertEqual(report["summary"]["blockedPhase"], "P0a-3")
        self.assertEqual(report["summary"]["blockedByStep"], "station.telemetry_routes")
        self.assertEqual(report["summary"]["blockedByPhase"], "P0a-4")
        self.assertEqual(report["summary"]["blockedDownstreamSteps"], ["station.raw_query", "station.rollup_query", "dev_mirror"])
        self.assertIn("PARTIAL/UNPROVEN", report["issueBreakdown"][0]["proofImpact"])
        self.assertTrue(
            any(
                "/telemetry/frontend/events/batch" in item["command"]
                for item in report["recommendedReviewCommands"]
            )
        )
        markdown = module.render_markdown(report)
        self.assertIn("- Status: `fail`", markdown)
        self.assertIn("- Failed step: `station.telemetry_routes`", markdown)
        self.assertIn("- Blocked step: `gateway.frontend_telemetry_upload`", markdown)
        self.assertIn("- Blocked phase: `P0a-3`", markdown)
        self.assertIn("- Blocked by step: `station.telemetry_routes`", markdown)
        self.assertIn("- Blocked by phase: `P0a-4`", markdown)
        self.assertIn("- Blocked downstream steps: `station.raw_query,station.rollup_query,dev_mirror`", markdown)
        self.assertIn("- Local source route contracts: `3/3`", markdown)
        self.assertIn("- Target runtime route contracts: `0/3`", markdown)
        self.assertIn("- Target runtime route contract proof: `UNPROVEN`", markdown)
        self.assertIn("POST /telemetry/frontend/events/batch", markdown)
        self.assertIn(
            "- Environment classification: `target-station-handler-missing-while-local-source-registers-routes`",
            markdown,
        )
        self.assertIn("- Passed steps: `runtime.closure,preflight.gateway_station,gateway.auth_login,station.auth_login`", markdown)
        self.assertIn("- Failed steps: `station.telemetry_routes`", markdown)
        self.assertIn("- Pending steps: `gateway.frontend_telemetry_upload,station.raw_query,station.rollup_query,dev_mirror`", markdown)
        self.assertIn("- Local source routes: `3/3`", markdown)
        self.assertIn("- Target runtime routes: `0/3`", markdown)
        self.assertIn("- Target runtime build commit: `unknown`", markdown)
        self.assertIn("- Target runtime identity proof: `UNPROVEN`", markdown)
        self.assertIn("- Target runtime identity missing fields: `buildCommit,buildTime`", markdown)
        self.assertIn(
            "- Target runtime missing routes: `/telemetry/frontend/events/batch,/telemetry/frontend/events/query,/telemetry/frontend/rollups/query`",
            markdown,
        )

    def test_target_runtime_identity_evidence_marks_unknown_build_as_unproven(self) -> None:
        module = load_gate_module()

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

    def test_handler_parser_accepts_path_key_variants(self) -> None:
        module = load_gate_module()

        self.assertEqual(
            module.handler_paths_from_response({"handlers": [{"Path": "/upper"}, {"path": "/lower"}, "skip"]}),
            ["/upper", "/lower"],
        )

    def test_station_telemetry_routes_probe_accepts_present_routes(self) -> None:
        module = load_gate_module()
        responses = {
            module.FRONTEND_TELEMETRY_INGEST_PATH: (400, "events must not be empty"),
            module.FRONTEND_TELEMETRY_QUERY_PATH: (200, '{"events":[],"count":0}'),
            module.FRONTEND_TELEMETRY_ROLLUP_PATH: (200, '{"rollups":[],"count":0}'),
        }

        def fake_station_post_probe(station, path, token, payload):
            return responses[path]

        module.station_post_probe = fake_station_post_probe

        result = module.assert_station_telemetry_routes("http://station.local", "token")

        self.assertEqual([item["path"] for item in result["routes"]], [
            module.FRONTEND_TELEMETRY_INGEST_PATH,
            module.FRONTEND_TELEMETRY_QUERY_PATH,
            module.FRONTEND_TELEMETRY_ROLLUP_PATH,
        ])
        self.assertEqual(result["routes"][0]["status"], 400)

    def test_record_preflight_failure_keeps_machine_readable_reason(self) -> None:
        module = load_gate_module()
        report = {"steps": [self.runtime_closure_step()]}

        module.record_failure(report, module.GateError("POST http://127.0.0.1:3030 failed: refused"))
        module.apply_status_metadata(report)

        self.assertEqual(report["status"], "baseline preflight failure")
        self.assertEqual(report["failedStep"], "preflight.gateway_station")
        self.assertIn("preflight.gateway_station failed", report["reason"])
        self.assertEqual(report["details"][0]["step"], "preflight.gateway_station")
        self.assertEqual(report["issueBreakdown"][0]["category"], "desktop-gateway-preflight")
        self.assertEqual(report["issueBreakdown"][0]["failedStep"], "preflight.gateway_station")
        self.assertEqual(report["issueBreakdown"][0]["status"], "baseline preflight failure")
        self.assertEqual(report["issueBreakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issueBreakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issueBreakdown"][0]["sampleEmissionAllowed"])
        self.assertIn("PARTIAL/UNPROVEN", report["issueBreakdown"][0]["proofImpact"])
        self.assertEqual(
            report["issueBreakdown"][0]["sourceArtifact"],
            "tooling/acceptance/reports/desktop-telemetry-live-gate.json",
        )
        self.assertEqual(report["issueBreakdown"][0]["sourceArtifactKind"], "desktop-telemetry-live-gate")
        self.assertEqual(report["issueBreakdown"][0]["sourcePhase"], module.PHASE)
        self.assertEqual(report["issueBreakdown"][0]["sourceBom"], module.BOM)
        self.assertEqual(report["issueBreakdown"][0]["sourceSpec"], module.SPEC)
        self.assertEqual(report["issueBreakdown"][0]["sourceGate"], module.GATE)
        self.assertEqual(report["issueBreakdown"][0]["evidenceDetails"][0]["step"], "preflight.gateway_station")
        self.assertEqual(report["issue_breakdown"], report["issueBreakdown"])
        self.assertEqual(report["recommended_review_commands"], report["recommendedReviewCommands"])
        self.assertEqual(
            report["issueBreakdown"][0]["recommended_review_commands"],
            report["recommendedReviewCommands"],
        )
        self.assertTrue(
            any(item["command"] == "make desktop" for item in report["recommendedReviewCommands"])
        )
        self.assertTrue(
            any("desktop-telemetry-live-gate.py" in item["command"] for item in report["recommendedReviewCommands"])
        )
        self.assertEqual(report["steps"][-1]["status"], "fail")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["failedStep"], "preflight.gateway_station")
        self.assertEqual(report["summary"]["expectedStepCount"], 9)
        self.assertEqual(report["summary"]["passedStepCount"], 1)
        self.assertEqual(report["summary"]["failedStepCount"], 1)
        self.assertEqual(report["summary"]["failedSteps"], ["preflight.gateway_station"])
        self.assertIn("gateway.auth_login", report["summary"]["pendingSteps"])
        markdown = module.render_markdown(report)
        self.assertIn("# Desktop Telemetry Live Gate", markdown)
        self.assertIn("- Status: `baseline preflight failure`", markdown)
        self.assertIn("- Proof: `UNPROVEN`", markdown)
        self.assertIn("- Failed steps: `preflight.gateway_station`", markdown)
        self.assertIn("gateway.frontend_telemetry_upload", markdown)

    def test_record_runtime_failure_keeps_failed_step_after_passed_steps(self) -> None:
        module = load_gate_module()
        report = {
            "steps": [
                self.runtime_closure_step(),
                {"name": "preflight.gateway_station", "status": "pass"},
                {"name": "gateway.auth_login", "status": "pass"},
                {"name": "station.auth_login", "status": "pass"},
                {"name": "station.telemetry_routes", "status": "pass"},
            ]
        }

        module.record_failure(report, module.GateError("upload rejected"))
        module.apply_status_metadata(report)

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["failedStep"], "gateway.frontend_telemetry_upload")
        self.assertEqual(report["details"][0]["error"], "upload rejected")
        self.assertEqual(report["issueBreakdown"][0]["category"], "gateway-telemetry-upload")
        self.assertEqual(report["issueBreakdown"][0]["failedStep"], "gateway.frontend_telemetry_upload")
        self.assertEqual(report["issueBreakdown"][0]["status"], "fail")
        self.assertEqual(report["issueBreakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issueBreakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issueBreakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(
            report["issueBreakdown"][0]["sourceArtifact"],
            "tooling/acceptance/reports/desktop-telemetry-live-gate.json",
        )
        self.assertEqual(report["issueBreakdown"][0]["sourceArtifactKind"], "desktop-telemetry-live-gate")
        self.assertEqual(report["issueBreakdown"][0]["sourcePhase"], module.PHASE)
        self.assertEqual(report["issueBreakdown"][0]["sourceBom"], module.BOM)
        self.assertEqual(report["issueBreakdown"][0]["sourceSpec"], module.SPEC)
        self.assertEqual(report["issueBreakdown"][0]["sourceGate"], module.GATE)
        self.assertEqual(report["issueBreakdown"][0]["evidenceDetails"][0]["error"], "upload rejected")
        self.assertNotIn("blockedBy", report["issueBreakdown"][0])
        self.assertEqual(report["issue_breakdown"], report["issueBreakdown"])
        self.assertEqual(report["recommended_review_commands"], report["recommendedReviewCommands"])
        self.assertEqual(
            report["issueBreakdown"][0]["recommendedReviewCommands"],
            report["recommendedReviewCommands"],
        )
        self.assertTrue(
            any(item["command"] == "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json" for item in report["recommendedReviewCommands"])
        )
        self.assertEqual(report["steps"][-1]["name"], "gateway.frontend_telemetry_upload")
        self.assertEqual(report["steps"][-1]["status"], "fail")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["failedStep"], "gateway.frontend_telemetry_upload")
        self.assertEqual(report["summary"]["expectedStepCount"], 9)
        self.assertEqual(report["summary"]["passedStepCount"], 5)
        self.assertEqual(report["summary"]["failedSteps"], ["gateway.frontend_telemetry_upload"])
        self.assertIn("station.raw_query", report["summary"]["pendingSteps"])

    def test_runtime_closure_failure_blocks_live_gate_before_gateway_or_station_steps(self) -> None:
        module = load_gate_module()
        report = {
            "output": "tooling/acceptance/reports/desktop-telemetry-live-gate.json",
            "runtimeClosureEvidence": self.runtime_closure_evidence("diagnostic incomplete"),
            "steps": [],
        }

        module.record_failure(
            report,
            module.GateError(
                "runtime closure does not allow live sample emission: "
                "proofStatus=UNPROVEN sampleEmissionAllowed=False local=UNPROVEN compose=UNPROVEN docker=UNPROVEN"
            ),
        )
        module.apply_status_metadata(report)

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["failedStep"], "runtime.closure")
        self.assertEqual(report["issueBreakdown"][0]["category"], "runtime-closure-unproven")
        self.assertEqual(report["issueBreakdown"][0]["status"], "fail")
        self.assertEqual(report["issueBreakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issueBreakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issueBreakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["issueBreakdown"][0]["sourceArtifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(report["details"][0]["runtimeClosureEvidence"]["sourceArtifactKind"], "desktop-telemetry-runtime-closure-gate")
        self.assertEqual(report["summary"]["runtimeClosureProofStatus"], "UNPROVEN")
        self.assertFalse(report["summary"]["runtimeClosureSampleEmissionAllowed"])
        self.assertEqual(report["summary"]["runtimeClosureDockerDaemonProofStatus"], "UNPROVEN")
        self.assertIn("docker-daemon", report["summary"]["runtimeClosureFailedCheckReasons"])
        self.assertIn("local-dev-store-dsn", report["summary"]["runtimeClosureCheckReasons"])
        self.assertEqual(
            report["summary"]["runtimeClosureLocalRuntimeClosure"]["failedChecks"],
            ["local-dev-station-entrypoint", "local-dev-store-dsn"],
        )
        self.assertEqual(report["summary"]["runtimeClosureComposeRuntimeClosure"]["failedChecks"], ["docker-daemon"])
        self.assertEqual(report["summary"]["passedSteps"], [])
        self.assertEqual(report["summary"]["failedSteps"], ["runtime.closure"])
        self.assertIn("preflight.gateway_station", report["summary"]["pendingSteps"])
        self.assertEqual(report["issueBreakdown"][0]["blockedBy"][0]["blockedByStep"], "runtime.closure")
        self.assertIn("gateway.frontend_telemetry_upload", report["issueBreakdown"][0]["blockedBy"][0]["blockedDownstreamSteps"])
        self.assertEqual(len(report["runtimeClosureBlockedDownstreamProofs"]), 2)
        self.assertEqual(len(report["details"][0]["runtimeClosureBlockedDownstreamProofs"]), 2)
        self.assertEqual(len(report["issueBreakdown"][0]["runtimeClosureBlockedDownstreamProofs"]), 2)
        self.assertEqual(report["issueBreakdown"][0]["runtimeClosureBlockedDownstreamProofs"][0]["step"], "gateway.frontend_telemetry_upload")
        self.assertEqual(
            report["issueBreakdown"][0]["runtimeClosureBlockedDownstreamProofs"][0]["sourceArtifactKind"],
            "desktop-telemetry-runtime-closure-gate",
        )
        self.assertEqual(report["summary"]["runtimeClosureBlockedDownstreamProofCount"], 2)
        self.assertFalse(report["sampleEmissionAllowed"])
        markdown = module.render_markdown(report)
        self.assertIn("- Failed step: `runtime.closure`", markdown)
        self.assertIn("- Runtime closure proof: `UNPROVEN`", markdown)
        self.assertIn("- Runtime closure Docker daemon proof: `UNPROVEN`", markdown)
        self.assertIn('"docker-daemon": "command exited 1"', markdown)
        self.assertIn("- Runtime closure local closure proof: `UNPROVEN`", markdown)
        self.assertIn("- Runtime closure compose closure proof: `UNPROVEN`", markdown)
        self.assertIn("- Runtime closure blocked downstream proof count: `2`", markdown)
        self.assertIn('"step": "gateway.frontend_telemetry_upload"', markdown)


if __name__ == "__main__":
    unittest.main()
