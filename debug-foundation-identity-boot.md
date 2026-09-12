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
| A | The `applets_product_window_launch_context` invocation remains pending past the identity precondition, so session restoration never starts. | High | Low | Confirmed: Browser request started, remained pending through the 30-second login bound, and settled only after 54.7 seconds. |
| B | Session restoration starts but `auth_restore_session` hangs or rejects. | Low | Low | Rejected for the latest failure: identity never advanced to `resolvingSession`. |
| C | Browser renderer or WebDriver is dead while recovery polling continues. | Low | Low | Rejected for the latest failure: all 119 Harness snapshots succeeded and no command exception was retained. |
| D | Concurrent startup commands queue behind a Browser gateway worker/lock convoy before launch-context dispatch. | High | Medium | Supported: a live process sample found seven gateway workers waiting on mutexes while one sampled `context_action_dispatch`; exact per-command queue/dispatch timing is pending. |
| E | Browser command parity is incomplete, so the eventual launch-context response is a typed command rejection rather than `{ enabled: false }`. | High | Low | Confirmed in source: the Tauri command exists but the HTTP gateway dispatch has no matching command; runtime recorded `RustCommandException` after HTTP 200. |
| F | Native provider-list loading never settles during `ensureProvider`. | Medium | Low | Not reproduced in either initial setup sequence on `2f42b6eee`; intermittent cause remains inconclusive. |
| G | Native provider detail lookup or provider persistence never settles. | Medium | Low | Both sequences reached provider persistence; intermittent cause remains inconclusive. |
| H | Native available-model lookup never settles. | Medium | Low | Both sequences found the requested model; intermittent cause remains inconclusive. |
| I | Native Agent load/profile update/readiness lookup never settles. | Medium | Low | Both sequences reached matching readiness snapshots; intermittent cause remains inconclusive. |
| J | devctl overwrites the Foundation client profile and storage root with shared development defaults, splitting local device identity from the Station capability session. | High | Low | Confirmed: the runtime manifest assigns `agent-v2-foundation-native` and `/tmp/pt-agent-v2-*/native/storage`, while `desktop.mjs` replaced them with its `chat-native-disposable-app` and `.local/dev/data/.../desktop-app` defaults; the failed snapshot had zero local sessions and one Station session. |
| K | The Station failed to persist the capability session. | Low | Low | Rejected for the latest failure: Station readback contained one current Desktop capability session while the local snapshot was empty. |
| L | A leaked Foundation process or occupied client port caused the local snapshot failure. | Low | Low | Rejected for both latest preflight failures: runtime and Provisioner cleanup completed and all allocated client ports were released. |

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
- Exact-source diagnostic run
  `20260905T031223447524Z-7d464e53985440f393f32f49aec49e59`
  reproduced the same boundary during initial Browser login. Identity and
  gateway both recorded launch-context request start. The 30-second login
  precondition expired while the request was still pending; the HTTP 200 and
  JSON body arrived only after 54.7 seconds, then the shared Desktop adapter
  raised `RustCommandException`. Native launch context resolved in 29
  milliseconds. Cleanup completed `DONE / PROVEN / passed`.
- A live sample of the affected Browser Rust process showed the eight-worker
  HTTP gateway with seven worker threads waiting on mutexes and one sampled
  inside `context_action_dispatch` / global-context persistence. This supports
  a startup command convoy, but does not yet identify the exact command order
  or lock owner.
- Exact-source diagnostic run
  `20260908T124702409374Z-e93f2a523848b18a09aa1e90197bf01a`
  on `66e2f48aa7e3603da786c7cfdef6083b3c438c0e` failed while the
  Native client executed `ensureProvider`. The WebDriver call timed out after
  60 seconds while the Native process, Driver, Gateway, renderer, and
  WebDriver port all remained live. Cleanup then timed out on
  `restoreFoundationCapabilityIsolation` through the same Native harness
  channel. Outer Provisioner cleanup passed and all client ports were
  released. This rejects process death and local port loss, but does not yet
  identify which awaited provider-setup stage stopped settling.
- On checkpoint `2f42b6eeea8e339b607c23e38b738caa8c91e368`,
  Gate `20260908T135908515691Z-03999d7db95ed840bdf6a9ece5883400`
  produced two complete initial `ensureProvider` stage sequences in the
  retained identity log. Start/end timestamps are
  `1788876169463/1788876172252` and `1788876187248/1788876189485`:
  2.789 seconds and 2.237 seconds, not under two seconds. Both end in
  `readiness-loaded` with all three snapshot checks true.
- The same interrupted run later failed at Browser AS-F06 capability-session
  establishment. At `1788876673451` the retained harness failure event reports
  `processState=exited`, with Gateway, renderer, and WebDriver ports closed.
  This later failure cannot prove a new product defect or a provider-stage
  regression. The run's child cleanup result and outer Provisioner cleanup
  passed, but the Foundation product proof remains unproven.
- Checkpoint `0a8c04977ad1d951d1970d550df74df9f5ee49a5` passed C08 run
  `20260912T102443766254Z-b54c0863776672d25291bfe12d204847`.
  Foundation runs
  `20260912T101751744551Z-8c254412faed073c37cfce05934b7b99`
  and
  `20260912T102603877808Z-15c8bb3648cb9ef33b1526c79f66fa78`
  then failed before any product tuple. The latter retained
  `local.active_session_count=0` while Station readback contained one Desktop
  capability session. Its runtime manifest assigned
  `agent-v2-foundation-native` and a run-scoped
  `/tmp/pt-agent-v2-*/native/storage`, but the devctl child was launched with
  its shared development runtime identity.
- The minimal devctl fix preserves explicit `PT_PROFILE` and
  `PEERS_STORAGE_ROOT` values while retaining profile-scoped defaults for
  ordinary development. Local post-fix checks pass: devctl `24/24`,
  Foundation runtime client `20/20`, Desktop strict check, and diff hygiene.
  Exact-source runtime comparison remains pending.

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
  - The next checkpoint adds gateway enqueue, worker-start, dispatch-complete,
    and safe result-code timing for each startup command.
- The Native `ensureProvider` probe now records completion boundaries for
  provider list, provider detail, provider persistence, model list, Agent
  load/profile update, and capability readiness. It records only counts,
  booleans, stage names, and error types; credentials and endpoint values are
  excluded.

## Verification Conclusion
The earlier dead-WebDriver defect was fixed and is not the latest failure.
Hypothesis A is confirmed: Browser identity waits on launch-context longer than
the login and recovery bounds, so session restoration does not start in time.
Hypothesis E is also confirmed as a separate Browser parity defect. The
remaining root-cause question is D: which startup command owns the gateway
worker/lock convoy. No behavior fix is authorized until per-command gateway
timing identifies that owner.

Resume correction: the preceding A/E/D conclusion describes the historical
Browser investigation, not the latest Native provider-stage observation.
The Native timeout did not reproduce in the two retained setup sequences;
F-I remain inconclusive for the intermittent incident. Do not turn those
successes, or the interrupted Browser failure, into a product-fix claim.

The latest Foundation preflight failure is a separate confirmed J boundary:
devctl replaced the Provisioner-assigned client runtime identity after profile
resolution. K and L are rejected by Station readback and cleanup evidence.
The devctl fix is implemented with instrumentation retained; the session stays
`[OPEN]` until an exact-source post-fix Foundation run proves capability-session
reconciliation and reaches the next product tuple.
