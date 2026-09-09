#!/usr/bin/env python3
"""Validate acceptance capability/domain consistency."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (
    ArtifactRef,
    ArtifactSession,
    EnvironmentContract,
    EvidenceStore,
    RUN_GATE_ENV,
    source_identity,
    validate_external_output_path,
)
from tooling.acceptance.core.errors import EvidenceManifestInvalid, ProvisioningError
from tooling.acceptance.finalizers import (
    load_strict_json_object,
    loads_strict_json_value,
)
from tooling.acceptance.provisioners import get_provisioner

AGENT_V2_SCHEMA_ROOT = REPO_ROOT / "tooling/acceptance/schemas/agent-v2"
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
RUNTIME_ATTESTATION_PROFILES = {
    "direct_runtime",
    "direct_runtime_no_local_capability",
    "contract_only",
    "orchestration_guard",
    "non_advertised",
}
GENERATED_ATTESTATION_ROLES = {
    "source-identity",
    "role-schema-report",
    "runner-attestation",
}

ALLOWED_GATE_TIERS = {
    "ci-structure",
    "ci-cheap",
    "local-evidence",
    "env-evidence",
    "nightly",
    "release",
}

ALLOWED_GATE_ENVIRONMENTS = {
    "local",
    "fedp5",
    "home-station",
    "local-desktop-gateway",
    "mobile-native",
    "native-tauri-embedded-webdriver",
}


def load(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError(f"required acceptance file is missing: {path}")
    try:
        return load_strict_json_object(path, str(path))
    except ValueError as error:
        raise RuntimeError(str(error)) from error


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def require_sha256(value: Any, label: str) -> None:
    require(
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value),
        f"{label} must be a lowercase SHA-256",
    )


def require_semantic_value(value: Any, label: str) -> None:
    if isinstance(value, str):
        require(bool(value), f"{label} must be non-empty")
    elif isinstance(value, (list, dict)):
        require(bool(value), f"{label} must be non-empty")
    else:
        require(value is not None, f"{label} must be present")


def require_nonnegative_integer(value: Any, label: str) -> int:
    require(
        type(value) is int and value >= 0,
        f"{label} must be a non-negative integer",
    )
    return value


def require_positive_integer(value: Any, label: str) -> int:
    require(
        type(value) is int and value > 0,
        f"{label} must be a positive integer",
    )
    return value


def require_unique_nonempty_strings(value: Any, label: str) -> list[str]:
    require(
        isinstance(value, list)
        and value
        and all(isinstance(item, str) and item for item in value)
        and len(value) == len(set(value)),
        f"{label} must contain unique non-empty strings",
    )
    return value


def validate_evidence_observation_success(
    role: str,
    observation: dict[str, Any],
    *,
    label: str,
    attestation_profile: str | None,
) -> None:
    if role == "cell-results":
        require(
            observation["status"] == "passed",
            f"{label}: cell result did not pass",
        )
    elif role == "cleanup":
        require(
            observation["status"] == "clean",
            f"{label}: cleanup is not clean",
        )
    elif role == "command-ids":
        require_unique_nonempty_strings(
            observation["objectIds"],
            f"{label}.objectIds",
        )
    elif role == "contract-evidence":
        require(
            observation["status"] == "passed"
            and observation["roundTripEqual"] is True,
            f"{label}: contract result must pass with exact round-trip equality",
        )
    elif role == "executor-receipts":
        require_positive_integer(
            observation["fencingToken"],
            f"{label}.fencingToken",
        )
        require(
            observation["status"]
            in {"APPLIED", "FAILED", "RECONCILED_UNKNOWN"},
            f"{label}: executor receipt must be terminal",
        )
    elif role == "guard-report":
        require(
            type(observation["violationCount"]) is int
            and observation["violationCount"] == 0
            and observation["passed"] is True,
            f"{label}: guard result must pass with zero violations",
        )
    elif role == "measurement-report":
        require_unique_nonempty_strings(
            observation["sampleIds"],
            f"{label}.sampleIds",
        )
        require(
            observation["passed"] is True,
            f"{label}: measurement did not pass",
        )
    elif role == "metrics-lineage":
        require_unique_nonempty_strings(
            observation["sourceAttemptIds"],
            f"{label}.sourceAttemptIds",
        )
    elif role == "oauth-resource-manifest":
        require_positive_integer(
            observation["connectionRevision"],
            f"{label}.connectionRevision",
        )
    elif role == "process-port-secret-canary":
        counts = (
            require_nonnegative_integer(
                observation[field],
                f"{label}.{field}",
            )
            for field in ("processCount", "portCount", "secretLeakCount")
        )
        require(
            all(count == 0 for count in counts)
            and observation["passed"] is True,
            f"{label}: process, port, or secret residue was observed",
        )
    elif role == "projection-revisions":
        before = require_nonnegative_integer(
            observation["beforeRevision"],
            f"{label}.beforeRevision",
        )
        after = require_nonnegative_integer(
            observation["afterRevision"],
            f"{label}.afterRevision",
        )
        require(
            after >= before,
            f"{label}: projection revision regressed",
        )
    elif role == "provider-revoke":
        require(
            observation["status"] in {"revoked", "revocation_unconfirmed"},
            f"{label}: provider revoke is not terminal",
        )
    elif role == "readiness-snapshots":
        require_positive_integer(
            observation["revision"],
            f"{label}.revision",
        )
        require(
            observation["authority"] == "station"
            and observation["state"]
            in {"ready", "degraded", "unavailable", "blocked"},
            f"{label}: readiness is not a Station-owned resolved state",
        )
    elif role == "receiver-dom":
        expected_visibility = attestation_profile != "non_advertised"
        require(
            observation["visible"] is expected_visibility,
            f"{label}: receiver DOM visibility does not match the runtime profile",
        )
    elif role == "replay":
        require(
            observation["equal"] is True
            and observation["sourceHash"] == observation["replayHash"],
            f"{label}: replay differs from source",
        )
    elif role == "runtime-events":
        require_positive_integer(
            observation["sequence"],
            f"{label}.sequence",
        )
    elif role == "side-effect-count":
        count = require_nonnegative_integer(
            observation["count"],
            f"{label}.count",
        )
        maximum = require_nonnegative_integer(
            observation["maximum"],
            f"{label}.maximum",
        )
        require(
            count <= maximum,
            f"{label}: side-effect bound exceeded",
        )
    elif role == "station-readback":
        require_positive_integer(
            observation["revision"],
            f"{label}.revision",
        )
    elif role == "turn-trace":
        require(
            observation["terminalStatus"]
            in {"completed", "failed", "cancelled", "interrupted"},
            f"{label}: turn trace is not terminal",
        )
    elif role == "zero-execution":
        count = require_nonnegative_integer(
            observation["count"],
            f"{label}.count",
        )
        expected = require_nonnegative_integer(
            observation["expected"],
            f"{label}.expected",
        )
        require(
            count == expected == 0,
            f"{label}: execution count is not zero",
        )


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_agent_v2_contract() -> dict[str, Any]:
    return load(AGENT_V2_SCHEMA_ROOT / "contract.json")


def schema_descriptor(
    contract: dict[str, Any],
    schema_name: str,
) -> dict[str, Any]:
    definition = contract["schemas"][schema_name]
    path = AGENT_V2_SCHEMA_ROOT / definition["file"]
    return {
        "id": definition["id"],
        "version": definition["version"],
        "sha256": sha256_file(path),
    }


def schema_document(contract: dict[str, Any], schema_name: str) -> dict[str, Any]:
    definition = contract["schemas"][schema_name]
    return load(AGENT_V2_SCHEMA_ROOT / definition["file"])


def validate_gate_evidence_semantics(
    contract: dict[str, Any],
    role: str,
    artifact: dict[str, Any],
    runtime_attestations: dict[str, dict[str, Any]],
    expected_runtime_keys: set[str],
) -> None:
    schema = schema_document(contract, "evidence-role")
    role_contracts = schema.get("x-role-contracts")
    require(
        isinstance(role_contracts, dict) and role in role_contracts,
        f"{role}: role-specific semantic contract is missing",
    )
    require_sha256(artifact.get("actorIdentityHash"), f"{role} actor identity")
    artifact_actor = artifact["actorIdentityHash"]
    runtime_refs = artifact.get("runtimeAttestationRefs")
    require(
        isinstance(runtime_refs, list)
        and runtime_refs
        and all(isinstance(item, str) and item for item in runtime_refs),
        f"{role}: runtime attestation refs must be non-empty",
    )
    require(
        len(runtime_refs) == len(set(runtime_refs))
        and set(runtime_refs) == expected_runtime_keys,
        f"{role}: runtime attestation coverage does not match applicable tuples",
    )
    scenario_ids = artifact.get("scenarioIds")
    require(
        isinstance(scenario_ids, list)
        and scenario_ids
        and all(isinstance(item, str) and item for item in scenario_ids),
        f"{role}: scenario IDs must be non-empty",
    )
    observations = artifact.get("observations")
    require(
        isinstance(observations, list) and observations,
        f"{role}: observations must be non-empty",
    )
    require(
        artifact.get("sampleCount") == len(observations),
        f"{role}: sampleCount does not match observations",
    )
    require(
        len(observations) == len(expected_runtime_keys),
        f"{role}: observation count does not match applicable tuples",
    )
    required_fields = role_contracts[role].get("requiredObservationFields")
    require(
        isinstance(required_fields, list) and required_fields,
        f"{role}: required observation fields are missing",
    )
    observed_runtime_keys: set[str] = set()
    observed_scenarios: set[str] = set()
    oracle = artifact.get("oracle")
    require(isinstance(oracle, dict), f"{role}: oracle must be an object")
    oracle_assertion_id = oracle.get("assertionId")
    for index, observation in enumerate(observations):
        require(
            isinstance(observation, dict),
            f"{role}: observation {index} must be an object",
        )
        missing = set(required_fields) - set(observation)
        require(
            not missing,
            f"{role}: observation {index} missing semantic fields "
            f"{sorted(missing)}",
        )
        for field in required_fields:
            require_semantic_value(
                observation[field],
                f"{role} observation {index}.{field}",
            )
        for field, value in observation.items():
            if field.lower().endswith("hash"):
                require_sha256(value, f"{role} observation {index}.{field}")
        for field in (
            "runtimeTupleKey",
            "scenarioId",
            "sampleId",
            "actorIdentityHash",
            "oracleAssertionId",
        ):
            require_semantic_value(
                observation.get(field),
                f"{role} observation {index}.{field}",
            )
        runtime_key = observation["runtimeTupleKey"]
        require(
            runtime_key in expected_runtime_keys,
            f"{role}: observation {index} references a non-applicable runtime tuple",
        )
        require(
            runtime_key not in observed_runtime_keys,
            f"{role}: duplicate runtime tuple observation",
        )
        attestation = runtime_attestations[runtime_key]
        attested_actor = attestation.get("actorIdentityHash")
        require(
            observation["sampleId"] == attestation["sample_id"]
            and observation["scenarioId"] == attestation["cell"]
            and observation["actorIdentityHash"] == artifact_actor
            and (
                attested_actor is None
                or observation["actorIdentityHash"] == attested_actor
            ),
            f"{role}: observation {index} is detached from runtime identity",
        )
        if "cellId" in observation:
            require(
                observation["cellId"] == attestation["cell"],
                f"{role}: observation {index} cell ID mismatch",
            )
        tool_binding = attestation.get("toolCallBinding", {})
        if "toolCallId" in observation:
            require(
                observation["toolCallId"] == tool_binding["toolCallId"],
                f"{role}: observation {index} ToolCall mismatch",
            )
        if "receiptId" in observation:
            require(
                observation["receiptId"] == tool_binding["sideEffectReceiptId"],
                f"{role}: observation {index} receipt mismatch",
            )
        if "turnId" in observation:
            require(
                observation["turnId"]
                == attestation.get("turnAttempt", {}).get("turnId"),
                f"{role}: observation {index} Turn mismatch",
            )
        if "snapshotId" in observation:
            require(
                observation["snapshotId"]
                == attestation.get("turnAttempt", {}).get(
                    "capabilityReadinessSnapshotId"
                ),
                f"{role}: observation {index} readiness mismatch",
            )
        if "providerId" in observation:
            require(
                observation["providerId"]
                == attestation.get("runtimeSnapshot", {}).get("providerId"),
                f"{role}: observation {index} provider mismatch",
            )
        require(
            observation["oracleAssertionId"] == oracle_assertion_id,
            f"{role}: observation {index} oracle binding mismatch",
        )
        observed_runtime_keys.add(runtime_key)
        observed_scenarios.add(observation["scenarioId"])
        validate_evidence_observation_success(
            role,
            observation,
            label=f"{role} observation {index}",
            attestation_profile=attestation.get("attestationProfile"),
        )
    require(
        observed_runtime_keys == expected_runtime_keys,
        f"{role}: runtime tuple observation set mismatch",
    )
    require(
        set(scenario_ids) == observed_scenarios,
        f"{role}: scenario ID set does not match observations",
    )
    require(
        oracle.get("status") == "passed"
        and isinstance(oracle.get("assertionId"), str)
        and bool(oracle["assertionId"])
        and isinstance(oracle.get("expected"), str)
        and bool(oracle["expected"]),
        f"{role}: oracle contract is incomplete or did not pass",
    )
    require_sha256(oracle.get("actualHash"), f"{role} oracle actualHash")
    actual_hash = hashlib.sha256(
        json.dumps(
            observations,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    require(
        oracle["actualHash"] == actual_hash,
        f"{role}: oracle actualHash does not bind observations",
    )
    require(bool(artifact.get("observedAt")), f"{role}: timestamp missing")


def validate_runtime_attestation(
    item: dict[str, Any],
    *,
    label: str,
    expected_profile: str | None,
) -> None:
    profile = item.get("attestationProfile")
    if expected_profile is not None:
        require(
            expected_profile in RUNTIME_ATTESTATION_PROFILES,
            f"{label} runtime attestation profile is unsupported",
        )
        require(
            profile == expected_profile,
            f"{label} runtime attestation profile mismatch",
        )
    else:
        require(
            profile is None,
            f"{label} legacy row must not declare a runtime attestation profile",
        )

    profile_fields = {
        "contract_only": {"contractAttestation"},
        "orchestration_guard": {"guardAttestation"},
        "non_advertised": {"capabilityInventoryAttestation"},
    }
    if expected_profile in profile_fields:
        expected_fields = (
            set(TUPLE_FIELDS)
            | {
                "attestationProfile",
                "stationProfile",
                "networkPath",
                "machine",
                "coldWarmState",
                "observedAt",
            }
            | profile_fields[expected_profile]
        )
        require(
            set(item) == expected_fields,
            f"{label} {expected_profile} payload fields mismatch",
        )
        require_semantic_value(item.get("observedAt"), f"{label} observedAt")
        if expected_profile == "contract_only":
            contract_attestation = item["contractAttestation"]
            require(
                isinstance(contract_attestation, dict)
                and set(contract_attestation)
                == {
                    "contractId",
                    "contractHash",
                    "platform",
                    "toolchain",
                    "roundTripStatus",
                },
                f"{label} contract attestation fields mismatch",
            )
            require_semantic_value(
                contract_attestation.get("contractId"),
                f"{label} contract ID",
            )
            require_sha256(
                contract_attestation.get("contractHash"),
                f"{label} contract hash",
            )
            require(
                contract_attestation.get("platform") == item["platform"]
                and bool(contract_attestation.get("toolchain"))
                and contract_attestation.get("roundTripStatus") == "passed",
                f"{label} contract attestation did not pass",
            )
        elif expected_profile == "orchestration_guard":
            guard_attestation = item["guardAttestation"]
            require(
                isinstance(guard_attestation, dict)
                and set(guard_attestation)
                == {
                    "guardId",
                    "sourceInventoryHash",
                    "violationCount",
                },
                f"{label} guard attestation fields mismatch",
            )
            require_semantic_value(
                guard_attestation.get("guardId"),
                f"{label} guard ID",
            )
            require_sha256(
                guard_attestation.get("sourceInventoryHash"),
                f"{label} guard source inventory",
            )
            require(
                type(guard_attestation.get("violationCount")) is int
                and guard_attestation["violationCount"] == 0,
                f"{label} guard attestation did not pass cleanly",
            )
        else:
            capability_inventory = item["capabilityInventoryAttestation"]
            require(
                isinstance(capability_inventory, dict)
                and set(capability_inventory)
                == {
                    "inventoryHash",
                    "surfaceId",
                    "zeroExecutionCount",
                },
                f"{label} capability inventory fields mismatch",
            )
            require_semantic_value(
                capability_inventory.get("surfaceId"),
                f"{label} capability surface ID",
            )
            require_sha256(
                capability_inventory.get("inventoryHash"),
                f"{label} capability inventory",
            )
            require(
                type(capability_inventory.get("zeroExecutionCount")) is int
                and capability_inventory["zeroExecutionCount"] == 0,
                f"{label} non-advertisement attestation did not prove zero execution",
            )
        return

    expected_fields = set(TUPLE_FIELDS) | {
        "actorIdentityHash",
        "conversationRuntimeBinding",
        "runtimeSnapshot",
        "turnAttempt",
        "clientSession",
        "stationProfile",
        "desktopMode",
        "networkPath",
        "machine",
        "coldWarmState",
        "observedAt",
    }
    if expected_profile in {
        "direct_runtime",
        "direct_runtime_no_local_capability",
    }:
        expected_fields.add("attestationProfile")
    if expected_profile != "direct_runtime_no_local_capability":
        expected_fields.add("toolCallBinding")
    require(
        set(item) == expected_fields,
        f"{label} direct runtime payload fields mismatch",
    )
    require_sha256(item.get("actorIdentityHash"), f"{label} actor identity")

    binding_fields = {
        "runtimeKind",
        "providerId",
        "modelId",
        "runtimeProfileId",
        "externalSessionId",
        "externalSessionEpoch",
        "runtimeHomeRefHash",
        "capabilitySnapshotHash",
        "configSnapshotHash",
        "boundAt",
    }
    binding = item.get("conversationRuntimeBinding")
    require(
        isinstance(binding, dict) and set(binding) == binding_fields,
        f"{label} conversation runtime binding fields mismatch",
    )
    for field in (
        "runtimeHomeRefHash",
        "capabilitySnapshotHash",
        "configSnapshotHash",
    ):
        require_sha256(binding[field], f"{label} binding {field}")

    snapshot_fields = {
        "runtimeKind",
        "providerId",
        "modelId",
        "runtimeProfileId",
        "capabilities",
        "providerConfigVersion",
        "agentConfigVersion",
        "externalSessionId",
        "externalSessionEpoch",
        "thinkingMode",
    }
    snapshot = item.get("runtimeSnapshot")
    require(
        isinstance(snapshot, dict) and set(snapshot) == snapshot_fields,
        f"{label} runtime snapshot fields mismatch",
    )
    require(
        snapshot.get("thinkingMode") in {"auto", "enabled", "disabled"},
        f"{label} runtime snapshot thinking mode invalid",
    )
    capability_fields = {
        "input",
        "output",
        "runtime",
        "agentic",
        "limits",
        "resolution",
        "provenance",
    }
    capabilities = snapshot.get("capabilities")
    require(
        isinstance(capabilities, dict)
        and set(capabilities) == capability_fields
        and all(capabilities[field] for field in capability_fields),
        f"{label} runtime capability snapshot fields mismatch",
    )
    binding_snapshot_fields = (
        "runtimeKind",
        "providerId",
        "modelId",
        "runtimeProfileId",
        "externalSessionId",
        "externalSessionEpoch",
    )
    mismatched_binding_fields = [
        field
        for field in binding_snapshot_fields
        if binding[field] != snapshot[field]
    ]
    require(
        not mismatched_binding_fields,
        f"{label} runtime binding does not match runtime snapshot: "
        f"{mismatched_binding_fields}",
    )
    capability_snapshot_hash = hashlib.sha256(
        json.dumps(
            capabilities,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    require(
        binding["capabilitySnapshotHash"] == capability_snapshot_hash,
        f"{label} capability snapshot hash mismatch",
    )
    config_snapshot_hash = hashlib.sha256(
        json.dumps(
            {
                "agentConfigVersion": snapshot["agentConfigVersion"],
                "providerConfigVersion": snapshot["providerConfigVersion"],
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    require(
        binding["configSnapshotHash"] == config_snapshot_hash,
        f"{label} config snapshot hash mismatch",
    )

    client = item.get("clientSession")
    require(
        isinstance(client, dict)
        and set(client)
        == {
            "capabilitySessionId",
            "actorIdHash",
            "deviceId",
            "platform",
            "capabilities",
            "expiresAt",
            "connectionId",
            "leaseId",
        }
        and all(
            value
            for key, value in client.items()
            if key != "capabilities"
        ),
        f"{label} client session fields mismatch",
    )
    require_sha256(client["actorIdHash"], f"{label} client actor identity")
    client_capabilities = client["capabilities"]
    require(
        isinstance(client_capabilities, list)
        and (
            (
                expected_profile == "direct_runtime_no_local_capability"
                and client["platform"] == "browser"
                and not client_capabilities
            )
            or (
                expected_profile != "direct_runtime_no_local_capability"
                and bool(client_capabilities)
            )
        ),
        f"{label} client capabilities mismatch for {expected_profile}",
    )
    for index, capability in enumerate(client_capabilities):
        require(
            isinstance(capability, dict)
            and set(capability)
            == {
                "capabilityId",
                "schemaVersion",
                "permission",
                "constraints",
            }
            and all(
                capability[field]
                for field in (
                    "capabilityId",
                    "schemaVersion",
                    "permission",
                )
            ),
            f"{label} client capability {index} fields mismatch",
        )
        constraints = capability["constraints"]
        require(
            isinstance(constraints, dict)
            and set(constraints)
            == {
                "maxRequestBytes",
                "maxResultBytes",
                "allowedResourceKinds",
            }
            and isinstance(constraints["allowedResourceKinds"], list)
            and bool(constraints["allowedResourceKinds"]),
            f"{label} client capability {index} constraints mismatch",
        )
    require(
        client["actorIdHash"] == item["actorIdentityHash"],
        f"{label} client actor does not match attested actor",
    )
    for field in (
        "stationProfile",
        "desktopMode",
        "networkPath",
        "machine",
        "observedAt",
    ):
        require_semantic_value(item.get(field), f"{label} {field}")
    require(
        item.get("coldWarmState") in {"cold", "warm", "neutral", "contract"},
        f"{label} cold/warm state is invalid",
    )

    turn_attempt = item.get("turnAttempt")
    require(
        isinstance(turn_attempt, dict)
        and set(turn_attempt)
        == {
            "attemptId",
            "turnId",
            "index",
            "contextLedgerId",
            "capabilityReadinessSnapshotId",
            "status",
            "runtimeSnapshotHash",
        }
        and all(value is not None and value != "" for value in turn_attempt.values()),
        f"{label} TurnAttempt fields mismatch",
    )
    require_sha256(
        turn_attempt["runtimeSnapshotHash"],
        f"{label} TurnAttempt runtime snapshot",
    )
    runtime_snapshot_hash = hashlib.sha256(
        json.dumps(
            snapshot,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    require(
        turn_attempt["runtimeSnapshotHash"] == runtime_snapshot_hash,
        f"{label} TurnAttempt runtime snapshot hash mismatch",
    )
    if expected_profile == "direct_runtime_no_local_capability":
        return

    tool_binding = item.get("toolCallBinding")
    require(
        isinstance(tool_binding, dict)
        and set(tool_binding)
        == {
            "toolCallId",
            "turnId",
            "attemptId",
            "capabilityId",
            "capabilityVersion",
            "bindingId",
            "bindingRevision",
            "readinessSnapshotId",
            "selectedDeviceId",
            "selectedLeaseId",
            "sideEffectReceiptId",
        }
        and all(value is not None and value != "" for value in tool_binding.values()),
        f"{label} ToolCall binding fields mismatch",
    )
    require(
        tool_binding["turnId"] == turn_attempt["turnId"]
        and tool_binding["attemptId"] == turn_attempt["attemptId"]
        and tool_binding["readinessSnapshotId"]
        == turn_attempt["capabilityReadinessSnapshotId"]
        and tool_binding["selectedDeviceId"] == client["deviceId"]
        and tool_binding["selectedLeaseId"] == client["leaseId"],
        f"{label} ToolCall binding is detached from TurnAttempt/client lease",
    )
    require(
        any(
            capability["capabilityId"] == tool_binding["capabilityId"]
            and capability["schemaVersion"] == tool_binding["capabilityVersion"]
            for capability in client_capabilities
        ),
        f"{label} ToolCall capability is absent from the client lease",
    )


def matrix_identity(contract: dict[str, Any]) -> dict[str, Any]:
    identity = dict(contract["matrix"])
    source = REPO_ROOT / identity.pop("source")
    require(source.is_file(), "reviewed Agent V2 runtime matrix is missing")
    require(
        sha256_file(source) == identity["sha256"],
        "reviewed Agent V2 runtime matrix hash mismatch",
    )
    return identity


def expanded_matrix_contract(
    contract: dict[str, Any],
) -> tuple[
    dict[str, set[str]],
    dict[str, dict[str, set[str]]],
    dict[str, dict[str, str | None]],
]:
    matrix_source = REPO_ROOT / contract["matrix"]["source"]
    matrix = yaml.safe_load(matrix_source.read_text(encoding="utf-8"))
    expansion = matrix["tuple_expansion"]
    cell_sets = matrix["cell_sets"]
    by_gate = {gate_id: set() for gate_id in contract["gates"]}
    by_gate_role = {
        gate_id: {
            role: set()
            for role in gate_contract["roles"]
            if role not in GENERATED_ATTESTATION_ROLES
        }
        for gate_id, gate_contract in contract["gates"].items()
    }
    profiles_by_gate = {gate_id: {} for gate_id in contract["gates"]}
    for row in matrix["rows"]:
        gate_id = row["gate"]
        require(gate_id in by_gate, f"unknown matrix Gate: {gate_id}")
        evidence_roles = set(by_gate_role[gate_id])
        role_policy = row.get("role_policy")
        if role_policy is None:
            applicable_roles = evidence_roles
        else:
            require(
                isinstance(role_policy, dict)
                and set(role_policy)
                == {"always", "required", "not_applicable"},
                f"{row['id']}: role policy fields mismatch",
            )
            role_groups: dict[str, set[str]] = {}
            for policy_name in ("always", "required", "not_applicable"):
                policy_roles = role_policy[policy_name]
                require(
                    isinstance(policy_roles, list)
                    and all(
                        isinstance(role, str) and role
                        for role in policy_roles
                    )
                    and len(policy_roles) == len(set(policy_roles)),
                    f"{row['id']}: {policy_name} role policy is invalid",
                )
                role_groups[policy_name] = set(policy_roles)
            require(
                all(
                    role_groups[left].isdisjoint(role_groups[right])
                    for left, right in (
                        ("always", "required"),
                        ("always", "not_applicable"),
                        ("required", "not_applicable"),
                    )
                ),
                f"{row['id']}: role policy groups overlap",
            )
            declared_roles = set().union(*role_groups.values())
            require(
                declared_roles == evidence_roles,
                f"{row['id']}: role policy does not cover the Gate evidence roles",
            )
            applicable_roles = role_groups["always"] | role_groups["required"]
        attestation_profile = row.get("runtime_attestation_profile")
        if attestation_profile is not None:
            require(
                attestation_profile in RUNTIME_ATTESTATION_PROFILES,
                f"{row['id']}: unsupported runtime attestation profile",
            )
        cells: list[str] = []
        for set_name in row.get("cell_sets", []):
            require(
                set_name in cell_sets,
                f"unknown matrix cell set: {set_name}",
            )
            cells.extend(cell_sets[set_name])
        cells.extend(row.get("cells", []))
        for cell in dict.fromkeys(cells):
            cell_rule: dict[str, Any] = {}
            for rule in expansion["rules"]:
                if cell in rule["cells"]:
                    cell_rule.update(
                        {
                            key: value
                            for key, value in rule.items()
                            if key != "cells"
                        }
                    )
            locales = cell_rule.get(
                "locales",
                row.get("locales", expansion["defaults"]["locales"]),
            )
            orderings = cell_rule.get(
                "orderings",
                row.get("orderings", expansion["defaults"]["orderings"]),
            )
            sample_set = cell_rule.get(
                "sample_set",
                row.get(
                    "sample_set",
                    expansion["defaults"]["sample_set"],
                ),
            )
            require(
                sample_set in expansion["sample_sets"],
                f"unknown matrix sample set: {sample_set}",
            )
            for locale in locales:
                for ordering in orderings:
                    for sample_id in expansion["sample_sets"][sample_set]:
                        value = {
                            "gate": row["gate"],
                            "row": row["id"],
                            "platform": row["platform"],
                            "runtime": row["runtime"],
                            "cell": cell,
                            "locale": locale,
                            "ordering": ordering,
                            "sample_id": sample_id,
                        }
                        key = json.dumps(
                            [value[field] for field in TUPLE_FIELDS],
                            separators=(",", ":"),
                        )
                        require(
                            key not in by_gate[gate_id],
                            f"duplicate reviewed matrix tuple: {key}",
                        )
                        by_gate[gate_id].add(key)
                        profiles_by_gate[gate_id][key] = attestation_profile
                        for role in applicable_roles:
                            by_gate_role[gate_id][role].add(key)
    require(
        sum(len(values) for values in by_gate.values())
        == contract["matrix"]["expandedTupleCount"],
        "reviewed runtime matrix expanded tuple count mismatch",
    )
    for gate_id, gate_contract in contract["gates"].items():
        require(
            len(by_gate[gate_id]) == gate_contract["expectedTuples"],
            f"{gate_id}: reviewed runtime matrix Gate count mismatch",
        )
        for always_full_role in (
            "cell-results",
            "runtime-attestation-set",
        ):
            if always_full_role in by_gate_role[gate_id]:
                require(
                    by_gate_role[gate_id][always_full_role]
                    == by_gate[gate_id],
                    f"{gate_id}: {always_full_role} must cover every tuple",
                )
        for role, role_tuples in by_gate_role[gate_id].items():
            require(
                role_tuples,
                f"{gate_id}: evidence role has no applicable tuples: {role}",
            )
    return by_gate, by_gate_role, profiles_by_gate


def read_ref_file(path_value: str) -> ArtifactRef:
    path = Path(path_value)
    require(path.is_file(), f"ArtifactRef file is missing: {path}")
    return ArtifactRef.from_dict(load(path))


def require_exact_object(
    actual: Any,
    expected: dict[str, Any],
    label: str,
) -> None:
    require(isinstance(actual, dict), f"{label} must be an object")
    require(actual == expected, f"{label} mismatch")


def require_exact_fields(
    actual: Any,
    expected: set[str],
    label: str,
) -> dict[str, Any]:
    require(isinstance(actual, dict), f"{label} must be an object")
    require(set(actual) == expected, f"{label} fields mismatch")
    return actual


def validate_validator_attestation(
    contract: dict[str, Any],
    validator: dict[str, Any],
    *,
    gate_id: str,
    validator_run_id: str,
    candidate_ref: ArtifactRef,
) -> dict[str, Any]:
    validator = require_exact_fields(
        validator,
        {
            "artifactKind",
            "schema",
            "role",
            "gateId",
            "runId",
            "producer",
            "candidateManifest",
            "validatedAt",
        },
        "validator attestation",
    )
    require(
        validator["artifactKind"] == "agent-v2-validator-attestation"
        and validator["role"] == "validator-attestation"
        and validator["gateId"] == gate_id
        and validator["runId"] == validator_run_id,
        "validator attestation identity mismatch",
    )
    require_exact_object(
        validator["schema"],
        schema_descriptor(contract, "validator-attestation"),
        "validator attestation schema",
    )
    require_exact_object(
        validator["candidateManifest"],
        candidate_ref.to_dict(),
        "validator candidate manifest",
    )
    producer = require_exact_fields(
        validator["producer"],
        {"kind", "processId", "invocationId"},
        "validator producer",
    )
    require(
        producer["kind"] == "validator"
        and isinstance(producer["processId"], int)
        and isinstance(producer["invocationId"], str)
        and bool(producer["invocationId"]),
        "validator producer identity is invalid",
    )
    require_semantic_value(
        validator["validatedAt"],
        "validator attestation validatedAt",
    )
    return producer


def artifact_for_role(
    store: EvidenceStore,
    manifest: dict[str, Any],
    role: str,
) -> tuple[ArtifactRef, dict[str, Any]]:
    artifacts = manifest.get("artifacts")
    require(isinstance(artifacts, dict), "candidate artifacts must be an object")
    require(role in artifacts, f"candidate is missing mandatory role: {role}")
    reference = ArtifactRef.from_dict(artifacts[role])
    require(
        reference.run_id == manifest["runId"]
        and reference.gate_id == manifest["gateId"]
        and reference.workspace_id == manifest["workspaceId"],
        f"{role}: artifact identity mismatch",
    )
    require(
        reference.media_type == "application/json",
        f"{role}: artifact media type must be application/json",
    )
    return reference, store.read_json(reference)


def write_explicit_ref(path_value: str, reference: ArtifactRef) -> None:
    path = validate_external_output_path(path_value, repo_root=REPO_ROOT)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(reference.to_dict(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def validate_candidate(
    store: EvidenceStore,
    candidate_ref: ArtifactRef,
    candidate_sha256: str,
) -> dict[str, Any]:
    contract = load_agent_v2_contract()
    gate_id = candidate_ref.gate_id
    require(gate_id in contract["gates"], f"unsupported Agent V2 Gate: {gate_id}")
    candidate = store.read_run_manifest(
        candidate_ref,
        manifest_sha256=candidate_sha256,
        expected_gate_id=gate_id,
    )
    result = candidate.get("result", {})
    require(result.get("status") == "passed", "candidate Gate did not pass")
    require(
        result.get("proofStatus") == "CANDIDATE",
        "runner manifest must be CANDIDATE, never PROVEN",
    )
    expected_source = source_identity(REPO_ROOT)
    require_exact_object(candidate.get("source"), expected_source, "candidate source")
    expected_matrix = matrix_identity(contract)
    (
        matrix_tuples,
        applicable_role_tuples,
        runtime_attestation_profiles,
    ) = expanded_matrix_contract(contract)
    expected_tuples = matrix_tuples[gate_id]
    required_roles = set(contract["gates"][gate_id]["roles"])
    artifacts = candidate.get("artifacts", {})
    require(
        required_roles.issubset(set(artifacts)),
        f"candidate missing roles: {sorted(required_roles - set(artifacts))}",
    )

    _, schema_report = artifact_for_role(
        store,
        candidate,
        "role-schema-report",
    )
    require(
        schema_report.get("artifactKind") == "agent-v2-role-schema-report",
        "invalid role-schema-report kind",
    )
    require_exact_object(
        schema_report.get("schema"),
        schema_descriptor(contract, "role-schema-report"),
        "role-schema-report schema",
    )
    schemas = schema_report.get("schemas")
    require(
        isinstance(schemas, dict),
        "role-schema-report schemas must be an object",
    )
    require(
        set(schemas) == required_roles,
        "role-schema-report role set mismatch",
    )

    validated_roles: dict[str, Any] = {}
    runtime_attestations: dict[str, dict[str, Any]] = {}
    ordered_roles = [
        "runtime-attestation-set",
        *sorted(required_roles - {"runtime-attestation-set"}),
    ]
    for role in ordered_roles:
        reference, artifact = artifact_for_role(store, candidate, role)
        schema_name = role if role in contract["schemas"] else "evidence-role"
        expected_schema = schema_descriptor(contract, schema_name)
        require_exact_object(
            schemas.get(role),
            expected_schema,
            f"{role} schema pin",
        )
        require_exact_object(
            artifact.get("schema"),
            expected_schema,
            f"{role} artifact schema",
        )
        require(artifact.get("role") == role, f"{role}: wrong artifact role")
        require(artifact.get("gateId") == gate_id, f"{role}: Gate mismatch")
        require(
            artifact.get("runId") == candidate_ref.run_id,
            f"{role}: run mismatch",
        )
        if role not in {"runner-attestation", "role-schema-report"}:
            require_exact_object(
                artifact.get("sourceIdentity"),
                expected_source,
                f"{role} source identity",
            )
            require_exact_object(
                artifact.get("runtimeMatrix"),
                expected_matrix,
                f"{role} runtime matrix",
            )
        if role == "runtime-attestation-set":
            require(
                artifact.get("artifactKind")
                == "agent-v2-runtime-attestation-set",
                "invalid runtime-attestation-set kind",
            )
            tuples = artifact.get("tuples")
            require(isinstance(tuples, list), "runtime tuples must be an array")
            actual_tuples: set[str] = set()
            for index, item in enumerate(tuples):
                require(isinstance(item, dict), "runtime tuple must be an object")
                require(
                    set(TUPLE_FIELDS).issubset(set(item)),
                    "runtime tuple fields mismatch",
                )
                key = json.dumps(
                    [item[field] for field in TUPLE_FIELDS],
                    separators=(",", ":"),
                )
                require(
                    key in runtime_attestation_profiles[gate_id],
                    "runtime attestation references an unexpected tuple",
                )
                validate_runtime_attestation(
                    item,
                    label=f"runtime tuple {index}",
                    expected_profile=runtime_attestation_profiles[gate_id][key],
                )
                require(key not in actual_tuples, "duplicate runtime tuple")
                actual_tuples.add(key)
                runtime_attestations[key] = item
            require(
                actual_tuples == expected_tuples,
                "runtime attestation matrix has missing or unexpected tuples",
            )
            oracle = artifact.get("oracle")
            require(
                isinstance(oracle, dict)
                and oracle.get("status") == "passed"
                and oracle.get("expectedTupleCount") == len(expected_tuples)
                and isinstance(oracle.get("assertionId"), str)
                and bool(oracle["assertionId"]),
                "runtime attestation oracle is incomplete",
            )
        elif role == "source-identity":
            require(
                artifact.get("artifactKind") == "agent-v2-source-identity",
                "invalid source-identity kind",
            )
        elif role == "runner-attestation":
            require(
                artifact.get("artifactKind") == "agent-v2-runner-attestation",
                "invalid runner attestation kind",
            )
            require(
                artifact.get("candidateOnly") is True,
                "runner is not candidate-only",
            )
            producer = artifact.get("producer", {})
            require(
                producer.get("kind") == "runner",
                "invalid runner producer",
            )
            require(
                isinstance(producer.get("processId"), int),
                "runner process identity is missing",
            )
            require(
                isinstance(producer.get("invocationId"), str)
                and producer["invocationId"],
                "runner invocation identity is missing",
            )
        elif role not in {"source-identity", "role-schema-report"}:
            require(
                artifact.get("artifactKind") == "agent-v2-gate-evidence",
                f"{role}: invalid evidence kind",
            )
            validate_gate_evidence_semantics(
                contract,
                role,
                artifact,
                runtime_attestations,
                applicable_role_tuples[gate_id][role],
            )
        validated_roles[role] = {
            "artifactRef": reference.to_dict(),
            "schema": expected_schema,
        }
    return {
        "contract": contract,
        "candidate": candidate,
        "candidateRef": candidate_ref,
        "sourceIdentity": expected_source,
        "runtimeMatrix": expected_matrix,
        "roles": validated_roles,
    }


def prove_candidate(
    store: EvidenceStore,
    candidate_ref: ArtifactRef,
    candidate_sha256: str,
    proof_ref_out: str,
    proof_sha_out: str | None,
) -> ArtifactRef:
    validated = validate_candidate(store, candidate_ref, candidate_sha256)
    gate_id = candidate_ref.gate_id
    runner_ref, runner = artifact_for_role(
        store,
        validated["candidate"],
        "runner-attestation",
    )
    runner_producer = runner["producer"]
    require(
        runner_producer["processId"] != os.getpid(),
        "runner and validator process identities must differ",
    )
    validation_run = store.begin_run(
        f"{gate_id}.validator",
        source=source_identity(REPO_ROOT),
    )
    try:
        validator_schema = schema_descriptor(
            validated["contract"],
            "validator-attestation",
        )
        validator_ref = validation_run.write_json(
            "proof/validator-attestation.json",
            {
                "artifactKind": "agent-v2-validator-attestation",
                "schema": validator_schema,
                "role": "validator-attestation",
                "gateId": gate_id,
                "runId": validation_run.run_id,
                "producer": {
                    "kind": "validator",
                    "processId": os.getpid(),
                    "invocationId": secrets.token_hex(16),
                },
                "candidateManifest": candidate_ref.to_dict(),
                "validatedAt": utc_now(),
            },
            role="validator-attestation",
            redact=False,
        )
        require(
            validation_run.run_id != candidate_ref.run_id,
            "runner and validator run identities must differ",
        )
        validation_run.finalize(
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            }
        )
        validator_manifest_ref = validation_run.manifest_ref
        validation_run.close()

        envelope_run = store.begin_run(
            f"{gate_id}.proof",
            source=source_identity(REPO_ROOT),
        )
        envelope = {
            "artifactKind": "agent-v2-proof-envelope",
            "schemaVersion": 1,
            "proofStatus": "PROVEN",
            "gateId": gate_id,
            "candidateManifest": candidate_ref.to_dict(),
            "candidateManifestSha256": candidate_sha256,
            "runnerAttestation": runner_ref.to_dict(),
            "runnerAttestationSha256": runner_ref.sha256,
            "validatorRun": validator_manifest_ref.to_dict(),
            "validatorRunSha256": validator_manifest_ref.sha256,
            "validatorAttestation": validator_ref.to_dict(),
            "validatorAttestationSha256": validator_ref.sha256,
            "sourceIdentity": validated["sourceIdentity"],
            "runtimeMatrix": validated["runtimeMatrix"],
            "roleSchemas": {
                role: value["schema"]
                for role, value in validated["roles"].items()
            },
            "validatedAt": utc_now(),
        }
        envelope_ref = envelope_run.write_json(
            "proof/proof-envelope.json",
            envelope,
            role="proof-envelope",
            redact=False,
        )
        envelope_run.finalize(
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            }
        )
        envelope_run.close()
        store.publish_candidate_proof(
            candidate_manifest=candidate_ref,
            proof_envelope=envelope_ref,
        )
    except Exception:
        validation_run.close()
        if "envelope_run" in locals():
            envelope_run.close()
        raise
    write_explicit_ref(proof_ref_out, envelope_ref)
    if proof_sha_out:
        sha_path = validate_external_output_path(
            proof_sha_out,
            repo_root=REPO_ROOT,
        )
        sha_path.parent.mkdir(parents=True, exist_ok=True)
        sha_path.write_text(envelope_ref.sha256 + "\n", encoding="utf-8")
    return envelope_ref


def validate_proof_envelope(
    store: EvidenceStore,
    envelope_ref: ArtifactRef,
    *,
    expected_gate_id: str,
) -> dict[str, Any]:
    envelope = store.read_json(envelope_ref)
    require(
        envelope_ref.gate_id == f"{expected_gate_id}.proof",
        "proof envelope ArtifactRef Gate mismatch",
    )
    envelope = require_exact_fields(
        envelope,
        {
            "artifactKind",
            "schemaVersion",
            "proofStatus",
            "gateId",
            "candidateManifest",
            "candidateManifestSha256",
            "runnerAttestation",
            "runnerAttestationSha256",
            "validatorRun",
            "validatorRunSha256",
            "validatorAttestation",
            "validatorAttestationSha256",
            "sourceIdentity",
            "runtimeMatrix",
            "roleSchemas",
            "validatedAt",
        },
        "proof envelope",
    )
    require(
        envelope["artifactKind"] == "agent-v2-proof-envelope"
        and envelope["schemaVersion"] == 1,
        "invalid proof envelope kind",
    )
    require(
        envelope.get("proofStatus") == "PROVEN",
        "proof envelope is not PROVEN",
    )
    require(
        envelope.get("gateId") == expected_gate_id,
        "proof envelope Gate mismatch",
    )
    require_semantic_value(
        envelope["validatedAt"],
        "proof envelope validatedAt",
    )
    candidate_ref = ArtifactRef.from_dict(envelope["candidateManifest"])
    candidate_sha = envelope.get("candidateManifestSha256")
    require_sha256(candidate_sha, "proof envelope candidate hash pin")
    require(
        candidate_ref.sha256 == candidate_sha,
        "proof envelope candidate hash pin mismatch",
    )
    validated = validate_candidate(store, candidate_ref, candidate_sha)
    require_exact_object(
        envelope.get("sourceIdentity"),
        validated["sourceIdentity"],
        "proof envelope source identity",
    )
    require_exact_object(
        envelope.get("runtimeMatrix"),
        validated["runtimeMatrix"],
        "proof envelope runtime matrix",
    )
    require_exact_object(
        envelope.get("roleSchemas"),
        {
            role: value["schema"]
            for role, value in validated["roles"].items()
        },
        "proof envelope role schemas",
    )
    runner_ref = ArtifactRef.from_dict(envelope["runnerAttestation"])
    require_sha256(
        envelope.get("runnerAttestationSha256"),
        "proof envelope runner attestation hash pin",
    )
    require(
        runner_ref.sha256 == envelope.get("runnerAttestationSha256"),
        "proof envelope runner attestation hash pin mismatch",
    )
    expected_runner_ref = ArtifactRef.from_dict(
        validated["candidate"]["artifacts"]["runner-attestation"]
    )
    require(
        runner_ref == expected_runner_ref,
        "proof envelope runner ref mismatch",
    )
    runner = store.read_json(runner_ref)

    validator_manifest_ref = ArtifactRef.from_dict(envelope["validatorRun"])
    require_sha256(
        envelope.get("validatorRunSha256"),
        "proof envelope validator run hash pin",
    )
    require(
        validator_manifest_ref.sha256 == envelope.get("validatorRunSha256"),
        "proof envelope validator run hash pin mismatch",
    )
    validator_manifest = store.read_run_manifest(
        validator_manifest_ref,
        manifest_sha256=validator_manifest_ref.sha256,
        expected_gate_id=f"{expected_gate_id}.validator",
    )
    require_exact_object(
        validator_manifest.get("source"),
        validated["sourceIdentity"],
        "validator run source identity",
    )
    require(
        validator_manifest.get("result")
        == {
            "status": "passed",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
        },
        "validator run is not PROVEN",
    )
    validator_ref = ArtifactRef.from_dict(envelope["validatorAttestation"])
    require_sha256(
        envelope.get("validatorAttestationSha256"),
        "proof envelope validator attestation hash pin",
    )
    require(
        validator_ref.sha256 == envelope.get("validatorAttestationSha256"),
        "proof envelope validator attestation hash pin mismatch",
    )
    require(
        ArtifactRef.from_dict(
            validator_manifest["artifacts"]["validator-attestation"]
        )
        == validator_ref,
        "validator attestation is not bound to validator run",
    )
    validator = store.read_json(validator_ref)
    validator_producer = validate_validator_attestation(
        validated["contract"],
        validator,
        gate_id=expected_gate_id,
        validator_run_id=validator_manifest_ref.run_id,
        candidate_ref=candidate_ref,
    )
    require(
        runner["producer"]["kind"] == "runner"
        and runner["producer"]["processId"]
        != validator_producer["processId"]
        and runner["producer"]["invocationId"]
        != validator_producer["invocationId"]
        and candidate_ref.run_id != validator_manifest_ref.run_id,
        "runner/validator producer, process, or run identity is not separate",
    )
    return envelope


def validate_proof_set(
    store: EvidenceStore,
    proof_set_ref: ArtifactRef,
    proof_set_sha256: str,
) -> dict[str, Any]:
    require(
        proof_set_ref.sha256 == proof_set_sha256,
        "proof-set SHA-256 does not match ArtifactRef",
    )
    proof_set = store.read_json(proof_set_ref)
    require(
        proof_set.get("artifactKind") == "agent-v2-proof-set",
        "invalid proof-set kind",
    )
    require(
        proof_set.get("proofStatus") == "PROVEN",
        "proof set is not PROVEN",
    )
    contract = load_agent_v2_contract()
    require_exact_object(
        proof_set.get("sourceIdentity"),
        source_identity(REPO_ROOT),
        "proof-set source identity",
    )
    require_exact_object(
        proof_set.get("runtimeMatrix"),
        matrix_identity(contract),
        "proof-set runtime matrix",
    )
    gate_proofs = proof_set.get("gateProofs")
    require(
        isinstance(gate_proofs, list),
        "proof-set gateProofs must be an array",
    )
    gate_ids = [
        item.get("gateId")
        for item in gate_proofs
        if isinstance(item, dict)
    ]
    require(
        len(gate_proofs) == 7
        and len(set(gate_ids)) == 7
        and set(gate_ids) == set(contract["gates"]),
        "proof set must contain the exact seven Agent V2 Gates",
    )
    for item in gate_proofs:
        envelope_ref = ArtifactRef.from_dict(item["proofEnvelope"])
        require(
            envelope_ref.sha256 == item.get("proofEnvelopeSha256"),
            "proof envelope hash pin mismatch",
        )
        envelope = validate_proof_envelope(
            store,
            envelope_ref,
            expected_gate_id=item["gateId"],
        )
        require_exact_object(
            envelope.get("sourceIdentity"),
            proof_set["sourceIdentity"],
            "proof envelope source identity",
        )
        require_exact_object(
            envelope.get("runtimeMatrix"),
            proof_set["runtimeMatrix"],
            "proof envelope runtime matrix",
        )
    return proof_set


def load_capabilities(root: Path) -> dict[str, dict[str, Any]]:
    capabilities: dict[str, dict[str, Any]] = {}
    capability_dir = root / "capabilities"
    for path in sorted(capability_dir.glob("*.yaml")):
        for capability in load(path).get("capabilities", []):
            capability_id = capability.get("id")
            require(bool(capability_id), f"{path}: capability is missing id")
            require(capability_id not in capabilities, f"duplicate capability id: {capability_id}")
            capabilities[capability_id] = capability
    require(capabilities, f"no capabilities found under {capability_dir}")
    return capabilities


def validate_finalizer_contracts(
    acceptance_root: Path,
    gate_defs: dict[str, Any],
) -> dict[str, Any]:
    has_catalog_config = any(
        isinstance(gate, dict) and "evidenceFinalizer" in gate
        for gate in gate_defs.values()
    )
    has_capability_declaration = any(
        "finalizerRegistry" in load(path)
        or "requiredEvidenceFinalizers" in load(path)
        for path in sorted((acceptance_root / "capabilities").glob("*.yaml"))
    )
    if not has_catalog_config and not has_capability_declaration:
        return {}

    from tooling.acceptance.finalizers import load_finalizer_bindings

    return dict(load_finalizer_bindings(acceptance_root, gate_defs))


def run_plan_for_paths(repo_root: Path, acceptance_root: Path, paths: list[str]) -> dict[str, Any]:
    script = repo_root / "tooling/scripts/acceptance-plan.py"
    code = (
        "import importlib.util, json, pathlib, sys\n"
        f"sys.path.insert(0, {str(script.parent)!r})\n"
        f"spec = importlib.util.spec_from_file_location('acceptance_plan', {str(script)!r})\n"
        "module = importlib.util.module_from_spec(spec)\n"
        "spec.loader.exec_module(module)\n"
        f"result = module.plan(pathlib.Path({str(acceptance_root)!r}), {paths!r})\n"
        "print(json.dumps(result, ensure_ascii=False))\n"
    )
    completed = subprocess.run(
        ["python3", "-c", code],
        cwd=repo_root,
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(completed.stdout)


def flatten_feature_gates(features: list[dict[str, Any]], feature_ids: list[str]) -> set[str]:
    by_id = {feature["id"]: feature for feature in features}
    gates: set[str] = set()
    for feature_id in feature_ids:
        feature = by_id.get(feature_id)
        require(feature is not None, f"capability references missing feature: {feature_id}")
        gates.update(feature.get("required_gates", []))
    return gates


def validate_gate_catalog(
    gate_defs: dict[str, Any],
    required_gate_ids: set[str],
) -> None:
    require(gate_defs, "gates.yaml has no gates")
    missing_gate_ids = sorted(required_gate_ids - gate_defs.keys())
    require(
        not missing_gate_ids,
        f"STRUCTURAL_GAP: required gates missing from gates.yaml: {missing_gate_ids}",
    )
    agent_v2_contract = load_agent_v2_contract()
    agent_v2_matrix = matrix_identity(agent_v2_contract)
    for gate_id in sorted(required_gate_ids):
        gate = gate_defs[gate_id]
        validate_gate_launch(gate_id, gate)
        environment = gate.get("environment", "local")
        tier = gate.get("tier")
        require(environment in ALLOWED_GATE_ENVIRONMENTS, f"{gate_id}: invalid environment {environment!r}")
        require(tier in ALLOWED_GATE_TIERS, f"{gate_id}: invalid or missing tier {tier!r}")
        if environment != "local":
            require(
                tier in {"env-evidence", "nightly", "release"},
                f"{gate_id}: non-local environment {environment!r} cannot use tier {tier!r}",
            )
        if tier in {"ci-structure", "ci-cheap"}:
            require(environment == "local", f"{gate_id}: CI tier gates must use local environment")
        if gate_id in agent_v2_contract["gates"]:
            expected = agent_v2_contract["gates"][gate_id]
            require(
                gate.get("initial_proof_status") == "UNPROVEN",
                f"{gate_id}: initial_proof_status must be UNPROVEN",
            )
            require(
                gate.get("runtime_matrix")
                == {
                    "id": agent_v2_matrix["id"],
                    "version": agent_v2_matrix["version"],
                    "sha256": agent_v2_matrix["sha256"],
                    "expected_tuple_count": expected["expectedTuples"],
                },
                f"{gate_id}: runtime_matrix does not match the reviewed matrix",
            )
            require(
                gate.get("required_artifact_roles") == expected["roles"],
                f"{gate_id}: required_artifact_roles do not match the proof contract",
            )


def validate_gate_launch(gate_id: str, gate: dict[str, Any]) -> None:
    has_command = "command" in gate
    has_argv = "argv" in gate
    require(
        has_command != has_argv,
        f"{gate_id}: gate must define exactly one of command or argv",
    )

    if has_command:
        command = gate["command"]
        require(
            isinstance(command, str) and bool(command.strip()),
            f"{gate_id}: gate command must be a non-empty string",
        )
    else:
        argv = gate["argv"]
        require(
            isinstance(argv, list)
            and bool(argv)
            and all(
                isinstance(argument, str) and bool(argument)
                for argument in argv
            ),
            f"{gate_id}: gate argv must be a non-empty list of non-empty strings",
        )

    if "ephemeralCapabilities" not in gate:
        return

    capabilities = gate["ephemeralCapabilities"]
    require(
        isinstance(capabilities, list)
        and bool(capabilities)
        and all(
            isinstance(capability, str) and bool(capability)
            for capability in capabilities
        )
        and len(set(capabilities)) == len(capabilities),
        f"{gate_id}: ephemeralCapabilities must be a unique, non-empty list "
        "of non-empty strings",
    )
    require(has_argv, f"{gate_id}: ephemeralCapabilities requires argv")
    require(
        isinstance(argv, list) and is_supported_context_argv(argv),
        f"{gate_id}: ephemeralCapabilities requires a Python module, "
        "script, or -c argv",
    )


def is_supported_context_argv(argv: list[str]) -> bool:
    if len(argv) < 2 or not re.fullmatch(
        r"python(?:\d+(?:\.\d+)*)?",
        Path(argv[0]).name,
    ):
        return False
    if argv[1] == "-m":
        return len(argv) >= 3 and bool(
            re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*", argv[2])
        )
    if argv[1] == "-c":
        return len(argv) >= 3
    return not argv[1].startswith("-") and Path(argv[1]).suffix == ".py"


def gate_launch_arguments(gate: dict[str, Any]) -> list[str]:
    if "argv" in gate:
        return list(gate["argv"])
    return str(gate["command"]).split()


def validate_gate_inheritance(
    repo_root: Path,
    gate_defs: dict[str, Any],
    required_gate_ids: set[str],
) -> None:
    """I1: Gates using python3 -m must contain an AcceptanceGate subclass."""
    violations: list[str] = []
    for gate_id in sorted(required_gate_ids & gate_defs.keys()):
        parts = gate_launch_arguments(gate_defs[gate_id])
        if "-m" not in parts and "-c" not in parts:
            continue
        try:
            module_index = parts.index("-m") + 1
        except ValueError:
            continue
        if module_index >= len(parts):
            continue
        module_path = parts[module_index].replace(".", "/")
        candidates = [
            repo_root / f"{module_path}.py",
            repo_root / module_path / "__main__.py",
        ]
        source = next((c for c in candidates if c.is_file()), None)
        if source is None:
            continue
        content = source.read_text(encoding="utf-8", errors="replace")
        if "AcceptanceGate" not in content:
            violations.append(gate_id)
    if violations:
        raise RuntimeError(
            "ACCEPTANCE_GATE_CONTRACT_VIOLATION: gates using python3 -m must "
            f"contain AcceptanceGate subclass: {violations}"
        )


def validate_gate_import_isolation(
    repo_root: Path,
    gate_defs: dict[str, Any],
    required_gate_ids: set[str],
) -> None:
    """I2: Gate runner modules must not import from other gate runner modules."""
    import re

    gate_modules: set[str] = set()
    gate_files: dict[str, tuple[Path, str]] = {}

    for gate_id in sorted(required_gate_ids & gate_defs.keys()):
        parts = gate_launch_arguments(gate_defs[gate_id])
        if "-m" not in parts:
            continue
        try:
            module_index = parts.index("-m") + 1
        except ValueError:
            continue
        if module_index >= len(parts):
            continue
        module_name = parts[module_index]
        gate_modules.add(module_name)
        module_path = module_name.replace(".", "/")
        source = repo_root / f"{module_path}.py"
        if source.is_file():
            gate_files[gate_id] = (source, module_name)

    import_pattern = re.compile(
        r"^(?:from|import)\s+(tooling\.acceptance\.gates\.\w+\.\w+)",
        re.MULTILINE,
    )
    violations: list[dict[str, str]] = []
    for gate_id, (source, own_module) in sorted(gate_files.items()):
        content = source.read_text(encoding="utf-8", errors="replace")
        for match in import_pattern.finditer(content):
            imported = match.group(1)
            if imported in gate_modules and imported != own_module:
                rel = str(source.relative_to(repo_root))
                violations.append(
                    {"gate": gate_id, "file": rel, "imports": imported}
                )
    if violations:
        raise RuntimeError(
            "ACCEPTANCE_GATE_IMPORT_VIOLATION: gate modules must not import "
            "from other gate modules. Extract shared code to a utility module "
            f"or tooling/acceptance/core/: {json.dumps(violations, sort_keys=True)}"
        )


def validate_synthetic_paths(
    repo_root: Path,
    capabilities: list[dict[str, Any]],
    features: list[dict[str, Any]],
) -> None:
    """I4: synthetic_paths and source_paths must point to existing files."""
    import glob as glob_module

    stale: list[dict[str, str]] = []

    def check_paths(source_id: str, paths: list[str]) -> None:
        for path_str in paths:
            if "*" in path_str or "?" in path_str or "[" in path_str:
                matches = glob_module.glob(
                    str(repo_root / path_str), recursive=True
                )
                if not matches:
                    stale.append({"source": source_id, "path": path_str, "type": "glob_no_match"})
            else:
                if not (repo_root / path_str).exists():
                    stale.append({"source": source_id, "path": path_str, "type": "missing"})

    for capability in capabilities:
        cap_id = str(capability.get("id", ""))
        for path_str in capability.get("synthetic_paths", []):
            check_paths(f"capability:{cap_id}", [path_str])
        for path_str in capability.get("source_paths", []):
            check_paths(f"capability:{cap_id}", [path_str])

    for feature in features:
        feat_id = str(feature.get("id", ""))
        for path_str in feature.get("synthetic_paths", []):
            check_paths(f"feature:{feat_id}", [path_str])
        for path_str in feature.get("source_paths", []):
            check_paths(f"feature:{feat_id}", [path_str])

    if stale:
        raise RuntimeError(
            "ACCEPTANCE_SYNTHETIC_PATH_STALE: paths in capability/feature "
            f"contracts do not exist: {json.dumps(stale[:20], sort_keys=True)}"
        )


def collect_domain_gate_closure(
    capabilities: list[dict[str, Any]],
    features: list[dict[str, Any]],
    validation_gate_id: str,
) -> tuple[set[str], dict[str, set[str]]]:
    features_by_id = {feature.get("id"): feature for feature in features}
    required_gates: set[str] = set()
    gate_sources: dict[str, set[str]] = {}

    for capability in capabilities:
        capability_id = str(capability.get("id") or "<missing>")
        for gate_id in capability.get("required_gates", []):
            required_gates.add(gate_id)
            gate_sources.setdefault(gate_id, set()).add(
                f"capability:{capability_id}"
            )
        for feature_id in capability.get("features", []):
            feature = features_by_id.get(feature_id)
            if feature is None:
                continue
            for gate_id in feature.get("required_gates", []):
                required_gates.add(gate_id)
                gate_sources.setdefault(gate_id, set()).add(
                    f"feature:{feature_id}"
                )

    if validation_gate_id:
        required_gates.add(validation_gate_id)
        gate_sources.setdefault(validation_gate_id, set()).add(
            "domain:validation_gate_id"
        )
    return required_gates, gate_sources


def validate_domain_contract_closure(
    acceptance_root: Path,
    domain_id: str,
    capabilities: list[dict[str, Any]],
    features: list[dict[str, Any]],
    gate_defs: dict[str, Any],
    validation_gate_id: str,
) -> set[str]:
    required_gates, gate_sources = collect_domain_gate_closure(
        capabilities,
        features,
        validation_gate_id,
    )
    failures: list[str] = []

    missing_gates = sorted(required_gates - gate_defs.keys())
    if missing_gates:
        failures.append(
            f"STRUCTURAL_GAP domain {domain_id!r}: required gates missing "
            "from gates.yaml: "
            + json.dumps(
                [
                    {
                        "gate": gate_id,
                        "sources": sorted(gate_sources.get(gate_id, set())),
                    }
                    for gate_id in missing_gates
                ],
                sort_keys=True,
            )
        )

    environment_gates: dict[str, set[str]] = {}
    provisioning_wiring: list[dict[str, str]] = []
    for gate_id in sorted(required_gates & gate_defs.keys()):
        gate = gate_defs[gate_id]
        environment = str(gate.get("environment") or "local")
        if environment == "local":
            continue
        environment_gates.setdefault(environment, set()).add(gate_id)
        provisioner_id = str(gate.get("provisioner") or "")
        if provisioner_id != environment:
            provisioning_wiring.append(
                {
                    "environment": environment,
                    "gate": gate_id,
                    "provisioner": provisioner_id or "<missing>",
                }
            )
    if provisioning_wiring:
        failures.append(
            f"PROVISIONING_WIRING_MISSING domain {domain_id!r}: non-local "
            "gates require provisioner == environment: "
            f"{json.dumps(provisioning_wiring, sort_keys=True)}"
        )

    missing_environments: dict[str, list[str]] = {}
    invalid_environments: list[dict[str, str]] = []
    unregistered_environments: list[dict[str, str]] = []
    for environment, gate_ids in sorted(environment_gates.items()):
        contract_path = (
            acceptance_root / "environments" / f"{environment}.yaml"
        )
        if not contract_path.is_file():
            missing_environments[environment] = sorted(gate_ids)
            continue
        try:
            contract = EnvironmentContract.from_yaml(contract_path)
        except ProvisioningError as error:
            invalid_environments.append(
                {
                    "environment": environment,
                    "error": str(error),
                }
            )
            continue
        if contract.id != environment:
            invalid_environments.append(
                {
                    "environment": environment,
                    "error": (
                        f"contract id {contract.id!r} does not match "
                        f"environment {environment!r}"
                    ),
                }
            )
            continue
        try:
            get_provisioner(contract)
        except ProvisioningError as error:
            unregistered_environments.append(
                {
                    "environment": environment,
                    "error": str(error),
                }
            )

    if missing_environments:
        failures.append(
            f"ENVIRONMENT_CONTRACT_MISSING domain {domain_id!r}: "
            "non-local gates require environments/<environment-id>.yaml: "
            f"{json.dumps(missing_environments, sort_keys=True)}"
        )
    if invalid_environments:
        failures.append(
            f"ENVIRONMENT_CONTRACT_INVALID domain {domain_id!r}: "
            f"{json.dumps(invalid_environments, sort_keys=True)}"
        )
    if unregistered_environments:
        failures.append(
            f"PROVISIONER_UNREGISTERED domain {domain_id!r}: "
            f"{json.dumps(unregistered_environments, sort_keys=True)}"
        )

    require(not failures, "\n".join(failures))
    validate_gate_catalog(gate_defs, required_gates)
    return required_gates


def latest_passed_gates(
    store: EvidenceStore,
    current_gate_id: str,
    require_run: bool,
) -> set[str]:
    def proven_gate_ids(
        results: object,
        *,
        label: str,
    ) -> set[str]:
        if not isinstance(results, list):
            raise RuntimeError(f"invalid {label}")
        proven: set[str] = set()
        seen: set[str] = set()
        for index, result in enumerate(results):
            if not isinstance(result, dict):
                raise RuntimeError(f"invalid {label} entry at index {index}")
            gate_id = result.get("id")
            status = result.get("status")
            if not isinstance(gate_id, str) or not gate_id:
                raise RuntimeError(f"invalid {label} id at index {index}")
            if gate_id in seen:
                raise RuntimeError(
                    f"invalid {label}: duplicate id {gate_id}"
                )
            seen.add(gate_id)
            if status not in {"passed", "dry-run", "failed", "blocked"}:
                raise RuntimeError(f"invalid {label} status at index {index}")
            if (
                status == "passed"
                and result.get("completionStatus") == "DONE"
                and result.get("proofStatus") == "PROVEN"
            ):
                proven.add(gate_id)
        return proven

    latest_missing = False
    try:
        latest_run_path = store.resolve(
            store.latest_artifact_ref("acceptance-run", "run")
        )
        run = load_strict_json_object(
            latest_run_path,
            "latest Acceptance run",
        )
    except EvidenceManifestInvalid:
        latest_missing = True
        run = {}
    except ValueError as error:
        raise RuntimeError("invalid latest Acceptance run") from error
    current_results = os.environ.get("PT_ACCEPTANCE_CURRENT_RESULTS", "")
    latest_source_matches = (
        not run or run.get("source") == source_identity(REPO_ROOT)
    )
    if not latest_source_matches and not current_results:
        raise RuntimeError(
            "latest Acceptance run source does not match current source"
        )
    passed = (
        proven_gate_ids(
            run.get("results", []),
            label="latest Acceptance results",
        )
        if latest_source_matches
        else set()
    )
    if current_results:
        try:
            current_envelope = loads_strict_json_value(
                current_results,
                "current Acceptance results",
            )
        except ValueError as error:
            raise RuntimeError("invalid current Acceptance results") from error
        if (
            not isinstance(current_envelope, dict)
            or set(current_envelope) != {"source", "results"}
            or current_envelope.get("source") != source_identity(REPO_ROOT)
        ):
            raise RuntimeError(
                "current Acceptance results source does not match current source"
            )
        in_progress_results = current_envelope["results"]
        current_proven = proven_gate_ids(
            in_progress_results,
            label="current Acceptance results",
        )
        current_gate_ids = {
            result.get("id")
            for result in in_progress_results
            if isinstance(result, dict)
            and isinstance(result.get("id"), str)
            and result.get("id")
        }
        passed.difference_update(current_gate_ids)
        passed.update(current_proven)
    if require_run and latest_missing and not current_results:
        raise EvidenceManifestInvalid("Acceptance run evidence is required")
    if current_gate_id:
        # The current process produces this gate's evidence and can only appear
        # in latest-run.json after the process exits.
        passed.add(current_gate_id)
    return passed


def validate_capability(
    repo_root: Path,
    acceptance_root: Path,
    capability: dict[str, Any],
    features: list[dict[str, Any]],
    gate_defs: dict[str, Any],
    passed_gates: set[str],
    require_proven: bool,
) -> dict[str, Any]:
    capability_id = capability.get("id")
    require(bool(capability_id), "capability is missing id")
    require(
        capability.get("direction")
        in {"acceptance_core_self_validation", "acceptance_validates_product", "product_domain_validates_acceptance"},
        f"{capability_id}: invalid direction",
    )

    feature_ids = capability.get("features", [])
    required_gates = set(capability.get("required_gates", []))
    require(feature_ids, f"{capability_id}: features are required")
    require(required_gates, f"{capability_id}: required_gates are required")

    feature_gates = flatten_feature_gates(features, feature_ids)
    missing_feature_gates = feature_gates - required_gates
    require(not missing_feature_gates, f"{capability_id}: capability omits feature required gates {sorted(missing_feature_gates)}")

    for gate_id in required_gates:
        require(gate_id in gate_defs, f"{capability_id}: gate {gate_id} missing from gates.yaml")

    synthetic_paths = capability.get("synthetic_paths", [])
    require(synthetic_paths, f"{capability_id}: synthetic_paths are required")
    planned = run_plan_for_paths(repo_root, acceptance_root, synthetic_paths)
    planned_features = set(planned.get("impacted_features", []))
    planned_gates = {gate["id"] for gate in planned.get("selected_gates", [])}
    missing_features = set(feature_ids) - planned_features
    missing_gates = required_gates - planned_gates
    require(not missing_features, f"{capability_id}: synthetic paths do not impact features {sorted(missing_features)}")
    require(not missing_gates, f"{capability_id}: synthetic paths do not select gates {sorted(missing_gates)}")

    evidence = capability.get("evidence", {})
    require(evidence.get("truth_sources"), f"{capability_id}: evidence truth_sources are required")
    require(evidence.get("proven_by"), f"{capability_id}: evidence proven_by is required")
    require(evidence.get("proven_scope"), f"{capability_id}: evidence proven_scope is required")

    proven_by = set(evidence.get("proven_by", []))
    domain_proof_required = capability.get("domain_proof_required", True)
    require(
        isinstance(domain_proof_required, bool),
        f"{capability_id}: domain_proof_required must be boolean",
    )
    dedicated_missing_gates = proven_by - passed_gates
    missing_run_gates = (
        dedicated_missing_gates if domain_proof_required else set()
    )
    if require_proven and not domain_proof_required:
        status = "dedicated_proof_required"
    elif not require_proven:
        status = "structurally_valid"
    else:
        status = "proven" if not missing_run_gates else "unproven"
    return {
        "id": capability_id,
        "domain": capability.get("domain"),
        "direction": capability.get("direction"),
        "status": status,
        "features": feature_ids,
        "required_gates": sorted(required_gates),
        "planned_gates": sorted(planned_gates),
        "missing_run_gates": sorted(missing_run_gates),
        "dedicated_missing_gates": sorted(dedicated_missing_gates),
        "domain_proof_required": domain_proof_required,
        "proven_scope": evidence.get("proven_scope", []),
        "unproven_scope": evidence.get("unproven_scope", []),
    }


def active_domain_ids(acceptance_root: Path) -> list[str]:
    index = load(acceptance_root / "domains" / "index.yaml")
    domains = [
        domain.get("id", "")
        for domain in index.get("domains", [])
        if domain.get("status") == "active"
    ]
    require(domains, "no active acceptance domains registered")
    return domains


def validate_domain(
    repo_root: Path,
    acceptance_root: Path,
    domain_id: str,
    require_proven: bool,
    store: EvidenceStore,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    domain = load(acceptance_root / "domains" / f"{domain_id}.yaml")
    require(domain.get("id") == domain_id, f"domain profile id mismatch: {domain_id}")
    capabilities = load_capabilities(acceptance_root)
    features = [load(path) for path in sorted((acceptance_root / "features").glob("*.yaml"))]
    gate_defs = load(acceptance_root / "gates.yaml").get("gates", {})
    validate_finalizer_contracts(acceptance_root, gate_defs)

    selected = []
    for capability_id in domain.get("capabilities", []):
        require(capability_id in capabilities, f"domain {domain_id}: capability {capability_id} is missing")
        selected.append(capabilities[capability_id])
    require(selected, f"domain {domain_id}: no capabilities selected")
    validation_gate_id = str(domain.get("validation_gate_id") or "")
    required_gates = validate_domain_contract_closure(
        acceptance_root,
        domain_id,
        selected,
        features,
        gate_defs,
        validation_gate_id,
    )
    validate_gate_inheritance(repo_root, gate_defs, required_gates)
    validate_gate_import_isolation(repo_root, gate_defs, required_gates)
    validate_synthetic_paths(repo_root, selected, features)
    passed_gates = latest_passed_gates(
        store,
        validation_gate_id,
        require_proven,
    )

    results = [
        validate_capability(repo_root, acceptance_root, capability, features, gate_defs, passed_gates, require_proven)
        for capability in selected
    ]
    return {"domain": domain_id, "capabilities": results}, results


def validate_infra(
    repo_root: Path,
    acceptance_root: Path,
    require_proven: bool,
    store: EvidenceStore,
    current_gate_id: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    capabilities = load_capabilities(acceptance_root)
    selected = [
        capability
        for capability in capabilities.values()
        if capability.get("direction") == "acceptance_core_self_validation"
    ]
    require(selected, "no acceptance_core_self_validation capabilities found")

    features = [
        load(path)
        for path in sorted((acceptance_root / "features").glob("*.yaml"))
    ]
    gate_defs = load(acceptance_root / "gates.yaml").get("gates", {})
    validate_finalizer_contracts(acceptance_root, gate_defs)
    required_gates = validate_domain_contract_closure(
        acceptance_root,
        "acceptance-infra",
        selected,
        features,
        gate_defs,
        current_gate_id,
    )
    validate_gate_inheritance(repo_root, gate_defs, required_gates)
    validate_gate_import_isolation(repo_root, gate_defs, required_gates)
    validate_synthetic_paths(repo_root, selected, features)
    passed_gates = latest_passed_gates(
        store,
        current_gate_id,
        require_proven,
    )
    results = [
        validate_capability(
            repo_root,
            acceptance_root,
            capability,
            features,
            gate_defs,
            passed_gates,
            require_proven,
        )
        for capability in selected
    ]
    return {"scope": "acceptance-infra", "capabilities": results}, results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="tooling/acceptance")
    parser.add_argument("--domain", default="")
    parser.add_argument("--infra", action="store_true")
    parser.add_argument("--require-proven", action="store_true")
    parser.add_argument("--candidate-ref-file")
    parser.add_argument("--candidate-manifest-sha256")
    parser.add_argument("--proof-envelope-ref-out")
    parser.add_argument("--proof-envelope-sha-out")
    parser.add_argument("--proof-set-ref-file")
    parser.add_argument("--proof-set-manifest-sha256")
    parser.add_argument("--validate-agent-v2-proof-set", action="store_true")
    args = parser.parse_args()
    require(
        not (args.infra and args.domain),
        "--infra and --domain are mutually exclusive",
    )

    repo_root = REPO_ROOT
    acceptance_root = repo_root / args.root
    domain_ids = (
        []
        if args.infra
        else [args.domain] if args.domain else active_domain_ids(acceptance_root)
    )
    store = EvidenceStore.from_environment(
        repo_root=repo_root,
        worktree=repo_root,
    )
    if args.candidate_ref_file:
        require(
            bool(args.candidate_manifest_sha256),
            "--candidate-manifest-sha256 is required",
        )
        require(
            bool(args.proof_envelope_ref_out),
            "--proof-envelope-ref-out is required",
        )
        require(
            not args.domain
            and not args.require_proven
            and not args.proof_set_ref_file,
            "candidate validation cannot be combined with domain validation",
        )
        envelope_ref = prove_candidate(
            store,
            read_ref_file(args.candidate_ref_file),
            args.candidate_manifest_sha256,
            args.proof_envelope_ref_out,
            args.proof_envelope_sha_out,
        )
        print(
            "proof-envelope: "
            + json.dumps(envelope_ref.to_dict(), sort_keys=True)
        )
        return 0

    if args.validate_agent_v2_proof_set:
        require(
            bool(args.proof_set_ref_file)
            and bool(args.proof_set_manifest_sha256),
            "--validate-agent-v2-proof-set requires "
            "--proof-set-ref-file and --proof-set-manifest-sha256",
        )
        require(
            not args.domain and not args.require_proven,
            "Agent V2 proof-set validation cannot be combined with "
            "domain validation",
        )
        proof_set = validate_proof_set(
            store,
            read_ref_file(args.proof_set_ref_file),
            args.proof_set_manifest_sha256,
        )
        print(
            "agent-v2-proof-set: "
            + json.dumps(
                {
                    "proofStatus": proof_set["proofStatus"],
                    "gateIds": [
                        item["gateId"]
                        for item in proof_set["gateProofs"]
                    ],
                },
                sort_keys=True,
            )
        )
        return 0

    require(
        not args.proof_set_ref_file
        and not args.proof_set_manifest_sha256,
        "proof-set inputs require --validate-agent-v2-proof-set",
    )
    if os.environ.get(RUN_GATE_ENV):
        gate_id = os.environ[RUN_GATE_ENV]
    elif args.infra:
        gate_id = "acceptance-infra-validation"
    elif len(domain_ids) == 1:
        profile = load(acceptance_root / "domains" / f"{domain_ids[0]}.yaml")
        gate_id = str(profile.get("validation_gate_id") or "acceptance-validate")
    else:
        gate_id = "acceptance-validate"

    print("Acceptance Domain Validation")
    print("============================")
    unproven: list[dict[str, Any]] = []
    with ArtifactSession(repo_root=repo_root, gate_id=gate_id) as session:
        if args.infra:
            report, results = validate_infra(
                repo_root,
                acceptance_root,
                args.require_proven,
                store,
                gate_id,
            )
            validation_items = [("acceptance-infra", report, results)]
        else:
            validation_items = []
            for domain_id in domain_ids:
                report, results = validate_domain(
                    repo_root,
                    acceptance_root,
                    domain_id,
                    args.require_proven,
                    store,
                )
                validation_items.append((domain_id, report, results))

        for target_id, report, results in validation_items:
            role = (
                "validation"
                if len(validation_items) == 1
                else f"validation:{target_id}"
            )
            reference = session.write_json(
                f"reports/{target_id}-validation.json",
                report,
                role=role,
            )
            print(f"[OK] scope: {target_id}")
            print(f"[OK] capabilities: {len(results)}")
            print(f"[OK] report: {json.dumps(reference.to_dict(), sort_keys=True)}")
            for result in results:
                print(f"[{result['status'].upper()}] {result['id']}")
                if args.require_proven and result["missing_run_gates"]:
                    print(f"  missing_run_gates: {', '.join(result['missing_run_gates'])}")
            if args.require_proven:
                unproven.extend(
                    result for result in results if result["status"] != "proven"
                )
        status = "passed" if not unproven else "failed"
        session.complete(
            status=status,
            completion_status="DONE" if not unproven else "PARTIAL",
            proof_status="PROVEN" if not unproven else "UNPROVEN",
        )

    return 0 if not unproven else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"acceptance validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
