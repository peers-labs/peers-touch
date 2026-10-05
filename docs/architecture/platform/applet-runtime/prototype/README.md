# Applet Runtime — 原型

> **Status**: landed
> **Prototype ID**: `applet-lifecycle`
> **Site**: desktop
> **Updated**: 2026-06-30

---

## 原型在哪

`packages/prototypes/desktop/features/applet-lifecycle/`

这是 Desktop 站点下的极简 Applet Box launcher 原型，不是某个具体 applet 的产品界面，也不是 Lynx / applet runtime 实现。

`packages/prototypes/desktop/features/applet-workspace/`

这是 Desktop 站点下的多实例 Applet Workspace 原型，用来验证“小程序像浏览器一样多开”的容器交互：固定 Home tab、运行实例 tabs、Pin to System、detach 到独立窗口、immersive 容器模式。它仍是 React web 原型，不碰 Lynx / applet runtime / SDK。

## 落地目标

落到 Desktop Applet Box 的安装包导入、展示、打开、运行、通知、退出、卸载入口：

- `apps/desktop/src/pages/AppletsPage.tsx`
- `apps/desktop/src/pages/AppletRuntimePage.tsx`
- Desktop Rust Gateway 的安装包导入 / 本地安装投影

## 怎么跑

```bash
make run-prototype
```

Prototype Portal 会自动发现 `applet-lifecycle` manifest。

## 对应设计

覆盖 applet-runtime 当前设计中的用户侧生命周期主路径：

- Install：右上角从安装包导入。
- Display：我的 Applet 以极简 icon grid 展示。
- Open：点击 icon 直接打开。
- Running：运行中以中段 floating/runtime stage 表达；收起态展示动态尺寸的运行快照堆叠 + dots，数量少时放大占据更多美学空间，数量多时自动缩小并保持堆叠节奏，点击 dots 后展开 iOS 后台应用式运行快照卡片。
- Notify：通知以 icon badge 表达。
- Exit：仅在展开后的运行快照卡片提供轻量退出入口；这是 runtime surface 的恢复/关闭动作，不属于 launcher grid 管理动作。
- Uninstall：卸载不在 launcher 主面孔展示，后续归入详情/管理流。

设计依据：

- `docs/architecture/platform/applet-runtime/official-applet-architecture-contract.md`
- `docs/client/common/ui-identity/README.md`
- `docs/client/desktop/applet-launcher-ux-contract.md`

`applet-workspace` 覆盖下一代 Desktop Applet 容器交互：

- Home：作为固定 tab 承载小程序入口、最近运行、全部小程序、搜索和 Open。
- Multi-open：顶部 tabs 承载不同小程序实例；重复点击默认 focus，显式 `New instance` 才多开。
- Container modes：默认 contained，支持 immersive，支持 detach 到独立窗口并保留 tab 恢复路径。
- System pin：`Pin to System` 只作为系统快捷启动入口状态，不等于 standalone window，也不污染 launcher grid。
- Management boundary：版本、权限、诊断、卸载不进入 Home grid；后续归入 runtime detail / management flow。

边界声明：

- Page canvas：Applet Box 页面本身。
- Content rail：`我的 Applet` icon grid，只负责识别与打开 applet。
- Action rail：顶部搜索与右上角 `+` 导入入口。
- Floating layer：安装包导入菜单、目录导入 dialog、中段运行快照 stage / switcher。
- Recovery layer：空状态与导入识别失败提示。

## 总账状态

`landed`（已落地到 `apps/desktop/src/pages/AppletsPage.tsx`，参照原型按 Desktop 运行时与真实 applets store 重新实现）

`applet-workspace`: `drafting`（新一代 browser-like applet container 交互原型，待 Owner 评审确认后才允许作为落地依据）

## 已知差异 / 待补

- 暂不做商店；只表达从安装包导入。
- 原型使用 mock 数据；落地实现复用真实 `useAppletsStore` 与原生目录导入，运行区只渲染真实 applet 身份（不伪造内容），符合 No-Mocking 铁律。
- 原型不实现 Lynx 容器、SDK Bridge 或 Host session；落地的 runtime surface 由 `AppletRuntimePage.tsx` 承载。
- 当前无 applet 专属 UI Identity module；本原型复用 shared UI Identity 与 Desktop Applet Launcher UX Contract。
- 运行快照中的 `退出`/关闭是 runtime surface 动作，已迁出 launcher，归入 `AppletRuntimePage`；launcher grid 仍不展示卸载、诊断、权限、版本等管理内容。
- 落地全部文案接入 i18n locale key，移除高饱和 identity 渐变（改用低饱和 tint）。
- `applet-workspace` 使用 mock applet 内容表达容器布局，不代表 applet 内部页面 UI。
- `Pin to System` 在原型里只展示入口和状态；真实 macOS Dock/Launchpad、Windows Start/Desktop shortcut、Linux desktop entry 集成需要后续运行时设计与系统 API 验证。
- `Detach` 在原型里只展示 tab 状态；真实实现需要产品窗口生命周期、focus、close、session restore 与 applet runtime lease 对齐。
