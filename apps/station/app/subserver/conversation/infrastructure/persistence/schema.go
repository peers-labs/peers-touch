package persistence

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// MigrateCanonicalSchema installs the single Conversation authority schema.
// Retired columns are removed as part of the hard cut; incompatible authority
// layouts still fail validation and must be reset as one deployment operation.
func MigrateCanonicalSchema(ctx context.Context, db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("conversation persistence: database is required")
	}
	if err := dropRetiredColumns(db.WithContext(ctx)); err != nil {
		return fmt.Errorf("conversation persistence: drop retired schema: %w", err)
	}
	if err := db.WithContext(ctx).AutoMigrate(
		&ConversationModel{},
		&ConversationMemberModel{},
		&ConversationMemberDeviceModel{},
		&ConversationEventModel{},
		&ConversationCommandReceiptModel{},
		&ConversationAuthorityPlanModel{},
		&ConversationMemberSettingsModel{},
		&ConversationReadCursorModel{},
		&ConversationLeaveIntentModel{},
		&ConversationFollowerHeadModel{},
		&ConversationFollowerStateModel{},
		&ConversationFollowerPendingEventModel{},
		&ConversationFollowerMemberModel{},
	); err != nil {
		return fmt.Errorf("conversation persistence: migrate canonical schema: %w", err)
	}
	if err := requireCanonicalSchema(db.WithContext(ctx)); err != nil {
		return fmt.Errorf("conversation persistence: validate canonical schema: %w", err)
	}
	return nil
}

func dropRetiredColumns(db *gorm.DB) error {
	for _, retired := range []struct {
		table  string
		probe  any
		column string
	}{
		{
			table:  "conversations",
			probe:  &ConversationModel{},
			column: "disappear_timer_seconds",
		},
		{
			table:  "conversation_member_settings",
			probe:  &ConversationMemberSettingsModel{},
			column: "cleared_at_unix_ms",
		},
	} {
		if !db.Migrator().HasTable(retired.probe) ||
			!db.Migrator().HasColumn(retired.probe, retired.column) {
			continue
		}
		statement := fmt.Sprintf(
			`ALTER TABLE "%s" DROP COLUMN "%s"`,
			retired.table,
			retired.column,
		)
		if err := db.Exec(statement).Error; err != nil {
			return fmt.Errorf(
				"drop %T.%s: %w",
				retired.probe,
				retired.column,
				err,
			)
		}
	}
	return nil
}
