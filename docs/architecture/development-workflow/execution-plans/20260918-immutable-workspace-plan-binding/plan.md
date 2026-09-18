# Immutable Workspace Plan Binding

> **Status**: completed
> **Branch**: peers-dev-workflow
> **Workspace ID**: dbd1913c8dd24d52
> **Initial HEAD**: ba6d87f7aec177b6783289e2b498209407f547b5

## Plan Package

```json
{
  "schemaVersion": 2,
  "kind": "peers-touch-plan-package",
  "planId": "DWF-IMMUTABLE-PLAN-BINDING-20260918",
  "status": "completed",
  "binding": {
    "branch": "peers-dev-workflow",
    "workspaceId": "dbd1913c8dd24d52",
    "initialHead": "ba6d87f7aec177b6783289e2b498209407f547b5"
  },
  "workClass": "infrastructure",
  "architecture": {
    "sources": [
      "docs/architecture/development-workflow/design.md",
      "docs/architecture/development-workflow/data-model.md",
      "docs/architecture/development-workflow/decisions.md",
      "docs/architecture/local-dev-control-plane/design.md",
      "docs/architecture/local-dev-control-plane/data-model.md"
    ],
    "decisions": [
      "DWF-D16",
      "DWF-D17",
      "DWF-D18",
      "DWF-D19"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "apps/dev",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "AGENTS.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/development-workflow",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/acceptance-framework/decisions.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/agent/execution-plans/20260917-modern-chat-agent-v2-alignment/plan.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/chat-lifecycle/execution-plans/20260916-chat-lifecycle-product-closure/plan.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/developer-toolchain",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/local-dev-control-plane",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/global/local-dev-environment.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/knowledge",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "Makefile",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance",
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
        "pathPrefix": "tooling/scripts",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Change product behavior",
      "Serialize independent worktrees that synchronize through one PR",
      "Infer Plan ownership from branch names or repository contents",
      "Provide a Plan unbind or rebind operation"
    ]
  },
  "tasks": [
    {
      "id": "DWF-PLAN-BINDING-HARD-CUT",
      "workstreamId": "DWF-PLAN-BINDING",
      "path": "tasks/DWF-PLAN-BINDING-HARD-CUT.md",
      "dependsOn": [],
      "status": "done",
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
  "schemaVersion": 1,
  "closures": {
    "immutable-workspace-plan-binding": [
      "acceptance-workflow-contract",
      "acceptance-plan-self",
      "acceptance-infra-validation",
      "acceptance-runtime-provisioning-self"
    ]
  },
  "completion": [
    "acceptance-workflow-contract",
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "acceptance-runtime-provisioning-self"
  ],
  "full": [
    "acceptance-workflow-contract",
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "acceptance-runtime-provisioning-self"
  ]
}
```

## Goal

Allow many synchronized Plan Packages in one repository or PR while every
workspace resolves exactly one machine-local, immutable Plan binding and live
source identity advances outside tracked Plan content.

## Completion

- Workspace Plan ownership is established once by `planId + planPath`.
- Rebinding an existing workspace is rejected with a typed error.
- Local discovery resolves only the bound Plan and ignores synchronized foreign
  Plans.
- CI requires an explicit Plan input and never scans by branch.
- Group Chat and Agent worktrees resolve their own Plans from the same
  synchronized repository history.
- Plan Packages retain only the immutable initial HEAD; Git, the public
  declaration, Development Session checkpoint, and `active_work` own advancing
  source identity.
