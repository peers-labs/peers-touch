# Desktop Runtime Architecture

## 1. 文档目标

- 明确 `station`、`desktop-rust`、`desktop-web`、`desktop-app` 四个运行单元的职责边界。
- 统一 Desktop 开发、调试、发布时的运行关系，避免再把 `desktop-web` 误判成“纯前端静态页”。
- 给后续脚本拆分、运行模式治理、启动故障排查提供统一语义基线。

## 2. 背景与问题

Desktop 当前是一个多运行单元协同的系统，而不是单个 Tauri 进程。

过去容易出现的错误理解：

- 把 `desktop-web` 理解成只要起 Vite 就能独立运行。
- 把 `desktop-app` 理解成完整业务 Owner，而忽略 `desktop-rust` 才是真正的本地应用层。
- 把 `station` 与 `desktop-web` 直接连起来，绕过 `desktop-rust`。

这些理解都会导致：

- 启动脚本职责混乱。
- 浏览器模式失败时误判根因。
- App/Web/Rust 三者重复拉起，或互相抢占端口。

## 3. 四个运行单元

### 3.1 Station

`station` 是共享业务系统与跨端真源。

职责：

- 承载业务域模型、状态机、权限、审计、配额与跨端一致数据。
- 提供面向 Desktop 的业务 API 与 protobuf 契约。
- 作为需要跨端一致的数据与事件的最终真源。

不负责：

- Desktop 本地窗口、托盘、文件选择、系统通知。
- Desktop 本地会话编排与端侧交互体验。

### 3.2 Desktop-Rust

`desktop-rust` 是 Desktop 本地运行时、本地 BFF、本地网关层。

职责：

- 承载 Desktop 应用层、本地状态、本地配置、本地存储、命令注册。
- 对前端暴露统一命令入口。
- 在开发态通过本地 HTTP gateway 暴露 `127.0.0.1:3030`，供 `desktop-web` 调用。
- 向下调用 `station`，完成登录、聊天、Provider、Profile 等业务请求编排。

不负责：

- React 页面渲染。
- 浏览器/窗口里的 UI 展示。

关键判断：

- `desktop-rust` 不是 `desktop-app` 的附属物。
- `desktop-rust` 才是 Desktop 侧业务执行与本地能力编排的 Owner。

### 3.3 Desktop-Web

`desktop-web` 是 React + TypeScript 前端渲染层。

职责：

- 页面渲染、交互流程、状态管理、组件组织。
- 把业务命令通过 `invoke` 语义发送给 `desktop-rust`。
- 在浏览器开发态和 Tauri WebView 中复用同一套 UI 代码。

不负责：

- 直接拥有 Station 业务逻辑。
- 直接替代本地 Rust 网关。

关键判断：

- `desktop-web` 不是“只要起 Vite 就能完整工作”的纯静态前端。
- 浏览器模式下，`desktop-web` 仍然要依赖 `desktop-rust`。

### 3.4 Desktop-App

`desktop-app` 是 Tauri 原生壳与窗口宿主。

职责：

- 提供原生窗口、菜单、托盘、WebView 与打包形态。
- 承载 `desktop-web` 的 UI 运行。
- 在当前实现中负责把 `desktop-rust` 一起带起来。

不负责：

- 作为独立业务层重复实现一套业务逻辑。

关键判断：

- `desktop-app` 是宿主，不是业务真源。
- `desktop-app` 内运行的前端，仍然是 `desktop-web`。

## 4. 标准调用关系

### 4.1 浏览器开发态

```text
desktop-web (Browser)
        |
        v
desktop-rust (HTTP gateway :3030)
        |
        v
station
```

含义：

- 浏览器里运行的是 `desktop-web`。
- 业务调用先到本地 `desktop-rust`。
- `desktop-rust` 再调用 `station`。

### 4.2 Native App 开发态

```text
desktop-app (Tauri Window)
        |
        v
desktop-web (WebView)
        |
        v
desktop-rust
        |
        v
station
```

含义：

- App 窗口承载的是同一套 `desktop-web`。
- 业务调用仍由 `desktop-rust` 统一处理。
- `station` 仍是共享业务真源。

### 4.3 错误理解示意

下面这些链路都不成立：

- `desktop-web -> station`
- `desktop-app -> station`（绕过 `desktop-rust`）
- `desktop-web` 脱离 `desktop-rust` 单独完成首屏自举

## 5. 启动组合规则

### 5.1 Web 调试模式

应启动：

- `station`
- `desktop-rust`
- `desktop-web`

不要求：

- `desktop-app`

### 5.2 App 调试模式

应启动：

- `station`
- `desktop-rust`
- `desktop-web`
- `desktop-app`

关键点：

- `desktop-app` 只是把 `desktop-web` 放进原生窗口。
- 不应再把 `desktop-app` 误当成“无需 `desktop-rust` 的完整模式”。

### 5.3 生产打包模式

目标语义：

- `desktop-app` 作为最终分发载体。
- `desktop-web` 作为被加载的前端资源。
- `desktop-rust` 作为本地应用层与命令执行层。
- `station` 作为远端共享业务系统。

## 6. 当前代码映射

### 6.1 Desktop-Web -> Desktop-Rust

- `apps/desktop/src/main.tsx`
  - 浏览器开发态下把 `invoke` 转发到 `http://127.0.0.1:3030`
- `apps/desktop/src/i18n/index.ts`
  - 首屏启动时直接调用 `i18n_load_resources`

这说明：

- `desktop-web` 首屏启动就依赖 `desktop-rust`
- `desktop-web` 不是可脱离 Rust 的纯前端

### 6.2 Desktop-Rust -> Station

- `apps/desktop/src-tauri/src/infrastructure/station_client.rs`
  - 统一封装 Rust 到 Station 的请求
- `apps/desktop/src-tauri/src/interface/http_gateway/mod.rs`
  - 在本地暴露 HTTP gateway，作为 Web 模式下的命令入口

这说明：

- `desktop-rust` 是本地命令层与远端业务层之间的桥
- `station` 并不直接面对 `desktop-web`

### 6.3 Desktop-App 承载关系

- `apps/desktop/src-tauri/src/main.rs`
  - 注册 Tauri commands
  - Debug 模式下启动本地 HTTP gateway

这说明：

- 现在 `desktop-rust` 还绑定在 Tauri `main.rs` 中
- 当前代码基线下，`desktop-rust` 尚未完全抽成独立 headless 入口

## 7. 当前架构缺口

当前最核心的缺口不是前端页面，而是运行时拆分还不彻底：

- `desktop-rust` 仍然主要挂在 Tauri 启动链内。
- Web 模式需要的 `desktop-rust` 独立启动入口尚未完全收敛。
- 启动脚本层面容易把“起 Web”“起 App”“起 Rust”混成一件事。

因此后续治理顺序应是：

1. 先把 `desktop-rust` 的独立运行语义稳定下来。
2. 再定义 `desktop-web` 与 `desktop-app` 的启动脚本职责。
3. 最后再谈 Web/App 并行调试体验。

## 8. 决策规则

后续只要遇到 Desktop 相关运行问题，都先按下面三条判断：

1. 这个问题属于 `desktop-web` 的渲染问题，还是 `desktop-rust` 的命令网关问题？
2. 当前失败发生在 `desktop-web -> desktop-rust`，还是 `desktop-rust -> station`？
3. 当前脚本是在启动 `desktop-app`，还是在启动 `desktop-rust`，还是在启动 `desktop-web`？

只有先回答完这三条，才能继续定位。

## 9. 非目标

本文不讨论：

- Mobile 端运行架构。
- Provider/Model 协议适配细节。
- Station 内部 DDD 子服务拆分。

这些内容应分别归属对应文档。
