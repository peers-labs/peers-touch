# P0: Memory 有界存储

## 依赖

- 依赖 **System Prompt Assembly**（memory snapshot 需要注入 system prompt，参见 `20260411-system-prompt-assembly.md`）
- 被 **Context Compression** 依赖（`flush_memories()` 需要 memory tool 写入能力，参见 `20260411-context-compression-engineering.md`）

## 目标

在 Station agent subserver 中实现 Memory 的有界存储、冻结快照、安全扫描、Knowledge Salvage 集成、MemoryProvider 通知机制，使 LLM 能够在运行时自主记忆用户偏好和环境事实，并在 context compression 前通过 `flush_memories()` 抢救即将丢失的高价值上下文。

## Hermes 参照

| 文件 | 关注点 |
|---|---|
| `tools/memory_tool.py` — `MemoryStore` | add / replace / remove 操作，`\n§\n` 分隔存储 |
| `tools/memory_tool.py` — `_scan_memory_content()` | 安全扫描：prompt injection + exfiltration + invisible unicode |
| `tools/memory_tool.py` — `format_for_system_prompt()` | 冻结快照格式 |
| `run_agent.py` — `flush_memories()` | compression 前 Knowledge Salvage |
| `memory/memory_manager.py` — `MemoryProvider.on_memory_write()` | 内置 memory 写入时通知外部 provider |

## 当前状态

- Desktop Tauri `application::memory` 全部返回空响应（stub）
- Station 没有 memory 存储能力
- Desktop MemoryPage 有 UI 但没有真实后端
- 没有 `flush_memories()` 实现 — context compression 无法抢救知识
- 没有安全扫描 — memory 写入不做任何内容检测

## 交付物

### 1. Memory 数据模型

```sql
CREATE TABLE agent_memories (
    memory_id      TEXT PRIMARY KEY,
    agent_id       TEXT NOT NULL,
    target         TEXT NOT NULL CHECK(target IN ('memory', 'user')),
    content        TEXT NOT NULL,
    source_turn_id TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agent_memories_agent_target ON agent_memories(agent_id, target);
```

- `target = 'memory'` — agent 的个人笔记（对应 hermes MEMORY.md）
- `target = 'user'` — agent 对用户的认知（对应 hermes USER.md）
- 条目间用 `\n§\n` 分隔拼接为快照文本（与 hermes 一致）

### 2. `memory_service.go`

| Method | 对应 Hermes | 用途 |
|---|---|---|
| `Add(agentID, target, content, turnID)` | `memory_tool(action='add')` | 新增条目，写入前执行安全扫描 |
| `Replace(agentID, target, oldText, newContent)` | `memory_tool(action='replace')` | 模糊匹配替换条目，写入前执行安全扫描 |
| `Remove(agentID, target, oldText)` | `memory_tool(action='remove')` | 模糊匹配删除条目 |
| `List(agentID, target)` | `memory_tool(action='read')` | 列出该 target 下所有条目 |
| `BuildSnapshot(agentID)` | `format_for_system_prompt()` | 构建冻结快照用于 system prompt 注入 |

每次成功写入（Add / Replace / Remove）后，调用 `on_memory_write` hook 通知外部 MemoryProvider（见交付物 7）。

### 3. 有界约束

```go
const (
    MemoryCharLimit = 2200  // target='memory' 总 char 上限
    UserCharLimit   = 1375  // target='user' 总 char 上限
    EntrySeparator  = "\n§\n"
)
```

- `Add` 时检查：现有条目拼接后的总 char 数 + 新条目 char 数 + separator 是否超限
- 超限则返回错误，附带当前条目列表及已用/剩余 char 数，让 LLM 自行决定 replace 或 remove 哪个
- **不做自动淘汰** — Memory 的治理完全由 LLM 在 char limit 约束下自主完成（与 hermes 一致）

### 4. 冻结快照机制

```go
type MemorySnapshot struct {
    MemoryBlock string // "MEMORY (your personal notes) [xx% — n/2200 chars]\n===\ncontent"
    UserBlock   string // "USER PROFILE (who the user is) [xx% — n/1375 chars]\n===\ncontent"
    Hash        string // SHA-256，用于 TurnTrace 审计
}
```

快照生命周期：

1. `BuildSnapshot` 在 conversation **首轮** 时调用一次，结果缓存在 conversation context 中
2. mid-session 的 memory 写入**更新 DB 但不改变快照** — 保证 prefix cache 稳定
3. context compression 完成后**重新构建快照**（用最新 DB 数据）
4. 新 conversation 自动获得最新快照

### 5. 安全扫描

每次 `Add` 和 `Replace` 时扫描 content，与 Credential Pool 的 skills_guard 保持一致的安全模式体系。

#### 5.1 Prompt Injection 模式

检测试图覆盖 agent 指令的文本：

```go
var promptInjectionPatterns = []string{
    `(?i)ignore\s+(all\s+)?previous\s+instructions`,
    `(?i)ignore\s+(all\s+)?prior\s+instructions`,
    `(?i)disregard\s+(all\s+)?previous`,
    `(?i)forget\s+(all\s+)?previous`,
    `(?i)system\s*prompt\s*override`,
    `(?i)you\s+are\s+now\s+`,
    `(?i)new\s+instructions?\s*:`,
    `(?i)override\s+(system|safety|instructions)`,
    `(?i)pretend\s+you\s+are`,
    `(?i)act\s+as\s+if\s+your\s+instructions`,
    `(?i)from\s+now\s+on\s+you\s+(will|must|should)`,
    `(?i)ignore\s+everything\s+above`,
    `(?i)do\s+not\s+follow\s+any\s+previous`,
}
```

#### 5.2 Exfiltration 模式

检测试图外泄凭证、环境变量、敏感文件的文本：

```go
var exfiltrationPatterns = []string{
    `(?i)curl\b.*\$[A-Z_]+`,                     // curl with env var interpolation
    `(?i)wget\b.*\$[A-Z_]+`,                     // wget with env var interpolation
    `(?i)cat\s+[~.]?/?\.env`,                     // cat .env
    `(?i)cat\s+[~.]?/?\.ssh/`,                    // cat .ssh/*
    `(?i)cat\s+[~.]?/?\.aws/`,                    // cat .aws/*
    `https?://[^\s]*\$\{?[A-Z_]+\}?`,            // URLs with variable interpolation
    `(?i)echo\s+\$[A-Z_]+.*\|\s*(curl|nc|wget)`, // echo $VAR | curl
    `(?i)base64.*\$[A-Z_]+`,                      // base64 encode env vars
    `(?i)printenv|export\s+-p`,                    // dump all env vars
}
```

#### 5.3 Invisible Unicode 字符

与 skills_guard 完全一致的 17 种零宽度 / 方向控制字符：

```go
var invisibleUnicodeChars = []rune{
    '\u200B', // Zero Width Space
    '\u200C', // Zero Width Non-Joiner
    '\u200D', // Zero Width Joiner
    '\u200E', // Left-to-Right Mark
    '\u200F', // Right-to-Left Mark
    '\u202A', // Left-to-Right Embedding
    '\u202B', // Right-to-Left Embedding
    '\u202C', // Pop Directional Formatting
    '\u202D', // Left-to-Right Override
    '\u202E', // Right-to-Left Override
    '\u2060', // Word Joiner
    '\u2061', // Function Application
    '\u2062', // Invisible Times
    '\u2063', // Invisible Separator
    '\u2064', // Invisible Plus
    '\uFEFF', // Zero Width No-Break Space (BOM)
    '\u00AD', // Soft Hyphen
}
```

**扫描命中任何类别 → 拒绝写入，返回错误信息说明拒绝原因和命中类别。**

### 6. Memory 作为 Tool 暴露

在 turn 的 tool definitions 中注册 `memory` tool schema：

```json
{
  "name": "memory",
  "description": "Manage your persistent memory. Use this to remember important information about the user and your working context. Guidelines: (1) Save user preferences, technical environment, project conventions immediately when learned. (2) User profile facts go to target='user'. Your working notes go to target='memory'. (3) Keep entries atomic — one fact per entry. (4) When at capacity, replace least important entries. (5) NEVER store secrets, API keys, passwords, or tokens.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["add", "replace", "remove"],
        "description": "The operation to perform"
      },
      "target": {
        "type": "string",
        "enum": ["memory", "user"],
        "description": "'memory' for your personal notes, 'user' for user profile facts"
      },
      "content": {
        "type": "string",
        "description": "The content to add or the new content for replace"
      },
      "old_text": {
        "type": "string",
        "description": "For replace/remove: text to match against existing entries (fuzzy match)"
      }
    },
    "required": ["action", "target"]
  }
}
```

### 7. MemoryProvider 通知钩子

Memory 写入成功后，通过 `on_memory_write` hook 通知外部 MemoryProvider（如 Honcho、Mem0 等）。这与架构文档 §4.3 Memory Provider Interface 对齐。

```go
type MemoryWriteEvent struct {
    Action  string // "add" | "replace" | "remove"
    Target  string // "memory" | "user"
    Content string // 写入 / 替换后的内容
    OldText string // replace/remove 时的匹配文本
}

// memory_service.go 中每次成功写入后：
if memoryProvider != nil {
    memoryProvider.OnMemoryWrite(event)
}
```

这确保外部 memory backend 能实时镜像内置 memory 的变更。

### 8. Knowledge Salvage — `flush_memories()`

`flush_memories()` 是 **context compression 与 memory 之间的桥梁**。当 context window 即将触发压缩时，在压缩执行之前，给 LLM 最后一次机会把即将丢失的上下文中的高价值信息通过 memory tool 持久化。

```go
func (s *MemoryService) FlushMemories(ctx context.Context, agentID string, messages []Message) error {
    // 1. 构建 flush prompt — 告诉 LLM 即将进行 context compression，
    //    让它审视当前对话，把值得记住的信息用 memory tool 保存
    // 2. 用受限 agent 执行（max_iterations=4，只允许 memory tool）
    // 3. flush agent 共享同一个 memory_service 实例（直接写入 DB）
    // 4. 完成后返回，compression flow 继续
}
```

**Flush Prompt 核心指令：**

```
Context compression is about to occur. The middle portion of this conversation
will be summarized and individual messages will be dropped.

Review the conversation and save any important information that should be
remembered long-term using the memory tool. Focus on:
- User preferences or requirements not yet saved
- Technical decisions or constraints discovered
- Project-specific patterns or conventions
- Any facts that would be costly to re-discover

Do NOT save information that is already in your memory.
Do NOT save transient/procedural details (e.g. "user asked me to fix X").
```

**集成位置（在 `turn_service.go` 的 compression flow 中）：**

```
if compressionService.ShouldCompress(promptTokens) {
    1. memoryService.FlushMemories(ctx, agentID, messages)   // Knowledge Salvage
    2. memoryProvider.OnPreCompress(messages)                  // 外部 provider 抢救
    3. messages = compressionService.Compress(messages)        // 执行压缩
    4. splitSession(conversation)                              // 新 session ID
    5. snapshot = memoryService.BuildSnapshot(agentID)         // 用最新 memory 重建快照
    6. systemPrompt = rebuildSystemPrompt(snapshot)            // 重建 system prompt
}
```

这一设计保证了 compression 不是信息的"黑洞" — LLM 有明确的机制把高价值上下文"搬运"到 memory，使其在压缩后依然可通过 system prompt 中的 memory snapshot 访问。

## 步骤

1. 创建 `agent_memories` 表（migration）
2. 实现安全扫描模块：prompt injection + exfiltration + invisible unicode（与 skills_guard 一致的 17 个 unicode 字符）
3. 实现 `memory_service.go`（Add / Replace / Remove / List / BuildSnapshot，含安全扫描 + 有界约束检查）
4. 实现 `on_memory_write` hook — 写入成功后通知外部 MemoryProvider
5. 在 `prompt_assembly_service.go` 中调用 `BuildSnapshot` 构建 memory block 注入 system prompt
6. 在 turn loop 中注册 memory tool schema
7. 在 tool call handler 中路由 memory tool calls 到 memory_service
8. 实现 `FlushMemories()` — Knowledge Salvage 函数（受限 agent + flush prompt）
9. 在 `turn_service.go` 的 compression flow 中集成 `FlushMemories()` 为第一步
10. 在 Desktop MemoryPage 中接入真实 API

## 验收标准

- [ ] LLM 能在对话中自主调用 memory tool 保存用户偏好
- [ ] memory 条目总 char 数不超过限制（memory ≤ 2200，user ≤ 1375）
- [ ] 超限时返回当前条目列表，LLM 能通过 replace/remove 腾出空间
- [ ] 同一 conversation 内 memory 写入后，system prompt 不变（冻结快照生效）
- [ ] 新 conversation 包含最新 memory snapshot
- [ ] 含 prompt injection 内容的写入被拒绝（覆盖全部 13 个 injection 模式）
- [ ] 含 exfiltration 模式的写入被拒绝（覆盖 curl/wget/cat .env 等 9 个模式）
- [ ] 含 invisible unicode 字符的写入被拒绝（覆盖 skills_guard 一致的 17 个字符）
- [ ] memory 写入成功后 `on_memory_write` hook 被调用
- [ ] `FlushMemories()` 在 compression 前执行，LLM 能通过 memory tool 抢救高价值上下文
- [ ] `FlushMemories()` 使用受限 agent（max_iterations=4，仅 memory tool）
- [ ] compression 后快照用最新 DB 数据重建
- [ ] MemoryPage 能展示真实 memory 条目
