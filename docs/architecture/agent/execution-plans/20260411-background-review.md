# P1: Background Review

## 依赖

- **P0: Error Recovery** — review goroutine 内部使用 `error_classifier_service` 分类 LLM 错误并决定重试/中止
- **P0: Credential Pool** — review LLM 调用通过 `credential_pool_service` 获取凭证，与主 turn 共享凭证池
- **Memory 有界存储** — review 需要 memory tool 写入能力
- **Skill 文件系统** — review 需要 `skill_manage` 修补能力
- **Delegation（间接）** — review 需感知 delegation 状态，delegation child agents 不触发 review

## 目标

在 Station 中实现 Background Review 机制 — turn 完成后按计数器触发，由独立 goroutine 发起 LLM 调用审视对话，自主写入 memory 或修补 skill。review 全程不阻塞主响应，所有错误内部消化不冒泡给用户。

## Hermes 参照

- `run_agent.py` — `_spawn_background_review()` fork 独立 AIAgent（`quiet_mode=True, max_iterations=8`）
- `run_agent.py` — `_check_nudge()` 计数器检查，memory 按 user turns、skill 按 tool-calling iterations
- `run_agent.py` — `_review_prompt_memory()`, `_review_prompt_skill()`, `_review_prompt_combined()` 三类 prompt
- 共享 `_memory_store`（直接引用同一对象），daemon thread 执行，stdout/stderr → /dev/null
- review agent 与主 agent 共享 credential pool — 如果主凭证已 exhausted，review 可能使用 rotated 凭证

## 当前状态

- Station 没有任何 review 机制
- 没有后台 goroutine 基础设施
- 没有 nudge 计数器
- 没有 review 级别的错误分类与重试

## 交付物

### 1. NudgeState

```go
type NudgeState struct {
    ConversationID   string
    TurnsSinceMemory int // +1 per user turn，memory review 后归零
    ItersSinceSkill  int // +1 per tool-calling iteration，skill review 后归零
}
```

配置项：

```go
const (
    MemoryNudgeInterval = 10 // 每 10 个 user turns 触发 memory review
    SkillNudgeInterval  = 10 // 每 10 个 tool iterations 触发 skill review
)
```

### 2. `review_service.go`

| Method | 用途 |
|---|---|
| `CheckAndTriggerReview(turnResult)` | turn 结束后检查计数器，决定是否触发；**仅在非 delegation 上下文时触发** |
| `ExecuteMemoryReview(conversationSnapshot)` | 发起 memory review LLM 调用 |
| `ExecuteSkillReview(conversationSnapshot)` | 发起 skill review LLM 调用 |
| `ExecuteCombinedReview(conversationSnapshot)` | 同时 review memory + skill |

依赖注入：

```go
type ReviewService struct {
    credentialPool      *CredentialPoolService
    errorClassifier     *ErrorClassifierService
    providerService     *ProviderService
    memoryStore         *MemoryStore
    skillStore          *SkillStore
    reviewRepo          ReviewRepository
}
```

### 3. Review Prompt（直接从 hermes 提取）

**Memory Review：**

> Review the conversation above. Has the user revealed things about themselves — name, preferences, workflows, environment, facts about their life or work — that are worth remembering?
> Also consider: Has the assistant learned anything important that should be retained across sessions — approaches that worked, mistakes to avoid, project-specific context?
> Use the memory tool to save the important points.

**Skill Review：**

> Review the conversation above. Was a non-trivial approach used that could be generalized into a reusable skill? Look for: multi-step procedures, specific tool configurations, workarounds, debugging techniques.
> If you find something worth saving as a skill, use skill_manage(action='create') to save it.
> If an existing skill was used but had issues, use skill_manage(action='patch') to fix it.

**Combined Review：**

> 合并 Memory Review + Skill Review prompt，在单次 LLM 调用中同时检查两个维度。当 memory 和 skill nudge 同时到达阈值时使用。

### 4. Review 执行模型

```
turn 完成
  → 检查 isDelegationChild — 如果是 delegation child agent，跳过（child 在 quiet_mode 下运行）
  → check nudge counters
  → if triggered:
      1. snapshot current messages（深拷贝，与主 turn 解耦）
      2. 启动后台 goroutine
      3. 通过 credential_pool_service.GetActiveCredential() 获取当前可用凭证
      4. 组装 review request:
         - system prompt = agent identity + review guidance
         - messages = conversation snapshot + review prompt as user message
         - tools = memory tool + skill_manage tool（仅这两个）
         - max_iterations = 8
      5. 调 LLM provider（使用 credential pool 分配的凭证）
      6. 执行 tool calls（memory writes, skill patches）
      7. 记录 ReviewResult
      8. 归零 nudge 计数器
```

### 5. Review 错误处理

Review goroutine 内部独立处理所有 LLM 调用错误，不影响主 turn：

```
review LLM 调用
  → 成功 → 执行 tool calls → 记录 ReviewResult
  → 失败 → error_classifier_service.ClassifyAPIError(err)
      → classified.Retryable == true:
          → 重试一次（仅一次，无 backoff escalation）
          → classified.ShouldRotateCredential == true:
              → credential_pool_service.MarkExhaustedAndRotate()
              → 用新凭证重试
          → 重试仍失败 → logger.Warn → 中止 review，不影响用户
      → classified.Retryable == false:
          → logger.Warn（记录 FailoverReason + status code）
          → 中止 review，不影响用户
```

关键原则：

| 原则 | 说明 |
|---|---|
| **最多重试一次** | Review 是 best-effort，不值得多次重试消耗 quota |
| **继承 Credential Pool** | review goroutine 调用 `credential_pool_service` 获取凭证，如果主 turn 的凭证刚被 exhausted，review 可以使用 rotated 后的新凭证 |
| **错误分类复用** | 直接使用 P0 Error Recovery 的 `error_classifier_service`，不重复实现 |
| **所有错误不冒泡** | review 的任何错误（LLM、tool call、DB write）都通过 logger 记录，永不传播给用户 |

### 6. Review 与 Delegation 交互

| 场景 | 行为 |
|---|---|
| 主 agent turn 完成 | 正常检查 nudge 计数器，触发 review |
| delegation child agent turn 完成 | **不触发 review** — child agent 运行在 `quiet_mode` 下，只执行委派任务 |
| delegation 完成后父 agent 继续 | 父 agent 的后续 turn 正常累计 nudge 计数器 |

实现方式：`CheckAndTriggerReview(turnResult)` 检查 `turnResult.IsDelegationChild`，为 `true` 时直接 return。

### 7. ReviewResult 持久化

```sql
CREATE TABLE agent_reviews (
    review_id       TEXT PRIMARY KEY,
    turn_id         TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    agent_id        TEXT NOT NULL,
    review_type     TEXT NOT NULL CHECK(review_type IN ('memory', 'skill', 'combined')),
    actions_taken   TEXT,     -- JSON array: ["Memory added: xxx", "Skill 'yyy' patched"]
    error_reason    TEXT,     -- NULL if success; FailoverReason string if failed
    retry_attempted BOOLEAN DEFAULT FALSE,
    credential_id   TEXT,     -- 使用的凭证 ID（审计用）
    triggered_at    TIMESTAMP,
    completed_at    TIMESTAMP
);
```

### 8. 不阻塞主响应

- review goroutine 不影响主 turn 的响应返回
- review 成功或失败不影响用户体验
- review 错误记 logger，不冒泡
- review goroutine 使用 `context.WithTimeout`（默认 120s），防止 hang

## 步骤

1. 在 `domain/turn.go` 中添加 `NudgeState` 和 `isDelegationChild` 字段
2. 创建 `review_service.go`，注入 `credential_pool_service` 和 `error_classifier_service`
3. 实现 `CheckAndTriggerReview` — 含 delegation 排除逻辑
4. 实现 `ExecuteMemoryReview` / `ExecuteSkillReview` / `ExecuteCombinedReview` — 含凭证获取 + 错误分类 + 单次重试
5. 创建 `agent_reviews` 表（含 `error_reason`, `retry_attempted`, `credential_id` 字段）
6. 实现 review prompt 常量
7. 在 `turn_service.go` 的 turn 完成后调用 `CheckAndTriggerReview`
8. 在 Desktop Review Panel 展示 ReviewResult（可选 P2）

## 验收标准

- [ ] 连续 10 轮对话后自动触发 memory review
- [ ] review agent 能自主调用 memory tool 保存新发现的用户偏好
- [ ] review agent 能自主调用 `skill_manage` 创建或修补 skill
- [ ] review 不阻塞主对话响应
- [ ] ReviewResult 记录了 review 的 actions
- [ ] 计数器在 review 后正确归零
- [ ] delegation child agent 的 turn 不触发 review
- [ ] review LLM 调用失败时，`error_classifier_service` 正确分类错误
- [ ] retryable 错误重试一次后仍失败 → review 中止，logger.Warn 记录
- [ ] non-retryable 错误 → review 立即中止，logger.Warn 记录
- [ ] review 错误不冒泡给用户（无 error response、无 UI 提示）
- [ ] review goroutine 通过 `credential_pool_service` 获取凭证
- [ ] 主凭证 exhausted 时，review 能使用 rotated 后的新凭证
- [ ] `agent_reviews` 表记录 `error_reason`、`retry_attempted`、`credential_id`
