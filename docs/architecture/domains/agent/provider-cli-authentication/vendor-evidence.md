# CLI 登录证据与适配方式

状态：draft。源码与现场事实绑定
`7c5a0e6a0` / Station `345796aea`、one-slave、slot 6。

源码事实：AIProviderSettings.tsx 无条件显示 API key 输入；AIInstallers.tsx
只有安装和指南。provider.proto 无登录任务合同，四种 CLI catalog 的
api_key_url 均为空。environment.Build 不继承宿主登录，并为账号执行建立私有目录。
因此安装成功不能使当前产品获得完整登录链路。

现场事实：

- Cursor `2026.10.22-27dcf5f`：`cursor-agent login` 支持 NO_OPEN_BROWSER，
  `status --format json` 和 logout。实际启动得到 cursor.com 的登录地址。
  草案采用捕获供应商实际授权 URL，由用户浏览器打开，CLI 保持等待。
- TRAE `0.200.19 internal edition`：login 支持 --sso、--sso-device、--git-code，
  login status 与 logout 可用。实际 --sso-device 得到 sso.bytedance.com/device
  授权地址。草案优先设备授权；不能假设公开发行版也支持这些 flag。
- Codex `0.166.0`：login 支持 --device-auth、--with-api-key、--with-access-token，
  login status 可用。本节点设备授权启动退出 1，没有取得授权 URL；原因尚未
  确定，不能归因为账号设置或网络。草案优先设备授权，必须证明实际可用后才
  声明完整支持；自动回退 localhost 的行为必须截获，不能把死链接交给用户。
- Claude Code `2.1.314`：auth login 支持 --claudeai、--console、--sso，
  auth status --json 可用。实际启动得到 claude.com/cai/oauth/authorize 地址。
  草案承接浏览器授权与供应商要求的回传码输入。

所有启动探测在一次性 HOME 中运行，16 秒内取消，未完成外部账户登录；
授权 query 和设备码未写入报告。入口存在和 OAuth 完成是不同证据。

官方资料：

- [Cursor 鉴权](https://cursor.com/docs/cli/reference/authentication)：
  浏览器登录与 key；精确 key 页面为
  [Cloud Agents / User API Keys](https://cursor.com/dashboard/cloud-agents)。
- [Codex 鉴权](https://developers.openai.com/codex/auth/)：
  远程优先设备码；账号可能要求启用设备授权；设备方式失败可能回退本地回调。
  密钥入口为 [OpenAI API keys](https://platform.openai.com/api-keys)。
- [Claude 鉴权](https://code.claude.com/docs/en/authentication)：
  远程浏览器不能回调时可以返回登录码，需在 CLI 输入；不同配置目录隔离账号，
  部分 Console profile 存储不受 CLAUDE_CONFIG_DIR 隔离，必须独立验证。
  密钥入口为 [Claude Console API keys](https://platform.claude.com/settings/keys)。

适配选择是 proposal：复用供应商自己的登录命令和刷新协议，adapter 处理版本
能力、授权挑战、输入与状态。禁止拿不同供应商的 key 互相试用，禁止通过
管理员主机已有登录文件伪造本资源已连接。
