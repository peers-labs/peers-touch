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

func (p *SocialGraphEventPublisher) PublishFriendRequestReceived(ctx context.Context, senderPTID, receiverPTID, requestID string) {
	p.publish(ctx, receiverPTID, &realtime.SocialGraphEvent{
		Kind:       realtime.SocialGraphEvent_FRIEND_REQUEST_RECEIVED,
		ActorPtid:  senderPTID,
		TargetPtid: receiverPTID,
		RequestId:  requestID,
	})
}

func (p *SocialGraphEventPublisher) PublishFriendRequestAccepted(ctx context.Context, accepterPTID, senderPTID, requestID, conversationID string) {
	ev := &realtime.SocialGraphEvent{
		Kind:           realtime.SocialGraphEvent_FRIEND_REQUEST_ACCEPTED,
		ActorPtid:      accepterPTID,
		TargetPtid:     senderPTID,
		RequestId:      requestID,
		ConversationId: conversationID,
	}
	p.publish(ctx, senderPTID, ev)

	if conversationID != "" {
		convEv := &realtime.SocialGraphEvent{
			Kind:           realtime.SocialGraphEvent_CONVERSATION_CREATED,
			ActorPtid:      accepterPTID,
			TargetPtid:     senderPTID,
			ConversationId: conversationID,
		}
		p.publish(ctx, accepterPTID, convEv)
		p.publish(ctx, senderPTID, convEv)
	}
}

func (p *SocialGraphEventPublisher) PublishRelationshipChanged(
	ctx context.Context,
	recipientPTID string,
	actorPTID string,
	targetPTID string,
	blocked bool,
) {
	kind := realtime.SocialGraphEvent_RELATIONSHIP_UNBLOCKED
	if blocked {
		kind = realtime.SocialGraphEvent_RELATIONSHIP_BLOCKED
	}
	p.publish(ctx, recipientPTID, &realtime.SocialGraphEvent{
		Kind:       kind,
		ActorPtid:  actorPTID,
		TargetPtid: targetPTID,
	})
}

func (p *SocialGraphEventPublisher) publish(ctx context.Context, targetPTID string, ev *realtime.SocialGraphEvent) {
	liveBus := p.bus()
	if liveBus == nil {
		return
	}
	if targetPTID == "" {
		return
	}
	if _, err := liveBus.Publish(targetPTID, &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_SocialGraphEvent{SocialGraphEvent: ev},
	}); err != nil {
		logger.Warn(ctx, "social.realtime: publish failed", "target_ptid", targetPTID, "kind", ev.Kind.String(), "error", err)
	}
}
