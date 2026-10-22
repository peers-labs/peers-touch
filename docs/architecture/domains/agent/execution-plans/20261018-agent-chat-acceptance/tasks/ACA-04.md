# Conversation and recovery

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "agent-chat-acceptance-20261018", "taskId": "ACA-04", "workstreamId": "ACA",
  "title": "Conversation controls, clarification continuation and recovery",
  "workClass": "product-behavior", "completionClass": "functional", "executionMode": "fix",
  "closureId": "ACA-conversation", "journeyId": "agent-chat-conversation", "runtimeClass": "native-desktop",
  "writeSet": ["apps/desktop", "apps/station/app/subserver/agent", "model/domain/agent", "packages/locales", "tooling/acceptance", "docs/architecture/domains/agent", "docs/client"],
  "readSet": ["packages/prototypes/desktop"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 1800, "cleanupSeconds": 180},
  "checks": [
    {"id": "conversation-source", "command": "pnpm --dir apps/desktop run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "conversation-native", "command": "make desktop", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "conversation-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate agent-chat-conversation-native", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {
    "scope": "suite", "entryCheckId": "conversation-native", "scenarioIds": ["conversation-send-stop", "conversation-retry", "conversation-follow-up", "conversation-clarification", "conversation-tool-approval"],
    "maxProvisioningRuns": 1, "maxClientLaunches": 2, "minWarmReuseRate": 0.8,
    "requireAttachOnlyScenarios": true, "requireReceiverVisibleProof": true, "allowClientReplacement": true
  },
  "doneWhen": ["Clarification records the answer and resumes the waiting turn.", "Follow-up uses the confirmed two-stage interaction.", "Ordinary Chat exposes only IN operations.", "Failure and tool approvals preserve usable focus and authority."],
  "failureBehavior": ["A rejected action cannot create a hidden second turn.", "Streaming interruptions preserve recoverable messages and Topic identity."],
  "updatedAt": "2026-10-18T00:00:00.000Z"
}
```

## Current Snapshot

Follow-up suggestions now expand into Add to input and Reply now actions.
Add to input appends to the existing composer draft; Reply now uses the existing
send command without consuming that draft. Composer intents bind the originating
Topic and cancel pending frames on Topic change.

Ordinary clarification uses the registered Station-owned ask_user tool and the
existing ToolBatch continuation. Submit commits the answer with the tool decision;
idempotency hashes bind the answer. The timeline projects the question, options,
Other input, explicit Submit and persisted result. The independent intervention
store and its new-turn submission path are deleted.

The clarification Native scenario now replaces the client while the question
waits, reopens the same Topic and submits through the restored inline control.
Its two-launch budget covers the initial launch and this required replacement;
the runtime is provisioned once.

Station answer persistence and replay/conflict tests pass; focused Desktop
tool projection checks pass. Native receiver, Provider consumption and restart
proof remain UNPROVEN. The capability must be bound through existing Agent
manifest/binding/readiness controls; registration does not bypass authorization.
