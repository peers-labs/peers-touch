"""Runner binding and lifecycle regressions; these are not product proof."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.agent.foundation_runtime_client import FoundationClientError
from tooling.development.secure_content import prepared_native as module


class PreparedSocialNativeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = {"commit": "a" * 40, "workspaceDigest": "clean",
                       "canonicalWorktreeHash": "b" * 16}
        self.services = {
            role: {"kind": "station", "deploymentEnvironment": profile,
                   "endpoint": f"http://{role}.invalid", "liveCommit": self.source["commit"],
                   "runtimeIdentity": f"peer-{role}", "workspaceDigest": "clean",
                   "protocolDigest": "c" * 64}
            for role, profile in (("station-four", "station-five-arm"),
                                  ("station-five-arm", "station-four"))
        }
        self.manifest = {
            "gateId": module.GATE_ID, "environmentId": "cross-station-social-native",
            "runId": "prepared-run", "state": "FIXTURE_READY",
            "actorManifest": {"runId": "evidence-run"},
            "source": {**self.source, "worktree": str(self.root)},
            "profile": {"resolvedName": "fiveArm", "slot": 6},
            "services": self.services,
            "clients": [
                {"id": client_id, "actor": actor, "runtime": "native-tauri",
                 "worktree": str(self.root), "gateway_port": 4000 + index,
                 "renderer_port": 5000 + index, "webdriver_port": 6000 + index,
                 "profile": client_id, "storage_root": str(self.root / client_id / "storage"),
                 "storage_lifecycle": "ephemeral", "required_service_roles": ["station"],
                 "service_bindings": {"station": {"service_id": role, "required_kind": "station"}}}
                for index, (client_id, (actor, role)) in enumerate(module.CLIENT_BINDINGS.items())
            ],
        }
        self.actors = {
            "environmentId": self.manifest["environmentId"],
            "fixtureId": "cross-station-social-actors", "runId": self.manifest["runId"],
            "reset": {"targetVerified": True, "authorized": True},
            "actors": [{"role": role, "ptid": f"ptid:{role}",
                        "accountRef": f"station-account:{role}@p.t"}
                       for role in ("alice", "bob", "eve")],
        }
        self.sessions = []

        def launch(client_id, options):
            session = mock.Mock(profile=client_id, process_id=100 + len(self.sessions))
            session.is_alive.return_value = True
            session.stop.side_effect = lambda: setattr(session.is_alive, "return_value", False)
            self.sessions.append(session)
            return session

        self.binding = mock.Mock()
        self.binding.create_bound_session.side_effect = launch
        self.binding.runtime_identity.return_value = {"source": self.manifest["source"]}
        self.binding.finalize_cleanup.return_value = {
            "portsReleased": True, "processesReleased": True,
            "storageReleased": True, "logsReleased": True, "cleanupErrors": [],
        }
        self.logout = self.enterContext(mock.patch(
            "tooling.acceptance.gates.chat.native_support.logout_native_client",
        ))

    def prepared(self):
        return module.PreparedSocialNativeRuntime(
            SimpleNamespace(manifest=self.manifest, actor_manifest=self.actors, binding=self.binding),
            repo_root=self.root,
        )

    def test_prepared_binding_uses_workspace_slot_and_original_lifecycle(self) -> None:
        prepared = self.prepared()
        alice, bob = prepared.client("alice"), prepared.client("bob")
        alice.start()
        bob.start()
        with mock.patch(
            "tooling.acceptance.gates.agent.foundation_runtime_client.call_async_harness",
            return_value={"authenticated": True},
        ) as harness:
            alice.harness("restoreSessionWithPassword", {"account": "alice@p.t"}, timeout=12)
        harness.assert_called_once_with(
            alice.driver, "restoreSessionWithPassword", {"account": "alice@p.t"},
            namespace="moments", script_timeout=12,
        )
        self.assertEqual("authenticated", prepared.lifecycle.records[0].auth_state)
        bob.stop()
        replacement = prepared.client("bob2")
        replacement.start()
        options = [call.args[1] for call in self.binding.create_bound_session.call_args_list]
        self.assertEqual([(0, 2), (1, 2), (1, 2)],
                         [(value.window_slot, value.window_count) for value in options])
        prepared.cleanup()
        prepared.cleanup()
        self.assertEqual(3, self.logout.call_count)
        self.binding.finalize_cleanup.assert_called_once()
        self.assertEqual({"alice", "bob", "bob2"},
                         {call.args[0].profile for call in self.logout.call_args_list})
        self.assertTrue(all(record.process_state == "stopped" for record in prepared.lifecycle.records))

    def test_eve_repeated_launch_and_unreleased_replacement_are_rejected(self) -> None:
        prepared = self.prepared()
        with self.assertRaises(GateError):
            prepared.client("eve")
        alice = prepared.client("alice")
        alice.start()
        with self.assertRaises(FoundationClientError):
            alice.start()
        bob = prepared.client("bob")
        bob.start()
        replacement = prepared.client("bob2")
        with self.assertRaises(FoundationClientError):
            replacement.start()
        self.assertEqual(2, self.binding.create_bound_session.call_count)
        with self.assertRaises(GateError):
            prepared.client("alice")
        prepared.cleanup()

    def test_binding_drift_is_rejected_before_launch(self) -> None:
        original_manifest, original_actors = copy.deepcopy(self.manifest), copy.deepcopy(self.actors)
        cases = (
            lambda: self.actors.update(runId="foreign"),
            lambda: self.actors["reset"].update(targetVerified=False),
            lambda: self.manifest["source"].update(worktree=str(self.root / "foreign")),
            lambda: self.manifest["clients"][0].update(actor="bob"),
            lambda: self.manifest["clients"][0]["service_bindings"]["station"].update(service_id="station-five-arm"),
            lambda: self.manifest["clients"][1].update(storage_root=self.manifest["clients"][0]["storage_root"]),
            lambda: self.actors["actors"][1].update(ptid="ptid:alice"),
            lambda: self.manifest["services"]["station-four"].update(liveCommit="d" * 40),
        )
        for index, mutate in enumerate(cases):
            self.manifest, self.actors = copy.deepcopy(original_manifest), copy.deepcopy(original_actors)
            mutate()
            with self.subTest(case=index), self.assertRaises(GateError):
                self.prepared()
        self.binding.create_bound_session.assert_not_called()

    def test_actor_snapshot_and_mid_suite_source_drift_fail_closed(self) -> None:
        prepared = self.prepared()
        prepared.verify_snapshot("bob2", {"actorPtidSha256": hashlib.sha256(b"ptid:bob").hexdigest()})
        with self.assertRaises(GateError):
            prepared.verify_snapshot("bob2", {"actorPtidSha256": hashlib.sha256(b"ptid:alice").hexdigest()})
        prepared.verify_source()
        self.binding.runtime_identity.return_value["source"] = {**self.manifest["source"], "commit": "d" * 40}
        with self.assertRaises(GateError):
            prepared.verify_source()

    def test_replacement_requires_successfully_released_bob_and_cleanup_is_terminal(self) -> None:
        prepared = self.prepared()
        bob = prepared.client("bob")
        replacement = prepared.client("bob2")
        with self.assertRaises(FoundationClientError):
            replacement.start()
        bob.start()
        self.logout.side_effect = GateError("logout rejected")
        self.assertEqual("failed", bob.stop()["status"])
        with self.assertRaises(FoundationClientError):
            replacement.start()
        with self.assertRaises(GateError):
            prepared.cleanup()
        with self.assertRaises(FoundationClientError):
            replacement.start()
        with self.assertRaises(GateError):
            prepared.client("alice")

    def test_failed_logout_still_releases_process_and_repeats_original_failure(self) -> None:
        prepared = self.prepared()
        prepared.client("alice").start()
        self.logout.side_effect = GateError("logout rejected")
        for _ in range(2):
            with self.assertRaisesRegex(GateError, "logout rejected"):
                prepared.cleanup()
        self.logout.assert_called_once()
        self.sessions[0].stop.assert_called_once()
        self.binding.finalize_cleanup.assert_called_once()

    def suite_context(self, prepared):
        from tooling.development.secure_content.runtime_owner import W7RuntimeOwner
        owner = W7RuntimeOwner(repo_root=self.root, result_root=self.root / "results")
        self.enterContext(mock.patch.dict(os.environ, {
            "PT_ACCEPTANCE_AGGREGATE_SOURCE": json.dumps(self.source),
            "PT_ACCEPTANCE_RUN_ID": "evidence-run",
        }))
        self.enterContext(mock.patch(
            "tooling.acceptance.core.evidence_store.source_identity", return_value=self.source,
        ))
        return owner

    def test_original_suite_rejects_foreign_runner_before_schema_or_client(self) -> None:
        prepared = self.prepared()
        owner = self.suite_context(prepared)
        self.manifest["actorManifest"]["runId"] = "foreign"
        with mock.patch.object(prepared, "schema_bindings") as schemas:
            with self.assertRaisesRegex(Exception, "Runner and prepared"):
                owner.run_social_cross_station_suite(prepared=prepared)
        schemas.assert_not_called()
        self.binding.create_bound_session.assert_not_called()

    def test_original_suite_failure_preserves_cause_and_publishes_no_pass(self) -> None:
        from tooling.development.secure_content import runtime_owner
        prepared = self.prepared()
        owner = self.suite_context(prepared)
        prepared.schema_inventory = {"services": {}}
        failure = FoundationClientError("original login failure")

        def fail_after_start(client, **credentials):
            client.start()
            raise failure

        with (
            mock.patch.object(prepared, "schema_bindings", return_value={
                "station-four": mock.Mock(), "station-five-arm": mock.Mock(),
            }),
            mock.patch.object(prepared, "attestation", return_value=SimpleNamespace(endpoint="http://station.invalid")),
            mock.patch.object(runtime_owner, "_start_client", side_effect=fail_after_start),
            mock.patch.object(runtime_owner, "_prepare_cross_station_social_fixture") as fixtures,
        ):
            self.logout.side_effect = GateError("logout rejected")
            with self.assertRaises(FoundationClientError) as raised:
                owner.run_social_cross_station_suite(prepared=prepared)
        self.assertIs(failure, raised.exception)
        self.assertTrue(any("logout rejected" in note for note in failure.__notes__))
        self.binding.finalize_cleanup.assert_called_once()
        fixtures.assert_not_called()
        self.assertFalse((self.root / "results" / "suite" / "result.json").exists())


if __name__ == "__main__":
    unittest.main()
