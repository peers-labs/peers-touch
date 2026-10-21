# Topic lifecycle

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "agent-chat-acceptance-20261018", "taskId": "ACA-03", "workstreamId": "ACA",
  "title": "Atomic Agent and Topic deletion and coherent projections",
  "workClass": "product-behavior", "completionClass": "functional", "executionMode": "fix",
  "closureId": "ACA-topics", "journeyId": "agent-chat-topics", "runtimeClass": "native-desktop",
  "writeSet": ["apps/desktop", "apps/station/app/subserver/agent", "model/domain/agent", "packages/locales", "tooling/acceptance", "docs/architecture/domains/agent", "docs/client"],
  "readSet": ["packages/prototypes/desktop"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 1200, "cleanupSeconds": 180},
  "checks": [
    {"id": "topics-source", "command": "pnpm --dir apps/desktop run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "topics-native", "command": "make desktop", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "topics-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate agent-chat-topics-native", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {
    "scope": "suite", "entryCheckId": "topics-native", "scenarioIds": ["topics-rename-cancel", "topics-pin", "topics-batch-delete", "agent-delete-cascade"],
    "maxProvisioningRuns": 1, "maxClientLaunches": 1, "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true, "requireReceiverVisibleProof": true, "allowClientReplacement": true
  },
  "doneWhen": ["Station mutations are all-or-nothing.", "Deleted resources leave no drafts, attachment references, messages or running projections.", "Rename cancellation and title search follow the confirmed contracts."],
  "failureBehavior": ["Failed deletion leaves every original resource intact.", "Cleanup only touches suite-owned data."],
  "updatedAt": "2026-10-18T00:00:00.000Z"
}
```

## Current Snapshot

Station single/batch Topic deletion now uses one versioned command and one
transaction for visible tombstones. All external reset fences are prepared
before directory cleanup; partial cleanup preserves every Topic and supports
retry through the existing reset owner. Agent deletion composes Topic deletion
with Profile removal, binding and workspace/file metadata cleanup, rejects foreign-actor conversations
and active Evaluation, and locks Agent against concurrent conversation creation.

Desktop submits one batch command before removing any Topic. Rejected deletion
preserves accepted Topics and unrelated concurrent updates. Successful deletion
purges session messages, buffers, queue and operation projections, draft
promotions and caches. The session runtime observes removed Agents and clears
their Topic/chat projection. Composer drops drafts whose sessions were removed.

Focused Station deletion/authority/admission regressions and Desktop Topic tests
pass. Changed Desktop files pass ESLint. Native proof remains UNPROVEN.
Reset recovery leaves deletion fences intact until an explicit whole-batch retry;
it never advances an individual Topic revision. Focused failure/retry tests cover
this fence. Shared OSS blobs remain under their storage owner.
Attachment lifecycle, deletion crash recovery and full receiver assertions still
require completion review and Native verification.

Topic title search excludes internal identifiers. Native scenarios now exercise
first-send title projection, inline count, single deletion confirmation, separate
Agent drafts and deletion with live Topic/draft state. These scenarios remain
UNPROVEN until executed.

Agent removal delegates projection cleanup to the Topic store. It clears pending
load ownership, load errors, title generation/history and Topic model mutation
tracking. An older load cannot repopulate the removed Agent. The concurrent
load/deletion regression and eight existing Topic tests pass.
