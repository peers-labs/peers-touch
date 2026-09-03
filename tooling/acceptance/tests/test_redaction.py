from __future__ import annotations

import json
import unittest
from base64 import b64encode
from pathlib import Path
from urllib.parse import quote, quote_plus

from tooling.acceptance.core.redaction import (
    REDACTED,
    is_sensitive_key,
    redact_artifact_bytes,
    redact_text,
    redact_text_with_values,
    redact_value,
)


class RedactionTests(unittest.TestCase):
    def test_detects_sensitive_keys_without_redacting_safe_references(self) -> None:
        for key in (
            "apiKey",
            "clientSecret",
            "refresh_token",
            "privateKey",
            "connectionString",
            "oauthCode",
            "code_verifier",
            "recoveryCode",
            "nonce",
            "otp",
            "dsn",
        ):
            with self.subTest(key=key):
                self.assertTrue(is_sensitive_key(key))
        for key in (
            "credentialRefs",
            "apiKeyRef",
            "tokenizer",
            "public_key",
            "contextTokens",
            "fencing_token",
            "secretLeakCount",
            "tokenUsage",
        ):
            with self.subTest(key=key):
                self.assertFalse(is_sensitive_key(key))

    def test_redacts_nested_values_mapping_keys_bytes_and_objects(self) -> None:
        token = "ghp_" + "a" * 24
        value = {
            "apiKey": "api-secret",
            "nested": [{"accessTokensPresent": False, "password": "secret"}],
            token: "value",
            "payload": b"Bearer byte-secret",
            "path": Path("/tmp/token=path-secret"),
        }
        redacted = redact_value(value)

        self.assertEqual(redacted["apiKey"], REDACTED)
        self.assertEqual(redacted["nested"][0]["accessTokensPresent"], False)
        self.assertEqual(redacted["nested"][0]["password"], REDACTED)
        self.assertEqual(redacted[REDACTED], "value")
        self.assertEqual(redacted["payload"], REDACTED)
        self.assertNotIn("path-secret", redacted["path"])

    def test_redacts_assignments_headers_urls_tokens_and_private_keys(self) -> None:
        github_token = "ghp_" + "a" * 24
        text = (
            'api.key="alpha beta" --client-secret bravo\n'
            "Authorization: Basic dXNlcjpwYXNz\n"
            "Cookie: session=secret; preference=dark\n"
            "postgres://alice:database-secret@db.internal/app "
            "https://provider.test/callback?code=authorization-code"
            "&state=csrf-state&X-Amz%2DSignature=aws-signature "
            f"{github_token}\n"
            "-----BEGIN PRIVATE KEY-----\nprivate-material"
        )
        redacted = redact_text(text)

        for secret in (
            "alpha beta",
            "bravo",
            "dXNlcjpwYXNz",
            "session=secret",
            "database-secret",
            "authorization-code",
            "csrf-state",
            "aws-signature",
            github_token,
            "private-material",
        ):
            self.assertNotIn(secret, redacted)

    def test_redacts_encoded_explicit_values_longest_first(self) -> None:
        secret = 'client:secret value/"quoted"'
        encoded_values = (
            quote(secret, safe=""),
            quote_plus(secret, safe=""),
            quote(quote(secret, safe=""), safe=""),
            json.dumps(secret)[1:-1],
            json.dumps(secret)[1:-1].replace("/", r"\/"),
            b64encode(secret.encode()).decode(),
        )
        for encoded in encoded_values:
            with self.subTest(encoded=encoded):
                redacted = redact_text_with_values(encoded, (secret,))
                self.assertNotIn(encoded, redacted)
                self.assertIn(REDACTED, redacted)
        self.assertEqual(
            redact_text_with_values("credential=abcdefgh", ("abcd", "abcdefgh")),
            f"credential={REDACTED}",
        )

    def test_short_explicit_values_are_ignored(self) -> None:
        redacted = redact_text_with_values(
            "value=long-secret-value marker=abc",
            ("long-secret-value", "abc"),
        )
        self.assertNotIn("long-secret-value", redacted)
        self.assertIn("marker=abc", redacted)

    def test_redaction_is_idempotent(self) -> None:
        once = redact_text(
            "Authorization: Bearer abc.def.ghi password=secret-value"
        )
        self.assertEqual(redact_text(once), once)

    def test_redacts_json_and_binary_artifacts_before_persistence(self) -> None:
        payload = json.dumps(
            {
                "password": "json-secret",
                "nested": {"authorization": "Bearer nested-secret"},
            }
        ).encode()
        redacted, changed = redact_artifact_bytes(payload)
        decoded = json.loads(redacted)
        self.assertTrue(changed)
        self.assertEqual(decoded["password"], REDACTED)
        self.assertEqual(decoded["nested"]["authorization"], REDACTED)

        redacted, changed = redact_artifact_bytes(
            b"\x00\xff" + b64encode(b"client:secret") + b"\x80",
            ("client:secret",),
        )
        self.assertTrue(changed)
        self.assertEqual(redacted, f"{REDACTED}\n".encode())

    def test_preserves_binary_artifact_without_explicit_secret(self) -> None:
        payload = b"\x00\xff\x80"
        redacted, changed = redact_artifact_bytes(payload)
        self.assertFalse(changed)
        self.assertEqual(redacted, payload)


if __name__ == "__main__":
    unittest.main()
