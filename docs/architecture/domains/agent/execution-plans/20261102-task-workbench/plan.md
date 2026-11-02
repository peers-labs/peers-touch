# 持续任务工作台（D1–D7）实施计划

> **Plan ID**: TW-20261102
> **Version ID**: task-workbench-20261102-v1
> **Created**: 2026-11-02T00:00:00.000Z
> **Owner**: Peers-Touch Agent Team

本计划只冻结实施模型，不表示实现已完成，也不授权 push、PR、发布、远程部署、数据重置或历史改写。允许本地 checkpoint commit。Owner 已于 2026-11-02 确认产品与架构源（`docs/architecture/domains/agent/task-workbench/`）并批准 D1–D7 全量范围、DAG 与“每日一个纵向闭包”节奏；未逐条裁决的实施细节采用架构源推荐默认值，Plan review 在实施前修正，实施中变更须新版本。

## 目标与完成口径

完成后必须同时成立：

1. 一个任务就是一条连续工作线：TaskRun 1 ↔ 0..1 canonical Conversation 1 → N Turn；首次发送原子建链，追问、补资料、改稿、复测都是同任务新 Turn；重复发送与断线恢复不产生第二个 Turn 或重复执行（TW-D1/D2）。
2. 输入接收、排队、执行、终态是不同事实；Stop 以 Station 回读的真实终态为准，活动轮输入只在不可逆请求发出前 amendment，否则进入下一轮队列（TW-D2）。
3. 业务工作面只由 durable TaskEvent / Turn terminal event 经 watermark replay 后订阅 live 重建；流式 delta/progress 不持久化为业务终态（TW-D1）。
4. 资料、成果、反馈、检查与接受围绕不可变 Artifact 版本闭环；reader、Search、通知、消息卡片、导出引用同一 artifact/version；代码块/消息文本提取不再是成果真源（TW-D3）。
5. 授权工作根内的真实文件读写、有界一次性命令与基于真实字节的 Diff 有租约、围栏回执、退出码与幂等恢复；exit 0 不等于业务完成（TW-D4）。
6. 持久 TerminalSession 由 Rust worker 持有进程，UI 标签只是 viewer/subscriber；关闭标签不杀进程，worker 重启后未证明存活一律 unknown/dead（TW-D5）。
7. BrowserSession 按设备 attachment 绑定 task/turn/device/account/control lease 与显式 tab、按代失效的 snapshot ref；人工接管暂停 Agent，归还后重新观察；超时/断连先 inspect 再决定是否重试（TW-D6）。
8. 每个 Turn 冻结 Profile/Skill/Memory/capability 版本；记忆候选确认后才消费，纠错/删除/撤权停止旧消费；插件 installed/enabled/readiness 分别回读，真实调用才 ready；复杂 Provider 配置只在 Dashboard/Station（TW-D7）。
9. 每个切片都是 proto → Station → Rust → Desktop 投影 → 旧路径删除的纵向闭包，当日构建可运行，未完成能力 fail-closed，禁止以原型模拟、mock 或 UI 状态冒充（TW-D1–D7）。
10. 周末两条 exact-source Native Journey（研究/文档；代码/服务/Browser）在 `make desktop` 当前源码达到 FUNCTIONAL_PASS；未跑保持 UNPROVEN（TW-D7）。

人类可读执行前后差异见 [outcome-comparison.md](./outcome-comparison.md)，计划区进入 planVersionDigest，实际结果区初始全部 UNPROVEN，仅按 current-source evidence 回填。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "TW-20261102",
  "versionId": "task-workbench-20261102-v1",
  "createdAt": "2026-11-02T00:00:00.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/domains/agent/task-workbench/README.md",
      "docs/architecture/domains/agent/task-workbench/product-definition.md",
      "docs/architecture/domains/agent/task-workbench/experience-contract.md",
      "docs/architecture/domains/agent/task-workbench/product-state-model.md",
      "docs/architecture/domains/agent/task-workbench/design.md",
      "docs/architecture/domains/agent/task-workbench/data-model.md",
      "docs/architecture/domains/agent/task-workbench/integration.md",
      "docs/architecture/domains/agent/task-workbench/module-layout.md",
      "docs/architecture/domains/agent/task-workbench/decisions.md",
      "docs/architecture/domains/agent/task-workbench/acceptance-matrix.md",
      "docs/architecture/domains/agent/task-workbench/replacement-inventory.md",
      "docs/architecture/domains/agent/task-workbench/workspace-experience-proposal.md",
      "docs/architecture/domains/agent/provider-runtime-strategy.md",
      "docs/architecture/domains/agent/modern-chat-agent/decisions.md"
    ],
    "decisions": [
      "MCA-D22",
      "MCA-D23",
      "TW-D01",
      "TW-D02",
      "TW-D03",
      "TW-D04",
      "TW-D05",
      "TW-D06",
      "TW-D07",
      "TW-D08",
      "TW-D09",
      "TW-D10"
    ]
  },
  "scope": {
    "sourceClaims": [
      { "pathPrefix": "model/domain/agent", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station/app/subserver/agent", "mode": "exclusive-write" },
      { "pathPrefix": "apps/desktop", "mode": "exclusive-write" },
      { "pathPrefix": "packages/locales", "mode": "exclusive-write" },
      { "pathPrefix": "docs/architecture/domains/agent", "mode": "exclusive-write" },
      { "pathPrefix": "model", "mode": "shared-read" },
      { "pathPrefix": "apps/station", "mode": "shared-read" },
      { "pathPrefix": "packages", "mode": "shared-read" },
      { "pathPrefix": "docs", "mode": "shared-read" },
      { "pathPrefix": "tooling", "mode": "shared-read" }
    ],
    "nonGoals": [
      "Computer Use 与系统级自动化（C07 保持 deferred）",
      "多 Agent 自动编排、team/canvas 协作扩展（C16 保持 deferred）",
      "外部双向 runtime（Codex app-server 等）在证据门通过前接入 Peers 执行主链",
      "跨 app/系统重启持久 PTY daemon；worker 重启后的进程保活证明",
      "Mobile 对等交付（仅保持共享合同兼容）",
      "云端或远程设备执行 Browser/Terminal；跨端获得本机操作权",
      "Evaluation Lab 扩展、商业市场、社区共享与一键安装他人 Agent",
      "Workflow templates 与 Plugins/Hooks CRUD",
      "Knowledge 持久向量化升级、Memory consolidation 与 Git 自动摄取",
      "生产部署、生产数据迁移/重置、push、Pull Request 与历史改写"
    ]
  },
  "tasks": [
    { "id": "TW-D1", "workstreamId": "TW-CHAIN", "path": "tasks/TW-D1.md", "dependsOn": [] },
    { "id": "TW-D2", "workstreamId": "TW-INBOX", "path": "tasks/TW-D2.md", "dependsOn": ["TW-D1"] },
    { "id": "TW-D3", "workstreamId": "TW-ARTIFACT", "path": "tasks/TW-D3.md", "dependsOn": ["TW-D1"] },
    { "id": "TW-D4", "workstreamId": "TW-DEVICE", "path": "tasks/TW-D4.md", "dependsOn": ["TW-D3"] },
    { "id": "TW-D5", "workstreamId": "TW-DEVICE", "path": "tasks/TW-D5.md", "dependsOn": ["TW-D4"] },
    { "id": "TW-D6", "workstreamId": "TW-DEVICE", "path": "tasks/TW-D6.md", "dependsOn": ["TW-D5"] },
    { "id": "TW-D7", "workstreamId": "TW-CLOSURE", "path": "tasks/TW-D7.md", "dependsOn": ["TW-D2", "TW-D3", "TW-D4", "TW-D5", "TW-D6"] }
  ],
  "outcomeComparison": { "path": "outcome-comparison.md" },
  "authorization": {
    "checkpoint": { "localCommit": "allowed", "amend": "allowed" },
    "delivery": { "push": "denied", "pullRequest": "denied" },
    "runtime": { "deployProfiles": [], "destructiveResetScopes": [] },
    "history": { "rewrite": "denied" }
  }
}
```

## 切片模型（7 个纵向闭包）

1. **TW-D1 任务、Turn 与事件主链。** canonical 任务/会话合同 proto-first 显式化；首次发送幂等建链；durable 事件 + watermark replay/live 边界；Desktop 移除 optimistic 终态路径；Workbench 接真实任务状态。
2. **TW-D2 输入队列、审批、草稿与后台介入。** delivery 回执（started/amended/queued/rejected）、持久队列项完整 payload 与 capability snapshot、任务级草稿、审批/AskUser 绑定 attempt/tool-call/revision 与过期语义。
3. **TW-D3 资料、Artifact 版本、反馈、检查与接受。** 逻辑 artifact 不可变版本序列；资料采用与 ContextLedger 归因；人工编辑乐观并发；检查与接受分别建模；所有消费者切换后删除消息文本提取真源。
4. **TW-D4 真实文件、一次性命令与 Diff。** 复用 CapabilityOperation/lease/receipt/resource grant；审查扩展 filesystem/shell 合同；before/after hash 与 Diff 绑定 artifact/version；失败重试先 inspect。
5. **TW-D5 TerminalSession 长进程。** 设备 TerminalSession 资源合同；Rust worker 持 PTY（create/attach/write/resize/kill/remove、cursor 回放）；标签只是 subscriber；未知状态诚实化。
6. **TW-D6 BrowserSession、页面观察、操作与人工接管。** session/tab/lease/snapshot-generation 合同；受控 browser host 经能力 worker 接入；untrusted page data；接管/归还重新观察；HTML 预览不等于 Browser Use。
7. **TW-D7 Profile/Memory、插件 readiness、收口与两条 Journey。** Turn 上下文冻结与归因；Memory 候选/纠错/删除/撤权；插件真实调用 readiness；被替换 store/解析器/空入口原子删除；两条端到端 Journey FUNCTIONAL_PASS。

## Hard Cut 与回滚

- 每个被替换面原子切换：消息正文/代码块提取在 TW-D3 消费者全部切换后同切片删除；一次性 shell 冒充持久终端、模拟浏览器/终端面板、原型 fixture/localStorage 业务状态在对应切片删除；不留 flag、双写或兼容分支；回滚 = VCS revert cut commit。
- 中断的非幂等 LLM turn 沿用既有合同：不重放，步边界标 interrupted/failed，用户重发产生新 step/turn。
- 每个 Task 开始前从当前源码生成消费者/旧 owner inventory 与精确 changed-file allowlist；目录级 claim 只是上限。`desktop_api.ts`、`packages/locales`、Rust 命令注册与 TS side-effect import 是追加式集成面，只做本任务块内追加/替换，禁止跨任务重排他人段落。
- 所有副作用走既有 capability authority/lease/fencing/receipt；写与命令逐次审批；CLIENT 离线时能力广告降级但不阻断普通对话。
- 所有用户可见文案进 `packages/locales`；禁止 debug 打印、mock API、伪造遥测与成功；归因与证据面不暴露原始 prompt、凭据、本机绝对路径或调试 trace。

## Acceptance Execution

本期为 DEVELOPMENT_ITERATION 收口：各 Task 以聚焦源码检查与 `make desktop` 当前源码 Journey 的 FUNCTIONAL_CHECK 证明；正式业务 Acceptance Gate 与 Station/双端 Suite 由后续 Acceptance 计划注入。未运行 Gate 保持 UNPROVEN，不自动回填。

```json
{
  "closures": {
    "tw-d1-task-turn-event-chain": [],
    "tw-d2-inbox-intervention": [],
    "tw-d3-artifact-version-loop": [],
    "tw-d4-files-commands-diff": [],
    "tw-d5-terminal-session": [],
    "tw-d6-browser-session": [],
    "tw-d7-profile-memory-closure": []
  },
  "completion": [],
  "full": []
}
```

## 审批边界

Owner 2026-11-02 批准产品/架构源、D1–D7 全量与本 DAG，并批准从最新 `origin/master` 的干净 worktree 进入 TW-D1 实施；该批准不授权 push、PR、发布、远程部署、数据重置或历史改写，也不把开发 Journey 扩大为 Station 联邦、Mobile 或正式 Acceptance 已验证。外部 runtime 适配、持久 PTY daemon、Computer Use 与多 Agent 编排须另立证据门与授权。
