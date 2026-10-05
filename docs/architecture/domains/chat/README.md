# Chat Domain

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-05 | **Updated**: 2026-10-05
> **Owner**: Chat Product Team

---

## 1. Document Scope

This directory groups the current Chat product contract, Conversation
authority, device delivery, local storage, encryption, calling, and search
architecture. It does not own generic Federation transport, identity, or
cross-domain Secure Content.

## 2. Architecture Map

| Concern | Entry | Owner |
|---|---|---|
| End-to-end product lifecycle | [lifecycle/](./lifecycle/README.md) | Chat Product |
| Conversation and device delivery | [messaging/](./messaging/README.md) | Messaging Platform |
| Device-local storage governance | [storage-governance/](./storage-governance/README.md) | Device Messaging Engine |
| Direct and group encryption | [encryption/](./encryption/README.md) | Chat cryptographic runtime |
| Voice and video calls | [calling/](./calling/README.md) | Conversation / Events / clients |
| Message search | [message-search.md](./message-search.md) | Device-local Chat projection |

## 3. Historical Sources

[Federated IM](../../../context/architecture/chat/federated-im/README.md) is a
superseded historical source. Current code and review must use Chat Lifecycle,
Messaging Platform, and API Governance.
