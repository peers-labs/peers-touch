# Phase 1: Native Agent 基础设施 + Agent Card

> **Status**: draft
> **Version**: v2.0
> **Created**: 2026-04-18 | **Updated**: 2026-04-20
> **Owner**: Architecture Team

---

## 目标

在 `frame/core/` 建立 Agent 一等公民组件，暴露 Agent Card。数据结构在此阶段定型。

## 交付物

1. `frame/core/agent/` — 接口定义
   - `agent.go`：Agent facade + AgentRegistry / AgentClient / AgentServer 子接口（D-01 + R-06）
   - `types.go`：AgentCard、AgentSkill 等协议数据结构
   - `task.go`：Task 状态机定义
   - `message.go`：Message / Part（带 `kind` discriminator，R-03/R-10）/ Artifact
   - `stream.go`：StreamResponse 类型定义
   - `errors.go`：JSON-RPC + A2A 错误码
   - `options.go`：Option 模式配置
2. `frame/core/plugin/native/agent/` — Native 实现
   - `registry.go`：本地 + 远程 Agent Card 统一注册表
   - `discovery.go`：Agent Card 暴露（含 ETag/Cache-Control，R-02）
   - `plugin.go`：Plugin 注册
3. `frame/core/plugin/native/node/native_init_top_comp.go` — Agent 初始化段
4. `model/domain/agent/a2a.proto` — A2A 协议结构 proto 定义
5. 路由注册：Agent Card 端点

## 验证标准

```bash
# Agent Card 端点可访问
curl http://localhost:{port}/a2a/default/.well-known/agent-card.json | jq

# 响应包含 ETag header
curl -I http://localhost:{port}/a2a/default/.well-known/agent-card.json | grep ETag

# Part 结构包含 kind 字段
# SecurityScheme 使用 tagged union

# Proto 生成成功
./model/build.sh

# Station 构建通过
cd apps/station && go test ./...
```

## 依赖

- 无前置 Phase 依赖
- 需要确认 `native_init_top_comp.go` 组件链的 Agent 插入位置

## 融入的评审项

- R-03 / R-10：Part `kind` discriminator
- R-06：Agent 接口 SRP 拆分
- R-09：SecurityScheme tagged union + SecurityRequirement 注释
- R-02（部分）：ETag + Cache-Control
- R-04（部分）：Card 预留 `supportedProtocolVersions`
- R-17：最小可用形态 = Client + Registry
- R-18：inproc 作为永久 transport 选项
