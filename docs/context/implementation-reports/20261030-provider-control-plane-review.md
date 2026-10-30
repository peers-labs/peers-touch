# Provider 控制平面交付前审阅

源码已落地，改动功能的定向检查通过。当前未达到交付完成：
真实 CLI 安装、Dashboard 操作、原生 Desktop 账号切换及共享调用 Journey
仍为 **UNPROVEN**。

## 目标与来源

- 工作树：`worktrees/agent-usability-shared-base-20261027`。
- 分支：`feat/agent-usability-shared-base-20261027`。
- 基准提交：`d946b6aec8a24b286e3d8e4f3119b91ef5b70e93`，任务修改尚未提交。
- 授权范围：Provider 管理与消费边界、CLI 托管安装及隔离、个人默认、
  Federation 管理迁往 Dashboard；只验证改动功能。
- 接受合同：[Provider Control Plane](../../architecture/domains/agent/provider-control-plane.md)、
  [Managed CLI](../../architecture/domains/agent/provider-managed-cli-install.md)、
  [Provider Station Ownership](../../architecture/domains/agent/provider-station-ownership/design.md)。
- 用户指南：[Station AI 管理与使用](../../client/dashboard-ai-management.md)。

## 源码结果

Agent 保持 Provider、模型、凭据、授权和执行决策的业务所有者。
Dashboard 使用独立管理员认证入口，通过管理 Port 调用 Agent 和 Federation。
普通 Actor 的共享资源视图只包含授权模型；个人配置默认禁用，由 Station 策略开启。

共享身份优先于同名个人资源。模型、凭据和发现快照跟随有效资源所有者；
会话、默认选择、工作目录保持请求 Actor 身份。存储 UUID 查询、每次调用及
工具续跑重新校验所有者、模型和授权。凭据变更使 Provider 修订失效；
凭据加密保存，管理读接口不回传密钥。

Station 托管 Node 与适配器安装，按适配器去重，分阶段报告进度，并原子切换
已验证版本。失败升级保留原版本。调用和发现共用显式环境构造器，隔离 HOME、
XDG、工具配置、缓存和临时状态，避免继承 Station 登录态。目录隔离不构成 OS 沙箱。

TRAE CLI、Codex、Cursor 和 Claude Code 均保留管理入口。Codex、Claude 使用
官方 npm 包，Cursor 使用官方安装脚本；TRAE 当前为 `manual_required`，
只有官方手动安装指引，尚无自动安装能力。

未保存的内置服务商可以读取完整配置编辑器，授权投影为空；读取不创建共享资源。
配置保存后才能编辑授权。个人 CLI 检查使用结构化 catalog argv 和托管 PATH；
检查仅证明配置或二进制可用，不能证明上游调用成功。策略更新响应返回已持久化的
修订，连续操作可使用上次响应进行 CAS。

Desktop 默认选择改为 Station 账号所属的 Provider/model 组合。
本地模型注册表及本地 Provider 推理路径已删除；Applet 的一次性调用经 Station。
Federation Settings 管理入口已移除，保留 Chat 查找好友的联邦上下文。

## 审阅范围

重点检查所有者解析、凭据密文、授权替换、执行再准入、CLI 安装与回滚、
管理会话竞争、首次配置、个人默认、Federation 原生 fixture 和旧入口残留。
精确结构审阅覆盖 `service/cli/managed` 的 8 个文件、
`provider_authority.go` 和 `provider_management_service.go`；机器记录只代表这些
路径，不能扩大为整个分支或产品验收通过。

安装模块的两项 import fan-out 信号分别来自归档/下载和 npm/进程边界；
均服务于同一安装所有者，未形成依赖环或重复业务规则。
这些重点审阅路径未留下已确认、未处理的源码阻断问题。

操作约束已进入
[Provider Execution Owner Boundary](../../knowledge/invariants/provider-execution-owner-boundary.md)，
并登记到知识索引。架构合同与用户文档独立。

## 定向验证

以下为源码检查与测试结果，不代替真实产品 Journey。

- **PASS**：Provider 管理、首次配置读模型、CLI 托管路径检查、策略连续 CAS、
  共享调用与撤权、凭据所有者绑定、QuickCompletion 及账号默认回归。
  最新命令：
  `go test ./subserver/agent/service -run 'Test(ProviderManagement|ProviderControlPlane|QuickCompletion|RuntimeDefaultCAS)' -count=1`
  （从 `apps/station/app` 运行）。
- **PASS**：改动 Provider handler 与 Dashboard 管理认证测试；
  `Test(ProviderManagement|ProviderConsumer|CatalogModelToggle)`、
  `TestAIControlPlane`。
- **PASS**：Dashboard `pnpm run check`、9 项会话/表单定向测试及 `pnpm run build`。
  已更新嵌入资源：`index-5yWl6QHA.js`、`index-B0lCsSVq.css`。
- **PASS，前序定向结果**：CLI 子包、Dashboard Auth、Desktop 6 个文件的
  56 项测试及类型检查、Federation 边界回归、原生
  `cargo check --features acceptance-webdriver --locked --offline`。
  本轮未重复未受新增改动影响的检查。
- **PASS**：差异格式、相关知识归属、API 能力注册及受影响 Feature 结构校验。
- **NOT RUN**：全量测试；按用户限定保留定向验证。
- **UNPROVEN**：真实安装进度与重试、宽窄界面、真实账号隔离、
  原生 Applet/默认模型操作及当前源码的共享模型调用和撤权 Journey。

## 剩余验证与部署前提

当前 Profile 的源码同步器只传输 HEAD 提交与 Git tree，
`require_clean=false` 也不会传输未提交修改。用当前 HEAD 部署不能验证本任务修改。
必须先获准创建本地 checkpoint，再经 `make station` 和既有原生启动入口
验证当前源码。尚未启动验证 runtime，尚未提交或发布协作分支。

依据：[pt-local-dev-env](../../../.trae/skills/pt-local-dev-env/SKILL.md) § Source Sync Boundary：
“Remote exact-source verification requires a commit because uncommitted changes
are not deployable.”
实现依据：`tooling/acceptance/core/source_sync.py` 的
`RemoteSourceSynchronizer.preflight()` 返回 HEAD 与该提交的 tree digest。

部署后仅覆盖本任务 Journey：管理员首次配置、授权与撤权、共享调用、
个人策略和账号默认、四个 CLI 入口及支持的安装/失败重试、
HOME/缓存隔离、宽窄布局、Federation 管理与普通用户上下文。

Federation fixture 登录沿用 Dashboard 的单会话策略，会撤销同一管理员的旧会话；
先完成 fixture 准备，再登录 Dashboard 做 UI 验证。缺少供应商凭据的成功调用
必须保留为 UNPROVEN，不能用伪造响应替代。
