# Debug Session: conversation-open-500
- **Status**: [OPEN]
- **Issue**: The current-profile native two-client Chat Gate reaches both authenticated Desktop clients and source attestation, then `conversation.open` fails because Station returns HTTP 500.
- **Debug Server**: http://10.4.55.179:7779/event
- **Log File**: .dbg/trae-debug-log-conversation-open-500.ndjson

## Reproduction Steps
1. Use the canonical `four` profile and deploy Station through `make station`.
2. Run the `chat-native-current-profile-two-client-e2e` Acceptance Gate.
3. Observe successful Station identity, existing actor fixture, Alice/Bob native client bindings, and runtime source identity.
4. Observe `conversation.open` fail at `chat.createDirectConversation` with Station HTTP 500.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Signed direct genesis recovery rejects persisted post-state decoding or semantic equivalence. | High | Low | Rejected: conversation list and Direct creation both rehydrate the existing authority projection successfully. |
| B | Canonical event sealer verification fails because persisted bytes or the deployed sealer identity differ. | Medium | Low | Rejected: Station returned 200 for `POST /conversation/direct`. |
| C | Recovery succeeds but rewriting `conversation_member_devices` violates a transaction constraint. | High | Medium | Rejected: the failing call is the later device inbox claim, not authority persistence. |
| D | The HTTP 500 occurs outside direct projection recovery in create/list authority queries. | Medium | Low | Confirmed: Direct creation succeeds; the Tauri command fails during its post-create queue drain. |
| E | Station returns a typed domain cause but Gateway/Harness strips the details. | Medium | Low | Confirmed: Station logs `delivery.claim: device: is not active for the authenticated actor`, while the client sees an empty HTTP 500 body. |

## Log Evidence
Instrumentation points:

- D entry: bound account, actor, endpoint device, and runtime profile.
- D Station result: distinguishes `/conversation/direct` from later work.
- C-E drain result: captures the exact post-create queue-drain result and endpoint.

Existing immutable run evidence:

- Run `20260911T051620333813Z-4640f78c3a8eddb332a6239a39482afb`
  started two isolated native clients and passed source/runtime identity.
- Station request `c394112c-aed8-4734-a695-55080b420133` returned 200 for
  `POST /conversation/direct`.
- Subsequent `/device/inbox/claim` requests failed because the requested
  device was not active for the authenticated actor.
- Pre-fix Debug Server line 1 records Alice engine endpoint
  `01M27G2ZNZ64HKWEVWB3ETW0VD`.
- Pre-fix Debug Server line 2 records successful Direct reuse for
  `direct-8933203d465fd79ac34b9b33953757a2`.
- Pre-fix Debug Server line 3 records the subsequent queue drain failure.
- Station has one active Alice device, `01M276A60YVV4Q9MWN9NPHD3RE`; the
  run-created endpoint was not enrolled.
- The group-chat local seed contains Bob's canonical actor identity but a stale
  Alice identity; the high-chat local seed contains Alice's canonical actor
  identity but a stale Bob identity.

## Verification Conclusion
The current-profile Provisioner clones one worktree's Desktop identity seed
for both actors. The accepted native Chat workflow requires Alice and Bob to
use the isolated high-chat and group-chat profile states. Alice therefore
generated a device certificate under the wrong actor continuity key,
`/device/enroll` returned 409, and the synchronous post-create drain surfaced
the later inactive-device error as if Direct creation had failed.

## Direct Peer Projection Follow-up

The post-fix two-client run
`20260911T061550580064Z-4bccb3c7dab491c592af6e54d03d85d6`
passed `conversation.open`, then Alice's native composer failed before
submitting a message with `A recipient is required for a direct message`.

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| F | Desktop Rust persisted the Station conversation without its members. | High | Low | `messaging_list_conversations` reports the Direct projection with zero members. |
| G | The Tauri JSON response contains both members but the TypeScript protobuf decoder drops them. | Medium | Low | Rust reports two members while `imServiceV1.messaging.listConversations()` reports zero. |
| H | Both members reach `socialChat`, but the authenticated actor PTID comparison removes or selects the wrong peer. | Medium | Low | Store input reports two members while the projected Direct peer is empty or self. |
| I | The selected UI conversation is stale and differs from the latest store projection. | Low | Medium | Store reports a valid peer while the composer still receives an empty receiver. |

Instrumentation points:

- F: Rust `messaging_list_conversations` emits per-conversation member counts.
- G/H: `socialChat.loadSessions` emits decoded member PTIDs and the
  authenticated actor PTID before committing the store projection.

Runtime evidence from source-bound native run
`20260911T063158577088Z-70e86205160096c42bf4b9b0d81d08a8`:

- F confirmed for Alice and Bob: Rust repeatedly projected
  `direct-8933203d465fd79ac34b9b33953757a2` with `memberCount=0`.
- G rejected: the TypeScript service received the same zero-member projection;
  no populated Rust member was lost in protobuf JSON decoding.
- H rejected: both authenticated actor PTIDs were correct, but the store had no
  member candidate from which to derive a peer.
- I rejected: both clients independently reproduced the same empty peer from
  the current projection; this was not a stale selected-conversation object.
- The Gate again failed at `message.submitted` before any Station message
  command, then released both native processes, six ports, and both run-scoped
  storage roots.

Root cause:

- `messaging::lifecycle::hydrate_projections_from_station` fetches
  `/conversation/list`, which intentionally returns Conversation metadata
  without members, and persists each local projection with `members=[]`.
- Once that metadata includes a Federation ID, the lifecycle returns early on
  later cycles, so the empty member child projection cannot self-heal.
- The HTTP Gateway `messaging_hydrate` path duplicates the same empty-member
  projection construction.

## Direct Prekey Publication Follow-up

Source-bound post-fix run
`20260911T065128258878Z-d9d996f2e7792c2582a3ae30e950000e`
proved both clients now receive two members and derive the opposite peer PTID.
The first send then persisted a local draft but could not queue a command:

- Station `/key-exchange/keys/bundle/fetch` returned 404 for Bob.
- `messaging_send_message` returned `state=draft`.
- Desktop surfaced `messaging_send_outcome:not_queued:draft`.

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| J | The copied local Messaging Store marks its prekey bundle published, so lifecycle skips upload even though Station has no bundle. | High | Low | `hasBundle=true`, `pendingPublication=false`, publish returns success, peer fetch remains 404. |
| K | Lifecycle prekey publication is failing, but the error is hidden by later successful cycles. | Medium | Low | publish instrumentation reports an upload or local-state error. |
| L | Bob publishes successfully, but Station stores the bundle under a mismatched actor/device. | Low | Medium | local publish reports a pending upload while fetch for the same active endpoint remains 404. |

Instrumentation point:

- J-K: `MessagingEngine::publish_prekeys` records local bundle/pending state and
  the publish result without recording private key material.

Runtime evidence from exact-source native run
`20260911T070854885624Z-687f80aa16cac8e456300e5eaba74922`:

- J confirmed for both endpoints: Alice
  `01M276A60YVV4Q9MWN9NPHD3RE` and Bob
  `01M276ADT9PV9HYNNE7XP6WBN0` repeatedly reported
  `hasBundle=true`, `pendingPublication=false`, and `pendingOpkCount=0`.
- K rejected: every instrumented `publish_prekeys` call returned `ok=true`
  without an upload attempt or local-state error.
- L rejected: neither endpoint had a pending upload; Station bundle fetch
  returned 404 because publication was skipped, not because a new bundle was
  stored under a different endpoint.
- The Gate reached `conversation.open`, failed at `message.submitted`, and
  preserved the strict durable-draft-versus-queued distinction.
- Provisioner cleanup passed for both native processes, ports
  `3140/3141/3410/3411/4475/4476`, logs, and both run-scoped storage roots.

Root cause:

- `PreKeyPublisher::publish` treats a locally present bundle as complete and
  returns success when no local publication is pending.
- Local publication state is not authoritative for Station public material.
  A copied or restored Desktop store can therefore retain `published` while
  Station has no matching Direct bundle.
- Repair must add a durable, additive OPK reconciliation batch. It must preserve
  the existing SPK and old OPKs, use count/replenish for normal inventory
  repair, fall back to full bundle upload only when Station reports the bundle
  absent, and never reactivate consumed OPKs.

Post-fix runtime evidence from
`20260911T080723648674Z-b5b7b2f14dc6b6fabad5d38f7365a3a0`:

- Both canonical endpoints completed `publish_prekeys` with `ok=true`.
- Station now contains complete identity/SPK rows and 20 available OPKs for
  Alice `01M276A60YVV4Q9MWN9NPHD3RE` and Bob
  `01M276ADT9PV9HYNNE7XP6WBN0`.
- Both native clients passed ACTIVE enrollment and `conversation.open`.
- The sender still received 404 from `/key-exchange/keys/bundle/fetch`, so the
  prekey publication defect is fixed and the Gate has advanced to a distinct
  target-endpoint lookup defect.
- Gate cleanup again released both processes, all six ports, logs, and
  run-scoped storage.

Next hypotheses:

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| M | The Station prepare snapshot includes a stale actor device that is no longer ACTIVE. | High | Low | The fetch request targets a device absent from the current ACTIVE device rows. |
| N | The fetch request targets the canonical active endpoint, but local-versus-federated routing resolves the wrong Home Station. | Medium | Low | Target PTID/device are canonical while the fetch still returns 404. |
| O | One active peer endpoint has no complete Station bundle despite the canonical endpoint being repaired. | Medium | Low | Fetch succeeds for one endpoint and fails for another active endpoint. |

Instrumentation point:

- M-N-O: `StationKeyBundleTransport::fetch` records requester and target endpoint
  IDs plus success/error and returned bundle endpoints.

## Cross-Worktree Direct Preparation Follow-up

Exact-source current-profile run
`20260911T091945164468Z-8a0352c866ed640575c28ed19e7c1f2a`
proved the corrected runtime topology:

- Bob ran from `peers-group-chat` and initiated the Direct journey.
- Alice ran from `peers-chat-high-chat` as the receiver.
- Both worktrees were clean, shared one Git repository, and had the same source
  tree.
- Station ran group-chat commit
  `4a4ff5ef493d89c241cbe480cc70552f7e6d16e6`.
- Both clients reached ACTIVE enrollment and `conversation.open`.
- The first message remained a durable draft, receiver DOM evidence was absent,
  and reverse cleanup released both clients, all six ports, logs, and storage.

Fresh pre-fix instrumentation from the repeated cross-worktree run records Bob
`01M276ADT9PV9HYNNE7XP6WBN0` fetching Alice canonical ACTIVE endpoint
`01M276A60YVV4Q9MWN9NPHD3RE`. Every recorded Direct bootstrap fetch returned one
bundle bound to that exact endpoint. Station inventory inspection also reports
complete bundles for all four ACTIVE Alice/Bob endpoints; Alice's second device
has zero OPKs but retains identity/SPK material, which is valid for an
OPK-optional Direct bootstrap.

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| M | The send plan targets a device absent from the ACTIVE Actor Directory. | Medium | Low | Rejected: the observed target is the canonical ACTIVE Alice endpoint. |
| N | Local-versus-federated routing sends a canonical target to the wrong Home Station. | Medium | Low | Rejected: local canonical fetch returns the exact requested bundle. |
| O | The Direct send bootstrap fails because its requested endpoint has no complete bundle. | Medium | Low | Rejected for the send path: every instrumented fetch returns one exact bundle. |
| P | Session resolution rejects the fetched bootstrap because local stored session state conflicts with it or another required endpoint remains unresolved. | High | Low | `prepare_message_draft` returns a session/bootstrap-specific error after successful fetch. |
| Q | Atomic Direct outbound persistence rejects the prepared session/authority state. | Medium | Low | `prepare_message_draft` returns a store/authority commit error after successful fetch. |
| R | Encryption or command construction rejects the prepared inputs before persistence. | Low | Low | `prepare_message_draft` returns an encryption/command validation error after successful fetch. |

The exact P/Q/R error is currently hidden by two `Err(_)` branches in
`MessagingEngine`: the immediate submit returns `state=draft`, and the lifecycle
retry records only `prepare_failed`. The next instrumentation point reports that
error to the existing Debug Server without changing retry or draft semantics.

Instrumentation run
`20260911T092935148620Z-91e7fc226001ea9e609fc8fe5258b1a9`
is invalid for P/Q/R analysis. A concurrent local Foundation Gate acquired the
same Desktop profile ports and runtime lifecycle after preflight; the Chat run
timed out at Bob ACTIVE enrollment before Alice launched or message preparation
executed. Its cleanup evidence passed, but it produced no message-path evidence.
Do not rerun the local Chat Gate until that concurrent Gate releases the shared
Desktop resources.

After the concurrent Gate released its resources, the exclusive pre-fix run
produced the missing evidence:

- Debug line 158: Bob's immediate submit failed with
  `messaging endpoint key bundle binding mismatch`.
- Debug lines 165/177/185/198: the corresponding Key Exchange fetch returned
  exactly Alice PTID plus canonical device
  `01M276A60YVV4Q9MWN9NPHD3RE`.
- Debug lines 167/179/187/200: every lifecycle retry failed with the same
  binding mismatch after the fetch succeeded.

P is confirmed at the wire-to-session boundary; Q and R are rejected because
execution never reached outbound persistence or encryption. The requested and
returned endpoints have the same canonical `(actor PTID, device ID)`, but
`StationKeyBundleTransport::fetch` compares the entire generated
`ActorDeviceRef`. The Conversation send plan includes Actor metadata such as
`kind`, while the Key Exchange response reconstructs only canonical identity
fields. Non-identity protobuf metadata therefore creates a false endpoint
binding mismatch.

The fix must compare only canonical Actor PTID and device ID. It must continue
to reject a changed PTID, changed device ID, missing actor, or empty device.

## Direct Authority Head Follow-up

Exact-source current-profile run
`20260911T101655225502Z-88c4b954448acee5d24cdbe670011a9d`
proved the corrected cross-worktree topology and removed the endpoint binding
mismatch. Bob/group-chat still retained the new message
`01M28064R1NZ6BR04CH9XX1C3A` as a durable draft because Direct preparation
reported `messaging local authority head is behind send plan` on the immediate
attempt and all six retries. Both client processes, six ports, logs, and
run-scoped storage roots were released.

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| S | Bob's local authority sequence is lower than the Station send plan and the device inbox has no missing authority item to advance it. | High | Low | Local sequence remains lower while every drain reports zero processed items or an unchanged cursor/head. |
| T | Bob has the same authority sequence as Station but a different event hash. | Medium | Low | Sequence values match while the local and plan hashes differ on every attempt. |
| U | Bob's restored local authority head is ahead of the current Station plan. | Medium | Low | Local sequence is greater than the plan sequence before and after drain. |
| V | Authority advances while the fixed send plan is being reconciled, so a newly fetched plan is required after drain. | Low | Low | Local head advances beyond the original plan during the loop and a later prepare response matches it. |

Instrumentation point:

- S-T-U-V: `MessagingEngine::prepare_message_draft` records the fixed plan
  sequence/hash, local sequence/hash before each bounded drain, and the drain
  cursor/lane-head/processed result. It does not alter the reconciliation loop
  or accept a mismatched authority head.

Exact-source current-profile run
`20260911T104702215012Z-4d96be6ca0a6f759c9eef0db233ba72e`
confirmed S and rejected T/U/V:

- Bob ran from `peers-group-chat`; Alice ran from `peers-chat-high-chat`.
- The two clean worktrees had equal Git trees and distinct workspace IDs.
- Bob's local authority head remained sequence `0` with an empty hash.
- The Station send plan remained sequence `1` with hash
  `5da69d0e93893f14a323d5500d81aa01bb26d6fceaf367a5a1d012d9fa5bb3e0`.
- Every bounded drain reported cursor `0`, lane head `0`, and zero processed
  items, so no historical genesis item exists in this device lane.
- The message `01M281CFZEXKR2JC1AH2BJ0YF4` remained a durable draft.
- Both native clients, all six ports, logs, and run-scoped storage roots were
  released.

Root repair in progress:

- The portable Core verifies the canonical protobuf event hash and the complete
  Direct sequence-one genesis snapshot.
- The Engine may fetch exactly the first authenticated public event only when
  the local head is empty and the Station send plan is exactly sequence one.
- The event must match the plan's conversation, authority Station, sequence,
  hash, membership epoch, and MLS epoch, and its Direct projection must match
  the already-persisted local projection.
- The Store installs only the authority head in one SQL transaction. It does
  not fabricate a queue item, lane cursor, consumption marker, receipt, message
  projection, or Direct session.
- Conflicting heads, sequence greater than one, malformed/tampered genesis,
  projection drift, and pre-existing committed state fail closed.

Source verification:

- Messaging Core: 117 unit tests plus 2 integration tests passed.
- Desktop Messaging: 103 tests passed and 1 environment-gated test was ignored.
- The stale pre-hard-cut receipt-count assertion was corrected from two rows to
  the one canonical `device-consumed` receipt now owned by the hard-cut model.

Post-fix native runtime evidence remains pending. The debug session stays
`[OPEN]`.

## Direct Genesis Route Ordering Follow-up

Exact-source cross-worktree run
`20260911T114640876965Z-a4973bc5a5d2d31f8c348abde7649c40`
launched Bob from `peers-group-chat` and Alice from
`peers-chat-high-chat`, then failed at Bob's first submission with
`messaging Direct genesis endpoint routes are invalid`. Cleanup removed both
Gate-owned native processes, ports, logs, and run-scoped storage.

| ID | Hypothesis | Status | Evidence |
|----|------------|--------|----------|
| W | `active_endpoints` and `active_endpoint_routes` contain the same canonical endpoints in different valid orders. | Confirmed | Station `ActiveEndpoints()` sorts by actor/device, while `MemberDevices()` sorts by the length-prefixed endpoint key before `mapConversationState` builds routes. |
| X | A route is missing or duplicated. | Rejected | The verifier passed the equal-count check before failing route comparison. |
| Y | A route carries the wrong Home Station for its actor. | Rejected by source construction | Both fields originate from the same persisted `MemberDevice`; no transformation changes the Home Station. |

The correction compares route membership as a canonical endpoint-keyed set and
still requires exactly one route per endpoint plus the member's exact Home
Station. Unit coverage now uses the two different valid orders and rejects a
wrong Home Station. A fresh exact-source Native run is still required.

## Current-Profile OPK Continuity Follow-up

Exact-source run
`20260911T120248159958Z-2b7850dfbbdc8fe6edcf8a27ea3842cd`
proved the corrected two-worktree topology and Direct genesis checkpoint:

- Bob ran from `peers-group-chat` and submitted first.
- Alice ran from `peers-chat-high-chat` and received the queued item.
- Both worktrees were clean, distinct, and resolved the same Git tree.
- Bob's message advanced past durable draft submission.
- Alice repeatedly failed the queue drain with
  `messaging one-time prekey is unavailable`.
- Native processes, ports, logs, and run-scoped storage were released.

| ID | Hypothesis | Status | Evidence |
|----|------------|--------|----------|
| Z1 | The current-profile Provisioner rolls the same device backward by cloning an unchanged seed on every run and deleting private OPKs that Station durably published or consumed. | Confirmed | The Provisioner copies each worktree seed to `/tmp/pt-chat-native-current-<run>` and local runtime cleanup deletes it. Station OPK publication/fetch is durable, while Desktop OPK private state exists only in the deleted SQLCipher clone. |
| Z2 | Alice rejected the item because its canonical actor or device binding was wrong. | Rejected | The Gate passed cross-worktree topology and actor isolation; the receiver reached `load_one_time_prekey` only after exact endpoint/session-init validation. |
| Z3 | The receiver can safely omit the missing OPK and continue with SPK-only X3DH. | Rejected | The committed `DirectSessionInit` binds a concrete OPK ID and public key. Substituting or omitting it changes the derived secret and violates the ciphertext binding. |
| Z4 | Copying only OPK rows back to the source seed is sufficient. | Rejected | OPK consumption commits atomically with Direct session, ratchet, projection, marker, cursor, inbox, and receipt state in the same SQLCipher database. Selective copyback would split one Device Engine transaction. |

The repair belongs to the current-profile Provisioner/runtime lifecycle, not
the Messaging decrypt path. It must retain one dedicated, persistent
Acceptance device state per actor and worktree across runs while continuing to
delete run-owned processes, ports, and logs. The initial persistent state keeps
the source actor identity but excludes copied live `chat.main.db` state, so the
Gate enrolls a fresh isolated device instead of inheriting the already
irrecoverable public/private OPK split. The receiver's missing-key rejection
remains unchanged.

Three exact-source runs on commit `84b5ff8fc40f79b7f36442f245d577520f3672cc`
then isolated the next boundary:

- `20260911T132948166064Z-ed936c0d333c9acc6c9625b7b67bec18`
  created and retained the two persistent device states;
- `20260911T133705719955Z-cde09239c3839bc01c996e0112e601de`
  reused those states and reproduced the same first-send failure;
- `20260911T134419176858Z-46e935d2751d2a8a9e79049d86abfd6d`
  ran with Debug Server collection enabled.

The latest runtime evidence rejects both a local prekey publication failure and
a transient bootstrap race. Alice and Bob each report a published local bundle
with no pending publication or replenishment, and `publish_prekeys` returns
success. Bob instead receives a Station send plan at authority sequence 2 while
his fresh endpoint has no local authority head. `drain_once` has no historical
device-lane item because the endpoint was activated after those events. All
preparation retries therefore fail with
`messaging Direct authority checkpoint requires sequence-one send plan`.

| ID | Hypothesis | Status | Evidence |
|----|------------|--------|----------|
| Z5 | The first Gate attempted send before the fresh endpoint published its initial bundle. | Rejected | The second and third runs reuse the same durable device state; current device bundle publication remains successful, but send still fails before session bootstrap. |
| Z6 | A stale active endpoint with no public bundle is the first failing boundary. | Rejected for the current failure | Debug instrumentation reaches the authority checkpoint before Direct bootstrap and records the sequence mismatch on every retry. |
| Z7 | A fresh Direct endpoint can only bootstrap when the conversation is still at genesis sequence 1. | Confirmed defect | New endpoint local head is `(0, empty)` while the authenticated Station plan is `(2, exact hash)`. The current implementation rejects every non-sequence-one checkpoint. |

The accepted architecture already states that a device activated after an
event commit receives no historical live ciphertext, obtains old history only
through Recovery, and receives future events from its activation sequence. The
implementation therefore must verify the complete public authority event chain
from genesis through the send-plan head, derive the Direct actor projection
from the verified genesis event, and atomically install that projection plus
the verified current head. It must not synthesize historical message
projections, replay endpoint-private payloads, or trust an unverified plan hash.

## Fresh Direct Receiver Checkpoint Follow-up

Exact-source run
`20260911T140324819274Z-6ce74ecee89fe31d068dd1f82efbe3c0`
advanced Bob/group-chat through sender checkpoint and message submission, then
timed out waiting for Alice/high-chat's native DOM plaintext. Alice's native
runtime reported `messaging authority event chain is not contiguous`.

| ID | Hypothesis | Status | Evidence |
|----|------------|--------|----------|
| Z8 | Alice's fresh Device Engine receives sequence 3 with local authority head 0, so the ordinary strict consumer rejects the missing predecessor before decryption. | Confirmed | Bob's checkpoint reached sequence 2 and submission passed in 735 ms; Alice's first private delivery was sequence 3 and failed the Store's `None unless sequence == 1` chain branch. |
| Z9 | The receiver should skip or ACK the sequence-3 item before decrypting it. | Rejected | MP-A05 requires decrypt, local commit, dedup, and ACK to share the Device Engine boundary; ACK remains strictly post-commit. |
| Z10 | Historical private queue items should be synthesized or replayed to fill the gap. | Rejected | MP-A07/MP-D17 allow only authenticated public-event replay for an activation checkpoint; old plaintext remains Recovery-only. |

The source correction now inserts one fail-closed hook between claim/lane
validation and the existing consumer:

- non-Direct items and receivers with an existing authority head take the
  unchanged path;
- a fresh Direct receiver verifies the current `DeviceEventDelivery`, replays
  public events only through `current_sequence - 1`, and requires the replay
  head hash to equal the current event's `previous_hash`;
- the existing Store checkpoint atomically installs only the verified
  predecessor head against the matching Direct projection;
- the current private item still decrypts and commits through the original
  consumer before any ACK;
- checkpoint failure stops the lane before consume and ACK.

Post-change local evidence:

- Desktop Messaging: 106 passed, one live-environment test ignored;
- Desktop TypeScript/social checks: PASS;
- Desktop Rust `acceptance-webdriver` check: PASS;
- `git diff --check`: PASS.

The Debug Server remains active on port 7779 and the session remains `[OPEN]`.
Post-fix native runtime evidence is pending exact-source commit, high-chat
synchronization, profile-four deployment, and the unchanged two-client Gate.

## Delivery Receipt Follow-up

The receiver checkpoint was committed in `peers-group-chat`, synchronized into
`peers-chat-high-chat`, and deployed through profile `four`. Exact-source Native
run `20260911T145212236066Z-b0a891ef9f0427c57b86834eeb8226c4`
proved Bob submission and Alice native-DOM decryption for message
`01M28FDJ5609MJ2D1BFHCTJ9KV`. Alice's checkpoint installed the exact sequence-2
predecessor before committing sequence 3. The run then timed out waiting for
Bob's delivered receipt while both clients repeatedly observed HTTP 500 from
`POST /conversation/delivery/receipt`.

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| Z11 | A historical pending consumption receipt is the oldest Desktop outbox entry and is retried before the new sequence-3 receipt. | High | Low | Repeated dispatch logs carry one older receipt/event ID while the new message's receipt remains pending but unselected. |
| Z12 | The selected receipt's exact event/consumer/item tuple has no matching Station authority delivery commitment or canonical queue item. | High | Low | Station reports an interaction integrity failure for the selected receipt tuple, identifying the missing or mismatched authority expectation. |
| Z13 | The new sequence-3 receipt is valid and would succeed if selected, but strict oldest-first selection causes permanent head-of-line starvation. | Medium | Medium | The persistent store contains multiple pending receipts; the selected oldest tuple fails repeatedly while the latest tuple matches current Station state. |
| Z14 | Production HTTP error mapping hides the typed `interaction.Error` and converts the actionable code/details into generic HTTP 500. | High | Low | Station handler receives `CONVERSATION_INTERACTION_*`, while the client receives 500 without `X-Peers-Error-Code` or typed details. |

Instrumentation points:

- Z11/Z13: `MessagingEngine::dispatch_delivery_receipt_once` reports the
  selected receipt ID, conversation/event sequence, consumer endpoint, lane
  sequence, payload hash, and submit result.
- Z12/Z14: `handleSubmitDeliveryReceipt` reports the authenticated endpoint,
  canonical receipt tuple, and typed interaction code/error immediately after
  the application call.

No receipt business behavior is changed until one exact-source pre-fix
reproduction distinguishes these hypotheses.

Pre-fix run
`20260911T151151365999Z-53d60950ba3bc86e25a02511739515d4`
used Station commit `b3cd1ffea3a5c748b117ad8b0f61ed28e4cee5ed`.
The Gate again completed message submission, receiver native-DOM plaintext,
decryption, and cleanup before failing at `receipt.delivered`.

| ID | Status | Evidence |
|----|--------|----------|
| Z11 | Confirmed | Debug lines 5-602 repeatedly select only sequence-3 receipt `device-consumed:f4c476...` for Bob and `device-consumed:fb136e...` for Alice. The new send plan is already at sequence 7, so the historical head entries never advance. |
| Z12 | Confirmed | Debug lines 6, 17, 27 and their Alice equivalents report `delivery_receipt_recorder.record: conversation_member_devices: is missing a required delivery endpoint`. Both receipts had already passed authentication, exact authority commitment, queue item, event, payload-hash, and idempotency validation before aggregate derivation. |
| Z13 | Confirmed | Across 309 receipt instrumentation events, each client selected exactly one stable sequence-3 receipt and no later receipt. The current message therefore cannot reach receipt dispatch while the historical item remains pending. |
| Z14 | Confirmed | Station reports `CONVERSATION_INTERACTION_INTEGRITY_FAILED`; the paired Desktop event receives only `station returned 500 :` with no typed code or details. |

Root cause:

- `loadDeliveryAggregate` requires every committed recipient endpoint to exist
  in `conversation_member_devices`.
- That table is the Conversation-owned device/MLS projection. Direct fan-out is
  actor-level and uses the current Actor Directory endpoint snapshot under
  MP-A07/MP-D17, so a current Direct endpoint can have a valid immutable
  authority delivery commitment without appearing in the genesis-era
  Conversation device projection.
- The aggregate rejects after exact receipt persistence is attempted, causing
  the transaction to roll back. Desktop then retries the same oldest durable
  receipt forever and starves later receipts.
- `mapProductionConversationError` does not map `interaction.Error`, hiding the
  actionable integrity code behind generic HTTP 500.

The owner-layer correction must derive Direct delivery progress from immutable
authority commitments plus exact persisted receipts, retain strict
Conversation member-device validation for Group/MLS deliveries, preserve
committed originator routes for Direct receipt fan-out, and expose typed
interaction failures through production HTTP headers.

The source correction is now applied with instrumentation retained:

- `ReceiptRecorder` loads the canonical Conversation kind before aggregate and
  originator-route derivation.
- Direct aggregates count only exact persisted receipts against immutable
  authority commitments. Missing Direct receipts remain outstanding and are
  not inferred as revoked.
- Direct originator routes use the immutable committed routes; Group continues
  to require the committed active MLS device projection.
- Group missing-device corruption still rolls back the full receipt
  transaction.
- `mapProductionConversationError` maps typed `interaction.Error` values to
  explicit 400/403/409/429/503 statuses with stable code and safe details.

Local post-change evidence:

- focused Direct current-endpoint and Group rollback receipt tests: PASS;
- typed interaction HTTP mapping test: PASS;
- complete Station Conversation tests: PASS;
- focused receipt/interaction race tests: PASS;
- Conversation `go vet`: PASS;
- Chat Domain validation: expected stale-evidence failure until a source-bound
  post-fix Gate is generated.

Post-fix Native runtime evidence is pending. The Debug Server remains active
and this session remains `[OPEN]`.

The interrupted post-fix run on commit
`d089d43a0a247c1edd6e0617d5b15ea44e8050f7` produced a narrower failure before
its parent process was terminated:

- `conversation_member_devices` no longer rejects the receipt;
- the application validator now rejects
  `interaction.validate_delivery_aggregate: delivery: does not match the
  committed consumption receipt`;
- Desktop receives HTTP 409 with
  `CONVERSATION_INTERACTION_INTEGRITY_FAILED`, proving the typed HTTP mapping;
- both clients still select only their historical sequence-3 receipt.

The interrupted Gate-owned process groups and ports were released without
touching unrelated worktree processes. Persistent device state remains intact.

Follow-up hypotheses:

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| Z15 | A later read cursor proves the old event read while no required recipient receipt has yet committed, producing `read=true` and `delivered=false`. | High | Low | The recorder result has `read=true`, `consumed_device_count=0`, and `delivered=false` immediately before application validation. |
| Z16 | The stored Conversation kind is not Direct, so the new Direct aggregate branch is not selected. | Low | Low | The recorder reports a non-Direct kind or still returns the prior `conversation_member_devices` error. |
| Z17 | Typed HTTP mapping remains broken after the source fix. | Low | Low | Desktop still receives generic 500 without the interaction code. |

Instrumentation point:

- Z15/Z16: `interaction.Service.SubmitDeliveryReceipt` reports the committed
  aggregate and canonical Conversation kind outcome immediately before
  `validateDeliveryAggregate`.

Exact-source post-fix iteration
`20260911T154646356305Z-5eb5877f4195cf881d052940aa3d8e43`
was interrupted after the diagnostic boundary and then cleaned up by exact
Gate-owned process groups. The retained log establishes:

| ID | Status | Evidence |
|----|--------|----------|
| Z15 | Confirmed | Debug lines 6, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 82, 88 report `requiredDeviceCount=3`, `consumedDeviceCount=0`, `read=true`, and `delivered=false` immediately before validation. |
| Z16 | Rejected | Receipt recording completed and returned an aggregate; the prior `conversation_member_devices` error did not recur. |
| Z17 | Rejected as a remaining defect | Paired Desktop lines report HTTP 409 with `CONVERSATION_INTERACTION_INTEGRITY_FAILED`, so typed mapping is preserved. |

The remaining root cause is a monotonic receipt-state inconsistency. A
recipient read cursor is stronger evidence than delivered, but
`loadDeliveryAggregate` derives `delivered` only from persisted device receipt
count. Historical read state can therefore produce the impossible
`read=true, delivered=false` aggregate and roll back the exact old receipt.

The correction must preserve the exact receipt count while deriving
`delivered = consumed_device_count > 0 || read`. `fully_delivered` remains
strictly tied to every required event-time endpoint being consumed or proven
revoked.

## Persistent Identity Re-entry Follow-up

Exact-source run
`20260911T155536232655Z-6384c3db6f68e2704460e37c1d8c7e84`
proved that Bob's durable receipt queue now advances successfully through
sequences 3, 4, 5, 6, 7, 8, and 9. The prior receipt head-of-line failure is no
longer the active boundary. The Gate then failed at
`client.authenticated / Bob` because `chat.loginWithPassword` timed out waiting
for `identity account gate`.

Immediate retry
`20260911T155859425134Z-2695df23c4f222cb9c9c87defd79afa1`
failed at the same login precondition. Both runs released their Gate-owned
processes, ports, and logs while retaining the declared persistent Device
Engine state.

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| Z18 | The persistent current-profile client restores an authenticated, ready identity lifecycle before the Chat Harness begins explicit login. | High | Low | Harness entry reports `authenticated=true` and `lifecycleState=ready` instead of `phaseKind=accountGate`. |
| Z19 | The client is unauthenticated but identity boot never reaches a data-ready account gate. | Low | Low | Harness entry or subsequent state reports `authenticated=false` while `phaseKind` never becomes `accountGate` with `dataReady=true`. |
| Z20 | A restored session belongs to an actor that the Harness could silently reuse if it accepted authenticated state without controlled logout. | High | Low | Harness entry reports a non-empty restored actor PTID; no explicit password-login transition occurs before the timeout. |

Instrumentation point:

- Z18-Z20: `chat.loginWithPassword` reports the identity phase, lifecycle state,
  data-ready flag, authenticated flag, and current actor PTID at entry, on each
  distinct state transition, and on precondition failure. It does not log the
  requested account or password and does not alter the existing
  account-gate-only predicate.

The Debug Server remains active on port 7779 and this session remains `[OPEN]`.

Instrumentation-only exact-source run
`20260911T161035318786Z-63582c44fb9232e7d3fca37313e18b25`
used Station and client source
`b8a6ec63e4bb97f585eccb391b09adb48f3f1151`. The Gate failed at
`client.authenticated / Bob`, while cleanup finished `DONE/PROVEN`.

| ID | Status | Evidence |
|----|--------|----------|
| Z18 | Confirmed | Debug lines 15, 16, and 45 report `phaseKind=authenticated`, `lifecycleState=ready`, `dataReady=true`, and `authenticated=true` from entry through timeout. |
| Z19 | Rejected | Bob was not unauthenticated and the identity lifecycle was not stuck in boot; it was already ready. |
| Z20 | Confirmed | The restored Bob actor PTID remained active for the full wait, and the unchanged account-gate-only predicate never admitted the explicit login path. |

Root cause:

- persistent current-profile storage correctly restores an authenticated
  identity session;
- the Chat Acceptance Harness models only the fresh-account-gate entry state;
- unlike the Agent Acceptance Harness, it does not admit authenticated-ready
  as a precondition and perform controlled logout before the requested
  password login.

The owner-layer correction is to make Chat Harness explicit login a deterministic
state transition: boot idempotently, wait for either fresh account gate or
authenticated-ready, perform controlled logout for every restored session,
wait for the resulting account gate, then execute and complete the requested
password login. The restored actor is never silently reused.

The correction is implemented with instrumentation retained under
`runId=chat-login-post-fix`:

- `passwordLogin.ts` owns the deterministic explicit-login transition;
- a restored authenticated-ready session always performs
  `identityRuntime.logout()` before credential login;
- a fresh data-ready account gate keeps the existing path without an
  unnecessary logout;
- incomplete boot and unauthenticated-ready states remain inadmissible; and
- logout failure propagates before credential login.

Local post-change evidence:

- Chat identity/password lifecycle Vitest: 10/10 passed;
- Native runtime-cell Python regression: 45/45 passed;
- Desktop TypeScript check: passed;
- `chat-native-visible-static` run
  `20260911T161556674513Z-c14ca03d3b11d1278cf96675e7622043`:
  `PASSED`;
- Chat Domain proof validation remains expectedly stale until the exact-source
  Native Gate produces post-fix evidence.
