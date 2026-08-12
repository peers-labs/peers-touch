# Chat Encryption

> **Status**: active
> **Version**: 1.0.0
> **Created**: 2026-08-08 | **Updated**: 2026-08-08
> **Owner**: Architecture Team
> **Module**: `model/domain/chat/`, `apps/station/app/subserver/{conversation,envelope,key_exchange}/`, `apps/desktop/`

---

## 1. Document Scope

This module defines:

- device-addressed end-to-end encryption for direct messages;
- MLS device-leaf encryption for groups;
- durable encrypted delivery, replay, and receipts;
- encrypted backup and deterministic history recovery;
- the single crypto runtime and persistence ownership model.

This module does not define:

- Chat layout and interaction details, which belong to `docs/client/chat/`;
- generic Station/Desktop boundaries;
- federation membership and Station authority selection.

## 2. Problem

Chat currently mixes conversation-keyed ratchet sessions, device key bundles,
actor-wide DKX delivery, and disconnected tuple-aware code. This allows a
handshake created for one device key to reach another device, causing
`signed pre-key is unavailable or has rotated`, blocked sends, and undecryptable
messages.

The target platform has one rule: every cryptographic operation is addressed by
an endpoint pair `(PTID, device_id)`. Station may order and route encrypted data,
but it never owns plaintext or private keys.

## 3. Design Goals

1. New messages work bidirectionally without startup-order assumptions.
2. Every active recipient device gets independently encrypted content.
3. Reinstall and new-device history recovery are deterministic with a 24-word
   recovery phrase.
4. Direct sessions use X3DH plus Double Ratchet; groups use RFC 9420 MLS.
5. Delivery is durable through device inboxes and idempotent replay.
6. Exactly one runtime, one wire model, and one persistence model own crypto.

## 4. Navigation

| Document | Purpose |
|---|---|
| [design.md](./design.md) | Ownership, topology, contracts, and failure semantics |
| [decisions.md](./decisions.md) | Accepted architecture decisions |
| [data-model.md](./data-model.md) | Wire types, state machines, and persistence keys |
| [integration.md](./integration.md) | Current-to-target cutover and deletion obligations |
| [execution plan](./execution-plans/20260808-modern-im-platform.md) | Dependency-ordered implementation and evidence |
