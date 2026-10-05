# Applet Runtime Architecture — 服务架构

> **Status**: draft
> **Version**: v1.1
> **Created**: 2026-06-06 | **Updated**: 2026-06-17
> **Owner**: Architecture Team
> **Module**: `apps/applets/`, `apps/station/`, `apps/desktop/src-tauri/src/application/applets/`, `apps/mobile/**/core/applet/`

---

## 1. 设计目标

Applet 服务架构要解决三个问题：

- Applet 从哪里来：分发、安装、版本、完整性。
- Applet 能做什么：权限、session、capability、策略。
- Applet 做过什么：审计、诊断、运行质量、撤回。

服务架构分为 Station 服务、Host Gateway、Platform Handler 三层。Applet SDK 不属于服务层，它只是调用入口。

---

## 2. 服务分层

```text
Station Applet Store
  ├── package registry
  ├── manifest registry
  ├── version channel
  ├── bundle storage
  ├── policy distribution
  └── audit ingestion

Host Capability Gateway
  ├── session validation
  ├── permission guard
  ├── method registry
  ├── parameter validation
  ├── local audit writer
  ├── network proxy client
  └── platform handler dispatch

Platform Handlers
  ├── storage
  ├── network
  ├── config
  ├── system
  ├── ui
  ├── device
  ├── notification
  └── future file/media/share
```

规则：

- Station 是跨设备真源。
- Host Gateway 是端侧强制执行点。
- Platform Handler 只执行已授权调用。
- Applet 不能直接访问 Station 内部接口。
- Applet 不能直接持有 service upstream 或 backend base URL。

---

## 3. Station Applet Store

Station Applet Store 负责生态级服务：

| 子能力 | 职责 |
|--------|------|
| Package Registry | 记录 applet id、版本、owner、状态 |
| Manifest Registry | 保存 manifest、target platforms、permissions、capabilities |
| Bundle Storage | 保存 bundle、assets、integrity |
| Version Channel | stable/beta/dev channel 与 rollout 策略 |
| Policy Distribution | 下发 domain allowlist、capability policy、revocation |
| Install State | 用户/设备已安装 applet、版本、配置 |
| Audit Ingestion | 收集 Host 审计事件，支持安全回溯 |

Station 不负责：

- 渲染 Applet。
- 直接执行设备能力。
- 替端侧 Gateway 做 session 检查。

---

## 4. Host Capability Gateway

Gateway 是所有敏感能力的强制执行链。

```text
invoke(applet_id, session_id, method, params)
  → load session
  → load manifest
  → load policy
  → check lifecycle state
  → check permission
  → check method allowlist
  → validate params
  → audit start
  → dispatch handler
  → audit result
  → normalize response
```

每个 Host 都必须有 Gateway：

| Host | Gateway 所在层 |
|------|----------------|
| Desktop | Tauri Rust application/domain/infrastructure |
| Android | Kotlin native plugin / core applet module |
| iOS | Swift native plugin / core applet module |
| HarmonyOS | ArkTS native plugin reserved |
| Web | Web Host BFF, optionally backed by Station |

Gateway 不允许放在 Applet SDK 内部。SDK 只能做 typed client 和错误归一。

---

## 5. Capability Registry

Capability Registry 将 method 映射到 handler。

```typescript
export interface CapabilityDescriptor {
  method: string
  permission: string
  lifecycle: Array<'active' | 'hidden' | 'paused'>
  risk: 'low' | 'medium' | 'high'
  validateParamsSchema: string
  audit: 'metadata-only' | 'metadata-and-size' | 'forbidden-body'
}
```

首批 registry：

| Method | Permission | Lifecycle | Risk |
|--------|------------|-----------|------|
| `app.getContext` | `system` | active/hidden/paused | low |
| `lifecycle.reportReady` | none | loading | low |
| `storage.get` | `storage:applet` | active/hidden/paused | low |
| `storage.set` | `storage:applet` | active/hidden | low |
| `storage.remove` | `storage:applet` | active/hidden | low |
| `network.request` | `network:service:<service>` | active | medium |
| `config.get` | `config` | active/hidden/paused | low |
| `system.getInfo` | `system` | active/hidden/paused | low |
| `ui.showToast` | `ui:feedback` | active | low |
| `ui.confirm` | `ui:feedback` | active | medium |
| `navigation.navigateTo` | `navigation:applet` | active | low |
| `navigation.back` | `navigation:applet` | active | low |
| `events.emit` | `events:applet` | active | medium |
| `events.subscribe` | `events:applet` | active | medium |
| `telemetry.track` | `telemetry:track` | active/hidden/paused | low |

High-risk 能力必须单独 ADR：camera、microphone、location、contacts、file external access、payment。

---

## 6. Permission Model

权限来源：

```text
Manifest declared permissions
  ∩ Station policy
  ∩ Host platform policy
  ∩ User/session grant
  = granted permissions
```

Manifest 权限只是上限。Host 可以继续收紧，不能放宽。

权限策略示例：

```json
{
  "appletId": "sample-applet",
  "network": {
    "domains": ["https://api.example.com"],
    "methods": ["GET", "POST"],
    "maxBodyBytes": 65536
  },
  "storage": {
    "quotaBytes": 10485760
  },
  "events": {
    "topics": ["market.realtime"]
  }
}
```

---

## 7. Network Service Binding

Applet 的 `network.request` 必须走 Host Gateway 的 service binding：

```typescript
sdk.network.request({
  service: 'note',
  method: 'POST',
  path: '/v1/notes',
  body: input
})
```

Gateway 执行：

- 校验 applet manifest 是否声明 `services.note`。
- 校验 permission 是否包含 `network:service:note`。
- 校验 method、path、headers、body size。
- 解析 `note` 当前部署目标：Station-bundled subserver 或 standalone service。
- 注入 Peers-Touch session、account、station、applet session 等服务端上下文。
- 发起请求，返回去敏后的 status、headers、body。
- 记录 metadata-only audit。

禁止：

- Applet 直接读取 token。
- Applet 直接访问 Station internal API。
- Applet 直接读取或拼接 backend base URL。
- Host 记录 Authorization、Cookie、Set-Cookie、PII body。

Web Host 中，network proxy 由 BFF 或 Station endpoint 承担，不能退回 browser raw fetch 作为生产路径。

仅当 manifest 明确声明 `external-service` 且策略允许时，Gateway 才能代理外部网络请求。该路径不用于官方 Note applet 的业务 API。

### 7.1 Official Applet Service Deployment

官方 applet service 可有两个部署目标：

```text
Station bundled:
  Gateway -> current Station -> applet stationadapter -> applet service/application

Standalone:
  Gateway -> configured/discovered upstream -> standalone applet service -> applet service/application
```

两种部署目标必须保持同一 service name、API 语义、错误模型和授权语义。Applet 前端调用方式不随部署目标变化。

---

## 8. Storage Service

Storage 采用两级模型：

```text
Local applet storage
  → fast, per-device, per-applet namespace

Station applet data
  → cross-device, business truth, explicit API
```

规则：

- `storage.*` 默认只操作本地 namespace。
- 需要跨设备同步时，必须定义 Station API 或业务 capability。
- Storage key 不允许包含 `../`、绝对路径、控制字符。
- value 必须有 size limit。
- Host 必须支持 quota 查询与清理策略。

---

## 9. Config Service

Config 用于读取 Host/Station 下发的只读配置：

- feature flag。
- applet launch parameters。
- applet policy hints。
- theme and layout preferences。

Config 不是 secret store。任何 token、password、private key 不得通过 `config.get` 暴露给 Applet。

---

## 10. UI Service

UI service 由 Host 渲染：

- toast。
- loading。
- modal。
- action sheet。
- navigation bar。
- permission prompt。

原因：

- 保持 Desktop/Mobile/Web 的系统层级一致。
- 保持主题、无障碍、安全区域一致。
- 防止 Applet 伪造系统授权弹窗。

---

## 11. Audit Service

每次 invoke 至少记录：

```typescript
export interface AppletAuditEvent {
  appletId: string
  sessionId: string
  requestId: string
  method: string
  platform: 'desktop' | 'android' | 'ios' | 'harmony' | 'web'
  lifecycleState: string
  permissionDecision: 'allow' | 'deny'
  status: 'ok' | 'error'
  errorCode?: string
  durationMs: number
  timestamp: string
}
```

审计禁止记录：

- token。
- password。
- private key。
- Authorization/Cookie。
- PII body。

Host 先写本地审计队列，再异步上报 Station。离线时不得阻塞 Applet 主链路，但本地队列必须有容量和丢弃策略。

---

## 12. Distribution Service

分发闭环：

```text
Applet CI build
  → produce manifest + bundle + integrity
  → upload to Station Applet Store
  → Station validates package
  → Host syncs catalog
  → Host downloads bundle
  → Host verifies integrity
  → Runtime loads package
```

上线治理：

- Applet id 不可复用。
- 版本号必须 semver。
- bundle hash 必须不可变。
- 已撤回版本不能新装，但已安装实例按 policy 决定是否禁用。
- Host 必须支持 kill switch。

---

## 13. Verification

服务层验收：

- 未授权 method 返回 `PERMISSION_DENIED`。
- 无效 session 返回 `INVALID_SESSION`。
- network allowlist 拒绝不匹配 domain。
- storage 超 quota 返回 typed error。
- config 不暴露 secret。
- 每次 allowed/denied invoke 都产生 audit event。
- Station 撤回 applet 后，Host 不再启动新 session。
