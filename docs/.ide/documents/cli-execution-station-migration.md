# CLI Agent 执行迁移至 Station

## Context

当前 CLI Agent（如 `traecli exec`）在 Desktop 本地进程中执行。Mobile 无法使用此能力。
迁移目标：CLI 命令统一由 Station 执行，Desktop/Mobile 均通过 SSE 流式消费结果。

## 架构变更

```
Before:
  Desktop → 判断 cli_command → 本地 spawn 进程 → 返回结果
  Mobile  → 无法使用 CLI agent

After:
  Desktop/Mobile → POST /sub-agent/agent/turn/stream (含 cli_command)
                 → Station 路由到 CLI 执行器
                 → Station spawn 进程，流式推送 text 事件
                 → Client 通过 SSE 消费
```

## 实施方案

### Phase 1: Proto + Station CLI 执行器

#### 1.1 Proto 变更

文件: `model/domain/agent/agent.proto`

`ExecuteTurnRequest` 新增字段:
```protobuf
optional string cli_command = 15;
optional string runtime_backend = 16;
repeated string allowed_roots = 17;
```

#### 1.2 Station CLI 执行子包

新建: `apps/station/app/subserver/agent/service/cli/`

```
cli/
├── executor.go       // CliExecutor — spawn + 流式读 stdout + SSE 推送
├── normalizer.go     // NormalizeCommand — 适配器展开逻辑 (trae/codex/claude/cursor)
├── prompt.go         // BuildCliPrompt — SOUL.md + AGENTS.md + User 组装
└── workspace.go      // WorkspaceManager — session workspace clone/cleanup
```

**executor.go 核心接口**:
```go
type CliExecutor struct {
    workspaceMgr *WorkspaceManager
}

func (e *CliExecutor) Execute(ctx context.Context, req *CliTurnRequest, sink EventSink) error
```

**normalizer.go** — 从 Desktop Rust 移植适配器映射:
- `trae` / `traecli` / `traex` → `traecli exec --skip-git-repo-check -`
- `codex` → `codex exec --skip-git-repo-check -`
- `claude` → `claude -p`
- `cursor` / `cursor-agent` → `cursor-agent --print --output-format text --trust`

**prompt.go** — 组装三段式 prompt:
```
# SOUL.md
{identity}

# AGENTS.md
{agent_config_prompt}

# User
{user_input}
```

Prompt 投递: cursor 作为最后一个参数，其余写入 stdin。

**workspace.go** — 工作区生命周期:
- 基础路径: `/var/lib/peers-touch/agent-workspaces/{actor_id}/{session_id}/`
- 创建: `git clone` 或 `git worktree add` (从 deploy repo)
- 清理: 会话结束后异步删除（可配置 TTL）
- 环境变量注入: `PEERS_TOUCH_AGENT_WORKSPACE`, `PEERS_TOUCH_*`

#### 1.3 TurnService 路由

文件: `apps/station/app/subserver/agent/service/turn_service.go`

在 `ExecuteTurn` 入口增加分流:
```go
if config.CliCommand != "" {
    return s.cliExecutor.Execute(ctx, buildCliRequest(config), eventSink)
}
// 原有 LLM turn 路径...
```

#### 1.4 流式输出

复用现有 SSE 事件类型，不引入新类型:
- CLI 开始: `event: progress` + `{"step": "cli_started", "command": "traecli"}`
- 输出块: `event: text` + `{"content": "..."}`（逐行/逐 4KB 推送 stdout）
- 完成: `event: done` + `{"model": "...", "executionOwner": "station-cli"}`
- 错误: `event: error` + `{"error": "CLI exited with status 1: ..."}`

### Phase 2: CLI Binary 检查

#### 2.1 Provider 配置时验证

文件: `apps/station/app/subserver/agent/handler/provider_handler.go`

新增端点 `POST /agent/provider/verify-cli`:
- 输入: `{ "cli_command": "traecli" }`
- 行为: `exec.LookPath(program)` 检查 binary 可用性
- 输出: `{ "available": true/false, "path": "/usr/local/bin/traecli", "install_hint": "..." }`

#### 2.2 Desktop/Mobile 配置页

在 Provider 设置保存时调用验证端点。不可用时显示安装提示（官网链接）。

### Phase 3: Desktop 侧精简

文件: `apps/desktop/src-tauri/src/application/agent_turn/mod.rs`

删除:
- `execute_cli_turn_stream` 函数
- `execute_cli_turn` 函数
- `run_cli_command` 函数
- `normalize_cli_command` 函数
- `build_cli_prompt` 函数
- `cli_adapter_name`, `cli_prompt_delivery` 等辅助函数

`agent_execute_turn_stream` 简化为**始终走 `stream_station_turn`**，不再判断 `cli_command`。
`cli_command` 字段原样传给 Station（已在 `build_turn_request_body` 中）。

### Phase 4: 安全加固

- Station 端 `allowed_roots` 强制验证（CLI 进程只能访问 workspace 及 allowed 路径）
- 进程超时: 默认 5 分钟，可配置
- 命令白名单: 仅允许已注册的适配器名，禁止任意 shell 命令
- 可选 PRoot 沙箱（后续迭代）

## 不改变的部分

- SSE 协议格式不变（Desktop/Mobile 前端零修改）
- Provider/Model 配置存储不变（仍由 Station 管理）
- 非 CLI Turn 路径不变（LLM 直接调用）
- Desktop executor worker（Station→Desktop 反向委派）保留，用于需要 Desktop 本地环境的场景

## 验证方式

1. Station 单测: `cli/executor_test.go` — mock CLI binary，验证 spawn + stdout capture + SSE 事件
2. 集成测试: 配一个 echo-based 测试 CLI command（`echo "hello"`），验证端到端 SSE 流
3. Desktop E2E: 选择 CLI 模型发消息 → 确认走 Station SSE → 收到响应
4. Provider 配置: 保存 CLI Provider → 验证 binary check → 不存在时提示安装
5. Mobile 验收: 同一个 Agent + CLI 模型，Mobile 发消息得到响应

## 交付顺序

1. Proto 变更 + `model/build.sh` 生成
2. Station `service/cli/` 子包实现 + 单测
3. TurnService 路由分流
4. CLI binary 验证端点
5. Desktop 精简（删除本地执行代码）
6. 端到端验证
