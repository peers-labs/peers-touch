from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core import EnvironmentContract, REPO_ROOT
from tooling.acceptance.provisioners import get_provisioner
from tooling.acceptance.provisioners.mobile_simulator import (
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


if __name__ == "__main__":
    unittest.main()
