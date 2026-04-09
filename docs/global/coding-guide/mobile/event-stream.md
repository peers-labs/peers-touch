# Mobile 事件流 (Event Stream) 开发指南

> 本文档基于 Android `EventStreamClient.kt`、iOS `EventStreamClient.swift`、`EventRouter` 以及 Station 端 `events` subserver 的实际代码编写。

---

## 1. 架构总览

```
Station (/events/stream)          Mobile Client
┌──────────────────────┐     SSE (text/event-stream)     ┌──────────────────────────┐
│  EventSystem         │ ──────────────────────────────>  │  EventStreamClient       │
│  ├── ConnectionHub   │     Bearer Token 鉴权            │  ├── 接收 SSE 原始事件    │
│  ├── Outbox (DB)     │     30s 心跳保活                 │  ├── 解析为 ServerEvent   │
│  └── Broker (内存)   │     Last-Event-ID 断点续传       │  └── 发射到事件流         │
└──────────────────────┘                                  │                          │
                                                          │  EventRouter             │
                                                          │  ├── 按 type 分发        │
                                                          │  └── handler 并发执行     │
                                                          └──────────────────────────┘
```

移动端通过 **SSE (Server-Sent Events)** 与 Station 建立长连接，接收实时事件推送。整体流程：

1. `EventStreamClient` 建立 SSE 连接，接收原始 SSE 帧
2. 解析为 `ServerEvent` / `StationEvent` 结构体
3. `EventRouter` 按 `type` 字段将事件分发到对应的 handler

---

## 2. 协议定义 (events.proto)

Station 使用 protobuf 定义事件模型，SSE 推送时以 JSON 序列化：

```protobuf
// model/domain/events/events.proto
syntax = "proto3";
package peers_touch.model.events.v1;

import "google/protobuf/timestamp.proto";

message Event {
  string id = 1;                           // 事件唯一 ID
  string type = 2;                         // 事件类型，如 "chat.message.appended"
  bytes payload = 3;                       // 业务载荷 (protobuf 编码)
  google.protobuf.Timestamp created_at = 4; // 事件创建时间
}

// 拉取补漏
message PullEventsRequest {
  int32 limit = 1;
  int64 since_ts = 2;  // Unix timestamp
}

message PullEventsResponse {
  repeated Event events = 1;
}

// 事件确认
message AckEventsRequest {
  repeated string event_ids = 1;
}

message AckEventsResponse {
  int32 acked_count = 1;
}
```

SSE 帧格式 (Station 发送)：

```
id: evt_abc123
event: chat.message.appended
data: {"id":"evt_abc123","type":"chat.message.appended","payload":"...","created_at":"..."}

```

已知的事件类型包括：

| 域 | 事件类型 | 说明 |
|---|---|---|
| 关注 | `follow.requested`, `follow.accepted`, `follow.rejected`, `follow.undone` | 关注关系变更 |
| 聊天 | `chat.message.appended`, `chat.message.delivered`, `chat.message.read` | 聊天消息与回执 |
| 评论 | `comment.created`, `comment.deleted`, `comment.updated` | 评论 CRUD |
| 互动 | `like.added`, `announce.shared`, `undo.like` | 互动操作 |
| 系统 | `system.alert`, `node.status.changed` | 系统级通知 |

---

## 3. Station 端：SSE 端点

Station 的 `eventsSubServer` 提供 `/events/stream` 端点：

```go
// 注册端点
server.NewHertzHandler(
    "events-stream",
    "/events/stream",
    server.GET,
    s.handleSSEStreamHertz,
    hertzJWTWrapper, // JWT 鉴权中间件
)
```

关键行为：

| 特性 | 实现 |
|---|---|
| 鉴权 | Bearer JWT Token，从 Authorization 头提取 |
| 响应头 | `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` |
| 心跳 | 每 30 秒发送 `: heartbeat\n\n` 注释帧 |
| 事件缓冲 | 每连接 256 容量的 channel |
| 断点续传 | 支持 `Last-Event-ID` 请求头，自动补发遗漏事件 |
| 初始消息 | 连接建立后立即发送 `: connected\n\n` |

---

## 4. Android 实现

### 4.1 数据模型

```kotlin
// core/event/EventStreamClient.kt
data class ServerEvent(
    val type: String,    // 事件类型
    val data: String,    // JSON 载荷
    val id: String? = null // 事件 ID (来自 SSE id 字段)
)
```

### 4.2 EventStreamClient

基于 OkHttp 的 `EventSources` 工厂实现 SSE 连接：

```kotlin
class EventStreamClient(
    private val okHttpClient: OkHttpClient
) {
    // 协程作用域：SupervisorJob 保证单个子任务失败不影响整体
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // SharedFlow：多订阅者共享事件流，缓冲 64 个事件
    private val _events = MutableSharedFlow<ServerEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<ServerEvent> = _events.asSharedFlow()

    private var eventSource: EventSource? = null
    private var reconnectJob: Job? = null
    private var baseUrl: String = ""
    private var token: String = ""

    fun connect(baseUrl: String, token: String) {
        this.baseUrl = baseUrl
        this.token = token
        startConnection()
    }

    fun disconnect() {
        reconnectJob?.cancel()
        reconnectJob = null
        eventSource?.cancel()
        eventSource = null
    }

    private fun startConnection() {
        eventSource?.cancel()

        val request = Request.Builder()
            .url("$baseUrl/events/stream")
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Accept", "text/event-stream")
            .build()

        val factory = EventSources.createFactory(okHttpClient)
        eventSource = factory.newEventSource(request, object : EventSourceListener() {
            override fun onEvent(
                eventSource: EventSource,
                id: String?,
                type: String?,
                data: String
            ) {
                scope.launch {
                    _events.emit(
                        ServerEvent(type = type ?: "message", data = data, id = id)
                    )
                }
            }

            override fun onFailure(
                eventSource: EventSource,
                t: Throwable?,
                response: Response?
            ) {
                scheduleReconnect()
            }

            override fun onClosed(eventSource: EventSource) {
                scheduleReconnect()
            }
        })
    }

    // 断线重连：5 秒延迟后重试
    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(5000)
            startConnection()
        }
    }
}
```

核心设计要点：

- **SharedFlow** (`extraBufferCapacity = 64`)：支持多个订阅者同时收集事件，缓冲区防止慢消费者丢事件
- **SupervisorJob**：隔离子协程故障，`onEvent` 中单次 emit 失败不影响后续事件
- **自动重连**：`onFailure` 和 `onClosed` 均触发 5 秒延迟重连

### 4.3 Hilt 依赖注入

```kotlin
// di/AppModule.kt
@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun provideEventStreamClient(okHttpClient: OkHttpClient): EventStreamClient {
        return EventStreamClient(okHttpClient)
    }
}
```

`OkHttpClient` 由 `NetworkModule` 提供，已配置 `AuthInterceptor`：

```kotlin
// di/NetworkModule.kt
@Provides
@Singleton
fun provideOkHttpClient(authInterceptor: AuthInterceptor): OkHttpClient {
    return OkHttpClient.Builder()
        .addInterceptor(authInterceptor)
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
}
```

### 4.4 EventRouter (Android)

```kotlin
typealias EventHandler = suspend (data: String) -> Unit

@Singleton
class EventRouter @Inject constructor(
    private val eventStreamClient: EventStreamClient
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val handlers = mutableMapOf<String, MutableList<EventHandler>>()

    // 注册特定事件类型的处理器
    fun register(eventType: String, handler: EventHandler) {
        handlers.getOrPut(eventType) { mutableListOf() }.add(handler)
    }

    // 移除处理器
    fun unregister(eventType: String, handler: EventHandler) {
        handlers[eventType]?.remove(handler)
    }

    // 开始监听事件流并分发
    fun startListening() {
        scope.launch {
            eventStreamClient.events.collect { event ->
                val typeHandlers = handlers[event.type]
                typeHandlers?.forEach { handler ->
                    launch { // 每个 handler 在独立协程中执行
                        handler(event.data)
                    }
                }
            }
        }
    }
}
```

使用示例：

```kotlin
// 在 Feature 模块中注册 handler
@Inject lateinit var eventRouter: EventRouter

fun initEventHandlers() {
    eventRouter.register("chat.message.appended") { data ->
        val message = gson.fromJson(data, ChatMessageEvent::class.java)
        chatRepository.insertMessage(message)
    }

    eventRouter.register("follow.accepted") { data ->
        val event = gson.fromJson(data, FollowEvent::class.java)
        followRepository.updateRelation(event)
    }
}
```

---

## 5. iOS 实现

### 5.1 数据模型

```swift
// Core/Event/EventStreamClient.swift
struct StationEvent: Sendable {
    let type: String
    let data: String
    let id: String?
}
```

### 5.2 EventStreamClient

基于 `URLSession.bytes` 的 `AsyncStream` 模式：

```swift
final class EventStreamClient: @unchecked Sendable {
    private let session: URLSession
    private var currentTask: Task<Void, Never>?
    private var baseURL: URL?
    private var token: String?

    init() {
        let configuration = URLSessionConfiguration.default
        // SSE 长连接必须设置无限超时
        configuration.timeoutIntervalForRequest = .infinity
        configuration.timeoutIntervalForResource = .infinity
        self.session = URLSession(configuration: configuration)
    }

    func connect(baseURL: URL, token: String) -> AsyncStream<StationEvent> {
        self.baseURL = baseURL
        self.token = token

        let url = baseURL.appendingPathComponent("events/stream")

        return AsyncStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: url)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

                    let (bytes, _) = try await session.bytes(for: request)

                    // 手动解析 SSE 帧
                    var eventType: String?
                    var eventId: String?
                    var dataBuffer = ""

                    for try await line in bytes.lines {
                        if line.hasPrefix("event:") {
                            eventType = String(line.dropFirst(6))
                                .trimmingCharacters(in: .whitespaces)
                        } else if line.hasPrefix("data:") {
                            let data = String(line.dropFirst(5))
                                .trimmingCharacters(in: .whitespaces)
                            if !dataBuffer.isEmpty { dataBuffer.append("\n") }
                            dataBuffer.append(data)
                        } else if line.hasPrefix("id:") {
                            eventId = String(line.dropFirst(3))
                                .trimmingCharacters(in: .whitespaces)
                        } else if line.isEmpty, !dataBuffer.isEmpty {
                            // 空行表示一个事件帧结束
                            let event = StationEvent(
                                type: eventType ?? "message",
                                data: dataBuffer,
                                id: eventId
                            )
                            continuation.yield(event)
                            eventType = nil
                            eventId = nil
                            dataBuffer = ""
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish()
                }
            }

            self.currentTask = task

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    func disconnect() {
        currentTask?.cancel()
        currentTask = nil
        session.invalidateAndCancel()
    }
}
```

核心设计要点：

- **AsyncStream**：调用方通过 `for await event in stream` 消费，天然支持 Swift 结构化并发
- **手动 SSE 解析**：逐行读取 `bytes.lines`，按 SSE 规范解析 `event:`、`data:`、`id:` 字段
- **多行 data**：`dataBuffer` 累积多个 `data:` 行，用 `\n` 拼接
- **超时配置**：`timeoutIntervalForRequest` 和 `timeoutIntervalForResource` 设为 `.infinity`，避免长连接被系统回收

### 5.3 DI 注册

```swift
// DI/Container.swift
final class Container: @unchecked Sendable {
    static let shared = Container()

    let eventStreamClient: EventStreamClient

    private init() {
        let eventStreamClient = EventStreamClient()
        // ...
        self.eventStreamClient = eventStreamClient
    }
}
```

### 5.4 EventRouter (iOS)

```swift
typealias EventHandler = @Sendable (StationEvent) -> Void

final class EventRouter: @unchecked Sendable {
    private var handlers: [String: [EventHandler]] = [:]
    private let lock = NSLock()

    func register(eventType: String, handler: @escaping EventHandler) {
        lock.withLock {
            handlers[eventType, default: []].append(handler)
        }
    }

    func dispatch(event: StationEvent) {
        let matchedHandlers: [EventHandler] = lock.withLock {
            handlers[event.type] ?? []
        }
        for handler in matchedHandlers {
            handler(event)
        }
    }

    func removeAll(for eventType: String) {
        lock.withLock {
            handlers.removeValue(forKey: eventType)
        }
    }
}
```

使用示例：

```swift
// 注册 handler
let router = Container.shared.eventRouter
router.register(eventType: "chat.message.appended") { event in
    guard let data = event.data.data(using: .utf8),
          let message = try? JSONDecoder().decode(ChatMessage.self, from: data) else {
        return
    }
    ChatRepository.shared.insert(message)
}

// 消费事件流并分发
let client = Container.shared.eventStreamClient
let stream = client.connect(
    baseURL: Container.shared.preferenceStore.stationBaseURL,
    token: Container.shared.preferenceStore.accessToken!
)
Task {
    for await event in stream {
        router.dispatch(event: event)
    }
}
```

---

## 6. 平台差异对比

| 维度 | Android | iOS |
|---|---|---|
| SSE 库 | OkHttp `EventSources` (自动解析 SSE 帧) | URLSession `bytes.lines` (手动解析) |
| 事件流模型 | `SharedFlow<ServerEvent>` (热流，多订阅者) | `AsyncStream<StationEvent>` (冷流，单消费者) |
| 并发模型 | Kotlin 协程 (CoroutineScope + SupervisorJob) | Swift 结构化并发 (Task + async/await) |
| 自动重连 | 内置，5 秒延迟重试 (`scheduleReconnect`) | 需调用方自行实现重连循环 |
| 线程安全 | SharedFlow 本身线程安全 | NSLock 保护 handlers 字典 |
| DI 方式 | Hilt (@Singleton + @Inject) | Container 单例手动注入 |
| 事件模型 | `ServerEvent(type, data, id)` | `StationEvent(type, data, id)` |
| Router handler 签名 | `suspend (data: String) -> Unit` | `@Sendable (StationEvent) -> Void` |

---

## 7. 客户端事件处理流程

```
SSE 帧到达
    │
    v
EventStreamClient 解析为 ServerEvent / StationEvent
    │
    v
EventRouter.dispatch / collect
    │
    ├── type="chat.message.appended"  --> ChatHandler
    ├── type="follow.accepted"        --> FollowHandler
    ├── type="system.alert"           --> SystemHandler
    └── type=未注册                    --> 忽略 (无 handler)
```

处理步骤：

1. **解析 type**：从 SSE 帧的 `event:` 字段或 JSON 的 `type` 字段获取
2. **解码 payload**：`data` 字段包含完整 JSON，按 type 反序列化为对应的业务模型
3. **路由到 handler**：EventRouter 按 type 精确匹配，找到对应的 handler 列表并逐一执行
4. **handler 内处理**：更新本地数据库、刷新 UI 状态、触发通知等

---

## 8. 补漏与确认机制

除了 SSE 实时推送，Station 还提供拉取和确认接口用于断线补漏：

```
POST /events/pull    -- 拉取错过的事件
POST /events/ack     -- 确认事件已收到
GET  /events/stats   -- 查询事件系统状态 (调试用)
```

补漏流程：

```kotlin
// Android 示例：拉取错过的事件
suspend fun pullMissedEvents(sinceTimestamp: Long, limit: Int = 50) {
    val request = PullEventsRequest.newBuilder()
        .setSinceTs(sinceTimestamp)
        .setLimit(limit)
        .build()
    val response = stationApi.pullEvents(request)
    response.eventsList.forEach { event ->
        eventRouter.dispatch(event.type, event.payload)
    }
}

// 确认收到
suspend fun ackEvents(eventIds: List<String>) {
    val request = AckEventsRequest.newBuilder()
        .addAllEventIds(eventIds)
        .build()
    stationApi.ackEvents(request)
}
```

---

## 9. 连接生命周期管理

### Android

```kotlin
// 建立连接 (登录成功后)
eventStreamClient.connect(
    baseUrl = stationUrl,
    token = accessToken
)
eventRouter.startListening()

// 断开连接 (登出或 App 销毁时)
eventStreamClient.disconnect()
```

### iOS

```swift
// 建立连接
let stream = eventStreamClient.connect(
    baseURL: preferenceStore.stationBaseURL,
    token: preferenceStore.accessToken!
)

// 消费循环 (需自行管理 Task 生命周期)
let listenTask = Task {
    for await event in stream {
        eventRouter.dispatch(event: event)
    }
    // 流结束后的重连逻辑
}

// 断开连接
eventStreamClient.disconnect()
listenTask.cancel()
```

---

## 10. 注意事项

1. **Token 刷新**：SSE 连接使用 Bearer Token 鉴权，Token 过期后连接会断开。需在重连前刷新 Token，再调用 `connect`
2. **网络切换**：WiFi/蜂窝切换会导致连接断开，Android 的 `scheduleReconnect` 会自动处理，iOS 需要调用方实现
3. **后台限制**：iOS 系统会限制后台网络活动，SSE 连接可能在 App 进入后台后被系统终止，需在 `sceneDidBecomeActive` 时重连
4. **事件去重**：利用 `event.id` 做幂等处理，避免重连后补发的事件重复执行
5. **背压控制**：Android SharedFlow 缓冲区为 64，Station 端每连接 channel 缓冲为 256，超过后新事件会被丢弃或阻塞
