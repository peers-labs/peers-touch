# AUD-10：Bot ↔ Agent 绑定与自动回复

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-10",
  "workstreamId": "AUD-CHANNEL",
  "title": "Bot 绑定 Station Agent：publishing 入站消息投影为 Turn，回复以 bot actor 发布",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j10-bot-agent-binding",
  "closureId": "aud-v13-bot-agent-binding",
  "runtimeClass": "service",
  "writeSet": [
    "model/domain/bot/bot.proto",
    "apps/station/app/subserver/bot",
    "apps/station/app/subserver/bot/infrastructure/persistence",
    "apps/station/app/subserver/conversation/production_publishing.go",
    "apps/station/app/subserver/agent/service/channel_turn_executor.go",
    "apps/desktop/src/components/settings/BotsSettings.tsx",
    "apps/desktop/src/services/bot-service.ts",
    "packages/locales"
  ],
  "readSet": [
    "apps/station/app/subserver/channel/service/bridge.go",
    "apps/station/app/subserver/agent/channel_wire.go",
    "docs/architecture/domains/agent/agent-usability-depth/design.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-10-proto-build",
      "command": "./model/build.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-10-station-tests",
      "command": "cd apps/station && go test ./app/subserver/bot/... ./app/subserver/conversation/... ./app/subserver/agent/...",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "aud-10-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "冻结契约：bot.proto 增 BotAgentBinding（bot_id/agent_id/策略/版本字段），bot subserver 新增 bot_agent_bindings 持久表与 CRUD（不新建独立 binding 子系统）；./model/build.sh 通过",
    "带 publishing grant 的入站消息在落 inbox 后由 conversation publishing 入口经内部服务调用查 bot 绑定：已绑定则复用 ChannelTurnExecutor 模式 EnsureConversation→AdmitTurn→ReadOutput，回复以 bot actor 身份经既有发布路径发出；未绑定保持当前纯收件行为",
    "入站去重/限幅/授权复用渠道既有机制，不新建第二套消息网关；失败投递有状态与重试，不伪造回复成功",
    "删除/解绑绑定后立即停止自动回复；历史消息与既有 Turn 归因不被改写（绑定变化不改历史）",
    "BotsSettings 增 Agent 选择器（真实 roster API，与 Cron/Lark 同源），绑定状态持久可回读；bot 状态/秘密轮换/profile 既有功能不回退",
    "Journey：绑定→外部 publishing 消息→真实 Agent 回复以 bot 身份出现在会话→解绑→后续消息不再触发 Turn，make desktop + Station 回读 FUNCTIONAL_PASS"
  ],
  "failureBehavior": [
    "无绑定不回复是默认安全态，不得默认绑定新 bot",
    "bot 入站消息不获得越权工具；能力集来自绑定 Agent 的 capability binding",
    "跨 subserver 调用走既有注入方式（channel_wire 模式），不引入反向依赖或循环 import",
    "联邦滥用面（限幅/去重）若现有机制不足，先补网关再开自动回复，不裸奔上线"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

Bot 当前“能以身份发言但与 Agent 零绑定”。本任务补齐最后一环：入站消息经既有渠道同款 turn 投影成为真实 Agent 任务，回复保持 bot 身份；绑定是唯一开关，默认关闭，历史不可变。
