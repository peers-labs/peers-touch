# Applet Runtime Architecture — 数据模型与协议

> **Status**: draft
> **Version**: v1.1
> **Created**: 2026-05-19 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/desktop/src/applet/`, `apps/mobile/`, `packages/applet-sdk/`, `packages/applets/`

---

## 1. Manifest

Manifest 是 Host 加载 Applet 的唯一声明真源。

```typescript
export interface AppletManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  icon: string
  minPlatformVersion?: string
  targetPlatforms: Array<'desktop' | 'android' | 'ios' | 'harmony' | 'web' | 'standalone'>
  runtime: {
    type: 'lynx'
    minEngineVersion?: string
  }
  load: {
    desktop?: {
      type: 'lynx-web'
      entry: string
    }
    android?: {
      type: 'lynx-native'
      entry: string
    }
    ios?: {
      type: 'lynx-native'
      entry: string
    }
    harmony?: {
      type: 'lynx-native'
      entry: string
    }
    web?: {
      type: 'lynx-web'
      entry: string
    }
    standalone?: {
      type: 'web-spa'
      entry: string
    }
  }
  bridge: {
    protocol: 'peers-touch.applet.bridge'
  }
  permissions: AppletPermission[]
  capabilities?: string[]
  integrity?: {
    algorithm: 'sha256'
    files: Record<string, string>
  }
}
```

示例：

```json
{
  "id": "sample-applet",
  "name": "Sample Applet",
  "version": "0.1.0",
  "description": "Sample applet package",
  "author": "Peers Touch",
  "icon": "chart",
  "targetPlatforms": ["desktop", "android", "ios", "web"],
  "runtime": {
    "type": "lynx",
    "minEngineVersion": "3.6.0"
  },
  "load": {
    "desktop": {
      "type": "lynx-web",
      "entry": "main.lynx.bundle"
    },
    "android": {
      "type": "lynx-native",
      "entry": "main.lynx.bundle"
    },
    "ios": {
      "type": "lynx-native",
      "entry": "main.lynx.bundle"
    },
    "web": {
      "type": "lynx-web",
      "entry": "main.lynx.bundle"
    }
  },
  "bridge": {
    "protocol": "peers-touch.applet.bridge"
  },
  "permissions": ["storage", "network", "config"]
}
```

`load` 字段规则：
- 每个 `targetPlatforms` 声明的平台必须在 `load` 中有对应入口。
- Host 只加载匹配自身平台的入口。
- `web` 是正式 Web Host 生产平台，必须具备 Host Gateway、session、权限和审计。
- `standalone` 是 applet 集合单体的独立运行出口，不是 Peers-Touch integrated 生产平台；它不证明 Host Gateway、session、权限和审计成立。
- `harmony` 是预留平台；Host 未实现前必须明确拒载，而不是 fallback 到 Web。
- 未来如果 Android 和 iOS 的 bundle 需要分化，已天然支持。

---

## 2. Applet Index

`index.json` 是 Host 扫描入口。

```typescript
export interface AppletIndex {
  generatedAt: string
  applets: AppletManifest[]
}
```

规则：

- Host 启动或刷新时读取 index。
- 每个 manifest 必须单独校验。
- 同 id 冲突时拒绝后出现者。
- 不支持目标平台的 applet 必须拒载。
- integrity 校验失败必须拒载。

---

## 3. Bundle Target

Applet 源码通过 Rspeedy 构建为两个目标：

```text
source: ReactLynx + applet-sdk
  ├── desktop target → main.lynx.bundle via Lynx for Web
  ├── mobile target  → main.lynx.bundle via native LynxView
  └── web target     → main.lynx.bundle via Web Host
```

约束：

- Desktop 只加载 `load.desktop.entry`。
- Android 只加载 `load.android.entry`。
- iOS 只加载 `load.ios.entry`。
- HarmonyOS 只加载 `load.harmony.entry`，未实现时拒载。
- Web Host 只加载 `load.web.entry`。
- Standalone dev mode 可加载 `load.standalone.entry`。
- bundle 来自同一源码提交。
- 构建产物必须写入 integrity map。

---

## 4. Bridge Protocol

Bridge 是 Host 与 Applet 的通信协议语义，不绑定具体传输实现。

### 4.1 Envelope

```typescript
export interface BridgeEnvelope {
  protocol: 'peers-touch.applet.bridge'
  appletId: string
  sessionId: string
  requestId: string
}
```

### 4.2 Invoke Request

```typescript
export interface BridgeInvokeRequest extends BridgeEnvelope {
  kind: 'invoke'
  method: CapabilityMethod
  params?: unknown
}
```

### 4.3 Invoke Response

```typescript
export interface BridgeInvokeResponse extends BridgeEnvelope {
  kind: 'response'
  ok: boolean
  result?: unknown
  error?: AppletBridgeError
}
```

### 4.4 Event (Host → Applet)

```typescript
export interface BridgeEvent extends BridgeEnvelope {
  kind: 'event'
  event: AppletEvent
  payload?: unknown
}

export type AppletEvent =
  | 'ready'
  | 'pause'
  | 'resume'
  | 'destroy'
  | 'themeChanged'
  | 'networkChanged'
  | string  // custom event topic
```

### 4.5 Event Subscription

Applet 可通过 invoke 订阅自定义事件流：

```typescript
// Applet 发起订阅
sdk.invoke('event.subscribe', { topic: 'market.realtime' })
sdk.invoke('event.unsubscribe', { topic: 'market.realtime' })
```

Host 通过 Lynx NativeModules 的 event callback 或等价机制向 Applet 推送事件。第一阶段只实现 lifecycle event，custom topic 预留接口。

### 4.6 协议演进规则

- method 只增不删
- params 只增字段，不改已有字段语义
- error code 只增不改已有 code 的含义
- 破坏性变更必须升级 `protocol` 字段（如 `peers-touch.applet.bridge.next`），但不以数字版本号命名

---

## 5. Capability Method

能力命名采用 `module.action`。

```typescript
export type CapabilityMethod =
  | 'system.getInfo'
  | 'storage.get'
  | 'storage.set'
  | 'storage.remove'
  | 'network.request'
  | 'config.get'
  | 'notification.show'
```

权限与 method 的关系：

| Permission | Allowed methods |
|------------|-----------------|
| `system` | `system.getInfo` |
| `storage` | `storage.get`, `storage.set`, `storage.remove` |
| `network` | `network.request` |
| `config` | `config.get` |
| `notification` | `notification.show` |

Host 可以按策略进一步限制：

- network allowlist
- storage quota
- notification rate limit
- config key allowlist

---

## 6. Error Model

```typescript
export interface AppletBridgeError {
  code:
    | 'APPLET_NOT_FOUND'
    | 'INVALID_MANIFEST'
    | 'UNSUPPORTED_PLATFORM'
    | 'UNSUPPORTED_RUNTIME'
    | 'INVALID_SESSION'
    | 'PERMISSION_DENIED'
    | 'INVALID_PARAMS'
    | 'CAPABILITY_NOT_FOUND'
    | 'CAPABILITY_FAILED'
    | 'INTEGRITY_CHECK_FAILED'
    | 'RUNTIME_LOAD_FAILED'
  message: string
  requestId?: string
  details?: Record<string, unknown>
}
```

规则：

- Applet 可见错误必须用户友好。
- Host 审计日志可包含技术细节，但不能包含 token、密码、PII。
- `PERMISSION_DENIED` 必须包含 applet id、method、request id。

---

## 7. Lifecycle State

```typescript
export type AppletLifecycleState =
  | 'discovered'
  | 'validated'
  | 'loading'
  | 'active'
  | 'paused'
  | 'destroyed'
  | 'invalid'
  | 'error'
```

状态机：

```text
discovered → validated → loading → active → paused → active
     │            │          │        │       │
     ▼            ▼          ▼        ▼       ▼
  invalid      invalid     error   destroyed destroyed
```

规则：

- `validated` 之前不能创建 Runtime。
- `loading` 必须有超时。
- `active` 才允许调用大多数 capability。
- `paused` 可允许 storage/config，默认禁止 notification。
- `destroyed` 后 session 失效。

---

## 8. Session

```typescript
export interface AppletSession {
  appletId: string
  sessionId: string
  state: AppletLifecycleState
  createdAt: string
  updatedAt: string
  platform: 'desktop' | 'android' | 'ios' | 'harmony' | 'web'
  grantedPermissions: AppletPermission[]
}
```

规则：

- session 由 Host 创建。
- session id 不由 Applet 自行生成。
- 每次 invoke 必须绑定 session。
- session 销毁后不能复用。

---

## 9. Storage Namespace

Applet storage 使用 per-applet namespace：

```text
applets/{applet-id}/storage/{key}
```

规则：

- Applet 只能访问自己的 namespace。
- Host 可以设置 quota。
- 删除 Applet 时可按策略清理 namespace。
- 跨 Applet 共享数据必须通过 Station 或明确的 Host capability，不允许直接读写其他 namespace。
