# 原型总账（Prototypes Ledger）

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-06-22 | **Updated**: 2026-06-22
> **Owner**: Architecture Team

---

## 1. Document Scope

本文档定义：

- 全项目所有架构原型的**统一登记表**（单点真源）
- 「原型确认门」的状态流转与落地准入规则

本文档不定义：

- 原型的编写规范与技术栈约束（见 [`global/architecture-document-standard.md` §5.8](../../global/architecture-document-standard.md)）
- 各原型的具体设计内容（见各模块 `architecture/<module>/prototype/README.md`）

---

## 2. 为什么要有总账

原型（指交付给 Owner 确认的可交互界面 demo / mockup）过去跟着每个 `architecture/<module>/prototype/` 各自走、源码也散落在各落地工程，导致：

- 无法统一追踪——不知道全项目有哪些原型、各处于什么状态。
- 重复造基础件——每个需求各搭一套脚手架/基础组件，AI 实施时没有可直接复用的基准。
- 落地无门槛——原型未经确认就被当作落地依据，跑偏后返工。

总账解决：**统一追踪 + 复用基准 + 先确认后落地**。配套约定：所有界面原型工程集中放在 `packages/prototypes/<id>/`（统一原型工作区，纳入 pnpm workspace、统一工具链、基础件跨原型复用）；经确认门 `confirmed` 后再搬迁/演进到落地目标工程。

---

## 3. 登记表

| 模块 | 原型路径 | 落地目标 | 对应设计版本 | 状态 | 入口文档 |
|------|---------|---------|------------|------|---------|
| atelier | `packages/prototypes/atelier/` | Applet（Lynx）；原型为 React+LobeUI web 展示 | functional-modules §1 | drafting | [prototype/README.md](../atelier/prototype/README.md) |

> 状态取值：`drafting`（搭建中）· `pending-review`（待确认）· `confirmed`（已确认，可落地）· `landed`（已落地）· `superseded`（已废弃）。

---

## 4. 原型确认门

```
drafting → pending-review → confirmed → landed
                                  │
                                  └── 设计变更 → superseded（新原型重新走流程）
```

规则：

1. 新原型登记进本表，初始状态 `drafting`。
2. 原型「能跑能点」、可对回设计编号后，置 `pending-review`，提请 Owner 确认。
3. 经 Owner 确认后置 `confirmed`——**只有 `confirmed` 的原型才允许进入对应功能的实现落地**。
4. 功能落地后置 `landed`；设计大改导致原型失效时置 `superseded`，并新建原型重新走门。

未登记或未 `confirmed` 的原型，不得作为落地依据。

**版本快照随开发分支**：原型本质是一个前端工程，"当时版本快照"由 git 仓库本身承载——与当前开发分支保持一致即可，不另堆 tag、也不复制 `v1/ v2/` 目录副本。回看历史形态用 git 历史；本表只记当前对应的设计版本与状态。

---

## 5. 技术栈约束（摘要）

原型是**独立运行的 web 工程**（Vite + React + LobeUI/antd + CSS，浏览器直接看），只为展示终态产品的样子，**不绑定最终运行时**——不碰 Lynx / applet 容器 / SDK。完整约束见 [`global/architecture-document-standard.md` §5.8.2](../../global/architecture-document-standard.md)。

| 维度 | 约定 |
|------|------|
| 技术栈 | React + Vite + `@lobehub/ui` 优先 → antd 兜底 + `react-layout-kit` + `lucide-react` + CSS |
| 运行 | `pnpm dev`（Vite），浏览器打开 localhost |
| 落地 | 由对应工程参照原型按其运行时重新实现（如 Applet 用 Lynx），原型本身不要求能直接搬成产物 |
