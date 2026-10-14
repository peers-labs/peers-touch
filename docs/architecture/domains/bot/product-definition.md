# Bot Product Definition

## Thesis

A Bot is a named automated participant that gives a generic publisher a
recognizable profile in Peers Touch. Automation itself does not require a Bot.

## Owner Journey

1. Create a Bot name and optional avatar.
2. Station mints a hidden Agent Actor.
3. Conversation creates the Bot's generic publishing grant.
4. The UI reveals the common ingress URL and secret once.
5. The owner can rotate, disable, enable, revoke, or update the avatar.
6. Published messages appear in the Bot Direct with an explicit
   service-plaintext trust marker.

## Scope

- Owner-only local Direct delivery.
- Text, structured events, supported cards, and authorized objects.
- One-way Bot conversation presentation.
- Generic message publishing idempotency and rate limits.

## Excluded

- A Bot-only webhook schema or credential store.
- Bot-owned delivery, notification, or aggregation infrastructure.
- E2EE or federated service plaintext.
- Bot replies, calls, friendship, or human-device sessions.
