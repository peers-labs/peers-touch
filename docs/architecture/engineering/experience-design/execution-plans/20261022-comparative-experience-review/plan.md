# Comparative Experience Review 实施计划

> **Plan ID**: CER-20261022
> **Version ID**: 20261022-portable-toolchain-closure
> **Created**: 2026-10-22T03:00:00.000Z
> **Owner**: Developer Experience / Product Design

本计划把已确认的 Comparative Experience Review 产品与架构合同落实为现有
Experience Design Control Plane 的唯一比较子系统。它授权本地源码、文档、测试
与 checkpoint commit，不授权 push、PR、发布、外部产品写操作、账号创建、凭据
保存或历史改写。

## 目标与完成口径

完成后必须同时成立：

1. 两个实现只在同一 Outcome Oracle 和 Comparison Context 下比较。
2. reference 与 Peers 都先成为 identity-neutral JourneyObservation；reference
   不消费 Peers UI Grammar。
3. BlindedDelta 在 identity reveal 前冻结；Peers owner 与 disposition 只在 reveal
   后产生。
4. adopt / adapt 只有经过独立 disposition review 才能投影 Target Contract
   proposal。
5. 当前 EDX 的单方案 evaluator、Reasoning Kernel 和 holdout 生命周期继续是唯一
   基础能力，不保留第二套 compare workflow。
6. deterministic tests 证明 digest、stale、permutation、not-comparable、
   causal-overclaim、review independence 和 unauthorized projection fail closed。
7. 框架 blind A/B 增量价值保持 `UNPROVEN`，不得由 source tests 代替。

人类可读的执行前后差异见
[outcome-comparison.md](./outcome-comparison.md)。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "CER-20261022",
  "versionId": "20261022-portable-toolchain-closure",
  "createdAt": "2026-10-22T03:00:00.000Z",
  "workClass": "refactor",
  "architecture": {
    "sources": [
      "docs/architecture/engineering/experience-design/README.md",
      "docs/architecture/engineering/experience-design/design.md",
      "docs/architecture/engineering/experience-design/decisions.md",
      "docs/architecture/engineering/experience-design/data-model.md",
      "docs/architecture/engineering/experience-design/module-layout.md",
      "docs/architecture/engineering/experience-design/integration.md",
      "docs/architecture/engineering/experience-design/comparative-experience-review.md",
      "docs/client/common/interaction-design-methodology.md"
    ],
    "decisions": [
      "CER-D01",
      "CER-D02",
      "CER-D03",
      "CER-D04",
      "CER-D05",
      "CER-D06",
      "CER-D07"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "docs/architecture/engineering/experience-design",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/engineering/architecture-governance/architecture-modules.json",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/README.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/references.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/client/common/interaction-design-methodology.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/client/common/ui-identity/grammar-bindings.json",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/architecture/engineering/quality",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/knowledge/pitfalls/experience-review-binding-and-graph-closure.md",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/scripts/experience-design",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/architecture/module-governance.mjs",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/scripts/architecture/module-governance.test.mjs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-product-design-methodology",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-prototype-design",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-quality-check",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-github-review/FRESHNESS.md",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "实现外部网页抓取、浏览器登录、竞品账号管理或运行时采集器",
      "保存竞品凭据、会话、大型媒体或受限数据到 Git",
      "让 reference product 消费 Peers Product Contract 或 UI Grammar",
      "自动批准 Product disposition 或直接修改 active Product Contract",
      "用 feature 数量、页面相似度或总分判断产品优劣",
      "伪造 framework blind A/B、fresh holdout 或增量价值 PASS",
      "push、Pull Request、发布、远程部署或历史改写"
    ]
  },
  "tasks": [
    {
      "id": "CER-01",
      "workstreamId": "PAIRED-EVALUATION",
      "path": "tasks/CER-01.md",
      "dependsOn": []
    },
    {
      "id": "CER-02",
      "workstreamId": "REVIEW-AND-TARGET",
      "path": "tasks/CER-02.md",
      "dependsOn": [
        "CER-01"
      ]
    },
    {
      "id": "CER-03",
      "workstreamId": "CONTROL-PLANE-CUTOVER",
      "path": "tasks/CER-03.md",
      "dependsOn": [
        "CER-02"
      ]
    }
  ],
  "outcomeComparison": {
    "path": "outcome-comparison.md"
  },
  "authorization": {
    "checkpoint": {
      "localCommit": "allowed",
      "amend": "denied"
    },
    "delivery": {
      "push": "denied",
      "pullRequest": "denied"
    },
    "runtime": {
      "deployProfiles": [],
      "destructiveResetScopes": []
    },
    "history": {
      "rewrite": "denied"
    }
  }
}
```

## 实施模型

1. **CER-01 关闭 paired evaluation。** 在同一闭合 package 内验证 Oracle、
   Context、两条 JourneyObservation、Leg Evaluation、Leg Review 和
   PairedExperienceCase，产生可重算的 assertion differential、path cost 和最早
   divergence。
2. **CER-02 关闭 independent decision。** 冻结 BlindedDelta，验证 blind reviewer
   non-overlap，再通过 sealed IdentityMap 生成 CausalDelta、disposition review 和
   Target Contract proposal；任何 stale 或越权投影失败。
3. **CER-03 原子接入控制面。** CLI、source version、comparative calibration、
   Product/Prototype/Quality Skills、active docs 和 capability registry 同批切换，
   不保留未登记或重复入口。

## Clean Cut 与证据规则

- CER 是 EDX 子系统，不创建第二个 Skill、Rule Catalog 或 mutable lifecycle store。
- 所有 compare validator 是 process-local、deterministic、read-only。
- package path 必须位于显式 `--package-root`，引用使用 canonical digest。
- blind command 不读取 IdentityMap；identity reveal 只追加 role/binding，不改写
  BlindedDelta。
- Peers EDX binding 在 reveal 后重新验证当前 case/result/review digest，旧成功不能
  作为 freshness authority。
- Source tests 证明机制和失败语义；框架增量价值只能由外部 sealed blind A/B 证明。
- 回滚是 VCS revert，不保留 legacy compare path、feature flag 或 compatibility
  shim。

## Acceptance Execution

本计划只修改 source-only 工程控制面。三个 closure 都由 plain deterministic tests
和独立 review 收口，不把新机制作为自身产品质量见证。

```json
{
  "closures": {
    "cer-paired-evaluation": [],
    "cer-review-and-target": [],
    "cer-control-plane-cutover": []
  },
  "completion": [],
  "full": []
}
```

## 审批边界

用户于 2026-10-22 明确确认 CER North Star 并授权开始实现。该批准覆盖本 Plan
source claims 内的非破坏性实现、本地验证和 checkpoint commit；不覆盖外部产品
写操作、push、PR、发布或 framework blind A/B 的结果声明。
