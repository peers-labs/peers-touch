# Peers UI 执行计划

> **Plan ID**: UI-20261028
> **Version ID**: UI-20261028-authorized
> **Created**: 2026-10-28T00:00:00.000Z

用户“开始吧”“剩下的全做了”授权本地实现、完整切换与验证，统一审阅。下列 Gate 是本变更必须实现并绑定当前源码的验证入口；不存在入口或业务注入时不能报告 PASS。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "UI-20261028",
  "versionId": "UI-20261028-authorized",
  "createdAt": "2026-10-28T00:00:00.000Z",
  "workClass": "refactor",
  "architecture": {
    "sources": [
      "docs/architecture/platform/client/ui-system/README.md",
      "docs/architecture/platform/client/ui-system/design.md",
      "docs/architecture/platform/client/ui-system/decisions.md",
      "docs/architecture/platform/client/ui-system/data-model.md",
      "docs/architecture/platform/client/ui-system/module-layout.md",
      "docs/architecture/platform/client/ui-system/integration.md"
    ],
    "decisions": [
      "UI-D01",
      "UI-D02",
      "UI-D03",
      "UI-D04"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "packages",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "pnpm-workspace.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "pnpm-lock.yaml",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Commit, push, PR, merge or publish",
      "Change business wire protocols or authority",
      "Claim Lynx/native/receiver proof from Gallery",
      "Modify unrelated dirty worktrees"
    ]
  },
  "tasks": [
    {
      "id": "UI-T01",
      "workstreamId": "UI",
      "path": "tasks/UI-T01.md",
      "dependsOn": []
    },
    {
      "id": "UI-T02",
      "workstreamId": "UI",
      "path": "tasks/UI-T02.md",
      "dependsOn": [
        "UI-T01"
      ]
    },
    {
      "id": "UI-T03",
      "workstreamId": "UI",
      "path": "tasks/UI-T03.md",
      "dependsOn": [
        "UI-T01"
      ]
    },
    {
      "id": "UI-T04",
      "workstreamId": "UI",
      "path": "tasks/UI-T04.md",
      "dependsOn": [
        "UI-T01"
      ]
    },
    {
      "id": "UI-T05",
      "workstreamId": "UI",
      "path": "tasks/UI-T05.md",
      "dependsOn": [
        "UI-T04"
      ]
    },
    {
      "id": "UI-T06",
      "workstreamId": "UI",
      "path": "tasks/UI-T06.md",
      "dependsOn": [
        "UI-T02",
        "UI-T03",
        "UI-T04"
      ]
    },
    {
      "id": "UI-T07",
      "workstreamId": "UI",
      "path": "tasks/UI-T07.md",
      "dependsOn": [
        "UI-T02",
        "UI-T03",
        "UI-T04",
        "UI-T05",
        "UI-T06"
      ]
    },
    {
      "id": "UI-T08",
      "workstreamId": "UI",
      "path": "tasks/UI-T08.md",
      "dependsOn": [
        "UI-T02",
        "UI-T03"
      ]
    },
    {
      "id": "UI-T09",
      "workstreamId": "UI",
      "path": "tasks/UI-T09.md",
      "dependsOn": [
        "UI-T05",
        "UI-T06"
      ]
    },
    {
      "id": "UI-T10",
      "workstreamId": "UI",
      "path": "tasks/UI-T10.md",
      "dependsOn": [
        "UI-T06"
      ]
    },
    {
      "id": "UI-T11",
      "workstreamId": "UI",
      "path": "tasks/UI-T11.md",
      "dependsOn": [
        "UI-T02",
        "UI-T03",
        "UI-T04",
        "UI-T05"
      ]
    },
    {
      "id": "UI-T12",
      "workstreamId": "UI",
      "path": "tasks/UI-T12.md",
      "dependsOn": [
        "UI-T07"
      ]
    },
    {
      "id": "UI-T13",
      "workstreamId": "UI",
      "path": "tasks/UI-T13.md",
      "dependsOn": [
        "UI-T08",
        "UI-T09",
        "UI-T10",
        "UI-T11",
        "UI-T12"
      ]
    },
    {
      "id": "UI-T14",
      "workstreamId": "UI",
      "path": "tasks/UI-T14.md",
      "dependsOn": [
        "UI-T13"
      ]
    },
    {
      "id": "UI-T15",
      "workstreamId": "UI",
      "path": "tasks/UI-T15.md",
      "dependsOn": [
        "UI-T14"
      ]
    }
  ],
  "outcomeComparison": {
    "path": "outcome-comparison.md"
  },
  "authorization": {
    "checkpoint": {
      "localCommit": "denied",
      "amend": "denied"
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
    "ui-foundation": [
      "UI-GATE-SPECIMEN"
    ],
    "ui-selection": [
      "UI-GATE-SPECIMEN"
    ],
    "ui-overlay-navigation": [
      "UI-GATE-SPECIMEN"
    ],
    "ui-structured-content": [
      "UI-GATE-SPECIMEN"
    ],
    "ui-media-editing": [
      "UI-GATE-BOUNDARY"
    ],
    "ui-domain-views": [
      "UI-GATE-JOURNEY"
    ],
    "ui-gallery": [
      "UI-GATE-SPECIMEN"
    ],
    "ui-settings-shell": [
      "UI-GATE-JOURNEY"
    ],
    "ui-messaging": [
      "UI-GATE-JOURNEY"
    ],
    "ui-decisions": [
      "UI-GATE-JOURNEY"
    ],
    "ui-other-consumers": [
      "UI-GATE-JOURNEY"
    ],
    "ui-prototype-cutover": [
      "UI-GATE-BOUNDARY"
    ],
    "ui-foundation-cutover": [
      "UI-GATE-BOUNDARY"
    ],
    "ui-runtime-proof": [
      "UI-GATE-JOURNEY"
    ],
    "ui-usefulness": [
      "UI-GATE-USEFULNESS"
    ]
  },
  "completion": [
    "UI-GATE-BOUNDARY",
    "UI-GATE-JOURNEY",
    "UI-GATE-USEFULNESS"
  ],
  "full": []
}
```

## Execution policy

串行集成共享合同、包出口、锁文件和目录；就绪实现单元按实际能力闭包完成。每个单元先局部 source/functional，再 closure，不重复 provisioning。低层 engine 单独登记，产品业务 Oracle 留在既有 Owner。源码检查与 Gallery 不替代 native/receiver proof。
