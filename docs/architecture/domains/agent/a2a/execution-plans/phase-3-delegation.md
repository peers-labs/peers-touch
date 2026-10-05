# Phase 3: Delegation 改造

> **Status**: draft
> **Version**: v2.0
> **Created**: 2026-04-18 | **Updated**: 2026-04-20
> **Owner**: Architecture Team

---

## 目标

Agent SubServer 的 delegation_service 改为依赖 Native Agent Client。落地取消级联。

## 交付物

1. `native/agent/client.go` — A2A Client
2. `native/agent/transport.go` — http + inproc 双 transport
3. `app/subserver/agent/service/delegation_service.go` — 改为 `agent.Resolve()` + `agent.Send()`
4. Agent SubServer 启动时将本地 Agent 注册到 Native Agent Registry
5. 取消级联实现（R-22）：child task tracker + 父 canceled 时级联取消 + grace 窗口可配置

## 验证标准

- delegation 在 inproc 与 http 两种 transport 下行为一致
- 已有测试全部通过
- 取消父 Task 后，子 Task 在 grace 窗口内进入 CANCELED
- 取消失败时 metadata 包含 `cancel.partially_failed` 和残余 child IDs
- token 消耗无论终态都被记录
- 关键路径 benchmark（P50/P99 + 内存分配数）

## 依赖

- Phase 2 完成（A2A Server 可接收请求）
- delegation_service 的现有测试覆盖率足够

## 融入的评审项

- R-22：取消级联到 child Task
