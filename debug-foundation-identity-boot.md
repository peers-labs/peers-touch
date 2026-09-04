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
| A | Identity boot remains in `checkingLaunchContext`. | High | Low | Rejected: successful runs reached `accountGate`; the post-fix recovery moved through `checkingLaunchContext` to `accountGate` in about 300 ms. |
| B | Session restoration reaches authenticated state but lifecycle never reaches `ready`. | Medium | Low | Rejected: captured login entries were unauthenticated `onboarding` with `dataReady=true` and crossed the precondition. |
| C | Browser renderer or WebDriver exits before the precondition resolves. | Medium | Low | Confirmed at the client-session layer: WebDriver became invalid while the browser process, Chrome handle, gateway, renderer, and WebDriver port remained live. |
| D | Station selection completes but the next boot cycle does not consume the updated launch context. | Medium | Medium | Rejected: boot requests either started from `accountGate` or converged from `checkingLaunchContext` to `accountGate`. |
| E | Persisted Browser identity races with clean-fixture login and leaves a non-login phase. | Low | Medium | Rejected: login entries had the expected clean-fixture state and no authenticated session. |

## Log Evidence
- Exact-source run `20260904T110406527755Z-0a3cb161b052d5ff5c86e5176456b73c` timed out at `identity login precondition`.
- Exact-source run `20260904T121940506424Z-c261df4ab00dd6c343d3c4aa46b3094d` reproduced the same timeout.
- Exact-source run `20260904T110841855632Z-6c1f0ef3e8965a00be0c381eeb3f9754` crossed login, so the failure is intermittent.
- Instrumented run `20260904T123215171497Z-b8addb2df843c33665e38845564ffa82` crossed login on both clients. Log lines 1-6 show the expected initialized account gate; line 7 proves the later AS-F07 failure occurred while every Browser process/port signal remained live.
- Post-fix run `20260904T132921920791Z-e034142a8f918dd5382a33d276e192e9` failed during Browser setup with an invalid WebDriver session. Post-fix log lines 4-8 show three failed health probes followed by `configureStation` on the same dead session while process and ports remained live. Lines 9-12 show a cleanup restart immediately restoring the normal identity transition.

## Instrumentation
- `A`: identity phase and lifecycle transitions during the login precondition.
- `B`: final identity phase and lifecycle state when the precondition times out.
- `C`: Browser process, driver, and port liveness when a Harness call fails.
- `D`: identity state immediately after the Harness requests boot.
- `E`: persisted authentication and identity state at login entry.

## Verification Conclusion
Identity state is not the cause. The runtime client warm-up swallowed a dead
WebDriver session and allowed setup to continue through that invalid handle.
The owning correction is a bounded client restart before login when all warm-up
health probes fail.
