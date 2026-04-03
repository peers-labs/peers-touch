# Android + iOS 原生双端架构设计

## 1. 文档目标

### 1.1 目标
- 定义 Peers Touch Mobile 端采用 Android（Kotlin + Jetpack Compose）与 iOS（Swift + SwiftUI）原生双端开发的总体架构。
- 明确各层职责、依赖方向与跨层约束。
- 与 Desktop（Tauri + Rust）架构形成对比参照，保证跨端概念一致性。

### 1.2 非目标
- 不讨论 UI 组件库的具体选型与设计系统细节。
- 不讨论 CI/CD 流水线与发布流程。
- 不替代各平台内部的模块级设计文档。

---

## 2. 为什么选择原生双端

### 2.1 决策背景

Peers Touch 的核心价值在于深度集成设备能力（通知推送、后台保活、Lynx 引擎嵌入、P2P 通信、系统级快捷入口）以及与 Station 的高效实时通信。跨端框架（Flutter / React Native / KMP）在以下维度存在显著取舍：

| 维度 | 跨端框架 | 原生双端 |
| --- | --- | --- |
| Lynx 引擎集成 | 需额外 Bridge 层适配渲染管线，复杂度高 | LynxView 直接作为原生 View 嵌入，集成路径最短 |
| 平台新特性跟进 | 依赖框架发布节奏，常有 1–2 季度延迟 | 第一时间使用 Platform SDK |
| 系统能力深度 | 推送/后台任务/权限管理需逐个补齐 Bridge | 原生 API 直达，无中间层损耗 |
| 性能天花板 | 受限于 VM / JS Bridge 序列化开销 | 编译期优化，零序列化开销 |
| 团队复用 | 共享 UI 代码约 60–70%，但 Bridge 维护成本高 | UI 需各写一份，但业务逻辑层可通过 Proto Model + API 契约对齐 |
| 长期维护 | 框架生态迁移风险（Flutter Engine 升级、RN 新架构迁移） | 平台 SDK 向后兼容性由 Google / Apple 保障 |

### 2.2 决策结论
- **采用原生双端**，Android 使用 Kotlin + Jetpack Compose，iOS 使用 Swift + SwiftUI。
- 通过 Station API 契约 + Proto Model 生成实现跨端业务逻辑对齐，而非共享 UI 代码。
- Lynx 引擎以原生 SDK 形态嵌入，避免跨端框架引入的额外渲染层。

---

## 3. 架构分层

```text
┌──────────────────────────────────────────────────────────┐
│                   Presentation Layer                      │
│  Android: Jetpack Compose + ViewModel                    │
│  iOS:     SwiftUI + ObservableObject                     │
├──────────────────────────────────────────────────────────┤
│                   Business Logic Layer                    │
│  Android: UseCase / Repository (Kotlin Coroutines)       │
│  iOS:     UseCase / Repository (Swift Concurrency)       │
├──────────────────────────────────────────────────────────┤
│                   Data Layer                              │
│  Android: Retrofit + Room + DataStore                    │
│  iOS:     URLSession + SwiftData + UserDefaults          │
│  Shared:  Proto Model (protoc generated)                 │
├──────────────────────────────────────────────────────────┤
│                   Infrastructure Layer                    │
│  Android: Hilt DI, WorkManager, Firebase Push, LynxView  │
│  iOS:     Swift DI, BGTaskScheduler, APNs, LynxView      │
│  Shared:  Station HTTP Client, WebSocket, Token Manager  │
└──────────────────────────────────────────────────────────┘
```

### 3.1 表现层（Presentation Layer）

职责：
- 页面渲染、交互反馈、导航编排。
- 从 ViewModel / ObservableObject 订阅 UI State，驱动声明式 UI 刷新。
- 不包含业务判断逻辑，仅做展示映射与用户动作分发。

Android 实现要点：
- 使用 Jetpack Compose 声明式 UI。
- 每个页面对应一个 `@HiltViewModel` 注入的 ViewModel。
- UI State 通过 `StateFlow` 暴露，Side Effect 通过 `Channel` / `SharedFlow` 分发。

iOS 实现要点：
- 使用 SwiftUI 声明式 UI。
- 每个页面对应一个 `@Observable` 类（或 `ObservableObject`）。
- UI State 通过 `@Published` 属性暴露，Side Effect 通过 `AsyncStream` 分发。

### 3.2 业务逻辑层（Business Logic Layer）

职责：
- 封装领域用例（UseCase），编排数据获取与状态变更。
- 管理离线队列、冲突解决、缓存策略等跨数据源逻辑。
- 不直接依赖平台 UI 框架。

关键组件：
- `Repository`：聚合远端（Station API）与本地（数据库/缓存）数据源，提供统一数据访问接口。
- `UseCase`：单一职责的业务操作，接受 Repository 注入，返回领域结果。
- `SyncManager`：管理多端同步状态，驱动增量拉取与冲突仲裁（详见 [sync-protocol.md](./sync-protocol.md)）。

### 3.3 数据层（Data Layer）

职责：
- 封装远端 API 调用、本地持久化、内存缓存。
- 对上层暴露统一数据模型（Proto Model 映射后的领域对象）。

远端数据源：
- Android：`Retrofit` + `OkHttp`，请求/响应序列化使用 Proto Model。
- iOS：`URLSession` + 自定义 `StationAPIClient`，请求/响应序列化使用 Proto Model。
- 共同约束：所有 API 路径与参数结构对齐 Station Handler 契约，禁止端侧私有协议。

本地数据源：
- Android：`Room`（结构化数据）+ `DataStore`（KV 偏好）。
- iOS：`SwiftData`（结构化数据）+ `UserDefaults`（KV 偏好）。
- 缓存策略：详见 [sync-protocol.md](./sync-protocol.md) 离线行为设计章节。

### 3.4 基础设施层（Infrastructure Layer）

职责：
- 提供平台级能力封装：依赖注入、后台任务、推送通知、Lynx 引擎。
- 封装 Station HTTP Client（Token 注入、重试、降级）。
- 封装 WebSocket 长连接管理（心跳、重连、事件分发）。

Android 关键组件：
- `Hilt`：依赖注入框架，Module 按层组织。
- `WorkManager`：后台同步任务调度。
- `Firebase Cloud Messaging`：推送通道。
- `LynxView`：Lynx 引擎原生渲染容器（Maven 依赖）。

iOS 关键组件：
- Swift 原生依赖注入（`@Environment` + 自定义 DI Container）。
- `BGTaskScheduler`：后台同步任务调度。
- `APNs`：推送通道。
- `LynxView`：Lynx 引擎原生渲染容器（CocoaPods 依赖）。

---

## 4. 依赖方向约束

```text
Presentation → Business Logic → Data → Infrastructure
     ↓                ↓            ↓           ↓
   (UI State)     (UseCase)   (Repository)  (Platform SDK)
```

核心规则：
- 上层可依赖下层，下层不可反向依赖上层。
- Business Logic 层对 Presentation 层零感知，通过接口回调或响应式流通信。
- Data 层不直接依赖 Business Logic 层，Repository 接口定义在 Business Logic 层，实现在 Data 层（依赖反转）。
- Infrastructure 层是最底层，提供纯技术能力，不包含业务语义。

---

## 5. 与 Desktop (Tauri + Rust) 的架构对比

| 维度 | Desktop (Tauri + Rust) | Mobile (原生双端) |
| --- | --- | --- |
| 表现层 | React (TSX) + Zustand Store | Compose / SwiftUI + ViewModel / Observable |
| 业务逻辑层 | Rust Application 层 + TS Service 层 | Kotlin UseCase / Swift UseCase |
| 数据层 | Rust Infrastructure (YAML / SQLite) + TS API | Retrofit+Room / URLSession+SwiftData |
| 基础设施层 | Tauri API (窗口/托盘/文件) + Rust HTTP Client | Hilt+WorkManager / BGTaskScheduler + Native SDK |
| IPC 通信 | Tauri Command (Rust ↔ TS 进程间调用) | 无需 IPC，同进程内函数调用 |
| 状态管理 | GlobalContext Kernel (Rust 权威 + TS 镜像) | ViewModel / Observable 直接持有 |
| Applet 引擎 | `<lynx-host>` Web Component 嵌入 | `LynxView` 原生 View 嵌入 |
| 推送通道 | Station SSE / WebSocket | FCM (Android) / APNs (iOS) + WebSocket |

关键差异说明：
- Desktop 存在 Rust ↔ TS 跨进程通信开销，需要 GlobalContext Kernel 做状态同步；Mobile 端 UI 与业务逻辑同进程，状态传递更直接。
- Desktop 的 Applet 通过 Web Component `<lynx-host>` 嵌入 Webview 容器；Mobile 的 Applet 通过 `LynxView` 原生 SDK 嵌入，渲染路径更短。
- Desktop 侧 Rust 层承担权威状态写入；Mobile 端不需要这一分层，ViewModel 直接作为 UI 状态权威。

---

## 6. API 契约复用策略

### 6.1 原则
- Station 提供的 HTTP API 是跨端唯一契约。Desktop / Mobile / 未来 Web 端均通过同一套 API 交互。
- 端侧不允许自定义私有协议绕过 Station API。
- API 版本兼容策略遵循 Station 统一Handler架构定义的版本规则。

### 6.2 契约共享方式

```text
model/domain/**/*.proto
        │
        ├── protoc --go_out     → Station Go Model (已有)
        ├── protoc --kotlin_out → Android Kotlin Model
        └── protoc --swift_out  → iOS Swift Model
```

- Proto 文件是跨端模型的唯一真源，存放于 `model/domain/` 目录。
- 各端通过 protoc 插件生成对应语言的数据类，确保字段名称、类型、可空性严格一致。
- 端侧可在生成模型上增加辅助扩展（如 Parcelable / Codable），但不可修改生成代码本身。

### 6.3 API Client 封装

Android：
- `Retrofit` 接口定义对齐 Station Handler 路径。
- 请求 / 响应体直接使用 protoc 生成的 Kotlin data class。
- 全局 `OkHttp Interceptor` 注入 Bearer Token、Trace ID、设备信息。

iOS：
- `StationAPIClient` 基于 `URLSession`，路径与参数结构对齐。
- 请求 / 响应体使用 protoc 生成的 Swift struct。
- 全局中间件注入 Bearer Token、Trace ID、设备信息。

---

## 7. Proto Model 生成策略

### 7.1 现有基线
- Proto 定义目录：`model/domain/`，包含 `ai_chat`、`chat`、`actor`、`oauth`、`events`、`applet` 等领域。
- 构建脚本：`model/build.sh`（macOS/Linux）、`model/build.ps1`（Windows）。
- 当前已支持：`protoc --go_out` 生成 Go Model（Station 使用）。

### 7.2 Mobile 端扩展

在 `model/build.sh` 中追加 Kotlin 与 Swift 生成步骤：

```bash
# Kotlin (Android)
KOTLIN_OUT="$PROJECT_ROOT/apps/mobile-android/app/src/main/java"
for file in $PROTO_FILES; do
    protoc --kotlin_out="$KOTLIN_OUT" -I"$PROTO_ROOT" "$file"
done

# Swift (iOS)
SWIFT_OUT="$PROJECT_ROOT/apps/mobile-ios/Sources/ProtoModel"
for file in $PROTO_FILES; do
    protoc --swift_out="$SWIFT_OUT" -I"$PROTO_ROOT" "$file"
done
```

### 7.3 生成约束
- Kotlin 生成依赖：`protoc-gen-kotlin`（Google 官方插件），版本锁定与 `protoc-gen-go` 同策略。
- Swift 生成依赖：`protoc-gen-swift`（Apple/grpc-swift 官方插件），通过 `swift package` 管理。
- 生成产物纳入版本控制（与 Go 生成策略一致），确保 CI 可复现。
- Proto 文件变更时，CI 自动触发全端重新生成并校验 diff。

### 7.4 Proto 文件扩展约束
- 新增 Proto 字段必须兼容现有 wire format（追加字段、不复用已删除 field number）。
- 新增 Proto 文件必须声明 `option java_package`（供 Kotlin 使用）和 `option swift_prefix`（供 Swift 使用）。
- 跨端共享的枚举类型必须在 Proto 层定义，禁止端侧自行定义同名枚举。

---

## 8. 模块划分建议

### 8.1 Android 模块结构
```text
apps/mobile-android/
├── app/                          # 主工程壳（Application、Navigation、DI 配置）
├── feature/
│   ├── chat/                     # AI Chat + Friend Chat + Group Chat
│   ├── applet/                   # Applet 容器 + 管理
│   ├── settings/                 # 设置页
│   ├── memory/                   # AI Memory
│   └── launcher/                 # 搜索与快捷入口
├── core/
│   ├── network/                  # Station HTTP Client + WebSocket
│   ├── database/                 # Room Database
│   ├── sync/                     # 同步引擎
│   ├── proto/                    # Proto 生成模型
│   └── common/                   # 通用工具
└── build.gradle.kts
```

### 8.2 iOS 模块结构
```text
apps/mobile-ios/
├── PeersTouch/                   # 主工程壳（App、Navigation、DI 配置）
├── Features/
│   ├── Chat/                     # AI Chat + Friend Chat + Group Chat
│   ├── Applet/                   # Applet 容器 + 管理
│   ├── Settings/                 # 设置页
│   ├── Memory/                   # AI Memory
│   └── Launcher/                 # 搜索与快捷入口
├── Core/
│   ├── Network/                  # Station HTTP Client + WebSocket
│   ├── Database/                 # SwiftData
│   ├── Sync/                     # 同步引擎
│   ├── ProtoModel/               # Proto 生成模型
│   └── Common/                   # 通用工具
└── Package.swift
```

---

## 9. 验收标准
- 每一层的依赖方向严格遵循 Presentation → Business Logic → Data → Infrastructure，禁止反向依赖。
- Proto Model 生成产物与 Station Go Model 字段完全一致，CI 自动校验。
- Android 与 iOS 的 Station API 调用路径一一对应，禁止一端存在另一端没有的私有接口。
- Applet 容器在两端均支持 Manifest V2 + Bridge V2 协议，行为一致。
- 离线场景下两端具有相同的缓存深度与行为预期。
