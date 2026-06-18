package application

import (
	"context"
	"strconv"
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

func (p *MomentEventPublisher) PublishCreated(ctx context.Context, postID, authorID uint64, audience *model.Audience) {
	p.publish(ctx, authorID, &realtime.MomentEvent{
		Kind:             realtime.MomentEvent_CREATED,
		PostId:           strconv.FormatUint(postID, 10),
		AuthorActorId:    p.actorStreamID(authorID),
		ActorId:          p.actorStreamID(authorID),
		Audience:         audienceKind(audience),
		OccurredTsUnixMs: p.now().UTC().UnixMilli(),
	})
}

func (p *MomentEventPublisher) PublishDeleted(ctx context.Context, postID, authorID uint64) {
	p.publish(ctx, authorID, &realtime.MomentEvent{
		Kind:             realtime.MomentEvent_DELETED,
		PostId:           strconv.FormatUint(postID, 10),
		AuthorActorId:    p.actorStreamID(authorID),
		ActorId:          p.actorStreamID(authorID),
		OccurredTsUnixMs: p.now().UTC().UnixMilli(),
	})
}

func (p *MomentEventPublisher) PublishCommented(ctx context.Context, postID, postAuthorID, commentID, commentAuthorID uint64) {
	p.publish(ctx, commentAuthorID, &realtime.MomentEvent{
		Kind:             realtime.MomentEvent_COMMENTED,
		PostId:           strconv.FormatUint(postID, 10),
		AuthorActorId:    p.actorStreamID(postAuthorID),
		ActorId:          p.actorStreamID(commentAuthorID),
		CommentId:        strconv.FormatUint(commentID, 10),
		OccurredTsUnixMs: p.now().UTC().UnixMilli(),
	})
}

func (p *MomentEventPublisher) PublishReacted(ctx context.Context, postID, reactionActorID uint64, kind model.ReactionKind, removed bool) {
	p.publish(ctx, reactionActorID, &realtime.MomentEvent{
		Kind:             realtime.MomentEvent_REACTED,
		PostId:           strconv.FormatUint(postID, 10),
		ActorId:          p.actorStreamID(reactionActorID),
		ReactionKind:     kind.String(),
		Removed:          removed,
		OccurredTsUnixMs: p.now().UTC().UnixMilli(),
	})
}

func (p *MomentEventPublisher) publish(ctx context.Context, targetActorID uint64, ev *realtime.MomentEvent) {
	if p == nil || targetActorID == 0 || ev == nil {
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

	streamID := p.actorStreamID(targetActorID)
	if streamID == "" {
		logger.Warn(ctx, "moment.realtime: target actor stream is empty", "target_actor_id", targetActorID, "post_id", ev.PostId, "kind", ev.Kind.String())
		return
	}

	if _, err := liveBus.Publish(streamID, &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Moment{Moment: ev},
	}); err != nil {
		logger.Warn(ctx, "moment.realtime: publish failed", "target_actor_id", targetActorID, "post_id", ev.PostId, "kind", ev.Kind.String(), "error", err)
	}
}

func (p *MomentEventPublisher) actorStreamID(actorID uint64) string {
	if actorID == 0 {
		return ""
	}
	return strconv.FormatUint(actorID, 10)
}

func audienceKind(audience *model.Audience) string {
	if audience == nil {
		return model.Audience_PUBLIC.String()
	}
	return audience.Kind.String()
}

func parseActorID(value string) uint64 {
	id, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0
	}
	return id
}
