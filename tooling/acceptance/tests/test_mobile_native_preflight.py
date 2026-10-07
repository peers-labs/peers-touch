#!/usr/bin/env python3
"""Mobile-native domain provisioning preflight tests."""

from __future__ import annotations

import base64
import dataclasses
import hashlib
import http.server
import inspect
import json
import os
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Mapping
from unittest.mock import patch

from tooling.acceptance.core import (
    ArtifactRef,
    BlockedError,
    DriverError,
    EphemeralLaunchContextState,
    EnvironmentContract,
    EvidenceStore,
    ProvisioningError,
    ProvisioningState,
    new_manifest,
)
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR
from tooling.acceptance.core.bounded_http import HttpResponseCancelled
from tooling.acceptance.provisioners.mobile_native import (
    EXPECTED_APPIUM_VERSION,
    EXPECTED_CLIENTS,
    EXPECTED_DRIVER_IDENTITIES,
    MAX_APPIUM_ERROR_RESPONSE_BYTES,
    MAX_APPIUM_RESPONSE_BYTES,
    MAX_MOBILE_PAGE_SOURCE_RESPONSE_BYTES,
    MAX_MOBILE_SCREENSHOT_RESPONSE_BYTES,
    MAX_MOBILE_SCREENSHOT_BYTES,
    MOBILE_NATIVE_BLOCKED_SCENARIO_DEPENDENCIES,
    MOBILE_NATIVE_CAPABILITIES,
    MOBILE_OAUTH_PROOF_GATE_ID,
    MOBILE_NATIVE_PRODUCT_APPIUM_OPERATIONS,
    MOBILE_NATIVE_PRODUCT_CLEANUP_RESOURCES,
    MOBILE_NATIVE_PRODUCT_HARNESS_ACTIONS,
    MOBILE_NATIVE_PRODUCT_SCENARIOS,
    MOBILE_NATIVE_SCENARIO_GATES,
    CommandResult,
    MobileNativeAppiumCapabilityHandler,
    MobileNativeProvisioner,
    MobileNativeProviderAuthorizationHandler,
    MobileNativeSourceArtifactRefs,
    MobileNativeSourceProjection,
    MobileNativeStationFixtureCapabilityHandler,
    _ParentAppiumSession,
    _ParentAppiumTransport,
    _appium_server_version,
    _mobile_native_manifest_resources,
    _with_mobile_resources,
    build_mobile_native_source_projection,
    load_mobile_native_preflight_spec,
    preflight_mobile_native_inputs,
    require_mobile_native_credentials,
)
from tooling.acceptance.provisioners.mobile_service_bindings import (
    resolve_mobile_service_bindings,
)
from tooling.acceptance.fixtures.mobile_resource_lease import (
    BaselineRestoreResult,
    BrowserBaselineVerificationResult,
    CLIENT_PLATFORM,
    CLIENT_PROVIDER,
    MobileResourceLeaseDeadlineExceeded,
    PROVIDER_CLIENTS,
)
from tooling.acceptance.gates.mobile.native_e2e import CAPABILITY_OPERATIONS


SOURCE_RUN_ID = "20260829T120000000000Z-" + ("1" * 32)
PROVISIONING_RUN_ID = "20260829T120000000000Z-" + ("2" * 32)
SOURCE_SHA256 = "sha256:" + ("a" * 64)
SOURCE_HEARTBEAT_AT = "2999-08-29T12:00:00Z"
SOURCE_RENEW_BEFORE = "2999-08-29T12:05:00Z"
SOURCE_EXPIRES_AT = "2999-08-29T12:10:00Z"
BUILD_PACKAGE_BYTES = {
    "ios": b"ios-application-package",
    "android": b"android-application-package",
}


class ParentAppiumTransportTests(unittest.TestCase):
    class Response:
        def __init__(
            self,
            body: bytes,
            *,
            bytes_per_read: int | None = None,
            delay_seconds: float = 0,
        ) -> None:
            self.body = body
            self.bytes_per_read = bytes_per_read
            self.delay_seconds = delay_seconds
            self.offset = 0
            self.read_sizes: list[int] = []
            self.timeouts: list[float] = []
            self.closed = False

        def __enter__(self) -> "ParentAppiumTransportTests.Response":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def close(self) -> None:
            self.closed = True

        def settimeout(self, timeout_seconds: float) -> None:
            self.timeouts.append(timeout_seconds)

        def read1(self, size: int = -1) -> bytes:
            self.read_sizes.append(size)
            if self.delay_seconds:
                time.sleep(self.delay_seconds)
            if self.offset >= len(self.body):
                return b""
            actual_size = (
                len(self.body) - self.offset
                if size < 0
                else size
            )
            if self.bytes_per_read is not None:
                actual_size = min(actual_size, self.bytes_per_read)
            chunk = self.body[self.offset : self.offset + actual_size]
            self.offset += len(chunk)
            return chunk

    def test_response_at_configured_byte_limit_is_accepted(self) -> None:
        limit = 64
        body = b'{"value":"ok"}'
        response = self.Response(body + (b" " * (limit - len(body))))
        transport = _ParentAppiumTransport("http://appium.invalid")

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "urllib.request.urlopen",
            return_value=response,
        ):
            value = transport.request(
                "GET",
                "/session/test/screenshot",
                max_response_bytes=limit,
            )

        self.assertEqual(value, "ok")
        self.assertEqual(response.read_sizes, [limit + 1, 1])
        self.assertTrue(response.timeouts)

    def test_response_over_configured_byte_limit_is_rejected(self) -> None:
        limit = 64
        response = self.Response(b"x" * (limit + 1))
        transport = _ParentAppiumTransport("http://appium.invalid")

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "urllib.request.urlopen",
            return_value=response,
        ), self.assertRaisesRegex(
            DriverError,
            "exceeds the configured byte limit",
        ):
            transport.request(
                "GET",
                "/session/test/screenshot",
                max_response_bytes=limit,
            )

        self.assertEqual(response.read_sizes, [limit + 1])

    def test_ordinary_response_uses_mandatory_default_bound(self) -> None:
        response = self.Response(b"x" * (MAX_APPIUM_RESPONSE_BYTES + 1))
        transport = _ParentAppiumTransport("http://appium.invalid")

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "urllib.request.urlopen",
            return_value=response,
        ), self.assertRaisesRegex(
            DriverError,
            "exceeds the configured byte limit",
        ):
            transport.request("GET", "/session/test/contexts")

        self.assertNotIn(-1, response.read_sizes)

    def test_trickle_response_obeys_total_deadline(self) -> None:
        response = self.Response(
            b'{"value":"ok"}',
            bytes_per_read=1,
            delay_seconds=0.02,
        )
        transport = _ParentAppiumTransport(
            "http://appium.invalid",
            timeout_seconds=0.03,
        )
        started = time.monotonic()

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "urllib.request.urlopen",
            return_value=response,
        ), self.assertRaisesRegex(
            DriverError,
            "HttpResponseDeadlineExceeded",
        ):
            transport.request("GET", "/session/test/contexts")

        self.assertLess(time.monotonic() - started, 0.15)

    def test_capability_deadline_overrides_transport_default(self) -> None:
        response = self.Response(
            b'{"value":"ok"}',
            bytes_per_read=1,
            delay_seconds=0.02,
        )
        transport = _ParentAppiumTransport(
            "http://appium.invalid",
            timeout_seconds=60,
        )
        started = time.monotonic()

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "urllib.request.urlopen",
            return_value=response,
        ), self.assertRaisesRegex(
            DriverError,
            "HttpResponseDeadlineExceeded",
        ):
            transport.request(
                "GET",
                "/session/test/contexts",
                deadline_monotonic=started + 0.03,
            )

        self.assertLess(time.monotonic() - started, 0.15)

    def test_expired_capability_deadline_blocks_before_dispatch(self) -> None:
        transport = _ParentAppiumTransport("http://appium.invalid")

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "urllib.request.urlopen",
        ) as urlopen, self.assertRaisesRegex(
            DriverError,
            "HttpResponseDeadlineExceeded",
        ):
            transport.request(
                "GET",
                "/session/test/contexts",
                deadline_monotonic=time.monotonic() - 1,
            )

        urlopen.assert_not_called()

    def test_connect_and_header_timeouts_map_to_typed_deadline(self) -> None:
        failures = (
            ("connect-timeout", TimeoutError("connect timed out")),
            ("header-timeout", socket.timeout("header timed out")),
            (
                "url-error-timeout",
                urllib.error.URLError(TimeoutError("connect timed out")),
            ),
        )

        for scenario, failure in failures:
            with self.subTest(scenario=scenario), patch(
                "tooling.acceptance.provisioners.mobile_native."
                "urllib.request.urlopen",
                side_effect=failure,
            ), self.assertRaisesRegex(
                TimeoutError,
                "HttpResponseDeadlineExceeded",
            ) as observed:
                _ParentAppiumTransport(
                    "http://appium.invalid"
                ).request("GET", "/status")

            self.assertIsInstance(observed.exception, DriverError)
            self.assertIs(observed.exception.__cause__, failure)

    def test_http_body_cancellation_maps_to_typed_timeout(self) -> None:
        cancellation = threading.Event()

        class CancellingResponse(self.Response):
            def read1(self, size: int = -1) -> bytes:
                cancellation.set()
                raise socket.timeout("body read timed out")

        response = CancellingResponse(b'{"value":"never-read"}')
        transport = _ParentAppiumTransport("http://appium.invalid")

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "urllib.request.urlopen",
            return_value=response,
        ), self.assertRaisesRegex(
            TimeoutError,
            "HttpResponseCancelled",
        ) as observed:
            transport.request(
                "GET",
                "/session/test/contexts",
                cancellation=cancellation,
            )

        self.assertIsInstance(observed.exception, DriverError)
        self.assertIsInstance(
            observed.exception.__cause__,
            HttpResponseCancelled,
        )

    def test_real_urllib_trickle_is_interrupted_by_total_deadline(
        self,
    ) -> None:
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                body = b'{"value":"ok"}'
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    for byte in body:
                        self.wfile.write(bytes((byte,)))
                        self.wfile.flush()
                        time.sleep(0.02)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, *_args: object) -> None:
                return None

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.daemon_threads = True
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        transport = _ParentAppiumTransport(
            f"http://127.0.0.1:{server.server_port}",
            timeout_seconds=0.05,
        )
        started = time.monotonic()
        try:
            with self.assertRaisesRegex(
                DriverError,
                "HttpResponseDeadlineExceeded",
            ):
                transport.request("GET", "/session/test/contexts")
            elapsed = time.monotonic() - started
        finally:
            server.shutdown()
            worker.join(1)
            server.server_close()

        self.assertLess(elapsed, 0.3)

    def test_http_error_body_is_bounded(self) -> None:
        response = self.Response(
            b"x" * (MAX_APPIUM_ERROR_RESPONSE_BYTES + 1)
        )
        error = urllib.error.HTTPError(
            "http://appium.invalid/session/test",
            500,
            "server error",
            {},
            response,
        )
        transport = _ParentAppiumTransport("http://appium.invalid")

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "urllib.request.urlopen",
            side_effect=error,
        ), self.assertRaisesRegex(DriverError, "HTTP 500"):
            transport.request("GET", "/session/test")

        self.assertNotIn(-1, response.read_sizes)
        self.assertTrue(response.closed)

    def test_appium_status_closes_http_error_response(self) -> None:
        response = self.Response(b'{"value":{"error":"unavailable"}}')
        error = urllib.error.HTTPError(
            "http://appium.invalid/status",
            503,
            "server unavailable",
            {},
            response,
        )

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "urllib.request.urlopen",
            side_effect=error,
        ), self.assertRaisesRegex(BlockedError, "HTTP 503"):
            _appium_server_version("http://appium.invalid", "/status")

        self.assertTrue(response.closed)

    def test_page_source_uses_its_explicit_response_bound(self) -> None:
        limits: list[int] = []

        class Transport:
            @staticmethod
            def request(
                _method: str,
                _path: str,
                _payload: Any = None,
                *,
                max_response_bytes: int,
            ) -> str:
                limits.append(max_response_bytes)
                return "<AppiumAUT />"

        session = object.__new__(_ParentAppiumSession)
        session.transport = Transport()
        session.device_broker = SimpleNamespace(
            with_physical_device=lambda _lease, callback, **_kwargs: callback(
                object()
            )
        )
        session._device_lease = object()
        session.session_id = "test"

        self.assertEqual(session.get_page_source(), "<AppiumAUT />")
        self.assertEqual(limits, [MAX_MOBILE_PAGE_SOURCE_RESPONSE_BYTES])

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "MAX_MOBILE_PAGE_SOURCE_BYTES",
            8,
        ), self.assertRaisesRegex(
            DriverError,
            "page source exceeds",
        ):
            session.get_page_source()

    def test_real_screenshot_path_bounds_transport_and_decodes(self) -> None:
        screenshot = b"\x89PNG" + (b"x" * (32 * 1024))
        encoded = base64.b64encode(screenshot).decode("ascii")
        response = self.Response(
            json.dumps({"value": encoded}).encode("utf-8")
        )
        transport = _ParentAppiumTransport("http://appium.invalid")
        session = object.__new__(_ParentAppiumSession)
        session.transport = transport
        session.device_broker = SimpleNamespace(
            with_physical_device=lambda _lease, callback: callback(object())
        )
        session._device_lease = object()
        session.session_id = "test"

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "urllib.request.urlopen",
            return_value=response,
        ):
            self.assertEqual(session.screenshot_bytes(), screenshot)

        self.assertLessEqual(
            max(response.read_sizes),
            MAX_MOBILE_SCREENSHOT_RESPONSE_BYTES + 1,
        )

    def test_screenshot_encoding_is_rejected_before_decode(self) -> None:
        class Transport:
            @staticmethod
            def request(
                _method: str,
                _path: str,
                _payload: Any = None,
                *,
                max_response_bytes: int,
            ) -> str:
                self.assertEqual(
                    max_response_bytes,
                    MAX_MOBILE_SCREENSHOT_RESPONSE_BYTES,
                )
                return "AAAAA"

        session = object.__new__(_ParentAppiumSession)
        session.transport = Transport()
        session.device_broker = SimpleNamespace(
            with_physical_device=lambda _lease, callback, **_kwargs: callback(
                object()
            )
        )
        session._device_lease = object()
        session.session_id = "test"

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "MAX_MOBILE_SCREENSHOT_BASE64_BYTES",
            4,
        ), self.assertRaisesRegex(
            DriverError,
            "encoding exceeds",
        ):
            session.screenshot_bytes()

    def test_session_reuses_capability_deadline_across_fresh_install(
        self,
    ) -> None:
        deadline = time.monotonic() + 5
        observed_deadlines: list[float | None] = []
        installed_results = iter((False, True))

        class Transport:
            @staticmethod
            def request(
                _method: str,
                path: str,
                _payload: Any = None,
                *,
                max_response_bytes: int,
                deadline_monotonic: float,
            ) -> object:
                del max_response_bytes
                observed_deadlines.append(deadline_monotonic)
                if path.endswith("/app_installed"):
                    return next(installed_results)
                return {}

        session = object.__new__(_ParentAppiumSession)
        session.transport = Transport()
        session.device_broker = SimpleNamespace(
            with_physical_device=lambda _lease, callback, **_kwargs: callback(
                object()
            )
        )
        session._device_lease = object()
        session.session_id = "test"
        session.client_id = "alice-ios"
        session.platform = "ios"
        session._application_id = "com.peers.touch.mobile"
        session._build_attestation = {
            "runId": SOURCE_RUN_ID,
            "artifact": {"sha256": SOURCE_SHA256},
        }
        session.physical_device_lease_ref = parent_artifact_ref(
            "runtime/mobile/leases/devices/alice-ios.json"
        )
        session.build_attestation_ref = parent_artifact_ref(
            "runtime/mobile/builds/ios.json"
        )

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "validate_contract_payload",
            side_effect=lambda value, **_kwargs: value,
        ):
            session._fresh_install(
                Path("/tmp/mobile-app"),
                deadline_monotonic=deadline,
            )

        self.assertEqual(len(observed_deadlines), 5)
        self.assertEqual(observed_deadlines, [deadline] * 5)

    def test_is_alive_does_not_swallow_typed_deadline(self) -> None:
        transport = _ParentAppiumTransport("http://appium.invalid")
        session = object.__new__(_ParentAppiumSession)
        session.transport = transport
        session.device_broker = SimpleNamespace(
            with_physical_device=lambda _lease, callback, **_kwargs: callback(
                object()
            )
        )
        session._device_lease = object()
        session.session_id = "test"

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "urllib.request.urlopen",
            side_effect=TimeoutError("deadline exhausted"),
        ), self.assertRaisesRegex(
            TimeoutError,
            "HttpResponseDeadlineExceeded",
        ) as observed:
            session.is_alive(
                deadline_monotonic=time.monotonic() + 5,
                cancellation=threading.Event(),
            )

        self.assertIsInstance(observed.exception, DriverError)

    def test_physical_lease_wait_propagates_cancellation_and_deadline(
        self,
    ) -> None:
        class Transport:
            @staticmethod
            def request(*_args: Any, **_kwargs: Any) -> object:
                raise AssertionError(
                    "transport ran without physical lease authority"
                )

        class Broker:
            @staticmethod
            def with_physical_device(
                _lease: object,
                _operation: Any,
                *,
                deadline_monotonic: float,
                cancellation: threading.Event,
            ) -> object:
                if cancellation.is_set():
                    raise MobileResourceLeaseDeadlineExceeded(
                        "resource operation was cancelled while waiting "
                        "for its lock"
                    )
                if time.monotonic() >= deadline_monotonic:
                    raise MobileResourceLeaseDeadlineExceeded(
                        "resource operation exceeded its lock deadline"
                    )
                raise AssertionError("test requires an exhausted lease budget")

        session = object.__new__(_ParentAppiumSession)
        session.transport = Transport()
        session.device_broker = Broker()
        session._device_lease = object()
        session.session_id = "test"
        cases = (
            (
                "cancellation",
                time.monotonic() + 5,
                True,
                "cancelled while waiting",
            ),
            (
                "deadline",
                time.monotonic() - 1,
                False,
                "exceeded its lock deadline",
            ),
        )

        for scenario, deadline, cancelled, message in cases:
            cancellation = threading.Event()
            if cancelled:
                cancellation.set()
            with self.subTest(scenario=scenario), self.assertRaisesRegex(
                MobileResourceLeaseDeadlineExceeded,
                message,
            ):
                session.is_alive(
                    deadline_monotonic=deadline,
                    cancellation=cancellation,
                )


def parent_artifact_ref(path: str) -> ArtifactRef:
    return ArtifactRef(
        workspace_id="a" * 16,
        gate_id=MOBILE_OAUTH_PROOF_GATE_ID,
        run_id=SOURCE_RUN_ID,
        path=path,
        sha256="b" * 64,
        media_type="application/json",
    )


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

    def test_messaging_harness_responses_fail_closed(self) -> None:
        valid_submission = {
            "conversationId": "conversation-1",
            "commandId": "command-1",
            "messageId": "message-1",
            "attachmentIds": [],
            "state": "pending",
        }
        invalid_values = (
            (
                "messaging.createDirect",
                {
                    "conversationId": "conversation-1",
                    "state": "failed",
                },
            ),
            (
                "messaging.createGroup",
                {
                    "conversationId": "group-1",
                    "state": "pending",
                },
            ),
            (
                "messaging.attachment.stage",
                {
                    "stageId": "stage-1",
                    "filename": "proof.txt",
                    "mimeType": "text/plain",
                    "plaintextSize": 4.0,
                    "completed": True,
                },
            ),
            (
                "messaging.attachment.open",
                {
                    "state": "ready",
                    "available": True,
                    "nextAttemptAtUnixMs": 10,
                },
            ),
            (
                "messaging.send",
                {
                    **valid_submission,
                    "state": "draft",
                },
            ),
            (
                "messaging.interact",
                {
                    **valid_submission,
                    "attachmentIds": ["attachment-1"],
                },
            ),
            (
                "messaging.read",
                {
                    "conversationId": "conversation-1",
                    "lastReadSequence": True,
                    "submitted": True,
                },
            ),
            (
                "messaging.typing",
                {
                    "conversationId": "conversation-1",
                    "isTyping": "true",
                    "submitted": True,
                },
            ),
            (
                "messaging.reconcile",
                {
                    "deviceEnrolled": True,
                    "processed": 0,
                    "cursor": 4,
                    "laneHead": 4,
                    "consumerEpoch": 2,
                    "deliveryReceiptSubmitted": False,
                    "commandState": "retry_scheduled",
                    "commandId": "command-1",
                },
            ),
            (
                "messaging.command.read",
                {
                    "commandId": "command-1",
                    "conversationId": "conversation-1",
                    "state": "unknown",
                    "lastErrorCode": "",
                },
            ),
            (
                "messaging.search",
                [
                    {
                        "messageId": "message-1",
                        "senderPtid": "ptid:alice",
                        "state": "delivered",
                        "timestampUnixMs": 10,
                        "retracted": False,
                        "reactions": [],
                        "readByPtids": [],
                        "plaintext": "hello",
                        "attachments": [],
                        "storageRef": "must-not-cross",
                    }
                ],
            ),
            (
                "messaging.projection.read",
                {
                    "runtime": {
                        "active": True,
                        "stationOrigin": "https://station.example",
                        "deviceEnrolled": True,
                        "laneSequence": 0,
                        "consumerEpoch": 0,
                        "conversationCount": 0,
                        "activationGeneration": 1,
                        "workerPhase": "running",
                    },
                    "conversations": [],
                    "messages": {},
                },
            ),
            (
                "social.projection.read",
                {
                    "active": True,
                    "activeSessionUlid": "conversation-1",
                    "friendRequests": [],
                    "typingPeers": {
                        "conversation-1": {
                            "bob": {
                                "typing": True,
                                "lastUpdate": 12,
                            }
                        }
                    },
                    "peerOnline": {"ptid:bob": True},
                    "lastReconcileAt": 13,
                },
            ),
        )

        class Session:
            def __init__(self, value: object) -> None:
                self.value = value

            def call_action(
                self,
                _action: str,
                _payload: dict[str, Any],
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> object:
                del deadline_monotonic, cancellation
                return self.value

        for action, value in invalid_values:
            with self.subTest(action=action):
                session = Session(value)
                handler = MobileNativeAppiumCapabilityHandler(
                    session_factory=lambda _client_id: session,
                    artifact_writer=object(),
                    broker=object(),
                    device_leases={},
                    harness_actions=(action,),
                )
                handler._sessions["alice-ios"] = session
                handler._session_refs["alice-ios"] = "opaque-session"
                with self.assertRaises(BlockedError):
                    handler.invoke(
                        "harness_action",
                        {
                            "clientId": "alice-ios",
                            "sessionRef": "opaque-session",
                            "action": action,
                            "actionPayload": {},
                        },
                        deadline_monotonic=float("inf"),
                        cancellation=threading.Event(),
                    )

    def test_provision_activates_e25_parent_authorities(self) -> None:
        source = inspect.getsource(MobileNativeProvisioner.provision)

        self.assertIn("_prepare_parent_authorities", source)


class MobileNativeParentIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_authority = patch(
            "tooling.acceptance.provisioners.mobile_native."
            "require_station_reset_authority",
            return_value={"validation": "current"},
        )
        reset_authority.start()
        self.addCleanup(reset_authority.stop)
        self.events: list[str] = []
        self.provisioner = MobileNativeProvisioner(
            EnvironmentContract(id="mobile-native")
        )
        self.provisioner._manifest = dataclasses.replace(
            new_manifest(
                environment_id="mobile-native",
                gate_id=MOBILE_OAUTH_PROOF_GATE_ID,
                requested_profile="mobile",
                resolved_profile="mobile",
                slot=7,
                commit="1" * 40,
                worktree="/tmp/worktree",
                workspace_digest="clean",
            ),
            run_id=PROVISIONING_RUN_ID,
        )
        self.provisioner._native_spec = SimpleNamespace(
            clients=(),
            callback_schemes={"ios": "peers-touch", "android": "peers-touch"},
            harness_namespace="__PEERS_MOBILE_ACCEPTANCE__",
            harness_actions=("oauth.start", "oauth.status"),
            parent_harness_actions=(
                "build.identity",
                "oauth.replayHandle",
                "oauth.negativeCallback",
            ),
        )
        self.provisioner._native_inputs = {
            "physicalDevices": {
                client_id: object() for client_id in EXPECTED_CLIENTS
            },
            "leaseAuthenticationKey": bytearray(b"l" * 32),
        }

    def _projection(self) -> MobileNativeSourceProjection:
        return MobileNativeSourceProjection(
            applications={
                platform: {
                    "buildAttestation": parent_artifact_ref(
                        f"runtime/mobile/builds/{platform}.json"
                    )
                }
                for platform in EXPECTED_DRIVER_IDENTITIES
            },
            provider_account_leases={
                provider: parent_artifact_ref(
                    f"runtime/mobile/leases/accounts/{provider}.json"
                )
                for provider in PROVIDER_CLIENTS
            },
            clients={
                client_id: {
                    "physicalDeviceLease": parent_artifact_ref(
                        f"runtime/mobile/leases/devices/{client_id}.json"
                    ),
                    "browserSessionLease": parent_artifact_ref(
                        f"runtime/mobile/leases/browsers/{client_id}.json"
                    ),
                }
                for client_id in EXPECTED_CLIENTS
            },
        )

    def _prepare_with_fakes(
        self,
        *,
        fail_on_resource: str = "",
        heartbeat_failed: bool = False,
    ) -> tuple[Any, Any, Any]:
        events = self.events

        class ArtifactSession:
            gate_id = MOBILE_OAUTH_PROOF_GATE_ID
            run_id = SOURCE_RUN_ID

            def close(self) -> None:
                events.append("artifact.close")

        class Fixture:
            def __init__(self) -> None:
                self.lease_refs: dict[str, ArtifactRef] = {}
                self.quarantined: dict[str, str] = {}

            def bootstrap(self) -> None:
                events.append("fixture.bootstrap")

            def acquire(self, service_id: str) -> dict[str, Any]:
                events.append(f"fixture.acquire:{service_id}")
                self.lease_refs[service_id] = parent_artifact_ref(
                    f"runtime/mobile/fixtures/{service_id}/lease.json"
                )
                return {
                    "resourceKey": f"station/{service_id}/mobile-oauth-fixture",
                    "holderRunId": SOURCE_RUN_ID,
                    "runId": SOURCE_RUN_ID,
                    "fenceToken": 1,
                }

            def heartbeat(self, service_id: str) -> None:
                events.append(f"fixture.heartbeat:{service_id}")

            def cleanup(
                self,
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> tuple[str, ...]:
                if deadline_monotonic is None or cancellation is None:
                    raise AssertionError("cleanup budget was not propagated")
                events.append("fixture.cleanup")
                return tuple(reversed(tuple(self.lease_refs)))

            def _quarantine(self, service_id: str, reason: str) -> None:
                events.append(f"fixture.quarantine:{service_id}:{reason}")
                self.quarantined[service_id] = reason

            def close(self) -> None:
                events.append("fixture.close")

        class Broker:
            run_id = SOURCE_RUN_ID

            def _lease(self, resource_key: str) -> dict[str, Any]:
                if resource_key == fail_on_resource:
                    raise RuntimeError("primary acquisition failure")
                events.append(f"lease.acquire:{resource_key}")
                return {
                    "resourceKey": resource_key,
                    "holderRunId": SOURCE_RUN_ID,
                    "runId": SOURCE_RUN_ID,
                    "fenceToken": 1,
                }

            def acquire_physical_device(self, client_id: str) -> dict[str, Any]:
                return self._lease(f"physical-device/{client_id}")

            def acquire_provider_account(self, provider: str) -> dict[str, Any]:
                return self._lease(f"provider-account/{provider}/disposable")

            def provider_identity_assertion(
                self,
                lease: dict[str, Any],
                *,
                observed_subject: str,
            ) -> dict[str, Any]:
                del observed_subject
                events.append(f"identity:{lease['resourceKey']}")
                return {"provider": lease["resourceKey"].split("/")[1],
                        "identityMatched": True}

            def acquire_browser_session(
                self,
                client_id: str,
                **_kwargs: Any,
            ) -> dict[str, Any]:
                return self._lease(
                    f"physical-device/{client_id}/browser/default"
                )

            def acquisition_reference(
                self,
                lease: dict[str, Any],
            ) -> ArtifactRef:
                resource_key = lease["resourceKey"]
                if resource_key.startswith("provider-account/"):
                    provider = resource_key.split("/")[1]
                    path = f"runtime/mobile/leases/accounts/{provider}.json"
                elif resource_key.endswith("/browser/default"):
                    client_id = resource_key.split("/")[1]
                    path = f"runtime/mobile/leases/browsers/{client_id}.json"
                else:
                    client_id = resource_key.split("/")[1]
                    path = f"runtime/mobile/leases/devices/{client_id}.json"
                return parent_artifact_ref(path)

            def release(
                self,
                lease: dict[str, Any],
                *,
                restore: Any,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
                **_kwargs: Any,
            ) -> dict[str, Any]:
                self.assert_cleanup_budget(
                    deadline_monotonic,
                    cancellation,
                )
                restore()
                events.append(f"lease.release:{lease['resourceKey']}")
                return {"finalState": "RELEASED"}

            def quarantine(
                self,
                lease: dict[str, Any],
                _failure_code: str,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
                **_kwargs: Any,
            ) -> dict[str, Any]:
                self.assert_cleanup_budget(
                    deadline_monotonic,
                    cancellation,
                )
                events.append(f"lease.quarantine:{lease['resourceKey']}")
                return {"finalState": "QUARANTINED"}

            @staticmethod
            def assert_cleanup_budget(
                deadline_monotonic: float | None,
                cancellation: threading.Event | None,
            ) -> None:
                if deadline_monotonic is None or cancellation is None:
                    raise AssertionError("cleanup budget was not propagated")

            def close(self) -> dict[str, bool]:
                events.append("broker.close")
                return {
                    "correlationChannelClosed": True,
                    "correlationKeyZeroized": True,
                    "physicalIdentityKeyZeroized": True,
                    "leaseLedgerStateLockDescriptorClosed": True,
                    "leaseLedgerOperationLockDescriptorsClosed": True,
                    "leaseLedgerOperationsDescriptorClosed": True,
                    "leaseLedgerGenerationsDescriptorClosed": True,
                    "leaseLedgerRootDescriptorClosed": True,
                    "leaseLedgerAuthenticationKeyZeroized": True,
                    "leaseLedgerClosed": True,
                    "resourceLeaseBrokerClosed": True,
                }

        class Heartbeat:
            failed = heartbeat_failed

            def register(self, lease: dict[str, Any]) -> None:
                events.append(f"heartbeat.register:{lease['resourceKey']}")

            def register_external(
                self,
                lease: dict[str, Any],
                heartbeat: Any,
            ) -> None:
                del heartbeat
                events.append(f"heartbeat.register:{lease['resourceKey']}")

            def start(self) -> None:
                events.append("heartbeat.start")

            def unregister(self, lease: dict[str, Any]) -> None:
                events.append(f"heartbeat.unregister:{lease['resourceKey']}")

            def close(self) -> None:
                events.append("heartbeat.close")

            def raise_if_failed(self) -> None:
                events.append("heartbeat.health")
                if self.failed:
                    raise RuntimeError("heartbeat scheduler failed")

        artifact_session = ArtifactSession()
        fixture = Fixture()
        broker = Broker()
        heartbeat = Heartbeat()
        baselines = {
            client_id: BrowserBaselineVerificationResult(
                expected_identity_matched=True,
                authorization_in_progress=False,
                mobile_oauth_state_absent=True,
                station_run_state_absent=True,
            )
            for client_id in EXPECTED_CLIENTS
        }
        credentials = {
            f"{provider}-disposable-account": "{}"
            for provider in PROVIDER_CLIENTS
        }
        subjects = {provider: f"{provider}-subject" for provider in PROVIDER_CLIENTS}
        self.provisioner._evidence_run = artifact_session

        with ExitStack() as stack:
            stack.enter_context(
                patch(
                    "tooling.acceptance.provisioners.mobile_native."
                    "EvidenceStore.from_environment",
                    return_value=SimpleNamespace(workspace_id="a" * 16),
                )
            )
            stack.enter_context(
                patch(
                    "tooling.acceptance.provisioners.mobile_native."
                    "orchestrate_source_bound_build",
                    side_effect=lambda **kwargs: events.append(
                        f"build:{kwargs['platform']}"
                    )
                    or kwargs["platform"],
                )
            )
            stack.enter_context(
                patch(
                    "tooling.acceptance.provisioners.mobile_native."
                    "produce_build_attestation",
                    side_effect=lambda run, receipt, created_at: (
                        {},
                        parent_artifact_ref(
                            f"runtime/mobile/builds/{receipt}.json"
                        ),
                    ),
                )
            )
            stack.enter_context(
                patch(
                    "tooling.acceptance.provisioners.mobile_native."
                    "MobileOAuthStationFixture.from_environment",
                    return_value=fixture,
                )
            )
            stack.enter_context(
                patch(
                    "tooling.acceptance.provisioners.mobile_native."
                    "MobileResourceLeaseBroker",
                    return_value=broker,
                )
            )
            stack.enter_context(
                patch(
                    "tooling.acceptance.provisioners.mobile_native."
                    "MobileResourceLeaseHeartbeatOwner",
                    return_value=heartbeat,
                )
            )
            stack.enter_context(
                patch.object(
                    self.provisioner,
                    "_prepare_actor_manifest",
                    side_effect=lambda: events.append("actor.prepare")
                    or parent_artifact_ref(
                        "runtime/mobile-actor-manifest.json"
                    ).to_dict(),
                )
            )
            stack.enter_context(
                patch.object(
                    self.provisioner,
                    "_credential_authorities",
                    return_value=(subjects, baselines),
                )
            )
            stack.enter_context(
                patch(
                    "tooling.acceptance.provisioners.mobile_native."
                    "build_mobile_native_source_projection",
                    return_value=self._projection(),
                )
            )
            self.provisioner._prepare_parent_authorities(
                gate_id=MOBILE_OAUTH_PROOF_GATE_ID,
                runtime_root=Path("/tmp/mobile-native-parent-test"),
                credential_values=credentials,
            )
        return fixture, broker, heartbeat

    def test_parent_acquires_build_fixture_and_twelve_leases_then_heartbeats(
        self,
    ) -> None:
        self._prepare_with_fakes()

        self.assertNotIn(
            "leaseAuthenticationKey",
            self.provisioner._native_inputs,
        )
        self.assertEqual(
            [event for event in self.events if event.startswith("build:")],
            ["build:ios", "build:android"],
        )
        self.assertEqual(
            [event for event in self.events if event.startswith("fixture.acquire:")],
            [
                "fixture.acquire:station-primary",
                "fixture.acquire:station-secondary",
            ],
        )
        acquisitions = [
            event for event in self.events if event.startswith("lease.acquire:")
        ]
        self.assertEqual(len(acquisitions), 10)
        self.assertEqual(
            len(acquisitions)
            + len(
                [
                    event
                    for event in self.events
                    if event.startswith("fixture.acquire:")
                ]
            ),
            12,
        )
        registrations = [
            event
            for event in self.events
            if event.startswith("heartbeat.register:")
        ]
        self.assertEqual(
            registrations,
            [
                event.replace("lease.acquire:", "heartbeat.register:")
                for event in acquisitions
            ]
            + [
                "heartbeat.register:station/station-primary/mobile-oauth-fixture",
                "heartbeat.register:station/station-secondary/mobile-oauth-fixture",
            ],
        )
        self.assertEqual(self.events.count("heartbeat.start"), 1)

    def test_manifest_projects_only_artifact_refs_for_parent_authorities(
        self,
    ) -> None:
        projection = self._projection()
        fixture_refs = {
            service_id: parent_artifact_ref(
                f"runtime/mobile/fixtures/{service_id}/lease.json"
            )
            for service_id in ("station-primary", "station-secondary")
        }

        resources = _mobile_native_manifest_resources(
            projection,
            fixture_refs,
            self.provisioner._native_spec,
            evidence_run_id=SOURCE_RUN_ID,
            provisioning_run_id=PROVISIONING_RUN_ID,
        )

        self.assertEqual(
            resources["runIdentities"],
            {
                "evidenceRunId": SOURCE_RUN_ID,
                "provisioningRunId": PROVISIONING_RUN_ID,
            },
        )
        authority_refs = []
        source = resources["sourceArtifacts"]
        authority_refs.extend(
            value["buildAttestation"]
            for value in source["applications"].values()
        )
        authority_refs.extend(source["providerAccountLeases"].values())
        authority_refs.extend(
            value[key]
            for value in source["clients"].values()
            for key in ("physicalDeviceLease", "browserSessionLease")
        )
        authority_refs.extend(resources["oauthFixtureLeases"].values())
        self.assertEqual(len(authority_refs), 14)
        self.assertTrue(
            all(
                reference == ArtifactRef.from_dict(reference).to_dict()
                for reference in authority_refs
            )
        )
        serialized = json.dumps(resources, sort_keys=True)
        for forbidden in (
            "resourceKey",
            "holderRunId",
            "fenceToken",
            "physicalDeviceRef",
            "providerSubject",
        ):
            self.assertNotIn(forbidden, serialized)
        with self.assertRaisesRegex(BlockedError, "must remain distinct"):
            _mobile_native_manifest_resources(
                projection,
                fixture_refs,
                self.provisioner._native_spec,
                evidence_run_id=SOURCE_RUN_ID,
                provisioning_run_id=SOURCE_RUN_ID,
            )
        foreign_fixture_refs = dict(fixture_refs)
        foreign_fixture_refs["station-primary"] = dataclasses.replace(
            fixture_refs["station-primary"],
            run_id=PROVISIONING_RUN_ID,
        )
        with self.assertRaisesRegex(
            BlockedError,
            "ArtifactRefs must use the evidence run identity",
        ):
            _mobile_native_manifest_resources(
                projection,
                foreign_fixture_refs,
                self.provisioner._native_spec,
                evidence_run_id=SOURCE_RUN_ID,
                provisioning_run_id=PROVISIONING_RUN_ID,
            )

    def test_context_factory_registers_exact_handlers_and_checks_identities(
        self,
    ) -> None:
        self.provisioner._artifact_session = SimpleNamespace(run_id=SOURCE_RUN_ID)
        self.provisioner._artifact_store = object()
        self.provisioner._source_projection = self._projection()
        self.provisioner._station_fixture = object()
        self.provisioner._lease_broker = object()
        self.provisioner._heartbeat_owner = SimpleNamespace(
            raise_if_failed=lambda: None
        )
        self.provisioner._manifest = _with_mobile_resources(
            self.provisioner._manifest,
            {
                "runIdentities": {
                    "evidenceRunId": SOURCE_RUN_ID,
                    "provisioningRunId": PROVISIONING_RUN_ID,
                }
            },
        )

        context = self.provisioner.create_gate_launch_context(
            gate_id=MOBILE_OAUTH_PROOF_GATE_ID,
            evidence_run_id=SOURCE_RUN_ID,
            provisioning_run_id=PROVISIONING_RUN_ID,
            required_capabilities=tuple(MOBILE_NATIVE_CAPABILITIES),
        )

        self.assertEqual(context.state, EphemeralLaunchContextState.CREATED)
        self.assertEqual(tuple(context._handlers), tuple(CAPABILITY_OPERATIONS))
        self.assertIsInstance(
            context._handlers["mobile.native.appium-session"],
            MobileNativeAppiumCapabilityHandler,
        )
        self.assertIsInstance(
            context._handlers["mobile.native.provider-authorization"],
            MobileNativeProviderAuthorizationHandler,
        )
        self.assertIsInstance(
            context._handlers["mobile.native.station-fixture"],
            MobileNativeStationFixtureCapabilityHandler,
        )
        self.assertEqual(
            {
                capability: handler.allowed_operations
                for capability, handler in context._handlers.items()
            },
            CAPABILITY_OPERATIONS,
        )
        context.seal(
            workspace_id="a" * 16,
            gate_id=MOBILE_OAUTH_PROOF_GATE_ID,
            evidence_run_id=SOURCE_RUN_ID,
            provisioning_run_id=PROVISIONING_RUN_ID,
        )
        self.assertEqual(context.state, EphemeralLaunchContextState.SEALED)
        self.assertEqual(
            context._identity,
            {
                "workspaceId": "a" * 16,
                "gateId": MOBILE_OAUTH_PROOF_GATE_ID,
                "evidenceRunId": SOURCE_RUN_ID,
                "provisioningRunId": PROVISIONING_RUN_ID,
            },
        )
        with self.assertRaisesRegex(BlockedError, "run identity projection"):
            self.provisioner.create_gate_launch_context(
                gate_id=MOBILE_OAUTH_PROOF_GATE_ID,
                evidence_run_id="wrong-run",
                provisioning_run_id=PROVISIONING_RUN_ID,
                required_capabilities=tuple(MOBILE_NATIVE_CAPABILITIES),
            )
        with self.assertRaisesRegex(BlockedError, "run identity projection"):
            self.provisioner.create_gate_launch_context(
                gate_id=MOBILE_OAUTH_PROOF_GATE_ID,
                evidence_run_id=SOURCE_RUN_ID,
                provisioning_run_id="wrong-provisioning-run",
                required_capabilities=tuple(MOBILE_NATIVE_CAPABILITIES),
            )

    def test_context_rejects_conflated_evidence_and_provisioning_runs(self) -> None:
        self.provisioner._artifact_session = SimpleNamespace(run_id=SOURCE_RUN_ID)
        self.provisioner._artifact_store = object()
        self.provisioner._source_projection = self._projection()
        self.provisioner._station_fixture = object()
        self.provisioner._lease_broker = object()
        self.provisioner._heartbeat_owner = SimpleNamespace(
            raise_if_failed=lambda: None
        )
        self.provisioner._manifest = _with_mobile_resources(
            dataclasses.replace(
                self.provisioner._manifest,
                run_id=SOURCE_RUN_ID,
            ),
            {
                "runIdentities": {
                    "evidenceRunId": SOURCE_RUN_ID,
                    "provisioningRunId": SOURCE_RUN_ID,
                }
            },
        )

        with self.assertRaisesRegex(BlockedError, "run identity projection"):
            self.provisioner.create_gate_launch_context(
                gate_id=MOBILE_OAUTH_PROOF_GATE_ID,
                evidence_run_id=SOURCE_RUN_ID,
                provisioning_run_id=SOURCE_RUN_ID,
                required_capabilities=tuple(MOBILE_NATIVE_CAPABILITIES),
            )

    def test_capability_quarantine_fences_every_exposed_lease(self) -> None:
        events: list[str] = []

        class Broker:
            def quarantine(
                self,
                lease: dict[str, Any],
                reason: str,
                **_kwargs: Any,
            ) -> dict[str, str]:
                events.append(f"quarantine:{lease['resourceKey']}:{reason}")
                return {"finalState": "QUARANTINED"}

        class Session:
            def stop(self, **_kwargs: Any) -> None:
                events.append("session.stop")

        class Fixture:
            def __init__(self) -> None:
                self.quarantined: dict[str, str] = {}

            def _quarantine(self, service_id: str, reason: str) -> None:
                events.append(f"fixture.quarantine:{service_id}:{reason}")
                self.quarantined[service_id] = reason

            def close(self) -> None:
                events.append("fixture.close")

        broker = Broker()
        device_leases = {
            client_id: {"resourceKey": f"device/{client_id}"}
            for client_id in EXPECTED_CLIENTS
        }
        browser_leases = {
            client_id: {"resourceKey": f"browser/{client_id}"}
            for client_id in EXPECTED_CLIENTS
        }
        account_leases = {
            provider: {"resourceKey": f"account/{provider}"}
            for provider in PROVIDER_CLIENTS
        }
        appium = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: Session(),
            artifact_writer=object(),
            broker=broker,
            device_leases=device_leases,
        )
        appium._sessions["alice-ios"] = Session()
        provider = MobileNativeProviderAuthorizationHandler(
            broker=broker,
            account_leases=account_leases,
            browser_leases=browser_leases,
            credential_values={
                provider_id: '{"credential":"secret"}'
                for provider_id in PROVIDER_CLIENTS
            },
            appium_handler=appium,
        )
        fixture = MobileNativeStationFixtureCapabilityHandler(Fixture())

        deadline = float("inf")
        self.assertTrue(
            appium.quarantine("channel-failure", deadline_monotonic=deadline)
        )
        self.assertTrue(
            provider.quarantine("channel-failure", deadline_monotonic=deadline)
        )
        self.assertTrue(
            fixture.quarantine("channel-failure", deadline_monotonic=deadline)
        )

        quarantined = [
            event.split(":", 2)[1]
            for event in events
            if event.startswith("quarantine:")
        ]
        self.assertEqual(
            quarantined,
            [
                *reversed([lease["resourceKey"] for lease in device_leases.values()]),
                *reversed([lease["resourceKey"] for lease in browser_leases.values()]),
                *reversed([lease["resourceKey"] for lease in account_leases.values()]),
            ],
        )
        self.assertEqual(
            [
                event
                for event in events
                if event.startswith("fixture.quarantine:")
            ],
            [
                "fixture.quarantine:station-secondary:channel-failure",
                "fixture.quarantine:station-primary:channel-failure",
            ],
        )
        self.assertLess(
            events.index("session.stop"),
            events.index("quarantine:device/bob-android:"
                         "EPHEMERAL_CAPABILITY_QUARANTINED"),
        )

    def test_appium_capability_exposes_only_closed_mobile_operations(
        self,
    ) -> None:
        handler = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: object(),
            artifact_writer=object(),
            broker=object(),
            device_leases={},
            harness_actions=("oauth.start",),
            parent_harness_actions=(
                "build.identity",
                "oauth.replayHandle",
                "oauth.negativeCallback",
            ),
        )

        for forbidden in (
            "execute_script",
            "execute_async_script",
            "element_attribute",
            "page_source",
            "current_url",
            "screenshot",
        ):
            self.assertNotIn(forbidden, handler.allowed_operations)
        with self.assertRaisesRegex(ValueError, "field is forbidden"):
            handler.project_response(
                "harness_action",
                {
                    "requestId": "request-a",
                    "status": "OK",
                    "result": {
                        "clientId": "alice-ios",
                        "value": {"accessToken": "secret-value"},
                    },
                    "error": None,
                },
            )
        with self.assertRaisesRegex(ValueError, "closed operation schema"):
            handler.project_response(
                "is_alive",
                {
                    "requestId": "request-b",
                    "status": "OK",
                    "result": {
                        "clientId": "alice-ios",
                        "alive": True,
                        "raw": "unexpected",
                    },
                    "error": None,
                },
            )

    def test_appium_handler_forwards_the_exact_capability_deadline(
        self,
    ) -> None:
        observed_deadlines: list[float | None] = []

        class Session:
            @staticmethod
            def contexts(
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> list[str]:
                del cancellation
                observed_deadlines.append(deadline_monotonic)
                return ["NATIVE_APP"]

        handler = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: Session(),
            artifact_writer=object(),
            broker=object(),
            device_leases={},
        )
        handler._sessions["alice-ios"] = Session()
        handler._session_refs["alice-ios"] = "opaque-session"
        deadline = time.monotonic() + 5

        result = handler.invoke(
            "contexts",
            {
                "clientId": "alice-ios",
                "sessionRef": "opaque-session",
            },
            deadline_monotonic=deadline,
            cancellation=threading.Event(),
        )

        self.assertEqual(result["contexts"], ["NATIVE_APP"])
        self.assertEqual(observed_deadlines, [deadline])

    def test_parent_only_harness_actions_reject_generic_dispatch(self) -> None:
        class Session:
            @staticmethod
            def call_action(_action: str, _payload: dict[str, Any]) -> object:
                raise AssertionError("parent-only action reached generic dispatch")

        handler = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: Session(),
            artifact_writer=object(),
            broker=object(),
            device_leases={},
            harness_actions=("oauth.negativeCallback",),
            parent_harness_actions=("oauth.negativeCallback",),
        )
        handler._sessions["alice-ios"] = Session()
        handler._session_refs["alice-ios"] = "opaque-session"

        with self.assertRaisesRegex(BlockedError, "not allowlisted"):
            handler.invoke(
                "harness_action",
                {
                    "clientId": "alice-ios",
                    "sessionRef": "opaque-session",
                    "action": "oauth.negativeCallback",
                    "actionPayload": {},
                },
                deadline_monotonic=float("inf"),
                cancellation=threading.Event(),
            )

    def test_appium_page_source_is_persisted_parent_side(self) -> None:
        writes: list[tuple[str, bytes, str, str | None]] = []

        class Session:
            @staticmethod
            def get_page_source(
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> str:
                del deadline_monotonic, cancellation
                return "<AppiumAUT />"

        class Writer:
            @staticmethod
            def write_bytes(
                path: str,
                value: bytes,
                *,
                media_type: str,
                role: str | None = None,
            ) -> ArtifactRef:
                writes.append((path, value, media_type, role))
                return dataclasses.replace(
                    parent_artifact_ref(path),
                    media_type=media_type,
                )

        handler = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: Session(),
            artifact_writer=Writer(),
            broker=object(),
            device_leases={},
        )
        handler._sessions["alice-ios"] = Session()
        handler._session_refs["alice-ios"] = "opaque-session"

        result = handler.invoke(
            "capture_page_source",
            {
                "clientId": "alice-ios",
                "sessionRef": "opaque-session",
                "captureKind": "web-dom",
                "captureId": "success-ios-github",
            },
            deadline_monotonic=float("inf"),
            cancellation=threading.Event(),
        )

        self.assertNotIn("source", result)
        reference = ArtifactRef.from_dict(result["pageSource"])
        self.assertEqual(reference.media_type, "text/html")
        self.assertEqual(
            writes,
            [
                (
                    "evidence/mobile/success-ios-github/"
                    "alice-ios/web-dom.html",
                    b"<AppiumAUT />",
                    "text/html",
                    None,
                )
            ],
        )

        class UnsafeSession:
            @staticmethod
            def get_page_source(
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> str:
                del deadline_monotonic, cancellation
                return '<div data-access-token="must-not-persist"></div>'

        unsafe_handler = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: UnsafeSession(),
            artifact_writer=Writer(),
            broker=object(),
            device_leases={},
        )
        unsafe_handler._sessions["alice-ios"] = UnsafeSession()
        unsafe_handler._session_refs["alice-ios"] = "opaque-session"
        with self.assertRaisesRegex(ValueError, "forbidden material"):
            unsafe_handler.invoke(
                "capture_page_source",
                {
                    "clientId": "alice-ios",
                    "sessionRef": "opaque-session",
                    "captureKind": "web-dom",
                    "captureId": "success-ios-github",
                },
                deadline_monotonic=float("inf"),
                cancellation=threading.Event(),
            )
        self.assertEqual(len(writes), 1)

    def test_harness_action_results_use_closed_recursive_schemas(self) -> None:
        decision = {
            "state": "awaiting_input",
            "attemptId": "attempt-a",
            "currentGateId": "oauth",
            "gates": [{"gateId": "oauth", "type": "oauth", "state": "open"}],
        }
        session = {
            "stationPeerId": "station-a",
            "actorPtid": "ptid:alice",
        }
        oauth = {
            "phase": "awaiting_provider",
            "provider": "github",
            "candidatePtid": None,
            "accessDecision": decision,
            "session": None,
            "errorKey": None,
            "recovery": "check-status",
        }
        messaging_message = {
            "eventId": "event-1",
            "eventSequence": 4,
            "messageId": "message-1",
            "senderPtid": "ptid:alice",
            "state": "delivered",
            "timestampUnixMs": 10,
            "retracted": False,
            "reactions": [
                {
                    "actorPtid": "ptid:bob",
                    "reaction": "ack",
                    "createdAtUnixMs": 11,
                }
            ],
            "readByPtids": ["ptid:bob"],
            "plaintext": "acceptance-message",
            "attachments": [
                {
                    "attachmentId": "attachment-1",
                    "filename": "proof.txt",
                    "mimeType": "text/plain",
                    "plaintextSize": 4,
                    "ciphertextSize": 20,
                    "availabilityState": "local",
                }
            ],
        }
        messaging_projection = {
            "runtime": {
                "active": True,
                "profileId": "profile-1",
                "stationPeerId": "station-a",
                "actorPtid": "ptid:alice",
                "deviceId": "device-1",
                "deviceEnrolled": True,
                "laneSequence": 8,
                "consumerEpoch": 2,
                "conversationCount": 1,
                "activationGeneration": 3,
                "workerPhase": "running",
            },
            "conversations": [
                {
                    "conversationId": "conversation-1",
                    "authorityStationId": "station-a",
                    "kind": 1,
                    "name": "",
                    "ownerPtid": "ptid:alice",
                    "memberPtids": ["ptid:alice", "ptid:bob"],
                    "membershipEpoch": 1,
                    "mlsEpoch": 0,
                    "active": True,
                    "updatedAtUnixMs": 10,
                }
            ],
            "messages": {"conversation-1": [messaging_message]},
        }
        station = {
            "activeStationPeerId": "station-a",
            "verifiedStationPeerId": "station-a",
            "canonicalOrigin": "https://station.example",
            "entries": [
                {
                    "stationPeerId": "station-a",
                    "url": "https://station.example",
                    "label": "station-a",
                    "online": True,
                    "lastCheckedAt": 1,
                }
            ],
        }
        values = {
            "station.add": station,
            "station.replace": station,
            "access.submit": {"decision": decision, "session": session},
            "oauth.start": oauth,
            "oauth.status": oauth,
            "oauth.cancel": oauth,
            "lifecycle.restart": {"requested": True, "scope": "webview"},
            "projection.read": {
                "station": {
                    "activeStationPeerId": "station-a",
                    "entries": station["entries"],
                },
                "access": {
                    "decision": decision,
                    "session": session,
                    "loading": False,
                    "errorKey": None,
                    "restored": True,
                },
                "oauth": oauth,
            },
            "messaging.createDirect": {
                "conversationId": "conversation-1",
                "state": "projected",
            },
            "social.contact.open": {
                "conversationId": "contact-conversation-1",
            },
            "messaging.createGroup": {
                "conversationId": "group-1",
                "commandId": "command-group-1",
                "state": "pending",
            },
            "messaging.attachment.stage": {
                "stageId": "stage-1",
                "filename": "proof.txt",
                "mimeType": "text/plain",
                "plaintextSize": 4,
                "completed": True,
            },
            "messaging.attachment.open": {
                "state": "ready",
                "available": True,
            },
            "messaging.send": {
                "conversationId": "conversation-1",
                "commandId": "command-1",
                "messageId": "message-1",
                "attachmentIds": [],
                "state": "pending",
            },
            "messaging.interact": {
                "conversationId": "conversation-1",
                "commandId": "command-2",
                "messageId": "message-1",
                "attachmentIds": [],
                "state": "pending",
            },
            "messaging.read": {
                "conversationId": "conversation-1",
                "lastReadSequence": 4,
                "submitted": True,
            },
            "messaging.typing": {
                "conversationId": "conversation-1",
                "isTyping": True,
                "submitted": True,
            },
            "messaging.reconcile": {
                "deviceEnrolled": True,
                "processed": 0,
                "cursor": 4,
                "laneHead": 4,
                "consumerEpoch": 2,
                "deliveryReceiptSubmitted": False,
                "commandState": "idle",
            },
            "messaging.command.read": {
                "commandId": "command-1",
                "conversationId": "conversation-1",
                "state": "committed",
                "lastErrorCode": "",
            },
            "messaging.search": [messaging_message],
            "messaging.projection.read": messaging_projection,
            "social.request.send": {
                "active": True,
                "activeSessionUlid": "conversation-1",
                "friendRequests": [
                    {
                        "requestId": "request-1",
                        "senderPtid": "ptid:alice",
                        "receiverPtid": "ptid:bob",
                        "status": 1,
                    }
                ],
                "typingPeers": {
                    "conversation-1": {
                        "ptid:bob": {
                            "typing": True,
                            "lastUpdate": 12,
                        }
                    }
                },
                "peerOnline": {"ptid:bob": True},
                "lastReconcileAt": 13,
            },
            "cleanup": {
                "oauthPurge": {
                    "stationRevocation": "confirmed",
                    "secureStorage": {
                        "activeAttemptIndexAbsent": True,
                        "attemptSecretRecordAbsent": True,
                        "currentSessionIndexAbsent": True,
                        "credentialRecordAbsent": True,
                        "publicProjectionAbsent": True,
                    },
                },
                "webSessionProjectionCleared": True,
                "stationRegistryCleared": True,
            },
        }
        values["social.request.accept"] = values["social.request.send"]
        values["social.reconcile"] = values["social.request.send"]
        values["social.projection.read"] = values["social.request.send"]

        class Session:
            def call_action(
                self,
                action: str,
                _payload: dict[str, Any],
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> object:
                del deadline_monotonic, cancellation
                return values[action]

        handler = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: Session(),
            artifact_writer=object(),
            broker=object(),
            device_leases={},
            harness_actions=tuple(values),
        )
        handler._sessions["alice-ios"] = Session()
        handler._session_refs["alice-ios"] = "opaque-session"
        for action in values:
            result = handler.invoke(
                "harness_action",
                {
                    "clientId": "alice-ios",
                    "sessionRef": "opaque-session",
                    "action": action,
                    "actionPayload": {},
                },
                deadline_monotonic=float("inf"),
                cancellation=threading.Event(),
            )
            self.assertEqual(result["value"], values[action])

        for invalid in (
            {},
            {"conversationId": ""},
            {"conversationId": "contact-conversation-1", "accessToken": "forbidden"},
        ):
            with self.subTest(contact_result=invalid):
                values["social.contact.open"] = invalid
                with self.assertRaises(BlockedError):
                    handler.invoke(
                        "harness_action",
                        {
                            "clientId": "alice-ios",
                            "sessionRef": "opaque-session",
                            "action": "social.contact.open",
                            "actionPayload": {},
                        },
                        deadline_monotonic=float("inf"),
                        cancellation=threading.Event(),
                    )

        values["projection.read"]["oauth"]["unexpected"] = True
        with self.assertRaisesRegex(
            BlockedError,
            "invalid field set",
        ):
            handler.invoke(
                "harness_action",
                {
                    "clientId": "alice-ios",
                    "sessionRef": "opaque-session",
                    "action": "projection.read",
                    "actionPayload": {},
                },
                deadline_monotonic=float("inf"),
                cancellation=threading.Event(),
            )

    def test_appium_parent_capture_uses_bound_run_after_environment_restore(
        self,
    ) -> None:
        class Session:
            @staticmethod
            def get_page_source(
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> str:
                del deadline_monotonic, cancellation
                return "<AppiumAUT />"

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run(MOBILE_OAUTH_PROOF_GATE_ID, source={})
            handler = MobileNativeAppiumCapabilityHandler(
                session_factory=lambda _client_id: Session(),
                artifact_writer=run,
                broker=object(),
                device_leases={},
            )
            handler._sessions["alice-ios"] = Session()
            handler._session_refs["alice-ios"] = "opaque-session"

            with patch.dict(os.environ, {}, clear=True):
                result = handler.invoke(
                    "capture_page_source",
                    {
                        "clientId": "alice-ios",
                        "sessionRef": "opaque-session",
                        "captureKind": "web-dom",
                        "captureId": "success-ios-github",
                    },
                    deadline_monotonic=float("inf"),
                    cancellation=threading.Event(),
                )

            reference = ArtifactRef.from_dict(result["pageSource"])
            self.assertEqual(reference.workspace_id, store.workspace_id)
            self.assertEqual(reference.run_id, run.run_id)
            self.assertEqual(
                store.resolve(reference).read_bytes(),
                b"<AppiumAUT />",
            )
            run.close()

    def test_appium_parent_accepts_realistic_screenshot_and_bounds_oversize(
        self,
    ) -> None:
        screenshot = b"\x89PNG" + (b"x" * (32 * 1024))
        writes: list[bytes] = []

        class Session:
            @staticmethod
            def screenshot_bytes(
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> bytes:
                del deadline_monotonic, cancellation
                return screenshot

        class Writer:
            @staticmethod
            def write_bytes(
                path: str,
                value: bytes,
                *,
                media_type: str,
                role: str | None = None,
            ) -> ArtifactRef:
                del role
                writes.append(value)
                return dataclasses.replace(
                    parent_artifact_ref(path),
                    media_type=media_type,
                )

        handler = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: Session(),
            artifact_writer=Writer(),
            broker=object(),
            device_leases={},
        )
        handler._sessions["alice-ios"] = Session()
        handler._session_refs["alice-ios"] = "opaque-session"

        result = handler.invoke(
            "capture_screenshot",
            {
                "clientId": "alice-ios",
                "sessionRef": "opaque-session",
                "captureId": "success-ios-github",
            },
            deadline_monotonic=float("inf"),
            cancellation=threading.Event(),
        )

        self.assertEqual(writes, [screenshot])
        self.assertEqual(
            ArtifactRef.from_dict(result["screenshot"]).media_type,
            "image/png",
        )
        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "MAX_MOBILE_SCREENSHOT_BYTES",
            len(screenshot) - 1,
        ), self.assertRaisesRegex(
            BlockedError,
            "screenshot exceeds",
        ):
            handler.invoke(
                "capture_screenshot",
                {
                    "clientId": "alice-ios",
                    "sessionRef": "opaque-session",
                    "captureId": "oversize-ios-github",
                },
                deadline_monotonic=float("inf"),
                cancellation=threading.Event(),
            )
        self.assertEqual(MAX_MOBILE_SCREENSHOT_BYTES, 64 * 1024 * 1024)

    def test_replay_handle_never_crosses_the_capability_channel(self) -> None:
        calls: list[tuple[str, dict[str, Any]]] = []

        class Session:
            build_attestation_ref = parent_artifact_ref(
                "runtime/mobile/builds/ios.json"
            )

            @staticmethod
            def call_action(
                action: str,
                payload: dict[str, Any],
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> dict[str, Any]:
                del deadline_monotonic, cancellation
                calls.append((action, dict(payload)))
                if action == "oauth.replayHandle":
                    return {"callbackReplayHandle": "parent-only-handle"}
                return {
                    "operation": "replay",
                    "failure": "oauthReplay",
                    "projection": {
                        "phase": "failed",
                        "accessDecision": None,
                        "sessionPresent": False,
                    },
                }

        handler = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: Session(),
            artifact_writer=object(),
            broker=object(),
            device_leases={},
            harness_actions=(),
            parent_harness_actions=(
                "build.identity",
                "oauth.replayHandle",
                "oauth.negativeCallback",
            ),
            sensitive_values=("parent-only-handle",),
        )
        handler._sessions["alice-ios"] = Session()
        handler._session_refs["alice-ios"] = "opaque-session"

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "validate_contract_payload",
            side_effect=lambda value, **_kwargs: value,
        ):
            result = handler.invoke(
                "harness_negative_callback",
                {
                    "clientId": "alice-ios",
                    "sessionRef": "opaque-session",
                    "replayPayload": {"runId": SOURCE_RUN_ID},
                    "negativePayload": {
                        "intent": {
                            "artifactKind": (
                                "mobile-oauth-negative-callback-intent"
                            ),
                            "operation": "replay",
                            "expectedFailure": "oauthReplay",
                            "callbackReplayHandle": (
                                "parent-owned-replay-handle"
                            ),
                        }
                    },
                },
                deadline_monotonic=float("inf"),
                cancellation=threading.Event(),
            )

        self.assertNotIn("parent-only-handle", repr(result))
        self.assertEqual(
            calls[1][1]["intent"]["callbackReplayHandle"],
            "parent-only-handle",
        )
        self.assertEqual(
            [action for action, _payload in calls],
            ["oauth.replayHandle", "oauth.negativeCallback"],
        )

    def test_non_replay_negative_callback_remains_parent_only(self) -> None:
        calls: list[str] = []

        class Session:
            build_attestation_ref = parent_artifact_ref(
                "runtime/mobile/builds/ios.json"
            )

            @staticmethod
            def call_action(
                action: str,
                _payload: dict[str, Any],
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> dict[str, Any]:
                del deadline_monotonic, cancellation
                calls.append(action)
                return {
                    "operation": "provider_mismatch",
                    "failure": "oauthProviderMismatch",
                    "projection": {
                        "phase": "failed",
                        "accessDecision": None,
                        "sessionPresent": False,
                    },
                }

        handler = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: Session(),
            artifact_writer=object(),
            broker=object(),
            device_leases={},
            parent_harness_actions=(
                "build.identity",
                "oauth.replayHandle",
                "oauth.negativeCallback",
            ),
        )
        handler._sessions["alice-ios"] = Session()
        handler._session_refs["alice-ios"] = "opaque-session"

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "validate_contract_payload",
            side_effect=lambda value, **_kwargs: value,
        ):
            result = handler.invoke(
                "harness_negative_callback",
                {
                    "clientId": "alice-ios",
                    "sessionRef": "opaque-session",
                    "negativePayload": {
                        "intent": {
                            "artifactKind": (
                                "mobile-oauth-negative-callback-intent"
                            ),
                            "operation": "provider_mismatch",
                            "expectedFailure": "oauthProviderMismatch",
                        }
                    },
                },
                deadline_monotonic=float("inf"),
                cancellation=threading.Event(),
            )

        self.assertEqual(calls, ["oauth.negativeCallback"])
        self.assertEqual(result["value"]["failure"], "oauthProviderMismatch")

    def test_replay_handle_response_rejects_extra_fields(self) -> None:
        class Session:
            build_attestation_ref = parent_artifact_ref(
                "runtime/mobile/builds/ios.json"
            )

            @staticmethod
            def call_action(
                _action: str,
                _payload: dict[str, Any],
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> dict[str, Any]:
                del deadline_monotonic, cancellation
                return {
                    "callbackReplayHandle": "parent-only-handle",
                    "unexpected": True,
                }

        handler = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: Session(),
            artifact_writer=object(),
            broker=object(),
            device_leases={},
            parent_harness_actions=(
                "build.identity",
                "oauth.replayHandle",
                "oauth.negativeCallback",
            ),
        )
        handler._sessions["alice-ios"] = Session()
        handler._session_refs["alice-ios"] = "opaque-session"

        with self.assertRaisesRegex(BlockedError, "replay handle response"):
            handler.invoke(
                "harness_negative_callback",
                {
                    "clientId": "alice-ios",
                    "sessionRef": "opaque-session",
                    "replayPayload": {"runId": SOURCE_RUN_ID},
                    "negativePayload": {
                        "intent": {
                            "operation": "replay",
                        }
                    },
                },
                deadline_monotonic=float("inf"),
                cancellation=threading.Event(),
            )

    def test_capability_quarantine_attempts_all_leases_and_fails_closed(
        self,
    ) -> None:
        attempted: list[str] = []

        class Broker:
            def quarantine(
                self,
                lease: dict[str, Any],
                _reason: str,
                **_kwargs: Any,
            ) -> dict[str, str]:
                resource_key = lease["resourceKey"]
                attempted.append(resource_key)
                return {
                    "finalState": (
                        "RELEASED"
                        if resource_key == "browser/alice-android"
                        else "QUARANTINED"
                    )
                }

        browser_leases = {
            client_id: {"resourceKey": f"browser/{client_id}"}
            for client_id in EXPECTED_CLIENTS
        }
        account_leases = {
            provider: {"resourceKey": f"account/{provider}"}
            for provider in PROVIDER_CLIENTS
        }
        handler = MobileNativeProviderAuthorizationHandler(
            broker=Broker(),
            account_leases=account_leases,
            browser_leases=browser_leases,
            credential_values={
                provider: '{"credential":"secret"}'
                for provider in PROVIDER_CLIENTS
            },
            appium_handler=SimpleNamespace(sessions={}),
        )

        self.assertFalse(
            handler.quarantine(
                "channel-failure",
                deadline_monotonic=float("inf"),
            )
        )
        self.assertEqual(
            attempted,
            [
                *reversed([lease["resourceKey"] for lease in browser_leases.values()]),
                *reversed([lease["resourceKey"] for lease in account_leases.values()]),
            ],
        )

    def test_provider_authorization_reuses_the_capability_deadline(
        self,
    ) -> None:
        observed_deadlines: list[float | None] = []

        class Session:
            @staticmethod
            def switch_to_native(
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> None:
                del cancellation
                observed_deadlines.append(deadline_monotonic)

            @staticmethod
            def find_element(
                _using: str,
                _selector: str,
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> str:
                del cancellation
                observed_deadlines.append(deadline_monotonic)
                return "element-a"

            @staticmethod
            def click(
                _element_ref: str,
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> None:
                del cancellation
                observed_deadlines.append(deadline_monotonic)

            @staticmethod
            def switch_to_app_webview(
                _timeout: float,
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> str:
                del cancellation
                observed_deadlines.append(deadline_monotonic)
                return "WEBVIEW_app"

        class Broker:
            @staticmethod
            def authorize_provider(
                _lease: Mapping[str, Any],
                *,
                client_id: str,
                operation: Any,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> None:
                del deadline_monotonic, cancellation
                self.assertEqual(client_id, "alice-ios")
                operation()

        handler = MobileNativeProviderAuthorizationHandler(
            broker=Broker(),
            account_leases={"github": {"resourceKey": "account/github"}},
            browser_leases={},
            credential_values={
                "github": json.dumps(
                    {
                        "provider": "github",
                        "steps": [
                            {
                                "action": "click",
                                "using": "accessibility id",
                                "selector": "Authorize",
                            }
                        ],
                    }
                )
            },
            appium_handler=SimpleNamespace(
                sessions={"alice-ios": Session()}
            ),
        )
        deadline = time.monotonic() + 5

        result = handler.invoke(
            "authorize",
            {"clientId": "alice-ios", "provider": "github"},
            deadline_monotonic=deadline,
            cancellation=threading.Event(),
        )

        self.assertTrue(result["authorized"])
        self.assertEqual(observed_deadlines, [deadline] * 4)

    def test_appium_start_rolls_back_session_on_install_evidence_failure(
        self,
    ) -> None:
        events: list[str] = []
        primary = RuntimeError("install evidence persistence failed")

        class Session:
            physical_device_lease_ref = parent_artifact_ref(
                "runtime/mobile/leases/devices/alice-ios.json"
            )
            build_attestation_ref = parent_artifact_ref(
                "runtime/mobile/builds/ios.json"
            )
            fresh_install_trace = {"artifactKind": "mobile-fresh-install-trace"}
            _application_id = "com.peers.touch.mobile"

            def start(
                self,
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> None:
                del deadline_monotonic, cancellation
                events.append("session.start")

            def stop(
                self,
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> None:
                del deadline_monotonic, cancellation
                events.append("session.stop")

        class Writer:
            def write_json(self, *_args: Any, **_kwargs: Any) -> ArtifactRef:
                events.append("evidence.write")
                raise primary

        handler = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: Session(),
            artifact_writer=Writer(),
            broker=SimpleNamespace(quarantine=lambda *_args: None),
            device_leases={},
        )
        with self.assertRaises(RuntimeError) as observed:
            handler.invoke(
                "start",
                {
                    "clientId": "alice-ios",
                    "physicalDeviceLease": (
                        Session.physical_device_lease_ref.to_dict()
                    ),
                    "buildAttestation": Session.build_attestation_ref.to_dict(),
                },
                deadline_monotonic=float("inf"),
                cancellation=threading.Event(),
            )

        self.assertIs(observed.exception, primary)
        self.assertEqual(
            events,
            ["session.start", "evidence.write", "session.stop"],
        )
        self.assertEqual(handler.sessions, {})

    def test_failed_start_with_session_id_retains_cleanup_ownership(
        self,
    ) -> None:
        events: list[str] = []
        start_failure = TimeoutError("fresh install deadline exhausted")

        class Session:
            physical_device_lease_ref = parent_artifact_ref(
                "runtime/mobile/leases/devices/alice-ios.json"
            )
            build_attestation_ref = parent_artifact_ref(
                "runtime/mobile/builds/ios.json"
            )

            def __init__(self) -> None:
                self.session_id = ""

            def start(
                self,
                *,
                deadline_monotonic: float | None = None,
                cancellation: threading.Event | None = None,
            ) -> None:
                del deadline_monotonic, cancellation
                self.session_id = "server-created-session"
                events.append("session.start")
                raise start_failure

            def stop(self, **_kwargs: Any) -> None:
                events.append(f"session.stop:{self.session_id}")
                self.session_id = ""

        session = Session()
        handler = MobileNativeAppiumCapabilityHandler(
            session_factory=lambda _client_id: session,
            artifact_writer=object(),
            broker=object(),
            device_leases={},
        )

        with self.assertRaises(TimeoutError) as observed:
            handler.invoke(
                "start",
                {
                    "clientId": "alice-ios",
                    "physicalDeviceLease": (
                        Session.physical_device_lease_ref.to_dict()
                    ),
                    "buildAttestation": Session.build_attestation_ref.to_dict(),
                },
                deadline_monotonic=time.monotonic() + 5,
                cancellation=threading.Event(),
            )

        self.assertIs(observed.exception, start_failure)
        self.assertEqual(handler.sessions, {})
        self.assertEqual(events, ["session.start"])

        cleanup = handler.close()

        self.assertTrue(cleanup.closed)
        self.assertEqual(
            events,
            [
                "session.start",
                "session.stop:server-created-session",
            ],
        )

    def test_heartbeat_failure_blocks_context_and_quarantines_all_authorities(
        self,
    ) -> None:
        self._prepare_with_fakes(heartbeat_failed=True)
        self.provisioner._manifest = _with_mobile_resources(
            self.provisioner._manifest,
            {
                "runIdentities": {
                    "evidenceRunId": SOURCE_RUN_ID,
                    "provisioningRunId": PROVISIONING_RUN_ID,
                }
            },
        )
        self.events.clear()

        with self.assertRaisesRegex(BlockedError, "heartbeat owner failed"):
            self.provisioner.create_gate_launch_context(
                gate_id=MOBILE_OAUTH_PROOF_GATE_ID,
                evidence_run_id=SOURCE_RUN_ID,
                provisioning_run_id=PROVISIONING_RUN_ID,
                required_capabilities=tuple(MOBILE_NATIVE_CAPABILITIES),
            )

        acquisition_keys = [
            lease["resourceKey"] for lease in self.provisioner._resource_leases
        ]
        quarantined = [
            event.removeprefix("lease.quarantine:")
            for event in self.events
            if event.startswith("lease.quarantine:")
        ]
        self.assertEqual(
            quarantined,
            [
                *reversed(acquisition_keys[6:]),
                *reversed(acquisition_keys[4:6]),
                *reversed(acquisition_keys[:4]),
            ],
        )
        self.assertEqual(
            [
                event.split(":", 2)[1]
                for event in self.events
                if event.startswith("fixture.quarantine:")
            ],
            ["station-secondary", "station-primary"],
        )

    def test_heartbeat_failure_during_cleanup_quarantines_in_exact_order(
        self,
    ) -> None:
        _fixture, _broker, heartbeat = self._prepare_with_fakes()
        heartbeat.failed = True
        self.events.clear()
        self.provisioner._appium_handler = SimpleNamespace(
            _stop_all=lambda **_kwargs: self.events.append("appium.stop") or True
        )

        with self.assertRaisesRegex(
            ProvisioningError,
            "heartbeat owner",
        ):
            self.provisioner.cleanup()

        acquisition_keys = [
            lease["resourceKey"] for lease in self.provisioner._resource_leases
        ]
        quarantine_events = [
            event
            for event in self.events
            if event.startswith(("lease.quarantine:", "fixture.quarantine:"))
        ]
        self.assertEqual(
            quarantine_events,
            [
                *[
                    f"lease.quarantine:{resource_key}"
                    for resource_key in reversed(acquisition_keys[6:])
                ],
                "fixture.quarantine:station-secondary:"
                "LEASE_HEARTBEAT_OWNER_FAILED",
                "fixture.quarantine:station-primary:"
                "LEASE_HEARTBEAT_OWNER_FAILED",
                *[
                    f"lease.quarantine:{resource_key}"
                    for resource_key in reversed(acquisition_keys[4:6])
                ],
                *[
                    f"lease.quarantine:{resource_key}"
                    for resource_key in reversed(acquisition_keys[:4])
                ],
            ],
        )
        self.assertLess(
            self.events.index("appium.stop"),
            self.events.index(
                f"lease.quarantine:{acquisition_keys[-1]}"
            ),
        )
        self.assertLess(
            self.events.index(
                f"lease.quarantine:{acquisition_keys[6]}"
            ),
            self.events.index(
                "fixture.quarantine:station-secondary:"
                "LEASE_HEARTBEAT_OWNER_FAILED"
            ),
        )
        self.assertLess(
            self.events.index(
                "fixture.quarantine:station-primary:"
                "LEASE_HEARTBEAT_OWNER_FAILED"
            ),
            self.events.index(
                f"lease.quarantine:{acquisition_keys[5]}"
            ),
        )
        self.assertLess(
            self.events.index("heartbeat.close"),
            self.events.index("broker.close"),
        )
        self.assertNotIn("artifact.close", self.events)

    def test_station_handler_matches_latest_child_response_contract(self) -> None:
        calls: list[tuple[str, dict[str, Any]]] = []

        class Fixture:
            def execute(self, _service_id: str, **kwargs: Any) -> dict[str, Any]:
                calls.append(("execute", kwargs))
                return {
                    "journalState": "COMMITTED",
                    "preconditionMatched": True,
                    "affectedRows": 1,
                }

            def snapshot(
                self,
                _service_id: str,
                **kwargs: Any,
            ) -> ArtifactRef:
                calls.append(("snapshot", kwargs))
                return parent_artifact_ref(
                    "evidence/mobile/variant/station/station-primary.json"
                )

            def close(self) -> None:
                pass

        handler = MobileNativeStationFixtureCapabilityHandler(Fixture())
        common = {
            "operationId": "operation",
            "variantId": "variant",
            "clientId": "alice-ios",
            "serviceId": "station-primary",
            "target": {
                "serviceId": "station-primary",
                "oauthAttemptRef": "oauth-attempt",
                "accessAttemptRef": "access-attempt",
                "deviceAlias": "alice-ios",
                "lifecycleGeneration": 1,
            },
            "expectedProvider": "github",
        }

        mutation = handler.invoke(
            "prepare_following_gate",
            common,
            deadline_monotonic=float("inf"),
            cancellation=threading.Event(),
        )
        snapshot = handler.invoke(
            "read_proof_snapshot",
            {**common, "snapshotPhase": "post_action"},
            deadline_monotonic=float("inf"),
            cancellation=threading.Event(),
        )

        self.assertEqual(mutation, {"completed": True})
        self.assertEqual(
            snapshot,
            {
                "artifactRef": parent_artifact_ref(
                    "evidence/mobile/variant/station/station-primary.json"
                ).to_dict()
            },
        )
        self.assertEqual(
            calls[0][1]["oauth_state"],
            "OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER",
        )

    def test_cleanup_is_exact_reverse_and_heartbeat_closes(self) -> None:
        self._prepare_with_fakes()
        self.events.clear()
        for lease in self.provisioner._resource_leases:
            self.provisioner._restore_callbacks[lease["resourceKey"]] = (
                lambda _deadline, _cancellation: BaselineRestoreResult(
                    True,
                    True,
                    True,
                )
            )
        self.provisioner._appium_handler = SimpleNamespace(
            _stop_all=lambda **_kwargs: self.events.append("appium.stop") or True
        )

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "_write_fixture_outcomes",
            side_effect=lambda _fixture: self.events.append("fixture.outcomes"),
        ):
            completed = self.provisioner.cleanup()

        self.assertEqual(completed, ("mobile-native-parent-authorities",))
        acquisition_keys = [
            lease["resourceKey"] for lease in self.provisioner._resource_leases
        ]
        releases = [
            event.removeprefix("lease.release:")
            for event in self.events
            if event.startswith("lease.release:")
        ]
        self.assertEqual(
            releases,
            [
                *reversed(acquisition_keys[6:]),
                *reversed(acquisition_keys[4:6]),
                *reversed(acquisition_keys[:4]),
            ],
        )
        self.assertLess(
            self.events.index("appium.stop"),
            self.events.index(f"lease.release:{acquisition_keys[-1]}"),
        )
        self.assertLess(
            self.events.index(f"lease.release:{acquisition_keys[6]}"),
            self.events.index("fixture.cleanup"),
        )
        self.assertLess(
            self.events.index("fixture.outcomes"),
            self.events.index(f"lease.release:{acquisition_keys[5]}"),
        )
        unregisters = [
            event.removeprefix("heartbeat.unregister:")
            for event in self.events
            if event.startswith("heartbeat.unregister:")
        ]
        self.assertEqual(
            unregisters,
            [
                "station/station-secondary/mobile-oauth-fixture",
                "station/station-primary/mobile-oauth-fixture",
                *reversed(acquisition_keys),
            ],
        )
        self.assertLess(
            self.events.index("heartbeat.close"),
            self.events.index("broker.close"),
        )
        self.assertNotIn("artifact.close", self.events)

    def test_cleanup_closes_broker_after_cleanup_deadline_expires(self) -> None:
        self._prepare_with_fakes()
        self.events.clear()

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "_require_cleanup_budget",
            side_effect=TimeoutError("cleanup deadline exhausted"),
        ), self.assertRaises(ProvisioningError):
            self.provisioner.cleanup()

        self.assertIn("broker.close", self.events)

    def test_pre_authority_failure_zeroizes_pending_lease_key(self) -> None:
        pending_key = bytearray(b"p" * 32)
        manifest = self.provisioner._manifest
        assert manifest is not None

        with patch.object(
            self.provisioner,
            "_new_base_manifest",
            return_value=manifest,
        ), patch(
            "tooling.acceptance.provisioners.mobile_native."
            "load_mobile_native_preflight_spec",
            return_value=self.provisioner._native_spec,
        ), patch(
            "tooling.acceptance.provisioners.mobile_native."
            "preflight_mobile_native_inputs",
            return_value={"leaseAuthenticationKey": pending_key},
        ), patch.object(
            self.provisioner,
            "prepare_credentials",
            side_effect=BlockedError(
                reason="credential preflight failed",
                resource="credential-values",
            ),
        ):
            result = self.provisioner.provision(MOBILE_OAUTH_PROOF_GATE_ID)

        self.assertEqual(result.state, ProvisioningState.BLOCKED)
        self.assertFalse(any(pending_key))
        self.assertNotIn(
            "leaseAuthenticationKey",
            self.provisioner._native_inputs,
        )

    def test_non_access_provisioning_skips_access_credentials(self) -> None:
        gate_id = "mobile-native-lifecycle-e2e"
        spec = load_mobile_native_preflight_spec(gate_id=gate_id)
        manifest = self.provisioner._manifest
        assert manifest is not None

        with (
            patch.object(
                self.provisioner,
                "_new_base_manifest",
                return_value=manifest,
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_native."
                "load_mobile_native_preflight_spec",
                return_value=spec,
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_native."
                "preflight_mobile_native_inputs",
                return_value={},
            ) as preflight,
            patch.object(
                self.provisioner,
                "_provision_device_scenario",
                return_value=manifest,
            ) as provision_scenario,
            patch.object(self.provisioner, "prepare_credentials") as credentials,
            patch.object(self.provisioner, "_prepare_actor_manifest") as actor,
            patch.object(self.provisioner, "_prepare_parent_authorities") as oauth,
        ):
            result = self.provisioner.provision(gate_id)

        self.assertIs(result, manifest)
        self.assertEqual(
            preflight.call_args.kwargs["environment"][
                "VITE_ACCEPTANCE_HARNESS"
            ],
            "1",
        )
        provision_scenario.assert_called_once()
        credentials.assert_not_called()
        actor.assert_not_called()
        oauth.assert_not_called()

    def test_blocked_product_scenarios_stop_before_resource_preflight(
        self,
    ) -> None:
        base_manifest = self.provisioner._manifest
        assert base_manifest is not None

        for scenario, dependency in (
            MOBILE_NATIVE_BLOCKED_SCENARIO_DEPENDENCIES.items()
        ):
            with self.subTest(scenario=scenario):
                gate_id = MOBILE_NATIVE_SCENARIO_GATES[scenario]
                provisioner = MobileNativeProvisioner(
                    EnvironmentContract.from_yaml(
                        ENVIRONMENTS_DIR / "mobile-native.yaml"
                    )
                )
                manifest = dataclasses.replace(
                    base_manifest,
                    gate_id=gate_id,
                )
                with (
                    patch.object(
                        provisioner,
                        "_new_base_manifest",
                        return_value=manifest,
                    ),
                    patch(
                        "tooling.acceptance.provisioners.mobile_native."
                        "preflight_mobile_native_inputs",
                    ) as preflight,
                    patch.object(
                        provisioner,
                        "prepare_credentials",
                    ) as credentials,
                    patch.object(
                        provisioner,
                        "_provision_device_scenario",
                    ) as provision_scenario,
                ):
                    result = provisioner.provision(gate_id)

                self.assertEqual(result.state, ProvisioningState.BLOCKED)
                self.assertEqual(
                    result.blocked_resource,
                    f"mobile-product-dependency:{dependency.lower()}",
                )
                self.assertIn("BLOCKED/UNPROVEN", result.blocked_reason)
                preflight.assert_not_called()
                credentials.assert_not_called()
                provision_scenario.assert_not_called()

    def test_non_access_parent_authority_keeps_fenced_device_broker(self) -> None:
        source = inspect.getsource(
            MobileNativeProvisioner._prepare_scenario_parent_authorities
        )

        self.assertIn("MobileResourceLeaseBroker(", source)
        self.assertIn("acquire_physical_device", source)
        self.assertIn("MobileResourceLeaseHeartbeatOwner(", source)
        self.assertNotIn("_prepare_actor_manifest", source)
        self.assertNotIn("acquire_provider_account", source)
        self.assertNotIn("acquire_browser_session", source)

    def test_cleanup_propagates_one_budget_through_station_actor_reset(
        self,
    ) -> None:
        self._prepare_with_fakes()
        self.provisioner._service_bindings = {
            "station-primary": (
                "https://station-primary.example",
                "mobile-native-primary",
            )
        }
        for lease in self.provisioner._resource_leases:
            self.provisioner._restore_callbacks[lease["resourceKey"]] = (
                lambda _deadline, _cancellation: BaselineRestoreResult(
                    True,
                    True,
                    True,
                )
            )
        self.provisioner._appium_handler = SimpleNamespace(
            _stop_all=lambda **_kwargs: True
        )

        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "verify_reset_target"
        ) as verify_reset, patch(
            "tooling.acceptance.provisioners.mobile_native.reset_fixture"
        ) as reset, patch(
            "tooling.acceptance.provisioners.mobile_native."
            "_write_fixture_outcomes",
            return_value=(),
        ):
            self.provisioner.cleanup()

        verify_options = verify_reset.call_args.kwargs
        reset_options = reset.call_args.kwargs
        self.assertIsNotNone(verify_options["deadline_monotonic"])
        self.assertIs(
            verify_options["cancellation"],
            reset_options["cancellation"],
        )
        self.assertEqual(
            verify_options["deadline_monotonic"],
            reset_options["deadline_monotonic"],
        )

    def test_cleanup_preserves_runner_owned_evidence_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "worktree"
            worktree.mkdir()
            store = EvidenceStore(root / "evidence", worktree=worktree)
            run = store.begin_run(
                MOBILE_OAUTH_PROOF_GATE_ID,
                source={"commit": "1" * 40, "workspaceDigest": "clean"},
            )
            provisioner = MobileNativeProvisioner(
                EnvironmentContract(id="mobile-native")
            )
            try:
                provisioner.bind_evidence_run(run)
                provisioner._artifact_session = run
                provisioner._register_parent_cleanup()

                completed = provisioner.cleanup()
                reference = run.write_json(
                    "reports/runner-finalization.json",
                    {"status": "passed"},
                    role="runner-finalization",
                )

                self.assertEqual(
                    completed,
                    ("mobile-native-parent-authorities",),
                )
                self.assertEqual(run.state, "ACTIVE")
                self.assertEqual(
                    json.loads(
                        store.resolve(reference).read_text(encoding="utf-8")
                    ),
                    {"status": "passed"},
                )
            finally:
                run.close()

    def test_failure_after_acquisition_retains_primary_and_cleans_acquired(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "primary acquisition failure",
        ) as primary:
            self._prepare_with_fakes(
                fail_on_resource="physical-device/bob-ios/browser/default",
            )

        self.assertTrue(self.provisioner._cleanup_handlers)
        for lease in self.provisioner._resource_leases:
            self.provisioner._restore_callbacks[lease["resourceKey"]] = (
                lambda _deadline, _cancellation: BaselineRestoreResult(
                    True,
                    True,
                    True,
                )
            )
        with patch(
            "tooling.acceptance.provisioners.mobile_native."
            "_write_fixture_outcomes",
            return_value=(),
        ):
            self.provisioner.cleanup()

        self.assertEqual(str(primary.exception), "primary acquisition failure")
        acquired = [
            event.removeprefix("lease.acquire:")
            for event in self.events
            if event.startswith("lease.acquire:")
        ]
        released = [
            event.removeprefix("lease.release:")
            for event in self.events
            if event.startswith("lease.release:")
        ]
        self.assertEqual(released, list(reversed(acquired)))
        self.assertIn("broker.close", self.events)
        self.assertNotIn("artifact.close", self.events)


class MobileNativeContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.contract_path = ENVIRONMENTS_DIR / "mobile-native.yaml"
        self.payload = json.loads(self.contract_path.read_text(encoding="utf-8"))
        self.spec = load_mobile_native_preflight_spec(self.contract_path)

    def test_checked_in_environment_loads_without_reconstruction(self) -> None:
        spec = load_mobile_native_preflight_spec()
        contract = EnvironmentContract.from_yaml(self.contract_path)
        self.assertEqual(spec.scenario.id, "access")
        self.assertFalse(contract.profile.required)
        self.assertFalse(contract.profile.identity_match)
        self.assertEqual(
            {client.id for client in spec.clients},
            set(EXPECTED_CLIENTS),
        )
        self.assertEqual(
            set(spec.parent_harness_actions),
            {
                "build.identity",
                "oauth.replayHandle",
                "oauth.negativeCallback",
            },
        )
        self.assertFalse(
            set(spec.harness_actions).intersection(
                spec.parent_harness_actions
            )
        )
        self.assertEqual(
            spec.scenario.ephemeral_capabilities,
            tuple(MOBILE_NATIVE_CAPABILITIES),
        )
        self.assertEqual(
            spec.scenario.credential_ids,
            (
                "github-disposable-account",
                "google-disposable-account",
            ),
        )

    def test_service_bindings_resolve_only_from_runtime_environment(
        self,
    ) -> None:
        contract = EnvironmentContract.from_yaml(self.contract_path)
        environment = {
            "PT_MOBILE_STATION_PRIMARY_URL": (
                "https://station-primary.example"
            ),
            "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV": "deploy-primary",
            "PT_MOBILE_STATION_SECONDARY_URL": (
                "https://station-secondary.example"
            ),
            "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV": "deploy-secondary",
            "PT_RELAY_URL": "https://relay.example",
            "PT_RELAY_DEPLOY_ENV": "deploy-relay",
            "PT_RELAY_HEALTH_URL": (
                "https://relay.example/sub-oss/healthz"
            ),
        }

        bindings = resolve_mobile_service_bindings(
            contract,
            self.contract_path,
            environment=environment,
        )

        self.assertEqual(set(bindings), set(contract.services))
        self.assertEqual(
            bindings["station-primary"].deployment_environment,
            "deploy-primary",
        )
        self.assertEqual(
            bindings["relay"].health_endpoint,
            "https://relay.example/sub-oss/healthz",
        )

    def test_service_binding_missing_injection_fails_closed(self) -> None:
        contract = EnvironmentContract.from_yaml(self.contract_path)

        with self.assertRaises(BlockedError) as raised:
            resolve_mobile_service_bindings(
                contract,
                self.contract_path,
                environment={},
            )

        self.assertEqual(
            raised.exception.resource,
            "service-binding:station-primary:endpoint:"
            "PT_MOBILE_STATION_PRIMARY_URL",
        )

    def test_service_independent_scenario_requires_no_runtime_binding(
        self,
    ) -> None:
        contract = EnvironmentContract.from_yaml(self.contract_path)
        lifecycle_contract = dataclasses.replace(contract, services={})

        self.assertEqual(
            resolve_mobile_service_bindings(
                lifecycle_contract,
                self.contract_path,
                environment={},
            ),
            {},
        )

    def test_lifecycle_and_platform_scenarios_exclude_oauth_resources(
        self,
    ) -> None:
        for gate_id in (
            "mobile-native-lifecycle-e2e",
            "mobile-native-platform-e2e",
        ):
            with self.subTest(gate_id=gate_id):
                spec = load_mobile_native_preflight_spec(
                    self.contract_path,
                    gate_id=gate_id,
                )
                self.assertEqual(len(spec.clients), 2)
                self.assertEqual(
                    {client.platform for client in spec.clients},
                    {"ios", "android"},
                )
                self.assertEqual(spec.scenario.service_ids, ())
                self.assertEqual(spec.scenario.credential_ids, ())
                self.assertEqual(spec.scenario.fixture_ids, ())
                self.assertEqual(spec.scenario.provider_accounts, ())
                self.assertEqual(spec.scenario.browser_sessions, ())
                self.assertEqual(
                    spec.scenario.ephemeral_capabilities,
                    ("mobile.native.appium-session",),
                )
                self.assertNotIn(
                    "mobile.native.provider-authorization",
                    spec.scenario.ephemeral_capabilities,
                )
                self.assertNotIn(
                    "mobile.native.station-fixture",
                    spec.scenario.ephemeral_capabilities,
                )
                if gate_id == "mobile-native-lifecycle-e2e":
                    self.assertIn(
                        "background_app",
                        spec.scenario.appium_operations,
                    )
                else:
                    self.assertNotIn(
                        "background_app",
                        spec.scenario.appium_operations,
                    )
                self.assertFalse(
                    spec.scenario.require_exact_device_count
                )

    def test_product_scenario_preflight_mapping_is_shared_and_non_oauth(
        self,
    ) -> None:
        contract = EnvironmentContract.from_yaml(self.contract_path)

        for scenario in MOBILE_NATIVE_PRODUCT_SCENARIOS:
            with self.subTest(scenario=scenario):
                gate_id = MOBILE_NATIVE_SCENARIO_GATES[scenario]
                spec = load_mobile_native_preflight_spec(
                    self.contract_path,
                    gate_id=gate_id,
                )
                provisioner = MobileNativeProvisioner(contract)
                provisioner._evidence_run = SimpleNamespace(gate_id=gate_id)
                credential_refs, credential_values = (
                    provisioner.prepare_credentials()
                )

                self.assertEqual(spec.scenario.id, scenario)
                self.assertEqual(spec.scenario.gate_id, gate_id)
                self.assertEqual(
                    spec.scenario.client_ids,
                    tuple(EXPECTED_CLIENTS),
                )
                self.assertEqual(
                    spec.scenario.service_ids,
                    ("station-primary", "station-secondary", "relay"),
                )
                self.assertEqual(
                    spec.scenario.fixture_ids,
                    ("mobile-native-actors",),
                )
                self.assertEqual(spec.scenario.credential_ids, ())
                self.assertEqual(spec.scenario.provider_accounts, ())
                self.assertEqual(spec.scenario.browser_sessions, ())
                self.assertEqual(
                    spec.scenario.harness_actions,
                    MOBILE_NATIVE_PRODUCT_HARNESS_ACTIONS.get(scenario, ()),
                )
                self.assertEqual(
                    spec.scenario.parent_harness_actions,
                    ("build.identity",),
                )
                self.assertEqual(
                    spec.scenario.ephemeral_capabilities,
                    ("mobile.native.appium-session",),
                )
                self.assertEqual(
                    spec.scenario.appium_operations,
                    MOBILE_NATIVE_PRODUCT_APPIUM_OPERATIONS,
                )
                self.assertEqual(
                    spec.scenario.cleanup_resources,
                    MOBILE_NATIVE_PRODUCT_CLEANUP_RESOURCES,
                )
                self.assertTrue(spec.scenario.require_exact_device_count)
                self.assertEqual(credential_refs, ())
                self.assertEqual(credential_values, {})
                self.assertEqual(provisioner.contract.credentials, ())
                self.assertEqual(
                    set(provisioner.contract.services),
                    {"station-primary", "station-secondary", "relay"},
                )
                self.assertEqual(
                    tuple(
                        fixture.id
                        for fixture in provisioner.contract.fixtures
                    ),
                    ("mobile-native-actors",),
                )

    def test_scenario_matrix_rejects_missing_or_unknown_entries(self) -> None:
        for mutation in ("missing", "unknown"):
            with self.subTest(mutation=mutation):
                payload = json.loads(json.dumps(self.payload))
                if mutation == "missing":
                    del payload["scenarios"]["settings"]
                else:
                    payload["scenarios"]["unexpected"] = json.loads(
                        json.dumps(payload["scenarios"]["settings"])
                    )
                    payload["scenarios"]["unexpected"]["gate_id"] = (
                        "mobile-native-unexpected-e2e"
                    )
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "mobile-native.yaml"
                    path.write_text(json.dumps(payload), encoding="utf-8")
                    with self.assertRaisesRegex(
                        BlockedError,
                        "scenario matrix",
                    ):
                        load_mobile_native_preflight_spec(path)

    def test_runner_order_filters_credentials_before_resolution(self) -> None:
        contract = EnvironmentContract.from_yaml(self.contract_path)
        provisioner = MobileNativeProvisioner(contract)
        provisioner._evidence_run = SimpleNamespace(
            gate_id="mobile-native-lifecycle-e2e"
        )

        credential_refs, credential_values = provisioner.prepare_credentials()

        self.assertEqual(credential_refs, ())
        self.assertEqual(credential_values, {})
        self.assertEqual(provisioner.contract.credentials, ())
        self.assertEqual(provisioner._native_spec.scenario.id, "lifecycle")

    def test_platform_permission_prompt_capabilities_match_each_driver(self) -> None:
        source = inspect.getsource(_ParentAppiumSession.start)

        self.assertIn('"appium:autoAcceptAlerts"', source)
        self.assertIn('"appium:autoGrantPermissions"', source)
        self.assertIn('if self.platform == "ios"', source)

    def test_parent_harness_actions_are_exact_and_disjoint(self) -> None:
        for parent_actions in (
            ["build.identity", "oauth.replayHandle"],
            [
                "build.identity",
                "oauth.replayHandle",
                "oauth.negativeCallback",
                "projection.read",
            ],
        ):
            with self.subTest(parent_actions=parent_actions):
                payload = json.loads(json.dumps(self.payload))
                payload["harness"]["parent_only_actions"] = parent_actions
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "mobile-native.yaml"
                    path.write_text(json.dumps(payload), encoding="utf-8")
                    with self.assertRaisesRegex(
                        BlockedError,
                        "parent-only actions",
                    ):
                        load_mobile_native_preflight_spec(path)

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
            client["destination_class_ref"]
            for client in clients
            if client["platform"] == "android"
        }
        self.assertEqual(
            android_destinations,
            {"android-physical"},
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
        self.assertEqual(
            self.spec.lease_authentication_key_ref,
            "env:PT_MOBILE_RESOURCE_LEASE_AUTH_KEY",
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
                and client["browser_session"]["lease_ref"]
                == f"provider-browser-session-lease/{client['id']}"
                for client in self.payload["clients"]
            )
        )
        self.assertFalse(self.spec.chromedriver.acquisition_enabled)
        self.assertEqual(
            self.spec.chromedriver.cache_root,
            "<runtime-cache>/chromedriver",
        )

    def test_fixture_contract_removes_legacy_refs_and_keeps_e23_declarations(self) -> None:
        serialized = json.dumps(self.payload)
        self.assertNotIn("PT_MOBILE_IOS_ALICE_DEVICE_" + "UDID", serialized)
        self.assertNotIn("PT_MOBILE_ANDROID_BOB_DEVICE_" + "SERIAL", serialized)
        self.assertNotIn("PT_MOBILE_ANDROID_" + "AVD", serialized)
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
            "PT_MOBILE_APPIUM_SERVER_URL": "http://127.0.0.1:4723",
            "PT_MOBILE_IOS_WDA_BUNDLE_ID": "com.peers.touch.wda",
            "PT_MOBILE_IOS_WEBVIEW_BUNDLE_ID": "com.peers.touch.mobile",
            "PT_MOBILE_ACCEPTANCE_RUNTIME_CACHE": str(self.runtime_cache),
            "PT_MOBILE_ANDROID_CHROMEDRIVER_EXECUTABLE": str(
                self.chromedriver_executable
            ),
            "PT_MOBILE_ACCEPTANCE_RUNTIME_ROOT": str(
                self.repo_root / "runtime"
            ),
            "PT_MOBILE_RESOURCE_LEASE_AUTH_KEY": "ab" * 32,
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
                for action in (
                    *self.spec.harness_actions,
                    *self.spec.parent_harness_actions,
                )
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
        self.executor.ios_devices = {"00008110-000A111122223333"}
        with patch.dict(os.environ, self.environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            with self.assertRaisesRegex(
                BlockedError,
                "exactly two connected physical iOS devices",
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
            "00008030-001A2B3C4D5E602E"
        )
        with patch.dict(os.environ, self.environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            with self.assertRaisesRegex(BlockedError, "connected physical"):
                self._preflight()

    def test_android_emulator_serial_blocks(self) -> None:
        self.executor.android_devices.clear()
        self.executor.android_devices.add("emulator-5554")
        with patch.dict(os.environ, self.environment, clear=True), patch(
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

    def test_removed_raw_device_inputs_are_not_required(self) -> None:
        environment = dict(self.environment)
        for name in (
            "PT_MOBILE_IOS_ALICE_DEVICE_UDID",
            "PT_MOBILE_IOS_BOB_DEVICE_UDID",
            "PT_MOBILE_ANDROID_ALICE_DEVICE_SERIAL",
            "PT_MOBILE_ANDROID_BOB_DEVICE_SERIAL",
            "PT_MOBILE_ANDROID_" + "AVD",
        ):
            environment.pop(name, None)
        self._install_harness_actions()
        with patch.dict(os.environ, environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            result = self._preflight()
        self.assertEqual(set(result["physicalDevices"]), set(EXPECTED_CLIENTS))

    def test_missing_harness_actions_block(self) -> None:
        with patch.dict(os.environ, self.environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            with self.assertRaisesRegex(BlockedError, "Harness actions are missing"):
                self._preflight()

    def test_missing_parent_only_harness_action_blocks(self) -> None:
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
        with patch.dict(os.environ, self.environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native._appium_server_version",
            return_value="2.19.0",
        ):
            with self.assertRaisesRegex(
                BlockedError,
                "Harness actions are missing",
            ):
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
        self.assertEqual(set(result["physicalDevices"]), set(EXPECTED_CLIENTS))
        self.assertEqual(
            result["leaseAuthenticationKey"],
            bytearray.fromhex("ab" * 32),
        )
        self.assertEqual(result["chromedriver"]["browserMajor"], 124)
        self.assertEqual(
            result["iosReadiness"]["nativeContext"],
            "NATIVE_APP",
        )

    def test_resource_lease_key_is_stable_across_preflight_runs(self) -> None:
        self._install_harness_actions()
        with patch.dict(os.environ, self.environment, clear=True), patch(
            "tooling.acceptance.provisioners.mobile_native."
            "_appium_server_version",
            return_value="2.19.0",
        ):
            first = self._preflight()["leaseAuthenticationKey"]
            second = self._preflight()["leaseAuthenticationKey"]

        self.assertIsInstance(first, bytearray)
        self.assertIsInstance(second, bytearray)
        self.assertIsNot(first, second)
        self.assertEqual(first, second)

    def test_missing_or_invalid_resource_lease_key_blocks(self) -> None:
        self._install_harness_actions()
        for value in ("", "not-hex", "ab" * 31):
            environment = dict(self.environment)
            if value:
                environment["PT_MOBILE_RESOURCE_LEASE_AUTH_KEY"] = value
            else:
                environment.pop("PT_MOBILE_RESOURCE_LEASE_AUTH_KEY")
            with self.subTest(value=value), patch.dict(
                os.environ,
                environment,
                clear=True,
            ), patch(
                "tooling.acceptance.provisioners.mobile_native."
                "_appium_server_version",
                return_value="2.19.0",
            ):
                with self.assertRaisesRegex(
                    BlockedError,
                    "resource lease authentication key",
                ):
                    self._preflight()

    def test_non_access_preflight_requires_lease_key_but_not_oauth_secrets(
        self,
    ) -> None:
        for gate_id in (
            "mobile-native-lifecycle-e2e",
            "mobile-native-platform-e2e",
        ):
            with self.subTest(gate_id=gate_id):
                scenario_spec = load_mobile_native_preflight_spec(
                    ENVIRONMENTS_DIR / "mobile-native.yaml",
                    gate_id=gate_id,
                )
                self.spec = dataclasses.replace(
                    scenario_spec,
                    chromedriver=self.spec.chromedriver,
                )
                self._install_harness_actions()
                environment = dict(self.environment)
                environment.pop("MOBILE_ACCEPTANCE_GITHUB_ACCOUNT", None)
                environment.pop("MOBILE_ACCEPTANCE_GOOGLE_ACCOUNT", None)
                with patch.dict(
                    os.environ,
                    environment,
                    clear=True,
                ), patch(
                    "tooling.acceptance.provisioners.mobile_native."
                    "_appium_server_version",
                    return_value="2.19.0",
                ):
                    result = self._preflight()

                self.assertEqual(
                    result["leaseAuthenticationKey"],
                    bytearray.fromhex("ab" * 32),
                )
                self.assertEqual(len(result["physicalDevices"]), 2)

    def test_missing_disposable_oauth_credentials_block(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "mobile-native.yaml"
        )
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(BlockedError, "credential preflight"):
                require_mobile_native_credentials(contract)


if __name__ == "__main__":
    unittest.main(verbosity=2)
