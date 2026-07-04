# Foundation Federated IM — Execution Plan

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-04 | **Updated**: 2026-07-04
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
