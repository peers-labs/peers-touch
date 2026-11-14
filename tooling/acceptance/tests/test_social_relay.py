"""Social Relay preparation checks; synthetic transports are not product proof."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.core.errors import BlockedError, EphemeralLaunchCleanupFailed
from tooling.acceptance.core.evidence_store import EvidenceStore
from tooling.acceptance.core.provisioning import ServiceAttestation
from tooling.acceptance.provisioners import social_relay as relay
from tooling.acceptance.provisioners.native_tauri_embedded_webdriver import (
    CrossStationSocialNativeProvisioner, NativeTauriEmbeddedWebDriverProvisioner,
)

COMMIT = "a" * 40
PROTO = "b" * 64
ROOT = Path(__file__).resolve().parents[3]


def config(role, name, *, origin=None):
    return relay.PosixServiceRuntimeConfig(
        environment_name=name, role=role, host=f"{name}.invalid", user="fixture", ssh_port=22,
        known_hosts_file="", deploy_path=f"deploy/{name}", runtime_path=f"deploy/{name}",
        http_port=18080, public_port=18681 if role == "relay" else 18080,
        libp2p_port=4112 if role == "relay" else None,
        public_base_url=origin or f"http://{name}.invalid:18080",
        compose_project=f"pt-{name}", compose_service=role, data_volume=f"data-{name}",
        tls_ca_path="/ca.pem" if role == "relay" else "", operator_key_path="/key" if role == "relay" else "",
    )


def runtime(cfg):
    return {
        "artifactKind": "posix-compose-runtime-status", "environmentName": cfg.environment_name,
        "platform": "linux", "role": cfg.role, "healthy": True, "sourceClean": True,
        "sourceCommit": COMMIT, "buildCommit": COMMIT, "processIds": [501],
        "containerId": f"container-{cfg.environment_name}", "runtimeOwner": cfg.compose_project,
        "dataOwner": cfg.data_volume, "httpPort": cfg.http_port, "publicPort": cfg.public_port,
        "libp2pPort": cfg.libp2p_port,
    }


class SocialRelayTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.run = EvidenceStore(self.root / "artifacts", worktree=ROOT).begin_run(
            "social-public-feed-native-e2e", source={"commit": COMMIT},
        )
        self.addCleanup(self.run.close)
        self.manifest = SimpleNamespace(
            gate_id=self.run.gate_id, run_id="c" * 16, source_commit=COMMIT,
            environment_id="cross-station-social-native",
        )
        self.events = []
        self.cleanups = []
        self.fixture = relay.SocialRelayFixture(
            profile="fedlab-a", repo_root=ROOT,
            register_cleanup=lambda name, callback: self.cleanups.append((name, callback)),
            acquire_profile_lease=lambda *scope: self.events.append(("profile", *scope)),
            acquire_source_lease=lambda *scope: self.events.append(("source", *scope)),
        )
        self.fixture.config = config("relay", "relay-fedlab-a", origin="https://relay.invalid:18681")
        self.fixture.relay_health = "https://relay.invalid:18681/health"
        self.stations = {
            name: ServiceAttestation(
                service_id=name, service_kind="station", environment_id=self.manifest.environment_id,
                deployment_environment=name, endpoint=f"http://{name}.invalid:18080",
                live_commit=COMMIT, workspace_digest="clean", protocol_digest=PROTO,
                artifact_ref={}, produced_at="2026-11-09T00:00:00Z", producer="fixture",
                runtime_identity=f"peer-{name}",
            ) for name in ("station-four", "station-five-arm")
        }

    def attach_context(self):
        self.enterContext(patch.object(relay, "resolve_remote_source_identity",
            side_effect=lambda _: (self.events.append(("attest",)) or (COMMIT, "clean", PROTO))))
        self.enterContext(patch.object(relay, "source_proto_digest", return_value=PROTO))
        self.enterContext(patch.object(relay, "inspect_posix_runtime", side_effect=runtime))
        self.enterContext(patch.object(relay, "_station_runtime_config",
            side_effect=lambda name, **_: config("station", name)))
        self.enterContext(patch.object(relay, "read_service_runtime_identity",
            side_effect=lambda url: "peer-" + url.split("//")[1].split(".")[0]))
        self.enterContext(patch.object(relay, "resolve_posix_relay_trust_anchor",
            return_value=(b"public-ca", "d" * 64)))
        self.enterContext(patch.object(relay, "_relay_peer_identity", return_value="relay-peer"))
        self.security = self.enterContext(patch.object(relay, "audit_posix_relay_security", return_value={}))
        self.persist = self.enterContext(patch.object(relay, "_persist_relay_attestation", return_value="attested"))

        def prepare(**options):
            self.events.append(("prepare", options["station_config"].environment_name))
            return {
                "relay_peer_id": options["relay_peer_id"], "control_origin": options["relay_url"],
                "state": "active", "enabled": True, "route_generation": 9,
                "invite_token": "must-not-enter-inventory",
            }
        self.prepare = self.enterContext(patch.object(self.fixture.attachments, "prepare", side_effect=prepare))

    def test_current_source_is_rechecked_after_retained_leases_and_both_stations_join(self):
        self.attach_context()
        self.assertEqual("attested", self.fixture.attach(self.manifest, self.stations))
        self.assertEqual([event[0] for event in self.events], ["profile", "source", "attest", "prepare", "prepare"])
        self.assertEqual(2, self.prepare.call_count)
        self.assertEqual(self.manifest.run_id, self.fixture.inventory["runId"])
        self.assertEqual(set(self.stations), set(self.fixture.inventory["stations"]))
        self.assertNotIn("must-not-enter-inventory", json.dumps(self.fixture.inventory))
        for record in self.fixture.inventory["stations"].values():
            self.assertEqual(9, record["attachment"]["route_generation"])
        self.persist.assert_called_once()

    def test_foreign_source_cannot_import_or_publish_attestation(self):
        self.attach_context()
        with patch.object(relay, "resolve_remote_source_identity", return_value=("f" * 40, "clean", PROTO)):
            with self.assertRaises(BlockedError):
                self.fixture.attach(self.manifest, self.stations)
        self.prepare.assert_not_called()
        self.persist.assert_not_called()

    def test_station_replacement_or_missing_joined_generation_cannot_publish_ready(self):
        for replacement in ("container", "peer", "generation", "shared-data"):
            with self.subTest(replacement=replacement), tempfile.TemporaryDirectory():
                self.attach_context()
                if replacement == "generation":
                    self.prepare.side_effect = lambda **_: {"route_generation": None}
                elif replacement == "peer":
                    self.enterContext(patch.object(relay, "read_service_runtime_identity", return_value="foreign"))
                elif replacement == "shared-data":
                    def shared(cfg):
                        value = runtime(cfg)
                        value["dataOwner"] = self.fixture.config.data_volume
                        return value
                    self.enterContext(patch.object(relay, "inspect_posix_runtime", side_effect=shared))
                else:
                    samples = [runtime(self.fixture.config), runtime(config("station", "station-four")),
                               {**runtime(config("station", "station-four")), "containerId": "replacement"}]
                    self.enterContext(patch.object(relay, "inspect_posix_runtime", side_effect=samples))
                with self.assertRaises(BlockedError):
                    self.fixture.attach(self.manifest, self.stations)
                self.persist.assert_not_called()
                self.assertIsNone(self.fixture.inventory)

    def test_original_parent_equips_before_station_leases_and_uses_one_shared_owner(self):
        parent = CrossStationSocialNativeProvisioner(
            EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "cross-station-social-native.yaml"),
            station_profiles={"station-four": "fiveArm", "station-five-arm": "four", "relay": "fedlab-a"},
        )
        parent.bind_evidence_run(self.run)
        self.assertEqual({"station-four": "fiveArm", "station-five-arm": "four"}, parent._required_station_profiles())
        fixture = Mock(inventory={"sourceCommit": COMMIT})
        fixture.equip.side_effect = lambda _: self.events.append(("equip-relay",))
        fixture.attach.side_effect = lambda _, stations: (
            self.events.append(("attach", tuple(stations))) or "relay-attestation")
        with patch.object(relay, "SocialRelayFixture", return_value=fixture) as factory, patch.object(
            NativeTauriEmbeddedWebDriverProvisioner, "_provision_station_services",
            side_effect=lambda _: self.events.append(("station-equipment-and-leases",)) or dict(self.stations),
        ):
            result = parent._provision_station_services(self.manifest)
        self.assertEqual(["equip-relay", "station-equipment-and-leases", "attach"], [e[0] for e in self.events])
        self.assertEqual("relay-attestation", result["relay"])
        self.assertEqual(parent.register_cleanup, factory.call_args.kwargs["register_cleanup"])
        self.assertEqual(parent.acquire_remote_git_source_lease, factory.call_args.kwargs["acquire_source_lease"])
        self.assertIs(fixture, parent._social_relay_fixture)
        self.assertEqual(COMMIT, json.loads(
            (self.run.run_dir / "runtime/social-relay-preparation.json").read_bytes())["sourceCommit"])

    def equipment_context(self, root):
        self.fixture.repo_root = root
        profile = {"PT_RELAY_MODE": "remote", "PT_RELAY_DEPLOY_ENV": "relay-fedlab-a",
                   "PT_RELAY_URL": "https://relay.invalid:18681",
                   "PT_RELAY_HEALTH_URL": "https://relay.invalid:18681/health"}
        self.enterContext(patch.object(relay, "resolve_reviewed_profile_environment", return_value=(root, profile)))
        self.enterContext(patch.object(relay.PosixServiceRuntimeConfig, "load", return_value=self.fixture.config))
        self.enterContext(patch.object(relay.subprocess, "check_output", side_effect=[COMMIT, "peers-touch-social"]))
        return profile

    def test_equipment_child_uses_canonical_deploy_without_parent_runtime_or_leases(self):
        root = self.root / "repo"
        script = root / "tooling/scripts/deploy/deploy.sh"
        script.parent.mkdir(parents=True)
        script.write_text(
            "exec python3 -c 'import json,os,sys; print(json.dumps({"
            "\"envFields\":sorted(os.environ),\"target\":os.environ.get(\"PT_DEV_TARGET_PROFILE\"),"
            "\"branch\":os.environ.get(\"BRANCH\"),\"argv\":sys.argv[1:]}))' \"$@\"",
        )
        local_run = EvidenceStore(self.root / "local-artifacts", worktree=root).begin_run(
            "social-public-feed-native-e2e", source={"commit": COMMIT},
        )
        self.addCleanup(local_run.close)
        self.equipment_context(root)
        # The real Launcher receives the parent evidence environment for capture only.
        with patch.dict(os.environ, {
            **local_run.subprocess_environment(), "PT_MACHINE_LEASE_FD": "999",
            "PT_ACCEPTANCE_ENVIRONMENT": "cross-station-social-native",
            "PT_SOCIAL_ACCEPTANCE_BUILD": "1", "PT_ACCEPTANCE_SSH_CONNECTIONS": "foreign",
            "PT_SOURCE_LEASE_HELD": "1", "SRV": "station", "ENV": "foreign",
        }):
            self.fixture.equip(self.manifest, timeout_seconds=10)
        logs = list((local_run.run_dir / "runtime/relay-equipment/fedlab-a").glob("*.log"))
        self.assertEqual(1, len(logs))
        value = json.loads(logs[0].read_bytes())
        self.assertEqual(["relay-fedlab-a"], value["argv"])
        self.assertEqual("fedlab-a", value["target"])
        self.assertEqual("peers-touch-social", value["branch"])
        self.assertFalse(any(key.startswith(("PT_MACHINE_LEASE_", "PT_SOCIAL_ACCEPTANCE_"))
                             for key in value["envFields"]))
        for key in ("PT_SOURCE_LEASE_HELD", "PT_ACCEPTANCE_SSH_CONNECTIONS",
                    "PT_ACCEPTANCE_ENVIRONMENT", "PT_ACCEPTANCE_RUN_ID", "SRV", "ENV"):
            self.assertNotIn(key, value["envFields"])
        self.assertEqual([], self.events)

    def test_equipment_process_cleanup_failure_is_not_replaced_with_ready_or_block(self):
        self.equipment_context(ROOT)
        failure = EphemeralLaunchCleanupFailed(
            "owned deployment process retained", operation="gate_process", result={"retained": "deployment"})
        with patch.object(relay.GateProcessLauncher, "run", side_effect=failure):
            with self.assertRaises(EphemeralLaunchCleanupFailed) as caught:
                self.fixture.equip(self.manifest)
        self.assertIs(failure, caught.exception)

    def test_unsafe_or_foreign_equipment_target_fails_before_deployment(self):
        for field, value in (
            ("PT_RELAY_MODE", "local"), ("PT_RELAY_DEPLOY_ENV", "corpstable"),
            ("PT_RELAY_URL", "https://foreign.invalid:18681"),
            ("PT_RELAY_HEALTH_URL", "https://foreign.invalid:18681/health"),
            ("PT_RELAY_HEALTH_URL", ""),
        ):
            with self.subTest(field=field), patch.object(relay.GateProcessLauncher, "run") as launch:
                profile = self.equipment_context(ROOT)
                profile[field] = value
                with self.assertRaises(BlockedError):
                    self.fixture.equip(self.manifest)
                launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
