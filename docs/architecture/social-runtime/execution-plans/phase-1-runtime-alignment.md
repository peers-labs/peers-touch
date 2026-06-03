# Phase 1: 双端 Social Runtime Alignment

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-03 | **Updated**: 2026-06-03
> **Owner**: Client Architecture Team
> **Module**: `apps/desktop/src/runtimes/socialRuntime.ts`, `apps/mobile/src/features/social/`

---

## 1. 目标

本阶段目标不是新增单点功能，而是把 Desktop/Mobile 社交能力拉到同一架构语言下：

- 双端统一 runtime supervisor、projection store、normalizer、wire contract、host adapter 的职责边界。
- 明确当前差异和后续迁移顺序。
- 加防回退规则，避免继续产生页面刷新式补丁和手写协议兼容。

---

## 2. 交付物

| 领域 | 交付物 | 验收标准 |
| --- | --- | --- |
| 架构真源 | `docs/architecture/social-runtime/` 文档集 | 文档在 `docs/README.md` 架构层真源注册 |
| 现状矩阵 | Desktop/Mobile 文件映射和能力差异矩阵 | 能看出哪些是成熟能力、哪些是分层优势、哪些未完成 |
| Runtime 契约 | `SocialRuntimeSupervisor` 语义 | 双端都有 install/bootstrap/reconcile/teardown/external event 对应点 |
| Host Adapter 契约 | `SocialHostEvent` 标准事件 | Desktop/Mobile 宿主事件不直接写业务 projection |
| Wire 防回退 | 双端 generated proto 检查 | 已接入 `apps/desktop/scripts/check-social-wire-contract.sh` 与 `apps/mobile/scripts/check-social-wire-contract.sh`，禁止 `ProtoReader`、field-number、wire-type 手写 decode |
| Page freshness 防回退 | 双端 runtime boundary 检查 | 已接入 `tooling/scripts/check-social-runtime-boundaries.sh`，禁止页面直接开 SSE、presence stream、runtime-level reconcile/refresh |

---

## 3. 依赖

前置：

- Mobile social runtime closure 已完成核心闭环。
- Desktop runtime projection contract 已存在。
- Desktop/Mobile generated TS proto 已存在。

下游依赖：

- Phase 2 projection/normalizer 收敛。
- Phase 3 host adapter 闭环。
- Phase 4 group/offline/E2EE domain。

---

## 4. 执行步骤

### Step 1: 文档真源落地

- 新增 `docs/architecture/social-runtime/README.md`。
- 新增 `design.md`、`decisions.md`、`integration.md`。
- 在 `docs/README.md` §4.1 注册。

### Step 2: 双端防回退检查

- Mobile 已有 `apps/mobile/scripts/check-social-wire-contract.sh`。
- Desktop 已补 `apps/desktop/scripts/check-social-wire-contract.sh`。
- 已增加 `tooling/scripts/check-social-runtime-boundaries.sh` page-local freshness scan，覆盖：
  - `fetch('/events/stream')`
  - `fetch('/friend-chat/presence/stream')`
  - page/component 中直接安装/启动 social runtime bridge
  - page/component 中绕过 runtime 的 social long-lived subscription

### Step 3: Desktop boundary 清理计划

- 标记 `services/socialChatRealtime.ts` 与 `services/socialRealtime.ts` 的职责重叠。
- 确认保留一个 runtime supervisor 入口。
- 把 Desktop normalizer/reducer 候选函数从 store/service 中列出。

### Step 4: Mobile parity backlog 锁定

- Mobile group chat 进入独立 group projection domain。
- Mobile native push/deep-link/notification tap 插件 emit 标准 `mobile:*` event。
- Mobile E2EE/offline queue 不在页面补逻辑，必须建 domain。

### Step 5: 验证

- 文档链接有效。
- Desktop/Mobile check 仍通过。
- grep 扫描无 proto wire 手写回退。
- review 确认新功能都有 owner 层级。

---

## 5. 验收标准

必须满足：

- 新增社交功能能明确回答：属于 API、wire、normalizer、reducer、store、runtime、host adapter、UI 哪一层。
- Desktop/Mobile 对同一业务事实使用同一语义名词和状态机。
- 页面不新增长期 freshness owner。
- Host event 只进入 runtime external event，不直接改 projection。
- protobuf decode 只用 generated code。

失败信号：

- 为了修某个页面 stale，在 page `useEffect` 中新增长期 refresh。
- 为了修某个端的协议问题，手写 field-number decoder。
- Mobile group chat 复用 friend chat state bucket。
- Desktop/Mobile notification unread 或 message status 出现不同语义。

---

## 6. 下一阶段入口

Phase 1 完成后进入：

1. Projection/Normalizer 收敛：先对齐 receipt、mutation、typing、presence、notification。
2. Host Adapter 闭环：补 Desktop host adapter 和 Mobile native plugin emit。
3. Group domain：Mobile 追齐 Desktop group chat，但按独立 domain 实现。
4. Offline/E2EE domain：从架构设计进入实现计划，不做页面补丁。
