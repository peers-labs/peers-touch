package persistence

import (
	"fmt"
	"time"

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
	if !db.Migrator().HasTable(&AgentMessage{}) {
		return nil
	}

	return db.Transaction(func(tx *gorm.DB) error {
		if !tx.Migrator().HasColumn(&AgentMessage{}, "Seq") {
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
		}
		if !tx.Migrator().HasColumn(&AgentMessage{}, "ParentMessageID") {
			if err := tx.Migrator().AddColumn(&AgentMessage{}, "ParentMessageID"); err != nil {
				return fmt.Errorf("add agent_messages.parent_message_id: %w", err)
			}
		}
		if err := tx.Exec(`
			UPDATE agent_messages
			SET parent_message_id = (
				SELECT prior.id
				FROM agent_messages AS prior
				WHERE prior.conversation_id = agent_messages.conversation_id
				  AND prior.seq < agent_messages.seq
				ORDER BY prior.seq DESC
				LIMIT 1
			)
			WHERE parent_message_id IS NULL
			  AND EXISTS (
				SELECT 1
				FROM agent_messages AS prior
				WHERE prior.conversation_id = agent_messages.conversation_id
				  AND prior.seq < agent_messages.seq
			  )
		`).Error; err != nil {
			return fmt.Errorf("backfill agent_messages.parent_message_id: %w", err)
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

// MigrateTurnEvents changes the cursor domain from conversation-wide sequence
// sharing to the canonical per-turn sequence required by replay.
func MigrateTurnEvents(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("turn event migration requires database")
	}
	if !db.Migrator().HasTable(&TurnEvent{}) {
		return nil
	}
	if db.Migrator().HasIndex(&TurnEvent{}, "idx_turn_events_conv_seq") {
		if err := db.Migrator().DropIndex(&TurnEvent{}, "idx_turn_events_conv_seq"); err != nil {
			return fmt.Errorf("drop legacy turn event conversation sequence index: %w", err)
		}
	}
	if !db.Migrator().HasIndex(&TurnEvent{}, "idx_turn_events_turn_seq") {
		if err := db.Migrator().CreateIndex(&TurnEvent{}, "idx_turn_events_turn_seq"); err != nil {
			return fmt.Errorf("create turn event turn sequence index: %w", err)
		}
	}
	return nil
}

// MigrateTurnEvidence binds legacy feedback rows to their owning actor and
// immutable assistant branch after the v1 evidence columns are installed.
func MigrateTurnEvidence(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("turn evidence migration requires database")
	}
	if !db.Migrator().HasTable(&UserFeedback{}) {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`
			UPDATE agent_user_feedback
			SET ptid = COALESCE((
				SELECT conversation.actor_ptid
				FROM agent_turns AS turn_record
				JOIN agent_conversations AS conversation
				  ON conversation.id = turn_record.conversation_id
				WHERE turn_record.id = agent_user_feedback.turn_id
			), '')
			WHERE COALESCE(ptid, '') = ''
		`).Error; err != nil {
			return fmt.Errorf("backfill agent_user_feedback.ptid: %w", err)
		}
		if err := tx.Exec(`
			UPDATE agent_user_feedback
			SET assistant_message_id = COALESCE((
				SELECT message.id
				FROM agent_messages AS message
				WHERE message.turn_id = agent_user_feedback.turn_id
				  AND message.role = 'assistant'
				ORDER BY message.seq DESC
				LIMIT 1
			), '')
			WHERE COALESCE(assistant_message_id, '') = ''
		`).Error; err != nil {
			return fmt.Errorf("backfill agent_user_feedback.assistant_message_id: %w", err)
		}
		if err := tx.Exec(`
			UPDATE agent_user_feedback
			SET rating = CASE signal WHEN 'positive' THEN 1 WHEN 'negative' THEN -1 ELSE 0 END,
			    source = CASE WHEN COALESCE(source, '') = '' THEN 'legacy_growth' ELSE source END,
			    idempotency_key = CASE WHEN COALESCE(idempotency_key, '') = '' THEN id ELSE idempotency_key END,
			    updated_at = COALESCE(updated_at, created_at)
		`).Error; err != nil {
			return fmt.Errorf("backfill agent_user_feedback evidence fields: %w", err)
		}
		return nil
	})
}

// MigrateConversations moves historical ownership to canonical ptid before
// AutoMigrate applies the Station-authoritative conversation contract.
func MigrateConversations(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("agent conversation migration requires database")
	}
	if !db.Migrator().HasTable(&Conversation{}) {
		return nil
	}

	return db.Transaction(func(tx *gorm.DB) error {
		hasActorPTID := tx.Migrator().HasColumn(&Conversation{}, "ActorPTID")
		hasLegacyPTID := tx.Migrator().HasColumn("agent_conversations", "ptid")
		hasUserID := tx.Migrator().HasColumn("agent_conversations", "user_id")
		if !hasActorPTID && hasLegacyPTID {
			if err := tx.Migrator().RenameColumn("agent_conversations", "ptid", "actor_ptid"); err != nil {
				return fmt.Errorf("rename agent_conversations.ptid to actor_ptid: %w", err)
			}
			hasActorPTID = true
		}
		if !hasActorPTID && hasUserID {
			if err := tx.Migrator().RenameColumn("agent_conversations", "user_id", "actor_ptid"); err != nil {
				return fmt.Errorf("rename agent_conversations.user_id to actor_ptid: %w", err)
			}
			hasActorPTID = true
		}
		if !hasActorPTID {
			return fmt.Errorf("agent_conversations has no canonical or migratable actor identity")
		}
		var missingOwners int64
		if err := tx.Table("agent_conversations").
			Where("actor_ptid IS NULL OR TRIM(actor_ptid) = ''").
			Count(&missingOwners).Error; err != nil {
			return fmt.Errorf("count ownerless agent conversations: %w", err)
		}
		if missingOwners > 0 {
			return fmt.Errorf("agent_conversations contains %d ownerless rows", missingOwners)
		}
		for column, field := range map[string]string{
			"active_branch_message_id": "ActiveBranchMessageID",
			"queued_turn_count":        "QueuedTurnCount",
			"version":                  "Version",
		} {
			if !tx.Migrator().HasColumn("agent_conversations", column) {
				if err := tx.Migrator().AddColumn(&Conversation{}, field); err != nil {
					return fmt.Errorf("add agent_conversations.%s: %w", column, err)
				}
			}
		}
		if err := tx.Exec(`
			UPDATE agent_conversations
			SET version = 1
			WHERE version IS NULL OR version = 0
		`).Error; err != nil {
			return fmt.Errorf("backfill agent_conversations.version: %w", err)
		}
		if tx.Migrator().HasTable(&AgentMessage{}) {
			if err := tx.Exec(`
				UPDATE agent_conversations
				SET active_branch_message_id = (
					SELECT message.id
					FROM agent_messages AS message
					WHERE message.conversation_id = agent_conversations.id
					ORDER BY message.seq DESC
					LIMIT 1
				)
				WHERE COALESCE(active_branch_message_id, '') = ''
				  AND EXISTS (
					SELECT 1
					FROM agent_messages AS message
					WHERE message.conversation_id = agent_conversations.id
				  )
			`).Error; err != nil {
				return fmt.Errorf("backfill agent_conversations.active_branch_message_id: %w", err)
			}
		}
		return nil
	})
}

// MigrateFencedClientExecution installs the D19A/D19B persistence contract and
// fails closed for authority created before device proofs and recovery rows.
func MigrateFencedClientExecution(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("fenced client execution migration requires database")
	}

	return db.Transaction(func(tx *gorm.DB) error {
		if err := migrateClientCapabilityLeaseColumns(tx); err != nil {
			return err
		}
		if err := migrateToolCallColumns(tx); err != nil {
			return err
		}
		if err := migrateToolDispatchOutboxColumns(tx); err != nil {
			return err
		}
		if err := tx.AutoMigrate(&ReceiptRecoveryCredential{}, &ClientCapabilityCommand{}); err != nil {
			return fmt.Errorf("migrate fenced client execution ledgers: %w", err)
		}

		now := time.Now().UTC()
		if tx.Migrator().HasTable(&ClientCapabilityLease{}) {
			if err := tx.Model(&ClientCapabilityLease{}).
				Where(
					"revoked_at IS NULL AND (lease_revision = 0 OR capability_set_hash = '' OR device_signing_key_id = '')",
				).
				Updates(map[string]interface{}{
					"revoked_at":    now,
					"revoke_reason": ClientCapabilityLeaseRevokeReasonAdminPolicy,
					"updated_at":    now,
				}).Error; err != nil {
				return fmt.Errorf("revoke legacy unsigned capability leases: %w", err)
			}
		}

		if tx.Migrator().HasTable(&ToolCall{}) {
			if err := tx.Exec(`
				UPDATE agent_tool_calls
				SET status = ?,
				    error_code = ?,
				    ended_at = COALESCE(ended_at, ?),
				    updated_at = ?
				WHERE status = ?
				  AND NOT EXISTS (
					SELECT 1
					FROM agent_receipt_recovery_credentials AS recovery
					WHERE recovery.tool_call_id = agent_tool_calls.tool_call_id
					  AND recovery.fencing_token = agent_tool_calls.fencing_token
				  )
			`,
				ToolCallStatusUnknownSideEffect,
				LegacyPreparedWithoutRecoveryError,
				now,
				now,
				ToolCallStatusPrepared,
			).Error; err != nil {
				return fmt.Errorf("settle legacy prepared tool calls: %w", err)
			}
		}

		if tx.Migrator().HasTable(&ToolBatch{}) && tx.Migrator().HasTable(&ToolCall{}) {
			if err := tx.Exec(`
				UPDATE agent_tool_batches
				SET status = ?,
				    settled_at = COALESCE(settled_at, ?),
				    updated_at = ?
				WHERE status = ?
				  AND EXISTS (
					SELECT 1
					FROM agent_tool_calls AS tool_call
					WHERE tool_call.tool_batch_id = agent_tool_batches.id
					  AND tool_call.error_code = ?
				  )
			`,
				ToolBatchStatusBlocked,
				now,
				now,
				ToolBatchStatusOpen,
				LegacyPreparedWithoutRecoveryError,
			).Error; err != nil {
				return fmt.Errorf("block legacy prepared tool batches: %w", err)
			}
		}
		return nil
	})
}

func migrateClientCapabilityLeaseColumns(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&ClientCapabilityLease{}) {
		return nil
	}
	for column, field := range map[string]string{
		"lease_revision":        "LeaseRevision",
		"capability_set_hash":   "CapabilitySetHash",
		"device_signing_key_id": "DeviceSigningKeyID",
		"revoke_reason":         "RevokeReason",
	} {
		if tx.Migrator().HasColumn("agent_client_capability_leases", column) {
			continue
		}
		if err := tx.Migrator().AddColumn(&ClientCapabilityLease{}, field); err != nil {
			return fmt.Errorf("add agent_client_capability_leases.%s: %w", column, err)
		}
	}
	return nil
}

func migrateToolCallColumns(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&ToolCall{}) {
		return nil
	}
	if tx.Dialector.Name() != "sqlite" {
		columnTypes, err := tx.Migrator().ColumnTypes(&ToolCall{})
		if err != nil {
			return fmt.Errorf("inspect agent_tool_calls columns: %w", err)
		}
		for _, columnType := range columnTypes {
			if columnType.Name() != "schema_version" {
				continue
			}
			length, bounded := columnType.Length()
			if !bounded || length < 64 {
				if err := tx.Migrator().AlterColumn(
					&ToolCall{},
					"SchemaVersion",
				); err != nil {
					return fmt.Errorf(
						"expand agent_tool_calls.schema_version: %w",
						err,
					)
				}
			}
			break
		}
	}
	if err := migrateLegacyDeadline(tx, "agent_tool_calls"); err != nil {
		return err
	}
	for column, field := range map[string]string{
		"capability_lease_revision":      "CapabilityLeaseRevision",
		"manifest_version":               "ManifestVersion",
		"binding_revision":               "BindingRevision",
		"dispatch_committed_at":          "DispatchCommittedAt",
		"execution_attempt_count":        "ExecutionAttemptCount",
		"duplicate_delivery_count":       "DuplicateDeliveryCount",
		"replay_policy":                  "ReplayPolicy",
		"external_idempotency_key":       "ExternalIdempotencyKey",
		"receipt_recovery_credential_id": "ReceiptRecoveryCredentialID",
		"reconciliation_deadline":        "ReconciliationDeadline",
	} {
		if tx.Migrator().HasColumn("agent_tool_calls", column) {
			continue
		}
		if err := tx.Migrator().AddColumn(&ToolCall{}, field); err != nil {
			return fmt.Errorf("add agent_tool_calls.%s: %w", column, err)
		}
	}
	return nil
}

func migrateToolDispatchOutboxColumns(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&ToolDispatchOutbox{}) {
		return nil
	}
	if err := migrateLegacyDeadline(tx, "agent_tool_dispatch_outbox"); err != nil {
		return err
	}
	if !tx.Migrator().HasColumn("agent_tool_dispatch_outbox", "capability_lease_revision") {
		if err := tx.Migrator().AddColumn(&ToolDispatchOutbox{}, "CapabilityLeaseRevision"); err != nil {
			return fmt.Errorf("add agent_tool_dispatch_outbox.capability_lease_revision: %w", err)
		}
	}
	if !tx.Migrator().HasColumn("agent_tool_dispatch_outbox", "reconciliation_deadline") {
		columnType := "TIMESTAMP"
		if tx.Dialector.Name() == "sqlite" {
			columnType = "DATETIME"
		}
		if err := tx.Exec(
			fmt.Sprintf("ALTER TABLE agent_tool_dispatch_outbox ADD COLUMN reconciliation_deadline %s", columnType),
		).Error; err != nil {
			return fmt.Errorf("add agent_tool_dispatch_outbox.reconciliation_deadline: %w", err)
		}
	}
	if err := tx.Exec(`
		UPDATE agent_tool_dispatch_outbox
		SET reconciliation_deadline = execution_deadline
		WHERE reconciliation_deadline IS NULL
	`).Error; err != nil {
		return fmt.Errorf("fail close legacy outbox reconciliation deadline: %w", err)
	}
	if tx.Dialector.Name() == "postgres" {
		if err := tx.Exec(`
			ALTER TABLE agent_tool_dispatch_outbox
			ALTER COLUMN reconciliation_deadline SET NOT NULL
		`).Error; err != nil {
			return fmt.Errorf("enforce outbox reconciliation deadline: %w", err)
		}
	}
	return nil
}

func migrateLegacyDeadline(tx *gorm.DB, table string) error {
	hasLegacy, err := hasExactColumn(tx, table, "deadline")
	if err != nil {
		return err
	}
	hasExecution, err := hasExactColumn(tx, table, "execution_deadline")
	if err != nil {
		return err
	}
	switch {
	case hasLegacy && !hasExecution:
		if err := tx.Migrator().RenameColumn(table, "deadline", "execution_deadline"); err != nil {
			return fmt.Errorf("rename %s.deadline: %w", table, err)
		}
	case hasLegacy && hasExecution:
		if err := tx.Exec(fmt.Sprintf(`
			UPDATE %s
			SET execution_deadline = deadline
			WHERE execution_deadline IS NULL
		`, table)).Error; err != nil {
			return fmt.Errorf("backfill %s.execution_deadline: %w", table, err)
		}
		if err := tx.Migrator().DropColumn(table, "deadline"); err != nil {
			return fmt.Errorf("drop %s.deadline: %w", table, err)
		}
	case !hasLegacy && !hasExecution:
		return fmt.Errorf("%s has neither deadline nor execution_deadline", table)
	}
	return nil
}

func hasExactColumn(tx *gorm.DB, table, column string) (bool, error) {
	columnTypes, err := tx.Migrator().ColumnTypes(table)
	if err != nil {
		return false, fmt.Errorf("inspect %s columns: %w", table, err)
	}
	for _, columnType := range columnTypes {
		if columnType.Name() == column {
			return true, nil
		}
	}
	return false, nil
}
