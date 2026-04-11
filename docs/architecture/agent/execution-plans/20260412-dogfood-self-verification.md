# P2: Dogfood — Agent 全产品自验证框架

## 依赖

- **全部 P0/P1 能力已落地** — Turn 执行、Memory、Skill、Compression、Error Recovery、Review、Growth Metrics、Growth Diagnostic 均已实现
- **CredentialPool** — Dogfood 执行场景需要 LLM 凭证完成真实 turn
- **ProviderService** — 场景执行涉及真实 provider 调用

## 背景

Agent 域已实现 12 项核心能力、10,000+ 行代码，通过了 `go build` + `go vet`，但**从未有一个活的 agent 真实执行过完整的 turn 并验证全链路**。

当前验证状态：
- 编译通过 ≠ 运行正确
- 有 REST API ≠ API 能端到端跑通
- Growth Dashboard 有数据模型 ≠ GrowthScore 的变化方向符合预期
- Diagnostic 有归因逻辑 ≠ 归因结果对人有用

## 目标定义

在 `subserver/agent/` 域内新增 **Dogfood 能力** — agent 自己充当用户，端到端使用自身全部能力，自主执行验证场景、判定结果、生成报告。

Dogfood 不是 go test，不是 benchmark，不是 mock。它是 **agent 在真实环境中（真实 DB、真实 LLM、真实 provider）对自身产品能力的自动化端到端验证**。

## 非目标

- 不做性能测试 / 压力测试
- 不做 UI 测试（dogfood 无前端）
- 不替代 go test（确定性单元测试仍由 go test 覆盖）
- 不需要用户触发（可手动触发，也可定时触发）

## Hermes 参照

- Hermes `hermes doctor` — 环境健康检查（连接性、凭证、文件系统）
- Hermes `dogfood` 概念 — 在 hermes 分析文档中被列为"自诊断"能力，但 hermes 本身未真正实现自动化 dogfood
- 我们的目标：**超越 hermes，实现真正的自动化全产品自验证**

## 当前状态

- 没有任何端到端验证机制
- 所有验证依赖人工 curl + 肉眼检查
- 没有"agent 是否健康"的可编程信号

---

## 领域职责

Dogfood 在 agent 域内拆为 **3 个子职责**：

### 1. Scenario（场景）

- **职责**：定义"验什么"和"期望什么"
- **边界**：纯数据描述，不执行任何逻辑
- **内容**：场景名称、步骤序列（Step）、每步的输入参数和断言条件

### 2. Executor（执行器）

- **职责**：驱动场景步骤执行，调用 agent service 层方法
- **边界**：只负责执行，不判定结果。执行结果以 StepResult 返回
- **特点**：直接调用同 package 内的 service（TurnService、MemoryService 等），不走 HTTP

### 3. Judge（判定器）

- **职责**：对比 StepResult 与 Scenario 断言，判定 pass/fail，生成报告
- **边界**：两层判定：
  - **规则判定**（确定性）：GrowthScore 方向、memory count 变化、error 是否被正确拦截
  - **LLM 判定**（智能性）：agent 回答质量是否随 memory 积累提升、摘要是否保留关键信息

---

## 验证场景清单

### Tier 1: 基础链路（必须全部通过才能声称"agent 能跑"）

| 场景 ID | 名称 | 验证内容 |
|---------|------|---------|
| `turn_execution` | Turn 执行链路 | 一次完整 turn 能跑通：prompt assembly → provider call → response → persistence |
| `memory_lifecycle` | Memory 全生命周期 | Add → Replace → Remove → List → BuildSnapshot，验证 CRUD + 去重 + 安全扫描 |
| `skill_lifecycle` | Skill 全生命周期 | Create → Get → List → Patch → Delete，验证 CRUD + Guard 拦截恶意 skill |
| `tool_dispatch` | Tool 调用系统 | LLM 返回 tool_call → ToolRegistry 分发 → 执行 → result 返回 → LLM 继续 |

### Tier 2: 高级能力（验证 agent 的"智能行为"）

| 场景 ID | 名称 | 验证内容 |
|---------|------|---------|
| `compression` | 上下文压缩 | 喂入大量消息直到超过 50% 阈值 → compression 触发 → summary 生成 → session split |
| `error_recovery` | 错误恢复 | 模拟 provider 返回 429/500/402 → ErrorClassifier 正确分类 → 重试/轮换/降级 |
| `background_review` | 后台审查 | 执行足够多的 turn 触发 nudge → review goroutine 启动 → memory/skill 被提取 |
| `delegation` | 子 Agent 委派 | trigger delegate_task tool call → 子 agent 执行 → 结果返回 → 深度守卫生效 |

### Tier 3: 自成长闭环（验证 agent 的"自我进化"能力）

| 场景 ID | 名称 | 验证内容 |
|---------|------|---------|
| `growth_positive` | 正向成长 | 精粮输入 + 正面反馈 → GrowthScore 上升 → verdict = "improving" |
| `growth_negative` | 退化检测 | 噪音输入 + 负面反馈 → GrowthScore 下降 → verdict = "declining" → diagnostic 报告生成 |
| `growth_recovery` | 退化恢复 | 触发 rollback/freeze → 恢复正常输入 → GrowthScore 回升 |

### Tier 4: 安全防护（验证 agent 不会被攻击）

| 场景 ID | 名称 | 验证内容 |
|---------|------|---------|
| `security_injection` | Prompt Injection 防护 | 尝试通过 memory content 注入恶意指令 → 被 scanForPromptInjection 拦截 |
| `security_ssrf` | SSRF 防护 | 尝试 @url 引用内网地址 → 被 validateURLSafety 拦截 |
| `security_skill_guard` | Skill Guard 防护 | 尝试创建含 exfiltration / destructive 代码的 skill → 被 SkillsGuard 拦截 |

---

## 执行生命周期

一次 Dogfood Run 的完整时序：

```
POST /agent/dogfood/run
  │
  ▼
1. DogfoodService.RunSuite(ctx, suiteConfig)
  │
  ├── Create sandbox: 生成隔离的 agent_id + conversation_id
  │   (每次 run 使用独立的沙箱，不影响真实 agent 数据)
  │
  ├── For each Scenario in suite:
  │     │
  │     ├── executor.Execute(ctx, scenario, sandbox)
  │     │     │
  │     │     ├── For each Step in scenario.Steps:
  │     │     │     ├── 根据 step.Action 调用对应 service 方法:
  │     │     │     │   • "execute_turn"    → turnService.ExecuteTurn(...)
  │     │     │     │   • "add_memory"      → memoryService.Add(...)
  │     │     │     │   • "create_skill"    → skillService.CreateSkill(...)
  │     │     │     │   • "record_feedback" → growthMetrics.RecordFeedback(...)
  │     │     │     │   • "get_snapshot"    → growthMetrics.GetGrowthSnapshot(...)
  │     │     │     │   • "rollback_memory" → memoryService.RollbackToSnapshot(...)
  │     │     │     │   • "inject_error"    → (mock provider error for testing)
  │     │     │     │   • ...
  │     │     │     └── Record StepResult { output, duration, error }
  │     │     │
  │     │     └── Return ScenarioExecution { steps: []StepResult }
  │     │
  │     └── judge.Judge(ctx, scenario, execution)
  │           │
  │           ├── Rule-based assertions:
  │           │   • "memory_count >= 3"
  │           │   • "growth_verdict == improving"
  │           │   • "error == nil"
  │           │   • "step[2].output contains 'keyword'"
  │           │
  │           ├── LLM-based quality assessment (optional):
  │           │   • "Is the agent's response better than baseline?"
  │           │   • "Did the summary preserve critical context?"
  │           │
  │           └── Return ScenarioVerdict { pass/fail, assertions, explanation }
  │
  ├── Aggregate: all scenario verdicts → SuiteReport
  │
  ├── Persist: dogfood_reports table
  │
  └── Return SuiteReport
```

---

## 交付物

### 1. 领域对象 — `domain/dogfood.go`

```go
// ScenarioTier classifies scenarios by criticality level.
type ScenarioTier int

const (
    TierBasicChain   ScenarioTier = 1 // Must pass for agent to be considered "functional"
    TierAdvanced     ScenarioTier = 2 // Validates intelligent behavior
    TierSelfGrowth   ScenarioTier = 3 // Validates self-improvement loop
    TierSecurity     ScenarioTier = 4 // Validates defense mechanisms
)

// StepAction defines what a scenario step does.
type StepAction string

const (
    ActionExecuteTurn    StepAction = "execute_turn"
    ActionAddMemory      StepAction = "add_memory"
    ActionRemoveMemory   StepAction = "remove_memory"
    ActionCreateSkill    StepAction = "create_skill"
    ActionRecordFeedback StepAction = "record_feedback"
    ActionGetSnapshot    StepAction = "get_snapshot"
    ActionGetDiagnostic  StepAction = "get_diagnostic"
    ActionRollbackMemory StepAction = "rollback_memory"
    ActionFreezeMemory   StepAction = "freeze_memory"
    ActionToggleSkill    StepAction = "toggle_skill"
    ActionWait           StepAction = "wait"          // pause between steps
    ActionAssert         StepAction = "assert"         // pure assertion, no side effect
)

// ScenarioStep is a single executable step in a scenario.
type ScenarioStep struct {
    Action     StepAction
    Params     map[string]interface{} // action-specific parameters
    Assertions []Assertion            // what to check after this step
}

// Assertion describes an expected outcome.
type Assertion struct {
    Field    string // e.g. "growth_score", "memory_count", "error", "response_contains"
    Operator string // "==", "!=", ">", "<", ">=", "<=", "contains", "not_contains"
    Expected interface{}
}

// Scenario is a complete dogfood test scenario.
type Scenario struct {
    ID          string
    Name        string
    Description string
    Tier        ScenarioTier
    Steps       []ScenarioStep
}

// StepResult captures the outcome of executing a single step.
type StepResult struct {
    StepIndex  int
    Action     StepAction
    Output     map[string]interface{} // action-specific output
    Duration   time.Duration
    Error      error
    Assertions []AssertionResult
}

// AssertionResult is the judgment of a single assertion.
type AssertionResult struct {
    Assertion Assertion
    Actual    interface{}
    Pass      bool
    Message   string
}

// ScenarioVerdict is the final judgment for one scenario.
type ScenarioVerdict struct {
    ScenarioID   string
    ScenarioName string
    Tier         ScenarioTier
    Pass         bool
    StepResults  []StepResult
    Summary      string   // human-readable explanation
    FailedAt     int      // -1 if all passed, otherwise the failing step index
}

// SuiteReport is the aggregate report for one dogfood run.
type SuiteReport struct {
    RunID       string
    AgentID     string // sandbox agent ID
    Verdicts    []ScenarioVerdict
    TotalPass   int
    TotalFail   int
    TotalSkip   int
    PassRate    float64
    Tier1Pass   bool   // all tier-1 scenarios passed?
    StartedAt   time.Time
    CompletedAt time.Time
    Summary     string
}
```

### 2. 场景注册 — `service/dogfood_scenarios.go`

内置场景定义文件。每个场景由 Go 代码声明（不是 JSON/YAML — 因为步骤参数需要类型安全）。

初期提供 **6 个核心场景**（覆盖 4 个 Tier 的关键路径）：

| 场景 | Tier | 步骤数 | 核心验证 |
|------|------|--------|---------|
| `turn_execution` | 1 | 3 | 执行一次 turn，断言 response 非空、turn status == completed |
| `memory_lifecycle` | 1 | 8 | Add×3 → List(==3) → Replace → Remove → List(==2) → BuildSnapshot 非空 |
| `skill_lifecycle` | 1 | 6 | Create → Get → Patch → List(含) → Guard 拦截恶意 → Delete |
| `growth_positive` | 3 | 6 | Turn×3 + Feedback(positive)×3 → Snapshot → score > 0 |
| `growth_negative` | 3 | 8 | Turn×3 + Feedback(negative)×3 → Snapshot → score < 0 → Diagnostic 有 suspected |
| `security_injection` | 4 | 3 | 尝试注入 → 被拦截 → memory 未被污染 |

后续可增量添加更多场景，无需改动框架代码。

### 3. 执行器 — `service/dogfood_executor.go`

```go
type DogfoodExecutor struct {
    turnService     *TurnService
    memoryService   *MemoryService
    skillService    *SkillService
    growthMetrics   *GrowthMetricsService
    diagnosticSvc   *GrowthDiagnosticService
    credentialPool  *CredentialPoolService
}

func (e *DogfoodExecutor) Execute(ctx context.Context, scenario Scenario, sandbox SandboxConfig) (*ScenarioExecution, error)
func (e *DogfoodExecutor) executeStep(ctx context.Context, step ScenarioStep, sandbox SandboxConfig) (*StepResult, error)
```

关键设计：
- **SandboxConfig** 包含隔离的 `agent_id` + `conversation_id` + `provider` + `model`
- 每个 step 的 `Params` 通过 `action → handler` 映射分发到对应 service 方法
- Step 执行是串行的（场景内步骤有依赖关系），场景之间可以并行

### 4. 判定器 — `service/dogfood_judge.go`

```go
type DogfoodJudge struct{}

func (j *DogfoodJudge) Judge(ctx context.Context, scenario Scenario, execution *ScenarioExecution) (*ScenarioVerdict, error)
func (j *DogfoodJudge) evaluateAssertion(assertion Assertion, actual interface{}) AssertionResult
```

关键设计：
- **规则判定**：Field/Operator/Expected 三元组，支持数值比较、字符串包含、nil 检查
- **LLM 判定（Phase 2）**：预留 `Operator == "llm_judge"` 类型，将 actual 和 expected 发给 LLM 做质量判定。初期不实现，标记为 skip
- 每个 assertion 独立判定，任何一个 fail 则整个 scenario fail

### 5. 编排服务 — `service/dogfood_service.go`

```go
type DogfoodService struct {
    executor *DogfoodExecutor
    judge    *DogfoodJudge
}

func (s *DogfoodService) RunSuite(ctx context.Context, config SuiteConfig) (*SuiteReport, error)
func (s *DogfoodService) RunScenario(ctx context.Context, scenarioID string, config SuiteConfig) (*ScenarioVerdict, error)
func (s *DogfoodService) GetLatestReport(ctx context.Context) (*SuiteReport, error)
func (s *DogfoodService) ListReports(ctx context.Context, limit int) ([]SuiteReport, error)
```

SuiteConfig:
```go
type SuiteConfig struct {
    Provider         string   // LLM provider for turns (e.g. "openai")
    Model            string   // model for turns (e.g. "gpt-4o-mini")
    ContextWindowSize int
    Tiers            []int    // which tiers to run (nil = all)
    ScenarioIDs      []string // specific scenarios (nil = all in selected tiers)
}
```

### 6. 持久化 — `infrastructure/persistence/dogfood_report.go`

```go
type DogfoodReport struct {
    ID            string    `gorm:"primaryKey;type:varchar(36)"`
    SandboxAgentID string   `gorm:"type:varchar(36)"`
    TotalScenarios int      `gorm:"not null"`
    TotalPass     int       `gorm:"not null"`
    TotalFail     int       `gorm:"not null"`
    PassRate      float64   `gorm:"not null"`
    Tier1Pass     bool      `gorm:"not null"`
    VerdictJSON   string    `gorm:"type:text"`  // JSON: []ScenarioVerdict
    Summary       string    `gorm:"type:text"`
    CreatedAt     time.Time `gorm:"not null;index"`
    Duration      int       `gorm:"not null"`   // total seconds
}
```

### 7. Handler — `handler/dogfood_handler.go`

| 端点 | 方法 | 用途 |
|------|------|------|
| `/agent/dogfood/run` | POST | 启动一次完整验证（可选 tier/scenario 过滤） |
| `/agent/dogfood/run/scenario` | POST | 启动单个场景验证 |
| `/agent/dogfood/report/latest` | GET | 获取最新报告 |
| `/agent/dogfood/reports` | GET | 列表历史报告 |

### 8. 注册 — `agent.go` 更新

- 新增 `DogfoodService` 实例化
- 新增 `DogfoodHandlers` 注册
- 新增 4 个 REST 路由

---

## 依赖关系与实施顺序

```
Phase 1: domain/dogfood.go
         (Scenario, Step, Assertion, Verdict, Report 领域对象)
              │
Phase 2: service/dogfood_scenarios.go
         (6 个内置场景定义)
              │
Phase 3: service/dogfood_executor.go
         (步骤执行器，调用 service 层)
              │
Phase 4: service/dogfood_judge.go
         (规则判定器)
              │
Phase 5: service/dogfood_service.go
         (编排: 加载场景 → 执行 → 判定 → 报告)
              │
Phase 6: persistence/dogfood_report.go + handler/dogfood_handler.go + agent.go
         (持久化 + REST API + 路由注册)
              │
Phase 7: go build + go vet + 监督验证
```

---

## 验收标准

### 必须通过

1. `go build ./subserver/agent/...` 零错误
2. `go vet ./subserver/agent/...` 零警告
3. 6 个内置场景均有完整的步骤定义和断言
4. POST `/agent/dogfood/run` 能被注册和路由
5. DogfoodService 持有所有必要的 service 依赖

### 功能验证（需要 LLM 凭证 + 真实 provider）

6. `turn_execution` 场景跑通 → turn status == completed
7. `memory_lifecycle` 场景跑通 → memory CRUD 全链路
8. `growth_positive` 场景跑通 → GrowthScore > 0 after positive feedback
9. `security_injection` 场景跑通 → injection 被拦截

---

## 评估体系

### Dogfood 自身的成功指标

| 指标 | 含义 | 目标 |
|------|------|------|
| Tier 1 Pass Rate | 基础链路通过率 | 100% |
| Tier 2 Pass Rate | 高级能力通过率 | ≥ 80% |
| Tier 3 Pass Rate | 自成长验证通过率 | ≥ 80% |
| Tier 4 Pass Rate | 安全防护通过率 | 100% |
| Run Duration | 一次完整 suite 执行时间 | < 5 分钟 |
| Report 可读性 | Summary 对人是否有用 | 人工评估 |

### 反指标（Dogfood 自身的问题信号）

| 反指标 | 说明 |
|--------|------|
| Flaky scenarios | 同一场景多次运行结果不一致 → 场景设计有问题 |
| False positives | 场景 pass 但 agent 实际行为有问题 → 断言太宽松 |
| False negatives | 场景 fail 但 agent 实际行为正确 → 断言太严格或 LLM 不确定性 |

---

## 与 Hermes 对比

| 能力 | Hermes | Peers-Touch Dogfood |
|------|--------|---------------------|
| 环境健康检查 | `hermes doctor` (手动) | Tier 1 场景 (自动) |
| 能力验证 | 无 | Tier 1-4 全覆盖 (自动) |
| 自成长验证 | 无 | Tier 3: 精粮/喂屎/恢复 (自动) |
| 安全验证 | 无 | Tier 4: injection/SSRF/guard (自动) |
| 判定方式 | 人工 | 规则 + LLM 混合 |
| 报告持久化 | 无 | dogfood_reports 表 |
| 可编程触发 | 无 | REST API |

**结论：我们的 Dogfood 在自验证能力上全面超越 Hermes。**
