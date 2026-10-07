package conversation

import (
	"testing"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type legacyProductionConversationModel struct {
	persistence.ConversationModel
	DisappearTimerSeconds uint32 `gorm:"column:disappear_timer_seconds;not null"`
}

func (*legacyProductionConversationModel) TableName() string {
	return "conversations"
}

type legacyProductionMemberSettingsModel struct {
	persistence.ConversationMemberSettingsModel
	ClearedAtUnixMillis int64 `gorm:"column:cleared_at_unix_ms;not null"`
}

func (*legacyProductionMemberSettingsModel) TableName() string {
	return "conversation_member_settings"
}

func TestMigrateProductionConversationSchemaUsesCanonicalMigration(t *testing.T) {
	t.Parallel()

	db, err := gorm.Open(
		sqlite.Open("file:conversation-production-schema-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&legacyProductionConversationModel{},
		&legacyProductionMemberSettingsModel{},
	); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasColumn(
		&persistence.ConversationModel{},
		"disappear_timer_seconds",
	) || !db.Migrator().HasColumn(
		&persistence.ConversationMemberSettingsModel{},
		"cleared_at_unix_ms",
	) {
		t.Fatal("legacy production columns were not installed")
	}

	if err := migrateProductionConversationSchema(t.Context(), db); err != nil {
		t.Fatalf("migrateProductionConversationSchema() error = %v", err)
	}
	if db.Migrator().HasColumn(
		&persistence.ConversationModel{},
		"disappear_timer_seconds",
	) {
		t.Fatal("production migration retained disappear_timer_seconds")
	}
	if db.Migrator().HasColumn(
		&persistence.ConversationMemberSettingsModel{},
		"cleared_at_unix_ms",
	) {
		t.Fatal("production migration retained cleared_at_unix_ms")
	}
}
