#!/usr/bin/env python3
"""Fail-closed producer core for the 419-cell Agent V2 Foundation candidate."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any, Literal, Mapping, Protocol

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import RunHandle, source_identity
from tooling.acceptance.core.redaction import is_sensitive_key, redact_text
from tooling.acceptance.gates.agent.agent_v2_gate import (
    GATE_ROLES,
    MATRIX,
    RUNNER_GENERATED_ROLES,
)

GATE_ID = "agent-v2-kernel-foundation-e2e"
MATRIX_PATH = (
    REPO_ROOT / "tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml"
)
EXPANDER_PATH = (
    REPO_ROOT / "tooling/scripts/expand-agent-v2-runtime-matrix.py"
)
VALIDATOR_PATH = REPO_ROOT / "tooling/scripts/acceptance-validate.py"
SCHEMA_ROOT = REPO_ROOT / "tooling/acceptance/schemas/agent-v2"
CONTRACT_PATH = SCHEMA_ROOT / "contract.json"
TUPLE_FIELDS = (
    "gate",
    "row",
    "platform",
    "runtime",
    "cell",
    "locale",
    "ordering",
    "sample_id",
)
SCENARIO_ROLES = tuple(
    role
    for role in GATE_ROLES[GATE_ID]
    if role not in RUNNER_GENERATED_ROLES
)
EVIDENCE_ROLES = tuple(
    role for role in SCENARIO_ROLES if role != "runtime-attestation-set"
)
RuntimeAttestationProfile = Literal[
    "direct_runtime",
    "direct_runtime_no_local_capability",
    "contract_only",
    "orchestration_guard",
    "non_advertised",
]
RUNTIME_ATTESTATION_PROFILES = {
    "direct_runtime",
    "direct_runtime_no_local_capability",
    "contract_only",
    "orchestration_guard",
    "non_advertised",
}
ROW_ADAPTERS = {
    "foundation-desktop-direct": "desktop_native",
    "foundation-browser-direct": "browser",
    "foundation-mobile-contract": "mobile_contract",
    "foundation-d11": "d11",
    "foundation-desktop-cli-absent": "non_advertisement",
    "foundation-browser-cli-absent": "non_advertisement",
    "foundation-desktop-external-absent": "non_advertisement",
    "foundation-browser-external-absent": "non_advertisement",
}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_SCHEMA_KEYS = {
    "cacheTokens",
    "cache_tokens",
    "contextTokens",
    "context_tokens",
    "fencingToken",
    "hasTokenAccounting",
    "inputTokens",
    "input_tokens",
    "maxInputTokens",
    "maxOutputTokens",
    "outputTokens",
    "output_tokens",
    "reasoningTokens",
    "reasoning_tokens",
    "tokenAccountingPresent",
    "tokenUsage",
    "token_usage",
    "toolDefinitionTokens",
    "tool_definition_tokens",
}


class FoundationCandidateError(RuntimeError):
    """The producer cannot establish an exact, observed Foundation candidate."""


@dataclass(frozen=True)
class FoundationRolePolicy:
    always: tuple[str, ...]
    required: tuple[str, ...]
    not_applicable: tuple[str, ...]

    @property
    def applicable(self) -> frozenset[str]:
        return frozenset((*self.always, *self.required))

    @property
    def adapter_roles(self) -> frozenset[str]:
        return self.applicable - {"runtime-attestation-set"}


@dataclass(frozen=True)
class FoundationTuple:
    gate: str
    row: str
    platform: str
    runtime: str
    cell: str
    locale: str
    ordering: str
    sample_id: str
    role_policy: FoundationRolePolicy
    runtime_attestation_profile: RuntimeAttestationProfile

    @property
    def key(self) -> str:
        return json.dumps(
            [getattr(self, field) for field in TUPLE_FIELDS],
            separators=(",", ":"),
        )

    def to_dict(self) -> dict[str, str]:
        return {field: getattr(self, field) for field in TUPLE_FIELDS}


@dataclass(frozen=True)
class FoundationRuntimeAttestation:
    profile: RuntimeAttestationProfile
    payload: Mapping[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "attestationProfile": self.profile,
            **dict(self.payload),
        }


@dataclass(frozen=True)
class FoundationTupleObservation:
    tuple_key: str
    observed: bool
    passed: bool
    runtime_attestation: FoundationRuntimeAttestation
    role_observations: Mapping[str, Mapping[str, Any]]


class DesktopNativeFoundationAdapter(Protocol):
    def observe_desktop_native(
        self, runtime_tuple: FoundationTuple
    ) -> FoundationTupleObservation: ...


class BrowserFoundationAdapter(Protocol):
    def observe_browser(
        self, runtime_tuple: FoundationTuple
    ) -> FoundationTupleObservation: ...


class MobileContractFoundationAdapter(Protocol):
    def observe_mobile_contract(
        self, runtime_tuple: FoundationTuple
    ) -> FoundationTupleObservation: ...


class D11FoundationAdapter(Protocol):
    def observe_d11(
        self, runtime_tuple: FoundationTuple
    ) -> FoundationTupleObservation: ...


class NonAdvertisementFoundationAdapter(Protocol):
    def observe_non_advertisement(
        self, runtime_tuple: FoundationTuple
    ) -> FoundationTupleObservation: ...


@dataclass(frozen=True)
class FoundationAdapters:
    desktop_native: DesktopNativeFoundationAdapter
    browser: BrowserFoundationAdapter
    mobile_contract: MobileContractFoundationAdapter
    d11: D11FoundationAdapter
    non_advertisement: NonAdvertisementFoundationAdapter


def _load_module(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise FoundationCandidateError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise FoundationCandidateError(f"cannot load JSON contract {path}: {error}") from error
    if not isinstance(value, dict):
        raise FoundationCandidateError(f"JSON contract must be an object: {path}")
    return value


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as error:
        raise FoundationCandidateError(f"cannot hash matrix {path}: {error}") from error


def _ensure_evidence_safe(value: Any, path: str) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            if is_sensitive_key(key_text) and key_text not in SAFE_SCHEMA_KEYS:
                raise FoundationCandidateError(
                    f"{path}.{key_text}: secret-bearing evidence field is forbidden"
                )
            _ensure_evidence_safe(item, f"{path}.{key_text}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _ensure_evidence_safe(item, f"{path}[{index}]")
    elif isinstance(value, str) and redact_text(value) != value:
        raise FoundationCandidateError(
            f"{path}: secret-bearing evidence value is forbidden"
        )


def _schema_descriptor(contract: Mapping[str, Any], schema_name: str) -> dict[str, Any]:
    definition = contract["schemas"][schema_name]
    schema_path = SCHEMA_ROOT / definition["file"]
    return {
        "id": definition["id"],
        "version": definition["version"],
        "sha256": _sha256_file(schema_path),
    }


def load_foundation_tuples() -> tuple[FoundationTuple, ...]:
    if _sha256_file(MATRIX_PATH) != MATRIX["sha256"]:
        raise FoundationCandidateError("Foundation runtime matrix SHA-256 mismatch")
    expander = _load_module(EXPANDER_PATH, "_agent_v2_runtime_matrix_expander")
    try:
        matrix = expander.load_matrix(MATRIX_PATH)
        keys, counts = expander.expand_matrix(matrix)
        policies = expander.role_policy_by_row(matrix, GATE_ID)
    except Exception as error:
        raise FoundationCandidateError(f"Foundation runtime matrix rejected: {error}") from error
    profiles: dict[str, RuntimeAttestationProfile] = {}
    for row in matrix.get("rows", ()):
        if not isinstance(row, Mapping) or row.get("gate") != GATE_ID:
            continue
        row_id = row.get("id")
        profile = row.get("runtime_attestation_profile")
        if not isinstance(row_id, str) or profile not in RUNTIME_ATTESTATION_PROFILES:
            raise FoundationCandidateError(
                f"Foundation row {row_id!r} has no supported "
                "runtime_attestation_profile"
            )
        profiles[row_id] = profile
    expected_count = 419
    if counts.get(GATE_ID) != expected_count:
        raise FoundationCandidateError(
            f"Foundation tuple count mismatch: expected {expected_count}, "
            f"got {counts.get(GATE_ID, 0)}"
        )
    foundation_keys = tuple(key for key in keys if key[0] == GATE_ID)
    foundation_rows = {key[1] for key in foundation_keys}
    if set(policies) != foundation_rows or set(profiles) != foundation_rows:
        raise FoundationCandidateError(
            "Foundation matrix row policy/profile coverage is incomplete"
        )
    role_union: set[str] = set()
    role_policies: dict[str, FoundationRolePolicy] = {}
    for row_id in sorted(foundation_rows):
        raw_policy = policies[row_id]
        policy = FoundationRolePolicy(
            always=raw_policy["always"],
            required=raw_policy["required"],
            not_applicable=raw_policy["not_applicable"],
        )
        declared_roles = policy.applicable | frozenset(policy.not_applicable)
        if declared_roles != set(SCENARIO_ROLES):
            missing = sorted(set(SCENARIO_ROLES) - declared_roles)
            unexpected = sorted(declared_roles - set(SCENARIO_ROLES))
            raise FoundationCandidateError(
                f"Foundation row {row_id} role policy does not partition "
                f"scenario roles; missing={missing}, unexpected={unexpected}"
            )
        role_union.update(policy.applicable)
        role_policies[row_id] = policy
    if role_union != set(SCENARIO_ROLES):
        raise FoundationCandidateError(
            "Foundation row role-policy union differs from Gate scenario roles"
        )
    tuples = tuple(
        FoundationTuple(
            *key,
            role_policy=role_policies[key[1]],
            runtime_attestation_profile=profiles[key[1]],
        )
        for key in foundation_keys
    )
    unknown_rows = sorted({item.row for item in tuples} - set(ROW_ADAPTERS))
    if unknown_rows:
        raise FoundationCandidateError(
            f"Foundation matrix contains unroutable rows: {unknown_rows}"
        )
    if len(tuples) != expected_count or len({item.key for item in tuples}) != expected_count:
        raise FoundationCandidateError("Foundation matrix is missing or duplicates tuples")
    return tuples


class FoundationCandidateProducer:
    def __init__(self, adapters: FoundationAdapters) -> None:
        self._adapters = adapters
        self._contract = _load_json(CONTRACT_PATH)
        self._validator = _load_module(
            VALIDATOR_PATH,
            "_foundation_candidate_semantic_validator",
        )
        self._runtime_matrix = dict(self._contract["matrix"])
        self._runtime_matrix.pop("source")
        if {
            key: self._runtime_matrix[key]
            for key in ("id", "version", "sha256")
        } != MATRIX:
            raise FoundationCandidateError(
                "proof contract and Gate runtime matrix identities differ"
            )
        role_contracts = _load_json(
            SCHEMA_ROOT / "evidence-role.schema.json"
        ).get("x-role-contracts")
        if not isinstance(role_contracts, dict):
            raise FoundationCandidateError("evidence role contracts are missing")
        self._required_observation_fields = {
            role: frozenset(role_contracts[role]["requiredObservationFields"])
            for role in EVIDENCE_ROLES
        }

    def _observe(self, runtime_tuple: FoundationTuple) -> FoundationTupleObservation:
        adapter_name = ROW_ADAPTERS[runtime_tuple.row]
        adapter = getattr(self._adapters, adapter_name)
        method = getattr(adapter, f"observe_{adapter_name}")
        try:
            observation = method(runtime_tuple)
        except Exception as error:
            raise FoundationCandidateError(
                f"{runtime_tuple.key}: {adapter_name} adapter failed: {error}"
            ) from error
        if not isinstance(observation, FoundationTupleObservation):
            raise FoundationCandidateError(
                f"{runtime_tuple.key}: adapter returned no typed observation"
            )
        return observation

    def _validate_observation(
        self,
        runtime_tuple: FoundationTuple,
        observation: FoundationTupleObservation,
    ) -> None:
        if observation.tuple_key != runtime_tuple.key:
            raise FoundationCandidateError(
                f"{runtime_tuple.key}: observation tuple identity mismatch"
            )
        if not observation.observed:
            raise FoundationCandidateError(
                f"{runtime_tuple.key}: tuple was not observed"
            )
        if not observation.passed:
            raise FoundationCandidateError(
                f"{runtime_tuple.key}: tuple oracle did not pass"
            )
        attestation = observation.runtime_attestation
        if not isinstance(attestation, FoundationRuntimeAttestation):
            raise FoundationCandidateError(
                f"{runtime_tuple.key}: adapter returned no typed runtime attestation"
            )
        if attestation.profile != runtime_tuple.runtime_attestation_profile:
            raise FoundationCandidateError(
                f"{runtime_tuple.key}: runtime attestation profile mismatch; "
                f"expected={runtime_tuple.runtime_attestation_profile}, "
                f"actual={attestation.profile}"
            )
        attestation_payload = attestation.to_dict()
        actor_hash = attestation_payload.get("actorIdentityHash")
        if (
            actor_hash is not None
            and (
                not isinstance(actor_hash, str)
                or SHA256.fullmatch(actor_hash) is None
            )
        ):
            raise FoundationCandidateError(
                f"{runtime_tuple.key}: actor identity hash is invalid"
            )
        if (
            not isinstance(attestation_payload.get("observedAt"), str)
            or not attestation_payload["observedAt"]
        ):
            raise FoundationCandidateError(
                f"{runtime_tuple.key}: runtime observation timestamp is missing"
            )
        _ensure_evidence_safe(
            attestation_payload,
            f"{runtime_tuple.key}.runtimeAttestation",
        )
        try:
            self._validator.validate_runtime_attestation(
                {**runtime_tuple.to_dict(), **attestation_payload},
                label=runtime_tuple.key,
                expected_profile=runtime_tuple.runtime_attestation_profile,
            )
        except RuntimeError as error:
            raise FoundationCandidateError(
                f"{runtime_tuple.key}: invalid runtime attestation: {error}"
            ) from error
        applicable_roles = runtime_tuple.role_policy.adapter_roles
        if set(observation.role_observations) != applicable_roles:
            missing = sorted(applicable_roles - set(observation.role_observations))
            unexpected = sorted(set(observation.role_observations) - applicable_roles)
            raise FoundationCandidateError(
                f"{runtime_tuple.key}: role observations mismatch; "
                f"missing={missing}, unexpected={unexpected}"
            )
        for role in applicable_roles:
            required_fields = self._required_observation_fields[role]
            payload = observation.role_observations[role]
            if not isinstance(payload, Mapping) or not payload:
                raise FoundationCandidateError(
                    f"{runtime_tuple.key}: {role} observation is empty"
                )
            missing_fields = sorted(required_fields - set(payload))
            if missing_fields:
                raise FoundationCandidateError(
                    f"{runtime_tuple.key}: {role} observation misses "
                    f"{missing_fields}"
                )
            _ensure_evidence_safe(payload, f"{runtime_tuple.key}.{role}")

    def collect(self) -> tuple[tuple[FoundationTuple, FoundationTupleObservation], ...]:
        collected: list[tuple[FoundationTuple, FoundationTupleObservation]] = []
        seen: set[str] = set()
        actor_hash: str | None = None
        for runtime_tuple in load_foundation_tuples():
            observation = self._observe(runtime_tuple)
            self._validate_observation(runtime_tuple, observation)
            if observation.tuple_key in seen:
                raise FoundationCandidateError(
                    f"{runtime_tuple.key}: duplicate observed tuple"
                )
            seen.add(observation.tuple_key)
            current_actor = observation.runtime_attestation.payload.get(
                "actorIdentityHash"
            )
            if current_actor is not None:
                if actor_hash is None:
                    actor_hash = str(current_actor)
                elif actor_hash != current_actor:
                    raise FoundationCandidateError(
                        f"{runtime_tuple.key}: actor identity differs across tuples"
                    )
            collected.append((runtime_tuple, observation))
        if len(collected) != 419 or len(seen) != 419:
            raise FoundationCandidateError(
                f"Foundation observations incomplete: expected 419, got {len(seen)}"
            )
        if actor_hash is None:
            raise FoundationCandidateError(
                "Foundation direct-runtime actor identity is missing"
            )
        return tuple(collected)

    def produce(self, run: RunHandle) -> Path:
        if run.gate_id != GATE_ID:
            raise FoundationCandidateError(
                f"candidate run Gate must be {GATE_ID}, got {run.gate_id}"
            )
        expected_source = source_identity(REPO_ROOT)
        if run.source != expected_source:
            raise FoundationCandidateError(
                "candidate run source identity does not match the current worktree"
            )

        collected = self.collect()
        observed_at = max(
            str(observation.runtime_attestation.payload["observedAt"])
            for _, observation in collected
        )
        actor_hash = next(
            str(actor_hash)
            for _, observation in collected
            if (
                actor_hash
                := observation.runtime_attestation.payload.get(
                    "actorIdentityHash"
                )
            )
        )
        runtime_keys = [runtime_tuple.key for runtime_tuple, _ in collected]
        evidence_schema = _schema_descriptor(self._contract, "evidence-role")

        runtime_tuples = []
        for runtime_tuple, observation in collected:
            runtime_tuples.append(
                {
                    **runtime_tuple.to_dict(),
                    **observation.runtime_attestation.to_dict(),
                }
            )
        runtime_artifact = {
            "artifactKind": "agent-v2-runtime-attestation-set",
            "schema": _schema_descriptor(
                self._contract, "runtime-attestation-set"
            ),
            "role": "runtime-attestation-set",
            "gateId": GATE_ID,
            "runId": run.run_id,
            "sourceIdentity": expected_source,
            "runtimeMatrix": self._runtime_matrix,
            "tuples": runtime_tuples,
            "oracle": {
                "assertionId": "foundation-runtime-matrix-exact",
                "status": "passed",
                "expectedTupleCount": 419,
            },
            "observedAt": observed_at,
        }
        runtime_attestations = dict(zip(runtime_keys, runtime_tuples))

        evidence_artifacts = {}
        for role in EVIDENCE_ROLES:
            oracle_id = f"foundation-{role}-oracle"
            observations = []
            applicable = tuple(
                (runtime_tuple, observation)
                for runtime_tuple, observation in collected
                if role in runtime_tuple.role_policy.adapter_roles
            )
            for runtime_tuple, observation in applicable:
                payload = dict(observation.role_observations[role])
                payload.update(
                    {
                        "runtimeTupleKey": runtime_tuple.key,
                        "scenarioId": runtime_tuple.cell,
                        "sampleId": runtime_tuple.sample_id,
                        "actorIdentityHash": actor_hash,
                        "oracleAssertionId": oracle_id,
                    }
                )
                if "cellId" in payload:
                    payload["cellId"] = runtime_tuple.cell
                observations.append(payload)
            role_runtime_keys = [
                runtime_tuple.key for runtime_tuple, _ in applicable
            ]
            role_scenario_ids = sorted(
                {runtime_tuple.cell for runtime_tuple, _ in applicable}
            )
            role_runtime_attestations = {
                key: runtime_attestations[key] for key in role_runtime_keys
            }
            actual_hash = hashlib.sha256(
                json.dumps(
                    observations,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()
            artifact = {
                "artifactKind": "agent-v2-gate-evidence",
                "schema": evidence_schema,
                "role": role,
                "gateId": GATE_ID,
                "runId": run.run_id,
                "sourceIdentity": expected_source,
                "runtimeMatrix": self._runtime_matrix,
                "actorIdentityHash": actor_hash,
                "runtimeAttestationRefs": role_runtime_keys,
                "scenarioIds": role_scenario_ids,
                "sampleCount": len(observations),
                "observations": observations,
                "oracle": {
                    "assertionId": oracle_id,
                    "status": "passed",
                    "expected": (
                        "every applicable Foundation tuple passed its "
                        "role-specific oracle"
                    ),
                    "actualHash": actual_hash,
                },
                "observedAt": observed_at,
            }
            try:
                self._validator.validate_gate_evidence_semantics(
                    self._contract,
                    role,
                    artifact,
                    runtime_attestations,
                    set(role_runtime_keys),
                )
            except RuntimeError as error:
                raise FoundationCandidateError(
                    f"{role}: invalid assembled evidence: {error}"
                ) from error
            evidence_artifacts[role] = artifact

        role_references = {
            "runtime-attestation-set": run.write_json(
                "roles/runtime-attestation-set.json",
                runtime_artifact,
                role="runtime-attestation-set",
                redact=False,
            )
        }
        for role, artifact in evidence_artifacts.items():
            role_references[role] = run.write_json(
                f"roles/{role}.json",
                artifact,
                role=role,
                redact=False,
            )

        candidate = {
            "gateId": GATE_ID,
            "runtimeMatrix": MATRIX,
            "scenarioExecuted": True,
            "proofStatus": "UNPROVEN",
            "artifacts": [
                {
                    "role": role,
                    "path": str(run.store.resolve(reference)),
                }
                for role, reference in sorted(role_references.items())
            ],
        }
        candidate_ref = run.write_json(
            "candidate/foundation-candidate.json",
            candidate,
            redact=False,
        )
        return run.store.resolve(candidate_ref)
