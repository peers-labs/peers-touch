# Station 事件系统指南

> 源码位置: `apps/station/frame/core/event/`

## 1. 架构概览

Station 的事件系统提供了**实时事件推送**基础设施, 采用 SSE (Server-Sent Events) 作为主要传输协议. 整体架构分为五层:

```
┌─────────────────────────────────────────┐
│  领域服务 (各域)                         │
│  发出领域事件对象                        │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  事件总线 (Broker - 可插拔)              │
│  memory -> Postgres LISTEN/NOTIFY       │
│  -> Redis Streams -> NATS               │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  订阅注册表 (SubscriptionRegistry)       │
│  维护在线订阅到连接集合的映射            │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  投递路由 (DeliveryRouter)               │
│  按 scope 路由到目标订阅连接             │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  连接枢纽 (ConnectionHub)               │
│  SSE/WS 管理、背压、断线重连            │
└──────────────────────────────────────────┘
```

---

## 2. EventSystem - 全局单例

`EventSystem` 封装了事件系统的全部组件:

```go
// frame/core/event/event.go
type EventSystem struct {
    Hub    *ConnectionHub     // 连接管理
    Router *DeliveryRouter    // 投递路由
    Broker broker.Broker      // 消息总线
    Logger logger.Logger      // 日志
}
```

### 2.1 创建与注册

```go
func NewEventSystem(brk broker.Broker, log logger.Logger) *EventSystem

func SetGlobalEventSystem(es *EventSystem)
func GetGlobalEventSystem() *EventSystem
```

在 events subserver 的 `Init` 中初始化:

```go
func (s *eventsSubServer) Init(ctx context.Context, opts ...option.Option) error {
    brk := broker.Get()
    log := logger.NewLogger(ctx, logger.WithLevel(logger.InfoLevel))
    eventSystem := event.NewEventSystem(brk, log)
    event.SetGlobalEventSystem(eventSystem)
    return nil
}
```

### 2.2 全局快捷函数

无需获取 EventSystem 实例即可发布事件:

```go
// 发布聊天消息事件
event.PublishChatMessage(senderID, recipientID, convID, messageID, content, msgType)

// 发布消息已读事件
event.PublishMessageRead(readerID, senderID, messageID)
```

这些函数内部会检查 `globalEventSystem` 是否为 nil, 未初始化时静默忽略.

---

## 3. Event 结构体

```go
// frame/core/event/types.go
type Event struct {
    ID        string            `json:"eventId"`    // 事件唯一标识
    Version   int               `json:"version"`    // 事件版本号
    Type      EventType         `json:"type"`       // 事件类型
    ActorID   string            `json:"actorId"`    // 发送者/发起者
    TargetID  string            `json:"targetId"`   // 目标接收者
    ObjectID  string            `json:"objectId"`   // 关联对象 (消息、帖子等)
    Scope     Scope             `json:"scope"`      // 投递范围
    Seq       int64             `json:"seq"`        // 每个目标的序列号
    Timestamp time.Time         `json:"ts"`         // 时间戳 (UTC)
    Payload   json.RawMessage   `json:"payload"`    // 事件负载 (JSON 字节)
    Headers   map[string]string `json:"headers,omitempty"` // 可选头信息
}
```

### 3.1 创建事件

```go
func NewEvent(eventType EventType, actorID, targetID, objectID string,
    scope Scope, payload interface{}) (*Event, error)
```

自动生成时间戳格式的事件 ID:

```go
func generateEventID() string {
    return time.Now().UTC().Format("20060102T150405.000000000")
}
```

示例:

```go
evt, err := event.NewEvent(
    event.EventChatMessageAppended,   // 事件类型
    "sender-001",                      // 发起者
    "recipient-002",                   // 目标
    "msg-abc-123",                     // 关联消息 ID
    event.ScopeActor,                  // 投递范围
    ChatMessagePayload{                // 负载
        ConvID:    "conv-xyz",
        MessageID: "msg-abc-123",
        SenderID:  "sender-001",
        Content:   "Hello!",
        MsgType:   "text",
    },
)
```

---

## 4. EventType 常量

```go
// frame/core/event/types.go

// 聊天事件
EventChatMessageAppended  EventType = "chat.message.appended"   // 新消息追加
EventChatMessageDelivered EventType = "chat.message.delivered"  // 消息已投递
EventChatMessageRead      EventType = "chat.message.read"       // 消息已读

// 关注事件
EventFollowRequested EventType = "follow.requested"  // 发起关注请求
EventFollowAccepted  EventType = "follow.accepted"   // 关注已接受
EventFollowRejected  EventType = "follow.rejected"   // 关注已拒绝
EventFollowUndone    EventType = "follow.undone"      // 取消关注

// 系统事件
EventSystemAlert       EventType = "system.alert"         // 系统告警
EventNodeStatusChanged EventType = "node.status.changed"  // 节点状态变更
```

---

## 5. Scope - 事件投递范围

```go
type Scope string

const (
    ScopeActor   Scope = "actor"   // 直接投递到指定用户
    ScopeConv    Scope = "conv"    // 投递到会话的所有成员
    ScopeContent Scope = "content" // 投递到内容的所有订阅者
)
```

Scope 决定了 `DeliveryRouter` 如何确定目标接收者:

| Scope | 目标确定方式 |
|-------|-------------|
| `actor` | 直接使用 `event.TargetID` |
| `conv` | 从 SubscriptionRegistry 获取会话的所有成员 |
| `content` | 从 SubscriptionRegistry 获取内容的所有订阅者 |

---

## 6. EventStatus - 事件生命周期

```go
type EventStatus string

const (
    StatusPending      EventStatus = "PENDING"        // 写入 Outbox, 等待调度
    StatusQueueSkipped EventStatus = "QUEUE_SKIPPED"  // 目标离线, 存储待发
    StatusEnqueued     EventStatus = "ENQUEUED"       // 进入内存队列
    StatusInFlight     EventStatus = "IN_FLIGHT"      // 已发送, 等待 ACK
    StatusAcked        EventStatus = "ACKED"          // 已确认接收
    StatusTimeout      EventStatus = "TIMEOUT"        // ACK 超时
    StatusRetry        EventStatus = "RETRY"          // 计划重试
    StatusDeadLetter   EventStatus = "DEAD_LETTER"    // 超过最大重试次数
)
```

---

## 7. ConnectionHub - 连接枢纽

ConnectionHub 管理所有活跃的 SSE 连接, 是事件系统的核心组件.

### 7.1 数据结构

```go
// frame/core/event/connection_hub.go
type ConnectionHub struct {
    mu          sync.RWMutex
    connections map[string][]*SSEConnection   // actorID -> 连接列表 (支持多设备)
    registry    *SubscriptionRegistry
    logger      logger.Logger
}
```

一个用户可以有多个并发连接 (多设备), 所有连接都以 `actorID` 为键存储在 map 中.

### 7.2 SSEConnection

```go
type SSEConnection struct {
    ID           string                // 连接唯一标识
    ActorID      string                // 用户标识
    Writer       http.ResponseWriter   // HTTP 响应写入器
    Flusher      http.Flusher          // 用于即时刷新
    Context      context.Context       // 连接上下文
    Cancel       context.CancelFunc    // 取消函数
    LastEventID  string                // 最后接收的事件 ID (断线重连用)
    ConnectedAt  time.Time             // 连接建立时间
    EventChan    chan *Event           // 事件通道 (缓冲 256)
    Subscribed   map[EventType]bool    // 订阅的事件类型
}
```

### 7.3 核心方法

```go
// 创建 ConnectionHub
hub := event.NewConnectionHub(logger)

// 注册连接
hub.Register(conn)
hub.RegisterSSE(conn)   // Hertz 原生 SSE 用 (不需要 http.Flusher)

// 注销连接
hub.Unregister(conn)

// 向目标用户的所有连接广播事件
sentCount := hub.Broadcast("user-123", event)

// 检查用户是否在线
online := hub.IsActorOnline("user-123")

// 获取用户的所有连接
conns := hub.GetConnectionsForActor("user-123")

// 获取连接统计
stats := hub.Stats()
// {"total_actors": 5, "total_connections": 8}
```

### 7.4 RunSSEWriter - SSE 写入循环

标准 HTTP 场景下, 每个 SSE 连接需要启动一个 goroutine 运行写入循环:

```go
func (h *ConnectionHub) RunSSEWriter(conn *SSEConnection)
```

该方法:
1. 设置 SSE 响应头 (`Content-Type: text/event-stream` 等)
2. 发送初始连接确认 (`: connected\n\n`)
3. 进入主循环, 处理三类事件:
   - `EventChan` 接收的业务事件 -> 格式化为 SSE 写入
   - 30 秒心跳 -> 发送 `: heartbeat\n\n`
   - Context 取消 -> 退出并注销连接

SSE 数据格式:

```
id: 20260408T120000.000000000
event: chat.message.appended
data: {"eventId":"...","type":"chat.message.appended","payload":...}

```

---

## 8. SubscriptionRegistry - 订阅注册表

管理三类订阅关系:

```go
// frame/core/event/subscription_registry.go
type SubscriptionRegistry struct {
    hub         *ConnectionHub
    actorSubs   map[string]*Subscription    // actorID -> 订阅配置
    convSubs    map[string][]string         // convID -> [actorIDs]
    contentSubs map[string][]string         // contentID -> [actorIDs]
}
```

### 8.1 Subscription

```go
type Subscription struct {
    ActorID    string
    Scope      Scope
    ScopeID    string        // 作用域 ID (如 convID)
    EventTypes []EventType   // 订阅的事件类型 (空 = 全部)
}
```

### 8.2 用户订阅

```go
// 订阅 (接收所有类型的事件)
registry.SubscribeActor("user-123", nil)

// 订阅 (仅接收指定类型)
registry.SubscribeActor("user-123", []event.EventType{
    event.EventChatMessageAppended,
    event.EventChatMessageRead,
})

// 取消订阅
registry.UnsubscribeActor("user-123")
```

### 8.3 会话订阅

```go
// 用户加入会话
registry.SubscribeConversation("conv-xyz", "user-123")
registry.SubscribeConversation("conv-xyz", "user-456")

// 用户离开会话
registry.UnsubscribeConversation("conv-xyz", "user-123")

// 获取会话的所有订阅者
subscribers := registry.GetConversationSubscribers("conv-xyz")
```

### 8.4 内容订阅

```go
// 订阅内容事件 (如帖子的点赞、评论通知)
registry.SubscribeContent("post-789", "user-123")
```

### 8.5 事件路由判断

```go
// 判断用户是否应接收某类事件
shouldReceive := registry.ShouldReceive("user-123", event.EventChatMessageAppended)

// 根据事件的 Scope 确定所有目标用户
targets := registry.GetTargetActors(evt)
```

`GetTargetActors` 的路由逻辑:

```go
func (r *SubscriptionRegistry) GetTargetActors(event *Event) []string {
    switch event.Scope {
    case ScopeActor:
        return []string{event.TargetID}         // 直接目标
    case ScopeConv:
        return r.GetConversationSubscribers(event.ObjectID) // 会话成员
    case ScopeContent:
        return r.contentSubs[event.ObjectID]    // 内容订阅者
    default:
        return []string{event.TargetID}
    }
}
```

---

## 9. DeliveryRouter - 投递路由

DeliveryRouter 是事件投递的核心引擎, 负责将事件路由到正确的目标连接.

### 9.1 结构

```go
// frame/core/event/delivery_router.go
type DeliveryRouter struct {
    hub      *ConnectionHub
    broker   broker.Broker
    logger   logger.Logger
    sequence map[string]int64   // targetID -> 最新序列号
}
```

### 9.2 DeliveryResult

```go
type DeliveryResult struct {
    EventID     string
    TargetID    string
    Status      EventStatus
    SentCount   int    // 成功发送的连接数
    IsOnline    bool   // 目标是否在线
}
```

### 9.3 Route - 核心路由方法

```go
func (r *DeliveryRouter) Route(ctx context.Context, event *Event) []DeliveryResult
```

路由流程:

```
1. 从 SubscriptionRegistry 获取目标用户列表
2. 遍历每个目标用户:
   a. 检查 ShouldReceive (事件类型过滤)
   b. 分配递增的序列号 (Seq)
   c. 检查用户是否在线
      - 在线: Broadcast 到所有连接, 状态 = IN_FLIGHT
      - 离线: 状态 = QUEUE_SKIPPED
   d. 无论在线/离线, 都通过 Broker 持久化到 "events:<targetID>" topic
3. 返回投递结果列表
```

### 9.4 便捷发布方法

```go
// 通用事件发布
router.PublishEvent(ctx, eventType, actorID, targetID, objectID, scope, payload)

// 聊天消息专用
router.PublishChatMessage(ctx, senderID, recipientID, convID, messageID, content, msgType)

// 消息已读专用
router.PublishMessageRead(ctx, readerID, senderID, messageID)
```

示例 - 在领域服务中发布事件:

```go
func (s *chatService) SendMessage(ctx context.Context, msg *Message) error {
    // ... 保存消息到数据库 ...

    // 发布实时事件
    event.PublishChatMessage(
        msg.SenderID,
        msg.RecipientID,
        msg.ConvID,
        msg.ID,
        msg.Content,
        msg.Type,
    )

    return nil
}
```

---

## 10. ChatMessagePayload - 聊天消息负载

```go
type ChatMessagePayload struct {
    ConvID    string `json:"convId"`
    MessageID string `json:"msgId"`
    SenderID  string `json:"senderId"`
    Content   string `json:"content,omitempty"`
    MsgType   string `json:"msgType,omitempty"`
    Timestamp int64  `json:"timestamp"`
}
```

---

## 11. Events SubServer - SSE 端点实现

`app/subserver/events/` 是事件系统的 HTTP 接入层, 提供四个端点:

### 11.1 路由注册

```go
func (s *eventsSubServer) Handlers() []server.Handler {
    provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
    jwtWrapper := serverwrapper.JWT(provider)
    hertzJWTWrapper := hertzadapter.RequireJWT(provider)

    return []server.Handler{
        // SSE 流 (Hertz 原生 Handler, 支持 chunked streaming)
        server.NewHertzHandler("events-stream", "/events/stream", server.GET,
            s.handleSSEStreamHertz, hertzJWTWrapper),

        // 拉取离线事件
        server.NewTypedHandler("events-pull", "/events/pull", server.POST,
            s.handlePull, logIDWrapper, jwtWrapper),

        // 确认事件接收
        server.NewTypedHandler("events-ack", "/events/ack", server.POST,
            s.handleAck, logIDWrapper, jwtWrapper),

        // 统计信息 (调试用)
        server.NewTypedHandler("events-stats", "/events/stats", server.GET,
            s.handleStats, logIDWrapper),
    }
}
```

### 11.2 SSE 流端点 (GET /events/stream)

这是客户端建立实时推送连接的入口:

```go
func (s *eventsSubServer) handleSSEStreamHertz(ctx context.Context, c *app.RequestContext) {
    // 1. 获取认证用户
    subject := hertzadapter.GetSubject(c)
    actorID := subject.ID

    // 2. 获取断线重连的 lastEventID
    lastEventID := string(c.GetHeader("Last-Event-ID"))
    if lastEventID == "" {
        lastEventID = c.Query("lastEventId")
    }

    // 3. 设置 SSE 响应头
    c.Response.Header.Set("Content-Type", "text/event-stream")
    c.Response.Header.Set("Cache-Control", "no-cache")
    c.Response.Header.Set("Connection", "keep-alive")
    c.Response.Header.Set("X-Accel-Buffering", "no")
    c.Response.Header.Set("Transfer-Encoding", "chunked")

    // 4. 劫持响应写入器, 启用 chunked 传输
    c.Response.HijackWriter(newSSEWriter(&c.Response, c.GetWriter()))

    // 5. 创建 SSE 连接并注册到 Hub
    eventChan := make(chan *event.Event, 256)
    conn := &event.SSEConnection{
        ID:        connID,
        ActorID:   actorID,
        EventChan: eventChan,
        // ...
    }
    es.Hub.RegisterSSE(conn)
    defer es.Hub.Unregister(conn)

    // 6. 订阅用户事件
    es.Hub.GetRegistry().SubscribeActor(actorID, nil)

    // 7. 发送初始连接确认
    c.Write([]byte(": connected\n\n"))
    c.Flush()

    // 8. 如果有 lastEventID, 补发离线事件
    if lastEventID != "" {
        s.sendMissedEventsToHertz(c, actorID, lastEventID, es)
    }

    // 9. 主事件循环
    heartbeat := time.NewTicker(30 * time.Second)
    for {
        select {
        case <-ctx.Done():
            return
        case evt := <-eventChan:
            sseMsg := fmt.Sprintf("id: %s\nevent: %s\ndata: %s\n\n",
                evt.ID, evt.Type, data)
            c.Write([]byte(sseMsg))
            c.Flush()
        case <-heartbeat.C:
            c.Write([]byte(": heartbeat\n\n"))
            c.Flush()
        }
    }
}
```

### 11.3 拉取离线事件 (POST /events/pull)

客户端断线重连后, 可通过此端点拉取遗漏的事件:

```go
func (s *eventsSubServer) handlePull(ctx context.Context, req *PullEventsRequest) (*PullEventsResponse, error) {
    subject := auth.GetSubject(ctx)
    actorID := subject.ID

    topic := "events:" + actorID
    messages, err := es.Broker.Pull(ctx, topic, sinceID, limit, broker.PullOptions{})

    // 将 broker 消息转为 protobuf Event 响应
    events := make([]*eventsmodel.Event, 0)
    for _, msg := range messages {
        // ...
    }
    return &PullEventsResponse{Events: events}, nil
}
```

### 11.4 确认接收 (POST /events/ack)

客户端确认已收到事件:

```go
func (s *eventsSubServer) handleAck(ctx context.Context, req *AckEventsRequest) (*AckEventsResponse, error) {
    subject := auth.GetSubject(ctx)
    // 记录 ACK
    return &AckEventsResponse{AckedCount: int32(len(req.EventIds))}, nil
}
```

---

## 12. 客户端接入示例

### 12.1 JavaScript SSE 客户端

```javascript
const token = "eyJhbGciOiJIUzI1NiIs...";
const eventSource = new EventSource(
    `/events/stream?lastEventId=${lastId}`,
    {
        headers: { "Authorization": `Bearer ${token}` }
    }
);

eventSource.addEventListener("chat.message.appended", (e) => {
    const event = JSON.parse(e.data);
    console.log("新消息:", event.payload);
});

eventSource.addEventListener("chat.message.read", (e) => {
    const event = JSON.parse(e.data);
    console.log("已读:", event.payload);
});

eventSource.onerror = () => {
    // 断线重连时, 浏览器会自动带上 Last-Event-ID 头
};
```

### 12.2 SSE 数据流格式

```
: connected

id: 20260408T120000.123456789
event: chat.message.appended
data: {"eventId":"20260408T120000.123456789","version":1,"type":"chat.message.appended","actorId":"sender-001","targetId":"recipient-002","objectId":"msg-abc","scope":"actor","seq":1,"ts":"2026-04-08T12:00:00Z","payload":{"convId":"conv-xyz","msgId":"msg-abc","senderId":"sender-001","content":"Hello!","msgType":"text"}}

: heartbeat

id: 20260408T120030.987654321
event: follow.accepted
data: {"eventId":"20260408T120030.987654321",...}

```

---

## 13. 完整数据流

从领域事件发出到客户端接收的完整链路:

```
领域服务 (如 chatService.SendMessage)
    │
    │  event.PublishChatMessage(sender, recipient, conv, msg, content, type)
    ▼
全局快捷函数
    │
    │  globalEventSystem.Router.PublishChatMessage(...)
    ▼
DeliveryRouter.PublishChatMessage
    │
    │  1. 构造 ChatMessagePayload
    │  2. 调用 PublishEvent -> NewEvent -> Route
    ▼
DeliveryRouter.Route
    │
    │  1. SubscriptionRegistry.GetTargetActors (按 Scope 确定目标)
    │  2. 为每个目标分配 Seq
    │  3. 检查在线状态
    │     ├── 在线: ConnectionHub.Broadcast -> SSEConnection.Send
    │     └── 离线: 标记 QUEUE_SKIPPED
    │  4. 持久化到 Broker (topic: "events:<targetID>")
    ▼
ConnectionHub.Broadcast
    │
    │  遍历目标用户的所有 SSEConnection
    │  event -> EventChan (缓冲通道, 256)
    ▼
SSE Writer 循环 (handleSSEStreamHertz)
    │
    │  从 EventChan 读取 -> 格式化为 SSE -> Write + Flush
    ▼
客户端 (EventSource)
    │
    │  收到 SSE 事件 -> 触发 addEventListener 回调
    ▼
UI 更新
```
