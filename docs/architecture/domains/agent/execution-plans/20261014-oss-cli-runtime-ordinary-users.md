# Provider 重设计：以开源 CLI Agent 为底座，普通用户视角

> Status: **SUPERSEDED**（2026-10-18）
> 历史提案，仅保留产品研究背景。当前权威合同见
> `../provider-runtime-strategy.md` 与 `../modules/provider-model/peers-design.md`；
> CLI 检查、发现、执行和目录均由 Station 持有，Desktop 不执行本地 Provider 子进程。
> 取代/收敛方向：`../provider-runtime-strategy.md`（2026-07-29，开发者视角的 direct/cli 双通道）中面向普通用户的部分；其 CLI 子进程管道与 actor 隔离实现保留复用。
> Benchmark：基准客户端（参考工作区 `reference-client-workspace`），源码取证于本文第 3 节。

## 1. 决策背景（Owner 2026-10-14）

- 自研模型接入/执行层成本高、出活慢；**底层依赖 codex 等开源 CLI agent**，我们做产品层（Agent、会话、编排、渠道、凭据托管）。
- Provider 重新设计，**以基准客户端的 runtime 模型为准**。
- 去掉「较高级的使用方式」：普通用户不接触 provider、API key、executor、effort、fallback 这些概念。

## 2. 目标与非目标

**目标**

1. 装好 Peers 就能用：运行时（CLI agent）的安装、登录、就绪由 Station 引导和托管，用户不需要命令行知识。
2. 用户只感知「用哪个 Agent」「回答质量档位」，不感知 executor/provider/key。
3. 多 CLI agent（codex、claude code、traex 等）作为**可插拔执行器**在产品内统一呈现、统一状态、统一错误语言。
4. 高级配置存在，但收进开发者层，不污染普通界面。

**非目标（v1）**

- 不自研模型推理、不自建 LLM 网关的全部能力（托管 key 通道可分阶段）。
- 不做 CLI 二进制的版本市场/沙箱容器化（沿用现有「整机共享一份已装 CLI」约束）。
- 普通界面不暴露多 provider 账号切换、temperature、自定义 base_url。

## 3. 基准客户端事实（源码取证，作为重设计基准）

| 事实 | 证据 |
|---|---|
| 执行器（executor）是一组开源 CLI agent：`CODEX`、`CLAUDE_CODE`、`TRAEX`、`CURSOR_CLI`、`OPENCODE` | `web/src/components/agent/useDialogueRuntimeModelDiscovery.ts` L66-197（executor 规范化/映射）、`web/src/utils/codingExecutorCapabilities.ts` L1-28 |
| 每个 executor 有能力矩阵：plan mode / goal mode / 图片附件 / 文件附件按执行器门控 | `codingExecutorCapabilities.ts` L1-52 |
| 运行时有引导状态机 `checking → pending → running → ready`，未就绪阻塞发送并显示进度（8/24/64/100%） | `web/src/hooks/useRuntimeBootstrapGate.ts` L23-64；启动引导执行器集合 = CLAUDE_CODE/CODEX/TRAEX |
| 安装/登录有独立模态：CliInstallGuideModal、CliLoginModal；错误信封可判定「需要安装 / 需要登录」 | `web/src/components/CliInstallGuideModal.tsx`、`CliLoginModal.tsx`、`utils/cliInstallGuide.ts`（`cliInstallGuideFromError`/`cliLoginRequiredFromError`） |
| 运行时配置三层：**Executor / Model / Thinking effort / Fallback**；模型从属于执行器（`getRuntimeModels` 发现） | `RuntimeConfigSelector.tsx`、`dialogueRuntimeModelSelection.ts`、`services/codingApi.ts getRuntimeModels` |
| 持久化两级：Agent Profile 存默认；会话内 composer 的 runtime pill 可覆盖当前 session（`setDialogueSessionRuntimeConfig`） | `components/ChatInput.tsx` L6709-6778；`pages/AgentProfilePage.tsx`；`services/dialogueRuntimeApi.ts` |
| 部分执行器走「provider profile」托管凭据（LLMBox 配额在侧栏可见），其余使用 CLI 自身登录态 | `useDialogueRuntimeModelDiscovery.ts` L82-166（`dialogueCodingExecutorUsesProviderProfiles`/`SupportsLLMBoxProvider`） |
| 普通界面只呈现「终端图标 + 模型名 + effort(High) + ⌄」，Executor/Fallback 在点开后的层级里 | live 截图 + `ChatInput.tsx` 运行时弹层 |

## 4. Peers 目标模型

### 4.1 概念分层（用户语言 vs 系统语言）

| 用户可见（普通界面） | 系统概念（开发者层） |
|---|---|
| Agent（名字、头像首字母、描述、扩展） | Agent 配置（SOUL/AGENTS、绑定 runtime、扩展开关） |
| 运行时状态：`准备中 / 需要登录 / 正在安装 / 就绪` | BootstrapTask 状态机 + 健康检查 |
| 质量档位：`自动（默认）/ 更强（Reasoning）` | executor 默认 model + reasoning/effort 映射 |
| （高级/开发者模式）执行器、模型、Fallback、provider 凭据 | executor registry、model catalog、credential pool |

### 4.2 执行器注册表（新增，Station 侧）

一个声明式注册表，替代散落在 UI 里的 provider 概念：

```yaml
executors:
  - id: codex
    kind: cli
    label: Codex                 # 仅高级界面显示
    bootstrap:
      install_check: "codex --version"
      install_task: cli_install_codex      # 引导任务（可复用现有 bootstrap）
      login_check: ...
    capabilities: [plan_mode, file_attachment, image_attachment]
    default_model: <发现结果的第一项>
    models_command: ...
  - id: claude-code
    kind: cli
    ...
```

- 发现：启动与按需 `discover()`（复用 `provider-runtime-strategy.md` §3.2 CLIStrategy：本地子进程 + 输出归一）。
- 能力矩阵直接决定 UI：不支持图片附件的执行器，composer 回形针禁用并给出人话原因，而不是发了再失败。
- 默认只启用/引导一个执行器（codex 优先），其余「已安装则自动出现」，不让用户做选择题。

### 4.3 Bootstrap 状态机（新增，普通用户的核心体验）

对齐基准客户端四态，并定义用户看到的语言与动作：

| 状态 | 用户看到 | 唯一主动作 |
|---|---|---|
| `checking` | 「正在检查运行环境…」+ 进度 | 无（发送禁用） |
| `not-installed` | 「首次使用需要安装 Codex 运行环境，约 X 分钟」 | **一键安装**（Station 执行，进度条；失败给复制命令的兜底，不暴露裸日志） |
| `needs-login` | 「登录后即可使用」 | **登录**（弹 CliLogin 流程；托管 key 通道可用时显示「使用 Peers 托管登录」主按钮） |
| `installing/running` | 进度 8/24/64/100% | 取消 |
| `ready` | runtime pill 正常 | 发送 |
| `error` | 人话术 +「重试」+「查看帮助」 | 重试/帮助（不出现 `Failed to fetch`、退出码堆栈） |

发送门控：非 ready 状态禁止发送（对齐 `runtimeBootstrapBlocksSend`），错误在 composer 上方就地呈现，复用现有原型 E1-E5 错误卡合同。

### 4.4 配置归属

- **Agent 级默认**（Agent Profile → Runtime，简化版）：默认只露「回答质量：自动/更强」；executor/model/fallback 折叠进「高级（开发者）」。
- **会话级覆盖**：composer runtime pill 改的是当前 session（与基准客户端一致）；新会话回到 Agent 默认。
- **凭据**：优先 CLI 自身登录态；需要 key 的执行器走 Station 凭据池（沿用 `agent_credential_pool` 与 actor 隔离），未来提供「Peers 托管凭据」通道；普通用户界面永远不出现 key 输入框（首次通过引导流完成）。

### 4.5 与现有 `provider-runtime-strategy.md` 的关系

| 现有设计 | 处置 |
|---|---|
| DirectStrategy（ark/openai/anthropic… 直连 + 用户填 key） | **降级为开发者/高级层**，普通设置移除；保留代码供高级模式与 Station 托管通道复用 |
| CLIStrategy（actor workspace、env 注入、输出归一） | **保留，作为执行器底座**；`cli_command/models_command` 改由执行器注册表驱动 |
| `agent_providers / agent_models / agent_credential_pool` 表 | 保留；新增 executor 维度的 bootstrap 状态缓存（不新建多余表，能复用则复用） |
| 设置页 ProviderDetail（加模型、toggle、base_url） | 普通版下线，入口移至「开发者设置」；普通用户改走引导流 |

## 5. 分阶段落地建议

1. **P0 执行器注册 + codex 单执行器就绪链路**：注册表、discover、install/login 引导四态、发送门控；先只支持 codex。
2. **P0 普通界面瘦身**：Profile Runtime 只留质量档位；composer pill 文案改为「自动/更强（由 <模型> 驱动，高级可见模型名）」；错误卡接入 bootstrap 态。
3. **P1 多执行器自动发现 + 能力门控**：claude-code/traex 等已装即用；附件/plan 能力按矩阵启用。
4. **P1 会话级覆盖与 Agent 默认持久化**（两级配置合同）。
5. **P2 托管凭据通道（LLMBox 式 provider profile）**：免登录开箱即用的配额体验。
6. **P2 高级模式**：执行器/模型/fallback/直连 provider 收敛到开发者设置。

## 6. 对原型的影响（待本设计确认后再改原型）

- composer runtime pill：默认文案从「Default/Reasoning」调整为「自动/更强」的用户语言，模型名作为弱化副标题；点弹层仍可演示三态但执行器选择标注「高级」。
- 新增 bootstrap 五态演示（可用既有 `?review=1` 评审条模式注入 not-installed/needs-login/installing/ready），验证发送门控与人话错误。
- Agent Profile 的 Runtime 区：质量档位 + 「高级」折叠区（执行器/模型），不新增假能力。
- 上述原型变更在 Owner 确认本提案前不动手。
