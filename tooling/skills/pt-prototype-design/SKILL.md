---
name: "pt-prototype-design"
description: "原型设计规范与工作流。当用户要求创建、修改、审查架构原型（UI/交互 web demo）时调用，确保遵循项目的原型技术栈、总账登记、确认门与目录约定。"
---

# 原型设计（Prototype Design）

本 skill 在你帮用户做**架构原型**相关工作时自动加载，确保你完整理解并遵循项目的原型设计规范。

---

## 1. 原型的定位

原型 = 设计的**可执行表达**——一个「能跑能点」的网页 demo，展示**终态产品长什么样、怎么交互**，替代口头对齐。

- **不是**产品代码
- **不是**最终运行时（不碰 Lynx / applet 容器 / SDK）
- **不替代落地与验收**
- **可以用 mock 数据**（重在形态与交互，不要求接通真实后端）

---

## 2. 什么时候需要原型

- **需要**：UI / 交互形态需要确认、靠文字描述容易跑偏的模块（产品界面、复杂交互流、面孔密集的功能）
- **不需要，不强行扩**：纯存储 / 协议 / 后端域 / 算法类设计。用 `design.md` / `data-model.md` 足以表达，**禁止**为了形式主义补一个原型
- 判定不清时，默认不做；待 UI 形态出现分歧时再补

---

## 3. 技术栈硬约束

| 维度 | 约定 |
|------|------|
| 框架 | React + Vite |
| UI 组件 | `@lobehub/ui`(LobeUI) 优先 → antd 兜底 + `react-layout-kit` + `lucide-react` + CSS |
| 运行 | 统一使用 `make run-prototype`；在 Prototype Portal 内切换 desktop / mobile / dashboard；`pnpm dev` / Vite 只作为 Makefile 内部实现细节 |
| 运行时 | **不碰** Lynx / applet 容器 / SDK。web 原型可自由用 DOM、`iframe`、`localStorage` 等浏览器能力 |
| 基础件 | **禁止重复造**——复用项目已有桌面组件体系（LobeUI / antd），不得每个需求另搭基础库 |

### 3.1 客户端 UI Identity 硬门槛

当原型属于客户端 UI（`desktop` / `mobile` / applet 容器内体验）时，**在画界面、写 CSS、改 icon/文字/边框/阴影/圆角/布局之前，必须先读取 UI Identity**。不得只凭截图、外部产品、个人审美或组件库默认值确定视觉风格。

必读顺序：

1. `docs/client/common/ui-identity/README.md`
2. `docs/client/common/ui-identity/foundations.md`
3. `docs/client/common/ui-identity/tokens.md`
4. `docs/client/common/ui-identity/layout.md`
5. `docs/client/common/ui-identity/components.md`
6. 最近的模块 UI Identity：`docs/client/common/ui-identity/modules/<module>/`（没有则明确说明“当前无模块 UI ID，复用 shared UI ID”）
7. 最近的平台/模块合同，例如 Desktop Applet Launcher 必读 `docs/client/desktop/applet-launcher-ux-contract.md`
8. 若截图或评审暴露可复用 UX 问题，按 `docs/knowledge/playbooks/ux-case-to-contract.md` 检查是否需要补合同，而不是在原型里私自定风格。

执行纪律：

- **UI ID 高于参考图**：用户给的截图只能作为信息结构、交互关系、密度或排序参考；不能覆盖 Peers Touch UI Identity。
- **Quiet Protocol Minimalism** 是默认风格基线：低噪声、清晰边界、克制 accent、少装饰、少重阴影、少仿系统 UI。
- **Token role 先于 raw CSS**：颜色、边框、阴影、圆角、间距、字体必须能解释成 `surface.*` / `text.*` / `action.*` / `border.*` / `radius.*` / `type.*` 等角色；不得随手写“看起来像”的 raw value。
- **组件库默认值不等于 UI ID**：LobeUI / antd 必须被归一到 Peers Touch 的 token 和组件角色；不能混用多个库的默认视觉。
- **边界先于样式**：先声明 page canvas、content rail、action rail、floating layer、recovery layer，再决定搜索框、菜单、弹窗、tile 的视觉。
- **模块合同优先**：若存在模块 UI ID 或平台 UX contract，原型必须实现其信息层级和禁用模式；若没有，必须在 README 的“已知差异 / 待补”里写明。

### 3.2 LobeHub-style Visual Evidence Gate

借鉴 LobeHub `ux-audit` 的 L1/L2/L3 分层：原型确认前，凡涉及按钮主次、边距、密度、视觉层级、暗色/亮色、响应式、空/加载/错误态的结论，**不能只从代码或口头判断**，必须有渲染截图证据。

分层要求：

| Layer | 证据 | 可判定内容 | 何时必跑 |
|-------|------|------------|----------|
| L1 Static | 源码 / `file:line` | 组件选型、状态分支、token role、是否存在 empty/loading/error/retry | 每个客户端 UI 原型 |
| L2 Visual | 已打开确认过的截图 | 按钮是否真为视觉主操作、边距/对齐/密度、层级、截断、dark/light、窄宽度表现 | 进入 `pending-review` 前；进入 `confirmed` 前必须无阻断项 |
| L3 Dynamic | 真实点击 / 录屏 / runtime capture | 键盘/focus、流程推进、错误态注入、动效与卡顿 | 复杂交互流、状态机密集、或 Owner 对行为有疑问时 |

截图纪律：

- 截图必须来自 Prototype Portal 或目标原型页面的真实渲染，不接受只看源码推断视觉结论。
- 截图必须被 agent 实际打开检查后才能作为 Evidence；只保存路径、未查看内容，不算证据。
- 默认截图集合：default、关键 empty/loading/error 态、desktop 宽度、一个窄宽度或 mobile 宽度；如支持 dark/light，至少覆盖两种主题。
- 每个视觉结论必须写清：截图路径 / 状态 / 视口 / 主题 / 判定项。
- 若某状态无法触达，不能默认为通过；在原型 README 的“已知差异 / 待补”标记 `L2 blocked` 或 `L3 required`。

L2 可直接判定的问题：

- 主操作是否唯一且视觉权重最高。
- 按钮类型是否匹配动作语义：primary / secondary / text / icon / destructive。
- card、list、rail、toolbar 的 spacing 是否成组且符合 UI Identity token role。
- border、shadow、radius、accent 是否克制，是否偏离 Quiet Protocol Minimalism。
- empty/loading/error/retry 是否像真实页面状态，而不是空白、占位或调试态。
- 长文案、长标题、数字、列表是否截断或溢出。

### 3.3 布局稳定性（Layout Stability）

原型交互过程中**禁止出现非预期的布局跳动**——用户切换 Tab、展开/折叠面板、加载内容时，周围元素不得位移或抖动。

硬规则：

| 场景 | 约束 | 实现手段 |
|------|------|----------|
| **Tab / Segment 切换** | 切换前后容器高度不得突变 | 所有互斥 tab-content 容器必须声明**相同的** `min-height` 值（取所有面板自然高度的最大值）。条件渲染（`{tab === 'a' && <A/>}`）中各分支的顶层容器 class **必须共享同一 min-height 声明**。若差异极大则用绝对定位叠层 + `visibility` 切换 |
| **列表加载 / 空态** | 内容区高度不得因条目数量变化而闪烁 | 空态 / loading 骨架占满 `min-height`；列表容器固定高度 + 内部滚动 |
| **输入框 / Textarea 展开** | 展开方向向下推，不得向上顶 header 或相邻区块 | 使用 flex 布局让可伸缩区独占剩余空间，或 `position: absolute` 浮层 |
| **Toast / Snackbar** | 出现 / 消失不推动页面内容 | 固定在 viewport 边缘（`position: fixed`），不占文档流 |
| **图片 / 媒体** | 加载前后不得导致重排 | 必须有明确的 `width` × `height` 占位或 `aspect-ratio` |

检查方法：

- L2 Visual 截图时，需要对比 Tab 切换前后两帧，确认容器高度像素一致。
- L3 Dynamic 时，若存在高度跳动超过 2px，判定为 **layout-shift defect**，阻断 `pending-review`。

实现优先级：

1. **同级容器统一 `min-height`**——最简单、最可预测。
2. 绝对定位叠层（隐藏面板用 `visibility: hidden; position: absolute`）——适合内容高度差异极大的情况。
3. CSS `grid` 行固定高度——适合固定格子布局。

反模式（禁止）：

- 依赖 JS 动态计算高度再 setState → 必然有一帧跳动。
- `display: none` 隐藏非活动 Tab → 无法为布局贡献尺寸，切回时闪烁。
- 只设 `height` 不设 `min-height` → 内容溢出时被截断且无滚动。

---

## 4. 目录与文件约定

### 4.1 源码位置

所有原型工程集中放在 `packages/prototypes/` 下，并且物理目录必须跟随一级站点分层：

```text
packages/prototypes/
├── portal/
├── desktop/
│   ├── shell/
│   ├── applets/<applet-id>/
│   └── features/<feature-id>/
├── mobile/
│   └── <prototype-id>/
└── dashboard/
    └── <prototype-id>/
```

纳入 pnpm workspace，统一工具链，基础件可跨原型复用。

原型登记和 Portal 展示必须按一级站点归属组织：

```text
desktop            # Desktop App / desktop-web / applet 容器内体验
mobile             # Mobile 端体验
dashboard          # Station Dashboard / 管理台 / 运维台
```

注意：`atelier` 这类 applet、`call` / `social-chat` 这类局部能力原型，不是一级站点，必须挂在所属站点（例如 `desktop/applets/atelier`、`desktop/features/call`）下。

### 4.2 入口文档

每个模块的原型在架构文档侧有对应入口：

```
docs/architecture/<module>/prototype/README.md
```

该文件只写：原型在哪、怎么跑、对应哪版设计、做到什么程度、已知差异。**不复制源码**。

### 4.3 prototype/README.md 模板

```markdown
# <模块名> — 原型

> 元数据块

---

## 原型在哪

`packages/prototypes/<site>/<area>/<id>/`（统一原型工作区；独立 web 工程）

## 落地目标

（最终落到哪：Desktop 页面 / Applet(Lynx) / …。原型本身只是 web 展示）

## 怎么跑

make run-prototype

## 对应设计

（覆盖了哪版 design / functional-modules 的哪些区域，做到什么程度）

## 总账状态

（drafting / pending-review / confirmed / landed / superseded）

## 已知差异 / 待补

（原型与设计不一致处、尚未做的面孔/交互）
```

---

## 5. 统一原型总账

位置：`docs/architecture/prototypes/README.md`

### 5.1 登记表字段

| 站点 | 原型 ID | 归属层级 | 原型路径 | 落地目标 | 对应设计版本 | 状态 | 入口文档 |

### 5.2 状态流转与确认门

```
drafting → pending-review → confirmed → landed
                                  │
                                  └── 设计变更 → superseded
```

规则：
1. 新原型登记进总账，初始 `drafting`
2. 原型「能跑能点」、可对回设计编号，并完成 L1 Static + 必要 L2 Visual 截图证据后 → `pending-review`，提请 Owner 确认
3. Owner 确认且无 L2 阻断项后 → `confirmed`——**只有 confirmed 的原型才允许进入落地实现**
4. 功能落地后 → `landed`；设计大改导致原型失效 → `superseded`（新建原型重走门）

**未登记或未 confirmed 的原型，不得作为落地依据。**

### 5.3 版本管理

原型"当时版本快照"由 git 仓库本身承载（与当前开发分支保持一致），不堆 tag、不复制 `v1/ v2/` 目录副本。总账只记当前对应的设计版本与状态。

### 5.4 Worktree / Branch 预览

Prototype Portal 支持 worktree / branch 切换：

- 当前 worktree 由 `make run-prototype` 自动注入分支名和 worktree 路径。
- 其他 worktree 必须自己启动原型服务，再通过 `VITE_PROTOTYPE_WORKTREES` JSON registry 注入 Portal。
- 跨 worktree 只能用 iframe 预览对应 URL，禁止直接 import 其他 worktree 的源码。
- registry 的站点 key 只能是 `desktop` / `mobile` / `dashboard`。

---

## 6. 关键纪律

1. **从设计推导，不脱节**：原型界面区域要能对回 `design.md` / `functional-modules` 的模块编号；设计变更时原型同步或在 README 标注差异
2. **原型不绑定最终运行时**：即使终态是 applet(Lynx) / Desktop 页面，原型也只用 web 栈（React+Vite+LobeUI）。不要为了"贴近运行时"把原型做成 ReactLynx 工程
3. **禁止用原型当验收证据**：落地须由对应工程按其运行时重新实现
4. **原型经确认后才落地**：总账中状态为 `confirmed` 才可以作为落地参照
5. **Desktop 禁止新增独立模块卡片**：Portal desktop 区只允许**一张**可见原型入口（`packages/prototypes/desktop/shell/`）。所有 desktop 功能（Chat、Agent、Atelier、Orchestration、Call、Notes、Settings、Applets）必须在该唯一 Shell 内部通过路由接入，禁止在 `packages/prototypes/desktop/features/` 下新建独立可见卡片。已有的 feature 原型源码保留但必须设 `hidden: true`，其内容组件由 Shell 引用复用。违反此规则会导致 Portal 平铺多张卡 → 用户体验分裂（split-brain），历史上已多次发生。

---

## 7. 落地路径

原型经 confirmed 后的落地方式：由对应落地工程（如 Applet → `packages/applets/<id>/`，Desktop → `apps/desktop/`）**参照原型重新实现**，按其运行时技术栈。原型本身不要求能直接搬成产物。

---

## 8. Agent 工作检查清单

当你帮用户创建或修改原型时，完成后检查：

- [ ] 源码在 `packages/prototypes/<site>/<area>/<id>/`，物理目录没有把 applet / feature 放成一级站点
- [ ] `make run-prototype` 能跑，浏览器能打开
- [ ] Prototype Portal 的 Live Preview 已选中并渲染目标原型：右上角标题必须是目标 prototype title，正文不能是 `Desktop Shell` / kernel placeholder / “原型未细化”占位页
- [ ] `docs/architecture/<module>/prototype/README.md` 已创建/更新
- [ ] `docs/architecture/prototypes/README.md` 总账已登记
- [ ] 原型区域能对回设计文档编号
- [ ] 客户端 UI 原型已读取 `docs/client/common/ui-identity/README.md` 及 foundations / tokens / layout / components
- [ ] 已读取最近的模块 UI ID；若不存在，已在原型 README 标注“当前无模块 UI ID，复用 shared UI ID”
- [ ] Desktop Applet Launcher 类原型已读取 `docs/client/desktop/applet-launcher-ux-contract.md`
- [ ] 参考图只被用作结构/交互参考，没有覆盖 Peers Touch UI Identity
- [ ] 颜色、字体、边框、圆角、阴影、间距能对回 UI Identity token roles，未用任意 raw CSS 私定风格
- [ ] 已声明页面的 content rail、action rail、floating layer、recovery layer，未用装饰性边框/阴影弥补边界不清
- [ ] 已完成 L1 Static 检查：组件选型、状态分支、token role、empty/loading/error/retry 覆盖有源码证据
- [ ] 已完成 L2 Visual 截图检查：至少覆盖 default、关键状态、desktop 宽度、窄宽度或 mobile 宽度；如支持 dark/light，覆盖两种主题
- [ ] 每张 L2 截图已实际打开确认，Evidence 记录包含截图路径 / 状态 / 视口 / 主题 / 判定项
- [ ] 按钮主次、按钮类型、边距、密度、视觉层级、截断、空/加载/错误态等视觉结论均来自 L2 截图，而不是只从代码推断
- [ ] 无法触达的视觉状态已在原型 README 标记 `L2 blocked` 或 `L3 required`，没有默认为通过
- [ ] 使用 LobeUI / antd / lucide-react，未引入额外基础组件库
- [ ] 未碰 Lynx / applet SDK / 非 web 运行时
- [ ] mock 数据驱动，未依赖后端接口
- [ ] 原型登记在正确一级站点下（`desktop` / `mobile` / `dashboard`），没有把 applet 或局部能力登记成一级模块
- [ ] 跨 worktree / branch 预览使用 registry + iframe，没有直接引用其他 worktree 源码
- [ ] Tab / Segment 切换无布局跳动：所有 tab-content 面板有统一 `min-height` 或使用叠层方案，切换前后容器高度像素一致
- [ ] 列表 / 空态 / 媒体加载无重排：骨架屏和占位区域已预留正确尺寸

---

## 9. 真源文档引用

- 完整规范：`docs/global/architecture-document-standard.md` §5.8
- 原型总账：`docs/architecture/prototypes/README.md`
- 桌面组件栈参考：`docs/global/coding-guide/desktop/page-component.md`
- 客户端 UI Identity：`docs/client/common/ui-identity/README.md`
- UI Identity tokens：`docs/client/common/ui-identity/tokens.md`
- UI Identity layout：`docs/client/common/ui-identity/layout.md`
- UI Identity components：`docs/client/common/ui-identity/components.md`
- Desktop Applet Launcher 合同：`docs/client/desktop/applet-launcher-ux-contract.md`
