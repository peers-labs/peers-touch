from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any, TypeVar

from tooling.acceptance.core import ArtifactRef, DriverError
from tooling.acceptance.fixtures.mobile_resource_lease import (
    ResolvedPhysicalDeviceHandle,
)
from tooling.acceptance.gates.mobile.appium import AppiumSession


RUN_ID = "20260830T120000000000Z-" + ("1" * 32)
WORKSPACE_ID = "a" * 16
GATE_ID = "mobile-native-access-e2e"
APPLICATION_ID = "com.peers.touch.mobile"
SHA256 = "sha256:" + ("b" * 64)
_T = TypeVar("_T")


def _json_bytes(value: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(value, indent=2, sort_keys=True, default=str) + "\n"
    ).encode("utf-8")


def _reference(
    path: str,
    content: bytes,
    *,
    media_type: str = "application/json",
) -> ArtifactRef:
    return ArtifactRef(
        workspace_id=WORKSPACE_ID,
        gate_id=GATE_ID,
        run_id=RUN_ID,
        path=path,
        sha256=hashlib.sha256(content).hexdigest(),
        media_type=media_type,
    )


def _device_lease(client_id: str, platform: str) -> dict[str, Any]:
    return {
        "artifactKind": "physical-device-lease",
        "leaseId": f"device-{client_id}",
        "resourceKey": f"physical-device/{client_id}",
        "holderRunId": RUN_ID,
        "fenceToken": 9,
        "runId": RUN_ID,
        "gateId": GATE_ID,
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
        "heartbeatAt": "2099-08-30T12:00:00Z",
        "renewBefore": "2099-08-30T12:05:00Z",
        "acquiredAt": "2099-08-30T12:00:00Z",
        "expiresAt": "2099-08-30T12:10:00Z",
        "state": "BASELINE_VERIFIED",
        "quarantineReason": "",
        "releaseEvidence": None,
    }


def _build_attestation(
    platform: str,
    package_reference: ArtifactRef,
) -> dict[str, Any]:
    package_kind = "ipa" if platform == "ios" else "apk"
    signing: dict[str, Any] = {
        "policyId": "mobile-acceptance-debug",
        "certificateSha256": SHA256,
        "applicationIdentifier": APPLICATION_ID,
        "debuggable": True,
    }
    if platform == "ios":
        signing.update(
            {
                "teamIdentifier": "PEERSTEAM",
                "applicationIdentifierEntitlement": (
                    f"PEERSTEAM.{APPLICATION_ID}"
                ),
                "cdHash": {
                    "source": "codesign",
                    "algorithm": "sha256",
                    "valueHex": "a" * 40,
                    "candidateFullValueHex": "a" * 64,
                },
            }
        )
    else:
        signing.update(
            {
                "signerCertificateSha256": SHA256,
                "enabledSigningSchemes": ["v2", "v3"],
            }
        )
    resolver_arguments = {
        "pnpm": ["--offline", "--frozen-lockfile"],
        "cargo": ["--frozen"],
        "xcode" if platform == "ios" else "gradle": (
            ["-disableAutomaticPackageResolution"]
            if platform == "ios"
            else ["--offline"]
        ),
    }
    return {
        "artifactKind": "mobile-application-build-attestation",
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "producer": "mobile-native-build",
        "producerSourceDigest": SHA256,
        "toolchainDigest": SHA256,
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
            "workspaceDigest": SHA256,
            "buildInputsDigest": SHA256,
            "allowlistedEnvironmentDigest": SHA256,
            "applicationId": APPLICATION_ID,
            "harnessEnabled": True,
        },
        "embeddedIdentitySha256": SHA256,
        "artifact": {
            "kind": package_kind,
            "sha256": f"sha256:{package_reference.sha256}",
            "sizeBytes": 15,
            "artifactRef": package_reference.to_dict(),
        },
        "signing": signing,
        "createdAt": "2026-08-30T12:00:00Z",
    }


class FakeArtifactReader:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.values: dict[str, bytes] = {}

    def add_json(self, path: str, value: Mapping[str, Any]) -> ArtifactRef:
        content = _json_bytes(value)
        reference = _reference(path, content)
        self.values[path] = content
        return reference

    def add_package(self, platform: str) -> ArtifactRef:
        suffix = "ipa" if platform == "ios" else "apk"
        path = f"runtime/mobile/builds/{platform}.{suffix}"
        content = b"attested-mobile"
        self.values[path] = content
        return _reference(path, content, media_type="application/octet-stream")

    def read_json(self, reference: ArtifactRef) -> dict[str, Any]:
        content = self.values[reference.path]
        if hashlib.sha256(content).hexdigest() != reference.sha256:
            raise ValueError("artifact hash mismatch")
        value = json.loads(content)
        if not isinstance(value, dict):
            raise ValueError("artifact is not an object")
        return value

    def resolve(self, reference: ArtifactRef) -> Path:
        content = self.values[reference.path]
        if hashlib.sha256(content).hexdigest() != reference.sha256:
            raise ValueError("artifact hash mismatch")
        path = self.root / Path(reference.path).name
        path.write_bytes(content)
        return path


class RecordingBroker:
    def __init__(self, platform: str, *, failure: Exception | None = None) -> None:
        self.platform = platform
        self.failure = failure
        self.calls: list[dict[str, Any]] = []

    def with_physical_device(
        self,
        lease: Mapping[str, Any],
        operation: Callable[[ResolvedPhysicalDeviceHandle], _T],
    ) -> _T:
        self.calls.append(dict(lease))
        if self.failure is not None:
            raise self.failure
        return operation(
            ResolvedPhysicalDeviceHandle(
                _identifier=f"secret-{self.platform}-device",
                platform=self.platform,
                connected=True,
                physical=True,
                simulator=False,
            )
        )


class RecordingTransport:
    def __init__(self, identity: Mapping[str, Any]) -> None:
        self.identity = dict(identity)
        self.installed = True
        self.requests: list[tuple[str, str, dict[str, Any] | None]] = []

    def request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        body = dict(payload) if payload is not None else None
        self.requests.append((method, path, body))
        if method == "POST" and path == "/session":
            return {"sessionId": "session", "capabilities": {}}
        if path.endswith("/appium/device/remove_app"):
            self.installed = False
            return None
        if path.endswith("/appium/device/app_installed"):
            return self.installed
        if path.endswith("/appium/device/install_app"):
            self.installed = True
            return None
        if (
            path.endswith("/execute/sync")
            and body
            and body["script"] == "mobile: activeAppInfo"
        ):
            return {"bundleId": APPLICATION_ID}
        if (
            path.endswith("/execute/sync")
            and body
            and body["script"] == "mobile: getCurrentActivity"
        ):
            return {"appPackage": APPLICATION_ID, "appActivity": ".MainActivity"}
        if path.endswith("/execute/async"):
            return {
                "value": {
                    "identity": dict(self.identity),
                    "embeddedIdentitySha256": SHA256,
                }
            }
        if path.endswith("/contexts"):
            return ["NATIVE_APP", "WEBVIEW_com.peers.touch.mobile"]
        if path.endswith("/execute/sync"):
            return ["build.identity"]
        return None


class AppiumConsumerCutoverTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)

    def _session(
        self,
        platform: str = "ios",
        *,
        broker_failure: Exception | None = None,
    ) -> tuple[
        AppiumSession,
        RecordingTransport,
        RecordingBroker,
        FakeArtifactReader,
    ]:
        reader = FakeArtifactReader(Path(self.temporary.name))
        package_ref = reader.add_package(platform)
        attestation = _build_attestation(platform, package_ref)
        build_ref = reader.add_json(
            f"runtime/mobile/builds/{platform}.json",
            attestation,
        )
        client_id = f"alice-{platform}"
        device_ref = reader.add_json(
            f"runtime/mobile/leases/devices/{client_id}.json",
            _device_lease(client_id, platform),
        )
        transport = RecordingTransport(attestation["buildIdentity"])
        broker = RecordingBroker(platform, failure=broker_failure)
        session = AppiumSession(
            transport,
            client_id=client_id,
            platform=platform,
            automation_name=(
                "XCUITest" if platform == "ios" else "UiAutomator2"
            ),
            artifact_reader=reader,
            device_broker=broker,
            physical_device_lease=device_ref,
            build_attestation=build_ref,
            callback_scheme="peers-touch",
            ports={
                "wda-local": 8101,
                "system": 8201,
                "mjpeg": 9101,
                "webview": 9512,
            },
            chromedriver_executable=(
                "/runtime-cache/chromedriver"
                if platform == "android"
                else ""
            ),
        )
        return session, transport, broker, reader

    def test_start_uses_fenced_handle_and_exact_fresh_install_order(self) -> None:
        session, transport, broker, _ = self._session()

        session.start()

        capabilities = transport.requests[0][2]["capabilities"]["alwaysMatch"]
        self.assertEqual(capabilities["appium:udid"], "secret-ios-device")
        self.assertNotIn("appium:app", capabilities)
        legacy_reset_capabilities = {
            "appium:" + "no" + "Reset",
            "appium:" + "full" + "Reset",
        }
        self.assertFalse(legacy_reset_capabilities & set(capabilities))
        operations = [
            path.rsplit("/", 1)[-1]
            for _, path, _ in transport.requests
            if "/appium/device/" in path
        ]
        self.assertEqual(
            operations,
            [
                "remove_app",
                "app_installed",
                "install_app",
                "app_installed",
                "activate_app",
            ],
        )
        self.assertGreaterEqual(len(broker.calls), len(transport.requests))
        trace = session.fresh_install_trace
        self.assertTrue(trace["uninstall"]["priorInstallationAbsent"])
        self.assertTrue(trace["install"]["applicationPresent"])
        self.assertEqual(
            trace["artifactSha256"],
            "sha256:" + hashlib.sha256(b"attested-mobile").hexdigest(),
        )
        session.stop()
        self.assertEqual(
            transport.requests[-1],
            ("DELETE", "/session/session", None),
        )
        self.assertEqual(session.session_id, "")

    def test_runtime_identity_matches_app_web_rust_and_attestation(self) -> None:
        session, _, _, reader = self._session("android")
        session.start()
        install_ref = reader.add_json(
            "evidence/mobile/runtime/alice-android/install.json",
            session.fresh_install_trace,
        )

        identity = session.verify_installed_build_identity(install_ref)

        self.assertEqual(identity["buildId"], "build-android")
        self.assertEqual(identity["activeApplicationId"], APPLICATION_ID)
        self.assertEqual(identity["webEmbeddedIdentitySha256"], SHA256)
        self.assertEqual(identity["rustEmbeddedIdentitySha256"], SHA256)
        self.assertTrue(identity["allIdentitiesMatch"])

    def test_runtime_identity_mismatch_fails_closed(self) -> None:
        session, transport, _, reader = self._session()
        session.start()
        install_ref = reader.add_json(
            "evidence/mobile/runtime/alice-ios/install.json",
            session.fresh_install_trace,
        )
        transport.identity["buildId"] = "stale-build"

        with self.assertRaisesRegex(DriverError, "identities differ"):
            session.verify_installed_build_identity(install_ref)

    def test_stale_device_fence_blocks_before_appium_request(self) -> None:
        session, transport, _, _ = self._session(
            broker_failure=RuntimeError("stale fence"),
        )

        with self.assertRaisesRegex(RuntimeError, "stale fence"):
            session.start()

        self.assertEqual(transport.requests, [])

    def test_cross_run_source_refs_fail_before_appium_request(self) -> None:
        session, transport, _, _ = self._session()
        session.build_attestation_ref = ArtifactRef(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            run_id="20260830T120001000000Z-" + ("2" * 32),
            path=session.build_attestation_ref.path,
            sha256=session.build_attestation_ref.sha256,
            media_type=session.build_attestation_ref.media_type,
        )

        with self.assertRaises(DriverError):
            session.start()

        self.assertEqual(transport.requests, [])

    def test_android_requires_explicit_chromedriver(self) -> None:
        session, transport, _, _ = self._session("android")
        session.chromedriver_executable = ""

        with self.assertRaisesRegex(DriverError, "explicitly verified"):
            session.start()

        self.assertEqual(transport.requests, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
