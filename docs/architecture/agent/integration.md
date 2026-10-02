# Agent 集成

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-02 | **Updated**: 2026-10-02
> **Owner**: Peers-Touch Agent Team

---

## 1. 跨层映射

| Concern | Model | Station | Desktop | Evidence |
|---|---|---|---|---|
| Agent | Agent proto | Agent service/persistence | Agent store/pages | Native receiver + Station readback |
| Conversation | Conversation proto | Conversation authority | Topic/conversation runtime | Stable conversation recovery |
| Turn | Turn/event proto | Turn admission and lifecycle | Stream projection | Terminal state equality |
| Capability | Manifest/binding types | Binding/readiness authority | MCP capability manager | Binding/readiness evidence |
| ToolCall | ToolCall/receipt types | Governance and continuation | Local executor | Lineage and side-effect count |
| Provider | Provider types | Credential and model execution | Configuration projection | Direct Model response |

## 2. 最小可用 Agent Chat

当前最小发布切面固定为：

```text
Agent 配置与选择
  -> Direct Model
  -> ready MCP binding
  -> user message
  -> Station-governed ToolCall
  -> final Assistant message
  -> Native restart recovery
```

正式 Gate 为 `agent-minimum-usable-chat-native-e2e`，必须同时产生：

- Native receiver DOM；
- Station readback；
- cleanup；
- exact-source runtime manifest 与 Station attestation。

该 Gate 不证明 Browser、Mobile、Marketplace、Evaluation、Multi-Agent、
external Agent runtime、TTS、image 或 video。

## 3. 身份与权限

Desktop 在建立能力会话前提供受信 Actor/device identity。Station 对 Agent、
Conversation、Binding 与 ToolCall 执行 actor 隔离。未受信 device 不得获得
capability session，本机 MCP secret 不得进入 Station、日志或 evidence。

## 4. Provider 与 MCP

- Direct Model provider 由 Station 调用并持有执行状态。
- Provider credential 由其正式 owner 管理，页面不保存替代凭证。
- MCP install/test/connect/invoke/cancel/retry/reconnect/uninstall 由 Desktop
  capability manager 执行。
- Station 通过 binding、readiness、ToolCall 和 fenced receipt 管理业务生命周期。

## 5. 恢复与清理

Native 重启后，客户端从 Station 恢复同一 Agent、Conversation、最终回复和
能力绑定。Acceptance 运行结束必须按逆序释放 Native、provider bridge、MCP
process、port、fixture storage 和 capability session。

## 6. 变更规则

- 共享字段先改 `model/domain/agent/`，再更新生成代码和各层适配。
- 业务状态变化先改 Station owner，再更新 Desktop projection。
- 本机 executor 变化必须保留 fencing、幂等与 cleanup。
- 产品能力变化必须同步 Feature、Capability、Domain、Registry、Gate 和 Plan。
- 未运行的平台或能力保持 `UNPROVEN`，不得由相邻 Gate 推断。
