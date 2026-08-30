package envelope

import (
	"context"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// Repository defines the persistence contract for the envelope subsystem.
// Implementation lives in infrastructure (PostgreSQL); this interface lives
// in the application layer per DDD.
type Repository interface {
	// --- Outbox (cross-Station federation delivery) ---

	// EnqueueOutbox persists an envelope for cross-Station delivery.
	// Idempotent on idempotency_key: duplicate inserts return existing ID without error.
	EnqueueOutbox(ctx context.Context, item *chat.OutboxItem) (string, error)

	// PendingOutboxItems returns items ready for dispatch (status=PENDING or
	// status=IN_FLIGHT with next_retry_at <= now), ordered by first_queued_at.
	PendingOutboxItems(ctx context.Context, limit int) ([]*chat.OutboxItem, error)

	// MarkOutboxInFlight atomically sets status=IN_FLIGHT and bumps retry_count.
	MarkOutboxInFlight(ctx context.Context, outboxItemID string) error

	// MarkOutboxDelivered sets status=DELIVERED with delivered_at timestamp.
	MarkOutboxDelivered(ctx context.Context, outboxItemID string, deliveredAt time.Time) error

	// MarkOutboxDeadLetter sets status=DEAD_LETTER after max retries exhausted.
	MarkOutboxDeadLetter(ctx context.Context, outboxItemID string, lastError string) error

	// SetOutboxNextRetry schedules the next retry with exponential backoff.
	SetOutboxNextRetry(ctx context.Context, outboxItemID string, nextRetryAt time.Time, lastError string) error

	// --- Inbox (per-device durable delivery) ---

	// EnqueueInbox persists an envelope for a specific device.
	// Idempotent on (recipient_ptid, recipient_device_id, idempotency_key).
	EnqueueInbox(ctx context.Context, item *chat.DeviceInboxItem) (string, error)

	// MarkInboxDelivered sets status=DELIVERED (SSE frame sent to device).
	MarkInboxDelivered(ctx context.Context, inboxItemID string, deliveredAt time.Time) error

	// MarkInboxAcked sets status=ACKED (device confirmed receipt).
	MarkInboxAcked(ctx context.Context, inboxItemID string) error

	// UnackedInboxItems returns items not yet ACK'd for a device, after the
	// given cursor (inbox_item_id), ordered by first_queued_at. Used for
	// SSE reconnect / cold-start recovery.
	UnackedInboxItems(ctx context.Context, recipientPTID, deviceID string, afterCursor string, limit int) ([]*chat.DeviceInboxItem, error)

	// --- Idempotency ---

	// HasIdempotencyKey checks if an envelope with this key has already been
	// processed (at either outbox or inbox layer).
	HasIdempotencyKey(ctx context.Context, idempotencyKey string) (bool, error)
}
