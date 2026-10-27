"""Profile resolution conformance; no service or product evidence is manufactured."""

from pathlib import Path
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.profile_bindings import resolve_service_profiles
from tooling.acceptance.core.provisioning import EnvironmentContract, ServiceRequirement


class ProfileBindingsTests(unittest.TestCase):
    def resolve(self, services, supplied=None):
        return resolve_service_profiles(
            EnvironmentContract(id="synthetic", services=services),
            supplied or {}, kinds=frozenset({"station", "relay"}), repo_root=Path.cwd(),
        )

    def test_one_profile_supplies_station_and_relay_roles_without_endpoint_arguments(self):
        with patch(
            "tooling.acceptance.core.profile_bindings.resolve_machine_profile_environment",
            return_value=("reviewed", Path("profile"), 13, {}),
        ) as active:
            result = self.resolve({
                "station": ServiceRequirement(kind="station"),
                "relay": ServiceRequirement(kind="relay"),
            })
        self.assertEqual(result, {"station": "reviewed", "relay": "reviewed"})
        active.assert_called_once()

    def test_multiple_stations_require_declared_profiles_and_do_not_infer_topology(self):
        with self.assertRaisesRegex(BlockedError, "multiple station roles"):
            self.resolve({
                "primary": ServiceRequirement(kind="station"),
                "secondary": ServiceRequirement(kind="station"),
            })

    def test_unselected_optional_roles_do_not_change_required_topology(self):
        with patch(
            "tooling.acceptance.core.profile_bindings.resolve_machine_profile_environment",
            return_value=("reviewed", Path("profile"), 13, {}),
        ):
            result = self.resolve({
                "station": ServiceRequirement(kind="station"),
                "route": ServiceRequirement(kind="station", required=False),
                "relay": ServiceRequirement(kind="relay", required=False),
            })
        self.assertEqual(result, {"station": "reviewed"})

    def test_factory_does_not_resolve_or_acquire_unselected_resources(self):
        from tooling.acceptance.core import ENVIRONMENTS_DIR
        from tooling.acceptance.provisioners import get_provisioner
        contract = EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "home-station.yaml")
        with patch(
            "tooling.acceptance.core.profile_bindings.resolve_machine_profile_environment",
            side_effect=AssertionError("Factory cannot resolve active Profile"),
        ):
            owner = get_provisioner(contract, service_profiles={"relay": "reviewed"})
        self.assertEqual(owner._service_profiles, {"relay": "reviewed"})

    def test_explicit_override_and_declaration_use_one_mapping(self):
        services = {
            "primary": ServiceRequirement(kind="station", profile_ref="profile:first"),
            "secondary": ServiceRequirement(kind="station", profile_ref="profile:second"),
        }
        self.assertEqual(
            self.resolve(services, {"primary": "override"}),
            {"primary": "override", "secondary": "second"},
        )

    def test_invalid_reference_unknown_role_and_invalid_name_fail_closed(self):
        for services, supplied in (
            ({"service": ServiceRequirement(kind="station", profile_ref="env:guess")}, {}),
            ({"service": ServiceRequirement(kind="station")}, {"unknown": "profile"}),
            ({"service": ServiceRequirement(kind="station")}, {"service": "../escape"}),
        ):
            with self.subTest(services=services, supplied=supplied), self.assertRaises(BlockedError):
                self.resolve(services, supplied)

    def test_make_profile_projection_cannot_select_a_different_active_target(self):
        from tooling.acceptance.core.provisioner import resolve_machine_profile_environment
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory) / "profile.env"
            profile.write_text("PT_DEV_PROFILE=active\n")
            resolved = {
                "authority": "machine-control-plane",
                "binding": {"profile": "active", "slot": 13},
                "profile": {"profileFile": str(profile), "sourceState": "tracked-clean"},
                "ports": {},
            }
            with patch(
                "tooling.acceptance.core.provisioner.subprocess.run",
                return_value=subprocess.CompletedProcess([], 0, json.dumps(resolved), ""),
            ), patch.dict("os.environ", {"PT_ACCEPTANCE_PROFILE": "other"}):
                with self.assertRaisesRegex(BlockedError, "differs from active"):
                    resolve_machine_profile_environment(Path(directory))

    def test_registration_routes_resolved_kinds_and_rejects_conflicting_aliases(self):
        from tooling.acceptance.provisioners import get_provisioner
        contract = EnvironmentContract(id="mobile-relay-simulator", services={
            "primary": ServiceRequirement(kind="station", profile_ref="profile:first"),
            "secondary": ServiceRequirement(kind="station", profile_ref="profile:second"),
            "relay": ServiceRequirement(kind="relay", profile_ref="profile:relay-profile"),
        })
        with patch("tooling.acceptance.provisioners._resolve") as resolve:
            with self.assertRaisesRegex(
                ProvisioningError, "conflicting station and service profile bindings",
            ):
                get_provisioner(
                    contract, station_profiles={"primary": "one"},
                    service_profiles={"primary": "two"},
                )
            resolve.assert_not_called()

    def test_shared_registration_merges_disjoint_roles_before_adapter_construction(self):
        from tooling.acceptance.core.provisioner import EnvironmentProvisioner
        from tooling.acceptance.provisioners import get_provisioner

        contract = EnvironmentContract(id="cross-station-social-native")
        captured = {}

        class SyntheticOwner(EnvironmentProvisioner):
            environment_id = contract.id

            def __init__(self, selected, *, station_profiles):
                super().__init__(selected)
                captured.update(station_profiles)

            def provision(self, gate_id):
                raise AssertionError("Registration cannot acquire a runtime")

        with patch(
            "tooling.acceptance.provisioners._resolve", return_value=SyntheticOwner,
        ):
            get_provisioner(
                contract, station_profiles={"primary": "first"},
                service_profiles={"secondary": "second"},
            )
        self.assertEqual(captured, {"primary": "first", "secondary": "second"})


if __name__ == "__main__":
    unittest.main()
