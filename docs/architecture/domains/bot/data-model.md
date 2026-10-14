# Bot Data Model

`bot_registration` contains only:

- `bot_ptid`
- `owner_ptid`
- `publishing_id`
- `name`
- product lifecycle timestamps/state

The referenced `message_publishing_grants` row owns sender, owner, trusted
namespace, target bounds, credential hash/hint, expiry, disable/revoke state,
and rate limit. `message_publication_receipts` owns durable idempotency.

`Bot` API projections embed `MessagePublishingGrant`; create and rotation return
the plaintext secret once. No Bot DTO contains a second ingress ID, delivery
scope, request dedupe key, group key, or event schema.

Common content is defined only by:

- `model/domain/chat/content.proto`
- `model/domain/chat/publishing.proto`
- `DirectServicePlaintextPayload` in `model/domain/chat/command.proto`

See [message publishing data contract](../chat/messaging/message-publishing.md).
