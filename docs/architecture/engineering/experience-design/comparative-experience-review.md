# Comparative Experience Review

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-22 | **Updated**: 2026-10-22
> **Owner**: Developer Experience / Product Design
> **Module**: `tooling/scripts/experience-design/`

---

## 1. Document Scope

本文档在 Experience Design Control Plane 内定义 Comparative
Experience Review，以下简称 CER。CER 用同一条用户 Journey、同一组评价合同和
同条件证据，对两个体验实现做成对比较，输出可执行的 Peers 产品合同差距。

本文档定义：

- Outcome Oracle、Paired Experience Case 和两条 Experience Leg；
- Benchmark Evidence Ledger 与同条件证据要求；
- 从结果差异到机制假设、再到 Target Contract Delta 的闭环；
- adopt / adapt / reject / defer 的 Peers-owned disposition；
- 因果等级、差距优先级、反泄漏和独立评审边界；
- Agent 使用流程、canonical CLI、失败语义与框架自身的盲测证明。

本文档不定义：

- 某个竞品是正确答案；
- 某个具体产品 Journey 的 Oracle 内容；
- 对竞品视觉、文案、组件或信息结构的直接复制；
- 网络抓取、登录、浏览器自动化或外部账号管理；
- 未经产品确认自动改写 Peers Product / Client 合同；
- 实现任务、执行顺序或发布授权。

CER 扩展 `experience.design.evaluate`，但不改变现有单方案 Experience Case、
Reasoning Kernel 或 holdout 的语义。

## 2. Verified Problem

当前控制面能够把一个 `ExperienceCandidate` 与一个已接受的
`ExperienceContract` 比较，并验证语义、信息架构、路径、状态、动作、证据和
drift。Reasoning Kernel 的 `causalMechanism` 由 Finding author 提供，验证器只检查
它存在并随 Finding 投影。

当前模型没有定义：

1. 两个实现必须完成同一用户 Journey；
2. 两条证据腿必须使用同一平台、任务、数据、账号状态和环境；
3. 两个实现必须分别对同一个、预先冻结的用户结果合同求值；
4. 差异必须定位到最早分叉状态和可观察机制；
5. 竞品行为必须经过 Peers disposition 后才能进入 Target Contract；
6. 该比较框架是否比普通 benchmark prompt 更能发现重大差距。

所以现有单方案 Finding 不能被改名为竞品因果对比。CER 必须复用现有 EDX，
但增加独立的成对比较合同。

## 3. Product Definition

### 3.1 Target User

主要用户是需要设计、评审或重构 Peers 产品体验的 Product / Design / Engineering
Agent，以及负责最终产品取舍的 owner。

排除：

- 只想生成竞品功能清单或市场宣传摘要的人；
- 只想复制截图、视觉风格或交互细节的人；
- 无法提供或采集两个实现同条件证据，却仍要求确定性结论的人。

### 3.2 Product Promise

给定一个 Peers Journey 和一个参考实现，CER 找出影响用户结果的重大差距，解释
差距在可观察体验链路中如何产生，把结论路由给正确 owner，并生成可评审、可验证
的 Peers Target Contract Delta。

第一有用结果不是“竞品有什么功能”，而是：

```text
同一用户结果
  -> 哪一条实现没有达到
  -> 最早在哪个可见状态开始分叉
  -> 哪个体验机制导致结果或成本差异
  -> Peers 应 adopt / adapt / reject / defer 什么
  -> 用什么合同和证据证明改动真正关闭差距
```

持续价值是让后续 Agent 对标使用同一证据和判断结构，减少泛泛建议、视觉模仿和
实现后千差万别。

### 3.3 Stable Product IDs

稳定 capability：

- `experience.compare.observe`
- `experience.compare.pair`
- `experience.compare.diagnose`
- `experience.compare.disposition`
- `experience.compare.project-target`
- `experience.compare.prove`

稳定 Journey：

- `experience.compare.same-journey`

稳定 acceptance：

- `experience.compare.acceptance.comparable-inputs`
- `experience.compare.acceptance.material-deltas`
- `experience.compare.acceptance.peers-disposition`
- `experience.compare.acceptance.target-contract`
- `experience.compare.acceptance.independent-review`
- `experience.compare.acceptance.incremental-value`

这些 ID 属于 `experience.design.compare` 的产品与验收合同。

## 4. Core Principles

1. **Compare outcomes, not pages.** 比较单位是用户 Journey 和结果，不是页面、
   feature 名称或截图相似度。
2. **One frozen Oracle.** 两条 Experience Leg 使用同一个 digest-bound Outcome
   Oracle；结果出现后不能原地修改 Oracle。
3. **Evaluate legs before pairing.** 两条腿先独立求值和冻结，再计算差值，避免
   看到更强的一方后改写另一方的标准。
4. **Observed difference is not yet cause.** 结果差异、机制支持和干预证明是三个
   不同等级，不得混称根因。
5. **Benchmark is evidence, not authority.** 竞品行为只有经过 Peers disposition
   才能影响 Peers Target Contract。
6. **No scalar quality score.** 安全、结果阻断、恢复和信任差距不能被视觉优点
   平均掉。
7. **Missing comparability fails closed.** 条件不一致或证据缺失时输出
   `UNPROVEN`，不输出胜负。
8. **Independent review remains mandatory.** 比较器只产出 delta 和 evidence
   readiness，不批准产品取舍或自己的因果结论。

## 5. Operating Model

```text
Peers product thesis + bounded Journey
                |
                v
Benchmark discovery
  observed behavior -> user value -> candidate disposition
                |
                v
Freeze Outcome Oracle + Comparison Context
                |
                v
Capture two Experience Legs under matched conditions
                |
                v
Normalize each leg into an identity-neutral Journey Observation
                |
                v
Evaluate each observation against the frozen Oracle
  Peers leg additionally binds its current EDX result
                |
                v
Freeze Leg A result + Leg B result
                |
                v
Pair by Oracle assertion and earliest divergent state
                |
                v
Causal Delta Ledger
  differential -> supported mechanism -> intervention proof
                |
                v
Independent identity-reveal review
                |
                v
adopt / adapt / reject / defer
                |
                v
Peers Target Contract Delta + executable evidence requirement
```

箭头只表示评审产物的推导方向，不表示运行时调用。

## 6. Outcome Oracle

### 6.1 Definition

Outcome Oracle 是在比较结果出现前冻结的、与产品身份无关的用户结果合同。它回答：

- 用户最终要完成什么；
- 哪些结果是安全、信任、阻断或质量级要求；
- 哪些可见状态和证据能证明结果；
- 哪些替代信号不能冒充结果。

Oracle 不是：

- “竞品怎么做”的描述；
- AI 自评分 rubric；
- 页面元素或功能数量；
- 竞品胜出的预设；
- 实现架构或技术选型。

```ts
type OutcomeOracle = {
  kind: "peers-touch-outcome-oracle";
  schemaVersion: 1;
  id: StableId;
  journeyId: StableId;
  productThesisDigest: Digest;
  comparisonContextDigest: Digest;
  assertions: OracleAssertion[];
  authoredById: StableId;
  frozenAt: string;
};

type OracleAssertion = {
  id: StableId;
  promisedOutcome: string;
  criticality: "safety" | "blocking" | "required" | "quality";
  observableStateKinds: StateKind[];
  requiredEvidenceLevels: EvidenceLevel[];
  disallowedSubstitutes: string[];
};
```

### 6.2 Discovery And Evaluation Separation

竞品可以在 discovery 阶段暴露新的用户价值或失败模式。此时允许提出
`OracleAmendmentProposal`，但不能直接拿新发现回填正在比较的 Oracle。

合法流程是：

1. 记录竞品观察和可能的用户价值；
2. Product owner 做 Peers disposition；
3. 接受后生成新的 Oracle digest；
4. 丢弃旧比较结果；
5. 在新 Oracle 下重新采集并评估两条腿。

这样既允许 benchmark 帮助产品学习，又避免“看完答案再改评分标准”。

## 7. Paired Experience Case

```ts
type ArtifactRef = {
  path: string;
  digest: Digest;
};

type ComparisonContext = {
  kind: "peers-touch-comparison-context";
  schemaVersion: 1;
  id: StableId;
  journeyId: StableId;
  actorArchetype: string;
  startingState: string;
  taskPrompt: string;
  platform: Platform;
  locale: string;
  viewport: {
    widthCssPx: number;
    heightCssPx: number;
    devicePixelRatio: number;
  };
  inputMode: string;
  dataFixtureDigest: Digest;
  accountState: string;
  capabilityAvailability: string[];
  networkProfile: string;
  timeBudgetMs?: number;
};

type ExperienceLeg = {
  id: StableId;
  blindedAlias: "A" | "B";
  sourceKind: "source" | "prototype" | "production";
  observation: ArtifactRef;
  evidenceLedger: ArtifactRef;
  oracleEvaluation: ArtifactRef;
  legReview: ArtifactRef;
};

type PairedExperienceCase = {
  kind: "peers-touch-paired-experience-case";
  schemaVersion: 1;
  id: StableId;
  journeyId: StableId;
  oracle: ArtifactRef;
  comparisonContext: ArtifactRef;
  legs: [ExperienceLeg, ExperienceLeg];
  pairingAuthorId: StableId;
};

type IdentityMap = {
  kind: "peers-touch-comparison-identity-map";
  schemaVersion: 1;
  pairedCaseDigest: Digest;
  comparisonEvaluationDigest: Digest;
  blindedDeltaDigest: Digest;
  blindReviewDigest: Digest;
  roles: {
    A: "peers" | "reference";
    B: "peers" | "reference";
  };
  revealedById: StableId;
  revealedAt: string;
  peersBinding: {
    legAlias: "A" | "B";
    experienceCase: ArtifactRef;
    evaluationResult: ArtifactRef;
    reviewReceipt: ArtifactRef;
  };
};
```

两条腿的共同输入不是 Peers `ExperienceCase`，而是 identity-neutral
`JourneyObservation`：

```ts
type JourneyObservation = {
  kind: "peers-touch-journey-observation";
  schemaVersion: 1;
  id: StableId;
  journeyId: StableId;
  blindedAlias: "A" | "B";
  authoredById: StableId;
  evidenceAuthorIds: StableId[];
  contextDigest: Digest;
  evidenceLedgerDigest: Digest;
  facts: Array<{
    id: StableId;
    stateId: StableId;
    statement: string;
    evidenceIds: StableId[];
    visibleAction?: string;
    visibleResponse?: string;
  }>;
  states: Array<{
    id: StableId;
    kind: StateKind;
    contextId: StableId;
    ordinal: number;
    visibleMeaning: string;
    inScope: boolean;
  }>;
  edges: Array<{
    id: StableId;
    fromStateId: StableId;
    toStateId: StableId;
    actionFactId: StableId;
    responseFactId: StableId;
  }>;
  observedActions: Array<{
    id: StableId;
    edgeId: StableId;
    mutation:
      | "none"
      | "local"
      | "external-reversible"
      | "external-irreversible";
    decisionCost: 0 | 1 | 2;
    interruption: "none" | "permission" | "authentication" | "setup";
  }>;
  recoveryObservations: Array<{
    sourceStateId: StableId;
    entryActionVisible: boolean;
    preservedState: StableId[];
    returnStateId?: StableId;
    evidenceIds: StableId[];
  }>;
  primaryPathEdgeIds: StableId[];
  evidenceIds: StableId[];
};
```

每条 leg 另有独立的 `EvidenceLedger`、`OracleEvaluation` 和 `LegReview`：

```ts
type OracleEvaluation = {
  kind: "peers-touch-oracle-evaluation";
  schemaVersion: 1;
  id: StableId;
  legId: StableId;
  blindedAlias: "A" | "B";
  oracleDigest: Digest;
  contextDigest: Digest;
  observationDigest: Digest;
  evidenceLedgerDigest: Digest;
  authorId: StableId;
  results: Array<{
    id: StableId;
    assertionId: StableId;
    result: "met" | "not-met" | "unproven";
    factIds: StableId[];
    evidenceIds: StableId[];
    rationale: string;
  }>;
};

type LegReview = {
  kind: "peers-touch-comparison-leg-review";
  schemaVersion: 1;
  legId: StableId;
  evaluationDigest: Digest;
  reviewerId: StableId;
  reviewedAt: string;
  decision: "accepted" | "changes-required" | "unproven";
  reviewNotes: string[];
  reviewerFindings: IndependentReviewFinding[];
};
```

该投影只描述用户可观察的动作、响应、状态、成本和恢复，不包含 Peers UI
Grammar、组件角色或竞品内部实现假设。Peers leg 可以从当前 EDX
`ExperienceCase` 和 runtime evidence 投影，但 canonical case/result 只保存在
sealed `IdentityMap`，blind review 完成前不可读取。reference leg 只需闭合
observation、evidence 和独立 leg review。两条 blind leg 的字段集合完全相同。

可比性要求：

- 两条腿的 Journey、actor、starting state 和 task prompt 相同；
- 平台、输入方式、locale、viewport、数据、账号状态、网络和能力可用性相同；
- 无法使用同一 Comparison Context 的两条腿不能形成 pair，必须拆成独立产品
  分析并保持 `UNPROVEN`；
- 两条腿分别通过 CER observation schema、source fence、evidence 和独立 leg
  review；
- identity reveal 后，Peers leg 才额外绑定当前 EDX case/result；reference leg
  不接受 Peers UI Grammar 或 Peers Product Contract 作为自身产品真源；
- 任何一条腿 `UNPROVEN` 的 Oracle assertion，pair result 对该 assertion 也只能
  是 `UNPROVEN`。

“Desktop 竞品完整功能”与“Mobile Peers 降级功能”默认不可直接比较。只有 Product
合同已声明平台语义等价或明确降级目标时，才允许形成可比 pair。

## 8. Benchmark Evidence Ledger

每个 benchmark 观察必须记录：

- 精确产品版本、日期、平台、账号/权限和实验开关；
- 用户动作、可见响应、状态转移和恢复路径；
- 证据类型：official source、official docs、inspected runtime 或 third-party；
- artifact / source digest、inspector 和采集条件；
- 观察到的事实；
- 推断出的用户价值；
- 推断的置信度和可证伪条件；
- Peers disposition 状态。

证据等级规则：

- L1 只能证明合同或源码存在；
- L2 只能证明被检查的视觉状态；
- 用户能否完成 Journey 至少需要 L3；
- runtime、accessibility、performance 或 receiver-visible claim 需要相应 L4；
- 截图不能证明 recovery、authority、持续状态或操作成本；
- 不可访问的竞品实现细节保持 unknown，不从 UI 反推其后端根因。

采集器属于 Browser / Prototype / Runtime owner。CER evaluator 不登录外部产品、
不抓网、不写证据，也不持有凭据。

## 9. Causal Delta Ledger

### 9.1 Materiality Gate

一个差异只有同时满足以下条件才进入 material delta：

1. 绑定同一个 Oracle assertion；
2. 两条腿的比较条件可比；
3. 存在结果、路径成本、恢复成本、信任表达或平台可达性的可观察差值；
4. 定位到最早 divergent state；
5. 说明用户后果；
6. 明确因果等级、falsifier 和缺失证明。

否则它只能是：

- `cosmetic-observation`；
- `benchmark-only-behavior`；
- `not-comparable`；
- `unproven`。

### 9.2 Delta Model

```ts
type ComparisonEvaluation = {
  kind: "peers-touch-comparison-evaluation";
  schemaVersion: 1;
  caseId: StableId;
  caseDigest: Digest;
  oracleDigest: Digest;
  contextDigest: Digest;
  evaluatorVersionDigest: Digest;
  authorIds: StableId[];
  legBindings: {
    A: Record<string, Digest>;
    B: Record<string, Digest>;
  };
  pathCosts: {
    A: PathCost;
    B: PathCost;
  };
  earliestDivergence: {
    ordinal: number;
    AStateId: StableId;
    BStateId: StableId;
  } | null;
  assertionDifferentials: AssertionDifferential[];
  materialDifferentialIds: StableId[];
  unprovenAssertionIds: StableId[];
  disposition:
    | "material-differences"
    | "no-material-difference"
    | "unproven";
};

type CausalStatus =
  | "differential-observed"
  | "mechanism-supported"
  | "intervention-confirmed"
  | "unproven";

type DeltaKind =
  | "product-contract-absence"
  | "product-contract-underfit"
  | "candidate-drift"
  | "execution-gap"
  | "platform-adaptation-gap"
  | "benchmark-liability"
  | "evidence-gap";

type BlindedDelta = {
  id: StableId;
  differentialId: StableId;
  oracleAssertionId: StableId;
  earliestDivergentStateRefs: {
    A: StableId;
    B: StableId;
  };
  causalStatus:
    | "differential-observed"
    | "mechanism-supported";
  pairedFactIds: {
    A: StableId[];
    B: StableId[];
  };
  mechanism: string;
  userConsequence: string;
  falsifier: string;
  confidence: "high" | "medium" | "low";
  journeyFrequency: "frequent" | "periodic" | "rare";
  userWorkAtRisk: "high" | "medium" | "low" | "none";
  priorityTuple: [
    oracleCriticality: number,
    outcomeBlocked: number,
    trustOrRecoveryImpact: number,
    earliestDivergentState: number,
    journeyFrequency: number,
    userWorkAtRisk: number,
    causalStatus: number,
    confidence: number,
    deltaId: StableId,
  ];
};

type CausalDelta = {
  id: StableId;
  blindedDeltaId: StableId;
  revealedRoles: {
    A: "peers" | "reference";
    B: "peers" | "reference";
  };
  kind: DeltaKind;
  ownerLayer: string;
  proposedDisposition: "adopt" | "adapt" | "reject" | "defer";
  causalStatus: CausalStatus;
  interventionEvidenceDigests: Digest[];
  targetProposal?: TargetContractProposal;
};
```

`BlindedDelta` 在身份揭示前冻结，只回答结果差值、最早分叉、机制支持度和用户
后果。`CausalDelta` 是身份揭示后的独立投影，才允许判断 Peers owner、
`DeltaKind` 和 disposition。这样不会因为先知道哪一边是竞品，就把差异自动解释
成 Peers 缺陷。

因果等级：

- `differential-observed`：只证明结果不同，不声称原因；
- `mechanism-supported`：最早分叉状态、事实、合同和路径解释形成闭环，但尚未做
  干预；
- `intervention-confirmed`：在 Peers 原型或实现中只改变目标机制后，Oracle 结果
  或成本差距按预期关闭；
- `unproven`：条件、事实或证据不足。

只有 `intervention-confirmed` 可以表述为“已证明该机制导致差距”。
`mechanism-supported` 必须表述为“证据支持的机制解释”。

### 9.3 Delta Classification

- `product-contract-absence`：竞品暴露了有价值结果，但 Peers 合同没有承诺；
- `product-contract-underfit`：两边目标相同，但 Peers 的预算、恢复、信任或平台
  合同明显更弱；
- `candidate-drift`：Peers 合同已经正确，Wireflow / prototype 偏离；
- `execution-gap`：合同与 candidate 正确，真实实现或 runtime 没做到；
- `platform-adaptation-gap`：共享语义存在，但某个平台适配丢失结果；
- `benchmark-liability`：竞品行为违反 Peers 安全、隐私、可移植性或可恢复原则；
- `evidence-gap`：没有足够证据判断差异。

该分类决定修复 owner，禁止所有差距都落成“前端照着改”。

## 10. Disposition And Target Contract

Disposition 作用于用户结果和机制，不作用于竞品身份：

- `adopt`：保留同一用户结果和关键机制；
- `adapt`：保留用户价值，但按 Peers privacy、Station ownership、federation、
  cross-device 和 platform constraints 改写；
- `reject`：明确记录与 Peers 产品论点或约束冲突；
- `defer`：缺少前置合同、能力或证据，不计入当前完成声明。

```ts
type TargetContractProposal = {
  id: StableId;
  targetOwner: string;
  affectedCapabilityIds: StableId[];
  affectedJourneyIds: StableId[];
  affectedStateIds: StableId[];
  changedPromise: string;
  requiredAcceptanceIds: StableId[];
  requiredEvidence: string[];
  nonAdoptedBenchmarkDetails: string[];
};

type TargetContractDelta = TargetContractProposal & {
  causalDeltaId: StableId;
  acceptedDisposition: "adopt" | "adapt";
};
```

生成规则：

- 只有独立评审接受的 `adopt` / `adapt` delta 才能生成 Target Contract Delta；
- `reject` 必须保留理由，防止后续 Agent 再次提出同一模仿；
- `defer` 必须保留 blocker 和 reopening condition；
- Target Contract Delta 仍是 product proposal，不能直接修改 active Product /
  Client contract；
- Product owner 接受后，才进入现有 Experience Contract、Wireflow、prototype 和
  production evidence 生命周期。

## 11. Priority Without Average Scores

CER 不输出总分或“相似度”。Material delta 使用非加权优先 tuple：

```text
oracleCriticality
-> outcomeBlocked
-> trustOrRecoveryImpact
-> earliestDivergentState
-> journeyFrequency
-> userWorkAtRisk
-> causalStatus
-> confidence
-> deltaId
```

排序原则：

- safety / blocking 结果优先于 quality；
- outcome blocked、trust 错误和 recovery 缺失优先于效率和 polish；
- 同级时，越早出现的分叉优先；
- 高频 Journey 和更高用户工作损失优先；
- 证据弱不会被高业务影响掩盖，弱证据项保持 `UNPROVEN`。

最终输出分为：

1. primary material delta；
2. secondary material deltas；
3. benchmark liabilities；
4. cosmetic observations；
5. unproven / not-comparable cells；
6. accepted Target Contract Deltas。

## 12. Independence And Anti-Leakage

必须满足：

- Oracle author 不参与任一 Experience Leg 的候选或证据编写；
- 两条腿先独立求值并冻结，pairing author 不能修改 leg result；
- blind semantic review 阶段只使用 `A` / `B`，不生成 Peers owner 或 disposition；
- identity reveal 发生在 `BlindedDelta` 和 blind review 冻结后；
- reveal 后由另一个 disposition review 生成 `CausalDelta` 和 Peers disposition；
- blind reviewer 与 Oracle、leg、evidence、pairing authors 不重叠；
- disposition reviewer 与前述 authors 及 blind reviewer 不重叠；
- Oracle digest、context digest、两个 leg result digest、delta result digest 和
  两个 review decision 全部互相绑定；
- 任何 Oracle amendment、证据替换、context change 或 leg change 都使 pair 和
  review stale；
- 已暴露的 framework holdout 永久 burn，沿用现有 Exposure Ledger 原则。

若 artifact 本身不可避免暴露品牌，必须记录 `identityLeakage=visible`。该 case
可用于产品分析，但不能用于证明框架不受品牌先验影响。

## 13. Run Lifecycle

```ts
type ComparativeRunState =
  | "draft"
  | "oracle-frozen"
  | "collecting"
  | "legs-frozen"
  | "paired"
  | "blind-reviewed"
  | "identity-revealed"
  | "disposition-reviewed"
  | "target-projected"
  | "retired"
  | "invalidated";
```

合法转换：

```text
draft
  -> oracle-frozen
  -> collecting
  -> legs-frozen
  -> paired
  -> blind-reviewed
  -> identity-revealed
  -> disposition-reviewed
  -> target-projected
  -> retired

oracle-frozen | collecting | legs-frozen | paired | blind-reviewed
  -> invalidated

identity-revealed | disposition-reviewed | target-projected
  -> retired
```

规则：

- `draft` 可以吸收 discovery 和 Oracle amendment；
- `oracle-frozen` 后任何 Oracle / context 修改都创建新 run identity；
- `collecting` 只允许 evidence producer 写各自腿的任务外部证据目录；
- `legs-frozen` 要求两个 JourneyObservation、OracleEvaluation 和 leg review
  digest 完整；
- `paired` 才允许读取两条 leg result，不允许读取 identity map；
- `blind-reviewed` 冻结 BlindedDelta 和 blind review；
- `identity-revealed` 只追加 identity map，不改写 BlindedDelta；
- `disposition-reviewed` 冻结 CausalDelta、Peers owner 和 disposition；
- `target-projected` 只投影已接受的 adopt / adapt；
- `invalidated` 是终态，stale、leakage、digest drift 或非法转换均进入该状态；
- `retired` 保留历史结果，但不能授权新的 active Product Contract。

每个状态转换都绑定前一状态 digest。CER 不维护仓库内可变 run 状态；run package
和 Quality ledger 位于任务拥有的 machine-local workspace。

## 14. Failure Semantics

稳定错误：

- `EDX_COMPARE_ORACLE_INVALID`：Oracle 缺失、未冻结或引用不闭合；
- `EDX_COMPARE_CONTEXT_MISMATCH`：两条腿条件不一致且无合法例外；
- `EDX_COMPARE_LEG_INVALID`：任一腿不是当前、独立、digest-bound 结果；
- `EDX_COMPARE_PAIR_STALE`：Oracle、context、leg 或 source 已变化；
- `EDX_COMPARE_EVIDENCE_UNPROVEN`：某个 Oracle assertion 缺少精确证据；
- `EDX_COMPARE_CAUSAL_OVERCLAIM`：证据等级不足却声明已证明因果；
- `EDX_COMPARE_REVIEW_REQUIRED`：reviewer 不独立或 identity reveal 顺序非法；
- `EDX_COMPARE_TARGET_UNAUTHORIZED`：未接受 disposition 就生成 target delta。

Disposition：

- schema、context mismatch、binding、stale、overclaim 和 unauthorized 为命令
  失败；
- 合法 leg 的 evidence missing 投影为 Oracle assertion `unproven`；
- paired evaluation 只返回 `material-differences`、
  `no-material-difference` 或 `unproven`，不返回 `passed`；
- blind 与 disposition review 分别返回 `accepted`、`changes-required` 或
  `unproven`。

## 15. Component Boundaries

CER 作为 EDX 子系统，不另建 Skill 或第二个 Rule Catalog。

- `Comparative schema validator`：验证 Oracle、context、legs 和引用闭合；
- `Comparability validator`：检查同 Journey、同条件和合法平台差异；
- `Observation normalizer`：把两边证据投影为中立 JourneyObservation，不推断
  竞品内部实现；
- `Peers leg binder`：只在 blind review 冻结和 identity reveal 后读取
  IdentityMap，为 Peers leg 绑定现有 EDX result，用于 owner routing 和 drift
  分类；
- `Oracle evaluator`：逐 assertion 投影 `met | not-met | unproven`；
- `Delta derivation`：定位最早分叉和差值，不自动宣称根因；
- `Causal claim validator`：约束因果等级、事实、falsifier 和干预证据；
- `Blind semantic reviewer`：在未知身份下评审结果差值和机制支持度；
- `Disposition reviewer`：身份揭示后评审 Peers owner 和 Product disposition；
- `Target contract projector`：只投影已接受的 adopt / adapt 决定；
- `Framework holdout validator`：复用 Quality-owned exposure 和 promotion。

所有 validator 继续保持 process-local、deterministic、read-only。Browser、
Prototype、Runtime 和 external research 只作为 evidence producer。

禁止：

- evaluator 调用浏览器或登录竞品；
- evaluator 修改 active Product / Client contract；
- 一个 competitor leg 同时充当 Oracle；
- 从 feature 数量、页面相似度或视觉风格直接生成 material delta；
- 把不可比条件下的差异解释为产品优劣；
- 把体验机制推断写成后端实现根因；
- 为适配新 schema 保留第二条 legacy compare path。

## 16. Agent And CLI Workflow

### 16.1 User Entry

用户只需指定：

```text
用 CER 对比 <reference product> 和 Peers 的 <bounded Journey>。
先冻结用户结果和比较条件，再采集两边证据。
输出重大差距、机制等级、Peers disposition、Target Contract 和 UNPROVEN。
不要输出功能清单或视觉模仿建议。
```

Agent 负责建立 machine-local comparison package。用户不需要手写 JSON。

### 16.2 Package

```text
<package-root>/
├── oracle.json
├── comparison-context.json
├── benchmark-evidence-ledger.json
├── legs/
│   ├── A/
│   │   ├── journey-observation.json
│   │   ├── oracle-evaluation.json
│   │   └── leg-review.json
│   └── B/
│       ├── journey-observation.json
│       ├── oracle-evaluation.json
│       └── leg-review.json
├── paired-case.json
├── blinded-deltas.json
├── blind-review.json
├── identity/
│   ├── identity-map.json
│   └── peers-edx-binding/
│       ├── experience-case.json
│       ├── evaluation-result.json
│       └── review-result.json
├── causal-deltas.json
├── disposition-review.json
└── target-contract-deltas.json
```

证据大文件、浏览器会话、凭据和外部产品数据保存在任务拥有的外部 evidence
workspace，不进入 Git。

### 16.3 Canonical Commands

```bash
node tooling/scripts/experience-design/experience-design.mjs \
  compare-validate <paired-case.json> --package-root <package-root>

node tooling/scripts/experience-design/experience-design.mjs \
  compare-evaluate <paired-case.json> --package-root <package-root>

node tooling/scripts/experience-design/experience-design.mjs \
  compare-review-blind <paired-case.json> <comparison-evaluation.json> \
  <blinded-deltas.json> <blind-review.json> \
  --package-root <package-root>

node tooling/scripts/experience-design/experience-design.mjs \
  compare-review-disposition <paired-case.json> <comparison-evaluation.json> \
  <blinded-deltas.json> <blind-review.json> <identity-map.json> \
  <causal-deltas.json> <disposition-review.json> \
  --package-root <package-root>

node tooling/scripts/experience-design/experience-design.mjs \
  compare-project-target <paired-case.json> <comparison-evaluation.json> \
  <blinded-deltas.json> <blind-review.json> <identity-map.json> \
  <causal-deltas.json> <disposition-review.json> \
  --package-root <package-root>

node tooling/scripts/experience-design/experience-design.mjs \
  compare-calibrate
```

所有命令只读输入并向 stdout 返回结构化结果；调用方负责把输出写入任务拥有的
external evidence workspace。`compare-project-target` 重新验证完整七阶段 artifact
chain，不能沿用先前 review command 的成功作为 freshness authority。

### 16.4 Human-Readable Output

每个 material delta 必须用同一结构呈现：

```text
Broken Oracle assertion:
Paired observed facts:
Earliest divergent state:
Causal status:
Supported mechanism or missing proof:
User consequence:
Peers owner:
Disposition:
Target contract delta:
Required proof:
```

没有这些字段的“建议”不得进入实施。

## 17. Product Acceptance Contract

CER 只有在以下 receiver-visible assertions 全部闭合后，才能声称 framework
实现完成：

1. 给定一个 bounded Journey，Agent 能生成 identity-neutral Oracle 和
   ComparisonContext，且缺失产品目标时 fail closed。
2. 给定两个同条件 observation，Agent 能分别冻结 leg result，再生成
   BlindedDelta；输入顺序交换不改变语义结果和优先级。
3. 条件不一致、任一腿缺证据或平台语义不等价时，输出精确 `UNPROVEN` /
   `NOT_COMPARABLE`，不输出胜负。
4. blind review 前的 artifact 不包含 Peers owner、benchmark identity 或
   adopt / adapt / reject / defer。
5. identity reveal 后，Agent 能把 gap 路由到 product contract、candidate、
   implementation、platform 或 evidence owner，并保留 benchmark liability。
6. 未经 disposition review 的 delta 不能生成 Target Contract Delta；生成后的
   target 必须包含 Journey、state、acceptance 和 evidence IDs。
7. Oracle、context、leg、evidence 或 review digest 变化后，旧 pair、review 和
   target projection 全部失效。
8. User-facing output 只包含 material deltas、liabilities、cosmetic observations、
   unproven cells 和 target contracts，不回退为功能清单。
9. 交换 reference / Peers 的盲态标签不改变 BlindedDelta；揭示后只改变方向、
   owner 和 disposition 投影。
10. Framework blind A/B 达到下一节的 promotion contract；否则 capability 仍为
    `UNPROVEN`。

对应证据：

- schema、permutation、stale binding、overclaim 和 unauthorized projection 的
  deterministic source tests；
- 至少一个 same-outcome/different-mechanism 正例；
- 至少一个 no-material-gap positive control；
- 至少一个 not-comparable boundary case；
- 至少一个 benchmark-liability case；
- 当前源码绑定的 blind A/B score、hard-failure 和 exposure artifacts。

## 18. Framework Incremental-Value Proof

CER 的价值当前保持 `UNPROVEN`。源码检查只能证明机制存在，不能证明它比普通
benchmark prompt 更能找到重大差距。

必须执行冻结、盲化的 A/B：

- Control：当前 Product benchmark ledger + 单方案 EDX review；
- Treatment：同一模型、同一输入预算、同一证据集，加 CER paired Oracle；
- Cases：Quality owner 准备未暴露的产品对，覆盖：
  - superficial parity trap；
  - same feature, different outcome；
  - benchmark liability；
  - platform non-equivalence；
  - trust / recovery gap；
  - evidence insufficiency；
  - positive no-material-gap control；
- Answer key：由独立 Product / UX reviewers 在运行前冻结；
- Exposure：sealed 时 burn，任何 abort / leakage 均不可复用。

比较指标：

- material-gap recall；
- accepted causal precision；
- owner-routing accuracy；
- valid Target Contract conversion；
- superficial-finding rate；
- hard-failure count。

hard failure：

- 推荐复制竞品视觉或身份；
- 发明不存在的竞品行为；
- 条件不可比却输出胜负；
- 结果出现后修改 Oracle 且不重跑；
- 把 supported mechanism 声称为 intervention-confirmed；
- 未经 disposition 生成 active target contract；
- 漏掉 answer key 中的 safety、trust、recovery 或 outcome-blocking primary gap。

Promotion 要求：

1. Treatment 无 hard failure；
2. 所有隐藏 challenge class 达标；
3. positive control 无 blocking false positive；
4. Treatment 在 material-gap recall 和 valid Target Contract conversion 上都严格
   优于 Control；
5. causal precision、owner routing 和 superficial-finding rate 不退化；
6. 所有输入、报告、评分和 exposure digest 闭合。

Promotion 只证明覆盖到的 challenge classes，不保证所有未来产品比较有效。

## 19. Decisions And Confirmation Gate

已接受决策：

- `CER-D01`：使用中立 JourneyObservation 比较两条腿；不把 reference product
  强塞进 Peers ExperienceContract 和 UI Grammar。代价是增加一层 normalization
  和独立 leg review。
- `CER-D02`：Oracle 在 paired evaluation 前冻结。允许 discovery amendment，但
  amendment 创建新 run。替代方案“看到结果后直接补 rubric”被拒绝，因为它会
  产生循环论证。
- `CER-D03`：先冻结 BlindedDelta，再 reveal identity 和做 disposition。替代方案
  “单 reviewer 全程看品牌”成本更低，但无法区分证据判断与品牌先验。
- `CER-D04`：因果结论采用 observed / supported / intervention-confirmed 三层。
  替代方案“所有解释都叫 root cause”被拒绝，因为大多数 benchmark observation
  没有干预证据。
- `CER-D05`：差距使用非加权 priority tuple，不产生总分。负面后果是不能给出一
  个便于传播的排行榜数字；正面后果是 safety、trust 和 recovery 不会被 polish
  平均掉。
- `CER-D06`：Target Contract projector 只产生 digest-bound proposal，不修改
  active contract。代价是多一个 Product acceptance gate；收益是 benchmark
  无法越权成为 Peers 产品真源。
- `CER-D07`：框架增量价值必须通过 blind A/B，且 holdout 暴露即 burn。代价是
  case 维护成本高；收益是“比普通 Agent 对标更有效”成为可证伪 claim。

进入实现前需要确认以下 North Star：

1. CER 是现有 EDX 的比较层，不是新的独立设计系统；
2. 比较单位是同一 Journey 下的 Outcome Oracle，不是 feature/page parity；
3. discovery 可以提出 Oracle amendment，但 amendment 后必须双腿重跑；
4. 因果结论分为 observed、supported、intervention-confirmed；
5. 只有独立评审接受的 adopt / adapt 才能生成 Target Contract Delta；
6. 不使用平均总分；
7. 框架价值必须通过 blind A/B，完成前保持 `UNPROVEN`；
8. 用户确认本提案后，才进入 active architecture amendment 和实现计划。
