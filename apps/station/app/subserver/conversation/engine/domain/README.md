# Conversation Engine Domain Contracts

This package is the modern Conversation engine's domain dependency root during
the CA-HC consolidation. It does not define a second business authority.

It owns:

- authority conversation and event contracts;
- authority projection grants and follower persistence contracts;
- device queue repository and fencing contracts;
- federation outbox/inbox contracts and authenticated claim names;
- opaque recovery revision contracts;
- typed domain errors.

Application, infrastructure, worker, and HTTP packages may import this package.
This package must not import those outer layers. Actor identity persistence
remains owned by the Actor domain; the Conversation engine only reads active
device state through `DeviceDirectory`.
