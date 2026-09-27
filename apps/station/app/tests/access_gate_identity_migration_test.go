package tests

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	modeldb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAccessGateIdentityMigrationLegacyOnly(t *testing.T) {
	db := openAccessGateMigrationDB(t)
	createAccessGateMigrationActorTable(t, db)
	execAccessGateMigrationSQL(t, db, `
		CREATE TABLE access_gate_policies (
			id INTEGER PRIMARY KEY,
			allowed_actor_ids TEXT
		)
	`)
	execAccessGateMigrationSQL(t, db, `
		CREATE TABLE access_gate_attempts (
			id TEXT PRIMARY KEY,
			actor_id INTEGER
		)
	`)
	insertAccessGateMigrationActors(t, db)
	execAccessGateMigrationSQL(t, db, `
		INSERT INTO access_gate_policies (id, allowed_actor_ids)
		VALUES (1, '101, 202')
	`)
	execAccessGateMigrationSQL(t, db, `
		INSERT INTO access_gate_attempts (id, actor_id)
		VALUES ('attempt-1', 202), ('attempt-anonymous', 0)
	`)

	if err := modeldb.MigrateAccessGateIdentity(db); err != nil {
		t.Fatalf("migrate legacy Access Gate identities: %v", err)
	}

	assertAccessGateLegacyColumnsDropped(t, db)
	assertAccessGatePolicyPTIDs(t, db, "ptid:alice,ptid:bob")
	assertAccessGateAttemptPTID(t, db, "attempt-1", "ptid:bob")
	assertAccessGateAttemptPTID(t, db, "attempt-anonymous", "")
	assertAccessGateAttemptStationPeerID(t, db, "attempt-1", "station-local")
	assertAccessGateAttemptStationPeerID(t, db, "attempt-anonymous", "station-local")
}

func TestAccessGateIdentityMigrationMatchingDualColumns(t *testing.T) {
	db := openAccessGateMigrationDB(t)
	createAccessGateMigrationActorTable(t, db)
	createDualAccessGateMigrationTables(t, db)
	insertAccessGateMigrationActors(t, db)
	execAccessGateMigrationSQL(t, db, `
		INSERT INTO access_gate_policies (
			id,
			allowed_actor_ids,
			allowed_actor_ptids
		) VALUES (1, '101,202', 'ptid:alice,ptid:bob')
	`)
	execAccessGateMigrationSQL(t, db, `
		INSERT INTO access_gate_attempts (id, actor_id, actor_ptid)
		VALUES ('attempt-1', 101, 'ptid:alice')
	`)

	if err := modeldb.MigrateAccessGateIdentity(db); err != nil {
		t.Fatalf("migrate matching dual Access Gate identities: %v", err)
	}

	assertAccessGateLegacyColumnsDropped(t, db)
	assertAccessGatePolicyPTIDs(t, db, "ptid:alice,ptid:bob")
	assertAccessGateAttemptPTID(t, db, "attempt-1", "ptid:alice")
	assertAccessGateAttemptStationPeerID(t, db, "attempt-1", "station-local")
}

func TestAccessGateIdentityMigrationDivergenceRollsBack(t *testing.T) {
	db := openAccessGateMigrationDB(t)
	createAccessGateMigrationActorTable(t, db)
	createDualAccessGateMigrationTables(t, db)
	insertAccessGateMigrationActors(t, db)
	execAccessGateMigrationSQL(t, db, `
		INSERT INTO access_gate_policies (
			id,
			allowed_actor_ids,
			allowed_actor_ptids
		) VALUES (1, '101', 'ptid:alice')
	`)
	execAccessGateMigrationSQL(t, db, `
		INSERT INTO access_gate_attempts (id, actor_id, actor_ptid)
		VALUES ('attempt-1', 101, 'ptid:bob')
	`)

	err := modeldb.MigrateAccessGateIdentity(db)
	if err == nil || !strings.Contains(err.Error(), "conflicting") {
		t.Fatalf("expected conflicting identity error, got %v", err)
	}

	assertAccessGateLegacyColumnsRemain(t, db)
	assertAccessGatePolicyPTIDs(t, db, "ptid:alice")
	assertAccessGateAttemptPTID(t, db, "attempt-1", "ptid:bob")
}

func TestAccessGateIdentityMigrationUnresolvedActorRollsBack(t *testing.T) {
	db := openAccessGateMigrationDB(t)
	createAccessGateMigrationActorTable(t, db)
	execAccessGateMigrationSQL(t, db, `
		CREATE TABLE access_gate_policies (
			id INTEGER PRIMARY KEY,
			allowed_actor_ids TEXT
		)
	`)
	execAccessGateMigrationSQL(t, db, `
		CREATE TABLE access_gate_attempts (
			id TEXT PRIMARY KEY,
			actor_id INTEGER
		)
	`)
	insertAccessGateMigrationActors(t, db)
	execAccessGateMigrationSQL(t, db, `
		INSERT INTO access_gate_policies (id, allowed_actor_ids)
		VALUES (1, '101')
	`)
	execAccessGateMigrationSQL(t, db, `
		INSERT INTO access_gate_attempts (id, actor_id)
		VALUES ('attempt-unresolved', 999)
	`)

	err := modeldb.MigrateAccessGateIdentity(db)
	if err == nil || !strings.Contains(err.Error(), "unresolved") {
		t.Fatalf("expected unresolved identity error, got %v", err)
	}

	if !db.Migrator().HasColumn("access_gate_policies", "allowed_actor_ids") {
		t.Fatal("policy legacy column was removed after rollback")
	}
	if db.Migrator().HasColumn("access_gate_policies", "allowed_actor_ptids") {
		t.Fatal("policy PTID column survived rollback")
	}
	if !db.Migrator().HasColumn("access_gate_attempts", "actor_id") {
		t.Fatal("attempt legacy column was removed after rollback")
	}
	if db.Migrator().HasColumn("access_gate_attempts", "actor_ptid") {
		t.Fatal("attempt PTID column survived rollback")
	}
}

func openAccessGateMigrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open Access Gate migration database: %v", err)
	}
	return db
}

func createAccessGateMigrationActorTable(t *testing.T, db *gorm.DB) {
	t.Helper()
	execAccessGateMigrationSQL(t, db, `
		CREATE TABLE touch_actor (
			id INTEGER PRIMARY KEY,
			ptid VARCHAR(255),
			home_station_peer_id VARCHAR(255),
			origin VARCHAR(16)
		)
	`)
}

func createDualAccessGateMigrationTables(t *testing.T, db *gorm.DB) {
	t.Helper()
	execAccessGateMigrationSQL(t, db, `
		CREATE TABLE access_gate_policies (
			id INTEGER PRIMARY KEY,
			allowed_actor_ids TEXT,
			allowed_actor_ptids TEXT
		)
	`)
	execAccessGateMigrationSQL(t, db, `
		CREATE TABLE access_gate_attempts (
			id TEXT PRIMARY KEY,
			actor_id INTEGER,
			actor_ptid VARCHAR(255)
		)
	`)
}

func insertAccessGateMigrationActors(t *testing.T, db *gorm.DB) {
	t.Helper()
	execAccessGateMigrationSQL(t, db, `
		INSERT INTO touch_actor (id, ptid, home_station_peer_id, origin)
		VALUES
			(101, 'ptid:alice', 'station-local', 'local'),
			(202, 'ptid:bob', 'station-local', 'local')
	`)
}

func execAccessGateMigrationSQL(t *testing.T, db *gorm.DB, statement string) {
	t.Helper()
	if err := db.Exec(statement).Error; err != nil {
		t.Fatalf("execute migration fixture SQL: %v", err)
	}
}

func assertAccessGateLegacyColumnsDropped(t *testing.T, db *gorm.DB) {
	t.Helper()
	if db.Migrator().HasColumn("access_gate_policies", "allowed_actor_ids") {
		t.Fatal("legacy access_gate_policies.allowed_actor_ids still exists")
	}
	if !db.Migrator().HasColumn("access_gate_policies", "allowed_actor_ptids") {
		t.Fatal("access_gate_policies.allowed_actor_ptids is missing")
	}
	if db.Migrator().HasColumn("access_gate_attempts", "actor_id") {
		t.Fatal("legacy access_gate_attempts.actor_id still exists")
	}
	if !db.Migrator().HasColumn("access_gate_attempts", "actor_ptid") {
		t.Fatal("access_gate_attempts.actor_ptid is missing")
	}
}

func assertAccessGateLegacyColumnsRemain(t *testing.T, db *gorm.DB) {
	t.Helper()
	if !db.Migrator().HasColumn("access_gate_policies", "allowed_actor_ids") {
		t.Fatal("policy legacy column was removed after conflict")
	}
	if !db.Migrator().HasColumn("access_gate_attempts", "actor_id") {
		t.Fatal("attempt legacy column was removed after conflict")
	}
}

func assertAccessGatePolicyPTIDs(t *testing.T, db *gorm.DB, expected string) {
	t.Helper()
	var actual string
	if err := db.Table("access_gate_policies").
		Select("allowed_actor_ptids").
		Where("id = ?", 1).
		Scan(&actual).Error; err != nil {
		t.Fatalf("read migrated policy PTIDs: %v", err)
	}
	if actual != expected {
		t.Fatalf("allowed_actor_ptids = %q, want %q", actual, expected)
	}
}

func assertAccessGateAttemptPTID(t *testing.T, db *gorm.DB, attemptID, expected string) {
	t.Helper()
	var actual sql.NullString
	if err := db.Table("access_gate_attempts").
		Select("actor_ptid").
		Where("id = ?", attemptID).
		Scan(&actual).Error; err != nil {
		t.Fatalf("read migrated attempt PTID: %v", err)
	}
	if actual.String != expected {
		t.Fatalf("attempt %q actor_ptid = %q, want %q", attemptID, actual.String, expected)
	}
}

func assertAccessGateAttemptStationPeerID(
	t *testing.T,
	db *gorm.DB,
	attemptID string,
	expected string,
) {
	t.Helper()
	var actual string
	if err := db.Table("access_gate_attempts").
		Select("station_peer_id").
		Where("id = ?", attemptID).
		Scan(&actual).Error; err != nil {
		t.Fatalf("read migrated attempt Station PeerID: %v", err)
	}
	if actual != expected {
		t.Fatalf("station_peer_id = %q, want %q", actual, expected)
	}
}
