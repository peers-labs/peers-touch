# Modern Chat Agent V2 — 产品级迭代计划

> **Status**: active
> **Version**: v0.1
> **Created**: 2026-08-17 | **Updated**: 2026-09-11
> **Owner**: Peers-Touch Agent Team
> **Plan type**: PRODUCT → DESIGN → PLAN → EXECUTE（Owner approval 已收到）
> **Predecessor**: `20260816-lobehub-parity-full-landing.md`
> **Governing product**: `../modern-chat-agent/`
> **Benchmark evidence**: `../lobehub-feature-topology.md`、
> `../modern-chat-agent/lobehub-v2-reference-analysis.md`

---

## Execution Status

| Field | Current value |
|---|---|
| Main task | 将 Peers-Touch 单 Agent Chat 从源码能力对齐推进到 LobeHub 级产品体验与运行可靠性 |
| Plan source | `docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2-execution.md` |
| Tracking source | this product-level overview、`docs/architecture/agent/modern-chat-agent/`、and `docs/architecture/agent/lobehub-parity-mindmap.source.md` |
| Worktree | `<repo-root>` |
| Branch | `feat/p0-streaming-runtime-message-actions` |
| Stage | `EXECUTE` |
| Current workstream | G-FE1 typed-error closure through product-first DevelopmentWorkItems |
| Current step | MCA-J06 first exact-source run proved reject→preserve→remove and Ark completion, then exposed duplicate assistant projection; checkpoint, deploy, and rerun the focused Turn-identity fix |
| Progress | PRODUCT accepted；DESIGN including `MCA-D08A` accepted；4/16 formal execution workstreams complete |
| Last completed | Checkpoint `d3e6feaa3051763c79f1252593c7bbcfff06f6b1` preserves retained-Attempt replay; C08 run `20260913T145322729198Z-95307990b13786a7eb17d06ce2810f06` is `DONE / PROVEN`; fully authorized Foundation run `20260913T150542388406Z-46ced7c0b785bb9094b7b948a34b86d3` crossed all AS-F06 and both-locale `BASE-INTERRUPTED` cells before exposing unimplemented `BASE-INVALID_REFERENCE` |
| Current action | Checkpoint the Desktop Turn-identity reconciliation fix and rerun the same native product Journey |
| Next action | Reach exact-source Desktop `FUNCTIONAL_PASS` for invalid reference removal and successful resend; only then promote the same Journey into Foundation Acceptance |
| Autonomous execution window | Product-first hybrid execution: integrator freezes shared contracts and generated artifacts；disjoint Station、Desktop Web、and Desktop Rust lanes may proceed in parallel；checkpoint、deployment、real Journey、Acceptance promotion、and final Gate remain serial |
| Overnight slice result | PR #111 integration and cross-worktree source-claim correction are pushed; the next tangible product slice is MCA-J06 invalid-reference recovery rather than another broad Foundation run |
| Parallel policy | Freeze shared contracts first；parallelize only lanes with reserved disjoint write sets、isolated checks、and no shared runtime mutation；insert serial barriers for dependencies、shared files、generators、database/Fixture state、integration、commit、deployment、and final Gate execution |
| Overnight stop conditions | `WORKTREE_IDENTITY_MISMATCH`、undefined PRODUCT/DESIGN semantics、unauthorized destructive reset、secret leak、or exhausted external runtime resources park the affected action；focused implementation failures return to the owner layer |
| Overnight non-scope | No Home/MCP/Connector/Evaluation/W8b/W9 execution, new PR, release, version bump, profile `two`, `station-two`, or unrelated Acceptance Infra repair |
| Runtime cleanup | 任何为checks/Gates启动的进程必须登记并显式回收；handoff时不得残留dev server |
| Blockers | none for the MCA-J06 source slice；AS-F04 per-turn sequential-tool control remains parked because later source-matched runs crossed AS-F04 |
| Decisions required | none |
| Evidence | Ark model `ep-20260623145021-n4xdm` and internal `/api/v3` endpoint remain canonical；C08 `20260913T145322729198Z-95307990b13786a7eb17d06ce2810f06` is `DONE / PROVEN` on `d3e6feaa3`；Foundation `20260913T150542388406Z-46ced7c0b785bb9094b7b948a34b86d3` first fails at Browser English `BASE-INVALID_REFERENCE`；native checkpoint `41b23ab6e` proved reject、draft preservation、exact token removal、and Ark `TEST_OK`, then exposed duplicate optimistic/authoritative assistant rendering；the Turn-identity fix now passes 62 focused Desktop tests and Desktop typecheck |
| Last updated | 2026-09-14 |

---

## 1. 背景与目标

前序计划解决了“能力是否存在、是否接线、是否有持久化/API、关键 Native
路径是否真实可用”的问题，但它不是完整产品体验计划。旧 P1/P3 文档也存在
“代码/确定性检查已完成，但 GUI、真实 runtime、恢复和 receiver evidence
未完成”的历史口径。

V2 的目标不是继续增加功能数量，而是把以下用户结果做成一个一致产品：

> 用户从 Home 进入一个已准备好的 Agent，选择或检查其 Tool/MCP/Connector
> 能力，发起任务，理解审批与执行进度，在失败、断连和重启后恢复，并能从
> Station trace 解释 Agent 做了什么、为什么、结果是否可信。

对标目标是 LobeHub 级 Chat Agent 产品完整度；最终所有权仍遵守
Peers-Touch 的 Station 单一真源、Tauri capability kernel 和跨设备边界。

## 2. 已确认产品决策

| ID | 决策 | 状态 | 影响 |
|---|---|---|---|
| V2-D01 | G1 Image Generation 长期不支持 | accepted | 从候选移入 unsupported；不得保留空入口或完成度债务 |
| V2-D02 | G2 Video Generation 与 G1 相同，在 Peers-Touch 中长期 unsupported | accepted | Peers-Touch 不保留视频生成入口或未来阶段债务；如需该能力，由其它项目独立立项并建立自己的产品合同 |
| V2-D03 | P3 Home 深度进入 V2 required scope | accepted | Home 从静态 landing 升级为可执行 Agent 入口 |
| V2-D04 | Tool + MCP + Connector 进入 V2 required scope | accepted | 目标是统一能力平面与真实 Chat 执行闭环，不是重复 CRUD |
| V2-D05 | 独立 Custom Plugin 产品不做 | accepted | X2 继续合并进 Tool/MCP/Connector，不保存独立 endpoint 凭据体系 |
| V2-D06 | 当前 V2 不新增音频生成能力 | accepted | G3b 服务端 TTS 与其他音频生成能力 deferred；已闭环的 G3a 本机朗读保留，但不扩展产品 claim |
| V2-D07 | E1 Evaluation Lab 进入 V2 required scope | accepted | 复用现有 Peers Evaluation UI 与 Station dataset 基础，补齐真实 Agent run、取消、重试、结果、指标和重启读回 |
| V2-D08 | P3 Home Command Center 深度冻结 | accepted | required 包含 pinned/favorite、Station recents、Agent/model readiness、Chat/Task composer、Brief/Needs You、Task 状态、Connector/Tool readiness 与恢复；排除推广、商业推荐、Community、图片/视频 |
| V2-D09 | 平台 claim 复用 MCA 已批准口径 | accepted | Desktop 交付完整产品；Browser 使用同一 Station 业务合同并显式降级设备能力；Mobile 仅要求合同兼容，UI deferred |

## 3. 已关闭产品决策

当前 V2 scope 决策已全部关闭。产品合同 reconciliation、原型 Owner
confirmation 和独立 PRODUCT review 均已通过。

## 4. V2 Capability Profile

| ID | 能力 | 分类 | 用户结果 | 现有基础 | V2 缺口 |
|---|---|---|---|---|---|
| MCA-V2-H01 | Home Command Center（脑图 P3） | required | 从 Home 直接恢复、开始 Chat 或发起 Task，并处理 Needs You/Brief | `HomePage*`、Agent/topic/task stores、Home prototype evidence | Station recents/readiness/Chat+Task composer/Brief/connector 数据和恢复 |
| MCA-V2-T01 | Unified Capability Inventory | required | 清楚看到 Agent 可用 Tool/MCP/Connector 及来源 | Station ToolRegistry、Desktop Tool/MCP stores | 单一 manifest、版本、source、compatibility、readiness |
| MCA-V2-T02 | Agent Capability Binding | required | 按 Agent 启停能力并从 Station 回读 | Agent config、C7 connector binding、MCP/Skill stores | 统一 binding/policy schema 与冲突处理 |
| MCA-V2-T03 | Model/Runtime Compatibility | required | 发送前知道模型是否支持所选能力 | Provider/model metadata、MCA-D05 | admission 前 authoritative snapshot 与 UI degradation |
| MCA-V2-T04 | Governed Tool Loop | required | 理解并审批一次真实执行，看到唯一结果 | ToolCall events、approval action、local broker | durable policy/decision/execution/result lineage |
| MCA-V2-M01 | MCP Lifecycle | required | 安装、配置、测试、连接、调用、取消和恢复 MCP | MCP CRUD/test、Desktop Rust MCP bridge | operation progress、secret boundary、resume/reconnect、真实 invocation |
| MCA-V2-C01 | Connector Lifecycle | required | OAuth 后将 connector tool 用于真实 turn | OAuth2、C7 mount/sync/unmount PROVEN | provider resource→tool manifest→turn invocation→audit |
| MCA-V2-O01 | Tool Observability & Recovery | required | 失败、超时、拒绝、断连后知道下一步 | TurnTrace、ToolCallCard、error recovery | typed retryability、redacted diagnostics、restart/replay proof |
| MCA-V2-E01 | Evaluation Lab（脑图 E1） | required | 用数据集对指定 Agent 发起真实评测，取消或重试 case，并查看可恢复的结果与指标 | `EvaluationPage`、`useEvaluationStore`、Station `EcosystemEvalDataset` 与 CRUD API | 移除 localStorage/`quickCompletion` 假闭环；Station-backed benchmark/test-case/run/result lifecycle |

这些 ID 已进入 accepted V2 产品合同，并已回写
`modern-chat-agent/product-definition.md`、`experience-contract.md`、
`product-state-model.md` 和 `acceptance-matrix.md`。

### 4.1 脑图双向映射与回填合同

`lobehub-parity-mindmap.source.md` 继续是全量能力状态权威源；V2 capability
和 journey 是其产品闭环投影，不得维护成另一套完成度账本。

| V2 capability | 脑图节点 | Journey | Execution phase | Required production Gate |
|---|---|---|---|---|
| MCA-V2-H01 | P3 | V2-J01 | Phase 2 | `agent-v2-home-command-center-e2e` |
| MCA-V2-T01 | R5、C6、C7、X1、X5 | V2-J02 | Phase 3 | `agent-v2-capability-binding-e2e` |
| MCA-V2-T02 | C3、C6、C7、X1、X5 | V2-J02 | Phase 3 | `agent-v2-capability-binding-e2e` |
| MCA-V2-T03 | C1、C2、C4 | V2-J01/J02 | Phase 3 | `agent-v2-home-command-center-e2e` / `agent-v2-capability-binding-e2e` |
| MCA-V2-T04 | R5、R6 | V2-J03 | Phase 6 | `agent-v2-governed-tool-loop-e2e` |
| MCA-V2-M01 | X1、R5、R6 | V2-J04 | Phase 4 | `agent-v2-mcp-lifecycle-e2e` |
| MCA-V2-C01 | C7、R5、R6 | V2-J05 | Phase 5 | `agent-v2-connector-invocation-e2e` |
| MCA-V2-O01 | R4、R5、R6 | V2-J03/J04/J05 | Phase 4/5/6 | `agent-v2-governed-tool-loop-e2e` / lifecycle Gates |
| MCA-V2-E01 | E1 | V2-J06 | Phase 7 | `agent-v2-evaluation-lab-e2e` |

这些 Gate ID 是 required production contract，当前尚未注册或执行，统一为
`UNPROVEN`；PRODUCT 原型不得使其转为 `PROVEN`。

回填规则：

1. capability、journey 或 Phase 状态变化时，同一变更必须更新对应脑图节点。
2. 脑图节点只有获得约定的 Native/Station 产品证据后才能改为 `✅`。
3. 实施发现源码证据或运行证据不成立时，必须先降级脑图状态，再修复。
4. `lobehub-parity-mindmap.svg` 是 source 的同步投影，不得独立维护状态。

## 5. Benchmark Disposition

| Benchmark behavior | Disposition | Peers V2 处理 |
|---|---|---|
| Home floating composer、recent、Agent select | adapt | 保留快速进入工作；使用 Peers Agent readiness 与 Station topic truth |
| Home connector strip | adopt | 显示真实 OAuth/readiness，不用装饰 icon 代替连接状态 |
| Brief/Tasks cards | adapt | 来源必须是 Station Agent Task，不复制商业推荐内容 |
| Unified builtin/plugin/MCP/skill inventory | adapt | 收敛为 Tool/MCP/Connector + Skill/Knowledge 明确边界 |
| Model-aware tool filtering | adopt | RuntimeCapabilitySnapshot 在 admission 前裁决 |
| MCP install/test/cancel/recovery | adopt | Desktop Rust 承担 local boundary，Station 持有 turn/audit truth |
| Manual/allow-list/auto approval | adapt | Station policy + durable decision；不允许 Web 直接执行 |
| Evaluation Lab benchmark/dataset/case/run | adapt | 保留用户可见产品；Station 持有数据集、run、case result 和状态真源，Desktop 只投影与发命令 |
| Custom HTTP plugins with local secrets | reject | 合并 Connector/MCP，凭证不进入 localStorage/chat trace |
| Image generation | reject | 长期 unsupported，不进入产品 claim |
| Video generation | reject | Owner 已确认与 Image Generation 相同，不属于 Peers-Touch；未来只能由其它项目独立立项 |
| Server-side TTS / audio generation | defer | Owner 已确认当前 V2 不做；不影响文本 Chat Agent readiness，G3a 本机朗读维持现状 |

## 6. 关键用户旅程

### V2-J01: 从 Home 恢复或开始工作

1. 用户打开 Home，看到真实 pinned Agents、recents、readiness 和 connector 状态。
2. 用户选择 Agent/model，输入任务并发送。
3. Home 创建或恢复 Station topic，然后进入 Conversation。
4. 重启 Desktop 后，recent/topic/Agent 选择与已接受消息可恢复。
5. loading/error/stale 状态提供 retry，不显示 mock card 作为成功。

### V2-J02: 配置 Agent 的能力

1. 用户在 Agent Profile 查看 Tool/MCP/Connector inventory。
2. 每项显示 source、连接/readiness、模型兼容性、风险和是否绑定。
3. 用户挂载或启用能力，Station 回读确认成功。
4. 冲突、断连或不兼容状态不允许静默保存为 ready。

### V2-J03: 完成一次受治理的 Tool Turn

1. 用户发送需要工具的请求。
2. Timeline 显示 tool proposal、target、authority、arguments summary 和风险。
3. 需要审批时，用户 approve/deny 一次；重复事件不得重复执行。
4. 执行显示 running/result/error/timeout/cancelled。
5. Model 仅在 authoritative result 后继续。
6. 重启或断连后，状态由 Station replay/reconcile 恢复。

### V2-J04: 安装并调用 MCP

1. 用户选择 MCP 来源并查看 manifest/config requirements。
2. 安装/连接测试显示 progress、cancel、typed error 和 retry。
3. Secret 只进入 owning runtime，不进入 Web state、日志或 trace。
4. Agent 绑定 MCP tool 后，在真实 turn 中完成一次调用。
5. MCP 进程/连接断开后，UI 显示 disconnected/recovery，而非 success。

### V2-J05: OAuth Connector 到 Tool Invocation

1. 用户完成 connector OAuth，并看到真实 connected 状态。
2. Connector resources 映射为版本化 tool manifests。
3. 用户将 connector 挂载到 Agent，Station 回读 binding/policy。
4. Agent 在真实 turn 中调用 connector tool。
5. 断连、token expiry、permission denial 和 tool error 均可见可恢复。

### V2-J06: 运行并检查 Agent Evaluation

1. 用户进入 Evaluation Lab，创建或选择 benchmark、dataset 和 test cases。
2. 用户选择目标 Agent，发起使用真实 Agent runtime 的 evaluation run。
3. 页面显示 pending/running/cancelling/completed/failed 状态与逐 case 结果。
4. 用户可取消 run、重试失败 case，并看到 authoritative 状态读回。
5. Desktop 重启后，run、结果、指标与未完成状态从 Station 恢复。

## 7. 范围与非目标

### Required

- Desktop Native 产品闭环；
- Browser Gateway 使用同一 Station 合约的兼容闭环；
- Home、Tool、MCP、Connector、Chat Tool Loop、trace/recovery；
- Evaluation Lab 的 benchmark/dataset/test-case/run/result 产品闭环；
- 对现有 MCP/Tool/Connector 基础进行收口和旧路径删除；
- receiver-perspective Native Acceptance。

### Explicitly Unsupported

- G1 Image Generation；
- G2 Video Generation；
- 独立 Custom Plugins；
- LobeHub Cloud Gateway、商业 Community/Store、托管订阅体系。

### Deferred

- G3b server-side TTS 与其他音频生成能力；
- Mobile UI；
- Multi-Agent Canvas/Groups/Collaboration；
- Marketplace 社交/商业功能。

## 8. Ownership And Architecture Constraints

本计划复用已批准的 MCA-D01–D13，不在执行阶段重新发明边界：

- Station：Agent config、capability policy、turn/tool/action lineage、trace truth；
- Station：Evaluation benchmark、dataset、test case、run、case result 与 metrics truth；
- Desktop Rust：local MCP/device capability、secret boundary、typed execution；
- Desktop Web：projection、配置入口、approval 和 recovery interaction；
- Model proto：跨端 manifest/binding/event/result 契约；
- Home：消费 Agent/topic/task/capability projections，不成为 durable truth；
- Connector：OAuth connection 与 tool manifest 分离；
- MCP：local/cloud transport 与 Agent binding 分离。

禁止：

- Web 直接执行 Tool/MCP；
- Home 持有 topic/task durable truth；
- 可见按钮替代 readiness/connection evidence；
- Connector label 替代 OAuth/token truth；
- localStorage 保存 portable binding、secret 或 execution result；
- localStorage 或 Desktop Web 持有 Evaluation dataset/run/result durable truth；
- screenshot、typecheck 或 aggregate PASS 替代真实 tool execution。

## 9. 实施阶段

### Phase 0 — Product Contract Reconciliation

**Goal**: 冻结 V2 产品 claim，消除现有产品文档矛盾。

Deliverables:

- 修订 `modern-chat-agent/product-definition.md` capability profile；
- 修订 benchmark disposition、journeys、state model、acceptance matrix；
- G1/G2 标为 unsupported；G3b 标为 deferred；
- E1 已进入 required；Home scope 获得 Owner 决策；
- Home、Tool、Evaluation states 的 executable prototype 已获 Owner confirmation。

Gate:

- `PRODUCT_READY_FOR_ARCHITECTURE`；
- prototype Owner confirmation；
- 独立 PRODUCT review 通过。

### Phase 1 — Architecture Contract Reconciliation

**Depends on**: Phase 0.

Deliverables:

- 更新 `modern-chat-agent/design.md`、`decisions.md`、`data-model.md`、
  `integration.md`；
- 定义 unified capability manifest、binding/policy、operation lifecycle、
  connector-tool mapping；
- 定义 Evaluation benchmark/test-case/run/result 与 Agent Turn 的权威关联；
- 明确旧 Tool/MCP/Connector store/API 删除清单；
- 生成正式 dependency DAG 与 atomic cutovers。

Gate:

- `DESIGN_READY_FOR_PLAN`；
- proto-first contract review；
- independent DESIGN review 通过。

### Phase 2 — Home Command Center

**Depends on**: Phase 0–1；可与 Phase 3 的后端合同实现部分并行。

Deliverables:

- Home runtime-owned projections；
- selected Agent/model readiness；
- Station recents/pinned/task/connector readback；
- Home Chat composer→topic promotion；
- Home Task composer→Station Task create/run/handoff；
- Brief/Needs You 与 running task 状态；
- Connector/Tool readiness strip；
- restart/stale/error/retry states；
- 移除 mock Brief/recommendation success path 和推广/Community/Generation 入口。

Gate:

- Native Home first-use/restart Gate；
- Station topic/task readback；
- prototype replica comparison；
- no mock product data in proven path。

### Phase 3 — Unified Capability Plane

**Depends on**: Phase 1.

Deliverables:

- versioned manifest across builtin/Skill/MCP/Connector/local capability；
- authoritative model/runtime compatibility；
- Agent binding and approval policy；
- one runtime projection instead of parallel inventories；
- old localStorage/duplicate binding paths deleted。

Gate:

- manifest/binding contract tests；
- Station readback；
- incompatible model rejects before provider/tool execution。

### Phase 4 — MCP Product Lifecycle

**Depends on**: Phase 3.

Deliverables:

- install/config/test/connect/cancel/retry/reconnect state machine；
- Desktop Rust local MCP owner and secret boundary；
- Agent binding and one real MCP invocation；
- process/connection cleanup and restart recovery；
- redacted diagnostics。

Gate:

- real disposable MCP server Native journey；
- approval/deny/timeout/error/restart cases；
- zero leaked process/port/secret。

### Phase 5 — Connector Tool Lifecycle

**Depends on**: Phase 3.

Deliverables:

- OAuth connection→resource discovery→tool manifest；
- permission/scope/readiness projection；
- Agent binding/policy；
- one real connector tool invocation；
- expiry/disconnect/reconnect/error recovery。

Gate:

- approved disposable OAuth fixture；
- Native mount/invoke/result/unmount；
- Station binding + TurnTrace readback；
- no personal connection auto-selection。

### Phase 6 — Governed Chat Tool Loop

**Depends on**: Phase 3–5.

Deliverables:

- proposal→policy→approval→running→terminal state machine；
- exactly-once approval and execution；
- result returned to model and persisted；
- retry/action lineage；
- replay/reconcile after page switch, disconnect and restart；
- usage/audit/diagnostic detail。

Gate:

- approve、deny、expiry、timeout、cancel、duplicate delivery；
- real Tool/MCP/Connector execution cells；
- immutable turn/call IDs and redacted trace。

### Phase 7 — Evaluation Lab

**Depends on**: Phase 1、3、6。

Deliverables:

- benchmark/dataset/test-case Station CRUD 与 actor isolation；
- target Agent evaluation run 通过真实 Agent runtime 执行；
- pending/running/cancelling/completed/failed 状态机；
- cancel、retry failed case、result 与 metrics readback；
- Desktop restart recovery；
- 删除 localStorage dataset 与 `quickCompletion` evaluation path。

Gate:

- Native create dataset→run→result journey；
- cancel 与 retry case journey；
- Station run/result authoritative readback；
- restart recovery 与 actor isolation。

### Phase 8 — Product Acceptance And Cutover

**Depends on**: Phase 2–7.

Deliverables:

- Capability→Feature→Domain→Registry→Gate contracts；
- Desktop Native full journey bundle；
- Browser Gateway compatibility cells；
- source-bound evidence and cleanup audit；
- old paths deleted；
- product/architecture/tracking docs synchronized。

Gate:

- domain `--require-proven`；
- no aggregate false positive；
- receiver DOM + Station authoritative readback；
- final completion audit against this plan。

## 10. 实施状态

| Phase | 状态 | 完成日期 | 备注 |
|---|---|---|---|
| Phase 0 Product Contract | complete | 2026-08-17 | Owner prototype confirmation 与独立 PRODUCT review 通过 |
| Phase 1 Architecture Contract | complete | 2026-08-17 | D14-D18/C11-C15/A15-A20 reconciliation 与独立 DESIGN review 通过 |
| Execution W0 Contract/Evidence/Gates | complete | 2026-08-18 | Proto-first contracts、external candidate/proof chain、matrix、D11、locale 与七 Gate contracts 完成；产品 Gate 仍 `UNPROVEN` |
| Execution F1 Agent/Conversation Authority | complete | 2026-08-18 | C01/C02 source closure、D11 guard、Desktop full check 与 old-path deletion evidence PASS |
| Execution F2 Runtime/Stream/Capability/Portability | complete | 2026-09-09 | Q4 C06与Q5/C10 source closure完成；Station、Desktop、Rust、Mobile与C03/C05/C06/C10 zero-old-path checks通过；product proof仍由G-F负责 |
| Execution F3 Context/Resource Intelligence | source complete / product proof unproven | — | C04 core与C08 production source、stable Gate、Home Station provisioning和old-path inventory闭合；`agent-attachment-e2e`未运行 |
| Phase 2 Home | pending execution dependencies | — | confirmed prototype 仅证明产品意图；生产能力 `UNPROVEN` |
| Phase 3 Capability Plane | pending | — | 现有 foundations 不等于 product closure |
| Phase 4 MCP | pending | — | 需要真实 disposable MCP |
| Phase 5 Connector | pending | — | C7 lifecycle proof 是基础，不含真实 connector invocation |
| Phase 6 Chat Tool Loop | pending | — | 需依赖统一 manifest/policy |
| Phase 7 Evaluation Lab | pending | — | 现有 UI/Station dataset 是基础，run/result 仍需权威闭环 |
| Phase 8 Acceptance/Cutover | pending | — | 必须 Native + Station readback |

## 11. 验证矩阵

| Claim | Required evidence |
|---|---|
| Home ready | Native quick send、topic promotion、restart recents、error/retry、Station readback |
| Capability ready | versioned manifest、model compatibility、Agent binding readback |
| MCP ready | real server install/test/invoke/cancel/restart/process cleanup |
| Evaluation ready | Native dataset/run/cancel/retry/result、Station readback、restart recovery、actor isolation |
| Connector ready | real OAuth、tool manifest、turn invocation、permission/error recovery |
| Tool loop ready | approve/deny/expiry/timeout/cancel/exactly-once/result-to-model |
| Observable | TurnTrace links source/policy/decision/call/result/duration without secrets |
| Portable | Browser uses same business contracts；Desktop-local ability is explicit |

Minimum deterministic checks:

```bash
./model/build.sh
cd apps/station && go test ./app/subserver/agent/...
cd apps/desktop && pnpm run check
cd apps/desktop && pnpm run test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
make acceptance-validate DOMAIN=agent
python3 tooling/scripts/acceptance-validate.py --domain agent --require-proven
```

这些命令只证明其覆盖的合同。Native journeys、real MCP/OAuth、receiver DOM、
Station readback 和 resource cleanup 必须单独产出 source-bound evidence。

### 11.1 当前证据审计

| Evidence | Source-bound judgment | Current V2 implication |
|---|---|---|
| I1/C6/C7/R9/P2 Native reports | `PROVEN` at ancestor source `76eba9b4…`; current HEAD contains that source but was not rerun after rebase | Historical behavior proof retained；current HEAD regression remains `UNPROVEN` |
| C7 Connector report | mount/sync/unmount `PROVEN`；`enabledToolCount=0` | Real Connector tool invocation remains `UNPROVEN` |
| Debugger post-fix log | 131 post-fix events；0 ErrorBoundary/maximum-depth events | Crash fix has clean historical runtime evidence；debug session remains `OPEN` and cleanup is `UNPROVEN` |
| Debug instrumentation | `ErrorBoundary`、`PageHost`、`appRuntime`、`AgentWorkbench` instrumentation still present | Cleanup cannot be claimed；this PRODUCT-only Goal does not modify production code |
| Legacy Agent reports | Stored under historical `tooling/acceptance/reports/` paths | Placement is noncompliant with current external Evidence Store；do not use as current-framework storage proof |
| V2 Home/Tool/Evaluation prototype | Build PASS；L2 desktop/narrow/light/dark；L3 Task submit, approval→running, evaluation cancel→partial；console 0；no horizontal overflow | Proves intended product behavior only；all production Home/Tool/Evaluation claims remain `UNPROVEN` |

## 12. 风险与缓解

| Risk | Impact | Mitigation |
|---|---|---|
| 复用旧“✅完成”口径 | 把 CRUD/static checks 当产品完成 | 每个 Phase 重新定义 receiver journey 与真实 evidence |
| Home 变成营销 dashboard | 偏离工作入口 | 只保留可执行 Agent/Topic/Task/Capability 数据 |
| Tool inventory 多真源 | readiness 与执行不一致 | Phase 3 atomic cutover 到统一 manifest/binding |
| Web 绕过 Station approval | 安全与审计失效 | policy/decision/execution 全部 Station lineage |
| MCP 进程/secret 泄漏 | 本地安全和资源残留 | Rust owner、redaction、bounded lifecycle、leak canary |
| Connector 使用个人连接 | 验收污染 | 显式 approved fixture ID；禁止任意 connected fallback |
| Prototype 与生产漂移 | UI 返工 | Phase 0 confirmed prototype + replica gate |
| V2 scope 扩成完整 LobeHub | 无法收口 | G1/G2/X2/商业生态明确 unsupported；G3b 明确 deferred |

## 13. 进入实施前必须满足

- [x] V2-Q01 音视频决策：G2 与 G1 相同，在 Peers-Touch 中长期 unsupported；G3b deferred，G3a 保持现状；
- [x] V2-Q02 E1 决策：用户可见 Evaluation Lab 进入 V2 required scope；
- [x] V2-Q03 Home 深度与平台声明确认；
- [x] Modern Chat Agent 产品文档矛盾消除；
- [x] Home/Tool/Evaluation prototype review-ready；
- [x] Independent PRODUCT review prompt 已生成；
- [x] Home/Tool/Evaluation prototype Owner confirmed；
- [x] PRODUCT independent review 通过；
- [x] Architecture amendments accepted；
- [x] 执行计划由 `pt-architecture-execution-methodology` 重新校准 dependency DAG；
- [x] Independent PLAN review 返回 `PLAN_READY_FOR_EXECUTION`；
- [x] Owner 明确批准进入 EXECUTE。

在这些条件满足前，本文件不授权产品代码实施。
