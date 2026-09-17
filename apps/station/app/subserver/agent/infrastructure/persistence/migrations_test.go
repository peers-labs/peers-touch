package persistence

import (
	"fmt"
	"sync"
	"testing"
	"time"

	agentmodel "github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

type legacyToolReceiptAttempt struct {
	ID     string `gorm:"primaryKey;type:varchar(64)"`
	Status string `gorm:"not null;type:varchar(32)"`
}

func (legacyToolReceiptAttempt) TableName() string {
	return "agent_tool_receipt_attempts"
}

func TestToolCallSchemaVersionFitsCapabilityManifestVersion(t *testing.T) {
	parsed, err := schema.Parse(
		&ToolCall{},
		&sync.Map{},
		schema.NamingStrategy{},
	)
	if err != nil {
		t.Fatalf("parse ToolCall schema: %v", err)
	}
	field := parsed.LookUpField("SchemaVersion")
	if field == nil || field.TagSettings["TYPE"] != "varchar(64)" {
		t.Fatalf("ToolCall schema_version type = %v, want varchar(64)", field)
	}
}

func TestToolReceiptAttemptStatusFitsReceiptStatus(t *testing.T) {
	parsed, err := schema.Parse(
		&ToolReceiptAttempt{},
		&sync.Map{},
		schema.NamingStrategy{},
	)
	if err != nil {
		t.Fatalf("parse ToolReceiptAttempt schema: %v", err)
	}
	field := parsed.LookUpField("Status")
	if field == nil || field.TagSettings["TYPE"] != "varchar(64)" {
		t.Fatalf("ToolReceiptAttempt status type = %v, want varchar(64)", field)
	}

	for value, status := range agentmodel.ClientCapabilityReceiptStatus_name {
		if len(status) > 64 {
			t.Fatalf("receipt status %d length = %d, exceeds varchar(64)", value, len(status))
		}
	}
}

func TestMigrateFencedClientExecutionExpandsReceiptAttemptStatus(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:fenced-client-receipt-status?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&legacyToolReceiptAttempt{}); err != nil {
		t.Fatalf("create legacy receipt attempt table: %v", err)
	}
	if err := db.Create(&legacyToolReceiptAttempt{
		ID:     "receipt-legacy",
		Status: "FAILED",
	}).Error; err != nil {
		t.Fatalf("seed legacy receipt attempt: %v", err)
	}

	if err := MigrateFencedClientExecution(db); err != nil {
		t.Fatalf("migrate receipt attempt status: %v", err)
	}
	if err := MigrateFencedClientExecution(db); err != nil {
		t.Fatalf("repeat receipt attempt status migration: %v", err)
	}

	columnTypes, err := db.Migrator().ColumnTypes(&ToolReceiptAttempt{})
	if err != nil {
		t.Fatalf("inspect receipt attempt columns: %v", err)
	}
	var statusLength int64
	for _, columnType := range columnTypes {
		if columnType.Name() != "status" {
			continue
		}
		var bounded bool
		statusLength, bounded = columnType.Length()
		if !bounded {
			t.Fatal("receipt attempt status column is not length-bounded")
		}
		break
	}
	if statusLength != 64 {
		t.Fatalf("receipt attempt status length = %d, want 64", statusLength)
	}

	var legacyStatus string
	if err := db.Table("agent_tool_receipt_attempts").
		Select("status").
		Where("id = ?", "receipt-legacy").
		Scan(&legacyStatus).Error; err != nil {
		t.Fatalf("read migrated receipt attempt: %v", err)
	}
	if legacyStatus != "FAILED" {
		t.Fatalf("migrated receipt attempt status = %q, want FAILED", legacyStatus)
	}

	preparedStatus := agentmodel.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED.String()
	if err := db.Exec(`
		INSERT INTO agent_tool_receipt_attempts (id, status)
		VALUES ('receipt-prepared', ?)
	`, preparedStatus).Error; err != nil {
		t.Fatalf("insert full prepared receipt status: %v", err)
	}
}

func TestActorPTIDColumnsUseCanonicalTextStorage(t *testing.T) {
	cases := []struct {
		name      string
		model     interface{}
		fieldName string
	}{
		{name: "provider", model: &AgentProvider{}, fieldName: "ActorPTID"},
		{name: "credential", model: &Credential{}, fieldName: "ActorPTID"},
		{name: "model", model: &AgentModel{}, fieldName: "ActorPTID"},
		{name: "task run", model: &TaskRun{}, fieldName: "OwnerActorPTID"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			parsed, err := schema.Parse(
				testCase.model,
				&sync.Map{},
				schema.NamingStrategy{},
			)
			if err != nil {
				t.Fatalf("parse %s schema: %v", testCase.name, err)
			}
			field := parsed.LookUpField(testCase.fieldName)
			if field == nil || field.TagSettings["TYPE"] != "text" {
				t.Fatalf("%s actor PTID type = %v, want text", testCase.name, field)
			}
		})
	}
}

func TestMigrateActorIdentityColumnsRenamesLegacyColumnsIdempotently(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:agent-actor-identity-migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}

	for _, migration := range actorIdentityColumnMigrations {
		createTable := fmt.Sprintf(
			`CREATE TABLE %s (id TEXT PRIMARY KEY, %s VARCHAR(64) NOT NULL)`,
			migration.table,
			migration.legacyColumn,
		)
		if err := db.Exec(createTable).Error; err != nil {
			t.Fatalf("create legacy table %s: %v", migration.table, err)
		}
		insertRow := fmt.Sprintf(
			`INSERT INTO %s (id, %s) VALUES (?, ?)`,
			migration.table,
			migration.legacyColumn,
		)
		if err := db.Exec(insertRow, "row-1", "ptid:actor-1").Error; err != nil {
			t.Fatalf("insert legacy row into %s: %v", migration.table, err)
		}
	}

	if err := MigrateActorIdentityColumns(db); err != nil {
		t.Fatalf("migrate actor identity columns: %v", err)
	}
	if err := MigrateActorIdentityColumns(db); err != nil {
		t.Fatalf("repeat actor identity migration: %v", err)
	}

	for _, migration := range actorIdentityColumnMigrations {
		if db.Migrator().HasColumn(migration.table, migration.legacyColumn) {
			t.Fatalf("legacy column %s.%s still exists", migration.table, migration.legacyColumn)
		}
		if !db.Migrator().HasColumn(migration.table, migration.targetColumn) {
			t.Fatalf("target column %s.%s does not exist", migration.table, migration.targetColumn)
		}

		var actorPTID string
		selectValue := fmt.Sprintf(
			`SELECT %s FROM %s WHERE id = ?`,
			migration.targetColumn,
			migration.table,
		)
		if err := db.Raw(selectValue, "row-1").Scan(&actorPTID).Error; err != nil {
			t.Fatalf("read migrated value from %s: %v", migration.table, err)
		}
		if actorPTID != "ptid:actor-1" {
			t.Fatalf("%s.%s = %q, want %q", migration.table, migration.targetColumn, actorPTID, "ptid:actor-1")
		}
	}
}

func TestMigrateActorIdentityColumnsRejectsDualColumns(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:agent-actor-identity-conflict?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.Exec(`
		CREATE TABLE agents (
			id TEXT PRIMARY KEY,
			owner_actor_id TEXT NOT NULL,
			owner_actor_ptid TEXT NOT NULL
		)
	`).Error; err != nil {
		t.Fatalf("create conflicting agents table: %v", err)
	}

	if err := MigrateActorIdentityColumns(db); err == nil {
		t.Fatal("expected dual actor identity columns to fail closed")
	}
}

func TestMigrateAgentMessagesBackfillsConversationSequences(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:agent-message-migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.Exec(`
		CREATE TABLE agent_messages (
			id TEXT PRIMARY KEY,
			conversation_id TEXT NOT NULL,
			role TEXT NOT NULL,
			created_at DATETIME NOT NULL
		)
	`).Error; err != nil {
		t.Fatalf("create legacy table: %v", err)
	}

	createdAt := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	for _, row := range []struct {
		id             string
		conversationID string
		createdAt      time.Time
	}{
		{id: "message-b", conversationID: "conversation-1", createdAt: createdAt},
		{id: "message-a", conversationID: "conversation-1", createdAt: createdAt},
		{id: "message-c", conversationID: "conversation-2", createdAt: createdAt},
	} {
		if err := db.Exec(
			`INSERT INTO agent_messages (id, conversation_id, role, created_at) VALUES (?, ?, ?, ?)`,
			row.id,
			row.conversationID,
			"user",
			row.createdAt,
		).Error; err != nil {
			t.Fatalf("insert legacy message: %v", err)
		}
	}

	if err := MigrateAgentMessages(db); err != nil {
		t.Fatalf("migrate messages: %v", err)
	}
	if err := MigrateAgentMessages(db); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}

	var rows []struct {
		ID              string
		Seq             int64
		ParentMessageID *string
	}
	if err := db.Table("agent_messages").Select("id, seq, parent_message_id").Order("id").Scan(&rows).Error; err != nil {
		t.Fatalf("read migrated messages: %v", err)
	}
	want := map[string]int64{
		"message-a": 1,
		"message-b": 2,
		"message-c": 1,
	}
	for _, row := range rows {
		if row.Seq != want[row.ID] {
			t.Fatalf("message %s seq = %d, want %d", row.ID, row.Seq, want[row.ID])
		}
	}
	parentByID := map[string]string{}
	for _, row := range rows {
		if row.ParentMessageID != nil {
			parentByID[row.ID] = *row.ParentMessageID
		}
	}
	if parentByID["message-b"] != "message-a" {
		t.Fatalf("message-b parent=%q, want message-a", parentByID["message-b"])
	}
	if _, found := parentByID["message-a"]; found {
		t.Fatal("first conversation message unexpectedly has a parent")
	}
	if !db.Migrator().HasIndex(&AgentMessage{}, "idx_agent_messages_conv_seq") {
		t.Fatal("conversation sequence index was not created")
	}
}

func TestMigrateTurnEventsReplacesConversationCursorIndex(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:turn-event-migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.Exec(`
		CREATE TABLE agent_turn_events (
			id TEXT PRIMARY KEY,
			conversation_id TEXT NOT NULL,
			turn_id TEXT NOT NULL,
			event_seq BIGINT NOT NULL,
			event_type TEXT NOT NULL,
			payload TEXT NOT NULL,
			created_at DATETIME NOT NULL
		);
		CREATE UNIQUE INDEX idx_turn_events_conv_seq
			ON agent_turn_events (conversation_id, event_seq)
	`).Error; err != nil {
		t.Fatalf("create legacy turn events: %v", err)
	}

	if err := MigrateTurnEvents(db); err != nil {
		t.Fatalf("migrate turn events: %v", err)
	}
	if err := MigrateTurnEvents(db); err != nil {
		t.Fatalf("repeat turn event migration: %v", err)
	}
	if db.Migrator().HasIndex(&TurnEvent{}, "idx_turn_events_conv_seq") {
		t.Fatal("legacy conversation cursor index remains")
	}
	if !db.Migrator().HasIndex(&TurnEvent{}, "idx_turn_events_turn_seq") {
		t.Fatal("per-turn cursor index was not created")
	}
}

func TestMigrateConversationsRenamesHistoricalOwnerToActorPTID(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:agent-conversation-migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.Exec(`
		CREATE TABLE agent_conversations (
			id TEXT PRIMARY KEY,
			agent_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			title TEXT NOT NULL
		)
	`).Error; err != nil {
		t.Fatalf("create legacy conversations: %v", err)
	}
	if err := db.Exec(`
		INSERT INTO agent_conversations (id, agent_id, user_id, title)
		VALUES ('conversation-1', 'agent-1', 'ptid:person:fixture', 'Fixture')
	`).Error; err != nil {
		t.Fatalf("insert legacy conversation: %v", err)
	}

	if err := MigrateConversations(db); err != nil {
		t.Fatalf("migrate conversations: %v", err)
	}
	if err := MigrateConversations(db); err != nil {
		t.Fatalf("repeat conversation migration: %v", err)
	}
	if !db.Migrator().HasColumn("agent_conversations", "actor_ptid") {
		t.Fatal("actor_ptid column missing after migration")
	}
	if db.Migrator().HasColumn("agent_conversations", "user_id") {
		t.Fatal("legacy user_id column remains after migration")
	}
	var ptid string
	if err := db.Table("agent_conversations").
		Select("actor_ptid").
		Where("id = ?", "conversation-1").
		Scan(&ptid).Error; err != nil {
		t.Fatalf("read migrated owner: %v", err)
	}
	if ptid != "ptid:person:fixture" {
		t.Fatalf("migrated ptid=%q", ptid)
	}
	var revision struct {
		Version               uint64
		QueuedTurnCount       uint32
		ActiveBranchMessageID string
	}
	if err := db.Table("agent_conversations").
		Select("version, queued_turn_count, active_branch_message_id").
		Where("id = ?", "conversation-1").
		Scan(&revision).Error; err != nil {
		t.Fatalf("read migrated revision fields: %v", err)
	}
	if revision.Version != 1 || revision.QueuedTurnCount != 0 || revision.ActiveBranchMessageID != "" {
		t.Fatalf("unexpected migrated revision fields: %+v", revision)
	}
}

func TestMigrateConversationsBackfillsActiveBranchHead(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:agent-conversation-branch-head?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.Exec(`
		CREATE TABLE agent_conversations (
			id TEXT PRIMARY KEY,
			agent_id TEXT NOT NULL,
			ptid TEXT NOT NULL,
			title TEXT NOT NULL
		);
		CREATE TABLE agent_messages (
			id TEXT PRIMARY KEY,
			conversation_id TEXT NOT NULL,
			role TEXT NOT NULL,
			seq BIGINT NOT NULL,
			parent_message_id TEXT
		);
		INSERT INTO agent_conversations (id, agent_id, ptid, title)
		VALUES ('conversation-1', 'agent-1', 'ptid:person:fixture', 'Fixture');
		INSERT INTO agent_messages (id, conversation_id, role, seq, parent_message_id)
		VALUES
			('message-1', 'conversation-1', 'user', 1, NULL),
			('message-2', 'conversation-1', 'assistant', 2, 'message-1')
	`).Error; err != nil {
		t.Fatalf("seed legacy branch: %v", err)
	}

	if err := MigrateConversations(db); err != nil {
		t.Fatalf("migrate conversations: %v", err)
	}
	var head string
	if err := db.Table("agent_conversations").
		Select("active_branch_message_id").
		Where("id = ?", "conversation-1").
		Scan(&head).Error; err != nil {
		t.Fatalf("read active branch head: %v", err)
	}
	if head != "message-2" {
		t.Fatalf("active branch head=%q, want message-2", head)
	}
}

func TestMigrateConversationsRejectsOwnerlessRows(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:agent-conversation-ownerless?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.Exec(`
		CREATE TABLE agent_conversations (
			id TEXT PRIMARY KEY,
			agent_id TEXT NOT NULL,
			user_id TEXT,
			title TEXT NOT NULL
		)
	`).Error; err != nil {
		t.Fatalf("create ownerless legacy conversations: %v", err)
	}
	if err := db.Exec(`
		INSERT INTO agent_conversations (id, agent_id, user_id, title)
		VALUES ('conversation-ownerless', 'agent-1', '', 'Invalid')
	`).Error; err != nil {
		t.Fatalf("insert ownerless conversation: %v", err)
	}

	if err := MigrateConversations(db); err == nil {
		t.Fatal("ownerless conversation migration succeeded")
	}
}

func TestMigrateFencedClientExecutionFailsClosedForLegacyAuthority(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:fenced-client-execution-legacy?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	deadline := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)
	if err := db.Exec(`
		CREATE TABLE agent_client_capability_leases (
			session_id TEXT PRIMARY KEY,
			actor_id TEXT NOT NULL,
			device_id TEXT NOT NULL,
			revoked_at DATETIME,
			updated_at DATETIME NOT NULL
		);
		CREATE TABLE agent_tool_calls (
			id TEXT PRIMARY KEY,
			tool_call_id TEXT NOT NULL,
			tool_batch_id TEXT NOT NULL,
			fencing_token INTEGER NOT NULL,
			status TEXT NOT NULL,
			error_code TEXT NOT NULL,
			deadline DATETIME,
			ended_at DATETIME,
			updated_at DATETIME NOT NULL
		);
		CREATE TABLE agent_tool_batches (
			id TEXT PRIMARY KEY,
			status TEXT NOT NULL,
			settled_at DATETIME,
			updated_at DATETIME NOT NULL
		);
		CREATE TABLE agent_tool_dispatch_outbox (
			request_id TEXT PRIMARY KEY,
			deadline DATETIME NOT NULL
		)
	`).Error; err != nil {
		t.Fatalf("create legacy fenced execution tables: %v", err)
	}
	if err := db.Exec(`
		INSERT INTO agent_client_capability_leases
			(session_id, actor_id, device_id, revoked_at, updated_at)
		VALUES ('session-legacy', 'actor-1', 'device-1', NULL, ?);
		INSERT INTO agent_tool_batches (id, status, settled_at, updated_at)
		VALUES ('batch-legacy', ?, NULL, ?);
		INSERT INTO agent_tool_calls
			(id, tool_call_id, tool_batch_id, fencing_token, status, error_code, deadline, ended_at, updated_at)
		VALUES ('call-row-legacy', 'call-legacy', 'batch-legacy', 7, ?, '', ?, NULL, ?);
		INSERT INTO agent_tool_dispatch_outbox (request_id, deadline)
		VALUES ('request-legacy', ?)
	`,
		deadline,
		ToolBatchStatusOpen,
		deadline,
		ToolCallStatusPrepared,
		deadline,
		deadline,
		deadline,
	).Error; err != nil {
		t.Fatalf("seed legacy fenced execution rows: %v", err)
	}

	if err := MigrateFencedClientExecution(db); err != nil {
		t.Fatalf("migrate fenced client execution: %v", err)
	}
	if err := MigrateFencedClientExecution(db); err != nil {
		t.Fatalf("repeat fenced client execution migration: %v", err)
	}

	for table, columns := range map[string][]string{
		"agent_client_capability_leases": {
			"lease_revision",
			"capability_set_hash",
			"device_signing_key_id",
			"revoke_reason",
		},
		"agent_tool_calls": {
			"execution_deadline",
			"reconciliation_deadline",
			"capability_lease_revision",
			"replay_policy",
			"external_idempotency_key",
			"receipt_recovery_credential_id",
		},
		"agent_tool_dispatch_outbox": {
			"execution_deadline",
			"reconciliation_deadline",
			"capability_lease_revision",
		},
	} {
		for _, column := range columns {
			if !db.Migrator().HasColumn(table, column) {
				t.Fatalf("%s.%s missing after migration", table, column)
			}
		}
		hasLegacyDeadline, err := hasExactColumn(db, table, "deadline")
		if err != nil {
			t.Fatalf("inspect %s deadline columns: %v", table, err)
		}
		if hasLegacyDeadline {
			t.Fatalf("%s retains legacy deadline column", table)
		}
	}

	var lease struct {
		LeaseRevision      uint64
		CapabilitySetHash  string
		DeviceSigningKeyID string
		RevokeReason       int32
		RevokedAt          *time.Time
	}
	if err := db.Table("agent_client_capability_leases").
		Where("session_id = ?", "session-legacy").
		Scan(&lease).Error; err != nil {
		t.Fatalf("read migrated lease: %v", err)
	}
	if lease.LeaseRevision != 0 || lease.CapabilitySetHash != "" || lease.DeviceSigningKeyID != "" {
		t.Fatalf("legacy lease received synthesized proof authority: %+v", lease)
	}
	if lease.RevokedAt == nil || lease.RevokeReason != ClientCapabilityLeaseRevokeReasonAdminPolicy {
		t.Fatalf("legacy lease was not revoked fail-closed: %+v", lease)
	}

	var call struct {
		Status                      string
		ErrorCode                   string
		ExecutionDeadline           time.Time
		ReconciliationDeadline      *time.Time
		CapabilityLeaseRevision     uint64
		ReceiptRecoveryCredentialID string
	}
	if err := db.Table("agent_tool_calls").
		Where("tool_call_id = ?", "call-legacy").
		Scan(&call).Error; err != nil {
		t.Fatalf("read migrated tool call: %v", err)
	}
	if call.Status != ToolCallStatusUnknownSideEffect || call.ErrorCode != LegacyPreparedWithoutRecoveryError {
		t.Fatalf("legacy prepared call did not settle unknown: %+v", call)
	}
	if !call.ExecutionDeadline.Equal(deadline) || call.ReconciliationDeadline != nil {
		t.Fatalf("legacy tool call deadlines were not migrated fail-closed: %+v", call)
	}
	if call.CapabilityLeaseRevision != 0 || call.ReceiptRecoveryCredentialID != "" {
		t.Fatalf("legacy tool call received synthesized recovery authority: %+v", call)
	}

	var batchStatus string
	if err := db.Table("agent_tool_batches").
		Select("status").
		Where("id = ?", "batch-legacy").
		Scan(&batchStatus).Error; err != nil {
		t.Fatalf("read migrated tool batch: %v", err)
	}
	if batchStatus != ToolBatchStatusBlocked {
		t.Fatalf("legacy prepared batch status=%q, want %q", batchStatus, ToolBatchStatusBlocked)
	}

	var outbox struct {
		ExecutionDeadline       time.Time
		ReconciliationDeadline  time.Time
		CapabilityLeaseRevision uint64
	}
	if err := db.Table("agent_tool_dispatch_outbox").
		Where("request_id = ?", "request-legacy").
		Scan(&outbox).Error; err != nil {
		t.Fatalf("read migrated outbox: %v", err)
	}
	if !outbox.ExecutionDeadline.Equal(deadline) ||
		!outbox.ReconciliationDeadline.Equal(deadline) ||
		outbox.CapabilityLeaseRevision != 0 {
		t.Fatalf("legacy outbox was not migrated fail-closed: %+v", outbox)
	}

	var recoveryCount int64
	if err := db.Model(&ReceiptRecoveryCredential{}).Count(&recoveryCount).Error; err != nil {
		t.Fatalf("count recovery credentials: %v", err)
	}
	if recoveryCount != 0 {
		t.Fatalf("migration synthesized %d recovery credentials", recoveryCount)
	}
}

func TestMigrateFencedClientExecutionPreservesPreparedWithRecoveryCredential(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:fenced-client-execution-current?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(
		&ClientCapabilityLease{},
		&ToolCall{},
		&ToolBatch{},
		&ToolDispatchOutbox{},
		&ReceiptRecoveryCredential{},
		&ClientCapabilityCommand{},
	); err != nil {
		t.Fatalf("migrate current fenced execution models: %v", err)
	}

	now := time.Date(2026, 8, 22, 13, 0, 0, 0, time.UTC)
	call := &ToolCall{
		ID:                          "call-row-current",
		ActorID:                     "actor-1",
		TurnID:                      "turn-1",
		AttemptID:                   "attempt-1",
		ToolBatchID:                 "batch-current",
		ToolName:                    "filesystem.read",
		ToolCallID:                  "call-current",
		CapabilityID:                "filesystem.read",
		BoundedArguments:            []byte{},
		ResourceRefs:                []byte{},
		FencingToken:                8,
		Status:                      ToolCallStatusPrepared,
		ExecutionDeadline:           timePointer(now.Add(time.Minute)),
		ReconciliationDeadline:      timePointer(now.Add(10 * time.Minute)),
		CapabilityLeaseRevision:     3,
		ReceiptRecoveryCredentialID: "credential-current",
		CreatedAt:                   now,
		UpdatedAt:                   now,
	}
	batch := &ToolBatch{
		ID:                "batch-current",
		ActorID:           "actor-1",
		TurnID:            "turn-1",
		AttemptID:         "attempt-1",
		ConversationID:    "conversation-1",
		AgentID:           "agent-1",
		Provider:          "provider",
		Model:             "model",
		SystemPrompt:      "",
		ExpectedCallCount: 1,
		Status:            ToolBatchStatusOpen,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	recovery := &ReceiptRecoveryCredential{
		ID:                      "credential-current",
		ActorID:                 "actor-1",
		DeviceID:                "device-1",
		DeviceSigningKeyID:      "signing-key-1",
		RequestID:               "request-current",
		ToolCallID:              "call-current",
		ExecutionClaimID:        "claim-current",
		CapabilityLeaseRevision: 3,
		FencingToken:            8,
		PayloadHash:             "payload-hash",
		ReplayPolicy:            ClientExecutionReplayPolicyNoReplayAfterPrepared,
		ExecutionDeadline:       now.Add(time.Minute),
		ReconciliationDeadline:  now.Add(10 * time.Minute),
		ScopeHash:               "scope-hash",
		NonceHash:               "nonce-hash",
		IssuedAt:                now,
		ExpiresAt:               now.Add(10 * time.Minute),
	}
	if err := db.Create(batch).Error; err != nil {
		t.Fatalf("create current batch: %v", err)
	}
	if err := db.Create(call).Error; err != nil {
		t.Fatalf("create current tool call: %v", err)
	}
	if err := db.Create(recovery).Error; err != nil {
		t.Fatalf("create current recovery credential: %v", err)
	}

	if err := MigrateFencedClientExecution(db); err != nil {
		t.Fatalf("migrate current fenced execution rows: %v", err)
	}

	var migrated ToolCall
	if err := db.First(&migrated, "id = ?", call.ID).Error; err != nil {
		t.Fatalf("read current tool call: %v", err)
	}
	if migrated.Status != ToolCallStatusPrepared || migrated.ErrorCode != "" {
		t.Fatalf("credential-backed prepared call was invalidated: %+v", migrated)
	}
	var migratedBatch ToolBatch
	if err := db.First(&migratedBatch, "id = ?", batch.ID).Error; err != nil {
		t.Fatalf("read current tool batch: %v", err)
	}
	if migratedBatch.Status != ToolBatchStatusOpen {
		t.Fatalf("credential-backed batch status=%q, want %q", migratedBatch.Status, ToolBatchStatusOpen)
	}
}

func TestFencedClientExecutionLedgersRejectNonceReuse(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:fenced-client-execution-ledgers?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&ReceiptRecoveryCredential{}, &ClientCapabilityCommand{}); err != nil {
		t.Fatalf("migrate fenced execution ledgers: %v", err)
	}

	now := time.Date(2026, 8, 22, 14, 0, 0, 0, time.UTC)
	recovery := ReceiptRecoveryCredential{
		ID:                      "credential-1",
		ActorID:                 "actor-1",
		DeviceID:                "device-1",
		DeviceSigningKeyID:      "signing-key-1",
		RequestID:               "request-1",
		ToolCallID:              "call-1",
		ExecutionClaimID:        "claim-1",
		CapabilityLeaseRevision: 1,
		FencingToken:            1,
		PayloadHash:             "payload-hash-1",
		ReplayPolicy:            ClientExecutionReplayPolicyNoReplayAfterPrepared,
		ExecutionDeadline:       now.Add(time.Minute),
		ReconciliationDeadline:  now.Add(10 * time.Minute),
		ScopeHash:               "scope-hash-1",
		NonceHash:               "nonce-hash-1",
		IssuedAt:                now,
		ExpiresAt:               now.Add(10 * time.Minute),
	}
	if err := db.Create(&recovery).Error; err != nil {
		t.Fatalf("create recovery credential: %v", err)
	}
	conflictingRecovery := recovery
	conflictingRecovery.ID = "credential-2"
	conflictingRecovery.RequestID = "request-2"
	conflictingRecovery.ToolCallID = "call-2"
	if err := db.Create(&conflictingRecovery).Error; err == nil {
		t.Fatal("recovery nonce reuse succeeded")
	}

	command := ClientCapabilityCommand{
		ActorID:            "actor-1",
		DeviceID:           "device-1",
		DeviceSigningKeyID: "signing-key-1",
		NonceHash:          "command-nonce-hash",
		CommandID:          "command-1",
		CommandDomain:      1,
		BodyHash:           "body-hash-1",
		IssuedAt:           now,
		CommittedAt:        now,
		ExpiresAt:          now.Add(time.Minute),
	}
	if err := db.Create(&command).Error; err != nil {
		t.Fatalf("create capability command: %v", err)
	}
	conflictingCommand := command
	conflictingCommand.CommandID = "command-2"
	conflictingCommand.BodyHash = "body-hash-2"
	if err := db.Create(&conflictingCommand).Error; err == nil {
		t.Fatal("capability command nonce reuse succeeded")
	}
}

func TestMigrateTurnEvidenceBackfillsActorAndAssistantLineage(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:turn-evidence-migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(
		&Conversation{},
		&AgentTurn{},
		&AgentMessage{},
		&UserFeedback{},
	); err != nil {
		t.Fatalf("migrate evidence models: %v", err)
	}
	now := time.Date(2026, 8, 23, 0, 0, 0, 0, time.UTC)
	if err := db.Create(&Conversation{
		ID:        "conversation-1",
		AgentID:   "agent-1",
		ActorPTID: "actor-1",
		Title:     "Migration",
		Status:    "active",
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&AgentTurn{
		ID:             "turn-1",
		ConversationID: "conversation-1",
		AgentID:        "agent-1",
		Status:         "completed",
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}
	if err := db.Create(&AgentMessage{
		ID:             "assistant-1",
		ConversationID: "conversation-1",
		TurnID:         stringPointer("turn-1"),
		Role:           "assistant",
		Status:         "completed",
		Seq:            1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed assistant message: %v", err)
	}
	if err := db.Create(&UserFeedback{
		ID:             "feedback-1",
		AgentID:        "agent-1",
		TurnID:         "turn-1",
		ConversationID: "conversation-1",
		Signal:         "positive",
		CreatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed feedback: %v", err)
	}
	if err := db.Model(&UserFeedback{}).
		Where("id = ?", "feedback-1").
		UpdateColumn("source", "").Error; err != nil {
		t.Fatalf("downgrade feedback to legacy source: %v", err)
	}

	if err := MigrateTurnEvidence(db); err != nil {
		t.Fatalf("migrate turn evidence: %v", err)
	}
	var feedback UserFeedback
	if err := db.First(&feedback, "id = ?", "feedback-1").Error; err != nil {
		t.Fatalf("load migrated feedback: %v", err)
	}
	if feedback.Ptid != "actor-1" ||
		feedback.AssistantMessageID != "assistant-1" ||
		feedback.Rating != 1 ||
		feedback.Source != "legacy_growth" ||
		feedback.IdempotencyKey != "feedback-1" {
		t.Fatalf("unexpected migrated feedback: %+v", feedback)
	}
}

func timePointer(value time.Time) *time.Time {
	return &value
}

func stringPointer(value string) *string {
	return &value
}
