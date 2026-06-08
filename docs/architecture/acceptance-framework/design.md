# Acceptance Framework — 架构设计

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-06-03 | **Updated**: 2026-06-04
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 1. 核心原则

1. **Capability first** — 验收对象是产品能力，不是脚本、页面或测试文件。
2. **Evidence over confidence** — Agent 的判断必须落到可重复 evidence，不能只给主观信心。
3. **Stable gates only** — 临时探针可以帮助诊断，但不能成为完成标准，除非沉淀为 stable gate。
4. **Bounded intelligence** — AI 负责影响分析、解释与风险复盘；流程负责可重复选择、执行和报告。
5. **Truth-source aware** — 验收必须知道能力的事实源，不得把 transport、cache、UI、hint 当成业务真源。

---

## 2. 系统架构

```text
                          ┌────────────────────────────┐
                          │        Product Change       │
                          │ code / proto / docs / gates │
                          └──────────────┬─────────────┘
                                         │ changed paths
                                         ▼
┌──────────────────┐      ┌────────────────────────────┐
│ Feature Contract │◄────►│       Impact Registry       │
│ truth/surface/   │      │ path -> feature -> gates    │
│ negative/gates   │      └──────────────┬─────────────┘
└────────┬─────────┘                     │ selected gates
         │                               ▼
         │                 ┌────────────────────────────┐
         │                 │       Gate Execution        │
         │                 │ local / fedp5 / desktop     │
         │                 └──────────────┬─────────────┘
         │                                │ evidence
         ▼                                ▼
┌──────────────────┐      ┌────────────────────────────┐
│ Capability Graph │─────►│       Evidence Report       │
│ domain capability│      │ proven / unproven / risk    │
│ mutual proof     │      └──────────────┬─────────────┘
└──────────────────┘                     │
                                         ▼
                          ┌────────────────────────────┐
                          │        Human Review         │
                          │ review report, not early QA │
                          └────────────────────────────┘
```

Acceptance Framework 由六层组成：

| 层 | 载体 | 职责 |
|----|------|------|
| Capability Graph | `tooling/acceptance/capabilities/*.yaml` | 定义项目级与领域级产品能力、互验证方向、所需 feature/gate/evidence |
| Domain Profile | `tooling/acceptance/domains/*.yaml` | 定义某个产品域如何作为 acceptance validation domain 被验证 |
| Domain Index | `tooling/acceptance/domains/index.yaml` | 管理项目产品域清单、接入状态、覆盖状态和候选域 |
| Onboarding Templates | `tooling/acceptance/templates/*.yaml` | 为新产品域提供 domain / capability / feature contract 模板 |
| Feature Contract | `tooling/acceptance/features/*.yaml` | 定义事实源、可见面、负向约束和 required gates |
| Impact Mapping | `tooling/acceptance/registry.yaml` | 把变更路径映射到 impacted features 和 selected gates |
| Gate Catalog | `tooling/acceptance/gates.yaml` | 定义稳定 gate 的命令、环境、超时和说明 |
| Gate Implementation | `tooling/acceptance/gates/**/*.py` | 产生可重复 evidence，不承载业务真源 |
| Evidence Report | `tooling/acceptance/reports/*` | 汇总 proven / unproven scope，供人审阅 |

---

## 3. 核心接口

### 3.1 Capability Contract

```json
{
  "id": "federation-operational-observability",
  "domain": "federation",
  "direction": "acceptance_validates_product",
  "features": ["federation-operational-observability"],
  "required_gates": ["station-dashboard-unit", "federation-dashboard-operational-drilldown"],
  "synthetic_paths": [
    "apps/station/app/subserver/dashboard/application/federation_service.go"
  ],
  "evidence": {
    "truth_sources": ["federation_operational_events"],
    "surfaces": ["/dashboard/#/federation"],
    "proven_by": ["federation-dashboard-operational-drilldown"],
    "unproven": ["dashboard-wide alert center"]
  }
}
```

Capability Contract 的职责：

- 明确一个产品能力的验收语义。
- 连接 feature contracts 和 gates。
- 给 `acceptance-plan` 提供 synthetic paths，用来验证 registry 是否能正确命中能力。
- 给 report 提供 proven / unproven scope。

### 3.2 Domain Profile

```json
{
  "id": "federation",
  "capabilities": [
    "acceptance-framework-self-consistency",
    "federation-ledger-convergence",
    "federation-validates-acceptance-framework"
  ],
  "validation_gate_id": "federation-mutual-validation",
  "report": "tooling/acceptance/reports/federation-mutual-validation.json"
}
```

Domain Profile 的职责：

- 选择一个产品域参与项目级 acceptance 验证。
- 引用 capability graph 中已有能力，不重新定义 acceptance core。
- 指定该 domain 的 validation gate id 和报告输出。
- 让 Federation、Chat、Mobile、Applet 以后能以相同模型接入。

### 3.3 Domain Index

```json
{
  "id": "chat",
  "status": "planned",
  "profile": "",
  "capabilities": "",
  "coverage": "not_onboarded",
  "notes": "Needs feature contracts for chat service and realtime delivery."
}
```

Domain Index 的职责：

- 统一列出项目级 product domains。
- 区分 `active`、`candidate`、`planned`、`deprecated`。
- 告诉 `make acceptance-validate` 在 project-level 模式下验证哪些 active domains。
- 给 `make acceptance-coverage-report` 提供覆盖报告输入。

### 3.4 Feature Contract

```json
{
  "id": "federation-ledger",
  "truth_sources": ["federation_ledger_events"],
  "required_gates": ["proto-build", "station-federation-unit", "federation-three-node-e2e"],
  "acceptance": {
    "service": ["three-node testnet converges to one head"]
  },
  "negative": ["proposals must not advance ledger head"]
}
```

Feature Contract 的职责：

- 绑定业务事实源。
- 列出可验证行为和负向约束。
- 声明 required gates。
- 不做路径匹配；路径匹配属于 registry。

### 3.5 Gate Contract

```json
{
  "command": "python3 tooling/acceptance/gates/dashboard/federation_operational_drilldown.py",
  "timeout_seconds": 600,
  "environment": "fedp5",
  "description": "Validate Federation operations drilldown API and Dashboard visible-surface sections."
}
```

Gate Contract 的职责：

- 提供稳定命令。
- 指明运行环境。
- 输出 log 和结构化 run result。
- 不声明业务完成标准；业务完成标准由 feature/capability contract 解释。

---

## 4. 组件关系

### 4.1 Agent 与框架

Agent 允许做：

- 读取当前 diff 和 registry，解释为什么 gates 被选中。
- 读取 capability graph，说明哪些能力被证明。
- 在 gate 失败时做有限 probe。
- 把有价值 probe 沉淀为 stable gate。

Agent 不允许做：

- 用临场判断替代 required gate。
- 把未运行的 gate 说成已证明。
- 把 smoke / screenshot artifact 说成完整 UI E2E。
- 把 discovery hint、event stream、notification、cache 当成治理真源。

### 4.2 Domain 类型

Acceptance Framework 支持两类产品域：

| 类型 | 含义 | 当前实例 |
|------|------|----------|
| `project_validation_domain` | 既被 acceptance 验证，也反向证明 acceptance 能表达复杂产品域 | Federation |
| `managed_domain` | 被 acceptance 统筹管理，但不承担框架自证职责 | Station Dashboard, Chat |

两类 domain 都必须拥有 domain profile、capability file、feature contracts、registry rules、gate catalog entries 和 report；区别在于 `project_validation_domain` 可以有产品域反向证明 capability，而 `managed_domain` 只能证明自身产品能力。

Station Dashboard 是第一个 managed domain。它验证普通产品域能按同一 onboarding 标准接入项目级 acceptance，而不复制 Federation ledger、testnet、Desktop gateway 等特殊语义。Chat 是第三个 active domain，也是第二个 managed domain，用来验证 acceptance 能覆盖更接近用户主路径的消息能力。

### 4.3 Federation 双边互验证

Federation 是 Acceptance Framework 的首个复杂验证域：

| 方向 | 含义 | 证明方式 |
|------|------|----------|
| Acceptance → Federation | 框架证明 Federation 主能力未退化 | registry 选 gate，fedp5 gates 运行，通过 reports 输出 |
| Federation → Acceptance | Federation 作为 validation domain 证明框架足够表达复杂产品域 | `tooling/acceptance/domains/federation.yaml` 选择 capability graph 中的 Federation 能力，通用 validator 检查闭环 |

互验证不是一个单独脚本完成，而是由 capability graph、feature contracts、registry、gates、run results、reports 共同形成。

### 4.4 Station Dashboard managed domain

Station Dashboard managed domain 的边界：

- 事实源来自 Station runtime repositories 和 Dashboard read-only service projections。
- Dashboard 是管理面 projection，不成为业务事实源。
- Auth、layout、overview、system、nodes、storage、security 等核心页面由 `station-dashboard-auth` 与 `station-dashboard-operations` feature contracts 管理。
- 当前 stable gates 是 `station-dashboard-unit` 与 `station-dashboard-web-check`；浏览器级完整 Dashboard visible-surface gate 仍为 unproven scope。

该 domain 的目标不是验证 Federation，而是证明 acceptance 可以管理普通产品域：

```text
apps/station/app/subserver/dashboard/**
          │
          ▼
tooling/acceptance/registry.yaml
          │
          ▼
station-dashboard-auth / station-dashboard-operations
          │
          ▼
station-dashboard-admin-access / station-dashboard-operator-surface
          │
          ▼
station-dashboard-unit + station-dashboard-web-check
          │
          ▼
tooling/acceptance/reports/station-dashboard-validation.json
```

### 4.5 报告语义

### 4.5 Chat managed domain

Chat managed domain 的边界：

- 事实源来自 `model/domain/chat/*.proto`、`friend_chat` 持久化表、Station friend_chat service/repository，以及 Desktop chat store 对 Station API 的 typed contract。
- Realtime / SSE 是 delivery contract，不是 message persistence truth。
- Desktop typed surface 只能证明页面、store、service API 的编译期契约，不能替代 DOM 级可见性或 live realtime DOM event-consumption proof。
- 当前 stable gates 是 `proto-build`、`station-chat-unit`、`chat-runtime-e2e`、`chat-live-realtime-e2e` 和 `desktop-check`；`chat-desktop-gateway-e2e` 是 optional app-runtime gate，证明 desktop-rust BFF；`chat-desktop-dom-message-visible` 是 optional app-runtime gate，证明 scoped sync 后 Desktop renderer DOM 可见性；两者都不能替代 live realtime DOM event-consumption、双 Desktop client、离线恢复或跨 home Station realtime proof。

该 domain 的目标是反思并验证设计落地：acceptance 不能只覆盖管理面和 Federation，还必须能表达高频用户路径的事实源、传输面、可见面和未证明范围。

```text
model/domain/chat/** + apps/station/app/subserver/friend_chat/** + apps/desktop/src/**chat**
          │
          ▼
tooling/acceptance/registry.yaml
          │
          ▼
chat-service-contract / chat-runtime-message-flow / chat-live-realtime-delivery / chat-desktop-gateway-message-flow / chat-desktop-dom-message-visible / chat-realtime-delivery / desktop-chat-surface
          │
          ▼
chat-proto-service-contract / chat-runtime-message-flow / chat-live-realtime-delivery / chat-realtime-contract / desktop-chat-typed-surface / chat-desktop-dom-message-visible
          │
          ▼
proto-build + station-chat-unit + chat-runtime-e2e + chat-live-realtime-e2e + desktop-check (+ optional chat-desktop-gateway-e2e / chat-desktop-dom-message-visible)
          │
          ▼
tooling/acceptance/reports/chat-validation.json
```

### 4.6 报告语义

报告必须区分：

- **Proven**：required gates 已运行并通过。
- **Partially proven**：gateway/smoke 证明了入口或表面，但未证明完整 DOM / 行为闭环。
- **Unproven**：当前无 stable gate 或 gate 未运行。
- **Risk**：能力可能成立但缺少 evidence，必须显式交给人审。

---

## 5. 端点 / API

Acceptance Framework 不对外提供 HTTP API。它的稳定入口是 Make targets：

```bash
make acceptance-plan
make acceptance-run
make acceptance-report
make acceptance-validate
make acceptance-validate DOMAIN=chat
make acceptance-validate DOMAIN=federation
make acceptance-validate DOMAIN=station-dashboard
make acceptance-coverage-report
make acceptance-chat-domain-validation
make acceptance-station-dashboard-domain-validation
make acceptance-federation-report
make acceptance-federation-mutual-validation
```

其中 `acceptance-validate` 是项目级 domain validation 入口；不传 `DOMAIN` 时验证 `tooling/acceptance/domains/index.yaml` 中所有 active domains。`acceptance-validate DOMAIN=<domain>` 验证单个 domain profile。默认模式验证结构自洽；加 `--require-proven` 时要求 latest run results 证明 required gates 已通过。它必须证明：

- capability graph 自洽。
- domain profile 引用的 capabilities 存在。
- feature contracts 引用存在。
- required gates 在 gate catalog 中存在。
- synthetic paths 能通过 registry 命中期望 gates。
- 在 `--require-proven` 模式下，最近 run results 中该 domain 的 required gates 通过。
- report 能输出 proven / unproven scope。

`acceptance-federation-mutual-validation` 只是 Federation domain 的兼容 alias，不是 acceptance core。

`acceptance-chat-domain-validation` 运行 Chat managed-domain gates，然后要求该 domain 的 latest evidence 通过；它验证 chat service、Station runtime API message flow、Station live realtime stream delivery、realtime typed contract、Desktop typed surface，以及在显式 app-runtime 环境下的 Desktop DOM synced-message visibility；它不宣称 live realtime DOM event consumption、双 Desktop client 或完整消息 UI E2E。

`acceptance-station-dashboard-domain-validation` 运行 Station Dashboard managed-domain gates，然后要求该 domain 的 latest evidence 通过；它不验证 Federation，也不承担 acceptance core 自证。

`acceptance-coverage-report` 输出项目域接入覆盖状态，用来回答哪些 domain 已纳入 acceptance 管理、哪些仍未接入。
