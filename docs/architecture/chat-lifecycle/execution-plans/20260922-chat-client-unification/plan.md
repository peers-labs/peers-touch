# Desktop 与 Mobile Chat 客户端统一

> **Status**: completed
> **Branch**: merge-desktop-prototype
> **Workspace ID**: b0a926025d2b25b9
> **Initial HEAD**: e90b81c2fb8473c708c0118d79c278630d938cfe

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"CCU-20260922","status":"completed","binding":{"branch":"merge-desktop-prototype","workspaceId":"b0a926025d2b25b9","initialHead":"e90b81c2fb8473c708c0118d79c278630d938cfe"},"workClass":"refactor","architecture":{"sources":["docs/architecture/chat-lifecycle/product-definition.md","docs/architecture/chat-lifecycle/experience-contract.md","docs/architecture/chat-lifecycle/product-state-model.md","docs/architecture/chat-lifecycle/acceptance-matrix.md","docs/architecture/chat-lifecycle/design.md","docs/architecture/chat-lifecycle/decisions.md","docs/architecture/chat-lifecycle/data-model.md","docs/architecture/chat-lifecycle/module-layout.md","docs/architecture/chat-lifecycle/integration.md"],"decisions":["CHAT-D01","CHAT-D02","CHAT-D03","CHAT-D04","CHAT-D05","CHAT-D06","CHAT-D07","CHAT-D08","CHAT-D09","CCU-D01","CCU-D02","CCU-D03","CCU-D04","CCU-D05","CCU-D06"]},"scope":{"sourceClaims":[{"pathPrefix":".gitignore","mode":"exclusive-write"},{"pathPrefix":"AGENTS.md","mode":"exclusive-write"},{"pathPrefix":"Makefile","mode":"exclusive-write"},{"pathPrefix":"apps/dev","mode":"exclusive-write"},{"pathPrefix":"docs/README.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/acceptance-framework","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/api-ownership","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/chat-lifecycle","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/development-workflow","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/identity","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/local-dev-control-plane","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/mobile","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/prototypes","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/realtime/prototype","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/search","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/social-runtime","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/state-machines","mode":"exclusive-write"},{"pathPrefix":"docs/global/coding-guide","mode":"exclusive-write"},{"pathPrefix":"docs/knowledge","mode":"exclusive-write"},{"pathPrefix":"docs/client/common/ui-identity","mode":"exclusive-write"},{"pathPrefix":"docs/client/desktop","mode":"exclusive-write"},{"pathPrefix":"model/domain/chat","mode":"exclusive-write"},{"pathPrefix":"model/domain/federation","mode":"exclusive-write"},{"pathPrefix":"model/domain/realtime","mode":"exclusive-write"},{"pathPrefix":"apps/station","mode":"exclusive-write"},{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/mobile","mode":"exclusive-write"},{"pathPrefix":"packages/client-chat-core","mode":"exclusive-write"},{"pathPrefix":"packages/messaging-core","mode":"exclusive-write"},{"pathPrefix":"packages/prototypes","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/make/local-dev.mk","mode":"exclusive-write"},{"pathPrefix":"tooling/make/setup.mk","mode":"exclusive-write"},{"pathPrefix":"tooling/plugins","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts","mode":"exclusive-write"},{"pathPrefix":"tooling/skills","mode":"exclusive-write"},{"pathPrefix":"packages/locales","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/messaging-platform","mode":"shared-read"},{"pathPrefix":"docs/architecture/realtime","mode":"shared-read"},{"pathPrefix":"docs/client/chat","mode":"shared-read"}],"nonGoals":["Browser Chat readiness","New media capabilities or group SFU","Visual redesign of Chat pages","Desktop layout forced onto Mobile","Second persistence schema or migration table","Data migration, compatibility reader, or fallback path","Conversation Authority hard-cut (owned by peers-access-gate)"]},"tasks":[{"id":"CCU-01-contract","workstreamId":"CCU-W01","path":"tasks/CCU-01-contract.md","dependsOn":[],"status":"done","blocker":null},{"id":"CCU-02-desktop-runtime","workstreamId":"CCU-W02","path":"tasks/CCU-02-desktop-runtime.md","dependsOn":["CCU-01-contract"],"status":"done","blocker":null},{"id":"CCU-03-direct-cutover","workstreamId":"CCU-W03","path":"tasks/CCU-03-direct-cutover.md","dependsOn":["CCU-02-desktop-runtime"],"status":"done","blocker":null},{"id":"CCU-04-group-interaction-cutover","workstreamId":"CCU-W04","path":"tasks/CCU-04-group-interaction-cutover.md","dependsOn":["CCU-03-direct-cutover"],"status":"done","blocker":null},{"id":"CCU-05-continuity-call","workstreamId":"CCU-W05","path":"tasks/CCU-05-continuity-call.md","dependsOn":["CCU-04-group-interaction-cutover"],"status":"done","blocker":null},{"id":"CCU-06-final-cutover","workstreamId":"CCU-W06","path":"tasks/CCU-06-final-cutover.md","dependsOn":["CCU-05-continuity-call"],"status":"done","blocker":null},{"id":"CCU-07-zero-aggregate","workstreamId":"CCU-W07","path":"tasks/CCU-07-zero-aggregate.md","dependsOn":["CCU-06-final-cutover"],"status":"done","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["chat-native-four","chat-native-disposable"],"destructiveResetScopes":["chat-native-disposable-station"]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{
  "closures": {
    "ccu-contract": ["messaging-platform-contract"],
    "ccu-desktop-runtime": ["desktop-check"],
    "ccu-direct-cutover": ["chat-native-visible-static"],
    "ccu-group-interaction-cutover": ["mobile-hard-cut-static"],
    "ccu-continuity-call": ["chat-lifecycle-mixed-client-multi-device-e2e", "chat-lifecycle-call-resolution-e2e"],
    "ccu-final-cutover": ["chat-lifecycle-mixed-client-same-station-e2e", "chat-lifecycle-mixed-client-cross-station-e2e", "chat-lifecycle-mixed-client-group-mls-e2e"],
    "ccu-zero-aggregate": ["chat-native-two-client-e2e", "chat-lifecycle-tree-zero-reference-e2e", "chat-lifecycle-ccu-aggregate-e2e"]
  },
  "completion": [
    "messaging-platform-contract",
    "desktop-check",
    "applet-desktop-lifecycle-smoothness",
    "chat-native-visible-static",
    "chat-native-two-client-e2e",
    "mobile-hard-cut-static",
    "chat-lifecycle-call-resolution-e2e",
    "federation-surface-smoke",
    "federation-three-node-e2e",
    "station-federation-unit",
    "chat-lifecycle-mixed-client-same-station-e2e",
    "chat-lifecycle-mixed-client-cross-station-e2e",
    "chat-lifecycle-mixed-client-multi-device-e2e",
    "chat-lifecycle-mixed-client-group-mls-e2e",
    "chat-lifecycle-tree-zero-reference-e2e",
    "chat-lifecycle-ccu-aggregate-e2e"
  ],
  "full": [
    "messaging-platform-contract",
    "desktop-check",
    "applet-desktop-lifecycle-smoothness",
    "federation-desktop-gateway-smoke",
    "chat-native-visible-static",
    "mobile-hard-cut-static",
    "chat-lifecycle-call-resolution-e2e",
    "federation-surface-smoke",
    "federation-three-node-e2e",
    "station-federation-unit",
    "chat-lifecycle-mixed-client-same-station-e2e",
    "chat-lifecycle-mixed-client-cross-station-e2e",
    "chat-lifecycle-mixed-client-multi-device-e2e",
    "chat-lifecycle-mixed-client-group-mls-e2e",
    "chat-lifecycle-tree-zero-reference-e2e",
    "chat-lifecycle-ccu-aggregate-e2e",
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "agent-core-lifecycle-native-e2e",
    "agent-event-stream-e2e",
    "agent-marketplace-catalog-e2e",
    "agent-native-knowledge-binding-e2e",
    "agent-quick-completion-e2e",
    "agent-stream-resilience-e2e",
    "agent-v2-kernel-foundation-e2e",
    "chat-contact-message-resilience-e2e",
    "chat-desktop-gateway-e2e",
    "chat-friend-request-gateway-e2e",
    "chat-lifecycle-direct-e2e",
    "chat-lifecycle-onboarding-e2e",
    "chat-native-current-profile-two-client-e2e",
    "chat-native-group-mls-e2e",
    "chat-native-interactions-e2e",
    "chat-native-multi-device-e2e",
    "chat-native-recovery-e2e",
    "chat-native-submitted-command-recovery-e2e",
    "chat-native-two-client-e2e",
    "chat-native-typing-e2e",
    "mobile-contract-static",
    "mobile-identity-contract",
    "mobile-ios-simulator-layout-accessibility-e2e",
    "mobile-simulator-access-e2e",
    "mobile-simulator-chat-contacts-e2e",
    "mobile-simulator-moments-e2e",
    "mobile-simulator-platform-e2e",
    "mobile-simulator-recovery-e2e",
    "mobile-simulator-recovery-ui-e2e",
    "mobile-simulator-runtime-lifecycle-e2e",
    "mobile-simulator-settings-e2e",
    "mobile-simulator-social-convergence-e2e",
    "mobile-simulator-station-lifecycle-e2e",
    "development-workflow-control-plane",
    "proto-build",
    "station-agent-unit",
    "station-api-ownership",
    "station-messaging-unit"
  ]
}
```

## 执行拓扑

| Worktree | 角色 | 运行时 |
|---|---|---|
| `peers-social` | 唯一 Plan Owner、源码变更所有者 | Mobile runtime |
| `peers-group-chat` | 休眠 Desktop A 验证任务 | Desktop runtime (用户触发) |
| `peers-chat-high-chat` | 休眠 Desktop B 验证任务 | Desktop runtime (用户触发) |

跨 Worktree 通信由用户人工协调。Plan Owner 在 checkpoint commit 后报告 SHA、
governed-source digest、运行时 profile、命令、预期断言和超时时间；Desktop 任务在
用户触发后执行并回传报告；所有修复只在 `peers-social` 中进行。

## 执行 DAG

```text
CCU-01-contract
      │
CCU-02-desktop-runtime
      │
CCU-03-direct-cutover
      │
CCU-04-group-interaction-cutover
      │
CCU-05-continuity-call
      │
CCU-06-final-cutover
      │
CCU-07-zero-aggregate
```

W01 只建立 canonical contract；W02 建立单一 Desktop Messaging lifecycle owner。
W03-W05 依次按 Direct、Group/Interaction、Continuity/Call 用户结果做跨端原子硬切。
这些 closure 共享 Desktop/Mobile consumer 与 generated output，因此按依赖串行，
不按平台并行制造双重 owner。W06 只关闭最后共享 consumer 并完成全平台
mixed-client 矩阵；W07 只执行九维零引用与聚合证明，不承担延迟迁移。

## 遗产删除铁律

本项目遵循 CCU-D03（原子硬切换）和 CCU-D05（多维零引用门禁）。每个 closure
同时切换两端 adapter、runtime 和 consumer，同一 closure 删除失去消费者的旧路径。
禁止 compatibility shim、fallback read、dual write、长期 feature flag、`_old`、
`_legacy`、`_deprecated`、re-export bridge 或 archive 目录。

遗产基线（项目开始时的 zero-reference 起点）：

- Desktop 生产调用方：15 个文件
- Desktop `group_chat_*` Tauri commands：34 个
- Desktop `/group-chat/*` route references：26 个
- Mobile 生产调用方：14 个文件
- Legacy Proto 源及生成物：10 个文件
- 测试与 Acceptance 关联文件：16 个

全部必须在 W07 之前归零。

## 可度量完成标准

1. Legacy 生产调用方从 29 个文件降为 0。
2. Desktop 注册的 `group_chat_*` Tauri command 从 34 个降为 0。
3. Desktop 使用的 `/group-chat/*` route 从 26 个降为 0。
4. `friend_chat_pb`、`group_chat_pb` 在非生成生产代码中的引用降为 0。
5. Mobile legacy projection adapter 及其消费者降为 0。
6. Desktop 与 Mobile 共享同一 command/projection/error contract fixture。
7. Mixed-client required runtime cells 全部产生 current exact-source evidence。
8. Legacy zero-reference Gate 成为持续门禁。
9. Legacy store/repository/schema owner、旧表 read/write path、tests、fixtures、
   scripts 和 Gate 引用全部归零。
10. 当前实现树中不存在 `legacy/`、`deprecated/`、`_old`、re-export bridge 或仅为
    兼容旧链路存在的 feature flag。
