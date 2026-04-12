# Coding Standards: Universal Rules

> Historical consolidated coding standards document. Dart/Flutter-era content has been moved to
> `docs/context/legacy-standards/dart-flutter-coding-standards.md`.
> Current source of truth: `docs/global/coding-guide/` for platform-specific standards.

---

## 🎯 Universal Principles

### 1. **Clarity Over Cleverness**
Simple, readable code beats clever code every time.

### 2. **Consistency Over Convenience**
Follow established patterns even if more verbose.

### 3. **Explicit Over Implicit**
Make dependencies and intentions clear.

---

## 🏗️ Go Standards (Station)

### File Naming
- snake_case: `user_service.go`

### Package Naming
- lowercase, single word: `package auth`

### Variable Naming
- camelCase for private: `userName`
- PascalCase for public: `UserName`

### Error Handling
```go
// ✅ CORRECT: Always check errors
result, err := doSomething()
if err != nil {
    return nil, fmt.Errorf("failed to do something: %w", err)
}

// ❌ WRONG: Ignoring errors
result, _ := doSomething()
```

### Proto Usage
```go
// ✅ CORRECT: Use Proto structs
import "github.com/peers-labs/peers-touch/station/app/model"

actor := &model.Actor{
    Id: "123",
}

// ❌ WRONG: Manual structs
type Actor struct {
    ID string
}
```

---

## 🚫 Universal Anti-Patterns

### ❌ Hardcoded Strings

```tsx
// WRONG
<span>Login</span>

// CORRECT
<span>{t('login')}</span>
```

### ❌ Magic Numbers

```tsx
// WRONG
if (status === 200) { }

// CORRECT
if (status === HttpStatusCode.Ok) { }
```

### ❌ God Classes

```tsx
// WRONG: One module doing everything
class AppService {
  login() {}
  fetchPosts() {}
  sendMessage() {}
  // ... 50 more methods
}

// CORRECT: Separate modules per feature
class AuthService { login() {} }
class PostService { fetchPosts() {} }
class MessageService { sendMessage() {} }
```

---

## 📐 Architecture Rules

### Station (Go)

1. **Use Proto Structs** - No manual models
2. **Check All Errors** - Never ignore errors
3. **Context Everywhere** - Pass context.Context
4. **Structured Logging** - Use logging framework
5. **No Global State** - Dependency injection

---

## 🎨 Code Comments

### When to Comment

```tsx
// ✅ GOOD: Explain WHY, not WHAT
// We use a delay here to prevent rate limiting from the API
await new Promise((resolve) => setTimeout(resolve, 1000));

// ❌ BAD: Stating the obvious
// Increment counter by 1
counter++;
```

### Documentation Comments

```tsx
/**
 * Fetches user profile from the server.
 *
 * @throws {NetworkError} If the request fails.
 * @returns The Actor profile on success.
 */
async function fetchProfile(userId: string): Promise<Actor> {
  // ...
}
```

---

## 📊 Code Organization

### File Length
- **Target**: < 300 lines per file
- **Maximum**: 500 lines (refactor if exceeded)

### Method Length
- **Target**: < 20 lines per method
- **Maximum**: 50 lines (refactor if exceeded)

### Class Responsibilities
- **One class, one responsibility**
- If class name contains "And", it's doing too much

---

## 🧪 Testing Standards

### Test File Naming
```
useAuthStore.ts → useAuthStore.test.ts
UserCard.tsx   → UserCard.test.tsx
```

### Test Structure
```tsx
import { describe, it, expect, beforeEach } from 'vitest';

describe('useAuthStore', () => {
  beforeEach(() => {
    // Reset state before each test
  });

  it('should authenticate user with valid credentials', () => {
    // Arrange
    // Act
    // Assert
  });
});
```

---

## 📚 Related Documents

- **Project Identity**: [project-identity.md](./project-identity.md)
- **Domain Models**: [domain-model.md](./domain-model.md)
- **Desktop Standards**: [desktop/base.md](../client/desktop/base.md)

---

## 💻 TypeScript / React Standards (Desktop)

### 组件规范

- **仅使用函数组件**，禁止使用 class 组件
- 启用 TypeScript **strict 模式**，禁止使用 `any`（必须用具体类型或 `unknown`）

```tsx
// ✅ CORRECT: 函数组件 + 严格类型
const UserCard: React.FC<{ name: string; age: number }> = ({ name, age }) => {
  return <div>{name} - {age}</div>;
};

// ❌ WRONG: class 组件
class UserCard extends React.Component { }

// ❌ WRONG: 使用 any
const data: any = fetchData();
```

### 变量声明

- 优先使用 `const`，必要时使用 `let`，**永远不用 `var`**

```tsx
// ✅ CORRECT
const maxRetry = 3;
let currentAttempt = 0;

// ❌ WRONG
var maxRetry = 3;
```

### 导出规范

- 使用**命名导出（named exports）**，避免默认导出（页面/App 入口除外）

```tsx
// ✅ CORRECT
export const UserCard: React.FC = () => { ... };
export function useUserStore() { ... }

// ❌ WRONG（非页面/App 场景）
export default function UserCard() { ... }
```

### UI 组件选择

- **优先使用 LobeUI 组件库**，LobeUI 无法满足时再使用 antd 作为兜底

### 状态管理

- 使用 **Zustand** 进行状态管理，命名约定：`use<Feature>Store`

```tsx
// ✅ CORRECT
import { create } from 'zustand';

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
}));
```

### 日志规范

- 使用 `utils/logger.ts` 中导出的 `log`，**禁止直接使用 `console.log`**

```tsx
// ✅ CORRECT
import { log } from '@/utils/logger';
log.info('User logged in');

// ❌ WRONG
console.log('User logged in');
```

### 文件命名

| 类型 | 约定 | 示例 |
|------|------|------|
| 普通文件/工具 | camelCase | `useAuthStore.ts`, `logger.ts` |
| React 组件 | PascalCase | `UserCard.tsx`, `ChatPanel.tsx` |

### Import 顺序

```tsx
// 1. React 核心
import React, { useState } from 'react';

// 2. 第三方库
import { Button } from '@lobehub/ui';
import { create } from 'zustand';

// 3. Kernel / 内核层
import { invoke } from '@/kernel/bridge';

// 4. Modules / 业务模块
import { useChatStore } from '@/modules/chat/store';

// 5. Local / 本地文件
import { formatTime } from './utils';
import styles from './index.module.css';
```

---

## 🦀 Rust Standards (Desktop Tauri)

### 架构分层

遵循 **DDD 分层架构**：`domain` → `application` → `infrastructure` → `interface`

```
src-tauri/src/
├── domain/          # 领域层：实体、值对象、领域服务
├── application/     # 应用层：用例、命令处理
├── infrastructure/  # 基础设施层：数据库、网络、文件系统
└── interface/       # 接口层：Tauri commands、事件
```

### 错误处理

- 所有 Tauri command **必须返回 `AppResult<T>`**，**永远不准 panic**
- 使用 `thiserror` 定义自定义错误类型

```rust
// ✅ CORRECT: 返回 AppResult，使用 thiserror
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("not found: {0}")]
    NotFound(String),
}

#[tauri::command]
async fn get_user(id: String) -> AppResult<User> {
    let user = db.find_user(&id).await?;
    Ok(user)
}

// ❌ WRONG: panic 或返回裸 Result
#[tauri::command]
fn get_user(id: String) -> User {
    db.find_user(&id).unwrap() // panic!
}
```

### 状态管理

- 通过 `Mutex<T>` 包裹 `AppState`，使用 `tauri::State` 访问

```rust
// ✅ CORRECT
#[tauri::command]
async fn update_setting(
    state: tauri::State<'_, Mutex<AppState>>,
    key: String,
    value: String,
) -> AppResult<()> {
    let mut s = state.lock().await;
    s.settings.insert(key, value);
    Ok(())
}
```

### Proto 类型

- 通过 prost 的 `include!()` 宏引入 Proto 生成的类型

```rust
// ✅ CORRECT
pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/peers.touch.rs"));
}
```

### 日志规范

- 使用 `tracing` 进行日志记录，**禁止 `println!`**

```rust
// ✅ CORRECT
use tracing::{info, warn, error};
info!(user_id = %id, "user logged in");
error!(?err, "failed to connect");

// ❌ WRONG
println!("user logged in: {}", id);
```

---

## 📱 Kotlin Standards (Android)

### UI 规范

- **全部使用 Jetpack Compose** 构建 UI，禁止使用 XML 布局

```kotlin
// ✅ CORRECT: Compose UI
@Composable
fun UserCard(user: User) {
    Card {
        Text(text = user.name)
    }
}

// ❌ WRONG: XML layout + findViewById
```

### 依赖注入

- 使用 Hilt 进行依赖注入：`@HiltAndroidApp` + `@AndroidEntryPoint` + `@HiltViewModel`

```kotlin
// ✅ CORRECT
@HiltAndroidApp
class PeersTouchApp : Application()

@AndroidEntryPoint
class MainActivity : ComponentActivity()

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
) : ViewModel()
```

### Feature 模块结构

每个 Feature 模块遵循以下目录结构：

```
feature/chat/
├── ui/              # Composable 界面
├── viewmodel/       # ViewModel
├── repository/      # 数据仓库
└── model/           # 数据模型
```

### 异步规范

- 使用 **Coroutines + Flow** 处理异步操作，**禁止 RxJava**

```kotlin
// ✅ CORRECT: Coroutines + Flow
class ChatRepository @Inject constructor(private val api: ChatApi) {
    fun getMessages(): Flow<List<Message>> = flow {
        emit(api.fetchMessages())
    }
}

// ❌ WRONG: RxJava
fun getMessages(): Observable<List<Message>> { }
```

### 主题规范

- 使用 **Material 3** 主题，通过 `PeersTouchTheme` 统一管理

```kotlin
// ✅ CORRECT
@Composable
fun App() {
    PeersTouchTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            MainScreen()
        }
    }
}
```

### 数据存储

- **偏好设置** → DataStore
- **结构化数据** → Room

```kotlin
// ✅ CORRECT: DataStore for preferences
val themeMode = context.dataStore.data.map { prefs ->
    prefs[THEME_MODE_KEY] ?: "system"
}

// ✅ CORRECT: Room for structured data
@Entity
data class MessageEntity(
    @PrimaryKey val id: String,
    val content: String,
    val timestamp: Long,
)
```

---

## 🍎 Swift Standards (iOS)

### UI 规范

- **全部使用 SwiftUI** 构建视图，禁止 UIKit（Lynx bridge 除外）

```swift
// ✅ CORRECT: SwiftUI
struct UserCard: View {
    let user: User

    var body: some View {
        VStack {
            Text(user.name)
            Text(user.bio)
        }
    }
}

// ❌ WRONG: UIKit（非 Lynx bridge 场景）
class UserCardViewController: UIViewController { }
```

### 状态管理

- 使用 **`@Observable`**（iOS 17+）进行状态管理

```swift
// ✅ CORRECT: @Observable (iOS 17+)
@Observable
class ChatStore {
    var messages: [Message] = []
    var isLoading = false

    func fetchMessages() async {
        isLoading = true
        messages = await api.getMessages()
        isLoading = false
    }
}
```

### 依赖注入

- 使用 **`Container.shared`** 手动 DI 模式

```swift
// ✅ CORRECT
class Container {
    static let shared = Container()

    lazy var chatStore = ChatStore(api: apiClient)
    lazy var apiClient = APIClient()
}

// 使用
let store = Container.shared.chatStore
```

### 异步规范

- 使用 **async/await** 处理并发，禁止回调地狱

```swift
// ✅ CORRECT: async/await
func fetchUser(id: String) async throws -> User {
    let data = try await api.request(.getUser(id))
    return try decoder.decode(User.self, from: data)
}

// ❌ WRONG: 嵌套回调
func fetchUser(id: String, completion: @escaping (Result<User, Error>) -> Void) { }
```

### 颜色与字体

- 颜色通过 **Asset Catalog** 管理，使用 `ColorTokens` 访问
- 字体使用系统字体，通过 `Typography` 统一管理

```swift
// ✅ CORRECT
Text("Hello")
    .foregroundColor(ColorTokens.primaryText)
    .font(Typography.headline)

// ❌ WRONG: 硬编码颜色
Text("Hello")
    .foregroundColor(Color(red: 0.2, green: 0.3, blue: 0.8))
```

### 路由规范

- 使用 **`NavigationPath`** + `Router` 实现路由导航

```swift
// ✅ CORRECT: NavigationPath-based routing
@Observable
class Router {
    var path = NavigationPath()

    func push(_ destination: Destination) {
        path.append(destination)
    }

    func pop() {
        path.removeLast()
    }
}
```

---

## 📐 Architecture Rules (Extended)

### Desktop (TypeScript / Tauri)

1. **No Class Components** - 仅使用函数组件
2. **No `any` Type** - 启用 strict 模式
3. **No `console.log`** - 使用 logger 工具
4. **No Raw Panic** - Tauri command 必须返回 `AppResult<T>`
5. **LobeUI First** - 优先使用 LobeUI 组件

### Android (Kotlin)

1. **No XML Layouts** - 仅使用 Jetpack Compose
2. **No RxJava** - 使用 Coroutines + Flow
3. **Hilt DI** - 统一依赖注入
4. **Material 3** - 统一主题系统
5. **No Manual Threading** - 使用 Coroutines

### iOS (Swift)

1. **No UIKit** - 仅使用 SwiftUI（Lynx bridge 除外）
2. **No Callbacks** - 使用 async/await
3. **@Observable** - iOS 17+ 状态管理
4. **Asset Catalog Colors** - 禁止硬编码颜色
5. **NavigationPath Routing** - 统一路由方案

---

*These standards ensure code consistency across the entire Peers-Touch codebase.*
