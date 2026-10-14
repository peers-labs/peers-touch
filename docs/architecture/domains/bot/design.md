# Bot Design

Bot owns product metadata only:

```text
Bot registration
  -> hidden Agent Actor
  -> MessagePublishingGrant
  -> Conversation message publishing
```

The Bot subserver manages name, profile, and lifecycle. It resolves the
Conversation capability lazily through the subserver registry so startup order
does not create a repository dependency.

Conversation owns:

- stable publishing identity and credential hash;
- default/allowed service Direct targets;
- request normalization and durable publication receipts;
- authority event, device inbox, notification row, and post-commit wake;
- common content persistence and client aggregation.

Bot disable/enable updates both product state and the grant's disabled state.
Revoke invalidates the grant first, so a registry write failure cannot leave an
active credential behind. Bot creation compensates a failed metadata write by
revoking the newly created grant.

The complete transport and failure contract lives in
[Message Publishing And Event Aggregation](../chat/messaging/message-publishing.md).
