package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
)

func TestWallTimeDeadlineRetainsTypedBudgetExhaustion(t *testing.T) {
	ctx, cancel := withRuntimeBudgetDeadline(
		context.Background(),
		&model.RuntimeBudget{WallTimeMs: 25},
		time.Now().Add(-time.Second),
	)
	defer cancel()
	<-ctx.Done()

	err := executionContextError(ctx)
	var budgetErr *errcode.BizError
	if !errors.As(err, &budgetErr) ||
		budgetErr.Code != errcode.AgentToolBudgetExhausted ||
		budgetErr.Message != wallTimeExhaustedReason ||
		!budgetErr.Payload.GetTerminal() {
		t.Fatalf("wall-time deadline lost typed budget exhaustion: %#v", err)
	}
}

func TestProcessToolCallsRejectsTotalBudgetBeforeDispatch(t *testing.T) {
	assertToolBatchRejectedBeforeDispatch(
		t,
		&model.RuntimeBudget{
			MaxToolCalls:          1,
			MaxIdenticalToolCalls: 3,
		},
		[]ProviderToolCall{
			{ID: "provider-call-1", Name: "skills_list", Arguments: `{"page":1}`},
			{ID: "provider-call-2", Name: "skills_list", Arguments: `{"page":2}`},
		},
		maxToolCallsExhaustedReason,
	)
}

func TestProcessToolCallsRejectsIdenticalBudgetBeforeDispatch(t *testing.T) {
	assertToolBatchRejectedBeforeDispatch(
		t,
		&model.RuntimeBudget{
			MaxToolCalls:          10,
			MaxIdenticalToolCalls: 1,
		},
		[]ProviderToolCall{
			{ID: "provider-call-1", Name: "skills_list", Arguments: `{}`},
			{ID: "provider-call-2", Name: "skills_list", Arguments: `{}`},
		},
		maxIdenticalToolCallsExhaustedReason,
	)
}

func TestToolLoopBudgetStopsProviderContinuationAtBound(t *testing.T) {
	state := &toolLoopBudgetState{
		total: 1,
		identical: map[string]uint32{
			toolCallBudgetKey("skills_list", hashBytes([]byte(`{}`))): 1,
		},
	}
	budget := &model.RuntimeBudget{
		MaxToolCalls:          1,
		MaxIdenticalToolCalls: 3,
	}
	providerCalls := 0

	if err := state.exhaustionBeforeContinuation(budget); err == nil {
		providerCalls++
	}

	if providerCalls != 0 {
		t.Fatalf("provider continuation executed %d times beyond the total tool-call bound", providerCalls)
	}
}

func TestToolLoopBudgetStopsProviderContinuationAtIdenticalBound(t *testing.T) {
	state := &toolLoopBudgetState{
		total: 1,
		identical: map[string]uint32{
			toolCallBudgetKey("skills_list", hashBytes([]byte(`{}`))): 1,
		},
	}
	budget := &model.RuntimeBudget{
		MaxToolCalls:          10,
		MaxIdenticalToolCalls: 1,
	}
	providerCalls := 0

	if err := state.exhaustionBeforeContinuation(budget); err == nil {
		providerCalls++
	}

	if providerCalls != 0 {
		t.Fatalf("provider continuation executed %d times beyond the identical-call bound", providerCalls)
	}
}

func TestEffectiveRuntimeBudgetPinsLowerRequestedToolLimits(t *testing.T) {
	effective, err := effectiveRuntimeBudget(
		&model.RuntimeBudget{
			MaxToolCalls:          100,
			MaxIdenticalToolCalls: 3,
		},
		[]byte(`{"max_tool_calls":2,"max_identical_tool_calls":1}`),
	)
	if err != nil {
		t.Fatalf("resolve effective runtime budget: %v", err)
	}
	if effective.GetMaxToolCalls() != 2 || effective.GetMaxIdenticalToolCalls() != 1 {
		t.Fatalf("effective tool limits = %d/%d, want 2/1",
			effective.GetMaxToolCalls(),
			effective.GetMaxIdenticalToolCalls(),
		)
	}
}

func TestEffectiveRuntimeBudgetPreservesPolicyWithoutRequest(t *testing.T) {
	policy := &model.RuntimeBudget{
		MaxAttempts:           3,
		MaxAgentSteps:         50,
		MaxToolCalls:          100,
		MaxIdenticalToolCalls: 3,
		MaxAttachmentBytes:    4096,
	}
	effective, err := effectiveRuntimeBudget(policy, nil)
	if err != nil {
		t.Fatalf("resolve effective runtime budget: %v", err)
	}
	if !proto.Equal(effective, policy) {
		t.Fatalf("effective budget = %+v, want policy %+v", effective, policy)
	}
	if effective == policy {
		t.Fatal("effective budget must not alias mutable policy state")
	}
}

func TestEffectiveRuntimeBudgetNeverRaisesPolicyLimits(t *testing.T) {
	effective, err := effectiveRuntimeBudget(
		&model.RuntimeBudget{
			MaxToolCalls:          4,
			MaxIdenticalToolCalls: 2,
			MaxOutputTokens:       1024,
		},
		[]byte(`{"maxToolCalls":40,"maxIdenticalToolCalls":20,"maxOutputTokens":"512"}`),
	)
	if err != nil {
		t.Fatalf("resolve effective runtime budget: %v", err)
	}
	if effective.GetMaxToolCalls() != 4 ||
		effective.GetMaxIdenticalToolCalls() != 2 ||
		effective.GetMaxOutputTokens() != 512 {
		t.Fatalf("effective budget raised policy limits: %+v", effective)
	}
}

func TestQueuedTurnConfigCarriesRequestedBudget(t *testing.T) {
	config, err := (&TurnService{}).queuedTurnConfig(
		"actor-1",
		&model.ExecuteTurnRequest{
			ConversationId: "conversation-1",
			AgentId:        "agent-1",
			RequestedBudget: &model.RuntimeBudget{
				MaxToolCalls:          2,
				MaxIdenticalToolCalls: 1,
			},
		},
		"turn-1",
	)
	if err != nil {
		t.Fatalf("map queued turn config: %v", err)
	}
	effective, err := effectiveRuntimeBudget(defaultRuntimeBudget(128000), config.RequestedBudgetJSON)
	if err != nil {
		t.Fatalf("resolve queued runtime budget: %v", err)
	}
	if effective.GetMaxToolCalls() != 2 || effective.GetMaxIdenticalToolCalls() != 1 {
		t.Fatalf("queued runtime budget was not preserved: %+v", effective)
	}
}

func TestLoadPinnedRuntimeBudgetReturnsExactPersistedBudget(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "runtime_budget_readback")
	seedRuntimeAuthorityRows(t, db, "turn-budget", "attempt-budget")
	want := &model.RuntimeBudget{
		MaxAttempts:           1,
		MaxAgentSteps:         2,
		MaxToolCalls:          3,
		MaxIdenticalToolCalls: 1,
		MaxAttachmentBytes:    2048,
	}
	encoded, err := persistence.MarshalRuntimeSnapshot(&model.RuntimeSnapshot{Budget: want})
	if err != nil {
		t.Fatalf("encode runtime snapshot: %v", err)
	}
	if err := db.Model(&persistence.TurnAttempt{}).
		Where("id = ?", "attempt-budget").
		Update("runtime_snapshot", encoded).Error; err != nil {
		t.Fatalf("persist runtime snapshot: %v", err)
	}

	got, err := (&TurnService{}).loadPinnedRuntimeBudget(
		context.Background(),
		db,
		"attempt-budget",
	)
	if err != nil {
		t.Fatalf("load pinned runtime budget: %v", err)
	}
	if !proto.Equal(got, want) {
		t.Fatalf("pinned runtime budget = %+v, want %+v", got, want)
	}
}

func TestPersistedBudgetReadersRejectMissingSnapshotBudget(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "runtime_budget_missing")
	seedRuntimeAuthorityRows(t, db, "turn-budget", "attempt-budget")

	for name, load := range map[string]func() error{
		"continuation": func() error {
			_, err := (&TurnService{}).loadPinnedRuntimeBudget(
				context.Background(),
				db,
				"attempt-budget",
			)
			return err
		},
		"diagnostics": func() error {
			_, err := loadDiagnosticToolCallLimit(
				context.Background(),
				db,
				"turn-budget",
			)
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			err := load()
			var bizErr *errcode.BizError
			if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentInvalidSourceState {
				t.Fatalf("missing persisted budget error = %T %v", err, err)
			}
		})
	}
}

func assertToolBatchRejectedBeforeDispatch(
	t *testing.T,
	budget *model.RuntimeBudget,
	providerCalls []ProviderToolCall,
	wantReason string,
) {
	t.Helper()
	fixture := newToolDispatchFixture(t)
	service := &TurnService{toolDispatch: fixture.service}
	config := &TurnConfig{
		TurnID:        "turn-budget",
		AttemptID:     "attempt-budget",
		RuntimeBudget: budget,
	}
	response := ""

	iterations, paused, err := service.processToolCalls(
		context.Background(),
		config,
		config.TurnID,
		nil,
		"",
		nil,
		&response,
		providerCalls,
		0,
	)
	if err == nil {
		t.Fatal("expected runtime budget exhaustion")
	}
	var budgetErr *errcode.BizError
	if !errors.As(err, &budgetErr) ||
		budgetErr.Code != errcode.AgentToolBudgetExhausted ||
		budgetErr.Message != wantReason ||
		!budgetErr.Payload.GetTerminal() {
		t.Fatalf("unexpected budget exhaustion: %#v", err)
	}
	if iterations != 0 || paused {
		t.Fatalf("rejected batch changed loop state: iterations=%d paused=%v", iterations, paused)
	}

	for name, record := range map[string]interface{}{
		"tool call":         &persistence.ToolCall{},
		"tool batch":        &persistence.ToolBatch{},
		"assistant message": &persistence.AgentMessage{},
	} {
		var count int64
		if err := fixture.db.Model(record).Count(&count).Error; err != nil {
			t.Fatalf("count %s records: %v", name, err)
		}
		if count != 0 {
			t.Fatalf("%s rows beyond runtime bound = %d, want 0", name, count)
		}
	}
}
