# Service API Capability Ownership — Target Module Layout

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-06 | **Updated**: 2026-09-06
> **Owner**: Architecture Team

---

Conversation is the sole Chat entry point. Its `/conversation/*` API composes
the resource-owner APIs at `/device/*`, `/device/inbox/*`, `/recovery/*`,
`/key-exchange/*`, and peer-only `/federation/*`; no Station Messaging facade is
part of the target tree.

## 1. Target Tree

```text
docs/architecture/api-ownership/
├── README.md
├── design.md
├── decisions.md
├── data-model.md
├── integration.md
├── module-layout.md
└── station-api-capabilities.yaml

apps/station/app/subserver/conversation/
├── domain/
│   ├── aggregate/          # Conversation aggregate root and invariants
│   ├── entity/             # Member, MemberDevice, AuthorityPlan
│   ├── event/              # committed Conversation domain facts
│   ├── repository/         # domain repository and unit-of-work ports
│   ├── service/            # pure cross-entity domain policies
│   └── valueobject/        # IDs, epochs, hashes, roles, delivery commitments
├── application/
│   ├── command/            # create, submit, membership, settings, read
│   ├── query/              # list, get, members, history, public head
│   └── ports/              # device inbox, identity, federation, object store
├── infrastructure/
│   ├── persistence/        # GORM models and one authority UOW
│   ├── delivery/           # per-device Chat inbox implementation
│   ├── attachment/         # opaque object/session/grant implementation
│   └── federation/         # typed Conversation transport adapter
├── interface/http/         # /conversation/* and /device/inbox/* adapters
├── composition.go          # dependency injection only
└── subserver.go            # route registration only

apps/station/app/subserver/social/
├── domain/                 # relationship and Friend Request truth
├── application/            # send/receive/accept/reject and projections
├── infrastructure/         # Social persistence and Federation adapter
└── interface/http/         # canonical /api/v1/social/* handlers

apps/station/app/subserver/recovery/
├── application/            # opaque archive revision policy
├── infrastructure/         # encrypted archive persistence
├── interface/http/         # /recovery/*
└── subserver.go

apps/station/app/subserver/key_exchange/
├── application/            # Direct prekeys, MLS KeyPackages, DKX
├── infrastructure/         # exact-once public material stores
├── interface/http/         # /key-exchange/*
└── subserver.go

apps/station/frame/touch/actor/
└── device_signing_key_store.go # actor-owned device identity truth

apps/station/app/subserver/actor_identity/
├── application/            # enroll/list/revoke verified actor devices
├── interface/http/         # /device/*
└── subserver.go

apps/station/frame/core/federation/
├── delivery/               # domain-neutral outbox/inbox/dispatcher
├── auth/                   # Station peer authentication
└── registry/               # typed domain payload dispatch

tooling/acceptance/gates/architecture/
└── station_api_ownership.py
```

Exact implementation paths may be refined by the execution plan, but the owner and
dependency direction may not change without another architecture decision.

## 2. Responsibilities

| Path | Owns | Must not own |
|---|---|---|
| `conversation/` | Conversation business truth, authority sequence, command receipt, membership, settings, attachment grants, and Chat delivery intents | Actor identity, cross-domain recovery, Social relationships |
| `social/` | Friend Request, follow/friend/block graph and actor-local relationship projection | Conversation sequence, device queue |
| `conversation/infrastructure/delivery/` | per-device Chat inbox, leases, fencing, ACK and retry | Conversation policy, actor identity mutation |
| `actor_identity/` | verified actor-device lifecycle through the actor-owned store | Conversation membership or queue state |
| `recovery/` | encrypted cross-domain archive revisions | plaintext, live crypto state, Conversation authority |
| `key_exchange/` | Direct/MLS public material and exact-once claims | Conversation membership or device lifecycle |
| `frame/core/federation/delivery/` | authenticated durable delivery mechanics | domain authorization or mutation |
| `model/domain/actor/` | Actor and Actor Device identity protobuf contracts | Conversation or delivery policy |
| `model/domain/chat/` | Conversation, attachment, receipt, and Device Inbox protobuf contracts | Actor lifecycle, Recovery, Key Exchange, or Federation transport ownership |
| `model/domain/key_exchange/` | Direct/MLS public-material and DKX protobuf contracts | Conversation membership or Actor lifecycle |
| `model/domain/recovery/` | opaque encrypted recovery revision contracts | plaintext or live cryptographic state |
| `model/domain/federation/` | domain-neutral durable Station transport contracts | Conversation or Social authorization |
| `model/domain/social/` | relationship and Friend Request protobuf contracts | Chat payload aliases |
| `api-ownership/` | reviewed human and machine ownership contract | runtime business implementation |

## 3. Dependency Direction

```text
Model contracts
  <- Conversation / Social typed domain adapters
  <- Messaging delivery adapters

Conversation / Social
  -> FederationDeliveryPort
Conversation -> DeviceInboxPort

Device Inbox -> narrow ConversationReadPort where authorization context is required

Federation delivery
  -> registered typed domain receiver
```

Concrete domain packages do not import each other to obtain transport mechanics.
Shared mechanics move upward into Frame; business policy stays in App subservers.

## 4. Required Deletions

The hard cut removes:

- the entire Station `apps/station/app/subserver/conversation/engine/` facade after each
  retained implementation moves to its accepted resource owner;
- every route and caller owned by the retired Station Chat facade;
- duplicate Messaging Conversation request/response proto messages;
- duplicate Messaging Conversation authority services and repositories after their
  modern semantics move to the Conversation DDD owner;
- parallel `messaging_*` Conversation authority tables;
- Chat-specific durable Federation infrastructure after extraction to the shared port;
- flat Conversation handlers/services/repositories replaced by the DDD layers;
- stale documentation and Gates that accept the Messaging facade.

No adapter may retain a retired public route after deletion.

## 5. Registration And Gate Ownership

| Concern | Single source |
|---|---|
| Human architecture | this document set |
| Machine capability registry | `station-api-capabilities.yaml` |
| Runtime route inventory | Station handler registry |
| Ownership validator | `station-api-ownership` Gate |
| Chat closure wiring | Messaging W11 closure contract |
| Social cross-Station proof | W9-D Social Gate |

The Gate consumes the registry but cannot modify it or infer missing capabilities.
