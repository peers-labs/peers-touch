# MCA-D23 Capability Operation Scenario Control Plane Review

> **Status**: review-complete
> **Created**: 2026-09-19 | **Updated**: 2026-09-19
> **Owner**: Peers-Touch Agent Team

---

Review:

`docs/architecture/agent/modern-chat-agent/proposals/20260919-mca-d23-governed-tool-scenario-control-plane.md`

against:

- `product-definition.md`
- `experience-contract.md`
- `product-state-model.md`
- `design.md`
- `decisions.md`
- `data-model.md`
- `integration.md`
- MCA-D21 runtime-truthful formal evidence
- MCA-D22 capability scenario control plane
- `tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml`
- `tasks/MCA-A04.md`

## Verified Trigger

- J03-J05 require 164 independently executed tuples: 86 governed ToolCall,
  41 MCP lifecycle, and 37 Connector invocation tuples.
- The current J03-J05 runners each execute one Native composite and do not
  produce complete tuple-aware formal candidates.
- Current source has no deterministic J03 control for `CR-00` through `CR-06`,
  `ERR-O06`, `ERR-O07`, `REPLAY-O07I`, or both orderings of `R-03`, `R-05`,
  and `R-07`.
- The accepted MCA-D22 service is J02-only and intercepts capability binding,
  not ToolDispatch, continuation, or executor receipt/effect boundaries.
- The MCA-A04 write set excludes Model, Station, and Desktop Rust changes.
- MCA-A05 and MCA-A06 have the same Harness/tooling-only write-set mismatch.
- Relabeling the composite flow or inventing Station/client execution
  identities would violate MCA-D21.

## Required Review

1. MCA-D23 extends the existing MCA-D22 scenario controller for J03-J05 and
   does not create
   a parallel fixture authority.
2. Station remains the sole ToolCall decision, claim, outbox, result,
   continuation, replay, and typed-error authority.
3. Desktop Rust and the Station executor remain the owners of their real
   PREPARED/APPLIED receipts and side effects.
4. The controller can only select reviewed tuples, allowlisted barriers, and
   prescribed lifecycle actions; no generic failpoint or arbitrary clock API
   is introduced.
5. `CR-00` through `CR-06` pause at the exact accepted commit boundaries and
   interruption exercises durable recovery rather than writing an expected
   result.
6. `R-03`, `R-05`, and `R-07` each execute both orderings from clean fixtures;
   scenario control coordinates ordering but does not decide the winner.
7. `ERR-O01` through `ERR-O08` originate from canonical product owners with
   exact codes, locale keys, retryability, terminality, safe details, and
   forbidden-side-effect oracles.
8. `ERR-O07` forbids automatic redispatch; `REPLAY-O07I` reuses the same
   external idempotency identity and produces at most one effect.
9. Browser Station-executor evidence contains no fabricated Browser client
   capability lease or device executor identity.
10. Desktop Rust hooks require an Acceptance-capable build plus boot-scoped run
    binding, and release builds do not register the commands.
11. Hook tickets are opaque, single-use, short-lived, and omitted from
    evidence.
12. Setup, barrier, interruption, and cleanup responses contain no assertion,
    evidence role, expected result, candidate artifact, or verdict.
13. Every tuple has unique scenario, ToolCall/operation, decision, claim,
    receipt, continuation, and primary execution identity as applicable.
14. MCP Browser/Mobile unavailable rows create no local process, operation
    claim, ToolCall, or client-executor receipt.
15. MCP process, port, secret, business-lease, cleanup-lease, timeout, and
    reconnect evidence remains bound to the real Desktop Rust owner.
16. Connector OAuth/resource revision, disconnect, provider revoke, manifest
    delete, and typed errors remain bound to canonical Station owners.
17. Provider fixture control is allowlisted and never accepts or emits
    credentials.
18. Mobile markers run independently and emit contract-only evidence.
19. Cleanup is idempotent, mandatory, and removes every run-scoped hook and
    resource.
20. The candidate remains `CANDIDATE`; only MCA-A08 may promote formal
    `PROVEN`.
21. Acceptance requires exactly 86 J03, 41 J04, and 37 J05 reviewed tuples; no
    cell, locale, ordering, sample, role, or platform scope is removed.
22. The Plan must be amended before implementation to include Model, Station,
    Desktop Rust, Mobile, provider-fixture, and provisioning write ownership.

## Required Verdict

Return one:

```text
APPROVE MCA-D23
```

or:

```text
REQUEST CHANGES MCA-D23: <blocking findings>
```

## Verdict

```text
APPROVE MCA-D23
```

The Owner delegated full approval and execution authority on 2026-09-19. The
review found no second authority, fabricated runtime identity, production
failpoint, credential-bearing fixture, or weakened tuple scope.
