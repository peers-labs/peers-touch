"""Suite owner for current-source Agent Chat operation evidence."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from tooling.acceptance.core import ArtifactSession
from tooling.acceptance.core.suite_runtime import (
    RuntimeReuseContract,
    SuiteRuntimeLedger,
)
from tooling.acceptance.gates.agent.chat_operation_contract import (
    coverage_report,
    gate_for_area,
    operation_contract,
)
from tooling.acceptance.gates.agent.chat_layout_scenarios import wide, compact, narrow, reduced_motion
from tooling.acceptance.gates.agent.chat_roster_scenarios import prepare_roster, roster
from tooling.acceptance.gates.agent.chat_identity_scenarios import identity
from tooling.acceptance.gates.agent.chat_extension_scenarios import (
    extensions,
)
from tooling.acceptance.gates.agent.chat_extension_fixture import prepare_extensions
from tooling.acceptance.gates.agent.chat_model_scenarios import topic_isolation, settings_default, disable_recovery
from tooling.acceptance.gates.agent.chat_composer_scenarios import attachments, slash
from tooling.acceptance.gates.agent.chat_provider_scenarios import (
    configuration, create_direct, cli_discovery,
)
from tooling.acceptance.gates.agent.chat_conversation_scenarios import (
    configure_clarification_fixture, clarification, follow_up, send_stop, retry, tool_approval,
)
from tooling.acceptance.gates.agent.chat_topic_scenarios import (
    prepare_topics, navigation, rename_and_drafts, agent_drafts,
    first_send_and_delete, pin, batch_delete, delete_agent,
)
from tooling.acceptance.gates.agent.chat_profile_scenarios import (
    create_profile,
    edit_documents,
    consume_documents,
    consume_bound_skill,
    prepare_prompt_fixture,
    restart_documents,
)
from tooling.acceptance.gates.agent.chat_depth_scenarios import (
    command_degraded,
    command_narrow,
    command_projection,
    historical_turn_attribution,
)
from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney,
    REPO_ROOT,
    model_capability_config,
    now_iso,
)


PLAN_ROOT = (
    REPO_ROOT / "docs/architecture/domains/agent/execution-plans"
    / "20261018-agent-chat-acceptance"
)
TASK_BY_AREA = {
    "profile": "ACA-01", "models": "ACA-02", "topics": "ACA-03",
    "conversation": "ACA-04", "layout": "ACA-05", "workspace": "ACA-05",
}
DEPTH_PLAN_ROOT = (
    REPO_ROOT / "docs/architecture/domains/agent/execution-plans"
    / "20261020-agent-depth-linux-desktop-v2"
)
TRACE_TASK_BY_AREA = {
    **TASK_BY_AREA,
    "commands": "ADL-03",
    "attribution": "ADL-04",
}


def suite_contract(area: str) -> RuntimeReuseContract:
    if area in ("commands", "attribution"):
        task_id = "ADL-03" if area == "commands" else "ADL-04"
        text = (DEPTH_PLAN_ROOT / "tasks" / f"{task_id}.md").read_text()
        blocks = re.findall(r"```json\n([\s\S]*?)\n```", text)
        if len(blocks) != 1:
            raise ValueError("Task Slice must contain exactly one JSON contract")
        return RuntimeReuseContract.from_dict(
            json.loads(blocks[0])["runtimeReuse"]
        )
    if area == "workspace":
        text = (PLAN_ROOT / "workspace-runtime.json").read_text()
        return RuntimeReuseContract.from_dict(json.loads(text))
    text = (PLAN_ROOT / "tasks" / f"{TASK_BY_AREA[area]}.md").read_text()
    blocks = re.findall(r"```json\n([\s\S]*?)\n```", text)
    if len(blocks) != 1:
        raise ValueError("Task Slice must contain exactly one JSON contract")
    return RuntimeReuseContract.from_dict(json.loads(blocks[0])["runtimeReuse"])


def suite_traceability(area: str, gate_id: str) -> dict[str, Any]:
    task_id = TRACE_TASK_BY_AREA[area]
    task_root = (
        DEPTH_PLAN_ROOT
        if area in ("commands", "attribution")
        else PLAN_ROOT
    )
    task_path = task_root / "tasks" / f"{task_id}.md"
    operation_ids = sorted(
        row["operationId"]
        for row in operation_contract()
        if (
            gate_id == "agent-chat-workspace-native"
            and row["gateId"] not in {
                "agent-slash-command-native-e2e",
                "agent-context-projection-native-e2e",
            }
        )
        or row["gateId"] == gate_id
    )
    return {
        "phase": task_id,
        "bom": operation_ids,
        "spec": [
            str(task_path.relative_to(REPO_ROOT)),
            "docs/architecture/domains/agent/modern-chat-agent/"
            "product-definition.md",
            "docs/architecture/domains/agent/modern-chat-agent/"
            "experience-contract.md",
        ],
        "gate": gate_id,
    }


def scenario(
    runner: AgentNativeJourney,
    ledger: SuiteRuntimeLedger,
    scenario_id: str,
    operation: Any,
) -> dict[str, Any]:
    ledger.record("scenario-start", scenario_id=scenario_id)
    started = time.monotonic()
    try:
        result = runner.step(scenario_id, operation)
        result["scenarioId"] = scenario_id
        ledger.record(
            "ui-action", scenario_id=scenario_id,
            resource_id=result["uiAction"],
            duration_seconds=time.monotonic() - started,
        )
        ledger.record(
            "receiver-assertion", scenario_id=scenario_id,
            resource_id=result["receiverAssertion"],
        )
        return result
    finally:
        ledger.record("scenario-end", scenario_id=scenario_id)


def restart_client(runner: AgentNativeJourney, ledger: SuiteRuntimeLedger) -> None:
    ledger.record(
        "client-replacement",
        resource_id=f'{runner.client["id"]}-restart-{len(runner.steps)}',
    )
    runner.restart_native_runtime()


def run_profile(
    runner: AgentNativeJourney,
    ledger: SuiteRuntimeLedger,
    fixture: dict[str, str],
) -> dict[str, dict[str, Any]]:
    def creation() -> dict[str, Any]:
        result = runner.step("profile-create-mutation", lambda: create_profile(runner))
        result["roster"] = runner.step(
            "profile-create-roster", lambda: roster(runner, result["agentId"]),
        )
        return result

    created = scenario(runner, ledger, "profile-create", creation)
    extension_fixture = runner.step(
        "suite-extension-fixture",
        lambda: prepare_extensions(runner, created["agentId"]),
    )
    runner.step(
        "suite-reload-model-catalog",
        lambda: runner.harness("reconcileChatSuiteCapabilityProjection"),
    )

    def profile_documents() -> dict[str, Any]:
        result = edit_documents(runner, created["agentId"])
        result["identity"] = identity(runner, created["agentId"])
        result["extensions"] = extensions(
            runner,
            created["agentId"],
            retain_skill=True,
            skill_capability_id=extension_fixture["skillCapabilityId"],
        )
        return result

    documents = scenario(
        runner, ledger,
        "profile-documents",
        profile_documents,
    )
    consumed = scenario(
        runner, ledger, "profile-prompt-consumption",
        lambda: consume_documents(runner, created["agentId"], fixture),
    )
    retained_skill = documents["extensions"].get("retainedSkill")
    if not isinstance(retained_skill, dict):
        raise ValueError("Profile Suite retained no Skill for prompt consumption")
    skill_consumed = scenario(
        runner,
        ledger,
        "profile-skill-consumption",
        lambda: consume_bound_skill(
            runner,
            created["agentId"],
            retained_skill,
            fixture,
        ),
    )
    runner.click_agent_action(created["agentId"], "edit")
    ledger.record(
        "client-replacement", resource_id=f"{runner.client['id']}-restart",
    )
    restored = scenario(
        runner, ledger, "profile-restart",
        lambda: restart_documents(runner, created["agentId"]),
    )
    observations = {
        "agent.create.instant-profile": created,
        "profile.model-ownership-absent": created,
        "profile.identity.autosave-surface": created,
        "profile.soul.save": documents,
        "profile.agents.save": documents,
        "profile.documents.authority-readback": documents,
        "profile.documents.explicit-empty": documents,
        "profile.documents.restart": restored,
        "profile.documents.provider-consumption": consumed,
    }
    for result, scenario_id in (
        (created["roster"], "profile-create"),
        (documents["identity"], "profile-documents"),
        (documents["extensions"], "profile-documents"),
        (skill_consumed, "profile-skill-consumption"),
    ):
        result["scenarioId"] = scenario_id
        for operation_id in result["operationIds"]:
            observations[operation_id] = result
    return {operation_id: dict(value) for operation_id, value in observations.items()}


def stamp_observations(
    observations: dict[str, dict[str, Any]],
    *,
    gate_id: str,
    source_commit: str,
    runtime_id: str,
    artifact_refs: list[dict[str, Any]],
    lifecycle: dict[str, Any],
    cleanup: dict[str, Any],
    failure: str,
) -> dict[str, dict[str, Any]]:
    """A failed generation cannot publish proven operation children."""
    depth_gates = {
        "agent-slash-command-native-e2e",
        "agent-context-projection-native-e2e",
    }
    expected = {
        row["operationId"] for row in operation_contract()
        if (
            gate_id == "agent-chat-workspace-native"
            and row["gateId"] not in depth_gates
        )
        or row["gateId"] == gate_id
    }
    suite_passed = (
        not failure
        and expected.issubset(observations)
        and lifecycle.get("result") == "PASS"
        and cleanup.get("status") == "passed"
    )
    return {
        operation_id: {
            **value,
            "operationId": operation_id,
            "status": "passed" if suite_passed else "failed",
            "gateId": next(
                row["gateId"] for row in operation_contract()
                if row["operationId"] == operation_id
            ) if gate_id == "agent-chat-workspace-native" else gate_id,
            "sourceCommit": source_commit,
            "runtimeId": runtime_id,
            "artifactRefs": artifact_refs,
            "suiteProofStatus": "PROVEN" if suite_passed else "UNPROVEN",
            "cleanupStatus": cleanup.get("status"),
        }
        for operation_id, value in observations.items()
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--area",
        choices=(
            "profile", "models", "topics", "conversation", "layout",
            "workspace", "commands", "attribution",
        ),
        required=True,
    )
    args = parser.parse_args()
    gate_id = gate_for_area(args.area)
    runner = None
    observations: dict[str, dict[str, Any]] = {}
    failure = ""
    ledger = None
    cleanup: dict[str, Any] = {"status": "not-started"}
    with ArtifactSession(repo_root=REPO_ROOT, gate_id=gate_id) as artifacts:
        try:
            runner = AgentNativeJourney(f"chat-{args.area}")
            ledger = SuiteRuntimeLedger(
                contract=suite_contract(args.area),
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
            fixture = runner.step("suite-prompt-fixture", lambda: prepare_prompt_fixture(runner))
            runner.harness("reconcileChatSuiteModelProjection")
            if args.area in ("commands", "attribution"):
                created = runner.step(
                    "suite-owned-agent",
                    lambda: create_profile(runner),
                )
                extension_fixture = runner.step(
                    "suite-extension-fixture",
                    lambda: prepare_extensions(runner, created["agentId"]),
                )
                runner.step(
                    "suite-reload-capability-projection",
                    lambda: runner.harness(
                        "reconcileChatSuiteCapabilityProjection",
                    ),
                )
                bound = scenario(
                    runner,
                    ledger,
                    "depth-skill-binding",
                    lambda: extensions(
                        runner,
                        created["agentId"],
                        retain_skill=True,
                        skill_capability_id=extension_fixture[
                            "skillCapabilityId"
                        ],
                    ),
                )
                retained_skill = bound.get("retainedSkill")
                if not isinstance(retained_skill, dict):
                    raise ValueError("depth Suite retained no Skill")
                if args.area == "commands":
                    command_results = [
                        scenario(
                            runner,
                            ledger,
                            "commands-authority",
                            lambda: command_projection(
                                runner,
                                created["agentId"],
                                retained_skill,
                            ),
                        ),
                        scenario(
                            runner,
                            ledger,
                            "commands-degraded",
                            lambda: command_degraded(
                                runner,
                                created["agentId"],
                                retained_skill,
                            ),
                        ),
                        scenario(
                            runner,
                            ledger,
                            "commands-narrow",
                            lambda: command_narrow(runner),
                        ),
                    ]
                    for result in command_results:
                        for operation_id in result["operationIds"]:
                            observations[operation_id] = dict(result)
                    runner.step(
                        "suite-command-binding-cleanup",
                        lambda: runner.harness(
                            "cleanupChatSuiteCapabilityBindings",
                            {"agentId": created["agentId"]},
                        ),
                    )
                else:
                    runner.click_visible(
                        "[data-pt-agent-profile-back]",
                        "return before Skill activation",
                    )
                    runner.select_agent_chat(created["agentId"])
                    consumed = scenario(
                        runner,
                        ledger,
                        "depth-skill-consumption",
                        lambda: consume_bound_skill(
                            runner,
                            created["agentId"],
                            retained_skill,
                            fixture,
                        ),
                    )
                    result = scenario(
                        runner,
                        ledger,
                        "historical-attribution",
                        lambda: historical_turn_attribution(
                            runner,
                            created["agentId"],
                            consumed,
                            restart=lambda: restart_client(runner, ledger),
                        ),
                    )
                    for operation_id in result["operationIds"]:
                        observations[operation_id] = dict(result)
            if args.area in ("profile", "workspace"):
                runner.step("suite-roster-fixture", lambda: prepare_roster(runner))
                observations.update(run_profile(runner, ledger, fixture))
            if args.area in ("layout", "workspace"):
                runner.harness("navigateToAgent", timeout=120)
                def mobile_layout() -> dict[str, Any]:
                    result = narrow(runner)
                    runner.harness("navigateToAgent", timeout=120)
                    result["motion"] = reduced_motion(runner, fixture)
                    result["operationIds"].append("motion.reduced")
                    return result

                for scenario_id, operation_ids, operation in (
                    ("workspace-wide", ["layout.wide-roster-topic-chat"], wide),
                    ("workspace-compact", ["layout.compact-rails"], compact),
                    ("workspace-narrow", [
                        "layout.mobile-chat", "layout.mobile-topic-list",
                        "layout.mobile-left-drawer", "layout.mobile-no-bottom-sheet",
                        "layout.zero-horizontal-overflow",
                    ], mobile_layout),
                ):
                    result = scenario(
                        runner, ledger, scenario_id,
                        lambda operation=operation: operation(runner),
                    )
                    for operation_id in result.get("operationIds", operation_ids):
                        observations[operation_id] = dict(result)
                if args.area == "workspace":
                    runner.driver.set_window_size(1440, 900)
                    runner.harness("navigateToAgent", timeout=120)
            if args.area in ("topics", "workspace"):
                created = runner.step(
                    "suite-owned-agent", lambda: create_profile(runner),
                )
                agent_id = created["agentId"]
                runner.click_visible("[data-pt-agent-profile-back]", "Profile Back")
                ids = runner.step(
                    "suite-owned-topics", lambda: prepare_topics(runner, agent_id),
                )
                runner.step(
                    "suite-reload-topics",
                    lambda: runner.harness("reconcileChatSuiteTopicProjection"),
                )
                runner.select_agent_chat(agent_id)
                navigation_result: dict[str, Any] = {}

                def topic_navigation() -> dict[str, Any]:
                    navigation_result.update(navigation(runner, agent_id, ids))
                    result = rename_and_drafts(runner, agent_id, ids)
                    result["navigation"] = navigation_result
                    result["agentDrafts"] = agent_drafts(runner, agent_id, ids[0])
                    result["firstSend"] = first_send_and_delete(runner, agent_id, fixture)
                    return result

                for scenario_id, operation_ids, operation in (
                    ("topics-rename-cancel", [
                        "topic.switch", "draft.topic-restore", "topic.edit",
                    ], topic_navigation),
                    ("topics-pin", ["topic.pin"], lambda: pin(runner, ids[0])),
                    ("topics-batch-delete", [
                        "topic.batch-select", "topic.batch-delete-confirm",
                        "topic.batch-delete-cleanup", "topic.delete.atomic-authority",
                    ], lambda: batch_delete(runner, agent_id, ids)),
                    ("agent-delete-cascade", ["agent.delete.confirm", "agent.delete.workspace-cleanup"],
                     lambda: delete_agent(runner, agent_id)),
                ):
                    result = scenario(runner, ledger, scenario_id, operation)
                    for operation_id in operation_ids:
                        observations[operation_id] = dict(result)
                    if scenario_id == "topics-rename-cancel":
                        for child in (
                            navigation_result, result["agentDrafts"], result["firstSend"],
                        ):
                            child["scenarioId"] = scenario_id
                            for operation_id in child["operationIds"]:
                                observations[operation_id] = dict(child)
            if args.area in ("models", "workspace"):
                created = runner.step("suite-owned-agent", lambda: create_profile(runner))
                agent_id = created["agentId"]
                runner.click_visible("[data-pt-agent-profile-back]", "Profile Back")
                ids = runner.step(
                    "suite-owned-topics", lambda: prepare_topics(runner, agent_id),
                )
                runner.harness("reconcileChatSuiteTopicProjection")
                runner.select_agent_chat(agent_id)
                def model_settings() -> dict[str, Any]:
                    config = configuration(runner)
                    direct = create_direct(runner, fixture)
                    result = settings_default(runner, agent_id, fixture)
                    result["configuration"] = config
                    result["direct"] = direct
                    return result

                default = scenario(
                    runner, ledger, "models-default",
                    model_settings,
                )
                for operation_id in default["operationIds"]:
                    observations[operation_id] = dict(default)
                for child in (default["configuration"], default["direct"]):
                    child["scenarioId"] = "models-default"
                    for operation_id in child["operationIds"]:
                        observations[operation_id] = dict(child)
                cli_result = scenario(
                    runner, ledger, "models-cli-discovery",
                    lambda: cli_discovery(
                        runner, default["configuration"]["cliProviderId"],
                    ),
                )
                for operation_id in cli_result["operationIds"]:
                    observations[operation_id] = dict(cli_result)
                runner.click_primary_navigation("agent", "return to Chat")
                runner.select_agent_chat(agent_id)
                def composer_models() -> dict[str, Any]:
                    result = topic_isolation(runner, agent_id, ids, fixture)
                    result["slash"] = slash(runner)
                    result["resources"] = attachments(runner, agent_id, fixture)
                    return result

                result = scenario(
                    runner, ledger, "models-topic-isolation",
                    composer_models,
                )
                for operation_id in result["operationIds"]:
                    observations[operation_id] = dict(result)
                resources = result["resources"]
                resources["scenarioId"] = "models-topic-isolation"
                resources["operationIds"].append("composer.enter-send")
                for operation_id in resources["operationIds"]:
                    observations[operation_id] = dict(resources)
                result["slash"]["scenarioId"] = "models-topic-isolation"
                observations["composer.slash"] = dict(result["slash"])
                result = scenario(
                    runner, ledger, "models-disable-recovery",
                    lambda: disable_recovery(runner, agent_id, fixture),
                )
                for operation_id in result["operationIds"]:
                    observations[operation_id] = dict(result)
            if args.area in ("conversation", "workspace"):
                created = runner.step("suite-owned-agent", lambda: create_profile(runner))
                runner.click_visible("[data-pt-agent-profile-back]", "Profile Back")
                result = scenario(
                    runner, ledger, "conversation-follow-up",
                    lambda: follow_up(runner, created["agentId"], fixture),
                )
                for operation_id in result["operationIds"]:
                    observations[operation_id] = dict(result)
                result = scenario(
                    runner, ledger, "conversation-send-stop",
                    lambda: send_stop(runner, created["agentId"], fixture),
                )
                for operation_id in result["operationIds"]:
                    observations[operation_id] = dict(result)
                result = scenario(
                    runner, ledger, "conversation-retry",
                    lambda: retry(runner, created["agentId"], fixture),
                )
                for operation_id in result["operationIds"]:
                    observations[operation_id] = dict(result)
                runner.step(
                    "suite-tool-approval-fixture",
                    lambda: runner.invoke_readback_command("model_update", {
                        "provider_id": fixture["providerId"], "model_id": fixture["modelId"],
                        "data": {
                            "capabilities": model_capability_config({
                                "streaming": True,
                                "native-tools": True,
                            }),
                            "context_window": 8192,
                        },
                    }),
                )
                result = scenario(
                    runner, ledger, "conversation-tool-approval",
                    lambda: tool_approval(runner, created["agentId"], fixture),
                )
                for operation_id in result["operationIds"]:
                    observations[operation_id] = dict(result)
                runner.step(
                    "suite-clarification-fixture",
                    lambda: configure_clarification_fixture(runner),
                )
                result = scenario(
                    runner, ledger, "conversation-clarification",
                    lambda: clarification(
                        runner, created["agentId"], fixture,
                        restart=lambda: restart_client(runner, ledger),
                    ),
                )
                for operation_id in result["operationIds"]:
                    observations[operation_id] = dict(result)
        except Exception as error:
            failure = str(error) or type(error).__name__
        finally:
            if runner is not None:
                try:
                    cleanup = runner.cleanup()
                except Exception as cleanup_error:
                    cleanup_failure = (
                        str(cleanup_error) or type(cleanup_error).__name__
                    )
                    cleanup = {
                        "status": "failed",
                        "failures": [
                            f"Agent Native runner cleanup: {cleanup_failure}"
                        ],
                    }
                    if not failure:
                        failure = f"cleanup failed: {cleanup_failure}"
            if ledger is not None and cleanup.get("status") == "passed":
                ledger.record("cleanup-complete")
        lifecycle = ledger.report() if ledger else {"result": "FAIL"}
        artifacts.write_json(
            "evidence/suite-runtime.json", lifecycle, role="suite-runtime",
        )
        raw = artifacts.write_json(
            "evidence/receiver-dom.json",
            {
                "artifactKind": "agent-chat-native-observations",
                "gateId": gate_id,
                "steps": runner.steps if runner else [],
                "observations": observations,
            },
            role="receiver-dom",
        )
        readback = artifacts.write_json(
            "evidence/station-readback.json",
            {
                "artifactKind": "agent-chat-authority-readback",
                "observations": observations,
                "readback": runner.station_readback if runner else {},
            },
            role="station-readback",
        )
        artifacts.write_json("evidence/cleanup.json", cleanup, role="cleanup")
        if runner is not None:
            observations = stamp_observations(
                observations,
                gate_id=gate_id,
                source_commit=runner.runtime_manifest["source"]["commit"],
                runtime_id=runner.runtime_manifest["runId"],
                artifact_refs=[raw.to_dict(), readback.to_dict()],
                lifecycle=lifecycle,
                cleanup=cleanup,
                failure=failure,
            )
        coverage = coverage_report(observations)
        missing = [
            row["operationId"] for row in coverage["operations"]
            if (
                args.area == "workspace"
                and row["gateId"] not in {
                    "agent-slash-command-native-e2e",
                    "agent-context-projection-native-e2e",
                }
            )
            or row["gateId"] == gate_id
            and row["proofStatus"] != "PROVEN"
        ]
        status = (
            "passed"
            if not failure and not missing and cleanup.get("status") == "passed"
            and lifecycle["result"] == "PASS"
            else "failed"
        )
        artifacts.write_json(
            "evidence/operation-coverage.json", coverage, role="operation-coverage",
        )
        traceability = suite_traceability(args.area, gate_id)
        artifacts.write_json(
            "evidence/validation.json",
            {
                "artifactKind": "acceptance-gate-evidence-report",
                "gateId": gate_id,
                "environment": "home-station",
                "runtimeCell": "desktop-linux-native",
                "status": status,
                "completionStatus": (
                    "DONE" if status == "passed" else "PARTIAL"
                ),
                "proofStatus": "PROVEN" if status == "passed" else "UNPROVEN",
                "sampleEmissionAllowed": status == "passed",
                "completedAt": now_iso(),
                "failure": failure,
                "missingOperations": missing,
                "cleanup": cleanup,
                **traceability,
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
