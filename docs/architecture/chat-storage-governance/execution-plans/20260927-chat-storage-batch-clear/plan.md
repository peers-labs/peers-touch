# Chat 存储批量会话清理

> **Status**: active
> **Branch**: peers-touch-git
> **Workspace ID**: 5f50d8bb381b0123
> **Initial HEAD**: 4186816bc19a563395dd4b13c0ced0d9735dff11

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "CSG-BATCH-20260927",
  "status": "active",
  "binding": {
    "branch": "peers-touch-git",
    "workspaceId": "5f50d8bb381b0123",
    "initialHead": "4186816bc19a563395dd4b13c0ced0d9735dff11"
  },
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/chat-storage-governance/product-definition.md",
      "docs/architecture/chat-storage-governance/benchmark-disposition.md",
      "docs/architecture/chat-storage-governance/experience-contract.md",
      "docs/architecture/chat-storage-governance/product-state-model.md",
      "docs/architecture/chat-storage-governance/acceptance-matrix.md",
      "docs/architecture/chat-storage-governance/design.md",
      "docs/architecture/chat-storage-governance/decisions.md",
      "docs/architecture/chat-storage-governance/data-model.md",
      "docs/architecture/chat-storage-governance/integration.md",
      "docs/architecture/local-dev-control-plane/decisions.md"
    ],
    "decisions": [
      "CSG-D01",
      "CSG-D04",
      "CSG-D07",
      "CSG-D08",
      "CSG-D09",
      "LDCP-D15"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "apps/dev",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/README.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/chat-storage-governance",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/local-dev-control-plane",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "packages/client-chat-core",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "packages/locales",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src/components/settings",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src/runtimes",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src/components/chat",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "apps/desktop/src-tauri/src/messaging",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src-tauri/src/interface/tauri_commands/messaging.rs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src-tauri/src/main.rs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src/acceptance/chat",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src/services/desktop_api.ts",
        "mode": "exclusive-write"
      },
      {"pathPrefix": "apps/mobile/src/pages/settings", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile/src/acceptance", "mode": "exclusive-write"},
      {
        "pathPrefix": "apps/mobile/src/runtimes",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/mobile/src/pages/ChatPage.tsx",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "apps/mobile/src-tauri/src/messaging",
        "mode": "exclusive-write"
      },
      {"pathPrefix": "apps/mobile/package.json", "mode": "shared-read"},
      {"pathPrefix": "apps/mobile/scripts", "mode": "shared-read"},
      {"pathPrefix": "docs/architecture/mobile", "mode": "shared-read"},
      {"pathPrefix": "docs/client/mobile", "mode": "shared-read"},
      {"pathPrefix": "pnpm-lock.yaml", "mode": "shared-read"},
      {
        "pathPrefix": "packages/messaging-core",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/acceptance",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/local-dev",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-github-review/FRESHNESS.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-local-dev-env",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Delete Station authority history or another device's data",
      "Add an unscoped delete-all-chat action",
      "Add a cross-conversation database transaction or new storage protocol",
      "Add restore, undo, custom retention periods or disappearing messages",
      "Claim Browser parity",
      "Change Local Dev Control Plane behavior beyond restoring accepted LDCP-D15 Profile-ID reset policy"
    ]
  },
  "tasks": [
    {
      "id": "CSG-BATCH-01-desktop",
      "workstreamId": "CSG-BATCH-SOURCE",
      "path": "tasks/CSG-BATCH-01-desktop.md",
      "dependsOn": [],
      "status": "done",
      "blocker": null
    },
    {
      "id": "CSG-BATCH-02A-desktop",
      "workstreamId": "CSG-BATCH-SOURCE",
      "path": "tasks/CSG-BATCH-02A-desktop.md",
      "dependsOn": [
        "CSG-BATCH-01-desktop"
      ],
      "status": "done",
      "blocker": null
    },
    {
      "id": "CSG-BATCH-02-mobile",
      "workstreamId": "CSG-BATCH-MOBILE",
      "path": "tasks/CSG-BATCH-02-mobile.md",
      "dependsOn": [
        "CSG-BATCH-01-desktop"
      ],
      "status": "in_progress",
      "blocker": null
    },
    {
      "id": "CSG-BATCH-03-aggregate",
      "workstreamId": "CSG-BATCH-ACCEPTANCE",
      "path": "tasks/CSG-BATCH-03-aggregate.md",
      "dependsOn": [
        "CSG-BATCH-02A-desktop",
        "CSG-BATCH-02-mobile"
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
      "deployProfiles": [
        "chat-native-five",
        "mobile-direct-simulator"
      ],
      "destructiveResetScopes": [
        "chat-native-five"
      ]
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
    "csg-batch-source": [],
    "csg-batch-desktop": [
      "chat-storage-desktop-batch-clear-e2e"
    ],
    "csg-batch-mobile": [
      "chat-storage-mobile-batch-clear-e2e"
    ],
    "csg-batch-aggregate": [
      "chat-storage-batch-clear-aggregate-e2e",
      "desktop-release-build",
      "mobile-native-build",
      "acceptance-infra-validation"
    ]
  },
  "completion": [
    "chat-storage-desktop-batch-clear-e2e",
    "chat-storage-mobile-batch-clear-e2e",
    "chat-storage-batch-clear-aggregate-e2e",
    "desktop-release-build",
    "mobile-native-build",
    "acceptance-infra-validation"
  ],
  "full": [
    "acceptance-plan-self", "acceptance-runtime-provisioning-self", "acceptance-workflow-contract", "acceptance-infra-validation",
    "agent-marketplace-catalog-e2e", "agent-native-knowledge-binding-e2e", "agent-quick-completion-e2e", "agent-stream-resilience-e2e",
    "chat-desktop-gateway-e2e", "chat-lifecycle-call-resolution-e2e", "chat-lifecycle-direct-e2e", "chat-lifecycle-mixed-client-cross-station-e2e",
    "chat-lifecycle-mixed-client-group-mls-e2e", "chat-lifecycle-mixed-client-multi-device-e2e", "chat-lifecycle-mixed-client-same-station-e2e", "chat-lifecycle-onboarding-e2e",
    "chat-lifecycle-tree-zero-reference-e2e", "chat-native-current-profile-two-client-e2e", "chat-native-group-mls-e2e", "chat-native-interactions-e2e",
    "chat-native-multi-device-e2e", "chat-native-recovery-e2e", "chat-native-submitted-command-recovery-e2e", "chat-native-typing-e2e",
    "chat-native-two-client-e2e", "chat-native-visible-static", "chat-storage-contract", "chat-storage-accounting-e2e",
    "chat-storage-batch-clear-aggregate-e2e", "chat-storage-cache-clear-e2e", "chat-storage-dead-contract-zero-e2e", "chat-storage-delete-reclaim-e2e",
    "chat-storage-desktop-batch-clear-e2e", "chat-storage-governance-aggregate-e2e", "chat-storage-mobile-batch-clear-e2e", "chat-storage-redaction-recovery-e2e",
    "chat-storage-retention-e2e", "chat-storage-zero-legacy-e2e", "desktop-check", "desktop-dev-runtime-isolation-static",
    "desktop-release-build", "dev-ui-browser-e2e", "federation-three-node-e2e", "machine-dev-registry-self",
    "messaging-platform-contract", "mobile-contract-static", "mobile-hard-cut-static", "mobile-ios-simulator-layout-accessibility-e2e",
    "mobile-native-build", "mobile-simulator-access-e2e", "mobile-simulator-chat-contacts-e2e", "mobile-simulator-moments-e2e",
    "mobile-simulator-platform-e2e", "mobile-simulator-recovery-e2e", "mobile-simulator-recovery-ui-e2e", "mobile-simulator-runtime-lifecycle-e2e",
    "mobile-simulator-settings-e2e", "mobile-simulator-social-convergence-e2e", "mobile-simulator-station-lifecycle-e2e",
    "peers-dev-product", "peers-dev-ui-browser-e2e", "proto-build", "station-access-federation-boundary-e2e",
    "station-access-auth-e2e", "station-access-capability-contract", "station-access-scope-isolation-e2e",
    "station-agent-unit", "station-api-ownership", "station-federation-unit", "station-messaging-unit"
  ]
}
```

## Goal

让 Desktop 与 Mobile 用户从“设置 > 存储”显式选择多个会话，安全批量清理当前
设备上的本机 Chat 数据，并获得可解释的进度、部分失败与实际释放空间反馈。

## Dependency DAG

```text
CSG-BATCH-01-desktop
  ├─> CSG-BATCH-02A-desktop ─┐
  └─> CSG-BATCH-02-mobile ───┴─> CSG-BATCH-03-aggregate
```

## Atomic Boundary

- 批量入口只组合现有 `chat_storage_clear_conversation`，不增加第二个删除 owner。
- 每个会话独立提交；已成功项不回滚，失败项保留用于重试。
- scope 变化停止未开始项并清除旧 scope UI 状态。
- 先冻结共享 helper 与双端源码，再分别执行 Desktop/Mobile 原生 Journey。

## Completion

- 双端均可逐项选择、全选当前搜索结果、确认和批量清理。
- 双端均展示执行进度、成功数、失败数与实际释放量。
- 失败项可以单独重试，未选择项和其他设备保持不变。
- Desktop 与 Mobile 原生 E2E、发布构建和 Acceptance Infra 验证全部通过。
- 最终精确源码工作树干净，运行资源释放。

## Non-Claims

- 不声明 Browser 支持、跨设备批量删除、Station 历史删除或跨会话原子事务。
