package application

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

// MomentEventPublisher bridges committed social writes into the unified
// realtime stream. It deliberately publishes only actor-scoped self echo
// in this phase; full audience fan-out belongs to the Delivery Inbox so
// visibility decisions stay durable and auditable.
type MomentEventPublisher struct {
	bus func() events.EventBus
	now func() time.Time
}

func NewMomentEventPublisher() *MomentEventPublisher {
	return &MomentEventPublisher{
		bus: events.GetBus,
		now: time.Now,
	}
}

func (p *MomentEventPublisher) PublishCreated(ctx context.Context, postID uint64, authorPTID string, audience *model.Audience) {
	p.publish(ctx, authorPTID, &realtime.MomentEvent{
		Kind:             realtime.MomentEvent_CREATED,
		PostId:           fmt.Sprintf("%d", postID),
		AuthorActorPtid:  authorPTID,
		ActorPtid:        authorPTID,
		Audience:         audienceKind(audience),
		OccurredTsUnixMs: p.now().UTC().UnixMilli(),
	})
}

func (p *MomentEventPublisher) PublishDeleted(ctx context.Context, postID uint64, authorPTID string) {
	p.publish(ctx, authorPTID, &realtime.MomentEvent{
		Kind:             realtime.MomentEvent_DELETED,
		PostId:           fmt.Sprintf("%d", postID),
		AuthorActorPtid:  authorPTID,
		ActorPtid:        authorPTID,
		OccurredTsUnixMs: p.now().UTC().UnixMilli(),
	})
}

func (p *MomentEventPublisher) PublishCommented(ctx context.Context, postID uint64, postAuthorPTID string, commentID uint64, commentAuthorPTID string) {
	p.publish(ctx, commentAuthorPTID, &realtime.MomentEvent{
		Kind:             realtime.MomentEvent_COMMENTED,
		PostId:           fmt.Sprintf("%d", postID),
		AuthorActorPtid:  postAuthorPTID,
		ActorPtid:        commentAuthorPTID,
		CommentId:        fmt.Sprintf("%d", commentID),
		OccurredTsUnixMs: p.now().UTC().UnixMilli(),
	})
}

func (p *MomentEventPublisher) PublishReacted(ctx context.Context, postID string, reactionActorPTID string, kind model.ReactionKind, removed bool) {
	p.publish(ctx, reactionActorPTID, &realtime.MomentEvent{
		Kind:             realtime.MomentEvent_REACTED,
		PostId:           postID,
		ActorPtid:        reactionActorPTID,
		ReactionKind:     kind.String(),
		Removed:          removed,
		OccurredTsUnixMs: p.now().UTC().UnixMilli(),
	})
}

func (p *MomentEventPublisher) publish(ctx context.Context, targetActorPTID string, ev *realtime.MomentEvent) {
	if p == nil || targetActorPTID == "" || ev == nil {
		return
	}
	bus := p.bus
	if bus == nil {
		bus = events.GetBus
	}
	liveBus := bus()
	if liveBus == nil {
		return
	}

	if _, err := liveBus.Publish(targetActorPTID, &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Moment{Moment: ev},
	}); err != nil {
		logger.Warn(ctx, "moment.realtime: publish failed", "target_actor_ptid", targetActorPTID, "post_id", ev.PostId, "kind", ev.Kind.String(), "error", err)
	}
}

func audienceKind(audience *model.Audience) string {
	if audience == nil {
		return model.Audience_PUBLIC.String()
	}
	return audience.Kind.String()
}
