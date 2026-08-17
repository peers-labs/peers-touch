# Modern Chat Agent V2 — 产品级迭代计划

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-08-17 | **Updated**: 2026-08-17
> **Owner**: Peers-Touch Agent Team
> **Plan type**: PRODUCT → DESIGN → PLAN（讨论稿，未授权实施）
> **Predecessor**: `20260816-lobehub-parity-full-landing.md`
> **Governing product**: `../modern-chat-agent/`
> **Benchmark evidence**: `../lobehub-feature-topology.md`、`../lobehub-parity/`

---

## Context Anchor

| Field | Current value |
|---|---|
| Main task | 将 Peers-Touch 单 Agent Chat 从源码能力对齐推进到 LobeHub 级产品体验与运行可靠性 |
| Plan source | `docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2.md` |
| Tracking source | `docs/architecture/agent/modern-chat-agent/`、`docs/architecture/agent/lobehub-parity-mindmap.source.md` |
| Worktree | `<repo-root>` |
| Branch | `feat/p0-streaming-runtime-message-actions` |
| Stage | `PRODUCT` |
| Current workstream | V2-P0 Product Contract Reconciliation |
| Current step | 评审并冻结 Home、Tool/MCP/Connector、G3b、E1 的 V2 产品边界 |
| Progress | 0/8 phases；前序计划 16/16 源码闭环、Native 5/5 PROVEN |
| Last completed | `20260816-lobehub-parity-full-landing.md` 实现与 Native proof 完成；debugger cleanup 仍待显式确认 |
| Current action | 落盘 V2 产品迭代讨论稿，防止把新范围追加到已完成的旧计划 |
| Next action | Owner 评审本计划的产品范围与待决策项；通过后修订 Modern Chat Agent 产品合同 |
| Blockers | PRODUCT scope 未确认；Home 原型未 confirmed；旧 debugger cleanup 未完成 |
| Decisions required | G3b 是否长期不支持；E1 是否仅作内部质量能力；Home 是否包含 Brief/Tasks；Desktop-first 的 Browser/Mobile 声明范围 |
| Evidence | 当前 45 节点：39 aligned、3 candidate、3 rejected/merged（待本计划同步）；Agent Native Acceptance 5/5 PROVEN |
| Last updated | 2026-08-17 10:00 CST |

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
| V2-D02 | G2 Video Generation 长期不支持 | accepted | 从候选移入 unsupported；不得以 benchmark 缺口阻塞 Chat Agent |
| V2-D03 | P3 Home 深度进入 V2 required scope | accepted | Home 从静态 landing 升级为可执行 Agent 入口 |
| V2-D04 | Tool + MCP + Connector 进入 V2 required scope | accepted | 目标是统一能力平面与真实 Chat 执行闭环，不是重复 CRUD |
| V2-D05 | 独立 Custom Plugin 产品不做 | accepted | X2 继续合并进 Tool/MCP/Connector，不保存独立 endpoint 凭据体系 |

## 3. 待确认产品决策

### V2-Q01: G3b 服务端 TTS

G3b 指由 Station 或受管 TTS Provider 生成音频字节/文件并持久化，而不是当前
Desktop Web `speechSynthesis` 的本机临时朗读。

它解决：

- 跨设备使用同一音频和声音；
- 重播、下载、转发或作为消息附件；
- Provider voice/model、时长、失败和用量可追踪；
- 后台生成和 durable readback。

当前 Chat Agent 已有 G3a 客户端朗读。**建议 V2 不实现 G3b**，除非产品明确
承诺“语音回答/音频消息/跨设备重播”；纯文本 Chat Agent 达到 LobeHub 级别
不依赖服务端 TTS。

### V2-Q02: E1 Evaluation

建议不做独立用户可见 Evaluation 产品页；保留为内部 Acceptance/quality
能力，为 Home 与 Tool loop 提供固定 case、回归和证据。若以后要做评测产品，
应独立立项，不混入 V2 Chat Agent。

### V2-Q03: Home 的产品深度

建议 V2 Home 是“Agent Command Center”，required scope 包含：

- pinned/favorite Agents；
- recent topics 与 restart readback；
- selected Agent/model readiness；
- 快速输入并创建真实 topic；
- Connector connection/status strip；
- 基于 Station Agent Task 的 Brief/Tasks 摘要；
- actionable loading/error/retry/empty states。

不建议复制 LobeHub 的 model recommendation 广告、Community、Generation
入口或商业推荐卡。

## 4. V2 Capability Profile（Draft）

| ID | 能力 | 分类 | 用户结果 | 现有基础 | V2 缺口 |
|---|---|---|---|---|---|
| MCA-V2-H01 | Home Command Center | required | 从 Home 直接恢复或开始 Agent 工作 | `HomePage*`、Agent/topic stores、Home prototype evidence | 真实 recents/readiness/send/task/connector 数据和恢复 |
| MCA-V2-T01 | Unified Capability Inventory | required | 清楚看到 Agent 可用 Tool/MCP/Connector 及来源 | Station ToolRegistry、Desktop Tool/MCP stores | 单一 manifest、版本、source、compatibility、readiness |
| MCA-V2-T02 | Agent Capability Binding | required | 按 Agent 启停能力并从 Station 回读 | Agent config、C7 connector binding、MCP/Skill stores | 统一 binding/policy schema 与冲突处理 |
| MCA-V2-T03 | Model/Runtime Compatibility | required | 发送前知道模型是否支持所选能力 | Provider/model metadata、MCA-D05 | admission 前 authoritative snapshot 与 UI degradation |
| MCA-V2-T04 | Governed Tool Loop | required | 理解并审批一次真实执行，看到唯一结果 | ToolCall events、approval action、local broker | durable policy/decision/execution/result lineage |
| MCA-V2-M01 | MCP Lifecycle | required | 安装、配置、测试、连接、调用、取消和恢复 MCP | MCP CRUD/test、Desktop Rust MCP bridge | operation progress、secret boundary、resume/reconnect、真实 invocation |
| MCA-V2-C01 | Connector Lifecycle | required | OAuth 后将 connector tool 用于真实 turn | OAuth2、C7 mount/sync/unmount PROVEN | provider resource→tool manifest→turn invocation→audit |
| MCA-V2-O01 | Tool Observability & Recovery | required | 失败、超时、拒绝、断连后知道下一步 | TurnTrace、ToolCallCard、error recovery | typed retryability、redacted diagnostics、restart/replay proof |

这些 ID 是 V2 产品合同草案。Owner 确认后需要回写
`modern-chat-agent/product-definition.md`、`experience-contract.md`、
`product-state-model.md` 和 `acceptance-matrix.md`。

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
| Custom HTTP plugins with local secrets | reject | 合并 Connector/MCP，凭证不进入 localStorage/chat trace |
| Image/Video generation | reject | 长期 unsupported，不进入 V2 claim |
| Server-side TTS | defer/reject pending V2-Q01 | 不影响文本 Chat Agent readiness |

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

## 7. 范围与非目标

### Required

- Desktop Native 产品闭环；
- Browser Gateway 使用同一 Station 合约的兼容闭环；
- Home、Tool、MCP、Connector、Chat Tool Loop、trace/recovery；
- 对现有 MCP/Tool/Connector 基础进行收口和旧路径删除；
- receiver-perspective Native Acceptance。

### Explicitly Unsupported

- G1 Image Generation；
- G2 Video Generation；
- 独立 Custom Plugins；
- LobeHub Cloud Gateway、商业 Community/Store、托管订阅体系。

### Deferred

- G3b server-side TTS（待 V2-Q01）；
- E1 用户可见 Evaluation 产品；
- Mobile UI；
- Multi-Agent Canvas/Groups/Collaboration；
- Marketplace 社交/商业功能。

## 8. Ownership And Architecture Constraints

本计划复用已批准的 MCA-D01–D13，不在执行阶段重新发明边界：

- Station：Agent config、capability policy、turn/tool/action lineage、trace truth；
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
- screenshot、typecheck 或 aggregate PASS 替代真实 tool execution。

## 9. 实施阶段

### Phase 0 — Product Contract Reconciliation

**Goal**: 冻结 V2 产品 claim，消除现有产品文档矛盾。

Deliverables:

- 修订 `modern-chat-agent/product-definition.md` capability profile；
- 修订 benchmark disposition、journeys、state model、acceptance matrix；
- G1/G2 标为 unsupported；
- G3b/E1/Home scope 获得 Owner 决策；
- Home 与 Tool states 的 executable prototype 进入 `confirmed`。

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
- Home quick send→topic promotion；
- restart/stale/error/retry states；
- 移除 mock Brief/recommendation success path。

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

### Phase 7 — Product Acceptance And Cutover

**Depends on**: Phase 2–6.

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
| Phase 0 Product Contract | draft / review required | — | 当前讨论阶段 |
| Phase 1 Architecture Contract | blocked by Phase 0 | — | 不得提前写实现 |
| Phase 2 Home | pending | — | prototype 已有历史 evidence，未 confirmed |
| Phase 3 Capability Plane | pending | — | 现有 foundations 不等于 product closure |
| Phase 4 MCP | pending | — | 需要真实 disposable MCP |
| Phase 5 Connector | pending | — | C7 lifecycle proof 是基础，不含真实 connector invocation |
| Phase 6 Chat Tool Loop | pending | — | 需依赖统一 manifest/policy |
| Phase 7 Acceptance/Cutover | pending | — | 必须 Native + Station readback |

## 11. 验证矩阵

| Claim | Required evidence |
|---|---|
| Home ready | Native quick send、topic promotion、restart recents、error/retry、Station readback |
| Capability ready | versioned manifest、model compatibility、Agent binding readback |
| MCP ready | real server install/test/invoke/cancel/restart/process cleanup |
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
| V2 scope 扩成完整 LobeHub | 无法收口 | G1/G2/X2/商业生态明确 unsupported |

## 13. 进入实施前必须满足

- [ ] V2-Q01 G3b 决策；
- [ ] V2-Q02 E1 决策；
- [ ] V2-Q03 Home 深度确认；
- [ ] Modern Chat Agent 产品文档矛盾消除；
- [ ] Home/Tool prototype confirmed；
- [ ] PRODUCT independent review 通过；
- [ ] Architecture amendments accepted；
- [ ] 执行计划由 `pt-architecture-execution-methodology` 重新校准 dependency DAG；
- [ ] Owner 明确批准从 PRODUCT/DESIGN 进入 EXECUTE。

在这些条件满足前，本文件不授权产品代码实施。
