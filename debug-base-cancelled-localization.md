# Debug Session: base-cancelled-localization
- **Status**: [OPEN]
- **Issue**: Exact-source Browser `BASE-CANCELLED` reaches Station cancellation truth, but `localizedCancellationVisible` is false.
- **Debug Server**: http://127.0.0.1:7788/event
- **Log File**: `.dbg/trae-debug-log-base-cancelled-localization.ndjson`

## Reproduction Steps
1. Use worktree `peers-ai-agent`, branch `feat/p0-streaming-runtime-message-actions`.
2. Use approved profile `chat-native-disposable` and exact-source Station commit `fab52ff2eb143f7866838757a76657f8981443fb`.
3. Run `agent-v2-kernel-foundation-e2e` with explicit disposable and restart authorization.
4. Observe Browser English `BASE-CANCELLED`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | The live cancellation projection has no localized `message.error`. | Medium | Low | Live typed error exists, but the receiver error element/text is absent. |
| B | Browser locale or Agent namespace remains incorrect after AS-F06. | High | Low | Active locale or expected translation differs from the visible cancellation text. |
| C | Station reload restores the typed payload but not the localized error surface. | Medium | Low | Live phase passes while reload has typed error and no matching text. |
| D | Authoritative snapshot reconciliation clears cancellation visibility. | Medium | Low | Live/reload pass while replay loses the error element or localized text. |
| E | Product state is correct but the harness selector or expected text is wrong. | Medium | Low | DOM contains the correct localized text under a different selector/value. |

## Log Evidence
- Exact-source Gate run:
  `20260907T104051848885Z-c829d8b48eaf1b2805401d42836feeed`.
- Source commit, Station live commit, profile, workspace digest, and protocol
  digest matched.
- The first failed tuple was Browser / Direct / `BASE-CANCELLED` / English.
- The only failed scenario assertion was `localizedCancellationVisible`.
- Provisioner cleanup completed `DONE / PROVEN / passed`.
- Instrumented exact-source run:
  `20260907T112711453558Z-6b870ca13c5a9444eb1fa09d538dffe4`.
- Debug log lines 1-3 show that live, reload, and replay all used locale `en`,
  projected `LIFECYCLE_CANCELLED`, rendered `This operation was cancelled.`,
  matched the expected translation, omitted recovery/resolution, and carried
  the expected phase-specific error detail.
- All three phases used the same canonical Station message ID
  `msg_590070f35487047fad23fb41`. The oracle alone expected the live phase to
  use synthetic `recovered-${turnId}` identity.

## Instrumentation
- `apps/desktop/src/acceptance/agent/harness.ts` reports one sanitized event for
  each live, reload, and replay receiver snapshot.
- Captured fields distinguish locale/namespace mismatch, missing store error,
  missing DOM diagnostics, phase-specific projection loss, selector mismatch,
  and phase-specific message/error-detail mismatch.
- Instrumentation does not change Gate tuples, assertions, timeouts, product
  state, or cleanup.

## Verification Conclusion
Hypothesis E is confirmed. Hypotheses A-D are rejected. Product cancellation
state and localization are correct in all three phases; the business
Acceptance oracle incorrectly rejects the stronger canonical Station message
identity during the live phase. The minimal fix requires canonical
`station.messageId` in live, reload, and replay in both the TypeScript producer
oracle and independent Python oracle. Instrumentation remains active for
post-fix comparison.

## Local Correction
- The TypeScript producer oracle now requires `station.messageId` for live,
  reload, and replay receiver phases.
- The independent Python oracle enforces the same canonical identity.
- The Python fixture models canonical identity in all phases and rejects a
  synthetic `recovered-${turnId}` live identity.
- Instrumentation now emits `runId=post-fix`.

## Local Verification
- Desktop TypeScript check: passed.
- Focused Foundation/oracle/static tests: `170/170` passed.
- Full Agent Acceptance discovery: `321/321` passed.
- Python compilation and `git diff --check`: passed.
- Exact-source post-fix Gate:
  `20260907T120307080667Z-8452fb7d9d650470a5dc6a1f396fb3cb`.
- Browser English and Simplified Chinese live, reload, and replay phases all
  retained one canonical Station message ID, exact localized text, typed
  cancellation metadata, phase-specific error details, and no recovery action.
- The Gate advanced to `BASE-CONTEXT_OVERFLOW`, where the direct-runtime group
  is not implemented.
- Provisioner cleanup completed `DONE / PROVEN / passed`.
- `BASE-CANCELLED` is source-backed closed. Foundation/G-F remain
  `PARTIAL / UNPROVEN`.

## Recurrence

- Exact-source diagnostic run
  `20260907T163617263286Z-4fc7227e804a51714f2b1b842acef785`
  on `b5b3fe8209b74926ebaa996147680124ae7e986d` crossed all AS-F06 tuples,
  then failed first at Browser English `BASE-CANCELLED` on
  `localizedCancellationVisible`.
- The existing reporter still targeted port `7777`, which belongs to a
  different worktree's collector, so this recurrence produced no local
  phase-level debug evidence. No conclusion from the earlier successful run is
  reused to explain the new failure.
- The reporter now targets this worktree's isolated collector on port `7788`.
  The next exact-source run must capture live, reload, and replay receiver facts
  before any additional cancellation fix is considered.

## Durable Reason Recurrence

- Exact-source Gate run
  `20260907T212136188205Z-f78e3ec5c47b32c4a7db07fcbb163269`
  on checkpoint `5e48bcbe84536f707e40eb1ca4099d0427c2b139`
  again failed first at Browser English `BASE-CANCELLED` on
  `localizedCancellationVisible`.
- The three receiver snapshots used the same canonical Station message ID and
  retained the cancelled terminal status, typed error, localized text, and
  absence of recovery:
  - live: `errorDetail=cancelled_by_user`
  - reload: `errorDetail=""`
  - replay: `errorDetail=""`
- This is not a locale, selector, message-identity, or visibility failure. The
  remaining defect is the loss of the Station-owned cancellation reason across
  durable reload and authoritative replay projection.

## Durable Reason Hypotheses

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| F | The authoritative Station snapshot omits `terminal_reason`. | High | Low | The captured snapshot is cancelled but both reason aliases are empty before Desktop reconciliation. |
| G | `reconcileRecoveredTurn` returns before projection because the operation is absent or owns another turn. | Medium | Low | Pre-reconcile operation is absent or `operation.turnId !== turnId`, and the post-reconcile message remains unchanged. |
| H | Cached Station message projection does not recover the persisted cancellation reason. | Confirmed | Low | Reload receives the canonical typed payload and cancelled status while `errorDetail` is empty before replay. |
| I | Snapshot projection applies the reason, then message merge or terminal settlement overwrites it. | Medium | Low | Snapshot reason is present and the operation matches, but the post-reconcile message loses `errorDetail`. |

## Canonical Live Identity Recurrence

- Exact-source checkpoint
  `3a19f481598a3d38700c48d558c17ec8a80d864e` used Station
  `chat-native-disposable` and Acceptance binary
  `47b292e16b17e392b8d41d7a19fbfdddf25b3f43503d919ef9d7b04bc13722d9`;
  embedded-WebDriver smoke passed.
- Gate run
  `20260908T064006111625Z-540667c6c92d0b09724b3153dcdb37e8`
  failed first at Browser English `BASE-CANCELLED` on
  `localizedCancellationVisible`. Outer run
  `20260908T063953866706Z-cf56f38dddfb187663829e3a48a827cf`
  completed `FAILED / PARTIAL / UNPROVEN`; inner and Provisioner cleanup both
  passed with all client ports and storage released.
- Runtime lines 1-5 reject localization, typed-error, visibility, and durable
  reason regressions. Live, reload, and replay all show the expected localized
  cancellation and replay retains `cancelled_by_user`.
- The only mismatch is live message identity:
  `recovered-turn_13a553436f19a81fac1f26b5` versus canonical Station message
  `msg_2ebd0eb86a557920afef90e9` on reload and replay.
- Root cause: the business Acceptance scenario manually called
  `applyRecoveredTurnEvent` and sampled the intermediate projection without
  executing the production runtime's terminal `reconcileRecoveredTurn` step.
  With no Chat operation or canonical message loaded, the projection correctly
  used its temporary recovery identity, making the canonical live assertion
  timing-dependent.
- Local correction: after applying the source-bound terminal event, the
  scenario now executes `reconcileRecoveredTurn` with the same terminal status
  and reason derivation as `chatRuntime`, then samples the receiver. This
  changes no product runtime, assertion, tuple, timeout, or cleanup behavior.
  Instrumentation remains active with `runId=post-fix`.

The next run records only the F-I observation boundary. Product behavior,
matrix tuples, assertions, timeouts, and cleanup remain unchanged.
