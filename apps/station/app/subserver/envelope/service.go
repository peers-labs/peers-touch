package envelope

import (
	"context"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// Service is the application-layer interface for the envelope subsystem.
// Station subservers (group_chat, friend_chat, etc.) call this to route
// their committed events and key material through the unified channel.
type Service interface {
	// Submit accepts an envelope from a local actor's command path and routes it:
	//   - same-Station recipient: deliver directly to device inbox + bus publish
	//   - cross-Station recipient: persist to outbox for federation relay
	// Returns the envelope_id on success. Idempotent on idempotency_key.
	Submit(ctx context.Context, env *chat.StationEnvelope) (string, error)

	// Deliver is called by the federation inbound handler when a remote Station
	// relay-forwards an envelope to us (we are the recipient's home Station).
	// It validates federation claims, then routes to device inbox + bus publish.
	Deliver(ctx context.Context, env *chat.StationEnvelope, federationClaims *FederationClaims) error

	// Ack marks an inbox item as acknowledged by the device. The item may be
	// garbage-collected after ACK.
	Ack(ctx context.Context, recipientPtid, deviceID, inboxItemID string) error

	// Resume returns all unacknowledged inbox items for a device, ordered by
	// queue time. Called on SSE reconnect / cold start with Last-Event-ID cursor.
	Resume(ctx context.Context, recipientPtid, deviceID string, afterCursor string) ([]*chat.DeviceInboxItem, error)
}

// FederationClaims carries the verified JWT claims from a relay-forward request.
type FederationClaims struct {
	IssuerStationPeerID   string
	AudienceStationPeerID string
	SenderPtid            string
	SenderDeviceID        string
	ConversationID        string
	IdempotencyKey        string
	IssuedAt              time.Time
	ExpiresAt             time.Time
}

// OutboxDispatcher runs in the background, picking up pending outbox items
// and relay-forwarding them to the target Station with retry/backoff.
type OutboxDispatcher interface {
	Start(ctx context.Context) error
	Stop()
}

// DeviceBus publishes envelopes to connected device SSE streams.
type DeviceBus interface {
	// PublishToDevice delivers an envelope to a specific device's SSE stream.
	// Returns true if the device is currently connected and received the frame.
	PublishToDevice(ctx context.Context, recipientPtid, deviceID, inboxItemID string, env *chat.StationEnvelope) bool

	// PublishToActor delivers an envelope to all connected devices of an actor.
	PublishToActor(ctx context.Context, recipientPtid, inboxItemID string, env *chat.StationEnvelope) int
}
