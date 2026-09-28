# Desktop Primary Navigation Cleanup

> **Status**: active
> **Branch**: work/station-access-lifecycle
> **Workspace ID**: 95620934d3348d95
> **Initial HEAD**: 3fb8a5428b8c8c60727d1460a271adfd920b0bfa

## Verified Worktree Binding

- Canonical root: the repository root resolved from `$PWD`; no machine-local
  absolute path is persisted in Git.
- Branch: `work/station-access-lifecycle`
- Workspace ID: `95620934d3348d95`
- Initial and expected HEAD:
  `3fb8a5428b8c8c60727d1460a271adfd920b0bfa`
- Verification:
  `python3 tooling/scripts/verify-worktree-binding.py --root "$PWD" --branch work/station-access-lifecycle --workspace-id 95620934d3348d95 --head 3fb8a5428b8c8c60727d1460a271adfd920b0bfa`

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "DPNC-20260928",
  "status": "active",
  "binding": {
    "branch": "work/station-access-lifecycle",
    "workspaceId": "95620934d3348d95",
    "initialHead": "3fb8a5428b8c8c60727d1460a271adfd920b0bfa"
  },
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/frontend-runtime/README.md",
      "docs/architecture/frontend-runtime/design.md",
      "docs/architecture/frontend-runtime/decisions.md",
      "docs/architecture/applet-runtime/decisions.md",
      "docs/client/common/ui-identity/frontend-component-tree.md",
      "docs/client/common/ui-identity/frontend-component-tree-registry.md",
      "docs/client/desktop/navigation-and-settings-ownership.md",
      "docs/client/desktop/runtime-projections.md",
      "docs/global/coding-guide/desktop/module-registry.md"
    ],
    "decisions": [
      "D-02",
      "D-04",
      "DPNC-D01",
      "DPNC-D02"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "apps/applets/note",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "apps/desktop/src/components",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src/hooks",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src/modules",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src/pages",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src/views",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/e2e",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src-tauri/src/application/applets",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src/store/notebook.ts",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src/types/navigation.ts",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/client/common/ui-identity/frontend-component-tree-registry.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/applet-runtime",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/frontend-runtime",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/client/common/ui-identity/frontend-component-tree.md",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/client/desktop",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/global/coding-guide/desktop/module-registry.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/global/coding-guide/desktop/page-component.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "packages/locales",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "packages/applet-contract",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "packages/prototypes/desktop/shell",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-github-review/FRESHNESS.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Remove or modify the official Note applet under apps/applets/note",
      "Remove the canonical global CommandMenu or its keyboard shortcut",
      "Change Station APIs, persistence protocols, or Note applet service contracts",
      "Keep compatibility routes or duplicate standalone pages for migrated utilities",
      "Push, open a pull request, merge, or rewrite history"
    ]
  },
  "tasks": [
    {
      "id": "DPNC-01-DESKTOP-CUTOVER",
      "workstreamId": "DPNC-DESKTOP",
      "path": "tasks/DPNC-01-DESKTOP-CUTOVER.md",
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
      "push": "denied",
      "pullRequest": "denied"
    },
    "runtime": {
      "deployProfiles": [
        "desktop-browser-local"
      ],
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
    "dpnc-desktop-cutover": [
      "applet-desktop-lifecycle-smoothness",
      "desktop-primary-navigation-e2e",
      "desktop-check",
      "desktop-release-build"
    ]
  },
  "completion": [
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "acceptance-workflow-contract",
    "acceptance-runtime-provisioning-self",
    "applet-desktop-lifecycle-smoothness",
    "desktop-primary-navigation-e2e",
    "desktop-check",
    "desktop-release-build",
    "applet-domain-validation"
  ],
  "full": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "agent-marketplace-catalog-e2e",
    "agent-v2-evaluation-lab-e2e",
    "applet-desktop-lifecycle-smoothness",
    "chat-lifecycle-call-resolution-e2e",
    "chat-lifecycle-mixed-client-cross-station-e2e",
    "chat-lifecycle-mixed-client-group-mls-e2e",
    "chat-lifecycle-mixed-client-multi-device-e2e",
    "chat-lifecycle-mixed-client-same-station-e2e",
    "chat-lifecycle-tree-zero-reference-e2e",
    "chat-native-interactions-e2e",
    "chat-native-visible-static",
    "chat-storage-desktop-batch-clear-e2e",
    "chat-storage-mobile-batch-clear-e2e",
    "desktop-primary-navigation-e2e",
    "desktop-check",
    "desktop-release-build",
    "applet-domain-validation",
    "messaging-platform-contract",
    "mobile-hard-cut-static",
    "mobile-ios-simulator-layout-accessibility-e2e",
    "mobile-simulator-platform-e2e",
    "mobile-simulator-station-lifecycle-e2e",
    "proto-build",
    "station-agent-unit",
    "station-messaging-unit"
  ]
}
```

## Goal

Reduce the Desktop primary navigation to product-level destinations. Settings
becomes the sole owner of My Files, Cron Jobs, Channels, and Command Palette,
while the obsolete standalone Notes route and module are deleted without
changing the official Note applet.

## Dependency DAG

```text
DPNC-01-DESKTOP-CUTOVER
```

## Atomic Cutover

- Delete the standalone Notes route, page, store, navigation commands, and
  locale surface in one change, including the shared host-page allowlist.
- Convert My Files, Cron Jobs, and Channels to Settings-only module
  registrations with selected-only section lifetimes; no standalone page or
  primary-nav owner remains.
- Keep one canonical CommandMenu overlay and expose its configuration/help
  surface through Settings; remove the duplicate rail-local palette.
- Update navigation/search/deep-link behavior so no removed route is silently
  redirected to the official Note applet.
- Add and register `tooling/acceptance/gates/desktop/primary_navigation_e2e.py`
  as the exact-source `desktop-primary-navigation-e2e` product Gate.

## Completion And Non-claims

Completion requires the focused Desktop checks, an exact-source interactive
Desktop journey covering the primary rail and all four Settings sections, and
the declared Acceptance gates.

`desktop-browser-local` authorizes only the self-contained local Chromium/Vite
runtime owned and cleaned up by `desktop-primary-navigation-e2e`. It does not
authorize Station deployment, remote environment mutation, or a persistent
development server.

This Plan does not claim changes to the Note applet, Station behavior, Mobile,
or delivery to a remote branch.
