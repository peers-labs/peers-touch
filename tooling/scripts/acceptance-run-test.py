#!/usr/bin/env python3
"""Regression tests for acceptance-run evidence summaries."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (
    ArtifactRef,
    CredentialRef,
    EnvironmentContract,
    EvidenceConflict,
    EvidenceManifestInvalid,
    EvidenceStore,
    EphemeralCapabilityBlocked,
    EphemeralCapabilityHandler,
    EphemeralCleanupResult,
    EphemeralGateLaunchContext,
    EphemeralHandlerCleanup,
    EphemeralLaunchCleanupFailed,
    EphemeralLaunchContextInvalid,
    EphemeralLaunchError,
    RuntimeCellLifecycle,
    new_report,
)
from tooling.acceptance.provisioners import HomeStationProvisioner


def load_module() -> Any:
    script = Path(__file__).with_name("acceptance-run.py")
    spec = importlib.util.spec_from_file_location("acceptance_run", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AcceptanceRunTest(unittest.TestCase):
    def test_source_identity_drift_preserves_aggregate_baseline(self) -> None:
        module = load_module()
        expected = {
            "commit": "a" * 40,
            "workspaceDigest": "clean",
            "canonicalWorktreeHash": "workspace-a",
        }

        self.assertIsNone(module.source_identity_drift(expected, dict(expected)))
        observed = {
            **expected,
            "workspaceDigest": "sha256:dirty",
        }
        self.assertEqual(
            module.source_identity_drift(expected, observed),
            {
                "expected": expected,
                "observed": observed,
            },
        )

    def test_main_skips_gate_when_source_drift_exists_at_gate_start(self) -> None:
        module = load_module()
        expected = {
            "commit": "a" * 40,
            "workspaceDigest": "clean",
            "canonicalWorktreeHash": "workspace-a",
        }
        observed = {
            **expected,
            "workspaceDigest": "sha256:dirty",
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifact_root = root / "artifacts"
            gates_path = root / "gates.json"
            gates_path.write_text(
                json.dumps(
                    {
                        "gates": {
                            "synthetic-gate": {
                                "command": "synthetic-command",
                                "environment": "local",
                                "tier": "ci-cheap",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            plan_path = root / "plan.json"
            plan_path.write_text(
                json.dumps({"selected_gates": []}),
                encoding="utf-8",
            )
            run_gate = mock.Mock()
            with mock.patch.dict(
                os.environ,
                {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(artifact_root)},
                clear=False,
            ), mock.patch.object(
                sys,
                "argv",
                [
                    "acceptance-run.py",
                    "--plan",
                    str(plan_path),
                    "--gates",
                    str(gates_path),
                    "--gate",
                    "synthetic-gate",
                ],
            ), mock.patch(
                "tooling.acceptance.core.source_identity",
                side_effect=(expected, observed, expected),
            ), mock.patch.object(
                module.subprocess,
                "run",
                run_gate,
            ):
                exit_code = module.main()

            store = EvidenceStore(artifact_root, worktree=REPO_ROOT)
            latest = store.latest("synthetic-gate")
            aggregate = store.latest("acceptance-run")
            aggregate_report = store.read_json(
                ArtifactRef.from_dict(aggregate["artifacts"]["run"])
            )

        self.assertEqual(exit_code, 1)
        run_gate.assert_not_called()
        self.assertEqual(latest["result"]["status"], "failed")
        self.assertEqual(latest["result"]["sourceDrift"]["expected"], expected)
        self.assertEqual(latest["result"]["sourceDrift"]["observed"], observed)
        self.assertEqual(aggregate_report["source"], expected)

    def test_main_fails_gate_when_source_drifts_during_execution(self) -> None:
        module = load_module()
        expected = {
            "commit": "a" * 40,
            "workspaceDigest": "clean",
            "canonicalWorktreeHash": "workspace-a",
        }
        observed = {
            **expected,
            "workspaceDigest": "sha256:dirty",
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifact_root = root / "artifacts"
            gates_path = root / "gates.json"
            gates_path.write_text(
                json.dumps(
                    {
                        "gates": {
                            "synthetic-gate": {
                                "command": "synthetic-command",
                                "environment": "local",
                                "tier": "ci-cheap",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            plan_path = root / "plan.json"
            plan_path.write_text(
                json.dumps({"selected_gates": []}),
                encoding="utf-8",
            )
            completed = mock.Mock(
                returncode=0,
                stdout="gate passed\n",
                stderr="",
            )
            with mock.patch.dict(
                os.environ,
                {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(artifact_root)},
                clear=False,
            ), mock.patch.object(
                sys,
                "argv",
                [
                    "acceptance-run.py",
                    "--plan",
                    str(plan_path),
                    "--gates",
                    str(gates_path),
                    "--gate",
                    "synthetic-gate",
                ],
            ), mock.patch(
                "tooling.acceptance.core.source_identity",
                side_effect=(expected, expected, observed),
            ), mock.patch.object(
                module.subprocess,
                "run",
                return_value=completed,
            ):
                exit_code = module.main()

            store = EvidenceStore(artifact_root, worktree=REPO_ROOT)
            latest = store.latest("synthetic-gate")
            log = store.resolve(
                ArtifactRef.from_dict(latest["result"]["log"])
            ).read_text(encoding="utf-8")

        self.assertEqual(exit_code, 1)
        self.assertEqual(latest["result"]["status"], "failed")
        self.assertEqual(latest["result"]["sourceDrift"]["expected"], expected)
        self.assertEqual(latest["result"]["sourceDrift"]["observed"], observed)
        self.assertIn("source drifted during aggregate execution", log)

    def test_core_exports_generic_runner_contracts(self) -> None:
        self.assertTrue(
            issubclass(EphemeralLaunchCleanupFailed, EphemeralLaunchError)
        )
        self.assertTrue(hasattr(RuntimeCellLifecycle, "stop"))

    def test_run_environment_projects_and_restores_runtime_cell(self) -> None:
        module = load_module()
        keys = {
            "PT_ACCEPTANCE_ARTIFACT_ROOT": "/tmp/artifacts",
            "PT_ACCEPTANCE_WORKSPACE_ID": "workspace",
            "PT_ACCEPTANCE_GATE_ID": "synthetic-gate",
            "PT_ACCEPTANCE_RUN_ID": "synthetic-run",
            "PT_ACCEPTANCE_RUNTIME_CELL": "desktop-linux-native",
        }
        with mock.patch.dict(os.environ, {}, clear=True):
            with module.run_environment(keys):
                self.assertEqual(
                    os.environ["PT_ACCEPTANCE_RUNTIME_CELL"],
                    "desktop-linux-native",
                )
            self.assertNotIn("PT_ACCEPTANCE_RUNTIME_CELL", os.environ)

    def test_context_gate_environment_excludes_parent_secrets(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("synthetic-context-gate", source={})
            try:
                run.configure_redaction(("resolved-secret",))
                environment = module.context_gate_subprocess_environment(
                    run,
                    {
                        "PATH": "/usr/bin",
                        "LANG": "en_US.UTF-8",
                        "HOME": "/private/parent-home",
                        "SYNTHETIC_SECRET": "resolved-secret",
                        "PT_MOBILE_RESOURCE_LEASE_AUTH_KEY": "ab" * 32,
                        "PT_ACCEPTANCE_REDACTION_VALUES": json.dumps(
                            ["resolved-secret"]
                        ),
                    },
                )
            finally:
                run.close()

        self.assertEqual(environment["PATH"], "/usr/bin")
        self.assertEqual(environment["LANG"], "en_US.UTF-8")
        self.assertEqual(
            environment["PT_ACCEPTANCE_GATE_ID"],
            "synthetic-context-gate",
        )
        self.assertNotIn("HOME", environment)
        self.assertNotIn("SYNTHETIC_SECRET", environment)
        self.assertNotIn("PT_MOBILE_RESOURCE_LEASE_AUTH_KEY", environment)
        self.assertNotIn("PT_ACCEPTANCE_REDACTION_VALUES", environment)
        self.assertNotIn("resolved-secret", json.dumps(environment))

    def test_provision_runtime_cell_persists_current_run_manifest(
        self,
    ) -> None:
        module = load_module()
        lifecycle = mock.Mock()
        manifest = mock.Mock()
        manifest.to_dict.return_value = {
            "artifactKind": "acceptance-runtime-cell-manifest",
            "cellId": "desktop-linux-native",
            "gateId": "synthetic-gate",
            "state": "LEASED",
        }
        lifecycle.ready.return_value = manifest
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("synthetic-gate", source={})
            with mock.patch(
                "tooling.acceptance.provisioners."
                "get_runtime_cell_lifecycle",
                return_value=lifecycle,
            ):
                resolved, payload, path = module.provision_runtime_cell(
                    cell_id="desktop-linux-native",
                    gate_id="synthetic-gate",
                    gate_run=run,
                )
            stored_manifest = json.loads(path.read_text(encoding="utf-8"))
            run.close()

        self.assertIs(resolved, lifecycle)
        lifecycle.ready.assert_called_once_with("synthetic-gate")
        lifecycle.stop.assert_not_called()
        self.assertEqual(payload["cellId"], "desktop-linux-native")
        self.assertEqual(
            payload["_manifest_ref"]["path"],
            "runtime/runtime-cell-manifest.json",
        )
        self.assertEqual(
            stored_manifest["state"],
            "LEASED",
        )

    def test_provision_runtime_cell_cleans_up_after_manifest_write_failure(
        self,
    ) -> None:
        module = load_module()
        lifecycle = mock.Mock()
        manifest = mock.Mock()
        manifest.to_dict.return_value = {"state": "LEASED"}
        lifecycle.ready.return_value = manifest
        gate_run = mock.Mock()
        gate_run.write_json.side_effect = RuntimeError("artifact write failed")
        with mock.patch(
            "tooling.acceptance.provisioners.get_runtime_cell_lifecycle",
            return_value=lifecycle,
        ), self.assertRaisesRegex(RuntimeError, "artifact write failed"):
            module.provision_runtime_cell(
                cell_id="desktop-linux-native",
                gate_id="synthetic-gate",
                gate_run=gate_run,
            )

        lifecycle.stop.assert_called_once_with()

    def test_main_orders_environment_cell_gate_and_reverse_cleanup(
        self,
    ) -> None:
        module = load_module()
        events: list[str] = []

        class EnvironmentProvisioner:
            resolved_credential_values = ("resolved-secret",)

            def bind_evidence_run(self, run: object) -> None:
                self.evidence_run = run
                events.append("evidence-run-bound")

            def prepare_credentials(
                self,
            ) -> tuple[tuple[str, ...], dict[str, str]]:
                events.append("credentials-ready")
                return (
                    ("env:SYNTHETIC_SECRET",),
                    {"synthetic": "resolved-secret"},
                )

            def cleanup(self) -> tuple[str, ...]:
                events.append("environment-cleanup")
                return ("environment",)

        class CellLifecycle:
            def stop(self) -> dict[str, str]:
                events.append("cell-stop")
                return {"state": "CLEANED"}

        environment_provisioner = EnvironmentProvisioner()
        cell_lifecycle = CellLifecycle()

        def provision_environment(*_args, **_kwargs):
            redaction_values = json.loads(
                os.environ["PT_ACCEPTANCE_REDACTION_VALUES"]
            )
            self.assertEqual(redaction_values, ["resolved-secret"])
            events.append("environment-ready")
            return (
                environment_provisioner,
                {"state": "FIXTURE_READY", "runId": "environment-run"},
                None,
            )

        def provision_runtime_cell(**_kwargs):
            events.append("cell-ready")
            return (
                cell_lifecycle,
                {
                    "artifactKind": "acceptance-runtime-cell-manifest",
                    "cellId": "desktop-linux-native",
                    "gateId": "synthetic-native-gate",
                    "state": "LEASED",
                },
                None,
            )

        def run_gate(*_args, **kwargs):
            self.assertEqual(
                json.loads(
                    kwargs["env"][module.AGGREGATE_SOURCE_ENV]
                ),
                {"commit": "abc123", "workspaceDigest": "clean"},
            )
            events.append("gate")
            return mock.Mock(stdout="", stderr="", returncode=1)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gates_path = root / "gates.json"
            gates_path.write_text(
                json.dumps(
                    {
                        "gates": {
                            "synthetic-native-gate": {
                                "command": "synthetic-command",
                                "environment": "synthetic-environment",
                                "provisioner": "synthetic-environment",
                                "requiredRuntimeCells": [
                                    "desktop-linux-native"
                                ],
                                "tier": "env-evidence",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            plan_path = root / "plan.json"
            plan_path.write_text(
                json.dumps({"selected_gates": []}),
                encoding="utf-8",
            )
            with mock.patch.dict(
                os.environ,
                {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "artifacts")},
                clear=False,
            ), mock.patch.object(
                sys,
                "argv",
                [
                    "acceptance-run.py",
                    "--plan",
                    str(plan_path),
                    "--gates",
                    str(gates_path),
                    "--gate",
                    "synthetic-native-gate",
                    "--runtime-cell",
                    "desktop-linux-native",
                ],
            ), mock.patch(
                "tooling.acceptance.core.source_identity",
                return_value={"commit": "abc123", "workspaceDigest": "clean"},
            ), mock.patch.object(
                module,
                "environment_provisioner",
                return_value=environment_provisioner,
            ), mock.patch.object(
                module,
                "provision_environment",
                side_effect=provision_environment,
            ), mock.patch.object(
                module,
                "provision_runtime_cell",
                side_effect=provision_runtime_cell,
            ), mock.patch.object(
                module.subprocess,
                "run",
                side_effect=run_gate,
            ):
                exit_code = module.main()

        self.assertEqual(exit_code, 1)
        self.assertEqual(
            events,
            [
                "evidence-run-bound",
                "credentials-ready",
                "environment-ready",
                "cell-ready",
                "gate",
                "cell-stop",
                "environment-cleanup",
            ],
        )

    def test_main_quiesces_context_before_resources_and_closes_after(
        self,
    ) -> None:
        module = load_module()
        events: list[str] = []

        class SyntheticHandler(EphemeralCapabilityHandler):
            @property
            def allowed_operations(self) -> tuple[str, ...]:
                return ("echo",)

            @property
            def sensitive_values(self) -> tuple[str, ...]:
                return ()

            def invoke(
                self,
                operation: str,
                payload: dict[str, object],
                *,
                deadline_monotonic: float,
                cancellation: threading.Event,
            ) -> dict[str, object]:
                return {"ok": True}

            def project_response(
                self,
                operation: str,
                response: dict[str, object],
            ) -> dict[str, object]:
                return dict(response)

            def quarantine(
                self,
                reason: str,
                *,
                deadline_monotonic: float,
            ) -> bool:
                events.append("handler-quarantine")
                return True

            def close(self) -> EphemeralHandlerCleanup:
                events.append("handler-close")
                return EphemeralHandlerCleanup(
                    closed=True,
                    secrets_zeroized=True,
                )

        class RecordingContext(EphemeralGateLaunchContext):
            def quiesce(self) -> None:
                events.append("context-quiesce")
                super().quiesce()

            def close(self):
                events.append("context-close")
                return super().close()

        class EnvironmentProvisioner:
            environment_id = "synthetic-environment"
            resolved_credential_values: tuple[str, ...] = ()

            def bind_evidence_run(self, run: object) -> None:
                self.evidence_run = run
                events.append("evidence-run-bound")

            def prepare_credentials(
                self,
            ) -> tuple[tuple[str, ...], dict[str, str]]:
                events.append("credentials-ready")
                return (), {}

            def create_gate_launch_context(self, **_kwargs):
                events.append("context-create")
                context = RecordingContext(
                    required_capabilities=("synthetic.echo",),
                )
                context.register_capability(
                    "synthetic.echo",
                    SyntheticHandler(),
                )
                return context

            def cleanup(self) -> tuple[str, ...]:
                events.append("environment-cleanup")
                return ("environment",)

        class CellLifecycle:
            def stop(self) -> dict[str, str]:
                events.append("cell-stop")
                return {"state": "CLEANED"}

        environment_provisioner = EnvironmentProvisioner()

        def provision_environment(*_args, **_kwargs):
            events.append("environment-ready")
            return (
                environment_provisioner,
                {
                    "state": "FIXTURE_READY",
                    "runId": "provisioning-run",
                },
                None,
            )

        def provision_runtime_cell(**_kwargs):
            events.append("cell-ready")
            return (
                CellLifecycle(),
                {
                    "artifactKind": "acceptance-runtime-cell-manifest",
                    "cellId": "desktop-linux-native",
                    "gateId": "synthetic-context-gate",
                    "state": "LEASED",
                },
                None,
            )

        def run_gate(spec, binding):
            events.append("gate")
            binding.close_parent_copy()
            return subprocess.CompletedProcess(
                args=spec.argv,
                returncode=0,
                stdout="",
                stderr="",
            )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gates_path = root / "gates.json"
            gates_path.write_text(
                json.dumps(
                    {
                        "gates": {
                            "synthetic-context-gate": {
                                "argv": ["python3", "-c", "pass"],
                                "ephemeralCapabilities": ["synthetic.echo"],
                                "environment": "synthetic-environment",
                                "provisioner": "synthetic-environment",
                                "requiredRuntimeCells": [
                                    "desktop-linux-native"
                                ],
                                "tier": "env-evidence",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            plan_path = root / "plan.json"
            plan_path.write_text(
                json.dumps({"selected_gates": []}),
                encoding="utf-8",
            )
            with mock.patch.dict(
                os.environ,
                {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "artifacts")},
                clear=False,
            ), mock.patch.object(
                sys,
                "argv",
                [
                    "acceptance-run.py",
                    "--plan",
                    str(plan_path),
                    "--gates",
                    str(gates_path),
                    "--gate",
                    "synthetic-context-gate",
                    "--runtime-cell",
                    "desktop-linux-native",
                ],
            ), mock.patch(
                "tooling.acceptance.core.source_identity",
                return_value={"commit": "abc123", "workspaceDigest": "clean"},
            ), mock.patch.object(
                module,
                "environment_provisioner",
                return_value=environment_provisioner,
            ), mock.patch.object(
                module,
                "provision_environment",
                side_effect=provision_environment,
            ), mock.patch.object(
                module,
                "provision_runtime_cell",
                side_effect=provision_runtime_cell,
            ), mock.patch(
                "tooling.acceptance.core.GateProcessLauncher",
            ) as launcher:
                launcher.return_value.run.side_effect = run_gate
                module.main()

        child_environment = launcher.call_args.kwargs["environment"]
        self.assertNotIn(
            "PT_ACCEPTANCE_REDACTION_VALUES",
            child_environment,
        )
        self.assertNotIn("SYNTHETIC_SECRET", child_environment)
        self.assertNotIn("resolved-secret", json.dumps(child_environment))
        self.assertEqual(
            json.loads(child_environment["PT_ACCEPTANCE_CURRENT_RESULTS"]),
            {
                "source": {
                    "commit": "abc123",
                    "workspaceDigest": "clean",
                },
                "results": [],
            },
        )
        self.assertEqual(
            events,
            [
                "evidence-run-bound",
                "credentials-ready",
                "environment-ready",
                "cell-ready",
                "context-create",
                "gate",
                "context-quiesce",
                "cell-stop",
                "environment-cleanup",
                "context-close",
                "handler-close",
            ],
        )

    def test_main_preserves_parent_blocked_context_result(self) -> None:
        module = load_module()
        provisioner = mock.Mock()
        provisioner.environment_id = "synthetic-environment"
        provisioner.resolved_credential_values = ()
        provisioner.prepare_credentials.return_value = ((), {})
        provisioner.cleanup.return_value = ("environment",)
        launch_context = mock.Mock()
        launch_context.channel_error = None
        launch_context.blocked_error = EphemeralCapabilityBlocked(
            "synthetic capability is busy",
            resource="synthetic-resource",
        )
        launch_binding = mock.Mock()
        launch_context.bind_child.return_value = launch_binding

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gates_path = root / "gates.json"
            gates_path.write_text(
                json.dumps(
                    {
                        "gates": {
                            "synthetic-context-gate": {
                                "argv": ["python3", "-c", "pass"],
                                "ephemeralCapabilities": ["synthetic.echo"],
                                "environment": "synthetic-environment",
                                "provisioner": "synthetic-environment",
                                "tier": "env-evidence",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            plan_path = root / "plan.json"
            plan_path.write_text(
                json.dumps({"selected_gates": []}),
                encoding="utf-8",
            )
            with mock.patch.dict(
                os.environ,
                {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "artifacts")},
                clear=False,
            ), mock.patch.object(
                sys,
                "argv",
                [
                    "acceptance-run.py",
                    "--plan",
                    str(plan_path),
                    "--gates",
                    str(gates_path),
                    "--gate",
                    "synthetic-context-gate",
                ],
            ), mock.patch(
                "tooling.acceptance.core.source_identity",
                return_value={"commit": "abc123", "workspaceDigest": "clean"},
            ), mock.patch.object(
                module,
                "environment_provisioner",
                return_value=provisioner,
            ), mock.patch.object(
                module,
                "provision_environment",
                return_value=(
                    provisioner,
                    {
                        "state": "FIXTURE_READY",
                        "runId": "provisioning-run",
                    },
                    None,
                ),
            ), mock.patch.object(
                module,
                "prepare_gate_launch_context",
                return_value=(launch_context, "provisioning-run"),
            ), mock.patch(
                "tooling.acceptance.core.GateProcessLauncher.run",
                return_value=subprocess.CompletedProcess(
                    args=("python3", "-c", "pass"),
                    returncode=1,
                    stdout="",
                    stderr="",
                ),
            ):
                exit_code = module.main()

        self.assertEqual(exit_code, 2)
        launch_context.quiesce.assert_called_once_with()
        launch_context.close.assert_called_once_with()

    def test_launch_cleanup_failure_is_failed_not_blocked(self) -> None:
        module = load_module()
        cleanup = EphemeralCleanupResult(
            descriptors_closed=True,
            broker_stopped=False,
            handlers_closed=False,
            secrets_zeroized=False,
            quarantined_capabilities=("synthetic.echo",),
            errors=("broker did not stop",),
        )
        result = module.ephemeral_launch_failure_result(
            gate_id="synthetic-context-gate",
            command='["synthetic-gate"]',
            environment="synthetic-environment",
            tier="env-evidence",
            error=EphemeralLaunchCleanupFailed(
                "context cleanup failed",
                operation="quiesce",
                result=cleanup,
            ),
            duration_seconds=0.1,
        )

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["completionStatus"], "PARTIAL")
        self.assertEqual(result["proofStatus"], "UNPROVEN")
        self.assertEqual(
            result["launchContextCleanup"]["quarantinedCapabilities"],
            ["synthetic.echo"],
        )

    def test_prepare_failure_keeps_context_until_owner_cleanup_finishes(
        self,
    ) -> None:
        module = load_module()
        events: list[str] = []
        provisioner = mock.Mock()
        provisioner.environment_id = "synthetic-environment"
        provisioner.resolved_credential_values = ()
        provisioner.prepare_credentials.return_value = ((), {})

        def cleanup_environment() -> tuple[str, ...]:
            events.append("environment-cleanup")
            return ("environment",)

        provisioner.cleanup.side_effect = cleanup_environment
        launch_context = mock.Mock()
        launch_context.channel_error = None
        launch_context.blocked_error = None

        def fail_context_seal(**_kwargs) -> None:
            events.append("context-seal")
            raise EphemeralLaunchContextInvalid(
                "synthetic bind failure",
                operation="seal",
            )

        launch_context.seal.side_effect = fail_context_seal
        launch_context.quiesce.side_effect = lambda: events.append(
            "context-quiesce"
        )
        launch_context.close.side_effect = lambda: events.append(
            "context-close"
        )
        cell_lifecycle = mock.Mock()
        cell_lifecycle.stop.side_effect = lambda: (
            events.append("cell-stop") or {"state": "CLEANED"}
        )

        def provision_runtime_cell(**_kwargs):
            events.append("cell-ready")
            return (
                cell_lifecycle,
                {
                    "artifactKind": "acceptance-runtime-cell-manifest",
                    "cellId": "desktop-linux-native",
                    "gateId": "synthetic-context-gate",
                    "state": "LEASED",
                },
                None,
            )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gates_path = root / "gates.json"
            gates_path.write_text(
                json.dumps(
                    {
                        "gates": {
                            "synthetic-context-gate": {
                                "argv": ["python3", "-c", "pass"],
                                "ephemeralCapabilities": ["synthetic.echo"],
                                "environment": "synthetic-environment",
                                "provisioner": "synthetic-environment",
                                "requiredRuntimeCells": [
                                    "desktop-linux-native"
                                ],
                                "tier": "env-evidence",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            plan_path = root / "plan.json"
            plan_path.write_text(
                json.dumps({"selected_gates": []}),
                encoding="utf-8",
            )
            with mock.patch.dict(
                os.environ,
                {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "artifacts")},
                clear=False,
            ), mock.patch.object(
                sys,
                "argv",
                [
                    "acceptance-run.py",
                    "--plan",
                    str(plan_path),
                    "--gates",
                    str(gates_path),
                    "--gate",
                    "synthetic-context-gate",
                    "--runtime-cell",
                    "desktop-linux-native",
                ],
            ), mock.patch(
                "tooling.acceptance.core.source_identity",
                return_value={"commit": "abc123", "workspaceDigest": "clean"},
            ), mock.patch.object(
                module,
                "environment_provisioner",
                return_value=provisioner,
            ), mock.patch.object(
                module,
                "provision_environment",
                return_value=(
                    provisioner,
                    {
                        "state": "FIXTURE_READY",
                        "runId": "provisioning-run",
                    },
                    None,
                ),
            ), mock.patch.object(
                module,
                "provision_runtime_cell",
                side_effect=provision_runtime_cell,
            ), mock.patch.object(
                module,
                "prepare_gate_launch_context",
                return_value=(launch_context, "provisioning-run"),
            ), mock.patch(
                "tooling.acceptance.core.GateProcessLauncher.run",
            ) as launch:
                exit_code = module.main()

        self.assertEqual(exit_code, 2)
        launch.assert_not_called()
        self.assertEqual(
            events,
            [
                "cell-ready",
                "context-seal",
                "context-quiesce",
                "cell-stop",
                "environment-cleanup",
                "context-close",
            ],
        )

    def test_gate_process_cleanup_failure_remains_failed(self) -> None:
        module = load_module()
        captured_cleanup: dict[str, object] = {}

        def persist_cleanup(**kwargs):
            captured_cleanup.update(kwargs)
            return {}

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gates_path = root / "gates.json"
            gates_path.write_text(
                json.dumps(
                    {
                        "gates": {
                            "synthetic-argv-gate": {
                                "argv": ["python3", "-c", "pass"],
                                "environment": "local",
                                "tier": "ci-cheap",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            plan_path = root / "plan.json"
            plan_path.write_text(
                json.dumps({"selected_gates": []}),
                encoding="utf-8",
            )
            with mock.patch.dict(
                os.environ,
                {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "artifacts")},
                clear=False,
            ), mock.patch.object(
                sys,
                "argv",
                [
                    "acceptance-run.py",
                    "--plan",
                    str(plan_path),
                    "--gates",
                    str(gates_path),
                    "--gate",
                    "synthetic-argv-gate",
                ],
            ), mock.patch(
                "tooling.acceptance.core.source_identity",
                return_value={"commit": "abc123", "workspaceDigest": "clean"},
            ), mock.patch(
                "tooling.acceptance.core.GateProcessLauncher.run",
                side_effect=EphemeralLaunchCleanupFailed(
                    "Gate process did not stop after termination",
                    operation="gate_process",
                ),
            ), mock.patch.object(
                module,
                "persist_provisioner_cleanup_result",
                side_effect=persist_cleanup,
            ):
                exit_code = module.main()

        self.assertEqual(exit_code, 1)
        self.assertEqual(captured_cleanup["cleanup_status"], "failed")
        self.assertEqual(
            captured_cleanup["gate_process_cleanup_status"],
            "failed",
        )
        self.assertIn(
            "did not stop",
            str(captured_cleanup["gate_process_cleanup_error"]),
        )

    def test_failed_quarantine_defers_resource_release(self) -> None:
        cleanup = EphemeralCleanupResult(
            descriptors_closed=True,
            broker_stopped=False,
            handlers_closed=False,
            secrets_zeroized=False,
            quarantined_capabilities=(),
            errors=("active capability handler quarantine failed",),
        )
        (
            exit_code,
            launch_context,
            provisioner,
            cell_lifecycle,
            captured_cleanup,
        ) = self._run_quiesce_failure(cleanup)

        self.assertEqual(exit_code, 1)
        cell_lifecycle.stop.assert_not_called()
        provisioner.cleanup.assert_not_called()
        launch_context.close.assert_not_called()
        self.assertEqual(
            captured_cleanup["runtime_cell_cleanup_status"],
            "deferred-unfenced-authority",
        )
        self.assertEqual(
            captured_cleanup["environment_cleanup_status"],
            "deferred-unfenced-authority",
        )

    def test_fenced_quiesce_failure_closes_remaining_handlers(self) -> None:
        quiesce_cleanup = EphemeralCleanupResult(
            descriptors_closed=True,
            broker_stopped=False,
            handlers_closed=False,
            secrets_zeroized=False,
            quarantined_capabilities=("synthetic.echo",),
            errors=("broker exceeded quiesce deadline",),
        )
        close_cleanup = EphemeralCleanupResult(
            descriptors_closed=True,
            broker_stopped=True,
            handlers_closed=True,
            secrets_zeroized=True,
            quarantined_capabilities=("synthetic.echo",),
            errors=("broker exceeded quiesce deadline",),
        )
        close_error = EphemeralLaunchCleanupFailed(
            "launch context cleanup retained quiesce failure",
            operation="close",
            result=close_cleanup,
        )
        (
            exit_code,
            launch_context,
            provisioner,
            cell_lifecycle,
            captured_cleanup,
        ) = self._run_quiesce_failure(
            quiesce_cleanup,
            close_error=close_error,
        )

        self.assertEqual(exit_code, 1)
        cell_lifecycle.stop.assert_called_once_with()
        provisioner.cleanup.assert_called_once_with()
        launch_context.close.assert_called_once_with()
        self.assertEqual(
            captured_cleanup["runtime_cell_cleanup_status"],
            "passed",
        )
        self.assertEqual(
            captured_cleanup["environment_cleanup_status"],
            "passed",
        )
        self.assertEqual(
            captured_cleanup["launch_context_close_status"],
            "failed",
        )
        self.assertTrue(
            captured_cleanup["launch_context_cleanup"]["handlersClosed"]
        )
        self.assertTrue(
            captured_cleanup["launch_context_cleanup"]["secretsZeroized"]
        )

    def _run_quiesce_failure(
        self,
        cleanup: EphemeralCleanupResult,
        *,
        close_error: EphemeralLaunchCleanupFailed | None = None,
    ) -> tuple[int, mock.Mock, mock.Mock, mock.Mock, dict[str, object]]:
        module = load_module()
        launch_context = mock.Mock()
        launch_context.quiesce.side_effect = EphemeralLaunchCleanupFailed(
            "launch context failed to quiesce",
            operation="quiesce",
            result=cleanup,
        )
        launch_context.channel_error = None
        launch_context.blocked_error = None
        if close_error is not None:
            launch_context.close.side_effect = close_error
        launch_context.bind_child.return_value = mock.Mock()
        provisioner = mock.Mock()
        provisioner.environment_id = "synthetic-environment"
        provisioner.resolved_credential_values = ()
        provisioner.prepare_credentials.return_value = ((), {})
        provisioner.cleanup.return_value = ("environment",)
        cell_lifecycle = mock.Mock()
        cell_lifecycle.stop.return_value = {"state": "CLEANED"}
        captured_cleanup: dict[str, object] = {}

        def persist_cleanup(**kwargs):
            captured_cleanup.update(kwargs)
            return {}

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gates_path = root / "gates.json"
            gates_path.write_text(
                json.dumps(
                    {
                        "gates": {
                            "synthetic-context-gate": {
                                "argv": ["python3", "-c", "pass"],
                                "ephemeralCapabilities": ["synthetic.echo"],
                                "environment": "synthetic-environment",
                                "provisioner": "synthetic-environment",
                                "requiredRuntimeCells": [
                                    "desktop-linux-native"
                                ],
                                "tier": "env-evidence",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            plan_path = root / "plan.json"
            plan_path.write_text(
                json.dumps({"selected_gates": []}),
                encoding="utf-8",
            )
            with mock.patch.dict(
                os.environ,
                {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "artifacts")},
                clear=False,
            ), mock.patch.object(
                sys,
                "argv",
                [
                    "acceptance-run.py",
                    "--plan",
                    str(plan_path),
                    "--gates",
                    str(gates_path),
                    "--gate",
                    "synthetic-context-gate",
                    "--runtime-cell",
                    "desktop-linux-native",
                ],
            ), mock.patch(
                "tooling.acceptance.core.source_identity",
                return_value={"commit": "abc123", "workspaceDigest": "clean"},
            ), mock.patch.object(
                module,
                "environment_provisioner",
                return_value=provisioner,
            ), mock.patch.object(
                module,
                "provision_environment",
                return_value=(
                    provisioner,
                    {
                        "state": "FIXTURE_READY",
                        "runId": "provisioning-run",
                    },
                    None,
                ),
            ), mock.patch.object(
                module,
                "provision_runtime_cell",
                return_value=(
                    cell_lifecycle,
                    {
                        "artifactKind": "acceptance-runtime-cell-manifest",
                        "cellId": "desktop-linux-native",
                        "gateId": "synthetic-context-gate",
                        "state": "LEASED",
                    },
                    None,
                ),
            ), mock.patch.object(
                module,
                "prepare_gate_launch_context",
                return_value=(launch_context, "provisioning-run"),
            ), mock.patch(
                "tooling.acceptance.core.GateProcessLauncher.run",
                return_value=subprocess.CompletedProcess(
                    args=("python3", "-c", "pass"),
                    returncode=0,
                    stdout="",
                    stderr="",
                ),
            ), mock.patch.object(
                module,
                "persist_provisioner_cleanup_result",
                side_effect=persist_cleanup,
            ):
                exit_code = module.main()

        return (
            exit_code,
            launch_context,
            provisioner,
            cell_lifecycle,
            captured_cleanup,
        )

    def test_runtime_secret_scan_uses_provisioner_resolved_instance(self) -> None:
        module = load_module()
        provisioner = HomeStationProvisioner(
            EnvironmentContract(
                id="home-station",
                credentials=(
                    CredentialRef(
                        id="canary",
                        source_ref="auto:canary",
                    ),
                ),
            )
        )
        _, resolved = provisioner._resolve_credentials()

        with mock.patch.object(
            CredentialRef,
            "resolve",
            side_effect=AssertionError("runner must not resolve credentials again"),
        ):
            values = module.credential_values(provisioner)

        self.assertIs(values[0], resolved["canary"])

    def test_finalize_gate_result_publishes_standardized_proof_status(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("synthetic-gate", source={"commit": "abc123"})
            log = run.write_bytes(
                "logs/synthetic-gate.log",
                b"passed\n",
                media_type="text/plain",
                role="log",
            )

            result = module.finalize_gate_result(
                {
                    "id": "synthetic-gate",
                    "status": "passed",
                    "log": log.to_dict(),
                },
                run,
                "/tmp/acceptance-plan.json",
            )
            latest = store.latest("synthetic-gate")
            run.close()

        self.assertEqual(result["completionStatus"], "DONE")
        self.assertEqual(result["proofStatus"], "PROVEN")
        self.assertEqual(latest["result"]["completionStatus"], "DONE")
        self.assertEqual(latest["result"]["proofStatus"], "PROVEN")

    def test_finalize_gate_result_publishes_blocked_runtime_cell_result(
        self,
    ) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("synthetic-gate", source={"commit": "abc123"})

            result = module.finalize_gate_result(
                {
                    "id": "synthetic-gate",
                    "status": "blocked",
                    "completionStatus": "BLOCKED",
                    "proofStatus": "UNPROVEN",
                    "blockedReason": "runtime unavailable",
                },
                run,
                "/tmp/acceptance-plan.json",
                runtime_cell="desktop-linux-native",
            )
            latest = store.latest(
                "synthetic-gate",
                runtime_cell="desktop-linux-native",
            )
            run.close()

        self.assertEqual(result["runtimeCell"], "desktop-linux-native")
        self.assertEqual(latest["result"]["completionStatus"], "BLOCKED")
        self.assertEqual(latest["result"]["proofStatus"], "UNPROVEN")
        self.assertEqual(
            latest["result"]["runtimeCell"],
            "desktop-linux-native",
        )

    def test_provisioner_cleanup_is_immutable_and_traceable(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("synthetic-gate", source={})

            cleanup_ref = module.persist_provisioner_cleanup_result(
                gate_run=run,
                gate_id="synthetic-gate",
                environment="synthetic-environment",
                provisioner_id="synthetic-environment",
                cleanup_status="passed",
                completed_resources=("runtime", "source-lease"),
                cleanup_error="",
                secret_values=(),
            )
            result = module.standardize_result(
                {
                    "id": "synthetic-gate",
                    "status": "passed",
                    "cleanupStatus": "passed",
                    "cleanupArtifact": cleanup_ref,
                    "sourceArtifact": {"path": "reports/gate.json"},
                    "sourceArtifactKind": "acceptance-gate-evidence-report",
                    "sourcePhase": "Runtime Provisioning",
                    "sourceBom": ["WS2"],
                    "sourceSpec": ["D-07"],
                    "sourceGate": "cleanup must be durable",
                },
                "/tmp/acceptance-plan.json",
            )
            cleanup = store.read_json(ArtifactRef.from_dict(cleanup_ref))
            with self.assertRaises(EvidenceConflict):
                module.persist_provisioner_cleanup_result(
                    gate_run=run,
                    gate_id="synthetic-gate",
                    environment="synthetic-environment",
                    provisioner_id="synthetic-environment",
                    cleanup_status="failed",
                    completed_resources=(),
                    cleanup_error="runtime remained allocated",
                    secret_values=(),
                )
            run.close()

        self.assertEqual(
            cleanup["artifactKind"],
            "acceptance-provisioner-cleanup-result",
        )
        self.assertEqual(cleanup["status"], "passed")
        self.assertEqual(
            cleanup["completedResources"],
            ["runtime", "source-lease"],
        )
        self.assertEqual(result["traceability"]["status"], "complete")
        self.assertEqual(
            result["traceability"]["cleanupArtifact"],
            cleanup_ref,
        )

    def test_cleanup_failure_requires_cleanup_artifact_traceability(
        self,
    ) -> None:
        module = load_module()
        result = module.standardize_result(
            {
                "id": "synthetic-gate",
                "status": "failed",
                "cleanupStatus": "failed",
                "cleanupError": "runtime remained allocated",
                "sourceArtifact": {"path": "reports/gate.json"},
                "sourceArtifactKind": "acceptance-gate-evidence-report",
                "sourcePhase": "Runtime Provisioning",
                "sourceBom": ["WS2"],
                "sourceSpec": ["D-07"],
                "sourceGate": "cleanup must be durable",
            },
            "/tmp/acceptance-plan.json",
        )

        self.assertEqual(result["completionStatus"], "PARTIAL")
        self.assertEqual(result["proofStatus"], "UNPROVEN")
        self.assertEqual(result["traceability"]["status"], "missing")
        self.assertIn(
            "cleanupArtifact",
            result["traceability"]["missingFields"],
        )

    def test_failed_cleanup_artifact_does_not_weaken_failure_semantics(
        self,
    ) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("synthetic-gate", source={})
            cleanup_ref = module.persist_provisioner_cleanup_result(
                gate_run=run,
                gate_id="synthetic-gate",
                environment="synthetic-environment",
                provisioner_id="synthetic-environment",
                cleanup_status="failed",
                completed_resources=("runtime",),
                cleanup_error="source lease remained allocated",
                secret_values=(),
            )
            cleanup = store.read_json(ArtifactRef.from_dict(cleanup_ref))
            run.close()

        result = module.standardize_result(
            {
                "id": "synthetic-gate",
                "status": "failed",
                "cleanupStatus": "failed",
                "cleanupError": cleanup["error"],
                "cleanupArtifact": cleanup_ref,
                "sourceArtifact": {"path": "reports/gate.json"},
                "sourceArtifactKind": "acceptance-gate-evidence-report",
                "sourcePhase": "Runtime Provisioning",
                "sourceBom": ["WS2"],
                "sourceSpec": ["D-07"],
                "sourceGate": "cleanup must be durable",
            },
            "/tmp/acceptance-plan.json",
        )

        self.assertEqual(cleanup["status"], "failed")
        self.assertEqual(cleanup["completionStatus"], "PARTIAL")
        self.assertEqual(cleanup["proofStatus"], "UNPROVEN")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["completionStatus"], "PARTIAL")
        self.assertEqual(result["proofStatus"], "UNPROVEN")
        self.assertEqual(result["traceability"]["status"], "complete")
        self.assertEqual(
            result["traceability"]["cleanupArtifact"],
            cleanup_ref,
        )

    def test_finalize_gate_result_redacts_and_rejects_secret_metadata(
        self,
    ) -> None:
        module = load_module()
        secret = "resolved-secret-value"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("synthetic-gate", source={"commit": "abc123"})
            run.write_bytes(
                "logs/synthetic-gate.log",
                b"passed\n",
                media_type="text/plain",
                role="log",
            )

            result = module.finalize_gate_result(
                {
                    "id": "synthetic-gate",
                    "status": "passed",
                    "reason": f"cleanup failed for {secret}",
                },
                run,
                "/tmp/acceptance-plan.json",
                runtime={"detail": f"provisioned with {secret}"},
                secret_values=(secret,),
            )
            latest = store.latest("synthetic-gate")
            manifest_text = store.resolve(run.manifest_ref).read_text(
                encoding="utf-8"
            )
            run.close()

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["completionStatus"], "PARTIAL")
        self.assertEqual(result["proofStatus"], "UNPROVEN")
        self.assertEqual(result["secretScan"]["status"], "failed")
        self.assertNotIn(secret, manifest_text)
        self.assertNotIn(secret, json.dumps(latest))

    def test_finalize_gate_result_preserves_failed_secret_scan(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("synthetic-gate", source={})
            result = module.finalize_gate_result(
                {
                    "id": "synthetic-gate",
                    "status": "passed",
                    "secretScan": {
                        "status": "failed",
                        "scannedHighEntropyValues": 2,
                        "scannedCredentialValues": 3,
                        "redactedArtifacts": ["evidence/leaked.bin"],
                    },
                },
                run,
                "/tmp/acceptance-plan.json",
            )
            run.close()

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["proofStatus"], "UNPROVEN")
        self.assertEqual(result["secretScan"]["status"], "failed")
        self.assertEqual(result["secretScan"]["scannedHighEntropyValues"], 2)
        self.assertEqual(result["secretScan"]["scannedCredentialValues"], 3)
        self.assertEqual(
            result["secretScan"]["redactedArtifacts"],
            ["evidence/leaked.bin"],
        )

    def test_finalize_gate_result_rejects_malformed_secret_scan(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("synthetic-gate", source={})

            with self.assertRaises(EvidenceManifestInvalid):
                module.finalize_gate_result(
                    {
                        "id": "synthetic-gate",
                        "status": "passed",
                        "secretScan": {
                            "status": "passed",
                            "scannedHighEntropyValues": "invalid",
                            "scannedCredentialValues": 0,
                            "redactedArtifacts": [],
                        },
                    },
                    run,
                    "/tmp/acceptance-plan.json",
                )
            run.close()

    def test_runtime_artifact_audit_rejects_binary_secret_without_rewrite(self) -> None:
        module = load_module()
        secret = "resolved-binary-secret"
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            artifact = run_dir / "evidence.bin"
            artifact.write_bytes(b"\x00prefix-" + secret.encode() + b"-suffix")

            leaked = module.audit_runtime_artifacts(
                run_dir,
                (secret,),
            )
            preserved_bytes = artifact.read_bytes()

        self.assertEqual(leaked, ["evidence.bin"])
        self.assertEqual(
            preserved_bytes,
            b"\x00prefix-" + secret.encode() + b"-suffix",
        )

    def test_runtime_artifact_audit_rejects_secret_path_without_removal(self) -> None:
        module = load_module()
        secret = "resolved-path-secret"
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            secret_parent = run_dir / f"evidence-{secret}"
            secret_parent.mkdir()
            artifact = secret_parent / "result.txt"
            artifact.write_text("safe content", encoding="utf-8")

            leaked = module.audit_runtime_artifacts(
                run_dir,
                (secret,),
            )

            self.assertTrue(artifact.exists())
            self.assertTrue(secret_parent.exists())

        expected_path = f"evidence-{secret}/result.txt"
        self.assertEqual(leaked, [expected_path])

    def test_runtime_artifact_audit_checks_hidden_artifacts_without_rewrite(self) -> None:
        module = load_module()
        secret = "resolved-hidden-secret"
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            artifact = run_dir / ".env"
            artifact.write_text(
                f"ACCEPTANCE_TOKEN={secret}\n",
                encoding="utf-8",
            )

            leaked = module.audit_runtime_artifacts(
                run_dir,
                (secret,),
            )

            content = artifact.read_text(encoding="utf-8")

        self.assertEqual(leaked, [".env"])
        self.assertIn(secret, content)

    def test_runtime_artifact_audit_checks_role_metadata(self) -> None:
        module = load_module()
        secret = "resolved-role-secret"
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            role_dir = run_dir / ".artifact-roles"
            role_dir.mkdir()
            artifact = role_dir / "report.json"
            artifact.write_text(
                json.dumps({"extra": secret}),
                encoding="utf-8",
            )

            leaked = module.audit_runtime_artifacts(
                run_dir,
                (secret,),
            )

        self.assertEqual(leaked, [".artifact-roles/report.json"])

    def test_runtime_artifact_audit_uses_canonical_json_redaction(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            artifact = run_dir / "report.json"
            artifact.write_text(
                '{"outer":{"password":"1"}}',
                encoding="utf-8",
            )

            leaked = module.audit_runtime_artifacts(run_dir, ())

        self.assertEqual(leaked, ["report.json"])

    def test_runtime_artifact_scan_rejects_symlink_without_following_it(
        self,
    ) -> None:
        module = load_module()
        secret = "resolved-symlink-secret"
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            run_dir = base / "run"
            run_dir.mkdir()
            external = base / "external.bin"
            original = b"\x00" + secret.encode()
            external.write_bytes(original)
            link = run_dir / "linked.bin"
            link.symlink_to(external)

            leaked = module.audit_runtime_artifacts(
                run_dir,
                (secret,),
            )

            self.assertEqual(external.read_bytes(), original)

        self.assertEqual(leaked, ["linked.bin"])

    def test_environment_gate_without_typed_runtime_evidence_is_unproven(
        self,
    ) -> None:
        module = load_module()

        result = module.standardize_result(
            {
                "id": "environment-gate",
                "status": "passed",
                "tier": "env-evidence",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            },
            "/tmp/acceptance-plan.json",
        )

        self.assertEqual(result["completionStatus"], "PARTIAL")
        self.assertEqual(result["proofStatus"], "UNPROVEN")

    def test_environment_gate_with_typed_runtime_evidence_is_proven(
        self,
    ) -> None:
        module = load_module()

        result = module.standardize_result(
            {
                "id": "environment-gate",
                "status": "passed",
                "tier": "env-evidence",
                "evidenceStatus": "PASS",
                "sourceArtifact": {"path": "reports/environment-gate.json"},
                "sourceArtifactKind": "acceptance-gate-evidence-report",
                "evidenceGateId": "environment-gate",
                "sourcePhase": "environment-proof",
                "sourceBom": ["ENV-01"],
                "sourceSpec": ["environment-runtime"],
                "sourceGate": "environment-gate",
                "manifest": {
                    "state": "FIXTURE_READY",
                    "runId": "runtime-run",
                },
            },
            "/tmp/acceptance-plan.json",
        )

        self.assertEqual(result["completionStatus"], "DONE")
        self.assertEqual(result["proofStatus"], "PROVEN")

    def test_environment_gate_rejects_noncanonical_evidence_kind(self) -> None:
        module = load_module()

        result = module.standardize_result(
            {
                "id": "environment-gate",
                "status": "passed",
                "tier": "env-evidence",
                "evidenceStatus": "PASS",
                "sourceArtifact": {"path": "reports/environment-gate.json"},
                "sourceArtifactKind": "forged-kind",
                "evidenceGateId": "environment-gate",
                "manifest": {
                    "state": "FIXTURE_READY",
                    "runId": "runtime-run",
                },
            },
            "/tmp/acceptance-plan.json",
        )

        self.assertEqual(result["completionStatus"], "PARTIAL")
        self.assertEqual(result["proofStatus"], "UNPROVEN")

    def test_environment_report_without_phase_bom_spec_is_unproven(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("environment-gate", source={})
            report = new_report("environment-gate")
            report.status = "PASS"
            report.write(run.run_dir / "reports" / "environment-gate.json")

            result = module.enrich_result_with_run_artifacts(
                {
                    "id": "environment-gate",
                    "status": "passed",
                    "tier": "env-evidence",
                    "manifest": {
                        "state": "FIXTURE_READY",
                        "runId": "runtime-run",
                    },
                },
                run,
            )
            result = module.standardize_result(
                result,
                "/tmp/acceptance-plan.json",
            )
            run.close()

        self.assertEqual(
            result["sourceArtifactKind"],
            "acceptance-gate-evidence-report",
        )
        self.assertEqual(result["evidenceStatus"], "PASS")
        self.assertEqual(result["evidenceGateId"], "environment-gate")
        self.assertEqual(result["completionStatus"], "PARTIAL")
        self.assertEqual(result["proofStatus"], "UNPROVEN")
        self.assertEqual(result["traceability"]["status"], "missing")
        self.assertEqual(
            result["traceability"]["missingFields"],
            ["sourcePhase", "sourceBom", "sourceSpec"],
        )

    def test_validation_artifact_does_not_replace_environment_report(
        self,
    ) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("environment-gate", source={})
            run.write_json(
                "reports/environment-validation.json",
                {
                    "artifactKind": "environment-validation",
                    "status": "pass",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                    "sampleEmissionAllowed": False,
                    "phase": "environment-proof",
                    "bom": ["ENV-01"],
                    "spec": ["environment-runtime"],
                    "gate": "environment-gate",
                },
                role="validation",
            )
            report = new_report("environment-gate")
            report.status = "PASS"
            report.write(run.run_dir / "reports" / "environment-gate.json")

            result = module.enrich_result_with_run_artifacts(
                {
                    "id": "environment-gate",
                    "status": "passed",
                    "tier": "env-evidence",
                    "manifest": {
                        "state": "FIXTURE_READY",
                        "runId": "runtime-run",
                    },
                },
                run,
            )
            result = module.standardize_result(
                result,
                "/tmp/acceptance-plan.json",
            )
            run.close()

        self.assertEqual(
            result["sourceArtifactKind"],
            "acceptance-gate-evidence-report",
        )
        self.assertEqual(
            result["sourceArtifact"]["path"],
            "reports/environment-gate.json",
        )
        self.assertEqual(result["sourcePhase"], "environment-proof")
        self.assertEqual(result["sourceBom"], ["ENV-01"])
        self.assertEqual(result["sourceSpec"], ["environment-runtime"])
        self.assertEqual(result["sourceGate"], "environment-gate")
        self.assertEqual(result["completionStatus"], "DONE")
        self.assertEqual(result["proofStatus"], "PROVEN")
        self.assertTrue(result["sampleEmissionAllowed"])

    def test_environment_cleanup_report_is_not_primary_gate_evidence(
        self,
    ) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("environment-gate", source={})
            run.write_json(
                "reports/provisioner-cleanup.json",
                {
                    "artifactKind": "acceptance-provisioner-cleanup-result",
                    "gateId": "environment-gate",
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                },
                role="provisioner-cleanup",
            )
            result = module.enrich_result_with_run_artifacts(
                {
                    "id": "environment-gate",
                    "status": "failed",
                    "tier": "env-evidence",
                },
                run,
            )
            run.close()

        self.assertNotIn("sourceArtifact", result)
        self.assertNotIn("evidenceStatus", result)
        self.assertNotIn("evidenceGateId", result)
        self.assertEqual(
            result["reason"],
            "Gate exited without a canonical acceptance evidence report",
        )
        self.assertEqual(
            result["evidenceArtifacts"][0]["artifactKind"],
            "acceptance-provisioner-cleanup-result",
        )

    def test_failed_gate_cannot_retain_proven_status(self) -> None:
        module = load_module()

        result = module.standardize_result(
            {
                "id": "failed-gate",
                "status": "failed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            },
            "/tmp/acceptance-plan.json",
        )

        self.assertEqual(result["completionStatus"], "PARTIAL")
        self.assertEqual(result["proofStatus"], "UNPROVEN")

    def test_provisioning_failure_retains_resolved_secret_context(self) -> None:
        module = load_module()

        class FailingProvisioner:
            resolved_credential_values = ("resolved-secret",)

            def provision(self, _gate_id: str) -> None:
                raise RuntimeError("provisioning failed after credential resolution")

        provisioner = FailingProvisioner()
        with self.assertRaisesRegex(RuntimeError, "after credential resolution"):
            module.provision_environment(
                "home-station",
                "environment-gate",
                provisioner,
            )

        self.assertEqual(
            module.credential_values(provisioner),
            ("resolved-secret",),
        )

    def test_selected_gates_from_plan_expands_gate_ids_from_definitions(self) -> None:
        module = load_module()

        gates = module.selected_gates_from_plan(
            {
                "selected_gates": [
                    "desktop-performance-preflight-gate",
                    {
                        "id": "desktop-performance-report-gate",
                        "timeout_seconds": 42,
                    },
                ]
            },
            {
                "desktop-performance-preflight-gate": {
                    "command": "python3 tooling/scripts/desktop-performance-preflight.py",
                    "timeout_seconds": 600,
                    "tier": "env-evidence",
                },
                "desktop-performance-report-gate": {
                    "command": "python3 tooling/scripts/desktop-performance-report.py",
                    "timeout_seconds": 600,
                    "tier": "local-evidence",
                },
            },
        )

        self.assertEqual([gate["id"] for gate in gates], ["desktop-performance-preflight-gate", "desktop-performance-report-gate"])
        self.assertEqual(gates[0]["command"], "python3 tooling/scripts/desktop-performance-preflight.py")
        self.assertEqual(gates[1]["command"], "python3 tooling/scripts/desktop-performance-report.py")
        self.assertEqual(gates[1]["timeout_seconds"], 42)

    def test_explicit_gate_uses_current_catalog_not_stale_plan_entry(self) -> None:
        module = load_module()

        gates = module.resolve_requested_gates(
            {
                "selected_gates": [
                    {
                        "id": "chat-native-visible-static",
                        "command": "python3 -m unittest stale_suite",
                    }
                ]
            },
            {
                "chat-native-visible-static": {
                    "command": (
                        "python3 -m unittest "
                        "tooling.acceptance.gates.chat."
                        "native_runtime_cell_runner_test"
                    ),
                    "tier": "ci-cheap",
                }
            },
            ["chat-native-visible-static"],
        )

        self.assertEqual(
            gates[0]["command"],
            "python3 -m unittest "
            "tooling.acceptance.gates.chat.native_runtime_cell_runner_test",
        )

    def test_plan_gate_preserves_required_runtime_cells_from_catalog(self) -> None:
        module = load_module()

        gate = module.plan_gate_from_entry(
            {
                "id": "native-gate",
                "command": "python3 default.py",
                "timeout_seconds": 42,
            },
            {
                "native-gate": {
                    "command": "python3 default.py",
                    "requiredRuntimeCells": [
                        "desktop-macos-native",
                        "desktop-linux-native",
                    ],
                },
            },
        )

        self.assertEqual(gate["command"], "python3 default.py")
        self.assertEqual(gate["timeout_seconds"], 42)
        self.assertEqual(
            gate["requiredRuntimeCells"],
            ["desktop-macos-native", "desktop-linux-native"],
        )

    def test_plan_gate_rejects_stale_launch_form(self) -> None:
        module = load_module()

        with self.assertRaisesRegex(
            SystemExit,
            "stale or conflicting command",
        ):
            module.plan_gate_from_entry(
                {
                    "id": "native-gate",
                    "command": "python3 stale.py",
                },
                {
                    "native-gate": {
                        "command": "python3 current.py",
                    },
                },
            )

    def test_runtime_cell_selection_is_explicit_and_declared(self) -> None:
        module = load_module()
        gate = {
            "id": "native-gate",
            "requiredRuntimeCells": [
                "desktop-macos-native",
                "desktop-linux-native",
            ],
        }

        self.assertEqual(
            module.select_runtime_cell(gate, "desktop-linux-native"),
            "desktop-linux-native",
        )
        with self.assertRaisesRegex(SystemExit, "requires explicit"):
            module.select_runtime_cell(gate, "")
        with self.assertRaisesRegex(SystemExit, "does not declare"):
            module.select_runtime_cell(gate, "desktop-windows-native")
        self.assertEqual(
            module.select_runtime_cell(
                {"id": "local-gate"},
                "desktop-macos-native",
            ),
            "",
        )

    def test_enrich_result_with_evidence_from_log_artifact(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("desktop-performance-report-gate", source={})
            list_artifact_path = run.run_dir / "evidence/restart-snapshots.json"
            list_artifact_path.parent.mkdir(parents=True)
            list_artifact_path.write_text(
                json.dumps([{"phase": "after-restart"}]),
                encoding="utf-8",
            )
            artifact_path = run.run_dir / "reports/desktop-performance-report-latest.json"
            artifact_path.parent.mkdir(parents=True)
            artifact_path.write_text(
                json.dumps(
                    {
                        "artifactKind": "desktop-performance-report",
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "phase": "P0c",
                        "bom": ["BOM-GATE-02"],
                        "spec": ["SPEC-GATE-02"],
                        "gate": "Final report must fail closed until runtime evidence is proven",
                        "reason": "runtime evidence missing",
                        "details": [
                            {
                                "step": "desktop-gateway",
                                "status": "fail",
                                "reason": "connection refused",
                                "url": "http://127.0.0.1:3030",
                            }
                        ],
                        "issue_breakdown": [
                            {
                                "category": "matrix",
                                "failedStep": "matrix",
                                "summary": "matrix evidence missing",
                                "proofImpact": "P0c remains PARTIAL/UNPROVEN.",
                            }
                        ],
                        "recommended_review_commands": [
                            {
                                "purpose": "Re-run final report.",
                                "command": "python3 tooling/scripts/desktop-performance-report.py",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            result = module.enrich_result_with_run_artifacts(
                {
                    "id": "desktop-performance-report-gate",
                    "command": "python3 tooling/scripts/desktop-performance-report.py",
                    "status": "failed",
                },
                run,
            )
            run.close()

        self.assertEqual(result["sourceArtifactKind"], "desktop-performance-report")
        self.assertEqual(
            result["sourceArtifact"]["path"],
            "reports/desktop-performance-report-latest.json",
        )
        self.assertEqual(result["completionStatus"], "PARTIAL")
        self.assertEqual(result["proofStatus"], "UNPROVEN")
        self.assertEqual(result["phase"], "P0c")
        self.assertEqual(result["sourcePhase"], "P0c")
        self.assertEqual(result["bom"], ["BOM-GATE-02"])
        self.assertEqual(result["sourceBom"], ["BOM-GATE-02"])
        self.assertEqual(result["spec"], ["SPEC-GATE-02"])
        self.assertEqual(result["sourceSpec"], ["SPEC-GATE-02"])
        self.assertEqual(result["sourceGate"], "Final report must fail closed until runtime evidence is proven")
        self.assertEqual(result["details"][0]["step"], "desktop-gateway")
        self.assertEqual(result["evidenceDetails"][0]["reason"], "connection refused")
        self.assertEqual(result["evidenceArtifacts"][0]["jsonValueType"], "array")
        self.assertEqual(result["evidenceArtifacts"][0]["itemCount"], 1)
        self.assertEqual(result["evidenceArtifacts"][1]["details"][0]["url"], "http://127.0.0.1:3030")
        self.assertEqual(result["issue_breakdown"][0]["category"], "matrix")
        self.assertEqual(
            result["recommended_review_commands"][0]["command"],
            "python3 tooling/scripts/desktop-performance-report.py",
        )

    def test_build_run_report_marks_failed_run_unproven(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "static-gate",
                    "status": "passed",
                },
                {
                    "id": "desktop-performance-report-gate",
                    "status": "failed",
                    "reason": "runtime evidence missing",
                    "sourceArtifact": "tooling/acceptance/reports/desktop-performance-report-latest.json",
                    "sourceArtifactKind": "desktop-performance-report",
                    "sourcePhase": "P0c",
                    "sourceBom": ["BOM-GATE-02"],
                    "sourceSpec": ["SPEC-GATE-02"],
                    "sourceGate": "Final report must fail closed until runtime evidence is proven",
                    "details": [
                        {
                            "step": "desktop-gateway",
                            "status": "fail",
                            "reason": "connection refused",
                        }
                    ],
                    "issue_breakdown": [
                        {
                            "category": "matrix",
                            "failedStep": "matrix",
                            "summary": "matrix evidence missing",
                            "proofImpact": "P0c remains PARTIAL/UNPROVEN.",
                        }
                    ],
                    "recommended_review_commands": [
                        {
                            "purpose": "Re-run final report.",
                            "command": "python3 tooling/scripts/desktop-performance-report.py",
                        }
                    ],
                },
            ],
        )

        self.assertEqual(report["artifactKind"], "acceptance-run")
        self.assertEqual(report["sourceArtifact"], "tooling/acceptance/reports/latest-plan.json")
        self.assertEqual(report["summary"]["total"], 2)
        self.assertEqual(report["summary"]["passed"], 1)
        self.assertEqual(report["summary"]["failed"], 1)
        self.assertEqual(report["summary"]["missingResultTraceability"], 0)
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["resultTraceabilityState"]["status"], "pass")
        self.assertEqual(report["resultTraceabilityState"]["completionStatus"], "DONE")
        self.assertEqual(report["resultTraceabilityState"]["proofStatus"], "PROVEN")
        self.assertFalse(report["resultTraceabilityState"]["sampleEmissionAllowed"])
        self.assertEqual(report["resultTraceabilityState"]["missingTraceabilityCount"], 0)
        self.assertEqual(report["results"][0]["artifactKind"], "acceptance-gate-result")
        self.assertEqual(
            report["results"][0]["artifactPath"],
            {
                "plan": "tooling/acceptance/reports/latest-plan.json",
                "resultGateId": "static-gate",
            },
        )
        self.assertEqual(report["results"][0]["traceability"]["status"], "not-required")
        self.assertEqual(report["results"][1]["artifactKind"], "acceptance-gate-result")
        self.assertEqual(
            report["results"][1]["artifactPath"],
            "tooling/acceptance/reports/desktop-performance-report-latest.json",
        )
        self.assertEqual(report["results"][1]["traceability"]["status"], "complete")
        self.assertEqual(report["results"][1]["traceability"]["sourcePhase"], "P0c")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["sourcePhases"], ["P0c"])
        self.assertEqual(report["sourceBom"], ["BOM-GATE-02"])
        self.assertEqual(report["sourceSpec"], ["SPEC-GATE-02"])
        self.assertEqual(report["sourceGates"], ["Final report must fail closed until runtime evidence is proven"])
        self.assertEqual(report["issue_breakdown"][0]["category"], "matrix")
        self.assertEqual(report["issue_breakdown"][0]["acceptanceGateId"], "desktop-performance-report-gate")
        self.assertEqual(
            report["issue_breakdown"][0]["sourceArtifact"],
            "tooling/acceptance/reports/desktop-performance-report-latest.json",
        )
        self.assertEqual(report["issue_breakdown"][0]["sourceArtifactKind"], "desktop-performance-report")
        self.assertEqual(report["issue_breakdown"][0]["sourcePhase"], "P0c")
        self.assertEqual(report["issue_breakdown"][0]["sourceBom"], ["BOM-GATE-02"])
        self.assertEqual(report["issue_breakdown"][0]["sourceSpec"], ["SPEC-GATE-02"])
        self.assertEqual(
            report["issue_breakdown"][0]["sourceGate"],
            "Final report must fail closed until runtime evidence is proven",
        )
        self.assertEqual(report["issue_breakdown"][0]["details"][0]["step"], "desktop-gateway")
        self.assertEqual(report["issue_breakdown"][0]["evidenceDetails"][0]["reason"], "connection refused")
        self.assertEqual(
            report["recommended_review_commands"][0]["command"],
            "python3 tooling/scripts/desktop-performance-report.py",
        )

    def test_build_run_report_keeps_empty_and_dry_run_unproven(self) -> None:
        module = load_module()
        empty = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [],
        )
        dry_run = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "synthetic-gate",
                    "status": "dry-run",
                }
            ],
        )

        for report in (empty, dry_run):
            self.assertEqual(report["completionStatus"], "PARTIAL")
            self.assertEqual(report["proofStatus"], "UNPROVEN")
            self.assertFalse(report["sampleEmissionAllowed"])

    def test_enrich_result_derives_reason_from_source_issue_when_artifact_reason_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("desktop-anchor-inventory-gate", source={})
            artifact_path = run.run_dir / "reports/desktop-anchor-inventory.json"
            artifact_path.parent.mkdir(parents=True)
            artifact_path.write_text(
                json.dumps(
                    {
                        "artifactKind": "desktop-anchor-inventory",
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "phase": "P0b-1",
                        "bom": ["BOM-SMP-01"],
                        "spec": ["SPEC-ANCHOR-01"],
                        "gate": "Anchor inventory must preserve DOM evidence diagnostics",
                        "issue_breakdown": [
                            {
                                "category": "dom-automation-evidence",
                                "failedStep": "desktop-anchor-inventory",
                                "summary": "DOM evidence loaded but remains UNPROVEN",
                                "proofImpact": "P0b-1 remains PARTIAL/UNPROVEN.",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            result = module.enrich_result_with_run_artifacts(
                {
                    "id": "desktop-anchor-inventory-gate",
                    "command": "python3 tooling/scripts/desktop-anchor-inventory.py",
                    "status": "failed",
                },
                run,
            )
            run.close()

        self.assertEqual(result["sourceArtifactKind"], "desktop-anchor-inventory")
        self.assertEqual(result["reason"], "DOM evidence loaded but remains UNPROVEN")
        self.assertEqual(result["issue_breakdown"][0]["category"], "dom-automation-evidence")

    def test_build_run_report_counts_passed_but_unproven_evidence(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "static-gate",
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                },
                {
                    "id": "desktop-telemetry-mirror-template-gate",
                    "status": "passed",
                    "evidenceStatus": "diagnostic incomplete",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "sourceArtifact": "tooling/acceptance/reports/desktop-performance-latest.json",
                    "sourceArtifactKind": "desktop-performance-station-mirror",
                    "sourcePhase": "P0a-6/P0c-5",
                    "sourceBom": ["BOM-CAP-05", "BOM-RUN-05"],
                    "sourceSpec": ["SPEC-STA-03", "SPEC-MIRROR-01"],
                    "sourceGate": "Station mirror must be queried from the product sink before report proof is allowed",
                    "reason": "Station mirror has not been queried; raw event evidence remains unproven",
                    "issue_breakdown": [
                        {
                            "category": "station-mirror-source",
                            "failedStep": "station-query-template",
                            "summary": "Station mirror has not been queried; raw event evidence remains unproven",
                            "proofImpact": "P0a-6/P0c-5 remains PARTIAL/UNPROVEN until Station raw events and rollups are queried from the product sink.",
                        }
                    ],
                    "recommended_review_commands": [
                        {
                            "purpose": "Run the live Gateway -> Station telemetry gate.",
                            "command": "python3 tooling/scripts/desktop-telemetry-live-gate.py",
                        }
                    ],
                },
            ],
        )

        self.assertEqual(report["summary"]["total"], 2)
        self.assertEqual(report["summary"]["passed"], 2)
        self.assertEqual(report["summary"]["failed"], 0)
        self.assertEqual(report["summary"]["partial"], 1)
        self.assertEqual(report["summary"]["unproven"], 1)
        self.assertEqual(report["summary"]["incomplete"], 1)
        self.assertEqual(report["summary"]["passedButUnproven"], 1)
        self.assertEqual(report["summary"]["missingResultTraceability"], 0)
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["results"][0]["traceability"]["status"], "not-required")
        self.assertEqual(report["results"][1]["traceability"]["status"], "complete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["sourcePhases"], ["P0a-6/P0c-5"])
        self.assertEqual(report["sourceBom"], ["BOM-CAP-05", "BOM-RUN-05"])
        self.assertEqual(report["sourceSpec"], ["SPEC-STA-03", "SPEC-MIRROR-01"])
        self.assertEqual(
            report["sourceGates"],
            ["Station mirror must be queried from the product sink before report proof is allowed"],
        )
        self.assertEqual(report["issue_breakdown"][0]["category"], "station-mirror-source")
        self.assertEqual(report["issue_breakdown"][0]["acceptanceGateId"], "desktop-telemetry-mirror-template-gate")
        self.assertEqual(
            report["issue_breakdown"][0]["sourceArtifact"],
            "tooling/acceptance/reports/desktop-performance-latest.json",
        )
        self.assertEqual(
            report["issue_breakdown"][0]["sourceArtifactKind"],
            "desktop-performance-station-mirror",
        )
        self.assertEqual(report["issue_breakdown"][0]["sourcePhase"], "P0a-6/P0c-5")
        self.assertEqual(report["issue_breakdown"][0]["sourceBom"], ["BOM-CAP-05", "BOM-RUN-05"])
        self.assertEqual(report["issue_breakdown"][0]["sourceSpec"], ["SPEC-STA-03", "SPEC-MIRROR-01"])
        self.assertEqual(report["issueBreakdown"], report["issue_breakdown"])
        self.assertEqual(
            report["recommended_review_commands"][0]["command"],
            "python3 tooling/scripts/desktop-telemetry-live-gate.py",
        )
        self.assertEqual(report["recommendedReviewCommands"], report["recommended_review_commands"])

    def test_build_run_report_marks_unproven_without_partial_incomplete(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "unproven-gate",
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "UNPROVEN",
                    "reason": "evidence proof status is unproven",
                    "details": [
                        {
                            "step": "proof-state",
                            "status": "fail",
                            "reason": "proof status is UNPROVEN",
                        }
                    ],
                },
            ],
        )

        self.assertEqual(report["summary"]["partial"], 0)
        self.assertEqual(report["summary"]["unproven"], 1)
        self.assertEqual(report["summary"]["incomplete"], 1)
        self.assertEqual(report["summary"]["passedButUnproven"], 1)
        self.assertEqual(report["summary"]["missingResultTraceability"], 1)
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["resultTraceabilityState"]["status"], "diagnostic incomplete")
        self.assertEqual(report["resultTraceabilityState"]["completionStatus"], "PARTIAL")
        self.assertEqual(report["resultTraceabilityState"]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["resultTraceabilityState"]["missingTraceabilityCount"], 1)
        self.assertEqual(report["resultTraceabilityState"]["missingTraceability"][0]["acceptanceGateId"], "unproven-gate")
        self.assertEqual(report["results"][0]["traceability"]["status"], "missing")
        self.assertIn("sourceArtifact", report["results"][0]["traceability"]["missingFields"])
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["issue_breakdown"][0]["category"], "acceptance-gate:unproven-gate")
        self.assertEqual(report["issue_breakdown"][0]["failedStep"], "unproven-gate")
        self.assertEqual(report["issue_breakdown"][0]["acceptanceGateId"], "unproven-gate")
        self.assertEqual(report["issue_breakdown"][0]["details"][0]["step"], "proof-state")
        self.assertEqual(report["issue_breakdown"][0]["evidenceDetails"][0]["status"], "fail")

    def test_build_run_report_never_allows_sample_emission_for_dry_run(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/plans/desktop-performance-phase0.json",
            [
                {
                    "id": "desktop-performance-preflight-gate",
                    "status": "dry-run",
                }
            ],
        )

        self.assertEqual(report["summary"]["dryRun"], 1)
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(module.acceptance_exit_code(report), 1)

    def test_render_markdown_exposes_sample_emission(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "desktop-performance-matrix-gate",
                    "status": "failed",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "sourceArtifact": "tooling/acceptance/reports/desktop-performance-matrix-latest.json",
                    "sourceArtifactKind": "desktop-performance-matrix-gate",
                    "sourcePhase": "P0c-5",
                    "sourceBom": ["BOM-GATE-02"],
                    "sourceSpec": ["SPEC-GATE-02"],
                    "sourceGate": "Runtime matrix must fail closed until runtime samples are proven",
                }
            ],
        )

        markdown = module.render_markdown(report)

        self.assertIn("- Sample emission allowed: `False`", markdown)
        self.assertIn("desktop-performance-matrix-gate", markdown)

    def test_acceptance_exit_code_preserves_legacy_proven_semantics(self) -> None:
        module = load_module()
        proven_report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "proven-gate",
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                    "sampleEmissionAllowed": True,
                }
            ],
        )
        unproven_report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "passed-but-unproven-gate",
                    "status": "passed",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "sampleEmissionAllowed": False,
                    "sourceArtifact": "tooling/acceptance/reports/unproven.json",
                    "sourceArtifactKind": "unproven-evidence",
                    "sourcePhase": "P0x",
                    "sourceBom": ["BOM-X"],
                    "sourceSpec": ["SPEC-X"],
                    "sourceGate": "Unproven evidence must not let acceptance exit successfully",
                }
            ],
        )

        self.assertEqual(proven_report["proofStatus"], "PROVEN")
        self.assertEqual(proven_report["results"][0]["proofStatus"], "PROVEN")
        self.assertEqual(
            proven_report["resultTraceabilityState"]["proofStatus"],
            "PROVEN",
        )
        self.assertEqual(module.acceptance_exit_code(proven_report), 0)
        self.assertEqual(module.acceptance_exit_code(unproven_report), 1)

    def test_acceptance_exit_code_accepts_candidate_in_explicit_mode(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "agent-v2-kernel-foundation-e2e",
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "CANDIDATE",
                    "sampleEmissionAllowed": True,
                }
            ],
            candidate_mode=True,
        )
        self.assertEqual(report["proofStatus"], "CANDIDATE")
        self.assertEqual(report["results"][0]["proofStatus"], "CANDIDATE")
        self.assertEqual(
            report["resultTraceabilityState"]["proofStatus"],
            "CANDIDATE",
        )
        self.assertEqual(
            module.acceptance_exit_code(report, candidate_mode=True),
            0,
        )
        self.assertEqual(module.acceptance_exit_code(report), 1)

    def test_blocked_result_is_distinct_from_failed_and_exits_two(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "environment-gate",
                    "status": "blocked",
                    "blockedReason": "credential missing",
                    "blockedResource": "credential-ref:env:TEST_PASSWORD",
                }
            ],
        )

        self.assertEqual(report["summary"]["blocked"], 1)
        self.assertEqual(report["summary"]["failed"], 0)
        self.assertEqual(report["completionStatus"], "BLOCKED")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(module.acceptance_exit_code(report), 2)

    def test_unexpected_provisioning_error_is_structured_failed_result(self) -> None:
        module = load_module()
        result = module.provisioning_failure_result(
            gate_id="environment-gate",
            command="run-gate",
            environment="home-station",
            tier="env-evidence",
            error=RuntimeError("provisioner exploded"),
            duration_seconds=0.1,
        )
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [result],
        )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["proofStatus"], "UNPROVEN")
        self.assertEqual(result["errorType"], "RuntimeError")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(module.acceptance_exit_code(report), 1)

    def test_missing_environment_contract_produces_blocked_manifest(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            environments = worktree / "environments"
            environments.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("test-gate", source={})
            with mock.patch.dict(
                os.environ,
                run.subprocess_environment(os.environ),
            ), mock.patch.object(module, "REPO_ROOT", worktree), mock.patch(
                "tooling.acceptance.core.ENVIRONMENTS_DIR",
                environments,
            ):
                provisioner, manifest, path = module.provision_environment(
                    "missing-environment",
                    "test-gate",
                )
            run.close()

        self.assertIsNone(provisioner)
        self.assertEqual(manifest["state"], "BLOCKED")
        self.assertEqual(
            manifest["blockedResource"],
            "environment-contract:missing-environment",
        )
        self.assertIsNotNone(path)

    def test_runtime_log_redaction_removes_resolved_secret_values(self) -> None:
        module = load_module()
        secret = "acceptance-secret-value"
        redacted = module.redact_runtime_text(
            f"raw output contained {secret}",
            (secret,),
        )
        self.assertNotIn(secret, redacted)
        self.assertIn("[REDACTED]", redacted)

    def test_short_secret_uses_key_aware_redaction_without_corrupting_numbers(self) -> None:
        module = load_module()
        redacted = module.redact_runtime_text(
            "count=1 password=1",
            ("1",),
        )
        self.assertIn("count=1", redacted)
        self.assertIn("password=[REDACTED]", redacted)

    def test_runtime_artifact_audit_detects_resolved_secret_values(self) -> None:
        module = load_module()
        secret = "artifact-secret-value"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifact = root / "reports" / "gate.json"
            artifact.parent.mkdir(parents=True)
            artifact.write_text(
                json.dumps(
                    {
                        "message": f"leaked {secret}",
                        "password": "1",
                        "count": 1,
                    }
                ),
                encoding="utf-8",
            )
            leaked_paths = module.audit_runtime_artifacts(
                root,
                (secret,),
            )
            serialized = artifact.read_text(encoding="utf-8")

        self.assertEqual(leaked_paths, ["reports/gate.json"])
        self.assertIn(secret, serialized)
        self.assertIn('"count": 1', serialized)
        self.assertIn('"password": "1"', serialized)

    def test_runtime_secret_scan_redacts_high_entropy_canary_only(self) -> None:
        module = load_module()
        canary = "acceptance-canary-value-0123456789"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifact = root / "reports" / "gate.json"
            artifact.parent.mkdir(parents=True)
            artifact.write_text(
                json.dumps(
                    {
                        "message": f"leaked {canary}",
                        "count": 1,
                    }
                ),
                encoding="utf-8",
            )
            leaked_paths = module.audit_runtime_artifacts(
                root,
                (canary, "1"),
            )
            serialized = artifact.read_text(encoding="utf-8")

        self.assertEqual(
            leaked_paths,
            ["reports/gate.json"],
        )
        self.assertIn(canary, serialized)
        self.assertIn('"count": 1', serialized)

    def test_registered_artifact_is_scanned_but_never_rewritten(self) -> None:
        module = load_module()
        secret = "registered-secret-value"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifact = root / "roles" / "receiver-dom.json"
            artifact.parent.mkdir(parents=True)
            original = json.dumps({"message": secret}) + "\n"
            artifact.write_text(original, encoding="utf-8")
            role_dir = root / ".artifact-roles"
            role_dir.mkdir()
            (role_dir / "receiver-dom.json").write_text(
                json.dumps(
                    {
                        "role": "receiver-dom",
                        "artifact": {
                            "path": "roles/receiver-dom.json",
                        },
                    }
                ),
                encoding="utf-8",
            )
            leaked_paths = module.audit_runtime_artifacts(
                root,
                (secret,),
            )
            serialized = artifact.read_text(encoding="utf-8")

        self.assertEqual(leaked_paths, ["roles/receiver-dom.json"])
        self.assertEqual(serialized, original)

    def test_finalize_runtime_log_discards_unregistered_secret_artifact(
        self,
    ) -> None:
        module = load_module()
        secret = "runtime-secret-value"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("runtime-gate", source={})
            artifact = run.run_dir / "reports" / "runtime.json"
            artifact.parent.mkdir(parents=True)
            artifact.write_text(
                json.dumps({"password": secret}),
                encoding="utf-8",
            )
            run_dir = run.run_dir

            with self.assertRaisesRegex(
                EvidenceConflict,
                "bypassed the immutable artifact writer",
            ):
                module.finalize_runtime_log(
                    run,
                    "runtime-gate",
                    f"password={secret}",
                    (secret,),
                )

            self.assertFalse(run_dir.exists())

    def test_unregistered_secret_artifact_discards_active_run(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("runtime-gate", source={})
            run_dir = run.run_dir

            with self.assertRaisesRegex(
                EvidenceConflict,
                "bypassed the immutable artifact writer",
            ):
                module.reject_unresolved_secret_artifacts(
                    run,
                    ["reports/unregistered.json"],
                )

            self.assertFalse(run_dir.exists())

    def test_build_run_report_deduplicates_review_commands_by_command_text(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "gate-a",
                    "status": "failed",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "sourceArtifact": "tooling/acceptance/reports/gate-a.json",
                    "sourceArtifactKind": "gate-a",
                    "sourcePhase": "P0x",
                    "sourceBom": ["BOM-X"],
                    "sourceSpec": ["SPEC-X"],
                    "sourceGate": "Gate A",
                    "recommended_review_commands": [
                        {"purpose": "Start Desktop.", "command": "make desktop"},
                        {"purpose": "Re-run acceptance.", "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json"},
                    ],
                },
                {
                    "id": "gate-b",
                    "status": "failed",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "sourceArtifact": "tooling/acceptance/reports/gate-b.json",
                    "sourceArtifactKind": "gate-b",
                    "sourcePhase": "P0x",
                    "sourceBom": ["BOM-X"],
                    "sourceSpec": ["SPEC-X"],
                    "sourceGate": "Gate B",
                    "recommended_review_commands": [
                        {"purpose": "Start Desktop again.", "command": "make desktop"},
                        {
                            "purpose": "Re-run acceptance again.",
                            "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
                        },
                    ],
                },
            ],
        )

        command_texts = [item["command"] for item in report["recommended_review_commands"]]
        self.assertEqual(command_texts.count("make desktop"), 1)
        self.assertEqual(command_texts.count("make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json"), 1)

    def test_selected_gates_from_plan_resolves_gate_ids_from_definitions(self) -> None:
        module = load_module()
        gates = module.selected_gates_from_plan(
            {
                "selected_gates": [
                    "static-gate",
                    {
                        "id": "runtime-gate",
                        "timeout_seconds": 30,
                    },
                ],
            },
            {
                "static-gate": {
                    "command": "python3 tooling/scripts/static_gate.py",
                    "tier": "ci-cheap",
                },
                "runtime-gate": {
                    "command": "python3 tooling/scripts/runtime_gate.py",
                    "tier": "env-evidence",
                    "timeout_seconds": 600,
                },
            },
        )

        self.assertEqual([gate["id"] for gate in gates], ["static-gate", "runtime-gate"])
        self.assertEqual(gates[0]["command"], "python3 tooling/scripts/static_gate.py")
        self.assertEqual(gates[0]["tier"], "ci-cheap")
        self.assertEqual(gates[1]["command"], "python3 tooling/scripts/runtime_gate.py")
        self.assertEqual(gates[1]["timeout_seconds"], 30)


if __name__ == "__main__":
    unittest.main()
