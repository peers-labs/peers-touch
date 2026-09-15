package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

func TestPersistRuntimeAuthorityStoresBindingAndAttemptSnapshot(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "runtime_authority_persist")
	seedRuntimeAuthorityRows(t, db, "turn-1", "attempt-1")

	admission := runtimeAuthorityAdmission("provider-1", "model-1", 1)
	config := runtimeAuthorityConfig("turn-1", "attempt-1")
	config.RuntimeBudget = &model.RuntimeBudget{
		MaxToolCalls:          2,
		MaxIdenticalToolCalls: 1,
	}
	readiness := runtimeAuthorityReadiness(config, admission)
	if err := (&TurnService{}).persistRuntimeAuthority(
		context.Background(),
		config,
		admission,
		readiness,
		11,
	); err != nil {
		t.Fatalf("persist runtime authority: %v", err)
	}

	var conversation persistence.Conversation
	if err := db.First(&conversation, "id = ?", config.ConversationID).Error; err != nil {
		t.Fatalf("load conversation: %v", err)
	}
	binding, err := persistence.UnmarshalConversationRuntimeBinding(conversation.RuntimeBinding)
	if err != nil {
		t.Fatalf("decode runtime binding: %v", err)
	}
	if binding.GetRuntimeKind() != model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL ||
		binding.GetProviderId() != admission.ProviderID ||
		binding.GetModelId() != admission.ModelID ||
		binding.GetRuntimeProfileId() != modernChatAgentProfileID ||
		binding.GetExternalSessionId() != "" ||
		binding.GetExternalSessionEpoch() != 0 ||
		binding.GetRuntimeHomeRef() != "" {
		t.Fatalf("unexpected direct-model binding: %+v", binding)
	}
	readback, err := NewConversationService().GetConversation(
		context.Background(),
		"ptid:person:owner",
		config.ConversationID,
	)
	if err != nil {
		t.Fatalf("read back conversation authority: %v", err)
	}
	if readback.RuntimeBinding.GetCapabilitySnapshotHash() != binding.GetCapabilitySnapshotHash() {
		t.Fatalf("domain readback lost runtime binding: %+v", readback.RuntimeBinding)
	}

	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", config.AttemptID).Error; err != nil {
		t.Fatalf("load attempt: %v", err)
	}
	snapshot, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
	if err != nil {
		t.Fatalf("decode attempt snapshot: %v", err)
	}
	if snapshot.GetProviderId() != admission.ProviderID ||
		snapshot.GetModelId() != admission.ModelID ||
		snapshot.GetThinkingMode() != string(domain.ThinkingModeDisabled) ||
		snapshot.GetProviderConfigVersion() != "7" ||
		snapshot.GetAgentConfigVersion() != "11" ||
		snapshot.GetExternalSessionId() != "" ||
		snapshot.GetExternalSessionEpoch() != 0 ||
		snapshot.GetBudget().GetMaxToolCalls() != 2 ||
		snapshot.GetBudget().GetMaxIdenticalToolCalls() != 1 ||
		attempt.ReadinessSnapshotID != readiness.GetSnapshotId() {
		t.Fatalf("unexpected attempt runtime snapshot: snapshot=%+v attempt=%+v", snapshot, attempt)
	}
	expectedHash, err := runtimeSnapshotHash(snapshot)
	if err != nil {
		t.Fatalf("hash persisted snapshot: %v", err)
	}
	if attempt.RuntimeSnapshotHash != expectedHash {
		t.Fatalf("runtime snapshot hash=%q, want %q", attempt.RuntimeSnapshotHash, expectedHash)
	}
}

func TestPersistRuntimeAuthorityRejectsIncompleteProvenance(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "runtime_authority_missing_provenance")
	seedRuntimeAuthorityRows(t, db, "turn-1", "attempt-1")
	admission := runtimeAuthorityAdmission("provider-1", "model-1", 1)
	admission.Capabilities.Provenance = nil
	config := runtimeAuthorityConfig("turn-1", "attempt-1")

	err := (&TurnService{}).persistRuntimeAuthority(
		context.Background(),
		config,
		admission,
		runtimeAuthorityReadiness(config, admission),
		11,
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentInvalidSourceState {
		t.Fatalf("expected invalid source state, got %T: %v", err, err)
	}
	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", config.AttemptID).Error; err != nil {
		t.Fatalf("load rejected attempt: %v", err)
	}
	if len(attempt.RuntimeSnapshot) != 0 || attempt.RuntimeSnapshotHash != "" {
		t.Fatal("invalid provenance persisted a runtime snapshot")
	}
}

func TestPersistRuntimeAuthorityRejectsFutureProvenance(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "runtime_authority_future_provenance")
	seedRuntimeAuthorityRows(t, db, "turn-1", "attempt-1")
	admission := runtimeAuthorityAdmission("provider-1", "model-1", 1)
	admission.Capabilities.Provenance.ObservedAt = timestamppb.New(
		time.Now().UTC().Add(time.Minute),
	)
	config := runtimeAuthorityConfig("turn-1", "attempt-1")

	err := (&TurnService{}).persistRuntimeAuthority(
		context.Background(),
		config,
		admission,
		runtimeAuthorityReadiness(config, admission),
		11,
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentInvalidSourceState {
		t.Fatalf("expected invalid source state, got %T: %v", err, err)
	}
}

func TestPersistRuntimeAuthorityRejectsAttemptSnapshotOverwrite(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "runtime_authority_attempt_immutable")
	seedRuntimeAuthorityRows(t, db, "turn-1", "attempt-1")
	service := &TurnService{}
	admission := runtimeAuthorityAdmission("provider-1", "model-1", 1)
	config := runtimeAuthorityConfig("turn-1", "attempt-1")
	config.RuntimeBudget = cloneRuntimeBudget(admission.Budget)
	readiness := runtimeAuthorityReadiness(config, admission)
	if err := service.persistRuntimeAuthority(
		context.Background(),
		config,
		admission,
		readiness,
		11,
	); err != nil {
		t.Fatalf("persist initial attempt authority: %v", err)
	}
	var initial persistence.TurnAttempt
	if err := db.First(&initial, "id = ?", config.AttemptID).Error; err != nil {
		t.Fatalf("load initial attempt authority: %v", err)
	}
	if err := service.persistRuntimeAuthority(
		context.Background(),
		config,
		admission,
		readiness,
		11,
	); err != nil {
		t.Fatalf("repeat identical attempt authority: %v", err)
	}

	config.RuntimeBudget.MaxToolCalls--
	err := service.persistRuntimeAuthority(
		context.Background(),
		config,
		admission,
		readiness,
		11,
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentVersionConflict {
		t.Fatalf("expected immutable attempt conflict, got %T: %v", err, err)
	}
	var after persistence.TurnAttempt
	if err := db.First(&after, "id = ?", config.AttemptID).Error; err != nil {
		t.Fatalf("load attempt after overwrite rejection: %v", err)
	}
	if string(after.RuntimeSnapshot) != string(initial.RuntimeSnapshot) ||
		after.RuntimeSnapshotHash != initial.RuntimeSnapshotHash ||
		after.ReadinessSnapshotID != initial.ReadinessSnapshotID {
		t.Fatal("immutable attempt authority changed after overwrite rejection")
	}
}

func TestProviderExecutionAcceptsFreshPinnedSourceOnce(t *testing.T) {
	service, config, _ := setupPinnedProviderExecution(t, "runtime_authority_fresh_provider_call")
	providerCalls := 0
	service.providerCall = func(
		ctx context.Context,
		request *ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		if request.ExpectedProviderConfigVersion == "" ||
			request.ExpectedCapabilitySourceVersion == "" ||
			request.UserID != config.ActorID {
			t.Fatalf("provider request lost pinned authority: %+v", request)
		}
		if err := request.BeforeDispatch(ctx); err != nil {
			return nil, err
		}
		providerCalls++
		return &ProviderCallResponse{Content: "ok"}, nil
	}

	response, err := service.callProviderWithRuntimeAuthority(
		context.Background(),
		config,
		&ProviderCallRequest{Model: config.Model},
	)
	if err != nil {
		t.Fatalf("execute provider with fresh authority: %v", err)
	}
	if providerCalls != 1 || response.Content != "ok" {
		t.Fatalf("fresh runtime provider calls=%d response=%+v", providerCalls, response)
	}
}

func TestProviderExecutionRejectsInputOverrunBeforeCall(t *testing.T) {
	service, config, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_input_overrun",
	)
	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", config.AttemptID).Error; err != nil {
		t.Fatalf("load pinned attempt: %v", err)
	}
	snapshot, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
	if err != nil {
		t.Fatalf("decode pinned runtime snapshot: %v", err)
	}
	snapshot.Budget.MaxInputTokens = 1
	encoded, err := persistence.MarshalRuntimeSnapshot(snapshot)
	if err != nil {
		t.Fatalf("encode bounded runtime snapshot: %v", err)
	}
	snapshotHash, err := runtimeSnapshotHash(snapshot)
	if err != nil {
		t.Fatalf("hash bounded runtime snapshot: %v", err)
	}
	if err := db.Model(&persistence.TurnAttempt{}).
		Where("id = ?", config.AttemptID).
		Updates(map[string]interface{}{
			"runtime_snapshot":      encoded,
			"runtime_snapshot_hash": snapshotHash,
		}).Error; err != nil {
		t.Fatalf("persist bounded runtime snapshot: %v", err)
	}
	config.RuntimeBudget = cloneRuntimeBudget(snapshot.GetBudget())

	providerCalls := 0
	service.providerCall = func(
		context.Context,
		*ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		providerCalls++
		return &ProviderCallResponse{Content: "unexpected"}, nil
	}
	_, err = service.callProviderWithRuntimeAuthority(
		context.Background(),
		config,
		&ProviderCallRequest{
			Model: config.Model,
			Messages: []domain.Message{{
				Role:    domain.MessageRoleUser,
				Content: "input exceeds one token",
			}},
		},
	)
	var budgetErr *errcode.BizError
	if !errors.As(err, &budgetErr) ||
		budgetErr.Code != errcode.AgentToolBudgetExhausted ||
		budgetErr.Message != maxInputTokensExhaustedReason {
		t.Fatalf("unexpected input budget rejection: %T %v", err, err)
	}
	if providerCalls != 0 {
		t.Fatalf("input overrun executed provider %d times", providerCalls)
	}
	assertNoPersistedRuntimeExecution(t, db, config.TurnID)
}

func TestProviderExecutionRejectsOutputOverrunBeforeToolExecution(t *testing.T) {
	service, config, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_output_overrun",
	)
	providerCalls := 0
	service.providerCall = func(
		ctx context.Context,
		request *ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		if err := request.BeforeDispatch(ctx); err != nil {
			return nil, err
		}
		providerCalls++
		return &ProviderCallResponse{
			Content:      "oversized",
			OutputTokens: int(config.RuntimeBudget.GetMaxOutputTokens()) + 1,
		}, nil
	}

	response, err := service.callProviderWithRuntimeAuthority(
		context.Background(),
		config,
		&ProviderCallRequest{Model: config.Model},
	)
	var budgetErr *errcode.BizError
	if !errors.As(err, &budgetErr) ||
		budgetErr.Code != errcode.AgentToolBudgetExhausted ||
		budgetErr.Message != maxOutputTokensExhaustedReason {
		t.Fatalf("unexpected output budget rejection: %T %v", err, err)
	}
	if providerCalls != 1 {
		t.Fatalf("output overrun provider calls = %d, want 1", providerCalls)
	}
	if response == nil ||
		response.OutputTokens != int(config.RuntimeBudget.GetMaxOutputTokens())+1 {
		t.Fatalf("output overrun discarded provider usage: %+v", response)
	}
	assertNoPersistedToolExecution(t, db)
}

func TestProviderOutputOverrunPersistsAttemptUsage(t *testing.T) {
	service, config, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_output_overrun_usage",
	)
	if err := db.AutoMigrate(&persistence.Credential{}); err != nil {
		t.Fatalf("migrate credential pool: %v", err)
	}
	now := time.Now().UTC()
	if err := db.Create(&persistence.Credential{
		ID:        "credential-output-overrun",
		ActorPTID: config.ActorID,
		Provider:  config.Provider,
		AuthType:  "api_key",
		Source:    "test",
		Status:    string(domain.CredentialStatusActive),
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed credential pool: %v", err)
	}
	service.credentialPool = NewCredentialPoolService()
	service.errorClassifier = NewErrorClassifierService()
	service.compression = NewCompressionService()
	service.providerCall = func(
		ctx context.Context,
		request *ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		if err := request.BeforeDispatch(ctx); err != nil {
			return nil, err
		}
		return &ProviderCallResponse{
			Model:        config.Model,
			InputTokens:  23,
			OutputTokens: int(config.RuntimeBudget.GetMaxOutputTokens()) + 7,
		}, nil
	}

	trace := &domain.TurnTrace{}
	_, _, providerCalls, _, err := service.providerCallWithRetry(
		context.Background(),
		config,
		config.TurnID,
		trace,
		"",
		nil,
	)
	var budgetErr *errcode.BizError
	if !errors.As(err, &budgetErr) ||
		budgetErr.Code != errcode.AgentToolBudgetExhausted ||
		budgetErr.Message != maxOutputTokensExhaustedReason {
		t.Fatalf("unexpected output budget rejection: %T %v", err, err)
	}
	if len(providerCalls) != 1 ||
		providerCalls[0].InputTokens != 23 ||
		providerCalls[0].OutputTokens != int(config.RuntimeBudget.GetMaxOutputTokens())+7 {
		t.Fatalf("provider usage was not preserved: %+v", providerCalls)
	}
	trace.ProviderCalls = append(trace.ProviderCalls, providerCalls...)
	if err := service.persistAttemptUsage(
		context.Background(),
		config.TurnID,
		config.AttemptID,
		trace,
	); err != nil {
		t.Fatalf("persist rejected provider usage: %v", err)
	}
	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", config.AttemptID).Error; err != nil {
		t.Fatalf("load attempt usage: %v", err)
	}
	var usage domain.TurnUsage
	if err := json.Unmarshal(attempt.UsageJSON, &usage); err != nil {
		t.Fatalf("decode attempt usage: %v", err)
	}
	if usage.ProviderCallCount != 1 ||
		usage.InputTokens != 23 ||
		usage.OutputTokens != uint64(config.RuntimeBudget.GetMaxOutputTokens())+7 {
		t.Fatalf("persisted output-overrun usage = %+v", usage)
	}
}

func TestProviderRateLimitTerminatesWithoutHiddenRetry(t *testing.T) {
	service, config, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_provider_rate_limit",
	)
	if err := db.AutoMigrate(&persistence.Credential{}); err != nil {
		t.Fatalf("migrate credential: %v", err)
	}
	now := time.Now().UTC()
	if err := db.Create(&persistence.Credential{
		ID:        "credential-rate-limit",
		ActorPTID: config.ActorID,
		Provider:  config.Provider,
		AuthType:  "api_key",
		Source:    "test",
		Status:    string(domain.CredentialStatusActive),
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed credential pool: %v", err)
	}
	service.credentialPool = NewCredentialPoolService()
	service.errorClassifier = NewErrorClassifierService()
	service.compression = NewCompressionService()
	config.MaxRetries = 3
	providerCalls := 0
	service.providerCall = func(
		ctx context.Context,
		request *ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		if err := request.BeforeDispatch(ctx); err != nil {
			return nil, err
		}
		providerCalls++
		return nil, &ProviderHTTPError{
			StatusCode: http.StatusTooManyRequests,
			Body:       "rate limit",
			Provider:   config.Provider,
			RetryAfter: "2",
		}
	}

	trace := &domain.TurnTrace{}
	_, _, recordedCalls, _, err := service.providerCallWithRetry(
		context.Background(),
		config,
		config.TurnID,
		trace,
		"",
		nil,
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentProviderRateLimit ||
		bizErr.Payload.GetErrorType() != string(errcode.AgentProviderRateLimit) ||
		bizErr.Payload.GetLocaleKey() != errcode.AgentProviderRateLimitLocaleKey ||
		!bizErr.Payload.GetRetryable() ||
		!bizErr.Payload.GetTerminal() ||
		bizErr.Payload.GetDetails()["provider_id"] != config.Provider ||
		bizErr.Payload.GetDetails()["retry_after_ms"] != "2000" {
		t.Fatalf("unexpected rate-limit payload: %T %+v", err, bizErr)
	}
	if providerCalls != 1 || len(recordedCalls) != 1 {
		t.Fatalf(
			"rate limit retried provider call: calls=%d records=%d",
			providerCalls,
			len(recordedCalls),
		)
	}
	if len(trace.ErrorClassified) != 1 ||
		trace.ErrorClassified[0].Reason != domain.FailoverReasonRateLimit {
		t.Fatalf("classified errors = %+v", trace.ErrorClassified)
	}
}

func TestProviderModelUnavailableTerminatesWithoutHiddenFallback(t *testing.T) {
	service, config, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_provider_model_unavailable",
	)
	if err := db.AutoMigrate(&persistence.Credential{}); err != nil {
		t.Fatalf("migrate credential: %v", err)
	}
	now := time.Now().UTC()
	if err := db.Create(&persistence.Credential{
		ID:        "credential-model-unavailable",
		ActorPTID: config.ActorID,
		Provider:  config.Provider,
		AuthType:  "api_key",
		Source:    "test",
		Status:    string(domain.CredentialStatusActive),
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed credential pool: %v", err)
	}
	service.credentialPool = NewCredentialPoolService()
	service.errorClassifier = NewErrorClassifierService()
	service.compression = NewCompressionService()
	config.MaxRetries = 3
	config.FallbackModel = "fallback-model"
	providerCalls := 0
	service.providerCall = func(
		ctx context.Context,
		request *ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		if err := request.BeforeDispatch(ctx); err != nil {
			return nil, err
		}
		providerCalls++
		return nil, &ProviderHTTPError{
			StatusCode: http.StatusNotFound,
			Body:       "model_not_found",
			Provider:   config.Provider,
		}
	}

	trace := &domain.TurnTrace{}
	_, _, recordedCalls, _, err := service.providerCallWithRetry(
		context.Background(),
		config,
		config.TurnID,
		trace,
		"",
		nil,
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentProviderModelUnavailable ||
		bizErr.Payload.GetErrorType() != string(errcode.AgentProviderModelUnavailable) ||
		bizErr.Payload.GetLocaleKey() != errcode.AgentProviderModelUnavailableLocaleKey ||
		!bizErr.Payload.GetRetryable() ||
		!bizErr.Payload.GetTerminal() ||
		bizErr.Payload.GetDetails()["provider_id"] != config.Provider ||
		bizErr.Payload.GetDetails()["model_id"] != config.Model {
		t.Fatalf("unexpected model-unavailable payload: %T %+v", err, bizErr)
	}
	if providerCalls != 1 || len(recordedCalls) != 1 {
		t.Fatalf(
			"model unavailable retried or fell back: calls=%d records=%d",
			providerCalls,
			len(recordedCalls),
		)
	}
}

func TestProviderContextOverflowUsesGovernedCompressionAndReplacesLedger(t *testing.T) {
	service, config, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_context_overflow_compression",
	)
	if err := db.AutoMigrate(
		&persistence.Credential{},
		&persistence.TurnEvent{},
		&persistence.TurnTrace{},
	); err != nil {
		t.Fatalf("migrate compression evidence: %v", err)
	}
	now := time.Now().UTC()
	if err := db.Create(&persistence.Credential{
		ID:        "credential-context-overflow",
		ActorPTID: config.ActorID,
		Provider:  config.Provider,
		AuthType:  "api_key",
		Source:    "test",
		Status:    string(domain.CredentialStatusActive),
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed credential pool: %v", err)
	}
	service.credentialPool = NewCredentialPoolService()
	service.errorClassifier = NewErrorClassifierService()
	service.compression = NewCompressionService()
	service.memoryService = NewMemoryService(nil)
	service.promptAssembly = NewPromptAssemblyService(service.memoryService, nil)
	service.convService = &ConversationService{}
	config.ContextWindowSize = 128000
	config.MemoryDisabled = true
	config.AuthorizedCapabilities = &AuthorizedCapabilitySet{}
	config.currentInput = "current input"
	messages := []domain.Message{
		{MessageID: "message-1", Role: domain.MessageRoleUser, Content: "first"},
		{MessageID: "message-2", Role: domain.MessageRoleAssistant, Content: "second"},
		{MessageID: "message-3", Role: domain.MessageRoleUser, Content: "third"},
		{MessageID: "message-4", TurnID: config.TurnID, Role: domain.MessageRoleUser, Content: config.currentInput},
	}
	assembly, err := service.promptAssembly.AssembleTurnContext(
		context.Background(),
		config.AgentID,
		"identity",
		"policy",
		nil,
		config.currentInput,
		db,
		config.AuthorizedCapabilities,
		true,
		PromptAssemblyContext{
			TurnID:         config.TurnID,
			ConversationID: config.ConversationID,
			Messages:       messages,
		},
	)
	if err != nil {
		t.Fatalf("assemble initial context: %v", err)
	}
	toolSegment := ContextSegment{
		Type:            model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_TOOL_SCHEMA,
		SourceRefs:      []string{"tool:skills_list:version=1"},
		ContentHash:     sha256Hex("skills_list"),
		EstimatedTokens: 3,
		Decision:        model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
	}
	assembly.Segments = append(assembly.Segments, toolSegment)
	config.promptAssembly = assembly
	initialLedger, err := buildContextLedger(config, config.TurnID, assembly, 99)
	if err != nil {
		t.Fatalf("build initial ContextLedger: %v", err)
	}
	if err := service.persistContextLedger(context.Background(), initialLedger); err != nil {
		t.Fatalf("persist initial ContextLedger: %v", err)
	}

	providerCalls := 0
	service.providerCall = func(
		ctx context.Context,
		request *ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		if err := request.BeforeDispatch(ctx); err != nil {
			return nil, err
		}
		providerCalls++
		switch providerCalls {
		case 1:
			return nil, &ProviderHTTPError{
				StatusCode: http.StatusBadRequest,
				Body:       "maximum context length exceeded",
				Provider:   config.Provider,
			}
		case 2:
			return &ProviderCallResponse{
				Content:      "compressed summary",
				Model:        "summary-model",
				InputTokens:  17,
				OutputTokens: 5,
				CacheHit:     true,
			}, nil
		default:
			return &ProviderCallResponse{
				Content:      "recovered",
				Model:        config.Model,
				InputTokens:  11,
				OutputTokens: 4,
			}, nil
		}
	}

	trace := &domain.TurnTrace{}
	response, _, recordedCalls, _, err := service.providerCallWithRetry(
		context.Background(),
		config,
		config.TurnID,
		trace,
		assembly.SystemPrompt,
		messages,
	)
	if err != nil {
		t.Fatalf("recover provider context overflow: %v", err)
	}
	if response != "recovered" || providerCalls != 3 || len(recordedCalls) != 3 {
		t.Fatalf(
			"governed compression call sequence response=%q provider=%d recorded=%d",
			response,
			providerCalls,
			len(recordedCalls),
		)
	}
	if !trace.CompressionTriggered {
		t.Fatal("context overflow did not enter governed compression")
	}
	if recordedCalls[1].Provider != config.Provider ||
		recordedCalls[1].Model != "summary-model" ||
		recordedCalls[1].InputTokens != 17 ||
		recordedCalls[1].OutputTokens != 5 ||
		!recordedCalls[1].CacheHit ||
		recordedCalls[1].Latency <= 0 ||
		recordedCalls[1].CredentialID != "credential-context-overflow" {
		t.Fatalf("compression summary usage was not recorded: %+v", recordedCalls[1])
	}
	trace.TraceID = "trace-context-overflow"
	trace.TurnID = config.TurnID
	trace.ProviderCalls = append(trace.ProviderCalls, recordedCalls...)
	if err := service.persistAttemptUsage(
		context.Background(),
		config.TurnID,
		config.AttemptID,
		trace,
	); err != nil {
		t.Fatalf("persist compression usage: %v", err)
	}
	if err := service.saveTurnTrace(context.Background(), trace); err != nil {
		t.Fatalf("persist compression trace: %v", err)
	}
	if err := service.emitTurnEvent(
		context.Background(),
		config,
		config.TurnID,
		TurnEvent{Type: "progress", Stage: "compression_complete"},
	); err != nil {
		t.Fatalf("persist post-compression event: %v", err)
	}
	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", config.AttemptID).Error; err != nil {
		t.Fatalf("load compressed ContextLedger: %v", err)
	}
	var ledger model.ContextLedger
	if err := protojson.Unmarshal([]byte(attempt.ContextLedger), &ledger); err != nil {
		t.Fatalf("decode compressed ContextLedger: %v", err)
	}
	var hasSummary, hasToolSchema bool
	for _, segment := range ledger.GetSegments() {
		hasSummary = hasSummary ||
			segment.GetType() == model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_SUMMARY
		hasToolSchema = hasToolSchema ||
			segment.GetType() == model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_TOOL_SCHEMA
	}
	if !hasSummary || !hasToolSchema || ledger.GetPromptHash() == initialLedger.GetPromptHash() {
		t.Fatalf("compressed ContextLedger lost governed context: %+v", &ledger)
	}
	var usage domain.TurnUsage
	if err := json.Unmarshal(attempt.UsageJSON, &usage); err != nil {
		t.Fatalf("decode compressed attempt usage: %v", err)
	}
	if usage.ProviderCallCount != 3 ||
		usage.InputTokens != 28 ||
		usage.OutputTokens != 9 ||
		usage.ProviderLatency <= 0 {
		t.Fatalf("compressed attempt usage omitted summary call: %+v", usage)
	}
	var persistedTrace persistence.TurnTrace
	if err := db.First(&persistedTrace, "turn_id = ?", config.TurnID).Error; err != nil {
		t.Fatalf("load compressed turn trace: %v", err)
	}
	var persistedCalls []domain.ProviderCallRecord
	if err := json.Unmarshal(persistedTrace.ProviderCalls, &persistedCalls); err != nil {
		t.Fatalf("decode compressed provider trace: %v", err)
	}
	if len(persistedCalls) != 3 ||
		persistedCalls[1].CredentialID != "credential-context-overflow" ||
		!persistedCalls[1].CacheHit {
		t.Fatalf("persisted compression trace omitted summary call: %+v", persistedCalls)
	}
	if config.ConversationID != "conversation-1" {
		t.Fatalf("compression changed turn conversation authority: %q", config.ConversationID)
	}
	var conversationCount int64
	if err := db.Model(&persistence.Conversation{}).Count(&conversationCount).Error; err != nil {
		t.Fatalf("count compression conversations: %v", err)
	}
	if conversationCount != 1 {
		t.Fatalf("compression created %d conversation authorities, want 1", conversationCount)
	}
	var conversation persistence.Conversation
	if err := db.First(&conversation, "id = ?", config.ConversationID).Error; err != nil {
		t.Fatalf("load compression conversation: %v", err)
	}
	if conversation.Status != "active" {
		t.Fatalf("compression changed conversation status to %q", conversation.Status)
	}
	var turn persistence.AgentTurn
	if err := db.First(&turn, "id = ?", config.TurnID).Error; err != nil {
		t.Fatalf("load compression turn: %v", err)
	}
	if turn.ConversationID != config.ConversationID {
		t.Fatalf(
			"compression split turn authority: turn=%q config=%q",
			turn.ConversationID,
			config.ConversationID,
		)
	}
	var event persistence.TurnEvent
	if err := db.First(&event, "turn_id = ?", config.TurnID).Error; err != nil {
		t.Fatalf("load post-compression event: %v", err)
	}
	if event.ConversationID != config.ConversationID ||
		event.AttemptID != config.AttemptID {
		t.Fatalf("compression split event authority: %+v", event)
	}
}

func TestDelegatedChildEstablishesPinnedAuthorityBeforeProviderCall(t *testing.T) {
	service, parentConfig, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_delegated_child",
	)
	childConversationID, err := service.createDelegatedConversation(
		context.Background(),
		parentConfig,
	)
	if err != nil {
		t.Fatalf("create delegated conversation: %v", err)
	}
	task := &domain.DelegationTask{TaskID: "child-task", Depth: 1}
	childConfig, err := delegatedTurnConfig(
		parentConfig,
		task,
		[]string{"memory"},
		childConversationID,
	)
	if err != nil {
		t.Fatalf("derive delegated turn config: %v", err)
	}
	childConfig.TurnID = "turn-child"
	childConfig.AttemptID = "attempt-child"
	childAdmission, err := service.admissionResolver.Resolve(
		context.Background(),
		childConfig.ActorID,
		childConfig.Provider,
		childConfig.Model,
	)
	if err != nil {
		t.Fatalf("resolve delegated runtime authority: %v", err)
	}
	childConfig.RuntimeBudget, err = effectiveRuntimeBudget(
		childAdmission.Budget,
		childConfig.RequestedBudgetJSON,
	)
	if err != nil {
		t.Fatalf("resolve delegated runtime budget: %v", err)
	}
	if !proto.Equal(childConfig.RuntimeBudget, parentConfig.RuntimeBudget) {
		t.Fatalf(
			"delegated runtime budget = %+v, want parent budget %+v",
			childConfig.RuntimeBudget,
			parentConfig.RuntimeBudget,
		)
	}
	now := time.Now().UTC()
	if err := db.Create(&persistence.AgentTurn{
		ID:             childConfig.TurnID,
		ConversationID: childConfig.ConversationID,
		AgentID:        childConfig.AgentID,
		Status:         string(domain.TurnStatusRunning),
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed delegated turn: %v", err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID:           childConfig.AttemptID,
		TurnID:       childConfig.TurnID,
		AttemptIndex: 1,
		Status:       string(domain.TurnStatusRunning),
		StartedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed delegated attempt: %v", err)
	}
	if err := service.persistRuntimeAuthority(
		context.Background(),
		childConfig,
		childAdmission,
		runtimeAuthorityReadiness(childConfig, childAdmission),
		11,
	); err != nil {
		t.Fatalf("persist delegated runtime authority: %v", err)
	}

	providerCalls := 0
	service.providerCall = func(
		ctx context.Context,
		request *ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		if err := request.BeforeDispatch(ctx); err != nil {
			return nil, err
		}
		providerCalls++
		return &ProviderCallResponse{Content: "delegated"}, nil
	}
	response, err := service.callProviderWithRuntimeAuthority(
		context.Background(),
		childConfig,
		&ProviderCallRequest{Model: childConfig.Model},
	)
	if err != nil {
		t.Fatalf("execute delegated provider with pinned authority: %v", err)
	}
	if providerCalls != 1 || response.Content != "delegated" {
		t.Fatalf("delegated provider calls=%d response=%+v", providerCalls, response)
	}
	var child persistence.Conversation
	if err := db.First(&child, "id = ?", childConversationID).Error; err != nil {
		t.Fatalf("load delegated conversation: %v", err)
	}
	if child.ParentID == nil || *child.ParentID != parentConfig.ConversationID ||
		child.ActorPTID != parentConfig.ActorID {
		t.Fatalf("delegated conversation lost parent authority: %+v", child)
	}
}

func TestProviderAttemptBudgetIsSharedAcrossProviderPaths(t *testing.T) {
	service, config, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_provider_attempt_budget",
	)
	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", config.AttemptID).Error; err != nil {
		t.Fatalf("load pinned attempt: %v", err)
	}
	snapshot, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
	if err != nil {
		t.Fatalf("decode pinned runtime snapshot: %v", err)
	}
	snapshot.Budget.MaxAttempts = 2
	encoded, err := persistence.MarshalRuntimeSnapshot(snapshot)
	if err != nil {
		t.Fatalf("encode pinned runtime snapshot: %v", err)
	}
	snapshotHash, err := runtimeSnapshotHash(snapshot)
	if err != nil {
		t.Fatalf("hash pinned runtime snapshot: %v", err)
	}
	if err := db.Model(&persistence.TurnAttempt{}).
		Where("id = ?", config.AttemptID).
		Updates(map[string]interface{}{
			"runtime_snapshot":      encoded,
			"runtime_snapshot_hash": snapshotHash,
		}).Error; err != nil {
		t.Fatalf("persist bounded runtime snapshot: %v", err)
	}
	config.RuntimeBudget = cloneRuntimeBudget(snapshot.GetBudget())

	providerCalls := 0
	service.providerCall = func(
		ctx context.Context,
		request *ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		if err := request.BeforeDispatch(ctx); err != nil {
			return nil, err
		}
		providerCalls++
		return &ProviderCallResponse{Content: "ok"}, nil
	}
	for index := 0; index < 2; index++ {
		if _, err := service.callProviderWithRuntimeAuthority(
			context.Background(),
			config,
			&ProviderCallRequest{Model: config.Model},
		); err != nil {
			t.Fatalf("provider call %d: %v", index+1, err)
		}
	}
	if _, err := service.callProviderWithRuntimeAuthority(
		context.Background(),
		config,
		&ProviderCallRequest{Model: config.Model},
	); err == nil {
		t.Fatal("expected shared provider-attempt budget exhaustion")
	} else {
		var budgetErr *errcode.BizError
		if !errors.As(err, &budgetErr) ||
			budgetErr.Code != errcode.AgentToolBudgetExhausted ||
			budgetErr.Message != maxAttemptsExhaustedReason {
			t.Fatalf("unexpected provider-attempt exhaustion: %T %v", err, err)
		}
	}
	if providerCalls != 2 {
		t.Fatalf("provider calls = %d, want 2", providerCalls)
	}
	var turn persistence.AgentTurn
	if err := db.First(&turn, "id = ?", config.TurnID).Error; err != nil {
		t.Fatalf("load bounded turn: %v", err)
	}
	if turn.ProviderAttemptCount != 2 {
		t.Fatalf("persisted provider attempts = %d, want 2", turn.ProviderAttemptCount)
	}
}

func TestProviderAdapterRejectsStaleExpectedAuthorityBeforeNetwork(t *testing.T) {
	service, config, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_provider_adapter_fence",
	)
	if err := service.validatePinnedRuntimeAuthority(
		context.Background(),
		config,
	); err != nil {
		t.Fatalf("validate pinned runtime authority: %v", err)
	}
	var provider persistence.AgentProvider
	if err := db.Where(
		"actor_ptid = ? AND name = ?",
		config.ActorID,
		config.Provider,
	).First(&provider).Error; err != nil {
		t.Fatalf("load provider authority: %v", err)
	}
	adapter := NewProviderService(nil)

	for name, request := range map[string]*ProviderCallRequest{
		"provider version": {
			ProviderID:                      provider.ID,
			Model:                           config.Model,
			UserID:                          config.ActorID,
			ProviderType:                    config.Provider,
			ExpectedProviderConfigVersion:   "999",
			ExpectedCapabilitySourceVersion: config.CapabilitySourceVersion,
			BeforeDispatch:                  func(context.Context) error { return nil },
		},
		"capability source": {
			ProviderID:                      provider.ID,
			Model:                           config.Model,
			UserID:                          config.ActorID,
			ProviderType:                    config.Provider,
			ExpectedProviderConfigVersion:   config.ProviderConfigVersion,
			ExpectedCapabilitySourceVersion: "cap-src-stale",
			BeforeDispatch:                  func(context.Context) error { return nil },
		},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := adapter.Call(context.Background(), request)
			var bizErr *errcode.BizError
			if !errors.As(err, &bizErr) ||
				bizErr.Code != errcode.AgentVersionConflict {
				t.Fatalf("expected version conflict before network, got %T: %v", err, err)
			}
		})
	}
}

func TestProviderAdapterRejectsPartialExecutionAuthorityBeforeLookup(t *testing.T) {
	adapter := NewProviderService(nil)
	for name, request := range map[string]*ProviderCallRequest{
		"provider version only": {
			ProviderID:                    "provider-1",
			ExpectedProviderConfigVersion: "1",
		},
		"capability source only": {
			ProviderID:                      "provider-1",
			ExpectedCapabilitySourceVersion: "cap-src-1",
		},
		"dispatch reservation only": {
			ProviderID: "provider-1",
			BeforeDispatch: func(context.Context) error {
				return nil
			},
		},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := adapter.Call(context.Background(), request)
			var bizErr *errcode.BizError
			if !errors.As(err, &bizErr) ||
				bizErr.Code != errcode.AgentInvalidSourceState {
				t.Fatalf(
					"partial provider authority error = %T %v",
					err,
					err,
				)
			}
		})
	}
}

func TestProviderAdapterClosesValidationToDispatchVersionRace(t *testing.T) {
	service, config, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_provider_dispatch_race",
	)
	var networkCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(
		http.ResponseWriter,
		*http.Request,
	) {
		networkCalls.Add(1)
	}))
	defer server.Close()

	if err := db.Model(&persistence.AgentProvider{}).
		Where("actor_ptid = ? AND name = ?", config.ActorID, config.Provider).
		Update("base_url", server.URL).Error; err != nil {
		t.Fatalf("set provider endpoint: %v", err)
	}
	var provider persistence.AgentProvider
	if err := db.Where(
		"actor_ptid = ? AND name = ?",
		config.ActorID,
		config.Provider,
	).First(&provider).Error; err != nil {
		t.Fatalf("load provider endpoint authority: %v", err)
	}
	adapter := NewProviderService(nil)
	service.providerCall = func(
		ctx context.Context,
		request *ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		reserveAttempt := request.BeforeDispatch
		request.BeforeDispatch = func(dispatchCtx context.Context) error {
			if err := reserveAttempt(dispatchCtx); err != nil {
				return err
			}
			if err := db.Model(&persistence.AgentProvider{}).
				Where("actor_ptid = ? AND name = ?", config.ActorID, config.Provider).
				Update("version", 2).Error; err != nil {
				t.Fatalf("advance provider version inside adapter fence: %v", err)
			}
			return nil
		}
		return adapter.Call(ctx, request)
	}

	_, err := service.callProviderWithRuntimeAuthority(
		context.Background(),
		config,
		&ProviderCallRequest{
			ProviderID:   provider.ID,
			Model:        config.Model,
			ProviderType: config.Provider,
		},
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentVersionConflict {
		t.Fatalf("expected provider version race rejection, got %T: %v", err, err)
	}
	if networkCalls.Load() != 0 {
		t.Fatalf("provider version race reached network %d times", networkCalls.Load())
	}
	var turn persistence.AgentTurn
	if err := db.First(&turn, "id = ?", config.TurnID).Error; err != nil {
		t.Fatalf("load fenced turn: %v", err)
	}
	if turn.ProviderAttemptCount != 1 {
		t.Fatalf(
			"provider dispatch reservation count = %d, want 1",
			turn.ProviderAttemptCount,
		)
	}
	assertNoPersistedToolExecution(t, db)
}

func TestProviderExecutionRejectsStaleCapabilitySourceBeforeCall(t *testing.T) {
	service, config, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_stale_provider_call",
	)
	if err := db.Model(&persistence.AgentProvider{}).
		Where("actor_ptid = ? AND name = ?", config.ActorID, config.Provider).
		Update("version", 2).Error; err != nil {
		t.Fatalf("advance provider source version: %v", err)
	}

	providerCalls := 0
	service.providerCall = func(
		context.Context,
		*ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		providerCalls++
		return &ProviderCallResponse{Content: "unexpected"}, nil
	}
	_, err := service.callProviderWithRuntimeAuthority(
		context.Background(),
		config,
		&ProviderCallRequest{Model: config.Model},
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentVersionConflict {
		t.Fatalf("expected stale runtime rejection, got %T: %v", err, err)
	}
	if providerCalls != 0 {
		t.Fatalf("stale runtime executed provider %d times", providerCalls)
	}
	assertNoPersistedRuntimeExecution(t, db, config.TurnID)
}

func TestProviderExecutionRejectsChangedModelCapabilitySourceBeforeCall(t *testing.T) {
	service, config, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_stale_model_call",
	)
	seedTestModel(
		t,
		db,
		config.ActorID,
		config.Provider,
		config.Model,
		true,
		128000,
		`{"streaming":true,"reasoning":true}`,
	)

	providerCalls := 0
	service.providerCall = func(
		context.Context,
		*ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		providerCalls++
		return &ProviderCallResponse{Content: "unexpected"}, nil
	}
	_, err := service.callProviderWithRuntimeAuthority(
		context.Background(),
		config,
		&ProviderCallRequest{Model: config.Model},
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentVersionConflict {
		t.Fatalf("expected changed model source rejection, got %T: %v", err, err)
	}
	if providerCalls != 0 {
		t.Fatalf("changed model source executed provider %d times", providerCalls)
	}
	assertNoPersistedRuntimeExecution(t, db, config.TurnID)
}

func TestSummaryExecutionRejectsStaleCapabilitySourceBeforeCredentialOrProvider(t *testing.T) {
	service, config, db := setupPinnedProviderExecution(
		t,
		"runtime_authority_stale_summary",
	)
	if err := db.Model(&persistence.AgentProvider{}).
		Where("actor_ptid = ? AND name = ?", config.ActorID, config.Provider).
		Update("version", 2).Error; err != nil {
		t.Fatalf("advance provider source version: %v", err)
	}

	providerCalls := 0
	service.providerCall = func(
		context.Context,
		*ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		providerCalls++
		return &ProviderCallResponse{Content: "unexpected"}, nil
	}
	if _, _, err := service.executeSummaryLLM(
		context.Background(),
		config,
		"summarize",
	); err == nil {
		t.Fatal("expected stale summary runtime rejection")
	}
	if providerCalls != 0 {
		t.Fatalf("stale summary executed provider %d times", providerCalls)
	}
	assertNoPersistedToolExecution(t, db)
}

func setupPinnedProviderExecution(
	t *testing.T,
	databaseName string,
) (*TurnService, *TurnConfig, *gorm.DB) {
	t.Helper()
	restore := setupTestCatalog()
	t.Cleanup(restore)
	db := openRuntimeAuthorityDB(t, databaseName)
	if err := db.AutoMigrate(
		&persistence.AgentProvider{},
		&persistence.AgentModel{},
		&persistence.ToolCall{},
		&persistence.ToolBatch{},
	); err != nil {
		t.Fatalf("migrate provider authority: %v", err)
	}
	seedRuntimeAuthorityRows(t, db, "turn-1", "attempt-1")
	seedTestProvider(
		t,
		db,
		"ptid:person:owner",
		"test-provider",
		true,
		`{"api_key":"test-key"}`,
	)
	resolver := NewRuntimeAdmissionResolver(
		NewProviderConfigService(),
		NewModelConfigService(),
	)
	admission, err := resolver.Resolve(
		context.Background(),
		"ptid:person:owner",
		"test-provider",
		"test-model",
	)
	if err != nil {
		t.Fatalf("resolve initial runtime authority: %v", err)
	}
	config := runtimeAuthorityConfig("turn-1", "attempt-1")
	config.Provider = "test-provider"
	config.Model = "test-model"
	config.RuntimeBudget = cloneRuntimeBudget(admission.Budget)
	service := &TurnService{admissionResolver: resolver}
	if err := service.persistRuntimeAuthority(
		context.Background(),
		config,
		admission,
		runtimeAuthorityReadiness(config, admission),
		11,
	); err != nil {
		t.Fatalf("persist initial runtime authority: %v", err)
	}
	return service, config, db
}

func assertNoPersistedRuntimeExecution(t *testing.T, db *gorm.DB, turnID string) {
	t.Helper()
	var turn persistence.AgentTurn
	if err := db.First(&turn, "id = ?", turnID).Error; err != nil {
		t.Fatalf("load rejected runtime turn: %v", err)
	}
	if turn.ProviderAttemptCount != 0 {
		t.Fatalf(
			"rejected runtime reserved %d provider attempts",
			turn.ProviderAttemptCount,
		)
	}
	assertNoPersistedToolExecution(t, db)
}

func assertNoPersistedToolExecution(t *testing.T, db *gorm.DB) {
	t.Helper()
	for name, record := range map[string]interface{}{
		"tool call":  &persistence.ToolCall{},
		"tool batch": &persistence.ToolBatch{},
	} {
		var count int64
		if err := db.Model(record).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows: %v", name, err)
		}
		if count != 0 {
			t.Fatalf("rejected runtime persisted %d %s rows", count, name)
		}
	}
}

func TestExecuteTurnRejectsUnsupportedRuntimeBeforeProviderOrToolExecution(t *testing.T) {
	assertExecuteTurnRejectedWithoutExecution(
		t,
		"unsupported_runtime",
		domain.ThinkingModeEnabled,
		nil,
		0,
		"",
		"question",
	)
}

func TestExecuteTurnRejectsRuntimeIncompatibleCapabilityBeforeProviderOrToolExecution(t *testing.T) {
	restore := setupTestCatalog()
	t.Cleanup(restore)
	db := openAdmissionTestDB(t, "runtime_incompatible_capability")
	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatalf("migrate runtime incompatibility tables: %v", err)
	}
	now := time.Now().UTC()
	agent := &persistence.Agent{
		ID:             "agent-incompatible",
		Name:           "Incompatible Agent",
		ProviderID:     "test-provider",
		ModelName:      "test-model",
		ThinkingMode:   string(domain.ThinkingModeDisabled),
		Visibility:     string(domain.AgentVisibilityPrivate),
		OwnerActorPTID: "ptid:person:owner",
		ConfigJSON:     `{"tools":["skills_list"]}`,
		Version:        1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := db.Create(agent).Error; err != nil {
		t.Fatalf("seed incompatible agent: %v", err)
	}
	if err := db.Create(&persistence.Conversation{
		ID:         "conversation-incompatible",
		AgentID:    agent.ID,
		ActorPTID:  agent.OwnerActorPTID,
		Title:      "Incompatible capability",
		ProviderID: agent.ProviderID,
		Status:     string(domain.ConversationStatusActive),
		Version:    1,
		CreatedAt:  now,
		UpdatedAt:  now,
	}).Error; err != nil {
		t.Fatalf("seed incompatible conversation: %v", err)
	}
	seedTestProvider(
		t,
		db,
		agent.OwnerActorPTID,
		agent.ProviderID,
		true,
		`{"api_key":"test-key"}`,
	)
	seedTestModel(
		t,
		db,
		agent.OwnerActorPTID,
		agent.ProviderID,
		agent.ModelName,
		true,
		128000,
		`{"native-tools":false}`,
	)

	toolExecutions := 0
	registry := NewToolRegistryService(nil, nil)
	definitions := registry.Definitions([]string{"skills_list"})
	if len(definitions) != 1 {
		t.Fatalf("skills_list registry definition count = %d", len(definitions))
	}
	skillsList := *definitions[0]
	skillsList.Handler = func(
		context.Context,
		*domain.ToolCallMeta,
		json.RawMessage,
	) (*domain.ToolResult, error) {
		toolExecutions++
		return &domain.ToolResult{Content: "unexpected"}, nil
	}
	registry.Register(&skillsList)

	backfill := NewCapabilityBackfillService(db, registry)
	if _, err := backfill.Run(context.Background()); err != nil {
		t.Fatalf("backfill canonical capability manifests: %v", err)
	}
	var manifest persistence.CapabilityManifest
	if err := db.Where(
		"capability_id = ?",
		"tool:skills_list",
	).First(&manifest).Error; err != nil {
		t.Fatalf("load skills_list capability manifest: %v", err)
	}
	var required []string
	if err := json.Unmarshal(
		[]byte(manifest.RequiredCapabilitiesJSON),
		&required,
	); err != nil {
		t.Fatalf("decode skills_list runtime requirements: %v", err)
	}
	if len(required) != 1 || required[0] != "native-tools" {
		t.Fatalf("skills_list runtime requirements = %v", required)
	}

	admission := NewRuntimeAdmissionResolver(
		NewProviderConfigService(),
		NewModelConfigService(),
	)
	readiness := NewCapabilityAuthorityReadinessService(
		NewCapabilityAuthorityService(db),
		NewAgentService(),
		admission,
	)
	service := NewTurnService(
		nil,
		nil,
		nil,
		nil,
		NewCompressionService(),
		nil,
		nil,
		nil,
		registry,
		nil,
		nil,
		NewConversationService(),
	)
	service.SetAdmissionResolver(admission)
	service.SetCapabilityReadiness(readiness)
	service.SetAttachmentAdmissionService(NewAttachmentAdmissionService(nil))
	providerCalls := 0
	service.providerCall = func(
		context.Context,
		*ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		providerCalls++
		return &ProviderCallResponse{Content: "unexpected"}, nil
	}
	var emitted []TurnEvent

	_, err := service.ExecuteTurn(context.Background(), &TurnConfig{
		AgentID:           agent.ID,
		ActorID:           agent.OwnerActorPTID,
		ConversationID:    "conversation-incompatible",
		Identity:          "identity",
		AgentConfigPrompt: "prompt",
		Provider:          agent.ProviderID,
		Model:             agent.ModelName,
		ThinkingMode:      domain.ThinkingModeDisabled,
		ContextWindowSize: 128000,
		MaxRetries:        1,
		EventSink: func(_ context.Context, event TurnEvent) {
			emitted = append(emitted, event)
		},
	}, "question")
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) {
		t.Fatalf("runtime incompatibility error = %T: %v", err, err)
	}
	if bizErr.Code != errcode.AgentRuntimeIncompatibleCapability ||
		bizErr.HTTPStatus != http.StatusUnprocessableEntity ||
		bizErr.Payload == nil ||
		bizErr.Payload.GetErrorType() != string(errcode.AgentRuntimeIncompatibleCapability) ||
		bizErr.Payload.GetLocaleKey() != errcode.AgentRuntimeIncompatibleCapabilityLocaleKey ||
		bizErr.Payload.GetRetryable() ||
		!bizErr.Payload.GetTerminal() ||
		len(bizErr.Payload.GetDetails()) != 2 ||
		bizErr.Payload.GetDetails()["capability_id"] != "tool:skills_list" ||
		bizErr.Payload.GetDetails()["reason_code"] != runtimeCapabilityUnavailableReasonCode {
		t.Fatalf("runtime incompatibility payload = %+v", bizErr)
	}
	if providerCalls != 0 || toolExecutions != 0 {
		t.Fatalf(
			"runtime incompatibility executed downstream work: provider=%d tool=%d",
			providerCalls,
			toolExecutions,
		)
	}
	if len(emitted) != 1 ||
		emitted[0].Type != "error" ||
		emitted[0].TurnID == "" ||
		emitted[0].Seq <= 0 {
		t.Fatalf("typed rejection event identity = %+v", emitted)
	}

	var readinessRecord persistence.CapabilityReadinessSnapshot
	if err := db.First(&readinessRecord).Error; err != nil {
		t.Fatalf("load rejected readiness snapshot: %v", err)
	}
	var readinessSnapshot model.CapabilityReadinessSnapshot
	if err := proto.Unmarshal(readinessRecord.Payload, &readinessSnapshot); err != nil {
		t.Fatalf("decode rejected readiness snapshot: %v", err)
	}
	assertCapabilityReadiness(
		t,
		&readinessSnapshot,
		"tool:skills_list",
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
		runtimeCapabilityUnavailableReasonCode,
	)

	var turn persistence.AgentTurn
	if err := db.First(&turn).Error; err != nil {
		t.Fatalf("load rejected turn: %v", err)
	}
	if turn.Status != string(domain.TurnStatusFailed) ||
		turn.ProviderAttemptCount != 0 {
		t.Fatalf("rejected turn state = %+v", turn)
	}
	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "turn_id = ?", turn.ID).Error; err != nil {
		t.Fatalf("load rejected turn attempt: %v", err)
	}
	if attempt.Status != string(domain.TurnStatusFailed) ||
		attempt.ReadinessSnapshotID != readinessRecord.SnapshotID ||
		len(attempt.RuntimeSnapshot) == 0 ||
		attempt.RuntimeSnapshotHash == "" {
		t.Fatalf("rejected attempt lost runtime/readiness authority: %+v", attempt)
	}
	assertNoPersistedToolExecution(t, db)

	var eventRecord persistence.TurnEvent
	if err := db.First(&eventRecord, "turn_id = ? AND event_type = ?", turn.ID, "error").Error; err != nil {
		t.Fatalf("load rejected turn event: %v", err)
	}
	if eventRecord.EventSeq <= 0 || eventRecord.TurnID != turn.ID {
		t.Fatalf("persisted rejection event identity = %+v", eventRecord)
	}
	var event TurnEvent
	if err := json.Unmarshal([]byte(eventRecord.Payload), &event); err != nil {
		t.Fatalf("decode rejected turn event: %v", err)
	}
	if event.Error != errcode.AgentRuntimeIncompatibleCapabilityLocaleKey ||
		event.ErrorType != string(errcode.AgentRuntimeIncompatibleCapability) ||
		event.LocaleKey != errcode.AgentRuntimeIncompatibleCapabilityLocaleKey ||
		event.Retryable == nil ||
		*event.Retryable ||
		event.Terminal == nil ||
		!*event.Terminal ||
		len(event.Details) != 2 ||
		event.Details["capability_id"] != "tool:skills_list" ||
		event.Details["reason_code"] != runtimeCapabilityUnavailableReasonCode {
		t.Fatalf("rejected turn event = %+v", event)
	}
	for name, expected := range map[string]struct {
		model any
		count int64
	}{
		"readiness snapshot": {model: &persistence.CapabilityReadinessSnapshot{}, count: 1},
		"turn":               {model: &persistence.AgentTurn{}, count: 1},
		"attempt":            {model: &persistence.TurnAttempt{}, count: 1},
		"event":              {model: &persistence.TurnEvent{}, count: 1},
		"message":            {model: &persistence.AgentMessage{}, count: 0},
		"tool call":          {model: &persistence.ToolCall{}, count: 0},
		"tool batch":         {model: &persistence.ToolBatch{}, count: 0},
	} {
		var count int64
		if err := db.Model(expected.model).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows: %v", name, err)
		}
		if count != expected.count {
			t.Fatalf("%s row count = %d, want %d", name, count, expected.count)
		}
	}
}

func TestExecuteTurnRejectsUnsupportedStreamingBeforeProviderOrToolExecution(t *testing.T) {
	assertExecuteTurnRejectedWithoutExecution(
		t,
		"unsupported_streaming",
		domain.ThinkingModeDisabled,
		nil,
		0,
		`{"streaming":false}`,
		"question",
	)
}

func TestExecuteTurnRejectsInvalidBudgetBeforeProviderOrToolExecution(t *testing.T) {
	assertExecuteTurnRejectedWithoutExecution(
		t,
		"invalid_budget",
		domain.ThinkingModeDisabled,
		[]byte(`{"maxToolCalls":"invalid"}`),
		0,
		"",
		"question",
	)
}

func TestExecuteTurnRejectsExplicitZeroBudgetBeforeProviderOrToolExecution(t *testing.T) {
	assertExecuteTurnRejectedWithoutExecution(
		t,
		"zero_budget",
		domain.ThinkingModeDisabled,
		[]byte(`{"maxAttempts":0}`),
		0,
		"",
		"question",
	)
}

func TestExecuteTurnRejectsUnsupportedCostBudgetBeforeProviderOrToolExecution(t *testing.T) {
	assertExecuteTurnRejectedWithoutExecution(
		t,
		"unsupported_cost_budget",
		domain.ThinkingModeDisabled,
		[]byte(`{"maxCost":0.01}`),
		0,
		"",
		"question",
	)
}

func TestExecuteTurnRejectsDelegationBudgetBeforeProviderOrToolExecution(t *testing.T) {
	assertExecuteTurnRejectedWithoutExecution(
		t,
		"delegation_budget",
		domain.ThinkingModeDisabled,
		[]byte(`{"maxDelegationDepth":1}`),
		2,
		"",
		"question",
	)
}

func TestExecuteTurnInputOverflowLeavesNoRuntimePersistence(t *testing.T) {
	assertExecuteTurnRejectedWithoutExecution(
		t,
		"input_overflow",
		domain.ThinkingModeDisabled,
		[]byte(`{"maxInputTokens":"1"}`),
		0,
		"",
		"input exceeds the one-token runtime budget",
	)
}

func assertExecuteTurnRejectedWithoutExecution(
	t *testing.T,
	databaseName string,
	thinkingMode domain.ThinkingMode,
	requestedBudget []byte,
	depth int,
	modelCapabilities string,
	userInput string,
) {
	t.Helper()
	restore := setupTestCatalog()
	t.Cleanup(restore)
	db := openAdmissionTestDB(t, databaseName)
	if err := db.AutoMigrate(
		&persistence.AgentTurn{},
		&persistence.TurnEvent{},
		&persistence.AgentMessage{},
		&persistence.ToolCall{},
		&persistence.ToolBatch{},
	); err != nil {
		t.Fatalf("migrate zero-execution evidence tables: %v", err)
	}
	seedTestProvider(
		t,
		db,
		"actor-1",
		"test-provider",
		true,
		`{"api_key":"test-key"}`,
	)
	if modelCapabilities != "" {
		seedTestModel(
			t,
			db,
			"actor-1",
			"test-provider",
			"test-model",
			true,
			128000,
			modelCapabilities,
		)
	}
	providerCalls := 0
	toolExecutions := 0
	registry := NewToolRegistryService(nil, nil)
	registry.Register(&domain.ToolDefinition{
		Name:       "zero_execution_probe",
		JSONSchema: []byte(`{"type":"object"}`),
		Handler: func(
			context.Context,
			*domain.ToolCallMeta,
			json.RawMessage,
		) (*domain.ToolResult, error) {
			toolExecutions++
			return &domain.ToolResult{Content: "unexpected"}, nil
		},
	})
	service := &TurnService{
		admissionResolver: NewRuntimeAdmissionResolver(
			NewProviderConfigService(),
			NewModelConfigService(),
		),
		toolRegistry: registry,
		providerCall: func(
			context.Context,
			*ProviderCallRequest,
		) (*ProviderCallResponse, error) {
			providerCalls++
			return &ProviderCallResponse{Content: "unexpected"}, nil
		},
	}
	_, err := service.ExecuteTurn(context.Background(), &TurnConfig{
		AgentID:             "agent-1",
		ActorID:             "actor-1",
		ConversationID:      "conversation-1",
		Identity:            "identity",
		AgentConfigPrompt:   "prompt",
		Provider:            "test-provider",
		Model:               "test-model",
		ThinkingMode:        thinkingMode,
		RequestedBudgetJSON: requestedBudget,
		Depth:               depth,
		ContextWindowSize:   128000,
		MaxRetries:          1,
		AvailableTools:      []string{"zero_execution_probe"},
	}, userInput)
	if err == nil {
		t.Fatal("expected turn admission rejection")
	}
	if providerCalls != 0 || toolExecutions != 0 {
		t.Fatalf(
			"rejected turn produced execution: provider=%d tool=%d",
			providerCalls,
			toolExecutions,
		)
	}
	for name, record := range map[string]interface{}{
		"turn":       &persistence.AgentTurn{},
		"attempt":    &persistence.TurnAttempt{},
		"event":      &persistence.TurnEvent{},
		"message":    &persistence.AgentMessage{},
		"tool call":  &persistence.ToolCall{},
		"tool batch": &persistence.ToolBatch{},
	} {
		var count int64
		if countErr := db.Model(record).Count(&count).Error; countErr != nil {
			t.Fatalf("count %s rows: %v", name, countErr)
		}
		if count != 0 {
			t.Fatalf("rejected turn persisted %d %s rows", count, name)
		}
	}
}

func TestAuthorizedToolsRequireNativeToolCapabilityBeforeExecution(t *testing.T) {
	config := &TurnConfig{AvailableTools: []string{"zero_execution_probe"}}
	snapshot := &model.RuntimeCapabilitySnapshot{
		Agentic: &model.RuntimeAgenticCapabilities{},
	}
	providerCalls := 0
	toolExecutions := 0

	if err := validateAuthorizedRuntimeCapabilities(
		config.AvailableTools,
		snapshot,
	); err == nil {
		providerCalls++
		toolExecutions++
	}
	if providerCalls != 0 || toolExecutions != 0 {
		t.Fatalf(
			"unsupported tools produced execution: provider=%d tool=%d",
			providerCalls,
			toolExecutions,
		)
	}
}

func TestRuntimeBudgetDeadlineRejectsBeforeProviderExecution(t *testing.T) {
	ctx, cancel := withRuntimeBudgetDeadline(
		context.Background(),
		&model.RuntimeBudget{WallTimeMs: 1},
		time.Now().Add(-time.Second),
	)
	defer cancel()
	<-ctx.Done()

	providerCalls := 0
	service := &TurnService{
		providerCall: func(
			context.Context,
			*ProviderCallRequest,
		) (*ProviderCallResponse, error) {
			providerCalls++
			return &ProviderCallResponse{Content: "unexpected"}, nil
		},
	}
	config := runtimeAuthorityConfig("turn-1", "attempt-1")
	config.RuntimeBudget = &model.RuntimeBudget{
		MaxAttempts: 1,
		WallTimeMs:  1,
	}
	_, _, _, _, err := service.providerCallWithRetry(
		ctx,
		config,
		"turn-1",
		&domain.TurnTrace{},
		"",
		nil,
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentToolBudgetExhausted {
		t.Fatalf("expected budget rejection, got %T: %v", err, err)
	}
	if providerCalls != 0 {
		t.Fatalf("expired runtime budget executed provider %d times", providerCalls)
	}
}

func TestPersistRuntimeAuthorityRejectsTupleMismatchWithoutOverwrite(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "runtime_authority_conflict")
	seedRuntimeAuthorityRows(t, db, "turn-1", "attempt-1")
	service := &TurnService{}

	first := runtimeAuthorityAdmission("provider-1", "model-1", 1)
	if err := service.persistRuntimeAuthority(
		context.Background(),
		runtimeAuthorityConfig("turn-1", "attempt-1"),
		first,
		runtimeAuthorityReadiness(
			runtimeAuthorityConfig("turn-1", "attempt-1"),
			first,
		),
		11,
	); err != nil {
		t.Fatalf("persist first runtime authority: %v", err)
	}
	var original persistence.Conversation
	if err := db.First(&original, "id = ?", "conversation-1").Error; err != nil {
		t.Fatalf("load original binding: %v", err)
	}

	seedRuntimeAuthorityAttempt(t, db, "turn-2", "attempt-2")
	mismatched := runtimeAuthorityAdmission("provider-1", "model-2", 2)
	err := service.persistRuntimeAuthority(
		context.Background(),
		runtimeAuthorityConfig("turn-2", "attempt-2"),
		mismatched,
		runtimeAuthorityReadiness(
			runtimeAuthorityConfig("turn-2", "attempt-2"),
			mismatched,
		),
		11,
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentVersionConflict {
		t.Fatalf("expected runtime binding conflict, got %T: %v", err, err)
	}

	var after persistence.Conversation
	if err := db.First(&after, "id = ?", "conversation-1").Error; err != nil {
		t.Fatalf("load binding after conflict: %v", err)
	}
	if string(after.RuntimeBinding) != string(original.RuntimeBinding) {
		t.Fatal("runtime binding was overwritten after tuple conflict")
	}
	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", "attempt-2").Error; err != nil {
		t.Fatalf("load rejected attempt: %v", err)
	}
	if len(attempt.RuntimeSnapshot) != 0 || attempt.RuntimeSnapshotHash != "" {
		t.Fatal("rejected tuple persisted a partial attempt runtime snapshot")
	}
}

func TestPersistRuntimeAuthorityReusesBoundCapabilityObservation(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "runtime_authority_same_tuple")
	seedRuntimeAuthorityRows(t, db, "turn-1", "attempt-1")
	service := &TurnService{}

	first := runtimeAuthorityAdmission("provider-1", "model-1", 1)
	if err := service.persistRuntimeAuthority(
		context.Background(),
		runtimeAuthorityConfig("turn-1", "attempt-1"),
		first,
		runtimeAuthorityReadiness(
			runtimeAuthorityConfig("turn-1", "attempt-1"),
			first,
		),
		11,
	); err != nil {
		t.Fatalf("persist first runtime authority: %v", err)
	}
	seedRuntimeAuthorityAttempt(t, db, "turn-2", "attempt-2")
	second := runtimeAuthorityAdmission("provider-1", "model-1", 2)
	if err := service.persistRuntimeAuthority(
		context.Background(),
		runtimeAuthorityConfig("turn-2", "attempt-2"),
		second,
		runtimeAuthorityReadiness(
			runtimeAuthorityConfig("turn-2", "attempt-2"),
			second,
		),
		11,
	); err != nil {
		t.Fatalf("persist matching runtime authority: %v", err)
	}

	var attempts []persistence.TurnAttempt
	if err := db.Order("attempt_index ASC").Find(&attempts).Error; err != nil {
		t.Fatalf("load attempts: %v", err)
	}
	if len(attempts) != 2 || attempts[0].RuntimeSnapshotHash != attempts[1].RuntimeSnapshotHash {
		t.Fatalf("matching tuple did not retain pinned runtime facts: %+v", attempts)
	}
}

func TestCanonicalJSONHashMatchesAcceptanceValidator(t *testing.T) {
	hash, err := canonicalJSONHash(map[string]interface{}{
		"z": []interface{}{map[string]interface{}{"d": 4, "c": 3}},
		"a": map[string]interface{}{"b": 2, "a": 1},
	})
	if err != nil {
		t.Fatalf("hash canonical JSON: %v", err)
	}
	const pythonSortKeysCompactHash = "3733063eae4764a370f17cd1c3152dbc98f253d583b6437c2d54310550437799"
	if hash != pythonSortKeysCompactHash {
		t.Fatalf("canonical hash=%s, want acceptance validator hash=%s", hash, pythonSortKeysCompactHash)
	}
}

func TestResolveAgentDefaultsLoadsThinkingModeWithoutConfigJSON(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "thinking_mode_defaults")
	now := time.Now().UTC()
	if err := db.Create(&persistence.Agent{
		ID:             "agent-thinking",
		Name:           "Thinking",
		ProviderID:     "ark",
		ModelName:      "seed",
		Effort:         "high",
		ThinkingMode:   string(domain.ThinkingModeDisabled),
		Visibility:     string(domain.AgentVisibilityPrivate),
		OwnerActorPTID: "ptid:person:owner",
		Version:        1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed agent: %v", err)
	}

	config := &TurnConfig{AgentID: "agent-thinking"}
	(&TurnService{}).resolveAgentDefaults(context.Background(), config)

	if config.ThinkingMode != domain.ThinkingModeDisabled {
		t.Fatalf("thinking mode = %q, want disabled", config.ThinkingMode)
	}
	if config.Provider != "ark" || config.Model != "seed" || config.Effort != "high" {
		t.Fatalf("structured Agent defaults were not loaded: %+v", config)
	}
}

func TestMigrateRuntimeSnapshotThinkingModesBackfillsAutoAndHash(t *testing.T) {
	db := openRuntimeAuthorityDB(t, "thinking_mode_snapshot_migration")
	seedRuntimeAuthorityRows(t, db, "turn-migration", "attempt-migration")
	legacySnapshot := newDirectRuntimeSnapshot(
		runtimeAuthorityAdmission("provider-1", "model-1", 1),
		"11",
		"",
	)
	encoded, err := persistence.MarshalRuntimeSnapshot(legacySnapshot)
	if err != nil {
		t.Fatalf("encode legacy runtime snapshot: %v", err)
	}
	if err := db.Model(&persistence.TurnAttempt{}).
		Where("id = ?", "attempt-migration").
		Updates(map[string]interface{}{
			"runtime_snapshot":      encoded,
			"runtime_snapshot_hash": "legacy-hash",
		}).Error; err != nil {
		t.Fatalf("seed legacy runtime snapshot: %v", err)
	}

	if err := MigrateRuntimeSnapshotThinkingModes(db); err != nil {
		t.Fatalf("migrate runtime snapshot thinking modes: %v", err)
	}

	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", "attempt-migration").Error; err != nil {
		t.Fatalf("load migrated attempt: %v", err)
	}
	snapshot, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
	if err != nil {
		t.Fatalf("decode migrated runtime snapshot: %v", err)
	}
	if snapshot.GetThinkingMode() != string(domain.ThinkingModeAuto) {
		t.Fatalf("thinking mode = %q, want auto", snapshot.GetThinkingMode())
	}
	expectedHash, err := runtimeSnapshotHash(snapshot)
	if err != nil {
		t.Fatalf("hash migrated runtime snapshot: %v", err)
	}
	if attempt.RuntimeSnapshotHash != expectedHash {
		t.Fatalf(
			"runtime snapshot hash = %q, want %q",
			attempt.RuntimeSnapshotHash,
			expectedHash,
		)
	}
	if err := MigrateRuntimeSnapshotThinkingModes(db); err != nil {
		t.Fatalf("repeat thinking-mode migration: %v", err)
	}
}

func openRuntimeAuthorityDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db := openConversationAuthorityDB(t, name)
	if err := db.AutoMigrate(
		&persistence.Agent{},
		&persistence.TurnAttempt{},
	); err != nil {
		t.Fatalf("migrate runtime authority database: %v", err)
	}
	return db
}

func seedRuntimeAuthorityRows(t *testing.T, db *gorm.DB, turnID string, attemptID string) {
	t.Helper()
	now := time.Now().UTC()
	if err := db.Create(&persistence.Agent{
		ID:             "agent-1",
		Name:           "Agent",
		OwnerActorPTID: "ptid:person:owner",
		Version:        11,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed agent: %v", err)
	}
	if err := db.Create(&persistence.Conversation{
		ID:         "conversation-1",
		AgentID:    "agent-1",
		ActorPTID:  "ptid:person:owner",
		Title:      "Runtime authority",
		ProviderID: "provider-1",
		Status:     "active",
		Version:    1,
		CreatedAt:  now,
		UpdatedAt:  now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	seedRuntimeAuthorityAttempt(t, db, turnID, attemptID)
}

func seedRuntimeAuthorityAttempt(t *testing.T, db *gorm.DB, turnID string, attemptID string) {
	t.Helper()
	now := time.Now().UTC()
	if err := db.Create(&persistence.AgentTurn{
		ID:             turnID,
		ConversationID: "conversation-1",
		AgentID:        "agent-1",
		Status:         "running",
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID:           attemptID,
		TurnID:       turnID,
		AttemptIndex: 1,
		Status:       "running",
		StartedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed attempt: %v", err)
	}
}

func runtimeAuthorityConfig(turnID string, attemptID string) *TurnConfig {
	return &TurnConfig{
		TurnID:         turnID,
		AttemptID:      attemptID,
		ConversationID: "conversation-1",
		AgentID:        "agent-1",
		ActorID:        "ptid:person:owner",
		Provider:       "provider-1",
		Model:          "model-1",
		ThinkingMode:   domain.ThinkingModeDisabled,
	}
}

func runtimeAuthorityAdmission(providerID string, modelID string, observedDay int) *AdmissionSnapshot {
	return &AdmissionSnapshot{
		SnapshotID:            "readiness-1",
		ProviderID:            providerID,
		ModelID:               modelID,
		ProviderConfigVersion: "7",
		Capabilities: &model.RuntimeCapabilitySnapshot{
			SnapshotId: "readiness-1",
			Input:      &model.RuntimeInputCapabilities{Text: true},
			Output:     &model.RuntimeOutputCapabilities{Text: true, Structured: true},
			Runtime:    &model.RuntimeExecutionCapabilities{Streaming: true, PromptCache: true},
			Agentic:    &model.RuntimeAgenticCapabilities{NativeTools: true},
			Limits: &model.RuntimeCapabilityLimits{
				ContextTokens:   128000,
				OutputTokens:    8192,
				AttachmentCount: 10,
				AttachmentBytes: 10 * 1024 * 1024,
			},
			Resolution: []*model.RuntimeCapability{{
				CapabilityId: "provider",
				Resolution:   model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE,
				ReasonCode:   providerID,
			}},
			Provenance: &model.RuntimeCapabilityProvenance{
				DiscoverySource: runtimeCapabilityDiscoverySource,
				SourceVersion:   "cap-src-test",
				ObservedAt: timestamppb.New(
					time.Date(2026, 8, observedDay, 0, 0, 0, 0, time.UTC),
				),
			},
		},
		Budget: defaultRuntimeBudget(128000),
	}
}

func runtimeAuthorityReadiness(
	config *TurnConfig,
	admission *AdmissionSnapshot,
) *model.CapabilityReadinessSnapshot {
	return &model.CapabilityReadinessSnapshot{
		SnapshotId:        "capability-" + admission.SnapshotID,
		Ptid:              config.ActorID,
		AgentId:           config.AgentID,
		RuntimeSnapshotId: admission.SnapshotID,
		CreatedAt:         timestamppb.Now(),
		ExpiresAt:         timestamppb.New(time.Now().UTC().Add(time.Minute)),
	}
}
