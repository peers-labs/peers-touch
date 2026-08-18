package messaging

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

type eventBusTypingPublisher struct{}

func (eventBusTypingPublisher) PublishTyping(
	ctx context.Context,
	recipientPTID string,
	conversationID string,
	senderPTID string,
	isTyping bool,
) error {
	bus := events.GetBus()
	if bus == nil {
		return fmt.Errorf("messaging: typing event bus is unavailable")
	}
	actor, err := touchactor.GetActorByPTID(ctx, recipientPTID)
	if err != nil || actor == nil {
		return fmt.Errorf("messaging: cannot resolve recipient PTID %q to actor ID: %w", recipientPTID, err)
	}
	actorID := fmt.Sprintf("%d", actor.ID)
	_, err = bus.PublishEphemeral(actorID, &realtime.StreamEvent{
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
