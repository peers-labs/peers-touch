# Bot Decisions

## BOT-D01: Bot Is A Product Form

Bot supplies an Agent Actor profile and owner lifecycle. Generic HTTP message
publishing does not require Bot registration.

## BOT-D02: Conversation Owns Publishing

Credentials, normalization, target authorization, idempotency receipts,
delivery, notifications, and content are Conversation concerns. Bot holds only
the stable `publishing_id` reference.

## BOT-D03: One Common Ingress

Bots, scripts, tools, CI, and services use
`POST /message-ingress/{publishing_id}` with `PublishMessageRequest`.
There is no event-only Bot endpoint.

## BOT-D04: Service Plaintext Is Explicit

Bot Direct messages use the common service-plaintext envelope. They cannot
enter human E2EE or MLS conversations and remain owner-only/local in this
release.

## BOT-D05: Aggregation Is A Client Projection

Every structured event remains an individual persistent message. Clients group
complete task execution identities from known history; Bot owns no task state
or aggregate table.
