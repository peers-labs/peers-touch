# Bot Acceptance Matrix

Bot product Acceptance covers:

- create mints one hidden Agent Actor and one generic publishing grant;
- list projects the live grant without exposing its secret hash;
- rotate keeps publishing identity and history stable and invalidates the old secret;
- disable/enable gates the next publish;
- revoke is irreversible and keeps message history;
- avatar changes refresh the owner projection;
- a Bot publication follows the same accepted/replayed, notification, inbox,
  restart, and aggregation contract as a non-Bot publisher.

The authoritative cross-product scenarios are listed in
[Message Publishing And Event Aggregation](../chat/messaging/message-publishing.md#verification-obligations).
