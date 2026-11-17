package infrastructure

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// projectReaction applies a reaction set/removal receipt to the public post
// (or one of its comments). Behavior is unchanged from the former inline
// branch of projectInteraction; it now lives behind the interaction registry.
func (p *FeedProjector) projectReaction(ctx context.Context, in InteractionInput, authorID uint64) error {
	tx, receipt, payload, post, target := in.Tx, in.Receipt, in.Payload, in.Post, in.Target
	event := receipt.Event
	reaction := payload.GetReaction()
	when := time.UnixMilli(event.Statement.CreatedAtUnixMs).UTC()
	targetRef, commentID := target, ""
	var comment db.SocialComment
	if reaction.TargetCommentRef != "" {
		commentHome, commentObjectID, err := domain.FeedTargetComment(reaction.TargetCommentRef)
		if err != nil {
			return err
		}
		var commentObject FeedObjectRecord
		err = tx.Where("home_station = ? AND object_kind = 'comment' AND object_id = ?",
			commentHome, commentObjectID).Take(&commentObject).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domain.ErrFeedGap
		}
		if err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND post_class = 'public'", commentObject.LocalID).Take(&comment).Error; err != nil {
			return err
		}
		if comment.PostID != post.ID {
			return domain.ErrFeedInvalid
		}
		if comment.DeletedAt != nil {
			return nil
		}
		targetRef, commentID = reaction.TargetCommentRef, strconv.FormatUint(comment.ID, 10)
	}
	version := FeedReactionVersion{TargetRef: targetRef, ActorPTID: event.Statement.ActorPtid, Kind: reaction.ReactionKind}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&version).Error; err != nil {
		return err
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("target_ref = ? AND actor_ptid = ? AND kind = ?", targetRef, version.ActorPTID, version.Kind).
		Take(&version).Error; err != nil {
		return err
	}
	if version.Sequence >= event.Statement.Sequence {
		return nil
	}
	row := db.SocialReaction{PostID: strconv.FormatUint(post.ID, 10), CommentID: commentID, ActorID: authorID,
		Kind: model.ReactionKind(reaction.ReactionKind).String(), PostClass: db.PostClassPublic, CreatedAt: when}
	var err error
	if event.Statement.Kind == model.FeedEventKind_FEED_EVENT_KIND_REACTION_REMOVED {
		err = tx.Where("post_id = ? AND comment_id = ? AND actor_id = ? AND kind = ? AND post_class = 'public'",
			row.PostID, row.CommentID, row.ActorID, row.Kind).Delete(&db.SocialReaction{}).Error
	} else {
		err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
	}
	if err != nil {
		return err
	}
	if err := tx.Model(&version).Update("sequence", event.Statement.Sequence).Error; err != nil {
		return err
	}
	if commentID != "" {
		return nil
	}
	var counts []struct {
		Kind  string
		Count int64
	}
	if err := tx.Model(&db.SocialReaction{}).Select("kind, COUNT(*) AS count").
		Where("post_id = ? AND comment_id = '' AND post_class = 'public'", row.PostID).Group("kind").Scan(&counts).Error; err != nil {
		return err
	}
	snapshot := make(map[string]int64, len(counts))
	for _, count := range counts {
		snapshot[count.Kind] = count.Count
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	// Counts are derived interaction state. GORM's Update would also
	// rewrite updated_at, which belongs to the author's signed post event.
	return tx.Model(post).UpdateColumn("reactions_count_json", string(encoded)).Error
}

type reactionInteractionHandler struct{ projector *FeedProjector }

func (reactionInteractionHandler) Match(payload *model.FeedPayload) bool {
	return payload.GetReaction() != nil
}

func (h reactionInteractionHandler) Project(ctx context.Context, in InteractionInput) error {
	authorID, err := NewActorIdentity(in.Tx).RequireID(ctx, in.Receipt.Event.Statement.ActorPtid)
	if err != nil {
		return err
	}
	return h.projector.projectReaction(ctx, in, authorID)
}