# 统一客户端架构 Plan 独立评审提示

请以 findings-first 方式独立评审：

- `plan.md`
- `tasks/*.md`（UCA-01、02、03、04A、04、05A、05、06、08）
- `outcome-comparison.md`
- 上游 `../../README.md`、`../../design.md`、`../../decisions.md`、
  `../../data-model.md`、`../../module-layout.md`、`../../integration.md`

## 评审目标

判断该 Plan 是否能在不制造第二真源的前提下，把 Desktop、Android、iOS 收敛为：

- 两个 Client Form；
- 三个 release target；
- Model contract truth；
- Station business truth；
- portable Rust cores；
- shared TypeScript/headless semantics；
- Desktop/Mobile Presentation Policy；
- Desktop/Android/iOS typed Host adapters；
- current-source runtime-cell evidence。

## 必查问题

1. **Owner 是否唯一**
   - Messaging、Secure Content 是否真的 hard cut 到一个 canonical
     owner，而不是在 facade 后继续保留两套实现？
   - Applet 是否诚实保持非目标，且没有在 Kernel owner 未决时夹带实现？
   - Station、Model、portable core、client runtime、Host、Presentation Policy 的
     authority 是否混淆？

2. **复用是否真实**
   - 是否优先扩展现有 `messaging-core`、`secure-content-core` 和 `client-*`？
   - 是否存在不必要的新 package、第二 DTO、第二 state machine 或第二 retry owner？
   - Desktop/Mobile 合理的 Presentation Policy 差异是否被错误合并？

3. **Task 是否原子且可执行**
   - 每个 Task 是否形成垂直闭环，依赖关系是否真实？
   - writeSet 是否过宽、遗漏或跨越 source claim？
   - UCA-08 是否只消费 child evidence，不重复 provision 或在验收旁修业务源码？
   - 多场景 native 任务是否复用一个 Suite Runtime？

4. **迁移是否无双轨**
   - 旧 engine/store/worker/kernel 的删除条件是否机械可查？
   - external wire/persisted data compatibility 是否与 internal hard cut 分离？
   - 是否存在 feature flag、dual-write、compatibility facade 或隐藏 fallback？

5. **证据是否足够**
   - Android、iOS、Desktop 是否分别证明，且绑定同一 current source？
   - 共享单测、模拟器、Harness 或 API evidence 是否被错误扩大成 Host / UX 证明？
   - Gate 是否真实存在、范围匹配，并能证明 `doneWhen`？

6. **对比报告是否诚实**
   - 每个执行前事实是否有源码/审计依据？
   - 用户体验、产品能力、架构、技术和质量运维五个维度是否都可被人直接理解？
   - 是否描述了具体用户 Journey，而不是笼统写“体验提升”？
   - 每个目标态是否映射到 Task 与 Gate？
   - 是否清楚区分预期、实际与 `UNPROVEN`？
   - 计划区摘要是否进入 Plan digest，实际结果是否只按 current-source evidence
     回填？
   - `PASS/PARTIAL` 是否同时具有源码身份、证据和偏差说明？

## 输出格式

先列问题，按 `P0 / P1 / P2` 排序。每项必须包含：

- 文件与行号；
- 被违反的架构决定或 Plan 合同；
- 具体失败场景；
- 最小但长期正确的修复方向。

若无阻塞问题，明确写：

```text
VERDICT: APPROVABLE_AFTER_USER_CONFIRMATION
```

并列出剩余非阻塞风险。不要把 Plan 校验通过、文档完整或命令存在等同于实现已完成。

## 机械校验

```bash
make plan-validate \
  PLAN=docs/architecture/platform/client/cross-client-runtime/execution-plans/20261017-unified-client-architecture/plan.md

node tooling/scripts/plan/planctl.mjs inspect \
  --plan docs/architecture/platform/client/cross-client-runtime/execution-plans/20261017-unified-client-architecture/plan.md

node tooling/scripts/architecture/module-governance.mjs validate

git diff --check -- \
  docs/architecture/platform/client/cross-client-runtime
```
