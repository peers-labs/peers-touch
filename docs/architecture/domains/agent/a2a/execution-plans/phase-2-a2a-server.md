# Phase 2: A2A Server（入站）

> **Status**: draft
> **Version**: v2.0
> **Created**: 2026-04-18 | **Updated**: 2026-04-20
> **Owner**: Architecture Team

---

## 目标

Native Agent 可以接收标准 A2A 请求，桥接到 Agent SubServer 的 Turn 执行。补齐 SSE 续传与幂等性。

## 交付物

1. `native/agent/server.go` — JSON-RPC 分发 + AgentExecutor 回调（R-07）
2. `native/agent/converter.go` — A2A Message ↔ AgentMessage 投影
3. `native/agent/propagation.go` — Context propagation header + OTel GenAI span（R-21）
4. `native/agent/sse.go` — SSE 编码、心跳、ring buffer、`Last-Event-ID` 续传（R-05/R-11）
5. `native/agent/` — Task 状态机、KV 持久化 + 幂等键（R-13）
6. `MessageStore` 抽象接口（R-20）— SubServer 实现完整版，Native 实现最小版
7. Hertz handler 注册
8. HTTP 层错误语义（401/403/429/503）+ retryable/transient 分类（R-12 部分）
9. Card `capabilities.extensions` 声明 `peers-touch.*` 扩展（R-16）
10. `caller_principal` + `root_task_id` 传播（R-14 部分）

## 验证标准

```bash
# 同步发送消息
curl -X POST http://localhost:{port}/a2a/default \
  -H "Content-Type: application/json" \
  -H "A2A-Version: 1.0" \
  -d '{
    "jsonrpc": "2.0", "id": "1",
    "method": "SendMessage",
    "params": {
      "message": {
        "messageId": "m-1", "role": "ROLE_USER",
        "parts": [{"kind": "text", "text": "你好"}]
      }
    }
  }' | jq

# 幂等性：相同 messageId 重复发送返回相同 Task
# SSE 流包含 id: 行（sequence）
# 断线重连带 Last-Event-ID 能续传
# OTel span 可在 trace 平台观测
# AgentExecutor 注册与回调正常工作
```

## 依赖

- Phase 1 完成（接口定义 + Agent Card 暴露）
- Agent SubServer 提供 AgentExecutor 实现

## 融入的评审项

- R-05 / R-11：SSE 事件序号 + Last-Event-ID 续传
- R-07：AgentExecutor 接口
- R-12（部分）：HTTP 层错误语义
- R-13（幂等部分）：messageId 幂等键
- R-14（部分）：caller_principal + root_task_id
- R-16：私有 DataPart extensions 声明
- R-20：MessageStore 抽象
- R-21：OTel GenAI Semantic Conventions
