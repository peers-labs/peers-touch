package conversation_test

import (
	"testing"

	agentpersistence "github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	conversationpersistence "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAgentAndCanonicalConversationIndexesCanCoexistInSQLite(
	t *testing.T,
) {
	db, err := gorm.Open(
		sqlite.Open("file::memory:?cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open SQLite: %v", err)
	}
	if err := db.AutoMigrate(&agentpersistence.Conversation{}); err != nil {
		t.Fatalf("migrate Agent Conversation: %v", err)
	}
	if err := db.AutoMigrate(
		&conversationpersistence.ConversationModel{},
	); err != nil {
		t.Fatalf("migrate canonical Conversation: %v", err)
	}
	if !db.Migrator().HasIndex(
		&agentpersistence.Conversation{},
		"idx_agent_conversations_status",
	) {
		t.Fatal("Agent Conversation status index is not namespaced")
	}
	if !db.Migrator().HasIndex(
		&conversationpersistence.ConversationModel{},
		"idx_conversations_status",
	) {
		t.Fatal("canonical Conversation status index is missing")
	}
}
