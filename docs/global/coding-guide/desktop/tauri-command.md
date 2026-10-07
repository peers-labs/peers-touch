# Tauri Command 开发指南

## 概述

本文档描述 Desktop 应用中 Tauri Command 的完整开发流程，涵盖 Rust 后端的 Command 定义、契约类型、错误处理，以及 TypeScript 前端的调用模式。

## Command 注册

所有 Command 在 `main.rs` 的 `invoke_handler` 中统一注册：

```rust
// main.rs
fn main() {
    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // 认证
            commands::auth::login,
            commands::auth::logout,
            commands::auth::refresh_token,
            // 聊天
            commands::chat::send_message,
            commands::chat::get_conversations,
            commands::chat::get_messages,
            // 设置
            commands::settings::get_setting,
            commands::settings::update_setting,
            // ... 其他 Command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

新增 Command 时，必须在此处注册，否则前端调用会报 `command not found` 错误。

## 契约定义（interface/contracts/）

### 输入类型

输入类型使用 `#[derive(Deserialize)]` 派生，字段命名使用 `snake_case`：

```rust
// interface/contracts/chat_contracts.rs
use serde::Deserialize;

#[derive(Deserialize)]
pub struct SendMessageInput {
    pub conversation_id: String,
    pub content: String,
    pub message_type: i32,
}

#[derive(Deserialize)]
pub struct GetMessagesInput {
    pub conversation_id: String,
    pub limit: Option<i32>,
    pub before_id: Option<String>,
}
```

### 输出类型

输出类型使用 `#[derive(Serialize)]` 派生：

```rust
// interface/contracts/chat_contracts.rs
use serde::Serialize;

#[derive(Serialize)]
pub struct SendMessageOutput {
    pub message_id: String,
    pub sent_at: i64,
}

#[derive(Serialize)]
pub struct ConversationItem {
    pub id: String,
    pub title: String,
    pub last_message: Option<String>,
    pub unread_count: i32,
    pub updated_at: i64,
}

#[derive(Serialize)]
pub struct GetConversationsOutput {
    pub conversations: Vec<ConversationItem>,
    pub total: i64,
}
```

### 类型对齐原则

Rust 契约类型与 TypeScript 类型必须严格对齐：

```rust
// Rust 侧
#[derive(Serialize)]
pub struct UserProfile {
    pub user_id: String,      // -> TS: userId (camelCase)
    pub display_name: String,  // -> TS: displayName
    pub avatar_url: Option<String>, // -> TS: avatarUrl?: string
    pub created_at: i64,       // -> TS: createdAt: number
}
```

```typescript
// TypeScript 侧
interface UserProfile {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: number;
}
```

如果 Rust 使用 `snake_case` 而 TypeScript 使用 `camelCase`，需要在 Rust 侧添加 serde 属性：

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub user_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub created_at: i64,
}
```

## AppResult 模式

### 定义

所有 Command 的返回值统一使用 `AppResult<T>` 包裹：

```rust
#[derive(Serialize)]
pub struct AppResult<T: Serialize> {
    pub ok: bool,
    pub data: Option<T>,
    pub error: Option<AppError>,
}

#[derive(Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

impl<T: Serialize> AppResult<T> {
    pub fn success(data: T) -> Self {
        AppResult {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn fail(code: ErrorCode, message: &str, data: Option<T>) -> Self {
        AppResult {
            ok: false,
            data,
            error: Some(AppError {
                code,
                message: message.to_string(),
            }),
        }
    }
}
```

### ErrorCode 枚举

```rust
#[derive(Serialize)]
pub enum ErrorCode {
    InvalidArgument,
    NotFound,
    Unauthorized,
    Forbidden,
    Internal,
    AlreadyExists,
    Unavailable,
    Timeout,
}
```

### 使用示例

```rust
#[tauri::command]
pub fn get_conversation(
    state: tauri::State<'_, AppState>,
    input: GetConversationInput,
) -> AppResult<ConversationDetail> {
    if input.conversation_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id 不能为空",
            None,
        );
    }

    match chat_service::get_conversation(&state, &input.conversation_id) {
        Ok(detail) => AppResult::success(detail),
        Err(e) => match e {
            ServiceError::NotFound(msg) => {
                AppResult::fail(ErrorCode::NotFound, &msg, None)
            }
            ServiceError::Internal(msg) => {
                AppResult::fail(ErrorCode::Internal, &msg, None)
            }
        },
    }
}
```

## Command 实现模式

### 基本 Command

```rust
#[tauri::command]
pub fn my_command(
    state: tauri::State<'_, AppState>,
    input: MyInput,
) -> AppResult<MyOutput> {
    // 1. 输入校验（领域层）
    if let Err(e) = domain::my_domain::validate(&input) {
        return AppResult::fail(ErrorCode::InvalidArgument, &e.to_string(), None);
    }

    // 2. 执行业务逻辑（应用层）
    match application::my_service::execute(&state, input) {
        Ok(output) => AppResult::success(output),
        Err(e) => AppResult::fail(ErrorCode::Internal, &e.to_string(), None),
    }
}
```

### 异步 Command

对于需要网络请求或耗时操作的 Command，使用 `async`：

```rust
#[tauri::command]
pub async fn sync_messages(
    messaging: tauri::State<'_, MessagingEngine>,
    input: SyncMessagesInput,
) -> Result<AppResult<SyncMessagesOutput>, ()> {
    match messaging.reconcile(input.since).await {
        Ok(result) => Ok(AppResult::success(SyncMessagesOutput {
            synced_count: result.committed_count,
        })),
        Err(e) => Ok(AppResult::fail(
            ErrorCode::Unavailable,
            &format!("同步失败: {}", e),
            None,
        )),
    }
}
```

### 需要认证的 Command

```rust
#[tauri::command]
pub fn protected_command(
    state: tauri::State<'_, AppState>,
    input: ProtectedInput,
) -> AppResult<ProtectedOutput> {
    let session = state.session.lock().unwrap();

    if !session.is_authenticated() {
        return AppResult::fail(ErrorCode::Unauthorized, "未登录", None);
    }

    let user_id = session.user_id().unwrap();
    drop(session); // 尽早释放锁

    application::protected_service::execute(&state, &user_id, input)
        .map(AppResult::success)
        .unwrap_or_else(|e| AppResult::fail(ErrorCode::Internal, &e.to_string(), None))
}
```

## TypeScript 侧调用模式

### 基础调用函数（desktop_api.ts）

前端通过三个封装函数调用 Rust Command：

```typescript
// desktop_api.ts

import { invoke } from '@tauri-apps/api/core';

/**
 * 基础调用 - 包裹 invoke 并处理错误
 */
export async function invokeRustCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<AppResult<T>> {
  try {
    const result = await invoke<AppResult<T>>(command, args);
    return result;
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: { code: 'Internal', message: String(error) },
    };
  }
}

/**
 * 认证调用 - 自动附加 auth token
 */
export async function invokeAuthCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<AppResult<T>> {
  const token = getStoredAuthToken();
  return invokeRustCommand<T>(command, { ...args, authToken: token });
}

/**
 * 数据提取调用 - 从 AppResult 中提取 .data 字段
 */
export async function invokeRustDataFromStatus<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  const result = await invokeRustCommand<T>(command, args);
  if (result.ok && result.data) {
    return result.data;
  }
  console.error(`Command ${command} failed:`, result.error);
  return null;
}
```

### AppResult TypeScript 类型

```typescript
// types/app_result.ts

interface AppResult<T> {
  ok: boolean;
  data: T | null;
  error: AppError | null;
}

interface AppError {
  code: ErrorCode;
  message: string;
}

type ErrorCode =
  | 'InvalidArgument'
  | 'NotFound'
  | 'Unauthorized'
  | 'Forbidden'
  | 'Internal'
  | 'AlreadyExists'
  | 'Unavailable'
  | 'Timeout';
```

### 实际调用示例

```typescript
// 发送消息
async function sendMessage(conversationId: string, content: string) {
  const result = await invokeRustCommand<SendMessageOutput>('send_message', {
    input: {
      conversationId,
      content,
      messageType: 1,
    },
  });

  if (!result.ok) {
    throw new Error(result.error?.message ?? '发送失败');
  }

  return result.data;
}

// 获取会话列表（使用数据提取模式）
async function getConversations() {
  const data = await invokeRustDataFromStatus<GetConversationsOutput>(
    'get_conversations'
  );
  return data?.conversations ?? [];
}

// 需要认证的操作
async function updateProfile(displayName: string) {
  const result = await invokeAuthCommand<UserProfile>('update_profile', {
    input: { displayName },
  });

  if (!result.ok) {
    if (result.error?.code === 'Unauthorized') {
      redirectToLogin();
      return null;
    }
    throw new Error(result.error?.message ?? '更新失败');
  }

  return result.data;
}
```

## 完整开发流程

以新增"标记消息为已读"功能为例，完整步骤如下：

### 第一步：定义契约类型

```rust
// interface/contracts/chat_contracts.rs

#[derive(Deserialize)]
pub struct MarkAsReadInput {
    pub conversation_id: String,
    pub last_read_message_id: String,
}

#[derive(Serialize)]
pub struct MarkAsReadOutput {
    pub unread_count: i32,
}
```

### 第二步：定义领域验证逻辑

```rust
// domain/chat/mod.rs

pub fn validate_mark_as_read(
    conversation_id: &str,
    message_id: &str,
) -> Result<(), DomainError> {
    if conversation_id.is_empty() {
        return Err(DomainError::InvalidArgument(
            "conversation_id 不能为空".into(),
        ));
    }
    if message_id.is_empty() {
        return Err(DomainError::InvalidArgument(
            "last_read_message_id 不能为空".into(),
        ));
    }
    Ok(())
}
```

### 第三步：实现应用层服务

```rust
// application/chat/mod.rs

pub fn mark_as_read(
    messaging: &MessagingEngine,
    conversation_id: &str,
    last_read_message_id: &str,
) -> Result<MarkAsReadOutput, ServiceError> {
    domain::chat::validate_mark_as_read(conversation_id, last_read_message_id)?;

    let unread_count = messaging.submit_read_cursor(
        conversation_id,
        last_read_message_id,
    )?;

    Ok(MarkAsReadOutput { unread_count })
}
```

### 第四步：实现 Command

```rust
// interface/tauri_commands/chat_commands.rs

#[tauri::command]
pub fn mark_as_read(
    state: tauri::State<'_, AppState>,
    input: MarkAsReadInput,
) -> AppResult<MarkAsReadOutput> {
    match chat_service::mark_as_read(
        &state,
        &input.conversation_id,
        &input.last_read_message_id,
    ) {
        Ok(output) => AppResult::success(output),
        Err(e) => AppResult::fail(ErrorCode::Internal, &e.to_string(), None),
    }
}
```

### 第五步：注册 Command

```rust
// main.rs invoke_handler 中添加
commands::chat::mark_as_read,
```

### 第六步：TypeScript 侧调用

```typescript
// desktop_api.ts 或对应的 service 文件

interface MarkAsReadOutput {
  unreadCount: number;
}

export async function markAsRead(
  conversationId: string,
  lastReadMessageId: string
): Promise<MarkAsReadOutput | null> {
  return invokeRustDataFromStatus<MarkAsReadOutput>('mark_as_read', {
    input: { conversationId, lastReadMessageId },
  });
}
```

## 常见问题

### Command 参数传递

Tauri Command 的参数通过 `invoke` 的第二个参数传递，键名对应 Rust 函数的参数名：

```rust
// Rust: 参数名为 input
#[tauri::command]
pub fn my_command(input: MyInput) -> AppResult<MyOutput> { ... }
```

```typescript
// TypeScript: 传参时键名必须是 "input"
invoke('my_command', { input: { ... } });
```

### Option 类型处理

Rust 的 `Option<T>` 映射到 TypeScript 的 `T | null | undefined`：

```rust
#[derive(Deserialize)]
pub struct SearchInput {
    pub keyword: String,
    pub page: Option<i32>,      // 前端可不传或传 null
    pub page_size: Option<i32>, // 前端可不传或传 null
}
```

```typescript
// 以下三种方式均可
invoke('search', { input: { keyword: 'test' } });
invoke('search', { input: { keyword: 'test', page: 1 } });
invoke('search', { input: { keyword: 'test', page: null, pageSize: null } });
```

### 错误处理最佳实践

Command 层不应该 `unwrap()` 或 `panic!()`，所有错误都应该转换为 `AppResult::fail`：

```rust
// 错误做法
#[tauri::command]
pub fn bad_command(state: tauri::State<'_, AppState>) -> AppResult<()> {
    let data = some_operation().unwrap(); // 可能导致 panic
    AppResult::success(())
}

// 正确做法
#[tauri::command]
pub fn good_command(state: tauri::State<'_, AppState>) -> AppResult<()> {
    match some_operation() {
        Ok(data) => {
            // 处理成功结果
            AppResult::success(())
        }
        Err(e) => AppResult::fail(ErrorCode::Internal, &e.to_string(), None),
    }
}
```
