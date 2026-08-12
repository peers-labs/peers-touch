# Federated IM Architecture

> **Status**: draft
> **Version**: v0.4
> **Created**: 2026-07-04 | **Updated**: 2026-08-03
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/conversation/`, `apps/station/app/subserver/envelope/`, `apps/station/frame/touch/actor/`, `apps/station/frame/touch/federation/`, `model/domain/chat/`, `model/domain/federation/`, `apps/desktop/src/store/socialChat.ts`

> **v1 unification update (2026-07-11)**: Decisions D-08…D-12 (see `decisions.md`)
> set group E2EE to MLS (RFC 9420, D-06 superseded), one Station signaling-envelope
> channel (D-10), direct-chat X3DH + Double Ratchet (D-09), text-only-on-envelope
> with P2P for media (D-12), and a hard cutover wiping legacy chat data (D-11).
> Review source: [`proposals/20260711-im-unification-review.md`](./proposals/20260711-im-unification-review.md).
>
> **C-4/C-5 design amendment (2026-08-02)**: D-13 is accepted. It
> defines an authority-sequenced, transactional membership transition that binds
> business membership, `membership_epoch`, MLS epoch, opaque Commit delivery,
> and follower convergence. No implementation may claim C-4/C-5 until D-13 is
> implemented and its L3 gates pass.
>
> **Remote proposal trust amendment (2026-08-02)**: D-14 is accepted.
> Remote membership transitions use a conversation-owned signed proposal that
> wraps the canonical D-13 command, verifies a device actor signature against
> the Actor identity projection, and returns the canonical committed event.
> Legacy `GroupProposal`/`GroupEvent` is not a compatibility path.
>
> **Remote command unification amendment (2026-08-03)**: D-17 is accepted.
> It replaces the membership-only D-14
> wrapper with one actor-device-signed `ConversationCommandProposal` for every
> authority-committed remote command. Owner approval was recorded on
> 2026-08-03.

---

## 1. Document Scope

This document set defines:

- the architecture for high-quality Peers-Touch IM across Home Station and Federation boundaries;
- how local Station group truth, Federation governance, cross-Station delivery, MLS group E2EE, and client projections compose;
- the Foundation Profile for family-scale deployment: roughly 100-person groups, multi-device users, and private Station-to-Station federation;
- the boundary between low-frequency Federation governance and high-frequency IM business events.

This document set does not define:

- a full blockchain, public token system, proof-of-work, proof-of-stake, or global registry;
- cloud-scale million-member group operation;
- the exact UI visual treatment of chat surfaces;
- full consensus-backed group operation for every message.

## 2. Background And Problem

Peers-Touch IM must support both local Station chat and federated chat between actors hosted on different Stations.
The current group lifecycle source of truth defines local Station group behavior, and the Federation architecture defines Station membership and governance ledger behavior. The missing layer is the composition between them:

- who owns a federated group event log;
- how remote actors join and speak in a group;
- how remote authority commands are signed, retried, deduplicated, and
  committed without direct client-to-authority mutation;
- how group messages are ordered without putting every message into Federation Ledger;
- how MLS group key material (Welcome/Commit/KeyPackage) is delivered across Stations without exposing group secrets to any Station;
- how a family-scale Station can prove quality with 100-person group and private-chat stress tests.

## 3. Design Goals

1. Support local and federated IM through one conceptual architecture.
2. Keep Federation Ledger focused on governance, not chat message traffic.
3. Give every federated group a clear authority Station and signed group event log.
4. Preserve E2EE: Station stores and routes ciphertext, never group message plaintext or MLS group secrets.
5. Preserve decentralized ownership: each actor is hosted by a Home Station and represented by ActorRef in wire contracts.
6. Prefer low-latency authority sequencing for ordinary groups; reserve quorum recovery for authority loss and high-value groups.
7. Provide measurable family-scale quality: 100-person group, cross-Station delivery, inactive recovery, and security gates.
8. Keep downstream clients as projection renderers and local crypto executors, not business truth owners.

## 4. Document Navigation

| Document | Description |
| --- | --- |
| [design.md](./design.md) | Architecture, ownership, runtime units, trust boundaries, core flows |
| [data-model.md](./data-model.md) | Conceptual contracts, event log, ActorRef membership, epochs, delivery cursors |
| [decisions.md](./decisions.md) | ADR-lite decisions and alternatives |
| [integration.md](./integration.md) | D-17 evidence ledger, current-to-target cross-runtime mapping, failure semantics, and deletion boundary |
| [module-layout.md](./module-layout.md) | D-17 target ownership, module responsibilities, dependency direction, and forbidden duplication |
| [proposals/20260711-im-unification-review.md](./proposals/20260711-im-unification-review.md) | v1 IM unification review (approved decisions D-08…D-12) |
| [execution-plans/20260712-v1-im-execution-plan.md](./execution-plans/20260712-v1-im-execution-plan.md) | v1 IM dependency-ordered execution plan (P0…P7) |
| [execution-plans/20260802-d13-atomic-mls-membership-transition.md](./execution-plans/20260802-d13-atomic-mls-membership-transition.md) | D-13 atomic membership/MLS transition and three-Station C-4/C-5 closure plan |
| [execution-plans/20260803-d17-generic-conversation-command-proposal.md](./execution-plans/20260803-d17-generic-conversation-command-proposal.md) | Accepted D-17 generic remote command hard-cut and C6 remote-send closure plan |
| [execution-plans/20260731-debt-zero-dm-group.md](./execution-plans/20260731-debt-zero-dm-group.md) | Full-stack DM/group single-path cutover subplan; P3.0 strict decoding complete, awaiting parent Mobile/three-Station gates |
| [execution-plans/20260712-g0-mls-verification.md](./execution-plans/20260712-g0-mls-verification.md) | G0 MLS two-platform verification plan (unblocks D-08 / P3) |
| [execution-plans/20260729-signal-level-chat-modernization.md](./execution-plans/20260729-signal-level-chat-modernization.md) | Signal-level UX modernization (read receipts, media, reactions, calls) |
| [execution-plans/20260704-foundation-federated-im.md](./execution-plans/20260704-foundation-federated-im.md) | **Superseded (D-08…D-12).** Historical Sender Keys landing plan |

## 5. Related Sources

| Source | Relationship |
| --- | --- |
| `docs/architecture/federation/README.md` | Federation entity, governance ledger, Station membership |
| `docs/architecture/social-runtime/group-lifecycle.md` | Local group lifecycle and current implementation gap review |
| `docs/architecture/encryption/README.md` | Current device-addressed direct encryption, MLS, delivery, and recovery contract |
| `docs/architecture/realtime/event-stream.md` | Reliable event stream and recovery model |
| `docs/global/architecture.md` | Station/Model/Client ownership rule |
| `docs/global/first-principles.md` | Proto-first contracts and auth/security constraints |
