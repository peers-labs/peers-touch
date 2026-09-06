package conversationengine

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

type eventBusTypingPublisher struct {
	bus events.EventBus
}

func (publisher eventBusTypingPublisher) PublishTyping(
	_ context.Context,
	recipientPTID string,
	conversationID string,
	senderPTID string,
	isTyping bool,
) error {
	bus := publisher.bus
	if bus == nil {
		bus = events.GetBus()
	}
	if bus == nil {
		return fmt.Errorf("messaging: typing event bus is unavailable")
	}
	_, err := bus.PublishEphemeral(recipientPTID, &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Typing{
			Typing: &realtime.TypingState{
				SessionUlid:   conversationID,
				FromActorPtid: senderPTID,
				Typing:        isTyping,
			},
		},
	})
	return err
}
