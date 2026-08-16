package messaging

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

type eventBusTypingPublisher struct{}

func (eventBusTypingPublisher) PublishTyping(
	_ context.Context,
	recipientPTID string,
	conversationID string,
	senderPTID string,
	isTyping bool,
) error {
	bus := events.GetBus()
	if bus == nil {
		return fmt.Errorf("messaging: typing event bus is unavailable")
	}
	_, err := bus.PublishEphemeral(recipientPTID, &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Typing{
			Typing: &realtime.TypingState{
				SessionUlid: conversationID,
				FromActorId: senderPTID,
				Typing:      isTyping,
			},
		},
	})
	return err
}
