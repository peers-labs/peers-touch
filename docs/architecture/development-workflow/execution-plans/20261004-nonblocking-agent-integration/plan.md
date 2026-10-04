# Nonblocking Agent Integration Control Actions

> **Status**: active
> **Branch**: fix/nonblocking-agent-integration
> **Workspace ID**: 23d863a02a53c299
> **Initial HEAD**: c7e712fb8c60197dcab9c265e3687f1e58c5a988

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "DWF-NONBLOCKING-INTEGRATION-20261004",
  "status": "active",
  "binding": {
    "branch": "fix/nonblocking-agent-integration",
    "workspaceId": "23d863a02a53c299",
    "initialHead": "c7e712fb8c60197dcab9c265e3687f1e58c5a988"
  },
  "workClass": "infrastructure",
  "architecture": {
    "sources": [
      "docs/architecture/development-workflow/README.md",
      "docs/architecture/development-workflow/decisions.md",
      "docs/architecture/development-workflow/integration.md",
      "docs/architecture/development-workflow/host-neutral-agent-integration.md",
      "docs/architecture/development-workflow/module-layout.md",
      "docs/knowledge/invariants/host-neutral-agent-execution.md",
      "docs/knowledge/invariants/owner-rooted-workflow-binding.md"
    ],
    "decisions": [
      "DWF-D21",
      "DWF-D22",
      "DWF-D33",
      "DWF-D34",
      "DWF-D35",
      "DWF-D36",
      "DWF-D37"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "AGENTS.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "Makefile",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/architecture-module-governance/architecture-modules.json",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/development-workflow",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/global/workflow.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/knowledge/invariants/host-neutral-agent-execution.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/knowledge/invariants/owner-rooted-workflow-binding.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/devctl/test/station.test.mjs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/make",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/plugins/pt-ew-plugin",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/architecture/module-governance.test.mjs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/acceptance-plan.py",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/acceptance-plan-test.py",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/agent-integration-audit-test.py",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/agent-integration-audit.py",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/agent-integration-control.py",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/install-agent-integration.sh",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/local-dev",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/review",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-github-review",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-dev-workflow",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Change Peers Touch end-user product behavior",
      "Weaken OWNER, child-lineage, cross-worktree write, or Completion Review checks",
      "Migrate or dual-read legacy conversation or Action Receipt schemas",
      "Delete Plan, Session, Completion Review, runtime lease, or Acceptance evidence",
      "Modify the two pre-existing generated capability files in this worktree",
      "Merge histories, rewrite history, or run the real machine hard cut"
    ]
  },
  "tasks": [
    {
      "id": "DWF-NBI01-CONTROL-ACTIONS",
      "workstreamId": "DWF-INTEGRATION-CONTROL",
      "path": "tasks/DWF-NBI01-CONTROL-ACTIONS.md",
      "dependsOn": [],
      "status": "in_progress",
      "blocker": null
    },
    {
      "id": "DWF-NBI02-PROOF-DELIVERY",
      "workstreamId": "DWF-INTEGRATION-DELIVERY",
      "path": "tasks/DWF-NBI02-PROOF-DELIVERY.md",
      "dependsOn": [
        "DWF-NBI01-CONTROL-ACTIONS"
      ],
      "status": "pending",
      "blocker": null
    }
  ],
  "exhaustion": null,
  "authorization": {
    "checkpoint": {
      "localCommit": "allowed",
      "amend": "allowed"
    },
    "delivery": {
      "push": "allowed",
      "pullRequest": "allowed"
    },
    "runtime": {
      "deployProfiles": [],
      "destructiveResetScopes": []
    },
    "history": {
      "rewrite": "denied"
    }
  }
}
```

## Acceptance Execution

```json
{
  "closures": {
    "nonblocking-control-actions": [
      "acceptance-runtime-provisioning-self",
      "acceptance-workflow-contract",
      "development-workflow-control-plane",
      "dev-ui-browser-e2e",
      "machine-dev-registry-self"
    ],
    "nonblocking-control-proof": [
      "acceptance-infra-validation",
      "acceptance-plan-self",
      "acceptance-runtime-provisioning-self",
      "acceptance-workflow-contract",
      "development-workflow-control-plane",
      "dev-ui-browser-e2e",
      "machine-dev-registry-self",
      "peers-dev-product",
      "peers-dev-ui-browser-e2e"
    ]
  },
  "completion": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "development-workflow-control-plane",
    "dev-ui-browser-e2e",
    "machine-dev-registry-self",
    "peers-dev-product",
    "peers-dev-ui-browser-e2e"
  ],
  "full": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "development-workflow-control-plane",
    "dev-ui-browser-e2e",
    "machine-dev-registry-self",
    "peers-dev-product",
    "peers-dev-ui-browser-e2e"
  ]
}
```

## Goal

Remove the machine-wide idle and Hook-issued grant dependencies from ordinary
Agent integration projection while isolating destructive legacy-store and
retired-projection cleanup behind exact OWNER grants and explicit global-idle
commands.

## Dependency DAG

```text
DWF-NBI01-CONTROL-ACTIONS
  -> DWF-NBI02-PROOF-DELIVERY
```

## Atomic Cutover

- `skills` becomes projection-only and never deletes machine workflow state.
- `skills-hard-cut` becomes the only legacy conversation/action-store deletion
  command.
- `skills-gc` becomes the only retired project projection deletion command.
- All three commands retain distinct OWNER_CONTROL labels; only hard cut and
  GC receive exact create-once OWNER grants.
- Existing combined install-and-purge behavior is deleted; no compatibility
  alias or opportunistic cleanup remains.

## Review Focus

- Unrelated live work cannot block ordinary projection.
- Hard cut and GC cannot run while unrelated work is live.
- A cleanup grant cannot be reused or consumed by a different action label.
- Machine lock serialization remains bounded and is not treated as idle proof.
- Installation success makes no cleanup claim.
