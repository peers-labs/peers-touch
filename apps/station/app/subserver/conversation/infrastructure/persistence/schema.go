package persistence

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
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
	if err := cutConversationScopeColumns(ctx, db); err != nil {
		return err
	}
	if err := requireCanonicalSchema(db.WithContext(ctx)); err != nil {
		return fmt.Errorf("conversation persistence: validate canonical schema: %w", err)
	}
	return nil
}

// cutConversationScopeColumns performs the destructive Local/Federation scope
// hard cut on the conversations table. scope_kind is added nullable so rows
// present from a pre-cut installation backfill cleanly, federation_id is made
// nullable, and every row is normalized exactly once. A development database
// that cannot satisfy the new scope contract is reset rather than dual-written.
func cutConversationScopeColumns(ctx context.Context, db *gorm.DB) error {
	migrator := db.WithContext(ctx).Migrator()
	// GORM AutoMigrate does not reliably relax an existing NOT NULL constraint;
	// the model tag now declares federation_id nullable, so force the alteration.
	if migrator.HasColumn(&ConversationModel{}, "federation_id") {
		if err := migrator.AlterColumn(&ConversationModel{}, "federation_id"); err != nil {
			return fmt.Errorf("conversation persistence: relax federation_id nullability: %w", err)
		}
	}
	updates := []string{
		`UPDATE conversations SET scope_kind = ?
		 WHERE (scope_kind IS NULL OR scope_kind = '') AND federation_id IS NOT NULL AND federation_id <> ''`,
		`UPDATE conversations SET scope_kind = ?
		 WHERE scope_kind IS NULL OR scope_kind = ''`,
		`UPDATE conversations SET federation_id = NULL WHERE scope_kind = ?`,
	}
	args := [][]any{
		{string(valueobject.ScopeKindFederation)},
		{string(valueobject.ScopeKindLocal)},
		{string(valueobject.ScopeKindLocal)},
	}
	for index, statement := range updates {
		if err := db.WithContext(ctx).Exec(statement, args[index]...).Error; err != nil {
			return fmt.Errorf("conversation persistence: backfill conversation scope_kind: %w", err)
		}
	}
	return nil
}

