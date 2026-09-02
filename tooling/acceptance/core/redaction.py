from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any


REDACTED = "[REDACTED]"
SENSITIVE_KEY_PARTS = (
    "api_key",
    "authorization",
    "bearer",
    "credential",
    "password",
    "passwd",
    "private_key",
    "secret",
    "session_token",
    "token",
)

_SENSITIVE_ASSIGNMENT = re.compile(
    r"(?i)(\b(?:api[_-]?key|authorization|credential|password|passwd|"
    r"private[_-]?key|secret|session[_-]?token|token)\b\s*[:=]\s*)"
    r"([\"']?)([^\"'\s,;}\]]+)([\"']?)"
)
_BEARER_TOKEN = re.compile(r"(?i)(\bbearer\s+)[A-Za-z0-9._~+/=-]+")
_PRIVATE_KEY = re.compile(
    r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----",
    re.DOTALL,
)


def _camel_to_snake(name: str) -> str:
    import re
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def is_sensitive_key(key: object) -> bool:
    normalized = _camel_to_snake(str(key).strip().replace("-", "_"))
    if normalized.endswith(
        ("_ref", "_refs", "_reference", "_references")
    ):
        return False
    return any(part in normalized for part in SENSITIVE_KEY_PARTS)


def redact_text(text: str) -> str:
    redacted = _BEARER_TOKEN.sub(rf"\1{REDACTED}", text)
    redacted = _PRIVATE_KEY.sub(REDACTED, redacted)
    return _SENSITIVE_ASSIGNMENT.sub(
        lambda match: f"{match.group(1)}{match.group(2)}{REDACTED}{match.group(4)}",
        redacted,
    )


def redact_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): (
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
    return value


def redact_text_with_values(text: str, secret_values: tuple[str, ...]) -> str:
    redacted = redact_text(text)
    for secret in secret_values:
        if len(secret) >= 4:
            redacted = redacted.replace(secret, REDACTED)
    return redacted


def redact_value_with_values(
    value: Any,
    secret_values: tuple[str, ...],
) -> Any:
    redacted = redact_value(value)
    if isinstance(redacted, dict):
        return {
            key: redact_value_with_values(item, secret_values)
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
        secret.encode("utf-8")
        for secret in secret_values
        if len(secret) >= 4
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
