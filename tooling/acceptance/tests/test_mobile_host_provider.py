from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from tooling.acceptance.core import BlockedError
from tooling.acceptance.core.provisioning import EnvironmentContract
from tooling.acceptance.provisioners.mobile_host_provider import load_host_provider_config
from tooling.acceptance.provisioners.mobile_native import MobileNativeProvisioner
from tooling.acceptance.provisioners.mobile_native_build import (
    MobileNativeBuildError, _validate_apns_application, allowlisted_environment_digest,
)
from tooling.acceptance.provisioners.mobile_host_provider import HostProviderConfiguration
import plistlib


class HostProviderConfigurationTest(unittest.TestCase):
    def test_application_resources_change_the_controlled_environment_identity(self) -> None:
        environment = {"CARGO_HOME": "/unit/run/cargo-home"}
        first = allowlisted_environment_digest({
            **environment, "PT_ANDROID_FIREBASE_RESOURCES_JSON": '{"project_id":"one"}',
        })
        second = allowlisted_environment_digest({
            **environment, "PT_ANDROID_FIREBASE_RESOURCES_JSON": '{"project_id":"two"}',
        })
        self.assertNotEqual(first, second)

    def test_apns_build_requires_matching_team_and_signed_background_entitlements(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "app.ipa"
            provider = HostProviderConfiguration("ios", "", (), "ABCDEFGHIJ")
            for mutation in ("none", "team", "modes", "signature", "profile"):
                with self.subTest(mutation=mutation):
                    with zipfile.ZipFile(artifact, "w") as archive:
                        archive.writestr("Payload/Unit.app/Info.plist", plistlib.dumps({
                            "UIBackgroundModes": [] if mutation == "modes" else ["fetch", "remote-notification"],
                        }))
                    signature = {"aps-environment": "production" if mutation == "signature" else "development"}
                    profile = {"Entitlements": {
                        "aps-environment": "production" if mutation == "profile" else "development",
                    }}
                    with patch(
                        "tooling.acceptance.provisioners.mobile_native_build._run_required",
                    ), patch(
                        "tooling.acceptance.provisioners.mobile_native_build._plist_from_command",
                        side_effect=[signature, profile],
                    ):
                        def validate() -> None:
                            _validate_apns_application(
                                artifact, provider=provider,
                                signing={"teamIdentifier": "OTHERTEAM1" if mutation == "team" else provider.team_id},
                                runner=SimpleNamespace(), environment={},
                                executables={"codesign": "codesign", "security": "security"},
                            )
                        if mutation == "none":
                            validate()
                        else:
                            with self.assertRaises(MobileNativeBuildError):
                                validate()

    def test_invalid_provider_blocks_before_environment_credentials(self) -> None:
        contract = EnvironmentContract.from_yaml(
            Path(__file__).resolve().parents[1] / "environments/mobile-native.yaml",
        )
        for platform, variable in (
            ("android", "PT_ANDROID_FCM_PROVIDER_CONFIG"),
            ("ios", "PT_IOS_APNS_PROVIDER_CONFIG"),
        ):
            with self.subTest(platform=platform):
                provisioner = MobileNativeProvisioner(contract)
                provisioner._native_spec = SimpleNamespace(
                    scenario=SimpleNamespace(id=f"uca-{platform}-host"),
                )
                with patch.dict("os.environ", {variable: "configured"}, clear=True):
                    with self.assertRaises(BlockedError):
                        provisioner.prepare_credentials()
                self.assertIsNone(provisioner._prepared_credentials)

    def test_provider_admission_requires_private_source_bound_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()

            def write(name: str, value: dict) -> Path:
                path = root / name
                path.write_text(json.dumps(value), encoding="utf-8")
                path.chmod(0o600)
                return path

            key = rsa.generate_private_key(public_exponent=65537, key_size=2048).private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            ).decode("ascii")
            google = write("google.json", {
                "project_info": {"project_id": "unit-project", "project_number": "123"},
                "client": [{
                    "client_info": {
                        "mobilesdk_app_id": "1:123:android:abcdef",
                        "android_client_info": {"package_name": "com.peers.touch.mobile"},
                    },
                    "api_key": [{"current_key": "unit-api-key"}],
                }],
            })
            account = write("account.json", {
                "type": "service_account", "project_id": "unit-project",
                "token_uri": "https://oauth2.googleapis.com/token",
                "client_email": "unit@unit-project.iam.gserviceaccount.com",
                "private_key": key,
            })
            android = {
                "schemaVersion": 1, "applicationId": "com.peers.touch.mobile",
                "googleServices": str(google), "serviceAccount": str(account),
            }
            config = write("android.json", android)
            result = load_host_provider_config("android", str(config))
            self.assertEqual(json.loads(result.application_resources_json)["project_id"], "unit-project")
            self.assertIn(key, result.sensitive_values)
            self.assertNotIn(key, result.application_resources_json)
            self.assertNotIn(key, repr(result))
            for mutation in (
                {"schemaVersion": True}, {"applicationId": "other.application"},
                {"googleServices": "relative.json"}, {"serviceAccount": str(google)},
                {"unknown": "value"},
            ):
                with self.subTest(platform="android", mutation=mutation):
                    write("android.json", {**android, **mutation})
                    with self.assertRaises(BlockedError):
                        load_host_provider_config("android", str(config))
            write("android.json", android)
            config.chmod(0o644)
            with self.assertRaises(BlockedError):
                load_host_provider_config("android", str(config))
            config.chmod(0o600)
            link = root / "linked.json"
            link.symlink_to(config)
            with self.assertRaises(BlockedError):
                load_host_provider_config("android", str(link))
            for reference in ("configured", "", str(root / "missing")):
                with self.subTest(reference=reference), self.assertRaises(BlockedError):
                    load_host_provider_config("android", reference)
            private_key = root / "apns.p8"
            apns_key = ec.generate_private_key(ec.SECP256R1()).private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            ).decode("ascii")
            private_key.write_text(apns_key, encoding="ascii")
            private_key.chmod(0o600)
            ios = {
                "schemaVersion": 1, "applicationId": "com.peers.touch.mobile",
                "teamId": "ABCDEFGHIJ", "keyId": "0123456789",
                "environment": "development", "privateKey": str(private_key),
            }
            ios_config = write("ios.json", ios)
            result = load_host_provider_config("ios", str(ios_config))
            self.assertEqual(result.application_resources_json, "")
            self.assertIn(apns_key, result.sensitive_values)
            for invalid_key in (key, "-----BEGIN PRIVATE KEY-----\nbad\n-----END PRIVATE KEY-----\n"):
                with self.subTest(invalid_key_type="rsa-or-malformed"):
                    private_key.write_text(invalid_key, encoding="ascii")
                    with self.assertRaises(BlockedError):
                        load_host_provider_config("ios", str(ios_config))
            private_key.write_text(apns_key, encoding="ascii")
            for mutation in (
                {"environment": "production"}, {"teamId": "wrong"},
                {"keyId": "bad"}, {"applicationId": "other.application"},
                {"privateKey": str(root / "missing")},
            ):
                with self.subTest(platform="ios", mutation=mutation):
                    write("ios.json", {**ios, **mutation})
                    with self.assertRaises(BlockedError):
                        load_host_provider_config("ios", str(ios_config))
            with self.assertRaises(ValueError):
                load_host_provider_config("desktop", str(ios_config))


if __name__ == "__main__":
    unittest.main()
