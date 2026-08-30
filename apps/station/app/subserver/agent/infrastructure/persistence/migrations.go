package persistence

import (
	"fmt"

	"gorm.io/gorm"
)

type actorIdentityColumnMigration struct {
	table         string
	legacyColumn  string
	targetColumn  string
	legacyIndexes []string
}

var actorIdentityColumnMigrations = []actorIdentityColumnMigration{
	{table: "agents", legacyColumn: "owner_actor_id", targetColumn: "owner_actor_ptid", legacyIndexes: []string{"idx_agents_owner_actor_id"}},
	{table: "agent_conversations", legacyColumn: "user_id", targetColumn: "actor_ptid", legacyIndexes: []string{"idx_conversations_user_id"}},
	{table: "agent_credential_pool", legacyColumn: "actor_id", targetColumn: "actor_ptid", legacyIndexes: []string{"idx_credentials_actor_provider"}},
	{table: "agent_models", legacyColumn: "actor_id", targetColumn: "actor_ptid", legacyIndexes: []string{"idx_agent_models_actor_provider_model"}},
	{table: "agent_providers", legacyColumn: "actor_id", targetColumn: "actor_ptid", legacyIndexes: []string{"idx_agent_providers_actor_provider"}},
	{table: "agent_task_runs", legacyColumn: "owner_actor_id", targetColumn: "owner_actor_ptid"},
	{table: "agent_collaboration_tasks", legacyColumn: "goal_owner_id", targetColumn: "goal_owner_ptid", legacyIndexes: []string{"idx_agent_collaboration_tasks_owner"}},
	{table: "ecosystem_agent_groups", legacyColumn: "owner_actor_id", targetColumn: "owner_actor_ptid"},
	{table: "ecosystem_topic_comments", legacyColumn: "author_id", targetColumn: "author_ptid"},
	{table: "ecosystem_eval_datasets", legacyColumn: "owner_actor_id", targetColumn: "owner_actor_ptid"},
	{table: "ecosystem_custom_plugins", legacyColumn: "owner_actor_id", targetColumn: "owner_actor_ptid"},
}

// MigrateActorIdentityColumns performs the PTID naming hard cut before
// AutoMigrate observes the target models. Existing values are preserved by
// renaming columns in place; coexistence fails closed instead of choosing a
// compatibility source.
func MigrateActorIdentityColumns(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("agent actor identity migration requires database")
	}

	return db.Transaction(func(tx *gorm.DB) error {
		for _, migration := range actorIdentityColumnMigrations {
			if !tx.Migrator().HasTable(migration.table) {
				continue
			}
			hasLegacy := tx.Migrator().HasColumn(migration.table, migration.legacyColumn)
			hasTarget := tx.Migrator().HasColumn(migration.table, migration.targetColumn)
			if hasLegacy && hasTarget {
				return fmt.Errorf(
					"migrate %s actor identity: both %s and %s exist",
					migration.table,
					migration.legacyColumn,
					migration.targetColumn,
				)
			}
			if hasLegacy {
				if err := tx.Migrator().RenameColumn(migration.table, migration.legacyColumn, migration.targetColumn); err != nil {
					return fmt.Errorf(
						"rename %s.%s to %s: %w",
						migration.table,
						migration.legacyColumn,
						migration.targetColumn,
						err,
					)
				}
			}
			for _, legacyIndex := range migration.legacyIndexes {
				if tx.Migrator().HasIndex(migration.table, legacyIndex) {
					if err := tx.Migrator().DropIndex(migration.table, legacyIndex); err != nil {
						return fmt.Errorf("drop legacy index %s on %s: %w", legacyIndex, migration.table, err)
					}
				}
			}
		}
		return nil
	})
}

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
