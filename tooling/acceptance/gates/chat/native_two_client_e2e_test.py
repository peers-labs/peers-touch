from __future__ import annotations

import ast
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from tooling.acceptance.core import (
    ArtifactRef,
    EvidenceReport,
    EvidenceStore,
    GateError,
    REPO_ROOT,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    NativeTwoClientGate,
)
from tooling.acceptance.gates.chat.native_support import (
    NativeClientLifecycleLedger,
)


def load_module() -> Any:
    path = Path(__file__).with_name("native_two_client_e2e.py")
    spec = importlib.util.spec_from_file_location(
        "native_two_client_e2e",
        path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SyntheticRuntimeBinding:
    cell_id = "desktop-linux-native"

    def __init__(self) -> None:
        self.cleanup = {
            "portsReleased": True,
            "processesReleased": True,
            "storageReleased": True,
            "logsReleased": True,
            "cleanupErrors": [],
        }

    def runtime_identity(self) -> dict[str, Any]:
        return {
            "artifactKind": "acceptance-runtime-cell-manifest",
            "cellId": self.cell_id,
            "gateId": "chat-native-two-client-e2e",
            "runId": "cell-run-a",
            "state": "LEASED",
            "platform": {
                "os": "linux",
                "imageDigest": "c" * 64,
            },
            "source": {
                "commit": "commit-a",
                "workspaceDigest": "clean",
                "remoteSourceDigest": "b" * 64,
                "remoteCheckoutClean": True,
                "binarySha256": "a" * 64,
            },
        }

    def binary_identity(self) -> dict[str, str]:
        return {
            "path": "runtime-cell:desktop-linux-native:cell-run-a:bin",
            "sha256": "a" * 64,
            "sourceCommit": "commit-a",
        }

    def finalize_cleanup(
        self,
        sessions: list[Any],
        client_specs: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        del sessions, client_specs
        return dict(self.cleanup)


class NativeTwoClientEvidenceTest(unittest.TestCase):
    def test_native_runners_bind_conversation_creation_to_federation(self) -> None:
        root = Path(__file__).resolve().parents[4]
        runners = (
            "native_two_client_runner.py",
            "native_interactions_runner.py",
            "native_typing_runner.py",
            "native_multi_device_runner.py",
            "native_recovery_runner.py",
            "native_group_mls_runner.py",
        )
        for filename in runners:
            path = root / "tooling/acceptance/gates/chat" / filename
            source = path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename)
            creation_calls = [
                node
                for node in ast.walk(tree)
                if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "async_harness"
                and len(node.args) >= 3
                and isinstance(node.args[1], ast.Constant)
                and node.args[1].value
                in {"createDirectConversation", "createGroup"}
            ]
            self.assertTrue(creation_calls, filename)
            for call in creation_calls:
                self.assertIsInstance(call.args[2], ast.Dict, filename)
                keys = {
                    key.value
                    for key in call.args[2].keys
                    if isinstance(key, ast.Constant)
                }
                self.assertIn("federationId", keys, filename)
            if any(
                call.args[1].value == "createDirectConversation"
                for call in creation_calls
            ):
                self.assertIn("wait_for_peer_key_bundle(", source, filename)

    def setUp(self) -> None:
        self.module = load_module()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = EvidenceStore(
            self.root / "artifacts",
            worktree=REPO_ROOT,
        )
        self.run = self.store.begin_run(
            self.module.GATE_ID,
            source={"commit": "commit-a", "workspaceDigest": "clean"},
        )
        environment = self.run.subprocess_environment(os.environ.copy())
        environment["PT_ACCEPTANCE_RUNTIME_CELL"] = (
            "desktop-linux-native"
        )
        self.environment = patch.dict(os.environ, environment)
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()
        self.run.close()
        self.temp.cleanup()

    def valid_report(self) -> dict[str, Any]:
        evidence: dict[str, dict[str, str]] = {}
        for actor in ("alice", "bob"):
            for suffix in ("screenshot", "dom", "app-log"):
                key = f"{actor}-{suffix}"
                evidence[key] = self.run.write_bytes(
                    f"evidence/{key}.txt",
                    b"evidence",
                ).to_dict()
        source = {
            "worktree": "<repo-root>",
            "commit": "commit-a",
            "workspaceDigest": "clean",
        }
        station_four = {
            "kind": "station",
            "deploymentEnvironment": "station-test",
            "endpoint": "http://station-four",
            "liveCommit": "commit-a",
            "workspaceDigest": "clean",
            "protocolDigest": "d" * 64,
            "attestationArtifact": {
                "artifactKind": "acceptance-artifact-ref",
            },
        }
        station_five = {
            **station_four,
            "endpoint": "http://station-five",
        }
        clients = [
            {
                "id": actor,
                "actor": actor,
                "runtime": "native-tauri",
                "webdriver_port": 4445 + index,
                "gateway_port": 3030 + index,
                "renderer_port": 14310 + index,
                "profile": actor,
                "storage_root": f"/tmp/{actor}",
                "required_service_roles": ["station"],
                "service_bindings": {
                    "station": {
                        "service_id": service_id,
                        "required_kind": "station",
                    },
                },
            }
            for index, (actor, service_id) in enumerate(
                (
                    ("alice", "station-four"),
                    ("bob", "station-five"),
                )
            )
        ]
        runtime_cell = SyntheticRuntimeBinding().runtime_identity()
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gate": self.module.GATE_ID,
            "status": "PASS",
            "station_url": "http://station-four",
            "manifest": {
                "artifactKind": "acceptance-runtime-manifest",
                "gateId": self.module.GATE_ID,
                "runId": "provisioner-run-a",
                "state": "FIXTURE_READY",
                "source": source,
                "services": {
                    "station-four": station_four,
                    "station-five": station_five,
                },
                "clients": clients,
            },
            "runtime": {
                "runtimeCell": "desktop-linux-native",
                "runtimeCellRunId": "cell-run-a",
                "journey": "direct-delivered-receipt",
                "sourceIdentity": {
                    "orchestrator": source,
                    "station": station_four,
                    "stationLive": {"build_commit": "commit-a"},
                    "runtimeCell": runtime_cell,
                    "binary": SyntheticRuntimeBinding().binary_identity(),
                },
                "steps": [
                    {"step": step, "status": "pass"}
                    for step in sorted(self.module.REQUIRED_STEPS)
                ],
                "cleanup": {
                    "portsReleased": True,
                    "processesReleased": True,
                    "storageReleased": True,
                    "logsReleased": True,
                    "cleanupErrors": [],
                },
            },
            "actors": {
                actor: {
                    "name": actor,
                    "runtime": "desktop-linux-native",
                    "port": 4445 + index,
                    "gateway_port": 3030 + index,
                    "profile": actor,
                    "storage_root": f"/tmp/{actor}",
                    "pid": 100 + index,
                }
                for index, actor in enumerate(("alice", "bob"))
            },
            "assertions": [
                {"name": name, "passed": True, "detail": ""}
                for name in sorted(self.module.REQUIRED_ASSERTIONS)
            ],
            "evidence": evidence,
        }

    def write_report(
        self,
        report: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], ArtifactRef]:
        expected = report or self.valid_report()
        self.write_environment_manifest(expected)
        self.run.write_json(
            self.module.SOURCE_REPORT_PATH,
            expected,
        )
        return self.module.load_report(self.store)

    def write_environment_manifest(
        self,
        report: dict[str, Any],
    ) -> None:
        self.run.write_json(
            self.module.ENVIRONMENT_MANIFEST_PATH,
            report["manifest"],
        )

    def test_accepts_current_source_bound_report(self) -> None:
        report, source_ref = self.write_report()
        self.module.validate_report(
            report,
            source_ref=source_ref,
            store=self.store,
        )
        validation_ref = self.module.write_validation(
            report,
            source_ref=source_ref,
        )
        self.assertEqual(validation_ref.run_id, self.run.run_id)
        self.assertEqual(
            self.store.read_json(validation_ref)["proofStatus"],
            "PROVEN",
        )

    def test_rejects_embedded_environment_manifest_substitution(self) -> None:
        report = self.valid_report()
        self.run.write_json(
            self.module.ENVIRONMENT_MANIFEST_PATH,
            report["manifest"],
        )
        report["manifest"]["runId"] = "substituted-provisioner-run"
        source_ref = self.run.write_json(
            self.module.SOURCE_REPORT_PATH,
            report,
        )

        with self.assertRaisesRegex(
            self.module.GateError,
            "embedded environment manifest",
        ):
            self.module.validate_report(
                report,
                source_ref=source_ref,
                store=self.store,
            )

    def test_rejects_runtime_substitution_and_dirty_source(self) -> None:
        report = self.valid_report()
        self.write_environment_manifest(report)
        report["runtime"]["sourceIdentity"]["runtimeCell"][
            "cellId"
        ] = "desktop-macos-native"
        source_ref = self.run.write_json(
            self.module.SOURCE_REPORT_PATH,
            report,
        )
        with self.assertRaisesRegex(
            self.module.GateError,
            "runtime-cell identity",
        ):
            self.module.validate_report(
                report,
                source_ref=source_ref,
                store=self.store,
            )

        report = self.valid_report()
        report["runtime"]["sourceIdentity"]["runtimeCell"]["source"][
            "remoteCheckoutClean"
        ] = False
        with self.assertRaisesRegex(
            self.module.GateError,
            "stale or dirty",
        ):
            self.module.validate_report(
                report,
                source_ref=source_ref,
                store=self.store,
            )

    def test_rejects_plain_path_cross_run_and_modified_evidence(self) -> None:
        report = self.valid_report()
        self.write_environment_manifest(report)
        report["evidence"]["alice-dom"] = "/tmp/alice.html"
        source_ref = self.run.write_json(
            self.module.SOURCE_REPORT_PATH,
            report,
        )
        with self.assertRaises(Exception):
            self.module.validate_report(
                report,
                source_ref=source_ref,
                store=self.store,
            )

        report = self.valid_report()
        other = self.store.begin_run(
            self.module.GATE_ID,
            source={"commit": "commit-a", "workspaceDigest": "clean"},
        )
        try:
            report["evidence"]["alice-dom"] = other.write_bytes(
                "evidence/alice-dom.txt",
                b"cross-run",
            ).to_dict()
            with self.assertRaisesRegex(
                self.module.GateError,
                "current Gate run",
            ):
                self.module.validate_report(
                    report,
                    source_ref=source_ref,
                    store=self.store,
                )
        finally:
            other.close()

        report = self.valid_report()
        reference = ArtifactRef.from_dict(
            report["evidence"]["alice-dom"]
        )
        self.store.resolve(reference).write_text(
            "modified",
            encoding="utf-8",
        )
        with self.assertRaises(Exception):
            self.module.validate_report(
                report,
                source_ref=source_ref,
                store=self.store,
            )

    def test_failure_retains_first_boundary_and_cleanup(self) -> None:
        manifest = {
            "state": "FIXTURE_READY",
            "source": {
                "commit": "commit-a",
                "workspaceDigest": "clean",
            },
            "services": {
                "station-four": {
                    "kind": "station",
                    "endpoint": "http://station-four",
                    "liveCommit": "commit-a",
                    "workspaceDigest": "clean",
                    "protocolDigest": "d" * 64,
                },
                "station-five": {
                    "kind": "station",
                    "endpoint": "http://station-five",
                    "liveCommit": "commit-a",
                    "workspaceDigest": "clean",
                    "protocolDigest": "d" * 64,
                },
            },
            "clients": [
                {
                    "id": actor,
                    "actor": actor,
                    "runtime": "native-tauri",
                    "webdriver_port": 4445 + index,
                    "gateway_port": 3030 + index,
                    "renderer_port": 14310 + index,
                    "profile": actor,
                    "storage_root": f"/tmp/{actor}",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": (
                                "station-four"
                                if actor == "alice"
                                else "station-five"
                            ),
                            "required_kind": "station",
                        },
                    },
                }
                for index, actor in enumerate(("alice", "bob"))
            ],
        }
        actors = {
            "actors": [
                {
                    "role": actor,
                    "accountRef": f"station-account:{actor}",
                    "ptid": f"did:pt:{actor}",
                }
                for actor in ("alice", "bob")
            ],
            "reset": {"authorized": True, "targetVerified": True},
        }
        gate = NativeTwoClientGate(
            manifest=manifest,
            actor_manifest=actors,
            runtime_binding=SyntheticRuntimeBinding(),  # type: ignore[arg-type]
        )
        with (
            patch.dict(os.environ, {"CHAT_ACCEPTANCE_RESET": "1"}),
            patch(
                "tooling.acceptance.gates.chat.native_two_client_runner."
                "read_station_version",
                return_value={"build_commit": "commit-a"},
            ),
            patch.object(
                gate,
                "start_client",
                side_effect=GateError("synthetic launch failure"),
            ),
            self.assertRaisesRegex(GateError, "synthetic launch failure"),
        ):
            gate.run()

        self.assertEqual(
            gate.report.runtime["steps"][-1]["step"],
            "client.authenticated",
        )
        self.assertEqual(
            gate.report.runtime["steps"][-1]["status"],
            "fail",
        )
        self.assertTrue(
            gate.report.runtime["cleanup"]["portsReleased"],
        )

    def test_source_identity_rejects_malformed_station_protocol_digest(self) -> None:
        manifest = self.valid_report()["manifest"]
        manifest["services"]["station-four"]["protocolDigest"] = "z" * 64
        gate = object.__new__(NativeTwoClientGate)
        gate.manifest = manifest
        gate.runtime_binding = SyntheticRuntimeBinding()
        gate.report = EvidenceReport(
            gate_id=self.module.GATE_ID,
            status="RUNNING",
            started_at="2026-08-30T00:00:00Z",
            duration_ms=0,
        )

        with self.assertRaisesRegex(
            GateError,
            "source_build_runtime_identity",
        ):
            gate.source_identity({"build_commit": "commit-a"})

    def test_cleanup_failure_remains_structured(self) -> None:
        binding = SyntheticRuntimeBinding()
        binding.cleanup["portsReleased"] = False
        gate = object.__new__(NativeTwoClientGate)
        gate.runtime_instances = []
        gate.client_lifecycles = NativeClientLifecycleLedger()
        gate.clients = {}
        gate.client_specs = {}
        gate.runtime_binding = binding
        gate.report = EvidenceReport(
            gate_id=self.module.GATE_ID,
            status="RUNNING",
            started_at="2026-08-28T00:00:00Z",
            duration_ms=0,
        )

        cleanup = gate.cleanup_clients()

        self.assertFalse(cleanup["portsReleased"])
        self.assertEqual(
            gate.report.assertions[-1].name,
            "resources_released",
        )
        self.assertFalse(gate.report.assertions[-1].passed)

    def test_cleanup_exports_remote_log_before_binding_cleanup(self) -> None:
        log_path = self.root / "alice.log"

        class ExportedLogClient:
            profile = "alice"
            gateway_port = 3030

            def __init__(self, path: Path) -> None:
                self.log_path = path

            def stop(self) -> None:
                self.log_path.write_text(
                    "remote native log\n",
                    encoding="utf-8",
                )

        client = ExportedLogClient(log_path)
        gate = object.__new__(NativeTwoClientGate)
        gate.runtime_instances = [client]
        gate.client_lifecycles = NativeClientLifecycleLedger()
        gate.client_lifecycles.register(
            client,
            "ptid:v1:actor:alice",
        )
        gate.client_lifecycles.mark_live(client)
        gate.clients = {"alice": client}
        gate.client_specs = {}
        gate.runtime_binding = SyntheticRuntimeBinding()
        gate.report = EvidenceReport(
            gate_id=self.module.GATE_ID,
            status="RUNNING",
            started_at="2026-08-28T00:00:00Z",
            duration_ms=0,
        )

        cleanup = gate.cleanup_clients()

        reference = ArtifactRef.from_dict(
            gate.report.evidence["alice-app-log"]
        )
        self.assertEqual(
            self.store.resolve(reference).read_text(encoding="utf-8"),
            "remote native log\n",
        )
        self.assertFalse(cleanup["cleanupErrors"])

    def test_w8_and_gate_entry_bind_runtime_cell(self) -> None:
        root = Path(__file__).resolve().parents[4]
        runner = (
            root
            / "tooling/acceptance/gates/chat/native_two_client_runner.py"
        ).read_text(encoding="utf-8")
        entry = (
            root
            / "tooling/acceptance/gates/chat/native_two_client_entry.py"
        ).read_text(encoding="utf-8")
        gates = json.loads(
            (root / "tooling/acceptance/gates.yaml").read_text(
                encoding="utf-8"
            )
        )["gates"][self.module.GATE_ID]
        makefile = (
            root / "tooling/make/acceptance.mk"
        ).read_text(encoding="utf-8")
        harness = (
            root / "apps/desktop/src/acceptance/chat/harness.ts"
        ).read_text(encoding="utf-8")
        friend_sync = harness.split(
            "    async syncFriendSession(",
            maxsplit=1,
        )[1].split(
            "    async createGroup(",
            maxsplit=1,
        )[0]

        self.assertNotIn("LocalTauriLauncher", runner)
        self.assertNotIn("start_authenticated_client", runner)
        self.assertIn('"hydrateActiveActor"', runner)
        self.assertIn("self.client_lifecycles", runner)
        self.assertIn("NativeClientLifecycleLedger", runner)
        self.assertIn(
            '"createDirectConversation"',
            runner.split(
                "    def open_conversation(",
                maxsplit=1,
            )[1].split(
                "    def prove_direction(",
                maxsplit=1,
            )[0],
        )
        self.assertIn(
            "await refreshConversation('friend', sessionUlid)",
            friend_sync,
        )
        self.assertNotIn("conversation.syncFromStation", friend_sync)
        self.assertIn("resolve_native_desktop_runtime", entry)
        self.assertIn(
            "runtime_binding.set_runtime_manifest(manifest)",
            entry,
        )
        self.assertEqual(gates["timeout_seconds"], 1800)
        self.assertEqual(
            gates["requiredRuntimeCells"],
            [
                "desktop-macos-native",
                "desktop-linux-native",
                "desktop-windows-native",
            ],
        )
        self.assertIn(
            "acceptance-chat-native-w8:\n"
            '\tPT_ACCEPTANCE_RUNTIME_CELL="$(RUNTIME_CELL)"',
            makefile,
        )
        self.assertIn(
            '--runtime-cell "$(RUNTIME_CELL)"',
            makefile.split(
                "acceptance-chat-native-w8:",
                maxsplit=1,
            )[1].split(
                "acceptance-chat-w11:",
                maxsplit=1,
            )[0],
        )
        self.assertNotIn(
            "ACCEPTANCE_PLAN ?= tooling/acceptance/reports/",
            makefile,
        )
        self.assertIn(
            'ACCEPTANCE_PLAN_OUTPUT_ARG = $(if $(ACCEPTANCE_PLAN),'
            '--output "$(ACCEPTANCE_PLAN)",)',
            makefile,
        )


if __name__ == "__main__":
    unittest.main()
