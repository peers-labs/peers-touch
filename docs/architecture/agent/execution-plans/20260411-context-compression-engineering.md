# P0: Context Compression 工程化

## 依赖

- 依赖 System Prompt Assembly（compression 完成后需重建 system prompt）
- 依赖 Memory 有界存储（flush_memories 需要 memory tool 写入能力）
- 依赖 Error Recovery（context_overflow 错误触发 compression）

## 目标

在 Station 中实现生产级 context compression，包含 structured summary、iterative update、tool output pre-pruning、token-budget tail protection，使长对话不再因 context limit 而中断。

## Hermes 参照

- `agent/context_compressor.py` — `ContextCompressor` 类，完整压缩算法
- `run_agent.py` — `flush_memories()` → `on_pre_compress()` → `compress()` → session split → rebuild prompt

## 当前状态

- Station 没有任何 compression 机制
- 长对话到达 context limit 后直接报错失败
- 没有 summary 生成、没有 tail protection、没有 tool output pruning

## 交付物

### 1. `compression_service.go`（重写，非补丁）

核心常量：

```go
const (
    CompressionThresholdPercent = 0.50
    SummaryRatio                = 0.20
    MinSummaryTokens            = 2000
    SummaryTokensCeiling        = 12000
    ProtectFirstN               = 3
    PrunedToolPlaceholder       = "[Old tool output cleared to save context space]"
    ToolOutputPruneThreshold    = 200 // chars
    SummaryFailureCooldown      = 600 // seconds
)
```

### 2. Tool Output Pre-Pruning（Phase 1 — cheap，无 LLM 调用）

从 messages 末尾向前遍历，按 token budget 保护尾部消息：

- 对于 protection 区域之外的每条 tool-role message：若 content > 200 chars → 替换为 `PrunedToolPlaceholder`
- Token budget 方式：从末尾累加 token，超出 budget 则停止保护
- Hard minimum：至少保护尾部 3 条消息

### 3. Structured Summary Template（Phase 2 — LLM 调用）

首次 compaction 使用以下 template：

```
## Goal
[What the user is trying to accomplish]
## Constraints & Preferences
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Relevant Files
## Next Steps
## Critical Context
## Tools & Patterns
```

### 4. Iterative Summary Update（后续 compaction）

- 在 `compression_service` 状态中保存 `_previous_summary`
- 重新压缩时 prompt：「Update the summary... PRESERVE all existing information... ADD new progress... Move items from In Progress to Done...」
- Previous summary + 新增 turns → 更新后的 summary

### 5. Token-Budget Tail Protection

不使用固定消息数量，而是基于 token budget 动态保护尾部：

- 从末尾向前累加 token：`content / 4 + 10`（每条消息 overhead）+ tool call arguments
- Budget = `summary_target_ratio × threshold_tokens`
- Soft ceiling = `budget × 1.5`（避免在超大消息中间截断）
- Hard minimum：至少保留 3 条消息
- Alignment：永远不在 tool_call / result group 中间截断

### 6. Summary Budget Scaling

```
budget = content_tokens × SUMMARY_RATIO
capped = max(MIN_SUMMARY_TOKENS, min(budget, context_length × 0.05, SUMMARY_TOKENS_CEILING))
```

### 7. Tool-Call / Result Pair Integrity

压缩完成后扫描修复孤立配对：

- 孤立 tool result（call_id 在 assistant messages 中无匹配）→ 移除
- 孤立 tool call（对应 result 被丢弃）→ 插入 stub：`"[Result from earlier conversation — see context summary above]"`

### 8. Compression Flow 集成到 `turn_service.go`

```
if compressionService.ShouldCompress(promptTokens) {
    1. flushMemories(ctx, messages)           // LLM 保存重要上下文到 memory
    2. notifyPreCompress(memoryProvider)       // 外部 provider 挽救数据
    3. messages = compressionService.Compress(messages)
    4. splitSession(conversation)              // 新 session ID
    5. systemPrompt = rebuildSystemPrompt()    // 用最新 memory 重建 system prompt
}
```

### 9. Summary Failure Handling

- Summary LLM 调用失败 → 600 秒 cooldown 后才重试
- Cooldown 期间：丢弃中间 turns，使用 static fallback message
- 绝不注入无用 placeholder

### 10. Summary Message Role Assignment

- 避免 compression 边界处出现连续相同 role 的消息
- 若两端 role 冲突：将 summary 合并到第一条 tail message 中

## 步骤

1. 实现 token estimation 工具函数（`chars / 4 + overhead`）
2. 实现 tool output pre-pruning 函数
3. 实现 structured summary 生成（首次 compaction）
4. 实现 iterative summary 生成（再次 compaction）
5. 实现 token-budget tail protection
6. 实现 tool-call / result pair sanitization
7. 实现 summary budget scaling
8. 集成到 `turn_service.go` 的 compression trigger
9. 将 compression 事件写入 TurnTrace
10. 测试：多轮对话 → 触发 compression → 验证 structured summary
11. 测试：第二次 compression → 验证 iterative summary 保留信息

## 验收标准

- [ ] Compression 在 context window 50% 时触发
- [ ] Tool outputs > 200 chars 在 LLM summary 之前被 pre-pruned
- [ ] Summary 遵循 structured template（Goal / Progress / Decisions / Files / Next Steps）
- [ ] 第二次 compression 对前一次 summary 做 iterative update
- [ ] Tail protection 使用 token budget，非固定消息数量
- [ ] Compression 后无孤立 tool_call / result pair
- [ ] Compression 前执行 `flush_memories()`
- [ ] Compression 后用最新 memory 重建 system prompt
- [ ] Summary 失败 → 600 秒 cooldown → static fallback
- [ ] Compression 事件记录到 TurnTrace
