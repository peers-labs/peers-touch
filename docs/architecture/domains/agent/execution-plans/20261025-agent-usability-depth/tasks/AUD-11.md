# AUD-11：Lark 渠道权威收口

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-11",
  "workstreamId": "AUD-CHANNEL",
  "title": "Lark 配置面映射真实 automation/event-list/delivery 权威，Topics 改读 Station conversation",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j11-lark-authority",
  "closureId": "aud-v12-lark-authority",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/components/settings/channels/ChannelManagementPanels.tsx",
    "apps/desktop/src/components/settings/channels/LarkChannelsSettings.tsx",
    "apps/desktop/src/services/channelActions.ts",
    "apps/desktop/src/store/channel.ts",
    "packages/locales"
  ],
  "readSet": [
    "apps/station/app/subserver/channel/channel.go",
    "apps/station/app/subserver/channel/service/automation.go",
    "apps/station/app/subserver/channel/service/bridge.go",
    "packages/prototypes/desktop/shell/src/LarkChannels.tsx",
    "docs/architecture/domains/agent/agent-usability-depth/design.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3000,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-11-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "aud-11-desktop-tests",
      "command": "cd apps/desktop && pnpm run test -- channel",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-11-lark-functional",
      "command": "cd apps/desktop && pnpm run test -- lark-channels",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Event Triggers 配置读写真实 /channel/automation（event/schedule 两类、绑定 roster Agent、回复方式、enabled），Last run/运行记录从 /channel/event-list 与 delivery retry 真实读取；原型“恒 Never”降级在真实端由权威数据替代",
    "Diagnostics/Stats 只展示 Station 有权威的投递状态/计数（投递状态机 pending/leased/delivered/retry/failed、事件计数）；无权威聚合（成功率百分比等）不出现；空态诚实",
    "Channel Topics 从 Station conversation 真相只读投影（绑定 Agent 的会话/主题列表），不再读原型式本地快照",
    "managed app demo 建连与 provisioning start/poll/confirm、requester authorization 既有链不回退；app secret 只发 Station，任何响应不回显密钥（隐私护栏回归）",
    "配置变更经既有 25 个 channelActions API；失败有类型化错误与 i18n 文案；无假 test message、无假 attribution",
    "Journey：managed 建连→建事件规则→真实/夹具入站消息→绑定 Agent 回复→投递结果与事件记录可读，在 make desktop FUNCTIONAL_PASS（真实 Lark 不可用时夹具路径须由 Station 权威提供，不在前端造假）"
  ],
  "failureBehavior": [
    "不做自定义 cli_id 凭据自助裁决（原型已 reject）；不伪造 Connected/ready",
    "Station 无对应权威的面板（如聚合成功率）直接不做，不以本地统计冒充",
    "不新增第二套渠道配置存储；渠道配置 Station 唯一真相",
    "真实外部 Lark 凭证/网络是外部资源，缺失时用 Station 既有 provisioning demo 与夹具，任务不因此降级为纯 UI"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

Lark 端到端投递链在 Station 已真实存在，本任务只消灭客户端的展示缺口与原型式投影：规则、运行记录、投递状态、Topics 全部来自既有权威，无权威的数字不出现。密钥护栏与 managed 路径不回退。
