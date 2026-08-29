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
    ClientRuntime,
    CredentialRef,
    EnvironmentContract,
    GapArtifact,
    ENVIRONMENTS_DIR,
    ProvisioningError,
    ProvisioningState,
    RuntimeManifest,
    StationAttestation,
    blocked_manifest,
    new_manifest,
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
        self.assertTrue(is_sensitive_key("credential_reference_secret"))
        value = redact_value(
            {
                "accessTokensPresent": False,
                "credentialRefs": ["env:TEST_PASSWORD"],
                "credentialReferenceSecret": "must-not-survive",
            }
        )
        self.assertFalse(value["accessTokensPresent"])
        self.assertEqual(value["credentialRefs"], ["env:TEST_PASSWORD"])
        self.assertEqual(value["credentialReferenceSecret"], REDACTED)


class EnvironmentContractTests(unittest.TestCase):
    def test_load_home_station_contract(self):
        contract = EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "home-station.yaml")
        self.assertEqual(contract.id, "home-station")
        self.assertTrue(contract.profile.required)
        self.assertTrue(contract.profile.identity_match)
        self.assertIn("station", contract.services)
        self.assertTrue(contract.services["station"].required)
        self.assertEqual(len(contract.credentials), 1)
        self.assertEqual(contract.credentials[0].id, "evidence-leak-canary")
        self.assertTrue(contract.credentials[0].generated_if_missing)
        self.assertIn("processes", contract.cleanup.resources)

    def test_load_local_desktop_gateway_contract(self):
        contract = EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "local-desktop-gateway.yaml")
        self.assertEqual(contract.id, "local-desktop-gateway")
        self.assertIn("station", contract.services)
        self.assertIn("desktop-gateway", contract.services)
        self.assertEqual(contract.fixtures[0].id, "chat-native-actors")
        self.assertTrue(contract.fixtures[0].authorization_required)
        self.assertEqual(
            contract.fixtures[0].authorization_ref,
            "env:CHAT_ACCEPTANCE_RESET",
        )
        self.assertEqual(contract.credentials[0].id, "chat-password")
        self.assertEqual(
            contract.credentials[0].source_ref,
            "fixture:apps/station/app/conf/actor.yml#preset_users",
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


class StationAttestationTests(unittest.TestCase):
    def test_clean_workspace_flag(self):
        att = StationAttestation(
            environment_id="test",
            url="http://127.0.0.1:3000",
            live_commit="abc123def",
            workspace_digest="clean",
            proto_digest="sha256:xyz",
            artifact_ref=TEST_ARTIFACT_REF,
            produced_at="2026-08-16T12:00:00+00:00",
        )
        self.assertTrue(att.is_clean_workspace)

    def test_dirty_workspace_flag(self):
        att = StationAttestation(
            environment_id="test",
            url="http://127.0.0.1:3000",
            live_commit="abc123def",
            workspace_digest="sha256:dirty",
            proto_digest="sha256:xyz",
            artifact_ref=TEST_ARTIFACT_REF,
            produced_at="2026-08-16T12:00:00+00:00",
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

    def test_new_manifest_defaults(self):
        m = self._base_manifest()
        self.assertEqual(m.artifact_kind, "acceptance-runtime-manifest")
        self.assertEqual(m.environment_id, "test-env")
        self.assertEqual(m.gate_id, "test-gate")
        self.assertEqual(m.state, ProvisioningState.DISCOVERED)
        self.assertFalse(m.is_ready())
        self.assertFalse(m.is_blocked())
        self.assertIsNone(m.station)
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

    def test_manifest_with_station_attestation(self):
        att = StationAttestation(
            environment_id="test",
            url="http://127.0.0.1:3000",
            live_commit="abc123",
            workspace_digest="clean",
            proto_digest="sha256:proto",
            artifact_ref=TEST_ARTIFACT_REF,
            produced_at="2026-08-16T12:00:00+00:00",
        )
        import dataclasses
        m = dataclasses.replace(self._base_manifest(), station=att, state=ProvisioningState.FIXTURE_READY)
        self.assertTrue(m.is_ready())
        d = m.to_dict()
        self.assertIn("station", d)
        self.assertEqual(d["station"]["liveCommit"], "abc123")

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
