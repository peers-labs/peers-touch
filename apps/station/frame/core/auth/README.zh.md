# core/auth 使用说明（统一认证内核）

## 概览
- 位置：`station/frame/core/auth`
- 目标：提供与协议无关的认证抽象（Provider/Subject/Token），并通过适配器支持 HTTP 与 Hertz 等不同协议的路由接入。
- 特点：不依赖业务模型与数据库；密钥与 TTL 通过统一配置加载并强制校验；便于扩展到 p2p/mTLS 等协议。

## 核心接口
- Provider：`Authenticate(ctx, cred) -> (Subject, Token)`；`Validate(ctx, token) -> Subject`；`Revoke(ctx, token)`
- 类型：`Method`、`Credentials{SubjectID, Attributes}`、`Subject{ID, Attributes}`、`Token{Value, ExpiresAt, Type}`
- 配置：`Config{Secret, AccessTTL}`，从环境变量 `PEERS_AUTH_SECRET` 读取，`Get()` 为空会直接中止启动。

## 现有实现
- JWT Provider：`NewJWTProvider(secret, ttl)`，支持签发与校验；不访问数据库。

## 协议适配器
- Hertz：`adapter/hertz.RequireJWT(provider)`，在路由构造时以中间件形式注入。
- HTTP：`adapter/http.RequireJWT(provider)`，以 `server.Wrapper` 注入到 `http.Handler` 形态的子服务。

## 路由接入示例
- Hertz 端点：
  - `server.NewHandler(path, hdl, server.WithMethod(method), server.WithHertzMiddlewares(hertz.RequireJWT(provider)))`
- HTTP 端点：
  - `server.NewHandler(path, http.HandlerFunc(hdl), server.WithMethod(method), server.WithWrappers(http.RequireJWT(provider)))`

## 初始化建议
- 启动早期：`auth.Init(auth.Config{Secret: os.Getenv("PEERS_AUTH_SECRET")})`
- Provider 构造：`p := auth.NewJWTProvider(auth.Get().Secret, auth.Get().AccessTTL)`

## 迁移说明
- 旧的触层 JWTProvider 与中间件应移除；所有需要鉴权的端点统一使用本模块适配器。
- 业务登录编排（账户查找与密码校验、会话管理）保留在 `touch/auth`，令牌签发改为调用 `core/auth` Provider。

## 安全注意
- 绝不打印或持久化密钥；避免泄露环境变量；仅进程内读取一次。
- 推荐后续升级到非对称签名（RS256/ES256）与密钥轮换、KMS/Vault 管理。
