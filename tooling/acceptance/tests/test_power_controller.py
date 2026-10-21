from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from tooling.acceptance.core import finalization_contracts as contracts
from tooling.acceptance.core.evidence_store import EvidenceStore
from tooling.acceptance.core.errors import EvidenceConflict, EvidenceManifestInvalid
from tooling.acceptance.core.power_controller import (
    ControllerStore,
    Ed25519SigningAuthority,
    PowerCommand,
    PowerController,
)
from tooling.acceptance.core.trust_admission import TrustAdmission


SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64


def process_identity() -> contracts.ProcessStartIdentity:
    if sys.platform == "darwin":
        return contracts.DarwinProcessStartIdentity.create(
            boot_session_uuid="synthetic-boot",
            start_seconds="1",
            start_microseconds="2",
        )
    return contracts.LinuxProcessStartIdentity.create(
        boot_id="synthetic-boot",
        start_clock_ticks="1",
    )


def install_active_trust(
    store: EvidenceStore,
    gate_id: str,
    public_key: bytes,
) -> tuple[
    contracts.ActivePowerControllerTrustGeneration,
    contracts.PowerControllerTrustCurrent,
]:
    trust_dir = (
        store.workspace_dir
        / gate_id
        / "finalizer-enforcement"
        / "controller-trust"
    )
    (trust_dir / "generations").mkdir(parents=True, exist_ok=True)
    anchor = {
        "artifactKind": "acceptance-power-controller-trust-anchor",
        "schemaVersion": 1,
        "workspaceId": store.workspace_id,
        "gateId": gate_id,
        "trustGeneration": 1,
        "predecessorGenerationRef": None,
        "controllerIdentity": {"kind": "synthetic"},
        "controllerSignatureAlgorithm": "ED25519",
        "controllerPublicKeyHex": public_key.hex(),
        "controllerPublicKeySha256": hashlib.sha256(public_key).hexdigest(),
        "controllerRuntime": {"runtime": "synthetic"},
        "controllerRuntimeLockBackend": {"backend": "synthetic"},
        "bootstrapCandidateDigest": SHA_B,
        "qualificationManifestDigest": SHA_C,
        "qualifiedBackendIdentityDigest": SHA_B,
        "ownerApprovalDocumentPath": "docs/architecture/engineering/acceptance/decisions.md",
        "ownerApprovalDocumentSha256": SHA_C,
        "sourceCommit": "1" * 40,
        "enrolledAt": "2026-10-18T00:00:00+00:00",
        "enrollmentAuthorization": {"authorization": "synthetic"},
    }
    anchor["trustAnchorDigest"] = contracts.domain_separated_sha256(
        "pt.acceptance.finalization.durability-power-controller-trust-anchor.v1",
        anchor,
    )
    generation = contracts.ActivePowerControllerTrustGeneration.create(
        workspace_id=store.workspace_id,
        gate_id=gate_id,
        trust_generation=1,
        predecessor_generation_ref=None,
        trust_anchor_digest=anchor["trustAnchorDigest"],
    )
    current = contracts.PowerControllerTrustCurrent.create(
        workspace_id=store.workspace_id,
        gate_id=gate_id,
        generation_ref=generation.reference(),
    )
    (trust_dir / f"{anchor['trustAnchorDigest']}.json").write_text(
        json.dumps(anchor), encoding="utf-8"
    )
    (
        trust_dir
        / "generations"
        / f"1-{generation.trust_generation_digest}.json"
    ).write_text(json.dumps(generation.to_dict()), encoding="utf-8")
    (trust_dir / "current.json").write_text(
        json.dumps(current.to_dict()), encoding="utf-8"
    )
    return generation, current


class PowerControllerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        base = Path(self.temporary.name)
        worktree = base / "worktree"
        worktree.mkdir()
        self.evidence = EvidenceStore(base / "evidence", worktree=worktree)
        self.gate_id = "synthetic-gate"
        key = Ed25519PrivateKey.generate()
        public = key.public_key().public_bytes(
            serialization.Encoding.Raw,
            serialization.PublicFormat.Raw,
        )
        self.generation, self.current = install_active_trust(
            self.evidence, self.gate_id, public
        )
        self.authority = Ed25519SigningAuthority(public, key.sign)
        self.controller = PowerController(
            ControllerStore(base / "controller"),
            self.authority,
            controller_identity_digest=SHA_A,
            runtime_identity_digest=SHA_B,
            process_start_identity=process_identity(),
        )
        self.release_token = b"release-token"
        self.command = PowerCommand(
            command_id="command-1",
            workspace_id=self.evidence.workspace_id,
            gate_id=self.gate_id,
            crash_fixture_id="fixture-1",
            qualification_run_id="qualification-1",
            case_id="case-1",
            expectation_digest=SHA_A,
            execution_start_digest=SHA_B,
            interruption_point="AFTER_DIRECTORY_SYNC",
            release_token_sha256=hashlib.sha256(
                self.release_token
            ).hexdigest(),
            selected_trust_generation_ref=self.generation.reference(),
            selected_current_trust_digest=self.current.current_trust_digest,
        )

    def tearDown(self) -> None:
        self.controller.close()
        self.temporary.cleanup()

    def test_durable_one_shot_dispatch(self) -> None:
        accepted = self.controller.accept(self.command)
        self.assertEqual(accepted["commandState"], "ACCEPTED")
        armed = self.controller.transition(
            self.command,
            target_state="ARMED",
            release_token=self.release_token,
        )
        self.assertEqual(armed["commandState"], "ARMED")
        started = self.controller.transition(
            self.command,
            target_state="EXECUTION_STARTED",
        )
        self.assertEqual(started["commandState"], "EXECUTION_STARTED")
        binding = self.controller.prepare_dispatch_binding(self.command)
        held = TrustAdmission(self.evidence).acquire_dispatch_lease(
            gate_id=self.gate_id,
            binding=binding,
            expected_generation_ref=self.generation.reference(),
            expected_current_trust_digest=self.current.current_trust_digest,
        )
        calls = []

        def actuator() -> None:
            head = self.controller.store.read(
                "commands/command-1/head.json"
            )
            self.assertEqual(head["commandState"], "ACTION_DISPATCHED")
            calls.append("power-cut")

        with held:
            executed = self.controller.dispatch(
                self.command,
                held_trust_lease=held,
                actuator=actuator,
            )
        self.assertEqual(executed["commandState"], "EXECUTED")
        self.assertEqual(calls, ["power-cut"])
        transitions = sorted(
            (
                self.controller.store.root
                / "commands"
                / "command-1"
                / "transitions"
            ).glob("*.json")
        )
        self.assertEqual(len(transitions), 5)
        with self.assertRaises(EvidenceConflict):
            self.controller.dispatch(
                self.command,
                held_trust_lease=held,
                actuator=actuator,
            )
        self.assertEqual(calls, ["power-cut"])

    def test_bad_release_token_and_signer_fail_closed(self) -> None:
        self.controller.accept(self.command)
        with self.assertRaises(EvidenceConflict):
            self.controller.transition(
                self.command,
                target_state="ARMED",
                release_token=b"wrong",
            )
        key = Ed25519PrivateKey.generate()
        other = Ed25519PrivateKey.generate()
        public = key.public_key().public_bytes(
            serialization.Encoding.Raw,
            serialization.PublicFormat.Raw,
        )
        with self.assertRaises(EvidenceManifestInvalid):
            PowerController(
                ControllerStore(Path(self.temporary.name) / "bad-controller"),
                Ed25519SigningAuthority(public, other.sign),
                controller_identity_digest=SHA_A,
                runtime_identity_digest=SHA_B,
                process_start_identity=process_identity(),
            )

    def test_corrupt_head_is_not_an_absent_command(self) -> None:
        self.controller.accept(self.command)
        path = self.controller.store.root / "commands/command-1/head.json"
        path.write_bytes(b"{")
        before = path.read_bytes()
        with self.assertRaises(EvidenceManifestInvalid):
            self.controller.accept(self.command)
        self.assertEqual(path.read_bytes(), before)

    def test_digest_rewritten_head_cannot_skip_release_token(self) -> None:
        head = self.controller.accept(self.command)
        head["commandState"] = "ARMED"
        head["commandJournalHeadDigest"] = contracts.domain_separated_sha256(
            "pt.acceptance.finalization.durability-power-controller-command-journal-head.v1",
            {
                key: value for key, value in head.items()
                if key != "commandJournalHeadDigest"
            },
        )
        self.controller.store.replace("commands/command-1/head.json", head)
        with self.assertRaises(EvidenceManifestInvalid):
            self.controller.transition(
                self.command, target_state="EXECUTION_STARTED"
            )

    def test_unsigned_journal_mutation_rejects_equal_retry(self) -> None:
        self.controller.accept(self.command)
        relative = "commands/command-1/transitions/1-ACCEPTED.json"
        payload = self.controller.store.read(relative)
        payload["expectationDigest"] = SHA_C
        self.controller.store.replace(relative, payload)
        with self.assertRaises(EvidenceManifestInvalid):
            self.controller.accept(self.command)

    def test_rehashed_journal_still_requires_its_signature(self) -> None:
        self.controller.accept(self.command)
        relative = "commands/command-1/transitions/1-ACCEPTED.json"
        payload = self.controller.store.read(relative)
        payload["transitionedAt"] = "2026-10-19T00:00:00+00:00"
        payload["commandJournalDigest"] = contracts.domain_separated_sha256(
            "pt.acceptance.finalization.durability-power-controller-command-journal.v1",
            {key: value for key, value in payload.items() if key != "commandJournalDigest"},
        )
        self.controller.store.replace(relative, payload)
        with self.assertRaises(EvidenceManifestInvalid):
            self.controller.accept(self.command)

    def test_closed_controller_cannot_mutate(self) -> None:
        self.controller.close()
        with self.assertRaises(EvidenceConflict):
            self.controller.accept(self.command)
        self.assertFalse(
            (self.controller.store.root / "commands/command-1").exists()
        )

    def test_superseded_current_epoch_cannot_mutate(self) -> None:
        current = self.controller.store.read("current.json")
        current["controllerRuntimeEpochDigest"] = SHA_C
        self.controller.store.replace("current.json", current)
        with self.assertRaises(EvidenceConflict):
            self.controller.accept(self.command)

    def test_replaced_runtime_lock_cannot_mutate(self) -> None:
        path = self.controller.store.root / ".runtime.lock"
        path.rename(path.with_name(".runtime.lock.old"))
        path.touch()
        with self.assertRaises(EvidenceConflict):
            self.controller.accept(self.command)

    def test_store_rejects_symlinked_parent_before_read_or_write(self) -> None:
        outside = Path(self.temporary.name) / "outside"
        outside.mkdir()
        (outside / "artifact.json").write_text('{"outside":true}')
        (self.controller.store.root / "redirect").symlink_to(
            outside, target_is_directory=True
        )
        with self.assertRaises(EvidenceManifestInvalid):
            self.controller.store.read("redirect/artifact.json")
        with self.assertRaises(EvidenceManifestInvalid):
            self.controller.store.replace("redirect/artifact.json", {"bad": True})
        self.assertEqual(
            (outside / "artifact.json").read_text(), '{"outside":true}'
        )

    def test_equal_retry_requires_fresh_durability_ack(self) -> None:
        self.controller.accept(self.command)
        with mock.patch.object(
            self.controller.store, "_sync_fd", side_effect=OSError("sync failed")
        ):
            with self.assertRaises(OSError):
                self.controller.accept(self.command)

    def _start_execution(self) -> None:
        self.controller.accept(self.command)
        self.controller.transition(
            self.command, target_state="ARMED", release_token=self.release_token
        )
        self.controller.transition(self.command, target_state="EXECUTION_STARTED")

    def _lease(self):
        return TrustAdmission(self.evidence).acquire_dispatch_lease(
            gate_id=self.gate_id,
            binding=self.controller.prepare_dispatch_binding(self.command),
            expected_generation_ref=self.generation.reference(),
            expected_current_trust_digest=self.current.current_trust_digest,
        )

    def test_same_epoch_unheaded_safe_transition_is_adopted_once(self) -> None:
        self.controller.accept(self.command)
        original = self.controller.store.replace

        def lose_ack(relative, payload):
            if relative.endswith("/head.json") and payload["commandState"] == "ARMED":
                raise OSError("head publication interrupted")
            return original(relative, payload)

        with mock.patch.object(self.controller.store, "replace", side_effect=lose_ack):
            with self.assertRaises(OSError):
                self.controller.transition(
                    self.command, target_state="ARMED", release_token=self.release_token
                )
        recovered = self.controller.accept(self.command)
        self.assertEqual(recovered["commandState"], "ARMED")
        self.assertEqual(
            len(tuple((self.controller.store.root / "commands/command-1/transitions").glob("*.json"))),
            2,
        )
        self.assertEqual(self.controller.accept(self.command), recovered)

    def test_unheaded_dispatch_never_grants_a_later_actuator_call(self) -> None:
        self._start_execution()
        original = self.controller.store.replace

        def lose_ack(relative, payload):
            if relative.endswith("/head.json") and payload["commandState"] == "ACTION_DISPATCHED":
                raise OSError("dispatch head publication interrupted")
            return original(relative, payload)

        calls = []
        with self._lease() as lease:
            with mock.patch.object(self.controller.store, "replace", side_effect=lose_ack):
                with self.assertRaises(OSError):
                    self.controller.dispatch(self.command, held_trust_lease=lease, actuator=lambda: calls.append(1))
            with self.assertRaises(EvidenceConflict):
                self.controller.dispatch(self.command, held_trust_lease=lease, actuator=lambda: calls.append(1))
        self.assertEqual(calls, [])

    def test_actuator_exception_leaves_durable_uncertain_dispatch(self) -> None:
        self._start_execution()
        calls = []

        def actuator():
            calls.append(1)
            raise RuntimeError("power acknowledgement lost")

        with self._lease() as lease:
            with self.assertRaises(RuntimeError):
                self.controller.dispatch(self.command, held_trust_lease=lease, actuator=actuator)
            with self.assertRaises(EvidenceConflict):
                self.controller.dispatch(self.command, held_trust_lease=lease, actuator=actuator)
        self.assertEqual(calls, [1])
        self.assertEqual(self.controller.store.read("commands/command-1/head.json")["commandState"], "ACTION_DISPATCHED")

    def test_restart_invalidates_prior_nonterminal_command(self) -> None:
        self.controller.accept(self.command)
        store = self.controller.store
        previous = self.controller.epoch["controllerRuntimeEpochDigest"]
        self.controller.close()
        self.controller = PowerController(
            store, self.authority, controller_identity_digest=SHA_A,
            runtime_identity_digest=SHA_B, process_start_identity=process_identity(),
        )
        self.assertEqual(self.controller.epoch["previousEpochDigest"], previous)
        with self.assertRaises(EvidenceConflict):
            self.controller.accept(self.command)
        self.assertEqual(
            self.controller.accept(replace(self.command, command_id="command-2"))["commandState"],
            "ACCEPTED",
        )

    def test_runtime_contention_fails_without_replacing_current(self) -> None:
        before = self.controller.store.read("current.json")
        with self.assertRaises(BlockingIOError):
            PowerController(
                self.controller.store, self.authority, controller_identity_digest=SHA_A,
                runtime_identity_digest=SHA_B, process_start_identity=process_identity(),
            )
        self.assertEqual(self.controller.store.read("current.json"), before)

    def test_forked_process_cannot_use_inherited_controller(self) -> None:
        child = os.fork()
        if child == 0:
            try:
                self.controller.accept(self.command)
            except EvidenceConflict:
                os._exit(0)
            except BaseException:
                os._exit(2)
            os._exit(1)
        _, status = os.waitpid(child, 0)
        self.assertEqual(os.waitstatus_to_exitcode(status), 0)
        self.assertFalse((self.controller.store.root / "commands/command-1").exists())

    def test_regular_file_aliases_are_rejected(self) -> None:
        path = self.controller.store.root / "aliased.json"
        path.write_bytes(b"{}")
        os.link(path, path.with_name("alias.json"))
        with self.assertRaises(EvidenceManifestInvalid):
            self.controller.store.read("aliased.json")

    def test_noncanonical_and_duplicate_key_json_are_rejected(self) -> None:
        path = self.controller.store.root / "invalid.json"
        for encoded in (b'{"value":1, "value":2}', b'{"value": 1}', b'[]'):
            with self.subTest(encoded=encoded):
                path.write_bytes(encoded)
                with self.assertRaises(EvidenceManifestInvalid):
                    self.controller.store.read("invalid.json")

    def test_store_cleans_temporary_file_when_sync_fails(self) -> None:
        with mock.patch.object(
            self.controller.store, "_sync_fd", side_effect=OSError("sync failed")
        ):
            with self.assertRaises(OSError):
                self.controller.store.write_immutable("failed.json", {})
        self.assertFalse((self.controller.store.root / "failed.json").exists())
        self.assertEqual(list(self.controller.store.root.glob(".*.tmp")), [])

    def test_journal_fork_is_rejected_before_any_transition(self) -> None:
        self.controller.accept(self.command)
        original = self.controller.store.replace

        def lose_ack(relative, payload):
            if relative.endswith("/head.json") and payload["commandState"] == "ARMED":
                raise OSError("lost head")
            return original(relative, payload)

        with mock.patch.object(self.controller.store, "replace", side_effect=lose_ack):
            with self.assertRaises(OSError):
                self.controller.transition(
                    self.command, target_state="ARMED", release_token=self.release_token
                )
        sibling = self.controller.store.read("commands/command-1/transitions/2-ARMED.json")
        sibling["commandState"] = "CANCELLED"
        sibling["signatureHex"] = self.authority.sign_payload({
            key: value for key, value in sibling.items()
            if key not in {"signatureHex", "commandJournalDigest"}
        })
        sibling["commandJournalDigest"] = contracts.domain_separated_sha256(
            "pt.acceptance.finalization.durability-power-controller-command-journal.v1",
            {key: value for key, value in sibling.items() if key != "commandJournalDigest"},
        )
        self.controller.store.write_immutable("commands/command-1/transitions/2-CANCELLED.json", sibling)
        with self.assertRaises(EvidenceManifestInvalid):
            self.controller.accept(self.command)

    def test_missing_current_never_bootstraps_over_existing_epochs(self) -> None:
        store = self.controller.store
        self.controller.close()
        (store.root / "current.json").unlink()
        with self.assertRaises(EvidenceManifestInvalid):
            PowerController(
                store, self.authority, controller_identity_digest=SHA_A,
                runtime_identity_digest=SHA_B, process_start_identity=process_identity(),
            )

    def test_deleted_dispatch_suffix_cannot_replay_in_live_process(self) -> None:
        self._start_execution()
        original_head = self.controller.store.read("commands/command-1/head.json")
        calls = []
        with self._lease() as lease:
            self.controller.dispatch(self.command, held_trust_lease=lease, actuator=lambda: calls.append(1))
            for name in ("4-ACTION_DISPATCHED.json", "5-EXECUTED.json"):
                (self.controller.store.root / "commands/command-1/transitions" / name).unlink()
            self.controller.store.replace("commands/command-1/head.json", original_head)
            with self.assertRaises(EvidenceConflict):
                self.controller.dispatch(self.command, held_trust_lease=lease, actuator=lambda: calls.append(1))
        self.assertEqual(calls, [1])

    def test_parent_rename_after_open_does_not_redirect_store_write(self) -> None:
        outside = Path(self.temporary.name) / "external-parent"
        outside.mkdir()
        self.controller.store.replace("namespace/artifact.json", {"original": True})
        namespace = self.controller.store.root / "namespace"
        original_write = os.write
        changed = False

        def rename_parent(descriptor, data):
            nonlocal changed
            if not changed:
                changed = True
                namespace.rename(namespace.with_name("held-namespace"))
                namespace.symlink_to(outside, target_is_directory=True)
            return original_write(descriptor, data)

        with mock.patch("os.write", side_effect=rename_parent):
            self.controller.store.replace("namespace/artifact.json", {"updated": True})
        self.assertFalse((outside / "artifact.json").exists())
        self.assertEqual(
            self.controller.store.read("held-namespace/artifact.json"), {"updated": True}
        )

    def test_trust_for_another_signer_never_reaches_actuator(self) -> None:
        other_key = Ed25519PrivateKey.generate()
        other_public = other_key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        self.generation, self.current = install_active_trust(self.evidence, self.gate_id, other_public)
        self.command = replace(
            self.command, selected_trust_generation_ref=self.generation.reference(),
            selected_current_trust_digest=self.current.current_trust_digest,
        )
        self._start_execution()
        calls = []
        with self._lease() as lease:
            with self.assertRaises(EvidenceConflict):
                self.controller.dispatch(self.command, held_trust_lease=lease, actuator=lambda: calls.append(1))
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
