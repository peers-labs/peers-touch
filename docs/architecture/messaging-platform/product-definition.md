# Messaging Platform — 产品定义

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-08-08 | **Updated**: 2026-08-16
> **Owner**: Messaging Platform Team

---

Conversation is the sole Chat entry point through `/conversation/*`. Device,
Inbox, Recovery, Key Exchange, and Federation capabilities are exposed by their
resource owners; Device Messaging Engine remains the Desktop/Mobile runtime name.

## 1. Product Thesis

目标用户是需要在 Desktop 和 Mobile 上进行长期、可靠、安全通信的个人与群组。

产品承诺：

> 用户发送的每一条已接受消息都会被可靠、有序地送达目标 active devices；在线时
> 即时可见，离线或重启后可恢复；接收方只会看到精确明文或可行动的等待/失败状态，
> 不会因为客户端竞态、存储重置或设备变化永久失去现代平台消息。

第一可用结果：

- Alice 与 Bob 在两个隔离 native Desktop 中登录。
- Alice 发送文本，Bob 在 P95 1 秒内看到精确明文。
- Bob 回复，Alice 同样看到精确明文。
- 双方重启后历史仍可读。

持续价值：

- 离线消息、重连、跨 Station、多设备、群聊与恢复继续保持相同可靠性和安全语义。

## 2. Target Users And Non-Goals

目标用户：

- 使用一个或多个设备进行日常私聊的用户。
- 需要安全群聊、成员治理和设备撤销的群组。
- 自托管或跨 Station 通信的用户。

非目标：

- 以服务端可读 plaintext 换取搜索或同步便利。
- Telegram 式服务端持有消息密钥。
- 依赖用户手工刷新、重新登录或重建 session 的正常通信。
- 在缺少 native evidence 时宣传“可用”。
- 复制 SimpleX 的匿名寻址、完全连接群或同局域网 remote-controller 产品模型。

## 3. Capability Profile

| ID | 能力 | 分类 | 产品声明 |
|---|---|---|---|
| MP-C01 | Direct messaging | required | 双向即时精确明文与附件 |
| MP-C02 | Durable delivery | required | 离线、断线和重启不丢消息 |
| MP-C03 | Ordered consumption | required | DKX、消息和变更按设备 lane 有序 |
| MP-C04 | End-to-end encryption | required | Station 不可读取内容和私钥 |
| MP-C05 | Multi-device | required | active devices 独立密文、独立 session、完整 fan-out |
| MP-C06 | Device lifecycle | required | enrollment、rotation、revoke 和 trust 可见且生效 |
| MP-C07 | History persistence | required | cold restart 保持 plaintext history |
| MP-C08 | Recovery | required | 24-word phrase 恢复历史，fresh device 继续通信 |
| MP-C09 | Group MLS | required | RFC 9420 device leaves、epoch、add/remove/restart |
| MP-C10 | Receipts | required | accepted、device-consumed、delivered、read 语义分离 |
| MP-C11 | Federation | required | authority ordering 与跨 Station reliable transport |
| MP-C12 | Failure recovery | required | waiting/retrying/corrupt/revoked 状态可行动 |
| MP-C13 | Attachments | required | opaque encrypted metadata、下载与恢复 |
| MP-C14 | Search | required | 本地 plaintext search，不泄露给 Station |
| MP-C15 | Typing presence | required | Direct/Group 中只显示当前 active member 的短暂输入状态，断流后自动消失 |
| MP-C16 | Message interactions | required | reply/thread、edit、retract、reaction、pin 在 Direct/Group 中按同一 authority 顺序收敛 |

### 3.1 Interaction Product Amendment

> **Amendment status**: accepted by Goal owner on 2026-08-16.

- Reply/thread 在发送时绑定不可变的 target/root identity；接收方必须看到相同关联，
  缺失 target 时显示可行动的 unavailable preview，不能把回复静默降级为普通消息。
- Edit 只允许原作者；接受后保留原 `message_id`，所有 active endpoints 收敛到相同
  edited content 与 edited marker。提交失败时原内容保持可见。
- Retract 只允许原作者；接受后保留消息位置并显示 retracted state，不把 authority
  history 物理删除。
- Reaction 允许 active member 添加或移除自己的 reaction；重复 add/remove 幂等。
- Pin/unpin 允许 active member 操作 conversation pin state；所有 active endpoints
  收敛到相同结果。
- Read cursor 只能单调前进，不能把 `delivered` 或旧 cursor 冒充 `read`。
- Typing 是非持久、best-effort presence。只有 active member 可发送；Direct 与 Group
  都必须 fan-out，停止输入、切换会话、断流或 TTL 到期后必须自动清除。
- Voice/video call signaling 继续属于 `docs/architecture/realtime/`，不计入 MP-C15。

### 3.2 Platform Applicability

| Capability | Desktop | Mobile | Browser | Claim rule |
|---|---|---|---|---|
| MP-C01–MP-C14 | required | required | not claimed | 各平台 required Native cells 必须独立通过 |
| MP-C15 Typing presence | required | required | not claimed | Direct 与 Group 均需 sender/receiver visible evidence |
| MP-C16 Message interactions | required | required | not claimed | Direct 与 Group 的 authority、receiver projection 和 restart evidence 必须一致 |

## 4. Trust, Privacy, And Portability Promises

- 共享业务真相、成员和 authority sequence 属于 Station。
- plaintext、private keys、ratchets 和 MLS private state 只存在于设备加密存储。
- 每个 crypto 地址都是 `(PTID, device_id)`。
- 设备消费 ACK 不得在本地 durable commit 前发生。
- 新设备不继承旧设备 live ratchet 或 MLS state。
- 恢复 phrase、backup key 和 plaintext 永不发送到 Station。
- 设备被撤销后不得收到未来 ciphertext。
- Desktop 与 Mobile 共享产品语义，不伪造未实现的平台能力。

## 5. Product Success Metrics

| 指标 | 目标 |
|---|---|
| 同 Station 在线文本 commit-to-visible | P50 ≤ 300ms，P95 ≤ 1s，P99 ≤ 3s |
| 跨 Station 在线文本 commit-to-visible | P95 ≤ 2s，P99 ≤ 5s |
| 已接受消息丢失 | 0 |
| 重放导致重复可见消息 | 0 |
| modern-platform decrypt placeholder | 0 |
| ACK-before-local-commit | 0 |
| revoked-device future delivery | 0 |
| crash-point recovery | 所有定义点 100% |

测量起点是 authority commit，终点是 receiver native UI 出现精确 plaintext；必须同时
记录 Station queue、Device Engine transaction 和 UI evidence。

## 6. Prototype Disposition

本工作不改变 Chat 的主要布局和导航，只替换消息状态语义与恢复反馈。现有 Chat UI
合同足以约束表面，因此不新建视觉原型。等待、重试、设备撤销和不可恢复损坏必须在
native acceptance 中验证，不能用 mock prototype 代替。

## 7. Product Gate

当前判断：`PRODUCT_ACCEPTED`（Owner approved 2026-08-08）。

进入架构接受态前，Owner 必须确认：

1. MP-C01 至 MP-C14 均为 required。
2. latency、zero-loss 和 zero-placeholder 指标不可在执行计划中弱化。
3. multi-device 采用 device-visible endpoint fan-out。
4. Recovery 恢复历史但不复制 live session。
