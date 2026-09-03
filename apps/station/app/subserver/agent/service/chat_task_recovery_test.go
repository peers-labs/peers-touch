package service

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestRecoverRunningChatTasksSettlesDirectTurnAndSnapshot(t *testing.T) {
	db := openConversationAuthorityDB(t, "chat_task_restart_settlement")
	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatalf("migrate Agent models: %v", err)
	}

	now := time.Now().UTC()
	snapshotBytes, err := persistence.MarshalRuntimeSnapshot(&model.RuntimeSnapshot{
		RuntimeKind:      model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
		ProviderId:       "provider-1",
		ModelId:          "model-1",
		RuntimeProfileId: "modern-chat-agent-v1",
	})
	if err != nil {
		t.Fatalf("encode runtime snapshot: %v", err)
	}
	turnID := "turn-restart"
	pendingContent := ""
	records := []struct {
		name  string
		value interface{}
	}{
		{name: "conversation", value: &persistence.Conversation{
			ID:        "conversation-restart",
			AgentID:   "agent-1",
			ActorPTID: "ptid:person:owner",
			Title:     "Restart",
			Status:    "active",
			CreatedAt: now,
			UpdatedAt: now,
		}},
		{name: "turn", value: &persistence.AgentTurn{
			ID:             turnID,
			ConversationID: "conversation-restart",
			AgentID:        "agent-1",
			Status:         string(domain.TurnStatusRunning),
			StartedAt:      now,
		}},
		{name: "attempt", value: &persistence.TurnAttempt{
			ID:              "attempt-restart",
			TurnID:          turnID,
			AttemptIndex:    1,
			Status:          string(domain.TurnStatusRunning),
			RuntimeSnapshot: snapshotBytes,
			StartedAt:       now,
		}},
		{name: "assistant message", value: &persistence.AgentMessage{
			ID:             "assistant-restart",
			ConversationID: "conversation-restart",
			TurnID:         &turnID,
			Role:           string(domain.MessageRoleAssistant),
			Status:         "pending",
			Content:        &pendingContent,
			Seq:            1,
			CreatedAt:      now,
			UpdatedAt:      now,
		}},
		{name: "task", value: &persistence.TaskRun{
			TaskID:         "task-restart",
			Title:          "Restart",
			Surface:        int32(model.TaskSurface_TASK_SURFACE_CHAT),
			Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
			OwnerActorPTID: "ptid:person:owner",
			ConversationID: "conversation-restart",
			CreatedAt:      now,
			StartedAt:      now,
			UpdatedAt:      now,
		}},
		{name: "step", value: &persistence.ExecutionStep{
			StepID:    "step-restart",
			TaskID:    "task-restart",
			AgentID:   "agent-1",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			TurnID:    turnID,
			Attempt:   1,
			StartedAt: now,
		}},
		{name: "lease", value: &persistence.ExecutorLease{
			LeaseID:      "lease-restart",
			TaskID:       "task-restart",
			StepID:       "step-restart",
			ExecutorID:   "station-old",
			ExecutorKind: int32(model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED),
			Status:       chatLeaseStatusActive,
			AcquiredAt:   now,
			HeartbeatAt:  now,
			ExpiresAt:    now.Add(time.Minute),
		}},
	}
	for _, record := range records {
		if err := db.Create(record.value).Error; err != nil {
			t.Fatalf("seed %s: %v", record.name, err)
		}
	}

	service := NewChatTaskService(nil)
	if err := service.RecoverRunningChatTasks(context.Background()); err != nil {
		t.Fatalf("recover running chat tasks: %v", err)
	}

	var turn persistence.AgentTurn
	if err := db.First(&turn, "id = ?", turnID).Error; err != nil {
		t.Fatalf("reload turn: %v", err)
	}
	if turn.Status != string(domain.TurnStatusInterrupted) ||
		turn.TerminalReason != "station_restart_interrupted" ||
		turn.EndedAt == nil {
		t.Fatalf("turn did not settle coherently: %+v", turn)
	}
	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", "attempt-restart").Error; err != nil {
		t.Fatalf("reload attempt: %v", err)
	}
	if attempt.Status != string(domain.TurnStatusInterrupted) ||
		attempt.ErrorCode != "station_restart_interrupted" ||
		attempt.EndedAt == nil {
		t.Fatalf("attempt did not settle coherently: %+v", attempt)
	}
	var step struct {
		Status        int32
		ResultSummary string
	}
	if err := db.Model(&persistence.ExecutionStep{}).
		Select("status", "result_summary").
		Where("step_id = ?", "step-restart").
		Scan(&step).Error; err != nil {
		t.Fatalf("reload step: %v", err)
	}
	if step.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED) ||
		step.ResultSummary != "station_restart_interrupted" {
		t.Fatalf("step did not settle coherently: %+v", step)
	}
	var endedSteps int64
	if err := db.Model(&persistence.ExecutionStep{}).
		Where("step_id = ? AND ended_at IS NOT NULL", "step-restart").
		Count(&endedSteps).Error; err != nil {
		t.Fatalf("count terminal steps: %v", err)
	}
	if endedSteps != 1 {
		t.Fatal("step has no terminal timestamp")
	}
	var message persistence.AgentMessage
	if err := db.First(&message, "id = ?", "assistant-restart").Error; err != nil {
		t.Fatalf("reload assistant message: %v", err)
	}
	if message.Status != string(domain.TurnStatusInterrupted) {
		t.Fatalf("assistant message status = %q, want interrupted", message.Status)
	}
	var lease persistence.ExecutorLease
	if err := db.First(&lease, "lease_id = ?", "lease-restart").Error; err != nil {
		t.Fatalf("reload lease: %v", err)
	}
	if lease.Status != chatLeaseStatusReleased {
		t.Fatalf("lease status = %q, want released", lease.Status)
	}
	var terminalEvent persistence.TurnEvent
	if err := db.First(&terminalEvent, "turn_id = ? AND event_type = ?", turnID, "error").Error; err != nil {
		t.Fatalf("load terminal turn event: %v", err)
	}
	if terminalEvent.EventSeq != 1 {
		t.Fatalf("terminal event sequence = %d, want 1", terminalEvent.EventSeq)
	}
	var taskEvent persistence.TaskEvent
	if err := db.First(&taskEvent, "task_id = ? AND turn_id = ?", "task-restart", turnID).Error; err != nil {
		t.Fatalf("load terminal task event: %v", err)
	}

	snapshot, err := NewConversationService().GetTurnEventSnapshot(
		context.Background(),
		"ptid:person:owner",
		"conversation-restart",
		turnID,
	)
	if err != nil {
		t.Fatalf("load interrupted turn snapshot: %v", err)
	}
	if snapshot.Status != string(domain.TurnStatusInterrupted) ||
		snapshot.TerminalReason != "station_restart_interrupted" ||
		snapshot.LastSequence != terminalEvent.EventSeq {
		t.Fatalf("snapshot does not converge with restart settlement: %+v", snapshot)
	}

	if _, err := NewConversationService().GetTurnEventSnapshot(
		context.Background(),
		"ptid:person:other",
		"conversation-restart",
		turnID,
	); err == nil {
		t.Fatal("foreign actor read the interrupted turn snapshot")
	}

	if err := service.RecoverRunningChatTasks(context.Background()); err != nil {
		t.Fatalf("idempotent recovery pass: %v", err)
	}
	var turnEventCount int64
	if err := db.Model(&persistence.TurnEvent{}).
		Where("turn_id = ? AND event_type = ?", turnID, "error").
		Count(&turnEventCount).Error; err != nil {
		t.Fatal(err)
	}
	if turnEventCount != 1 {
		t.Fatalf("idempotent recovery created %d terminal events", turnEventCount)
	}
}

func TestRecoverRunningChatTasksConvergesAlreadyTerminalTurn(t *testing.T) {
	db := openConversationAuthorityDB(t, "chat_task_terminal_turn_window")
	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	finalResponse := "complete"
	records := []interface{}{
		&persistence.Conversation{ID: "conversation-terminal", AgentID: "agent-1", ActorPTID: "ptid:person:owner", Title: "Terminal", Status: "active", CreatedAt: now, UpdatedAt: now},
		&persistence.AgentTurn{ID: "turn-terminal", ConversationID: "conversation-terminal", AgentID: "agent-1", Status: string(domain.TurnStatusCompleted), FinalResponse: &finalResponse, TerminalReason: "completed", StartedAt: now, EndedAt: &now},
		&persistence.TurnAttempt{ID: "attempt-terminal", TurnID: "turn-terminal", AttemptIndex: 1, Status: string(domain.TurnStatusCompleted), StartedAt: now, EndedAt: &now},
		&persistence.TaskRun{TaskID: "task-terminal", Surface: int32(model.TaskSurface_TASK_SURFACE_CHAT), Status: int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING), OwnerActorPTID: "ptid:person:owner", ConversationID: "conversation-terminal", CreatedAt: now, StartedAt: now, UpdatedAt: now},
		&persistence.ExecutionStep{StepID: "step-terminal", TaskID: "task-terminal", AgentID: "agent-1", TurnID: "turn-terminal", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING), StartedAt: now},
		&persistence.ExecutorLease{LeaseID: "lease-terminal", TaskID: "task-terminal", StepID: "step-terminal", ExecutorID: "station-old", ExecutorKind: int32(model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED), Status: chatLeaseStatusActive, AcquiredAt: now, HeartbeatAt: now, ExpiresAt: now.Add(time.Minute)},
	}
	for _, record := range records {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}

	service := NewChatTaskService(nil)
	if err := service.RecoverRunningChatTasks(context.Background()); err != nil {
		t.Fatalf("recover already-terminal turn: %v", err)
	}
	var settledStepCount int64
	if err := db.Model(&persistence.ExecutionStep{}).
		Where(
			"step_id = ? AND status = ? AND ended_at IS NOT NULL",
			"step-terminal",
			int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		).
		Count(&settledStepCount).Error; err != nil {
		t.Fatal(err)
	}
	if settledStepCount != 1 {
		t.Fatalf("running step did not converge to completed turn")
	}
	var terminalEvents int64
	if err := db.Model(&persistence.TurnEvent{}).
		Where("turn_id = ? AND event_type = ?", "turn-terminal", "done").
		Count(&terminalEvents).Error; err != nil {
		t.Fatal(err)
	}
	if terminalEvents != 1 {
		t.Fatalf("terminal turn recovery event count = %d, want 1", terminalEvents)
	}
}
