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
from tooling.acceptance.gates.agent.agent_v2_candidate_producer import (
    AgentV2CandidateAssembler,
    AgentV2CandidateError,
    ensure_evidence_safe,
)
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
    "direct_runtime_secondary_native",
    "station_turn",
    "contract_only",
    "orchestration_guard",
    "non_advertised",
]
RUNTIME_ATTESTATION_PROFILES = {
    "direct_runtime",
    "direct_runtime_secondary_native",
    "station_turn",
    "contract_only",
    "orchestration_guard",
    "non_advertised",
}
ROW_ADAPTERS = {
    "foundation-desktop-direct": "desktop_native",
    "foundation-secondary-direct": "secondary",
    "foundation-mobile-contract": "mobile_contract",
    "foundation-d11": "d11",
    "foundation-desktop-cli-absent": "non_advertisement",
    "foundation-secondary-cli-absent": "non_advertisement",
    "foundation-desktop-external-absent": "non_advertisement",
    "foundation-secondary-external-absent": "non_advertisement",
    "foundation-z-desktop-external-runtime": "desktop_native",
    "foundation-z-secondary-external-runtime": "secondary",
}
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class FoundationCandidateError(RuntimeError):
    """The producer cannot establish an exact, observed Foundation candidate."""


def _ensure_evidence_safe(value: Any, path: str) -> None:
    try:
        ensure_evidence_safe(value, path)
    except AgentV2CandidateError as error:
        raise FoundationCandidateError(str(error)) from error


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


class SecondaryFoundationAdapter(Protocol):
    def observe_secondary(
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
    secondary: SecondaryFoundationAdapter
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


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as error:
        raise FoundationCandidateError(f"cannot hash matrix {path}: {error}") from error


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
        self._assembler = AgentV2CandidateAssembler(GATE_ID)
        self._validator = self._assembler.validator
        self._required_observation_fields = (
            self._assembler.required_observation_fields
        )

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
        if run.source != source_identity(REPO_ROOT):
            raise FoundationCandidateError(
                "candidate run source identity does not match the current worktree"
            )
        try:
            return self._assembler.produce(
                run,
                self.collect(),
                candidate_name="foundation-candidate",
            )
        except AgentV2CandidateError as error:
            raise FoundationCandidateError(str(error)) from error
