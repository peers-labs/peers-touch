# Peers Touch 扩展文档索引

> `docs/README.md` 是当前主入口。
> 本文件降级为扩展索引，负责补充目录明细、二级入口和历史导航。

---

## 1. 从哪里开始

优先阅读：

- [docs/README.md](../README.md)

它负责回答：

- 文档怎么分层
- 为什么要分层
- 当前正式真源在哪里
- 遇到问题应该先去哪一层找

本文件负责回答：

- 每个目录里大概有哪些内容
- 哪些目录是正式文档，哪些是过程材料
- 如果需要细化检索，可以从哪里继续进入

---

## 2. 一级目录说明

### `global/`

项目全局原则、整体架构和统一规范。

关键入口：

- `global/project-identity.md`
- `global/architecture.md`
- `global/domain-model.md`
- `global/workflow.md`
- `global/coding-guide/`

### `architecture/`

跨端、跨运行时、跨层边界的正式架构真源。

当前子目录：

- `architecture/boundaries/`
  - `station-desktop-scope-boundary.md`
- `architecture/runtime/`
  - `desktop-runtime-architecture.md`
  - `unified-handler-architecture.md`
- `architecture/storage/`
  - `unified-runtime-storage-architecture.md`
- `architecture/i18n/`
  - `i18n-architecture.md`
- `architecture/agent/`
  - Agent 体系架构与执行计划

### `client/`

客户端单端内部文档。

- `client/desktop/`
  - Desktop 平台总纲、内核设计、Provider/Model 等
- `client/mobile/`
  - Mobile 平台总纲、同步、容器、原生双端等
- `client/common/`
  - 共享抽象与共享包说明

### `station/`

Station 单端内部文档。

### `context/`

历史决策、探索材料、实现报告、演进记录。

说明：

- 可以作为背景参考
- 不作为当前正式架构真源

### `.ide/`

IDE / AI 工作材料。

说明：

- 包含任务规格、过程文档、辅助上下文
- 不作为正式产品/架构真源

### `meta/`

术语表、索引、变更记录。

---

## 3. 典型入口

### 看项目整体

- `../README.md`
- `../global/architecture.md`

### 看 Desktop

- `../client/desktop/base.md`
- `../architecture/runtime/desktop-runtime-architecture.md`

### 看 Station 与 Desktop 边界

- `../architecture/boundaries/station-desktop-scope-boundary.md`

### 看编码规范

- `../global/coding-guide/`

### 看历史决策

- `../context/decisions/`

---

## 4. 仓库路径基准

| 模块 | 路径 |
|------|------|
| 桌面端 | `apps/desktop/` |
| 移动端 | `apps/mobile/` |
| Station App | `apps/station/app/` |
| Station Frame | `apps/station/frame/` |
| 领域模型 | `model/domain/` |

---

## 5. 相关元信息

- 术语表：`GLOSSARY.md`
- 文档变更记录：`CHANGELOG.md`
