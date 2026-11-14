# Recovery Identity Resilience 实施计划

> **Plan ID**: RIR-20261105
> **Version ID**: 20261105-recovery-identity-resilience-v3
> **Created**: 2026-11-05T00:00:00.000Z
> **Owner**: Architecture Team

本计划执行已接受的 SC-D31/SC-D32/SC-D33（修正案 v2.1，Owner 2026-11-05
接受，独立架构评审 DESIGN_REVIEW_PASS）。目标：恢复短语同时成为 Actor
身份根与内容恢复根，单设备擦除后凭短语重新 enroll 同一 PTID 并恢复私密
历史；僵尸设备可由属主在 Settings 一处撤销且类型化阻断不再泄漏受众成员；
恢复验收改走生产委托屏障。

Mobile 首跑备份引导是独立产品合同，不在本计划；本计划只交付架构与
Settings 级能力。签名 Android/iOS 发布证据、FINAL_CUT、推送/PR/合并/历史
重写均为非目标。所有 RG Gate（RG-1/3 需 harness iOS 模拟器与受控 Station、
RG-5 需 native desktop、RG-6 需受控 Station 与联邦对端、RG-2/4/7 需
harness iOS slice 与双模拟器）运行前都按具体 Profile/租约申请，本计划不授予
运行时权力；未运行一律 UNPROVEN。冻结基线存在一个与本计划无关的既有红测
（mobile `registry.test.ts` 的 `recovery.projection-stale` fixture，自
#141 起红），由独立修复处理，RIR 任务不得通过改动断言将其转绿。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "RIR-20261105",
  "versionId": "20261105-recovery-identity-resilience-v3",
  "createdAt": "2026-11-05T00:00:00.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/shared/security/secure-content/recovery-identity-resilience-amendment.md",
      "docs/architecture/shared/security/secure-content/design.md",
      "docs/architecture/shared/security/secure-content/decisions.md",
      "docs/architecture/shared/security/secure-content/security.md",
      "docs/architecture/shared/security/secure-content/data-model.md",
      "docs/architecture/shared/security/secure-content/integration.md",
      "docs/architecture/shared/security/secure-content/operations.md",
      "docs/architecture/domains/identity/unified-actor-system.md"
    ],
    "decisions": ["SC-D15", "SC-D16", "SC-D17", "SC-D20", "SC-D21", "SC-D27", "SC-D28", "SC-D29", "SC-D30", "SC-D31", "SC-D32", "SC-D33"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "apps", "mode": "exclusive-write"},
      {"pathPrefix": "model", "mode": "exclusive-write"},
      {"pathPrefix": "packages", "mode": "exclusive-write"},
      {"pathPrefix": "tooling", "mode": "exclusive-write"},
      {"pathPrefix": "docs", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "Mobile first-run backup onboarding product Journey and copy",
      "server-side device liveness, last-seen, or automatic endpoint demotion",
      "silent skipping of depleted active devices during private prepare",
      "recovery of content sealed before any recovery pool existed",
      "federation peer contract enrichment beyond aggregate error codes",
      "post-compromise secret sharing or hardware key custody",
      "signed Android/iOS release evidence and FINAL_CUT",
      "push, pull request, merge, history rewrite, or deployment"
    ]
  },
  "tasks": [
    {"id": "RIR-01", "workstreamId": "VAULT", "path": "tasks/RIR-01.md", "dependsOn": []},
    {"id": "RIR-02", "workstreamId": "CORE", "path": "tasks/RIR-02.md", "dependsOn": []},
    {"id": "RIR-05", "workstreamId": "BLOCKING", "path": "tasks/RIR-05.md", "dependsOn": []},
    {"id": "RIR-03", "workstreamId": "DESKTOP", "path": "tasks/RIR-03.md", "dependsOn": ["RIR-01", "RIR-02"]},
    {"id": "RIR-04", "workstreamId": "MOBILE", "path": "tasks/RIR-04.md", "dependsOn": ["RIR-01", "RIR-02"]},
    {"id": "RIR-06", "workstreamId": "DEVICES", "path": "tasks/RIR-06.md", "dependsOn": ["RIR-05"]},
    {"id": "RIR-07", "workstreamId": "JOURNEYS", "path": "tasks/RIR-07.md", "dependsOn": ["RIR-03", "RIR-04"]},
    {"id": "RIR-08", "workstreamId": "CUTOVER", "path": "tasks/RIR-08.md", "dependsOn": ["RIR-07"]}
  ],
  "outcomeComparison": {"path": "outcome-comparison.md"},
  "authorization": {
    "checkpoint": {"localCommit": "allowed", "amend": "allowed"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": [], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  }
}
```

## 依赖与原子切换

```text
RIR-01 Station 身份保险库 ──┐
RIR-02 portable 生命周期 ──┼─> RIR-03 Desktop 纵切 ──┐
RIR-05 类型化阻断 ────────┼─> RIR-04 Mobile 纵切 ───┼─> RIR-07 真机 Journeys ─> RIR-08 clean-cut
RIR-05 ─> RIR-06 双端设备管理（独立轨道，不阻塞 Journeys）
```

RIR-03/04 与 RIR-06 在 apps/desktop、apps/mobile、packages/locales 写集上
重叠：执行期 RIR-06 park 至 03/04 合入后再取，或由同一 Progress Slice 串行
持有，禁止并行改同一文件。

原子切割（均为 clean-cut，回滚=版本控制 revert 切割提交，无运行时开关）：

- RIR-03：删除 `messaging_recovery_create_revision/restore_latest` 的 master
  播种分支与 `messaging_recovery_acceptance_create_revision` 随机生成器；
  归档转为 READY 消费者。同一原子提交必须改完 fixture owner
  (`tooling/development/secure_content/runtime_owner.py`) 对生成/建备份/恢复
  命令的引导调用，并更新断言旧恢复顺序的已注册 Gate
  `chat-native-visible-static`，否则该切割提交不得落地。
- RIR-04：`social_private_acceptance_prepare_keys` 随机路径替换为确定性
  短语注入；新增 native secure-view 防截屏插件；Mobile
  `messaging_recover_identity_with_native_input` 的 archive seed 恢复路径
  重接为 vault-first（同 PTID re-enroll 后才允许归档水合）。
- RIR-05：阻断身份只进新 typed protobuf；联邦对端仍 code-only。
- RIR-06：桌面既有 `device_revoke`（自撤销）与 `device_list`/TS
  `deviceService` 收敛：保留自撤销命令语义，跨设备能力改由新增
  `device_manage_revoke_other/list` 承担，旧 device_list 入口在同一提交改型
  或退役，禁止双设备管理面并存。
- RIR-08：结构性 source gate 证明双端生产构建无任何隐式短语生成器；修正案
  折入 canonical 文档后删除并行叙述。

## Acceptance Execution

```json
{
  "closures": {
    "rir-vault": [],
    "rir-core": [],
    "rir-blocking": ["rg6-opaque-remote-blocking"],
    "rir-desktop": ["rg5-desktop-convergence"],
    "rir-mobile": ["rg1-fresh-device"],
    "rir-devices": ["rg3-zombie-non-blocking"],
    "rir-journeys": ["rg2-reinstall-survival", "rg4-rotation-history", "rg7-clean-archive-restore"],
    "rir-cutover": []
  },
  "completion": ["rg1-fresh-device", "rg2-reinstall-survival", "rg3-zombie-non-blocking", "rg4-rotation-history", "rg5-desktop-convergence", "rg6-opaque-remote-blocking", "rg7-clean-archive-restore"],
  "full": []
}
```

开发期 focused checks 不能替代正式 Gate；未运行的 Gate 保持 UNPROVEN。
RG-8 为结构性 source gate，由 RIR-08 的 STRUCTURAL_CHECK 证明，不是正式
Acceptance Gate。实际效果登记于
[outcome-comparison.md](./outcome-comparison.md)，初始全部 UNPROVEN。

## 审查输入

审查纵向闭环、producer/consumer 顺序、vault 防回滚与证明包装、prescan
行锁与差分隐私、归档/生成器删除清单、RG Gate 的 exact-source 形态、
五维效果、授权边界与 bounded budget。accepted sources 能裁决的问题由当前
Run 修正，例行审查不再次提交用户。
