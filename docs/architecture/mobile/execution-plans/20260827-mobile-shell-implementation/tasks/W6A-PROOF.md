# W6A-PROOF - Chat Contacts And Group Receiver Proof

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6A-PROOF",
  "workstreamId": "W6A",
  "title": "Chat, Contacts, and Group receiver proof",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "W6A-proof",
  "journeyId": "MS-J03..MS-J04-receiver-proof",
  "runtimeClass": "native-mobile",
  "writeSet": ["tooling/acceptance/gates/mobile", "tooling/acceptance/provisioners"],
  "readSet": ["apps/mobile", "apps/station", "packages/messaging-core", "docs/architecture/api-ownership", "docs/architecture/messaging-platform", "docs/architecture/mobile"],
  "budgets": {"focusedCheckSeconds": 120, "functionalRunSeconds": 4800, "cleanupSeconds": 240},
  "checks": [
    {"id": "mobile-chat-contacts-proof-structure", "command": "python3 tooling/scripts/acceptance-validate.py --domain mobile", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "mobile-chat-contacts-runtime", "command": "MOBILE_ACCEPTANCE_RESET=1 python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mobile-shell-w6a-proof --station-profile station=chat-native-disposable --gate mobile-simulator-chat-contacts-e2e", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "mobile-chat-contacts-local-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static --gate station-dashboard-unit --gate station-dashboard-web-check --gate acceptance-plan-self --gate acceptance-infra-validation --gate acceptance-workflow-contract --gate acceptance-runtime-provisioning-self", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "mobile-simulator-chat-contacts", "command": "MOBILE_ACCEPTANCE_RESET=1 python3 tooling/scripts/acceptance-run.py --station-profile station=chat-native-disposable --gate mobile-simulator-chat-contacts-e2e", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Two actors on one Station observe canonical Chat, Contact, and Group outcomes", "Forward, retract, actor-hide, moderation, member update, mute, and ownership transfer produce authoritative receiver-visible outcomes", "Nonempty receiver history survives restart within accepted bounds", "CA-W6 same-Station receiver proof passes"],
  "failureBehavior": ["Do not infer receiver delivery or deletion scope from sender submission", "Identity, Inbox, key, command, or owner conflicts remain BLOCKED without canonical recovery semantics", "Do not claim deferred cross-Station or Relay-backed behavior"],
  "updatedAt": "2026-09-21T06:30:00Z",
  "durableEvidence": [
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "PASS", "ref": "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md#L1540-L1548"},
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "BLOCKED", "ref": "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md#L1428-L1452"},
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "BLOCKED", "ref": "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md#L3045"}
  ]
}
```

## Objective

Prove receiver-observable same-Station Chat, Contacts, and Group behavior on
exact source.

## Current Snapshot

- Source and local Gate evidence is retained by W6A.
- Same-Station receiver delivery, restart history, active-history bounds, and
  CA-W6 remain unproven. Cross-Station/Relay behavior is deferred.
