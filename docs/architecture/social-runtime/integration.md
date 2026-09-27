# Social Runtime Alignment — 集成与映射

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-03 | **Updated**: 2026-08-27
> **Owner**: Client Architecture Team
> **Module**: `apps/desktop/src/runtimes/socialRuntime.ts`, `apps/mobile/src/features/social/`

---

## 1. 与现有模块的映射

### 1.1 Desktop 当前映射

| 文件 / 模块 | 当前职责 | 对齐方向 |
| --- | --- | --- |
| `apps/desktop/src/runtimes/socialRuntime.ts` | Kernel `RuntimeDescriptor` adapter，委托 `services/socialRealtime.ts` | 保持 runtime 入口，逐步让 supervisor 语义显式化 |
| `apps/desktop/src/services/socialRealtime.ts` | Auth edge、cold bootstrap、event consumption、periodic reconcile、notification/social refresh、typing sweep | 拆清 supervisor、wire adapter、projection reducer 责任 |
| `apps/desktop/src/services/socialChatRealtime.ts` | 旧 realtime bridge，处理 friend message、receipt、typing、group membership 等 | 与 `socialRealtime.ts` 去重或明确 legacy boundary |
| `apps/desktop/src/store/socialChat.ts` | friend/group sessions、messages、requests、profiles、typing、presence、E2EE、P2P 状态 | 保留成熟能力，抽离纯 projection reducer 和 normalizer 边界 |
| `apps/desktop/src/store/notification.ts` | notification list/unread projection | 与 social runtime 明确通知事件到 social refresh 的桥接 |
| `apps/desktop/src/store/navigationBadges.ts` | chat/navigation badge projection | badge 输入统一来自 social/notification projection |
| `apps/desktop/src/services/desktop_api.ts` | Desktop BFF API gateway，大量 Station/social 调用 | 收敛错误 envelope、DTO contract、normalizer |
| `apps/desktop/src/services/eventStream.ts` | Event stream bridge | 保持 generated proto decode，不向页面泄漏 stream |
| `apps/desktop/src/runtimes/desktopSocialHostAdapter.ts` | Desktop window visibility、focus、network-online、tray/system notification host event adapter | 只转换为标准 `SocialHostEvent`，交给 social runtime，不直接写 projection |
| `apps/desktop/src/pages/SocialChatPage.tsx` | Chat/contacts UI renderer | 保持 PageDescriptor + pure renderer，不新增 freshness owner |
| `packages/client-chat-core` | 跨端 chat 纯语义：message type、attachment kind、reply/thread helper、IME-safe enter、composer capability profiles、draft submit guard、display/search/edit/sender helpers、message surface timeline helpers、conversation/thread surface helpers、visual layout contract | Desktop/Mobile 都从这里读取可共享语义与聊天骨架视觉 token，宿主能力仍留在 adapter |

### 1.2 Mobile 当前映射

| 文件 / 模块 | 当前职责 | 对齐方向 |
| --- | --- | --- |
| `apps/mobile/src/features/social/socialApi.ts` | Station social/chat/notification/profile API gateway | 与 Desktop API contract 对齐 |
| `apps/mobile/src/features/social/socialWire.ts` | SSE frame + generated proto adaptation | 保持 generated proto；后续扩展普通 DTO proto 化 |
| `apps/mobile/src/features/social/socialNormalizers.ts` | Station shape/enum/timestamp/uint64/profile normalizer | 可作为 Desktop normalizer 边界参考 |
| `apps/mobile/src/features/social/socialProjection.ts` | friend requests、conversations、notifications、messages、receipts、mutations、typing reducer | 可作为双端 reducer 语义参考 |
| `apps/mobile/src/features/social/socialStore.ts` | social projection state + user commands | 保持 store owner，补 group/offline/E2EE domain |
| `apps/mobile/src/features/social/socialRuntime.ts` | reconcile、SSE、presence、typing sweep、external event dispatch | 与 Desktop supervisor 契约对齐 |
| `apps/mobile/src/runtimes/messagingRuntime.ts` | Conversation/Group projection、E2EE readiness、reconcile | 保持 Messaging 单一 descriptor；复用 social event ingress，不建立第二 supervisor |
| `apps/mobile/src/features/social/useSocialRuntime.ts` | Auth session 到 runtime lifecycle 的 hook adapter | 保持 thin adapter |
| `apps/mobile/src/runtimes/mobileNativeEventBridge.ts` | Mobile host events -> `SocialHostEvent` | 使用共享 event helper 归一化 push/deep-link/resume/notification tap，后续补 native plugin emit 闭环 |
| `apps/mobile/src/pages/ChatPage.tsx`, `ContactsPage.tsx` | UI renderer + command dispatch | 保持不拥有 freshness |
| `packages/client-chat-core` | 跨端 chat 纯语义：message type、attachment kind、reply/thread helper、IME-safe enter、composer capability profiles、draft submit guard、display/search/edit/sender helpers、message surface timeline helpers、conversation/thread surface helpers、visual layout contract | Mobile 不再为相同语义或聊天骨架视觉 token 维护独立实现 |

---

## 2. 影响面分析

### 2.1 当前双端差异矩阵

| 能力域 | Desktop 状态 | Mobile 状态 | 收敛判断 |
| --- | --- | --- | --- |
| Friend request | 已有 runtime refresh + notification signal | 已有 store/runtime/reconcile | 语义基本对齐，需统一 DTO/error |
| Friend chat | 已有 friend session/message/receipt/mutation | 已有 single chat 全链路 | 语义基本对齐，需统一 reducer contract |
| Notification | 已有 store + badge + social signal | 已有 notification center/read/delete | 需统一 unread/badge/action routing |
| Presence | 已有 presence flip projection | 已有 presence stream + seed | 需统一 TTL/seed/drop 语义 |
| Typing | 已有 typing TTL sweep | 已有 typing TTL sweep | 可抽共同 contract |
| Peer profile | 已有 cache 注释和 lazy load | 已有 profile projection | 需统一 invalidation 事件 |
| Group chat | 已有 group/session/member/unread/mutation | 已有独立 group store/runtime 与管理操作 | 保持独立 projection descriptor，补 shared supervisor 接线证据 |
| E2EE | 已有 key distribution/group sender keys | 已有 group E2EE runtime，native 全链路证据未闭合 | 保持独立 domain，补 native readback/evidence |
| P2P/relay status | Desktop 有 WebRTC/P2P 状态 | Mobile 暂无 | 属于 host/transport adapter，不改变社交业务语义 |
| Native/system notification | Desktop 部分通过 notification UI | Mobile bridge 已准备，native emit 未补 | 需统一 Host Adapter contract |
| Offline queue | 未形成统一 durable owner | 未形成统一 durable owner | `InteractionAdmission` 定义语义；平台 command runtime 持久化；`ChatOutboxItem` 仅投影 |
| Proto wire | Desktop generated proto | Mobile generated proto + 防回退 | Desktop 需补防回退检查 |
| HTTP DTO | 多处 typed service + generated proto 混用 | normalizer 兼容 JSON shape | 逐步统一 DTO contract |

### 2.2 主要风险

| 风险 | 触发方式 | 防护 |
| --- | --- | --- |
| 双端语义漂移 | 一端新增 status/enum/DTO，另一端用不同含义兼容 | proto-first + DTO contract review |
| 页面重新成为 owner | 为修 UI stale 在 page `useEffect` 加 refresh/timer | runtime projection lint/check + code review |
| Host event 污染业务 | push/deep-link 直接改 store 状态 | Host Adapter 只 dispatch standard event |
| Group 污染 friend model | 为快速上线把 group message 塞进 friend message | 独立 group projection domain |
| Normalizer 分散 | 每个组件处理 snake/camel/enum | normalizer boundary + reducer pure input |
| E2EE 生命周期混乱 | UI 直接读写 key/device 状态 | E2EE projection domain + secure storage adapter |
| 聊天视觉漂移 | Desktop/Mobile 各自写头像间距、气泡圆角、输入框几何 | `ChatVisualLayoutContract` + `test:chat-visual` |

---

## 3. 迁移策略

### Phase 1: 架构契约与防回退

目标：

- 建立本文档集作为双端社交 runtime 架构真源。
- 在 Desktop/Mobile 两端明确文件职责矩阵。
- 补齐检查规则：禁止手写 protobuf wire decode、禁止 page-local social stream/timer。

交付：

- `docs/architecture/social-runtime/` 文档集。
- Desktop social wire 防回退检查。
- 双端 page-local freshness 扫描脚本或 checklist。

### Phase 2: Projection/Normalizer 边界收敛

目标：

- Desktop 从 store/service 中拆出显式 normalizer/reducer 边界。
- Mobile 与 Desktop 对齐 message mutation、receipt、notification、typing、presence reducer 语义。
- 将 message/reply/thread/attachment/IME/composer capability/display/search/edit/sender/timeline surface/conversation surface/thread surface 等纯语义沉淀到 `packages/client-chat-core`，但不把 Desktop/Mobile 的宿主能力实现或 UI 交互放进共享包。
- 将头像距离、气泡圆角、hover 工具桥接区、composer 浮动几何等聊天骨架视觉 token 沉淀到共享 contract；平台 renderer 只消费 token。

交付：

- Desktop `socialNormalizers` / `socialProjection` 等等价边界，或共享 package 的候选接口。
- 双端 reducer case matrix。
- `packages/client-chat-core` 作为共享语义与视觉骨架 contract 包；Desktop/Mobile 只保留平台 adapter 与 renderer。

### Phase 3: Host Adapter 闭环

目标：

- Desktop 和 Mobile 都通过 `SocialHostAdapter` 进入 runtime。
- Mobile native push/deep-link/notification tap 插件 emit 标准事件。
- Desktop tray/system notification/window focus 转标准事件。
- `SocialHostEvent` 归一化 helper 进入 `packages/client-chat-core`，双端 adapter 只负责宿主事件采集。

交付：

- `dispatchExternalEvent` 双端语义一致。
- host event 不直接写业务 projection。

### Phase 4: Group / Command Projection / E2EE Domain

目标：

- Group chat 独立 projection domain。
- Offline command status projection backed by platform `InteractionAdmission`。
- E2EE key/device/message crypto projection domain。

交付：

- Mobile group chat parity。
- `packages/client-chat-core` 提供 `ChatE2eeProjection` 与 `ChatOutboxItem`
  纯 reducer，作为双端 E2EE readiness/error 与 durable-command visible
  state；它不拥有持久化或重放。
- 双端 platform command runtime 负责 bounded admission、retry/readback 和
  reconcile。
- 双端 E2EE failure/status projection。

---

## 4. 兼容策略

- 不一次性抽 runtime 公共包；允许先抽不依赖宿主、不读写 store 的纯语义包。
- 双端现有 API 可继续工作，但新增接口必须声明所属抽象层。
- Store 字段可以不同名，但 projection 语义必须能映射。
- 任何 Station response shape 兼容都只能在 normalizer，不进入 UI。
- 已有 Desktop group/E2EE/P2P 能力不回退；Mobile 追齐时按独立 domain 接入。
