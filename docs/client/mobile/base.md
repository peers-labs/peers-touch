# Peers Touch Mobile

> Mobile platform-level source for what the native mobile clients are, what is already true today, and what remains target-direction architecture.

---

## 1. 文档定位

本文定义：

- Mobile 平台的当前实现基线
- Mobile 平台的目标架构方向
- Android 与 iOS 的共同约束
- Mobile 在整个系统中的职责边界

本文不定义：

- 详细同步协议
- Applet 容器细节
- 实施 phase 与落地进度
- 双端每个模块的编码规范正文

继续阅读请看：

- `native-dual-platform.md`
- `applet-container.md`
- `sync-protocol.md`
- `execution-plans/implementation-plan-20260403.md`
- `../../architecture/boundaries/station-desktop-scope-boundary.md`
- `../../global/coding-guide/mobile/`

---

## 2. 当前实现基线

当前仓库中的 Mobile 主线是：

- Android：Kotlin + Jetpack Compose
- iOS：Swift + SwiftUI
- 目录位置：
  - `apps/mobile/android/`
  - `apps/mobile/ios/`

Mobile 当前已明确成立的事实：

1. 双端原生实现是主线，不走 Kotlin Multiplatform。
2. 共享契约来自 `model/domain/*.proto`。
3. 共享业务真源在 Station，不在 Mobile。
4. Mobile 通过 Station / Relay 风格链路获取共享业务数据。
5. Applet 方向采用 Lynx 容器，而不是 Flutter 容器。

---

## 3. 平台职责

Mobile 负责：

- 原生 UI 呈现
- 手势、导航、主题、设备能力适配
- 本地交互编排
- 对 Station 数据的读取、展示与必要的本地缓存

Mobile 不负责：

- 成为跨端共享业务真源
- 复刻 Desktop 的本地 Rust 运行时模型
- 承担 Desktop 专属系统能力（窗口、托盘等）

一句话：

- Mobile 是原生客户端，不是独立业务后端。

---

## 4. 技术栈约束

| 维度 | Android | iOS |
| --- | --- | --- |
| 语言 | Kotlin | Swift |
| UI 框架 | Jetpack Compose | SwiftUI |
| 构建工具 | Gradle (Kotlin DSL) | Xcode + Swift Package Manager |
| 架构模式 | MVVM + Repository | MVVM + Repository |
| 异步模型 | Coroutines + Flow | async/await |
| Proto 生成 | `proto-gen-mobile.sh kotlin` | `proto-gen-mobile.sh swift` |
| Applet 容器方向 | Lynx | Lynx |

说明：

- 具体依赖库可演进，但不能推翻上述平台主轴。
- 规范正文不在本文展开，详见 `docs/global/coding-guide/mobile/`。

---

## 5. 核心架构原则

1. **双端独立，契约统一**
   - Android 与 iOS 分别独立实现
   - 通过 proto 契约和业务语义对齐
2. **Station 为真源**
   - 跨端可见业务状态由 Station 持有
3. **分层清晰**
   - View → ViewModel → Repository → DataSource
4. **Relay/Station 优先**
   - Mobile 不承担 P2P 主链职责
5. **Applet 化边界明确**
   - 某些能力以 Applet 方式承载，而不是原生模块无限膨胀

---

## 6. 当前实现与目标架构的边界

本文区分两个概念：

### 6.1 当前实现基线

指当前仓库里已经明确存在并成立的内容，例如：

- Android / iOS 原生工程存在
- 原生技术栈主线已确定
- Lynx 容器方向已确定
- Station 真源原则已确定

### 6.2 目标架构方向

指平台期望收敛到的形态，但不等于“当前已全部落地”，例如：

- 与 Desktop 的能力覆盖逐步趋同
- Notebook / Cron 等能力通过 Applet 形态承载
- 更完整的模块化结构与统一导航策略
- 更完整的同步、事件、记忆、搜索等能力接入

因此：

- 本文中的“方向”不应被误读为“全部已完成”
- 具体落地状态应放在计划或报告文档中，不混入平台总纲

---

## 7. 目标结构方向

### 7.1 Android

目标方向是：

- `core/` 只承载通用能力
- `features/` 以业务语义组织
- 业务模块内部保持 `ui / viewmodel / repository / model` 分层
- Applet 宿主层独立于业务模块

### 7.2 iOS

目标方向是：

- `Core/` 只承载通用能力
- `Features/` 以业务语义组织
- 业务模块保持 View / ViewModel / Repository 的分层
- Applet 宿主层独立于业务模块

---

## 8. 功能范围口径

Mobile 的目标能力范围可覆盖：

- Auth
- Chat（Friend / Group）
- AI / Agent 对话相关能力
- Search
- Timeline
- Profile
- Settings
- Channels
- Skills
- Memory
- Applets

但要注意：

- 这代表目标能力范围，不等于当前每一项都已完整落地
- Notebook / Cron 等能力优先走 Applet 形态
- Desktop 专属系统能力不属于 Mobile 范围

---

## 9. 网络与同步口径

Mobile 通过 Station 提供的 API、Relay、同步与事件机制工作。

约束：

- 不直接承担数据库真源职责
- 不引入 Desktop 专属本地运行时模式
- 共享业务状态依赖 Station

详细协议见：

- `sync-protocol.md`

---

## 10. 目录总览

```text
apps/mobile/
├── android/
├── ios/
└── flutter/      # deprecated, not active implementation path
```

---

## 11. 继续阅读

- [Native Dual Platform](./native-dual-platform.md)
- [Applet Container](./applet-container.md)
- [Sync Protocol](./sync-protocol.md)
- [Station/Desktop Scope Boundary](../../architecture/boundaries/station-desktop-scope-boundary.md)
- [Mobile Coding Guide](../../global/coding-guide/mobile)
