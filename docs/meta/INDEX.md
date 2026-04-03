# Peers Touch 统一文档库索引

> **定位**：本文档库（`docs/`）是 Peers Touch 项目的**唯一知识源**。
> 此前分散于 `.prompts/` 和 `docs/` 两处的文档已全部合并至此，覆盖全局规范、客户端、后端、横向架构以及历史决策等全部维度。

---

## IDE 配置导出

`docs/.ide/` 目录存放 AI 助手规则、参考文档、任务规格等 IDE 配置源文件，已纳入版本管理。

执行以下脚本可将配置同步到各 IDE 的本地配置目录：

```bash
bash tooling/scripts/ide-setup.sh
```

> 脚本会将 `docs/.ide/rules/`、`docs/.ide/documents/`、`docs/.ide/specs/` 以及 `docs/.ide/scoped/` 下的内容分发至对应 IDE 工作区。

---

## 阅读顺序建议

```
global/                  ← 1. 从全局规范开始，理解项目第一性原理与整体架构
  ↓
client/desktop/          ← 2a. 桌面端开发者继续阅读
client/mobile/           ← 2b. 移动端开发者继续阅读
client/common/           ← 2c. 共享层开发者继续阅读
  ↓
station/                 ← 3. 后端 / Station 开发者阅读
  ↓
architecture/            ← 4. 横向架构设计，了解跨端边界与统一方案
```

---

## 目录总览

```
docs/
├── .ide/                          # IDE 配置源（version controlled）
├── meta/                          # 元信息
├── global/                        # 全局规范
├── client/                        # 客户端
│   ├── desktop/
│   ├── mobile/
│   └── common/
├── station/                       # 后端
├── architecture/                  # 横向架构设计
└── context/                       # 历史与决策
```

---

## 1. `meta/` — 元信息

| 文件 | 说明 |
|------|------|
| `INDEX.md` | 本文件，文档库总索引 |
| `GLOSSARY.md` | 术语表：Actor、Station、Federation 等核心概念定义 |
| `CHANGELOG.md` | 文档体系变更日志，记录 Prompt 系统的演进历史 |

---

## 2. `global/` — 全局规范

所有开发者**必读**，定义项目级的原则与约定。

| 文件 | 说明 |
|------|------|
| `first-principles.md` | 第一性原理，规则层级体系（L0/L1/L2/L3），不可违反的底线 |
| `project-identity.md` | 项目定位：Peers Touch 是什么、愿景与核心价值 |
| `architecture.md` | 整体架构概览：Station ↔ Desktop ↔ Mobile 的关系与通信模型 |
| `domain-model.md` | Proto-based 领域模型系统，跨端统一数据定义 |
| `coding-standards.md` | 通用编码规范，适用于所有语言和平台 |
| `workflow.md` | 开发工作流，包含 AI Agent 必须执行的验证步骤（Lint → Build → Test） |

---

## 3. `client/` — 客户端

### 3.1 `client/desktop/` — 桌面端（Tauri + React/TS + Rust）

| 文件 | 说明 |
|------|------|
| `base.md` | 桌面端基础架构：技术栈、目录结构、启动流程 |
| `global-context-kernel.md` | GlobalContext 内核设计，桌面端全局状态管理核心 |
| `provider-model-target-architecture.md` | Provider-Model-Target 架构模式，数据流与分层设计 |

### 3.2 `client/mobile/` — 移动端（Flutter + GetX）

| 文件 | 说明 |
|------|------|
| `base.md` | 移动端基础架构：技术栈、目录结构、GetX 模式 |
| `description.md` | 移动端产品功能描述与模块划分 |
| `ui-skeleton.md` | UI 骨架设计：页面框架、导航结构 |
| `components.md` | 通用组件规范与使用方式 |
| `theme.md` | 主题系统：颜色、字体、间距等设计令牌 |
| `animation.md` | 动画规范：转场、微交互、性能约束 |
| `visual.md` | 视觉规范：图标、图片、品牌元素 |
| `native-dual-platform.md` | iOS/Android 双平台原生适配策略 |
| `applet-container.md` | 小程序容器设计：Applet 运行时与隔离机制 |
| `sync-protocol.md` | 数据同步协议：客户端与 Station 间的同步策略 |

### 3.3 `client/common/` — 共享层

| 文件 | 说明 |
|------|------|
| `base.md` | 共享代码原则：什么可以共享、如何组织 |
| `packages.md` | peers_touch_base 与 UI 共享包的结构和使用 |
| `globalcontext.md` | GlobalContext 跨端共享层设计 |

---

## 4. `station/` — 后端（Go）

| 文件 | 说明 |
|------|------|
| `base.md` | Station 基础架构：服务结构、生命周期、配置管理 |
| `go-standards.md` | Go 编码规范：命名、错误处理、包结构 |
| `api-documentation.md` | API 文档规范与 Proto 定义映射 |
| `app-layer.md` | App 层开发指南：业务逻辑 Subserver 的编写方式 |
| `frame-layer.md` | Frame 层开发指南：核心基础设施、中间件、路由 |
| `subserver-standard.md` | Subserver 标准：注册、生命周期、依赖注入 |
| `lib-usage.md` | 基础库使用规范：Logger、Config、Store 等必读用法 |

---

## 5. `architecture/` — 横向架构设计

跨端、跨层的统一设计方案。

| 文件 | 说明 |
|------|------|
| `station-desktop-scope-boundary.md` | Station ↔ Desktop 职责边界划分 |
| `unified-handler-architecture.md` | 统一 Handler 架构：跨端消息处理的一致性设计 |
| `storage/unified-runtime-storage-architecture.md` | 统一运行时存储架构：多端数据持久化方案 |

---

## 6. `context/` — 历史与决策

项目发展过程中的决策记录、实现报告和演进日志。

### 6.1 `context/decisions/` — 架构决策记录（ADR）

| 文件 | 说明 |
|------|------|
| `001-why-getx.md` | 为什么选择 GetX 作为 Flutter 状态管理方案 |
| `002-no-stateful-widget.md` | 禁止使用 StatefulWidget 的决策与替代方案 |
| `003-proto-as-source.md` | Proto 作为领域模型唯一数据源的决策 |
| `003-social-refactor-from-activitypub.md` | 从 ActivityPub 重构社交模块的决策 |

### 6.2 `context/implementation-reports/` — 实现报告

| 文件 | 说明 |
|------|------|
| `ACTIVITYPUB_IMPLEMENTATION_REPORT.zh.md` | ActivityPub 协议实现报告 |
| `REPLY_FIELD_IMPLEMENTATION.zh.md` | 回复字段实现报告 |

### 6.3 `context/evolution/` — 演进日志

| 文件 | 说明 |
|------|------|
| `DEVOLOPMENT_DAILY.zh.md` | 开发日志，记录日常迭代与关键里程碑 |

### 6.4 `context/features/` — 功能规划

| 文件 | 说明 |
|------|------|
| `RADAR_SEARCH_NEXT_STEPS.md` | 雷达搜索功能后续迭代计划 |
| `LAUNCH_SCREEN_ROADMAP.md` | 启动页路线图 |
| `LAUNCH_SCREEN_INTEGRATION.md` | 启动页集成方案 |

### 6.5 `context/architecture/` — 架构探索

| 文件 | 说明 |
|------|------|
| `ice-capability-design.md` | ICE 能力层设计方案 |
| `friend-chat-architecture.md` | 好友聊天架构设计 |

---

## 7. `.ide/` — IDE 配置源

版本管理的 IDE 配置文件，通过 `tooling/scripts/ide-setup.sh` 导出到各 IDE 工作区。

### 7.1 `.ide/rules/` — AI 助手规则

全局适用的 AI 辅助编码规则。

| 文件 | 说明 |
|------|------|
| `bug_fix_rules.md` | Bug 修复规则：禁止补丁式修复，要求根因分析 |
| `code_generation.md` | 代码生成规则：生成前须确认架构和目录 |
| `thinking.md` | 思考规则：合理性优先于最小变更 |
| `*.yml` | Station 相关的结构化规则（字段顺序、日志行、Options 字段等） |

### 7.2 `.ide/documents/` — AI 参考文档

AI 助手在特定任务中参考的上下文文档（集成进度、重构洞察、迁移计划等）。

### 7.3 `.ide/specs/` — 任务规格

结构化的大型任务定义，每个任务包含 `spec.md`（规格）、`tasks.md`（任务分解）和 `checklist.md`（验收清单）。

| 任务 | 说明 |
|------|------|
| `audit-station-desktop-api-parity/` | Station ↔ Desktop API 一致性审计 |
| `establish-ai-engineering-governance-guide/` | AI 工程治理指南建设 |
| `migrate-applet-lynx-runtime/` | Applet Lynx 运行时迁移 |

### 7.4 `.ide/scoped/` — 子项目专属规则

按子项目维度组织的规则集合，包含页面结构、代码质量、样式、组件、控制器等细粒度规范。

| 目录 | 说明 |
|------|------|
| `mobile-flutter/` | Flutter 移动端专属规则（架构、样式、组件、控制器、代码质量等） |
| `station-frame/` | Station Frame 层专属规则（字段顺序、日志、Options 字段等） |

---

## 仓库路径基准

| 模块 | 路径 |
|------|------|
| 桌面端 | `desktop/` |
| 移动端 | `client/mobile/` |
| Station App | `station/app/` |
| Station Frame | `station/frame/` |
| 领域模型 | `model/domain/` |

---

**当前版本**：3.0.0（2026-03-31）— 统一文档库，合并 `.prompts/` 至 `docs/`
