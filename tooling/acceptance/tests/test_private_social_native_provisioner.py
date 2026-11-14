"""Private Social preparation delegates schema mutation before retained leases."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract, ServiceAttestation, BlockedError
from tooling.acceptance.core.evidence_store import EvidenceStore
from tooling.acceptance.provisioners.native_tauri_embedded_webdriver import (
    CrossStationSocialNativeProvisioner, NativeTauriEmbeddedWebDriverProvisioner,
)
from tooling.development.secure_content import runtime_schema

REPO_ROOT = Path(__file__).resolve().parents[3]
COMMIT = "a" * 40


class PrivateSocialNativeProvisionerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.store = EvidenceStore(self.root / "artifacts", worktree=REPO_ROOT)
        self.run = self.store.begin_run("social-cross-station-native-e2e", source={"commit": COMMIT})
        self.addCleanup(self.run.close)
        self.provisioner = CrossStationSocialNativeProvisioner(
            EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "cross-station-social-native.yaml"),
            station_profiles={"station-four": "fiveArm", "station-five-arm": "four"},
        )
        self.provisioner.bind_evidence_run(self.run)
        self.manifest = SimpleNamespace(gate_id=self.run.gate_id, run_id="provisioning-epoch", source_commit=COMMIT)
        self.events = []

        def prepare(repo, *, task_id, target_profile, source_commit):
            self.events.append(("prepare", target_profile))
            return self.root / target_profile / "attestation.json"

        self.prepare = self.enterContext(mock.patch.object(
            runtime_schema, "prepare_private_social_runtime", side_effect=prepare,
        ))
        self.services = {}
        for role, profile in self.provisioner._required_station_profiles().items():
            target = runtime_schema.RUNTIME_TARGETS[profile]
            service = ServiceAttestation(
                service_id=role, service_kind="station", environment_id="cross-station-social-native",
                deployment_environment=target.deployment_environment,
                endpoint=f"http://{role}.invalid", live_commit=COMMIT, workspace_digest="clean",
                protocol_digest="b" * 64, artifact_ref={}, produced_at="2026-11-08T00:00:00Z",
                producer="synthetic-transport", runtime_identity=f"peer-{target.service_id}",
            )
            ref = self.run.write_json(f"services/{role}.json", service.to_dict())
            self.services[role] = service.__class__(**{**service.__dict__, "artifact_ref": ref.to_dict()})

        def retained(manifest):
            self.events.append(("retain", manifest.run_id))
            return self.services

        self.retained = self.enterContext(mock.patch.object(
            NativeTauriEmbeddedWebDriverProvisioner, "_provision_station_services", side_effect=retained,
        ))

        def load(path, **identity):
            self.events.append(("verify", identity["service_id"]))
            raw = json.dumps(identity, sort_keys=True, default=str).encode()
            return SimpleNamespace(path=path, raw_bytes=raw, provenance_files=(
                (path.parent / "journal.json", b'{"original":"journal"}'),
            ))

        self.load = self.enterContext(mock.patch(
            "tooling.development.secure_content.runtime_manifest.load_canonical_private_schema_attestation",
            side_effect=load,
        ))
        self.live = self.enterContext(mock.patch(
            "tooling.development.secure_content.runtime_owner._verify_live_canonical_private_schema_attestation",
        ))

    def test_both_targets_prepare_before_retaining_and_preserve_physical_bytes(self) -> None:
        result = self.provisioner._provision_station_services(self.manifest)
        self.assertEqual(self.services, result)
        self.assertEqual([("prepare", "fiveArm"), ("prepare", "four"), ("retain", "provisioning-epoch")],
                         self.events[:3])
        self.assertEqual(2, self.prepare.call_count)
        self.assertEqual(2, self.live.call_count)
        for call in self.prepare.call_args_list:
            self.assertEqual(COMMIT, call.kwargs["source_commit"])
        inventory = json.loads((self.run.run_dir / "runtime/private-social-schema.json").read_text())
        self.assertEqual("provisioning-epoch", inventory["runId"])
        self.assertNotEqual(self.run.run_id, inventory["runId"])
        for role, service in self.services.items():
            entry = inventory["services"][role]
            schema = self.run.run_dir / entry["attestationRef"]["path"]
            self.assertEqual(service.artifact_ref, entry["serviceAttestationRef"])
            copied = json.loads(schema.read_bytes())
            self.assertEqual(entry["physicalServiceId"], copied["service_id"])
            self.assertEqual(entry["profileId"], copied["profile_id"])
            self.assertEqual(service.runtime_identity, copied["station_runtime_identity"])
            self.assertEqual(b'{"original":"journal"}', (schema.parent / "journal.json").read_bytes())

    def test_unknown_profile_fails_before_reset_or_retained_lease(self) -> None:
        self.provisioner._station_profiles["station-five-arm"] = "unreviewed"
        with self.assertRaises(BlockedError):
            self.provisioner._provision_station_services(self.manifest)
        self.prepare.assert_not_called()
        self.retained.assert_not_called()

    def test_second_target_failure_prevents_retained_leases_and_inventory(self) -> None:
        failure = RuntimeError("secondary schema failed")
        self.prepare.side_effect = [self.root / "fiveArm.json", failure]
        with self.assertRaises(RuntimeError) as raised:
            self.provisioner._provision_station_services(self.manifest)
        self.assertIs(failure, raised.exception)
        self.retained.assert_not_called()
        self.assertFalse((self.run.run_dir / "runtime/private-social-schema.json").exists())

    def test_live_verifier_failure_cannot_publish_ready_inventory(self) -> None:
        failure = RuntimeError("live schema changed")
        self.live.side_effect = failure
        with self.assertRaises(RuntimeError) as raised:
            self.provisioner._provision_station_services(self.manifest)
        self.assertIs(failure, raised.exception)
        self.assertFalse((self.run.run_dir / "runtime/private-social-schema.json").exists())

    def test_other_social_gate_preserves_its_original_preparation_owner(self) -> None:
        self.manifest.gate_id = "social-public-desktop-e2e"
        self.assertEqual(self.services, self.provisioner._provision_station_services(self.manifest))
        self.prepare.assert_not_called()
        self.load.assert_not_called()


if __name__ == "__main__":
    unittest.main()
