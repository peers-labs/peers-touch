# Comparative Experience Review：执行前后效果对比

> **Plan**: `CER-20261022`
> **Version**: `20261022-portable-toolchain-closure`
> **用途**: 实施前冻结预期效果，实施后按当前源码回填实际结果
> **当前阶段**: 实施前，全部结果为 `UNPROVEN`

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "CER-20261022",
  "plannedSectionDigest": "sha256:b65b72e00ef466c5529c914e29b51f5a76102ddb423dd1c421598eb0f23e1f5b",
  "criteria": [
    {
      "id": "CER-O01",
      "dimension": "user-experience",
      "title": "Agent 输出重大体验差距而不是功能清单",
      "taskIds": [
        "CER-01",
        "CER-02",
        "CER-03"
      ],
      "gateIds": []
    },
    {
      "id": "CER-O02",
      "dimension": "product-capability",
      "title": "同 Journey 比较产生 Peers-owned Target Contract proposal",
      "taskIds": [
        "CER-01",
        "CER-02",
        "CER-03"
      ],
      "gateIds": []
    },
    {
      "id": "CER-O03",
      "dimension": "architecture",
      "title": "中立 observation、盲态判断与 reveal disposition 职责分离",
      "taskIds": [
        "CER-01",
        "CER-02",
        "CER-03"
      ],
      "gateIds": []
    },
    {
      "id": "CER-O04",
      "dimension": "technology",
      "title": "比较 package、digest、CLI 和 projection 可确定性重算",
      "taskIds": [
        "CER-01",
        "CER-02",
        "CER-03"
      ],
      "gateIds": []
    },
    {
      "id": "CER-O05",
      "dimension": "quality-operations",
      "title": "stale、泄漏、不可比、因果过度声明和越权投影 fail closed",
      "taskIds": [
        "CER-01",
        "CER-02",
        "CER-03"
      ],
      "gateIds": []
    }
  ]
}
```

## Planned Outcome Comparison

### CER-O01: Agent 输出重大体验差距而不是功能清单

- Before: 当前 EDX 只评估一个 candidate 与一个 Peers contract；普通 benchmark
  prompt 可以输出功能、页面和视觉差异，但没有同条件 Outcome Oracle 约束。
- Target: Agent 只把同 Oracle assertion、可比证据、最早 divergent state、用户
  后果和机制等级闭合的差异列为 material delta。
- Expected effect: 对标输出可直接进入 owner review，不再以“多一个入口、少一个
  按钮、布局不像”代替用户结果差距。
- Non-claim: Source tests 不证明所有未来对标都能找到正确重大差距。

### CER-O02: 同 Journey 比较产生 Peers-owned Target Contract proposal

- Before: benchmark disposition 与具体 Experience Contract 之间缺少机器绑定，
  建议容易停留在文字或直接变成 UI 模仿。
- Target: adopt / adapt 必须经过独立 disposition review，随后投影包含 capability、
  Journey、state、acceptance 和 evidence requirement 的 Target Contract proposal。
- Expected effect: 被接受的差距有明确 owner、合同改动和证明要求；reject / defer
  也保留理由和 reopening condition。
- Non-claim: Target projection 不自动修改 active Product / Client contract。

### CER-O03: 中立 observation、盲态判断与 reveal disposition 职责分离

- Before: reference product 若直接套入 Peers UI Grammar 会产生系统性偏见；同一
  reviewer 先看品牌再判差距，也无法区分证据与先验。
- Target: 两条腿先投影为字段完全同形的 JourneyObservation，BlindedDelta 冻结后
  才读取 IdentityMap 并生成 Peers owner 与 disposition。
- Expected effect: reference 不成为 Peers 产品真源，品牌身份不能提前污染 material
  delta 和机制判断。
- Non-claim: 品牌不可遮蔽的真实 artifact 仍需标记 leakage，不能用于 blind
  promotion。

### CER-O04: 比较 package、digest、CLI 和 projection 可确定性重算

- Before: 当前 CLI 没有 compare artifact、staged digest 或 Target projection。
- Target: CER artifact 使用闭合 schema、contained path、canonical digest、
  exact reference 和 current EDX binding；CLI 只读并返回稳定结构化结果。
- Expected effect: 输入顺序置换、空白格式变化和重复执行不改变语义结果；任何
  Oracle、Context、Leg、Review 或 Identity drift 使下游结果失效。
- Non-claim: CLI 不负责浏览器采集、外部登录、证据写入或 Product approval。

### CER-O05: stale、泄漏、不可比、因果过度声明和越权投影 fail closed

- Before: `causalMechanism` 是 authored Finding 字段，不证明 paired causality；
  当前控制面没有 CER 特定的 comparability 与 reveal failure semantics。
- Target: positive、negative、boundary fixtures 与 deterministic tests 覆盖 context
  mismatch、leg stale、review overlap、identity leakage、causal overclaim、
  unauthorized target 和 unproven evidence。
- Expected effect: 工具只在证据等级允许时输出 observed / supported /
  intervention-confirmed，并把框架 blind A/B 保持为外部 `UNPROVEN`。
- Non-claim: Calibration 不能替代 fresh sealed holdout 或证明增量价值。

### 明确不变与非目标

- ExperienceCase、Reasoning Kernel、UI Grammar、Rule Catalog 和 holdout lifecycle
  继续由现有 EDX owner 管理。
- CER 不抓取、不登录、不修改竞品，不把外部账号或凭据写入仓库。
- 不用平均总分、页面相似度或功能数量决定产品优劣。
- 不自动接受 Product disposition，不直接改写业务 Product Contract。
- 不运行发布、远程部署、Completion、Full 或 release Acceptance。

### 风险与回滚影响

- 新 schema 过宽会允许 Agent 用自述机制伪装证据，因此引用闭合、independence 和
  causal level 必须机械校验。
- blind 与 reveal artifact 若字段不对称会泄露身份，因此 blind leg 必须同形，
  IdentityMap 必须后置。
- 回滚通过 VCS revert 整个原子 cut，不保留第二套 compare CLI 或 compatibility
  path。

## Actual Outcome Results

```json outcome-comparison-results
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "CER-20261022",
  "sourceIdentity": "commit=2b8f9604de109f69056bf868d96adc75e71a0538; controlPlaneVersionDigest=sha256:60c730513a72a3cd4fd0181b5148abacefa36836ca0e017db5151d55fed95a68",
  "items": [
    {
      "id": "CER-O01",
      "status": "PARTIAL",
      "actualEffect": "CER calibration and CLI produce Oracle-bound material deltas with exact paired facts, earliest divergent states, causal level, user consequence and a recomputable priority tuple instead of a feature/page similarity list.",
      "evidenceRefs": [
        "file:///tmp/peers-touch-show-cer-2b8f9604d/experience-design-tests.tap",
        "file:///tmp/peers-touch-show-cer-2b8f9604d/control-plane-check.json"
      ],
      "deviation": "Source mechanics are proven on calibrated cases. A fresh Quality-owned blind A/B against the previous benchmark workflow has not run, so incremental gap-finding value remains UNPROVEN."
    },
    {
      "id": "CER-O02",
      "status": "PASS",
      "actualEffect": "The seven-artifact current chain validates independent leg evidence, blind review, sealed identity reveal, current Peers EDX binding and disposition review before projecting only accepted adopt/adapt Target Contract proposals.",
      "evidenceRefs": [
        "file:///tmp/peers-touch-show-cer-2b8f9604d/experience-design-tests.tap",
        "file:///tmp/peers-touch-show-cer-2b8f9604d/control-plane-check.json"
      ],
      "deviation": "Projection remains a proposal and does not modify an active Product or Client contract."
    },
    {
      "id": "CER-O03",
      "status": "PASS",
      "actualEffect": "Blind legs use one identity-neutral schema; the blind report forbids owner, disposition and intervention-confirmed claims; IdentityMap becomes valid only after an accepted independent blind review.",
      "evidenceRefs": [
        "file:///tmp/peers-touch-show-cer-2b8f9604d/experience-design-tests.tap",
        "file:///tmp/peers-touch-show-cer-2b8f9604d/code-structure-decision.json"
      ],
      "deviation": "Real artifacts that visibly expose a brand must declare leakage and cannot establish blind promotion."
    },
    {
      "id": "CER-O04",
      "status": "PASS",
      "actualEffect": "Canonical compare validate/evaluate/blind-review/disposition-review/project-target commands recompute package containment, canonical digests, stage bindings and current Peers EDX review. All comparative implementation files are included in the control-plane source digest.",
      "evidenceRefs": [
        "file:///tmp/peers-touch-show-cer-2b8f9604d/experience-design-tests.tap",
        "file:///tmp/peers-touch-show-cer-2b8f9604d/architecture-governance.tap",
        "file:///tmp/peers-touch-show-cer-2b8f9604d/plan-validation.json"
      ],
      "deviation": "The CLI remains read-only and does not collect browser/runtime evidence or manage credentials."
    },
    {
      "id": "CER-O05",
      "status": "PASS",
      "actualEffect": "Current-source tests and hard rules reject stale artifacts, path/symlink escape, graph or evidence orphans, author overlap, priority drift, identity leakage, causal overclaim, unauthorized target projection and second-source integration drift.",
      "evidenceRefs": [
        "file:///tmp/peers-touch-show-cer-2b8f9604d/experience-design-tests.tap",
        "file:///tmp/peers-touch-show-cer-2b8f9604d/hard-rules.log",
        "file:///tmp/peers-touch-show-cer-2b8f9604d/skill-check.log",
        "file:///tmp/peers-touch-show-cer-2b8f9604d/code-structure-decision.json"
      ],
      "deviation": "PASS covers source behavior and governance only. Framework blind A/B, future comparison quality and any product runtime outcome remain outside this proof."
    }
  ]
}
```
