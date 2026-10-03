package infrastructure

import (
	"context"
	"errors"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// reactionRepo implements `domain.ReactionRepository` against the
// `social_reactions` table. Toggling a reaction on/off is a clean
// Insert/Delete on the composite key `(post_id, actor_id, kind)` —
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
		Where("post_id = ? AND actor_id = ? AND kind = ?",
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
		Where("post_id = ? AND actor_id = ? AND kind = ?", postID, actorID, kind).
		Delete(&db.SocialReaction{}).Error
}

func (r *reactionRepo) ListByPost(ctx context.Context, postID string) ([]domain.Reaction, error) {
	return r.listByPost(ctx, r.db, postID)
}

func (r *reactionRepo) listByPost(
	ctx context.Context,
	database *gorm.DB,
	postID string,
) ([]domain.Reaction, error) {
	identity := NewActorIdentity(database)
	var rows []db.SocialReaction
	if err := database.WithContext(ctx).
		Where("post_id = ?", postID).
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

func (r *reactionRepo) MutatePrivatePost(
	ctx context.Context,
	postID string,
	actorPTID string,
	kind domain.ReactionKindStr,
	remove bool,
) (string, []domain.Reaction, error) {
	var (
		authorPTID string
		reactions  []domain.Reaction
	)
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var post db.SocialPrivateContentPost
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"post_id = ? AND lifecycle_state = ? AND deleted_at IS NULL",
				postID,
				privateContentLifecycleActive,
			).
			First(&post).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPrivateContentNotFound
		}
		if err != nil {
			return err
		}
		if err := authorizePrivatePostViewer(
			tx,
			post,
			actorPTID,
		); err != nil {
			return err
		}
		actorID, err := NewActorIdentity(tx).RequireID(ctx, actorPTID)
		if err != nil {
			return err
		}
		if remove {
			if err := tx.Where(
				"post_id = ? AND actor_id = ? AND kind = ? AND post_class = ?",
				postID,
				actorID,
				kind,
				string(domain.PostClassPrivate),
			).Delete(&db.SocialReaction{}).Error; err != nil {
				return err
			}
		} else {
			row := db.SocialReaction{
				PostID:    postID,
				ActorID:   actorID,
				Kind:      kind,
				PostClass: string(domain.PostClassPrivate),
				CreatedAt: time.Now().UTC(),
			}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
				Create(&row).Error; err != nil {
				return err
			}
		}
		reactions, err = r.listByPost(ctx, tx, postID)
		if err != nil {
			return err
		}
		if err := tx.Model(&db.SocialPrivateContentPost{}).
			Where(
				"post_id = ? AND lifecycle_state = ? AND deleted_at IS NULL",
				postID,
				privateContentLifecycleActive,
			).
			UpdateColumn("reactions_count", len(reactions)).Error; err != nil {
			return err
		}
		authorPTID = post.AuthorPTID
		return nil
	})
	if err != nil {
		return "", nil, err
	}
	return authorPTID, reactions, nil
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
		Where("post_id = ? AND actor_id = ? AND kind = ?", postID, viewerID, kind).
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
