# 安全指南

> 最后更新: 2026-04-08
>
> 本文档定义 Peers-Touch 项目的安全规范, 涵盖密钥管理、认证鉴权、日志脱敏、传输安全等。

---

## 1. Token 存储

各端必须使用操作系统提供的安全存储机制, 禁止明文存储 Token/密钥。

| 平台 | 存储方案 | 说明 |
|---|---|---|
| iOS | Keychain Services | 系统加密存储 |
| Android | EncryptedSharedPreferences | Jetpack Security 加密 |
| Desktop (macOS) | OS Keyring (via Tauri) | macOS Keychain |
| Desktop (Windows) | OS Keyring (via Tauri) | Windows Credential Manager |
| Desktop (Linux) | OS Keyring (via Tauri) | libsecret / gnome-keyring |

```kotlin
// Android: EncryptedSharedPreferences
val prefs = EncryptedSharedPreferences.create(
    "peers_secure_prefs",
    MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
    context,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)
prefs.edit().putString("access_token", token).apply()
```

```swift
// iOS: Keychain
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrAccount as String: "peers_access_token",
    kSecValueData as String: token.data(using: .utf8)!
]
SecItemAdd(query as CFDictionary, nil)
```

---

## 2. 禁止提交密钥

### 2.1 .gitignore 规则

项目已配置的关键忽略模式:

```gitignore
# 根目录 .gitignore
*.db

# station/frame/.gitignore
private.pem
public.pem
libp2pIdentity.key
*.key

# station/app/.gitignore
peers.db
libp2pIdentity.key
private.pem
public.pem
*.local.yml
*.key

# Android
*.jks
*.keystore
local.properties
```

### 2.2 提交前检查

每次提交前必须确认:

1. 代码中不含硬编码的密钥、Token、密码
2. 配置文件中的密钥使用环境变量替代
3. 测试数据中不含真实凭证
4. `.gitignore` 是否覆盖了所有敏感文件

```bash
# 提交前快速扫描敏感信息
git diff --cached | grep -iE '(secret|password|token|api_key|private_key)' | grep -v '// ' | grep -v '# '
```

### 2.3 环境变量传递密钥

正确做法 -- 通过环境变量:

```go
// station/frame/core/auth/config.go
func Get() Config {
    if cfg.Secret == "" {
        cfg.Secret = os.Getenv("PEERS_AUTH_SECRET")
    }
    if cfg.PreviousSecret == "" {
        cfg.PreviousSecret = os.Getenv("PEERS_AUTH_PREVIOUS_SECRET")
    }
    if cfg.Secret == "" {
        panic("core/auth: missing PEERS_AUTH_SECRET")
    }
    return cfg
}
```

错误做法 -- 硬编码:

```go
// 禁止!
cfg.Secret = "my-super-secret-key-12345"
```

---

## 3. 日志脱敏

### 3.1 绝对禁止记录

以下内容绝对不允许出现在任何级别的日志中:

- Token (access_token, refresh_token)
- 密码 (password, secret)
- 密钥 (private_key, api_key)
- 个人身份信息 PII (身份证号、银行卡号)

### 3.2 正确的日志方式

```go
// 正确: 仅记录操作结果, 不记录凭据内容
logger.Infof(c, "[RequireJWT] Token valid, subject: %s", subject.ID)
logger.Warnf(c, "[RequireJWT] Token validation failed: %v", err)

// 错误: 记录了 Token 内容
// logger.Infof(c, "Token: %s", token)           // 禁止!
// logger.Debugf(c, "Password: %s", password)     // 禁止!
```

```typescript
// 正确
console.log(`Auth: login successful for ${actorId}`);

// 错误
// console.log(`Auth: token=${accessToken}`);      // 禁止!
```

### 3.3 认证中间件日志示例

源码参考: `station/frame/core/auth/adapter/hertz/hertz.go`

```go
func RequireJWT(p coreauth.Provider) func(context.Context, *app.RequestContext) {
    return func(c context.Context, ctx *app.RequestContext) {
        h := string(ctx.GetHeader("Authorization"))
        // 正确: 记录 header 存在性, 不记录完整内容
        logger.Debugf(c, "[RequireJWT] Authorization header: %s", h)

        if len(h) < 7 || h[:7] != "Bearer " {
            logger.Warnf(c, "[RequireJWT] Missing or invalid Bearer token format")
            ctx.SetStatusCode(401)
            ctx.Abort()
            return
        }
        token := h[7:]
        // 正确: 记录验证动作, 不记录 token 值
        logger.Debugf(c, "[RequireJWT] Token extracted, validating...")

        subject, err := p.Validate(c, token)
        if err != nil {
            // 正确: 记录错误原因, 不记录 token
            logger.Warnf(c, "[RequireJWT] Token validation failed: %v", err)
            ctx.SetStatusCode(401)
            ctx.Abort()
            return
        }
        // 正确: 仅记录 subject ID
        logger.Infof(c, "[RequireJWT] Token valid, subject: %s", subject.ID)
        ctx.Set(string(SubjectContextKey), subject)
    }
}
```

---

## 4. JWT 认证

### 4.1 签发与校验

源码参考: `station/frame/core/auth/jwt.go`

```go
type jwtProvider struct {
    secret     []byte
    prevSecret []byte
    accessTTL  time.Duration
}

type jwtClaims struct {
    SubjectID string `json:"subject_id"`
    jwt.RegisteredClaims
}
```

签发:

```go
func (p *jwtProvider) Authenticate(ctx context.Context, cred Credentials) (*Subject, *Token, error) {
    now := time.Now()
    exp := now.Add(p.accessTTL)
    claims := jwtClaims{
        SubjectID: cred.SubjectID,
        RegisteredClaims: jwt.RegisteredClaims{
            IssuedAt:  jwt.NewNumericDate(now),
            ExpiresAt: jwt.NewNumericDate(exp),
        },
    }
    t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    s, err := t.SignedString(p.secret)
    if err != nil {
        return nil, nil, err
    }
    return &Subject{ID: cred.SubjectID, Attributes: cred.Attributes},
        &Token{Value: s, ExpiresAt: exp, Type: "Bearer"}, nil
}
```

### 4.2 密钥轮换 (Key Rotation)

支持双密钥验证, 实现无缝轮换:

```go
func (p *jwtProvider) Validate(ctx context.Context, token string) (*Subject, error) {
    // 1. 先用主密钥验证
    tok, err := jwt.ParseWithClaims(token, &jwtClaims{},
        func(t *jwt.Token) (interface{}, error) { return p.secret, nil })

    // 2. 主密钥失败且存在旧密钥, 尝试旧密钥
    if err != nil && len(p.prevSecret) > 0 {
        tok, err = jwt.ParseWithClaims(token, &jwtClaims{},
            func(t *jwt.Token) (interface{}, error) { return p.prevSecret, nil })
    }

    if err != nil {
        return nil, err
    }
    c, ok := tok.Claims.(*jwtClaims)
    if !ok || !tok.Valid {
        return nil, err
    }
    return &Subject{ID: c.SubjectID, Attributes: map[string]string{}}, nil
}
```

轮换步骤:

1. 设置新的 `PEERS_AUTH_SECRET`
2. 将旧密钥设置为 `PEERS_AUTH_PREVIOUS_SECRET`
3. 重启 Station
4. 等待所有旧 Token 过期 (默认 TTL 7 天)
5. 清除 `PEERS_AUTH_PREVIOUS_SECRET`

### 4.3 配置

源码参考: `station/frame/core/auth/config.go`

```go
type Config struct {
    Secret         string
    PreviousSecret string
    AccessTTL      time.Duration  // 默认 7 * 24 * time.Hour
}
```

环境变量:

| 变量 | 说明 | 必需 |
|---|---|---|
| `PEERS_AUTH_SECRET` | JWT 签名主密钥 | 是 (缺失会 panic) |
| `PEERS_AUTH_PREVIOUS_SECRET` | 轮换期旧密钥 | 否 |

### 4.4 Provider 初始化

```go
provider := coreauth.NewJWTProvider(
    coreauth.Get().Secret,
    coreauth.Get().AccessTTL,
)
```

支持通过 Option 注入旧密钥:

```go
provider := coreauth.NewJWTProvider(
    secret,
    ttl,
    coreauth.WithPreviousSecret(prevSecret),
)
```

如果未显式传入旧密钥, 会自动从配置加载:

```go
func NewJWTProvider(secret string, ttl time.Duration, opts ...Option) Provider {
    // ...
    if len(p.prevSecret) == 0 {
        if prev := Get().PreviousSecret; prev != "" {
            p.prevSecret = []byte(prev)
        }
    }
    return p
}
```

---

## 5. HTTPS

### 5.1 强制 HTTPS

所有 Station API 调用必须使用 HTTPS, 仅在本地开发 (`localhost`) 允许 HTTP。

客户端强制:

```kotlin
// Android: OkHttp
val client = OkHttpClient.Builder()
    .connectionSpecs(listOf(ConnectionSpec.MODERN_TLS))
    .build()
```

```swift
// iOS: URLSession (默认遵循 ATS)
// Info.plist 中不应添加 NSAllowsArbitraryLoads = true
```

### 5.2 Station 端 TLS

Station 的 transport 层支持 TLS 配置:

```go
type Options struct {
    TLSConfig *tls.Config
    Secure    bool
}
```

---

## 6. HTTP Signature (ActivityPub 联邦)

用于 ActivityPub 服务器间 (S2S) 通信的请求签名。

源码参考: `station/frame/touch/activitypub/federation.go`

### 6.1 签名构造

```go
func DeliverActivity(ctx context.Context, target string, activity *ap.Activity,
    keyID string, privateKeyPEM string) (int, error) {

    body, err := json.Marshal(activity)
    digest := computeDigest(body)  // SHA-256

    date := time.Now().UTC().Format(http.TimeFormat)
    signingString := buildClientSigningString("post", u, date, digest)
    sig, err := signString(privateKeyPEM, signingString)

    req.Header.Set("Signature", fmt.Sprintf(
        `keyId="%s",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="%s"`,
        keyID, sig,
    ))
}
```

### 6.2 签名算法

```go
func signString(privateKeyPEM string, s string) (string, error) {
    block, _ := pem.Decode([]byte(privateKeyPEM))
    pk, err := x509.ParsePKCS1PrivateKey(block.Bytes)
    h := sha256.Sum256([]byte(s))
    sig, err := rsa.SignPKCS1v15(nil, pk, crypto.SHA256, h[:])
    return base64.StdEncoding.EncodeToString(sig), nil
}
```

### 6.3 签名 Headers

```http
Signature: keyId="https://peers.example/activitypub/alice/actor#main-key",
           algorithm="rsa-sha256",
           headers="(request-target) host date digest",
           signature="base64-encoded-signature"
Digest: SHA-256=base64-encoded-body-hash
Date: Thu, 08 Apr 2026 12:00:00 GMT
```

### 6.4 密钥管理

每个 Actor 拥有独立的 RSA 密钥对:

```go
type ActivityPubPublicKey struct {
    ID           string `json:"id"`
    Owner        string `json:"owner"`
    PublicKeyPem string `json:"publicKeyPem"`
}
```

密钥文件在 `.gitignore` 中已排除:

```gitignore
private.pem
public.pem
*.key
```

---

## 7. 输入校验

### 7.1 服务端校验原则

所有输入必须在服务端校验, 客户端校验仅为用户体验优化, 不可信赖。

### 7.2 Station Handler 校验模式

```go
func (s *subServer) handleSendMessage(ctx context.Context,
    req *chat.SendMessageRequest) (*chat.SendMessageResponse, error) {

    // 1. 认证检查
    subject := auth.GetSubject(ctx)
    if subject == nil {
        return nil, server.Unauthorized("authentication required")
    }

    // 2. 参数校验
    if req.SessionUlid == "" || req.ReceiverDid == "" || req.Content == "" {
        return nil, server.BadRequest("session_ulid receiver_did content are required")
    }

    // 3. 业务权限校验
    message, err := s.service.SendMessageByActor(
        subject.ID, req.SessionUlid, req.ReceiverDid, ...)
    if err != nil {
        if err == application.ErrNotParticipant {
            return nil, server.Forbidden(err.Error())
        }
        return nil, server.InternalErrorWithCause("failed to send message", err)
    }

    return &chat.SendMessageResponse{...}, nil
}
```

### 7.3 Desktop Rust 校验模式

```rust
pub fn search_query(input: SearchQueryInput) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "query is required",
            None,
        );
    }
    // ...
}
```

### 7.4 校验清单

每个接收外部输入的接口必须校验:

- [ ] 必填字段非空
- [ ] 字符串长度限制
- [ ] 数值范围限制
- [ ] 枚举值有效性
- [ ] ID 格式合法性
- [ ] 权限检查 (认证 + 授权)

---

## 8. 认证架构总览

### 8.1 核心抽象

源码参考: `station/frame/core/auth/types.go`

```go
type Provider interface {
    Method() Method
    Authenticate(ctx context.Context, cred Credentials) (*Subject, *Token, error)
    Validate(ctx context.Context, token string) (*Subject, error)
    Revoke(ctx context.Context, token string) error
}

type Subject struct {
    ID         string
    Attributes map[string]string
}

type Token struct {
    Value     string
    ExpiresAt time.Time
    Type      string  // "Bearer"
}
```

### 8.2 协议适配器

Hertz 适配器:

```go
// station/frame/core/auth/adapter/hertz/hertz.go
func RequireJWT(p coreauth.Provider) func(context.Context, *app.RequestContext)
```

HTTP 适配器:

```go
// station/frame/core/auth/adapter/http/http.go
func RequireJWT(p coreauth.Provider) func(ctx context.Context, next http.Handler) http.Handler
```

### 8.3 接入方式

Hertz 端点:

```go
hertzJWTWrapper := hertzadapter.RequireJWT(provider)
server.NewHertzHandler("events-stream", "/events/stream", server.GET,
    s.handleSSEStreamHertz, hertzJWTWrapper)
```

TypedHandler 端点 (通过 Wrapper):

```go
jwtWrapper := serverwrapper.JWT(provider)
server.NewTypedHandler("events-pull", "/events/pull", server.POST,
    s.handlePull, logIDWrapper, jwtWrapper)
```

### 8.4 Context 传递

认证中间件将 Subject 注入 Context, 业务层通过 `auth.GetSubject(ctx)` 获取:

```go
// 中间件注入
ctx = auth.WithSubject(ctx, subject)

// 业务层获取
subject := auth.GetSubject(ctx)
if subject == nil {
    return nil, server.Unauthorized("authentication required")
}
```

---

## 9. 安全检查清单

每次发布前确认:

- [ ] 无硬编码密钥/密码/Token
- [ ] `.gitignore` 覆盖所有敏感文件 (`*.key`, `*.pem`, `*.local.yml`)
- [ ] 日志中无 Token/密码/PII
- [ ] 所有 API 端点有认证中间件 (除公开接口外)
- [ ] HTTPS 强制 (非 localhost)
- [ ] JWT 密钥通过环境变量传入
- [ ] 输入校验在服务端完成
- [ ] ActivityPub 联邦请求有 HTTP Signature
- [ ] 密钥轮换方案可用 (`PreviousSecret`)
- [ ] 客户端 Token 使用安全存储
