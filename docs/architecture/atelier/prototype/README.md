# Atelier — 原型

> **Status**: draft
> **Version**: v0.3
> **Created**: 2026-06-21 | **Updated**: 2026-06-22
> **落地目标**: Applet（终态跑在 Lynx 上，运行在 peers-touch Desktop 容器内）；**原型本身只是 React + LobeUI 的 web 展示**，不绑运行时
> **总账状态**: drafting（见 [原型总账](../../prototypes/README.md)）
> **Owner**: Peers-Touch Agent Team
> **Module**: `packages/prototypes/desktop/applets/atelier/`

---

## 原型在哪

源码在 `packages/prototypes/desktop/applets/atelier/`（统一原型工作区；独立 web 工程）。本目录只放入口说明，不复制源码（架构文档标准 §5.8）。

这个原型只为**展示 Atelier 终态产品长什么样**，用 React + LobeUI 写成网页给人确认形态；**不碰 Lynx / applet 容器 / SDK**。终态确认后，applet 落地由 `packages/applets/atelier/` 按 Lynx 运行时另行实现。

> **Atelier 本质是 applet，跑在 peers-touch Desktop 容器里**，不是独立全屏 app。容器外壳（全局 SideNav + 内容区 + applet pins）由 [desktop 容器外壳原型](../../desktop/prototype/README.md) 展示；本原型作为 workspace 包 `@peers-touch/prototype-desktop-atelier` 被 desktop 原型作为一个 applet 嵌入其内容区。本原型也可单独跑起来看 Atelier 自身界面（壳子高度自适应，`height: 100%`）。

## 怎么跑

```bash
cd packages/prototypes/desktop/applets/atelier
pnpm install        # 首次，monorepo 根装也可
pnpm dev            # Vite，浏览器打开 localhost
```

技术栈：React + Vite + `@lobehub/ui`(LobeUI) 优先 → antd 兜底 + `react-layout-kit` + `lucide-react` + CSS，纯前端、mock 数据驱动。浏览器直接可看，不需要任何运行时容器。

## 形态定调：对话优先（SOLO 式），不是团队项目管理

Atelier 是**个人** Agent 工作台，形态对标 TRAE Work / SOLO 的**对话优先**界面，刻意保持简单：左侧任务列表、中间一条对话流、底部一个大输入框；复杂任务时右侧才浮出 Todo 面板。

**不做**传统项目管理那套（项目树 + 看板 + DAG 计划图 + 多 Agent 协作侧栏）——那是给团队的，对个人太重。

Atelier 的灵魂（多 Agent 协商）不另开团队协作面板，而是**内联进对话流**：平时折叠成一行「🤝 N 个 Agent 协商了 X，已收敛」，点开看角色 / 带证据的反对 / 共识；只有需要你拍板时，决策卡才在对话流里冒出来。

## 任务管理是可插拔 plugin

「怎么组织我的任务」做成**可插拔 plugin**：同一份任务数据，换不同的 plugin 就换一种组织 / 展示方式（项目文件夹分组、简单平铺、Kanban、DAG……）。左栏顶部「管理方式」切换器选 plugin。

- **数据归壳子管，plugin 只渲染 + 委派**：壳子（Page）持有任务与生命周期；plugin 通过 `TaskHost`（`select / setStatus / purge / newTask`）回调改状态，不自己存数据。新增看板 / DAG 只需实现 `TaskPlugin.render`，对话流与数据模型不动。
- **默认 plugin = 项目文件夹分组（对齐 SOLO）**：任务按所属项目 / 仓库文件夹（`Task.project`）分组，每组可折叠、各带「+」新建，对齐 SOLO 的 "Your Task List"。简单平铺降为可选 plugin。
- **完整生命周期**：`active → archived → deleted`。进行中可归档 / 删除；归档可恢复 / 删除；删除进回收站可还原或彻底删除（`purge`）。归档段、回收站段作为分组下方可折叠段。
- 看板 / DAG 在切换器里作为「计划中」占位项，证明形态可换、未实现。

接口定义见 `src/types.ts` 的 `TaskHost` / `TaskPlugin`；plugin 实现见 `src/plugins.tsx`。

## SOLO 外壳对齐

以 SOLO 为外壳人体工学的基准线，在其上叠 Atelier 独有的协商 / 决策 / 预算灵魂：

- **左栏**：顶部 Work / Code 双模式 toggle（视觉态）+ New task / Skills / Automation 入口 + "Your Task List"（筛选图标 + plugin 切换器）+ 项目文件夹分组 + 底部用户 footer（头像 + 用户名）；标题行可一键收起侧栏。
- **顶栏**：（侧栏收起时显展开按钮）任务标题 + 项目 chip + git 分支（`Task.branch`）+ 打开文件夹 / 终端 / 大纲图标 + Open in IDE + 预算条。
- **对话流**：轻 markdown（`` `code` `` / **粗体** / 列表）、完成回复带 Completed + 反馈条（赞/踩/复制/重新生成）、"N files changed +X -Y" diff 卡（可展开文件列表）、图片附件 chip、Artifact 卡。
- **Artifacts 托盘 + 产物预览面板**：composer 上方一排 Artifacts 卡片（markdown / web / image / diff，按 kind 配紫色图标）；点卡片在右侧打开**产物预览面板**——markdown 轻渲染、**web 产物用真实 `<iframe>` 内嵌浏览器**（地址栏 + 刷新 + 可折叠 Console Logs 面板按 level 染色）、image 图片预览、diff 文件清单。
- **右栏（三元切换）**：打开产物时为产物预览面板（宽 460）；否则为 Todo + Context（token 用量条 + Files/Other 标签的触达文件）。
- **富输入框**：斜杠命令 / 图片附件 / 模型选择器（openrouter-3o…）/ 语音 / 发送。

## 对应设计

原型从 [functional-modules.md](../execution-plans/functional-modules.md) §1「产品形态」推导，做到「对话流 + 协商内联可展开 + 内联决策」：

| 原型区域 | 对应设计 | 落地模块 |
|---------|---------|---------|
| 左栏：Work/Code 双模式 toggle + New task / Skills / Automation + 管理方式 plugin 切换器（含筛选图标）+ 项目文件夹分组任务列表（进行中带 spinner / 分支图标）+ 用户 footer + 侧栏收起 | §1.2 | M11 / M12 |
| 顶栏：（可展开侧栏）任务标题 + 项目 chip + git 分支 + 打开文件夹/终端/大纲图标 + Open in IDE + 预算条（成本熔断可见） | §1.5 | M7 |
| 对话流：用户气泡（含图片附件 chip）+ Atelier 复述目标卡（轻 markdown + 含 L0/L1/L2 验收口径）+ Completed + 反馈条 | §1.3 ① | M5 / M6 / M13 |
| 对话流内联「协商行」：折叠一行 / 展开看角色·带证据反对·折中·共识；无证据反对降级为疑虑 | §1.4 / §2 | M1 / M2 / M3 |
| 对话流内联「决策卡」：升级给人，列选项 + 推荐 + 已花成本 + 回滚影响，点选即推进 | §1.5 | M7 |
| 对话流「diff 卡 / 产物卡」：N files changed +X -Y 可展开文件列表 / 文件名回链到哪步哪个 Agent | §1.4 | M8 / M9 |
| Artifacts 托盘 + 右侧产物预览面板：markdown 渲染 / web 真 iframe 内嵌浏览器（地址栏 + Console Logs）/ image / diff | §1.4 / §1.3 ④ | M14 / M8 |
| 右栏：Todo + Context（token 用量条 + Files/Other 触达文件），与产物预览面板三元切换，仅复杂任务出现 | §1.3 | M5 / M8 |
| 底部富输入框：斜杠命令 / 图片 / 模型选择器 / 语音 / 发送 | §1.1 | M13 |

数据由 `src/mock.ts` 假数据驱动（标准 §5.8 允许）；这是纯前端展示原型，不接真实后端。

源码结构（React + LobeUI/antd DOM 组件）：`src/types.ts`（对话流 block 模型 + `Artifact`/`ConsoleLog` 产物模型 + `TaskHost`/`TaskPlugin` 接口）、`src/theme.ts`（调色板 `C` + 角色色 `ROLE_COLOR` + 立场色 `STANCE`）、`src/mock.ts`（多项目任务含生命周期 + 各任务对话流：协商/决策/diff/产物/图片附件 + 各任务 artifacts：markdown/web/image/diff）、`src/blocks.tsx`（各类 block 渲染：用户气泡含图片 chip / Atelier 含反馈条 / 协商行 / 决策卡 / 产物卡 / diff 卡 + 轻 markdown 内联）、`src/preview.tsx`（Artifacts 托盘 + 产物预览面板：轻 markdown 渲染 / web 真 iframe 内嵌浏览器含地址栏与 Console Logs / image / diff）、`src/plugins.tsx`（管理 plugin：默认 folders 项目分组 + 简单平铺 + 看板/DAG 占位）、`src/Page.tsx`（壳：Work/Code toggle + 左栏导航含折叠/筛选/footer + plugin 加载 + 顶栏含文件夹/终端/大纲图标 + 对话流 + Artifacts 托盘 + 富输入框 + 右栏 Todo/Context 与产物预览三元切换）、`src/main.tsx`（Vite 入口）。构建配置：`vite.config.ts` / `index.html` / `tsconfig.json`。

## 已知差异 / 待补

- 管理 plugin 默认「项目文件夹分组」+ 可选「简单平铺」可用；看板 / DAG 为切换器占位，未实现 `render`。
- Work/Code 双模式 toggle、侧栏折叠/展开、顶栏文件夹/终端/大纲图标、用户 footer 已做**视觉态**（Work/Code 不切真实 IDE 模式、终端/大纲图标未接真实面板）。
- 产物预览面板：web 产物为**真实 `<iframe>` 内嵌浏览器**（加载 URL，可改地址 / 刷新），Console Logs 为 mock 日志流（未接真实运行时日志）。
- 协商行展开为列表式，未做角色头像/连线的可视化编排。
- 决策卡点选已驱动本地状态（显示「已选择，Agent 继续推进」），但未真正续接后续对话与状态机。
- 富输入框的斜杠命令 / 图片 / 模型选择器 / 语音为静态外壳，未接真实发送 / 流式回复。
- 移动端单栏收敛未单独适配（当前布局在窄屏可用但未精修）。
