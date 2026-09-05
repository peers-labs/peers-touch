# Messaging Domain Contracts

This package is the Station Messaging Platform's dependency root.

It owns:

- authority conversation and event contracts;
- authority projection grants and follower persistence contracts;
- device queue repository and fencing contracts;
- federation outbox/inbox contracts and authenticated claim names;
- opaque recovery revision contracts;
- typed domain errors.

Application, infrastructure, worker, and HTTP packages may import this package.
This package must not import those outer layers. Actor identity persistence
remains owned by the Actor domain; Messaging only reads active device state
through `DeviceDirectory`.
