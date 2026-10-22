# 架构文档标准

> **Status**: active
> **Version**: v1.5
> **Created**: 2026-04-20 | **Updated**: 2026-10-20
> **Owner**: Architecture Team

---

## 1. Document Scope

本文档定义：

- 架构文档的固定文件集合与命名规则
- 每个文件的职责边界与按模块特征推导的必选规则
- 元数据块格式
- 目录架构（module layout）的表达规范
- 设计决策的记录格式
- 执行计划的关联方式
- 架构模块正向能力声明与机器校验入口

本文档不定义：

- 具体业务域的架构结论（由各模块自行负责）
- 编码规范（见 `global/coding-guide/`）
- 平台层落地规则（见 `client/` 和 `station/`）

---

## 2. 核心原则

1. **固定文件集** — 每个架构模块是一个目录，内含固定命名的文档文件，不是一个大文件
2. **职责单一** — 每个文件只回答一类问题，读者可以按需阅读
3. **README 是入口** — `README.md` 提供导航，不堆内容
4. **按特征完备** — 协议、状态、存储、ownership 与跨运行时特征决定必需文件
5. **当前态优先** — active 文档只描述当前允许关系，历史事实由 Git 或 `context/` 承载
6. **正向声明** — 只登记当前能力、owner、consumer、契约根和允许依赖

---

## 3. 文件集定义

### 3.1 目录结构

项目级入口固定为：

```text
docs/architecture/
├── README.md                  # 模块索引与导航
├── architecture.md            # 项目级上下文、分层、拓扑、权威与动态链路
├── references.md              # 生成的架构图反向引用
├── domains/
├── platform/
├── shared/
└── engineering/
```

`references.md` 和 `README.md` 中的模块索引由
`tooling/scripts/architecture/document-index.mjs` 从现有 module registry、
`*.diagram.json` 与 Markdown 中的 SVG 资产链接生成，不得手工维护第二份模块
或引用清单。

模块文档结构固定为：

```
architecture/<taxonomy>/<optional-group>/<module>/
├── README.md                  # [必选] 入口：Scope + 背景 + 导航
├── architecture.diagram.json # [条件必选] canonical 主视图 spec
├── architecture.svg          # [条件必选] 统一 renderer 生成的主视图
├── design.md                  # [必选] 架构设计：原则、系统图、核心接口
├── decisions.md               # [必选] 设计决策（ADR-lite 格式）
├── module-layout.md           # [条件必选] 模块目录结构与文件职责
├── data-model.md              # [条件必选] 数据模型、协议结构、持久化 schema
├── integration.md             # [条件必选] 与现有模块的映射、影响面、切换策略
├── execution-plans/           # [可选] 分阶段实施计划
│   ├── phase-1-xxx.md
│   └── ...
└── prototype/                 # [可选] 用落地目标对应的自有前端框架做的可运行原型（代码工程）
    └── README.md              # 仅放入口/跑法说明，原型源码落在落地目标工程（如 packages/applets/<id>/）
```

`<taxonomy>` 只能是 `domains`、`platform`、`shared` 或 `engineering`。
分类与分组 README 只提供导航，不是架构模块。稳定 module ID 由
`architecture-modules.json` 声明，不从目录 basename 推导。

### 3.2 文件职责

| 文件 | 必选 | 回答什么 | 何时需要 |
|------|------|---------|---------|
| `README.md` | **是** | 这个模块是什么、解决什么问题、设计目标、文档导航 | 始终 |
| `architecture.diagram.json` | 条件必选 | Diagram ID、viewpoint 与统一场景内容 | 新建或重画 canonical 架构图 |
| `architecture.svg` | 条件必选 | Markdown 可直接嵌入的 canonical 模块图 | 与 diagram spec 同时生成 |
| `design.md` | **是** | 架构原则、系统架构图、核心接口/契约、组件关系 | 始终 |
| `decisions.md` | **是** | 每个关键决策的 Decision / Rationale / Alternatives | 始终 |
| `module-layout.md` | 条件必选 | 目录树 + 文件职责 + 依赖关系 | 声明 ownership、目录布局或重复实现治理 |
| `data-model.md` | 条件必选 | 协议结构、状态机、持久化 schema、类型映射 | 声明协议、状态机或持久化 |
| `integration.md` | 条件必选 | 与现有模块的映射关系、影响面分析、切换策略 | 声明跨运行时或集成关系 |
| `execution-plans/` | 可选 | 分阶段实施计划，每 Phase 一个文件 | 需要分阶段交付的模块 |
| `prototype/` | 可选 | 用**落地目标对应的自有前端栈**做的**可运行原型**入口与跑法；UI/交互密集的模块用「能跑能点」替代纯文字/线框对齐。须登记进统一原型总账，过「原型确认门」后方可落地 | UI/交互形态需要确认、靠文字描述容易跑偏的模块；纯存储/协议/后端域不扩 |

### 3.3 命名规则

- 文件名固定，不加模块前缀（目录名已表达模块）
- 正确：`architecture/domains/agent/a2a/design.md`
- 错误：`architecture/domains/agent/a2a/a2a-design.md`
- 子模块可嵌套目录：`architecture/domains/agent/a2a/`、`architecture/domains/agent/acp/`

### 3.4 内容完整性 Profile

每个进入机器治理的 active 模块在
`architecture/engineering/architecture-governance/architecture-modules.json`
声明以下布尔特征：

```json
{
  "protocol": false,
  "stateMachine": false,
  "persistence": false,
  "ownership": false,
  "moduleLayout": false,
  "crossRuntime": false,
  "integration": false
}
```

必需文档由特征机械推导：

- 所有模块：`README.md`、`design.md`、`decisions.md`
- `protocol || stateMachine || persistence`：增加 `data-model.md`
- `ownership || moduleLayout`：增加 `module-layout.md`
- `crossRuntime || integration`：增加 `integration.md`

模块不得通过把特征设为 `false` 来隐藏文档已经声明的协议、状态、owner 或跨运行时
关系。Review 必须把这种不一致视为架构缺口。

### 3.5 当前态与历史边界

- active 文档只定义当前接口、能力、owner、依赖和失败语义。
- 已删除标识符不进入 active 文档、模块声明或永久扫描清单。
- 历史原因通过 Git 历史或 `docs/context/` 查证。
- 接口完整性通过当前能力全量 inventory 与 fail-closed discovery 证明。

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

`accepted`、`completed` 和 `prepared` 不是架构文档状态。决策可在
`decisions.md` 条目内使用 `accepted`；执行计划可使用 Plan Package 自身的
lifecycle 状态。

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

（整体架构图 + 文字说明；canonical 图使用统一 renderer 生成的 SVG）

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

#### 架构图视角契约

每张架构图必须显式声明且只回答一个主要视角：

- **System Context**：人、产品系统、外部系统与在线关系；
- **Logical Layer**：同层模块、运行责任、上下游边界与主请求路径；
- **Module Map**：稳定模块、模块边界和包含关系；
- **Runtime Topology**：进程、服务、活跃实例及真实调用；
- **Reuse Topology**：模块组合、复用边界与专用实现；
- **Authority Map**：状态、决策与 mutation owner；
- **Deployment Topology**：发布物、节点、网络与部署位置。
- **Dynamic Flow**：一个 Journey 或状态机的严格时间顺序；
- **Control Plane**：对 data plane 施加约束、调度或证据控制的横向机制。

规则：

- 箭头必须只有一种语义，并在图前说明；调用、依赖、生成和权威流不得
  混用同一组箭头。
- 优先使用分组、包含关系和水平带表达模块边界；当关系类型超过一种或
  连线开始交叉时，拆成多张图。
- 编写顺序、复用分类顺序和执行步骤不是运行时拓扑，不得直接画成上下层级。
- `proto-first` 表示共享契约先定义，不表示 `proto-on-top`。Model 默认作为
  Client 与 Station 共同消费的 contract substrate；如需表达生成产物，使用
  独立的 build/data-flow 图，不得混入 Runtime Topology。
- canonical 项目图和新建或重画的模块图使用同目录 `*.diagram.json` 描述视图，
  由 `diagram-render.mjs` 生成独立 SVG。Markdown 只嵌入 SVG，不暴露机器元数据、
  renderer 语法或隐藏 anchor。
- canonical spec 使用 viewpoint-specific layout 明确声明稳定 Diagram ID、
  module、viewpoint、画布、单一箭头语义与该视角需要的结构：

```json
{
  "kind": "peers-touch-architecture-diagram",
  "schemaVersion": 3,
  "id": "cross-client-runtime.reuse-topology",
  "module": "cross-client-runtime",
  "viewpoint": "reuse-topology",
  "layout": "composition",
  "output": "architecture.svg",
  "title": "跨端客户端复用拓扑",
  "canvas": {
    "width": 1400,
    "height": 830
  },
  "edgeMeaning": null,
  "scene": {
    "rows": [],
    "rail": null,
    "relations": []
  }
}
```

- `id` 和 SVG 输出路径必须全局唯一。引用方链接或嵌入具体 SVG 资产；
  `document-index.mjs` 扫描真实 Markdown link graph 生成反向引用。
- layout 必须匹配 viewpoint：System Context 使用 C4 式系统边界，Logical Layer
  使用分层带，Runtime Topology 使用部署区和真实实例，Reuse Topology 使用共享带，
  Authority Map 使用 owner-state 矩阵，Dynamic Flow 使用时序泳道，Control Plane
  使用带反馈边的控制闭环。
- Dynamic Flow 的互斥路径必须使用 `alt` / `else` fragment，普通范围使用
  `region`；不得把备选路径画成连续执行步骤。Reuse Topology 可使用独立 contract
  rail 表达非运行时契约底座。
- 图内节点只允许标题和一行短副词；源码路径、证据说明、边界解释和失败语义放在
  图前后的正文。禁止用段落、注释卡或 badge 堆叠替代结构表达。
- 所有普通关系线必须正交并使用固定轨道；Dynamic Flow 的消息线必须水平。
  renderer 必须拒绝斜线、节点重叠、连线穿过无关节点、文字越界和关系标签压住节点。
- scene 坐标是经过视觉评审的视图投影，不是第二份模块或 capability registry。
  节点必须能回溯到当前源码、运行实例、外部系统或已接受架构 owner。
- 生成后必须转成位图逐图检查，确认层次、对称、文本边界、连线路由和留白；
  schema 通过不能代替视觉检查。
- `diagram-render.mjs` 是唯一视觉样式 owner。ASCII、Mermaid 与手绘 SVG 只用于
  非 canonical 辅助说明，不得成为新的主架构图。

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
- **源码集中在统一原型工作区**：所有界面原型工程集中放在
  `packages/prototypes/<site>/<area-or-id>/`（纳入 pnpm workspace），其中一级
  `<site>` 只允许 `desktop`、`mobile`、`dashboard`、`control`；`control`
  用于独立部署、被多端消费的云控产品，Station/Relay 运维仍归
  `dashboard`。统一一处便于追踪、统一工具链、基础件可跨原型复用。
  `architecture/<taxonomy>/<module>/prototype/README.md` 只写「原型在哪、
  怎么跑、对应哪版设计、做到什么程度」，不复制源码。原型经确认门置
  `confirmed`、进入落地时，由对应落地工程（如 Applet 落到
  `packages/applets/<id>/` 并按其运行时实现、Desktop 页面落到桌面工程）
  **参照原型重新实现**，总账状态推进到 `landed`——原型本身不要求能直接搬成产物。
- **从设计推导，不脱节**：原型界面区域要能对回 `design.md` / `functional-modules` 的模块编号；设计变更时原型同步或在 README 标注差异。
- **可以用 mock 数据**：原型重在形态与交互，可用假数据驱动，不要求接通真实后端。
- **不替代落地与验收**：原型是设计对齐工具，不是产品代码，不能当作任何运行时的验收证据（如 Desktop L3 须 Lynx bundle 经 Host Gateway，见 applet-runtime 验收门槛）。

#### 5.8.3 统一原型总账与「原型确认门」

所有原型必须在统一总账登记，便于追踪、复用与"先确认后落地"：

- **统一总账**：`docs/architecture/engineering/prototypes/README.md` 维护一张登记表，每个原型登记 `模块 / 原型路径 / 落地目标 / 对应设计版本 / 状态`。状态取值：`drafting`（搭建中）、`pending-review`（待确认）、`confirmed`（已确认）、`landed`（已落地）、`superseded`（已废弃）。
- **版本快照随开发分支**：原型本质是一个前端工程，其"当时版本快照"由 git 仓库本身承载——**与当前开发分支保持一致即可**，不另堆一堆 tag、也不在目录里复制 `v1/ v2/` 副本。需要回看历史形态时用 git 历史；总账只记当前对应的设计版本与状态，不维护版本副本。
- **原型确认门**：原型登记在册并经 Owner 确认（状态置 `confirmed`）后，才允许进入对应功能的实现落地。未确认的原型不得作为落地依据。
- 模块自身的 `architecture/<taxonomy>/<module>/prototype/README.md` 仍是该原型的入口文档，与总账互相引用。

`prototype/README.md` 结构：

```markdown
# <模块名> — 原型

> 元数据块

---

## 原型在哪

`packages/prototypes/<site>/<area-or-id>/`（统一原型工作区；独立 web 工程）

## 落地目标

（这个原型最终要落到哪：Desktop 页面 / Applet(Lynx) / …。注意：原型本身只是 web 展示，落地时由对应工程按其运行时重新实现）

## 怎么跑

```bash
cd packages/prototypes/<site>/<area-or-id>
pnpm install
pnpm dev          # Vite，浏览器打开 localhost
```

## 对应设计

（原型覆盖了哪版 design / functional-modules 的哪些区域，做到什么程度）

## 总账状态

（在 `docs/architecture/engineering/prototypes/README.md` 的登记状态：drafting / pending-review / confirmed / landed / superseded）

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

1. 按 ownership 选择 `domains | platform | shared | engineering`，再创建模块目录
2. 至少创建必选三件套：`README.md`、`design.md`、`decisions.md`
3. 根据内容特征补齐条件必选文件
4. 每个文件顶部填写元数据块，Status 设为 `draft`
5. 设计稳定后将 Status 改为 `active`
6. 在 `docs/README.md` 的 §4.1 架构层真源中注册
7. 在架构模块 registry 中登记 owner、governed paths、decisions 和当前 capabilities

### 7.2 维护规则

- 代码变更影响架构设计时，同步更新对应文档
- `module-layout.md` 必须与代码目录保持同步
- 决策变更时在 `decisions.md` 中新增条目或将旧条目标记为 `superseded`
- 更新时同步刷新 `Updated` 日期和 `Version`
- active 模块被修改时必须通过架构模块治理校验
- 模块能力只维护正向 allowlist，未知接口必须 fail closed

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
