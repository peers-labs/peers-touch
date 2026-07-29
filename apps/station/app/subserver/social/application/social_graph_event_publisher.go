package application

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

type SocialGraphEventPublisher struct {
	bus func() events.EventBus
}

func NewSocialGraphEventPublisher() *SocialGraphEventPublisher {
	return &SocialGraphEventPublisher{
		bus: events.GetBus,
	}
}

func (p *SocialGraphEventPublisher) PublishFriendRequestReceived(ctx context.Context, senderDID, receiverDID, requestID string) {
	p.publish(ctx, receiverDID, &realtime.SocialGraphEvent{
		Kind:      realtime.SocialGraphEvent_FRIEND_REQUEST_RECEIVED,
		ActorDid:  senderDID,
		TargetDid: receiverDID,
		RequestId: requestID,
	})
}

func (p *SocialGraphEventPublisher) PublishFriendRequestAccepted(ctx context.Context, accepterDID, senderDID, requestID, conversationID string) {
	ev := &realtime.SocialGraphEvent{
		Kind:           realtime.SocialGraphEvent_FRIEND_REQUEST_ACCEPTED,
		ActorDid:       accepterDID,
		TargetDid:      senderDID,
		RequestId:      requestID,
		ConversationId: conversationID,
	}
	p.publish(ctx, senderDID, ev)

	if conversationID != "" {
		convEv := &realtime.SocialGraphEvent{
			Kind:           realtime.SocialGraphEvent_CONVERSATION_CREATED,
			ActorDid:       accepterDID,
			TargetDid:      senderDID,
			ConversationId: conversationID,
		}
		p.publish(ctx, accepterDID, convEv)
		p.publish(ctx, senderDID, convEv)
	}
}

func (p *SocialGraphEventPublisher) publish(ctx context.Context, targetDID string, ev *realtime.SocialGraphEvent) {
	liveBus := p.bus()
	if liveBus == nil {
		return
	}
	if targetDID == "" {
		return
	}
	if _, err := liveBus.Publish(targetDID, &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_SocialGraphEvent{SocialGraphEvent: ev},
	}); err != nil {
		logger.Warn(ctx, "social.realtime: publish failed", "target_did", targetDID, "kind", ev.Kind.String(), "error", err)
	}
}
