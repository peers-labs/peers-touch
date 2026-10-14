# Bot Product

> Status: current

Bot is an optional product form over the generic Conversation-owned message
publishing capability. It contributes:

- a hidden `ACTOR_KIND_AGENT` identity and profile;
- owner-scoped lifecycle and avatar management;
- a generic `MessagePublishingGrant`;
- a one-way service Direct presentation.

Bot does not own credentials, ingress normalization, idempotency, delivery,
notification production, message content, or event aggregation. Scripts, CI,
tools, and services can create publishing grants without creating Bots.

## Sources

- [Product definition](./product-definition.md)
- [Design](./design.md)
- [Data model](./data-model.md)
- [Integration](./integration.md)
- [Message publishing architecture](../chat/messaging/message-publishing.md)
- [Public API](../../../api/message-publishing.md)
