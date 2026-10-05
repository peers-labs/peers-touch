# Secure Content Social Object Transfer Amendment - Review Prompt

> **Status**: review passed; Owner accepted
> **Version**: v1.0
> **Created**: 2026-09-14 | **Updated**: 2026-09-14
> **Owner**: Architecture Team

---

Review proposed `SC-D18` and `SC-D19` in:

- `docs/architecture/shared/security/secure-content/decisions.md`
- `docs/architecture/shared/security/secure-content/data-model.md`
- `docs/architecture/shared/security/secure-content/design.md`
- `docs/architecture/shared/security/secure-content/integration.md`
- `docs/architecture/shared/security/secure-content/security.md`
- `docs/architecture/shared/security/secure-content/execution-plans/20260913-secure-content-hard-cut/plan.md`

## Context

W6 implemented the accepted FRIENDS text/Comment prepare-submit, durable UOW,
Key Exchange revalidation and viewer-scoped read contracts. IMAGE closure
reached an architecture gap: the architecture declares six Social object routes
and the object state machine, while the generated proto contains only upload
spec and descriptor messages. Implementing handlers now would require an
unversioned local wire or misuse of Conversation/public OSS authority.

Independent source review also found that the existing Federation key store
retains only the previous private key for a short token grace window. That
cannot verify a durable commit proof when a new device performs never-opened
recovery after later Station key rotation.

## Review Questions

1. Are the proposed typed begin/status/complete/cancel/get control messages
   sufficient and domain-neutral without creating a stateful Secure Content
   service?
2. Does the raw chunk PUT contract bind generation, index, offset, size, hash,
   idempotency and exact body bytes while preserving bounded streaming?
3. Can begin replay recover after restart without creating another upload or
   reinterpreting the prepared Social plan?
4. Does complete verify every part and whole-object commitments before
   `COMPLETE_UNATTACHED`, with exact replay and terminal corruption semantics?
5. Does the existing Social Post/Comment outer UOW remain the only authority
   that may attach objects and create grants?
6. Does object GET recheck current Social resource authorization and exact
   endpoint grant, returning one not-found shape for missing/unauthorized IDs?
7. Are generic `storage.Backend`, Conversation attachments and public OSS kept
   outside Social business authority?
8. Are timeout, size, chunk-count, retry, cancellation, storage failure,
   partial-byte cleanup, range and GC semantics explicit enough to implement?
9. Do the upload-row identities and command hashes provide database-backed
   exact replay without a second command-receipt authority?
10. Does the proposal avoid exposing plaintext metadata, object keys, base
    nonces, another principal's grants or caller-controlled `storage_ref`?
11. Does `SC-D19` keep historical public-key truth in Federation authentication
    while preventing Social or its compromised database from inventing trust?
12. Can a newly recovered client anchor one bounded attestation to the current
    Station profile key, then verify an old content proof without an unbounded
    key chain or retained old private key?
13. Are key rotation, archive-before-retire, attestation expiry, missing-key
    failure and exact command replay semantics complete?

## Required Output

```text
Verdict: PASS | HOLD

Findings:
- severity
- exact source reference
- violated invariant or missing semantic
- required correction

Decision checks:
- typed control plane: PASS | HOLD
- raw-byte data plane: PASS | HOLD
- Social outer-UOW authority: PASS | HOLD
- authorization and storage boundary: PASS | HOLD
- durable Station proof verification: PASS | HOLD
```

A `PASS` means `SC-D18` and `SC-D19` are internally consistent and sufficient
for Owner acceptance. It does not approve implementation or claim W6
functional or Acceptance proof.

## Outcome

- Independent consistency audit: `HOLD`; all eight findings were corrected
  (chunk size header, object GET mapping, durable part idempotency, cleanup FSM,
  recovered-device authorization, descriptor commitment input, decision
  ordering, and W6/W8 scope).
- Independent architecture review: `HOLD`; its five findings were corrected
  (PREPARED-only first admission, generation/bitmap encoding, durable
  storage-operation leases and tombstones, bounded GET metadata, and decision
  ordering).
- Follow-up review covering `SC-D18` and `SC-D19`: `PASS`
- Owner acceptance: `ACCEPTED` on 2026-09-14.
- Execution state: W6 object-plane and durable proof-key implementation resumed;
  completed text/Comment/UOW source remains intact.
