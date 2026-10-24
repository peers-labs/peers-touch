package infrastructure

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPublicSearchPostgresOriginalIndexes(t *testing.T) {
	dsn := os.Getenv("SOCIAL_SEARCH_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("requires explicitly supplied isolated PostgreSQL fixture; no runtime provisioning")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	var hasTrgm bool
	if err := database.WithContext(ctx).Raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')").
		Scan(&hasTrgm).Error; err != nil {
		t.Fatal(err)
	}
	if !hasTrgm {
		t.Skip("fixture must already provide pg_trgm; tests never install shared extensions")
	}
	err = database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, statement := range []string{
			`CREATE TEMP TABLE social_public_posts (
id bigint PRIMARY KEY, audience_kind text, text_body text, created_at timestamptz, deleted_at timestamptz) ON COMMIT DROP`,
			`CREATE TEMP TABLE social_comments (
id bigint PRIMARY KEY, post_id bigint, post_class text, text_body text, created_at timestamptz, deleted_at timestamptz) ON COMMIT DROP`,
			"INSERT INTO social_public_posts VALUES (1, 'PUBLIC', 'literal %_! \u4e2d\u6587 mix', NOW(), NULL)",
			"INSERT INTO social_comments VALUES (2, 1, 'public', 'literal %_! \u4e2d\u6587 mix', NOW(), NULL), (3, 1, 'private', 'literal %_! private', NOW(), NULL)",
		} {
			if err := tx.Exec(statement).Error; err != nil {
				return err
			}
		}
		if err := MigratePublicSearchSchema(ctx, tx); err != nil {
			return err
		}
		var definitions []struct{ Indexdef string }
		if err := tx.Raw(`SELECT indexdef FROM pg_indexes
WHERE schemaname = (SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema())
AND indexname LIKE 'idx_social_%search%'`).Scan(&definitions).Error; err != nil {
			return err
		}
		if len(definitions) != 4 {
			return fmt.Errorf("expected four original-table indexes, got %d", len(definitions))
		}
		for _, definition := range definitions {
			t.Log(definition.Indexdef)
		}
		repository := NewPublicSearchRepository(tx)
		positions, more, err := repository.Scan(ctx, true, true, PublicSearchPosition{})
		if err != nil || more || len(positions) != 2 {
			return fmt.Errorf("public scan count=%d more=%t: %w", len(positions), more, err)
		}
		for _, text := range []string{"%_!", "\u4e2d\u6587", "mix"} {
			matches, err := repository.Match(ctx, positions, text)
			if err != nil || len(matches) != 2 {
				return fmt.Errorf("literal corpus %q matches=%d: %w", text, len(matches), err)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
