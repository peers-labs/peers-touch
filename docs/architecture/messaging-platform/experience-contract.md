# Messaging Platform — 体验合同

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-08 | **Updated**: 2026-08-08
> **Owner**: Messaging Platform Team

---

## 1. Journey Index

| ID | Journey | Capabilities |
|---|---|---|
| MP-J01 | 首次 Direct 会话与双向消息 | C01-C04 |
| MP-J02 | 离线接收与重连 | C02-C03、C12 |
| MP-J03 | 冷启动与本地历史 | C02、C07 |
| MP-J04 | 添加第二设备 | C05-C06 |
| MP-J05 | 撤销设备 | C05-C06 |
| MP-J06 | 24-word fresh-install recovery | C07-C08 |
| MP-J07 | 创建并使用 MLS 群 | C09、C11 |
| MP-J08 | MLS 加人、加设备和移除 | C05-C06、C09 |
| MP-J09 | 跨 Station Direct/Group | C01-C03、C09、C11 |
| MP-J10 | Receipt 与 read cursor | C10 |
| MP-J11 | 附件与本地搜索 | C13-C14 |
| MP-J12 | 故障诊断与恢复 | C12 |

## 2. MP-J01: Direct Messaging

起点：Alice 和 Bob 均已认证，至少有一个 active device。

1. Alice 打开 Bob 会话。
2. Device Engine 解析 active endpoints，并在需要时建立 device-targeted session。
3. Alice 输入并发送文本。
4. Composer 显示 queued/sending，成功接受后清空；失败时保留 draft。
5. Bob 在 native UI 看到精确 plaintext。
6. Bob 回复，Alice 获得相同结果。

成功：双方消息 identity、顺序和 plaintext 一致。

恢复：

- peer device 暂无 bundle：显示 waiting-for-device，允许取消或稍后重试。
- Station 暂不可用：显示 queued/retrying，draft 或 durable command 不丢失。
- decrypt 暂不可用：不 ACK、不显示终态损坏，等待 session material。

## 3. MP-J02/J03: Offline, Reconnect, Restart

1. Bob 下线，Alice 发送消息。
2. Station authority commit 并创建 Bob device queue item。
3. Bob 重连；SSE 只唤醒 Engine。
4. Engine 从 durable cursor 顺序 drain、消费、ACK。
5. Bob 看到原始 plaintext。
6. Bob 冷重启，Engine 从 SQLCipher 恢复 projection、cursor、workers。

成功：消息只显示一次，顺序不变，重启前后 plaintext 一致。

## 4. MP-J04/J05: Multi-Device Lifecycle

添加：

1. Bob 在新设备认证。
2. 新设备生成 device identity、发布 bundle/key package。
3. Station registry 将设备标为 active。
4. 后续 Direct message 对 Bob 所有 active devices 生成独立 ciphertext。
5. 群组通过 authority transition 添加新 MLS leaf。

撤销：

1. Bob 从可信设备选择目标 device 并确认撤销。
2. Station registry 原子标记 revoked。
3. Direct fan-out 不再包含该 endpoint。
4. 所有相关群组提交 MLS leaf removal。
5. 被撤销设备显示 revoked，不得继续消费或发送。

## 5. MP-J06: Recovery

1. Alice 生成并离线保存 24-word phrase。
2. Device Engine 将 actor identity、plaintext history、attachment metadata 和 trust
   加密为 opaque revision 上传 Station。
3. fresh install 后 Alice 认证并输入 phrase。
4. Engine 完整校验后原子恢复 SQLCipher history。
5. Engine 创建 fresh device identity 和 sessions。
6. Alice 看到恢复前精确历史并继续新通信。

错误 phrase、损坏 revision 或本地提交失败均恢复零数据并保留当前状态。

## 6. MP-J07/J08: MLS Group

1. Owner 选择成员并创建 group。
2. Authority commit membership/MLS epoch 1。
3. Welcome 进入每个目标 device lane。
4. 成员 leaf active 后允许发送。
5. message ciphertext 由 authority 排序并 fan-out 到 active leaves。
6. 添加/移除 actor 或 device 均通过一个 authority transition。
7. restart 后 local MLS state 与 authority head 对齐。

任何 epoch gap 都进入 waiting-for-epoch 或 crypto-desynced recovery，禁止继续发送。

## 7. MP-J09: Federation

Home Station 持久化 outbound command/envelope，Authority Station 幂等提交，目标 Home
Station 原子写入 device lanes。任一网络中断都通过 durable outbox 重试，不要求两个
用户同时在线。

## 8. MP-J10/J11: Receipts, Attachments, Search

- accepted：authority 已提交。
- consumed：目标 device 已本地 durable commit。
- delivered：至少一个目标 active device consumed。
- read：目标 actor 的 read cursor 已越过 message sequence。
- 附件内容端到端加密，Station 仅持有 opaque object。
- 搜索只访问本地 SQLCipher plaintext index。

## 9. MP-J12: Failure Recovery

用户必须能区分并采取行动：

- queued/retrying：无需重输，系统继续。
- waiting-for-session/device/epoch：等待依赖或管理设备。
- storage-locked/full：解锁或释放空间，消息仍未 ACK。
- corrupt-ciphertext：终态安全错误，可导出 redacted diagnostics。
- revoked：重新认证并 enroll fresh device。

Toast 不能作为唯一恢复界面。
