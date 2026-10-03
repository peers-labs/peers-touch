from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from unittest import mock
from contextlib import AbstractContextManager, redirect_stderr
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.schema_activation import (
    AGGREGATE_RESULT_KIND,
    CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME,
    CROSS_STATION_SOCIAL_OWNER,
    DATABASE_TARGET_SPECS,
    JOURNAL_STATES,
    PLAN_ID,
    PLAN_PATH,
    PROFILE_ORDER,
    PROFILE_TARGETS,
    SCHEMA_VERSION,
    SECURE_CONTENT_OWNER,
    ArtifactConflict,
    BoundaryUnavailable,
    DevelopmentSessionSourceCheckpointRunner,
    LeaseWrappedSSHMaintenanceBoundary,
    ResetIncomplete,
    SchemaActivationOwner,
    ValidationError,
    _LeaseWrappedSSHSession,
    _parser,
    _require_timestamp,
    _resume_skips_quiescence,
    _timestamp,
    canonical_digest,
    validate_completed_journal,
    validate_reset_invocation,
    validate_reset_manifest,
    write_immutable_json,
)


COMMIT = "8" * 40
WORKSPACE_ID = "9eb2cb904c9ae460"
AT = datetime(2026, 9, 19, 10, 0, tzinfo=timezone.utc)


def seal(value: Mapping[str, Any], field: str) -> dict[str, Any]:
    result = dict(value)
    result[field] = canonical_digest(result)
    return result


def timestamp(offset: int = 0) -> str:
    return (AT + timedelta(seconds=offset)).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")


def source_receipt(
    declaration_digest: str,
    *,
    source_commit: str = COMMIT,
    plan_id: str = PLAN_ID,
    task_id: str = "W12D",
) -> dict[str, Any]:
    return seal(
        {
            "kind": "source-checkpoint-publication-receipt",
            "state": "COMPLETE",
            "purpose": "SOURCE_OWNER_CHECKPOINT",
            "checkpoint_id": "w12d-source-checkpoint",
            "plan_id": plan_id,
            "task_id": task_id,
            "workspace_id": WORKSPACE_ID,
            "source_commit": source_commit,
            "source_tree": "8" * 40,
            "session_event_digest": "9" * 64,
            "declaration_digest": declaration_digest,
            "completed_at": timestamp(),
        },
        "receipt_digest",
    )


def public_snapshot(profile_id: str) -> dict[str, Any]:
    value = {
        "schema_version": SCHEMA_VERSION,
        "profile_id": profile_id,
        "public_post_schema_digest": "1" * 64,
        "public_post_rows_digest": "2" * 64,
        "public_comment_rows_digest": "3" * 64,
        "public_reaction_rows_digest": "4" * 64,
        "public_object_metadata_digest": "5" * 64,
        "public_object_bytes_digest": "6" * 64,
        "counts": {
            "public_comments": 3,
            "public_objects": 1,
            "public_posts": 2,
            "public_reactions": 4,
        },
    }
    return seal(value, "snapshot_digest")


def database_targets() -> list[dict[str, Any]]:
    result = []
    for spec in DATABASE_TARGET_SPECS:
        target = {
            "table": spec.table,
            "operation": spec.operation,
            "expected_schema_before_digest": hashlib.sha256(
                f"{spec.table}:{spec.operation}".encode()
            ).hexdigest(),
            "expected_row_count": 0,
        }
        if spec.predicate is not None:
            target["predicate"] = spec.predicate
        result.append(target)
    return result


def reset_manifest(request: Mapping[str, Any]) -> dict[str, Any]:
    value = {
        "schema_version": SCHEMA_VERSION,
        "reset_id": request["reset_id"],
        "reset_intent": request["reset_intent"],
        "source_commit": request["source_commit"],
        "workspace_id": request["workspace_id"],
        "profile_id": request["profile_id"],
        "deployment_environment": request["deployment_environment"],
        "destructive_scope": request["destructive_scope"],
        "database_identity_digest": "7" * 64,
        "public_snapshot_before": public_snapshot(str(request["profile_id"])),
        "database_targets": database_targets(),
        "canonical_private_object_targets": [],
        "legacy_oss_object_targets": [],
        "out_of_scope_table_names": ["accounts", "conversation_events"],
        "created_at": timestamp(),
    }
    return seal(value, "manifest_digest")


def completed_journal(
    invocation: Mapping[str, Any],
    *,
    complete: bool = True,
    completed_offset: int = 10,
) -> dict[str, Any]:
    return reset_journal(
        [invocation],
        current_state="COMPLETE" if complete else "PREPARED",
        completed_offset=completed_offset,
    )


def reset_journal(
    invocations: list[Mapping[str, Any]],
    *,
    current_state: str,
    completed_offset: int = 10,
) -> dict[str, Any]:
    state_index = JOURNAL_STATES.index(current_state)
    transitions = []
    for index in range(state_index):
        transitions.append(
            seal(
                {
                    "from_state": JOURNAL_STATES[index],
                    "to_state": JOURNAL_STATES[index + 1],
                    "transitioned_at": timestamp(completed_offset + index),
                },
                "transition_digest",
            )
        )
    value = {
        "schema_version": SCHEMA_VERSION,
        "reset_manifest_digest": invocations[0]["reset_manifest_digest"],
        "current_state": current_state,
        "accepted_invocations": [
            {
                "invocation_id": invocation["invocation_id"],
                "invocation_digest": invocation["invocation_digest"],
                "accepted_at": timestamp(completed_offset + index),
            }
            for index, invocation in enumerate(invocations)
        ],
        "transitions": transitions,
        "failure": None,
    }
    return value


def schema_attestation(
    request: Mapping[str, Any],
    manifest: Mapping[str, Any],
    journal: Mapping[str, Any],
) -> dict[str, Any]:
    value = {
        "schema_version": SCHEMA_VERSION,
        "source_commit": manifest["source_commit"],
        "workspace_id": manifest["workspace_id"],
        "profile_id": manifest["profile_id"],
        "deployment_environment": manifest["deployment_environment"],
        "destructive_scope": manifest["destructive_scope"],
        "station_service_id": f"service-{manifest['profile_id']}",
        "station_peer_id": f"peer-{manifest['profile_id']}",
        "station_runtime_identity": f"runtime-{manifest['profile_id']}",
        "service_attestation_digest": "9" * 64,
        "reset_intent": manifest["reset_intent"],
        "reset_manifest_digest": manifest["manifest_digest"],
        "completed_journal_digest": canonical_digest(journal),
        "canonical_private_schema_digest": "a" * 64,
        "retired_columns_absent": True,
        "public_snapshot_digest": manifest["public_snapshot_before"][
            "snapshot_digest"
        ],
        "created_at": timestamp(20),
    }
    return seal(value, "attestation_digest")


class FakeSourceRunner:
    def __init__(self, declaration_digest: str) -> None:
        self.declaration_digest = declaration_digest
        self.requests: list[Mapping[str, Any]] = []
        self.override: Mapping[str, Any] | None = None

    def __call__(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> Mapping[str, Any]:
        self.requests.append(copy.deepcopy(request))
        if self.override is not None:
            return self.override
        self.requests[-1] = {**self.requests[-1], "observed_budget": budget_seconds}
        return source_receipt(
            self.declaration_digest,
            plan_id=str(request["plan_id"]),
            task_id=str(request["task_id"]),
        )


class FakeSession(AbstractContextManager["FakeSession"]):
    def __init__(
        self,
        boundary: "FakeMaintenanceBoundary",
        request: Mapping[str, Any],
    ) -> None:
        self.boundary = boundary
        self.request = copy.deepcopy(request)
        self.manifest = reset_manifest(request)
        self.invocations: list[Mapping[str, Any]] = []

    def __enter__(self) -> "FakeSession":
        if self.boundary.active:
            raise AssertionError("maintenance sessions overlapped")
        self.boundary.active = True
        self.boundary.events.append(("open", self.request["profile_id"]))
        return self

    def prepare(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        self.boundary.events.append(("prepare", request["profile_id"]))
        manifest = copy.deepcopy(self.manifest)
        if self.boundary.change_manifest:
            manifest["database_identity_digest"] = "b" * 64
            manifest["manifest_digest"] = canonical_digest(
                {
                    key: value
                    for key, value in manifest.items()
                    if key != "manifest_digest"
                }
            )
        return manifest

    def invoke(self, invocation: Mapping[str, Any]) -> Mapping[str, Any]:
        self.boundary.events.append(("invoke", invocation["profile_id"]))
        self.boundary.invocations.append(copy.deepcopy(invocation))
        self.invocations.append(copy.deepcopy(invocation))
        reset_id = str(invocation["reset_id"])
        accepted = self.boundary.accepted_invocations.setdefault(
            reset_id,
            [],
        )
        previous_state = self.boundary.journal_states.get(reset_id)
        terminal_replay = previous_state == "COMPLETE"
        if terminal_replay:
            current_state = "COMPLETE"
            exact_replay = self.boundary.terminal_replay_exact_replay
        else:
            accepted.append(copy.deepcopy(invocation))
            before_deployment = previous_state in (None, "PREPARED")
            current_state = (
                self.boundary.first_state
                if before_deployment
                else self.boundary.second_state
            )
            self.boundary.journal_states[reset_id] = current_state
            exact_replay = (
                self.boundary.first_exact_replay
                if before_deployment
                else self.boundary.second_exact_replay
            )
        journal = reset_journal(
            accepted,
            current_state=current_state,
            completed_offset=10 + 30 * (int(invocation["profile_id"] == "fiveArm")),
        )
        result = {
            "schema_version": SCHEMA_VERSION,
            "reset_id": invocation["reset_id"],
            "state": current_state,
            "exact_replay": exact_replay,
            "needs_deployment": current_state == "OBJECTS_DELETED",
            "journal": journal,
            "journal_digest": canonical_digest(journal),
        }
        if current_state == "COMPLETE":
            result["attestation"] = schema_attestation(
                self.request,
                self.manifest,
                journal,
            )
            if self.boundary.lose_complete_response_once:
                self.boundary.lose_complete_response_once = False
                raise BoundaryUnavailable("maintenance response was lost")
        return result

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> bool:
        self.boundary.events.append(("close", self.request["profile_id"]))
        self.boundary.active = False
        return False


class FakeMaintenanceBoundary:
    def __init__(self) -> None:
        self.active = False
        self.first_state = "OBJECTS_DELETED"
        self.second_state = "COMPLETE"
        self.first_exact_replay = False
        self.second_exact_replay = False
        self.terminal_replay_exact_replay = True
        self.change_manifest = False
        self.lose_complete_response_once = False
        self.events: list[tuple[str, str]] = []
        self.invocations: list[Mapping[str, Any]] = []
        self.accepted_invocations: dict[str, list[Mapping[str, Any]]] = {}
        self.journal_states: dict[str, str] = {}
        self.requests: list[Mapping[str, Any]] = []

    def open(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> AbstractContextManager[FakeSession]:
        self.requests.append({**copy.deepcopy(request), "budget_seconds": budget_seconds})
        return FakeSession(self, request)


class FakeStationDeploymentRunner:
    def __init__(self, boundary: FakeMaintenanceBoundary) -> None:
        self.boundary = boundary
        self.fail = False
        self.requests: list[Mapping[str, Any]] = []

    def __call__(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> None:
        self.requests.append(
            {**copy.deepcopy(request), "budget_seconds": budget_seconds}
        )
        self.boundary.events.append(("deploy", request["profile_id"]))
        if self.fail:
            raise BoundaryUnavailable("reviewed Station deployment failed")

class FakeStationQuiescenceRunner:
    def __init__(self, boundary: FakeMaintenanceBoundary) -> None:
        self.boundary = boundary
        self.requests: list[Mapping[str, Any]] = []
        self.fail = False

    def __call__(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> None:
        self.requests.append(
            {**copy.deepcopy(request), "budget_seconds": budget_seconds}
        )
        self.boundary.events.append(("requiesce", request["profile_id"]))
        if self.fail:
            raise BoundaryUnavailable("Station re-quiescence failed")


class SchemaActivationOwnerTest(unittest.TestCase):
    def test_accepts_go_rfc3339nano_fraction_widths(self) -> None:
        for value in (
            "2026-09-20T16:28:09.7Z",
            "2026-09-20T16:28:09.77995Z",
            "2026-09-20T16:28:09.620087Z",
            "2026-09-20T16:28:09.620087123Z",
        ):
            parsed = _require_timestamp(value, "transitioned_at")
            self.assertEqual(timezone.utc, parsed.tzinfo)

        with self.assertRaises(ValidationError):
            _require_timestamp(
                "2026-09-20T16:28:09.1234567890Z",
                "transitioned_at",
            )

    def test_timestamp_is_python_39_iso_compatible(self) -> None:
        value = _timestamp(
            datetime(
                2026,
                9,
                20,
                2,
                34,
                10,
                703370,
                tzinfo=timezone.utc,
            )
        )

        self.assertEqual(value, "2026-09-20T02:34:10.703Z")
        self.assertEqual(
            datetime.fromisoformat(value.replace("Z", "+00:00")),
            datetime(
                2026,
                9,
                20,
                2,
                34,
                10,
                703000,
                tzinfo=timezone.utc,
            ),
        )

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.repo_root = self.root / "repo"
        self.result_root = self.root / "evidence"
        self.repo_root.mkdir()
        self.identity = {
            "root": str(self.repo_root),
            "workspaceId": WORKSPACE_ID,
            "branch": "feat/federation",
            "head": COMMIT,
        }
        self.declarations = {
            "secure-content-w12d": self._declaration(
                "secure-content-w12d",
                "W12D",
                "c" * 64,
            ),
            "secure-content-w12a-four": self._profile_declaration(
                "secure-content-w12a-four",
                "W12D",
                "d" * 64,
                "four",
            ),
            "secure-content-w12a-five-arm": self._profile_declaration(
                "secure-content-w12a-five-arm",
                "W12D",
                "e" * 64,
                "fiveArm",
            ),
            "secure-content-w12-four": self._profile_declaration(
                "secure-content-w12-four",
                "W12",
                "f" * 64,
                "four",
            ),
            "secure-content-w12-five-arm": self._profile_declaration(
                "secure-content-w12-five-arm",
                "W12",
                "0" * 64,
                "fiveArm",
            ),
        }
        self.source_runner = FakeSourceRunner("c" * 64)
        self.boundary = FakeMaintenanceBoundary()
        self.deployment_runner = FakeStationDeploymentRunner(self.boundary)
        self.quiescence_runner = FakeStationQuiescenceRunner(self.boundary)
        self.ids = iter(
            [
                "invocation-four-1",
                "invocation-four-2",
                "invocation-five-1",
                "invocation-five-2",
                "invocation-final-four-1",
                "invocation-final-four-2",
                "invocation-final-five-1",
                "invocation-final-five-2",
                "invocation-resume-1",
                "invocation-resume-2",
                "invocation-resume-3",
                "invocation-resume-4",
            ]
        )
        self.owner = self._owner()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _declaration(
        self,
        work_item_id: str,
        task_id: str,
        digest: str,
        *,
        owner=SECURE_CONTENT_OWNER,
    ) -> dict[str, Any]:
        return {
            "declarationId": f"{work_item_id}-{WORKSPACE_ID}",
            "declarationDigest": digest,
            "workItemId": work_item_id,
            "planId": owner.plan_id,
            "planPath": owner.plan_path,
            "taskId": task_id,
            "journeyId": owner.journey_id,
            "workspaceId": WORKSPACE_ID,
            "branch": "feat/federation",
            "sourceHead": COMMIT,
            "state": "ACTIVE",
            "runtimeClaims": [],
        }

    def _profile_declaration(
        self,
        work_item_id: str,
        task_id: str,
        digest: str,
        profile_id: str,
        *,
        owner=SECURE_CONTENT_OWNER,
    ) -> dict[str, Any]:
        target = PROFILE_TARGETS[profile_id]
        value = self._declaration(
            work_item_id,
            task_id,
            digest,
            owner=owner,
        )
        value["runtimeClaims"] = [
            {"kind": "profile", "resourceId": profile_id, "mode": "shared"},
            {
                "kind": "station.connect",
                "resourceId": profile_id,
                "mode": "shared",
            },
            {
                "kind": "station.deploy",
                "resourceId": target.deployment_environment,
                "mode": "exclusive",
            },
            {
                "kind": "station.reset",
                "resourceId": target.destructive_scope,
                "mode": "exclusive",
            },
            {
                "kind": "fixture",
                "resourceId": f"schema-{profile_id}",
                "mode": "exclusive",
            },
        ]
        return value

    def _owner(
        self,
        *,
        profile_declaration_loader: Any = None,
    ) -> SchemaActivationOwner:
        return SchemaActivationOwner(
            repo_root=self.repo_root,
            result_root=self.result_root,
            identity_loader=lambda: copy.deepcopy(self.identity),
            declaration_loader=lambda item: copy.deepcopy(self.declarations[item]),
            profile_declaration_loader=profile_declaration_loader,
            clean_checker=lambda: None,
            source_checkpoint_runner=self.source_runner,
            maintenance_boundary=self.boundary,
            station_deployment_runner=self.deployment_runner,
            station_quiescence_runner=self.quiescence_runner,
            clock=lambda: AT,
            id_factory=lambda: next(self.ids),
        )

    def _freeze(self) -> Mapping[str, Any]:
        return self.owner.source_freeze(
            generation_id=COMMIT,
            budget_seconds=7200,
        )

    def _run(
        self,
        profile_id: str,
        *,
        intent: str = "SCHEMA_ACTIVATION",
        reset_id: str | None = None,
    ) -> Mapping[str, Any]:
        target = PROFILE_TARGETS[profile_id]
        workstream = (
            target.activation_workstream_id
            if intent == "SCHEMA_ACTIVATION"
            else target.final_workstream_id
        )
        return self.owner.run_profile(
            workstream_id=workstream,
            profile_id=profile_id,
            intent=intent,
            generation_id=COMMIT,
            budget_seconds=3600,
            reset_id=reset_id or f"reset-{intent.lower()}-{profile_id}",
        )

    def test_source_freeze_writes_private_immutable_receipt_and_result(self) -> None:
        result = self._freeze()

        self.assertEqual("PASS", result["status"])
        self.assertEqual(COMMIT, result["generation_id"])
        self.assertEqual("W12D", result["workstream_id"])
        source_directory = self.result_root / "W12A" / "source" / COMMIT
        self.assertEqual(
            0o600,
            (source_directory / "result.json").stat().st_mode & 0o777,
        )
        self.assertEqual(
            0o600,
            (source_directory / "source-checkpoint-receipt.json").stat().st_mode
            & 0o777,
        )
        self.assertEqual(
            "SOURCE_OWNER_CHECKPOINT",
            self.source_runner.requests[0]["purpose"],
        )
        with self.assertRaises(ArtifactConflict):
            self._freeze()
        self.assertEqual(1, len(self.source_runner.requests))

    def test_source_freeze_uses_explicit_reopened_work_item(self) -> None:
        work_item_id = "secure-content-w12d-reopened"
        self.declarations[work_item_id] = self._declaration(
            work_item_id,
            "W12D",
            "1" * 64,
        )
        self.source_runner.declaration_digest = "1" * 64

        result = self.owner.source_freeze(
            generation_id=COMMIT,
            budget_seconds=7200,
            work_item_id=work_item_id,
        )

        self.assertEqual("PASS", result["status"])
        self.assertEqual(
            work_item_id,
            self.source_runner.requests[0]["work_item_id"],
        )
        self.assertEqual(
            self.declarations[work_item_id]["declarationDigest"],
            self.source_runner.requests[0]["declaration_digest"],
        )

    def test_source_checkpoint_reads_the_canonical_development_session(self) -> None:
        commands: list[list[str]] = []

        def command_runner(
            command: list[str],
            **_: Any,
        ) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps(
                    {
                        "status": "PASS",
                        "session": {
                            "eventDigest": "9" * 64,
                            "state": {
                                "state": "CHECKPOINTED",
                                "sessionId": "w12d-source-checkpoint",
                                "workItemId": "secure-content-w12d",
                                "planId": PLAN_ID,
                                "taskId": "W12D",
                                "workspaceId": WORKSPACE_ID,
                                "branch": "feat/federation",
                                "source": {
                                    "commit": COMMIT,
                                    "tree": "8" * 40,
                                    "branch": "feat/federation",
                                    "clean": True,
                                    "purpose": "development-runtime",
                                    "createdAt": timestamp(),
                                },
                            },
                        },
                    }
                ),
                stderr="",
            )

        receipt = DevelopmentSessionSourceCheckpointRunner(
            repo_root=self.repo_root,
            command_runner=command_runner,
        )(
            {
                "purpose": "SOURCE_OWNER_CHECKPOINT",
                "plan_id": PLAN_ID,
                "task_id": "W12D",
                "work_item_id": "secure-content-w12d",
                "workspace_id": WORKSPACE_ID,
                "branch": "feat/federation",
                "source_commit": COMMIT,
                "declaration_digest": "c" * 64,
            },
            budget_seconds=7200,
        )

        self.assertEqual(
            [
                "make",
                "dev-session-status",
                "WORK_ITEM=secure-content-w12d",
            ],
            commands[0],
        )
        self.assertEqual(COMMIT, receipt["source_commit"])
        self.assertEqual("8" * 40, receipt["source_tree"])
        self.assertEqual("9" * 64, receipt["session_event_digest"])
        self.assertNotIn("source_generation", receipt)
        self.assertNotIn("schema_version", receipt)

    def test_source_freeze_rejects_stale_or_malformed_checkpoint_receipt(self) -> None:
        self.source_runner.override = source_receipt(
            "c" * 64,
            source_commit="7" * 40,
        )

        with self.assertRaisesRegex(ValidationError, "source_commit"):
            self._freeze()

        self.assertFalse((self.result_root / "W12A").exists())

    def test_source_freeze_rejects_runtime_claims(self) -> None:
        self.declarations["secure-content-w12d"]["runtimeClaims"] = [
            {
                "kind": "station.reset",
                "resourceId": "station-four-social-private",
                "mode": "exclusive",
            }
        ]

        with self.assertRaisesRegex(ValidationError, "must not own runtime"):
            self._freeze()

    def test_cross_station_owner_binds_css_activation_without_aliasing_w12(
        self,
    ) -> None:
        descriptor = CROSS_STATION_SOCIAL_OWNER
        declarations = {
            descriptor.source_work_item_id: self._declaration(
                descriptor.source_work_item_id,
                descriptor.source_task_id,
                "1" * 64,
                owner=descriptor,
            )
        }
        for profile_id, binding in descriptor.activation_bindings.items():
            declarations[binding.work_item_id] = self._profile_declaration(
                binding.work_item_id,
                binding.task_id,
                ("2" if profile_id == "four" else "3") * 64,
                profile_id,
                owner=descriptor,
            )
        source_runner = FakeSourceRunner("1" * 64)
        owner = SchemaActivationOwner(
            repo_root=self.repo_root,
            result_root=self.result_root,
            owner_descriptor=descriptor,
            identity_loader=lambda: copy.deepcopy(self.identity),
            declaration_loader=lambda item: copy.deepcopy(declarations[item]),
            profile_declaration_loader=lambda item, _: copy.deepcopy(
                declarations[item]
            ),
            clean_checker=lambda: None,
            source_checkpoint_runner=source_runner,
            maintenance_boundary=self.boundary,
            station_deployment_runner=self.deployment_runner,
            station_quiescence_runner=self.quiescence_runner,
            clock=lambda: AT,
            id_factory=lambda: next(self.ids),
        )

        source = owner.source_freeze(
            generation_id=COMMIT,
            budget_seconds=1800,
        )
        four = owner.run_profile(
            workstream_id="CSS-SCHEMA-FOUR",
            profile_id="four",
            intent="SCHEMA_ACTIVATION",
            generation_id=COMMIT,
            budget_seconds=3600,
        )
        five_arm = owner.run_profile(
            workstream_id="CSS-SCHEMA-FIVEARM",
            profile_id="fiveArm",
            intent="SCHEMA_ACTIVATION",
            generation_id=COMMIT,
            budget_seconds=3600,
        )
        aggregate = owner.aggregate(
            intent="SCHEMA_ACTIVATION",
            generation_id=COMMIT,
            profiles=PROFILE_ORDER,
        )

        self.assertEqual(
            descriptor.source_workstream_id,
            source["workstream_id"],
        )
        self.assertEqual(
            descriptor.plan_id,
            source_runner.requests[0]["plan_id"],
        )
        self.assertEqual("CSS-SCHEMA-FOUR", four["workstream_id"])
        self.assertEqual("CSS-SCHEMA-FIVEARM", five_arm["workstream_id"])
        self.assertEqual(descriptor.source_task_id, aggregate["task_id"])
        self.assertTrue(
            (
                self.result_root
                / descriptor.source_evidence_root
                / "activation"
                / COMMIT
                / "aggregate"
                / "result.json"
            ).is_file()
        )
        self.assertFalse((self.result_root / "W12A").exists())
        with self.assertRaisesRegex(
            ValidationError,
            "does not support reset intent",
        ):
            owner.run_profile(
                workstream_id="W12F-FOUR",
                profile_id="four",
                intent="FINAL_CUT",
                generation_id=COMMIT,
                budget_seconds=3600,
            )

    def test_cross_station_owner_rejects_secure_content_declaration(self) -> None:
        owner = SchemaActivationOwner(
            repo_root=self.repo_root,
            result_root=self.result_root,
            owner_descriptor=CROSS_STATION_SOCIAL_OWNER,
            identity_loader=lambda: copy.deepcopy(self.identity),
            declaration_loader=lambda _: copy.deepcopy(
                self.declarations["secure-content-w12d"]
            ),
            clean_checker=lambda: None,
            source_checkpoint_runner=self.source_runner,
            maintenance_boundary=self.boundary,
            station_deployment_runner=self.deployment_runner,
            station_quiescence_runner=self.quiescence_runner,
            clock=lambda: AT,
        )

        with self.assertRaisesRegex(ValidationError, "declarationId"):
            owner.source_freeze(
                generation_id=COMMIT,
                budget_seconds=1800,
            )

    def test_cli_owner_selection_is_closed(self) -> None:
        self.assertEqual(
            "cross-station-social",
            _parser().parse_args(
                [
                    "--owner",
                    "cross-station-social",
                    "source-freeze",
                    "--generation-id",
                    COMMIT,
                    "--budget-seconds",
                    "1800",
                ]
            ).owner,
        )
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                _parser().parse_args(
                    [
                        "--owner",
                        "unknown",
                        "source-freeze",
                        "--generation-id",
                        COMMIT,
                        "--budget-seconds",
                        "1800",
                    ]
                )

    def test_owner_descriptor_must_match_the_closed_registry(self) -> None:
        with self.assertRaisesRegex(
            ValidationError,
            "not registered exactly",
        ):
            SchemaActivationOwner(
                repo_root=self.repo_root,
                result_root=self.result_root,
                owner_descriptor=replace(
                    CROSS_STATION_SOCIAL_OWNER,
                    plan_id="UNREVIEWED-PLAN",
                ),
                identity_loader=lambda: copy.deepcopy(self.identity),
            )

    def test_four_profile_writes_complete_immutable_artifact_set(self) -> None:
        self._freeze()
        result = self._run("four")

        self.assertEqual("CANONICAL_SCHEMA_ACTIVE_ONLY", result["claim"])
        self.assertEqual("W12A-FOUR", result["workstream_id"])
        self.assertEqual("W12D", result["task_id"])
        run_directory = (
            self.result_root
            / "W12A"
            / "activation"
            / COMMIT
            / "four"
            / "reset-schema_activation-four"
        )
        expected = {
            "reset-manifest.json",
            "completed-reset-journal.json",
            CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME,
            "result.json",
        }
        self.assertTrue(expected.issubset({path.name for path in run_directory.iterdir()}))
        invocation_directories = sorted((run_directory / "invocations").iterdir())
        self.assertEqual(
            ["invocation-four-1", "invocation-four-2"],
            [path.name for path in invocation_directories],
        )
        for invocation_directory in invocation_directories:
            self.assertTrue((invocation_directory / "request.json").is_file())
            self.assertTrue((invocation_directory / "response.json").is_file())
        self.assertEqual(
            [
                ("open", "four"),
                ("prepare", "four"),
                ("invoke", "four"),
                ("deploy", "four"),
                ("invoke", "four"),
                ("close", "four"),
            ],
            self.boundary.events,
        )
        first, second = self.boundary.invocations
        self.assertNotEqual(first["invocation_id"], second["invocation_id"])
        self.assertEqual(first["reset_id"], second["reset_id"])
        self.assertEqual(
            first["reset_manifest_digest"],
            second["reset_manifest_digest"],
        )
        self.assertEqual(
            "invocations/invocation-four-2/request.json",
            result["invocation_ref"]["path"].split(
                "reset-schema_activation-four/",
                maxsplit=1,
            )[1],
        )
        self.assertEqual(
            "station-four-social-private",
            self.boundary.requests[0]["destructive_scope"],
        )
        self.assertEqual(1, len(self.deployment_runner.requests))
        self.assertEqual(
            first["reset_manifest_digest"],
            self.deployment_runner.requests[0]["reset_manifest_digest"],
        )

    def test_profile_run_uses_the_profile_declaration_owner(self) -> None:
        declaration_loader = mock.Mock(
            return_value=copy.deepcopy(
                self.declarations["secure-content-w12a-four"]
            )
        )
        self.owner = self._owner(
            profile_declaration_loader=declaration_loader,
        )
        self._freeze()

        result = self._run("four")

        self.assertEqual("PASS", result["status"])
        declaration_loader.assert_called_once_with(
            "secure-content-w12a-four",
            "W12A-FOUR",
        )

    def test_five_arm_cannot_run_before_four(self) -> None:
        self._freeze()

        with self.assertRaisesRegex(ValidationError, "completed four child"):
            self._run("fiveArm")

        self.assertEqual([], self.boundary.events)

    def test_activation_runs_serialize_and_aggregate_exactly_two_profiles(self) -> None:
        source = self._freeze()
        four = self._run("four")
        five_arm = self._run("fiveArm")
        aggregate = self.owner.aggregate(
            intent="SCHEMA_ACTIVATION",
            generation_id=COMMIT,
            profiles=PROFILE_ORDER,
        )

        self.assertEqual(AGGREGATE_RESULT_KIND, aggregate["kind"])
        self.assertEqual("CANONICAL_SCHEMA_ACTIVE_ONLY", aggregate["claim"])
        self.assertEqual("W12D", aggregate["workstream_id"])
        self.assertEqual("W12D", aggregate["task_id"])
        self.assertEqual(source["result_digest"], aggregate["source_freeze_digest"])
        self.assertEqual(
            [four["result_digest"], five_arm["result_digest"]],
            [child["result_digest"] for child in aggregate["children"]],
        )
        self.assertEqual(
            ["four", "four", "fiveArm", "fiveArm"],
            [event[1] for event in self.boundary.events if event[0] == "invoke"],
        )

    def test_aggregate_rejects_reordered_or_incomplete_profile_set(self) -> None:
        self._freeze()
        self._run("four")
        self._run("fiveArm")

        for profiles in (("fiveArm", "four"), ("four",), ("four", "fiveArm", "four")):
            with self.subTest(profiles=profiles), self.assertRaisesRegex(
                ValidationError,
                "profiles must be exactly",
            ):
                self.owner.aggregate(
                    intent="SCHEMA_ACTIVATION",
                    generation_id=COMMIT,
                    profiles=profiles,
                )

    def test_aggregate_rejects_duplicate_completed_child(self) -> None:
        self._freeze()
        first = self._run("four")
        self._run("fiveArm")
        duplicate = (
            self.result_root
            / "W12A"
            / "activation"
            / COMMIT
            / "four"
            / "another-reset"
            / "result.json"
        )
        write_immutable_json(duplicate, first)

        with self.assertRaisesRegex(ValidationError, "exactly one"):
            self.owner.aggregate(
                intent="SCHEMA_ACTIVATION",
                generation_id=COMMIT,
                profiles=PROFILE_ORDER,
            )

    def test_aggregate_rejects_tampered_child(self) -> None:
        self._freeze()
        self._run("four")
        self._run("fiveArm")
        child_path = next(
            (
                self.result_root
                / "W12A"
                / "activation"
                / COMMIT
                / "four"
            ).glob("*/result.json")
        )
        child = json.loads(child_path.read_text(encoding="utf-8"))
        child["claim"] = "PRODUCT_PASS"
        child_path.write_text(json.dumps(child), encoding="utf-8")
        os.chmod(child_path, 0o600)

        with self.assertRaises(ValidationError):
            self.owner.aggregate(
                intent="SCHEMA_ACTIVATION",
                generation_id=COMMIT,
                profiles=PROFILE_ORDER,
            )

    def test_final_cut_uses_fresh_namespace_and_cannot_relabel_activation(self) -> None:
        self._freeze()
        activation = self._run("four")
        final_four = self._run("four", intent="FINAL_CUT")
        final_five = self._run("fiveArm", intent="FINAL_CUT")
        aggregate = self.owner.aggregate(
            intent="FINAL_CUT",
            generation_id=COMMIT,
            profiles=PROFILE_ORDER,
        )

        self.assertNotEqual(
            activation["reset_manifest_digest"],
            final_four["reset_manifest_digest"],
        )
        self.assertEqual("FINAL_RESET_COMPLETE_ONLY", final_four["claim"])
        self.assertEqual("FINAL_RESET_COMPLETE_ONLY", final_five["claim"])
        self.assertEqual("W12", aggregate["task_id"])
        self.assertTrue(
            (
                self.result_root
                / "W12"
                / "final-cut"
                / COMMIT
                / "aggregate"
                / "result.json"
            ).is_file()
        )

    def test_reset_id_cannot_be_reused_across_profile_or_intent(self) -> None:
        self._freeze()
        self._run("four", reset_id="globally-unique-reset")

        with self.assertRaisesRegex(ValidationError, "already used"):
            self._run(
                "four",
                intent="FINAL_CUT",
                reset_id="globally-unique-reset",
            )
        with self.assertRaisesRegex(ValidationError, "already used"):
            self._run("fiveArm", reset_id="globally-unique-reset")

    def test_intermediate_first_state_is_rejected_before_deployment(
        self,
    ) -> None:
        self._freeze()
        self.boundary.first_state = "PREPARED"
        with self.assertRaises(ResetIncomplete):
            self._run("four", reset_id="resume-reset")
        run_directory = (
            self.result_root
            / "W12A"
            / "activation"
            / COMMIT
            / "four"
            / "resume-reset"
        )
        self.assertEqual([], self.deployment_runner.requests)
        self.assertFalse((run_directory / "completed-reset-journal.json").exists())
        self.assertFalse(
            (
                run_directory
                / CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME
            ).exists()
        )
        self.assertFalse((run_directory / "result.json").exists())

    def test_resume_with_prior_invocation_uses_same_manifest(self) -> None:
        self._freeze()
        self.boundary.first_state = "PREPARED"
        with self.assertRaises(ResetIncomplete):
            self._run("four", reset_id="resume-reset")
        manifest_path = (
            self.result_root
            / "W12A"
            / "activation"
            / COMMIT
            / "four"
            / "resume-reset"
            / "reset-manifest.json"
        )
        original = manifest_path.read_bytes()
        self.boundary.first_state = "OBJECTS_DELETED"

        result = self._run("four", reset_id="resume-reset")

        self.assertEqual(original, manifest_path.read_bytes())
        self.assertEqual("PASS", result["status"])
        self.assertEqual(3, len(self.boundary.invocations))
        self.assertNotEqual(
            self.boundary.invocations[0]["invocation_id"],
            self.boundary.invocations[1]["invocation_id"],
        )
        self.assertNotEqual(
            self.boundary.invocations[1]["invocation_id"],
            self.boundary.invocations[2]["invocation_id"],
        )

    def test_lost_complete_response_resumes_without_redeploy(self) -> None:
        self._freeze()
        self.boundary.lose_complete_response_once = True
        with self.assertRaisesRegex(
            BoundaryUnavailable,
            "response was lost",
        ):
            self._run("four", reset_id="lost-complete")

        accepted_before_replay = copy.deepcopy(
            self.boundary.accepted_invocations["lost-complete"]
        )
        sealed_journal_digest = canonical_digest(
            reset_journal(
                accepted_before_replay,
                current_state="COMPLETE",
            )
        )
        self.assertEqual(2, len(self.boundary.invocations))
        self.assertEqual(2, len(accepted_before_replay))
        self.assertEqual(1, len(self.deployment_runner.requests))
        self.declarations["secure-content-w12a-four"][
            "declarationDigest"
        ] = "f" * 64
        result = self._run("four", reset_id="lost-complete")

        self.assertEqual("PASS", result["status"])
        self.assertEqual(
            accepted_before_replay[-1]["declaration_digest"],
            result["declaration_digest"],
        )
        self.assertEqual(3, len(self.boundary.invocations))
        self.assertEqual(
            accepted_before_replay,
            self.boundary.accepted_invocations["lost-complete"],
        )
        self.assertEqual(1, len(self.deployment_runner.requests))
        replay_invocation = self.boundary.invocations[-1]
        replay_response = json.loads(
            (
                self.result_root
                / "W12A"
                / "activation"
                / COMMIT
                / "four"
                / "lost-complete"
                / "invocations"
                / replay_invocation["invocation_id"]
                / "response.json"
            ).read_text(encoding="utf-8")
        )
        self.assertTrue(replay_response["exact_replay"])
        self.assertEqual(sealed_journal_digest, replay_response["journal_digest"])
        self.assertNotIn(
            replay_invocation["invocation_id"],
            {
                accepted["invocation_id"]
                for accepted in replay_response["journal"]["accepted_invocations"]
            },
        )
        self.assertEqual(
            accepted_before_replay[-1]["invocation_id"],
            result["invocation_ref"]["path"].split("/")[-2],
        )

    def test_resume_from_objects_deleted_accepts_new_terminal_invocation(
        self,
    ) -> None:
        self._freeze()
        self.deployment_runner.fail = True
        with self.assertRaisesRegex(
            BoundaryUnavailable,
            "reviewed Station deployment failed",
        ):
            self._run("four", reset_id="resume-after-deploy-failure")

        self.deployment_runner.fail = False
        result = self._run("four", reset_id="resume-after-deploy-failure")

        self.assertEqual("PASS", result["status"])
        self.assertEqual(2, len(self.boundary.invocations))
        self.assertEqual(1, len(self.deployment_runner.requests))
        terminal_invocation = self.boundary.invocations[-1]
        self.assertEqual(
            terminal_invocation["declaration_digest"],
            result["declaration_digest"],
        )
        replay_response = json.loads(
            (
                self.result_root
                / "W12A"
                / "activation"
                / COMMIT
                / "four"
                / "resume-after-deploy-failure"
                / "invocations"
                / terminal_invocation["invocation_id"]
                / "response.json"
            ).read_text(encoding="utf-8")
        )
        self.assertFalse(replay_response["exact_replay"])

    def test_resumed_complete_response_requires_exact_replay(self) -> None:
        self._freeze()
        self.boundary.lose_complete_response_once = True
        with self.assertRaises(BoundaryUnavailable):
            self._run("four", reset_id="invalid-terminal-replay")
        self.boundary.terminal_replay_exact_replay = False

        with self.assertRaisesRegex(ResetIncomplete, "invalid exact_replay"):
            self._run("four", reset_id="invalid-terminal-replay")

        self.assertEqual(3, len(self.boundary.invocations))
        self.assertEqual(
            2,
            len(
                self.boundary.accepted_invocations[
                    "invalid-terminal-replay"
                ]
            ),
        )
        self.assertEqual(1, len(self.deployment_runner.requests))

    def test_ordinary_first_response_rejects_exact_replay(self) -> None:
        self._freeze()
        self.boundary.first_exact_replay = True

        with self.assertRaisesRegex(ResetIncomplete, "invalid exact_replay"):
            self._run("four", reset_id="invalid-first-replay")

        self.assertEqual(1, len(self.boundary.invocations))
        self.assertEqual(0, len(self.deployment_runner.requests))

    def test_ordinary_second_response_rejects_exact_replay(self) -> None:
        self._freeze()
        self.boundary.second_exact_replay = True

        with self.assertRaisesRegex(ResetIncomplete, "invalid exact_replay"):
            self._run("four", reset_id="invalid-second-replay")

        run_directory = (
            self.result_root
            / "W12A"
            / "activation"
            / COMMIT
            / "four"
            / "invalid-second-replay"
        )
        self.assertEqual(2, len(self.boundary.invocations))
        self.assertEqual(1, len(self.deployment_runner.requests))
        self.assertEqual(1, len(self.quiescence_runner.requests))
        self.assertFalse((run_directory / "completed-reset-journal.json").exists())
        self.assertFalse(
            (
                run_directory
                / CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME
            ).exists()
        )
        self.assertFalse((run_directory / "result.json").exists())

    def test_resume_rejects_a_changed_manifest_before_invocation(self) -> None:
        self._freeze()
        self.boundary.first_state = "PREPARED"
        with self.assertRaises(ResetIncomplete):
            self._run("four", reset_id="resume-reset")
        invocation_count = len(self.boundary.invocations)
        self.boundary.first_state = "OBJECTS_DELETED"
        self.boundary.change_manifest = True

        with self.assertRaisesRegex(ArtifactConflict, "resume manifest differs"):
            self._run("four", reset_id="resume-reset")

        self.assertEqual(invocation_count, len(self.boundary.invocations))

    def test_deployment_failure_stops_before_second_invocation(self) -> None:
        self._freeze()
        self.deployment_runner.fail = True

        with self.assertRaisesRegex(
            BoundaryUnavailable,
            "reviewed Station deployment failed",
        ):
            self._run("four", reset_id="deployment-failure")

        run_directory = (
            self.result_root
            / "W12A"
            / "activation"
            / COMMIT
            / "four"
            / "deployment-failure"
        )
        self.assertEqual(1, len(self.boundary.invocations))
        first_directory = (
            run_directory
            / "invocations"
            / self.boundary.invocations[0]["invocation_id"]
        )
        self.assertTrue((first_directory / "request.json").is_file())
        self.assertTrue((first_directory / "response.json").is_file())
        self.assertEqual(
            [
                ("open", "four"),
                ("prepare", "four"),
                ("invoke", "four"),
                ("deploy", "four"),
                ("requiesce", "four"),
                ("close", "four"),
            ],
            self.boundary.events,
        )
        self.assertEqual(1, len(self.quiescence_runner.requests))
        self.assertFalse((run_directory / "completed-reset-journal.json").exists())
        self.assertFalse(
            (
                run_directory
                / CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME
            ).exists()
        )
        self.assertFalse((run_directory / "result.json").exists())

    def test_non_complete_second_response_does_not_seal_terminal_artifacts(
        self,
    ) -> None:
        self._freeze()
        self.boundary.second_state = "POST_AUDIT_PASSED"

        with self.assertRaises(ResetIncomplete):
            self._run("four", reset_id="incomplete-second")

        run_directory = (
            self.result_root
            / "W12A"
            / "activation"
            / COMMIT
            / "four"
            / "incomplete-second"
        )
        self.assertEqual(2, len(self.boundary.invocations))
        self.assertEqual(1, len(self.quiescence_runner.requests))
        self.assertFalse((run_directory / "completed-reset-journal.json").exists())
        self.assertFalse(
            (
                run_directory
                / CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME
            ).exists()
        )
        self.assertFalse((run_directory / "result.json").exists())

    def test_profile_declaration_rejects_cross_profile_reset_scope(self) -> None:
        self._freeze()
        claims = self.declarations["secure-content-w12a-four"]["runtimeClaims"]
        for claim in claims:
            if claim["kind"] == "station.reset":
                claim["resourceId"] = "station-five-arm-social-private"

        with self.assertRaisesRegex(ValidationError, "exactly one approved"):
            self._run("four")

        self.assertEqual([], self.boundary.events)

    def test_profile_declaration_requires_exact_plan_and_journey(self) -> None:
        self._freeze()
        declaration = self.declarations["secure-content-w12a-four"]
        declaration["journeyId"] = "another-journey"

        with self.assertRaisesRegex(ValidationError, "journeyId"):
            self._run("four")

        declaration["journeyId"] = "sc-dj-canonical-schema-activation"
        declaration["planPath"] = "docs/another-plan.md"
        with self.assertRaisesRegex(ValidationError, "planPath"):
            self._run("four")

    def test_workstream_and_intent_mapping_is_closed(self) -> None:
        self._freeze()

        with self.assertRaisesRegex(ValidationError, "requires workstream"):
            self.owner.run_profile(
                workstream_id="W12F-FOUR",
                profile_id="four",
                intent="SCHEMA_ACTIVATION",
                generation_id=COMMIT,
                budget_seconds=3600,
                reset_id="wrong-workstream",
            )
        with self.assertRaisesRegex(ValidationError, "unsupported reset intent"):
            self.owner.run_profile(
                workstream_id="W12A-FOUR",
                profile_id="four",
                intent="MIGRATION",
                generation_id=COMMIT,
                budget_seconds=3600,
                reset_id="wrong-intent",
            )

    def test_manifest_rejects_unknown_target_and_retired_column(self) -> None:
        request = {
            "reset_id": "reset-four",
            "reset_intent": "SCHEMA_ACTIVATION",
            "source_commit": COMMIT,
            "workspace_id": WORKSPACE_ID,
            "profile_id": "four",
            "deployment_environment": "station-four",
            "destructive_scope": "station-four-social-private",
        }
        manifest = reset_manifest(request)
        manifest["database_targets"][0]["table"] = "social_public_posts"
        manifest["manifest_digest"] = canonical_digest(
            {key: value for key, value in manifest.items() if key != "manifest_digest"}
        )
        with self.assertRaisesRegex(ValidationError, "dependency order"):
            validate_reset_manifest(
                manifest,
                target=PROFILE_TARGETS["four"],
                intent="SCHEMA_ACTIVATION",
                generation_id=COMMIT,
                workspace_id=WORKSPACE_ID,
                reset_id="reset-four",
            )

        manifest = reset_manifest(request)
        manifest["retired_private_post_columns"] = ["canonical_ciphertext"]
        manifest["manifest_digest"] = canonical_digest(
            {key: value for key, value in manifest.items() if key != "manifest_digest"}
        )
        with self.assertRaisesRegex(ValidationError, "retired_private_post_columns"):
            validate_reset_manifest(
                manifest,
                target=PROFILE_TARGETS["four"],
                intent="SCHEMA_ACTIVATION",
                generation_id=COMMIT,
                workspace_id=WORKSPACE_ID,
                reset_id="reset-four",
            )

    def test_manifest_accepts_only_exact_recovery_predecessor(self) -> None:
        request = {
            "reset_id": "reset-four",
            "reset_intent": "SCHEMA_ACTIVATION",
            "source_commit": COMMIT,
            "workspace_id": WORKSPACE_ID,
            "profile_id": "four",
            "deployment_environment": "station-four",
            "destructive_scope": "station-four-social-private",
        }
        manifest = reset_manifest(request)
        manifest["recovery_predecessor"] = {
            "reset_id": "reset-four-old",
            "reset_manifest_digest": "1" * 64,
            "journal_digest": "2" * 64,
            "state": "STATION_DEPLOYED",
            "failure_code": "RESET_SCHEMA_TARGET_UNREVIEWED",
        }
        manifest["manifest_digest"] = canonical_digest(
            {key: value for key, value in manifest.items() if key != "manifest_digest"}
        )
        validate_reset_manifest(
            manifest,
            target=PROFILE_TARGETS["four"],
            intent="SCHEMA_ACTIVATION",
            generation_id=COMMIT,
            workspace_id=WORKSPACE_ID,
            reset_id="reset-four",
        )

        manifest["recovery_predecessor"].update(
            {
                "state": "STATION_DEPLOYED",
                "failure_code": "RESET_SOURCE_SUPERSEDED",
            }
        )
        manifest["manifest_digest"] = canonical_digest(
            {key: value for key, value in manifest.items() if key != "manifest_digest"}
        )
        validate_reset_manifest(
            manifest,
            target=PROFILE_TARGETS["four"],
            intent="SCHEMA_ACTIVATION",
            generation_id=COMMIT,
            workspace_id=WORKSPACE_ID,
            reset_id="reset-four",
        )

        manifest["recovery_predecessor"].update(
            {
                "state": "OBJECTS_DELETED",
                "failure_code": "RESET_SOURCE_SUPERSEDED",
            }
        )
        manifest["manifest_digest"] = canonical_digest(
            {key: value for key, value in manifest.items() if key != "manifest_digest"}
        )
        validate_reset_manifest(
            manifest,
            target=PROFILE_TARGETS["four"],
            intent="SCHEMA_ACTIVATION",
            generation_id=COMMIT,
            workspace_id=WORKSPACE_ID,
            reset_id="reset-four",
        )

        manifest["recovery_predecessor"]["state"] = "OBJECTS_DELETED"
        manifest["recovery_predecessor"][
            "failure_code"
        ] = "RESET_SCHEMA_TARGET_UNREVIEWED"
        manifest["manifest_digest"] = canonical_digest(
            {key: value for key, value in manifest.items() if key != "manifest_digest"}
        )
        with self.assertRaisesRegex(
            ValidationError,
            "recovery_predecessor identity",
        ):
            validate_reset_manifest(
                manifest,
                target=PROFILE_TARGETS["four"],
                intent="SCHEMA_ACTIVATION",
                generation_id=COMMIT,
                workspace_id=WORKSPACE_ID,
                reset_id="reset-four",
            )

        manifest = reset_manifest(request)
        manifest["recovery_predecessor"] = None
        manifest["manifest_digest"] = canonical_digest(
            {key: value for key, value in manifest.items() if key != "manifest_digest"}
        )
        with self.assertRaisesRegex(
            ValidationError,
            "recovery_predecessor must be an object",
        ):
            validate_reset_manifest(
                manifest,
                target=PROFILE_TARGETS["four"],
                intent="SCHEMA_ACTIVATION",
                generation_id=COMMIT,
                workspace_id=WORKSPACE_ID,
                reset_id="reset-four",
            )

    def test_completed_journal_rejects_gaps_and_conflicting_invocation(self) -> None:
        invocation = {
            "invocation_id": "invocation-four",
            "invocation_digest": "1" * 64,
            "reset_manifest_digest": "2" * 64,
        }
        journal = completed_journal(invocation)
        journal["transitions"].pop(2)
        with self.assertRaisesRegex(ValidationError, "transition count"):
            validate_completed_journal(
                journal,
                manifest_digest="2" * 64,
                invocation_id="invocation-four",
                invocation_digest="1" * 64,
            )

        journal = completed_journal(invocation)
        with self.assertRaisesRegex(ValidationError, "did not accept"):
            validate_completed_journal(
                journal,
                manifest_digest="2" * 64,
                invocation_id="invocation-four",
                invocation_digest="3" * 64,
            )

    def test_go_wire_fixture_uses_identical_canonical_digests(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        source = textwrap.dedent(
            """
            package main

            import (
                "encoding/json"
                "os"
                "time"

                infrastructure "github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
            )

            func main() {
                issuedAt := time.Date(2026, 9, 19, 10, 0, 0, 0, time.UTC)
                invocation := infrastructure.SecureContentResetInvocationV1{
                    SchemaVersion: 1,
                    InvocationID: "invocation-four-1",
                    ResetID: "reset-four-1",
                    ResetIntent: infrastructure.ResetIntentSchemaActivation,
                    ResetManifestDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    PlanID: infrastructure.SecureContentResetPlanID,
                    TaskID: "W12D",
                    DeclarationDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                    SourceCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    WorkspaceID: "9eb2cb904c9ae460",
                    ProfileID: "four",
                    DeploymentEnvironment: "station-four",
                    DestructiveScope: "station-four-social-private",
                    IssuedAt: issuedAt,
                    ExpiresAt: issuedAt.Add(15 * time.Minute),
                }
                invocationDigest, err := invocation.CalculatedDigest()
                if err != nil {
                    panic(err)
                }
                invocation.InvocationDigest = invocationDigest

                journal := infrastructure.ResetJournalV1{
                    SchemaVersion: 1,
                    ResetID: "reset-four-1",
                    ResetManifestDigest: invocation.ResetManifestDigest,
                    CurrentState: infrastructure.ResetStateComplete,
                    AcceptedInvocations: []infrastructure.ResetInvocationAcceptance{
                        {
                            InvocationID: invocation.InvocationID,
                            InvocationDigest: invocation.InvocationDigest,
                            AcceptedAt: issuedAt,
                        },
                    },
                    Transitions: []infrastructure.ResetJournalTransition{
                        {
                            Ordinal: 99,
                            FromState: infrastructure.ResetStatePrepared,
                            ToState: infrastructure.ResetStateDatabaseSchemaCommitted,
                            TransitionAt: issuedAt.Add(time.Second),
                        },
                    },
                }
                journalDigest, err := journal.CalculatedDigest()
                if err != nil {
                    panic(err)
                }

                attestation := infrastructure.CanonicalPrivateSchemaAttestationV1{
                    SchemaVersion: 1,
                    SourceCommit: invocation.SourceCommit,
                    WorkspaceID: invocation.WorkspaceID,
                    ProfileID: invocation.ProfileID,
                    DeploymentEnvironment: invocation.DeploymentEnvironment,
                    DestructiveScope: invocation.DestructiveScope,
                    StationServiceID: "station-four",
                    StationPeerID: "peer-四",
                    StationRuntimeIdentity: "runtime-four",
                    ServiceAttestationDigest: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                    ResetIntent: invocation.ResetIntent,
                    ResetManifestDigest: invocation.ResetManifestDigest,
                    CompletedJournalDigest: journalDigest,
                    CanonicalSchemaDigest: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                    RetiredColumnsAbsent: true,
                    PublicSnapshotDigest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                    CreatedAt: issuedAt.Add(2 * time.Second),
                }
                attestationDigest, err := attestation.CalculatedDigest()
                if err != nil {
                    panic(err)
                }
                attestation.AttestationDigest = attestationDigest

                encoder := json.NewEncoder(os.Stdout)
                encoder.SetEscapeHTML(false)
                if err := encoder.Encode(map[string]any{
                    "attestation": attestation,
                    "attestation_digest": attestationDigest,
                    "invocation": invocation,
                    "invocation_digest": invocationDigest,
                    "journal": journal,
                    "journal_digest": journalDigest,
                    "reference_classifications": []infrastructure.ResetReferenceClassification{
                        infrastructure.ResetReferenceCanonicalPrivate,
                        infrastructure.ResetReferenceExclusiveLegacy,
                        infrastructure.ResetReferenceSharedCASSafe,
                    },
                }); err != nil {
                    panic(err)
                }
            }
            """
        )
        with tempfile.TemporaryDirectory() as temp:
            source_path = Path(temp) / "main.go"
            source_path.write_text(source, encoding="utf-8")
            completed = subprocess.run(
                ["go", "run", str(source_path)],
                cwd=repo_root / "apps/station/app",
                check=False,
                capture_output=True,
                text=True,
                timeout=120,
            )
        self.assertEqual(0, completed.returncode, completed.stderr)
        fixture = json.loads(completed.stdout)

        invocation = fixture["invocation"]
        invocation_digest = invocation.pop("invocation_digest")
        self.assertEqual(fixture["invocation_digest"], invocation_digest)
        self.assertEqual(canonical_digest(invocation), invocation_digest)
        expected_invocation = (
            '{"declaration_digest":"'
            + "c" * 64
            + '","deployment_environment":"station-four",'
            '"destructive_scope":"station-four-social-private",'
            '"expires_at":"2026-09-19T10:15:00Z",'
            '"invocation_id":"invocation-four-1",'
            '"issued_at":"2026-09-19T10:00:00Z",'
            '"plan_id":"SECURE-CONTENT-HARD-CUT-20260913",'
            '"profile_id":"four","reset_id":"reset-four-1",'
            '"reset_intent":"SCHEMA_ACTIVATION",'
            '"reset_manifest_digest":"'
            + "b" * 64
            + '","schema_version":1,"source_commit":"'
            + "a" * 40
            + '","task_id":"W12D",'
            '"workspace_id":"9eb2cb904c9ae460"}'
        )
        self.assertEqual(
            expected_invocation.encode("utf-8"),
            json.dumps(
                invocation,
                ensure_ascii=True,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8"),
        )

        journal = fixture["journal"]
        self.assertEqual(
            {
                "schema_version",
                "reset_manifest_digest",
                "current_state",
                "accepted_invocations",
                "transitions",
                "failure",
            },
            set(journal),
        )
        self.assertNotIn("reset_id", journal)
        self.assertEqual(canonical_digest(journal), fixture["journal_digest"])
        transition = journal["transitions"][0]
        self.assertEqual(
            {"from_state", "to_state", "transitioned_at", "transition_digest"},
            set(transition),
        )
        transition_digest = transition.pop("transition_digest")
        self.assertEqual(canonical_digest(transition), transition_digest)

        attestation = fixture["attestation"]
        self.assertNotIn("kind", attestation)
        attestation_digest = attestation.pop("attestation_digest")
        self.assertEqual(fixture["attestation_digest"], attestation_digest)
        self.assertEqual(canonical_digest(attestation), attestation_digest)
        self.assertEqual(
            ["PRIVATE_EXCLUSIVE", "PRIVATE_EXCLUSIVE", "SHARED_CAS_SAFE"],
            fixture["reference_classifications"],
        )

    def test_invocation_rejects_expiry_and_manifest_relabel(self) -> None:
        self._freeze()
        self._run("four")
        invocation = copy.deepcopy(self.boundary.invocations[0])
        manifest_path = next(
            (
                self.result_root
                / "W12A"
                / "activation"
                / COMMIT
                / "four"
            ).glob("*/reset-manifest.json")
        )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        invocation["expires_at"] = timestamp(-1)
        invocation["invocation_digest"] = canonical_digest(
            {
                key: value
                for key, value in invocation.items()
                if key != "invocation_digest"
            }
        )
        with self.assertRaisesRegex(ValidationError, "expiry"):
            validate_reset_invocation(
                invocation,
                manifest=manifest,
                declaration=self.declarations["secure-content-w12a-four"],
                target=PROFILE_TARGETS["four"],
                task_id="W12D",
                now=AT,
            )

        invocation = copy.deepcopy(self.boundary.invocations[0])
        invocation["reset_intent"] = "FINAL_CUT"
        invocation["invocation_digest"] = canonical_digest(
            {
                key: value
                for key, value in invocation.items()
                if key != "invocation_digest"
            }
        )
        with self.assertRaisesRegex(ValidationError, "reset_intent"):
            validate_reset_invocation(
                invocation,
                manifest=manifest,
                declaration=self.declarations["secure-content-w12a-four"],
                target=PROFILE_TARGETS["four"],
                task_id="W12D",
                now=AT,
            )

    def test_generation_must_equal_current_exact_source(self) -> None:
        with self.assertRaisesRegex(ValidationError, "exact worktree HEAD"):
            self.owner.source_freeze(
                generation_id="7" * 40,
                budget_seconds=7200,
            )

    def test_resume_after_object_deletion_skips_second_quiescence(self) -> None:
        directory = self.result_root / "resume"
        response = directory / "invocations" / "first" / "response.json"
        response.parent.mkdir(parents=True)
        response.write_text(
            json.dumps(
                {
                    "state": "OBJECTS_DELETED",
                    "journal": {"current_state": "OBJECTS_DELETED"},
                }
            ),
            encoding="utf-8",
        )
        response.chmod(0o600)

        self.assertTrue(_resume_skips_quiescence(directory))

    def test_final_cut_accepts_verified_plan_lifecycle_projection(self) -> None:
        runtime_source = "7" * 40
        projection = mock.Mock(
            runtime_source_commit=runtime_source,
            control_head=COMMIT,
            transition_count=2,
            transition_digest="6" * 64,
        )
        with mock.patch(
            "tooling.development.secure_content.schema_activation."
            "validate_plan_lifecycle_source",
            return_value=projection,
        ) as validate:
            identity = self.owner._current_identity(
                runtime_source,
                allow_plan_lifecycle=True,
            )

        self.assertEqual(COMMIT, identity["controlHead"])
        self.assertEqual(runtime_source, identity["runtimeSourceCommit"])
        self.assertEqual("6" * 64, identity["sourceProjectionDigest"])
        validate.assert_called_once_with(
            repo_root=self.repo_root.resolve(),
            plan_path=PLAN_PATH,
            runtime_source_commit=runtime_source,
            control_head=COMMIT,
        )

    def test_immutable_writer_rejects_overwrite_and_sets_private_mode(self) -> None:
        path = self.result_root / "immutable.json"
        write_immutable_json(path, {"value": 1})
        self.assertEqual(0o600, path.stat().st_mode & 0o777)
        with self.assertRaises(ArtifactConflict):
            write_immutable_json(path, {"value": 1})

    def test_lease_wrapped_boundary_only_accepts_ssh_transport(self) -> None:
        request = {"destructive_scope": "station-four-social-private"}
        boundary = LeaseWrappedSSHMaintenanceBoundary(
            repo_root=self.repo_root,
            environment={
                "PT_SECURE_CONTENT_MAINTENANCE_SSH_COMMAND_JSON": json.dumps(
                    ["ssh", "station-four", "secure-content-maintenance"]
                )
            },
        )
        command = boundary.command_for(request, budget_seconds=3600)
        separator = command.index("--")
        self.assertEqual(
            [
                "node",
                "tooling/scripts/local-dev/machine-dev.mjs",
                "lease",
            ],
            command[:3],
        )
        self.assertEqual("station.reset", command[command.index("--resource-kind") + 1])
        self.assertEqual(
            "station-four-social-private",
            command[command.index("--reset-scope") + 1],
        )
        self.assertEqual("ssh", command[separator + 1])

        invalid = LeaseWrappedSSHMaintenanceBoundary(
            repo_root=self.repo_root,
            environment={
                "PT_SECURE_CONTENT_MAINTENANCE_SSH_COMMAND_JSON": json.dumps(
                    ["secure-content-maintenance", "reset"]
                )
            },
        )
        with self.assertRaisesRegex(BoundaryUnavailable, "SSH transport"):
            invalid.command_for(request, budget_seconds=3600)

    def test_lease_wrapped_boundary_can_resolve_reviewed_ssh_transport(self) -> None:
        request = {"destructive_scope": "station-four-social-private"}
        resolver = mock.Mock(
            return_value=["ssh", "station-four", "secure-content-maintenance"]
        )
        boundary = LeaseWrappedSSHMaintenanceBoundary(
            repo_root=self.repo_root,
            environment={},
            command_resolver=resolver,
        )

        command = boundary.command_for(request, budget_seconds=3600)

        resolver.assert_called_once_with(request, 3600)
        separator = command.index("--")
        self.assertEqual("ssh", command[separator + 1])

    def test_lease_wrapped_session_forwards_sigterm_to_process_group(self) -> None:
        previous_handlers = {
            signal_value: signal.getsignal(signal_value)
            for signal_value in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)
        }
        with tempfile.TemporaryDirectory() as temp:
            process_group_path = Path(temp) / "process-group"
            source = textwrap.dedent(
                """
                import os
                import subprocess
                import sys
                import time
                from pathlib import Path

                subprocess.Popen(
                    [sys.executable, "-c", "import time; time.sleep(60)"]
                )
                Path(sys.argv[1]).write_text(str(os.getpid()), encoding="utf-8")
                while True:
                    time.sleep(1)
                """
            )
            session = _LeaseWrappedSSHSession(
                [sys.executable, "-c", source, str(process_group_path)],
                self.repo_root,
            )
            with self.assertRaises(SystemExit) as raised:
                with session:
                    process_group = self._wait_for_process_group(
                        process_group_path
                    )
                    os.kill(os.getpid(), signal.SIGTERM)

            self.assertEqual(128 + signal.SIGTERM, raised.exception.code)
            self._assert_process_group_exited(process_group)

        for signal_value, previous in previous_handlers.items():
            self.assertIs(previous, signal.getsignal(signal_value))

    def test_lease_wrapped_session_falls_back_when_process_group_is_gone(
        self,
    ) -> None:
        session = _LeaseWrappedSSHSession(["ssh"], self.repo_root)
        session.process = mock.Mock(pid=42)
        session.process.poll.return_value = None
        with mock.patch(
            "tooling.development.secure_content.schema_activation.os.killpg",
            side_effect=PermissionError(1, "operation not permitted"),
        ):
            session._terminate_process_group(signal.SIGTERM)

        session.process.terminate.assert_called_once_with()

    def test_lease_wrapped_session_escalates_timeout_to_sigkill(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            process_group_path = Path(temp) / "process-group"
            source = textwrap.dedent(
                """
                import os
                import signal
                import subprocess
                import sys
                import time
                from pathlib import Path

                signal.signal(signal.SIGTERM, signal.SIG_IGN)
                subprocess.Popen(
                    [
                        sys.executable,
                        "-c",
                        (
                            "import signal,time;"
                            "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
                            "time.sleep(60)"
                        ),
                    ]
                )
                Path(sys.argv[1]).write_text(str(os.getpid()), encoding="utf-8")
                while True:
                    time.sleep(1)
                """
            )
            session = _LeaseWrappedSSHSession(
                [sys.executable, "-c", source, str(process_group_path)],
                self.repo_root,
            )
            with (
                mock.patch.object(
                    _LeaseWrappedSSHSession,
                    "EXIT_WAIT_SECONDS",
                    0.1,
                ),
                mock.patch.object(
                    _LeaseWrappedSSHSession,
                    "TERMINATION_WAIT_SECONDS",
                    0.1,
                ),
            ):
                with self.assertRaisesRegex(
                    BoundaryUnavailable,
                    "exited with -9",
                ):
                    with session:
                        process_group = self._wait_for_process_group(
                            process_group_path
                        )

            self._assert_process_group_exited(process_group)

    def _wait_for_process_group(self, path: Path) -> int:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if path.exists():
                return int(path.read_text(encoding="utf-8"))
            time.sleep(0.01)
        self.fail(f"process group fixture was not created at {path}")

    def _assert_process_group_exited(self, process_group: int) -> None:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                os.killpg(process_group, 0)
            except ProcessLookupError:
                return
            time.sleep(0.01)
        self.fail(f"process group {process_group} is still alive")


if __name__ == "__main__":
    unittest.main()
