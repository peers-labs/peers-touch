# MCA-D21 Runtime-Truthful Formal Evidence Review

> **Status**: review-complete
> **Created**: 2026-09-18 | **Updated**: 2026-09-18
> **Owner**: Peers-Touch Agent Team
> **Owner verdict**: `APPROVE MCA-D21` on 2026-09-18

---

Review:

`docs/architecture/agent/modern-chat-agent/proposals/20260918-mca-d21-runtime-truthful-formal-evidence.md`

against:

- `product-definition.md`
- `experience-contract.md`
- `product-state-model.md`
- `design.md`
- `decisions.md` MCA-D19D and MCA-D19E
- `data-model.md`
- `integration.md`
- `../execution-plans/20260817-modern-chat-agent-v2-runtime-matrix.yaml`
- `../execution-plans/20260917-modern-chat-agent-v2-alignment/tasks/MCA-A01.md`

## Verified Trigger

- J01-J06 matrix rows omit explicit attestation profiles and role policies.
- The validator consequently requires legacy direct-runtime facts and every
  role for every tuple.
- Contract, control-plane, unavailable, Station-executor, and Evaluation paths
  do not create the required client lease and ToolCall entities.
- Existing J01 evidence is stale and manually produced.
- Existing J02-J06 runners execute composite development flows rather than one
  independently identified execution per reviewed tuple.
- The J06 candidate writer passes registration shape checks but not the full
  semantic validator.
- MCA-A01's aggregate Task `journeyId` is rejected by the Development Session
  identifier contract, while the active declaration already uses the valid
  `V2-acceptance` closure identity.

## Required Review

1. Product Journey, cell, platform, locale, ordering, and sample scope remain
   unchanged.
2. Every matrix row declares an explicit truthful attestation profile and a
   complete role-policy partition.
3. Contract-only, unavailable, control-plane, Station-turn, Station-executor,
   and client-executor paths remain distinguishable.
4. No profile requires an entity that its production path does not create.
5. `contract-evidence`, `guard-report`, and `zero-execution` apply only to
   their reviewed tuple sets.
6. Receiver visibility is validated by the role oracle, not inferred from a
   runtime-profile name.
7. Every expanded tuple has one unique `scenarioExecutionId` and one real
   execution.
8. Primary command, Turn, ToolCall, operation, Evaluation run, or contract-run
   identity cannot be reused across executable tuples.
9. The candidate producer only assembles observations and cannot invent product
   facts or promote `PROVEN`.
10. The validator remains a separate process and run.
11. Matrix/schema identity advances invalidate all older candidates.
12. J01 gains a repository-owned exact-source Journey; stale manual artifacts
    are not imported.
13. Full validator tests replace shallow registration-only tests.
14. The active MCA-A01 Plan Package is amended before source implementation,
    including normalization of its aggregate `journeyId` to `V2-acceptance`.

## Required Verdict

Return one:

```text
APPROVE MCA-D21
```

or:

```text
REQUEST CHANGES MCA-D21: <blocking findings>
```

Approval authorizes formal architecture and Plan incorporation. It does not
authorize fabricated evidence, Gate removal, scope reduction, destructive
runtime reset, or proof promotion without a separate validator run.

## Verdict

```text
APPROVE MCA-D21
```
