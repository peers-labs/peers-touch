# 统一客户端架构实施计划

> **Plan ID**: UCA-20261017
> **Version ID**: 20261020-simulator-smoke-environment-closure
> **Created**: 2026-10-19T16:52:14.000Z
> **Owner**: Client Platform Team

本计划把已经接受的 Cross-Client Runtime 架构落实到 Desktop、Android、iOS
三个发布目标。它只冻结实施模型，不表示实现已完成，也不授权 push、PR、发布、
数据重置或历史改写。本地 checkpoint commit 已获批准；用户后续明确选择的
`two` runtime operation 以该 Profile 和 machine binding 为准。

## 目标与完成口径

完成后必须同时成立：

1. Desktop 与 Mobile 是两个 Client Form；Android 与 iOS 只是一个 Mobile
   产品的两个 Host，不再拥有平行业务语义。
2. 平台身份、构建、能力事实和 Host adapter 均绑定真实 release target。
3. Messaging 与 Secure Content 的 host-neutral 语义各只有一个
   canonical owner；Desktop/Mobile 只保留 typed host adapter。
4. renderer-neutral TypeScript 状态、DTO、selector 和实体语义复用现有共享包，
   Desktop/Mobile Presentation Policy 保持独立。
5. 架构完成由当前源码的 Desktop native、Android Emulator、iOS Simulator
   冒烟证明；推送 provider 与物理设备发布证明不属于本次完成口径。

人类可读的执行前后差异见
[outcome-comparison.md](./outcome-comparison.md)。其计划区进入
`planVersionDigest`，实际结果区在实施中按 current-source evidence 回填。机器约束
仍由下方 Plan Version、Task Slice 的 `doneWhen` 和 Acceptance Execution 承担。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "UCA-20261017",
  "versionId": "20261020-simulator-smoke-environment-closure",
  "createdAt": "2026-10-19T16:52:14.000Z",
  "workClass": "refactor",
  "architecture": {
    "sources": [
      "docs/architecture/platform/client/cross-client-runtime/README.md",
      "docs/architecture/platform/client/cross-client-runtime/design.md",
      "docs/architecture/platform/client/cross-client-runtime/decisions.md",
      "docs/architecture/platform/client/cross-client-runtime/data-model.md",
      "docs/architecture/platform/client/cross-client-runtime/module-layout.md",
      "docs/architecture/platform/client/cross-client-runtime/integration.md",
      "docs/architecture/platform/client/mobile/design.md",
      "docs/architecture/platform/client/mobile/decisions.md",
      "docs/architecture/domains/chat/messaging/README.md",
      "docs/architecture/domains/chat/messaging/decisions.md",
      "docs/architecture/shared/security/secure-content/README.md",
      "docs/architecture/shared/security/secure-content/decisions.md",
      "docs/architecture/shared/security/secure-content/design.md",
      "docs/architecture/shared/security/secure-content/module-layout.md",
      "docs/architecture/shared/security/secure-content/integration.md",
      "docs/architecture/engineering/development-workflow/decisions.md"
    ],
    "decisions": [
      "CCR-D01", "CCR-D02", "CCR-D03", "CCR-D04", "CCR-D05", "CCR-D06",
      "CCR-D07", "CCR-D08", "CCR-D09", "CCR-D10", "CCR-D11", "CCR-D12",
      "CCR-D13",
      "MS-D01", "MS-D02", "MS-D07", "MS-D08", "MS-D09", "MS-D17",
      "MS-D23", "MS-D23A", "MS-D23B", "MS-D24", "MS-D26", "MS-D28",
      "MP-D01", "MP-D10", "MP-D12", "MP-D16", "MP-D25", "MP-D31",
      "SC-D01", "SC-D02", "SC-D10", "SC-D17", "SC-D18", "SC-D30",
      "DWF-D48"
    ]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "Makefile", "mode": "shared-read"},
      {"pathPrefix": "package.json", "mode": "exclusive-write"},
      {"pathPrefix": "pnpm-workspace.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station", "mode": "shared-read"},
      {"pathPrefix": "model", "mode": "shared-read"},
      {"pathPrefix": "packages/client-chat-core", "mode": "exclusive-write"},
      {"pathPrefix": "packages/client-media-security", "mode": "exclusive-write"},
      {"pathPrefix": "packages/client-storage", "mode": "exclusive-write"},
      {"pathPrefix": "packages/messaging-core", "mode": "exclusive-write"},
      {"pathPrefix": "packages/secure-content-core", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/domains/chat/messaging", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/architecture-governance", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/platform/client/cross-client-runtime", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/platform/client/mobile", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/shared/security/secure-content", "mode": "exclusive-write"},
      {"pathPrefix": "docs/client/common", "mode": "exclusive-write"},
      {"pathPrefix": "docs/client/mobile", "mode": "exclusive-write"},
      {"pathPrefix": "docs/context/implementation-reports", "mode": "shared-read"},
      {"pathPrefix": "docs/knowledge", "mode": "shared-read"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/deploy/source_sync.py", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/acceptance-run.py", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/architecture", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/uca_smoke", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "新增与架构收敛无关的 Chat、Social 或 Applet 产品功能",
      "强求 Desktop 与 Mobile 像素或交互完全一致",
      "把 Rust Core 变成 daemon、sidecar、网络服务或跨设备业务 authority",
      "改变 Station 业务真源或 Model wire contract 的既有 authority",
      "保留新旧内部 owner、双写、兼容 facade 或永久 feature flag",
      "用 iOS 结果代替 Android，或用共享单测代替对应 Host 的模拟器冒烟",
      "验收 APNs、FCM、物理设备签名、OEM 调度器或真实硬件传感器行为",
      "实现 Mobile Applet Runtime；其 Kernel owner 冲突必须先通过独立 Applet architecture amendment 解决",
      "在 UCA Task 中继续修改 Development Workflow 或 Outcome Comparison schema",
      "生产发布、push、Pull Request、远程部署、数据重置或历史改写"
    ]
  },
  "tasks": [
    {"id": "UCA-01", "workstreamId": "PLATFORM-BASELINE", "path": "tasks/UCA-01.md", "dependsOn": []},
    {"id": "UCA-02", "workstreamId": "ANDROID-HOST", "path": "tasks/UCA-02.md", "dependsOn": ["UCA-01"]},
    {"id": "UCA-03", "workstreamId": "IOS-HOST", "path": "tasks/UCA-03.md", "dependsOn": ["UCA-01"]},
    {"id": "UCA-05A", "workstreamId": "SECURE-CONTENT-CORE", "path": "tasks/UCA-05A.md", "dependsOn": ["UCA-01"]},
    {"id": "UCA-04A", "workstreamId": "MESSAGING-CORE", "path": "tasks/UCA-04A.md", "dependsOn": ["UCA-01", "UCA-05A"]},
    {"id": "UCA-04", "workstreamId": "MESSAGING-CORE", "path": "tasks/UCA-04.md", "dependsOn": ["UCA-02", "UCA-03", "UCA-04A"]},
    {"id": "UCA-05", "workstreamId": "SECURE-CONTENT-CORE", "path": "tasks/UCA-05.md", "dependsOn": ["UCA-04", "UCA-05A"]},
    {"id": "UCA-06", "workstreamId": "SHARED-CLIENT-SEMANTICS", "path": "tasks/UCA-06.md", "dependsOn": ["UCA-05"]},
    {"id": "UCA-08", "workstreamId": "ARCHITECTURE-PROOF", "path": "tasks/UCA-08.md", "dependsOn": ["UCA-02", "UCA-03", "UCA-06"]}
  ],
  "outcomeComparison": {
    "path": "outcome-comparison.md"
  },
  "authorization": {
    "checkpoint": {"localCommit": "allowed", "amend": "allowed"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": ["two"], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  }
}
```

## 实施模型

1. **UCA-01 冻结真实基线。** 先统一 release target 身份、能力登记、构建矩阵和
   evidence cell；后续任务不得继续读取 `ios_first` 或静态平台常量。
2. **UCA-02 / UCA-03 关闭 Host 边界。** 两项可并行，但共享接口改动由
   UCA-01 owner 串行合入。Android 与 iOS 只实现同一 port contract。
3. **UCA-04A / UCA-05A 完备 portable core。** 只实现 host-neutral mechanism
   和 typed ports，不激活第二生产 owner。
4. **UCA-04 / UCA-05 执行 native hard cut。** 原子切换消费者、迁移本地 schema，
   再删除两端旧 owner；共享入口重叠使两项串行执行。
5. **UCA-06 收敛 renderer-neutral 语义。** 复用现有 `client-*` 包；只在实体
   anatomy 与交互合同均 policy-neutral 时共享 UI，Desktop/Mobile shell 不合并。
6. **UCA-08 做架构冒烟收口。** 旧 owner 引用归零后，以同一当前源码完成
   Desktop native、Android Emulator、iOS Simulator 的构建、启动、生命周期和
   adapter 冒烟，再更新 Outcome Comparison 并形成完成判断。

UCA-02、UCA-03、UCA-04 和 UCA-05 的冒烟只验证架构改动面。模拟器构建、安装和
启动按平台各执行一次，并在结束后清理本次持有的进程和设备状态。任一实现任务发现
源码缺陷时回到对应 owner 修复，不能在 UCA-08 旁增加兼容补丁。

## Hard Cut 与迁移规则

- 内部 owner 变更采用原子 hard cut：一个当前 owner、一个 store policy、一个
  recovery/reconciliation 语义，旧模块和引用同批删除。
- 已发布 wire、持久数据、deep link 和 plugin contract 单独执行显式版本迁移；
  不以内部清理为理由破坏外部兼容。
- 每个 Task 开始前必须从当前源码生成消费者与旧 owner inventory，并冻结精确
  changed-file allowlist。目录级 source claim 只是上限。
- 平台降级必须成为 typed capability fact 与 admission projection，不能隐藏为成功。
- UCA-08 只执行 bounded source checks 与三端冒烟，不调用 Completion、Full 或
  release aggregate，也不补跑与本 Plan 无关的 Acceptance。
- `outcome-comparison.md` 的计划区冻结；实际结果只在相应 Task `doneWhen` 和 Gate
  均满足后改为 `PASS`，未执行或过期证据保持 `UNPROVEN`。

## Acceptance Execution

下列 Gate 只保留可直接证明 canonical owner、hard-cut 和 shared semantics 的
聚焦源码闭环。Desktop、Android Emulator、iOS Simulator 冒烟属于 Task 的
`FUNCTIONAL_CHECK`，不升级为 Completion、Full 或发布 Acceptance。

```json
{
  "closures": {
    "uca-platform-baseline": [],
    "uca-android-host": [],
    "uca-ios-host": [],
    "uca-messaging-core-contract": ["unified-client-messaging-core-contract"],
    "uca-messaging-core": ["messaging-owner-hard-cut-zero"],
    "uca-secure-content-core-contract": ["secure-content-portable-core"],
    "uca-secure-content-core": ["secure-content-owner-hard-cut-zero"],
    "uca-shared-client-semantics": ["unified-client-shared-semantics"],
    "uca-architecture-proof": []
  },
  "completion": ["unified-client-messaging-core-contract", "messaging-owner-hard-cut-zero", "secure-content-portable-core", "secure-content-owner-hard-cut-zero", "unified-client-shared-semantics"],
  "full": []
}
```

## 审批边界

用户已于 2026-10-20 批准恢复 UCA 实施、使用模拟器冒烟完成当前 Plan，并允许本地
checkpoint commit。该批准不授权 push、PR、发布、远程部署、数据重置、历史改写
或将冒烟结论扩大为物理设备与推送发布证明。
