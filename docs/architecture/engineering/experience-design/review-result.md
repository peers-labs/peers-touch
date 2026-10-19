# Experience Design Control Plane - Review Result Model

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-19 | **Updated**: 2026-10-19
> **Owner**: Experience Design

---

`ReviewResult` is the source-fenced semantic review projection used by the
control plane evaluator and independent review boundary. It supplements the
canonical Experience Case model in [data-model.md](./data-model.md); it is not
a second case schema or workflow entrypoint.

## 1. Shared Types

```ts
type StableId = string;
type Digest = string;
type Verdict = "FINDINGS" | "NO_BLOCKING_FINDING";
type Severity = "blocking" | "major" | "minor";
type Confidence = "high" | "medium" | "low";
type EvidenceLevel =
  | "L1_CONTRACT"
  | "L2_VISUAL"
  | "L3_DYNAMIC"
  | "L4_RUNTIME";
type AdmissionStage = "review" | "high-fidelity" | "production";
```

Stable IDs are case-local unless a contract explicitly declares a repository
identity. All ID arrays are unique. Every reference must resolve inside the
same frozen result or its EvaluationBinding.

Envelope, case, manifest and rubric digests use
`sha256:<64 lowercase hex>`. Source blob digests are bare lowercase hex values
whose width is determined by `sourceBlobAlgorithm`.

## 2. Evaluation Binding

```ts
type SourceBlobRef = {
  path: string;
  digest: Digest;
};

type EvaluationBinding = {
  packageId: StableId;
  runEnvelopeDigest: Digest;
  caseDigest: Digest;
  sourceHead: string;
  manifestDigest: Digest;
  rubricDigest: Digest;
  sourceBlobAlgorithm: "git-sha1" | "sha256";
  sourceBlobs: SourceBlobRef[];
};
```

Rules:

- `sourceBlobs` is sorted by path and paths are unique.
- Every cited source path exists in `sourceBlobs`.
- The run envelope binds the exact package, case and source inputs.
- A validator reads source blobs from the explicit repository root and package
  files from a separate explicit package root. It recomputes every digest and
  resolves the repository's actual Git HEAD; it does not trust a
  caller-supplied HEAD or another worktree.
- Any mismatch invalidates the result; stale reports cannot be reclassified.

## 3. Facts, Contracts And Inferences

```ts
type SourceLocation = {
  path: string;
  lineStart: number;
  lineEnd: number;
  symbol?: string;
};

type Fact = {
  id: StableId;
  stateId: StableId;
  source: SourceLocation;
  statement: string;
  visibleAction?: string;
  visibleResponse?: string;
};

type ContractAuthority =
  | "accepted-product"
  | "accepted-client"
  | "rubric";

type ContractRef = {
  id: StableId;
  authority: ContractAuthority;
  caseCoverage: "explicit" | "supporting";
  source: SourceLocation;
  clause: string;
  statement: string;
};

type Inference = {
  id: StableId;
  factIds: StableId[];
  contractIds: StableId[];
  statement: string;
};

type UnprovenPoint = {
  id: StableId;
  contractIds: StableId[];
  requirement: string;
  reason: string;
  requiredEvidenceLevel: EvidenceLevel;
  requiredFor: AdmissionStage[];
};
```

Rules:

- Facts cite concrete source or inspected behavior.
- Accepted Product / Client contracts outrank rubric clauses.
- A rubric that contradicts an accepted contract makes the case invalid.
- Inferences reference at least one fact and one contract.
- An unsupported inference may be recorded for review, but cannot support an
  eligible Finding candidate.

## 4. Journey State Graph

```ts
type StateOrigin = "starting" | "explicit" | "derived";

type JourneyState = {
  id: StableId;
  origin: StateOrigin;
  inScope: boolean;
  explicitOrder?: number;
  source: SourceLocation;
  visibleMeaning: string;
};

type JourneyEdge = {
  id: StableId;
  fromStateId: StableId;
  toStateId: StableId;
  actionFactId: StableId;
  responseFactId: StableId;
  sourceRefs: SourceLocation[];
};

type JourneyStateGraph = {
  entryStateId: StableId;
  states: JourneyState[];
  edges: JourneyEdge[];
};

type OrderedState = {
  stateId: StableId;
  distance: number;
  ordinal: number;
};
```

Graph rules:

- Exactly one state has `origin=starting`; it equals `entryStateId`.
- Every edge endpoint and fact reference resolves.
- An edge represents a source-backed visible action and response.
- Reachability is computed from `entryStateId`.
- Unreachable and out-of-scope states cannot support a primary Finding.

Ordering:

1. Run breadth-first search from entry over visible action/response edges.
2. Order by shortest action distance.
3. At equal distance, use `explicitOrder` when both states have it.
4. Remaining ties use source path, line, then state ID in ASCII order.
5. Assign contiguous ordinals beginning at `0`.

Cycles do not add distance or duplicate a state.

## 5. Trust Boundary Check

```ts
type TrustBoundaryCheck = {
  id: StableId;
  contractTransitionRefs: StableId[];
  beforeScope: string;
  candidateTarget: string;
  diagnosticEvidenceKinds: string[];
  requiredIdentityEvidenceKinds: string[];
  scopeEffectMeaning: string;
  nextGateMeaning: string;
  failureMeaning: string;
  visibleConsequences: string[];
  previousScopeExposure: string;
};
```

The fields are projections of accepted Product / Client contracts. They do not
define a runtime protocol.

Rules:

- Every `contractTransitionRef` resolves to an accepted Product / Client
  contract, not only a rubric.
- Diagnostic evidence cannot satisfy required identity evidence unless the
  accepted contract explicitly says they are equivalent.
- Scope effect, next Gate and failure meaning must have visible facts or remain
  unproven.
- If the accepted contract omits a required transition semantic, the Kernel
  records a contract gap. It does not invent generation, quiesce, rollback or
  commit behavior.

## 6. Recovery Path

```ts
type RecoveryDistance =
  | "same-surface"
  | "named-adjacent"
  | "implicit";

type ReturnTarget =
  | {
      kind: "keyboard-focus";
      targetId: StableId;
    }
  | {
      kind: "touch-anchor";
      targetId: StableId;
    }
  | {
      kind: "navigation";
      targetId: StableId;
    };

type RecoveryPath = {
  id: StableId;
  contractIds: StableId[];
  sourceStateId: StableId;
  reason: string;
  entryActionVisible: boolean;
  distance: RecoveryDistance;
  preservedState: StableId[];
  returnStateId: StableId;
  returnTarget: ReturnTarget | null;
  notApplicableReason?: string;
  namedAdjacentPointerFactId?: StableId;
};
```

Rules:

- `implicit` is never an acceptable recovery path.
- `contractIds` includes at least one accepted Product / Client recovery
  contract.
- `entryActionVisible` must be true.
- `same-surface` requires a visible action fact in the source state.
- `named-adjacent` requires `namedAdjacentPointerFactId` and an explicit return
  state/target.
- `returnStateId` is reachable and in scope.
- `returnTarget=null` requires a contract-backed `notApplicableReason`.
- Preserved state is checked against the owning contract; the Kernel does not
  define what business state must survive.

## 7. Finding Candidates

```ts
type ImpactClass =
  | "unsafe-trust-or-data-loss"
  | "outcome-blocked"
  | "recovery-absent"
  | "visible-contradiction"
  | "material-ambiguity"
  | "accessibility-or-platform-parity"
  | "implementation-risk"
  | "polish";

type FindingCandidate = {
  id: StableId;
  stateId: StableId;
  factIds: StableId[];
  contractIds: StableId[];
  inferenceIds: StableId[];
  severity: Severity;
  impact: ImpactClass;
  confidence: Confidence;
  brokenPromise: string;
  causalMechanism: string;
  userImpact: string;
  ownerLayer: string;
  correctionDirection: string;
};

type IneligibleReason =
  | "out-of-scope"
  | "unreachable"
  | "visible-action-missing"
  | "visible-response-missing"
  | "accepted-support-missing"
  | "reference-invalid";

type CandidateLedgerEntry = {
  candidate: FindingCandidate;
  eligible: boolean;
  ineligibleReasons: IneligibleReason[];
  priorityTuple: PrimaryRankingTuple | null;
};
```

Eligibility requires:

- the candidate state is in scope and reachable;
- referenced facts include a visible action and visible response;
- all references close;
- at least one accepted Product / Client or rubric contract supports the
  candidate;
- every inference is supported by its referenced facts and contracts.

The validator can prove reference and ranking consistency. It cannot prove that
the authored semantic classification is true.

## 8. Primary Ranking Tuple

```ts
type PrimaryRankingTuple = [
  contractStrength: 0 | 1,
  impactRank: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
  stateOrdinal: number,
  explicitCoverageRank: 0 | 1,
  severityRank: 0 | 1 | 2,
  confidenceRank: 0 | 1 | 2,
  candidateId: StableId,
];
```

Derived values:

```text
contractStrength
  0 accepted-product or accepted-client
  1 rubric only

impactRank
  0 unsafe-trust-or-data-loss
  1 outcome-blocked
  2 recovery-absent
  3 visible-contradiction
  4 material-ambiguity
  5 accessibility-or-platform-parity
  6 implementation-risk
  7 polish

explicitCoverageRank
  0 candidate references at least one contract with caseCoverage=explicit
  1 candidate references supporting contracts only

severityRank
  0 blocking
  1 major
  2 minor

confidenceRank
  0 high
  1 medium
  2 low
```

Comparison is lexicographic and ascending. `candidateId` uses ASCII lexical
order. No field is weighted or averaged.

Primary selection:

1. Recompute every eligible tuple.
2. Partition material candidates (`blocking`, `major`) from `minor`.
3. The first material candidate is primary.
4. Remaining material candidates are secondary in tuple order.
5. Minor candidates become minor observations and do not change the verdict.

## 9. Findings And Review Result

```ts
type Finding = {
  candidateId: StableId;
  factIds: StableId[];
  contractIds: StableId[];
  inferenceIds: StableId[];
  severity: Severity;
  earliestStateId: StableId;
  brokenPromise: string;
  causalMechanism: string;
  userImpact: string;
  ownerLayer: string;
  correctionDirection: string;
  confidence: Confidence;
  priorityBasis: PrimaryRankingTuple;
};

type SecondaryFinding = Finding & {
  deprioritizedBecause: string;
};

type ExitAndRetryPath = {
  id: StableId;
  kind: "exit" | "retry" | "recovery";
  sourceStateId: StableId;
  actionFactId: StableId;
  destinationStateId: StableId;
  recoveryPathId?: StableId;
};

type ReviewResult = {
  kind: "peers-touch-experience-review-result";
  schemaVersion: 1;
  authorId: StableId;
  verdict: Verdict;
  evaluationBinding: EvaluationBinding;
  contracts: ContractRef[];
  facts: Fact[];
  inferences: Inference[];
  journeyStateGraph: JourneyStateGraph;
  trustBoundaryChecks: TrustBoundaryCheck[];
  recoveryPaths: RecoveryPath[];
  candidateLedger: CandidateLedgerEntry[];
  primaryFinding: Finding | null;
  secondaryFindings: SecondaryFinding[];
  minorObservations: Finding[];
  statesChecked: StableId[];
  exitAndRetryPaths: ExitAndRetryPath[];
  unproven: UnprovenPoint[];
};
```

Result invariants:

- Every nested reference resolves.
- Candidate ledger entries are unique and exhaustive.
- Every eligible tuple equals the recomputed tuple.
- Findings are projections of eligible candidates, not rewritten copies.
- `FINDINGS` requires a `blocking` or `major` primary equal to the first
  material tuple.
- `NO_BLOCKING_FINDING` requires `primaryFinding=null` and no eligible material
  candidate.
- Secondary findings preserve tuple order and explain why they are not primary.
- Minor observations contain only `minor` severity and never change verdict.
- Every unproven point references the contract that requires its evidence.
- `kind=exit` never references a `RecoveryPath`; it leaves the requested
  outcome rather than recovering it.
- `kind=retry|recovery` requires a referenced `RecoveryPath`, and every
  `RecoveryPath` is referenced by at least one such path.
- An unproven point blocks each stage named by `requiredFor` even when the
  verdict is `NO_BLOCKING_FINDING`.

## 10. Independent Review

```ts
type IndependentReviewDecision = {
  resultDigest: Digest;
  reviewerId: StableId;
  decision: "accepted" | "changes-required" | "unproven";
  findingCandidateIds: StableId[];
  reviewNotes: string[];
};
```

The minimal architecture requires digest binding and reviewer separation at the
workflow boundary. It does not introduce cryptographic reviewer signatures.
`reviewerId` must differ from `ReviewResult.authorId`, and every
`findingCandidateId` must resolve to the frozen result.

Prototype admission requires:

- current EvaluationBinding;
- `NO_BLOCKING_FINDING`;
- `decision=accepted`;
- no unproven point whose `requiredFor` contains `review` or `high-fidelity`.

## 11. Holdout Lifecycle

```ts
type HoldoutRunState =
  | "sealed"
  | "running"
  | "frozen"
  | "scoring"
  | "scored"
  | "retired"
  | "aborted"
  | "invalidated";
```

Legal transitions:

```text
sealed -> running -> frozen -> scoring -> scored -> retired
              \-> aborted

sealed | running | frozen | scoring | scored -> invalidated
```

`retired`, `aborted` and `invalidated` are terminal. A post-hoc defect does not
rewrite a retired run; it appends a promotion revocation.

Transition rules:

- `sealed`: one Quality-owned compare-and-swap atomically creates the frozen
  manifest/rubric/source envelope and appends every case digest to Exposure
  Ledger. Partial sealing is invalid.
- `running`: the runner may read rubric and one case at a time, never the key.
- `frozen`: every required report exists and the complete report manifest hash
  verifies.
- `scoring`: only now may the reviewer read the answer key.
- `scored`: score artifact and hard-failure result are immutable.
- `retired`: one Quality-owned compare-and-swap records score digest,
  promotion decision and terminal state atomically.
- `aborted`: the run did not finish, but every exposed case remains burned.
- `invalidated`: integrity drift or leakage occurred; no promotion is created.

## 12. Exposure And Promotion Ledgers

```ts
type ExposureLedgerEntry = {
  caseDigest: Digest;
  firstRunId: StableId;
  exposedAtState: "sealed";
  disposition:
    | "exposed"
    | "training"
    | "retired"
    | "aborted"
    | "invalidated";
};

type PromotionDecision = {
  runId: StableId;
  scoreArtifactDigest: Digest;
  promoted: boolean;
  reason: string;
};

type PromotionRevocation = {
  promotionRunId: StableId;
  discoveredAt: string;
  reason: string;
  evidenceDigest: Digest;
};
```

Exposure Ledger is append-only. A case present anywhere in exposure, training,
retired, aborted or invalidated history is ineligible for fresh promotion proof.

Promotion Ledger is append-only. A revocation removes the promotion's authority
for current admission and requires a completely new holdout; it does not mutate
the historical score.

## 13. Promotion Contract

```ts
type ChallengeClass =
  | "primary-visible-blocker"
  | "trust-boundary-propagation"
  | "recovery-locality"
  | "positive-control-non-finding"
  | "evidence-boundary"
  | "platform-semantic-parity";
```

A run may promote only when:

- score is at least `80`;
- hard-failure count is zero;
- every required hidden challenge class is satisfied;
- positive controls contain no blocking false positive;
- every primary tuple is recomputable;
- all report and score hashes verify;
- no case digest is reused from prior exposure or training.

The current B01-B06 package is permanently excluded.

## 14. Stable Validation Errors

The ReviewResult validator uses stable error codes:

- `EDX_BINDING_INVALID`
- `EDX_REFERENCE_INVALID`
- `EDX_GRAPH_INVALID`
- `EDX_TRUST_PROJECTION_INVALID`
- `EDX_RECOVERY_INVALID`
- `EDX_RANK_INVALID`
- `EDX_RESULT_INVALID`
- `EDX_HOLDOUT_STATE_INVALID`
- `EDX_EXPOSURE_REUSE`
- `EDX_PROMOTION_INVALID`

Validation errors identify the failing path and invariant. They never repair or
rewrite the supplied result.
