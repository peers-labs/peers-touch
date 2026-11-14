# Recovery Identity Resilience Amendment Review

> **Status**: active
> **Version**: v1.1 (re-review of proposed v2 after v1 CHANGES_REQUIRED)
> **Created**: 2026-11-05 | **Updated**: 2026-11-05
> **Owner**: Architecture Team

## Review Target

- Amendment:
  `docs/architecture/shared/security/secure-content/recovery-identity-resilience-amendment.md`
  (proposed v2)
- Proposed decisions: `SC-D31`, `SC-D32`, `SC-D33` appended to
  `docs/architecture/shared/security/secure-content/decisions.md`
- Governing sources that must remain intact:
  - `design.md`, `security.md`, `data-model.md`, `integration.md`
  - accepted `SC-D15`, `SC-D16`, `SC-D17`, `SC-D20`, `SC-D21`, `SC-D27`,
    `SC-D28`, `SC-D29`, `SC-D30`
  - Identity domain: `docs/architecture/domains/identity/`

## v1 Findings That Must Be Closed

- B1: remote blocking attribution leaked server-expanded audience membership
  and per-actor inventory. v2 introduces an enumerability-scoped projection
  (self exact / client-supplied targets actor+kind / server-expanded and
  federated kind+count). Verify the rule is sound, implementable from the
  Social-constructed principal list, and that the federated shard limitation
  is honestly reflected; check RG-6 negative assertions are sufficient.
- B2: content phrase alone did not restore Actor Identity. v2 adds the
  phrase-rooted Identity Recovery Vault (D-OWN-1). Verify the
  login → vault → seed → self cross-sign enrollment sequence against current
  session/enrollment contracts (what session class authenticates
  pre-enrollment vault GET; whether self cross-signing a NEW device
  certificate under restored identity key is accepted by existing
  enrollment validation; profile/activation sequence handling).
- M1: verify the four-layer error change surface is complete and the
  claim-principal retention does not leak into public Key Exchange routes.
- M2: verify the archive restore rewiring (vault restore first, READY
  current epoch, archive no longer identity authority) and RG-7.
- M3: verify rotation semantics (wrapped master chain, multi-device
  outdated state, in-flight SC-D17 stale mapping, pre-rotation secrecy
  statement).
- M4 + RG-8: verify BOTH random acceptance generators (Mobile prepare-keys,
  Desktop acceptance create-revision) are covered by the deletion contract.
- Minors m1-m5: proto ownership (no structured identity in `details` maps;
  generated Actor types for Tauri payloads), profile-version derivation,
  READY-after-publication ordering, Mobile Web phrase display bounded
  exception, H1 expecting 30206.

## Additional v2 Questions

1. Is the new identity-recovery KDF domain separation consistent with
   SC-D16, and is the vault plaintext/wrapping design free of key-reuse or
   downgrade paths (sealing_key_id, version/epoch monotonicity, replay of an
   older vault blob)?
2. Phrase compromise is now account-class: are vault endpoint auth, rate
   limiting, absence of a Station wrong-guess oracle, and the rotate+revoke
   response adequate for security review?
3. Does the vault belong contractually in Actor Identity (cross-module doc
   merge path identified) without making Key Exchange or Station a content
   plaintext party?
4. Does anything in v2 silently define the excluded Mobile first-run
   onboarding product Journey?

## Verdict

Return `DESIGN_REVIEW_PASS`, `DESIGN_REVIEW_CONDITIONAL`, or
`DESIGN_REVIEW_CHANGES_REQUIRED` with source-backed findings. Each finding
must cite file/line evidence and name the affected SC-D decision and
property.
