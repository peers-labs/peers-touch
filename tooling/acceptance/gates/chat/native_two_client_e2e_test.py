from __future__ import annotations

import base64
import importlib.util
import json
import os
import re
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
from tooling.acceptance.gates.chat.native_current_profile_two_client_e2e import (
    validate_current_profile_topology,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    CURRENT_PROFILE_REQUIRED_ASSERTIONS,
    CURRENT_PROFILE_GATE_ID,
    NativeTwoClientGate,
    SUBMITTED_COMMAND_RECOVERY_GATE_ID,
    SUBMITTED_COMMAND_RECOVERY_REQUIRED_ASSERTIONS,
    avatar_evidence_is_valid,
    is_current_profile_gate,
    reconciled_command_snapshot_outcome,
    submitted_command_snapshot_is_exact,
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

    def test_avatar_evidence_requires_each_actor_on_a_remote_client(self) -> None:
        alice = "data:image/svg+xml;base64,alice"
        bob = "data:image/svg+xml;base64,bob"
        evidence = {
            "alice": {
                "alice": None,
                "bob": {
                    "declared": alice,
                    "rendered": alice,
                    "complete": True,
                    "naturalWidth": 36,
                },
            },
            "bob": {
                "alice": {
                    "declared": bob,
                    "rendered": bob,
                    "complete": True,
                    "naturalWidth": 36,
                },
                "bob": None,
            },
        }

        with patch(
            "tooling.acceptance.gates.chat.native_two_client_runner."
            "is_bundled_square_avatar",
            return_value=True,
        ):
            self.assertTrue(
                avatar_evidence_is_valid(
                    evidence,
                    {"http://station.example"},
                )
            )
            evidence["bob"]["alice"] = None
            self.assertFalse(
                avatar_evidence_is_valid(
                    evidence,
                    {"http://station.example"},
                )
            )

    def test_avatar_evidence_accepts_only_local_cache_for_station_source(self) -> None:
        station_avatar = (
            "http://station.example/sub-oss/file?key=avatars%2Falice.png"
        )
        snapshot = {
            "declared": station_avatar,
            "rendered": "asset://localhost/avatar.png",
            "complete": True,
            "naturalWidth": 384,
        }
        evidence = {"alice": {"alice": None, "bob": snapshot}}

        self.assertTrue(
            avatar_evidence_is_valid(
                evidence,
                {"http://station.example"},
            )
        )
        self.assertFalse(
            avatar_evidence_is_valid(
                evidence,
                {"http://other-station.example"},
            )
        )

    def test_reconciled_command_snapshot_distinguishes_architecture_outcomes(
        self,
    ) -> None:
        snapshot = {
            "messageId": "message-1",
            "projection": {
                "eventId": "event-1",
                "eventSequence": 34,
                "deliveryState": "read",
            },
            "intent": {
                "commandId": "command-1",
                "state": "committed",
            },
            "outbox": {
                "state": "committed",
                "lastErrorCode": "",
                "commandSha256": "a" * 64,
            },
            "commandLedger": [
                {
                    "commandId": "command-1",
                    "messageId": "message-1",
                    "attemptState": "committed",
                    "localState": "committed",
                    "outboxState": "committed",
                    "draftState": "accepted",
                }
            ],
        }

        self.assertEqual(
            reconciled_command_snapshot_outcome(
                snapshot,
                "command-1",
                "message-1",
                "a" * 64,
            ),
            "accepted",
        )
        snapshot["projection"] = None
        snapshot["intent"] = None
        snapshot["outbox"].update(
            {
                "state": "retry_wait",
                "lastErrorCode": "canonical_not_found",
            }
        )
        snapshot["commandLedger"][0].update(
            {
                "attemptState": "retry_wait",
                "localState": "submitted",
                "outboxState": "retry_wait",
                "draftState": "retry_wait",
            }
        )
        self.assertEqual(
            reconciled_command_snapshot_outcome(
                snapshot,
                "command-1",
                "message-1",
                "a" * 64,
            ),
            "retrying",
        )
        snapshot["outbox"].update(
            {
                "state": "superseded",
                "lastErrorCode": "stale_delivery_plan",
            }
        )
        snapshot["commandLedger"][0].update(
            {
                "attemptState": "superseded",
                "localState": "superseded",
                "outboxState": "superseded",
                "draftState": "draft",
            }
        )
        self.assertEqual(
            reconciled_command_snapshot_outcome(
                snapshot,
                "command-1",
                "message-1",
                "a" * 64,
            ),
            "terminal_superseded",
        )
        snapshot["commandLedger"].append(
            {
                "commandId": "command-2",
                "messageId": "message-1",
                "attemptState": "committed",
                "localState": "committed",
                "outboxState": "committed",
                "draftState": "accepted",
            }
        )
        self.assertEqual(
            reconciled_command_snapshot_outcome(
                snapshot,
                "command-1",
                "message-1",
                "a" * 64,
            ),
            "terminal_superseded",
        )

    def test_reconciled_command_snapshot_rejects_identity_or_byte_replacement(
        self,
    ) -> None:
        snapshot = {
            "messageId": "message-1",
            "projection": None,
            "intent": None,
            "outbox": {
                "state": "retry_wait",
                "lastErrorCode": "canonical_not_found",
                "commandSha256": "a" * 64,
            },
            "commandLedger": [
                {
                    "commandId": "command-1",
                    "messageId": "message-1",
                    "attemptState": "retry_wait",
                    "localState": "submitted",
                    "outboxState": "retry_wait",
                    "draftState": "retry_wait",
                }
            ],
        }

        self.assertIsNone(
            reconciled_command_snapshot_outcome(
                snapshot,
                "command-1",
                "message-1",
                "b" * 64,
            )
        )
        snapshot["commandLedger"][0]["commandId"] = "replacement-command"
        self.assertIsNone(
            reconciled_command_snapshot_outcome(
                snapshot,
                "command-1",
                "message-1",
                "a" * 64,
            )
        )

    def test_submitted_command_fixture_requires_exact_pending_state(self) -> None:
        snapshot = {
            "messageId": "message-1",
            "projection": None,
            "outbox": {
                "state": "submitted",
                "lastErrorCode": "",
                "commandSha256": "a" * 64,
            },
            "commandLedger": [
                {
                    "commandId": "command-1",
                    "messageId": "message-1",
                    "attemptState": "submitted",
                    "localState": "submitted",
                    "outboxState": "submitted",
                    "draftState": "submitted",
                }
            ],
        }

        self.assertTrue(
            submitted_command_snapshot_is_exact(
                snapshot,
                "command-1",
                "message-1",
            )
        )
        snapshot["commandLedger"][0]["localState"] = "superseded"
        self.assertFalse(
            submitted_command_snapshot_is_exact(
                snapshot,
                "command-1",
                "message-1",
            )
        )

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
                "worktree": (
                    "/workspace/peers-chat-high-chat"
                    if actor == "alice"
                    else "/workspace/peers-group-chat"
                ),
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

    def test_current_profile_gate_accepts_verified_existing_fixture(self) -> None:
        manifest = self.valid_report()["manifest"]
        actors = {
            "initialState": "existing",
            "actors": [
                {
                    "role": actor,
                    "accountRef": f"station-account:{actor}@p.t",
                    "ptid": f"ptid:{actor}",
                }
                for actor in ("alice", "bob")
            ],
            "reset": {"authorized": False, "targetVerified": True},
        }
        gate = NativeTwoClientGate(
            manifest=manifest,
            actor_manifest=actors,
            runtime_binding=SyntheticRuntimeBinding(),  # type: ignore[arg-type]
            gate_id=CURRENT_PROFILE_GATE_ID,
            allow_existing_fixture=True,
        )

        self.assertTrue(gate.verify_fixture_ready())
        self.assertEqual(gate.direction_order, ["bob", "alice"])

    def test_submitted_recovery_uses_current_profile_contract(self) -> None:
        manifest = self.valid_report()["manifest"]
        actors = {
            "initialState": "existing",
            "actors": [
                {
                    "role": actor,
                    "accountRef": f"station-account:{actor}@p.t",
                    "ptid": f"ptid:{actor}",
                }
                for actor in ("alice", "bob")
            ],
            "reset": {"authorized": False, "targetVerified": True},
        }
        gate = NativeTwoClientGate(
            manifest=manifest,
            actor_manifest=actors,
            runtime_binding=SyntheticRuntimeBinding(),  # type: ignore[arg-type]
            gate_id=SUBMITTED_COMMAND_RECOVERY_GATE_ID,
            allow_existing_fixture=True,
        )

        self.assertTrue(is_current_profile_gate(CURRENT_PROFILE_GATE_ID))
        self.assertTrue(is_current_profile_gate(SUBMITTED_COMMAND_RECOVERY_GATE_ID))
        self.assertFalse(is_current_profile_gate(self.module.GATE_ID))
        self.assertEqual(gate.direction_order, ["bob", "alice"])
        self.assertIn(
            "submitted_command_fixture_exact",
            SUBMITTED_COMMAND_RECOVERY_REQUIRED_ASSERTIONS,
        )
        source = (
            Path(__file__).with_name("native_two_client_runner.py")
            .read_text(encoding="utf-8")
        )
        fixture = source.index('"command.reconciliation.fixture"')
        activation = source.index('"command.reconciliation.activate"', fixture)
        convergence = source.index(
            '"command.reconciliation",',
            activation + len('"command.reconciliation.activate"'),
        )
        self.assertLess(fixture, activation)
        self.assertLess(activation, convergence)

    def test_submitted_recovery_can_bind_a_fresh_restorable_command(self) -> None:
        manifest = self.valid_report()["manifest"]
        actors = {
            "initialState": "existing",
            "actors": [
                {
                    "role": actor,
                    "accountRef": f"station-account:{actor}@p.t",
                    "ptid": f"ptid:{actor}",
                }
                for actor in ("alice", "bob")
            ],
            "reset": {"authorized": False, "targetVerified": True},
        }
        gate = NativeTwoClientGate(
            manifest=manifest,
            actor_manifest=actors,
            runtime_binding=SyntheticRuntimeBinding(),  # type: ignore[arg-type]
            gate_id=SUBMITTED_COMMAND_RECOVERY_GATE_ID,
            allow_existing_fixture=True,
        )
        gate.clients = {"alice": object(), "bob": object()}  # type: ignore[assignment]
        gate.ptids = {"alice": "ptid:alice", "bob": "ptid:bob"}
        environment = {
            "PT_CHAT_NATIVE_CREATE_RESTORABLE_COMMAND": "1",
            "PT_CHAT_NATIVE_EXPECTED_RECONCILIATION_ACTOR": "alice",
            "PT_CHAT_NATIVE_EXPECTED_RECONCILIATION_CONVERSATION_ID": "conversation-1",
            "PT_CHAT_NATIVE_EXPECTED_RECONCILIATION_MESSAGE_ID": "",
            "PT_CHAT_NATIVE_EXPECTED_RECONCILIATION_COMMAND_ID": "",
            "PT_CHAT_NATIVE_EXPECTED_RECONCILIATION_OUTCOME": "accepted",
            "PT_CHAT_NATIVE_RESTORABLE_COMMAND_PLAINTEXT": "recover me",
        }
        with (
            patch.dict(os.environ, environment, clear=False),
            patch(
                "tooling.acceptance.gates.chat.native_two_client_runner.async_harness",
                return_value={
                    "messageId": "message-1",
                    "commandId": "command-1",
                    "snapshot": {},
                },
            ) as harness,
        ):
            target = gate.create_restorable_command_target()

        self.assertEqual(
            target,
            {
                "actor": "alice",
                "conversationId": "conversation-1",
                "messageId": "message-1",
                "commandId": "command-1",
                "outcome": "accepted",
            },
        )
        self.assertEqual(gate.expected_reconciliation_target(), target)
        self.assertEqual(
            gate.report.runtime["createdSubmittedCommand"]["plaintextSha256"],
            "bc54d1d8c0a99336ea2c89cccee81d1545b9e5c10791b3e5a7140803035213fb",
        )
        harness.assert_called_once()

    def test_current_profile_accepts_cross_worktree_group_initiator(self) -> None:
        report = self.valid_report()
        source_commit = "a" * 40
        report["manifest"]["source"]["commit"] = source_commit
        for client in report["manifest"]["clients"]:
            client["storage_lifecycle"] = "persistent"
        report["runtime"]["launchOrder"] = ["bob", "alice"]
        report["runtime"]["directionOrder"] = ["bob", "alice"]
        report["runtime"]["persistentDeviceState"] = {
            actor: {
                "storageRoot": f"/tmp/{actor}",
                "storageLifecycle": "persistent",
            }
            for actor in ("alice", "bob")
        }
        report["runtime"]["worktreeTopology"] = {
            "alice": {
                "clientId": "alice",
                "logicalName": "peers-chat-high-chat",
                "expectedLogicalName": "peers-chat-high-chat",
                "workspaceId": "1" * 16,
                "repositoryId": "3" * 16,
                "canonicalRoot": "/workspace/peers-chat-high-chat",
                "head": "b" * 40,
                "tree": "c" * 40,
                "clean": True,
            },
            "bob": {
                "clientId": "bob",
                "logicalName": "peers-group-chat",
                "expectedLogicalName": "peers-group-chat",
                "workspaceId": "2" * 16,
                "repositoryId": "3" * 16,
                "canonicalRoot": "/workspace/peers-group-chat",
                "head": source_commit,
                "tree": "c" * 40,
                "clean": True,
            },
        }
        report["assertions"].extend(
            {
                "name": name,
                "passed": True,
                "detail": "",
            }
            for name in CURRENT_PROFILE_REQUIRED_ASSERTIONS
        )

        validate_current_profile_topology(report)

    def test_current_profile_rejects_ephemeral_device_state(self) -> None:
        report = self.valid_report()
        source_commit = "a" * 40
        report["manifest"]["source"]["commit"] = source_commit
        report["runtime"]["launchOrder"] = ["bob", "alice"]
        report["runtime"]["directionOrder"] = ["bob", "alice"]
        report["runtime"]["worktreeTopology"] = {
            "alice": {
                "clientId": "alice",
                "logicalName": "peers-chat-high-chat",
                "expectedLogicalName": "peers-chat-high-chat",
                "workspaceId": "1" * 16,
                "repositoryId": "3" * 16,
                "canonicalRoot": "/workspace/peers-chat-high-chat",
                "head": "b" * 40,
                "tree": "c" * 40,
                "clean": True,
            },
            "bob": {
                "clientId": "bob",
                "logicalName": "peers-group-chat",
                "expectedLogicalName": "peers-group-chat",
                "workspaceId": "2" * 16,
                "repositoryId": "3" * 16,
                "canonicalRoot": "/workspace/peers-group-chat",
                "head": source_commit,
                "tree": "c" * 40,
                "clean": True,
            },
        }
        report["runtime"]["persistentDeviceState"] = {
            actor: {
                "storageRoot": f"/tmp/{actor}",
                "storageLifecycle": "ephemeral",
            }
            for actor in ("alice", "bob")
        }
        report["assertions"].extend(
            {
                "name": name,
                "passed": True,
                "detail": "",
            }
            for name in CURRENT_PROFILE_REQUIRED_ASSERTIONS
        )

        with self.assertRaisesRegex(
            RuntimeError,
            "persistent device state",
        ):
            validate_current_profile_topology(report)

    def test_current_profile_rejects_same_worktree_evidence(self) -> None:
        report = self.valid_report()
        source_commit = "a" * 40
        report["manifest"]["source"]["commit"] = source_commit
        report["manifest"]["clients"][0]["worktree"] = (
            "/workspace/peers-group-chat"
        )
        report["runtime"]["launchOrder"] = ["bob", "alice"]
        report["runtime"]["directionOrder"] = ["bob", "alice"]
        report["runtime"]["worktreeTopology"] = {
            actor: {
                "clientId": actor,
                "logicalName": (
                    "peers-chat-high-chat"
                    if actor == "alice"
                    else "peers-group-chat"
                ),
                "expectedLogicalName": (
                    "peers-chat-high-chat"
                    if actor == "alice"
                    else "peers-group-chat"
                ),
                "workspaceId": "2" * 16,
                "repositoryId": "3" * 16,
                "canonicalRoot": "/workspace/peers-group-chat",
                "head": source_commit,
                "tree": "c" * 40,
                "clean": True,
            }
            for actor in ("alice", "bob")
        }

        with self.assertRaisesRegex(RuntimeError, "distinct worktrees"):
            validate_current_profile_topology(report)

    def test_current_profile_rejects_high_chat_initiator(self) -> None:
        report = self.valid_report()
        source_commit = "a" * 40
        report["manifest"]["source"]["commit"] = source_commit
        report["runtime"]["launchOrder"] = ["alice", "bob"]
        report["runtime"]["directionOrder"] = ["alice", "bob"]
        report["runtime"]["worktreeTopology"] = {
            "alice": {
                "clientId": "alice",
                "logicalName": "peers-chat-high-chat",
                "expectedLogicalName": "peers-chat-high-chat",
                "workspaceId": "1" * 16,
                "repositoryId": "3" * 16,
                "canonicalRoot": "/workspace/peers-chat-high-chat",
                "head": "b" * 40,
                "tree": "c" * 40,
                "clean": True,
            },
            "bob": {
                "clientId": "bob",
                "logicalName": "peers-group-chat",
                "expectedLogicalName": "peers-group-chat",
                "workspaceId": "2" * 16,
                "repositoryId": "3" * 16,
                "canonicalRoot": "/workspace/peers-group-chat",
                "head": source_commit,
                "tree": "c" * 40,
                "clean": True,
            },
        }

        with self.assertRaisesRegex(
            RuntimeError,
            "must launch and initiate",
        ):
            validate_current_profile_topology(report)

    def test_client_readiness_requires_active_station_device(self) -> None:
        runner_source = (
            REPO_ROOT
            / "tooling"
            / "acceptance"
            / "gates"
            / "chat"
            / "native_two_client_runner.py"
        ).read_text(encoding="utf-8")
        harness_source = (
            REPO_ROOT
            / "apps"
            / "desktop"
            / "src"
            / "acceptance"
            / "chat"
            / "harness.ts"
        ).read_text(encoding="utf-8")

        self.assertIn('current.get("active") is not True', runner_source)
        self.assertIn("imServiceV1.device.list()", harness_source)
        self.assertIn("ActorDeviceStatus.ACTIVE", harness_source)

    def test_desktop_hydration_preserves_conversation_members(self) -> None:
        lifecycle_source = (
            REPO_ROOT
            / "apps"
            / "desktop"
            / "src-tauri"
            / "src"
            / "messaging"
            / "lifecycle.rs"
        ).read_text(encoding="utf-8")
        gateway_source = (
            REPO_ROOT
            / "apps"
            / "desktop"
            / "src-tauri"
            / "src"
            / "interface"
            / "http_gateway"
            / "mod.rs"
        ).read_text(encoding="utf-8")

        self.assertIn('"/conversation/members"', lifecycle_source)
        self.assertIn("GetConversationMembersResponse", lifecycle_source)
        self.assertNotIn(
            "members: Vec::<ConversationMemberProjection>::new()",
            lifecycle_source,
        )
        self.assertIn(
            "hydrate_projections_from_station(&engine, &token)",
            gateway_source,
        )

    def test_prekey_publication_reconciles_station_inventory(self) -> None:
        core_source = (
            REPO_ROOT
            / "packages"
            / "messaging-core"
            / "src"
            / "crypto"
            / "prekeys.rs"
        ).read_text(encoding="utf-8")
        transport_source = (
            REPO_ROOT
            / "apps"
            / "desktop"
            / "src-tauri"
            / "src"
            / "messaging"
            / "prekeys.rs"
        ).read_text(encoding="utf-8")
        store_source = (
            REPO_ROOT
            / "apps"
            / "desktop"
            / "src-tauri"
            / "src"
            / "messaging"
            / "store.rs"
        ).read_text(encoding="utf-8")
        station_store_source = (
            REPO_ROOT
            / "apps"
            / "station"
            / "app"
            / "subserver"
            / "key_exchange"
            / "infrastructure"
            / "canonical_store.go"
        ).read_text(encoding="utf-8")

        self.assertIn("pending_prekey_replenishment", core_source)
        self.assertIn("RemotePreKeyInventory::MissingBundle", core_source)
        self.assertIn("transport.replenish(&replenish_request)", core_source)
        self.assertIn('"/key-exchange/keys/count"', transport_source)
        self.assertIn('"/key-exchange/keys/replenish"', transport_source)
        self.assertIn("'awaiting_replenishment'", store_source)
        self.assertIn(
            "state IN ('available', 'awaiting_replenishment')",
            store_source,
        )
        self.assertIn("requireCompleteDirectBundle", station_store_source)

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

    def test_visible_evidence_defers_mutable_app_log_until_cleanup(self) -> None:
        client = object()
        saved_logs: list[str] = []
        gate = object.__new__(NativeTwoClientGate)
        gate.clients = {"alice": client}
        gate.save_screenshot = lambda _client, _actor: None
        gate.save_dom = lambda _client, _actor: None
        gate.save_app_log = (
            lambda _client, actor: saved_logs.append(actor)
        )

        gate.collect_client_evidence("alice")

        self.assertEqual(saved_logs, [])

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
        timeline = (
            root
            / "apps/desktop/src/components/chat/message/ChatMessageTimeline.tsx"
        ).read_text(encoding="utf-8")
        timeline_policy = (
            root
            / "apps/desktop/src/components/chat/message/chatMessageTimelinePolicy.ts"
        ).read_text(encoding="utf-8")
        message_area = (
            root / "apps/desktop/src/components/chat/ChatMessageArea.tsx"
        ).read_text(encoding="utf-8")
        avatar = (
            root / "apps/desktop/src/components/common/SquareAvatar.tsx"
        ).read_text(encoding="utf-8")
        social_chat = (
            root / "apps/desktop/src/store/socialChat.ts"
        ).read_text(encoding="utf-8")
        profile_projection = (
            root / "apps/desktop/src/store/socialProfileProjection.ts"
        ).read_text(encoding="utf-8")
        message_store = (
            root / "apps/desktop/src-tauri/src/messaging/store.rs"
        ).read_text(encoding="utf-8")
        federation_resolver = (
            root
            / "apps/station/frame/touch/federation/resolver/resolver.go"
        ).read_text(encoding="utf-8")
        actor_seed = (
            root / "apps/station/frame/touch/actor/seed.go"
        ).read_text(encoding="utf-8")
        actor_config = (
            root / "apps/station/app/conf/actor.yml"
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
        self.assertIn('"federationContext"', runner)
        self.assertIn('"federationId": federation_id', runner)
        self.assertIn(
            "Alice and Bob have no shared Federation",
            runner,
        )
        self.assertIn("async federationContext()", harness)
        self.assertIn(
            'received.get("messageUlid") == sent.get("messageUlid")',
            runner,
        )
        self.assertIn("def message_composer_geometry(", runner)
        self.assertIn("timelineFlexShrink", runner)
        self.assertIn("row[\"bottom\"] <= composer[\"top\"] - 8", runner)
        self.assertIn("def prove_demo_avatar_sources(", runner)
        self.assertIn('"avatar.bundled"', runner)
        self.assertIn('"message.layout"', runner)
        direction = runner.split(
            "    def prove_direction(",
            maxsplit=1,
        )[1].split(
            "    def prove_demo_avatar_sources(",
            maxsplit=1,
        )[0]
        self.assertLess(
            direction.index('"message.layout"'),
            direction.index('"message.received"'),
        )
        self.assertIn("data-chat-message-timeline", timeline)
        self.assertIn("chatMessageTimelineContainerStyle", timeline)
        self.assertIn("behavior: 'auto'", timeline_policy)
        self.assertIn("useLayoutEffect", message_area)
        self.assertIn(
            "scrollIntoView(chatMessageTailScrollOptions())",
            message_area,
        )
        self.assertIn("RETIRED_GENERATED_AVATAR_PREFIX", avatar)
        self.assertIn("inlineAvatarSource", avatar)
        self.assertNotIn("copilot-cn.bytedance.net", actor_config)
        avatar_payloads = re.findall(
            r'^\s*avatar: "data:image/svg\+xml;base64,([^"]+)"',
            actor_config,
            flags=re.MULTILINE,
        )
        self.assertEqual(len(avatar_payloads), 3)
        for payload in avatar_payloads:
            svg = base64.b64decode(payload, validate=True).decode("utf-8")
            self.assertIn('<rect width="128" height="128" fill="', svg)
            self.assertNotIn('rx="64"', svg)
        legacy_payloads = re.findall(
            r'^\s*-\s+"data:image/svg\+xml;base64,([^"]+)"',
            actor_config,
            flags=re.MULTILINE,
        )
        self.assertEqual(len(legacy_payloads), 3)
        for payload in legacy_payloads:
            svg = base64.b64decode(payload, validate=True).decode("utf-8")
            self.assertIn('rx="64"', svg)
        self.assertIn("is_bundled_square_avatar", runner)
        self.assertIn("len({", runner)
        self.assertIn("remoteProfileHandle", profile_projection)
        self.assertIn("accountProfileFromFederationResolve", profile_projection)
        self.assertIn("await api.federationResolve(federatedHandle)", social_chat)
        self.assertIn("merge_message_projection_rows", message_store)
        self.assertNotIn("CacheVerifiedRemoteDeviceSigningKeys", federation_resolver)
        self.assertNotIn("migrateLegacyPresetAvatarRows", actor_seed)
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
