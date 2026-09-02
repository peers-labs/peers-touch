package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/gorm"
)

type revisionFakeTurnExecutor struct {
	db                         *gorm.DB
	calls                      int
	configs                    []TurnConfig
	err                        error
	observedTurnStatus         string
	observedAttemptStatus      string
	observedAssistantMsgStatus string
}

func (f *revisionFakeTurnExecutor) ExecuteTurn(
	_ context.Context,
	config *TurnConfig,
	input string,
) (*domain.Turn, error) {
	f.calls++
	f.configs = append(f.configs, *config)
	if config.ExistingTurnID != "" {
		var turn persistence.AgentTurn
		_ = f.db.First(&turn, "id = ?", config.ExistingTurnID).Error
		f.observedTurnStatus = turn.Status
		var attempt persistence.TurnAttempt
		_ = f.db.First(&attempt, "id = ?", config.AttemptID).Error
		f.observedAttemptStatus = attempt.Status
		if config.AssistantMessageID != "" {
			var assistant persistence.AgentMessage
			_ = f.db.First(&assistant, "id = ?", config.AssistantMessageID).Error
			f.observedAssistantMsgStatus = assistant.Status
		}
	}
	if f.err != nil {
		turnID := config.PrecreatedTurnID
		if turnID == "" {
			turnID = config.ExistingTurnID
		}
		now := time.Now()
		_ = f.db.Model(&persistence.AgentTurn{}).
			Where("id = ?", turnID).
			Updates(map[string]interface{}{
				"status":   string(domain.TurnStatusFailed),
				"ended_at": now,
			}).Error
		if config.AssistantMessageID != "" {
			_ = f.db.Model(&persistence.AgentMessage{}).
				Where("id = ?", config.AssistantMessageID).
				Updates(map[string]interface{}{
					"status":     string(domain.TurnStatusFailed),
					"updated_at": now,
				}).Error
		}
		if config.AttemptID != "" {
			_ = f.db.Model(&persistence.TurnAttempt{}).
				Where("id = ?", config.AttemptID).
				Updates(map[string]interface{}{
					"status":     string(domain.TurnStatusFailed),
					"ended_at":   now,
					"error_code": f.err.Error(),
				}).Error
		}
		return nil, f.err
	}
	now := time.Now()
	response := "answer:" + input
	if config.AssistantMessageID != "" {
		if err := f.db.Model(&persistence.AgentMessage{}).
			Where("id = ?", config.AssistantMessageID).
			Updates(map[string]interface{}{
				"content":    response,
				"status":     "completed",
				"updated_at": now,
			}).Error; err != nil {
			return nil, err
		}
	}
	turnID := config.PrecreatedTurnID
	if turnID == "" {
		turnID = config.ExistingTurnID
	}
	if err := f.db.Model(&persistence.AgentTurn{}).
		Where("id = ?", turnID).
		Updates(map[string]interface{}{
			"final_response": response,
			"status":         string(domain.TurnStatusCompleted),
			"ended_at":       now,
		}).Error; err != nil {
		return nil, err
	}
	return &domain.Turn{
		TurnID:         turnID,
		ConversationID: config.ConversationID,
		AgentID:        config.AgentID,
		UserInput:      input,
		FinalResponse:  response,
		Status:         domain.TurnStatusCompleted,
		StartedAt:      now,
		EndedAt:        &now,
	}, nil
}

func seedRevisionConversation(t *testing.T, db *gorm.DB) {
	t.Helper()
	now := time.Now()
	content := "question"
	if err := db.Create(&persistence.Conversation{
		ID:                    "conversation-revision",
		AgentID:               "agent-1",
		Ptid:                  "ptid:person:owner",
		Title:                 "Revision",
		Status:                "active",
		ActiveBranchMessageID: "user-source",
		Version:               1,
		CreatedAt:             now,
		UpdatedAt:             now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentMessage{
		ID:             "user-source",
		ConversationID: "conversation-revision",
		Role:           string(domain.MessageRoleUser),
		Status:         "completed",
		Content:        &content,
		Seq:            1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func migrateRevisionModels(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(
		&persistence.AgentTurn{},
		&persistence.TurnAttempt{},
		&persistence.RevisionCommand{},
	); err != nil {
		t.Fatal(err)
	}
}

func revisionStateCounts(t *testing.T, db *gorm.DB) (messages, events, commands int64, version uint64) {
	t.Helper()
	if err := db.Model(&persistence.AgentMessage{}).Count(&messages).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&persistence.TurnEvent{}).Count(&events).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&persistence.RevisionCommand{}).Count(&commands).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&persistence.Conversation{}).
		Select("version").
		Where("id = ?", "conversation-revision").
		Scan(&version).Error; err != nil {
		t.Fatal(err)
	}
	return
}

func TestEditAndResendIsAtomicAndIdempotent(t *testing.T) {
	db := openConversationAuthorityDB(t, "revision_edit_resend")
	migrateRevisionModels(t, db)
	seedRevisionConversation(t, db)
	executor := &revisionFakeTurnExecutor{db: db}
	service := NewRevisionService(NewConversationService(), executor)
	request := RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceMessageID:             "user-source",
		Content:                     "revised question",
		IdempotencyKey:              "edit-1",
		ExpectedConversationVersion: 1,
	}

	first, err := service.EditAndResend(context.Background(), request)
	if err != nil {
		t.Fatalf("edit and resend: %v", err)
	}
	replay, err := service.EditAndResend(context.Background(), request)
	if err != nil {
		t.Fatalf("edit replay: %v", err)
	}
	if executor.calls != 1 {
		t.Fatalf("executor calls=%d, want 1", executor.calls)
	}
	if first.Turn.TurnID != replay.Turn.TurnID ||
		first.Message.MessageID != replay.Message.MessageID {
		t.Fatalf("idempotent replay changed identities: first=%+v replay=%+v", first, replay)
	}
	if first.Message.Role != domain.MessageRoleUser ||
		first.AssistantMessage == nil ||
		first.AssistantMessage.Role != domain.MessageRoleAssistant {
		t.Fatalf("edit response identities are invalid: %+v", first)
	}
	if first.Conversation.Version != 2 {
		t.Fatalf("conversation version=%d, want 2", first.Conversation.Version)
	}
	var messages int64
	db.Model(&persistence.AgentMessage{}).
		Where("conversation_id = ?", request.ConversationID).
		Count(&messages)
	if messages != 3 {
		t.Fatalf("message count=%d, want source+user sibling+assistant", messages)
	}
}

func TestSelectAndTombstoneAreVersionFenced(t *testing.T) {
	db := openConversationAuthorityDB(t, "revision_select_tombstone")
	migrateRevisionModels(t, db)
	seedRevisionConversation(t, db)
	service := NewRevisionService(NewConversationService(), nil)

	selected, err := service.SelectActiveBranch(context.Background(), RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceMessageID:             "user-source",
		IdempotencyKey:              "select-1",
		ExpectedConversationVersion: 1,
	})
	if err != nil {
		t.Fatalf("select branch: %v", err)
	}
	if selected.Conversation.ActiveBranchMessageID != "user-source" ||
		selected.Conversation.Version != 2 {
		t.Fatalf("unexpected selection: %+v", selected.Conversation)
	}

	tombstoned, err := service.TombstoneMessage(context.Background(), RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceMessageID:             "user-source",
		IdempotencyKey:              "tombstone-1",
		ExpectedConversationVersion: 2,
		DestructiveConfirmed:        true,
		Reason:                      "user requested",
	})
	if err != nil {
		t.Fatalf("tombstone: %v", err)
	}
	if tombstoned.Message.TombstonedAt == nil ||
		tombstoned.Conversation.Version != 3 ||
		tombstoned.Conversation.ActiveBranchMessageID != "" {
		t.Fatalf("unexpected tombstone result: %+v", tombstoned)
	}
}

func TestRevisionCommandsRejectWithoutMutation(t *testing.T) {
	testCases := []struct {
		name     string
		mutate   func(RevisionRequest) RevisionRequest
		wantCode errcode.Code
	}{
		{
			name: "cross actor",
			mutate: func(request RevisionRequest) RevisionRequest {
				request.Ptid = "ptid:person:other"
				return request
			},
			wantCode: errcode.AgentNotFound,
		},
		{
			name: "stale version",
			mutate: func(request RevisionRequest) RevisionRequest {
				request.ExpectedConversationVersion = 9
				return request
			},
			wantCode: errcode.AgentVersionConflict,
		},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			db := openConversationAuthorityDB(t, "revision_reject_"+testCase.name)
			migrateRevisionModels(t, db)
			seedRevisionConversation(t, db)
			service := NewRevisionService(NewConversationService(), &revisionFakeTurnExecutor{db: db})
			beforeMessages, beforeEvents, beforeCommands, beforeVersion := revisionStateCounts(t, db)
			request := testCase.mutate(RevisionRequest{
				Ptid:                        "ptid:person:owner",
				ConversationID:              "conversation-revision",
				SourceMessageID:             "user-source",
				Content:                     "revised",
				IdempotencyKey:              "reject-1",
				ExpectedConversationVersion: 1,
			})
			if _, err := service.EditAndResend(context.Background(), request); err == nil {
				t.Fatal("rejected revision succeeded")
			} else {
				requireBizCode(t, err, testCase.wantCode)
			}
			messages, events, commands, version := revisionStateCounts(t, db)
			if messages != beforeMessages || events != beforeEvents ||
				commands != beforeCommands || version != beforeVersion {
				t.Fatalf("rejection mutated state: messages=%d/%d events=%d/%d commands=%d/%d version=%d/%d",
					messages, beforeMessages, events, beforeEvents, commands, beforeCommands, version, beforeVersion)
			}
		})
	}
}

func TestRevisionIdempotencyPayloadConflict(t *testing.T) {
	db := openConversationAuthorityDB(t, "revision_idempotency_conflict")
	migrateRevisionModels(t, db)
	seedRevisionConversation(t, db)
	service := NewRevisionService(NewConversationService(), &revisionFakeTurnExecutor{db: db})
	request := RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceMessageID:             "user-source",
		Content:                     "first revision",
		IdempotencyKey:              "edit-conflict",
		ExpectedConversationVersion: 1,
	}
	if _, err := service.EditAndResend(context.Background(), request); err != nil {
		t.Fatalf("first revision: %v", err)
	}
	request.RequestedBudgetJSON = []byte(`{"max_attempts":1}`)
	if _, err := service.EditAndResend(context.Background(), request); err == nil {
		t.Fatal("idempotency payload conflict succeeded")
	} else {
		requireBizCode(t, err, errcode.AgentIdempotencyConflict)
	}
}

func TestRetryAddsAttemptUnderSameTurnWithoutBranchMutation(t *testing.T) {
	db := openConversationAuthorityDB(t, "revision_retry")
	migrateRevisionModels(t, db)
	seedRevisionConversation(t, db)
	now := time.Now()
	input := "question"
	if err := db.Create(&persistence.AgentTurn{
		ID:             "turn-failed",
		ConversationID: "conversation-revision",
		AgentID:        "agent-1",
		UserInput:      &input,
		Status:         string(domain.TurnStatusFailed),
		StartedAt:      now,
		EndedAt:        &now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&persistence.AgentMessage{}).
		Where("id = ?", "user-source").
		Update("turn_id", "turn-failed").Error; err != nil {
		t.Fatal(err)
	}
	parent := "user-source"
	branch := "branch-failed"
	failedContent := ""
	turnID := "turn-failed"
	if err := db.Create(&persistence.AgentMessage{
		ID:              "assistant-failed",
		ConversationID:  "conversation-revision",
		TurnID:          &turnID,
		Role:            string(domain.MessageRoleAssistant),
		Status:          "failed",
		Content:         &failedContent,
		Seq:             2,
		BranchID:        &branch,
		ParentMessageID: &parent,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&persistence.Conversation{}).
		Where("id = ?", "conversation-revision").
		Update("active_branch_message_id", "assistant-failed").Error; err != nil {
		t.Fatal(err)
	}
	executor := &revisionFakeTurnExecutor{db: db}
	service := NewRevisionService(NewConversationService(), executor)
	result, err := service.RetryTurn(context.Background(), RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceTurnID:                "turn-failed",
		IdempotencyKey:              "retry-1",
		ExpectedConversationVersion: 1,
	})
	if err != nil {
		t.Fatalf("retry turn: %v", err)
	}
	if result.Turn.TurnID != "turn-failed" || result.Attempt.AttemptIndex != 1 {
		t.Fatalf("retry identity changed: %+v", result)
	}
	if executor.calls != 1 || len(executor.configs) != 1 ||
		executor.configs[0].ExistingTurnID != "turn-failed" ||
		executor.configs[0].PrecreatedTurnID != "" ||
		executor.configs[0].AssistantMessageID != "assistant-failed" {
		t.Fatalf("retry executor config=%+v", executor.configs)
	}
	if executor.observedTurnStatus != string(domain.TurnStatusRunning) ||
		executor.observedAttemptStatus != string(domain.TurnStatusRunning) ||
		executor.observedAssistantMsgStatus != "pending" {
		t.Fatalf(
			"retry authority was not atomically admitted before execution: turn=%q attempt=%q assistant=%q",
			executor.observedTurnStatus,
			executor.observedAttemptStatus,
			executor.observedAssistantMsgStatus,
		)
	}
	var messageCount int64
	if err := db.Model(&persistence.AgentMessage{}).Count(&messageCount).Error; err != nil {
		t.Fatal(err)
	}
	if messageCount != 2 || result.Conversation.ActiveBranchMessageID != "assistant-failed" {
		t.Fatalf("retry created branch mutation: messages=%d conversation=%+v", messageCount, result.Conversation)
	}
}

func TestRetryCancelledTurnPreservesCompletedToolCallMessageAndCreatesOneAttempt(t *testing.T) {
	db := openConversationAuthorityDB(t, "revision_retry_after_tool_call_"+generateID("db"))
	migrateRevisionModels(t, db)
	seedRevisionConversation(t, db)
	now := time.Now()
	input := "question"
	turnID := "turn-cancelled-after-tool-call"
	if err := db.Create(&persistence.AgentTurn{
		ID:             turnID,
		ConversationID: "conversation-revision",
		AgentID:        "agent-1",
		UserInput:      &input,
		Status:         string(domain.TurnStatusCancelled),
		TerminalReason: "cancelled_by_user",
		StartedAt:      now,
		EndedAt:        &now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&persistence.AgentMessage{}).
		Where("id = ?", "user-source").
		Update("turn_id", turnID).Error; err != nil {
		t.Fatal(err)
	}
	parent := "user-source"
	branch := "branch-tool-call"
	content := ""
	toolCalls := []byte(`[{"id":"tool-call-1","name":"skills_list"}]`)
	if err := db.Create(&persistence.AgentMessage{
		ID:              "assistant-tool-call",
		ConversationID:  "conversation-revision",
		TurnID:          &turnID,
		Role:            string(domain.MessageRoleAssistant),
		Status:          "completed",
		Content:         &content,
		ToolCallsJSON:   toolCalls,
		Seq:             2,
		BranchID:        &branch,
		ParentMessageID: &parent,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&persistence.Conversation{}).
		Where("id = ?", "conversation-revision").
		Update("active_branch_message_id", "assistant-tool-call").Error; err != nil {
		t.Fatal(err)
	}

	executor := &revisionFakeTurnExecutor{db: db}
	service := NewRevisionService(NewConversationService(), executor)
	request := RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceTurnID:                turnID,
		IdempotencyKey:              "retry-after-tool-call",
		ExpectedConversationVersion: 1,
	}
	result, err := service.RetryTurn(context.Background(), request)
	if err != nil {
		t.Fatalf("retry cancelled turn after tool call: %v", err)
	}
	if result.Turn.TurnID != turnID || result.Attempt.AttemptIndex != 1 {
		t.Fatalf("retry identity changed: %+v", result)
	}
	if executor.calls != 1 || len(executor.configs) != 1 ||
		executor.configs[0].AssistantMessageID == "" ||
		executor.configs[0].AssistantMessageID == "assistant-tool-call" ||
		executor.configs[0].AssistantBranchID != branch {
		t.Fatalf("retry output identity is invalid: %+v", executor.configs)
	}

	var preserved persistence.AgentMessage
	if err := db.First(&preserved, "id = ?", "assistant-tool-call").Error; err != nil {
		t.Fatal(err)
	}
	if preserved.Status != "completed" ||
		string(preserved.ToolCallsJSON) != string(toolCalls) {
		t.Fatalf("completed tool-call message was mutated: %+v", preserved)
	}
	var retryOutput persistence.AgentMessage
	if err := db.First(
		&retryOutput,
		"id = ?",
		executor.configs[0].AssistantMessageID,
	).Error; err != nil {
		t.Fatal(err)
	}
	if retryOutput.Status != "completed" ||
		revisionStringValue(retryOutput.ParentMessageID) != parent ||
		revisionStringValue(retryOutput.BranchID) != branch {
		t.Fatalf("retry output did not restart the existing branch: %+v", retryOutput)
	}
	if result.AssistantMessage == nil ||
		result.AssistantMessage.MessageID != retryOutput.ID ||
		result.Conversation.ActiveBranchMessageID != retryOutput.ID {
		t.Fatalf("retry result omitted the new assistant projection: %+v", result)
	}
	var messages int64
	if err := db.Model(&persistence.AgentMessage{}).
		Where("conversation_id = ?", "conversation-revision").
		Count(&messages).Error; err != nil {
		t.Fatal(err)
	}
	if messages != 3 {
		t.Fatalf("message count=%d, want source+tool-call+retry output", messages)
	}
	replay, err := service.RetryTurn(context.Background(), request)
	if err != nil {
		t.Fatalf("replay completed retry: %v", err)
	}
	if executor.calls != 1 ||
		replay.Attempt.ID != result.Attempt.ID ||
		replay.AssistantMessage == nil ||
		replay.AssistantMessage.MessageID != retryOutput.ID ||
		replay.Conversation.Version != result.Conversation.Version {
		t.Fatalf("retry replay changed admitted identities: first=%+v replay=%+v", result, replay)
	}
	var attempts int64
	if err := db.Model(&persistence.TurnAttempt{}).
		Where("turn_id = ?", turnID).
		Count(&attempts).Error; err != nil {
		t.Fatal(err)
	}
	if attempts != 1 {
		t.Fatalf("retry attempts=%d, want 1", attempts)
	}
}

func TestRetryInterruptedTurnUsesTypedExistingTurnPathAndActorIsolation(t *testing.T) {
	db := openConversationAuthorityDB(t, "revision_retry_interrupted")
	migrateRevisionModels(t, db)
	seedRevisionConversation(t, db)
	now := time.Now()
	input := "question"
	turnID := "turn-interrupted"
	if err := db.Create(&persistence.AgentTurn{
		ID:             turnID,
		ConversationID: "conversation-revision",
		AgentID:        "agent-1",
		UserInput:      &input,
		Status:         string(domain.TurnStatusInterrupted),
		TerminalReason: "station_restart_interrupted",
		StartedAt:      now,
		EndedAt:        &now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&persistence.AgentMessage{}).
		Where("id = ?", "user-source").
		Update("turn_id", turnID).Error; err != nil {
		t.Fatal(err)
	}
	parent := "user-source"
	branch := "branch-interrupted"
	content := ""
	if err := db.Create(&persistence.AgentMessage{
		ID:              "assistant-interrupted",
		ConversationID:  "conversation-revision",
		TurnID:          &turnID,
		Role:            string(domain.MessageRoleAssistant),
		Status:          string(domain.TurnStatusInterrupted),
		Content:         &content,
		Seq:             2,
		BranchID:        &branch,
		ParentMessageID: &parent,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&persistence.Conversation{}).
		Where("id = ?", "conversation-revision").
		Update("active_branch_message_id", "assistant-interrupted").Error; err != nil {
		t.Fatal(err)
	}

	executor := &revisionFakeTurnExecutor{db: db}
	service := NewRevisionService(NewConversationService(), executor)
	request := RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceTurnID:                turnID,
		IdempotencyKey:              "retry-interrupted",
		ExpectedConversationVersion: 1,
	}
	result, err := service.RetryTurn(context.Background(), request)
	if err != nil {
		t.Fatalf("retry interrupted turn: %v", err)
	}
	if result.Turn.TurnID != turnID ||
		result.Attempt.AttemptIndex != 1 ||
		executor.calls != 1 ||
		executor.configs[0].ExistingTurnID != turnID {
		t.Fatalf("interrupted retry did not use existing-turn attempt path: result=%+v config=%+v", result, executor.configs)
	}

	request.Ptid = "ptid:person:other"
	request.IdempotencyKey = "retry-interrupted-foreign"
	request.ExpectedConversationVersion = result.Conversation.Version
	if _, err := service.RetryTurn(context.Background(), request); err == nil {
		t.Fatal("foreign actor retried an interrupted turn")
	} else {
		requireBizCode(t, err, errcode.AgentNotFound)
	}
}

func TestSelectRejectsNonHeadAndTombstoneRejectsDependencies(t *testing.T) {
	db := openConversationAuthorityDB(t, "revision_dependency_guards")
	migrateRevisionModels(t, db)
	seedRevisionConversation(t, db)
	now := time.Now()
	content := "answer"
	parent := "user-source"
	if err := db.Create(&persistence.AgentMessage{
		ID:              "assistant-head",
		ConversationID:  "conversation-revision",
		Role:            string(domain.MessageRoleAssistant),
		Status:          "completed",
		Content:         &content,
		Seq:             2,
		ParentMessageID: &parent,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&persistence.Conversation{}).
		Where("id = ?", "conversation-revision").
		Update("active_branch_message_id", "assistant-head").Error; err != nil {
		t.Fatal(err)
	}
	service := NewRevisionService(NewConversationService(), nil)
	if _, err := service.SelectActiveBranch(context.Background(), RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceMessageID:             "user-source",
		IdempotencyKey:              "select-non-head",
		ExpectedConversationVersion: 1,
	}); err == nil {
		t.Fatal("selected non-head message")
	} else {
		requireBizCode(t, err, errcode.AgentInvalidSourceState)
	}

	if err := db.Model(&persistence.Conversation{}).
		Where("id = ?", "conversation-revision").
		Update("queued_turn_count", 1).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.TombstoneMessage(context.Background(), RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceMessageID:             "assistant-head",
		IdempotencyKey:              "tombstone-queued",
		ExpectedConversationVersion: 1,
		DestructiveConfirmed:        true,
	}); err == nil {
		t.Fatal("tombstoned message with queued dependency")
	} else {
		requireBizCode(t, err, errcode.AgentActiveDependency)
	}
	var row persistence.AgentMessage
	if err := db.First(&row, "id = ?", "assistant-head").Error; err != nil {
		t.Fatal(err)
	}
	if row.TombstonedAt != nil {
		t.Fatal("dependency rejection tombstoned message")
	}
}

func TestExecutionFailureReplaysStoredTerminalAdmission(t *testing.T) {
	db := openConversationAuthorityDB(t, "revision_execution_failure_replay")
	migrateRevisionModels(t, db)
	seedRevisionConversation(t, db)
	executor := &revisionFakeTurnExecutor{db: db, err: errors.New("provider failed")}
	service := NewRevisionService(NewConversationService(), executor)
	request := RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceMessageID:             "user-source",
		Content:                     "revised question",
		IdempotencyKey:              "failed-execution",
		ExpectedConversationVersion: 1,
	}
	if _, err := service.EditAndResend(context.Background(), request); err == nil {
		t.Fatal("expected execution failure")
	}
	replay, err := service.EditAndResend(context.Background(), request)
	if err != nil {
		t.Fatalf("replay stored admission: %v", err)
	}
	if executor.calls != 1 || replay.Turn.Status != domain.TurnStatusFailed ||
		replay.AssistantMessage == nil || replay.AssistantMessage.Status != "failed" {
		t.Fatalf("unexpected failure replay: calls=%d result=%+v", executor.calls, replay)
	}
}

func TestRegenerateCreatesAssistantSiblingFromTerminalSource(t *testing.T) {
	db := openConversationAuthorityDB(t, "revision_regenerate")
	migrateRevisionModels(t, db)
	seedRevisionConversation(t, db)
	now := time.Now()
	answer := "original answer"
	parent := "user-source"
	if err := db.Create(&persistence.AgentMessage{
		ID:              "assistant-source",
		ConversationID:  "conversation-revision",
		Role:            string(domain.MessageRoleAssistant),
		Status:          "completed",
		Content:         &answer,
		Seq:             2,
		ParentMessageID: &parent,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&persistence.Conversation{}).
		Where("id = ?", "conversation-revision").
		Update("active_branch_message_id", "assistant-source").Error; err != nil {
		t.Fatal(err)
	}
	executor := &revisionFakeTurnExecutor{db: db}
	service := NewRevisionService(NewConversationService(), executor)
	result, err := service.RegenerateTurn(context.Background(), RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceMessageID:             "assistant-source",
		IdempotencyKey:              "regenerate-1",
		ExpectedConversationVersion: 1,
	})
	if err != nil {
		t.Fatalf("regenerate: %v", err)
	}
	if result.Message.ParentMessageID != "user-source" ||
		result.Message.ReplacesMessageID != "assistant-source" ||
		result.Conversation.ActiveBranchMessageID != result.Message.MessageID {
		t.Fatalf("invalid regenerate lineage: %+v", result)
	}
	var source persistence.AgentMessage
	if err := db.First(&source, "id = ?", "assistant-source").Error; err != nil {
		t.Fatal(err)
	}
	if revisionStringValue(source.Content) != "original answer" || source.TombstonedAt != nil {
		t.Fatalf("regenerate mutated source: %+v", source)
	}
}

func TestRevisionSourceErrorsAreTyped(t *testing.T) {
	db := openConversationAuthorityDB(t, "revision_source_errors")
	migrateRevisionModels(t, db)
	seedRevisionConversation(t, db)
	service := NewRevisionService(NewConversationService(), &revisionFakeTurnExecutor{db: db})

	if _, err := service.RegenerateTurn(context.Background(), RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceMessageID:             "missing",
		IdempotencyKey:              "missing-source",
		ExpectedConversationVersion: 1,
	}); err == nil {
		t.Fatal("missing source regenerated")
	} else {
		requireBizCode(t, err, errcode.AgentNotFound)
	}
	if _, err := service.RegenerateTurn(context.Background(), RevisionRequest{
		Ptid:                        "ptid:person:owner",
		ConversationID:              "conversation-revision",
		SourceMessageID:             "user-source",
		IdempotencyKey:              "wrong-role",
		ExpectedConversationVersion: 1,
	}); err == nil {
		t.Fatal("wrong-role source regenerated")
	} else {
		requireBizCode(t, err, errcode.AgentInvalidSourceState)
	}
}

func TestTombstoneDependencyKindsFailClosed(t *testing.T) {
	testCases := []struct {
		name  string
		setup func(*testing.T, *gorm.DB)
	}{
		{
			name: "running turn",
			setup: func(t *testing.T, db *gorm.DB) {
				input := "running"
				if err := db.Create(&persistence.AgentTurn{
					ID:             "turn-running",
					ConversationID: "conversation-revision",
					AgentID:        "agent-1",
					UserInput:      &input,
					Status:         string(domain.TurnStatusRunning),
					StartedAt:      time.Now(),
				}).Error; err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "unresolved tool",
			setup: func(t *testing.T, db *gorm.DB) {
				if err := db.Model(&persistence.AgentMessage{}).
					Where("id = ?", "user-source").
					Update("tool_calls_json", []byte(`[{"status":"waiting_approval"}]`)).Error; err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "retention lock",
			setup: func(t *testing.T, db *gorm.DB) {
				if err := db.Model(&persistence.AgentMessage{}).
					Where("id = ?", "user-source").
					Update("metadata_json", []byte(`{"retention_locked":true}`)).Error; err != nil {
					t.Fatal(err)
				}
			},
		},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			db := openConversationAuthorityDB(t, "revision_dependency_"+testCase.name)
			migrateRevisionModels(t, db)
			seedRevisionConversation(t, db)
			testCase.setup(t, db)
			service := NewRevisionService(NewConversationService(), nil)
			if _, err := service.TombstoneMessage(context.Background(), RevisionRequest{
				Ptid:                        "ptid:person:owner",
				ConversationID:              "conversation-revision",
				SourceMessageID:             "user-source",
				IdempotencyKey:              "dependency-" + testCase.name,
				ExpectedConversationVersion: 1,
				DestructiveConfirmed:        true,
			}); err == nil {
				t.Fatal("tombstone with dependency succeeded")
			} else {
				requireBizCode(t, err, errcode.AgentActiveDependency)
			}
		})
	}
}
