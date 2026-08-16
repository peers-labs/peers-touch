# Messaging Platform — 产品状态模型

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-08-08 | **Updated**: 2026-08-16
> **Owner**: Messaging Platform Team

---

## 1. Message State

```text
draft
  -> queued
  -> submitting
  -> accepted
  -> consumed
  -> delivered
  -> read

queued/submitting -> retrying -> submitting
queued/submitting -> failed_actionable
```

| ID | 状态 | 用户含义 | 允许动作 |
|---|---|---|---|
| MP-S01 | draft | 尚未被系统接受 | 编辑、取消、发送 |
| MP-S02 | queued | 已持久化，等待提交 | 取消、查看原因 |
| MP-S03 | submitting | 正在提交 authority | 等待 |
| MP-S04 | retrying | 临时失败，系统重试 | 查看、取消 |
| MP-S05 | accepted | authority 已提交 | 查看详情 |
| MP-S06 | consumed | 目标设备已安全保存 | 查看 receipt |
| MP-S07 | delivered | 至少一个目标 active device consumed | 查看设备状态 |
| MP-S08 | read | 目标 actor 已阅读 | 无 |
| MP-S09 | failed_actionable | 未接受或终态失败 | 修复、重试、保留 draft |

## 2. Receive State

```text
notified -> pending -> claimed -> processing -> committed -> acked
                                  |
                                  +-> waiting_dependency
                                  +-> retryable_failure
                                  +-> terminal_corrupt
```

`notified` 不是可靠状态，只代表 SSE/push wake-up。UI 只显示从 Device Engine durable
projection 得出的状态。

## 3. Security State

| ID | 状态 | 含义 | 发送权限 |
|---|---|---|---|
| MP-S20 | initializing | identity/device 尚在初始化 | 禁止 |
| MP-S21 | waiting_for_device | 无 active target/bundle | 禁止 |
| MP-S22 | waiting_for_session | Direct session 尚未 ready | 禁止 |
| MP-S23 | waiting_for_epoch | MLS transition 尚未对齐 | 禁止 |
| MP-S24 | ready | 所有 required endpoints 可用 | 允许 |
| MP-S25 | retrying | transient crypto/transport failure | 禁止新推进 |
| MP-S26 | crypto_desynced | authority/local state 不一致 | 禁止 |
| MP-S27 | corrupt_ciphertext | 已证明不可恢复损坏 | 禁止该 item，允许诊断 |
| MP-S28 | revoked | 当前设备已撤销 | 全部禁止 |

## 4. Device State

```text
enrolling -> active -> rotating -> active
                  \-> revoke_pending -> revoked
recovery_enrolling -> active
```

Station registry 是 active/revoked truth；设备本地只能投影，不能自行恢复 active。

## 5. Queue State

```text
pending -> claimed -> consumed -> acked -> garbage_collected
             |
             +-> lease_expired -> pending
             +-> retry_wait -> pending
             +-> dead_letter
```

规则：

- 同一 device lane 同时只有一个有效 consumer lease。
- 当前 sequence 未 consumed 时，后续 sequence 不得越过。
- dead-letter 必须是可观察的终态，不得自动跳过后续安全依赖消息。

## 6. Group State

```text
creating -> joining -> active
active -> transition_pending -> active
active -> waiting_for_epoch
active -> leaving -> left
active -> dissolving -> dissolved
any -> crypto_desynced -> recovering -> active
```

## 7. Recovery State

```text
idle -> validating -> restoring -> enrolling_fresh_device -> reconciling -> complete
                    \-> failed_no_commit
```

恢复过程只有 `complete` 才允许替换当前 projection。`failed_no_commit` 必须保证当前
数据、identity 和 device address 未被部分修改。

## 8. Forbidden Visible States

- 对 modern-platform message 使用无解释的 `[Message cannot be decrypted]`。
- 以永久 spinner 表示 queue/session/epoch 故障。
- send API 失败后清空未被 durable accepted 的 draft。
- 将 SSE frame 写出显示为 delivered。
- 将“部分设备收到”隐藏成完整 multi-device success。

## 9. Message Interaction State

| ID | State | User-visible meaning | Transition rule |
|---|---|---|---|
| MP-S30 | original | committed message has no accepted edit/retract event | only authority event may mutate |
| MP-S31 | edit_pending | local edit intent is durable but not accepted | cancel or retry; original remains visible |
| MP-S32 | edited | same message identity projects accepted replacement content | duplicate/restart stays edited |
| MP-S33 | retract_pending | local retract intent is durable but not accepted | cancel or retry; original remains visible |
| MP-S34 | retracted | row remains but plaintext is hidden | terminal for content display |
| MP-S35 | reaction_present | actor's reaction is projected once | exact duplicate is idempotent |
| MP-S36 | pinned | conversation points to the accepted pinned message | later authority unpin removes it |
| MP-S37 | reply_linked | immutable reply target/thread root is available | restart preserves relation |
| MP-S38 | reply_target_unavailable | referenced target is unavailable locally | show typed unavailable preview |

Edit/retract/reaction/pin projections must not apply before the corresponding authority event
is durably consumed. A rejected or timed-out command cannot optimistically become terminal.

## 10. Typing Presence State

```text
idle -> typing -> idle
          |
          +-> expired -> idle
```

| ID | State | User-visible meaning | Transition rule |
|---|---|---|---|
| MP-S40 | idle | no current peer typing signal | default and terminal cleanup |
| MP-S41 | typing | an active member emitted a fresh typing pulse | refresh only within the same conversation |
| MP-S42 | expired | stop pulse was absent but TTL elapsed | immediately project idle |

Typing state is ephemeral and process-local. It must never survive restart, advance a durable
cursor, block an ordered lane, or appear for a removed/revoked/non-member endpoint.
