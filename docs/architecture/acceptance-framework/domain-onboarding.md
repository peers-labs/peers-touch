# Acceptance Domain Onboarding — 接入标准

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-06-03 | **Updated**: 2026-09-02


> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 1. 目标

Acceptance Domain Onboarding 的目标是让任何产品域以统一方式接入项目级 acceptance，而不是复制 Federation 特例。

产品域接入后必须能回答：

- 这个 domain 有哪些产品能力需要被证明。
- 每个能力的业务事实源是什么。
- 哪些用户 / 运维可见面需要被验收。
- 哪些 gates 能稳定产生 evidence。
- 哪些范围仍然没有 stable gate，必须显式标记为 unproven。

### 1.1 Agent 执行入口

Agent 收到“新增、补齐、升级或审计 Acceptance”的请求时，必须先调用
[`pt-acceptance-engineering`](../../../tooling/skills/pt-acceptance-engineering/SKILL.md)。
该 Skill 负责：

- 区分 `ADD`、`COMPLETE`、`UPGRADE`、`AUDIT` 四种工作模式。
- 盘点现有 Domain / Capability / Feature / Registry / Gate / Evidence。
- 生成 Coverage Gap Matrix，区分 `PROVEN`、`STRUCTURAL_ONLY`、`PARTIAL`、
  `UNPROVEN`、`STALE` 和 `BLOCKED`。
- 根据缺口确定性调度 PRODUCT、DESIGN、PLAN、EXECUTE 或 REVIEW 阶段。
- 强制按 Feature → Capability → Domain → Registry → Gate → Evidence 的依赖顺序接入。

`pt-god-view` 只负责识别 Acceptance 意图并转发给该 Skill，不得自行推导
接入流程或直接从 Gate 实现开始。

---

## 2. 接入产物

每个 domain 至少需要以下产物：

| 产物 | 路径 | 职责 |
|------|------|------|
| Domain index entry | `tooling/acceptance/domains/index.yaml` | 声明 domain 状态、profile、coverage 和备注 |
| Domain profile | `tooling/acceptance/domains/<domain>.yaml` | 选择该 domain 参与验证的 capabilities |
| Capability file | `tooling/acceptance/capabilities/<domain>.yaml` | 定义 domain 能力、evidence、proven/unproven scope |
| Feature contracts | `tooling/acceptance/features/*.yaml` | 定义事实源、required gates、验收行为和负向约束 |
| Registry rules | `tooling/acceptance/registry.yaml` | 把代码路径映射到 features 和 gates |
| Gate catalog entries | `tooling/acceptance/gates.yaml` | 声明稳定 gate 命令、环境、超时和说明 |
| Gate implementations | `tooling/acceptance/gates/<domain>/**` | 实际产生可重复 evidence |

可从以下模板开始：

- `tooling/acceptance/templates/domain.yaml`
- `tooling/acceptance/templates/capability.yaml`
- `tooling/acceptance/templates/feature.yaml`

---

## 2.1 Gate Environment Wiring

Gate catalog、environment contract 和 Provisioner 必须形成一个可执行闭包。
`acceptance-run.py` 直接从 `gates.yaml` 发现 Gate；独立 Make target 是可选的人机
入口，不是 Gate discovery 的前置条件。

### All Gates

| Step | File | Required change |
|------|------|-----------------|
| Stable command | `tooling/acceptance/gates.yaml` | `command` 必须能从 repo root 执行；优先 `python3 -m <module>`，直接执行文件时由 runner 自行完成 import bootstrap |
| Gate tier | `tooling/acceptance/gates.yaml` | 声明 `ci-structure`、`ci-cheap`、`local-evidence`、`env-evidence`、`nightly` 或 `release` |
| Optional Make entry | `tooling/make/acceptance.mk` | 仅当该 Gate 需要稳定的人类/CI 快捷入口时添加；普通 plan/run discovery 不要求逐 Gate Make target |

### Non-Local Gates

每个 `environment != "local"` 的 Gate 还必须完成：

| Step | File | Required change |
|------|------|-----------------|
| Provisioner binding | `tooling/acceptance/gates.yaml` | 设置 `"provisioner": "<environment-id>"`，且必须与 `environment` 完全一致 |
| Environment contract | `tooling/acceptance/environments/<environment-id>.yaml` | 文件存在、可解析，且 contract `id` 与文件名/environment 一致 |
| Provisioner registration | `tooling/acceptance/provisioners/__init__.py` | `_PROVISIONERS` 能按 environment ID 解析 Provisioner class |
| Gate roles | Domain Provisioner | 注册 Gate 所需 service、actor、client、Fixture 和 credential roles；每个 required service 必须产生 ID/kind 匹配的 attestation |
| Client service bindings | Environment contract | 每个 client 必须显式声明 `required_service_roles`；需要服务时通过 `service_bindings[role]` 引用稳定 service ID 并声明 required kind，无服务依赖时显式声明空列表；不得保存 endpoint 副本 |
| Runtime consumption | Platform Runtime Binding + Gate runner | Runtime Binding 通过 `create_bound_session(client_id, launch_options)` 分配 launch generation，按每个 required role 从 live connection state 读取 identity，并绑定既有 D-13 runtime-instance identity；每个 role 验证并自动登记 proof 后才返回 session。`launch_options` 必须使用平台 closed schema；Gate 不得传入 generation、任意环境变量、service URL、service identity、legacy `station` 或其他拓扑字段 |
| Fault transport | Platform Runtime Binding + Domain Gate | Domain Gate 可提供本地 fault proxy，但只能通过 Runtime Binding 获取和应用 opaque `TransportOverrideHandle`；Gate 不得读取 routable proxy URL，override 不得替代 canonical service binding 或 proof |
| Ephemeral capability consumption | Gate runner | durable truth只按`services[service-id]`消费immutable Runtime Manifest；process-local authority只允许使用D-18声明的ephemeral capability client；不得自行部署、猜测primary service、读取legacy `station`或回退环境变量 |

Native Tauri Gate 还必须通过 `acceptance-driver-build` 产出专用 binary，并通过
`tooling/acceptance/drivers/tauri.py` 的公开入口解析 binary。具体路径属于 Driver
contract，不应复制到业务 runner。

### Structural Verification

`make acceptance-validate DOMAIN=<domain>` 只检查所选 Domain 的 Capability /
Feature / Gate closure，并 fail closed：

- `STRUCTURAL_GAP`：Feature、Capability 或 Domain validation Gate 引用了不存在的
  Gate；
- `PROVISIONING_WIRING_MISSING`：非 local Gate 未声明
  `provisioner == environment`；
- `ENVIRONMENT_CONTRACT_MISSING`：缺少 environment contract；
- `ENVIRONMENT_CONTRACT_INVALID`：contract 无法解析或 ID 不一致；
- `PROVISIONER_UNREGISTERED`：contract 无法从 Provisioner registry 解析。

这些校验没有 bypass 参数。某业务 Domain 的注入缺口只阻塞该 Domain，不得阻塞
无关 Domain。

验证闭环：

1. `make acceptance-validate DOMAIN=<domain>` 通过结构校验。
2. `make acceptance-plan ACCEPTANCE_RANGE=HEAD` 能从 owned paths 选择 Gate。
3. `python3 tooling/scripts/acceptance-run.py --gate <gate-id>` 在资源缺失时产生
   structured `BLOCKED/UNPROVEN`，资源就绪时产生真实 `PASS/FAIL`。
4. 若存在可选 Make target，其行为必须等价于同一 `acceptance-run --gate` 入口。

---

## 3. 状态模型

`tooling/acceptance/domains/index.yaml` 中的 domain status 使用以下含义：

- `active`：已接入并可通过 `make acceptance-validate DOMAIN=<domain>` 验证。
- `candidate`：适合作为下一批接入对象，但缺少完整 profile / gates。
- `planned`：已识别为项目域，但尚未接入。
- `deprecated`：曾经接入但不再作为 active acceptance domain。

`coverage` 使用以下含义：

- `project_validation_domain`：该 domain 不仅被 acceptance 验证，也用于反向证明 acceptance 有效性。
- `managed_domain`：该 domain 被 acceptance 管理，但不承担框架自证职责。
- `partial`：已有部分 contracts/gates，但不能完整验证 domain 能力。
- `not_onboarded`：尚未接入。

---

## 4. 接入流程

1. 在 `tooling/acceptance/domains/index.yaml` 添加 domain entry，初始状态通常是 `candidate` 或 `planned`。
2. 从 `tooling/acceptance/templates/feature.yaml` 创建 feature contracts，先写事实源和负向约束，再写 gates。
3. 从 `tooling/acceptance/templates/capability.yaml` 创建 capability entries，必须包含 `synthetic_paths` 和 `unproven_scope`。
4. 从 `tooling/acceptance/templates/domain.yaml` 创建 domain profile，引用 `acceptance-framework-self-consistency` 和 domain capabilities。
5. 在 `tooling/acceptance/registry.yaml` 添加路径映射，确保 synthetic paths 能命中期望 feature/gate。
6. 在 `tooling/acceptance/gates.yaml` 注册 stable gates。
7. 运行 `make acceptance-validate DOMAIN=<domain>`，直到 profile / capability / registry / gate 关系自洽。
8. 运行 `make acceptance-coverage-report`，确认项目级覆盖状态被正确展示。

---

## 5. 接入边界

必须遵守：

- Domain profile 只能引用 capabilities，不能重新定义 acceptance core。
- Capability 必须声明业务事实源，不能把 UI/cache/event stream 当成 truth source。
- Gate 只能产生 evidence，不能承载业务完成语义。
- 多服务场景必须在 Environment Contract 注入 client-to-service bindings；具体
  Station/profile/actor 属于业务注入，但 binding parser、validator 和 lookup
  helper 属于 Acceptance Infra。
- Unproven scope 必须显式列出，不能用 smoke 代替完整 E2E。
- Federation 只是第一个 validation domain，不是其它 domain 的模板代码来源。
- Station Dashboard 是第一个 managed domain 示例；其它普通产品域应复用 onboarding 标准，而不是复制 Federation 的双边互验证语义。
- Chat 是第一个用户主路径 managed domain 示例；它必须区分 persistence truth、realtime delivery 和 Desktop typed surface，不能把 typed check 说成完整用户体验 E2E。

---

## 6. 验收标准

一个 domain 完成 onboarding 的标准：

- `tooling/acceptance/domains/index.yaml` 中状态为 `active`。
- `make acceptance-validate DOMAIN=<domain>` 通过。
- `make acceptance-coverage-report` 能显示该 domain 的 capabilities、proven scope 和 unproven scope。
- 变更 domain owned paths 后，`make acceptance-plan` 能自动选择 required gates。
- 该 domain 的报告能解释“已证明什么 / 未证明什么 / 需要人审什么”。

---

## 7. 当前接入状态

| Domain | Status | Coverage | 说明 |
|--------|--------|----------|------|
| `federation` | `active` | `project_validation_domain` | 首个复杂验证域，用于双边互验证 |
| `station-dashboard` | `active` | `managed_domain` | 首个普通产品域，验证 onboarding 标准可泛化 |
| `chat` | `active` | `managed_domain` | 首个用户主路径 domain，覆盖 persistence / Station runtime message flow / live realtime delivery / realtime typed contract / Desktop typed surface |
| `mobile` | `active` | `managed_domain` | 结构接入完成；iOS Simulator/Android Emulator product proof 在对应 required Gates 通过前保持 `UNPROVEN`，真机仅为可选诊断 |
| `applet` | `active` | `managed_domain` | Domain 契约和 local lifecycle Gate 已接入；Python Core wrapper、原生可见流程和 Mobile 仍为未完成/未证明范围 |
