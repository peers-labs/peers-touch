# Acceptance Framework — 设计决策

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-06-03 | **Updated**: 2026-09-13
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
| D-07 | Environment Provisioning 是 Gate 之前的独立运行时边界 | accepted |
| D-08 | Attestation、Actor Fixture 与 Credential 各有唯一生产 Owner | accepted |
| D-09 | Registry 按产品行为选择 receiver-proof Gate | accepted |
| D-10 | Gap Detector 作为跨阶段只读守卫 | accepted |
| D-11 | Runtime Evidence Store 位于 source tree 之外 | accepted |
| D-12 | Acceptance Infra 与业务注入使用独立责任平面 | accepted |
| D-13 | Evidence role applicability 由 runtime matrix row 显式定义 | accepted |
| D-14 | 远端 Native Cell 使用 SSH 控制面与 loopback WebDriver | accepted |
| D-15 | Linux Native Cell 使用持久 Xorg 桌面而非 Xvfb | accepted |
| D-16 | 远端 Cell 通过增量 Git object sync 获取 clean source | accepted |
| D-17 | Runtime Manifest 使用 typed services map 表达完整服务拓扑 | accepted |
| D-18 | Client 通过 typed binding 引用 Runtime Manifest service | accepted |
| D-19 | Cleanup后、run finalize前执行只读Evidence Finalizer | accepted |

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

将 `chat` 从 `planned` 升级为 active `managed_domain`。Conversation
`/conversation/*` 是唯一 Chat 入口；Device、Inbox、Recovery、Key Exchange 与
Federation 使用各自 resource-owner API，Desktop/Mobile Device Messaging Engine
保留为内部 runtime 名称。Chat domain 覆盖 Station、realtime、Desktop typed
surface 和 Desktop DOM visibility 能力，并保留 app-runtime optional evidence：

- `chat-proto-service-contract`：Proto-first Conversation 与 resource-owner contracts。
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
plan -> provisioner -> runtime manifest
                    -> optional D-18 launch context
                    -> gate -> evidence -> cleanup
```

Gate 不自启动环境。Provisioner 根据 environment contract 准备资源、输出不可变
runtime manifest，并在缺项时生成结构化 `BLOCKED/UNPROVEN` artifact。
D-18只为无法持久化的process-local capability增加独立launch channel；它不改变
Runtime Manifest作为durable runtime truth的地位，也不允许Gate自行准备资源。

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

**Default root amended**: 2026-09-13 by LDCP-D07

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

`PT_ACCEPTANCE_ARTIFACT_ROOT`是CI和隔离测试的显式override。未设置或空白时，
本机开发使用机器 Dev Control Plane 下的 canonical default：

- macOS / Linux / other Unix: `~/.peers-touch/dev/acceptance`
- Windows: `%USERPROFILE%\.peers-touch\dev\acceptance`

CI必须显式override到CI artifact workspace。

`~/Library/Application Support/PeersTouch/`及其它正式产品数据namespace禁止作为
Acceptance artifact root。历史macOS root
`~/Library/Application Support/PeersTouch/acceptance`只允许作为一次性迁移源；
切换后禁止symlink、dual-write、dual-read或fallback。
迁移只有在全部Git worktree证明新resolver contract、旧writer和live run归零、
全部artifact完整性验证通过、旧目录删除并复验不存在后才完成。完成后live registry、
active docs和runtime code必须删除legacy字段与迁移分支；只有closed ADR和不可执行的
completion receipt可保留历史。

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
- 产品Application Support namespace不再混入开发期证据。

负面：

- 现有scripts、tests、skills、Domain profiles和docs必须原子迁移；
- 用户需要从artifact root读取本地证据，不能再依赖repo相对路径；
- default retain-all会增长磁盘，需要显式cleanup policy；
- canonical path变化会产生新workspace-id，旧run不会自动迁移；
- existing tracked runtime reports必须删除，不能继续作为产品proof。
- 现有外部Evidence Store需要一次quiesce、完整性校验和atomic cutover。

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

## D-18: Gate进程使用EphemeralGateLaunchContext接收非持久化Capability

**Status**: accepted
**Date**: 2026-08-30 | **Accepted**: 2026-08-30

### Context

Environment Provisioner与产品Gate运行在不同进程。D-18落地前的runner在Provisioner返回
Runtime Manifest后，通过`subprocess.run(..., shell=True, env=gate_env)`启动Gate。
这只能传递可序列化manifest和字符串环境变量，不能安全传递Mobile physical device
broker、provider correlation authority或其它process-local capability。

Mobile已证明两项约束：

- raw physical device handle必须保持process-local且不可序列化；
- provider correlation key只能留在内存或经一次性anonymous descriptor传递，不能进入
  Runtime Manifest、filesystem、environment value、argv、network endpoint或evidence。

业务侧自行新增环境变量、临时文件、localhost broker或Gate-side resource
reacquisition都会建立第二个authority或扩大secret暴露面，因此不能作为E2-5修复。

### Decision

Acceptance Infra新增domain-neutral `EphemeralGateLaunchContext`：

1. Provisioner在orchestrator进程中向context注册typed capability handler；handler、
   secret和raw handle不离开parent process。
2. Context在Gate启动前绑定`workspaceId + gateId + evidenceRunId +
   provisioningRunId`并seal；seal后禁止新增或替换capability。两个run identity
   分别来自Evidence Store RunHandle和Runtime Manifest，不得互相推断或替代。
3. Core创建一个run-scoped anonymous capability channel。Gate只继承child endpoint，
   并通过非敏感descriptor locator找到它。
4. Orchestrator在Gate运行期间维护bounded broker loop。Gate发送typed
   `capability + operation + payload`请求；parent handler执行实际操作并返回脱敏结果。
   依赖raw handle的动作全部在parent内完成，Gate只获得opaque session reference、
   脱敏结果或ArtifactRef。
5. Gate Catalog对需要context的Gate声明`argv`和`ephemeralCapabilities`；`argv`与
   legacy `command`二选一。携带context的Gate必须以显式`Popen`、`shell=False`、
   `close_fds=True`和exact descriptor allowlist启动；spawn后parent立即关闭其child
   endpoint副本。
6. Gate退出、spawn失败、timeout和cancellation统一先quiesce context，阻断新请求并
   关闭transport；随后执行runtime-cell和Environment Provisioner cleanup，最后
   close context并验证secret zeroization。
7. 首个实现backend为POSIX inherited descriptor。未实现等价安全backend的平台在
   spawn前结构化`BLOCKED/UNPROVEN`，不得降级到环境变量、文件或网络transport。

### Rationale

- capability possession通过kernel-owned inherited descriptor限制到本次child，
  无需把secret或raw resource identity持久化。
- broker authority仍由Provisioner持有，Gate不会成为第二个resource owner。
- domain-neutral Core只定义transport和lifecycle，Mobile继续拥有具体device/provider/
  Station Fixture operation，符合D-12责任防火墙。
- Python官方`subprocess.run`把额外参数传给`Popen`，POSIX `Popen.pass_fds`可显式
  指定保留的descriptor集合，并强制`close_fds=True`：
  <https://docs.python.org/3.14/library/subprocess.html#popen-constructor>。
- Python官方`os.pipe()`契约说明新descriptor默认non-inheritable，因此只有runner
  显式列入`pass_fds`的child endpoint跨越exec边界：
  <https://docs.python.org/3.14/library/os.html#os.pipe>。
- Python官方`socket.socketpair()`返回connected且默认non-inheritable的socket pair，
  适合作为POSIX双向anonymous channel：
  <https://docs.python.org/3.14/library/socket.html#socket.socketpair>。

### Alternatives Considered

- **把secret或raw handle写入Runtime Manifest**：拒绝；manifest是durable evidence，
  且D-11要求可审计、可脱敏、可重读。
- **通过环境变量传secret**：拒绝；环境可被子进程、诊断工具和后续grandchild观察。
- **写入临时文件或Evidence Store**：拒绝；扩大持久化和cleanup边界，也违反secret
  contract。
- **启动localhost broker service**：拒绝；产生可寻址network endpoint、认证和端口
  生命周期，超出本地child capability所需边界。
- **Gate重新获取device/account/provider资源**：拒绝；形成第二个lease owner并破坏
  fencing、acquisition order和reverse cleanup。
- **直接把Python broker对象pickle给Gate**：拒绝；raw handle不可序列化，也无法维持
  单一owner和显式zeroization。
- **继续使用`shell=True`并期望shell转交descriptor**：拒绝；继承目标和grandchild
  边界不再精确，shell解析也扩大命令注入面。

### Consequences

正面：

- E2-5可在不泄露secret、不复制broker authority的情况下消费E2-1..E2-4；
- 后续其它domain可复用同一通用launch-context机制；
- identity、timeout、cancel、dedupe和cleanup可以由Core统一验证。

负面：

- runner必须为携带context的Gate提供argv启动路径，不能继续使用shell command；
- orchestrator在Gate运行期间需要一个bounded broker execution unit；
- POSIX backend不能自动证明Windows等价能力，未实现平台保持`UNPROVEN`；
- cleanup增加quiesce和final close两个边界；两者包围现有resource teardown，避免
  child继续调用，也避免过早销毁cleanup所需authority。
- Python层zeroization只能证明受控mutable owner buffer已清零，不构成所有解释器
  内存副本均被物理擦除的声明。

### Review / Reversal Trigger

若所有 runtime cell 最终都具备同一种真实 receiver surface，可重新评估统一 role；
不得通过 role 名称泛化或伪造 observation 规避 row-scoped applicability。

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

若实现证明anonymous inherited descriptor无法在目标orchestrator平台稳定提供精确
child ownership、bounded cancellation或secret zeroization，应重新评审platform
backend；不得转向持久化、环境变量、network service或Gate-side reacquisition。

---

## D-19: Cleanup后、Run Finalize前执行只读Evidence Finalizer

**Status**: accepted
**Date**: 2026-08-30
**Accepted**: 2026-08-31

### Context

部分业务证明包含由Provisioner cleanup产生的证据。Mobile E2-5的lease outcomes、
Station post-cleanup snapshots和correlation-destruction artifact只有在Gate退出且
authority quiesce后才能安全产生。当前runner在cleanup前接收Gate结果，而
`RunHandle.finalize()`之后Evidence Store不可再写；把完整validator放在Gate child会
提前判定，把cleanup移入child则违反D-18单一authority与清理顺序。

### Decision

Mobile-owned Capability Graph的protected required-finalizer mapping独立声明哪些Gate必须
执行哪个finalizer，Gate Catalog提供匹配的required finalizer ID、timeout和input
limit，但不重复声明requiredness。Runner验证Capability-owned required-finalizer
mapping、Gate Catalog execution config与generated finalizer registration catalog三方
一致，并在全部cleanup、Infra artifact
写入和secret audit完成后
调用Evidence Store `seal_for_finalization()`。Seal在跨进程finalization lock内调用
bounded Core snapshot-materializer完成全部payload读取和digest，再通过durable marker
一次冻结`roleName + discriminator + ArtifactRef + payloadDigest` inventory；后续
artifact write和snapshot mutation必须失败，最终manifest必须复验并消费同一digest。

Requirement按Gate ID唯一，不在多个Feature之间复制；requirement/Catalog单侧缺失
或ID冲突均拒绝执行。Mobile requirement绑定真实Gate ID
`mobile-native-access-e2e`，并由Mobile contract目录内的D-19 protected-source
baseline冻结。

Evidence Store通过immutable enforcement generations激活D-19。Activation先发布durable
pending barrier；Mobile source cutover前先安装永久publication interlock，reader/
writer只按durable interlock/pending/sentinel/current dispatch，不读取Capability Graph。
所有project-owned proof admission point先原子迁移为只接受closed
`AuthoritativeLatestResolution`，其reviewed source inventory digest由interlock绑定。
Interlock存在后，legacy mode、bare manifest、raw latest或free-form verifier output
都不能进入planner/runner aggregate或readiness claim；因此already-loaded legacy
reader的输出只能是diagnostic。
Every final claim sink holds a shared gate-scoped claim-admission lock through
external emission.
Interlock/activation hold it exclusively. First installation restarts the sole
claim execution environment under `ProofAdmissionCoordinator`; every job has a
PID/start/executable/source identity, and installation binds a fresh coordinator
epoch with paused scheduling and `activeJobs=()`. Process-table inference alone
cannot establish quiescence. Darwin/Linux environment identities are closed,
non-interchangeable branches. Each claim job is a trusted
`NO_CHILD_NO_SESSION_CHANGE_V1` leaf emitter whose complete source closure rejects
process creation, shell/process wrappers, `setsid`, `setpgid`, same-PID
`exec*`, `spawn*`/`popen`, dynamic symbol resolution and native extensions. V1 accepts only source-only Python interpreted
claim emitters and persists a closed `ForbiddenProcessApiScan` containing scanner
source, exact rule registry, inspected source nodes and empty findings. The
scanner entrypoint/source closure is fixed; claim source cannot import modules
and receives only a restricted builtin mapping plus canonical-JSON facade, with
no filesystem/import/dynamic-code/descriptor capability. Its digest-bound AST
grammar admits `Attribute` only for a direct
`canonical_json.encode|decode` call target. It excludes process/browser wrappers such as
`ProcessPoolExecutor` and `webbrowser`. Linux also
uses the epoch PID namespace. Normal completion requires
leaf wait plus empty exact group enumeration. A fixed non-claim wrapper owns the
sole lease FD, passes no descriptor-control capability to claim code, captures
the sole output internally and consumes the leaf wait. The coordinator consumes
the wrapper wait, durability-profile syncs immutable completion, then re-resolves
the exact expected authority under the publish lock. It durably publishes one
emission intent, calls a bounded idempotent sink with the deterministic key, and
passes only the base64-framed exact JCS `ClaimEmitterOutput` bytes plus raw
SHA-256. It persists the sink's stable acknowledgement before treating emission as complete.
Lost ACK retries the same key and bytes. This is a project trust constraint,
not a claim that process groups contain descendants: POSIX explicitly permits
`setsid()` to create a new group and limits `waitpid()` to caller children.
The first Darwin epoch therefore requires a durable boot observation recorded
after claim-consumer source cutover and before mandatory reboot, plus
source/runtime-bound helper attestation that boot UUID and boot time changed;
every later Darwin epoch uses a typed ref from its environment to the exact
prior observation, binds the supervisor boot UUID to it, then uses the same before-observation, reboot and
after-observation proof. The first Linux epoch has its own legacy identity and the
same source-cutover/reboot before-and-after boot-boundary proof. Later Linux
epochs bind PID-namespace device/inode and init PID/start. A pre-allocation
sacrificial-child probe on the same host build/kernel must prove both
`pidfd_open` and consuming `waitid(P_PIDFD, WEXITED)`. It persists one pidfd
lease identity and exact raw pre/post poll masks: pre-wait requires `POLLIN`,
forbids `POLLHUP` and error bits, while post-wait requires `POLLHUP` and still
forbids error bits. All three operations use the same still-open pidfd. The epoch supervisor
owns one non-transferable pidfd from pre-job release through `POLLIN` and
`waitid(P_PIDFD)`, remains the sole wait-capable parent, uses default `SIGCHLD`
and forbids `SA_NOCLDWAIT`; a supervisor crash requires reboot-boundary recovery. Graceful
termination proves zero surviving processes
without claiming all namespace pins disappeared.
Interlock installation与generation activation都是不可逆proof-authority transition，
必须由Evidence Store local interactive CLI签发closed
`FinalizerAuthorityAuthorization`。Authorization从kernel effective UID取得operator
principal，要求real/effective UID一致及同一controlling TTY。Approval path固定为
canonical acceptance-framework decisions document，`authoritySourceCommit`必须等于
clean current HEAD；整个canonical worktree不得有tracked/untracked drift，isolated
authority entrypoint不得加载ignored/untracked/dynamic source。Proof-admission
inventory由fixed `ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES` rule覆盖该commit中
`tooling/acceptance/**`、`tooling/scripts/acceptance-*`、exact
`quality-evidence.py`/`_acceptance_artifacts.py`和这些seed的repository-local
transitive imports plus statically resolved subprocess/shell/Make/CI-local helpers；
再对全部tracked source/configuration files执行language-neutral reverse
caller/importer/includer fixed-point，Node/Rust/Go等间接wrapper也进入inventory；
unsupported grammar、unresolved dynamic edge或closure外claim consumer拒绝，不由plan
选择子集。The classifier uses one total precedence/valid-pair table and requires
every non-data edge to resolve one target node with the same grammar/interpreter
pair；overlap、ambiguity或mismatch均fail closed。Authority command以
`python3 -I -S -E -B`运行fixed bootstrap；
bootstrap在加入repo root前验证自身/HEAD/cleanliness，再以AST和runtime module probe
拒绝dynamic、site、native或inventory外import；仅允许`tooling`和
`tooling.acceptance`作为single-location、repository-bound namespace package。
Project modules只由source-only loader读取verified tracked `.py` bytes；repository
bytecode cache存在即fail closed，`-B`不被误作禁止读取bytecode。
Proof-admission与activation digests都从该commit重新生成，禁止
复用stale/superseded commit中的acceptance。Authorization绑定目标
workspace/Gate/finalizer与action-specific expected state，并要求operator回输完整
domain-separated challenge。Authorization还绑定live supervisor、source-only
maintenance worker、Python executable和stdlib closure digest；request/READY/runtime
必须逐项相等。任何approval、principal、TTY、challenge、schema、digest
或expected-state失败都在durable mutation前返回`NO_MUTATION`。
Power-controller trust enrollment uses a separate two-phase local interactive
authority protocol. Phase one accepts public material only, applies the same
kernel-principal, TTY, clean-HEAD and canonical accepted-D-19 approval checks,
and writes a non-authoritative bootstrap candidate for exactly one qualification
run identity, then consumes it once. Bootstrap boot observations bind that finite
run/candidate context, not the profile under qualification. Phase two binds that
successful manifest/backend and uses the newly qualified backend to publish the
predecessor-keyed immutable transition reservation containing the frozen
promotion intent before candidate consumption, then the exact active anchor,
immutable generation record and CAS current selector. Revocation reserves the
same predecessor key before its frozen intent, revocation, generation and CAS.
Requalification
and key rotation create the
next immutable, predecessor-linked trust generation from the exact current
digest; revocation creates an immutable next-generation revocation and advances
current to a non-authorizing state. Generation reuse, rollback, stale CAS and
sibling successors fail closed. Crash recovery only completes the frozen
transition bytes. Normal
expectations require the active anchor; fixture execution cannot create or
replace authority.
Operator确认后，独立`AUTHORITY_RUNTIME_PERSISTER`先把capture bytes持久化到
content-addressed authority namespace；只有可从这些refs重建并返回
`AUTHORITY_RUNTIME_DURABLE`后，interlock/activation/abort才可mutation。Every nested
runtime ref and persistence request must carry the enclosing authorization ID.
Authority-runtime I/O, timeout or worker-process failure before any final-path publication returns
`NO_MUTATION`; after publication is attempted it returns
`AUTHORITY_RUNTIME_MAY_BE_DURABLE` with
`FINALIZER_AUTHORITY_RUNTIME_IO_FAILED`, and retry validates/re-syncs the complete
expected set.
Every transition also binds one `ProofAuthorityDurabilityProfile`: Linux uses
file/directory fsync；Darwin is local-APFS-only and orders file `F_FULLFSYNC`,
directory fsync and same-volume sync-anchor `F_FULLFSYNC`. Unsupported
filesystem/primitive、cross-device state或profile drift在mutation前失败。Apple
documents that plain fsync alone does not guarantee power-failure durability:
<https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html>.
Capability evidence is not a bare digest: fixed-path content-addressed refs
resolve closed manifest, interruption-point power-cut trace, recovery result and
probe-runtime bytes. The profile uses reboot-stable volume identity; each
operation derives a separate live mount binding. Every boot observation carries
the verified profile digest and live binding, and each kernel helper has a fixed
entrypoint/source closure/runtime ref.
Every power command persists signed receipt and arm-receipt artifacts before
fixture mutation, then a signed execution receipt after interruption. A signed
append-only controller journal records
`ACCEPTED -> ARMED -> EXECUTION_STARTED -> ACTION_DISPATCHED -> EXECUTED`. A per-command lock and
deterministic head serialize transitions; controller restart invalidates every
nonterminal prior-epoch command and never resumes or re-executes it. One
permanent close-on-exec runtime lock is held solely by the no-child controller
for its epoch lifetime and is revalidated before power action. Its qualified
backend, locality evidence, contention evidence and epoch lease must match the
same external-controller host, complete live mount and exact opened lock
device/inode; this independently qualified controller store is not the
interrupted target environment. `core/power_controller.py` owns the external
runtime, key, store, journal and in-process actuator; its store profile passes a
separate complete physical power-loss qualification before trust promotion.
The bootstrap candidate contains only prequalification store identity; the
closed OS-specific profile enters at promotion after a distinct
qualification-only witness interrupts the controller host and all typed case
evidence passes. Its canonical P-256 key resolves a candidate-local immutable
owner authorization and signs phase-tagged evidence bound to the exact
case/run/environment; it has no production authority. Production controllers
use only canonical Ed25519 credentials. Closed key/signature schemas reject
cross-decoding or conversion, eliminating the mutable global deny registry and
its circular durability dependency. Candidate creation, witness authorization
and promotion serialize under the Gate publish lock and their applicable
bootstrap or qualified durability boundary.
The witness-signed recovery state/hash is the sole observed authority for case
PASS.
Current-epoch
duplicates may retry; prior terminal commands are read-only receipt lookups;
prior nonterminal commands are rejected. Journal transition resolution carries
the exact requested target and cannot authorize the external action; only a
separate `EXECUTE_POWER_ACTION` resolution against the current
`EXECUTION_STARTED` head first durably claims `ACTION_DISPATCHED`, then invokes
the in-process actuator once without releasing the lock or returning a bearer
authorization. Retry from an uncertain dispatched state is rejected and the
case requires a fresh command ID. Invalid current head/edge requests return a
closed typed rejection bound to the exact request; observed
`ACTION_DISPATCHED` takes precedence over stale-head classification. Before actuator invocation, both the signed dispatch
entry and compare-and-replaced head complete the qualified platform file,
directory and Darwin-anchor durability barriers. Only the original still-live
call retains the Core-generated non-serializable invocation capability needed
to match the persisted digest over the exact request digest, expected head,
command lock and process/epoch, adopt an unheaded dispatch and continue through
its single actuator call; a caller or later request cannot. Restart
creates a new epoch and never adopts it. A durable
dispatch is never replayed.
The
controller atomically consumes the hash-bound release token through
that journal; equal duplicate command IDs return the same
receipts without re-execution, while conflicts or replay fail closed.
Cancellation is split into closed accepted-origin and armed-origin journal
variants. Physical and VM interruption evidence are separate controller-kind
variants and bind all three resolved receipt domain digests and repeated
arm-receipt identities exactly; bootstrap/active branches use distinct
qualification/profile boot-observation ArtifactRef names. Arm signing uses
explicit domain-wrapped RFC 8785 UTF-8 bytes before the signed-object digest.
Interlock install也在publish lock内绑定并比较exact expected legacy latest，通过
an exhaustive operation-specific maintenance request/result matrix区分`NO_MUTATION`、
`INTERLOCK_MAY_BE_DURABLE`和`INTERLOCK_DURABLE`。
它在cleanup+publish locks内验证expected current/latest、捕获prior
pointer，冻结`activatedAt`/`activationSourceCommit`并把完整candidate enforcement
record写入pending；pending durable即为不可逆authority cutoff。D-19-aware reader和
`begin_run`在interlock未满足或pending存在时fail closed；crash
retry只能完成pending冻结的同一intent，不得rebase到之后的legacy write。新runner只发布/读取
`finalizer-enforcement/latest/<generation>.json`，永不读取legacy top-level或旧
generation latest，因此already-loaded legacy runner即使在activation scan后继续分配
或写legacy namespace，也不能污染新authority。Cleanup lock只关闭D-19-aware allocation
窗口，不虚构对旧进程的控制。Pending同时冻结canonical `current.json`；reader必须
验证其kind/schema/workspace/Gate/digest及exact generation-record binding。首次
activation另写永不删除的`activated.json` sentinel；sentinel存在而current缺失时始终
fail closed，不能恢复legacy authority。
Interlock与activation intent嵌入authorization并由各自digest覆盖。Interlock
lost-ACK retry只接受原bytes，并在重新fsync marker file和directory成功后才报告
durable；pending前activation失败必须重新授权；pending durable后
retry只能由同一kernel principal重新确认pending内原challenge并完成原intent，不能
签发替代authorization或改变approval/expected state。
任何retry若复用equal existing interlock、pending、generation、sentinel、current、
manifest、abort event或deletion plan，都必须重新fsync file及containing directory，
成功前不得推进下一durable transition。
Directory create/rename/unlink同样必须fsync全部受影响parents；tombstone rename
lost-ACK retry先复验directory identity并重新fsync source/destination parents，delete
batch在terminal event前fsync全部modified surviving parents，root unlink后fsync
`aborted-runs`。

Preflight在run allocation和任何credential/resource操作前完成三方校验；失败不分配
run。通过后，Store原子创建run directory、active lock和immutable
`finalization-requirement.json`，并把protected mapping与source exact bytes复制为
immutable ArtifactRefs后才返回live handle。历史reader不得读取current worktree。该
边界使每个已分配run及其orphan
candidate manifest在未来Catalog变化后仍可被reader/repair识别并拒绝发布。

Finalizer是detached、domain-owned的纯validator，不是Environment Provisioner bound
method。Preflight通过supervised `BUNDLE_PREPARER`一次捕获Core bootstrap、reviewed
finalizer module、contract、schema、mapping与baseline exact bytes；token绑定
process-local capture，allocation只消费一次并持久化canonical executable bundle。
Core bootstrap closure固定为pure `finalization_contracts.py`、isolated
`finalizer_worker.py`与native `finalization_supervisor.c`，Mobile registration只拥有
business source paths；business finalizer不transitively import Evidence Store。
Historical reader从persisted `ProtectedSourceArtifact` bytes按
`pt-finalizer-bundle-v1`重建完整source bundle并复验raw bundle hash，不把recorded
bundle digest当成自证事实。
Prepare、
manifest parse和expand服从固定file-count、path、manifest、entry、expanded-byte、
temporary-storage和60秒wall-time上限。相同bytes写入Evidence Store并展开到owner-only
temporary directory。ArtifactRef、bundle digest和逐文件hash在seal前、spawn前及退出
后必须一致。独立bounded进程只接收：

Preflight另以supervised `RUNTIME_CAPTURE`测量并复制supervisor/Python/compiler/
FILE-stdlib bytes到process-local capture；token绑定无run-ref measurement，allocation
持久化runtime ArtifactRefs后才构造final runtime identity，历史reader不借用host当前
runtime。Runtime capture使用`pt-finalizer-runtime-bundle-v1`固定magic、JCS manifest
和ordered length-prefixed exact file bytes；allocation和historical reader都从durable
ArtifactRefs重建同一byte stream并复验raw bundle hash。
Caller request只可提供closed supervisor/Python/compiler/FILE-stdlib
`RuntimePathInput`；loaded images由worker loader probe独占枚举，caller不能注入其
logical/origin identity。

- `workspaceId + gateId + evidenceRunId + provisioningRunId`；
- immutable Runtime Manifest ArtifactRef，以及Store-owned `RunHandle.source`中的
  source commit、workspace digest与canonical worktree hash；
- sealed `ReadOnlyEvidenceSnapshot`及其digest；
- child-safe primary status及完整primary result digest；完整result不进入child，
  由parent merge并持久化在sealed marker/finalization record供历史reader重算。

`FinalizerInput`以一个`finalizerInputDigest`覆盖invocation、context与snapshot；
三者重复的enforcement、run、source、runtime、snapshot、role与primary identity必须
逐字段相等，child/Core outcome持久化同一digest。Sealed marker还以`sealDigest`
覆盖包括`sealedAt`在内的完整对象。

Finalizer不能获得Provisioner实例、credential、raw handle、launch context或可写
RunHandle，也不接收artifact root或绝对路径。Parent把allowlisted bounded JSON
payload、payload digest与ref/hash通过stdin传入；child只返回validated role-instance
IDs。v1把它限定为reviewed trusted/no-child纯validator，禁止subprocess、
fork、setsid、network和product client；该边界不声称隔离hostile code。它返回strict
child outcome：`VALIDATED | REJECTED | BLOCKED`。`TIMED_OUT | ERROR`只由Core根据
process/protocol/identity/I/O failure合成；child返回这些状态属于invalid output。只有
`VALIDATED`可保留primary success；其它outcome、缺失required finalizer、identity mismatch或invalid output都把
primary success降级为`failed/PARTIAL/UNPROVEN`。已有primary failure保持primary，
finalizer outcome仅作为附加诊断。

v1使用由reviewed `core/finalization_supervisor.c`构建的native POSIX deadline
supervisor；source、compiler/build identity和binary hash均进入runtime identity。
Runner在run allocation前等待其`READY` handshake。每次请求由supervisor fork；child
在exec Python前建立process group、解除`SIGALRM` mask、恢复OS default disposition、
设置并复验60秒`ITIMER_REAL`并发送`WORKER_ARMED(pid, pgid)` ACK后exec，timer跨exec
保留。Supervisor parent也设置child PGID，并行执行monotonic deadline与Runner-pipe
EOF监控；ACK前direct-kill PID，ACK后kill group并以direct-PID kill作为race fallback，
最终reap。Unsupported host在preflight fail
closed。Seal-time artifact读取由同一supervisor约束的Core snapshot-materializer完成，
因为regular-file `O_NONBLOCK`不保证deadline。Finalizer不继承artifact、network或lock
descriptor；parent crash最多留下bounded、无authority的worker。
Worker request identity绑定descriptor role tuple：maintenance/materializer各一个
directory FD，bundle preparer按固定顺序接收repository-root和temporary-directory两个
FD，runtime capture接收一个temporary-directory FD，finalizer不接收FD；每个claim还
绑定sender-side device/inode/type和logical owner digest，独立identity digest覆盖
worker kind与ordered claims。Receiver逐项`fstat`
等值；arity/order/object identity任一不符都fail closed。
Stream control channel只接受closed `SupervisorControlFrame` union，SCM_RIGHTS
datagram只接受identity-correlated `DescriptorTransferFrame`；active cancellation必须
由runner发送`WORKER_CANCEL_REQUEST`并由supervisor kill/reap后确认。Request
kind/type/result/descriptor row、frame identity/digest、PID/PGID/timer或close/reap
transition不一致时立即fail closed。

Runner只在当前live `RunHandle`中执行一次finalizer并验证process envelope；Evidence
Store只在supervisor完成bounded close/reap后接收primary result与typed outcome，并独占
单调merge、manifest finalize和generation-scoped publish。Supervisor protocol/process
failure先进入`FAILED`，随后必须经`CLOSING`完成kill/reap才进入`CLOSED`；无法reap时
不得构造manifest或publish。Process-local reservation原子执行
`READY -> INVOCATION_STARTED -> OUTCOME_CACHED -> MANIFEST_PREPARED ->
MANIFEST_DURABLE -> LATEST_RESOLVED`并拒绝重复启动child；immutable manifest使用
no-replace，generation latest在publish lock内沿用D-11 `(completedAt, runId)` atomic
replace，结果明确为`PUBLISHED | ALREADY_CURRENT | SUPERSEDED`。同一live Runner只可
重放冻结的candidate bytes。每个state是closed reservation variant，结构上固定其
required/null cached fields。任意runner crash都不续跑、
不补写、不发布该run；sealed incomplete
run保持`UNPROVEN`，普通retention/delete拒绝处理。唯一删除入口是显式
`abort-sealed`：live run存在时按
`cleanup -> active -> finalization -> publish -> abort`获取锁并等待Core watchdog ceiling加5秒
grace，以append-only event记录authorization，把run原子rename到同文件系统
`aborted-runs/` tombstone，再递归删除并写`DELETED/FAILED` event；crash后只能由显式
同身份abort继续。Reader/repair拒绝authorization或tombstone对应的run ID，不使用
PID/process matching。全部锁以non-blocking try/retry和60秒aggregate monotonic
ceiling获取；超时无副作用地失败。只有verified
latest pointer是权威proof；D-11 repair拒绝required-finalizer orphan manifest。
V1 authorization只由Evidence Store local interactive CLI签发：先展示影响面，再由
controlling TTY确认exact digest challenge；operator principal取自kernel effective
UID，reason来自closed enum。Retry必须匹配durable authorization ID/principal/reason，
不能由参数伪造operator identity。Abort CLI同样通过source-only authority bootstrap
运行，并把clean source commit、完整claim-source closure与maintenance runtime identity
绑定进authorization/challenge及后续event projection。
Tombstone operation在删除前持久化bounded immutable deletion plan。Abort events以
sequence/previous digest形成单一chain，FAILED event持久化plan-index continuation。
每个batch在首个delete前额外durably发布绑定exact immutable plan range的
`DELETE_BATCH_STARTED`；只有该event未闭合时，crash retry才可把range内missing entry
视为先前授权进度。没有started event、range外missing或present identity mismatch都
fail closed且不delete；present identity比较包含byteLength。Equal existing event必须
重新fsync file与directory后才能授权下一mutation。下一显式调用必须携带chain-head digest/token，不依赖mutable
directory offset或丢失response。Tombstone root以explicit final plan entry绑定
device/inode/type，并由同一started range授权删除，不存在implicit root delete。
ByteLength只绑定regular file；directory size会随descendant删除而变化且必须为null。
Traversal遇到其它filesystem type或不同device直接拒绝；Linux使用
`RESOLVE_NO_XDEV`阻止mount/bind-mount crossing。Darwin/其它POSIX的destructive abort
在authorization/rename/delete前由CLI返回
`AbortSealedPreflightRejected/NO_MUTATION`和
`ABORT_SEALED_DELETE_UNSUPPORTED`，不启动worker且不使用`st_dev`近似。
Plan位于
gate-scoped abort control namespace并使用专用fixed-path ref，不冒充run ArtifactRef。
Invalid delete identity/request/durable state使用zero-delta `NO_MUTATION` rejection，
不得为了返回错误而追加FAILED event。
Requirement或seal identity损坏时，v1把run保留为quarantined forensic orphan；不提供
corrupt-record deletion reason，也不允许普通retention/delete绕过。
Every abort event embeds one immutable `AbortEventAuthorizationProjection` copied
byte-for-byte from `authorized.json`; later events cannot substitute operator,
reason, workspace/run, snapshot, requirement or challenge while retaining only the
authorization ID.
该选择避免第二套recovery、journal和publication状态机。

### Rationale

该边界让cleanup-produced evidence参与最终判定，同时保持Gate、Provisioner、
Acceptance Infra和Evidence Store的单一职责。

### Alternatives Considered

- Gate在cleanup前验证完整证据：拒绝，证据尚不存在。
- Gate child执行Provisioner cleanup：拒绝，复制authority owner。
- finalize后追加artifact：拒绝，破坏Evidence Store不可变性。
- Mobile专用runner分支：拒绝，形成业务化Infra。
- Provisioner bound method：拒绝；cleanup后的对象仍可能持有credential、raw handle、
  broker和可写ArtifactSession，无法形成detached read-only boundary。
- Runner进程内直接调用validator：拒绝；不可协作的阻塞或死循环无法hard-timeout，
  会让active run永久停在publish前。

### Consequences

- Runner增加跨进程artifact seal、generated finalizer registration catalog和bounded
  subprocess。
- v1 D-19 finalizer仅在通过POSIX hard-timeout preflight的host执行；其它host保持
  `BLOCKED/UNPROVEN`，后续backend需要独立架构决策。
- Business contract module拥有Artifact Role与validator；Infra只解释generic identity、
  snapshot、timeout和结果合并。
- 声明finalizer的Gate必须完成原子cutover；没有声明的现有Gate行为不变。
- 运维执行interlock/activation需要local controlling TTY、可解析的accepted D-19
  source document和显式digest challenge；无人值守发布不得绕过该authority gate。
- 当前位于`gates/mobile/proof_contracts.py`的共享Mobile contract在落地时迁移到
  neutral business-contract module；同目录schema、tests、docs与全部imports在同一
  原子变更迁移，旧module/schema路径删除且不保留compatibility re-export。
- Owner明确接受v1 availability consequence：若`activation-pending.json` durable后
  原kernel principal永久丢失，系统保持永久fail-closed；本次接受不授权替代principal、
  abort、supersede、rebase或rollback frozen intent。

### Reversal Trigger

如果所有业务cleanup evidence都能在Gate退出前由唯一owner安全产生，可移除该扩展；
不得用提前proof或mutable finalized run代替。
