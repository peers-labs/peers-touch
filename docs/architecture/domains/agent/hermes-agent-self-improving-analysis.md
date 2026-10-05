# Hermes-Agent 自成长（Self-Improving）体系架构分析

## 项目定位

Hermes-Agent 是 Nous Research 开发的自我改进型 AI Agent，核心理念：Agent 在使用过程中从经验中学习，将成功的方法论固化为可复用的程序性知识（Skills），并通过 RL 训练闭环持续优化底层模型能力。

***

## 一、自成长体系的七层架构

### 第 1 层：运行时记忆系统（Declarative Memory）

**核心文件**：`tools/memory_tool.py`、`agent/memory_manager.py`

两个持久化文件构成声明式记忆：

- `MEMORY.md`：Agent 的环境知识、工具使用经验、项目惯例
- `USER.md`：用户偏好、沟通风格、工作流习惯

关键设计：

| 设计决策   | 实现方式                                                                                    |
| ------ | --------------------------------------------------------------------------------------- |
| 冻结快照模式 | 会话开始时注入 system prompt 作为只读快照；会话中写入立即持久化到磁盘，但不修改当前 system prompt（保护 prefix cache），下次会话刷新 |
| 有界记忆   | 字符数限制，防止无限膨胀                                                                            |
| 优先级规则  | 用户纠正 > 环境事实 > 过程性知识                                                                     |
| 注入防护   | 写入时扫描 prompt injection、数据渗出、隐形 Unicode 等威胁模式                                            |

Agent 每次发现新的环境事实、API 怪癖、项目约定时，主动写入记忆。下次会话自动载入，避免重复犯同样的错误。

### 第 2 层：程序性知识系统（Procedural Memory — Skills）

**核心文件**：`tools/skill_manager_tool.py`、`tools/skills_hub.py`、`tools/skills_guard.py`

Agent 可以自主创建、编辑、删除技能（SKILL.md + references/templates/scripts/assets），将成功的解决方案提炼为可复用的程序性知识。

与声明式记忆的区分：

| 维度 | 声明式记忆（MEMORY.md） | 程序性知识（Skills）                |
| -- | ---------------- | ---------------------------- |
| 范围 | 宽泛、通用            | 窄而聚焦于特定任务类型                  |
| 性质 | 描述性（what）        | 可执行（how to）                  |
| 来源 | 观察到的事实           | 验证过的方法论                      |
| 存储 | 单个文件             | 目录结构（SKILL.md + 参考/模板/脚本/资源） |

技能存储在 `~/.hermes/skills/` 下，按领域组织。内置约 100+ 技能覆盖 Apple、Creative、Data Science、DevOps、Gaming、GitHub、Media、MLOps、Research 等领域。

技能有完整的信任分级和安全扫描：

```python
INSTALL_POLICY = {
    "builtin":       ("allow",  "allow",   "allow"),
    "trusted":       ("allow",  "allow",   "block"),
    "community":     ("allow",  "block",   "block"),
    "agent-created": ("allow",  "allow",   "ask"),
}
```

Agent 创建的技能需通过多类威胁模式扫描后才允许安装。核心 6 类（exfiltration、injection、destructive、persistence、network、obfuscation）之外，实际代码还扩展了 credential\_exposure、traversal、structural、llm-detected 等类别，总计 10+ 类威胁检测。

### 第 3 层：信任评分记忆（Trust-Scored Factual Memory）

**核心文件**：`plugins/memory/holographic/store.py`

SQLite 事实存储，每个事实携带量化元数据：

| 字段                | 说明                                           |
| ----------------- | -------------------------------------------- |
| `trust_score`     | 信任评分（初始 0.5，范围 \[0.0, 1.0]）                  |
| `retrieval_count` | 检索次数                                         |
| `helpful_count`   | 有用反馈计数                                       |
| `hrr_vector`      | 全息约简表示（Holographic Reduced Representation）向量 |

核心机制 — **不对称信任调整**：

```
正反馈: trust_score += 0.05
负反馈: trust_score -= 0.10    # 惩罚力度是奖励的 2 倍
```

检索时按信任评分降序排列（`ORDER BY trust_score DESC`），支持最小信任阈值过滤。这构成了一个无需显式标注的、基于使用反馈的**知识质量自然选择机制**：错误知识自然衰减直至被忽略，有用知识逐步获得更高权重。

Holographic 是 8 个可插拔记忆后端之一（详见第 3.1 节）。

#### 3.1 可插拔记忆后端生态

`agent/memory_provider.py` 定义了统一的 `MemoryProvider` 接口，`agent/memory_manager.py` 编排内置记忆 + 至多一个外部插件。8 个后端各有不同的质量保障策略：

| 后端              | 部署模式      | 核心质量机制                               | 独特能力                                                            |
| --------------- | --------- | ------------------------------------ | --------------------------------------------------------------- |
| **Holographic** | 本地 SQLite | trust\_score 不对称衰减 + 矛盾检测            | 唯一有显式反馈工具（`fact_feedback`）的后端                                   |
| **Honcho**      | Cloud     | recall\_mode 三态 + cadence 成本控制       | 辩证推理（dialectic）、双向 peer 建模（user + AI）                           |
| **Mem0**        | Cloud     | 熔断器（连续 5 次失败暂停 120s）                 | 服务端自动 LLM 事实提取                                                  |
| **RetainDB**    | Cloud     | SQLite 持久化写后队列（崩溃恢复）                 | memory\_type 分类（plugin.yaml 声明 7 种，工具 schema 暴露 6 种 enum）+ 文件存储 |
| **Supermemory** | Cloud     | trivial message 过滤 + multi-container | 会话级摄取 + entity\_context 自定义提取                                   |
| **Hindsight**   | Cloud/本地  | tags + recall\_budget（27+ 配置项）       | 知识图谱实体解析 + reflect 综合推理                                         |
| **ByteRover**   | 本地 CLI    | on\_pre\_compress 压缩前抢救              | 唯一实现上下文压缩前数据保全的后端                                               |
| **OpenViking**  | 自托管       | L0/L1/L2 分层内容读取                      | 文件系统式知识浏览 + 会话 commit 自动提取 6 类记忆                                |

这个可插拔架构意味着**记忆质量保障策略本身也是可演进的** — 不同场景可以选择不同的后端，而非绑定单一方案。

### 第 4 层：会话持久化与跨会话学习

**核心文件**：`hermes_state.py`、`tools/session_search_tool.py`、`gateway/session.py`

Agent 的每次对话不是用完即弃，而是完整持久化并可跨会话检索：

**存储层**：SQLite + WAL + FTS5 全文索引，存储完整的 sessions 和 messages 表（含 tool\_calls、reasoning、reasoning\_details）。

**跨会话搜索**：`session_search` 工具允许 Agent 搜索所有历史会话，流程为：

1. FTS5 全文检索找到匹配消息
2. 按会话分组，取 Top N 唯一会话
3. 加载会话完整对话，截断并居中于匹配位置
4. 使用辅助 LLM 并行摘要每个会话
5. 返回带元数据的摘要结果

Agent 被指示在用户引用过去对话时（如 "we did this before"、"remember when"、"last time" 等）**主动搜索历史会话**。

**会话恢复**：CLI 的 `--resume` 和 Gateway 的 `/resume` 命令可以切回任意历史会话，完整恢复对话历史。

**压缩分裂链**：长对话触发上下文压缩时，旧会话结束并创建新会话，通过 `parent_session_id` 建立父子链，搜索时自动追溯完整谱系。

### 第 5 层：自主调度系统（Cron — Autonomous Scheduled Tasks）

**核心文件**：`cron/jobs.py`、`cron/scheduler.py`、`tools/cronjob_tools.py`

Agent 可以给"未来的自己"安排任务，实现自主、周期性的学习和监控：

**调度能力**：

| 模式       | 示例                   | 用途     |
| -------- | -------------------- | ------ |
| 一次性延迟    | `"30m"`              | 单次自检   |
| 周期性重复    | `"every 2h"`         | 周期反思   |
| Cron 表达式 | `"0 9 * * *"`        | 每日学习任务 |
| 精确时间     | `"2026-02-03T14:00"` | 定时触发   |

**数据驱动改进**：每个 cron 任务可绑定 pre-run Python 脚本（`script` 参数），脚本采集的最新数据作为上下文注入 prompt。这构成了 `采集数据 → Agent 分析 → 产出改进` 的自动闭环。

**技能加载**：cron 任务可指定加载特定 skills，相当于让 Agent 周期性"复习"特定领域知识。

**智能静默**：Agent 判断"没有新发现"时返回 `[SILENT]` 标记抑制输出投递，只在发现问题时通知用户。

**安全隔离**：

- 每个 cron 任务在独立 session 中运行（`skip_memory=True`，不污染用户记忆表示）
- 禁止递归创建 cron 任务（`disabled_toolsets=["cronjob", "messaging", "clarify"]`）
- prompt 注入检测 + 脚本路径白名单
- 活跃度超时（默认 10 分钟无活动自动终止）
- 宕机恢复时 fast-forward 到下一个未来时间点，不补跑错过的任务

### 第 6 层：RL 训练闭环（Reinforcement Learning Training Loop）

**核心文件**：`environments/hermes_base_env.py`、`environments/web_research_env.py`、`tools/rl_training_tool.py`、`rl_cli.py`

完整的 Atropos RL 训练框架，五步生命周期：

```
setup() → get_next_item() → format_prompt() → compute_reward() → evaluate()
```

奖励函数设计（以 Web Research 环境为例）：

```
reward = correctness_weight × correctness    # 答案正确性（LLM Judge）
       + tool_usage_weight  × tool_used      # 工具使用合理性（二元）
       + efficiency_weight  × efficiency     # 效率（惩罚过多调用）
       + diversity_bonus                      # 信息来源多样性
```

验证基础设施 — `ToolContext`（`environments/tool_context.py`）：奖励函数可以直接调用 Agent 的任意工具来验证结果（运行 pytest、检查文件、浏览器验证等），且工具会话与 Agent rollout 共享同一沙箱环境。

训练数据飞轮：

```
使用 Agent → 生成对话轨迹 → 轨迹压缩 → 训练数据 → RL 训练 → 更好的模型 → 更好的 Agent
```

`batch_runner.py` 支持大规模并行轨迹生成，`trajectory_compressor.py` 将轨迹压缩到目标 token 预算内。成功与失败的轨迹被分别保存（`trajectory_samples.jsonl` / `failed_trajectories.jsonl`），失败轨迹作为负例训练数据，Agent 不仅从成功中学习，也从失败中学习。

### 第 7 层：多模型协作与智能路由（Mixture-of-Agents & Smart Routing）

**核心文件**：`tools/mixture_of_agents_tool.py`、`agent/smart_model_routing.py`、`agent/error_classifier.py`、`agent/credential_pool.py`

| 机制                | 说明                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mixture-of-Agents | 对复杂问题，并行调用多个前沿模型（Claude、Gemini、GPT、DeepSeek），由聚合器批判性综合，聚合器被指示"critically evaluate the information, recognizing that some of it may be biased or incorrect" |
| Smart Routing     | 简单对话自动路由到轻量模型（基于消息长度、关键词、代码标记检测），复杂任务保持强模型                                                                                                                 |
| Error Classifier  | 14 种错误类型的结构化分类，每种对应恢复策略（retry / rotate / failover / compress / abort）                                                                                      |
| Credential Pool   | 多凭证轮换，4 种策略（fill\_first / round\_robin / random / least\_used），耗尽冷却机制                                                                                      |

***

## 二、确认自成长正在发生

| 确认维度      | 机制                                                                    | 核心文件                                  |
| --------- | --------------------------------------------------------------------- | ------------------------------------- |
| 记忆积累      | MEMORY.md / USER.md 文件内容随使用增长                                         | `tools/memory_tool.py`                |
| 技能创建      | `~/.hermes/skills/` 目录下新增 Agent 自创技能                                  | `tools/skill_manager_tool.py`         |
| 信任分数变化    | Holographic store 中 trust\_score 的分布变化                                | `plugins/memory/holographic/store.py` |
| RL 训练指标   | WandB 追踪 `train/mean_reward`、`eval/mean_correctness`、`train/accuracy` | `environments/web_research_env.py`    |
| 使用洞察      | InsightsEngine 生成 token 消耗、工具使用模式、活动趋势报告                              | `agent/insights.py`                   |
| 基准测试      | TerminalBench2、YC Bench、TBLite 的通过率                                   | `environments/benchmarks/`            |
| 会话历史深度    | 跨会话搜索可追溯 Agent 的学习轨迹                                                  | `tools/session_search_tool.py`        |
| Cron 任务执行 | 定时任务的执行记录和产出                                                          | `cron/scheduler.py`                   |

***

## 三、评价自成长是正向的

### 3.1 多维度奖励函数

奖励不是单一指标。以 Web Research 环境为例，Agent 必须同时满足：答案正确、方法合理、效率高、信息来源多样，才能获得高分。效率维度引入分段惩罚：

```python
if tool_call_count <= efficient_max_calls:
    efficiency = 1.0
elif tool_call_count <= heavy_penalty_calls:
    efficiency = 1.0 - (tool_call_count - efficient_max_calls) * 0.08
else:
    efficiency = max(0.0, 1.0 - (tool_call_count - efficient_max_calls) * 0.12)
```

### 3.2 LLM Judge 评审

`_llm_judge()` 使用独立的 LLM 评估 Agent 答案与 ground truth 的匹配度，避免自我评分偏见。

### 3.3 持留集评估（Held-out Evaluation）

训练过程中定期在独立评估集上运行完整 Agent loop，追踪 `eval/mean_correctness`、`eval/mean_reward` 等指标，确保训练不过拟合。

### 3.4 工具错误追踪

```python
wandb_metrics["train/tool_errors_count"] = len(self._tool_error_buffer)
```

不仅追踪奖励，还追踪工具调用错误，确保"能力增长"不伴随"可靠性下降"。

### 3.5 不对称信任衰减

Holographic 记忆的 -0.10 vs +0.05 不对称设计：

- 错误知识被标记 2 次"无用"后，信任从 0.5 降到 0.3，快速边缘化
- 正确知识需要 10 次"有用"才能从 0.5 升到 1.0
- **悲观主义策略**：对错误的容忍远低于对正确的奖励，系统宁可"谨慎不用"也不会"积极犯错"

### 3.6 自诊断系统

`hermes_cli/doctor.py` 通过 `hermes doctor` 命令执行 10+ 类运行环境健康检查：

| 检查类别            | 内容                                                      |
| --------------- | ------------------------------------------------------- |
| Python 环境       | 版本（3.10+）、虚拟环境                                          |
| 依赖包             | 必须/可选包完整性                                               |
| 配置文件            | `.env`、`config.yaml` 版本迁移、废弃 key 检测                     |
| 目录结构            | `~/.hermes/` 及子目录、SOUL.md、MEMORY.md、SQLite WAL 大小       |
| API 连通性         | 13 个提供商的实时健康检查（OpenRouter、Anthropic + 11 个 API key 提供商） |
| 外部工具            | git、ripgrep、Docker、SSH、Node.js、npm audit                |
| 工具可用性           | 所有 toolset 的功能可用性                                       |
| Skills Hub      | Hub 目录、lock.json 完整性、隔离区                                |
| Memory Provider | 活跃 provider 连接验证                                        |

支持 `--fix` 自动修复（创建缺失目录/文件、迁移配置、SQLite WAL checkpoint）。这确保 Agent 的自成长基础设施本身处于健康状态。

### 3.7 Dogfood 自测

`skills/dogfood/` 技能让 Agent 自己对 Web 应用做系统化的探索性 QA 测试：

1. Plan — 创建输出目录，识别测试范围
2. Explore — 浏览器工具集系统交互
3. Collect Evidence — 截图、复现步骤、控制台错误
4. Categorize — 严重度分级（Critical / High / Medium / Low）+ 6 类问题分类
5. Report — 结构化 QA 报告

Agent 可以用来测试自身的 Web UI，形成**自我测试闭环**。

***

## 四、回收"变蠢"的 Agent

### 4.1 Checkpoint 文件系统回滚

`tools/checkpoint_manager.py` 基于 shadow git repo 实现透明快照：

- Agent 每次文件修改前自动创建 checkpoint
- 用户可通过 `/rollback <N>` 恢复到任意历史状态
- 回滚前创建快照（支持"undo the undo"）
- 支持全目录回滚和单文件精确恢复

### 4.2 人工监督闭环（Human-in-the-Loop）

`tools/approval.py` 和 `tools/clarify_tool.py` 构成人工监督层：

**工具审批**：`approval.py` 通过 `DANGEROUS_PATTERNS`（30+ 正则表达式）对 shell/terminal 命令内容做危险模式检测，匹配到的命令需要人工确认或被完全阻断。

**主动澄清**：`clarify_tool` 让 Agent 在不确定时主动向用户提问，而非猜测执行。

**三级审批模式**：`manual`（所有命令需审批，默认）/ `smart`（仅危险模式命令需审批）/ `off`（全部自动）。

这确保 Agent 自成长过程中的关键操作始终在人工可控范围内。

### 4.3 记忆与上下文注入防护

`tools/memory_tool.py` 和 `agent/prompt_builder.py` 都内置注入检测。`prompt_builder.py` 有 10 种威胁模式 + 10 种不可见 Unicode 字符；`memory_tool.py` 扩展至 13 种威胁模式（增加了 role\_hijack、exfil\_wget、ssh\_backdoor、ssh\_access、hermes\_env 等）+ 同样的 10 种不可见 Unicode 字符：

- prompt injection 模式（"ignore previous instructions"、"you are now" 等）
- 数据渗出模式（curl/wget + 环境变量）
- 隐形 HTML 注入（hidden div、display:none）
- 被拦截的内容以详细的阻断原因替代（如 `[BLOCKED: {filename} contained potential prompt injection (...)]`），不进入 system prompt

### 4.4 错误分类与自动恢复

`agent/error_classifier.py` 定义了 14 种错误类型的结构化分类：

| 错误类型              | 恢复策略              |
| ----------------- | ----------------- |
| auth              | 刷新/轮换凭证           |
| billing           | 立即轮换              |
| rate\_limit       | 退避后轮换             |
| context\_overflow | 压缩上下文，不做 failover |
| model\_not\_found | 切换到不同模型           |
| server\_error     | 重试                |
| timeout           | 重建客户端 + 重试        |

### 4.5 上下文压缩

`agent/context_compressor.py` 在长对话导致上下文膨胀时自动压缩：

1. 裁剪旧工具结果（无 LLM 调用）
2. 保护头部消息（system prompt + 第一轮交互）
3. 保护尾部消息（最近约 20K tokens）
4. 用结构化 LLM 摘要替代中间轮次
5. 后续压缩迭代更新之前的摘要

防止 Agent 因上下文窗口溢出而丢失关键信息导致能力退化。

### 4.6 子 Agent 隔离

`tools/delegate_tool.py` 确保单个子 Agent 的退化不向上传播：

- 独立上下文（不继承父对话历史）
- 受限工具集（禁止递归委托、禁止记忆写入、禁止跨平台发送）
- 最大深度限制为 2（禁止无限嵌套）
- 最大并发 3 个子 Agent

***

## 五、训练层面的抗退化机制

### 5.1 工具集分布采样

`toolset_distributions.py` 在训练数据生成时随机采样不同工具组合，确保 Agent 不会过度依赖特定工具组合而在其他组合下退化。

### 5.2 预算与资源约束

`tools/budget_config.py` 定义了三层预算系统：

| 层级    | 限制             | 默认值        |
| ----- | -------------- | ---------- |
| 单结果大小 | 单个工具结果的字符上限    | 100K chars |
| 单轮总预算 | 单轮所有工具结果的字符总上限 | 200K chars |
| 预览大小  | 持久化后的内联摘要大小    | 1.5K chars |

按工具精细化阈值解析：pinned > tool\_overrides > registry > default。防止 Agent 因资源消耗失控而表面工作实际空转。

### 5.3 模型可替换性

`environments/tool_call_parsers/` 包含 11 种模型的专用工具调用解析器（DeepSeek、GLM、Kimi K2、LLaMA、Mistral、Qwen 等）。RL 训练闭环不绑定单一模型，上层积累的记忆和技能在模型切换时完全保留。

### 5.4 红队自检

`skills/red-teaming/godmode/` 包含自动化红队测试，使用评分函数检测拒绝响应、套话、元评论等问题，在安全性与有用性之间做量化平衡。

***

## 六、外部知识注入渠道

`agent/prompt_builder.py` 在每次会话启动时扫描并注入外部上下文文件，构成 Agent 自成长的外部知识来源：

**加载优先级**（只取第一个匹配项）：

```
1. .hermes.md / HERMES.md  （向上遍历到 git root）
2. AGENTS.md / agents.md   （仅 cwd）
3. CLAUDE.md / claude.md   （仅 cwd）
4. .cursorrules / .cursor/rules/*.mdc  （仅 cwd）
```

`SOUL.md`（`~/.hermes/SOUL.md`）始终独立加载，定义 Agent 的人格和行为准则。

每个上下文文件上限 20,000 字符（70% 头部 + 20% 尾部截断），注入前经过完整的安全扫描。

这意味着用户可以通过项目级的 `.hermes.md` 或 `AGENTS.md` 向 Agent 注入项目特定的知识和约定，Agent 在该项目上下文中工作时自动获得这些知识。

***

## 七、方法论总结

| 维度     | 设计理念                                              |
| ------ | ------------------------------------------------- |
| 自成长单元  | 四层：记忆（声明式）、技能（程序式）、会话历史（情景式）、模型权重（RL）             |
| 自主演进   | Cron 系统让 Agent 给"未来的自己"安排学习任务，数据驱动的周期改进           |
| 确认自成长  | WandB 指标追踪、基准测试通过率、InsightsEngine 使用分析、会话历史追溯     |
| 评价正向性  | 多信号奖励函数、LLM Judge、持留集评估、不对称信任衰减、自诊断、Dogfood 自测    |
| 回收变蠢   | Checkpoint 回滚、人工审批闭环、安全扫描、错误分类恢复、上下文压缩、子 Agent 隔离 |
| 防止退化   | 工具集分布采样、预算约束、失败轨迹学习、红队自检                          |
| 模型可替换性 | 11 种模型解析器 + Credential Pool + Smart Routing       |
| 记忆可插拔性 | 8 个后端各有不同质量保障策略，记忆架构本身可演进                         |
| 安全护栏   | 三层注入检测（记忆 / 上下文 / 技能）+ 技能信任分级 + 工具审批 + Cron 隔离    |
| 外部知识   | AGENTS.md / SOUL.md / .hermes.md 项目级知识注入          |

核心指导理念：

> **Learn aggressively, forget cautiously, verify continuously, fail safely.**

- **积极学习**：每次成功交互都可能产出技能或记忆，Cron 系统实现自主周期学习
- **谨慎遗忘**：不对称惩罚确保错误知识快速衰减，正确知识需反复验证才能提升权重
- **持续验证**：RL 训练有 evaluate()、基准测试有 benchmark、运行时有 InsightsEngine、环境有 doctor、应用有 dogfood
- **安全失败**：Checkpoint 回滚、人工审批、错误分类恢复、子 Agent 隔离确保单点失败不会级联扩散

***

## 八、工程实现细节

以下是对前述各层的工程级细节补充，供 peers-touch 适配时参考。

### 8.1 Error Classifier 分类管线

hermes 通过优先级排序的 7 步管线将异构 provider 错误统一为 `ClassifiedError`：

1. **Provider-specific patterns** — 各 provider SDK 的特定错误类型（如 Anthropic 的 `overloaded_error`、OpenAI 的 `insufficient_quota`）
2. **HTTP status code** — 按状态码直接映射（401→auth, 402→billing, 429→rate_limit, 413→payload_too_large, 404→model_not_found, 529→overloaded）
3. **Error code** — provider 返回的 error code 字段（如 `context_length_exceeded`）
4. **Message pattern** — 正则匹配错误消息文本（如 `"rate limit"`, `"overloaded"`, `"billing"`, `"quota"`）
5. **Server disconnect + large session** — 连接中断且当前 session 较大时，推断为 context_overflow
6. **Transport heuristics** — 网络层错误（connection reset, DNS failure 等）归为 timeout 或 server_error
7. **Fallback unknown** — 以上均不匹配时归为 unknown

`ClassifiedError` 结构体包含 4 个恢复提示：`retryable`、`should_compress`、`should_rotate_credential`、`should_fallback`，由 turn loop 消费。

### 8.2 System Prompt 8 层组装

hermes 的 system prompt 组装按固定顺序叠加：

| Layer | Content | Source |
|---|---|---|
| 1. Identity | Agent 身份定义 | SOUL.md 或默认文本 |
| 2. Behavioral Guidance | Memory/Skill/Session 使用规则 | 硬编码常量，按 tool 可用性条件注入 |
| 3. Memory Snapshot | 冻结的 MEMORY.md + USER.md | session 开始时捕获，mid-session 不变 |
| 4. External Memory Block | 外部 MemoryProvider 的 system_prompt_block() | 初始化时生成 |
| 5. Skills Index | 所有 skill 的 name + description 索引 | 实时构建，两层缓存（LRU + disk snapshot） |
| 6. Context Files | .hermes.md / AGENTS.md / CLAUDE.md / .cursorrules | 按优先级发现，first-match-wins |
| 7. Timestamp + Model Info | 会话开始时间、模型名、provider | 运行时生成 |
| 8. Platform Hints | WhatsApp/Telegram/CLI 等平台提示 | 按 platform 键值匹配 |

关键设计：Memory Snapshot 在 session 开始时冻结，mid-session 的 memory 写入不改变 system prompt（保护 prefix cache）。Skills 只放索引，LLM 通过 `skill_view()` tool call 按需加载全文。

### 8.3 Context Compression 9 步流程

当 context window 接近阈值时触发：

1. **Knowledge Salvage** — `flush_memories()`：让 LLM 把即将丢失的上下文中值得记住的内容写入 memory
2. **Provider Notify** — `on_pre_compress()`：通知外部 memory provider 抢救知识
3. **Tool Output Pre-Pruning**：无 LLM 调用。超过 200 字符的 tool result 替换为 placeholder
4. **Structured Summary**：LLM 生成含 Goal/Progress/Decisions/Files/NextSteps 的结构化摘要
5. **Iterative Summary**：`_previous_summary` 在多次压缩间保留，增量更新
6. **Token-Budget Tail Protection**：从末尾向前累加 token 直到超过 budget（`summary_target_ratio × threshold_tokens`），最少保留 3 条
7. **Summary Budget Scaling**：`clamp(0.20 × threshold_tokens, 2000, 12000)`
8. **Tool-call/Result Pair Integrity**：移除孤立 result，为孤立 call 插入 stub result
9. **Session Split → Rebuild System Prompt**：创建新 session，重新加载最新 memory

### 8.4 Delegation 工程细节

| 约束 | 值 |
|---|---|
| `DELEGATE_BLOCKED_TOOLS` | delegate_task, clarify, memory, send_message, execute_code |
| `MAX_CONCURRENT_CHILDREN` | 3 |
| `MAX_DEPTH` | 2 |

Toolset 交集规则：子 Agent 的可用工具 = 父 Agent 的 toolset ∩ 子 Agent 请求的 toolset − DELEGATE_BLOCKED_TOOLS。

执行模式：Single task（同步等待）和 Batch mode（ThreadPoolExecutor 并行）。子 Agent 默认继承父 Agent 的 credentials，完成后触发 `on_delegation(task, result)` 回调。

### 8.5 Credential Pool 工程细节

4 种轮换策略：`fill_first`（按 priority 用完再切）、`round_robin`、`random`、`least_used`。

Exhausted Cooldown：凭证因 429/402 被标记为 exhausted 后进入 1 小时冷却期。冷却期间不参与选择，结束后自动恢复。

并发子 Agent 的 Lease 机制：`acquire_lease(provider)` 获取独占使用权，`release_lease(credential_id)` 释放。lease 未释放的凭证不参与选择。

Auto-seeding 顺序：环境变量 → Auth store → 配置文件。

### 8.6 Prompt Caching（Anthropic）

策略 `system_and_3`：插入 4 个 `cache_control` breakpoint — system prompt 末尾 + 倒数 3 条消息各 1 个。命中缓存时 input token 成本降低约 75%（Anthropic 按 0.25x 计费）。Cache TTL 默认 5 分钟（ephemeral），system prompt 变更时自动失效。

### 8.7 Context References

hermes 支持 user message 中引用外部上下文：`@file:path`、`@folder:path`、`@url:https://...`、`@diff`、`@staged`。加载时自动屏蔽敏感路径（.ssh, .aws, .gnupg 等）。Token budget 管理：50% hard limit 必须压缩，25% soft limit 建议压缩。

### 8.8 Memory Provider 生命周期钩子

| Hook | 时机 | 用途 |
|---|---|---|
| `initialize(session_id)` | agent 启动 | 建立连接 |
| `system_prompt_block()` | 组装 system prompt | 返回静态文本 |
| `prefetch(query)` | 每次 LLM 调用前 | 检索相关上下文 |
| `queue_prefetch(query)` | 每轮结束后 | 预热检索 |
| `sync_turn(user, assistant)` | 每轮结束后 | 持久化本轮 |
| `on_pre_compress(messages)` | 压缩前 | 抢救知识 |
| `on_session_end(messages)` | session 结束 | 终态提取 |
| `on_memory_write(action, target, content)` | memory 写入时 | 镜像到外部 |
| `on_delegation(task, result)` | subagent 完成 | 观察委派结果 |
| `shutdown()` | agent 退出 | 清理连接 |

约束：内置 memory（MEMORY.md/USER.md）永远在线，外部 provider 最多一个。

