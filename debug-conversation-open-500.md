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
