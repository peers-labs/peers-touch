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
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"google.golang.org/protobuf/encoding/protojson"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
		ConversationID: persistence.NullableConversationID(conversationID),
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

// BindChatStepToTurn records the durable Turn identity while a Chat step is
// waiting for a client capability result. The step remains RUNNING until the
// continuation worker reaches a terminal Turn state.
func (s *ChatTaskService) BindChatStepToTurn(ctx context.Context, taskID, stepID, turnID string) error {
	taskID = strings.TrimSpace(taskID)
	stepID = strings.TrimSpace(stepID)
	turnID = strings.TrimSpace(turnID)
	if taskID == "" || stepID == "" || turnID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task_id, step_id, and turn_id are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&persistence.ExecutionStep{}).
			Where(
				"task_id = ? AND step_id = ? AND status = ?",
				taskID,
				stepID,
				int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			).
			Update("turn_id", turnID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "chat step is no longer running", nil)
		}
		return tx.Model(&persistence.ExecutorLease{}).
			Where("step_id = ? AND status = ?", stepID, chatLeaseStatusActive).
			Updates(map[string]interface{}{
				"heartbeat_at": now,
				"expires_at":   now.Add(chatLeaseTTL),
			}).Error
	})
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
	transitioned := false
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var step persistence.ExecutionStep
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("step_id = ? AND task_id = ?", stepID, taskID).
			First(&step).Error; err != nil {
			return err
		}
		if step.Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED) {
			return nil
		}
		if step.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "chat step is already terminal", nil)
		}
		transitioned = true
		if err := tx.Model(&step).
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
	if !transitioned {
		return nil
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
	transitioned := false
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var step persistence.ExecutionStep
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("step_id = ? AND task_id = ?", stepID, taskID).
			First(&step).Error; err != nil {
			return err
		}
		if step.Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED) {
			return nil
		}
		if step.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "chat step is already terminal", nil)
		}
		transitioned = true
		if err := tx.Model(&step).
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
	if !transitioned {
		return nil
	}

	s.eventWriter.Publish(ctx, "", string(domain.EventTypeCollaborationNodeFailed), map[string]interface{}{
		"task_id": taskID,
		"step_id": stepID,
		"reason":  reason,
	}, taskID, stepID, "", nil)

	return nil
}

// RecoverRunningChatTasks settles Chat steps left RUNNING by a previous process.
// A step with durable tool continuation remains RUNNING for its recovery worker.
// Plain direct-model work is interrupted atomically across its Turn, attempt,
// step, lease, and replayable terminal events; it is never provider-replayed.
func (s *ChatTaskService) RecoverRunningChatTasks(ctx context.Context) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return fmt.Errorf("open chat task recovery database: %w", err)
	}

	var steps []persistence.ExecutionStep
	if err := db.WithContext(ctx).Table("agent_execution_steps AS step").
		Select("step.*").
		Joins("JOIN agent_task_runs AS task ON task.task_id = step.task_id").
		Where(
			"step.status = ? AND task.surface = ?",
			int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			int32(model.TaskSurface_TASK_SURFACE_CHAT),
		).
		Find(&steps).Error; err != nil {
		return fmt.Errorf("list running chat steps for recovery: %w", err)
	}
	if len(steps) == 0 {
		return nil
	}

	logger.Warnf(ctx, "chat task recovery: reclaiming %d interrupted steps", len(steps))
	for i := range steps {
		var recoverableCount int64
		if err := db.WithContext(ctx).
			Table("agent_tool_batches AS batch").
			Joins("LEFT JOIN agent_tool_continuations AS continuation ON continuation.tool_batch_id = batch.id").
			Where(
				"batch.step_id = ? AND (batch.status = ? OR continuation.status IN ?)",
				steps[i].StepID,
				persistence.ToolBatchStatusOpen,
				[]string{
					persistence.ToolContinuationStatusReady,
					persistence.ToolContinuationStatusClaimed,
					persistence.ToolContinuationStatusReconciliationRequired,
				},
			).
			Count(&recoverableCount).Error; err != nil {
			return fmt.Errorf(
				"inspect durable continuation for chat step %s: %w",
				steps[i].StepID,
				err,
			)
		}
		if recoverableCount > 0 {
			continue
		}
		if err := s.settleInterruptedChatStep(ctx, db, &steps[i]); err != nil {
			return fmt.Errorf("settle interrupted chat step %s: %w", steps[i].StepID, err)
		}
	}

	return nil
}

func (s *ChatTaskService) settleInterruptedChatStep(
	ctx context.Context,
	db *gorm.DB,
	step *persistence.ExecutionStep,
) error {
	const reason = "station_restart_interrupted"

	now := time.Now().UTC()
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var task persistence.TaskRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"task_id = ? AND surface = ?",
				step.TaskID,
				int32(model.TaskSurface_TASK_SURFACE_CHAT),
			).
			First(&task).Error; err != nil {
			return err
		}
		var conversation persistence.Conversation
		if err := tx.Where(
			"id = ? AND actor_ptid = ?",
			task.ConversationID,
			task.OwnerActorPTID,
		).First(&conversation).Error; err != nil {
			return fmt.Errorf("load actor-owned chat conversation: %w", err)
		}

		turnID := strings.TrimSpace(step.TurnID)
		if turnID == "" {
			var candidates []persistence.AgentTurn
			if err := tx.Where(
				"conversation_id = ? AND agent_id = ? AND status = ?",
				task.ConversationID,
				step.AgentID,
				string(domain.TurnStatusRunning),
			).Order("started_at DESC").Limit(2).Find(&candidates).Error; err != nil {
				return err
			}
			if len(candidates) != 1 {
				return fmt.Errorf(
					"running chat step has no unambiguous turn: task_id=%s candidates=%d",
					step.TaskID,
					len(candidates),
				)
			}
			turnID = candidates[0].ID
		}

		var turn persistence.AgentTurn
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"id = ? AND conversation_id = ? AND agent_id = ?",
				turnID,
				task.ConversationID,
				step.AgentID,
			).
			First(&turn).Error; err != nil {
			return err
		}

		var attempt persistence.TurnAttempt
		attemptErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("turn_id = ? AND ended_at IS NULL", turn.ID).
			Order("attempt_index DESC").
			First(&attempt).Error
		if attemptErr != nil && attemptErr != gorm.ErrRecordNotFound {
			return attemptErr
		}
		if attemptErr == gorm.ErrRecordNotFound {
			latestErr := tx.Where("turn_id = ?", turn.ID).
				Order("attempt_index DESC").
				First(&attempt).Error
			if latestErr != nil && latestErr != gorm.ErrRecordNotFound {
				return latestErr
			}
			if latestErr == gorm.ErrRecordNotFound {
				attempt = persistence.TurnAttempt{
					ID:           generateID("attempt"),
					TurnID:       turn.ID,
					AttemptIndex: 1,
					Status:       string(domain.TurnStatusRunning),
					StartedAt:    turn.StartedAt,
				}
				if err := tx.Create(&attempt).Error; err != nil {
					return err
				}
			}
		}
		terminalStatus := domain.TurnStatus(turn.Status)
		reasonCode := strings.TrimSpace(turn.TerminalReason)
		eventType := "error"
		stepStatus := model.TaskNodeStatus_TASK_NODE_STATUS_FAILED
		taskEventType := string(domain.EventTypeCollaborationNodeFailed)
		messageStatus := string(domain.TurnStatusInterrupted)
		resultSummary := reason
		if terminalStatus == domain.TurnStatusRunning ||
			terminalStatus == domain.TurnStatusWaitingLocalTool {
			terminalStatus = domain.TurnStatusInterrupted
			reasonCode = reason
			if err := tx.Model(&turn).
				Where("status IN ?", []string{
					string(domain.TurnStatusRunning),
					string(domain.TurnStatusWaitingLocalTool),
				}).
				Updates(map[string]interface{}{
					"status":          string(domain.TurnStatusInterrupted),
					"terminal_reason": reason,
					"ended_at":        now,
				}).Error; err != nil {
				return err
			}
		} else {
			switch terminalStatus {
			case domain.TurnStatusCompleted:
				eventType = "done"
				stepStatus = model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED
				taskEventType = string(domain.EventTypeCollaborationNodeCompleted)
				messageStatus = "completed"
				resultSummary = stringValue(turn.FinalResponse)
			case domain.TurnStatusCancelled:
				eventType = "cancelled"
				messageStatus = string(domain.TurnStatusCancelled)
			case domain.TurnStatusFailed:
				messageStatus = string(domain.TurnStatusFailed)
			case domain.TurnStatusInterrupted:
			default:
				return nil
			}
			if reasonCode == "" {
				reasonCode = string(terminalStatus)
			}
		}
		var outcomeErrorJSON json.RawMessage
		if terminalStatus == domain.TurnStatusInterrupted {
			encodedOutcomeError, err := (protojson.MarshalOptions{
				UseProtoNames:   true,
				EmitUnpopulated: true,
			}).Marshal(errcode.NewLifecycleInterruptedPayload(turn.ID, reasonCode))
			if err != nil {
				return err
			}
			outcomeErrorJSON = encodedOutcomeError
		}
		if attempt.EndedAt == nil {
			if err := tx.Model(&attempt).
				Where("ended_at IS NULL").
				Updates(map[string]interface{}{
					"status":     string(terminalStatus),
					"error_code": reasonCode,
					"ended_at":   now,
				}).Error; err != nil {
				return err
			}
		}
		messageUpdates := map[string]interface{}{
			"status":     messageStatus,
			"updated_at": now,
		}
		if len(outcomeErrorJSON) > 0 {
			messageUpdates["error_json"] = outcomeErrorJSON
		}
		messageResult := tx.Model(&persistence.AgentMessage{}).
			Where("turn_id = ? AND role = ? AND status = ?", turn.ID, string(domain.MessageRoleAssistant), "pending").
			Updates(messageUpdates)
		if messageResult.Error != nil {
			return messageResult.Error
		}
		if messageResult.RowsAffected == 0 &&
			terminalStatus == domain.TurnStatusInterrupted {
			var assistantMessageCount int64
			if err := tx.Model(&persistence.AgentMessage{}).
				Where(
					"turn_id = ? AND role = ?",
					turn.ID,
					string(domain.MessageRoleAssistant),
				).
				Count(&assistantMessageCount).Error; err != nil {
				return err
			}
			var admittedUserMessageCount int64
			if assistantMessageCount == 0 {
				if err := tx.Model(&persistence.AgentMessage{}).
					Where(
						"turn_id = ? AND role = ?",
						turn.ID,
						string(domain.MessageRoleUser),
					).
					Count(&admittedUserMessageCount).Error; err != nil {
					return err
				}
			}
			if assistantMessageCount == 0 && admittedUserMessageCount > 0 {
				var maxSeq struct{ MaxSeq int64 }
				if err := tx.Model(&persistence.AgentMessage{}).
					Where("conversation_id = ?", turn.ConversationID).
					Select("COALESCE(MAX(seq), 0) AS max_seq").
					Scan(&maxSeq).Error; err != nil {
					return err
				}
				content := ""
				messageID := generateID("msg")
				if err := tx.Create(&persistence.AgentMessage{
					ID:              messageID,
					ConversationID:  turn.ConversationID,
					TurnID:          &turn.ID,
					Role:            string(domain.MessageRoleAssistant),
					Status:          string(domain.TurnStatusInterrupted),
					Content:         &content,
					ErrorJSON:       outcomeErrorJSON,
					Seq:             maxSeq.MaxSeq + 1,
					ParentMessageID: optionalString(conversation.ActiveBranchMessageID),
					CreatedAt:       now,
					UpdatedAt:       now,
				}).Error; err != nil {
					return err
				}
				if err := tx.Model(&conversation).Updates(map[string]interface{}{
					"active_branch_message_id": messageID,
					"updated_at":               now,
					"version":                  gorm.Expr("version + 1"),
				}).Error; err != nil {
					return err
				}
			}
		}
		if err := tx.Model(&persistence.ExecutionStep{}).
			Where(
				"step_id = ? AND task_id = ? AND status = ?",
				step.StepID,
				step.TaskID,
				int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			).
			Updates(map[string]interface{}{
				"turn_id":        turn.ID,
				"status":         int32(stepStatus),
				"result_summary": resultSummary,
				"ended_at":       now,
			}).Error; err != nil {
			return err
		}
		if err := s.releaseLeaseTx(tx, step.StepID, now); err != nil {
			return err
		}

		var terminalEventCount int64
		if err := tx.Model(&persistence.TurnEvent{}).
			Where(
				"turn_id = ? AND attempt_id = ? AND event_type IN ?",
				turn.ID,
				attempt.ID,
				[]string{"done", "error", "cancelled"},
			).
			Count(&terminalEventCount).Error; err != nil {
			return err
		}
		if terminalEventCount == 0 {
			var maxSequence struct{ MaxSequence int64 }
			if err := tx.Model(&persistence.TurnEvent{}).
				Where("turn_id = ?", turn.ID).
				Select("COALESCE(MAX(event_seq), 0) AS max_sequence").
				Scan(&maxSequence).Error; err != nil {
				return err
			}
			eventPayload, err := json.Marshal(TurnEvent{
				Type:           eventType,
				TurnID:         turn.ID,
				AttemptID:      attempt.ID,
				ConversationID: turn.ConversationID,
				AgentID:        turn.AgentID,
				Stage:          reasonCode,
				Error:          reasonCode,
				OutcomeError:   outcomeErrorJSON,
			})
			if err != nil {
				return err
			}
			if err := tx.Create(&persistence.TurnEvent{
				ID:             generateID("tevt"),
				ConversationID: turn.ConversationID,
				TurnID:         turn.ID,
				AttemptID:      attempt.ID,
				EventSeq:       maxSequence.MaxSequence + 1,
				EventType:      eventType,
				Payload:        string(eventPayload),
				CreatedAt:      now,
			}).Error; err != nil {
				return err
			}
		}
		var taskEventCount int64
		if err := tx.Model(&persistence.TaskEvent{}).
			Where(
				"task_id = ? AND step_id = ? AND turn_id = ? AND event_type = ?",
				step.TaskID,
				step.StepID,
				turn.ID,
				int32(taskEventTypeForDomainEvent(taskEventType)),
			).
			Count(&taskEventCount).Error; err != nil {
			return err
		}
		if taskEventCount == 0 {
			_, err := s.eventWriter.appendTx(
				ctx,
				tx,
				"",
				step.TaskID,
				step.StepID,
				turn.ID,
				taskEventType,
				map[string]interface{}{
					"task_id": step.TaskID,
					"step_id": step.StepID,
					"turn_id": turn.ID,
					"reason":  reasonCode,
				},
			)
			return err
		}
		return nil
	})
}

func (s *ChatTaskService) releaseLeaseTx(tx *gorm.DB, stepID string, now time.Time) error {
	return tx.Model(&persistence.ExecutorLease{}).
		Where("step_id = ? AND status = ?", stepID, chatLeaseStatusActive).
		Updates(map[string]interface{}{
			"status":       chatLeaseStatusReleased,
			"heartbeat_at": now,
		}).Error
}
