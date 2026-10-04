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
      "docs/architecture/development-workflow/data-model.md",
      "docs/architecture/development-workflow/design.md",
      "docs/architecture/development-workflow/integration.md",
      "docs/architecture/development-workflow/host-neutral-agent-integration.md",
      "docs/architecture/development-workflow/module-layout.md",
      "docs/architecture/local-dev-control-plane/decisions.md",
      "docs/architecture/local-dev-control-plane/design.md",
      "docs/architecture/frontend-runtime/decisions.md",
      "docs/architecture/frontend-runtime/design.md",
      "docs/architecture/runtime/desktop-runtime-architecture.md",
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
      "DWF-D37",
      "DWF-D38",
      "DWF-D39",
      "LDCP-D19",
      "D-18"
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
        "pathPrefix": "apps/desktop",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/dev",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/app/subserver/agent",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/development/secure_content",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/devctl",
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
        "pathPrefix": "tooling/scripts",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Remove the Tauri WebView renderer used inside the native Desktop application",
      "Remove system-browser OAuth handoff or independent Web products",
      "Weaken OWNER, child-lineage, cross-worktree write, or Completion Review checks",
      "Migrate or dual-read legacy conversation or Action Receipt schemas",
      "Delete Plan, Session, Completion Review, runtime lease, or Acceptance evidence",
      "Modify the pre-existing user change in docs/architecture/federation/data-model.md",
      "Merge histories, rewrite history, or run the real machine hard cut"
    ]
  },
  "tasks": [
    {
      "id": "DWF-NBI01-CONTROL-ACTIONS",
      "workstreamId": "DWF-INTEGRATION-CONTROL",
      "path": "tasks/DWF-NBI01-CONTROL-ACTIONS.md",
      "dependsOn": [],
      "status": "done",
      "blocker": null
    },
    {
      "id": "DWF-NBI02-NATIVE-PLAN-MOUNT-CUTOVER",
      "workstreamId": "DWF-INTEGRATION-CONTROL",
      "path": "tasks/DWF-NBI02-NATIVE-PLAN-MOUNT-CUTOVER.md",
      "dependsOn": [
        "DWF-NBI01-CONTROL-ACTIONS"
      ],
      "status": "in_progress",
      "blocker": null
    },
    {
      "id": "DWF-NBI03-PROOF-DELIVERY",
      "workstreamId": "DWF-INTEGRATION-DELIVERY",
      "path": "tasks/DWF-NBI03-PROOF-DELIVERY.md",
      "dependsOn": [
        "DWF-NBI02-NATIVE-PLAN-MOUNT-CUTOVER"
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
    "nonblocking-control-actions": [],
    "native-plan-mount-cutover": [],
    "nonblocking-control-proof": [
      "acceptance-infra-validation",
      "acceptance-plan-self",
      "acceptance-runtime-provisioning-self",
      "acceptance-workflow-contract",
      "development-workflow-control-plane",
      "machine-dev-registry-self",
      "desktop-check",
      "desktop-dev-runtime-isolation-static",
      "desktop-primary-navigation-e2e"
    ]
  },
  "completion": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "development-workflow-control-plane",
    "machine-dev-registry-self",
    "desktop-check",
    "desktop-dev-runtime-isolation-static",
    "desktop-primary-navigation-e2e"
  ],
  "full": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "development-workflow-control-plane",
    "machine-dev-registry-self",
    "desktop-check",
    "desktop-dev-runtime-isolation-static",
    "desktop-primary-navigation-e2e"
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
  -> DWF-NBI02-NATIVE-PLAN-MOUNT-CUTOVER
  -> DWF-NBI03-PROOF-DELIVERY
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
- Plan source is frozen independently of the execution worktree. A Plan mount
  occupies one worktree until completion, cancellation, or explicit unmount.
- Desktop supports only the native Tauri launch path. Browser-mode launch,
  browser product proof, the Peers Dev 4177 dashboard, and their compatibility
  aliases are deleted.
- Workflow Snapshot remains a read-only CLI/API projection and does not own a
  browser server.

## Review Focus

- Unrelated live work cannot block ordinary projection.
- Hard cut and GC cannot run while unrelated work is live.
- A cleanup grant cannot be reused or consumed by a different action label.
- Machine lock serialization remains bounded and is not treated as idle proof.
- Installation success makes no cleanup claim.
- Native Desktop proof exercises a real application window and input path.
- No current architecture, runtime class, command, Gate, provisioner, registry
  entry, or product matrix treats browser as a Desktop client.
- Plan mount, runtime lease, and atomic lock remain distinct resource classes.
