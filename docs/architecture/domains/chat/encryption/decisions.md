# Chat Encryption - Decisions

> **Status**: active
> **Version**: 1.1.0
> **Created**: 2026-08-08 | **Updated**: 2026-09-26
> **Owner**: Architecture Team

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| CE-01 | Endpoint-pair crypto identity | accepted |
| CE-02 | One authority event with per-device ciphertexts | accepted |
| CE-03 | Atomic ratchet and outbox persistence | accepted |
| CE-04 | Device-targeted durable DKX | accepted |
| CE-05 | Recovery restores history, not device sessions | accepted |
| CE-06 | One crypto runtime and hard deletion of the old path | accepted |
| CE-07 | Fail closed on incomplete device fan-out | accepted |

## CE-01: Endpoint-Pair Crypto Identity

**Status**: accepted

Direct sessions are keyed by both local and peer `(PTID, device_id)` endpoints,
plus conversation and generation.

PTID-only and conversation-only alternatives were rejected because they cannot
distinguish multiple devices or pre-key ownership.

## CE-02: One Authority Event With Per-Device Ciphertexts

**Status**: accepted

A direct message is one authority-ordered event containing repeated
device-targeted encrypted payloads. Separate authority events per device were
rejected because they fragment message identity, ordering, edits, and receipts.

Consequence: Station sees target device IDs and ciphertext sizes, but never
plaintext.

## CE-03: Atomic Ratchet and Outbox Persistence

**Status**: accepted

Rust persists advanced ratchets and the exact outbound command in one SQLCipher
transaction before network submission. Retry reuses the stored bytes.

Best-effort network send after ratchet mutation was rejected because a crash can
permanently desynchronize sessions.

## CE-04: Device-Targeted Durable DKX

**Status**: accepted

DKX requires sender and recipient device IDs. Blank recipient device IDs are
invalid and never fall back to actor broadcast.

Actor-wide DKX was rejected because an SPK/OPK belongs to one device.

## CE-05: Recovery Restores History, Not Device Sessions

**Status**: accepted

Backup restores actor identity, encrypted history, attachment keys, and trust
metadata. A new installation keeps the fresh device identity established for
its authenticated session. An in-place restore preserves the currently
authenticated device identity and transfers only that endpoint's enrollment,
public-material private counterparts, queue cursor/dedup state, authority
heads, and MLS bootstrap inventory directly between its local SQLCipher
databases. This continuity state never enters the portable archive or crosses
devices. Both paths establish fresh Direct and MLS conversation sessions.

Transferring ratchet or MLS live state was rejected because it breaks
device isolation and complicates compromise recovery.

## CE-06: One Crypto Runtime

**Status**: accepted

`cryptoRuntime` is the only frontend crypto orchestrator. Rust is the only key
and ratchet owner. `socialChat` consumes crypto results but does not establish
sessions directly.

The existing conversation-keyed commands and duplicate runtime path are deleted
in the same cutover.

## CE-07: Fail Closed on Incomplete Fan-Out

**Status**: accepted

Direct send requires ready sessions for every active recipient device and every
other active sender device. Partial delivery is rejected.

This prioritizes consistent multi-device history and explicit failure over
silent loss. Device revocation immediately removes the device from the required
target set.
