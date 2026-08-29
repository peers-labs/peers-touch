# Debug Session: interaction-projection-loss
- **Status**: [OPEN]
- **Issue**: During the Native interaction retry Gate, the Engine retains the committed message projection while the frontend Acceptance projection reports the message as missing for the full bounded wait.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-interaction-projection-loss.ndjson

## Reproduction Steps
1. Run `chat-native-interactions-e2e` on `desktop-linux-native` against the disposable Station.
2. Create a Direct message and verify it on Alice and Bob.
3. Route Alice through the submit fault proxy and arm one connection loss.
4. Submit an edit and wait for the Engine intent and outbox to reach `retry_wait`.
5. Observe whether the original message remains in the Rust projection, frontend store projection, and visible DOM.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | A concurrent `loadMessages` request overwrites the conversation store with an empty result after the Station endpoint switch. | High | Medium | Inconclusive: the frontend store remained empty for 200 samples. |
| B | The Harness and Engine snapshot read different active profile or Engine instances during endpoint switching. | High | Medium | Confirmed: the same process resolves `station_url_*` through the Gateway and `station_peer_*` through the Tauri window. |
| C | Preparing the retrying edit temporarily removes the committed message row from the conversation projection query. | Medium | Medium | Rejected: Engine projection and Rust list retained the target throughout the failure. |
| D | The Rust projection remains present but TypeScript projection mapping or filtering drops the message. | Medium | Low | Rejected: both raw and mapped frontend store arrays were empty. |
| E | The authenticated actor guard becomes false, so `loadMessages` returns before reading and storing Rust projections. | High | Low | Rejected: Group samples retain actor `352266494551261187` with `authenticated=true`. |
| F | The WebView API wrapper and the HTTP Gateway resolve different active runtime contexts. | Medium | Low | Confirmed: the paths can resolve different account IDs, Engine profiles, and endpoint devices inside one process. |
| G | Station restart causes Bob's Gateway and Tauri window to resolve different account or Engine identities again. | Medium | Low | Pending restart-convergence instrumentation. |
| H | Bob's Engine consumer does not resume after Station restart, leaving the local terminal projection stale or absent. | High | Low | Pending Engine and consumption-count comparison. |
| I | Station restart loses or fails to replay the authoritative terminal interaction state. | Medium | Low | Pending Station readback comparison. |
| J | Bob's page reload restores the wrong conversation selection, so the Engine is correct while the queried store or DOM points elsewhere. | Medium | Low | Pending Harness active-tab/conversation comparison. |
| K | Bob's authentication/session becomes invalid after Station restart, preventing projection refresh. | Medium | Low | Pending authenticated actor and sync-error comparison. |

## Log Evidence
- Pre-fix Gate run `20260829T023644548452Z-8983d0bd277b21b69d93e766da7eaa4e` failed after 120 seconds.
- The last Harness state was `present=False, contentState=missing, edited=None`.
- The Gate had already observed the Engine intent and outbox in `retry_wait`.
- Runtime-cell and provisioner cleanup both passed.
- Instrumented pre-fix run `20260829T030310332405Z-637fddb6533f13fcb8c261e02d5530c1` reproduced the failure in the Group path.
- Debug samples 4-14 show the target in Rust `messaging_list_messages` and Engine projection while frontend raw/mapped arrays and DOM remain empty.
- Instrumented context run `20260829T031740788716Z-fbc882b2c02801a85192f0b3218f2df5` reproduced the same Group failure and preserved complete runtime-cell and Provisioner cleanup.
- Debug line 2 proves the Direct path is coherent: authenticated actor present, WebView API 7 messages, HTTP Gateway 7 messages, frontend raw/mapped store 7 messages, and target DOM present.
- Debug lines 4-14 prove the Group split for 200 bounded samples: authenticated actor present, WebView API 0 messages, HTTP Gateway 7 messages including the target, frontend raw/mapped store 0 messages, and target DOM absent.
- Static source inspection shows the Tauri command resolves its Engine through `WindowSessionRegistry`, while the HTTP Gateway resolves its Engine through the legacy process-global `AppState.session`.
- Context run `20260829T033633047893Z-5c11bc21a447f7c2015be934dc5b5962` passed the complete unchanged Gate. Its Direct and Group samples had identical Tauri/Gateway account and Engine profile IDs with seven messages on both surfaces. This is a non-reproduction, not post-fix proof.
- Process-identity run `20260829T035438061971Z-b7aa79bb190088cc4d7f9e47563132c2` also passed the unchanged Gate, but its Group sample exposed the race deterministically. Both paths used PID `1509` and the same actor. The Gateway retained `station_url_098c...` with endpoint `01M15TPT...`, while the Tauri window used `station_peer_12D3...` with endpoint `01M15TR0...`.
- `auth_service::auth_login` writes the authoritative account ID into `AppState.session`. `bind_window_session` then incorrectly recomputes the account ID through `find_account_id_by_actor_id`, whose preferred password account depends on the mutable active Station scope. If Station peer identity becomes available between those operations, one login creates two Engine identities for the same actor.
- Post-fix focused run `20260829T041156615501Z-730ab7125afcbd52dd6f59701d520db1` used source, Station, runtime cell, and binary commit `1d29a8a548aee70b45cb3e3109f3c00a07b422e1`.
- Post-fix debug lines 1-4 prove both Direct and Group retry-wait samples now keep identical Gateway/Tauri `account_id`, `engine_profile_id`, `endpoint_device_id`, and `process_id`. Both paths returned seven messages, populated raw/mapped frontend stores, and retained the original visible DOM message.
- The unchanged `pending_interaction_timeout_retry` assertion passed, so the original projection-loss boundary did not reproduce.
- The same Gate later failed at a distinct boundary: `timed out waiting for bob direct terminal state after Station restart`. All assertions through Group retry/offline recovery passed, runtime cleanup passed, and Provisioner/runtime-cell cleanup reached `CLEANED`. The run remains `PARTIAL / UNPROVEN`.

## Instrumentation
- `apps/desktop/src/acceptance/chat/harness.ts`: expose raw and mapped store state before and after the existing conversation refresh.
- `tooling/acceptance/gates/chat/native_interactions_runner.py`: report retry-wait Engine state, Rust list output, Harness state, and DOM state to the Debug Server.
- Instrumentation is read-only and does not change Gate assertions, retry timing, product state, or cleanup behavior.

## Verification Conclusion
The failure is below the frontend store and above the persisted Engine
projection. Authentication loss, Rust projection deletion, TypeScript mapping,
and cross-process tunnel routing are rejected. The root cause is a time-of-check
identity split in `bind_window_session`: it recomputes a station-scoped account
instead of inheriting the account ID committed by the authentication
transaction.

The post-fix evidence confirms that the account-inheritance fix closes the
original retry-wait projection split. Cleanup is still blocked because the
focused Gate exposed a later Station-restart convergence failure. That boundary
must be diagnosed independently before the debugging session can be confirmed
fixed.
