# Station/Desktop 职责边界与功能分配架构

## 1. 文档目标
- 定义 `apps/station/app` 与 `apps/desktop` 的清晰职责边界，作为迁移与演进基线。
- 将抽象原则落到具体功能清单，明确每个能力的 Owner 与 Source of Truth。
- 本文不讨论 Mobile 端设计，后续可在同一模型下扩展。

## 2. 一句话边界
- Station 负责共享业务能力与系统事实。
- Desktop 负责设备交互体验与本地执行编排。

## 3. 设计原则
- 单一真源：跨端可见状态只能有一个真源。
- 领域下沉：业务规则、状态机、权限策略下沉到 Station。
- 端侧轻逻辑：Desktop 做编排与体验，不维护独立领域真相。
- 接口收敛：Desktop 业务调用优先通过统一服务网关访问 Station。
- 设备特权隔离：仅系统能力保留在 Desktop 本地。

## 4. Scope 定义

### 4.1 Station Scope
- 业务域模型与状态机。
- 鉴权、权限、审计、限流、配额。
- 跨端一致的数据与事件流。
- 对外 API 契约与版本兼容。
- 关键业务流程的最终裁决。

### 4.2 Desktop Scope
- 页面渲染、交互流程、引导与可用性体验。
- 系统能力适配（窗口、托盘、文件选择、通知、剪贴板）。
- 本地临时缓存与会话加速。
- 调用编排、容错重试、降级展示。
- 设备态配置与偏好管理。

## 5. 功能分配清单（当前阶段）

| 能力域 | Station 职责 | Desktop 职责 | 真源 | 当前现状 | 迁移建议 |
| --- | --- | --- | --- | --- | --- |
| AI Chat（会话/消息/补全） | 提供会话、消息、补全、Provider 领域接口与规则 | 负责会话 UI、输入体验、渲染与操作编排 | Station | 未完全对齐 | 优先将 Desktop 会话主链路对齐到 Station API |
| Friend Chat（私聊） | 维护会话、消息同步、在线状态 | 提供私聊入口与消息交互体验 | Station | 未对齐 | 作为高优先级能力并入统一消息层 |
| Group Chat（群聊） | 维护群组、成员、消息、未读状态 | 提供群聊列表、会话视图、成员操作体验 | Station | 未对齐 | 统一消息域后再开放完整桌面端入口 |
| Events（实时事件） | 提供 stream/pull/ack/stats 语义与顺序保证 | 订阅事件并驱动 UI 增量更新 | Station | 未对齐 | 先建立统一事件适配层再替换本地事件链路 |
| Auth（认证/登录） | 统一登录入口（密码 + OAuth2）、JWT 签发、Session 管理、Token 刷新/吊销 | 发起登录交互（表单/OAuth2 弹窗）、Token 保管、过期续签编排 | Station | 未对齐（见 §10） | 统一认证链路，Desktop 不再自行签发 token |
| OAuth（社交绑定） | 管理 provider、authorize/token 语义与凭证策略 | 发起 OAuth 授权弹窗、回调承接、连接状态展示 | Station | 部分对齐 | 保持 UI 在 Desktop，凭证策略统一到 Station |
| OSS（文件上传/元数据） | 管理上传协议、对象元数据、访问策略 | 提供上传交互、进度展示、失败重试 | Station | 路径语义未对齐 | 对齐上传路径与返回格式，禁止端侧私有协议 |
| Search/Launcher（发现） | 提供聚合搜索与推荐数据 | 提供检索入口、筛选与展示体验 | Station | Launcher 未对齐 | 按业务价值并入第二阶段对齐 |
| Providers/Models | 管理模型配置、可用性校验、策略开关 | 提供配置页与表单校验体验 | Station | 当前 Desktop 本地实现较多 | 逐步改为远端配置真源 |
| Skills/Cron/Channels/MCP/Memory | 维护业务配置、运行状态、审计 | 提供管理台交互、状态可视化 | Station | 大体有实现，语义需复核 | 分域定义契约版本，避免"同名异义" |
| 系统能力（窗口/托盘/文件选择） | 不承载 | 全量承载 | Desktop | 已在 Desktop | 保持端侧独占，不下沉 Station |
| 用户偏好与设备态配置 | 仅存全局策略（可选） | 保存本地偏好、UI 状态、设备配置 | Desktop | 已在 Desktop | 保持本地，必要时增加策略同步 |

## 6. 当前代码映射（关键入口）

### 6.1 Station 入口
- 子服务注册入口：`apps/station/app/main.go`
- 典型子服务：`subserver/ai_chat`、`subserver/friend_chat`、`subserver/group_chat`、`subserver/events`、`subserver/oauth`、`subserver/oss`、`subserver/launcher`

### 6.2 Desktop 入口
- 前端能力封装：`apps/desktop/src/services/desktop_api.ts`
- 本地命令注册：`apps/desktop/src-tauri/src/main.rs`
- 设置与账户交互：`apps/desktop/src/components/settings/*`

## 7. 决策规则（新增功能必填）
- 规则 1：该能力是否跨端共享数据或状态？
  - 是：Owner=Station。
  - 否：进入规则 2。
- 规则 2：该能力是否依赖设备特权？
  - 是：Owner=Desktop。
  - 否：优先 Owner=Station，Desktop 仅编排。
- 规则 3：是否出现同名双实现？
  - 出现即阻断合入，先完成责任归一。

## 8. 迁移执行建议
- Phase 0（前置）：统一认证链路归一（Auth），所有后续能力依赖此基线。
- Phase 1（高优先级）：AI Chat、Friend Chat、Group Chat、Events、OAuth 主链路归一。
- Phase 2（中优先级）：OSS 协议对齐、Launcher/Search 并轨、Provider/Model 真源收敛。
- Phase 3（治理）：统一 API 契约、错误码、审计埋点与版本策略。

## 9. 验收标准
- 每个能力域都有明确 Owner 与真源定义。
- Desktop 不再承载跨端业务真相。
- Station 对外接口与 Desktop 调用链能形成一一映射或明确豁免。
- 新功能评审必须附带"职责归属结论"。

---

## 10. 统一认证架构（Auth Unification）

### 10.1 问题陈述

当前存在两套完全独立且互不相通的认证体系：

| 体系 | 入口 | 产物 | 问题 |
|------|------|------|------|
| 密码登录 (`auth_login`) | BFF `issue_session()` | 本地伪 token `pt.{actor_id}.{expires_at}` | 不调用 Station，token 无签名，Station JWT 中间件拒绝 |
| OAuth2 登录 (`startAuth`) | Loopback → 外部 Provider | `connections.json` + `identities.json` | 只产生连接记录，不产生 session token |

两者均无法产出一个**被 Station 承认的 JWT**，导致所有需要 Bearer token 的 API（chat/group/profile 等）全部不可用。

### 10.2 业界标准模式

业界 App（微信/飞书/Discord/Slack/GitHub Desktop）的统一认证模式：

```
用户选择登录方式（密码 / GitHub / Google / ...）
     │
     ├── 密码方式 ──→ 直接提交 email+password
     │                       │
     └── OAuth2 方式 ─→ Provider 授权 → 拿到身份信息
                             │
                             ▼
                    ┌────────────────────┐
                    │ 服务端统一身份解析  │
                    │ (Identity Resolve) │
                    └────────┬───────────┘
                             │
                    已绑定 Actor？
                    ├── 是 → 直接签发 JWT + Session
                    └── 否 → 自动注册 Actor → 签发 JWT + Session
                             │
                             ▼
                    ┌────────────────────┐
                    │ 统一的 JWT Session │
                    │ (同一格式、同一验证路径) │
                    └────────────────────┘
```

核心原则：**无论哪种登录方式，最终都收敛到同一个 Session 签发出口，产出同一种 JWT token。**

### 10.3 目标架构

```
Desktop                          Station
═══════                          ═══════

密码表单 ─────────────────→ POST /login
   account + password            │ bcrypt 验证
                                 │ 签发 JWT + Session
                                 │ 返回 { tokens, session_id, actor }
                                 ▼
                           ┌──────────┐
                           │ JWT + Sid │ ←── 统一出口
                           └────┬─────┘
                                │
OAuth2 弹窗 → Provider 授权 ──→ POST /auth/oauth2/login  (新增)
   provider_id                   │ 参数: { provider, provider_user_id,
   provider_user_id              │         email, username, avatar_url }
   email, username, ...          │
                                 │ 1. identity_binding 查询
                                 │    已绑定 → 取 actor_id
                                 │    未绑定 → 自动注册 Actor
                                 │             → 绑定 identity
                                 │ 2. 签发 JWT + Session（复用 LoginWithSession 核心逻辑）
                                 │ 3. 返回 { tokens, session_id, actor }
                                 ▼
                           ┌──────────┐
                           │ JWT + Sid │ ←── 同一出口
                           └────┬─────┘
                                │
Desktop BFF 统一处理 ←──────────┘
   写入 AppState.session (actor_id + jwt + session_id + expires_at)
   持久化到 Keychain / secure storage
   发布 auth.logged_in 事件
   后续所有 API 调用携带 Bearer {jwt}
```

### 10.4 三层变更清单

#### Station（Go 后端）

| 变更 | 说明 |
|------|------|
| 新增 `POST /auth/oauth2/login` 端点 | 接收 OAuth2 身份信息，执行 identity resolve → auto-register → session 签发 |
| 新增 `FindOrCreateActorByOAuth2` 服务方法 | 查 `OAuth2IdentityBinding` 表，未找到则调 `SignUp` 逻辑创建 Actor 并建立绑定 |
| 复用 `LoginWithSession` 核心逻辑 | OAuth2 resolve 到 Actor 后，直接走同一条 JWT 签发 + Session 创建路径 |
| 新增 `POST /auth/token/refresh` 端点 | 用 refresh_token 换新 JWT（当前 RefreshToken 字段为空字符串，需实现） |
| 新增 `POST /auth/logout` 端点 | 吊销 JWT + 销毁 Session（当前 `Revoke()` 为空实现，需补齐） |

#### Desktop BFF（Rust）

| 变更 | 说明 |
|------|------|
| `auth_login` 改为调 Station `POST /login` | 移除本地 `issue_session()`，通过 `station_client::request_json` 发起真实登录 |
| 新增 `auth_login_oauth2` 命令 | OAuth2 回调拿到身份信息后，调 Station `POST /auth/oauth2/login` |
| `domain/auth/session.rs` 退化为纯数据容器 | 只保留 `AuthSession { actor_id, token, session_id, expires_at }`，不再签发 token |
| `state/mod.rs` SessionState 扩展 | 增加 `session_id: Option<String>`、`expires_at: Option<u64>` |
| session 持久化改用 secure storage | 从 temp 目录 plaintext JSON 迁移到平台安全存储（macOS Keychain） |

#### Desktop 前端（TS）

| 变更 | 说明 |
|------|------|
| `oauth2.ts` startAuth 完成后调 `auth_login_oauth2` | OAuth2 回调拿到身份 → 调 BFF → 最终产出 session token |
| `oauth2.ts` 合并 authenticated 状态源 | 无论密码还是 OAuth2 登录，统一设置 `authenticated = true` + 写入 token |
| `App.tsx` 启动时调 `restoreSession` | 应用启动自动恢复 session，过期则引导重新登录 |
| 统一 401 拦截器 | 任何 API 返回 401 → 清除 session → 发布 `auth.logged_out` → 跳转登录页 |

### 10.5 OAuth2 登录时序（目标态）

```
用户 ──→ 点击 "GitHub 登录"
  │
  ▼
Desktop 前端: startAuth("github")
  │
  ▼
BFF: oauth2_start_loopback → 绑定本地端口 → 打开浏览器
  │
  ▼
GitHub 授权 → 回调到本地 TCP
  │
  ▼
BFF 回调线程:
  ├── 解析身份信息 (provider_user_id, email, username, avatar_url)
  ├── save_oauth_callback → connections.json + identities.json (保留，兼容现有)
  └── 标记 loopback session completed（携带身份信息）
  │
  ▼
前端 poll 完成 → 从 polled 结果取身份信息
  │
  ▼
前端调 api.authLoginOAuth2({
    provider: "github",
    provider_user_id: "12345",
    email: "user@github.com",
    username: "alice",
    avatar_url: "https://..."
})
  │
  ▼
BFF: auth_login_oauth2
  → station_client::request_json(POST /auth/oauth2/login, body)
  → Station: FindOrCreateActorByOAuth2 → LoginWithSession
  → 返回 { tokens: { access_token(JWT), ... }, session_id, actor }
  │
  ▼
BFF: 写入 AppState.session + 持久化
  │
  ▼
前端: set({ authenticated: true }) + 发布 auth.logged_in
  │
  ▼
后续所有 API 调用: Bearer {真实 JWT} → Station 验证通过 ✓
```

### 10.6 数据模型关系（目标态）

```
touch_actor (已有)
  ├── ID (snowflake)
  ├── email (唯一)
  ├── password_hash (密码登录用，OAuth2 注册的可为空或随机)
  └── ptid (统一身份ID)

touch_oauth2_identity_binding (已有表结构，需激活使用)
  ├── actor_id → touch_actor.ID
  ├── provider_id (github / google / lark)
  ├── provider_user_id (外部平台用户ID)
  ├── email
  ├── username
  └── is_primary

映射规则:
  1. 一个 Actor 可绑定多个 OAuth2 Identity（多平台登录）
  2. 一个 OAuth2 Identity 只能绑定一个 Actor（防止身份分裂）
  3. 首次 OAuth2 登录且未匹配已有 Actor → 自动创建 Actor + 绑定
  4. 首次 OAuth2 登录但 email 匹配已有 Actor → 自动绑定（需邮箱验证）
```

### 10.7 实施顺序

```
Step 1: Station 新增 POST /auth/oauth2/login
        （FindOrCreateActorByOAuth2 + 复用 LoginWithSession）

Step 2: BFF auth_login 改为调 Station POST /login
        （移除 issue_session，session.rs 退化为数据容器）

Step 3: BFF 新增 auth_login_oauth2 命令
        （调 Station POST /auth/oauth2/login）

Step 4: 前端 OAuth2 流程末尾追加 authLoginOAuth2 调用
        （poll 完成 → 取身份 → 调 BFF → 拿到 JWT）

Step 5: 前端启动恢复 + 401 拦截器 + token 刷新
        （App.tsx restoreSession + 统一拦截）

Step 6: Station 补齐 refresh/revoke/logout
        （POST /auth/token/refresh、POST /auth/logout）
```

### 10.8 安全约束

- Desktop 不再签发或伪造任何 token，所有 token 必须来自 Station。
- JWT 存储必须使用平台安全存储（macOS Keychain / Windows DPAPI），禁止明文文件。
- OAuth2 自动注册时，password_hash 设为随机值（不可登录），用户可后续在设置页补设密码。
- `POST /auth/oauth2/login` 必须验证请求来源（仅允许来自已注册的 Desktop 客户端或可信 BFF）。
- Session 踢出机制（已有 `CreateWithKick`）对 OAuth2 登录同样生效。
