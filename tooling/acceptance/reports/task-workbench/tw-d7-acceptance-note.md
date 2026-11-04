# TW-D7 阶段验收说明（临时文档）

> 阶段：TW-D7 Profile/Memory、插件 readiness、收口与两条完整 Journey
> 计划：TW-20261102，journeyId tw-j07
> 本文件为阶段临时验收指引；正式结论以 `tw-d7-journey.json`、Go 单测与提交记录为准。

## 本轮已闭环：Memory 候选确认门（O08 的 Memory 支柱 / R03）

**根因（真实缺陷）**：`MemoryService.ExtractFromTurn` 用关键词启发式提取后，直接 `AddMemory`
落为立即生效的长期记忆；`agent_memories` 表没有生命周期状态，`Search`/persona 也不过滤状态，
`BuildRelevantSnapshot` 在检索失败时回退到 `BuildSnapshot` 全量快照。这违反“候选必须确认、
临时指令不能自动升级为长期偏好、检索失败不得注入无关记忆”。

**修复（proto → Station → Rust → Desktop 全纵向）**：
1. `model/domain/agent/memory.proto`：新增 `MemoryStatus(CANDIDATE/CONFIRMED/REJECTED)`、
   `MemoryItem.status`、`ListMemoriesRequest.status` 与 `ReviewMemory` RPC。
2. Station：`agent_memories.status`（默认 `confirmed`，存量记忆与显式写入保持有效，不删用户数据）；
   启发式提取一律落 `candidate`；`Search`（postgres hybrid + 进程内两条路径）与 persona 只消费
   `confirmed`；新增 `ReviewMemory`（confirm/reject，frozen 拒绝 reject）；检索失败改为显式降级
   （空快照 + `degraded` + retrieval_degraded 事件），不再回退全量快照。
3. Rust worker：`agent_memory_list` 支持 status 过滤；新增 `agent_memory_review` 代理；状态用
   小写线序（candidate/confirmed/rejected）。
4. Desktop：新增 TRAE 式 `MemoryReviewDock` 记忆复核队列（角标计数、确认/拒绝、轮询刷新、fail-closed），
   全部文案进 `packages/locales`（en/zh-CN chat namespace `chat.memory.*`）。

## 如何验收

### A. 全自动 Native Journey（当前源码）

```bash
cd apps/desktop
PT_PLAYWRIGHT_SOCKET=/tmp/tw-d1.sock PT_STATION_URL=http://127.0.0.1:18092 \
PT_EVIDENCE_COMMIT=$(git rev-parse HEAD) \
pnpm exec playwright test --config e2e/playwright.config.ts \
  e2e/tests/tw-d7-journeys.spec.ts --project=performance --reporter=line
```

journey 以 7.2s 通过：真实 Desktop dock → Rust 代理 → Station，决策前列入候选但 confirmed 检索计数为 0；
UI 拒绝一条后 DB `rejected`，确认一条后 DB `confirmed` 并离开候选队列；confirmed-only 检索谓词
（`BuildRelevantSnapshot`/`Search` 同一条件）只命中确认项、不命中拒绝项；确认行 `session_id=''`
证明记忆按 agent 维度而非会话维度，可用于后续任务。证据：`tw-d7-journey.json`（绑定当次 HEAD）。

### B. 确定性单测

```bash
cd apps/station && go test ./app/subserver/agent/service -run 'TestMemory' -count=1
```

6 个测试覆盖：候选确认前不可检索、确认后可检索；reject/delete 停止消费（reject 行保留审计、delete 物理删除）；
显式写入默认 confirmed；检索失败降级为空快照而非全量注入；frozen 不可 reject；
`ExtractFromTurn`（“请记住…”）产出的是 gated candidate。

## 本轮已进一步闭环（Per-Turn 冻结 / 插件 readiness / Provider 归属）

- **Per-Turn 上下文冻结回看（doneWhen 第 2 条）**：identity 与 agent-config(规则) 段以
  `agent:<id>:version=<n>` 冻结，新增 `TURN_ATTRIBUTION_KIND_PROFILE`，在 TurnAttribution 回看 agent
  定义版本（Desktop 归因面板新增 Profile chip）；每个被采用的 confirmed memory 冻结独立
  `memory:<id>:version=<内容hash>` 并解析出名称，逐条 MEMORY 归因可回看。Skill 激活体、工具、附件
  版本此前已逐采用项冻结。Go 单测 TestAttributionProfileEntryFreezesAgentVersion 等覆盖。
- **插件 installed/enabled/readiness→真实调用→撤权阻断（doneWhen 第 3 条，语义层）**：tool_dispatch
  要求 (capabilityId,version,bindingId,bindingRevision) 在不可变、哈希校验、未过期的 readiness 快照中
  恰为 READY，否则拒绝；撤权/升级改 revision → 旧快照失配 → 阻断新 admission。由现有 current-source
  单测证明（FailsClosedForStaleBinding / SnapshotIsImmutable / BindingMutationsPublishInvalidations /
  CommandCapabilitySnapshotPins...）。
- **O09 Provider 归属（静态审计）**：Desktop provider 层为 Station 纯代理，无 CLI/第二 registry；
  默认选择发送完整 (provider_id, model_id)+revision。回填 O09=PARTIAL。

## 本轮未闭环（保持 UNPROVEN/PARTIAL，不冒充完成）

- **两条完整端到端业务旅程（TW-O12）**：研究/文档（含第二任务模型改写召回）与代码/服务/Browser
  （失败反馈→修复→复测）本轮未跑，保持 UNPROVEN；弱验收 0.5b 模型上不主张模型语义召回，agent 维度
  可用性已由 Station confirmed-only 检索谓词与行事实证明。
- **通用第三方 MCP 插件 install→probe→ready 的 native app journey** 未单独编排（本周真实使用的
  文件/命令/Browser/Terminal 已在同一 readiness 门由 D4–D6 证明）。
- **R01/R05/R06 UI 硬切、R04 外部 app-server 接入**：R04 在计划内为独立证据门（本周 nonGoal）；
  R01/R05/R06 属较大 UI 重构，未在无人验收的夜间做跨绿树成组删除，留待白班按 replacement-inventory 收口。
