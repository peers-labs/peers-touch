from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from tooling.acceptance.core import EnvironmentContract, REPO_ROOT
from tooling.acceptance.provisioners import get_provisioner
from tooling.acceptance.provisioners.mobile_simulator import (
    MobileSimulatorAppiumCapabilityHandler,
    StationAccessNativeProvisioner,
)


class StationAccessProvisioningContractTest(unittest.TestCase):
    def test_resolves_reset_isolated_native_environment(self) -> None:
        contract = EnvironmentContract.from_yaml(
            REPO_ROOT
            / "tooling"
            / "acceptance"
            / "environments"
            / "station-access-native.yaml"
        )
        provisioner = get_provisioner(
            contract,
            station_profiles={"station": "chat-native-disposable"},
        )
        self.assertIsInstance(provisioner, StationAccessNativeProvisioner)
        self.assertTrue(provisioner.requires_actor_reset)
        self.assertFalse(provisioner.derives_fixture_federation_id)
        self.assertEqual(
            provisioner.gate_ids,
            {
                "station-access-auth-e2e",
                "station-access-federation-boundary-e2e",
                "station-access-scope-isolation-e2e",
            },
        )
        self.assertIn("session.logout", provisioner.child_harness_actions)
        self.assertIn(
            "federation.context.read",
            provisioner.child_harness_actions,
        )
        self.assertIn(
            "social.people.search",
            provisioner.child_harness_actions,
        )
        self.assertIn(
            "lifecycle.waitReady",
            provisioner.child_harness_actions,
        )
        self.assertIn(
            "recovery.snapshot",
            provisioner.child_harness_actions,
        )
        self.assertIn(
            "social.reconcile",
            provisioner.child_harness_actions,
        )

    def test_uses_the_active_reviewed_profile_without_local_cache(self) -> None:
        contract = EnvironmentContract.from_yaml(
            REPO_ROOT
            / "tooling"
            / "acceptance"
            / "environments"
            / "station-access-native.yaml"
        )
        provisioner = StationAccessNativeProvisioner(
            contract,
            station_profiles={"station": "chat-native-disposable"},
        )
        with patch(
            "tooling.acceptance.provisioners.mobile_simulator."
            "resolve_machine_profile_environment",
            return_value=(
                "chat-native-disposable",
                Path("/reviewed/profile.env.example"),
                4,
                {
                    "PT_DEV_PROFILE": "chat-native-disposable",
                    "PT_STATION_MODE": "remote",
                    "PT_STATION_URL": "https://station.example",
                    "PT_STATION_DEPLOY_ENV": "station-disposable",
                },
            ),
        ):
            merged = provisioner._inject_station_profile_bindings({})

        self.assertEqual(
            merged["PT_MOBILE_DIRECT_STATION_URL"],
            "https://station.example",
        )
        self.assertEqual(
            merged["PT_MOBILE_DIRECT_STATION_DEPLOY_ENV"],
            "station-disposable",
        )

    def test_access_desktop_clients_share_one_actor_identity_seed(
        self,
    ) -> None:
        actor_manifest = {
            "clients": [
                {
                    "id": "desktop-bob",
                    "actor": "bob",
                    "serviceId": "station",
                },
                {
                    "id": "desktop-bob-peer",
                    "actor": "bob",
                    "serviceId": "station",
                },
                {
                    "id": "sim-ios",
                    "actor": "bob",
                    "serviceId": "station",
                }
            ],
            "stations": {
                "station": {
                    "actors": [
                        {
                            "role": "bob",
                            "ptid": "ptid:bob",
                            "homeStationPeerId": "station-peer",
                        }
                    ]
                }
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clients = (
                SimpleNamespace(
                    id="desktop-bob",
                    actor="bob",
                    storage_root=str(root / "desktop-bob"),
                ),
                SimpleNamespace(
                    id="desktop-bob-peer",
                    actor="bob",
                    storage_root=str(root / "desktop-bob-peer"),
                ),
            )
            (
                StationAccessNativeProvisioner
                ._prepare_desktop_actor_identity_fixtures(
                    clients,
                    actor_manifest,
                )
            )
            identity_files = sorted(
                path for path in root.rglob("*") if path.is_file()
            )

            self.assertEqual(len(identity_files), 2)
            seeds = {
                path.read_text(encoding="ascii") for path in identity_files
            }
            self.assertEqual(len(seeds), 1)
            self.assertRegex(seeds.pop(), r"^[0-9a-f]{64}$")
            self.assertTrue(
                all(
                    path.stat().st_mode & 0o777 == 0o600
                    for path in identity_files
                )
            )
            manifest = {
                "services": {
                    "station": {
                        "kind": "station",
                        "runtimeIdentity": "station-peer",
                    }
                },
                "clients": [
                    {
                        "id": "desktop-bob",
                        "actor": "bob",
                        "runtime": "native-tauri",
                        "required_service_roles": ["station"],
                        "service_bindings": {
                            "station": {
                                "service_id": "station",
                                "required_kind": "station",
                            }
                        },
                        "storage_root": str(root / "desktop-bob"),
                    },
                    {
                        "id": "sim-ios",
                        "actor": "bob",
                        "runtime": "tauri-ios-simulator",
                        "required_service_roles": ["station"],
                        "service_bindings": {
                            "station": {
                                "service_id": "station",
                                "required_kind": "station",
                            }
                        },
                    },
                ],
                "mobileSimulator": {
                    "clientAssignments": {
                        "sim-ios": {
                            "actor": "bob",
                            "serviceId": "station",
                            "identitySourceClientId": "desktop-bob",
                        }
                    }
                },
            }
            session = MagicMock()
            session.call_action.return_value = {"prepared": True}
            handler = MobileSimulatorAppiumCapabilityHandler(
                manifest=manifest,
                artifact_writer=MagicMock(),
                session_factory=MagicMock(),
                harness_actions=(),
                child_harness_actions=(),
                actor_manifest=actor_manifest,
            )
            handler._active_binding_roles["sim-ios"] = "station"

            self.assertTrue(
                handler._prepare_shared_actor_identity(
                    "sim-ios",
                    session=session,
                )
            )


if __name__ == "__main__":
    unittest.main()
