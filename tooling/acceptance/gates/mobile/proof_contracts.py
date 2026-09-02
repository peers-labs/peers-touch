#!/usr/bin/env python3
"""Typed contracts and source guards for Mobile native OAuth proof.

This module deliberately uses only the Python standard library. Producers call
``validate_contract_payload`` before handing redacted values to Acceptance
Core. The CLI owns the E2-0 source-policy checks; it performs no runtime or
Evidence Store writes.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Mapping, Sequence

from tooling.acceptance.core import ArtifactRef as CoreArtifactRef
from tooling.acceptance.core import EvidenceError
from tooling.acceptance.core import workspace_id as evidence_workspace_id

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10 and earlier.
    import tomli as tomllib


REPO_ROOT = Path(__file__).resolve().parents[4]
SCHEMA_PATH = Path(__file__).with_name("proof-contract.schema.json")
GATE_ID = "mobile-native-access-e2e"

PLATFORMS = ("ios", "android")
PROVIDERS = ("github", "google")
CLIENTS = ("alice-ios", "bob-ios", "alice-android", "bob-android")
SERVICES = ("station-primary", "station-secondary")
VARIANTS = (
    "success-ios-github",
    "success-ios-google",
    "success-android-github",
    "success-android-google",
    "cancel-ios",
    "cancel-android",
    "following-gate-ios",
    "following-gate-android",
    "expiry-ios",
    "expiry-android",
    "replay-ios",
    "replay-android",
    "provider-mismatch-ios",
    "provider-mismatch-android",
    "station-mismatch-ios",
    "station-mismatch-android",
)
VARIANT_CLIENT = {
    "success-ios-github": "alice-ios",
    "success-ios-google": "bob-ios",
    "success-android-github": "bob-android",
    "success-android-google": "alice-android",
    "cancel-ios": "alice-ios",
    "cancel-android": "alice-android",
    "following-gate-ios": "alice-ios",
    "following-gate-android": "alice-android",
    "expiry-ios": "alice-ios",
    "expiry-android": "alice-android",
    "replay-ios": "alice-ios",
    "replay-android": "alice-android",
    "provider-mismatch-ios": "alice-ios",
    "provider-mismatch-android": "alice-android",
    "station-mismatch-ios": "alice-ios",
    "station-mismatch-android": "alice-android",
}
CLIENT_SERVICE = {
    "alice-ios": "station-primary",
    "bob-ios": "station-secondary",
    "alice-android": "station-primary",
    "bob-android": "station-secondary",
}
CLIENT_PLATFORM = {
    "alice-ios": "ios",
    "bob-ios": "ios",
    "alice-android": "android",
    "bob-android": "android",
}
CLIENT_PROVIDER = {
    "alice-ios": "github",
    "bob-ios": "google",
    "alice-android": "google",
    "bob-android": "github",
}
PROVIDER_CLIENTS = {
    provider: frozenset(
        client_id
        for client_id, client_provider in CLIENT_PROVIDER.items()
        if client_provider == provider
    )
    for provider in PROVIDERS
}
NEGATIVE_OPERATION_FAILURE = {
    "replay": "oauthReplay",
    "provider_mismatch": "oauthProviderMismatch",
    "station_mismatch": "oauthStationMismatch",
}
LEASE_FAILURE_CODES = frozenset(
    {
        "LEASE_FENCE_STALE",
        "LEASE_HEARTBEAT_EXPIRED",
        "LEASE_DEVICE_DISCONNECTED",
        "LEASE_SIMULATOR_DETECTED",
        "LEASE_PLATFORM_MISMATCH",
        "LEASE_IDENTITY_MISMATCH",
        "LEASE_BASELINE_RESTORE_FAILED",
        "LEASE_CLEANUP_FAILED",
        "LEASE_OPERATION_INCOMPLETE",
    }
)

ACCEPTED_ARTIFACT_KINDS = frozenset(
    {
        "mobile-fresh-install-trace",
        "mobile-installed-build-identity",
        "mobile-lease-outcome",
        "mobile-oauth-fixture-lease",
        "mobile-oauth-fixture-operation",
        "mobile-oauth-negative-callback-intent",
        "physical-device-lease",
        "station-oauth-proof-snapshot",
        "provider-account-lease",
        "provider-identity-assertion",
        "provider-browser-session-lease",
        "mobile-application-build-attestation",
    }
)
ROLE_PAYLOAD_KINDS = {
    "mobile-proof-contract-catalog": "mobile-proof-contract-catalog",
    "mobile-build-attestation": "mobile-application-build-attestation",
    "provider-account-lease": "provider-account-lease",
    "provider-identity-assertion": "provider-identity-assertion",
    "physical-device-lease": "physical-device-lease",
    "provider-browser-session-lease": "provider-browser-session-lease",
    "mobile-oauth-fixture-lease": "mobile-oauth-fixture-lease",
    "mobile-oauth-fixture-operation": "mobile-oauth-fixture-operation",
    "mobile-fresh-install-trace": "mobile-fresh-install-trace",
    "mobile-installed-build-identity": "mobile-installed-build-identity",
    "mobile-visible-proof": "mobile-visible-proof",
    "station-oauth-proof-snapshot": "station-oauth-proof-snapshot",
    "mobile-secure-storage-absence": "mobile-secure-storage-absence",
    "provider-correlation-channel-destruction": (
        "provider-correlation-channel-destruction"
    ),
    "station-post-cleanup-proof": "station-oauth-proof-snapshot",
    "mobile-lease-outcome": "mobile-lease-outcome",
    "mobile-redaction-audit": "mobile-redaction-audit",
    "mobile-native-lifecycle": "mobile-native-lifecycle",
    "mobile-native-result": "mobile-native-result",
}

# Frozen at the accepted E2-0 source inventory. The tree digest includes every
# non-symlink file under model/domain with its repository-relative path.
FROZEN_PROTECTED_BASELINE = {
    "model/domain": "30b813c8c81b963870332b4346ef4444995af1e84fc5f1d936a017b097fa418d",
    "pnpm-lock.yaml": "8f8577c49ef1fccc3031acb2169c0f63ce69aabfef1861e8241b848b77af3b72",
    "apps/mobile/src-tauri/Cargo.lock": (
        "7c9761ed5f2bbcae34b62029374cb0372103f30bd78a2625e0258950d61275c4"
    ),
    "packages/messaging-core/Cargo.lock": (
        "f2b7daeff27d8dc1956a1e1e9c88cac5bb12e7cd3f6acdb6e0a03fb8d4d15e3f"
    ),
}
FROZEN_VERSION_POLICY_DIGEST = (
    "7ce6a7472f3810d1bedb3b1bdd0b3584e36a32caed0e7f19ff8f6e5e35de4042"
)

FORBIDDEN_FIELD_NAMES = frozenset(
    {
        "password",
        "passphrase",
        "mfa",
        "mfacode",
        "otp",
        "cookie",
        "cookies",
        "browserstorage",
        "localstorage",
        "sessionstorage",
        "providerusername",
        "provideremail",
        "providersubject",
        "providersubjectid",
        "callbackurl",
        "authorizationurl",
        "authorizeurl",
        "callbackcode",
        "authorizationcode",
        "pkce",
        "pkceverifier",
        "pkcechallenge",
        "codeverifier",
        "codechallenge",
        "nonce",
        "attemptsecret",
        "accesstoken",
        "refreshtoken",
        "bearertoken",
        "token",
        "envelopeciphertext",
        "privatekey",
        "privatekeypem",
        "artifactpath",
        "absolutepath",
        "udid",
        "serial",
        "deviceserial",
        "certificatesubject",
        "provisioningprofile",
        "schemaversion",
        "schemarevision",
        "protocolversion",
        "protocolrevision",
    }
)
FORBIDDEN_VALUE_PATTERNS = (
    (
        "bare OAuth secret",
        re.compile(r"(?i)^\s*(?:code|state|pkce|nonce|token|cookie)\s*$"),
    ),
    (
        "OAuth secret parameter",
        re.compile(
            r"(?i)\b(?:(?:callback[_-]?)?(?:code|state)|authorization[_-]?code|"
            r"code[_-]?(?:verifier|challenge)|pkce|nonce|attempt[_-]?secret|"
            r"(?:access|refresh)?[_-]?token|cookie|provider[_-]?subject)"
            r"\s*[:=]\s*[^\s,;]+"
        ),
    ),
    (
        "cookie credential",
        re.compile(r"(?i)\bcookie\s*:\s*[^\r\n]+"),
    ),
    (
        "device identifier",
        re.compile(r"(?i)\b(?:udid|device[_-]?serial)\s*[:=]\s*[^\s,;]+"),
    ),
    (
        "certificate subject",
        re.compile(
            r"(?i)(?:\bcertificate[_-]?subject\s*[:=]\s*[^\r\n]+|"
            r"^\s*(?:CN|OU|O|L|ST|C)=[^,\r\n]+(?:,\s*(?:CN|OU|O|L|ST|C)=[^,\r\n]+)*)"
        ),
    ),
    ("email", re.compile(r"(?i)(?<![a-z0-9._%+-])[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}")),
    ("bearer credential", re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=-]{8,}")),
    ("private key", re.compile(r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----")),
    (
        "OAuth URL",
        re.compile(
            r"(?i)https?://\S*(?:[?&](?:code|state|token|nonce|code_verifier)=)"
        ),
    ),
    (
        "JWT-like credential",
        re.compile(r"\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b"),
    ),
    (
        "absolute path",
        re.compile(r"(?:^|[\s\"'])(?:/(?!/)|[A-Za-z]:[\\/])"),
    ),
    (
        "provider subject",
        re.compile(r"(?i)^\s*provider[-_ ]?subject(?:[-_:= ].*)?$"),
    ),
    (
        "physical device identifier",
        re.compile(
            r"^\s*(?:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}|"
            r"(?=[A-Z0-9]{10,16}\s*$)(?=[A-Z0-9]*[A-Z])"
            r"(?=[A-Z0-9]*[0-9])[A-Z0-9]{10,16})\s*$"
        ),
    ),
)
SAFE_REDACTION_SENTINELS = frozenset({"bearer disabled", "cookie: absent"})


class ProofContractError(ValueError):
    """A typed Mobile proof contract or source policy failed closed."""


@dataclass(frozen=True)
class ArtifactRole:
    name: str
    path_template: str
    cardinality: int | None = None
    minimum_cardinality: int | None = None
    dimensions: Mapping[str, tuple[str, ...]] | None = None


@dataclass(frozen=True)
class ArtifactRecord:
    role: str
    path: str
    payload: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class CutoverMatch:
    match_class: str
    path: str
    line: int
    disposition: str
    owner: str


@dataclass(frozen=True)
class CutoverRule:
    match_class: str
    pattern: re.Pattern[str]
    roots: tuple[str, ...]
    replace_paths: tuple[str, ...]
    retained_paths: tuple[str, ...] = ()
    owner: str = "E2-5"


def _load_schema(path: Path = SCHEMA_PATH) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProofContractError(f"cannot load proof contract schema {path}: {error}") from error
    if not isinstance(value, dict):
        raise ProofContractError("proof contract schema root must be an object")
    policy = value.get("x-peers-contract-policy")
    if not isinstance(policy, dict):
        raise ProofContractError("proof contract schema is missing contract policy")
    if policy.get("schemaRevision") is not None or policy.get("protocolRevision") is not None:
        raise ProofContractError(
            "Mobile proof schema/protocol revision must remain unspecified"
        )
    return value


def _type_matches(value: Any, expected: str) -> bool:
    return {
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "boolean": isinstance(value, bool),
        "null": value is None,
    }.get(expected, False)


def _resolve_ref(root_schema: Mapping[str, Any], reference: str) -> Mapping[str, Any]:
    if not reference.startswith("#/"):
        raise ProofContractError(f"external JSON Schema reference is forbidden: {reference}")
    current: Any = root_schema
    for part in reference[2:].split("/"):
        key = part.replace("~1", "/").replace("~0", "~")
        if not isinstance(current, dict) or key not in current:
            raise ProofContractError(f"unresolved JSON Schema reference: {reference}")
        current = current[key]
    if not isinstance(current, dict):
        raise ProofContractError(f"JSON Schema reference is not an object: {reference}")
    return current


def _validate_schema_value(
    value: Any,
    schema: Mapping[str, Any],
    root_schema: Mapping[str, Any],
    path: str,
) -> None:
    if not schema:
        return
    all_of = schema.get("allOf")
    if isinstance(all_of, list):
        for candidate in all_of:
            if isinstance(candidate, Mapping):
                _validate_schema_value(value, candidate, root_schema, path)
    one_of = schema.get("oneOf")
    if isinstance(one_of, list):
        matches = 0
        for candidate in one_of:
            if not isinstance(candidate, Mapping):
                continue
            try:
                _validate_schema_value(value, candidate, root_schema, path)
            except ProofContractError:
                continue
            matches += 1
        if matches != 1:
            raise ProofContractError(f"{path} must match exactly one schema")
    condition = schema.get("if")
    if isinstance(condition, Mapping):
        try:
            _validate_schema_value(value, condition, root_schema, path)
        except ProofContractError:
            alternate = schema.get("else")
            if isinstance(alternate, Mapping):
                _validate_schema_value(value, alternate, root_schema, path)
        else:
            consequence = schema.get("then")
            if isinstance(consequence, Mapping):
                _validate_schema_value(value, consequence, root_schema, path)
    negated = schema.get("not")
    if isinstance(negated, Mapping):
        try:
            _validate_schema_value(value, negated, root_schema, path)
        except ProofContractError:
            pass
        else:
            raise ProofContractError(f"{path} matches a forbidden schema")
    if "$ref" in schema:
        referenced_schema = _resolve_ref(root_schema, str(schema["$ref"]))
        _validate_schema_value(value, referenced_schema, root_schema, path)
        return
    if "const" in schema and value != schema["const"]:
        raise ProofContractError(f"{path} must equal {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        raise ProofContractError(f"{path} has unsupported value {value!r}")
    expected_type = schema.get("type")
    if isinstance(expected_type, str) and not _type_matches(value, expected_type):
        raise ProofContractError(f"{path} must be {expected_type}")
    if isinstance(value, str) and len(value) < int(schema.get("minLength", 0)):
        raise ProofContractError(f"{path} must not be empty")
    if (
        isinstance(value, str)
        and isinstance(schema.get("pattern"), str)
        and re.fullmatch(str(schema["pattern"]), value) is None
    ):
        raise ProofContractError(f"{path} has invalid format")
    if isinstance(value, int) and "minimum" in schema and value < int(schema["minimum"]):
        raise ProofContractError(f"{path} must be at least {schema['minimum']}")
    if isinstance(value, dict):
        required = schema.get("required", ())
        if isinstance(required, list):
            missing = sorted(str(key) for key in required if key not in value)
            if missing:
                raise ProofContractError(f"{path} is missing required fields: {missing}")
        properties = schema.get("properties", {})
        if not isinstance(properties, dict):
            raise ProofContractError(f"{path} schema properties must be an object")
        if schema.get("additionalProperties") is False:
            unknown = sorted(set(value) - set(properties))
            if unknown:
                raise ProofContractError(f"{path} has unknown fields: {unknown}")
        for key, item in value.items():
            child_schema = properties.get(key)
            if isinstance(child_schema, dict):
                _validate_schema_value(item, child_schema, root_schema, f"{path}.{key}")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < int(schema["minItems"]):
            raise ProofContractError(f"{path} has too few items")
        if "maxItems" in schema and len(value) > int(schema["maxItems"]):
            raise ProofContractError(f"{path} has too many items")
        if schema.get("uniqueItems"):
            canonical = [json.dumps(item, sort_keys=True, separators=(",", ":")) for item in value]
            if len(canonical) != len(set(canonical)):
                raise ProofContractError(f"{path} must contain unique items")
        prefix_items = schema.get("prefixItems")
        if isinstance(prefix_items, list):
            for index, item_schema in enumerate(prefix_items):
                if index < len(value) and isinstance(item_schema, dict):
                    _validate_schema_value(
                        value[index], item_schema, root_schema, f"{path}[{index}]"
                    )
            if schema.get("items") is False and len(value) > len(prefix_items):
                raise ProofContractError(f"{path} has unexpected trailing items")
        elif isinstance(schema.get("items"), dict):
            for index, item in enumerate(value):
                _validate_schema_value(
                    item, schema["items"], root_schema, f"{path}[{index}]"
                )


def _kind_schema(schema: Mapping[str, Any], artifact_kind: str) -> Mapping[str, Any]:
    definitions = schema.get("$defs")
    if not isinstance(definitions, dict):
        raise ProofContractError("proof contract schema has no definitions")
    for definition in definitions.values():
        if not isinstance(definition, dict):
            continue
        properties = definition.get("properties")
        if not isinstance(properties, dict):
            continue
        kind = properties.get("artifactKind")
        if isinstance(kind, dict) and kind.get("const") == artifact_kind:
            return definition
    raise ProofContractError(f"unknown Mobile proof artifact kind: {artifact_kind!r}")


def _normalized_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def validate_redaction(value: Any, *, durable: bool = True, path: str = "$") -> None:
    """Reject secret/PII fields and recognizable secret values recursively."""

    if isinstance(value, dict):
        for key, item in value.items():
            normalized = _normalized_key(str(key))
            if normalized in FORBIDDEN_FIELD_NAMES:
                raise ProofContractError(f"{path}.{key} is forbidden in proof payloads")
            if (
                durable
                and normalized == "callbackreplayhandle"
                and isinstance(item, str)
                and item
            ):
                raise ProofContractError(
                    f"{path}.{key} is volatile and cannot enter durable evidence"
                )
            validate_redaction(item, durable=durable, path=f"{path}.{key}")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            validate_redaction(item, durable=durable, path=f"{path}[{index}]")
        return
    if isinstance(value, str):
        if value.strip().lower() in SAFE_REDACTION_SENTINELS:
            return
        field_name = _normalized_key(path.rsplit(".", 1)[-1])
        if (
            re.fullmatch(r"[0-9a-fA-F]{40}", value.strip())
            and field_name not in {"sourcecommit", "livecommit"}
            and not path.endswith(".cdHash.valueHex")
        ):
            raise ProofContractError(
                f"{path} contains a forbidden legacy device identifier"
            )
        if (
            re.fullmatch(r"(?i)r(?=[a-z0-9]{9,15}$)(?=[a-z0-9]*[a-z])"
                         r"(?=[a-z0-9]*[0-9])[a-z0-9]+", value.strip())
            and not field_name.endswith(("ref", "reference"))
        ):
            raise ProofContractError(
                f"{path} contains a forbidden physical device identifier"
            )
        for label, pattern in FORBIDDEN_VALUE_PATTERNS:
            if pattern.search(value):
                raise ProofContractError(f"{path} contains forbidden {label} material")


def _parse_utc_timestamp(value: Any, path: str) -> datetime:
    if not isinstance(value, str):
        raise ProofContractError(f"{path} must be an RFC 3339 UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ProofContractError(
            f"{path} must be an RFC 3339 UTC timestamp"
        ) from error
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise ProofContractError(f"{path} must use UTC")
    return parsed


def _validate_active_lease(payload: Mapping[str, Any]) -> None:
    heartbeat = _parse_utc_timestamp(payload["heartbeatAt"], "heartbeatAt")
    renew_before = _parse_utc_timestamp(payload["renewBefore"], "renewBefore")
    expires_at = _parse_utc_timestamp(payload["expiresAt"], "expiresAt")
    if not heartbeat < renew_before < expires_at:
        raise ProofContractError(
            "active lease timestamps must satisfy heartbeatAt < renewBefore < expiresAt"
        )
    inactive_states = {"RELEASED", "QUARANTINED", "CLEANUP_FAILED"}
    if payload["state"] not in inactive_states and expires_at <= datetime.now(timezone.utc):
        raise ProofContractError("active lease expiresAt must be in the future")


def _walk_artifact_refs(value: Any, path: str = "$") -> Iterable[tuple[str, Mapping[str, Any]]]:
    if isinstance(value, dict):
        if value.get("artifactKind") == "acceptance-artifact-ref":
            yield path, value
        for key, item in value.items():
            yield from _walk_artifact_refs(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _walk_artifact_refs(item, f"{path}[{index}]")


def _require_same_run_references(
    payload: Mapping[str, Any],
    expected_run_id: str | None,
    expected_gate_id: str | None,
    expected_workspace_id: str,
) -> None:
    run_id = str(payload.get("runId") or payload.get("holderRunId") or "")
    gate_id = str(payload.get("gateId") or expected_gate_id or "")
    if expected_run_id is not None and run_id != expected_run_id:
        raise ProofContractError(
            f"payload runId {run_id!r} does not match expected run {expected_run_id!r}"
        )
    if expected_gate_id is not None and gate_id != expected_gate_id:
        raise ProofContractError(
            f"payload gateId {gate_id!r} does not match expected Gate {expected_gate_id!r}"
        )
    holder_run_id = payload.get("holderRunId")
    if holder_run_id is not None and run_id and holder_run_id != run_id:
        raise ProofContractError("holderRunId must equal runId")
    for ref_path, reference in _walk_artifact_refs(payload):
        try:
            artifact_ref = CoreArtifactRef.from_dict(reference)
        except EvidenceError as error:
            raise ProofContractError(
                f"{ref_path} is not a valid ArtifactRef: {error}"
            ) from error
        if artifact_ref.run_id != run_id:
            raise ProofContractError(f"{ref_path}.runId crosses proof runs")
        if artifact_ref.gate_id != gate_id:
            raise ProofContractError(f"{ref_path}.gateId crosses Gates")
        if artifact_ref.workspace_id != expected_workspace_id:
            raise ProofContractError(f"{ref_path}.workspaceId crosses worktrees")


def _validate_kind_semantics(payload: Mapping[str, Any], durable: bool) -> None:
    kind = payload["artifactKind"]
    if kind == "mobile-oauth-fixture-lease":
        service_id = payload["serviceId"]
        if service_id not in SERVICES:
            raise ProofContractError("Fixture lease service is not declared")
        expected_resource = f"station/{service_id}/mobile-oauth-fixture"
        if payload["resourceKey"] != expected_resource:
            raise ProofContractError("Fixture lease resource/service binding is invalid")
        if payload["state"] != "LEASED":
            raise ProofContractError(
                "Fixture acquisition artifact must remain LEASED"
            )
        _validate_active_lease(payload)
    elif kind == "mobile-oauth-negative-callback-intent":
        operation = payload["operation"]
        replay_handle = payload["callbackReplayHandle"]
        replay_mode = payload["replayMode"]
        alternate_service = payload["alternateServiceId"]
        if operation == "replay":
            if not replay_handle or replay_mode != "different_after_claim":
                raise ProofContractError(
                    "replay intent requires an opaque callbackReplayHandle and "
                    "replayMode='different_after_claim'"
                )
            if alternate_service:
                raise ProofContractError("replay intent cannot select another Station")
        elif replay_handle or replay_mode:
            raise ProofContractError(
                "only replay intent may carry replay handle metadata"
            )
        if operation == "station_mismatch" and alternate_service not in SERVICES:
            raise ProofContractError(
                "station mismatch intent requires an approved alternateServiceId"
            )
        if operation != "station_mismatch" and alternate_service:
            raise ProofContractError(
                "only station mismatch intent may select an alternate service"
            )
        client_id = payload["clientId"]
        variant_id = payload["variantId"]
        if VARIANT_CLIENT.get(variant_id) != client_id:
            raise ProofContractError("negative callback variant/client binding is invalid")
        expected_operation = variant_id.rsplit("-", 1)[0].replace("-", "_")
        if operation != expected_operation:
            raise ProofContractError("negative callback variant/operation binding is invalid")
        if payload["expectedFailure"] != NEGATIVE_OPERATION_FAILURE[operation]:
            raise ProofContractError("negative callback expectedFailure is invalid")
        required_refs = payload["requiredLeaseRefs"]
        expected_refs = [
            f"physical-device-lease/{client_id}",
            f"provider-account-lease/{CLIENT_PROVIDER[client_id]}",
            f"browser-session-lease/{client_id}",
        ]
        if required_refs != expected_refs:
            raise ProofContractError("negative callback lease bindings are invalid")
        client_service = CLIENT_SERVICE[client_id]
        if operation == "station_mismatch" and alternate_service == client_service:
            raise ProofContractError(
                "station mismatch intent must select the alternate Station"
            )
        if durable and replay_handle:
            raise ProofContractError("callbackReplayHandle cannot enter durable evidence")
    elif kind == "station-oauth-proof-snapshot":
        observation = payload["observation"]
        if observation.get("isolation") != "postgresql-repeatable-read-read-only":
            raise ProofContractError("Station proof must use repeatable-read read-only")
        freshness = observation.get("freshnessSeconds")
        if (
            not isinstance(freshness, int)
            or isinstance(freshness, bool)
            or not 0 <= freshness <= 30
        ):
            raise ProofContractError("Station proof freshnessSeconds must be within 0..30")
        if payload["redaction"].get("status") != "passed":
            raise ProofContractError("Station proof redaction must pass")
        invariants = payload["invariants"]
        required_invariants = (
            "singleConsume",
            "singleCandidate",
            "noEarlyActiveSession",
            "noUnexpectedEnvelope",
        )
        if any(invariants.get(name) is not True for name in required_invariants):
            raise ProofContractError("Station proof invariants must all pass")
        variant_id = payload["variantId"]
        client_id = VARIANT_CLIENT.get(variant_id)
        if client_id is None:
            raise ProofContractError("Station proof variant is not declared")
        service_id = payload["service"]["serviceId"]
        allowed_services = (
            frozenset(SERVICES)
            if variant_id.startswith("station-mismatch-")
            else frozenset({CLIENT_SERVICE[client_id]})
        )
        if service_id not in allowed_services:
            raise ProofContractError("Station proof service/client binding is invalid")
        binding = payload["binding"]
        if binding["deviceAlias"] != client_id:
            raise ProofContractError("Station proof device/variant binding is invalid")
        if binding["expectedProvider"] != CLIENT_PROVIDER[client_id]:
            raise ProofContractError("Station proof provider/client binding is invalid")
        if binding["gateId"] != "auth.login":
            raise ProofContractError("Station proof Access Gate binding is invalid")
        if payload["providerBinding"]["provider"] != binding["expectedProvider"]:
            raise ProofContractError("Station proof provider bindings disagree")
        candidate = payload["candidate"]
        session = payload["session"]
        provider_binding = payload["providerBinding"]
        candidate_count = candidate["count"]
        session_count = session["count"]
        if candidate_count not in (0, 1):
            raise ProofContractError("Station proof candidate count must be zero or one")
        if session_count not in (0, 1):
            raise ProofContractError("Station proof session count must be zero or one")
        if session["activeCount"] + session["revokedCount"] > session_count:
            raise ProofContractError(
                "Station proof active/revoked session counts exceed total"
            )
        if session_count > candidate_count:
            raise ProofContractError("Station proof session requires one candidate")
        if payload["credentialEnvelopeCount"] not in (0, 1):
            raise ProofContractError(
                "Station proof credential envelope count must be zero or one"
            )
        if payload["runOwnedResidue"]["candidates"] != candidate_count:
            raise ProofContractError(
                "Station proof candidate residue count disagrees with candidate"
            )
        if candidate_count == 0:
            if set(candidate) != {"count", "sessionRefPresent"}:
                raise ProofContractError(
                    "zero-candidate proof must omit candidate state and actor"
                )
            if candidate["sessionRefPresent"] is not False:
                raise ProofContractError(
                    "zero-candidate proof cannot reference a session"
                )
            if set(provider_binding) != {
                "provider",
                "candidateCorrelationPresent",
            }:
                raise ProofContractError(
                    "zero-candidate proof must omit provider fingerprint and binding count"
                )
            if provider_binding["candidateCorrelationPresent"] is not False:
                raise ProofContractError(
                    "zero-candidate proof cannot claim provider correlation"
                )
            if payload["credentialEnvelopeCount"] != 0:
                raise ProofContractError(
                    "zero-candidate proof cannot contain a credential envelope"
                )
            if any(
                session[field] != 0
                for field in ("count", "activeCount", "revokedCount")
            ):
                raise ProofContractError(
                    "zero-candidate proof cannot contain a session"
                )
            residue = payload["runOwnedResidue"]
            if any(
                residue[field] != 0
                for field in ("candidates", "credentialEnvelopes", "sessions")
            ):
                raise ProofContractError(
                    "zero-candidate proof cannot contain candidate-owned residue"
                )
        else:
            if not candidate.get("state") or not candidate.get("actorPtid"):
                raise ProofContractError(
                    "candidate proof requires candidate state and actor"
                )
            if provider_binding.get("candidateCorrelationPresent") is not True:
                raise ProofContractError(
                    "candidate proof requires provider correlation"
                )
            if provider_binding.get("bindingCount") != 1:
                raise ProofContractError(
                    "candidate proof requires exactly one provider binding"
                )
            if not provider_binding.get("providerSubjectFingerprint"):
                raise ProofContractError(
                    "candidate proof requires provider subject fingerprint"
                )
        if payload["snapshotPhase"] == "post_cleanup":
            residue = payload["runOwnedResidue"]
            nonzero = {
                key: value
                for key, value in residue.items()
                if key != "fixtureJournalEntries" and value != 0
            }
            fixture = payload["fixture"]
            if nonzero:
                raise ProofContractError(f"post-cleanup Station residue remains: {nonzero}")
            if fixture.get("policyRestored") is not True:
                raise ProofContractError("post-cleanup Station policy was not restored")
            if fixture.get("policyObservedDigest") != fixture.get("policyBaselineDigest"):
                raise ProofContractError("post-cleanup Station policy digest does not match")
    elif kind == "mobile-oauth-fixture-operation":
        if re.fullmatch(r"sha256:[0-9a-f]{64}", str(payload["inputDigest"])) is None:
            raise ProofContractError("Fixture operation inputDigest must be SHA-256")
        if payload["result"].get("journalState") != "COMMITTED":
            raise ProofContractError("Fixture operation journal must be COMMITTED")
        client_id = VARIANT_CLIENT.get(payload["variantId"])
        if client_id is None:
            raise ProofContractError("Fixture operation variant is not declared")
        target = payload["target"]
        if target["deviceAlias"] != client_id:
            raise ProofContractError("Fixture operation device/variant binding is invalid")
        if target["serviceId"] != CLIENT_SERVICE[client_id]:
            raise ProofContractError("Fixture operation service/client binding is invalid")
        expected_resource = f"station/{target['serviceId']}/mobile-oauth-fixture"
        if payload["resourceKey"] != expected_resource:
            raise ProofContractError(
                "Fixture operation resource/service binding is invalid"
            )
        variant_operation = {
            "following-gate": "prepare_following_gate",
            "expiry": "expire_awaiting_attempt",
        }
        variant_class = payload["variantId"].rsplit("-", 1)[0]
        if (
            variant_class in variant_operation
            and payload["operation"] != variant_operation[variant_class]
        ):
            raise ProofContractError("Fixture operation variant binding is invalid")
    elif kind == "provider-account-lease":
        if set(payload["allowedClientIds"]) != PROVIDER_CLIENTS[payload["provider"]]:
            raise ProofContractError("provider account/client binding is invalid")
        expected_account = f"{payload['provider']}-disposable-account"
        if payload["accountRef"] != expected_account:
            raise ProofContractError("provider account reference is invalid")
        expected_resource = f"provider-account/{payload['provider']}/disposable"
        if payload["resourceKey"] != expected_resource:
            raise ProofContractError("provider account resource/provider binding is invalid")
        if payload["state"] != "LEASED":
            raise ProofContractError(
                "provider account acquisition artifact must remain LEASED"
            )
        _validate_active_lease(payload)
    elif kind == "provider-identity-assertion":
        expected_account = f"{payload['provider']}-disposable-account"
        if payload["accountRef"] != expected_account:
            raise ProofContractError("provider identity account binding is invalid")
    elif kind == "physical-device-lease":
        client_id = payload["clientId"]
        platform = CLIENT_PLATFORM[client_id]
        if payload["platform"] != platform:
            raise ProofContractError("physical device client/platform binding is invalid")
        if payload["leaseId"] != f"device-{client_id}":
            raise ProofContractError("physical device lease identity is invalid")
        if payload["resourceKey"] != f"physical-device/{client_id}":
            raise ProofContractError("physical device resource/client binding is invalid")
        if payload["physicalDeviceRef"] != f"device-ref/{client_id}":
            raise ProofContractError("physical device opaque reference is invalid")
        if payload["destinationClassRef"] != f"{platform}-physical":
            raise ProofContractError("physical device destination class is invalid")
        if payload["state"] != "BASELINE_VERIFIED":
            raise ProofContractError(
                "physical device acquisition artifact must remain BASELINE_VERIFIED"
            )
        _validate_active_lease(payload)
    elif kind == "provider-browser-session-lease":
        client_id = payload["clientId"]
        if client_id not in CLIENTS:
            raise ProofContractError("browser lease client is not declared")
        if payload["platform"] != CLIENT_PLATFORM[client_id]:
            raise ProofContractError("browser lease client/platform binding is invalid")
        if payload["physicalDeviceLeaseRef"] != f"physical-device-lease/{client_id}":
            raise ProofContractError("browser lease physical-device binding is invalid")
        expected_provider_ref = f"provider-account-lease/{CLIENT_PROVIDER[client_id]}"
        if payload["providerAccountLeaseRef"] != expected_provider_ref:
            raise ProofContractError("browser lease provider-account binding is invalid")
        expected_resource = f"physical-device/{client_id}/browser/default"
        if payload["resourceKey"] != expected_resource:
            raise ProofContractError("browser lease resource/client binding is invalid")
        if payload["browserProfileRef"] != f"browser-profile/{client_id}":
            raise ProofContractError("browser lease profile/client binding is invalid")
        if payload["state"] != "BASELINE_VERIFIED":
            raise ProofContractError(
                "browser acquisition artifact must remain BASELINE_VERIFIED"
            )
        _validate_active_lease(payload)
    elif kind == "mobile-lease-outcome":
        final_state = payload["finalState"]
        failure_code = payload["failureCode"]
        operation_summary = payload.get("operationSummary")
        if final_state == "RELEASED":
            if any(
                payload[field] is not True
                for field in (
                    "cleanupCompleted",
                    "baselineRestored",
                    "identityReverified",
                )
            ):
                raise ProofContractError(
                    "released lease outcome requires completed cleanup, restored "
                    "baseline, and reverified identity"
                )
            if failure_code:
                raise ProofContractError(
                    "released lease outcome cannot contain a failureCode"
                )
        elif failure_code not in LEASE_FAILURE_CODES:
            raise ProofContractError(
                "quarantined lease outcome requires a typed failureCode"
            )
        if payload["leaseKind"] == "provider-account":
            if not isinstance(operation_summary, Mapping):
                raise ProofContractError(
                    "provider-account outcome requires operationSummary"
                )
            if (
                operation_summary["completed"] > operation_summary["started"]
                or (
                    operation_summary["started"] > 0
                    and operation_summary["maxObservedConcurrency"] < 1
                )
                or (
                    operation_summary["maxObservedConcurrency"]
                    > operation_summary["started"]
                )
            ):
                raise ProofContractError(
                    "provider-account outcome has invalid operation counters"
                )
            if final_state == "RELEASED" and (
                operation_summary["started"] < 1
                or operation_summary["started"] != operation_summary["completed"]
                or operation_summary["maxObservedConcurrency"] != 1
                or operation_summary["fenceValidated"] is not True
            ):
                raise ProofContractError(
                    "released provider-account outcome has incomplete or "
                    "concurrent operations"
                )
        elif operation_summary is not None:
            raise ProofContractError(
                "only provider-account outcome may contain operationSummary"
            )
    elif kind == "mobile-application-build-attestation":
        identity = payload["buildIdentity"]
        artifact = payload["artifact"]
        signing = payload["signing"]
        build_isolation = payload["buildIsolation"]
        platform = identity["platform"]
        expected_resolver_arguments = {
            "android": {
                "pnpm": ["--offline", "--frozen-lockfile"],
                "cargo": ["--frozen"],
                "gradle": ["--offline"],
            },
            "ios": {
                "pnpm": ["--offline", "--frozen-lockfile"],
                "cargo": ["--frozen"],
                "xcode": ["-disableAutomaticPackageResolution"],
            },
        }
        expected_inapplicable = {
            "android": ["xcode"],
            "ios": ["gradle"],
        }
        if build_isolation["resolverArguments"] != expected_resolver_arguments[platform]:
            raise ProofContractError(
                f"{platform} build resolverArguments are incomplete or invalid"
            )
        if build_isolation["inapplicableResolvers"] != expected_inapplicable[platform]:
            raise ProofContractError(
                f"{platform} inapplicable resolver declaration is invalid"
            )
        expected_kind = "ipa" if identity["platform"] == "ios" else "apk"
        if artifact.get("kind") != expected_kind:
            raise ProofContractError("build artifact kind does not match platform")
        expected_artifact_path = (
            f"runtime/mobile/builds/{identity['platform']}.{expected_kind}"
        )
        if artifact["artifactRef"]["path"] != expected_artifact_path:
            raise ProofContractError("build artifact reference does not match platform")
        artifact_digest = str(artifact["sha256"]).removeprefix("sha256:")
        if artifact["artifactRef"]["sha256"] != artifact_digest:
            raise ProofContractError(
                "build artifact digest does not match its ArtifactRef"
            )
        if signing.get("applicationIdentifier") != identity["applicationId"]:
            raise ProofContractError("signing and build application identifiers differ")
        if identity["workspaceState"] == "clean" and identity["workspaceDigest"] != "clean":
            raise ProofContractError("clean build identity must use workspaceDigest='clean'")
        platform_signing_fields = {
            "android": ("signerCertificateSha256", "enabledSigningSchemes"),
            "ios": (
                "teamIdentifier",
                "applicationIdentifierEntitlement",
                "cdHash",
            ),
        }
        missing = [
            field
            for field in platform_signing_fields[identity["platform"]]
            if field not in signing
        ]
        if missing:
            raise ProofContractError(
                f"{identity['platform']} signing metadata is missing: {missing}"
            )
        common_fields = {
            "policyId",
            "certificateSha256",
            "applicationIdentifier",
            "debuggable",
        }
        expected_fields = common_fields | set(
            platform_signing_fields[identity["platform"]]
        )
        if set(signing) != expected_fields:
            raise ProofContractError(
                f"{identity['platform']} signing metadata has invalid fields"
            )
        if identity["platform"] == "android" and signing[
            "enabledSigningSchemes"
        ] != ["v2", "v3"]:
            raise ProofContractError("Android signing schemes must be exactly v2 and v3")
        if identity["platform"] == "ios":
            cd_hash = signing["cdHash"]
            if not cd_hash["candidateFullValueHex"].startswith(
                cd_hash["valueHex"]
            ):
                raise ProofContractError(
                    "iOS CDHash must be the 20-byte prefix of CandidateCDHashFull"
                )
    elif kind == "mobile-fresh-install-trace":
        client_id = payload["clientId"]
        if payload["platform"] != CLIENT_PLATFORM[client_id]:
            raise ProofContractError("fresh install client/platform binding is invalid")
        uninstall = payload["uninstall"]
        install = payload["install"]
        uninstall_at = _parse_utc_timestamp(
            uninstall["completedAt"],
            "uninstall.completedAt",
        )
        install_at = _parse_utc_timestamp(
            install["completedAt"],
            "install.completedAt",
        )
        observed_at = _parse_utc_timestamp(payload["observedAt"], "observedAt")
        if (
            uninstall["stepIndex"] != 1
            or install["stepIndex"] != 2
            or uninstall_at > install_at
            or install_at > observed_at
        ):
            raise ProofContractError(
                "fresh install trace must prove ordered uninstall then install"
            )
    elif kind == "mobile-installed-build-identity":
        client_id = payload["clientId"]
        if payload["platform"] != CLIENT_PLATFORM[client_id]:
            raise ProofContractError(
                "installed identity client/platform binding is invalid"
            )
        identity_digests = {
            payload["webEmbeddedIdentitySha256"],
            payload["rustEmbeddedIdentitySha256"],
            payload["attestedEmbeddedIdentitySha256"],
        }
        if len(identity_digests) != 1:
            raise ProofContractError("installed Web/Rust/attested identities differ")


def validate_contract_payload(
    payload: Mapping[str, Any],
    *,
    expected_kind: str | None = None,
    expected_run_id: str | None = None,
    expected_gate_id: str = GATE_ID,
    expected_workspace_id: str | None = None,
    durable: bool = True,
    schema_path: Path = SCHEMA_PATH,
) -> dict[str, Any]:
    """Validate and return a detached typed producer payload."""

    if not isinstance(payload, Mapping):
        raise ProofContractError("Mobile proof payload must be an object")
    value = dict(payload)
    kind = value.get("artifactKind")
    if not isinstance(kind, str) or kind not in ACCEPTED_ARTIFACT_KINDS:
        raise ProofContractError(f"unknown Mobile proof artifact kind: {kind!r}")
    if expected_kind is not None and kind != expected_kind:
        raise ProofContractError(
            f"artifact kind {kind!r} does not match expected kind {expected_kind!r}"
        )
    schema = _load_schema(schema_path)
    _validate_schema_value(value, _kind_schema(schema, kind), schema, "$")
    validate_redaction(value, durable=durable)
    _require_same_run_references(
        value,
        expected_run_id,
        expected_gate_id,
        expected_workspace_id or evidence_workspace_id(REPO_ROOT),
    )
    _validate_kind_semantics(value, durable)
    return json.loads(json.dumps(value, sort_keys=True))


validate_payload = validate_contract_payload


def load_artifact_roles(schema_path: Path = SCHEMA_PATH) -> dict[str, ArtifactRole]:
    schema = _load_schema(schema_path)
    raw_roles = schema.get("x-peers-artifact-roles")
    if not isinstance(raw_roles, dict) or not raw_roles:
        raise ProofContractError("proof contract schema has no Artifact Role catalog")
    roles: dict[str, ArtifactRole] = {}
    for name, raw in raw_roles.items():
        if not isinstance(raw, dict) or not isinstance(raw.get("path"), str):
            raise ProofContractError(f"Artifact Role {name!r} is malformed")
        dimensions: dict[str, tuple[str, ...]] = {}
        raw_dimensions = raw.get("dimensions", {})
        if not isinstance(raw_dimensions, dict):
            raise ProofContractError(f"Artifact Role {name!r} dimensions are malformed")
        for dimension, values in raw_dimensions.items():
            if not isinstance(values, list) or not values or any(
                not isinstance(value, str) or not value for value in values
            ):
                raise ProofContractError(
                    f"Artifact Role {name!r} dimension {dimension!r} is malformed"
                )
            dimensions[str(dimension)] = tuple(values)
        roles[str(name)] = ArtifactRole(
            name=str(name),
            path_template=raw["path"],
            cardinality=(
                int(raw["cardinality"]) if "cardinality" in raw else None
            ),
            minimum_cardinality=(
                int(raw["minimumCardinality"])
                if "minimumCardinality" in raw
                else None
            ),
            dimensions=dimensions or None,
        )
    if len(roles) != 19:
        raise ProofContractError(f"Artifact Role catalog must contain 19 roles, got {len(roles)}")
    if set(roles) != set(ROLE_PAYLOAD_KINDS):
        raise ProofContractError("Artifact Role and payload-kind catalogs differ")
    return roles


ARTIFACT_ROLES = load_artifact_roles()


def _safe_run_relative_path(value: str) -> str:
    path = PurePosixPath(value)
    if not value or path.is_absolute() or ".." in path.parts or "\\" in value or "\x00" in value:
        raise ProofContractError(f"artifact path is not safe and run-relative: {value!r}")
    normalized = path.as_posix()
    return normalized + "/" if value.endswith("/") else normalized


def _template_pattern(template: str) -> re.Pattern[str]:
    parts = re.split(r"(\{[A-Za-z][A-Za-z0-9]*\})", template)
    expression = ""
    for part in parts:
        if part.startswith("{") and part.endswith("}"):
            expression += r"(?P<" + part[1:-1] + r">[a-z0-9][a-z0-9._-]*)"
        else:
            expression += re.escape(part)
    return re.compile(r"^" + expression + r"$")


def _dimension_paths(role: ArtifactRole) -> set[str] | None:
    if not role.dimensions:
        return None
    paths = {role.path_template}
    for dimension, values in role.dimensions.items():
        paths = {
            path.replace("{" + dimension + "}", value)
            for path in paths
            for value in values
        }
    return paths


def _expected_relation_paths(role_name: str) -> set[str] | None:
    if role_name == "mobile-visible-proof":
        return {
            f"evidence/mobile/{variant}/{VARIANT_CLIENT[variant]}/"
            for variant in VARIANTS
        }
    if role_name == "station-oauth-proof-snapshot":
        paths: set[str] = set()
        for variant in VARIANTS:
            if variant.startswith("station-mismatch-"):
                service_ids = SERVICES
            else:
                service_ids = (CLIENT_SERVICE[VARIANT_CLIENT[variant]],)
            paths.update(
                f"evidence/mobile/{variant}/station/{service_id}.json"
                for service_id in service_ids
            )
        return paths
    return None


def _validate_role_payload(
    role_name: str,
    payload: Mapping[str, Any],
    *,
    expected_run_id: str | None,
    expected_gate_id: str,
    expected_workspace_id: str,
) -> Mapping[str, Any]:
    expected_kind = ROLE_PAYLOAD_KINDS[role_name]
    if payload.get("artifactKind") != expected_kind:
        raise ProofContractError(
            f"Artifact Role {role_name!r} requires payload kind {expected_kind!r}"
        )
    if expected_kind in ACCEPTED_ARTIFACT_KINDS:
        return validate_contract_payload(
            payload,
            expected_run_id=expected_run_id,
            expected_gate_id=expected_gate_id,
            expected_workspace_id=expected_workspace_id,
        )

    run_id = payload.get("runId")
    gate_id = payload.get("gateId")
    if not isinstance(run_id, str) or not run_id:
        raise ProofContractError(f"Artifact Role {role_name!r} requires runId")
    if expected_run_id is not None and run_id != expected_run_id:
        raise ProofContractError(f"Artifact Role {role_name!r} runId mismatch")
    if gate_id != expected_gate_id:
        raise ProofContractError(f"Artifact Role {role_name!r} gateId mismatch")
    validate_redaction(payload)
    _require_same_run_references(
        payload,
        expected_run_id,
        expected_gate_id,
        expected_workspace_id,
    )
    return payload


def _role_path_dimensions(
    role: ArtifactRole,
    path: str,
) -> Mapping[str, str]:
    match = _template_pattern(role.path_template).fullmatch(path)
    if match is None:
        raise ProofContractError(
            f"artifact path {path!r} does not match role {role.name!r}"
        )
    return match.groupdict()


def _payload_dimension(payload: Mapping[str, Any], name: str) -> Any:
    if name == "platform":
        identity = payload.get("buildIdentity")
        if isinstance(identity, Mapping):
            return identity.get("platform")
    if name == "serviceId":
        service = payload.get("service")
        if isinstance(service, Mapping):
            return service.get("serviceId")
        target = payload.get("target")
        if isinstance(target, Mapping):
            return target.get("serviceId")
    return payload.get(name)


def _validate_role_dimensions(
    role: ArtifactRole,
    path: str,
    payload: Mapping[str, Any],
) -> None:
    for name, expected in _role_path_dimensions(role, path).items():
        if _payload_dimension(payload, name) != expected:
            raise ProofContractError(
                f"Artifact Role {role.name!r} path {name}={expected!r} "
                "does not match its payload"
            )
    if (
        role.name == "station-post-cleanup-proof"
        and payload.get("snapshotPhase") != "post_cleanup"
    ):
        raise ProofContractError(
            "Station post-cleanup role requires a post_cleanup snapshot"
        )


def _validate_fixture_operation_set(
    records: Sequence[ArtifactRecord],
) -> None:
    required = Counter(
        {
            ("station-primary", "following-gate-ios", "prepare_following_gate"): 1,
            (
                "station-primary",
                "following-gate-android",
                "prepare_following_gate",
            ): 1,
            ("station-primary", "expiry-ios", "expire_awaiting_attempt"): 1,
            ("station-primary", "expiry-android", "expire_awaiting_attempt"): 1,
            ("station-primary", "success-ios-github", "cleanup_run"): 1,
            ("station-secondary", "success-ios-google", "cleanup_run"): 1,
        }
    )
    observed: Counter[tuple[str, str, str]] = Counter()
    for record in records:
        if record.payload is None:
            continue
        target = record.payload.get("target")
        service_id = target.get("serviceId") if isinstance(target, Mapping) else None
        operation = record.payload.get("operation")
        if operation == "read_proof_snapshot":
            continue
        observed[
            (
                str(service_id or ""),
                str(record.payload.get("variantId") or ""),
                str(operation or ""),
            )
        ] += 1
    if observed != required:
        raise ProofContractError(
            "Fixture operation set does not contain the exact required "
            f"mutations and cleanup; missing={list((required - observed).elements())}, "
            f"extra={list((observed - required).elements())}"
        )


def _lease_identity(
    role_name: str,
    payload: Mapping[str, Any],
) -> str | None:
    lease_id = payload.get("leaseId")
    if isinstance(lease_id, str) and lease_id:
        return lease_id
    if role_name == "mobile-oauth-fixture-lease":
        service_id = payload.get("serviceId")
        if isinstance(service_id, str) and service_id:
            return f"fixture-{service_id}"
    return None


def _json_artifact_sha256(payload: Mapping[str, Any]) -> str:
    encoded = (
        json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n"
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _require_artifact_ref_matches_record(
    reference: Mapping[str, Any],
    record: ArtifactRecord,
    description: str,
) -> None:
    if record.payload is None:
        raise ProofContractError(f"{description} target payload is missing")
    if (
        reference["path"] != record.path
        or reference["sha256"] != _json_artifact_sha256(record.payload)
        or reference["mediaType"] != "application/json"
    ):
        raise ProofContractError(
            f"{description} does not match target path/hash/media type"
        )


def _validate_lease_outcomes(
    by_role: Mapping[str, Sequence[ArtifactRecord]],
) -> None:
    lease_roles = {
        "provider-account-lease": "provider-account",
        "physical-device-lease": "physical-device",
        "provider-browser-session-lease": "provider-browser-session",
        "mobile-oauth-fixture-lease": "fixture",
    }
    acquisitions: dict[str, tuple[str, ArtifactRecord]] = {}
    for role_name, lease_kind in lease_roles.items():
        for record in by_role[role_name]:
            if record.payload is None:
                continue
            lease_id = _lease_identity(role_name, record.payload)
            if lease_id is None:
                raise ProofContractError(
                    f"Artifact Role {role_name!r} has no lease identity"
                )
            if lease_id in acquisitions:
                raise ProofContractError(f"duplicate acquired leaseId {lease_id!r}")
            acquisitions[lease_id] = (lease_kind, record)
    outcomes = [
        record
        for record in by_role["mobile-lease-outcome"]
        if record.payload is not None
    ]
    outcome_ids = [str(record.payload.get("leaseId") or "") for record in outcomes]
    if set(outcome_ids) != set(acquisitions) or len(outcome_ids) != len(set(outcome_ids)):
        raise ProofContractError(
            "lease outcomes do not exactly cover acquired leases; "
            f"missing={sorted(set(acquisitions) - set(outcome_ids))}, "
            f"extra={sorted(set(outcome_ids) - set(acquisitions))}"
        )
    expected_kind_counts = Counter(
        {
            "fixture": 2,
            "physical-device": 4,
            "provider-account": 2,
            "provider-browser-session": 4,
        }
    )
    actual_kind_counts = Counter(
        str(record.payload["leaseKind"]) for record in outcomes
    )
    if actual_kind_counts != expected_kind_counts:
        raise ProofContractError(
            "lease outcomes must contain exactly two Fixture, four physical-device, "
            "two provider-account, and four browser-session outcomes"
        )
    for outcome_record in outcomes:
        outcome = outcome_record.payload
        lease_id = str(outcome["leaseId"])
        lease_kind, acquisition_record = acquisitions[lease_id]
        acquisition = acquisition_record.payload
        if outcome["leaseKind"] != lease_kind:
            raise ProofContractError(
                f"lease outcome {lease_id!r} has incorrect leaseKind"
            )
        for field in ("resourceKey", "holderRunId", "fenceToken"):
            if outcome[field] != acquisition[field]:
                raise ProofContractError(
                    f"lease outcome {lease_id!r} does not match acquisition {field}"
                )
        _require_artifact_ref_matches_record(
            outcome["acquisition"],
            acquisition_record,
            f"lease outcome {lease_id!r} acquisition",
        )
        expected_outcome_path = f"evidence/mobile/cleanup/leases/{lease_id}.json"
        if outcome_record.path != expected_outcome_path:
            raise ProofContractError(
                f"lease outcome {lease_id!r} path does not match its lease"
            )


def _single_payload_by_dimension(
    records: Sequence[ArtifactRecord],
    dimension: str,
) -> dict[str, tuple[ArtifactRecord, Mapping[str, Any]]]:
    indexed: dict[str, tuple[ArtifactRecord, Mapping[str, Any]]] = {}
    for record in records:
        if record.payload is None:
            continue
        value = _payload_dimension(record.payload, dimension)
        if not isinstance(value, str) or not value or value in indexed:
            raise ProofContractError(
                f"Artifact Role {record.role!r} has invalid or duplicate {dimension}"
            )
        indexed[value] = (record, record.payload)
    return indexed


def _validate_build_install_identity(
    by_role: Mapping[str, Sequence[ArtifactRecord]],
) -> None:
    builds = _single_payload_by_dimension(
        by_role["mobile-build-attestation"], "platform"
    )
    devices = _single_payload_by_dimension(
        by_role["physical-device-lease"], "clientId"
    )
    installs = _single_payload_by_dimension(
        by_role["mobile-fresh-install-trace"], "clientId"
    )
    identities = _single_payload_by_dimension(
        by_role["mobile-installed-build-identity"], "clientId"
    )
    if set(builds) != set(PLATFORMS):
        raise ProofContractError("build attestations must cover iOS and Android")
    if set(devices) != set(CLIENTS) or set(installs) != set(CLIENTS):
        raise ProofContractError("device leases and fresh installs must cover all clients")
    if set(identities) != set(CLIENTS):
        raise ProofContractError("installed identities must cover all clients")

    build_references: dict[str, Mapping[str, Any]] = {}
    for client_id in CLIENTS:
        platform = CLIENT_PLATFORM[client_id]
        build_record, build = builds[platform]
        device_record, _ = devices[client_id]
        install_record, install = installs[client_id]
        _, identity = identities[client_id]
        if install["platform"] != platform or identity["platform"] != platform:
            raise ProofContractError(
                f"client {client_id!r} install/runtime platform correlation failed"
            )
        _require_artifact_ref_matches_record(
            install["physicalDeviceLease"],
            device_record,
            f"client {client_id!r} install device lease",
        )
        _require_artifact_ref_matches_record(
            install["buildAttestation"],
            build_record,
            f"client {client_id!r} install build attestation",
        )
        prior_build_reference = build_references.setdefault(
            platform, install["buildAttestation"]
        )
        if install["buildAttestation"] != prior_build_reference:
            raise ProofContractError(
                f"{platform} installs do not reference one immutable build attestation"
            )
        if install["artifactSha256"] != build["artifact"]["sha256"]:
            raise ProofContractError(
                f"client {client_id!r} install artifact hash does not match attestation"
            )
        if install["applicationId"] != build["buildIdentity"]["applicationId"]:
            raise ProofContractError(
                f"client {client_id!r} install application does not match attestation"
            )
        _require_artifact_ref_matches_record(
            identity["buildAttestation"],
            build_record,
            f"client {client_id!r} runtime build attestation",
        )
        if identity["buildAttestation"] != install["buildAttestation"]:
            raise ProofContractError(
                f"client {client_id!r} runtime/build ArtifactRefs differ"
            )
        _require_artifact_ref_matches_record(
            identity["freshInstallTrace"],
            install_record,
            f"client {client_id!r} runtime install trace",
        )
        if identity["buildId"] != build["buildIdentity"]["buildId"]:
            raise ProofContractError(
                f"client {client_id!r} runtime buildId does not match attestation"
            )
        if identity["activeApplicationId"] != install["applicationId"]:
            raise ProofContractError(
                f"client {client_id!r} active application does not match install"
            )
        if (
            identity["attestedEmbeddedIdentitySha256"]
            != build["embeddedIdentitySha256"]
        ):
            raise ProofContractError(
                f"client {client_id!r} runtime identity does not match attestation"
            )


def validate_artifact_roles(
    records: Iterable[ArtifactRecord | Mapping[str, Any]],
    *,
    expected_run_id: str | None = None,
    expected_gate_id: str = GATE_ID,
    expected_workspace_id: str | None = None,
    expected_source_commit: str | None = None,
    expected_workspace_digest: str | None = None,
    validate_payloads: bool = True,
) -> list[ArtifactRecord]:
    """Validate the frozen role catalog, exact paths, and cardinalities."""

    verified_workspace_id = (
        expected_workspace_id or evidence_workspace_id(REPO_ROOT)
    )
    normalized: list[ArtifactRecord] = []
    for raw in records:
        if isinstance(raw, ArtifactRecord):
            record = raw
        elif isinstance(raw, Mapping):
            raw_payload = raw.get("payload")
            if raw_payload is not None and not isinstance(raw_payload, Mapping):
                raise ProofContractError("artifact inventory payloads must be objects")
            record = ArtifactRecord(
                role=str(raw.get("role") or ""),
                path=str(raw.get("path") or ""),
                payload=raw_payload,
            )
        else:
            raise ProofContractError("artifact inventory entries must be objects")
        if record.role not in ARTIFACT_ROLES:
            raise ProofContractError(f"unknown Artifact Role: {record.role!r}")
        safe_path = _safe_run_relative_path(record.path)
        role_pattern = _template_pattern(
            ARTIFACT_ROLES[record.role].path_template
        )
        if role_pattern.fullmatch(safe_path) is None:
            raise ProofContractError(
                f"artifact path {safe_path!r} does not match role {record.role!r}"
            )
        normalized.append(ArtifactRecord(record.role, safe_path, record.payload))

    paths = [record.path for record in normalized]
    if len(paths) != len(set(paths)):
        raise ProofContractError("artifact inventory contains duplicate run-relative paths")

    by_role: dict[str, list[ArtifactRecord]] = {name: [] for name in ARTIFACT_ROLES}
    for record in normalized:
        by_role[record.role].append(record)
    for name, role in ARTIFACT_ROLES.items():
        actual = by_role[name]
        if role.cardinality is not None and len(actual) != role.cardinality:
            raise ProofContractError(
                f"Artifact Role {name!r} requires {role.cardinality} artifacts, "
                f"got {len(actual)}"
            )
        if role.minimum_cardinality is not None and len(actual) < role.minimum_cardinality:
            raise ProofContractError(
                f"Artifact Role {name!r} requires at least "
                f"{role.minimum_cardinality} artifacts, got {len(actual)}"
            )
        expected_paths = _expected_relation_paths(name) or _dimension_paths(role)
        if expected_paths is not None and {item.path for item in actual} != expected_paths:
            missing = sorted(expected_paths - {item.path for item in actual})
            extra = sorted({item.path for item in actual} - expected_paths)
            raise ProofContractError(
                f"Artifact Role {name!r} path set mismatch; missing={missing}, extra={extra}"
            )
        if validate_payloads:
            for item in actual:
                if item.payload is None:
                    raise ProofContractError(
                        f"Artifact Role {name!r} payload is required"
                    )
                payload = _validate_role_payload(
                    name,
                    item.payload,
                    expected_run_id=expected_run_id,
                    expected_gate_id=expected_gate_id,
                    expected_workspace_id=verified_workspace_id,
                )
                _validate_role_dimensions(role, item.path, payload)
                build_identity = payload.get("buildIdentity")
                if isinstance(build_identity, Mapping):
                    source_commit = build_identity.get("sourceCommit")
                    workspace_digest = build_identity.get("workspaceDigest")
                    if (
                        expected_source_commit is not None
                        and source_commit != expected_source_commit
                    ):
                        raise ProofContractError(
                            f"Artifact Role {name!r} sourceCommit mismatch"
                        )
                    if (
                        expected_workspace_digest is not None
                        and workspace_digest != expected_workspace_digest
                    ):
                        raise ProofContractError(
                            f"Artifact Role {name!r} workspaceDigest mismatch"
                        )
    if validate_payloads:
        _validate_fixture_operation_set(
            by_role["mobile-oauth-fixture-operation"]
        )
        _validate_lease_outcomes(by_role)
        _validate_build_install_identity(by_role)
    return normalized


validate_artifact_collection = validate_artifact_roles


def _file_digest(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as error:
        raise ProofContractError(f"cannot read protected file {path}: {error}") from error


def _tree_digest(root: Path, tree: Path) -> str:
    if not tree.is_dir():
        raise ProofContractError(f"protected tree is missing: {tree}")
    digest = hashlib.sha256()
    files = sorted(path for path in tree.rglob("*") if path.is_file() or path.is_symlink())
    if not files:
        raise ProofContractError(f"protected tree is empty: {tree}")
    for path in files:
        if path.is_symlink():
            raise ProofContractError(f"protected tree contains a symlink: {path}")
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        try:
            digest.update(path.read_bytes())
        except OSError as error:
            raise ProofContractError(f"cannot read protected file {path}: {error}") from error
        digest.update(b"\0")
    return digest.hexdigest()


def protected_path_snapshot(root: Path) -> dict[str, str]:
    root = root.resolve()
    return {
        "model/domain": _tree_digest(root, root / "model" / "domain"),
        "pnpm-lock.yaml": _file_digest(root / "pnpm-lock.yaml"),
        "apps/mobile/src-tauri/Cargo.lock": _file_digest(
            root / "apps" / "mobile" / "src-tauri" / "Cargo.lock"
        ),
        "packages/messaging-core/Cargo.lock": _file_digest(
            root / "packages" / "messaging-core" / "Cargo.lock"
        ),
    }


def verify_protected_paths(
    root: Path = REPO_ROOT,
    *,
    baseline_root: Path | None = None,
    baseline: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Verify Proto and lockfile bytes against an explicit or frozen baseline."""

    actual = protected_path_snapshot(root)
    if baseline_root is not None and baseline is not None:
        raise ProofContractError("choose baseline_root or baseline, not both")
    expected = (
        protected_path_snapshot(baseline_root)
        if baseline_root is not None
        else dict(baseline or FROZEN_PROTECTED_BASELINE)
    )
    if set(expected) != set(actual):
        raise ProofContractError(
            f"protected-path baseline keys differ: expected={sorted(expected)}, "
            f"actual={sorted(actual)}"
        )
    changed = sorted(path for path in actual if actual[path] != expected[path])
    if changed:
        raise ProofContractError(f"protected Proto/lockfile drift: {changed}")
    return {"status": "PASS", "protectedPaths": actual}


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProofContractError(f"cannot parse protected JSON {path}: {error}") from error
    if not isinstance(value, dict):
        raise ProofContractError(f"protected JSON must be an object: {path}")
    return value


def _package_semantics(path: Path) -> dict[str, Any]:
    value = _read_json_object(path)
    dependency_sections = (
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    )
    dependencies: dict[str, dict[str, str]] = {}
    for section in dependency_sections:
        raw = value.get(section, {})
        if not isinstance(raw, dict) or any(
            not isinstance(name, str) or not isinstance(version, str)
            for name, version in raw.items()
        ):
            raise ProofContractError(f"{path}:{section} must map package names to strings")
        dependencies[section] = dict(sorted(raw.items()))
    package_version = value.get("version")
    if package_version is not None and not isinstance(package_version, str):
        raise ProofContractError(f"{path}:version must be a string or absent")
    return {
        "packageVersion": package_version,
        "packageManager": value.get("packageManager"),
        "dependencies": dependencies,
    }


def _json_version_semantics(path: Path) -> dict[str, Any]:
    value = _read_json_object(path)
    version = value.get("version")
    if not isinstance(version, str):
        raise ProofContractError(f"{path}:version must be a string")
    return {"version": version}


def _collect_named_versions(value: Any, path: str = "$") -> dict[str, str | int]:
    versions: dict[str, str | int] = {}
    if isinstance(value, dict):
        for key, item in value.items():
            item_path = f"{path}.{key}"
            if key in {"version", "expected_version", "driver_version"}:
                if not isinstance(item, str):
                    raise ProofContractError(
                        f"protected version field {item_path} must be a string"
                    )
                versions[item_path] = item
            elif key == "browser_major":
                if not isinstance(item, int) or isinstance(item, bool) or item < 1:
                    raise ProofContractError(
                        f"protected browser major {item_path} must be a positive integer"
                    )
                versions[item_path] = item
            else:
                versions.update(_collect_named_versions(item, item_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            versions.update(_collect_named_versions(item, f"{path}[{index}]"))
    return versions


def _mobile_native_environment_semantics(path: Path) -> dict[str, Any]:
    value = _read_json_object(path)
    versions = _collect_named_versions(value)
    if not versions:
        raise ProofContractError(f"{path}: no protected tool versions found")
    return {"versions": dict(sorted(versions.items()))}


def _normalize_cargo_dependency(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        return {"version": value}
    if not isinstance(value, dict):
        raise ProofContractError("Cargo dependency must be a string or table")
    ignored = {"features", "default-features", "optional"}
    coordinates = {
        str(key): item
        for key, item in value.items()
        if key not in ignored
    }
    if not coordinates:
        raise ProofContractError("Cargo dependency has no protected coordinates")
    return dict(sorted(coordinates.items()))


def _cargo_dependency_sections(value: Mapping[str, Any]) -> Iterable[tuple[str, Mapping[str, Any]]]:
    for section in ("dependencies", "dev-dependencies", "build-dependencies"):
        dependencies = value.get(section, {})
        if not isinstance(dependencies, dict):
            raise ProofContractError(f"Cargo {section} must be a table")
        yield section, dependencies
    targets = value.get("target", {})
    if not isinstance(targets, dict):
        raise ProofContractError("Cargo target must be a table")
    for target, target_value in targets.items():
        if not isinstance(target_value, dict):
            raise ProofContractError(f"Cargo target {target!r} must be a table")
        for section in ("dependencies", "dev-dependencies", "build-dependencies"):
            dependencies = target_value.get(section, {})
            if not isinstance(dependencies, dict):
                raise ProofContractError(
                    f"Cargo target {target!r} {section} must be a table"
                )
            yield f"target.{target}.{section}", dependencies


def _cargo_semantics(path: Path) -> dict[str, Any]:
    try:
        value = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
        raise ProofContractError(
            f"cannot parse protected Cargo manifest {path}: {error}"
        ) from error
    package = value.get("package")
    if not isinstance(package, dict):
        raise ProofContractError(f"{path}: package table is missing")
    package_version = package.get("version")
    if not isinstance(package_version, str):
        raise ProofContractError(f"{path}: package.version is missing")
    dependencies: dict[str, dict[str, Any]] = {}
    for section, section_dependencies in _cargo_dependency_sections(value):
        for name, dependency in section_dependencies.items():
            dependencies[f"{section}.{name}"] = _normalize_cargo_dependency(
                dependency
            )
    return {
        "packageVersion": package_version,
        "dependencies": dict(sorted(dependencies.items())),
    }


def version_policy_snapshot(root: Path) -> dict[str, Any]:
    root = root.resolve()
    schema = _load_schema(
        root
        / "tooling"
        / "acceptance"
        / "gates"
        / "mobile"
        / "proof-contract.schema.json"
    )
    policy = schema["x-peers-contract-policy"]
    return {
        "package.json": _package_semantics(root / "package.json"),
        "apps/mobile/package.json": _package_semantics(
            root / "apps" / "mobile" / "package.json"
        ),
        "packages/client-chat-core/package.json": _package_semantics(
            root / "packages" / "client-chat-core" / "package.json"
        ),
        "packages/client-media-security/package.json": _package_semantics(
            root / "packages" / "client-media-security" / "package.json"
        ),
        "packages/client-storage/package.json": _package_semantics(
            root / "packages" / "client-storage" / "package.json"
        ),
        "packages/locales/package.json": _package_semantics(
            root / "packages" / "locales" / "package.json"
        ),
        "apps/mobile/src-tauri/Cargo.toml": _cargo_semantics(
            root / "apps" / "mobile" / "src-tauri" / "Cargo.toml"
        ),
        "apps/mobile/src-tauri/plugins/secure-storage/Cargo.toml": _cargo_semantics(
            root
            / "apps"
            / "mobile"
            / "src-tauri"
            / "plugins"
            / "secure-storage"
            / "Cargo.toml"
        ),
        "packages/messaging-core/Cargo.toml": _cargo_semantics(
            root / "packages" / "messaging-core" / "Cargo.toml"
        ),
        "apps/mobile/src-tauri/tauri.conf.json": _json_version_semantics(
            root / "apps" / "mobile" / "src-tauri" / "tauri.conf.json"
        ),
        "packages/locales/metadata.json": _json_version_semantics(
            root / "packages" / "locales" / "metadata.json"
        ),
        "tooling/acceptance/environments/mobile-native.yaml": (
            _mobile_native_environment_semantics(
                root
                / "tooling"
                / "acceptance"
                / "environments"
                / "mobile-native.yaml"
            )
        ),
        "schemaRevision": policy.get("schemaRevision"),
        "protocolRevision": policy.get("protocolRevision"),
    }


def _semantic_digest(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def verify_version_policy(
    root: Path = REPO_ROOT,
    *,
    baseline_root: Path | None = None,
    baseline: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Reject dependency/package/schema/protocol drift using parsed semantics."""

    actual = version_policy_snapshot(root)
    if baseline_root is not None and baseline is not None:
        raise ProofContractError("choose baseline_root or baseline, not both")
    if baseline_root is not None:
        expected = version_policy_snapshot(baseline_root)
        if actual != expected:
            changed = sorted(key for key in actual if actual.get(key) != expected.get(key))
            raise ProofContractError(f"protected semantic version drift: {changed}")
    elif baseline is not None:
        if actual != dict(baseline):
            changed = sorted(key for key in actual if actual.get(key) != baseline.get(key))
            raise ProofContractError(f"protected semantic version drift: {changed}")
    else:
        actual_digest = _semantic_digest(actual)
        if actual_digest != FROZEN_VERSION_POLICY_DIGEST:
            raise ProofContractError(
                "protected dependency/package/schema/protocol version policy drift"
            )
    return {"status": "PASS", "versionPolicyDigest": _semantic_digest(actual)}


CUTOVER_RULES = (
    CutoverRule(
        match_class="raw-ios-artifact-path",
        pattern=re.compile(r"PT_MOBILE_IOS_APP_PATH"),
        roots=("tooling/acceptance", "apps/mobile", "docs/architecture/mobile"),
        replace_paths=(
            "tooling/acceptance/environments/mobile-native.yaml",
            "tooling/acceptance/provisioners/mobile_native.py",
            "tooling/acceptance/tests/test_mobile_native_preflight.py",
            "docs/architecture/mobile/native-oauth-proof/*.md",
            "docs/architecture/mobile/execution-plans/*.md",
        ),
    ),
    CutoverRule(
        match_class="raw-android-artifact-path",
        pattern=re.compile(r"PT_MOBILE_ANDROID_APP_PATH"),
        roots=("tooling/acceptance", "apps/mobile", "docs/architecture/mobile"),
        replace_paths=(
            "tooling/acceptance/environments/mobile-native.yaml",
            "tooling/acceptance/provisioners/mobile_native.py",
            "tooling/acceptance/tests/test_mobile_native_preflight.py",
            "docs/architecture/mobile/native-oauth-proof/*.md",
            "docs/architecture/mobile/execution-plans/*.md",
        ),
    ),
    CutoverRule(
        match_class="raw-artifact-consumer",
        pattern=re.compile(r"\bbuild_artifacts\[platform\]\s*=\s*artifact\b"),
        roots=("tooling/acceptance/provisioners/mobile_native.py",),
        replace_paths=("tooling/acceptance/provisioners/mobile_native.py",),
    ),
    CutoverRule(
        match_class="legacy-android-avd-destination",
        pattern=re.compile(r"PT_MOBILE_ANDROID_AVD"),
        roots=("tooling/acceptance", "apps/mobile", "docs/architecture/mobile"),
        replace_paths=(
            "tooling/acceptance/environments/mobile-native.yaml",
            "tooling/acceptance/tests/test_mobile_native_preflight.py",
            "docs/architecture/mobile/execution-plans/*.md",
        ),
    ),
    CutoverRule(
        match_class="declarative-browser-required-marker",
        pattern=re.compile(
            r"(?:clean_start|readback|cleanup)[\"']?\s*[:=].{0,24}"
            r"[\"']required[\"']"
        ),
        roots=("tooling/acceptance", "apps/mobile", "docs/architecture/mobile"),
        replace_paths=(
            "tooling/acceptance/environments/mobile-native.yaml",
            "tooling/acceptance/provisioners/mobile_native.py",
            "docs/architecture/mobile/native-oauth-proof/*.md",
            "docs/architecture/mobile/execution-plans/*.md",
        ),
    ),
    CutoverRule(
        match_class="projection-as-station-readback",
        pattern=re.compile(r"Station readback"),
        roots=("tooling/acceptance/gates/mobile",),
        replace_paths=(
            "tooling/acceptance/gates/mobile/native_e2e.py",
            "tooling/acceptance/gates/mobile/native_e2e_test.py",
        ),
        retained_paths=(
            "tooling/acceptance/gates/mobile/simulator_e2e.py",
            "tooling/acceptance/gates/mobile/simulator_e2e_test.py",
        ),
    ),
    CutoverRule(
        match_class="unsupported-physical-variant",
        pattern=re.compile(r"\bsupported\s*=\s*False\b|\bmissing_closure\b"),
        roots=("tooling/acceptance/gates/mobile", "docs/architecture/mobile"),
        replace_paths=(
            "tooling/acceptance/gates/mobile/native_e2e.py",
            "tooling/acceptance/gates/mobile/native_e2e_test.py",
            "docs/architecture/mobile/native-oauth-proof/*.md",
            "docs/architecture/mobile/execution-plans/*.md",
        ),
    ),
    CutoverRule(
        match_class="web-harness-cleanup",
        pattern=re.compile(r"\bcall_action\(\s*[\"']cleanup[\"']"),
        roots=("tooling/acceptance/gates/mobile",),
        replace_paths=(
            "tooling/acceptance/gates/mobile/native_e2e.py",
            "tooling/acceptance/gates/mobile/native_e2e_test.py",
        ),
        retained_paths=(
            "tooling/acceptance/gates/mobile/simulator_e2e.py",
            "tooling/acceptance/gates/mobile/simulator_e2e_test.py",
        ),
    ),
    CutoverRule(
        match_class="driver-visible-invalid-callback",
        pattern=re.compile(r"\bdeep_link_for_failure_case\b"),
        roots=("tooling/acceptance/gates/mobile",),
        replace_paths=(
            "tooling/acceptance/gates/mobile/native_e2e.py",
            "tooling/acceptance/gates/mobile/native_e2e_test.py",
        ),
        retained_paths=(
            "tooling/acceptance/gates/mobile/appium.py",
            "tooling/acceptance/gates/mobile/simulator_e2e.py",
            "tooling/acceptance/gates/mobile/simulator_e2e_test.py",
        ),
    ),
    CutoverRule(
        match_class="stale-physical-install",
        pattern=re.compile(r"(?:appium:)?noReset"),
        roots=("tooling/acceptance/gates/mobile",),
        replace_paths=(
            "tooling/acceptance/gates/mobile/appium.py",
            "tooling/acceptance/gates/mobile/appium_test.py",
        ),
        retained_paths=(
            "tooling/acceptance/gates/mobile/simulator_e2e.py",
            "tooling/acceptance/gates/mobile/simulator_e2e_test.py",
            "tooling/acceptance/gates/mobile/README.md",
        ),
    ),
    CutoverRule(
        match_class="mobile-native-cleanup-registration",
        pattern=re.compile(r"\bregister_cleanup\("),
        roots=("tooling/acceptance/provisioners/mobile_native.py",),
        replace_paths=("tooling/acceptance/provisioners/mobile_native.py",),
    ),
)
TEXT_SUFFIXES = frozenset(
    {
        ".gradle",
        ".json",
        ".kt",
        ".kts",
        ".md",
        ".py",
        ".rs",
        ".sh",
        ".swift",
        ".toml",
        ".ts",
        ".tsx",
        ".yaml",
        ".yml",
    }
)


def _matches_any(path: str, patterns: Sequence[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def _iter_text_files(root: Path, roots: Sequence[str]) -> Iterable[tuple[str, Path]]:
    seen: set[str] = set()
    contract_sources = {
        "tooling/acceptance/gates/mobile/proof_contracts.py",
        "tooling/acceptance/gates/mobile/proof-contract.schema.json",
        "tooling/acceptance/gates/mobile/proof_contracts_test.py",
    }
    for relative_root in roots:
        scan_root = root / relative_root
        if not scan_root.exists():
            raise ProofContractError(f"cutover inventory root is missing: {relative_root}")
        candidates = [scan_root] if scan_root.is_file() else scan_root.rglob("*")
        for path in candidates:
            if not path.is_file() or path.is_symlink():
                continue
            relative = path.relative_to(root).as_posix()
            if any(
                part in {"target", "build", "DerivedData", ".gradle", "Pods", "dist"}
                for part in PurePosixPath(relative).parts
            ):
                continue
            is_named_text = path.name == "Makefile" or path.name.startswith("Makefile.")
            if path.suffix not in TEXT_SUFFIXES and path.suffix != "" and not is_named_text:
                continue
            if relative in seen or relative in contract_sources:
                continue
            if path.suffix == "":
                try:
                    content = path.read_bytes()
                    content.decode("utf-8")
                except (OSError, UnicodeDecodeError) as error:
                    if isinstance(error, UnicodeDecodeError):
                        continue
                    raise ProofContractError(
                        f"cannot inspect cutover inventory file {relative}: {error}"
                    ) from error
                if b"\0" in content:
                    continue
            seen.add(relative)
            yield relative, path


def verify_cutover_inventory(root: Path = REPO_ROOT) -> dict[str, Any]:
    """Classify every known old-path match or block on an unknown consumer."""

    root = root.resolve()
    matches: list[CutoverMatch] = []
    unknown: list[str] = []
    for rule in CUTOVER_RULES:
        for relative, path in _iter_text_files(root, rule.roots):
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except (OSError, UnicodeDecodeError) as error:
                raise ProofContractError(f"cannot inventory {relative}: {error}") from error
            for line_number, line in enumerate(lines, start=1):
                if rule.pattern.search(line) is None:
                    continue
                if _matches_any(relative, rule.retained_paths):
                    disposition = "retained-simulator-contract"
                elif _matches_any(relative, rule.replace_paths):
                    disposition = "replace-at-e2-5"
                else:
                    unknown.append(f"{rule.match_class}:{relative}:{line_number}")
                    continue
                matches.append(
                    CutoverMatch(
                        match_class=rule.match_class,
                        path=relative,
                        line=line_number,
                        disposition=disposition,
                        owner=rule.owner,
                    )
                )
    if unknown:
        raise ProofContractError(
            "unclassified Mobile cutover matches block execution: " + ", ".join(unknown)
        )
    counts: dict[str, int] = {}
    for match in matches:
        counts[match.match_class] = counts.get(match.match_class, 0) + 1
    missing_classes = sorted(
        rule.match_class
        for rule in CUTOVER_RULES
        if not counts.get(rule.match_class)
    )
    if missing_classes:
        raise ProofContractError(
            f"cutover inventory unexpectedly lost declared match classes: {missing_classes}"
        )
    return {
        "status": "PASS",
        "result": "CLASSIFIED",
        "matches": [
            {
                "class": match.match_class,
                "path": match.path,
                "line": match.line,
                "disposition": match.disposition,
                "owner": match.owner,
            }
            for match in matches
        ],
        "counts": dict(sorted(counts.items())),
    }


def _print_report(report: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--verify-protected-paths", action="store_true")
    modes.add_argument("--verify-version-policy", action="store_true")
    modes.add_argument("--verify-cutover-inventory", action="store_true")
    modes.add_argument(
        "--validate-payload",
        type=Path,
        metavar="JSON",
        help="validate one producer payload from a JSON file",
    )
    parser.add_argument("--root", type=Path, default=REPO_ROOT)
    parser.add_argument("--baseline-root", type=Path)
    parser.add_argument("--allow-volatile", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.verify_protected_paths:
            report = verify_protected_paths(
                args.root, baseline_root=args.baseline_root
            )
        elif args.verify_version_policy:
            report = verify_version_policy(
                args.root, baseline_root=args.baseline_root
            )
        elif args.verify_cutover_inventory:
            if args.baseline_root is not None:
                raise ProofContractError(
                    "--baseline-root is not valid for cutover inventory"
                )
            report = verify_cutover_inventory(args.root)
        else:
            if args.baseline_root is not None:
                raise ProofContractError(
                    "--baseline-root is not valid for payload validation"
                )
            payload = _read_json_object(args.validate_payload)
            report = {
                "status": "PASS",
                "artifactKind": validate_contract_payload(
                    payload, durable=not args.allow_volatile
                )["artifactKind"],
            }
    except ProofContractError as error:
        sys.stderr.write(f"mobile proof contract: FAIL: {error}\n")
        return 1
    _print_report(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
