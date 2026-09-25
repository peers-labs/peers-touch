# Chat 本机存储治理

> **Status**: prepared
> **Branch**: merge-social-work
> **Workspace ID**: b0a926025d2b25b9
> **Initial HEAD**: 80f796894ecf4a98608ba0260cc49390ecba3c97

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"CSG-20260926","status":"prepared","binding":{"branch":"merge-social-work","workspaceId":"b0a926025d2b25b9","initialHead":"80f796894ecf4a98608ba0260cc49390ecba3c97"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/chat-storage-governance/product-definition.md","docs/architecture/chat-storage-governance/benchmark-disposition.md","docs/architecture/chat-storage-governance/experience-contract.md","docs/architecture/chat-storage-governance/product-state-model.md","docs/architecture/chat-storage-governance/acceptance-matrix.md","docs/architecture/chat-storage-governance/design.md","docs/architecture/chat-storage-governance/decisions.md","docs/architecture/chat-storage-governance/data-model.md","docs/architecture/chat-storage-governance/integration.md","docs/architecture/chat-storage-governance/legacy-inventory.json"],"decisions":["CSG-D01","CSG-D02","CSG-D03","CSG-D04","CSG-D05","CSG-D06","CSG-D07","CSG-D08"]},"scope":{"sourceClaims":[{"pathPrefix":"docs/README.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/chat-storage-governance","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/chat-lifecycle","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/messaging-platform","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/encryption","mode":"exclusive-write"},{"pathPrefix":"docs/client/chat","mode":"exclusive-write"},{"pathPrefix":"docs/client/desktop","mode":"exclusive-write"},{"pathPrefix":"docs/client/mobile","mode":"exclusive-write"},{"pathPrefix":"docs/knowledge","mode":"exclusive-write"},{"pathPrefix":"model/domain/chat","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/chat","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/conversation","mode":"exclusive-write"},{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/mobile","mode":"exclusive-write"},{"pathPrefix":"packages/messaging-core","mode":"exclusive-write"},{"pathPrefix":"packages/client-storage","mode":"exclusive-write"},{"pathPrefix":"packages/client-chat-core","mode":"exclusive-write"},{"pathPrefix":"packages/locales","mode":"exclusive-write"},{"pathPrefix":"packages/prototypes/desktop/features/social-chat","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts","mode":"exclusive-write"}],"nonGoals":["Station authority history deletion","Enterprise retention, legal hold, cloud quota, archive tier or billing","Custom retention days or media-type policies","Disappearing messages","Station access, Access Gate, Federation or Relay redesign","Browser client readiness","Preserve old schema, archive, clear/restore or local-delete compatibility"]},"tasks":[{"id":"CSG-01-storage-observability","workstreamId":"CSG-W01","path":"tasks/CSG-01-storage-observability.md","dependsOn":[],"status":"pending","blocker":null},{"id":"CSG-02-cache-cleanup","workstreamId":"CSG-W02","path":"tasks/CSG-02-cache-cleanup.md","dependsOn":["CSG-01-storage-observability"],"status":"pending","blocker":null},{"id":"CSG-03-retention","workstreamId":"CSG-W03","path":"tasks/CSG-03-retention.md","dependsOn":["CSG-02-cache-cleanup"],"status":"pending","blocker":null},{"id":"CSG-04-redaction-recovery","workstreamId":"CSG-W04","path":"tasks/CSG-04-redaction-recovery.md","dependsOn":["CSG-03-retention"],"status":"pending","blocker":null},{"id":"CSG-05-local-clear-hard-cut","workstreamId":"CSG-W05","path":"tasks/CSG-05-local-clear-hard-cut.md","dependsOn":["CSG-04-redaction-recovery"],"status":"pending","blocker":null},{"id":"CSG-06-zero-legacy-aggregate","workstreamId":"CSG-W06","path":"tasks/CSG-06-zero-legacy-aggregate.md","dependsOn":["CSG-05-local-clear-hard-cut"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["chat-native-four","chat-native-disposable","mobile-simulator","mobile-ios-layout-simulator"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{
  "closures": {
    "csg-storage-observability": [
      "chat-storage-contract",
      "chat-storage-accounting-e2e"
    ],
    "csg-cache-cleanup": [
      "chat-storage-cache-clear-e2e"
    ],
    "csg-retention": [
      "chat-storage-retention-e2e"
    ],
    "csg-redaction-recovery": [
      "chat-storage-redaction-recovery-e2e"
    ],
    "csg-local-clear-hard-cut": [
      "chat-storage-delete-reclaim-e2e",
      "chat-storage-dead-contract-zero-e2e"
    ],
    "csg-zero-legacy-aggregate": [
      "chat-storage-zero-legacy-e2e",
      "desktop-release-build",
      "mobile-native-build",
      "chat-storage-governance-aggregate-e2e"
    ]
  },
  "completion": [
    "chat-storage-contract",
    "chat-storage-accounting-e2e",
    "chat-storage-cache-clear-e2e",
    "chat-storage-retention-e2e",
    "chat-storage-redaction-recovery-e2e",
    "chat-storage-delete-reclaim-e2e",
    "chat-storage-dead-contract-zero-e2e",
    "chat-storage-zero-legacy-e2e",
    "desktop-release-build",
    "mobile-native-build",
    "chat-storage-governance-aggregate-e2e"
  ],
  "full": [
    "chat-storage-contract",
    "chat-storage-accounting-e2e",
    "chat-storage-cache-clear-e2e",
    "chat-storage-retention-e2e",
    "chat-storage-redaction-recovery-e2e",
    "chat-storage-delete-reclaim-e2e",
    "chat-storage-dead-contract-zero-e2e",
    "chat-storage-zero-legacy-e2e",
    "chat-storage-governance-aggregate-e2e",
    "messaging-platform-contract",
    "desktop-check",
    "mobile-contract-static",
    "chat-native-two-client-e2e",
    "chat-native-interactions-e2e",
    "chat-native-recovery-e2e",
    "chat-native-submitted-command-recovery-e2e",
    "chat-lifecycle-mixed-client-same-station-e2e",
    "chat-lifecycle-mixed-client-cross-station-e2e",
    "chat-lifecycle-mixed-client-multi-device-e2e",
    "chat-lifecycle-tree-zero-reference-e2e",
    "proto-build",
    "station-messaging-unit",
    "desktop-release-build",
    "mobile-native-build"
  ]
}
```

## 目标

在当前设备上交付简单、可解释、可验证的 Chat 空间统计、缓存清理、保留周期、
按会话清理、消息 redaction 与物理回收，不改写 Station authority。

## 上游关系

- `CCU-20260922` 已完成，本计划不重开其 Task。
- Conversation、Messaging Platform、Encryption/Recovery 既有 owner 保持。
- 本计划与 `SAL-20260926` 没有产品依赖，必须独立绑定、执行和验收。

## 执行 DAG

```text
CSG-01-storage-observability
  -> CSG-02-cache-cleanup
  -> CSG-03-retention
  -> CSG-04-redaction-recovery
  -> CSG-05-local-clear-hard-cut
  -> CSG-06-zero-legacy-aggregate
```

## Vertical Closures

| Task | 闭环 | 硬切 |
|---|---|---|
| CSG-01 | 双端看到真实总量与按会话占用 | Proto/Core/adapter/runtime/UI，删除伪零统计 |
| CSG-02 | 双端安全清理可再生成缓存 | cache class、immutable journal、实际释放量 |
| CSG-03 | 双端执行四档本机 retention | worker、floor、保护集 |
| CSG-04 | Hide/Retract 在重启与 Recovery 后不复活 | redaction transaction、ACK、tombstone、archive |
| CSG-05 | 按会话清理并真实回收 | sequence floor、级联删除、旧 clear/timer/schema 硬切 |
| CSG-06 | 当前源码完整 E2E 且九维遗产归零 | fresh baseline、发布构建、聚合 Gate |

## Atomic Hard Cuts

- shared Core ready 后双端同时切换，禁止两套 policy。
- redaction transaction/Recovery ready 后删除 Desktop local-only overlay。
- sequence floor/physical cleanup ready 后删除旧 marker/filter/restore。
- 最后 consumer 归零后删除 disappear timer、stub 与 compat schema。
- canonical CREATE ready 后重置获批开发数据，不编写 migration。

## 完成与非声明

完成要求：

- 6 个 Task 全部 `done`；
- Completion 与 Full Gate 全部通过；
- 成功清理后真实物理字节下降；
- `legacy-inventory.json` 全 scanRoots 为零；
- runtime 资源释放，工作树干净。

不声明 Browser parity、Station history 删除、企业治理、阅后即焚或旧数据升级。

## Workspace Binding

本文件在已绑定 completed `CCU-20260922` 的评审 worktree 中生成，当前 machine
binding 不属于本 Plan。Owner 批准后必须从批准提交创建新 worktree，机械更新
`branch/workspaceId/initialHead`，完成 binding-delta review，再运行
`plan-validate`、`plan-current` 和 `plan-bind`。此前所有 Task 保持 `pending`。

## Review Status

- Review 1：见 `../../reviews/review-01-product-architecture.md`。
- Review 2：见 `../../reviews/review-02-plan-readiness.md`。
- Owner：待审核；未授权 EXECUTE。
