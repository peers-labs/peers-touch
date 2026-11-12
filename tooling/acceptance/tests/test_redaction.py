from __future__ import annotations

import json
import unittest
from base64 import b64encode
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from urllib.parse import quote, quote_plus


_REDACTION_PATH = Path(__file__).resolve().parents[1] / "core" / "redaction.py"
_REDACTION_SPEC = spec_from_file_location(
    "acceptance_redaction_under_test",
    _REDACTION_PATH,
)
if _REDACTION_SPEC is None or _REDACTION_SPEC.loader is None:
    raise RuntimeError(f"cannot load redaction module from {_REDACTION_PATH}")
_REDACTION = module_from_spec(_REDACTION_SPEC)
_REDACTION_SPEC.loader.exec_module(_REDACTION)

REDACTED = _REDACTION.REDACTED
is_sensitive_key = _REDACTION.is_sensitive_key
redact_artifact_bytes = _REDACTION.redact_artifact_bytes
redact_text = _REDACTION.redact_text
redact_text_with_values = _REDACTION.redact_text_with_values
redact_value = _REDACTION.redact_value


class SensitiveKeyTests(unittest.TestCase):
    def test_detects_case_and_separator_variants(self) -> None:
        sensitive_keys = (
            "api_key",
            "api-key",
            "apiKey",
            "APIKey",
            "apikey",
            "clientSecret",
            "accessToken",
            "refresh_token",
            "refreshtoken",
            "sessionTokens",
            "privateKey",
            "signing_key",
            "connectionString",
            "Authorization",
            "set_cookie",
            "passphrase",
            "jwt",
            "key",
            "oauthCode",
            "code_verifier",
            "recoveryCode",
            "nonce",
            "otp",
            "dsn",
        )

        for key in sensitive_keys:
            with self.subTest(key=key):
                self.assertTrue(is_sensitive_key(key))

    def test_preserves_opaque_references_and_near_misses(self) -> None:
        safe_keys = (
            "credentialRefs",
            "secret_reference",
            "apiKeyRef",
            "tokenizer",
            "monkey",
            "public_key",
            "publicKeys",
            "authorization_url_ref",
            "cleanupFencingToken",
            "contextTokens",
            "fencing_token",
            "hostKeySha256",
            "idempotencyKeyHash",
            "localeKey",
            "maxOutputTokens",
            "process-port-secret-canary",
            "runtimeTupleKey",
            "scenarioKey",
            "secretLeakCount",
            "tokenAccountingPresent",
            "tokenUsage",
            # Non-reversible hashes are safe even when the name embeds a
            # sensitive token; the raw storage_key/password stays sensitive.
            "storage_key_digest",
            "storageKeyDigest",
            "password_digest",
            "secret_digest",
            "manifest_digest",
        )

        for key in safe_keys:
            with self.subTest(key=key):
                self.assertFalse(is_sensitive_key(key))

    def test_digest_suffix_is_safe_but_raw_secret_key_is_redacted(self) -> None:
        self.assertFalse(is_sensitive_key("storage_key_digest"))
        self.assertTrue(is_sensitive_key("storage_key"))
        self.assertFalse(is_sensitive_key("password_digest"))
        self.assertTrue(is_sensitive_key("password"))


class StructuredRedactionTests(unittest.TestCase):
    def test_preserves_fencing_metadata_and_redacts_credentials(self) -> None:
        self.assertEqual(
            redact_value(
                {
                    "cleanupFencingToken": 7,
                    "fencingToken": 8,
                    "accessToken": "sensitive",
                }
            ),
            {
                "cleanupFencingToken": 7,
                "fencingToken": 8,
                "accessToken": REDACTED,
            },
        )

    def test_redacts_nested_sensitive_values_and_preserves_boolean_metadata(self) -> None:
        value = {
            "apiKey": "api-secret",
            "nested": [
                {
                    "client_secret": "client-secret",
                    "accessTokensPresent": False,
                    "credentialRefs": ["env:PROVIDER_PASSWORD"],
                }
            ],
            "public_key": "safe-public-key",
        }

        self.assertEqual(
            redact_value(value),
            {
                "apiKey": REDACTED,
                "nested": [
                    {
                        "client_secret": REDACTED,
                        "accessTokensPresent": False,
                        "credentialRefs": ["env:PROVIDER_PASSWORD"],
                    }
                ],
                "public_key": "safe-public-key",
            },
        )

    def test_redacts_sensitive_values_inside_tuples(self) -> None:
        self.assertEqual(
            redact_value(({"password": "secret"}, "token=secret")),
            [{"password": REDACTED}, f"token={REDACTED}"],
        )

    def test_redacts_known_token_embedded_in_mapping_key(self) -> None:
        token = "ghp_" + "a" * 24

        self.assertEqual(
            redact_value({token: "value"}),
            {REDACTED: "value"},
        )

    def test_redacts_opaque_byte_values_fail_closed(self) -> None:
        self.assertEqual(
            redact_value({"payload": b"Bearer byte-secret"}),
            {"payload": REDACTED},
        )

    def test_stringifies_then_redacts_non_json_native_values(self) -> None:
        redacted = redact_value(Path("/tmp/token=path-secret"))

        self.assertIsInstance(redacted, str)
        self.assertNotIn("path-secret", redacted)
        self.assertIn(REDACTED, redacted)


class TextRedactionTests(unittest.TestCase):
    def test_every_generated_assignment_field_rejects_separator_variants(
        self,
    ) -> None:
        for field in _REDACTION._SENSITIVE_ASSIGNMENT_FIELDS:
            parts = field.split("_")
            variants = {
                field,
                "-".join(parts),
                ".".join(parts),
                " ".join(parts),
                "".join(parts),
                parts[0] + "".join(part.title() for part in parts[1:]),
            }
            for variant in variants:
                with self.subTest(field=field, variant=variant):
                    secret = f"value-for-{field}"
                    redacted = redact_text(f"{variant}={secret}")
                    self.assertNotIn(secret, redacted)
                    self.assertIn(REDACTED, redacted)

    def test_redacts_generated_assignment_variants(self) -> None:
        text = (
            'api.key="alpha beta" client-secret=bravo '
            '"refresh_token": "charlie" DSN=postgres://host/db '
            "oauthCode=delta"
        )
        redacted = redact_text(text)

        for secret in (
            "alpha beta",
            "bravo",
            "charlie",
            "postgres://host/db",
            "delta",
        ):
            self.assertNotIn(secret, redacted)
        self.assertEqual(redacted.count(REDACTED), 5)

    def test_redacts_authorization_and_cookie_headers_completely(self) -> None:
        text = (
            "Authorization: Basic dXNlcjpwYXNz\n"
            "Proxy-Authorization: Bearer proxy-secret\n"
            "Cookie: session=secret; preference=dark\n"
            "Set-Cookie: session=secret; HttpOnly\n"
            "authorization=Basic second-secret\n"
            "cookie=session=another-secret; preference=light"
        )
        redacted = redact_text(text)

        for secret in (
            "dXNlcjpwYXNz",
            "proxy-secret",
            "session=secret",
            "preference=dark",
            "HttpOnly",
            "second-secret",
            "another-secret",
            "preference=light",
        ):
            self.assertNotIn(secret, redacted)
        self.assertEqual(redacted.count(REDACTED), 6)

    def test_redacts_uri_credentials_known_tokens_and_jwt(self) -> None:
        github_token = "ghp_" + "a" * 24
        aws_key = "AKIA" + "B" * 16
        jwt = "eyJabcdefgh.abcdefghijkl.abcdefghijkl"
        text = (
            f"postgres://alice:database-secret@db.internal/app "
            f"{github_token} {aws_key} {jwt}"
        )
        redacted = redact_text(text)

        for secret in ("database-secret", github_token, aws_key, jwt):
            self.assertNotIn(secret, redacted)
        self.assertEqual(redacted.count(REDACTED), 4)

    def test_redacts_oauth_query_parameters(self) -> None:
        text = (
            "https://provider.test/callback"
            "?code=authorization-code&state=csrf-state"
            "&X-Amz%2DSignature=aws-signature"
            "#access%5Ftoken=fragment-token&safe=value"
        )
        redacted = redact_text(text)

        self.assertNotIn("authorization-code", redacted)
        self.assertNotIn("csrf-state", redacted)
        self.assertNotIn("aws-signature", redacted)
        self.assertNotIn("fragment-token", redacted)
        self.assertIn("safe=value", redacted)
        self.assertEqual(redacted.count(REDACTED), 4)

    def test_redacts_command_flags_and_line_assignments(self) -> None:
        text = (
            "client --api-key command-secret --verbose\n"
            "password netrc-secret\n"
            "safe value"
        )
        redacted = redact_text(text)

        self.assertNotIn("command-secret", redacted)
        self.assertNotIn("netrc-secret", redacted)
        self.assertIn("--verbose", redacted)
        self.assertIn("safe value", redacted)
        self.assertEqual(redacted.count(REDACTED), 2)

    def test_redacts_additional_provider_token_families(self) -> None:
        tokens = (
            "glpat-" + "a" * 24,
            "npm_" + "b" * 24,
            "pypi-" + "c" * 24,
            "sk-" + "d" * 24,
            "GOCSPX-" + "e" * 24,
        )
        redacted = redact_text(" ".join(tokens))

        for token in tokens:
            self.assertNotIn(token, redacted)
        self.assertEqual(redacted.count(REDACTED), len(tokens))

    def test_redacts_complete_and_truncated_private_keys(self) -> None:
        complete = (
            "-----BEGIN OPENSSH PRIVATE KEY-----\n"
            "private-material\n"
            "-----END OPENSSH PRIVATE KEY-----"
        )
        truncated = "prefix\n-----BEGIN PRIVATE KEY-----\nprivate-material"

        self.assertEqual(redact_text(complete), REDACTED)
        self.assertEqual(redact_text(truncated), f"prefix\n{REDACTED}")

    def test_redacts_explicit_secret_values_but_ignores_short_canaries(self) -> None:
        text = "value=long-secret-value marker=abc"
        redacted = redact_text_with_values(
            text,
            ("long-secret-value", "abc"),
        )

        self.assertNotIn("long-secret-value", redacted)
        self.assertIn("marker=abc", redacted)

    def test_redacts_encoded_explicit_secret_representations(self) -> None:
        secret = 'client:secret value/"quoted"'
        encoded_variants = (
            quote(secret, safe=""),
            quote_plus(secret, safe=""),
            quote(secret, safe="").lower(),
            quote(quote(secret, safe=""), safe=""),
            json.dumps(secret)[1:-1],
            json.dumps(secret)[1:-1].replace("/", r"\/"),
            b64encode(secret.encode()).decode(),
        )

        for encoded in encoded_variants:
            with self.subTest(encoded=encoded):
                redacted = redact_text_with_values(
                    f"evidence={encoded}",
                    (secret,),
                )
                self.assertNotIn(encoded, redacted)
                self.assertIn(REDACTED, redacted)

    def test_redacts_overlapping_explicit_secrets_longest_first(self) -> None:
        redacted = redact_text_with_values(
            "credential=abcdefgh",
            ("abcd", "abcdefgh"),
        )

        self.assertEqual(redacted, f"credential={REDACTED}")

    def test_redaction_is_idempotent(self) -> None:
        text = (
            "Authorization: Bearer abc.def.ghi "
            "password=secret-value"
        )
        once = redact_text(text)

        self.assertEqual(redact_text(once), once)

    def test_redaction_is_idempotent_for_typed_source_fragments(self) -> None:
        text = (
            "fn openai_headers(api_key: &str) -> HeaderMap {\n"
            "pub fn get_hidden_models(token: &str, provider_id: &str) {}\n"
            "client --api-key provider-secret-value --verbose"
        )
        once = redact_text(text)

        self.assertEqual(redact_text(once), once)
        self.assertNotIn("]]", once)

    def test_redacts_unquoted_secret_with_punctuation(self) -> None:
        redacted = redact_text("password=alpha,beta;gamma next=safe")

        self.assertNotIn("alpha,beta;gamma", redacted)
        self.assertIn("next=safe", redacted)

    def test_preserves_framework_dom_key_attributes(self) -> None:
        # Painted page-source evidence carries UI framework and data-* attributes
        # whose bare "key" token only tails a larger hyphen/dot identifier. These
        # hold opaque UI identifiers (tab groups, cssinjs cache keys), never
        # credentials, and must stay byte-identical so the evidence audit does
        # not raise a false secret-bypass conflict.
        dom = (
            '<style data-rc-order="prepend" rc-util-key="rc-util-ltr"></style>'
            '<div data-group-key="general" data-pt-secondary-tab="general"></div>'
            '<div data-section-key="network"></div>'
            '<span data-group-key="federation"></span>'
        )

        self.assertEqual(redact_text(dom), dom)

    def test_redacts_standalone_credential_inside_dom_but_keeps_data_attrs(self) -> None:
        dom = (
            '<html><body>password=dom-leak-secret'
            '<div data-group-key="general"></div></body></html>'
        )
        redacted = redact_text(dom)

        self.assertNotIn("dom-leak-secret", redacted)
        self.assertIn(REDACTED, redacted)
        self.assertIn('data-group-key="general"', redacted)

    def test_compound_sensitive_names_redact_while_bare_suffixes_do_not(self) -> None:
        # Enumerated compound names stay sensitive across separators even though
        # bare tokens no longer match as hyphen/dot suffixes.
        redacted = redact_text(
            'api.key="alpha" api-key=bravo client-secret=charlie '
            'data-group-key=general rc-util-key=cache'
        )

        self.assertNotIn("alpha", redacted)
        self.assertNotIn("bravo", redacted)
        self.assertNotIn("charlie", redacted)
        self.assertIn('data-group-key=general', redacted)
        self.assertIn('rc-util-key=cache', redacted)

    def test_preserves_object_storage_key_query_parameters(self) -> None:
        # A bare "key" query parameter is the object-storage object identifier
        # (resource path), not a credential. It must survive in media URLs that
        # appear in painted DOM evidence.
        urls = (
            "http://station.test:18080/sub-oss/file?key=2026/07/30/object.png",
            "https://station.test/sub-oss/file?key=avatars%2Falice.png",
            'url(&quot;self/sub-oss/file?key=cas%2Faa%2Fimage&quot;)',
            '<img src="https://h/sub-oss/file?key=2026/x.png&owner=did:alice">',
        )

        for url in urls:
            with self.subTest(url=url):
                self.assertEqual(redact_text(url), url)

    def test_redacts_url_credentials_alongside_object_key(self) -> None:
        text = (
            "https://p.test/callback?code=authorization-code"
            "&access_token=frag-token&key=2026/07/30/object.png&safe=value"
        )
        redacted = redact_text(text)

        self.assertNotIn("authorization-code", redacted)
        self.assertNotIn("frag-token", redacted)
        self.assertIn("key=2026/07/30/object.png", redacted)
        self.assertIn("safe=value", redacted)


class ArtifactRedactionTests(unittest.TestCase):
    def test_redacts_structured_json_and_reports_change(self) -> None:
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

    def test_replaces_binary_artifact_when_explicit_secret_is_present(self) -> None:
        redacted, changed = redact_artifact_bytes(
            b"\x00\xffsecret-canary\x80",
            ("secret-canary",),
        )

        self.assertTrue(changed)
        self.assertEqual(redacted, f"{REDACTED}\n".encode())

    def test_replaces_binary_artifact_with_encoded_explicit_secret(self) -> None:
        secret = "client:secret"
        encoded_secret = b64encode(secret.encode())
        redacted, changed = redact_artifact_bytes(
            b"\x00\xff" + encoded_secret + b"\x80",
            (secret,),
        )

        self.assertTrue(changed)
        self.assertEqual(redacted, f"{REDACTED}\n".encode())

    def test_redacts_explicit_secret_embedded_in_mapping_key(self) -> None:
        secret = "secret-map-key"
        payload = json.dumps({secret: "value"}).encode()

        redacted, changed = redact_artifact_bytes(payload, (secret,))
        decoded = json.loads(redacted)

        self.assertTrue(changed)
        self.assertEqual(decoded, {REDACTED: REDACTED})

    def test_plain_text_artifact_redaction_is_idempotent(self) -> None:
        secret = "provider-secret-value"
        payload = (
            "fn openai_headers(api_key: &str) -> HeaderMap {\n"
            f"authorization=Bearer {secret}\n"
        ).encode()

        once, first_changed = redact_artifact_bytes(payload, (secret,))
        twice, second_changed = redact_artifact_bytes(once, (secret,))

        self.assertTrue(first_changed)
        self.assertFalse(second_changed)
        self.assertEqual(twice, once)
        self.assertNotIn(secret.encode(), once)

    def test_preserves_binary_artifact_without_explicit_secret(self) -> None:
        payload = b"\x00\xff\x80"
        redacted, changed = redact_artifact_bytes(payload)

        self.assertFalse(changed)
        self.assertEqual(redacted, payload)

    def test_painted_dom_framework_attributes_do_not_flag_artifact(self) -> None:
        # Reproduces the social-cross-station painted page-source evidence: the
        # immutable-writer audit must not treat framework/data-* key attributes
        # as a credential bypass, otherwise the whole run is discarded.
        dom = (
            "<!DOCTYPE html><html><body>"
            '<style data-rc-order="prepend" rc-util-key="rc-util-ltr"></style>'
            '<div data-group-key="general" data-section-key="network"></div>'
            '<span data-group-key="federation"></span>'
            "</body></html>"
        ).encode()

        redacted, changed = redact_artifact_bytes(dom)

        self.assertFalse(changed)
        self.assertEqual(redacted, dom)

    def test_painted_dom_media_object_key_urls_do_not_flag_artifact(self) -> None:
        # Moments avatars and post media render as object-storage URLs whose
        # bare "key" parameter is a resource path, not a credential.
        dom = (
            "<!DOCTYPE html><html><body>"
            '<img src="http://station.test:18080/sub-oss/file?key=2026/07/30/a.png">'
            '<img src="https://station.test/sub-oss/file?key=avatars%2Falice.png">'
            "</body></html>"
        ).encode()

        redacted, changed = redact_artifact_bytes(dom)

        self.assertFalse(changed)
        self.assertEqual(redacted, dom)


if __name__ == "__main__":
    unittest.main()
