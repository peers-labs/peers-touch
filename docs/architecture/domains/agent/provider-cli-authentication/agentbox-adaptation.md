# AgentBox CLI 配置复用与 Station 适配

状态：implementation contract。依据 2026-11-01 用户指定的 AgentBox 截图与本地
`gdpa-agent-box-workspace` 源码。本文记录源码核查与目标实现，不代表真实调用验收。

## 复用的产品结构

截图入口为 `web/src/components/CodingAgentSettingsTab.tsx`。其结构为执行器切换、
执行器内命名 Provider 配置档、默认配置档、模型选择，以及提示词、启动参数和环境变量。
保存与恢复默认属于当前执行器。LLMBox、Custom、System 是配置档的连接来源，
不是 Claude / Codex / Cursor 等执行器本身。

Station Dashboard 采用这两层结构。CLI 选择控件同时承载下载、安装和进度，
不设独立安装列表；配置档选择紧邻其下。配置、模型、授权与试用都属于选中的
配置档。高级参数折叠，普通使用路径优先显示模型来源、连接状态与默认模型。
安装完成后继续配置；已有连接可直接引用，不要求再次录入同一密钥。

Desktop 仅列出当前用户获准使用的配置档和模型，设置个人默认并发起对话。
不持有共享 API key，不复制安装、供应商登录或配置表单。

## 源码核查与适配判断

### 连接凭据与普通设置混存、回读

源码事实：`internal/executor/config.go:194-208` 的 `LaunchProfile` 包含 `api_key`。
`internal/domain/unifiedagent/coding_launch_settings.go` 的 `NormalizePreference`
把完整配置档序列化为 JSON。`internal/service/preferences.go` 的 `Get` 解码并返回
这些偏好；`internal/access/api/handler_preferences.go` 的 `handleGetPreferences`
将其写入 JSON 响应。`internal/store/sqlite/kv.go:131-144` 直接将 value 写入 KV。
前端 `toDraftProfile` 又把 key 放入编辑草稿。

判断：这是单 Box 所有者设置的实现，不能作为共享 Station 凭据合同。
迁移使用既有 Owner 绑定 Secret Envelope；管理接口只返回已配置状态。
新 key 为只写输入；来源引用保存资源身份，不复制凭据到每个 CLI 配置档。

### 本机订阅登录不等于共享账户连接

源码事实：`codingAgentSettings.hints.systemClaudeCode` 与 `systemCodex`
明确要求复用本机 `claude /login` / `codex login`。`BuildProviderEnvWithContext`
对 System 返回空注入；L1 requester 路径另做身份隔离，并拒绝不支持的 Custom/Aiden
凭据协议。因此不能将 AgentBox 整体描述为没有身份防护。

判断：Station 的供应商登录必须仍由资源 Owner 发起。登录、检查、发现、执行使用
同一批准凭据的私有投影，不能恢复宿主 HOME 继承。未验证的登录方式必须明确不可用；
有可用 API 连接时允许直接引用，避免把 OAuth 变成所有 CLI 使用的前置条件。

### 指定配置丢失时静默转到默认

源码事实：`LaunchPreference.ResolveProfile` 未找到非空 profile ID 时返回默认配置。
`externalCLILaunchSettingsCodec.ResolveLaunchConfig` 解码错误时也产生默认配置且
不返回错误。`DefaultClaudeModelID` / `DefaultCodexModelID` 为固定模型名，Custom
来源在未填模型时也可能使用它。

判断：共享场景中这可能改变账号、模型及费用归属。明确指定的配置档或模型失效时
返回不可用，不自动换来源；只有创建新配置、未作任何选择时才呈现建议默认。
历史对话保留其 provider/model 归属。

### 全量偏好保存缺少客户端版本条件

源码事实：设置页保存当前执行器的完整 `profiles` 数组。`handleSetPreferences`
没有 expected revision 输入；底层写事务保证写入原子性，但不拒绝旧页面覆盖新配置。
它还按 preference key 逐项写入，不是整个请求的单一事务。

判断：Station 复用 Provider 的现有 CAS 版本更新。配置档增删与默认指针需保持一致；
发现冲突保留本地草稿，要求重新读取后明确保存。管理员 session 切换废弃旧异步结果。

### 启动参数可成为第二配置入口

源码事实：`sanitizeArgs` 主要清理空值，`sanitizeEnv` 主要清理键值并规范 PATH。
`buildCodexProviderConfigArgs` 读取已有 `-c` 覆盖项后生成配置，部分用户参数可以
先于 UI 配置生效。AgentBox 另有受保护配置键，不能声称它完全没有约束。

判断：Station 保留显式 argv 数组及非敏感环境变量编辑，但 adapter 管理的模型、
认证、HOME 与配置路径不能从高级字段覆盖。界面展示与真正运行必须对应同一配置。
CLI 参数按一行一个 argv 元素编辑，环境变量按 `KEY=VALUE` 编辑；不要求手写 JSON。

### 巨型页面增加状态维护成本

源码事实：设置主组件为 2,898 行，独立管理执行器、配置档、默认值、多个模型缓存、
加载和错误映射；前后端均有归一化规则。

判断：复用交互结构与可独立提取的转换逻辑，不整页搬入其服务、租户和 feature
依赖。Station 页面按执行器选择、配置档选择、配置表单、授权与验证拆分；
后端能力描述为合法字段和连接方式的依据，前端不复制供应商能力矩阵。

## 所有权与数据合同

1. **CLI adapter** 是安装与执行能力，拥有静态 argv、支持的后端协议和登录方式。
   不再通过配置档名称猜测执行器。安装按 adapter 去重，供其所有配置档复用。
2. **CLI Provider 配置档** 复用 `AgentProvider` 的身份、Owner、版本、模型与授权。
   显式 `cli_adapter_id` 绑定 adapter；不同命名配置档是不同 Provider 资源，
   不把配置档拼进 model ID，也不新建平行凭据仓库。
3. **连接来源** 可以是当前配置档受控的供应商账号/API 凭据，或引用同 Owner 的已有
   HTTP Provider。引用只保存资源身份；链式 CLI 引用不允许。每次调用检查配置档、
   来源 Provider、模型与用户授权，任一撤销即拒绝下一次分发。
4. **模型协议** 由 adapter 投影。Codex 使用 Responses 配置；Claude 使用 Anthropic
   环境与模型绑定。不能把 OpenAI Chat Completions 与 Responses 或 Anthropic
   视为自动兼容。目录可见与真实调用成功分别验证，不添加隐式协议转换网关。
5. **默认配置档** 是 Owner + adapter 的版本化管理偏好；不替换 Actor 的个人
   provider/model 默认。只影响新的、尚未明确选定配置的操作。
6. **运行配置** 保存默认模型、全局提示词、argv、非敏感环境与超时。服务端生成
   实际 Provider 环境；密钥不进入普通配置、CLI 参数、前端回读或日志。
7. **持久迁移** 已有 CLI Provider 按其已登记 catalog ID 回填 adapter 身份，
   保留 Provider ID、授权、版本语义及历史对话。既有 Ark 配置与个人默认继续有效。

## 实施与验证范围

优先打通已有模型来源 → CLI 配置档 → 用户授权 → Desktop 真正回复，再补齐各厂商
已被真实探测支持的订阅登录路径。安装、鉴权、协议适配、模型调用和用户授权分别
报告结果；不得以其中一项替代另一项。

源码测试覆盖配置 CAS、失效引用拒绝、凭据只写、实际 argv/env 投影及撤权。
浏览器验证覆盖选择、下拉项进度、配置档增删/默认、草稿保持、失败恢复及窄屏。
最终在当前源码 Station 与真实 Desktop 做调用、撤权、恢复和重启验证。
AgentBox 源码核查没有运行或修改用户 AgentBox 实例。
