package persistence

import (
	"fmt"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

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
		ID  string
		Seq int64
	}
	if err := db.Table("agent_messages").Select("id, seq").Order("id").Scan(&rows).Error; err != nil {
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
	if !db.Migrator().HasIndex(&AgentMessage{}, "idx_agent_messages_conv_seq") {
		t.Fatal("conversation sequence index was not created")
	}
}
