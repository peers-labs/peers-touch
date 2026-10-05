# Peers-Touch 统一Handler架构设计（理想态）

## 1. 文档目标
### 1.1 目标
- 建立Desktop与Station完全一致的请求处理模型，消除v1/v2两套Handler体系的冗余。
- 实现框架层与业务层的完全解耦，支持无缝替换底层Web框架而不影响业务逻辑。
- 统一HTTP/Stream/Event三类请求的处理范式，降低业务开发者学习成本。

### 1.2 适用范围
- 覆盖Station所有HTTP接口、Stream接口、事件订阅接口。
- 覆盖Desktop所有Tauri命令、内部IPC请求、对外HTTP暴露接口。
- 覆盖中间件、错误处理、参数校验、权限控制全流程。

### 1.3 非目标
- 不讨论当前实现的兼容与迁移细节。
- 不绑定特定Web框架（Hertz/Tauri/Axum等）的具体API。

## 2. 设计原则
### 2.1 框架无关性
- 业务Handler不直接依赖任何底层框架API，所有框架能力通过统一Context接口暴露。
- 底层框架通过Adapter层适配到统一模型，支持无侵入替换。

### 2.2 范式统一
- HTTP请求、Stream流请求、事件请求使用同一套Handler定义、注册、中间件、错误处理体系。
- 差异仅存在于输入输出类型，处理流程完全一致。

### 2.3 契约优先
- 所有Handler必须显式声明输入输出Schema、权限要求、超时策略、可观测性标签。
- 框架层自动完成参数校验、权限校验、超时控制、指标埋点等横切逻辑。

### 2.4 可观测优先
- 请求全链路自动生成TraceID，包含路由匹配、中间件执行、业务处理、响应返回全流程日志。
- 自动统计QPS、延迟、错误率等核心指标，按Handler维度聚合。

## 3. 核心模型
### 3.1 统一Context接口
```go
// Context 统一请求上下文接口，所有框架适配层必须实现
type Context interface {
    // 元数据获取
    TraceID() string
    Method() string
    Path() string
    HandlerName() string
    RemoteAddr() string

    // 请求操作
    BindInput(input interface{}) error
    GetHeader(key string) string
    GetQuery(key string) string
    GetPathParam(key string) string
    GetContext() context.Context

    // 响应操作
    SendSuccess(data interface{}) error
    SendError(code ErrorCode, message string, details interface{}) error
    SetHeader(key string, value string)

    // 扩展存储
    Set(key string, value interface{})
    Get(key string) (interface{}, bool)
}
```

### 3.2 Handler类型定义
#### 3.2.1 普通请求Handler
```go
// NormalHandler 普通HTTP/IPC请求Handler
type NormalHandler[I, O any] func(ctx Context, input I) (O, error)
```

#### 3.2.2 流请求Handler
```go
// StreamHandler 流式请求Handler（Websocket/Server-Sent Events/GRPC Stream）
type StreamHandler[I, O any] func(ctx Context, input I, send func(O) error) error
```

#### 3.2.3 事件Handler
```go
// EventHandler 事件订阅Handler
type EventHandler[E any] func(ctx Context, event E) error
```

### 3.3 Handler元数据
每个Handler必须包含以下元数据：
```go
type HandlerMeta struct {
    Name         string      // Handler唯一标识
    CapabilityID string      // 语义能力唯一标识
    DomainOwner  string      // 业务/交付/传输 owner
    Exposure     Exposure    // Client/Peer/Internal
    Path         string      // 路由路径/事件名
    Method       string      // 请求方法
    Type         HandlerType // Normal/Stream/Event
    AuthRequired bool        // 是否需要鉴权
    Timeout      time.Duration // 超时时间
    Tags         []string    // 可观测标签
}
```

`CapabilityID`、`DomainOwner` 和 `Exposure` 不是可观测标签。它们必须与
`docs/architecture/engineering/api-governance/station-api-capabilities.yaml` 一致，并参与启动/CI
校验。两个不同 method/path 不能声明同一个 client-facing capability。

## 4. 适配层设计
### 4.1 适配层职责
- 接收底层框架原生请求，转换为统一Context。
- 执行统一中间件链，调用业务Handler。
- 将业务Handler返回结果转换为底层框架响应格式。

### 4.2 现有框架适配实现
#### 4.2.1 Hertz适配层（Station端）
- 实现`HertzContextAdapter`，将Hertz原生`app.RequestContext`适配为统一Context接口。
- 自动完成参数绑定、响应序列化、错误转换。

#### 4.2.2 Tauri适配层（Desktop端）
- 实现`TauriContextAdapter`，将Tauri命令上下文适配为统一Context接口。
- 自动完成IPC参数转换、响应序列化、错误转换。

#### 4.2.3 Axum适配层（可选）
- 预留Axum适配层接口，支持未来框架替换。

## 5. 路由与注册体系
### 5.1 统一注册入口
```go
// Registry 统一Handler注册中心
type Registry interface {
    // 注册普通请求Handler
    RegisterNormalHandler[I, O any](meta HandlerMeta, handler NormalHandler[I, O])
    // 注册流请求Handler
    RegisterStreamHandler[I, O any](meta HandlerMeta, handler StreamHandler[I, O])
    // 注册事件Handler
    RegisterEventHandler[E any](meta HandlerMeta, handler EventHandler[E])
    // 挂载中间件
    Use(middleware Middleware)
}
```

### 5.2 路由自动生成
- 注册中心自动生成OpenAPI文档、TS类型定义、RPC客户端代码。
- 支持自动生成前后端接口契约，消除前后端类型不一致问题。

### 5.3 语义能力所有权校验（proposed）

- 精确 method/path 冲突继续在启动时失败。
- client-facing `CapabilityID` 重复必须失败，即使 route path 不同。
- handler package owner 与 registry `DomainOwner` 不一致必须失败。
- governed prefix 下存在未登记 route 必须失败。
- registry 声明的 canonical route、proto 或 truth store 缺失必须失败。
- superseded route/type/store 仍存在必须在 hard-cut Gate 失败。

完整契约与迁移边界见 `docs/architecture/engineering/api-governance/README.md`。

## 6. 中间件体系
### 6.1 统一中间件接口
```go
type Middleware func(next HandlerFunc) HandlerFunc

type HandlerFunc func(ctx Context) error
```

### 6.2 内置中间件
- 日志中间件：自动记录请求全链路日志
- 指标中间件：自动统计QPS、延迟、错误率
- 鉴权中间件：统一实现身份校验、权限判断
- 参数校验中间件：自动完成输入参数合法性校验
- 超时中间件：统一实现请求超时控制
- 限流中间件：统一实现服务限流策略
- 链路追踪中间件：自动传递TraceID，实现全链路追踪

### 6.3 中间件优先级
1. 全局中间件 → 2. 路由组中间件 → 3. 单个Handler中间件
- 中间件执行顺序按注册顺序执行，返回顺序为逆序。

## 7. 错误处理规范
### 7.1 统一错误码体系
```go
type ErrorCode string

const (
    ErrorCodeInvalidArgument ErrorCode = "INVALID_ARGUMENT"
    ErrorCodeUnauthorized    ErrorCode = "UNAUTHORIZED"
    ErrorCodeForbidden       ErrorCode = "FORBIDDEN"
    ErrorCodeNotFound        ErrorCode = "NOT_FOUND"
    ErrorCodeInternalError   ErrorCode = "INTERNAL_ERROR"
    // 业务错误码按模块定义
)
```

### 7.2 统一错误响应格式
```json
{
    "code": "INVALID_ARGUMENT",
    "message": "参数错误：用户名不能为空",
    "details": {
        "field": "username",
        "reason": "required"
    },
    "trace_id": "xxxx-xxxx-xxxx-xxxx"
}
```

### 7.3 错误处理流程
1. 业务Handler返回业务错误 → 框架层自动转换为统一错误格式
2. 中间件返回错误 → 终止后续流程，直接返回错误响应
3. 未捕获Panic → 框架层自动捕获，返回InternalError并记录Panic堆栈

## 8. 生命周期管理
### 8.1 请求生命周期
1. 底层框架接收请求 → 2. 适配层转换为统一Context → 3. 执行前置中间件链 → 4. 参数绑定与校验 → 5. 执行业务Handler → 6. 执行后置中间件链 → 7. 序列化响应返回给客户端

### 8.2 启动/关闭生命周期
1. 启动时：注册所有Handler → 校验精确路由和语义 capability ownership → 启动底层服务
2. 关闭时：优雅停止接收新请求 → 等待正在处理的请求完成 → 清理资源 → 退出进程

## 9. 验收标准（理想态）
- 所有业务Handler不直接依赖任何底层框架API
- HTTP/Stream/Event三类请求使用同一套处理流程与中间件
- 新增Handler无需手动编写参数校验、错误处理、指标埋点等重复代码
- 底层框架替换不影响任何业务Handler代码
- 全链路请求可追踪，错误可定位，性能可观测
- 每个受治理的 client capability 只有一个公开 route、一个 domain owner 和一个
  canonical proto family
