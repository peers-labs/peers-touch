# Mobile Group E2EE Domain Execution Plan

> Status: active plan  
> Date: 2026-06-03  
> Scope: `apps/mobile/src/features/group/`, `apps/mobile/src-tauri/`, generated chat proto, social runtime integration

## 1. 真实目标

Mobile group chat 不能只做到“能看到群列表/群消息”，必须与 Desktop 的 Sender Keys 架构同语义：

- Station 只保存和转发 `GroupMessage.encrypted_payload`，不拥有群消息明文。
- Web UI 不实现加解密、不判断协议细节，只消费 projection 产物。
- Group store 不保存“临时解密状态机”，只保存消息 projection 与 E2EE projection 结果。
- Rust capability kernel 承载 sender-key 密钥、ratchet、签名验证和本地安全持久化。
- Friend-chat control message type `50` 是 SKDM carrier，进入 E2EE domain 后再触发 group projection repair。

非目标：

- 不把群消息塞回 friend chat bucket。
- 不用 plaintext fallback 伪装为已支持加密发送。
- 不在 UI 里调用 `GroupCiphertextSchema` / `SenderKeyDistributionMessageSchema` 做协议解析。
- 不引入 Flutter/Dart 或平台私有 UI 路径。

## 2. 领域责任

| Domain | Owner | Responsibility | Explicitly not responsible for |
| --- | --- | --- | --- |
| Group API Gateway | `features/group/groupApi.ts` | Station `/group-chat/*` HTTP contract，传输 `encrypted_payload` | 加密、解密、SKDM 分发 |
| Group Wire Contract | generated `group_chat_pb.ts` | `GroupCiphertext` / `SenderKeyDistributionMessage` 类型真源 | 手写 field-number decoder |
| Group E2EE Kernel | `src-tauri/src/domain/crypto/` | Sender chain、SKDM consume/emit、encrypt/decrypt、signature verify、secure local persistence | UI 文案、HTTP 调用、runtime 调度 |
| Group E2EE Bridge | `features/group/groupE2eeBridge.ts` | Web 到 Rust command 的 typed adapter，统一错误码 | 存 projection state |
| Group E2EE Runtime | `features/group/groupE2eeRuntime.ts` / `groupE2eeLedger.ts` | SKDM 分发、durable pending/sent ledger、redecrypt queue、rotation trigger、repair scheduling、`canEncrypt` gate | React rendering |
| Group Projection | `groupProjection.ts` / `groupStore.ts` | 消息 merge、mutation、read/unread、display projection | 直接解密、直接解析密文协议 |
| Social Runtime Integration | `socialRuntime.ts` | 将 friend control message / group realtime event 路由到 E2EE runtime | 直接写 decrypted content |
| Host Adapter | Mobile native events | resume/push/deep-link 后触发 runtime repair | 直接改 group projection |

## 3. 执行闭环

发送链路：

1. UI 触发 group send command，只传 `groupUlid` 与 plaintext draft 给 group command 层。
2. Group E2EE runtime 读取 group members，调用 bridge `emitSkdm(groupUlid)` 确保本地 sender chain 存在。
3. Runtime 通过 friend-chat control type `50` 向成员分发 sealed SKDM，记录 secure-storage backed per member pending/sent ledger；任一非自身成员缺少 key bundle 或发送失败时，`canEncryptGroup` 不得开放 composer。
4. Runtime 调用 bridge `encrypt(groupUlid, plaintext)` 得到 `GroupCiphertext` bytes。
5. Group API 发送 `content=''` 与 `encrypted_payload`，Station 只见 opaque payload。
6. Group store ingest Station response/realtime echo，只保存 normalized message 与 display projection。

接收链路：

1. Friend realtime/control message type `50` 进入 Group E2EE runtime。
2. Runtime 先按 Desktop 同语义打开 `GROUP_SKDM` signaling envelope，再调用 bridge `consumeSkdm(senderDid, skdmBytes)` 安装 sender chain。
3. Runtime 发布 projection repair signal，重新尝试 decrypt pending group messages。
4. Group message realtime/list response 进入 group store。
5. Group E2EE runtime 对有 `encrypted_payload` 的消息执行 decrypt，成功后向 projection 写入 decrypted display result；缺 SKDM 则进入 pending decrypt queue。
6. UI 只渲染 projection display result：text / encrypted-waiting / recalled / empty。

成员变更链路：

1. `GroupMembershipChange.REMOVED/LEFT` 进入 social runtime。
2. 当前用户仍在群内时，Group E2EE runtime 调用 bridge `rotate(groupUlid)`。
3. Runtime 清理 sent ledger，下一次发送或 repair tick 重新分发 SKDM。
4. 删除成员不再收到新 SKDM，因此只能看到后续 opaque payload。

## 4. 依赖顺序

1. **Proto/Wire guardrail**：确认 Mobile generated proto 覆盖 `GroupCiphertext` / `SenderKeyDistributionMessage`，禁止 UI/store 手写解析。
2. **Rust crypto kernel**：从 Desktop sender-key primitive 抽象可复用实现，Mobile 先落 sender-key primitive 与安全持久化，再注册 `crypto_group_sk_*` command 边界。
3. **Web bridge**：新增 typed command adapter，所有 Rust error 转成 typed domain error，不给 UI 裸字符串。
4. **Runtime orchestration**：新增 SKDM sent/pending ledger、consume/repair queue、rotation trigger。
5. **Projection repair**：group store 接受 E2EE runtime 的 decrypted display projection，不直接解密。
6. **Send UI unlock**：只有 E2EE send path 闭环后，Chat group composer 才从 readonly 打开。

## 5. 交付物

Phase A: 防回退与边界

- `groupProjection.ts` 暴露 group message display projection，页面不读 `encryptedPayload`。
- Mobile social wire check 增加 `GroupCiphertextSchema` / `SenderKeyDistributionMessageSchema` generated proto 要求。
- Runtime boundary check 禁止 `apps/mobile/src/pages/**` 直接引用 group crypto proto 或 Tauri crypto command。

Phase B: Rust kernel

- `src-tauri/src/domain/crypto/sender_keys.rs`：Sender Keys primitive。（已从 Desktop 纯 Rust primitive 对齐落地，作为 Mobile capability kernel domain surface。）
- `src-tauri/src/commands/group_crypto.rs`：`crypto_group_sk_emit_skdm`、`crypto_group_sk_consume_skdm`、`crypto_group_sk_rotate`、`crypto_group_encrypt`、`crypto_group_decrypt`。（已落地 typed JSON command boundary；Rust 不新增 protobuf decode。）
- `src-tauri/src/domain/crypto/sender_key_store.rs`：per-user scoped sender chain/skipped-key persistence，必须使用平台安全存储或加密本地库，不落 plaintext key 文件。（已落地 Keychain namespace + chain/skipped indexes；后续 command 层复用。）
- `src-tauri/src/domain/crypto/identity_keys.rs` / `signaling_envelope.rs`：Mobile identity key、signed prekey、stateless authenticated envelope。（已落地；与 Desktop `GROUP_SKDM` envelope 语义对齐。）
- `src-tauri/src/commands/key_exchange.rs`：identity bundle 与 signaling envelope command。（已注册 `crypto_identity_key_bundle`、`signaling_envelope_seal`、`signaling_envelope_open`。）

Phase C: Web/runtime

- `features/group/groupE2eeBridge.ts`：typed Rust command adapter。（已落地；Web bridge 使用 generated TS proto 负责 `GroupCiphertext` / `SenderKeyDistributionMessage` bytes 编解。）
- `features/group/groupKeyExchange.ts`：key bundle publish/fetch 与 `GROUP_SKDM` signaling envelope Web adapter。（已落地；runtime consume 不再接受裸 SKDM carrier。）
- `features/group/groupE2eeRuntime.ts` / `groupE2eeLedger.ts`：SKDM distribution、consume、repair、rotation。（已落地 encrypted-payload decrypt repair owner；已接入 type `50` sealed SKDM consume、outbound sealed SKDM fanout、encrypted group send command、membership rotation hook、secure-storage durable sent/pending ledger 与 `canEncrypt` gate。）
- `features/social/socialRuntime.ts`：friend type `50` control routing 与 group membership rotation hook。（已接入；runtime 只路由，不写 decrypted projection。）
- `features/group/groupStore.ts`：接收 decrypted display projection，不保存 crypto internals。（已新增 decrypted message projection、E2EE error projection、group recall/delete command 与 encrypted edit runtime command 入口。）

Phase D: UX unlock

- Group composer only enables after runtime send command is wired to UI and `groupE2eeRuntime.canEncryptGroup(groupUlid)` / durable SKDM ledger mark the group ready.
- Missing SKDM 状态显示为 localized projection state，不暴露协议细节。
- Group send/edit/recall/delete 与 Desktop 语义对齐；send/edit 不向 Station 写 plaintext `content`，edit 由 E2EE runtime 生成 `new_encrypted_payload` 后再调用 group API。

## 6. 验收标准

- `pnpm --dir apps/mobile run check:web` 通过，且 guardrail 能阻止 UI/page 解析 group crypto proto。
- `pnpm --dir apps/mobile run check:rust` 通过，Rust command 已注册且无 dead command。
- 发送群消息时 Station request body `content` 为空，`encrypted_payload` 非空。
- 未收到 SKDM 的设备显示 encrypted-waiting projection；收到 SKDM 后 runtime repair 自动恢复明文显示。（consume + repair 已接入，UX projection 继续完善。）
- 成员移除后，本设备 rotate sender chain，后续消息使用新 `sender_key_id`。（rotation hook 与 encrypted send command 已接入，后续以端到端场景验证 sender_key_id。）
- 页面没有 `refreshGroups/loadMessages/reconcile` freshness patch，也没有 crypto command 调用。

## 7. 反模式

- UI 中使用 `fromBinary(GroupCiphertextSchema, ...)`。
- Store action 中直接保存 sender chain 或 skipped message key。
- 为了“先能发”把 group send 退回 plaintext `content`。
- 用 localStorage 保存密钥。
- 在 push/resume handler 中直接解密并写 UI state。
