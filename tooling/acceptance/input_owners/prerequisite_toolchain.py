"""Concrete toolchain and original evidence inputs of local business aggregates."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any

from tooling.acceptance.core import ArtifactRef, EvidenceError, EvidenceStore
from tooling.acceptance.core.execution_budget import digest
from tooling.acceptance.core.operation_observer import runner_operation_stream
from .source_toolchain import source_observation
from .observation_trace import InputOwnerTrace


OWNER_ID = "prerequisite-toolchain"
COMMANDS = {
    "chat-lifecycle-ccu-aggregate-e2e": "python3 -m tooling.acceptance.gates.chat.lifecycle_ccu_aggregate",
    "chat-storage-governance-aggregate-e2e": "python3 -m tooling.acceptance.gates.chat_storage.governance_aggregate",
    "chat-storage-batch-clear-aggregate-e2e": (
        "python3 -m unittest tooling.acceptance.gates.chat_storage.batch_clear_aggregate_test"
        " && python3 -m tooling.acceptance.gates.chat_storage.batch_clear_aggregate"
    ),
    "station-access-lifecycle-aggregate-e2e": "python3 -m tooling.acceptance.gates.station_access.lifecycle_aggregate",
    "station-access-relay-security-e2e": "python3 -m tooling.acceptance.gates.station_access.relay_aggregate",
    "unified-relay-station-access-aggregate-e2e": "python3 -m tooling.acceptance.gates.station_access.relay_aggregate",
    "x-config-api-aggregate-e2e": "python3 -m tooling.acceptance.gates.x_config.aggregate",
}


def original_producer_inputs(context: dict[str, Any], store: EvidenceStore) -> dict[str, Any]:
    gate = context["gate"]
    inputs = context["inputArtifacts"]
    if (
        gate["id"] not in COMMANDS or gate.get("command") != COMMANDS[gate["id"]]
        or not isinstance(inputs, dict)
        or set(inputs) != {
            "artifactKind", "gateId", "workspaceId", "runId", "artifacts", "prerequisiteProofs",
        }
        or inputs["artifactKind"] != "acceptance-gate-input-artifacts"
        or inputs["gateId"] != gate["id"] or inputs["workspaceId"] != store.workspace_id
        or inputs["artifacts"] != {}
        or not isinstance(inputs["prerequisiteProofs"], list)
    ):
        raise ValueError("aggregate owner requires its original closed input context")
    dependencies = gate.get("dependsOn", [])
    references = inputs["prerequisiteProofs"]
    if (
        not dependencies or len(set(dependencies)) != len(dependencies)
        or len(references) != len(dependencies)
    ):
        raise ValueError("aggregate input prerequisite inventory is incomplete")
    producers = {}
    for producer, item in zip(dependencies, references):
        if (
            not isinstance(item, dict) or set(item) != {"gateId", "runManifest"}
            or item["gateId"] != producer
        ):
            raise ValueError("aggregate input prerequisite identity changed")
        ref = ArtifactRef.from_dict(item["runManifest"])
        if ref.workspace_id != store.workspace_id:
            raise ValueError("aggregate prerequisite belongs to another workspace")
        manifest = store.read_run_manifest(
            ref, manifest_sha256=ref.sha256, expected_gate_id=producer,
        )
        result = manifest.get("result", {})
        scan = result.get("secretScan") if isinstance(result, dict) else None
        redaction = manifest.get("redaction")
        if (
            manifest.get("source") != context["source"]
            or not isinstance(result, dict)
            or any(result.get(key) != value for key, value in (
                ("status", "passed"), ("completionStatus", "DONE"), ("proofStatus", "PROVEN"),
            ))
            or result.get("cleanupStatus") not in {"passed", "not-required"}
            or not isinstance(scan, dict) or scan.get("status") != "passed"
            or not isinstance(redaction, dict) or redaction.get("status") != "passed"
        ):
            raise ValueError("aggregate prerequisite has no complete current-source proof")
        producers[producer] = {
            "reference": ref.to_dict(),
            "source": manifest["source"],
            "result": result,
            "inventory": manifest["artifacts"],
        }
    return producers


def prerequisite_observation(context: dict[str, Any], *, root: Path) -> dict[str, Any]:
    gate_id = context["gate"]["id"]
    if gate_id not in COMMANDS or context["gate"].get("command") != COMMANDS[gate_id]:
        raise ValueError("aggregate input owner does not own this command")
    value = source_observation(
        gate_id, context, root=root, tools=["python3", "sh"], trees=[], files=[],
    )
    store = EvidenceStore.from_environment(repo_root=root, worktree=root)
    with InputOwnerTrace(gate_id, context).stage("original-producer-inputs"):
        producers = original_producer_inputs(context, store)
    value["ownerId"] = OWNER_ID
    for axis in ("provider", "oracle", "fixture"):
        value["inputs"][axis] = digest({
            "sourceInput": value["inputs"][axis], "originalProducers": producers,
        })
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gate", required=True, choices=list(COMMANDS))
    args = parser.parse_args()
    try:
        context = json.loads(os.environ["PT_ACCEPTANCE_INPUT_CONTEXT"])
        if context["gate"]["id"] != args.gate:
            raise ValueError("aggregate input CLI identity changed")
        with runner_operation_stream():
            value = prerequisite_observation(context, root=Path.cwd())
        print(json.dumps(value, sort_keys=True))
        return 0
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, RuntimeError, ImportError):
        print("PREREQUISITE_INPUT_IDENTITY_UNPROVEN", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
