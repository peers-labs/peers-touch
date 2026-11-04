# Provider 真实配置与 CLI 实装验证

Ark 已使用 env 仓库中的真实凭据完成原生客户端 → Station → 供应商调用，
撤销授权后的下一次调用返回 403。Cursor 官方安装完成并经重部署保留。
TRAE、Codex、Claude 和 Cursor 均完成配置读写、安全拒绝与实际二进制检查；
CLI 成功模型输出仍需要各供应商自己的有效凭据或隔离登录。

本轮只验证改动功能，Applet 按用户要求排除。普通用户界面没有新增共享凭据、
安装、运行参数或授权管理入口。这些行为继续由 Station Dashboard 和 Agent
管理端口负责。

## 源码与运行身份

- 工作树：`worktrees/agent-usability-shared-base-20261027`。
- 分支：`feat/agent-usability-shared-base-20261027`。
- 源码范围：`54061d248..345796aea`。
- 最终 Station 与原生构建：
  `345796aead752c6fcb9f06d8efaa2eea5a197578`，工作树摘要 `clean`。
- Profile：`one-slave`；Desktop slot 6；Station：
  `http://10.37.246.80:18280`。
- 当前四种真实二进制：Cursor `2026.10.22-27dcf5f`；
  TRAE `0.200.19 (internal edition)`；Codex `0.166.0`；
  Claude Code `2.1.314`。
- 架构：[Provider Control Plane](../../architecture/domains/agent/provider-control-plane.md)、
  [Managed CLI](../../architecture/domains/agent/provider-managed-cli-install.md)。

## 真实功能观察

Ark 凭据来自 env 仓库的 `corpstable/profile.env.example`。只在进程内读取，
通过管理端口写入临时共享 Provider；管理读取不返回密钥。Alice 在隔离原生
客户端保存该模型为个人默认，调用既有 `agent_quick_completion`，
Station 选择 `ep-20260623145021-n4xdm`，返回 `PROVIDER_CONFIG_OK`。
这是实际供应商输出，不是协议测试服务器。撤权后保持同一 Session 再次调用，
收到 403 和 `provider model access is not granted`。

四种 CLI 均保存并读回默认模型、启动参数、安全环境变量和超时设置。
`HOME`、`PATH`、`CURSOR_API_KEY` 的运行配置覆盖均返回 400。凭据只通过现有
加密凭据端口保存；Cursor、Codex、Claude 的无效测试 key 不出现在管理读取中。
Codex 和 Claude 在没有凭据时不能设为消费默认，实际返回带正文的 400。
写入无效测试凭据后可选择模型，真实调用在 QuickCompletion 的独立期限内返回
504 / `PROVIDER_TIMEOUT`，不能据此声明鉴权成功或模型成功输出。

TRAE `debug models` 返回 8 个可列出的模型，管理发现和原生选择均执行。
模型发现不构成鉴权证明。隔离 HOME 下实际 `exec` 返回
`Please use /login to sign in first`；Station 的实际分发返回
503 / `RUNTIME_UNAVAILABLE`，原因 `cli_execution_failed`。

Cursor 通过 `/dashboard/api/ai/install/start` 执行官方 `cursor.com/install`，
同一任务最终为 `ready`。安装中的阶段进度可读，激活指针和可执行包装器存在；
重部署后仍为 `ready`，实际 `--version` 返回上述版本。
新安装的私有 HOME 中，`--list-models` 和 `--print` 均拒绝缺少鉴权；
无效 `CURSOR_API_KEY` 调用明确返回 `The provided API key is invalid`。
管理模型发现使用无效测试凭据返回 500，未得到可授权模型，因此原生模型
分发没有执行；没有手工添加虚构 Cursor 模型绕过发现。

新 Dashboard 登录会撤销该管理员的旧会话。现场验证旧会话的安装状态请求
返回可读 401，当前会话仍能读取 `ready`；没有通过重试旧 token 掩盖会话边界。

上述原生观察复用现有登录、Tauri 驱动、原生构建与 Linux GUI 所有者，
属于 Development 配置和调用诊断。它不声明 Chat 生命周期或正式 Gate 通过。

## 修复与定向回归

安装所有者按 CR/LF 消费供应商终端进度，使用有限 30 分钟安装期限；
保留 staging 验证和原子激活。真实子进程回归保证进度在安装退出前可读。

Agent 既有 HTTP 错误映射器提供独立 JSON 错误正文，默认选择和
QuickCompletion 保留业务拒绝状态。Dashboard 复用既有私密响应包装器，
在服务器适配前写出鉴权拒绝；底层原因不进入客户端正文。

模型准入、执行和发现接收同一管理二进制目录。准入不再用第二个仅查系统
PATH 的条件过滤已经安装的工具。缺凭据、无授权和二进制消失仍拒绝。

PASS，均从 `apps/station/app` 执行：

- `go test ./subserver/agent/service/cli/... -count=1`。
- `go test ./subserver/agent/service -run 'Test(RuntimeAdmission|CatalogProviderAvailable|ProviderControlPlane|QuickCompletion|ProviderManagement)' -count=1`。
- `go test ./subserver/agent/handler -run 'Test(Provider|CanvasReadinessError|.*PreservesTyped|TypedErrorDetails)' -count=1`。
- `go test ./subserver/dashboard -run 'Test(AIControlPlane|RelayConnectionMaterial|RelayAttachmentRoutes)' -count=1`。

新回归覆盖真实 HTTP 错误正文、内部原因不泄漏、鉴权包装后的实际 401、
空系统 PATH 下管理工具的模型准入、凭据缺失、账号授权隔离和二进制移除。
未运行全量测试。

结构审阅覆盖范围内 12 个源码文件，结果 PASS。8 个文件长度或依赖信号均已
逐项审阅：装配点只注入已有管理目录，准入和错误映射保留各自所有者，
没有新增依赖环或重复业务策略。结构工件：
`code-structure-review/20261031T020724750777Z-7769d7d7efddb37a2aa1abd92c694718`，
摘要 `a71346a1166aa25888d18a8985dc052ef6e20b51fbe8e8d0f70073db19a95679`。

## 资源与诊断工件

所有临时 Agent 已删除。Ark、四种 CLI 的临时 Provider 恢复为 version 0，
凭据状态未配置、授权列表为空；Alice 原始空默认已按精确 reset scope、
观察到的 Provider/model/revision 条件恢复。工作树能力恢复为
`station.connect,station.deploy`。已安装工具保留。

Station PID 1 为 `docker-init`，真实 CLI 调用结束后无运行子进程或僵尸；
受控取消回收 4 个进程，正常父进程退出后回收 2 个进程。
隔离原生客户端与 GUI 已停止，WebDriver 端口 39613 已释放，
无本轮私有进程残留。工件扫描没有找到 Ark 密钥。

Development 工件位于 `.local/dev/cache/`：

- `provider-cli-native-result.json`：原生配置、Ark 输出及真实拒绝。
- `provider-cli-install-result.json`：官方安装任务终态。
- `provider-cli-versions-result.json`：最终部署实际二进制版本。
- `provider-cli-vendor-result.json`、`provider-cli-vendor-extra-result.json`：
  隔离 CLI 原始执行状态与无效 Cursor key 拒绝。
- `provider-cli-admin-session-result.json`：管理员会话拒绝。
- `provider-cli-cleanup-result.json`、`provider-cli-final-audit-result.json`：
  配置恢复、密钥扫描及原生资源释放。
- `provider-control-init-result.json`：最终源码进程回收及持久安装。
- `provider-cli-completion-review.json`：完成范围审阅。
- `provider-cli-acceptance-gaps.json`：正式证明缺口。

## 尚未证明

本轮 env 定义找到 Ark 的有效授权，未找到四种 CLI 各自的有效供应商授权。
TRAE 私有登录、Cursor 有效 key、Codex/Claude 有效 key 下的成功输出仍为
UNPROVEN。安装成功、配置保存成功和失败路径验证不能替代这些成功调用。

正式证明为 UNPROVEN：当前 Acceptance plan 的路径集合不匹配本轮源码范围，
相关 Gate 未执行。完成审阅因此保持 FAIL，不能宣称整个 Provider 工作流已
关闭。Development 配置与 Ark 调用观察是上述精确范围内的功能结果。
