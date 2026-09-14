# Secure Content PreKey Authenticity Amendment - Review Prompt

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-09-14 | **Updated**: 2026-09-14
> **Owner**: Architecture Team

---

Review proposed decision `SC-D15` before W3 implementation resumes.

## Upstream Sources

- `docs/architecture/secure-content/design.md`
- `docs/architecture/secure-content/security.md`
- `docs/architecture/secure-content/data-model.md`
- `docs/architecture/secure-content/decisions.md`
- `docs/architecture/identity/unified-actor-system.md`
- `docs/knowledge/invariants/actor-identity-boundary.md`
- `model/domain/actor/actor.proto`
- `model/domain/secure_content/prekey.proto`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut.md`

## Verified Gap

`ContentOneTimePreKey.issuer_signature` exists in the accepted wire contract,
but no accepted source defines:

1. the exact signed bytes;
2. the verified public-key owner;
3. the authority that advances an actor-recovery pool epoch.

The W3 draft currently validates only signature shape. Independent review
correctly treats that as insufficient before irreversible recovery-key claims
can be enabled.

## Proposed Decision

1. Add a dedicated proto-first `ContentPreKeySigningInput` that binds format
   version, kind, key ID, X25519 public key, exact principal, new pool epoch,
   expected prior pool epoch, publisher `ActorDeviceRef`, publisher signing-key
   ID, and publisher profile version.
2. Sign the exact bytes:

   ```text
   "peers-touch:secure-content:prekey:v1\0"
   || canonical(ContentPreKeySigningInput)
   ```

3. Key Exchange resolves and verifies the signer through the Actor Identity
   capability. The mutation transaction invokes an Actor Identity-owned helper
   that locks the exact device row and compares active status, signing-key ID,
   public key, and profile version against that verified snapshot through
   commit.
4. Endpoint prekey epoch equals the current Actor Identity profile version.
5. Recovery pool rotation is compare-and-swap: `0 -> 1`, `N -> N`, or
   `N -> N+1`; stale expected epochs and jumps fail before mutation.
6. New claims revalidate persisted signed material and publisher eligibility.
   Revoked/stale publishers cannot contribute unclaimed keys; completed claim
   receipts remain exactly replayable.
7. Recovery-key derivation from the 24-word secret remains Native-owned and is
   not attested by Station.
8. Unknown fields at every nested protobuf level fail before semantic
   normalization. Any future raw-wire publication endpoint separately enforces
   canonical decode/re-encode equality.
9. No public `/secure-content/*` route, Station key escrow, or new business
   authority is introduced.

Required evidence includes cross-language signing vectors; wrong signer, key ID
and profile; recursive unknown fields; recovery epoch compare-and-swap and jump
rejection; claim-versus-revocation and rotation races; persisted key/signature
tampering; depletion/replenishment; consumed-key non-revival; and completed
receipt replay after issuer revocation.

## Review Questions

1. Does the dedicated domain-separated signing input prevent substitution,
   signer rebinding, stale-key use, and cross-protocol signature reuse?
2. Is the authenticated device signing key the correct verification authority
   for both endpoint and actor-recovery publication?
3. Is Key Exchange ownership of the compare-and-swap recovery-pool epoch
   consistent with Actor Identity owning device profile versions and Recovery
   owning phrase use?
4. Does the explicit non-claim about recovery-secret derivation preserve the
   threat model without implying Station verification it cannot perform?
5. Are exact replay, retirement, and consumed-key non-revival semantics
   sufficient for concurrent publication and claim?
6. Is claim-time signature and publisher-lifecycle revalidation sufficient for
   the compromised-Station-database threat without exposing signer identity in
   opaque recipient slots?

## Required Verdict

Return one of:

- `PASS`: accept `SC-D15` as written;
- `HOLD`: list exact defects and a concrete replacement contract;
- `REJECT`: identify the conflicting accepted architecture decision.

W3 implementation must remain uncommitted and incomplete until the Owner accepts
the final decision.
