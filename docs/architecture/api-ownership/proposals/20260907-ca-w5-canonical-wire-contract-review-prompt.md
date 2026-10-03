# CA-W5 Canonical Wire Contract Review Prompt

Review:

`docs/architecture/api-ownership/proposals/20260907-ca-w5-canonical-wire-contract-amendment.md`

against:

- `docs/architecture/api-ownership/{design,decisions,data-model,integration}.md`
- `docs/architecture/api-ownership/station-api-capabilities.yaml`
- `docs/architecture/api-ownership/execution-plans/20260906-conversation-authority-hard-cut.md`
- `docs/architecture/messaging-platform/`
- `docs/architecture/identity/unified-actor-system.md`
- `docs/architecture/federation/`
- `docs/architecture/cross-station-social/decisions.md` `CSS-D01`
- `model/domain/chat/`
- `model/domain/actor/actor.proto`
- `model/domain/key_exchange/key_exchange.proto`
- `model/domain/social/relationship.proto`

Determine whether AO-D07.1 through AO-D07.6 form one coherent v1 hard-cut
contract.

Required checks:

1. Creation identity is caller-owned, deterministic, and exact-replay safe.
2. Federation and authority scope are derived from verified Station state rather
   than trusted client routing fields.
3. Group creation consumes one persisted authority plan and one canonical
   `ChatCommand`, without a second creation description.
4. Local and remote command submission have distinct trust semantics while
   sharing one client route.
5. Remote mutation and result return use only shared durable Federation
   delivery.
6. `ConversationEvent` is the sole committed event truth across responses,
   persistence, follower replay, and Device Inbox.
7. Friend Request mutations remain actor-device signed and receiver-authority
   owned.
8. Destructive Key Exchange reads have caller-owned identity and exact-response
   replay.
9. Peer routes retain route-specific authentication claims.
10. No compatibility route, dual write, fallback read, second proposal store, or
    second event type survives the cut.

Return:

- `APPROVE` or `REQUEST_CHANGES`;
- P0/P1 findings with exact source references;
- any contract field whose authority, identity, replay, or failure semantics
  remain ambiguous;
- whether CA-W5 may resume proto mutation and production route registration.
