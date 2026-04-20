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
└── execution-plans/           # [可选] 分阶段实施计划
    ├── phase-1-xxx.md
    └── ...
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
