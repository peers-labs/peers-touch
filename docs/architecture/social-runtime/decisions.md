# Social Runtime Alignment — 设计决策

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-03 | **Updated**: 2026-06-03
> **Owner**: Client Architecture Team
> **Module**: `apps/desktop/src/runtimes/socialRuntime.ts`, `apps/mobile/src/features/social/`

---

## 决策索引

| ID | 决策 | 状态 |
| --- | --- | --- |
| D-01 | Station 是跨端社交真源，客户端只做 runtime projection | accepted |
| D-02 | 双端共享抽象层级，不强制共享同一文件实现 | accepted |
| D-03 | Host Adapter 是唯一平台差异入口 | accepted |
| D-04 | 页面不能拥有长期社交 freshness | accepted |
| D-05 | protobuf 使用 generated contract，禁止手写 wire decoder | accepted |
| D-06 | Group chat 独立 projection domain，不挂靠 friend chat | accepted |
| D-07 | Offline queue 和 E2EE 作为 projection domain 接入 runtime | proposed |

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

## D-02: 双端共享抽象层级，不强制共享同一文件实现

**Status**: accepted  
**Date**: 2026-06-03

### Context

Desktop 与 Mobile 都是 TypeScript UI，但宿主路径不同：Desktop 经过 desktop-rust，本地能力更重；Mobile 是 Tauri Mobile WebView + Rust capability kernel + native plugins。

### Decision

双端必须共享同一抽象层级和语义接口，但不要求第一阶段把所有逻辑抽到公共 package。

### Rationale

- 先统一模型和边界，避免为了复用制造跨端错误依赖。
- Desktop 当前包含 group、E2EE、P2P 等更多成熟能力；Mobile 当前分层更清晰。两端应互相收敛，而不是单向复制。

### Alternatives Considered

- 直接抽 `packages/social-runtime`：当前差异未整理完，过早抽包会固化错误边界。
- 继续端内独立演进：会增加长期理解和维护成本。

### Consequences

- Phase 1 先做架构矩阵、接口契约和防回退规则。
- Phase 2 再逐步沉淀可共享 reducer/contract。

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
- Mobile 已有 `mobileNativeEventBridge.ts`，后续只补 native plugin emit。

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

## D-06: Group chat 独立 projection domain

**Status**: accepted  
**Date**: 2026-06-03

### Context

Desktop 已有 group chat、group membership、sender keys 等能力。Mobile 还未完成 group chat。若用 friend chat 字段兼容 group，会污染两个模型。

### Decision

Group chat 必须作为独立 projection domain 接入 social runtime，与 friend chat 共享 runtime supervisor，但不共享 message schema/state bucket。

### Rationale

- Group 有成员关系、群未读、sender key、membership change、群 profile 等独立语义。
- Friend session 与 group conversation 只能在 UI conversation projection 层统一展示。

### Alternatives Considered

- 把 group 当特殊 friend session：会在权限、成员、加密和 unread 上持续出错。

### Consequences

- Mobile group chat 后续必须新增 group projection，不允许在 friend chat 中硬扩。

---

## D-07: Offline queue 和 E2EE 作为 projection domain 接入 runtime

**Status**: proposed  
**Date**: 2026-06-03

### Context

Offline queue 和 E2EE 都涉及本地状态、Station 协作和跨端一致性。它们不能作为按钮级功能补在页面里。

### Decision

Offline queue 和 E2EE 作为独立 projection domain 接入 social runtime。Host secure storage 只保存必要 secret，不成为业务 truth。

### Rationale

- Offline queue 需要 pending command、重试、冲突回放、用户可见状态。
- E2EE 需要 device identity、key bundle、message encryption/decryption failure projection。

### Alternatives Considered

- 页面发送失败后局部重试：不能跨页面、跨恢复、跨网络状态统一管理。
- 把加密状态塞入 message UI：会导致密钥生命周期和 UI 生命周期耦合。

### Consequences

- 需要单独数据模型文档或后续 phase 计划。
- Desktop 现有 E2EE/group sender key 能力需要拆清 runtime owner 后再迁移到统一抽象。
