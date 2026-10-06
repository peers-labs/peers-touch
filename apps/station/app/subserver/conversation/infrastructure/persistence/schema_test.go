package persistence

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateCanonicalSchemaDropsRetiredColumns(t *testing.T) {
	t.Parallel()

	db, err := gorm.Open(
		sqlite.Open("file:conversation-hard-cut-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := MigrateCanonicalSchema(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
		ALTER TABLE conversations
		ADD COLUMN disappear_timer_seconds INTEGER NOT NULL DEFAULT 0
	`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
		ALTER TABLE conversation_member_settings
		ADD COLUMN cleared_at_unix_ms INTEGER NOT NULL DEFAULT 0
	`).Error; err != nil {
		t.Fatal(err)
	}

	if err := MigrateCanonicalSchema(ctx, db); err != nil {
		t.Fatal(err)
	}
	if db.Migrator().HasColumn(&ConversationModel{}, "disappear_timer_seconds") {
		t.Fatal("retired conversations.disappear_timer_seconds survived canonical migration")
	}
	if db.Migrator().HasColumn(&ConversationMemberSettingsModel{}, "cleared_at_unix_ms") {
		t.Fatal("retired conversation_member_settings.cleared_at_unix_ms survived canonical migration")
	}

	now := time.Date(2026, 10, 5, 17, 0, 0, 0, time.UTC)
	if err := db.Create(&ConversationModel{
		ConversationID:         "schema-hard-cut-group",
		Kind:                   "group",
		Status:                 "active",
		FederationID:           "schema-hard-cut-federation",
		AuthorityStationPeerID: "station-a",
		AuthorityEpoch:         1,
		OwnerPTID:              "ptid:schema-owner",
		MembershipEpoch:        1,
		MLSEpoch:               1,
		Name:                   "Schema hard cut",
		Visibility:             "private",
		CreatedAt:              now,
		UpdatedAt:              now,
	}).Error; err != nil {
		t.Fatalf("insert canonical group after retired-column hard cut: %v", err)
	}
}

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
