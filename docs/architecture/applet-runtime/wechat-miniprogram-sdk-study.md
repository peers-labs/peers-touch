# WeChat Mini Program SDK Source Study

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Scope**: WeChat Mini Program SDK architecture study and Peers-Touch implementation reference

---

## 1. 研究边界

微信小程序基础库本体不是完整开源项目，无法源码级读取 WAService / WAWebview 的全量实现。因此本文的“源码级研究”限定在以下可验证材料：

- `miniprogram-api-typings@4.1.0`：官方维护的 TypeScript API 类型定义包。
- `miniprogram-simulate@1.6.1`：官方组件测试模拟器源码。
- 微信官方单元测试文档对双线程架构和 simulate 目标的说明。
- 公开基础库结构资料中对 WAService、WAWebview、WeixinJSBridge、Exparser 的说明。

不把不可读的基础库内部细节写成事实。

---

## 2. 微信小程序 SDK 的实际架构

### 2.1 分层总览

```text
Mini Program Source
  ├── app.js / app.json
  ├── pages/**.{js,json,wxml,wxss}
  ├── components/**.{js,json,wxml,wxss}
  └── npm packages

Base Library
  ├── WAService   # logic layer foundation
  ├── WAWebview   # view layer foundation
  ├── WeixinJSBridge
  ├── Exparser component model
  ├── wx global API object
  └── module system / plugin system

WeChat Native Host
  ├── route stack
  ├── storage
  ├── network
  ├── UI feedback
  ├── native components
  ├── permission prompts
  └── analytics / reporting
```

核心不是“一个 JS SDK 包”，而是“Host 注入基础库 + 全局 API + 组件模型 + Native Bridge + 双线程 runtime”。

### 2.2 逻辑层与视图层隔离

微信小程序公开资料反复确认其运行环境不是浏览器页面：

- 逻辑层在 JSCore/V8 等 JS 引擎中运行，没有完整 DOM/BOM。
- 渲染层在 WebView 或 Skyline 等渲染后端中运行。
- 两层通过 Native/Bridge 中转通信。
- `setData` 是逻辑层把 JSON 化数据传给视图层的核心通道。

这个设计换来的能力是：Host 可以中转 API 调用、路由、权限、渲染更新和用户事件。

---

## 3. `miniprogram-api-typings` 源码结构观察

`types/wx/index.d.ts` 使用 triple-slash references 将平台拆成多个声明模块：

```typescript
/// <reference path="./lib.wx.app.d.ts" />
/// <reference path="./lib.wx.page.d.ts" />
/// <reference path="./lib.wx.api.d.ts" />
/// <reference path="./lib.wx.cloud.d.ts" />
/// <reference path="./lib.wx.canvas.d.ts" />
/// <reference path="./lib.wx.component.d.ts" />
/// <reference path="./lib.wx.behavior.d.ts" />
/// <reference path="./lib.wx.event.d.ts" />
```

它暴露的全局入口包括：

```typescript
declare let wx: WechatMiniprogram.Wx
declare const require: Require
declare const requirePlugin: RequirePlugin
declare function requireMiniProgram(): any
declare let module: { exports: any }
declare let exports: any
```

结论：

- 微信 SDK 的开发者入口是全局 `wx`，不是 importable modular SDK。
- 类型系统按 App / Page / Component / Behavior / Event / API / Cloud / Canvas 拆分。
- `lib.wx.api.d.ts` 是巨大能力面，`lib.wx.app/page/component` 定义生命周期和运行时实例。
- `PromisifySuccessResult` 说明同一 API 支持 callback 与 Promise 两种调用风格。

---

## 4. App / Page / Component 模型

### 4.1 Page

`lib.wx.page.d.ts` 中 Page instance 由生命周期、实例属性、实例方法、data 和自定义字段组合：

```typescript
type Instance<TData, TCustom> =
  OptionalInterface<ILifetime> &
  InstanceProperties &
  InstanceMethods<TData> &
  Data<TData> &
  TCustom
```

Page 生命周期包括：

- `onLoad`
- `onShow`
- `onReady`
- `onHide`
- `onUnload`
- `onRouteDone`
- `onPullDownRefresh`
- `onReachBottom`
- `onPageScroll`
- `onResize`
- `onSaveExitState`

Page 实例还持有：

- `route`
- `options`
- `router`
- `pageRouter`
- `renderer: 'webview' | 'skyline'`

### 4.2 Component

`lib.wx.component.d.ts` 中 Component instance 是 properties、data、methods、behaviors 的组合，类型系统会把 Behavior 的 data/properties/methods 混入实例。

关键设计点：

- `properties` 是外部输入。
- `data` 是内部状态。
- `methods` 同时承载事件响应和自定义方法。
- `behaviors` 是复用机制，类型会传播到组件实例。
- `setData` 是唯一正式 UI 数据更新通道，要求数据可 JSON 化，并限制单次数据量。
- `triggerEvent` 是组件向外发事件的通道。
- `selectComponent` / `createSelectorQuery` 是受控查询能力，不是裸 DOM。

### 4.3 对我们的启发

Peers-Touch 不应复制 `App/Page/Component` 全局构造器，因为我们使用 ReactLynx。我们应吸收的是：

- 明确 runtime instance 上下文。
- 明确生命周期事件。
- 明确数据更新和事件边界。
- 明确组件不能直接拿 Host 私有对象。
- 明确复用能力必须有类型边界。

---

## 5. `wx` API 能力面

`miniprogram-simulate/src/api/index.js` 把 `wx` 模拟 API 按领域组织，源码中的注释本身就是能力分层：

- 基础。
- 系统。
- 更新。
- 小程序生命周期。
- 应用级事件。
- 调试。
- 性能。
- 分包加载。
- 路由。
- 跳转。
- 转发。
- 界面：交互、导航栏、背景、Tab Bar、字体、下拉刷新、滚动、动画、菜单、窗口。
- 网络：request、downloadFile、uploadFile、WebSocket、mDNS、TCP、UDP。
- 支付。
- 数据缓存。
- 数据分析。
- Canvas。
- 媒体：地图、图片、视频等。

这说明微信 SDK 的 API 设计不是按“Native 模块文件”暴露，而是按开发者意图和产品能力域暴露。

---

## 6. 异步 API 形态

`miniprogram-simulate/src/api/utils.js` 的 `mockAsyncAndPromise` 反映了微信 API 兼容风格：

```javascript
function mockAsyncAndPromise(name, data = {}, promiseData) {
  return (options = {}) => {
    const {success, fail, complete} = options
    if (!(success || fail || complete)) {
      return new Promise((resolve, reject) => {
        options.success = res => resolve(promiseData || res)
        options.fail = err => reject(err)
        runInAsync(options, { errMsg: `${name}:ok`, ...data })
      })
    }

    runInAsync(options, { errMsg: `${name}:ok`, ...data })
  }
}
```

结论：

- API 以 option object 为主。
- callback 风格保留 `success/fail/complete`。
- 未传 callback 时返回 Promise。
- 结果统一带 `errMsg` / `errCode` / `errno`。

Peers-Touch 应直接采用 Promise-first，不需要兼容 callback；但要学习其“统一 envelope + typed error + complete lifecycle”的稳定性。

---

## 7. `miniprogram-simulate` 的运行时模拟

`src/index.js` 的核心流程：

```text
load(componentPath)
  → register(componentPath)
  → read component.json
  → recursively load usingComponents
  → compile WXML
  → compile WXSS with scoped prefix
  → queue component JS
  → run component JS
  → global.Component(options)
  → jComponent.register(definition)
  → render(id)
  → jComponent.create(id, properties)
```

`definition.js` 注册内置组件时，把官方标签映射为 `wx-*` 组件：

```javascript
jComponent.register({
  id: name,
  tagName: `wx-${name}`,
  template: '<slot/>',
})
```

并注入全局 `wx`：

```javascript
if (typeof global.wx === 'object') global.wx = Object.assign(api, global.wx)
else global.wx = api
```

结论：

- 微信生态测试工具通过全局构造器与全局 `wx` 模拟运行时。
- `usingComponents` 是编译/加载期解析，不是运行时随意 import。
- 样式隔离通过编译阶段 prefix/scoping 处理。
- 内置组件是 Host/runtime 预注册能力。
- 测试时 API 可 mock；真实运行时 API 由 Host/native 执行。

---

## 8. 微信架构的可借鉴点

Peers-Touch 应借鉴：

1. **Host-injected base library**
   - Applet 不直接依赖平台对象。
   - Host 注入稳定 SDK/runtime context。

2. **Capability-oriented API**
   - API 按开发者意图命名，如 `network.request`、`storage.get`、`ui.showToast`。
   - 不把 Android/iOS/Desktop 模块名泄漏给 Applet。

3. **Lifecycle as first-class contract**
   - Applet、页面/容器、组件生命周期都要明确。
   - 生命周期要绑定 session state。

4. **Bridge is the governance point**
   - 所有敏感能力必须跨 Bridge。
   - Bridge 后面才是权限、审计、平台 handler。

5. **Runtime component registry**
   - 内置 UI 能力由 runtime 提供。
   - Applet 不能假设 DOM。

6. **Testing runtime**
   - 需要一个轻量 simulate runtime 来做 SDK contract test。
   - 不要求等同真实多线程 runtime，但要验证 API、生命周期、权限、错误。

---

## 9. 不应照搬的点

1. **不照搬全局 `wx`**
   - Peers-Touch 应使用 importable SDK：`import { sdk } from '@peers-touch/applet-sdk'`。
   - 可以提供 `pt` global 作为兼容，但不作为主入口。

2. **不照搬 callback API**
   - 使用 Promise-first。
   - 保留 `complete` 风格没有必要，会增加类型和错误复杂度。

3. **不照搬 WXML/WXSS/Page 架构**
   - 我们技术基线是 TypeScript + ReactLynx。
   - UI 层不需要 `Page()` / `Component()` 构造器。

4. **不照搬开放能力**
   - 微信的登录、支付、广告、订阅消息与微信生态绑定。
   - Peers-Touch 对应的是 identity、Station、federation、notification、agent/tool。

5. **不把 standalone 当生产**
   - 微信所有关键能力都在 Host 里。
   - 我们 Web 也必须是正式 Host，不是 raw browser fallback。

---

## 10. Peers-Touch 推荐实现架构

```text
Applet Source (TypeScript + ReactLynx)
  ├── presentation/
  ├── application/
  ├── domain/
  └── infrastructure/capability/
       │
       ▼
@peers-touch/applet-sdk
  ├── app
  ├── lifecycle
  ├── navigation
  ├── network
  ├── storage
  ├── ui
  ├── system
  ├── device
  ├── events
  └── bridge adapter
       │
       ▼
Runtime Host
  ├── Desktop Lynx for Web
  ├── Android LynxView
  ├── iOS LynxView
  ├── HarmonyOS reserved
  └── Web Host
       │
       ▼
Capability Gateway
  ├── session guard
  ├── manifest permission guard
  ├── policy guard
  ├── params validation
  ├── audit
  └── platform handlers
       │
       ▼
Station / Local Device Services
```

---

## 11. Peers-Touch SDK API 建议

微信 `wx` 是大对象；Peers-Touch SDK 应做小而稳定的 namespaces：

```typescript
export interface PeersAppletSDK {
  app: AppRuntimeAPI
  lifecycle: LifecycleAPI
  navigation: NavigationAPI
  network: NetworkAPI
  storage: StorageAPI
  ui: UIAPI
  system: SystemAPI
  device: DeviceAPI
  events: EventAPI
  invoke<T>(method: CapabilityMethod, params?: unknown): Promise<T>
}
```

首批能力：

- `app.getContext`
- `app.getLaunchOptions`
- `lifecycle.reportReady`
- `lifecycle.onShow/onHide/onPause/onResume/onDestroy`
- `navigation.openApplet/closeApplet/navigateTo/back`
- `network.request`
- `storage.get/set/remove/clear/getInfo`
- `ui.showToast/showLoading/hideLoading/showModal/showActionSheet`
- `system.getInfo/getTheme/getNetworkType`
- `device.getSafeArea/getWindowInfo`
- `events.on/emit/subscribe/unsubscribe`

---

## 12. Peers-Touch Runtime 实现建议

### 12.1 Base Library 注入

每个 Host 在创建 Lynx runtime 前注入：

```typescript
interface AppletRuntimeContext {
  appletId: string
  sessionId: string
  platform: 'desktop' | 'android' | 'ios' | 'harmony' | 'web'
  runtime: 'lynx' | 'lynx-web' | 'web-host'
  bridgeProtocol: 'peers-touch.applet.bridge'
  sdkVersion: string
  launchOptions: Record<string, unknown>
}
```

### 12.2 Bridge Envelope

```typescript
interface BridgeInvokeRequest {
  protocol: 'peers-touch.applet.bridge'
  appletId: string
  sessionId: string
  requestId: string
  method: string
  params?: unknown
}
```

### 12.3 Adapter

```text
LynxBridgeAdapter
  → NativeModules.bridge.invoke(envelope)

WebHostBridgeAdapter
  → globalThis.__PEERS_TOUCH_APPLET_HOST__.invoke(envelope)

StandaloneBridgeAdapter
  → dev-only local implementation
```

---

## 13. Peers-Touch 测试运行时建议

参考 `miniprogram-simulate`，我们应新增 `packages/applet-runtime-simulate`：

```text
packages/applet-runtime-simulate/
├── src/
│   ├── index.ts
│   ├── createRuntime.ts
│   ├── mockHost.ts
│   ├── mockGateway.ts
│   ├── lifecycle.ts
│   ├── capabilityRegistry.ts
│   └── assertions.ts
└── package.json
```

它不模拟 Lynx 渲染全量能力，只做 contract test：

- SDK adapter selection。
- lifecycle events。
- Bridge envelope shape。
- permission allowed/denied。
- typed error。
- storage/network/ui/system 的 handler dispatch。

---

## 14. 实施顺序

1. 先补 `packages/applet-contract`：
   - platform enum。
   - bridge envelope。
   - capability method。
   - error code。
   - lifecycle state。

2. 再重写 `packages/applet-sdk`：
   - Promise-first。
   - namespace API。
   - adapter。
   - typed errors。

3. 补 Host Gateway：
   - Desktop Rust 先完成 registry、permission、audit。
   - Android/iOS 对齐 method 和 error。
   - Web Host 独立实现 session + proxy。

4. 补 simulate runtime：
   - 让 SDK 和 Gateway contract 能在 CI 中跑。

5. 最后迁移真实 applet：
   - 使用 ReactLynx。
   - 禁止 DOM / iframe / postMessage。
   - 所有能力走 SDK。

---

## 15. 参考来源

- `miniprogram-api-typings@4.1.0` package source.
- `miniprogram-simulate@1.6.1` package source.
- WeChat Mini Program custom component unit testing documentation.
- Public WeChat Mini Program base library architecture articles covering WAService, WAWebview, WeixinJSBridge, Exparser and dual-thread runtime.

