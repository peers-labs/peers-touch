# MCA-D29 Stateful External Runtime - Architecture Review

> **Status**: review-complete
> **Version**: v1.0
> **Created**: 2026-10-01 | **Updated**: 2026-10-01
> **Owner**: Peers-Touch Agent Team
> **Verdict**: PRODUCT_READY_FOR_ARCHITECTURE / DESIGN_AMENDMENT_ACCEPTED

---

## Review Scope

Reviewed:

- `product-definition.md` MCA-P12 activation
- `experience-contract.md` MCA-J10
- `product-state-model.md` external runtime lifecycle
- `acceptance-matrix.md` P12 receiver evidence
- `design.md`, `decisions.md`, `data-model.md`, `integration.md`, and
  `module-layout.md`
- `20261001-mca-d29-stateful-external-runtime.md`
- Existing runtime binding, admission, provider, conversation, stream, and
  runtime-evidence source

## Product Review

The activated capability preserves the accepted target user and product
promise: long-running work may resume through a topic-owned external session
without making external runtime support a prerequisite for Direct Model chat.
Success, waiting, resume failure, confirmation, cleanup failure, reset, and
fresh-session states are observable and receiver-testable.

No new prototype is required. Runtime selection, message recovery actions,
destructive confirmation, structured activity blocks, and runtime diagnostics
already have accepted production UI patterns; this amendment composes those
patterns without introducing a new navigation or layout decision.

Result: `PRODUCT_READY_FOR_ARCHITECTURE`.

## Findings

### Blocking findings

None after the following requirements were made explicit:

- session creation is persisted before output is forwarded;
- resume never falls back to a new session;
- reset persists a fence before external cleanup;
- cleanup failure blocks new execution and remains retryable;
- reset replay is idempotent and payload-conflicting replay is rejected;
- runtime-home paths remain Station-private;
- Browser has no external process or reset authority;
- runtime advertisement depends on complete adapter configuration and
  executable health.

### Non-blocking findings

- The first adapter may use a vendor-specific JSONL translator, but the
  Station-facing protocol and runtime ID must remain provider-neutral.
- Deployment credentials are an operational prerequisite and are not part of
  the portable runtime binding.
- Structured activity support may vary by adapter, but every emitted activity
  must use the closed, bounded Station projection.

## Failure Semantics

- Missing adapter or executable: `RUNTIME_UNAVAILABLE`.
- Missing/invalid persisted session during resume:
  `RUNTIME_RESUME_UNAVAILABLE`.
- User cancels confirmation: no mutation.
- Reset cleanup failure: durable `CLEANUP_FAILED`, same-command retry only.
- Stale Conversation version: `LIFECYCLE_STALE_VERSION`.
- Idempotency payload mismatch: `IDEMPOTENCY_CONFLICT`.
- Process cancellation: terminal Turn cancellation, session preserved.

## Forbidden Relationships

- No client-owned session ID, epoch, runtime home, process, or reset.
- No shell command interpolation.
- No direct-model retry presented as stateful resume.
- No automatic reset or fallback after resume failure.
- No new Turn while a reset fence or cleanup failure is active.
- No cross-Conversation writable runtime home or external session.

## Evidence Verdict

Required exact-source evidence is sufficient and falsifiable:

- two-topic isolation;
- first session creation;
- follow-up and restart resume;
- real resume-unavailable error;
- localized confirmation;
- pre-confirmation immutability;
- cleanup and epoch rotation;
- reset replay/conflict;
- fresh post-reset session;
- Browser projection with zero local runtime activity;
- process/session/home cleanup.

Result: `DESIGN_AMENDMENT_ACCEPTED`.
