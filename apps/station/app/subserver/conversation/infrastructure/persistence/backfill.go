package persistence

import (
	"fmt"

	"gorm.io/gorm"
)

// BackfillConversationDefaults fills NULL values with zero defaults in columns
// that the current ConversationModel declares NOT NULL. This must run inside
// the same transaction that calls AutoMigrate so legacy rows do not violate the
// constraint being applied.
func BackfillConversationDefaults(tx *gorm.DB) error {
	if !tx.Migrator().HasTable("conversations") {
		return nil
	}

	columns := []struct {
		name         string
		defaultValue string
	}{
		{"current_sequence", "0"},
		{"authority_epoch", "0"},
		{"membership_epoch", "0"},
		{"mls_epoch", "0"},
		{"disappear_timer_seconds", "0"},
	}

	for _, col := range columns {
		if !tx.Migrator().HasColumn("conversations", col.name) {
			continue
		}
		result := tx.Exec(
			fmt.Sprintf(
				"UPDATE conversations SET %s = %s WHERE %s IS NULL",
				col.name, col.defaultValue, col.name,
			),
		)
		if result.Error != nil {
			return fmt.Errorf("backfill conversations.%s: %w", col.name, result.Error)
		}
	}
	return nil
}
