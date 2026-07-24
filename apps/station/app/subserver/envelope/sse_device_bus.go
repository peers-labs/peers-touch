package envelope

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

// SSEDeviceBus bridges the envelope delivery subsystem into the
// realtime SSE event stream. It implements DeviceBus by constructing
// an EnvelopeDelivered StreamEvent and publishing to the actor's (or
// device's) stream via the events.GetBus() global accessor.
type SSEDeviceBus struct{}

// NewSSEDeviceBus creates a new SSE device bus adapter.
func NewSSEDeviceBus() *SSEDeviceBus {
	return &SSEDeviceBus{}
}

func (b *SSEDeviceBus) PublishToDevice(_ context.Context, recipientPtid, deviceID, inboxItemID string, env *chat.StationEnvelope) bool {
	bus := events.GetBus()
	if bus == nil {
		return false
	}
	ev := buildEnvelopeDeliveredEvent(inboxItemID, env)
	_, err := bus.PublishToDevice(recipientPtid, deviceID, ev)
	return err == nil
}

func (b *SSEDeviceBus) PublishToActor(_ context.Context, recipientPtid, inboxItemID string, env *chat.StationEnvelope) int {
	bus := events.GetBus()
	if bus == nil {
		return 0
	}
	ev := buildEnvelopeDeliveredEvent(inboxItemID, env)
	_, err := bus.Publish(recipientPtid, ev)
	if err != nil {
		return 0
	}
	return 1
}

func buildEnvelopeDeliveredEvent(inboxItemID string, env *chat.StationEnvelope) *realtime.StreamEvent {
	return &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_EnvelopeDelivered{
			EnvelopeDelivered: &realtime.EnvelopeDelivered{
				InboxItemId:       inboxItemID,
				EnvelopeId:        env.GetEnvelopeId(),
				ConversationId:    env.GetConversationId(),
				PayloadType:       int32(env.GetPayloadType()),
				PayloadBytes:      env.GetPayloadBytes(),
				SenderPtid:        env.GetSenderPtid(),
				SenderDeviceId:    env.GetSenderDeviceId(),
				RecipientDeviceId: env.GetRecipientDeviceId(),
				MembershipEpoch:   env.GetMembershipEpoch(),
				QueuedTsUnixMs:    time.Now().UnixMilli(),
			},
		},
	}
}
