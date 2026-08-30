// Change-log:
// 2026-06-30 — ChatTaskService: makes Station the owner of the Chat surface as a
//   long-lived root task. Each Chat conversation maps to exactly one TaskRun
//   (surface=CHAT) found-or-created by ConversationID. Each user message becomes
//   one ExecutionStep bound to a single TurnID, fenced by an ExecutorLease and
//   anchored by a TaskCheckpoint. The durable outbox (via TaskEventWriter) is the
//   replayable source of truth so a Desktop/Mobile/Web client that drops or
//   reconnects can resume by cursor — the task no longer dies with the client.
//
//   Recovery contract (§10.3): an LLM turn is non-idempotent, so an interrupted
//   turn is NEVER replayed. On Station restart every in-flight Chat step is
//   surfaced as FAILED (interrupted) at its step boundary; the user may resend,
//   which creates a fresh step/turn. Lease fencing records who owns a step so a
//   future multi-instance deployment can replace one-shot reclaim with an
//   expiry-driven sweep without changing this contract.

package service

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

const (
	chatLeaseStatusActive   = "active"
	chatLeaseStatusReleased = "released"
	chatLeaseTTL            = 5 * time.Minute
)

// ChatTaskService owns the Chat-surface root task lifecycle on Station.
type ChatTaskService struct {
	eventWriter *TaskEventWriter
	executorID  string
}

// NewChatTaskService builds the service with a fresh per-process executor id so
// recovery can recognise leases that belong to a previous (dead) process.
func NewChatTaskService(eventBus domain.EventBus) *ChatTaskService {
	return &ChatTaskService{
		eventWriter: NewTaskEventWriter(eventBus),
		executorID:  generateID("station"),
	}
}

func (s *ChatTaskService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	return db, nil
}

// EnsureChatTask returns the root TaskRun id for a conversation, creating it on
// first use. The unique index on conversation_id guarantees a single root task.
func (s *ChatTaskService) EnsureChatTask(ctx context.Context, actorPTID, agentID, conversationID, title string) (string, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	conversationID = strings.TrimSpace(conversationID)
	if actorPTID == "" || conversationID == "" {
		return "", errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_ptid and conversation_id are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return "", err
	}

	var existing persistence.TaskRun
	err = db.WithContext(ctx).Where("conversation_id = ?", conversationID).First(&existing).Error
	if err == nil {
		return existing.TaskID, nil
	}
	if err != gorm.ErrRecordNotFound {
		return "", errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load chat task", err)
	}

	now := time.Now()
	record := persistence.TaskRun{
		TaskID:         generateID("chat"),
		Title:          strings.TrimSpace(title),
		Surface:        int32(model.TaskSurface_TASK_SURFACE_CHAT),
		Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		OwnerActorPTID: actorPTID,
		ConversationID: conversationID,
		CreatedAt:      now,
		StartedAt:      now,
		UpdatedAt:      now,
	}
	if err := db.WithContext(ctx).Create(&record).Error; err != nil {
		// A concurrent request may have created the task; re-read by conversation.
		var raced persistence.TaskRun
		if reErr := db.WithContext(ctx).Where("conversation_id = ?", conversationID).First(&raced).Error; reErr == nil {
			return raced.TaskID, nil
		}
		return "", errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to create chat task", err)
	}

	s.eventWriter.Publish(ctx, agentID, string(domain.EventTypeCollaborationTaskCreated), map[string]interface{}{
		"task_id":         record.TaskID,
		"conversation_id": conversationID,
		"surface":         int32(model.TaskSurface_TASK_SURFACE_CHAT),
		"status":          record.Status,
	}, record.TaskID, "", "", nil)

	return record.TaskID, nil
}

// BeginChatStep opens a new ExecutionStep for one user message, acquires a
// station-hosted lease, and emits STEP_STARTED. The TurnID is filled in later by
// FinishChatStep once the turn loop has produced it.
func (s *ChatTaskService) BeginChatStep(ctx context.Context, taskID, agentID, description string) (string, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return "", errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task_id is required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return "", err
	}

	now := time.Now()
	step := persistence.ExecutionStep{
		StepID:            generateID("step"),
		TaskID:            taskID,
		AgentID:           strings.TrimSpace(agentID),
		Description:       strings.TrimSpace(description),
		Status:            int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		Attempt:           1,
		EligibleExecutors: model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED.String(),
		StartedAt:         now,
	}
	lease := persistence.ExecutorLease{
		LeaseID:      generateID("lease"),
		TaskID:       taskID,
		StepID:       step.StepID,
		ExecutorID:   s.executorID,
		ExecutorKind: int32(model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED),
		Status:       chatLeaseStatusActive,
		AcquiredAt:   now,
		HeartbeatAt:  now,
		ExpiresAt:    now.Add(chatLeaseTTL),
	}

	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&step).Error; err != nil {
			return err
		}
		if err := tx.Create(&lease).Error; err != nil {
			return err
		}
		return tx.Model(&persistence.TaskRun{}).Where("task_id = ?", taskID).
			Updates(map[string]interface{}{
				"status":     int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
				"updated_at": now,
			}).Error
	}); err != nil {
		return "", errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to begin chat step", err)
	}

	s.eventWriter.Publish(ctx, agentID, string(domain.EventTypeCollaborationNodeRunning), map[string]interface{}{
		"task_id":  taskID,
		"step_id":  step.StepID,
		"agent_id": agentID,
	}, taskID, step.StepID, "", nil)

	return step.StepID, nil
}

// FinishChatStep marks the step COMPLETED, binds its TurnID, writes a recovery
// checkpoint, releases the lease, and emits STEP_COMPLETED + CHECKPOINT_CREATED.
func (s *ChatTaskService) FinishChatStep(ctx context.Context, taskID, stepID, turnID, resultSummary string) error {
	taskID = strings.TrimSpace(taskID)
	stepID = strings.TrimSpace(stepID)
	if taskID == "" || stepID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task_id and step_id are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	now := time.Now()
	checkpoint := persistence.TaskCheckpoint{
		CheckpointID: generateID("ckpt"),
		TaskID:       taskID,
		CreatedAt:    now,
	}
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&persistence.ExecutionStep{}).Where("step_id = ?", stepID).
			Updates(map[string]interface{}{
				"status":         int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
				"turn_id":        strings.TrimSpace(turnID),
				"result_summary": strings.TrimSpace(resultSummary),
				"ended_at":       now,
			}).Error; err != nil {
			return err
		}
		if err := s.releaseLeaseTx(tx, stepID, now); err != nil {
			return err
		}
		var last persistence.TaskEvent
		if err := tx.Where("task_id = ?", taskID).Order("event_seq DESC").First(&last).Error; err != nil && err != gorm.ErrRecordNotFound {
			return err
		}
		checkpoint.EventSeq = last.EventSeq
		stateJSON, err := buildChatTaskCheckpointStateJSONTx(tx, taskID, checkpoint.EventSeq)
		if err != nil {
			return err
		}
		checkpoint.StateJSON = stateJSON
		if err := tx.Create(&checkpoint).Error; err != nil {
			return err
		}
		return tx.Model(&persistence.TaskRun{}).Where("task_id = ?", taskID).
			Updates(map[string]interface{}{
				"root_turn_id":          strings.TrimSpace(turnID),
				"current_checkpoint_id": checkpoint.CheckpointID,
				"updated_at":            now,
			}).Error
	}); err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to finish chat step", err)
	}

	s.eventWriter.Publish(ctx, "", string(domain.EventTypeCollaborationNodeCompleted), map[string]interface{}{
		"task_id":        taskID,
		"step_id":        stepID,
		"turn_id":        turnID,
		"result_summary": resultSummary,
	}, taskID, stepID, turnID, nil)

	return nil
}

// FailChatStep marks the step FAILED and releases its lease. The interrupted
// turn is never replayed; the user may resend to create a new step.
func (s *ChatTaskService) FailChatStep(ctx context.Context, taskID, stepID, reason string) error {
	taskID = strings.TrimSpace(taskID)
	stepID = strings.TrimSpace(stepID)
	if taskID == "" || stepID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task_id and step_id are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	now := time.Now()
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&persistence.ExecutionStep{}).Where("step_id = ?", stepID).
			Updates(map[string]interface{}{
				"status":         int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED),
				"result_summary": strings.TrimSpace(reason),
				"ended_at":       now,
			}).Error; err != nil {
			return err
		}
		return s.releaseLeaseTx(tx, stepID, now)
	}); err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to fail chat step", err)
	}

	s.eventWriter.Publish(ctx, "", string(domain.EventTypeCollaborationNodeFailed), map[string]interface{}{
		"task_id": taskID,
		"step_id": stepID,
		"reason":  reason,
	}, taskID, stepID, "", nil)

	return nil
}

// RecoverRunningChatTasks reclaims chat steps left RUNNING by a previous process.
// Each is surfaced as FAILED at its step boundary — interrupted turns are never
// replayed (LLM calls are non-idempotent and re-running would double-bill/reply).
func (s *ChatTaskService) RecoverRunningChatTasks(ctx context.Context) {
	db, err := s.getDB(ctx)
	if err != nil {
		logger.Errorf(ctx, "chat task recovery skipped: %v", err)
		return
	}

	var steps []persistence.ExecutionStep
	if err := db.WithContext(ctx).
		Where("status = ?", int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING)).
		Find(&steps).Error; err != nil {
		logger.Errorf(ctx, "chat task recovery query failed: %v", err)
		return
	}
	if len(steps) == 0 {
		return
	}

	logger.Warnf(ctx, "chat task recovery: reclaiming %d interrupted steps", len(steps))
	for i := range steps {
		if err := s.FailChatStep(ctx, steps[i].TaskID, steps[i].StepID, "interrupted by station restart"); err != nil {
			logger.Errorf(ctx, "chat task recovery failed for step_id=%s: %v", steps[i].StepID, err)
		}
	}
}

func (s *ChatTaskService) releaseLeaseTx(tx *gorm.DB, stepID string, now time.Time) error {
	return tx.Model(&persistence.ExecutorLease{}).
		Where("step_id = ? AND status = ?", stepID, chatLeaseStatusActive).
		Updates(map[string]interface{}{
			"status":       chatLeaseStatusReleased,
			"heartbeat_at": now,
		}).Error
}
