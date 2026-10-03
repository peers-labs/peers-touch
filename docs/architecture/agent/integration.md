# Agent 集成

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-02 | **Updated**: 2026-10-03
> **Owner**: Peers-Touch Agent Team

---

## 1. 跨层映射

| Concern | Model | Station | Desktop | Evidence |
|---|---|---|---|---|
| Agent | Agent proto | Agent service/persistence | Agent store/pages | Native receiver + Station readback |
| Conversation | Conversation proto | Conversation authority | Topic/conversation runtime | Stable conversation recovery |
| Turn | Turn/event proto | Turn admission and lifecycle | Stream projection | Terminal state equality |
| Capability | Manifest/binding/MCP Server types | Config, binding and readiness authority | Station/Desktop executor projection | Config/binding/readiness evidence |
| ToolCall | ToolCall/receipt types | Governance, owner dispatch and continuation | Station or Desktop-local executor | Lineage, owner and side-effect count |
| Provider | Provider types | Credential and model execution | Configuration projection | Direct Model response |

## 2. 最小可用 Agent Chat

当前最小发布切面固定为：

```text
Agent 配置与选择
  -> Direct Model
  -> ready per-Server/Tool MCP binding
  -> user message
  -> Station-governed ToolCall
  -> Station-local or Desktop-local MCP execution
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
Conversation、MCP Server、Binding 与 ToolCall 执行 actor 隔离。未受信 device
不得获得 capability session。raw MCP secret 不得进入配置投影、日志或
evidence；secret material 只进入 Server 声明的 execution owner。

## 4. Provider 与 MCP

- Direct Model provider 由 Station 调用并持有执行状态。
- Provider credential 由其正式 owner 管理，页面不保存替代凭证。
- MCP Server CRUD、不可变配置 revision、脱敏投影、tool discovery 版本、
  binding、readiness、ToolCall 和 audit 由 Station 管理。
- `CLIENT_CAPABILITY` MCP 由 Desktop capability manager 探测和调用，并通过
  device-authenticated capability lease 返回 fenced receipt；Desktop 只保留
  本机 secret 与进程投影。
- `STATION` MCP 由 Station MCP runtime 探测和调用，直接复用 Station
  claim/receipt/continuation，不创建 client lease。
- transport 与 owner 正交：stdio/http/sse 均可由对应 owner 执行；路径、
  loopback 与网络可达性相对该 owner 解释。

## 5. 恢复与清理

Native 重启后，客户端从 Station 恢复同一 Agent、Conversation、最终回复、
MCP Server 和能力绑定。Desktop-local Server 重新校验本机 secret/runtime；
Station-local Server 不受 Desktop 重启或离线影响。Acceptance 运行结束必须按
owner 释放 MCP process、port、fixture storage 和 capability session。

## 6. 变更规则

- 共享字段先改 `model/domain/agent/`，再更新生成代码和各层适配。
- 业务状态变化先改 Station owner，再更新 Desktop projection。
- 两种 executor 都必须保留 fencing、幂等与 cleanup；禁止 Station executor
  伪装成 client capability session。
- 旧 `local_mcp` 通用 manifest、Desktop 配置真源和由 transport 推断 owner
  的逻辑必须在同一 cutover 删除。
- 产品能力变化必须同步 Feature、Capability、Domain、Registry、Gate 和 Plan。
- 未运行的平台或能力保持 `UNPROVEN`，不得由相邻 Gate 推断。
