package tests

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestConversationPersistence_SQLite(t *testing.T) {
	dbPath := filepath.Join(os.TempDir(), fmt.Sprintf("peers-agent-test-%d.db", time.Now().UnixNano()))
	defer os.Remove(dbPath)
	defer os.Remove(dbPath + "-wal")
	defer os.Remove(dbPath + "-shm")

	dsn := fmt.Sprintf("file:%s?_fk=1&_journal_mode=WAL", dbPath)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}

	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatalf("AutoMigrate failed: %v", err)
	}
	t.Log("AutoMigrate succeeded for all agent models")

	conv := &persistence.Conversation{
		ID:         "conv-test-1",
		AgentID:    "test-agent",
		UserID:     "1001",
		Title:      "Test Conversation",
		Status:     "active",
		ProviderID: "test-provider",
	}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("Create conversation failed: %v", err)
	}
	t.Logf("Created conversation: id=%s", conv.ID)

	var got persistence.Conversation
	if err := db.Where("id = ?", "conv-test-1").First(&got).Error; err != nil {
		t.Fatalf("Get conversation failed: %v", err)
	}
	if got.Title != "Test Conversation" {
		t.Fatalf("got title=%q, want %q", got.Title, "Test Conversation")
	}
	if got.CreatedAt.IsZero() {
		t.Fatal("CreatedAt should be auto-set by autoCreateTime")
	}
	t.Log("Conversation CRUD verified (autoCreateTime working)")

	content1 := "TEST_OK"
	userMsg := &persistence.AgentMessage{
		ID:             "msg-user-1",
		ConversationID: "conv-test-1",
		Role:           "user",
		Content:        &content1,
		Seq:            1,
	}
	if err := db.Create(userMsg).Error; err != nil {
		t.Fatalf("Create user message failed: %v", err)
	}
	content2 := "Hello! How can I help?"
	modelName := "test-model"
	asstMsg := &persistence.AgentMessage{
		ID:             "msg-asst-1",
		ConversationID: "conv-test-1",
		Role:           "assistant",
		Content:        &content2,
		ModelName:      &modelName,
		Seq:            2,
	}
	if err := db.Create(asstMsg).Error; err != nil {
		t.Fatalf("Create assistant message failed: %v", err)
	}
	t.Log("Messages created")

	var msgs []persistence.AgentMessage
	if err := db.Where("conversation_id = ?", "conv-test-1").Order("seq ASC").Find(&msgs).Error; err != nil {
		t.Fatalf("List messages failed: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("got %d messages, want 2", len(msgs))
	}
	if *msgs[0].Content != "TEST_OK" {
		t.Fatalf("first message=%q, want TEST_OK", *msgs[0].Content)
	}
	if msgs[0].CreatedAt.IsZero() {
		t.Fatal("message CreatedAt should be auto-set")
	}
	t.Logf("Message persistence verified: %d messages, autoCreateTime working", len(msgs))

	evt := &persistence.TurnEvent{
		ID:             "tevt-1",
		ConversationID: "conv-test-1",
		TurnID:         "turn-1",
		EventSeq:       1,
		EventType:      "message_delta",
		Payload:        `{"text":"Hello"}`,
	}
	if err := db.Create(evt).Error; err != nil {
		t.Fatalf("Create turn event failed: %v", err)
	}
	if evt.CreatedAt.IsZero() {
		t.Fatal("event CreatedAt should be auto-set")
	}
	t.Log("Turn event created with autoCreateTime")

	var evts []persistence.TurnEvent
	if err := db.Where("conversation_id = ?", "conv-test-1").Order("event_seq ASC").Find(&evts).Error; err != nil {
		t.Fatalf("List events failed: %v", err)
	}
	if len(evts) != 1 {
		t.Fatalf("got %d events, want 1", len(evts))
	}
	if evts[0].EventType != "message_delta" {
		t.Fatalf("event type=%q", evts[0].EventType)
	}
	t.Log("Turn event persistence verified")

	time.Sleep(10 * time.Millisecond)
	if err := db.Model(&persistence.Conversation{}).Where("id = ?", "conv-test-1").
		Updates(map[string]interface{}{"status": "archived"}).Error; err != nil {
		t.Fatalf("Archive conversation failed: %v", err)
	}
	var archived persistence.Conversation
	db.Where("id = ?", "conv-test-1").First(&archived)
	if archived.Status != "archived" {
		t.Fatalf("status=%q, want archived", archived.Status)
	}
	if !archived.UpdatedAt.After(got.UpdatedAt) {
		t.Fatal("UpdatedAt should be auto-updated by autoUpdateTime")
	}
	t.Log("Archive conversation verified (autoUpdateTime working)")

	var convs []persistence.Conversation
	if err := db.Where("agent_id = ? AND status != ?", "test-agent", "deleted").Order("updated_at DESC").Find(&convs).Error; err != nil {
		t.Fatalf("List conversations failed: %v", err)
	}
	if len(convs) != 1 {
		t.Fatalf("got %d conversations, want 1", len(convs))
	}
	t.Log("List conversations verified")

	t.Log("ALL PERSISTENCE TESTS PASSED - SQLite compatibility confirmed")
}

func strPtr(s string) *string { return &s }
