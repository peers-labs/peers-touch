package delivery

import (
	"context"

	application "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
)

// Writer adapts CA-W2 transactional delivery intents to the canonical inbox repository.
type Writer struct {
	repository application.Repository
}

// NewWriter constructs the transaction-scoped CA-W2 DeviceInboxWriter adapter.
func NewWriter(repository application.Repository) (*Writer, error) {
	if repository == nil {
		return nil, application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_writer.new",
			"repository",
			"is required",
		)
	}

	return &Writer{repository: repository}, nil
}

// Enqueue validates the CA-W2 intent and appends it to the recipient device lane.
func (w *Writer) Enqueue(
	ctx context.Context,
	intent ports.DeviceInboxIntent,
) error {
	payloadType, err := application.PayloadTypeFromIntent(intent.PayloadKind)
	if err != nil {
		return err
	}
	if intent.EventSequence == 0 {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_writer.enqueue",
			"event_sequence",
			"must be positive",
		)
	}
	if payloadType == application.PayloadTypeConversationEvent &&
		intent.Commitment.IsZero() {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_writer.enqueue",
			"delivery_commitment",
			"is required for a Conversation event",
		)
	}

	_, err = w.repository.Enqueue(ctx, application.EnqueueRequest{
		ItemID:         intent.IntentID,
		Recipient:      intent.Recipient,
		EventID:        intent.EventID,
		EventSequence:  intent.EventSequence,
		ConversationID: intent.ConversationID,
		IdempotencyKey: intent.IdempotencyKey,
		PayloadType:    payloadType,
		OpaquePayload:  append([]byte(nil), intent.OpaquePayload...),
		PayloadHash:    intent.PayloadHash,
		CreatedAt:      intent.CreatedAt,
	})
	if err != nil {
		return err
	}

	return nil
}

var _ ports.DeviceInboxWriter = (*Writer)(nil)
