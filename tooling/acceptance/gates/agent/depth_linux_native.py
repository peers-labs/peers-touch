#!/usr/bin/env python3
"""Installed Linux Desktop Agent depth Suite."""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from tooling.acceptance.core import ArtifactSession
from tooling.acceptance.core.suite_runtime import (
    RuntimeReuseContract,
    SuiteRuntimeLedger,
)
from tooling.acceptance.gates.agent.chat_depth_scenarios import (
    command_projection,
    historical_turn_attribution,
)
from tooling.acceptance.gates.agent.chat_extension_fixture import (
    prepare_extensions,
)
from tooling.acceptance.gates.agent.chat_extension_scenarios import extensions
from tooling.acceptance.gates.agent.chat_profile_scenarios import (
    consume_bound_skill,
    create_profile,
    edit_documents,
    prepare_prompt_fixture,
    roundtrip_definition_package,
)
from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney,
    REPO_ROOT,
    now_iso,
    require,
)
from tooling.acceptance.provisioners.native_desktop_linux import (
    NativeDesktopLinuxProvisioner,
)


GATE_ID = "agent-depth-linux-native-e2e"
TASK_PATH = (
    REPO_ROOT
    / "docs/architecture/domains/agent/execution-plans"
    / "20261020-agent-depth-linux-desktop-v2/tasks/ADL-05.md"
)


def suite_contract() -> RuntimeReuseContract:
    blocks = re.findall(r"```json\n([\s\S]*?)\n```", TASK_PATH.read_text())
    if len(blocks) != 1:
        raise ValueError("ADL-05 must contain exactly one JSON Task contract")
    return RuntimeReuseContract.from_dict(
        json.loads(blocks[0])["runtimeReuse"]
    )


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


def installed_desktop() -> dict[str, Any]:
    cell_id = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL", "").strip()
    require(
        cell_id == "desktop-linux-native",
        "installed Agent depth requires desktop-linux-native",
    )
    manifest_path = Path(
        os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL_MANIFEST", "")
    )
    require(manifest_path.is_file(), "runtime-cell manifest is unavailable")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    require(
        manifest.get("gateId") == GATE_ID
        and manifest.get("cellId") == cell_id
        and manifest.get("source", {}).get("artifactKind")
        == "installed-appimage",
        "runtime cell did not provision the installed AppImage",
    )
    source_commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        text=True,
    ).strip()
    require(
        manifest.get("source", {}).get("commit") == source_commit,
        "runtime-cell manifest does not match frozen source",
    )
    provisioner = NativeDesktopLinuxProvisioner()
    provisioner.validate_binding(GATE_ID, source_commit)
    inspected = provisioner.installed_desktop_artifact()
    log_bytes = base64.b64decode(
        str(inspected.pop("installLogBase64")),
        validate=True,
    )
    receipt = inspected["receipt"]
    require(
        receipt.get("sourceCommit") == source_commit,
        "installed AppImage source receipt does not match frozen source",
    )
    return {
        "uiAction": "build and install the exact-source Linux AppImage",
        "receiverAssertion": "installed artifact and receipt identify frozen source",
        "artifact": inspected["artifactPath"],
        "artifactSha256": inspected["artifactSha256"],
        "receipt": receipt,
        "sourceCommit": source_commit,
        "logBytes": log_bytes,
    }


def main() -> int:
    runner: AgentNativeJourney | None = None
    ledger: SuiteRuntimeLedger | None = None
    install: dict[str, Any] = {}
    install_log_bytes = b""
    observations: dict[str, Any] = {}
    owned_agents: list[str] = []
    failure = ""
    cleanup: dict[str, Any] = {"status": "not-started"}

    with ArtifactSession(repo_root=REPO_ROOT, gate_id=GATE_ID) as artifacts:
        try:
            install = installed_desktop()
            install_log_bytes = install.pop("logBytes")
            runner = AgentNativeJourney("depth-linux")
            ledger = SuiteRuntimeLedger(
                contract=suite_contract(),
                suite_runtime_id=runner.runtime_manifest["runId"],
                source_digest=install["sourceCommit"],
                fixture_epoch=runner.runtime_manifest["runId"],
            )
            ledger.record("provision", resource_id=install["artifact"])
            runner.step("suite-start-installed-native", runner.start)
            ledger.record("client-launch", resource_id=runner.client["id"])
            runner.step("suite-login", runner.login)
            ledger.record("login", resource_id=runner.client["id"])
            runner.harness("setFoundationLocale", {"locale": "en"})
            runner.navigate_and_configure()

            def launch() -> dict[str, Any]:
                return {
                    "uiAction": "open the installed Agent workspace",
                    "receiverAssertion": (
                        "installed Native Agent workspace is visible on Profile two"
                    ),
                    "state": runner.harness("getRuntimeSnapshot"),
                }

            observations["installLaunch"] = scenario(
                runner,
                ledger,
                "install-launch",
                launch,
            )
            fixture = runner.step(
                "suite-prompt-fixture",
                lambda: prepare_prompt_fixture(runner),
            )
            runner.harness("reconcileChatSuiteModelProjection")

            created: dict[str, Any] = {}

            def definition() -> dict[str, Any]:
                created.update(create_profile(runner))
                owned_agents.append(created["agentId"])
                documents = edit_documents(runner, created["agentId"])
                package = roundtrip_definition_package(
                    runner,
                    created["agentId"],
                )
                imported_id = str(
                    package.get("packageRoundtrip", {})
                    .get("imported", {})
                    .get("agentId")
                    or ""
                )
                if imported_id:
                    owned_agents.append(imported_id)
                return {
                    "uiAction": package["uiAction"],
                    "receiverAssertion": package["receiverAssertion"],
                    "documents": documents,
                    "package": package,
                }

            observations["definition"] = scenario(
                runner,
                ledger,
                "agent-definition",
                definition,
            )
            extension_fixture = runner.step(
                "suite-extension-fixture",
                lambda: prepare_extensions(runner, created["agentId"]),
            )
            runner.harness("reconcileChatSuiteCapabilityProjection")
            retained_skill: dict[str, Any] = {}

            def commands() -> dict[str, Any]:
                bound = extensions(
                    runner,
                    created["agentId"],
                    retain_skill=True,
                    skill_capability_id=extension_fixture["skillCapabilityId"],
                )
                candidate = bound.get("retainedSkill")
                require(isinstance(candidate, dict), "depth Suite retained no Skill")
                retained_skill.update(candidate)
                result = command_projection(
                    runner,
                    created["agentId"],
                    retained_skill,
                )
                result["binding"] = bound
                return result

            observations["commands"] = scenario(
                runner,
                ledger,
                "command-palette",
                commands,
            )
            observations["skill"] = scenario(
                runner,
                ledger,
                "skill-activation",
                lambda: consume_bound_skill(
                    runner,
                    created["agentId"],
                    retained_skill,
                    fixture,
                ),
            )

            def restart() -> None:
                ledger.record(
                    "client-replacement",
                    resource_id=f'{runner.client["id"]}-installed-restart',
                )
                runner.restart_native_runtime()

            observations["attribution"] = scenario(
                runner,
                ledger,
                "turn-attribution",
                lambda: historical_turn_attribution(
                    runner,
                    created["agentId"],
                    observations["skill"],
                    restart=restart,
                ),
            )
            observations["restart"] = scenario(
                runner,
                ledger,
                "restart-readback",
                lambda: {
                    "uiAction": "reopen the installed Agent after Native restart",
                    "receiverAssertion": (
                        "Agent, Topic, command history and Turn attribution remain visible"
                    ),
                    "state": runner.harness("getCoreLifecycleAgentState"),
                    "attribution": observations["attribution"],
                },
            )
        except Exception as error:
            failure = str(error) or type(error).__name__
        finally:
            product_cleanup: dict[str, Any] = {"status": "not-started"}
            if runner is not None and owned_agents:
                try:
                    product_cleanup = runner.harness(
                        "cleanupAgentDepthFixtures",
                        {"agentIds": owned_agents},
                    )
                    if product_cleanup.get("status") != "clean":
                        failure = failure or "Agent depth fixture cleanup failed"
                    else:
                        runner.lifecycle_fixture_ids = [
                            agent_id
                            for agent_id in runner.lifecycle_fixture_ids
                            if agent_id not in owned_agents
                        ]
                except Exception as error:
                    product_cleanup = {
                        "status": "failed",
                        "error": str(error),
                    }
                    failure = failure or str(error)
            if runner is not None:
                try:
                    cleanup = runner.cleanup()
                except Exception as error:
                    cleanup = {"status": "failed", "failures": [str(error)]}
                    failure = failure or str(error)
            cleanup["productFixtures"] = product_cleanup
            cleanup["installedArtifactOwner"] = "desktop-linux-native"
            if (
                ledger is not None
                and cleanup.get("status") == "passed"
                and product_cleanup.get("status") == "clean"
            ):
                ledger.record("cleanup-complete")

        lifecycle = ledger.report() if ledger is not None else {"result": "FAIL"}
        status = (
            "passed"
            if not failure
            and lifecycle.get("result") == "PASS"
            and cleanup.get("status") == "passed"
            and cleanup.get("productFixtures", {}).get("status") == "clean"
            else "failed"
        )
        artifacts.write_json(
            "evidence/suite-runtime.json",
            lifecycle,
            role="suite-runtime",
        )
        artifacts.write_json(
            "evidence/receiver-dom.json",
            {"observations": observations, "steps": runner.steps if runner else []},
            role="receiver-dom",
        )
        artifacts.write_json(
            "evidence/station-readback.json",
            {
                "observations": observations,
                "readback": runner.station_readback if runner else {},
            },
            role="station-readback",
        )
        artifacts.write_json(
            "evidence/source-receipt.json",
            install.get("receipt", {}),
            role="source-receipt",
        )
        artifacts.write_json("evidence/cleanup.json", cleanup, role="cleanup")
        if install_log_bytes:
            artifacts.write_bytes(
                "logs/desktop-install.log",
                install_log_bytes,
                media_type="text/plain",
                role="install-log",
            )
        artifacts.write_json(
            "evidence/validation.json",
            {
                "artifactKind": "acceptance-gate-evidence-report",
                "gateId": GATE_ID,
                "gate": GATE_ID,
                "environment": "home-station",
                "runtimeCell": "desktop-linux-native",
                "status": status,
                "completionStatus": (
                    "DONE" if status == "passed" else "PARTIAL"
                ),
                "proofStatus": "PROVEN" if status == "passed" else "UNPROVEN",
                "sampleEmissionAllowed": status == "passed",
                "phase": "ADL-05",
                "bom": list(suite_contract().scenario_ids),
                "spec": [
                    str(TASK_PATH.relative_to(REPO_ROOT)),
                    "docs/architecture/domains/agent/modern-chat-agent/"
                    "product-definition.md",
                    "docs/architecture/domains/agent/modern-chat-agent/"
                    "experience-contract.md",
                ],
                "completedAt": now_iso(),
                "failure": failure,
            },
            role="validation",
        )
        artifacts.complete(
            status=status,
            completion_status="COMPLETE" if status == "passed" else "PARTIAL",
            proof_status="PROVEN" if status == "passed" else "UNPROVEN",
            runtime=runner.runtime_manifest if runner else None,
        )
    return 0 if status == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
