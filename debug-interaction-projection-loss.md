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
| J | Page reload preserves the `#/chat` URL before the Chat surface is mounted, so the navigation helper returns without restoring the visible page. | Medium | Low | Confirmed: active store selection is correct while the entire Chat DOM surface is absent. |
| K | Bob's authentication/session becomes invalid after Station restart, preventing projection refresh. | Medium | Low | Pending authenticated actor and sync-error comparison. |
| L | The post-reload virtual timeline mounts only the viewport tail, leaving the terminal base message off-DOM even though it remains in the active conversation store. | High | Low | Rejected: the scroll container and every message row are absent, not merely the target row. |
| M | The refreshed client is left on an unauthenticated or boot surface, so neither primary navigation nor the Chat page can mount. | High | Low | Pending post-refresh shell-state evidence. |
| N | The authenticated shell mounts, but route restoration fails to expose the Chat navigation target or page host. | Medium | Low | Pending route/navigation/page-host evidence. |
| O | WebKitGTK returns from `refresh()` before replacing the old document, so Harness readiness accepts the stale pre-refresh Harness and the real reload unmounts the shell afterward. | High | Low | Rejected: `timeOrigin` changed before `refresh()` returned and the new document installed a new Harness. |
| P | The new renderer remains in `resolvingSession` because session restoration does not settle after the Station restart. | High | Low | Rejected: Identity completed boot and entered `accountGate`. |
| Q | Session restoration fails and moves the new renderer to the account gate after the Station restart. | Medium | Low | Confirmed in part: Identity enters `accountGate(reason=revoked)` while the session store remains authenticated. Revocation source is pending. |
| R | Identity reaches authenticated `ready`, but the ReadyView or critical runtime/page host fails to mount. | Medium | Low | Rejected: Identity lifecycle is explicitly `onboarding`, not `ready`. |
| S | A cross-window identity-change event classifies the renderer's own actor as a same-actor takeover during reload. | Medium | Low | Pending ordered Identity event-buffer evidence. |
| T | The Rust event-stream reconnect reports a stale token as session-revoked after Station restart and kicks the current renderer. | High | Low | Pending revocation reason/raw and realtime connection-state evidence. |
| U | A normal frontend API request maps an `UNAUTHORIZED` response to session-revoked during boot reconciliation. | Medium | Low | Pending revocation payload raw marker and event ordering. |

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
- Restart-instrumented run `20260829T043303965616Z-093fbc4a15f98cf7de3df4917651e02b` reproduced the later boundary as `timed out waiting for alice direct terminal state after Station restart`.
- Debug lines 5-12 show 140 bounded Alice samples with no sync error. Station retained the terminal event; Engine consumption count remained 32; Gateway and Tauri returned eight messages through the same account/profile/device/PID; raw and mapped stores contained the target with `retracted=true`; active tab and conversation were correct. Only `data-message-ulid=<target>` was absent from DOM.
- This rejects G, H, I, J, and K for the observed Alice failure. The remaining distinction is whether the virtualized timeline mounted other viewport rows while the target was offscreen, or whether the complete timeline surface failed to render.
- Geometry run `20260829T045247379819Z-b039f224ef7d7eb14d20be531f7a3e00` reproduced the same Alice timeout. Debug lines 5-12 show `domSurface.messageIds=[]` and `domSurface.scroll=null` for the full bounded window, proving the complete Chat surface was absent rather than the target being virtualized offscreen.
- `enter_chat_page` currently returns solely when `current_url` ends in `#/chat`. After a WebView refresh, the URL can already match while the authenticated application has not mounted the Chat page, so the helper skips the navigation action and surface-ready wait.
- The surface-ready fix changed that silent false-ready state into an explicit `clients.reload_after_station_restart` `TimeoutException` in run `20260829T050944875971Z-69a277b3783d4cfc0e2620035391d1c5`. This proves the helper no longer advances without a mounted Chat surface, but the shell state that prevents navigation still requires runtime evidence.
- Exact-source run `20260829T052733208520Z-c8bab1c493295aa587229ac263d67a8a` on commit `7f0c26a0f563a74e0a29de7b93069727d213bd8b` passed all Direct and Group assertions through retry, offline recovery, duplicate replay, and Station restart, then failed at `clients.reload_after_station_restart`.
- Debug line 5 observed Bob immediately after `refresh()` and Harness readiness with the authenticated Chat shell still mounted: `chatLayoutCount=1`, `chatNavCount=1`, `primaryNavCount=11`, `loginSurfaceCount=0`.
- Debug line 6 observed the same `tauri://localhost#/chat` URL 20 seconds later with `chatLayoutCount=0`, `chatNavCount=0`, `primaryNavCount=0`, and `loginSurfaceCount=0`. This rejects a stable unauthenticated surface (M) and a stable authenticated-shell route failure (N); the shell transitioned after it had already been accepted as ready.
- The run preserved source/Station/runtime-cell/binary identity and completed both Gate cleanup and outer Provisioner cleanup. It remains `PARTIAL / UNPROVEN`.
- Document-generation run `20260829T054430720564Z-10477eb87619b1b4cf39db4b225385e8` on commit `bab2f3ef3f20c16986dd0e611caf4a874c981555` reproduced the same reload timeout.
- Debug lines 5-9 show Alice's `performance.timeOrigin` changed from `1787982484902` before refresh to `1787982965530` when `refresh()` returned. The new document reported navigation type `reload`, installed a new Acceptance Harness, and remained without primary navigation or Chat layout. This rejects hypothesis O.
- The next observation must read the canonical Identity lifecycle and session projections from the Acceptance-only Harness to distinguish a stuck session restore (P), an auth-gate transition (Q), and an authenticated shell-mount failure (R).
- Identity-phase run `20260829T055940751863Z-0e0fb6a7d487253013b1665e89e57b49` on commit `0397280c26289c64fa3eff1858f6314504c70185` reproduced the same timeout after all prior Direct and Group assertions passed.
- Debug line 5 shows Bob was `authenticated/ready` before refresh with a complete Boot trace. Lines 7-9 show the new renderer completed shell, Identity, first-paint, and critical-runtime phases but settled in `accountGate(reason=revoked)`, while `sessionAuthenticated=true`, `sessionRestoring=false`, and the actor ID remained populated.
- This rejects P and R and confirms the Q transition. The contradictory Identity/session projections prove that page navigation is downstream of a revocation event, not the owner of the failure. The next observation must identify whether the revocation came from cross-window identity handling (S), Rust stream reconnect (T), or an ordinary API response (U).

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
fixed. The document-generation evidence proves WebKitGTK completed document
replacement before returning from `refresh()`, so stale Harness readiness is
not the cause. The Identity evidence proves the new renderer receives a
session-revoked transition after restoring the same still-authenticated actor.
The next instrumentation reads the existing event debug buffer to identify the
revocation publisher without changing lifecycle behavior.
