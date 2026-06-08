# Acceptance Domain Onboarding — 接入标准

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-06-03 | **Updated**: 2026-06-04
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
| `mobile` | `planned` | `not_onboarded` | 待补 mobile-web / Tauri mobile / native plugin boundaries |
| `applet` | `planned` | `not_onboarded` | 待补 applet SDK / runtime capability contracts |
