# Social Runtime Alignment — 设计决策

> **Status**: draft
> **Version**: v0.2
> **Created**: 2026-06-03 | **Updated**: 2026-10-07
> **Owner**: Client Architecture Team
> **Module**: `apps/desktop/src/runtimes/socialRuntime.ts`, `apps/mobile/src/features/social/`

---

## 决策索引

| ID | 决策 | 状态 |
| --- | --- | --- |
| D-01 | Station 是跨端社交真源，客户端只做 runtime projection | accepted |
| D-02 | 双端共享抽象层级，纯语义可进入共享包 | accepted |
| D-03 | Host Adapter 是唯一平台差异入口 | accepted |
| D-04 | 页面不能拥有长期社交 freshness | accepted |
| D-05 | protobuf 使用 generated contract，禁止手写 wire decoder | accepted |
| D-06 | Group chat 独立 projection domain，不挂靠 friend chat | accepted |
| D-07 | Offline queue 和 E2EE 作为 projection domain 接入 runtime | accepted |
| D-08 | Durable command persistence belongs to platform InteractionAdmission | accepted |

---

## D-01: Station 是跨端社交真源

**Status**: accepted
**Date**: 2026-06-03

### Context

好友请求、会话、消息、通知、profile、presence 需要跨设备一致。Desktop 和 Mobile 都可能丢失 SSE、后台挂起或本地状态被清空。

### Decision

Station 是跨端业务真源。Desktop/Mobile 只维护 runtime projection；所有 projection 必须能通过 Station-backed reconcile 修复。

### Rationale

- 避免端侧分叉产生不同业务事实。
- 支持多设备同步。
- 支持 WebView suspend、Desktop hidden window、网络断连后的恢复。

### Alternatives Considered

- 端侧本地状态作为真源：会导致跨端冲突和 Station 无法审计。
- 页面刷新作为恢复：不能覆盖后台、隐藏窗口、SSE drop 等运行时问题。

### Consequences

- Runtime 必须有 periodic reconcile。
- Store 中的 optimistic update 必须能被 Station response 覆盖。
- Logout/station switch 必须清空 projection。

---

## D-02: 双端共享抽象层级，纯语义可进入共享包

**Status**: accepted
**Date**: 2026-06-03

### Context

Desktop 与 Mobile 都是 TypeScript UI，但宿主路径不同：Desktop 经过 desktop-rust，本地能力更重；Mobile 是 Tauri Mobile WebView + Rust capability kernel + native plugins。

### Decision

双端必须共享同一抽象层级和语义接口。对不依赖 store、runtime、Tauri、DOM、UI 组件的纯 chat 语义，允许沉淀到共享 package；对 runtime supervisor、host adapter、UI renderer，不要求第一阶段共享同一文件实现。

### Rationale

- 先统一模型和边界，避免为了复用制造跨端错误依赖。
- message type、attachment kind、reply/thread helper、IME-safe enter、composer capability profiles、draft submit guard、display/search/edit/sender extraction、timeline surface projection、conversation surface projection、thread surface projection 等纯函数没有宿主差异，留在端内只会造成语义漂移。
- Desktop 当前包含 group、E2EE、P2P 等更多成熟能力；Mobile 当前分层更清晰。两端应互相收敛，而不是单向复制。

### Alternatives Considered

- 直接抽 `packages/social-runtime`：当前差异未整理完，过早抽 runtime 包会固化错误边界。
- 继续端内独立演进：会增加长期理解和维护成本。

### Consequences

- `packages/client-chat-core` 承载跨端纯 chat 语义；Desktop/Mobile 选择共享 composer capability profile，媒体采集、上传、渲染仍留在宿主 adapter 与 renderer。
- Phase 2 继续沉淀可共享 reducer/contract，但 host adapter 与 renderer 仍按平台实现。

---

## D-03: Host Adapter 是唯一平台差异入口

**Status**: accepted
**Date**: 2026-06-03

### Context

Desktop 有 tray/system notification/window focus；Mobile 有 push/deep-link/resume/WebView visibility。它们都是唤醒或提示源，不是社交业务真源。

### Decision

所有宿主差异通过 `SocialHostAdapter` 转换为标准 `SocialHostEvent`，再交给 runtime supervisor。

### Rationale

- Host event 只说明“可能有变化”或“用户从通知进入”，不能直接修改 message/request/notification projection。
- Runtime 能统一 debounce、targeted refresh、reconcile。

### Alternatives Considered

- 页面监听 host event 后自行刷新：会重新引入页面 freshness owner。
- native 插件直接调 store：会绕过 runtime 生命周期和 teardown。

### Consequences

- Desktop 需要显式化 host adapter。
- Desktop host adapter 入口为 `apps/desktop/src/runtimes/desktopSocialHostAdapter.ts`，只把 visibility/focus/network/native host events 转成 `SocialHostEvent`。
- Mobile `mobileNativeEventBridge.ts` 与 Desktop adapter 使用 `packages/client-chat-core` 的共享 host event helper，后续只补 native plugin emit。

---

## D-04: 页面不能拥有长期社交 freshness

**Status**: accepted
**Date**: 2026-06-03

### Context

历史问题包括：badge 有提示但列表为空、进入页面才刷新、收到通知但 Contacts 不变。这些都源于页面承担了 projection freshness。

### Decision

页面只读 projection 和 dispatch command。任何长期刷新、事件消费、timer、SSE、presence、notification-driven refresh 都归 runtime/store。

### Rationale

- 页面生命周期不等于业务生命周期。
- Chat/Contacts/Notification 可能同时读取同一投影，必须由统一 owner 收敛。

### Alternatives Considered

- 每个页面补 `useEffect(load...)`：短期可见，长期会产生重复刷新和状态不一致。

### Consequences

- 新页面必须声明读取的 runtime。
- 代码审查应阻止 page-local social refresh。

---

## D-05: protobuf 使用 generated contract

**Status**: accepted
**Date**: 2026-06-03

### Context

Mobile 曾出现手写 protobuf wire decoder 的临时实现风险；这会让 field number、oneof、bytes/timestamp 语义脱离 `model/domain/`。

### Decision

Desktop/Mobile 的 protobuf 解码只能使用 generated code。禁止手写 `ProtoReader`、field-number 常量、wire type 分支。

### Rationale

- Proto-first 是项目铁律。
- 双端协议一致性必须由同一 proto source 生成保证。

### Alternatives Considered

- 手写轻量 decoder：会降低依赖，但长期不可维护且容易和 proto 演进脱节。

### Consequences

- Mobile 已接入 generated TS proto 与防回退检查。
- Desktop 也应补同类防回退检查，确保没有未来回退。

---

## D-06: Group chat 独立 Conversation projection domain

**Status**: amended
**Date**: 2026-06-03; amended 2026-10-07

### Context

Group chat has membership, member authority, MLS state, and group metadata that
must not be represented as special Friend fields.

### Decision

Group and Direct remain distinct kinds inside the canonical Conversation
projection. On Mobile, Device Messaging Engine and `messagingRuntime` are the
single lifecycle and freshness owner for both kinds. The Social realtime
supervisor may decode Chat-bearing frames only into `messaging-wake` control
intents; Social has no Group projection domain, Group descriptor, settings
refresh, or membership reducer.

### Rationale

- Group has independent membership, unread, MLS, authority, and metadata
  semantics within Conversation.
- Direct and Group unify only at the UI conversation projection layer.
- One Messaging owner prevents Social and Messaging from racing to refresh the
  same Conversation state.

### Alternatives Considered

- 把 group 当特殊 friend session：会在权限、成员、加密和 unread 上持续出错。

### Consequences

- Mobile keeps one Messaging-owned Conversation projection and one
  Messaging-owned group-command outcome projection.
- Retired Friend/Group-specific Proto, gateway, store, runtime, route, and test
  trees stay deleted.

---

## D-07: Offline queue 和 E2EE 作为 projection domain 接入 runtime

**Status**: accepted
**Date**: 2026-06-03

### Context

Offline queue 和 E2EE 都涉及本地状态、Station 协作和跨端一致性。它们不能作为按钮级功能补在页面里。

### Decision

Offline command UI state 和 E2EE 作为独立 projection domain 接入 social
runtime。Host secure storage 只保存必要 secret，不成为业务 truth。

Shared projection primitives live in `packages/client-chat-core`:

- `ChatE2eeProjection` tracks readiness/error as pure projection state.
- `ChatOutboxItem` and outbox reducers track queued/sending/failed/unknown
  projection state.

### Rationale

- Offline queue 需要 pending command、重试、冲突回放、用户可见状态。
- E2EE 需要 device identity、key bundle、message encryption/decryption failure projection。

### Alternatives Considered

- 页面发送失败后局部重试：不能跨页面、跨恢复、跨网络状态统一管理。
- 把加密状态塞入 message UI：会导致密钥生命周期和 UI 生命周期耦合。

### Consequences

- Desktop/Mobile E2EE and offline commands consume shared projection semantics
  even when host crypto/storage adapters differ.
- Desktop 现有 E2EE/group sender key 能力需要拆清 runtime owner 后再迁移到统一抽象。
- Mobile group E2EE runtime already owns SKDM ledger, repair queue, rotation,
  and readiness projection; further end-to-end scenarios remain runtime/domain
  verification, not UI patch work.

---

## D-08: Durable command persistence belongs to platform InteractionAdmission

**Status**: accepted
**Date**: 2026-08-27

### Context

D-07 establishes shared visible projection semantics but does not assign
durable persistence, ordering, or unknown-outcome convergence. Mobile Shell
requires exactly one owner and must not create a Social outbox beside a generic
command ledger.

### Decision

- Frontend Runtime `InteractionAdmission` owns cross-domain admission,
  ordering, fairness, idempotency, and unknown-outcome semantics.
- Mobile implements it through `commandRuntime` plus one Rust encrypted ledger.
- `ChatOutboxItem` is a derived visible projection; it does not persist, drain,
  or replay a second outbox.
- Social/group runtimes provide authoritative domain readback only.

### Rationale

The split keeps business projection state in Social Runtime while giving
cross-domain reliability one bounded platform owner.

### Alternatives Considered

- Social-owned durable outbox: rejected because settings/Moments and future
  domains would each need another persistence policy.
- Native Room/SwiftData queues: rejected because they duplicate Rust state and
  diverge across platforms.

### Consequences

- Existing shared reducers remain reusable but no longer imply persistence
  ownership.
- Platform command runtimes must expose typed projection updates to social
  reducers.
- The amendment was accepted with the Mobile PRODUCT/DESIGN package on
  2026-08-27.

### Reversal Trigger

Review if all durable writes move to a Model-owned client runtime with identical
native lifecycle and secure-storage guarantees.
