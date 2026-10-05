# Social Runtime Alignment — 架构设计

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-03 | **Updated**: 2026-08-27
> **Owner**: Client Architecture Team
> **Module**: `apps/desktop/src/runtimes/socialRuntime.ts`, `apps/mobile/src/features/social/`

---

## 1. 核心原则

1. **同一业务抽象，不同宿主 adapter**
   Desktop 与 Mobile 可以有不同宿主入口，但不能有不同社交领域模型。

2. **Station truth, client projection**
   好友、会话、消息、通知、profile、presence 的权威状态来自 Station；客户端只维护可恢复、可重放、可 reconcile 的 projection。

3. **Runtime owns freshness**
   社交 freshness 属于 runtime supervisor，不属于页面 mount、tab click、drawer open 或按钮回调。

4. **Generated contracts first**
   protobuf 只能来自 `model/domain/` 生成物；禁止手写 protobuf wire decoder、field number map 或端侧平行模型。

5. **Pure projection before UI**
   merge、bucket、receipt、mutation、typing prune、badge 计算必须先在 reducer/store 层闭合，UI 只读 projection。

6. **Shared visual contract, platform renderer**
   聊天骨架视觉语义（头像尺寸、头像与消息距离、气泡圆角、hover 工具桥接区、输入框浮动几何）必须来自共享 contract；Desktop/Mobile 只能在 renderer 或宿主 adapter 中消费这些 token，不能各自重新定义一套同义布局。

7. **One Chat business owner**
   Conversation 是唯一 Chat 业务入口并暴露 `/conversation/*`。Device、
   Inbox、Recovery、Key Exchange 与 Federation 由各自 resource owner 暴露
   `/device/*`、`/device/inbox/*`、`/recovery/*`、`/key-exchange/*` 与
   peer-only `/federation/*`。端侧 Messaging Engine 只是内部 runtime。

---

## 2. 系统架构

```text
                         Station
       social/chat/notification/profile/presence truth
                             |
                             v
                    Social API Gateway
             HTTP / SSE / protobuf contract entry
                             |
                             v
                    Social Wire Contract
           generated proto + SSE frame adaptation only
                             |
                             v
                    Social Normalizer
        snake/camel, enum, timestamp, uint64, error envelope
                             |
                             v
                 Social Projection Reducer
      conversations, requests, notifications, receipts, mutations
                             |
                             v
                  Social Projection Store
       long-lived state, derived command status, projection updates
                             |
                             v
                 Social Runtime Supervisor
      shared event ingress, bootstrap, reconcile, teardown, repair
                             |
                             v
                 InteractionAdmission
       platform command runtime + durable ledger adapter
                             |
                +------------+------------+
                |                         |
                v                         v
      Desktop Social Host Adapter   Mobile Social Host Adapter
      window/tray/focus/badge       WebView resume/push/deep-link
                |                         |
                v                         v
          Desktop UI Renderer       Mobile UI Renderer
```

约束：

- 上图从上到下是依赖方向；下层不得绕过上层直接读写 Station truth。
- Desktop/Mobile 不一定共享同一个 TypeScript 文件，但必须共享同一语义接口。
- Host Adapter 只翻译宿主事件，不定义社交业务规则。
- `groupRuntime` may be a separate Mobile descriptor, but it remains a
  subordinate group projection owner under the shared social event supervisor.
- Offline command reducers project the platform command ledger; they do not
  persist or replay a second outbox.

---

## 3. 核心接口

### 3.1 Social Runtime Supervisor

```ts
interface SocialRuntimeSupervisor {
  install(): void;
  teardown(): void;
  bootstrap(identity: SocialIdentity | null): Promise<void>;
  reconcile(reason: SocialReconcileReason): Promise<void>;
  dispatchExternalEvent(event: SocialHostEvent): void;
}
```

语义：

- `install` 注册 runtime 级订阅、host adapter bridge、timer，必须幂等。
- `bootstrap` 在 authenticated identity edge 触发，负责 cold projection load。
- `reconcile` 从 Station truth 修复 missed SSE、后台挂起、网络恢复、窗口隐藏导致的 projection 漂移。
- `dispatchExternalEvent` 接收 host adapter 事件，只能触发 targeted refresh 或 debounced reconcile。

### 3.2 Social API Gateway

```ts
interface SocialApiGateway {
  listFriendRequests(): Promise<FriendRequestContract[]>;
  listSessions(): Promise<FriendSessionContract[]>;
  listNotifications(cursor?: string): Promise<NotificationPageContract>;
  listMessages(sessionUlid: string, cursor?: string): Promise<FriendMessagePageContract>;
  sendMessage(command: SendMessageCommand): Promise<FriendMessageContract>;
  mutateMessage(command: MessageMutationCommand): Promise<void>;
  loadPeerProfile(peerDid: string): Promise<PeerProfileContract>;
}
```

语义：

- API Gateway 不持有 UI 状态。
- API Gateway 不做 projection merge。
- Gateway 返回 contract shape，兼容逻辑进入 normalizer。

### 3.3 Social Projection Reducer

```ts
interface SocialProjectionReducer {
  mergeMessages(state: MessageProjectionState, messages: MessageContract[]): MessageProjectionState;
  applyReceipt(state: MessageProjectionState, receipt: ReceiptContract): MessageProjectionState;
  applyMutation(state: MessageProjectionState, mutation: MessageMutationContract): MessageProjectionState;
  projectFriendRequests(requests: FriendRequestContract[], currentUserDid: string): FriendRequestBuckets;
  projectNotifications(notifications: NotificationContract[]): NotificationProjection;
  pruneTypingPeers(state: TypingProjectionState, staleBeforeMs: number): TypingProjectionState;
}
```

语义：

- reducer 必须是纯函数。
- reducer 不发请求、不读 storage、不读 window/document、不访问 Tauri API。
- Desktop/Mobile reducer 结果语义必须一致，即使内部类型名称不同。

### 3.4 Social Host Adapter

```ts
interface SocialHostAdapter {
  install(dispatch: (event: SocialHostEvent) => void): () => void;
}

type SocialHostEvent =
  | { kind: 'app-resume'; reason: string }
  | { kind: 'network-online'; reason: string }
  | { kind: 'notification-tap'; notificationId?: string; sessionUlid?: string }
  | { kind: 'push'; notificationId?: string; sessionUlid?: string }
  | { kind: 'deep-link'; url: string };
```

Current shared event contract lives in `packages/client-chat-core` so Desktop and Mobile normalize host payloads with the same pure helpers before entering their runtime supervisors.

Desktop adapter 来源：

- window focus / visibility。
- tray 或 system notification click。
- dock/taskbar badge 或 native app lifecycle。

Mobile adapter 来源：

- WebView visibility/focus/network。
- Tauri `RunEvent::Resumed`。
- iOS/Android push。
- deep-link / universal link / app link。
- notification tap。

### 3.5 Chat Visual Layout Contract

`packages/client-chat-core` owns the pure `ChatVisualLayoutContract`.

It covers stable chat geometry:

- message avatar size/radius/gap;
- own/peer/group row max width;
- own/peer bubble radius and padding;
- media-only bubble padding;
- hover action bridge hit area;
- composer outer padding, radius, shadow, input height, and tool button size;
- whether a host composer exposes attachment tools.

Rules:

- The contract is pure data/functions. It must not import React, DOM, Tauri, CSS files, proto, store, or i18n.
- Desktop and Mobile renderers may map contract values into inline style or CSS variables.
- Host-specific visual treatment is allowed only after the shared semantic token is chosen.
- New chat surfaces must pick an explicit `ChatVisualSurface` instead of hardcoding independent geometry.

---

## 4. 组件关系

| 层级 | Desktop 当前映射 | Mobile 当前映射 | 对齐要求 |
| --- | --- | --- | --- |
| API Gateway | `services/desktop_api.ts`, `services/social_api.ts` | `features/social/socialApi.ts` | 统一错误 envelope、DTO contract、endpoint 语义 |
| Wire Contract | `services/eventStream.ts`, generated proto decode in `socialRealtime.ts` | `socialRealtime.ts`, `socialWire.ts`, generated proto | 双端都使用 generated proto；禁止手写 wire decode |
| Normalizer | 分散在 service/store 兼容逻辑中 | `socialNormalizers.ts` | Desktop 需要收敛出显式 normalizer 边界 |
| Projection Reducer | 部分在 `store/socialChat.ts` 和 `services/socialRealtime.ts` | `socialProjection.ts` | 双端 reducer 语义对齐，避免页面计算长期状态 |
| Projection Store | `store/socialChat.ts`, `store/notification.ts`, `store/navigationBadges.ts` | `socialStore.ts` | 可多 store，但 owner 和字段不得重叠 |
| Runtime Supervisor | `runtimes/socialRuntime.ts` + `services/socialRealtime.ts` | `socialRuntime.ts` + `useSocialRuntime.ts` | supervisor 负责 streams/timers/reconcile/teardown |
| Host Adapter | `runtimes/desktopSocialHostAdapter.ts` | `mobileNativeEventBridge.ts` | 平台差异只进入 adapter，进入 runtime 前统一成 `SocialHostEvent` |
| UI Renderer | `SocialChatPage`, chat components, `NotificationBell` | `ChatPage`, `ContactsPage`, `MobileNotificationCenter` | UI 不拥有 freshness |

---

## 5. Endpoint / Event Families

双端社交 runtime 至少覆盖以下业务族：

| 业务族 | 真源 | Runtime projection | Host adapter 是否参与 |
| --- | --- | --- | --- |
| Friend request | Station Social API | request buckets, contacts badge | 否 |
| Direct Conversation | Station Conversation API + event stream | sessions, messages, unread, receipts, mutations | 否 |
| Notification | Station notification API + event stream | list, unread counts, action routing | notification tap/push 只作为 wakeup |
| Profile | Station actor profile API | peer profile cache + invalidation | 否 |
| Presence | Station presence stream + session seed | peer online map | 否 |
| Typing | realtime event | ephemeral typing map + TTL prune | 否 |
| Group Conversation | Station Conversation API + event stream | group projection domain | 否 |
| Offline command | Station command APIs + Frontend `InteractionAdmission` | derived outbox/pending/unknown projection | network-online 作为 wakeup |
| Device delivery | Station Device Inbox API + local Messaging Engine | ordered inbox and delivery projection | network-online 作为 wakeup |
| E2EE | Station Key Exchange API + local crypto | key/device/message crypto projection | host secure storage 只存本地 secret |

---

## 6. 禁止模式

- 页面或组件直接开启 `/events/stream`、presence stream 或长期 `setInterval` 刷社交真源。
- notification badge 和 Contacts request list 从不同输入独立计算。
- 一端使用 generated proto，另一端手写 protobuf field number。
- Host Adapter 直接修改 friend request、message、notification projection。
- 为 Mobile 或 Desktop 单独发明同义但不兼容的 message status、notification status、friend request status。
- 把 group chat 塞进 friend chat 字段做兼容扩展。
- 用“重新打开页面刷新”作为 missed event repair。
