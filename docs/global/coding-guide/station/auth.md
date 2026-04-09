# Station 认证系统指南

> 源码位置: `apps/station/frame/core/auth/`

## 1. 架构概览

Station 的认证系统设计为**协议无关的认证抽象层**, 核心思想:

- `Provider` 接口抽象认证行为 (签发/验证/吊销)
- `Service` 作为 Provider 的注册中心, 支持多认证方式并存
- 通过适配器层 (HTTP/Hertz) 将认证逻辑注入到不同协议的路由中间件
- `Subject`/`Token` 类型统一认证结果的表达

```
                    ┌─────────────────────┐
                    │    auth.Service      │
                    │ (Provider 注册中心)   │
                    └────────┬────────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
    ┌───────▼──────┐ ┌──────▼──────┐ ┌──────▼──────────┐
    │ JWT Provider │ │ OAuth2      │ │ Connections     │
    │ (内置)       │ │ Provider    │ │ Provider        │
    └──────────────┘ └─────────────┘ └─────────────────┘
            │
            ▼
    ┌──────────────────────────────────────────┐
    │          协议适配器                       │
    │  ┌──────────────┐  ┌──────────────────┐  │
    │  │ HTTP Adapter  │  │ Hertz Adapter    │  │
    │  │ RequireJWT()  │  │ RequireJWT()     │  │
    │  └──────────────┘  └──────────────────┘  │
    └──────────────────────────────────────────┘
            │
            ▼
    auth.WithSubject(ctx, subject) → Context 传播
```

---

## 2. 核心类型

### 2.1 Method - 认证方式标识

```go
// frame/core/auth/types.go
type Method string

const (
    MethodJWT         Method = "jwt"
    MethodOAuth2      Method = "oauth2"
    MethodConnections Method = "connections"
)
```

### 2.2 Credentials - 认证凭据

```go
type Credentials struct {
    Scheme     string            // 认证方案 (如 "Bearer")
    Token      string            // 原始令牌字符串
    SubjectID  string            // 主体标识 (用于签发)
    Attributes map[string]string // 附加属性
}
```

### 2.3 Subject - 认证主体

```go
type Subject struct {
    ID         string            // 主体唯一标识 (用户 ID)
    Attributes map[string]string // 附加属性 (角色、邮箱等)
}
```

### 2.4 Token - 令牌

```go
type Token struct {
    Value     string    // 令牌值 (JWT 字符串)
    ExpiresAt time.Time // 过期时间
    Type      string    // 令牌类型 (如 "Bearer")
}
```

---

## 3. Provider 接口

```go
// frame/core/auth/provider.go
type Provider interface {
    Method() Method
    Authenticate(ctx context.Context, cred Credentials) (*Subject, *Token, error)
    Validate(ctx context.Context, token string) (*Subject, error)
    Revoke(ctx context.Context, token string) error
}
```

| 方法 | 说明 |
|------|------|
| `Method()` | 返回该 Provider 的认证方式标识 |
| `Authenticate` | 使用凭据签发令牌, 返回 Subject + Token |
| `Validate` | 验证令牌有效性, 返回 Subject |
| `Revoke` | 吊销令牌 |

---

## 4. Service - 认证服务

```go
// frame/core/auth/service.go
type Service struct {
    providers     map[Method]Provider
    defaultMethod Method
}
```

### 4.1 API

```go
// 创建认证服务
svc := auth.NewService()

// 注册 Provider
svc.Register(jwtProvider)
svc.Register(oauth2Provider)

// 设置默认认证方式
svc.SetDefault(auth.MethodJWT)

// 按方式获取 Provider
provider := svc.Provider(auth.MethodJWT)

// 获取默认 Provider
defaultProvider := svc.Default()
```

### 4.2 使用示例

```go
func setupAuth() *auth.Service {
    svc := auth.NewService()

    jwtProvider := auth.NewJWTProvider(
        auth.Get().Secret,
        auth.Get().AccessTTL,
    )
    svc.Register(jwtProvider)
    svc.SetDefault(auth.MethodJWT)

    return svc
}
```

---

## 5. JWT Provider

JWT Provider 是框架内置的主要认证实现, 基于 `github.com/golang-jwt/jwt/v5`.

### 5.1 创建

```go
// frame/core/auth/jwt.go
func NewJWTProvider(secret string, ttl time.Duration, opts ...Option) Provider
```

参数:
- `secret`: HMAC 签名密钥
- `ttl`: 令牌有效期, 为 0 时使用全局配置的 `AccessTTL`
- `opts`: 可选参数, 如 `WithPreviousSecret`

```go
// 基本用法
provider := auth.NewJWTProvider("my-secret", 7 * 24 * time.Hour)

// 从全局配置创建 (推荐)
provider := auth.NewJWTProvider(auth.Get().Secret, auth.Get().AccessTTL)

// 支持密钥轮换
provider := auth.NewJWTProvider(
    auth.Get().Secret,
    auth.Get().AccessTTL,
    auth.WithPreviousSecret("old-secret"),
)
```

### 5.2 签发令牌 (Authenticate)

```go
func (p *jwtProvider) Authenticate(ctx context.Context, cred Credentials) (*Subject, *Token, error)
```

签发流程:
1. 使用 `cred.SubjectID` 构建 JWT Claims
2. 用 HS256 + primary secret 签名
3. 返回 Subject 和 Token

```go
cred := auth.Credentials{
    SubjectID: "user-123",
    Attributes: map[string]string{
        "role": "admin",
    },
}

subject, token, err := provider.Authenticate(ctx, cred)
// subject.ID == "user-123"
// token.Value == "eyJhbGciOiJIUzI1NiIs..."
// token.Type == "Bearer"
```

### 5.3 验证令牌 (Validate)

```go
func (p *jwtProvider) Validate(ctx context.Context, token string) (*Subject, error)
```

验证流程:
1. 先用 primary secret 解析
2. 如果失败且存在 `prevSecret`, 再用旧密钥尝试
3. 验证成功返回 Subject

```go
subject, err := provider.Validate(ctx, "eyJhbGciOiJIUzI1NiIs...")
if err != nil {
    // 令牌无效或过期
}
// subject.ID == "user-123"
```

### 5.4 密钥轮换

JWT Provider 内置了**双密钥验证**支持, 实现零停机密钥轮换:

```go
type jwtProvider struct {
    secret     []byte        // 当前密钥 (用于签发和首选验证)
    prevSecret []byte        // 旧密钥 (仅用于验证, 兼容过渡期)
    accessTTL  time.Duration
}
```

轮换步骤:
1. 将当前密钥设为 `PreviousSecret`
2. 生成新密钥设为 `Secret`
3. 新签发的令牌使用新密钥, 旧令牌通过旧密钥仍可验证
4. 等旧令牌全部过期后, 移除 `PreviousSecret`

---

## 6. 认证配置

### 6.1 Config 结构

```go
// frame/core/auth/config.go
type Config struct {
    Secret         string        // JWT 签名密钥
    PreviousSecret string        // 旧密钥 (密钥轮换用)
    AccessTTL      time.Duration // 令牌有效期 (默认 7 天)
}
```

### 6.2 初始化

```go
auth.Init(auth.Config{
    Secret:    os.Getenv("PEERS_AUTH_SECRET"),
    AccessTTL: 7 * 24 * time.Hour,
})
```

### 6.3 获取配置

```go
cfg := auth.Get()
// cfg.Secret        - 从环境变量 PEERS_AUTH_SECRET 读取
// cfg.PreviousSecret - 从环境变量 PEERS_AUTH_PREVIOUS_SECRET 读取
// cfg.AccessTTL     - 默认 7 天
```

`Get()` 方法包含安全校验: 如果 `Secret` 为空, 会直接 **panic** 终止启动. 这确保不会在缺少密钥的情况下运行.

---

## 7. Context 传播

认证结果通过 `context.Context` 在请求链路中传播.

### 7.1 API

```go
// frame/core/auth/context.go

// 将 Subject 注入 Context
func WithSubject(ctx context.Context, subject *Subject) context.Context

// 从 Context 获取 Subject (不存在返回 nil)
func GetSubject(ctx context.Context) *Subject

// 从 Context 获取 Subject (不存在则 panic)
func MustGetSubject(ctx context.Context) *Subject

// 检查 Context 中是否存在 Subject
func HasSubject(ctx context.Context) bool
```

### 7.2 使用示例

```go
// 在中间件中注入
ctx = auth.WithSubject(ctx, &auth.Subject{
    ID: "user-123",
    Attributes: map[string]string{"role": "admin"},
})

// 在 Handler 中获取
subject := auth.GetSubject(ctx)
if subject == nil {
    return errors.New("unauthorized")
}
actorID := subject.ID

// 在确定已过中间件的场景 (如受保护的 Handler)
subject := auth.MustGetSubject(ctx)
```

---

## 8. HTTP 适配器

### 8.1 标准 HTTP 中间件

```go
// frame/core/auth/adapter/http/http.go
func RequireJWT(p coreauth.Provider) func(ctx context.Context, next http.Handler) http.Handler
func GetSubject(r *http.Request) *coreauth.Subject
```

工作流程:
1. 从 `Authorization` Header 提取 `Bearer <token>`
2. 调用 Provider.Validate 验证
3. 验证成功: 将 Subject 注入 Request Context, 调用 next
4. 验证失败: 返回 401 JSON 响应

```go
// 在 subserver 中使用
func (s *mySubServer) Init(ctx context.Context, opts ...option.Option) error {
    provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
    s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
    return nil
}

// 在 Handler 中获取认证用户
func (s *mySubServer) handleRequest(w http.ResponseWriter, r *http.Request) {
    subject := httpadapter.GetSubject(r)
    if subject == nil {
        http.Error(w, "unauthorized", 401)
        return
    }
    userID := subject.ID
}
```

### 8.2 Hertz 适配器

```go
// frame/core/auth/adapter/hertz/hertz.go
func RequireJWT(p coreauth.Provider) func(context.Context, *app.RequestContext)
func GetSubject(ctx *app.RequestContext) *coreauth.Subject
```

Hertz 适配器的实现与 HTTP 类似, 但适配了 Hertz 框架的 `app.RequestContext`:

```go
// 在路由中使用 Hertz 中间件
provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
hertzJWTWrapper := hertzadapter.RequireJWT(provider)

handlers := []server.Handler{
    server.NewHertzHandler("my-endpoint", "/api/v1/resource", server.GET,
        s.handleResource, hertzJWTWrapper),
}

// 在 Hertz Handler 中获取认证用户
func (s *mySubServer) handleResource(ctx context.Context, c *app.RequestContext) {
    subject := hertzadapter.GetSubject(c)
    if subject == nil {
        c.JSON(401, map[string]string{"error": "unauthorized"})
        return
    }
    actorID := subject.ID
}
```

---

## 9. Subserver 中的典型集成模式

### 9.1 初始化 Provider 和 Wrapper

```go
func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
    // 创建 JWT Provider
    provider := coreauth.NewJWTProvider(
        coreauth.Get().Secret,
        coreauth.Get().AccessTTL,
    )

    // 创建 HTTP JWT Wrapper (用于 TypedHandler)
    s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

    return nil
}
```

### 9.2 注册受保护的路由

```go
func (s *subServer) Handlers() []server.Handler {
    logIDWrapper := serverwrapper.LogID()

    // JWT wrapper
    provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
    jwtWrapper := serverwrapper.JWT(provider)

    // Hertz JWT wrapper (用于 SSE 等需要原生 Hertz Handler 的场景)
    hertzJWTWrapper := hertzadapter.RequireJWT(provider)

    return []server.Handler{
        // Hertz 原生 Handler (SSE)
        server.NewHertzHandler("stream", "/events/stream", server.GET,
            s.handleStream, hertzJWTWrapper),

        // TypedHandler (Proto 请求/响应)
        server.NewTypedHandler("pull", "/events/pull", server.POST,
            s.handlePull, logIDWrapper, jwtWrapper),
    }
}
```

### 9.3 在 Handler 中获取认证用户

```go
// TypedHandler 中 (Subject 通过 context 传播)
func (s *subServer) handlePull(ctx context.Context, req *PullRequest) (*PullResponse, error) {
    subject := auth.GetSubject(ctx)
    if subject == nil {
        return nil, server.Unauthorized("authentication required")
    }
    actorID := subject.ID
    // ...
}
```

---

## 10. Connections Provider

Connections Provider 管理外部连接/集成的认证状态:

```go
// frame/core/auth/connections.go
type ConnectionProvider struct {
    ProviderID          OAuth2ProviderID
    Name                string
    Category            string
    Status              ConnectionProviderStatus // ready/disabled/developing/error
    HasCredentials      bool
    CredentialSource    string
    LastError           string
    LastValidatedAtUnix int64
}
```

### 10.1 ConnectionsService

```go
type ConnectionsService struct {
    store ConnectionProviderStore
}

func NewConnectionsService(store ConnectionProviderStore) *ConnectionsService

func (s *ConnectionsService) ListProviders(ctx context.Context) ([]*ConnectionProvider, error)
func (s *ConnectionsService) UpsertProvider(ctx context.Context, provider *ConnectionProvider) error
```

### 10.2 ConnectionProviderStore 接口

```go
type ConnectionProviderStore interface {
    ListProviders(ctx context.Context) ([]*ConnectionProvider, error)
    GetProvider(ctx context.Context, providerID OAuth2ProviderID) (*ConnectionProvider, error)
    UpsertProvider(ctx context.Context, provider *ConnectionProvider) error
}
```

---

## 11. OAuth2 扩展

auth 包还定义了完整的 OAuth2 抽象, 用于对接外部 OAuth2 提供商:

```go
// 核心接口
type OAuth2Adapter interface {
    ProviderID() OAuth2ProviderID
    BuildAuthorizeURL(ctx, cfg, state) (string, error)
    ExchangeCode(ctx, cfg, code) (*OAuth2TokenState, error)
    RefreshToken(ctx, cfg, refreshToken) (*OAuth2TokenState, error)
    FetchIdentity(ctx, token) (*OAuth2Identity, error)
}

// 存储接口
type OAuth2IdentityStore interface { ... }
type OAuth2TokenStore interface { ... }
type OAuth2ConfigSource interface { ... }
```

---

## 12. 安全注意事项

1. **密钥管理**: 密钥通过环境变量 `PEERS_AUTH_SECRET` 注入, 绝不硬编码在代码或配置文件中.

2. **启动校验**: `auth.Get()` 在 Secret 为空时直接 panic, 防止在无密钥状态下运行.

3. **密钥轮换**: 使用 `PreviousSecret` 实现零停机轮换, 确保过渡期内新旧令牌都可验证.

4. **令牌有效期**: 默认 7 天, 可通过 `Config.AccessTTL` 调整. 建议根据安全要求缩短.

5. **Context 传播**: 优先使用 `auth.GetSubject(ctx)` 而非直接从 Header 解析, 确保认证信息已经过验证.
