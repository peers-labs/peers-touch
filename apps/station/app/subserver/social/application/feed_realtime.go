package application

import (
	"context"
	"fmt"
	"strconv"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

// Realtime is a durable invalidation hint. Readers still verify original bytes.
// The original publisher's scope is self echo plus the target post author.
func (p *MomentEventPublisher) FeedObserver() infrastructure.FeedProjectionObserver {
	return func(ctx context.Context, _ *gorm.DB, event *model.FeedEvent, postID uint64, postAuthor string) error {
		transaction := infrastructure.FeedTransactionFromContext(ctx)
		if transaction == nil {
			return fmt.Errorf("feed projection transaction unavailable")
		}
		bus := p.bus
		if bus == nil {
			bus = events.GetBus
		}
		live := bus()
		if live == nil {
			return fmt.Errorf("feed event bus unavailable")
		}
		payload := &model.FeedPayload{}
		if err := signedlog.Decode(event.Payload, payload); err != nil {
			return err
		}
		notice := &realtime.MomentEvent{Kind: realtime.MomentEvent_UPDATED, PostId: strconv.FormatUint(postID, 10),
			AuthorActorPtid: postAuthor, ActorPtid: event.Statement.ActorPtid, Audience: model.Audience_PUBLIC.String(),
			OccurredTsUnixMs: event.Statement.CreatedAtUnixMs}
		if event.Statement.Kind == model.FeedEventKind_FEED_EVENT_KIND_POST_CREATED {
			notice.Kind = realtime.MomentEvent_CREATED
		}
		if event.Statement.Kind == model.FeedEventKind_FEED_EVENT_KIND_POST_TOMBSTONED {
			notice.Kind = realtime.MomentEvent_DELETED
			notice.Audience = ""
		}
		if comment := payload.GetComment(); comment != nil {
			notice.Kind, notice.CommentId = realtime.MomentEvent_COMMENTED, comment.CommentId
		}
		if reaction := payload.GetReaction(); reaction != nil {
			notice.Kind, notice.ReactionKind = realtime.MomentEvent_REACTED, model.ReactionKind(reaction.ReactionKind).String()
			notice.Removed = event.Statement.Kind == model.FeedEventKind_FEED_EVENT_KIND_REACTION_REMOVED
			if reaction.TargetCommentRef != "" {
				_, commentID, err := domain.FeedTargetComment(reaction.TargetCommentRef)
				if err != nil {
					return err
				}
				notice.CommentId = commentID
			}
		}
		targets := []string{event.Statement.ActorPtid}
		if postAuthor != event.Statement.ActorPtid {
			targets = append(targets, postAuthor)
		}
		for _, target := range targets {
			viewerNotice := proto.Clone(notice).(*realtime.MomentEvent)
			viewerNotice.TargetActorPtid = target
			if _, err := live.PublishInTransaction(ctx, transaction, target, &realtime.StreamEvent{
				Kind: &realtime.StreamEvent_Moment{Moment: viewerNotice}}); err != nil {
				return err
			}
		}
		return nil
	}
}
