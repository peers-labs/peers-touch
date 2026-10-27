# touch/auth OAuth 说明

## 分层原则

- `core/auth`：foundation 认证能力与 infra 配置（JWT、OAuth2 协议抽象）
- `touch/auth`：HTTP handler 与业务装配（配置映射、业务闭环）
- 两层都是一等公民，各自只做本层职责

## 当前落地范围

- `touch/auth` 当前仅保留账号体系相关能力（见 `auth.go`）
- OAuth provider 配置与对外路由在 `app/subserver/oauth` 承接
- OAuth actor resolution is side-effect-free: it may bind an identity but must
  not issue a session before the Station Access Gate returns `GRANTED`
- 目标链路是：配置解析 provider -> 触发 GitHub/Google OAuth2 -> 回调后生成
  inactive session candidate -> Access Gate 复核 -> 最终授权后激活 session
- Session 由 `facility/session` 按 Station、Actor 与安装设备管理；客户端类别
  不再互斥。不同手机可并存，同设备重登只替换自己的 Session。
- 密码认证只解析 Actor；credential finalizer 必须先获得 Access Gate 授权和
  完整设备绑定，不能直接从凭据签发无设备 scope 的 Session。

## 边界约束

- 不在 `touch/auth` 维护无调用的 OAuth 编排壳层
- 不在 `core/auth` 放业务态存储实现
- 业务侧只暴露必要 handler，避免“先抽象后落地”的空转代码
