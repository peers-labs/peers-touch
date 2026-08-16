from __future__ import annotations

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
    if normalized.endswith("_ref") or normalized.endswith("_refs") or "reference" in normalized:
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
            str(key): REDACTED if is_sensitive_key(key) else redact_value(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, tuple):
        return [redact_value(item) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    return value
