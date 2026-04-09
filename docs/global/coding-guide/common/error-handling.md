# Peers-Touch 统一错误处理指南

本文档基于 Peers-Touch 真实代码，描述域内各应用（Station、Desktop、Mobile）的错误处理规范与实践。

---

## 1. 错误码体系（error.proto）

所有域内应用共享同一份 protobuf 错误定义，位于 `model/domain/error/error.proto`。

### 1.1 ErrorCode 枚举

错误码按数值范围划分为三大类：

| 范围 | 分类 | 说明 |
|------|------|------|
| 0-1 | 基础 | UNSPECIFIED(0), UNDEFINED(1) |
| 10000-10999 | 业务逻辑 | Actor、Peer 等领域实体相关错误 |
| 20000-20999 | 协议/请求 | 认证、参数校验、序列化等通信层错误 |
| 30000-30999 | 内容操作 | Post、Comment 等内容实体的 CRUD 错误 |

完整定义：

```protobuf
enum ErrorCode {
  ERROR_CODE_UNSPECIFIED = 0;
  ERROR_CODE_UNDEFINED = 1;

  // --- 10000s: 业务逻辑 ---
  ERROR_CODE_WELL_KNOWN_INVALID_RESOURCE_FORMAT = 10001;
  ERROR_CODE_WELL_KNOWN_UNSUPPORTED_PREFIX_TYPE = 10002;
  ERROR_CODE_ACTOR_INVALID_NAME                 = 10003;
  ERROR_CODE_ACTOR_INVALID_EMAIL                = 10004;
  ERROR_CODE_ACTOR_INVALID_PASSWORD             = 10005;
  ERROR_CODE_ACTOR_EXISTS                       = 10006;
  ERROR_CODE_ACTOR_INVALID_PASSPORT             = 10007;
  ERROR_CODE_ACTOR_NOT_FOUND                    = 10008;
  ERROR_CODE_ACTOR_INVALID_CREDENTIALS          = 10009;
  ERROR_CODE_PEER_ADDR_EXISTS                   = 10010;

  // --- 20000s: 协议/请求 ---
  ERROR_CODE_UNAUTHORIZED               = 20001;
  ERROR_CODE_INVALID_REQUEST            = 20002;
  ERROR_CODE_INVALID_QUERY_PARAMETERS   = 20003;
  ERROR_CODE_INVALID_REQUEST_BODY       = 20004;
  ERROR_CODE_INVALID_PROTOBUF           = 20005;
  ERROR_CODE_FAILED_TO_READ_BODY        = 20006;
  ERROR_CODE_METHOD_NOT_ALLOWED         = 20007;
  ERROR_CODE_INTERNAL_SERVER_ERROR      = 20008;

  // --- 30000s: 内容操作 ---
  ERROR_CODE_POST_ID_REQUIRED           = 30001;
  ERROR_CODE_POST_NOT_FOUND             = 30002;
  ERROR_CODE_USER_ID_REQUIRED           = 30003;
  ERROR_CODE_CREATE_POST_FAILED         = 30004;
  ERROR_CODE_UPDATE_POST_FAILED         = 30005;
  ERROR_CODE_DELETE_POST_FAILED         = 30006;
  ERROR_CODE_LIKE_POST_FAILED           = 30007;
  ERROR_CODE_UNLIKE_POST_FAILED         = 30008;
  ERROR_CODE_GET_POST_FAILED            = 30009;
  ERROR_CODE_LIST_POSTS_FAILED          = 30010;
  ERROR_CODE_REPOST_FAILED              = 30011;
  ERROR_CODE_GET_LIKERS_FAILED          = 30012;
  ERROR_CODE_GET_TIMELINE_FAILED        = 30013;
  ERROR_CODE_COMMENT_ID_REQUIRED        = 30014;
  ERROR_CODE_CREATE_COMMENT_FAILED      = 30015;
  ERROR_CODE_GET_COMMENTS_FAILED        = 30016;
  ERROR_CODE_DELETE_COMMENT_FAILED      = 30017;
}
```

### 1.2 ErrorResponse 消息

所有 API 错误响应必须使用此统一结构：

```protobuf
message ErrorResponse {
  ErrorCode code = 1;
  string message = 2;
  map<string, string> details = 3;
}
```

---

## 2. Station（Go）错误处理

Station 是服务端应用，包含两套互补的错误机制：**领域层 ErrorResponse** 和 **框架层 HandlerError**。

### 2.1 领域层：ErrorResponse（proto 驱动）

位于 `apps/station/frame/touch/model/errors.go`。

每个 ErrorCode 对应一条默认消息，预定义为包级变量：

```go
var errorMessages = map[ErrorCode]string{
    ErrorCode_ERROR_CODE_ACTOR_NOT_FOUND:          "actor not found",
    ErrorCode_ERROR_CODE_ACTOR_INVALID_CREDENTIALS: "invalid email or password",
    ErrorCode_ERROR_CODE_UNAUTHORIZED:              "unauthorized",
    ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR:     "internal server error",
    // ...
}
```

构造方式：

```go
// 使用默认消息
resp := model.NewErrorResponse(model.ErrorCode_ERROR_CODE_ACTOR_NOT_FOUND)

// 使用自定义消息覆盖默认值
resp := model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_REQUEST, "email format is invalid")

// 使用预定义哨兵错误
return model.ErrActorNotFound

// 替换消息（不可变方式）
return model.ErrActorNotFound.ReplaceMsg("user with id=123 not found")
```

`ErrorResponse` 实现了 `error` 接口，可直接作为 Go error 传递：

```go
func (e *ErrorResponse) Error() string {
    return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}
```

路由层自动序列化（`router.go` 中的 `FailedResponse`）：

```go
func FailedResponse(c context.Context, ctx *app.RequestContext, err error) {
    var errResp *model.ErrorResponse
    if !errors.As(err, &errResp) {
        errResp = model.UndefinedError(err)
    }

    statusCode := http.StatusBadRequest
    if errResp.Code == model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR {
        statusCode = http.StatusInternalServerError
    }

    if shouldUseProto(ctx) {
        respBytes, _ := proto.Marshal(errResp)
        ctx.Data(statusCode, model.ContentTypeProtobuf, respBytes)
        return
    }
    ctx.JSON(statusCode, errResp)
}
```

### 2.2 框架层：HandlerError（HTTP 状态码驱动）

位于 `apps/station/frame/core/server/errors.go`。适用于框架级 TypedHandler / SimpleHandler。

```go
type HandlerError struct {
    Code    int    // HTTP 状态码
    Message string
    Err     error  // 可选，底层错误
}
```

便捷构造函数：

```go
server.BadRequest("invalid input")
server.Unauthorized("token expired")
server.Forbidden("insufficient permissions")
server.NotFound("resource not found")
server.InternalError("unexpected failure")

// 携带底层错误
server.BadRequestWithCause("invalid input", err)
server.InternalErrorWithCause("db query failed", err)
```

TypedHandler 自动捕获并序列化：

```go
response, err := handler(ctx, &request)
if err != nil {
    if handlerErr, ok := err.(*HandlerError); ok {
        resp.WriteHeader(handlerErr.Code)
        // 自动序列化为统一错误格式
        return nil
    }
    // 非 HandlerError 视为 500
    logger.Error(ctx, "Handler error", "error", err)
    resp.WriteHeader(http.StatusInternalServerError)
    return err
}
```

### 2.3 Subserver 业务错误码模式（BizError）

各 subserver 可定义模块专属错误码，通过 `error_mapper` 桥接到框架层。

以 `ai_chat` 模块为例：

```go
// errcode/error.go — 定义模块错误码
type Code string

const (
    AIChatInvalidRequest Code = "AI_CHAT_4001"
    AIChatUnauthorized   Code = "AI_CHAT_4002"
    AIChatNotFound       Code = "AI_CHAT_4004"
    AIChatProviderFailed Code = "AI_CHAT_5001"
    AIChatInternal       Code = "AI_CHAT_5000"
)

type BizError struct {
    Code       Code
    HTTPStatus int
    Message    string
    Cause      error
}

func New(code Code, httpStatus int, message string, cause error) *BizError {
    return &BizError{Code: code, HTTPStatus: httpStatus, Message: message, Cause: cause}
}
```

```go
// handler/error_mapper.go — 映射到 HandlerError
func toHandlerError(err error) error {
    if err == nil {
        return nil
    }
    var biz *errcode.BizError
    if errors.As(err, &biz) {
        return server.NewHandlerErrorWithCause(
            biz.HTTPStatus,
            fmt.Sprintf("[%s] %s", biz.Code, biz.Message),
            err,
        )
    }
    return server.InternalErrorWithCause(
        fmt.Sprintf("[%s] internal error", errcode.AIChatInternal),
        err,
    )
}
```

在 service 层创建错误：

```go
return nil, errcode.New(
    errcode.AIChatInternal,
    http.StatusInternalServerError,
    "failed to sync providers",
    err,
)
```

在 handler 层统一转换：

```go
provider, err := service.CreateProvider(ctx, protoReq)
if err != nil {
    logger.Error(ctx, "Failed to create provider", "error", err)
    return nil, toHandlerError(err)
}
```

### 2.4 哨兵错误与 errors.Is 模式

用于区分可预期的业务场景错误：

```go
func (h *relayHandler) writeRegisterError(w http.ResponseWriter, ctx context.Context, err error) {
    switch {
    case errors.Is(err, application.ErrInviteNotFound):
        writeJSON(w, http.StatusUnauthorized, errorBody("invalid invite token"))
    case errors.Is(err, application.ErrInviteExpired):
        writeJSON(w, http.StatusForbidden, errorBody("invite token has expired"))
    case errors.Is(err, application.ErrCapacityFull):
        writeJSON(w, http.StatusServiceUnavailable, errorBody("relay capacity exceeded"))
    default:
        logger.Errorf(ctx, "[relay] register failed: %v", err)
        writeJSON(w, http.StatusInternalServerError, errorBody("registration failed"))
    }
}
```

### 2.5 Station 错误处理规则

```go
// 1. 永远检查 error
result, err := someOperation()
if err != nil {
    return err
}

// 2. 用 fmt.Errorf 包装上下文
if err != nil {
    return fmt.Errorf("failed to create provider %s: %w", name, err)
}

// 3. 传播前记录日志
if err != nil {
    logger.Errorf(ctx, "failed to create provider: %v", err)
    return toHandlerError(err)
}
```

---

## 3. Desktop Rust 层错误处理

Desktop Rust 侧使用 `AppResult<T>` 模式，位于 `apps/desktop/src-tauri/src/error.rs`。

### 3.1 核心类型

```rust
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

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppResult<T: Serialize> {
    pub ok: bool,
    pub data: Option<T>,
    pub error: Option<AppError>,
}
```

### 3.2 使用方式

所有 Tauri command 的返回值统一为 `AppResult<T>`，绝对不允许 panic。

```rust
// 成功
AppResult::success(StubPayload {
    command: "provider_list".to_string(),
    status: data.to_string(),
})

// 参数错误
AppResult::fail(ErrorCode::InvalidArgument, "name is required", None)

// 内部错误（带详情）
AppResult::fail(
    ErrorCode::InternalError,
    "failed to access agents store",
    None,
)

// 带结构化详情
AppResult::fail(
    ErrorCode::NotImplemented,
    "unsupported applet command",
    Some(serde_json::json!({
        "requestId": request_id,
        "command": command
    })),
)
```

### 3.3 模块内便捷函数模式

各 application 模块遵循统一的便捷函数模式：

```rust
fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

fn internal_error() -> AppResult<StubPayload> {
    tracing::error!("Failed to acquire store lock");
    AppResult::fail(ErrorCode::InternalError, "failed to access store", None)
}
```

### 3.4 领域错误到 AppResult 的映射

当领域层有自己的错误类型时，统一映射到 AppResult：

```rust
fn map_error(command: &str, error: ProfileError) -> AppResult<StubPayload> {
    match error {
        ProfileError::InvalidArgument(message) => AppResult::fail(
            ErrorCode::InvalidArgument,
            message,
            Some(serde_json::json!({ "command": command })),
        ),
        ProfileError::Conflict(message) => AppResult::fail(
            ErrorCode::Conflict,
            message,
            Some(serde_json::json!({ "command": command })),
        ),
        ProfileError::Internal(message) => AppResult::fail(
            ErrorCode::InternalError,
            message,
            Some(serde_json::json!({ "command": command })),
        ),
    }
}
```

### 3.5 try_cmd 宏模式

用于在 command 函数中简化错误提取：

```rust
type CmdResult<T> = Result<T, AppResult<StubPayload>>;

macro_rules! try_cmd {
    ($expr:expr) => {
        match $expr {
            Ok(value) => value,
            Err(err) => return err,
        }
    };
}
```

---

## 4. Desktop TypeScript 层错误处理

位于 `apps/desktop/src/services/desktop_api.ts`。

### 4.1 核心类型

```typescript
type RustErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'INVALID_ARGUMENT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

interface RustCommandError {
  code: RustErrorCode;
  message: string;
  details?: Record<string, any>;
}

interface RustCommandResult<T = Record<string, any>> {
  ok: boolean;
  data?: T;
  error?: RustCommandError;
}
```

### 4.2 底层调用函数

```typescript
// 底层：调用 Rust command，捕获异常转为统一格式
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

// 高层：提取数据或抛出异常
async function invokeRustDataFromStatus<TInput, TOut>(
  command: string,
  input?: TInput,
): Promise<TOut> {
  const response = await invokeRustCommand<TInput, TauriStubPayload>(command, input);
  if (response.ok && response.data) {
    return parseJSONSafe(response.data.status) as TOut;
  }
  throw new Error(response.error?.message || `${command} failed`);
}
```

### 4.3 Store / 页面层错误处理

```typescript
// 在 store 或页面中使用 try/catch
try {
  const providers = await api.listProviders();
  setProviders(providers);
} catch (error) {
  console.error('Failed to load providers:', error);
  // 应当展示用户友好的错误信息
}
```

---

## 5. 跨端数据流

错误从产生到展示的完整链路：

```
Station Go               Desktop Rust              Desktop TS                UI
┌─────────────┐          ┌──────────────┐          ┌───────────────┐        ┌──────┐
│ BizError /  │  proto   │ AppResult<T> │  Tauri   │ RustCommand   │  Store │ 用户  │
│ ErrorResp   │ -------> │ success/fail │ -------> │ Result<T>     │ -----> │ 提示  │
└─────────────┘  HTTP    └──────────────┘  IPC     └───────────────┘       └──────┘
       │                        │                         │
  ErrorCode              ErrorCode enum           RustErrorCode
  (proto int)            (Rust SCREAMING)          (TS string)
```

各端错误码对应关系：

| Proto (int) | Rust | TypeScript |
|-------------|------|------------|
| 20001 | Unauthorized | UNAUTHORIZED |
| 20002 | InvalidArgument | INVALID_ARGUMENT |
| 20008 | InternalError | INTERNAL_ERROR |

---

## 6. 通用规则

### 规则 1：绝不静默吞掉错误

```go
// 错误做法
result, _ := someOperation()

// 正确做法
result, err := someOperation()
if err != nil {
    logger.Errorf(ctx, "someOperation failed: %v", err)
    return err
}
```

```rust
// 错误做法
let _ = some_operation();

// 正确做法
if let Err(err) = some_operation() {
    tracing::error!(error = %err, "some_operation failed");
    return AppResult::fail(ErrorCode::InternalError, err.to_string(), None);
}
```

### 规则 2：错误消息必须包含上下文

```go
// 错误做法
return fmt.Errorf("failed: %w", err)

// 正确做法
return fmt.Errorf("failed to create provider name=%s: %w", name, err)
```

```rust
// 错误做法
AppResult::fail(ErrorCode::InternalError, "failed", None)

// 正确做法
AppResult::fail(
    ErrorCode::InternalError,
    format!("failed to create provider: {}", err),
    Some(json!({ "provider_id": id })),
)
```

### 规则 3：使用类型化错误码，不用裸字符串

```go
// 错误做法
return errors.New("not found")

// 正确做法
return model.NewErrorResponse(model.ErrorCode_ERROR_CODE_ACTOR_NOT_FOUND)
```

```rust
// 错误做法
AppResult::fail(ErrorCode::InternalError, "not found", None)

// 正确做法
AppResult::fail(ErrorCode::NotFound, "actor not found", None)
```

### 规则 4：传播前先记录日志

```go
if err != nil {
    logger.Errorf(ctx, "failed to sync providers: %v", err)
    return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to sync providers", err)
}
```

```rust
if let Err(err) = persist_state(&state) {
    tracing::error!(error = %err, "failed to persist state");
    return AppResult::fail(ErrorCode::InternalError, err.to_string(), None);
}
```

### 规则 5：API 错误必须使用 ErrorResponse proto 格式

Station 对外暴露的所有 HTTP API，错误响应必须通过 `FailedResponse` 或 `HandlerError` 序列化为统一的 `ErrorResponse` 结构。不允许直接返回裸 JSON。

### 规则 6：客户端错误必须用户友好

```typescript
// 错误做法：直接展示技术细节
showError(error.message); // "GORM query error: ..."

// 正确做法：根据 code 映射用户可读文案
const userMessages: Record<RustErrorCode, string> = {
  UNAUTHORIZED: '登录已过期，请重新登录',
  NOT_FOUND: '请求的资源不存在',
  INVALID_ARGUMENT: '输入参数有误，请检查后重试',
  INTERNAL_ERROR: '服务暂时不可用，请稍后重试',
  FORBIDDEN: '权限不足',
  CONFLICT: '操作冲突，请刷新后重试',
  NOT_IMPLEMENTED: '该功能暂未开放',
};
```

---

## 7. 新增错误码流程

1. 在 `model/domain/error/error.proto` 中按范围添加新枚举值
2. 运行 protobuf 代码生成，更新 Go / TS / Dart / Rust 生成文件
3. 在 Station `errors.go` 中添加对应的 `errorMessages` 映射和预定义哨兵变量
4. 如果是 subserver 专属错误，在该模块的 `errcode` 包中定义 `Code` 常量
5. 在 Desktop Rust `ErrorCode` 枚举中添加对应值（如需要）
6. 在 Desktop TS `RustErrorCode` 联合类型中添加对应字符串（如需要）

---

## 8. 反模式清单

| 反模式 | 说明 | 正确做法 |
|--------|------|----------|
| `_, _ = fn()` | 吞掉错误 | 必须检查并处理 |
| 裸 `errors.New("...")` 作为 API 响应 | 丢失错误码 | 使用 `NewErrorResponse` |
| handler 层 `panic(err)` | 进程崩溃 | 返回 HandlerError |
| Rust 侧 `.unwrap()` / `.expect()` | Tauri 进程崩溃 | 返回 `AppResult::fail` |
| TS 侧不 catch API 调用 | Unhandled rejection | try/catch 或 `.catch()` |
| 日志不带上下文 | 无法定位问题 | 携带关键参数和操作名 |
| 重复定义错误码 | 码值冲突 | 统一在 error.proto 维护 |
