from __future__ import annotations

import base64
import json
import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import quote, quote_plus


REDACTED = "[REDACTED]"
_SAFE_REFERENCE_SUFFIXES = (
    "_ref",
    "_refs",
    "_reference",
    "_references",
)
_SAFE_EXACT_KEYS = frozenset(
    {
        "cache_tokens",
        "context_tokens",
        "error_key",
        "fence_token",
        "fencing_token",
        "has_token_accounting",
        "idempotency_key_hash",
        "input_tokens",
        "locale_key",
        "max_input_tokens",
        "max_output_tokens",
        "output_tokens",
        "process_port_secret_canary",
        "public_key",
        "public_keys",
        "reasoning_tokens",
        "resource_key",
        "runtime_tuple_key",
        "scenario_key",
        "secret_leak_count",
        "token_accounting_present",
        "token_usage",
        "tool_definition_tokens",
    }
)
_SENSITIVE_KEY_TOKENS = frozenset(
    {
        "auth",
        "authorization",
        "bearer",
        "cookie",
        "cookies",
        "credential",
        "credentials",
        "dsn",
        "jwt",
        "key",
        "keys",
        "mnemonic",
        "nonce",
        "otp",
        "passphrase",
        "passwd",
        "password",
        "passwords",
        "secret",
        "secrets",
        "token",
        "tokens",
        "totp",
    }
)
_SENSITIVE_KEY_PHRASES = tuple(
    sorted(
        {
            "api_key",
            "auth_code",
            "callback_code",
            "code_verifier",
            "connection_string",
            "database_url",
            "mfa_code",
            "oauth_code",
            "recovery_code",
            "seed_phrase",
            *(
                f"{qualifier}_key"
                for qualifier in (
                    "access",
                    "client",
                    "encryption",
                    "private",
                    "refresh",
                    "secret",
                    "session",
                    "signing",
                )
            ),
            *(
                f"{qualifier}_token"
                for qualifier in (
                    "access",
                    "auth",
                    "id",
                    "oauth",
                    "refresh",
                    "session",
                )
            ),
            *(
                f"{qualifier}_secret"
                for qualifier in ("client", "signing", "webhook")
            ),
        }
    )
)
_SENSITIVE_ASSIGNMENT_FIELDS = tuple(
    sorted(_SENSITIVE_KEY_TOKENS | frozenset(_SENSITIVE_KEY_PHRASES))
)


def _field_pattern(name: str) -> str:
    separator = r"(?:[._\-\s]|%2d|%2e|%5f)*"
    return separator.join(re.escape(part) for part in name.split("_"))


_SENSITIVE_FIELD_PATTERN = "|".join(
    _field_pattern(name)
    for name in sorted(_SENSITIVE_ASSIGNMENT_FIELDS, key=len, reverse=True)
)
_REDACTED_VALUE_PATTERN = re.escape(REDACTED)
_URL_QUERY_FIELD_PATTERN = "|".join(
    _field_pattern(name)
    for name in sorted(
        {
            *_SENSITIVE_ASSIGNMENT_FIELDS,
            "code",
            "sig",
            "signature",
            "state",
            "x_amz_credential",
            "x_amz_security_token",
            "x_amz_signature",
        },
        key=len,
        reverse=True,
    )
)
_SENSITIVE_ASSIGNMENT = re.compile(
    rf"(?i)(?P<prefix>(?<![\w])[\"']?(?:{_SENSITIVE_FIELD_PATTERN})"
    rf"[\"']?\s*[:=]\s*)"
    rf"(?P<value>{_REDACTED_VALUE_PATTERN}|"
    r"\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|[^\s}\]]+)"
)
_SENSITIVE_COMMAND_FLAG = re.compile(
    rf"(?i)(?P<prefix>(?<![\w])--?(?:{_SENSITIVE_FIELD_PATTERN})\s+)"
    rf"(?P<value>{_REDACTED_VALUE_PATTERN}|"
    r"\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|[^\s}\]]+)"
)
_SENSITIVE_LINE_ASSIGNMENT = re.compile(
    rf"(?im)(?P<prefix>^\s*(?:{_SENSITIVE_FIELD_PATTERN})\s+)"
    rf"(?P<value>{_REDACTED_VALUE_PATTERN}|"
    r"\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|[^\r\n]+)"
)
_AUTHORIZATION_HEADER = re.compile(
    r"(?im)(\b(?:proxy[-_\s]?authorization|authorization)\s*[:=]\s*)[^\r\n]+"
)
_COOKIE_HEADER = re.compile(
    r"(?im)(\b(?:set-cookie|cookie)\s*[:=]\s*)[^\r\n]+"
)
_BEARER_TOKEN = re.compile(r"(?i)(\bbearer\s+)[^\s,;}\]]+")
_URI_CREDENTIAL = re.compile(
    r"(?i)(\b[a-z][a-z0-9+.-]*://[^:/\s@]+:)([^@\s/]+)(?=@)"
)
_URL_QUERY_SECRET = re.compile(
    rf"(?i)([?&#](?:{_URL_QUERY_FIELD_PATTERN})=)[^&#\s]+"
)
_PRIVATE_KEY = re.compile(
    r"-----BEGIN [^-]*PRIVATE KEY-----.*?"
    r"(?:-----END [^-]*PRIVATE KEY-----|$)",
    re.IGNORECASE | re.DOTALL,
)
_KNOWN_SECRET_TOKEN = re.compile(
    r"(?<![A-Za-z0-9])(?:"
    r"github_pat_[A-Za-z0-9_]{20,}|"
    r"gh[pousr]_[A-Za-z0-9]{20,}|"
    r"glpat-[A-Za-z0-9_-]{20,}|"
    r"GOCSPX-[A-Za-z0-9_-]{20,}|"
    r"npm_[A-Za-z0-9]{20,}|"
    r"pypi-[A-Za-z0-9_-]{20,}|"
    r"AKIA[0-9A-Z]{16}|"
    r"AIza[0-9A-Za-z_-]{35}|"
    r"xox[baprs]-[A-Za-z0-9-]{10,}|"
    r"sk-[A-Za-z0-9_-]{20,}|"
    r"sk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"
    r")(?![A-Za-z0-9])"
)


def _camel_to_snake(name: str) -> str:
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def is_sensitive_key(key: object) -> bool:
    normalized = re.sub(
        r"[^a-z0-9]+",
        "_",
        _camel_to_snake(str(key).strip()),
    ).strip("_")
    if normalized in _SAFE_EXACT_KEYS:
        return False
    if normalized.endswith(_SAFE_REFERENCE_SUFFIXES):
        return False
    tokens = frozenset(filter(None, normalized.split("_")))
    if tokens & _SENSITIVE_KEY_TOKENS:
        return True
    padded = f"_{normalized}_"
    compact = normalized.replace("_", "")
    return any(
        f"_{phrase}_" in padded or compact == phrase.replace("_", "")
        for phrase in _SENSITIVE_KEY_PHRASES
    )


def _redact_assignment(match: re.Match[str]) -> str:
    value = match.group("value")
    if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
        replacement = f"{value[0]}{REDACTED}{value[-1]}"
    else:
        replacement = REDACTED
    return f"{match.group('prefix')}{replacement}"


def redact_text(text: str) -> str:
    redacted = _PRIVATE_KEY.sub(REDACTED, text)
    redacted = _AUTHORIZATION_HEADER.sub(rf"\1{REDACTED}", redacted)
    redacted = _COOKIE_HEADER.sub(rf"\1{REDACTED}", redacted)
    redacted = _BEARER_TOKEN.sub(rf"\1{REDACTED}", redacted)
    redacted = _URI_CREDENTIAL.sub(rf"\1{REDACTED}", redacted)
    redacted = _URL_QUERY_SECRET.sub(rf"\1{REDACTED}", redacted)
    redacted = _KNOWN_SECRET_TOKEN.sub(REDACTED, redacted)
    redacted = _SENSITIVE_COMMAND_FLAG.sub(_redact_assignment, redacted)
    redacted = _SENSITIVE_LINE_ASSIGNMENT.sub(_redact_assignment, redacted)
    return _SENSITIVE_ASSIGNMENT.sub(_redact_assignment, redacted)


def redact_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            redact_text(str(key)): (
                item
                if is_sensitive_key(key) and isinstance(item, bool)
                else REDACTED
                if is_sensitive_key(key)
                else redact_value(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, tuple):
        return [redact_value(item) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return REDACTED
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return redact_text(str(value))


def _secret_representations(secret_values: tuple[str, ...]) -> tuple[str, ...]:
    representations: set[str] = set()
    for secret in secret_values:
        if len(secret) < 4:
            continue
        encoded = secret.encode("utf-8")
        percent_encoded = quote(secret, safe="")
        plus_encoded = quote_plus(secret, safe="")
        representations.update(
            {
                secret,
                percent_encoded,
                plus_encoded,
                re.sub(
                    r"%[0-9A-F]{2}",
                    lambda match: match.group(0).lower(),
                    percent_encoded,
                ),
                re.sub(
                    r"%[0-9A-F]{2}",
                    lambda match: match.group(0).lower(),
                    plus_encoded,
                ),
                quote(percent_encoded, safe=""),
                quote(plus_encoded, safe=""),
                json.dumps(secret, ensure_ascii=True)[1:-1],
                json.dumps(secret, ensure_ascii=True)[1:-1].replace("/", r"\/"),
                base64.b64encode(encoded).decode("ascii"),
                base64.urlsafe_b64encode(encoded).decode("ascii"),
                base64.urlsafe_b64encode(encoded).decode("ascii").rstrip("="),
            }
        )
    representations.discard("")
    representations.discard(REDACTED)
    return tuple(sorted(representations, key=len, reverse=True))


def redact_text_with_values(text: str, secret_values: tuple[str, ...]) -> str:
    redacted = redact_text(text)
    for representation in _secret_representations(secret_values):
        redacted = redacted.replace(representation, REDACTED)
    return redacted


def redact_value_with_values(
    value: Any,
    secret_values: tuple[str, ...],
) -> Any:
    redacted = redact_value(value)
    if isinstance(redacted, dict):
        return {
            redact_text_with_values(str(key), secret_values):
                redact_value_with_values(item, secret_values)
            for key, item in redacted.items()
        }
    if isinstance(redacted, list):
        return [
            redact_value_with_values(item, secret_values)
            for item in redacted
        ]
    if isinstance(redacted, str):
        return redact_text_with_values(redacted, secret_values)
    return redacted


def redact_artifact_bytes(
    value: bytes,
    secret_values: tuple[str, ...] = (),
) -> tuple[bytes, bool]:
    explicit_secrets = tuple(
        representation.encode("utf-8")
        for representation in _secret_representations(secret_values)
    )
    explicit_leak = any(secret in value for secret in explicit_secrets)
    try:
        original = value.decode("utf-8")
    except UnicodeDecodeError:
        if explicit_leak:
            return f"{REDACTED}\n".encode("utf-8"), True
        return value, False

    try:
        structured = json.loads(original)
    except json.JSONDecodeError:
        structured = None
    else:
        redacted_val = redact_value_with_values(structured, secret_values)
        if redacted_val != structured:
            encoded = (
                json.dumps(redacted_val, indent=2, sort_keys=True, default=str)
                + "\n"
            ).encode("utf-8")
            return encoded, True
        return value, False

    redacted = redact_text_with_values(original, secret_values)
    encoded = redacted.encode("utf-8")
    return encoded, encoded != value
