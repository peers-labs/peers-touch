# Station Handler 编写指南

本文档基于 `apps/station/frame/core/server/` 的真实代码，指导如何在 Station 中编写和注册 HTTP Handler。

---

## 核心抽象

Station 的 Handler 体系基于以下核心接口（`handler.go`）：

```go
// 统一端点处理函数签名
type EndpointHandler func(ctx context.Context, req Request, resp Response) error

// Wrapper 中间件：包装 EndpointHandler，实现 AOP
type Wrapper func(EndpointHandler) EndpointHandler

// Handler 接口：所有 Handler 的统一抽象
type Handler interface {
    Name() string
    Path() string
    Method() Method
    Handler() EndpointHandler
    Wrappers() []Wrapper
    Type() HandlerType
}
```

`Request` 和 `Response` 是协议无关的抽象接口，底层由 Hertz 实现：

```go
type Request interface {
    Context() context.Context
    Header() map[string]string
    Method() Method
    Path() string
    Body() []byte
}

type Response interface {
    Header() map[string]string
    SetHeader(key, value string)
    Write([]byte) (int, error)
    WriteHeader(int)
    Status() int
}
```

---

## Handler 类型一览

| 构造函数 | 适用场景 | 自动序列化 | 自动错误处理 |
|---|---|---|---|
| `NewTypedHandler` | 标准业务接口（推荐） | 是 | 是 |
| `NewHTTPHandler` | 需要原始 `http.ResponseWriter` | 否 | 否 |
| `NewSimpleHandler` | 需要原始请求但要自动错误处理 | 否 | 是 |
| `NewHertzHandler` | SSE 流式推送等 Hertz 原生场景 | 否 | 否 |
| `NewHandlerWithURL` | 使用 `RouterURL` 接口注册 | 否 | 否 |

---

## 1. NewTypedHandler — 泛型类型化 Handler（推荐）

**源码**：`typed_handler.go`

自动处理请求反序列化、响应序列化、Content-Type 协商、错误转换。是编写业务接口的首选方式。

### 函数签名

```go
func NewTypedHandler[Req, Resp any](
    name, path string,
    method Method,
    handler TypedHandler[Req, Resp],
    wrappers ...Wrapper,
) Handler

// handler 函数签名
type TypedHandler[Req, Resp any] func(context.Context, *Req) (*Resp, error)
```

### 参数说明

| 参数 | 说明 |
|---|---|
| `name` | Handler 唯一标识名，用于日志和调试 |
| `path` | 路由路径，如 `/group-chat/create` |
| `method` | HTTP 方法：`server.GET`、`server.POST`、`server.PUT`、`server.DELETE` 等 |
| `handler` | 业务处理函数，接收类型化的请求，返回类型化的响应 |
| `wrappers` | 中间件链，按顺序执行 |

### 内部处理流程

1. 根据请求 `Content-Type` 选择 `Serializer`（JSON 或 Proto）
2. 反序列化请求体到 `*Req`
3. 调用业务 handler
4. 如果返回 `*HandlerError`，以对应状态码和错误信息响应
5. 序列化 `*Resp` 并写入响应

### 真实示例：group_chat

```go
// handler.go — 路由注册
func (s *subServer) Handlers() []server.Handler {
    logIDWrapper := serverwrapper.LogID()
    return []server.Handler{
        server.NewTypedHandler("gc-create", "/group-chat/create", server.POST,
            s.handleCreate, logIDWrapper, s.jwtWrapper),
        server.NewTypedHandler("gc-list", "/group-chat/list", server.GET,
            s.handleList, logIDWrapper, s.jwtWrapper),
        server.NewTypedHandler("gc-info", "/group-chat/info", server.GET,
            s.handleInfo, logIDWrapper, s.jwtWrapper),
        server.NewTypedHandler("gc-update", "/group-chat/update", server.PUT,
            s.handleUpdate, logIDWrapper, s.jwtWrapper),
    }
}

// handler 实现
func (s *subServer) handleCreate(
    ctx context.Context,
    req *chat.CreateGroupRequest,
) (*chat.CreateGroupResponse, error) {
    subject := auth.GetSubject(ctx)
    if subject == nil {
        return nil, server.Unauthorized("authentication required")
    }
    if req.Name == "" {
        return nil, server.BadRequest("name is required")
    }

    item := s.appService.CreateGroup(subject.ID, req.Name, req.Description)

    return &chat.CreateGroupResponse{
        Group: &chat.Group{
            Ulid:        item.ID,
            Name:        item.Name,
            Description: item.Description,
            OwnerDid:    item.OwnerDID,
            MemberCount: item.MemberCount,
            CreatedAt:   timestamppb.New(item.CreatedAt),
            UpdatedAt:   timestamppb.New(item.UpdatedAt),
        },
    }, nil
}
```

### 真实示例：events（Proto 类型）

```go
server.NewTypedHandler("events-pull", "/events/pull", server.POST,
    s.handlePull, logIDWrapper, jwtWrapper),

func (s *eventsSubServer) handlePull(
    ctx context.Context,
    req *eventsmodel.PullEventsRequest,
) (*eventsmodel.PullEventsResponse, error) {
    subject := auth.GetSubject(ctx)
    if subject == nil {
        return nil, server.Unauthorized("authentication required")
    }
    // ... 业务逻辑
    return &eventsmodel.PullEventsResponse{Events: events}, nil
}
```

> Req/Resp 类型如果实现了 `proto.Message` 接口，序列化器会自动使用 ProtoSerializer。

---

## 2. NewHTTPHandler — 原始 HTTP Handler

**源码**：`handler.go`

当需要直接操作 `http.ResponseWriter` 和 `*http.Request` 时使用（如文件上传、multipart 处理）。通过 `HTTPHandlerFunc` 适配 `http.HandlerFunc` 到 `EndpointHandler`。

### 函数签名

```go
func NewHTTPHandler(
    name, path string,
    method Method,
    h EndpointHandler,
    wrappers ...Wrapper,
) Handler

// 将 http.HandlerFunc 适配为 EndpointHandler
func HTTPHandlerFunc(h http.HandlerFunc) EndpointHandler
```

### 真实示例：signaling（ICE 信令）

```go
func (s *SubServer) Handlers() []server.Handler {
    provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
    jwtWrapper := server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

    return []server.Handler{
        server.NewHTTPHandler("ice-peer-register", "/api/v1/ice/peer/register", server.POST,
            server.HTTPHandlerFunc(s.handlePeerRegister), jwtWrapper),
        server.NewHTTPHandler("ice-peers", "/api/v1/ice/peers", server.GET,
            server.HTTPHandlerFunc(s.handlePeers)),
    }
}

func (s *SubServer) handlePeers(w http.ResponseWriter, r *http.Request) {
    s.mu.RLock()
    res := make([]peerInfo, 0, len(s.peers))
    for _, v := range s.peers {
        res = append(res, v)
    }
    s.mu.RUnlock()
    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(res)
}
```

### 真实示例：文件上传（OSS）

```go
func (s *ossSubServer) Handlers() []server.Handler {
    var uploadWrappers []server.Wrapper
    if s.authProvider != nil {
        uploadWrappers = []server.Wrapper{
            server.HTTPWrapperAdapter(authhttp.RequireJWT(s.authProvider)),
        }
    }

    return []server.Handler{
        server.NewHTTPHandler("oss-upload", "/oss/upload", server.POST,
            server.HTTPHandlerFunc(s.handleUpload), uploadWrappers...),
        server.NewHTTPHandler("oss-file-get", "/oss/file", server.GET,
            server.HTTPHandlerFunc(s.handleFileGet)),
    }
}

func (s *ossSubServer) handleUpload(w http.ResponseWriter, r *http.Request) {
    if err := r.ParseMultipartForm(32 << 20); err != nil {
        w.WriteHeader(http.StatusBadRequest)
        _ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_multipart"})
        return
    }
    file, hdr, err := r.FormFile("file")
    if err != nil {
        w.WriteHeader(http.StatusBadRequest)
        _ = json.NewEncoder(w).Encode(map[string]string{"error": "file_required"})
        return
    }
    defer file.Close()

    meta, err := s.fileService.SaveFile(r.Context(), file, hdr)
    if err != nil {
        w.WriteHeader(http.StatusInternalServerError)
        return
    }
    _ = json.NewEncoder(w).Encode(meta)
}
```

### 真实示例：Relay（Subject Guard 模式）

当需要在 JWT 验证之后进一步检查权限时，可以包装 `http.HandlerFunc` 为 `EndpointHandler`：

```go
func (h *relayHandler) handlers() []server.Handler {
    jwt := h.sub.jwtWrapper
    logID := serverwrapper.LogID()

    return []server.Handler{
        server.NewHTTPHandler("relay-invite-create", "/api/v1/relay/invite", server.POST,
            h.requireAdmin(h.handleCreateInvite), logID, jwt),
        server.NewHTTPHandler("relay-register", "/api/v1/relay/register", server.POST,
            server.HTTPHandlerFunc(h.handleRegister), logID),
        server.NewHTTPHandler("relay-forward", "/relay/forward/*path", server.ANY,
            h.requireNetwork(h.handleForward), logID, jwt),
    }
}

// Subject Guard：在 JWT Wrapper 之后进一步校验
func (h *relayHandler) requireAdmin(next http.HandlerFunc) server.EndpointHandler {
    return server.HTTPHandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        subj := httpadapter.GetSubject(r)
        if subj == nil {
            writeJSON(w, http.StatusUnauthorized, errorBody("authentication required"))
            return
        }
        if strings.HasPrefix(subj.ID, domain.SubjectRelayAccess) ||
            strings.HasPrefix(subj.ID, domain.SubjectRelayClient) {
            writeJSON(w, http.StatusForbidden, errorBody("relay tokens cannot call admin endpoints"))
            return
        }
        next(w, r)
    })
}
```

---

## 3. NewSimpleHandler — 简单 Handler（自动错误处理）

**源码**：`typed_handler.go`

不需要自动序列化，但希望 `HandlerError` 自动转换为 JSON 错误响应。

### 函数签名

```go
type TypedHandlerFunc func(context.Context, Request, Response) error

func NewSimpleHandler(
    name, path string,
    method Method,
    handler TypedHandlerFunc,
    wrappers ...Wrapper,
) Handler
```

### 示例

```go
server.NewSimpleHandler("health", "/health", server.GET,
    func(ctx context.Context, req server.Request, resp server.Response) error {
        resp.SetHeader("Content-Type", "application/json")
        resp.WriteHeader(200)
        resp.Write([]byte(`{"status":"ok"}`))
        return nil
    },
)
```

如果返回 `*HandlerError`，会自动序列化为 JSON 格式 `{"error":"...", "code":400}` 并设置对应状态码。

---

## 4. NewHertzHandler — Hertz 原生 Handler（SSE 流式推送）

**源码**：`handler.go`

直接访问 `*app.RequestContext`，用于 SSE 等需要流式写入的场景。使用 Hertz 原生中间件（非 `server.Wrapper`）。

### 函数签名

```go
func NewHertzHandler(
    name, path string,
    method Method,
    h interface{},            // func(context.Context, *app.RequestContext)
    middlewares ...interface{}, // Hertz 原生中间件
) Handler
```

### 真实示例：SSE 事件推送

```go
func (s *eventsSubServer) Handlers() []server.Handler {
    logIDWrapper := serverwrapper.LogID()
    provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
    jwtWrapper := serverwrapper.JWT(provider)

    // Hertz 原生 JWT 中间件（区别于 server.Wrapper）
    hertzJWTWrapper := hertzadapter.RequireJWT(provider)

    return []server.Handler{
        // SSE 用 NewHertzHandler + Hertz 原生中间件
        server.NewHertzHandler("events-stream", "/events/stream", server.GET,
            s.handleSSEStreamHertz, hertzJWTWrapper),

        // 普通接口用 NewTypedHandler + server.Wrapper
        server.NewTypedHandler("events-pull", "/events/pull", server.POST,
            s.handlePull, logIDWrapper, jwtWrapper),
    }
}

// SSE Handler 实现
func (s *eventsSubServer) handleSSEStreamHertz(ctx context.Context, c *app.RequestContext) {
    // Hertz 原生中间件通过 app.RequestContext 传递 Subject
    subject := hertzadapter.GetSubject(c)
    if subject == nil {
        c.JSON(401, map[string]string{"error": "unauthorized"})
        return
    }

    // 设置 SSE Headers
    c.Response.Header.Set("Content-Type", "text/event-stream")
    c.Response.Header.Set("Cache-Control", "no-cache")
    c.Response.Header.Set("Connection", "keep-alive")
    c.Response.Header.Set("Transfer-Encoding", "chunked")
    c.SetStatusCode(200)

    // Hijack Writer 开启 chunked streaming
    c.Response.HijackWriter(newSSEWriter(&c.Response, c.GetWriter()))

    // 发送初始连接消息
    c.Write([]byte(": connected\n\n"))
    c.Flush()

    // 事件循环
    for {
        select {
        case <-ctx.Done():
            return
        case evt := <-eventChan:
            data, _ := json.Marshal(evt)
            fmt.Fprintf(c, "id: %s\nevent: %s\ndata: %s\n\n", evt.ID, evt.Type, data)
            c.Flush()
        }
    }
}
```

**何时使用 NewHertzHandler**：当且仅当需要 `*app.RequestContext` 的流式能力（HijackWriter / Flush），其他场景都应优先使用 `NewTypedHandler`。

---

## 5. NewHandlerWithURL — RouterURL 接口注册

**源码**：`handler.go`

使用 `RouterURL` 接口提供 name 和 path，结合 `HandlerOption` 配置。

### 函数签名

```go
type RouterURL interface {
    Name() string
    SubPath() string
}

func NewHandlerWithURL(url RouterURL, h interface{}, opts ...HandlerOption) Handler
```

### 真实示例：bootstrap

```go
type bootstrapRouterURL struct {
    name string
    url  string
}

func (u bootstrapRouterURL) Name() string    { return u.name }
func (u bootstrapRouterURL) SubPath() string { return u.url }

func (s *SubServer) Handlers() []server.Handler {
    return []server.Handler{
        server.NewHandlerWithURL(
            bootstrapRouterURL{name: "bootstrap-info", url: "/sub-bootstrap/list"},
            s.listPeerInfos,
            server.WithMethod(server.GET),
        ),
    }
}
```

### HandlerOption 选项

```go
server.WithMethod(server.POST)        // 设置 HTTP 方法
server.WithType(server.HandlerTypePS) // 设置 Handler 类型
server.WithWrappers(logIDWrapper)     // 添加中间件
```

---

## Content Negotiation（内容协商）

**源码**：`negotiator.go`、`serializer.go`

### 协商规则

| 请求 Content-Type | 请求序列化器 | 响应序列化器 |
|---|---|---|
| `application/protobuf` | ProtoSerializer | ProtoSerializer |
| `application/x-protobuf` | ProtoSerializer | ProtoSerializer |
| `application/json` | JSONSerializer | 取决于响应类型 |
| 空或其他 | JSONSerializer | 取决于响应类型 |

### 响应类型自动检测

`NewTypedHandler` 在注册时通过 `GetSerializerForType` 检测 `Resp` 类型：
- 如果 `Resp` 实现了 `proto.Message` 接口 -> `ProtoSerializer`
- 否则 -> `JSONSerializer`

当请求是 protobuf 格式时，响应也强制使用 protobuf（无论响应类型）。

### Serializer 接口

```go
type Serializer interface {
    Marshal(v interface{}) ([]byte, error)
    Unmarshal(data []byte, v interface{}) error
    ContentType() string
}
```

两个内置实现：

| Serializer | 底层库 | ContentType | 类型要求 |
|---|---|---|---|
| `JSONSerializer` | `encoding/json` | `application/json` | 任意类型 |
| `ProtoSerializer` | `google.golang.org/protobuf` | `application/protobuf` | 必须实现 `proto.Message` |

---

## 错误处理

**源码**：`errors.go`

### HandlerError 结构

```go
type HandlerError struct {
    Code    int    // HTTP 状态码
    Message string // 错误消息
    Err     error  // 原始错误（可选）
}
```

### 便捷构造函数

```go
server.BadRequest("name is required")              // 400
server.BadRequestWithCause("invalid", err)          // 400 + 原始错误
server.Unauthorized("authentication required")      // 401
server.Forbidden("not a member")                    // 403
server.NotFound("group not found")                  // 404
server.InternalError("service unavailable")         // 500
server.InternalErrorWithCause("failed", err)        // 500 + 原始错误
```

### 在 TypedHandler 中使用

直接返回 `*HandlerError` 作为 `error`，框架自动转换：

```go
func (s *subServer) handleJoin(
    ctx context.Context,
    req *chat.JoinGroupRequest,
) (*chat.JoinGroupResponse, error) {
    subject := auth.GetSubject(ctx)
    if subject == nil {
        return nil, server.Unauthorized("authentication required")
    }
    if req.GroupUlid == "" {
        return nil, server.BadRequest("group_ulid is required")
    }

    member, err := s.appService.JoinByActor(subject.ID, req.GroupUlid, req.InvitationUlid)
    if err != nil {
        if err == application.ErrInvalidInvitation {
            return nil, server.BadRequest(err.Error())
        }
        if err == application.ErrGroupNotFound {
            return nil, server.NotFound(err.Error())
        }
        return nil, server.InternalError("join group failed")
    }

    return &chat.JoinGroupResponse{Membership: toProtoMember(member)}, nil
}
```

框架对 `HandlerError` 的处理：设置 HTTP 状态码 -> 以请求相同格式序列化错误响应 `{"error":"...", "code":400}`。

---

## 认证中间件

Station 提供两套 JWT 认证适配器，对应不同 Handler 类型。

### 1. server.Wrapper 体系（用于 TypedHandler / HTTPHandler）

**初始化（在 `Init()` 中构造一次）**：

```go
func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
    provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
    s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
    return nil
}
```

也可以使用 `serverwrapper.JWT` 简写：

```go
provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
jwtWrapper := serverwrapper.JWT(provider)
```

**在 Handlers() 中注册**：

```go
func (s *subServer) Handlers() []server.Handler {
    logIDWrapper := serverwrapper.LogID()
    return []server.Handler{
        server.NewTypedHandler("my-endpoint", "/my/endpoint", server.POST,
            s.handleEndpoint, logIDWrapper, s.jwtWrapper),
    }
}
```

**在 Handler 中获取 Subject**：

```go
func (s *subServer) handleEndpoint(ctx context.Context, req *pb.MyRequest) (*pb.MyResponse, error) {
    subject := auth.GetSubject(ctx)
    if subject == nil {
        return nil, server.Unauthorized("authentication required")
    }
    actorID := subject.ID
    // ...
}
```

### 2. Hertz 原生中间件（用于 NewHertzHandler）

```go
hertzJWT := hertzadapter.RequireJWT(provider)

server.NewHertzHandler("sse", "/events/stream", server.GET,
    s.handleSSE, hertzJWT)

func (s *subServer) handleSSE(ctx context.Context, c *app.RequestContext) {
    subject := hertzadapter.GetSubject(c)  // 从 *app.RequestContext 获取
    // ...
}
```

### 关键区别

| | server.Wrapper | Hertz 原生中间件 |
|---|---|---|
| 适用 Handler | `NewTypedHandler` / `NewHTTPHandler` | `NewHertzHandler` |
| Subject 存储 | `context.Context` | `*app.RequestContext` |
| 获取方式 | `auth.GetSubject(ctx)` | `hertzadapter.GetSubject(c)` |
| HTTPHandler 中获取 | `httpadapter.GetSubject(r)` | - |

---

## 内置 Wrapper

### LogID

为每个请求生成唯一 ULID 并写入响应头 `X-Log-Id`：

```go
logIDWrapper := serverwrapper.LogID()
```

在 handler 中获取：

```go
logID := serverwrapper.GetLogID(ctx)
```

### JWT

见上方认证中间件章节。

### Wrapper 执行顺序

Wrappers 作为可变参数传入，在 Hertz Server 注册时按顺序嵌套执行：

```go
server.NewTypedHandler("name", "/path", server.POST, handler,
    logIDWrapper,  // 最外层：先执行
    jwtWrapper,    // 内层：后执行
)
```

请求处理顺序：`logIDWrapper` -> `jwtWrapper` -> `handler`

---

## Subserver Handlers() 完整模式

一个标准的 Subserver 路由注册遵循以下模式：

```go
package my_module

import (
    "context"

    coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
    httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
    serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
    "github.com/peers-labs/peers-touch/station/frame/core/server"
    pb "github.com/peers-labs/peers-touch/station/frame/touch/model/my_module"
)

type subServer struct {
    status     server.Status
    jwtWrapper server.Wrapper
    // ... 业务依赖
}

// Init 中构造 JWT Wrapper
func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
    provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
    s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
    // ... 初始化数据库、服务等
    return nil
}

// Handlers 返回路由表
func (s *subServer) Handlers() []server.Handler {
    logID := serverwrapper.LogID()
    jwt := s.jwtWrapper

    return []server.Handler{
        // 需要认证的接口
        server.NewTypedHandler("my-create", "/my-module/create", server.POST,
            s.handleCreate, logID, jwt),
        server.NewTypedHandler("my-list", "/my-module/list", server.GET,
            s.handleList, logID, jwt),

        // 公开接口（无 jwt wrapper）
        server.NewTypedHandler("my-stats", "/my-module/stats", server.GET,
            s.handleStats, logID),
    }
}

// Handler 实现
func (s *subServer) handleCreate(
    ctx context.Context,
    req *pb.CreateRequest,
) (*pb.CreateResponse, error) {
    subject := auth.GetSubject(ctx)
    if subject == nil {
        return nil, server.Unauthorized("authentication required")
    }
    if req.Name == "" {
        return nil, server.BadRequest("name is required")
    }

    // 调用应用层服务
    result, err := s.appService.Create(subject.ID, req.Name)
    if err != nil {
        return nil, server.InternalErrorWithCause("create failed", err)
    }

    return &pb.CreateResponse{Item: result}, nil
}
```

---

## 路由命名规范

| 场景 | 路径格式 | 示例 |
|---|---|---|
| Subserver 业务路由 | `/<module>/<resource>/<action>` | `/group-chat/message/send` |
| 框架级/API 路由 | `/api/v1/<module>/<action>` | `/api/v1/relay/invite` |
| Handler name | `<module-abbr>-<action>` | `gc-create`、`fc-message-send` |

Subserver 路由不要加 `/api/` 前缀，由主服务统一管理路由挂载。

---

## 选型决策树

```
需要编写新 Handler
    |
    v
是否需要流式响应（SSE / WebSocket）？
    |-- 是 --> NewHertzHandler + Hertz 原生中间件
    |-- 否 --> 继续
        |
        v
    是否需要操作原始 http.ResponseWriter？
    （文件上传 / multipart / 自定义 Content-Type）
        |-- 是 --> NewHTTPHandler + HTTPHandlerFunc
        |-- 否 --> 继续
            |
            v
        有明确的 Req/Resp 类型（Proto 或 JSON struct）？
            |-- 是 --> NewTypedHandler（推荐）
            |-- 否 --> NewSimpleHandler
```
