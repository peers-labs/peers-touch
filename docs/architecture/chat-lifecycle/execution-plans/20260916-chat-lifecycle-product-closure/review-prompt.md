# Chat Lifecycle Plan Review Prompt

Review:

`docs/architecture/chat-lifecycle/execution-plans/20260916-chat-lifecycle-product-closure/plan.md`

Sources:

- `docs/architecture/chat-lifecycle/product-definition.md`
- `docs/architecture/chat-lifecycle/experience-contract.md`
- `docs/architecture/chat-lifecycle/product-state-model.md`
- `docs/architecture/chat-lifecycle/acceptance-matrix.md`
- `docs/architecture/chat-lifecycle/current-capability-audit.md`
- `docs/architecture/chat-lifecycle/design.md`
- `docs/architecture/chat-lifecycle/decisions.md`
- `docs/architecture/chat-lifecycle/integration.md`

Evaluate:

1. Whether the plan starts from the full user lifecycle rather than a
   pre-created conversation or infrastructure layer.
2. Whether each Task is a vertical product closure with a real sender,
   receiver, durable readback, recovery path, and bounded non-claim.
3. Whether Actor/Social, Conversation, Device Messaging Engine, Realtime, and
   Federation ownership remains single-source and free of fallback paths.
4. Whether recorded voice, one-to-one live calls, and group live calls are
   correctly separated.
5. Whether the safety/evidence closure is a mandatory predecessor.
6. Whether Desktop and Mobile claims remain independent.
7. Whether obsolete NDR/Messaging progress is prevented from entering current
   readiness.
8. Whether dependencies, cutovers, deletion obligations, authorization, and
   current-source acceptance requirements are complete.
9. Whether any required product behavior or architecture decision remains
   implicit.
10. Whether `CHAT-C12`/`CHAT-J09` is correctly blocked on a separate reviewed
    SFU architecture and cannot fall back to peer-to-peer mesh.

Return one verdict:

- `passed`
- `conditionally passed`
- `changes required`

Every finding must cite a governing source and identify the affected Task or
capability.
