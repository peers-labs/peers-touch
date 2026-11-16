# Profile 资源 ID 分配、共享与覆盖执行计划

> **Plan ID**: LDCP-RES-20261114
> **Version ID**: 20261115-profile-resource-id-sharing
> **Created**: 2026-11-15T00:00:00.000Z
> **Owner**: Platform Team

本版本按用户明确修订替换原数量导向候选。旧 package 原样归档，不参与当前
执行输入。当前完成的是架构/计划修订，资源运行代码和原生证明尚未执行。

## 用户指定的执行目标

> 不需要强调复用，由用户指定需要给每个profile分配几台，profile内自由安排。
> 按id来区分，不是按数量，因为可能多profile共用，彼此知道在共用即可，
> 覆盖时显式通知用户是否强制覆盖。

目标来自用户原话：用户分配 Profile 的资源 ID 集合，内部场景自由安排；
共享同一 ID 的各方看见引用关系和实际内容；覆盖时告知影响并消费该次明确
force/decline 决定。未新增数量上限、固定角色、自动选择或 blanket force。
既有 Station connect-only、物理锁、源校验及实例恢复所有者继续适用。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "LDCP-RES-20261114",
  "versionId": "20261115-profile-resource-id-sharing",
  "createdAt": "2026-11-15T00:00:00.000Z",
  "workClass": "infrastructure",
  "architecture": {
    "sources": [
      "docs/architecture/engineering/local-dev/README.md",
      "docs/architecture/engineering/local-dev/design.md",
      "docs/architecture/engineering/local-dev/decisions.md",
      "docs/architecture/engineering/local-dev/data-model.md",
      "docs/architecture/engineering/local-dev/integration.md",
      "docs/architecture/engineering/local-dev/module-layout.md"
    ],
    "decisions": ["LDCP-D03", "LDCP-D05", "LDCP-D17", "LDCP-D21", "LDCP-D23", "LDCP-D25", "LDCP-D26"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "tooling/scripts/local-dev", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/lib/machine-dev-paths.mjs", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/lib/machine-dev-paths.test.mjs", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/make/local-dev.mk", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile/scripts/ios-dev-sim.sh", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile", "mode": "shared-read"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/acceptance-run.py", "mode": "shared-read"},
      {"pathPrefix": "tooling/scripts/acceptance-validate.py", "mode": "shared-read"},
      {"pathPrefix": "tooling/devctl", "mode": "shared-read"},
      {"pathPrefix": "docs/architecture/engineering/local-dev", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/architecture-governance/architecture-modules.json", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/acceptance", "mode": "shared-read"},
      {"pathPrefix": "docs/global/local-dev-environment.md", "mode": "exclusive-write"},
      {"pathPrefix": "docs/global/workflow.md", "mode": "shared-read"},
      {"pathPrefix": "docs/knowledge", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/skills/pt-local-dev-env", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/skills/pt-dev-runtime-handoff", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/skills/pt-dev-workflow", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/skills/pt-debug-space-clean", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "默认设备数量、整机硬编码数量上限、固定客户端角色或按数量推断身份",
      "部署、重启或 reset four 及其他 Station",
      "停止用户/其他 agent 进程、接管或删除历史设备",
      "本次设计指令作为任何实际覆盖的 blanket force 授权",
      "修改兄弟 env 仓、发明拓扑或写机器 UUID 到共享 Profile",
      "改变业务凭据所有权或声称 Android 资源证明",
      "第二控制面、Profile schema、PlanMount 或 task 授权门",
      "提交、推送、PR、发布或 worktree 生命周期操作"
    ]
  },
  "tasks": [
    {"id": "RES-01", "workstreamId": "RESOURCE-IDS", "path": "tasks/RES-01.md", "dependsOn": []},
    {"id": "RES-02", "workstreamId": "OVERWRITE", "path": "tasks/RES-02.md", "dependsOn": ["RES-01"]},
    {"id": "RES-03", "workstreamId": "MOBILE-RUN", "path": "tasks/RES-03.md", "dependsOn": ["RES-02"]},
    {"id": "RES-04", "workstreamId": "ACCEPTANCE-IDS", "path": "tasks/RES-04.md", "dependsOn": ["RES-03"]},
    {"id": "RES-05", "workstreamId": "RESOURCE-PROOF", "path": "tasks/RES-05.md", "dependsOn": ["RES-04"]}
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

## 垂直闭环与原子切换

| 闭环 | 输入到可验证结果 | 当前源码依据 |
|------|------------------|--------------|
| RES-01 | 用户选择 Profile/IDs → assignment → ID binding/共享视图 | `machine-dev-registry.mjs`、`machine-dev.mjs`、原 Profile parser |
| RES-02 | 覆盖意图 → 具体告知 → force/decline → 锁后重验 → 结果/恢复 | `machine-dev-lease.py`、现有源校验和 provider 边界 |
| RES-03 | 场景选择 ID → 两入口 → native/source readback | `mobile-ios-sim.sh`、`ios-dev-sim.sh`；原 Ensure Station deploy 分支 |
| RES-04 | Suite 引用 ID → 共享/覆盖处理 → owned session 收尾 | `mobile_simulator.py` base/selected/layout、`core/provisioner.py` cleanup |
| RES-05 | 完整 consumer cut → source/provider/native proof → 效果回填 | 原 owner self Gate、native Harness、simctl/目录读回 |

RES-01/02 先交付内部完整操作。RES-03 原子切换两个手动入口；RES-04 原子切换
全部 iOS Provisioner，并删除 direct create/select/cleanup fallback。同一切换
包含原测试、文档、知识、Skills 和对应 functional 检查。角色是 Profile 内标签。
未完成全部 consumer cut 前，不声明唯一资源所有者已实现。

释放 lease、Profile detach 与物理 delete 分开。一个 Profile/Suite 结束不得
清除共享设备或别人内容。cleanup 机制修改先普通单测、再独立 provider/data
oracle、最后 native Journey，通过后才删除旧机制。回滚为原子 cut 的 VCS
revert；当前未授权创建 commit。

## 覆盖与 Runtime 范围

共享/inspect/同内容无冲突操作无需覆盖提示。冲突先说明 ID、共享方、当前/
目标内容、数据与活跃会话影响；未响应、拒绝或取消不变更。force 只允许该次
确认操作，锁后影响变化重新通知。用户这次设计要求不授权实际覆盖或进程停止。

four 继续手动验收，Station 由另一 agent 负责。逻辑测试用 private registry/
fake provider，标明不算 native 证明。native Gate 使用 canonical machine ID/锁
及显式选定、当前测试拥有的 fixture 资源，不借 evidence root 建第二 owner。
测试共享 Profiles 是明确 fixture，不能给真实用户资源伪造 force。
缺兼容/空闲 ID 或必要覆盖决定时准确标记未证实，继续独立源码工作。
本计划不自动设置 live Profile 分配，不修改共享 env。

## Acceptance Execution

```json
{
  "closures": {
    "resource-id-assignment": [],
    "resource-overwrite": [],
    "mobile-id-binding": [],
    "acceptance-id-sharing": [],
    "resource-proof": ["machine-dev-registry-self", "profile-resource-id-sharing-native-e2e", "profile-resource-overwrite-native-e2e"]
  },
  "completion": ["machine-dev-registry-self", "profile-resource-id-sharing-native-e2e", "profile-resource-overwrite-native-e2e"],
  "full": ["machine-dev-registry-self", "profile-resource-id-sharing-native-e2e", "profile-resource-overwrite-native-e2e"]
}
```

两个 native Gate 和 functional driver 是待交付项，尚未登记/实现。RES-05
登记并映射 LDCP-R01 至 R09：用户分配、共享、锁、恢复、数据/保留、connect-only、
detach/release/delete、覆盖决定和竞态。唯一 Acceptance Execution 不扩张为
所有 Mobile/Android 证明。计划/图/链接通过不等于 runtime 通过。
