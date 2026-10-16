# Bot Decisions

> **Status**: active
> **Owner**: Peers-Touch Bot Team

| Decision | Summary | Status |
| --- | --- | --- |
| BOT-D01 | Bot is an optional product form | accepted |
| BOT-D02 | Conversation owns publishing | accepted |
| BOT-D03 | All publishers share one ingress | accepted |
| BOT-D04 | Service plaintext is explicit and isolated | accepted |
| BOT-D05 | Aggregation is a client projection | accepted |

## BOT-D01: Bot Is A Product Form

**Status**: accepted

**Date**: 2026-10-11

### Context

Programs need generic message publishing without inheriting Bot metadata or
lifecycle.

### Decision

Bot supplies an Agent Actor profile and owner lifecycle. Generic HTTP message
publishing does not require Bot registration.

### Rationale

Product identity and transport authority have different ownership and
lifecycle requirements.

### Alternatives Considered

- Require every publisher to create a Bot: rejected because scripts and tools
  do not need Bot product state.

### Consequences

Bot remains optional while generic publishing grants remain reusable.

## BOT-D02: Conversation Owns Publishing

**Status**: accepted

**Date**: 2026-10-11

### Context

Publishing authority affects conversation targets, delivery, receipts, and
notifications rather than Bot metadata.

### Decision

Credentials, normalization, target authorization, idempotency receipts,
delivery, notifications, and content are Conversation concerns. Bot holds only
the stable `publishing_id` reference.

### Rationale

One Conversation owner prevents duplicate credential, receipt, and delivery
implementations.

### Alternatives Considered

- Give Bot a parallel publishing stack: rejected because it creates competing
  transport and persistence owners.

### Consequences

Bot depends on the Conversation publishing capability and cannot redefine its
wire or persistence contracts.

## BOT-D03: One Common Ingress

**Status**: accepted

**Date**: 2026-10-11

### Context

Publisher-specific endpoints would fragment validation, authorization, and
idempotency behavior.

### Decision

Bots, scripts, tools, CI, and services use
`POST /message-ingress/{publishing_id}` with `PublishMessageRequest`.
There is no event-only Bot endpoint.

### Rationale

A single ingress keeps one public contract and one receipt model.

### Alternatives Considered

- Add a Bot event webhook endpoint: rejected because it duplicates the common
  publisher contract.

### Consequences

All publishers share content validation, credential rotation, and replay
semantics.

## BOT-D04: Service Plaintext Is Explicit

**Status**: accepted

**Date**: 2026-10-11

### Context

Station-authored service content cannot be confused with human encrypted
Direct or MLS Group payloads.

### Decision

Bot Direct messages use the common service-plaintext envelope. They cannot
enter human E2EE or MLS conversations and remain owner-only/local in this
release.

### Rationale

Explicit delivery kind and conversation isolation preserve the human
confidentiality boundary.

### Alternatives Considered

- Reuse human encrypted payload types for service messages: rejected because
  Station is not a human-device cryptographic participant.

### Consequences

Clients maintain a dedicated service-plaintext decoder and reject service
content outside owner-local Service Directs.

## BOT-D05: Aggregation Is A Client Projection

**Status**: accepted

**Date**: 2026-10-11

### Context

Structured service events may represent revisions of one execution while each
event remains durable evidence.

### Decision

Every structured event remains an individual persistent message. Clients group
complete task execution identities from known history; Bot owns no task state
or aggregate table.

### Rationale

Projection preserves raw event history and avoids a second task-state owner.

### Alternatives Considered

- Persist Bot-owned aggregate rows: rejected because they duplicate message
  history and introduce synchronization failure modes.

### Consequences

Clients derive aggregation deterministically and can rebuild it after restart
or partial-history expansion.
