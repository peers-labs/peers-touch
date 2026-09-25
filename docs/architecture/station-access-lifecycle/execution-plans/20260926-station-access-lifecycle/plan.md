# Station 接入生命周期

> **Status**: prepared
> **Branch**: merge-social-work
> **Workspace ID**: b0a926025d2b25b9
> **Initial HEAD**: 80f796894ecf4a98608ba0260cc49390ecba3c97

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"SAL-20260926","status":"prepared","binding":{"branch":"merge-social-work","workspaceId":"b0a926025d2b25b9","initialHead":"80f796894ecf4a98608ba0260cc49390ecba3c97"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/station-access-lifecycle/product-definition.md","docs/architecture/station-access-lifecycle/experience-contract.md","docs/architecture/station-access-lifecycle/product-state-model.md","docs/architecture/station-access-lifecycle/acceptance-matrix.md","docs/architecture/station-access-lifecycle/design.md","docs/architecture/station-access-lifecycle/decisions.md","docs/architecture/station-access-lifecycle/integration.md","docs/architecture/station-access-lifecycle/legacy-inventory.json"],"decisions":["SAL-D01","SAL-D02","SAL-D03","SAL-D04","SAL-D05","SAL-D06"]},"scope":{"sourceClaims":[{"pathPrefix":"docs/README.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/station-access-lifecycle","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/access-gates","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/api-ownership","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/federation","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/identity","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/service-coordination.md","mode":"shared-read"},{"pathPrefix":"docs/client/desktop","mode":"exclusive-write"},{"pathPrefix":"docs/client/mobile","mode":"exclusive-write"},{"pathPrefix":"docs/knowledge","mode":"exclusive-write"},{"pathPrefix":"model/domain/access_gate","mode":"exclusive-write"},{"pathPrefix":"model/domain/peer","mode":"exclusive-write"},{"pathPrefix":"model/domain/federation","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/federation","mode":"exclusive-write"},{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/mobile","mode":"exclusive-write"},{"pathPrefix":"packages/locales","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts","mode":"shared-read"}],"nonGoals":["Chat message, attachment or local storage governance","Browser client readiness","Federation topology or Relay implementation redesign","Dashboard or CLI product redesign","Preserve compatibility routes, aliases, fallback reads, old keys or migrations","Force Desktop and Mobile to share identical UI components"]},"tasks":[{"id":"SAL-01-access-hard-cut","workstreamId":"SAL-W01","path":"tasks/SAL-01-access-hard-cut.md","dependsOn":[],"status":"pending","blocker":null},{"id":"SAL-02-federation-relay-boundary","workstreamId":"SAL-W02","path":"tasks/SAL-02-federation-relay-boundary.md","dependsOn":["SAL-01-access-hard-cut"],"status":"pending","blocker":null},{"id":"SAL-03-zero-legacy-aggregate","workstreamId":"SAL-W03","path":"tasks/SAL-03-zero-legacy-aggregate.md","dependsOn":["SAL-02-federation-relay-boundary"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["chat-native-four","chat-native-disposable","mobile-simulator"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{
  "closures": {
    "sal-access-hard-cut": [
      "station-access-capability-contract",
      "station-access-auth-e2e",
      "station-access-scope-isolation-e2e"
    ],
    "sal-federation-relay-boundary": [
      "station-access-federation-boundary-e2e"
    ],
    "sal-zero-legacy-aggregate": [
      "station-access-zero-legacy-e2e",
      "desktop-release-build",
      "mobile-native-build",
      "station-access-lifecycle-aggregate-e2e"
    ]
  },
  "completion": [
    "station-access-capability-contract",
    "station-access-auth-e2e",
    "station-access-scope-isolation-e2e",
    "station-access-federation-boundary-e2e",
    "station-access-zero-legacy-e2e",
    "desktop-release-build",
    "mobile-native-build",
    "station-access-lifecycle-aggregate-e2e"
  ],
  "full": [
    "station-access-capability-contract",
    "station-access-auth-e2e",
    "station-access-scope-isolation-e2e",
    "station-access-federation-boundary-e2e",
    "station-access-zero-legacy-e2e",
    "station-access-lifecycle-aggregate-e2e",
    "station-api-ownership",
    "mobile-identity-contract",
    "mobile-contract-static",
    "federation-surface-smoke",
    "federation-three-node-e2e",
    "station-federation-unit",
    "proto-build",
    "desktop-release-build",
    "mobile-native-build"
  ]
}
```

## 目标

在无历史用户、无需兼容的前提下，让 Desktop 与 Mobile 只有一条可信 Station
接入路径、一个 scope 模型和一个 Federation context 语义，同时把 Relay 与
Federation governance 收回其真实基础设施 owner。

## 上游关系

- `CCU-20260922` 已完成，本计划不重开其 Task。
- Access Gate、Actor、Federation、Relay 的既有业务 owner 保持。
- 本计划与 `CSG-20260926` 没有产品依赖，必须独立绑定、执行和验收。

## 执行 DAG

```text
SAL-01-access-hard-cut
  -> SAL-02-federation-relay-boundary
  -> SAL-03-zero-legacy-aggregate
```

## Vertical Closures

| Task | 闭环 | 硬切 |
|---|---|---|
| SAL-01 | 双端验证 Station 并通过同一 Access Gate 进入正确 scope | 删除 direct login、旧 wire、旧 key 与 legacy submission |
| SAL-02 | 双端使用明确 Federation context，普通客户端不暴露 Relay/治理 | 删除客户端治理 consumers 与重复 profile surface |
| SAL-03 | 当前源码完整 E2E 且接入遗产九维归零 | fresh baseline、双端发布构建、聚合 Gate |

## Atomic Hard Cuts

- canonical protobuf Access consumer ready 后，同 closure 删除旧 route/alias/parser。
- read-only Federation context ready 后，同 closure 删除普通客户端 governance。
- 最终 consumer 分类完成后，删除无 owner wrapper、test、fixture、doc 与 generated 引用。
- affected canonical schema ready 后，删除 compat reader/backfill 并重置获批开发数据。

## 完成与非声明

完成要求：

- 3 个 Task 全部 `done`；
- Completion 与 Full Gate 全部通过；
- `legacy-inventory.json` 全 scanRoots 为零；
- runtime 资源释放，工作树干净。

不声明 Chat 存储治理、Browser parity、Federation/Relay 内部重构或旧数据升级。

## Workspace Binding

本文件在已绑定 completed `CCU-20260922` 的评审 worktree 中生成，当前 machine
binding 不属于本 Plan。Owner 批准后必须从批准提交创建新 worktree，机械更新
`branch/workspaceId/initialHead`，完成 binding-delta review，再运行
`plan-validate`、`plan-current` 和 `plan-bind`。此前所有 Task 保持 `pending`。

## Review Status

- Review 1：见 `../../reviews/review-01-product-architecture.md`。
- Review 2：见 `../../reviews/review-02-plan-readiness.md`。
- Owner：待审核；未授权 EXECUTE。
