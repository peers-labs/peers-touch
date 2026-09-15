package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

func TestDelegatedTurnConfigInheritsActorDepthAndPinnedBudget(t *testing.T) {
	parentBudget := &model.RuntimeBudget{
		MaxAttempts:           2,
		MaxAgentSteps:         4,
		MaxToolCalls:          6,
		MaxIdenticalToolCalls: 1,
		MaxDelegationDepth:    2,
		WallTimeMs:            5000,
		MaxInputTokens:        1024,
		MaxOutputTokens:       256,
		MaxAttachmentBytes:    4096,
	}
	parent := &TurnConfig{
		ActorID:           "ptid:person:owner",
		AgentID:           "agent-1",
		ConversationID:    "conversation-1",
		Provider:          "provider-1",
		Model:             "model-1",
		ThinkingMode:      domain.ThinkingModeDisabled,
		RuntimeBudget:     parentBudget,
		Depth:             1,
		ContextWindowSize: 128000,
	}
	task := &domain.DelegationTask{TaskID: "child-1", Depth: 2}

	child, err := delegatedTurnConfig(
		parent,
		task,
		[]string{"tool-a"},
		"conversation-child-1",
	)
	if err != nil {
		t.Fatalf("derive delegated turn config: %v", err)
	}
	if child.ActorID != parent.ActorID ||
		child.Provider != parent.Provider ||
		child.Model != parent.Model ||
		child.Depth != task.Depth ||
		len(child.RestrictedTools) != 1 ||
		child.RestrictedTools[0] != "tool-a" {
		t.Fatalf("delegated turn lost parent authority: %+v", child)
	}
	inherited, err := effectiveRuntimeBudget(
		defaultRuntimeBudget(int32(parent.ContextWindowSize)),
		child.RequestedBudgetJSON,
	)
	if err != nil {
		t.Fatalf("decode delegated runtime budget: %v", err)
	}
	if !proto.Equal(inherited, parentBudget) {
		t.Fatalf("delegated budget = %+v, want %+v", inherited, parentBudget)
	}
	child.AvailableTools[0] = "mutated"
	if parent.AvailableTools != nil {
		t.Fatal("delegated toolset mutated parent config")
	}
}

func TestDelegatedToolRestrictionRejectsUnlistedProviderTool(t *testing.T) {
	filtered := restrictAuthorizedToolNames(
		[]string{"tool-a", "tool-b"},
		[]string{"tool-a"},
	)
	if len(filtered) != 1 || filtered[0] != "tool-a" {
		t.Fatalf("delegated tool restriction = %v, want [tool-a]", filtered)
	}
	config := &TurnConfig{
		AvailableTools:  []string{"tool-a"},
		RestrictedTools: []string{"tool-a"},
	}
	err := (&TurnService{}).validateProviderToolCallsBeforePersistence(
		config,
		[]toolCallEntry{{ToolName: "tool-b"}},
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentInvalidSourceState {
		t.Fatalf("unexpected delegated tool rejection: %#v", err)
	}
}

func TestProcessToolCallsRejectsUnknownToolBeforePersistence(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	registry := NewToolRegistryService(nil, nil)
	expectedVersion, ok := registry.ManifestVersion("skills_list")
	if !ok || expectedVersion == "" {
		t.Fatal("skills_list manifest version is unavailable")
	}
	service := &TurnService{
		toolDispatch: fixture.service,
		toolRegistry: registry,
	}
	config := &TurnConfig{
		TurnID:        "turn-unknown-tool",
		AttemptID:     "attempt-unknown-tool",
		RuntimeBudget: defaultRuntimeBudget(128000),
		RuntimeCapabilities: &model.RuntimeCapabilitySnapshot{
			Agentic: &model.RuntimeAgenticCapabilities{NativeTools: true},
		},
		AuthorizedCapabilities: &AuthorizedCapabilitySet{},
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
		[]ProviderToolCall{{
			ID:        "provider-call-1",
			Name:      "skills_list",
			Arguments: `{}`,
		}},
		0,
	)
	var toolErr *errcode.BizError
	if !errors.As(err, &toolErr) ||
		toolErr.Code != errcode.AgentToolUnknown ||
		toolErr.Payload.GetErrorType() != string(errcode.AgentToolUnknown) ||
		toolErr.Payload.GetLocaleKey() != errcode.AgentToolUnknownLocaleKey ||
		toolErr.Payload.GetRetryable() ||
		!toolErr.Payload.GetTerminal() ||
		len(toolErr.Payload.GetDetails()) != 2 ||
		toolErr.Payload.GetDetails()["tool_id"] != "skills_list" ||
		toolErr.Payload.GetDetails()["tool_version"] != expectedVersion {
		t.Fatalf("unexpected unknown Tool rejection: %#v", err)
	}
	if iterations != 0 || paused {
		t.Fatalf(
			"unknown Tool changed loop state: iterations=%d paused=%v",
			iterations,
			paused,
		)
	}
	for name, record := range map[string]interface{}{
		"assistant message": &persistence.AgentMessage{},
		"turn event":        &persistence.TurnEvent{},
		"tool call":         &persistence.ToolCall{},
		"tool batch":        &persistence.ToolBatch{},
	} {
		var count int64
		if err := fixture.db.Model(record).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows: %v", name, err)
		}
		if count != 0 {
			t.Fatalf("unknown Tool rejection persisted %d %s rows", count, name)
		}
	}
}

func TestProcessToolCallsMapsDisabledAdvertisedToolToUnknownBeforePersistence(t *testing.T) {
	fixture, service, config, providerToolCall := setupProviderToolAuthorityFixture(
		t,
		"disabled-advertised-tool",
	)
	authorized, ok := config.AuthorizedCapabilities.Tool(providerToolCall.Name)
	if !ok {
		t.Fatal("advertised Tool authority is unavailable")
	}
	if err := fixture.db.Model(&persistence.AgentCapabilityBinding{}).
		Where("binding_id = ?", authorized.Binding.GetBindingId()).
		Updates(map[string]interface{}{
			"enabled":  false,
			"revision": authorized.Binding.GetRevision() + 1,
		}).Error; err != nil {
		t.Fatalf("disable advertised Tool binding: %v", err)
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
		[]ProviderToolCall{providerToolCall},
		0,
	)
	var toolErr *errcode.BizError
	if !errors.As(err, &toolErr) ||
		toolErr.Code != errcode.AgentToolUnknown ||
		toolErr.Payload.GetErrorType() != string(errcode.AgentToolUnknown) ||
		toolErr.Payload.GetLocaleKey() != errcode.AgentToolUnknownLocaleKey ||
		toolErr.Payload.GetRetryable() ||
		!toolErr.Payload.GetTerminal() ||
		len(toolErr.Payload.GetDetails()) != 2 ||
		toolErr.Payload.GetDetails()["tool_id"] != providerToolCall.Name ||
		toolErr.Payload.GetDetails()["tool_version"] !=
			authorized.Manifest.GetVersion() {
		t.Fatalf("disabled advertised Tool rejection = %#v", err)
	}
	if iterations != 0 || paused {
		t.Fatalf(
			"disabled advertised Tool changed loop state: iterations=%d paused=%v",
			iterations,
			paused,
		)
	}
	assertNoProviderToolPersistence(t, fixture.db)
}

func TestProcessToolCallsRejectsEnabledBindingRevisionDriftAsInvalidSourceState(
	t *testing.T,
) {
	fixture, service, config, providerToolCall := setupProviderToolAuthorityFixture(
		t,
		"enabled-binding-revision-drift",
	)
	authorized, ok := config.AuthorizedCapabilities.Tool(providerToolCall.Name)
	if !ok {
		t.Fatal("advertised Tool authority is unavailable")
	}
	if err := fixture.db.Model(&persistence.AgentCapabilityBinding{}).
		Where("binding_id = ?", authorized.Binding.GetBindingId()).
		Update("revision", authorized.Binding.GetRevision()+1).Error; err != nil {
		t.Fatalf("advance advertised Tool binding revision: %v", err)
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
		[]ProviderToolCall{providerToolCall},
		0,
	)
	var stateErr *errcode.BizError
	if !errors.As(err, &stateErr) ||
		stateErr.Code != errcode.AgentInvalidSourceState {
		t.Fatalf("enabled binding revision drift error = %#v", err)
	}
	if iterations != 0 || paused {
		t.Fatalf(
			"binding revision drift changed loop state: iterations=%d paused=%v",
			iterations,
			paused,
		)
	}
	assertNoProviderToolPersistence(t, fixture.db)
}

func setupProviderToolAuthorityFixture(
	t *testing.T,
	suffix string,
) (toolDispatchFixture, *TurnService, *TurnConfig, ProviderToolCall) {
	t.Helper()
	fixture := newToolDispatchFixture(t)
	proposal := fixture.authorizedProposalForOwner(
		t,
		suffix,
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		true,
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION,
	)
	fixture.seedTurnAuthority(t, proposal)
	if err := fixture.db.Model(&persistence.TurnAttempt{}).
		Where("id = ?", proposal.AttemptID).
		Update("readiness_snapshot_id", proposal.ReadinessSnapshotID).Error; err != nil {
		t.Fatalf("bind readiness snapshot to turn attempt: %v", err)
	}
	config := &TurnConfig{
		AgentID:                   proposal.AgentID,
		ActorID:                   proposal.ActorID,
		ConversationID:            proposal.ConversationID,
		TurnID:                    proposal.TurnID,
		AttemptID:                 proposal.AttemptID,
		ClientCapabilitySessionID: proposal.ClientCapabilitySessionID,
		RuntimeBudget:             defaultRuntimeBudget(128000),
		RuntimeCapabilities: &model.RuntimeCapabilitySnapshot{
			Agentic: &model.RuntimeAgenticCapabilities{NativeTools: true},
		},
	}
	authorized, err := LoadAuthorizedCapabilitySet(
		context.Background(),
		fixture.db,
		config,
	)
	if err != nil {
		t.Fatalf("load advertised Tool authority: %v", err)
	}
	config.AuthorizedCapabilities = authorized
	return fixture, &TurnService{
			toolDispatch: fixture.service,
		}, config, ProviderToolCall{
			ID:        "provider-call-" + suffix,
			Name:      proposal.Calls[0].ToolName,
			Arguments: `{}`,
		}
}

func assertNoProviderToolPersistence(t *testing.T, db *gorm.DB) {
	t.Helper()
	for name, record := range map[string]interface{}{
		"assistant message": &persistence.AgentMessage{},
		"turn event":        &persistence.TurnEvent{},
		"tool call":         &persistence.ToolCall{},
		"tool batch":        &persistence.ToolBatch{},
	} {
		var count int64
		if err := db.Model(record).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows: %v", name, err)
		}
		if count != 0 {
			t.Fatalf("provider Tool rejection persisted %d %s rows", count, name)
		}
	}
}

func TestStationDelegationBudgetRejectsBeforeChildExecution(t *testing.T) {
	config := &TurnConfig{
		RuntimeBudget: &model.RuntimeBudget{MaxDelegationDepth: 1},
		Depth:         1,
	}
	err := validateStationToolBudgetBeforeExecution(
		config,
		toolCallEntry{ToolName: "delegate_task"},
	)
	var budgetErr *errcode.BizError
	if !errors.As(err, &budgetErr) ||
		budgetErr.Code != errcode.AgentToolBudgetExhausted ||
		budgetErr.Message != maxDelegationDepthExhaustedReason {
		t.Fatalf("unexpected delegation budget rejection: %#v", err)
	}
}

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

func TestResumeReadyToolContinuationDoesNotResetMaxAttempts(t *testing.T) {
	db := openConversationAuthorityDB(t, "continuation_provider_attempt_budget")
	now := time.Now().UTC()
	if err := db.Create(&persistence.Conversation{
		ID:        "conversation-attempt-budget",
		AgentID:   "agent-1",
		ActorPTID: "ptid:person:owner",
		Title:     "Attempt budget",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID:                   "turn-attempt-budget",
		ConversationID:       "conversation-attempt-budget",
		AgentID:              "agent-1",
		ProviderAttemptCount: 1,
		Status:               "waiting_local_tool",
		StartedAt:            now,
	}).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}
	service := &TurnService{}
	config := &TurnConfig{
		TurnID:        "turn-attempt-budget",
		RuntimeBudget: &model.RuntimeBudget{MaxAttempts: 1},
	}

	err := service.reserveProviderAttempt(context.Background(), config)
	var budgetErr *errcode.BizError
	if !errors.As(err, &budgetErr) ||
		budgetErr.Code != errcode.AgentToolBudgetExhausted ||
		budgetErr.Message != maxAttemptsExhaustedReason {
		t.Fatalf("continuation reset provider-attempt budget: %T %v", err, err)
	}
	var turn persistence.AgentTurn
	if err := db.First(&turn, "id = ?", config.TurnID).Error; err != nil {
		t.Fatalf("load turn: %v", err)
	}
	if turn.ProviderAttemptCount != 1 {
		t.Fatalf("provider attempt count = %d, want 1", turn.ProviderAttemptCount)
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

func TestProcessToolCallsRejectsAgentStepBudgetBeforeDispatch(t *testing.T) {
	assertToolBatchRejectedBeforeDispatchAtIteration(
		t,
		&model.RuntimeBudget{
			MaxAgentSteps:         1,
			MaxToolCalls:          10,
			MaxIdenticalToolCalls: 3,
		},
		[]ProviderToolCall{{
			ID:        "provider-call-2",
			Name:      "skills_list",
			Arguments: `{}`,
		}},
		1,
		maxAgentStepsExhaustedReason,
	)
}

func TestProcessToolCallsRejectsProviderToolsWithoutNativeToolsBeforePersistence(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	service := &TurnService{toolDispatch: fixture.service}
	config := &TurnConfig{
		TurnID:        "turn-native-tools-disabled",
		AttemptID:     "attempt-native-tools-disabled",
		RuntimeBudget: defaultRuntimeBudget(128000),
		RuntimeCapabilities: &model.RuntimeCapabilitySnapshot{
			Agentic: &model.RuntimeAgenticCapabilities{NativeTools: false},
		},
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
		[]ProviderToolCall{{
			ID:        "provider-call-1",
			Name:      "skills_list",
			Arguments: `{}`,
		}},
		0,
	)
	if err == nil {
		t.Fatal("expected native Tool capability rejection")
	}
	if iterations != 0 || paused {
		t.Fatalf("rejected ToolCall changed loop state: iterations=%d paused=%v", iterations, paused)
	}
	for name, record := range map[string]interface{}{
		"assistant message": &persistence.AgentMessage{},
		"turn event":        &persistence.TurnEvent{},
		"tool call":         &persistence.ToolCall{},
		"tool batch":        &persistence.ToolBatch{},
	} {
		var count int64
		if err := fixture.db.Model(record).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows: %v", name, err)
		}
		if count != 0 {
			t.Fatalf("native Tool rejection persisted %d %s rows", count, name)
		}
	}
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

func TestInputBudgetPreflightReturnsContextOverflow(t *testing.T) {
	err := validateInputBudgetBeforePersistence(
		NewCompressionService(),
		&model.RuntimeBudget{MaxInputTokens: 1},
		"oversized",
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentContextOverflow ||
		bizErr.Payload == nil ||
		bizErr.Payload.GetErrorType() != string(errcode.AgentContextOverflow) ||
		bizErr.Payload.GetLocaleKey() != errcode.AgentContextOverflowLocaleKey ||
		bizErr.Payload.GetRetryable() ||
		!bizErr.Payload.GetTerminal() ||
		len(bizErr.Payload.GetDetails()) != 2 ||
		bizErr.Payload.GetDetails()["limit_tokens"] != "1" ||
		bizErr.Payload.GetDetails()["actual_tokens"] != "12" {
		t.Fatalf("input budget preflight error = %T %+v", err, bizErr)
	}
}

func TestAdmittedInputBudgetRetainsToolBudgetSemantics(t *testing.T) {
	err := validateAdmittedInputBudget(
		NewCompressionService(),
		&model.RuntimeBudget{MaxInputTokens: 1},
		"oversized",
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentToolBudgetExhausted ||
		bizErr.Message != maxInputTokensExhaustedReason ||
		bizErr.Payload == nil ||
		bizErr.Payload.GetErrorType() != string(errcode.AgentToolBudgetExhausted) ||
		bizErr.Payload.GetLocaleKey() != errcode.AgentToolBudgetExhaustedLocaleKey ||
		bizErr.Payload.GetRetryable() ||
		!bizErr.Payload.GetTerminal() ||
		len(bizErr.Payload.GetDetails()) != 3 ||
		bizErr.Payload.GetDetails()["reason"] != maxInputTokensExhaustedReason ||
		bizErr.Payload.GetDetails()["limit"] != "1" ||
		bizErr.Payload.GetDetails()["consumed"] != "12" {
		t.Fatalf("admitted input budget error = %T %+v", err, bizErr)
	}
}

func TestEffectiveRuntimeBudgetRejectsExplicitZeroLimits(t *testing.T) {
	for _, requested := range []string{
		`{"maxAttempts":0}`,
		`{"max_agent_steps":0}`,
		`{"maxToolCalls":0}`,
		`{"maxIdenticalToolCalls":0}`,
		`{"maxDelegationDepth":0}`,
		`{"wallTimeMs":"0"}`,
		`{"maxInputTokens":"0"}`,
		`{"maxOutputTokens":"0"}`,
		`{"maxAttachmentBytes":"0"}`,
		`{"maxCost":0}`,
		`{"maxCost":-1}`,
	} {
		t.Run(requested, func(t *testing.T) {
			_, err := effectiveRuntimeBudget(
				defaultRuntimeBudget(128000),
				[]byte(requested),
			)
			var bizErr *errcode.BizError
			if !errors.As(err, &bizErr) ||
				bizErr.Code != errcode.AgentInvalidRequest {
				t.Fatalf("explicit non-positive budget %s error = %T %v", requested, err, err)
			}
		})
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
	assertToolBatchRejectedBeforeDispatchAtIteration(
		t,
		budget,
		providerCalls,
		0,
		wantReason,
	)
}

func assertToolBatchRejectedBeforeDispatchAtIteration(
	t *testing.T,
	budget *model.RuntimeBudget,
	providerCalls []ProviderToolCall,
	startingIterations int,
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
		startingIterations,
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
	if iterations != startingIterations || paused {
		t.Fatalf(
			"rejected batch changed loop state: iterations=%d want=%d paused=%v",
			iterations,
			startingIterations,
			paused,
		)
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
