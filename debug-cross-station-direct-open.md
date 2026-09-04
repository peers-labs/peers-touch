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
| C | `messaging_create_direct` starts but fails before returning a projected conversation. | High | Low | Confirmed and fixed: the intermediate run returned Station 404; exact-source run `20260904T074120233666Z-fdb77bd29b2e510be6a9964332a9e4d5` emitted `create-direct-success` and reopened the same conversation ID. |
| D | A duplicate login transition revokes the token used by the messaging engine. | High | Low | Confirmed and fixed: the pre-fix run contains `auth_login -> refresh-current-session -> auth_restore_session` and `session_revoked:kicked`; the post-fix run validates the bound token and contains no session revocation. |
| E | The conversation is created but store selection/projection never becomes visible. | Medium | Low | Rejected for the current runs: the native command returned a Station 404 before conversation creation. |
| F | Direct creation resolves the remote endpoint manifest but then discards it and requires the remote endpoint to exist in the authority Station's local `actor_devices` table. | High | Low | Confirmed: station-five returned the Bob endpoint manifest with HTTP 200; station-four persisted it, but had only Alice in `actor_devices`. `ConversationService.CreateDirect` ignored the resolved manifests and returned 500 after `ListActiveEndpoints` found no local Bob row. |
| G | Contacts `Message` changes only the Chat subpage before `createDirect`; on failure it has no peer-bound conversation state to render. | High | Low | Confirmed by the user screenshot and source: `onMessage()` switched `subPage`, while `activeSessionUlid` remained empty until RPC success, so the generic empty Chat pane and global toast appeared. |
| H | The resilience Gate can pass the blank-pane regression. | High | Low | Confirmed: the latest Linux Gate accepted `_chats_subpage_active() OR _chat_area_visible()`, and therefore proved a 333 ms tab switch plus toast rather than a peer-bound pane. No Windows pointer/evidence existed for this Gate. |
| I | The one-client resilience Gate cannot provision Bob on station-five because fixture actor binding is derived only from launched runtime clients. | High | Low | Confirmed by Windows run `20260904T113004716796Z-40317bad53a2b6608f02e4df47fa57f9`: source and both Station attestations passed, then provisioning blocked on `fixture-binding:bob`. The declared environment already maps Bob to station-five, but Bob is intentionally not launched by this Gate. |

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
first-party federation control requests.

Exact-source Windows run
`20260904T074120233666Z-fdb77bd29b2e510be6a9964332a9e4d5`
at commit `6517324cdb5aa46cf6fcca8eac2e6ed1858c6721` and binary
SHA-256
`c0d00168bbbb7161789cd8ac8810dbea9447b73f8abc6a0240bac27beef8c17e`
confirmed the fix:

- the first exact Bob click emitted `create-direct-success` for
  `d-f4d4aaa25c831bb05fdd53cd1cdd6120`;
- the conversation pane became visible and search cleared;
- the second exact Bob search selected the same existing conversation;
- no `create-direct-failure` or session revocation occurred.

The product-closure Gate continued past this checkpoint and later failed in
`transcript.thread.ui` because the accepted pane-owned message action overlay
had been removed by a later semantic merge. Resource cleanup passed, while
runtime-log cleanliness failed on independent legacy conversation membership
403s. Those failures do not invalidate the Direct-open proof. Instrumentation
and the Debug Server remain active until user confirmation.

Two exact-source runs at
`4a13e269aca19a2eaefd4fdb20af7e53bf8ae973` then exposed hypothesis F:

- run `20260904T092247675913Z-f95b1761b3142fd0081bd5e071185a77`
  proved source, Windows runtime, service binding, and cleanup, but failed
  Direct open after the Station deployment had replaced the dedicated DHT and
  Relay environment;
- after restoring one DHT seed and the Relay client on both Stations, run
  `20260904T095919484188Z-5258359310246689b3288cd4289543c4` still returned
  Station 500 for Direct creation;
- station-five returned
  `/messaging/federation/endpoint-manifest` with HTTP 200 and station-four
  persisted Bob's verified manifest;
- station-four had no Bob row in local `actor_devices`;
- `ConversationService.CreateDirect` calls `resolveEndpointManifests` but
  discards the returned snapshots, then rebuilds the endpoint set exclusively
  through `DeviceDirectory.ListActiveEndpoints`.

The required fix is to derive the Direct participant endpoint set from the
already-verified manifest snapshots, while retaining the creator's local
active-device authorization check. This is an implementation correction under
the accepted endpoint-manifest architecture; it does not change MP-D29.

The client and Acceptance correction now also addresses hypotheses G and H:

- `SocialChatPage` owns one request-generation-fenced Direct-open intent;
- Contacts and search results share that interaction path;
- the Chat pane renders the selected peer identity immediately without
  fabricating an authoritative conversation ID;
- create failure remains inline and retryable in the peer-bound pane;
- create success replaces the intent with the Station-authored conversation;
- the resilience Gate no longer accepts a Chat-tab switch or generic empty
  view and requires the peer-bound intent, inline error, retry action, and
  Windows source-bound evidence.

Local pre-runtime verification passes: Desktop check, 540 Desktop tests,
Desktop production build, 169 Chat static tests, and all Station Messaging
package tests. Exact-source Windows post-fix evidence remains pending.

The first Windows resilience attempt at commit `61f1cb759687899735a2a6069913c4a95f7ecf8c`
was correctly classified `BLOCKED/UNPROVEN` before client launch because the
Chat provisioner derived fixture bindings only from the launched-client subset.
The correction now resolves every fixture actor from the full declared
environment client bindings while still launching only the Gate-specific
runtime clients. A focused provisioner regression test proves Alice resolves
to station-four and non-launched Bob resolves to station-five.
