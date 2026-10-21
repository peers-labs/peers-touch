#!/usr/bin/env python3
"""Native AgentDefinition mutation, package, restart, and conflict evidence."""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from tooling.acceptance.core import ArtifactSession
from tooling.acceptance.core.suite_runtime import (
    RuntimeReuseContract,
    SuiteRuntimeLedger,
)
from tooling.acceptance.gates.agent.chat_profile_scenarios import (
    conflict_preserves_document_draft,
    create_profile,
    edit_documents,
    restart_documents,
    roundtrip_definition_package,
)
from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney,
    REPO_ROOT,
    now_iso,
)


GATE_ID = "agent-definition-roundtrip-native-e2e"
TASK_PATH = (
    REPO_ROOT
    / "docs/architecture/domains/agent/execution-plans"
    / "20261020-agent-depth-linux-desktop-v2/tasks/ADL-02A.md"
)


def suite_contract() -> RuntimeReuseContract:
    blocks = re.findall(r"```json\n([\s\S]*?)\n```", TASK_PATH.read_text())
    if len(blocks) != 1:
        raise ValueError("ADL-02A must contain exactly one JSON Task contract")
    task = json.loads(blocks[0])
    return RuntimeReuseContract.from_dict(task["runtimeReuse"])


def scenario(
    runner: AgentNativeJourney,
    ledger: SuiteRuntimeLedger,
    scenario_id: str,
    operation: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    ledger.record("scenario-start", scenario_id=scenario_id)
    started = time.monotonic()
    try:
        result = runner.step(scenario_id, operation)
        result["scenarioId"] = scenario_id
        ledger.record(
            "ui-action",
            scenario_id=scenario_id,
            resource_id=result["uiAction"],
            duration_seconds=time.monotonic() - started,
        )
        ledger.record(
            "receiver-assertion",
            scenario_id=scenario_id,
            resource_id=result["receiverAssertion"],
        )
        return result
    finally:
        ledger.record("scenario-end", scenario_id=scenario_id)


def main() -> int:
    runner: AgentNativeJourney | None = None
    ledger: SuiteRuntimeLedger | None = None
    observations: dict[str, Any] = {}
    failure = ""
    cleanup: dict[str, Any] = {"status": "not-started"}

    with ArtifactSession(repo_root=REPO_ROOT, gate_id=GATE_ID) as artifacts:
        try:
            runner = AgentNativeJourney("agent-definition")
            ledger = SuiteRuntimeLedger(
                contract=suite_contract(),
                suite_runtime_id=runner.runtime_manifest["runId"],
                source_digest=runner.runtime_manifest["source"]["commit"],
                fixture_epoch=runner.runtime_manifest["runId"],
            )
            ledger.record("provision", resource_id=runner.runtime_manifest["runId"])
            runner.step("suite-start-native", runner.start)
            ledger.record("client-launch", resource_id=runner.client["id"])
            runner.step("suite-login", runner.login)
            ledger.record("login", resource_id=runner.client["id"])
            runner.step(
                "suite-locale",
                lambda: runner.harness("setFoundationLocale", {"locale": "en"}),
            )
            runner.step("suite-navigate", runner.navigate_and_configure)

            created = scenario(
                runner,
                ledger,
                "definition-create",
                lambda: create_profile(runner),
            )

            def edit_and_package() -> dict[str, Any]:
                documents = edit_documents(runner, created["agentId"])
                package = roundtrip_definition_package(runner, created["agentId"])
                return {
                    "uiAction": package["uiAction"],
                    "receiverAssertion": package["receiverAssertion"],
                    "documents": documents,
                    "package": package,
                }

            observations["editPackage"] = scenario(
                runner,
                ledger,
                "definition-edit-package",
                edit_and_package,
            )
            ledger.record(
                "client-replacement",
                resource_id=f'{runner.client["id"]}-definition-restart',
            )
            observations["restart"] = scenario(
                runner,
                ledger,
                "definition-restart",
                lambda: restart_documents(runner, created["agentId"]),
            )
            observations["conflict"] = scenario(
                runner,
                ledger,
                "definition-conflict",
                lambda: conflict_preserves_document_draft(
                    runner,
                    created["agentId"],
                ),
            )
            observations["created"] = created
        except Exception as error:
            failure = str(error) or type(error).__name__
        finally:
            if runner is not None:
                try:
                    cleanup = runner.cleanup()
                except Exception as cleanup_error:
                    cleanup = {
                        "status": "failed",
                        "failures": [str(cleanup_error) or type(cleanup_error).__name__],
                    }
                    if not failure:
                        failure = f"cleanup failed: {cleanup['failures'][0]}"
            if ledger is not None and cleanup.get("status") == "passed":
                ledger.record("cleanup-complete")

        lifecycle = ledger.report() if ledger is not None else {"result": "FAIL"}
        status = (
            "passed"
            if not failure
            and cleanup.get("status") == "passed"
            and lifecycle.get("result") == "PASS"
            else "failed"
        )
        receiver = artifacts.write_json(
            "evidence/receiver-dom.json",
            {
                "artifactKind": "agent-definition-native-observations",
                "gateId": GATE_ID,
                "observations": observations,
                "steps": runner.steps if runner is not None else [],
            },
            role="receiver-dom",
        )
        readback = artifacts.write_json(
            "evidence/station-readback.json",
            {
                "artifactKind": "agent-definition-authority-readback",
                "observations": observations,
                "readback": runner.station_readback if runner is not None else {},
            },
            role="station-readback",
        )
        artifacts.write_json(
            "evidence/suite-runtime.json",
            lifecycle,
            role="suite-runtime",
        )
        artifacts.write_json("evidence/cleanup.json", cleanup, role="cleanup")
        artifacts.write_json(
            "evidence/validation.json",
            {
                "artifactKind": "agent-definition-native-validation",
                "gateId": GATE_ID,
                "status": status,
                "proofStatus": "PROVEN" if status == "passed" else "UNPROVEN",
                "completedAt": now_iso(),
                "failure": failure,
                "artifactRefs": [receiver.to_dict(), readback.to_dict()],
                "cleanup": cleanup,
            },
            role="validation",
        )
        artifacts.complete(
            status=status,
            completion_status="COMPLETE" if status == "passed" else "PARTIAL",
            proof_status="PROVEN" if status == "passed" else "UNPROVEN",
            runtime=runner.runtime_manifest if runner is not None else None,
        )
    return 0 if status == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
