#!/usr/bin/env python3
"""Provisioning data model validation tests."""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (
    ActorIdentity,
    BlockedError,
    BindingProofRecord,
    ClientBindingError,
    ClientRuntime,
    ClientRuntimeIdentity,
    ClientServiceBinding,
    CredentialRef,
    EnvironmentContract,
    GapArtifact,
    ENVIRONMENTS_DIR,
    ProvisioningError,
    ProvisioningState,
    RuntimeManifest,
    ServiceAttestation,
    blocked_manifest,
    load_runtime_manifest,
    new_manifest,
    require_runtime_client_service,
    verify_client_binding_observation,
)
from tooling.acceptance.core.redaction import (
    REDACTED,
    is_sensitive_key,
    redact_value,
)


TEST_ARTIFACT_REF = {
    "artifactKind": "acceptance-artifact-ref",
    "workspaceId": "0" * 16,
    "gateId": "test-gate",
    "runId": "20260817T000000000000Z-" + "0" * 32,
    "path": "runtime/attestation.json",
    "sha256": "0" * 64,
    "mediaType": "application/json",
}


class ProvisioningStateTests(unittest.TestCase):
    def test_state_enum_values(self):
        self.assertEqual(ProvisioningState.DISCOVERED.value, "DISCOVERED")
        self.assertEqual(ProvisioningState.PREFLIGHTED.value, "PREFLIGHTED")
        self.assertEqual(ProvisioningState.PROVISIONED.value, "PROVISIONED")
        self.assertEqual(ProvisioningState.FIXTURE_READY.value, "FIXTURE_READY")
        self.assertEqual(ProvisioningState.BLOCKED.value, "BLOCKED")
        self.assertEqual(ProvisioningState.CLEANED.value, "CLEANED")
        self.assertEqual(ProvisioningState.GATE_FAILED.value, "GATE_FAILED")
        self.assertEqual(ProvisioningState.CLEANUP_FAILED.value, "CLEANUP_FAILED")


class CredentialRefTests(unittest.TestCase):
    def test_env_credential_resolves(self):
        os.environ["PT_TEST_CREDENTIAL"] = "test-secret-value"
        try:
            ref = CredentialRef(id="test", source_ref="env:PT_TEST_CREDENTIAL")
            self.assertEqual(ref.resolve(), "test-secret-value")
        finally:
            del os.environ["PT_TEST_CREDENTIAL"]

    def test_missing_required_env_credential_raises(self):
        ref = CredentialRef(id="missing", source_ref="env:PT_NONEXISTENT_VAR_XYZ")
        with self.assertRaises(ProvisioningError) as ctx:
            ref.resolve()
        self.assertIn("not found", str(ctx.exception))

    def test_missing_optional_env_credential_returns_empty(self):
        ref = CredentialRef(id="optional", source_ref="env:PT_NONEXISTENT_VAR_XYZ", required=False)
        self.assertEqual(ref.resolve(), "")

    def test_generated_env_credential_is_high_entropy_and_stable(self):
        name = "PT_TEST_GENERATED_CREDENTIAL"
        os.environ.pop(name, None)
        try:
            ref = CredentialRef(
                id="generated",
                source_ref=f"env:{name}",
                generated_if_missing=True,
            )
            first = ref.resolve()
            second = ref.resolve()
            self.assertEqual(first, second)
            self.assertGreaterEqual(len(first), 32)
            self.assertEqual(os.environ[name], first)
        finally:
            os.environ.pop(name, None)

    def test_file_credential_resolves(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write("file-secret\n")
            f.flush()
            try:
                ref = CredentialRef(id="file-cred", source_ref=f"file:{f.name}")
                self.assertEqual(ref.resolve(), "file-secret")
            finally:
                Path(f.name).unlink()

    def test_unsupported_source_raises(self):
        ref = CredentialRef(id="bad", source_ref="vault:secret/data/key")
        with self.assertRaises(ProvisioningError) as ctx:
            ref.resolve()
        self.assertIn("unsupported credential source", str(ctx.exception))

    def test_reference_suffix_is_safe_but_reference_secret_is_redacted(self):
        self.assertFalse(is_sensitive_key("credentialRefs"))
        self.assertFalse(is_sensitive_key("credential_reference"))
        self.assertFalse(is_sensitive_key("errorKey"))
        self.assertTrue(is_sensitive_key("credential_reference_secret"))
        value = redact_value(
            {
                "accessTokensPresent": False,
                "credentialRefs": ["env:TEST_PASSWORD"],
                "credentialReferenceSecret": "must-not-survive",
                "errorKey": "auth.oauth.invalidCallback",
            }
        )
        self.assertFalse(value["accessTokensPresent"])
        self.assertEqual(value["credentialRefs"], ["env:TEST_PASSWORD"])
        self.assertEqual(value["credentialReferenceSecret"], REDACTED)
        self.assertEqual(value["errorKey"], "auth.oauth.invalidCallback")


class EnvironmentContractTests(unittest.TestCase):
    def test_load_home_station_contract(self):
        contract = EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "home-station.yaml")
        self.assertEqual(contract.id, "home-station")
        self.assertTrue(contract.profile.required)
        self.assertTrue(contract.profile.identity_match)
        self.assertIn("station", contract.services)
        self.assertTrue(contract.services["station"].required)
        self.assertTrue(
            all(service.kind == "station" for service in contract.services.values())
        )
        self.assertEqual(len(contract.credentials), 1)
        self.assertEqual(contract.credentials[0].id, "evidence-leak-canary")
        self.assertTrue(contract.credentials[0].generated_if_missing)
        self.assertIn("processes", contract.cleanup.resources)

    def test_oauth2_local_provisioners_publish_declared_client_identity(self):
        from tooling.acceptance.provisioners import oauth2_client_local

        cases = (
            (
                "oauth2-client-local-service.yaml",
                oauth2_client_local.OAuth2ClientLocalServiceProvisioner,
            ),
            (
                "oauth2-client-local-browser.yaml",
                oauth2_client_local.OAuth2ClientLocalBrowserProvisioner,
            ),
        )
        for contract_file, provisioner_type in cases:
            with self.subTest(contract_file=contract_file):
                contract = EnvironmentContract.from_yaml(
                    ENVIRONMENTS_DIR / contract_file
                )
                provisioner = provisioner_type(contract)
                with (
                    mock.patch.object(
                        provisioner,
                        "_git_workspace_digest",
                        return_value="clean",
                    ),
                    mock.patch.object(
                        oauth2_client_local.shutil,
                        "which",
                        return_value="/usr/bin/tool",
                    ),
                ):
                    manifest = provisioner.provision("test-gate")

                self.assertTrue(manifest.is_ready())
                self.assertEqual(len(contract.clients), 1)
                self.assertEqual(len(manifest.clients), 1)
                declared = contract.clients[0]
                provisioned = manifest.clients[0]
                self.assertEqual(provisioned.id, declared.id)
                self.assertEqual(provisioned.actor, declared.actor)
                self.assertEqual(provisioned.runtime, declared.runtime)
                self.assertEqual(
                    provisioned.required_service_roles,
                    declared.required_service_roles,
                )
                self.assertEqual(
                    provisioned.service_bindings,
                    declared.service_bindings,
                )

    def test_load_local_desktop_gateway_contract(self):
        contract = EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "local-desktop-gateway.yaml")
        self.assertEqual(contract.id, "local-desktop-gateway")
        self.assertIn("station", contract.services)
        self.assertIn("desktop-gateway", contract.services)
        self.assertEqual(len(contract.fixtures), 1)
        self.assertEqual(contract.fixtures[0].id, "chat-native-actors")
        self.assertTrue(contract.fixtures[0].authorization_required)
        self.assertEqual(
            contract.fixtures[0].authorization_ref,
            "env:CHAT_ACCEPTANCE_RESET",
        )
        self.assertEqual(len(contract.credentials), 1)
        self.assertEqual(contract.credentials[0].id, "chat-password")
        self.assertEqual(
            contract.credentials[0].source_ref,
            "fixture:apps/station/app/conf/actor.yml#preset_users",
        )
        self.assertTrue(contract.credentials[0].required)
        self.assertFalse(contract.credentials[0].generated_if_missing)
        self.assertEqual(
            [fixture.id for fixture in contract.fixtures],
            ["chat-native-actors"],
        )
        self.assertEqual(
            [credential.source_ref for credential in contract.credentials],
            ["fixture:apps/station/app/conf/actor.yml#preset_users"],
        )

        from tooling.acceptance.provisioners.local_desktop_gateway import (
            LocalDesktopGatewayProvisioner,
        )

        provisioner = LocalDesktopGatewayProvisioner(contract)
        refs, values = provisioner.prepare_credentials()
        self.assertEqual(refs, (contract.credentials[0].source_ref,))
        self.assertEqual(values, {"chat-password": "1"})
        self.assertEqual(provisioner.resolved_credential_values, ())

    def test_local_desktop_gateway_starts_with_exact_acceptance_ports(self):
        from tooling.acceptance.provisioners import local_desktop_gateway

        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "local-desktop-gateway.yaml"
        )
        provisioner = local_desktop_gateway.LocalDesktopGatewayProvisioner(
            contract
        )
        process = mock.Mock(pid=12345)
        process.poll.return_value = None

        with (
            tempfile.TemporaryDirectory() as temp_dir,
            mock.patch.object(
                local_desktop_gateway.tempfile,
                "mkdtemp",
                return_value=str(Path(temp_dir) / "logs"),
            ),
            mock.patch.object(
                local_desktop_gateway,
                "write_current_artifact",
            ),
            mock.patch.object(
                local_desktop_gateway.subprocess,
                "Popen",
                return_value=process,
            ) as popen,
            mock.patch.object(
                provisioner,
                "_gateway_ready",
                return_value=True,
            ),
        ):
            log_directory = Path(temp_dir) / "logs"
            storage_parent = Path(temp_dir) / "storage"
            log_directory.mkdir()
            storage_parent.mkdir()
            provisioner.register_cleanup(
                "desktop-storage:run-id",
                lambda: shutil.rmtree(storage_parent),
            )
            storage_root = provisioner._start_gateway(
                "http://127.0.0.1:3430",
                "run-id",
                gateway_port=3430,
                renderer_port=3610,
                profile_name="four",
                storage_parent=storage_parent,
            )
            storage_root.mkdir()
            provisioner.cleanup()

        launch_env = popen.call_args.kwargs["env"]
        self.assertEqual(launch_env["PT_DESKTOP_E2E"], "true")
        self.assertEqual(launch_env["PT_GATEWAY_PORT"], "3430")
        self.assertEqual(launch_env["PT_RENDERER_PORT"], "3610")
        self.assertEqual(launch_env["PT_PROFILE"], "four-gateway-run-id")
        self.assertEqual(
            Path(launch_env["PEERS_STORAGE_ROOT"]),
            storage_parent,
        )
        self.assertEqual(storage_root, storage_parent / "peers-touch")
        self.assertFalse(storage_parent.exists())

    def test_load_native_tauri_contract(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "native-tauri-embedded-webdriver.yaml"
        )
        self.assertEqual(contract.id, "native-tauri-embedded-webdriver")
        self.assertEqual(
            set(contract.services),
            {"station-four", "station-five"},
        )
        self.assertEqual(
            {client.id for client in contract.clients},
            {"alice", "alice2", "bob", "bob1", "bob2", "charlie"},
        )
        self.assertTrue(
            all(service.kind == "station" for service in contract.services.values())
        )

    def test_native_tauri_services_use_canonical_profiles(self):
        from tooling.acceptance.provisioners import (
            native_tauri_embedded_webdriver,
        )

        self.assertEqual(
            native_tauri_embedded_webdriver._SERVICE_PROFILES,
            {
                "station-four": "four",
                "station-five": "fiveArm",
            },
        )

    def test_load_native_tauri_current_profile_contract(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "native-tauri-current-profile.yaml"
        )
        self.assertEqual(contract.id, "native-tauri-current-profile")
        self.assertEqual(set(contract.services), {"station"})
        self.assertEqual(
            {client.id for client in contract.clients},
            {"alice", "bob"},
        )
        self.assertTrue(
            all(
                client.service_bindings["station"].service_id == "station"
                for client in contract.clients
            )
        )
        self.assertFalse(contract.fixtures[0].authorization_required)

    def test_current_profile_actor_resolution_logs_out_discovery_session(self):
        from tooling.acceptance.provisioners import (
            native_tauri_current_profile,
        )

        login_response = mock.MagicMock()
        login_response.__enter__.return_value.read.return_value = json.dumps(
            {
                "data": {
                    "actor_ref": {"ptid": "ptid:alice"},
                    "tokens": {"access_token": "session-token"},
                }
            }
        ).encode("utf-8")
        logout_response = mock.MagicMock()
        with mock.patch.object(
            native_tauri_current_profile.urllib.request,
            "urlopen",
            side_effect=[login_response, logout_response],
        ) as urlopen:
            actor = (
                native_tauri_current_profile.NativeTauriCurrentProfileProvisioner
                ._resolve_existing_actor(
                    "http://station.example",
                    "alice",
                    "fixture-password",
                )
            )

        self.assertEqual(actor.ptid, "ptid:alice")
        self.assertEqual(actor.device_policy, "persistent-acceptance")
        self.assertEqual(urlopen.call_count, 2)
        logout_request = urlopen.call_args_list[1].args[0]
        self.assertEqual(
            logout_request.headers["Authorization"],
            "Bearer session-token",
        )

    def test_current_profile_clients_use_actor_specific_storage_seeds(self):
        from tooling.acceptance.provisioners import (
            native_tauri_current_profile,
        )

        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "native-tauri-current-profile.yaml"
        )
        provisioner = (
            native_tauri_current_profile.NativeTauriCurrentProfileProvisioner(
                contract
            )
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            alice_seed = root / "alice-seed"
            bob_seed = root / "bob-seed"
            (alice_seed / "peers-touch").mkdir(parents=True)
            (bob_seed / "peers-touch").mkdir(parents=True)
            (alice_seed / "peers-touch" / "identity-owner").write_text(
                "alice",
                encoding="utf-8",
            )
            (bob_seed / "peers-touch" / "identity-owner").write_text(
                "bob",
                encoding="utf-8",
            )
            for role, seed in (("alice", alice_seed), ("bob", bob_seed)):
                database = (
                    seed
                    / "peers-touch"
                    / "four-app"
                    / "data"
                    / "db"
                    / "users"
                    / role
                    / "chat.main.db"
                )
                database.parent.mkdir(parents=True)
                database.write_bytes(b"live-device-state")
                device_id = (
                    seed
                    / "peers-touch"
                    / "four-app"
                    / "data"
                    / "auth"
                    / "sessions"
                    / role
                    / "device_id"
                )
                device_id.parent.mkdir(parents=True)
                device_id.write_text("existing-device", encoding="utf-8")
            alice_state = root / "alice-state"
            bob_state = root / "bob-state"
            actors = (
                ActorIdentity(
                    role="alice",
                    account_ref="station-account:alice@p.t",
                    ptid="ptid:alice",
                    device_policy="persistent-acceptance",
                ),
                ActorIdentity(
                    role="bob",
                    account_ref="station-account:bob@p.t",
                    ptid="ptid:bob",
                    device_policy="persistent-acceptance",
                ),
            )
            common_dir = root / "common"
            client_worktrees = {
                "alice": native_tauri_current_profile.ClientWorktreeIdentity(
                    root=root / "peers-chat-high-chat",
                    logical_name="peers-chat-high-chat",
                    common_dir=common_dir,
                    head="b" * 40,
                    tree="c" * 40,
                    clean=True,
                ),
                "bob": native_tauri_current_profile.ClientWorktreeIdentity(
                    root=root / "peers-group-chat",
                    logical_name="peers-group-chat",
                    common_dir=common_dir,
                    head="a" * 40,
                    tree="c" * 40,
                    clean=True,
                ),
            }
            run_id = f"test-{root.name}"
            with (
                mock.patch.dict(
                    os.environ,
                    {
                        "PT_CHAT_NATIVE_STORAGE_SEEDS": (
                            f"{alice_seed},{bob_seed}"
                        ),
                        "PT_CHAT_NATIVE_PERSISTENT_STORAGE_ROOTS": (
                            f"{alice_state},{bob_state}"
                        ),
                    },
                ),
                mock.patch.object(
                    provisioner,
                    "_port_available",
                    return_value=True,
                ),
                mock.patch.object(
                    provisioner,
                    "_client_worktrees",
                    return_value=client_worktrees,
                ),
            ):
                clients = provisioner._clients(
                    run_id=run_id,
                    profile_name="four",
                    profile_env={
                        "PT_DESKTOP_APP_GATEWAY_PORT": "3140",
                        "PT_DESKTOP_APP_WEB_PORT": "3410",
                    },
                    slot=3,
                    actors=actors,
                )
            try:
                self.assertEqual(
                    [
                        (
                            Path(client.storage_root)
                            / "peers-touch"
                            / "identity-owner"
                        ).read_text(encoding="utf-8")
                        for client in clients
                    ],
                    ["alice", "bob"],
                )
                self.assertEqual(
                    [client.profile for client in clients],
                    ["four-app", "four-app"],
                )
                self.assertEqual(
                    [Path(client.worktree).name for client in clients],
                    ["peers-chat-high-chat", "peers-group-chat"],
                )
                self.assertEqual(
                    [client.storage_lifecycle for client in clients],
                    ["persistent", "persistent"],
                )
                self.assertEqual(
                    [Path(client.storage_root) for client in clients],
                    [alice_state.resolve(), bob_state.resolve()],
                )
                self.assertTrue(
                    (
                        alice_seed
                        / "peers-touch"
                        / "four-app"
                        / "data"
                        / "db"
                        / "users"
                        / "alice"
                        / "chat.main.db"
                    ).is_file()
                )
                self.assertFalse(
                    any(alice_state.rglob("chat.main.db*"))
                )
                self.assertFalse(
                    any(alice_state.rglob("device_id"))
                )
                continuity = (
                    alice_state / "peers-touch" / "continuity-marker"
                )
                continuity.write_text("preserved", encoding="utf-8")
                with (
                    mock.patch.dict(
                        os.environ,
                        {
                            "PT_CHAT_NATIVE_STORAGE_SEEDS": (
                                f"{alice_seed},{bob_seed}"
                            ),
                            "PT_CHAT_NATIVE_PERSISTENT_STORAGE_ROOTS": (
                                f"{alice_state},{bob_state}"
                            ),
                        },
                    ),
                    mock.patch.object(
                        provisioner,
                        "_port_available",
                        return_value=True,
                    ),
                    mock.patch.object(
                        provisioner,
                        "_client_worktrees",
                        return_value=client_worktrees,
                    ),
                ):
                    repeated = provisioner._clients(
                        run_id=f"{run_id}-repeat",
                        profile_name="four",
                        profile_env={
                            "PT_DESKTOP_APP_GATEWAY_PORT": "3140",
                            "PT_DESKTOP_APP_WEB_PORT": "3410",
                        },
                        slot=3,
                        actors=actors,
                    )
                self.assertEqual(
                    [Path(client.storage_root) for client in repeated],
                    [alice_state.resolve(), bob_state.resolve()],
                )
                self.assertEqual(
                    continuity.read_text(encoding="utf-8"),
                    "preserved",
                )
                with (
                    mock.patch.dict(
                        os.environ,
                        {
                            "PT_CHAT_NATIVE_STORAGE_SEEDS": (
                                f"{alice_seed},{bob_seed}"
                            ),
                            "PT_CHAT_NATIVE_PERSISTENT_STORAGE_ROOTS": (
                                f"{alice_state},{bob_state}"
                            ),
                            "PT_CHAT_NATIVE_RESET_PERSISTENT_STATE": "1",
                            "CHAT_ACCEPTANCE_RESET": "1",
                            "CHAT_ACCEPTANCE_RESET_PROFILE": "four",
                        },
                        clear=True,
                    ),
                    mock.patch.object(
                        provisioner,
                        "_port_available",
                        return_value=True,
                    ),
                    mock.patch.object(
                        provisioner,
                        "_client_worktrees",
                        return_value=client_worktrees,
                    ),
                ):
                    reset = provisioner._clients(
                        run_id=f"{run_id}-reset",
                        profile_name="four",
                        profile_env={
                            "PT_DESKTOP_APP_GATEWAY_PORT": "3140",
                            "PT_DESKTOP_APP_WEB_PORT": "3410",
                        },
                        slot=3,
                        actors=actors,
                    )
                self.assertEqual(
                    [Path(client.storage_root) for client in reset],
                    [alice_state.resolve(), bob_state.resolve()],
                )
                self.assertFalse(continuity.exists())
                self.assertFalse(any(alice_state.rglob("chat.main.db*")))
                self.assertFalse(any(alice_state.rglob("device_id")))
            finally:
                provisioner.cleanup()
            self.assertTrue(alice_state.is_dir())
            self.assertTrue(bob_state.is_dir())

    def test_current_profile_persistent_reset_requires_exact_authorization(
        self,
    ) -> None:
        from tooling.acceptance.provisioners import (
            native_tauri_current_profile,
        )

        with mock.patch.dict(
            os.environ,
            {
                "PT_CHAT_NATIVE_RESET_PERSISTENT_STATE": "1",
                "CHAT_ACCEPTANCE_RESET": "1",
                "CHAT_ACCEPTANCE_RESET_PROFILE": "five",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(
                BlockedError,
                "exact CHAT_ACCEPTANCE_RESET_PROFILE match",
            ):
                (
                    native_tauri_current_profile
                    .NativeTauriCurrentProfileProvisioner
                    ._persistent_storage_reset_authorized("four")
                )

    def test_current_profile_can_copy_retained_engine_state_without_session(
        self,
    ) -> None:
        from tooling.acceptance.provisioners import (
            native_tauri_current_profile,
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seed = root / "seed"
            storage = root / "storage"
            database = (
                seed
                / "peers-touch"
                / "four-app"
                / "data"
                / "db"
                / "users"
                / "alice"
                / "chat.main.db"
            )
            database.parent.mkdir(parents=True)
            database.write_bytes(b"retained-engine-state")
            device_id = (
                seed
                / "peers-touch"
                / "four-app"
                / "data"
                / "auth"
                / "sessions"
                / "alice"
                / "device_id"
            )
            device_id.parent.mkdir(parents=True)
            device_id.write_text("revoked-session-device", encoding="utf-8")

            result = (
                native_tauri_current_profile
                .NativeTauriCurrentProfileProvisioner
                ._persistent_storage(
                    role="alice",
                    actor=ActorIdentity(
                        role="alice",
                        account_ref="station-account:alice@p.t",
                        ptid="ptid:alice",
                        device_policy="persistent-acceptance",
                    ),
                    profile_name="four",
                    worktree=(
                        native_tauri_current_profile
                        .ClientWorktreeIdentity(
                            root=root / "peers-chat-high-chat",
                            logical_name="peers-chat-high-chat",
                            common_dir=root / "common",
                            head="a" * 40,
                            tree="b" * 40,
                            clean=True,
                        )
                    ),
                    seed_root=seed,
                    storage_root=storage,
                    run_id="retained-state",
                    preserve_retained_engine_state=True,
                )
            )

            self.assertEqual(result, storage)
            self.assertEqual(
                (
                    storage
                    / database.relative_to(seed)
                ).read_bytes(),
                b"retained-engine-state",
            )
            self.assertFalse(
                (storage / device_id.relative_to(seed)).exists()
            )
            marker = json.loads(
                (
                    storage
                    / native_tauri_current_profile
                    .PERSISTENT_STORAGE_MARKER
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(
                marker["devicePolicy"],
                "retained-engine-acceptance",
            )

    def test_current_profile_authorized_reset_can_change_storage_policy(
        self,
    ) -> None:
        from tooling.acceptance.provisioners import (
            native_tauri_current_profile,
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seed = root / "seed"
            storage = root / "storage"
            database = (
                seed
                / "peers-touch"
                / "four-app"
                / "data"
                / "db"
                / "users"
                / "alice"
                / "chat.main.db"
            )
            database.parent.mkdir(parents=True)
            database.write_bytes(b"actor-identity-continuity")
            actor = ActorIdentity(
                role="alice",
                account_ref="station-account:alice@p.t",
                ptid="ptid:alice",
                device_policy="persistent-acceptance",
            )
            worktree = native_tauri_current_profile.ClientWorktreeIdentity(
                root=root / "peers-chat-high-chat",
                logical_name="peers-chat-high-chat",
                common_dir=root / "common",
                head="a" * 40,
                tree="b" * 40,
                clean=True,
            )

            provisioner = (
                native_tauri_current_profile
                .NativeTauriCurrentProfileProvisioner
            )
            provisioner._persistent_storage(
                role="alice",
                actor=actor,
                profile_name="four",
                worktree=worktree,
                seed_root=seed,
                storage_root=storage,
                run_id="persistent",
            )
            self.assertFalse(any(storage.rglob("chat.main.db*")))

            provisioner._persistent_storage(
                role="alice",
                actor=actor,
                profile_name="four",
                worktree=worktree,
                seed_root=seed,
                storage_root=storage,
                run_id="retained",
                reset_authorized=True,
                preserve_retained_engine_state=True,
            )
            self.assertEqual(
                (storage / database.relative_to(seed)).read_bytes(),
                b"actor-identity-continuity",
            )
            marker_path = (
                storage
                / native_tauri_current_profile.PERSISTENT_STORAGE_MARKER
            )
            marker = json.loads(marker_path.read_text(encoding="utf-8"))
            self.assertEqual(
                marker["devicePolicy"],
                "retained-engine-acceptance",
            )

            marker["actorPtid"] = "ptid:mallory"
            marker_path.write_text(
                json.dumps(marker, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                BlockedError,
                "persistent storage identity does not match",
            ):
                provisioner._persistent_storage(
                    role="alice",
                    actor=actor,
                    profile_name="four",
                    worktree=worktree,
                    seed_root=seed,
                    storage_root=storage,
                    run_id="mismatched",
                    reset_authorized=True,
                )

    def test_current_profile_rejects_unknown_retained_engine_role(self) -> None:
        from tooling.acceptance.provisioners import (
            native_tauri_current_profile,
        )

        with mock.patch.dict(
            os.environ,
            {
                native_tauri_current_profile
                .RETAINED_ENGINE_STATE_ROLES_ENV: "alice,mallory",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(BlockedError, "mallory"):
                (
                    native_tauri_current_profile
                    .NativeTauriCurrentProfileProvisioner
                    ._retained_engine_state_roles()
                )

    def test_current_profile_defaults_to_each_worktree_storage_seed(self):
        from tooling.acceptance.provisioners import (
            native_tauri_current_profile,
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            common_dir = root / "common"
            identities = {}
            for role, logical_name in (
                ("alice", "peers-chat-high-chat"),
                ("bob", "peers-group-chat"),
            ):
                worktree = root / logical_name
                (
                    worktree
                    / ".local"
                    / "dev"
                    / "data"
                    / "four"
                    / "desktop-app"
                    / "peers-touch"
                ).mkdir(parents=True)
                identities[role] = (
                    native_tauri_current_profile.ClientWorktreeIdentity(
                        root=worktree,
                        logical_name=logical_name,
                        common_dir=common_dir,
                        head="a" * 40,
                        tree="b" * 40,
                        clean=True,
                    )
                )
            with mock.patch.dict(
                os.environ,
                {
                    "PT_CHAT_NATIVE_STORAGE_SEEDS": "",
                    "PT_CHAT_NATIVE_PERSISTENT_STORAGE_ROOTS": "",
                },
            ):
                seeds = (
                    native_tauri_current_profile
                    .NativeTauriCurrentProfileProvisioner
                    ._storage_seeds("four", identities)
                )
                persistent_roots = (
                    native_tauri_current_profile
                    .NativeTauriCurrentProfileProvisioner
                    ._persistent_storage_roots("four", identities)
                )

        self.assertEqual(
            [seed.parents[4].name for seed in seeds],
            ["peers-chat-high-chat", "peers-group-chat"],
        )
        self.assertEqual(
            [path.parents[6].name for path in persistent_roots],
            ["peers-chat-high-chat", "peers-group-chat"],
        )

    def test_current_profile_rejects_mismatched_persistent_storage(self):
        from tooling.acceptance.provisioners import (
            native_tauri_current_profile,
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seed = root / "seed"
            storage = root / "storage"
            (seed / "peers-touch").mkdir(parents=True)
            (storage / "peers-touch").mkdir(parents=True)
            (
                storage
                / native_tauri_current_profile.PERSISTENT_STORAGE_MARKER
            ).write_text("{}\n", encoding="utf-8")

            with self.assertRaises(BlockedError):
                (
                    native_tauri_current_profile
                    .NativeTauriCurrentProfileProvisioner
                    ._persistent_storage(
                        role="alice",
                        actor=ActorIdentity(
                            role="alice",
                            account_ref="station-account:alice@p.t",
                            ptid="ptid:alice",
                            device_policy="persistent-acceptance",
                        ),
                        profile_name="four",
                        worktree=(
                            native_tauri_current_profile
                            .ClientWorktreeIdentity(
                                root=root / "peers-chat-high-chat",
                                logical_name="peers-chat-high-chat",
                                common_dir=root / "common",
                                head="a" * 40,
                                tree="b" * 40,
                                clean=True,
                            )
                        ),
                        seed_root=seed,
                        storage_root=storage,
                        run_id="test",
                    )
                )

    def test_current_profile_rejects_same_client_worktree(self):
        from tooling.acceptance.provisioners import (
            native_tauri_current_profile,
        )

        shared = REPO_ROOT.resolve()
        common_dir = shared.parent / ".git"
        identities = {
            "alice": native_tauri_current_profile.ClientWorktreeIdentity(
                root=shared,
                logical_name="peers-chat-high-chat",
                common_dir=common_dir,
                head="a" * 40,
                tree="c" * 40,
                clean=True,
            ),
            "bob": native_tauri_current_profile.ClientWorktreeIdentity(
                root=shared,
                logical_name="peers-group-chat",
                common_dir=common_dir,
                head="b" * 40,
                tree="c" * 40,
                clean=True,
            ),
        }

        with self.assertRaisesRegex(
            BlockedError,
            "two distinct client worktrees",
        ):
            (
                native_tauri_current_profile
                .NativeTauriCurrentProfileProvisioner
                ._validate_client_worktrees(identities)
            )

    def test_current_profile_rejects_unsynchronized_source_trees(self):
        from tooling.acceptance.provisioners import (
            native_tauri_current_profile,
        )

        if REPO_ROOT.name != "peers-group-chat":
            self.skipTest("current-profile provisioner is group-chat owned")
        common_dir = REPO_ROOT.parent / ".git"
        identities = {
            "alice": native_tauri_current_profile.ClientWorktreeIdentity(
                root=REPO_ROOT.parent / "peers-chat-high-chat",
                logical_name="peers-chat-high-chat",
                common_dir=common_dir,
                head="a" * 40,
                tree="c" * 40,
                clean=True,
            ),
            "bob": native_tauri_current_profile.ClientWorktreeIdentity(
                root=REPO_ROOT.resolve(),
                logical_name="peers-group-chat",
                common_dir=common_dir,
                head="b" * 40,
                tree="d" * 40,
                clean=True,
            ),
        }

        with self.assertRaisesRegex(
            BlockedError,
            "not synchronized",
        ):
            (
                native_tauri_current_profile
                .NativeTauriCurrentProfileProvisioner
                ._validate_client_worktrees(identities)
            )

    def test_current_profile_rejects_incomplete_storage_seed_set(self):
        from tooling.acceptance.provisioners import (
            native_tauri_current_profile,
        )

        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "native-tauri-current-profile.yaml"
        )
        provisioner = (
            native_tauri_current_profile.NativeTauriCurrentProfileProvisioner(
                contract
            )
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seeds = []
            for index in range(3):
                seed = root / f"seed-{index}"
                (seed / "peers-touch").mkdir(parents=True)
                seeds.append(str(seed))
            with mock.patch.dict(
                os.environ,
                {"PT_CHAT_NATIVE_STORAGE_SEEDS": ",".join(seeds)},
            ):
                with self.assertRaises(BlockedError):
                    provisioner._storage_seeds("four", {})

    def test_load_mobile_native_contract(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "mobile-native.yaml"
        )
        self.assertEqual(contract.id, "mobile-native")
        self.assertEqual(
            {
                service_id: service.kind
                for service_id, service in contract.services.items()
            },
            {
                "station-primary": "station",
                "station-secondary": "station",
                "relay": "relay",
            },
        )
        self.assertEqual(
            contract.clients,
            (),
            "unmigrated Mobile injection must not be claimed as D-18",
        )

    def test_loads_typed_client_service_binding(self):
        payload = {
            "id": "multi-station",
            "services": {
                "station-primary": {"kind": "station"},
                "station-secondary": {"kind": "station"},
            },
            "clients": [
                {
                    "id": "alice-primary",
                    "actor": "alice",
                    "runtime": "native-tauri",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": "station-primary",
                            "required_kind": "station",
                        }
                    },
                },
                {
                    "id": "bob-secondary",
                    "actor": "bob",
                    "runtime": "native-tauri",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": "station-secondary",
                            "required_kind": "station",
                        }
                    },
                },
            ],
        }
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".yaml",
            delete=False,
        ) as contract_file:
            json.dump(payload, contract_file)
            contract_file.flush()
            path = Path(contract_file.name)
        try:
            contract = EnvironmentContract.from_yaml(path)
        finally:
            path.unlink()

        self.assertEqual(
            [client.id for client in contract.clients],
            ["alice-primary", "bob-secondary"],
        )
        self.assertEqual(
            contract.clients[1].service_bindings["station"].service_id,
            "station-secondary",
        )

    def test_typed_client_requires_roles_and_bindings_together(self):
        payload = {
            "id": "invalid-client",
            "services": {"station": {"kind": "station"}},
            "clients": [
                {
                    "id": "alice",
                    "actor": "alice",
                    "runtime": "native-tauri",
                    "service_bindings": {
                        "station": {
                            "service_id": "station",
                            "required_kind": "station",
                        }
                    },
                }
            ],
        }
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".yaml",
            delete=False,
        ) as contract_file:
            json.dump(payload, contract_file)
            contract_file.flush()
            path = Path(contract_file.name)
        try:
            with self.assertRaises(ClientBindingError) as context:
                EnvironmentContract.from_yaml(path)
        finally:
            path.unlink()
        self.assertEqual(context.exception.code, "MISSING_REQUIRED_BINDING")

    def test_typed_client_rejects_endpoint_copy(self):
        payload = {
            "id": "invalid-client",
            "services": {"station": {"kind": "station"}},
            "clients": [
                {
                    "id": "alice",
                    "actor": "alice",
                    "runtime": "native-tauri",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": "station",
                            "required_kind": "station",
                            "endpoint": "https://forbidden.example",
                        }
                    },
                }
            ],
        }
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".yaml",
            delete=False,
        ) as contract_file:
            json.dump(payload, contract_file)
            contract_file.flush()
            path = Path(contract_file.name)
        try:
            with self.assertRaises(ClientBindingError) as context:
                EnvironmentContract.from_yaml(path)
        finally:
            path.unlink()
        self.assertEqual(context.exception.code, "ENDPOINT_COPY_DETECTED")

    def test_load_mobile_native_contract(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "mobile-native.yaml"
        )
        self.assertEqual(contract.id, "mobile-native")
        self.assertEqual(
            {
                service_id: service.kind
                for service_id, service in contract.services.items()
            },
            {
                "station-primary": "station",
                "station-secondary": "station",
                "relay": "relay",
            },
        )

    def test_invalid_contract_missing_id_raises(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write('{"profile": {"required": true}}')
            f.flush()
            try:
                with self.assertRaises(ProvisioningError) as ctx:
                    EnvironmentContract.from_yaml(Path(f.name))
                self.assertIn("missing id", str(ctx.exception))
            finally:
                Path(f.name).unlink()

    def test_generated_credential_requires_env_source(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write(
                json.dumps(
                    {
                        "id": "bad-generated",
                        "credentials": [
                            {
                                "id": "canary",
                                "source_ref": "file:/tmp/canary",
                                "generated_if_missing": True,
                            }
                        ],
                    }
                )
            )
            f.flush()
            try:
                with self.assertRaisesRegex(
                    ProvisioningError,
                    "generated credentials require an env: or auto: source_ref",
                ):
                    EnvironmentContract.from_yaml(Path(f.name))
            finally:
                Path(f.name).unlink()

    def test_invalid_nested_contract_entries_fail_parse(self):
        invalid_payloads = (
            '{"id":"bad","services":{"station":"not-an-object"}}',
            '{"id":"bad","services":{"station":{"required":true}}}',
            '{"id":"bad","fixtures":[{"authorization_required":true}]}',
            '{"id":"bad","credentials":[{"id":"password"}]}',
            '{"id":"bad","cleanup":{"resources":"ports"}}',
        )
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                with tempfile.NamedTemporaryFile(
                    mode="w",
                    suffix=".yaml",
                    delete=False,
                ) as file:
                    file.write(payload)
                    path = Path(file.name)
                try:
                    with self.assertRaises(ProvisioningError):
                        EnvironmentContract.from_yaml(path)
                finally:
                    path.unlink()

    def test_contract_defaults(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write('{"id": "minimal"}')
            f.flush()
            try:
                contract = EnvironmentContract.from_yaml(Path(f.name))
                self.assertTrue(contract.profile.required)
                self.assertEqual(contract.services, {})
                self.assertEqual(contract.fixtures, ())
                self.assertEqual(contract.credentials, ())
                self.assertIn("processes", contract.cleanup.resources)
            finally:
                Path(f.name).unlink()


class ServiceAttestationTests(unittest.TestCase):
    def test_clean_workspace_flag(self):
        att = ServiceAttestation(
            service_id="station",
            service_kind="station",
            environment_id="test",
            deployment_environment="local",
            endpoint="http://127.0.0.1:3000",
            live_commit="abc123def",
            workspace_digest="clean",
            protocol_digest="sha256:xyz",
            artifact_ref=TEST_ARTIFACT_REF,
            produced_at="2026-08-16T12:00:00+00:00",
            producer="station-deployment",
        )
        self.assertTrue(att.is_clean_workspace)

    def test_dirty_workspace_flag(self):
        att = ServiceAttestation(
            service_id="station",
            service_kind="station",
            environment_id="test",
            deployment_environment="local",
            endpoint="http://127.0.0.1:3000",
            live_commit="abc123def",
            workspace_digest="sha256:dirty",
            protocol_digest="sha256:xyz",
            artifact_ref=TEST_ARTIFACT_REF,
            produced_at="2026-08-16T12:00:00+00:00",
            producer="station-deployment",
        )
        self.assertFalse(att.is_clean_workspace)


class GapArtifactTests(unittest.TestCase):
    def test_gap_artifact_is_structured_and_unproven(self):
        artifact = GapArtifact(
            claim="Direct DELIVERED is proven",
            gap_type="REQUIRED_GATE_NOT_RUN",
            owner_stage="EXECUTE",
            required_closure="Run chat-native-two-client-e2e",
            evidence=({"gateId": "chat-native-two-client-e2e"},),
        ).to_dict()
        self.assertEqual(artifact["artifactKind"], "acceptance-gap")
        self.assertEqual(artifact["proofState"], "UNPROVEN")
        self.assertEqual(artifact["ownerStage"], "EXECUTE")


class RuntimeManifestTests(unittest.TestCase):
    def _base_manifest(self) -> RuntimeManifest:
        return new_manifest(
            environment_id="test-env",
            gate_id="test-gate",
            requested_profile="test",
            resolved_profile="test",
            slot=1,
            commit="abcdef123456",
            worktree="/tmp/test-worktree",
        )

    def _service(
        self,
        service_id: str,
        service_kind: str = "station",
    ) -> ServiceAttestation:
        return ServiceAttestation(
            service_id=service_id,
            service_kind=service_kind,
            environment_id="test",
            deployment_environment=f"deploy-{service_id}",
            endpoint=f"http://{service_id}.example",
            live_commit="abc123",
            workspace_digest="clean",
            protocol_digest="sha256:proto",
            artifact_ref={
                **TEST_ARTIFACT_REF,
                "path": f"runtime/services/{service_id}/attestation.json",
            },
            produced_at="2026-08-16T12:00:00+00:00",
            producer=f"{service_kind}-deployment",
        )

    def test_new_manifest_defaults(self):
        m = self._base_manifest()
        self.assertEqual(m.artifact_kind, "acceptance-runtime-manifest")
        self.assertEqual(m.environment_id, "test-env")
        self.assertEqual(m.gate_id, "test-gate")
        self.assertEqual(m.state, ProvisioningState.DISCOVERED)
        self.assertFalse(m.is_ready())
        self.assertFalse(m.is_blocked())
        self.assertEqual(m.services, {})
        self.assertIsNone(m.blocked_reason)

    def test_manifest_is_immutable(self):
        m = self._base_manifest()
        with self.assertRaises(Exception):
            m.state = ProvisioningState.FIXTURE_READY  # type: ignore[misc]

    def test_manifest_to_dict_contains_required_fields(self):
        m = self._base_manifest()
        d = m.to_dict()
        required = {
            "artifactKind", "environmentId", "gateId", "runId", "createdAt", "state",
            "source", "profile", "credentialRefs", "clients", "cleanup",
            "services",
        }
        self.assertTrue(required.issubset(d.keys()), f"missing: {required - d.keys()}")
        self.assertEqual(d["source"]["commit"], "abcdef123456")
        self.assertEqual(d["profile"]["requestedName"], "test")

    def test_blocked_manifest(self):
        base = self._base_manifest()
        blocked = blocked_manifest(base, reason="Station not reachable", resource="station:3000")
        self.assertTrue(blocked.is_blocked())
        self.assertFalse(blocked.is_ready())
        self.assertEqual(blocked.state, ProvisioningState.BLOCKED)
        self.assertEqual(blocked.blocked_reason, "Station not reachable")
        self.assertEqual(blocked.blocked_resource, "station:3000")

    def test_blocked_manifest_preserves_identity(self):
        base = self._base_manifest()
        blocked = blocked_manifest(base, reason="missing credential", resource="env:CHAT_PASSWORD")
        self.assertEqual(blocked.run_id, base.run_id)
        self.assertEqual(blocked.source_commit, base.source_commit)
        self.assertEqual(blocked.environment_id, base.environment_id)

    def test_manifest_with_service_attestation(self):
        att = self._service("station")
        import dataclasses
        m = dataclasses.replace(
            self._base_manifest(),
            services={"station": att},
            state=ProvisioningState.FIXTURE_READY,
        )
        self.assertTrue(m.is_ready())
        d = m.to_dict()
        self.assertNotIn("station", d)
        self.assertEqual(d["services"]["station"]["liveCommit"], "abc123")
        self.assertEqual(d["services"]["station"]["kind"], "station")

    def test_manifest_serializes_multiple_services_by_stable_id(self):
        import dataclasses
        manifest = dataclasses.replace(
            self._base_manifest(),
            services={
                "station-secondary": self._service("station-secondary"),
                "relay": self._service("relay", "relay"),
                "station-primary": self._service("station-primary"),
            },
        )
        services = manifest.to_dict()["services"]
        self.assertEqual(
            list(services),
            ["relay", "station-primary", "station-secondary"],
        )
        self.assertEqual(services["relay"]["kind"], "relay")

    def test_manifest_rejects_mismatched_service_key(self):
        att = ServiceAttestation(
            service_id="station-primary",
            service_kind="station",
            environment_id="test",
            deployment_environment="station-two",
            endpoint="http://127.0.0.1:3000",
            live_commit="abc123",
            workspace_digest="clean",
            protocol_digest="sha256:proto",
            artifact_ref=TEST_ARTIFACT_REF,
            produced_at="2026-08-16T12:00:00+00:00",
            producer="station-deployment",
        )
        import dataclasses
        manifest = dataclasses.replace(
            self._base_manifest(),
            services={"station-secondary": att},
        )
        with self.assertRaisesRegex(
            ProvisioningError,
            "does not match attestation service id",
        ):
            manifest.to_dict()

    def test_load_manifest_rejects_legacy_station_field(self):
        payload = {
            **self._base_manifest().to_dict(),
            "state": ProvisioningState.FIXTURE_READY.value,
            "station": {"url": "http://station.example"},
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "manifest.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                ProvisioningError,
                "removed singular station field",
            ):
                load_runtime_manifest(path, "test-gate")

    def test_manifest_with_clients(self):
        import dataclasses
        alice = ClientRuntime(
            actor="alice",
            runtime="native-tauri",
            worktree="/tmp/client",
            gateway_port=3030,
            renderer_port=3210,
            webdriver_port=4445,
            profile="acceptance-alice",
            storage_root="/tmp/client/storage",
        )
        m = dataclasses.replace(
            self._base_manifest(),
            clients=(alice,),
            credential_refs=("auto:uuid",),
            cleanup_registered=True,
            cleanup_resources=("processes", "ports"),
        )
        d = m.to_dict()
        self.assertEqual(len(d["clients"]), 1)
        self.assertEqual(d["clients"][0]["actor"], "alice")
        self.assertEqual(d["clients"][0]["gateway_port"], 3030)
        self.assertEqual(d["clients"][0]["webdriver_port"], 4445)
        self.assertEqual(d["credentialRefs"], ["auto:uuid"])
        self.assertTrue(d["cleanup"]["registered"])

    def test_manifest_resolves_bound_client_service(self):
        import dataclasses

        station = self._service("station-primary")
        alice = ClientRuntime(
            id="alice-primary",
            actor="alice",
            runtime="native-tauri",
            worktree="/tmp/client",
            gateway_port=3030,
            renderer_port=3210,
            webdriver_port=4445,
            profile="acceptance-alice",
            storage_root="/tmp/client/storage",
            required_service_roles=("station",),
            service_bindings={
                "station": ClientServiceBinding(
                    service_id="station-primary",
                    required_kind="station",
                )
            },
        )
        manifest = dataclasses.replace(
            self._base_manifest(),
            services={"station-primary": station},
            clients=(alice,),
            state=ProvisioningState.FIXTURE_READY,
        )
        payload = manifest.to_dict()

        service_id, service = require_runtime_client_service(
            payload,
            "alice-primary",
            "station",
        )

        self.assertEqual(service_id, "station-primary")
        self.assertEqual(service["endpoint"], "http://station-primary.example")

    def test_verifies_live_client_binding_observation(self):
        import dataclasses

        station = dataclasses.replace(
            self._service("station-primary"),
            runtime_identity="peer-station-primary",
        )
        alice = ClientRuntime(
            id="alice-primary",
            actor="alice",
            runtime="native-tauri",
            worktree="/tmp/client",
            gateway_port=3030,
            renderer_port=3210,
            webdriver_port=4445,
            profile="acceptance-alice",
            storage_root="/tmp/client/storage",
            required_service_roles=("station",),
            service_bindings={
                "station": ClientServiceBinding(
                    service_id="station-primary",
                    required_kind="station",
                )
            },
        )
        manifest = dataclasses.replace(
            self._base_manifest(),
            services={"station-primary": station},
            clients=(alice,),
            state=ProvisioningState.FIXTURE_READY,
        ).to_dict()
        runtime_identity = ClientRuntimeIdentity(
            runtime="native-tauri",
            instance_id="alice-primary-generation-1",
            identity_digest="1" * 64,
        )

        proof = verify_client_binding_observation(
            manifest,
            evidence_run_id="evidence-run",
            client_id="alice-primary",
            binding_role="station",
            launch_generation=1,
            client_runtime_identity=runtime_identity,
            observed_runtime_identity="peer-station-primary",
            proof_mechanism="native-tauri-peer-id-check",
            registered_mechanisms=frozenset({"native-tauri-peer-id-check"}),
            verifier_id="core-client-binding",
            verifier_source_digest="2" * 64,
        )

        self.assertIsInstance(proof, BindingProofRecord)
        self.assertEqual(proof.declared_service_id, "station-primary")
        self.assertEqual(proof.verification_status, "VERIFIED")
        self.assertEqual(
            proof.to_dict()["clientRuntimeIdentity"]["instanceId"],
            "alice-primary-generation-1",
        )

    def test_rejects_mismatched_live_client_binding_observation(self):
        import dataclasses

        station = dataclasses.replace(
            self._service("station-primary"),
            runtime_identity="peer-station-primary",
        )
        alice = ClientRuntime(
            id="alice-primary",
            actor="alice",
            runtime="native-tauri",
            worktree="/tmp/client",
            gateway_port=3030,
            renderer_port=3210,
            webdriver_port=4445,
            profile="acceptance-alice",
            storage_root="/tmp/client/storage",
            required_service_roles=("station",),
            service_bindings={
                "station": ClientServiceBinding(
                    service_id="station-primary",
                    required_kind="station",
                )
            },
        )
        manifest = dataclasses.replace(
            self._base_manifest(),
            services={"station-primary": station},
            clients=(alice,),
            state=ProvisioningState.FIXTURE_READY,
        ).to_dict()

        with self.assertRaises(ClientBindingError) as context:
            verify_client_binding_observation(
                manifest,
                evidence_run_id="evidence-run",
                client_id="alice-primary",
                binding_role="station",
                launch_generation=1,
                client_runtime_identity=ClientRuntimeIdentity(
                    runtime="native-tauri",
                    instance_id="alice-primary-generation-1",
                    identity_digest="1" * 64,
                ),
                observed_runtime_identity="peer-wrong-station",
                proof_mechanism="native-tauri-peer-id-check",
                registered_mechanisms=frozenset(
                    {"native-tauri-peer-id-check"}
                ),
                verifier_id="core-client-binding",
                verifier_source_digest="2" * 64,
            )

        self.assertEqual(
            context.exception.code,
            "LAUNCH_IDENTITY_MISMATCH",
        )
        self.assertEqual(context.exception.stage, "post-launch")

    def test_manifest_rejects_mixed_bound_and_legacy_clients(self):
        import dataclasses

        station = self._service("station-primary")
        bound = ClientRuntime(
            id="alice-primary",
            actor="alice",
            runtime="native-tauri",
            worktree="/tmp/alice",
            gateway_port=3030,
            renderer_port=3210,
            webdriver_port=4445,
            profile="acceptance-alice",
            storage_root="/tmp/alice/storage",
            required_service_roles=("station",),
            service_bindings={
                "station": ClientServiceBinding(
                    service_id="station-primary",
                    required_kind="station",
                )
            },
        )
        legacy = ClientRuntime(
            actor="bob",
            runtime="native-tauri",
            worktree="/tmp/bob",
            gateway_port=3031,
            renderer_port=3211,
            webdriver_port=4446,
            profile="acceptance-bob",
            storage_root="/tmp/bob/storage",
        )
        manifest = dataclasses.replace(
            self._base_manifest(),
            services={"station-primary": station},
            clients=(bound, legacy),
        )

        with self.assertRaises(ClientBindingError) as context:
            manifest.to_dict()
        self.assertEqual(context.exception.code, "MISSING_REQUIRED_BINDING")

    def test_loaded_manifest_rejects_dangling_client_binding(self):
        payload = {
            **self._base_manifest().to_dict(),
            "state": ProvisioningState.FIXTURE_READY.value,
            "services": {
                "station-primary": self._service(
                    "station-primary"
                ).to_manifest_dict()
            },
            "clients": [
                {
                    "id": "alice-primary",
                    "actor": "alice",
                    "runtime": "native-tauri",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": "station-missing",
                            "required_kind": "station",
                        }
                    },
                }
            ],
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "manifest.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(ClientBindingError) as context:
                load_runtime_manifest(path, "test-gate")
        self.assertEqual(context.exception.code, "DANGLING_SERVICE_REF")

    def test_manifest_redacts_credentials_in_dict(self):
        os.environ["PT_TEST_SECRET"] = "super-secret-redact-me"
        try:
            import dataclasses
            m = dataclasses.replace(
                self._base_manifest(),
                credential_refs=("env:PT_TEST_SECRET",),
            )
            d = m.to_dict()
            serialized = json.dumps(d)
            self.assertNotIn("super-secret-redact-me", serialized)
        finally:
            del os.environ["PT_TEST_SECRET"]

    def test_manifest_writes_valid_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            m = self._base_manifest()
            path = Path(tmpdir) / "manifest.json"
            m.write(path)
            loaded = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(loaded["artifactKind"], "acceptance-runtime-manifest")
            self.assertEqual(loaded["state"], "DISCOVERED")
            with self.assertRaises(ProvisioningError):
                m.write(path)

    def test_run_id_is_unique(self):
        m1 = self._base_manifest()
        m2 = self._base_manifest()
        self.assertNotEqual(m1.run_id, m2.run_id)


class PathConstantsTests(unittest.TestCase):
    def test_environments_dir_exists(self):
        self.assertTrue(ENVIRONMENTS_DIR.exists())
        self.assertTrue((ENVIRONMENTS_DIR / "home-station.yaml").exists())


class MultiStationBindingTests(unittest.TestCase):
    def test_per_client_service_resolution(self):
        manifest = {
            "artifactKind": "acceptance-runtime-manifest",
            "state": "PROVISIONED",
            "services": {
                "station-four": {
                    "kind": "station",
                    "endpoint": "http://10.37.245.247:18080",
                },
                "station-home": {
                    "kind": "station",
                    "endpoint": "http://10.37.94.156:18132",
                },
            },
            "clients": [
                {
                    "id": "alice",
                    "actor": "alice",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": "station-four",
                            "required_kind": "station",
                        },
                    },
                },
                {
                    "id": "bob",
                    "actor": "bob",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": "station-home",
                            "required_kind": "station",
                        },
                    },
                },
            ],
        }
        from tooling.acceptance.core.provisioning import (
            require_runtime_client_service,
        )

        alice_sid, alice_svc = require_runtime_client_service(
            manifest, "alice", "station"
        )
        bob_sid, bob_svc = require_runtime_client_service(
            manifest, "bob", "station"
        )
        self.assertEqual(alice_sid, "station-four")
        self.assertEqual(alice_svc["endpoint"], "http://10.37.245.247:18080")
        self.assertEqual(bob_sid, "station-home")
        self.assertEqual(bob_svc["endpoint"], "http://10.37.94.156:18132")
        self.assertNotEqual(alice_svc["endpoint"], bob_svc["endpoint"])

    def test_wrong_binding_role_raises(self):
        manifest = {
            "services": {
                "station-four": {"kind": "station", "endpoint": "http://x"},
            },
            "clients": [
                {
                    "id": "alice",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": "station-four",
                            "required_kind": "station",
                        },
                    },
                },
            ],
        }
        from tooling.acceptance.core.provisioning import (
            require_runtime_client_service,
        )

        with self.assertRaises(ClientBindingError):
            require_runtime_client_service(manifest, "alice", "relay")

    def test_dangling_service_id_raises(self):
        manifest = {
            "services": {},
            "clients": [
                {
                    "id": "alice",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": "nonexistent",
                            "required_kind": "station",
                        },
                    },
                },
            ],
        }
        from tooling.acceptance.core.provisioning import (
            require_runtime_client_service,
        )

        with self.assertRaises(ProvisioningError):
            require_runtime_client_service(manifest, "alice", "station")

    def test_multi_station_environment_contract_loads(self):
        env_path = ENVIRONMENTS_DIR / "multi-station-linux.yaml"
        self.assertTrue(
            env_path.exists(),
            "multi-station-linux.yaml environment contract is missing",
        )
        data = json.loads(env_path.read_text(encoding="utf-8"))
        self.assertEqual(data["id"], "multi-station-linux")
        services = data["services"]
        self.assertIn("station-four", services)
        self.assertIn("station-home", services)
        clients = data["clients"]
        alice = next(c for c in clients if c["id"] == "alice")
        bob = next(c for c in clients if c["id"] == "bob")
        self.assertEqual(
            alice["service_bindings"]["station"]["service_id"], "station-four"
        )
        self.assertEqual(
            bob["service_bindings"]["station"]["service_id"], "station-home"
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
