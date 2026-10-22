# Profile and model ownership

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-chat-acceptance-20261018",
  "taskId": "ACA-01",
  "workstreamId": "ACA",
  "title": "Profile documents, shared creation and Topic model ownership",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "ACA-profile",
  "journeyId": "agent-chat-profile",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/desktop", "apps/station/app/subserver/agent", "model/domain/agent", "packages/locales", "docs/architecture/domains/agent", "docs/client", "tooling/acceptance"],
  "readSet": ["packages/prototypes/desktop"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 1200, "cleanupSeconds": 180},
  "checks": [
    {"id": "profile-source", "command": "pnpm --dir apps/desktop run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "profile-native", "command": "make desktop", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "profile-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate agent-chat-profile-native", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {
    "scope": "suite", "entryCheckId": "profile-native",
    "scenarioIds": ["profile-create", "profile-documents", "profile-restart", "profile-prompt-consumption"],
    "maxProvisioningRuns": 1, "maxClientLaunches": 2, "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true, "requireReceiverVisibleProof": true, "allowClientReplacement": true
  },
  "doneWhen": ["All creation entries enter Profile immediately.", "Agent no longer owns ordinary Chat model selection.", "SOUL.md and AGENTS.md survive authority readback and restart and enter the actual Provider prompt."],
  "failureBehavior": ["Retain failed document drafts and report authority conflicts.", "Missing runtime evidence remains UNPROVEN."],
  "updatedAt": "2026-10-18T00:00:00.000Z"
}
```

## Current Snapshot

Implementation in progress. Shared identity-only creation enters Profile immediately;
ordinary composer model selection uses Topic ownership and Settings defaults.
Canonical SOUL/AGENTS values, including explicit empty strings, precede historical
aliases during Station prompt assembly. Profile writes reject concurrent mutations
and roll back only the affected Agent. Profile draft fields live in the Agent store,
survive editor unmount and failed saves, and clear only when the matching submitted
value succeeds. Session runtime teardown clears those drafts. SOUL/AGENTS editors
stack when their containing width cannot fit both document columns.

Focused Desktop Profile and layout/workbench tests: 25 passed, including failed
document retention and an edit racing an accepted save. Desktop TypeScript,
changed-file ESLint and diff whitespace checks passed. Focused
Station document/default, Topic actor-isolation and composite Conversation tests
passed (`TestResolveAgentDefaults|TestConversationModelOverride`, count=1).

The Native Profile scenario now exercises roster search and anchored actions,
identity autosave feedback and alignment, emoji and image avatar persistence,
invalid-upload rejection and cancellation, bounded Skills/MCP binding pickers,
skill enable/disable/removal, both document saves, both explicit-empty values,
editor reopen, Native restart, and actual Provider system-document consumption.
All 28 Profile operation IDs have executable scenario coverage; runtime proof has
not run and remains UNPROVEN.

The shared AgentIconTile now projects persisted image avatars into Profile and
roster. Composer identity no longer falls back to Agent model configuration.
The existing Provider Harness selects the Topic model instead of writing Agent
Profile, and Suite setup reconciles through the registered projection owners.
Remote upload fixtures use the Native binding's actor file staging.

Desktop TypeScript passed. Focused model ownership/store tests: 24 passed;
operation/fixture/Provider-owner checks: 21 passed. Agent structural validation and
all five Task pipeline contracts passed; runtime report state remains NOT_RUN.
Canonical host Native compilation requires missing `glib-2.0 >= 2.70`; the
reviewed remote Linux Native Cell has its image available. Current source is
uncommitted and Station changes are undeployed. No Native proof or delivery
readiness claim is supported.
