# Cross-Station Social Native Desktop - Review Prompt

你是 Peers-Touch 产品、架构与执行计划评审专家。请审阅 Native Desktop
跨 Station Social 计划，不执行代码。

## 计划背景

Same-Station Private Moments 已完成 Desktop 正式验收。下一步是在两个真实
Station 间支持私密 Post、媒体、Comment、Reaction、恢复与撤销。Browser Social
明确禁止，Mobile 延后独立计划。

## 上游产品与架构

- `docs/architecture/social/product-definition.md`
- `docs/architecture/social/experience-contract.md`
- `docs/architecture/social/product-state-model.md`
- `docs/architecture/social/acceptance-matrix.md`
- `docs/architecture/federated-social-activity/design.md`
- `docs/architecture/federated-social-activity/decisions.md`
- `docs/architecture/federated-social-activity/data-model.md`
- `docs/architecture/federated-social-activity/integration.md`
- `docs/architecture/secure-content/README.md`
- `docs/architecture/federation/README.md`
- `docs/architecture/api-ownership/README.md`

## 计划路径

`docs/architecture/federated-social-activity/execution-plans/20261003-cross-station-social-native/plan.md`

## 评审维度

1. 产品范围是否完整覆盖 Desktop Native 正向跨站 Social，同时严格排除 Mobile 和 Browser。
2. 作者 Home Station 单一 authority、接收 Station viewer-scoped projection 是否成立。
3. Remote Content PreKey claim 的 exact replay、部分 claim 和 crash 语义是否充分。
4. Federation frame 是否做到 per-actor metadata minimization、原子 outbox/inbox 和有序撤销。
5. 大对象 peer stream 是否保持 Social object authority、range/hash/grant 安全边界。
6. Comment/Reaction 是否始终回到源 Post authority，unknown outcome 是否可恢复。
7. 依赖顺序、并行单元和 atomic cutover 是否避免双写、兼容 shim 和半迁移。
8. `SOC-SEC-AS17..AS24` 是否覆盖成功、失败、超时、断线、重复、重启、恢复和攻击面。
9. Browser 零注册 Gate 是否足以证明 Social 产品面不可达。
10. 当前源代码证据是否遗漏任何调用方、存储、生成代码或运行时 owner。

## 输出格式

### 总体判断：[通过 / 有条件通过 / 需要修改]

### Blocking Findings

- `[severity] <finding>`：引用具体文档、决策或代码路径，并说明必须如何修正。

### Non-Blocking Findings

- `<finding>`：说明改进建议及风险。

### Gate Verdicts

- Product: `passed | changes required`
- Architecture: `passed | changes required`
- Plan: `passed | changes required`
- Recommended next state: `PLAN_READY_FOR_EXECUTION | PRODUCT_AMENDMENT_REQUIRED | DESIGN_AMENDMENT_REQUIRED | PLAN_AMENDMENT_REQUIRED`
