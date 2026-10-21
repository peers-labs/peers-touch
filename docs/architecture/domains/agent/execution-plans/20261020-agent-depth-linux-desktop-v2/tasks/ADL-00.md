# Commands 与 Attribution 产品合同

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-depth-linux-desktop-20261020",
  "taskId": "ADL-00",
  "workstreamId": "ADL",
  "title": "Commands and attribution product contract and prototype confirmation",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "ADL-product-contract",
  "journeyId": "agent-depth-prototype",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/domains/agent",
    "docs/architecture/engineering/prototypes",
    "packages/prototypes/desktop"
  ],
  "readSet": [
    "apps/desktop/src",
    "packages/locales"
  ],
  "budgets": {
    "focusedCheckSeconds": 240,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "prototype-typecheck",
      "command": "pnpm --filter @peers-touch/prototype-desktop-shell exec tsc --noEmit",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "prototype-geometry",
      "command": "node packages/prototypes/desktop/shell/qa/agent_chat_checks.cjs",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "prototype-owner-review",
      "command": "review Commands, stale state, attribution badges and detail disclosure against the confirmed prototype ledger",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "doneWhen": [
    "The prototype shows keyboard, pointer, empty, stale, unavailable, compact and narrow command states.",
    "Attribution badges and details distinguish included, omitted and truncated sources without debug content.",
    "The prototype ledger moves to pending-review and receives explicit Owner confirmation before production implementation.",
    "Product and experience contracts define command authority and immutable history semantics."
  ],
  "failureBehavior": [
    "Production implementation remains blocked while prototype status is not confirmed.",
    "Unresolved disclosure or /clear semantics return to product design instead of being decided in code."
  ],
  "updatedAt": "2026-10-20T04:10:00.000Z"
}
```

## Current Snapshot

Commands & Skills and historical Turn Attribution are rendered in the Desktop
Shell with ready/empty/stale/unavailable, keyboard/pointer, compact/narrow and
included/omitted/truncated states. The source-bound browser gate passes
11 Journeys and 136 operation contracts with `errors=[]`; evidence is under
`/tmp/pt-agent-depth-v2-prototype-final/`.

The `modern-chat-agent` ledger is `confirmed`. The Owner explicitly confirmed
the Commands & Skills and historical Turn Attribution contract, so ADL-03 and
ADL-04 production implementation is unblocked.
