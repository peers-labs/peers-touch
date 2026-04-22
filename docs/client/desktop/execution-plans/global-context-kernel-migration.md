# GlobalContext Kernel Migration Plan

## 1. 文档定位

本文是 `global-context-kernel.md` 的执行计划与落地状态附属文档。

本文记录：

- 分阶段迁移计划
- 阶段门禁
- 业务层影响矩阵
- 目标代码迁移风格
- 当前实现进度

架构真源以：

- `../global-context-kernel.md`

为准。

## 2. 迁移计划（分阶段）

### Phase 0：骨架落地
- 建立事件模型、状态切片定义、最小 dispatch 通道。

### Phase 1：三域先行
- 接入 `session`、`network`、`runtime` 三个全局域。
- 接入登录、登出、网络降级恢复编排。

### Phase 2：能力并轨
- chat/group/file/timeline/tools 能力接入 Capability Registry。
- 页面改为依赖 capability 判定，不直接硬编码能力可用性。

### Phase 3：任务与通知收敛
- 统一任务编排与通知中心，去除重复本地状态机。

### Phase 4：治理与观测
- 提供全局事件追踪面板与诊断导出能力。

## 3. 阶段门禁（Phase Gates）

每阶段必须满足门禁再进入下一阶段：

- Gate A（Phase 0 -> 1）：事件总线与 snapshot 最小链路可用，且不影响既有业务路径。
- Gate B（Phase 1 -> 2）：`session/network/runtime` 三域已由 Kernel 托管，页面侧禁止绕写。
- Gate C（Phase 2 -> 3）：能力可用性判定已统一走 Capability Registry，旧硬编码判断完成下线清单。
- Gate D（Phase 3 -> 4）：任务与通知编排统一后，关键流程失败率达到目标阈值。

## 4. 第一批迁移清单

- 将 `App.tsx` 内全局监听事件迁移到 `EVENT.*` 常量。
- 将 `UserProfilePopover.tsx` 中账号/OAuth 监听迁移到 `EVENT.AUTH_IDENTITY_CHANGED`。
- 将 `MessageBubble.tsx`、`GlobalLayout.tsx`、`ChannelsPage.tsx` 的导航事件迁移到 `EVENT.NAVIGATION_REQUESTED`。
- 为 `oauth2.ts` 与 `accountIdentity.ts` 增加统一发布入口，禁止重复派发同语义事件。
- 新产品阶段不保留兼容桥：旧事件名与字符串协议应直接删除，统一切到 `EVENT.*` 常量与结构化错误。

## 5. 业务层影响矩阵

### A. 全局壳层与导航层
- 影响模块：`src/App.tsx`、`src/components/GlobalLayout.tsx`、`src/utils/deeplink.ts`
- 影响内容：
  - 现有 `window.dispatchEvent`/`addEventListener` 改为 `globalContext.publish/subscribe`
  - `Peers-Touch:navigate`、`navigate-settings-tab` 统一为 `navigation.requested`
- 业务收益：路由跳转与全局动作可审计、可回放，不再靠字符串事件散落

### B. 账号与 OAuth 域
- 影响模块：`src/store/accountIdentity.ts`、`src/store/oauth2.ts`、`src/components/UserProfilePopover.tsx`
- 影响内容：
  - `account-identity-changed` 与 `oauth2-connections-changed` 合并为 `auth.identity_changed`
  - 轮询刷新改为 Orchestrator 的 `session_login/session_logout/identity_switch` 流程触发
- 业务收益：账号状态变更链路从“多点触发”变成“单入口编排”

### C. 聊天域（AI Chat / Friend / Group）
- 影响模块：`src/store/chat.ts`、`src/services/desktop_api.ts`（chat/friend/group API）
- 影响内容：
  - 发送成功/失败、已读、同步等统一发布 `chat.*` / `group.*` 域事件
  - UI 不再直接跨 store 调用“刷新某模块”，而是订阅域事件
- 业务收益：跨会话、跨页面联动变成标准机制，减少隐式耦合

### D. 文件传输与任务域
- 影响模块：上传/传输相关页面与 store（含 Channels/Memory 里的上传路径）
- 影响内容：
  - 进度、失败重试、完成通知接入 `task` + `notification` 切片
  - 统一事件：`file.transfer_progress`、`file.transfer_completed`
- 业务收益：任务状态可观测，错误可定位，跨页面进度显示一致

### E. 能力开关与可用性判定
- 影响模块：Settings、Channels、Skills、Tools 等依赖“能力可用性”的页面
- 影响内容：
  - 页面不再硬编码判断“某能力是否可用”，统一查询 `Capability Registry`
  - 网络降级时自动进入 degraded UI 分支
- 业务收益：降级策略一致，避免每页各写一套可用性判断

### F. 时间线与通知域
- 影响模块：Timeline、Notification 相关页面/组件
- 影响内容：
  - 业务通知与系统通知统一入总线，再映射到 `notification` 切片
  - 时间线增量更新从“局部拉取”升级为“事件驱动 + 必要回补”
- 业务收益：通知语义统一，减少重复刷新与漏更新

## 6. 业务层目标代码风格

页面侧（只订阅，不做跨域写入）：

```ts
const unsub = globalContext.subscribe('auth.identity_changed', async () => {
  await useChatStore.getState().refreshSessions();
});
```

业务动作侧（只发动作，不直接串调用链）：

```ts
await globalContext.dispatch({
  type: 'identity.switch',
  payload: { actorId: nextActorId }
});
```

编排结果侧（统一事件）：

```ts
globalContext.subscribe('orchestrator.pipeline_finished', (event) => {
  if (event.payload.pipeline === 'identity_switch') {
    message.success('身份切换完成');
  }
});
```

## 7. 对业务团队的直接影响

- 代码习惯变化：从“模块直接调用模块”转为“动作 -> 编排 -> 事件 -> store”
- 改造成本分布：
  - 低成本：导航、账号通知、设置页跳转
  - 中成本：chat/group/file 的状态同步链路
  - 高成本：历史轮询链路与跨 store 隐式依赖清理
- 协作变化：新功能评审必须提交三项信息
  - 产生哪些 domain event
  - 写入哪个 state slice
  - 由哪个 orchestrator pipeline 托管

## 8. 当前实现进度（2026-03）

### 8.1 已实现
- 事件中心化（`EVENT` 常量 + `eventBus`）与业务层硬编码事件拦截规则已落地。
- GlobalContext `snapshot + pipeline` 第一版已落地，包含 `identity/session/oauth/runtime/network/capability/workspace/task/notification/meta`。
- Rust 权威链路已接通：`context_snapshot_get`、`context_action_dispatch`。
- Rust 查询接口已补齐：`context_capabilities`、`context_health`。
- Rust Snapshot Store 已支持持久化恢复（`global_context.json`）。
- `registerTime` 字段链路已接通：`AccountIdentity.created_at -> GlobalContext.identity.registerTime`。
- `session_revoked` 已收敛为结构化认证错误：`station_client -> AppResult Unauthorized/details -> AUTH_SESSION_REVOKED -> session_logout`。
- Desktop Web 已移除字符串兼容协议，`AUTH_SESSION_REVOKED` 仅由结构化 `RustCommandError.code/details` 触发。

### 8.2 待实现
- Rust 侧 `context_events_subscribe`（实时订阅通道）尚未落地，当前以 snapshot + dispatch 为主。
- `task/notification` 仍以框架通用能力为主，尚未完整接入 friend/group/file 业务编排。
- 指标门禁（事件投递率、pipeline 成功率）尚未形成 CI 阻断规则。

### 8.3 registerTime 契约约束
- 真源：Station 用户域（首次建号时间）。
- 推荐字段：统一使用 `created_at`（RFC3339）。
- 兼容输入：`created_at` / `createdAt` / `register_time`（仅过渡期允许）。
- Desktop 口径：`globalContext.identity.registerTime = created_at`，禁止客户端本地推断覆盖。
