# Device Login Approval 实施计划

> **Plan ID**: DLA-20261112
> **Version ID**: 20261112-device-login-approval
> **Created**: 2026-11-12T01:00:00.000Z
> **Owner**: Identity and Access

用户于 2026-11-12 接受 DLA-D01 至 DLA-D08 架构决策。本计划把 claimant-first
登录模型交付为七个垂直闭环：新设备凭据登录后在登录卡等待，同 Actor 任意已登录
设备全局弹窗审批，HPKE 交付 Actor seed 后经 Access 重裁进入独立 Session；
24 词恢复短语降为折叠兜底，chat 恢复硬门禁移除。
本计划不授权提交、推送、PR、合并或发布。邮箱挑战（DLA-D07）与 Station 推送
扇出（DLA-D08）不在本计划范围。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "DLA-20261112",
  "versionId": "20261112-device-login-approval",
  "createdAt": "2026-11-12T01:00:00.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/domains/identity/device-login-approval/README.md",
      "docs/architecture/domains/identity/device-login-approval/design.md",
      "docs/architecture/domains/identity/device-login-approval/decisions.md",
      "docs/architecture/domains/identity/device-login-approval/data-model.md",
      "docs/architecture/domains/identity/device-login-approval/module-layout.md",
      "docs/architecture/domains/identity/device-login-approval/integration.md",
      "docs/architecture/domains/identity/mobile-scan-login/design.md",
      "docs/architecture/domains/identity/mobile-scan-login/decisions.md",
      "docs/architecture/platform/station/access/design.md",
      "docs/architecture/domains/identity/unified-actor-system.md"
    ],
    "decisions": ["DLA-D01", "DLA-D02", "DLA-D03", "DLA-D04", "DLA-D05", "DLA-D06", "DLA-D07", "DLA-D08", "MSL-D01", "MSL-D02", "MSL-D03", "MSL-D05", "MSL-D06", "MSL-D07", "SAL-D01", "SAL-D02", "SAL-D03", "SAL-D04", "SAL-D06", "SAL-D07", "SAL-D08", "SAL-D12", "SAL-D14", "SAL-D15"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "apps", "mode": "exclusive-write"},
      {"pathPrefix": "model", "mode": "exclusive-write"},
      {"pathPrefix": "packages", "mode": "exclusive-write"},
      {"pathPrefix": "docs", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts", "mode": "exclusive-write"},
      {"pathPrefix": "pnpm-lock.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "pnpm-workspace.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "package.json", "mode": "exclusive-write"},
      {"pathPrefix": "Makefile", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "邮箱挑战/OTP 与邮件投递基础设施（DLA-D07 待建能力，独立排期）",
      "Station 审批请求推送扇出与杀进程实时送达（DLA-D08 后置）",
      "历史消息、ratchet、MLS state 或 Recovery master 迁移",
      "删除二维码扫码路径，其保留为私有 Station 网络引导备用入口",
      "修改 Acceptance Core 或工作流框架",
      "提交、推送、PR、合并、发布和其他工作区写入"
    ]
  },
  "tasks": [
    {"id": "DLA-01", "workstreamId": "STATION-CORE", "path": "tasks/DLA-01.md", "dependsOn": []},
    {"id": "DLA-02", "workstreamId": "STATION-ACCESS", "path": "tasks/DLA-02.md", "dependsOn": ["DLA-01"]},
    {"id": "DLA-03", "workstreamId": "DESKTOP-NATIVE", "path": "tasks/DLA-03.md", "dependsOn": ["DLA-02"]},
    {"id": "DLA-04", "workstreamId": "DESKTOP-SURFACE", "path": "tasks/DLA-04.md", "dependsOn": ["DLA-03"]},
    {"id": "DLA-05", "workstreamId": "MOBILE-NATIVE", "path": "tasks/DLA-05.md", "dependsOn": ["DLA-02"]},
    {"id": "DLA-06", "workstreamId": "MOBILE-SURFACE", "path": "tasks/DLA-06.md", "dependsOn": ["DLA-05"]},
    {"id": "DLA-07", "workstreamId": "PROOF", "path": "tasks/DLA-07.md", "dependsOn": ["DLA-04", "DLA-06"]}
  ],
  "outcomeComparison": {"path": "outcome-comparison.md"},
  "authorization": {
    "checkpoint": {"localCommit": "denied", "amend": "denied"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": [], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  }
}
```

## 依赖与原子切换

DLA-01 先落协议与 Station 事务核心；DLA-02 把事务接入 Access 求值与 HTTP 两面，
策略开关默认关闭，不改变现状行为。DLA-03/DLA-05 分别在 Desktop/Mobile native
层复用 device-link-core 落地双角色能力，可并行。DLA-04/DLA-06 落地两端表面，
其中 chat 恢复硬门禁删除以前置原生 Journey 证明“审批登录后引擎 active”为条件。
DLA-07 注册并运行三条原生 Gate，模块文档转 active 并登记 registry。

原子切换：Access 设备审批要求以 Station 策略开关灰度，开启后新登记设备走审批，
存量会话不回溯；MessagingRecoveryGate 的删除是 clean-cut，回滚依赖 cut commit
的 VCS revert，不保留 chat 双门禁；扫码路径不删除，无双重事务真相。
每个任务细化精确改动路径，目录 claim 只作为范围上限。

## Acceptance Execution

```json
{
  "closures": {
    "dla-protocol": [],
    "dla-access": [],
    "dla-desktop-native": [],
    "dla-desktop-surface": [],
    "dla-mobile-native": [],
    "dla-mobile-surface": [],
    "dla-proof": [
      "dla-approval-cross-device-native-e2e",
      "dla-approval-failure-semantics-native-e2e",
      "dla-chat-recovery-gate-removed-e2e"
    ]
  },
  "completion": [
    "dla-approval-cross-device-native-e2e",
    "dla-approval-failure-semantics-native-e2e",
    "dla-chat-recovery-gate-removed-e2e"
  ],
  "full": []
}
```

新 Gate 在 DLA-07 经既有验收合同注册；未运行格保持 UNPROVEN，聚焦 FUNCTIONAL_CHECK
不得替代正式 Acceptance 证明。本次不执行 full/release 或无关 aggregate。
实际效果登记于 [outcome-comparison.md](./outcome-comparison.md)，初始全部 UNPROVEN。

## 审查输入

审查垂直闭环、producer/consumer 顺序、Access/Session/Actor Identity 端口边界、
chat 门禁删除前置条件、持票面限流与失败语义、五维效果、授权边界与 bounded budget。
accepted sources 能裁决的问题由当前 Run 修正，例行审查不再次提交用户。
