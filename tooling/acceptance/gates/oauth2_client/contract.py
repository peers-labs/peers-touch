#!/usr/bin/env python3
"""Run source-bound OAuth Login Broker functional contract tests."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from tooling.acceptance.core import AcceptanceGate, GateError, load_runtime_manifest


REPO_ROOT = Path(__file__).resolve().parents[4]
MODULE_ROOT = REPO_ROOT / "apps" / "oauth2-client"


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
                    "TestVercelRejectsMemoryStorage",
                    "TestSitesJSONStoresNormalizedValues",
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
                    "TestRefreshCredentialPreservesOmittedRefreshToken",
                ),
            ),
            TestGroup(
                "./internal/infrastructure/persistence/github",
                ("TestStoreConvergesRefreshAfterLostRefUpdateResponse",),
            ),
            TestGroup(
                "./internal/infrastructure/provider/github",
                ("TestRefreshToken",),
            ),
            TestGroup(
                "./internal/infrastructure/provider/google",
                ("TestRefreshToken",),
            ),
            TestGroup(
                "./internal/infrastructure/provider/weixin",
                ("TestRefreshToken",),
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
                    "TestAdminJSONAndHTMLAreSanitized",
                ),
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
        return {
            "environment": manifest["environmentId"],
            "runtimeCell": self.scope,
            "testGroupCount": len(self.groups),
            "evidence": {"goTestLog": log_ref},
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", choices=tuple(SCOPES), required=True)
    args = parser.parse_args()
    return OAuth2ClientContractGate(args.scope).execute()


if __name__ == "__main__":
    raise SystemExit(main())
