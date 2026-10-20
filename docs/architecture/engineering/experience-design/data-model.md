# Experience Design Control Plane - Data Model

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-10-18 | **Updated**: 2026-10-20
> **Owner**: Developer Experience / Product Design

---

This document owns the canonical Experience Case, contract, candidate and
evidence model. The source-fenced evaluator projection is defined separately
in [review-result.md](./review-result.md) and must reference the stable IDs
defined here rather than creating another Product or Wireflow contract.

## 1. Shared Types

```ts
type StableId = string;
type Digest = `sha256:${string}`;
type Platform = "desktop" | "mobile" | "browser" | "dashboard";
type Claim = "wireflow" | "prototype" | "production";
type Calibration = "positive" | "negative" | "boundary" | "blind";

type CopyRole =
  | "brand"
  | "title"
  | "subtitle"
  | "section-heading"
  | "field-label"
  | "helper"
  | "status"
  | "action"
  | "error"
  | "accessible-name";

type RegionRole =
  | "content"
  | "action"
  | "trust"
  | "floating"
  | "recovery"
  | "navigation";

type StateKind =
  | "entry"
  | "empty"
  | "loading"
  | "waiting"
  | "pending"
  | "partial-success"
  | "success"
  | "failure"
  | "unknown-outcome"
  | "recovery"
  | "cancelled"
  | "offline"
  | "degraded"
  | "restored"
  | "long-content"
  | "narrow";
```

`entry` is the canonical default state. There are no aliases in case JSON.
Platform adaptation may present the same state differently but must retain the
same `StateKind`.

## 2. Experience Case

```ts
type ExperienceCase = {
  kind: "peers-touch-experience-case";
  schemaVersion: 1;
  id: StableId;
  title: string;
  calibration: Calibration;
  claim: Claim;
  authorship: {
    contractAuthorId: StableId;
    candidateAuthorId: StableId;
    evidenceAuthorIds: StableId[];
    expectationAuthorId?: StableId;
  };
  contract: ExperienceContract;
  candidate: ExperienceCandidate;
  expected?: ExpectedCalibration;
  promotedFromBlind?: {
    holdoutId: StableId;
    caseDigest: Digest;
    firstResultDigest: Digest;
    reviewReceiptDigest: Digest;
  };
};
```

Rules:

- `expected` is required for positive/negative/boundary fixtures.
- `expected`, `expectationAuthorId` and `promotedFromBlind` are
  forbidden for blind holdouts.
- A promoted calibration fixture is a new immutable case with a new ID and
  requires a valid independent blind-review receipt digest.
- `expectationAuthorId` differs from contract, candidate and evidence author
  IDs.
- Author IDs are stable workflow principals supplied by the active Agent host.
  They are attribution and separation identifiers, not cryptographic identity
  proofs.
- Material cases contain at least one evidence author ID. Every
  `inspectedById` is a member of that evidence-author set; the later reviewer
  ID differs from every author and inspector.
- A case with `expected` requires an expectation author ID. A case without
  `expected` forbids it.
- The loader recomputes contract, candidate, evidence, expectation and complete
  case digests. The candidate digest excludes `candidate.evidence`; the
  evidence array has its own digest, avoiding a circular source digest.
- Content-addressed storage and exact digest binding establish immutability.
  Independent workflow execution establishes author/reviewer separation. No
  user-managed key, signature, issuer registry or unsigned compatibility mode
  exists.

## 3. Experience Contract

```ts
type ExperienceContract = {
  productIntent: ProductIntent;
  semantics: {
    concepts: ConceptContract[];
  };
  informationArchitecture: {
    surfaces: SurfaceContract[];
  };
  actions: ActionContract[];
  platformDifferences: PlatformDifference[];
  pathBudgets: PathBudget[];
  stateRequirements: StateRequirement[];
  acceptedTrace: AcceptedTrace[];
  requiredEvidence: EvidenceRequirement[];
  performanceBudgets: PerformanceBudget[];
};

type ProductIntent = {
  capabilityIds: StableId[];
  journeyIds: StableId[];
  visibleStateIds: StableId[];
  acceptanceIds: StableId[];
  actor: string;
  startingContext: string;
  promisedOutcome: string;
  firstUsefulResult: string;
  recurringValue: string;
  trustConstraints: string[];
  privacyConstraints: string[];
  authorityConstraints: string[];
  nonGoals: string[];
};
```

All stable IDs are unique in their collection. Every reference must resolve in
the same case or in the canonical UI Grammar.

Material cases are total, not sparse:

- capability, Journey, visible-state and acceptance ID arrays are non-empty;
- contract concepts, surfaces, actions, path budgets, state requirements,
  accepted traces and required evidence are non-empty;
- each Journey ID has exactly one path budget, one state requirement and one
  accepted trace;
- each visible-state ID appears in one state requirement and one accepted
  trace;
- each acceptance ID appears in one accepted trace and at least one evidence
  requirement;
- each contract surface and action is referenced by a trace or is rejected as
  an orphan;
- candidate copy, surfaces, actions, states, transitions, journeys and traces
  are non-empty, resolve to contract entities, and contain no orphan;
- candidate authority assertions and recovery branches exactly cover the
  contract conditions that require them and contain no orphan;
- every accepted Journey has exactly one candidate Journey and complete trace;
- Wireflow claims require L1 cells; Prototype claims require L1-L3 cells;
  Production claims require L1-L4 cells.
- Prototype and Production claims require at least one performance budget and
  a metric-bearing evidence requirement for each budget. Missing observations
  remain `ED-EVIDENCE-001`; a nominal L4 record without the budget metric is
  insufficient.

Any omission, duplicate owner or orphan is `ED-CONTRACT-001`, never an empty
success.

Candidate states and transitions must belong to their Journey and be reachable
from its start, even when every ID appears in a TraceLink.

## 4. Semantic Concepts

```ts
type ConceptContract = {
  id: StableId;
  meaning: string;
  scope: StableId;
  maxOccurrences: number;
  allowedRoles: CopyRole[];
  exceptionReasons: Array<
    "accessibility" | "safety" | "separate-navigation-context"
  >;
};

type CopyNode = {
  id: StableId;
  surfaceId: StableId;
  scope: StableId;
  conceptId: StableId;
  role: CopyRole;
  text: string;
  exceptionReason?:
    | "accessibility"
    | "safety"
    | "separate-navigation-context";
};
```

Occurrence is counted by `(conceptId, scope)`. An exception is legal only when
the concept allows that exact reason. String similarity is not a verdict.

## 5. Information Architecture

```ts
type SurfaceContract = {
  id: StableId;
  contextId: StableId;
  mainSubjectId: StableId;
  allowedRegionRoles: RegionRole[];
};

type SurfaceCandidate = {
  id: StableId;
  contextId: StableId;
  mainSubjectIds: StableId[];
  regions: Array<{
    id: StableId;
    role: RegionRole;
    supportsSubjectId?: StableId;
  }>;
};
```

`mainSubjectIds` contains exactly one item and matches the accepted surface.
Every non-navigation region resolves to the main subject.

## 6. Actions

```ts
type ActionContract = {
  id: StableId;
  intent: string;
  risk: "routine" | "sensitive" | "destructive";
  frequency: "frequent" | "periodic" | "rare";
  mutation: "none" | "local" | "external-reversible" | "external-irreversible";
  optionCardinality: "none" | "binary" | "multiple" | "numeric";
  canonicalIconMeaning: boolean;
  repeatedTool: boolean;
  reversible: boolean;
  decisionCost: 0 | 1 | 2;
  interruption: "none" | "permission" | "authentication" | "setup";
  confirmationPolicy:
    | "none"
    | "required"
    | "required-when-irreversible"
    | "server-authoritative";
  authoritativeOwner?: StableId;
  readbackContract?: string;
  expectedAuthorityResultId?: StableId;
  grammarRole: StableId;
  allowedPlatformAdapters: {
    desktop: StableId[];
    mobile: StableId[];
    browser: StableId[];
    dashboard: StableId[];
  };
  equivalentSurfaceIds: StableId[];
};

type ActionCandidate = {
  id: StableId;
  contractActionId: StableId;
  surfaceId: StableId;
  grammarRole: StableId;
  representation: StableId;
  platformAdapter: StableId;
  primary: boolean;
  accessibleLabel?: string;
  tooltip?: string;
  confirmation: "none" | "user-confirmed" | "server-authorized";
};

type PlatformDifference = {
  actionContractId: StableId;
  left: {
    platform: Platform;
    surfaceId: StableId;
    representation: StableId;
    adapter: StableId;
  };
  right: {
    platform: Platform;
    surfaceId: StableId;
    representation: StableId;
    adapter: StableId;
  };
  rationale: string;
};

type AuthorityAssertion = {
  id: StableId;
  actionCandidateId: StableId;
  transitionId: StableId;
  authoritativeOwner: StableId;
  readbackContract: string;
  expectedAuthorityResultId: StableId;
  evidenceRequirementId: StableId;
  minimumEvidenceLevel: "L3_DYNAMIC" | "L4_RUNTIME";
};
```

Icon-only is legal only when the grammar representation allows it and the
contract says both `canonicalIconMeaning` and `repeatedTool`. Mutating tabs are
illegal because `mode_selector` representations require `mutation=none`.
`platformAdapter` must belong to the case platform's adapter list.
Confirmation is checked against both the grammar policy and the accepted
`confirmationPolicy`; `contract-owned` in grammar never means unspecified.
The complete tuple is validated:

- `risk=destructive` requires `grammarRole=destructive_command`;
- `external-irreversible` requires destructive risk and an explicit user
  confirmation;
- `server-authoritative` requires all three authority fields on the contract,
  `confirmation=server-authorized`, one candidate `AuthorityAssertion` bound to
  the exact action and transition, and an exact observed evidence record at or
  above its required runtime level;
- role, representation and adapter must be allowed by both UI Grammar and the
  contract's platform adapter allowlist;
- equivalent surfaces use the same representation/adapter unless an accepted
  `PlatformDifference` names both surfaces, platforms, representations,
  adapters and rationale.

## 7. States And Transitions

```ts
type StateRequirement = {
  journeyId: StableId;
  productStateIds: StableId[];
  requiredKinds: StateKind[];
  preserveOnFailure: StableId[];
  authoritativeReadbackOnUnknown: boolean;
  recoveryRequirements: RecoveryRequirement[];
};

type RecoveryRequirement = {
  sourceKind: "failure" | "unknown-outcome";
  allowedRecoveryActionContractIds: StableId[];
  requiredFocusTargetId: StableId;
  allowedReturnKinds: StateKind[];
  requiresAuthorityReconciliation: boolean;
};

type StateNode = {
  id: StableId;
  journeyId: StableId;
  surfaceId: StableId;
  kind: StateKind;
  visibleMeaning: string;
};

type Transition = {
  id: StableId;
  journeyId: StableId;
  fromStateId: StableId;
  toStateId: StableId;
  candidateActionId: StableId;
  preserves: StableId[];
  authoritativeReadback: boolean;
};

type RecoveryBranch = {
  sourceStateId: StableId;
  recoveryTransitionId: StableId;
  recoveryActionCandidateId: StableId;
  preserves: StableId[];
  focusTargetId: StableId;
  returnStateId: StableId;
  authorityAssertionId?: StableId;
};
```

Required kinds are reachable from an `entry` state. `failure` and
`unknown-outcome` require outgoing recovery. An unknown outcome requires an
authoritative readback edge when its requirement says so. Every reachable
`failure` or `unknown-outcome` state maps to exactly one `RecoveryBranch`.
The branch must preserve all required IDs, use an allowed recovery action,
restore the exact focus target, return to an allowed state kind and resolve the
required authority assertion. Retry, cancel and alternate actions are modeled
as ordinary action contracts referenced by the recovery requirement.

## 8. Journey And Derived Path Cost

```ts
type PathCost = {
  commitments: number;
  contextSwitches: number;
  decisionLoad: number;
  interruptions: number;
  recoveryDebt: number;
};

type PathBudget = {
  journeyId: StableId;
  frequency: "frequent" | "periodic" | "rare";
  risk: "low" | "medium" | "high";
  max: PathCost;
};

type JourneyStep = {
  id: StableId;
  transitionId: StableId;
};

type JourneyCandidate = {
  journeyId: StableId;
  startStateId: StableId;
  successStateId: StableId;
  steps: JourneyStep[];
};
```

The step list is one contiguous ordered path:

- the first transition starts at `startStateId`;
- each transition's `toStateId` equals the next transition's `fromStateId`;
- the final transition ends at `successStateId`;
- a transition appears at most once;
- cycles are forbidden in the selected success path;
- every mutating candidate action reachable before success appears in the
  selected path or the case is `ED-CONTRACT-001`;
- each transition's `candidateActionId` resolves to one `ActionCandidate`,
  which resolves to one `ActionContract`.

The evaluator derives cost from that chain; the candidate cannot supply an
aggregate:

- `commitments`: count actions whose mutation is
  `external-irreversible`, plus unconfirmed `external-reversible` actions.
- `contextSwitches`: count adjacent state surfaces whose accepted
  `contextId` differs.
- `decisionLoad`: sum the referenced action contract's `decisionCost`.
- `interruptions`: count actions whose `interruption` is not `none`.
- `recoveryDebt`: for each mutating transition, inspect every reachable
  failure/recovery branch before success and count each branch that omits any
  required preserved ID. One preserving branch never masks another losing
  branch.

Each derived field is compared independently with the Journey budget.

## 9. Trace

```ts
type AcceptedTrace = {
  capabilityId: StableId;
  journeyId: StableId;
  productStateIds: StableId[];
  acceptanceIds: StableId[];
  orderedStateKinds: StateKind[];
  requiredActionIds: StableId[];
};

type TraceLink = {
  capabilityId: StableId;
  journeyId: StableId;
  surfaceIds: StableId[];
  stateIds: StableId[];
  actionIds: StableId[];
  wireflowNodeIds: StableId[];
  evidenceIds: StableId[];
};
```

Drift detection compares the candidate's reachable ordered state kinds and
required action IDs with `AcceptedTrace`. A missing or inserted commitment,
decision surface or mode choice is `ED-DRIFT-001`.
`orderedStateKinds` contains at least entry and result phases. It is a
sequence: distinct states may repeat the same kind.
The selected path remains the exact sequence used for cost derivation.
Reachable alternatives before success are additionally checked for non-recovery
decisions: positive decision cost, option choice, mode selection or interruption
requires accepted action intent. Zero-decision navigation and explicit recovery
remain legal supporting branches; a candidate trace alone cannot accept them.
Capability, Journey, product state and acceptance IDs must all resolve from
`ProductIntent`; evidence `claimId` resolves to one acceptance ID.

## 10. Evidence Requirements And Records

```ts
type EvidenceLevel =
  | "L1_CONTRACT"
  | "L2_VISUAL"
  | "L3_DYNAMIC"
  | "L4_RUNTIME";

type PerformanceBudget = {
  id: StableId;
  claimId: StableId;
  platform: Platform;
  runtimeProfile: string;
  metric: {
    name: string;
    comparator: "<=" | ">=";
    threshold: number;
    unit: string;
    environment: string;
    workload: string;
    measurementMethod: string;
    samplePolicy: string;
    percentile: "p50" | "p75" | "p95" | "p99" | "single";
  };
  evidenceRequirementId: StableId;
};

type EvidenceRequirement = {
  id: StableId;
  claimId: StableId;
  level: EvidenceLevel;
  platform: Platform;
  runtimeProfile: string;
  inputMode:
    | "source"
    | "pointer"
    | "keyboard"
    | "touch"
    | "assistive-technology"
    | "reduced-motion";
  locale: string;
  viewport: {
    widthCssPx: number;
    heightCssPx: number;
    devicePixelRatio: number;
  };
  resolvedTheme: "light" | "dark";
  contentMode:
    | "default"
    | "empty"
    | "long"
    | "localization-expansion"
    | "failure"
    | "recovery";
  stateIds: StableId[];
  assertionIds: StableId[];
  metric?: {
    name: string;
    comparator: "<=" | ">=";
    threshold: number;
    unit: string;
    environment: string;
    workload: string;
    measurementMethod: string;
    samplePolicy: string;
    percentile: "p50" | "p75" | "p95" | "p99" | "single";
  };
};

type EvidenceRecord = {
  id: StableId;
  requirementId: StableId;
  level: EvidenceLevel;
  status: "observed" | "unproven";
  sourceDigest: Digest;
  artifact?: string;
  artifactDigest?: Digest;
  inspectedById?: StableId;
  observedAt?: string;
  platform: Platform;
  runtimeProfile: string;
  inputMode: EvidenceRequirement["inputMode"];
  locale: string;
  viewport: EvidenceRequirement["viewport"];
  requestedTheme: "light" | "dark" | "system";
  resolvedTheme: EvidenceRequirement["resolvedTheme"];
  contentMode: EvidenceRequirement["contentMode"];
  stateIds: StableId[];
  assertionIds: StableId[];
  metricObservation?: {
    name: string;
    value: number;
    unit: string;
    environment: string;
    workload: string;
    measurementMethod: string;
    samplePolicy: string;
    percentile: "p50" | "p75" | "p95" | "p99" | "single";
  };
};
```

Exact matching requires equality for requirement ID, level, platform, runtime,
input mode, locale, all viewport dimensions/DPR, resolved theme, content mode,
state IDs and assertion IDs. `sourceDigest` must equal the current candidate
digest. A satisfying record has `status=observed`; observed L2-L4 records
require artifact path, artifact digest, inspector and canonical timestamp.
When the requirement contains `metric`, `metricObservation` is mandatory.
Metrics must exactly match name, unit, environment, workload, method, sample
policy and percentile, then satisfy the requirement comparator.

## 11. Complete Candidate Aggregate

```ts
type ExperienceCandidate = {
  platform: Platform;
  copyNodes: CopyNode[];
  surfaces: SurfaceCandidate[];
  actions: ActionCandidate[];
  authorityAssertions: AuthorityAssertion[];
  states: StateNode[];
  transitions: Transition[];
  recoveryBranches: RecoveryBranch[];
  journeys: JourneyCandidate[];
  traces: TraceLink[];
  evidence: EvidenceRecord[];
};
```

This is the only candidate shape. Validators do not accept partial aggregates.

## 12. Findings And Rule Catalog

```ts
type LoadedRuleCatalog = Record<StableId, {
  severity: "blocking" | "unproven" | "warning";
  disposition:
    | "changes-required"
    | "unproven"
    | "ready-for-independent-review";
  exitCode: number;
  owner: string;
}>;

type RuleId = keyof LoadedRuleCatalog;

type ExperienceFinding = {
  id: StableId;
  ruleId: RuleId;
  severity: "blocking" | "unproven" | "warning";
  owner:
    | "product"
    | "content"
    | "information-architecture"
    | "journey"
    | "state"
    | "ui-identity"
    | "prototype"
    | "platform"
    | "implementation"
    | "evidence";
  location: string;
  observed: string;
  consequence: string;
  correction: string;
};
```

`rules.json` is the only source for valid IDs, severity, disposition, exit
behavior and default owner. The schema validates each finding against the
loaded catalog; fixtures and evaluator code cannot override those fields.

## 13. Evaluation Result

```ts
type EvaluationResult = {
  kind: "peers-touch-experience-findings";
  schemaVersion: 1;
  caseId: StableId;
  evaluatedAt: string;
  evaluatorVersionDigest: Digest;
  caseDigest: Digest;
  contractDigest: Digest;
  candidateDigest: Digest;
  disposition:
    | "changes-required"
    | "ready-for-independent-review"
    | "unproven";
  derivedPathCosts: Record<StableId, PathCost>;
  findings: ExperienceFinding[];
  unprovenEvidenceRequirementIds: StableId[];
};
```

Disposition precedence:

1. any blocking finding -> `changes-required`;
2. otherwise any unproven evidence -> `unproven`;
3. otherwise -> `ready-for-independent-review`.

`passed` is not legal.

## 14. Review Receipt

```ts
type ReviewReceipt = {
  kind: "peers-touch-experience-review";
  schemaVersion: 1;
  caseId: StableId;
  caseDigest: Digest;
  contractDigest: Digest;
  candidateDigest: Digest;
  resultDigest: Digest;
  reviewerId: StableId;
  reviewedAt: string;
  decision: "accepted" | "changes-required" | "unproven";
  findingIds: StableId[];
  reviewerFindings: IndependentReviewFinding[];
};

type IndependentReviewFinding = {
  id: StableId;
  category:
    | "product"
    | "content"
    | "information-architecture"
    | "journey"
    | "state"
    | "ui-identity"
    | "accessibility"
    | "performance"
    | "evidence";
  severity: "blocking" | "warning";
  location: string;
  evidence: string;
  observed: string;
  consequence: string;
  correction: string;
};
```

The receipt is valid only when:

- all digests match current immutable inputs/result;
- `reviewerId` differs from contract, candidate, evidence and expectation
  author IDs and every evidence inspector ID;
- timestamp is canonical.
- `findingIds` is the exact set of evaluator result finding IDs; no current
  finding may be omitted and no stale finding may be added.
- the complete receipt remains content-addressable through its canonical
  digest; any changed reviewer, decision, finding or input binding produces a
  different receipt digest.

Decision is exhaustive:

| Evaluator disposition | Independent blocking finding | Legal decision |
|---|---|---|
| `ready-for-independent-review` | no | `accepted` |
| `ready-for-independent-review` | yes | `changes-required` |
| `changes-required` | any | `changes-required` |
| `unproven` | no | `unproven` |
| `unproven` | yes | `changes-required` |

`accepted` therefore requires a ready evaluator result, complete finding
binding and zero blocking reviewer findings. Warnings may remain but are
preserved in the digest-bound receipt.

The evaluator never creates this receipt.

## 15. Calibration And Blind Holdouts

```ts
type ExpectedCalibration = {
  disposition: EvaluationResult["disposition"];
  expectedRuleIds: RuleId[];
  expectedFindingIds: StableId[];
};

type HoldoutLedgerRecord = {
  kind: "peers-touch-experience-holdout-record";
  schemaVersion: 1;
  holdoutId: StableId;
  caseDigest: Digest;
  firstResultDigest: Digest;
  reviewReceiptDigest: Digest;
  evaluatorSnapshotDigest: Digest;
  promotedCaseId?: StableId;
  promotedCaseDigest?: Digest;
};
```

Calibration suite rules:

- each enforceable rule has a positive, negative and boundary fixture;
- expectation author is independent of all input authors;
- `expectedRuleIds` and `expectedFindingIds` are exact unique sets emitted by
  evaluation; any missing or additional rule or finding fails the fixture.
- fixture expectations are compared with evaluator output, never generated by
  the runner;
- `fixtures/holdout/` is excluded from calibration discovery;
- first blind evaluation produces a result only;
- independent review creates a `ReviewReceipt`;
- promotion creates a new calibration case that references the immutable blind
  receipt digest; the original holdout remains unchanged.
- holdout cases, first results, receipts and ledger records use their content
  digest as filename; loaders verify path/digest equality.
- one holdout ID resolves to exactly one sealed case/result/review chain across
  the complete ledger. A changed, duplicated or reused ID is rejected.
- promotion resolves the original case, first result and digest-bound receipt
  before accepting the new calibration case.
- every promoted calibration case resolves a reciprocal ledger promotion
  identity and digest, including when calibration is invoked separately.
- ledger records bind a content-addressed `evaluator-snapshots/` object with
  kind `peers-touch-experience-evaluator-snapshot`, schemaVersion `1`,
  sourceDigest, frozen rules and frozen grammar. Original result version is
  the canonical digest of source/rules/grammar digests. Historical integrity
  validates content addresses, case/contract/candidate bindings, frozen rule
  consistency and independent receipt; it does not rerun new code as old code.
- current reevaluation is separately returned as `currentResultDigest`. It
  never rewrites the immutable first result and does not inherit its review
  approval or claim historical deterministic replay.
- historical Case integrity does not apply new graph validation retroactively.
  If current validation/evaluation rejects an old addressed case, the chain
  remains historically valid and currentEvaluationStatus is `unproven`, with
  a null currentResultDigest and the current error. Frozen findings still
  determine their own legal disposition; no blocking result may be relabeled
  ready. Calibration IDs are unique and cannot reuse any sealed holdout ID.
- `calibrate`, `validate-holdouts` and `check` consume `--package-root` as the
  explicit external fixture/ledger root; omitted means repository calibration
  fixtures. Unsupported command options fail rather than being ignored.

## 16. Lifecycle

```text
draft contract
  -> schema-valid
  -> independent contract review
  -> accepted contract
  -> Wireflow candidate
  -> deterministic findings
  -> candidate remediation
  -> independent Wireflow review receipt
  -> high fidelity
  -> exact evidence-cell matching
  -> independent prototype review receipt
  -> production verification
```

The tool stores no mutable lifecycle state. Git sources and explicit
digest-bound artifacts remain authoritative.
