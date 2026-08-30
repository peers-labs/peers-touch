package db

import (
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateTouchIdentityColumnsPreservesData(t *testing.T) {
	rds := openIdentityMigrationDB(t, "touch_preserves_data")
	mustExecuteMigrationSQL(t, rds,
		`CREATE TABLE touch_message (id INTEGER PRIMARY KEY, sender_did TEXT)`,
		`CREATE TABLE touch_receipt (id INTEGER PRIMARY KEY, member_did TEXT)`,
		`INSERT INTO touch_message (id, sender_did) VALUES (1, 'ptid:alice')`,
		`INSERT INTO touch_receipt (id, member_did) VALUES (1, 'ptid:bob')`,
	)

	if err := migrateTouchIdentityColumns(rds); err != nil {
		t.Fatalf("migrate touch identity columns: %v", err)
	}

	assertIdentityValue(t, rds, "touch_message", "sender_ptid", "ptid:alice")
	assertIdentityValue(t, rds, "touch_receipt", "member_ptid", "ptid:bob")
	if rds.Migrator().HasColumn("touch_message", "sender_did") ||
		rds.Migrator().HasColumn("touch_receipt", "member_did") {
		t.Fatal("legacy touch identity columns remain after migration")
	}
}

func TestMigrateTouchIdentityColumnsRollsBackAsASet(t *testing.T) {
	rds := openIdentityMigrationDB(t, "touch_rolls_back")
	mustExecuteMigrationSQL(t, rds,
		`CREATE TABLE touch_message (id INTEGER PRIMARY KEY, sender_did TEXT)`,
		`CREATE TABLE touch_receipt (id INTEGER PRIMARY KEY, member_did TEXT, member_ptid TEXT)`,
		`INSERT INTO touch_message (id, sender_did) VALUES (1, 'ptid:alice')`,
		`INSERT INTO touch_receipt (id, member_did, member_ptid) VALUES (1, 'ptid:bob', 'ptid:mallory')`,
	)

	err := migrateTouchIdentityColumns(rds)
	if err == nil || !strings.Contains(err.Error(), "divergent") {
		t.Fatalf("expected divergent identity error, got %v", err)
	}
	if !rds.Migrator().HasColumn("touch_message", "sender_did") ||
		rds.Migrator().HasColumn("touch_message", "sender_ptid") {
		t.Fatal("touch_message migration was not rolled back with the module set")
	}
	assertIdentityValue(t, rds, "touch_message", "sender_did", "ptid:alice")
}

func TestMigrateSocialIdentityColumnsPreservesAliases(t *testing.T) {
	rds := openIdentityMigrationDB(t, "social_preserves_aliases")
	mustExecuteMigrationSQL(t, rds,
		`CREATE TABLE social_private_audience_grants (id INTEGER PRIMARY KEY, actor_did TEXT)`,
		`CREATE TABLE social_circle_members (
			id INTEGER PRIMARY KEY,
			member_did TEXT,
			actor_did TEXT
		)`,
		`INSERT INTO social_private_audience_grants (id, actor_did) VALUES (1, 'ptid:alice')`,
		`INSERT INTO social_circle_members (id, member_did, actor_did)
		 VALUES (1, 'ptid:bob', 'ptid:bob')`,
	)

	if err := migrateSocialIdentityColumns(rds); err != nil {
		t.Fatalf("migrate social identity columns: %v", err)
	}

	assertIdentityValue(t, rds, "social_private_audience_grants", "actor_ptid", "ptid:alice")
	assertIdentityValue(t, rds, "social_circle_members", "actor_ptid", "ptid:bob")
	if rds.Migrator().HasColumn("social_private_audience_grants", "actor_did") ||
		rds.Migrator().HasColumn("social_circle_members", "member_did") ||
		rds.Migrator().HasColumn("social_circle_members", "actor_did") {
		t.Fatal("legacy social identity columns remain after migration")
	}
}

func TestMigrateSocialIdentityColumnsRollsBackAsASet(t *testing.T) {
	rds := openIdentityMigrationDB(t, "social_rolls_back")
	mustExecuteMigrationSQL(t, rds,
		`CREATE TABLE social_private_audience_grants (id INTEGER PRIMARY KEY, actor_did TEXT)`,
		`CREATE TABLE social_circle_members (
			id INTEGER PRIMARY KEY,
			actor_did TEXT,
			actor_ptid TEXT
		)`,
		`INSERT INTO social_private_audience_grants (id, actor_did) VALUES (1, 'ptid:alice')`,
		`INSERT INTO social_circle_members (id, actor_did, actor_ptid)
		 VALUES (1, 'ptid:bob', 'ptid:mallory')`,
	)

	err := migrateSocialIdentityColumns(rds)
	if err == nil || !strings.Contains(err.Error(), "divergent") {
		t.Fatalf("expected divergent identity error, got %v", err)
	}
	if !rds.Migrator().HasColumn("social_private_audience_grants", "actor_did") ||
		rds.Migrator().HasColumn("social_private_audience_grants", "actor_ptid") {
		t.Fatal("social audience migration was not rolled back with the module set")
	}
	assertIdentityValue(t, rds, "social_private_audience_grants", "actor_did", "ptid:alice")
}

func openIdentityMigrationDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	rds, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	return rds
}

func mustExecuteMigrationSQL(t *testing.T, rds *gorm.DB, statements ...string) {
	t.Helper()
	for _, statement := range statements {
		if err := rds.Exec(statement).Error; err != nil {
			t.Fatalf("execute migration fixture: %v", err)
		}
	}
}

func assertIdentityValue(t *testing.T, rds *gorm.DB, table, column, expected string) {
	t.Helper()
	var actual string
	if err := rds.Table(table).Select(column).Where("id = ?", 1).Row().Scan(&actual); err != nil {
		t.Fatalf("read %s.%s: %v", table, column, err)
	}
	if actual != expected {
		t.Fatalf("%s.%s = %q, want %q", table, column, actual, expected)
	}
}
