from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import ArtifactRef, EvidenceStore, source_identity

HASH = "a" * 64

ROLE_OBSERVATIONS = {
    "cell-results": {
        "cellId": "cell-1",
        "status": "passed",
        "expected": "expected",
        "actual": "actual",
    },
    "cleanup": {
        "resourceKind": "process",
        "resourceIdHash": HASH,
        "status": "clean",
    },
    "contract-evidence": {
        "contractId": "mobile-agent-v2",
        "contractHash": HASH,
        "platform": "mobile_contract",
        "status": "passed",
        "roundTripEqual": True,
    },
    "command-ids": {
        "commandId": "command-1",
        "idempotencyKeyHash": HASH,
        "objectIds": ["object-1"],
    },
    "executor-receipts": {
        "receiptId": "receipt-1",
        "toolCallId": "tool-call-1",
        "fencingToken": 1,
        "status": "APPLIED",
        "payloadHash": HASH,
    },
    "guard-report": {
        "guardId": "agent-d11-entrypoints",
        "sourceInventoryHash": HASH,
        "violationCount": 0,
        "passed": True,
    },
    "measurement-report": {
        "metric": "latency",
        "sampleIds": ["sample-001"],
        "threshold": "p95<=250ms",
        "passed": True,
    },
    "metrics-lineage": {
        "runId": "run-1",
        "metricsVersion": "1",
        "metricsHash": HASH,
        "sourceAttemptIds": ["attempt-1"],
    },
    "oauth-resource-manifest": {
        "connectionRevision": 1,
        "resourceId": "resource-1",
        "resourceVersion": "1",
        "scopesHash": HASH,
    },
    "process-port-secret-canary": {
        "processCount": 0,
        "portCount": 0,
        "secretLeakCount": 0,
        "passed": True,
    },
    "projection-revisions": {
        "slice": "tasks",
        "beforeRevision": 1,
        "afterRevision": 2,
    },
    "provider-revoke": {
        "providerId": "provider-1",
        "status": "revoked",
        "idempotencyKeyHash": HASH,
    },
    "readiness-snapshots": {
        "snapshotId": "readiness-1",
        "state": "ready",
        "authority": "station",
        "revision": 1,
    },
    "receiver-dom": {
        "scenarioId": "scenario-1",
        "cellId": "cell-1",
        "selector": "[data-testid=agent-v2]",
        "locale": "en",
        "textHash": HASH,
        "expectedVisible": True,
        "visible": True,
    },
    "replay": {
        "sourceHash": HASH,
        "replayHash": HASH,
        "equal": True,
    },
    "runtime-events": {
        "eventId": "event-1",
        "sequence": 1,
        "eventType": "progress",
        "occurredAt": "2026-08-18T00:00:00+00:00",
    },
    "side-effect-count": {
        "counterId": "counter-1",
        "count": 1,
        "maximum": 1,
    },
    "station-readback": {
        "entityKind": "turn",
        "entityIdHash": HASH,
        "revision": 1,
        "stateHash": HASH,
    },
    "turn-trace": {
        "turnId": "turn-1",
        "traceId": "trace-1",
        "terminalStatus": "completed",
        "traceHash": HASH,
    },
    "zero-execution": {
        "counterKind": "provider-call",
        "count": 0,
        "expected": 0,
    },
}


def load_script(name: str) -> Any:
    path = REPO_ROOT / "tooling/scripts" / name
    spec = importlib.util.spec_from_file_location(
        name.replace("-", "_").replace(".py", ""),
        path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GateProofContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.root = self.base / "artifacts"
        self.store = EvidenceStore(self.root, worktree=REPO_ROOT)
        self.validator = load_script("acceptance-validate.py")
        self.contract = self.validator.load_agent_v2_contract()
        self.matrix = self.validator.matrix_identity(self.contract)
        (
            self.tuples,
            self.role_tuples,
            self.attestation_profiles,
        ) = self.validator.expanded_matrix_contract(self.contract)
        self.source = source_identity(REPO_ROOT)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def schema(self, name: str) -> dict[str, Any]:
        return self.validator.schema_descriptor(self.contract, name)

    def tuple_objects(self, gate_id: str) -> list[dict[str, Any]]:
        tuples = []
        for value in sorted(self.tuples[gate_id]):
            item = dict(zip(self.validator.TUPLE_FIELDS, json.loads(value)))
            attestation_profile = self.attestation_profiles[gate_id][value]
            suffix = hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
            common = {
                "attestationProfile": attestation_profile,
                "stationProfile": "fixture",
                "networkPath": "local",
                "machine": "fixture-machine",
                "coldWarmState": (
                    "cold"
                    if item["sample_id"].startswith("cold-")
                    else "warm"
                    if item["sample_id"].startswith("warm-")
                    else "contract"
                    if item["locale"] == "contract"
                    else "neutral"
                ),
                "observedAt": "2026-08-18T00:00:00+00:00",
            }
            if gate_id != self.validator.FOUNDATION_GATE_ID:
                common["scenarioExecutionId"] = f"execution-{suffix}"
            if attestation_profile == "contract_only":
                item.update(
                    {
                        **common,
                        "contractAttestation": {
                            "contractId": "mobile-agent-v2",
                            **(
                                {"contractRunId": f"contract-run-{suffix}"}
                                if gate_id != self.validator.FOUNDATION_GATE_ID
                                else {}
                            ),
                            "contractHash": HASH,
                            "platform": item["platform"],
                            "toolchain": "typescript",
                            "roundTripStatus": "passed",
                        },
                    }
                )
                tuples.append(item)
                continue
            if attestation_profile == "orchestration_guard":
                item.update(
                    {
                        **common,
                        "guardAttestation": {
                            "guardId": "agent-d11-entrypoints",
                            "sourceInventoryHash": HASH,
                            "violationCount": 0,
                        },
                    }
                )
                tuples.append(item)
                continue
            if attestation_profile == "non_advertised":
                item.update(
                    {
                        **common,
                        "capabilityInventoryAttestation": {
                            "inventoryHash": HASH,
                            "surfaceId": item["runtime"],
                            "zeroExecutionCount": 0,
                        },
                    }
                )
                tuples.append(item)
                continue
            if attestation_profile == "station_command":
                item.update(
                    {
                        **common,
                        "actorIdentityHash": HASH,
                        "desktopMode": "test",
                        "commandAttestation": {
                            "commandId": f"command-{suffix}",
                            "commandKind": "home",
                            "idempotencyKeyHash": hashlib.sha256(
                                f"idempotency-{suffix}".encode("utf-8")
                            ).hexdigest(),
                            "objectIds": [f"object-{suffix}"],
                            "projectionRevision": 1,
                        },
                    }
                )
                tuples.append(item)
                continue
            if attestation_profile == "station_control_plane":
                item.update(
                    {
                        **common,
                        "actorIdentityHash": HASH,
                        "desktopMode": "test",
                        "controlPlaneAttestation": {
                            "authority": "station",
                            "entityIdHash": hashlib.sha256(
                                f"entity-{suffix}".encode("utf-8")
                            ).hexdigest(),
                            "readinessSnapshotId": f"readiness-{suffix}",
                            "revision": 1,
                            "stateHash": hashlib.sha256(
                                f"state-{suffix}".encode("utf-8")
                            ).hexdigest(),
                            "zeroExecutionCount": 0,
                        },
                    }
                )
                tuples.append(item)
                continue
            if attestation_profile == "unavailable_runtime":
                activity_hash = hashlib.sha256(
                    f"activity-{suffix}".encode("utf-8")
                ).hexdigest()
                item.update(
                    {
                        **common,
                        "actorIdentityHash": HASH,
                        "desktopMode": "test",
                        "unavailableAttestation": {
                            "readinessSnapshotId": f"readiness-{suffix}",
                            "state": "unavailable",
                            "reasonCode": "runtime-unavailable",
                            "activityBeforeHash": activity_hash,
                            "activityAfterHash": activity_hash,
                            "zeroExecutionCount": 0,
                        },
                    }
                )
                tuples.append(item)
                continue
            if gate_id == "agent-v2-connector-invocation-e2e":
                common["oauthProviderId"] = f"oauth-provider-{suffix}"
            runtime_snapshot = {
                "runtimeKind": item["runtime"],
                "providerId": f"provider-{suffix}",
                "modelId": f"model-{suffix}",
                "runtimeProfileId": f"profile-{suffix}",
                "capabilities": {
                    "input": {"text": True},
                    "output": {"text": True},
                    "runtime": {"streaming": True},
                    "agentic": {"tools": True},
                    "limits": {"contextTokens": 1024},
                    "resolution": {"text": "native"},
                    "provenance": {"source": "fixture"},
                },
                "providerConfigVersion": "1",
                "agentConfigVersion": "1",
                "externalSessionId": f"external-{suffix}",
                "externalSessionEpoch": 1,
                "thinkingMode": "auto",
            }
            runtime_snapshot_hash = hashlib.sha256(
                json.dumps(
                    runtime_snapshot,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()
            capability_snapshot_hash = hashlib.sha256(
                json.dumps(
                    runtime_snapshot["capabilities"],
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()
            config_snapshot_hash = hashlib.sha256(
                json.dumps(
                    {
                        "agentConfigVersion": runtime_snapshot[
                            "agentConfigVersion"
                        ],
                        "providerConfigVersion": runtime_snapshot[
                            "providerConfigVersion"
                        ],
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()
            item.update(
                {
                    **common,
                    "actorIdentityHash": HASH,
                    "conversationRuntimeBinding": {
                        "runtimeKind": item["runtime"],
                        "providerId": runtime_snapshot["providerId"],
                        "modelId": runtime_snapshot["modelId"],
                        "runtimeProfileId": runtime_snapshot[
                            "runtimeProfileId"
                        ],
                        "externalSessionId": runtime_snapshot[
                            "externalSessionId"
                        ],
                        "externalSessionEpoch": runtime_snapshot[
                            "externalSessionEpoch"
                        ],
                        "runtimeHomeRefHash": HASH,
                        "capabilitySnapshotHash": capability_snapshot_hash,
                        "configSnapshotHash": config_snapshot_hash,
                        "boundAt": "2026-08-18T00:00:00+00:00",
                    },
                    "runtimeSnapshot": runtime_snapshot,
                    "turnAttempt": {
                        "attemptId": f"attempt-{suffix}",
                        "turnId": f"turn-{suffix}",
                        "index": 1,
                        "contextLedgerId": f"context-{suffix}",
                        "capabilityReadinessSnapshotId": f"readiness-{suffix}",
                        "status": "running",
                        "runtimeSnapshotHash": runtime_snapshot_hash,
                    },
                    "desktopMode": "test",
                }
            )
            if attestation_profile in {
                "direct_runtime",
                "direct_runtime_no_local_capability",
                "client_capability_turn",
            }:
                capability_id = f"capability-{suffix}"
                device_id = f"device-{suffix}"
                lease_id = f"lease-{suffix}"
                item["clientSession"] = {
                    "capabilitySessionId": f"session-{suffix}",
                    "actorIdHash": HASH,
                    "deviceId": device_id,
                    "platform": item["platform"],
                    "capabilities": (
                        []
                        if attestation_profile
                        == "direct_runtime_no_local_capability"
                        else [
                            {
                                "capabilityId": capability_id,
                                "schemaVersion": "1",
                                "permission": "granted",
                                "constraints": {
                                    "maxRequestBytes": 1024,
                                    "maxResultBytes": 1024,
                                    "allowedResourceKinds": ["text"],
                                },
                            }
                        ]
                    ),
                    "expiresAt": "2026-08-18T01:00:00+00:00",
                    "connectionId": f"connection-{suffix}",
                    "leaseId": lease_id,
                }
                if attestation_profile != "direct_runtime_no_local_capability":
                    item["toolCallBinding"] = {
                        "toolCallId": f"tool-call-{suffix}",
                        "turnId": f"turn-{suffix}",
                        "attemptId": f"attempt-{suffix}",
                        "capabilityId": capability_id,
                        "capabilityVersion": "1",
                        "bindingId": f"binding-{suffix}",
                        "bindingRevision": 1,
                        "readinessSnapshotId": f"readiness-{suffix}",
                        "selectedDeviceId": device_id,
                        "selectedLeaseId": lease_id,
                        "sideEffectReceiptId": f"receipt-{suffix}",
                    }
            elif attestation_profile == "station_capability_turn":
                item["stationToolCallBinding"] = {
                    "toolCallId": f"tool-call-{suffix}",
                    "turnId": f"turn-{suffix}",
                    "attemptId": f"attempt-{suffix}",
                    "capabilityId": f"capability-{suffix}",
                    "capabilityVersion": "1",
                    "bindingId": f"binding-{suffix}",
                    "bindingRevision": 1,
                    "readinessSnapshotId": f"readiness-{suffix}",
                    "sideEffectReceiptId": f"receipt-{suffix}",
                }
                item["stationExecutorAttestation"] = {
                    "executorId": f"station-executor-{suffix}",
                    "executorKind": "station",
                    "executorRevision": 1,
                }
            tuples.append(item)
        return tuples

    def create_candidate(
        self,
        gate_id: str,
        *,
        omit_role: str = "",
        duplicate_tuple: bool = False,
        duplicate_execution_id: bool = False,
        duplicate_primary_execution_id: bool = False,
        source_override: dict[str, str] | None = None,
        missing_semantic_field: tuple[str, str] | None = None,
        runtime_missing_path: str = "",
        runtime_value_override: tuple[str, Any] | None = None,
        role_binding_mutation: str = "",
        role_value_override: tuple[str, str, Any] | None = None,
        unexpected_role_tuple: str = "",
        profile_value_override: tuple[str, str, Any] | None = None,
        profile_extra_field: tuple[str, str, Any] | None = None,
    ) -> ArtifactRef:
        run = self.store.begin_run(gate_id, source=self.source)
        required_roles = self.contract["gates"][gate_id]["roles"]
        role_schemas: dict[str, Any] = {}
        candidate_source = source_override or self.source
        runtime_tuples = self.tuple_objects(gate_id)

        def runtime_target(path: str) -> tuple[dict[str, Any], str]:
            components = path.split(".")
            for candidate in runtime_tuples:
                target = candidate
                for component in components[:-1]:
                    nested = target.get(component)
                    if not isinstance(nested, dict):
                        break
                    target = nested
                else:
                    if components[-1] in target:
                        return target, components[-1]
            raise AssertionError(f"invalid runtime mutation path: {path}")

        for role in required_roles:
            schema_name = (
                role if role in self.contract["schemas"] else "evidence-role"
            )
            role_schemas[role] = self.schema(schema_name)
            if role == omit_role or role == "role-schema-report":
                continue
            if role == "source-identity":
                artifact = {
                    "artifactKind": "agent-v2-source-identity",
                    "schema": self.schema("source-identity"),
                    "role": role,
                    "gateId": gate_id,
                    "runId": run.run_id,
                    "sourceIdentity": candidate_source,
                    "runtimeMatrix": self.matrix,
                }
            elif role == "runner-attestation":
                artifact = {
                    "artifactKind": "agent-v2-runner-attestation",
                    "schema": self.schema("runner-attestation"),
                    "role": role,
                    "gateId": gate_id,
                    "runId": run.run_id,
                    "producer": {
                        "kind": "runner",
                        "processId": os.getpid() + 10000,
                        "invocationId": f"runner-{run.run_id}",
                    },
                    "candidateOnly": True,
                }
            elif role == "runtime-attestation-set":
                tuples = copy.deepcopy(runtime_tuples)
                if duplicate_tuple:
                    tuples[-1] = dict(tuples[0])
                if duplicate_execution_id:
                    runtime_truthful = [
                        item for item in tuples if "scenarioExecutionId" in item
                    ]
                    runtime_truthful[-1]["scenarioExecutionId"] = (
                        runtime_truthful[0]["scenarioExecutionId"]
                    )
                if duplicate_primary_execution_id:
                    commands = [
                        item["commandAttestation"]
                        for item in tuples
                        if "commandAttestation" in item
                    ]
                    commands[-1]["commandId"] = commands[0]["commandId"]
                if runtime_missing_path:
                    runtime_tuples = tuples
                    target, field = runtime_target(runtime_missing_path)
                    target.pop(field)
                if runtime_value_override is not None:
                    path, replacement = runtime_value_override
                    runtime_tuples = tuples
                    target, field = runtime_target(path)
                    target[field] = replacement
                if profile_value_override is not None:
                    profile, path, replacement = profile_value_override
                    target = next(
                        item
                        for item in tuples
                        if item.get("attestationProfile") == profile
                    )
                    components = path.split(".")
                    for component in components[:-1]:
                        nested = target.get(component)
                        if not isinstance(nested, dict):
                            raise AssertionError(
                                f"invalid profile override path: {path}"
                            )
                        target = nested
                    target[components[-1]] = replacement
                if profile_extra_field is not None:
                    profile, field, replacement = profile_extra_field
                    target = next(
                        item
                        for item in tuples
                        if item.get("attestationProfile") == profile
                    )
                    target[field] = replacement
                artifact = {
                    "artifactKind": "agent-v2-runtime-attestation-set",
                    "schema": self.schema("runtime-attestation-set"),
                    "role": role,
                    "gateId": gate_id,
                    "runId": run.run_id,
                    "sourceIdentity": candidate_source,
                    "runtimeMatrix": self.matrix,
                    "tuples": tuples,
                    "oracle": {
                        "assertionId": "runtime-matrix-exact",
                        "status": "passed",
                        "expectedTupleCount": len(tuples),
                    },
                    "observedAt": "2026-08-18T00:00:00+00:00",
                }
            else:
                oracle_id = f"{role}-oracle"
                observations = []
                runtime_refs = []
                scenario_ids = set()
                applicable_keys = self.role_tuples[gate_id][role]
                applicable_tuples = [
                    tuple_item
                    for tuple_item in runtime_tuples
                    if json.dumps(
                        [
                            tuple_item[field]
                            for field in self.validator.TUPLE_FIELDS
                        ],
                        separators=(",", ":"),
                    )
                    in applicable_keys
                ]
                if unexpected_role_tuple == role:
                    applicable_tuples.append(
                        next(
                            tuple_item
                            for tuple_item in runtime_tuples
                            if json.dumps(
                                [
                                    tuple_item[field]
                                    for field in self.validator.TUPLE_FIELDS
                                ],
                                separators=(",", ":"),
                            )
                            not in applicable_keys
                        )
                    )
                for tuple_item in applicable_tuples:
                    runtime_key = json.dumps(
                        [
                            tuple_item[field]
                            for field in self.validator.TUPLE_FIELDS
                        ],
                        separators=(",", ":"),
                    )
                    observation = copy.deepcopy(ROLE_OBSERVATIONS[role])
                    observation.update(
                        {
                            "runtimeTupleKey": runtime_key,
                            "scenarioId": tuple_item["cell"],
                            "sampleId": tuple_item["sample_id"],
                            "actorIdentityHash": tuple_item.get(
                                "actorIdentityHash",
                                HASH,
                            ),
                            "oracleAssertionId": oracle_id,
                        }
                    )
                    if gate_id != self.validator.FOUNDATION_GATE_ID:
                        observation["scenarioExecutionId"] = tuple_item[
                            "scenarioExecutionId"
                        ]
                    if (
                        role == "receiver-dom"
                        and tuple_item.get("attestationProfile")
                        == "non_advertised"
                    ):
                        observation["expectedVisible"] = False
                        observation["visible"] = False
                    if role == "receiver-dom":
                        observation["locale"] = tuple_item["locale"]
                    if role == "measurement-report":
                        observation["sampleIds"] = [tuple_item["sample_id"]]
                    if role == "contract-evidence":
                        observation["contractId"] = tuple_item["cell"]
                        observation["platform"] = tuple_item["platform"]
                    command = tuple_item.get("commandAttestation")
                    if role == "command-ids" and isinstance(command, dict):
                        observation["commandId"] = command["commandId"]
                        observation["idempotencyKeyHash"] = command[
                            "idempotencyKeyHash"
                        ]
                        observation["objectIds"] = command["objectIds"]
                    control = tuple_item.get("controlPlaneAttestation")
                    if role == "readiness-snapshots" and isinstance(
                        control, dict
                    ):
                        observation["snapshotId"] = control[
                            "readinessSnapshotId"
                        ]
                    tool_binding = (
                        tuple_item.get("toolCallBinding")
                        or tuple_item.get("stationToolCallBinding")
                    )
                    if role == "executor-receipts" and isinstance(
                        tool_binding, dict
                    ):
                        observation["toolCallId"] = tool_binding["toolCallId"]
                        observation["receiptId"] = tool_binding[
                            "sideEffectReceiptId"
                        ]
                    turn_attempt = tuple_item.get("turnAttempt")
                    if role == "turn-trace" and isinstance(turn_attempt, dict):
                        observation["turnId"] = turn_attempt["turnId"]
                    if role == "provider-revoke":
                        observation["providerId"] = tuple_item[
                            "oauthProviderId"
                        ]
                    if "cellId" in observation:
                        observation["cellId"] = tuple_item["cell"]
                    observations.append(observation)
                    runtime_refs.append(runtime_key)
                    scenario_ids.add(tuple_item["cell"])
                if (
                    missing_semantic_field is not None
                    and missing_semantic_field[0] == role
                ):
                    observations[0].pop(missing_semantic_field[1])
                if (
                    role_value_override is not None
                    and role_value_override[0] == role
                ):
                    observations[0][role_value_override[1]] = (
                        role_value_override[2]
                    )
                if role_binding_mutation == "runtime-ref":
                    observations[0]["runtimeTupleKey"] = "[]"
                elif role_binding_mutation == "actor":
                    observations[0]["actorIdentityHash"] = "b" * 64
                elif role_binding_mutation == "sample":
                    observations[0]["sampleId"] = "other-sample"
                elif role_binding_mutation == "oracle":
                    observations[0]["oracleAssertionId"] = "other-oracle"
                elif role_binding_mutation == "scenario-permute":
                    first = next(
                        (
                            index
                            for index, observation in enumerate(observations)
                            if observation["scenarioId"]
                            != observations[0]["scenarioId"]
                        ),
                        None,
                    )
                    if first is None:
                        observations[0]["scenarioId"] = "other-scenario"
                    else:
                        observations[0]["scenarioId"], observations[first][
                            "scenarioId"
                        ] = (
                            observations[first]["scenarioId"],
                            observations[0]["scenarioId"],
                        )
                actual_hash = hashlib.sha256(
                    json.dumps(
                        observations,
                        sort_keys=True,
                        separators=(",", ":"),
                    ).encode("utf-8")
                ).hexdigest()
                artifact = {
                    "artifactKind": "agent-v2-gate-evidence",
                    "schema": self.schema("evidence-role"),
                    "role": role,
                    "gateId": gate_id,
                    "runId": run.run_id,
                    "sourceIdentity": candidate_source,
                    "runtimeMatrix": self.matrix,
                    "actorIdentityHash": HASH,
                    "runtimeAttestationRefs": runtime_refs,
                    "scenarioIds": (
                        [*sorted(scenario_ids), "other-scenario"]
                        if role_binding_mutation == "scenario"
                        else sorted(scenario_ids)
                    ),
                    "sampleCount": (
                        len(observations) - 1
                        if role_binding_mutation == "sample-count"
                        else len(observations)
                    ),
                    "observations": observations,
                    "oracle": {
                        "assertionId": oracle_id,
                        "status": "passed",
                        "expected": "role-specific assertion passes",
                        "actualHash": (
                            "b" * 64
                            if role_binding_mutation == "actual-hash"
                            else actual_hash
                        ),
                    },
                    "observedAt": "2026-08-18T00:00:00+00:00",
                }
            run.write_json(
                f"roles/{role}.json",
                artifact,
                role=role,
                redact=False,
            )
        if omit_role != "role-schema-report":
            run.write_json(
                "roles/role-schema-report.json",
                {
                    "artifactKind": "agent-v2-role-schema-report",
                    "schema": self.schema("role-schema-report"),
                    "role": "role-schema-report",
                    "gateId": gate_id,
                    "runId": run.run_id,
                    "schemas": role_schemas,
                },
                role="role-schema-report",
                redact=False,
            )
        run.finalize(
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "CANDIDATE",
            }
        )
        reference = run.manifest_ref
        run.close()
        return reference

    def prove(self, gate_id: str) -> ArtifactRef:
        candidate = self.create_candidate(gate_id)
        output = self.base / f"{gate_id}-proof.json"
        return self.validator.prove_candidate(
            self.store,
            candidate,
            candidate.sha256,
            str(output),
            None,
        )

    def test_candidate_requires_explicit_hash_and_exact_roles(self) -> None:
        gate_id = "agent-v2-home-command-center-e2e"
        candidate = self.create_candidate(gate_id)
        validated = self.validator.validate_candidate(
            self.store, candidate, candidate.sha256
        )
        self.assertEqual(validated["candidate"]["result"]["proofStatus"], "CANDIDATE")
        with self.assertRaisesRegex(RuntimeError, "SHA-256"):
            self.validator.validate_candidate(self.store, candidate, "0" * 64)

        missing = self.create_candidate(gate_id, omit_role="receiver-dom")
        with self.assertRaisesRegex(RuntimeError, "missing roles"):
            self.validator.validate_candidate(
                self.store, missing, missing.sha256
            )

    def test_candidate_rejects_duplicate_matrix_tuple_and_stale_source(self) -> None:
        gate_id = "agent-v2-mcp-lifecycle-e2e"
        duplicate = self.create_candidate(gate_id, duplicate_tuple=True)
        with self.assertRaisesRegex(RuntimeError, "duplicate runtime tuple"):
            self.validator.validate_candidate(
                self.store, duplicate, duplicate.sha256
            )

        for field in (
            "commit",
            "workspaceDigest",
            "canonicalWorktreeHash",
        ):
            with self.subTest(source_field=field):
                stale_source = dict(self.source)
                stale_source[field] = "0" * len(stale_source[field])
                stale = self.create_candidate(
                    gate_id,
                    source_override=stale_source,
                )
                with self.assertRaisesRegex(RuntimeError, "source identity"):
                    self.validator.validate_candidate(
                        self.store,
                        stale,
                        stale.sha256,
                    )

    def test_candidate_rejects_duplicate_scenario_execution_identity(self) -> None:
        gate_id = "agent-v2-home-command-center-e2e"
        candidate = self.create_candidate(
            gate_id,
            duplicate_execution_id=True,
        )
        with self.assertRaisesRegex(
            RuntimeError,
            "duplicate scenario execution identity",
        ):
            self.validator.validate_candidate(
                self.store,
                candidate,
                candidate.sha256,
            )

    def test_candidate_rejects_duplicate_primary_execution_identity(self) -> None:
        gate_id = "agent-v2-home-command-center-e2e"
        candidate = self.create_candidate(
            gate_id,
            duplicate_primary_execution_id=True,
        )
        with self.assertRaisesRegex(
            RuntimeError,
            "duplicate primary execution identity",
        ):
            self.validator.validate_candidate(
                self.store,
                candidate,
                candidate.sha256,
            )

    def test_candidate_rejects_every_role_semantic_omission(self) -> None:
        for role, observation in ROLE_OBSERVATIONS.items():
            gate_id = min(
                (
                    gate
                    for gate, definition in self.contract["gates"].items()
                    if role in definition["roles"]
                ),
                key=lambda gate: self.contract["gates"][gate][
                    "expectedTuples"
                ],
            )
            for field in observation:
                with self.subTest(role=role, field=field):
                    candidate = self.create_candidate(
                        gate_id,
                        missing_semantic_field=(role, field),
                    )
                    with self.assertRaisesRegex(
                        RuntimeError,
                        "missing semantic fields",
                    ):
                        self.validator.validate_candidate(
                            self.store,
                            candidate,
                            candidate.sha256,
                        )

    def test_candidate_rejects_role_identity_and_coverage_detachment(self) -> None:
        gate_id = "agent-v2-home-command-center-e2e"
        for mutation in (
            "runtime-ref",
            "actor",
            "sample",
            "oracle",
            "scenario",
            "scenario-permute",
            "sample-count",
            "actual-hash",
        ):
            with self.subTest(mutation=mutation):
                candidate = self.create_candidate(
                    gate_id,
                    role_binding_mutation=mutation,
                )
                with self.assertRaises(RuntimeError):
                    self.validator.validate_candidate(
                        self.store,
                        candidate,
                        candidate.sha256,
                    )

    def test_foundation_roles_cover_only_matrix_applicable_rows(self) -> None:
        gate_id = "agent-v2-kernel-foundation-e2e"
        all_tuples = self.tuples[gate_id]
        self.assertEqual(self.role_tuples[gate_id]["cell-results"], all_tuples)
        self.assertEqual(
            self.role_tuples[gate_id]["runtime-attestation-set"],
            all_tuples,
        )
        self.assertEqual(
            {
                json.loads(key)[1]
                for key in self.role_tuples[gate_id]["contract-evidence"]
            },
            {"foundation-mobile-contract"},
        )
        self.assertEqual(
            {
                json.loads(key)[1]
                for key in self.role_tuples[gate_id]["guard-report"]
            },
            {"foundation-d11"},
        )
        self.assertNotEqual(
            self.role_tuples[gate_id]["receiver-dom"],
            all_tuples,
        )
        candidate = self.create_candidate(gate_id)
        self.validator.validate_candidate(
            self.store,
            candidate,
            candidate.sha256,
        )

    def test_candidate_rejects_observation_for_not_applicable_row(self) -> None:
        gate_id = "agent-v2-governed-tool-loop-e2e"
        candidate = self.create_candidate(
            gate_id,
            unexpected_role_tuple="contract-evidence",
        )
        with self.assertRaisesRegex(RuntimeError, "applicable tuples"):
            self.validator.validate_candidate(
                self.store,
                candidate,
                candidate.sha256,
            )

    def test_candidate_rejects_every_role_failure_semantic(self) -> None:
        mutations = (
            ("cell-results", "status", "failed"),
            ("cleanup", "status", "dirty"),
            ("command-ids", "objectIds", ["object-1", "object-1"]),
            ("command-ids", "objectIds", [""]),
            ("contract-evidence", "status", "failed"),
            ("contract-evidence", "roundTripEqual", False),
            ("executor-receipts", "fencingToken", 0),
            ("executor-receipts", "status", "PREPARED"),
            ("guard-report", "violationCount", 1),
            ("guard-report", "passed", False),
            ("measurement-report", "sampleIds", ["sample-001", "sample-001"]),
            ("measurement-report", "sampleIds", [""]),
            ("measurement-report", "passed", False),
            ("metrics-lineage", "sourceAttemptIds", ["attempt-1", "attempt-1"]),
            ("metrics-lineage", "sourceAttemptIds", [""]),
            ("oauth-resource-manifest", "connectionRevision", 0),
            ("process-port-secret-canary", "processCount", 1),
            ("process-port-secret-canary", "portCount", 1),
            ("process-port-secret-canary", "secretLeakCount", 1),
            ("process-port-secret-canary", "passed", False),
            ("projection-revisions", "afterRevision", 0),
            ("provider-revoke", "status", "pending"),
            ("readiness-snapshots", "revision", 0),
            ("readiness-snapshots", "state", "invalid"),
            ("readiness-snapshots", "authority", "client"),
            ("receiver-dom", "visible", False),
            ("replay", "equal", False),
            ("replay", "replayHash", "b" * 64),
            ("runtime-events", "sequence", 0),
            ("side-effect-count", "count", 2),
            ("side-effect-count", "count", -1),
            ("side-effect-count", "maximum", -1),
            ("station-readback", "revision", 0),
            ("turn-trace", "terminalStatus", "running"),
            ("zero-execution", "count", 1),
            ("zero-execution", "expected", 1),
        )
        for role, field, replacement in mutations:
            gate_id = min(
                (
                    gate
                    for gate, definition in self.contract["gates"].items()
                    if role in definition["roles"]
                ),
                key=lambda gate: self.contract["gates"][gate][
                    "expectedTuples"
                ],
            )
            with self.subTest(role=role, field=field):
                candidate = self.create_candidate(
                    gate_id,
                    role_value_override=(role, field, replacement),
                )
                with self.assertRaises(RuntimeError):
                    self.validator.validate_candidate(
                        self.store,
                        candidate,
                        candidate.sha256,
                    )

    def test_foundation_accepts_absent_non_advertised_runtime_selector(self) -> None:
        candidate = self.create_candidate("agent-v2-kernel-foundation-e2e")
        self.validator.validate_candidate(
            self.store,
            candidate,
            candidate.sha256,
        )

    def test_candidate_accepts_source_backed_terminal_outcomes(self) -> None:
        accepted = (
            ("executor-receipts", "status", "FAILED"),
            ("executor-receipts", "status", "RECONCILED_UNKNOWN"),
            ("provider-revoke", "status", "revocation_unconfirmed"),
            ("readiness-snapshots", "state", "degraded"),
            ("readiness-snapshots", "state", "unavailable"),
            ("readiness-snapshots", "state", "blocked"),
            ("turn-trace", "terminalStatus", "failed"),
            ("turn-trace", "terminalStatus", "cancelled"),
            ("turn-trace", "terminalStatus", "interrupted"),
        )
        for role, field, replacement in accepted:
            gate_id = min(
                (
                    gate
                    for gate, definition in self.contract["gates"].items()
                    if role in definition["roles"]
                ),
                key=lambda gate: self.contract["gates"][gate][
                    "expectedTuples"
                ],
            )
            with self.subTest(role=role, field=field, replacement=replacement):
                candidate = self.create_candidate(
                    gate_id,
                    role_value_override=(role, field, replacement),
                )
                self.validator.validate_candidate(
                    self.store,
                    candidate,
                    candidate.sha256,
                )

    def test_client_capability_allows_empty_resource_kind_constraints(
        self,
    ) -> None:
        attestation = next(
            item
            for item in self.tuple_objects(
                "agent-v2-governed-tool-loop-e2e"
            )
            if item["attestationProfile"] == "client_capability_turn"
        )
        constraints = attestation["clientSession"]["capabilities"][0][
            "constraints"
        ]
        constraints["allowedResourceKinds"] = []
        self.validator.validate_runtime_attestation(
            attestation,
            label="client capability fixture",
            expected_profile="client_capability_turn",
        )

        for invalid in ([""], ["workspace", "workspace"], [1]):
            with self.subTest(invalid=invalid):
                constraints["allowedResourceKinds"] = invalid
                with self.assertRaisesRegex(
                    RuntimeError,
                    "constraints mismatch",
                ):
                    self.validator.validate_runtime_attestation(
                        attestation,
                        label="client capability fixture",
                        expected_profile="client_capability_turn",
                    )

    def test_candidate_rejects_wrong_or_fabricated_attestation_profile(self) -> None:
        gate_id = "agent-v2-kernel-foundation-e2e"
        wrong_profile = self.create_candidate(
            gate_id,
            profile_value_override=(
                "contract_only",
                "attestationProfile",
                "direct_runtime",
            ),
        )
        with self.assertRaisesRegex(RuntimeError, "profile mismatch"):
            self.validator.validate_candidate(
                self.store,
                wrong_profile,
                wrong_profile.sha256,
            )

        fabricated_runtime = self.create_candidate(
            gate_id,
            profile_extra_field=(
                "contract_only",
                "conversationRuntimeBinding",
                {},
            ),
        )
        with self.assertRaisesRegex(RuntimeError, "payload fields mismatch"):
            self.validator.validate_candidate(
                self.store,
                fabricated_runtime,
                fabricated_runtime.sha256,
            )

        failed_guard = self.create_candidate(
            gate_id,
            profile_value_override=(
                "orchestration_guard",
                "guardAttestation.violationCount",
                1,
            ),
        )
        with self.assertRaisesRegex(RuntimeError, "did not pass cleanly"):
            self.validator.validate_candidate(
                self.store,
                failed_guard,
                failed_guard.sha256,
            )

        advertised = self.create_candidate(
            gate_id,
            profile_value_override=(
                "non_advertised",
                "capabilityInventoryAttestation.zeroExecutionCount",
                1,
            ),
        )
        with self.assertRaisesRegex(RuntimeError, "zero execution"):
            self.validator.validate_candidate(
                self.store,
                advertised,
                advertised.sha256,
            )

    def test_candidate_rejects_role_specific_identity_detachment(self) -> None:
        mutations = (
            ("executor-receipts", "toolCallId", "other-tool-call"),
            ("executor-receipts", "receiptId", "other-receipt"),
            ("turn-trace", "turnId", "other-turn"),
            ("readiness-snapshots", "snapshotId", "other-readiness"),
            ("provider-revoke", "providerId", "other-provider"),
            ("receiver-dom", "cellId", "other-cell"),
        )
        for role, field, replacement in mutations:
            gate_id = min(
                (
                    gate
                    for gate, definition in self.contract["gates"].items()
                    if role in definition["roles"]
                ),
                key=lambda gate: self.contract["gates"][gate][
                    "expectedTuples"
                ],
            )
            with self.subTest(role=role, field=field):
                candidate = self.create_candidate(
                    gate_id,
                    role_value_override=(role, field, replacement),
                )
                with self.assertRaises(RuntimeError):
                    self.validator.validate_candidate(
                        self.store,
                        candidate,
                        candidate.sha256,
                    )

    def test_candidate_rejects_every_runtime_binding_omission(self) -> None:
        gate_id = "agent-v2-governed-tool-loop-e2e"
        paths = [
            "actorIdentityHash",
            "stationProfile",
            "desktopMode",
            "networkPath",
            "machine",
            "coldWarmState",
            "observedAt",
            *[
                f"conversationRuntimeBinding.{field}"
                for field in (
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
                )
            ],
            *[
                f"runtimeSnapshot.{field}"
                for field in (
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
                )
            ],
            *[
                f"runtimeSnapshot.capabilities.{field}"
                for field in (
                    "input",
                    "output",
                    "runtime",
                    "agentic",
                    "limits",
                    "resolution",
                    "provenance",
                )
            ],
            *[
                f"clientSession.{field}"
                for field in (
                    "capabilitySessionId",
                    "actorIdHash",
                    "deviceId",
                    "platform",
                    "capabilities",
                    "expiresAt",
                    "connectionId",
                    "leaseId",
                )
            ],
            *[
                f"turnAttempt.{field}"
                for field in (
                    "attemptId",
                    "turnId",
                    "index",
                    "contextLedgerId",
                    "capabilityReadinessSnapshotId",
                    "status",
                    "runtimeSnapshotHash",
                )
            ],
            *[
                f"toolCallBinding.{field}"
                for field in (
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
                )
            ],
        ]
        for path in paths:
            with self.subTest(runtime_field=path):
                candidate = self.create_candidate(
                    gate_id,
                    runtime_missing_path=path,
                )
                with self.assertRaises(RuntimeError):
                    self.validator.validate_candidate(
                        self.store,
                        candidate,
                        candidate.sha256,
                    )

    def test_candidate_rejects_runtime_cross_binding_mutations(self) -> None:
        gate_id = "agent-v2-governed-tool-loop-e2e"
        mutations = (
            ("actorIdentityHash", "b" * 64),
            ("clientSession.actorIdHash", "b" * 64),
            ("clientSession.deviceId", "other-device"),
            ("clientSession.capabilities", []),
            ("turnAttempt.runtimeSnapshotHash", "b" * 64),
            ("conversationRuntimeBinding.runtimeKind", "other-runtime"),
            ("conversationRuntimeBinding.providerId", "other-provider"),
            ("conversationRuntimeBinding.modelId", "other-model"),
            ("conversationRuntimeBinding.runtimeProfileId", "other-profile"),
            (
                "conversationRuntimeBinding.externalSessionId",
                "other-session",
            ),
            ("conversationRuntimeBinding.externalSessionEpoch", 9),
            (
                "conversationRuntimeBinding.capabilitySnapshotHash",
                "b" * 64,
            ),
            ("conversationRuntimeBinding.configSnapshotHash", "b" * 64),
            ("toolCallBinding.turnId", "other-turn"),
            ("toolCallBinding.attemptId", "other-attempt"),
            ("toolCallBinding.capabilityId", "other-capability"),
            ("toolCallBinding.capabilityVersion", "other-version"),
            ("toolCallBinding.readinessSnapshotId", "other-readiness"),
            ("toolCallBinding.selectedDeviceId", "other-device"),
            ("toolCallBinding.selectedLeaseId", "other-lease"),
        )
        for path, replacement in mutations:
            with self.subTest(runtime_field=path):
                candidate = self.create_candidate(
                    gate_id,
                    runtime_value_override=(path, replacement),
                )
                with self.assertRaises(RuntimeError):
                    self.validator.validate_candidate(
                        self.store,
                        candidate,
                        candidate.sha256,
                    )

    def test_validator_is_separate_and_candidate_proof_cas_is_immutable(self) -> None:
        gate_id = "agent-v2-evaluation-lab-e2e"
        candidate = self.create_candidate(gate_id)
        output = self.base / "proof.json"
        envelope_ref = self.validator.prove_candidate(
            self.store,
            candidate,
            candidate.sha256,
            str(output),
            None,
        )
        envelope = self.store.read_json(envelope_ref)
        validator_run = ArtifactRef.from_dict(envelope["validatorRun"])
        self.assertNotEqual(candidate.run_id, validator_run.run_id)
        self.assertEqual(envelope["proofStatus"], "PROVEN")
        self.assertEqual(
            json.loads(output.read_text(encoding="utf-8")),
            envelope_ref.to_dict(),
        )
        pointer = self.store.publish_candidate_proof(
            candidate_manifest=candidate,
            proof_envelope=envelope_ref,
        )
        self.assertTrue(pointer.is_file())
        with self.assertRaisesRegex(Exception, "different proof envelope"):
            self.validator.prove_candidate(
                self.store,
                candidate,
                candidate.sha256,
                str(self.base / "second-proof.json"),
                None,
            )

    def test_validator_attestation_fails_closed_on_identity_or_shape_drift(
        self,
    ) -> None:
        gate_id = "agent-v2-evaluation-lab-e2e"
        candidate = self.create_candidate(gate_id)
        validator_run_id = (
            "20260903T000000000000Z-0123456789abcdef0123456789abcdef"
        )
        attestation = {
            "artifactKind": "agent-v2-validator-attestation",
            "schema": self.schema("validator-attestation"),
            "role": "validator-attestation",
            "gateId": gate_id,
            "runId": validator_run_id,
            "producer": {
                "kind": "validator",
                "processId": os.getpid(),
                "invocationId": "validator-invocation",
            },
            "candidateManifest": candidate.to_dict(),
            "validatedAt": "2026-09-03T00:00:00+00:00",
        }
        producer = self.validator.validate_validator_attestation(
            self.contract,
            attestation,
            gate_id=gate_id,
            validator_run_id=validator_run_id,
            candidate_ref=candidate,
        )
        self.assertEqual(producer["kind"], "validator")

        mutations = (
            ("extra", True),
            ("gateId", "other-gate"),
            ("runId", "other-run"),
            ("candidateManifest", {**candidate.to_dict(), "sha256": "0" * 64}),
            ("schema", {**self.schema("validator-attestation"), "sha256": "0" * 64}),
        )
        for field, replacement in mutations:
            with self.subTest(field=field):
                malformed = copy.deepcopy(attestation)
                malformed[field] = replacement
                with self.assertRaises(RuntimeError):
                    self.validator.validate_validator_attestation(
                        self.contract,
                        malformed,
                        gate_id=gate_id,
                        validator_run_id=validator_run_id,
                        candidate_ref=candidate,
                    )

    def test_gate_catalog_pins_unproven_roles_and_matrix(self) -> None:
        catalog = json.loads(
            (
                REPO_ROOT / "tooling/acceptance/gates.yaml"
            ).read_text(encoding="utf-8")
        )["gates"]
        required_gate_ids = {
            gate_id for gate_id in catalog
            if gate_id.startswith("agent-v2-")
        }
        self.validator.validate_gate_catalog(catalog, required_gate_ids)

        gate_id = "agent-v2-capability-binding-e2e"
        mutated = copy.deepcopy(catalog)
        mutated[gate_id]["initial_proof_status"] = "PROVEN"
        with self.assertRaisesRegex(
            RuntimeError, "initial_proof_status must be UNPROVEN"
        ):
            self.validator.validate_gate_catalog(mutated, required_gate_ids)

        mutated = copy.deepcopy(catalog)
        mutated[gate_id]["required_artifact_roles"] = ["receiver-dom"]
        with self.assertRaisesRegex(RuntimeError, "required_artifact_roles"):
            self.validator.validate_gate_catalog(mutated, required_gate_ids)

        mutated = copy.deepcopy(catalog)
        mutated[gate_id]["runtime_matrix"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "runtime_matrix"):
            self.validator.validate_gate_catalog(mutated, required_gate_ids)

    def test_v2_uses_dedicated_proof_without_invalidating_legacy_domain(self) -> None:
        acceptance_root = REPO_ROOT / "tooling/acceptance"
        capabilities = self.validator.load_capabilities(acceptance_root)
        features = [
            self.validator.load(path)
            for path in sorted((acceptance_root / "features").glob("*.yaml"))
        ]
        gates = json.loads(
            (acceptance_root / "gates.yaml").read_text(encoding="utf-8")
        )["gates"]

        v2 = self.validator.validate_capability(
            REPO_ROOT,
            acceptance_root,
            capabilities["agent-v2-kernel-foundation"],
            features,
            gates,
            set(),
            True,
        )
        self.assertFalse(v2["domain_proof_required"])
        self.assertEqual(v2["status"], "dedicated_proof_required")
        self.assertEqual(v2["missing_run_gates"], [])
        self.assertEqual(
            v2["dedicated_missing_gates"],
            ["agent-v2-kernel-foundation-e2e"],
        )

        legacy = self.validator.validate_capability(
            REPO_ROOT,
            acceptance_root,
            capabilities["agent-mention-composer"],
            features,
            gates,
            set(),
            True,
        )
        self.assertTrue(legacy["domain_proof_required"])
        self.assertEqual(legacy["status"], "unproven")
        self.assertEqual(
            legacy["missing_run_gates"],
            ["agent-native-mention-e2e"],
        )

    def test_exact_seven_proof_set_requires_explicit_pair(self) -> None:
        proof_files: list[Path] = []
        for gate_id in self.contract["gates"]:
            reference = self.prove(gate_id)
            path = self.base / f"{gate_id}.json"
            path.write_text(
                json.dumps(reference.to_dict()) + "\n",
                encoding="utf-8",
            )
            proof_files.append(path)
        proof_set_ref = self.base / "proof-set-ref.json"
        proof_set_sha = self.base / "proof-set.sha256"
        command = [
            sys.executable,
            "tooling/scripts/acceptance-proof-set.py",
            *[
                value
                for path in proof_files
                for value in ("--proof-envelope-ref-file", str(path))
            ],
            "--proof-set-ref-out",
            str(proof_set_ref),
            "--proof-set-sha-out",
            str(proof_set_sha),
        ]
        environment = {
            **os.environ,
            "PT_ACCEPTANCE_ARTIFACT_ROOT": str(self.root),
        }
        completed = subprocess.run(
            command,
            cwd=REPO_ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        reference = ArtifactRef.from_dict(
            json.loads(proof_set_ref.read_text(encoding="utf-8"))
        )
        proof_set = self.validator.validate_proof_set(
            self.store,
            reference,
            proof_set_sha.read_text(encoding="utf-8").strip(),
        )
        self.assertEqual(len(proof_set["gateProofs"]), 7)
        with self.assertRaisesRegex(RuntimeError, "SHA-256"):
            self.validator.validate_proof_set(
                self.store,
                reference,
                "0" * 64,
            )

        omitted_command = [
            sys.executable,
            "tooling/scripts/acceptance-proof-set.py",
            *[
                value
                for path in proof_files[:-1]
                for value in ("--proof-envelope-ref-file", str(path))
            ],
            "--proof-set-ref-out",
            str(self.base / "omitted-proof-set.json"),
            "--proof-set-sha-out",
            str(self.base / "omitted-proof-set.sha256"),
        ]
        omitted = subprocess.run(
            omitted_command,
            cwd=REPO_ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(omitted.returncode, 0)
        self.assertIn("exactly seven", omitted.stderr)

        def write_mutated_proof_set(payload: dict[str, Any]) -> ArtifactRef:
            run = self.store.begin_run(
                "agent-v2-proof-set",
                source=self.source,
            )
            run.write_json(
                "proof/proof-set.json",
                payload,
                role="proof-set",
                redact=False,
            )
            run.finalize(
                result={
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                }
            )
            manifest = self.store.read_json(run.manifest_ref)
            artifact = ArtifactRef.from_dict(
                manifest["artifacts"]["proof-set"]
            )
            run.close()
            return artifact

        mixed_source = copy.deepcopy(proof_set)
        mixed_source["sourceIdentity"]["commit"] = "0" * 40
        mixed_ref = write_mutated_proof_set(mixed_source)
        with self.assertRaisesRegex(RuntimeError, "source identity"):
            self.validator.validate_proof_set(
                self.store,
                mixed_ref,
                mixed_ref.sha256,
            )

        substituted = copy.deepcopy(proof_set)
        substituted["gateProofs"][0]["proofEnvelope"] = substituted[
            "gateProofs"
        ][1]["proofEnvelope"]
        substituted["gateProofs"][0]["proofEnvelopeSha256"] = substituted[
            "gateProofs"
        ][1]["proofEnvelopeSha256"]
        substituted_ref = write_mutated_proof_set(substituted)
        with self.assertRaisesRegex(RuntimeError, "Gate mismatch"):
            self.validator.validate_proof_set(
                self.store,
                substituted_ref,
                substituted_ref.sha256,
            )

        duplicate_command = [
            sys.executable,
            "tooling/scripts/acceptance-proof-set.py",
            *[
                value
                for _ in range(7)
                for value in (
                    "--proof-envelope-ref-file",
                    str(proof_files[0]),
                )
            ],
            "--proof-set-ref-out",
            str(self.base / "duplicate-proof-set.json"),
            "--proof-set-sha-out",
            str(self.base / "duplicate-proof-set.sha256"),
        ]
        duplicate = subprocess.run(
            duplicate_command,
            cwd=REPO_ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(duplicate.returncode, 0)
        self.assertIn("duplicate proof Gate", duplicate.stderr)

        missing_pair = subprocess.run(
            [
                sys.executable,
                "tooling/scripts/acceptance-validate.py",
                "--validate-agent-v2-proof-set",
            ],
            cwd=REPO_ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(missing_pair.returncode, 0)
        self.assertIn("--proof-set-ref-file", missing_pair.stderr)

        proof_validation = subprocess.run(
            [
                sys.executable,
                "tooling/scripts/acceptance-validate.py",
                "--validate-agent-v2-proof-set",
                "--proof-set-ref-file",
                str(proof_set_ref),
                "--proof-set-manifest-sha256",
                proof_set_sha.read_text(encoding="utf-8").strip(),
            ],
            cwd=REPO_ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(
            proof_validation.returncode,
            0,
            proof_validation.stderr,
        )
        self.assertIn("agent-v2-proof-set", proof_validation.stdout)

        legacy_domain = subprocess.run(
            [
                sys.executable,
                "tooling/scripts/acceptance-validate.py",
                "--domain",
                "agent",
                "--require-proven",
            ],
            cwd=REPO_ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(legacy_domain.returncode, 0)
        self.assertNotIn("--proof-set-ref-file", legacy_domain.stderr)


if __name__ == "__main__":
    unittest.main()
