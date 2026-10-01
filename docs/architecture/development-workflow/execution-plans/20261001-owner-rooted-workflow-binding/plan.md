# Owner-Rooted Workflow Binding Hard Cut

> **Status**: active
> **Branch**: peers-dev-workflow
> **Workspace ID**: dbd1913c8dd24d52
> **Initial HEAD**: c8cca6796f5a6e0d632b1328319d2b794f6a5822

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "DWF-OWNER-BINDING-HARD-CUT-20261001",
  "status": "active",
  "binding": {
    "branch": "peers-dev-workflow",
    "workspaceId": "dbd1913c8dd24d52",
    "initialHead": "c8cca6796f5a6e0d632b1328319d2b794f6a5822"
  },
  "workClass": "infrastructure",
  "architecture": {
    "sources": [
      "docs/architecture/development-workflow/README.md",
      "docs/architecture/development-workflow/design.md",
      "docs/architecture/development-workflow/data-model.md",
      "docs/architecture/development-workflow/decisions.md",
      "docs/architecture/development-workflow/module-layout.md",
      "docs/architecture/development-workflow/integration.md",
      "docs/architecture/development-workflow/host-neutral-agent-integration.md",
      "docs/architecture/development-workflow/completion-review.md",
      "docs/architecture/development-workflow/progress-observability.md",
      "docs/knowledge/invariants/owner-rooted-workflow-binding.md"
    ],
    "decisions": [
      "DWF-D21",
      "DWF-D22",
      "DWF-D28",
      "DWF-D29",
      "DWF-D30",
      "DWF-D31",
      "DWF-D33"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "AGENTS.md",
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
        "pathPrefix": "docs/knowledge/invariants",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/knowledge/pitfalls/acceptance-shared-validator-variant-assumptions.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/gates/dev",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/make/setup.mk",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/make/local-dev.mk",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/plugins/pt-ew-plugin",
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
        "pathPrefix": "tooling/scripts/acceptance-gap-detect-test.py",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/acceptance-gap-detect.py",
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
        "pathPrefix": "tooling/scripts/plan",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/scripts/review/skill-check.sh",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-completion-auditor",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-acceptance-gap-detector",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-context-anchor",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-dev-workflow",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-github-review",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-goal-orchestrator",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-trae-host-adapter",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Change Peers Touch end-user product behavior",
      "Modify sibling worktree source or the shared workspace descriptor during implementation",
      "Read, migrate, alias, or dual-write the legacy conversation or Action Receipt schema",
      "Delete Plan, Session, Completion Review, runtime lease, or Acceptance evidence",
      "Push, open a pull request, merge histories, or rewrite history"
    ]
  },
  "tasks": [
    {
      "id": "DWF-BIND01-OWNER-CHILD-CUT",
      "workstreamId": "DWF-BINDING-CORE",
      "path": "tasks/DWF-BIND01-OWNER-CHILD-CUT.md",
      "dependsOn": [],
      "status": "in_progress",
      "blocker": null
    },
    {
      "id": "DWF-BIND03-PROOF-CLEANUP",
      "workstreamId": "DWF-BINDING-DELIVERY",
      "path": "tasks/DWF-BIND03-PROOF-CLEANUP.md",
      "dependsOn": [
        "DWF-BIND01-OWNER-CHILD-CUT"
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
      "push": "denied",
      "pullRequest": "denied"
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
    "owner-child-binding-cut": [
      "acceptance-infra-validation",
      "acceptance-plan-self",
      "acceptance-runtime-provisioning-self",
      "acceptance-workflow-contract",
      "development-workflow-control-plane"
    ],
    "binding-hard-cut-proof": [
      "acceptance-infra-validation",
      "acceptance-plan-self",
      "acceptance-runtime-provisioning-self",
      "acceptance-workflow-contract",
      "development-workflow-control-plane",
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
    "peers-dev-product",
    "peers-dev-ui-browser-e2e"
  ],
  "full": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "development-workflow-control-plane",
    "peers-dev-product",
    "peers-dev-ui-browser-e2e"
  ]
}
```

## Goal

Replace the ambiguous peer-owner conversation model with one canonical
OWNER-rooted binding projection, assigned WORKER/REVIEWER lineage, exact
Completion Review selection, and one TRAE multi-root workspace bootstrap.

## Atomic Cutover

- `workflow-binding-projection.mjs` becomes the sole host identity and
  per-event root projection owner.
- `workflow-binding-store.mjs` becomes the sole OWNER/child lifecycle store.
- Every consumer moves in the same core Task; then
  `workflow-conversation-binding.mjs` is deleted.
- The installer deletes old machine-local conversation and Action Receipt
  stores only after global idle proof. It does not migrate their contents.
- Sibling worktrees and the shared workspace descriptor remain read-only in
  this source Plan. Real multi-root rollout is a separately declared operation.

## Review Focus

- No host field aliases or process-global identity fallback.
- No worktree-wide active-binding uniqueness fallback.
- OWNER has no generic TTL; child liveness is assignment/lease/terminal based.
- `CROSS_WORKTREE_WRITE_DENIED` is unchanged.
- Status, handoff, Stop, worker result, and Completion Review consume the same
  `BindingProjection`.
