package persistence

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// MigrateCanonicalSchema installs the single Conversation authority schema.
// Existing incompatible layouts fail exact validation and must be reset as one
// deployment operation; no legacy schema is interpreted or rewritten here.
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
		&MessagePublishingGrantModel{},
		&MessagePublicationReceiptModel{},
		&MessagePublishingRateModel{},
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
