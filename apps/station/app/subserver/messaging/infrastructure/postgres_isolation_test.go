package infrastructure_test

import (
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

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
	schema := "messaging_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatalf("create isolated PostgreSQL schema: %v", err)
	}
	t.Cleanup(func() {
		isolatedSQL, isolatedErr := admin.DB()
		if isolatedErr == nil {
			_ = isolatedSQL.Close()
		}
	})
	t.Cleanup(func() {
		if err := admin.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`).Error; err != nil {
			t.Errorf("drop isolated PostgreSQL schema: %v", err)
		}
	})

	isolated, err := gorm.Open(
		postgres.Open(postgresDSNWithSearchPath(t, dsn, schema)),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open isolated PostgreSQL test schema: %v", err)
	}
	isolatedSQL, err := isolated.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = isolatedSQL.Close()
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
