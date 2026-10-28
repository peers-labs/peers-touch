package conversation

import (
	"testing"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type nonCanonicalProductionConversationModel struct {
	persistence.ConversationModel
	RetiredField uint32 `gorm:"column:retired_field;not null"`
}

func (*nonCanonicalProductionConversationModel) TableName() string {
	return "conversations"
}

type nonCanonicalProductionMemberSettingsModel struct {
	persistence.ConversationMemberSettingsModel
	RetiredField int64 `gorm:"column:retired_field;not null"`
}

func (*nonCanonicalProductionMemberSettingsModel) TableName() string {
	return "conversation_member_settings"
}

func TestMigrateProductionConversationSchemaRejectsNonCanonicalLayout(t *testing.T) {
	t.Parallel()

	db, err := gorm.Open(
		sqlite.Open("file:conversation-production-schema-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&nonCanonicalProductionConversationModel{},
		&nonCanonicalProductionMemberSettingsModel{},
	); err != nil {
		t.Fatal(err)
	}
	if err := migrateProductionConversationSchema(t.Context(), db); err == nil {
		t.Fatal("production accepted a non-canonical schema without reset")
	}
}
