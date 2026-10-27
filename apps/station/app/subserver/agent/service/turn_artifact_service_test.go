package service

import (
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestPersistTurnArtifactsFromAppliedWriteReceipt(t *testing.T) {
	db := openConversationAuthorityDB(t, "turn_artifact_receipt")
	if err := db.AutoMigrate(&persistence.ToolBatch{}, &persistence.TurnArtifact{}); err != nil {
		t.Fatalf("migrate turn artifact models: %v", err)
	}
	now := time.Now().UTC()
	batch := &persistence.ToolBatch{
		ID:             "batch-artifact",
		ActorID:        "ptid:person:artifact",
		TurnID:         "turn-artifact",
		AttemptID:      "attempt-artifact",
		ConversationID: "conversation-artifact",
		AgentID:        "agent-artifact",
		Provider:       "provider",
		Model:          "model",
		Status:         persistence.ToolBatchStatusOpen,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := db.Create(batch).Error; err != nil {
		t.Fatalf("seed tool batch: %v", err)
	}
	call := &persistence.ToolCall{
		ActorID:        batch.ActorID,
		TurnID:         batch.TurnID,
		ToolBatchID:    batch.ID,
		ToolCallID:     "tool-artifact",
		ToolName:       "local_file_write",
		TargetDeviceID: "device-artifact",
	}
	receipt := &model.ClientCapabilityReceipt{
		Artifacts: []*model.TurnArtifact{{
			ArtifactId: "artifact-1",
			TurnId:     call.TurnID,
			ToolCallId: call.ToolCallID,
			Kind:       model.TurnArtifactKind_TURN_ARTIFACT_KIND_FILE,
			Name:       "report.md",
			Size:       42,
			Sha256:     strings.Repeat("a", 64),
			Locator: &model.TurnArtifactLocator{
				ClientLocalRef: "artifact-local-1",
				ClientDeviceId: call.TargetDeviceID,
			},
			CreatedAt: timestamppb.New(now),
		}},
	}

	if err := persistTurnArtifactsTx(db, call, receipt, now); err != nil {
		t.Fatalf("persist turn artifact: %v", err)
	}
	var row persistence.TurnArtifact
	if err := db.First(&row, "id = ?", "artifact-1").Error; err != nil {
		t.Fatalf("load turn artifact: %v", err)
	}
	if row.ActorPTID != batch.ActorID ||
		row.ConversationID != batch.ConversationID ||
		row.ClientLocalRef != "artifact-local-1" ||
		row.StationObjectRef != "" {
		t.Fatalf("unexpected persisted artifact: %+v", row)
	}
}

func TestPersistTurnArtifactsRejectsNonWriteReceipts(t *testing.T) {
	db := openConversationAuthorityDB(t, "turn_artifact_non_write")
	call := &persistence.ToolCall{ToolName: "local_file_read"}
	receipt := &model.ClientCapabilityReceipt{Artifacts: []*model.TurnArtifact{{ArtifactId: "artifact-1"}}}
	if err := persistTurnArtifactsTx(db, call, receipt, time.Now().UTC()); err == nil {
		t.Fatal("non-write receipt must not persist artifacts")
	}
}
