#!/usr/bin/env python3
"""Shared fail-closed assembler for Agent V2 Gate candidates."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any, Iterable, Mapping, Protocol

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import RunHandle, source_identity
from tooling.acceptance.core.redaction import is_sensitive_key, redact_text
from tooling.acceptance.gates.agent.agent_v2_gate import (
    GATE_ROLES,
    MATRIX,
    RUNNER_GENERATED_ROLES,
)

VALIDATOR_PATH = REPO_ROOT / "tooling/scripts/acceptance-validate.py"
SCHEMA_ROOT = REPO_ROOT / "tooling/acceptance/schemas/agent-v2"
CONTRACT_PATH = SCHEMA_ROOT / "contract.json"
MATRIX_PATH = REPO_ROOT / "tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml"
EXPANDER_PATH = REPO_ROOT / "tooling/scripts/expand-agent-v2-runtime-matrix.py"
FOUNDATION_GATE_ID = "agent-v2-kernel-foundation-e2e"
RUNTIME_MANIFEST_ENV = "PT_ACCEPTANCE_RUNTIME_MANIFEST"
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
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_SCHEMA_KEYS = {
    "actual_tokens",
    "cacheTokens",
    "cache_tokens",
    "cleanupFencingToken",
    "contextTokens",
    "context_tokens",
    "credentialStatus",
    "fencingToken",
    "hasTokenAccounting",
    "inputTokens",
    "input_tokens",
    "limit_tokens",
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


class AgentV2CandidateError(RuntimeError):
    """Observed Gate evidence cannot form a valid immutable candidate."""


def load_preprovisioned_runtime_manifest(
    gate_id: str,
    *,
    repo_root: Path = REPO_ROOT,
    environment: Mapping[str, str] | None = None,
) -> dict[str, Any] | None:
    current_environment = os.environ if environment is None else environment
    raw_path = current_environment.get(RUNTIME_MANIFEST_ENV, "").strip()
    if not raw_path:
        return None
    manifest_path = Path(raw_path).expanduser().resolve()
    if not manifest_path.is_file():
        raise AgentV2CandidateError(
            f"{RUNTIME_MANIFEST_ENV} is missing: {manifest_path}"
        )
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AgentV2CandidateError(
            f"{RUNTIME_MANIFEST_ENV} is unreadable: {error}"
        ) from error
    if not isinstance(manifest, dict):
        raise AgentV2CandidateError(
            f"{RUNTIME_MANIFEST_ENV} must contain an object"
        )
    if manifest.get("gateId") != gate_id:
        raise AgentV2CandidateError(
            f"{RUNTIME_MANIFEST_ENV} Gate does not match {gate_id}"
        )
    if manifest.get("state") != "FIXTURE_READY":
        raise AgentV2CandidateError(
            f"{RUNTIME_MANIFEST_ENV} is not FIXTURE_READY"
        )
    source = manifest.get("source")
    if not isinstance(source, Mapping):
        raise AgentV2CandidateError(
            f"{RUNTIME_MANIFEST_ENV} source identity is missing"
        )
    expected_source = source_identity(repo_root)
    observed_worktree = Path(str(source.get("worktree") or "")).resolve()
    if (
        observed_worktree != repo_root.resolve()
        or source.get("commit") != expected_source["commit"]
        or source.get("workspaceDigest") != expected_source["workspaceDigest"]
    ):
        raise AgentV2CandidateError(
            f"{RUNTIME_MANIFEST_ENV} source identity does not match current source"
        )
    if not isinstance(manifest.get("services"), Mapping) or not isinstance(
        manifest.get("clients"),
        list,
    ):
        raise AgentV2CandidateError(
            f"{RUNTIME_MANIFEST_ENV} runtime bindings are incomplete"
        )
    return manifest


@dataclass(frozen=True)
class AgentV2RolePolicy:
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
class AgentV2RuntimeTuple:
    gate: str
    row: str
    platform: str
    runtime: str
    cell: str
    locale: str
    ordering: str
    sample_id: str
    role_policy: AgentV2RolePolicy
    runtime_attestation_profile: str

    @property
    def key(self) -> str:
        return json.dumps(
            [getattr(self, field) for field in TUPLE_FIELDS],
            separators=(",", ":"),
        )

    def to_dict(self) -> dict[str, str]:
        return {field: getattr(self, field) for field in TUPLE_FIELDS}


@dataclass(frozen=True)
class AgentV2RuntimeAttestation:
    profile: str
    payload: Mapping[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {"attestationProfile": self.profile, **dict(self.payload)}


@dataclass(frozen=True)
class AgentV2TupleObservation:
    tuple_key: str
    observed: bool
    passed: bool
    runtime_attestation: AgentV2RuntimeAttestation
    role_observations: Mapping[str, Mapping[str, Any]]


class RuntimeTuple(Protocol):
    key: str
    cell: str
    sample_id: str
    role_policy: Any
    runtime_attestation_profile: str

    def to_dict(self) -> dict[str, str]: ...


class RuntimeAttestation(Protocol):
    payload: Mapping[str, Any]

    def to_dict(self) -> dict[str, Any]: ...


class TupleObservation(Protocol):
    tuple_key: str
    observed: bool
    passed: bool
    runtime_attestation: RuntimeAttestation
    role_observations: Mapping[str, Mapping[str, Any]]


def _load_module(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AgentV2CandidateError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise AgentV2CandidateError(f"cannot load JSON {path}: {error}") from error
    if not isinstance(value, dict):
        raise AgentV2CandidateError(f"JSON document must be an object: {path}")
    return value


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as error:
        raise AgentV2CandidateError(f"cannot hash {path}: {error}") from error


def ensure_evidence_safe(value: Any, path: str) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            if is_sensitive_key(key_text) and key_text not in SAFE_SCHEMA_KEYS:
                raise AgentV2CandidateError(
                    f"{path}.{key_text}: secret-bearing evidence field is forbidden"
                )
            ensure_evidence_safe(item, f"{path}.{key_text}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            ensure_evidence_safe(item, f"{path}[{index}]")
    elif isinstance(value, str) and redact_text(value) != value:
        raise AgentV2CandidateError(
            f"{path}: secret-bearing evidence value is forbidden"
        )


def load_gate_tuples(gate_id: str) -> tuple[AgentV2RuntimeTuple, ...]:
    if gate_id not in GATE_ROLES:
        raise AgentV2CandidateError(f"unsupported Agent V2 Gate: {gate_id}")
    if _sha256_file(MATRIX_PATH) != MATRIX["sha256"]:
        raise AgentV2CandidateError("Agent V2 runtime matrix SHA-256 mismatch")
    expander = _load_module(
        EXPANDER_PATH,
        f"_agent_v2_matrix_expander_{gate_id.replace('-', '_')}",
    )
    try:
        matrix = expander.load_matrix(MATRIX_PATH)
        keys, counts = expander.expand_matrix(matrix)
        policies = expander.role_policy_by_row(matrix, gate_id)
        profiles = expander.runtime_attestation_profile_by_row(matrix, gate_id)
    except Exception as error:
        raise AgentV2CandidateError(
            f"Agent V2 runtime matrix rejected: {error}"
        ) from error
    contract = _load_json(CONTRACT_PATH)
    expected_count = contract["gates"][gate_id]["expectedTuples"]
    if counts.get(gate_id) != expected_count:
        raise AgentV2CandidateError(
            f"{gate_id}: expected {expected_count} tuples, "
            f"got {counts.get(gate_id, 0)}"
        )
    gate_keys = tuple(key for key in keys if key[0] == gate_id)
    rows = {key[1] for key in gate_keys}
    if set(policies) != rows or set(profiles) != rows:
        raise AgentV2CandidateError(
            f"{gate_id}: row policy/profile coverage is incomplete"
        )
    scenario_roles = {
        role
        for role in GATE_ROLES[gate_id]
        if role not in RUNNER_GENERATED_ROLES
    }
    role_policies: dict[str, AgentV2RolePolicy] = {}
    for row in rows:
        raw = policies[row]
        policy = AgentV2RolePolicy(
            always=raw["always"],
            required=raw["required"],
            not_applicable=raw["not_applicable"],
        )
        declared = policy.applicable | frozenset(policy.not_applicable)
        if declared != scenario_roles:
            raise AgentV2CandidateError(
                f"{gate_id}/{row}: role policy does not partition Gate roles"
            )
        role_policies[row] = policy
    tuples = tuple(
        AgentV2RuntimeTuple(
            *key,
            role_policy=role_policies[key[1]],
            runtime_attestation_profile=profiles[key[1]],
        )
        for key in gate_keys
    )
    if len(tuples) != expected_count or len({item.key for item in tuples}) != expected_count:
        raise AgentV2CandidateError(
            f"{gate_id}: runtime matrix is missing or duplicates tuples"
        )
    return tuples


class AgentV2CandidateAssembler:
    """Assemble already-observed tuple evidence without inventing facts."""

    def __init__(self, gate_id: str) -> None:
        if gate_id not in GATE_ROLES:
            raise AgentV2CandidateError(f"unsupported Agent V2 Gate: {gate_id}")
        self.gate_id = gate_id
        self.contract = _load_json(CONTRACT_PATH)
        self.validator = _load_module(
            VALIDATOR_PATH,
            f"_agent_v2_candidate_validator_{gate_id.replace('-', '_')}",
        )
        self.runtime_matrix = dict(self.contract["matrix"])
        self.runtime_matrix.pop("source")
        if {
            key: self.runtime_matrix[key]
            for key in ("id", "version", "sha256")
        } != MATRIX:
            raise AgentV2CandidateError(
                "proof contract and Gate runtime matrix identities differ"
            )
        role_contracts = _load_json(
            SCHEMA_ROOT / "evidence-role.schema.json"
        ).get("x-role-contracts")
        if not isinstance(role_contracts, dict):
            raise AgentV2CandidateError("evidence role contracts are missing")
        self.scenario_roles = tuple(
            role
            for role in GATE_ROLES[gate_id]
            if role not in RUNNER_GENERATED_ROLES
        )
        self.evidence_roles = tuple(
            role for role in self.scenario_roles if role != "runtime-attestation-set"
        )
        self.required_observation_fields = {
            role: frozenset(role_contracts[role]["requiredObservationFields"])
            for role in self.evidence_roles
        }
        self.runtime_tuples = load_gate_tuples(gate_id)
        self.runtime_tuples_by_key = {
            runtime_tuple.key: runtime_tuple
            for runtime_tuple in self.runtime_tuples
        }

    def schema_descriptor(self, schema_name: str) -> dict[str, Any]:
        definition = self.contract["schemas"][schema_name]
        schema_path = SCHEMA_ROOT / definition["file"]
        return {
            "id": definition["id"],
            "version": definition["version"],
            "sha256": _sha256_file(schema_path),
        }

    def _validate_collected(
        self,
        collected: tuple[tuple[RuntimeTuple, TupleObservation], ...],
    ) -> tuple[str, str]:
        expected_count = self.contract["gates"][self.gate_id]["expectedTuples"]
        if len(collected) != expected_count:
            raise AgentV2CandidateError(
                f"{self.gate_id}: expected {expected_count} observations, "
                f"got {len(collected)}"
            )
        tuple_keys: set[str] = set()
        execution_ids: set[str] = set()
        primary_execution_ids: set[tuple[str, str]] = set()
        actor_hash: str | None = None
        observed_at = ""
        for runtime_tuple, observation in collected:
            expected_tuple = self.runtime_tuples_by_key.get(runtime_tuple.key)
            if expected_tuple is None:
                raise AgentV2CandidateError(
                    f"{runtime_tuple.key}: tuple is outside the reviewed matrix"
                )
            if (
                runtime_tuple.to_dict() != expected_tuple.to_dict()
                or runtime_tuple.runtime_attestation_profile
                != expected_tuple.runtime_attestation_profile
                or runtime_tuple.role_policy.applicable
                != expected_tuple.role_policy.applicable
            ):
                raise AgentV2CandidateError(
                    f"{runtime_tuple.key}: tuple policy/profile differs from "
                    "the reviewed matrix"
                )
            if observation.tuple_key != runtime_tuple.key:
                raise AgentV2CandidateError(
                    f"{runtime_tuple.key}: observation tuple identity mismatch"
                )
            if not observation.observed or not observation.passed:
                raise AgentV2CandidateError(
                    f"{runtime_tuple.key}: tuple was not observed and passed"
                )
            if runtime_tuple.key in tuple_keys:
                raise AgentV2CandidateError(
                    f"{runtime_tuple.key}: duplicate observed tuple"
                )
            tuple_keys.add(runtime_tuple.key)
            attestation = observation.runtime_attestation.to_dict()
            ensure_evidence_safe(
                attestation,
                f"{runtime_tuple.key}.runtimeAttestation",
            )
            try:
                self.validator.validate_runtime_attestation(
                    {**runtime_tuple.to_dict(), **attestation},
                    label=runtime_tuple.key,
                    expected_profile=runtime_tuple.runtime_attestation_profile,
                )
            except RuntimeError as error:
                raise AgentV2CandidateError(
                    f"{runtime_tuple.key}: invalid runtime attestation: {error}"
                ) from error
            if self.gate_id != FOUNDATION_GATE_ID:
                execution_id = attestation.get("scenarioExecutionId")
                if not isinstance(execution_id, str) or not execution_id:
                    raise AgentV2CandidateError(
                        f"{runtime_tuple.key}: scenario execution ID is missing"
                    )
                if execution_id in execution_ids:
                    raise AgentV2CandidateError(
                        f"{runtime_tuple.key}: duplicate scenario execution identity"
                    )
                execution_ids.add(execution_id)
                primary_execution_id = self.validator.primary_execution_identity(
                    {**runtime_tuple.to_dict(), **attestation}
                )
                if primary_execution_id in primary_execution_ids:
                    raise AgentV2CandidateError(
                        f"{runtime_tuple.key}: duplicate primary execution identity"
                    )
                primary_execution_ids.add(primary_execution_id)
            current_actor = attestation.get("actorIdentityHash")
            if current_actor is not None:
                if not isinstance(current_actor, str) or not SHA256.fullmatch(
                    current_actor
                ):
                    raise AgentV2CandidateError(
                        f"{runtime_tuple.key}: actor identity hash is invalid"
                    )
                if actor_hash is None:
                    actor_hash = current_actor
                elif actor_hash != current_actor:
                    raise AgentV2CandidateError(
                        f"{runtime_tuple.key}: actor identity differs across tuples"
                    )
            current_observed_at = attestation.get("observedAt")
            if not isinstance(current_observed_at, str) or not current_observed_at:
                raise AgentV2CandidateError(
                    f"{runtime_tuple.key}: observation timestamp is missing"
                )
            observed_at = max(observed_at, current_observed_at)
            applicable_roles = runtime_tuple.role_policy.adapter_roles
            if set(observation.role_observations) != applicable_roles:
                missing = sorted(
                    applicable_roles - set(observation.role_observations)
                )
                unexpected = sorted(
                    set(observation.role_observations) - applicable_roles
                )
                raise AgentV2CandidateError(
                    f"{runtime_tuple.key}: role observations mismatch; "
                    f"missing={missing}, unexpected={unexpected}"
                )
            for role in applicable_roles:
                payload = observation.role_observations[role]
                missing_fields = sorted(
                    self.required_observation_fields[role] - set(payload)
                )
                if missing_fields:
                    raise AgentV2CandidateError(
                        f"{runtime_tuple.key}: {role} observation misses "
                        f"{missing_fields}"
                    )
                ensure_evidence_safe(payload, f"{runtime_tuple.key}.{role}")
        if actor_hash is None:
            raise AgentV2CandidateError(
                f"{self.gate_id}: actor identity is missing"
            )
        if tuple_keys != set(self.runtime_tuples_by_key):
            raise AgentV2CandidateError(
                f"{self.gate_id}: observed tuple set differs from reviewed matrix"
            )
        return actor_hash, observed_at

    def produce(
        self,
        run: RunHandle,
        collected_observations: Iterable[
            tuple[RuntimeTuple, TupleObservation]
        ],
        *,
        candidate_name: str,
    ) -> Path:
        if run.gate_id != self.gate_id:
            raise AgentV2CandidateError(
                f"candidate run Gate must be {self.gate_id}, got {run.gate_id}"
            )
        expected_source = source_identity(REPO_ROOT)
        if run.source != expected_source:
            raise AgentV2CandidateError(
                "candidate run source identity does not match the current worktree"
            )
        collected = tuple(collected_observations)
        actor_hash, observed_at = self._validate_collected(collected)
        runtime_keys = [runtime_tuple.key for runtime_tuple, _ in collected]
        runtime_tuples = [
            {
                **runtime_tuple.to_dict(),
                **observation.runtime_attestation.to_dict(),
            }
            for runtime_tuple, observation in collected
        ]
        runtime_attestations = dict(zip(runtime_keys, runtime_tuples))
        runtime_artifact = {
            "artifactKind": "agent-v2-runtime-attestation-set",
            "schema": self.schema_descriptor("runtime-attestation-set"),
            "role": "runtime-attestation-set",
            "gateId": self.gate_id,
            "runId": run.run_id,
            "sourceIdentity": expected_source,
            "runtimeMatrix": self.runtime_matrix,
            "tuples": runtime_tuples,
            "oracle": {
                "assertionId": f"{self.gate_id}-runtime-matrix-exact",
                "status": "passed",
                "expectedTupleCount": len(runtime_tuples),
            },
            "observedAt": observed_at,
        }

        evidence_schema = self.schema_descriptor("evidence-role")
        evidence_artifacts: dict[str, dict[str, Any]] = {}
        for role in self.evidence_roles:
            oracle_id = f"{self.gate_id}-{role}-oracle"
            applicable = tuple(
                (runtime_tuple, observation)
                for runtime_tuple, observation in collected
                if role in runtime_tuple.role_policy.adapter_roles
            )
            observations: list[dict[str, Any]] = []
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
                if self.gate_id != FOUNDATION_GATE_ID:
                    payload["scenarioExecutionId"] = (
                        observation.runtime_attestation.payload[
                            "scenarioExecutionId"
                        ]
                    )
                if "cellId" in payload:
                    payload["cellId"] = runtime_tuple.cell
                observations.append(payload)
            role_runtime_keys = [
                runtime_tuple.key for runtime_tuple, _ in applicable
            ]
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
                "gateId": self.gate_id,
                "runId": run.run_id,
                "sourceIdentity": expected_source,
                "runtimeMatrix": self.runtime_matrix,
                "actorIdentityHash": actor_hash,
                "runtimeAttestationRefs": role_runtime_keys,
                "scenarioIds": sorted(
                    {runtime_tuple.cell for runtime_tuple, _ in applicable}
                ),
                "sampleCount": len(observations),
                "observations": observations,
                "oracle": {
                    "assertionId": oracle_id,
                    "status": "passed",
                    "expected": (
                        "every applicable tuple passed its role-specific oracle"
                    ),
                    "actualHash": actual_hash,
                },
                "observedAt": observed_at,
            }
            try:
                self.validator.validate_gate_evidence_semantics(
                    self.contract,
                    role,
                    artifact,
                    runtime_attestations,
                    set(role_runtime_keys),
                )
            except RuntimeError as error:
                raise AgentV2CandidateError(
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
            "gateId": self.gate_id,
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
            f"candidate/{candidate_name}.json",
            candidate,
            redact=False,
        )
        return run.store.resolve(candidate_ref)
