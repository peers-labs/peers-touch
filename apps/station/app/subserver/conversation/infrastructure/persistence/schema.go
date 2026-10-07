package persistence

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// MigrateCanonicalSchema installs the single Conversation authority schema.
// Existing incompatible v1 development schemas fail later validation and must
// be reset as one deployment operation; this function never preserves a
// parallel authority layout.
func MigrateCanonicalSchema(ctx context.Context, db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("conversation persistence: database is required")
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
	if err := dropRetiredConversationColumns(ctx, db); err != nil {
		return err
	}
	if err := requireCanonicalSchema(db.WithContext(ctx)); err != nil {
		return fmt.Errorf("conversation persistence: validate canonical schema: %w", err)
	}
	return nil
}

// AutoMigrate does not remove retired columns from existing installations.
func dropRetiredConversationColumns(ctx context.Context, db *gorm.DB) error {
	retired := []struct {
		model  any
		column string
	}{
		{
			model:  &ConversationModel{},
			column: "disappear_timer_seconds",
		},
		{
			model:  &ConversationMemberSettingsModel{},
			column: "cleared_at_unix_ms",
		},
	}
	migrator := db.WithContext(ctx).Migrator()
	for _, column := range retired {
		if !migrator.HasColumn(column.model, column.column) {
			continue
		}
		if err := migrator.DropColumn(column.model, column.column); err != nil {
			return fmt.Errorf(
				"conversation persistence: drop retired column %s: %w",
				column.column,
				err,
			)
		}
		if migrator.HasColumn(column.model, column.column) {
			return fmt.Errorf(
				"conversation persistence: retired column %s still exists",
				column.column,
			)
		}
	}
	return nil
}
