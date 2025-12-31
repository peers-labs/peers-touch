package db

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// MigrateReplyField updates existing records to set Reply=true where InReplyTo != 0
// This should be called once after adding the Reply field to the ActivityPubActivity model
func MigrateReplyField(ctx context.Context, db *gorm.DB) error {
	// Update existing records: set Reply=true for all activities where InReplyTo is not 0
	result := db.Model(&ActivityPubActivity{}).
		Where("in_reply_to != ?", 0).
		Where("reply = ?", false).
		Update("reply", true)

	if result.Error != nil {
		return fmt.Errorf("failed to migrate reply field: %w", result.Error)
	}

	fmt.Printf("Successfully updated %d records to set Reply=true\n", result.RowsAffected)

	// Verify the migration
	var totalReplies int64
	db.Model(&ActivityPubActivity{}).Where("reply = ?", true).Count(&totalReplies)
	fmt.Printf("Total replies in database: %d\n", totalReplies)

	var totalWithInReplyTo int64
	db.Model(&ActivityPubActivity{}).Where("in_reply_to != ?", 0).Count(&totalWithInReplyTo)
	fmt.Printf("Total activities with InReplyTo: %d\n", totalWithInReplyTo)

	if totalReplies != totalWithInReplyTo {
		return fmt.Errorf("migration verification failed: Reply count (%d) != InReplyTo count (%d)",
			totalReplies, totalWithInReplyTo)
	}

	fmt.Println("Migration completed and verified successfully!")
	return nil
}
