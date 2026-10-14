# Bot Integration

Bot management remains JWT owner-scoped:

- `/bot/create`
- `/bot/list`
- `/bot/rotate-secret`
- `/bot/set-state`
- `/bot/set-profile`

Create returns the common `/message-ingress/{publishing_id}` URL and one-time
secret. Rotation changes only credential material; publishing identity,
sender, conversation history, and command receipts remain stable.

The public ingress and grant management endpoints are documented in
[Message Publishing API](../../../api/message-publishing.md).

Desktop maps the embedded publishing grant into Settings. Desktop and Mobile
receive service plaintext through the shared messaging engine. Desktop
persists common protobuf content for rich rendering and semantic activity
aggregation; Mobile persists the same content and renders at least the derived
fallback in the ordinary message timeline.
