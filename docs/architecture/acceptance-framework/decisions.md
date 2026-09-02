# Acceptance Framework — 设计决策

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-06-03 | **Updated**: 2026-09-02
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
| D-13 | Native Desktop proof 使用 Gate × Runtime Cell 矩阵 | accepted |
| D-14 | 远端 Native Cell 使用 SSH 控制面与 loopback WebDriver | accepted |
| D-15 | Linux Native Cell 使用持久 Xorg 桌面而非 Xvfb | accepted |
| D-16 | 远端 Cell 通过增量 Git object sync 获取 clean source | accepted |
| D-17 | Runtime Manifest 使用 typed services map 表达完整服务拓扑 | accepted |
| D-18 | Client 通过 typed binding 引用 Runtime Manifest service | accepted |

---

## D-01: Capability Graph 是验收架构的一等模型

**Status**: proposed
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

## D-13: Native Desktop proof 使用 Gate × Runtime Cell 矩阵

**Status**: accepted
**Date**: 2026-08-24 | **Accepted**: 2026-08-24

### Context

当前 `native-tauri-embedded-webdriver` 实际只证明本机 macOS WKWebView。产品 Gate、
environment 和平台实现被压缩成一个维度，导致 Linux/Windows 支持只能复制 Gate，
或错误地让单平台 evidence 代表全部 Desktop 平台。

### Decision

产品 Gate identity 保持稳定，新增显式 `requiredRuntimeCells` 维度。一次产品能力声明
可要求 `desktop-macos-native`、`desktop-linux-native` 和
`desktop-windows-native`；每个 `(gateId, cellId, sourceCommit)` 独立执行、持久化和
判定。Capability 只有在其 required cells 全部满足时才能声明跨平台 `PROVEN`。

### Rationale

业务旅程与平台执行机制是两个正交维度。同一 Chat journey 应复用一套断言，而窗口、
输入、WebView 和 host lifecycle 由 cell adapter 提供。

### Alternatives Considered

- 每个平台复制一个产品 Gate：拒绝，断言和修复会漂移。
- 一个 Gate 运行任意可用平台即算通过：拒绝，允许平台证据互相冒充。
- 将平台判断留给 Agent：拒绝，不可发现、不可重复。

### Consequences

- Planner、Runner、manifest、report 和 validator 需要理解 cell 维度。
- 现有 macOS evidence 只能证明 macOS cell，不再隐式代表 Desktop 全平台。
- 平台暂不可用时只阻塞对应 cell；报告必须保持跨平台能力为 `PARTIAL/UNPROVEN`。

### Review / Reversal Trigger

若 Gate × cell 展开造成无法控制的执行成本，应由 Capability 明确区分 required 与
scheduled cells；不得恢复为“任意一台通过即可”。

---

## D-14: 远端 Native Cell 使用 SSH 控制面与 Loopback WebDriver

**Status**: accepted
**Date**: 2026-08-24 | **Accepted**: 2026-08-24

### Context

当前 `TauriDriver` 同时负责本机 app launch 和 `127.0.0.1` WebDriver 连接。远端
Desktop 若直接开放 embedded WebDriver 端口，会扩大安全面；若把完整业务 Gate 搬到
远端，又会分裂 evidence owner 和业务 runner。

### Decision

保留本地 Acceptance Orchestrator 和 Evidence Store。远端 cell 通过严格 host-key
校验的 SSH 控制面完成 source staging、build、GUI process lifecycle 与 native
adapter 调用；embedded WebDriver 继续只绑定远端 loopback，通过 run-scoped SSH
local forward 暴露给本地 `TauriDriver`。SSH target 只能由 Profile/secret reference
解析，禁止写入 Gate、contract 或 evidence。

### Rationale

该模型保持业务 Gate 与 evidence owner 单一，同时不把高权限自动化端口暴露到网络。
平台动作发生在目标桌面，开发者本机只承担控制和证据持久化，不争抢本机 GUI。

### Alternatives Considered

- WebDriver 监听 `0.0.0.0`：拒绝，automation capability 暴露到网络。
- 全部 Gate 在远端执行：拒绝，会引入第二套 planner/evidence lifecycle。
- 共享长期 SSH tunnel：拒绝，无法绑定单次 run 和可靠 cleanup。

### Consequences

- 需要 remote source/binary attestation、SSH tunnel lease 和断线 reaper。
- 网络中断必须区分 environment failure 与产品失败。
- Host IP、用户名、密钥和远端物理路径不得进入仓库 contract。

### Review / Reversal Trigger

若 SSH tunnel 无法提供稳定延迟或 teardown，应替换 transport implementation，但
仍保持 loopback WebDriver、run-scoped lease 和单一 Evidence Store。

---

## D-15: Linux Native Cell 使用持久 Xorg 桌面而非 Xvfb

**Status**: accepted
**Date**: 2026-08-24 | **Accepted**: 2026-08-24

### Context

Linux 最终 Native proof 需要同时证明 WebKitGTK 渲染、真实窗口焦点、系统级键鼠输入、
窗口归属和截图。Xvfb 可以执行 DOM 自动化，但其显示、合成与输入语义不足以代表完整
Desktop session。候选主机已有 QXL connected virtual output、GDM 和 GNOME，因此不
需要物理显示器。

### Decision

Linux cell 使用受支持 userland 上的持久 Xorg Desktop session、connected virtual
output、Window Manager 与 X11 XTest/EWMH native adapter。该 userland 可以是
digest-pinned container，因此不要求宿主发行版升级。Xvfb 只允许用于明确标注的
非 Native 诊断，不得产生最终 Linux Native proof。Tauri/WebKitGTK 系统依赖必须来自
同一受支持 userland 的软件源；禁止跨发行版混装。

### Rationale

Xorg 提供可审计的 active window、window stack、geometry 和 XTest input，适合当前
Gate 的真实输入合同；QXL 虚拟输出消除了物理显示器依赖。固定 session 还能把 VNC/
SPICE 观察面与自动化运行面绑定到同一 display。容器化 userland 将 WebKitGTK 和
toolchain compatibility 与 Ubuntu 20.04 宿主解耦，同时仍在真实 Linux kernel、
Xorg、Window Manager 和 WebKitGTK process 上执行。

### Alternatives Considered

- Xvfb：拒绝作为最终 proof，窗口合成和用户可见性语义不足。
- 宿主原地升级：不要求；对共享机器破坏性过大，且不是满足 WebKitGTK userland
  contract 的必要条件。
- 在 Ubuntu 20.04 宿主混装新发行版 WebKitGTK：拒绝，ABI 与安全更新不可控。
- 继续使用 Wayland 并依赖通用注入工具：暂不采用，权限和 compositor-specific
  automation 不稳定；可在具备正式协议后重新评审。
- 要求物理显示器：拒绝，QXL/VKMS 等 connected virtual output 已能提供真实 display
  server 和 compositor 语义。

### Consequences

- Linux host 必须维持专用登录 session、固定分辨率和 GUI lease。
- 候选 Ubuntu 20.04 主机可保持不变；Linux cell 使用包含 WebKitGTK 4.1、
  build toolchain、Xorg dummy、Window Manager、DBus/keyring 和 observer 的
  digest-pinned image。
- Host kernel、container image digest、cell userland、display 和 binary identity
  必须同时进入 Runtime Cell Manifest。
- Linux cell 证明 WebKitGTK/X11，不证明 macOS AppKit/Spaces 或 Windows WebView2。

### Review / Reversal Trigger

当 Wayland 提供可稳定自动化、可审计窗口归属和 unattended session lifecycle 时，
可新增 Wayland cell；不得原地改变 Xorg cell 的证据语义。

---

## D-16: 远端 Cell 通过增量 Git Object Sync 获取 Clean Source

**Status**: accepted
**Date**: 2026-08-24 | **Accepted**: 2026-08-24

### Context

每次把完整 worktree 复制到远端会浪费网络和磁盘，并难以证明哪些 untracked、ignored
或 dirty 文件进入了构建。现有 remote `make station` 已采用 source lease、bare Git
repository、增量 push/fetch、exact checkout 和远端 build 的模型。

### Decision

Native remote cell 复用该部署语义，但将 source acquisition 抽成与 Station/Desktop
role 无关的组件：

```text
Profile target
  -> source lease
  -> push/fetch missing Git objects
  -> checkout exact clean commit
  -> build in digest-pinned cell image
  -> attest commit + image digest + binary SHA-256
```

首次运行传输完整可达 Git objects；后续只传缺失 objects。`node_modules`、Cargo target
和 package caches 保留在受 cell lease 管理的 cache volumes，不进入 source identity。
最终 proof 拒绝 dirty worktree；诊断 run 可另行声明 dirty digest，但不得发布为
`PROVEN`。

### Rationale

Git object transfer 比 rsync 全量目录更高效，并天然绑定 commit identity。远端构建
保证 Linux ABI/WebKitGTK 匹配；持久 cache 避免每次全量安装和编译。

### Alternatives Considered

- 每次 rsync 全量 worktree：拒绝，传输冗余且 source boundary 不清晰。
- 从 macOS 交叉编译并传 Linux binary：拒绝，Linux native dependencies 与 ABI
  证据不足。
- 直接复用 Station `deploy.sh` 全流程：拒绝，其 role、restart 和 health semantics
  属于 Station/Relay；只复用 source-sync contract。

### Consequences

- 需要把现有 deploy source-sync 逻辑提取为共享、无 role 语义的入口。
- Remote cell 必须有 persistent bare repository、checkout root 和 bounded cache。
- Commit 不可达、checkout dirty 或 remote digest 不一致时在 build 前 fail closed。

### Review / Reversal Trigger

若 Git object transport 无法覆盖必要 repository dependencies，应扩展受控 source
manifest；不得退回无 attestation 的全目录复制。

---

## D-17: Runtime Manifest 使用 typed services map 表达完整服务拓扑

**Status**: accepted
**Date**: 2026-08-27 | **Accepted**: 2026-08-27

### Context

原 Runtime Manifest 只有顶层 `station` 字段，无法无损表达 Mobile Acceptance
要求的 `station-primary`、`station-secondary` 和 `relay`。增加第二个并行字段会让
同一 Station 同时存在两种表达，并引入读取优先级、双写和证据一致性问题。

### Decision

`EnvironmentContract.services` 与 `RuntimeManifest.services` 是唯一 canonical
服务拓扑契约。service ID 表示环境中的稳定角色，`kind` 表示服务类型。因此
`station-primary` 与 `station-secondary` 均使用 `kind: station`，`relay` 使用
`kind: relay`。

每个 required Environment service 在 manifest 进入 `FIXTURE_READY` 前必须有且只有
一个 source-bound `ServiceAttestation`。Manifest map key 必须等于 attestation 的
service ID，kind 必须等于 Environment requirement 的 kind。

删除 legacy 顶层 `station` 字段。Reader 和 writer 禁止 dual-write、alias、按 map
顺序推断 primary Station 或回退旧字段。单 Station 环境继续使用
`services.station`。

每份 attestation 使用 service-scoped artifact path：
`runtime/services/<service-id>/attestation.json`。

### Rationale

服务角色与服务类型分离后，同一 manifest 可以表达多个同类服务和不同类型服务，
同时保持一个拓扑真源。Service-scoped artifact path 消除同一 run 内多 Station
attestation 覆盖。

### Alternatives Considered

- 保留 `station` 并新增 `services`：拒绝，会形成 split-brain 和永久兼容债务。
- 只保留 singular `station`：拒绝，无法证明 Station replacement、跨 Station
  scope isolation 和 Relay 依赖。
- 由 Mobile Gate 维护第二份 manifest：拒绝，业务 Gate 不拥有 runtime resource
  truth。

### Consequences

- 所有 Runtime Manifest producer、consumer、validator 和 test 必须原子迁移。
- Environment service contract 必须声明 `kind`。
- 每增加一种 service kind，都必须提供对应 runtime owner 产生的 attestation。
- 旧 manifest fail closed，不能继续作为 current proof。

### Review / Reversal Trigger

若服务角色无法用稳定 ID 表达，应重新评审 Environment Contract；不得恢复 singular
字段或引入并行 manifest。

---

## D-18: Client 通过 Typed Binding 引用 Runtime Manifest Service

**Status**: accepted
**Date**: 2026-09-01

### Context

D-17 已规定 `EnvironmentContract.services` 与 `RuntimeManifest.services` 是唯一服务
拓扑真源，但 `ClientRuntime` 只描述 actor、runtime、端口、profile 和 storage，
没有表达客户端依赖哪个 service。

现有消费者因此出现三种私有映射：

- Mobile proof contract 使用 `CLIENT_SERVICE` 常量绑定 client 与
  `station-primary` / `station-secondary`；
- Federation prerequisite 使用 authority/follower Station URL 环境变量；
- Native Desktop Chat runner 从单个默认 Station URL 启动全部 client。

这些实现重复表达同一个拓扑关系，无法由通用 validator 验证，也不能无歧义表达
“同一 Linux runtime cell 内多个 Desktop client 分别绑定不同 Station”。

### Decision

Environment Contract 的 client declaration 和 Runtime Manifest 的
`ClientRuntime` 使用同一个 typed `service_bindings` contract：

```yaml
service_bindings:
  station:
    service_id: station-primary
    required_kind: station
```

Binding role 是 client-local dependency role；`service_id` 必须引用同一 contract /
manifest 的 canonical services map；`required_kind` 必须等于目标 service 的 kind。
Binding 不复制 endpoint、deployment environment、commit、runtime identity 或
attestation。

Environment Provisioner 负责解析和验证 binding，并将验证后的 edge 写入 immutable
Runtime Manifest。`ClientRuntime.id` 是 contract 与 manifest 共享的稳定 client
identity，不能用 actor 代替。Gate 只能通过 client ID + binding role 解析服务，
不得读取裸 URL、按 map/数组顺序推断、维护业务常量映射或回退 Profile 默认 Station。

**Core and platform boundary**: D-18 adds only `id`,
`required_service_roles`, and `service_bindings` to the existing
`ClientRuntime` allocation record. It does not move or redefine port, profile,
storage, session, device, or platform-isolation fields. Those remain governed
by D-13 Runtime Cell and existing platform Provisioners. No opaque extension
bag is introduced.

**Binding proof obligation**: Recording a binding in the Manifest is
necessary but not sufficient. Every initial launch and restart goes through the
platform-owned Runtime Binding operation
`create_bound_session(client_id, launch_options)`. The
business Gate may provide only fields from the selected Runtime Binding's
closed, typed, non-topology launch-options contract. Unknown fields, arbitrary
environment maps, service URL, host, port, service ID, deployment identity,
commit, and runtime identity are rejected. Runtime Binding resolves bindings
from the immutable manifest, allocates a monotonic generation for that client,
launches the client, collects one platform observation for every required
binding role, and asks the Core verifier to persist one `BindingProofRecord`
per role before returning the session.

The registered platform observer must read observed identity from the running
client's live connection state and bind it to the launched runtime instance.
It cannot derive observed identity from Manifest bindings, launch options,
environment variables, or ServiceAttestation. Core derives expected identity
from the referenced ServiceAttestation and computes the verification result. The proof
binds to a platform-neutral `clientRuntimeIdentity` whose digest covers the
existing D-13 process, device/session, or browser-session identity; D-18 does
not redefine that platform payload. The proof contains neither its own
ArtifactRef nor a Runtime Manifest ArtifactRef. Runtime Binding automatically
accumulates returned proof refs; Core harness finalization records them in the
Gate result and requires exact coverage of every
`(clientId, launchGeneration, requiredRole)` tuple. A missing proof produces
`BINDING_PROOF_ABSENT`; a mismatch produces `LAUNCH_IDENTITY_MISMATCH`.

**Run-scoped transport override boundary**: A Domain fault proxy is transport
instrumentation, not a service topology source. It must not appear in
`service_bindings` or `launch_options`. Runtime Binding may expose a
Domain-owned local fault endpoint and return an opaque
`TransportOverrideHandle`; business Gate code can only apply or clear that
handle and cannot read or forward its routable URL. The handle is scoped to the
run, client, binding role, and declared service ID, cannot replace canonical
binding proof, and fails with `TRANSPORT_OVERRIDE_MISMATCH` when any identity
differs. Domain evidence remains responsible for proxy upstream identity,
behavior, and cleanup.

**Required service roles**: Each client declares `required_service_roles` —
the closed set of binding roles it depends on. The validator requires
`service_bindings.keys()` to equal `required_service_roles` exactly. A client
must declare the field; omission is invalid. An explicit empty list denotes a
service-independent client, and empty `service_bindings` is valid only in that
case.

**Typed failure semantics**: All binding validation failures use closed
`ClientBindingError` codes with numeric values (20101–20203), failure stage
(`pre-launch` / `post-launch` / `runtime`), and deterministic result mapping.
See [data-model.md §3](./data-model.md#3-runtime-resource-manifest) for the
complete error table and structured error object schema.

**Migration ownership boundary**: Acceptance Infra owns the generic binding
parser, validator, lookup helper, and `BindingProofRecord` contract. Each
business Domain (Mobile, Federation, Chat/Native Desktop) owns its own
migration schedule, decides when to switch its runners/gates from private
mappings to the generic helper, and deletes its own legacy constants.
Infra reports unmigrated private mappings as an Acceptance Gap but does not
execute or schedule business-side migration.

### Rationale

该关系是 runtime resource topology，而不是 Chat、Mobile 或 Federation 业务语义。
将它放入现有 Environment Contract 与 Runtime Manifest，可以复用 D-07 provisioning
lifecycle、D-11 immutable evidence、D-13 runtime cells 和 D-17 typed services，
并让一个 runtime cell 安全运行多个绑定不同 Station 的隔离客户端。

### Alternatives Considered

- 新增 `multi-station-native-desktop` 专属 manifest：拒绝，会复制 D-17 服务拓扑和
  D-13 client isolation。
- 在每个 Gate 中传递 Station URL map：拒绝，业务 Gate 会拥有 runtime topology。
- 保留 Mobile `CLIENT_SERVICE` 并为 Desktop 增加另一份映射：拒绝，形成平台私有
  contract 和重复 validator。
- 依赖 client/service 数组顺序：拒绝，顺序不是稳定 identity，无法 fail closed。
- 把 endpoint 复制进 client record：拒绝，会与 service attestation 形成双真源。

### Consequences

- `EnvironmentContract` 必须通用解析 client declarations，而不是由 Mobile
  Provisioner 私自读取 raw contract。
- D-18 leaves existing client allocation and D-13 isolation ownership intact;
  it adds only stable client identity and service-binding fields.
- Runtime Binding must use `create_bound_session` for every launch generation
  and cannot return a session before Core persists a verified binding proof for
  every required role.
  Runtime Binding owns generation allocation and proof-ref collection; Gate
  code owns neither.
- All validation failures use closed `ClientBindingError` typed codes with
  numeric values, stage, and result mapping; bare string errors in binding
  paths are forbidden.
- `required_service_roles` explicitly declares service dependency; the
  manifest validator requires exact closure with `service_bindings`; Gate
  evidence requires one verified proof for every required role in every actual
  launch generation.
- 单服务环境中的 client 也必须显式绑定 `services.station`；没有服务依赖的 client
  可以保持空 binding。
- 具体 `four`、`fiveArm`、actor、Fixture 和产品断言仍由业务 Domain 注入，不进入
  Acceptance Core。
- Infra delivers parser/validator/helper/proof-contract; each Domain migrates
  its own runners/gates on its own schedule. Infra does not own, plan, or
  enforce cross-Domain migration order.
- 旧 manifest 缺少 required client binding 时 fail closed，不能作为 current proof。

### Review / Reversal Trigger

若一个 client 的运行时依赖无法用稳定 role 到 service ID 的有向边表达，应重新评审
Environment Contract 的资源图；不得恢复裸 URL、隐式默认 Station 或第二份业务
manifest。
