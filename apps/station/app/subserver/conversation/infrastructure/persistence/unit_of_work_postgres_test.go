package persistence

import (
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestRequirePostgresUniqueIndexRejectsNonCanonicalDefinitions(t *testing.T) {
	db := openIsolatedPostgres(t)
	if err := db.AutoMigrate(&ConversationEventModel{}); err != nil {
		t.Fatal(err)
	}

	const indexName = "uidx_conversation_event_command"
	expectedColumns := []string{"conversation_id", "command_id"}
	if err := requireUniqueIndex(
		db,
		&ConversationEventModel{},
		indexName,
		expectedColumns,
	); err != nil {
		t.Fatalf("canonical index rejected: %v", err)
	}

	t.Run("reversed keys", func(t *testing.T) {
		replacePostgresIndex(
			t,
			db,
			indexName,
			`CREATE UNIQUE INDEX uidx_conversation_event_command
				ON conversation_events (command_id, conversation_id)`,
		)
		if err := requireUniqueIndex(
			db,
			&ConversationEventModel{},
			indexName,
			expectedColumns,
		); err == nil {
			t.Fatal("reversed PostgreSQL index keys were accepted")
		}
	})

	t.Run("partial predicate", func(t *testing.T) {
		replacePostgresIndex(
			t,
			db,
			indexName,
			`CREATE UNIQUE INDEX uidx_conversation_event_command
				ON conversation_events (conversation_id, command_id)
				WHERE command_id <> ''`,
		)
		if err := requireUniqueIndex(
			db,
			&ConversationEventModel{},
			indexName,
			expectedColumns,
		); err == nil {
			t.Fatal("partial PostgreSQL unique index was accepted")
		}
	})
}

func replacePostgresIndex(t *testing.T, db *gorm.DB, name string, definition string) {
	t.Helper()
	if err := db.Exec(`DROP INDEX IF EXISTS "` + name + `"`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(definition).Error; err != nil {
		t.Fatal(err)
	}
}

func openIsolatedPostgres(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("MESSAGING_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("MESSAGING_TEST_POSTGRES_DSN is not configured")
	}

	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open PostgreSQL test database: %v", err)
	}
	schema := "conversation_ddd_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatalf("create isolated PostgreSQL schema: %v", err)
	}
	t.Cleanup(func() {
		if err := admin.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`).Error; err != nil {
			t.Errorf("drop isolated PostgreSQL schema: %v", err)
		}
	})
	t.Cleanup(func() {
		sqlDB, dbErr := admin.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	isolated, err := gorm.Open(
		postgres.Open(postgresDSNWithSearchPath(t, dsn, schema)),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open isolated PostgreSQL test schema: %v", err)
	}
	t.Cleanup(func() {
		sqlDB, dbErr := isolated.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	return isolated
}

func postgresDSNWithSearchPath(t *testing.T, dsn string, schema string) string {
	t.Helper()
	if strings.Contains(dsn, "://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatalf("parse PostgreSQL DSN: %v", err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	return strings.TrimSpace(dsn) + " search_path=" + schema
}
