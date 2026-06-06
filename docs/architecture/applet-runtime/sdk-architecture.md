# Applet Runtime Architecture — SDK 架构

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `packages/applet-sdk/`, `packages/applet-contract/`, `packages/applets/`

---

## 1. 设计目标

Peers-Touch Applet SDK 的目标不是复刻微信小程序运行时，而是吸收其稳定 API 分层：

- Applet 业务代码只依赖 SDK，不依赖 Desktop、Android、iOS、HarmonyOS、Web 的私有桥接对象。
- SDK 表达 Applet 的调用意图，Host Capability Gateway 执行权限、审计和平台能力。
- API 面按能力域组织，方法名稳定、参数可演进、错误可归一。
- Lynx / TypeScript 是正式技术基线，ReactLynx 是 UI 层推荐入口。
- Web Host 是 Peers-Touch integrated 的正式 Web 环境；Standalone 是 applet 的非集成独立运行出口，不能替代 Host Gateway 验收。

非目标：

- 不提供 Browser DOM、React DOM、iframe、`window.parent.postMessage` 作为正式 Applet 能力。
- 不把微信小程序的账号体系、支付、广告、云开发照搬进 Peers-Touch。
- 不允许 SDK 自行绕过 Host Gateway 执行敏感能力。

---

## 2. 参考微信小程序后的能力分层

微信小程序 SDK 的可借鉴点是能力域清晰：生命周期、路由、网络、存储、界面反馈、设备、文件、媒体、开放能力。Peers-Touch 采用同样的领域拆分，但每个能力都必须进入 Host Gateway。

| 微信小程序能力域 | Peers-Touch SDK 域 | v1 取舍 |
|------------------|-------------------|---------|
| App/Page 生命周期 | `lifecycle` | 必须支持，用于 ready/pause/resume/destroy |
| 路由与页面栈 | `navigation` | Host 内 Applet 页面导航，v1 支持基础 open/close |
| 网络请求 | `network` | 必须支持，只允许 Host 代理请求 |
| 本地缓存 | `storage` | 必须支持，per-applet namespace |
| 界面反馈 | `ui` | 必须支持 toast/loading/modal/actionSheet 的 Host 实现 |
| 系统信息 | `system` | 必须支持，暴露去敏后的平台信息 |
| 设备能力 | `device` | v1 只读状态；高风险能力后续单独授权 |
| 文件系统 | `file` | v1 预留，需 quota 与沙箱目录 |
| 媒体 | `media` | v1 预留，先不进入首批能力 |
| 剪贴板 | `clipboard` | v1 可选，高风险时需用户动作触发 |
| 分享 | `share` | v1 预留，绑定 Peers-Touch 社交模型 |
| 登录/用户 | `account` | 不照搬微信登录，使用 Peers-Touch identity/session |
| 支付/广告 | none | 非目标 |
| 云开发 | none | 由 Station subserver / MCP / Tool 体系承担 |
| 无直接等价 | `skills` | Peers-Touch 特有，首批复杂 applet 验收必须支持 |
| 无直接等价 | `tasks` | Peers-Touch 特有，首批复杂 applet 验收必须支持长任务和取消 |
| 无直接等价 | `agent` / `ai` | Peers-Touch 特有，首批复杂 applet 验收必须支持受控 Agent/LLM |
| 数据分析/上报 | `telemetry` | 只暴露 applet diagnostics，不暴露 Host system logs 或 audit writer |

---

## 3. SDK 分层

```text
Applet Source
  ├── presentation/ReactLynx
  ├── application/use cases
  └── infrastructure/capability ports
       │
       ▼
packages/applet-sdk
  ├── public capability APIs
  ├── typed request/response objects
  ├── error normalization
  ├── event bus
  └── BridgeAdapter
       │
       ├── LynxBridgeAdapter          # Desktop Lynx for Web / Mobile LynxView
       ├── WebHostBridgeAdapter       # Web Host injected bridge
       ├── StandaloneBridgeAdapter    # non-integrated standalone outlet
       └── WxBridgeAdapter            # third-party compatibility, not Host truth
```

SDK 公开层不得暴露 adapter 实现细节。Applet 可以在测试中注入 adapter，但生产代码只能通过 `createAppletSDK()` 或默认 `sdk` 实例获取能力。

---

## 4. Public API Shape

SDK 采用 Promise-first 风格，保留 callback adapter 的空间但不作为主 API。原因是 Peers-Touch 需要跨 Lynx、Tauri、native plugin、Web Host 统一错误传播。

```typescript
export interface PeersAppletSDK {
  readonly app: AppRuntimeAPI
  readonly lifecycle: LifecycleAPI
  readonly navigation: NavigationAPI
  readonly network: NetworkAPI
  readonly storage: StorageAPI
  readonly config: ConfigAPI
  readonly system: SystemAPI
  readonly ui: UIAPI
  readonly device: DeviceAPI
  readonly clipboard: ClipboardAPI
  readonly file: FileAPI
  readonly events: EventAPI
  readonly skills: SkillAPI
  readonly tasks: TaskAPI
  readonly agent: AgentAPI
  readonly ai: AIAPI
  readonly telemetry: TelemetryAPI
  invoke<T>(method: CapabilityMethod, params?: unknown): Promise<T>
}
```

### 4.1 App Runtime

```typescript
export interface AppRuntimeAPI {
  getContext(): AppletRuntimeContext
  getLaunchOptions(): Promise<AppletLaunchOptions>
}

export interface AppletRuntimeContext {
  appletId: string
  sessionId: string
  platform: 'desktop' | 'android' | 'ios' | 'harmony' | 'web'
  runtime: 'lynx' | 'lynx-web' | 'web-host'
  sdkVersion: string
  bridgeProtocol: 'peers-touch.applet.bridge'
}
```

### 4.2 Lifecycle

```typescript
export interface LifecycleAPI {
  onReady(handler: () => void): Unsubscribe
  onShow(handler: () => void): Unsubscribe
  onHide(handler: () => void): Unsubscribe
  onPause(handler: () => void): Unsubscribe
  onResume(handler: () => void): Unsubscribe
  onDestroy(handler: () => void): Unsubscribe
  reportReady(): Promise<void>
}
```

`onShow/onHide` 对齐小程序页面可见性语义；`onPause/onResume` 对齐 Host session 状态。Host 可以把 Desktop tab 切换、Mobile app background、Web page visibility 映射为同一事件。

### 4.3 Navigation

```typescript
export interface NavigationAPI {
  openApplet(input: OpenAppletInput): Promise<void>
  closeApplet(reason?: string): Promise<void>
  navigateTo(input: NavigateToInput): Promise<void>
  redirectTo(input: NavigateToInput): Promise<void>
  back(delta?: number): Promise<void>
}
```

导航能力由 Host 执行。Applet 只表达意图，不直接操作 Desktop router、Mobile route 或 Web history。

### 4.4 Network

```typescript
export interface NetworkAPI {
  request<T = unknown>(input: NetworkRequest): Promise<NetworkResponse<T>>
  upload(input: UploadRequest): Promise<UploadResponse>
  download(input: DownloadRequest): Promise<DownloadResponse>
}
```

网络请求必须经过 Host：

- Host 校验 permission、domain allowlist、method、headers、body size。
- Host 注入必要的 Peers-Touch session，不向 Applet 暴露 token。
- Host 审计请求目标、状态码、耗时；禁止记录敏感 body。

### 4.5 Storage

```typescript
export interface StorageAPI {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
  keys(prefix?: string): Promise<string[]>
  getInfo(): Promise<StorageInfo>
}
```

Storage 是 per-applet namespace。跨 Applet 共享必须通过 Station 或显式 Host capability，不能直接访问其他 namespace。

### 4.6 UI

```typescript
export interface UIAPI {
  showToast(input: ToastOptions): Promise<void>
  showLoading(input?: LoadingOptions): Promise<void>
  hideLoading(): Promise<void>
  showModal(input: ModalOptions): Promise<ModalResult>
  showActionSheet(input: ActionSheetOptions): Promise<ActionSheetResult>
  setNavigationBar(input: NavigationBarOptions): Promise<void>
}
```

UI feedback 由 Host 渲染，而不是 Applet 自建全局浮层。这样 Desktop、Mobile、Web 能统一主题、安全区域、无障碍和窗口层级。

### 4.7 System / Device

```typescript
export interface SystemAPI {
  getInfo(): Promise<SystemInfo>
  getTheme(): Promise<'light' | 'dark' | 'system'>
  getNetworkType(): Promise<NetworkType>
}

export interface DeviceAPI {
  getSafeArea(): Promise<SafeArea>
  getWindowInfo(): Promise<WindowInfo>
  vibrate(input?: VibrationOptions): Promise<void>
}
```

Device v1 只允许低风险能力。定位、相机、麦克风、联系人等高风险能力必须单独 ADR，并要求用户动作触发。

### 4.8 Events

```typescript
export interface EventAPI {
  on<T = unknown>(topic: string, handler: (payload: T) => void): Unsubscribe
  off(topic: string): void
  emit<T = unknown>(topic: string, payload?: T): Promise<void>
  subscribe(topic: string): Promise<void>
  unsubscribe(topic: string): Promise<void>
}
```

`emit` 是 Applet → Host；Host → Applet 事件通过 Bridge event 推送。实时业务流第一阶段只支持 Host 白名单 topic。

### 4.9 Skills

```typescript
export interface SkillAPI {
  register(spec: SkillSpec): Promise<void>
  list(): Promise<SkillDescriptor[]>
  invoke<TInput, TOutput>(skillId: string, input: TInput, options?: SkillInvokeOptions): Promise<SkillResult<TOutput>>
  onStream(skillId: string, handler: (event: SkillStreamEvent) => void): Unsubscribe
}
```

`skills` 是 Peers-Touch 首批复杂 applet 验收能力。它不是微信小程序能力的照搬，而是 Peers-Touch 对 applet 暴露平台基建的核心方式。

规则：

- Skill 必须有稳定 id、输入 schema、展示元数据和错误模型。
- Skill 可以在 manifest 声明，也可以在 runtime 注册，但两者必须进入同一 Host Skill Registry。
- Host/Station policy 可以隐藏、禁用或限流某个 skill。
- Applet 不能直接访问内部 skill registry、tool executor、LLM provider key 或 Agent runtime。

### 4.10 Tasks

```typescript
export interface TaskAPI {
  start<TInput>(input: TaskStartInput<TInput>): Promise<TaskHandle>
  get(taskId: string): Promise<TaskSnapshot>
  cancel(taskId: string): Promise<void>
  onEvent(taskId: string, handler: (event: TaskEvent) => void): Unsubscribe
}
```

长耗时分析、导入、回测、Agent work 不能被建模成一个单次阻塞 `network.request`。Task lifecycle 至少包含：

```text
queued → running → progress* → completed | failed | cancelled
```

### 4.11 Agent / AI

```typescript
export interface AgentAPI {
  startSession(input: AgentSessionInput): Promise<AgentSession>
  send(input: AgentMessageInput): Promise<AgentMessageResult>
  stream(input: AgentMessageInput, handler: (event: AgentStreamEvent) => void): Promise<AgentMessageResult>
}

export interface AIAPI {
  generate(input: GenerateInput): Promise<GenerateResult>
  chat(input: ChatInput): Promise<ChatResult>
}
```

Agent / AI API 必须走 Gateway。Applet 只获得受控 capability，不获得模型 token、provider key、内部 prompt、tool registry 或 agent memory。

### 4.12 Telemetry

```typescript
export interface TelemetryAPI {
  track(event: TelemetryEvent): Promise<void>
  reportError(error: DiagnosticError): Promise<void>
  mark(input: PerformanceMark): Promise<void>
}
```

Telemetry 是 applet diagnostics。Audit 由 Host/Gateway 写入，SDK 不提供 audit write API。

---

## 5. Method 命名规范

Capability method 统一使用 `domain.action`：

```text
app.getContext
lifecycle.reportReady
navigation.openApplet
network.request
storage.get
ui.showToast
system.getInfo
device.getSafeArea
clipboard.setText
file.read
events.subscribe
skills.register
skills.invoke
tasks.start
tasks.cancel
agent.stream
ai.chat
telemetry.track
```

规则：

- method 只增不删。
- 同名 method 的语义不能变。
- params 只能新增 optional 字段。
- response 可以新增 optional 字段，但不能删除或改变已有字段语义。
- breaking change 必须升级 bridge protocol，而不是只 bump npm version。

---

## 6. Adapter 选择

| Host | Adapter | Bridge 入口 |
|------|---------|------------|
| Desktop | `LynxBridgeAdapter` | Lynx for Web `NativeModules.bridge.invoke` |
| Android | `LynxBridgeAdapter` | LynxView NativeModule |
| iOS | `LynxBridgeAdapter` | LynxView NativeModule |
| HarmonyOS | `LynxBridgeAdapter` reserved | ArkTS native module / Lynx Harmony adapter |
| Web | `WebHostBridgeAdapter` | Host injected `globalThis.__PEERS_TOUCH_APPLET_HOST__` |
| Development | `StandaloneBridgeAdapter` | local fetch/localStorage fallback |

Adapter 检测顺序：

1. Lynx NativeModules。
2. Peers-Touch Web Host injection。
3. Standalone development fallback。
4. Third-party compatibility adapter, only when explicitly enabled.

---

## 7. 错误模型

SDK 对 Applet 抛出 typed error：

```typescript
export interface AppletSDKError {
  code: AppletErrorCode
  method?: CapabilityMethod
  requestId?: string
  retryable: boolean
  userMessageKey?: string
}
```

SDK 不直接内置用户可见自然语言。UI 层如果需要展示错误，必须使用 locale key。

---

## 8. SDK 与微信小程序的关键差异

| 差异点 | Peers-Touch 决策 |
|--------|------------------|
| 登录 | 不提供 `wx.login` 语义；使用 Peers-Touch Host session 和 Station identity |
| DOM | 不提供 DOM API；UI 层是 Lynx |
| 权限 | Manifest 是上限，Host runtime 才是最终授权点 |
| 网络 | 不向 Applet 暴露 token，不允许直接请求内部服务 |
| 数据 | 本地 storage 仅 per-applet；共享业务真源归 Station |
| 分发 | Station applet store 管理 manifest、bundle、integrity、版本 |
| Web | Web 是正式 Host，不是 iframe fallback |

---

## 9. 首批 SDK 交付范围

基础 MVP 必须交付：

- `app.getContext`
- `lifecycle.onReady/onShow/onHide/onDestroy/reportReady`
- `network.request`
- `storage.get/set/remove/clear/getInfo`
- `config.get`
- `system.getInfo/getTheme/getNetworkType`
- `ui.showToast/showLoading/hideLoading/showModal`
- `events.on/subscribe/unsubscribe`

复杂 applet 首批验收还必须交付：

- `skills.register/list/invoke/onStream`
- `tasks.start/get/cancel/onEvent`
- `agent.startSession/send/stream`
- `ai.generate/chat`
- `telemetry.track/reportError/mark`
- service binding + `config.get` 联动

可预留但不进入首批复杂验收：

- `file.*`
- `media.*`
- `share.*`
- high-risk `device.*`
- payment / ads / cloud equivalents
