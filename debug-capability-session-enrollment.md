# Debug Session: capability-session-enrollment
- **Status**: [OPEN]
- **Issue**: The exact-source Foundation diagnostic run cannot establish the native Tauri capability session within 90 seconds. Local and Station session lists are empty while the Desktop supervisor reports a pending device enrollment.
- **Debug Server**: http://127.0.0.1:7789/event
- **Log File**: `.dbg/trae-debug-log-capability-session-enrollment.ndjson`

## Reproduction Steps
1. Use clean source `01ae78e7dc51aa40dbd1c31729841733ecbfd5e0`.
2. Use the approved `chat-native-disposable` profile and its exact-source Station.
3. Run `agent-v2-kernel-foundation-e2e` with the documented restart and disposable-environment authorizations.
4. Observe run `20260911T191643210793Z-f62113bae8d8f4ce56f12a89145ab620`.
5. Confirm the native capability-session preflight times out after 90 seconds with no local or Station sessions.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| A | Fixture reset leaves a pending device-enrollment record that prevents capability lease registration. | High | Low | Failed-run artifacts or Station readback show a pending enrollment after reset and before the supervisor starts. |
| B | The isolated native client retains local enrollment state that no longer matches Station, so the supervisor backs off without registering a session. | High | Medium | Client storage or supervisor evidence shows a local device/enrollment identity whose Station peer is absent or pending. |
| C | Station reset removes capability sessions but does not complete or recreate the selected device enrollment. | Medium | Medium | Station has zero capability sessions and a non-ready device/enrollment row for the exact actor/device. |
| D | Supervisor startup observes enrollment before Fixture setup completes and never receives the state transition required to retry. | Medium | Medium | Timeline shows supervisor backoff before enrollment completion, followed by no retry or wake-up after the Fixture reports ready. |

## Instrumentation Plan
- A: Fixture reset completion and post-reset enrollment state.
- B: Supervisor-selected actor/device identity and local enrollment state.
- C: Station enrollment/session readback for the selected actor/device.
- D: Supervisor backoff, enrollment transition, retry wake-up, and lease registration result.

## Log Evidence
- Failed Gate artifact
  `20260911T191643210793Z-f62113bae8d8f4ce56f12a89145ab620`
  reports zero local and Station capability sessions while the authenticated
  native Harness remains ready.
- The retained Desktop log shows the capability supervisor retrying every five
  seconds and receiving the typed key-not-found result associated with pending
  device enrollment.
- Remote Station logs show two successful `POST /device/enroll` responses at
  `2026-09-11T19:17:57Z`, followed by repeated `409` responses beginning at
  `19:18:15Z`.
- Read-only Station persistence shows that the two successful rows are labeled
  `Mobile`, one for Alice and one for Bob, both created at `19:17:57Z`; no
  Desktop enrollment row exists.
- Two iOS Simulator Peers processes were live throughout the failed run. They
  were started before the Foundation Fixture reset and remain outside this
  worktree's runtime ownership.

## Verification Conclusion
- A is confirmed in its broader isolation form: the Fixture reset empties
  actor identity/device truth, but unrelated live Mobile clients immediately
  repopulate it before the Foundation clients enroll.
- B is confirmed: the Foundation client generates a fresh actor identity in
  isolated run storage, which conflicts with the Mobile-established actor
  identity and receives HTTP 409.
- C is rejected: Station accepts enrollment and persists active device rows;
  they belong to the interfering Mobile runtimes.
- D is rejected as the root cause: the messaging lifecycle repeatedly invokes
  `/device/enroll`; it is not missing a wake-up.
- No product or Gate logic change is justified. The next reproduction must
  isolate the approved Station from the two foreign Mobile clients, then compare
  the new capability-session telemetry against this immutable pre-fix evidence.
