# Mobile Contracts

`reliability.proto` owns the generated Mobile-only reliability envelopes defined
by MS-D15.

- Durable command membership is closed to `FriendRequestCommand`.
- Chat and Group commands remain owned by the Device Messaging Engine.
- Draft payloads contain typed composer state and encrypted blob references,
  never media bytes, credentials, or dispatchable command frames.

See `docs/architecture/platform/client/mobile/data-model.md` sections 4 and 5.
