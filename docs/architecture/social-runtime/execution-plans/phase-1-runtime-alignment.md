# Phase 1: 双端 Social Runtime Alignment

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-03 | **Updated**: 2026-06-07
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
| Desktop runtime 单入口 | `socialRealtime` 统一接管遗留 chat bridge | 已删除 `services/socialChatRealtime.ts` 的 App 直装入口，ACK、SKDM、group membership 副作用迁入 runtime owner |
| Desktop projection 分层 | `socialChat` store 与纯 projection reducer 分离 | 已新增 `apps/desktop/src/store/socialProjection.ts`，承载 message merge、receipt、mutation、typing GC、local-clear 过滤等纯状态机 |
| Desktop normalizer 分层 | `socialChat` store 与 Station response 兼容逻辑分离 | 已新增 `apps/desktop/src/store/socialNormalizers.ts`，先承载 friend session、friend request、presence seed 归一化 |
| Mobile Host Adapter 入口 | Rust kernel 统一 emit native host event | 已补 `mobile_native_event_emit` command 与 `native_events` push/deep-link/notification-tap/resume 标准 payload，Web bridge 保留 deep-link `url` 字段 |
| Shared Host Adapter contract | `SocialHostEvent` 标准事件 helper | 已沉淀到 `packages/client-chat-core`，Desktop/Mobile adapter 共用 payload normalize / notification target / reconcile reason helper |
| Desktop Host Adapter 入口 | window/tray/system notification host event adapter | 已新增 `apps/desktop/src/runtimes/desktopSocialHostAdapter.ts` 并由 `runtimes/socialRuntime.ts` 安装，host event 只进入 runtime external event |
| Mobile group domain | 独立 group API / normalizer / projection / store / runtime / renderer | 已新增 `apps/mobile/src/features/group/`，使用 generated group proto 类型，不复用 friend chat bucket，并已接入 realtime group message / membership / mutation / resync；Chat/Contacts UI 已只读接入 group projection |
| Mobile group E2EE domain | Sender Keys 执行计划与防回退入口 | 已新增 `20260603-mobile-group-e2ee-domain.md`，明确 Rust kernel / Web bridge / runtime / projection 分层，并把 group E2EE proto/页面边界加入 guardrail |

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

- 已标记 `services/socialChatRealtime.ts` 与 `services/socialRealtime.ts` 的职责重叠。
- 已确认并落地一个 runtime supervisor 入口：`runtimes/socialRuntime.ts` → `services/socialRealtime.ts`。
- 已将遗留 bridge 的唯一职责迁入 `socialRealtime`：
  - friend message auto `DELIVERED` ack；
  - `GROUP_SKDM_INSTALLED` 后群消息重解密；
  - peer online 后 SKDM retry；
  - group membership 变更后的 sender-chain rotation、active group 清理与 roster refresh。
- 已移除 `App.tsx` 对 `services/socialChatRealtime.ts` 的直接安装，并删除该遗留 bridge。
- 已把 Desktop projection reducer 候选从 `store/socialChat.ts` 初步抽出：
  - `mergeConversationMessages`
  - `filterClearedMessages`
  - `applyMessageReceiptToList`
  - `applyMessageMutationToList`
  - `applyTypingStateToMap`
  - `pruneTypingPeers`
  - `previewFromMessage`
- 已把 Desktop Station response normalizer 第一批从 `store/socialChat.ts` 抽出：
  - `normalizeFriendChatSession`
  - `normalizeFriendRequests`
  - `normalizeFriendRequestData`
  - `seedPresenceFromSessions`
- 下一步继续抽 Desktop normalizer：search result、profile response 等 Station response shape 兼容逻辑不应长期留在 store action 内。

### Step 4: Mobile group domain 入口

- Mobile group chat 已进入独立 group projection domain 起步：
  - `groupApi.ts`：直接对接 Station `/group-chat/*` HTTP 路由；
  - `groupNormalizers.ts`：归一化 `Group`、`GroupMember`、`GroupMessage`；
  - `groupProjection.ts`：承载 group conversation、message merge、mutation reducer；
  - `groupStore.ts`：承载 groups、members、messages、unread、active group projection；
  - `groupRuntime.ts`：在 auth 边界冷启动与周期 reconcile；
  - `useSocialRuntime.ts`：同一 session 边界同时启动 social runtime 与 group runtime。
- 已扩展 `socialWire.ts` / `socialRealtime.ts`：
  - 同一 `MessageEnvelope` 使用 generated proto decoder 区分 friend message 与 group message；
  - `GroupMembershipChange` 进入 group projection refresh；
  - message mutation 同时投递 friend reducer 与 group reducer；
  - resync 同时触发 social/group reconcile。
- Chat/Contacts UI 已接入 group projection renderer：
  - 新增 `groupSelectors.ts` 作为 UI 只读 selector 入口；
  - `ChatPage.tsx` 合并 friend/group conversation renderer，但 friend 与 group state bucket 仍独立；
  - `ContactsPage.tsx` 增加 group section，选择群组只进入 `groupStore.selectGroup`；
  - 页面未新增 `refreshGroups`、`loadMessages`、`reconcile` 等 freshness owner。
- 群组发送/解密仍不在 UI/store 临时处理，下一步进入 Mobile group E2EE sender-key domain 设计与实现。

### Step 5: Mobile Host Adapter

- Mobile native push/deep-link/notification tap 已具备 Rust kernel 标准 emit 入口：
  - `mobile:push`
  - `mobile:deep-link`
  - `mobile:notification-tap`
  - `mobile:resume`
- 后续 iOS/Android 插件只接系统 API，不直接写业务 projection，统一调用 kernel event outlet。
- Mobile E2EE/offline queue 不在页面补逻辑，必须建 domain。

### Step 5.5: Shared/Desktop Host Adapter

- 已将 `SocialHostEvent`、payload normalize、notification targeting、reconcile reason helper 放入 `packages/client-chat-core`。
- Mobile `mobileNativeEventBridge.ts` 改为使用共享 helper，不再端内维护同义事件类型。
- Desktop 新增 `desktopSocialHostAdapter.ts`，覆盖：
  - document visibility visible；
  - window focus；
  - browser online；
  - `desktop:resume`；
  - `desktop:tray-open`；
  - `desktop:notification-tap`。
- Desktop `socialRuntime.ts` 安装 adapter，并把 event 投递给 `socialRealtime.dispatchSocialRuntimeHostEvent`。
- Desktop runtime external event 只触发 targeted message refresh、notification refresh 和 debounced `refreshSocialProjection`，不从 host adapter 直接写业务 projection。

### Step 6: Mobile group E2EE domain

- 已新增 Mobile group E2EE domain 执行计划：`20260603-mobile-group-e2ee-domain.md`。
- 已按 Desktop Sender Keys 现状对齐 Mobile 目标分层：
  - Rust capability kernel 承载 sender chain、SKDM、encrypt/decrypt、signature verify；
  - Web bridge 只做 typed command adapter；
  - group E2EE runtime 负责 SKDM sent/pending ledger、repair queue、rotation trigger；
  - group projection/store 只接收 display projection，不解析或持有 crypto internals；
  - UI 只渲染 text / encrypted / recalled / empty projection。
- 已把第一批防回退放入检查：
  - `check-social-wire-contract.sh` 要求 Mobile generated group proto 暴露 `GroupCiphertextSchema` 与 `SenderKeyDistributionMessageSchema`，并要求 `socialWire.ts` 使用 generated `GroupMessageSchema`；
  - `check-social-runtime-boundaries.sh` 禁止 Mobile UI pages/components 直接引用 group E2EE proto 或 crypto command。
- 已落地 Rust kernel 第一块底座：
  - 新增 `apps/mobile/src-tauri/src/domain/crypto/sender_keys.rs`，对齐 Desktop Sender Keys pure primitive；
  - `domain` 作为 Mobile capability kernel 的公开 domain surface 暴露，尚未注册 crypto command，避免半闭环 API 被误用；
  - `check:rust` 已通过且无 dead-code warning。
- 已落地 sender-key 安全持久化底座：
  - 新增 `apps/mobile/src-tauri/src/domain/crypto/sender_key_store.rs`；
  - 使用平台 `SecureStorage` 的 Keychain namespace 存储 chain/skipped-key record；
  - 通过 chain/skipped index 支持 exact load、latest local chain、max sender key id、decrypt outcome apply；
  - 不使用 localStorage，不落明文 key 文件。
- 已落地 crypto command / Web bridge 边界：
  - 新增 `apps/mobile/src-tauri/src/commands/group_crypto.rs`，注册 `crypto_group_sk_emit_skdm`、`crypto_group_sk_consume_skdm`、`crypto_group_sk_rotate`、`crypto_group_encrypt`、`crypto_group_decrypt`；
  - Rust command 只收发 typed JSON fields，不新增 Rust protobuf decode；
  - 新增 `apps/mobile/src/features/group/groupE2eeBridge.ts`，由 Web generated TS proto 负责编解 `GroupCiphertext` / `SenderKeyDistributionMessage` bytes；
  - 已补 E2EE missing actor/group locale key。
- 已落地 group E2EE runtime repair owner：
  - 新增 `apps/mobile/src/features/group/groupE2eeRuntime.ts`，由 group runtime 启停；
  - 周期扫描 group projection 中的 encrypted payload，调用 bridge decrypt，成功后写入 decrypted display projection；
  - `groupStore` 只新增 `applyDecryptedMessage` / `e2eeErrors` projection，不持有 sender chain 或 crypto internals；
  - 页面仍只消费 display projection，不调用 crypto bridge。
- 已接入 group E2EE runtime orchestration 第一段：
  - `groupRuntime` 暴露同一个 E2EE controller 给 `socialRuntime`，保持 runtime owner 单一；
  - friend control message type `50` 由 `socialRuntime` 路由到 `groupE2eeRuntime.consumeSkdmControlMessage`，不会进入 visible friend projection；
  - `GroupMembershipChange.REMOVED/LEFT` 由 runtime 触发 `rotateAfterMembershipChange`，避免 UI/store 直接调用 crypto；
  - friend/group normalizer 已归一化 Station JSON base64 `encryptedPayload`，list/realtime 两条路径都可承载 generated proto bytes。
- 已补 Mobile group SKDM 的 authenticated carrier 前置能力：
  - 新增 Mobile identity key / signed prekey secure-storage domain，并通过 `crypto_identity_key_bundle` 生成 Station key-exchange upload payload；
  - 新增 Mobile `signaling_envelope_seal/open` Rust command，与 Desktop `GROUP_SKDM` signaling envelope 语义对齐；
  - 新增 `features/group/groupKeyExchange.ts`，runtime 启动时发布 key bundle，入站 type `50` 先拉取 sender bundles 并 open envelope，再 consume SKDM；
  - 明确关闭裸 SKDM carrier 路径，后续 SKDM outbound distribution 在这个 envelope 边界上继续实现。
- 已接入 Mobile group encrypted send command 边界：
  - `groupApi.sendMessage` 只发送 `content=''` + `encrypted_payload`，对齐 Station group E2EE invariant；
  - `socialApi.sendSenderKeyDistribution` 只作为 friend-chat type `50` control transport，不进入 visible friend projection；
  - `groupE2eeRuntime.sendEncryptedMessage` 负责 SKDM fanout、group plaintext encrypt、Station send 与 projection ingest；
  - `groupE2eeLedger.ts` 使用 Mobile secure storage 记录 per-recipient SKDM `pending/sent` ledger，runtime rotation 会清理 group ledger；
  - `groupE2eeRuntime.canEncryptGroup` 作为 projection-safe gate，`groupStore` 只暴露 `encryptionReady/sendingGroups` 与 encrypted send command；
  - Chat group composer 只在 gate ready 后开放，UI 不调用 SKDM、proto crypto schema 或 Tauri crypto command。
- 已补 Mobile group message mutations：
  - recall/delete 走独立 group API/store command，不复用 friend chat bucket；
  - edit 由 `groupE2eeRuntime.editEncryptedMessage` 加密 plaintext draft，再调用 `/group-chat/message/edit` 写入 `new_encrypted_payload`；
  - Chat UI 只触发 group store command，并继续消费 group projection reducer。
- 已补 Mobile group management 入口：
  - `groupApi` / `groupStore` 新增 invite / leave / remove member command；
  - Chat group header 提供成员管理 modal，页面只调用 group store command；
  - 成员变更仍通过 runtime membership event 触发 group projection refresh 与 E2EE rotation。
- 已补 Mobile group create/update/settings 入口：
  - `groupApi` / `groupStore` 新增 create / update / my-settings command；
  - Contacts 提供创建群入口，创建成功后进入独立 group projection；
  - Chat group management modal 支持群资料、全员禁言、个人免打扰/置顶/成员昵称显示设置。

### Step 7: 验证

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
2. Host Adapter 闭环：补 iOS/Android native plugin emit 与 Desktop native tray/system notification event emit。
3. Group domain：Mobile 追齐 Desktop group chat，但按独立 domain 实现。
4. Offline/E2EE domain：从架构设计进入实现计划，不做页面补丁。
