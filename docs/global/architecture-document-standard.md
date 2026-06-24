# 架构文档标准

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-04-20 | **Updated**: 2026-04-20
> **Owner**: Architecture Team

---

## 1. Document Scope

本文档定义：

- 架构文档的固定文件集合与命名规则
- 每个文件的职责边界与必选/可选规则
- 元数据块格式
- 目录架构（module layout）的表达规范
- 设计决策的记录格式
- 执行计划的关联方式

本文档不定义：

- 具体架构设计的内容标准（由各模块自行负责）
- 编码规范（见 `global/coding-guide/`）
- 平台层落地规则（见 `client/` 和 `station/`）

---

## 2. 核心原则

1. **固定文件集** — 每个架构模块是一个目录，内含固定命名的文档文件，不是一个大文件
2. **职责单一** — 每个文件只回答一类问题，读者可以按需阅读
3. **README 是入口** — `README.md` 提供导航，不堆内容
4. **按需可选** — 必选文件保证最低完整度，可选文件按模块复杂度按需添加

---

## 3. 文件集定义

### 3.1 目录结构

```
architecture/<module>/
├── README.md                  # [必选] 入口：Scope + 背景 + 导航
├── design.md                  # [必选] 架构设计：原则、系统图、核心接口
├── decisions.md               # [必选] 设计决策（ADR-lite 格式）
├── module-layout.md           # [可选] 模块目录结构与文件职责
├── data-model.md              # [可选] 数据模型、协议结构、持久化 schema
├── integration.md             # [可选] 与现有模块的映射、影响面、迁移策略
├── execution-plans/           # [可选] 分阶段实施计划
│   ├── phase-1-xxx.md
│   └── ...
└── prototype/                 # [可选] 用落地目标对应的自有前端框架做的可运行原型（代码工程）
    └── README.md              # 仅放入口/跑法说明，原型源码落在落地目标工程（如 packages/applets/<id>/）
```

### 3.2 文件职责

| 文件 | 必选 | 回答什么 | 何时需要 |
|------|------|---------|---------|
| `README.md` | **是** | 这个模块是什么、解决什么问题、设计目标、文档导航 | 始终 |
| `design.md` | **是** | 架构原则、系统架构图、核心接口/契约、组件关系 | 始终 |
| `decisions.md` | **是** | 每个关键决策的 Decision / Rationale / Alternatives | 始终 |
| `module-layout.md` | 可选 | 目录树 + 文件职责 + 依赖关系 | 模块 ≥10 个文件，或目录结构对理解架构至关重要 |
| `data-model.md` | 可选 | 协议结构、状态机、持久化 schema、类型映射 | 协议密集型或存储密集型模块 |
| `integration.md` | 可选 | 与现有模块的映射关系、影响面分析、迁移策略 | 涉及存量系统改造或跨模块协作 |
| `execution-plans/` | 可选 | 分阶段实施计划，每 Phase 一个文件 | 需要分阶段交付的模块 |
| `prototype/` | 可选 | 用**落地目标对应的自有前端栈**做的**可运行原型**入口与跑法；UI/交互密集的模块用「能跑能点」替代纯文字/线框对齐。须登记进统一原型总账，过「原型确认门」后方可落地 | UI/交互形态需要确认、靠文字描述容易跑偏的模块；纯存储/协议/后端域不扩 |

### 3.3 命名规则

- 文件名固定，不加模块前缀（目录名已表达模块）
- 正确：`architecture/agent/a2a/design.md`
- 错误：`architecture/agent/a2a/a2a-design.md`
- 子模块可嵌套目录：`architecture/agent/a2a/`、`architecture/agent/acp/`

---

## 4. 元数据块

每个文件顶部必须包含元数据块，采用 `>` 引用块格式：

```markdown
> **Status**: draft | active | superseded | deprecated
> **Version**: v1.0
> **Created**: YYYY-MM-DD | **Updated**: YYYY-MM-DD
> **Owner**: @handle 或团队名
> **Module**: `path/to/module/` （如有对应代码模块）
```

字段说明：

| 字段 | 必选 | 说明 |
|------|------|------|
| Status | **是** | `draft` 草稿、`active` 正式生效、`superseded` 被替代、`deprecated` 废弃 |
| Version | **是** | 语义化版本，重大设计变更升主版本 |
| Created / Updated | **是** | 创建和最近更新日期 |
| Owner | **是** | 负责维护此文档的人或团队 |
| Module | 可选 | 对应的代码模块路径，README.md 中标注即可 |

---

## 5. 各文件编写规范

### 5.1 README.md

结构：

```markdown
# <模块名>

> 元数据块

---

## 1. Document Scope

本文档定义：
- ...

本文档不定义：
- ...（指向其他文档）

## 2. 背景与问题

（现状描述 + 差距 + 为什么需要这个模块）

## 3. 设计目标

（用编号列表，每条一句话）

## 4. 文档导航

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | 架构设计 |
| [decisions.md](./decisions.md) | 设计决策 |
| ... | ... |
```

要求：
- 控制在 **50–100 行**
- 不放设计细节，只放上下文和导航
- Document Scope 必须明确 defines / not defines

### 5.2 design.md

结构：

```markdown
# <模块名> — 架构设计

> 元数据块

---

## 1. 核心原则

（影响本模块所有设计的基本原则，3–5 条）

## 2. 系统架构

（整体架构图 + 文字说明，用 ASCII art 或 Mermaid）

## 3. 核心接口

（关键接口/契约定义，用代码块）

## 4. 组件关系

（组件间的依赖、调用、数据流关系）

## 5. 端点 / API（如适用）

（HTTP 端点、RPC 方法等）
```

要求：
- 控制在 **100–300 行**
- 系统架构图是必选的，至少一张
- 接口定义用代码块，标注语言

### 5.3 decisions.md

结构：

```markdown
# <模块名> — 设计决策

> 元数据块

---

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| D-01 | 一等公民组件模式 | accepted |
| D-02 | HTTP + inproc 双通道 | accepted |
| ... | ... | ... |

---

## D-01: <决策标题>

**Status**: proposed | accepted | rejected | superseded
**Date**: YYYY-MM-DD

### Context

（为什么需要做这个决策，背景问题）

### Decision

（做了什么决定）

### Rationale

（为什么选择这个方案）

### Alternatives Considered

（考虑过的其他方案及其优劣）

### Consequences

（这个决策带来的影响，包括正面和负面）

---

## D-02: ...
```

要求：
- ADR-lite 格式，每条决策独立成节
- 顶部有决策索引表，方便快速浏览
- 跨模块决策沉淀到 `context/decisions/NNN-title.md`，此处只引用
- 评审意见如有，附在对应决策的末尾

### 5.4 module-layout.md

结构：

```markdown
# <模块名> — 模块目录结构

> 元数据块

---

## 目录树

（完整目录树，用 code block）

## 文件职责

| 路径 | 职责 |
|------|------|
| `agent.go` | 核心接口定义 |
| `options.go` | 配置选项 |
| `a2a/` | A2A 协议绑定实现 |
| ... | ... |

## 依赖关系

（模块内部和外部的依赖关系图）
```

要求：
- 目录树保持与代码同步
- 文件职责用表格，每行一句话
- 模块 <10 个文件时，可以在 `design.md` 中用一个小节代替，不需要独立文件

### 5.5 data-model.md

结构：

```markdown
# <模块名> — 数据模型

> 元数据块

---

## 1. 协议层结构（如适用）

（Proto 定义或接口类型）

## 2. 状态机（如适用）

（状态转换图 + 转换规则）

## 3. 持久化策略（如适用）

（存储方案、表结构、索引策略）

## 4. 类型映射（如适用）

（外部协议类型 ↔ 内部类型的映射关系）
```

### 5.6 integration.md

结构：

```markdown
# <模块名> — 集成与映射

> 元数据块

---

## 1. 与现有模块的映射

（标识映射、接口对接、数据流转换）

## 2. 影响面分析

（哪些现有模块需要改动、改动程度）

## 3. 迁移策略（如适用）

（从旧方案到新方案的迁移步骤）
```

### 5.7 execution-plans/

每个 Phase 一个文件：

```markdown
# Phase N: <阶段名>

> 元数据块

---

## 目标

（本阶段要达成什么）

## 交付物

（具体产出列表）

## 验证标准

（怎么确认本阶段完成）

## 依赖

（前置条件、依赖的其他 Phase 或模块）
```

### 5.8 prototype/

用途：UI / 交互密集的模块，**靠文字和 ASCII 线框对齐容易跑偏**，用一个「能跑能点」的网页原型来展示**终态产品长什么样**、替代口头对齐。原型是设计的可执行表达，**不是产品代码、也不绑定最终运行时**——哪怕功能终态会落成 applet（跑在 Lynx 上）或 Desktop 页面，原型阶段只用网页把"长什么样、怎么交互"画出来给人确认即可。

#### 5.8.1 按需可选

原型是 `[可选]` 文件集，不是每个模块都要做：

- **需要原型**：UI / 交互形态需要确认、靠文字描述容易跑偏的模块（产品界面、复杂交互流、面孔密集的功能）。
- **不需要原型，不强行扩**：纯存储 / 协议 / 后端域 / 算法类设计（如持久化 schema、proto 协议、联邦账本、检索管线），用 `design.md` / `data-model.md` 足以表达，**禁止**为了形式主义补一个原型。
- 判定不清时，默认不做；待 UI 形态出现分歧、文字对不齐时再补。

#### 5.8.2 用项目自有桌面 UI 栈做独立网页原型

原型是一个**独立运行的 web 工程**（Vite 起，`localhost` 浏览器直接打开就能看），用项目自有的桌面 UI 栈来画终态产品的样子：

| 维度 | 约定 |
|------|------|
| 技术栈 | React + Vite + `@lobehub/ui`(LobeUI) 优先 → antd 兜底 + `react-layout-kit` + `lucide-react` + CSS |
| 运行方式 | `pnpm dev` 起 Vite，浏览器访问 `localhost`；纯前端、可用 mock 数据 |
| 真源参考 | `global/coding-guide/desktop/page-component.md`（桌面页面/组件栈） |

硬约束：

- **原型不绑定最终运行时，不碰 Lynx / applet 容器 / SDK**：原型只为展示形态。即使功能终态是 applet（Lynx）或 Desktop 页面，原型也只用上表的 web 栈画界面，**不要**为了"贴近运行时"把原型做成 ReactLynx 工程或 applet 容器——那既重又偏离"快速展示终态"的初衷。web 原型可以自由用 DOM、`iframe`、`localStorage` 等浏览器能力。
- **禁止重复造基础件**：原型复用项目已有的桌面组件体系（LobeUI / antd 组件），不得每个需求各搭一套基础库。
- **源码集中在统一原型工作区**：所有界面原型工程集中放在 `packages/prototypes/<id>/`（纳入 pnpm workspace），统一一处便于追踪、统一工具链、基础件可跨原型复用。`architecture/<module>/prototype/README.md` 只写「原型在哪、怎么跑、对应哪版设计、做到什么程度」，不复制源码。原型经确认门置 `confirmed`、进入落地时，由对应落地工程（如 Applet 落到 `packages/applets/<id>/` 并按其运行时实现、Desktop 页面落到桌面工程）**参照原型重新实现**，总账状态推进到 `landed`——原型本身不要求能直接搬成产物。
- **从设计推导，不脱节**：原型界面区域要能对回 `design.md` / `functional-modules` 的模块编号；设计变更时原型同步或在 README 标注差异。
- **可以用 mock 数据**：原型重在形态与交互，可用假数据驱动，不要求接通真实后端。
- **不替代落地与验收**：原型是设计对齐工具，不是产品代码，不能当作任何运行时的验收证据（如 Desktop L3 须 Lynx bundle 经 Host Gateway，见 applet-runtime 验收门槛）。

#### 5.8.3 统一原型总账与「原型确认门」

所有原型必须在统一总账登记，便于追踪、复用与"先确认后落地"：

- **统一总账**：`docs/architecture/prototypes/README.md` 维护一张登记表，每个原型登记 `模块 / 原型路径 / 落地目标 / 对应设计版本 / 状态`。状态取值：`drafting`（搭建中）、`pending-review`（待确认）、`confirmed`（已确认）、`landed`（已落地）、`superseded`（已废弃）。
- **版本快照随开发分支**：原型本质是一个前端工程，其"当时版本快照"由 git 仓库本身承载——**与当前开发分支保持一致即可**，不另堆一堆 tag、也不在目录里复制 `v1/ v2/` 副本。需要回看历史形态时用 git 历史；总账只记当前对应的设计版本与状态，不维护版本副本。
- **原型确认门**：原型登记在册并经 Owner 确认（状态置 `confirmed`）后，才允许进入对应功能的实现落地。未确认的原型不得作为落地依据。
- 模块自身的 `architecture/<module>/prototype/README.md` 仍是该原型的入口文档，与总账互相引用。

`prototype/README.md` 结构：

```markdown
# <模块名> — 原型

> 元数据块

---

## 原型在哪

`packages/prototypes/<id>/`（统一原型工作区；独立 web 工程）

## 落地目标

（这个原型最终要落到哪：Desktop 页面 / Applet(Lynx) / …。注意：原型本身只是 web 展示，落地时由对应工程按其运行时重新实现）

## 怎么跑

```bash
cd packages/prototypes/<id>
pnpm install
pnpm dev          # Vite，浏览器打开 localhost
```

## 对应设计

（原型覆盖了哪版 design / functional-modules 的哪些区域，做到什么程度）

## 总账状态

（在 `docs/architecture/prototypes/README.md` 的登记状态：drafting / pending-review / confirmed / landed / superseded）

## 已知差异 / 待补

（原型与设计不一致处、尚未做的面孔/交互）
```

---

## 6. 语言规则

- 文档正文默认中文
- 面向外部消费（开源文档、外部协议分析）可用英文
- 代码注释保持英文
- 同一个文档集内语言统一，不要中英混杂

---

## 7. 新建与维护流程

### 7.1 新建模块文档

1. 创建 `architecture/<module>/` 目录
2. 至少创建必选三件套：`README.md`、`design.md`、`decisions.md`
3. 每个文件顶部填写元数据块，Status 设为 `draft`
4. 设计稳定后将 Status 改为 `active`
5. 在 `docs/README.md` 的 §4.1 架构层真源中注册

### 7.2 维护规则

- 代码变更影响架构设计时，同步更新对应文档
- `module-layout.md` 必须与代码目录保持同步
- 决策变更时在 `decisions.md` 中新增条目或将旧条目标记为 `superseded`
- 更新时同步刷新 `Updated` 日期和 `Version`

### 7.3 存量文档迁移

现有的单文件架构文档（如 `notification-architecture.md`）：
- 下次大改时按本标准拆分到文档集
- 拆分前保持现状，不强制迁移
- 拆分后将旧文件标记为 `deprecated` 并指向新目录

---

## 8. 与其他文档体系的关系

- 本标准约束 `docs/architecture/` 下的模块文档
- 平台层文档（`client/`、`station/`）不受本标准约束，但鼓励参考
- 编码规范（`global/coding-guide/`）有独立的组织方式
- `context/decisions/` 存放跨模块 ADR，模块内决策在各自 `decisions.md`
