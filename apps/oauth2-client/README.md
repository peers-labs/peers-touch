# oauth2-client

独立的 OAuth2 登录编排服务，采用 DDD 分层，支持 GitHub、Google、Weixin 多 Provider，并可通过 `site_id` 做多站点隔离。

## 目录

```text
apps/oauth2-client
├── api/                           # Vercel 入口
├── cmd/server                     # 本地 HTTP 启动入口
├── internal
│   ├── domain                     # 领域模型
│   ├── application                # 用例编排
│   ├── infrastructure             # Provider API + 存储实现
│   ├── interfaces                 # HTTP 入站适配
│   └── bootstrap                  # 依赖装配
└── config/sites.json              # 默认配置（开箱即用）
```

## 开箱即用部署

默认会读取 `config/sites.json`，你只需要填这些环境变量就能跑：

- `OAUTH_BASE_URL` 例如 `https://your-deploy.vercel.app`
- `OAUTH_GITHUB_CLIENT_ID`
- `OAUTH_GITHUB_CLIENT_SECRET`
- `OAUTH_GOOGLE_CLIENT_ID`
- `OAUTH_GOOGLE_CLIENT_SECRET`

可选：

- `OAUTH_WEIXIN_CLIENT_ID`
- `OAUTH_WEIXIN_CLIENT_SECRET`
- `OAUTH_CONFIG_FILE` 默认 `config/sites.json`
- `OAUTH_SITES_JSON` 直接用 JSON 字符串覆盖文件配置

## 路由

- `GET /oauth/start?provider=github&site_id=main&return_to=https://example.com/post-auth`
- `GET /oauth/callback?provider=github&code=...&state=...`
- `GET /healthz`

Vercel 路由：

- `GET /api/oauth/start`
- `GET /api/oauth/callback`
- `GET /api/healthz`

## 回调返回字段

成功后会重定向到 `success_url` 或 `return_to`，并携带查询参数：

- `site_id`
- `provider`
- `provider_user_id`
- `union_id`（微信可能返回）
- `username`
- `display_name`
- `avatar_url`
- `email`
- `ts`

字段来源：

- GitHub：`id/login/name/avatar_url/email`
- Google：`sub/given_name/name/picture/email/email_verified`
- Weixin：`openid/unionid/nickname/headimgurl`

## 本地运行

```bash
cd apps/oauth2-client
go run ./cmd/server
```

## 配置示例

- 精简配置：`config/sites.json`
- 开关示例：`config/sites.example.json`
- 完整示例：`config/sites.full.example.json`

## 说明

- 当前会话存储为内存实现，适合最小可用版本和本地调试
- 在 Serverless 多实例场景，建议替换为 Redis 持久会话存储
