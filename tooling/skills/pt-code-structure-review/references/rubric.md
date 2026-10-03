# Code Structure Review Rubric

This rubric defines the stable interpretation of `STRUCT-01` through
`STRUCT-09`. Review only changed behavior and the minimum surrounding context
needed to establish ownership and impact.

## Shared Decision Rules

A structural finding blocks only when all are true:

1. The observed code violates a rule below.
2. The violation has a concrete correctness, safety, operability, testability,
   or recurring change-cost consequence.
3. The consequence is attributable to the reviewed change or is required for
   that change to be complete.
4. No documented exception applies.
5. The correction can be stated as an ownership or boundary change, not a
   stylistic preference.

Metrics are triage signals. A 500-line cohesive lookup table can pass. A
20-line function that writes two competing sources of truth must fail.

### Primary Rule Resolution

One finding represents one correction. Assign the rule that owns that
correction as `primaryRuleId`; record other consequences in `relatedRuleIds`.
When several rules describe the same correction, use this precedence:

1. `STRUCT-08` for an incomplete replacement or migration.
2. `STRUCT-04` for a dependency reversal or cycle.
3. `STRUCT-02` for duplicate decision or mutation owners.
4. `STRUCT-06` for side-effect, state-transition, or resource lifecycle.
5. `STRUCT-09` when testability itself is the root boundary defect.
6. `STRUCT-01` for domain vocabulary or model fidelity.
7. `STRUCT-05` for change locality not caused by duplicate ownership.
8. `STRUCT-07` for disproportionate abstraction.
9. `STRUCT-03` for residual cohesion problems.

Do not create a second finding for a lower-precedence rule when the same
correction resolves it. A rule may be primary in another independent finding.

## STRUCT-01 DOMAIN_FIDELITY

### Definition

Names, public APIs, state models, and persistence representations must describe
the accepted domain. The code must not invent a parallel vocabulary or a second
truth that callers must reconcile.

### Detection Questions

- Can a domain expert map the public API to one accepted capability or state?
- Does one concept have conflicting names or meanings across layers?
- Is derived or cached data being treated as authoritative?
- Does a generic container erase invariants that the domain model should make
  explicit?
- Does observability identify the domain operation and stable entity identity?

### Blocking Conditions

- A new model, enum, status, or store duplicates an existing authoritative
  domain concept and can diverge.
- A public API exposes infrastructure terms that force callers to understand
  storage, transport, or framework internals.
- A name materially misrepresents behavior, ownership, security scope, or
  lifecycle state.
- Domain invariants exist only in comments or caller convention and invalid
  states remain constructible.

### Legal Exceptions

- Boundary DTOs may use protocol vocabulary when a mapper performs an explicit,
  total conversion to the domain model.
- Temporary aliases are legal only under an accepted migration plan with one
  canonical write owner, a removal condition, and tests proving equivalence.
- Conventional framework names are acceptable when they do not leak into the
  domain API.

### Positive Example

`ConversationPolicy.canSend(actor, conversation)` exposes the domain decision;
the HTTP handler maps request fields and typed errors without owning the rule.

### Negative Example

The handler checks `member_type == 2`, the database hook checks
`role == "admin"`, and the UI treats `canDelete` as the same policy.

### Fixture

`code-structure/duplicate-domain-policy`

## STRUCT-02 SINGLE_OWNER

### Definition

Each business rule, mutable state, transition, derived projection, and
cross-cutting policy has one authoritative owner. Other layers may adapt or
project that owner but may not independently decide the same fact.

### Detection Questions

- Which function or module is authoritative for this decision?
- Can two code paths write the same logical state?
- Are validation, retry, permission, or normalization rules copied?
- Does a helper silently become a second policy owner?
- Can callers bypass the intended owner?

### Blocking Conditions

- Two modules can independently mutate the same logical state or policy.
- A controller, handler, UI component, or adapter reimplements a domain rule.
- A cache, projection, or compatibility path can overwrite authoritative state.
- Ownership is conditional on call order or undocumented caller behavior.

### Legal Exceptions

- Read-only projections may duplicate representation, not decision logic.
- Independent validation at trust boundaries is legal when each validation has
  a distinct threat model and neither becomes a second business owner.
- Generated clients may mirror a source schema exactly.

### Positive Example

One service owns membership transitions; REST, RPC, and Tauri adapters call it
and translate its typed result.

### Negative Example

A request handler authenticates, mutates membership, updates a cache, publishes
an event, and repairs persistence while each subsystem also exposes direct
mutation APIs.

### Fixture

`code-structure/mixed-owner-handler`

## STRUCT-03 COHESION

### Definition

A function, class, file, and module should group behavior that changes for one
reason. Control flow should expose phases and policy decisions instead of
interleaving unrelated concerns.

### Detection Questions

- Can the unit be described with one responsibility without using "and"?
- Are transport parsing, authorization, domain mutation, persistence, and
  response rendering interleaved?
- Are branches at the same abstraction level?
- Are private helpers extracting concepts or only hiding line count?
- Do related declarations live together?

### Blocking Conditions

- A unit coordinates several independently changing owners and no explicit
  orchestration boundary exists.
- Unrelated side effects are interleaved so partial failure semantics are
  unclear.
- A branch mixes domain decisions with transport or persistence details in a
  way that permits divergent behavior.
- The structure prevents a local fix because every concern shares private
  mutable state.

### Legal Exceptions

- A small orchestration function may sequence multiple owners when it contains
  no duplicated policy and makes failure order explicit.
- A cohesive state machine may be large when states and transitions belong to
  one lifecycle.
- A declarative table may be large without being incohesive.

### Positive Example

An application service sequences `authorize`, `applyTransition`, `persist`,
and `publish`, while each owner exposes one typed operation.

### Negative Example

A single handler parses headers, selects auth policy, writes SQL, mutates cache,
retries network calls, formats UI text, and catches all failures.

### Fixture

`code-structure/mixed-owner-handler`

## STRUCT-04 DEPENDENCY_DIRECTION

### Definition

Dependencies flow from outer adapters toward stable application and domain
contracts. Domain policy must not import UI, transport, persistence, generated
client, or host-runtime details. The graph must remain acyclic.

### Detection Questions

- Does the dependency follow the documented architecture?
- Does a lower-level module import a higher-level consumer?
- Does a shared package depend on a product application?
- Is dependency injection used at a genuine side-effect boundary?
- Would replacing infrastructure require changing domain policy?

### Blocking Conditions

- A direct or transitive cycle is introduced.
- Domain or shared code imports an adapter, UI, process-global runtime, or
  concrete persistence implementation.
- A lower layer calls upward to complete its own contract.
- A supposedly reusable package gains an undeclared platform dependency.

### Legal Exceptions

- Compile-time registration may point inward through an explicitly documented
  composition root.
- Generated bindings may depend on their runtime library.
- Test-only fakes may depend on public interfaces but must not enter production
  dependency paths.

### Positive Example

The composition root constructs a repository adapter and injects the domain
port into the application service.

### Negative Example

The domain service imports the HTTP client to fetch missing state during a
policy decision.

### Fixture

`code-structure/wrong-layer-dependency`

## STRUCT-05 CHANGE_LOCALITY

### Definition

A normal requirement change should be implemented in its natural owner and
propagate through stable contracts. The number of edits must reflect real
cross-layer behavior, not duplicated policy or leaky abstractions.

### Detection Questions

- Where would the next variant or rule change be made?
- Must unrelated callers change together?
- Does adding one case require editing parallel switches or registries?
- Is the public API difficult to use correctly?
- Can the feature be removed without hunting through unrelated modules?

### Blocking Conditions

- A routine domain change requires synchronized edits to multiple unrelated
  policy copies.
- Callers must know private ordering, magic booleans, or invalid combinations.
- A cross-cutting helper expands the blast radius beyond the behavior it owns.
- Removing the feature would leave hidden registration, state, or side effects.

### Legal Exceptions

- Protocol additions legitimately update source schema, generated artifacts,
  adapters, and tests.
- Explicit registries may require one central entry plus an implementation.
- Security checks may intentionally appear at multiple trust boundaries when
  each delegates to one policy owner.

### Positive Example

Adding a membership role changes one domain policy and its contract tests;
adapters consume the same result.

### Negative Example

The same role list is updated in the UI, gateway, service, cache warmer, and
report generator.

### Fixture

`code-structure/duplicate-domain-policy`

## STRUCT-06 EXPLICIT_LIFECYCLE

### Definition

State transitions, side effects, retries, cancellation, cleanup, partial
failure, and observability must be visible in the owning boundary. A reader
must be able to determine what starts, commits, fails, and releases.

### Detection Questions

- Which operation owns commit and rollback?
- Are side effects visible in names and return types?
- What happens after partial success, timeout, cancellation, or retry?
- Are resources released on every terminal path?
- Are errors typed and contextual?
- Can logs or metrics distinguish operation, owner, and result?

### Blocking Conditions

- A getter, mapper, render function, or constructor performs hidden I/O or
  mutation.
- Cleanup depends on the happy path or process exit.
- Errors are swallowed, flattened, or converted to success.
- Retry or event handling is non-idempotent without deduplication.
- State transitions can occur outside the lifecycle owner.

### Legal Exceptions

- Memoization is legal when it is local, bounded, deterministic, and invisible
  to correctness.
- Fire-and-forget work is legal only when durability, ownership, failure
  reporting, and shutdown behavior are explicitly defined.
- Best-effort cleanup is legal when leaked resources are bounded and surfaced.

### Positive Example

`withLease` acquires, runs, records failure, and releases in `finally`; the
caller receives a typed result.

### Negative Example

`getProfile()` writes a cache, starts a background refresh, suppresses errors,
and leaves the timer active after caller cancellation.

### Fixture

`code-structure/hidden-lifecycle`

## STRUCT-07 PROPORTIONAL_ABSTRACTION

### Definition

Every abstraction must remove real duplication, isolate a genuine boundary, or
encode accepted variability. The abstraction must cost less to understand and
change than the concrete behavior it replaces.

### Detection Questions

- What repeated policy or variable dependency does this abstraction own?
- Is there more than one real implementation or accepted future variant?
- Does the wrapper narrow misuse or only rename a call?
- Are interfaces located with consumers rather than speculative providers?
- Would inlining make ownership clearer?

### Blocking Conditions

- Mechanical layering obscures a simple rule and creates pass-through types or
  methods with no independent contract.
- A generic framework is introduced for one concrete use and exposes more
  states than the domain needs.
- An abstraction couples unrelated concepts or forces callers into unsafe
  configuration.
- Inheritance or metaprogramming hides control flow and ownership.

### Legal Exceptions

- A single implementation may justify an interface at an external side-effect
  boundary or for deterministic testing.
- A small wrapper may enforce security, tracing, transaction, or lifecycle
  invariants.
- Repeated declarative data does not require a polymorphic abstraction.

### Positive Example

A `Clock` port isolates nondeterministic time for expiry policy and tests.

### Negative Example

A pure three-branch rule is split into controller, manager, service, factory,
strategy, and adapter classes that only forward arguments.

### Fixture

`code-structure/simple-rule`

## STRUCT-08 COMPLETE_CUTOVER

### Definition

When a design is replaced, the new owner becomes the sole source of truth in
the same change. Old paths, dual writes, fallbacks, aliases, and migration
scaffolding must be removed unless an accepted migration contract bounds them.

### Detection Questions

- Can production still enter the old path?
- Are old and new states written or read concurrently?
- Is a fallback masking missing migration?
- Is the removal condition executable and owned?
- Do docs, tests, and registrations point to one current path?

### Blocking Conditions

- Old and new implementations remain live without one authoritative owner.
- A compatibility shim has no expiry, removal condition, or evidence.
- Dual writes can diverge or partial failure is undefined.
- Dead code, stale registration, or contradictory documentation remains after
  the claimed cutover.

### Legal Exceptions

- A staged migration is legal only when accepted sources define phase,
  authority, compatibility window, reconciliation, rollback, observability,
  and removal Gate.
- Read-only fallback may be legal when it cannot mutate truth and emits bounded
  migration telemetry.

### Positive Example

The new repository becomes the sole writer; old readers are migrated and the
old registration and tests are deleted in the same change.

### Negative Example

The new service is added while the old handler remains reachable "just in
case", and both update separate stores.

### Fixture

`code-structure/half-cutover`

## STRUCT-09 TESTABLE_BOUNDARY

### Definition

Behavior and failure semantics must be observable through stable public
boundaries. Tests should verify decisions and contracts without coupling to
private implementation sequence.

### Detection Questions

- Can success and each material failure be triggered deterministically?
- Are time, network, storage, and process boundaries injectable or controllable?
- Do tests assert public outcomes and durable effects?
- Does production code expose test-only switches?
- Would a refactor with identical behavior break most tests?

### Blocking Conditions

- A material behavior or failure path cannot be tested without global state,
  real time, uncontrolled network, or private method patching.
- The change adds hidden nondeterminism with no boundary.
- Tests only restate implementation calls and cannot detect a contract
  regression.
- Production behavior depends on a test-only bypass or mock path.

### Legal Exceptions

- Thin pure adapters may be covered through integration tests at their public
  boundary.
- Generated code does not require hand-authored unit tests.
- Platform APIs that cannot be injected require a repository-owned harness or
  controlled runtime Gate.

### Positive Example

The service accepts a repository and clock port; tests assert the returned
domain result and persisted state, not private call order.

### Negative Example

The function reads process globals, current time, and the network directly;
tests monkey-patch internals and still cannot prove timeout cleanup.

### Fixture

`code-structure/untestable-boundary`

## Verdict Resolution

1. Collect all evidenced rule violations.
2. Apply documented exceptions and record their proof.
3. If any blocking violation remains, return `REFACTOR_REQUIRED`.
4. Otherwise, if optional improvements remain, return
   `PASS_WITH_SUGGESTIONS`.
5. Otherwise return `PASS`.

When several rules describe one root cause, apply Primary Rule Resolution,
report one finding, and list the other rules in `relatedRuleIds`. Verdict rule
sets contain primary IDs only.
