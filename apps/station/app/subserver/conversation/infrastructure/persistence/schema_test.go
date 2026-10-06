package persistence

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type legacyConversationWithDisappearTimer struct {
	ConversationModel
	DisappearTimerSeconds uint32 `gorm:"column:disappear_timer_seconds;not null"`
}

func (*legacyConversationWithDisappearTimer) TableName() string {
	return "conversations"
}

type legacyMemberSettingsWithClearedAt struct {
	ConversationMemberSettingsModel
	ClearedAtUnixMillis int64 `gorm:"column:cleared_at_unix_ms;not null"`
}

func (*legacyMemberSettingsWithClearedAt) TableName() string {
	return "conversation_member_settings"
}

func TestMigrateCanonicalSchemaDropsRetiredConversationColumns(t *testing.T) {
	t.Parallel()

	db, err := gorm.Open(
		sqlite.Open("file:conversation-retired-columns-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	assertRetiredConversationColumnsDropped(t, db)
}

func TestMigrateCanonicalSchemaDropsRetiredConversationColumnsPostgres(
	t *testing.T,
) {
	assertRetiredConversationColumnsDropped(t, openIsolatedPostgres(t))
}

func assertRetiredConversationColumnsDropped(t *testing.T, db *gorm.DB) {
	t.Helper()

	if err := db.AutoMigrate(
		&legacyConversationWithDisappearTimer{},
		&legacyMemberSettingsWithClearedAt{},
	); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0).UTC()
	if err := db.Create(&legacyConversationWithDisappearTimer{
		ConversationModel: ConversationModel{
			ConversationID:         "direct-legacy",
			Kind:                   "direct",
			Status:                 "active",
			FederationID:           "federation-1",
			AuthorityStationPeerID: "station-a",
			AuthorityEpoch:         1,
			OwnerPTID:              "ptid:alice",
			CurrentSequence:        1,
			MembershipEpoch:        1,
			CreatedAt:              now,
			UpdatedAt:              now,
		},
		DisappearTimerSeconds: 60,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&legacyMemberSettingsWithClearedAt{
		ConversationMemberSettingsModel: ConversationMemberSettingsModel{
			ConversationID: "direct-legacy",
			PTID:           "ptid:alice",
			Background:     "default",
			UpdatedAt:      now,
		},
		ClearedAtUnixMillis: now.UnixMilli(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasColumn(
		&ConversationModel{},
		"disappear_timer_seconds",
	) || !db.Migrator().HasColumn(
		&ConversationMemberSettingsModel{},
		"cleared_at_unix_ms",
	) {
		t.Fatal("legacy columns were not installed")
	}

	if err := MigrateCanonicalSchema(t.Context(), db); err != nil {
		t.Fatalf("MigrateCanonicalSchema() error = %v", err)
	}
	if db.Migrator().HasColumn(
		&ConversationModel{},
		"disappear_timer_seconds",
	) {
		t.Fatal("retired disappear_timer_seconds column still exists")
	}
	if db.Migrator().HasColumn(
		&ConversationMemberSettingsModel{},
		"cleared_at_unix_ms",
	) {
		t.Fatal("retired cleared_at_unix_ms column still exists")
	}

	var conversationCount int64
	if err := db.Model(&ConversationModel{}).
		Where("conversation_id = ?", "direct-legacy").
		Count(&conversationCount).Error; err != nil {
		t.Fatal(err)
	}
	if conversationCount != 1 {
		t.Fatalf("preserved conversation count = %d, want 1", conversationCount)
	}
	var settingsCount int64
	if err := db.Model(&ConversationMemberSettingsModel{}).
		Where(
			"conversation_id = ? AND ptid = ?",
			"direct-legacy",
			"ptid:alice",
		).
		Count(&settingsCount).Error; err != nil {
		t.Fatal(err)
	}
	if settingsCount != 1 {
		t.Fatalf("preserved member settings count = %d, want 1", settingsCount)
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
