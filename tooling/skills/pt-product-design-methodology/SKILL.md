---
name: "pt-product-design-methodology"
description: "Turns a product goal and benchmarks into accepted journeys, states, capability scope, prototype requirements, and acceptance contracts. Invoke before architecture for non-trivial product work."
stage: "PRODUCT"
requires: ["user goal or product problem", "available product and benchmark evidence"]
produces: ["accepted product contract", "benchmark disposition", "experience and state contracts", "product acceptance matrix"]
next: "pt-architecture-design-methodology"
---

# Product Design Methodology

## Stage Contract

This skill owns **PRODUCT** only.

```text
user problem and benchmark evidence
  -> product promise and target users
  -> capability disposition
  -> journeys and visible state model
  -> prototype confirmation when needed
  -> product acceptance contract
  -> pt-architecture-design-methodology
  -> accepted architecture
  -> execution planning
```

It answers:

- Who the product is for and which job or outcome it must improve.
- What complete user journeys and visible states the product promises.
- Which benchmark capabilities are adopted, adapted, rejected, or deferred.
- Which capabilities are required, optional, degraded, or unsupported.
- What the user must observe for the product to count as complete.
- Which executable prototype evidence is required before implementation.

It does **not**:

- Choose runtime topology, source-of-truth ownership, protocols, storage, or
  module dependency direction.
- Decompose implementation work, define phases, or write code.
- Copy an external product without a Peers-Touch disposition decision.
- Treat screenshots, feature lists, or a prototype as production acceptance.
- Declare a product gate passed without owner or independent review.

## Invoke When

Invoke for:

- A new product, module, major capability, or workflow redesign.
- Benchmark-driven work using products such as LobeHub or AgentBox.
- Requests phrased as "product-ready", "complete experience", "what should we
  build", or "is this enough for users".
- Existing architecture that lacks user journeys, visible states, capability
  scope, or receiver-perspective acceptance.

Skip for:

- Pure infrastructure with no user-facing or operator-facing product contract.
- Small fixes governed by an existing accepted product and architecture.
- Execution planning after both product and architecture gates have passed.

## Core Rule

Design by:

```text
Observed User Problem
  -> Measurable Product Outcome
  -> Benchmark Evidence
  -> Adopt / Adapt / Reject / Defer
  -> End-to-End Journey
  -> Visible State Contract
  -> Feasibility Closure
  -> Receiver-Perspective Acceptance
```

Feature presence is not product completeness. Every required capability must
close a user journey and expose success, waiting, failure, recovery, and trust
states where applicable. Product documents must describe actions a user and
system can actually perform, not only nouns, categories, or aspirations.

## Source Basis

Read before designing:

- `docs/README.md`
- `docs/global/first-principles.md`
- Relevant architecture and platform sources.
- Relevant `docs/knowledge/` invariants, pitfalls, and playbooks.
- Existing research, feedback, support incidents, and acceptance evidence.
- The actual source/runtime of named benchmark products when locally available.
- For client UI: `docs/client/common/ux-design-methodology.md`, shared UI
  Identity, and the closest module/platform contracts.

External products provide evidence, not authority. Record exact observed
behavior and preserve Peers-Touch ownership, privacy, federation, and
cross-device constraints.

### Benchmark Identity Isolation

Benchmark brands may appear only in research, evidence, attribution, and
disposition artifacts. They must not become the canonical Peers product or
prototype:

- ID or directory name
- title or route
- module/package name
- user-facing Agent name or copy
- current product review entry

Use Peers-owned capability names for product artifacts. When an old benchmark-
named prototype exists, retain it as `superseded` historical evidence and
create or rename the canonical Peers product artifact without rewriting the
benchmark record.

## Workflow

### Step 1. Define The Product Thesis

Output:

- Target users and excluded users.
- Primary jobs, pain points, and current alternatives.
- One-sentence product promise.
- First useful outcome and recurring value.
- Trust, privacy, portability, and operational promises.
- Explicit non-goals.

Reject capability lists that have no user outcome.

### Step 2. Build A Benchmark Evidence Ledger

For each relevant benchmark behavior:

| Behavior | Evidence | User value | Disposition | Peers rationale |
|---|---|---|---|---|
| Observed behavior, not marketing label | source/runtime/file/trace | outcome enabled | adopt/adapt/reject/defer | boundary and tradeoff |

Rules:

- Inspect the benchmark source or executable behavior where available.
- Separate observed facts from inference.
- `adopt` means preserve the behavior and user outcome.
- `adapt` names the Peers-specific difference.
- `reject` explains why it conflicts with the product or architecture.
- `defer` states the missing prerequisite and does not count as completion.

No relevant benchmark capability may remain implicit.

### Step 3. Freeze The Product Capability Profile

Assign stable capability IDs and classify each as:

- **required**: product cannot claim readiness without it.
- **optional-advertised**: required only when the product advertises support.
- **degraded**: supported through an explicit reduced experience.
- **unsupported**: rejected before the user enters an impossible flow.
- **deferred**: outside the current product claim.

For every capability, define user value, entry point, dependencies visible to
the user, trust requirements, platform applicability, readiness claim, current
repository foundation, and smallest feasible product loop. Do not use phase
labels as capability semantics.

### Step 4. Define End-To-End Journeys

Each required journey includes:

- Actor and starting context.
- Entry point and user intent.
- Ordered interaction steps.
- Concrete controls/commands the user invokes and observable system responses.
- Product decisions and permission moments.
- Success outcome.
- Exit, cancellation, retry, and recovery paths.
- Cross-session, cross-device, and platform behavior.
- Linked capability IDs.

Walk first use, recurring use, configuration, destructive actions, degraded
capabilities, disconnect/restart, and account/device switching.

### Step 5. Define The Visible Product State Model

For every journey surface, define:

- Empty and first-use state.
- Loading, queued, streaming, and long-running state.
- Partial success and background continuation.
- Permission or approval waiting state.
- Unsupported/degraded state.
- Typed failure and actionable recovery.
- Cancelled, disconnected, stale, and restored state.
- Terminal success and durable readback.

State names describe user-observable meaning, not component booleans. Every
state declares allowed actions, forbidden actions, transition triggers, and
what remains durable.

### Step 6. Define Platform And Capability Adaptation

Create a product-level platform matrix:

| Capability | Desktop | Mobile | Browser | Degradation or exclusion |
|---|---|---|---|---|

Shared business outcomes must remain coherent while device capabilities may
differ. Do not require Mobile to imitate Desktop-only filesystem, shell,
window, or stdio behavior. Unsupported paths fail before the user commits work.

### Step 7. Require An Executable Prototype When UI Is Material

Invoke `pt-prototype-design` when journeys depend on layout, interaction,
information hierarchy, or state transitions that text cannot settle.

The prototype must:

- Trace surfaces and states to product capability/journey IDs.
- Cover critical success, waiting, error, recovery, and degraded states.
- Use Peers-Touch UI Identity and the production component system.
- Produce L1 static, L2 visual, and required L3 dynamic evidence.
- Reach `confirmed` before it becomes an implementation reference.

Prototype confirmation proves the intended experience, not backend correctness
or production readiness.

### Step 8. Prove Feasibility

For every required capability, add a feasibility closure:

| Capability | Tangible user/system actions | Existing foundation | Missing closure | Executable proof |
|---|---|---|---|---|

Rules:

- Inspect the current repository; do not infer feasibility from architecture
  prose or benchmark existence.
- Name the smallest end-to-end loop that produces user value.
- Identify reusable code, contracts, tests, prototype surfaces, and runtime
  entrypoints.
- Name the exact missing behavior instead of saying "backend/frontend work".
- Define a deterministic command, runtime scenario, or readback that can prove
  the loop.
- Mark speculative or absent foundations `unproven`; do not disguise them as a
  roadmap estimate.
- Feasibility proves that a path can be built and tested. It does not define
  implementation phases or authorize execution.

### Step 9. Build The Product Acceptance Matrix

Every required journey maps through:

```text
benchmark evidence
  -> product capability ID
  -> journey and visible state
  -> architecture requirement
  -> prototype surface when applicable
  -> receiver-perspective assertion
  -> production evidence type
```

Acceptance assertions must include:

- The user's exact action and visible system response.
- The current foundation, missing closure, and smallest feasible loop.
- Durable source readback when state persists.
- Failure/recovery assertions.
- Security and actor/device isolation where relevant.
- Runtime cells and platform cells being claimed.
- Evidence path and prohibition on screenshot-only proof.

### Step 10. Run The Product Acceptance Gate

Return `PRODUCT_READY_FOR_ARCHITECTURE` only when:

- Product thesis, users, jobs, promise, and non-goals are explicit.
- Relevant benchmark behaviors have dispositions and evidence.
- Required/optional/degraded/unsupported scope is frozen with stable IDs.
- End-to-end journeys have no missing state or recovery path.
- Desktop/Mobile/browser product differences are explicit.
- Material UI has a confirmed or explicitly review-blocked prototype.
- Every required capability has a repository-backed feasibility closure and
  executable proof.
- Every required capability maps to receiver-perspective acceptance.
- Open product decisions are resolved or named as blockers.
- An independent reviewer or owner explicitly approves the product contract.

Otherwise return `PRODUCT_DESIGN_INCOMPLETE` and list exact missing product
decisions. Do not push ambiguity into architecture or planning.

## Required Artifacts

For module-level product work, place the following beside the governing
architecture module unless a higher-level product source already owns them:

- `product-definition.md`
- `benchmark-disposition.md` when external benchmarks are used
- `experience-contract.md`
- `product-state-model.md`
- `acceptance-matrix.md`
- `prototype/README.md` when an executable prototype is required

Update the nearest `README.md` and `docs/README.md` when the module becomes a
current source. Do not duplicate architecture topology in product documents.

## Handoff To Architecture

The handoff package is:

- Accepted product document paths.
- Stable capability and journey IDs.
- Required, optional, degraded, unsupported, and deferred scope.
- Benchmark disposition ledger.
- Visible state and recovery contracts.
- Confirmed prototype paths/status where applicable.
- Product acceptance matrix and required runtime/platform cells.
- Explicitly accepted product risks and non-goals.

`pt-architecture-design-methodology` maps this package to ownership, topology,
contracts, and quality gates. It may return `PRODUCT_AMENDMENT_REQUIRED` when
the product contract is contradictory, unbounded, or not architecturally
falsifiable.

## Review Prompt

Generate a review prompt asking an independent reviewer to evaluate:

1. Whether target users, jobs, and product promise are coherent.
2. Whether benchmark observations and dispositions are evidence-backed.
3. Whether required scope closes complete user journeys.
4. Whether visible states cover waiting, failure, recovery, and degradation.
5. Whether Desktop, Mobile, and browser claims are honest.
6. Whether prototype evidence resolves material UX uncertainty.
7. Whether acceptance is receiver-perspective and objectively provable.
8. Whether every required capability has tangible actions, repository-backed
   feasibility, a smallest viable loop, and executable proof.
9. Whether any architecture or implementation decision is disguised as
   product design.

The reviewer returns `passed`, `conditionally passed`, or `changes required`.

## Anti-Patterns

Never:

- Start from a feature checklist without users, jobs, and outcomes.
- Enumerate capabilities without concrete actions and feasibility evidence.
- Copy LobeHub, AgentBox, or another benchmark without a disposition ledger.
- Use a benchmark brand as the canonical Peers product/prototype identity.
- Call a happy-path wireframe a complete experience.
- Leave loading, approval, cancellation, failure, recovery, or degraded states
  to implementation.
- Define runtime ownership, APIs, storage, or task order in this skill.
- Treat prototype mocks as production acceptance evidence.
- Enter architecture or planning with unresolved required product decisions.
