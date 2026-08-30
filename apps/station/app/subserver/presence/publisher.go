package presence

import (
	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

type eventBusPublisher struct{}

func (eventBusPublisher) PublishPresence(actorPTID string, online bool, recipients []string) {
	bus := events.GetBus()
	if bus == nil {
		logger.DefaultHelper.Warnf("presence: event bus unavailable actor_ptid=%s online=%v", actorPTID, online)
		return
	}
	ev := &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Presence{
			Presence: &realtime.PresenceFlip{
				ActorPtid: actorPTID,
				Online:    online,
			},
		},
	}
	for _, recipient := range recipients {
		if _, err := bus.Publish(recipient, ev); err != nil {
			logger.DefaultHelper.Warnf("presence: publish failed actor_ptid=%s recipient_ptid=%s online=%v err=%v", actorPTID, recipient, online, err)
		}
	}
}
