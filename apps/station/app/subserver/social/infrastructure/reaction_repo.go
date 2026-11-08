package infrastructure

import (
	"context"
	"fmt"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// reactionRepo implements `domain.ReactionRepository` against the
// `social_reactions` table. Toggling a reaction on/off is a clean
// Insert/Delete on the composite key `(post_id, comment_id, actor_id, kind)` —
// no soft-delete, no version stamps; reaction churn is high enough
// that physical deletes keep the table size bounded.
type reactionRepo struct {
	db       *gorm.DB
	identity *ActorIdentity
}

func NewReactionRepository(gdb *gorm.DB) domain.ReactionRepository {
	return &reactionRepo{db: gdb, identity: NewActorIdentity(gdb)}
}

// Add inserts a reaction; idempotent on the composite key (re-adding
// is a no-op via INSERT...ON CONFLICT DO NOTHING semantics).
func (r *reactionRepo) Add(ctx context.Context, react *domain.Reaction) error {
	actorID, err := r.identity.RequireID(ctx, react.ActorPTID)
	if err != nil {
		return err
	}
	row := db.SocialReaction{
		PostID:    react.PostID,
		ActorID:   actorID,
		Kind:      react.Kind.String(),
		PostClass: string(react.PostClass),
		CreatedAt: time.Now(),
	}
	// `clause.OnConflict{DoNothing:true}` would be cleaner but pulls in
	// a dialect dependency; the explicit double-check below works for
	// both sqlite and postgres without driver-specific clauses.
	var existing int64
	if err := r.db.WithContext(ctx).
		Model(&db.SocialReaction{}).
		Where("post_id = ? AND comment_id = '' AND actor_id = ? AND kind = ?",
			react.PostID, actorID, react.Kind.String()).
		Count(&existing).Error; err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}
	return r.db.WithContext(ctx).Create(&row).Error
}

func (r *reactionRepo) Remove(ctx context.Context, postID string, actorPTID string, kind domain.ReactionKindStr) error {
	actorID, err := r.identity.RequireID(ctx, actorPTID)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).
		Where("post_id = ? AND comment_id = '' AND actor_id = ? AND kind = ?", postID, actorID, kind).
		Delete(&db.SocialReaction{}).Error
}

func (r *reactionRepo) ListByPost(ctx context.Context, postID string) ([]domain.Reaction, error) {
	return r.listByPost(ctx, r.db, postID)
}

func (r *reactionRepo) ListByComments(ctx context.Context, postID string, commentIDs []string) (map[string][]domain.Reaction, error) {
	out := make(map[string][]domain.Reaction)
	if len(commentIDs) == 0 {
		return out, nil
	}
	if len(commentIDs) > 100 {
		return nil, fmt.Errorf("comment reaction read exceeds 100 targets")
	}
	var rows []db.SocialReaction
	if err := r.db.WithContext(ctx).
		Where("post_id = ? AND comment_id IN ? AND post_class = ?", postID, commentIDs, domain.PostClassPublic).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	actorIDs := make([]uint64, 0, len(rows))
	for _, row := range rows {
		actorIDs = append(actorIDs, row.ActorID)
	}
	ptids, err := r.identity.PTIDsByIDs(ctx, actorIDs)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		kind, valid := model.ReactionKind_value[row.Kind]
		if !valid || kind == 0 || ptids[row.ActorID] == "" {
			return nil, fmt.Errorf("comment reaction projection is invalid")
		}
		out[row.CommentID] = append(out[row.CommentID], domain.Reaction{
			PostID: row.PostID, PostClass: domain.PostClass(row.PostClass),
			ActorPTID: ptids[row.ActorID], Kind: model.ReactionKind(kind), CreatedAt: row.CreatedAt,
		})
	}
	return out, nil
}

func (r *reactionRepo) listByPost(
	ctx context.Context,
	database *gorm.DB,
	postID string,
) ([]domain.Reaction, error) {
	return r.listByTarget(ctx, database, postID, "")
}

func (r *reactionRepo) listByTarget(
	ctx context.Context, database *gorm.DB, postID, commentID string,
) ([]domain.Reaction, error) {
	identity := NewActorIdentity(database)
	var rows []db.SocialReaction
	if err := database.WithContext(ctx).
		Where("post_id = ? AND comment_id = ?", postID, commentID).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]domain.Reaction, 0, len(rows))
	for _, row := range rows {
		actorPTID, err := identity.ResolveID(ctx, row.ActorID)
		if err != nil {
			return nil, err
		}
		kind := model.ReactionKind_value[row.Kind]
		out = append(out, domain.Reaction{
			PostID:    row.PostID,
			PostClass: domain.PostClass(row.PostClass),
			ActorPTID: actorPTID,
			Kind:      model.ReactionKind(kind),
			CreatedAt: row.CreatedAt,
		})
	}
	return out, nil
}

// Aggregate returns one ReactionSummary per non-zero kind. Kinds with
// zero count are omitted from the result so callers can render "0
// reactions" by checking `len(summaries) == 0` without iterating.
func (r *reactionRepo) Aggregate(ctx context.Context, postID string) ([]domain.ReactionSummary, error) {
	type aggRow struct {
		Kind  string
		Count int64
	}
	var rows []aggRow
	err := r.db.WithContext(ctx).
		Model(&db.SocialReaction{}).
		Select("kind, COUNT(*) AS count").
		Where("post_id = ? AND comment_id = ''", postID).
		Group("kind").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]domain.ReactionSummary, 0, len(rows))
	for _, row := range rows {
		kind := model.ReactionKind_value[row.Kind]
		out = append(out, domain.ReactionSummary{
			Kind:  model.ReactionKind(kind),
			Count: row.Count,
		})
	}
	return out, nil
}

func (r *reactionRepo) IsReactedByViewer(ctx context.Context, postID string, viewerPTID string, kind domain.ReactionKindStr) (bool, error) {
	if viewerPTID == "" {
		return false, nil
	}
	viewerID, err := r.identity.RequireID(ctx, viewerPTID)
	if err != nil {
		return false, err
	}
	var count int64
	err = r.db.WithContext(ctx).
		Model(&db.SocialReaction{}).
		Where("post_id = ? AND comment_id = '' AND actor_id = ? AND kind = ?", postID, viewerID, kind).
		Count(&count).Error
	return count > 0, err
}

func (r *reactionRepo) HydrateReactedByViewer(ctx context.Context, postID string, viewerPTID string, summaries []domain.ReactionSummary) ([]domain.ReactionSummary, error) {
	if viewerPTID == "" || len(summaries) == 0 {
		return summaries, nil
	}
	viewerID, err := r.identity.RequireID(ctx, viewerPTID)
	if err != nil {
		return nil, err
	}
	var kinds []string
	err = r.db.WithContext(ctx).
		Model(&db.SocialReaction{}).
		Where("post_id = ? AND comment_id = '' AND actor_id = ?", postID, viewerID).
		Pluck("kind", &kinds).Error
	if err != nil {
		return summaries, err
	}
	have := make(map[string]struct{}, len(kinds))
	for _, k := range kinds {
		have[k] = struct{}{}
	}
	for i := range summaries {
		if _, ok := have[summaries[i].Kind.String()]; ok {
			summaries[i].ReactedByViewer = true
		}
	}
	return summaries, nil
}
