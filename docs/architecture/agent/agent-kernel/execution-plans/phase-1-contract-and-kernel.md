# Phase 1 — Contract and Kernel Foundation

> **Status**: draft
> **Version**: 2026.06
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `model/domain/agent/` + `apps/station/app/subserver/agent/`

---

## 1. 目标

建立 Agent Kernel 的最小可运行基座：proto 合同、Station DDD 目录、Agent / RuntimeProfile / Provider / Thread / Turn 基础模型、事件流和 projection read model。

---

## 2. 交付范围

1. 新增 `model/domain/agent/*.proto`。
2. 生成 Go / Rust / TypeScript 所需模型。
3. 新建 Station Agent Kernel 目录骨架。
4. 实现 Agent、RuntimeProfile、ProviderDescriptor、Thread、Turn 的 repository 与 application use case。
5. 实现 TurnEvent 持久化与 event stream。
6. 实现 Agent list、profile、thread list、thread detail 的 projection。

---

## 3. 不做什么

- 不接 MCP。
- 不接 A2A。
- 不做 Desktop 页面完整体验。
- 不实现完整 Memory/Skill 逻辑。
- 不引入 CLI-wrapped Provider。

---

## 4. 验收标准

1. `./model/build.sh` 成功。
2. Station 能创建 Agent、RuntimeProfile、Thread。
3. 执行一个 mock-free 的最小 Turn：可以创建 Turn、写入 TurnEvent、完成 Turn。
4. `GET /agent/agents`、`GET /agent/providers` 和 `GET /agent/threads` 返回 proto contract 对应结构。
5. 当前新 Agent Kernel 可以独立完成最小 Turn 记录闭环；旧入口不是验收条件。

---

## 5. 风险

| 风险 | 处理 |
|------|------|
| proto 子目录生成不支持 | 先扩展生成脚本，不退回手写模型 |
| Agent 路由命名冲突 | Agent Kernel 直接占用 `/agent/*` 作为当前目标 API |
| 目录骨架过度抽象 | 只落 Phase 1 需要的接口和实现 |
