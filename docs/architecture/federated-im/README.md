# Federated IM Architecture

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-04 | **Updated**: 2026-07-04
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/group_chat/`, `apps/station/frame/touch/federation/`, `model/domain/chat/`, `model/domain/federation/`, `model/domain/realtime/`, `apps/desktop/src/store/socialChat.ts`

---

## 1. Document Scope

This document set defines:

- the architecture for high-quality Peers-Touch IM across Home Station and Federation boundaries;
- how local Station group truth, Federation governance, cross-Station delivery, E2EE Sender Keys, and client projections compose;
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
- how group messages are ordered without putting every message into Federation Ledger;
- how Sender Keys are distributed across Stations without exposing keys to any Station;
- how a family-scale Station can prove quality with 100-person group and private-chat stress tests.

## 3. Design Goals

1. Support local and federated IM through one conceptual architecture.
2. Keep Federation Ledger focused on governance, not chat message traffic.
3. Give every federated group a clear authority Station and signed group event log.
4. Preserve E2EE: Station stores and routes ciphertext, never group message plaintext or Sender Key material.
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
| [execution-plans/20260704-foundation-federated-im.md](./execution-plans/20260704-foundation-federated-im.md) | Foundation Profile landing plan and verification |

## 5. Related Sources

| Source | Relationship |
| --- | --- |
| `docs/architecture/federation/README.md` | Federation entity, governance ledger, Station membership |
| `docs/architecture/social-runtime/group-lifecycle.md` | Local group lifecycle and current implementation gap review |
| `docs/architecture/encryption/group-sender-keys.md` | Group E2EE Sender Keys and SKDM distribution |
| `docs/architecture/realtime/event-stream.md` | Reliable event stream and recovery model |
| `docs/global/architecture.md` | Station/Model/Client ownership rule |
| `docs/global/first-principles.md` | Proto-first contracts and auth/security constraints |

