---
name: "prototype-design"
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
| 运行 | 统一使用 `make run-prototype desktop/mobile/dashboard`；`pnpm dev` / Vite 只作为 Makefile 内部实现细节 |
| 运行时 | **不碰** Lynx / applet 容器 / SDK。web 原型可自由用 DOM、`iframe`、`localStorage` 等浏览器能力 |
| 基础件 | **禁止重复造**——复用项目已有桌面组件体系（LobeUI / antd），不得每个需求另搭基础库 |

---

## 4. 目录与文件约定

### 4.1 源码位置

所有原型工程集中放在：

```
packages/prototypes/<id>/
```

纳入 pnpm workspace，统一工具链，基础件可跨原型复用。

原型登记和 Portal 展示必须按一级站点归属组织：

```text
desktop            # Desktop App / desktop-web / applet 容器内体验
mobile             # Mobile 端体验
dashboard          # Station Dashboard / 管理台 / 运维台
```

注意：`atelier` 这类 applet、`call` / `social-chat` 这类局部能力原型，不是一级站点，必须挂在所属站点（例如 `desktop`）下。

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

`packages/prototypes/<id>/`（统一原型工作区；独立 web 工程）

## 落地目标

（最终落到哪：Desktop 页面 / Applet(Lynx) / …。原型本身只是 web 展示）

## 怎么跑

make run-prototype desktop   # 或 mobile / dashboard

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
2. 原型「能跑能点」、可对回设计编号后 → `pending-review`，提请 Owner 确认
3. Owner 确认后 → `confirmed`——**只有 confirmed 的原型才允许进入落地实现**
4. 功能落地后 → `landed`；设计大改导致原型失效 → `superseded`（新建原型重走门）

**未登记或未 confirmed 的原型，不得作为落地依据。**

### 5.3 版本管理

原型"当时版本快照"由 git 仓库本身承载（与当前开发分支保持一致），不堆 tag、不复制 `v1/ v2/` 目录副本。总账只记当前对应的设计版本与状态。

### 5.4 Worktree / Branch 预览

Prototype Portal 支持 worktree / branch 切换：

- 当前 worktree 由 `make run-prototype desktop/mobile/dashboard` 自动注入分支名和 worktree 路径。
- 其他 worktree 必须自己启动原型服务，再通过 `VITE_PROTOTYPE_WORKTREES` JSON registry 注入 Portal。
- 跨 worktree 只能用 iframe 预览对应 URL，禁止直接 import 其他 worktree 的源码。
- registry 的站点 key 只能是 `desktop` / `mobile` / `dashboard`。

---

## 6. 关键纪律

1. **从设计推导，不脱节**：原型界面区域要能对回 `design.md` / `functional-modules` 的模块编号；设计变更时原型同步或在 README 标注差异
2. **原型不绑定最终运行时**：即使终态是 applet(Lynx) / Desktop 页面，原型也只用 web 栈（React+Vite+LobeUI）。不要为了"贴近运行时"把原型做成 ReactLynx 工程
3. **禁止用原型当验收证据**：落地须由对应工程按其运行时重新实现
4. **原型经确认后才落地**：总账中状态为 `confirmed` 才可以作为落地参照

---

## 7. 落地路径

原型经 confirmed 后的落地方式：由对应落地工程（如 Applet → `packages/applets/<id>/`，Desktop → `apps/desktop/`）**参照原型重新实现**，按其运行时技术栈。原型本身不要求能直接搬成产物。

---

## 8. Agent 工作检查清单

当你帮用户创建或修改原型时，完成后检查：

- [ ] 源码在 `packages/prototypes/<id>/`
- [ ] `make run-prototype desktop/mobile/dashboard` 能跑，浏览器能打开
- [ ] `docs/architecture/<module>/prototype/README.md` 已创建/更新
- [ ] `docs/architecture/prototypes/README.md` 总账已登记
- [ ] 原型区域能对回设计文档编号
- [ ] 使用 LobeUI / antd / lucide-react，未引入额外基础组件库
- [ ] 未碰 Lynx / applet SDK / 非 web 运行时
- [ ] mock 数据驱动，未依赖后端接口
- [ ] 原型登记在正确一级站点下（`desktop` / `mobile` / `dashboard`），没有把 applet 或局部能力登记成一级模块
- [ ] 跨 worktree / branch 预览使用 registry + iframe，没有直接引用其他 worktree 源码

---

## 9. 真源文档引用

- 完整规范：`docs/global/architecture-document-standard.md` §5.8
- 原型总账：`docs/architecture/prototypes/README.md`
- 桌面组件栈参考：`docs/global/coding-guide/desktop/page-component.md`
