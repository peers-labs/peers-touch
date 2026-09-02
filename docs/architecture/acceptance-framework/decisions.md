# Acceptance Framework — 设计决策

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-06-03 | **Updated**: 2026-08-23
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
| D-11 | Runtime Evidence Store 位于 source tree 之外 | accepted |
| D-12 | Acceptance Infra 与业务注入使用独立责任平面 | accepted |
| D-13 | Evidence role applicability 由 runtime matrix row 显式定义 | accepted |

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

---

## D-11: Runtime Evidence Store 位于 Source Tree 之外

**Status**: accepted
**Date**: 2026-08-17 | **Accepted**: 2026-08-17

### Context

Acceptance runtime当前把plan、run、manifest、log、截图和validation report写到
`tooling/acceptance/reports/`。该目录虽然gitignored，仍位于worktree中。一轮真实
G15已完成Fixture reset和Native执行，却在写
`chat-native-interactions-run.json`时遇到macOS `EPERM`。该事件只证明evidence
emission失败，不能证明G15产品行为通过。

Source-tree输出同时耦合worktree权限、Git观察、workspace digest、清理和并发运行。
`_paths.py`、Acceptance scripts、Domain profiles、Make targets和operational skills
均含物理路径假设；仓库内还存在tracked historical runtime reports。

### Decision

Acceptance Core Evidence Store是runtime-generated evidence的唯一owner。所有runtime
artifact必须写入source tree之外的canonical artifact root：

```text
<root>/<workspace-id>/<gate-id>/<run-id>/
```

`PT_ACCEPTANCE_ARTIFACT_ROOT`是可选override。未设置或空白时使用平台默认：

- macOS: `~/Library/Application Support/PeersTouch/acceptance`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/peers-touch/acceptance`
- Windows: `%LOCALAPPDATA%\PeersTouch\acceptance`

CI必须显式override到CI artifact workspace。

`workspace-id`是canonical worktree path的SHA-256前16个小写hex字符。`gate-id`使用
validated slug。`run-id`由UTC microsecond timestamp与128-bit cryptographic random
suffix组成。

每次run拥有immutable目录和manifest。`latest.json`仅是gate目录下的原子pointer，
不是primary evidence object；只有run manifest已写入、`fsync`并durable后才能更新。
并发publisher必须在gate lock下按`completedAt + runId`比较后发布，避免较早run晚完成
时覆盖较新的pointer。

Repository只保留code、schemas、templates和intentional test fixtures。Runtime writer
不得写入repo root、`tooling/`、`docs/`或`.git/`。不允许dual-write、symlink
compatibility、silent fallback或legacy report owner。

Artifact references使用typed `ArtifactRef`，保存workspace、gate、run和run-relative
path；contract和manifest不得保存source-tree物理report路径。Reader通过同一resolver
解析并验证containment、manifest identity和content hash。

### Lifecycle And Failure Semantics

```text
ALLOCATED -> ACTIVE -> FINALIZING -> DURABLE -> PUBLISHED -> CLOSED
     |          |            |
     +----------+------------+-> EVIDENCE_FAILED
```

- root create/write失败使Gate显式失败，proof保持`UNPROVEN`；
- permission denied、disk full、malformed root、path traversal、symlink escape、
  manifest conflict和interrupted write均映射typed evidence errors；
- 任一失败都不得fallback到repository；
- interrupted manifest/latest write只留下未发布temporary file，旧latest保持有效；
- active run持有OS advisory lock；cleanup无法取得non-blocking lock时必须跳过；
- cleanup默认不自动删除。显式retention命令不得删除active run、latest target或仍被
  manifest引用的artifact；
- secret redaction在durable write之前执行，不能因迁移被削弱。

### Rationale

- runtime证据生命周期与source lifecycle分离；
- 每run隔离消除concurrent overwrite；
- immutable manifest与atomic pointer同时支持审计和ergonomic latest读取；
- canonical resolver让writer、reader、validator、report和cleanup共享一套边界；
- typed failure避免EPERM再次退化为产品断言失败或silent missing evidence。

### Alternatives Considered

- 保持gitignored source-tree reports：拒绝，权限/Git/digest/cleanup耦合仍存在。
- 只迁移Native G15输出：拒绝，保留split ownership和其它writer同类故障。
- repo外写入同时source-tree dual-write：拒绝，两个latest和两套cleanup会漂移。
- source-tree symlink到外部root：拒绝，仍受worktree权限与path observation影响。
- 写失败后fallback到repo：拒绝，会把安全边界变成环境相关行为。
- 只按gate保存一个latest文件：拒绝，覆盖历史且无法证明并发隔离。
- 以全局workspace名称代替canonical-path hash：拒绝，同名worktree会冲突。

### Consequences

正面：

- read-only repository仍可运行并产出证据；
- concurrent Gates和多个worktree不再覆盖；
- CI artifact collection可通过一个override root完成；
- source digest不再被runtime写入扰动。

负面：

- 现有scripts、tests、skills、Domain profiles和docs必须原子迁移；
- 用户需要从artifact root读取本地证据，不能再依赖repo相对路径；
- default retain-all会增长磁盘，需要显式cleanup policy；
- canonical path变化会产生新workspace-id，旧run不会自动迁移；
- existing tracked runtime reports必须删除，不能继续作为产品proof。

### Review / Reversal Trigger

若平台证明无法提供可靠atomic replace、directory durability或active-run locking，
应设计平台专用backend并保持相同Evidence Store contract；不得回退source-tree写入。

---

## D-12: Acceptance Infra 与业务注入使用独立责任平面

**Status**: accepted
**Date**: 2026-08-18

### Context

Acceptance Framework 同时包含通用运行时、结构校验、Evidence Store 与业务 Domain
注入。如果 Agent 只按文件路径判断责任，会把业务 Gate、Environment、Provisioner、
Fixture 或产品证据缺口当成 Infra 交付条件，并越权替业务模块补内容。

### Decision

建立两个独立责任平面：

- Acceptance Infra 定义 schema、扩展接口、planner、validator、runner、Evidence
  Store、通用生命周期、结构校验和框架自证。
- 业务模块注入 Domain、Feature、Capability、Registry rule、具体 Gate、
  Environment、Provisioner、Fixture、角色、凭据引用与产品证据。

Infra 发现注入缺口时输出 `BUSINESS_INJECTION_REQUIRED`，只阻塞对应业务 Domain。
业务 `FAILED/BLOCKED/UNPROVEN` 不得反向阻塞 Infra readiness。

Infra readiness 只消费 `acceptance_core_self_validation`。方向为
`product_domain_validates_acceptance` 的 capability 只提供附加反向证据，默认不作为
每次 Infra PR 的合并门。

### Rationale

- 保持框架 domain-neutral，避免 Federation、Chat 或其它业务成为隐式核心。
- 防止 Agent 为了通过 Infra Gate 伪造业务注入或降低产品断言。
- 让业务模块可以独立演进、独立失败、独立证明。
- 让 Quality Evidence 对 Infra 与产品 readiness 使用不同责任口径。

### Alternatives Considered

- 由一个 Acceptance Skill 同时处理框架和业务：拒绝，责任边界会持续漂移。
- 业务 Gate 未通过时阻塞所有 Infra PR：拒绝，把消费者状态错误地提升为框架状态。
- Infra 自动补 placeholder environment/fixture：拒绝，产生不可审计的伪注入。

### Consequences

- 新增 `pt-acceptance-infra-engineering` 作为 Infra 专用入口。
- `pt-acceptance-engineering` 保留业务接入、补齐和产品证明职责。
- Quality Evidence 必须区分 blocking Infra scope 与 informational reverse evidence。
- Agent 开发手册必须明确路由规则和禁止越权行为。

### Review / Reversal Trigger

若某项能力无法明确归入 Infra contract 或业务注入，必须先形成 ownership decision；
不得以“代码位于 `tooling/acceptance/`”为由默认归属 Infra。

---

## D-13: Evidence Role Applicability 由 Runtime Matrix Row 显式定义

**Status**: accepted
**Date**: 2026-08-23 | **Accepted**: 2026-08-23

### Context

Modern Chat Agent Foundation Gate 的 419 个 tuple 同时覆盖 Desktop Native、
Browser、Mobile contract、Station D11 guard 与能力不广告场景。当前 Gate-level
`required_artifact_roles` 被 validator 解释为“每个 role 必须对每个 tuple 产生一条
observation”。

该语义与 matrix 的 runtime cell 冲突：

- `mobile_contract / contract_only` 没有 DOM，却被要求产生带
  `selector + visible` 的 `receiver-dom` observation；
- `station_web_rust / orchestration_guard` 没有 receiver DOM，也没有普通 Agent
  Turn 的 Station readback/runtime event；
- 为满足 schema 而伪造 DOM selector、Turn 或 runtime event 会把结构完整性冒充
  产品证据。

### Decision

Runtime matrix 的每个 row 必须显式声明 evidence role applicability：

```yaml
runtime_attestation_profile: direct_runtime
role_policy:
  always: [cell-results, runtime-attestation-set, cleanup]
  required: [receiver-dom, station-readback, runtime-events]
  not_applicable: [contract-evidence, guard-report]
```

约束：

1. Gate-level roles 是所有 row applicable roles 的并集，不再表示 role × tuple
   全笛卡尔积。
2. `cell-results` 与 `runtime-attestation-set` 始终覆盖 Gate 的全部 tuple。
3. 其它 role artifact 只覆盖声明其 `required` 的 tuple，并且
   `runtimeAttestationRefs`、`scenarioIds`、`sampleCount` 必须等于该子集。
4. `mobile_contract` 使用 `contract-evidence`，不得生成 `receiver-dom`。
5. `orchestration_guard` 使用 `guard-report`，不得生成虚构 Turn/DOM。
6. Desktop/Browser 的用户可见 cell 继续要求 `receiver-dom`；Station-owned
   runtime cell 继续要求 `station-readback` 与真实 runtime event。
7. 未声明的 role/cell 组合 fail closed；`not_applicable` 不是 skip，也必须由
   matrix contract 明确记录。
8. `runtime-attestation-set` 覆盖全部 tuple，但 row 必须声明 payload profile：
   `direct_runtime`、`contract_only`、`orchestration_guard` 或
   `non_advertised`。只有 `direct_runtime` 可要求 conversation/Turn/ToolCall/
   client-session 全绑定；其它 profile 使用各自真实 contract、guard 或
   capability-inventory identity，禁止补造业务对象。

### Rationale

Role applicability 属于被评审 matrix 的证明拓扑。把它显式化后，validator 仍能要求
每个 tuple 有完整适用证据，同时不会强迫无该 surface 的 runtime 伪造证据。

### Alternatives Considered

- 所有 role 覆盖所有 tuple：拒绝，会要求 contract-only 和 guard cell 伪造 DOM、
  Turn 与 runtime event。
- 把 Foundation 拆成五个独立 Gates：可行但增加 Gate/proof-set/发布原子性，并使
  C01-C10 的单一 advancement decision 更复杂。
- 将 `receiver-dom` 解释为任意可见/静态证据：拒绝，会破坏角色名称、schema 与
  receiver-proof 语义。

### Consequences

正面：

- Mobile contract、D11 与不广告场景可以使用与事实源匹配的 evidence role；
- validator 可精确检查 tuple 子集覆盖，避免 silent skip；
- Desktop/Browser Native DOM 要求不被弱化。

负面：

- runtime matrix、contract schema、candidate producer、validator 和测试必须原子更新；
- 新增 role 需要显式 schema；在 Owner 批准具体 schema 版本前不得修改版本号；
- historical candidate manifest 不再满足新 role-policy contract。

### Review / Reversal Trigger

若所有 runtime cell 最终都具备同一种真实 receiver surface，可重新评估统一 role；
不得通过 role 名称泛化或伪造 observation 规避 row-scoped applicability。
