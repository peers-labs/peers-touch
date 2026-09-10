# Messaging Platform — 产品验收矩阵

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-08-08 | **Updated**: 2026-09-05
> **Owner**: Messaging Platform Team

---

Acceptance treats Conversation `/conversation/*` as the sole Chat entry point.
Device, Inbox, Recovery, Key Exchange, and Federation evidence must exercise
their resource-owner APIs, while Desktop/Mobile runtime evidence may retain the
Device Messaging Engine name.

## 1. Acceptance Rule

```text
MP-C capability
  -> MP-J journey
  -> MP-S visible state
  -> MP-A architecture requirement
  -> MP-W execution closure
  -> MP-G evidence gate
```

截图、编译、单测或 API readback 均不能单独证明用户旅程完成。required row 必须同时有
native UI、Station truth 和 Device Engine durable evidence。

## 2. Traceability Matrix

| Capability | Journey/State | Architecture | Workstream | Gate | Receiver assertion |
|---|---|---|---|---|---|
| MP-C01 Direct | J01; S01-S09 | A01-A05 | W01-W06 | MP-G01 | 对方即时看到精确明文 |
| MP-C02 Durable delivery | J02/J03; queue FSM | A02-A06 | W02-W05 | MP-G02 | 离线、断线、重启不丢 |
| MP-C03 Ordering | J01/J02 | A03/A04 | W02/W04 | MP-G03 | DKX/消息不乱序 |
| MP-C04 E2EE | J01/J07 | A01/A05 | W03/W07 | MP-G04 | Station 无 plaintext/private key |
| MP-C05 Multi-device | J04/J05 | A01/A02/A07 | W01/W03/W07 | MP-G05 | 所有 active devices 独立解密 |
| MP-C06 Device lifecycle | J04/J05 | A07 | W01/W07 | MP-G06 | revoke 后零未来投递 |
| MP-C07 History | J03 | A05 | W04 | MP-G07 | cold restart 明文一致 |
| MP-C08 Recovery | J06 | A05/A07 | W08 | MP-G08 | fresh install 恢复并继续通信 |
| MP-C09 Group MLS | J07/J08 | A08 | W07 | MP-G09 | add/remove/send/restart epoch 正确 |
| MP-C10 Receipts | J10 | A02/A09 | W05 | MP-G10 | accepted/consumed/delivered/read 可区分 |
| MP-C11 Federation | J09 | A02/A06 | W02/W06/W14 | MP-G11 | 跨站断线重试后有序到达，Home Station follower membership与authority一致 |
| MP-C12 Failure recovery | J12; S20-S28 | A03-A06/A10 | W02-W09 | MP-G12 | 故障可行动且不静默丢失 |
| MP-C13 Attachments | J11 | A05/A11 | W10 | MP-G13 | 附件 E2EE、重启和恢复可用 |
| MP-C14 Search | J11 | A05 | W10 | MP-G14 | 仅本地 plaintext index 返回结果 |
| MP-C15 Typing presence | J14; S40-S42 | A04/A18 | W12 | MP-G16 | Direct/Group receiver 只显示 fresh active-member typing，TTL 后清除 |
| MP-C16 Message interactions | J13; S30-S38 | A02/A03/A05/A09/A17 | W12 | MP-G15 | Direct/Group receiver 对 reply/edit/retract/reaction/pin/read 收敛且重启不回退 |

## 3. Required Runtime Cells

| Cell | 必须覆盖 |
|---|---|
| Alice/Bob same Station native Desktop | G01-G10、G12-G14 |
| Alice/Bob cross Station native Desktop | G01-G04、G10-G12 |
| Alice + Bob1 + Bob2 | G03、G05、G06、G10 |
| Desktop + Mobile contract | C01-C16 contract parity |
| Offline recipient | G02、G03、G10 |
| Station restart | G02、G11、G12 |
| Client crash points | G02-G04、G07-G08、G12 |
| Three-device MLS group | G05、G06、G09 |
| Alice/Bob Direct interaction Native | G10、G15、G16 |
| Alice/Bob/Carol Group interaction Native | G09、G10、G15、G16 |
| Desktop + Mobile Native interaction parity | G15、G16 |

## 4. Gate Definitions

| Gate | Executable proof |
|---|---|
| MP-G01 | 双向发送唯一随机文本；两端 native UI 精确匹配；P95 达标 |
| MP-G02 | offline、disconnect、Station/client restart 后逐条到达且无重复 |
| MP-G03 | DKX 与消息乱序注入；lane 仍按 sequence 消费或阻塞 |
| MP-G04 | server DB/log scan 无 plaintext/key；crypto known-answer 与 tamper tests |
| MP-G05 | 一个 authority message identity，对每 active device 独立 ciphertext/plaintext |
| MP-G06 | revoke 时间后目标 device queue item 数为 0 |
| MP-G07 | 双端冷重启，SQLCipher 与 UI plaintext 完全一致 |
| MP-G08 | 24-word fresh storage restore；history、fresh device、后续消息通过 |
| MP-G09 | create/add-device/add-member/send/remove/restart/recovery 全 journey |
| MP-G10 | queue、device receipt、actor read cursor 与 UI 状态一致 |
| MP-G11 | federation outbox重试、目标inbox幂等、authority sequence连续；self-contained create与independent owner-resolved late-join Welcome建立正确authority pin；Station-addressed follower projection覆盖zero-device/removal；replay只返回requesting Home Station具有immutable event grant的范围且event/grant digest都受签名保护；gap走signed event-log replay且不生成private payload；wrong target/nonce、stale/rollback/key mismatch、sequence/event collision、wrong previous hash fail closed；public buffer event/byte quota与expiry cleanup可证；event/grant co-retention、terminal tombstone和unexpected source loss可证；applied event bytes和endpoint metadata retention符合D29 |
| MP-G12 | storage full/locked、bad ciphertext、lease expiry、poison item 均 fail closed |
| MP-G13 | Direct/MLS encrypted attachment exact bytes；upload/download 在每个 chunk 边界中断后从 durable checkpoint 恢复；duplicate/conflicting part、ETag/range、ciphertext/plaintext hash 和 AEAD failure fail closed；Desktop/Station restart与fresh recovery后可用；removed actor 只能读取其已获 grant 的历史 object；Station rows/logs 无 filename/key/nonce/plaintext hash |
| MP-G14 | SQLCipher FTS 对 text/filename 精确命中；offline/restart/recovery 后结果一致；bounded query/cursor；Station 请求/存储/log 中无 query 或 plaintext corpus |
| MP-G15 | Direct/Group Native clients 逐项执行 reply/thread、author-only edit/retract、reaction add/remove、pin/unpin 和 read；receiver DOM、Station authority event、device queue、Engine durable projection 一致；submit timeout 保持 pending/retrying，exact retry 只收敛为一个 Authority fact 和一个 visible result；offline/restart/duplicate/unauthorized/removed-device 均符合 J13 |
| MP-G16 | Direct/Group Native clients 执行 typing start/stop/session-switch/disconnect/TTL；只显示 active member fresh pulse，removed/non-member 被拒绝，durable lane 和 history 无 typing item |

## 5. Crash Matrix

必须在以下点强制终止并恢复：

1. command 本地持久化前/后；
2. ratchet advance 前/事务提交后；
3. authority commit 前/后；
4. device local consumption commit 前/后；
5. Station ACK 前/后；
6. backup restore validation 后/local commit 前；
7. MLS transition prepare/authority accept/local apply 各边界。

每个点必须证明 zero loss、zero double ratchet advancement、zero duplicate visible item。

## 6. Completion Rule

任何 required gate 为 `PARTIAL`、`UNPROVEN`、`NOT RUN` 或证据缺失时：

- 对应 capability 不完成；
- Messaging Platform 不可声明 usable/ready；
- 后续可继续局部开发，但必须明确 non-claim。
