# Phase 4: 远程 Agent 与生产化

> **Status**: draft
> **Version**: v2.0
> **Created**: 2026-04-18 | **Updated**: 2026-04-20
> **Owner**: Architecture Team

---

## 目标

支持注册和调用外部 A2A Agent，补齐生产能力。

## 交付物

1. `/api/a2a/agents` CRUD 端点
2. 远程 Card 缓存与健康度管理（R-08 健康检查部分）
3. 鉴权管理（securitySchemes 解析）
4. 前端管理页面
5. 可观测（Task metric、SSE 连接数 metric）
6. 安全（超时、重试、并发限制）
7. Policy 安全层（R-23）：`OnInbound`/`OnOutbound`/`OnArtifact` + 内置拦截器
8. Skill/Intent-based 发现 — `ResolveBySkill` tag-based（R-19）
9. A2A Skill → MCP Tool 单向桥（R-01）
10. `/api/a2a/tasks` 过滤参数（state、agentName、time range）
11. 私有错误码命名空间 `-33000`（R-12 剩余部分）
12. token/成本字段对齐 OTel GenAI（R-13 剩余部分）
13. TTL 按 Skill 配置化（R-13）

## 验证标准

- 通过 URL 注册外部 A2A Agent 后，可 `Resolve` 并 `Send`
- 健康检查端点返回 LLM 可用性、队列深度等指标
- Policy 拦截器能阻断超大 payload 和 prompt injection 样本
- `ResolveBySkill("turn")` 返回匹配的 Agent Card 列表
- MCP Tool 列表中出现 A2A Skill 映射的工具
- 与 Google A2A SDK (Python) 的 SendMessage / SendStreamingMessage 互通

## 依赖

- Phase 3 完成（完整的 Client + Server + Delegation）

## 融入的评审项

- R-01：MCP ↔ A2A 单向桥
- R-08（健康检查部分）
- R-12（私有错误码）
- R-13（成本计量 + TTL 配置化）
- R-19：Skill-based 发现
- R-23：Policy 安全层

## 后续展望（Phase 5+）

以下项目已立项但不在 Phase 4 范围内：

- R-02 签名部分：Card JWS 签名 + libp2p Identity 绑定
- R-09 联邦发现：libp2p gossip Agent Card
- R-15：Orchestration 编排原语（Sequence / Parallel / Conditional / Loop）
- R-01 反向桥：MCP Tool → A2A Skill
- Agent Eval / Replay 通道
- Push Notification（webhook 回调）
