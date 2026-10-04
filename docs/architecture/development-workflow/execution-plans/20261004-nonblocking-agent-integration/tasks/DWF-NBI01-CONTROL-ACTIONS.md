# Nonblocking Integration Control Actions

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-NONBLOCKING-INTEGRATION-20261004",
  "taskId": "DWF-NBI01-CONTROL-ACTIONS",
  "workstreamId": "DWF-INTEGRATION-CONTROL",
  "title": "Separate projection, hard cut, and retired-projection GC",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "nonblocking-control-actions",
  "journeyId": "DEV-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "AGENTS.md",
    "Makefile",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "docs/architecture/development-workflow",
    "docs/global/workflow.md",
    "docs/knowledge/invariants/host-neutral-agent-execution.md",
    "docs/knowledge/invariants/owner-rooted-workflow-binding.md",
    "tooling/acceptance",
    "tooling/devctl/test/station.test.mjs",
    "tooling/make",
    "tooling/plugins/pt-ew-plugin",
    "tooling/scripts/agent-integration-audit-test.py",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/acceptance-plan.py",
    "tooling/scripts/acceptance-plan-test.py",
    "tooling/scripts/architecture/module-governance.test.mjs",
    "tooling/scripts/install-agent-integration.sh",
    "tooling/scripts/local-dev",
    "tooling/skills/pt-dev-workflow",
    "tooling/skills/pt-github-review"
  ],
  "readSet": [
    "tooling/scripts/review"
  ],
  "budgets": {
    "focusedCheckSeconds": 420,
    "functionalRunSeconds": 420,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "integration-control-source",
      "command": "python3 -m unittest tooling/scripts/agent-integration-audit-test.py",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "integration-control-functional",
      "command": "python3 tooling/scripts/agent-integration-audit-test.py -k install_with_live_declaration && python3 tooling/scripts/agent-integration-audit-test.py -k hard_cut && python3 tooling/scripts/agent-integration-audit-test.py -k skills_gc",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "integration-action-contract",
      "command": "node --test tooling/scripts/local-dev/workflow-action-store.test.mjs tooling/scripts/local-dev/workflow-kernel.test.mjs tooling/scripts/local-dev/workflow-tool-intent.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "integration-control-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-runtime-provisioning-self --gate acceptance-workflow-contract --gate development-workflow-control-plane --gate dev-ui-browser-e2e --gate machine-dev-registry-self",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Ordinary skills install succeeds without a Hook-issued grant while an unrelated declaration is active",
    "Ordinary skills install preserves legacy conversation and Action Receipt stores",
    "Hard cut and GC use distinct exact OWNER_CONTROL grants",
    "Hard cut and GC reject unrelated live declarations, assignments, actions, and Action Store locks",
    "Hard cut deletes only legacy conversation and workflow-action stores",
    "GC deletes only retired project Skill and plugin projections",
    "No combined install-and-purge path remains",
    "TRAE projects one equivalent canonical Hook into the source root, descriptor bootstrap, and existing TRAE roots while leaving untouched roots unchanged",
    "Completion Review prepares and submits through a repository-native reviewer capability without Hook Action Receipts"
  ],
  "failureBehavior": [
    "Do not weaken OWNER binding or cross-worktree write enforcement",
    "Do not issue a skills projection grant or allow its installation receipt to authorize cleanup",
    "Do not accept caller-supplied delegation provenance or weaken immutable current-source review",
    "Do not treat a short machine lock as global-idle proof",
    "Do not delete Plan, Session, Completion Review, lease, or Acceptance stores",
    "Do not modify pre-existing generated capability files"
  ],
  "updatedAt": "2026-10-04T09:48:20.000Z",
  "durableEvidence": [
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance://23d863a02a53c299/acceptance-run/20261004T093651691631Z-8e6a4ad727377d2f5735bec126df88e7#ac73734d4fd9f042ec3700910c103ea1c0c97c5f44cdca32686b2e85395e51e9"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance://23d863a02a53c299/acceptance-workflow-contract/20261004T093651943719Z-746103261956754eecc518de5ac76105#3fea65ecb379b326c93f64aebf88deefd8030da9727f5d2951375cf18a86c3a1"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance://23d863a02a53c299/development-workflow-control-plane/20261004T094402545251Z-00203e74e33744d0f2fe13e4974d7455#698d7445a4bdd98b34b1c6db540579d30b67f27fd32a203d0094fbca376a0e6e"
    }
  ]
}
```

## Current Snapshot

- State: exact-source proof passed; Completion Review remediation in progress.
- Next: close reviewer findings, obtain a current PASS receipt, and advance to
  `DWF-NBI02-PROOF-DELIVERY`.
