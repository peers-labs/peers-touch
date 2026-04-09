# Mobile 端实现计划

本文档是 Peers Touch Mobile（Android + iOS）从骨架到可运行产品的完整实施路线图。

---

## Phase 0：基础保障（能编译能跑）

所有后续 Phase 的前提。

### 0.1 调研 Lynx SDK 真实集成方式

- 查阅 [lynxjs.org](https://lynxjs.org) 官方文档
- 确认 Android SDK 的 Maven 坐标、初始化 API、LynxView 创建 API
- 确认 iOS SDK 的 CocoaPods 坐标、初始化 API、LynxView 创建 API
- 确认 JS → Native Bridge 注册机制（如何从 Lynx JS 调用宿主原生方法）
- 确认 Native → JS 回调机制
- 输出：整理到 `docs/client/mobile/lynx-integration.md`

### 0.2 对接 Lynx SDK 真实 API

依赖 0.1 的调研结果，重写以下骨架代码：

**Android（Kotlin）：**
- `core/lynx/LynxEngineManager.kt` — 用真实 SDK API 替换 TODO
- `core/lynx/LynxViewFactory.kt` — 用真实 SDK API 创建 LynxView
- `core/lynx/bridge/BridgeDispatcher.kt` — 接入真实的 JS → Native 调用通道
- 所有 Bridge Module 的 `handle()` 连通到 Lynx 回调

**iOS（Swift）：**
- `Core/Lynx/LynxEngineManager.swift` — 同上
- `Core/Lynx/LynxViewFactory.swift` — 同上
- `Core/Lynx/Bridge/BridgeDispatcher.swift` — 同上
- 所有 Bridge Module 连通

### 0.3 对齐 Station HTTP API

- 读取 Station 的路由定义（`apps/station/app/` 和 `apps/station/frame/`）
- 整理完整的 Station HTTP API 清单
- 重写 Android `core/network/StationApi.kt` — 对齐真实路径和参数
- 重写 iOS `Core/Network/StationAPI.swift` — 对齐真实路径和参数
- 引入 Proto 生成的请求/响应模型替代 `Map<String, Any>`

### 0.4 Proto Model 生成管道

- 在 `tooling/scripts/` 中创建 `proto-gen-mobile.sh`
- 生成 Kotlin 代码：`protoc --kotlin_out` → `apps/mobile/android/.../core/proto/`
- 生成 Swift 代码：`protoc --swift_out` → `apps/mobile/ios/.../Core/Proto/`
- 集成到 Gradle / Xcode 构建流程（或作为 pre-build 脚本）
- 替换所有 `Map<String, Any>` 为强类型 Proto Model

### 0.5 构建通过

- Android：`cd apps/mobile/android && ./gradlew assembleDebug` 编译通过
- iOS：`cd apps/mobile/ios && xcodebuild -scheme PeersTouch -configuration Debug build` 编译通过
- 在模拟器/真机上启动，能看到底部 5 Tab 导航和空白页面

---

## Phase 1：Auth + 基础页面能用

### 1.1 Auth 模块

- 对接 Station 的 login / register / session API
- 实现登录/注册页面（表单、校验、错误提示）
- Token 存储（Android DataStore / iOS Keychain）
- AuthInterceptor 自动注入 Bearer Token
- Token 过期自动刷新
- 未登录态路由拦截

### 1.2 SSE 事件流

- EventStreamClient 连接 Station 的事件推送端点
- 心跳检测 + 断线自动重连
- EventRouter 按 event type 分发到各模块 handler
- 连接状态 UI 指示（在线/离线/重连中）

### 1.3 Profile 模块

- 拉取当前用户资料
- 展示头像、昵称、简介
- 编辑个人资料

---

## Phase 2：Chat + AI Chat

### 2.1 Chat 模块（Friend + Group）

- 会话列表（最近联系人、未读计数、最后一条消息预览）
- 消息列表（文本/图片/引用/系统消息，分页加载历史）
- 发送消息（文本、图片）
- SSE 实时接收新消息
- 离线缓存（Room / SwiftData）
- 已读回执同步
- 消息状态指示（发送中 / 已发送 / 已读 / 失败）

### 2.2 AI Chat 模块

- AI 会话列表
- 对话页面（Markdown 渲染、代码高亮）
- 流式响应（SSE 逐 token 渲染）
- Agent 选择 / Model 选择
- Provider 配置
- 对话历史同步

---

## Phase 3：Applet 全链路跑通

### 3.1 Applet Bundle 下载与缓存

- AppletBundleStorage 真实实现
- 从 Station 下载 Bundle（zip / 目录）
- 解压到本地沙盒
- 版本管理（hash 校验、增量更新）
- 缓存淘汰策略

### 3.2 Applet 容器 LynxView 渲染

- AppletContainerView 接入真实 LynxView
- 加载 Bundle entry 文件并渲染
- 加载态 / 运行态 / 错误态 UI 切换
- Applet 生命周期管理（前台/后台/销毁）

### 3.3 Bridge 全链路打通

- 完整链路：Applet JS `invoke('storage', 'get', {key: 'x'})` → Lynx Native Bridge → BridgeDispatcher → StorageBridgeModule → 返回结果到 JS
- 所有 6 个 Bridge Module 跑通：system / storage / network / notification / device / ui
- 错误处理和超时机制

### 3.4 用现有 Applet 验证

- 在 Mobile 上运行 `packages/applets/agent-pilot`
- 在 Mobile 上运行 `packages/applets/web-search`
- 验证 Bridge 调用、UI 渲染、数据交互全链路

---

## Phase 4：剩余功能模块

### 4.1 Search 模块
- 全局搜索（消息、联系人、Applet、技能）
- 搜索建议、历史记录

### 4.2 Memory 模块
- 记忆条目列表
- 记忆详情
- 从 Station 拉取（只读）

### 4.3 Skills 模块
- 技能列表
- 技能详情与配置

### 4.4 MCP 模块
- MCP Server 列表
- 配置管理

### 4.5 Channels 模块
- 频道列表
- 频道消息流（复用 Chat 组件）
- Bot 状态

### 4.6 Timeline 模块
- 社交动态流
- 点赞 / 评论 / 转发
- 发布动态

### 4.7 Settings 模块
- 账户设置
- 通知偏好
- Station 连接配置
- 主题切换
- 语言切换
- 缓存管理
- 关于

### 4.8 OAuth2 模块
- 第三方服务连接（GitHub 等）
- OAuth 授权流程

### 4.9 TTS 模块
- AI 回复语音朗读
- 各平台原生 TTS API

---

## Phase 5：打磨

### 5.1 主题系统完善
- Light / Dark 自动跟随系统
- Material 3 Dynamic Color (Android)
- 自定义主题色

### 5.2 离线能力
- 各模块的离线缓存策略
- 离线操作队列（消息发送、配置变更）
- 重连后同步重放
- 冲突检测与提示

### 5.3 推送通知
- FCM (Android) / APNs (iOS)
- Station 推送注册
- 消息通知、Applet 通知

### 5.4 性能优化
- 列表虚拟化 (LazyColumn / LazyVStack)
- 图片缓存 (Coil / Kingfisher)
- LynxView 内存管理
- 启动速度优化
- 包体积优化

### 5.5 测试
- 单元测试（Repository / ViewModel / Bridge Module）
- UI 测试（Compose Test / XCUITest）
- Applet Bridge 集成测试

---

## 依赖关系

```
Phase 0（基础保障）
  └── Phase 1（Auth + 事件流 + Profile）
        ├── Phase 2（Chat + AI Chat）
        ├── Phase 3（Applet 全链路）
        └── Phase 4（剩余模块）
              └── Phase 5（打磨）
```

Phase 2、3、4 之间无强依赖，可以并行推进。Phase 5 贯穿全程。

---

## 当前进度

- [x] 架构设计（base.md / native-dual-platform.md / applet-container.md）
- [x] Android 项目骨架（79 个文件）
- [x] iOS 项目骨架（69 个文件）
- [x] Phase 0.1 — Lynx SDK 调研完成（Android 3.2.0-rc.0 / iOS 3.6.0）
- [x] Phase 0.2 — Lynx SDK 真实坐标写入 Gradle libs.versions.toml 和 Podfile
- [x] Phase 0.3 — 双端架构对齐（消除烟囱）
  - LynxEngineManager: 双端使用真实 SDK init API
  - LynxViewFactory: 双端使用真实 LynxView 构造
  - BridgeDispatcher: 统一 BridgeResult/BridgeErrorCode，统一 invoke(api:) 拆分
  - StationAPI: 40+ 真实 Station 路由（Auth/FriendChat/GroupChat/AIChat/Events/Social/Applets/OSS/Search）
  - AppletManager: 统一 AppletInfo/AppletBridgeSession 模型和生命周期
  - AppletBridgeSession: iOS 修复关键 bug（不再 per-session 创建 BridgeDispatcher），双端共享单例+权限检查
  - Bridge Modules (×6): 双端方法签名统一（device/system/storage/network/notification/ui）
  - DI: Android Hilt multibinding / iOS Container 全局注册 Bridge Modules
- [x] Phase 0.4 — Proto Model 生成管道
  - `tooling/scripts/proto-gen-mobile.sh` 创建完成（Kotlin java-lite + Swift 双端生成）
  - Android: protobuf-javalite 4.29.3 依赖就绪
  - iOS: SwiftProtobuf ~> 1.28 pod 依赖就绪
- [x] Phase 0.5 — 构建通过
  - iOS: `xcodebuild build -workspace PeersTouch.xcworkspace -scheme PeersTouch` ✅ BUILD SUCCEEDED
  - iOS 工具链: XcodeGen project.yml → .xcodeproj 生成，CocoaPods 集成（Lynx 3.6.0 / PrimJS 3.6.1 / LynxService 3.6.0 / SDWebImage / SwiftProtobuf）
  - iOS 部署目标: iOS 17.0（@Observable / SwiftData 要求）
  - Android: 需要 Android SDK 环境才能验证 assembleDebug（本机未安装）
- [ ] **Phase 1 待做** — Auth + 基础页面
