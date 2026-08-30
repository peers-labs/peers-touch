package infrastructure

import (
	"strings"
	"testing"

	modeldb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateStringIdentityColumn(t *testing.T) {
	t.Run("renames legacy-only column", func(t *testing.T) {
		db := openMigrationTestDB(t, "legacy_only")
		mustExec(t, db, `CREATE TABLE identities (id INTEGER PRIMARY KEY, actor_did TEXT)`)
		mustExec(t, db, `INSERT INTO identities (id, actor_did) VALUES (1, 'ptid:alice')`)

		if err := modeldb.MigrateStringIdentityColumn(db, "identities", "actor_did", "actor_ptid"); err != nil {
			t.Fatal(err)
		}

		assertMigratedIdentity(t, db, "ptid:alice")
	})

	t.Run("backfills matching dual columns and drops legacy", func(t *testing.T) {
		db := openMigrationTestDB(t, "matching_dual")
		mustExec(t, db, `CREATE TABLE identities (id INTEGER PRIMARY KEY, actor_did TEXT, actor_ptid TEXT)`)
		mustExec(t, db, `INSERT INTO identities (id, actor_did, actor_ptid) VALUES (1, 'ptid:alice', '')`)

		if err := modeldb.MigrateStringIdentityColumn(db, "identities", "actor_did", "actor_ptid"); err != nil {
			t.Fatal(err)
		}

		assertMigratedIdentity(t, db, "ptid:alice")
	})

	t.Run("rejects divergent dual columns", func(t *testing.T) {
		db := openMigrationTestDB(t, "divergent_dual")
		mustExec(t, db, `CREATE TABLE identities (id INTEGER PRIMARY KEY, actor_did TEXT, actor_ptid TEXT)`)
		mustExec(t, db, `INSERT INTO identities (id, actor_did, actor_ptid) VALUES (1, 'ptid:alice', 'ptid:bob')`)

		err := modeldb.MigrateStringIdentityColumn(db, "identities", "actor_did", "actor_ptid")
		if err == nil || !strings.Contains(err.Error(), "divergent") {
			t.Fatalf("expected divergent identity error, got %v", err)
		}
		if !db.Migrator().HasColumn("identities", "actor_did") {
			t.Fatal("legacy column was removed after conflict")
		}
	})
}

func openMigrationTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func mustExec(t *testing.T, db *gorm.DB, statement string) {
	t.Helper()
	if err := db.Exec(statement).Error; err != nil {
		t.Fatal(err)
	}
}

func assertMigratedIdentity(t *testing.T, db *gorm.DB, expected string) {
	t.Helper()
	if db.Migrator().HasColumn("identities", "actor_did") {
		t.Fatal("legacy identity column still exists")
	}
	if !db.Migrator().HasColumn("identities", "actor_ptid") {
		t.Fatal("PTID column is missing")
	}
	var actual string
	if err := db.Table("identities").Select("actor_ptid").Where("id = 1").Scan(&actual).Error; err != nil {
		t.Fatal(err)
	}
	if actual != expected {
		t.Fatalf("actor_ptid = %q, want %q", actual, expected)
	}
}
