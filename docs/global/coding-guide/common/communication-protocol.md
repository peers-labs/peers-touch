# 域间通信协议指南

> 最后更新: 2026-04-08
>
> 本文档定义 Peers-Touch 各域内应用 (Station / Desktop / Mobile) 之间的通信协议规范、序列化策略和数据格式约定。

---

## 1. 核心原则

**域内应用通信必须使用 Protobuf 协议, 非必要不使用 JSON。**

唯一允许 JSON 的场景见第 7 节。违反此原则的代码在 Review 阶段应被拒绝。

---

## 2. HTTP Content-Type 协商

Station 使用 `ContentNegotiator` 根据请求头 `Content-Type` 自动选择序列化器。

### 2.1 协商逻辑

源码参考: `station/frame/core/server/negotiator.go`

```go
// GetRequestSerializer 根据 Content-Type 选择反序列化器
func (n *ContentNegotiator) GetRequestSerializer(contentType string) Serializer {
    contentType = strings.ToLower(strings.TrimSpace(contentType))
    if idx := strings.Index(contentType, ";"); idx != -1 {
        contentType = strings.TrimSpace(contentType[:idx])
    }
    switch contentType {
    case "application/protobuf", "application/x-protobuf":
        return &ProtoSerializer{}
    case "application/json", "":
        return &JSONSerializer{}
    default:
        return n.defaultSerializer
    }
}
```

### 2.2 Content-Type 对照表

| Content-Type | 序列化器 | 适用场景 |
|---|---|---|
| `application/protobuf` | `ProtoSerializer` | 域内应用间首选 |
| `application/x-protobuf` | `ProtoSerializer` | 兼容别名 |
| `application/json` | `JSONSerializer` | 降级回退 |
| 空值 / 未知 | `JSONSerializer` | 默认回退 |

### 2.3 Serializer 接口

源码参考: `station/frame/core/server/serializer.go`

```go
type Serializer interface {
    Marshal(v interface{}) ([]byte, error)
    Unmarshal(data []byte, v interface{}) error
    ContentType() string
}
```

`ProtoSerializer` 要求传入的值实现 `proto.Message` 接口:

```go
func (s *ProtoSerializer) Marshal(v interface{}) ([]byte, error) {
    msg, ok := v.(proto.Message)
    if !ok {
        return nil, fmt.Errorf("value is not a proto.Message, got %T", v)
    }
    return proto.Marshal(msg)
}
```

### 2.4 自动类型推断

`GetSerializerForType` 通过反射判断类型是否实现 `proto.Message`, 自动选择序列化器:

```go
func GetSerializerForType(t reflect.Type) Serializer {
    if isProtoMessage(t) {
        return &ProtoSerializer{}
    }
    return &JSONSerializer{}
}
```

### 2.5 客户端请求示例

Protobuf 请求:

```bash
curl -X POST https://station.example/events/pull \
  -H "Content-Type: application/protobuf" \
  -H "Authorization: Bearer <token>" \
  --data-binary @pull_request.pb
```

JSON 降级请求:

```bash
curl -X POST https://station.example/events/pull \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"limit": 50, "since_ts": 1712000000}'
```

---

## 3. SSE (Server-Sent Events)

Station 的 events subserver 通过 SSE 实时推送事件到客户端。

### 3.1 连接端点

```
GET /events/stream
```

请求头:
- `Authorization: Bearer <jwt_token>` -- 必需
- `Last-Event-ID: <event_id>` -- 可选, 用于断线重连补漏

### 3.2 响应头

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
Transfer-Encoding: chunked
```

### 3.3 SSE 消息格式

源码参考: `station/app/subserver/events/handler.go`

```
id: <event_id>
event: <event_type>
data: <json_payload>

```

每条消息由 `id`、`event`、`data` 三行加一个空行组成。示例:

```
id: 20260408T120000.123456789
event: chat.message.appended
data: {"eventId":"20260408T120000.123456789","version":1,"type":"chat.message.appended","actorId":"alice","targetId":"bob","objectId":"msg-001","scope":"conv","ts":"2026-04-08T12:00:00Z","payload":{"convId":"conv-1","msgId":"msg-001","senderId":"alice","content":"Hello","msgType":"text","timestamp":1712577600}}

```

心跳包 (每 30 秒):

```
: heartbeat

```

连接建立确认:

```
: connected

```

### 3.4 events.proto 定义

源码参考: `model/domain/events/events.proto`

```protobuf
syntax = "proto3";
package peers_touch.model.events.v1;

import "google/protobuf/timestamp.proto";

message Event {
  string id = 1;
  string type = 2;
  bytes payload = 3;
  google.protobuf.Timestamp created_at = 4;
}

message PullEventsRequest {
  int32 limit = 1;
  int64 since_ts = 2;
}

message PullEventsResponse {
  repeated Event events = 1;
}

message AckEventsRequest {
  repeated string event_ids = 1;
}

message AckEventsResponse {
  int32 acked_count = 1;
}
```

### 3.5 Go 侧事件结构

源码参考: `station/frame/core/event/types.go`

```go
type Event struct {
    ID        string            `json:"eventId"`
    Version   int               `json:"version"`
    Type      EventType         `json:"type"`
    ActorID   string            `json:"actorId"`
    TargetID  string            `json:"targetId"`
    ObjectID  string            `json:"objectId"`
    Scope     Scope             `json:"scope"`
    Seq       int64             `json:"seq"`
    Timestamp time.Time         `json:"ts"`
    Payload   json.RawMessage   `json:"payload"`
    Headers   map[string]string `json:"headers,omitempty"`
}
```

### 3.6 事件类型

| EventType | 说明 |
|---|---|
| `chat.message.appended` | 新聊天消息 |
| `chat.message.delivered` | 消息已送达 |
| `chat.message.read` | 消息已读 |
| `follow.requested` | 关注请求 |
| `follow.accepted` | 关注已接受 |
| `follow.rejected` | 关注已拒绝 |
| `follow.undone` | 取消关注 |
| `system.alert` | 系统告警 |
| `node.status.changed` | 节点状态变更 |

### 3.7 事件状态机

```
PENDING -> ENQUEUED -> IN_FLIGHT -> ACKED
                                 -> TIMEOUT -> RETRY -> ACKED
                                                     -> DEAD_LETTER
       -> QUEUE_SKIPPED (目标离线)
```

### 3.8 客户端接入

Desktop (TypeScript):

```typescript
// 使用 EventSource polyfill (Tauri 环境)
const es = new EventSource(`${baseUrl}/events/stream`, {
  headers: { 'Authorization': `Bearer ${token}` }
});

es.addEventListener('chat.message.appended', (e: MessageEvent) => {
  const event = JSON.parse(e.data);
  // event.payload 包含 ChatMessagePayload
});
```

Mobile Android (OkHttp SSE):

```kotlin
val request = Request.Builder()
    .url("${baseUrl}/events/stream")
    .header("Authorization", "Bearer $token")
    .build()

val sse = OkHttpClient().newBuilder()
    .readTimeout(0, TimeUnit.MILLISECONDS)
    .build()
    .newEventSource(request, object : EventSourceListener() {
        override fun onEvent(es: EventSource, id: String?, type: String?, data: String) {
            // type = "chat.message.appended", data = JSON
        }
    })
```

Mobile iOS (URLSession SSE):

```swift
var request = URLRequest(url: URL(string: "\(baseUrl)/events/stream")!)
request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

let session = URLSession(configuration: .default, delegate: sseDelegate, delegateQueue: nil)
let task = session.dataTask(with: request)
task.resume()
```

### 3.9 补漏拉取

SSE 断线后, 客户端使用 `Last-Event-ID` 或 Pull 接口补漏:

```
POST /events/pull   (Protobuf: PullEventsRequest)
POST /events/ack    (Protobuf: AckEventsRequest)
```

---

## 4. Tauri IPC (Desktop 端)

Desktop 端 TypeScript ↔ Rust 通信使用 Tauri IPC，底层基于 serde JSON 序列化。

**为什么这里用 JSON 而不是 Protobuf？**

这是 Tauri 框架的硬约束，无法绕开：Tauri 的 `invoke()` 走 `wry` WebView IPC 通道，所有参数和返回值都必须经过 JSON 序列化。即使 TS 侧调用 `.toBinary()` 把 proto 序列化为 `Uint8Array`，Tauri 也会把它 base64 编码后塞进 JSON 再传输，反而更低效。

**不会有明显性能损耗**，因为：
1. TS ↔ Rust 的 IPC 传输量极轻（UI 指令，几百字节量级），JSON 序列化几乎零开销
2. 真正的大数据流（消息流、文件上传、SSE 事件）由 **Rust 直接走 HTTP + Protobuf 请求 Station**，完全绕过 TS 层（见 `station_client.rs` 的 `request_proto()` 函数）

简言之：**TS ↔ Rust = JSON（框架约束）；Rust ↔ Station = Protobuf（主动选择）**。

### 4.1 TS -> Rust: invoke()

源码参考: `apps/desktop/src/services/desktop_api.ts`

```typescript
async function invokeRustCommand<TInput, TData>(
  command: string,
  input?: TInput,
): Promise<RustCommandResult<TData>> {
  try {
    const payload = input === undefined ? undefined : { input };
    const result = await invoke<RustCommandResult<TData>>(command, payload);
    return result;
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
```

### 4.2 AppResult<T> -- 统一响应包装

Rust 侧 (源码: `apps/desktop/src-tauri/src/error.rs`):

```rust
#[derive(Debug, Clone, Serialize)]
pub struct AppResult<T: Serialize> {
    pub ok: bool,
    pub data: Option<T>,
    pub error: Option<AppError>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    NotImplemented,
    InvalidArgument,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    InternalError,
}
```

TypeScript 侧:

```typescript
export interface RustCommandResult<T = Record<string, any>> {
  ok: boolean;
  data?: T;
  error?: RustCommandError;
}

export type RustErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'INVALID_ARGUMENT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';
```

### 4.3 Tauri Command 示例

Rust 命令定义:

```rust
#[tauri::command]
pub fn chat_send_message(_input: ChatSendMessageInput) -> AppResult<StubPayload> {
    application_chat::chat_send_message(_input)
}
```

TypeScript 调用:

```typescript
const result = await api.chatSendMessage({
  conversation_id: 'conv-1',
  content: 'Hello',
});
// result: RustCommandResult<TauriStubPayload>
if (result.ok) {
  // result.data 可用
}
```

### 4.4 Rust -> TS: Tauri 事件系统

Tauri 支持 Rust 主动向前端推送事件, 通过 `app.emit()` / `window.emit()` 发送, 前端通过 `listen()` 监听。

---

## 5. Proto 序列化各端实现

### 5.1 Go (Station)

依赖: `google.golang.org/protobuf`

```go
import "google.golang.org/protobuf/proto"

// 序列化
data, err := proto.Marshal(msg)

// 反序列化
err := proto.Unmarshal(data, msg)
```

Proto 生成命令:

```bash
cd model && bash build.sh
```

生成产物: `*.pb.go` 文件, 位于 `station/frame/touch/model/` 各子目录。

### 5.2 Rust (Desktop)

依赖: `prost` (编译时生成)

生成产物位于 `apps/desktop/src-tauri/src/model/`, 文件名格式 `peers_touch.model.<domain>.v1.rs`。

通过 `mod.rs` 引入:

```rust
pub mod chat {
    pub mod v1 {
        include!("peers_touch.model.chat.v1.rs");
    }
    pub use v1::*;
}

pub mod events {
    pub mod v1 {
        include!("peers_touch.model.events.v1.rs");
    }
    pub use v1::*;
}
```

使用示例:

```rust
use crate::model::chat::SendMessageRequest;

let req = SendMessageRequest {
    session_ulid: "01H...".to_string(),
    receiver_did: "did:peers:bob".to_string(),
    content: "Hello".to_string(),
    ..Default::default()
};
```

### 5.3 TypeScript (Desktop)

依赖: `@bufbuild/protobuf`, 由 `protoc-gen-es` 生成。

生成产物位于 `apps/desktop/src/gen/proto/`, 用于类型引用:

```typescript
import type { Peer } from '@/gen/proto/domain/core/core_pb';
import { PeerSchema } from '@/gen/proto/domain/core/core_pb';
```

Desktop 前端与 Station 通信时, 经 Tauri Rust 层转发, TypeScript 层以 JSON 格式使用, Proto 类型仅用于类型安全。

### 5.4 Kotlin / Swift (Mobile)

通过脚本 `tooling/scripts/proto-gen-mobile.sh` 生成。

```bash
# 全部生成
./tooling/scripts/proto-gen-mobile.sh

# 仅 Kotlin (Java Lite)
./tooling/scripts/proto-gen-mobile.sh kotlin

# 仅 Swift
./tooling/scripts/proto-gen-mobile.sh swift
```

输出路径:
- Kotlin: `apps/mobile/android/app/src/main/java/`
- Swift: `apps/mobile/ios/PeersTouch/Core/Proto/`

Kotlin 使用示例:

```kotlin
val request = PullEventsRequest.newBuilder()
    .setLimit(50)
    .setSinceTs(System.currentTimeMillis())
    .build()

val body = request.toByteArray()
// Content-Type: application/protobuf
```

Swift 使用示例:

```swift
var request = PeersTouch_Model_Events_V1_PullEventsRequest()
request.limit = 50
request.sinceTs = Int64(Date().timeIntervalSince1970)

let body = try request.serializedData()
// Content-Type: application/protobuf
```

---

## 6. TypedHandler -- 服务端自动协商

Station 的 `TypedHandler` 自动完成 Content-Type 协商、请求体反序列化、响应体序列化:

```go
// 注册时仅需声明 proto message 类型
server.NewTypedHandler(
    "events-pull",
    "/events/pull",
    server.POST,
    s.handlePull,      // func(ctx, *PullEventsRequest) (*PullEventsResponse, error)
    logIDWrapper,
    jwtWrapper,
)
```

当客户端发送 `Content-Type: application/protobuf`, 框架自动使用 `ProtoSerializer`; 发送 `application/json` 则使用 `JSONSerializer`。业务代码无需关心序列化细节。

---

## 7. JSON 允许使用的场景

| 场景 | 原因 |
|---|---|
| Tauri IPC (`invoke()`) | serde 序列化限制, 无法直接传输 proto wire format |
| SSE data 字段 | SSE 协议要求文本格式, `data:` 行使用 JSON stringify |
| 第三方 API 响应 | 无法控制外部 API 的序列化格式 |
| 配置文件 (YAML/JSON) | 人类可读需求 |

**其他所有域内应用间的 HTTP 通信, 必须优先使用 Protobuf。**

---

## 8. 通信流程总览

```
Mobile (Kotlin/Swift)
  |
  | HTTP + Protobuf (application/protobuf)
  | SSE (text/event-stream + JSON data)
  v
Station (Go)
  ^
  | HTTP + Protobuf (application/protobuf)
  | SSE (text/event-stream + JSON data)
  |
Desktop Rust Layer
  ^
  | Tauri IPC (serde JSON)
  |
Desktop TypeScript Layer
```
