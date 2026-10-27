from __future__ import annotations

import copy
import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tooling.acceptance.core import BlockedError, EnvironmentContract, ENVIRONMENTS_DIR, REPO_ROOT
from tooling.acceptance.core.provisioning import ActorIdentity
from tooling.acceptance.core.errors import EphemeralLaunchCleanupFailed
from tooling.acceptance.gates.chat.native_current_profile_two_client_e2e import (
    validate_current_profile_topology,
)
from tooling.acceptance.provisioners.native_tauri_current_profile import (
    LOGIN_CAPABILITY_ID,
    NativeTauriCurrentProfileProvisioner,
    RuntimeAccountLoginHandler,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    CURRENT_PROFILE_GATE_ID,
    NativeTwoClientGate,
)


class CurrentProfileProvisionerTest(unittest.TestCase):
    def test_runner_consumes_projected_login_and_closes_after_both_actors(self) -> None:
        gate = object.__new__(NativeTwoClientGate)
        gate.gate_id = CURRENT_PROFILE_GATE_ID
        gate.account_login_client = Mock()
        gate.account_login_client.invoke.return_value = {"authenticated": True}
        gate.actor_specs = {
            role: {"ptid": f"ptid:{role}", "accountRef": f"station-account:{role}@example"}
            for role in ("alice", "bob")
        }
        gate.clients, gate.ptids, gate.device_ids, gate.station_access = {}, {}, {}, {}
        gate.runtime_instances, gate.runtime_instance_actors = [], {}
        gate.manifest = {}
        gate.report, gate.client_lifecycles, gate.runtime_binding = Mock(), Mock(), Mock()
        gate.configure_station_access, gate.register_driver = Mock(), Mock()
        gate.runtime_binding.create_bound_session.return_value.get_current_url.return_value = "tauri://localhost"
        binding = {"phase": "bound", "activeUrl": "https://selected.example"}
        for role in ("alice", "bob"):
            with (
                patch("tooling.acceptance.gates.chat.native_two_client_runner.async_harness",
                      return_value={"actorPtid": f"ptid:{role}"}),
                patch("tooling.acceptance.gates.chat.native_two_client_runner.call_async_harness",
                      return_value=binding),
                patch("tooling.acceptance.gates.chat.native_two_client_runner.runtime_station_service",
                      return_value={"endpoint": binding["activeUrl"]}),
                patch("tooling.acceptance.gates.chat.native_two_client_runner.wait_until",
                      return_value={"active": True, "deviceId": f"device:{role}"}),
            ):
                gate.start_client(role)
            if role == "alice":
                gate.account_login_client.close.assert_not_called()
        self.assertEqual(gate.account_login_client.invoke.call_count, 2)
        self.assertEqual(
            [call.args[:2] for call in gate.account_login_client.invoke.call_args_list],
            [(LOGIN_CAPABILITY_ID, "authenticate")] * 2,
        )
        gate.account_login_client.close.assert_called_once_with()
        self.assertEqual(gate.ptids, {"alice": "ptid:alice", "bob": "ptid:bob"})

    def setUp(self) -> None:
        self.provisioner = NativeTauriCurrentProfileProvisioner(
            EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "native-tauri-current-profile.yaml"),
        )
        self.actors = tuple(
            ActorIdentity(role=role, account_ref=f"station-account:{role}@example",
                          ptid=f"ptid:{role}", device_policy="run-scoped-acceptance")
            for role in ("alice", "bob")
        )
        self.addCleanup(self.provisioner.cleanup)

    def clients(self, run_id: str):
        return self.provisioner._clients(
            run_id=run_id, profile_name="selected", slot=13,
            profile_env={"PT_DESKTOP_APP_GATEWAY_PORT": "4000", "PT_DESKTOP_APP_WEB_PORT": "5000"},
            actors=self.actors,
        )

    def test_instances_share_current_source_and_have_fresh_run_storage(self) -> None:
        with patch.object(self.provisioner, "_port_available", return_value=True):
            first, second = self.clients("one"), self.clients("two")
        self.assertEqual({client.worktree for client in first + second}, {str(REPO_ROOT.resolve())})
        self.assertEqual(len({client.storage_root for client in first + second}), 4)
        self.assertEqual(len({client.profile for client in first}), 2)
        self.assertEqual(len({
            port for client in first
            for port in (client.gateway_port, client.renderer_port, client.webdriver_port)
        }), 6)
        for client in first + second:
            root = Path(client.storage_root)
            self.assertTrue(root.is_dir())
            self.assertEqual(list(root.iterdir()), [])
            self.assertEqual(client.storage_lifecycle, "ephemeral")
        retained = Path(first[0].storage_root) / "device-state"
        retained.write_text("state created by authentication")
        self.assertTrue(retained.exists(), "State must remain available until run cleanup")
        self.provisioner.cleanup()
        self.assertTrue(all(not Path(client.storage_root).exists() for client in first + second))

    def test_port_allocation_rejects_incomplete_instance_set(self) -> None:
        with patch.object(self.provisioner, "_port_available", return_value=False):
            with self.assertRaisesRegex(BlockedError, "port set"):
                self.clients("blocked")
        self.assertEqual(self.provisioner.cleanup(), ())

    def test_current_profile_uses_existing_account_registrar_without_preset_import(self) -> None:
        records = {
            f"created-{role}@example": SimpleNamespace(ptid=f"ptid:{role}")
            for role in ("alice", "bob")
        }
        with (
            patch("tooling.development.secure_content.runtime_owner._register_runtime_account",
                  side_effect=lambda _url, **kw: f"created-{kw['role']}@example") as registrar,
            patch("tooling.acceptance.provisioners.native_tauri_current_profile.resolve_existing_preset_actor",
                  side_effect=lambda **kw: next(actor for actor in self.actors if actor.role == kw["role"])) as resolve,
            patch("tooling.acceptance.provisioners.native_tauri_current_profile.read_fixture_actors",
                  return_value=records),
            patch("tooling.acceptance.provisioners.native_tauri_current_profile.seed_run_actor_avatars"),
            patch("tooling.acceptance.provisioners.native_tauri_current_profile.seed_bound_contacts") as contacts,
        ):
            actors = self.provisioner._prepare_actors("https://reviewed.example", "reviewed", "run-one", "test")
        self.assertEqual(actors, self.actors)
        self.assertEqual(registrar.call_count, 2)
        self.assertEqual(len({call.kwargs["suffix"] for call in registrar.call_args_list}), 1)
        self.assertEqual({call.kwargs["account"] for call in resolve.call_args_list}, set(records))
        contacts.assert_called_once()

    def test_run_credentials_satisfy_signup_and_remain_in_redaction_scope(self) -> None:
        refs, first = self.provisioner.prepare_credentials()
        self.assertEqual(self.provisioner.prepare_credentials(), (refs, first))
        password = first["chat-password"]
        self.assertGreaterEqual(len(password), 8)
        self.assertLessEqual(len(password), 20)
        self.assertRegex(password, r"[a-zA-Z]")
        self.assertRegex(password, r"[0-9]")
        self.assertRegex(password, r"[!@#$]")
        self.assertEqual(self.provisioner.resolved_credential_values, (password,))
        self.assertEqual(refs, ("auto:chat-current-profile-run-password",))

    def test_nested_provisioning_failure_preserves_diagnostics_and_redacts_credentials(self) -> None:
        _, values = self.provisioner.prepare_credentials()
        password = values["chat-password"]
        with patch.object(self.provisioner, "_resolve_active_profile",
                          side_effect=RuntimeError(f"fixture command failed using {password}")):
            manifest = self.provisioner.provision("chat-native-current-profile-two-client-e2e")
        payload = manifest.to_dict()
        self.assertIn("fixture command failed", payload["blockedReason"])
        self.assertNotIn(password, json.dumps(payload))
        self.assertIsNotNone(manifest.diagnostic)

    def test_profile_equipment_precedes_retained_leases_and_health_readback(self) -> None:
        events = []
        profile = {
            "PT_STATION_MODE": "remote", "PT_STATION_URL": "https://selected.example",
            "PT_STATION_DEPLOY_ENV": "selected",
        }
        with (
            patch.object(self.provisioner, "_resolve_active_profile",
                         return_value=("selected", None, 13, profile)),
            patch.object(self.provisioner, "_preflighted",
                         side_effect=lambda manifest, **kwargs: manifest),
            patch("tooling.acceptance.provisioners.native_tauri_current_profile.equip_station_profile",
                  create=True, side_effect=lambda *args, **kwargs: events.append("equip")) as equip,
            patch.object(self.provisioner, "acquire_profile_lease",
                         side_effect=lambda *args: events.append("profile-lease")),
            patch.object(self.provisioner, "acquire_remote_git_source_lease",
                         side_effect=lambda *args: events.append("source-lease")),
            patch.object(self.provisioner, "_station_health",
                         side_effect=lambda *args: events.append("health") or {"ready": False}),
        ):
            manifest = self.provisioner.provision(CURRENT_PROFILE_GATE_ID)
        self.assertEqual(events, ["equip", "profile-lease", "source-lease", "health"])
        equip.assert_called_once_with("selected", manifest.source_commit, repo_root=REPO_ROOT)
        self.assertEqual(manifest.blocked_resource, "service-health:station")

    def test_profile_provisioning_preserves_failed_process_cleanup(self) -> None:
        error = EphemeralLaunchCleanupFailed(
            "equipment child retained", operation="gate_process",
        )
        with patch.object(self.provisioner, "_resolve_active_profile",
                          side_effect=error), self.assertRaises(EphemeralLaunchCleanupFailed) as caught:
            self.provisioner.provision(CURRENT_PROFILE_GATE_ID)
        self.assertIs(caught.exception, error)

    def test_login_handler_keeps_password_and_session_ownership_in_parent(self) -> None:
        from tooling.acceptance.core.errors import EphemeralCapabilityBlocked
        clients = self.clients("login")
        password = "GeneratedAa1!12345"
        handler = RuntimeAccountLoginHandler(
            password, clients, {"alice": "alice@example", "bob": "bob@example"},
            "https://reviewed.example",
        )
        driver = SimpleNamespace(
            driver=SimpleNamespace(current_url="tauri://localhost"),
            borrow_session=lambda session: None,
            stop=lambda: None,
        )
        with (
            patch("tooling.acceptance.drivers.tauri.TauriDriver", return_value=driver),
            patch("tooling.acceptance.core.harness.call_async_harness", side_effect=[
                {"activeUrl": "https://reviewed.example"}, {"authenticated": True},
            ]) as harness,
        ):
            response = handler.invoke(
                "authenticate", {"role": "alice", "sessionId": "native-session"},
                deadline_monotonic=time.monotonic() + 35, cancellation=threading.Event(),
            )
        self.assertEqual(response, {"authenticated": True})
        self.assertEqual(harness.call_args_list[-1].args[2],
                         {"account": "alice@example", "password": password})
        with self.assertRaises(EphemeralCapabilityBlocked):
            handler.invoke("authenticate", {"role": "foreign", "sessionId": "session"},
                           deadline_monotonic=time.monotonic() + 35,
                           cancellation=threading.Event())
        self.assertTrue(handler.close().secrets_zeroized)
        self.assertEqual(handler.sensitive_values, ())


class BorrowedTauriSessionTest(unittest.TestCase):
    def test_borrowed_session_never_creates_or_deletes_a_webdriver_session(self) -> None:
        from tooling.acceptance.drivers.tauri import TauriDriver
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                requests.append(("GET", self.path))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"value": "tauri://localhost"}).encode())

            def do_POST(self) -> None:
                requests.append(("POST", self.path))
                self.send_error(500)

            def do_DELETE(self) -> None:
                requests.append(("DELETE", self.path))
                self.send_error(500)

            def log_message(self, *args) -> None:
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        driver = TauriDriver(port=server.server_port)
        try:
            borrowed = driver.borrow_session("existing")
            self.assertEqual(borrowed.current_url, "tauri://localhost")
            driver.stop()
            self.assertEqual(requests, [("GET", "/session/existing/url")])
        finally:
            driver.stop()
            server.shutdown()
            server.server_close()
            worker.join(2)


class CurrentProfileEvidenceTest(unittest.TestCase):
    def valid_report(self) -> dict:
        source = {"commit": "a" * 40, "workspaceDigest": "sha256:" + "b" * 64,
                  "worktree": "/workspace/selected"}
        topology = {}
        clients = []
        for index, actor in enumerate(("alice", "bob")):
            client = {
                "id": actor, "actor": actor, "worktree": source["worktree"],
                "profile": f"selected-acceptance-{actor}", "storage_root": f"/run/{actor}/storage",
                "storage_lifecycle": "ephemeral", "gateway_port": 4000 + index,
                "webdriver_port": 5000 + index,
            }
            clients.append(client)
            topology[actor] = {
                "clientId": actor, "canonicalRoot": source["worktree"], "workspaceId": "c" * 16,
                "commit": source["commit"], "workspaceDigest": source["workspaceDigest"],
                "binarySha256": "d" * 64, "processId": 100 + index, "actorPtid": f"ptid:{actor}",
                "deviceId": f"device-{actor}", "profile": client["profile"],
                "storageRoot": client["storage_root"], "gatewayPort": client["gateway_port"],
                "webdriverPort": client["webdriver_port"],
            }
        restarts = {
            actor: {
                "before": copy.deepcopy(identity),
                "after": {**identity, "processId": identity["processId"] + 10},
                "messages": [{"messageUlid": "message-one", "text": "exact plaintext"}],
            }
            for actor, identity in topology.items()
        }
        return {
            "manifest": {"source": source, "clients": clients},
            "runtime": {
                "instanceTopology": topology, "launchOrder": ["bob", "alice"],
                "directionOrder": ["bob", "alice"], "deviceRestartState": restarts,
                "restartMessages": [{"messageId": "message-one", "plaintext": "exact plaintext"}],
                "cleanup": {"storageReleased": True, "retainedStorageRoots": []},
            },
        }

    def test_same_selected_dirty_snapshot_and_real_restart_are_valid(self) -> None:
        validate_current_profile_topology(self.valid_report())

    def test_foreign_source_and_build_are_rejected(self) -> None:
        for field, value in (
            ("canonicalRoot", "/workspace/foreign"),
            ("commit", "e" * 40),
            ("workspaceDigest", "clean"),
            ("binarySha256", "e" * 64),
        ):
            with self.subTest(field=field):
                report = self.valid_report()
                report["runtime"]["instanceTopology"]["bob"][field] = value
                with self.assertRaises(RuntimeError):
                    validate_current_profile_topology(report)

    def test_shared_instance_resources_are_rejected(self) -> None:
        for field in ("processId", "deviceId", "actorPtid", "storageRoot", "gatewayPort", "webdriverPort"):
            with self.subTest(field=field):
                report = self.valid_report()
                report["runtime"]["instanceTopology"]["bob"][field] = report["runtime"]["instanceTopology"]["alice"][field]
                with self.assertRaises(RuntimeError):
                    validate_current_profile_topology(report)

    def test_lifecycle_resume_cannot_substitute_for_process_restart(self) -> None:
        report = self.valid_report()
        report["runtime"]["deviceRestartState"]["bob"]["after"] = copy.deepcopy(
            report["runtime"]["instanceTopology"]["bob"],
        )
        with self.assertRaisesRegex(RuntimeError, "native restart"):
            validate_current_profile_topology(report)

    def test_restart_rejects_device_rotation_and_missing_receiver_plaintext(self) -> None:
        for mutate in (
            lambda state: state["after"].update(deviceId="rotated"),
            lambda state: state["messages"][0].update(text="ciphertext"),
            lambda state: state["messages"][0].update(messageUlid="another-message"),
        ):
            report = self.valid_report()
            mutate(report["runtime"]["deviceRestartState"]["bob"])
            with self.assertRaises(RuntimeError):
                validate_current_profile_topology(report)

    def test_retained_storage_is_not_run_cleanup(self) -> None:
        report = self.valid_report()
        report["runtime"]["cleanup"]["retainedStorageRoots"] = ["/run/bob/storage"]
        with self.assertRaisesRegex(RuntimeError, "released"):
            validate_current_profile_topology(report)

    def test_bob_remains_the_initial_sender(self) -> None:
        report = self.valid_report()
        report["runtime"]["directionOrder"] = ["alice", "bob"]
        with self.assertRaisesRegex(RuntimeError, "Bob must launch"):
            validate_current_profile_topology(report)
