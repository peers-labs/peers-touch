from __future__ import annotations

import unittest
from pathlib import Path

import yaml

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.oauth2_client.contract import (
    BROWSER_SCRIPT,
    CLAIMS,
    SCOPES,
    commands_for_scope,
    test_pattern,
)


class OAuth2ClientContractTests(unittest.TestCase):
    def test_each_scope_has_stable_gate_and_tests(self) -> None:
        self.assertEqual(
            set(SCOPES),
            {
                "durable-login",
                "refresh-idempotency",
                "key-rotation",
                "operator",
            },
        )
        for scope, (gate_id, journey_id, groups) in SCOPES.items():
            with self.subTest(scope=scope):
                self.assertTrue(gate_id.startswith("oauth-login-broker-"))
                self.assertTrue(journey_id.startswith("OLB-J"))
                self.assertTrue(groups)
                self.assertEqual(len(commands_for_scope(scope)), len(groups) * 2)

    def test_each_scope_declares_only_its_proven_claims(self) -> None:
        self.assertEqual(
            CLAIMS,
            {
                "durable-login": (
                    (
                        "OLB-C01",
                        "OLB-C03",
                        "OLB-C04",
                        "OLB-C06",
                        "OLB-C08",
                        "OLB-C09",
                    ),
                    (
                        "OLB-G01",
                        "OLB-G02",
                        "OLB-G03A",
                        "OLB-G05A",
                        "OLB-G05B",
                    ),
                ),
                "refresh-idempotency": (
                    ("OLB-C05", "OLB-C06", "OLB-C08"),
                    ("OLB-G03B",),
                ),
                "key-rotation": (("OLB-C03",), ("OLB-G06",)),
                "operator": (
                    ("OLB-C02", "OLB-C04", "OLB-C07"),
                    ("OLB-G04",),
                ),
            },
        )

    def test_split_claims_have_selected_test_witnesses(self) -> None:
        witnesses = {
            "durable-login": {
                "OLB-G01": {
                    (
                        "./internal/integration",
                        "TestOAuthLoginBrokerCrossInstanceHTTPJourney",
                    ),
                },
                "OLB-G03A": {
                    (
                        "./internal/infrastructure/provider/github",
                        "TestAuthorizeAndExchangeUsePKCEAndReturnTokenSet",
                    ),
                    (
                        "./internal/infrastructure/provider/google",
                        "TestAuthorizeAndExchangeUsePKCEAndReturnTokenSet",
                    ),
                    (
                        "./internal/infrastructure/provider/weixin",
                        "TestExchangeReturnsRefreshableTokenSet",
                    ),
                },
                "OLB-G05A": {
                    (
                        "./internal/bootstrap",
                        "TestVercelRequiresBridgeSecretAndReturnAllowlist",
                    ),
                    (
                        "./internal/bootstrap",
                        "TestVercelRejectsHTTPProviderRedirect",
                    ),
                    (
                        "./internal/bootstrap",
                        "TestVercelRejectsMissingOrMemoryStorage",
                    ),
                    (
                        "./internal/bootstrap",
                        "TestStorageHTTPClientIsBounded",
                    ),
                    (
                        "./internal/bootstrap",
                        "TestConfigFileAllowedReturnToCanBeOverridden",
                    ),
                    (
                        "./internal/bootstrap",
                        "TestGitHubAPIBaseRequiresHTTPSOnVercel",
                    ),
                },
                "OLB-G05B": {
                    (
                        "./internal/bootstrap",
                        "TestBuildContainerInLocalMemoryMode",
                    ),
                    (
                        "./internal/bootstrap",
                        "TestVercelRequiresValidAdminAuthentication",
                    ),
                    (
                        "./internal/bootstrap",
                        "TestGitHubStorageRejectsIncompleteProductionBootstrap",
                    ),
                    (
                        "./internal/bootstrap",
                        "TestBuildOAuthStoreRejectsInvalidGitHubPrivateKey",
                    ),
                    (
                        "./internal/bootstrap",
                        "TestBuildContainerRejectsIncompleteProductionBootstrap",
                    ),
                    (
                        "./internal/bootstrap",
                        "TestBuildContainerValidatesCompleteProductionBootstrap",
                    ),
                    (
                        "./internal/integration",
                        "TestOAuthVercelRoutesMatchHandlers",
                    ),
                },
            },
            "refresh-idempotency": {
                "OLB-G03B": {
                    (
                        "./internal/application/oauth/usecase",
                        "TestRefreshCredentialReturnsCommittedDuplicateWithoutProviderCall",
                    ),
                    (
                        "./internal/application/oauth/usecase",
                        "TestRefreshCredentialRetriesAfterGenerationConflict",
                    ),
                    (
                        "./internal/application/oauth/usecase",
                        "TestRefreshCredentialPreservesOmittedRefreshToken",
                    ),
                },
            },
            "key-rotation": {
                "OLB-G06": {
                    (
                        "./internal/infrastructure/persistence/github",
                        "TestRotateEncryptionConfirmsLostRefUpdateResponse",
                    ),
                    (
                        "./internal/infrastructure/persistence/github",
                        "TestRotateEncryptionCountsCandidateCorruptionAfterConflict",
                    ),
                    (
                        "./internal/infrastructure/persistence/github",
                        "TestRotateEncryptionRetriesWithIncompleteResultAfterConcurrentInsert",
                    ),
                    (
                        "./cmd/rotate-records",
                        "TestRotateRecordsRunUsesExplicitCompletion",
                    ),
                },
            },
            "operator": {
                "OLB-G04": {
                    (
                        "./internal/infrastructure/persistence/github",
                        "TestAdminSnapshotReturnsNewestSameMonthEventsWithBoundedReads",
                    ),
                    (
                        "./internal/infrastructure/persistence/github",
                        "TestAdminSnapshotRejectsLegacyAuditPathBeforeBlobRead",
                    ),
                    (
                        "./internal/infrastructure/persistence/github",
                        "TestRecordAuthorizationFailureDistinguishesOccurrences",
                    ),
                    (
                        "./internal/infrastructure/persistence/memory",
                        "TestRecordAuthorizationFailureDistinguishesOccurrences",
                    ),
                },
            },
        }
        for scope, claim_witnesses in witnesses.items():
            selected = {
                (group.package, test)
                for group in SCOPES[scope][2]
                for test in group.tests
            }
            with self.subTest(scope=scope):
                self.assertTrue(set(claim_witnesses).issubset(CLAIMS[scope][1]))
                for claim, required in claim_witnesses.items():
                    self.assertTrue(
                        required.issubset(selected),
                        f"{scope} claim {claim} lacks selected witnesses",
                    )

        self.assertNotIn("OLB-G06", CLAIMS["durable-login"][1])
        self.assertNotIn("OLB-G06", CLAIMS["refresh-idempotency"][1])
        self.assertNotIn("OLB-G06", CLAIMS["operator"][1])
        self.assertEqual(CLAIMS["key-rotation"][1], ("OLB-G06",))

    def test_patterns_are_exact(self) -> None:
        pattern = test_pattern(("TestOne", "TestTwo"))
        self.assertEqual(pattern, "^(TestOne|TestTwo)$")

    def test_execution_commands_enable_race_detector(self) -> None:
        for scope in SCOPES:
            with self.subTest(scope=scope):
                commands = commands_for_scope(scope)
                execution_commands = [
                    command for command in commands if "-run" in command
                ]
                self.assertTrue(execution_commands)
                for command in execution_commands:
                    self.assertIn("-race", command)

    def test_unknown_scope_fails_closed(self) -> None:
        with self.assertRaises(GateError):
            commands_for_scope("unknown")

    def test_browser_probe_is_valid_python(self) -> None:
        compile(BROWSER_SCRIPT, "<oauth2-client-browser-probe>", "exec")

    def test_station_compose_injects_oauth_bridge_secret(self) -> None:
        repo_root = Path(__file__).resolve().parents[4]
        compose = yaml.safe_load(
            (repo_root / "tooling/docker/compose.yml").read_text(encoding="utf-8")
        )
        station_environment = compose["services"]["station"]["environment"]
        self.assertEqual(
            station_environment["PEERS_OAUTH_BRIDGE_SECRET"],
            "${PEERS_OAUTH_BRIDGE_SECRET:-}",
        )


if __name__ == "__main__":
    unittest.main()
