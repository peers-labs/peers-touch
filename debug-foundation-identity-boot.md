# Debug Session: foundation-identity-boot
- **Status**: [OPEN]
- **Issue**: Browser Foundation startup intermittently times out before the identity login precondition.
- **Debug Server**: `http://127.0.0.1:7778/event`
- **Log File**: `.dbg/trae-debug-log-foundation-identity-boot.ndjson`

## Reproduction Steps
1. Activate the `chat-native-disposable` profile.
2. Verify the Station is remote, healthy, and source-matched.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable restart envelope.
4. Observe whether Browser login reaches `accountGate` or authenticated-ready within 30 seconds.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Identity boot remains in `checkingLaunchContext`. | High | Low | Pending: phase samples during the precondition wait. |
| B | Session restoration reaches authenticated state but lifecycle never reaches `ready`. | Medium | Low | Pending: auth/lifecycle samples during the wait. |
| C | Browser renderer or WebDriver exits before the precondition resolves. | Medium | Low | Pending: client liveness at Harness failure. |
| D | Station selection completes but the next boot cycle does not consume the updated launch context. | Medium | Medium | Pending: active Station and boot-reason samples. |
| E | Persisted Browser identity races with clean-fixture login and leaves a non-login phase. | Low | Medium | Pending: initial actor/auth/phase sequence. |

## Log Evidence
- Exact-source run `20260904T110406527755Z-0a3cb161b052d5ff5c86e5176456b73c` timed out at `identity login precondition`.
- Exact-source run `20260904T121940506424Z-c261df4ab00dd6c343d3c4aa46b3094d` reproduced the same timeout.
- Exact-source run `20260904T110841855632Z-6c1f0ef3e8965a00be0c381eeb3f9754` crossed login, so the failure is intermittent.

## Instrumentation
- `A`: identity phase and lifecycle transitions during the login precondition.
- `B`: final identity phase and lifecycle state when the precondition times out.
- `C`: Browser process, driver, and port liveness when a Harness call fails.
- `D`: identity state immediately after the Harness requests boot.
- `E`: persisted authentication and identity state at login entry.

## Verification Conclusion
Pending instrumentation evidence.
