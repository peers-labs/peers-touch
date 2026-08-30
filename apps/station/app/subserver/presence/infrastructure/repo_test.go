package infrastructure

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAutoMigrateRenamesPresenceIdentityColumns(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:presence_identity_migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE actor_presence_leases (
			id INTEGER PRIMARY KEY,
			actor_did TEXT,
			session_id TEXT,
			last_seen_at DATETIME,
			lease_expires_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE friend_chat_sessions (
			participant_a_did TEXT,
			participant_b_did TEXT
		)`,
		`INSERT INTO actor_presence_leases (
			id, actor_did, session_id, last_seen_at, lease_expires_at, created_at, updated_at
		) VALUES (1, 'ptid:alice', 'session-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		`INSERT INTO friend_chat_sessions VALUES ('ptid:alice', 'ptid:bob')`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("execute migration setup: %v", err)
		}
	}

	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate presence identity: %v", err)
	}

	if db.Migrator().HasColumn("actor_presence_leases", "actor_did") ||
		!db.Migrator().HasColumn("actor_presence_leases", "actor_ptid") {
		t.Fatal("presence actor identity columns were not hard-cut")
	}
	if db.Migrator().HasColumn("friend_chat_sessions", "participant_a_did") ||
		db.Migrator().HasColumn("friend_chat_sessions", "participant_b_did") ||
		!db.Migrator().HasColumn("friend_chat_sessions", "participant_a_ptid") ||
		!db.Migrator().HasColumn("friend_chat_sessions", "participant_b_ptid") {
		t.Fatal("friend session identity columns were not hard-cut")
	}

}

func TestAutoMigrateRollsBackAllPresenceRenamesOnConflict(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:presence_identity_migration_rollback?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE actor_presence_leases (
			id INTEGER PRIMARY KEY,
			actor_did TEXT,
			session_id TEXT,
			last_seen_at DATETIME,
			lease_expires_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE friend_chat_sessions (
			participant_a_did TEXT,
			participant_a_ptid TEXT,
			participant_b_did TEXT
		)`,
		`INSERT INTO actor_presence_leases (
			id, actor_did, session_id, last_seen_at, lease_expires_at, created_at, updated_at
		) VALUES (1, 'ptid:alice', 'session-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		`INSERT INTO friend_chat_sessions VALUES ('ptid:alice', 'ptid:other', 'ptid:bob')`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("execute migration setup: %v", err)
		}
	}

	if err := NewGormRepo(db).AutoMigrate(); err == nil {
		t.Fatal("expected divergent participant identity migration to fail")
	}
	if !db.Migrator().HasColumn("actor_presence_leases", "actor_did") ||
		db.Migrator().HasColumn("actor_presence_leases", "actor_ptid") {
		t.Fatal("earlier presence rename was not rolled back after later conflict")
	}
}

func TestListAudienceIncludesActiveConversationPeers(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:presence_audience?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE friend_chat_sessions (participant_a_ptid TEXT, participant_b_ptid TEXT)`,
		`CREATE TABLE conversation_members (conversation_id TEXT, ptid TEXT, member_status INTEGER)`,
		`INSERT INTO conversation_members VALUES ('direct-1', 'alice', 1), ('direct-1', 'bob', 1)`,
		`INSERT INTO conversation_members VALUES ('old-group', 'alice', 1), ('old-group', 'carol', 2)`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("execute %q: %v", statement, err)
		}
	}

	audience, err := NewGormRepo(db).ListAudience("alice")
	if err != nil {
		t.Fatalf("list audience: %v", err)
	}
	if len(audience) != 2 || audience[0] != "alice" || audience[1] != "bob" {
		t.Fatalf("audience = %v, want [alice bob]", audience)
	}
}
