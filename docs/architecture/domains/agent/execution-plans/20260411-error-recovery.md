# P0: Error Recovery (错误恢复与分类)

## 依赖

- 依赖 System Prompt Assembly（turn loop infrastructure 必须先就位）

## 目标

在 Station agent turn loop 中实现错误分类与恢复机制，使 LLM API 错误能够被自动分类并执行对应恢复策略（retry、compress、rotate credential、fallback）。

## Hermes 参照

- `agent/error_classifier.py` — `classify_api_error()` 函数，`FailoverReason` enum，`ClassifiedError` dataclass
- `agent/credential_pool.py` — `mark_exhausted_and_rotate()` 凭证轮转
- `run_agent.py` — retry loop 根据 `ClassifiedError` hints 决定下一步动作

## 当前状态

- Station `ai_chat` 没有错误分类能力
- API 错误直接导致请求崩溃，无重试、无降级、无凭证轮转

## 交付物

### 1. FailoverReason enum

```go
type FailoverReason int

const (
    FailoverReasonAuth             FailoverReason = iota // 401/403 可轮转
    FailoverReasonAuthPermanent                          // 认证永久失败（invalid key format 等）
    FailoverReasonBilling                                // 402 账户欠费/额度耗尽
    FailoverReasonRateLimit                              // 429 速率限制
    FailoverReasonOverloaded                             // 503 provider 过载
    FailoverReasonServerError                            // 500/502 服务端错误
    FailoverReasonTimeout                                // 请求超时/transport 错误
    FailoverReasonContextOverflow                        // context 超长
    FailoverReasonPayloadTooLarge                        // 413 请求体过大
    FailoverReasonModelNotFound                          // 模型不存在/不可用
    FailoverReasonFormatError                            // 请求格式错误
    FailoverReasonUnknown                                // 未知错误（默认可重试）
)
```

12 个 reason，hermes 中 `thinking_signature` 和 `long_context_tier` 是 Anthropic-specific，映射到对应父类（`format_error` / `context_overflow`）。

### 2. ClassifiedError 领域对象

```go
type ClassifiedError struct {
    Reason                 FailoverReason
    StatusCode             int
    Provider               string
    Model                  string
    Message                string
    Retryable              bool
    ShouldCompress         bool
    ShouldRotateCredential bool
    ShouldFallback         bool
}
```

### 3. `error_classifier_service.go`

核心方法：

```go
ClassifyAPIError(err error, provider string, model string, approxTokens int, contextLength int) *ClassifiedError
```

分类 pipeline（按优先级排序）：

| 优先级 | 阶段 | 说明 |
|---|---|---|
| 1 | HTTP status code + message 精化 | 根据 status code 初步分类，结合 message 做精化（如 402 的 billing vs rate_limit 歧义消解） |
| 2 | Error code 分类 | provider 返回的结构化 error code |
| 3 | Message pattern matching | 按 billing / rate_limit / context_overflow / auth 模式匹配 |
| 4 | Transport / timeout 启发式 | 连接超时、DNS 失败等 transport 层错误 |
| 5 | Server disconnect + large session 推断 | 服务端断连且 session 较大 → 推断为 context_overflow |
| 6 | Fallback | 无法识别 → unknown（标记为 retryable） |

需移植的 pattern 列表：

| Pattern 类别 | 数量 | 典型模式 |
|---|---|---|
| `_BILLING_PATTERNS` | 10 | `insufficient_quota`, `billing hard limit`, `exceeded your current quota` ... |
| `_RATE_LIMIT_PATTERNS` | 11 | `rate limit`, `too many requests`, `throttled`, `capacity` ... |
| `_CONTEXT_OVERFLOW_PATTERNS` | 12 | `maximum context length`, `token limit`, `上下文长度超过限制`（含中文）... |
| `_MODEL_NOT_FOUND_PATTERNS` | 8 | `model not found`, `does not exist`, `model_not_available` ... |
| `_AUTH_PATTERNS` | 9 | `invalid api key`, `authentication failed`, `unauthorized` ... |

402 歧义消解规则：

- 402 + usage limit 且包含 transient signal（如 `daily`, `minute`, `rpm`）→ `rate_limit`，非 `billing`
- 402 + 其他 → `billing`

### 4. Turn loop retry 集成

在 `turn_service.go` 中集成重试循环：

```go
for attempt := 0; attempt < maxRetries; attempt++ {
    resp, err := providerService.Call(ctx, req)
    if err == nil { break }

    classified := errorClassifier.Classify(err, provider, model, tokens, contextLen)

    if classified.ShouldCompress {
        messages = compressionService.Compress(messages)
        continue
    }
    if classified.ShouldRotateCredential {
        credentialPool.MarkExhaustedAndRotate(classified.StatusCode)
        continue
    }
    if classified.ShouldFallback {
        provider = fallbackProvider
        continue
    }
    if classified.Retryable {
        time.Sleep(backoff(attempt))
        continue
    }
    return nil, classified // abort
}
```

恢复策略与 FailoverReason 的映射：

| FailoverReason | Retryable | ShouldCompress | ShouldRotateCredential | ShouldFallback |
|---|---|---|---|---|
| auth | ✓ | | ✓ | |
| auth_permanent | | | | ✓ |
| billing | | | | ✓ |
| rate_limit | ✓ | | ✓ | |
| overloaded | ✓ | | | ✓ |
| server_error | ✓ | | | |
| timeout | ✓ | | | |
| context_overflow | | ✓ | | |
| payload_too_large | | ✓ | | |
| model_not_found | | | | ✓ |
| format_error | | | | |
| unknown | ✓ | | | |

### 5. TurnTrace 扩展

在 TurnTrace 中新增 `error_classified` 字段，记录每次分类事件：

```go
type ErrorClassificationEvent struct {
    Attempt    int
    Reason     FailoverReason
    StatusCode int
    Provider   string
    Model      string
    Action     string // "retry", "compress", "rotate_credential", "fallback", "abort"
    Timestamp  time.Time
}
```

每次 retry loop 中产生 ClassifiedError 时，追加一条 event 到 TurnTrace，用于事后审计和告警。

## 步骤

1. 在 `domain/error.go` 中定义 `FailoverReason` enum 和 `ClassifiedError` 领域对象
2. 实现 `error_classifier_service.go`，包含完整的 priority-ordered 分类 pipeline
3. 从 hermes `error_classifier.py` 移植所有 pattern 列表（billing / rate_limit / context_overflow / model_not_found / auth）
4. 在 `turn_service.go` 中集成 retry loop，根据 ClassifiedError hints 执行恢复策略
5. 扩展 TurnTrace，新增 `error_classified` 字段记录分类事件
6. 为每个 FailoverReason 编写 unit test（构造 mock error → 验证分类结果和恢复动作）

## 验收标准

- [ ] 401/403 → `auth`，触发 credential rotation
- [ ] 402 → 正确消歧为 `billing` 或 `rate_limit`
- [ ] 429 → `rate_limit`，触发 credential rotation
- [ ] 413 → `payload_too_large`，触发 compression
- [ ] 400 + context overflow pattern → `context_overflow`，触发 compression
- [ ] 500/502 → `server_error`，带 backoff 重试
- [ ] Transport timeout → `timeout`，重试
- [ ] Server disconnect + large session → `context_overflow`，触发 compression
- [ ] 所有分类事件记录在 TurnTrace 中，可审计
