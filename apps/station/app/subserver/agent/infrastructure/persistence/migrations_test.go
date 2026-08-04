package persistence

import (
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

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
