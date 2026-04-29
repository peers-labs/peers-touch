package infrastructure

import (
	"context"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// reactionRepo implements `domain.ReactionRepository` against the
// `social_reactions` table. Toggling a reaction on/off is a clean
// Insert/Delete on the composite key `(post_id, actor_id, kind)` —
// no soft-delete, no version stamps; reaction churn is high enough
// that physical deletes keep the table size bounded.
type reactionRepo struct {
	db *gorm.DB
}

func NewReactionRepository(gdb *gorm.DB) domain.ReactionRepository {
	return &reactionRepo{db: gdb}
}

// Add inserts a reaction; idempotent on the composite key (re-adding
// is a no-op via INSERT...ON CONFLICT DO NOTHING semantics).
func (r *reactionRepo) Add(ctx context.Context, react *domain.Reaction) error {
	row := db.SocialReaction{
		PostID:    react.PostID,
		ActorID:   react.ActorID,
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
		Where("post_id = ? AND actor_id = ? AND kind = ?",
			react.PostID, react.ActorID, react.Kind.String()).
		Count(&existing).Error; err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}
	return r.db.WithContext(ctx).Create(&row).Error
}

func (r *reactionRepo) Remove(ctx context.Context, postID, actorID uint64, kind domain.ReactionKindStr) error {
	return r.db.WithContext(ctx).
		Where("post_id = ? AND actor_id = ? AND kind = ?", postID, actorID, kind).
		Delete(&db.SocialReaction{}).Error
}

// Aggregate returns one ReactionSummary per non-zero kind. Kinds with
// zero count are omitted from the result so callers can render "0
// reactions" by checking `len(summaries) == 0` without iterating.
func (r *reactionRepo) Aggregate(ctx context.Context, postID uint64) ([]domain.ReactionSummary, error) {
	type aggRow struct {
		Kind  string
		Count int64
	}
	var rows []aggRow
	err := r.db.WithContext(ctx).
		Model(&db.SocialReaction{}).
		Select("kind, COUNT(*) AS count").
		Where("post_id = ?", postID).
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

func (r *reactionRepo) IsReactedByViewer(ctx context.Context, postID, viewerID uint64, kind domain.ReactionKindStr) (bool, error) {
	if viewerID == 0 {
		return false, nil
	}
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.SocialReaction{}).
		Where("post_id = ? AND actor_id = ? AND kind = ?", postID, viewerID, kind).
		Count(&count).Error
	return count > 0, err
}

func (r *reactionRepo) HydrateReactedByViewer(ctx context.Context, postID, viewerID uint64, summaries []domain.ReactionSummary) ([]domain.ReactionSummary, error) {
	if viewerID == 0 || len(summaries) == 0 {
		return summaries, nil
	}
	var kinds []string
	err := r.db.WithContext(ctx).
		Model(&db.SocialReaction{}).
		Where("post_id = ? AND actor_id = ?", postID, viewerID).
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
