# 认证规划（零信任方案与落地计划）

本文件描述 peers-touch 项目在「登录、注册与认证」上的总体设计、零信任安全策略、短期加固任务清单与阶段性路线图，指导后端与前端的协同落地。

## 背景与目标
- 背景：项目涉及跨设备、跨网络交互，存在敏感操作与多路由家族（Actor、Peer、ActivityPub 等）。
- 目标：
  - 在不显著增加复杂度的前提下，实现可配置、可扩展的统一认证体系。
  - 落地零信任的核心原则：默认不信任、最小权限、持续验证与分段隔离。
  - 先完成「短期加固」以消除已知风险，再逐步推进策略化与设备态增强。

## 零信任核心原则
- 永不默认信任：无论来源、网络或设备，所有请求都需显式验证。
- 最小权限：基于角色与属性（RBAC + ABAC）授予必要的最小访问。
- 持续验证：会话期间动态评估风险，必要时触发「一步升级验证」（Step-up）。
- 可观测与响应：记录审计与风险分，异常触发自动化拦截或降权。

## 现状回顾（已具备与待完善）
- 已具备：
  - `server.Wrapper` 中间件能力（已在 Hertz 与 Native server 插件中生效）。
  - `RequireJWT` / `RequireAuth` / `RequireSession` 机制（`station/frame/middleware.go`）。
  - `CommonAccessControlWrapper(RoutersNameActor|Peer|ActivityPub)` 已用于路由家族分段。
  - `Actor` 资料相关接口已启用 `RequireJWT`（已改造）。
- 待完善：
  - JWT 密钥配置不应硬编码，需从配置加载并支持轮换。
  - 刷新令牌流（refresh）与 `/actor/me` 等辅助接口需统一。
  - 前端令牌存储与拦截器策略需标准化以支持跨端（Web/Mobile/Desktop）。

## 总体架构
- 身份与认证
  - 使用 JWT（访问令牌 + 刷新令牌）作为主身份凭证：
    - 标准声明：`sub`（actor_id）、`iat`、`exp`、`jti`、`aud`、`iss`。
    - 扩展声明：`roles`、`permissions`、`risk`（可选）。
  - 后端提供 `login`、`signup`、`refresh`、`logout`、`me` 等接口；所有需要身份的接口统一用 `RequireJWT` 进行授权门控。
  - JWT 密钥、TTL、受众等从配置读取，支持密钥轮换与失效回收（`revoke`）。

- 授权策略（Phase B 引入）
  - 模型：RBAC + ABAC（基于用户属性、资源属性与环境属性的组合决策）。
  - 引擎：优先 Casbin（轻量且易集成），或备选 OPA（如需更复杂策略）。
  - 策略位置：数据库或策略文件；通过 `CommonAccessControlWrapper` 在路由入口进行执行业务策略。

- 设备态与网络信任（Phase C 逐步落地）
  - 设备指纹与平台安全存储（Mobile 用 `SecureStorage`，Desktop 用系统安全存储，Web 用 `localStorage` + 约束）。
  - 证书钉扎与 mTLS（服务间通信、敏感通道）。
  - 风险评分与「一步升级验证」（短信/邮箱/二次确认）。

- 可观测与响应
  - 系统级审计事件：`auth_login`、`auth_refresh`、`auth_logout`、`actor_update` 等。
  - 基于路由家族与行为的风险评分，异常触发限速、封禁或临时提升验证级别。

## 后端接口设计（草案）
- `POST /actor/signup`
  - 请求：`{ username|email|phone, password, profile? }`
  - 响应：`{ actor_id }`
  - 校验：密码强度、唯一性检查、基础风控（注册频率）。

- `POST /actor/login`
  - 请求：`{ username|email|phone, password }`
  - 响应：`{ access_token, refresh_token, actor_id, expires_in }`
  - 日志：记录来源、设备、失败原因（不可泄露具体细节）。

- `POST /auth/refresh`
  - 请求：`{ refresh_token }`
  - 响应：`{ access_token, refresh_token?, expires_in }`
  - 说明：如启用滑动刷新，返回新的 `refresh_token`；否则仅发新 `access_token`。

- `GET /actor/me`
  - 保护：`RequireJWT`
  - 响应：`{ actor_id, profile, roles, permissions }`

- `POST /auth/logout`
  - 请求：空（或 `{ refresh_token }` 用于主动失效刷新令牌）。
  - 响应：`{ ok: true }`
  - 说明：可选将 `jti` 加入黑名单一段时间以实现即刻注销。

## 配置与密钥管理（建议）
- 新增配置项（示例键名，可根据现有 `core/config` 适配）：
  - `peers.touch.security.jwt_secret`：JWT 签发与校验密钥（支持版本号与轮换）。
  - `peers.touch.security.jwt_access_ttl`：访问令牌 TTL（如 `900s`）。
  - `peers.touch.security.jwt_refresh_ttl`：刷新令牌 TTL（如 `30d`）。
  - `peers.touch.security.allowed_origins`：CORS 白名单。
  - `peers.touch.security.trusted_clients`：受信客户端列表（可用于额外放行或更严格校验）。
- 密钥管理与轮换：
  - Windows 环境下通过系统环境变量或 `.env` 读取；禁止代码硬编码。
  - 支持定期轮换（版本化密钥 `kid`），刷新令牌过渡期内兼容旧密钥校验。
  - 管理台或脚本触发轮换，并更新服务配置与审计记录。

## 短期加固（Phase A，1–2 周）

目标：消除硬编码与不一致行为，建立稳定的认证骨架与前后端配合。

### 任务清单（后端）
- 从配置加载 `jwt_secret`、TTL、aud/iss，替换所有硬编码。
- 补齐 `POST /auth/refresh` 与 `GET /actor/me`，统一返回结构与错误码。
- 所有需鉴权接口使用 `RequireJWT`；保持 `RequireAuth` 在需要兼容会话时使用。
- 为路由家族统一应用 `CommonAccessControlWrapper(RoutersNameX)`，确保分段策略入口可扩展。
- 强化 CORS（白名单）、同站策略（`SameSite`）、HTTPS/TLS 默认化（如适用）。
- 审计日志：登录、刷新、注销、资料更新写入统一日志与上下文 `jti`。

### 任务清单（前端）
- 令牌存储策略：
  - Mobile：`SecureStorage` 持久化 `refresh_token`，内存持有 `access_token`。
  - Web：`localStorage`（或 Cookie）存 `refresh_token`，内存持有 `access_token`。
  - Desktop：系统安全存储（如 Windows Credential Manager）优先，其次文件加密。
- 拦截器：
  - 所有 API 请求自动附带 `Authorization: Bearer <access_token>`。
  - 收到 401/403 时自动调用 `/auth/refresh` 一次，成功后重试原请求。
  - 刷新失败则触发登出与回到登录页。
- UI/流程：
  - 登录后拉取 `/actor/me` 并写入全局状态（actor、roles、permissions）。
  - 路由保护：受限页面需已登录且具备所需权限。
  - 登出：清理令牌与状态，调用 `/auth/logout`。

### 任务清单（运维/配置）
- 生成强随机 `jwt_secret` 并配置到环境；记录生成与生效时间。
- 设置 CORS 白名单与 TLS 证书；检查浏览器端混合内容警告。
- 日志与监控：暴露关键认证事件，验证审计可查。

### 验收标准（Phase A）
- 代码中不再出现 JWT 密钥硬编码；配置加载稳定。
- `/actor/me` 在未登录时返回 401；登录后正确返回当前身份信息。
- 刷新令牌流程可用且一致；过期 `access_token` 可平滑续期。
- 前端路由保护与拦截器生效；登出可立即失效访问令牌。
- 审计日志包含登录、刷新、注销、资料更新事件；最基本风险字段可用。

## 中期计划（Phase B，策略化与微分段，1–2 周）
- 引入策略引擎（Casbin 优先）：
  - 策略模型：`subject`（actor/role）、`object`（资源/路由）、`action`（方法）、`env`（风险/设备态）。
  - 在 `CommonAccessControlWrapper` 中加载并评估策略；拒绝时返回 403。
- 策略示例：
  - 仅 `role=admin` 可更新其他 Actor 资料；普通用户仅能更新自己的资料。
  - 风险分高（如跨设备异常登录）时，需要 Step-up 验证后才允许敏感操作。
- 任务与验收：
  - 策略表或文件管理；热更新或重载机制。
  - 集成测试覆盖关键场景；前端在 403 时提示并引导 Step-up。

## 后期计划（Phase C，设备态与服务间信任，2–4 周）
- 设备指纹与平台安全存储全面启用（含桌面端）。
- 客户端证书钉扎；服务间 mTLS；P2P 请求钩子与签名校验。
- 高风险操作的 Step-up 验证（短信/邮件/二次确认）。
- 验收：异常行为自动降权或封禁；证书异常拒绝通信；策略与设备态联动。

## 风险与权衡
- 复杂度：策略与设备态引入会提高维护成本；建议循序渐进。
- 性能：JWT 验证与策略评估增加开销；应采用缓存与合理 TTL。
- 运维：密钥轮换与证书管理需流程化与审计化。

## 立即行动项（建议）
- 创建/接入配置键：`peers.touch.security.jwt_secret`、`jwt_access_ttl`、`jwt_refresh_ttl`。
- 实现 `/auth/refresh` 与 `/actor/me`；统一错误结构与审计。
- 前端接入拦截器与统一令牌存储策略；完成登录/登出与启动检查。
- 将所有需鉴权接口统一接入 `RequireJWT` 与 `CommonAccessControlWrapper`。

——
如需我继续：可以按以上 Phase A 任务清单，直接提交配置项与接口的具体代码改造，并补上一份最小可用的集成测试用例与前端拦截器样例。