# Debug Session: base-cancelled-localization
- **Status**: [OPEN]
- **Issue**: Exact-source Browser `BASE-CANCELLED` reaches Station cancellation truth, but `localizedCancellationVisible` is false.
- **Debug Server**: http://127.0.0.1:7777/event
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
