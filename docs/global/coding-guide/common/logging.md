# Peers-Touch 跨域日志规范

> 本文档基于各端实际代码实现编写，旨在统一 Station、Desktop、Mobile 三个域的日志使用标准。
> 
> 最后更新：2026-04-08

---

## 目录

- [通用规则](#通用规则)
- [Station (Go)](#station-go)
- [Desktop TypeScript (React)](#desktop-typescript-react)
- [Desktop Rust (Tauri)](#desktop-rust-tauri)
- [Mobile Flutter (Dart)](#mobile-flutter-dart)
- [Mobile Android 原生 (Kotlin)](#mobile-android-原生-kotlin)
- [Mobile iOS 原生 (Swift)](#mobile-ios-原生-swift)
- [日志级别语义对照表](#日志级别语义对照表)
- [反模式](#反模式)

---

## 通用规则

1. **绝对禁止**在日志中输出 token、password、secret key 等敏感信息
2. **必须**携带上下文标识（tag / request_id / trace_id），确保可追踪
3. Error 级别日志**必须**包含错误详情和触发上下文
4. 使用格式化函数（`Infof` / template literal），**禁止**字符串拼接
5. 日志级别的语义在所有平台**必须**保持一致（见文末对照表）

---

## Station (Go)

### 使用包

```
github.com/peers-labs/peers-touch/station/frame/core/logger
```

源码位置：`apps/station/frame/core/logger/`

### 禁止使用

| 禁止项 | 原因 |
|--------|------|
| `log` 标准库 | 无级别、无上下文 |
| `fmt.Println` / `fmt.Printf` | 不经过日志系统，无法持久化 |
| `frame/core/util/log` | 已废弃的旧日志包，无 context 支持 |
| 任何第三方日志库直接调用 | 破坏统一抽象层 |

### 基本用法

所有日志函数的**第一个参数**必须是 `context.Context`：

```go
import (
    "context"
    "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

func HandleRequest(ctx context.Context, userID string) {
    logger.Info(ctx, "request received")
    logger.Infof(ctx, "processing user: %s", userID)

    if err := doSomething(); err != nil {
        logger.Errorf(ctx, "failed to process user %s: %v", userID, err)
        return
    }

    logger.Debug(ctx, "operation completed successfully")
}
```

### 可用级别

```go
logger.Trace(ctx, args...)    // 极细粒度，函数进出、变量值
logger.Tracef(ctx, tpl, args...)

logger.Debug(ctx, args...)    // 开发调试，中间步骤
logger.Debugf(ctx, tpl, args...)

logger.Info(ctx, args...)     // 常规运行，状态变更
logger.Infof(ctx, tpl, args...)

logger.Warn(ctx, args...)     // 非致命告警
logger.Warnf(ctx, tpl, args...)

logger.Error(ctx, args...)    // 可恢复错误
logger.Errorf(ctx, tpl, args...)

logger.Fatal(ctx, args...)    // 致命错误，调用后 os.Exit(1)
logger.Fatalf(ctx, tpl, args...)
```

### Request ID / Trace ID

通过 context 注入，后续同一 context 链路中的所有日志自动携带：

```go
// 注入
ctx = logger.WithRequestID(ctx, "req-a1b2c3")
ctx = logger.WithTraceID(ctx, "trace-x9y8z7")

// 读取（通常不需要手动读取，日志系统自动提取）
reqID := logger.GetRequestID(ctx)
traceID := logger.GetTraceID(ctx)

// 后续日志自动带上 request_id 和 trace_id
logger.Info(ctx, "handling request")
// 输出示例：
// time="2025-01-05 10:30:45" level=info msg="handling request" request_id=req-a1b2c3 trace_id=trace-x9y8z7
```

### Helper 模式

当需要在同一作用域内复用字段时：

```go
h := logger.NewHelper(logger.DefaultLogger)
h = h.WithFields(map[string]interface{}{
    "user_id": userID,
    "action":  "login",
})
h.Info("user action started")
h.Infof("step %d completed", stepNum)
```

从 context 中提取 logger：

```go
h := logger.Extract(ctx)
h.Info("message with context logger")

h = h.WithError(err)
h.Error("operation failed")
```

### PackageLevels（按包控制日志级别）

```go
logger.Init(ctx,
    logger.WithLevel(logger.InfoLevel),
    logger.WithPackageLevel("activitypub", logger.DebugLevel),
    logger.WithPackageLevel("webfinger", logger.WarnLevel),
)
```

上例中，`activitypub` 相关包输出 Debug 及以上，`webfinger` 相关包只输出 Warn 及以上，其余包输出 Info 及以上。

### 日志持久化配置

配置文件 `app/conf/log.yml`：

```yaml
peers:
  logger:
    name: slogrus
    level: debug
    caller-skip-count: 2
    persistence:
      enable: true
      dir: /var/logs/peers-touch
      max-file-size: 50        # MB
      max-backup-size: 200     # MB
      max-backup-keep-days: 30
```

---

## Desktop TypeScript (React)

### 使用模块

```
src/utils/logger.ts → 导出 log 对象
```

### 禁止使用

| 禁止项 | 原因 |
|--------|------|
| `console.log` | 不会转发到 Rust 后端，无法持久化 |
| `console.error` | 同上 |
| `console.warn` | 同上 |
| `console.debug` | 同上 |

### 实现原理

`log` 对象的每次调用同时做两件事：

1. 调用 `console[level]` 输出到浏览器 DevTools
2. 通过 `invoke('frontend_log', ...)` 将日志发送到 Tauri Rust 后端持久化

```typescript
// 源码实现（logger.ts）
import { invoke } from '@tauri-apps/api/core';

function send(level: LogLevel, tag: string, message: string, data?: unknown) {
  console[level](`[${tag}]`, message, ...(data !== undefined ? [data] : []));
  invoke('frontend_log', {
    input: { level, tag, message, data: data !== undefined ? JSON.stringify(data) : undefined },
  }).catch(() => {});
}

export const log = {
  debug: (tag: string, msg: string, data?: unknown) => send('debug', tag, msg, data),
  info:  (tag: string, msg: string, data?: unknown) => send('info',  tag, msg, data),
  warn:  (tag: string, msg: string, data?: unknown) => send('warn',  tag, msg, data),
  error: (tag: string, msg: string, data?: unknown) => send('error', tag, msg, data),
};
```

### 基本用法

```typescript
import { log } from '../utils/logger';

// tag 标识模块来源，便于过滤和追踪
log.info('chat', 'conversation created', { sessionId: 'sess-123' });
log.debug('store', 'state updated', { key: 'messages', count: 42 });
log.warn('network', 'retry attempt', { attempt: 3, maxRetries: 5 });
log.error('auth', 'token refresh failed', { status: 401 });
```

### 全局错误捕获示例

项目中已实现全局错误监听（`src/kernel/events/global-error.ts`）：

```typescript
import { log } from '../../utils/logger';

window.addEventListener('error', (e) => {
  log.error('app', 'Uncaught error', {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
  });
});

window.addEventListener('unhandledrejection', (e) => {
  log.error('app', 'Unhandled rejection', { reason: String(e.reason) });
});
```

### tag 命名建议

| tag | 使用场景 |
|-----|---------|
| `app` | 应用全局事件（启动、崩溃、生命周期） |
| `chat` | 会话、消息相关 |
| `store` | 状态管理 |
| `auth` | 认证鉴权 |
| `network` | 网络请求 |
| `applet` | Applet 运行时 |

---

## Desktop Rust (Tauri)

### 使用模块

```
src-tauri/src/infrastructure/logger/mod.rs
```

底层基于 `tracing` + `tracing-subscriber` + `tracing-appender`。

### 初始化

在 `bootstrap.rs` 中调用：

```rust
use crate::infrastructure::logger;

fn init_logger(layout: &StorageLayout) -> WorkerGuard {
    let logs_dir = layout.dirs.get(&StorageKind::Logs)
        .expect("[bootstrap] Logs directory not found");
    logger::initialize(logs_dir)
        .expect("[bootstrap] Failed to initialize logger")
}
```

初始化后同时输出到：
- **stdout**：带 ANSI 颜色，用于开发调试
- **日志文件**：JSON 格式，按日滚动（`app.log`）

### 日志级别控制

通过 `RUST_LOG` 环境变量，默认 `info`：

```bash
RUST_LOG=debug cargo tauri dev
RUST_LOG=peers_touch_desktop=debug,hyper=warn cargo tauri dev
```

### 在 Rust 代码中写日志

```rust
tracing::info!("service started");
tracing::debug!(user_id = %id, "loading user profile");
tracing::warn!(attempt = retries, "connection retry");
tracing::error!(err = %e, "database query failed");
```

### 接收前端日志

Rust 端通过 `frontend_log` command 接收 TS 前端日志并统一到 tracing 输出：

```rust
// src/interface/tauri_commands/frontend_log.rs
#[tauri::command]
pub fn frontend_log(input: FrontendLogInput) {
    let data_str = input.data.as_deref().unwrap_or("");
    match input.level.as_str() {
        "error" => tracing::error!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
        "warn"  => tracing::warn!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
        "debug" => tracing::debug!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
        _       => tracing::info!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
    }
}
```

这意味着前端日志最终也会写入 `app.log` 文件中，格式统一且可搜索。

---

## Mobile Flutter (Dart)

### 使用模块

项目中存在两个 logger：

| 路径 | 说明 | 推荐 |
|------|------|------|
| `lib/common/logger/logger.dart` | 基于 `logger` 包，带格式化输出 | 推荐使用 |
| `lib/utils/logger.dart` | 简单 print 封装 | 仅作后备 |

### 推荐用法（common/logger）

```dart
import 'package:peers_touch_mobile/common/logger/logger.dart';

// 全局实例
appLogger.info('Application started');
appLogger.debug('State updated: count=$count');
appLogger.warning('Cache miss for key: $key');
appLogger.error('Failed to load data', error, stackTrace);
```

### 带错误信息的日志

```dart
try {
  await fetchData();
} catch (e, stackTrace) {
  appLogger.error('Network request failed', e, stackTrace);
}
```

### 禁止使用

| 禁止项 | 原因 |
|--------|------|
| `print()` | 无级别、无格式化，生产环境不可控 |
| `debugPrint()` | 仅调试用，无法统一管控 |
| 直接 `Logger()` 新实例 | 应复用全局 `appLogger`，避免配置不一致 |

---

## Mobile Android 原生 (Kotlin)

> 当前 Android 原生层（Lynx Bridge 等）暂无统一日志封装。

### 推荐方案：Timber

```kotlin
// Application.onCreate() 中初始化
if (BuildConfig.DEBUG) {
    Timber.plant(Timber.DebugTree())
} else {
    Timber.plant(CrashReportingTree())
}
```

使用方式：

```kotlin
Timber.d("bridge: module %s initialized", moduleName)
Timber.i("applet: session created for %s", appletId)
Timber.w("network: retry attempt %d/%d", current, max)
Timber.e(exception, "bridge: method %s.%s failed", module, method)
```

在当前 Bridge 模块中的改造示例：

```kotlin
// 当前（无日志）
class UIBridgeModule(private val context: Context) : BridgeModule {
    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "showToast" -> showToast(...)
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }
}

// 改造后
class UIBridgeModule(private val context: Context) : BridgeModule {
    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        Timber.d("bridge: %s.%s called", moduleName, method)
        return when (method) {
            "showToast" -> showToast(...)
            else -> {
                Timber.w("bridge: unknown method %s.%s", moduleName, method)
                throw IllegalArgumentException("Unknown method: $moduleName.$method")
            }
        }
    }
}
```

---

## Mobile iOS 原生 (Swift)

> 当前 iOS 原生层暂无统一日志封装。

### 推荐方案：os.Logger (iOS 14+)

```swift
import os

extension Logger {
    static let network = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "network")
    static let bridge = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "bridge")
    static let applet = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "applet")
    static let auth = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "auth")
}
```

使用方式：

```swift
Logger.network.info("Request started: \(url, privacy: .public)")
Logger.network.debug("Response headers: \(headers, privacy: .private)")
Logger.bridge.error("Method call failed: \(error.localizedDescription, privacy: .public)")
Logger.auth.warning("Token expires in \(remainingSeconds)s")
```

注意 `privacy` 参数——默认 `.auto` 会在 Release 构建中隐藏动态值。需要在生产日志中可见的值使用 `.public`，敏感值使用 `.private`。

---

## 日志级别语义对照表

| 语义 | Station (Go) | Desktop TS | Desktop Rust | Flutter | Android (Timber) | iOS (os.Logger) |
|------|-------------|------------|-------------|---------|------------------|-----------------|
| 极细粒度调试 | `Trace` | - | `trace!` | - | `Timber.v` | `Logger.trace` |
| 开发调试 | `Debug` | `log.debug` | `debug!` | `appLogger.debug` | `Timber.d` | `Logger.debug` |
| 常规运行 | `Info` | `log.info` | `info!` | `appLogger.info` | `Timber.i` | `Logger.info` |
| 非致命告警 | `Warn` | `log.warn` | `warn!` | `appLogger.warning` | `Timber.w` | `Logger.warning` |
| 可恢复错误 | `Error` | `log.error` | `error!` | `appLogger.error` | `Timber.e` | `Logger.error` |
| 致命/退出 | `Fatal` | - | - | - | `Timber.wtf` | `Logger.fault` |

---

## 反模式

### 1. 日志中泄露敏感信息

```go
// Go - 错误
logger.Infof(ctx, "auth token: %s", token)

// Go - 正确
logger.Infof(ctx, "user %s authenticated successfully", userID)
```

```typescript
// TS - 错误
log.info('auth', 'Login response', { token: resp.accessToken });

// TS - 正确
log.info('auth', 'Login succeeded', { userId: resp.userId });
```

### 2. 字符串拼接代替格式化

```go
// Go - 错误
logger.Info(ctx, "user " + userID + " from " + ip)

// Go - 正确
logger.Infof(ctx, "user %s from %s", userID, ip)
```

### 3. Error 日志缺失错误详情

```go
// Go - 错误
logger.Error(ctx, "something failed")

// Go - 正确
logger.Errorf(ctx, "failed to save user %s to database: %v", userID, err)
```

```typescript
// TS - 错误
log.error('chat', 'Send failed');

// TS - 正确
log.error('chat', 'Message send failed', { sessionId, error: String(err), messageId });
```

### 4. 日志级别误用

```go
// 错误：用 Info 打调试细节
logger.Infof(ctx, "variable x = %d, y = %d, z = %d", x, y, z)

// 正确：用 Debug
logger.Debugf(ctx, "variable x = %d, y = %d, z = %d", x, y, z)

// 错误：用 Error 打预期的业务分支
logger.Error(ctx, "user not found")

// 正确：用 Debug 或 Info
logger.Debug(ctx, "user not found, returning 404")
```

### 5. 绕过日志系统

```go
// Go - 错误
fmt.Println("server started")
log.Println("request received")

// Go - 正确
logger.Info(ctx, "server started")
```

```typescript
// TS - 错误
console.log('loaded', data);

// TS - 正确
log.info('app', 'Data loaded', data);
```

```dart
// Flutter - 错误
print('page loaded');

// Flutter - 正确
appLogger.info('Page loaded');
```
