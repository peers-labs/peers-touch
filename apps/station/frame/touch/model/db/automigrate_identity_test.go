package db

import (
	"database/sql"
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

func TestMigrateAccessGateIdentityBackfillsLegacyAttempt(t *testing.T) {
	rds := openIdentityMigrationDB(t, "access_gate_preserves_attempt")
	mustExecuteMigrationSQL(t, rds,
		`CREATE TABLE touch_actor (
			id INTEGER PRIMARY KEY,
			ptid TEXT,
			home_station_peer_id TEXT,
			origin TEXT
		)`,
		`CREATE TABLE access_gate_attempts (
			id TEXT PRIMARY KEY,
			actor_ptid TEXT
		)`,
		`INSERT INTO touch_actor (
			id, ptid, home_station_peer_id, origin
		) VALUES (
			1, 'ptid:alice', 'station-local', 'local'
		)`,
		`INSERT INTO access_gate_attempts (
			id, actor_ptid
		) VALUES (
			'attempt-1', 'ptid:alice'
		)`,
	)

	if err := MigrateAccessGateIdentity(rds); err != nil {
		t.Fatalf("migrate Access Gate identities: %v", err)
	}
	var migratedStationPeerID sql.NullString
	var migratedActorPTID sql.NullString
	if err := rds.Table(accessAttemptTable).
		Select("station_peer_id, actor_ptid").
		Where("id = ?", "attempt-1").
		Row().
		Scan(&migratedStationPeerID, &migratedActorPTID); err != nil {
		t.Fatalf("read Access Gate attempt before auto-migrate: %v", err)
	}
	if migratedStationPeerID.String != "station-local" ||
		migratedActorPTID.String != "ptid:alice" {
		t.Fatalf(
			"migrated Access Gate identities = (%q, %q), want (station-local, ptid:alice)",
			migratedStationPeerID.String,
			migratedActorPTID.String,
		)
	}
	if err := rds.AutoMigrate(&AccessAttempt{}); err != nil {
		t.Fatalf("auto migrate AccessAttempt after identity backfill: %v", err)
	}

	var stationPeerID string
	if err := rds.Table(accessAttemptTable).
		Select("station_peer_id").
		Where("id = ?", "attempt-1").
		Row().
		Scan(&stationPeerID); err != nil {
		t.Fatalf("read migrated Access Gate attempt: %v", err)
	}
	if stationPeerID != "station-local" {
		t.Fatalf(
			"access_gate_attempts.station_peer_id = %q, want station-local",
			stationPeerID,
		)
	}
}

func TestMigrateAccessGateIdentityRejectsAmbiguousStationScope(t *testing.T) {
	rds := openIdentityMigrationDB(t, "access_gate_rejects_ambiguous_station")
	mustExecuteMigrationSQL(t, rds,
		`CREATE TABLE touch_actor (
			id INTEGER PRIMARY KEY,
			home_station_peer_id TEXT,
			origin TEXT
		)`,
		`CREATE TABLE access_gate_attempts (
			id TEXT PRIMARY KEY
		)`,
		`INSERT INTO touch_actor (
			id, home_station_peer_id, origin
		) VALUES
			(1, 'station-a', 'local'),
			(2, 'station-b', 'local')`,
		`INSERT INTO access_gate_attempts (id) VALUES ('attempt-1')`,
	)

	err := MigrateAccessGateIdentity(rds)
	if err == nil || !strings.Contains(err.Error(), "exactly one local Station PeerID") {
		t.Fatalf("expected ambiguous Station identity error, got %v", err)
	}
	if rds.Migrator().HasColumn(
		accessAttemptTable,
		accessAttemptStationPeerColumn,
	) {
		t.Fatal("Station identity column was not rolled back after ambiguity")
	}
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
