# Acceptance Framework — 设计决策

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-06-03 | **Updated**: 2026-08-16
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| D-01 | Capability Graph 是验收架构的一等模型 | accepted |
| D-02 | Registry 只做路径影响映射，不承载业务语义 | accepted |
| D-03 | Federation 作为首个双边互验证域 | accepted |
| D-04 | Agent 智能必须受 stable gates 和 reports 约束 | accepted |
| D-05 | Station Dashboard 作为首个 managed domain | accepted |
| D-06 | Chat 作为首个用户主路径 managed domain | accepted |
| D-07 | Environment Provisioning 是 Gate 之前的独立运行时边界 | proposed |
| D-08 | Attestation、Actor Fixture 与 Credential 各有唯一生产 Owner | proposed |
| D-09 | Registry 按产品行为选择 receiver-proof Gate | proposed |
| D-10 | Gap Detector 作为跨阶段只读守卫 | proposed |

---

## D-01: Capability Graph 是验收架构的一等模型

**Status**: accepted
**Date**: 2026-06-03

### Context

仅靠 `features/*.yaml` 和 `registry.yaml` 可以回答“改了路径 X 要跑哪些 gates”，但不能回答“产品能力 Y 是否完整被证明”。这会导致验收框架退化成脚本集合。

### Decision

新增 `tooling/acceptance/capabilities/*.yaml` 作为 Capability Graph，明确 capability、feature contracts、required gates、synthetic paths、evidence 和 unproven scope 的关系；新增 `tooling/acceptance/domains/*.yaml` 作为产品域 profile，选择哪个产品域参与 acceptance 有效性验证。

### Rationale

Capability Graph 让验收架构从路径触发上升为产品能力证明。它也允许 agent 在不扩散推理边界的情况下解释能力覆盖和风险。

### Alternatives Considered

- 只扩展 `features/*.yaml`：会让单个 feature contract 同时承载能力图、路径映射和报告语义，职责过载。
- 只写 `mutual_validation.py`：脚本会隐式承载架构语义，维护性差。

### Consequences

- Acceptance Framework 多一个机器可读文件，但职责更清晰。
- 后续其它产品域可以复用 capability graph，而不是复制 Federation 专用逻辑。

---

## D-02: Registry 只做路径影响映射，不承载业务语义

**Status**: accepted
**Date**: 2026-06-03

### Context

`tooling/acceptance/registry.yaml` 当前负责从 changed paths 选择 gates。若继续把 truth source、visible surface、negative constraint 塞入 registry，会让 registry 变成混合业务模型。

### Decision

Registry 保持单一职责：`paths -> features -> gates`。业务语义由 feature contract 和 capability graph 表达。

### Rationale

路径映射变化频繁，业务能力语义更稳定。分离后，调整目录结构不会破坏能力定义，调整能力边界也不会污染 path rule。

### Alternatives Considered

- 在 registry rule 中直接增加 `truth_sources` 和 `unproven`：短期方便，长期难维护。

### Consequences

- mutual validation 必须同时读取 registry、features、capabilities、gates。
- 报告可明确区分“为什么选 gate”和“gate 证明了什么”。

---

## D-03: Federation 作为首个双边互验证域

**Status**: accepted
**Date**: 2026-06-03

### Context

Acceptance Framework 需要一个真实复杂产品域验证自己是否有用。简单页面或单包测试无法证明跨运行时、跨事实源、跨环境的验收能力。

### Decision

选择 Federation 作为首个 validation domain。Federation 跨 Station、Dashboard、Desktop gateway、testnet、ledger、discovery、operational events，能有效暴露框架缺口；但 Federation 只能作为 domain profile 接入，不能持有 acceptance core。

### Rationale

Federation 已具备：

- Proto-first contracts。
- Station governance truth。
- Dashboard read-only projection。
- Desktop surface / gateway。
- isolated `fedp5` 三节点环境。
- acceptance gates 和 capability report 初始闭环。

### Alternatives Considered

- Chat：用户路径成熟，但已有运行时复杂性可能掩盖 acceptance 框架问题。
- Applet：跨端价值高，但当前不是 Federation 工作主线。
- Dashboard 单页：太简单，不能证明跨系统能力。

### Consequences

- Federation gates 必须保持高质量，因为它们同时验证产品和框架有效性。
- Acceptance core 必须保持 domain-neutral；新增 Chat / Mobile / Applet profile 时不得复制 Federation 专用逻辑。
- 未证明范围必须严格标注，不能因为 Federation 是样板域就夸大覆盖。

---

## D-04: Agent 智能必须受 stable gates 和 reports 约束

**Status**: accepted
**Date**: 2026-06-03

### Context

AI agent 时代，测试可以更智能，但如果没有流程边界，agent 会过度依赖临场推理，导致验证不可复现。

### Decision

Agent 负责规划、解释、诊断、沉淀；stable gates 负责证明；reports 负责交付给人审。没有 gate evidence 的能力不得标为 proven。

### Rationale

这平衡了智能化和流程化：agent 可以灵活应对新功能，但最终交付必须落到可重复证据。

### Alternatives Considered

- 完全固定流水线：稳定但无法理解新能力。
- 完全 agent 自由测试：灵活但不可审计。

### Consequences

- 新能力必须补 feature contract 和 capability entry。
- 临时 probe 有预算限制，并应优先沉淀为 stable gate。

---

## D-05: Station Dashboard 作为首个 managed domain

**Status**: accepted
**Date**: 2026-06-04

### Context

Federation 已经证明 Acceptance Framework 可以表达复杂跨运行时产品域，但如果只有 Federation 一个 active domain，框架仍可能被误解为 Federation 专用流程。

项目需要一个更普通、更轻量、但仍有后端服务和用户可见管理面的产品域，验证 domain onboarding 模型可以泛化。

### Decision

将 `station-dashboard` 从 `candidate` 升级为 `active` managed domain。它拥有独立 domain profile、capability file、feature contracts、registry rules 和 gates，但不包含 `product_domain_validates_acceptance` 能力。

### Rationale

Station Dashboard 具备以下特征：

- 它是 Station 管理面，不是 Federation ledger 或 testnet 特例。
- 它有 Go backend、web bundle、auth、layout 和多个管理页面。
- 它可以用本地 stable gates 产生基础 evidence，适合作为普通产品域接入样板。

### Alternatives Considered

- 继续只维护 Federation domain：会强化框架与 Federation 的耦合风险。
- 直接接入 Chat：Chat 更接近用户主路径，但 runtime/realtime/persistence 范围较大，不适合作为第二个 onboarding 校准点。
- 直接接入 Mobile：设备和模拟器边界更复杂，应等 managed domain 模型稳定后再接入。

### Consequences

- `tooling/acceptance/domains/index.yaml` 现在同时包含 `project_validation_domain` 和 `managed_domain`。
- Station Dashboard 变更会通过 registry 选择 `station-dashboard-unit` 和 `station-dashboard-web-check`。
- Federation 继续是框架有效性验证域；Station Dashboard 只证明自身管理面能力。

---

## D-06: Chat 作为首个用户主路径 managed domain

**Status**: accepted
**Date**: 2026-06-04

### Context

Station Dashboard 证明了普通管理面可以接入 acceptance，但它仍偏运维视角。项目还需要一个更接近用户日常路径的 domain，检验 acceptance 是否能表达消息事实源、实时传输、Desktop 可见面和未证明范围。

### Decision

将 `chat` 从 `planned` 升级为 active `managed_domain`。Chat domain 覆盖 Station、realtime、Desktop typed surface 和 Desktop DOM visibility 能力，并保留 app-runtime optional evidence：

- `chat-proto-service-contract`：Proto-first 和 Station messaging/conversation/envelope contracts。
- `chat-desktop-gateway-message-flow`：运行中 Desktop HTTP gateway 上的 actor auth、key publication、direct conversation、E2EE send、hydrate 与 decrypt。
- `chat-realtime-contract`：Station per-device queue / envelope 与 Desktop messaging lifecycle 的 typed contract。
- `desktop-chat-typed-surface`：Desktop chat page/components/store 的 typed visible-surface contract。
- `chat-native-visible-clients`：真实 native Desktop 的 two-client、multi-device、recovery 与 MLS 用户路径。

### Rationale

Chat 同时具备事实源、传输面和用户可见面，适合验证 acceptance 是否能管理高频用户路径。Station-direct plaintext-shaped gates cannot prove the client-owned E2EE path, so they are removed instead of translated into a second transport. Gateway and native gates preserve the actual ownership boundary.

### Alternatives Considered

- 直接做完整 Chat E2E：会把环境、账号、双客户端、realtime 和 UI 自动化一次性耦合，容易变成功能堆叠。
- 先接入 Mobile：设备和 native plugin 边界更复杂，不适合作为 Chat 之前的泛化验证。

### Consequences

- Chat 变更会通过 registry 自动选择 `proto-build`、`station-messaging-unit`、`messaging-platform-contract`、`chat-desktop-gateway-e2e`、native gates 和 / 或 `desktop-check`。
- Acceptance coverage report 现在能显示三个 active domains：Federation、Station Dashboard、Chat。
- Chat 的未证明范围必须保持显式，不能用 typed checks 或 Desktop gateway command E2E 代替 native multi-client 用户消息收发体验。

---

## D-07: Environment Provisioning 是 Gate 之前的独立运行时边界

**Status**: accepted
**Date**: 2026-08-16 | **Accepted**: 2026-08-16

### Context

当前 Gate Catalog 声明 `environment`，但环境准备依赖 Agent 手工拼接 Profile、
Station、Desktop、端口、Fixture 和环境变量。Gateway Gate 在服务未启动时只得到
connection refused；Native Gate 能校验输入，却无法告诉新 Agent 如何生产输入。

### Decision

在 Gate Runner 与产品 Gate 之间建立独立 Environment Provisioning 边界：

```text
plan -> provisioner -> runtime manifest -> gate -> evidence -> cleanup
```

Gate 不自启动环境。Provisioner 根据 environment contract 准备资源、输出不可变
runtime manifest，并在缺项时生成结构化 `BLOCKED/UNPROVEN` artifact。

### Rationale

环境生命周期与产品断言是不同职责。独立 Provisioner 既保持 Gate 纯粹，也让
`make acceptance-*` 能形成规范、可发现、可重复的执行路径。

### Alternatives Considered

- Gate 内直接 `make desktop`：混合环境生命周期和产品断言，失败清理不可控。
- 保持调用方手工准备：依赖上下文记忆，新 Agent 无法稳定复现。
- 遇到缺项后降级到 static/browser/API：不产生同等级产品证据。

### Consequences

- 非 `local` environment 必须有机器可读 provisioning contract。
- `acceptance-run` 需要区分 provisioning failure 与 product Gate failure。
- Provisioning 成功本身不能把产品能力标记为 `PROVEN`。
- Provisioner 引入新的 cleanup 责任和结构化 preflight artifact。

### Review / Reversal Trigger

若实现证明 Environment Provisioner 无法在不持有产品断言的前提下统一
`local-desktop-gateway`、`home-station` 和 `fedp5`，应重新评审 contract 粒度；
不得退回 Agent 手工拼接。

---

## D-08: Attestation、Actor Fixture 与 Credential 各有唯一生产 Owner

**Status**: accepted
**Date**: 2026-08-16 | **Accepted**: 2026-08-16

### Context

Chat Native runner 当前消费 Station attestation、canonical PTID 和密码，但没有
权威生成、发现或注入流程。默认值和人工复制会破坏 source identity 与证据可信度。

### Decision

- Station deployment/runtime owner 生产 deployment attestation，并与 live metadata 校验。
- Domain Fixture 生产 actor manifest，负责账号、canonical PTID、初始状态和 reset。
- Profile 或批准的 secret source 生产 credential reference；manifest 只记录引用。
- Gate 只消费这些 artifact，不生成、不猜测、不硬编码。

### Rationale

生产者和验证者必须分离。Gate 自己生产 attestation 或 actor identity 会形成自证，
而凭据进入 manifest 会造成泄露风险。

### Alternatives Considered

- 在 runner 中硬编码 Station、PTID 和密码：不可移植且违反安全边界。
- Agent 临时查询后 export：不可审计，无法证明输入 freshness。
- 将密码写入 actor manifest：降低操作成本但扩大证据泄露面。

### Consequences

- Fixture 输出必须脱敏且可重复。
- Attestation 必须绑定实际部署，而不是只绑定本地 git HEAD。
- 缺少生产 artifact 时 Gate 保持 `UNPROVEN`。

### Review / Reversal Trigger

若 Station runtime 无法提供可核验 live commit 或 proto identity，应先设计新的
runtime identity endpoint；不得由 Gate 自行签发或伪造 attestation。

---

## D-09: Registry 按产品行为选择 receiver-proof Gate

**Status**: accepted
**Date**: 2026-08-16 | **Accepted**: 2026-08-16

### Context

`apps/desktop/src-tauri/src/messaging/**` 当前只选择 Gateway E2E。Direct receipt
状态虽然属于 Native receiver-visible 行为，但 receipt 代码变更不会自动选择
`chat-native-two-client-e2e`。

### Decision

Registry 保留目录级 cheap Gate 规则，并为 receiver-visible 状态转换增加更窄的
behavior rule。Feature Contract 决定需要哪类 proof，Registry 只把相关源路径映射
到该 Feature 和 Gate。

### Rationale

目录所有权不能完整表达行为影响。更窄的规则避免所有 messaging 改动都运行全部 W8
journeys，同时确保 receipt、badge、projection 等用户可见状态不会只跑 API Gate。

### Alternatives Considered

- 所有 messaging 变更运行全部 Native Gates：覆盖充分但成本失控。
- 继续只运行 Gateway Gate：无法证明 Native sender receipt projection。
- 由 Agent 看到任务描述后手工追加 Gate：不可发现、不可重复。

### Consequences

- 关键 behavior rule 必须有 synthetic path plan test。
- Feature source paths 与 Registry rules 必须同步审计。
- 新 receiver-visible 状态需要显式登记，不能依赖 broad directory rule。

### Review / Reversal Trigger

若 behavior rule 数量导致 Registry 无法维护，应引入机器可读 assertion ownership
映射；不得退回“Agent 根据任务描述手工选 Gate”。

---

## D-10: Gap Detector 作为跨阶段只读守卫

**Status**: accepted
**Date**: 2026-08-16 | **Accepted**: 2026-08-16

### Context

`pt-acceptance-engineering` 在明确收到 Acceptance 请求时能够生成 gap matrix，但普通
产品任务可能在 completion、commit 或 PR 阶段才暴露 Acceptance 遗漏。若没有独立
触发面，Agent 可能用 build、unit test 或手工检查替代缺失的产品证据。

### Decision

新增 `pt-acceptance-gap-detector`，职责严格限定为：

- 在完成、质量、提交和 PR 声明前只读检查 Acceptance ownership 与 evidence。
- 输出结构化 gap、proof state、责任 stage 和最小 closure。
- 发现真实缺口后调用 `pt-acceptance-engineering`。

它不实现 Gate、不修改产品或 Acceptance、不做 completion audit，也不自行批准继续。

### Rationale

Gap detection 与 Acceptance engineering 是不同触发面：前者防止遗漏和 silent pass，
后者负责补齐与升级。分离后可覆盖没有显式提出 Acceptance 的普通开发任务。

### Alternatives Considered

- 只扩展 `pt-acceptance-engineering`：普通任务未必触发该 Skill。
- 只依赖 `pt-completion-auditor`：发现时间太晚，且职责过宽。
- 把检测逻辑复制到 commit/PR/quality skills：规则会漂移。

### Consequences

- Completion、quality、commit、PR 等 Skill 需要引用同一个 Gap Detector。
- Detector 必须保持短小、只读、fail-closed，避免复制完整 Acceptance procedure。
- Detector 发现缺口后必须停止产品完成声明，但不能越权实施修复。

### Review / Reversal Trigger

若调用方 Skill 无法稳定触发独立 Detector，应把同一 detector contract 下沉为
completion pipeline 的统一机器检查；不得复制多份判断规则。
