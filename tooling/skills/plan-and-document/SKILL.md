---
name: "plan-and-document"
description: "规划落盘与计划追踪。当用户要求把讨论结果转为正式设计文档/执行计划/任务清单并落盘追踪时调用。教 agent 找到项目文档规范、选对落盘位置、按标准结构输出。"
---

# 规划落盘与计划追踪（Plan & Document）

当用户说"列成计划"、"落盘"、"准备好文档再实施"、"出个执行计划"、"先规划再动手"时，本 skill 指导你**完整执行从讨论到正式文档的落地流程**。

---

## 1. 触发场景

- 用户要求把讨论结果**写成正式文档**
- 用户要求**先出计划/设计再动手**
- 用户要求**追踪进度**（任务清单、阶段状态）
- 用户说"落盘"、"列计划"、"准备好再实施"

---

## 2. 第一步：找到项目文档规范

在写任何正式文档之前，**必须先读这些规范文件**确认格式与位置：

| 你要做什么 | 先读什么 |
|-----------|---------|
| 写架构设计文档 | `docs/global/architecture-document-standard.md`（文件集/命名/元数据/结构） |
| 判断文档该放哪一层 | `docs/README.md` §3-4（三层真源体系 + 按问题找位置） |
| 大需求文档化流程 | `docs/knowledge/playbooks/documenting-large-requirements.md` |
| 做执行计划拆解 | `tooling/skills/architecture-execution-methodology/SKILL.md` |
| 做原型 | `tooling/skills/prototype-design/SKILL.md` |

**禁止**不读规范就凭记忆写文档。每次落盘前至少确认：放对位置 + 用对结构。

---

## 3. 第二步：确定落盘位置

按问题层级选目录：

```
"系统为什么这么设计" → docs/architecture/<domain>/
"某平台内部怎么落地" → docs/client/<platform>/ 或 docs/station/
"怎么写代码"        → docs/global/coding-guide/
"历史材料"          → docs/context/
"工作过程草稿"      → .trae/documents/（不作为正式真源）
```

### 架构模块文件集（必须遵守的固定命名）

```
docs/architecture/<module>/
├── README.md              # [必选] 入口导航
├── design.md              # [必选] 架构设计
├── decisions.md           # [必选] 设计决策 ADR
├── data-model.md          # [可选] 数据模型/协议/schema
├── module-layout.md       # [可选] 目录结构与文件职责
├── integration.md         # [可选] 映射/影响面/迁移
├── execution-plans/       # [可选] 分阶段实施计划
└── prototype/             # [可选] 原型入口说明
```

### 执行计划文件

放在对应模块的 `execution-plans/` 下，文件名可用 `日期-需求名.md` 或语义命名。

---

## 4. 第三步：文档结构要求

### 4.1 元数据块（每个文件顶部必须有）

```markdown
> **Status**: draft | active | superseded | deprecated
> **Version**: v1.0
> **Created**: YYYY-MM-DD | **Updated**: YYYY-MM-DD
> **Owner**: @handle 或团队名
```

### 4.2 执行计划推荐结构

```markdown
# <需求名> — 执行计划

> 元数据块

---

## 1. 背景与目标

## 2. 范围与非目标

## 3. 方案设计（或引用 design.md）

## 4. 实施阶段

### Phase 1: <名称>
- 目标：
- 涉及文件/模块：
- 验收标准：
- 依赖：

### Phase 2: ...

## 5. 风险与缓解

## 6. 验证方式
```

### 4.3 设计文档推荐结构

参照 `docs/global/architecture-document-standard.md` §5 各文件编写规范。

---

## 5. 第四步：计划追踪

### 方式一：文档内追踪（推荐大需求）

在执行计划文档中维护状态表：

```markdown
## 实施状态

| Phase | 状态 | 完成日期 | 备注 |
|-------|------|---------|------|
| Phase 1 | ✅ done | 2026-06-22 | commit abc123 |
| Phase 2 | 🔄 in progress | — | |
| Phase 3 | ⬜ pending | — | |
```

### 方式二：TodoWrite（推荐会话内短任务）

对于当前会话内可完成的任务，用 TodoWrite 工具实时追踪。

### 方式三：dev-workflow session（推荐代码交付）

需要走完整开发流程（plan → code → review → release）时，使用 `dev-workflow` skill。

---

## 6. 第五步：更新可发现性

文档写完后必须做：

1. **更新最近的 README.md** — 确保目录内有链接指向新文件
2. **更新 `docs/README.md`**（如果是新的真源文档）— 加入 §4 对应层级
3. **告知用户正式文档路径** — 在实施前明确列出落盘位置

---

## 7. 完整检查清单

落盘完成后逐项确认：

- [ ] 读过了相关规范文件（§2 表格中至少一个）
- [ ] 文档放在了正确层级目录
- [ ] 文件命名遵循固定命名规则（不加模块前缀）
- [ ] 顶部有完整元数据块
- [ ] 结构清晰（背景/目标/方案/阶段/验收）
- [ ] 最近 README.md 已更新链接
- [ ] 已告知用户文档路径
- [ ] 如有实施阶段，已标注当前状态

---

## 8. 反模式

- **不读规范就写** — 导致放错位置、格式不对、命名不规范
- **只写在 `.trae/documents/` 不提升到 `docs/`** — 工作草稿不是正式真源
- **只列目标不列交付物** — 计划必须可验收
- **跳过确认直接实施** — 大需求必须用户确认计划后再动手
- **不更新导航** — 新文档如果在目录导航里找不到，等于不存在

---

## 9. 与其他 skill 的关系

| 场景 | 用哪个 skill |
|------|-------------|
| 架构落地/领域拆解 | `architecture-execution-methodology` |
| 完整开发周期（code→PR） | `dev-workflow` |
| 创建/修改原型 | `prototype-design` |
| 本 skill | 讨论→正式文档落盘→计划追踪 |

本 skill 是"文档落盘入口"——告诉你去哪找规范、在哪写、怎么写、怎么追踪。具体架构拆解方法论交给 `architecture-execution-methodology`。
