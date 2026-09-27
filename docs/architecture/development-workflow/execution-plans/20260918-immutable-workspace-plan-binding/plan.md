# Immutable Workspace Plan Binding

> **Status**: active
> **Branch**: peers-dev-workflow
> **Workspace ID**: dbd1913c8dd24d52
> **Initial HEAD**: ba6d87f7aec177b6783289e2b498209407f547b5

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "DWF-IMMUTABLE-PLAN-BINDING-20260918",
  "status": "active",
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
      "DWF-D19",
      "DWF-D20",
      "DWF-D21",
      "DWF-D22",
      "DWF-D23",
      "DWF-D27"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": ".gitignore",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "AGENTS.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/dev",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/acceptance-framework/decisions.md",
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
        "pathPrefix": "docs/global/workflow.md",
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
      "Treat peers-dev-workflow as a central runtime-state owner",
      "Maintain a shared mutable active_work table in project memory",
      "Provide a Plan unbind or rebind operation"
    ]
  },
  "tasks": [
    {
      "id": "DWF-PLAN-BINDING-HARD-CUT",
      "workstreamId": "DWF-PLAN-BINDING",
      "path": "tasks/DWF-PLAN-BINDING-HARD-CUT.md",
      "dependsOn": [],
      "status": "in_progress",
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

Allow many synchronized Plan Packages and concurrent Goals in one repository or
PR while every workspace resolves one machine-local immutable Plan binding,
owns one atomic active-work continuation record, and advances live source
identity outside tracked Plan content. Cross-workspace dashboards, memory and
chat projections are read-only aggregation. `peers-dev-workflow` owns the
canonical implementation and rollout contract only; each consuming worktree
runs the distributed implementation against its own workspace machine state.

## Completion

- Workspace Plan ownership is established once by `planId + planPath`.
- Rebinding an existing workspace is rejected with a typed error.
- Local discovery resolves only the bound Plan and ignores synchronized foreign
  Plans.
- CI requires an explicit Plan input and never scans by branch.
- Group Chat and Agent worktrees resolve their own Plans from the same
  synchronized repository history.
- Plan Packages retain only the immutable initial HEAD; Git, the public
  declaration and Development Session own advancing source identity, while the
  workspace-owned active-work record carries the resumable locator projection.
- Project memory, Peers Dev and Context Anchor enumerate workspace records
  read-only; no workflow action rewrites a shared cross-workspace table.
- Rollout proves that each consuming worktree derives its own `workspaceId` and
  state path after distribution; the source repository never becomes a central
  mutable runtime-state service.
- Continuous Plan Run, Goal scheduling, runtime verification and host Skill
  projection remain project-owned and host-neutral.
- User-specific interaction policy resolves from a machine-local,
  digest-verified Overlay registry without entering canonical Skill rollout or
  changing project execution semantics.
