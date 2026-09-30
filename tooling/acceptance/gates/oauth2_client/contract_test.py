from __future__ import annotations

import unittest

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
                    ("OLB-G01", "OLB-G02", "OLB-G05"),
                ),
                "refresh-idempotency": (
                    ("OLB-C05", "OLB-C06", "OLB-C08"),
                    ("OLB-G03",),
                ),
                "key-rotation": (("OLB-C03",), ("OLB-G06",)),
                "operator": (
                    ("OLB-C02", "OLB-C04", "OLB-C07"),
                    ("OLB-G04",),
                ),
            },
        )

    def test_patterns_are_exact(self) -> None:
        pattern = test_pattern(("TestOne", "TestTwo"))
        self.assertEqual(pattern, "^(TestOne|TestTwo)$")

    def test_unknown_scope_fails_closed(self) -> None:
        with self.assertRaises(GateError):
            commands_for_scope("unknown")

    def test_browser_probe_is_valid_python(self) -> None:
        compile(BROWSER_SCRIPT, "<oauth2-client-browser-probe>", "exec")


if __name__ == "__main__":
    unittest.main()
