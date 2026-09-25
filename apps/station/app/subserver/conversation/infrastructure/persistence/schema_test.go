package persistence

import (
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestConversationMemberModelBackfillsLegacyMuteState(t *testing.T) {
	t.Parallel()

	db, err := gorm.Open(
		sqlite.Open("file:conversation-schema-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
		CREATE TABLE conversation_members (
			conversation_id TEXT NOT NULL,
			ptid TEXT NOT NULL,
			role TEXT NOT NULL,
			member_status TEXT NOT NULL,
			actor_home_station_peer_id TEXT NOT NULL,
			joined_sequence INTEGER NOT NULL,
			left_sequence INTEGER NOT NULL,
			PRIMARY KEY (conversation_id, ptid)
		)
	`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
		INSERT INTO conversation_members (
			conversation_id,
			ptid,
			role,
			member_status,
			actor_home_station_peer_id,
			joined_sequence,
			left_sequence
		) VALUES ('direct-1', 'ptid:alice', 'member', 'active', 'station-a', 1, 0)
	`).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.AutoMigrate(&ConversationMemberModel{}); err != nil {
		t.Fatalf("AutoMigrate() error = %v", err)
	}

	var member ConversationMemberModel
	if err := db.First(&member, "conversation_id = ? AND ptid = ?", "direct-1", "ptid:alice").Error; err != nil {
		t.Fatal(err)
	}
	if member.Muted || member.MutedUntil != nil {
		t.Fatalf("legacy member mute state = (%v, %v), want (false, nil)", member.Muted, member.MutedUntil)
	}
}
