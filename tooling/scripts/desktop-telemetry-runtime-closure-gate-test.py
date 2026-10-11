#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock


def load_module() -> Any:
    script = Path(__file__).with_name("desktop-telemetry-runtime-closure-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_telemetry_runtime_closure_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def write_runtime_files(root: Path, *, compose_complete: bool = True, compose_delegated_station: bool = False) -> None:
    station_dev = root / "tooling/scripts/local-dev/station-dev.sh"
    station_dev.parent.mkdir(parents=True, exist_ok=True)
    station_dev.write_text(
        """
#!/usr/bin/env bash
cd "$PROJECT_ROOT/apps/station/app"
STATION_PORT="$STATION_PORT" nohup go run . &
"""
        if not compose_delegated_station
        else """
#!/usr/bin/env bash
docker compose -f "$PROJECT_ROOT/tooling/docker/compose.yml" --profile infra --profile station up -d postgres station
""",
        encoding="utf-8",
    )

    store_local = root / "apps/station/app/conf/store.local.yml"
    store_local.parent.mkdir(parents=True, exist_ok=True)
    store_local.write_text(
        """
peers:
  store:
    rds:
      gorm:
        - dsn: host=localhost user=developer dbname=peers_touch port=15432 sslmode=disable
""",
        encoding="utf-8",
    )

    compose = root / "tooling/docker/compose.yml"
    compose.parent.mkdir(parents=True, exist_ok=True)
    compose.write_text(
        """
services:
  postgres:
    profiles: [infra]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
  station:
    profiles: [station]
    environment:
      PEERS_DB_DSN: host=postgres user=peers password=${PEERS_DB_PASSWORD} dbname=peers_touch port=5432 sslmode=disable
    ports:
      - "${STATION_PORT:-18080}:18080"
    depends_on:
      postgres:
        condition: service_healthy
"""
        if compose_complete
        else """
services:
  station:
    profiles: [station]
""",
        encoding="utf-8",
    )
    (root / "tooling/docker/.env").write_text(
        """
PEERS_AUTH_SECRET=test
PEERS_DB_PASSWORD=test
""",
        encoding="utf-8",
    )


def command_result(command: list[str], proof: str, output: list[str] | None = None) -> dict[str, Any]:
    output = output or []
    return {
        "command": command,
        "exitCode": 0 if proof == "PROVEN" else 1,
        "status": "pass" if proof == "PROVEN" else "diagnostic incomplete",
        "proofStatus": proof,
        "stdout": output if proof == "PROVEN" else [],
        "stderr": [] if proof == "PROVEN" else output,
        "output": output,
        "reason": None
        if proof == "PROVEN"
        else f"command exited 1: {output[0]}"
        if output
        else "command exited 1",
    }


class DesktopTelemetryRuntimeClosureGateTest(unittest.TestCase):
    def test_gate_is_partial_when_local_dev_is_unmanaged_and_docker_daemon_is_not_ready(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_runtime_files(root)

            def fake_run(command: list[str], _timeout: float) -> dict[str, Any]:
                if command[:2] == ["docker", "--version"]:
                    return command_result(command, "PROVEN", ["Docker version 29.4.0"])
                if command[:3] == ["docker", "compose", "version"]:
                    return command_result(command, "PROVEN", ["Docker Compose version v2.39.2"])
                if command[:3] == ["docker", "compose", "-f"]:
                    return command_result(command, "PROVEN", ["postgres", "station"])
                if command[:2] == ["docker", "info"]:
                    return command_result(command, "UNPROVEN", ["Cannot connect to the Docker daemon"])
                return command_result(command, "UNPROVEN")

            with mock.patch.object(module, "run_command", side_effect=fake_run):
                report = module.build_report(root, Path("out.json"), 0.1)

        self.assertEqual(report["artifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertIsNone(report["managedRuntimeClosure"])
        self.assertEqual(report["failedStep"], "runtime.closure")
        self.assertIn("sample emission remains blocked", report["reason"])
        self.assertEqual(report["blockedStep"], "gateway.frontend_telemetry_upload")
        self.assertEqual(report["blockedByStep"], "runtime.closure")
        self.assertEqual(report["blockedDownstreamSteps"][-1], "dev_mirror")
        self.assertEqual(len(report["blockedDownstreamProofs"]), len(module.BLOCKED_DOWNSTREAM_STEPS))
        first_blocked = report["blockedDownstreamProofs"][0]
        self.assertEqual(first_blocked["step"], "preflight.gateway_station")
        self.assertEqual(first_blocked["status"], "blocked")
        self.assertEqual(first_blocked["proofStatus"], "UNPROVEN")
        self.assertFalse(first_blocked["sampleEmissionAllowed"])
        self.assertEqual(first_blocked["blockedByStep"], "runtime.closure")
        self.assertEqual(first_blocked["sourceArtifact"], "out.json")
        self.assertEqual(first_blocked["sourceArtifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(first_blocked["sourcePhase"], module.PHASE)
        self.assertEqual(first_blocked["sourceBom"], module.BOM)
        self.assertEqual(first_blocked["sourceSpec"], module.SPEC)
        self.assertEqual(first_blocked["sourceGate"], module.GATE)
        self.assertIn("docker-daemon", first_blocked["failedCheckReasons"])
        self.assertEqual(report["summary"]["failedStep"], "runtime.closure")
        self.assertEqual(report["summary"]["blockedStep"], "gateway.frontend_telemetry_upload")
        self.assertEqual(report["summary"]["blockedDownstreamProofs"], report["blockedDownstreamProofs"])
        self.assertEqual(report["summary"]["blockedByPhase"], module.PHASE)
        self.assertIn("docker-daemon", report["summary"]["composeFailedChecks"])
        self.assertIn("local-dev-station-entrypoint", report["summary"]["localFailedChecks"])
        self.assertEqual(report["summary"]["localRuntimeClosureProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["composeRuntimeClosureProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["dockerDaemonProofStatus"], "UNPROVEN")
        self.assertIn("local-dev-store-dsn", report["summary"]["checkReasons"])
        self.assertIn("docker-daemon", report["summary"]["failedCheckReasons"])
        self.assertIn("host localhost:15432", report["summary"]["failedCheckReasons"]["local-dev-store-dsn"])
        self.assertIn("command exited 1", report["summary"]["failedCheckReasons"]["docker-daemon"])
        self.assertIn("Cannot connect to the Docker daemon", report["summary"]["failedCheckReasons"]["docker-daemon"])
        self.assertEqual(report["summary"]["localRuntimeClosure"]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["summary"]["localRuntimeClosure"]["sampleEmissionAllowed"])
        self.assertEqual(
            report["summary"]["localRuntimeClosure"]["failedChecks"],
            ["local-dev-station-entrypoint", "local-dev-store-dsn"],
        )
        self.assertIn("local-dev-store-dsn", report["summary"]["localRuntimeClosure"]["failedCheckReasons"])
        self.assertEqual(report["summary"]["composeRuntimeClosure"]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["summary"]["composeRuntimeClosure"]["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["composeRuntimeClosure"]["failedChecks"], ["docker-daemon"])
        self.assertIn("docker-daemon", report["summary"]["composeRuntimeClosure"]["failedCheckReasons"])
        self.assertIn(
            "Cannot connect to the Docker daemon",
            report["summary"]["composeRuntimeClosure"]["failedCheckReasons"]["docker-daemon"],
        )
        self.assertEqual(report["issueBreakdown"][0]["category"], "local-dev-station-runtime-closure-unproven")
        self.assertEqual(report["issueBreakdown"][0]["failedStep"], "runtime.closure")
        self.assertEqual(report["issueBreakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(report["issueBreakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issueBreakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issueBreakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["issueBreakdown"][0]["sourcePhase"], module.PHASE)
        self.assertEqual(report["issueBreakdown"][0]["sourceBom"], module.BOM)
        self.assertEqual(report["issueBreakdown"][0]["sourceSpec"], module.SPEC)
        self.assertIn("PARTIAL/UNPROVEN", report["issueBreakdown"][0]["proofImpact"])
        self.assertEqual(report["issueBreakdown"][1]["category"], "compose-station-runtime-closure-unproven")
        self.assertEqual(report["issueBreakdown"][1]["failedStep"], "runtime.closure")
        self.assertEqual(report["issueBreakdown"][1]["status"], "diagnostic incomplete")
        self.assertEqual(report["issueBreakdown"][1]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issueBreakdown"][1]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issueBreakdown"][1]["sampleEmissionAllowed"])

    def test_compose_delegated_make_station_still_requires_runtime_daemon_proof(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_runtime_files(root, compose_delegated_station=True)

            def fake_run(command: list[str], _timeout: float) -> dict[str, Any]:
                if command[:2] == ["docker", "--version"]:
                    return command_result(command, "PROVEN", ["Docker version 29.4.0"])
                if command[:3] == ["docker", "compose", "version"]:
                    return command_result(command, "PROVEN", ["Docker Compose version v2.39.2"])
                if command[:3] == ["docker", "compose", "-f"]:
                    return command_result(command, "PROVEN", ["postgres", "station"])
                if command[:2] == ["docker", "info"]:
                    return command_result(command, "UNPROVEN", ["Cannot connect to the Docker daemon"])
                return command_result(command, "UNPROVEN")

            with mock.patch.object(module, "run_command", side_effect=fake_run):
                report = module.build_report(root, Path("out.json"), 0.1)

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertIsNone(report["managedRuntimeClosure"])
        self.assertEqual(report["summary"]["localFailedChecks"], [])
        self.assertEqual(report["summary"]["composeFailedChecks"], ["docker-daemon"])
        self.assertEqual(report["summary"]["failedChecks"], ["docker-daemon"])
        self.assertEqual(report["summary"]["localRuntimeClosure"]["failedChecks"], [])
        self.assertFalse(report["summary"]["localRuntimeClosure"]["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["composeRuntimeClosure"]["failedChecks"], ["docker-daemon"])
        self.assertEqual(len(report["issueBreakdown"]), 1)
        self.assertEqual(report["issueBreakdown"][0]["category"], "compose-station-runtime-closure-unproven")
        self.assertEqual(report["issueBreakdown"][0]["failedStep"], "runtime.closure")
        self.assertEqual(report["issueBreakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issueBreakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issueBreakdown"][0]["sampleEmissionAllowed"])

    def test_gate_passes_when_compose_contract_and_daemon_are_ready_even_if_local_dev_is_unmanaged(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_runtime_files(root)

            def fake_run(command: list[str], _timeout: float) -> dict[str, Any]:
                if command[:3] == ["docker", "compose", "-f"]:
                    return command_result(command, "PROVEN", ["postgres", "station"])
                return command_result(command, "PROVEN", ["ok"])

            with mock.patch.object(module, "run_command", side_effect=fake_run):
                report = module.build_report(root, Path("out.json"), 0.1)

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertEqual(report["managedRuntimeClosure"], "compose-station-postgres")
        self.assertIsNone(report["failedStep"])
        self.assertIsNone(report["blockedStep"])
        self.assertEqual(report["blockedDownstreamSteps"], [])
        self.assertEqual(report["blockedDownstreamProofs"], [])
        self.assertIsNone(report["summary"]["failedStep"])
        self.assertEqual(report["summary"]["blockedDownstreamSteps"], [])
        self.assertEqual(report["summary"]["blockedDownstreamProofs"], [])
        self.assertEqual(report["summary"]["localRuntimeClosureProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["composeRuntimeClosureProofStatus"], "PROVEN")
        self.assertEqual(
            report["summary"]["localRuntimeClosure"]["failedChecks"],
            ["local-dev-station-entrypoint", "local-dev-store-dsn"],
        )
        self.assertEqual(report["summary"]["composeRuntimeClosure"]["failedChecks"], [])
        self.assertEqual(report["summary"]["composeRuntimeClosure"]["proofStatus"], "PROVEN")
        self.assertTrue(report["summary"]["composeRuntimeClosure"]["sampleEmissionAllowed"])
        self.assertEqual(report["issueBreakdown"], [])

    def test_compose_contract_missing_keeps_gate_unproven(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_runtime_files(root, compose_complete=False)

            def fake_run(command: list[str], _timeout: float) -> dict[str, Any]:
                if command[:3] == ["docker", "compose", "-f"]:
                    return command_result(command, "UNPROVEN", ["station"])
                return command_result(command, "PROVEN", ["ok"])

            with mock.patch.object(module, "run_command", side_effect=fake_run):
                report = module.build_report(root, Path("out.json"), 0.1)

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["failedStep"], "runtime.closure")
        self.assertIn("compose-station-postgres-contract", report["summary"]["composeFailedChecks"])
        compose_contract = next(check for check in report["checks"] if check["name"] == "compose-station-postgres-contract")
        self.assertEqual(compose_contract["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])

    def test_remote_profile_health_proves_runtime_closure_without_local_docker(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_runtime_files(root)
            active = root / ".local/dev/active" / f"{root.name}.env"
            active.parent.mkdir(parents=True, exist_ok=True)
            active.write_text(
                "\n".join(
                    [
                        "PT_DEV_PROFILE=one",
                        "PT_STATION_MODE=remote",
                        "PT_STATION_URL=http://192.0.2.10:18080",
                        "PT_STATION_HEALTH_URL=http://192.0.2.10:18080/sub-oss/healthz",
                    ]
                ),
                encoding="utf-8",
            )

            def fake_run(command: list[str], _timeout: float) -> dict[str, Any]:
                if command[:2] == ["docker", "info"]:
                    return command_result(command, "UNPROVEN", ["Cannot connect to the Docker daemon"])
                return command_result(command, "PROVEN", ["ok"])

            remote_health = {
                "name": "remote-station-health",
                "status": "pass",
                "proofStatus": "PROVEN",
                "url": "http://192.0.2.10:18080/sub-oss/healthz",
                "reason": "remote Station health check passed",
            }
            with mock.patch.object(module, "run_command", side_effect=fake_run), mock.patch.object(
                module, "remote_station_health_evidence", return_value=remote_health
            ):
                report = module.build_report(root, Path("out.json"), 0.1)

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertEqual(report["managedRuntimeClosure"], "remote-profile-station")
        self.assertEqual(report["summary"]["remoteRuntimeClosureProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["remoteRuntimeClosure"]["profile"], "one")
        self.assertEqual(report["summary"]["remoteRuntimeClosure"]["stationURL"], "http://192.0.2.10:18080")
        self.assertEqual(report["summary"]["failedChecks"], [])
        self.assertEqual(report["blockedDownstreamProofs"], [])
        self.assertEqual(report["issueBreakdown"], [])


if __name__ == "__main__":
    unittest.main()
