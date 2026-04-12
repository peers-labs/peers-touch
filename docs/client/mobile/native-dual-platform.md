# Android + iOS 原生双端架构

## 1. 文档目标

### 1.1 目标
- 定义 Mobile 平台为什么采用 Android 与 iOS 原生双端，而不是共享 UI 运行时。
- 明确 Mobile 平台内部的职责分层、依赖方向、与 Station / Model 的关系。
- 约束 Proto 生成与目录归属，避免再次出现“生成物脱离应用域”。

### 1.2 非目标
- 不记录当前阶段、迁移 phase、已完成/未完成状态。
- 不替代 Android 或 iOS 端的模块级实现文档。
- 不讨论具体页面设计、发版流程或测试平台矩阵。

---

## 2. 决策基线

### 2.1 采用原生双端

Peers Touch Mobile 的主线是：

- Android：Kotlin + Jetpack Compose
- iOS：Swift + SwiftUI

原因不是“偏好原生”，而是运行时职责决定：

- Mobile 需要直接持有推送、后台任务、系统权限、文件系统、通知、Lynx 容器等设备能力。
- Mobile 不存在 Desktop 那种 `desktop-web -> desktop-rust -> station` 的多运行时链路，UI 与业务逻辑同进程。
- Applet 在 Mobile 端通过原生 `LynxView` 承载，Bridge 与生命周期都更适合由原生宿主管理。

### 2.2 已废弃路径

`apps/mobile/flutter/` 只保留历史痕迹，不是当前实现路径，也不是未来扩展方向。

---

## 3. 系统关系

```text
Mobile App (Android / iOS)
        |
        v
   Station API / Event Stream
        |
        v
      Station

Shared contract source:
model/domain/*.proto
```

核心约束：

- 共享业务真源在 `Station`，不在 Mobile。
- 共享契约真源在 `model/domain/*.proto`，不在端侧 DTO。
- Mobile 负责设备本地 UI、运行时状态、离线缓存、系统能力封装。
- Mobile 不得定义绕过 Station 的端侧私有业务协议。

---

## 4. 平台内部职责分层

```text
Presentation -> Application -> Data -> Infrastructure
```

### 4.1 Presentation

- Android：Compose 页面、导航、ViewModel 对接
- iOS：SwiftUI 页面、导航、Observable / ViewModel 对接
- 只负责交互与状态展示，不承载跨页面业务编排规则

### 4.2 Application

- 组织 UseCase / Repository 协作
- 编排登录态、同步触发、缓存刷新、事件消费
- 作为 UI 与数据访问之间的业务编排层

### 4.3 Data

- 对接 Station HTTP API、事件流、本地数据库与偏好存储
- 负责模型映射、缓存读写、离线队列与冲突处理
- 对上暴露稳定的仓储接口，不向上泄露底层 SDK 细节

### 4.4 Infrastructure

- Android：Hilt、WorkManager、推送、原生系统能力、LynxView
- iOS：DI Container、BGTaskScheduler、APNs、原生系统能力、LynxView
- 只提供技术能力，不定义业务真源

---

## 5. 当前代码基线

当前仓库中的 Mobile 目录基线为：

```text
apps/mobile/
├── android/
│   └── app/src/main/java/com/peerstouch/mobile/
└── ios/
    └── PeersTouch/
```

Android 当前基线：

- 应用壳位于 `apps/mobile/android/app/`
- 主要代码位于 `com/peerstouch/mobile/`
- 目录已经按 `di`、`navigation` 等运行时职责拆分

iOS 当前基线：

- 应用壳位于 `apps/mobile/ios/PeersTouch/`
- `Core/` 承载网络、存储、Lynx、Applet、事件流等基础能力
- `Features/` 按业务域拆分页面、ViewModel、Repository

这份文档定义的是当前平台总架构边界，不把旧目录名如 `apps/mobile-android/`、`apps/mobile-ios/` 继续当作真源。

---

## 6. 共享契约与 Proto 生成

### 6.1 唯一契约真源

- 所有跨端共享数据模型先定义在 `model/domain/*.proto`
- Station 与 Mobile 都消费同一份 Proto 契约
- 不允许在 Mobile 端手工定义“看起来一样”的并行共享模型来替代 Proto 真源

### 6.2 生成链约束

- Shared / server-side 生成：`./model/build.sh`
- Mobile 生成：`./tooling/scripts/proto-gen-mobile.sh`

Mobile 生成物必须跟随各自应用目录落盘：

- Android 生成物落在 `apps/mobile/android/` 内
- iOS 生成物落在 `apps/mobile/ios/` 内

禁止：

- 把 Mobile 生成物落到根目录或与应用无关的目录
- 继续扩展 Flutter / Dart 生成链
- 修改生成代码本身来承担业务语义

### 6.3 历史实现的处理原则

当前代码里如果仍存在平台本地 DTO、JSON 解码结构或过渡映射，它们只能作为兼容层存在，不能反过来重新定义共享契约真源。

---

## 7. 跨端一致性约束

### 7.1 与 Station 的关系

- Mobile 只能通过 Station 暴露的协议与服务交互
- 认证、共享业务规则、跨设备一致性由 Station 持有真源
- Mobile 可以做本地缓存和体验优化，但不能把缓存升级为业务真源

### 7.2 与 Desktop 的关系

- Desktop 与 Mobile 都消费 `model/domain/*.proto` 和 Station 契约
- Desktop 需要处理多运行时同步；Mobile 不需要复制 Desktop 的 `desktop-rust` 形态
- 两端概念应对齐，但平台内部实现可以不同

### 7.3 与 Applet 的关系

- Mobile Applet 运行时由原生宿主承载
- Applet 协议边界由 `Manifest V2` 与 `Bridge V2` 约束
- Applet 细节由 `applet-container.md` 定义，不在本文重复

---

## 8. 验收标准

- Mobile 主路径始终是 `apps/mobile/android` 与 `apps/mobile/ios`
- Proto 共享模型始终以 `model/domain/*.proto` 为唯一真源
- Mobile 生成链始终通过 `./tooling/scripts/proto-gen-mobile.sh`
- 平台层不重新定义共享业务真源，不绕过 Station 契约
- Flutter 目录不再被作为当前实现或未来扩展方向引用

---

## 9. 继续阅读

- [Mobile Base](./base.md)
- [Applet Container](./applet-container.md)
- [Sync Protocol](./sync-protocol.md)
- [Project Architecture](../../global/architecture.md)
