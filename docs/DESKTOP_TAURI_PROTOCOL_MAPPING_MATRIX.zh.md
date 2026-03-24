# Desktop 三向协议映射矩阵（T1）

## 目标

- 冻结 `model proto ↔ Rust 手写 contracts/commands ↔ desktop_api` 的当前映射关系。
- 明确每个域的状态：一致 / 可映射 / 缺失 / 冗余。
- 固化 `conversation_id` 与 `session_id/topic_id` 的统一语义。

## 基线快照

- Rust command 入口（已注册域）：auth/settings/chat/timeline/profile/admin。参考 [main.rs](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/desktop/src-tauri/src/main.rs#L13-L46)。
- Rust 手写契约：`interface/contracts/mod.rs`。参考 [contracts/mod.rs](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/desktop/src-tauri/src/interface/contracts/mod.rs#L1-L121)。
- Desktop 统一 API 入口：`services/desktop_api.ts`。参考 [desktop_api.ts](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/desktop/src/services/desktop_api.ts#L1-L55)。
- Model 协议目录：`model/domain/*`。参考 [model](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/model/domain)。

## 域级映射

| 域 | model proto | Rust contracts/command | desktop_api | 状态 |
|---|---|---|---|---|
| Auth | `model/domain/auth/auth.proto` + `model/domain/actor/session_api.proto` | `AuthLoginInput`/`AuthValidateTokenInput` + `auth_*` | `authLogin/authValidateToken/authRestoreSession/authLogout` | 可映射 |
| Chat | `model/domain/ai_chat/chat.proto` + `session_messages.proto` + `message_messages.proto` | `Chat*Input` + `chat_*` | `listSessions/getMessages/deleteMessage/...` | 可映射（含语义差异） |
| Timeline | `model/domain/social/social.proto` | `TimelineListInput`/`TimelineActionInput` + `timeline_*` | `timelineList/timelineLike/timelineComment/timelineRepost` | 可映射（字段类型差异） |
| Profile | `model/domain/actor/actor.proto` | `ProfileUpdateInput`/`ProfilePrivacyInput` + `profile_*` | `profileGet/profileUpdate/...` | 可映射（字段集合差异） |
| Settings | `model/domain/actor/preferences.proto` | `SettingsGetInput`/`SettingsSetInput` + `settings_*` | `settingsGet/settingsSet/settingsReset` | 可映射（抽象层级差异） |
| Admin/Health | `model/domain/manage/health.proto` | `admin_health/admin_network_probe/admin_execute_action` | `adminHealth/adminNetworkProbe/adminExecuteAction` | 部分缺失（probe/execute 无 model 定义） |

## 关键字段语义冻结

### Chat ID 规则

- `desktop_api` 与 Rust contracts 统一使用 `conversation_id` 作为客户端会话标识。参考 [contracts/mod.rs](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/desktop/src-tauri/src/interface/contracts/mod.rs#L35-L80)。
- `model` 的 ai_chat 主体使用 `session_id`（会话）+ `topic_id`（主题）。参考 [chat.proto](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/model/domain/ai_chat/chat.proto#L26-L85)。
- 冻结映射规则：
  - `conversation_id -> session_id`
  - `topic_id` 在 Desktop 当前阶段默认空或内部派生
  - 任何新命令不得再引入第三种会话主键

### Timeline 主键类型

- `model` 使用 `uint64 post_id`。参考 [social.proto](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/model/domain/social/social.proto#L82-L96)。
- Rust contracts 当前为 `string post_id`。参考 [contracts/mod.rs](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/desktop/src-tauri/src/interface/contracts/mod.rs#L88-L92)。
- 冻结策略：短期保持字符串入参，Rust 适配层做解析；中期将 model 与 command DTO 对齐到统一主键规范。

## 新架构 Scope 覆盖判定

### 已有 model 覆盖（但未完全对齐实现）

- ai_chat
- auth/session
- social
- actor/profile/preferences
- oauth
- manage/health

### model 未覆盖或覆盖不足（相对 Desktop 现有能力）

- skills / market
- mcp
- cron
- channels
- memory
- tts
- notebooks
- admin probe/execute 动作语义

## 通道一致性判定

- `desktop_api.ts` 仍保留大量 `request()` 路径（HTTP 直连）。参考 [desktop_api.ts](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/desktop/src/services/desktop_api.ts#L1149-L1933)。
- 当前结论：**尚未达到业务通道 command-only**。

## T1 输出结论

- 已冻结三向映射的当前事实与差异。
- 已冻结 chat 主键语义规则。
- 可进入 T2：补齐 model 新架构 scope 并开始按域迁移。
