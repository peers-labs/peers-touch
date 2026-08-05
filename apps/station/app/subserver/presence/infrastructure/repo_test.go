package infrastructure

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestListAudienceIncludesActiveConversationPeers(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:presence_audience?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE friend_chat_sessions (participant_a_did TEXT, participant_b_did TEXT)`,
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
