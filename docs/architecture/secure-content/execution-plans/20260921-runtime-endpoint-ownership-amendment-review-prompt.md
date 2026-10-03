# Secure Content Runtime Endpoint Ownership Amendment Review

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-21 | **Updated**: 2026-09-21
> **Owner**: Architecture Team

---

## Review Scope

Review proposed `SC-D28` and its corresponding design/data-model changes:

- `docs/architecture/secure-content/decisions.md`
- `docs/architecture/secure-content/README.md`
- `docs/architecture/secure-content/data-model.md`

Verified failure:

- W7 source checkpoint `15c0a78583650b1b5470773cd84cb8c506edd9f6`
  validates the W12A schema attestation against the canonical profile endpoint,
  then publishes a Runtime Manifest v2 service containing only the ephemeral
  SSH tunnel endpoint.
- Manifest admission consequently recomputes
  `service_attestation_digest` from the wrong endpoint identity.

## Required Findings-First Checks

1. Confirm `endpoint` remains the sole live client/scenario/Harness connection
   route and continues matching the runtime service attestation artifact.
2. Confirm `schema_attestation_endpoint` is used only to reconstruct the
   canonical W12A service-attestation digest and is supplied by the runtime
   owner from the reviewed profile.
3. Confirm both fields are required, validated, and manifest-digest-bound with
   no inference, fallback, alias, or dual-reader compatibility path.
4. Confirm the incompatible closed service shape hard-cuts Runtime Manifest v2
   to v3 without a compatibility reader or ambiguous schema version.
5. Confirm the canonical digest projection substitutes
   `schema_attestation_endpoint` into only the attestation payload's
   `endpoint` member and excludes the live connection endpoint.
6. Confirm malformed live and canonical endpoints produce their documented
   owner-specific typed errors.
7. Confirm the proposal preserves one topology owner, exact-source admission,
   immutable W12A evidence, and fail-closed error semantics.
8. Confirm no product, Station API, reset schema, deployment profile, tunnel
   lifecycle, or formal Acceptance meaning changes.
9. Confirm the W12A source amendment requires fresh source freeze and fresh
   FOUR/FIVEARM activation before W7 resumes.

## Expected Review Output

Return findings ordered by severity with exact source references, followed by:

```text
DESIGN_REVIEW_PASS
```

or:

```text
DESIGN_REVIEW_HOLD
```

The review is architecture-only. It does not establish implementation,
functional, or formal Acceptance evidence.

## Review Outcome

The first findings-first pass returned `DESIGN_REVIEW_HOLD` with four
contract findings: an incompatible v2 shape change, generic endpoint errors,
an incomplete service shape, and an underspecified digest projection. The
amendment now hard-cuts v3, defines owner-specific failures, includes both
attestation references, and defines the exact canonical projection.

The independent re-review found no P0/P1 findings and returned
`DESIGN_REVIEW_PASS` on 2026-09-21. `SC-D28` is accepted. This remains design
evidence only.
