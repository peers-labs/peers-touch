package infrastructure

import (
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateIdentitySchemaPreservesFriendData(t *testing.T) {
	rds := openSocialMigrationDB(t, "social_friend_data")
	execSocialMigrationSQL(t, rds,
		`CREATE TABLE friend_chat_friend_requests (
			id INTEGER PRIMARY KEY,
			request_id TEXT,
			sender_did TEXT,
			receiver_did TEXT
		)`,
		`CREATE TABLE friend_chat_friendships (
			id INTEGER PRIMARY KEY,
			actor_did TEXT,
			peer_did TEXT,
			status INTEGER
		)`,
		`INSERT INTO friend_chat_friend_requests
			(id, request_id, sender_did, receiver_did)
		 VALUES (41, 'request-1', 'ptid:alice', 'ptid:bob')`,
		`INSERT INTO friend_chat_friendships
			(id, actor_did, peer_did, status)
		 VALUES (73, 'ptid:alice', 'ptid:bob', 1)`,
	)

	if err := migrateSocialIdentityColumns(rds); err != nil {
		t.Fatalf("migrate social identity schema: %v", err)
	}

	assertSocialIdentityRow(
		t,
		rds,
		"friend_chat_friend_requests",
		41,
		map[string]string{"sender_ptid": "ptid:alice", "receiver_ptid": "ptid:bob"},
	)
	assertSocialIdentityRow(
		t,
		rds,
		"friend_chat_friendships",
		73,
		map[string]string{"actor_ptid": "ptid:alice", "peer_ptid": "ptid:bob"},
	)
	for _, legacy := range []struct {
		table  string
		column string
	}{
		{table: "friend_chat_friend_requests", column: "sender_did"},
		{table: "friend_chat_friend_requests", column: "receiver_did"},
		{table: "friend_chat_friendships", column: "actor_did"},
		{table: "friend_chat_friendships", column: "peer_did"},
	} {
		if rds.Migrator().HasColumn(legacy.table, legacy.column) {
			t.Fatalf("legacy column %s.%s remains", legacy.table, legacy.column)
		}
	}
}

func TestMigrateIdentitySchemaRollsBackAllFriendColumnsOnConflict(t *testing.T) {
	rds := openSocialMigrationDB(t, "social_friend_rollback")
	execSocialMigrationSQL(t, rds,
		`CREATE TABLE friend_chat_friend_requests (
			id INTEGER PRIMARY KEY,
			sender_did TEXT,
			receiver_did TEXT
		)`,
		`CREATE TABLE friend_chat_friendships (
			id INTEGER PRIMARY KEY,
			actor_did TEXT,
			peer_did TEXT,
			peer_ptid TEXT
		)`,
		`INSERT INTO friend_chat_friend_requests
			(id, sender_did, receiver_did)
		 VALUES (1, 'ptid:alice', 'ptid:bob')`,
		`INSERT INTO friend_chat_friendships
			(id, actor_did, peer_did, peer_ptid)
		 VALUES (1, 'ptid:alice', 'ptid:bob', 'ptid:mallory')`,
	)

	err := migrateSocialIdentityColumns(rds)
	if err == nil || !strings.Contains(err.Error(), "divergent") {
		t.Fatalf("expected divergent identity error, got %v", err)
	}
	for _, legacy := range []struct {
		table  string
		column string
	}{
		{table: "friend_chat_friend_requests", column: "sender_did"},
		{table: "friend_chat_friend_requests", column: "receiver_did"},
		{table: "friend_chat_friendships", column: "actor_did"},
		{table: "friend_chat_friendships", column: "peer_did"},
	} {
		if !rds.Migrator().HasColumn(legacy.table, legacy.column) {
			t.Fatalf("column %s.%s was not rolled back", legacy.table, legacy.column)
		}
	}
}

func openSocialMigrationDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	rds, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	return rds
}

func execSocialMigrationSQL(t *testing.T, rds *gorm.DB, statements ...string) {
	t.Helper()
	for _, statement := range statements {
		if err := rds.Exec(statement).Error; err != nil {
			t.Fatalf("execute migration fixture: %v", err)
		}
	}
}

func assertSocialIdentityRow(
	t *testing.T,
	rds *gorm.DB,
	table string,
	id int,
	expected map[string]string,
) {
	t.Helper()
	for column, want := range expected {
		var actual string
		if err := rds.Table(table).Select(column).Where("id = ?", id).Row().Scan(&actual); err != nil {
			t.Fatalf("read %s.%s: %v", table, column, err)
		}
		if actual != want {
			t.Fatalf("%s.%s = %q, want %q", table, column, actual, want)
		}
	}
}
