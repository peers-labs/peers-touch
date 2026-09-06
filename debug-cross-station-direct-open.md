# Debug Session: cross-station-direct-open
- **Status**: [OPEN]
- **Issue**: The Windows native Chat Gate selects the exact station-five Bob search result, but Alice's direct conversation does not open.
- **Debug Server**: `http://10.4.43.34:7779/event`
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
| J | The Windows focus-ordering correction still loses WebView focus before transcript input. | Medium | Low | Rejected by run `20260904T190332370979Z-f9793309fcd5ad79ac955d4bad864acd`: the Gate crossed both former focus timeouts, submitted Alice's group message, and observed it in Bob's DOM. |
| K | Authority-to-follower federation delivery or Bob's local decrypt path drops Alice's group message. | Medium | Low | Rejected: station-four delivered authority sequence 3, station-five received its frame, Bob ACKed the queue item, and the Gate observed Alice's root message in Bob's transcript. |
| L | station-five lacks the authority-signed follower membership required to authorize Bob's outbound group message. | High | Low | Confirmed: station-five has zero authority events and zero membership rows for the group, Bob projects `group:0`, and `sendGroupMessage` returns `messaging_send_outcome:not_queued:draft`. |
| M | Bob's message exists in client state but the Gate's visible-DOM selector misses it. | Low | Low | Rejected: Bob's send failed before queueing, so no Bob-authored message existed for the selector to observe. |
| N | The latest Direct-open regression is caused by Station deployment losing the dedicated Relay/DHT environment, not by MP-W14 product code. | High | Low | Confirmed for run `20260905T105928664207Z-cf73c7b7f1b9d3e05a34ce9b305e248c`: both containers had Relay disabled and no bootstrap seed after deployment through the shared `station.env`. |
| O | Fresh Relay invites plus the dedicated topology restore cross-Station Direct creation at unchanged source. | High | Low | Confirmed by run `20260905T114725741869Z-8894cc822a6bd05b8f187403b0c557e3`: Direct create and repeat reopen used `d-f4d4aaa25c831bb05fdd53cd1cdd6120`. |
| P | MP-W14 fails because station-five did not apply the authority-signed follower projection. | Medium | Low | Rejected: station-five has an `ACTIVE` follower group at sequence 3, both members active, three applied receipts, no pending gap, successful member-settings reads, and Bob's group typing authorization succeeds. |
| Q | Federated command preparation still validates Bob's endpoint through station-four's local `actor_devices` instead of the verified remote endpoint manifest. | High | Low | Confirmed: station-five forwards `/messaging/command/prepare`; station-four receives `/messaging/federation/command/prepare`, then returns `messaging: record not found`. The authority has Bob's verified manifest but no local Bob device row, and both `AuthorityPrepareHandler` and `AuthorityService.PrepareSend` still use the local device directory. |
| R | Bob's Device Messaging Engine lacks the MLS session required to prepare the reply. | Low | Low | Rejected as the first failure: the Station prepare request returns 500 before local MLS outbound preparation runs. |
| S | The cross-Station Fixture publishes an accepted friend request but omits the reciprocal Social follow edges required by Conversation Direct policy. | High | Low | Confirmed by Windows run `20260906T050808799291Z-fa0eb0c4f955b6e8442c02cdaed89473`: Desktop rendered Bob as an accepted friend, while station-four returned `RELATIONSHIP_REQUIRED`. Source inspection showed `seed_cross_station_contact` inserted only `friend_chat_friend_requests`; commit `abea69ac4346a87aab74c45152be646906fabed4` now seeds and asserts both canonical `follows` edges on each disposable Station. |
| T | Desktop still publishes MLS KeyPackages through the deleted `/keypackage/*` namespace after Station moved the capability to `/key-exchange/*`. | High | Low | Confirmed by run `20260906T060404502049Z-720b250fb534231a2a274d7f7cd9ab9a`: both clients repeatedly received 404 for `POST /keypackage/upload`; Alice's group creation then returned Station 500 and no MLS group projected. Commit `d30bf13e5` moves every Desktop MLS KeyPackage and DKX caller to the canonical Key Exchange routes and adds a no-legacy-route contract check. |

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

Exact-source run
`20260904T170550632438Z-86c08bfd4c710aac4cd6efce33ada3e6`
at commit `1f8a0a3625e3dbbcd791b2e3389727a8ea2ffd6f` and binary
SHA-256
`6675bdf135fc7f06d75052f40345588a561cbfddcbb73e0ae04cc632231154d3`
proved both Station bindings, the Windows runtime cell, the Bob-bound inline
failure pane, runtime-log cleanliness, and complete cleanup. The Gate correctly
reported `conversation.search.ui` as the first failed step.

Debug lines 11-13 prove the exact Bob click entered the handler, rejected the
existing-conversation branch, started Direct creation, and received Station
500. Station-four logged the corresponding authenticated
`POST /messaging/conversation/direct` at `17:33:52Z`, then returned 500.
Its bootstrap evidence at the request boundary reported `seeds=0` and an empty
DHT routing table. Container inspection confirmed
`RELAY_CLIENT_ENABLED=false`.

This run confirms a topology restoration failure rather than a new Direct
implementation regression. `make station` recreated both disposable Station
containers with the shared `station.env`; it did not reapply the saved
`chat-native-four.env` and `chat-native-five.env` topology. After reapplying
those exact environment files, both Stations report:

- the exact `1f8a0a3625e3` build;
- Relay enabled with the shared Relay endpoint;
- one configured and connected DHT seed; and
- ten connected routing peers.

The next comparison run uses unchanged product implementation and
`runId=post-topology-restore`.

The topology-restored run
`20260904T174913706510Z-285038c7784e15b141f511170e839a0e`
at commit `491ed6b2b4e248baa58cc26951d5176c4bbf0887` proved:

- exact Direct creation and repeat reopen;
- `group.create.ui` completed through authority prepare, command commit, and
  remote queue acknowledgements; and
- the group-genesis endpoint-manifest correction crossed its former failure
  boundary.

The first failed step moved to `transcript.thread.ui`. It timed out in
`focus_actor_window()` before the composer click. Runtime-log cleanliness still
failed independently on the MP-D29 membership marker, while all resource
cleanup passed.

An unchanged-source retry
`20260904T182736117079Z-d7f0149e23b90392e96db7ce6ff69ed3`
reproduced the same `focus_actor_window()` timeout earlier at
`conversation.search.ui`. In both runs the activation diagnostic sampled
`documentFocused=true` immediately after native process activation, but native
diagnostic and point-ownership subprocesses ran before the later WebView focus
check and foreground focus moved to unrelated Windows processes.

The Gate-owned correction now:

- verifies point ownership before process activation;
- performs no native diagnostic or point probe between successful activation
  and the WebView focus check;
- returns immediately once WebView focus is confirmed; and
- retains the title-bar mouse fallback and terminal diagnostic only when
  process activation does not focus the document.

Focused Native Product Closure and Runtime Cell tests pass: 58 + 45.

Exact-source Windows run
`20260904T190332370979Z-f9793309fcd5ad79ac955d4bad864acd`
at commit `9e7faa577bc8a7ffd3e710f365442a51140625c2` and binary
SHA-256
`f3bb7159ba06983561f269cccc710e4ad64cbc811ec645585bcaaa3861653122`
confirmed the focus correction:

- `conversation.search.ui` passed with exact Direct create/reopen;
- `group.create.ui` passed;
- Alice's first group message reached Bob's visible transcript; and
- cleanup released every process, port, storage root, endpoint, tunnel, source
  workspace, and GUI lease.

The first failed step remained `transcript.thread.ui`, but it moved beyond
native focus. Bob's outbound group send returned
`messaging_send_outcome:not_queued:draft`, so the Gate timed out waiting for
Bob's own visible message.

Read-only database evidence for group
`2ef5bd8d-492b-46fe-b342-d74498d3bd04` shows:

- station-four: two active members, three authority events, and three
  delivered federation frames;
- station-five: all three Bob queue items ACKed, but zero authority events and
  zero conversation membership rows; and
- Bob's runtime: repeated `active conversation membership required`,
  `group:0`, and no queued Bob-authored message.

This confirms hypothesis L and rejects J, K, and M. The remaining failure is
the proposed MP-D29 authority-signed follower-membership design boundary, not
a focus, delivery, decrypt, or DOM-selector regression. MP-D29 remains
unimplemented pending Owner acceptance. The current debug session stays
`[OPEN]`; instrumentation and the Debug Server must remain available until
the user confirms cleanup.

MP-D29 was subsequently accepted and implemented as MP-W14 A-D at exact commit
`f04e0dfd68513ab8d249a5cfe0ed93645d189536`. Windows Product Closure run
`20260905T105928664207Z-cf73c7b7f1b9d3e05a34ce9b305e248c`, binary SHA-256
`b3904e78de213428e1efe2fdd964eba5f1c80940e8593fa648cafc42405046df`,
failed earlier at `conversation.search.ui`. Runtime inspection proved both
disposable Station containers had been recreated through the shared
`station.env`, which disabled Relay and removed DHT bootstrap configuration.

Fresh Relay invites were issued, the two disposable cached Relay tokens were
replaced, both Stations were recreated with their dedicated environments, and
the worktree-local deploy commands were corrected to keep those environment
files. Preflight then proved exact source `f04e0dfd6851`, Relay stream
connection, no subsequent token rejection, DHT `ready=true`, one connected
seed, and twelve routing peers on both Stations.

The unchanged-source comparison run
`20260905T114725741869Z-8894cc822a6bd05b8f187403b0c557e3`, binary SHA-256
`6b104889e266dda2f4b8f714b8214befb935ff4ad381cbfc9f0b39afb1150108`,
confirmed the topology correction:

- debug lines 1-2 show the exact Bob click returning
  `create-direct-success` for
  `d-f4d4aaa25c831bb05fdd53cd1cdd6120`;
- debug lines 3-4 show repeat search selecting that same conversation;
- station-five persisted the group follower conversation as `ACTIVE` at
  sequence 3 with Alice and Bob active, three applied follower receipts, and
  no pending event;
- Bob's typed member-settings reads and group typing authorization succeeded.

The first failed step remains `transcript.thread.ui`, but the failure moved to
the next authority boundary. Bob's
`POST /messaging/command/prepare` reached station-five, was forwarded to
station-four as `/messaging/federation/command/prepare`, and station-four
returned `messaging: record not found`. Bob's durable draft therefore remained
`not_queued`. Source inspection matches the runtime evidence:
`AuthorityPrepareHandler` resolves the sender Home Station through the local
device directory, and `AuthorityService.PrepareSend` checks sender activity in
the same local directory even for a remotely authenticated endpoint.
station-four correctly has no local Bob device row; its verified signed Bob
endpoint manifest is the required authority under MP-D19.

The correction must validate the federated sender Home Station and active
endpoint against the already verified endpoint manifest, retain local-device
authorization for local requests, and add manifest-only remote-sender
regressions at the handler and authority-service boundaries. The run completed
full Windows process, port, storage, endpoint, tunnel, source-workspace, and GUI
lease cleanup. The debug session remains `[OPEN]`.

The approved local correction now routes federated prepare through
`AuthorityService.PrepareFederatedSend`. The service resolves all active member
manifests, requires the sender endpoint to appear in the signed active endpoint
set, and binds the sender manifest Home Station to the JWT-authenticated source.
The redundant authority-local `actor_devices` sender lookup was removed from
send preparation; local callers remain authorized through their freshly built
local signed manifest.

Focused handler and repository-backed manifest-only sender regressions pass.
The approved four-Gate local Chat cohort passes in aggregate
`20260905T125516816692Z-a1fe8cb980506bd4e86592a5e451136e`.
Post-fix Windows evidence is not yet collected, so hypotheses Q and R retain
their pre-fix conclusions and the debug session remains `[OPEN]`.

Exact-source Windows run
`20260906T050808799291Z-fa0eb0c4f955b6e8442c02cdaed89473` at commit
`9e9b8a79f23be736639a4754010cc77eda2148c1` and binary SHA-256
`0abd4c18988c513881d0fc649707a4dc518b0d665c4bb1c2b13a2126da4710dc`
failed at `conversation.search.ui`. The peer-bound intent pane was visible with
inline error and retry, so the frontend recovery contract was working. The
actual create request failed with `403 RELATIONSHIP_REQUIRED`.

The cross-Station Fixture had materialized an accepted
`friend_chat_friend_requests` row for Desktop but omitted the reciprocal
`follows` rows read by `ConversationGateEvaluator`. This split one accepted
relationship into inconsistent Social projections. Commit
`abea69ac4346a87aab74c45152be646906fabed4` fixes the Fixture at the Social
truth layer: it inserts both follow directions and aborts the transaction unless
both edges exist. The SQL executed successfully on station-four and
station-five, and the clean-HEAD four-Gate local Chat matrix passed. Post-fix
Windows Product Closure remains pending; the session stays `[OPEN]`.

Exact-source Windows run
`20260906T060404502049Z-720b250fb534231a2a274d7f7cd9ab9a` at commit
`b9745a20ee04db0c50c36c2f3579f1c2a3db1c4c` and binary SHA-256
`56e1951071978b631e6c8939f53f9ee37be14bd61084a65b63167f3b0362729e`
proved the relationship-Fixture correction:

- the first exact Bob click created Direct conversation
  `d-f4d4aaa25c831bb05fdd53cd1cdd6120`;
- the second search reopened the same Station-authored conversation;
- `conversation.search.ui` passed; and
- cleanup released all clients, ports, storage roots, tunnels, source
  workspace and the GUI lease.

The first failed step moved to `group.create.ui`. Both clients repeatedly
called deleted `POST /keypackage/upload` and received 404, leaving Station
without the MLS KeyPackages needed for group genesis. Alice's create-group
command consequently returned Station 500 and no active MLS group appeared.
The canonical ownership registry and Station already expose
`/key-exchange/mls/key-package/{upload,fetch,count}` and
`/key-exchange/dkx/send`; commit `d30bf13e5` switches all Desktop callers to
those routes and rejects restoration of the old literals. Post-fix Windows
Product Closure remains pending; the session stays `[OPEN]`.
