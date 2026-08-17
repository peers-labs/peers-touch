# Acceptance Framework

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-06-03 | **Updated**: 2026-08-17
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 1. Document Scope

本文档集定义：

- Peers-Touch 产品级验收框架的架构边界。
- Capability、feature contract、gate、evidence、report 的职责关系。
- AI agent 如何在可控边界内选择、执行和解释验收。
- 非 local Gate 如何获取 Profile、服务、Fixture、凭据引用和 source attestation。
- Agent 如何在普通开发任务中发现并上报 Acceptance 责任缺口。
- Runtime evidence如何在source tree之外隔离、持久化、引用和清理。
- Federation 与 Acceptance Framework 双边互验证的架构闭环。
- 新产品域如何按统一标准接入项目级 acceptance。

本文档集不定义：

- 单元测试、语言级测试或包内测试的编码规则。
- 某个具体产品功能的业务设计。
- CI/CD 平台实现细节、具体账号密钥和远程主机配置。
- 临时调试探针；临时探针必须沉淀为 stable gate 后才能成为验收能力。

---

## 2. 背景与问题

AI agent 可以更灵活地分析变更影响，但如果完全依赖临场推理，验收范围会漂移、token 成本会扩散、质量结果难以复现。

传统固定流水线稳定但容易过度僵化：新功能出现时，流水线不知道能力边界，也不知道应该验证哪个用户路径、哪个事实源、哪个负向约束。

因此 Peers-Touch 需要一个产品级 Acceptance Framework：

- 用机器可读 contract 固化“能力是什么”。
- 用 registry 固化“路径变更影响哪些能力”。
- 用 gates 固化“如何重复证明能力仍成立”。
- 用 reports 固化“哪些已证明，哪些未证明，哪些需要人审”。
- 用 Federation 这种跨 Station / Dashboard / Desktop / testnet 的复杂域验证框架本身不是纸面流程。

---

## 3. 设计目标

1. Acceptance 是产品能力证明层，不替代单元测试。
2. Capability 是一等模型，不能只由脚本名或路径规则隐式表达。
3. Feature contract 绑定事实源、可见面、负向约束和 required gates。
4. Registry 只做影响映射，不直接表达业务语义。
5. Gate 是稳定、可重复、可运行的证据生产器。
6. Report 输出 proven / unproven scope，供人审阅，而不是让用户早期反复手测。
7. Federation 与 Acceptance 必须双向证明：Acceptance 证明 Federation，Federation 证明 Acceptance。
8. Station Dashboard、Chat 等产品域必须作为 managed domain 接入，验证框架可泛化，而不是复制 Federation 特例。
9. 非 local Gate 必须通过 Environment Provisioning Contract 形成 runtime manifest 后才能执行。
10. 缺少 contract、resource 或 evidence 时必须结构化上报并保持 `UNPROVEN`，禁止 silent pass。

---

## 4. 文档导航

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | 架构原则、分层模型、核心契约、Core Runtime 抽象和执行闭环 |
| [decisions.md](./decisions.md) | 关键设计决策与替代方案（D-01 ~ D-11） |
| [data-model.md](./data-model.md) | Provisioning、Evidence Store、ArtifactRef、Run Manifest 与状态机 |
| [module-layout.md](./module-layout.md) | Core Runtime 与 Environment Provisioning 的目标目录、职责和禁止依赖 |
| [integration.md](./integration.md) | 现有变量/Profile/Fixture/Gate 到 runtime manifest 的映射与影响面 |
| [domain-onboarding.md](./domain-onboarding.md) | 产品域接入标准、状态模型和验收标准 |
| [execution-plans/phase-2-station-dashboard-domain-onboarding.md](./execution-plans/phase-2-station-dashboard-domain-onboarding.md) | Station Dashboard managed domain 接入计划 |
| [execution-plans/phase-3-chat-domain-onboarding.md](./execution-plans/phase-3-chat-domain-onboarding.md) | Chat managed domain 接入计划与设计落地反思 |
| [execution-plans/20260815-tauri-driver-desktop-ui-gate.md](./execution-plans/20260815-tauri-driver-desktop-ui-gate.md) | macOS native Tauri embedded WebDriver DOM Gate 执行计划 |
| [execution-plans/20260816-runtime-provisioning-contract-implementation.md](./execution-plans/20260816-runtime-provisioning-contract-implementation.md) | Runtime Provisioning Contract 实现计划（No Silent Pass 落地） |
| [execution-plans/20260817-acceptance-evidence-store.md](./execution-plans/20260817-acceptance-evidence-store.md) | Runtime evidence source-tree外迁与atomic Evidence Store执行计划 |
| [execution-plans/20260817-domain-structural-validation-context-anchor.md](./execution-plans/20260817-domain-structural-validation-context-anchor.md) | Domain structural closure 与 Context Anchor 治理修复计划 |

当前Evidence Store architecture由`D-11`约束：

- Runtime-generated artifacts必须位于repository之外；
- canonical platform default加可选`PT_ACCEPTANCE_ARTIFACT_ROOT` override；
- immutable run manifests与atomic `latest.json` pointer；
- writer/readers/validators/cleanup共享唯一resolver；
- source tree只保留code、schemas、templates和intentional fixtures。

---

## 5. 相关文档

- [Federation Architecture](../federation/README.md) — 双边互验证的首个复杂产品域。
- [Federation Phase 2 Plan](../federation/execution-plans/phase-2-product-governance-trust.md) — Federation 当前产品治理与验收计划。
- [Project Docs Entry](../../README.md) — 文档层级与当前真源规则。
- [`pt-acceptance-engineering`](../../../tooling/skills/pt-acceptance-engineering/SKILL.md) — Acceptance 补齐、升级与审计入口。
