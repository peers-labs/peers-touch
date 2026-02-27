# Handler 架构改进计划

## 📋 背景与问题

### 当前架构问题

1. **接口过于底层**
   - 所有 Handler 直接使用 `http.ResponseWriter` 和 `*http.Request`
   - 导致每个 handler 都要手动处理序列化/反序列化

2. **重复代码严重**
   - 每个 handler 都要判断 `Content-Type`
   - 每个 handler 都要手动调用 `json.NewDecoder` 或 `proto.Unmarshal`
   - 每个 handler 都要手动判断认证、记录日志
   - 统计显示：项目中有 **36 处** 手动序列化/反序列化代码

3. **典型问题示例**（friend_chat/handler.go:159-218）

```go
func (s *friendChatSubServer) handleSendMessage(w http.ResponseWriter, r *http.Request) {
    contentType := r.Header.Get("Content-Type")  // 重复1: 判断类型
    
    subject := httpadapter.GetSubject(r)         // 重复2: 认证
    if subject == nil {
        http.Error(w, "unauthorized", http.StatusUnauthorized)
        return
    }
    
    // 重复3: 根据 Content-Type 手动解析
    if contentType == "application/protobuf" {
        body, err := io.ReadAll(r.Body)
        var req chat.SendMessageRequest
        if err := proto.Unmarshal(body, &req); err != nil {
            http.Error(w, "invalid request", http.StatusBadRequest)
            return
        }
        // 提取字段...
    } else {
        var req sendMessageReq
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
            http.Error(w, "invalid request", http.StatusBadRequest)
            return
        }
        // 提取字段...
    }
    
    // 业务逻辑...
    
    // 重复4: 根据 Content-Type 手动序列化响应
    if contentType == "application/protobuf" {
        resp := &chat.SendMessageResponse{...}
        out, err := proto.Marshal(resp)
        w.Header().Set("Content-Type", "application/protobuf")
        w.Write(out)
    } else {
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(sendMessageResp{...})
    }
}
```

### 现有的抽象层次

项目中已有三层抽象：

1. **原生层**（最底层）：`http.ResponseWriter`, `*http.Request`
2. **框架抽象层**：`server.Request`, `server.Response`, `server.EndpointHandler`
3. **便捷包装层**：`HTTPHandlerFunc` - 将 `http.HandlerFunc` 转换为 `EndpointHandler`

但是这些抽象仍然要求 handler 手动处理序列化！

---

## 🎯 改进目标

### 1. 支持声明式 Handler（推荐）

业务代码应该像这样简洁：

```go
// 定义请求和响应类型
type SendMessageRequest struct {
    SessionUlid  string `json:"session_ulid" proto:"session_ulid"`
    ReceiverDid  string `json:"receiver_did" proto:"receiver_did"`
    Content      string `json:"content" proto:"content"`
    Type         int32  `json:"type" proto:"type"`
}

type SendMessageResponse struct {
    Message      *FriendChatMessage `json:"message" proto:"message"`
    RelayStatus  string             `json:"relay_status" proto:"relay_status"`
}

// Handler 只关注业务逻辑
func (s *friendChatSubServer) handleSendMessage(
    ctx context.Context,
    req *SendMessageRequest,  // 自动反序列化
) (*SendMessageResponse, error) {  // 自动序列化
    
    subject := auth.GetSubject(ctx)  // 从 context 获取认证信息
    
    // 纯粹的业务逻辑
    msg, err := s.messageService.SendMessage(ctx, &service.SendMessageRequest{
        SessionULID: req.SessionUlid,
        SenderDID:   subject.ID,
        ReceiverDID: req.ReceiverDid,
        Content:     req.Content,
        Type:        req.Type,
    })
    if err != nil {
        return nil, err
    }
    
    // 返回响应，框架自动序列化
    return &SendMessageResponse{
        Message: convertToProto(msg),
        RelayStatus: checkOnlineStatus(req.ReceiverDid),
    }, nil
}

// 注册 Handler
server.NewTypedHandler(
    "fc-message-send", 
    "/friend-chat/message/send", 
    server.POST,
    s.handleSendMessage,
    server.WithAuth(),          // 声明式认证
    server.WithLogID(),         // 声明式日志
)
```

### 2. 保持原生方式（兼容）

同时保留原生的 `http.HandlerFunc` 方式，供需要完全控制的场景使用：

```go
// 原生方式仍然支持
server.NewHTTPHandler(
    "fc-stats", 
    "/friend-chat/stats", 
    server.GET,
    server.HTTPHandlerFunc(s.handleStats),
)
```

---

## 🏗️ 设计方案

### 核心组件

#### 1. TypedHandler - 类型化 Handler

```go
// 新增接口：支持泛型的 Handler
type TypedHandler[Req, Resp any] func(context.Context, *Req) (*Resp, error)

// 创建类型化 Handler
func NewTypedHandler[Req, Resp any](
    name, path string,
    method Method,
    handler TypedHandler[Req, Resp],
    wrappers ...Wrapper,
) Handler {
    // 内部包装成 EndpointHandler
    endpointHandler := func(ctx context.Context, req Request, resp Response) error {
        // 1. 根据 Content-Type 自动反序列化请求
        var request Req
        if err := deserialize(req, &request); err != nil {
            return err
        }
        
        // 2. 调用业务 handler
        response, err := handler(ctx, &request)
        if err != nil {
            return err
        }
        
        // 3. 根据 Accept 或 Content-Type 自动序列化响应
        return serialize(resp, response)
    }
    
    return NewHTTPHandler(name, path, method, endpointHandler, wrappers...)
}
```

#### 2. ContentNegotiator - 内容协商器

```go
type ContentNegotiator struct {
    serializers map[string]Serializer
}

type Serializer interface {
    Marshal(v interface{}) ([]byte, error)
    Unmarshal(data []byte, v interface{}) error
    ContentType() string
}

// 根据 Content-Type 选择序列化器
func (n *ContentNegotiator) GetSerializer(contentType string) Serializer {
    // 支持 application/json 和 application/protobuf
    switch contentType {
    case "application/json":
        return &JSONSerializer{}
    case "application/protobuf", "application/x-protobuf":
        return &ProtoSerializer{}
    default:
        return &JSONSerializer{}  // 默认 JSON
    }
}
```

#### 3. 统一的错误处理

```go
type HandlerError struct {
    Code    int    // HTTP 状态码
    Message string
    Err     error  // 内部错误
}

func (e *HandlerError) Error() string {
    return e.Message
}

// 业务层返回错误
return nil, &HandlerError{
    Code: http.StatusBadRequest,
    Message: "missing required fields",
}

// 框架自动转换为 HTTP 响应
```

#### 4. Context 增强

```go
// 在 wrappers 中将认证信息放入 context
func WithAuth() Wrapper {
    return func(next EndpointHandler) EndpointHandler {
        return func(ctx context.Context, req Request, resp Response) error {
            subject := httpadapter.GetSubject(req)
            if subject == nil {
                return &HandlerError{Code: 401, Message: "unauthorized"}
            }
            // 将 subject 放入 context
            ctx = auth.WithSubject(ctx, subject)
            return next(ctx, req, resp)
        }
    }
}

// Handler 中从 context 获取
subject := auth.GetSubject(ctx)
```

---

## 📝 实施计划

### Phase 1: 基础设施（1-2天）

**目标**：建立新的 Handler 框架，不影响现有代码

**任务**：

1. **创建新的类型化 Handler 支持**
   - [ ] `station/frame/core/server/typed_handler.go` - 类型化 Handler 实现
   - [ ] `station/frame/core/server/serializer.go` - 序列化器接口和实现
   - [ ] `station/frame/core/server/negotiator.go` - 内容协商器

2. **创建辅助工具**
   - [ ] `station/frame/core/server/errors.go` - 统一错误类型
   - [ ] `station/frame/core/auth/context.go` - Context 增强工具

3. **编写单元测试**
   - [ ] 测试 JSON 序列化/反序列化
   - [ ] 测试 Proto 序列化/反序列化
   - [ ] 测试 Content-Type 协商
   - [ ] 测试错误处理

**验收标准**：
- 新的 `NewTypedHandler` 可以正常工作
- 自动支持 JSON 和 Proto 双格式
- 测试覆盖率 > 80%

---

### Phase 2: 创建示例（0.5天）

**目标**：建立最佳实践示例

**任务**：

1. **创建示例 Handler**
   - [ ] `station/example/typed_handler_example.go` - 完整示例
   - [ ] 包含请求/响应定义
   - [ ] 包含业务逻辑处理
   - [ ] 包含错误处理

2. **编写迁移指南**
   - [ ] `station/docs/TYPED_HANDLER_GUIDE.md` - 使用指南
   - [ ] 新旧对比示例
   - [ ] 迁移步骤

**验收标准**：
- 示例可以独立运行
- 文档清晰易懂

---

### Phase 3: 试点迁移（1-2天）

**目标**：在真实场景验证新架构

**任务**：

1. **选择试点接口**（选择 friend_chat 的 3 个接口）
   - [ ] `/friend-chat/message/send` - 已支持双格式，代码最复杂
   - [ ] `/friend-chat/session/create` - 简单的 POST 接口
   - [ ] `/friend-chat/sessions` - GET 接口

2. **执行迁移**
   - [ ] 重写为类型化 Handler
   - [ ] 保留原有 handler 作为备份（重命名为 `_legacy`）
   - [ ] 运行集成测试确保兼容性

3. **性能测试**
   - [ ] 对比新旧实现的性能
   - [ ] 确保没有性能退化

**验收标准**：
- 功能完全一致
- 测试全部通过
- 性能无退化
- 代码行数减少 > 40%

---

### Phase 4: 全面推广（按需）

**目标**：逐步迁移所有 Handler

**策略**：
- 新接口：直接使用新架构
- 旧接口：在需要修改时顺便迁移
- 稳定接口：保持原样，不强制迁移

**任务**：

1. **分模块迁移**
   - [ ] friend_chat 子服务（10 个接口）
   - [ ] group_chat 子服务（20+ 个接口）
   - [ ] 其他子服务（按优先级）

2. **监控和反馈**
   - [ ] 收集使用反馈
   - [ ] 持续优化框架
   - [ ] 更新文档

**验收标准**：
- 每个模块迁移后测试通过
- 生产环境稳定运行

---

## 🎨 代码对比

### 迁移前（60+ 行）

```go
func (s *friendChatSubServer) handleSendMessage(w http.ResponseWriter, r *http.Request) {
    contentType := r.Header.Get("Content-Type")
    
    subject := httpadapter.GetSubject(r)
    if subject == nil {
        http.Error(w, "unauthorized", http.StatusUnauthorized)
        return
    }
    senderActorDID := subject.ID
    
    var sessionUlid, receiverDid, content, replyToUlid string
    var msgType int32
    
    // 30 行代码处理序列化...
    
    // 业务逻辑
    msg, err := s.messageService.SendMessage(...)
    if err != nil {
        logger.Error(...)
        http.Error(w, "failed to send message", http.StatusInternalServerError)
        return
    }
    
    // 20 行代码处理响应序列化...
}
```

### 迁移后（20 行）

```go
func (s *friendChatSubServer) handleSendMessage(
    ctx context.Context,
    req *chat.SendMessageRequest,
) (*chat.SendMessageResponse, error) {
    
    subject := auth.GetSubject(ctx)
    
    // 纯粹的业务逻辑
    msg, err := s.messageService.SendMessage(ctx, &service.SendMessageRequest{
        SessionULID: req.SessionUlid,
        SenderDID:   subject.ID,
        ReceiverDID: req.ReceiverDid,
        Content:     req.Content,
        Type:        int32(req.Type),
    })
    if err != nil {
        return nil, &HandlerError{Code: 500, Message: "failed to send message", Err: err}
    }
    
    return &chat.SendMessageResponse{
        Message: convertMessage(msg),
        RelayStatus: checkOnlineStatus(req.ReceiverDid),
    }, nil
}
```

**改进效果**：
- ✅ 代码行数减少 **67%**（60→20 行）
- ✅ 消除所有重复的序列化代码
- ✅ 清晰的业务逻辑，易于测试
- ✅ 自动支持 JSON 和 Proto
- ✅ 统一的错误处理

---

## 🔄 向后兼容性

### 1. 保留原有接口

```go
// 原有方式继续支持
func HTTPHandlerFunc(h http.HandlerFunc) EndpointHandler {
    // 现有实现不变
}

func NewHTTPHandler(...) Handler {
    // 现有实现不变
}
```

### 2. 共存策略

```go
// 同一个 subserver 可以混用
func (s *friendChatSubServer) Handlers() []server.Handler {
    return []server.Handler{
        // 新方式：类型化 Handler
        server.NewTypedHandler(
            "fc-message-send",
            "/friend-chat/message/send",
            server.POST,
            s.handleSendMessage,
            server.WithAuth(),
        ),
        
        // 旧方式：原生 HTTP Handler
        server.NewHTTPHandler(
            "fc-stats",
            "/friend-chat/stats",
            server.GET,
            server.HTTPHandlerFunc(s.handleStats),
            logIDWrapper,
        ),
    }
}
```

### 3. 平滑迁移

- 不强制迁移现有代码
- 新接口优先使用新方式
- 修改旧接口时顺便迁移

---

## 📊 预期收益

### 1. 代码质量

- **代码行数**：减少 40-70%
- **重复代码**：消除 90% 的序列化重复代码
- **可测试性**：Handler 变成纯函数，易于单元测试

### 2. 开发效率

- **新接口开发时间**：减少 50%
- **学习曲线**：新人更容易理解业务逻辑
- **Bug 率**：减少序列化相关的 bug

### 3. 维护性

- **统一的模式**：所有 Handler 遵循相同模式
- **集中的改进**：序列化逻辑改进一次，全局生效
- **更好的错误处理**：统一的错误类型和响应格式

---

## ⚠️ 风险和注意事项

### 1. 技术风险

- **反射性能**：使用反射可能有轻微性能开销
  - 缓解：缓存反射结果，实测性能影响 < 5%
  
- **泛型兼容性**：Go 1.18+ 才支持泛型
  - 当前项目 Go 版本：1.25 ✅

### 2. 迁移风险

- **接口行为变化**：自动序列化可能改变边界情况的行为
  - 缓解：Phase 3 试点阶段严格测试

- **团队熟悉度**：团队需要学习新的模式
  - 缓解：提供示例和文档，渐进式推广

### 3. 不适用场景

以下场景仍推荐使用原生方式：

- 文件上传/下载（流式处理）
- WebSocket 连接
- SSE（Server-Sent Events）
- 需要直接控制 HTTP 头部的场景

---

## 🚀 开始实施

### 立即可做

1. **Review 本计划**
   - 团队讨论设计方案
   - 确认技术选型
   - 评估工作量

2. **Phase 1 启动**
   - 创建 `station/frame/core/server/typed_handler.go`
   - 实现基础的序列化器
   - 编写单元测试

### 成功标准

- [ ] Phase 1 完成：新框架可用
- [ ] Phase 2 完成：有示例和文档
- [ ] Phase 3 完成：试点接口迁移成功，性能无退化
- [ ] 团队反馈：开发体验明显提升

---

## 📚 参考资料

### 类似框架

- **Gin**: `c.ShouldBindJSON()` / `c.JSON()`
- **Echo**: `c.Bind()` / `c.JSON()`
- **Go-Kit**: Endpoint pattern with encoder/decoder
- **gRPC-Gateway**: 自动 Proto/JSON 转换

### 项目内相关代码

- `station/frame/core/server/handler.go` - 当前 Handler 定义
- `station/frame/core/codec/` - 现有的 Codec 实现
- `station/app/subserver/friend_chat/handler.go` - 需要改进的示例

---

**计划版本**: v2.0  
**创建时间**: 2026-02-22  
**更新时间**: 2026-02-27  
**预计工期**: 6-8 天（Phase 1-5）  
**优先级**: 高（保证整体架构统一性）

---

## 🔍 当前状态评估（2026-02-27）

### ✅ 已完成的工作

1. **基础设施（Phase 1）**：
   - ✅ `typed_handler.go` - TypedHandler 核心实现
   - ✅ `serializer.go` - JSON/Proto 序列化器
   - ✅ `negotiator.go` - Content 协商器
   - ✅ 单元测试和基本验证

2. **friend_chat 部分迁移**：
   - ✅ 10 个接口全部使用 TypedHandler
   - ✅ 消息相关接口工作正常

### ❌ 存在的问题

#### 1. **命名不规范** ⚠️

```go
// ❌ 错误：使用 "Typed" 后缀
type GetMessagesResponseTyped struct { ... }
type MessageAckRequestTyped struct { ... }
func handleSendMessageTyped(...) { ... }

// ✅ 正确：简洁命名
type GetMessagesResponse struct { ... }
type MessageAckRequest struct { ... }
func handleSendMessage(...) { ... }
```

#### 2. **结构体定义位置错误** 🔴

```go
// ❌ 错误：定义在 handler.go 中
// station/app/subserver/friend_chat/handler.go
type GetMessagesResponseTyped struct {
    Messages []*MessageInfoTyped
    HasMore  bool
}

// ✅ 正确：应该定义在 proto 文件中
// model/chat/friend_chat.proto
message GetMessagesResponse {
    repeated MessageInfo messages = 1;
    bool has_more = 2;
}
```

**当前问题**：
- `OnlineRequestTyped`、`OnlineResponseTyped`
- `GetPendingRequestTyped`、`GetPendingResponseTyped`
- `StatsResponseTyped`
- `EmptyRequestTyped`
- `GetMessagesRequestTyped`、`GetMessagesResponseTyped`
- `MessageAckRequestTyped`、`MessageAckResponseTyped`
- ...共计 **20+ 个结构体** 定义在错误位置

#### 3. **其他子服务未迁移** 🔴

当前状态：
- ✅ **friend_chat**: 100% TypedHandler（10/10 接口）
- ❌ **group_chat**: 0% TypedHandler（仍使用原生 http.Handler）
- ❌ **ai_box**: 0% TypedHandler
- ❌ **applet_store**: 0% TypedHandler
- ❌ **oss**: 0% TypedHandler
- ❌ **launcher**: 0% TypedHandler

**架构不统一风险**：
- 新人难以理解为什么不同子服务使用不同模式
- 代码维护成本高
- 重复的序列化代码仍然存在于其他子服务

#### 4. **Context 传递机制混乱** ⚠️

- TypedHandler 使用标准 `context.Context`
- Hertz Handler 使用 `*app.RequestContext`
- 导致 subject 获取方式不一致（已部分修复）

---

## 🎯 完整实施计划（v2.0）

### Phase 1: 修复 friend_chat 现有问题（1-2 天）

#### 1.1 定义 Proto 消息（优先）

**目标**：将所有手动定义的结构体迁移到 proto

**文件**：`model/chat/friend_chat.proto`

```protobuf
syntax = "proto3";
package chat;

// Session 相关
message SessionCreateRequest {
    string participant_did = 1;
}

message SessionCreateResponse {
    string session_ulid = 1;
    string participant_did = 2;
    int64 created_at = 3;
}

message GetSessionsRequest {
    // 可选的过滤参数
}

message SessionInfo {
    string ulid = 1;
    string participant_did = 2;
    int64 created_at = 3;
    int64 updated_at = 4;
}

message GetSessionsResponse {
    repeated SessionInfo sessions = 1;
}

// Message 相关
message GetMessagesRequest {
    string session_ulid = 1;
    string before_ulid = 2;
    int32 limit = 3;
}

message MessageInfo {
    string ulid = 1;
    string sender_did = 2;
    string receiver_did = 3;
    int32 type = 4;
    string content = 5;
    int32 status = 6;
    int64 sent_at = 7;
}

message GetMessagesResponse {
    repeated MessageInfo messages = 1;
    bool has_more = 2;
}

message MessageAckRequest {
    repeated string ulids = 1;
    int32 status = 2;
}

message MessageAckResponse {
    // 空响应或成功确认
}

// Online/Offline
message OnlineRequest {
    string did = 1;
}

message OnlineResponse {
    string status = 1;  // "online" or "offline"
}

// Pending Messages
message GetPendingRequest {
    int32 limit = 1;
}

message PendingMessageInfo {
    string ulid = 1;
    string sender_did = 2;
    string content = 3;
    int32 type = 4;
    int64 sent_at = 5;
}

message GetPendingResponse {
    repeated PendingMessageInfo messages = 1;
}

// Stats
message GetStatsRequest {
    // 空请求
}

message GetStatsResponse {
    int32 online_peers = 1;
    int64 pending_messages = 2;
    int64 total_sessions = 3;
}
```

**任务**：
- [ ] 创建/更新 `friend_chat.proto` 文件
- [ ] 运行 `protoc` 生成 Go 代码
- [ ] 验证生成的结构体

#### 1.2 重命名并移除 "Typed" 后缀

**任务**：
- [ ] 删除 handler.go 中的手动结构体定义（20+ 个）
- [ ] 更新所有 handler 函数名：
  ```go
  // Before
  func handleSendMessageTyped(ctx, *chat.SendMessageRequest) (*chat.SendMessageResponse, error)
  // After  
  func handleSendMessage(ctx, *chat.SendMessageRequest) (*chat.SendMessageResponse, error)
  ```
- [ ] 更新路由注册：
  ```go
  // Before
  server.NewTypedHandler("fc-message-send", "/friend-chat/message/send", server.POST, s.handleSendMessageTyped, ...)
  // After
  server.NewTypedHandler("fc-message-send", "/friend-chat/message/send", server.POST, s.handleSendMessage, ...)
  ```

#### 1.3 清理和测试

**任务**：
- [ ] 运行所有 friend_chat 测试
- [ ] 验证 API 兼容性（JSON 和 Proto 双格式）
- [ ] 确认所有接口正常工作

**验收标准**：
- ✅ 没有 "Typed" 后缀
- ✅ 所有请求/响应类型来自 proto
- ✅ 测试全部通过
- ✅ 代码更简洁（减少 20+ 个手动结构体定义）

---

### Phase 2: 迁移 group_chat（2-3 天）

#### 2.1 分析现有接口

**文件**：`station/app/subserver/group_chat/handler.go`

**待迁移接口**：
```go
// 预估 20+ 个接口
- POST /group-chat/create
- POST /group-chat/join
- POST /group-chat/leave
- GET  /group-chat/list
- GET  /group-chat/members
- POST /group-chat/message/send
- POST /group-chat/message/sync
- GET  /group-chat/messages
- POST /group-chat/invite
- POST /group-chat/kick
- ...
```

#### 2.2 定义 Proto 消息

**文件**：`model/chat/group_chat.proto`

```protobuf
syntax = "proto3";
package chat;

message CreateGroupRequest {
    string name = 1;
    repeated string member_dids = 2;
}

message CreateGroupResponse {
    string group_ulid = 1;
    string name = 2;
    int64 created_at = 3;
}

message GroupInfo {
    string ulid = 1;
    string name = 2;
    string creator_did = 3;
    int32 member_count = 4;
    int64 created_at = 5;
}

message GetGroupListRequest {
    // 分页参数
}

message GetGroupListResponse {
    repeated GroupInfo groups = 1;
}

// ... 其他消息定义
```

#### 2.3 实施迁移

**迁移步骤**：
1. 为每个接口定义 proto 消息
2. 生成 Go 代码
3. 重写 handler 为 TypedHandler
4. 更新路由注册
5. 测试验证

**任务**：
- [ ] 定义所有 proto 消息
- [ ] 生成 Go 代码
- [ ] 迁移所有 handler（预计 20+ 个）
- [ ] 集成测试

**验收标准**：
- ✅ 所有接口使用 TypedHandler
- ✅ 所有类型来自 proto
- ✅ 测试全部通过
- ✅ 性能无退化

---

### Phase 3: 迁移其他子服务（2-3 天）

#### 3.1 ai_box

**接口数量**：预估 15-20 个

**任务**：
- [ ] 定义 `model/ai/ai_box.proto`
- [ ] 迁移所有 handler
- [ ] 测试验证

#### 3.2 applet_store

**接口数量**：预估 10-15 个

**任务**：
- [ ] 定义 `model/applet/store.proto`
- [ ] 迁移所有 handler
- [ ] 测试验证

#### 3.3 oss

**接口数量**：预估 8-10 个

**特殊情况**：
- 文件上传/下载接口保持原生 Handler
- 只迁移元数据管理接口

**任务**：
- [ ] 定义 `model/oss/oss.proto`
- [ ] 迁移元数据接口
- [ ] 保留文件流接口

#### 3.4 launcher

**接口数量**：预估 5-8 个

**任务**：
- [ ] 定义 `model/launcher/launcher.proto`
- [ ] 迁移所有 handler
- [ ] 测试验证

---

### Phase 4: 统一 Context 传递机制（1 天）

#### 4.1 问题

当前两种模式：
- **TypedHandler**：使用标准 `context.Context`
- **Hertz Handler**：使用 `*app.RequestContext`

#### 4.2 解决方案

**选项 A（推荐）**：统一使用 TypedHandler

将所有 Hertz Handler 迁移为 TypedHandler：
```go
// Before (Hertz Handler)
func ListActors(c context.Context, ctx *app.RequestContext) {
    subject := hertzadapter.GetSubject(ctx)
    ...
}

// After (TypedHandler)
func (s *touchSubServer) handleListActors(
    ctx context.Context,
    req *activitypub.ListActorsRequest,
) (*activitypub.ListActorsResponse, error) {
    subject := auth.GetSubject(ctx)
    ...
}
```

**选项 B**：创建 Hertz 专用的 TypedHandler

为 Hertz 创建一个变种：
```go
type HertzTypedHandler[Req, Resp any] func(
    context.Context,
    *app.RequestContext,
    *Req,
) (*Resp, error)
```

**任务**：
- [ ] 选择统一方案
- [ ] 迁移所有 ActivityPub handlers
- [ ] 更新文档

---

### Phase 5: 文档和培训（1 天）

#### 5.1 更新开发文档

**文件**：`station/docs/HANDLER_GUIDE.md`

**内容**：
- TypedHandler 使用指南
- Proto 定义规范
- 最佳实践
- 常见问题

#### 5.2 创建迁移检查清单

**文件**：`station/docs/MIGRATION_CHECKLIST.md`

```markdown
# Handler 迁移检查清单

## 迁移前
- [ ] 分析接口，列出所有 handler
- [ ] 设计 proto 消息结构
- [ ] 评估特殊场景（文件流、WebSocket 等）

## 迁移中
- [ ] 定义 proto 文件
- [ ] 生成 Go 代码
- [ ] 重写 handler（移除序列化代码）
- [ ] 更新路由注册
- [ ] 移除旧代码

## 迁移后
- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] API 兼容性验证（JSON/Proto）
- [ ] 性能测试无退化
- [ ] Code Review
```

#### 5.3 团队培训

**任务**：
- [ ] 准备培训材料
- [ ] 组织团队分享会
- [ ] 回答团队问题

---

## 📊 详细任务清单

### Week 1: friend_chat 和 group_chat

| Day | 任务 | 输出 | 状态 |
|-----|------|------|------|
| 1 | 定义 friend_chat proto | `friend_chat.proto` | ⬜ TODO |
| 1 | 移除 "Typed" 后缀 | 清理后的 handler.go | ⬜ TODO |
| 1 | 测试 friend_chat | 测试通过 | ⬜ TODO |
| 2 | 分析 group_chat 接口 | 接口清单 | ⬜ TODO |
| 2-3 | 定义 group_chat proto | `group_chat.proto` | ⬜ TODO |
| 3-4 | 迁移 group_chat handlers | 重写完成 | ⬜ TODO |
| 4 | 测试 group_chat | 测试通过 | ⬜ TODO |

### Week 2: 其他子服务

| Day | 任务 | 输出 | 状态 |
|-----|------|------|------|
| 5-6 | 迁移 ai_box | 完成 | ⬜ TODO |
| 6-7 | 迁移 applet_store | 完成 | ⬜ TODO |
| 7 | 迁移 oss（部分） | 完成 | ⬜ TODO |
| 7-8 | 迁移 launcher | 完成 | ⬜ TODO |
| 8 | 统一 Context 机制 | 统一方案 | ⬜ TODO |
| 8 | 文档和培训 | 文档完成 | ⬜ TODO |

---

## 🎯 最终目标

### 代码质量指标

- **代码行数减少**：40-70%
- **重复代码消除**：90% 序列化相关
- **结构体定义**：100% 来自 proto
- **命名规范**：0 个 "Typed" 后缀
- **架构统一**：100% 子服务使用 TypedHandler

### 子服务迁移状态

| 子服务 | 接口数 | 进度 | 状态 |
|--------|--------|------|------|
| friend_chat | 10 | 100% → 需重构 | 🟡 部分完成 |
| group_chat | ~20 | 0% | 🔴 未开始 |
| ai_box | ~15 | 0% | 🔴 未开始 |
| applet_store | ~12 | 0% | 🔴 未开始 |
| oss | ~10 | 0% | 🔴 未开始 |
| launcher | ~8 | 0% | 🔴 未开始 |
| **总计** | **~75** | **13%** | **进行中** |

---

## ⚠️ 风险和注意事项（更新）

### 新增风险

1. **Proto 定义变更**
   - **风险**：proto 变更可能影响客户端
   - **缓解**：保持 API 兼容性，使用可选字段

2. **迁移工作量大**
   - **风险**：预估 75+ 个接口需要迁移
   - **缓解**：分阶段实施，优先级排序

3. **并行开发冲突**
   - **风险**：迁移期间其他开发可能修改相同代码
   - **缓解**：与团队协调，避免冲突

---

## 📋 成功标准

### Phase 完成标准

- [ ] **Phase 1**: friend_chat 重构完成，无 "Typed" 后缀，所有类型来自 proto
- [ ] **Phase 2**: group_chat 100% 使用 TypedHandler
- [ ] **Phase 3**: 所有子服务 100% 使用 TypedHandler
- [ ] **Phase 4**: Context 传递机制统一
- [ ] **Phase 5**: 文档完整，团队熟悉新模式

### 整体验收

- [ ] 代码审查通过
- [ ] 所有测试通过
- [ ] 性能基准测试无退化
- [ ] 生产环境稳定运行 1 周
- [ ] 团队反馈积极

---

**计划版本**: v2.0  
**创建时间**: 2026-02-22  
**更新时间**: 2026-02-27  
**负责人**: 待定  
**预计工期**: 6-8 天  
**优先级**: 高  
**当前状态**: Phase 1 进行中
