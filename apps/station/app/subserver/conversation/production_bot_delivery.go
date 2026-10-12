package conversation

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/application/ingest"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// DeliverBotEvent implements the bot sub-server's delivery.ConversationSink
// capability. The public webhook edge authenticates the request; this method
// runs the internal, idempotent dual-product effect (one message plus at most
// one notification row) in the Conversation authority transaction, then emits
// the actor-level realtime wake after commit. The wake is best-effort: durable
// inbox and notification state already committed, so a realtime failure never
// turns an accepted webhook into an error.
func (s *subServer) DeliverBotEvent(
	ctx context.Context,
	command ingest.DeliverCommand,
) (string, bool, error) {
	if s.composition == nil || s.composition.SystemDelivery == nil {
		return "", false, fmt.Errorf(
			"bot event delivery: conversation system delivery is not initialized",
		)
	}
	result, err := s.composition.SystemDelivery.Deliver(ctx, command)
	if err != nil {
		return "", false, err
	}
	if result.NotificationWake != nil && s.composition.realtime != nil {
		if wakeErr := s.composition.realtime.PublishBotNotification(ctx, *result.NotificationWake); wakeErr != nil {
			logger.Errorf(ctx, "[bot-delivery] post-commit notification wake failed: %v", wakeErr)
		}
	}
	return result.EventID, result.Replayed, nil
}
