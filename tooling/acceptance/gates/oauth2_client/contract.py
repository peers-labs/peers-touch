#!/usr/bin/env python3
"""Run source-bound OAuth Login Broker functional contract tests."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from tooling.acceptance.core import AcceptanceGate, GateError, load_runtime_manifest


REPO_ROOT = Path(__file__).resolve().parents[4]
MODULE_ROOT = REPO_ROOT / "apps" / "oauth2-client"
SERVER_START_TIMEOUT_SECONDS = 30


@dataclass(frozen=True)
class TestGroup:
    package: str
    tests: tuple[str, ...]


SCOPES: dict[str, tuple[str, str, tuple[TestGroup, ...]]] = {
    "durable-login": (
        "oauth-login-broker-durable-login",
        "OLB-J01",
        (
            TestGroup(
                "./internal/application/oauth/usecase",
                (
                    "TestHandleCallbackCompletesOnceAndRejectsReplay",
                    "TestHandleCallbackErrorUsesTransactionSiteAndOmitsState",
                    "TestStartAuthAcceptsOnlyConfiguredReturnDestination",
                ),
            ),
            TestGroup(
                "./internal/bootstrap",
                (
                    "TestVercelRequiresBridgeSecretAndReturnAllowlist",
                    "TestVercelRejectsHTTPProviderRedirect",
                    "TestVercelRejectsMemoryStorage",
                    "TestSitesJSONStoresNormalizedValues",
                    "TestStorageHTTPClientIsBounded",
                ),
            ),
            TestGroup(
                "./internal/infrastructure/crypto",
                (
                    "TestEnvelopeRoundTripAndNonceUniqueness",
                    "TestEnvelopeAuthenticatesMetadataKindAndPath",
                ),
            ),
            TestGroup(
                "./internal/infrastructure/persistence/github",
                (
                    "TestStoreCompletesAuthorizationAcrossInstances",
                    "TestStoreConvergesAfterLostRefUpdateResponse",
                    "TestGitDataRetriesConflictAndRefreshesInstallationToken",
                ),
            ),
            TestGroup(
                "./internal/infrastructure/provider/github",
                ("TestAuthorizeAndExchangeUsePKCEAndReturnTokenSet",),
            ),
            TestGroup(
                "./internal/infrastructure/provider/google",
                ("TestAuthorizeAndExchangeUsePKCEAndReturnTokenSet",),
            ),
            TestGroup(
                "./internal/infrastructure/provider/weixin",
                ("TestExchangeReturnsRefreshableTokenSet",),
            ),
            TestGroup(
                "./internal/integration",
                ("TestOAuthLoginBrokerCrossInstanceHTTPJourney",),
            ),
        ),
    ),
    "refresh-idempotency": (
        "oauth-login-broker-refresh-idempotency",
        "OLB-J02",
        (
            TestGroup(
                "./internal/application/oauth/usecase",
                (
                    "TestRefreshCredentialReturnsCommittedDuplicateWithoutProviderCall",
                    "TestRefreshCredentialRemembersEarlierOperation",
                    "TestRefreshCredentialRetriesAfterGenerationConflict",
                    "TestRefreshCredentialPreservesOmittedRefreshToken",
                ),
            ),
            TestGroup(
                "./internal/infrastructure/persistence/github",
                ("TestStoreConvergesRefreshAfterLostRefUpdateResponse",),
            ),
            TestGroup(
                "./internal/infrastructure/provider/github",
                (
                    "TestRefreshToken",
                    "TestRefreshTokenRedactsProviderResponse",
                ),
            ),
            TestGroup(
                "./internal/infrastructure/provider/google",
                (
                    "TestRefreshToken",
                    "TestRefreshTokenRedactsProviderResponse",
                ),
            ),
            TestGroup(
                "./internal/infrastructure/provider/weixin",
                (
                    "TestRefreshToken",
                    "TestRefreshTokenRedactsProviderResponse",
                ),
            ),
        ),
    ),
    "key-rotation": (
        "oauth-login-broker-key-rotation",
        "OLB-J04",
        (
            TestGroup(
                "./internal/infrastructure/persistence/github",
                (
                    "TestRotateEncryptionCoversEveryRecordClass",
                    "TestRotateEncryptionUnknownKeyFailsClosed",
                ),
            ),
            TestGroup(
                "./cmd/rotate-records",
                ("TestRotateRecordsRun",),
            ),
        ),
    ),
    "operator": (
        "oauth-login-broker-operator",
        "OLB-J03",
        (
            TestGroup(
                "./internal/interfaces/http/handler",
                (
                    "TestAdminRejectsUnauthorizedBeforeStorage",
                    "TestBasicAuthenticatorRejectsMissingCredentialsWithoutPasswordDerivation",
                    "TestBasicAuthenticatorDerivesSuppliedWrongCredentials",
                    "TestBasicAuthenticatorBoundsConcurrentPasswordDerivations",
                    "TestAdminUnavailableIncludesSecurityHeaders",
                    "TestAdminJSONAndHTMLAreSanitized",
                ),
            ),
            TestGroup(
                "./api/admin",
                ("TestHandlerBootstrapFailureHasAdminSecurityHeaders",),
            ),
            TestGroup(
                "./api/admin/data",
                ("TestHandlerBootstrapFailureHasAdminSecurityHeaders",),
            ),
            TestGroup(
                "./internal/integration",
                ("TestOAuthLoginBrokerJourney",),
            ),
        ),
    ),
}


def test_pattern(names: Sequence[str]) -> str:
    return "^(" + "|".join(re.escape(name) for name in names) + ")$"


def commands_for_scope(scope: str) -> tuple[tuple[str, ...], ...]:
    try:
        groups = SCOPES[scope][2]
    except KeyError as error:
        raise GateError(f"unknown OAuth contract scope: {scope}") from error
    commands: list[tuple[str, ...]] = []
    for group in groups:
        pattern = test_pattern(group.tests)
        commands.append(("go", "test", group.package, "-list", pattern))
        commands.append(
            ("go", "test", group.package, "-run", pattern, "-count=1")
        )
    return tuple(commands)


class OAuth2ClientContractGate(AcceptanceGate):
    def __init__(self, scope: str) -> None:
        try:
            gate_id, journey_id, groups = SCOPES[scope]
        except KeyError as error:
            raise GateError(f"unknown OAuth contract scope: {scope}") from error
        self.gate_id = gate_id
        self.phase = journey_id
        self.bom = ("OLB-C01-C09",)
        self.spec = ("OLB-G01-G06",)
        self.scope = scope
        self.groups = groups
        super().__init__()

    def _runtime_manifest(self) -> dict[str, object]:
        raw = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
        if not raw:
            raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        manifest = load_runtime_manifest(Path(raw), self.gate_id)
        expected_environment = (
            "oauth2-client-local-browser"
            if self.scope == "operator"
            else "oauth2-client-local-service"
        )
        if (
            manifest.get("environmentId") != expected_environment
            or manifest.get("profile", {}).get("resolvedName")
            != "oauth2-client-local"
            or manifest.get("source", {}).get("workspaceDigest") != "clean"
        ):
            raise GateError("OAuth2 client Runtime Manifest is invalid")
        return manifest

    def run(self) -> dict[str, object]:
        manifest = self._runtime_manifest()
        logs: list[str] = []
        for group in self.groups:
            pattern = test_pattern(group.tests)
            listed = self._run(("go", "test", group.package, "-list", pattern))
            discovered = set(listed.stdout.splitlines())
            missing = sorted(set(group.tests) - discovered)
            self.assert_condition(
                f"{group.package}-tests-registered",
                not missing,
                f"missing tests: {', '.join(missing)}" if missing else None,
            )
            completed = self._run(
                ("go", "test", group.package, "-run", pattern, "-count=1")
            )
            logs.extend(
                (
                    f"$ {' '.join(completed.args)}",
                    completed.stdout,
                    completed.stderr,
                )
            )
            self.assert_condition(
                f"{group.package}-tests-pass",
                completed.returncode == 0,
                completed.stderr.strip() or completed.stdout.strip(),
            )

        runtime_evidence: dict[str, object] = {}
        if self.scope == "operator":
            runtime_evidence = self._run_browser_journey()

        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".log",
            delete=False,
        ) as handle:
            handle.write("\n".join(logs))
            log_path = Path(handle.name)
        try:
            log_ref = self.report.add_evidence_file("go-test", log_path)
        finally:
            log_path.unlink(missing_ok=True)
        browser_evidence = runtime_evidence.pop("evidence", {})
        return {
            "environment": manifest["environmentId"],
            "runtimeCell": self.scope,
            "testGroupCount": len(self.groups),
            **runtime_evidence,
            "evidence": {
                "goTestLog": log_ref,
                **browser_evidence,
            },
        }

    @staticmethod
    def _run(command: tuple[str, ...]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            command,
            cwd=MODULE_ROOT,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )

    def _run_browser_journey(self) -> dict[str, object]:
        port = free_port()
        password = secrets.token_urlsafe(24)
        salt = os.urandom(16)
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode(),
            salt,
            100_000,
            dklen=32,
        )
        password_hash = "pbkdf2-sha256$100000${}${}".format(
            base64.b64encode(salt).decode(),
            base64.b64encode(digest).decode(),
        )
        environment = {
            **os.environ,
            "PORT": str(port),
            "OAUTH_BASE_URL": f"http://127.0.0.1:{port}",
            "OAUTH_STORAGE_DRIVER": "memory",
            "OAUTH_GITHUB_CLIENT_ID": "local-client",
            "OAUTH_GITHUB_CLIENT_SECRET": "local-provider-secret",
            "OAUTH_GOOGLE_CLIENT_ID": "local-client",
            "OAUTH_GOOGLE_CLIENT_SECRET": "local-provider-secret",
            "OAUTH_ADMIN_USERNAME": "operator",
            "OAUTH_ADMIN_PASSWORD_HASH": password_hash,
            "VERCEL": "",
        }
        with tempfile.TemporaryDirectory(prefix="oauth2-client-browser-") as temp:
            temporary = Path(temp)
            screenshot = temporary / "admin.png"
            server_log = temporary / "server.log"
            server_binary = temporary / "oauth2-client-server"
            build = subprocess.run(
                ("go", "build", "-o", str(server_binary), "./cmd/server"),
                cwd=MODULE_ROOT,
                capture_output=True,
                text=True,
                timeout=300,
                check=False,
            )
            if build.returncode != 0:
                raise GateError(
                    "OAuth2 client server build failed: " +
                    (build.stderr.strip() or build.stdout.strip())
                )
            with server_log.open("w", encoding="utf-8") as output:
                server = subprocess.Popen(
                    (str(server_binary),),
                    cwd=MODULE_ROOT,
                    env=environment,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    text=True,
                )
                try:
                    wait_for_health(port, server)
                    data = fetch_admin_data(port, "operator", password)
                    self.assert_condition(
                        "admin-json-empty-state",
                        data.get("identities") in (None, []) and
                        data.get("events") in (None, []),
                    )
                    browser = subprocess.run(
                        (playwright_python(), "-c", BROWSER_SCRIPT),
                        cwd=REPO_ROOT,
                        input=json.dumps(
                            {
                                "url": f"http://127.0.0.1:{port}/api/admin",
                                "username": "operator",
                                "password": password,
                                "screenshot": str(screenshot),
                            }
                        ),
                        capture_output=True,
                        text=True,
                        timeout=90,
                        check=False,
                    )
                    browser_result = parse_browser_result(browser)
                    self.assert_condition(
                        "admin-browser-title",
                        browser_result.get("title") == "OAuth Login Broker",
                    )
                    self.assert_condition(
                        "admin-browser-tables",
                        browser_result.get("identityRows") == 1 and
                        browser_result.get("eventRows") == 1,
                    )
                    self.assert_condition(
                        "admin-browser-screenshot",
                        screenshot.is_file() and screenshot.stat().st_size > 4_000,
                    )
                finally:
                    server.terminate()
                    try:
                        server.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        server.kill()
                        server.wait(timeout=5)
            self.assert_condition("admin-server-cleanup", port_is_free(port))
            screenshot_ref = self.report.add_evidence_file(
                "admin-browser",
                screenshot,
            )
            server_log_ref = self.report.add_evidence_file(
                "admin-server-log",
                server_log,
            )
        return {
            "browser": browser_result,
            "evidence": {
                "adminBrowser": screenshot_ref,
                "adminServerLog": server_log_ref,
            },
        }


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def wait_for_health(port: int, process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + SERVER_START_TIMEOUT_SECONDS
    endpoint = f"http://127.0.0.1:{port}/api/healthz"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise GateError("OAuth2 client exited before health became ready")
        try:
            with urllib.request.urlopen(endpoint, timeout=1) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, OSError, TimeoutError):
            time.sleep(0.1)
    raise GateError("OAuth2 client health check timed out")


def fetch_admin_data(port: int, username: str, password: str) -> dict[str, object]:
    authorization = base64.b64encode(f"{username}:{password}".encode()).decode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/admin/data",
        headers={
            "Accept": "application/json",
            "Authorization": f"Basic {authorization}",
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read(1024 * 1024)
        if response.status != 200:
            raise GateError(f"admin JSON returned status {response.status}")
        return json.loads(body.decode())


def port_is_free(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return False
    except (ConnectionRefusedError, OSError, TimeoutError):
        return True
    else:
        return False


def parse_browser_result(
    completed: subprocess.CompletedProcess[str],
) -> dict[str, object]:
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise GateError(f"Playwright operator journey failed: {detail}")
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise GateError("Playwright operator journey returned invalid JSON") from error
    if not isinstance(value, dict):
        raise GateError("Playwright operator journey result must be an object")
    return value


def playwright_python() -> str:
    executable = shutil.which("playwright")
    if executable is None:
        raise GateError("Playwright CLI is unavailable")
    try:
        first_line = Path(executable).read_text(encoding="utf-8").splitlines()[0]
    except (OSError, IndexError) as error:
        raise GateError("Playwright launcher is unreadable") from error
    if not first_line.startswith("#!/"):
        raise GateError("Playwright launcher has no absolute Python interpreter")
    interpreter = first_line[2:]
    if not Path(interpreter).is_file():
        raise GateError("Playwright Python interpreter is unavailable")
    return interpreter


BROWSER_SCRIPT = r"""
import json
import sys

from playwright.sync_api import sync_playwright

config = json.load(sys.stdin)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        context = browser.new_context(
            http_credentials={
                "username": config["username"],
                "password": config["password"],
            },
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()
        response = page.goto(config["url"], wait_until="networkidle")
        if response is None or response.status != 200:
            raise RuntimeError("admin page did not return HTTP 200")
        page.locator("h1").wait_for()
        result = {
            "title": page.locator("h1").inner_text(),
            "identityRows": page.locator("#identities tbody tr").count(),
            "eventRows": page.locator("#events tbody tr").count(),
        }
        page.screenshot(path=config["screenshot"], full_page=True)
        print(json.dumps(result))
    finally:
        browser.close()
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", choices=tuple(SCOPES), required=True)
    args = parser.parse_args()
    return OAuth2ClientContractGate(args.scope).execute()


if __name__ == "__main__":
    raise SystemExit(main())
