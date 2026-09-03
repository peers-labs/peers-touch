from __future__ import annotations

import errno
import json
import multiprocessing
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core.evidence_store import (
    ARTIFACT_ROOT_ENV,
    ArtifactSession,
    ArtifactRef,
    EvidenceStore,
    canonical_workspace_path,
    current_artifact_ref,
    current_artifact_path,
    current_run_directory,
    resolve_artifact_root,
    write_current_artifact,
    workspace_id,
)
from tooling.acceptance.core.errors import (
    EvidenceConflict,
    EvidenceManifestInvalid,
    EvidenceNoSpace,
    EvidencePathTraversal,
    EvidencePermissionDenied,
    EvidenceQuotaExceeded,
    EvidenceRootForbidden,
    EvidenceRootInvalid,
    EvidenceRunActive,
    EvidenceSymlinkRejected,
)
from tooling.acceptance.core.redaction import REDACTED


def _process_writer(
    root: str,
    worktree: str,
    index: int,
    result_queue: multiprocessing.Queue,
) -> None:
    try:
        store = EvidenceStore(Path(root), worktree=Path(worktree))
        run = store.begin_run(
            "process-concurrent-gate",
            source={"worker": index},
        )
        run.write_json(
            "reports/result.json",
            {"worker": index},
            role="report",
        )
        run.finalize(result={"status": "passed", "worker": index})
        run.publish_latest()
        run.close()
        result_queue.put({"runId": run.run_id})
    except BaseException as error:
        result_queue.put(
            {"error": f"{type(error).__name__}: {error}"}
        )


class ArtifactRootResolverTests(unittest.TestCase):
    def test_macos_default(self) -> None:
        root = resolve_artifact_root(
            repo_root=Path("/repo"),
            platform="darwin",
            environment={},
            home=Path("/test-home"),
            create=False,
        )
        self.assertEqual(
            root,
            Path("/test-home/Library/Application Support/PeersTouch/acceptance"),
        )

    def test_linux_xdg_and_fallback_defaults(self) -> None:
        xdg = resolve_artifact_root(
            repo_root=Path("/repo"),
            platform="linux",
            environment={"XDG_STATE_HOME": "/state"},
            home=Path("/test-home"),
            create=False,
        )
        fallback = resolve_artifact_root(
            repo_root=Path("/repo"),
            platform="linux",
            environment={},
            home=Path("/test-home"),
            create=False,
        )
        self.assertEqual(xdg, Path("/state/peers-touch/acceptance"))
        self.assertEqual(
            fallback,
            Path(os.path.realpath("/test-home/.local/state/peers-touch/acceptance")),
        )

    def test_windows_default_requires_local_app_data(self) -> None:
        root = resolve_artifact_root(
            repo_root=Path("/repo"),
            platform="win32",
            environment={"LOCALAPPDATA": "/test-local-app-data"},
            home=Path("/test-home"),
            create=False,
        )
        self.assertEqual(
            root,
            Path("/test-local-app-data/PeersTouch/acceptance"),
        )
        with self.assertRaises(EvidenceRootInvalid):
            resolve_artifact_root(
                repo_root=Path("/repo"),
                platform="win32",
                environment={},
                home=Path("/test-home"),
                create=False,
            )

    def test_override_wins_and_is_created_private(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "artifacts"
            resolved = resolve_artifact_root(
                repo_root=Path(directory) / "repo",
                platform="darwin",
                environment={ARTIFACT_ROOT_ENV: str(root)},
                home=Path(directory) / "home",
            )
            self.assertEqual(resolved, Path(os.path.realpath(root)))
            self.assertTrue(root.is_dir())
            if os.name != "nt":
                self.assertEqual(root.stat().st_mode & 0o777, 0o700)

    def test_ci_requires_override(self) -> None:
        with self.assertRaisesRegex(EvidenceRootInvalid, ARTIFACT_ROOT_ENV):
            resolve_artifact_root(
                repo_root=Path("/repo"),
                platform="linux",
                environment={"CI": "true"},
                home=Path("/home/alice"),
                create=False,
            )

    def test_relative_file_and_repository_roots_are_rejected(self) -> None:
        with self.assertRaises(EvidenceRootInvalid):
            resolve_artifact_root(
                repo_root=Path("/repo"),
                platform="linux",
                environment={ARTIFACT_ROOT_ENV: "relative"},
                home=Path("/test-home"),
                create=False,
            )
        with self.assertRaises(EvidenceRootForbidden):
            resolve_artifact_root(
                repo_root=Path("/repo"),
                platform="linux",
                environment={ARTIFACT_ROOT_ENV: "/repo/.artifacts"},
                home=Path("/test-home"),
                create=False,
            )
        with tempfile.TemporaryDirectory() as directory:
            file_root = Path(directory) / "file"
            file_root.write_text("not a directory", encoding="utf-8")
            with self.assertRaises(EvidenceRootInvalid):
                resolve_artifact_root(
                    repo_root=Path(directory) / "repo",
                    platform="linux",
                    environment={ARTIFACT_ROOT_ENV: str(file_root)},
                    home=Path(directory),
                    create=False,
                )

    def test_workspace_identity_is_stable_and_canonical(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            worktree = Path(directory) / "repo"
            worktree.mkdir()
            alias = Path(directory) / "alias"
            alias.symlink_to(worktree, target_is_directory=True)
            self.assertEqual(
                canonical_workspace_path(worktree),
                canonical_workspace_path(alias),
            )
            self.assertEqual(workspace_id(worktree), workspace_id(alias))
            self.assertRegex(workspace_id(worktree), r"^[0-9a-f]{16}$")


class EvidenceStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.worktree = self.base / "repo"
        self.worktree.mkdir()
        self.root = self.base / "artifacts"
        self.store = EvidenceStore(self.root, worktree=self.worktree)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_direct_store_rejects_root_inside_worktree(self) -> None:
        with self.assertRaises(EvidenceRootForbidden):
            EvidenceStore(self.worktree / ".artifacts", worktree=self.worktree)

    def test_write_finalize_publish_and_read_latest(self) -> None:
        run = self.store.begin_run(
            "unit-gate",
            source={"commit": "abc", "password": "not-persisted"},
        )
        report_ref = run.write_json(
            "reports/result.json",
            {"status": "passed", "token": "not-persisted"},
            role="report",
        )
        manifest = run.finalize(
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            },
        )
        latest_path = run.publish_latest()
        run.close()

        self.assertEqual(manifest["state"], "DURABLE")
        self.assertEqual(
            json.loads(self.store.resolve(report_ref).read_text())["token"],
            REDACTED,
        )
        latest = self.store.latest("unit-gate")
        self.assertEqual(latest["runId"], run.run_id)
        self.assertEqual(latest["artifacts"]["report"], report_ref.to_dict())
        self.assertEqual(
            json.loads(latest_path.read_text())["manifestSha256"],
            json.loads(latest_path.read_text())["manifest"]["sha256"],
        )

    def test_subprocess_context_resolves_and_parent_collects_artifacts(self) -> None:
        run = self.store.begin_run("child-gate", source={})
        environment = run.subprocess_environment({})
        self.assertEqual(
            current_run_directory(
                repo_root=self.worktree,
                environment=environment,
            ),
            run.run_dir,
        )
        target = write_current_artifact(
            "reports/child.json",
            b'{"status":"passed"}\n',
            repo_root=self.worktree,
            environment=environment,
        )
        self.assertEqual(
            target,
            current_artifact_path(
                "reports/child.json",
                repo_root=self.worktree,
                environment=environment,
            ),
        )
        reference = current_artifact_ref(
            "reports/child.json",
            repo_root=self.worktree,
            environment=environment,
        )
        self.assertEqual(reference.run_id, run.run_id)
        self.assertEqual(reference.path, "reports/child.json")
        self.assertEqual(
            write_current_artifact(
                "reports/child.json",
                b'{"status":"passed"}\n',
                repo_root=self.worktree,
                environment=environment,
            ),
            target,
        )
        with self.assertRaises(EvidenceConflict):
            write_current_artifact(
                "reports/child.json",
                b'{"status":"changed"}\n',
                repo_root=self.worktree,
                environment=environment,
            )
        collected = run.collect_existing_artifacts()
        self.assertIn("reports/child.json", collected)
        run.finalize(result={"status": "passed"})
        run.publish_latest()
        run.close()
        self.assertEqual(
            self.store.latest("child-gate")["artifacts"]["reports/child.json"],
            collected["reports/child.json"].to_dict(),
        )

    def test_subprocess_context_is_required_and_workspace_bound(self) -> None:
        with self.assertRaises(EvidenceRootInvalid):
            current_run_directory(
                repo_root=self.worktree,
                environment={ARTIFACT_ROOT_ENV: str(self.root)},
            )
        run = self.store.begin_run("child-gate", source={})
        environment = run.subprocess_environment({})
        environment["PT_ACCEPTANCE_WORKSPACE_ID"] = "0" * 16
        with self.assertRaises(EvidenceManifestInvalid):
            current_run_directory(
                repo_root=self.worktree,
                environment=environment,
            )
        run.close()

    def test_artifact_session_standalone_finalizes_and_publishes(self) -> None:
        with patch.dict(
            os.environ,
            {ARTIFACT_ROOT_ENV: str(self.root)},
            clear=True,
        ):
            with ArtifactSession(
                repo_root=self.worktree,
                gate_id="session-gate",
                source={},
            ) as session:
                reference = session.write_json(
                    "reports/session.json",
                    {"status": "passed"},
                    role="report",
                )
                self.assertEqual(
                    session.subprocess_environment({})["PT_ACCEPTANCE_RUN_ID"],
                    session.run_id,
                )
                with patch.dict(
                    os.environ,
                    session.subprocess_environment(),
                    clear=True,
                ):
                    write_current_artifact(
                        "logs/direct.log",
                        b"collected\n",
                        repo_root=self.worktree,
                    )
                manifest_ref = session.complete(
                    status="passed",
                    completion_status="DONE",
                    proof_status="PROVEN",
                )
            self.assertIsNotNone(manifest_ref)
            self.assertEqual(
                self.store.latest("session-gate")["artifacts"]["report"],
                reference.to_dict(),
            )
            self.assertIn(
                "logs/direct.log",
                self.store.latest("session-gate")["artifacts"],
            )

    def test_artifact_session_child_reuses_parent_run(self) -> None:
        run = self.store.begin_run("session-gate", source={})
        with patch.dict(
            os.environ,
            run.subprocess_environment({}),
            clear=True,
        ):
            with ArtifactSession(
                repo_root=self.worktree,
                gate_id="session-gate",
            ) as session:
                self.assertEqual(
                    session.subprocess_environment({})["PT_ACCEPTANCE_RUN_ID"],
                    run.run_id,
                )
                reference = session.write_json(
                    "reports/child-session.json",
                    {"status": "passed"},
                    role="report",
                )
                self.assertIsNone(
                    session.complete(
                        status="passed",
                        completion_status="DONE",
                        proof_status="PROVEN",
                    )
                )
        self.assertEqual(reference.run_id, run.run_id)
        collected = run.collect_existing_artifacts()
        self.assertEqual(collected["report"], reference)
        run.finalize(result={"status": "passed"})
        run.publish_latest()
        run.close()
        self.assertEqual(
            self.store.latest("session-gate")["artifacts"]["report"],
            reference.to_dict(),
        )

    def test_same_path_is_idempotent_but_conflicting_bytes_fail(self) -> None:
        run = self.store.begin_run("unit-gate", source={})
        first = run.write_bytes("evidence/value.txt", b"same")
        second = run.write_bytes("evidence/value.txt", b"same")
        self.assertEqual(first, second)
        with self.assertRaises(EvidenceConflict):
            run.write_bytes("evidence/value.txt", b"different")
        run.close()

    def test_configured_secrets_are_redacted_before_artifact_persistence(
        self,
    ) -> None:
        run = self.store.begin_run("redaction-gate", source={})
        run.configure_redaction(("resolved-secret",))
        reference = run.write_bytes(
            "reports/result.json",
            b'{"value":"resolved-secret"}\n',
        )

        persisted = self.store.resolve(reference).read_text(encoding="utf-8")
        self.assertNotIn("resolved-secret", persisted)
        self.assertIn(REDACTED, persisted)
        self.assertEqual(run.redacted_artifacts, ("reports/result.json",))
        self.assertIn(
            "PT_ACCEPTANCE_REDACTION_VALUES",
            run.subprocess_environment({}),
        )
        run.close()

    def test_runtime_cell_latest_pointer_is_isolated(self) -> None:
        linux = self.store.begin_run("runtime-gate", source={})
        linux.finalize(
            result={
                "status": "passed",
                "runtimeCell": "desktop-linux-native",
            }
        )
        linux.publish_latest(runtime_cell="desktop-linux-native")
        linux.close()

        windows = self.store.begin_run("runtime-gate", source={})
        windows.finalize(
            result={
                "status": "passed",
                "runtimeCell": "desktop-windows-native",
            }
        )
        windows.publish_latest(runtime_cell="desktop-windows-native")
        windows.close()

        self.assertEqual(
            self.store.latest(
                "runtime-gate",
                runtime_cell="desktop-linux-native",
            )["runId"],
            linux.run_id,
        )
        self.assertEqual(
            self.store.latest(
                "runtime-gate",
                runtime_cell="desktop-windows-native",
            )["runId"],
            windows.run_id,
        )

    def test_discard_removes_active_run_without_publishing(self) -> None:
        run = self.store.begin_run("discard-gate", source={})
        run.write_bytes("reports/partial.txt", b"partial")
        run.discard()

        self.assertEqual(run.state, "CLOSED")
        self.assertFalse(run.run_dir.exists())
        with self.assertRaises(EvidenceManifestInvalid):
            self.store.latest("discard-gate")

    def test_path_traversal_and_invalid_identity_are_rejected(self) -> None:
        run = self.store.begin_run("unit-gate", source={})
        for value in (
            "../outside",
            "/absolute",
            "C:/drive",
            "nested\\windows",
            ".",
            "nested/../outside",
            "value\x00suffix",
        ):
            with self.subTest(value=value), self.assertRaises(EvidencePathTraversal):
                run.write_bytes(value, b"value")
        with self.assertRaises(EvidencePathTraversal):
            self.store.begin_run("../gate", source={})
        run.close()

    def test_symlink_escape_is_rejected(self) -> None:
        run = self.store.begin_run("unit-gate", source={})
        outside = self.base / "outside"
        outside.mkdir()
        (run.run_dir / "evidence").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(EvidenceSymlinkRejected):
            run.write_bytes("evidence/escaped.txt", b"value")
        self.assertFalse((outside / "escaped.txt").exists())
        run.close()

    def test_internal_directory_pointer_and_lock_symlinks_are_rejected(
        self,
    ) -> None:
        external = self.base / "external"
        external.mkdir()

        root_link = self.base / "root-link"
        root_link.symlink_to(external, target_is_directory=True)
        with self.assertRaises(EvidenceSymlinkRejected):
            resolve_artifact_root(
                repo_root=self.worktree,
                environment={ARTIFACT_ROOT_ENV: str(root_link)},
            )
        with self.assertRaises(EvidenceSymlinkRejected):
            EvidenceStore(root_link, worktree=self.worktree)

        linked_parent = self.base / "linked-parent"
        linked_parent.symlink_to(external, target_is_directory=True)
        with self.assertRaises(EvidenceSymlinkRejected):
            resolve_artifact_root(
                repo_root=self.worktree,
                environment={
                    ARTIFACT_ROOT_ENV: str(
                        linked_parent / "acceptance"
                    )
                },
            )

        linked_root = self.base / "linked-root"
        linked_root.mkdir()
        (linked_root / workspace_id(self.worktree)).symlink_to(
            external,
            target_is_directory=True,
        )
        with self.assertRaises(EvidenceSymlinkRejected):
            EvidenceStore(linked_root, worktree=self.worktree)

        gate_link = self.store.workspace_dir / "linked-gate"
        gate_link.symlink_to(external, target_is_directory=True)
        with self.assertRaises(EvidenceSymlinkRejected):
            self.store.begin_run("linked-gate", source={})

        latest_run = self.store.begin_run("latest-link-gate", source={})
        latest_run.finalize(result={"status": "passed"})
        latest_path = latest_run.publish_latest()
        external_latest = external / "latest.json"
        external_latest.write_bytes(latest_path.read_bytes())
        latest_path.unlink()
        latest_path.symlink_to(external_latest)
        with self.assertRaises(EvidenceSymlinkRejected):
            self.store.latest("latest-link-gate")
        latest_run.close()

        lock_run = self.store.begin_run("lock-link-gate", source={})
        lock_run.finalize(result={"status": "passed"})
        external_lock = external / "publish.lock"
        external_lock.touch()
        (lock_run.run_dir.parent / ".publish.lock").symlink_to(
            external_lock
        )
        with self.assertRaises(EvidenceSymlinkRejected):
            lock_run.publish_latest()
        lock_run.close()

    def test_byte_budget_fails_closed(self) -> None:
        store = EvidenceStore(
            self.base / "budget-artifacts",
            worktree=self.worktree,
            byte_budget=4,
        )
        run = store.begin_run("unit-gate", source={})
        run.write_bytes("evidence/first", b"1234")
        with self.assertRaises(EvidenceQuotaExceeded):
            run.write_bytes("evidence/second", b"5")
        self.assertFalse((run.run_dir / "evidence/second").exists())
        run.close()

    def test_duplicate_run_id_fails(self) -> None:
        run = self.store.begin_run("unit-gate", source={})
        with self.assertRaises(EvidenceConflict):
            self.store.begin_run("unit-gate", source={}, run_id=run.run_id)
        run.close()

    def test_artifact_ref_rejects_wrong_workspace_and_hash(self) -> None:
        run = self.store.begin_run("unit-gate", source={})
        reference = run.write_bytes("evidence/value", b"value")
        wrong_workspace = ArtifactRef(
            workspace_id="0" * 16,
            gate_id=reference.gate_id,
            run_id=reference.run_id,
            path=reference.path,
            sha256=reference.sha256,
            media_type=reference.media_type,
        )
        with self.assertRaises(EvidenceManifestInvalid):
            self.store.resolve(wrong_workspace)
        (run.run_dir / reference.path).write_bytes(b"tampered")
        with self.assertRaises(EvidenceManifestInvalid):
            self.store.resolve(reference)
        run.close()

    def test_explicit_manifest_read_and_candidate_proof_cas(self) -> None:
        candidate = self.store.begin_run("proof-gate", source={})
        candidate.finalize(
            result={"status": "passed", "proofStatus": "CANDIDATE"}
        )
        candidate_ref = candidate.manifest_ref
        candidate.close()
        manifest = self.store.read_run_manifest(
            candidate_ref,
            manifest_sha256=candidate_ref.sha256,
            expected_gate_id="proof-gate",
        )
        self.assertEqual(manifest["runId"], candidate_ref.run_id)
        with self.assertRaises(EvidenceManifestInvalid):
            self.store.read_run_manifest(
                candidate_ref,
                manifest_sha256="0" * 64,
            )

        first = self.store.begin_run("proof-gate.validator", source={})
        first_ref = first.write_json(
            "proof/envelope.json",
            {"proofStatus": "PROVEN"},
            role="proof-envelope",
        )
        first.finalize(result={"status": "passed"})
        first.close()
        pointer = self.store.publish_candidate_proof(
            candidate_manifest=candidate_ref,
            proof_envelope=first_ref,
        )
        self.assertEqual(
            json.loads(pointer.read_text())["proofEnvelope"],
            first_ref.to_dict(),
        )
        self.assertEqual(
            self.store.publish_candidate_proof(
                candidate_manifest=candidate_ref,
                proof_envelope=first_ref,
            ),
            pointer,
        )

        second = self.store.begin_run("proof-gate.validator", source={})
        second_ref = second.write_json(
            "proof/envelope.json",
            {"proofStatus": "PROVEN", "other": True},
            role="proof-envelope",
        )
        second.finalize(result={"status": "passed"})
        second.close()
        with self.assertRaises(EvidenceConflict):
            self.store.publish_candidate_proof(
                candidate_manifest=candidate_ref,
                proof_envelope=second_ref,
            )

    def test_active_and_latest_runs_are_cleanup_protected(self) -> None:
        active = self.store.begin_run("unit-gate", source={})
        with self.assertRaises(EvidenceRunActive):
            self.store.delete_run("unit-gate", active.run_id)
        active.finalize(result={"status": "failed", "proofStatus": "UNPROVEN"})
        active.publish_latest()
        active.close()
        with self.assertRaises(EvidenceConflict):
            self.store.delete_run("unit-gate", active.run_id)

        old = self.store.begin_run("unit-gate", source={})
        old.finalize(result={"status": "passed", "proofStatus": "PROVEN"})
        old.close()
        self.store.delete_run("unit-gate", old.run_id)
        self.assertFalse(old.run_dir.exists())

    def test_newer_completion_cannot_be_replaced_by_older_run(self) -> None:
        with patch(
            "tooling.acceptance.core.evidence_store._utc_now",
            return_value="2026-08-17T10:00:00.000000+00:00",
        ):
            older = self.store.begin_run("unit-gate", source={})
        with patch(
            "tooling.acceptance.core.evidence_store._utc_now",
            return_value="2026-08-17T10:00:01.000000+00:00",
        ):
            newer = self.store.begin_run("unit-gate", source={})
        with patch(
            "tooling.acceptance.core.evidence_store._utc_now",
            return_value="2026-08-17T10:00:02.000000+00:00",
        ):
            older.finalize(result={"status": "passed"})
        with patch(
            "tooling.acceptance.core.evidence_store._utc_now",
            return_value="2026-08-17T10:00:03.000000+00:00",
        ):
            newer.finalize(result={"status": "passed"})
        newer.publish_latest()
        older.publish_latest()
        older.close()
        newer.close()
        self.assertEqual(self.store.latest("unit-gate")["runId"], newer.run_id)

    def test_interrupted_latest_keeps_previous_pointer(self) -> None:
        first = self.store.begin_run("unit-gate", source={})
        first.finalize(result={"status": "passed"})
        latest_path = first.publish_latest()
        first.close()
        original = latest_path.read_bytes()

        second = self.store.begin_run("unit-gate", source={})
        second.finalize(result={"status": "passed"})
        real_replace = os.replace

        def fail_latest(source: object, target: object) -> None:
            if Path(target).name == "latest.json":
                raise OSError(errno.EIO, "injected interruption")
            real_replace(source, target)

        with patch(
            "tooling.acceptance.core.evidence_store.os.replace",
            side_effect=fail_latest,
        ), self.assertRaises(Exception):
            second.publish_latest()
        second.close()
        self.assertEqual(latest_path.read_bytes(), original)
        self.assertEqual(self.store.latest("unit-gate")["runId"], first.run_id)

    def test_malformed_latest_fails_typed_and_blocks_publish(self) -> None:
        first = self.store.begin_run("unit-gate", source={})
        first.finalize(result={"status": "passed"})
        latest_path = first.publish_latest()
        first.close()
        latest_path.write_text('{"artifactKind":"acceptance-latest-pointer"}\n')

        with self.assertRaises(EvidenceManifestInvalid):
            self.store.latest("unit-gate")

        second = self.store.begin_run("unit-gate", source={})
        second.finalize(result={"status": "passed"})
        with self.assertRaises(EvidenceManifestInvalid):
            second.publish_latest()
        second.close()

    def test_permission_and_no_space_errors_are_typed(self) -> None:
        permission_run = self.store.begin_run("permission-gate", source={})
        real_open = Path.open

        def deny_temporary(path: Path, *args: object, **kwargs: object):
            if ".tmp-" in path.name:
                raise PermissionError(errno.EACCES, "denied")
            return real_open(path, *args, **kwargs)

        with patch.object(Path, "open", deny_temporary), self.assertRaises(
            EvidencePermissionDenied
        ):
            permission_run.write_bytes("evidence/value", b"value")
        permission_run.close()

        full_run = self.store.begin_run("full-gate", source={})

        def full_temporary(path: Path, *args: object, **kwargs: object):
            if ".tmp-" in path.name:
                raise OSError(errno.ENOSPC, "full")
            return real_open(path, *args, **kwargs)

        with patch.object(Path, "open", full_temporary), self.assertRaises(
            EvidenceNoSpace
        ):
            full_run.write_bytes("evidence/value", b"value")
        full_run.close()

    def test_two_concurrent_runs_do_not_overwrite(self) -> None:
        run_ids: list[str] = []
        failures: list[BaseException] = []
        mutex = threading.Lock()

        def worker(index: int) -> None:
            try:
                run = self.store.begin_run("concurrent-gate", source={"worker": index})
                run.write_json(
                    "reports/result.json",
                    {"worker": index},
                    role="report",
                )
                run.finalize(result={"status": "passed", "worker": index})
                run.publish_latest()
                run.close()
                with mutex:
                    run_ids.append(run.run_id)
            except BaseException as error:
                with mutex:
                    failures.append(error)

        threads = [threading.Thread(target=worker, args=(index,)) for index in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        self.assertEqual(failures, [])
        self.assertEqual(len(set(run_ids)), 2)
        gate_dir = self.store.workspace_dir / "concurrent-gate"
        self.assertEqual(
            len([path for path in gate_dir.iterdir() if path.is_dir()]),
            2,
        )
        self.assertIn(self.store.latest("concurrent-gate")["runId"], run_ids)

    def test_two_concurrent_processes_do_not_overwrite(self) -> None:
        context = multiprocessing.get_context("spawn")
        result_queue = context.Queue()
        processes = [
            context.Process(
                target=_process_writer,
                args=(
                    str(self.root),
                    str(self.worktree),
                    index,
                    result_queue,
                ),
            )
            for index in range(2)
        ]
        for process in processes:
            process.start()
        for process in processes:
            process.join(timeout=15)
            self.assertEqual(process.exitcode, 0)
        results = [result_queue.get(timeout=5) for _ in processes]
        self.assertFalse(
            [result["error"] for result in results if "error" in result]
        )
        run_ids = {result["runId"] for result in results}
        self.assertEqual(len(run_ids), 2)
        self.assertIn(
            self.store.latest("process-concurrent-gate")["runId"],
            run_ids,
        )

    @unittest.skipIf(os.name == "nt", "POSIX permission scenario")
    def test_read_only_worktree_still_emits_external_evidence(self) -> None:
        self.worktree.chmod(0o555)
        try:
            with patch.dict(
                os.environ,
                {ARTIFACT_ROOT_ENV: str(self.root)},
                clear=True,
            ):
                with ArtifactSession(
                    repo_root=self.worktree,
                    gate_id="read-only-worktree-gate",
                    source={},
                ) as session:
                    session.write_json(
                        "reports/result.json",
                        {"status": "passed"},
                        role="report",
                    )
                    session.complete(
                        status="passed",
                        completion_status="DONE",
                        proof_status="PROVEN",
                    )
            self.assertEqual(list(self.worktree.iterdir()), [])
            self.assertEqual(
                self.store.latest("read-only-worktree-gate")["result"][
                    "proofStatus"
                ],
                "PROVEN",
            )
        finally:
            self.worktree.chmod(0o700)

    @unittest.skipIf(os.name == "nt", "POSIX permission scenario")
    def test_unwritable_root_fails_without_worktree_fallback(self) -> None:
        protected_parent = Path(
            "/System" if sys.platform == "darwin" else "/proc"
        )
        protected_root = (
            protected_parent
            / f"pt-acceptance-unwritable-{self.base.name}"
        )
        with patch.dict(
            os.environ,
            {ARTIFACT_ROOT_ENV: str(protected_root)},
            clear=True,
        ):
            with self.assertRaises(EvidencePermissionDenied):
                EvidenceStore.from_environment(
                    repo_root=self.worktree,
                    worktree=self.worktree,
                )
        self.assertEqual(list(self.worktree.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
