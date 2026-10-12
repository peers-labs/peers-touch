# Bot 能力 — 验收矩阵

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-11 | **Updated**: 2026-10-11
> **Owner**: Architecture Team

---

场景从产品状态、失败语义变化、接收者结果与具体架构风险推导。类型：**单测/集成**
（Station Go 测试）、**Journey**（exact-source 产品运行；原生主张用打包 Desktop）。

## 1. 身份与 registry

| ID | 场景 | 类型 | 期望 |
|----|------|------|------|
| BOT-A01 | 创建 Bot | Journey | AGENT actor（PTID letter `b`、HIDDEN）mint；registry ACTIVE；URL + secret 仅明文一次 |
| BOT-A02 | kind 传播审计 | 集成 | 枚举传播集全部显式分类 AGENT；endpoint manifest 白名单签发/验证放行；迁移映射接受 `b`；社交护栏仍拒绝其人类图动作 |
| BOT-A03 | secret 轮换 | 集成 | webhook id 与历史不变；新 secret 可用、旧 secret 401 |
| BOT-A04 | 停用→吊销 | 集成 | 409/404 行为正确；吊销后 secret_hash 清空、历史保留 |
| BOT-A04B | 状态即时生效（G-BOT-08） | 集成 | 停用/吊销完成后紧随的下一个请求即被 409/404 拒绝，无在途放行窗口 |
| BOT-A05 | 重名冲突 | 单测 | 同 owner active 重名被类型化拒绝 |
| BOT-A05B | 通知偏好静音 | 集成 | owner 关闭 TASK 偏好时不产生通知行、通知中心不计数；会话消息与会话未读仍产生；OS 通知另由焦点/设备静音独立判定 |

## 2. 边缘安全与准入

| ID | 场景 | 类型 | 期望 |
|----|------|------|------|
| BOT-A10 | 缺失/错误 secret、未知 id | 集成 | 401 响应不可区分；无任何落库/扇出（G-BOT-01） |
| BOT-A11 | 超 32 KiB / 非法 JSON / 非法枚举 | 集成 | 流式读取即截断拒绝 400；不产生消息/通知 |
| BOT-A12 | 突发限流 | 集成 | per-Bot 429+Retry-After；per-IP 溢出桶独立（G-BOT-07） |
| BOT-A13 | 窗口内同 request_id 重放 | 集成 | deduplicated；消息恰好一条；偏好允许时通知恰好一行（G-BOT-04、ACP-1） |
| BOT-A14 | 请求体伪造 actor/recipient | 集成 | 忽略/拒绝；归因只来自 registry |
| BOT-A15 | 非 owner 作用域尝试 | 集成 | 准入前 BOT_SCOPE_NOT_ENABLED |
| BOT-A16 | 准入后会话/通知失败 | 集成 | inbound 补偿 quarantined；同 id 重试幂等补齐两件产物；无部分成功稳态 |

## 3. 会话与通知投递

| ID | 场景 | 类型 | 期望 |
|----|------|------|------|
| BOT-A20 | 首个事件惰性建立 Bot↔owner 直聊 | 集成 | 系统授予记录存在；无社交好友边；FederationID 等前置由内部端口满足 |
| BOT-A21 | 服务明文投递合法性与线协议闭合 | 集成 | PreparedEndpointPayloadKind=8、ConversationMember.actor_kind、消息安全标记齐备；`direct_service_plaintext` 仅系统发送方可用；人类设备命令构造该类型被聚合根拒绝；回执 deliveryKindFromProto 放行；非 owner/联邦目标在系统发送端口被拒 |
| BOT-A21B | 客户端 crate 处理 | 集成+Journey | messaging-core 明文 processor 落消息；未实现该类型的客户端 skip+ack 且不毒化持久 inbox；Desktop 渲染 Bot 卡片，Mobile 不崩溃（G-BOT-10） |
| BOT-A22 | 结构化卡片负载 | 集成 | `peers-touch.bot-event.v1` 持久化且含降级文本 |
| BOT-A23 | 折叠 | 单测 | 未读重复折叠；已读关窗；不跨天/不混类型 |
| BOT-A24 | Produce→总线→SSE | 集成 | 在线设备经新 StreamEvent 通知臂收到；漏扇出时有持久化通知可追 |
| BOT-A25 | 重启收敛 | Journey | Desktop 重启后消息/未读/通知与 Station 投影一致 |
| BOT-A26 | 非 E2EE 呈现 | Journey | Bot 会话无 E2EE 锁；去锁依据同时来自 delivery kind 与参与者 kind（G-BOT-09） |
| BOT-A27 | 事务端口/Post-commit 失败 | 集成 | ProduceInTx 不可用或提交失败时准入补偿 quarantined，不允许静默成功；提交成功后 Publish 失败不回滚 |
| BOT-A28 | 通知幂等键 | 单测 | 同键 Produce 返回原通知，不产生重复行 |

## 4. Desktop 菜单栏驻留

| ID | 场景 | 类型 | 期望 |
|----|------|------|------|
| BOT-A30 | 关窗隐藏到 tray；菜单可用 | Journey 打包 | 进程存活，打开/退出正确，无 tray 环境降级不崩 |
| BOT-A31 | 隐藏→事件→OS 通知→点击→深链 | Journey 打包 | G-BOT-06/ACP-3 全链路；每设备每事件恰好一条 |
| BOT-A32 | 窗口可见聚焦时事件 | Journey | 不发 OS 通知，仅应用内更新 |
| BOT-A33 | 静音两层语义 | 集成+Journey | Station 偏好关闭时无通知行；设备静音/窗口聚焦时不发 OS 通知；会话未读始终记录 |
| BOT-A34 | 非法 action scheme | 单测 | Rust 允许列表拒绝，无命令执行面 |
| BOT-A35 | 多窗口 | Journey | 每设备一条 OS 通知 |

## 5. 调用方接入（v1 无官方 CLI）

原 BOT-A40…A44 针对 `peersbot` 二进制（fixture 映射、spool 边界、终态丢弃 exit 0）。
随 BOT-D10 superseded / S4 deferred，这些门在 v1 **取消**——没有受维护的客户端代码可测。

v1 改为以**真实 HTTP Journey**验证调用方合同（已在 S3 完成，见
[对外 Webhook 合同](../../../api/bot/webhook.md)）：

- 正确 secret + canonical JSON → 200 `ACCEPTED`；同 `request_id` 重试 → 200 `DEDUPLICATED` 且产物不重复。
- 未知 id / 错 secret 不可区分 → 401 `unauthorized`；坏 schema/未知字段 → 400；体 >32 KiB → 413。
- 调用约定可满足不阻塞 agent：`curl --max-time 5 … || true` 固定墙上时间且失败不致命；以同一 `request_id` 幂等重试。

当未来在 `apps/` 立项官方发送端时，恢复相应的映射分类、spool/重试与终态丢弃验收门。

## 6. 架构验证门（执行早期证明）

| ID | 验证内容 | 时机 |
|----|----------|------|
| G-BOT-02 | AGENT 设备登记、prekey 发布、endpoint manifest 放行全链路 | 首个执行切片内；受阻即改设计 |
| G-BOT-03 | 系统发送方经会话应用端口完成服务明文投递（含 FederationID/路由前置），不耦合 repository | 执行计划结构性证明 |
| G-BOT-10 | 打包 Desktop 端到端收发服务明文 Bot 消息并正确渲染；移动端遇未知 delivery kind 不崩 | EXECUTE 阶段 Journey |

单测/集成数量、SOURCE_CHECK 与结构评审不能替代 BOT-A30/A31、G-BOT-10 等打包
Journey；未演示项一律标 UNPROVEN。
