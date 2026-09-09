# CA-W5 Canonical Wire Contract Amendment — Review Prompt

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-09-07 | **Updated**: 2026-09-07
> **Owner**: Architecture Team

---

Review:

```text
docs/architecture/api-ownership/proposals/20260907-ca-w5-canonical-wire-contract-amendment.md
```

against:

```text
docs/architecture/api-ownership/
docs/architecture/messaging-platform/
docs/architecture/federated-social-activity/
docs/architecture/federated-im/decisions.md D-17
model/domain/chat/
model/domain/social/relationship.proto
model/domain/key_exchange/key_exchange.proto
model/domain/federation/delivery.proto
apps/station/app/subserver/conversation/
apps/station/app/subserver/social/
apps/station/app/subserver/key_exchange/
apps/station/frame/core/federation/
```

## Review Questions

1. Does Direct creation preserve caller-owned exact retry identity and prevent
   opposite-Home concurrent creation from producing two authority logs?
2. Does Group creation submit one canonical `ChatCommand` and avoid duplicate
   name/member/plan representations?
3. Does `/conversation/command` enforce raw local-authority command versus signed
   remote-authority proposal without letting the Home Station forge actor intent?
4. Is `ConversationEvent` the only event used by command results, queries,
   followers, persistence, and Device Inbox delivery?
5. Does command-result readback close response-loss and restart recovery without
   creating another command owner?
6. Do Friend Request mutations carry exact actor-device-signed commands and expose
   local durable admission separately from receiver-authority resolution?
7. Can clients build ACCEPT/REJECT commands from the projected Friend Request
   without trusting UI-only routing state?
8. Do destructive Direct/MLS fetches have bounded exact-response receipts and
   tombstones, preventing retry from consuming new one-time material?
9. Are Key Exchange peer reads/claims separated correctly from durable DKX
   delivery through the shared Federation frame?
10. Does removing the specialized peer command-proposal route leave one durable
    peer mutation transport without weakening D-17?
11. Does DKX target-admission readback guarantee that a dependent message enters
    the target Device Inbox after its DKX row without requiring a device ACK?
12. Are all same-ID/different-hash conflicts rejected before mutation?
13. Are all replaced types, routes, adapters, stores, and generated bindings
    covered by hard-deletion obligations?

## Required Finding Format

Report findings first, ordered by severity:

```text
[P0|P1|P2] <title>
Evidence: <file:line and violated invariant>
Impact: <concrete correctness, security, or ownership failure>
Required correction: <specific architecture change>
```

Then return exactly one verdict:

```text
APPROVE AO-D07
```

or:

```text
CHANGES REQUIRED
```

Approval means the amendment is internally coherent and sufficiently precise for
proto-first CA-W5 execution. It does not approve CA-W5 completion or any runtime
readiness claim.
