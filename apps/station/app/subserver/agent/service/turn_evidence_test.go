package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/gorm"
)

func TestTurnAttemptSchemaStoresUsage(t *testing.T) {
	db := openConversationAuthorityDB(t, "turn_attempt_usage")
	if err := db.AutoMigrate(&persistence.TurnAttempt{}); err != nil {
		t.Fatalf("migrate turn attempt: %v", err)
	}

	if !db.Migrator().HasColumn(&persistence.TurnAttempt{}, "UsageJSON") {
		t.Fatal("turn attempt must persist exact-attempt usage")
	}
}

func TestRedactArgumentsSanitizesDiagnosticPayload(t *testing.T) {
	redacted := redactArguments(`{
		"authorization":"Bearer raw-token",
		"nested":{"access_token":"nested-token"},
		"workspace_path":"/Users/alice/private/repository",
		"safe":"visible"
	}`)

	for _, forbidden := range []string{
		"raw-token",
		"nested-token",
		"/Users/alice/private/repository",
	} {
		if strings.Contains(redacted, forbidden) {
			t.Fatalf("redacted payload leaked %q: %s", forbidden, redacted)
		}
	}
	if !strings.Contains(redacted, `"safe":"visible"`) {
		t.Fatalf("redacted payload removed safe data: %s", redacted)
	}
}

func TestTurnServicePersistAttemptUsage(t *testing.T) {
	db := openTurnEvidenceDB(t, "persist_attempt_usage")
	now := time.Now().UTC()
	seedTurnEvidence(t, db, now)
	if err := db.Create(&persistence.ToolCall{
		ID:               "tool-row-1",
		ActorID:          "actor-1",
		TurnID:           "turn-1",
		AttemptID:        "attempt-1",
		ToolBatchID:      "batch-1",
		ToolName:         "local_file_read",
		ToolCallID:       "tool-call-1",
		ExecutionOwner:   persistence.ToolOwnerClientCapability,
		BoundedArguments: []byte(`{}`),
		ResourceRefs:     []byte{},
		Status:           persistence.ToolCallStatusSucceeded,
		CreatedAt:        now,
		UpdatedAt:        now,
	}).Error; err != nil {
		t.Fatalf("seed tool call: %v", err)
	}

	trace := &domain.TurnTrace{
		TurnID: "turn-1",
		ProviderCalls: []domain.ProviderCallRecord{{
			Provider:     "ark",
			Model:        "seed",
			InputTokens:  12,
			OutputTokens: 8,
			Latency:      25 * time.Millisecond,
		}},
	}
	if err := (&TurnService{}).persistAttemptUsage(
		context.Background(),
		"turn-1",
		"attempt-1",
		trace,
	); err != nil {
		t.Fatalf("persist attempt usage: %v", err)
	}

	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", "attempt-1").Error; err != nil {
		t.Fatalf("load attempt: %v", err)
	}
	var usage domain.TurnUsage
	if err := json.Unmarshal(attempt.UsageJSON, &usage); err != nil {
		t.Fatalf("decode usage: %v", err)
	}
	if usage.TurnID != "turn-1" ||
		usage.AttemptID != "attempt-1" ||
		usage.InputTokens != 12 ||
		usage.OutputTokens != 8 ||
		usage.ProviderCallCount != 1 ||
		usage.ToolCallCount != 1 ||
		len(usage.ToolCallIDs) != 1 ||
		usage.ToolCallIDs[0] != "tool-call-1" {
		t.Fatalf("unexpected usage: %+v", usage)
	}
}

func TestGrowthMetricsServiceRecordFeedback(t *testing.T) {
	db := openTurnEvidenceDB(t, "record_feedback")
	now := time.Now().UTC()
	seedTurnEvidence(t, db, now)
	service := NewGrowthMetricsService()
	input := TurnFeedbackInput{
		AgentID:            "agent-1",
		TurnID:             "turn-1",
		ConversationID:     "conversation-1",
		AssistantMessageID: "assistant-1",
		Signal:             "negative",
		Source:             "message_action",
		Rating:             -1,
		Categories:         []string{"incorrect"},
		IdempotencyKey:     "feedback-command-1",
	}

	record, replayed, err := service.RecordFeedback(context.Background(), "actor-1", input)
	if err != nil {
		t.Fatalf("record feedback: %v", err)
	}
	if replayed || record.ID == "" || record.ID == input.TurnID {
		t.Fatalf("expected durable feedback identity, got record=%+v replayed=%v", record, replayed)
	}

	replayedRecord, replayed, err := service.RecordFeedback(context.Background(), "actor-1", input)
	if err != nil {
		t.Fatalf("replay feedback: %v", err)
	}
	if !replayed || replayedRecord.ID != record.ID {
		t.Fatalf("expected idempotent replay, got record=%+v replayed=%v", replayedRecord, replayed)
	}
	conflicting := input
	conflicting.Signal = "positive"
	conflicting.Rating = 1
	if _, _, err := service.RecordFeedback(context.Background(), "actor-1", conflicting); err == nil {
		t.Fatal("conflicting feedback idempotency replay must fail")
	}

	ownerRecords, err := service.ListTurnFeedback(context.Background(), "actor-1", "turn-1")
	if err != nil {
		t.Fatalf("list owner feedback: %v", err)
	}
	if len(ownerRecords) != 1 || ownerRecords[0].AssistantMessageID != "assistant-1" {
		t.Fatalf("unexpected owner feedback: %+v", ownerRecords)
	}
	otherRecords, err := service.ListTurnFeedback(context.Background(), "actor-2", "turn-1")
	if err != nil {
		t.Fatalf("list other actor feedback: %v", err)
	}
	if len(otherRecords) != 0 {
		t.Fatalf("cross-actor feedback leaked: %+v", otherRecords)
	}
}

func TestTurnServiceExportTurnDiagnostics(t *testing.T) {
	db := openTurnEvidenceDB(t, "export_turn_diagnostics")
	now := time.Now().UTC()
	seedTurnEvidence(t, db, now)
	if err := db.Model(&persistence.AgentTurn{}).
		Where("id = ?", "turn-1").
		Updates(map[string]interface{}{
			"status":          string(domain.TurnStatusFailed),
			"terminal_reason": `Bearer raw-token /Users/alice/private/repository alice@example.com`,
			"ended_at":        now.Add(time.Second),
		}).Error; err != nil {
		t.Fatalf("update terminal turn: %v", err)
	}
	segments, err := json.Marshal([]ContextSegment{{
		SourceRefs:      []string{"/Users/alice/private/source.txt"},
		Content:         "must-not-export",
		ContentHash:     "content-hash",
		EstimatedTokens: 7,
	}})
	if err != nil {
		t.Fatalf("encode context segments: %v", err)
	}
	usage, err := json.Marshal(domain.TurnUsage{
		TurnID:       "turn-1",
		AttemptID:    "attempt-1",
		InputTokens:  10,
		OutputTokens: 5,
		ProviderID:   "ark",
		ModelID:      "seed",
	})
	if err != nil {
		t.Fatalf("encode usage: %v", err)
	}
	runtimeSnapshot := newDirectRuntimeSnapshot(
		runtimeAuthorityAdmission("ark", "seed", 27),
		"11",
	)
	encodedRuntimeSnapshot, err := persistence.MarshalRuntimeSnapshot(runtimeSnapshot)
	if err != nil {
		t.Fatalf("encode runtime snapshot: %v", err)
	}
	if err := db.Model(&persistence.TurnAttempt{}).
		Where("id = ?", "attempt-1").
		Updates(map[string]interface{}{
			"context_ledger":        string(segments),
			"runtime_snapshot":      encodedRuntimeSnapshot,
			"readiness_snapshot_id": "readiness-1",
			"usage_json":            usage,
			"ended_at":              now.Add(time.Second),
		}).Error; err != nil {
		t.Fatalf("update attempt evidence: %v", err)
	}
	trace := &domain.TurnTrace{
		TraceID: "trace-1",
		TurnID:  "turn-1",
		ProviderCalls: []domain.ProviderCallRecord{{
			Provider:     "ark",
			Model:        "seed",
			CredentialID: "credential-secret",
		}},
		ToolCalls: []domain.ToolCallRecord{{
			ToolName:  "local_file_read",
			Arguments: `{"path":"/Users/alice/private/source.txt","token":"raw-token"}`,
			Result:    `{"email":"alice@example.com","safe":"visible"}`,
		}},
	}
	if err := (&TurnService{}).saveTurnTrace(context.Background(), trace); err != nil {
		t.Fatalf("save trace: %v", err)
	}

	replay, err := (&TurnService{}).ExportTurnDiagnostics(context.Background(), "actor-1", "turn-1")
	if err != nil {
		t.Fatalf("export diagnostics: %v", err)
	}
	encoded, err := json.Marshal(replay)
	if err != nil {
		t.Fatalf("encode replay: %v", err)
	}
	text := string(encoded)
	for _, forbidden := range []string{
		"raw-token",
		"credential-secret",
		"/Users/alice/private",
		"alice@example.com",
		"must-not-export",
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("diagnostic replay leaked %q: %s", forbidden, text)
		}
	}
	if len(replay.Attempts) != 1 ||
		replay.Attempts[0].GetUsage().GetInputTokens() != 10 ||
		replay.Attempts[0].GetRuntimeSnapshot().GetProviderId() != "ark" ||
		replay.Attempts[0].GetRuntimeSnapshot().GetModelId() != "seed" ||
		len(replay.ContextLedgers) != 1 ||
		replay.ContextLedgers[0].GetSegments()[0].GetContentHash() != "content-hash" ||
		len(replay.Messages) != 2 ||
		replay.Messages[0].GetContentHash() == "" {
		t.Fatalf("diagnostic replay lost exact-turn evidence: %+v", replay)
	}
	if _, err := (&TurnService{}).ExportTurnDiagnostics(context.Background(), "actor-2", "turn-1"); err == nil {
		t.Fatal("cross-actor diagnostic export must fail")
	}
}

func TestTurnServiceTraceReadbackIsActorScoped(t *testing.T) {
	db := openTurnEvidenceDB(t, "trace_actor_scope")
	now := time.Now().UTC()
	seedTurnEvidence(t, db, now)
	if err := (&TurnService{}).saveTurnTrace(context.Background(), &domain.TurnTrace{
		TraceID: "trace-1",
		TurnID:  "turn-1",
	}); err != nil {
		t.Fatalf("save trace: %v", err)
	}

	service := &TurnService{}
	ownerEntries, total, err := service.ListTurnTraces(context.Background(), domain.TurnTraceListOptions{
		Ptid:    "actor-1",
		AgentID: "agent-1",
	})
	if err != nil {
		t.Fatalf("list owner traces: %v", err)
	}
	if total != 1 || len(ownerEntries) != 1 {
		t.Fatalf("expected one owner trace, got total=%d entries=%d", total, len(ownerEntries))
	}
	otherEntries, total, err := service.ListTurnTraces(context.Background(), domain.TurnTraceListOptions{
		Ptid:    "actor-2",
		AgentID: "agent-1",
	})
	if err != nil {
		t.Fatalf("list other actor traces: %v", err)
	}
	if total != 0 || len(otherEntries) != 0 {
		t.Fatalf("cross-actor trace list leaked: total=%d entries=%d", total, len(otherEntries))
	}
	if _, err := service.GetTurnTrace(context.Background(), "actor-1", "trace-1", ""); err != nil {
		t.Fatalf("get owner trace: %v", err)
	}
	if _, err := service.GetTurnTrace(context.Background(), "actor-2", "trace-1", ""); err == nil {
		t.Fatal("cross-actor trace get must fail")
	}
}

func openTurnEvidenceDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db := openConversationAuthorityDB(t, name)
	if err := db.AutoMigrate(
		&persistence.TurnAttempt{},
		&persistence.ToolCall{},
		&persistence.TurnTrace{},
		&persistence.UserFeedback{},
		&persistence.GrowthEvent{},
	); err != nil {
		t.Fatalf("migrate turn evidence database: %v", err)
	}
	return db
}

func seedTurnEvidence(t *testing.T, db *gorm.DB, now time.Time) {
	t.Helper()
	if err := db.Create(&persistence.Conversation{
		ID:        "conversation-1",
		AgentID:   "agent-1",
		Ptid:      "actor-1",
		Title:     "Evidence",
		Status:    "active",
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID:             "turn-1",
		ConversationID: "conversation-1",
		AgentID:        "agent-1",
		Status:         string(domain.TurnStatusRunning),
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID:           "attempt-1",
		TurnID:       "turn-1",
		AttemptIndex: 1,
		Status:       string(domain.TurnStatusRunning),
		StartedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed attempt: %v", err)
	}
	for _, message := range []persistence.AgentMessage{
		{
			ID:             "user-1",
			ConversationID: "conversation-1",
			TurnID:         stringPointer("turn-1"),
			Role:           string(domain.MessageRoleUser),
			Status:         "completed",
			Content:        stringPointer("private user content"),
			Seq:            1,
			CreatedAt:      now,
			UpdatedAt:      now,
		},
		{
			ID:             "assistant-1",
			ConversationID: "conversation-1",
			TurnID:         stringPointer("turn-1"),
			Role:           string(domain.MessageRoleAssistant),
			Status:         "completed",
			Content:        stringPointer("private assistant content"),
			Seq:            2,
			CreatedAt:      now,
			UpdatedAt:      now,
		},
	} {
		if err := db.Create(&message).Error; err != nil {
			t.Fatalf("seed message %s: %v", message.ID, err)
		}
	}
}

func stringPointer(value string) *string {
	return &value
}
