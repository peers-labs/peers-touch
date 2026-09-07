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

## Instrumentation
- `apps/desktop/src/acceptance/agent/harness.ts` reports one sanitized event for
  each live, reload, and replay receiver snapshot.
- Captured fields distinguish locale/namespace mismatch, missing store error,
  missing DOM diagnostics, phase-specific projection loss, selector mismatch,
  and phase-specific message/error-detail mismatch.
- Instrumentation does not change Gate tuples, assertions, timeouts, product
  state, or cleanup.

## Verification Conclusion
Pending phase-specific runtime instrumentation.
