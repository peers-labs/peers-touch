#!/usr/bin/env python3
"""Mobile-native domain provisioning preflight tests."""

from __future__ import annotations

import dataclasses
import hashlib
import inspect
import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from tooling.acceptance.core import (
    ArtifactRef,
    BlockedError,
    EnvironmentContract,
    EvidenceStore,
    new_manifest,
)
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR
from tooling.acceptance.provisioners.mobile_native import (
    EXPECTED_APPIUM_VERSION,
    EXPECTED_CLIENTS,
    EXPECTED_DRIVER_IDENTITIES,
    MOBILE_OAUTH_PROOF_GATE_ID,
    CommandResult,
    MobileNativeProvisioner,
    MobileNativeSourceArtifactRefs,
    _with_mobile_resources,
    build_mobile_native_source_projection,
    load_mobile_native_preflight_spec,
    preflight_mobile_native_inputs,
    require_mobile_native_credentials,
)
from tooling.acceptance.fixtures.mobile_resource_lease import (
    CLIENT_PLATFORM,
    CLIENT_PROVIDER,
    PROVIDER_CLIENTS,
)


SOURCE_RUN_ID = "20260829T120000000000Z-" + ("1" * 32)
SOURCE_SHA256 = "sha256:" + ("a" * 64)
SOURCE_HEARTBEAT_AT = "2999-08-29T12:00:00Z"
SOURCE_RENEW_BEFORE = "2999-08-29T12:05:00Z"
SOURCE_EXPIRES_AT = "2999-08-29T12:10:00Z"
BUILD_PACKAGE_BYTES = {
    "ios": b"ios-application-package",
    "android": b"android-application-package",
}

class FakeCommandExecutor:
    def __init__(self) -> None:
        self.driver_versions = {
            "xcuitest": "9.10.5",
            "uiautomator2": "4.2.9",
        }
        self.ios_devices = {
            "00008030-001A2B3C4D5E601E",
            "00008030-001A2B3C4D5E602E",
        }
        self.android_devices = {"android-alice", "android-bob"}
        self.android_abi = "arm64-v8a"
        self.browser_version = "124.0.6367.82"
        self.chromedriver_version = "124.0.6367.207"

    def run(
        self,
        command: tuple[str, ...] | list[str],
        *,
        cwd: Path,
        env: dict[str, str],
        timeout: float,
    ) -> CommandResult:
        del cwd, env, timeout
        command = tuple(command)
        if command[:4] == ("appium", "driver", "list", "--installed"):
            return CommandResult(
                0,
                json.dumps(
                    {
                        name: {"version": version}
                        for name, version in self.driver_versions.items()
                    }
                ),
            )
        if command == ("xcrun", "xctrace", "list", "devices"):
            devices = "\n".join(
                f"iPhone ({device})" for device in sorted(self.ios_devices)
            )
            return CommandResult(
                0,
                f"== Devices ==\n{devices}\n== Simulators ==\n",
            )
        if command == ("adb", "devices", "-l"):
            devices = "\n".join(
                f"{device}\tdevice product:test"
                for device in sorted(self.android_devices)
            )
            return CommandResult(0, f"List of devices attached\n{devices}\n")
        if command[-2:] == ("getprop", "ro.kernel.qemu"):
            return CommandResult(0, "0\n")
        if command[-2:] == ("getprop", "ro.product.cpu.abi"):
            return CommandResult(0, f"{self.android_abi}\n")
        if command[-2:] == ("dumpsys", "webviewupdate"):
            return CommandResult(
                0,
                "Current WebView package (name, version): "
                f"(com.google.android.webview, {self.browser_version})\n",
            )
        if len(command) >= 2 and command[-3:-1] == ("dumpsys", "package"):
            return CommandResult(0, f"versionName={self.browser_version}\n")
        if command[-1:] == ("--version",):
            return CommandResult(0, f"ChromeDriver {self.chromedriver_version}\n")
        return CommandResult(1, stderr="unexpected command")


class MobileNativeSourceProjectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        worktree = root / "worktree"
        worktree.mkdir()
        self.store = EvidenceStore(root / "evidence", worktree=worktree)
        self.run = self.store.begin_run(
            MOBILE_OAUTH_PROOF_GATE_ID,
            source={"commit": "1" * 40, "workspaceDigest": "clean"},
            run_id=SOURCE_RUN_ID,
        )

    def tearDown(self) -> None:
        self.run.close()
        self.tempdir.cleanup()

    def _build_attestation(
        self,
        platform: str,
        package_reference: ArtifactRef,
    ) -> dict[str, Any]:
        package_kind = "ipa" if platform == "ios" else "apk"
        resolver = "xcode" if platform == "ios" else "gradle"
        resolver_arguments = {
            "pnpm": ["--offline", "--frozen-lockfile"],
            "cargo": ["--frozen"],
            resolver: (
                ["-disableAutomaticPackageResolution"]
                if platform == "ios"
                else ["--offline"]
            ),
        }
        signing: dict[str, Any] = {
            "policyId": "mobile-acceptance-debug",
            "certificateSha256": SOURCE_SHA256,
            "applicationIdentifier": "com.peers.touch.mobile",
            "debuggable": True,
        }
        if platform == "ios":
            signing.update(
                {
                    "teamIdentifier": "PEERSTEAM",
                    "applicationIdentifierEntitlement": (
                        "PEERSTEAM.com.peers.touch.mobile"
                    ),
                    "cdHash": {
                        "source": "codesign",
                        "algorithm": "sha256",
                        "valueHex": "b" * 40,
                        "candidateFullValueHex": "b" * 64,
                    },
                }
            )
        else:
            signing.update(
                {
                    "signerCertificateSha256": SOURCE_SHA256,
                    "enabledSigningSchemes": ["v2", "v3"],
                }
            )
        return {
            "artifactKind": "mobile-application-build-attestation",
            "runId": self.run.run_id,
            "gateId": MOBILE_OAUTH_PROOF_GATE_ID,
            "producer": "mobile-native-build",
            "producerSourceDigest": SOURCE_SHA256,
            "toolchainDigest": SOURCE_SHA256,
            "buildIsolation": {
                "environmentPolicy": "empty-base-explicit-allowlist",
                "dependencyPolicy": "locked-preseeded-offline",
                "resolverArguments": resolver_arguments,
                "inapplicableResolvers": [
                    "gradle" if platform == "ios" else "xcode"
                ],
                "cacheMissPolicy": "BLOCK",
                "ambientEnvironmentInherited": False,
            },
            "buildIdentity": {
                "schema": "peers-mobile-build-identity",
                "buildId": f"build-{platform}",
                "platform": platform,
                "configuration": "acceptance-debug",
                "sourceCommit": "1" * 40,
                "workspaceState": "dirty",
                "workspaceDigest": SOURCE_SHA256,
                "buildInputsDigest": SOURCE_SHA256,
                "allowlistedEnvironmentDigest": SOURCE_SHA256,
                "applicationId": "com.peers.touch.mobile",
                "harnessEnabled": True,
            },
            "embeddedIdentitySha256": SOURCE_SHA256,
            "artifact": {
                "kind": package_kind,
                "sha256": f"sha256:{package_reference.sha256}",
                "sizeBytes": len(BUILD_PACKAGE_BYTES[platform]),
                "artifactRef": package_reference.to_dict(),
            },
            "signing": signing,
            "createdAt": "2026-08-29T12:00:00Z",
        }

    def _provider_account_lease(self, provider: str) -> dict[str, Any]:
        return {
            "artifactKind": "provider-account-lease",
            "leaseId": f"account-{provider}",
            "resourceKey": f"provider-account/{provider}/disposable",
            "holderRunId": self.run.run_id,
            "fenceToken": 1,
            "runId": self.run.run_id,
            "gateId": MOBILE_OAUTH_PROOF_GATE_ID,
            "provider": provider,
            "accountRef": f"{provider}-disposable-account",
            "allowedClientIds": list(PROVIDER_CLIENTS[provider]),
            "maxConcurrentAuthorizations": 1,
            "heartbeatAt": SOURCE_HEARTBEAT_AT,
            "renewBefore": SOURCE_RENEW_BEFORE,
            "state": "LEASED",
            "acquiredAt": SOURCE_HEARTBEAT_AT,
            "expiresAt": SOURCE_EXPIRES_AT,
            "quarantineReason": "",
            "releaseEvidence": None,
        }

    def _physical_device_lease(self, client_id: str) -> dict[str, Any]:
        platform = CLIENT_PLATFORM[client_id]
        return {
            "artifactKind": "physical-device-lease",
            "leaseId": f"device-{client_id}",
            "resourceKey": f"physical-device/{client_id}",
            "holderRunId": self.run.run_id,
            "fenceToken": 2,
            "runId": self.run.run_id,
            "gateId": MOBILE_OAUTH_PROOF_GATE_ID,
            "clientId": client_id,
            "platform": platform,
            "physicalDeviceRef": f"device-ref/{client_id}",
            "destinationClassRef": f"{platform}-physical",
            "brokerRef": "mobile-physical-device-broker",
            "checks": {
                "connected": True,
                "physical": True,
                "simulator": False,
                "platformMatched": True,
            },
            "heartbeatAt": SOURCE_HEARTBEAT_AT,
            "renewBefore": SOURCE_RENEW_BEFORE,
            "acquiredAt": SOURCE_HEARTBEAT_AT,
            "expiresAt": SOURCE_EXPIRES_AT,
            "state": "BASELINE_VERIFIED",
            "quarantineReason": "",
            "releaseEvidence": None,
        }

    def _browser_session_lease(self, client_id: str) -> dict[str, Any]:
        return {
            "artifactKind": "provider-browser-session-lease",
            "leaseId": f"browser-{client_id}",
            "resourceKey": f"physical-device/{client_id}/browser/default",
            "holderRunId": self.run.run_id,
            "fenceToken": 3,
            "runId": self.run.run_id,
            "gateId": MOBILE_OAUTH_PROOF_GATE_ID,
            "clientId": client_id,
            "platform": CLIENT_PLATFORM[client_id],
            "physicalDeviceLeaseRef": f"physical-device-lease/{client_id}",
            "browserProfileRef": f"browser-profile/{client_id}",
            "providerAccountLeaseRef": (
                f"provider-account-lease/{CLIENT_PROVIDER[client_id]}"
            ),
            "baseline": "preauthenticated-exclusive",
            "checks": {
                "expectedIdentityMatched": True,
                "authorizationInProgress": False,
                "mobileOAuthStateAbsent": True,
                "stationRunStateAbsent": True,
            },
            "cleanupPolicy": "preserve-login-verify-identity",
            "heartbeatAt": SOURCE_HEARTBEAT_AT,
            "renewBefore": SOURCE_RENEW_BEFORE,
            "expiresAt": SOURCE_EXPIRES_AT,
            "state": "BASELINE_VERIFIED",
            "quarantineReason": "",
            "releaseEvidence": None,
        }

    def _source_payloads(self) -> dict[str, dict[str, dict[str, Any]]]:
        package_references = {
            platform: self.run.write_bytes(
                f"runtime/mobile/builds/{platform}."
                f"{'ipa' if platform == 'ios' else 'apk'}",
                package_bytes,
                media_type="application/octet-stream",
            )
            for platform, package_bytes in BUILD_PACKAGE_BYTES.items()
        }
        return {
            "build_attestations": {
                platform: self._build_attestation(
                    platform,
                    package_references[platform],
                )
                for platform in EXPECTED_DRIVER_IDENTITIES
            },
            "provider_account_leases": {
                provider: self._provider_account_lease(provider)
                for provider in PROVIDER_CLIENTS
            },
            "physical_device_leases": {
                client_id: self._physical_device_lease(client_id)
                for client_id in EXPECTED_CLIENTS
            },
            "browser_session_leases": {
                client_id: self._browser_session_lease(client_id)
                for client_id in EXPECTED_CLIENTS
            },
        }

    def _write_source_artifacts(
        self,
        payloads: dict[str, dict[str, dict[str, Any]]] | None = None,
    ) -> MobileNativeSourceArtifactRefs:
        values = payloads or self._source_payloads()
        paths = {
            "build_attestations": lambda key: (
                f"runtime/mobile/builds/{key}.json"
            ),
            "provider_account_leases": lambda key: (
                f"runtime/mobile/leases/accounts/{key}.json"
            ),
            "physical_device_leases": lambda key: (
                f"runtime/mobile/leases/devices/{key}.json"
            ),
            "browser_session_leases": lambda key: (
                f"runtime/mobile/leases/browsers/{key}.json"
            ),
        }
        references = {
            group: {
                key: self.run.write_json(
                    paths[group](key),
                    payload,
                    redact=False,
                )
                for key, payload in entries.items()
            }
            for group, entries in values.items()
        }
        return MobileNativeSourceArtifactRefs(**references)

    def _project(
        self,
        artifacts: MobileNativeSourceArtifactRefs,
    ):
        return build_mobile_native_source_projection(
            artifacts,
            reader=self.store,
            expected_workspace_id=self.store.workspace_id,
            expected_run_id=self.run.run_id,
        )

    def test_exact_source_set_projects_twelve_artifact_refs_only(self) -> None:
        projection = self._project(self._write_source_artifacts())

        self.assertEqual(set(projection.applications), {"ios", "android"})
        self.assertEqual(set(projection.provider_account_leases), {"github", "google"})
        self.assertEqual(set(projection.clients), set(EXPECTED_CLIENTS))
        references = [
            *(values["buildAttestation"] for values in projection.applications.values()),
            *projection.provider_account_leases.values(),
            *(
                values[role]
                for values in projection.clients.values()
                for role in ("physicalDeviceLease", "browserSessionLease")
            ),
        ]
        self.assertEqual(len(references), 12)
        self.assertTrue(all(isinstance(reference, ArtifactRef) for reference in references))

        serialized = json.dumps(projection.to_dict(), sort_keys=True)
        for forbidden in (
            "buildIdentity",
            "accountRef",
            "physicalDeviceRef",
            "browserProfileRef",
            "password",
            "accessToken",
            str(Path(self.tempdir.name)),
        ):
            self.assertNotIn(forbidden, serialized)

    def test_missing_and_extra_source_dimensions_block(self) -> None:
        artifacts = self._write_source_artifacts()
        dimensions = {
            "build_attestations": "ios",
            "provider_account_leases": "github",
            "physical_device_leases": "alice-ios",
            "browser_session_leases": "alice-ios",
        }
        for field_name, key in dimensions.items():
            original = dict(getattr(artifacts, field_name))
            missing = dict(original)
            missing.pop(key)
            with self.subTest(field=field_name, condition="missing"):
                with self.assertRaisesRegex(BlockedError, "dimensions do not match"):
                    self._project(dataclasses.replace(artifacts, **{field_name: missing}))

            extra = dict(original)
            extra["unexpected"] = original[key]
            with self.subTest(field=field_name, condition="extra"):
                with self.assertRaisesRegex(BlockedError, "dimensions do not match"):
                    self._project(dataclasses.replace(artifacts, **{field_name: extra}))

    def test_cross_workspace_run_and_gate_references_block(self) -> None:
        artifacts = self._write_source_artifacts()
        reference = artifacts.build_attestations["ios"]
        mismatches = {
            "workspace_id": dataclasses.replace(reference, workspace_id="f" * 16),
            "run_id": dataclasses.replace(
                reference,
                run_id="20260829T120000000000Z-" + ("f" * 32),
            ),
            "gate_id": dataclasses.replace(reference, gate_id="other-gate"),
        }
        for field_name, mismatched in mismatches.items():
            builds = dict(artifacts.build_attestations)
            builds["ios"] = mismatched
            with self.subTest(field=field_name):
                with self.assertRaisesRegex(BlockedError, "identity is invalid"):
                    self._project(
                        dataclasses.replace(
                            artifacts,
                            build_attestations=builds,
                        )
                    )

    def test_foreign_artifact_ref_kind_blocks_without_provisioning(self) -> None:
        artifacts = self._write_source_artifacts()
        builds = dict(artifacts.build_attestations)
        builds["ios"] = dataclasses.replace(
            builds["ios"],
            artifact_kind="foreign-artifact-ref",
        )

        with patch.object(MobileNativeProvisioner, "provision") as provision:
            with self.assertRaisesRegex(BlockedError, "identity is invalid"):
                self._project(
                    dataclasses.replace(
                        artifacts,
                        build_attestations=builds,
                    )
                )

        provision.assert_not_called()

    def test_missing_source_artifact_blocks(self) -> None:
        artifacts = self._write_source_artifacts()
        missing = artifacts.physical_device_leases["alice-ios"]
        self.store.resolve(missing).unlink()

        with self.assertRaisesRegex(BlockedError, "failed validation"):
            self._project(artifacts)

    def test_hash_mismatched_source_artifact_blocks(self) -> None:
        artifacts = self._write_source_artifacts()
        builds = dict(artifacts.build_attestations)
        builds["android"] = dataclasses.replace(
            builds["android"],
            sha256="0" * 64,
        )

        with self.assertRaisesRegex(BlockedError, "failed validation"):
            self._project(
                dataclasses.replace(artifacts, build_attestations=builds)
            )

    def test_missing_nested_build_package_blocks_before_provision(self) -> None:
        artifacts = self._write_source_artifacts()
        attestation = self.store.read_json(artifacts.build_attestations["ios"])
        package_reference = ArtifactRef.from_dict(
            attestation["artifact"]["artifactRef"]
        )
        self.store.resolve(package_reference).unlink()

        with patch.object(MobileNativeProvisioner, "provision") as provision:
            with self.assertRaisesRegex(
                BlockedError,
                "ios package artifact failed validation: artifact is missing",
            ):
                self._project(artifacts)

        provision.assert_not_called()

    def test_hash_mismatched_nested_build_package_blocks_before_provision(
        self,
    ) -> None:
        payloads = self._source_payloads()
        payloads["build_attestations"]["android"]["artifact"][
            "sha256"
        ] = "sha256:" + ("0" * 64)
        payloads["build_attestations"]["android"]["artifact"]["artifactRef"][
            "sha256"
        ] = "0" * 64
        artifacts = self._write_source_artifacts(payloads)

        with patch.object(MobileNativeProvisioner, "provision") as provision:
            with self.assertRaisesRegex(
                BlockedError,
                "android package artifact failed validation: artifact hash mismatch",
            ):
                self._project(artifacts)

        provision.assert_not_called()

    def test_wrong_payload_kind_blocks(self) -> None:
        payloads = self._source_payloads()
        payloads["build_attestations"]["ios"] = self._provider_account_lease(
            "github"
        )

        with self.assertRaisesRegex(BlockedError, "failed validation"):
            self._project(self._write_source_artifacts(payloads))

    def test_noncanonical_artifact_path_blocks(self) -> None:
        artifacts = self._write_source_artifacts()
        builds = dict(artifacts.build_attestations)
        builds["ios"] = dataclasses.replace(
            builds["ios"],
            path="runtime/mobile/builds/not-ios.json",
        )

        with self.assertRaisesRegex(BlockedError, "identity is invalid"):
            self._project(
                dataclasses.replace(artifacts, build_attestations=builds)
            )

    def test_client_platform_relation_mismatch_blocks(self) -> None:
        payloads = self._source_payloads()
        payloads["physical_device_leases"]["alice-ios"]["platform"] = "android"

        with self.assertRaisesRegex(BlockedError, "failed validation"):
            self._project(self._write_source_artifacts(payloads))

    def test_client_provider_relation_mismatch_blocks(self) -> None:
        payloads = self._source_payloads()
        payloads["browser_session_leases"]["alice-ios"][
            "providerAccountLeaseRef"
        ] = "provider-account-lease/google"

        with self.assertRaisesRegex(BlockedError, "failed validation"):
            self._project(self._write_source_artifacts(payloads))

    def test_duplicate_source_references_block(self) -> None:
        artifacts = self._write_source_artifacts()
        devices = dict(artifacts.physical_device_leases)
        devices["bob-ios"] = devices["alice-ios"]

        with self.assertRaisesRegex(BlockedError, "duplicate references"):
            self._project(
                dataclasses.replace(
                    artifacts,
                    physical_device_leases=devices,
                )
            )

    def test_provision_does_not_activate_source_projection_before_e25(self) -> None:
        source = inspect.getsource(MobileNativeProvisioner.provision)

        self.assertNotIn("build_mobile_native_source_projection", source)


class MobileNativeContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.contract_path = ENVIRONMENTS_DIR / "mobile-native.yaml"
        self.payload = json.loads(self.contract_path.read_text(encoding="utf-8"))
        self.spec = load_mobile_native_preflight_spec(self.contract_path)

    def test_checked_in_environment_loads_without_reconstruction(self) -> None:
        spec = load_mobile_native_preflight_spec()
        self.assertEqual(
            {client.id for client in spec.clients},
            set(EXPECTED_CLIENTS),
        )

    def test_contract_declares_appium_drivers_and_isolated_clients(self) -> None:
        self.assertEqual(
            {
                client.id: (client.platform, client.actor)
                for client in self.spec.clients
            },
            EXPECTED_CLIENTS,
        )
        clients = self.payload["clients"]
        self.assertEqual(
            {
                client["physical_device_lease_ref"]
                for client in clients
            },
            {
                "physical-device-lease/alice-ios",
                "physical-device-lease/bob-ios",
                "physical-device-lease/alice-android",
                "physical-device-lease/bob-android",
            },
        )
        self.assertEqual(len({client.profile for client in self.spec.clients}), 4)
        self.assertEqual(
            self.payload["appium"]["drivers"]["ios"]["identity"],
            EXPECTED_DRIVER_IDENTITIES["ios"][0],
        )
        self.assertEqual(
            self.payload["appium"]["drivers"]["android"]["identity"],
            EXPECTED_DRIVER_IDENTITIES["android"][0],
        )
        self.assertEqual(
            self.payload["appium"]["server"]["expected_version"],
            EXPECTED_APPIUM_VERSION,
        )
        self.assertEqual(
            self.spec.drivers["ios"].expected_version,
            "9.10.5",
        )
        self.assertEqual(
            self.spec.drivers["android"].expected_version,
            "4.2.9",
        )
        self.assertEqual(
            self.spec.build_environment,
            {"VITE_ACCEPTANCE_HARNESS": "1"},
        )
        self.assertEqual(
            self.spec.application_ids,
            {
                "ios": "com.peers.touch.mobile",
                "android": "com.peers.touch.mobile",
            },
        )
        self.assertEqual(
            self.spec.callback_schemes,
            {"ios": "peers-touch", "android": "peers-touch"},
        )
        self.assertEqual(
            self.payload["source_identity"],
            {
                "commit_required": True,
                "workspace_digest_required": True,
            },
        )
        android_destinations = {
            client["destination_ref"]
            for client in clients
            if client["platform"] == "android"
        }
        self.assertEqual(
            android_destinations,
            {"env:PT_MOBILE_ANDROID_AVD"},
        )

    def test_contract_declares_only_credential_variable_names(self) -> None:
        credential_refs = {
            credential["source_ref"]
            for credential in self.payload["credentials"]
        }
        self.assertEqual(
            credential_refs,
            {
                "env:MOBILE_ACCEPTANCE_GITHUB_ACCOUNT",
                "env:MOBILE_ACCEPTANCE_GOOGLE_ACCOUNT",
            },
        )
        serialized = json.dumps(self.payload)
        self.assertNotIn("password", serialized.lower())
        self.assertTrue(self.payload["cleanup"]["deterministic"])
        self.assertIn("appium-sessions", self.payload["cleanup"]["resources"])
        self.assertIn("deployment-leases", self.payload["cleanup"]["resources"])
        self.assertEqual(
            len({client.session_lease for client in self.spec.clients}),
            4,
        )
        self.assertTrue(
            all(len(client.port_roles) == 3 for client in self.spec.clients)
        )
        self.assertEqual(
            set(self.payload["leases"]["deployments"]),
            {"station-primary", "station-secondary", "relay"},
        )
        self.assertTrue(
            all(
                client["browser_session"]["owner"] == client["id"]
                and client["browser_session"]["credential_ref"]
                in {
                    "github-disposable-account",
                    "google-disposable-account",
                }
                and client["browser_session"]["baseline"]
                == "preauthenticated-exclusive"
                and client["browser_session"]["cleanup_policy"]
                == "preserve-login-verify-identity"
                and {
                    client["browser_session"]["clean_start"],
                    client["browser_session"]["readback"],
                    client["browser_session"]["cleanup"],
                }
                == {"required"}
                for client in self.payload["clients"]
            )
        )
        self.assertFalse(self.spec.chromedriver.acquisition_enabled)
        self.assertEqual(
            self.spec.chromedriver.cache_root,
            "<runtime-cache>/chromedriver",
        )

    def test_fixture_contract_retains_legacy_refs_and_e23_declarations(self) -> None:
        serialized = json.dumps(self.payload)
        self.assertIn("env:PT_MOBILE_IOS_ALICE_DEVICE_UDID", serialized)
        self.assertIn("env:PT_MOBILE_ANDROID_BOB_DEVICE_SERIAL", serialized)
        self.assertIn("env:PT_MOBILE_ANDROID_AVD", serialized)
        self.assertNotIn("PT_MOBILE_ANDROID_PHYSICAL_DESTINATION", serialized)
        self.assertEqual(
            len(self.payload["leases"]["physical_devices"]),
            4,
        )
        self.assertEqual(
            len(self.payload["leases"]["browser_profiles"]),
            4,
        )
        self.assertEqual(
            len(self.payload["leases"]["provider_accounts"]),
            2,
        )
        self.assertEqual(
            {
                account["max_concurrent_authorizations"]
                for account in self.payload["leases"]["provider_accounts"]
            },
            {1},
        )

    def test_mobile_manifest_preserves_references_without_secret_values(self) -> None:
        manifest = _with_mobile_resources(
            new_manifest(
                environment_id="mobile-native",
                gate_id="mobile-native-access-e2e",
                requested_profile="mobile",
                resolved_profile="mobile",
                slot=7,
                commit="commit",
                worktree="/tmp/worktree",
                workspace_digest="clean",
            ),
            {
                "credentialRefs": {
                    "github-disposable-account": (
                        "env:MOBILE_ACCEPTANCE_GITHUB_ACCOUNT"
                    )
                }
            },
        ).to_dict()
        self.assertEqual(
            manifest["mobileNative"]["credentialRefs"],
            {
                "github-disposable-account": (
                    "env:MOBILE_ACCEPTANCE_GITHUB_ACCOUNT"
                )
            },
        )


class MobileNativeInputPreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.spec = load_mobile_native_preflight_spec(
            ENVIRONMENTS_DIR / "mobile-native.yaml"
        )
        self.executor = FakeCommandExecutor()
        self.tempdir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.tempdir.name)
        for project in self.spec.projects.values():
            path = self.repo_root / project
            if path.suffix:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("project\n", encoding="utf-8")
            else:
                path.mkdir(parents=True, exist_ok=True)
        self.ios_app = self.repo_root / "build" / "ios.app"
        self.android_app = self.repo_root / "build" / "android.apk"
        self.ios_app.parent.mkdir(parents=True, exist_ok=True)
        self.ios_app.write_text("ios\n", encoding="utf-8")
        self.android_app.write_text("android\n", encoding="utf-8")
        self.runtime_cache = self.repo_root.parent / (
            f"{self.repo_root.name}-runtime-cache"
        )
        chromedriver_spec = self.spec.chromedriver
        artifact_spec = chromedriver_spec.artifacts[0]
        self.chromedriver_artifact = (
            self.runtime_cache
            / "chromedriver"
            / artifact_spec.cache_target
        )
        self.chromedriver_executable = (
            self.runtime_cache
            / "chromedriver"
            / artifact_spec.executable_target
        )
        self.chromedriver_artifact.parent.mkdir(parents=True, exist_ok=True)
        self.chromedriver_artifact.write_bytes(b"chromedriver-archive")
        self.chromedriver_executable.write_text(
            "chromedriver\n",
            encoding="utf-8",
        )
        self.chromedriver_executable.chmod(0o755)
        test_artifact = dataclasses.replace(
            artifact_spec,
            sha256=hashlib.sha256(b"chromedriver-archive").hexdigest(),
        )
        self.spec = dataclasses.replace(
            self.spec,
            chromedriver=dataclasses.replace(
                chromedriver_spec,
                artifacts=(test_artifact,),
            ),
        )
        self.environment = {
            "VITE_ACCEPTANCE_HARNESS": "1",
            "PT_MOBILE_IOS_APP_PATH": str(self.ios_app),
            "PT_MOBILE_ANDROID_APP_PATH": str(self.android_app),
            "PT_MOBILE_APPIUM_SERVER_URL": "http://127.0.0.1:4723",
            "PT_MOBILE_IOS_DESTINATION": "generic/platform=iOS,name=physical",
            "PT_MOBILE_IOS_ALICE_DEVICE_UDID": (
                "00008030-001A2B3C4D5E601E"
            ),
            "PT_MOBILE_IOS_BOB_DEVICE_UDID": (
                "00008030-001A2B3C4D5E602E"
            ),
            "PT_MOBILE_IOS_WDA_BUNDLE_ID": "com.peers.touch.wda",
            "PT_MOBILE_IOS_WEBVIEW_BUNDLE_ID": "com.peers.touch.mobile",
            "PT_MOBILE_ANDROID_AVD": "android-physical-device",
            "PT_MOBILE_ANDROID_ALICE_DEVICE_SERIAL": "android-alice",
            "PT_MOBILE_ANDROID_BOB_DEVICE_SERIAL": "android-bob",
            "PT_MOBILE_ACCEPTANCE_RUNTIME_CACHE": str(self.runtime_cache),
            "PT_MOBILE_ANDROID_CHROMEDRIVER_EXECUTABLE": str(
                self.chromedriver_executable
            ),
            "PT_MOBILE_ACCEPTANCE_RUNTIME_ROOT": str(
                self.repo_root / "runtime"
            ),
        }

    def tearDown(self) -> None:
        self.tempdir.cleanup()
        if self.runtime_cache.exists():
            import shutil

            shutil.rmtree(self.runtime_cache)

    def _preflight(self) -> dict[str, object]:
        return preflight_mobile_native_inputs(
            self.spec,
            repo_root=self.repo_root,
            executor=self.executor,
            environment=os.environ,
        )

    def _install_harness_actions(self) -> None:
        path = (
            self.repo_root
            / "apps"
            / "mobile"
            / "src"
            / "acceptance"
            / "actions.ts"
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "\n".join(
                f"registerMobileAcceptanceAction('{action}', async () => undefined);"
                for action in self.spec.harness_actions
            ),
            encoding="utf-8",
        )

    def test_missing_ios_project_blocks(self) -> None:
        (self.repo_root / self.spec.projects["ios"]).unlink()
        with patch.dict(os.environ, self.environment, clear=True):
            with self.assertRaisesRegex(BlockedError, "iOS project is missing"):
                self._preflight()

    def test_missing_acceptance_build_flag_blocks(self) -> None:
        environment = dict(self.environment)
        del environment["VITE_ACCEPTANCE_HARNESS"]
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(
                BlockedError,
                "VITE_ACCEPTANCE_HARNESS=1",
            ):
                self._preflight()

    def test_missing_appium_server_input_blocks(self) -> None:
        environment = dict(self.environment)
        del environment["PT_MOBILE_APPIUM_SERVER_URL"]
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(BlockedError, "APPIUM_SERVER_URL"):
                self._preflight()

    def test_duplicate_platform_devices_block(self) -> None:
        environment = dict(self.environment)
        environment["PT_MOBILE_IOS_BOB_DEVICE_UDID"] = environment[
            "PT_MOBILE_IOS_ALICE_DEVICE_UDID"
        ]
        with patch.dict(os.environ, environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            with self.assertRaisesRegex(
                BlockedError,
                "distinct physical devices",
            ):
                self._preflight()

    def test_wrong_installed_driver_version_blocks(self) -> None:
        self.executor.driver_versions["xcuitest"] = "9.10.4"
        with patch.dict(os.environ, self.environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            with self.assertRaisesRegex(BlockedError, "9.10.4"):
                self._preflight()

    def test_disconnected_ios_device_blocks(self) -> None:
        self.executor.ios_devices.remove(
            self.environment["PT_MOBILE_IOS_BOB_DEVICE_UDID"]
        )
        with patch.dict(os.environ, self.environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            with self.assertRaisesRegex(BlockedError, "connected physical"):
                self._preflight()

    def test_android_emulator_serial_blocks(self) -> None:
        environment = dict(self.environment)
        environment["PT_MOBILE_ANDROID_BOB_DEVICE_SERIAL"] = "emulator-5554"
        self.executor.android_devices.add("emulator-5554")
        with patch.dict(os.environ, environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            with self.assertRaisesRegex(BlockedError, "connected physical"):
                self._preflight()

    def test_chromedriver_checksum_mismatch_blocks(self) -> None:
        self.chromedriver_artifact.write_bytes(b"tampered")
        with patch.dict(os.environ, self.environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            with self.assertRaisesRegex(BlockedError, "checksum mismatch"):
                self._preflight()

    def test_missing_device_input_blocks(self) -> None:
        environment = dict(self.environment)
        del environment["PT_MOBILE_ANDROID_BOB_DEVICE_SERIAL"]
        with patch.dict(os.environ, environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            with self.assertRaisesRegex(
                BlockedError,
                "ANDROID_BOB_DEVICE_SERIAL",
            ):
                self._preflight()

    def test_missing_harness_actions_block(self) -> None:
        with patch.dict(os.environ, self.environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            with self.assertRaisesRegex(BlockedError, "Harness actions are missing"):
                self._preflight()

    def test_complete_preflight_returns_identity_inputs(self) -> None:
        self._install_harness_actions()
        with patch.dict(os.environ, self.environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            result = self._preflight()
        self.assertEqual(result["appiumVersion"], "2.19.0")
        self.assertEqual(
            result["driverVersions"],
            {"ios": "9.10.5", "android": "4.2.9"},
        )
        self.assertEqual(set(result["clients"]), set(EXPECTED_CLIENTS))
        self.assertEqual(result["chromedriver"]["browserMajor"], 124)
        self.assertEqual(
            result["iosReadiness"]["nativeContext"],
            "NATIVE_APP",
        )

    def test_missing_disposable_oauth_credentials_block(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "mobile-native.yaml"
        )
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(BlockedError, "credential preflight"):
                require_mobile_native_credentials(contract)


if __name__ == "__main__":
    unittest.main(verbosity=2)
