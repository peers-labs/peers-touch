# TW-D7：Profile/Memory、插件 readiness、收口与两条完整 Journey

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "TW-20261102",
  "taskId": "TW-D7",
  "workstreamId": "TW-CLOSURE",
  "title": "Turn 上下文冻结与归因、Memory/插件真实生效、旧路径硬切与两条端到端 Journey",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "tw-j07-two-end-to-end-journeys",
  "closureId": "tw-d7-profile-memory-closure",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop",
    "packages/locales",
    "docs/architecture/domains/agent"
  ],
  "readSet": [
    "docs/architecture/domains/agent/task-workbench",
    "docs/architecture/domains/agent/provider-runtime-strategy.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 3600,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 900
  },
  "checks": [
    {
      "id": "tw-d7-station-tests",
      "command": "cd apps/station && gofmt -l . && go test ./...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "tw-d7-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "tw-d7-desktop-tests",
      "command": "cd apps/desktop && pnpm run test",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "tw-d7-desktop-build",
      "command": "cd apps/desktop && pnpm run build",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "每个 Turn 冻结 Profile 规则、Memory、Skill、capability 版本并可在 TurnAttribution 回看采用项；运行中 Turn 不被新规则静默改写，修改默认影响下一轮",
    "Memory 候选/确认/拒绝/纠错/删除/撤权沿 MemoryService 完成并影响未来 Turn；第二任务验证改写召回，纠错/删除/撤权后旧项停止消费，检索失败显式降级不注入无关记忆",
    "插件安装/绑定/readiness 与真实工具调用打通：installed、enabled、readiness 分别回读，零工具/探测失败不可绑定，撤权/升级使旧 binding 快照失效并阻断新 admission",
    "Dashboard/Station 持有复杂 Provider/runtime 配置；Desktop 只用完整 (provider_id, model_id) 选择、显示 readiness 并提供恢复深链，无第二 registry/CLI 执行",
    "被替换的 store、解析器、空入口、原型专用业务状态与长期兼容桥按 replacement-inventory 成组删除；R01–R07 每项有消费者迁移与同次删除证据，无消费者死代码清除",
    "多对象工作面稳定呈现任务、成果、Terminal、Browser、审批与通知；宽窄布局、焦点恢复与后台提示不抢焦点符合交互合同",
    "两条 exact-source Native Journey（make desktop，普通用户路径）FUNCTIONAL_PASS：研究/文档闭环含第二任务记忆召回；代码/服务/Browser 闭环含失败反馈→修复→复测",
    "TW-O01…TW-O12 按当前源码证据回填；未跑项保持 UNPROVEN"
  ],
  "failureBehavior": [
    "外部 runtime adapter 仅在独立证据门通过后接入，不阻塞 Peers runner 主链；不打包外部 core 作为第二业务 Owner",
    "不恢复 Project CRUD、Atelier 或第二 Agent/Task 一级入口；不删有真实消费者的调度/协作/连接器能力",
    "不用 installed/enabled/disabledPluginIds 代替 capability readiness；不把宿主自有 Memory 作为第二真源",
    "正式 Acceptance Gate、push、PR、生产部署与数据重置不在本切片授权；Journey 未跑保持 UNPROVEN",
    "所有用户可见文案进 packages/locales；禁止 debug 打印、mock 与伪造成功"
  ],
  "updatedAt": "2026-11-02T00:00:00.000Z"
}
```

## 完整闭环

一周末得到可手工使用的桌面持续任务 Agent：每个 Turn 的上下文版本可回看，记忆与插件配置对下一轮真实生效且撤权即阻断，旧路径与假面成组清除；研究/文档与代码/服务/浏览器两条端到端旅程在当前源码跑通后，才允许把结果从 UNPROVEN 回填为 FUNCTIONAL_PASS。
