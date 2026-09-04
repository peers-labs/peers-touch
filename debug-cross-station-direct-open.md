# Debug Session: cross-station-direct-open
- **Status**: [OPEN]
- **Issue**: The Windows native Chat Gate selects the exact station-five Bob search result, but Alice's direct conversation does not open.
- **Debug Server**: `http://100.86.255.160:7777/event`
- **Log File**: `.dbg/trae-debug-log-cross-station-direct-open.ndjson`

## Reproduction Steps
1. Deploy the exact source commit to station-four and station-five.
2. Ensure both disposable Stations use the shared DHT and Relay topology.
3. Run `chat-native-product-closure-e2e` through `desktop-windows-native`.
4. Log Alice and Bob into their separately bound native clients.
5. Search for Bob from Alice and click the exact PTID result.
6. Observe that no direct conversation pane opens within 120 seconds.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Native click reaches the DOM but the React selection handler does not run. | Medium | Low | Rejected: post-fix debug line 2 contains `handler-entry` for the exact Bob PTID. |
| B | The selection handler enters the existing-conversation branch with an invalid projection ID. | Low | Low | Rejected: post-fix debug line 2 records `branch-resolved` with an empty `existingConversationId`, followed by `create-direct-start`. |
| C | `messaging_create_direct` starts but fails before returning a projected conversation. | High | Low | Confirmed: post-fix debug lines 2-3 record `create-direct-failure` with `station returned 404`. |
| D | A duplicate login transition revokes the token used by the messaging engine. | High | Low | Confirmed and fixed: the pre-fix run contains `auth_login -> refresh-current-session -> auth_restore_session` and `session_revoked:kicked`; the post-fix run validates the bound token and contains no session revocation. |
| E | The conversation is created but store selection/projection never becomes visible. | Medium | Low | Rejected for the current runs: the native command returned a Station 404 before conversation creation. |

## Log Evidence
- Pre-debug Gate `20260904T045902948981Z-417027f393536e2374d0c23805f7e141`:
  exact source and client bindings passed; product failed waiting for Alice's
  first direct conversation; cleanup passed.
- Both client logs contain early `session_revoked: kicked` failures in the
  messaging lifecycle.
- Pre-fix run
  `20260904T053556542665Z-6aa174fec173c38d9b9c98594ba9e011`
  used exact source `63e830f6b50dafa02ad8c0a2b5f66491cf100059`,
  distinct station-four/station-five bindings, Windows WebView2, Win32
  `SendInput`, and a 1920x1080 GUI session. Product result was
  `PARTIAL/UNPROVEN`; cleanup was `DONE/PROVEN`.
- Debug log line 1 proves the exact station-five Bob result was ready.
- Debug log line 2 proves the native click reached that exact result; no
  create-direct event or pane was visible immediately afterward.
- Debug log line 3 proves the state remained unchanged for 120 seconds:
  search value `bob`, zero session rows, zero panes, and no visible feedback.
- Alice app log lines 96-115 prove `auth_login` succeeded, then
  `auth_restore_session` ran inside `refresh-current-session`; the original
  token was rejected as `kicked` before restore returned a replacement token.
  Bob app log lines 88-105 show the same sequence.
- Post-fix Gate
  `20260904T061940213867Z-e8f335fd65350800b1b198472c68e6f6`
  used exact source `1ee7da584aaae737fa0c4270eb35cb2152c37203`
  and binary SHA-256
  `2fbb00352224de469e6a1b2e00d169db5206bd919c84ef382a93ed1e0c88afc2`.
  It retained Windows WebView2, Win32 `SendInput`, 1920x1080 GUI, distinct
  station-four/station-five bindings, and `DONE/PROVEN` cleanup.
- Post-fix debug line 2 proves the exact native click entered
  `ChatSessionList.handleSearchSelect`, rejected the existing-conversation
  branch, and started `messaging_create_direct`.
- Post-fix debug lines 2-3 record `create-direct-failure` with
  `station returned 404 :`; Station logs show authenticated
  `POST /messaging/conversation/direct` returning application-level 404.
- Database evidence shows the remote actor and its Home Station in
  `touch_actor`, but no remote `actor_devices`, `auth_peer_keys`, or
  `federation_station_membership` rows. `ActorHomeStationID` queried only
  `actor_devices`, so manifest resolution stopped before any remote fetch.

## Verification Conclusion
The duplicate Station session issuance was fixed at the Desktop identity
reconciliation boundary and the post-fix run rejects hypotheses A, B, and E.
The remaining failure is Station-owned federation bootstrap:

1. actor Home Station routing incorrectly depends on an already-cached remote
   device;
2. Messaging production wiring captures no Relay access even though
   relay-client registers after Subserver initialization;
3. endpoint-manifest verification requires the remote Station TOFU key, while
   the signed locator/profile resolver did not persist that verified key.

The implementation now reads actor ownership from `touch_actor`, establishes
the missing TOFU binding through a fresh signed locator/profile resolution,
reads the live Relay handle per request, and uses protobuf for the affected
first-party federation control requests. Local focused tests pass; exact-source
deployment and post-fix Windows comparison remain pending. Instrumentation and
the Debug Server remain active until runtime proof and user confirmation.
