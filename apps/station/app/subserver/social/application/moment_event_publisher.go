package application

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
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

func (p *MomentEventPublisher) StageImportedCreated(
	ctx context.Context,
	transaction delivery.Transaction,
	postID string,
	authorPTID string,
	targetActorPTID string,
	audience model.Audience_Kind,
	_ uint64,
) error {
	if p == nil || postID == "" || authorPTID == "" || targetActorPTID == "" {
		return fmt.Errorf("imported Moment event identity is incomplete")
	}
	bus := p.bus
	if bus == nil {
		bus = events.GetBus
	}
	liveBus := bus()
	if liveBus == nil {
		return fmt.Errorf("Moment event bus is unavailable")
	}
	_, err := liveBus.PublishInTransaction(
		ctx,
		transaction,
		targetActorPTID,
		&realtime.StreamEvent{
			Kind: &realtime.StreamEvent_Moment{
				Moment: &realtime.MomentEvent{
					Kind:             realtime.MomentEvent_CREATED,
					PostId:           postID,
					AuthorActorPtid:  authorPTID,
					ActorPtid:        authorPTID,
					TargetActorPtid:  targetActorPTID,
					Audience:         audience.String(),
					OccurredTsUnixMs: p.now().UTC().UnixMilli(),
				},
			},
		},
	)
	return err
}

func (p *MomentEventPublisher) StageImportedCommented(
	ctx context.Context,
	transaction delivery.Transaction,
	postID string,
	commentID string,
	commentAuthorPTID string,
	targetActorPTID string,
) error {
	if p == nil ||
		postID == "" ||
		commentID == "" ||
		commentAuthorPTID == "" ||
		targetActorPTID == "" {
		return fmt.Errorf("private Comment event identity is incomplete")
	}
	bus := p.bus
	if bus == nil {
		bus = events.GetBus
	}
	liveBus := bus()
	if liveBus == nil {
		return fmt.Errorf("Moment event bus is unavailable")
	}
	_, err := liveBus.PublishInTransaction(
		ctx,
		transaction,
		targetActorPTID,
		&realtime.StreamEvent{
			Kind: &realtime.StreamEvent_Moment{
				Moment: &realtime.MomentEvent{
					Kind:             realtime.MomentEvent_COMMENTED,
					PostId:           postID,
					AuthorActorPtid:  commentAuthorPTID,
					ActorPtid:        commentAuthorPTID,
					TargetActorPtid:  targetActorPTID,
					CommentId:        commentID,
					OccurredTsUnixMs: p.now().UTC().UnixMilli(),
				},
			},
		},
	)
	return err
}

func (p *MomentEventPublisher) StagePrivateReacted(
	ctx context.Context,
	transaction delivery.Transaction,
	postID string,
	commentID string,
	reactionActorPTID string,
	targetActorPTID string,
	kind model.ReactionKind,
	removed bool,
) error {
	if p == nil ||
		postID == "" ||
		reactionActorPTID == "" ||
		targetActorPTID == "" ||
		kind == model.ReactionKind_REACTION_UNSPECIFIED {
		return fmt.Errorf("private Reaction event identity is incomplete")
	}
	bus := p.bus
	if bus == nil {
		bus = events.GetBus
	}
	liveBus := bus()
	if liveBus == nil {
		return fmt.Errorf("Moment event bus is unavailable")
	}
	_, err := liveBus.PublishInTransaction(
		ctx,
		transaction,
		targetActorPTID,
		&realtime.StreamEvent{
			Kind: &realtime.StreamEvent_Moment{
				Moment: &realtime.MomentEvent{
					Kind:             realtime.MomentEvent_REACTED,
					PostId:           postID,
					CommentId:        commentID,
					ActorPtid:        reactionActorPTID,
					TargetActorPtid:  targetActorPTID,
					ReactionKind:     kind.String(),
					Removed:          removed,
					OccurredTsUnixMs: p.now().UTC().UnixMilli(),
				},
			},
		},
	)
	return err
}

func (p *MomentEventPublisher) StageImportedRevoked(
	ctx context.Context,
	transaction delivery.Transaction,
	postID string,
	targetActorPTID string,
	reason privatecontentpb.PrivateResourceInvalidationReason,
) error {
	if p == nil ||
		postID == "" ||
		targetActorPTID == "" ||
		reason == privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_UNSPECIFIED {
		return fmt.Errorf("private revocation event identity is incomplete")
	}
	bus := p.bus
	if bus == nil {
		bus = events.GetBus
	}
	liveBus := bus()
	if liveBus == nil {
		return fmt.Errorf("Moment event bus is unavailable")
	}
	_, err := liveBus.PublishInTransaction(
		ctx,
		transaction,
		targetActorPTID,
		&realtime.StreamEvent{
			Kind: &realtime.StreamEvent_Moment{
				Moment: &realtime.MomentEvent{
					Kind:            realtime.MomentEvent_DELETED,
					PostId:          postID,
					TargetActorPtid: targetActorPTID,
					// The canonical realtime schema has no separate revocation
					// arm yet. Audience is otherwise unused for DELETED and
					// carries the closed invalidation-reason enum.
					Audience:         reason.String(),
					OccurredTsUnixMs: p.now().UTC().UnixMilli(),
				},
			},
		},
	)
	return err
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

	ev = proto.Clone(ev).(*realtime.MomentEvent)
	ev.TargetActorPtid = targetActorPTID
	if _, err := liveBus.Publish(targetActorPTID, &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Moment{Moment: ev},
	}); err != nil {
		logger.Warn(
			ctx,
			"moment.realtime: publish failed",
			"kind",
			ev.Kind.String(),
			"error",
			err,
		)
	}
}

func audienceKind(audience *model.Audience) string {
	if audience == nil {
		return model.Audience_PUBLIC.String()
	}
	return audience.Kind.String()
}
