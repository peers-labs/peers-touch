# Debug Session: foundation-identity-boot
- **Status**: [OPEN]
- **Issue**: Browser Foundation identity boot intermittently stalls during initial login or post-AS-F06 process restart.
- **Debug Server**: `http://127.0.0.1:7778/event`
- **Log File**: `.dbg/trae-debug-log-foundation-identity-boot.ndjson`

## Reproduction Steps
1. Activate the `chat-native-disposable` profile.
2. Verify the Station is remote, healthy, and source-matched.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable restart envelope.
4. Observe whether initial login reaches `accountGate` and whether the AS-F06
   Browser process restart restores the existing session.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The post-restart `applets_product_window_launch_context` invocation remains pending, so session restoration never starts. | High | Low | Supported: 119 successful snapshots remained at `checkingLaunchContext / cold_launch`; direct invocation start/settlement evidence is pending. |
| B | Session restoration starts but `auth_restore_session` hangs or rejects. | Low | Low | Rejected for the latest failure: identity never advanced to `resolvingSession`. |
| C | Browser renderer or WebDriver is dead while recovery polling continues. | Low | Low | Rejected for the latest failure: all 119 Harness snapshots succeeded and no command exception was retained. |
| D | The Browser gateway receives the launch-context request, but its Rust handler never settles. | Medium | Medium | Inconclusive until gateway request/response checkpoints are captured. |
| E | Identity restores, but the critical `agent-chat` runtime bootstrap or persisted recovery merge stalls. | Low | Medium | Rejected for the latest failure: identity never reached authenticated state or runtime bootstrap. |

## Log Evidence
- Exact-source run `20260904T110406527755Z-0a3cb161b052d5ff5c86e5176456b73c` timed out at `identity login precondition`.
- Exact-source run `20260904T121940506424Z-c261df4ab00dd6c343d3c4aa46b3094d` reproduced the same timeout.
- Exact-source run `20260904T110841855632Z-6c1f0ef3e8965a00be0c381eeb3f9754` crossed login, so the failure is intermittent.
- Instrumented run `20260904T123215171497Z-b8addb2df843c33665e38845564ffa82` crossed login on both clients. Log lines 1-6 show the expected initialized account gate; line 7 proves the later AS-F07 failure occurred while every Browser process/port signal remained live.
- Post-fix run `20260904T132921920791Z-e034142a8f918dd5382a33d276e192e9` failed during Browser setup with an invalid WebDriver session. Post-fix log lines 4-8 show three failed health probes followed by `configureStation` on the same dead session while process and ports remained live. Lines 9-12 show a cleanup restart immediately restoring the normal identity transition.
- Exact-source run
  `20260905T012513208020Z-8351ecd1d15a713fe97287e9c7e6ebb6` on
  `82073af5dc367ed1fb5184d40c29e50cdd5c4956` passed initial Browser login
  and advanced through AS-F01-AS-F05 into AS-F06. After the explicit Browser
  process restart, 119 successful runtime snapshots remained
  `authenticated=false`, `actorPresent=false`,
  `identityPhase=checkingLaunchContext`, `identityReason=cold_launch`, and
  `identityState=onboarding`. The run failed after 982.315 seconds; cleanup
  completed `DONE / PROVEN / passed`.
- The retained NDJSON contains multiple historical runs. Lines 364-369 belong
  to this run's initial login and show both clients entering the expected
  `accountGate / session_missing` state. The final AS-F06 polling snapshots
  were not individually reported, so the next run must collect a clean
  session-specific window.

## Instrumentation
- `A`: identity phase and lifecycle transitions during the login precondition.
- `B`: final identity phase and lifecycle state when the precondition times out.
- `C`: Browser process, driver, and port liveness when a Harness call fails.
- `D`: identity state immediately after the Harness requests boot.
- `E`: persisted authentication and identity state at login entry.
- The next pre-fix run additionally records:
  - launch-context command start, Browser gateway response, JSON completion,
    and rejection;
  - identity-side launch-context start, resolution, and rejection;
  - Browser runtime restart generation plus storage/profile preservation.

## Verification Conclusion
The earlier dead-WebDriver defect was fixed and is not the latest failure.
Current evidence places the new boundary before session restoration:
`checkingLaunchContext` normally advances to `resolvingSession` in about
300 milliseconds, but the latest AS-F06 Browser restart remained there for the
entire 120-second recovery window. No behavior fix is authorized until the
launch-context and gateway settlement checkpoints classify hypothesis A or D.
