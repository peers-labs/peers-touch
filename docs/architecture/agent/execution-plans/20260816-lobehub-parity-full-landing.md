# LobeHub Parity 全量对齐落地执行计划

> **Status**: active
> **Delivery**: partial / marketplace-data-future
> **Created**: 2026-08-16
> **Owner**: Peers-Touch Agent Team
> **Plan type**: EXECUTE（多阶段能力对齐落地）
> **Source of truth（追踪源）**: [`../lobehub-parity-mindmap.source.md`](../lobehub-parity-mindmap.source.md) §2（45 节点，带 `对齐` icon 列）
> **可视化**: [`../lobehub-parity-mindmap.svg`](../lobehub-parity-mindmap.svg)
> **对标源**: `agent-box/external/lobehub` @ 1056cdf32b

---

## Context Anchor

| Field | Current value |
|---|---|
| Main task | LobeHub 源码级 Agent 能力全量落地到 Peers-Touch Agent 域 |
| Plan source | `docs/architecture/agent/execution-plans/20260816-lobehub-parity-full-landing.md` |
| Tracking source | `docs/architecture/agent/lobehub-parity-mindmap.source.md`（45 节点） |
| Worktree | `<repo-root>` |
| Branch | `feat/p0-streaming-runtime-message-actions` |
| Stage | `EXECUTE` |
| Current workstream | Future Work — Marketplace 数据供应与治理 |
| Current step | 已将 X3 从完整对齐降为部分闭环，并登记未来数据平面与 Acceptance 闭环 |
| Progress | 源码追踪 38/45 完整闭环 + X3 部分闭环；本计划非候选范围 15/16 完整闭环；Native product proof 5/5 `PROVEN`（I1/C6/C7/R9/P2） |
| Last completed | Marketplace 当前实现与 LobeHub hosted market 数据来源完成源码审计；本地 JSON index parser/ledger 与未来官方/联邦 catalog 明确分界 |
| Current action | 保留现有 Marketplace UI 与安装分发，停止宣称数据供应和开箱体验完整对齐 |
| Next action | Marketplace 重新进入实施时，先完成 catalog truth owner、默认可信 source、发布/撤销/签名治理和 source-to-install Acceptance 的产品与架构评审 |
| Blockers | Future scope 未进入 PRODUCT/DESIGN；当前无可执行实现任务 |
| Decisions required | 未来需决定官方集中 catalog、Station 联邦 catalog 或两者组合的产品边界 |
| Evidence | Source audit: `MarketplacePage.tsx#loadMarketplaceCatalog`, `skills_market/mod.rs#load_market_store/#skills_market_sync`, LobeHub `discover.ts` + `MarketService`; Agent capability 保留 Marketplace data-plane `UNPROVEN` |
| Last updated | 2026-08-21 |

---

## 1. 立项背景与范围

经四轮跨-agent review，脑图已收口为 45 节点的源码级对比追踪源（✅23 / ⬜16 / ⬜候选5 / ⛔1）。
本计划把 **16 个待对齐节点（⬜）** 完整实现到「已对齐 ✅」。

### 范围决策（已确认）

- **做**：16 个 ⬜（补接线 / 补持久化 / 行为对齐）。
- **候选，移交后续计划**：P3 Home 深度 / E1 Eval Station 化 / G3b TTS 服务端合成。
- **不做（⛔）**：G1 Image Generation、G2 Video Generation（长期不支持）；X2 Custom Plugins（合并进 Tool+MCP+Connector 体系）；以及脑图 §4 明确不采用/架构不同项（LobeHub 客户端 Loop、Cloud Gateway、Skill Store 商业生态）。

---

## 2. 对齐判定门（打 ✅ 的准入）

一个节点从 ⬜/🟨 → ✅，**必须五项证据齐全 + 验收记录**，与脑图证据分级一致：

1. 真实入口（按钮 / i18n key）
2. handler / action
3. 状态字段 / 状态机
4. 持久化 / API / 跨层路径（Station 落库或明确跨层）
5. 精确源码文件行号
6. **验收记录**（Native Tauri 或 Gateway E2E 通过，行号/命令留痕）

缺任一项 → 停在 🟨，不得打 ✅。防「文件存在即完成」旧错。

### icon 语义

| icon | 含义 |
|---|---|
| ⬜ | 未开始 |
| 🟨 | 进行中（缺验收或缺证据项） |
| ✅ | 已对齐（六项齐全） |
| ⛔ | 明确不做 |

---

## 3. 阶段与节点（按差距量 + 依赖排序）

### Phase 0 — 追踪底座（已完成）

- [x] 脑图 md 落项目 `docs/architecture/agent/lobehub-parity-mindmap.source.md`
- [x] SVG 副本进项目 `docs/architecture/agent/lobehub-parity-mindmap.svg`
- [x] §2 加 `对齐` icon 列，基线 ✅23/⬜16/候选5/⛔1
- [ ] git 提交（待用户指示）

### Phase 1 — 补接线（代码已存在，只差 wiring / Station 落库；最快见效）

| 节点 | 现状 | 目标动作 | 依赖 |
|---|---|---|---|
| ✅ I1 @Mention | ~~store+组件全，ChatInput 未接~~ **已对齐** | ~~接入活体 `components/ChatInput.tsx`~~ 完成：trigger `#L65`、tag bar `#L352`、popup `#L355`、输入扫描 `#L142-L146`、键盘让位 `#L164-L172`、选择插入 `#L149-L162`、成功发送清空 `#L130-L139`；迁移复核后补齐既有 acceptance F6 的 `MentionTagBar` 活体接线；验收 `pnpm run check`、`pnpm run build`、`cargo build --lib` 绿（2026-08-16） | 无 |
| ✅ R11 Thread | ~~仅 slice 视图~~ **已对齐** | 全后端已建：proto `AgentThread`+`thread_id`、`persistence/thread.go`、`thread_service.go`、`/agent/thread/{create,list,messages}`、BFF 3 命令、`ThreadView.tsx` 接 Station；验收 model build/go build/cargo/tsc/check 全绿（2026-08-16） | Station thread API（已建） |
| ✅ O1 Group 增删改 | ~~仅 localStorage~~ **已对齐** | M11 后端已全（`ecosystem_*`）；补 BFF 4 命令 + `store/agentGroups.ts` 改 Station（localStorage 清零）；UI `AgentGroupsPage.tsx`；验收 cargo/tsc/check 绿（2026-08-16） | Station group API（M11 已建） |
| ✅ O2 Group 成员/排序 | ~~仅 localStorage~~ **已对齐** | `addMember/removeMember/reorderMembers` 统一走 `updateAgentGroupRemote`（有序 id 数组）；验收同 O1（2026-08-16） | O1 |
| O3 Task 生命周期 | ✅ **已对齐** | 全新 Station 后端（M11 无 task 模型）：proto `task.proto` + 表 `agent_tasks` + `agent_task_service.go` + 6 路由 `/agent/task/*` + BFF 6 命令 + `store/tasks.ts` 改 Station（localStorage 清零）；验收 model/go/cargo/tsc/check 全绿（2026-08-16） | Station task API（本次新建） |
| ✅ X4 Topic Comments | ~~仅 localStorage~~ **已对齐** | M11 后端已全（`ecosystem_topic_comments`，create/delete/list）；补 BFF 3 命令 + `store/topicComments.ts` 改 Station（localStorage 清零）+ `TopicCommentsView.tsx` mount 拉取；验收 cargo/tsc/check 绿（2026-08-16） | Station comment API（M11 已建） |

> **Phase 1 完成（6/6）**：I1 · R11 · O1 · O2 · X4 · O3 全部 ✅。补接线类（I1）、复用 M11 后端类（O1/O2/X4）、全新后端类（R11/O3）三种模式均已跑通。

### Phase 2 — 补持久化 / 行为对齐

| 节点 | 现状 | 目标动作 |
|---|---|---|
| R10 翻译 | ✅ **已对齐** | 翻译落库（寄生 metadata_json，不改 proto）：`SetMessageTranslation` + `/agent/conversation/message/translate` + `messagesToJSON` 读出 + BFF `agent_message_translate` + 前端 translateMessage 持久化 + 回读恢复；验收 go/cargo/tsc/check 绿（2026-08-16） |
| R13 continue | 重发「继续」提示词 | 改为真正续写流（非重发） |
| I2 Follow-up | ✅ **已对齐** | **计划原判「承载字段+无服务端抓取」过时**：Station `GenerateFollowUpSuggestions` 已在 `done` 事件生成建议（proto `follow_up_suggestions` 全链齐全，无需新后端/proto）。落地=行为对齐：点击即发 → Lobe `fillInputMessage` 填入不发，新增 chat store `composerFill`/`fillComposer`/`consumeComposerFill` + ChatInput 消费；验收 tsc/check 绿（2026-08-16） |
| I3 Markdown | ✅ **已对齐** | 补内联标签管线：`markdownConfig.tsx` `allowHtml`+`components.think` + `InlineThinkingTag.tsx`（`<think>` 折叠块），无新依赖；artifact 门户/tool chip 后置；验收 tsc/check 绿（2026-08-16） |
| C5 Agent 创建 | draft 流 | 收口为一等 createAgent 闭环 |
| C6 Knowledge | ✅ **已对齐** | 收口为一等 agent↔resource 绑定关系（对齐 Lobe `addFilesToAgent` 语义边界=id 关联落库，**非 RAG 检索**——检索属文件上传管线，见脑图 B8）：描述目录仍存 `config_json`，写入后 `reconcileKnowledgeBindings` 落 Station 既有但先前无客户端调用的 `agent_knowledge_bindings`；Desktop Rust build 纳入既有 `agent_config.proto` 并用 `request_proto` protobuf 调 typed 路由；reconcile partial failure 显式抛给 UI且保留已成功 descriptor projection；不改 proto schema/版本、不新建后端；验收 cargo/tsc/check/go build 全绿（2026-08-16） |
| C7 Connectors | ✅ **已对齐** | 三腿补齐 mount/OAuth/syncTools，复用既有 OAuth2 子系统 + chatConfig 持久化，无新后端/无 proto：mount 从 localStorage 收口为 per-agent `chatConfig.connectors`（同 Station config_json 通道）；OAuth 复用 `oauth2.startAuth` loopback；syncTools 复用 provider resources 填充 enabledTools，失败显式反馈且可手动 Sync retry；projection load 迁入 `agentCapabilityRuntime` bootstrap/reconcile，面板纯渲染/动作；死 localStorage/mount effect 已删；验收 tsc/check 绿（2026-08-16） |
| P2 Portal 侧栏 | ✅ **已对齐** | 纯客户端导航状态机闭环：`portalStack` + top `activeView`，统一 `pushPortalView`，补 `goBack`/back button；collapse 保留任务栈、explicit close 清栈；Portal titles/toggle/back/close 全 i18n；不复制 Lobe 额外 view 广度，无后端/proto；验收 tsc/check/diff-check 绿（2026-08-16） |
| X3 Marketplace | 🟨 **部分对齐；数据供应列入未来工作** | 当前完成 Desktop 本地 JSON index source 的登记、同步、聚合、分类、详情和安装分发。未完成默认可信 source、真正的 Git branch 解析、官方或联邦 catalog、来源签名/治理、分页和开箱数据；首次使用可能为空。不得以本地 parser/ledger 通过宣称与 LobeHub hosted market 完整对齐。 |

> **Phase 2 实现切片完成**：R10 · R13 · I2 · I3 · C5 · C6 · C7 · P2，以及计划内补入的 R9 已闭环。X3 仅完成本地 source parser/ledger 与安装分发，Marketplace 数据供应和开箱体验转入未来工作，不计为完整产品对齐。

### Phase 3 — 决策移交（不在本计划继续实施）

| 节点 | 决策 |
|---|---|
| P3 Home 深度 | 进入 `20260817-modern-chat-agent-v2.md` required scope |
| E1 Evaluation | V2 产品评审决定；默认不做用户可见 Evaluation 产品 |
| G3b TTS 服务端合成 | V2 产品评审决定；建议不纳入核心文本 Chat Agent |

### Future Work — Marketplace 数据供应与治理

| 项目 | 当前缺口 | 未来完成条件 |
|---|---|---|
| 默认可信 source | 新 profile 的 Desktop market store 默认为空 | 安装 profile 后自动获得至少一个受治理、可撤销的默认 source |
| Source 协议 | 当前 sync 直接读取 URL JSON，保存的 `branch` 未参与解析 | 定义并实现 Git repository/branch 或稳定 catalog API 契约，禁止把普通仓库 URL 当 JSON index |
| 官方 / 联邦 catalog | 当前无集中目录，也无 Station/Federation 聚合 | 明确 catalog truth owner、发布审核、撤销、版本与联邦发现边界 |
| 信任治理 | 当前只消费 source 提供的 trust/risk 元数据 | 来源签名、publisher identity、扫描结果和安装策略均可验证 |
| 开箱体验 | 无 source 时 Marketplace 空白 | One profile 首次进入可浏览 Agent、Skill、MCP 的真实目录 |
| Acceptance | 仅 parser/ledger 测试，缺真实数据旅程 | 稳定 Gate 覆盖默认 source→同步→列表可见→详情→安装→目标权威 readback→卸载/清理 |
| G1 Image 生成 | 长期不支持 |
| G2 Video 生成 | 长期不支持 |

---

## 4. 双向联动机制（实现 ↔ 脑图不脱节）

每完成一个节点，按序执行：

1. 改代码（补接线 / 持久化 / 行为）
2. 验收（Native Tauri 或 Gateway E2E，留痕）
3. 脑图 §2 对应行 `对齐` 列 ⬜→✅，并把「验收证据行号」补进 Peers 锚点列
4. 重渲染 SVG（脚本），保持 md/SVG 一致
5. 本计划 §3 对应行打勾 + 更新 §5 进度条

**顺序不可颠倒**：先验收后打 ✅，禁止「实现即打勾」。

---

## 5. 进度条

```
已对齐 ✅ 38/45 + 部分闭环 🟨 1/45   |   本计划范围完整闭环 15/16 · X3 数据供应移交 Future Work
[█████████████████████████░░░░░] 84%（完整闭环口径）
```

> 每完成一个节点更新此处 + 脑图 icon。当前候选 3 项、⛔ 3 项不计入「本计划范围」分母。
>
> **进度日志**：
> - 2026-08-16 I1 @Mention → ✅（接入活体 ChatInput；跨 worktree 语义复核后补齐 `MentionTagBar`；check/build/cargo 绿）
> - 2026-08-16 R11 Thread → ✅（Station durable thread 全后端 + BFF + 前端，全栈 build/check 绿）
> - 2026-08-16 O1 Group 增删改 → ✅（M11 后端 + BFF 4 命令 + store 改 Station，localStorage 清零）
> - 2026-08-16 O2 Group 成员/排序 → ✅（统一走 group/update 承载有序数组）
> - 2026-08-16 X4 Topic Comments → ✅（M11 后端 + BFF 3 命令 + store 改 Station + view mount 拉取）
> - 2026-08-16 O3 Task 生命周期 → ✅（全新 task.proto + agent_tasks 表 + 6 路由 + BFF + store 改 Station）→ **Phase 1 完成**
> - 2026-08-16 I3 Markdown → ✅（内联标签管线 allowHtml+components.think + InlineThinkingTag，`<think>` 折叠块）→ **Phase 2 起手**
> - 2026-08-16 R10 翻译 → ✅（落库寄生 metadata_json，不改 proto；SetMessageTranslation + BFF + 前端持久化/回读恢复）
> - 2026-08-16 R9 转发 → ✅（纯前端组合：buildForwardedContent + ForwardMessageModal + openAgentChatSession/sendMessage，无新后端）
> - 2026-08-16 R13 继续 → ✅（真续写：把已生成内容拼进 continueWithContext 再 sendMessage；拓扑差异=新气泡，非同气泡 prefill）
> - 2026-08-16 C5 Agent 创建 → ✅（收口一等 store.createAgent，两页面复用，消除重复 payload + 死 selector）
> - 2026-08-16 C6 Knowledge 绑定 → ✅（收口一等 agent↔resource join：复用 Station 既有死后端 `agent_knowledge_bindings` /config/knowledge/*；descriptor 目录仍存 config_json；Desktop Rust 使用既有 agent_config.proto protobuf；partial failure 显式）
> - 2026-08-16 C7 Connectors → ✅（三腿 mount/OAuth/syncTools：mount 收口 chatConfig.connectors 持久化、OAuth 复用 oauth2.startAuth、syncTools 复用 provider resources；projection 迁 agentCapabilityRuntime；失败可见可重试；死 localStorage/mount effect 删）
> - 2026-08-16 I2 Follow-up → ✅（计划原判过时：服务端 GenerateFollowUpSuggestions 已在 done 事件生成；落地=行为对齐 fill-not-send：composerFill/fillComposer + ChatInput 消费；无新后端/proto）
> - 2026-08-16 P2 Portal 侧栏 → ✅（单 activeView 收口为 portalStack 状态机；补 push/replace-top/goBack/close/toggle + back UI；Portal 文案全 i18n；无后端/proto）
> - 2026-08-16 X3 Marketplace → 🟨（本地 JSON index source 聚合、package taxonomy 与安装分发完成；默认可信 source、Git branch 解析、官方/联邦 catalog、治理和开箱数据转 Future Work）
> - 2026-08-17 Native close-out → I1/C6/C7/R9/P2 5/5 `PROVEN`。五项独立 Feature/Capability/Gate 接线完成，aggregate 假阳性删除；C6 Gate 修复 string-ID delete 静默零行，P2 Gate 修复 collapse 误清栈，R9 Gate 修复 provider protojson/version cleanup 与 Agent name readback 契约；C7 使用 approved GitHub OAuth 完成 mount/sync/readback/unmount。

### Phase 2 Close-out Evidence

| Gate | Result | Evidence / boundary |
|---|---|---|
| Proto generation | PASS | `./model/build.sh`，82 proto，Go + Desktop TS 生成完成；仅既有 unused-import warnings |
| Station Agent build | PASS | `go build ./app/subserver/agent/...` |
| Desktop Rust build | PASS | `cargo build --lib`；C6 knowledge binding 使用既有 `agent_config.proto` + protobuf `request_proto` |
| Desktop static gate | PASS | `pnpm run check`（social wire/runtime boundary + TypeScript） |
| Desktop production build | PASS | `pnpm run build`；存在既有 chunk-size 与 mixed-import warnings，不影响 build result |
| Agent message actions | PASS | `messageActions.test.ts` 5/5；修正 R16 readAloud 的过时 expectation |
| Marketplace parser/ledger | PASS | Rust `skills_market::tests` 5/5 |
| Five-artifact synchronization | PASS | Context Anchor、执行计划、Gate registry/catalog、45-node mindmap + SVG、source-bound evidence reports 已同步为源码 39/45 与 Native 5/5 PROVEN |
| Full Desktop unit suite | FAIL（OUT OF SCOPE） | 306 pass / 1 fail / 1 skipped；唯一失败为 `socialRealtime.test.ts` follower federation projection，隔离复现，属于明确排除的 Social 域，未在本计划修改 |
| Native product proof | PASS | I1/C6/C7/R9/P2 5/5 PROVEN；aggregate `latest-run.json` 为 `DONE/PROVEN`，无 aggregate 假阳性 |

### Agent Native Acceptance Gap Matrix

| Journey / assertion | Runtime cell | Current evidence | State | Missing closure |
|---|---|---|---|---|
| Native app boots against current-worktree Station | Tauri WebView + local Station | `agent-native-preflight/preflight.json` + native screenshot | PROVEN | — |
| I1 Mention popup/tag/remove/send-clear | Native Tauri WebView | `agent-native/i1.json`: popup/select/remove/successful-send-clear + fixture cleanup | PROVEN | — |
| C6 Knowledge binding persistence | Native Tauri + Station SQLite | `agent-native/c6.json`: add/readback/disable/re-enable/remove + cleanup | PROVEN | — |
| C7 Connector OAuth/mount/tool sync | Native Tauri + Station OAuth | `agent-native/c7.json`: approved GitHub connection→mount→tool sync→Station config readback→unmount + cleanup | PROVEN | — |
| R9 Forward to target Agent conversation | Native Tauri + Station conversation truth | `agent-native/r9.json`: source send→forward action→target Station readback→target Native DOM + cleanup | PROVEN | — |
| P2 Portal push/back/collapse/close stack | Native Tauri WebView | `agent-native/p2.json`: push/back/collapse-reopen/close | PROVEN | — |
| Agent Acceptance contract graph | Acceptance Core | `make acceptance-validate DOMAIN=agent` PASS (structure) | PROVEN | — |
| Native Gate environment | Acceptance Core | validator + five catalog entries accept `native-tauri-embedded-webdriver` | PROVEN | — |
| Tauri observer / runner | Local toolchain | Make E2E runtime + socket; five independent fail-closed Gate commands | PROVEN | — |
| Authenticated Agent fixture | local-a | disposable two-Agent Harness fixture + per-Gate cleanup | PROVEN | provider/OAuth-specific fixtures remain capability-local blockers |

---

## 6. 完成标准

- 15 个节点完整闭环；X3 保持部分闭环，直到 Marketplace 数据供应与治理 Future Work 的 Acceptance 通过
- 脑图 §2 / SVG / 本计划 §3 / §5 四处一致
- 原候选项已完成决策移交：P3 进入 V2，E1/G3b 待 V2 产品评审，G1/G2 长期不支持
