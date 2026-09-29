# Review 01: OAuth Login Broker Product, Architecture, And Plan

> **Status**: passed-after-correction
> **Reviewed**: 2026-09-30
> **Scope**: Product + Architecture + Plan
> **Reviewer Mode**: independent findings-first

## Findings And Corrections

| Severity | Finding | Correction |
|---|---|---|
| critical | Arbitrary HTTP(S) `return_to`, optional bridge signing, callback-supplied error routing, and raw state reflection left a redirect exfiltration boundary | Added exact per-site destination allowlists, mandatory Vercel bridge secrets, transaction-derived error routing, and no raw-state responses |
| high | Lazy reads could not rotate append-only audit records without violating read-only admin semantics | Added an explicit server-side maintenance command that scans and rewrites every record class |
| high | Envelope AAD descriptions disagreed about key ID | Defined one canonical NUL-delimited AAD covering all metadata, kind, and path |
| high | Source-only durable-core closure claimed cross-instance behavior | Converted durable login to a functional service closure with an exact cross-container check |
| high | Lost-response idempotency and secret redaction were under-specified | Added callback/refresh lost-response, duplicate operation, and full secret-redaction assertions |
| medium | Two Tasks combined too many independent outcomes | Split the Plan into durable login, refresh/idempotency, key rotation, and operator proof |

## Re-Review

- Required capabilities OLB-C01 through OLB-C09 map to OLB-J01 through OLB-J04
  and OLB-G01 through OLB-G06.
- All four Task Slices are serial, dependency-closed, and have binary functional
  or Acceptance checks.
- GitHub is isolated behind the OAuth Store; future database replacement does
  not change use cases.
- The Plan authorizes local commits and local runtime only. Push, PR, release,
  destructive reset, and history rewrite remain denied.
- Live GitHub App, provider consent, and Vercel deployment remain explicit
  non-claims.

## Verdict

`passed`
