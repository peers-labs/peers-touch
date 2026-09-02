package persistence

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRuntimeAuthorityPersistenceColumnsAndProtoRoundTrip(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:runtime-authority-persistence?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&Conversation{}, &TurnAttempt{}); err != nil {
		t.Fatalf("migrate runtime authority columns: %v", err)
	}
	if !db.Migrator().HasColumn(&Conversation{}, "RuntimeBinding") {
		t.Fatal("conversation runtime binding column is missing")
	}
	if !db.Migrator().HasColumn(&TurnAttempt{}, "RuntimeSnapshot") ||
		!db.Migrator().HasColumn(&TurnAttempt{}, "RuntimeSnapshotHash") {
		t.Fatal("turn attempt runtime snapshot columns are missing")
	}

	binding := &model.ConversationRuntimeBinding{
		RuntimeKind:            model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
		ProviderId:             "provider-1",
		ModelId:                "model-1",
		RuntimeProfileId:       "modern-chat-agent-v1",
		CapabilitySnapshotHash: "capability-hash",
		ConfigSnapshotHash:     "config-hash",
	}
	encodedBinding, err := MarshalConversationRuntimeBinding(binding)
	if err != nil {
		t.Fatalf("marshal binding: %v", err)
	}
	decodedBinding, err := UnmarshalConversationRuntimeBinding(encodedBinding)
	if err != nil {
		t.Fatalf("unmarshal binding: %v", err)
	}
	if !proto.Equal(binding, decodedBinding) {
		t.Fatalf("binding round trip changed value: got %+v want %+v", decodedBinding, binding)
	}

	snapshot := &model.RuntimeSnapshot{
		RuntimeKind:           model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
		ProviderId:            "provider-1",
		ModelId:               "model-1",
		RuntimeProfileId:      "modern-chat-agent-v1",
		ProviderConfigVersion: "7",
		AgentConfigVersion:    "11",
	}
	encodedSnapshot, err := MarshalRuntimeSnapshot(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	decodedSnapshot, err := UnmarshalRuntimeSnapshot(encodedSnapshot)
	if err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	if !proto.Equal(snapshot, decodedSnapshot) {
		t.Fatalf("snapshot round trip changed value: got %+v want %+v", decodedSnapshot, snapshot)
	}
}
