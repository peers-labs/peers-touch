package conversation

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/application/ingest"
)

// DeliverBotEvent implements the bot sub-server's delivery.ConversationSink
// capability. The public webhook edge authenticates the request; this method
// runs the internal, idempotent dual-product effect (one message plus at most
// one notification row) in the Conversation authority transaction.
func (s *subServer) DeliverBotEvent(
	ctx context.Context,
	command ingest.DeliverCommand,
) (string, bool, error) {
	if s.composition == nil || s.composition.SystemDelivery == nil {
		return "", false, fmt.Errorf(
			"bot event delivery: conversation system delivery is not initialized",
		)
	}
	return s.composition.SystemDelivery.Deliver(ctx, command)
}
