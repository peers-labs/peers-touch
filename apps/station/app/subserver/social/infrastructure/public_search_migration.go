package infrastructure

import (
	"context"
	"time"

	"gorm.io/gorm"
)

var publicSearchIndexes = []string{
	`CREATE INDEX IF NOT EXISTS idx_social_public_search_trgm ON social_public_posts
USING gin (text_body gin_trgm_ops) WHERE audience_kind = 'PUBLIC' AND deleted_at IS NULL`,
	`CREATE INDEX IF NOT EXISTS idx_social_comment_search_trgm ON social_comments
USING gin (text_body gin_trgm_ops) WHERE post_class = 'public' AND deleted_at IS NULL`,
	`CREATE INDEX IF NOT EXISTS idx_social_public_search_scan ON social_public_posts
(created_at DESC, id DESC) WHERE audience_kind = 'PUBLIC' AND deleted_at IS NULL`,
	`CREATE INDEX IF NOT EXISTS idx_social_comment_search_scan ON social_comments
(created_at DESC, id DESC) WHERE post_class = 'public' AND deleted_at IS NULL`,
}

// The original Social migration owner attaches indexes to original public
// columns. Secure Content tables, envelopes and private tokens are untouched.
func MigratePublicSearchSchema(ctx context.Context, database *gorm.DB) error {
	if database.Dialector.Name() != "postgres" {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL lock_timeout = '2s'").Error; err != nil {
			return err
		}
		if err := tx.Exec("SET LOCAL statement_timeout = '25s'").Error; err != nil {
			return err
		}
		if err := tx.Exec("CREATE EXTENSION IF NOT EXISTS pg_trgm").Error; err != nil {
			return err
		}
		for _, index := range publicSearchIndexes {
			if err := tx.Exec(index).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
