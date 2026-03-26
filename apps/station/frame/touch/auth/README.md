# touch/auth OAuth 说明

## 分层原则

- `core/auth`：foundation 认证能力与 infra 配置（JWT、OAuth2 协议抽象）
- `touch/auth`：HTTP handler 与业务装配（配置映射、业务闭环）
- 两层都是一等公民，各自只做本层职责

## 当前落地范围

- `touch/auth` 当前仅保留账号体系相关能力（见 `auth.go`）
- OAuth provider 配置与对外路由在 `app/subserver/oauth` 承接
- 目标链路是：配置解析 provider -> 触发 GitHub/Google OAuth2 -> 回调后并入 account/session

## 边界约束

- 不在 `touch/auth` 维护无调用的 OAuth 编排壳层
- 不在 `core/auth` 放业务态存储实现
- 业务侧只暴露必要 handler，避免“先抽象后落地”的空转代码
