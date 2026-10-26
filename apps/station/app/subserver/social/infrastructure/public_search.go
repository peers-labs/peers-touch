package infrastructure

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

const PublicSearchScanLimit = 100

type PublicSearchPosition struct {
	Kind      string    `json:"kind"`
	ID        uint64    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
}

type PublicSearchRepository struct {
	db *gorm.DB
}

func NewPublicSearchRepository(database *gorm.DB) *PublicSearchRepository {
	return &PublicSearchRepository{db: database}
}

// Snapshot identifies the actual MVCC observation, not a publication lease or
// a content generation. All repositories used by fn must be bound to tx.
func (r *PublicSearchRepository) Snapshot(
	ctx context.Context, fn func(tx *gorm.DB, observation string) error,
) error {
	if r.db.Dialector.Name() != "postgres" {
		return fmt.Errorf("public Social Search requires PostgreSQL")
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL statement_timeout = '4500ms'").Error; err != nil {
			return err
		}
		var observation string
		if err := tx.Raw("SELECT pg_current_snapshot()::text").Scan(&observation).Error; err != nil {
			return err
		}
		if observation == "" {
			return fmt.Errorf("PostgreSQL returned no read observation")
		}
		return fn(tx, observation)
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
}

// Scan reads metadata only, at most 100 inspected positions plus one lookahead.
// Text matching is restricted to those positions; a short query cannot turn
// LIMIT into an unbounded literal-text scan over the entire corpus.
func (r *PublicSearchRepository) Scan(
	ctx context.Context, posts, comments bool, after PublicSearchPosition,
) ([]PublicSearchPosition, bool, error) {
	streams := make([]string, 0, 2)
	if posts {
		streams = append(streams, `SELECT 'social-post' AS kind, id, created_at
FROM social_public_posts WHERE audience_kind = 'PUBLIC' AND deleted_at IS NULL`)
	}
	if comments {
		streams = append(streams, `SELECT 'social-comment' AS kind, c.id, c.created_at
FROM social_comments c JOIN social_public_posts p ON p.id = c.post_id
WHERE c.post_class = 'public' AND c.deleted_at IS NULL
AND p.audience_kind = 'PUBLIC' AND p.deleted_at IS NULL`)
	}
	if len(streams) == 0 {
		return nil, false, nil
	}
	query := "SELECT kind, id, created_at FROM (" + strings.Join(streams, " UNION ALL ") + ") positions"
	args := make([]any, 0, 4)
	if after.ID != 0 {
		query += " WHERE (created_at, id, kind) < (?, ?, ?)"
		args = append(args, after.CreatedAt, after.ID, after.Kind)
	}
	query += " ORDER BY created_at DESC, id DESC, kind DESC LIMIT ?"
	args = append(args, PublicSearchScanLimit+1)
	var rows []PublicSearchPosition
	if err := r.db.WithContext(ctx).Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, false, err
	}
	more := len(rows) > PublicSearchScanLimit
	if more {
		rows = rows[:PublicSearchScanLimit]
	}
	return rows, more, nil
}

func (r *PublicSearchRepository) Match(
	ctx context.Context, positions []PublicSearchPosition, text string,
) (map[PublicSearchPosition]bool, error) {
	if len(positions) > PublicSearchScanLimit {
		return nil, fmt.Errorf("public search candidate bound exceeded")
	}
	postIDs, commentIDs := make([]uint64, 0), make([]uint64, 0)
	for _, position := range positions {
		switch position.Kind {
		case "social-post":
			postIDs = append(postIDs, position.ID)
		case "social-comment":
			commentIDs = append(commentIDs, position.ID)
		default:
			return nil, fmt.Errorf("invalid public search position")
		}
	}
	pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(text) + "%"
	out := make(map[PublicSearchPosition]bool)
	matches := make(map[string]map[uint64]bool)
	for _, stream := range []struct {
		kind, query string
		ids         []uint64
	}{
		{"social-post", `SELECT id FROM social_public_posts WHERE audience_kind = 'PUBLIC'
AND deleted_at IS NULL AND id IN ? AND text_body LIKE ? ESCAPE '!'`, postIDs},
		{"social-comment", `SELECT c.id FROM social_comments c JOIN social_public_posts p ON p.id = c.post_id
WHERE c.post_class = 'public' AND c.deleted_at IS NULL AND p.audience_kind = 'PUBLIC'
AND p.deleted_at IS NULL AND c.id IN ? AND c.text_body LIKE ? ESCAPE '!'`, commentIDs},
	} {
		matches[stream.kind] = make(map[uint64]bool)
		if len(stream.ids) == 0 {
			continue
		}
		var ids []uint64
		if err := r.db.WithContext(ctx).Raw(stream.query, stream.ids, pattern).Scan(&ids).Error; err != nil {
			return nil, err
		}
		for _, id := range ids {
			matches[stream.kind][id] = true
		}
	}
	for _, position := range positions {
		if matches[position.Kind][position.ID] {
			out[position] = true
		}
	}
	return out, nil
}
