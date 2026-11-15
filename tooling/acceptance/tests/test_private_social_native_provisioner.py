"""Private Social preparation delegates schema mutation before retained leases."""
from __future__ import annotations

import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from tooling.acceptance.core import (
    ENVIRONMENTS_DIR, ActorIdentity, ActorManifest, ClientRuntime,
    ClientServiceBinding, EnvironmentContract, ProvisioningState, RuntimeManifest,
    ServiceAttestation, BlockedError,
)
from tooling.acceptance.core.evidence_store import ArtifactRef, EvidenceStore
from tooling.acceptance.provisioners.native_tauri_embedded_webdriver import (
    CrossStationSocialNativeProvisioner, NativeTauriEmbeddedWebDriverProvisioner,
)
from tooling.acceptance.provisioners import social_relay
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
        self.relay = mock.Mock(inventory={"sourceCommit": COMMIT, "runId": self.manifest.run_id})
        self.relay.equip.side_effect = lambda _: self.events.append(("equip-relay",))
        self.relay.attach.side_effect = lambda _, stations: (
            self.events.append(("attach-relay", tuple(stations))) or "relay-attestation"
        )
        self.relay_factory = self.enterContext(mock.patch.object(
            social_relay, "SocialRelayFixture", return_value=self.relay,
        ))

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
        self.assertEqual({**self.services, "relay": "relay-attestation"}, result)
        self.assertEqual([
            ("equip-relay",), ("prepare", "fiveArm"), ("prepare", "four"),
            ("retain", "provisioning-epoch"),
        ], self.events[:4])
        self.assertEqual("attach-relay", self.events[-1][0])
        self.relay.attach.assert_called_once_with(self.manifest, self.services)
        self.relay.prepare_capture_probe.assert_not_called()
        self.assertIs(self.relay, self.provisioner._social_relay_fixture)
        self.assertEqual(self.provisioner.register_cleanup,
                         self.relay_factory.call_args.kwargs["register_cleanup"])
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
        relay_inventory = json.loads((self.run.run_dir / "runtime/social-relay-preparation.json").read_text())
        self.assertEqual(self.manifest.run_id, relay_inventory["runId"])

    def test_unknown_profile_fails_before_reset_or_retained_lease(self) -> None:
        self.provisioner._station_profiles["station-five-arm"] = "unreviewed"
        with self.assertRaises(BlockedError):
            self.provisioner._provision_station_services(self.manifest)
        self.prepare.assert_not_called()
        self.retained.assert_not_called()
        self.relay.equip.assert_not_called()

    def test_second_target_failure_prevents_retained_leases_and_inventory(self) -> None:
        failure = RuntimeError("secondary schema failed")
        self.prepare.side_effect = [self.root / "fiveArm.json", failure]
        with self.assertRaises(RuntimeError) as raised:
            self.provisioner._provision_station_services(self.manifest)
        self.assertIs(failure, raised.exception)
        self.retained.assert_not_called()
        self.relay.attach.assert_not_called()
        self.assertFalse((self.run.run_dir / "runtime/private-social-schema.json").exists())

    def test_live_verifier_failure_cannot_publish_ready_inventory(self) -> None:
        failure = RuntimeError("live schema changed")
        self.live.side_effect = failure
        with self.assertRaises(RuntimeError) as raised:
            self.provisioner._provision_station_services(self.manifest)
        self.assertIs(failure, raised.exception)
        self.assertFalse((self.run.run_dir / "runtime/private-social-schema.json").exists())
        self.relay.attach.assert_not_called()

    def test_relay_attachment_failure_cannot_publish_ready_transport_inventory(self) -> None:
        failure = BlockedError(reason="receiver has no verified route", resource="social-relay-binding")
        self.relay.attach.side_effect = failure
        with self.assertRaises(BlockedError) as raised:
            self.provisioner._provision_station_services(self.manifest)
        self.assertIs(failure, raised.exception)
        self.assertEqual(2, self.live.call_count)
        self.assertFalse((self.run.run_dir / "runtime/social-relay-preparation.json").exists())
        self.assertIs(self.relay, self.provisioner._social_relay_fixture)

    def test_equipment_failure_retains_original_relay_cleanup_owner(self) -> None:
        failure = RuntimeError("partial equipment failed")
        self.relay.equip.side_effect = failure
        with self.assertRaises(RuntimeError) as raised:
            self.provisioner._equip_social_relay(self.manifest)
        self.assertIs(failure, raised.exception)
        self.assertIs(self.relay, self.provisioner._social_relay_fixture)
        self.retained.assert_not_called()

    def test_notification_runtime_restoration_waits_for_owned_relay_retirement(self) -> None:
        self.manifest.gate_id = "social-public-feed-native-e2e"
        self.relay.attachments = mock.Mock(spec=social_relay.RelayAttachmentFixture)
        with mock.patch.object(self.provisioner, "register_cleanup") as register, mock.patch(
            "tooling.acceptance.provisioners.native_tauri_embedded_webdriver.equip_station_profile",
        ) as equip:
            self.provisioner._station_equipment_options(
                self.manifest, "station-five-arm", "four",
            )
            restore = register.call_args.args[1]
            failure = RuntimeError("retirement is incomplete")
            self.relay.attach.side_effect = failure
            with self.assertRaises(RuntimeError):
                self.provisioner._provision_station_services(self.manifest)
            self.relay.attachments.assert_attachments_retired.side_effect = failure
            with self.assertRaisesRegex(RuntimeError, "retirement is incomplete"):
                restore()
            equip.assert_not_called()
            self.relay.attachments.assert_attachments_retired.side_effect = None
            restore()
            equip.assert_called_once_with(
                "four", COMMIT, repo_root=REPO_ROOT, recreate_runtime=True,
            )

    def test_other_social_gate_preserves_its_original_preparation_owner(self) -> None:
        self.manifest.gate_id = "social-public-desktop-e2e"
        self.assertEqual(self.services, self.provisioner._provision_station_services(self.manifest))
        self.prepare.assert_not_called()
        self.load.assert_not_called()
        self.relay.equip.assert_not_called()

    def outage_manifest(self) -> RuntimeManifest:
        actors = ActorManifest(
            fixture_id=self.provisioner.fixture_id,
            environment_id=self.provisioner.environment_id,
            run_id="provisioning-epoch", created_at="2026-11-15T00:00:00Z",
            actors=tuple(ActorIdentity(role=role, account_ref=f"fixture:{role}", ptid=f"ptid:{role}")
                         for role in ("alice", "bob", "eve")),
            credential_refs=(), reset_authorized=True, target_verified=True,
        )
        actor_ref = self.run.write_json("runtime/actor-manifest.json", actors.to_dict())
        return RuntimeManifest(
            artifact_kind="acceptance-runtime-manifest",
            environment_id=self.provisioner.environment_id,
            gate_id=self.run.gate_id, run_id="provisioning-epoch",
            source_commit=COMMIT, created_at=actors.created_at,
            state=ProvisioningState.FIXTURE_READY, services=self.services,
            source_worktree=str(REPO_ROOT), workspace_digest="clean",
            profile_requested="fiveArm", profile_resolved="fiveArm", profile_slot=1,
            actor_manifest_ref=actor_ref.to_dict(),
            clients=tuple(
                ClientRuntime(
                    actor=actor, id=actor, runtime="native-tauri", worktree=str(REPO_ROOT),
                    gateway_port=1, renderer_port=2, webdriver_port=3,
                    profile=actor, storage_root=str(self.root / actor),
                    required_service_roles=("station",),
                    service_bindings={"station": ClientServiceBinding(
                        service_id=role, required_kind="station",
                    )},
                )
                for actor, role in (("alice", "station-four"), ("bob", "station-five-arm"))
            ),
            cleanup_registered=True,
        )

    def prepare_actor_provisioning(self):
        from tooling.acceptance.fixtures import chat_native_reset

        manifest = self.outage_manifest()
        actors = ActorManifest(
            fixture_id=self.provisioner.fixture_id,
            environment_id=self.provisioner.environment_id,
            run_id=manifest.run_id, created_at=manifest.created_at,
            actors=tuple(ActorIdentity(role=role, account_ref=f"fixture:{role}", ptid=f"ptid:{role}")
                         for role in ("alice", "bob", "eve")),
            credential_refs=(), reset_authorized=True, target_verified=True,
        )
        self.enterContext(mock.patch.object(
            self.provisioner, "_new_base_manifest", return_value=manifest,
        ))
        self.enterContext(mock.patch.object(
            self.provisioner, "_resolve_active_profile",
            return_value=("fiveArm", {}, 1, None),
        ))
        self.enterContext(mock.patch.object(
            self.provisioner, "_provision_station_services", return_value=self.services,
        ))
        self.enterContext(mock.patch.object(
            self.provisioner, "_resolve_credentials", return_value=((), {}),
        ))
        self.enterContext(mock.patch.object(
            self.provisioner, "_clients", return_value=manifest.clients,
        ))
        self.enterContext(mock.patch.dict(
            "os.environ", {"PT_ACCEPTANCE_RUNTIME_CELL": "desktop-macos-native"},
        ))
        self.reset_context = self.enterContext(mock.patch(
            "tooling.acceptance.provisioners.native_tauri_embedded_webdriver."
            "bound_reset_profiles",
        )).return_value
        self.reset_context.__enter__.side_effect = lambda: self.events.append(("reset-enter",))
        self.reset_context.__exit__.side_effect = (
            lambda *_: self.events.append(("reset-exit",)) or False
        )
        self.produce_actors = self.enterContext(mock.patch(
            "tooling.acceptance.provisioners.native_tauri_embedded_webdriver."
            "produce_bound_actor_manifest",
            side_effect=lambda **_: (
                self.events.append(("actors",))
                or (actors, None, manifest.actor_manifest_ref)
            ),
        ))
        self.reset_follows = self.enterContext(mock.patch.object(
            chat_native_reset, "reset_fixture_follow_edges",
            side_effect=lambda url, environment, ptids: self.events.append(
                ("follows", url, environment, tuple(ptids)),
            ),
        ))
        ready = self.provisioner._ready
        self.ready = self.enterContext(mock.patch.object(
            self.provisioner, "_ready", side_effect=lambda value: (
                self.events.append(("ready",)) or ready(value)
            ),
        ))

    def test_private_actor_baseline_resets_each_bound_station_before_ready(self):
        self.prepare_actor_provisioning()
        result = self.provisioner.provision(self.run.gate_id)
        self.assertEqual(ProvisioningState.FIXTURE_READY, result.state)
        primary = self.services["station-four"]
        secondary = self.services["station-five-arm"]
        self.assertEqual([
            ("reset-enter",), ("actors",),
            ("follows", primary.endpoint, primary.deployment_environment, ("ptid:alice",)),
            ("follows", secondary.endpoint, secondary.deployment_environment,
             ("ptid:bob", "ptid:eve")),
            ("reset-exit",), ("ready",),
        ], self.events)
        self.ready.assert_called_once()

    def test_public_actor_baseline_keeps_original_follow_preparation(self):
        self.prepare_actor_provisioning()
        result = self.provisioner.provision("social-public-feed-native-e2e")
        self.assertEqual(ProvisioningState.FIXTURE_READY, result.state)
        self.reset_follows.assert_not_called()
        self.assertEqual([
            ("reset-enter",), ("actors",), ("reset-exit",), ("ready",),
        ], self.events)

    def test_private_follow_reset_failure_cannot_admit_clients(self):
        self.prepare_actor_provisioning()
        failure = BlockedError(reason="bound follow reset failed", resource="fixture-follows")
        self.reset_follows.side_effect = [None, failure]
        result = self.provisioner.provision(self.run.gate_id)
        self.assertEqual(ProvisioningState.BLOCKED, result.state)
        self.assertEqual(2, self.reset_follows.call_count)
        self.ready.assert_not_called()
        self.reset_context.__exit__.assert_called_once()

    def test_private_outage_binds_only_the_attested_receiver_and_fail_safe_cleanup(self):
        from tooling.acceptance.provisioners import mobile_simulator
        self.provisioner._manifest = self.outage_manifest()
        handler = mock.Mock()
        handler.close.return_value = SimpleNamespace(closed=True, secrets_zeroized=True)
        delivery = mock.Mock()
        delivery.close.return_value = SimpleNamespace(closed=True, secrets_zeroized=True)
        context = mock.Mock()
        with (
            mock.patch.object(mobile_simulator, "MobileStationOutageCapabilityHandler",
                              return_value=handler) as factory,
            mock.patch("tooling.acceptance.provisioners.native_tauri_embedded_webdriver."
                       "EphemeralGateLaunchContext", return_value=context),
            mock.patch("tooling.acceptance.fixtures.social_private_delivery."
                       "SocialPrivateDeliveryHandler", return_value=delivery) as delivery_factory,
            mock.patch.object(self.provisioner, "register_cleanup") as register,
        ):
            actual = self.provisioner.create_gate_launch_context(
                gate_id=self.run.gate_id, evidence_run_id=self.run.run_id,
                provisioning_run_id="provisioning-epoch",
                required_capabilities=("mobile.station-outage", "social-private-delivery"),
            )
            self.assertIs(actual, context)
            self.assertFalse(hasattr(self.provisioner._manifest, "actors"))
            factory.assert_called_once_with(
                deployment_environment=self.services["station-five-arm"].deployment_environment,
                expected_commit=COMMIT,
            )
            self.assertEqual(context.register_capability.call_args_list, [
                mock.call("mobile.station-outage", handler),
                mock.call("social-private-delivery", delivery),
            ])
            delivery.prepare.assert_called_once_with()
            self.assertEqual(delivery_factory.call_args.kwargs["receiver_actor"], "ptid:bob")
            self.assertEqual(delivery_factory.call_args.kwargs["outsider_actor"], "ptid:eve")
            self.assertEqual(delivery_factory.call_args.kwargs["source_station"],
                             self.services["station-four"].runtime_identity)
            handler.invoke.assert_not_called()
            name, restore = register.call_args_list[0].args
            self.assertEqual(name, "private-social-station-outage")
            restore()
            handler.close.return_value = SimpleNamespace(closed=False, secrets_zeroized=True)
            with self.assertRaises(BlockedError):
                restore()

    def test_private_delivery_rejects_missing_or_foreign_actor_manifest_before_transport(self):
        from tooling.acceptance.provisioners import mobile_simulator
        for drift in ("missing", "evidence", "epoch"):
            with self.subTest(drift=drift):
                manifest = self.outage_manifest()
                if drift == "missing":
                    manifest = replace(manifest, actor_manifest_ref=None)
                else:
                    payload = self.run.store.read_json(
                        ArtifactRef.from_dict(manifest.actor_manifest_ref),
                    )
                    if drift == "epoch":
                        payload["runId"] = "foreign-epoch"
                    reference = self.run.write_json(f"runtime/actors-{drift}.json", payload)
                    actor_ref = reference.to_dict()
                    if drift == "evidence":
                        actor_ref["runId"] = self.run.run_id[:-1] + (
                            "0" if self.run.run_id[-1] != "0" else "1"
                        )
                    manifest = replace(manifest, actor_manifest_ref=actor_ref)
                self.provisioner._manifest = manifest
                with mock.patch.object(mobile_simulator,
                                       "MobileStationOutageCapabilityHandler") as factory:
                    with self.assertRaises(BlockedError):
                        self.provisioner.create_gate_launch_context(
                            gate_id=self.run.gate_id, evidence_run_id=self.run.run_id,
                            provisioning_run_id=manifest.run_id,
                            required_capabilities=("mobile.station-outage", "social-private-delivery"),
                        )
                    factory.assert_not_called()

    def test_private_outage_rejects_foreign_runs_or_unclean_receiver_before_transport(self):
        from tooling.acceptance.provisioners import mobile_simulator
        for drift in ("capability", "evidence", "epoch", "source", "same-station"):
            with self.subTest(drift=drift):
                self.provisioner._manifest = self.outage_manifest()
                manifest = self.provisioner._manifest
                if drift == "source":
                    manifest = replace(manifest, services={
                        **self.services,
                        "station-five-arm": SimpleNamespace(
                            service_kind="station", live_commit=COMMIT,
                            workspace_digest="dirty",
                            deployment_environment="synthetic-station",
                        ),
                    })
                if drift == "same-station":
                    manifest = replace(manifest, clients=(
                        manifest.clients[0],
                        replace(manifest.clients[1],
                                service_bindings=manifest.clients[0].service_bindings),
                    ))
                self.provisioner._manifest = manifest
                with mock.patch.object(mobile_simulator,
                                       "MobileStationOutageCapabilityHandler") as factory:
                    with self.assertRaises(BlockedError):
                        self.provisioner.create_gate_launch_context(
                            gate_id=self.run.gate_id,
                            evidence_run_id="foreign" if drift == "evidence" else self.run.run_id,
                            provisioning_run_id="foreign" if drift == "epoch" else manifest.run_id,
                            required_capabilities=() if drift == "capability"
                            else ("mobile.station-outage", "social-private-delivery"),
                        )
                    factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
