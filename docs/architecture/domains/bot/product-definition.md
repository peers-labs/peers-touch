# Bot 能力 — 产品定义

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-11 | **Updated**: 2026-10-11
> **Owner**: Architecture Team

---

## 1. 产品论点

Peers-Touch 是 agent-native 工作的主界面。coding agent 完成任务、等待确认或失败时，
用户往往在看另一个应用。首个 Bot 能力闭环这一缺口：**外部自动化把事件推到用户自己的
Station，用户通过与人类会话一致的会话/通知面被触达——即使 Desktop 已收缩到操作系统
菜单栏。**

Bot 不是通知小工具，而是社交图中第一个非人类会话 actor：`ACTOR_KIND_AGENT`（传统 IM
bot），能接收 webhook 入站事件、向 owner 发消息。联邦与更丰富的入站语义只做预留。

## 2. 能力范围

### C1 Bot 身份与安装

- 登录用户在全局 Settings 层创建 Bot：Station mint HIDDEN 的 AGENT actor。
- 每个 Bot 一个入站端点：不透明 webhook id URL + secret（仅存 SHA-256）。
- 可轮换 secret（URL 与会话历史不变）、停用、吊销。

### C2 入站事件摄入

- 任何 HTTP 客户端（CI、SaaS、agent hook、curl）可向可达 URL POST canonical JSON；接入合同见 [webhook-api.md](./webhook-api.md)。
- v1 不提供官方 sender CLI：Claude Code 等用文档中的 curl/jq hook 片段接入（Stop / Notification）。
- 归一化、体积上限、限流、`request_id` 幂等、`dedupe_key` 折叠。
- 摄入失败绝不阻塞 agent：由调用方按接入合同做固定超时 + 失败不致命（`curl --max-time 5 … || true`），并用同一 `request_id` 幂等重试。

### C3 Bot 会话与通知

- 每个准入事件产生一条 Bot↔owner 直聊消息（经会话域新的"服务明文"投递类型，
  持久可回看）和一条通知。
- 触达：在线设备走 `/events/stream` SSE 秒级到达；Desktop 隐藏到菜单栏时弹 OS
  通知；历史未读在任何客户端重开后可回收。
- **v1 不包含**移动端离线 push（Station 仅有 push 绑定模型，无 APNS/FCM 分发器；
  分发器为独立后续能力）。
- Bot 会话明确不是端到端保密会话，客户端不显示 E2EE 锁（Station 驻留身份的诚实表达；
  业界同构：Telegram bot 不能进 Secret Chat）。

### C4 Desktop 菜单栏驻留

- 关窗驻留：tray 图标（未读提示 + 菜单：打开/静音/退出），可配置为直接退出。
- OS 通知走官方 Tauri notification 插件，遵守既有分类偏好；点击深链回到 Bot 会话
  或事件声明的 IDE/URL。

## 3. 非目标（v1）

1. 双向指令：通知内批准/回复/执行 agent 动作。
2. 向 owner 以外本地 actor 或群投递；一切联邦行为（仅预留缝）。
3. 外部源签名验真（GitHub HMAC 等）：协议预留字段。
4. A2A / Agent Card 行为；Bot 是 IM 身份。
5. 移动端功能开发（仅要求未知投递类型优雅忽略）。
6. 官方发送端 CLI / 专用适配器（含 `peersbot`）：v1 只交付 HTTP webhook 合同与 curl/hook 示例（BOT-D10 superseded）；未来受维护客户端作为 `apps/` 一等公民另立。
7. 离线移动 push（无分发器）。

## 4. 用户 Journey

| ID | Journey |
|----|---------|
| BOT-J01 | 在 Settings 创建 Bot，复制 URL 与 curl 接入片段；轮换/吊销 secret |
| BOT-J02 | agent 完成任务，hook 投递事件；Desktop 打开状态下会话出现 Bot 消息 |
| BOT-J03 | Desktop 隐藏菜单栏，事件触发 OS 通知；点击回到 Bot 会话并深链到 agent 会话 |
| BOT-J04 | Desktop 离线时事件到达；重启后会话与未读完整回收 |
| BOT-J05 | waiting_input 重复提示在未读期间折叠为一条，不刷屏 |
| BOT-J06 | 非法/缺 secret/超限请求被安全拒绝；调用方 hook 不拖慢 agent（短超时、失败不致命） |
| BOT-J07 | 停用/吊销即时生效，tray/通知面进入确定终态 |

## 5. 产品状态模型

### 5.1 Bot registry

```text
DRAFT → ACTIVE ⇄ DISABLED → REVOKED（终态）
```

### 5.2 入站处理

```text
RECEIVED → VALIDATED → ADMITTED → DELIVERED
                ↓          ↓
            REJECTED   RATE_LIMITED / QUARANTINED
```

`DELIVERED` = 会话消息与通知在单事务内创建完成（扇出为其后的尽力而为步骤）。
同 `request_id` 重试折叠为同一可见产物。

### 5.3 Desktop 驻留

```text
WINDOW_OPEN ⇄ WINDOW_HIDDEN（tray）→ QUIT
```

OS 通知由窗口焦点/可见性、会话可见性与分类偏好共同决定。

## 6. 验收标准

- ACP-1：同一 `request_id` 重试恰好产生一条会话消息；通知在 TASK 偏好允许时恰好一行，偏好关闭时不产生通知行（既有静音语义），两种情况下会话未读都存在。
- ACP-2：无正确 secret 的请求不能产生任何归属该 Bot 的消息或通知。
- ACP-3：打包 Desktop 上 hook→Station→OS 通知→点击→Bot 会话全链路可跑通。
- ACP-4：按 webhook-api.md 接入的调用方（hook 脚本）任意失败路径都不致命（exit 0）且有固定墙上时间预算；以 curl 实测。
- ACP-5：停用/吊销对后续请求即时生效，错误类型化，无半截消息。
- ACP-6：Bot 会话在任何端都不出现 E2EE 保证标记；移动端遇服务明文类型不崩溃。

场景与门见 [acceptance-matrix.md](./acceptance-matrix.md)。

## 7. 暂缓的产品问题

- 多来源共用一个 Bot 时的分组/线程 UX（v1 按 group_key 折叠）。
- Bot 头像自定义（v1 默认字形）。
- 多账号 Bot 管理（v1 仅当前登录账号）。
