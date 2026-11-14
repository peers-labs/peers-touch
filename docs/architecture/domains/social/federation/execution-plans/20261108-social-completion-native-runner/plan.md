# Social 能力与交互闭合计划

> **Plan ID**: AFL-20261106
> **Version ID**: 20261108-social-completion-native-runner
> **Created**: 2026-11-08T00:00:00.000Z
> **Owner**: Social / Federation / Desktop / Mobile

继承 [原计划](../20261106-actor-feed-log/plan.md) 的完整交付口径、
钉版 glass 原型和 AD-08 公开单设备/私密原 E2EE 边界。原版本与计划区 digest
保持冻结。本版本将剩余交互、完整产品化与真实证明组织为六个顺序闭合。
用户已确认 [交互合同](../../interaction-completion.md) 和本地 checkpoint。
不从 Plan、源码检查或空 Gate 选择推导实现或产品完成。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "AFL-20261106",
  "versionId": "20261108-social-completion-native-runner",
  "createdAt": "2026-11-08T00:00:00.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": ["docs/architecture/domains/social/federation/actor-feed-log.md", "docs/architecture/domains/social/federation/interaction-completion.md", "docs/architecture/domains/social/federation/decisions.md", "docs/architecture/domains/social/core/moments.md", "docs/client/desktop/runtime-projections.md"],
    "decisions": ["AD-08", "D-08"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "model/domain/social", "mode": "exclusive-write"},
      {"pathPrefix": "model/domain/federation", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/app/subserver/social", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/app/subserver/actor_identity", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/app/subserver/federation", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/frame", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile", "mode": "exclusive-write"},
      {"pathPrefix": "packages/station-trust", "mode": "exclusive-write"},
      {"pathPrefix": "packages/ui", "mode": "exclusive-write"},
      {"pathPrefix": "packages/locales", "mode": "exclusive-write"},
      {"pathPrefix": "packages/prototypes", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/development", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/domains/social", "mode": "exclusive-write"},
      {"pathPrefix": "docs/client", "mode": "exclusive-write"},
      {"pathPrefix": "docs/knowledge", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/api-governance", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/plugins/pt-ew-plugin", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/local-dev", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/shared/security/secure-content/operations.md", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station", "mode": "shared-read"},
      {"pathPrefix": "packages/secure-content-core", "mode": "shared-read"},
      {"pathPrefix": "docs/architecture/shared/security", "mode": "shared-read"}
    ],
    "nonGoals": ["AD-08 延期的多设备合流、毁站回灌与私密子链", "Mobile 公开签名写入与新 Moments UI", "ActivityPub、共识/token/gossip、Station 代签", "无关 Agent、Chat、OAuth 与 official-site 改动", "push、PR、发布、生产数据重置、历史改写、worktree 生命周期"]
  },
  "tasks": [
    {"id": "IC-01", "workstreamId": "COMMENT-REACTIONS", "path": "tasks/IC-01.md", "dependsOn": []},
    {"id": "IC-02", "workstreamId": "PUBLIC-POLLS", "path": "tasks/IC-02.md", "dependsOn": ["IC-01"]},
    {"id": "IC-03", "workstreamId": "PRIVATE-POLLS", "path": "tasks/IC-03.md", "dependsOn": ["IC-02"]},
    {"id": "IC-04", "workstreamId": "MOBILE-SEARCH", "path": "tasks/IC-04.md", "dependsOn": ["IC-03"]},
    {"id": "IC-05", "workstreamId": "PRODUCT-FAULT-PROOF", "path": "tasks/IC-05.md", "dependsOn": ["IC-04"]},
    {"id": "IC-06", "workstreamId": "COMPLETION-AUDIT", "path": "tasks/IC-06.md", "dependsOn": ["IC-05"]}
  ],
  "outcomeComparison": {"path": "outcome-comparison.md"},
  "authorization": {
    "checkpoint": {"localCommit": "allowed", "amend": "denied"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": [], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  }
}
```

## Acceptance Execution

每次开发先跑一个明确的原 Gate，使用 `--execution-policy development`。
FUNCTIONAL_CHECK 通过后执行所选 formal closure 一次。IC-06 审计既有当前源码
证据，缺口只由责任 Task 回补；`full` 为可选择模型，不授权 full/release 运行。
同一 Gate 覆盖多项风险时复用一次 Suite 及其源绑定证据。

Desktop Native 命令显式选择 `desktop-macos-native`，逻辑 Station 角色绑定为
`station-four=fiveArm`、`station-five-arm=four`；Machine Dev 保留工作区 slot。
每个开发命令携带本 Task 的 `--work-item`。Mobile 继续由其已登记准备 Owner
解析平台资源，不把 Desktop Cell 强加给 Mobile。

Private 九场景由 `social-cross-station-native-e2e` 唯一生产。
`social-private-desktop-e2e` 和 functional consumer 通过 execution graph 复用
本次已清理、封存的原始 manifest/result；不发现历史结果或克隆证据。
一次准备、三次启动、最多两窗，Eve 仅 fixture，Bob2 替换 Bob。
schema 准备先于 retained leases，角色映射保留物理 attestation 和 provenance。
运行合同及代码入口见 [Cross-Station Integration](../../../cross-station/integration.md#6-acceptance-integration)。
本版本保留 [上一冻结版本](../20261108-social-completion/plan.md) 与全部计划效果摘要。

```json
{
  "closures": {
    "comment-reactions": ["social-public-feed-source", "social-public-feed-native-e2e", "social-cross-station-interaction", "social-private-desktop-e2e"],
    "public-polls": ["social-public-feed-source", "social-public-feed-native-e2e"],
    "private-polls": ["social-cross-station-interaction", "social-private-desktop-e2e"],
    "mobile-search": ["social-content-search-contract", "social-content-search-mobile-native-e2e", "mobile-simulator-moments-e2e", "mobile-native-moments-e2e"],
    "product-fault-proof": ["social-public-feed-source", "social-public-feed-native-e2e", "social-private-desktop-e2e", "station-api-ownership"],
    "completion-audit": ["social-public-feed-source", "station-api-ownership"]
  },
  "completion": ["social-public-feed-source", "social-public-feed-native-e2e", "social-private-desktop-e2e", "social-cross-station-interaction", "social-content-search-contract", "social-content-search-mobile-native-e2e", "mobile-simulator-moments-e2e", "mobile-native-moments-e2e", "station-api-ownership"],
  "full": ["social-public-feed-source", "social-public-feed-native-e2e", "social-private-desktop-e2e", "social-cross-station-interaction", "social-content-search-contract", "social-content-search-mobile-native-e2e", "mobile-simulator-moments-e2e", "mobile-native-moments-e2e", "station-api-ownership"]
}
```

## 不留遗留的完成边界

原 AFL-O01/O02/O04/O06/O07/O08/O09/O10/O13/O14/O15 全部保留到
[效果合同](./outcome-comparison.md)。IC-A01..06 覆盖评论/投票、权限/恢复、
故障、Mobile Search 和真实延迟。旧 unsigned vote、假动作、平行 Store、
未迁移生成消费者和失效 Task 命令不得保留。
本地 checkpoint 只提供源码地址，不证明用户效果。原 Hook 修复须保留真实回调
与源码回归证据，并在最终审计检查路由为只读、未知事件不越界写入。
