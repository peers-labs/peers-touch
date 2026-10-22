"""Trace the confirmed prototype operations without manufacturing Native proof."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[4]
PROTOTYPE_CHECKS = (
    ROOT / "packages/prototypes/desktop/shell/qa/agent_chat_checks.cjs"
)
GROUP_TARGETS = {
    "Agent roster keeps stable ownership and reference-client-style row actions":
        ("profile", "profile-create"),
    "Profile edits one Agent and binds capabilities from bounded pickers":
        ("profile", "profile-documents"),
    "Topic rail owns new, switch, pin, title search, edit and delete":
        ("topics", "topics-rename-cancel"),
    "Provider settings create Direct and CLI profiles without type tabs":
        ("models", "models-default"),
    "Composer owns Topic model, slash commands, attachment and keyboard semantics":
        ("models", "models-topic-isolation"),
    "Conversation preserves activity, copy, quick reply and basic artifacts":
        ("conversation", "conversation-follow-up"),
    "Running turns keep the draft without exposing a queue":
        ("conversation", "conversation-send-stop"),
    "Clarification and approval remain inline and continue the Agent":
        ("conversation", "conversation-clarification"),
    "Stop and typed recovery preserve honest failure semantics":
        ("conversation", "conversation-retry"),
    "Agent and Topic owners preserve isolated drafts":
        ("topics", "topics-rename-cancel"),
    "Wide, compact and mobile topology matches observed reference-client behavior":
        ("layout", "workspace-narrow"),
}
ADDITIONAL_OPERATIONS = {
    "profile.soul.save": ("profile", "profile-documents"),
    "profile.agents.save": ("profile", "profile-documents"),
    "profile.documents.authority-readback": ("profile", "profile-documents"),
    "profile.documents.restart": ("profile", "profile-restart"),
    "profile.documents.provider-consumption": ("profile", "profile-prompt-consumption"),
    "profile.documents.explicit-empty": ("profile", "profile-documents"),
    "topic.model.provider-id-isolation": ("models", "models-topic-isolation"),
    "topic.delete.atomic-authority": ("topics", "topics-batch-delete"),
    "agent.delete.workspace-cleanup": ("topics", "agent-delete-cascade"),
    "ask.answer.persisted": ("conversation", "conversation-clarification"),
    "ask.restart-continuation": ("conversation", "conversation-clarification"),
    "layout.drawer.close-focus": ("layout", "workspace-narrow"),
}

OPERATION_TARGETS = {
    "agent.create.instant-profile": ("profile", "profile-create"),
    "profile.model-ownership-absent": ("profile", "profile-create"),
    "profile.identity.autosave-surface": ("profile", "profile-create"),
    "agent.delete.confirm": ("topics", "agent-delete-cascade"),
    "topic.pin": ("topics", "topics-pin"),
    "topic.batch-select": ("topics", "topics-batch-delete"),
    "topic.batch-delete-confirm": ("topics", "topics-batch-delete"),
    "topic.batch-delete-cleanup": ("topics", "topics-batch-delete"),
    "settings.provider-cli.check": ("models", "models-cli-discovery"),
    "settings.provider-cli.restore": ("models", "models-cli-discovery"),
    "settings.provider-cli.save-toast": ("models", "models-cli-discovery"),
    "settings.feedback.bottom-right": ("models", "models-cli-discovery"),
    "settings.provider.enabled-projection": ("models", "models-disable-recovery"),
    "settings.model.enabled-projection": ("models", "models-disable-recovery"),
    "composer.settings-default-model": ("models", "models-default"),
    "approval.cancel": ("conversation", "conversation-tool-approval"),
    "approval.safe-focus": ("conversation", "conversation-tool-approval"),
    "approval.run": ("conversation", "conversation-tool-approval"),
    "approval.system-receipt": ("conversation", "conversation-tool-approval"),
    "approval.continue": ("conversation", "conversation-tool-approval"),
    "turn.stop": ("conversation", "conversation-send-stop"),
    "turn.stop.execution-cancelled": ("conversation", "conversation-send-stop"),
    "turn.stop.topic-error": ("conversation", "conversation-send-stop"),
    "layout.wide-roster-topic-chat": ("layout", "workspace-wide"),
    "layout.compact-rails": ("layout", "workspace-compact"),
}


def operation_contract() -> list[dict[str, str]]:
    source = PROTOTYPE_CHECKS.read_text(encoding="utf-8")
    block = source.split("const operationCoverageByCheck = {", 1)[1].split(
        "\n};", 1
    )[0]
    groups = re.findall(r"'([^']+)': \[(.*?)\]", block, re.S)
    if {name for name, _ in groups} != set(GROUP_TARGETS):
        raise ValueError("confirmed prototype Journey groups changed")
    rows = []
    for name, body in groups:
        area, scenario = GROUP_TARGETS[name]
        for operation in re.findall(r"'([^']+)'", body):
            target_area, target_scenario = OPERATION_TARGETS.get(
                operation, (area, scenario),
            )
            rows.append({
                "operationId": operation,
                "journey": name,
                "featureId": "agent-chat-production",
                "capabilityId": "agent-chat-production",
                "gateId": f"agent-chat-{target_area}-native",
                "scenarioId": target_scenario,
                "origin": "confirmed-prototype",
            })
    if len(rows) != 121 or len({row["operationId"] for row in rows}) != 121:
        raise ValueError("confirmed prototype must have 121 unique operations")
    for operation, (area, scenario) in ADDITIONAL_OPERATIONS.items():
        rows.append({
            "operationId": operation,
            "journey": "authority-and-restoration",
            "featureId": "agent-chat-production",
            "capabilityId": "agent-chat-production",
            "gateId": f"agent-chat-{area}-native",
            "scenarioId": scenario,
            "origin": "production-closure",
        })
    return rows


def coverage_report(
    observations: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """Require observed action and receiver assertion for every operation."""
    rows: list[dict[str, Any]] = []
    expected = {row["operationId"] for row in operation_contract()}
    unknown = set(observations) - expected
    if unknown:
        raise ValueError(f"unknown operation evidence: {sorted(unknown)}")
    for contract in operation_contract():
        observation = observations.get(contract["operationId"], {})
        proven = (
            observation.get("status") == "passed"
            and bool(observation.get("uiAction"))
            and bool(observation.get("receiverAssertion"))
            and bool(observation.get("sourceCommit"))
            and bool(observation.get("runtimeId"))
            and bool(observation.get("artifactRefs"))
            and observation.get("gateId") == contract["gateId"]
            and observation.get("operationId") == contract["operationId"]
            and observation.get("scenarioId") == contract["scenarioId"]
            and observation.get("suiteProofStatus") == "PROVEN"
            and observation.get("cleanupStatus") == "passed"
        )
        rows.append({
            **contract,
            "proofStatus": "PROVEN" if proven else "UNPROVEN",
            "observation": dict(observation),
        })
    missing = [row["operationId"] for row in rows if row["proofStatus"] != "PROVEN"]
    return {
        "artifactKind": "agent-chat-operation-coverage",
        "baselineOperationCount": 121,
        "operationCount": len(rows),
        "status": "passed" if not missing else "unproven",
        "missingOperations": missing,
        "operations": rows,
    }
