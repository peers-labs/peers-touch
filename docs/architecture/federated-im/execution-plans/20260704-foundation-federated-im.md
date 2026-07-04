# Foundation Federated IM — Execution Plan

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-04 | **Updated**: 2026-07-05
> **Owner**: Architecture Team
> **Module**: `docs/architecture/federated-im/`, `model/domain/`, `apps/station/app/subserver/group_chat/`, `apps/desktop/src/store/socialChat.ts`

---

## 1. Background And Goal

This is a capability upgrade, not an interface patch. The target is an industrial-grade IM foundation for Peers-Touch:

- local Station IM remains reliable and secure;
- federated actors on different Stations can join groups and speak;
- ordinary groups use authority sequencing rather than per-message consensus;
- E2EE stays device-local;
- family-scale pressure evidence proves roughly 100-person groups and private chats on Home Station-class deployments.

The Foundation Profile is the first deployable profile. It intentionally avoids naming as a numbered release profile and avoids full consensus for every message.

## 2. Non-Goals

- Full consensus-backed chat for every message.
- Cloud-scale mega groups.
- Station-readable group plaintext.
- Complete authority handover/recovery implementation.
- Public global user registry.

## 3. Domain Responsibilities

| Domain | Responsibility | Deliverables |
| --- | --- | --- |
| Product lifecycle contract | Finalize user-visible semantics | dissolved history, pre-join history, leave/remove behavior |
| Station group lifecycle | Enforce local group truth | join auth, invitation status/expiry, soft dissolve, read-only groups |
| Model contracts | Proto-first shared contracts | membership epoch, group status, authority fields, proposal/event shapes |
| Federation delivery | Cross-Station routing | proposal outbox, event replication cursor, idempotent delivery |
| E2EE key lifecycle | Device-only Sender Key control | epoch-bound SKDM, retry, waiting/not-entitled states |
| Client projection | UI/runtime convergence | degraded/read-only/dissolved projections, local decrypt states |
| Pressure and security evidence | Prove Foundation Profile quality | 100-person local group test, 3-Station federated test, security gates |

## 4. Execution Lifecycle

```text
command/proposal
  -> Station auth and policy
  -> group authority validation
  -> committed event or reject code
  -> local/federated delivery outbox
  -> follower projection apply
  -> Home Station SSE
  -> client projection merge
  -> local crypto decrypt/SKDM install
  -> UI state
  -> pressure/security evidence
```

Every phase must preserve this lifecycle. A change that only works on local UI or only works in a unit test is not complete.

## 5. Implementation Phases

### Phase A: Safety Floor For Existing Station Groups

Goal:

- Close current local group lifecycle security and history gaps before federation expands the blast radius.

Deliverables:

- private `JoinGroup` requires a valid invitation;
- invitation status is single-use and pending-only;
- invitation expiry is enforced;
- dissolved group becomes soft read-only archive;
- send/invite/join/update/remove reject dissolved groups;
- tests for direct-join rejection, single-use invite, expired invite, dissolve read-only.

Acceptance:

- Station tests prove stranger cannot join by knowing `group_ulid`;
- dissolved group keeps historical rows but rejects new writes;
- no group plaintext is introduced.

Implementation progress:

- 2026-07-04: Station `group_chat` enforces invitation-backed joins, pending-only single-use invitation acceptance, and invitation expiry.
- 2026-07-04: Station `group_chat` soft-archives dissolved groups with `status=dissolved` and `dissolved_at`, keeps group/member/message history readable, expires pending invitations, and rejects dissolved-group writes at the application boundary.
- Verified by `cd apps/station && go test ./app/subserver/group_chat/...`.
- Still outside Phase A: membership epoch and proto-level group status projection; those remain Phase B deliverables.

### Phase B: Membership Epoch Contract

Goal:

- Bind membership changes, message send, and Sender Key rotation.

Deliverables:

- proto fields for `membership_epoch`, group status, dissolved metadata;
- Station persistence migration for epoch/status;
- every membership change increments epoch;
- group send validates observed epoch and rejects stale sends;
- Desktop refreshes members and retries after stale epoch.

Acceptance:

- stale-epoch send test rejects;
- member add/remove bumps epoch;
- post-remove send cannot reuse old epoch;
- local E2E proves current members still decrypt after rotation.

Implementation progress:

- 2026-07-04: Added proto contract fields for `Group.status`, `Group.dissolved_at`, `Group.membership_epoch`, and `SendGroupMessageRequest.observed_membership_epoch`.
- 2026-07-04: Station `group_chat` persists `membership_epoch`, initializes new groups at epoch 1, increments epoch on member add/remove, and rejects sends whose observed epoch does not match current group truth.
- 2026-07-04: Desktop sends the observed group epoch and retries once after `membership epoch stale` by refreshing group/member projections, rotating the local Sender Key, redistributing SKDM, and re-encrypting.
- Verified by `./model/build.sh`, `make model-lint`, `cd apps/station && go test ./app/subserver/group_chat/...`, `pnpm --dir apps/desktop prebuild:check`, and `cd apps/desktop/src-tauri && cargo build`.
- 2026-07-04: Live home-profile E2E verified with two Desktop Web clients against home Station:
  - A created group `gcg-1783183318555981383` with B/C, then C left through the Station API to bump `membership_epoch` after A had synced the previous epoch.
  - A sent `epoch-rotation-live-1783183689503` from the stale projection. The Desktop retry path refreshed membership from 3 to 2 members, rotated/re-distributed Sender Key material, re-encrypted, and completed the send.
  - B first synced the group message before its SKDM control session and showed `[Waiting for sender key...]`; after syncing friend control session `fcs-1783183689738649038`, B reloaded the group and displayed plaintext `epoch-rotation-live-1783183689503` with no `[Waiting for sender key...]` and no `[Decrypt failed]`.
  - Runtime note: the home Station container was hot-replaced with the `98eebfb1` Station binary for this acceptance run because the formal remote Docker build stalled during `apt-get update`; this proves the product path on the home environment but is not a formal deployment artifact.

### Phase C: Foundation Federated Group Event Log

Goal:

- Introduce the group authority model and committed event stream without changing ordinary local group UX.

Deliverables:

- conceptual proto or draft proto for `GroupProposal`, `GroupEvent`, `FederatedActorRef`;
- authority Station accepts signed local/remote proposals;
- event log table with seq/hash/idempotency;
- follower projection table for remote committed events;
- fork protection on mismatched seq/hash.

Acceptance:

- local authority path writes committed events;
- duplicate proposal is idempotent;
- mismatched event hash puts follower projection into read-only protection;
- no chat data enters Federation Ledger.

Implementation progress:

- 2026-07-04: Added the Station-local committed authority event log table `group_chat_events` with per-group `seq`, `prev_hash`, `event_hash`, `membership_epoch`, `authority_station_peer_id`, `authority_epoch`, and idempotency-key columns.
- 2026-07-04: DB-backed local authority mutations now append committed events in the same transaction for group creation, member join/remove, message append, owner transfer, and dissolve. The existing `group_chat_outbox` remains delivery bookkeeping and is not treated as the committed log.
- 2026-07-04: Event-log storage now has explicit idempotency semantics for proposal-style commits: same idempotency key and same immutable event fields returns the existing committed event; same idempotency key with different fields fails closed with an idempotency conflict.
- 2026-07-04: Added the Station-local follower projection table `group_chat_follower_projections` with `last_seq`, `last_event_hash`, status, and protection reason. Applying a committed event requires `seq = last_seq + 1` and `prev_hash = last_event_hash`; mismatches move the projection to `read_only`.
- 2026-07-04: Added proto contracts for `FederatedActorRef`, `GroupProposal`, `GroupEvent`, `AcceptGroupProposalRequest`, and `AcceptGroupProposalResponse`, with generated Station Go and Desktop TS bindings.
- 2026-07-04: Added `/group-chat/proposal/accept` as the Foundation Profile authority acceptance endpoint. It requires a structurally signed proposal envelope (`signing_key_id` plus `signature`), enforces current membership epoch, commits `group.proposal.accepted` to the authority event log, returns idempotent replay state, and does not execute cross-Station delivery.
- Verified by `./model/build.sh`, `cd apps/station && go test ./app/subserver/group_chat/...`, and `pnpm --dir apps/desktop prebuild:check`, including DB-backed seq/hash-chain, idempotent duplicate-proposal, follower fork-protection, application-layer signed-envelope validation, handler replay, and command-payload non-leakage tests.
- Still open after Phase C: real peer JWT scope/TOFU signature verification and relay-based remote delivery, which start in Phase D.

### Phase D: Cross-Station Delivery

Goal:

- Make federated actors able to speak in an authority-owned group.

Deliverables:

- proposal outbox on actor Home Station;
- authority validation of remote proposal;
- authority fan-out outbox to member Home Stations;
- follower ack cursor and resync path;
- local SSE fan-out after follower apply.

Acceptance:

- 3 Station test: Alice@A creates, Bob@B sends, Carol@C receives;
- authority down makes group read-only/degraded on followers;
- restored authority resumes from cursor without duplicate UI messages.

Implementation progress:

- 2026-07-04: Added the `group-chat-proposal-submit` federation JWT scope for inbound group proposals. The scope requires an audience and only allows `group_ulid`, `proposal_ulid`, and `actor_did` custom claims.
- 2026-07-04: `/group-chat/proposal/accept` now runs under the framework federation wrapper instead of user JWT auth. Authority Station verification uses the existing peer JWT verifier and `auth_peer_keys` TOFU store, then checks token issuer/subject/custom claims against the proposal envelope before committing the proposal event.
- 2026-07-04: Added `group_chat_federation_outbox` for authority-to-follower delivery work. Accepted remote proposals now create one pending outbox row for the proposal actor's Home Station in the same transaction as the committed authority event; idempotent proposal replay does not create duplicate delivery work.
- 2026-07-05: Added the `group-chat-event-apply` federation JWT scope and `/group-chat/event/apply` follower endpoint. Follower Stations now validate committed `GroupEvent` claims against issuer, group, event id, and seq; accepted events advance the persisted follower cursor (`last_seq`, `last_event_hash`).
- 2026-07-05: Public DB-backed `ApplyFederationEvent` now preserves fork-protection state transactionally: seq/hash discontinuity commits `status=read_only` and `protection_reason` while returning a fork-protection error to the application layer.
- 2026-07-05: Added sender Home Station outbound proposal spool `group_chat_proposal_outbox`. It stores signed `GroupProposal` envelopes as pending durable work targeted at the authority Station, enforces idempotency by `idempotency_key`, rejects same-key/different-content conflicts, and keeps authority event commits separate from sender-side proposal intent.
- 2026-07-05: Added the proposal outbox dispatcher core on the actor Home Station side. The dispatcher lists due proposal rows, mints a `group-chat-proposal-submit` peer JWT, submits the original signed proposal envelope through an injected transport, marks success as `accepted`, and moves failures to `retry_wait` with bounded backoff. Handler-level tests wire this transport to the existing authority `gc-proposal-accept` route, so the path proves token minting, claim validation, TOFU pinning, authority commit, and actor outbox acceptance without inventing a second authority path.
- 2026-07-05: Added the production relay-forward transport contract for proposal dispatch. Proposal transport now sends the relay-client bearer token in `Authorization` and the target Station peer JWT in `X-Peers-Forward-Authorization`; the station-side relay-client loopback maps that target-auth header back to local `Authorization` before invoking the authority Station HTTP handler.
- 2026-07-05: Added authority-owned remote member ActorRef indexing on `group_chat_members` and tightened proposal acceptance to require the proposal actor to be a current group member with a Home Station. Authority commit now syncs the proposal actor ref into membership state and creates federation outbox rows for every known remote member Home Station, not just the proposal actor, while de-duping targets and skipping the authority Station.
- 2026-07-05: Added the authority-to-follower federation outbox dispatcher. Authority Stations now list due `group_chat_federation_outbox` rows, mint `group-chat-event-apply` peer JWTs, send committed `GroupEvent` envelopes through relay-forward to follower `/group-chat/event/apply`, mark successful rows as `applied`, and move failures to `retry_wait` with bounded backoff.
- 2026-07-05: Made follower committed event application idempotent for at-least-once delivery. Replaying an already accepted event at or behind the follower cursor returns the current cursor instead of entering fork protection; same-seq/different-hash still fail-closes into `read_only`.
- 2026-07-05: Added the authority-side committed event sync query for follower catch-up. The proto contract now includes `SyncGroupEventsRequest/Response`, the Station registers `group-chat-event-sync`, `/group-chat/event/sync` validates the peer JWT group claim, and the application/repository path returns ordered committed `GroupEvent` windows after the follower cursor. Returned events still advance follower state only through `/group-chat/event/apply`.
- 2026-07-05: Added the follower-side event sync driver. Follower Stations now list active follower projections, mint `group-chat-event-sync` peer JWTs to the authority Station, pull committed events after the local cursor through relay-forward `/group-chat/event/sync`, and apply every returned event through the existing follower apply path so seq/hash fork protection remains the single state transition guard.
- 2026-07-05: Added local SSE fan-out after follower apply. The realtime schema now has `GroupFederationEvent`, follower `/group-chat/event/apply` publishes it to local group members after a committed event advances the follower cursor, Desktop `eventStream` decodes it into a typed kernel event, and `socialRealtime` consumes it to refresh the group projection through `groupChatSync` / `loadMessages` / unread and preview reconciliation. This is a projection refresh signal only; it does not materialize follower-side message rows from opaque proposal payloads.
- 2026-07-05: Added authority-down degraded follower projection handling. Follower sync failures mark the projection `degraded` with a stale/readable reason while preserving the last accepted cursor and keeping the projection retryable; successful authority sync clears degraded state back to `active`; fork/seq/hash protection remains terminal `read_only` and cannot be overwritten by degraded markers.
- 2026-07-05: Added typed lifecycle command payloads and Authority-side ActorRef ingest for lifecycle proposals. `GroupMemberJoinCommandPayload`, `GroupMemberRemoveCommandPayload`, and `GroupOwnerTransferCommandPayload` now carry target `FederatedActorRef` data inside the signed proposal payload; Authority decodes the matching payload by command type inside the commit transaction, indexes the target ActorRef without storing raw command bytes in the committed event payload, and includes newly learned remote Home Stations in federation fan-out targets.
- 2026-07-05: Added a relay-mediated 3-Station acceptance harness for the Foundation Profile. The harness uses the production relay proposal/event transports over an HTTP relay-forward test server, keeps relay bearer auth separate from target peer JWT auth, and verifies Bob@StationB proposal outbox -> Alice@StationA authority commit -> authority federation outbox -> Bob@StationB and Carol@StationC follower cursor advancement. This also fixed a real authority identity bug: federated proposal commits now persist the proposal authority Station ID instead of the local default `local`, so follower cursors are keyed by the correct authority.
- Verified by `GOWORK=off go test ./subserver/group_chat/...` from `apps/station/app`, including route-level tests that mint real federation peer JWTs, verify scope/audience, pin remote Station keys through TOFU, reject mismatched proposal/event/sync claims, reject signed proposals from non-members, replay duplicate proposals without appending a second event, prove proposal acceptance creates pending federation outbox items for every known remote member Home Station without duplicating on replay, prove follower cursor advancement, prove follower committed event replay is idempotent, prove public DB fork protection persists `read_only`, prove proposal outbox enqueue is durable/idempotent/conflict-closed without leaking raw command bytes, prove proposal outbox retry/accepted queue semantics, prove actor-side dispatcher submission through the authority handler, prove authority-side event dispatcher submission through the follower apply handler, prove federation outbox applied status after follower acceptance, prove authority event sync returns ordered windows after cursor, prove follower sync pulls from the authority handler and advances the local cursor through apply, prove follower apply publishes a `GroupFederationEvent` to local member SSE streams, prove authority sync failure marks a retryable `degraded` projection, prove authority recovery restores `active`, prove `read_only` is not overwritten by degraded markers, prove lifecycle member-join ActorRef ingest creates a remote member index and adds that Home Station to fan-out, prove relay proposal/event transports separate relay bearer auth from target peer auth, and prove relay-mediated Bob@B -> Alice@A -> Carol@C 3-Station acceptance.
- Relay transport verified by `go test ./apps/station/frame/core/plugin/native/subserver/relay-client/... ./apps/station/frame/core/plugin/native/federation/...` and `cd apps/station && go test ./frame/core/plugin/native/subserver/relay-client/... ./frame/core/plugin/native/federation/...`, including loopback tests that prove `X-Peers-Forward-Authorization` is promoted to local `Authorization` and stripped before the forwarded request reaches the local handler.
- Additional gates: `GOWORK=off go test ./subserver/relay-client/... ./federation/...` from `apps/station/frame/core/plugin/native`, `pnpm --dir apps/desktop test -- --run src/services/eventStream.test.ts src/services/socialRealtime.test.ts`, `pnpm --dir apps/desktop prebuild:check`, and `git diff --check` passed. The read-before-edit presence invariant scan is not clean because pre-existing active code still contains generated `OnlineRequest`/`OnlineResponse` and mobile `participant*_online` normalizer references; this Phase D work does not add presence ownership.
- Still open in Phase D: external live multi-Station acceptance on real deployed Station runtimes, if required before entering Phase E.

### Phase E: Cross-Station Sender Key Delivery

Goal:

- Preserve E2EE while crossing Stations.

Deliverables:

- epoch-bound SKDM envelope;
- per-recipient/per-device routing;
- pending SKDM retry queue;
- receiver validation of federation/group/epoch/recipient;
- UI states for waiting key vs before-join/not-entitled.

Acceptance:

- remote member decrypts post-join messages;
- remote late join cannot decrypt pre-join messages;
- removed member receives no new SKDM and cannot decrypt new messages;
- Station logs/DB contain no plaintext or Sender Key material.

Implementation progress:

- 2026-07-05: Added the Foundation Profile Station-visible `GroupSkdmEnvelope` proto contract and `/group-chat/skdm/submit` route. The envelope is epoch-bound, targets one recipient device and recipient Home Station, carries only an already sealed `encrypted_payload`, and returns durable outbox identity plus idempotent replay state.
- 2026-07-05: Added Station-side opaque SKDM outbox persistence (`group_chat_skdm_outbox`) and in-memory parity. Enqueue is idempotent for identical routing/encrypted payload inputs and conflict-closed when the same idempotency key is reused for different routing payload.
- 2026-07-05: Added application validation for SKDM enqueue: required routing fields, sender membership, recipient membership, recipient Home Station match when known, current membership epoch, and raw `SenderKeyDistributionMessage.chain_key` rejection before repository persistence. This keeps Sender Key generation/encryption device-owned and prevents Station from storing raw Sender Key material.
- 2026-07-05: Added SKDM pending/retry/delivered queue semantics and a dedicated federation delivery path. Source Stations dispatch due opaque SKDM envelopes through relay-forward to `/group-chat/skdm/deliver`, using a peer-JWT scope (`group-chat-skdm-deliver`) whose claims bind group, sender, idempotency key, recipient DID, recipient device, and target audience. Target Stations accept the envelope into their opaque SKDM outbox only after the federation claims and application-level group/epoch/recipient checks pass. Source outbox rows move to `delivered` only after the target returns a delivery receipt.
- 2026-07-05: Added Desktop submission of sealed per-device SKDM envelopes to Station. `GroupMember` projections now carry actor Home Station routing metadata, `socialChat` passes membership epoch/member routing data into `ensureSkdmDistributed`, Desktop/Tauri/browser gateway expose `group_chat_submit_skdm_envelope`, and `groupSenderKeys` submits the sealed payload to Station when routing metadata exists while keeping the existing friend-chat type=50 carrier as the transitional delivery path.
- 2026-07-05: Added target Station to recipient-device realtime delivery for federated SKDM envelopes. The canonical realtime event stream now has a `GroupSkdmEnvelopeDelivered` oneof carrying only routing metadata plus opaque sealed payload; Station `EventBus` supports `PublishToDevice` so live fan-out and cursor replay are restricted to `recipient_device_id`; target `/group-chat/skdm/deliver` publishes the envelope to that device and marks the target outbox row delivered after successful bus publish. Desktop decodes the event, verifies local actor/device, and hands the sealed payload to the existing `handleInboundSkdm` local crypto install path.
- 2026-07-05: Added receiver-side SKDM install validation before local crypto consumption. Desktop opens the sealed payload, parses the inner `SenderKeyDistributionMessage`, rejects malformed payloads and group/sender/key mismatches, and only then calls `cryptoGroupSkConsumeSkdm`. This prevents a federated delivery envelope from installing a Sender Key for a different group or sender.
- 2026-07-05: Added Desktop group decrypt state distinction for missing Sender Keys. Missing SKDM now remains `[Waiting for sender key…]` only when membership projection is absent or the viewer is entitled to receive the key; pre-join ciphertext renders `[Message sent before you joined]`; a loaded membership projection without the viewer renders `[Not entitled to this group message]`. Search indexing excludes all placeholder states, and redecrypt retry only targets waiting/decrypt-failed rows.
- 2026-07-05: Added a repeatable Phase E cross-Station SKDM acceptance harness (`TestCrossStationSkdmAcceptanceEntitlementAndOpaqueDelivery`). It drives source Station SKDM outbox dispatch into target Station `/group-chat/skdm/deliver`, then verifies device-target realtime delivery for a post-join remote member, blocks pre-join recipient delivery, blocks stale-epoch delivery after late join, rejects raw `SenderKeyDistributionMessage.chain_key`, and blocks delivery to a removed member.
- 2026-07-05: Hardened home-profile Desktop Web runtime startup for live acceptance. `make desktop-web` now uses `station-check` instead of remote deploy when `PT_STATION_MODE=remote` and `PT_STATION_DEPLOY_ENV` is empty, and `dev-desktop-web.sh` now honors profile-provided `PT_PROFILE`/`GATEWAY_PORT` and refuses to fallback-start a local Station when `PEERS_STATION_MODE=remote`.
- 2026-07-05: Added stable Desktop chat conversation DOM anchors (`data-chat-session-ulid`, `data-chat-group-ulid`) so browser acceptance can prove the rendered conversation row instead of relying on text-only page state.
- 2026-07-05: Added two-Desktop browser group Sender Key acceptance (`desktop_dom_group_sender_key_visible.py`). The gate logs actor A and actor B into independent Desktop Web gateways, creates a group from Desktop A, sends a Sender-Key-encrypted group message, syncs the hidden friend-chat SKDM carrier on Desktop B, syncs group history, and proves Desktop B renders the decrypted group message in the browser DOM.
- 2026-07-05: Added a federation browser prerequisite gate (`federated_browser_prereq.py`) for the remaining true multi-Station browser acceptance. It validates that authority/follower Station URLs are distinct and healthy, Relay URL is configured and healthy, Station peer IDs are supplied for relay-forward routing, and optional Desktop gateways point at the expected Stations. The gate intentionally fails fast when the active profile is single-Station or Relay-less, so missing infrastructure is not reported as an IM protocol failure.
- Verified by `./model/build.sh`, `GOWORK=off go test ./subserver/events ./subserver/group_chat/...` from `apps/station/app`, focused `GOWORK=off go test ./subserver/events ./subserver/group_chat -run 'Test(PublishToDevice|DeliverGroupSkdmEnvelopePublishes|RelayGroupSkdm|DispatchGroupSkdm|HandleSubmitGroupSkdm|SubmitGroupSkdm)' -count=1`, focused `GOWORK=off go test ./subserver/group_chat -run 'TestCrossStationSkdmAcceptanceEntitlementAndOpaqueDelivery' -count=1`, `pnpm --dir apps/desktop prebuild:check`, `pnpm --dir apps/desktop exec vitest run src/services/eventStream.test.ts src/services/socialRealtime.test.ts src/modules/identity/groupSenderKeys.test.ts`, `pnpm --dir apps/desktop exec vitest run src/modules/identity/groupSenderKeys.test.ts src/services/socialRealtime.test.ts src/store/socialChatDecryptState.test.ts`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `bash -n tooling/scripts/local-dev/desktop-dev.sh tooling/scripts/dev-desktop-web.sh`, `make station-check` against the active `home` profile, and `git diff --check`.
- Home-profile runtime evidence: two low-level Desktop Vite/Tauri gateway pairs were started against `http://10.0.0.10:18080` without local Station startup (`3311/3131` and `3312/3132`). `CHAT_DESKTOP_GATEWAY_URL=http://127.0.0.1:3131 CHAT_DESKTOP_GATEWAY_STATION_URL=http://10.0.0.10:18080 python3 tooling/acceptance/gates/chat/desktop_gateway_e2e.py` passed, and the same gateway gate passed for `3132`. `desktop_dom_message_visible.py` passed for both browser renderers: `3311/3131` wrote evidence under `/tmp/peers-touch-chat-desktop-dom/`, and `3312/3132` wrote evidence under `/tmp/peers-touch-chat-desktop-dom-b/`. `CHAT_DESKTOP_DOM_A_URL=http://127.0.0.1:3311/#/chat CHAT_DESKTOP_DOM_B_URL=http://127.0.0.1:3312/#/chat CHAT_DESKTOP_DOM_A_GATEWAY_URL=http://127.0.0.1:3131 CHAT_DESKTOP_DOM_B_GATEWAY_URL=http://127.0.0.1:3132 CHAT_DESKTOP_DOM_STATION_URL=http://10.0.0.10:18080 CHAT_DESKTOP_DOM_OUT_DIR=/tmp/peers-touch-chat-desktop-dom-group python3 tooling/acceptance/gates/chat/desktop_dom_group_sender_key_visible.py` passed and wrote evidence under `/tmp/peers-touch-chat-desktop-dom-group/`. This proves two Desktop Web runtimes can independently authenticate, sync, select chat/group rows, process the hidden SKDM carrier, and render a decrypted home-Station group message through the browser DOM; it is not yet a cross-Station SKDM decrypt proof. `python3 tooling/acceptance/gates/chat/federated_browser_prereq.py` currently fails under the active `home` profile because no follower Station is configured; when follower/peer IDs are supplied manually it fails at `CHAT_FEDERATION_RELAY_URL is required`, matching `home.env` where `PT_RELAY_URL=` and `PT_RELAY_HEALTH_URL=`.
- Verified SKDM federation dispatch specifically by `GOWORK=off go test ./subserver/group_chat -run 'Test(RelayGroupSkdm|DeliverGroupSkdm|DispatchGroupSkdm|EnqueueGroupSkdm)' -count=1` and `GOWORK=off go test ./subserver/group_chat/...` from `apps/station/app`.
- The read-before-edit presence invariant scan remains not clean because pre-existing active code still contains generated `OnlineRequest`/`OnlineResponse` and mobile `participant*_online` normalizer references. This Phase E slice does not add presence ownership.
- Still open in Phase E: true two-Desktop browser live acceptance proving remote member decrypts post-join messages, late join cannot decrypt pre-join messages, removed member receives no new SKDM/cannot decrypt new messages, and Station logs/DB contain no plaintext or Sender Key material. Current home-profile Relay settings are still empty, so real multi-Station browser acceptance remains unproven.

### Phase F: Foundation Pressure And Security Harness

Goal:

- Prove family Station quality with repeatable evidence.

Deliverables:

- local 100-person group stress harness;
- 3-Station federated group harness;
- private-chat concurrency harness;
- metrics output and threshold report;
- security negative tests.

Acceptance:

- 100-person local group, 10 active senders, 1000 messages;
- 3 Stations, about 100 total actors, 10 active senders, 1000 messages;
- inactive actor recovery after backlog;
- direct join, stale epoch, removed member, plaintext leakage checks pass;
- report attached to PR/release evidence.

Implementation progress:

- 2026-07-05: Added the repeatable Station-level group pressure and security gate (`tooling/acceptance/gates/chat/group_pressure_security.py`) and registered it as `chat-group-pressure-security` in `tooling/acceptance/gates.yaml`. The gate provisions a parameterized group, rejects plaintext sends, rejects stale membership epoch sends, rejects direct join without invitation, sends encrypted group messages from multiple active senders, verifies inactive actor backlog recovery by paginating `/group-chat/messages`, rejects removed-member sends, and checks listed rows do not expose plaintext `content` while carrying `encrypted_payload`.
- 2026-07-05: Fixed a pressure-discovered group message recovery defect. Group message IDs now use a monotonic same-prefix timestamp sequence instead of raw `UnixNano`, avoiding high-throughput `gcm-*` collisions; `/group-chat/messages` DB pagination now orders by `ulid DESC`, matching the `ulid < before_ulid` cursor predicate; the handler trims the `limit+1` probe item from the correct side for backward pagination while preserving `since:` forward-sync semantics.
- Verified by focused regression `GOWORK=off go test ./subserver/group_chat -run 'TestHandleGetMessagesNextCursorDoesNotRepeatPage' -count=1` and related Station tests `GOWORK=off go test ./subserver/events ./subserver/group_chat/...` from `apps/station/app`.
- Home-profile full Foundation evidence: after hot-replacing the home Station binary without deleting data, `CHAT_GROUP_PRESSURE_STATION_URL=http://10.0.0.10:18080 CHAT_GROUP_PRESSURE_ACTORS=100 CHAT_GROUP_PRESSURE_SENDERS=10 CHAT_GROUP_PRESSURE_MESSAGES=1000 CHAT_GROUP_PRESSURE_OUT_DIR=/tmp/peers-touch-chat-group-pressure-full python3 tooling/acceptance/gates/chat/group_pressure_security.py` passed. Evidence report `/tmp/peers-touch-chat-group-pressure-full/group_pressure_security_report.json` records group `gcg-1783199717561813891`, `messages_seen=1000`, `pages=10`, inactive recovery `210.21ms`, send latency `p50=30.20ms`, `p95=35.30ms`, `max=97.92ms`, and security results: plaintext rejected `400`, stale epoch rejected `409`, direct join rejected `400`, removed-member send rejected `403`.
- 2026-07-05: Added the repeatable Station-level private-chat pressure and security gate (`tooling/acceptance/gates/chat/private_pressure_security.py`) and registered it as `chat-private-pressure-security` in `tooling/acceptance/gates.yaml`. The gate provisions paired actors/sessions, sends valid `EncryptedMessage` payloads concurrently with client ULID idempotency, verifies per-session persisted recovery, verifies read acknowledgement progress, rejects non-participant sends, rejects invalid receivers, rejects blocked-user sends, and checks returned content does not leak the gate plaintext while `encrypted_payload` is present.
- Home-profile full private-chat Foundation evidence: `CHAT_PRIVATE_PRESSURE_STATION_URL=http://10.0.0.10:18080 CHAT_PRIVATE_PRESSURE_ACTORS=100 CHAT_PRIVATE_PRESSURE_MESSAGES=1000 CHAT_PRIVATE_PRESSURE_WORKERS=16 CHAT_PRIVATE_PRESSURE_OUT_DIR=/tmp/peers-touch-chat-private-pressure-full python3 tooling/acceptance/gates/chat/private_pressure_security.py` passed. Evidence report `/tmp/peers-touch-chat-private-pressure-full/private_pressure_security_report.json` records `session_count=50`, `messages_seen=1000`, `pages=50`, recovery `844.06ms`, `read_acknowledgements=500`, send latency `p50=23.02ms`, `p95=35.22ms`, `max=48.02ms`, and security results: non-participant send rejected `403`, invalid receiver rejected `403`, blocked send rejected `403`.
- 2026-07-05: Added the relay-mediated 3-Station federated group proposal pressure harness (`TestRelayMediatedThreeStationProposalPressureAcceptance`) and registered it as `chat-federated-group-pressure` in `tooling/acceptance/gates.yaml`. The harness uses an in-process Relay forwarder plus real proposal/event transports and peer-JWT wrappers to exercise Station B/C proposal outboxes, Authority Station A proposal acceptance, Authority fanout, and follower event apply. Evidence: `cd apps/station/app && GOWORK=off go test ./subserver/group_chat -run TestRelayMediatedThreeStationProposalPressureAcceptance -count=1 -v` passed with `actors=100`, `active_senders=10`, `proposals=1000`, `fanout_deliveries=2000`, `enqueue_ms=1`, `proposal_dispatch_ms=478`, `fanout_ms=436`.
- 2026-07-05: Attached Phase F metrics and threshold evidence bundle at `docs/context/implementation-reports/FEDERATED_IM_FOUNDATION_PHASE_F_EVIDENCE.zh.md`.
- 2026-07-05: Attached PR/release evidence handoff at `docs/context/implementation-reports/FEDERATED_IM_FOUNDATION_PR_EVIDENCE.zh.md`, including standard `make quality-evidence REVIEW_RANGE=origin/master...HEAD`, deterministic gate results, Phase F metrics links, unproven scope, and final-review boundary.
- Still open in Phase F: run a live deployed 3-Station browser/runtime pressure pass when `home` has Relay/follower Station configuration. Final PR-range quality evidence has been rerun and PR #39 checks for `pr-title`, `pr-description`, `commitlint`, `review-framework`, and `pr-build` passed on head `7a4bace8`. The current `home` profile still lacks Relay/follower Station configuration, so the live deployed 3-Station target remains infrastructure-blocked; the relay-mediated harness proves the Foundation federation protocol path but does not claim real home Relay/Desktop runtime coverage.

## 6. Dependency Order

```text
Phase A
  -> Phase B
      -> Phase C
          -> Phase D
              -> Phase E
                  -> Phase F
```

Rationale:

- Federation must not expand an insecure local group lifecycle.
- Epoch must exist before federated event log and SKDM routing can be correct.
- Delivery must exist before federated E2EE can be proven end to end.
- Pressure tests are meaningful only after correctness gates exist.

## 7. Impact Surface

| Layer | Impact |
| --- | --- |
| `model/domain/chat/` | group status, epoch, invitation, message metadata |
| `model/domain/federation/` | proposal/event delivery contracts |
| `model/domain/realtime/` | lifecycle event fields and resync causes |
| `apps/station/app/subserver/group_chat/` | lifecycle enforcement, soft dissolve, event log |
| `apps/station/frame/touch/federation/` | delivery outbox/receiver integration |
| `apps/desktop/src/store/socialChat.ts` | epoch retry, projection states, SKDM handling |
| `apps/desktop/src/components/chat/` | read-only/degraded/not-entitled UI states |
| quality harness | pressure/security reports |
| docs | lifecycle, federated IM, operations/runbook updates |

## 8. Evaluation System

Positive metrics:

- send latency P50/P95 for local and remote group sends;
- fan-out latency P95;
- resync recovery duration;
- SKDM delivery success rate;
- decrypt success rate for entitled messages;
- zero duplicate visible messages after replay.

Negative metrics:

- illegal join accepted;
- plaintext persisted or logged;
- removed member decrypts post-remove message;
- stale epoch accepted;
- follower accepts forked hash;
- authority-down follower accepts writes;
- unbounded retry queue growth.

## 9. Three-Round Plan Self Review

### Round 1 — Feasibility Review

Finding:

- A plan that starts with federated delivery would multiply existing local lifecycle gaps.

Adjustment:

- Phase A closes local security/history gaps first, then Phase B adds epoch. Federation starts only after those bases exist.

### Round 2 — Completeness Review

Finding:

- Initial plan did not include pressure evidence as a first-class deliverable.

Adjustment:

- Phase F defines concrete family-scale targets and negative security gates. Metrics are part of completion, not optional follow-up.

### Round 3 — Scope Review

Finding:

- Authority handover and consensus recovery are important but would block the Foundation Profile if implemented immediately.

Adjustment:

- The plan documents read-only degradation now and reserves signed handover/quorum recovery for a later profile. This keeps the first deployable capability coherent.

## 10. Immediate Start

Start with Phase A:

1. Fix private `JoinGroup` to require valid invitation unless group policy explicitly allows public open join.
2. Enforce invitation pending/single-use/expiry.
3. Convert dissolve from hard delete to read-only archive.
4. Add Station tests for the security and history contracts.
