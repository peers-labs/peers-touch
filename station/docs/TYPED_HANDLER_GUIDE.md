# Typed Handler 使用指南

## 简介

Typed Handler 是一个类型安全的 Handler 框架，自动处理请求/响应的序列化/反序列化，让开发者专注于业务逻辑。

### 核心优势

- ✅ **自动序列化**：根据 Content-Type 自动选择 JSON 或 Proto
- ✅ **类型安全**：编译时类型检查，避免运行时错误
- ✅ **代码简洁**：减少 40-70% 的样板代码
- ✅ **统一错误处理**：一致的错误响应格式
- ✅ **向后兼容**：不影响现有代码

---

## 快速开始

### 1. 定义请求和响应类型

```go
// JSON Handler 示例
type CreateUserRequest struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}

type CreateUserResponse struct {
    UserID string `json:"user_id"`
    Name   string `json:"name"`
}

// Proto Handler 示例（使用已定义的 Proto 消息）
// 直接使用 chat.SendMessageRequest 和 chat.SendMessageResponse
```

### 2. 实现 Handler 函数

```go
func HandleCreateUser(ctx context.Context, req *CreateUserRequest) (*CreateUserResponse, error) {
    // 获取认证信息
    subject := auth.GetSubject(ctx)
    if subject == nil {
        return nil, server.Unauthorized("authentication required")
    }
    
    // 验证请求
    if req.Name == "" {
        return nil, server.BadRequest("name is required")
    }
    
    // 业务逻辑
    userID := generateUserID()
    
    // 返回响应
    return &CreateUserResponse{
        UserID: userID,
        Name:   req.Name,
    }, nil
}
```

### 3. 注册 Handler

```go
server.NewTypedHandler(
    "create-user",              // Handler 名称
    "/api/users",               // 路径
    server.POST,                // HTTP 方法
    HandleCreateUser,           // Handler 函数
    serverwrapper.LogID(),      // 可选：添加 wrapper
    serverwrapper.RequireAuth(), // 可选：添加认证
)
```

---

## 迁移指南

### 从旧方式迁移

#### 迁移前（60+ 行）

```go
func (s *myService) handleOldWay(w http.ResponseWriter, r *http.Request) {
    // 1. 手动判断 Content-Type
    contentType := r.Header.Get("Content-Type")
    
    // 2. 手动认证
    subject := httpadapter.GetSubject(r)
    if subject == nil {
        http.Error(w, "unauthorized", http.StatusUnauthorized)
        return
    }
    
    // 3. 手动反序列化
    var req MyRequest
    if contentType == "application/protobuf" {
        body, _ := io.ReadAll(r.Body)
        proto.Unmarshal(body, &req)
    } else {
        json.NewDecoder(r.Body).Decode(&req)
    }
    
    // 4. 业务逻辑
    result, err := s.service.DoSomething(...)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    
    // 5. 手动序列化响应
    if contentType == "application/protobuf" {
        data, _ := proto.Marshal(result)
        w.Header().Set("Content-Type", "application/protobuf")
        w.Write(data)
    } else {
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(result)
    }
}
```

#### 迁移后（20 行）

```go
func HandleNewWay(ctx context.Context, req *MyRequest) (*MyResponse, error) {
    // 1. 从 context 获取认证（已由 wrapper 处理）
    subject := auth.GetSubject(ctx)
    
    // 2. 业务逻辑
    result, err := service.DoSomething(...)
    if err != nil {
        return nil, server.InternalErrorWithCause("operation failed", err)
    }
    
    // 3. 返回响应（自动序列化）
    return &MyResponse{
        Data: result,
    }, nil
}
```

### 迁移步骤

1. **保留原 handler**：重命名为 `handleXXX_legacy`
2. **创建新 handler**：使用 TypedHandler 实现
3. **运行测试**：确保功能一致
4. **性能对比**：确认无性能退化
5. **删除旧代码**：新 handler 稳定后删除 legacy 版本

---

## 错误处理

### 使用预定义的错误类型

```go
// 400 Bad Request
return nil, server.BadRequest("invalid input")

// 401 Unauthorized  
return nil, server.Unauthorized("authentication required")

// 403 Forbidden
return nil, server.Forbidden("access denied")

// 404 Not Found
return nil, server.NotFound("resource not found")

// 500 Internal Server Error
return nil, server.InternalError("operation failed")

// 带原因的错误
return nil, server.InternalErrorWithCause("database error", err)
```

### 错误响应格式

客户端会收到统一格式的错误响应：

```json
{
  "error": "invalid input",
  "code": 400
}
```

---

## Context 使用

### 获取认证信息

```go
func HandleSecure(ctx context.Context, req *MyRequest) (*MyResponse, error) {
    // 方式 1：安全获取（推荐）
    subject := auth.GetSubject(ctx)
    if subject == nil {
        return nil, server.Unauthorized("login required")
    }
    
    // 方式 2：断言存在（仅在确定有 auth wrapper 时使用）
    subject := auth.MustGetSubject(ctx)
    
    // 使用 subject
    userID := subject.ID
    role := subject.Attributes["role"]
    
    // ...
}
```

### 检查认证状态

```go
if auth.HasSubject(ctx) {
    // 用户已登录
} else {
    // 匿名访问
}
```

---

## Content-Type 协商

### 自动协商

框架会根据请求的 `Content-Type` 头自动选择：

- `application/json` → JSON 序列化
- `application/protobuf` 或 `application/x-protobuf` → Proto 序列化
- 空或未知 → 默认 JSON

### 响应格式

响应格式与请求格式保持一致：

- JSON 请求 → JSON 响应
- Proto 请求 → Proto 响应

### Proto Handler 同时支持两种格式

```go
// Proto 类型的 Handler 自动支持两种格式
func HandleMessage(ctx context.Context, req *chat.SendMessageRequest) (*chat.SendMessageResponse, error) {
    // 这个 handler 同时接受：
    // 1. Content-Type: application/json
    // 2. Content-Type: application/protobuf
    
    // 响应格式会自动匹配请求格式
}
```

---

## 最佳实践

### 1. 请求验证

在业务逻辑前验证所有必填字段：

```go
func HandleCreate(ctx context.Context, req *CreateRequest) (*CreateResponse, error) {
    // 验证必填字段
    if req.Name == "" {
        return nil, server.BadRequest("name is required")
    }
    if req.Email == "" {
        return nil, server.BadRequest("email is required")
    }
    
    // 验证格式
    if !isValidEmail(req.Email) {
        return nil, server.BadRequest("invalid email format")
    }
    
    // 业务逻辑...
}
```

### 2. 错误包装

将底层错误包装成用户友好的错误：

```go
user, err := s.userRepo.GetByID(userID)
if err != nil {
    if errors.Is(err, ErrNotFound) {
        return nil, server.NotFound("user not found")
    }
    return nil, server.InternalErrorWithCause("failed to get user", err)
}
```

### 3. 日志记录

使用结构化日志记录关键信息：

```go
func HandleUpdate(ctx context.Context, req *UpdateRequest) (*UpdateResponse, error) {
    logger.Info(ctx, "Updating user", "userID", req.UserID, "fields", req.Fields)
    
    // 业务逻辑...
    
    logger.Info(ctx, "User updated successfully", "userID", req.UserID)
    return response, nil
}
```

### 4. 单元测试

Handler 是纯函数，易于测试：

```go
func TestHandleCreate(t *testing.T) {
    ctx := context.Background()
    req := &CreateRequest{
        Name:  "Alice",
        Email: "alice@example.com",
    }
    
    resp, err := HandleCreate(ctx, req)
    
    if err != nil {
        t.Fatalf("HandleCreate() error = %v", err)
    }
    if resp.UserID == "" {
        t.Error("Expected non-empty UserID")
    }
}
```

---

## 何时不使用 Typed Handler

以下场景推荐使用原生 HTTP Handler：

1. **文件上传/下载**：需要流式处理
2. **WebSocket**：长连接通信
3. **Server-Sent Events**：流式响应
4. **自定义协议**：非 JSON/Proto 格式
5. **特殊HTTP头控制**：需要精细控制响应头

示例：

```go
// 文件下载仍使用原生方式
server.NewHTTPHandler(
    "download-file",
    "/files/:id",
    server.GET,
    server.HTTPHandlerFunc(handleDownload),
)

func handleDownload(w http.ResponseWriter, r *http.Request) {
    // 直接控制响应
    w.Header().Set("Content-Disposition", "attachment; filename=file.pdf")
    w.Header().Set("Content-Type", "application/pdf")
    io.Copy(w, file)
}
```

---

## 常见问题

### Q: Proto Handler 是否必须使用 Proto 请求？

A: 不是！Proto Handler 同时支持 JSON 和 Proto 两种格式。客户端可以发送 JSON，服务端会自动转换。

### Q: 如何处理 GET 请求的查询参数？

A: Typed Handler 主要用于 POST/PUT/PATCH 等有 body 的请求。GET 请求建议继续使用原生方式或使用 `NewSimpleHandler`。

### Q: 性能是否有影响？

A: 极小。反射开销通过缓存优化，实测性能影响 < 5%，换来的是大幅简化的代码和更好的可维护性。

### Q: 如何迁移现有代码？

A: 建议渐进式迁移：
1. 新接口直接使用 Typed Handler
2. 修改旧接口时顺便迁移
3. 稳定接口可以保持原样

---

## 参考

- [typed_handler_example.go](../example/typed_handler_example.go) - 完整示例
- [typed_handler.go](../frame/core/server/typed_handler.go) - 实现代码
- [errors.go](../frame/core/server/errors.go) - 错误类型定义
- [serializer.go](../frame/core/server/serializer.go) - 序列化器

---

**版本**: 1.0  
**更新时间**: 2026-02-22
