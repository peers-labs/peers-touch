#!/usr/bin/env python3
"""Provisioning data model validation tests."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (
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

    def test_load_local_desktop_gateway_contract(self):
        contract = EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "local-desktop-gateway.yaml")
        self.assertEqual(contract.id, "local-desktop-gateway")
        self.assertIn("station", contract.services)
        self.assertIn("desktop-gateway", contract.services)
        self.assertEqual(contract.fixtures, ())
        self.assertEqual(contract.credentials, ())

    def test_load_native_tauri_contract(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "native-tauri-embedded-webdriver.yaml"
        )
        self.assertEqual(contract.id, "native-tauri-embedded-webdriver")
        self.assertEqual(
            set(contract.services),
            {"station-primary"},
        )
        self.assertEqual(
            {client.id for client in contract.clients},
            {"alice", "alice2", "bob", "bob1", "bob2", "charlie"},
        )
        self.assertTrue(
            all(service.kind == "station" for service in contract.services.values())
        )

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
