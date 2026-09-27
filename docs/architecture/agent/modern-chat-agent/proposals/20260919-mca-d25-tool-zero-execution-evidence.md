# MCA-D25 Tool Zero-Execution Evidence Amendment

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-09-19 | **Updated**: 2026-09-19
> **Owner**: Peers-Touch Agent Team
> **Module**: `tooling/acceptance/`, `apps/station/app/subserver/agent/`,
> `apps/desktop/`

---

## 1. Scope

This amendment resolves a contradiction between MCA-D21 role applicability
and MCA-D23 governed ToolCall failure semantics. It keeps all 86 reviewed J03
tuples and their locale/ordering dimensions unchanged.

It defines:

- tuple-level role applicability through reviewed matrix rows filtered by
  ordering after cell rules are expanded;
- truthful zero-execution evidence for ToolCalls rejected or cancelled before
  an executor can produce a receipt;
- the J03 meaning of `ERR-O06` as expiry of the ToolCall receipt-recovery
  credential, while J04 retains CapabilityOperation cleanup-lease expiry.

It does not weaken runtime identity, remove a cell, synthesize a receipt, or
change MCA-A08's exclusive ownership of `PROVEN` promotion.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| `ERR-O01` removes the selected executor before dispatch and therefore cannot produce an executor receipt | `verified_fact` | MCA-D23 section 7.3 and current ToolDispatch lifecycle | high | Exact-source tuple |
| `R-05/A` and `R-07/A` require zero execution before the dispatch/effect boundary | `accepted_decision` | MCA-D23 section 7.2 | high | Exact-source tuple |
| The current J03 row requires `executor-receipts` for every cell and has no `zero-execution` role | `verified_fact` | `agent-v2-runtime-matrix.yaml`, `agent_v2_gate.py`, proof contract | high | None |
| A ToolCall is not a `CapabilityOperation` and has no cleanup lease | `accepted_decision` | `design.md` section 21 and `data-model.md` section 7 | high | None |
| Reusing a different entity as an executor receipt or cleanup lease would fabricate evidence | `inference` | MCA-D19E and MCA-D21 anti-fabrication rules | high | None |

## 3. Decision

### MCA-D25: Role Applicability Follows The Executed Boundary

The reviewed matrix may split one platform/runtime into multiple rows and
apply an `ordering_filter` after global cell rules. This changes only role
applicability and attestation profile; the expanded tuple key set and count
remain exact.

J03 tuples that terminate before executor receipt creation use:

- `station_turn` runtime attestation;
- `receiver-dom`, `station-readback`, `measurement-report`,
  `side-effect-count`, `zero-execution`, `replay`, and `cleanup`;
- no `executor-receipts`.

The zero-execution J03 tuples are:

- `ERR-O01`;
- `ERR-O05`;
- `R-05` ordering `A`;
- `R-07` ordering `A`.

All other Desktop and Browser J03 tuples retain
`client_capability_turn` or `station_capability_turn` and require real
executor receipts.

For J03 only, `ERR-O06` means:

1. a PREPARED ToolCall receipt is durable;
2. its Station-issued receipt-recovery credential expires;
3. an old recovery attempt is rejected;
4. reconciliation settles without a fabricated result or continuation.

J04 continues to use the independently fenced `CapabilityOperation` cleanup
lease defined by MCA-D16.

## 4. Ownership And Invariants

| Concern | Owner |
|---|---|
| Tuple scope and role applicability | Reviewed runtime matrix |
| Turn and ToolCall admission/cancellation truth | Station Turn and ToolDispatch services |
| Client receipt truth | Desktop Rust receipt ledger |
| Station-executor receipt truth | Station ToolDispatch |
| Zero-execution proof | Owner counters plus Station readback |
| Candidate assembly | Shared Agent V2 candidate producer |
| Promotion | Separate validator under MCA-A08 |

Invariants:

1. A missing executor receipt is represented as not applicable, never by a
   placeholder.
2. `zero-execution.count` is exactly `0` and binds the same tuple and ToolCall.
3. Every tuple retains a fresh `scenarioExecutionId` and primary Turn identity.
4. Splitting rows must preserve the exact 86 J03 tuple keys except for the
   reviewed row identifier.
5. The matrix hash and schema versions advance together.

## 5. Alternatives

- Fabricate a cancellation receipt: rejected because no executor emitted it.
- Remove zero-execution cells: rejected because it weakens accepted scope.
- Treat J03 ToolCalls as CapabilityOperations: rejected because it violates
  the canonical separation in `design.md` and `data-model.md`.
- Require executor receipts despite zero execution: rejected because it makes
  formal proof impossible without false evidence.

## 6. Architecture Gates

1. Matrix expansion still produces exactly 86 unique J03 tuples.
2. Zero-execution tuples require `zero-execution` and forbid
   `executor-receipts`.
3. Executed tuples still require `executor-receipts`.
4. Both race orderings remain independent executions.
5. J03 `ERR-O06` proves receipt-recovery expiry; J04 `ERR-O06` proves cleanup
   lease expiry.
6. Candidate and validator tests reject role-policy or profile drift.

## 7. Owner Verdict

```text
APPROVE MCA-D25
```

The Owner's full delegated authority for uninterrupted MCA completion applies
to this evidence-correctness amendment. The amendment preserves tuple scope
and strengthens the no-fabrication boundary.
