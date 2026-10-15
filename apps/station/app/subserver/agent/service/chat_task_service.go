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
//   multi-node recovery excludes healthy foreign owners and uses expiry-driven
//   takeover without changing this contract.

package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
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
	chatLeaseTTL              = 5 * time.Minute
	chatLeaseRecoveryInterval = 5 * time.Second
)

type ChatTaskExecutorIdentity struct {
	NodeID      string
	Incarnation string
}

type ChatStepLeaseAuthority struct {
	StepID       string
	LeaseID      string
	FencingToken uint64
}

// ChatTaskService owns the Chat-surface root task lifecycle on Station.
type ChatTaskService struct {
	eventWriter     *TaskEventWriter
	executorID      string
	nodeID          string
	nodeIncarnation string
}

func NewChatTaskExecutorIdentity(nodeID string) ChatTaskExecutorIdentity {
	return ChatTaskExecutorIdentity{
		NodeID:      strings.TrimSpace(nodeID),
		Incarnation: generateID("incarnation"),
	}
}

// NewChatTaskService builds one process-incarnation owner. Production injects
// the libp2p node PeerID; tests may inject deterministic identities.
func NewChatTaskService(
	eventBus domain.EventBus,
	identities ...ChatTaskExecutorIdentity,
) *ChatTaskService {
	identity := ChatTaskExecutorIdentity{}
	if len(identities) > 0 {
		identity = identities[0]
	}
	identity.NodeID = strings.TrimSpace(identity.NodeID)
	identity.Incarnation = strings.TrimSpace(identity.Incarnation)
	if identity.NodeID == "" {
		identity.NodeID = generateID("station_node")
	}
	if identity.Incarnation == "" {
		identity.Incarnation = generateID("incarnation")
	}
	return &ChatTaskService{
		eventWriter:     NewTaskEventWriter(eventBus),
		executorID:      identity.NodeID + "/" + identity.Incarnation,
		nodeID:          identity.NodeID,
		nodeIncarnation: identity.Incarnation,
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
func (s *ChatTaskService) BeginChatStep(
	ctx context.Context,
	taskID,
	agentID,
	description string,
) (*ChatStepLeaseAuthority, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task_id is required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	now, err := executorLeaseDatabaseNow(db.WithContext(ctx))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to read executor lease clock", err)
	}
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
		LeaseID:          generateID("lease"),
		TaskID:           taskID,
		StepID:           step.StepID,
		ExecutorID:       s.executorID,
		ExecutorKind:     int32(model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED),
		OwnerNodeID:      s.nodeID,
		OwnerIncarnation: s.nodeIncarnation,
		FencingToken:     1,
		Status:           executorLeaseStatusActive,
		AcquiredAt:       now,
		HeartbeatAt:      now,
		ExpiresAt:        now.Add(chatLeaseTTL),
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
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to begin chat step", err)
	}

	s.eventWriter.Publish(ctx, agentID, string(domain.EventTypeCollaborationNodeRunning), map[string]interface{}{
		"task_id":  taskID,
		"step_id":  step.StepID,
		"agent_id": agentID,
	}, taskID, step.StepID, "", nil)

	return &ChatStepLeaseAuthority{
		StepID:       step.StepID,
		LeaseID:      lease.LeaseID,
		FencingToken: lease.FencingToken,
	}, nil
}

// BindChatStepToTurn records the durable Turn identity while a Chat step is
// waiting for a client capability result. The step remains RUNNING until the
// continuation worker reaches a terminal Turn state.
func (s *ChatTaskService) BindChatStepToTurn(
	ctx context.Context,
	taskID,
	stepID,
	turnID,
	leaseID string,
	fencingToken uint64,
) error {
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
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		lease, now, err := s.requireOwnedActiveLeaseTx(
			tx,
			taskID,
			stepID,
			leaseID,
			fencingToken,
		)
		if err != nil {
			return err
		}
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
		return renewCurrentExecutorLeaseTx(tx, lease, now, chatLeaseTTL)
	})
}

func (s *ChatTaskService) RenewChatStepLease(
	ctx context.Context,
	taskID string,
	stepID string,
	leaseID string,
	fencingToken uint64,
) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		lease, now, err := s.requireOwnedActiveLeaseTx(
			tx,
			strings.TrimSpace(taskID),
			strings.TrimSpace(stepID),
			leaseID,
			fencingToken,
		)
		if err != nil {
			return err
		}
		return renewCurrentExecutorLeaseTx(
			tx,
			lease,
			now,
			chatLeaseTTL,
		)
	})
}

func (s *ChatTaskService) MaintainChatStepLease(
	ctx context.Context,
	taskID string,
	stepID string,
	leaseID string,
	fencingToken uint64,
) (context.Context, func()) {
	return maintainChatStepLease(
		ctx,
		chatLeaseTTL/3,
		func(renewContext context.Context) error {
			return s.RenewChatStepLease(
				renewContext,
				taskID,
				stepID,
				leaseID,
				fencingToken,
			)
		},
	)
}

func maintainChatStepLease(
	ctx context.Context,
	renewInterval time.Duration,
	renew func(context.Context) error,
) (context.Context, func()) {
	leaseContext, cancelLease := context.WithCancelCause(ctx)
	stop := make(chan struct{})
	done := make(chan struct{})
	var stopOnce sync.Once
	go func() {
		defer close(done)
		ticker := time.NewTicker(renewInterval)
		defer ticker.Stop()
		for {
			select {
			case <-leaseContext.Done():
				return
			case <-stop:
				return
			case <-ticker.C:
				if err := renew(leaseContext); err != nil {
					cancelLease(fmt.Errorf(
						"chat executor lease renewal failed: %w",
						err,
					))
					return
				}
			}
		}
	}()
	return leaseContext, func() {
		stopOnce.Do(func() {
			close(stop)
			<-done
		})
	}
}

// FinishChatStep marks the step COMPLETED, binds its TurnID, writes a recovery
// checkpoint, releases the lease, and emits STEP_COMPLETED + CHECKPOINT_CREATED.
func (s *ChatTaskService) FinishChatStep(
	ctx context.Context,
	taskID,
	stepID,
	turnID,
	resultSummary,
	leaseID string,
	fencingToken uint64,
) error {
	taskID = strings.TrimSpace(taskID)
	stepID = strings.TrimSpace(stepID)
	if taskID == "" || stepID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task_id and step_id are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	checkpoint := persistence.TaskCheckpoint{
		CheckpointID: generateID("ckpt"),
		TaskID:       taskID,
	}
	transitioned := false
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		step, err := lockChatStepTx(tx, taskID, stepID)
		if err != nil {
			return err
		}
		if step.Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED) {
			return nil
		}
		if step.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "chat step is already terminal", nil)
		}
		lease, now, err := s.requireOwnedActiveLeaseTx(
			tx,
			taskID,
			stepID,
			leaseID,
			fencingToken,
		)
		if err != nil {
			return err
		}
		transitioned = true
		checkpoint.CreatedAt = now
		if err := tx.Model(step).
			Updates(map[string]interface{}{
				"status":         int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
				"turn_id":        strings.TrimSpace(turnID),
				"result_summary": strings.TrimSpace(resultSummary),
				"ended_at":       now,
			}).Error; err != nil {
			return err
		}
		if err := s.releaseLeaseTx(tx, lease, now); err != nil {
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
func (s *ChatTaskService) FailChatStep(
	ctx context.Context,
	taskID,
	stepID,
	reason,
	leaseID string,
	fencingToken uint64,
) error {
	taskID = strings.TrimSpace(taskID)
	stepID = strings.TrimSpace(stepID)
	if taskID == "" || stepID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task_id and step_id are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	transitioned := false
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		step, err := lockChatStepTx(tx, taskID, stepID)
		if err != nil {
			return err
		}
		if step.Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED) {
			return nil
		}
		if step.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "chat step is already terminal", nil)
		}
		lease, now, err := s.requireOwnedActiveLeaseTx(
			tx,
			taskID,
			stepID,
			leaseID,
			fencingToken,
		)
		if err != nil {
			return err
		}
		transitioned = true
		if err := tx.Model(step).
			Updates(map[string]interface{}{
				"status":         int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED),
				"result_summary": strings.TrimSpace(reason),
				"ended_at":       now,
			}).Error; err != nil {
			return err
		}
		return s.releaseLeaseTx(tx, lease, now)
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

// RecoverRunningChatTasks preserves healthy foreign work and claims only an
// expired owner. Durable continuations remain RUNNING under the new fence;
// direct-model work is interrupted atomically and is never provider-replayed.
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

	logger.Infof(ctx, "chat task recovery: inspecting %d running steps", len(steps))
	for i := range steps {
		if err := s.recoverRunningChatStep(ctx, db, &steps[i]); err != nil {
			return fmt.Errorf("recover running chat step %s: %w", steps[i].StepID, err)
		}
	}

	return nil
}

func (s *ChatTaskService) RunRecoveryWorker(ctx context.Context) {
	ticker := time.NewTicker(chatLeaseRecoveryInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.RecoverRunningChatTasks(ctx); err != nil {
				logger.Errorf(ctx, "chat task recovery sweep failed: %v", err)
			}
		}
	}
}

func (s *ChatTaskService) recoverRunningChatStep(
	ctx context.Context,
	db *gorm.DB,
	step *persistence.ExecutionStep,
) error {
	var lease *persistence.ExecutorLease
	var claimed bool
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		lease, claimed, err = s.claimChatStepLeaseTx(tx, step.TaskID, step.StepID)
		return err
	}); err != nil || !claimed {
		return err
	}

	var recoverableCount int64
	if err := db.WithContext(ctx).Table("agent_tool_batches AS batch").
		Joins("LEFT JOIN agent_tool_continuations AS continuation ON continuation.tool_batch_id = batch.id").
		Where(
			"batch.step_id = ? AND (batch.status = ? OR continuation.status IN ?)",
			step.StepID,
			persistence.ToolBatchStatusOpen,
			[]string{
				persistence.ToolContinuationStatusReady,
				persistence.ToolContinuationStatusClaimed,
				persistence.ToolContinuationStatusReconciliationRequired,
			},
		).
		Count(&recoverableCount).Error; err != nil {
		return fmt.Errorf("inspect durable continuation: %w", err)
	}
	if recoverableCount > 0 {
		return nil
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return s.settleInterruptedChatStepTx(ctx, tx, step, lease)
	})
}

func (s *ChatTaskService) settleInterruptedChatStepTx(
	ctx context.Context,
	tx *gorm.DB,
	step *persistence.ExecutionStep,
	lease *persistence.ExecutorLease,
) error {
	const reason = "station_restart_interrupted"

	now, err := executorLeaseDatabaseNow(tx)
	if err != nil {
		return err
	}
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
	currentLease, leaseNow, err := s.requireOwnedActiveLeaseTx(
		tx,
		step.TaskID,
		step.StepID,
		lease.LeaseID,
		lease.FencingToken,
	)
	if err != nil {
		return err
	}
	if currentLease.LeaseID != lease.LeaseID ||
		currentLease.FencingToken != lease.FencingToken {
		return staleChatLeaseError()
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
	if err := s.releaseLeaseTx(tx, currentLease, leaseNow); err != nil {
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
}

func lockChatStepTx(
	tx *gorm.DB,
	taskID string,
	stepID string,
) (*persistence.ExecutionStep, error) {
	var step persistence.ExecutionStep
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("step_id = ? AND task_id = ?", stepID, taskID).
		First(&step).Error; err != nil {
		return nil, err
	}
	return &step, nil
}

func (s *ChatTaskService) claimChatStepLeaseTx(
	tx *gorm.DB,
	taskID string,
	stepID string,
) (*persistence.ExecutorLease, bool, error) {
	step, err := lockChatStepTx(tx, taskID, stepID)
	if err != nil {
		return nil, false, err
	}
	if step.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
		return nil, false, nil
	}
	now, err := executorLeaseDatabaseNow(tx)
	if err != nil {
		return nil, false, err
	}

	var leases []persistence.ExecutorLease
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("task_id = ? AND step_id = ?", taskID, stepID).
		Order("fencing_token DESC, acquired_at DESC").
		Find(&leases).Error; err != nil {
		return nil, false, err
	}
	var maxToken uint64
	for index := range leases {
		lease := &leases[index]
		if lease.FencingToken > maxToken {
			maxToken = lease.FencingToken
		}
		if lease.Status != executorLeaseStatusActive {
			continue
		}
		healthy := lease.FencingToken > 0 &&
			strings.TrimSpace(lease.OwnerNodeID) != "" &&
			strings.TrimSpace(lease.OwnerIncarnation) != "" &&
			lease.ExpiresAt.After(now)
		if healthy {
			return nil, false, nil
		}
		if err := expireExecutorLeaseTx(tx, lease, now); err != nil {
			return nil, false, err
		}
	}
	if maxToken == ^uint64(0) {
		return nil, false, fmt.Errorf("executor lease fencing token exhausted")
	}
	lease := &persistence.ExecutorLease{
		LeaseID:          generateID("lease"),
		TaskID:           taskID,
		StepID:           stepID,
		ExecutorID:       s.executorID,
		ExecutorKind:     int32(model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED),
		OwnerNodeID:      s.nodeID,
		OwnerIncarnation: s.nodeIncarnation,
		FencingToken:     maxToken + 1,
		Status:           executorLeaseStatusActive,
		AcquiredAt:       now,
		HeartbeatAt:      now,
		ExpiresAt:        now.Add(chatLeaseTTL),
	}
	if err := tx.Create(lease).Error; err != nil {
		return nil, false, err
	}
	return lease, true, nil
}

func (s *ChatTaskService) requireOwnedActiveLeaseTx(
	tx *gorm.DB,
	taskID string,
	stepID string,
	leaseID string,
	fencingToken uint64,
) (*persistence.ExecutorLease, time.Time, error) {
	leaseID = strings.TrimSpace(leaseID)
	if leaseID == "" || fencingToken == 0 {
		return nil, time.Time{}, staleChatLeaseError()
	}
	if _, err := lockChatStepTx(tx, taskID, stepID); err != nil {
		return nil, time.Time{}, err
	}
	now, err := executorLeaseDatabaseNow(tx)
	if err != nil {
		return nil, time.Time{}, err
	}
	var lease persistence.ExecutorLease
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"lease_id = ? AND task_id = ? AND step_id = ? AND owner_node_id = ? AND owner_incarnation = ? AND executor_id = ? AND fencing_token = ? AND status = ?",
			leaseID,
			taskID,
			stepID,
			s.nodeID,
			s.nodeIncarnation,
			s.executorID,
			fencingToken,
			executorLeaseStatusActive,
		).
		First(&lease).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, time.Time{}, staleChatLeaseError()
		}
		return nil, time.Time{}, err
	}
	if err := s.assertOwnedActiveLeaseTx(tx, &lease, now); err != nil {
		return nil, time.Time{}, err
	}
	return &lease, now, nil
}

func (s *ChatTaskService) LoadOwnedChatStepLeaseAuthority(
	ctx context.Context,
	taskID string,
	stepID string,
) (*ChatStepLeaseAuthority, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var authority *ChatStepLeaseAuthority
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := lockChatStepTx(tx, taskID, stepID); err != nil {
			return err
		}
		now, err := executorLeaseDatabaseNow(tx)
		if err != nil {
			return err
		}
		var lease persistence.ExecutorLease
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"task_id = ? AND step_id = ? AND owner_node_id = ? AND owner_incarnation = ? AND executor_id = ? AND status = ?",
				taskID,
				stepID,
				s.nodeID,
				s.nodeIncarnation,
				s.executorID,
				executorLeaseStatusActive,
			).
			Order("fencing_token DESC").
			First(&lease).Error; err != nil {
			return err
		}
		if err := s.assertOwnedActiveLeaseTx(tx, &lease, now); err != nil {
			return err
		}
		authority = &ChatStepLeaseAuthority{
			StepID:       stepID,
			LeaseID:      lease.LeaseID,
			FencingToken: lease.FencingToken,
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return authority, nil
}

func fenceCurrentChatStepLeaseTx(
	tx *gorm.DB,
	taskID string,
	stepID string,
) (time.Time, error) {
	if _, err := lockChatStepTx(tx, taskID, stepID); err != nil {
		return time.Time{}, err
	}
	now, err := executorLeaseDatabaseNow(tx)
	if err != nil {
		return time.Time{}, err
	}
	var lease persistence.ExecutorLease
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"task_id = ? AND step_id = ? AND status = ?",
			taskID,
			stepID,
			executorLeaseStatusActive,
		).
		Order("fencing_token DESC").
		First(&lease).Error; err != nil {
		return time.Time{}, err
	}
	result := tx.Model(&persistence.ExecutorLease{}).
		Where(
			"lease_id = ? AND fencing_token = ? AND status = ?",
			lease.LeaseID,
			lease.FencingToken,
			executorLeaseStatusActive,
		).
		Updates(map[string]interface{}{
			"status":       executorLeaseStatusReleased,
			"heartbeat_at": now,
		})
	if result.Error != nil {
		return time.Time{}, result.Error
	}
	if result.RowsAffected != 1 {
		return time.Time{}, staleChatLeaseError()
	}
	return now, nil
}

func (s *ChatTaskService) assertOwnedActiveLeaseTx(
	tx *gorm.DB,
	lease *persistence.ExecutorLease,
	now time.Time,
) error {
	if lease == nil ||
		lease.OwnerNodeID != s.nodeID ||
		lease.OwnerIncarnation != s.nodeIncarnation ||
		lease.ExecutorID != s.executorID {
		return staleChatLeaseError()
	}
	return assertCurrentExecutorLeaseTx(tx, lease, now)
}

func (s *ChatTaskService) releaseLeaseTx(
	tx *gorm.DB,
	lease *persistence.ExecutorLease,
	now time.Time,
) error {
	if err := s.assertOwnedActiveLeaseTx(tx, lease, now); err != nil {
		return err
	}
	return releaseCurrentExecutorLeaseTx(tx, lease, now)
}

func staleChatLeaseError() error {
	return errcode.New(
		errcode.AgentVersionConflict,
		http.StatusConflict,
		"chat executor lease is stale",
		nil,
	)
}
