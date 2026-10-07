# Desktop Rust 后端架构文档

## 概述

Desktop Rust 后端遵循 DDD（领域驱动设计）分层架构，将代码划分为接口层、应用层、领域层、基础设施层四个核心层次，外加模型层和状态层两个辅助层。

## 目录结构

```
src-tauri/src/
├── interface/              # 接口层 - Tauri command 注册入口
│   ├── contracts/          # 输入/输出类型定义（serde）
│   └── tauri_commands/     # Command handler 函数
├── application/            # 应用层 - 业务编排（28 个模块）
│   ├── auth/               # 认证服务
│   ├── chat/               # 聊天存储（737 行，完整 CRUD + 流式处理）
│   ├── cron/               # 定时任务管理
│   ├── mcp/                # MCP 服务器管理
│   ├── tts/                # 文字转语音
│   └── ...                 # account, admin, agents, applets, channels 等
├── domain/                 # 领域层 - 纯业务逻辑，无框架依赖
│   ├── auth/               # session.rs
│   ├── chat/               # Conversation, Message, DeliveryVia, 验证函数
│   ├── settings/           # SettingKey 枚举, validate_value, side_effect
│   ├── storage/            # database, key_management
│   └── ...                 # admin, applets, profile, timeline
├── infrastructure/         # 基础设施层 - 外部集成
│   ├── auth_identity/      # 身份管理
│   ├── storage/            # 通用数据库与密钥基础设施
│   ├── logger/             # 基于 Tracing 的日志
│   ├── p2p/                # P2P 网络
│   ├── realtime/           # 实时连接
│   ├── station_client/     # Station HTTP 客户端
│   ├── storage/            # StorageLayout（文件系统）
│   └── timeline_store/     # Timeline 持久化
├── model/                  # Proto 生成的 Rust 类型（通过 prost）
│   └── mod.rs              # include!("peers_touch.model.<domain>.v1.rs") 覆盖 20 个域
├── state/                  # 全局应用状态（Mutex 包裹）
│   └── mod.rs              # AppState { SessionState, SettingsState, RealtimeState, StorageLayout }
```

## 分层依赖规则

各层之间的依赖关系严格遵循单向依赖原则：

```
interface → application → domain        (允许)
interface → application → infrastructure (允许)
domain → nothing (纯逻辑)               (允许)
infrastructure → domain                  (允许)

domain → infrastructure                  (禁止)
domain → application                     (禁止)
```

具体规则：

1. **接口层（interface）** 只能调用应用层，不能直接操作领域层或基础设施层。
2. **应用层（application）** 负责编排领域逻辑与基础设施调用，是唯一的协调层。
3. **领域层（domain）** 是纯业务逻辑，不依赖任何外部框架、数据库、网络等。所有外部能力通过 trait 抽象后由应用层注入。
4. **基础设施层（infrastructure）** 实现领域层定义的 trait，依赖领域层的类型定义。

依赖关系图示：

```
┌─────────────┐
│  interface   │
└──────┬───────┘
       │ 调用
┌──────▼───────┐
│ application  │
└──┬────────┬──┘
   │        │
   │ 调用   │ 调用
   ▼        ▼
┌──────┐  ┌──────────────┐
│domain│←─│infrastructure│
└──────┘  └──────────────┘
```

## 状态管理

全局状态通过 `AppState` 结构体统一管理，内部使用 `Mutex` 保证线程安全：

```rust
// state/mod.rs

pub struct AppState {
    pub session: Mutex<SessionState>,
    pub settings: Mutex<SettingsState>,
    pub realtime: Mutex<RealtimeState>,
    pub storage: StorageLayout,
}
```

在 Tauri Command 中通过托管状态获取：

```rust
#[tauri::command]
pub fn some_command(
    state: tauri::State<'_, AppState>,
) -> AppResult<SomeOutput> {
    let session = state.session.lock().unwrap();
    // 使用 session 进行业务操作
}
```

注意事项：

- `Mutex` 锁的持有时间应尽可能短，避免在持有锁期间执行 I/O 操作。
- `StorageLayout` 本身是不可变的，因此不需要 `Mutex` 包裹。
- 状态在 `main.rs` 中通过 `app.manage(app_state)` 注册。

## 模型层（Model）

模型层包含由 protobuf 通过 prost 编译生成的 Rust 类型定义，覆盖 20 个业务域：

```rust
// model/mod.rs

pub mod chat_v1 {
    include!("peers_touch.model.chat.v1.rs");
}

pub mod ai_chat_v1 {
    include!("peers_touch.model.ai_chat.v1.rs");
}

pub mod actor_v1 {
    include!("peers_touch.model.actor.v1.rs");
}

pub mod auth_v1 {
    include!("peers_touch.model.auth.v1.rs");
}

// ... 其他域: common, core, error, events, social, mastodon,
//     activity, activitypub, message, oauth, oss, peer,
//     manage, applet, launcher, peers_actor
```

完整的 20 个域模块列表：

| 序号 | 模块名 | 职责 |
|------|--------|------|
| 1 | chat | 聊天消息 |
| 2 | ai_chat | AI 聊天 |
| 3 | actor | 参与者 |
| 4 | auth | 认证授权 |
| 5 | common | 公共类型 |
| 6 | core | 核心类型 |
| 7 | error | 错误定义 |
| 8 | events | 事件 |
| 9 | social | 社交 |
| 10 | mastodon | Mastodon 协议 |
| 11 | activity | 动态 |
| 12 | activitypub | ActivityPub 协议 |
| 13 | message | 消息 |
| 14 | oauth | OAuth 授权 |
| 15 | oss | 对象存储 |
| 16 | peer | 节点 |
| 17 | manage | 管理 |
| 18 | applet | 小程序 |
| 19 | launcher | 启动器 |
| 20 | peers_actor | Peers 参与者 |

## 各层职责详解

### 接口层（interface）

接口层是 Tauri 框架与业务逻辑之间的桥梁，负责：

- 定义前端调用的 Command 函数（`#[tauri::command]`）
- 定义输入输出契约类型（`contracts/`）
- 参数反序列化与结果序列化
- 将请求分发到应用层

```rust
// interface/contracts/chat_contracts.rs
#[derive(Deserialize)]
pub struct SendMessageInput {
    pub conversation_id: String,
    pub content: String,
    pub message_type: i32,
}

#[derive(Serialize)]
pub struct SendMessageOutput {
    pub message_id: String,
    pub sent_at: i64,
}

// interface/tauri_commands/chat_commands.rs
#[tauri::command]
pub fn send_message(
    state: tauri::State<'_, AppState>,
    input: SendMessageInput,
) -> AppResult<SendMessageOutput> {
    // 调用应用层
    chat_service::send_message(&state, input)
}
```

### 应用层（application）

应用层是业务编排的核心，负责：

- 协调领域对象和基础设施完成业务用例
- 事务管理
- 调用多个领域服务完成复合操作

```rust
// application/chat/mod.rs
pub fn send_message(
    messaging: &MessagingEngine,
    input: SendMessageInput,
) -> AppResult<SendMessageOutput> {
    // 1. 领域层：校验消息内容
    domain::chat::validate_message_content(&input.content)?;

    // 2. 领域层：构建消息实体
    let message = domain::chat::Message::new(
        input.conversation_id,
        input.content,
        input.message_type,
    );

    // 3. Messaging Engine 原子提交 command/outbox/projection
    messaging.submit_message(message)?;

    AppResult::success(SendMessageOutput {
        message_id: message.id,
        sent_at: message.created_at,
    })
}
```

### 领域层（domain）

领域层是纯业务逻辑，不依赖任何外部框架：

```rust
// domain/chat/mod.rs

pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub content: String,
    pub message_type: i32,
    pub created_at: i64,
}

pub enum DeliveryVia {
    Realtime,
    P2P,
    StationRelay,
}

pub fn validate_message_content(content: &str) -> Result<(), DomainError> {
    if content.is_empty() {
        return Err(DomainError::InvalidArgument("消息内容不能为空".into()));
    }
    if content.len() > 10000 {
        return Err(DomainError::InvalidArgument("消息内容超出长度限制".into()));
    }
    Ok(())
}
```

```rust
// domain/settings/mod.rs

pub enum SettingKey {
    Theme,
    Language,
    NotificationEnabled,
    // ...
}

pub fn validate_value(key: &SettingKey, value: &str) -> Result<(), DomainError> {
    match key {
        SettingKey::Theme => {
            if !["light", "dark", "system"].contains(&value) {
                return Err(DomainError::InvalidArgument("无效的主题值".into()));
            }
        }
        // ...
    }
    Ok(())
}

pub fn side_effect(key: &SettingKey) -> Option<SideEffect> {
    match key {
        SettingKey::Theme => Some(SideEffect::RefreshUI),
        SettingKey::Language => Some(SideEffect::ReloadI18n),
        _ => None,
    }
}
```

### 基础设施层（infrastructure）

基础设施层实现所有外部交互：

```rust
// messaging/store.rs
pub struct MessagingStore {
    db: SqliteConnection,
}

impl MessagingStore {
    pub fn save_message(&self, message: &Message) -> Result<(), InfraError> {
        // SQLite 持久化逻辑
    }

    pub fn get_messages(
        &self,
        conversation_id: &str,
        limit: i32,
        offset: i32,
    ) -> Result<Vec<Message>, InfraError> {
        // 查询逻辑
    }
}
```

```rust
// infrastructure/station_client/mod.rs
pub struct StationClient {
    base_url: String,
    http_client: reqwest::Client,
}

impl StationClient {
    pub async fn sync_messages(
        &self,
        since: i64,
    ) -> Result<Vec<Message>, InfraError> {
        // HTTP 请求 Station 服务
    }
}
```

## 新增业务模块的标准流程

以新增"收藏夹"功能为例：

```
1. domain/favorites/mod.rs          # 定义 Favorite 实体、验证逻辑
2. infrastructure/favorites_store/  # 实现 SQLite 持久化
3. application/favorites/mod.rs     # 编排：校验 → 持久化 → 推送
4. interface/contracts/favorites.rs # 定义 Input/Output 类型
5. interface/tauri_commands/favorites.rs  # 注册 Command
6. main.rs                          # invoke_handler 中注册新 Command
```

每一步只依赖其下层，严禁跨层或反向依赖。
