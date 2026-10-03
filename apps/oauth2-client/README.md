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

- `GET /api/admin`
- `GET /api/admin/data`
- `GET /api/oauth/github/start`
- `GET /api/oauth/github/callback`
- `GET /api/oauth/google/start`
- `GET /api/oauth/google/callback`
- `GET /api/oauth/weixin/start`
- `GET /api/oauth/weixin/callback`
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
- `bridge_version`
- `sig`

字段来源：

- GitHub：`id/login/name/avatar_url/email`
- Google：`sub/given_name/name/picture/email/email_verified`
- Weixin：`openid/unionid/nickname/headimgurl`

## 本地运行

```bash
cd apps/oauth2-client
go run ./cmd/server
```

本地未设置 `OAUTH_STORAGE_DRIVER` 时使用进程内存。管理面仅在同时设置
`OAUTH_ADMIN_USERNAME` 和 `OAUTH_ADMIN_PASSWORD_HASH` 后开放。

## Vercel 持久化

Vercel 必须使用安装到私有数据仓库的 GitHub App，不能回退到内存：

```text
OAUTH_STORAGE_DRIVER=github
OAUTH_GITHUB_STORAGE_OWNER=<owner>
OAUTH_GITHUB_STORAGE_REPO=<private-repo>
OAUTH_GITHUB_STORAGE_BRANCH=<data-branch>
OAUTH_GITHUB_APP_ID=<app-id>
OAUTH_GITHUB_APP_INSTALLATION_ID=<installation-id>
OAUTH_GITHUB_APP_PRIVATE_KEY_B64=<base64-pem>
OAUTH_CREDENTIAL_ACTIVE_KEY_ID=v1
OAUTH_CREDENTIAL_KEY_V1=<base64-32-bytes>
OAUTH_STORAGE_INDEX_HMAC_KEY=<base64-32+-bytes>
OAUTH_AUDIT_HMAC_KEY=<base64-32+-bytes>
PEERS_OAUTH_BRIDGE_SECRET=<site-result-signing-secret>
OAUTH_ALLOWED_RETURN_TO=peers-touch://oauth/callback
OAUTH_ADMIN_USERNAME=<operator>
OAUTH_ADMIN_PASSWORD_HASH=pbkdf2-sha256$600000$<base64-salt>$<base64-hash>
```

GitHub App 只需要目标私有仓库的 `Contents: Read and write` 权限。原始 OAuth
authorization code 和 state 不会写入仓库；transaction、identity、credential 与
audit payload 均使用环境 key 的 AES-256-GCM 信封存储。

轮换 key 时保留旧 key、切换 active key，然后运行：

```bash
go run ./cmd/rotate-records
```

## 配置示例

- 精简配置：`config/sites.json`
- 开关示例：`config/sites.example.json`
- 完整示例：`config/sites.full.example.json`

## 说明

- GitHub、Google 使用 PKCE S256；Weixin 使用其 Provider 原生 OAuth 流程
- `/api/admin` 与 `/api/admin/data` 只读，且不会返回 access token 或 refresh token
- 生产环境要求 HTTPS、回调签名和精确 `return_to` allowlist
- 当前私有 GitHub 仓库存储面向单管理员、低流量场景；未来可通过 `OAuthStore`
  接口替换为专用服务
