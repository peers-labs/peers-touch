# Secure Content Desktop Lifecycle Evidence Amendment - Review Prompt

> **Status**: pending review
> **Version**: v1.0
> **Created**: 2026-09-16 | **Updated**: 2026-09-16
> **Owner**: Architecture Team

---

Review proposed `SC-D21` in:

- `docs/architecture/secure-content/decisions.md`
- `docs/architecture/secure-content/README.md`
- `docs/architecture/secure-content/data-model.md`
- `docs/architecture/secure-content/integration.md`
- `docs/architecture/secure-content/operations.md`
- `docs/architecture/secure-content/security.md`
- `docs/architecture/local-dev-control-plane/design.md`
- `docs/architecture/local-dev-control-plane/integration.md`
- `docs/client/desktop/runtime-projections.md`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut/plan.md`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-work-items.yaml`

## Verified Gap

W7S checkpoint `6590d0997` passes its focused source checks, but W7 cannot run
the `desktop-pilot` and `browser-private-boundary` journeys without inventing
four semantics:

1. observation at `persisted-before-send`, `sent-before-response`, and
   `response-before-local-commit`;
2. runtime-owner acknowledgement and continuation after a forced restart;
3. deterministic capture termination while WebSocket/SSE remains open;
4. owner-provisioned account switch, Station switch, publisher-device
   revocation, and historical-recovery-epoch inputs.

Timing, stream silence, scenario-owned process control, direct database
mutation, and parallel harness business logic are forbidden substitutes.

## Proposed Decision

`SC-D21` proposes:

1. Acceptance-enabled builds expose exactly three one-shot,
   operation-scoped lifecycle barriers at production-owned store/transport/store
   boundaries.
2. Barrier records bind source checkpoint, runtime manifest, boot identity,
   session generation, operation identity, ordinal, bounded state, and opaque
   digests. The external scenario can await/release a token but cannot create
   state or supply a response.
3. Production builds expose no observation controller. Missing, stale,
   duplicate, wrong-boot, wrong-generation, or out-of-order tokens fail closed.
4. A forced restart is requested through an immutable resume artifact. Only
   the W7 runtime owner acquires leases and restarts the process.
5. Continuation requires a fresh immutable child manifest bound to the parent
   digest and restart request, unchanged source/profile/client/storage
   identities, a changed Native boot identity, and a non-regressing session
   generation.
6. Browser network capture uses monotonic observer sequence numbers. A terminal
   marker is enqueued and persisted on the same observer event loop after the
   production action resolves. Socket closure, sleep, timeout, and quiet period
   are not successful terminal evidence.
7. Account/Station switch, publisher-device revocation, and historical recovery
   epoch are immutable fixture handles from their truth owners. Scenarios cannot
   fabricate actors, devices, profiles, epochs, or revocation rows.
8. Fixture secrets are delivered directly to Native through a run-scoped
   secret channel and never enter manifests, logs, barriers, screenshots,
   traces, or results.
9. Missing runtime or fixture capabilities produce typed blockers and park only
   the affected journey branch.
10. W7S/W7 remain blocked until independent review passes and the Owner accepts
    `SC-D21`.

## Review Questions

1. Do the three barriers identify real production commit boundaries without
   duplicating store, transport, response-validation, or crypto logic?
2. Is the barrier ordering sufficient to prove crash behavior at all three W7
   lifecycle cut points?
3. Are boot identity, session generation, manifest lineage, and retained
   storage identity sufficient to prove a real restart continuation?
4. Does runtime-owner-only restart preserve the local-dev control-plane lease
   and ownership contract?
5. Does the same-event-loop terminal marker close a finite Browser capture
   without requiring WebSocket/SSE shutdown?
6. Can unrelated stream events be separated deterministically by the observer
   sequence and capture/action identities?
7. Do the four fixture handles preserve Actor Identity, Recovery, Key Exchange,
   and environment/runtime ownership?
8. Are secrets and stable identities excluded from every durable evidence
   artifact?
9. Are all unavailable capabilities fail-closed with no timing or synthetic
   fallback?
10. Does the plan projection stop at W7S/W7 and avoid W8, Mobile, hard cut, or
    formal Acceptance expansion?

## Required Verdict

Return:

```text
Verdict: PASS | HOLD | REJECT

Findings:
- severity
- exact source reference
- violated invariant or missing semantic
- required correction

Decision checks:
- production-delegating barrier ownership: PASS | HOLD
- barrier ordering and replay/failure semantics: PASS | HOLD
- runtime-owner restart and manifest lineage: PASS | HOLD
- WebSocket/SSE terminal marker: PASS | HOLD
- fixture ownership and secret isolation: PASS | HOLD
- plan/work-item projection: PASS | HOLD
```

A `PASS` means `SC-D21` is internally consistent and ready for explicit Owner
acceptance. It does not accept the decision, authorize implementation or
runtime mutation, establish W7 `FUNCTIONAL_PASS`, or release W8 and later work.

## Outcome

- Owner acceptance: accepted on 2026-09-16.
- W7S execution: released to the execution queue.
