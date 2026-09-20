# MCA-D20A Catalog Distribution Review

> **Status**: review-complete
> **Created**: 2026-09-17 | **Updated**: 2026-09-17
> **Owner**: Peers-Touch Agent Team
> **Owner verdict**: `APPROVE MCA-D20A` on 2026-09-17

---

Review:

`docs/architecture/agent/modern-chat-agent/proposals/20260917-mca-d20a-catalog-distribution.md`

against:

- `product-definition.md`
- `experience-contract.md`
- `product-state-model.md`
- `design.md`
- `decisions.md` MCA-D20
- `data-model.md` section 8.11
- `integration.md` MCA-X3
- `../execution-plans/20260917-modern-chat-agent-v2-alignment/tasks/MCA-X3.md`

## Verified Trigger

- `peers-labs/peers-touch` is private.
- Its default branch is `master`, while the current built-in source uses
  `main`.
- Anonymous raw fetch returns HTTP 404.
- X3 requires a fresh signed synchronization and correctly rejects stale
  embedded fallback.

## Required Review

1. Publisher signature and Desktop key pin remain the only trust root.
2. Station is transport only and cannot sign, rewrite, or classify the
   envelope.
3. The endpoint is proto-first, authenticated, bounded, and versioned.
4. One canonical signed asset under `packages/agent-catalog` feeds Desktop
   bootstrap and a deterministic Station generated projection; the
   Desktop-local duplicate is deleted and drift fails closed.
5. GitHub repository/branch semantics remain available only for explicitly
   user-pinned public sources.
6. No GitHub token, private key, arbitrary URL fallback, or embedded sync
   fallback is introduced.
7. Network/auth/old-Station failures preserve the last verified snapshot only
   as visibly stale.
8. Rollback, same-revision byte changes, invalid signatures, invalid hashes,
   and invalid schemas fail closed.
9. Agent/Skill/MCP target authorities and uninstall semantics remain unchanged.
10. The extended native Gate proves Station transport and tamper/old-version
    failures using exact deployed source.
11. `model/domain/agent/package_catalog.proto` is the only Station/Desktop wire
    contract, and the transport digest is never treated as the signature trust
    root.
12. The X3 Plan write set is expanded to `packages/agent-catalog` before
    implementation; no shared asset is written outside declared scope.

## Required Verdict

Return one:

```text
APPROVE MCA-D20A
```

or:

```text
REQUEST CHANGES MCA-D20A: <blocking findings>
```

Approval authorizes formal incorporation into `design.md`, `decisions.md`,
`data-model.md`, `integration.md`, and the active X3 Task/Plan before source
implementation. It does not authorize a PR or weaken the existing exact-source
native proof requirement.

## Verdict

```text
APPROVE MCA-D20A
```
