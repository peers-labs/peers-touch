package presence

import (
	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

type eventBusPublisher struct{}

func (eventBusPublisher) PublishPresence(actorID string, online bool, recipients []string) {
	bus := events.GetBus()
	if bus == nil {
		logger.DefaultHelper.Warnf("presence: event bus unavailable actor=%s online=%v", actorID, online)
		return
	}
	ev := &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Presence{
			Presence: &realtime.PresenceFlip{
				ActorId: actorID,
				Online:  online,
			},
		},
	}
	for _, recipient := range recipients {
		if _, err := bus.Publish(recipient, ev); err != nil {
			logger.DefaultHelper.Warnf("presence: publish failed actor=%s recipient=%s online=%v err=%v", actorID, recipient, online, err)
		}
	}
}
