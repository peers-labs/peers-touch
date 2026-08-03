package persistence

import (
	"fmt"

	"gorm.io/gorm"
)

// MigrateAgentMessages prepares historical rows before AutoMigrate applies the
// current AgentMessage constraints.
func MigrateAgentMessages(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("agent message migration requires database")
	}
	if !db.Migrator().HasTable(&AgentMessage{}) || db.Migrator().HasColumn(&AgentMessage{}, "Seq") {
		return nil
	}

	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`ALTER TABLE agent_messages ADD COLUMN seq BIGINT`).Error; err != nil {
			return fmt.Errorf("add agent_messages.seq: %w", err)
		}
		if err := tx.Exec(`
			UPDATE agent_messages AS target
			SET seq = (
				SELECT COUNT(*)
				FROM agent_messages AS prior
				WHERE prior.conversation_id = target.conversation_id
				  AND (
					prior.created_at < target.created_at
					OR (prior.created_at = target.created_at AND prior.id <= target.id)
				  )
			)
			WHERE target.seq IS NULL
		`).Error; err != nil {
			return fmt.Errorf("backfill agent_messages.seq: %w", err)
		}
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec(`ALTER TABLE agent_messages ALTER COLUMN seq SET NOT NULL`).Error; err != nil {
				return fmt.Errorf("enforce agent_messages.seq not null: %w", err)
			}
		}
		if err := tx.Exec(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_messages_conv_seq
			ON agent_messages (conversation_id, seq)
		`).Error; err != nil {
			return fmt.Errorf("create agent_messages conversation sequence index: %w", err)
		}
		return nil
	})
}
