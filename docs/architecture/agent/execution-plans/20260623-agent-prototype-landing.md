# Agent 原型落地计划

> **Status**: in-progress (执行中)
> **Version**: v0.2
> **Created**: 2026-06-23
> **Updated**: 2026-06-25
> **Owner**: Peers-Touch Agent Team
> **Module**: `apps/desktop/`, `apps/desktop/src-tauri/`, `apps/station/app/subserver/agent/`, `model/domain/agent/`
> **Prototype**: `packages/prototypes/desktop/shell/src/AgentChatPage.tsx` + `packages/prototypes/desktop/shell/src/AgentProfilePage.tsx` + `packages/prototypes/agent-canvas/src/AgentCanvasPage.tsx` + `Settings.tsx`

---

## 1. 目的

将 Agent 原型（Agent Chat / Agent Profile / Agent Canvas + Settings 管理面）落地为真实可用的产品功能。

原型验证了产品形态，本计划定义：从原型到真实产品，每一项要做什么、做在哪里、依赖什么、怎么验证。

---

## 2. 现状差距总览

| 原型能力 | 真实产品现状 | 差距级别 |
|----------|-------------|---------|
| SOUL/AGENTS.md 双文件系统提示 | 只有单一 systemPrompt | **架构缺失** |
| Effort (Reasoning Level) | 完全不存在 | **架构缺失** |
| CLI-wrapped Provider (Codex/Claude Code/Trae) | 完全不存在 | **架构缺失** |
| Provider→Model→Effort 三联组合行 | Model 散落在 tab，无组合行 | 形态缺失 |
| Capabilities 统一面板 (Skills+Tools) | 分散三个 tab | 形态缺失 |
| Agent 可见性 (private/workspace) | 无 visibility 字段 | 功能缺失 |
| Workspace Isolation (toggle/mode/days) | 只有 workspace root | 功能缺失 |
| Skills per-agent binding + inline 导入 | 有 skills tab 但无 inline 导入 | 功能不完整 |
| MCP JSON 配置导入 | 无 | 功能缺失 |
| 默认 LLM 配置 | 无 | 功能缺失 |
| Activity: Tasks (运行中任务投影) | CronTab 不是任务投影 | 功能缺失 |
| Activity: Agent Events (trace/audit) | diagnostics 是统计，非事件流 | 功能缺失 |
| A2A Description inline AI Rewrite | 有全量 metadata 生成，无 inline | 交互精化 |
| My Agents 列表/pin/create | ✅ 已完整 | — |
| Agent identity (avatar/name/desc) | ✅ 已完整 | — |
| Agent Builder 右侧面板 | ✅ 超出原型 | — |
| Memory tab | ✅ 已完整 | — |
| Agent CRUD (store/service/Rust/Station) | ✅ 已完整 | — |
| Provider CRUD + Model 选择 | ✅ 已完整 | — |
| Skills/MCP CRUD (Settings 级) | ✅ 已完整 | — |

---

## 3. 任务分解

### Phase A — 数据模型扩展（Proto + Station Domain）

所有上层功能依赖数据模型先到位。

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| A-1 | Agent proto 加 `soul_md` + `agents_md` 字段（string） | `model/domain/agent/*.proto` | 无 | proto build 通过 |
| A-2 | Agent proto 加 `effort` 字段（enum LOW/MEDIUM/HIGH） | `model/domain/agent/*.proto` | 无 | proto build 通过 |
| A-3 | Agent proto 加 `visibility` 字段（enum PRIVATE/WORKSPACE） | `model/domain/agent/*.proto` | 无 | proto build 通过 |
| A-4 | Agent proto 加 workspace isolation 字段组（`isolation_enabled`, `isolation_mode` enum SHARED/INDEPENDENT, `isolation_retention_days`） | `model/domain/agent/*.proto` | 无 | proto build 通过 |
| A-5 | Provider proto 加 `cli` 标记（bool） | `model/domain/agent/*.proto` 或 provider proto | 无 | proto build 通过 |
| A-6 | Station agent domain 模型同步新字段 + 持久化 migration | `apps/station/app/subserver/agent/` | A-1~A-5 | `go test ./...` 通过 |

---

### Phase B — Station 服务逻辑

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| B-1 | PromptAssemblyService 支持 SOUL.md + AGENTS.md 双文件拼装 | Station agent subserver | A-1, A-6 | 单测：给定 soul_md + agents_md，输出正确的 system prompt |
| B-2 | TurnService 透传 effort → LLM reasoning_effort 参数 | Station agent subserver | A-2, A-6 | 单测：effort=HIGH 时 API 调用包含 reasoning_effort |
| B-3 | Agent 列表接口支持 visibility 过滤 | Station agent subserver | A-3, A-6 | 单测：PRIVATE agent 对其他用户不可见 |
| B-4 | CLI Provider 执行路径（转发给 Codex/Claude Code/Trae CLI） | Station or Desktop Rust | A-5 | 集成测试：选 CLI provider 能发起 turn |
| B-5 | Workspace isolation 策略执行 | Station or Desktop Rust | A-4, A-6 | 单测：independent 模式生成独立 workspace 目录 |

---

### Phase C — Desktop Rust (Tauri Commands)

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| C-1 | agent create/update command 透传 soul_md, agents_md, effort, visibility, isolation 字段 | `apps/desktop/src-tauri/` | A-6 | cargo build + 手动调用验证 |
| C-2 | CLI Provider 本地执行 adapter（如果 CLI 走 Desktop Rust 而非 Station） | `apps/desktop/src-tauri/` | A-5 | cargo test |
| C-3 | Workspace isolation 文件系统操作（创建隔离目录、清理过期） | `apps/desktop/src-tauri/` | A-4 | cargo test |

---

### Phase D — Desktop Web（Agent 编辑面 UI）

原型 → 真实 UI，对接真实 store/service。

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| D-1 | **Provider→Model→Effort 组合行** — 重构 AgentProfilePage 顶部为三联 Select | `apps/desktop/src/pages/AgentProfilePage.tsx` | A-2, C-1 | UI 渲染 + 切换联动正确 |
| D-2 | **SOUL/AGENTS.md 双 textarea** — 新增或改造 prompt tab 为双文件编辑 | AgentProfilePage or 新 tab | A-1, C-1 | 编辑保存 → API 回传正确 |
| D-3 | **Capabilities 统一面板** — 合并 skills/tools/mcp 三 tab 为一个 Capabilities tab | AgentProfilePage | 无 | UI 合并后功能不丢失 |
| D-4 | **Skills per-agent inline 导入** — 在 Capabilities 面板内加 inline 导入 form | AgentProfilePage | D-3 | 导入后 skill 绑定到当前 agent |
| D-5 | **Workspace tab** — 加 isolation toggle/mode/days UI | AgentProfilePage | A-4, C-3 | 切换 isolation 保存成功 |
| D-6 | **Activity: Tasks tab** — 对接真实运行中任务投影 | AgentProfilePage | Station 有相应接口 | 展示运行中/已完成任务 |
| D-7 | **Activity: Agent Events tab** — 对接 trace/audit 事件流 | AgentProfilePage | Station diagnostics 接口 | 展示最近事件 |
| D-8 | **A2A Description inline AI Rewrite** — 把全量 metadata 生成改为 description inline 按钮 | AgentProfilePage | 无 | 点击只改写 description |
| D-9 | **My Agents 折叠交互** — 确认现有 AgentSidebar 折叠是否到位，不到位则补齐 | AgentSidebar | 无 | 折叠/展开正常 |

---

### Phase E — Desktop Web（Settings 管理面 UI）

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| E-1 | **Agent 可见性管理** — Settings→Agent 管理 section 对接真实 store | Settings area | A-3, B-3, C-1 | 切换 visibility → 列表过滤生效 |
| E-2 | **默认 LLM 配置** — settings store 加 defaultProvider/defaultModel/defaultEffort | settings store + UI | A-2 | 新建 agent 继承默认配置 |
| E-3 | **MCP JSON 导入** — mcp-service 加 batch import 方法，UI 对接 | mcp-service + MCPTab | 无 | 粘贴 JSON → servers 批量导入 |
| E-4 | **Skills/MCP 编辑** — 确认 inline 编辑是否已有，补齐 | SkillsTab / MCPTab | 无 | 编辑名称/endpoint 保存成功 |

---

### Phase F — CLI-wrapped Provider 完整闭环

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| F-1 | Desktop Provider 列表区分 CLI / Direct | Provider UI | A-5 | UI 标注 CLI badge |
| F-2 | 选 CLI Provider 时 Agent turn 走 CLI 执行路径 | 端到端 | B-4 or C-2 | 选 Codex CLI → 实际执行成功 |

---

## 4. 依赖关系图

```
A-1~A-5 (Proto)
    │
    ▼
A-6 (Station domain + migration)
    │
    ├──► B-1 (Prompt Assembly)  ──► D-2 (SOUL/AGENTS UI)
    ├──► B-2 (Effort → LLM)    ──► D-1 (组合行 UI)
    ├──► B-3 (Visibility filter) ──► E-1 (Settings Agent 管理)
    ├──► B-4 (CLI execution)    ──► F-2 (端到端)
    ├──► B-5 (Isolation)        ──► D-5 (Workspace tab)
    │
    ▼
C-1~C-3 (Rust commands)
    │
    ▼
D-1~D-9 / E-1~E-4 / F-1~F-2 (Desktop Web UI)
```

无依赖可并行的：
- D-3（Capabilities 合并）、D-4、D-8、D-9、E-3、E-4 — 纯 UI 重构，不需要新字段

---

## 5. 执行顺序建议

| 批次 | 任务 | 说明 |
|------|------|------|
| **第 1 批** | A-1 ~ A-6 | Proto 定义 + Station 模型同步，一次性做完所有新字段 |
| **第 2 批** | B-1, B-2, B-3, B-5 + C-1, C-3 | Station 服务 + Rust commands（并行） |
| **第 3 批** | D-1, D-2, D-3, D-5, E-1, E-2 | 核心 UI 落地（骨架立住） |
| **第 4 批** | D-4, D-6, D-7, D-8, D-9, E-3, E-4 | 功能完善 + 交互精化 |
| **第 5 批** | A-5, B-4/C-2, F-1, F-2 | CLI Provider 完整闭环（可后置） |

---

## 6. 验收标准

1. Agent Chat / Agent Profile / Agent Canvas 原型中每一项可交互功能，在真实产品中均可操作且数据持久化。
2. Settings 原型中 4 个 section（Agent 管理/Providers/Skills/MCP）在真实产品中功能完整。
3. `pnpm run check && pnpm run build` 通过。
4. `go test ./...` 通过。
5. Proto 生成无报错。

---

## 7. 不做的事（本轮排除）

- Agent marketplace / hub 发现（P4 范畴）
- Knowledge / 文档绑定（P4 范畴）
- Voice TTS/STT（P5 范畴）
- OAuth connector / Composio（P5 范畴）
- Artifacts（P4 范畴）
- Agent Builder 改造（已超出原型，保持现状）
- Memory 改造（已完整，保持现状）

---

## 8. 关联文档

- 上游蓝图：[Agent LobeHub Blueprint](../agent-lobehub-blueprint.md)
- 总执行计划：[20260616-agent-lobehub-rebuild.md](./20260616-agent-lobehub-rebuild.md)
- 原型源码：`packages/prototypes/desktop/shell/src/AgentChatPage.tsx`, `packages/prototypes/desktop/shell/src/AgentProfilePage.tsx`, `packages/prototypes/agent-canvas/src/AgentCanvasPage.tsx`, `packages/prototypes/desktop/shell/src/Settings.tsx`
- 原型规范：`docs/global/architecture-document-standard.md` §5.8

---

## 9. 执行记录（2026-06-24）

### 9.1 总体完成度

| 范围 | 状态 | 说明 |
|------|------|------|
| Proto / Station turn 链路 | **部分完成** | 已完成 `effort` 透传到 Station Provider 调用；已为 `agent_turn_traces` 补齐 proto 查询契约、Station service/handler/routes；已补 Station `Agent` proto/visibility/CRUD/list 最小实体闭环；Provider proto 已新增 `runtime_kind` / `cli_command` / `protocol` 配置字段。 |
| Desktop Rust Agent store / turn | **部分完成** | 已补默认字段、SOUL/AGENTS/effort/visibility/Agent Workspace/cliCommand 存储与 turn 透传；CLI runner 已形成标准 adapter 闭环，支持 Codex/Claude/TRAE 非交互模板；Path Guard 已覆盖 Desktop Rust 内置本地文件/安全 shell 工具；MCP 外部 server 已从首层 broker guard 提升到最小 workspace/allowedRoots policy 闭环。 |
| Desktop Web Agent 编辑面 | **部分完成** | 已完成 SOUL.md / AGENTS.md、Provider→Model→Effort 顶部三联组合行、Visibility、Agent Workspace、Capabilities 合并、Skills per-agent inline 绑定与导入、Activity 本地真实运行时投影；Activity 已叠加 Station 持久化 `agent_turn_traces` 查询结果，并补齐当前会话 stream frame 的 realtime refresh arm。 |
| Desktop Web Settings 管理面 | **部分完成** | 已完成 MCP JSON 导入、MCP inline 编辑、Settings Agent visibility 过滤，以及全局 defaultProvider/defaultModel/defaultEffort 保存并继承到新建 Agent。 |
| CLI-wrapped Provider | **标准 adapter 完成** | `cliCommand` 非空时由 Desktop Rust 本地执行 CLI，stdout 映射为 Agent stream `text`；Provider 列表 CLI badge 与 Codex/Claude/Trae 预置 catalog 已完成，默认命令使用非交互模板，裸 `codex`/`claude`/`trae` 会被 runner 自动展开。 |
| 验证 | **阶段通过** | `./model/build.sh`、`go test ./app/subserver/agent/...`、`cargo test application::mcp::tests`、`cargo check`、`pnpm run check`、`pnpm run build` 均通过；Desktop build 仅保留既有 Rollup/chunk warnings。 |

### 9.2 任务级状态

| ID | 状态 | 实际处理 |
|----|------|----------|
| A-1 | **架构改写** | 未新增 Agent proto `soul_md`；复用已有 turn 字段 `identity`，Desktop Agent store 使用 `soulMd`。 |
| A-2 | **部分完成** | `ExecuteTurnRequest` 新增 `effort`，并完成生成；未新增 enum，实际使用字符串 `low/medium/high`。 |
| A-3 | **完成到 Station 最小闭环** | `model/domain/agent/agent.proto` 已新增 `AgentVisibility` 与 Station Agent CRUD/list 契约；Desktop Agent store 仍保留本地 `visibility`，Station visibility 用于后续多用户/共享逻辑权限。 |
| A-4 | **架构改写** | 未新增 proto isolation 字段组；Desktop Agent store 使用 `isolationEnabled/isolationMode/isolationRetentionDays`。 |
| A-5 | **完成到配置契约** | Provider proto 未采用单一 bool `cli`，改为更明确的 `runtime_kind` / `cli_command` / `protocol`，可表达 direct、remote、cli 等 runtime。 |
| A-6 | **部分完成** | Station 已新增独立 `Agent` domain/persistence/service/handler/routes 与 AutoMigrate；SOUL/AGENTS/isolation 仍由 Desktop Rust 本地 Agent JSON store 承载。 |
| B-1 | **部分完成** | SOUL/AGENTS 从 Web → Rust → Station turn payload 透传；复用 Station 现有 `identity` / `agent_config_prompt` 入口。 |
| B-2 | **完成** | `TurnConfig` / `ProviderCallRequest` / OpenAI payload 已透传 `reasoning_effort`。 |
| B-3 | **完成到 Station 最小闭环** | Station Agent list/get 已按 `owner_actor_id` 和 `visibility=workspace` 做可见性过滤；create/update/delete 仅 owner 可变更。 |
| B-4 | **完成到安全边界** | CLI Provider 不走 Station 执行；Station ProviderService 明确拒绝 `runtime_kind=cli` / `source_type=cli`，CLI 执行继续由 Desktop Rust 本地 runner 承担。 |
| B-5 | **部分完成** | 已按轻量 Agent Workspace 方案实现 Agent/Task 工作台解析与创建；Desktop Rust 内置本地工具已接入 `workspace_root + allowed_roots` Path Guard；工作空间信息查询与四档清理策略已闭环；MCP 外部 server 已补最小 workspace/allowedRoots policy、受控 cwd/env、响应大小限制与 redirect 禁止。 |
| C-1 | **完成** | Desktop Rust Agent normalize + Web API 类型均已支持新增字段。 |
| C-2 | **完成** | 已实现本地 CLI command 执行、stdin prompt、stdout stream；Codex/Claude/TRAE 默认预设使用标准非交互模板，runner 兼容裸命令自动展开并保留用户自定义完整命令。 |
| C-3 | **部分完成** | Desktop Rust 已创建 `agent_workspace` resolver，并在 turn 执行前解析 Agent/Task workspace；`local_file_read`、`local_workspace_list`、`local_shell_safe:list_dir` 已强制使用 canonical path guard；`agent_workspace_info` / `agent_workspace_clean` 命令和 `clean_expired_tasks` 按保留天数清理已完成。 |
| D-1 | **完成** | AgentProfile 顶部已改为 Provider→Model→Effort 三联组合行，Provider 切换会清空不匹配模型。 |
| D-2 | **完成** | AgentProfile Prompt tab 已切为 SOUL.md / AGENTS.md 双 textarea，并保留 legacy systemPrompt 迁移入口。 |
| D-3 | **完成** | AgentProfile 已将 Tools / MCP / Skills 合并为 Capabilities 面板。 |
| D-4 | **完成** | Capabilities 面板已提供 per-agent Skills 多选绑定，写入 `chatConfig.skills`；URL/Git 导入成功后自动绑定到当前 Agent。 |
| D-5 | **部分完成** | Runtime tab 已改为 Agent 工作空间 / 访问范围 / 执行环境，并可保存 Host/PRoot 配置；Desktop Rust 内置本地工具已消费 `allowedRoots` 形成首批访问范围闭环。 |
| D-6 | **完成到 realtime arm** | AgentProfile Activity tasks 现在合并 Station `agent_turn_traces` 历史回合、当前会话真实 assistant turn/tool/delegation 投影，并在 Activity tab 激活时监听 stream frame 触发 trace refresh。 |
| D-7 | **完成到 realtime arm** | AgentProfile Events 时间线现在合并 Station trace 事件、当前会话本地投影，并通过 `agent.turn_stream_event` 对 tool/progress/error/done 等关键事件进行实时刷新；text/thinking 高频帧不触发持久化刷新。 |
| D-8 | **完成** | Overview / Identity 卡片已新增 Description inline AI Rewrite：通过 `agent-builder` 生成 description 预览，应用时只更新 `description` 字段，不改标题、标签、开场问题或提示词。 |
| D-9 | **完成** | AgentSidebar 的 My Agents 区已补整体折叠开关；折叠时保留导入、Marketplace、导出、克隆、创建等 header 操作入口，展开时显示搜索、置顶 Agent、普通 Agent 列表。 |
| E-1 | **完成** | Settings Agent 管理可编辑 visibility，并在列表头部提供 visibility 过滤（全部/private/workspace/public）。 |
| E-2 | **完成** | Settings General 新增新建 Agent 默认 Provider / Model / Effort；AgentSettingsDrawer 创建时读取并落库继承，同时保留创建后覆盖能力。 |
| E-3 | **完成** | MCP JSON 导入已接入 `MCPTab`。 |
| E-4 | **完成** | MCP inline 编辑已完成；AgentProfile Capabilities 已补齐 Skills inline 导入/绑定，避免复用全局 `skills.enabled`。 |
| F-1 | **完成** | Provider 数据映射新增 `runtime_kind`，从 `config_json.runtime_kind/runtime/cli_command` 识别 CLI；Provider 列表和详情头部已展示 CLI / Direct badge。 |
| F-2 | **完成** | `providers.default.yaml` 新增 Codex CLI / Claude CLI / TRAE CLI 预设；Provider seed 支持 `runtime_kind` 与 `cli_command`，新建 Agent 选择 CLI Provider 时自动写入标准非交互 `cliCommand` 并走 Desktop Rust CLI adapter runner。 |

### 9.3 Agent Workspace 轻量方案（修订）

本轮不按 Docker/VM 设计“强 sandbox”。Agent 的隔离先按“一个 Agent 一个独立工作台”落地：

| 概念 | 语义 | 本轮落地 |
|------|------|----------|
| Agent Workspace | Agent 长期工作台，保存任务草稿、产物、日志和临时文件 | `~/.peers-touch/agents/{agent_id}/workspace` |
| Task Workspace | 每个任务/会话的独立子目录，避免任务互相污染 | `workspace/tasks/{conversation_id}` |
| Access Boundary | Peers-Touch 内置工具/MCP 的路径 allowlist | Desktop Rust 内置本地工具已覆盖；MCP 外部 server 已补最小 workspace/allowedRoots policy 与受控执行环境，但不等同 OS 级 sandbox |
| Host backend | 默认轻量模式，在本机执行，cwd 固定为 Agent workspace | 本轮接入 CLI runner |
| PRoot backend | Linux-only 轻量 rootfs 运行模式 | 本轮只做 `proot -R <rootfs> -b <workspace>:/workspace -w /workspace <cmd>` 包装 |

UI 文案从“会话隔离”改为“Agent 工作空间 / 访问范围 / 执行环境”，避免把目录工作台误导成强安全 sandbox。

#### 9.3.1 多用户共享语义（2026-06-24 确认）

- 不引入 `actor_id + agent_id` 双层目录，Agent workspace 只按 `agent_id` 组织。
- 共享 Agent 意味着被授权的用户可以访问和使用同一个 Agent workspace，而不是每人复制一份。
- 访问控制放在逻辑层做：谁能看到 Agent、谁能执行 Agent、谁能改 Agent 配置、谁能改 `allowedRoots`。
- `private`：只有 owner 可访问；`workspace/team`：授权成员共享同一 workspace；`public`：可发现/可使用，但写权限仍需策略控制。
- 本机 OS 层不做强隔离：同一系统账号下用户仍可绕过 App 直接访问文件系统，这不是本轮目标。

### 9.4 偏离计划说明

- 原计划假设 Agent 实体字段需要 proto + Station migration；实际代码审计后确认 Agent profile 由 Desktop Rust 本地 JSON store 承载，因此 SOUL/AGENTS/visibility/isolation/cliCommand 不再强行走 proto。
- `effort` 是 turn 请求执行参数，已进入 proto/Station Provider 调用链；这是当前唯一必要的 proto 扩展。
- CLI Provider 先落了“能真实执行”的 Desktop Rust 本地闭环，避免只做 UI 标记；Provider catalog、CLI badge、Codex/Claude/TRAE 标准非交互 adapter 已补齐。
- 本次未新建“修复记录文件”，而是将执行记录补入本计划文档，保持单一执行计划来源。

### 9.5 Path Guard 执行记录（2026-06-24）

本次收口的是轻量 Agent Workspace 的“访问范围”首批可验证闭环，范围限定为 Desktop Rust 可直接控制的内置本地工具：

| 项目 | 状态 | 实际处理 |
|------|------|----------|
| Tool contract | **完成** | `AgentLocalToolRequestInput` 新增 `allowed_roots`，本地工具请求可携带 Agent 访问 allowlist。 |
| Path guard | **完成** | `local_file_read`、`local_workspace_list`、`local_shell_safe:list_dir` 统一走 canonical path 校验；默认只允许 `workspace_root`，配置后允许额外 `allowed_roots`。 |
| Stream bridge | **完成** | `agent_execute_turn_stream` 在 Station SSE local tool request 未回传 `allowedRoots` 时，使用原始 Agent turn 的 `allowed_roots` 作为 Desktop 侧兜底，避免访问范围丢失。 |
| MCP boundary | **完成到最小强隔离策略** | MCP server 是外部进程/服务，Desktop Rust MCP broker 已补 stdio/http/sse 执行策略 guard；2026-06-25 继续补 workspace/allowedRoots policy、stdio cwd/env 控制、响应大小限制和 HTTP redirect 禁止。 |
| Verification | **通过** | `cargo test application::tools`、`cargo check`、`pnpm run check` 均通过；Rust 仅保留既有 generated dead-code warnings。 |

### 9.6 Workspace Cleanup 执行记录（2026-06-24）

收口 Agent 工作空间的信息查询与清理策略，覆盖 Rust 命令层 → TS API 层 → AgentProfile Runtime tab UI。

| 项目 | 状态 | 实际处理 |
|------|------|----------|
| Workspace info query | **完成** | `agent_workspace::workspace_info` 计算 total/workspace/profile 大小、task 数量、最后修改时间；使用迭代栈避免深目录递归爆栈。 |
| Four-scope cleanup | **完成** | `clean_workspace` 支持 `tasks` / `artifacts` / `logs` / `all_workspace` 四档；清理后重建骨架目录。 |
| Retention-based task cleanup | **完成** | `clean_expired_tasks` 按 `retention_days` 基于 mtime 清理过期任务目录；UI 侧取 `isolationRetentionDays` 作为默认值。 |
| Tauri commands | **完成** | `agent_workspace_info`、`agent_workspace_clean` 两个命令，入参走 `contracts.rs` 的 `AgentWorkspaceInfoInput` / `AgentWorkspaceCleanInput`。 |
| TS API layer | **完成** | `desktop_api.ts` 新增 `getAgentWorkspaceInfo` / `cleanAgentWorkspace` 及 `AgentWorkspaceInfo` / `AgentWorkspaceCleanScope` 类型。 |
| AgentProfile UI | **完成** | Runtime tab Agent Workspace 卡片新增使用情况（总大小/任务数/路径）和四个清理按钮（清理过期任务/清理产物/清理日志/清空工作空间），切到 Runtime tab 时自动刷新。 |
| i18n | **完成** | zh-CN / en 两套 locale 全部补齐。 |
| Verification | **通过** | `cargo check`、`pnpm run check` 均通过。 |

### 9.7 CLI Provider Adapter 执行记录（2026-06-24）

收口 CLI-wrapped Provider 从“泛命令执行”到“标准 adapter”的差距，保持用户自定义命令能力不被覆盖。

| 项目 | 状态 | 实际处理 |
|------|------|----------|
| Default command templates | **完成** | `providers.default.yaml` 中 Codex/Claude/TRAE CLI 预设改为标准非交互命令：`codex exec --skip-git-repo-check -`、`claude -p`、`trae -p`。 |
| Runner adapter normalization | **完成** | `normalize_cli_command` 只在命令为裸 `codex` / `claude` / `trae` 时自动展开；用户写完整命令时原样执行。 |
| Runtime metadata | **完成** | CLI runner 注入 `PEERS_TOUCH_CLI_ADAPTER`，便于 CLI 子进程识别当前 adapter 类型。 |
| Provider docs | **完成** | Provider README 补充 CLI Provider 标准命令模板、stdin prompt 注入和裸命令兼容语义。 |
| Tests | **完成** | 新增 adapter normalization 单测，覆盖裸 Codex 展开、自定义命令保留、adapter name 识别。 |
| Verification | **通过** | `rustfmt --edition 2021 --check src/application/agent_turn/mod.rs`、`cargo test normalize_cli_command`、`cargo test cli_adapter_name_detects_known_program`、`cargo check`、`pnpm run check` 均通过；全仓 `cargo fmt --check` 因既有无关文件格式差异未作为本次 gate。 |

### 9.8 MCP Broker Guard 执行记录（2026-06-24）

收口 MCP 外部 server 的首层执行边界。注意：这不是 Docker/VM sandbox，也不能约束外部 MCP server 内部再访问文件系统；本次目标是让 Peers-Touch Desktop Rust 在启动/调用 MCP server 前有统一 broker guard，阻断明显危险配置。

| 项目 | 状态 | 实际处理 |
|------|------|----------|
| stdio guard | **完成** | `probe_stdio_server` / `execute_stdio_tool` 执行前统一校验命令、args、env；拒绝 shell wrapper（`sh`/`bash`/`zsh`/`fish`/`cmd`/`powershell`/`pwsh`）、控制字符、空 env key、`=` env key 和 `PEERS_TOUCH_` 保留变量覆盖。 |
| HTTP/SSE guard | **完成** | `probe_http_like_server` / `execute_http_like_tool` / `post_json_rpc` 统一校验 URL 和 headers；仅允许 `https` 或 loopback `http`，禁止 URL 内嵌凭据、header 注入、私网/link-local/metadata literal IP。 |
| Compatibility | **完成** | 本地开发 MCP HTTP fixture 的 `127.0.0.1` loopback 仍允许；已有 stdio fixture（`python3` + script args）仍允许。 |
| Tests | **完成** | 新增 stdio shell 拒绝、reserved env 拒绝、loopback HTTP 允许、public HTTP 拒绝、private literal IP 拒绝、header 注入拒绝测试。 |
| Verification | **通过** | `rustfmt --edition 2021 --check src/application/mcp/mod.rs`、`cargo test application::mcp::tests`、`cargo check`、`pnpm run check` 均通过；Rust 仅保留既有 generated dead-code warnings。 |
| Residual risk | **保留** | MCP server 仍是外部进程/服务，首层 guard 不等同于强路径隔离；强隔离仍需后续 proxy/受限运行环境或 MCP server 级 allowlist。 |

### 9.9 My Agents 折叠复核记录（2026-06-24）

收口 D-9：真实产品侧原本只有 topic date group 折叠，My Agents 列表自身缺少整体折叠开关。

| 项目 | 状态 | 实际处理 |
|------|------|----------|
| Collapse affordance | **完成** | `AgentSidebar` 的 `AgentPicker` header 新增 Chevron 折叠按钮，使用 `agent.sidebar.collapseAgents` / `agent.sidebar.expandAgents` tooltip。 |
| Header actions | **完成** | 折叠后仍保留导入、Marketplace、导出、克隆、创建 Agent 操作入口，避免折叠导致关键操作不可达。 |
| List body | **完成** | 展开时显示搜索框、置顶 Agent、分隔线、普通 Agent 列表；折叠时隐藏搜索和列表。 |
| i18n | **完成** | zh-CN / en 补齐折叠/展开文案。 |
| Verification | **通过** | `pnpm run check`、`pnpm run build` 通过；build 仅保留既有 chunk / Rollup 注释告警。 |

### 9.10 Activity 持久化 Trace 查询闭环（2026-06-25）

收口 D-6 / D-7 的持久化查询部分：Station 已经写入 `agent_turn_traces`，本次补齐查询契约、Station 查询服务、Desktop Rust bridge、Desktop Web Activity 展示。

| 项目 | 状态 | 实际处理 |
|------|------|----------|
| Proto contract | **完成** | `model/domain/agent/agent.proto` 新增 `TurnTraceEntry`、`ListTurnTracesRequest/Response`、`GetTurnTraceRequest/Response`，并通过 `./model/build.sh` 生成 Go / TS。 |
| Station query | **完成** | `TurnService` 新增 `ListTurnTraces` / `GetTurnTrace`，按 `agent_id` 必填、`conversation_id` 可选、分页上限 100 查询 `agent_turn_traces JOIN agent_turns`，并映射完整 trace domain/proto。 |
| Station route | **完成** | Agent subserver 新增 `/agent/turn/trace/list` 与 `/agent/turn/trace/get` typed handlers，继续走 `logIDWrapper` + `jwtWrapper`。 |
| Desktop Rust bridge | **完成** | `contracts.rs`、`application/agent_turn`、`tauri_commands/agent_turn`、`main.rs` 新增 `agent_turn_trace_list` / `agent_turn_trace_get`，统一通过 `session_resolver` 取 token 并调用 Station。 |
| Desktop TS API | **完成** | `desktop_api.ts` 新增 `listAgentTurnTraces` / `getAgentTurnTrace`，返回生成的 `ListTurnTracesResponse` / `GetTurnTraceResponse` 类型。 |
| Activity UI | **完成** | `AgentProfilePage` 进入 Activity tab 时拉取最近 20 条持久化 trace，转换为 task/event projection，并与当前会话实时投影合并展示；trace loading/error/count 均走 i18n 文案。 |
| Verification | **通过** | `go test ./app/subserver/agent/...`、`rustfmt --edition 2021 ...`、`cargo check`、`pnpm run check` 均通过；Rust 仅保留既有 generated dead-code warnings。 |
| Residual risk | **保留** | 当前完成的是持久化查询闭环，不等同 realtime event arm；Activity 中运行中状态仍依赖当前会话 stream，历史 trace 只反映 Station 已落库数据。 |

### 9.11 Activity realtime event arm（2026-06-25）

收口 D-6 / D-7 的实时刷新部分：持久化 trace 查询已经可用后，本次补齐当前会话 Agent turn stream frame 到 Activity tab 的事件 arm，避免用户切在 Activity 时仍需要手动刷新。

| 项目 | 状态 | 实际处理 |
|------|------|----------|
| Event contract | **完成** | `kernel/events/catalog.ts` 新增 `agent.turn_stream_event`，`kernel/events/types.ts` 新增 `AgentTurnStreamEventPayload` 并纳入 `EventPayloadMap`。 |
| Stream fan-out | **完成** | `desktop_api.streamAgentTurn` 在每个 SSE frame 到达时发布 typed event，携带 `streamId`、`conversationId`、`agentId`、`event`、`data`、`timestampMs`。 |
| Activity subscription | **完成** | `AgentProfilePage` 仅在 Activity tab 激活时订阅 stream event；agent 不匹配时忽略，避免跨 Agent 串扰。 |
| Refresh throttle | **完成** | 仅 `progress`、tool、approval、local tool、`error`、`done` 等关键事件触发 trace reload；`text` / `thinking` 高频帧不触发持久化查询。 |
| Verification | **通过** | `pnpm run check`、`pnpm run build` 均通过；build 仅保留既有 Rollup/chunk warnings。 |
| Residual risk | **保留** | Realtime arm 触发的是 Station trace reload；如果 Station 侧尚未落库某个 frame，UI 会在下一次关键事件或重新进入 Activity 时补齐。 |

### 9.12 MCP 最小强隔离策略闭环（2026-06-25）

本次不是 Docker/VM/OS sandbox，也不承诺能限制外部 MCP server 内部自行访问系统资源；本次收口的是 Peers-Touch Desktop Rust broker 可控制范围内的“最小强隔离策略”：执行前有路径 policy、进程环境受控、网络响应有边界、审计可追踪。

| 项目 | 状态 | 实际处理 |
|------|------|----------|
| Tool policy input | **完成** | `McpExecuteToolInput` 新增 `workspace_root` 与 `allowed_roots`，TS API 和 Rust contract 均已透传。 |
| Argument path policy | **完成** | MCP tool arguments 中疑似路径的字符串会在执行前校验：相对路径锚定 `workspace_root`，绝对路径必须落在 `workspace_root` 或 `allowed_roots` 内。 |
| stdio execution boundary | **完成** | stdio MCP 子进程使用 `env_clear()`，只保留 `PATH` 和显式配置 env；有 workspace 时固定 cwd，并注入 `PEERS_TOUCH_AGENT_WORKSPACE` / `PEERS_TOUCH_ALLOWED_ROOTS`。 |
| Protocol limits | **完成** | stdio frame 与 HTTP/SSE response 均增加 8MB 上限；HTTP/SSE client 禁止 redirect，避免被重定向到未授权地址。 |
| Audit | **完成** | MCP tool 执行审计新增 `workspaceRoot`、`allowedRootCount`、`policyDecision`，区分 allow/deny。 |
| Tests | **完成** | 新增 workspace relative path allow 与 absolute outside roots reject 测试；原有 broker guard 测试继续覆盖 shell/env/url/header/ip 策略。 |
| Verification | **通过** | `cargo test application::mcp::tests` 通过，18 个 MCP 测试全绿；`cargo check` 通过。 |
| Residual risk | **保留** | 真正 OS 级强隔离仍需后续 sandbox/proxy/容器化运行环境；本次已把 Peers-Touch 可控 broker 边界收紧到可验收的最小闭环。 |

### 9.13 Station Agent visibility filtering（2026-06-25）

收口 B-3 与多用户逻辑权限的 Station 最小闭环：不复制物理 workspace，不引入 `actor_id + agent_id` 双层目录；共享 Agent 仍指向同一个 workspace，谁可见、谁可改由 Station 逻辑权限控制。

| 项目 | 状态 | 实际处理 |
|------|------|----------|
| Proto contract | **完成** | `model/domain/agent/agent.proto` 新增 `AgentVisibility`、`Agent`、`List/Get/Create/Update/DeleteAgent` request/response，并通过 `./model/build.sh` 生成。 |
| Persistence | **完成** | Station 新增 `agents` GORM model，包含 `visibility`、`owner_actor_id`、provider/model/effort/config 等字段，并加入 `AllModels()` AutoMigrate。 |
| Domain/service | **完成** | 新增 `AgentService`，list/get 只返回 owner 自己或 `workspace` 可见 Agent；create 默认 owner 为当前 JWT subject；update/delete 仅 owner 可执行。 |
| Handler/routes | **完成** | 新增 `/agent/list`、`/agent/get`、`/agent/create`、`/agent/update`、`/agent/delete` typed handlers，继续走 `logIDWrapper` + `jwtWrapper`。 |
| Visibility semantics | **完成** | `private` 仅 owner 可见；`workspace` 当前定义为已认证用户可读/list，只有 owner 可改/delete；本轮不引入 public 发布。 |
| Verification | **通过** | `go test ./app/subserver/agent/...` 通过。 |
| Residual risk | **保留** | 这是 Station 侧最小 CRUD/list 权限闭环；Desktop 现有本地 Agent store 与 Station Agent 实体的同步/迁移策略仍属于后续产品化阶段。 |

### 9.14 Provider CLI proto / Station safety boundary（2026-06-25）

收口 A-5 / B-4 的架构边界：CLI Provider 可以作为配置被同步，但 Station 永远不执行本地命令；CLI 执行只属于 Desktop Rust 本地 runtime。

| 项目 | 状态 | 实际处理 |
|------|------|----------|
| Proto contract | **完成** | `model/domain/ai_chat/provider.proto` 的 Provider/Create/Update 契约新增 `runtime_kind`、`cli_command`、`protocol`，比 bool `cli` 更明确表达运行时与协议。 |
| Station persistence | **完成** | `agent_providers` persistence model 新增 `RuntimeKind`、`CliCommand`、`Protocol`，Station 可以保存/同步 CLI provider 配置。 |
| Station execution guard | **完成** | `ProviderService.Call` 遇到 `runtime_kind=cli` 或 `source_type=cli` 时返回 `AgentSecurityViolation`，明确拒绝 Station 侧命令执行。 |
| Desktop contract | **完成** | Desktop Rust / TS provider create/update input 类型补齐 runtime/protocol 字段，保持前端、Rust、proto 字段兼容。 |
| Verification | **通过** | `./model/build.sh`、`go test ./app/subserver/agent/...`、`cargo check`、`pnpm run check` 均通过。 |
| Residual risk | **保留** | Station 已有安全边界和配置字段；Provider CRUD UI 是否直接编辑这些新 proto 字段，可在后续和 Station 同步/迁移一起产品化。 |

### 9.15 最终验证与验收口径（2026-06-25）

| 命令 | 结果 | 说明 |
|------|------|------|
| `./model/build.sh` | **通过** | Agent trace/visibility 与 Provider runtime proto 生成成功。 |
| `cd apps/station && go test ./app/subserver/agent/...` | **通过** | Agent subserver 的 turn trace、visibility、provider boundary 相关 Go 包通过。 |
| `cd apps/desktop/src-tauri && cargo test application::mcp::tests` | **通过** | MCP broker guard + 最小 workspace policy 测试通过，18 个测试全绿。 |
| `cd apps/desktop/src-tauri && cargo check` | **通过** | Rust 编译检查通过，仅保留既有 generated dead-code warnings。 |
| `cd apps/desktop && pnpm run check` | **通过** | Desktop TS/React 检查通过。 |
| `cd apps/desktop && pnpm run build` | **通过** | Desktop Web build 通过，仅保留既有 Rollup/chunk warnings。 |

验收时按以下能力检查：

1. Activity tab：执行 Agent turn 后，当前会话关键 stream event 能触发 trace 刷新；历史 `agent_turn_traces` 能在 Activity tasks/events 中展示。
2. MCP policy：带 `workspace_root` / `allowed_roots` 执行 MCP tool 时，工作区内相对路径允许，越界绝对路径拒绝，审计能看到 policy decision。
3. Station visibility：创建 private Agent 后非 owner 不可见；创建 workspace Agent 后认证用户可读/list；非 owner update/delete 返回 forbidden。
4. CLI Provider boundary：Station ProviderService 收到 CLI runtime provider 时拒绝执行；Desktop Rust CLI runner 仍是本地 CLI provider 的唯一执行路径。
5. 验证命令：以上 6 条命令均通过；当前遗留 warning 不阻断验收，属于既有构建告警。
