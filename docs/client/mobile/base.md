# Peers Touch Mobile

## PREFACE

本项目是 Peers-Touch 去中心化社交网络的移动端客户端，采用 **Android（Kotlin + Jetpack Compose）** 与 **iOS（Swift + SwiftUI）** 双端独立原生实现。不使用 Kotlin Multiplatform（KMP），各端完全独立开发，通过共享 Proto 定义、API 契约和 Applet SDK 保持业务一致性。

旧版 Flutter + GetX 移动端已归档至 `apps/mobile/flutter/`，不再作为主线开发基础。

功能范围与 Desktop 端（Tauri + React/TS + Rust）全量对等，但 Notebook 和 Cron 将以 Applet 形态运行，不纳入原生模块实现。Desktop 端的 Rust 命令层不引入 Mobile；Mobile 用各自原生语言实现业务逻辑层。

UI 整体遵循 LobeChat 风格，交互与动效适配移动端手势与屏幕密度。

---

## 技术栈约束

| 维度 | Android | iOS |
| --- | --- | --- |
| 语言 | Kotlin | Swift |
| UI 框架 | Jetpack Compose | SwiftUI |
| 构建工具 | Gradle (Kotlin DSL) | Xcode + Swift Package Manager (SPM) |
| 最低版本 | Android 8.0 (API 26) | iOS 15.0 |
| 架构模式 | MVVM + Repository | MVVM + Repository |
| 依赖注入 | Hilt | 原生 Swift DI / Swinject |
| 网络层 | Retrofit + OkHttp | URLSession / Alamofire |
| 本地存储 | Room + DataStore | SwiftData / CoreData + UserDefaults |
| 序列化 | protobuf-kotlin / kotlinx.serialization | SwiftProtobuf / Codable |
| 异步 | Kotlin Coroutines + Flow | Swift Concurrency (async/await) + Combine |
| 图片加载 | Coil | Kingfisher / Nuke |
| 导航 | Jetpack Navigation Compose | NavigationStack |
| Applet 容器 | Lynx (Maven: org.lynxsdk.lynx) | Lynx (CocoaPods: pod 'PrimJS') |
| Proto 生成 | protoc --kotlin_out | protoc --swift_out |

---

## 核心架构原则

1. **双端独立，契约统一**：Android 与 iOS 各自独立实现全部业务逻辑，通过共享 Proto 定义（`model/domain/`）、API 契约和 Applet SDK（`@peers-touch/applet-sdk`）保持语义一致。
2. **分层清晰，单向依赖**：View → ViewModel → Repository → DataSource（Remote / Local），禁止反向依赖。
3. **Station 为真源**：跨端可见状态的单一真源在 Station，Mobile 端做编排与体验，不维护独立领域真相。参见 `docs/architecture/station-desktop-scope-boundary.md`。
4. **不走 P2P，走 Station Relay**：Mobile 端所有网络通信通过 Station Relay 中继，不实现 P2P 直连。
5. **模块内聚、低耦合**：业务模块自包含（View / ViewModel / Repository / Model 同目录），禁止直接引用其他模块内部实现。
6. **Applet 化**：Notebook 和 Cron 通过 Lynx Applet 容器运行，不纳入原生模块。
7. **功能对等 Desktop**：功能范围与 Desktop 全量对等，具体模块清单见下文。

---

## Android 项目结构（MVVM + Jetpack Compose）

```
apps/mobile/android/
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── java/com/peerstouch/mobile/
│       │   ├── PeersTouchApp.kt
│       │   ├── MainActivity.kt
│       │   ├── di/                          # Hilt 模块
│       │   │   ├── AppModule.kt
│       │   │   ├── NetworkModule.kt
│       │   │   └── DatabaseModule.kt
│       │   ├── navigation/                  # 导航图
│       │   │   ├── AppNavGraph.kt
│       │   │   ├── BottomNavBar.kt
│       │   │   └── Routes.kt
│       │   ├── core/                        # 全局通用（无业务倾向）
│       │   │   ├── network/                 # Retrofit + OkHttp 封装
│       │   │   ├── storage/                 # Room + DataStore 封装
│       │   │   ├── proto/                   # protoc --kotlin_out 生成产物
│       │   │   ├── theme/                   # Material 3 主题 Token
│       │   │   ├── components/              # 通用 UI 组件
│       │   │   ├── util/                    # 纯工具类
│       │   │   └── constants/               # 全局常量
│       │   ├── features/                    # 业务模块
│       │   │   ├── chat/                    # 私聊 + 群聊
│       │   │   │   ├── ui/                  # Composable
│       │   │   │   ├── viewmodel/
│       │   │   │   ├── repository/
│       │   │   │   └── model/
│       │   │   ├── ai/                      # AI Chat
│       │   │   ├── applets/                 # Applet 市场 + Lynx 容器
│       │   │   ├── search/                  # 全局搜索
│       │   │   ├── memory/                  # 记忆管理
│       │   │   ├── timeline/                # 社交动态
│       │   │   ├── channels/                # 频道
│       │   │   ├── profile/                 # 个人资料
│       │   │   ├── settings/                # 设置中心
│       │   │   ├── auth/                    # 认证 + 登录
│       │   │   ├── skills/                  # 技能市场
│       │   │   └── shared/                  # 跨模块共享组件
│       │   └── applet/                      # Lynx 容器宿主层
│       │       ├── LynxContainerView.kt
│       │       ├── AppletBridge.kt
│       │       └── AppletManager.kt
│       └── res/
├── gradle/
└── settings.gradle.kts
```

约束：
* `core/` 不可包含业务倾向；`features/` 目录名体现业务语义
* 每个 feature 模块自包含 `ui/viewmodel/repository/model` 四层
* ViewModel 通过 Hilt `@HiltViewModel` 注入，Repository 通过 `@Inject` 提供
* Compose 函数保持纯渲染，状态通过 StateFlow 驱动

---

## iOS 项目结构（MVVM + SwiftUI）

```
apps/mobile/ios/
├── PeersTouch.xcodeproj
├── PeersTouch/
│   ├── App/
│   │   ├── PeersTouchApp.swift
│   │   └── AppDelegate.swift
│   ├── DI/                                  # 依赖注入容器
│   │   └── Container.swift
│   ├── Navigation/                          # 导航
│   │   ├── AppTabView.swift
│   │   ├── Router.swift
│   │   └── Routes.swift
│   ├── Core/                                # 全局通用（无业务倾向）
│   │   ├── Network/                         # URLSession / Alamofire 封装
│   │   ├── Storage/                         # SwiftData / CoreData + UserDefaults
│   │   ├── Proto/                           # protoc --swift_out 生成产物
│   │   ├── Theme/                           # 语义化 Token（适配 Apple HIG）
│   │   ├── Components/                      # 通用 UI 组件
│   │   ├── Util/                            # 纯工具类
│   │   └── Constants/                       # 全局常量
│   ├── Features/                            # 业务模块
│   │   ├── Chat/                            # 私聊 + 群聊
│   │   │   ├── Views/                       # SwiftUI View
│   │   │   ├── ViewModels/
│   │   │   ├── Repositories/
│   │   │   └── Models/
│   │   ├── AI/                              # AI Chat
│   │   ├── Applets/                         # Applet 市场 + Lynx 容器
│   │   ├── Search/                          # 全局搜索
│   │   ├── Memory/                          # 记忆管理
│   │   ├── Timeline/                        # 社交动态
│   │   ├── Channels/                        # 频道
│   │   ├── Profile/                         # 个人资料
│   │   ├── Settings/                        # 设置中心
│   │   ├── Auth/                            # 认证 + 登录
│   │   ├── Skills/                          # 技能市场
│   │   └── Shared/                          # 跨模块共享组件
│   └── Applet/                              # Lynx 容器宿主层
│       ├── LynxContainerView.swift
│       ├── AppletBridge.swift
│       └── AppletManager.swift
├── Podfile
└── Package.swift
```

约束：
* `Core/` 不可包含业务倾向；`Features/` 目录名体现业务语义
* 每个 Feature 模块自包含 `Views/ViewModels/Repositories/Models` 四层
* ViewModel 遵循 `@Observable`（iOS 17+）或 `ObservableObject` 协议
* SwiftUI View 保持纯渲染，状态通过 `@State` / `@Binding` / `@Environment` 驱动

---

## Applet 容器层设计（Lynx 方案）

### 方案选型

Applet 容器使用开源 [Lynx](https://github.com/lynx-family/lynx) 方案，替代旧版 WebF/WebView 方案。Lynx 提供跨平台高性能渲染引擎，支持在原生宿主中运行 JS/TS Bundle。

### 依赖接入

| 平台 | 依赖方式 | 坐标 |
| --- | --- | --- |
| Android | Maven | `org.lynxsdk.lynx` |
| iOS | CocoaPods | `pod 'PrimJS'` |
| Desktop | Web 宿主（LynxHost） | 内置于 `apps/desktop/src/applet/` |

### 架构分层

```
┌─────────────────────────────────────┐
│         Applet Bundle (TS/JS)       │  ← @peers-touch/applet-sdk
├─────────────────────────────────────┤
│         Bridge V2 Protocol          │  ← peers-touch.applet.bridge.v2
├─────────────────────────────────────┤
│         Lynx Runtime Engine         │  ← 渲染 + JS 执行
├─────────────────────────────────────┤
│      Native Host (Android/iOS)      │  ← AppletManager + AppletBridge
└─────────────────────────────────────┘
```

### Applet SDK 复用

Applet 内运行的 TS SDK（`@peers-touch/applet-sdk`，位于 `packages/applet-sdk/`）在 Mobile 端直接复用，不做平台差异化修改。Applet 通过 `sdk.invoke()` 调用宿主能力，宿主通过 Bridge V2 协议将请求路由到原生实现。

### Applet Manifest V2

每个 Applet 需声明 `applet.json`，遵循 Manifest V2 规范：

```json
{
  "manifestVersion": 2,
  "id": "example-applet",
  "name": "Example",
  "version": "1.0.0",
  "load": { "type": "lynx", "entry": "index.html" },
  "bridge": { "version": 2, "protocol": "peers-touch.applet.bridge.v2" },
  "permissions": ["storage", "network", "notification"],
  "targetPlatforms": ["desktop", "mobile"]
}
```

### 宿主侧实现要点

* **AppletManager**：扫描 / 加载 / 卸载 Applet 生命周期管理，维护运行实例注册表
* **AppletBridge**：实现 Bridge V2 协议，将 `sdk.invoke()` 请求映射到原生 API（如 storage、network、notification、system）
* **LynxContainerView**：承载 Lynx 渲染视图的原生容器（Android: Compose 包裹；iOS: UIViewRepresentable 桥接）

### Applet 化模块

以下模块不纳入原生实现，以 Applet 形态运行：
* **Notebook**：笔记编辑与管理
* **Cron**：定时任务调度

---

## 跨端共享策略

### Proto Model 层

* 共享源：`model/domain/` 下的 `.proto` 定义文件
* Android：`protoc --kotlin_out` 生成到 `core/proto/`
* iOS：`protoc --swift_out` 生成到 `Core/Proto/`
* Station (Go)：`protoc --go_out`
* Desktop (Rust)：已有的 Rust 契约层独立管理
* Proto 定义覆盖的领域：actor、auth、chat（friend_chat / group_chat）、ai_chat、social、applet、events、oss、message、oauth 等

### Applet SDK

* 共享包：`@peers-touch/applet-sdk`（`packages/applet-sdk/`）
* 所有平台的 Applet 运行时共用同一套 SDK，Applet 开发者无需关心宿主差异
* SDK 提供 `system`、`storage`、`network`、`notification` 四类标准 API

### API 契约

* Station 提供 RESTful + Protobuf 服务端接口，契约定义在 `model/domain/` 与 Station 路由层
* Mobile 各端基于契约独立实现客户端调用：
  * Android：Retrofit + OkHttp + protobuf-kotlin
  * iOS：URLSession / Alamofire + SwiftProtobuf
* Desktop：Rust 命令层通过 `station_client` 调用 Station API，Mobile 不共享此实现

---

## 同步协议概述

Mobile 端需要与 Desktop 端和 Station 在以下模块上保持数据同步：

| 模块 | 同步内容 | 同步方向 |
| --- | --- | --- |
| Memory | 用户记忆条目 | Station ↔ Mobile / Desktop |
| Applets | 已安装 Applet 列表、配置 | Station → Mobile / Desktop |
| Chat (Friend / Group) | 会话、消息、未读状态 | Station ↔ Mobile / Desktop |
| AI Chat | 会话历史、Provider 配置 | Station ↔ Mobile / Desktop |
| Timeline | 动态流、互动状态 | Station → Mobile / Desktop |
| Profile | 个人资料、偏好设置 | Station ↔ Mobile / Desktop |
| Settings | 主题、通知等用户偏好 | Station ↔ Mobile / Desktop |

同步协议的横向架构设计文档位于 `docs/`，包括：
* [station-desktop-scope-boundary.md](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/architecture/station-desktop-scope-boundary.md)：Station / 客户端职责边界与功能分配
* [unified-runtime-storage-architecture.md](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/architecture/storage/unified-runtime-storage-architecture.md)：统一运行时存储架构
* [architecture.md](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/global/architecture.md)：全局架构

Mobile 端同步策略遵循以下原则：
1. Station 为单一真源，Mobile 不维护独立领域真相
2. 使用事件流（Events）驱动增量同步，配合轮询作为兜底
3. 支持离线缓存与冲突解决（Last-Write-Wins 或业务自定义策略）
4. 同步层位于 Repository 内部，ViewModel 无需感知同步细节

---

## 功能模块清单

与 Desktop 端全量对等，以下为原生实现的功能模块：

| 模块 | 说明 | Desktop 对应 |
| --- | --- | --- |
| Auth | 注册、登录、Token 管理、会话 | `auth` / `account` |
| Chat | 私聊（Friend Chat）+ 群聊（Group Chat），消息、未读、置顶 | `friend_chat` / `group_chat` / `chat` |
| AI Chat | AI 会话、Agent 交互、Provider / Model 配置、工具调用 | `chat` / `agents` / `provider` / `models` / `model_config` |
| Applets | Applet 市场、已安装管理、Lynx 容器运行时 | `applets` |
| Search | 全局搜索（用户、消息、Applet、内容） | `search` |
| Memory | 用户记忆条目管理（AI 上下文增强） | `memory` |
| Timeline | 社交动态（发布、关注、互动） | `timeline` |
| Channels | 频道订阅与消息流 | `channels` |
| Profile | 个人资料编辑、头像、简介 | `profile` |
| Settings | 账号、通知、主题、存储与网络配置 | `settings` |
| Skills | 技能 / 技能市场 | `skills` / `skills_market` |
| Tools | AI 工具管理 | `tools` |
| MCP | Model Context Protocol 管理 | `mcp` |
| TTS | 文本转语音 | `tts` |
| OAuth | 第三方授权管理 | `oauth2` |
| System | 系统信息、运行诊断 | `system` |
| Admin | 管理后台入口 | `admin` |

以下模块以 Applet 运行，**不做原生实现**：

| 模块 | 说明 |
| --- | --- |
| Notebook | 笔记编辑与管理 |
| Cron | 定时任务调度 |

---

## 导航架构

### 一级导航（底部 TabBar）

* 内容：`Chat / AI / Applets / Search / Me`
* 高度：`56–64dp`（含安全区）
* 选中态：主色标签 + 高亮图标；未选中态灰度图标
* 行为：二次点击回到列表顶部；长按唤出快速入口

### 二级导航（顶部 SegmentedTabs）

* 用于同一模块内的子页签分组（如 Chat：全部 / 未读 / 置顶）
* Android：Material 3 TabRow；iOS：SwiftUI Picker (segmented)
* 高度：`48dp`

### 三级导航（BottomSheet）

* 手机端优先使用 BottomSheet（半高 `360dp` 或自适）
* 用途：用户档案、会话详情、AI 工具面板、操作确认
* Android：Material 3 BottomSheetScaffold；iOS：`.sheet` modifier
* 平板端可替换为侧栏 SlideOver

### 设备断点

* Phone：`≤ 600dp`（单列内容）
* Small Tablet：`600–840dp`（双列：内容 + 侧栏）
* Large Tablet：`≥ 840dp`（三列：侧栏 + 内容 + 辅助）
* 安全区：统一使用平台安全区 API；横屏保留左右 `24dp` 阅读安全线

---

## 主题与样式

主题系统遵循语义化 Token 设计，详见 [theme.md](./theme.md)。

### 核心原则

* 主题驱动：所有样式由主题派生（light/dark），不在组件内写死颜色/字号
* 语义命名：使用 Token（如 `color.surface`、`space.md`、`radius.lg`、`text.body`）
* 双端适配：Android 适配 Material 3 色彩系统；iOS 适配 Apple HIG 语义色

### 颜色系统

* Brand：`brand.primary`、`brand.secondary`
* Semantic：`semantic.success`、`semantic.warning`、`semantic.error`、`semantic.info`
* Text：`text.primary`、`text.secondary`、`text.muted`
* Surface：`surface.primary`、`surface.secondary`、`surface.overlay`、`surface.inverse`
* 暗色主题补偿：提高对比度、降低饱和度

### 字体与间距

* 字号基线：正文 16/14、标题 H1–H5
* 间距（4 的倍数）：`xs(4)` / `sm(8)` / `md(12)` / `lg(16)` / `xl(24)` / `2xl(32)`
* 圆角：`sm(6)` / `md(8)` / `lg(12)` / `xl(16)`

### 平台实现

* Android：`MaterialTheme` + 自定义 `CompositionLocal` Token
* iOS：自定义 `EnvironmentKey` Token + `ColorScheme` 切换

---

## 移动端交互规范

详见 [visual.md](./visual.md)。

### 密度与可读性

* 触控目标最小 `44×44dp`
* 字号移动端比桌面放大 1–2 级
* 暗色模式提高行间距与对比

### 手势与返回

* iOS：边缘返回手势（系统原生）
* Android：系统返回按键 + 预测性返回动画（Android 14+）
* 列表滑动露出动作（删除、置顶、收藏），阻尼控制防误触

### 状态管理

* 骨架态（Skeleton/Shimmer）→ 内容渐现
* 错误态 → 重试入口
* 空态 → 引导文案 + 行动按钮
* 加载态 → 轻量指示器，避免频繁闪烁

### 动效基准

* 页面切换：200–300ms（easeInOut / fastOutSlowIn）
* 容器展开：180–240ms（easeOut）
* BottomSheet：200–260ms
* 按压反馈：80–120ms
* 保持 60fps；高刷新屏下时间基准可下调 10–15%

---

## 网络层（Station Relay Only）

### 核心设计

* Mobile 端所有网络通信通过 Station 中继，**不实现 P2P 直连**
* Station 作为消息路由、状态同步、文件传输的统一中继节点
* 网络层封装位于 `core/network/`（Android）/ `Core/Network/`（iOS）

### Android 网络栈

* Retrofit：声明式 API 接口定义
* OkHttp：HTTP 客户端，统一拦截器（Auth Token、日志、错误映射）
* Protobuf 序列化：请求/响应体使用 protobuf-kotlin

### iOS 网络栈

* URLSession / Alamofire：HTTP 客户端
* 统一拦截器：Auth Token 注入、错误映射、重试策略
* SwiftProtobuf：请求/响应体序列化

### 通用策略

* Token 刷新：透明 Token 续期，请求排队等待刷新完成
* 重试与降级：指数退避重试；弱网降级展示本地缓存
* 离线队列：写操作排队，网络恢复后自动重放
* 实时事件：WebSocket / SSE 连接 Station 事件流

---

## 目录总览

```
apps/mobile/
├── android/                    # Android 原生项目（Kotlin + Jetpack Compose）
├── ios/                        # iOS 原生项目（Swift + SwiftUI）
└── flutter/                    # 旧版 Flutter 项目（已归档，不再开发）
```

---

## 代码规范

### Android

* 文件/目录：小写蛇形（Kotlin 文件帕斯卡命名）
* 类名：帕斯卡（`ChatViewModel`、`ChatRepository`）
* 变量/方法：小驼峰
* 包路径：`com.peerstouch.mobile.features.chat`
* Compose 函数：帕斯卡命名（`@Composable fun ChatScreen()`）

### iOS

* 文件/目录：帕斯卡（`ChatView.swift`、`ChatViewModel.swift`）
* 类/结构体/枚举：帕斯卡
* 变量/方法：小驼峰
* 模块路径：`PeersTouch/Features/Chat/`

### 通用

* 所有代码注册语言统一为英文（UI 通过 i18n 支持多语言）
* 枚举：所有可穷举类型必须定义为 `enum`
* 禁止硬编码颜色/字号/间距，必须引用主题 Token

---

## 应用初始化流程

```
Splash → Onboarding（可选）→ 权限检查 → 依赖注入初始化 → Auth 验证 → 主页路由
```

* 网络/存储异常处理与重试入口
* 离线态降级策略（缓存优先）
* Token 过期自动跳转登录

---

## 其它 Prompt

其它非 Base 级 Prompt 在当前目录下，涵盖以下维度：

* [description.md](./description.md)：全局定位与基准描述
* [ui-skeleton.md](./ui-skeleton.md)：UI 骨架与四层导航
* [components.md](./components.md)：全局 UI 组件规范
* [theme.md](./theme.md)：UI Kit 与主题规范（语义化 Token）
* [animation.md](./animation.md)：动效维度与时间/曲线基准
* [visual.md](./visual.md)：视觉规范
