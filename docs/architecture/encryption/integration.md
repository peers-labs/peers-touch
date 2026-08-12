# Chat Encryption - Integration and Cutover

> **Status**: active
> **Version**: 1.0.0
> **Created**: 2026-08-08 | **Updated**: 2026-08-08
> **Owner**: Architecture Team

---

## 1. Scope

This cutover replaces the live direct-message crypto path across Model,
Station, Desktop Rust, Desktop Web, generated bindings, and native acceptance.
It does not preserve a runtime compatibility path.

## 2. Current Defects

| Defect | Evidence |
|---|---|
| Bundle is device-specific but DKX drops `device_id` | `socialChat.establishSession` and `SendDkxRequest` |
| Station broadcasts blank-device DKX to an actor | `handleDkxSend` and envelope fallback |
| Direct session is keyed by conversation | legacy Rust crypto commands |
| One ciphertext is committed for all devices | `SendMessageCommand.encrypted_payload` |
| Tuple-aware runtime is disconnected | `cryptoRuntime` is not the product owner |
| Ratchet mutation and submit are not atomic | send path encrypts before network command |
| Backup is local command scaffolding | no complete Station backup lifecycle |

## 3. Target Owners

| Concern | Target owner |
|---|---|
| Shared wire contracts | `model/domain/chat/` |
| Device registry/public bundles | Station `key_exchange` |
| Authority ordering | Station `conversation` |
| Durable device routing | Station `envelope` |
| Key, ratchet, MLS, outbox, backup codec | Desktop Rust crypto domain |
| Crypto lifecycle orchestration | Desktop `cryptoRuntime` |
| Message projection and UI | Desktop `socialChat` and Chat components |

## 4. Atomic Deletion Matrix

| Old path | Replacement | Deletion condition |
|---|---|---|
| `X3dhSessionInit` without endpoint tuples | `DirectSessionInit` | all generated bindings and handlers migrated |
| `SendDkxRequest` without device IDs | device-targeted request | Station rejects blank IDs |
| actor-wide DKX delivery | device inbox delivery | no DKX call site omits target device |
| singular direct `encrypted_payload` | repeated `device_payloads` | repository and projection read new field |
| conversation-keyed direct sessions | endpoint-pair session key | old commands/storage columns unused |
| `socialChat.establishSession` | `cryptoRuntime.ensurePeerSessions` | every caller migrated |
| `drEncrypt` / `drDecrypt` frontend calls | crypto runtime fan-out/decrypt | no live references |
| duplicate local backup commands | Station-backed backup service | restore journey passes |

## 5. Compatibility Policy

There is no dual runtime and no fallback encryption mode. Existing unreadable
ciphertext is not silently presented as recoverable. Before destructive local
reset, the product must either create a valid encrypted history backup or
explicitly block the reset.

Repository history is the only archive of deleted implementations.

## 6. Deployment Contract

Remote Station deployment must be built from a commit containing the exact
proto and Station implementation used by the clients. Acceptance records:

- Station commit;
- each client commit and workspace digest;
- generated-proto digest;
- profile, ports, storage roots, observer sockets, and device IDs.

Dirty Station changes cannot be claimed as deployed.
