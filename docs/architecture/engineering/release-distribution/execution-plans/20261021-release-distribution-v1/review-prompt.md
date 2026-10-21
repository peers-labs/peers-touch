# Plan Review Prompt — RD-20261021-v1

> **Plan**: `docs/architecture/engineering/release-distribution/execution-plans/20261021-release-distribution-v1/plan.md`
> **Version**: RD-20261021-v3（v2 FUNCTIONAL_CHECK 恒绿修复，jq -e 断言已实测退出码）
> **Digest**: `a1b30485147f760aa968c690f95e5aa4ead20aa219eefab426c3fd0dd64b44c3`
> **Validation**: `make plan-validate` → `ok:true`

## Sources

- Architecture: `docs/architecture/engineering/release-distribution/{README,design,decisions,integration,module-layout}.md`
- Decisions: RD-D01 .. RD-D14 (all accepted in design)
- Validator: `tooling/scripts/plan/plan-package.mjs`

## Review Scope

输出 `通过 / 有条件通过 / 需要修改` + source-backed findings：

1. **Closure verticality**：每个 Task 是否是端到端纵向闭环，而非按技术层横切（前端/后端/测试分 Task）。
2. **Dependency fidelity**：DAG 是否反映真实 producer/consumer（镜像源默认翻转 → GHCR job → install Journey/desktop 矩阵；tag 触发器摘除的独立性）。
3. **Cutover/deletion**：clean cut 与回滚边界是否完整；有无悬空双路径（T03 finalize needs 与 T05 桌面 job 接入的中间态）。
4. **Evidence**：Gate/检查是否映射到具体风险或设计质量门（design §7），有无通用套餐式场景；functional/source 运行时类是否合法。
5. **Claim boundary**：rc 演练 vs 正式发布的证明边界；E20 实测项、operator workflow_dispatch、GHCR public 等外部前置是否被误报为自动完成。
6. **Task sizing**：每个 Task 是否能由一次 bounded execution 直接验证 doneWhen。
7. **Scope discipline**：Task 是否重新设计架构或引入 design 之外的行为；writeSet 与 sourceClaims 是否自洽。
