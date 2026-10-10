# Remote Content PreKey Submit Validation Amendment Review

> **Status**: passed
> **Version**: v1.0
> **Created**: 2026-10-04 | **Updated**: 2026-10-04
> **Owner**: Social / Federation

---

## 1. Review Scope

Review proposed `CSS-D10` across:

- `docs/architecture/domains/social/cross-station/design.md`
- `docs/architecture/domains/social/cross-station/decisions.md`
- `docs/architecture/domains/social/cross-station/data-model.md`
- `docs/architecture/domains/social/cross-station/integration.md`
- `docs/architecture/shared/security/secure-content/decisions.md` (`SC-D17`)
- `docs/architecture/domains/social/cross-station/execution-plans/20261003-native-private-social/plan.md`
- `docs/architecture/domains/social/cross-station/execution-plans/20261003-native-private-social/tasks/CSS-02D-audience-matrix.md`

## 2. Verified Evidence

- Local submit validation calls transaction-bound
  `ValidateContentPreKeyClaims`.
- CSS-02D partitions remote claims through
  `ClaimRemoteContentPreKeys`.
- Current partitioned submit validation removes every remote target and calls
  only the local validator.
- The only registered Federation Content PreKey route is irreversible claim.
- Exact claim replay verifies receipt identity and bytes but does not run the
  current endpoint/recovery epoch fence.
- `SC-D17` requires every endpoint profile and recovery epoch to be
  revalidated before submit while preserving a read-only internal validation
  capability.

## 3. Required Findings-First Review

Return `passed`, `conditionally passed`, or `changes required`, with exact
source references. Verify:

1. A distinct read-only peer operation is necessary and does not change exact
   claim replay semantics.
2. Key Exchange remains the sole owner of remote claim receipt, endpoint
   profile, and recovery epoch truth.
3. The request binds the authenticated Station pair, Federation, original
   claim request/response, plan identity, and deterministic digests without
   exposing co-recipient or private key material.
4. The target maps to the same namespaced receipt identity used by federated
   claim and performs no key allocation, release, rotation, or reissue.
5. Remote validation completes before the local Social transaction, while
   local validation remains transaction-bound.
6. Each target validation transaction has an independent local linearization
   point; its response is completion evidence, not a global or distributed
   linearization point, lock, or transaction.
7. Stale material, inactive membership, malformed input, missing receipt, and
   peer outage all reject before source Social commit with typed errors.
8. Separate route/scope registration and proto-first generation are required
   before Social wiring.
9. Tests cover stale endpoint, advanced recovery epoch, replay preservation,
   unavailable peer, mixed local/remote partitions, deterministic Station
   order, and zero Social rows on failure.
10. The proposal preserves Native Desktop-only readiness and does not advance
    CSS-02D or CSS-03 before acceptance and implementation.

## 4. Alternatives To Challenge

- Reuse exact claim replay as current validation.
- Validate signed claim bytes only at source.
- Rely only on receiver-side stale rejection.
- Introduce a mutating validation lease or distributed two-phase commit in
  this milestone.

## 5. Required Output

```text
Verdict: PASS | HOLD

Findings:
- severity
- exact source reference
- violated invariant or missing semantic
- required correction

Decision checks:
- CSS-D10 ownership and route separation: PASS | HOLD
- SC-D17 compatibility: PASS | HOLD
- distributed linearization semantics: PASS | HOLD
- CSS-02D plan amendment readiness: PASS | HOLD
```

A `PASS` accepts `CSS-D10` for execution-plan amendment. It does not establish
implementation completion, `SOURCE_READY`, Native product readiness, or
Acceptance proof.

## 6. Review Outcome

- Initial review: `HOLD` on global linearization wording, incomplete failure
  disposition, missing scope-claim bindings, and incomplete Task checks.
- Second review: `HOLD` on the remaining terminal-state mapping, stale review
  wording, and Rust/Mobile/messaging-core consumer checks.
- Final independent review: `PASS` with no blocking findings.
- Owner acceptance: 2026-10-04.
