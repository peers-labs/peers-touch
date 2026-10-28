# Comparative Experience Review Plan 独立评审提示

请以 findings-first 方式评审：

- `plan.md`
- `tasks/CER-01.md`
- `tasks/CER-02.md`
- `tasks/CER-03.md`
- `outcome-comparison.md`
- 上游 `../../comparative-experience-review.md`
- 上游 `../../design.md`、`../../decisions.md`、`../../data-model.md`、
  `../../module-layout.md`、`../../integration.md`

## 必查问题

1. 三个 Task 是否各自形成完整 vertical closure，而不是 schema、代码、测试、
   文档分层拆任务。
2. reference 是否始终使用 identity-neutral observation，未被 Peers UI Grammar
   或 Product Contract 反向约束。
3. blind artifact 是否字段同形，任何 Peers binding、owner 或 disposition 是否都
   在 accepted blind review 后才可读取。
4. digest、source fence、review independence 和 stale invalidation 是否覆盖完整
   artifact chain，而非只检查引用存在。
5. causal status 是否严格区分 observed、supported 和
   intervention-confirmed。
6. Target projection 是否只消费 accepted adopt / adapt，并保持 active Product
   authority 不变。
7. calibration 与 framework blind A/B 是否明确分离，source check 是否没有被
   扩大为增量价值 PASS。
8. CLI、Skills、registry、active docs 与 source-version 是否同批切换且没有第二
   真源、compatibility shim 或 legacy compare path。
9. Outcome Comparison 是否覆盖用户体验、产品能力、架构、技术和质量运维五个
   维度，并保持初始 Actual Results 为 `UNPROVEN`。

## 输出

先按 `P0 / P1 / P2` 列 findings。每项包含文件/行号、违反的合同、失败场景和长期
正确的修复方向。若没有阻塞项，输出：

```text
VERDICT: PLAN_MODEL_READY
```

不要把 Plan 校验通过、测试命令存在或文档完整等同于实现已完成。

## 机械校验

```bash
make plan-validate \
  PLAN=docs/architecture/engineering/experience-design/execution-plans/20261022-comparative-experience-review/plan.md

node tooling/scripts/plan/planctl.mjs inspect \
  --plan docs/architecture/engineering/experience-design/execution-plans/20261022-comparative-experience-review/plan.md

env PATH=/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.cargo/bin:/opt/homebrew/bin \
  node tooling/scripts/architecture/module-governance.mjs validate
```
