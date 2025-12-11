# 全局上下文（Global Context）设计规范（最新版）

**设计目标**
- 跨端共享：在 `client/common/peers_touch_base` 提供通用实现与稳定接口；Desktop/Mobile 仅通过适配层扩展平台差异。
- 单一可信源：集中管理用户会话、账号列表、用户偏好、协议信息与网络状态；统一就绪门控与生命周期编排。

**范围与非目标**
- 范围：客户端生命周期编排、上下文状态、通用接口与适配边界、数据模型生成规范、最小改动迁移路线。
- 非目标：联邦能力实现细节、后端协议映射、完整 UI 重构与时间估算。

**分层架构**
- 通用层（写在 `client/common/peers_touch_base`）
  - `GlobalContext`：会话/账号/偏好/协议标签/网络状态的统一状态源与事件。
  - `AppLifecycleOrchestrator`：启动阶段编排与就绪门控，产出 `AppStartupSnapshot`（建议初始路由与阶段状态）。
  - `ReadyGate`：聚合 `storage_ready/services_ready/context_hydrated/protocol_detected` 等就绪信号。
  - 领域模型与契约：`UserSession`、`UserPreferences`、`ProtocolTag`、错误类型。
  - 抽象接口：`SecureStorageAdapter`、`LocalStorageAdapter`、`ConnectivityAdapter`、`TokenProvider`、`ApiClient`（仅接口与契约）。
  - 领域仓库接口：`ProfileRepository` 等（内部可按协议选择策略实现）。
- 平台适配层（写在 `client/desktop` 与 `client/mobile`）
  - `DesktopSecureStorageAdapter`/`MobileSecureStorageAdapter`：安全存储具体实现。
  - `DesktopConnectivityAdapter`/`MobileConnectivityAdapter`：网络状态与前后台切换。
  - `WindowAdapter`（仅 Desktop）：窗口/快捷键。
  - 入口薄壳与 DI：平台入口注册适配器，将实现注入到通用接口。

**目录结构与文件映射**
- `client/common/peers_touch_base/`
  - `context/`：`global_context.dart`、`ready_gate.dart`
  - `lifecycle/`：`app_lifecycle_orchestrator.dart`
  - `models/`：Proto 定义与生成代码目录 `lib/generated/`
  - `network/`：`api_client.dart`（接口）、`token_provider.dart`、拦截器抽象
  - `storage/`：`secure_storage.dart`（接口）、`local_storage.dart`（接口）
  - `repositories/`：`profile_repository.dart` 等接口
  - `events/`：事件总线与订阅接口
- `client/desktop/`
  - `adapters/`：`secure_storage_desktop.dart`、`connectivity_desktop.dart`、`window_adapter.dart`
  - `app/initialization/app_initializer.dart`：平台薄壳，调用编排器
  - `app/bindings/initial_binding.dart`：DI 注册适配实现
- `client/mobile/`
  - `adapters/`：`secure_storage_mobile.dart`、`connectivity_mobile.dart`
  - 入口与绑定与 Desktop 类似（不含窗口适配）
- `station/frame/proto/`
  - `.proto` 文件集合与生成脚本/指南

**生命周期与就绪门控**
- 阶段：Bootstrap → Services → Context Hydration → Protocol Detect → Ready Gate。
- 就绪信号：`storage_ready`、`services_ready`、`context_hydrated`、`protocol_detected`、`network_probe?`。
- 初始路由：有效会话→`/shell`；无会话或续期失败→`/login`；替代仅用 `auth_token` 的直读判定。

**状态机概念图（文字版）**
- S0 Bootstrap 完成 → S1 Services 完成 → S2 Context Hydrated → S3 Protocol Tagged → ReadyGate 计算
- ReadyGate 输出：`ready && session_valid` → route=`/shell`；否则 route=`/login`
- 失败路径：阶段错误记录到 `AppStartupSnapshot.errors[]`，优先降级进入登录页，避免白屏。

**数据模型**
- UserSession：`userId`、`username`、`protocol`、`baseUrl`、`accessToken`、`refreshToken?`、`expiresAt?`、`roles[]`。
- UserPreferences：`theme`、`locale`、`privacy/telemetry`、`endpointOverrides`、`featureFlags`、`schemaVersion`。
- Accounts：`List<UserSession>` 快照与当前账号标识。
- ProtocolTag：`peers-touch/mastodon/other activitypub` 标签。

**接口契约**
- 会话：`setSession(UserSession?)`、`switchAccount(userId, baseUrl)`、`getCurrent()`；事件 `onSessionChange/onAccountChange`。
- 偏好：`updatePreferences(UserPreferences)`、`getPreferences()`、`migratePreferences(schemaVersion)`；事件 `onPreferencesChange`。
- 网络与协议：`isOnline()`、`onNetworkStatusChange`；`setProtocolTag(tag)`、`getProtocolTag()`；事件 `onProtocolChange`。
- 令牌：`TokenProvider.read/write/refresh/clear`（内部调用安全存储接口）。

**存储键名规范**
- 安全存储（敏感）：`token_key`、`refresh_token_key`。
- 本地存储（非敏感）：`global:current_session`、`global:accounts`、`global:user_preferences`、`base_url`、`auth_token_type`。
- 规范：键名前缀 `global:*`；偏好与账号快照维护 `schemaVersion` 并提供迁移器。

**键名判定规则**
- 有效会话：安全存储中存在 `token_key` 且未过期或可刷新。
- 无会话：缺少令牌或刷新失败时，清理上下文并回退登录。

**文件映射与迁移指引**
- `client/desktop/lib/app/initialization/app_initializer.dart`
  - 调整为“平台薄壳”，调用通用层的 `AppLifecycleOrchestrator` 完成阶段编排。
  - 保留仅 Desktop 相关：窗口管理、桌面通知、系统证书/代理等在适配层实现。
  - `NetworkInitializer` 的 baseUrl 读取 `GetStorage('base_url')` 或上下文配置，避免硬编码。
- `client/desktop/lib/main.dart`
  - 初始化：继续在 `runApp` 前调用初始化，但改为接收 `AppStartupSnapshot`。
  - 初始路由：使用 `snapshot.initialRoute`，替换现有的 `auth_token` 简单判定。
- `client/desktop/lib/app/bindings/initial_binding.dart`
  - 保持 DI 注册点，将 `SecureStorageAdapter/ConnectivityAdapter/ApiClient` 的具体实现注入到通用接口。
- `client/desktop/lib/core/network/...`
  - 拦截器从安全存储接口读取令牌；令牌刷新成功写回安全存储与 `GlobalContext`。

**目录结构建议**
- `client/common/peers_touch_base/`
  - `context/`：`global_context.dart`、`ready_gate.dart`
  - `lifecycle/`：`app_lifecycle_orchestrator.dart`
  - `models/`：`user_session.dart`、`user_preferences.dart`、错误与协议标签
  - `network/`：`api_client.dart`（接口）、`token_provider.dart`、拦截器抽象
  - `storage/`：`secure_storage.dart`（接口）、`local_storage.dart`（接口）
  - `repositories/`：`profile_repository.dart` 等接口
  - `events/`：事件总线与订阅接口
- `client/desktop/` 与 `client/mobile/`
  - `adapters/`：各接口的具体实现与平台能力
  - `bindings/`：DI 注册，注入适配实现
  - `features/`：页面与控制器，消费通用层接口

**订阅与解耦**
- 控制器与页面只订阅事件，不直接读写存储或判定协议；减少过程化与耦合。
- 网络拦截器订阅 `setSession/clearSession`，统一刷新 Authorization 来源（安全存储）。

**错误与恢复**
- 分类：鉴权/网络/协议/解析；统一错误对象与 UI 呈现。
- 恢复：自动/手动刷新令牌、离线提示与缓存回退；失败回退到登录并清理会话与令牌。

**测试与验收**
- 启动路由稳定：有效会话进入 `shell`，无会话进入 `login`。
- 就绪信号可观测：日志或调试页显示阶段完成与耗时。
- 事件一致性：切换账号/更新偏好/网络变化触发订阅更新。
- 安全合规：令牌仅在安全存储；清理路径覆盖成功/失败与异常场景。
- 跨平台一致：接口与键名共享；差异仅在适配层。

## 数据模型与代码生成

**分类原则**
- 无状态（Stateless DTO，跨端与跨服务共享）：用 Proto 定义，统一生成代码，不手写模型类。
- 有状态（Stateful Runtime，仅客户端/平台运行态）：不使用 Proto；由服务类维护状态、事件与缓存。

**无状态模型（使用 Proto）**
- `ActorIdentifier`：`actor_id`、`handle`、`origin { protocol, instance }`。
- `UserDetail`：`id`、`display_name`、`avatar_url`、`cover_url`、`region`、`timezone`、`summary`、`tags[]`、`links[]`、`server_domain`、`key_fingerprint`、`verifications[]`、可见性与权限字段。
- `Note/Post`：`id`、`content`、`attachments[]`、`visibility`、`created_at`、`updated_at`、`reply_to?`。
- `Activity`：`type`（枚举）、`actor_ref`、`object_ref`、`target_ref`、`published_at`、`source_meta { protocol, instance, object_id }`。
- `TimelineEntry`：`entry_id`、`object_ref`、`source_meta`、`delivered_at`、`pinned?`。
- `Relationship`：`kind`（follow/block/mute…）、`from_actor`、`to_actor`、`created_at`、`scope`。
- `UserSessionSnapshot`：`user_id`、`username`、`protocol`、`base_url`、`access_token`、`refresh_token?`、`expires_at?`、`roles[]`（敏感字段仅用于序列化与安全存储，禁止日志打印）。
- `UserPreferences`：`theme`、`locale`、`privacy/telemetry`、`endpoint_overrides`、`feature_flags`、`schema_version`。
- `ProtocolTag`：枚举 `PEERS_TOUCH`、`MASTODON`、`OTHER_ACTIVITYPUB`。

**有状态模型（不使用 Proto）**
- `GlobalContext`：当前会话、账号列表、偏好、协议标签、网络状态的运行态与事件流。
- `AppLifecycleOrchestrator`/`ReadyGate`：阶段编排与就绪聚合器的内部状态。
- `TokenProvider`：令牌读取/刷新过程的内部状态与重试控制。
- 各平台 `Adapters`：安全存储、连接性、窗口/通知等运行态。

**Proto 与代码生成规范**
- 目录建议：`station/frame/proto/` 统一存放 `.proto`，客户端与服务端共用；生成代码分别输出到各语言目标目录。
- Dart 生成：依赖 `protoc` 与 `protoc_plugin`，示例命令（参考）：
  - `protoc -I station/frame/proto --dart_out=client/common/peers_touch_base/lib/generated station/frame/proto/*.proto`
- Go 生成：依赖 `protoc-gen-go`，示例命令（参考）：
  - `protoc -I station/frame/proto --go_out=peers-touch-go/internal/generated station/frame/proto/*.proto`
- 版本与兼容：
  - 使用 `reserved` 标记废弃字段编号与名称，新增字段采用递增编号，避免破坏兼容。
  - 时间戳统一使用 `google.protobuf.Timestamp`；ID 使用字符串或 `uint64` 保持跨语言兼容。
  - 枚举新增值置于末尾；默认值明确（避免客户端推断）。
- 序列化策略：
  - DTO 统一通过 Proto 序列化；持久化与传输层禁用手写 `toJson/fromJson`。
  - 敏感字段（如令牌）只用于加密存储/进程内传递；禁止写入日志与非安全介质。

**迁移与替换**
- 现有手写模型类（如 `UserSession`、`UserPreferences`）将由 Proto 生成代码替换；保持字段与键名一致性，逐步迁移调用点。
- 控制器与仓库层改为依赖生成的 DTO 类型；运行态服务继续保持在通用/适配层。

**验收**
- 代码库不再新增手写模型类；所有无状态 DTO 来自统一 Proto 生成。
- 生成流程可复用（Dart/Go 两端）、增量变更可回溯；兼容策略生效（reserved/枚举扩展）。

## 实现计划与 Roadmap（基于当前代码的务实方案）

**M1：文档与契约定稿**
- 本文作为唯一规范：接口、事件、键名与目录结构明确；不引入时间预估。
- 标注受影响文件与最小修改面，避免大范围重构。

**M2：入口就绪门控（最小改动）**
- 保留 `AppInitializer` 现有初始化流程；在其后增加“就绪门控”概念，用于后续替换路由判定。
- 暂不改 `main.dart:69-72` 的 `auth_token` 判定，只在文档明确替换路径与条件。

**M3：上下文与控制器对齐（已部分完成）**
- Profile 等控制器优先读取会话用户名；登出统一清理敏感令牌与上下文。
- 登录成功时同步令牌到安全存储与上下文，减少后续适配工作量。

**M4：适配接口定义（不实现平台细节）**
- 在通用层定义 `SecureStorageAdapter/ConnectivityAdapter` 接口与 DI 绑定点；保持现有 Desktop 实现不变。
- Mobile 端待接入时按此接口开发，避免当前 Desktop 代码波动。

**M5：路由替换切入点**
- 准备好 `ReadyGate` 的接口与事件（通用层）；在 Desktop/Mobile 入口可选择性启用，用会话有效性替换 token 判定。
- 实施时机与范围由实际需要决定，非强制立即替换。

**M6：Proto 使用范围（慎用、渐进）**
- 仅为纯 DTO 引入 Proto（例如 `UserPreferences` 与部分时间线结构），不替换现有 `UserSession` 等运行态相关模型。
- 生成流程与示例脚本放入仓库；默认不改动现有调用点，按需迁移。

**M7：测试与灰度**
- 针对变更点添加最小单元测试（会话写入/读取、登出清理）；不做大覆盖面重构测试。
- 通过开关控制是否启用新路由判定；可快速回滚。

**交付与标准**
- 以“最小改动可运行”为准：入口逻辑不破坏、页面功能不变、敏感令牌路径更一致。
- 文档持续更新，所有决定与边界以本文为准；实现逐步跟进，不以时间估算为约束。

**检查清单（评审用）**
- 是否清晰区分通用层与适配层职责与目录
- 是否明确就绪门控信号与初始路由替换的切入点
- 是否定义接口契约与事件命名，避免控制器直接读写存储
- 是否给出键名规范与有效会话判定规则
- 是否约定 Proto 使用边界与生成管线，不手写 DTO
- 是否提供最小迁移路径与回滚开关，避免大规模重构
- 是否定义安全与可观测性要求（令牌与错误分类、埋点）
