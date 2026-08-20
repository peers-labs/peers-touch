# Messaging Platform — Benchmark Disposition

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-08-08 | **Updated**: 2026-08-17
> **Owner**: Messaging Platform Team

---

## 1. Evidence Sources

本地源码基线：

- `simplex-chat@f921bd47b`
- `simplexmq@27a37387`
- `signalapp/Signal-Server` 官方 message queue / WebSocket source
- Matrix Olm/Megolm 与 sync contract
- 微信公开撤回行为：普通消息限时撤回、撤回留痕
- WhatsApp 官方 `Delete for everyone` 行为与失败边界

外部项目提供行为证据，不成为 Peers-Touch 真源。
公开产品行为只能证明用户可观察语义，不能反推其内部 transaction 或 storage 实现。

## 2. Disposition Ledger

| ID | 观察行为 | 证据 | 处置 | Peers-Touch 结论 |
|---|---|---|---|---|
| MP-B01 | Chat Core / Agent / Client / Relay 分层 | SimpleX protocol overview | adopt | 建立 Device Messaging Engine，UI 不处理协议 |
| MP-B02 | 普通消息在 consumer ACK 前保持 `ACKPending` | SimpleX Agent `A_MSG` path | adopt | 本地 durable consumption 后才 ACK Station |
| MP-B03 | ratchet decrypt、hash、message record 同事务 | SimpleX Agent store | adopt | Direct receive 事务必须原子 |
| MP-B04 | outbound message/delivery 先持久化再启动 worker | SimpleX Agent enqueue | adopt | 所有发送和重试进入 durable engine outbox |
| MP-B05 | queue worker 按 connection 有序处理并持久 retry state | SimpleX delivery worker | adopt | 每设备 lane 严格排序、lease、backoff |
| MP-B06 | sequential message ID + previous hash 检测缺口 | SimpleX agent protocol | adapt | 使用 authority sequence/hash 与 device lane sequence |
| MP-B07 | UI 只发 Chat commands、接收 Chat responses | SimpleX ChatController | adopt | UI 只消费 typed projections |
| MP-B08 | SQLCipher + portable archive + rollback migration | SimpleX data management | adapt | 本地 SQLCipher；Station opaque revision backup |
| MP-B09 | 群聊 sender 对 fully-connected members fan-out | SimpleX group RFC/source | reject | 不采用线性 pairwise group fan-out |
| MP-B10 | chat relay delivery tasks/jobs/cursor | SimpleX chat relays | adapt | Station group/device fan-out 使用 durable jobs |
| MP-B11 | 无真正 same-profile concurrent multi-device | SimpleX FAQ | reject | Peers-Touch 必须支持 active-device fan-out |
| MP-B12 | Desktop remote-controls mobile profile | SimpleX remote host | reject | Desktop/Mobile 均为独立 active devices |
| MP-B13 | Signal per-device durable queue | Signal MessagesManager | adopt | Station 为每个 active device 建独立 queue |
| MP-B14 | Signal client success response 后删除 queue message | Signal WebSocketConnection | adopt | ACK 等于 durable device consumption |
| MP-B15 | Matrix sync cursor 负责可靠恢复，push 负责延迟 | Matrix sync contract | adopt | SSE/push 只 wake；resume 是唯一消费路径 |
| MP-B16 | Matrix per-device encryption | Matrix/Element | adapt | Direct endpoint sessions + MLS device leaves |
| MP-B17 | 微信、WhatsApp 对已发送消息提供留痕撤回/全员删除，而不是承诺撤销结果未知的 in-flight submit | 微信公开撤回说明；WhatsApp 官方 Help Center | adopt | 已 accepted 消息使用 Authority retract event；不提供 post-dispatch reliable cancel |
| MP-B18 | 网络提交前的 composer draft 可本地放弃；提交结果未知时保留 pending/retrying | 主流 IM 可观察发送/失败/重试交互 | adapt | 仅未进入 durable outbox 的本地 draft 可 cancel；outbox admission 后 exact command 只能 retry 或收敛到 accepted/failed |

## 3. Explicit Rejections

以下设计不得因参考项目存在而进入目标架构：

- SimpleX 匿名 queue addressing 替代 PTID federation identity。
- fully-connected pairwise group topology。
- 单主设备加 remote-controller 模型。
- 复制 live ratchet state 实现多设备。
- Megolm 或 Sender Keys 替代 RFC 9420 MLS。
- Signal/Matrix 服务部署和账号模型的机械复制。
- 为结果未知的已提交 command 新增跨层 cancellation tombstone；该能力超出当前行业
  对标与产品范围。

## 4. Required Learnings

Benchmark 调研最终约束以下产品和架构要求：

1. 消息可靠性必须由持久 Messaging Engine 和 queue workers 提供。
2. Realtime transport 不得成为业务消费真源。
3. ACK 必须位于 consumer durable boundary 之后。
4. 用户可见消息必须来自本地 durable projection。
5. 群聊可扩展性必须由 Station fan-out 与 MLS 解决，而非客户端完全连接图。
6. 多设备必须显式建模，不能把“同一用户”当成一个 crypto endpoint。
7. “撤回”是 accepted fact 之后的新 Authority event，不是回滚或抹除原始发送。
8. transport timeout 保持 pending/retrying；只有网络提交前的本地 draft 可以取消。
