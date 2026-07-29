// Package envelope implements the unified Station signaling-envelope service (D-10).
//
// This is the single reliable channel for all chat signaling: committed events,
// MLS key delivery, direct key exchange, receipts, typing, and call signaling.
// Same-Station (local transport) and cross-Station (federation relay + JWT) are
// two adapters of one contract. Per-domain private queues are eliminated.
//
// Responsibilities:
//   - Durable outbox: persist envelopes for cross-Station delivery with retry/backoff/dead-letter.
//   - Durable per-device inbox: persist envelopes until device ACK.
//   - Idempotency: dedup by idempotency_key at both outbox and inbox layers.
//   - Cursor-based recovery: devices resume from last-ack cursor on reconnect.
//   - Typed QoS: route by EnvelopePayloadType to appropriate persistence/delivery tier.
//   - Federation transport: relay-forward with peer-JWT (D-03 contract).
//   - Local transport: direct publish to device bus for same-Station recipients.
//
// See docs/architecture/federated-im/decisions.md D-10 and
// docs/architecture/federated-im/execution-plans/20260712-v1-im-execution-plan.md P1.
package envelope
