package infrastructure

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// projectComment applies a comment create/update/tombstone receipt. Behavior
// is unchanged from the former inline branch of projectInteraction; it now
// lives behind the interaction registry.
func (p *FeedProjector) projectComment(ctx context.Context, in InteractionInput, authorID uint64) error {
	tx, receipt, payload, post, home := in.Tx, in.Receipt, in.Payload, in.Post, in.Home
	event := receipt.Event
	c := payload.GetComment()
	when := time.UnixMilli(event.Statement.CreatedAtUnixMs).UTC()
	key := FeedObjectRecord{HomeStation: home, ObjectKind: "comment", ObjectID: c.CommentId}
	var commentObject FeedObjectRecord
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("home_station = ? AND object_kind = 'comment' AND object_id = ?", home, c.CommentId).
		Take(&commentObject).Error
	kind := event.Statement.Kind
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if kind != model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED {
			return domain.ErrFeedGap
		}
		key.ActorPTID, key.Sequence = event.Statement.ActorPtid, event.Statement.Sequence
		key.LocalID, _ = domain.FeedObjectID(c.CommentId)
		if home != p.localStation {
			key.LocalID = id.NextID()
		}
		commentObject = key
	} else if err != nil {
		return err
	} else {
		if commentObject.ActorPTID != event.Statement.ActorPtid {
			return domain.ErrFeedWriter
		}
		if commentObject.Sequence >= event.Statement.Sequence {
			return nil
		}
		if kind == model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED {
			return domain.ErrFeedInvalid
		}
	}
	var existing db.SocialComment
	if kind != model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED {
		if err := tx.Where("id = ? AND post_id = ? AND author_id = ? AND post_class = 'public'",
			commentObject.LocalID, post.ID, authorID).Take(&existing).Error; err != nil {
			return err
		}
		if existing.DeletedAt != nil {
			return nil
		}
	}
	if kind == model.FeedEventKind_FEED_EVENT_KIND_COMMENT_TOMBSTONED {
		if err := tx.Model(&existing).Updates(map[string]interface{}{"deleted_at": when, "updated_at": when}).Error; err != nil {
			return err
		}
	} else {
		request := &model.CreateCommentRequest{}
		if err := signedlog.Decode(c.CreateRequest, request); err != nil {
			return err
		}
		mentions, err := domain.ValidateTypedMentions(request.Content, request.TypedMentions)
		if err != nil {
			return err
		}
		for _, actor := range domain.MentionActorPTIDs(mentions) {
			if _, err := NewActorIdentity(tx).RequireID(ctx, actor); err != nil {
				return err
			}
		}
		var parentID *uint64
		if request.ReplyToCommentId != "" {
			parentHome, parentObjectID, err := domain.FeedTargetComment(request.ReplyToCommentId)
			if err != nil {
				return err
			}
			var parentObject FeedObjectRecord
			err = tx.Where("home_station = ? AND object_kind = 'comment' AND object_id = ?",
				parentHome, parentObjectID).Take(&parentObject).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrFeedGap
			}
			if err != nil {
				return err
			}
			n := parentObject.LocalID
			var parent db.SocialComment
			err = tx.Where("id = ? AND post_id = ? AND post_class = 'public' AND deleted_at IS NULL", n, post.ID).
				Take(&parent).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrFeedGap
			}
			if err != nil {
				return err
			}
			if parent.ParentCommentID != nil {
				return domain.ErrFeedInvalid
			}
			parentID = &n
		}
		encoded, err := json.Marshal(mentions)
		if err != nil {
			return err
		}
		if kind == model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED {
			if err := tx.Create(&commentObject).Error; err != nil {
				return err
			}
			if err := tx.Create(&db.SocialComment{ID: commentObject.LocalID, PostID: post.ID,
				PostClass: db.PostClassPublic, AuthorID: authorID, ParentCommentID: parentID,
				TextBody: request.Content, MentionsJSON: string(encoded), CreatedAt: when, UpdatedAt: when}).Error; err != nil {
				return err
			}
		} else {
			if (existing.ParentCommentID == nil) != (parentID == nil) ||
				(parentID != nil && *existing.ParentCommentID != *parentID) {
				return domain.ErrFeedInvalid
			}
			if err := tx.Model(&existing).Updates(map[string]interface{}{
				"text_body": request.Content, "mentions_json": string(encoded), "edited_at": when, "updated_at": when}).Error; err != nil {
				return err
			}
		}
	}
	if err := tx.Model(&commentObject).Update("sequence", event.Statement.Sequence).Error; err != nil {
		return err
	}
	return tx.Model(post).UpdateColumn("comments_count", tx.Model(&db.SocialComment{}).
		Select("COUNT(*)").Where("post_id = ? AND post_class = 'public' AND deleted_at IS NULL", post.ID)).Error
}

type commentInteractionHandler struct{ projector *FeedProjector }

func (commentInteractionHandler) Match(payload *model.FeedPayload) bool {
	return payload.GetComment() != nil
}

func (h commentInteractionHandler) Project(ctx context.Context, in InteractionInput) error {
	authorID, err := NewActorIdentity(in.Tx).RequireID(ctx, in.Receipt.Event.Statement.ActorPtid)
	if err != nil {
		return err
	}
	return h.projector.projectComment(ctx, in, authorID)
}