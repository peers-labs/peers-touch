# Station/Desktop Alignment Plan

## 1. 文档定位

本文是 `station-desktop-scope-boundary.md` 的执行计划附属文档。

本文记录：

- 当前现状判断
- 能力域对齐建议
- 阶段安排
- Auth 统一链路的实施顺序

本文不重新定义边界与真源。边界定义以：

- `../station-desktop-scope-boundary.md`

为准。

## 2. 能力域现状与对齐建议

| 能力域 | 当前现状 | 对齐建议 |
| --- | --- | --- |
| AI Chat（会话/消息/补全） | 未完全对齐 | 优先将 Desktop 会话主链路对齐到 Station API |
| Friend Chat（私聊） | 未对齐 | 作为高优先级能力并入统一消息层 |
| Group Chat（群聊） | 未对齐 | 统一消息域后再开放完整桌面端入口 |
| Events（实时事件） | 未对齐 | 先建立统一事件适配层再替换本地事件链路 |
| Auth（认证/登录） | 未对齐 | 统一认证链路，Desktop 不再自行签发 token |
| OAuth（社交绑定） | 部分对齐 | 保持 UI 在 Desktop，凭证策略统一到 Station |
| OSS（文件上传/元数据） | 路径语义未对齐 | 对齐上传路径与返回格式，禁止端侧私有协议 |
| Search/Launcher（发现） | Launcher 未对齐 | 按业务价值并入第二阶段对齐 |
| Providers/Models | 当前 Desktop 本地实现较多 | 逐步改为远端配置真源 |
| Skills/Cron/Channels/MCP/Memory | 大体有实现，语义需复核 | 分域定义契约版本，避免“同名异义” |
| 系统能力（窗口/托盘/文件选择） | 已在 Desktop | 保持端侧独占，不下沉 Station |
| 用户偏好与设备态配置 | 已在 Desktop | 保持本地，必要时增加策略同步 |

## 3. 阶段安排

- Phase 0（前置）：统一认证链路归一（Auth），所有后续能力依赖此基线。
- Phase 1（高优先级）：AI Chat、Friend Chat、Group Chat、Events、OAuth 主链路归一。
- Phase 2（中优先级）：OSS 协议对齐、Launcher/Search 并轨、Provider/Model 真源收敛。
- Phase 3（治理）：统一 API 契约、错误码、审计埋点与版本策略。

## 4. Auth 统一链路变更清单

### 4.1 Station（Go 后端）

| 变更 | 说明 |
|------|------|
| 新增 `POST /auth/oauth2/login` 端点 | 接收 OAuth2 身份信息，执行 identity resolve → auto-register → session 签发 |
| 新增 `FindOrCreateActorByOAuth2` 服务方法 | 查 `OAuth2IdentityBinding` 表，未找到则调 `SignUp` 逻辑创建 Actor 并建立绑定 |
| 复用 `LoginWithSession` 核心逻辑 | OAuth2 resolve 到 Actor 后，直接走同一条 JWT 签发 + Session 创建路径 |
| 新增 `POST /auth/token/refresh` 端点 | 用 refresh_token 换新 JWT（当前 RefreshToken 字段为空字符串，需实现） |
| 新增 `POST /auth/logout` 端点 | 吊销 JWT + 销毁 Session（当前 `Revoke()` 为空实现，需补齐） |

### 4.2 Desktop BFF（Rust）

| 变更 | 说明 |
|------|------|
| `auth_login` 改为调 Station `POST /login` | 移除本地 `issue_session()`，通过 `station_client::request_json` 发起真实登录 |
| 新增 `auth_login_oauth2` 命令 | OAuth2 回调拿到身份信息后，调 Station `POST /auth/oauth2/login` |
| `domain/auth/session.rs` 退化为纯数据容器 | 只保留 `AuthSession { actor_id, token, session_id, expires_at }`，不再签发 token |
| `state/mod.rs` SessionState 扩展 | 增加 `session_id: Option<String>`、`expires_at: Option<u64>` |
| session 持久化改用 secure storage | 从 temp 目录 plaintext JSON 迁移到平台安全存储（macOS Keychain） |

### 4.3 Desktop 前端（TS）

| 变更 | 说明 |
|------|------|
| `oauth2.ts` startAuth 完成后调 `auth_login_oauth2` | OAuth2 回调拿到身份 → 调 BFF → 最终产出 session token |
| `oauth2.ts` 合并 authenticated 状态源 | 无论密码还是 OAuth2 登录，统一设置 `authenticated = true` + 写入 token |
| `App.tsx` 启动时调 `restoreSession` | 应用启动自动恢复 session，过期则引导重新登录 |
| 统一 401 拦截器 | 任何 API 返回 401 → 清除 session → 发布 `auth.logged_out` → 跳转登录页 |

## 5. Auth 统一链路实施顺序

```text
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
