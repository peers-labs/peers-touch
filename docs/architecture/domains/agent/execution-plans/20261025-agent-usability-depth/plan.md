# Agent 可用性深度（V01–V14）实施计划

> **Plan ID**: AUD-20261025
> **Version ID**: agent-usability-depth-20261025-v4
> **Created**: 2026-10-25T00:00:00.000Z
> **Owner**: Peers-Touch Agent Team

本计划只冻结实施模型，不表示实现已完成，也不授权 push、PR、发布、远程部署、数据重置或历史改写。允许本地 checkpoint commit。Owner 已于 2026-10-25 批准 V01–V14 全量范围与 DAG；未逐条裁决的设计问题采用 [设计文档 §10](../../../architecture/domains/agent/agent-usability-depth/design.md) 推荐默认值（见下方「默认裁决」），Plan review 可在实施前修正，实施中变更须新版本。

## 目标与完成口径

完成后必须同时成立：

1. 正常 tool-result 续跑不再与失败重试共用 3 次请求预算；≥6 次续轮的真实依赖链可完成（V01）。
2. Agent 开箱可用真实能力：workspace 内文件读/写/编辑、受控 shell allowlist、web_fetch、todo 清单；首次任务说明可用能力与阻塞；写/命令逐次审批，桌面 executor 围栏回执含文件变更摘要（V02）。
3. Skill 是固定版本的内容+资源包；references/assets 可按版本读取，CLIENT 包脚本只能从只读受管目录经 allowlist 执行（V03）。
4. 运行中可发送：STARTED/QUEUED 确认后释放草稿，QueueTray 可见/可取消/可取回编辑，FIFO 自动消费，重启以 Station 队列对账（V04）。
5. 断网、切页、Desktop 重启、AskUser/审批后，同一任务恢复原身份；未知副作用步骤不自动重放（V05）。
6. workspace 真实文件成为 Turn 产物：可打开/定位/再编辑/上传 Station 跨设备下载；代码块提取不再冒充实物（V06）。
7. Settings → AI 存在 Knowledge 真实面（Station descriptor CRUD + 条目阅读 + 检索状态诚实标注）（V07）；Memory 配置显示真实 Station 状态、条目可编辑删除（V08）。
8. MCP 编辑触发工具重发现，零工具/探测失败不可绑定，STATION 与 CLIENT 双 owner 各有端到端 Journey（V09）；默认 provider/model 落 Station runtime config，状态灯由真实 check 驱动（V10）。
9. Scheduled Tasks 为 Station 持久调度（cron/interval/once、override、一次性退役、history、专属会话），Rust 假 cron 同批删除（V11）。
10. Lark 配置面展示真实 automation/event-list/delivery 权威；Bot 可绑定 Station Agent，入站消息触发真实 Turn 并以 bot 身份回复（V12/V13）。
11. 全局只有一个 Agent 名册与一个 capability binding 真相；AgentGrowthTab 在持久调度 cutover 后挂载；假 mock-gateway 等死代码清除（V14）。
12. TD-J01…TD-J05 普通用户路径（无 Harness 注入工具）在 `make desktop` 当前源码达到 FUNCTIONAL_PASS。

人类可读执行前后差异见 [outcome-comparison.md](./outcome-comparison.md)，其计划区进入 planVersionDigest，实际结果区初始全部 UNPROVEN，仅按 current-source evidence 回填。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "AUD-20261025",
  "versionId": "agent-usability-depth-20261025-v4",
  "createdAt": "2026-10-25T00:00:00.000Z",
  "supersedes": "agent-usability-depth-20261025-v3",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/domains/agent/agent-usability-depth/design.md",
      "docs/architecture/domains/agent/modern-chat-agent/product-definition.md",
      "docs/architecture/domains/agent/modern-chat-agent/decisions.md",
      "docs/architecture/domains/agent/modern-chat-agent/design.md",
      "docs/architecture/domains/agent/modern-chat-agent/data-model.md",
      "docs/architecture/domains/agent/modern-chat-agent/integration.md",
      "docs/architecture/domains/agent/modern-chat-agent/experience-contract.md",
      "docs/architecture/domains/agent/modern-chat-agent/proposals/20261022-task-depth-product-amendment.md",
      "docs/architecture/engineering/prototypes/desktop-shell/settings-benchmark-disposition.md",
      "docs/architecture/engineering/prototypes/desktop-shell/settings-capabilities-coverage.md",
      "docs/architecture/engineering/prototypes/desktop-shell/agent-chat-coverage.md"
    ],
    "decisions": ["MCA-D16A", "MCA-D22", "MCA-D23", "AUD-V01-V14", "AUD-20261025-V4-RESOURCE-CONTRACTS"]
  },
  "scope": {
    "sourceClaims": [
      { "pathPrefix": "model/build.sh", "mode": "exclusive-write" },
      { "pathPrefix": "model/domain/agent", "mode": "exclusive-write" },
      { "pathPrefix": "model/domain/bot", "mode": "exclusive-write" },
      { "pathPrefix": "model/domain/channel", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station/app/subserver/agent", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station/app/subserver/channel", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station/app/subserver/bot", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station/app/subserver/conversation", "mode": "exclusive-write" },
      { "pathPrefix": "apps/desktop", "mode": "exclusive-write" },
      { "pathPrefix": "packages/locales", "mode": "exclusive-write" },
      { "pathPrefix": "packages/prototypes/desktop", "mode": "exclusive-write" },
      { "pathPrefix": "packages/agent-catalog", "mode": "exclusive-write" },
      { "pathPrefix": "docs/architecture/domains/agent", "mode": "exclusive-write" },
      { "pathPrefix": "docs/architecture/engineering/prototypes", "mode": "exclusive-write" },
      { "pathPrefix": "model", "mode": "shared-read" },
      { "pathPrefix": "apps/station", "mode": "shared-read" },
      { "pathPrefix": "apps/mobile", "mode": "shared-read" },
      { "pathPrefix": "packages", "mode": "shared-read" },
      { "pathPrefix": "docs", "mode": "shared-read" },
      { "pathPrefix": "tooling", "mode": "shared-read" }
    ],
    "nonGoals": [
      "External coding runtimes（Codex/Claude/Cursor CLI 等）的 per-turn 工具桥、活动归一与产物桥；保持可配置但不广告输入能力",
      "Evaluation Lab 扩展与主工作面入口；既有 Station/Desktop 代码保留不删",
      "商业市场、Agent Hub、社区共享、Curator 与一键安装他人 Agent",
      "Workflow templates/dynamic workflow、Plugins/Hooks CRUD",
      "多 Agent team/Canvas 协作扩展；图片/视频生成；服务端音频与 TTS 投入",
      "Memory consolidation、Knowledge/Skill 的 Git 自动摄取与本地 Git reference（仅 official envelope/ZIP/自建）",
      "Knowledge 持久向量升级（本轮保持 inline 内容 + 查询切块并诚实标注）",
      "Settings 内新增 Your Station 多站管理节（仍由登录/Onboarding 承担）",
      "进程 status/kill、PDF/二进制读取、任意 shell、出根写、未声明网络工具",
      "Mobile UI 交付（仅保持共享合同兼容）、云端/远程设备执行",
      "push、Pull Request、远程部署、生产发布、数据重置或历史改写"
    ]
  },
  "tasks": [
    { "id": "AUD-01", "workstreamId": "AUD-BUDGET", "path": "tasks/AUD-01.md", "dependsOn": [] },
    { "id": "AUD-02", "workstreamId": "AUD-EXEC", "path": "tasks/AUD-02.md", "dependsOn": ["AUD-01"] },
    { "id": "AUD-03", "workstreamId": "AUD-EXEC", "path": "tasks/AUD-03.md", "dependsOn": ["AUD-02"] },
    { "id": "AUD-04", "workstreamId": "AUD-ARTIFACT", "path": "tasks/AUD-04.md", "dependsOn": ["AUD-03"] },
    { "id": "AUD-05", "workstreamId": "AUD-SKILL", "path": "tasks/AUD-05.md", "dependsOn": ["AUD-03", "AUD-04"] },
    { "id": "AUD-06", "workstreamId": "AUD-QUEUE", "path": "tasks/AUD-06.md", "dependsOn": ["AUD-04"] },
    { "id": "AUD-07", "workstreamId": "AUD-RECOVERY", "path": "tasks/AUD-07.md", "dependsOn": ["AUD-03", "AUD-04", "AUD-06"] },
    { "id": "AUD-08", "workstreamId": "AUD-SUPPLY", "path": "tasks/AUD-08.md", "dependsOn": [] },
    { "id": "AUD-09", "workstreamId": "AUD-SCHED", "path": "tasks/AUD-09.md", "dependsOn": ["AUD-04"] },
    { "id": "AUD-10", "workstreamId": "AUD-CHANNEL", "path": "tasks/AUD-10.md", "dependsOn": ["AUD-09"] },
    { "id": "AUD-11", "workstreamId": "AUD-CHANNEL", "path": "tasks/AUD-11.md", "dependsOn": [] },
    { "id": "AUD-12", "workstreamId": "AUD-SUPPLY", "path": "tasks/AUD-12.md", "dependsOn": [] },
    { "id": "AUD-13", "workstreamId": "AUD-SUPPLY", "path": "tasks/AUD-13.md", "dependsOn": [] },
    { "id": "AUD-14", "workstreamId": "AUD-SUPPLY", "path": "tasks/AUD-14.md", "dependsOn": [] },
    { "id": "AUD-15", "workstreamId": "AUD-SUPPLY", "path": "tasks/AUD-15.md", "dependsOn": ["AUD-09", "AUD-10", "AUD-11"] },
    { "id": "AUD-16", "workstreamId": "AUD-FINAL", "path": "tasks/AUD-16.md", "dependsOn": ["AUD-05", "AUD-07", "AUD-08", "AUD-09", "AUD-10", "AUD-11", "AUD-12", "AUD-13", "AUD-14", "AUD-15"] }
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


## 2026-10-25 v4 修订（Owner 裁决 A/A/A）

源码复核发现 v3 对 AUD-05、AUD-06、AUD-08 的三项前提不成立，Owner 已裁决采用长期正确方案：

1. **AUD-05 = A：通用 content-addressed blob。** 新增 Station 通用不可变内容存储，blob 以 sha256 为身份并去重；Skill 资源与 Knowledge 正文均引用该内容层，不允许新增 Skill 私有第三套正文表，也不复用 Knowledge descriptor 私有修订表。
2. **AUD-06 = A：完整队列修订。** queue entry/API 持久 capability snapshot 身份与展示摘要；Desktop stream operation 改为可多实例身份，运行中发送不得覆盖当前流；pending 取消后通过 queue list 与 after_sequence/SSE 对账，不新增本地队列。
3. **AUD-08 = A：Knowledge 正文读取 API。** descriptor 仍只存 locator/hash；新增 actor/tombstone 受控的 `resource_id + revision` Station 正文读取契约，Settings 详情不依赖创建时本地缓存。

实施顺序调整为 **AUD-08 → AUD-05 → AUD-06**：先落 Knowledge 正文读取，再抽象通用 blob 并接 Skill，最后改造队列身份。三项均保持 Station 真相、proto-first、当前会话 FIFO 与不可变归因。

## 默认裁决（Owner 未逐条回答的设计问题）

- 审批：L1 写/编辑与 L2 命令默认逐次审批；不做持久化“记住自动批准”；shell allowlist 初始集 = `find grep rg cat ls`（只读）与 `make pnpm npm go cargo git`（只读子命令），参数与工作目录全量回显；workspace 默认根为应用数据下 per-agent 目录。
- Knowledge 走设计方案 A（inline 不可变内容 + 查询时切块，UI 诚实标注 local hash retrieval）。
- external runtime、Evaluation、consolidation、Git 摄取、Your Station 节、TTS 投入均 nonGoal；AUD-16 隐藏 TTS 假成功入口。

## 实施模型（16 个垂直闭包）

1. **AUD-01 预算真相（Station）。** turn_attempt 分离 continuation/retry/auxiliary 计数与独立预算，续跑不被 3 次上限误杀，预算耗尽有独立错误码与客户端映射。
2. **AUD-02 STATION 工具（web_fetch/todo）。** 注册真实 STATION-owner 工具：SSRF 约束的 URL 抓取；todo 写改作为 progress 事件随 Turn 持久；能力环境段进入 prompt assembly 与 `/tools`。
3. **AUD-03 CLIENT 写/命令面。** proto 工具契约 → Station CLIENT-owner 注册/风险分级/审批 → Rust 白名单（write/edit、shell allowlist）与 receipt 变更摘要 → React diff/命令审批卡。
4. **AUD-04 Turn 产物。** `TurnArtifact` proto + Station 元数据表 + receipt 提取 + OSS 上传复用；React 产物面板切换为真实 locator，跨设备语义诚实。
5. **AUD-05 Skill 资源包（v4）。** 先落 Station 通用 content-addressed immutable blob；SkillManifest resources 版本化并引用 blob（path/hash/size/kind/execution_owner），STATION 文本资源工具与 CLIENT 只读受管包物化/`skill.resource.read`；包扫描与 React 文件树。
6. **AUD-06 持久队列产品面（v4）。** queue entry/API 持久 capability snapshot 身份与摘要；Desktop stream operation 支持多实例；挂载 TurnQueueTray，streaming 可发送→admission；QUEUED 确认释放草稿；取消/取回编辑；重启 queue list+after_sequence 对账；契约测试改判。
7. **AUD-07 过程与恢复串验。** 统一活动卡呈现写/命令/web/todo/产物；AskUser/审批后续跑、断网、切页、Desktop 重启、PREPARED 未知副作用四恢复 Journey 证据。
8. **AUD-08 Knowledge 设置面（v4）。** 新增 Station `resource_id + revision` 正文读取契约；React 新 module（卡片网格/条目树/正文阅读器/建包写 Station descriptor），检索状态诚实显示，绑定→命中→归因→tombstone Journey。
9. **AUD-09 持久调度。** `ScheduledJob/Run` proto + Station 表与 next_due_at worker + 专属会话 + turn 归因；Rust cron 假仓硬切换；React 抽屉移植 NL 解析；shell/workflow 类型删除。
10. **AUD-10 Bot 绑定。** bot 域绑定契约；conversation publishing 入站→ChannelTurnExecutor 投影→bot 身份回复；BotsSettings 名册选择；解绑停止回复。
11. **AUD-11 Lark 权威收口。** 配置面映射真实 automation/event-list/delivery retry；Topics 从 Station conversation 投影；密钥不回客户端；无权威聚合不展示。
12. **AUD-12 Memory 诚实化。** 删 Rust 假 PG test/假配置；配置节透传 Station embedding-status/stats；Browse 编辑/删除真实 API 与二次确认。
13. **AUD-13 MCP 收口。** 编辑 revision bump→工具重发现；零工具/探测失败绑定门槛；STATION/CLIENT 双 owner 端到端 Journey。
14. **AUD-14 Provider 默认。** 默认 provider/model 落 Station runtime config 与星标/设默；模型灯由 check/discover 驱动；清理无效字段。
15. **AUD-15 身份一致性。** Cron/Bots/Lark 绑定同源 Station roster；AgentGrowthTab 改接触发调度后挂载；Growth 临时 JSON 触及时补 proto。
16. **AUD-16 整体收口。** TD-J01…J05 普通路径 FUNCTIONAL_PASS；假 mock-gateway/TTS 入口清理；原型合同/coverage/i18n 同步；当前源码证据。

## Hard Cut 与回滚

- 每个被替换面原子切换：Rust 假 cron 在 AUD-09 同 commit 删除；system 域假 PG test/embedding 列表在 AUD-12 删除；产物代码块提取在 AUD-04 降级为消息内展示；AUD-16 同时卸载聊天 TTS mini-player 与 Settings TTS；不保留 flag、双写或兼容分支；回滚 = VCS revert cut commit。
- 写/命令能力默认审批 + workspace 沙箱 + fenced exactly-once；CLIENT 离线时能力广告降级但不阻断普通对话。
- 每个 Task 开始前从当前源码生成消费者/旧 owner inventory 与精确 changed-file allowlist；目录级 claim 只是上限。
- DAG 已按文件级写冲突排序（local_executor.rs、agent.proto、agent.go、channel_turn_executor.go、BotsSettings、ChannelManagementPanels、chat.ts 等共享文件只允许后继任务写入）。`services/desktop_api.ts`、`packages/locales`、`src-tauri/src/main.rs`（generate_handler 注册）、`src-tauri/src/interface/http_gateway/mod.rs`（分发臂）、`src/modules/index.ts`（side-effect import）是多任务追加式集成面：相关任务只做追加/替换本任务的命令块、注册行或 import 行，块内相邻、段落独立，集成编辑在各任务的 checkpoint 串行提交，禁止跨任务重排他人段落。
- Bot 绑定契约冻结为：bot 子域持有 `bot_agent_bindings`（bot.proto 增 BotAgentBinding），conversation publishing 入站经内部服务调用查询绑定后复用 ChannelTurnExecutor；不新建独立 binding 子系统。系统内存 scheduler_service 保留给 silent_review/dogfood 系统任务且不进用户面；用户可见调度唯一来源是 AUD-09 的持久 ScheduledJob。
- 所有用户可见文案进 `packages/locales`；禁止 debug 打印、伪造遥测与成功。

## Acceptance Execution

本期为 DEVELOPMENT_ITERATION 收口：各 Task 以聚焦源码检查与 `make desktop` 当前源码 Journey 的 FUNCTIONAL_CHECK 证明；正式业务 Acceptance Gate 与 Station/双端 Suite 随后续 Acceptance 计划注入。未运行 Gate 保持 UNPROVEN，不自动回填。

```json
{
  "closures": {
    "aud-v01-continuation-budget": [],
    "aud-v02-station-tools": [],
    "aud-v02-client-execution": [],
    "aud-v06-turn-artifacts": [],
    "aud-v03-skill-resources": [],
    "aud-v04-turn-queue": [],
    "aud-v05-recovery": [],
    "aud-v07-knowledge-settings": [],
    "aud-v11-scheduled-jobs": [],
    "aud-v13-bot-agent-binding": [],
    "aud-v12-lark-authority": [],
    "aud-v08-memory-honesty": [],
    "aud-v09-mcp-closure": [],
    "aud-v10-provider-defaults": [],
    "aud-v14-identity-consistency": [],
    "aud-whole-agent-usability": []
  },
  "completion": [],
  "full": []
}
```

## 审批边界

Owner 2026-10-25 批准 V01–V14 全量与本 DAG，并批准按默认裁决进入 Plan review；该批准不授权 push、PR、发布、远程部署、数据重置或历史改写，也不把开发 Journey 扩大为 Station 联邦、Mobile 或正式 Acceptance 已验证。正式实施开始以本 Plan Version review 通过为前提。
