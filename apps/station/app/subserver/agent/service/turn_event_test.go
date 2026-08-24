package service

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

func TestEmitTurnEventAppliesTurnContext(t *testing.T) {
	var captured TurnEvent
	config := &TurnConfig{
		AgentID:        "agent_1",
		ConversationID: "conv_1",
		EventSink: func(ctx context.Context, event TurnEvent) {
			captured = event
		},
	}

	var svc TurnService
	svc.emitTurnEvent(context.Background(), config, "turn_1", TurnEvent{
		Type:  "tool_call",
		Stage: "dispatch",
	})

	if captured.Type != "tool_call" {
		t.Fatalf("expected tool_call event, got %q", captured.Type)
	}
	if captured.TurnID != "turn_1" {
		t.Fatalf("expected turn id to be applied, got %q", captured.TurnID)
	}
	if captured.AgentID != "agent_1" {
		t.Fatalf("expected agent id to be applied, got %q", captured.AgentID)
	}
	if captured.ConversationID != "conv_1" {
		t.Fatalf("expected conversation id to be applied, got %q", captured.ConversationID)
	}
}

func TestEmitTurnEventPersistsWithoutLiveSink(t *testing.T) {
	db := openConversationAuthorityDB(t, "turn_event_without_sink")
	now := time.Now()
	if err := db.Create(&persistence.Conversation{
		ID:        "conv_persisted",
		AgentID:   "agent_1",
		Ptid:      "actor_1",
		Title:     "Persisted events",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID:             "turn_persisted",
		ConversationID: "conv_persisted",
		AgentID:        "agent_1",
		Status:         string(domain.TurnStatusWaitingLocalTool),
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}

	svc := TurnService{convService: NewConversationService()}
	svc.emitTurnEvent(context.Background(), &TurnConfig{
		AgentID:        "agent_1",
		ConversationID: "conv_persisted",
	}, "turn_persisted", TurnEvent{
		Type:  "progress",
		Stage: "waiting_local_tool",
	})

	var event persistence.TurnEvent
	if err := db.First(&event, "turn_id = ?", "turn_persisted").Error; err != nil {
		t.Fatalf("load persisted turn event: %v", err)
	}
	if event.EventType != "progress" {
		t.Fatalf("expected progress event, got %q", event.EventType)
	}
}

func TestTurnServiceSaveTurnTraceUpsertsByTurn(t *testing.T) {
	db := openConversationAuthorityDB(t, "turn_trace_upsert")
	if err := db.AutoMigrate(&persistence.TurnTrace{}); err != nil {
		t.Fatalf("migrate turn trace: %v", err)
	}
	now := time.Now()
	if err := db.Create(&persistence.Conversation{
		ID:        "conv_trace",
		AgentID:   "agent_1",
		Ptid:      "actor_1",
		Title:     "Trace",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID:             "turn_trace",
		ConversationID: "conv_trace",
		AgentID:        "agent_1",
		Status:         string(domain.TurnStatusWaitingLocalTool),
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}

	svc := TurnService{}
	trace := &domain.TurnTrace{
		TraceID: "trace_1",
		TurnID:  "turn_trace",
		ProviderCalls: []domain.ProviderCallRecord{{
			Provider: "provider_1",
			Model:    "model_1",
		}},
	}
	if err := svc.saveTurnTrace(context.Background(), trace); err != nil {
		t.Fatalf("save paused trace: %v", err)
	}
	trace.ProviderCalls = append(trace.ProviderCalls, domain.ProviderCallRecord{
		Provider: "provider_1",
		Model:    "model_2",
	})
	if err := svc.saveTurnTrace(context.Background(), trace); err != nil {
		t.Fatalf("update resumed trace: %v", err)
	}

	var count int64
	if err := db.Model(&persistence.TurnTrace{}).Where("turn_id = ?", trace.TurnID).Count(&count).Error; err != nil {
		t.Fatalf("count turn traces: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected one trace row after resume, got %d", count)
	}
	loaded, err := svc.loadTurnTraceForResume(context.Background(), trace.TurnID)
	if err != nil {
		t.Fatalf("load resumed trace: %v", err)
	}
	if len(loaded.ProviderCalls) != 2 || loaded.ProviderCalls[1].Model != "model_2" {
		t.Fatalf("expected resumed trace update, got %+v", loaded.ProviderCalls)
	}
}

func TestToolDecisionTurnEventCarriesManualApprovalProjection(t *testing.T) {
	event := toolDecisionTurnEvent(ProposalDecision{
		ToolCallID:       "tool-call-1",
		ToolName:         "local_shell_safe",
		Arguments:        `{"command_ref":"command-1"}`,
		ApprovalID:       "approval-1",
		DecisionRevision: 0,
		Status:           persistence.ToolCallStatusWaitingApproval,
	}, 2)

	if event.Type != "tool_approval_required" ||
		event.ToolCallID != "tool-call-1" ||
		event.ToolName != "local_shell_safe" ||
		event.Arguments != `{"command_ref":"command-1"}` ||
		event.ApprovalID != "approval-1" ||
		event.DecisionRevision != 0 ||
		event.Iteration != 2 {
		t.Fatalf("unexpected approval projection: %+v", event)
	}
}

func TestCancelTurnCancelsRegisteredExecution(t *testing.T) {
	svc := TurnService{}
	ctx, release := svc.RegisterTurn(context.Background(), "turn_1")
	defer release()

	if !svc.cancelActiveTurn("turn_1") {
		t.Fatal("expected active turn cancellation to be accepted")
	}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("registered turn context was not cancelled")
	}
	if svc.cancelActiveTurn("missing") {
		t.Fatal("missing turn must not report cancellation success")
	}
}
