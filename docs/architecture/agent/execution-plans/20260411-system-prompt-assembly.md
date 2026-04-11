# P0: System Prompt 组装、Context References 与 Prompt Caching

> 最后更新：2026-04-11
>
> 变更记录：
> - 2026-04-11：初版 — 6 层组装 + Frozen Snapshot
> - 2026-04-11：v2 重写 — 新增 Context References 预处理、Prompt Caching 交付物；更新 Hermes 参照、步骤与验收标准

---

## 依赖

无前置依赖。这是所有自成长能力的注入通道，必须最先落地。

- Context References 依赖 workspace 目录已初始化（`allowed_root` 约束）。
- Prompt Caching 依赖 Provider 体系已就绪（需区分 Anthropic 与非 Anthropic provider）。

---

## 目标

在 Station agent subserver 中实现：

1. **System Prompt 6 层组装** — memory 快照、skill 索引、identity、behavioral guidance 按正确顺序注入 system prompt。
2. **Context References 预处理** — 解析用户消息中的 `@file:`、`@folder:`、`@url:` 等引用，展开内容注入上下文，同时实施 token 预算和敏感路径拦截。
3. **Prompt Caching** — 对 Anthropic provider 自动注入 `cache_control` breakpoint，降低约 75% input token 成本。

---

## Hermes 参照

| 模块 | Hermes 文件 | 关键逻辑 |
|------|-------------|----------|
| 6 层组装 | `agent/prompt_builder.py` — `_build_system_prompt()` | 9 个层级按序拼接 |
| Skills Index | `agent/prompt_builder.py` — `build_skills_system_prompt()` | 两层缓存 |
| Context Files | `agent/prompt_builder.py` — `build_context_files_prompt()` | 优先级发现 |
| Context References | `agent/context_references.py` | `@file:` / `@folder:` / `@url:` / `@diff` / `@staged` / `@git:N` 解析、token 预算、敏感路径拦截 |
| Prompt Caching | `agent/prompt_caching.py` | `system_and_3` 策略，4 个 cache_control breakpoint 注入 |

---

## 当前状态

- Station `ai_chat` 的 `CompleteChat()` 只做简单的 system prompt 拼接（直接取 Session 的 systemPrompt 字段）。
- 没有层级组装、没有 memory 注入、没有 skill 索引注入。
- 没有 context references 解析 — 用户消息中的 `@file:` 等引用被原样发送给 LLM，无法展开。
- 没有 prompt caching — 每次请求全量计费，Anthropic 无缓存命中。

---

## 交付物

### 1. `prompt_assembly_service.go` — 6 层组装

实现以下组装顺序：

| Layer | Source | 条件 |
|-------|--------|------|
| 1. Identity | Agent 配置的 identity 文本 | 始终注入 |
| 2. Behavioral Guidance | `MEMORY_GUIDANCE` + `SKILLS_GUIDANCE` 常量 | 按 tool 可用性条件注入 |
| 3. Memory Snapshot | 从 DB 读取当前 agent 的 memory items | session 开始时冻结，存入 turn context |
| 4. Skills Index | 从 DB 读取所有 skill 的 name + description | 构建 `<available_skills>` block |
| 5. Agent Config System Prompt | 用户在 AgentProfilePage 设置的 system prompt | 如果有 |
| 6. Timestamp | 会话开始时间 | 始终注入 |

### 2. `PromptAssemblyResult` 领域对象

```go
type PromptAssemblyResult struct {
    SystemPrompt       string
    MemorySnapshotHash string   // TurnTrace 审计
    SkillIndexHash     string   // TurnTrace 审计
    SkillCount         int
    InjectedTokens     int      // Context References 展开后注入的 token 数
    CacheBreakpoints   int      // Prompt Caching 实际插入的 breakpoint 数
}
```

### 3. Frozen Snapshot 机制

- 同一个 conversation 的 system prompt 在首轮时组装并缓存。
- 后续 turn 复用缓存，不重新读 memory。
- 只有 context compression 后才重新组装。

### 4. Context References 预处理 — `context_reference_service.go`

#### 4.1 引用类型

| 语法 | Kind | 说明 |
|------|------|------|
| `@file:path` | `file` | 注入单个文件内容 |
| `@file:path:10-20` | `file` | 注入文件指定行范围（line_start=10, line_end=20） |
| `@folder:path` | `folder` | 注入目录树结构 + 各文件摘要 |
| `@url:URL` | `url` | 抓取 URL 内容并注入 |
| `@diff` | `diff` | 注入当前 workspace 未暂存变更（`git diff`） |
| `@staged` | `staged` | 注入已暂存变更（`git diff --staged`） |
| `@git:N` | `git` | 注入最近 N 条 commit（`git log -N`） |

#### 4.2 领域对象

```go
// ContextReference — 从用户消息中解析出的单个引用
type ContextReference struct {
    Raw       string // 原始文本，如 "@file:src/main.go:10-20"
    Kind      string // file | folder | url | diff | staged | git
    Target    string // 路径或 URL
    Start     int    // Raw 在原消息中的起始偏移
    End       int    // Raw 在原消息中的结束偏移
    LineStart int    // 行范围起始（仅 file kind）
    LineEnd   int    // 行范围结束（仅 file kind）
}

// ContextReferenceResult — 引用展开后的结果
type ContextReferenceResult struct {
    Message         string              // 展开后的用户消息（引用替换为占位或移除）
    OriginalMessage string              // 未修改的原始用户消息
    References      []ContextReference  // 解析出的所有引用
    Warnings        []string            // soft limit 警告等
    InjectedTokens  int                 // 本次展开注入的 token 总数
    Expanded        []string            // 成功展开的引用 Raw 列表
    Blocked         []string            // 被拦截的引用 Raw 列表
}
```

#### 4.3 Token 预算

| 阈值 | 比例 | 行为 |
|------|------|------|
| Hard Limit | 模型 context window 的 **50%** | 拒绝注入，返回错误，引用加入 `Blocked` |
| Soft Limit | 模型 context window 的 **25%** | 注入成功，但在 `Warnings` 中追加告警 |

#### 4.4 敏感路径拦截

以下路径模式匹配时直接拒绝，不执行文件读取：

```
.ssh, .aws, .gnupg, .kube, .docker,
.hermes/.env, .netrc, .pgpass, .npmrc, .pypirc,
authorized_keys, id_rsa, id_ed25519
```

#### 4.5 安全约束

- **Workspace Sandbox** — 所有 `@file:` / `@folder:` 路径必须解析到 `allowed_root`（workspace 根目录）以内，禁止 `../` 逃逸。
- **Binary 文件检测** — 读取文件前检测是否为二进制（基于 magic bytes / null byte 检测），二进制文件拒绝注入。

### 5. Prompt Caching — `prompt_caching_service.go`

#### 5.1 策略：`system_and_3`

在发往 Anthropic API 的请求中插入 **4 个 `cache_control` breakpoint**：

| Breakpoint | 位置 | 说明 |
|------------|------|------|
| BP-1 | system prompt 末尾 | 缓存完整 system prompt（含 6 层组装结果） |
| BP-2 | 倒数第 3 条非 system 消息 | 缓存历史对话前缀 |
| BP-3 | 倒数第 2 条非 system 消息 | 扩展缓存覆盖范围 |
| BP-4 | 倒数第 1 条非 system 消息 | 最新消息 |

#### 5.2 Cache Marker

```json
{"type": "ephemeral"}
```

扩展 TTL 场景：

```json
{"type": "ephemeral", "ttl": "1h"}
```

#### 5.3 Content 转换

在 `provider_service.go` 发送请求前，对 Anthropic provider 执行转换：

```
// 转换前
content: "You are an AI assistant..."

// 转换后
content: [
  {
    "type": "text",
    "text": "You are an AI assistant...",
    "cache_control": {"type": "ephemeral"}
  }
]
```

#### 5.4 成本效果

命中缓存时，input token 成本降低约 **75%**（Anthropic 对 cached input 按 0.25x 计费）。

缓存在 system prompt 变更（如 compression 后 rebuild）时自动失效。

---

## 步骤

1. **6 层组装核心** — 在 `service/` 下创建 `prompt_assembly_service.go`，实现 `AssembleSystemPrompt(agentID, conversationID) -> PromptAssemblyResult`。
2. **Frozen Snapshot** — 在 `turn_service.go` 的 turn 开始阶段调用 `AssembleSystemPrompt`，首轮结果缓存到 conversation context，后续 turn 复用。
3. **Context References 解析** — 创建 `context_reference_service.go`，实现引用正则解析（`@file:`, `@folder:`, `@url:`, `@diff`, `@staged`, `@git:N`）、行范围提取、路径规范化。
4. **Context References 展开** — 实现文件读取（含行范围截取）、目录树生成、URL 抓取、git diff/log 执行，输出 `ContextReferenceResult`。
5. **Token 预算与安全拦截** — 实现 50% hard limit / 25% soft limit 判定逻辑，敏感路径黑名单匹配，binary 文件检测，workspace sandbox 路径约束。
6. **Context References 集成** — 在 turn loop 中，`AssembleSystemPrompt` 之后、LLM 调用之前，对用户消息执行 context references 预处理，展开内容注入 messages。
7. **Prompt Caching 实现** — 创建 `prompt_caching_service.go`，实现 `system_and_3` 策略，生成 breakpoint 位置列表。
8. **Prompt Caching 集成** — 在 `provider_service.go` 中，检测 provider 类型为 Anthropic 时，在构建 API 请求体阶段自动调用 caching service 注入 `cache_control` marker，执行 content string -> content block 转换。
9. **TurnTrace 审计** — 将 `PromptAssemblyResult` 中的 hash、injected tokens、cache breakpoints 写入 TurnTrace。

---

## 验收标准

### 6 层组装 + Frozen Snapshot

- [ ] system prompt 包含 identity + guidance + memory + skills index + agent config + timestamp 六个层级
- [ ] 同一 conversation 内多轮 turn 的 system prompt hash 不变（证明冻结生效）
- [ ] skill 数量变化后，新 conversation 的 skills index 自动更新
- [ ] memory 写入后，当前 conversation 的 prompt 不变，新 conversation 会包含新 memory

### Context References

- [ ] `@file:src/main.go` 正确展开为文件内容
- [ ] `@file:src/main.go:10-20` 正确展开为第 10-20 行内容
- [ ] `@folder:src/` 展开为目录树 + 文件摘要
- [ ] `@diff` 展开为 `git diff` 输出
- [ ] `@staged` 展开为 `git diff --staged` 输出
- [ ] `@git:5` 展开为最近 5 条 commit log
- [ ] 注入 token 超过 context window 50% 时，hard limit 拦截并加入 `Blocked` 列表
- [ ] 注入 token 超过 context window 25% 时，soft limit 警告但允许注入
- [ ] `@file:../../.ssh/id_rsa` 被敏感路径规则拦截
- [ ] `@file:../outside-workspace/secret` 被 workspace sandbox 拦截
- [ ] 二进制文件（如 `.png`）被检测并拒绝注入
- [ ] 展开后 `ContextReferenceResult` 各字段正确填充

### Prompt Caching

- [ ] Anthropic provider 请求中包含 4 个 `cache_control` breakpoint
- [ ] system prompt content 从 string 正确转换为 `[{type, text, cache_control}]` block 格式
- [ ] 非 Anthropic provider（如 OpenAI）请求不注入 cache_control，保持原格式
- [ ] system prompt 变更后缓存自动失效（hash 变化 -> 新缓存前缀）
- [ ] TurnTrace 记录实际插入的 breakpoint 数量
