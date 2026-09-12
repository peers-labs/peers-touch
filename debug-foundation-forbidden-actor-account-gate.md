# Debug Session: foundation-forbidden-actor-account-gate
- **Status**: [OPEN]
- **Issue**: Exact-source Foundation run `20260912T120931452932Z-eaa05a1591ac11c0a71664540cb4d52e` failed at Browser English `BASE-FORBIDDEN_ACTOR` while waiting for the forbidden actor account gate.
- **Debug Server**: `http://127.0.0.1:7795/event`
- **Log File**: `.dbg/trae-debug-log-foundation-forbidden-actor-account-gate.ndjson`

## Reproduction Steps
1. Deploy clean checkpoint `8a080bf6878ca11bdd49f88db8d3ba92cba84b70` to the approved `chat-native-disposable-station` environment.
2. Run C08 first with the approved disposable reset; confirm `DONE / PROVEN`.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable reset and Station restart authorizations.
4. Observe Browser English `BASE-FORBIDDEN_ACTOR` fail while waiting for `forbidden actor account gate`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Disposable reset did not expose the forbidden actor account in the client account projection. | Low | Low | Rejected: the observed account gate loaded with one restorable account and later runs loaded two. |
| B | The Harness uses an actor/account identifier that differs from the canonical Fixture identity. | Low | Low | Rejected: Bob owner setup and Alice's source-bound foreign-resource rejection both completed. |
| C | Prior restart or session reconciliation retained or restored the wrong current account/session after recovery logout. | Low | Medium | Rejected in the exact-source rerun: recovery moved `authenticated -> loggingOut -> accountGate` and cleared the session. |
| D | Station already returned a typed forbidden/not-found result, but the Harness waits only for the UI account gate. | Low | Low | Rejected as the timeout cause: the typed rejection and visible recovery surface completed before the click. |
| E | Earlier scenario cleanup removed the actor/device fixture needed by the forbidden-actor setup. | Low | Medium | Rejected: the owner fixture was created and the foreign read/write attempts reached Station. |

## Log Evidence
- Foundation Gate log: `FoundationCandidateError ... timed out waiting for: forbidden actor account gate`.
- Outer Provisioner cleanup: `DONE / PROVEN / passed`.
- AS-F06 four-tuple post-fix cleanup completed before this failure.
- Existing logout-pipeline telemetry around the failure records all four
  handlers completing in milliseconds; `close-browser-capability-session`
  may fail closed, but `clear-zustand-stores`,
  `clear-client-storage-caches`, and `refresh-current-session` still complete.
- The missing evidence is whether those handler sequences belong to the
  recovery click and whether a later identity transition overwrites the
  expected `accountGate` phase.
- Exact-source run
  `20260912T134934601704Z-2a47f9cf4b4e32fb5b07225daad92a1c`
  on `09a6897e3d4b4c4399cc53cd69a4a75153f0fe18` reached the target
  recovery click. The click was observed, `identityRuntime.logout()` moved from
  `authenticated` through `loggingOut`, all four pipeline handlers settled,
  session state became unauthenticated, and the Harness observed
  `phaseKind=accountGate` with a non-empty restorable account list.
- That Gate advanced to Browser English `BASE-INTERRUPTED`, so the prior
  account-gate timeout did not reproduce and no identity behavior correction
  is justified.

## Instrumentation Plan
1. Capture the Harness identity/session snapshot before the recovery click.
2. Observe the DOM click and the next-microtask identity/session snapshot.
3. Capture `identityRuntime.logout` entry and `LOGOUT_REQUESTED` dispatch.
4. Capture session logout resolution or rejection.
5. Capture each logout identity-pipeline handler start, finish, or failure.
6. Capture account-gate load completion and the final timeout snapshot.

## Verification Conclusion
The exact-source rerun rejects A-E as stable product defects. The prior timeout
was not reproduced; the instrumentation remains `[OPEN]` until the enclosing
Foundation proof completes or the user authorizes cleanup.
