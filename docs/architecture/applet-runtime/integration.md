# Applet Runtime Architecture — 集成与迁移

> **Status**: draft
> **Version**: v1.1
> **Created**: 2026-05-19 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/desktop/src/applet/`, `apps/mobile/`, `packages/applet-sdk/`, `packages/applets/`

---

## 1. 集成目标

本迁移不追求兼容历史 iframe runtime，而是建立长期 Applet Runtime 主线：

```text
TypeScript + ReactLynx Applet Source
  → Rspeedy Lynx bundle
  → Desktop Lynx for Web / Mobile LynxView / Web Host
  → NativeModules bridge
  → Host Capability Gateway
```

验收口径：

- Desktop 不存在 iframe 加载 Applet 的正式代码路径。
- Desktop 不存在 `window.parent.postMessage` 作为 Applet bridge 主链。
- Applet 前端源码可为 Desktop、Mobile、Web 构建。
- Host 能审计每一次 capability 调用。
- 未声明权限的调用一律失败。
- HarmonyOS target 在未实现前必须明确拒载。

---

## 2. 与 Desktop 的集成

### 2.1 保留并强化

保留：

- `AppletManager` 的扫描、校验、诊断职责。
- `AppletRuntimePage` 的页面承载职责。
- `desktop_api.ts` 作为 frontend → Tauri API surface。
- `src-tauri` 的 `interface → application → domain → infrastructure` 分层。

强化：

- `LynxContainer / LynxHost` 必须变成 `<lynx-view>` 宿主。
- `applets_invoke` 必须成为 capability 唯一入口。
- Rust Gateway 必须实现 permission、session、audit、handler registry。

### 2.2 删除或替换

删除：

- iframe 创建逻辑。
- `window.message` applet bridge。
- `postMessage('*')`。
- 旧 `api-call/api-response` 协议。

替换：

- `load.entry: index.html` → `load.desktop.entry: main.lynx.bundle`
- React DOM Applet → ReactLynx Applet
- fetch/localStorage direct usage → applet-sdk capability usage

---

## 3. 与 Mobile 的集成

Android：

- 新增 Applet feature module。
- 初始化 Lynx 环境。
- 使用 `LynxView` 加载 `main.lynx.bundle`。
- 注入 `bridge` NativeModule。
- Gateway 执行 storage/network/config/system。

iOS：

- 新增 Applet feature module。
- 初始化 Lynx 环境。
- 使用 `LynxView` 加载 `main.lynx.bundle`。
- 注入同名 `bridge` NativeModule。
- Gateway 行为与 Android 对齐。

Mobile 不应通过 WebView 承载 Applet。Desktop、Mobile、Web 可消费同一 ReactLynx 源码产出的 Lynx bundle，但各端 Host 的加载方式和 Gateway 实现不同。

---

## 4. 与 Web / HarmonyOS 的集成

Web：

- 新增正式 Web Host，而不是使用 standalone fallback 作为生产路径。
- Web Host 必须创建 session、注入 `globalThis.__PEERS_TOUCH_APPLET_HOST__`、执行 Gateway/BFF 权限校验。
- Web Host 的 `network.request` 必须走 proxy，不允许退回 raw browser fetch 访问内部服务。

HarmonyOS：

- Manifest 预留 `targetPlatforms: ["harmony"]` 与 `load.harmony`。
- 未完成 Lynx Harmony adapter、ArkTS bridge、Gateway 前，Host 必须返回 unsupported platform。
- 不允许为了兼容 HarmonyOS 而把 Mobile Applet fallback 到 WebView。

---

## 5. 与 Applet Package 的集成

Peers-Touch 不引用任何具体 applet package producer。所有 applet 都必须先产出符合 `applet-contract` 的 package，再进入 Host runtime。

Integrated package 目标结构：

```text
applet-package/
├── manifest.json
├── main.lynx.bundle
├── assets/
└── integrity.json
```

Host 集成规则：

- Host 只读取 package contract，不读取 producer 目录结构。
- Standalone 运行能力属于 package producer 自身，不进入 Peers-Touch integrated 验收口径。
- 所有敏感能力必须通过 `@peers-touch/applet-sdk` 进入 Host Gateway。
- package 不得依赖 DOM、iframe、`window.parent.postMessage` 或 Host 私有对象。

---

## 6. 迁移阶段

### Phase 0: Contract Freeze

交付：

- Manifest target 字段稳定。
- Bridge method 命名稳定。
- Capability permission matrix 稳定。
- Desktop / SDK / build pipeline 共享契约。

验收：

- 非法 manifest 会被构建期和运行期拒绝。
- `runtime.type !== 'lynx'` 会被拒绝。
- 当前平台缺少对应 `load.<platform>.entry` 会被拒绝。
- `load.<platform>.type` 必须匹配平台：Desktop/Web 为 `lynx-web`，Android/iOS/HarmonyOS 为 `lynx-native`，Standalone 为 `web-spa`。
- `standalone` 是 applet 集合单体的独立运行出口，不作为 Peers-Touch integrated 生产平台。

### Phase 1: Desktop Lynx Host POC

交付：

- Desktop 安装 `@lynx-js/web-core`。
- `<lynx-host>` 内部创建 `<lynx-view>`。
- `onNativeModulesCall` 转发到 `api.appletInvoke`。
- hello applet 能加载 `main.lynx.bundle`。

验收：

- 无 iframe。
- 无 applet postMessage。
- 能触发 `system.getInfo`。

### Phase 2: SDK BridgeAdapter

交付：

- `packages/applet-sdk` 改为 BridgeAdapter 架构。
- 提供 storage/network/config/system API。
- 错误码归一。

验收：

- Applet 源码不直接访问 NativeModules。
- SDK 在 Desktop Lynx for Web 中可通过 `LynxBridgeAdapter` 调用 Gateway。
- SDK 在 standalone 模式中可通过 `StandaloneBridgeAdapter` 独立运行，但该路径不证明 Host Gateway 权限与审计。
- SDK 在 Web Host 中可通过 `WebHostBridgeAdapter` 调用 Gateway。

### Phase 3: First Package Acceptance

交付：

- 准备一个符合 `applet-contract` 的 sample applet package。
- sample package 通过 `@peers-touch/applet-sdk` 调用真实后端或本地测试服务。
- Desktop 中通过 `<lynx-view>` 渲染。

验收：

- sample package 能在 Desktop 展示。
- 网络请求走 Gateway。
- 权限未声明时请求失败。

### Phase 4: Mobile Host

交付：

- Android AppletContainerView。
- iOS AppletContainerView。
- 加载同一源码构建出的 `main.lynx.bundle`。

验收：

- 同一 sample package 能在 Android / iOS / Web 运行。
- Bridge 行为与 Desktop 一致。

### Phase 5: Advanced Capabilities

交付：

- notification、theme、network status、storage quota。
- bundle integrity。
- applet install/update。
- complex chart strategy。

验收：

- CI contract test 覆盖 Desktop/Mobile/SDK。
- Applet 生命周期可观测。

---

## 7. 构建与分发链路

### 6.1 构建工具

| 工具 | 角色 |
|------|------|
| `@lynx-js/rspeedy` | Applet 构建主工具 |
| `@lynx-js/react-rsbuild-plugin` | ReactLynx 编译插件 |
| `lynx.config.ts` | 声明 web / lynx 双构建目标 |
| `applet-contract/scripts/generate-schemas.ts` | 从 TypeScript 生成 JSON Schema |

### 6.2 构建产物

```text
applets/<applet-id>/dist/
├── main.lynx.bundle       # Desktop Lynx for Web / Mobile LynxView / Web Host
├── index.html             # Standalone 浏览器运行
└── integrity.json         # 哈希校验表
```

规则：
- 三个 bundle 来自同一源码同一次构建。
- `integrity.json` 自动生成，内容为 `{ "main.lynx.bundle": "sha256:...", ... }`。
- 构建完成后写入 `applet.json` 的 `integrity.files`。

### 6.3 开发期（Dev）

```text
Applet 开发者本地
  → rspeedy dev --env web
  → localhost:3000 启动 Lynx for Web dev server
  → Desktop Tauri 中 <lynx-view url="http://localhost:3000/main.lynx.bundle">
  → HMR 通过 Lynx for Web 的 dev protocol 支持
```

开发期工作流：
- `applet-sdk` 在 standalone 模式下直接 `fetch` + `localStorage`，无需启动 Desktop；该模式属于独立运行出口。
- 如果要联调 Desktop Gateway，启动 Tauri dev，`<lynx-host>` 指向本地 dev server URL。
- Rspeedy 的 `--env lynx` 模式可用 Lynx DevTool 模拟器调试 Mobile 效果。

### 6.4 生产期（Desktop）

```text
CI 构建
  → rspeedy build
  → dist/main.lynx.bundle + dist/index.html
  → 复制 dist/ 到 peers-touch/apps/desktop/applets-dist/<applet-id>/
  → 重新生成 applets-dist/index.json
  → Desktop 打包时 Tauri 将 applets-dist/ 打入应用资源
```

Desktop 加载路径：
- Tauri custom protocol `asset://applets-dist/<applet-id>/main.lynx.bundle`
- 或 file-based: `{resource_dir}/applets-dist/<applet-id>/main.lynx.bundle`
- 具体取决于 Tauri asset resolver 配置

### 6.5 生产期（Mobile）

```text
CI 构建
  → rspeedy build
  → dist/main.lynx.bundle
  → 复制到 Mobile 工程的 assets/applets/<applet-id>/
  → APK/IPA 打包时打入 assets
```

Mobile 加载路径：
- Android: `file:///android_asset/applets/<applet-id>/main.lynx.bundle`
- iOS: `Bundle.main.path(forResource: "applets/<applet-id>/main.lynx", ofType: "bundle")`

未来可支持远程 bundle 下载（OTA），但第一阶段只做 bundled-in-app。

### 6.6 版本管理

- **bundle 版本 = `applet.json` 中的 `version` 字段**。
- Desktop 和 Mobile 中 `index.json` 记录每个 applet 当前部署版本。
- CI 确保 Desktop `applets-dist/` 和 Mobile `assets/applets/` 中的 bundle 来自同一 commit。
- 多端版本不一致时，Host 按 `minPlatformVersion` 决定是否拒载。
- Applet 版本遵循 semver：patch = bug fix，minor = new feature，major = breaking SDK。

### 6.7 Standalone 分发

独立运行模式（开发调试 / 第三方小程序平台）：
- 产物为 `index.html` + JS bundle（标准 SPA）。
- 可部署到任何静态服务器。
- SDK 自动 fallback 到 `StandaloneBridgeAdapter`。
- 不经过 Host Gateway，直接 fetch 后端。
- Standalone 不享受 Host Gateway 安全治理；后端必须自行完成鉴权、CORS、限流和审计。

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Lynx for Web 在 Tauri Webview 中存在兼容问题 | Desktop POC 失败或不稳定 | 先做最小 POC，验证 Worker、asset path、custom protocol |
| React DOM 存量 UI 接入成本高 | sample package 延期 | Peers-Touch integrated package 必须以 ReactLynx / Lynx bundle 为验收对象 |
| SDK 与 Host 协议漂移 | Applet 生态不可维护 | 引入 `applet-contract` 和 contract test |
| 三端 Gateway 行为不一致 | Applet 跨端 bug | 权限矩阵和错误码作为架构协议固化 |
| Lynx 组件生态不足 | 复杂 UI 受限 | 先使用 Lynx 原生布局，复杂组件专项评估 |

---

## 8. 不做什么

不做：

- 不做 iframe fallback。
- 不做 React DOM Applet 作为正式跨端主线。
- 不做 WebView Mobile Applet。
- 不做 Applet 直接调用 Station 内部接口。
- 不做前端权限判断替代 Host Gateway。
- 不为了兼容旧 demo 保留双 bridge 协议。

---

## 9. 完成定义

架构完成定义：

- 文档真源完整：design / decisions / module-layout / data-model / integration。
- Desktop Host 真正使用 Lynx for Web。
- Mobile Host 真正使用 LynxView。
- SDK 对 Applet 暴露跨端一致 API。
- Gateway 是能力唯一执行点。
- sample package 能用同一 bundle 在 Desktop + 至少一个 Mobile 端运行。
