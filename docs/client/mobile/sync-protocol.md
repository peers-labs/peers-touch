# Peers Touch 多端同步协议设计

> Durable-command ledger、unknown-outcome readback 与 platform
> `InteractionAdmission` ownership 已随 Mobile PRODUCT/DESIGN package 于
> 2026-08-27 接受。
>
> Chat 业务唯一入口是 Conversation 的 `/conversation/*`。Device、Inbox、
> Recovery、Key Exchange 与 Federation 分别暴露 `/device/*`、
> `/device/inbox/*`、`/recovery/*`、`/key-exchange/*` 与 peer-only
> `/federation/*`；客户端内部 Messaging Engine 名称不定义 Station API。

## 1. 文档目标

### 1.1 目标
- 定义 Peers Touch 客户端（Desktop + Mobile）与 Station 之间的多端数据同步协议，覆盖全模块。
- 明确每个业务模块的同步方向、同步模式、冲突解决策略与离线行为。
- 为 Tauri Mobile（mobile-web + mobile-rust + native plugins）实现提供可直接落地的技术规范。
- 与 Desktop（Tauri + React/TS + Rust）的同步行为保持语义一致，确保三端用户体验对齐。

### 1.2 非目标
- 不讨论 Desktop P2P 通信的具体实现（Mobile 不走 P2P，仅走 Station Relay）。
- 不替代各平台内部模块级的 UI/交互设计文档。
- 不讨论 Station 内部的数据库 Schema 与存储引擎选型。
- 不讨论 Federation（ActivityPub Station 间通信）的同步细节。

---

## 2. 同步架构总览

### 2.1 核心角色

| 角色 | 定位 | 技术栈 |
| --- | --- | --- |
| Station | 权威数据源（Single Source of Truth），承载全部业务领域逻辑 | Go + Hertz + PostgreSQL |
| Desktop | 客户端端点，丰富交互体验 + 本地缓存 | Tauri + React/TS + Rust |
| Mobile | 客户端端点，移动场景交互 + 本地缓存 + native plugins | Tauri v2 Mobile + Web UI + Rust + Android/iOS plugins |

### 2.2 架构拓扑

```text
                           ┌──────────────────────┐
                           │       Station         │
                           │  (Source of Truth)     │
                           │                        │
                           │  ┌──────────────────┐ │
                           │  │  Event System     │ │
                           │  │  SSE / WebSocket  │ │
                           │  │  ConnectionHub    │ │
                           │  │  DeliveryRouter   │ │
                           │  │  Broker           │ │
                           │  └──────────────────┘ │
                           │                        │
                           │  ┌──────────────────┐ │
                           │  │  HTTP API Layer   │ │
                           │  │  (统一Handler)     │ │
                           │  └──────────────────┘ │
                           └──────┬───────┬────────┘
                                  │       │
                    ┌─────────────┘       └─────────────┐
                    │                                     │
         ┌──────────▼──────────┐             ┌───────────▼─────────┐
         │      Desktop        │             │       Mobile        │
         │  Tauri Desktop      │             │  Tauri Mobile       │
         │  React + Rust       │             │  Web UI + Rust      │
         │                     │             │  Native Plugins     │
         │  SSE/WS ← Station   │             │  SSE/WS ← Station   │
         │  HTTP → Station     │             │  HTTP → Station     │
         │  P2P ↔ Desktop      │             │  Push ← Station     │
         │  Local Cache        │             │  Local Cache/Outbox │
         └─────────────────────┘             └─────────────────────┘
```

### 2.3 核心原则

| 原则 | 说明 |
| --- | --- |
| Station 为真源 | 所有跨端可见状态的权威版本由 Station 持有，端侧仅缓存与编排 |
| 最终一致性 | 网络抖动或离线期间端侧可暂时不一致，重连后收敛到 Station 状态 |
| 端侧缓存为加速 | 端侧缓存存在的目的是减少延迟与流量，不作为业务决策依据 |
| 明确写语义 | 每个写操作声明幂等性；只有具备稳定 command ID、Station 去重和结果 readback 的操作才能自动重放 |
| 增量优先 | 优先增量同步，全量同步仅用于首次加载或极端不一致恢复 |
| Mobile 仅走 Relay | Mobile 端不参与 P2P 网络，所有通信经由 Station 中继 |
| Mobile 生命周期感知 | 前台使用事件流，后台依赖 push 与系统任务，恢复前台必须 delta sync |

---

## 3. 通用同步模式分类

系统定义 4 种基础同步模式，各模块根据业务特征组合使用。

### 3.1 实时推送（Real-time Push）

**机制**：Station 通过 SSE（Server-Sent Events）或 WebSocket 主动推送事件到已连接的客户端。

**适用场景**：
- 新消息到达（Chat / AI Chat / Channels）
- 好友请求、系统通知
- 在线状态变更
- 实时流式 AI 响应

**优点**：
- 延迟最低（毫秒级）
- 带宽高效（无轮询开销）
- Station 侧有完整的事件路由与投递机制（ConnectionHub → DeliveryRouter → Broker）

**缺点**：
- 依赖长连接，受网络环境影响
- 客户端不在线时事件会丢失，需要配合离线补齐

**Station 实现基线**：
- 事件类型系统已定义（`event.EventType`：`chat.message.appended`、`chat.message.delivered`、`chat.message.read` 等）
- 事件生命周期状态机：`PENDING → ENQUEUED → IN_FLIGHT → ACKED / TIMEOUT → RETRY / DEAD_LETTER`
- 事件投递范围（Scope）：`actor`（个人）、`conv`（会话）、`content`（内容）

### 3.2 增量拉取（Delta Sync / Cursor-based Pagination）

**机制**：客户端携带游标（cursor / since_id / since_ts）请求 Station，获取上次同步点之后的增量数据。

**适用场景**：
- 应用冷启动时补齐离线期间的数据
- 后台恢复前台时增量刷新
- 长列表的分页加载（Timeline、消息历史）

**优点**：
- 客户端完全控制拉取时机与速率
- 天然支持断点续传
- 无需维护长连接

**缺点**：
- 延迟取决于拉取频率
- 频繁拉取浪费带宽

**API 约定**：
- 游标字段统一使用 `cursor`（字符串类型，内容为 ULID 或 timestamp）
- 分页大小字段统一使用 `limit`（int32，默认 20，最大 100）
- 响应统一包含 `has_more`（bool）和 `next_cursor`（string）

### 3.3 事件触发（Event-Driven Sync）

**机制**：客户端收到实时推送事件后，根据事件类型触发定向数据拉取或本地状态更新。

**适用场景**：
- 收到 `chat.message.appended` 事件后拉取完整消息体
- 收到配置变更事件后刷新本地配置缓存
- 收到 Applet 安装/卸载事件后同步 Applet 列表

**优点**：
- 精确触发，避免无效拉取
- 事件可携带摘要信息，减少后续请求

**缺点**：
- 依赖实时推送通道可用
- 事件丢失可能导致同步遗漏（需配合兜底拉取）

### 3.4 全量同步（Full Sync / Snapshot）

**机制**：客户端一次性拉取某个数据域的全量快照，替换本地缓存。

**适用场景**：
- 首次登录 / 新设备初始化
- 检测到本地数据严重不一致时的恢复手段
- 数据量小且变更不频繁的配置类数据（Settings、Skills、MCP Server 列表）

**优点**：
- 实现简单，一次请求获得完整状态
- 消除增量遗漏的累积风险

**缺点**：
- 数据量大时耗时耗流量
- 不适合高频变更的数据

---

## 4. 按模块同步设计

### 4.1 Chat 同步（Unified Conversation）

#### 4.1.1 数据结构

| 实体 | Proto 定义 | 说明 |
| --- | --- | --- |
| Conversation | `chat.Conversation` | Direct/Group 统一会话与 authority 元数据 |
| ConversationMember | `chat.ConversationMember` | 成员、角色、禁言与 Home Station 路由 |
| ChatCommand | `chat.ChatCommand` | 发送、编辑、撤回、reaction、pin 与成员变更 intent |
| ConversationEvent | `chat.ConversationEvent` | authority 提交后的有序公共事实 |
| DurableDeviceInboxItem | `chat.DurableDeviceInboxItem` | 设备级离线/重连投递单元 |
| DeviceConsumptionReceipt | `chat.DeviceConsumptionReceipt` | projection commit 后的设备消费回执 |

#### 4.1.2 同步方向
- **双向**：客户端发送消息 → Station 持久化 → Station 推送给接收方。

#### 4.1.3 同步模式组合

```text
┌─────────────────────────────────────────────────────────┐
│                    消息发送流程                            │
│  Client → POST /conversation/command → Station          │
│  Station → 持久化 → 生成事件 → SSE 推送 → 接收端        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    消息接收流程                            │
│  在线：SSE 实时推送 chat.message.appended 事件           │
│  离线：POST /device/inbox/claim → 领取设备待投递消息       │
│  历史：GET /conversation/messages?cursor=X&limit=N       │
└─────────────────────────────────────────────────────────┘
```

**实时通道**：
- Station SSE 推送 `chat.message.appended`、`chat.message.delivered`、`chat.message.read` 事件。
- 事件 Payload 通过 generated Proto 携带 conversation/message IDs、
  `sender_ptid`、content 摘要与 timestamp。

**离线补齐**：
- 客户端启动后调用 `POST /device/inbox/claim` 领取当前设备的待投递消息。
- Direct 与 Group 使用同一个 Device Inbox 协议，不按聊天类型建立第二套离线 API。
- 本地事务提交后调用 `POST /device/inbox/ack`；处理失败时使用
  `/device/inbox/*` 的 typed reject/lease 语义，不能绕回业务 API 确认。

**消息历史加载**：
- 基于 cursor 的向上翻页：`cursor` 作为游标，`limit` 控制条数。
- Direct 与 Group 都通过 `GET /conversation/messages` 查询；conversation
  kind 只影响领域投影，不改变 API owner。

#### 4.1.4 消息排序
- 消息 ID 使用 ULID（Universally Unique Lexicographically Sortable Identifier），天然有序。
- Station 在持久化时分配 ULID，确保全局有序。
- 端侧展示按 ULID 字典序排列，ULID 内嵌时间戳保证时间单调性。

#### 4.1.5 已读状态同步
- Direct 与 Group 都调用 `POST /conversation/read-cursor`，携带
  `conversation_id` 与单调递增的已读位置。
- Station 更新未读计数后，通过 SSE 推送 `chat.message.read` 事件到对端。
- 端侧收到已读事件后更新本地消息状态为 `READ`。

#### 4.1.6 冲突场景与解决
- **消息顺序冲突**：不存在——ULID 由 Station 唯一分配，无并发写同一 ID 的可能。
- **已读状态冲突**：多端同时标记已读 → Station 取 `max(last_read_ulid)` 作为最终值（天然幂等）。
- **消息撤回冲突**：撤回操作仅发送者可执行，Station 校验权限后软删除，推送事件通知各端。

---

### 4.2 AI Chat 同步

#### 4.2.1 数据结构

| 实体 | Proto 定义 | 说明 |
| --- | --- | --- |
| ChatSession | `ai_chat.ChatSession` | AI 会话，含 agent_id、model_name、provider_id |
| ChatMessage | `ai_chat.ChatMessage` | AI 消息，含 role、content、tool_calls |
| ChatTopic | `ai_chat.ChatTopic` | 话题分组 |
| Provider | `ai_chat.Provider` | AI 服务商配置 |
| MessageAttachment | `ai_chat.MessageAttachment` | 消息附件 |

#### 4.2.2 同步方向
- **Station ↔ 双端**：会话和消息由 Station 统一管理，端侧创建/删除操作通过 API 提交到 Station。

#### 4.2.3 同步模式组合

**会话列表同步**：
- 首次加载：`GET /ai-chat/sessions?page_size=N&page_token=X`（增量拉取）。
- 后续刷新：事件触发（收到会话变更事件后重新拉取）。

**会话创建/更新/删除**：
- 创建：`POST /ai-chat/sessions` → Station 返回完整 `ChatSession`。
- 更新：`PUT /ai-chat/sessions/{id}` → Station 返回更新后的 `ChatSession`。
- 删除：`DELETE /ai-chat/sessions/{id}` → Station 级联删除关联消息。
- Station 在变更后发布事件，其他在线端收到事件后刷新本地缓存。

**消息历史同步**：
- 进入会话时拉取：`GET /ai-chat/sessions/{id}/messages?page_size=N&page_token=X`。
- 端侧缓存最近 N 条消息，翻页时按需加载。

**流式 AI 响应**：
- 客户端发起 `POST /ai-chat/completions`（`stream=true`）。
- Station 以 SSE 格式流式返回 `ChatCompletionResponse` 的 delta。
- 流结束后 Station 持久化完整 Assistant 消息，端侧同步更新。
- 流式响应不经过通用事件通道，而是通过 HTTP 响应体的 SSE 流直接返回。

**Agent 配置变更传播**：
- Agent 配置存储在 `ChatSession.config_json` 中。
- 更新通过 `PUT /ai-chat/sessions/{id}` 提交。
- 其他端通过事件触发拉取最新配置。

#### 4.2.4 Provider/Model 配置同步
- Provider 列表：`GET /ai-chat/providers?page_number=N&page_size=M`。
- Provider CRUD 通过 Station API 完成，端侧仅读取与缓存。
- 配置变更后 Station 发布事件，端侧刷新缓存。

---

### 4.3 Memory 同步

#### 4.3.1 数据结构
- 记忆条目：key-value 结构 + embedding vector（存储在 Station 侧）。
- 端侧视图：文本形式的记忆摘要列表。

#### 4.3.2 同步方向
- **Station → 双端**（读取为主）：Station 在 AI Chat 过程中由 AI 服务自动写入记忆，端侧以只读方式展示。

#### 4.3.3 同步模式
- **全量拉取**：端侧进入 Memory 页面时 `GET /memory/list?limit=N&offset=M` 拉取记忆列表。
- **事件触发刷新**：AI Chat 过程中如果生成了新记忆，Station 发布 `memory.updated` 事件，端侧在下次访问 Memory 页面时刷新。

#### 4.3.4 缓存策略
- 端侧缓存记忆的文本摘要，不缓存 embedding vector。
- 缓存有效期：30 分钟（内存）/ 24 小时（本地数据库）。
- 记忆搜索在 Station 侧完成（利用向量检索），端侧仅做文本关键词匹配作为降级方案。

---

### 4.4 Applets 同步

#### 4.4.1 数据结构

| 实体 | Proto 定义 | 说明 |
| --- | --- | --- |
| AppletInfo | `applet.AppletInfo` | Applet 基础信息 |
| AppletVersionInfo | `applet.AppletVersionInfo` | 版本详情，含 bundle_url、bundle_hash |

#### 4.4.2 同步方向
- **Station ↔ 双端**：安装/卸载操作由端侧发起，Station 作为权威记录。

#### 4.4.3 同步模式

**已安装列表同步**：
- 首次加载：`GET /applets/installed?limit=N&offset=M`（全量拉取，列表通常较小）。
- 事件触发：Station 在 Applet 安装/卸载/更新后发布 `applet.installed` / `applet.uninstalled` / `applet.updated` 事件，其他端收到后刷新列表。

**Bundle 版本管理**：
- 端侧缓存已下载的 Bundle（按 `applet_id + version` 存储）。
- 启动 Applet 时校验本地 Bundle 版本与 Station 记录的 `latest_version` 是否一致。
- 版本不一致时从 `bundle_url` 下载新版本，校验 `bundle_hash` 后替换。
- 下载失败时使用本地已有版本（降级运行）。

**Applet 配置同步**：
- Applet 级 KV 配置存储在 Station 侧。
- 端侧通过 `GET /applets/{id}/config` 拉取，通过 `PUT /applets/{id}/config` 更新。
- 配置变更后 Station 发布事件，其他端刷新。

---

### 4.5 Settings 同步

#### 4.5.1 设置分类

| 类别 | 范围 | 存储位置 | 同步策略 |
| --- | --- | --- | --- |
| 账户级设置 | 跨设备同步 | Station | Last-Write-Wins |
| 设备级设置 | 仅本地 | 端侧本地存储 | 不同步 |

#### 4.5.2 账户级设置
- 语言偏好（`locale`）
- 通知偏好（推送开关、免打扰时段）
- AI 偏好（默认模型、温度参数）
- 隐私设置（在线状态可见性、已读回执开关）
- Feature Flags（`feature_flags`）

**同步方式**：
- 读取：`GET /actor/preferences` → 返回 `ActorPreferences` Proto。
- 写入：`PUT /actor/preferences` → 提交更新后的 `ActorPreferences`。
- Station 在变更后发布 `settings.updated` 事件，其他在线端收到后拉取最新值。

#### 4.5.3 设备级设置
- 主题模式（深色/浅色/跟随系统）
- 字号大小
- 缓存策略（缓存大小上限、清理策略）
- 网络偏好（仅 Wi-Fi 下载大文件）

**存储方式**：
- Android：`DataStore`（Preferences DataStore）。
- iOS：`UserDefaults`。
- 不上传 Station，不跨设备同步。

#### 4.5.4 冲突解决
- 账户级设置采用 **Last-Write-Wins**：Station 以最后一次写入的值为准。
- `ActorPreferences` 携带 `schema_version` 字段，用于检测 Schema 升级冲突。

---

### 4.6 Skills / MCP 同步

#### 4.6.1 数据结构
- Skill 定义：技能名称、描述、参数 Schema、启用状态。
- MCP Server 配置：Server 地址、协议版本、可用工具列表。

#### 4.6.2 同步方向
- **Station ↔ 双端**：Skills 和 MCP 配置由 Station 管理，端侧读取与缓存。

#### 4.6.3 同步模式
- **首次加载**：全量拉取 Skills 列表和 MCP Server 列表。
- **变更传播**：Station 在 Skill/MCP 配置变更后发布事件（`skill.updated` / `mcp.config_changed`），端侧收到后刷新。
- 数据量小，变更频率低，全量拉取即可满足需求。

---

### 4.7 Channels 同步

#### 4.7.1 数据结构
- 频道列表：频道 ID、名称、描述、Bot 状态。
- 频道消息流：类似 Chat 消息结构。

#### 4.7.2 同步方向
- **Station ↔ 双端**：频道由 Station 管理，消息双向流动。

#### 4.7.3 同步模式
- 与 Chat 模式高度一致：
  - 实时推送：SSE 推送新频道消息事件。
  - 离线补齐：基于 cursor 的增量拉取。
  - 消息历史：`before_ulid` + `limit` 分页。
- 频道列表变更（创建/删除/Bot 上下线）通过事件触发同步。

---

### 4.8 Timeline 同步

#### 4.8.1 数据结构

| 实体 | Proto 定义 | 说明 |
| --- | --- | --- |
| Post | `social.Post` | 动态，支持 Text/Image/Video/Link/Poll/Repost/Location 类型 |
| PostStats | `social.PostStats` | 互动统计（点赞/评论/转发/浏览） |
| PostInteraction | `social.PostInteraction` | 当前用户的互动状态 |

#### 4.8.2 同步方向
- **Station → 双端**（拉取为主）：Timeline 数据由 Station 聚合（包括联邦数据），端侧主动拉取。

#### 4.8.3 同步模式

**Timeline 拉取**：
- `GET /timeline?type={HOME|USER|PUBLIC}&cursor=X&limit=N` → 返回 `GetTimelineResponse`。
- 基于 cursor 的无限滚动分页。
- 首次加载拉取最新 20 条，下拉刷新时用空 cursor 拉取增量。

**互动操作**：
- 点赞：`POST /posts/{id}/like` → Station 更新计数 → 返回新计数。
- 评论：`POST /posts/{id}/comments` → Station 持久化 → 推送事件给动态作者。
- 转发：`POST /posts/{id}/repost` → Station 创建转发帖。

**刷新策略**：
- 前台活跃时：用户下拉触发刷新。
- 后台恢复前台时：自动增量拉取（距离上次刷新 > 5 分钟）。
- 不使用实时推送（Timeline 是 Feed 流，延迟敏感度低）。

---

### 4.9 Profile / OAuth2 同步

#### 4.9.1 Profile 同步

**数据结构**：Actor（用户资料）含 ID、handle、display_name、avatar_url、bio 等。

**同步方向**：Station ↔ 双端。

**同步模式**：
- 当前用户 Profile：登录后全量拉取，缓存到本地。
- Profile 变更：`PUT /actor/profile` → Station 更新 → 发布 `profile.updated` 事件 → 其他端刷新。
- 他人 Profile：按需拉取（打开用户主页时），缓存有效期 1 小时。

#### 4.9.2 OAuth2 同步

**数据结构**：`OAuthClient`、`OAuthToken`（Proto 定义于 `oauth.proto`）。

**同步方向**：Station → 双端（只读）。

**同步模式**：
- OAuth 连接状态列表：`GET /oauth/connections` → 返回已授权的第三方服务列表。
- 连接/断开操作通过 Station OAuth 流程完成。
- 状态变更后 Station 发布 `oauth.connection_changed` 事件，端侧刷新。

**多设备登录**：
- 每个设备独立持有 Session Token（`AuthTokens.access_token` + `refresh_token`）。
- Token 刷新由各端独立完成，Station 支持同一用户多个有效 Session。
- 设备注销时 Station 仅吊销该设备的 Token，不影响其他设备。

---

## 5. 冲突解决策略

### 5.1 策略定义

| 策略 | 缩写 | 说明 | 适用场景 |
| --- | --- | --- | --- |
| Last-Write-Wins | LWW | Station 以最后一次写入的值为准，基于 `updated_at` 时间戳 | 设置项、Profile 更新 |
| Server-Wins | SW | Station 侧的值始终优先，端侧写入冲突时以 Station 返回值覆盖本地 | 消息排序、未读计数 |
| Append-Only | AO | 写操作只追加不覆盖，不存在并发修改同一记录的场景 | 消息发送、评论、点赞 |
| Merge Strategy | MS | 按字段级合并，非冲突字段各自保留 | 预留，当前未使用 |

### 5.2 各模块策略对照表

| 模块 | 策略 | 说明 |
| --- | --- | --- |
| Chat 消息 | AO + SW | 消息追加写入无冲突；排序由 Station 的 ULID 决定 |
| Chat 已读状态 | SW | Station 取 max(last_read_ulid)，端侧以 Station 返回为准 |
| AI Chat 会话 | LWW | 会话标题/配置等属性以最后写入为准 |
| AI Chat 消息 | AO + SW | 消息由 Station 持久化后分配 ID，无并发冲突 |
| Memory | SW | Station 为唯一写入方 |
| Applets | SW | 安装列表以 Station 记录为准 |
| Settings（账户级） | LWW | 以最后提交的偏好值为准 |
| Settings（设备级） | N/A | 不同步，无冲突 |
| Skills / MCP | SW | Station 为配置权威 |
| Channels | AO + SW | 同 Chat |
| Timeline | AO | 创建为追加操作，编辑/删除由 Station 仲裁 |
| Profile | LWW | 以最后提交的资料为准 |
| OAuth2 | SW | Station 为 OAuth 状态权威 |

---

## 6. 离线行为设计

### 6.1 离线检测与状态机

```text
┌─────────┐    网络不可用 / SSE 断开    ┌──────────┐
│  ONLINE  │ ──────────────────────────► │  OFFLINE │
│          │ ◄────────────────────────── │          │
└─────────┘    网络恢复 + SSE 重连成功    └──────────┘
     │                                        │
     │    SSE 断开但网络可用                    │
     │         (HTTP 仍可达)                   │
     ▼                                        │
┌──────────┐                                  │
│ DEGRADED │ ─────────────────────────────────┘
│          │    SSE 重连成功
└──────────┘
```

**状态定义**：
- `ONLINE`：SSE 连接正常，实时推送可用。
- `DEGRADED`：SSE 断开但 HTTP API 可达，退化为轮询模式。
- `OFFLINE`：网络完全不可用；只有具备已批准 durable-command contract 的
  写操作进入队列，其他写操作保持草稿或显式不可用。

**检测机制**：
- Android：`ConnectivityManager` 监听网络变化 + SSE 连接状态。
- iOS：`NWPathMonitor` 监听网络变化 + SSE 连接状态。

### 6.2 本地缓存深度

| 模块 | 缓存范围 | 保留策略 |
| --- | --- | --- |
| Chat 会话列表 | 全部会话 | 持久化，无过期 |
| Chat 消息 | 每会话最近 200 条 | 持久化，超出时淘汰最旧 |
| AI Chat 会话列表 | 全部会话 | 持久化，无过期 |
| AI Chat 消息 | 每会话最近 100 条 | 持久化，超出时淘汰最旧 |
| Memory | 全部摘要 | 持久化，24 小时后标记为 stale |
| Applets 列表 | 全部已安装 | 持久化，无过期 |
| Applet Bundle | 最近使用的 10 个 | 文件缓存，LRU 淘汰 |
| Settings | 全部 | 持久化，无过期 |
| Skills / MCP | 全部 | 持久化，启动时刷新 |
| Timeline | 最近 100 条 | 持久化，启动时刷新 |
| Profile（自己） | 完整 | 持久化，无过期 |
| Profile（他人） | 最近查看的 50 个 | 内存缓存，1 小时过期 |

### 6.3 离线操作队列

**设计原则**：
- Frontend Runtime `InteractionAdmission` owns shared work semantics；Mobile
  `commandRuntime` is its platform implementation.
- 每个可排队操作携带稳定 command ID，并要求 Station 去重与结果 readback。
- 同一 `ordering_key` 串行，跨 key 公平调度；不使用跨域全局 FIFO。
- 响应可能丢失的写进入 `unknown-outcome`，readback 前禁止自动重放。
- 容量耗尽返回 typed overload，不丢弃或覆盖未完成操作。

**队列存储**：
- 单一持久化 owner：`mobile-rust` encrypted transactional command ledger。
- mobile-web 只通过 typed Tauri commands 访问，不直接持久化命令。
- Android/iOS native plugins 不维护第二份 Room/SwiftData outbox。

**队列操作结构**：

```text
MobileDurableCommand {
    schema_revision
    command_id
    station_peer_id
    actor_ptid
    ordering_key
    command_kind
    oneof typed_payload
    created_at
    attempt_count
    state
    last_error_code
}
```

**支持离线排队的操作**：
- Chat、Settings、Timeline 等操作只有在各自 Station command
  idempotency/readback contract 完成后才启用。
- 大媒体字节不进入 ledger；记录仅引用已加密 blob。
- 未具备 contract 的操作保留用户草稿并解释不可用原因。

### 6.4 重连后同步重放流程

```text
┌──────────────────────────────────────────────────────────────┐
│                   重连同步流程（Resume Sync）                  │
│                                                                │
│  1. 网络恢复                                                   │
│     └── 重建 SSE 连接（携带 Last-Event-ID）                    │
│                                                                │
│  2. 补齐离线事件                                               │
│     └── SSE 重连后 Station 自动推送断连期间的事件               │
│     └── 若 Last-Event-ID 过期，退化为增量拉取                  │
│                                                                │
│  3. 收敛 durable command ledger                               │
│     └── 校验 station_peer_id + actor_ptid                      │
│     └── unknown-outcome 先查 command result / authoritative readback │
│     └── 仅重放已证明未提交且允许同 command ID 幂等重试的操作    │
│     └── 按 ordering key 串行、跨 key 公平调度                  │
│                                                                │
│  4. 增量拉取关键数据                                           │
│     └── Chat：拉取离线消息 + 更新未读计数                       │
│     └── AI Chat：刷新会话列表                                   │
│     └── Settings：拉取最新偏好                                  │
│                                                                │
│  5. 状态收敛                                                   │
│     └── 各模块本地缓存与 Station 对齐                          │
│     └── 切换回 ONLINE 状态                                     │
└──────────────────────────────────────────────────────────────┘
```

### 6.5 冲突检测与提示
- 离线队列回放时，若 Station 返回 `409 Conflict` 或版本不匹配错误：
  - 消息发送冲突：保留原 command ID 并查询 authoritative result；禁止换 ID
    盲重试。
  - 设置冲突：以 Station 返回值覆盖本地（LWW），提示用户"设置已被其他设备更新"。
  - 已读状态冲突：不提示，静默以 Station 值为准。

---

## 7. 实时通道设计

### 7.1 SSE 连接管理

**连接建立**：
- 端点：`GET /events/stream`
- 认证：HTTP Header 携带 `Authorization: Bearer <access_token>`
- 参数：`Last-Event-ID`（可选，用于断线重连时补齐事件）

**心跳机制**：
- Station 每 30 秒发送一个 SSE comment 作为心跳：`: heartbeat\n\n`
- 端侧如果 60 秒未收到任何数据（含心跳），判定连接断开，触发重连。

**重连策略**：
- 指数退避：初始 1 秒，最大 30 秒，退避因子 2。
- 重连时携带 `Last-Event-ID`，Station 尝试补发丢失的事件。
- 连续失败 10 次后进入 `DEGRADED` 状态，降级为周期性 HTTP 轮询。
- 网络状态变化时（Wi-Fi ↔ 蜂窝切换）立即尝试重连。

**多路复用**：
- 所有业务模块共享同一条 SSE 连接，通过事件类型（`type` 字段）分发。
- 不为每个模块建立独立连接，减少连接数与电池消耗。

### 7.2 事件分发机制

```text
┌────────────┐
│   Station   │
│  SSE Push   │
└──────┬─────┘
       │  JSON Event
       ▼
┌──────────────────┐
│  SSE Client      │
│  (连接管理层)     │
└──────┬───────────┘
       │  解析 Event
       ▼
┌──────────────────┐
│  Event Router    │
│  (事件路由层)     │
│                  │
│  按 event.type   │
│  分发到 Handler  │
└──────┬───────────┘
       │
       ├──► ChatEventHandler
       ├──► AIChatEventHandler
       ├──► AppletEventHandler
       ├──► SettingsEventHandler
       ├──► ProfileEventHandler
       └──► ... (其他模块 Handler)
```

**平台实现**：
- `mobile-web` shared event ingress 负责 Proto decode、dedup、cursor/gap 和
  runtime routing。
- `mobile-rust` 与 Android/iOS native plugins 只负责连接、push、resume 和
  network wakeup，不直接注册业务 Handler 或修改 projection。

### 7.3 事件消息格式

Station 推送事件使用 `model/domain/realtime/event.proto` 生成契约。下列仅为
字段语义示意，不是可独立实现的 JSON 真源：

```json
{
  "eventId": "20260331T120000.123456789",
  "version": 1,
  "type": "chat.message.appended",
  "actor_ptid": "p:alice",
  "target_ptid": "p:bob",
  "objectId": "01JQXYZ...",
  "scope": "actor",
  "seq": 42,
  "ts": "2026-03-31T12:00:00.123Z",
  "payload": {
    "convId": "01JQABC...",
    "msgId": "01JQXYZ...",
    "sender_ptid": "p:alice",
    "content": "Hello!",
    "msgType": "text",
    "timestamp": 1743422400123
  }
}
```

**字段说明**：
- `eventId`：事件唯一标识，用于去重与 ACK。
- `version`：事件 Schema 版本，用于兼容性检查。
- `type`：事件类型，决定路由到哪个 Handler。
- `actor_ptid`：事件发起者的 canonical PTID。
- `target_ptid`：事件接收者的 canonical PTID。
- `objectId`：关联的业务对象 ID。
- `scope`：投递范围（`actor` / `conv` / `content`）。
- `seq`：每个 target 维度的递增序列号，用于检测事件丢失。
- `ts`：事件生成时间。
- `payload`：业务负载，结构取决于 `type`。

**事件类型注册表（已定义 + 待扩展）**：

| 类型 | 说明 | 状态 |
| --- | --- | --- |
| `chat.message.appended` | 新消息到达 | 已实现 |
| `chat.message.delivered` | 消息已送达 | 已实现 |
| `chat.message.read` | 消息已读 | 已实现 |
| `follow.requested` | 好友请求 | 已实现 |
| `follow.accepted` | 好友请求已接受 | 已实现 |
| `system.alert` | 系统告警 | 已实现 |
| `ai_chat.session.created` | AI 会话创建 | 待实现 |
| `ai_chat.session.updated` | AI 会话更新 | 待实现 |
| `ai_chat.session.deleted` | AI 会话删除 | 待实现 |
| `memory.updated` | 记忆更新 | 待实现 |
| `applet.installed` | Applet 安装 | 待实现 |
| `applet.uninstalled` | Applet 卸载 | 待实现 |
| `applet.updated` | Applet 更新 | 待实现 |
| `settings.updated` | 账户设置变更 | 待实现 |
| `skill.updated` | Skill 配置变更 | 待实现 |
| `mcp.config_changed` | MCP 配置变更 | 待实现 |
| `profile.updated` | 个人资料变更 | 待实现 |
| `oauth.connection_changed` | OAuth 连接状态变更 | 待实现 |
| `channel.message.appended` | 频道新消息 | 待实现 |

---

## 8. 安全性

### 8.1 Token 同步与多设备登录

**Session 模型**：
- 每个设备登录后获得独立的 `AuthTokens`（access_token + refresh_token）。
- Station 维护 Session 表，记录每个设备的登录时间、设备信息、最后活跃时间。
- 同一用户可同时拥有多个有效 Session（多设备并行使用）。

**Token 生命周期**：
- `access_token`：短生命周期（15 分钟），用于 API 认证。
- `refresh_token`：长生命周期（30 天），用于刷新 access_token。
- 端侧在 access_token 过期前自动刷新（剩余 2 分钟时触发）。
- refresh_token 过期需重新登录。

**安全存储**：
- Android：`EncryptedSharedPreferences`（AES-256 加密）。
- iOS：`Keychain`（系统级安全存储）。

### 8.2 传输加密

**基线加密**：
- 所有 Station 通信强制使用 TLS 1.3。
- SSE 连接同样走 HTTPS。
- 客户端实施证书锁定（Certificate Pinning），防止中间人攻击。

**消息级加密（私密聊天）**：
- Friend Chat 支持端到端加密模式：消息体使用接收方公钥加密（`MessageEnvelope.encrypted_payload`）。
- Station 仅中继加密后的消息体，无法解密内容。
- 密钥协商：通过 `Friend.public_key` 交换，后续可升级为 MLS 协议。
- Group Chat 加密通过 `message.KeyRotateRequest` 支持密钥轮换。

### 8.3 设备授权与注销

**设备注册**：
- 新设备登录时，Station 记录设备指纹（平台 + 设备型号 + 唯一标识）。
- 用户可在 Settings 中查看已登录设备列表。

**设备注销**：
- 用户可远程注销其他设备：`POST /actor/sessions/{session_id}/revoke`。
- Station 立即吊销该设备的所有 Token。
- 如果该设备有活跃的 SSE 连接，Station 主动关闭连接。
- 被注销的设备在下次 API 调用时收到 `401 Unauthorized`，清理本地缓存并跳转登录页。

**Token 吊销传播**：
- Station 吊销 Token 后，通过 SSE 向该设备发送 `system.session_revoked` 事件（如果连接仍存活）。
- 端侧收到该事件后立即清理本地凭证与缓存，退出到登录页。

---

## 9. 验收标准

### 9.1 功能验收

| 编号 | 验收项 | 说明 |
| --- | --- | --- |
| F-01 | 实时消息送达 | Chat 消息在对端在线时 2 秒内送达并展示 |
| F-02 | 离线消息补齐 | 端侧离线后重连，30 秒内完成离线消息补齐 |
| F-03 | 多端消息一致 | 同一用户在 Desktop 和 Mobile 上看到的消息列表一致（最终一致性窗口 ≤ 5 秒） |
| F-04 | 已读状态同步 | 一端标记已读后，其他端 5 秒内更新已读状态 |
| F-05 | AI Chat 流式响应 | Mobile 端收到 AI 流式响应延迟不超过 Desktop 端 500ms |
| F-06 | 设置跨端同步 | 在一端修改账户级设置，其他端 10 秒内生效 |
| F-07 | 离线操作队列 | 已批准的幂等命令自动恢复；unknown outcome 先 readback，未证明未提交时不重放 |
| F-08 | Applet 版本同步 | Applet 更新后，各端在下次启动该 Applet 时自动更新 Bundle |

### 9.2 性能验收

| 编号 | 验收项 | 指标 |
| --- | --- | --- |
| P-01 | SSE 重连时间 | 网络恢复后 ≤ 5 秒内重建 SSE 连接 |
| P-02 | 增量同步延迟 | 冷启动增量同步（100 条消息）≤ 3 秒 |
| P-03 | 离线队列回放 | 10 条离线操作回放 ≤ 5 秒 |
| P-04 | 本地缓存命中率 | 常用数据（会话列表、最近消息）本地缓存命中率 ≥ 90% |
| P-05 | 电池影响 | SSE 长连接待机状态下额外电池消耗 ≤ 2%/小时 |

### 9.3 安全验收

| 编号 | 验收项 | 说明 |
| --- | --- | --- |
| S-01 | 传输加密 | 所有通信走 TLS 1.3，禁止明文传输 |
| S-02 | Token 安全存储 | Token 使用平台安全存储（Keychain / EncryptedSharedPreferences） |
| S-03 | 设备注销有效性 | 远程注销后，被注销设备 10 秒内失去 API 访问能力 |
| S-04 | 端到端加密 | 加密聊天消息 Station 侧不可解密，日志不记录明文 |

### 9.4 一致性验收

| 编号 | 验收项 | 说明 |
| --- | --- | --- |
| C-01 | 幂等性 | 同一写操作重复提交不产生副作用 |
| C-02 | 事件不丢失 | 在线期间事件投递率 ≥ 99.9%（通过 seq 序列号检测） |
| C-03 | 冲突解决确定性 | 所有冲突场景的解决结果可预测、可复现 |
| C-04 | Proto 一致性 | Android / iOS / Desktop 三端的 Proto Model 字段完全一致 |
