package application

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

// NewFeedWritePolicy preserves the original Social read authority for local
// signed commands. Imported history is authenticated separately and filtered
// by viewer policy when read; changing block state never rewrites that history.
func NewFeedWritePolicy() func(context.Context, delivery.Transaction, *model.FeedEvent) error {
	return func(ctx context.Context, tx delivery.Transaction, event *model.FeedEvent) error {
		var existing infrastructure.FeedEventRecord
		err := tx.DB().WithContext(ctx).Where("actor_ptid = ? AND chain_id = ? AND sequence = ?",
			event.Statement.ActorPtid, event.Statement.ChainId, event.Statement.Sequence).Take(&existing).Error
		if err == nil {
			// The append owner verifies exact replay or commits fork quarantine.
			// Mutable target policy must not turn either into a different result.
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		payload := &model.FeedPayload{}
		if err := signedlog.Decode(event.Payload, payload); err != nil {
			return err
		}
		target := payload.GetReaction().GetTargetPostRef()
		if c := payload.GetComment(); c != nil {
			target = c.TargetPostRef
		}
		if p := payload.GetPost(); p != nil && len(p.CreateRequest) > 0 {
			request := &model.CreatePostRequest{}
			if err := signedlog.Decode(p.CreateRequest, request); err != nil {
				return err
			}
			if repost := request.GetRepost(); repost != nil {
				target = repost.OriginalPostId
			}
		}
		if target == "" {
			return nil
		}
		home, objectID, err := domain.FeedTargetPost(target)
		if err != nil {
			return err
		}
		var object infrastructure.FeedObjectRecord
		err = tx.DB().Where("home_station = ? AND object_kind = 'post' AND object_id = ?", home, objectID).Take(&object).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domain.ErrFeedWriter
		}
		if err != nil {
			return err
		}
		reader := NewPublicReadPort(infrastructure.NewRepos(tx.DB()))
		batch, err := reader.Read(ctx, event.Statement.ActorPtid, []uint64{object.LocalID}, nil)
		if err != nil {
			return err
		}
		if batch.Posts[object.LocalID] == nil {
			return domain.ErrFeedWriter
		}
		if reaction := payload.GetReaction(); reaction != nil && reaction.TargetCommentRef != "" {
			commentHome, commentID, err := domain.FeedTargetComment(reaction.TargetCommentRef)
			if err != nil {
				return err
			}
			var target infrastructure.FeedObjectRecord
			if err := tx.DB().Where("home_station = ? AND object_kind = 'comment' AND object_id = ?",
				commentHome, commentID).Take(&target).Error; err != nil {
				return domain.ErrFeedWriter
			}
			comments, err := reader.Read(ctx, event.Statement.ActorPtid, []uint64{object.LocalID}, []uint64{target.LocalID})
			if err != nil {
				return err
			}
			if comment := comments.Comments[target.LocalID]; comment == nil || comment.PostID != object.LocalID {
				return domain.ErrFeedWriter
			}
		}
		return nil
	}
}
