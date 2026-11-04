# Provider 控制平面交付前审阅

实现已提交，定向源码检查、Dashboard 管理操作以及原生 Desktop 的授权展示、
账号默认隔离和撤权功能检查通过。Codex、Claude 的真实托管安装可用。
Station 容器的孤儿进程回收已通过定向运行验证。
供应商成功调用、Applet 成功调用、Cursor 安装及正式 Acceptance 仍未完成证明，
不能据此声明整个任务交付完成。

## 目标与来源

- 工作树：`worktrees/agent-usability-shared-base-20261027`。
- 分支：`feat/agent-usability-shared-base-20261027`。
- 基准提交：`d946b6aec8a24b286e3d8e4f3119b91ef5b70e93`。
- 实现 checkpoint：`f53331497`、`efbfe0264`、`c25558795`、`83789c278`、`a809c1072`。
- Dashboard 和原生 Desktop 功能检查的源码：
  `83789c278dffd6ea9ca86df4bb00dc1e5aef8b82`。
- 容器回收修复的 Station 部署和生命周期检查源码：
  `a809c107222f170b01a1e7a8299a54653ae93a44`。
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

取消逻辑终止 CLI 自有进程组，Go 等待直接子进程。Station Compose 启用标准
Docker init，负责回收取消后被收养的后代进程；不在应用内增加全局 wait/reaper。
持久卷继续承载共享安装和账号私有调用状态。

TRAE CLI、Codex、Cursor 和 Claude Code 均保留管理入口。Codex、Claude 使用
官方 npm 包，Cursor 使用官方安装脚本；TRAE 当前为 `manual_required`，
只有官方手动安装指引，尚无自动安装能力。

未保存的内置服务商可以读取完整配置编辑器，授权投影为空；读取不创建共享资源。
配置保存后才能编辑授权。个人 CLI 检查使用结构化 catalog argv 和托管 PATH；
检查仅证明配置或二进制可用，不能证明上游调用成功。策略更新响应返回已持久化的
修订，连续操作可使用上次响应进行 CAS。

自定义模型必须声明大于 1 的上下文窗口。0 只允许用于继承同名内置模型的有效
目录值；非法创建和更新在持久化前拒绝，部分更新不要求重交上下文。
Dashboard 要求管理员填写模型支持的整数 token 数，不再默认为 0。

Desktop 默认选择改为 Station 账号所属的 Provider/model 组合。
本地模型注册表及本地 Provider 推理路径已删除；Applet 的一次性调用经 Station。
Federation Settings 管理入口已移除，保留 Chat 查找好友的联邦上下文。

## 审阅范围

重点检查所有者解析、凭据密文、授权替换、执行再准入、CLI 安装与回滚、
管理会话竞争、首次配置、个人默认、Federation 原生 fixture 和旧入口残留。
精确结构审阅覆盖 `service/cli/managed` 的 8 个文件、
`provider_authority.go`、`provider_management_service.go`，以及本轮模型配置服务、
回归、编辑器与对应嵌入资源。模型修复的源码绑定结构决策为 PASS，绑定
`c25558795..83789c278`；这些记录不能扩大为整个分支或产品验收通过。

安装模块的两项 import fan-out 信号分别来自归档/下载和 npm/进程边界；
均服务于同一安装所有者，未形成依赖环或重复业务规则。
模型校验在 Agent 配置所有者完成，UI 校验承担输入反馈；运行准入继续拒绝非法
上下文。此次修复未引入平行配置所有者或额外调用入口。

容器修复仅改变 Station 的宿主生命周期配置，进程组、业务权限和激活逻辑保持
既有所有者。结构准备器将 Compose 与 Markdown 标为不支持的文件类型，
没有生成新增源码 PASS；配置职责和运行验证由本次审阅直接核对。

操作约束已进入
[Provider Execution Owner Boundary](../../knowledge/invariants/provider-execution-owner-boundary.md)，
并登记到知识索引。架构合同与用户文档独立。

## 定向验证

源码检查与真实功能观察分别记录。

- **PASS**：Provider 管理、首次配置读模型、CLI 托管路径检查、策略连续 CAS、
  共享调用与撤权、凭据所有者绑定、QuickCompletion 及账号默认回归。
  命令：
  `go test ./subserver/agent/service -run 'Test(ModelConfig|ProviderManagement|ProviderControlPlane|QuickCompletion|RuntimeDefaultCAS)' -count=1`
  （从 `apps/station/app` 运行）。
- **PASS**：自定义模型非法窗口拒绝、拒绝后版本和数据不变、部分更新、
  目录上下文继承；CLI 私有 npm 配置使用不同文件，真实 npm 启动回归通过。
- **PASS**：改动 Provider handler 与 Dashboard 管理认证测试；
  `Test(ProviderManagement|ProviderConsumer|CatalogModelToggle)`、
  `TestAIControlPlane`。
- **PASS**：Dashboard `pnpm run check`、9 项会话/表单定向测试及 `pnpm run build`。
  本轮重跑类型检查与构建；嵌入资源为
  `index-r5DDr4as.js`、`index-B0lCsSVq.css`。
- **PASS，前序定向结果**：CLI 子包、Dashboard Auth、Desktop 6 个文件的
  56 项测试及类型检查、Federation 边界回归、原生
  `cargo check --features acceptance-webdriver --locked --offline`。
  本轮未重复未受新增改动影响的检查。
- **PASS**：差异格式、相关知识归属、API 能力注册及受影响 Feature 结构校验。
- **PASS**：4 项 CLI 进程生命周期回归：
  `TestExecutorCancellationTerminatesProcessGroup`、
  `TestAuxiliaryCommandCancellationTerminatesPipeHoldingChild`、
  `TestExecutorNormalExitTerminatesRemainingProcessGroup`、
  `TestSuperviseProcessStopsGraceWaitWhenProcessCompletes`。
  Compose YAML 及知识归属检查通过。
- **FUNCTIONAL CHECK**：Dashboard 945px 界面保留四个 CLI 管理入口，真实进度
  可见；创建共享 Provider、模型及全部用户/模型授权，并经管理 API 读回。
  个人策略连续开关 CAS 成功，旧修订返回 409。
- **FUNCTIONAL CHECK**：`one-slave` 经 `make station` 部署后健康，版本接口报告
  `83789c278`；原生 Desktop 由既有构建所有者生成相同提交的构建 receipt。
  使用隔离 Linux GUI、D-Bus 和密钥环，复用原生驱动及登录所有者。
- **FUNCTIONAL CHECK**：真实 Alice/Bob 账号依次登录同一原生客户端。
  授权模型在 Settings 可见，没有 Add Provider、密钥输入或 Federation 管理入口。
  Alice 经可见默认按钮保存模型，Bob 保持空默认，切回 Alice 保留其选择。
  限定 Alice 授权后 Bob 不再显示该 Provider，原生读取返回 404；
  清空授权后 Alice 同样被拒绝。
- **FUNCTIONAL CHECK**：管理 API 拒绝自定义模型上下文 0，返回 400。
  Journey 使用显式测试输入 131072；这不是供应商容量或调用成功的证明。
- **FUNCTIONAL CHECK**：共享 Node v24.22.2、Codex 0.166.0、Claude Code 2.1.314
  安装后可用，重部署后仍识别为 ready。TRAE 宿主 PATH 二进制可用，
  自动安装能力仍为 false。
- **FUNCTIONAL CHECK**：`a809c1072` 经同一 `one-slave` Profile 的 `make station`
  重部署，版本接口与 checkpoint 一致，容器 `HostConfig.Init=true`，
  PID 1 为 `docker-init`。旧的 curl/tar/gzip 僵尸随容器重建清除。
  在 OS-held lease 下创建自有进程组，强制取消后 4 个进程消失；
  正常父进程退出后清理进程组，2 个进程消失，检查均无僵尸残留。
  此为受控宿主生命周期检查，没有重新发起耗时的 Cursor 下载。
  Codex 和 Claude 保持 ready；Cursor 无激活指针，重启后状态为 missing。
- **FAILED / UNPROVEN**：Cursor 官方安装重试最终返回
  `context deadline exceeded`，没有激活安装版本。脚本和安装包地址从 Station
  返回 HTTP 200；安装包大小为 184859176 字节，下载未在 8 分钟预算内完成。
  失败状态可经管理接口读取，Cursor 成功安装仍未证明。
- **NOT RUN**：全量测试；按用户限定保留定向验证。
- **UNPROVEN**：供应商成功调用及原生 Applet 完成、真实 CLI 对话中的
  HOME/缓存隔离、Cursor 安装完成、窄屏布局和完整 Federation 管理 UI 流程。
- **UNPROVEN**：正式 Acceptance。Gap detector 未获得 `acceptance-plan`
  的有效 latest pointer；不能把 Development 检查转换成正式 Gate 证据。

## 资源与剩余条件

临时共享 Provider 已删除。Alice 的原始空默认已通过当前 Profile 下、精确限定
测试 Actor 和 Provider 的清理恢复；Bob 的默认未修改。隔离客户端与 GUI 已停止。
清理期间使用非 stable Profile 的精确 reset scope 和 OS-held lease，
结束后恢复原工作树能力绑定。已安装的 Station 托管工具保留供后续使用。
容器生命周期检查仅使用自有 `/tmp` 临时目录和进程组，结束时已清理，
部署与检查 lease 均已释放。

Ark 的 env 真实凭据、原生成功调用及下一次分发撤权检查，以及 Cursor 官方
安装完成和四种 CLI 的实际配置观察，见
[真实配置与 CLI 实装验证](20261031-provider-cli-live-review.md)。
Applet 按用户要求排除。窄屏及完整 Federation 管理流程仍需产品操作检查。
正式证明需由 Acceptance 所有者生成匹配源码范围的有效计划与 Gate 证据，
不手写或改标运行 manifest。

验证结论仅覆盖上述部署源码和操作范围。本地 checkpoint 不表示协作分支已发布；
尚未创建 PR、合并或发布。
