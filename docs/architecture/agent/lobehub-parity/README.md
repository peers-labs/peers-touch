# Agent LobeHub Fullstack Parity

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Peers-Touch Agent Team
> **Module**: `apps/desktop/`, `apps/desktop/src-tauri/`, `apps/station/app/subserver/agent/`

---

## 1. Document Scope

本文档集定义 Peers-Touch AI Agent 模块对 LobeHub 的全栈能力对标、原型复刻与架构迁移设计。

本文档定义：

- LobeHub Agent 相关源码路径、能力域和工程责任域。
- Peers-Touch 当前 Agent 前后端能力与 LobeHub 的差距。
- 原型确认门、后端架构门、迁移执行门。
- Memory、Provider、Tool、Knowledge、Session、Runtime、Agent Config 的 source-of-truth 和迁移边界。
- Actor#agent 社交能力的预留边界。

本文档不定义：

- 已有 Agent 架构总原则，见 [../agent-lobehub-blueprint.md](../agent-lobehub-blueprint.md)。
- 已有 Agent 自成长架构，见 [../agent-self-growth-architecture.md](../agent-self-growth-architecture.md)。
- Desktop 组件编码细节，见 `docs/client/desktop/`。
- Station 代码规范，见 `docs/station/` 和 `docs/global/coding-guide/`。

## 2. Plan Source

| Source | Role |
| --- | --- |
| `tmp/agent-lobehub-fullstack-ledger.md` | BOM/Spec/Plan/Gate/Evidence/Traceability 主账本 |
| [../agent-lobehub-blueprint.md](../agent-lobehub-blueprint.md) | 当前 Agent LobeHub 重构正式架构真源 |
| [../execution-plans/20260616-agent-lobehub-rebuild.md](../execution-plans/20260616-agent-lobehub-rebuild.md) | 既有 P0-P5 执行计划和能力覆盖清单 |
| `external/lobehub/` | LobeHub 源码级参考，只读 |

## 3. Design Goals

1. Agent 能力不是前端壳复刻，而是 LobeHub 级全栈能力 parity。
2. UI 原型高保真参考 LobeHub，但后端能力必须适配 Peers-Touch Station / Desktop Rust / Desktop Web 边界。
3. Provider/model 继续消费 Peers-Touch Settings Provider，不重造配置系统。
4. Memory、Knowledge、Tool、Skill、Session、Runtime 的 source-of-truth 必须明确。
5. Actor#agent 社交能力只预留身份、授权、事件和可见性边界，本轮不实现社交产品功能。

## 4. Document Navigation

| Document | Purpose |
| --- | --- |
| [design.md](./design.md) | Station/Desktop/Model source-of-truth、API/proto/storage/event 边界、禁止关系与 Actor#agent 预留边界 |
| [decisions.md](./decisions.md) | LobeHub 对标、真源分配、provider+model、Actor#agent 与迁移门禁 ADR |
| [migration-plan.md](./migration-plan.md) | PLAN-P4 产品迁移批次、依赖顺序、Gate/Evidence 模板与停止条件 |
| [contract-foundation.md](./contract-foundation.md) | M1 Contract Foundation 预执行规格：AgentModelRef、RuntimeEvent、ResourceRef、ToolPolicy、Actor#agent reserved contracts |
| [m1-implementation-kickoff.md](./m1-implementation-kickoff.md) | PLAN-P5/M1 启动包：EVID-010 入口门、目标影响面、实施顺序、验证命令、EVID-012 模板 |
| [desktop-runtime-shell.md](./desktop-runtime-shell.md) | M2 Desktop Runtime Shell 预执行规格：Agent workbench shell、runtime descriptor、projection ownership、兼容迁移 |
| [provider-model-source-map.md](./provider-model-source-map.md) | BOM-003 LobeHub Provider/model source map：aiInfra store、runtime state、remote model fetch、capability selectors 与 Peers Settings Provider 映射 |
| [provider-model-correctness.md](./provider-model-correctness.md) | M3 Provider/model Correctness 预执行规格：Settings Provider 投影、provider+model 唯一性、CLI/Station 边界 |
| [session-topic-action-map.md](./session-topic-action-map.md) | BOM-002 LobeHub Session/Topic/Thread/Message/Generation action map：source-backed action taxonomy 与 Peers ownership 映射 |
| [chat-runtime-source-map.md](./chat-runtime-source-map.md) | BOM-007 LobeHub Chat runtime/stream/recovery source map：StreamingHandler、agentRun lifecycle、client/gateway/parked states 与 Peers runtime contract 映射 |
| [session-topic-runtime.md](./session-topic-runtime.md) | M4 Session/Topic/Message Runtime Closure 预执行规格：typed stream、outbox cursor、retry/branch/reconcile、topic projection |
| [agent-config-source-map.md](./agent-config-source-map.md) | BOM-006 LobeHub Agent config/profile/settings source map：meta、prompt、opening、runtime、bindings、save/recovery semantics 与 Peers Station/Desktop 映射 |
| [agent-config-profile.md](./agent-config-profile.md) | M5 Agent Config/Profile Parity 预执行规格：Station-owned typed config、profile/settings UI、runtime config builder |
| [memory-projection-parity.md](./memory-projection-parity.md) | M6 Memory Projection Parity 预执行规格：Station Memory truth、Desktop projection、chat trace、rollback/recovery |
| [tool-knowledge-source-map.md](./tool-knowledge-source-map.md) | BOM-005 LobeHub Tool/Plugin/Skill/Knowledge/File source map：resource/RAG/tool/MCP/skill/action-lineage 与 Peers ownership 映射 |
| [knowledge-files-parity.md](./knowledge-files-parity.md) | M7 Knowledge/Files Parity 预执行规格：resource lifecycle、local handle、index status、retrieval diagnostics |
| [tool-plugin-skill-parity.md](./tool-plugin-skill-parity.md) | M8 Tool/Plugin/Skill Parity 预执行规格：manifest/policy、approval、local execution、audit trace |
| [error-recovery-diagnostics.md](./error-recovery-diagnostics.md) | M9 Error Recovery/Diagnostics 预执行规格：failure taxonomy、recovery actions、trace、redacted diagnostics |
| [actor-agent-reserved-contract.md](./actor-agent-reserved-contract.md) | M10 Actor#agent Reserved Contract 预执行规格：identity binding、visibility、permission、event boundary |
| [license-attribution.md](./license-attribution.md) | SPEC-014 License/Attribution 边界：LobeHub source reference、direct reuse 禁止项、实现批次 attribution 规则 |
| [pre-implementation-readiness.md](./pre-implementation-readiness.md) | PLAN-P4 收口审计：Gate coverage、M1-M10 readiness、PLAN-P5 entry criteria、claim boundary |
| [plan-p5-implementation-control-board.md](./plan-p5-implementation-control-board.md) | PLAN-P5 执行控制板：EVID-012..EVID-021 批次依赖、状态机、验证命令、禁止 claim 快捷方式 |
| [plan-p5-entry-gate.md](./plan-p5-entry-gate.md) | PLAN-P5 入口硬门禁：Owner confirmed 后、EVID-012 产品编辑前必须满足的证据、路径、命令与 stop conditions |
| [owner-decision-status-snapshot.md](./owner-decision-status-snapshot.md) | Owner 决策状态快照：EVID-010 输入材料、可选 disposition、决策后路径 |
| [prototype-confirmation-gap-audit.md](./prototype-confirmation-gap-audit.md) | Prototype confirmed 前缺口审计：已证据化 surface、Owner 判断项、fail-closed 条件与确认/修订 evidence 模板 |
| [../prototype/owner-review-runbook.md](../prototype/owner-review-runbook.md) | Owner review 执行手册：OR-001..OR-012 场景、确认/修订准则、决策记录模板 |
| [source-audit.md](./source-audit.md) | LobeHub 与 Peers-Touch 源码级入口、能力域、当前差距初筛 |
| [frontend-source-map.md](./frontend-source-map.md) | BOM-001 LobeHub Home/Agent/Chat 前端 source map：Home、Agent rail、Topic rail、Conversation、ChatInput、WorkingSidebar、Profile/Settings 与 Peers ownership 映射 |
| [component-map.md](./component-map.md) | LobeHub Agent/Home/Chat 组件级路径、状态依赖与原型复刻参考 |
| [backend-matrix.md](./backend-matrix.md) | Station Agent 后端能力 ready/partial/missing 矩阵 |
| [desktop-matrix.md](./desktop-matrix.md) | Desktop Agent 页面/store/runtime/Tauri 当前能力矩阵 |
| [integration.md](./integration.md) | LobeHub vs Peers-Touch 全栈能力差距矩阵与 Gate 当前状态 |
| [../prototype/README.md](../prototype/README.md) | Agent 原型入口，原型创建后必须登记 |
