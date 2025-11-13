# 社交聊天功能设计（参考联邦社交方案）

## 总体目标
- 实现点对点与群聊的社交聊天，独立于 `ai_chat`，复用现有网络与存储能力。
- 采用领域（Domain）- 应用（Application）- 表现（Presentation）分层，保证职责清晰与可维护性。

## 架构分层
- Domain（领域层）
  - 模型：`User`、`Conversation`、`Message`、`Attachment`、`PresenceStatus`、`TypingEvent`。
  - 规则：消息可见性为 Direct；参与者集合确定会话；消息投递状态生命周期。
- Application（应用层）
  - 服务：`ChatService`（聚合入口）、`ConversationService`、`MessageService`、`StreamingService`。
- 后端适配：`ChatBackend` 接口；`SocialBackendAdapter` 实现。
  - 存储与同步：复用 Hybrid/Local/Http 驱动，离线队列与冲突解决。
- Presentation（表现层）
  - 控制器：`ConversationListController`、`MessageThreadController`、`ContactPickerController`。
  - 页面与组件：聊天主页（会话列表）、会话页（消息列表+输入框）、新消息对话框、联系人选择器、消息气泡、输入栏、状态/打字指示。

## 接口映射示例
- 私信使用 `POST /api/v1/statuses`，参数包含 `visibility=direct`、`status=@username 内容`、`media_ids=[...]`。
- 会话接口：`GET /api/v1/conversations`、`GET /api/v1/conversations/:id`、`POST /api/v1/conversations/:id/read`、`DELETE /api/v1/conversations/:id`。
- 联系人搜索：`GET /api/v1/accounts/search`，支持 `username@domain`。
- 流式推送：Streaming API（WebSocket/SSE）订阅 Direct/Notifications，用于实时消息与会话更新。

## 数据模型
- Conversation：`id`、`participantIds`、`lastMessageId/At`、`unreadCount`、`muted`、`pinned`、`createdAt/updatedAt`。
- Message：`id`、`conversationId`、`authorId`、`contentText`、`contentHtml`、`attachments`、`visibility=direct`、`createdAt`、`deliveryState`。
- User：`id`、`handle=username@domain`、`displayName`、`avatarUrl`、`note`、`domain`。
- Attachment：`id`、`type=image/file/audio`、`mime`、`size`、`url` 或 `bytes`。
- PresenceStatus/TypingEvent：`conversationId`、`userId`、`typing`、`timestamp`。

## 网络与存储
- 认证：拦截器附加 `Authorization: Bearer`，复用现有 `SecureStorage` 与刷新机制。
- 分页与查询：复用 `Page<T>` 与 `QueryOptions` 承载会话与消息分页。
- 离线与同步：消息先本地 `pending`，成功后回填服务端 ID；失败标记 `failed` 并允许重试；以服务器时间为权威解决冲突。

## 后端适配
- ChatBackend 接口
  - `fetchConversations(options)`、`fetchMessages(conversationId, options)`。
  - `sendMessage(conversationId | recipients, text, attachments)`。
  - `markRead(conversationId)`、`deleteConversation(id)`、`searchAccounts(query)`。
  - `subscribeDirectStream()` 返回流事件。
- SocialBackendAdapter 实现上述接口，将返回 JSON 映射到领域模型。

## 状态管理与 UI
- ConversationListController：加载/搜索/置顶/静音/未读计数，合并流式事件。
- MessageThreadController：分页加载、发送与投递状态、附件上传、读标记、打字指示。
- ContactPickerController：联邦账号搜索与选择。
- 页面组件：聊天主页、会话页、消息列表、输入栏、气泡、联系人选择器。

## 实现里程碑
1. 基础会话与发送：完成 Domain 与 `ChatBackend`，实现 SocialAdapter 的列表/发送/读标记最小闭环。
2. 流式推送：接入 Streaming API，实时消息与会话更新。
3. 附件与提及：媒体上传、@ 提及与建议。
4. 群聊：多人会话创建与管理。
5. 离线与可靠性：重传与冲突解决，网络感知与重试策略。
6. 安全增强（可选）：抽象 E2EE 层以支持后续升级。

## 目录结构
- `lib/features/chat/domain/models/`：`user.dart`、`conversation.dart`、`message.dart`、`attachment.dart`。
- `lib/features/chat/application/backends/`：`chat_backend.dart`、`social_backend_adapter.dart`。
- `lib/features/chat/application/services/`：`chat_service.dart`、`conversation_service.dart`、`message_service.dart`、`streaming_service.dart`。
- `lib/features/chat/presentation/`：`controllers/`、`pages/`、`widgets/`。

## 验收
- 分层清晰、依赖单向；基础闭环可发送与加载私信；运行静态分析与编译通过；后续逐步补齐流式与附件能力。