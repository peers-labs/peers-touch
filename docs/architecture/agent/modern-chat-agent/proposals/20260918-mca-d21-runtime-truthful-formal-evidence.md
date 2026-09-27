# MCA-D21 Runtime-Truthful Formal Evidence Amendment

> **Status**: accepted
> **Version**: v1.1
> **Created**: 2026-09-18 | **Updated**: 2026-09-19
> **Owner**: Peers-Touch Agent Team
> **Module**: `tooling/acceptance/`, `apps/desktop/src/acceptance/agent/`
> **Accepted**: 2026-09-18

---

## 1. Scope

This proposal corrects the Agent V2 formal-evidence contract for the six
non-Foundation Gates:

- `agent-v2-home-command-center-e2e`
- `agent-v2-capability-binding-e2e`
- `agent-v2-governed-tool-loop-e2e`
- `agent-v2-mcp-lifecycle-e2e`
- `agent-v2-connector-invocation-e2e`
- `agent-v2-evaluation-lab-e2e`

It defines runtime-truthful attestation profiles, per-row role applicability,
and one-execution-per-tuple identity rules. It does not change the accepted
product Journeys, Station ownership, tuple cells, locale/order/sample scope, or
the separate runner/validator proof boundary.

## 2. Verified Trigger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Every J01-J06 matrix row omits `runtime_attestation_profile` and `role_policy` | `verified_fact` | `tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml` rows `home-*` through `evaluation-*` | high | None |
| The validator therefore treats every J01-J06 tuple as legacy direct runtime and applies every Gate role | `verified_fact` | `expanded_matrix_contract()` and `validate_runtime_attestation()` in `tooling/scripts/acceptance-validate.py` | high | None |
| Legacy direct runtime requires a non-empty client capability lease and a ToolCall bound to that lease | `verified_fact` | `validate_runtime_attestation()` direct-runtime branch | high | None |
| Mobile contract, Home command, capability-control, Browser unavailable, and Evaluation scheduler paths do not create those entities | `verified_fact` | Reviewed matrix platform/runtime rows and current J01-J06 production Journey implementations | high | Per-tuple formal rerun after contract correction |
| Reusing one composite capture under many tuple keys would satisfy shape while fabricating independent execution | `verified_fact` | Current J06 test fixture synthesizes 57 entries; the production runner initializes `cell-results` empty | high | None |
| MCA-D19E already forbids inventing local capability and ToolCall facts to satisfy an evidence schema | `accepted_decision` | `decisions.md` MCA-D19E | high | None |
| MCA-A01 cannot create its Development Session because its Task `journeyId` is not a valid workflow identifier | `verified_fact` | Task uses `V2-J01..V2-J06,X3-P4-3`; `dev-session` rejects the Plan/declaration identity mismatch while `dev-work` rejects that value as an invalid identifier | high | Plan amendment |

The current contract cannot be completed honestly. A producer that fills the
missing fields from constants or relabels one execution across multiple tuples
would weaken, not close, formal Acceptance.

## 3. Accepted Decision

### MCA-D21: Runtime-Truthful Formal Evidence Profiles

Every reviewed Agent V2 row must explicitly declare:

1. one runtime attestation profile matching the production path;
2. a complete role policy partitioning Gate roles into `always`, `required`,
   and `not_applicable`;
3. one fresh scenario execution identity for every expanded tuple.

The evidence contract accepts only facts created by that tuple's actual
execution. A missing production entity is represented by a profile that does
not require the entity, never by a synthetic placeholder.

## 4. Evidence Topology

```text
reviewed matrix tuple
  -> profile-specific real scenario adapter
  -> one immutable scenarioExecutionId
  -> runtime-truthful attestation
  -> applicable role observations from the same execution
  -> candidate-only Evidence Store run
  -> separate validator process
  -> PROVEN envelope
```

The matrix remains the scope owner. The scenario adapter observes product
behavior. The shared producer assembles and validates evidence but owns no
product facts. The validator remains the only component allowed to promote a
candidate to `PROVEN`.

## 5. Attestation Profiles

| Profile | Required production facts | Forbidden fabricated facts |
|---|---|---|
| `station_command` | actor, command/idempotency identity, created object IDs, projection revisions, Station/runtime identity | TurnAttempt, ToolCall, client capability lease when the command creates none |
| `station_control_plane` | actor, manifest/binding/readiness identity, authority revision, before/after activity snapshot | conversation, TurnAttempt, ToolCall |
| `station_turn` | actor, conversation runtime binding, runtime snapshot, TurnAttempt | ToolCall or client capability lease when no tool executes |
| `client_capability_turn` | `station_turn` plus real client capability session, fenced ToolCall binding, receipt identity | placeholder capability, placeholder lease, Station executor presented as client executor |
| `station_capability_turn` | `station_turn` plus real Station-owned executor and ToolCall/receipt lineage | client device/lease linkage for a Station-owned execution |
| `contract_only` | contract ID/hash, platform/toolchain, exact round-trip result | runtime process, session, TurnAttempt, ToolCall |
| `unavailable_runtime` | readiness/degradation state, receiver-visible recovery state where applicable, before/after activity with zero execution | successful runtime binding, TurnAttempt, ToolCall |
| `orchestration_guard` | guard ID, source inventory hash, zero violations | product runtime execution |
| `non_advertised` | explicit effective-profile state plus monotonic zero-activity proof | inferred absence from a missing row or selector |

All profiles include tuple identity, `scenarioExecutionId`, source identity,
Station profile, network path, machine identity, cold/warm/neutral/contract
state, and observation time where meaningful.

## 6. Row Assignment

| Matrix row | Proposed profile | Reason |
|---|---|---|
| `home-desktop-direct` | `station_command` | Home submits canonical Chat/Task commands and reads Station projection |
| `home-browser-direct` | `station_command` | Same Station command authority through Browser gateway |
| `home-mobile-contract` | `contract_only` | Mobile delivery is semantic-contract scope only |
| `binding-desktop-direct-local` | `station_control_plane` | Manifest, binding, readiness, CAS, and zero-execution control plane |
| `binding-browser-direct-remote` | `station_control_plane` | Same Station control-plane authority without local execution |
| `binding-mobile-contract` | `contract_only` | Mobile contract compatibility only |
| `binding-custom-plugin-retirement` | `orchestration_guard` | Rejected legacy surface and zero-execution source audit |
| `tool-desktop-local` | `client_capability_turn` | Real Desktop lease, fenced ToolCall, receipt, and continuation |
| `tool-browser-station` | `station_capability_turn` | Tool executes under Station authority, not a Browser-local lease |
| `tool-mobile-contract` | `contract_only` | Mobile contract compatibility only |
| `mcp-desktop-local` | `client_capability_turn` | Real Desktop MCP process/lease/ToolCall lifecycle |
| `mcp-browser-unavailable` | `unavailable_runtime` | Browser shows unavailable/degraded state with zero MCP execution |
| `mcp-mobile-unavailable` | `contract_only` | Mobile unsupported-runtime contract and zero-execution semantics |
| `connector-desktop-direct` | `station_capability_turn` | Connector resource execution is Station-owned |
| `connector-browser-direct` | `station_capability_turn` | Same Station executor through Browser gateway |
| `connector-mobile-contract` | `contract_only` | Mobile contract compatibility only |
| `evaluation-desktop-direct` | `station_turn` | Evaluation scheduler invokes the canonical Station Turn kernel |
| `evaluation-browser-direct` | `station_turn` | Same Station Evaluation/Turn authority through Browser |
| `evaluation-mobile-contract` | `contract_only` | Mobile contract compatibility only |

Foundation assignments accepted by MCA-D19D/E remain unchanged.

## 7. Role Applicability

The proof contract must include `contract-evidence` for every Gate containing a
Mobile contract row. It must include `guard-report` where a retirement guard
row exists and `zero-execution` where unavailable or rejected execution is an
oracle.

Rules:

- `runtime-attestation-set` applies to every tuple.
- `cleanup` applies to every executable or provisioned tuple.
- `contract-evidence` applies only to `contract_only` tuples.
- `guard-report` applies only to `orchestration_guard` tuples.
- `receiver-dom` applies only when a receiver surface is executed; unavailable
  UI may be visibly present and must not be inferred from the profile name.
- Turn and ToolCall roles apply only to profiles that create those entities.
- Process/port/secret canaries apply to MCP runtime tuples, including
  unavailable rows when zero residue is the required fact.
- A role observation set must exactly equal its applicable tuple set.

MCA-D25 refines row assignment for governed ToolCall cells whose accepted
outcome occurs before executor receipt creation. The matrix represents those
tuples in dedicated rows with `station_turn`, `zero-execution`, and no
`executor-receipts`; row ordering filters preserve the original tuple scope.

The validator must stop deriving receiver visibility from the attestation
profile. The observation's typed oracle owns expected and actual visibility.

## 8. Tuple Identity And Non-Reuse

Each tuple must carry a unique `scenarioExecutionId` allocated before the
scenario starts. The following rules are mandatory:

- One execution may supply multiple role observations for its own tuple.
- One execution may not satisfy another tuple by changing row, platform,
  locale, ordering, cell, or sample labels.
- Distinct executable tuples must not reuse their primary command, Turn,
  ToolCall, operation, Evaluation run, or contract-run identity.
- Race orderings `A` and `B` are separate executions.
- Locale tuples must render and hash the requested locale in that execution.
- Cleanup and replay must bind to the same execution identity as the source
  mutation.
- Contract-only tuples bind a unique contract test invocation and immutable
  source hash; they do not claim a product runtime.

Duplicate primary execution identity across tuples is a validator error, not a
warning.

## 9. Component Boundaries

| Component | Owns | Must not own |
|---|---|---|
| Runtime matrix | Tuple scope, profile, role applicability | Runtime observations or pass status |
| Journey adapter | Actual product execution and typed observations for one tuple | Candidate promotion or matrix expansion |
| Shared candidate producer | Exact coverage, schema pins, secret checks, immutable role assembly | Product facts, retries that hide a failed tuple |
| Acceptance runner | Candidate-only run and generated runner metadata | Validator output or `PROVEN` |
| Acceptance validator | Exact source/schema/matrix/oracle validation and proof envelope | Scenario execution or evidence repair |
| Proof-set builder | Seven immutable `PROVEN` envelopes | Filling a missing Gate |

The J01-J06 adapters remain business-domain Acceptance injection. The shared
assembler and validator remain Acceptance infrastructure. Neither may absorb
the other's authority.

## 10. Failure Semantics

- Missing profile or role policy: matrix validation fails.
- Profile requires an entity the scenario did not create: tuple fails
  `UNPROVEN`.
- Required role has no observation: candidate remains `UNPROVEN`.
- Observation references another execution: validator rejects the candidate.
- Runtime/source identity changes during a Gate: discard the Gate run.
- A tuple fails after retries: retain the failed evidence and stop promotion;
  do not omit the tuple.
- Cleanup fails: the tuple and Gate fail.
- Contract-only or unavailable tuple creates a forbidden side effect: tuple
  fails even if visible behavior appears correct.
- Existing evidence under the old matrix/schema identity is stale and cannot be
  promoted.

## 11. Security And Privacy

- Evidence contains hashes or opaque IDs, never raw credentials, bearer
  headers, private keys, local paths, command lines, or provider payloads.
- `scenarioExecutionId` is random/opaque and carries no actor data.
- Actor identity remains hashed and must match all runtime and role artifacts.
- MCP canaries prove absence from artifacts and logs; the canary value itself
  is never persisted.
- Contract evidence records source file hashes and toolchain identity, not
  source contents containing secrets.

## 12. Quality Gates

Before implementation may claim closure:

1. Matrix validation proves every row has an explicit supported profile and a
   complete disjoint role-policy partition.
2. Schema/validator tests cover every profile's exact fields and reject
   cross-profile fields.
3. Producer tests call the full `acceptance-validate.validate_candidate`, not
   only registration `_validate_candidate`.
4. Negative tests reject duplicate tuple, duplicate execution identity, stale
   source, wrong locale/order/sample, missing role, secret-bearing evidence,
   detached Turn/ToolCall/receipt, and dirty cleanup.
5. Per-Journey adapter tests prove one observed capture maps to exactly one
   requested tuple.
6. J01 obtains a repository-owned exact-source Journey and Home provisioner
   allocation; historical manual evidence is not imported.
7. J02-J06 rerun every reviewed tuple on final exact source.
8. Seven independent Gate envelopes validate before proof-set, parity ledger,
   quality, completion, or PR readiness claims.

## 13. Alternatives Considered

### Keep the legacy direct-runtime shape

Rejected. It requires fake ToolCalls and client leases for contract,
control-plane, unavailable, and Station-executor paths.

### Relabel one composite Journey across every tuple

Rejected. It proves one scenario while claiming 33-86 independent
platform/cell/locale/order executions.

### Remove Mobile, Browser, negative, or race tuples

Rejected. That weakens the accepted product and runtime matrix scope.

### Treat all non-runtime rows as static checks

Rejected. Browser unavailable and retirement rows require product-visible and
zero-side-effect observations; only Mobile rows are contract-only.

### Let the producer infer profile and applicable roles

Rejected. Scope belongs to the reviewed matrix, not executable Gate code.

## 14. Consequences

Positive:

- Formal evidence describes the product path that actually ran.
- Mobile contract, unavailable, control-plane, Station executor, and local
  executor semantics become distinguishable.
- A complete proof-set cannot be produced from shallow or duplicated evidence.
- Existing MCA-D19D/E anti-fabrication rules apply consistently to J01-J06.

Negative:

- Matrix identity, proof-contract schema, and all prior Agent V2 candidates
  become stale.
- J01 requires a new repository-owned exact-source Journey.
- J02-J06 runners must be decomposed from composite development flows into
  tuple-aware adapters.
- Full formal execution is materially longer because every reviewed tuple must
  run independently.

## 15. Acceptance And Handoff

Required Owner verdict:

```text
APPROVE MCA-D21
```

or:

```text
REQUEST CHANGES MCA-D21: <blocking findings>
```

Approval authorizes:

- incorporation into `design.md`, `decisions.md`, `data-model.md`, and
  `integration.md`;
- a reviewed matrix/schema version advance;
- amendment of the active MCA-A01 Plan Package before implementation,
  including normalization of its aggregate `journeyId` to the existing valid
  `V2-acceptance` closure identity.

Approval does not authorize fabricated evidence, Gate removal, scope
reduction, history rewrite, destructive runtime reset, or proof promotion
without a separate validator run.

Owner verdict:

```text
APPROVE MCA-D21
```

The Owner accepted MCA-D21 on 2026-09-18.
