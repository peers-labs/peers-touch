# Conversation Authority Hard Cut - Plan Review Prompt

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-06 | **Updated**: 2026-09-06
> **Owner**: Architecture Team

---

You are reviewing a Peers-Touch cross-layer execution plan.

## Review Target

The plan must rebuild Station Conversation as a real DDD bounded context, keep
Conversation as the sole Chat entry point, move support APIs to their accepted
resource owners, and complete cross-Station Friend Request through shared Federation
transport. It must not preserve aliases, dual writes, fallback reads, duplicate truth
stores, or platform-specific transport silos.

## Accepted Architecture Sources

- `docs/architecture/engineering/api-governance/README.md`
- `docs/architecture/engineering/api-governance/design.md`
- `docs/architecture/engineering/api-governance/decisions.md`
- `docs/architecture/engineering/api-governance/data-model.md`
- `docs/architecture/engineering/api-governance/module-layout.md`
- `docs/architecture/engineering/api-governance/integration.md`
- `docs/architecture/domains/chat/messaging/`
- `docs/architecture/domains/social/federation/decisions.md` (`D-07` only)
- `docs/architecture/domains/social/federation/design.md` §4.1
- `docs/architecture/domains/social/federation/integration.md` §7

Accepted decisions: `AO-D01..AO-D06`, revised `MP-D30`, and Federated Social `D-07`.

## Plan Path

`docs/architecture/engineering/api-governance/execution-plans/20260906-conversation-authority-hard-cut.md`

## Review Dimensions

1. **Dependency order**: Are ownership inventory, proto-first contracts, DDD/resource
   owners, shared Federation, atomic cutover, runtime proof, and completion audit ordered
   by real prerequisites?
2. **DDD integrity**: Does CA-W2 establish aggregate invariants, domain events, repository
   and UOW ports, application commands/queries, infrastructure adapters, HTTP mapping,
   composition, and import Gates rather than merely moving files?
3. **Scope and ownership**: Does every target API and store remain with its accepted
   Conversation, Conversation Delivery, Actor Identity, Recovery, Key Exchange, Social,
   or Federation owner?
4. **Atomic hard cut**: Can CA-W5 land without a live compatibility namespace, dual
   authority store, fallback read, or mixed client population?
5. **Proto-first correctness**: Are canonical contracts established before Station and
   client implementations, with generated artifacts updated only from proto sources?
6. **Failure semantics**: Are retry, replay, dedup, hash conflict, auth, lease fencing,
   restart, cancellation, corrupt recovery, and partial attachment behavior testable?
7. **Acceptance**: Does every workstream have executable gates, source-bound evidence,
   explicit non-claims, and receiver-perspective success/failure coverage?
8. **Deletion completeness**: Does the plan prove zero live retired Station Chat
   facade, duplicate proto families, duplicate truth stores, old flat Conversation
   owners, and stale tests/docs?
9. **Parallelism and integration risk**: Are CA-W2, CA-W3, and CA-W4 safely parallel after
   CA-W1, and are their interfaces reconciled before the atomic cutover?
10. **Plan drift**: Does any task silently redesign an accepted boundary or omit an
    architecture invariant?

## Required Output

```markdown
### Overall Verdict: PASS | CONDITIONAL PASS | CHANGES REQUIRED

### Findings
- P0/P1/P2: <finding with plan section and architecture source>

### Dimension Results
1. Dependency order: PASS | FAIL - reason
2. DDD integrity: PASS | FAIL - reason
3. Scope and ownership: PASS | FAIL - reason
4. Atomic hard cut: PASS | FAIL - reason
5. Proto-first correctness: PASS | FAIL - reason
6. Failure semantics: PASS | FAIL - reason
7. Acceptance: PASS | FAIL - reason
8. Deletion completeness: PASS | FAIL - reason
9. Parallelism and integration risk: PASS | FAIL - reason
10. Plan drift: PASS | FAIL - reason

### Required Changes
- <specific correction, or "none">
```

Do not approve based on document shape alone. Cross-check current source, callers,
routes, stores, generated contracts, and Acceptance mappings.
