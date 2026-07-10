package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
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
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type OrchestrationService struct {
	agentService      *AgentService
	turnService       *TurnService
	toolRegistry      *ToolRegistryService
	eventBus          domain.EventBus
	eventWriter       *TaskEventWriter
	liveResume        *LiveResumeBroker
	directRunProvider directRunProviderExecutor
	recoveryOnce      sync.Once
}

type directRunProviderExecutor interface {
	CallDirectRunProvider(ctx context.Context, req *ProviderCallRequest) (*ProviderCallResponse, error)
}

type providerServiceDirectRunExecutor struct {
	providerService *ProviderService
}

func (e providerServiceDirectRunExecutor) CallDirectRunProvider(ctx context.Context, req *ProviderCallRequest) (*ProviderCallResponse, error) {
	if e.providerService == nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "DirectRun provider runtime is not configured", nil)
	}
	return e.providerService.Call(ctx, req)
}

type collaborationProjectionEvent struct {
	EventType domain.EventType
	Payload   map[string]interface{}
}

type committedTaskEvent struct {
	AgentID   string
	EventType string
	Payload   interface{}
	Record    *persistence.TaskEvent
}

type nodeResultGateDecision struct {
	Blocked bool
	GateID  string
	Summary string
}

type gateRecoveryAction string

const (
	gateRecoveryActionContinue gateRecoveryAction = "continue"
	gateRecoveryActionRerun    gateRecoveryAction = "rerun"
	gateRecoveryActionAccept   gateRecoveryAction = "accept"
	gateRecoveryActionCancel   gateRecoveryAction = "cancel"
)

const (
	collaborationRoleIntegrator = "integrator"
	executorLeaseStatusActive   = "active"
	executorLeaseStatusReleased = "released"
	executorLeaseStatusExpired  = "expired"
	defaultExecutorLeaseTTL     = 45 * time.Second
	maxExecutorLeaseTTL         = 5 * time.Minute
	nodeResultArtifactsMetaKey  = "artifacts_json"
	nodeResultGatesMetaKey      = "gates_json"
)

const (
	collaborationParallelPolicySerialOnly         = "serial_only"
	collaborationParallelPolicyIntegratorRequired = "integrator_required"
	collaborationSupervisorLoopEventBus           = "station_event_bus"
	collaborationReplanPolicyBeforeB10            = "before_b10_from_resume_anchor"
	collaborationResumeAnchorLatestAccepted       = "latest_accepted_checkpoint"
	collaborationSupervisorInterruptReplan        = "supervisor_replan"
	collaborationProviderPlanSourceDirectRun      = "atelier.direct_run.intent"
	directRunHostStorageAttachmentsMetaKey        = "host_storage_attachments_json"
	directRunHostStorageRefPrefix                 = "host-storage://"
)

type directRunInputSnapshot struct {
	ActorID      string                             `json:"actor_id"`
	TaskID       string                             `json:"task_id"`
	Title        string                             `json:"title"`
	Description  string                             `json:"description"`
	WorkspaceID  string                             `json:"workspace_id"`
	ProviderID   string                             `json:"provider_id"`
	ModelIntent  string                             `json:"model_intent"`
	ProviderPlan *model.TaskProviderPlan            `json:"provider_plan"`
	Meta         map[string]string                  `json:"meta"`
	Attachments  []directRunInputSnapshotAttachment `json:"attachments"`
}

type directRunInputSnapshotAttachment struct {
	HostStorageRef string `json:"host_storage_ref"`
	Mime           string `json:"mime"`
	Size           int64  `json:"size"`
	Sha256         string `json:"sha256"`
}

var atelierAgentRoles = map[string]struct{}{
	"goal_owner": {},
	"architect":  {},
	"planner":    {},
	"risk":       {},
	"supervisor": {},
	"executor":   {},
	"verifier":   {},
	"integrator": {},
	"historian":  {},
}

type collaborationSupervisorDecision struct {
	Required           bool
	Reason             string
	Detail             string
	CheckpointID       string
	CheckpointEventSeq int64
	TaskGraphDiff      map[string]interface{}
}

type CollaborationSupervisorSweepResult struct {
	Scanned          int
	Requested        int
	Skipped          int
	RequestedTaskIDs []string
}

func NewOrchestrationService(agentService *AgentService, turnService *TurnService, toolRegistry *ToolRegistryService) *OrchestrationService {
	broker := NewLiveResumeBroker()
	if turnService != nil {
		turnService.SetLiveResumeBroker(broker)
	}
	service := &OrchestrationService{
		agentService: agentService,
		turnService:  turnService,
		toolRegistry: toolRegistry,
		liveResume:   broker,
	}
	if turnService != nil && turnService.providerService != nil {
		service.directRunProvider = providerServiceDirectRunExecutor{providerService: turnService.providerService}
	}
	return service
}

func (s *OrchestrationService) SetEventBus(eventBus domain.EventBus) {
	s.eventBus = eventBus
	s.eventWriter = NewTaskEventWriter(eventBus)
}

func (s *OrchestrationService) CreateCollaborationTask(
	ctx context.Context,
	actorID string,
	req *model.CreateCollaborationTaskRequest,
) (*model.CollaborationTask, []*model.TaskNode, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, nil, err
	}
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil, nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_id is required", nil)
	}
	title := strings.TrimSpace(req.GetTitle())
	if title == "" {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "title is required", nil)
	}
	description := strings.TrimSpace(req.GetDescription())
	meta := copyStringMap(req.GetMeta())
	providerPlan, agentIDs, err := providerPlanFromCreateTaskRequest(req, meta)
	if err != nil {
		return nil, nil, err
	}
	if s.agentService == nil || s.turnService == nil {
		return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "orchestration runtime is not configured", nil)
	}

	now := time.Now()
	engineType := normalizeEngineType(req.GetEngineType())
	synthesizerAgentID := selectSynthesizerAgentID(meta, agentIDs)
	if planSynthesizerAgentID := strings.TrimSpace(providerPlan.GetSynthesizerAgentId()); planSynthesizerAgentID != "" {
		synthesizerAgentID = planSynthesizerAgentID
	}
	providerPlan.SynthesizerAgentId = synthesizerAgentID
	if constraintErr := applyCollaborationPlanConstraints(meta, engineType, providerPlan, req.GetWorkspaceId()); constraintErr != nil {
		return nil, nil, constraintErr
	}
	meta["synthesizer_agent_id"] = synthesizerAgentID
	meta["synthesis_mode"] = "dedicated_node"
	meta["agent_ids"] = mustJSONString(agentIDs)
	meta["provider_plan_source"] = strings.TrimSpace(providerPlan.GetSource())
	metaJSON, _ := json.Marshal(meta)
	taskRecord := persistence.CollaborationTask{
		ID:           generateID("collab"),
		Title:        title,
		Description:  description,
		EngineType:   int32(engineType),
		Status:       int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		GoalOwnerID:  actorID,
		WorkspaceID:  strings.TrimSpace(req.GetWorkspaceId()),
		BudgetTokens: req.GetBudgetTokens(),
		BudgetMoney:  req.GetBudgetMoney(),
		BudgetTimeMs: req.GetBudgetTimeMs(),
		MetaJSON:     string(metaJSON),
		CreatedAt:    now,
		StartedAt:    now,
		EndedAt:      now,
	}

	nodeRecords := buildCollaborationTaskNodes(
		taskRecord.ID,
		description,
		model.CollaborationEngineType(taskRecord.EngineType),
		agentIDs,
		synthesizerAgentID,
		providerPlan,
		now,
	)
	providerPlanRecord, err := taskProviderPlanRecordFromProto(taskRecord.ID, providerPlan, now)
	if err != nil {
		return nil, nil, err
	}
	directRunLifecycle, err := directRunLifecycleRecordsFromProviderPlan(&taskRecord, actorID, providerPlan, meta, now)
	if err != nil {
		return nil, nil, err
	}

	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&taskRecord).Error; err != nil {
			return err
		}
		if err := tx.Create(providerPlanRecord).Error; err != nil {
			return err
		}
		writer := s.eventWriter
		if writer == nil {
			writer = NewTaskEventWriter(s.eventBus)
		}
		if directRunLifecycle != nil {
			if err := tx.Create(directRunLifecycle.Run).Error; err != nil {
				return err
			}
			if err := tx.Create(directRunLifecycle.Task).Error; err != nil {
				return err
			}
			if err := tx.Create(directRunLifecycle.Step).Error; err != nil {
				return err
			}
			if _, err := writer.appendTx(ctx, tx, "", taskRecord.ID, directRunLifecycle.Step.StepID, "", string(domain.EventTypeCollaborationTaskCreated), directRunCreatedEventPayload(directRunLifecycle)); err != nil {
				return err
			}
		} else {
			if _, err := writer.appendTx(ctx, tx, "", taskRecord.ID, "", "", string(domain.EventTypeCollaborationTaskCreated), collaborationTaskCreatedEventPayload(&taskRecord, nodeRecords, providerPlan)); err != nil {
				return err
			}
		}
		return tx.Create(&nodeRecords).Error
	}); err != nil {
		logger.Errorf(ctx, "failed to create collaboration task: actor_id=%s err=%v", actorID, err)
		return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to create collaboration task", err)
	}

	nodes := nodeRecordsToProto(nodeRecords)
	s.publishTaskCreated(ctx, taskRecordToProto(&taskRecord), nodes)
	if directRunLifecycle == nil {
		s.startTaskExecution(actorID, taskRecord, nodeRecords, "create")
	} else {
		s.startDirectRunExecution(actorID, taskRecord.ID, "create")
	}

	return taskRecordToProto(&taskRecord), nodes, nil
}

func (s *OrchestrationService) GetCollaborationTask(ctx context.Context, actorID, taskID string) (*model.CollaborationTask, []*model.TaskNode, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, nil, err
	}
	actorID = strings.TrimSpace(actorID)
	taskID = strings.TrimSpace(taskID)
	if actorID == "" || taskID == "" {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id and task_id are required", nil)
	}
	var task persistence.CollaborationTask
	err = db.WithContext(ctx).Where("id = ? AND goal_owner_id = ?", taskID, actorID).First(&task).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "collaboration task not found", err)
	}
	if err != nil {
		return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get collaboration task", err)
	}
	var nodes []persistence.CollaborationTaskNode
	if err := db.WithContext(ctx).Where("task_id = ?", task.ID).Order("started_at ASC").Find(&nodes).Error; err != nil {
		return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list collaboration task nodes", err)
	}
	return taskRecordToProto(&task), nodeRecordsToProto(nodes), nil
}

func (s *OrchestrationService) ListCollaborationTasks(
	ctx context.Context,
	actorID string,
	req *model.ListCollaborationTasksRequest,
) ([]*model.CollaborationTask, int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil, 0, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_id is required", nil)
	}
	page, pageSize := normalizePage(int(req.GetPage()), int(req.GetPageSize()))
	query := db.WithContext(ctx).Model(&persistence.CollaborationTask{}).Where("goal_owner_id = ?", actorID)
	if req.GetStatus() != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_UNSPECIFIED {
		query = query.Where("status = ?", int32(req.GetStatus()))
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to count collaboration tasks", err)
	}
	var records []persistence.CollaborationTask
	if err := query.Order("created_at DESC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&records).Error; err != nil {
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list collaboration tasks", err)
	}
	tasks := make([]*model.CollaborationTask, 0, len(records))
	for i := range records {
		tasks = append(tasks, taskRecordToProto(&records[i]))
	}
	return tasks, total, nil
}

func (s *OrchestrationService) ListTaskEvents(ctx context.Context, actorID string, req *model.ListTaskEventsRequest) ([]*model.TaskEvent, int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}
	actorID = strings.TrimSpace(actorID)
	taskID := strings.TrimSpace(req.GetTaskId())
	if actorID == "" || taskID == "" {
		return nil, 0, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id and task_id are required", nil)
	}
	var task persistence.CollaborationTask
	err = db.WithContext(ctx).Where("id = ? AND goal_owner_id = ?", taskID, actorID).First(&task).Error
	if err == gorm.ErrRecordNotFound {
		return nil, 0, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "collaboration task not found", err)
	}
	if err != nil {
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get collaboration task", err)
	}
	limit := int(req.GetPageSize())
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var records []persistence.TaskEvent
	if err := db.WithContext(ctx).
		Where("task_id = ? AND event_seq > ?", taskID, req.GetAfterEventSeq()).
		Order("event_seq ASC").
		Limit(limit).
		Find(&records).Error; err != nil {
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list task events", err)
	}
	events := make([]*model.TaskEvent, 0, len(records))
	nextSeq := req.GetAfterEventSeq()
	for i := range records {
		events = append(events, taskEventRecordToProto(&records[i]))
		if records[i].EventSeq > nextSeq {
			nextSeq = records[i].EventSeq
		}
	}
	return events, nextSeq, nil
}

func (s *OrchestrationService) StartTaskRecovery(ctx context.Context) {
	s.recoveryOnce.Do(func() {
		go s.recoverRunningTasks(context.Background())
	})
}

func (s *OrchestrationService) recoverRunningTasks(ctx context.Context) {
	db, err := s.getDB(ctx)
	if err != nil {
		logger.Errorf(ctx, "failed to open db for collaboration recovery: err=%v", err)
		return
	}
	var tasks []persistence.CollaborationTask
	if err := db.WithContext(ctx).
		Where("status = ?", int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING)).
		Order("created_at ASC").
		Find(&tasks).Error; err != nil {
		logger.Errorf(ctx, "failed to list running collaboration tasks for recovery: err=%v", err)
		return
	}
	for i := range tasks {
		task := tasks[i]
		directRunTask, directRunErr := isDirectRunTaskForRecovery(ctx, db, task.ID)
		if directRunErr != nil {
			logger.Errorf(ctx, "failed to inspect DirectRun recovery eligibility: task_id=%s err=%v", task.ID, directRunErr)
			continue
		}
		if directRunTask {
			logger.Infof(ctx, "starting DirectRun recovery outside normal collaboration path: task_id=%s", task.ID)
			s.startDirectRunExecution(task.GoalOwnerID, task.ID, "recovery")
			continue
		}
		var nodes []persistence.CollaborationTaskNode
		if err := db.WithContext(ctx).Where("task_id = ?", task.ID).Order("started_at ASC").Find(&nodes).Error; err != nil {
			logger.Errorf(ctx, "failed to list nodes for collaboration recovery: task_id=%s err=%v", task.ID, err)
			continue
		}
		s.startTaskExecution(task.GoalOwnerID, task, nodes, "recovery")
	}
}

func isDirectRunTaskForRecovery(ctx context.Context, db *gorm.DB, taskID string) (bool, error) {
	if db == nil || strings.TrimSpace(taskID) == "" {
		return false, nil
	}
	var count int64
	if err := db.WithContext(ctx).
		Model(&persistence.DirectRun{}).
		Where("task_id = ? AND source = ?", strings.TrimSpace(taskID), collaborationProviderPlanSourceDirectRun).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *OrchestrationService) startTaskExecution(actorID string, task persistence.CollaborationTask, nodes []persistence.CollaborationTaskNode, reason string) {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return
	}
	taskCopy := task
	nodeCopies := append([]persistence.CollaborationTaskNode(nil), nodes...)
	go func() {
		ctx := context.Background()
		logger.Infof(ctx, "starting collaboration task execution: task_id=%s actor_id=%s reason=%s", taskCopy.ID, actorID, reason)
		s.executeTaskNodes(ctx, actorID, &taskCopy, nodeCopies)
	}()
}

func (s *OrchestrationService) startDirectRunExecution(actorID string, taskID string, reason string) {
	actorID = strings.TrimSpace(actorID)
	taskID = strings.TrimSpace(taskID)
	if actorID == "" || taskID == "" {
		return
	}
	go func() {
		ctx := context.Background()
		if err := s.executePendingDirectRun(ctx, actorID, taskID, reason); err != nil {
			logger.Errorf(ctx, "DirectRun execution failed: task_id=%s actor_id=%s reason=%s err=%v", taskID, actorID, reason, err)
		}
	}()
}

type directRunRuntimeSnapshot struct {
	Task    persistence.CollaborationTask
	Run     persistence.DirectRun
	TaskRun persistence.TaskRun
	Step    persistence.ExecutionStep
}

func (s *OrchestrationService) executePendingDirectRun(ctx context.Context, actorID string, taskID string, reason string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	executor := s.directRunProvider
	if executor == nil && s.turnService != nil && s.turnService.providerService != nil {
		executor = providerServiceDirectRunExecutor{providerService: s.turnService.providerService}
	}
	if executor == nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "DirectRun provider runtime is not configured", nil)
	}

	runtime, claimed, events, err := s.claimPendingDirectRun(ctx, db, actorID, taskID, reason)
	if err != nil || !claimed {
		return err
	}
	s.publishCommittedTaskEvents(ctx, events)

	blocker, err := evaluateDirectRunRuntimePolicyPreflight(ctx, db, runtime)
	if err != nil {
		return err
	}
	if blocker.Blocked {
		blockedEvents, finishErr := s.pauseDirectRunForRuntimeInterrupt(ctx, db, runtime, blocker)
		s.publishCommittedTaskEvents(ctx, blockedEvents)
		return finishErr
	}

	provider, err := loadDirectRunProviderRecord(ctx, db, runtime.Run.ProviderID)
	if err != nil {
		failureEvents, finishErr := s.finishDirectRunFailure(ctx, db, runtime, fmt.Sprintf("DirectRun provider preflight failed: %v", err))
		s.publishCommittedTaskEvents(ctx, failureEvents)
		if finishErr != nil {
			return finishErr
		}
		return err
	}
	if isCLIProviderRecord(provider) {
		unsupportedEvents, finishErr := s.pauseDirectRunForRuntimeInterrupt(ctx, db, runtime, directRunCLIProviderHandoffBlocker(provider))
		s.publishCommittedTaskEvents(ctx, unsupportedEvents)
		return finishErr
	}

	resp, callErr := executor.CallDirectRunProvider(ctx, &ProviderCallRequest{
		ProviderID: runtime.Run.ProviderID,
		Model:      runtime.Run.ModelIntent,
		SystemPrompt: "You are executing a Station-owned Atelier DirectRun. " +
			"Return the direct model result as concise markdown. Do not claim that the applet executed provider, shell, or file operations.",
		Messages: []domain.Message{{
			Role:    domain.MessageRoleUser,
			Content: directRunUserPrompt(runtime),
		}},
		UserID: actorID,
		Effort: directRunReasoningEffort(runtime.Run.InputSnapshotJSON),
	})
	if callErr != nil {
		failureEvents, finishErr := s.finishDirectRunFailure(ctx, db, runtime, fmt.Sprintf("DirectRun provider execution failed: %v", callErr))
		s.publishCommittedTaskEvents(ctx, failureEvents)
		if finishErr != nil {
			return finishErr
		}
		return callErr
	}

	successEvents, err := s.finishDirectRunSuccess(ctx, db, runtime, provider, resp)
	s.publishCommittedTaskEvents(ctx, successEvents)
	return err
}

func (s *OrchestrationService) claimPendingDirectRun(ctx context.Context, db *gorm.DB, actorID string, taskID string, reason string) (*directRunRuntimeSnapshot, bool, []committedTaskEvent, error) {
	var runtime *directRunRuntimeSnapshot
	var events []committedTaskEvent
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loaded, err := loadPendingDirectRunRuntimeTx(ctx, tx, actorID, taskID)
		if err != nil || loaded == nil {
			return err
		}
		if loaded.Step.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING) {
			return nil
		}
		if loaded.Run.State != "pending_station_runtime" && loaded.Run.State != "pending_station_provider_route" {
			return nil
		}
		records := &directRunLifecycleRecords{Run: &loaded.Run, Task: &loaded.TaskRun, Step: &loaded.Step}
		if err := validateDirectRunRuntimePreflight(records); err != nil {
			return err
		}
		now := time.Now()
		if err := tx.WithContext(ctx).Model(&persistence.DirectRun{}).
			Where("direct_run_id = ?", loaded.Run.DirectRunID).
			Updates(map[string]interface{}{
				"state":      "running",
				"updated_at": now,
			}).Error; err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Model(&persistence.ExecutionStep{}).
			Where("step_id = ? AND status = ?", loaded.Step.StepID, int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING)).
			Updates(map[string]interface{}{
				"status":     int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
				"started_at": now,
			}).Error; err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Model(&persistence.TaskRun{}).
			Where("task_id = ?", loaded.TaskRun.TaskID).
			Updates(map[string]interface{}{
				"status":     int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
				"updated_at": now,
			}).Error; err != nil {
			return err
		}
		loaded.Run.State = "running"
		loaded.Run.UpdatedAt = now
		loaded.Step.Status = int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING)
		loaded.Step.StartedAt = now
		loaded.TaskRun.Status = int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING)
		loaded.TaskRun.UpdatedAt = now
		writer := s.eventWriter
		if writer == nil {
			writer = NewTaskEventWriter(s.eventBus)
		}
		payload := directRunStepStartedPayload(loaded, reason)
		record, err := writer.appendTx(ctx, tx, "", loaded.Task.ID, loaded.Step.StepID, "", string(domain.EventTypeCollaborationNodeRunning), payload)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{AgentID: loaded.Step.AgentID, EventType: string(domain.EventTypeCollaborationNodeRunning), Payload: payload, Record: record})
		runtime = loaded
		return nil
	})
	if err != nil || runtime == nil {
		return runtime, false, events, err
	}
	return runtime, true, events, nil
}

func loadPendingDirectRunRuntimeTx(ctx context.Context, tx *gorm.DB, actorID string, taskID string) (*directRunRuntimeSnapshot, error) {
	taskID = strings.TrimSpace(taskID)
	actorID = strings.TrimSpace(actorID)
	var task persistence.CollaborationTask
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND goal_owner_id = ?", taskID, actorID).
		First(&task).Error; err != nil {
		return nil, err
	}
	var run persistence.DirectRun
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("task_id = ? AND source = ?", taskID, collaborationProviderPlanSourceDirectRun).
		First(&run).Error; err != nil {
		return nil, err
	}
	var taskRun persistence.TaskRun
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("task_id = ?", taskID).
		First(&taskRun).Error; err != nil {
		return nil, err
	}
	var step persistence.ExecutionStep
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("task_id = ?", taskID).
		Order("started_at ASC").
		First(&step).Error; err != nil {
		return nil, err
	}
	return &directRunRuntimeSnapshot{Task: task, Run: run, TaskRun: taskRun, Step: step}, nil
}

func loadDirectRunProviderRecord(ctx context.Context, db *gorm.DB, providerID string) (*persistence.AgentProvider, error) {
	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).Where("id = ? AND enabled = ?", strings.TrimSpace(providerID), true).First(&provider).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "DirectRun provider not found or disabled", err)
		}
		return nil, err
	}
	return &provider, nil
}

func isCLIProviderRecord(provider *persistence.AgentProvider) bool {
	if provider == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(provider.RuntimeKind), providerRuntimeCLI) ||
		strings.EqualFold(strings.TrimSpace(provider.SourceType), providerRuntimeCLI)
}

type directRunRuntimeBlocker struct {
	Blocked       bool
	State         string
	InterruptType string
	BlockKind     string
	Reason        string
	Summary       string
	Detail        string
	Extra         map[string]interface{}
}

func directRunCLIProviderHandoffBlocker(provider *persistence.AgentProvider) directRunRuntimeBlocker {
	return directRunRuntimeBlocker{
		Blocked:       true,
		State:         "awaiting_desktop_coding_provider",
		InterruptType: "direct_run_desktop_coding_provider_handoff",
		BlockKind:     "desktop_executor_handoff",
		Reason:        "desktop_runtime_required",
		Summary:       "CLI CodingProvider execution requires a Desktop runtime handoff; Station recorded the typed handoff and did not execute local CLI.",
		Extra: map[string]interface{}{
			"adapter":                "desktop_coding_provider",
			"handoff_kind":           "desktop_executor_required",
			"handoff_owner":          "desktop_runtime",
			"executor_kind":          model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE.String(),
			"requested_capabilities": []string{"cli"},
			"provider_source_type":   strings.TrimSpace(provider.SourceType),
			"provider_runtime_kind":  strings.TrimSpace(provider.RuntimeKind),
			"provider_protocol":      strings.TrimSpace(provider.Protocol),
			"cli_command_configured": directRunCLICommandConfigured(provider),
			"cli_command_ref":        "agent_provider.cli_command",
			"direct_run_no_session":  true,
		},
	}
}

func directRunCLICommandConfigured(provider *persistence.AgentProvider) bool {
	if provider == nil {
		return false
	}
	if strings.TrimSpace(provider.CliCommand) != "" {
		return true
	}
	var config map[string]interface{}
	if len(provider.Config) > 0 && json.Unmarshal(provider.Config, &config) == nil {
		return firstConfigString(config, "cli_command", "cliCommand", "command") != ""
	}
	return false
}

func evaluateDirectRunRuntimePolicyPreflight(ctx context.Context, db *gorm.DB, runtime *directRunRuntimeSnapshot) (directRunRuntimeBlocker, error) {
	if runtime == nil {
		return directRunRuntimeBlocker{}, nil
	}
	if taskTimeBudgetExceeded(&runtime.Task, time.Now()) {
		summary := taskTimeBudgetExceededSummary(&runtime.Task)
		return directRunRuntimeBlocker{
			Blocked:       true,
			State:         "budget_blocked",
			InterruptType: "direct_run_budget_exceeded",
			BlockKind:     "budget",
			Reason:        "budget",
			Summary:       summary,
			Detail:        fmt.Sprintf("BudgetRef %s exceeded before DirectRun provider execution.", runtime.Run.BudgetRef),
		}, nil
	}
	if runtime.Task.BudgetTokens > 0 {
		usedTokens, err := directRunBudgetUsedTokens(ctx, db, runtime.Task.ID)
		if err != nil {
			return directRunRuntimeBlocker{}, err
		}
		if float64(usedTokens) >= runtime.Task.BudgetTokens {
			summary := fmt.Sprintf("Token budget exceeded before DirectRun provider execution: used %d tokens (budget %.0f).", usedTokens, runtime.Task.BudgetTokens)
			return directRunRuntimeBlocker{
				Blocked:       true,
				State:         "budget_blocked",
				InterruptType: "direct_run_budget_exceeded",
				BlockKind:     "budget",
				Reason:        "budget",
				Summary:       summary,
				Detail:        fmt.Sprintf("BudgetRef %s used_tokens=%d allocated_tokens=%.0f.", runtime.Run.BudgetRef, usedTokens, runtime.Task.BudgetTokens),
			}, nil
		}
	}
	if runtime.Task.BudgetMoney > 0 {
		usedMoney, err := directRunBudgetUsedMoney(ctx, db, runtime.Task.ID)
		if err != nil {
			return directRunRuntimeBlocker{}, err
		}
		if usedMoney >= runtime.Task.BudgetMoney {
			summary := fmt.Sprintf("Money budget exceeded before DirectRun provider execution: used %.6f (budget %.6f).", usedMoney, runtime.Task.BudgetMoney)
			return directRunRuntimeBlocker{
				Blocked:       true,
				State:         "budget_blocked",
				InterruptType: "direct_run_budget_exceeded",
				BlockKind:     "budget",
				Reason:        "budget",
				Summary:       summary,
				Detail:        fmt.Sprintf("BudgetRef %s used_money=%.6f allocated_money=%.6f.", runtime.Run.BudgetRef, usedMoney, runtime.Task.BudgetMoney),
			}, nil
		}
	}
	hardDeny, err := directRunPolicyHardDenied(ctx, db, runtime)
	if err != nil || !hardDeny {
		return directRunRuntimeBlocker{}, err
	}
	return directRunRuntimeBlocker{
		Blocked:       true,
		State:         "policy_blocked",
		InterruptType: "direct_run_policy_denied",
		BlockKind:     "policy",
		Reason:        "policy",
		Summary:       "DirectRun provider execution blocked by Station policy.",
		Detail:        fmt.Sprintf("PolicyRef %s has hard_deny=true.", runtime.Run.PolicyRef),
	}, nil
}

func directRunPolicyHardDenied(ctx context.Context, db *gorm.DB, runtime *directRunRuntimeSnapshot) (bool, error) {
	if runtime == nil {
		return false, nil
	}
	meta := map[string]string{}
	_ = json.Unmarshal([]byte(runtime.Task.MetaJSON), &meta)
	if projectStateMachineMetaBool(meta, "policy_hard_deny") {
		return true, nil
	}
	policyRef := strings.TrimSpace(runtime.Run.PolicyRef)
	if policyRef == "" {
		return false, nil
	}
	var policy persistence.AtelierPolicy
	err := db.WithContext(ctx).
		Where("task_id = ? AND (policy_id = ? OR policy_projection_id = ?)", runtime.Task.ID, policyRef, projectStateMachinePolicyProjectionID(runtime.Task.ID, policyRef)).
		First(&policy).Error
	if err == gorm.ErrRecordNotFound {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return policy.HardDeny, nil
}

func directRunBudgetUsedTokens(ctx context.Context, db *gorm.DB, taskID string) (int64, error) {
	var total int64
	err := db.WithContext(ctx).Model(&persistence.TaskBudgetUsage{}).
		Where("task_id = ?", strings.TrimSpace(taskID)).
		Select("COALESCE(SUM(total_tokens), 0)").
		Scan(&total).Error
	return total, err
}

func directRunBudgetUsedMoney(ctx context.Context, db *gorm.DB, taskID string) (float64, error) {
	var total float64
	err := db.WithContext(ctx).Model(&persistence.TaskBudgetUsage{}).
		Where("task_id = ?", strings.TrimSpace(taskID)).
		Select("COALESCE(SUM(used_money), 0)").
		Scan(&total).Error
	return total, err
}

func (s *OrchestrationService) finishDirectRunSuccess(ctx context.Context, db *gorm.DB, runtime *directRunRuntimeSnapshot, provider *persistence.AgentProvider, resp *ProviderCallResponse) ([]committedTaskEvent, error) {
	content := strings.TrimSpace(respContent(resp))
	if content == "" {
		content = "DirectRun provider completed without a final response."
	}
	artifactID := generateID("direct_run_artifact")
	gateID := generateID("direct_run_gate")
	now := time.Now()
	var events []committedTaskEvent
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := updateDirectRunTerminalStateTx(ctx, tx, runtime, "succeeded", model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED, model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED, content, now); err != nil {
			return err
		}
		writer := s.eventWriter
		if writer == nil {
			writer = NewTaskEventWriter(s.eventBus)
		}
		artifactPayload := directRunArtifactPayload(runtime, resp, artifactID, "DirectRun provider response", "direct_run.provider_response", content)
		artifactRecord, err := writer.appendTx(ctx, tx, "", runtime.Task.ID, runtime.Step.StepID, "", string(domain.EventTypeCollaborationArtifactCreated), artifactPayload)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{AgentID: runtime.Step.AgentID, EventType: string(domain.EventTypeCollaborationArtifactCreated), Payload: artifactPayload, Record: artifactRecord})
		if err := createDirectRunBudgetUsageTx(ctx, tx, runtime, provider, resp, artifactRecord); err != nil {
			return err
		}
		completedPayload := directRunStepCompletedPayload(runtime, content, artifactID)
		completedRecord, err := writer.appendTx(ctx, tx, "", runtime.Task.ID, runtime.Step.StepID, "", string(domain.EventTypeCollaborationNodeCompleted), completedPayload)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{AgentID: runtime.Step.AgentID, EventType: string(domain.EventTypeCollaborationNodeCompleted), Payload: completedPayload, Record: completedRecord})
		gatePayload := directRunGatePayload(runtime, gateID, artifactID, "passed", "DirectRun provider execution produced a Station-owned artifact.")
		gateRecord, err := writer.appendTx(ctx, tx, "", runtime.Task.ID, runtime.Step.StepID, "", string(domain.EventTypeCollaborationGateResult), gatePayload)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{AgentID: runtime.Step.AgentID, EventType: string(domain.EventTypeCollaborationGateResult), Payload: gatePayload, Record: gateRecord})
		statusPayload := directRunTaskStatusPayload(runtime, "succeeded", model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED, "DirectRun provider execution completed.")
		statusRecord, err := writer.appendTx(ctx, tx, "", runtime.Task.ID, runtime.Step.StepID, "", string(domain.EventTypeCollaborationTaskCompleted), statusPayload)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{AgentID: runtime.Step.AgentID, EventType: string(domain.EventTypeCollaborationTaskCompleted), Payload: statusPayload, Record: statusRecord})
		return nil
	})
	return events, err
}

func createDirectRunBudgetUsageTx(ctx context.Context, tx *gorm.DB, runtime *directRunRuntimeSnapshot, provider *persistence.AgentProvider, resp *ProviderCallResponse, event *persistence.TaskEvent) error {
	if runtime == nil || resp == nil {
		return nil
	}
	inputTokens := int64(resp.InputTokens)
	outputTokens := int64(resp.OutputTokens)
	totalTokens := inputTokens + outputTokens
	if totalTokens <= 0 {
		return nil
	}
	now := time.Now()
	eventID := ""
	eventSeq := int64(0)
	payloadJSON := ""
	if event != nil {
		eventID = event.ID
		eventSeq = event.EventSeq
		payloadJSON = event.Payload
		if !event.CreatedAt.IsZero() {
			now = event.CreatedAt
		}
	}
	modelName := firstNonEmptyString(resp.Model, runtime.Run.ModelIntent)
	pricing := directRunProviderPricing(provider, modelName)
	estimatedMoney := pricing.moneyUsage(inputTokens, outputTokens)
	billing := directRunProviderBilling(resp)
	usedMoney := estimatedMoney
	if billing.Present {
		usedMoney = billing.Money
	}
	record := persistence.TaskBudgetUsage{
		BudgetUsageID:           generateID("task_budget_usage"),
		TaskID:                  runtime.Task.ID,
		StepID:                  runtime.Step.StepID,
		EventID:                 eventID,
		EventSeq:                eventSeq,
		BudgetID:                runtime.Run.BudgetRef,
		DirectRunID:             runtime.Run.DirectRunID,
		ProviderID:              runtime.Run.ProviderID,
		Model:                   modelName,
		InputTokens:             inputTokens,
		OutputTokens:            outputTokens,
		TotalTokens:             totalTokens,
		UsedMoney:               usedMoney,
		EstimatedMoney:          estimatedMoney,
		ProviderBilledMoney:     billing.Money,
		ProviderBillingSource:   billing.Source,
		ProviderBillingCurrency: billing.Currency,
		InputTokenPrice:         pricing.InputTokenPrice,
		OutputTokenPrice:        pricing.OutputTokenPrice,
		PricingSource:           pricing.Source,
		Source:                  "station.direct_run",
		PayloadJSON:             payloadJSON,
		CreatedAt:               now,
	}
	return tx.WithContext(ctx).Create(&record).Error
}

type directRunProviderBillingSnapshot struct {
	Money    float64
	Source   string
	Currency string
	Present  bool
}

func directRunProviderBilling(resp *ProviderCallResponse) directRunProviderBillingSnapshot {
	if resp == nil || resp.BilledMoney < 0 {
		return directRunProviderBillingSnapshot{}
	}
	source := strings.TrimSpace(resp.BillingSource)
	if source == "" && resp.BilledMoney <= 0 {
		return directRunProviderBillingSnapshot{}
	}
	if source == "" {
		source = "provider.response.billing"
	}
	return directRunProviderBillingSnapshot{
		Money:    resp.BilledMoney,
		Source:   source,
		Currency: strings.TrimSpace(resp.BillingCurrency),
		Present:  true,
	}
}

type directRunPricingSnapshot struct {
	InputTokenPrice  float64
	OutputTokenPrice float64
	Source           string
}

func (p directRunPricingSnapshot) moneyUsage(inputTokens int64, outputTokens int64) float64 {
	if p.InputTokenPrice <= 0 && p.OutputTokenPrice <= 0 {
		return 0
	}
	return float64(inputTokens)*p.InputTokenPrice + float64(outputTokens)*p.OutputTokenPrice
}

func directRunProviderPricing(provider *persistence.AgentProvider, model string) directRunPricingSnapshot {
	if provider == nil || len(provider.Config) == 0 {
		return directRunPricingSnapshot{}
	}
	var config map[string]interface{}
	if err := json.Unmarshal(provider.Config, &config); err != nil {
		return directRunPricingSnapshot{}
	}
	if catalog := directRunProviderPricingFromCatalog(config, model); catalog.Source != "" {
		return catalog
	}
	if nested, ok := config["pricing"].(map[string]interface{}); ok {
		return directRunPricingSnapshotFromConfig(nested, "provider.config.pricing")
	}
	return directRunPricingSnapshotFromConfig(config, "provider.config")
}

func directRunProviderPricingFromCatalog(config map[string]interface{}, model string) directRunPricingSnapshot {
	catalog, sourceKey := firstConfigMap(config, "pricing_catalog", "pricingCatalog", "model_pricing_catalog", "modelPricingCatalog")
	if catalog == nil {
		return directRunPricingSnapshot{}
	}
	models, _ := firstConfigMap(catalog, "models", "model_prices", "modelPrices")
	if models == nil {
		return directRunPricingSnapshot{}
	}
	modelKey := strings.TrimSpace(model)
	entry, matchedModel := directRunProviderPricingCatalogEntry(models, modelKey)
	if entry == nil {
		return directRunPricingSnapshot{}
	}
	source := firstNonEmptyString(
		firstConfigString(catalog, "source", "pricing_source", "pricingSource"),
		sourceKey,
		"provider.config.pricing_catalog",
	)
	if version := firstConfigString(catalog, "version", "catalog_version", "catalogVersion"); version != "" {
		source = source + "@" + version
	}
	if matchedModel != "" {
		source = source + ":" + matchedModel
	}
	return directRunPricingSnapshotFromConfig(entry, source)
}

func directRunProviderPricingCatalogEntry(models map[string]interface{}, model string) (map[string]interface{}, string) {
	for _, key := range []string{model, strings.ToLower(model), "default", "*"} {
		if strings.TrimSpace(key) == "" {
			continue
		}
		if entry, ok := models[key].(map[string]interface{}); ok {
			return entry, key
		}
	}
	return nil, ""
}

func directRunPricingSnapshotFromConfig(pricing map[string]interface{}, source string) directRunPricingSnapshot {
	inputPrice := firstConfigFloat(pricing, "input_token_usd", "inputTokenUsd", "input_token_price", "inputTokenPrice", "input_price_per_token", "inputPricePerToken")
	outputPrice := firstConfigFloat(pricing, "output_token_usd", "outputTokenUsd", "output_token_price", "outputTokenPrice", "output_price_per_token", "outputPricePerToken")
	if inputPrice <= 0 && outputPrice <= 0 {
		return directRunPricingSnapshot{}
	}
	return directRunPricingSnapshot{InputTokenPrice: inputPrice, OutputTokenPrice: outputPrice, Source: source}
}

func (s *OrchestrationService) finishDirectRunFailure(ctx context.Context, db *gorm.DB, runtime *directRunRuntimeSnapshot, summary string) ([]committedTaskEvent, error) {
	summary = strings.TrimSpace(summary)
	if summary == "" {
		summary = "DirectRun provider execution failed."
	}
	artifactID := generateID("direct_run_failure_artifact")
	now := time.Now()
	var events []committedTaskEvent
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := updateDirectRunTerminalStateTx(ctx, tx, runtime, "failed", model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary, now); err != nil {
			return err
		}
		writer := s.eventWriter
		if writer == nil {
			writer = NewTaskEventWriter(s.eventBus)
		}
		artifactPayload := directRunArtifactPayload(runtime, nil, artifactID, "DirectRun failure report", "direct_run.failure", summary)
		artifactRecord, err := writer.appendTx(ctx, tx, "", runtime.Task.ID, runtime.Step.StepID, "", string(domain.EventTypeCollaborationArtifactCreated), artifactPayload)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{AgentID: runtime.Step.AgentID, EventType: string(domain.EventTypeCollaborationArtifactCreated), Payload: artifactPayload, Record: artifactRecord})
		failedPayload := directRunStepFailedPayload(runtime, summary, artifactID)
		failedRecord, err := writer.appendTx(ctx, tx, "", runtime.Task.ID, runtime.Step.StepID, "", string(domain.EventTypeCollaborationNodeFailed), failedPayload)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{AgentID: runtime.Step.AgentID, EventType: string(domain.EventTypeCollaborationNodeFailed), Payload: failedPayload, Record: failedRecord})
		statusPayload := directRunTaskStatusPayload(runtime, "failed", model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED, summary)
		statusRecord, err := writer.appendTx(ctx, tx, "", runtime.Task.ID, runtime.Step.StepID, "", string(domain.EventTypeCollaborationTaskFailed), statusPayload)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{AgentID: runtime.Step.AgentID, EventType: string(domain.EventTypeCollaborationTaskFailed), Payload: statusPayload, Record: statusRecord})
		return nil
	})
	return events, err
}

func (s *OrchestrationService) pauseDirectRunForRuntimeInterrupt(ctx context.Context, db *gorm.DB, runtime *directRunRuntimeSnapshot, blocker directRunRuntimeBlocker) ([]committedTaskEvent, error) {
	summary := strings.TrimSpace(blocker.Summary)
	if summary == "" {
		summary = "DirectRun provider execution is blocked by Station runtime policy."
	}
	state := firstNonEmptyString(blocker.State, "runtime_blocked")
	interruptType := firstNonEmptyString(blocker.InterruptType, "direct_run_runtime_blocked")
	blockKind := firstNonEmptyString(blocker.BlockKind, blocker.Reason, "policy")
	reason := firstNonEmptyString(blocker.Reason, blockKind)
	now := time.Now()
	var events []committedTaskEvent
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := updateDirectRunTerminalStateTx(ctx, tx, runtime, state, model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary, now); err != nil {
			return err
		}
		writer := s.eventWriter
		if writer == nil {
			writer = NewTaskEventWriter(s.eventBus)
		}
		payload := map[string]interface{}{
			"interrupt_id":     generateID(interruptType),
			"interrupt_type":   interruptType,
			"block_kind":       blockKind,
			"reason":           reason,
			"task_id":          runtime.Task.ID,
			"step_id":          runtime.Step.StepID,
			"direct_run_id":    runtime.Run.DirectRunID,
			"provider_id":      runtime.Run.ProviderID,
			"model_intent":     runtime.Run.ModelIntent,
			"budget_ref":       runtime.Run.BudgetRef,
			"policy_ref":       runtime.Run.PolicyRef,
			"trace_id":         runtime.Run.TraceID,
			"direct_run_state": state,
			"summary":          summary,
			"source":           collaborationProviderPlanSourceDirectRun,
		}
		if strings.TrimSpace(blocker.Detail) != "" {
			payload["detail"] = strings.TrimSpace(blocker.Detail)
		}
		for key, value := range blocker.Extra {
			if strings.TrimSpace(key) != "" {
				payload[key] = value
			}
		}
		record, err := writer.appendTx(ctx, tx, "", runtime.Task.ID, runtime.Step.StepID, "", string(domain.EventTypeCollaborationInterruptRequested), payload)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{AgentID: runtime.Step.AgentID, EventType: string(domain.EventTypeCollaborationInterruptRequested), Payload: payload, Record: record})
		gatePayload := directRunGatePayload(runtime, generateID("direct_run_runtime_gate"), "", "failed", summary)
		gatePayload["blocking"] = true
		gatePayload["interrupt_type"] = interruptType
		gatePayload["reason"] = reason
		for key, value := range blocker.Extra {
			if strings.TrimSpace(key) != "" {
				gatePayload[key] = value
			}
		}
		gateRecord, err := writer.appendTx(ctx, tx, "", runtime.Task.ID, runtime.Step.StepID, "", string(domain.EventTypeCollaborationGateResult), gatePayload)
		if err != nil {
			return err
		}
		events = append(events, committedTaskEvent{AgentID: runtime.Step.AgentID, EventType: string(domain.EventTypeCollaborationGateResult), Payload: gatePayload, Record: gateRecord})
		return nil
	})
	return events, err
}

func updateDirectRunTerminalStateTx(ctx context.Context, tx *gorm.DB, runtime *directRunRuntimeSnapshot, state string, taskStatus model.CollaborationTaskStatus, stepStatus model.TaskNodeStatus, summary string, now time.Time) error {
	if runtime == nil {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun runtime is required", nil)
	}
	endedAt := now
	if err := tx.WithContext(ctx).Model(&persistence.DirectRun{}).
		Where("direct_run_id = ?", runtime.Run.DirectRunID).
		Updates(map[string]interface{}{
			"state":      state,
			"updated_at": now,
		}).Error; err != nil {
		return err
	}
	if err := tx.WithContext(ctx).Model(&persistence.TaskRun{}).
		Where("task_id = ?", runtime.TaskRun.TaskID).
		Updates(map[string]interface{}{
			"status":     int32(taskStatus),
			"updated_at": now,
			"ended_at":   &endedAt,
		}).Error; err != nil {
		return err
	}
	if err := tx.WithContext(ctx).Model(&persistence.ExecutionStep{}).
		Where("step_id = ?", runtime.Step.StepID).
		Updates(map[string]interface{}{
			"status":         int32(stepStatus),
			"result_summary": summary,
			"ended_at":       &endedAt,
		}).Error; err != nil {
		return err
	}
	return tx.WithContext(ctx).Model(&persistence.CollaborationTask{}).
		Where("id = ?", runtime.Task.ID).
		Updates(map[string]interface{}{
			"status":   int32(taskStatus),
			"ended_at": now,
		}).Error
}

func directRunUserPrompt(runtime *directRunRuntimeSnapshot) string {
	if runtime == nil {
		return ""
	}
	var snapshot map[string]interface{}
	if strings.TrimSpace(runtime.Run.InputSnapshotJSON) != "" {
		_ = json.Unmarshal([]byte(runtime.Run.InputSnapshotJSON), &snapshot)
	}
	title := strings.TrimSpace(runtime.Task.Title)
	description := strings.TrimSpace(runtime.Task.Description)
	if value, ok := snapshot["title"].(string); ok && strings.TrimSpace(value) != "" {
		title = strings.TrimSpace(value)
	}
	if value, ok := snapshot["description"].(string); ok && strings.TrimSpace(value) != "" {
		description = strings.TrimSpace(value)
	}
	if description == "" {
		description = title
	}
	return strings.TrimSpace(fmt.Sprintf("Task: %s\n\nGoal:\n%s", title, description))
}

func directRunReasoningEffort(inputSnapshotJSON string) string {
	var snapshot map[string]interface{}
	if strings.TrimSpace(inputSnapshotJSON) == "" || json.Unmarshal([]byte(inputSnapshotJSON), &snapshot) != nil {
		return ""
	}
	if plan, ok := snapshot["provider_plan"].(map[string]interface{}); ok {
		if providers, ok := plan["providers"].([]interface{}); ok && len(providers) > 0 {
			if provider, ok := providers[0].(map[string]interface{}); ok {
				if effort, ok := provider["reasoningEffort"].(string); ok {
					return strings.TrimSpace(effort)
				}
				if effort, ok := provider["reasoning_effort"].(string); ok {
					return strings.TrimSpace(effort)
				}
			}
		}
	}
	return ""
}

func respContent(resp *ProviderCallResponse) string {
	if resp == nil {
		return ""
	}
	return resp.Content
}

func directRunStepStartedPayload(runtime *directRunRuntimeSnapshot, reason string) map[string]interface{} {
	payload := directRunBasePayload(runtime)
	payload["status"] = int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING)
	payload["step_status"] = int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING)
	payload["provider_execution"] = "started"
	payload["reason"] = strings.TrimSpace(reason)
	return payload
}

func directRunStepCompletedPayload(runtime *directRunRuntimeSnapshot, summary string, artifactID string) map[string]interface{} {
	payload := directRunBasePayload(runtime)
	payload["status"] = int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED)
	payload["step_status"] = int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED)
	payload["provider_execution"] = "succeeded"
	payload["summary"] = strings.TrimSpace(summary)
	payload["artifact_ids"] = []string{strings.TrimSpace(artifactID)}
	return payload
}

func directRunStepFailedPayload(runtime *directRunRuntimeSnapshot, summary string, artifactID string) map[string]interface{} {
	payload := directRunBasePayload(runtime)
	payload["status"] = int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED)
	payload["step_status"] = int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED)
	payload["provider_execution"] = "failed"
	payload["summary"] = strings.TrimSpace(summary)
	payload["artifact_ids"] = []string{strings.TrimSpace(artifactID)}
	return payload
}

func directRunTaskStatusPayload(runtime *directRunRuntimeSnapshot, state string, status model.CollaborationTaskStatus, summary string) map[string]interface{} {
	payload := directRunBasePayload(runtime)
	payload["direct_run_state"] = strings.TrimSpace(state)
	payload["status"] = int32(status)
	payload["task_status"] = int32(status)
	payload["summary"] = strings.TrimSpace(summary)
	return payload
}

func directRunArtifactPayload(runtime *directRunRuntimeSnapshot, resp *ProviderCallResponse, artifactID string, name string, kind string, body string) map[string]interface{} {
	artifactID = strings.TrimSpace(artifactID)
	body = strings.TrimSpace(body)
	payload := directRunBasePayload(runtime)
	payload["block_kind"] = "artifact"
	payload["artifact_id"] = artifactID
	payload["id"] = artifactID
	payload["kind"] = strings.TrimSpace(kind)
	payload["name"] = strings.TrimSpace(name)
	payload["uri"] = stationArtifactURI(runtime.Task.ID, artifactID)
	payload["checksum"] = artifactContentChecksum(body)
	payload["produced_by"] = "station.direct_run"
	payload["body_kind"] = "markdown"
	payload["markdown"] = body
	payload["preview_hint"] = "safe_text"
	payload["retention_policy"] = "station_managed"
	payload["refs"] = []string{runtime.Run.DirectRunID}
	if resp != nil {
		payload["provider_type"] = strings.TrimSpace(resp.Provider)
		payload["response_model"] = strings.TrimSpace(resp.Model)
		payload["input_tokens"] = resp.InputTokens
		payload["output_tokens"] = resp.OutputTokens
		payload["finish_reason"] = strings.TrimSpace(resp.FinishReason)
		payload["streamed"] = resp.Streamed
	}
	return payload
}

func directRunGatePayload(runtime *directRunRuntimeSnapshot, gateID string, artifactID string, status string, summary string) map[string]interface{} {
	payload := directRunBasePayload(runtime)
	payload["block_kind"] = "gate_result"
	payload["gate_id"] = strings.TrimSpace(gateID)
	payload["name"] = "DirectRun provider execution"
	payload["status"] = strings.TrimSpace(status)
	payload["summary"] = strings.TrimSpace(summary)
	payload["blocking"] = status != "passed"
	if strings.TrimSpace(artifactID) != "" {
		payload["artifact_ids"] = []string{strings.TrimSpace(artifactID)}
	}
	payload["checks"] = []map[string]interface{}{{
		"name":    "station_owned_provider_execution",
		"status":  strings.TrimSpace(status),
		"summary": "Provider execution ran inside Station and produced durable task evidence.",
	}}
	payload["produced_by"] = "station.direct_run"
	return payload
}

func directRunBasePayload(runtime *directRunRuntimeSnapshot) map[string]interface{} {
	payload := map[string]interface{}{
		"runtime_kind":  "direct_run_no_session",
		"source":        collaborationProviderPlanSourceDirectRun,
		"surface":       int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
		"surface_name":  model.TaskSurface_TASK_SURFACE_DIRECT_RUN.String(),
		"runtime_owner": "station",
	}
	if runtime == nil {
		return payload
	}
	payload["task_id"] = runtime.Task.ID
	payload["step_id"] = runtime.Step.StepID
	payload["direct_run_id"] = runtime.Run.DirectRunID
	payload["provider_id"] = runtime.Run.ProviderID
	payload["model_intent"] = runtime.Run.ModelIntent
	payload["budget_ref"] = runtime.Run.BudgetRef
	payload["policy_ref"] = runtime.Run.PolicyRef
	payload["trace_id"] = runtime.Run.TraceID
	payload["agent_id"] = runtime.Step.AgentID
	return payload
}

func (s *OrchestrationService) CancelCollaborationTask(ctx context.Context, actorID, taskID string) (*model.CollaborationTask, []*model.TaskNode, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, nil, err
	}
	actorID = strings.TrimSpace(actorID)
	taskID = strings.TrimSpace(taskID)
	if actorID == "" || taskID == "" {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id and task_id are required", nil)
	}

	var task persistence.CollaborationTask
	var nodes []persistence.CollaborationTaskNode
	cancelled := false
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND goal_owner_id = ?", taskID, actorID).First(&task).Error; err != nil {
			return err
		}
		terminal := map[int32]struct{}{
			int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED): {},
			int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED):    {},
			int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED): {},
		}
		if _, ok := terminal[task.Status]; !ok {
			cancelled = true
			now := time.Now()
			task.Status = int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED)
			task.EndedAt = now
			if err := tx.Model(&persistence.CollaborationTask{}).Where("id = ?", task.ID).Updates(map[string]interface{}{
				"status":   task.Status,
				"ended_at": now,
			}).Error; err != nil {
				return err
			}
			if err := tx.Model(&persistence.CollaborationTaskNode{}).
				Where("task_id = ? AND status IN ?", task.ID, []int32{
					int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
					int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
				}).
				Updates(map[string]interface{}{
					"status":         int32(model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED),
					"ended_at":       now,
					"result_summary": "Task cancelled.",
				}).Error; err != nil {
				return err
			}
		}
		return tx.Where("task_id = ?", task.ID).Order("started_at ASC").Find(&nodes).Error
	}); err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "collaboration task not found", err)
		}
		return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to cancel collaboration task", err)
	}

	if cancelled || task.Status == int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED) {
		s.publishTaskFinished(ctx, taskRecordToProto(&task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskCancelled)
	}
	return taskRecordToProto(&task), nodeRecordsToProto(nodes), nil
}

func (s *OrchestrationService) ResumeCollaborationTask(ctx context.Context, actorID, taskID, reason string) (*model.CollaborationTask, []*model.TaskNode, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, nil, err
	}
	actorID = strings.TrimSpace(actorID)
	taskID = strings.TrimSpace(taskID)
	if actorID == "" || taskID == "" {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id and task_id are required", nil)
	}

	var task persistence.CollaborationTask
	var nodes []persistence.CollaborationTaskNode
	resumed := false
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		task, nodes, resumed, err = resumeCollaborationTaskTx(ctx, tx, actorID, taskID, reason)
		return err
	}); err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "collaboration task not found", err)
		}
		return nil, nil, err
	}
	if resumed {
		s.startTaskExecution(actorID, task, nodes, "interrupt-resolved")
	}
	return taskRecordToProto(&task), nodeRecordsToProto(nodes), nil
}

func (s *OrchestrationService) RequestCollaborationInterrupt(
	ctx context.Context,
	actorID string,
	agentID string,
	taskID string,
	payload map[string]interface{},
) (*model.CollaborationTask, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	actorID = strings.TrimSpace(actorID)
	taskID = strings.TrimSpace(taskID)
	if actorID == "" || taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id and task_id are required", nil)
	}
	writer := s.eventWriter
	if writer == nil {
		writer = NewTaskEventWriter(s.eventBus)
	}
	writer.mu.Lock()
	defer writer.mu.Unlock()

	var task persistence.CollaborationTask
	var record *persistence.TaskEvent
	eventType := string(domain.EventTypeCollaborationInterruptRequested)
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var txErr error
		task, record, txErr = requestCollaborationInterruptTx(ctx, tx, writer, actorID, taskID, eventType, payload)
		return txErr
	}); err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "collaboration task not found", err)
		}
		return nil, err
	}

	if writer.eventBus != nil {
		metadata := map[string]string{
			"agent_id":  strings.TrimSpace(agentID),
			"task_id":   taskID,
			"event_id":  record.ID,
			"event_seq": fmt.Sprintf("%d", record.EventSeq),
		}
		_ = writer.eventBus.Publish(ctx, domain.DomainEvent{
			EventID:   record.ID,
			EventType: eventType,
			ActorID:   strings.TrimSpace(agentID),
			Payload:   payload,
			Metadata:  metadata,
		})
	}
	return taskRecordToProto(&task), nil
}

func (s *OrchestrationService) ResolveCollaborationInterrupt(
	ctx context.Context,
	actorID string,
	agentID string,
	taskID string,
	reason string,
	payload map[string]interface{},
) (*model.CollaborationTask, []*model.TaskNode, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, nil, err
	}
	actorID = strings.TrimSpace(actorID)
	taskID = strings.TrimSpace(taskID)
	if actorID == "" || taskID == "" {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id and task_id are required", nil)
	}
	writer := s.eventWriter
	if writer == nil {
		writer = NewTaskEventWriter(s.eventBus)
	}
	writer.mu.Lock()
	defer writer.mu.Unlock()

	var task persistence.CollaborationTask
	var nodes []persistence.CollaborationTaskNode
	var record *persistence.TaskEvent
	resumed := false
	liveDecision := LiveResumeDecision{}
	eventType := string(domain.EventTypeCollaborationInterruptResolved)
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var txErr error
		task, nodes, resumed, record, liveDecision, txErr = resolveCollaborationInterruptWithLiveResumeTx(ctx, tx, writer, actorID, taskID, reason, eventType, payload, s.liveResume)
		return txErr
	}); err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "collaboration task not found", err)
		}
		return nil, nil, err
	}

	if writer.eventBus != nil {
		metadata := map[string]string{
			"agent_id":  strings.TrimSpace(agentID),
			"task_id":   taskID,
			"event_id":  record.ID,
			"event_seq": fmt.Sprintf("%d", record.EventSeq),
		}
		_ = writer.eventBus.Publish(ctx, domain.DomainEvent{
			EventID:   record.ID,
			EventType: eventType,
			ActorID:   strings.TrimSpace(agentID),
			Payload:   payload,
			Metadata:  metadata,
		})
	}
	if strings.TrimSpace(liveDecision.InterruptID) != "" {
		liveDecision.Reason = strings.TrimSpace(reason)
		if err := s.liveResume.Resolve(liveDecision); err != nil {
			return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to deliver live resume decision", err)
		}
	}
	if resumed {
		s.startTaskExecution(actorID, task, nodes, "interrupt-resolved")
	}
	return taskRecordToProto(&task), nodeRecordsToProto(nodes), nil
}

func requestCollaborationInterruptTx(
	ctx context.Context,
	tx *gorm.DB,
	writer *TaskEventWriter,
	actorID string,
	taskID string,
	eventType string,
	payload map[string]interface{},
) (persistence.CollaborationTask, *persistence.TaskEvent, error) {
	var task persistence.CollaborationTask
	if err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND goal_owner_id = ?", taskID, actorID).
		First(&task).Error; err != nil {
		return task, nil, err
	}
	record, err := writer.appendTx(ctx, tx, "", taskID, "", "", eventType, payload)
	if err != nil {
		return task, nil, err
	}
	return task, record, nil
}

func (s *OrchestrationService) RunCollaborationSupervisorTick(ctx context.Context, actorID string, taskID string) (*model.CollaborationTask, *model.TaskEvent, bool, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, nil, false, err
	}
	actorID = strings.TrimSpace(actorID)
	taskID = strings.TrimSpace(taskID)
	if actorID == "" || taskID == "" {
		return nil, nil, false, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id and task_id are required", nil)
	}
	writer := s.eventWriter
	if writer == nil {
		writer = NewTaskEventWriter(s.eventBus)
	}
	var task persistence.CollaborationTask
	var record *persistence.TaskEvent
	var requested bool
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var txErr error
		task, record, requested, txErr = runCollaborationSupervisorTickTx(ctx, tx, writer, actorID, taskID, time.Now())
		return txErr
	}); err != nil {
		return nil, nil, false, err
	}
	return taskRecordToProto(&task), taskEventRecordToProto(record), requested, nil
}

func (s *OrchestrationService) RunCollaborationSupervisorSweep(ctx context.Context, actorID string, limit int) (*CollaborationSupervisorSweepResult, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id is required", nil)
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	writer := s.eventWriter
	if writer == nil {
		writer = NewTaskEventWriter(s.eventBus)
	}
	var tasks []persistence.CollaborationTask
	if err := db.WithContext(ctx).
		Where("goal_owner_id = ? AND status IN ?", actorID, []int32{
			int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
			int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		}).
		Order("started_at ASC, id ASC").
		Limit(limit).
		Find(&tasks).Error; err != nil {
		return nil, err
	}
	result := &CollaborationSupervisorSweepResult{Scanned: len(tasks)}
	now := time.Now()
	for index := range tasks {
		taskID := strings.TrimSpace(tasks[index].ID)
		if taskID == "" {
			result.Skipped++
			continue
		}
		var requested bool
		if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var txErr error
			_, _, requested, txErr = runCollaborationSupervisorTickTx(ctx, tx, writer, actorID, taskID, now)
			return txErr
		}); err != nil {
			return nil, err
		}
		if requested {
			result.Requested++
			result.RequestedTaskIDs = append(result.RequestedTaskIDs, taskID)
		} else {
			result.Skipped++
		}
	}
	return result, nil
}

func runCollaborationSupervisorTickTx(
	ctx context.Context,
	tx *gorm.DB,
	writer *TaskEventWriter,
	actorID string,
	taskID string,
	now time.Time,
) (persistence.CollaborationTask, *persistence.TaskEvent, bool, error) {
	var task persistence.CollaborationTask
	if err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND goal_owner_id = ?", strings.TrimSpace(taskID), strings.TrimSpace(actorID)).
		First(&task).Error; err != nil {
		return task, nil, false, err
	}
	status := model.CollaborationTaskStatus(task.Status)
	if status != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING &&
		status != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED {
		return task, nil, false, nil
	}
	pending, err := hasPendingSupervisorReplanInterruptTx(ctx, tx, task.ID)
	if err != nil || pending {
		return task, nil, false, err
	}
	decision, err := collaborationSupervisorDecisionTx(ctx, tx, &task, now)
	if err != nil || !decision.Required {
		return task, nil, false, err
	}
	meta := map[string]string{}
	_ = json.Unmarshal([]byte(task.MetaJSON), &meta)
	meta["supervisor_state"] = "replan_requested"
	meta["supervisor_loop"] = collaborationSupervisorLoopEventBus
	meta["replan_policy"] = collaborationReplanPolicyBeforeB10
	meta["resume_anchor_policy"] = collaborationResumeAnchorLatestAccepted
	meta["replan_required"] = "true"
	meta["replan_reason"] = decision.Reason
	meta["replan_detail"] = decision.Detail
	meta["supervisor_replan_requested_at"] = now.UTC().Format(time.RFC3339Nano)
	if decision.CheckpointID != "" {
		meta["resume_anchor_checkpoint_id"] = decision.CheckpointID
		meta["resume_anchor_event_seq"] = fmt.Sprintf("%d", decision.CheckpointEventSeq)
	}
	if len(decision.TaskGraphDiff) > 0 {
		meta["task_graph_diff_status"] = "proposed"
	}
	metaJSON, _ := json.Marshal(meta)
	task.MetaJSON = string(metaJSON)
	task.Status = int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED)
	if err := tx.WithContext(ctx).Model(&persistence.CollaborationTask{}).
		Where("id = ?", task.ID).
		Updates(map[string]interface{}{
			"status":    task.Status,
			"meta_json": task.MetaJSON,
		}).Error; err != nil {
		return task, nil, false, err
	}
	payload := supervisorReplanInterruptPayload(task, decision, now)
	record, err := writer.appendTx(ctx, tx, "", task.ID, "", "", string(domain.EventTypeCollaborationInterruptRequested), payload)
	if err != nil {
		return task, nil, false, err
	}
	return task, record, true, nil
}

func hasPendingSupervisorReplanInterruptTx(ctx context.Context, tx *gorm.DB, taskID string) (bool, error) {
	var count int64
	if err := tx.WithContext(ctx).Model(&persistence.InterruptRequest{}).
		Where("task_id = ? AND interrupt_type = ? AND status = ?", taskID, collaborationSupervisorInterruptReplan, int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING)).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func collaborationSupervisorDecisionTx(ctx context.Context, tx *gorm.DB, task *persistence.CollaborationTask, now time.Time) (collaborationSupervisorDecision, error) {
	if task == nil {
		return collaborationSupervisorDecision{}, nil
	}
	meta := map[string]string{}
	_ = json.Unmarshal([]byte(task.MetaJSON), &meta)
	decision := collaborationSupervisorDecision{}
	switch {
	case supervisorMetaBool(meta, "workspace_conflict", "supervisor_workspace_conflict") ||
		supervisorMetaIn(meta, "workspace_conflict_status", "conflict", "blocked"):
		decision.Required = true
		decision.Reason = "workspace_conflict"
		decision.Detail = "Workspace/Sandbox policy conflict requires Station-owned replan."
	case supervisorMetaCountExceeded(meta, []string{"collaboration_rounds", "rounds", "current_round"}, []string{"max_collab_rounds", "max_rounds"}):
		decision.Required = true
		decision.Reason = "max_rounds"
		decision.Detail = "Collaboration rounds reached the configured supervisor limit."
	case supervisorMetaCountExceeded(meta, []string{"fix_loop_count", "fix_attempts", "attempt_no"}, []string{"max_fix_loops"}):
		decision.Required = true
		decision.Reason = "max_fix_loops"
		decision.Detail = "Fix loop count reached the configured supervisor limit."
	case taskTimeBudgetExceeded(task, now):
		decision.Required = true
		decision.Reason = "budget"
		decision.Detail = taskTimeBudgetExceededSummary(task)
	default:
		return decision, nil
	}
	var checkpoint persistence.TaskCheckpoint
	if err := tx.WithContext(ctx).
		Where("task_id = ?", task.ID).
		Order("event_seq DESC, created_at DESC").
		First(&checkpoint).Error; err == nil {
		decision.CheckpointID = strings.TrimSpace(checkpoint.CheckpointID)
		decision.CheckpointEventSeq = checkpoint.EventSeq
	} else if err != gorm.ErrRecordNotFound {
		return decision, err
	}
	var nodes []persistence.CollaborationTaskNode
	if err := tx.WithContext(ctx).
		Where("task_id = ?", task.ID).
		Order("started_at ASC, id ASC").
		Find(&nodes).Error; err != nil {
		return decision, err
	}
	decision.TaskGraphDiff = supervisorTaskGraphDiff(*task, nodes, decision)
	return decision, nil
}

func supervisorReplanInterruptPayload(task persistence.CollaborationTask, decision collaborationSupervisorDecision, now time.Time) map[string]interface{} {
	interruptID := generateID("supervisor_replan")
	payload := map[string]interface{}{
		"source":                  "station.supervisor.tick",
		"block_kind":              "decision",
		"interrupt_id":            interruptID,
		"block_id":                interruptID,
		"interrupt_type":          collaborationSupervisorInterruptReplan,
		"human_decision_id":       interruptID,
		"question":                "Supervisor detected a blocked task. Replan from the latest accepted checkpoint?",
		"description":             decision.Detail,
		"reason":                  decision.Reason,
		"replan_reason":           decision.Reason,
		"supervisor_loop":         collaborationSupervisorLoopEventBus,
		"replan_policy":           collaborationReplanPolicyBeforeB10,
		"resume_anchor_policy":    collaborationResumeAnchorLatestAccepted,
		"workspace_ref":           strings.TrimSpace(task.WorkspaceID),
		"recommended_choice":      "replan",
		"rollback_impact":         "Accepted checkpoint artifacts are retained; only the blocked subgraph is replanned.",
		"requested_at":            now.UTC().Format(time.RFC3339Nano),
		"requires_station_replan": true,
		"options": []map[string]interface{}{
			{"id": "replan", "label": "Replan from checkpoint", "text": "replan", "action": "replan", "recommended": true},
			{"id": "continue", "label": "Continue", "text": "continue", "action": "continue"},
			{"id": "cancel", "label": "Cancel task", "text": "cancel", "action": "cancel"},
		},
	}
	if decision.CheckpointID != "" {
		payload["resume_anchor_checkpoint_id"] = decision.CheckpointID
		payload["resume_anchor_event_seq"] = decision.CheckpointEventSeq
	}
	if len(decision.TaskGraphDiff) > 0 {
		payload["task_graph_diff"] = decision.TaskGraphDiff
	}
	return payload
}

func blockingGateInterruptPayload(task persistence.CollaborationTask, node persistence.CollaborationTaskNode, decision nodeResultGateDecision) map[string]interface{} {
	interruptID := firstNonEmptyString(
		fmt.Sprintf("gate_blocked_%s_%s", strings.TrimSpace(task.ID), strings.TrimSpace(decision.GateID)),
		generateID("gate_blocked"),
	)
	summary := strings.TrimSpace(decision.Summary)
	if summary == "" {
		summary = "Blocking gate failed."
	}
	return map[string]interface{}{
		"source":                "station.gate_runner",
		"block_kind":            "decision",
		"interrupt_id":          interruptID,
		"block_id":              interruptID,
		"interrupt_type":        "human_decision",
		"human_decision_id":     interruptID,
		"reason":                "gate_blocked",
		"question":              "A blocking gate failed. Choose the Station recovery path.",
		"description":           summary,
		"gate_id":               strings.TrimSpace(decision.GateID),
		"gate_summary":          summary,
		"node_id":               strings.TrimSpace(node.ID),
		"agent_id":              strings.TrimSpace(node.AgentID),
		"recommended_choice":    "rerun_failed_node",
		"rollback_impact":       "Only the blocked node is reset when rerun is selected; completed prerequisite artifacts are retained.",
		"requires_goal_owner":   true,
		"requires_station_gate": true,
		"options": []map[string]interface{}{
			{"id": "rerun_failed_node", "label": "Rerun failed node", "text": "Rerun failed node", "action": "rerun_failed_node", "recommended": true},
			{"id": "accept_risk", "label": "Accept risk", "text": "Accept risk", "action": "accept_risk"},
			{"id": "continue", "label": "Continue", "text": "Continue", "action": "continue"},
			{"id": "cancel", "label": "Cancel task", "text": "Cancel task", "action": "cancel"},
		},
	}
}

func supervisorTaskGraphDiff(task persistence.CollaborationTask, nodes []persistence.CollaborationTaskNode, decision collaborationSupervisorDecision) map[string]interface{} {
	affectedNodeIDs := []string{}
	retainedNodeIDs := []string{}
	for index := range nodes {
		nodeID := strings.TrimSpace(nodes[index].ID)
		if nodeID == "" {
			continue
		}
		switch model.TaskNodeStatus(nodes[index].Status) {
		case model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED, model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED:
			retainedNodeIDs = append(retainedNodeIDs, nodeID)
		default:
			affectedNodeIDs = append(affectedNodeIDs, nodeID)
		}
	}
	if len(affectedNodeIDs) == 0 {
		for index := range nodes {
			nodeID := strings.TrimSpace(nodes[index].ID)
			if nodeID != "" {
				affectedNodeIDs = append(affectedNodeIDs, nodeID)
			}
		}
	}
	diff := map[string]interface{}{
		"version":                      "atelier.task_graph_diff/v0",
		"scope":                        "blocked_subgraph",
		"task_id":                      strings.TrimSpace(task.ID),
		"reason":                       decision.Reason,
		"affected_node_ids":            affectedNodeIDs,
		"retained_node_ids":            retainedNodeIDs,
		"requires_goal_owner_approval": true,
		"proposed_actions": []map[string]interface{}{
			{
				"action":       "requeue_blocked_subgraph",
				"node_ids":     affectedNodeIDs,
				"target_state": "pending_after_approval",
			},
		},
	}
	if decision.CheckpointID != "" {
		diff["resume_anchor"] = map[string]interface{}{
			"checkpoint_id": decision.CheckpointID,
			"event_seq":     decision.CheckpointEventSeq,
		}
	}
	return diff
}

func supervisorMetaBool(meta map[string]string, keys ...string) bool {
	for _, key := range keys {
		switch strings.ToLower(strings.TrimSpace(meta[key])) {
		case "1", "true", "yes", "y", "blocked", "conflict":
			return true
		}
	}
	return false
}

func supervisorMetaIn(meta map[string]string, key string, values ...string) bool {
	actual := strings.ToLower(strings.TrimSpace(meta[key]))
	for _, value := range values {
		if actual == strings.ToLower(strings.TrimSpace(value)) {
			return true
		}
	}
	return false
}

func supervisorMetaCountExceeded(meta map[string]string, currentKeys []string, limitKeys []string) bool {
	current, ok := firstSupervisorMetaInt(meta, currentKeys)
	if !ok {
		return false
	}
	limit, ok := firstSupervisorMetaInt(meta, limitKeys)
	return ok && limit > 0 && current >= limit
}

func firstSupervisorMetaInt(meta map[string]string, keys []string) (int, bool) {
	for _, key := range keys {
		value, err := strconv.Atoi(strings.TrimSpace(meta[key]))
		if err == nil {
			return value, true
		}
	}
	return 0, false
}

func (s *OrchestrationService) CanResumeCollaborationTask(ctx context.Context, actorID, taskID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	actorID = strings.TrimSpace(actorID)
	taskID = strings.TrimSpace(taskID)
	if actorID == "" || taskID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id and task_id are required", nil)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return canResumeCollaborationTaskTx(ctx, tx, actorID, taskID)
	})
}

func resolveCollaborationInterruptTx(
	ctx context.Context,
	tx *gorm.DB,
	writer *TaskEventWriter,
	actorID string,
	taskID string,
	reason string,
	eventType string,
	payload map[string]interface{},
) (persistence.CollaborationTask, []persistence.CollaborationTaskNode, bool, *persistence.TaskEvent, error) {
	task, nodes, resumed, record, _, err := resolveCollaborationInterruptWithLiveResumeTx(ctx, tx, writer, actorID, taskID, reason, eventType, payload, nil)
	return task, nodes, resumed, record, err
}

func resolveCollaborationInterruptWithLiveResumeTx(
	ctx context.Context,
	tx *gorm.DB,
	writer *TaskEventWriter,
	actorID string,
	taskID string,
	reason string,
	eventType string,
	payload map[string]interface{},
	broker *LiveResumeBroker,
) (persistence.CollaborationTask, []persistence.CollaborationTaskNode, bool, *persistence.TaskEvent, LiveResumeDecision, error) {
	if err := normalizeHumanDecisionRouteTx(ctx, tx, taskID, payload); err != nil {
		return persistence.CollaborationTask{}, nil, false, nil, LiveResumeDecision{}, err
	}
	task, nodes, resumed, liveDecision, err := resumeCollaborationTaskWithLiveResumeTx(ctx, tx, actorID, taskID, reason, gateRecoveryActionFromPayload(payload), broker, payload)
	if err != nil {
		return task, nodes, false, nil, LiveResumeDecision{}, err
	}
	record, err := writer.appendTx(ctx, tx, "", taskID, liveDecision.StepID, liveDecision.TurnID, eventType, payload)
	if err != nil {
		return task, nodes, false, nil, LiveResumeDecision{}, err
	}
	if strings.TrimSpace(liveDecision.InterruptID) != "" {
		liveDecision = liveResumeDecisionFromResolvedEvent(liveDecision, payload, record)
	}
	return task, nodes, resumed, record, liveDecision, nil
}

func resumeCollaborationTaskWithLiveResumeTx(
	ctx context.Context,
	tx *gorm.DB,
	actorID string,
	taskID string,
	reason string,
	action gateRecoveryAction,
	broker *LiveResumeBroker,
	payload map[string]interface{},
) (persistence.CollaborationTask, []persistence.CollaborationTaskNode, bool, LiveResumeDecision, error) {
	task, nodes, liveDecision, ok, err := tryLiveResumePausedRunningTaskTx(ctx, tx, actorID, taskID, reason, broker, payload)
	if err != nil {
		return task, nodes, false, LiveResumeDecision{}, err
	}
	if ok {
		return task, nodes, false, liveDecision, nil
	}
	task, nodes, resumed, err := resumeCollaborationTaskWithGateRecoveryTx(ctx, tx, actorID, taskID, reason, action, payload)
	return task, nodes, resumed, LiveResumeDecision{}, err
}

func tryLiveResumePausedRunningTaskTx(
	ctx context.Context,
	tx *gorm.DB,
	actorID string,
	taskID string,
	reason string,
	broker *LiveResumeBroker,
	payload map[string]interface{},
) (persistence.CollaborationTask, []persistence.CollaborationTaskNode, LiveResumeDecision, bool, error) {
	var task persistence.CollaborationTask
	if err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND goal_owner_id = ?", taskID, actorID).
		First(&task).Error; err != nil {
		return task, nil, LiveResumeDecision{}, false, err
	}
	var nodes []persistence.CollaborationTaskNode
	if err := tx.WithContext(ctx).Where("task_id = ?", task.ID).Order("started_at ASC").Find(&nodes).Error; err != nil {
		return task, nil, LiveResumeDecision{}, false, err
	}
	if model.CollaborationTaskStatus(task.Status) != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED || !hasRunningCollaborationNode(nodes) {
		return task, nodes, LiveResumeDecision{}, false, nil
	}
	interruptID := firstPayloadString(payload, "interrupt_id", "block_id")
	if broker == nil || !broker.HasWaiter(task.ID, interruptID) {
		return task, nodes, LiveResumeDecision{}, false, nil
	}
	meta := map[string]string{}
	_ = json.Unmarshal([]byte(task.MetaJSON), &meta)
	meta["resume_state"] = "live_ready"
	meta["resume_reason"] = strings.TrimSpace(reason)
	meta["resume_requested_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	meta["live_resume_interrupt_id"] = interruptID
	metaJSON, _ := json.Marshal(meta)
	task.MetaJSON = string(metaJSON)
	task.Status = int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING)
	if err := tx.WithContext(ctx).Model(&persistence.CollaborationTask{}).
		Where("id = ?", task.ID).
		Updates(map[string]interface{}{
			"status":    task.Status,
			"meta_json": task.MetaJSON,
		}).Error; err != nil {
		return task, nodes, LiveResumeDecision{}, false, err
	}
	liveDecision := LiveResumeDecision{
		TaskID:            task.ID,
		InterruptID:       interruptID,
		Reason:            strings.TrimSpace(reason),
		ResumePayloadJSON: firstPayloadString(payload, "resume_payload_json", "resumePayloadJson"),
	}
	var interrupt persistence.InterruptRequest
	if err := tx.WithContext(ctx).Where("task_id = ? AND interrupt_id = ?", task.ID, interruptID).First(&interrupt).Error; err == nil {
		liveDecision.StepID = strings.TrimSpace(interrupt.StepID)
		liveDecision.TurnID = strings.TrimSpace(interrupt.TurnID)
		liveDecision.PayloadJSON = strings.TrimSpace(interrupt.PayloadJSON)
	} else if err != gorm.ErrRecordNotFound {
		return task, nodes, LiveResumeDecision{}, false, err
	}
	return task, nodes, liveDecision, true, nil
}

func hasRunningCollaborationNode(nodes []persistence.CollaborationTaskNode) bool {
	for index := range nodes {
		if nodes[index].Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
			return true
		}
	}
	return false
}

func liveResumeDecisionFromResolvedEvent(decision LiveResumeDecision, payload map[string]interface{}, record *persistence.TaskEvent) LiveResumeDecision {
	if record != nil {
		decision.EventID = strings.TrimSpace(record.ID)
		decision.EventSeq = record.EventSeq
		if strings.TrimSpace(decision.StepID) == "" {
			decision.StepID = strings.TrimSpace(record.StepID)
		}
		if strings.TrimSpace(decision.TurnID) == "" {
			decision.TurnID = strings.TrimSpace(record.TurnID)
		}
	}
	if strings.TrimSpace(decision.PayloadJSON) == "" {
		if encoded, err := json.Marshal(payload); err == nil {
			decision.PayloadJSON = string(encoded)
		}
	}
	if strings.TrimSpace(decision.ResumePayloadJSON) == "" {
		decision.ResumePayloadJSON = firstPayloadString(payload, "resume_payload_json", "resumePayloadJson")
	}
	return decision
}

func resumeCollaborationTaskTx(
	ctx context.Context,
	tx *gorm.DB,
	actorID string,
	taskID string,
	reason string,
) (persistence.CollaborationTask, []persistence.CollaborationTaskNode, bool, error) {
	return resumeCollaborationTaskWithGateRecoveryTx(ctx, tx, actorID, taskID, reason, "", nil)
}

func resumeCollaborationTaskWithGateRecoveryTx(
	ctx context.Context,
	tx *gorm.DB,
	actorID string,
	taskID string,
	reason string,
	action gateRecoveryAction,
	payload map[string]interface{},
) (persistence.CollaborationTask, []persistence.CollaborationTaskNode, bool, error) {
	var task persistence.CollaborationTask
	if err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND goal_owner_id = ?", taskID, actorID).
		First(&task).Error; err != nil {
		return task, nil, false, err
	}
	var nodes []persistence.CollaborationTaskNode
	if err := tx.WithContext(ctx).Where("task_id = ?", task.ID).Order("started_at ASC").Find(&nodes).Error; err != nil {
		return task, nil, false, err
	}
	if err := validateCollaborationTaskResumable(task, nodes); err != nil {
		return task, nodes, false, err
	}
	switch model.CollaborationTaskStatus(task.Status) {
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING:
		return task, nodes, false, nil
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED:
		meta := map[string]string{}
		_ = json.Unmarshal([]byte(task.MetaJSON), &meta)
		if supervisorReplanActionFromPayload(payload) {
			var applied bool
			var err error
			task, nodes, applied, err = applySupervisorReplanTx(ctx, tx, task, nodes, meta, payload)
			if err != nil {
				return task, nodes, false, err
			}
			if !applied {
				return task, nodes, false, nil
			}
		}
		meta = map[string]string{}
		_ = json.Unmarshal([]byte(task.MetaJSON), &meta)
		if meta["gate_blocked"] == "true" {
			var recovered bool
			var err error
			task, nodes, recovered, err = applyGateBlockedRecoveryTx(ctx, tx, task, nodes, meta, action)
			if err != nil {
				return task, nodes, false, err
			}
			if !recovered {
				return task, nodes, false, nil
			}
		}
		meta = map[string]string{}
		_ = json.Unmarshal([]byte(task.MetaJSON), &meta)
		meta["resume_state"] = "ready"
		meta["resume_reason"] = strings.TrimSpace(reason)
		meta["resume_requested_at"] = time.Now().UTC().Format(time.RFC3339Nano)
		metaJSON, _ := json.Marshal(meta)
		task.MetaJSON = string(metaJSON)
		task.Status = int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING)
		if err := tx.WithContext(ctx).Model(&persistence.CollaborationTask{}).
			Where("id = ?", task.ID).
			Updates(map[string]interface{}{
				"status":    task.Status,
				"meta_json": task.MetaJSON,
			}).Error; err != nil {
			return task, nodes, false, err
		}
		return task, nodes, true, nil
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED:
		return task, nodes, false, errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, "terminal collaboration task cannot be resumed", nil)
	default:
		return task, nodes, false, errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, "collaboration task is not resumable", nil)
	}
}

func canResumeCollaborationTaskTx(ctx context.Context, tx *gorm.DB, actorID string, taskID string) error {
	var task persistence.CollaborationTask
	if err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND goal_owner_id = ?", taskID, actorID).
		First(&task).Error; err != nil {
		return err
	}
	var nodes []persistence.CollaborationTaskNode
	if err := tx.WithContext(ctx).Where("task_id = ?", task.ID).Order("started_at ASC").Find(&nodes).Error; err != nil {
		return err
	}
	return validateCollaborationTaskResumable(task, nodes)
}

type humanDecisionRoute struct {
	Reason     string
	Action     string
	Transition string
}

func normalizeHumanDecisionRouteTx(ctx context.Context, tx *gorm.DB, taskID string, payload map[string]interface{}) error {
	if payload == nil || strings.TrimSpace(firstPayloadString(payload, "block_kind")) != "decision_resolved" {
		return nil
	}
	interruptID := strings.TrimSpace(firstPayloadString(payload, "interrupt_id", "block_id"))
	if interruptID == "" {
		return nil
	}
	requestPayload := map[string]interface{}{}
	var interrupt persistence.InterruptRequest
	if err := tx.WithContext(ctx).
		Where("task_id = ? AND interrupt_id = ? AND status = ?", taskID, interruptID, int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING)).
		First(&interrupt).Error; err == nil {
		_ = json.Unmarshal([]byte(interrupt.PayloadJSON), &requestPayload)
	} else if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}
	choice := strings.TrimSpace(firstPayloadString(payload, "choice"))
	route := humanDecisionRoute{
		Reason: normalizeHumanDecisionReason(atelierFirstNonEmpty(
			firstPayloadString(payload, "human_decision_reason", "humanDecisionReason", "escalation_reason", "escalationReason", "reason"),
			firstPayloadString(requestPayload, "human_decision_reason", "humanDecisionReason", "escalation_reason", "escalationReason", "reason"),
		)),
		Action: normalizeHumanDecisionAction(atelierFirstNonEmpty(
			firstPayloadString(payload, "human_decision_action", "humanDecisionAction", "option_action", "optionAction", "action"),
			selectedHumanDecisionOptionAction(requestPayload, choice),
			choice,
		)),
	}
	if route.Action == "" {
		return nil
	}
	if route.Reason == "" {
		route.Reason = inferHumanDecisionReasonFromTaskPayload(ctx, tx, taskID, route.Action)
	}
	if route.Reason == "policy" && route.Action == "continue" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, "policy human decision route cannot continue hard deny", nil)
	}
	route.Transition = humanDecisionTransition(route.Reason, route.Action)
	payload["human_decision_route"] = "station.orchestration"
	payload["human_decision_reason"] = route.Reason
	payload["human_decision_action"] = route.Action
	payload["human_decision_transition"] = route.Transition
	for _, key := range []string{"gate_id", "gateId", "node_id", "nodeId"} {
		if strings.TrimSpace(firstPayloadString(payload, key)) == "" {
			if value := strings.TrimSpace(firstPayloadString(requestPayload, key)); value != "" {
				payload[key] = value
			}
		}
	}
	switch route.Action {
	case "continue":
		payload["resume_action"] = "continue"
		if route.Reason == "gate_blocked" {
			payload["gate_recovery_action"] = string(gateRecoveryActionContinue)
		}
	case "rerun_failed_node":
		payload["gate_recovery_action"] = string(gateRecoveryActionRerun)
	case "accept_risk":
		payload["gate_recovery_action"] = string(gateRecoveryActionAccept)
	case "cancel":
		payload["gate_recovery_action"] = string(gateRecoveryActionCancel)
	case "replan":
		payload["replan_action"] = "replan"
	case "mark_rejected":
		payload["human_review_result"] = "rejected"
	}
	if strings.TrimSpace(firstPayloadString(payload, "resume_payload_json", "resumePayloadJson")) == "" {
		payload["resume_payload_json"] = mustJSONString(map[string]string{
			"choice":                    choice,
			"block_id":                  interruptID,
			"human_decision_reason":     route.Reason,
			"human_decision_action":     route.Action,
			"human_decision_transition": route.Transition,
		})
	}
	return nil
}

func selectedHumanDecisionOptionAction(payload map[string]interface{}, choice string) string {
	choice = normalizeHumanDecisionChoice(choice)
	for _, key := range []string{"options", "human_decision_options", "humanDecisionOptions"} {
		options, ok := payload[key].([]interface{})
		if !ok {
			continue
		}
		for _, item := range options {
			option, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			for _, candidate := range []string{
				firstPayloadString(option, "id"),
				firstPayloadString(option, "label"),
				firstPayloadString(option, "text"),
			} {
				if choice != "" && normalizeHumanDecisionChoice(candidate) == choice {
					return firstPayloadString(option, "action", "option_action", "optionAction")
				}
			}
		}
	}
	return ""
}

func inferHumanDecisionReasonFromTaskPayload(ctx context.Context, tx *gorm.DB, taskID string, action string) string {
	if action == "rerun_failed_node" || action == "accept_risk" {
		var task persistence.CollaborationTask
		if err := tx.WithContext(ctx).Select("meta_json").Where("id = ?", taskID).First(&task).Error; err == nil {
			meta := map[string]string{}
			_ = json.Unmarshal([]byte(task.MetaJSON), &meta)
			if meta["gate_blocked"] == "true" {
				return "gate_blocked"
			}
		}
	}
	return ""
}

func normalizeHumanDecisionReason(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "budget", "预算":
		return "budget"
	case "policy", "策略", "政策":
		return "policy"
	case "gate_blocked", "gate-blocked", "gate blocked", "blocking_gate", "阻断门禁":
		return "gate_blocked"
	case "max_rounds", "max-rounds":
		return "max_rounds"
	case "max_fix_loops", "max-fix-loops", "fix_loop", "fix-loops":
		return "max_fix_loops"
	case "l2_review", "l2-review", "l2":
		return "l2_review"
	case "workspace_conflict", "workspace-conflict", "workspace conflict", "工作区冲突":
		return "workspace_conflict"
	case "unknown":
		return "unknown"
	default:
		return ""
	}
}

func normalizeHumanDecisionAction(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "continue", "resume", "继续", "继续执行", "接受", "通过":
		return "continue"
	case "rerun_failed_node", "rerun-failed-node", "retry_failed_node", "retry-failed-node", "rerun", "retry", "复跑", "重试", "重新执行":
		return "rerun_failed_node"
	case "accept_risk", "accept-risk", "accept", "accepted", "接受风险":
		return "accept_risk"
	case "replan", "apply_replan", "重新规划", "重规划":
		return "replan"
	case "cancel", "cancel_task", "取消", "终止":
		return "cancel"
	case "mark_rejected", "mark-rejected", "reject", "rejected", "拒绝", "标记拒绝":
		return "mark_rejected"
	default:
		return ""
	}
}

func normalizeHumanDecisionChoice(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func humanDecisionTransition(reason string, action string) string {
	switch reason + ":" + action {
	case "gate_blocked:rerun_failed_node":
		return "paused/escalated->executing"
	case "gate_blocked:accept_risk":
		return "paused->verifying"
	case "gate_blocked:continue":
		return "paused->executing"
	case "budget:continue":
		return "escalated->executing"
	case "policy:continue":
		return "escalated"
	case "max_fix_loops:replan", "workspace_conflict:replan":
		return "blocked/escalated->replanning"
	case "l2_review:mark_rejected":
		return "awaiting_human->rejected"
	case "l2_review:continue":
		return "awaiting_human->accepted"
	default:
		if action == "cancel" {
			return "paused/escalated->cancelled"
		}
		return ""
	}
}

func gateRecoveryActionFromPayload(payload map[string]interface{}) gateRecoveryAction {
	action := strings.ToLower(strings.TrimSpace(firstPayloadString(payload, "gate_recovery_action", "gateRecoveryAction", "action")))
	if action == "" {
		resumePayload := strings.TrimSpace(firstPayloadString(payload, "resume_payload_json", "resumePayloadJson"))
		if resumePayload != "" {
			var decoded map[string]interface{}
			if json.Unmarshal([]byte(resumePayload), &decoded) == nil {
				action = strings.ToLower(strings.TrimSpace(firstPayloadString(decoded, "gate_recovery_action", "gateRecoveryAction", "action")))
				if action == "" {
					action = strings.ToLower(strings.TrimSpace(firstPayloadString(decoded, "choice")))
				}
			}
		}
	}
	if action == "" {
		action = strings.ToLower(strings.TrimSpace(firstPayloadString(payload, "choice")))
	}
	switch action {
	case "continue", "继续", "继续执行", "resume":
		return gateRecoveryActionContinue
	case "rerun", "retry", "retry_failed_node", "rerun_failed_node", "重试", "复跑", "重新执行":
		return gateRecoveryActionRerun
	case "accept", "accepted", "mark_accepted", "接受", "通过", "接受风险":
		return gateRecoveryActionAccept
	case "cancel", "cancel_task", "取消", "终止":
		return gateRecoveryActionCancel
	default:
		return ""
	}
}

func supervisorReplanActionFromPayload(payload map[string]interface{}) bool {
	action := strings.ToLower(strings.TrimSpace(firstPayloadString(payload, "replan_action", "replanAction", "action", "choice")))
	if action == "" {
		resumePayload := strings.TrimSpace(firstPayloadString(payload, "resume_payload_json", "resumePayloadJson"))
		if resumePayload != "" {
			var decoded map[string]interface{}
			if json.Unmarshal([]byte(resumePayload), &decoded) == nil {
				action = strings.ToLower(strings.TrimSpace(firstPayloadString(decoded, "replan_action", "replanAction", "action", "choice")))
			}
		}
	}
	switch action {
	case "replan", "apply_replan", "重新规划", "重规划":
		return true
	default:
		return false
	}
}

func applySupervisorReplanTx(
	ctx context.Context,
	tx *gorm.DB,
	task persistence.CollaborationTask,
	nodes []persistence.CollaborationTaskNode,
	meta map[string]string,
	payload map[string]interface{},
) (persistence.CollaborationTask, []persistence.CollaborationTaskNode, bool, error) {
	interruptID := strings.TrimSpace(firstPayloadString(payload, "interrupt_id", "block_id"))
	if interruptID == "" {
		return task, nodes, false, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "supervisor replan interrupt_id is required", nil)
	}
	var interrupt persistence.InterruptRequest
	if err := tx.WithContext(ctx).
		Where("task_id = ? AND interrupt_id = ? AND interrupt_type = ? AND status = ?", task.ID, interruptID, collaborationSupervisorInterruptReplan, int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING)).
		First(&interrupt).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return task, nodes, false, errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, "pending supervisor replan interrupt is required", nil)
		}
		return task, nodes, false, err
	}
	requestPayload := map[string]interface{}{}
	if err := json.Unmarshal([]byte(interrupt.PayloadJSON), &requestPayload); err != nil {
		return task, nodes, false, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid supervisor replan payload", err)
	}
	diff, ok := requestPayload["task_graph_diff"].(map[string]interface{})
	if !ok {
		return task, nodes, false, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "supervisor replan task_graph_diff is required", nil)
	}
	if strings.TrimSpace(firstPayloadString(diff, "version")) != "atelier.task_graph_diff/v0" {
		return task, nodes, false, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "unsupported supervisor task_graph_diff version", nil)
	}
	if diffTaskID := strings.TrimSpace(firstPayloadString(diff, "task_id", "taskId")); diffTaskID != "" && diffTaskID != task.ID {
		return task, nodes, false, errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, "supervisor task_graph_diff task_id mismatch", nil)
	}
	affectedNodeIDs := payloadStringList(diff, "affected_node_ids")
	if len(affectedNodeIDs) == 0 {
		return task, nodes, false, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "supervisor task_graph_diff affected_node_ids is required", nil)
	}
	affected := map[string]bool{}
	for _, nodeID := range affectedNodeIDs {
		if strings.TrimSpace(nodeID) != "" {
			affected[strings.TrimSpace(nodeID)] = true
		}
	}
	if len(affected) == 0 {
		return task, nodes, false, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "supervisor task_graph_diff affected_node_ids is empty", nil)
	}
	applied := []string{}
	for index := range nodes {
		nodeID := strings.TrimSpace(nodes[index].ID)
		if !affected[nodeID] {
			continue
		}
		nodes[index].Status = int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING)
		nodes[index].ResultSummary = ""
		if err := tx.WithContext(ctx).Model(&persistence.CollaborationTaskNode{}).
			Where("id = ? AND task_id = ?", nodeID, task.ID).
			Updates(map[string]interface{}{
				"status":         nodes[index].Status,
				"result_summary": "",
			}).Error; err != nil {
			return task, nodes, false, err
		}
		applied = append(applied, nodeID)
		delete(affected, nodeID)
	}
	if len(affected) > 0 {
		missing := make([]string, 0, len(affected))
		for nodeID := range affected {
			missing = append(missing, nodeID)
		}
		return task, nodes, false, errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, fmt.Sprintf("supervisor task_graph_diff references unknown nodes: %s", strings.Join(missing, ",")), nil)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	applyMeta := copyStringMap(meta)
	applyMeta["supervisor_state"] = "replan_applied"
	applyMeta["replan_required"] = "false"
	applyMeta["task_graph_diff_status"] = "applied"
	applyMeta["task_graph_diff_applied_at"] = now
	applyMeta["task_graph_diff_applied_node_ids"] = strings.Join(applied, ",")
	applyMeta["task_graph_diff_apply_source"] = "station.interrupt.resolve"
	applyMeta["supervisor_replan_interrupt_id"] = interruptID
	metaJSON, _ := json.Marshal(applyMeta)
	task.MetaJSON = string(metaJSON)
	if err := tx.WithContext(ctx).Model(&persistence.CollaborationTask{}).
		Where("id = ?", task.ID).
		Updates(map[string]interface{}{"meta_json": task.MetaJSON}).Error; err != nil {
		return task, nodes, false, err
	}
	return task, nodes, true, nil
}

func payloadStringList(payload map[string]interface{}, key string) []string {
	value, ok := payload[key]
	if !ok || value == nil {
		return nil
	}
	switch typed := value.(type) {
	case []string:
		return typed
	case []interface{}:
		values := make([]string, 0, len(typed))
		for _, item := range typed {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text != "" {
				values = append(values, text)
			}
		}
		return values
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		parts := strings.Split(typed, ",")
		values := make([]string, 0, len(parts))
		for _, part := range parts {
			text := strings.TrimSpace(part)
			if text != "" {
				values = append(values, text)
			}
		}
		return values
	default:
		return nil
	}
}

func applyGateBlockedRecoveryTx(
	ctx context.Context,
	tx *gorm.DB,
	task persistence.CollaborationTask,
	nodes []persistence.CollaborationTaskNode,
	meta map[string]string,
	action gateRecoveryAction,
) (persistence.CollaborationTask, []persistence.CollaborationTaskNode, bool, error) {
	if action == "" {
		action = gateRecoveryActionContinue
	}
	gateID := strings.TrimSpace(meta["gate_blocked_id"])
	now := time.Now()
	if err := expireOrRejectActiveGateRecoveryLeasesTx(ctx, tx, task.ID, now); err != nil {
		return task, nodes, false, err
	}
	recoveryMeta := copyStringMap(meta)
	recoveryMeta["gate_blocked"] = "false"
	recoveryMeta["gate_recovery_action"] = string(action)
	recoveryMeta["gate_recovered_at"] = now.UTC().Format(time.RFC3339Nano)
	delete(recoveryMeta, "gate_blocked_id")
	delete(recoveryMeta, "gate_blocked_summary")
	delete(recoveryMeta, "gate_blocked_node")
	metaJSON, _ := json.Marshal(recoveryMeta)
	task.MetaJSON = string(metaJSON)

	switch action {
	case gateRecoveryActionCancel:
		task.Status = int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED)
		if err := updateBlockedGatePlansTx(ctx, tx, task.ID, gateID, "cancelled"); err != nil {
			return task, nodes, false, err
		}
		if err := tx.WithContext(ctx).Model(&persistence.CollaborationTask{}).
			Where("id = ?", task.ID).
			Updates(map[string]interface{}{
				"status":    task.Status,
				"meta_json": task.MetaJSON,
				"ended_at":  now,
			}).Error; err != nil {
			return task, nodes, false, err
		}
		for index := range nodes {
			if nodes[index].Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING) {
				nodes[index].Status = int32(model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED)
				nodes[index].ResultSummary = "Task cancelled after blocking gate."
				nodes[index].EndedAt = now
				if err := tx.WithContext(ctx).Model(&persistence.CollaborationTaskNode{}).
					Where("id = ?", nodes[index].ID).
					Updates(map[string]interface{}{
						"status":         nodes[index].Status,
						"result_summary": nodes[index].ResultSummary,
						"ended_at":       nodes[index].EndedAt,
					}).Error; err != nil {
					return task, nodes, false, err
				}
			}
		}
		return task, nodes, false, nil
	case gateRecoveryActionRerun:
		if err := updateBlockedGatePlansTx(ctx, tx, task.ID, gateID, "active"); err != nil {
			return task, nodes, false, err
		}
		for index := range nodes {
			if gateBlockedNodeMatches(&nodes[index], meta, gateID) {
				nodes[index].Status = int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING)
				nodes[index].ResultSummary = ""
				if err := tx.WithContext(ctx).Model(&persistence.CollaborationTaskNode{}).
					Where("id = ?", nodes[index].ID).
					Updates(map[string]interface{}{
						"status":         nodes[index].Status,
						"result_summary": "",
					}).Error; err != nil {
					return task, nodes, false, err
				}
				break
			}
		}
	case gateRecoveryActionAccept:
		if err := updateBlockedGatePlansTx(ctx, tx, task.ID, gateID, "accepted"); err != nil {
			return task, nodes, false, err
		}
	default:
		if err := updateBlockedGatePlansTx(ctx, tx, task.ID, gateID, "continued"); err != nil {
			return task, nodes, false, err
		}
	}
	return task, nodes, true, nil
}

func updateBlockedGatePlansTx(ctx context.Context, tx *gorm.DB, taskID string, gateID string, status string) error {
	query := tx.WithContext(ctx).Model(&persistence.TaskGatePlan{}).Where("task_id = ? AND status = ?", taskID, "blocked")
	if strings.TrimSpace(gateID) != "" {
		query = query.Where("plan_json LIKE ?", fmt.Sprintf("%%%s%%", strings.TrimSpace(gateID)))
	}
	return query.Updates(map[string]interface{}{
		"status":     status,
		"updated_at": time.Now(),
	}).Error
}

func expireOrRejectActiveGateRecoveryLeasesTx(ctx context.Context, tx *gorm.DB, taskID string, now time.Time) error {
	var leases []persistence.ExecutorLease
	if err := tx.WithContext(ctx).Where("task_id = ? AND status = ?", taskID, executorLeaseStatusActive).Find(&leases).Error; err != nil {
		return err
	}
	for index := range leases {
		lease := &leases[index]
		if lease.ExpiresAt.After(now) {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, "gate-blocked task has an active executor lease", nil)
		}
		if err := tx.WithContext(ctx).Model(&persistence.ExecutorLease{}).Where("lease_id = ?", lease.LeaseID).Updates(map[string]interface{}{
			"status":       executorLeaseStatusExpired,
			"heartbeat_at": now,
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

func gateBlockedNodeMatches(node *persistence.CollaborationTaskNode, meta map[string]string, gateID string) bool {
	if node == nil {
		return false
	}
	if nodeID := strings.TrimSpace(meta["gate_blocked_node"]); nodeID != "" {
		return node.ID == nodeID
	}
	return strings.TrimSpace(gateID) != "" && node.Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED)
}

func validateCollaborationTaskResumable(task persistence.CollaborationTask, nodes []persistence.CollaborationTaskNode) error {
	switch model.CollaborationTaskStatus(task.Status) {
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING:
		return nil
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED:
		for index := range nodes {
			if nodes[index].Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
				return errcode.New(
					errcode.AgentInvalidRequest,
					http.StatusConflict,
					"paused collaboration task has a running node; live turn resume is not supported yet",
					nil,
				)
			}
		}
		return nil
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED:
		return errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, "terminal collaboration task cannot be resumed", nil)
	default:
		return errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, "collaboration task is not resumable", nil)
	}
}

func (s *OrchestrationService) SubmitCollaborationNodeResult(ctx context.Context, actorID string, req *model.SubmitCollaborationNodeResultRequest) (*model.CollaborationTask, []*model.TaskNode, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, nil, err
	}
	actorID = strings.TrimSpace(actorID)
	taskID := strings.TrimSpace(req.GetTaskId())
	meta := req.GetMeta()
	nodeID := firstNonEmptyString(req.GetNodeId(), meta["node_id"])
	resultSummary := firstNonEmptyString(req.GetResultSummary(), meta["result_summary"])
	turnID := firstNonEmptyString(req.GetTurnId(), meta["turn_id"])
	leaseID := firstNonEmptyString(req.GetLeaseId(), meta["lease_id"])
	executorID := firstNonEmptyString(req.GetExecutorId(), meta["executor_id"])
	resultStatus := strings.ToLower(firstNonEmptyString(req.GetStatus(), meta["status"]))
	if actorID == "" || taskID == "" || nodeID == "" {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id, task_id and node_id are required", nil)
	}
	if reason := validateEnginePolicyTurnProto(req.GetEnginePolicyTurn()); reason != "" {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, reason, nil)
	}
	if leaseID == "" || executorID == "" {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "lease_id and executor_id are required", nil)
	}
	projectionEvents, gateDecision, err := collaborationProjectionEventsFromNodeResultRequest(taskID, nodeID, executorID, req)
	if err != nil {
		return nil, nil, err
	}
	if resultSummary == "" {
		resultSummary = "Desktop executor completed without a final response."
	}
	nodeStatus := model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED
	eventType := domain.EventTypeCollaborationNodeCompleted
	switch resultStatus {
	case "", "completed":
	case "failed", "error":
		nodeStatus = model.TaskNodeStatus_TASK_NODE_STATUS_FAILED
		eventType = domain.EventTypeCollaborationNodeFailed
	default:
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta.status must be completed or failed", nil)
	}

	var task persistence.CollaborationTask
	var node persistence.CollaborationTaskNode
	var lease persistence.ExecutorLease
	var committedEvents []committedTaskEvent
	blockedByGate := false
	writer := s.eventWriter
	if writer == nil {
		writer = NewTaskEventWriter(s.eventBus)
	}
	writer.mu.Lock()
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND goal_owner_id = ?", taskID, actorID).First(&task).Error; err != nil {
			return err
		}
		if task.Status != int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING) {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "collaboration task is not running", nil)
		}
		if err := tx.Where("id = ? AND task_id = ?", nodeID, task.ID).First(&node).Error; err != nil {
			return err
		}
		if node.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "collaboration node is not running", nil)
		}
		agent, agentErr := s.agentService.GetAgent(ctx, actorID, node.AgentID)
		if agentErr != nil {
			return agentErr
		}
		if agentExecutorKind(agent) != model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "collaboration node is not owned by a desktop executor", nil)
		}
		now := time.Now()
		if err := tx.Where(
			"lease_id = ? AND task_id = ? AND step_id = ? AND executor_id = ?",
			leaseID,
			task.ID,
			node.ID,
			executorID,
		).First(&lease).Error; err != nil {
			return err
		}
		if lease.Status != executorLeaseStatusActive {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "executor lease is not active", nil)
		}
		if !lease.ExpiresAt.After(now) {
			_ = tx.Model(&persistence.ExecutorLease{}).Where("lease_id = ?", lease.LeaseID).Updates(map[string]interface{}{
				"status":       executorLeaseStatusExpired,
				"heartbeat_at": now,
			}).Error
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "executor lease expired", nil)
		}
		node.Status = int32(nodeStatus)
		node.ResultSummary = resultSummary
		node.EndedAt = now
		updates := map[string]interface{}{
			"status":         node.Status,
			"result_summary": node.ResultSummary,
			"ended_at":       now,
		}
		if err := tx.Model(&persistence.CollaborationTaskNode{}).Where("id = ?", node.ID).Updates(updates).Error; err != nil {
			return err
		}
		lease.Status = executorLeaseStatusReleased
		lease.HeartbeatAt = now
		if err := tx.Model(&persistence.ExecutorLease{}).Where("lease_id = ?", lease.LeaseID).Updates(map[string]interface{}{
			"status":       executorLeaseStatusReleased,
			"heartbeat_at": now,
		}).Error; err != nil {
			return err
		}
		gatePlanEvents, gatePlanDecision, err := runActiveTaskGatePlanTx(ctx, tx, &task, &node)
		if err != nil {
			return err
		}
		if gatePlanDecision.Blocked && !gateDecision.Blocked {
			gateDecision = gatePlanDecision
		}
		if len(gatePlanEvents) > 0 {
			projectionEvents = append(projectionEvents, gatePlanEvents...)
		}
		if gateDecision.Blocked {
			task.Status = int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED)
			task.MetaJSON = mergeStringMapJSON(task.MetaJSON, map[string]string{
				"gate_blocked":         "true",
				"gate_blocked_id":      gateDecision.GateID,
				"gate_blocked_summary": gateDecision.Summary,
				"gate_blocked_node":    node.ID,
			})
			blockedByGate = true
			if err := tx.Model(&persistence.CollaborationTask{}).Where("id = ?", task.ID).Updates(map[string]interface{}{
				"status":    task.Status,
				"meta_json": task.MetaJSON,
			}).Error; err != nil {
				return err
			}
			projectionEvents = append(projectionEvents, collaborationProjectionEvent{
				EventType: domain.EventTypeCollaborationInterruptRequested,
				Payload:   blockingGateInterruptPayload(task, node, gateDecision),
			})
		}
		events, err := appendNodeResultTaskEventsTx(ctx, tx, writer, &task, &node, &lease, eventType, turnID, resultSummary, resultStatus, req.GetEnginePolicyTurn(), projectionEvents)
		if err != nil {
			return err
		}
		committedEvents = events
		return nil
	})
	writer.mu.Unlock()
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "collaboration task or node not found", err)
		}
		return nil, nil, err
	}

	s.updateTaskMeta(ctx, db, &task, map[string]string{
		"desktop_executor_state": "submitted_node_result",
		"desktop_executor_node":  node.ID,
		"desktop_executor_agent": node.AgentID,
		"desktop_executor_lease": lease.LeaseID,
	})
	s.publishCommittedTaskEvents(ctx, committedEvents)

	var nodes []persistence.CollaborationTaskNode
	if err := db.WithContext(ctx).Where("task_id = ?", task.ID).Order("started_at ASC").Find(&nodes).Error; err != nil {
		return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list collaboration task nodes", err)
	}
	if !blockedByGate {
		s.startTaskExecution(actorID, task, nodes, "desktop-node-result")
	}
	return taskRecordToProto(&task), nodeRecordsToProto(nodes), nil
}

func (s *OrchestrationService) ClaimDesktopExecutorTask(ctx context.Context, actorID string, req *model.ClaimDesktopExecutorTaskRequest) (*model.ClaimDesktopExecutorTaskResponse, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	actorID = strings.TrimSpace(actorID)
	executorID := strings.TrimSpace(req.GetExecutorId())
	if actorID == "" || executorID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id and executor_id are required", nil)
	}
	ttl := normalizeExecutorLeaseTTL(req.GetLeaseTtlMs())
	taskFilter := strings.TrimSpace(req.GetTaskId())
	agentFilter := strings.TrimSpace(req.GetAgentId())
	nodeFilter := strings.TrimSpace(req.GetNodeId())
	now := time.Now()

	var claimedTask persistence.CollaborationTask
	var claimedNode persistence.CollaborationTaskNode
	var claimedLease persistence.ExecutorLease
	claimed := false
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var tasks []persistence.CollaborationTask
		query := tx.Where("goal_owner_id = ? AND status = ?", actorID, int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING))
		if taskFilter != "" {
			query = query.Where("id = ?", taskFilter)
		}
		if err := query.Order("created_at ASC").Find(&tasks).Error; err != nil {
			return err
		}
		for taskIndex := range tasks {
			task := tasks[taskIndex]
			var nodes []persistence.CollaborationTaskNode
			nodeQuery := tx.Where("task_id = ? AND status = ?", task.ID, int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING))
			if agentFilter != "" {
				nodeQuery = nodeQuery.Where("agent_id = ?", agentFilter)
			}
			if nodeFilter != "" {
				nodeQuery = nodeQuery.Where("id = ?", nodeFilter)
			}
			if err := nodeQuery.Order("started_at ASC").Find(&nodes).Error; err != nil {
				return err
			}
			for nodeIndex := range nodes {
				node := nodes[nodeIndex]
				agent, err := s.agentService.GetAgent(ctx, actorID, node.AgentID)
				if err != nil {
					return err
				}
				if agentExecutorKind(agent) != model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE {
					continue
				}
				lease, ok, err := s.claimNodeLeaseTx(tx, &task, &node, executorID, ttl, now)
				if err != nil {
					return err
				}
				if !ok {
					continue
				}
				claimedTask = task
				claimedNode = node
				claimedLease = lease
				claimed = true
				return nil
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if !claimed {
		return &model.ClaimDesktopExecutorTaskResponse{Claimed: false}, nil
	}
	s.updateTaskMeta(ctx, db, &claimedTask, map[string]string{
		"desktop_executor_state": "leased_node",
		"desktop_executor_node":  claimedNode.ID,
		"desktop_executor_agent": claimedNode.AgentID,
		"desktop_executor_lease": claimedLease.LeaseID,
	})
	s.publishExecutorLeaseEvent(ctx, &claimedTask, &claimedNode, &claimedLease, domain.EventTypeCollaborationExecutorLeased, "claimed")
	return &model.ClaimDesktopExecutorTaskResponse{
		Task:    taskRecordToProto(&claimedTask),
		Node:    nodeRecordToProto(&claimedNode),
		Lease:   leaseRecordToProto(&claimedLease),
		Claimed: true,
	}, nil
}

func (s *OrchestrationService) HeartbeatExecutorLease(ctx context.Context, actorID string, req *model.HeartbeatExecutorLeaseRequest) (*model.ExecutorLease, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	actorID = strings.TrimSpace(actorID)
	leaseID := strings.TrimSpace(req.GetLeaseId())
	executorID := strings.TrimSpace(req.GetExecutorId())
	if actorID == "" || leaseID == "" || executorID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id, lease_id and executor_id are required", nil)
	}
	ttl := normalizeExecutorLeaseTTL(req.GetLeaseTtlMs())
	now := time.Now()
	var lease persistence.ExecutorLease
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("lease_id = ? AND executor_id = ?", leaseID, executorID).First(&lease).Error; err != nil {
			return err
		}
		var task persistence.CollaborationTask
		if err := tx.Where("id = ? AND goal_owner_id = ?", lease.TaskID, actorID).First(&task).Error; err != nil {
			return err
		}
		if lease.Status != executorLeaseStatusActive {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "executor lease is not active", nil)
		}
		if !lease.ExpiresAt.After(now) {
			lease.Status = executorLeaseStatusExpired
			lease.HeartbeatAt = now
			_ = tx.Model(&persistence.ExecutorLease{}).Where("lease_id = ?", lease.LeaseID).Updates(map[string]interface{}{
				"status":       executorLeaseStatusExpired,
				"heartbeat_at": now,
			}).Error
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "executor lease expired", nil)
		}
		lease.HeartbeatAt = now
		lease.ExpiresAt = now.Add(ttl)
		return tx.Model(&persistence.ExecutorLease{}).Where("lease_id = ?", lease.LeaseID).Updates(map[string]interface{}{
			"heartbeat_at": lease.HeartbeatAt,
			"expires_at":   lease.ExpiresAt,
		}).Error
	}); err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "executor lease not found", err)
		}
		return nil, err
	}
	return leaseRecordToProto(&lease), nil
}

func (s *OrchestrationService) ReleaseExecutorLease(ctx context.Context, actorID string, req *model.ReleaseExecutorLeaseRequest) (*model.ExecutorLease, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	actorID = strings.TrimSpace(actorID)
	leaseID := strings.TrimSpace(req.GetLeaseId())
	executorID := strings.TrimSpace(req.GetExecutorId())
	reason := strings.TrimSpace(req.GetStatus())
	if reason == "" {
		reason = executorLeaseStatusReleased
	}
	if actorID == "" || leaseID == "" || executorID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id, lease_id and executor_id are required", nil)
	}
	now := time.Now()
	var task persistence.CollaborationTask
	var node persistence.CollaborationTaskNode
	var lease persistence.ExecutorLease
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("lease_id = ? AND executor_id = ?", leaseID, executorID).First(&lease).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ? AND goal_owner_id = ?", lease.TaskID, actorID).First(&task).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ? AND task_id = ?", lease.StepID, lease.TaskID).First(&node).Error; err != nil {
			return err
		}
		if lease.Status == executorLeaseStatusActive {
			status := executorLeaseStatusReleased
			if !lease.ExpiresAt.After(now) {
				status = executorLeaseStatusExpired
			}
			lease.Status = status
			lease.HeartbeatAt = now
			return tx.Model(&persistence.ExecutorLease{}).Where("lease_id = ?", lease.LeaseID).Updates(map[string]interface{}{
				"status":       status,
				"heartbeat_at": now,
			}).Error
		}
		return nil
	}); err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "executor lease not found", err)
		}
		return nil, err
	}
	s.publishExecutorLeaseEvent(ctx, &task, &node, &lease, domain.EventTypeCollaborationExecutorReleased, reason)
	return leaseRecordToProto(&lease), nil
}

func (s *OrchestrationService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	return db, nil
}

func (s *OrchestrationService) executeTaskNodes(
	ctx context.Context,
	actorID string,
	task *persistence.CollaborationTask,
	nodes []persistence.CollaborationTaskNode,
) (*persistence.CollaborationTask, []persistence.CollaborationTaskNode) {
	db, err := s.getDB(ctx)
	if err != nil {
		logger.Errorf(ctx, "failed to open db for collaboration execution: task_id=%s err=%v", task.ID, err)
		return task, nodes
	}

	if isParallelCollaborationEngine(model.CollaborationEngineType(task.EngineType)) {
		return s.executeTaskNodesParallel(ctx, db, actorID, task, nodes)
	}
	return s.executeTaskNodesSequential(ctx, db, actorID, task, nodes)
}

type collaborationNodeContext struct {
	AgentID string
	Role    string
	Summary string
	Failed  bool
}

type collaborationNodeRunResult struct {
	Summary       string
	Failed        bool
	Cancelled     bool
	Deferred      bool
	FailurePolicy string
}

type collaborationResumeContext struct {
	InterruptID       string
	InterruptType     string
	PayloadJSON       string
	ResumePayloadJSON string
}

type collaborationNodeExecutionPolicy struct {
	RetryMax      int
	Timeout       time.Duration
	FailurePolicy string
}

type collaborationRuntimeProviderOverride struct {
	ProviderID      string
	Model           string
	ReasoningEffort string
	Source          string
}

type directRunLifecycleRecords struct {
	Run  *persistence.DirectRun
	Task *persistence.TaskRun
	Step *persistence.ExecutionStep
}

type goalKeeperVerdict struct {
	Verdict        model.AcceptanceVerdict
	Reason         string
	EvidenceRef    string
	JudgeID        string
	CompletedNodes int
	TotalNodes     int
}

func buildCollaborationTaskNodes(
	taskID string,
	description string,
	engine model.CollaborationEngineType,
	agentIDs []string,
	synthesizerAgentID string,
	providerPlan *model.TaskProviderPlan,
	now time.Time,
) []persistence.CollaborationTaskNode {
	nodeRecords := make([]persistence.CollaborationTaskNode, 0, len(agentIDs)+1)
	prerequisiteNodeIDs := make([]string, 0, len(agentIDs))
	previousNodeID := ""
	schedule := enginePolicyScheduleForEngine(engine)
	for index, agentID := range agentIDs {
		nodeID := generateID("node")
		prerequisiteNodeIDs = append(prerequisiteNodeIDs, nodeID)
		prerequisites := ""
		if !schedule.Parallel && previousNodeID != "" {
			prerequisites = previousNodeID
		}
		nodeRecords = append(nodeRecords, persistence.CollaborationTaskNode{
			ID:                  nodeID,
			TaskID:              taskID,
			AgentID:             agentID,
			Role:                providerPlanRoleForIndex(providerPlan, schedule, index),
			Description:         description,
			Status:              int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
			PrerequisiteNodeIDs: prerequisites,
			StartedAt:           now.Add(time.Duration(index) * time.Millisecond),
			EndedAt:             now.Add(time.Duration(index) * time.Millisecond),
		})
		previousNodeID = nodeID
	}
	nodeRecords = append(nodeRecords, persistence.CollaborationTaskNode{
		ID:                  generateID("node"),
		TaskID:              taskID,
		AgentID:             synthesizerAgentID,
		Role:                collaborationRoleIntegrator,
		Description:         "Synthesize the collaboration node outputs into the final result.",
		Status:              int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
		PrerequisiteNodeIDs: strings.Join(prerequisiteNodeIDs, ","),
		StartedAt:           now.Add(time.Duration(len(agentIDs)) * time.Millisecond),
		EndedAt:             now.Add(time.Duration(len(agentIDs)) * time.Millisecond),
	})
	return nodeRecords
}

func providerPlanRoleForIndex(plan *model.TaskProviderPlan, schedule enginePolicySchedule, index int) string {
	if plan != nil && index >= 0 && index < len(plan.GetProviders()) {
		if role, err := normalizeAtelierAgentRole(plan.GetProviders()[index].GetRole()); err == nil && role != "" {
			return role
		}
	}
	return schedule.roleForIndex(index)
}

func (s *OrchestrationService) executeTaskNodesSequential(
	ctx context.Context,
	db *gorm.DB,
	actorID string,
	task *persistence.CollaborationTask,
	nodes []persistence.CollaborationTaskNode,
) (*persistence.CollaborationTask, []persistence.CollaborationTaskNode) {
	hasFailure := false
	priorResults := make([]collaborationNodeContext, 0, len(nodes))
	for index := range nodes {
		node := &nodes[index]
		if isSynthesisNode(node) {
			continue
		}
		switch node.Status {
		case int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED):
			priorResults = append(priorResults, collaborationContextFromNode(node, false))
			continue
		case int32(model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED):
			continue
		case int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED):
			priorResults = append(priorResults, collaborationContextFromNode(node, true))
			hasFailure = true
			continue
		}
		if s.isTaskCancelled(ctx, db, task) {
			s.skipPendingNodes(ctx, db, task, nodes[index:])
			s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskCancelled)
			return task, nodes
		}
		if s.failTaskIfTimeBudgetExceeded(ctx, db, task, nodes[index:]) {
			s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskFailed)
			return task, nodes
		}
		result := s.runCollaborationNodeWithPolicy(ctx, db, actorID, task, node, priorResults)
		if result.Deferred {
			return task, nodes
		}
		if result.Cancelled {
			s.skipPendingNodes(ctx, db, task, nodes[index+1:])
			s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskCancelled)
			return task, nodes
		}
		if result.Failed {
			hasFailure = true
			if result.FailurePolicy == "fail_task" || result.FailurePolicy == "skip_dependents" {
				s.skipPendingNodesWithSummary(ctx, db, nodes[index+1:], "Node skipped by failure policy.")
				return s.finishExecutedTask(ctx, db, actorID, task, nodes, hasFailure)
			}
		}
		if strings.TrimSpace(result.Summary) != "" {
			priorResults = append(priorResults, collaborationNodeContext{
				AgentID: node.AgentID,
				Role:    node.Role,
				Summary: result.Summary,
				Failed:  result.Failed,
			})
		}
	}

	return s.finishExecutedTask(ctx, db, actorID, task, nodes, hasFailure)
}

func (s *OrchestrationService) executeTaskNodesParallel(
	ctx context.Context,
	db *gorm.DB,
	actorID string,
	task *persistence.CollaborationTask,
	nodes []persistence.CollaborationTaskNode,
) (*persistence.CollaborationTask, []persistence.CollaborationTaskNode) {
	if s.isTaskCancelled(ctx, db, task) {
		s.skipPendingNodes(ctx, db, task, nodes)
		s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskCancelled)
		return task, nodes
	}

	hasFailure := false
	cancelled := false
	deferred := false
	failurePolicy := ""
	for {
		if s.isTaskCancelled(ctx, db, task) {
			cancelled = true
			break
		}
		if s.failTaskIfTimeBudgetExceeded(ctx, db, task, nodes) {
			s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskFailed)
			return task, nodes
		}

		readyNodes := readyCollaborationNodes(nodes)
		if len(readyNodes) == 0 {
			if hasRunningCollaborationNodes(nodes) {
				return task, nodes
			}
			if hasPendingCollaborationNodes(nodes) {
				hasFailure = true
				s.skipBlockedNodes(ctx, db, nodes)
			}
			break
		}

		var wg sync.WaitGroup
		var mu sync.Mutex
		for _, nodeIndex := range readyNodes {
			node := &nodes[nodeIndex]
			priorResults := collaborationContextsForPrerequisites(node, nodes)
			wg.Add(1)
			go func(node *persistence.CollaborationTaskNode, priorResults []collaborationNodeContext) {
				defer wg.Done()
				taskCopy := *task
				result := s.runCollaborationNodeWithPolicy(ctx, db, actorID, &taskCopy, node, priorResults)
				mu.Lock()
				if result.Failed {
					hasFailure = true
					if result.FailurePolicy == "fail_task" || result.FailurePolicy == "skip_dependents" {
						failurePolicy = result.FailurePolicy
					}
				}
				if result.Cancelled {
					cancelled = true
				}
				if result.Deferred {
					deferred = true
				}
				mu.Unlock()
			}(node, priorResults)
		}
		wg.Wait()

		if cancelled || deferred {
			break
		}
		if failurePolicy == "fail_task" || failurePolicy == "skip_dependents" {
			s.skipPendingNodesWithSummary(ctx, db, nodes, "Node skipped by failure policy.")
			break
		}
	}

	if deferred {
		return task, nodes
	}
	if cancelled || s.isTaskCancelled(ctx, db, task) {
		s.skipPendingNodes(ctx, db, task, nodes)
		s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskCancelled)
		return task, nodes
	}
	if s.failTaskIfTimeBudgetExceeded(ctx, db, task, nodes) {
		s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskFailed)
		return task, nodes
	}
	return s.finishExecutedTask(ctx, db, actorID, task, nodes, hasFailure)
}

func (s *OrchestrationService) runCollaborationNodeWithPolicy(
	ctx context.Context,
	db *gorm.DB,
	actorID string,
	task *persistence.CollaborationTask,
	node *persistence.CollaborationTaskNode,
	priorResults []collaborationNodeContext,
) collaborationNodeRunResult {
	policy := collaborationNodePolicyFor(task, node)
	attempts := policy.RetryMax + 1
	if attempts < 1 {
		attempts = 1
	}
	var result collaborationNodeRunResult
	for attempt := 0; attempt < attempts; attempt++ {
		runCtx := ctx
		cancel := func() {}
		if policy.Timeout > 0 {
			runCtx, cancel = context.WithTimeout(ctx, policy.Timeout)
		}
		result = s.runCollaborationNode(runCtx, db, actorID, task, node, priorResults)
		cancel()
		if !result.Failed || result.Cancelled || result.Deferred || attempt == attempts-1 {
			result.FailurePolicy = policy.FailurePolicy
			return result
		}
		s.updateTaskMeta(ctx, db, task, map[string]string{
			"node_policy.last_failed_node_id":    node.ID,
			"node_policy.last_failure_reason":    result.Summary,
			"node_policy.retry_count." + node.ID: strconv.Itoa(attempt + 1),
		})
	}
	return result
}

func (s *OrchestrationService) runCollaborationNode(
	ctx context.Context,
	db *gorm.DB,
	actorID string,
	task *persistence.CollaborationTask,
	node *persistence.CollaborationTaskNode,
	priorResults []collaborationNodeContext,
) collaborationNodeRunResult {
	if s.isTaskCancelled(ctx, db, task) {
		s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED, "Task cancelled.")
		return collaborationNodeRunResult{Summary: "Task cancelled.", Cancelled: true}
	}
	s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING, "")
	s.publishNodeEvent(ctx, task, node, domain.EventTypeCollaborationNodeRunning, "", "")

	agent, err := s.agentService.GetAgent(ctx, actorID, node.AgentID)
	if err != nil {
		summary := fmt.Sprintf("failed to load agent: %v", err)
		s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary)
		s.publishNodeEvent(ctx, task, node, domain.EventTypeCollaborationNodeFailed, "", summary)
		return collaborationNodeRunResult{Summary: summary, Failed: true}
	}
	if agentExecutorKind(agent) == model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE {
		summary := desktopExecutorAwaitingSummary(agent)
		s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING, summary)
		s.updateTaskMeta(ctx, db, task, map[string]string{
			"desktop_executor_state": "awaiting_node_result",
			"desktop_executor_node":  node.ID,
			"desktop_executor_agent": node.AgentID,
		})
		return collaborationNodeRunResult{Summary: summary, Deferred: true}
	}

	runtimeProvider, err := loadRuntimeProviderOverrideForNode(ctx, db, task, node)
	if err != nil {
		summary := fmt.Sprintf("failed to load runtime provider plan: %v", err)
		s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary)
		s.publishNodeEvent(ctx, task, node, domain.EventTypeCollaborationNodeFailed, "", summary)
		return collaborationNodeRunResult{Summary: summary, Failed: true}
	}

	if err := s.ensureNodeConversation(ctx, db, actorID, task, node, agent, runtimeProvider); err != nil {
		summary := fmt.Sprintf("failed to create node conversation: %v", err)
		s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary)
		s.publishNodeEvent(ctx, task, node, domain.EventTypeCollaborationNodeFailed, "", summary)
		return collaborationNodeRunResult{Summary: summary, Failed: true}
	}

	resumeContext, err := loadCollaborationResumeContext(ctx, db, task.ID)
	if err != nil {
		summary := fmt.Sprintf("failed to load resume context: %v", err)
		s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary)
		s.publishNodeEvent(ctx, task, node, domain.EventTypeCollaborationNodeFailed, "", summary)
		return collaborationNodeRunResult{Summary: summary, Failed: true}
	}
	prompt := collaborationNodePrompt(task, node, priorResults)
	if resumeContext != nil {
		prompt = appendCollaborationResumeContext(prompt, resumeContext)
	}

	turn, err := s.turnService.ExecuteTurn(ctx, s.turnConfigForNode(task, node, agent, runtimeProvider), prompt)
	if s.isTaskCancelled(ctx, db, task) {
		s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED, "Task cancelled.")
		return collaborationNodeRunResult{Summary: "Task cancelled.", Cancelled: true}
	}
	if err != nil {
		summary := fmt.Sprintf("turn execution failed: %v", err)
		s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary)
		s.publishNodeEvent(ctx, task, node, domain.EventTypeCollaborationNodeFailed, "", summary)
		return collaborationNodeRunResult{Summary: summary, Failed: true}
	}

	summary := strings.TrimSpace(turn.FinalResponse)
	if summary == "" {
		summary = "Turn completed without a final response."
	}
	if resumeContext != nil {
		if err := markCollaborationResumeContextConsumed(ctx, db, resumeContext.InterruptID, node.ID, turn.TurnID); err != nil {
			summary := fmt.Sprintf("failed to mark resume context consumed: %v", err)
			s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary)
			s.publishNodeEvent(ctx, task, node, domain.EventTypeCollaborationNodeFailed, turn.TurnID, summary)
			return collaborationNodeRunResult{Summary: summary, Failed: true}
		}
		s.updateTaskMeta(ctx, db, task, map[string]string{
			"resume_state":                 "consumed",
			"resume_consumed_interrupt_id": resumeContext.InterruptID,
			"resume_consumed_step_id":      node.ID,
			"resume_consumed_turn_id":      turn.TurnID,
		})
	}
	s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED, summary)
	s.publishNodeEvent(ctx, task, node, domain.EventTypeCollaborationNodeCompleted, turn.TurnID, summary)
	return collaborationNodeRunResult{Summary: summary}
}

func collaborationNodePolicyFor(task *persistence.CollaborationTask, node *persistence.CollaborationTaskNode) collaborationNodeExecutionPolicy {
	policy := collaborationNodeExecutionPolicy{FailurePolicy: "continue"}
	if task == nil || node == nil || strings.TrimSpace(task.MetaJSON) == "" {
		return policy
	}
	meta := map[string]string{}
	if err := json.Unmarshal([]byte(task.MetaJSON), &meta); err != nil {
		return policy
	}
	if value, ok := nodePolicyMetaValue(meta, node, "retry_max"); ok {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			policy.RetryMax = parsed
		}
	}
	if value, ok := nodePolicyMetaValue(meta, node, "timeout_ms"); ok {
		if parsed, err := strconv.ParseInt(value, 10, 64); err == nil && parsed > 0 {
			policy.Timeout = time.Duration(parsed) * time.Millisecond
		}
	}
	if value, ok := nodePolicyMetaValue(meta, node, "failure_policy"); ok {
		switch strings.TrimSpace(value) {
		case "continue", "fail_task", "skip_dependents":
			policy.FailurePolicy = strings.TrimSpace(value)
		}
	}
	return policy
}

func nodePolicyMetaValue(meta map[string]string, node *persistence.CollaborationTaskNode, key string) (string, bool) {
	prefixes := []string{
		"node_policy.node." + node.ID + ".",
		"node_policy.agent." + node.AgentID + ".",
		"node_policy.role." + node.Role + ".",
		"node_policy.default.",
	}
	for _, prefix := range prefixes {
		value, ok := meta[prefix+key]
		if ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value), true
		}
	}
	return "", false
}

func (s *OrchestrationService) claimNodeLeaseTx(
	tx *gorm.DB,
	task *persistence.CollaborationTask,
	node *persistence.CollaborationTaskNode,
	executorID string,
	ttl time.Duration,
	now time.Time,
) (persistence.ExecutorLease, bool, error) {
	var lockedNode persistence.CollaborationTaskNode
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND task_id = ?", node.ID, task.ID).
		First(&lockedNode).Error; err != nil {
		return persistence.ExecutorLease{}, false, err
	}
	if lockedNode.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
		return persistence.ExecutorLease{}, false, nil
	}
	*node = lockedNode

	var activeLeases []persistence.ExecutorLease
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("task_id = ? AND step_id = ? AND status = ?", task.ID, node.ID, executorLeaseStatusActive).
		Order("acquired_at ASC").
		Find(&activeLeases).Error; err != nil {
		return persistence.ExecutorLease{}, false, err
	}
	for index := range activeLeases {
		lease := activeLeases[index]
		if !lease.ExpiresAt.After(now) {
			if err := tx.Model(&persistence.ExecutorLease{}).Where("lease_id = ?", lease.LeaseID).Updates(map[string]interface{}{
				"status":       executorLeaseStatusExpired,
				"heartbeat_at": now,
			}).Error; err != nil {
				return persistence.ExecutorLease{}, false, err
			}
			continue
		}
		if lease.ExecutorID != executorID {
			return persistence.ExecutorLease{}, false, nil
		}
		lease.HeartbeatAt = now
		lease.ExpiresAt = now.Add(ttl)
		if err := tx.Model(&persistence.ExecutorLease{}).Where("lease_id = ?", lease.LeaseID).Updates(map[string]interface{}{
			"heartbeat_at": lease.HeartbeatAt,
			"expires_at":   lease.ExpiresAt,
		}).Error; err != nil {
			return persistence.ExecutorLease{}, false, err
		}
		return lease, true, nil
	}
	lease := persistence.ExecutorLease{
		LeaseID:      generateID("lease"),
		TaskID:       task.ID,
		StepID:       node.ID,
		ExecutorID:   executorID,
		ExecutorKind: int32(model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE),
		Status:       executorLeaseStatusActive,
		AcquiredAt:   now,
		HeartbeatAt:  now,
		ExpiresAt:    now.Add(ttl),
	}
	if err := tx.Create(&lease).Error; err != nil {
		return persistence.ExecutorLease{}, false, err
	}
	return lease, true, nil
}

func (s *OrchestrationService) finishExecutedTask(
	ctx context.Context,
	db *gorm.DB,
	actorID string,
	task *persistence.CollaborationTask,
	nodes []persistence.CollaborationTaskNode,
	hasFailure bool,
) (*persistence.CollaborationTask, []persistence.CollaborationTaskNode) {
	if hasRunningCollaborationNodes(nodes) {
		return task, nodes
	}
	if s.isTaskCancelled(ctx, db, task) {
		s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskCancelled)
		return task, nodes
	}
	if s.failTaskIfTimeBudgetExceeded(ctx, db, task, nodes) {
		s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskFailed)
		return task, nodes
	}
	finalSummary := ""
	if summary, turnID, failed := s.synthesizeTaskResult(ctx, db, actorID, task, nodes); strings.TrimSpace(summary) != "" {
		finalSummary = strings.TrimSpace(summary)
		s.updateTaskMeta(ctx, db, task, map[string]string{
			"final_summary":           finalSummary,
			"final_synthesis_turn_id": turnID,
		})
	} else if failed {
		hasFailure = true
	}
	if hasRunningCollaborationNodes(nodes) {
		return task, nodes
	}
	if enginePolicyRuntimeEnabled(task) {
		enginePolicyEvents, err := loadEnginePolicyTaskEvents(ctx, db, task.ID)
		if err != nil {
			s.updateTaskMeta(ctx, db, task, enginePolicyLoadErrorMeta(err))
			s.updateTaskStatus(ctx, db, task, model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED)
			return task, nodes
		}
		enginePolicyResult := evaluateCollaborationEnginePolicy(task, nodes, enginePolicyEvents...)
		s.updateTaskMeta(ctx, db, task, enginePolicyEvaluationMeta(enginePolicyResult))
		if enginePolicyResult.Phase == enginePolicyPhaseAwaitingHuman {
			s.updateTaskStatus(ctx, db, task, model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED)
			return task, nodes
		}
	}
	verdict := evaluateGoalKeeperVerdict(task, nodes, finalSummary, hasFailure)
	s.updateTaskMeta(ctx, db, task, goalKeeperVerdictMeta(verdict))
	if verdict.Verdict == model.AcceptanceVerdict_ACCEPTANCE_VERDICT_REJECTED {
		hasFailure = true
	}
	taskStatus := model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED
	taskEvent := domain.EventTypeCollaborationTaskCompleted
	if hasFailure {
		taskStatus = model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED
		taskEvent = domain.EventTypeCollaborationTaskFailed
	}
	s.updateTaskStatus(ctx, db, task, taskStatus)
	s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), taskEvent)
	s.publishGoalKeeperProjectionEvents(ctx, task, nodes, verdict, finalSummary)
	return task, nodes
}

func (s *OrchestrationService) synthesizeTaskResult(
	ctx context.Context,
	db *gorm.DB,
	actorID string,
	task *persistence.CollaborationTask,
	nodes []persistence.CollaborationTaskNode,
) (string, string, bool) {
	if s.turnService == nil || s.agentService == nil || task == nil {
		return "", "", false
	}
	if completedSynthNode := completedSynthesisNode(nodes); completedSynthNode != nil {
		return strings.TrimSpace(completedSynthNode.ResultSummary), "", false
	}
	synthNode := synthesisNode(nodes)
	if synthNode == nil {
		synthNode = firstCompletedNode(nodes)
	}
	if synthNode == nil {
		return "", "", false
	}
	if s.isTaskCancelled(ctx, db, task) {
		return "", "", false
	}
	if isSynthesisNode(synthNode) {
		s.updateNode(ctx, db, synthNode, model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING, "")
		s.publishNodeEvent(ctx, task, synthNode, domain.EventTypeCollaborationNodeRunning, "", "")
	}
	agent, err := s.agentService.GetAgent(ctx, actorID, synthNode.AgentID)
	if err != nil {
		logger.Warnf(ctx, "failed to load synthesis agent: task_id=%s agent_id=%s err=%v", task.ID, synthNode.AgentID, err)
		if isSynthesisNode(synthNode) {
			summary := fmt.Sprintf("failed to load synthesis agent: %v", err)
			s.updateNode(ctx, db, synthNode, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary)
			s.publishNodeEvent(ctx, task, synthNode, domain.EventTypeCollaborationNodeFailed, "", summary)
			return "", "", true
		}
		return "", "", false
	}
	if agentExecutorKind(agent) == model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE {
		summary := desktopExecutorAwaitingSummary(agent)
		if isSynthesisNode(synthNode) {
			s.updateNode(ctx, db, synthNode, model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING, summary)
			s.updateTaskMeta(ctx, db, task, map[string]string{
				"desktop_executor_state": "awaiting_synthesis_result",
				"desktop_executor_node":  synthNode.ID,
				"desktop_executor_agent": synthNode.AgentID,
			})
			return "", "", false
		}
		return "", "", false
	}
	runtimeProvider, err := loadRuntimeProviderOverrideForNode(ctx, db, task, synthNode)
	if err != nil {
		logger.Warnf(ctx, "failed to load synthesis runtime provider plan: task_id=%s node_id=%s err=%v", task.ID, synthNode.ID, err)
		if isSynthesisNode(synthNode) {
			summary := fmt.Sprintf("failed to load synthesis runtime provider plan: %v", err)
			s.updateNode(ctx, db, synthNode, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary)
			s.publishNodeEvent(ctx, task, synthNode, domain.EventTypeCollaborationNodeFailed, "", summary)
			return "", "", true
		}
		return "", "", false
	}
	if err := s.ensureNodeConversation(ctx, db, actorID, task, synthNode, agent, runtimeProvider); err != nil {
		logger.Warnf(ctx, "failed to ensure synthesis conversation: task_id=%s node_id=%s err=%v", task.ID, synthNode.ID, err)
		if isSynthesisNode(synthNode) {
			summary := fmt.Sprintf("failed to create synthesis conversation: %v", err)
			s.updateNode(ctx, db, synthNode, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary)
			s.publishNodeEvent(ctx, task, synthNode, domain.EventTypeCollaborationNodeFailed, "", summary)
			return "", "", true
		}
		return "", "", false
	}
	turn, err := s.turnService.ExecuteTurn(ctx, s.turnConfigForNode(task, synthNode, agent, runtimeProvider), collaborationSynthesisPrompt(task, nodes))
	if err != nil {
		logger.Warnf(ctx, "collaboration synthesis turn failed: task_id=%s node_id=%s err=%v", task.ID, synthNode.ID, err)
		if isSynthesisNode(synthNode) {
			summary := fmt.Sprintf("synthesis turn failed: %v", err)
			s.updateNode(ctx, db, synthNode, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary)
			s.publishNodeEvent(ctx, task, synthNode, domain.EventTypeCollaborationNodeFailed, "", summary)
			return "", "", true
		}
		return "", "", false
	}
	summary := strings.TrimSpace(turn.FinalResponse)
	if summary == "" {
		if isSynthesisNode(synthNode) {
			summary = "Synthesis completed without a final response."
			s.updateNode(ctx, db, synthNode, model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED, summary)
			s.publishNodeEvent(ctx, task, synthNode, domain.EventTypeCollaborationNodeCompleted, turn.TurnID, summary)
			return summary, strings.TrimSpace(turn.TurnID), false
		}
		return "", strings.TrimSpace(turn.TurnID), false
	}
	if isSynthesisNode(synthNode) {
		s.updateNode(ctx, db, synthNode, model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED, summary)
		s.publishNodeEvent(ctx, task, synthNode, domain.EventTypeCollaborationNodeCompleted, turn.TurnID, summary)
	}
	return summary, strings.TrimSpace(turn.TurnID), false
}

func firstCompletedNode(nodes []persistence.CollaborationTaskNode) *persistence.CollaborationTaskNode {
	for index := range nodes {
		if !isSynthesisNode(&nodes[index]) && nodes[index].Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED) && strings.TrimSpace(nodes[index].ResultSummary) != "" {
			return &nodes[index]
		}
	}
	return nil
}

func synthesisNode(nodes []persistence.CollaborationTaskNode) *persistence.CollaborationTaskNode {
	for index := range nodes {
		if isSynthesisNode(&nodes[index]) && nodes[index].Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING) {
			return &nodes[index]
		}
	}
	return nil
}

func completedSynthesisNode(nodes []persistence.CollaborationTaskNode) *persistence.CollaborationTaskNode {
	for index := range nodes {
		if isSynthesisNode(&nodes[index]) && nodes[index].Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED) && strings.TrimSpace(nodes[index].ResultSummary) != "" {
			return &nodes[index]
		}
	}
	return nil
}

func synthesisNodeByRole(nodes []persistence.CollaborationTaskNode) *persistence.CollaborationTaskNode {
	for index := range nodes {
		if isSynthesisNode(&nodes[index]) {
			return &nodes[index]
		}
	}
	return nil
}

func (s *OrchestrationService) updateTaskMeta(ctx context.Context, db *gorm.DB, task *persistence.CollaborationTask, updates map[string]string) {
	if task == nil || len(updates) == 0 {
		return
	}
	meta := map[string]string{}
	_ = json.Unmarshal([]byte(task.MetaJSON), &meta)
	for key, value := range updates {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		meta[key] = value
	}
	metaJSON, _ := json.Marshal(meta)
	task.MetaJSON = string(metaJSON)
	if err := db.WithContext(ctx).Model(&persistence.CollaborationTask{}).Where("id = ?", task.ID).Update("meta_json", task.MetaJSON).Error; err != nil {
		logger.Warnf(ctx, "failed to update collaboration task meta: task_id=%s err=%v", task.ID, err)
	}
}

func evaluateGoalKeeperVerdict(task *persistence.CollaborationTask, nodes []persistence.CollaborationTaskNode, finalSummary string, hasFailure bool) goalKeeperVerdict {
	completed, failed, skipped, total := normalNodeStatusCounts(nodes)
	judgeID := ""
	if synthNode := synthesisNodeByRole(nodes); synthNode != nil {
		judgeID = synthNode.AgentID
	} else if completedNode := firstCompletedNode(nodes); completedNode != nil {
		judgeID = completedNode.AgentID
	}
	verdict := goalKeeperVerdict{
		Verdict:        model.AcceptanceVerdict_ACCEPTANCE_VERDICT_ACCEPTED,
		Reason:         "All normal collaboration nodes completed and final synthesis is available.",
		EvidenceRef:    fmt.Sprintf("task:%s#final_summary", strings.TrimSpace(task.ID)),
		JudgeID:        judgeID,
		CompletedNodes: completed,
		TotalNodes:     total,
	}
	if total == 0 {
		verdict.Verdict = model.AcceptanceVerdict_ACCEPTANCE_VERDICT_REJECTED
		verdict.Reason = "No collaboration nodes were available for acceptance."
		return verdict
	}
	if strings.TrimSpace(finalSummary) == "" {
		verdict.Verdict = model.AcceptanceVerdict_ACCEPTANCE_VERDICT_REJECTED
		verdict.Reason = "Final synthesis summary is missing."
		return verdict
	}
	if hasFailure || failed > 0 || skipped > 0 || completed < total {
		verdict.Verdict = model.AcceptanceVerdict_ACCEPTANCE_VERDICT_REJECTED
		verdict.Reason = fmt.Sprintf("GoalKeeper rejected: completed=%d total=%d failed=%d skipped=%d.", completed, total, failed, skipped)
		verdict.EvidenceRef = fmt.Sprintf("task:%s#nodes", strings.TrimSpace(task.ID))
		return verdict
	}
	return verdict
}

func goalKeeperVerdictMeta(verdict goalKeeperVerdict) map[string]string {
	return map[string]string{
		"acceptance_verdict":         acceptanceVerdictMetaValue(verdict.Verdict),
		"acceptance_level":           "L1",
		"acceptance_reason":          verdict.Reason,
		"acceptance_evidence_ref":    verdict.EvidenceRef,
		"acceptance_judge_id":        verdict.JudgeID,
		"acceptance_completed_nodes": fmt.Sprintf("%d", verdict.CompletedNodes),
		"acceptance_total_nodes":     fmt.Sprintf("%d", verdict.TotalNodes),
	}
}

func (s *OrchestrationService) publishGoalKeeperProjectionEvents(
	ctx context.Context,
	task *persistence.CollaborationTask,
	nodes []persistence.CollaborationTaskNode,
	verdict goalKeeperVerdict,
	finalSummary string,
) {
	if task == nil {
		return
	}
	agentIDs := collaborationNodeAgentIDs(nodes)
	if len(agentIDs) == 0 && strings.TrimSpace(verdict.JudgeID) != "" {
		agentIDs = []string{strings.TrimSpace(verdict.JudgeID)}
	}
	artifactID := ""
	if strings.TrimSpace(finalSummary) != "" {
		artifactID = fmt.Sprintf("%s-final-summary", task.ID)
		artifactPayload := goalKeeperArtifactPayload(task, artifactID, finalSummary, verdict)
		for _, agentID := range agentIDs {
			s.publishEvent(ctx, agentID, string(domain.EventTypeCollaborationArtifactCreated), artifactPayload, task.ID, "")
		}
	}
	gatePayload := goalKeeperGatePayload(task, verdict, artifactID)
	for _, agentID := range agentIDs {
		s.publishEvent(ctx, agentID, string(domain.EventTypeCollaborationGateResult), gatePayload, task.ID, "")
	}
}

func collaborationNodeAgentIDs(nodes []persistence.CollaborationTaskNode) []string {
	seen := map[string]struct{}{}
	ids := []string{}
	for _, node := range nodes {
		agentID := strings.TrimSpace(node.AgentID)
		if agentID == "" {
			continue
		}
		if _, ok := seen[agentID]; ok {
			continue
		}
		seen[agentID] = struct{}{}
		ids = append(ids, agentID)
	}
	return ids
}

func goalKeeperArtifactPayload(task *persistence.CollaborationTask, artifactID string, finalSummary string, verdict goalKeeperVerdict) map[string]interface{} {
	taskID := ""
	if task != nil {
		taskID = strings.TrimSpace(task.ID)
	}
	return map[string]interface{}{
		"source":         "orchestration.goal_keeper",
		"block_kind":     "artifact",
		"artifact_id":    artifactID,
		"name":           "Final Summary",
		"kind":           "markdown",
		"uri":            stationArtifactURI(taskID, artifactID),
		"checksum":       artifactContentChecksum(strings.TrimSpace(finalSummary)),
		"meta":           "GoalKeeper · Final Summary",
		"markdown":       strings.TrimSpace(finalSummary),
		"task_id":        taskID,
		"produced_by":    strings.TrimSpace(verdict.JudgeID),
		"result_summary": strings.TrimSpace(finalSummary),
	}
}

func goalKeeperGatePayload(task *persistence.CollaborationTask, verdict goalKeeperVerdict, artifactID string) map[string]interface{} {
	taskID := ""
	if task != nil {
		taskID = strings.TrimSpace(task.ID)
	}
	status := "failed"
	if verdict.Verdict == model.AcceptanceVerdict_ACCEPTANCE_VERDICT_ACCEPTED {
		status = "passed"
	}
	payload := map[string]interface{}{
		"source":         "orchestration.goal_keeper",
		"block_kind":     "gate_result",
		"gate_id":        fmt.Sprintf("%s-goalkeeper", taskID),
		"name":           "GoalKeeper",
		"status":         status,
		"summary":        strings.TrimSpace(verdict.Reason),
		"task_id":        taskID,
		"produced_by":    strings.TrimSpace(verdict.JudgeID),
		"result_summary": strings.TrimSpace(verdict.Reason),
		"checks": []map[string]string{
			{"name": "completed_nodes", "status": status, "detail": fmt.Sprintf("%d/%d", verdict.CompletedNodes, verdict.TotalNodes)},
		},
	}
	if strings.TrimSpace(artifactID) != "" {
		payload["artifactIds"] = []string{strings.TrimSpace(artifactID)}
	}
	return payload
}

func collaborationProjectionEventsFromNodeResultRequest(
	taskID, nodeID, executorID string,
	req *model.SubmitCollaborationNodeResultRequest,
) ([]collaborationProjectionEvent, nodeResultGateDecision, error) {
	if req == nil {
		return nil, nodeResultGateDecision{}, nil
	}
	artifactPayloads := nodeResultArtifactPayloads(req.GetArtifacts())
	gatePayloads := nodeResultGatePayloads(req.GetGates())
	meta := req.GetMeta()
	if len(artifactPayloads) == 0 {
		legacyArtifacts, err := decodeNodeResultProjectionPayloads(meta[nodeResultArtifactsMetaKey], nodeResultArtifactsMetaKey)
		if err != nil {
			return nil, nodeResultGateDecision{}, err
		}
		artifactPayloads = legacyArtifacts
	}
	if len(gatePayloads) == 0 {
		legacyGates, err := decodeNodeResultProjectionPayloads(meta[nodeResultGatesMetaKey], nodeResultGatesMetaKey)
		if err != nil {
			return nil, nodeResultGateDecision{}, err
		}
		gatePayloads = legacyGates
	}
	return collaborationProjectionEventsFromNodeResultPayloads(taskID, nodeID, executorID, artifactPayloads, gatePayloads)
}

func collaborationProjectionEventsFromNodeResultMeta(taskID, nodeID, executorID string, meta map[string]string) ([]collaborationProjectionEvent, error) {
	events, _, err := collaborationProjectionEventsFromNodeResultPayloads(
		taskID,
		nodeID,
		executorID,
		mustDecodeNodeResultProjectionPayloads(meta[nodeResultArtifactsMetaKey], nodeResultArtifactsMetaKey),
		mustDecodeNodeResultProjectionPayloads(meta[nodeResultGatesMetaKey], nodeResultGatesMetaKey),
	)
	return events, err
}

func collaborationProjectionEventsFromNodeResultPayloads(
	taskID, nodeID, executorID string,
	artifacts []map[string]interface{},
	gates []map[string]interface{},
) ([]collaborationProjectionEvent, nodeResultGateDecision, error) {
	events := []collaborationProjectionEvent{}
	for _, artifact := range artifacts {
		if validateErr := validateNodeResultArtifactPayload(artifact, taskID); validateErr != nil {
			return nil, nodeResultGateDecision{}, validateErr
		}
		payload := normalizeNodeResultProjectionPayload(artifact, taskID, nodeID, executorID)
		payload["block_kind"] = "artifact"
		payload["source"] = "desktop_executor.node_result"
		events = append(events, collaborationProjectionEvent{
			EventType: domain.EventTypeCollaborationArtifactCreated,
			Payload:   payload,
		})
	}

	decision := nodeResultGateDecision{}
	for _, gate := range gates {
		if validateErr := validateNodeResultGatePayload(gate); validateErr != nil {
			return nil, nodeResultGateDecision{}, validateErr
		}
		payload := normalizeNodeResultProjectionPayload(gate, taskID, nodeID, executorID)
		payload["block_kind"] = "gate_result"
		payload["source"] = "desktop_executor.node_result"
		if gateDecision := gateDecisionFromPayload(payload); gateDecision.Blocked && !decision.Blocked {
			decision = gateDecision
		}
		events = append(events, collaborationProjectionEvent{
			EventType: domain.EventTypeCollaborationGateResult,
			Payload:   payload,
		})
	}
	return events, decision, nil
}

func mustDecodeNodeResultProjectionPayloads(raw string, field string) []map[string]interface{} {
	payloads, err := decodeNodeResultProjectionPayloads(raw, field)
	if err != nil {
		return []map[string]interface{}{{"_decode_error": err.Error()}}
	}
	return payloads
}

func validateNodeResultArtifactPayload(payload map[string]interface{}, taskID string) error {
	if _, ok := payload["_decode_error"]; ok {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta."+nodeResultArtifactsMetaKey+" must be valid JSON", nil)
	}
	for _, key := range []string{"artifact_id", "artifactId", "name", "title", "kind", "file_kind", "fileKind", "meta", "markdown", "uri", "url", "src", "checksum", "sha256", "size"} {
		if err := requireOptionalStringPayloadField(payload, key, nodeResultArtifactsMetaKey); err != nil {
			return err
		}
	}
	for _, key := range []string{"paths", "refs", "artifact_refs", "artifactRefs"} {
		if err := requireOptionalStringListPayloadField(payload, key, nodeResultArtifactsMetaKey); err != nil {
			return err
		}
	}
	return validateArtifactEvidencePolicy(payload, taskID, "meta."+nodeResultArtifactsMetaKey)
}

func validateNodeResultGatePayload(payload map[string]interface{}) error {
	if _, ok := payload["_decode_error"]; ok {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta."+nodeResultGatesMetaKey+" must be valid JSON", nil)
	}
	for _, key := range []string{"gate_id", "gateId", "name", "status", "summary", "result_summary", "gate_type", "evaluator_kind", "evaluator_id", "policy_id", "provider_id", "model", "reasoning_effort"} {
		if err := requireOptionalStringPayloadField(payload, key, nodeResultGatesMetaKey); err != nil {
			return err
		}
	}
	for _, key := range []string{"artifact_ids", "artifactIds", "provider_capabilities", "evaluator_capabilities"} {
		if err := requireOptionalStringListPayloadField(payload, key, nodeResultGatesMetaKey); err != nil {
			return err
		}
	}
	if checks, ok := payload["checks"]; ok {
		items, ok := checks.([]interface{})
		if !ok {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta."+nodeResultGatesMetaKey+".checks must be an array", nil)
		}
		for _, item := range items {
			check, ok := item.(map[string]interface{})
			if !ok {
				return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta."+nodeResultGatesMetaKey+".checks must contain JSON objects", nil)
			}
			for _, key := range []string{"name", "status", "detail"} {
				if err := requireOptionalStringPayloadField(check, key, nodeResultGatesMetaKey+".checks"); err != nil {
					return err
				}
			}
		}
	}
	if value, ok := payload["blocking"]; ok && value != nil {
		if _, ok := value.(bool); !ok {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta."+nodeResultGatesMetaKey+".blocking must be a boolean", nil)
		}
	}
	return nil
}

func requireOptionalStringPayloadField(payload map[string]interface{}, key string, field string) error {
	value, ok := payload[key]
	if !ok || value == nil {
		return nil
	}
	if _, ok := value.(string); !ok {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta."+field+"."+key+" must be a string", nil)
	}
	return nil
}

func requireOptionalStringListPayloadField(payload map[string]interface{}, key string, field string) error {
	value, ok := payload[key]
	if !ok || value == nil {
		return nil
	}
	if items, ok := value.([]string); ok {
		for _, item := range items {
			if strings.TrimSpace(item) == "" {
				return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta."+field+"."+key+" must contain only non-empty strings", nil)
			}
		}
		return nil
	}
	items, ok := value.([]interface{})
	if !ok {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta."+field+"."+key+" must be a string array", nil)
	}
	for _, item := range items {
		text, ok := item.(string)
		if !ok || strings.TrimSpace(text) == "" {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta."+field+"."+key+" must contain only strings", nil)
		}
	}
	return nil
}

func decodeNodeResultProjectionPayloads(raw string, field string) ([]map[string]interface{}, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var decoded interface{}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta."+field+" must be valid JSON", err)
	}
	switch typed := decoded.(type) {
	case []interface{}:
		payloads := make([]map[string]interface{}, 0, len(typed))
		for _, item := range typed {
			payload, ok := item.(map[string]interface{})
			if !ok {
				return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta."+field+" must contain JSON objects", nil)
			}
			payloads = append(payloads, payload)
		}
		return payloads, nil
	case map[string]interface{}:
		return []map[string]interface{}{typed}, nil
	default:
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta."+field+" must be a JSON object or array", nil)
	}
}

func normalizeNodeResultProjectionPayload(input map[string]interface{}, taskID, nodeID, executorID string) map[string]interface{} {
	payload := make(map[string]interface{}, len(input)+4)
	for key, value := range input {
		payload[key] = value
	}
	payload["task_id"] = strings.TrimSpace(taskID)
	payload["node_id"] = strings.TrimSpace(nodeID)
	if strings.TrimSpace(executorID) != "" {
		payload["produced_by"] = strings.TrimSpace(executorID)
	}
	return payload
}

func nodeResultArtifactPayloads(artifacts []*model.TaskArtifactRef) []map[string]interface{} {
	payloads := make([]map[string]interface{}, 0, len(artifacts))
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		payload := map[string]interface{}{}
		putStringPayload(payload, "artifact_id", artifact.GetArtifactId())
		putStringPayload(payload, "kind", artifact.GetKind())
		putStringPayload(payload, "name", artifact.GetName())
		putStringPayload(payload, "uri", artifact.GetUri())
		putStringPayload(payload, "checksum", artifact.GetChecksum())
		putStringSlicePayload(payload, "refs", artifact.GetRefs())
		putStringSlicePayload(payload, "paths", artifact.GetPaths())
		putStringPayload(payload, "markdown", artifact.GetMarkdown())
		putStringPayload(payload, "meta", artifact.GetMeta())
		putStringPayload(payload, "size", artifact.GetSize())
		payloads = append(payloads, payload)
	}
	return payloads
}

func nodeResultGatePayloads(gates []*model.TaskGateResult) []map[string]interface{} {
	payloads := make([]map[string]interface{}, 0, len(gates))
	for _, gate := range gates {
		if gate == nil {
			continue
		}
		payload := map[string]interface{}{}
		putStringPayload(payload, "gate_plan_id", gate.GetGatePlanId())
		putStringPayload(payload, "gate_id", gate.GetGateId())
		putStringPayload(payload, "name", gate.GetName())
		putStringPayload(payload, "status", gate.GetStatus())
		putStringPayload(payload, "summary", gate.GetSummary())
		putStringSlicePayload(payload, "artifactIds", gate.GetArtifactIds())
		checks := make([]interface{}, 0, len(gate.GetChecks()))
		for _, check := range gate.GetChecks() {
			if check == nil {
				continue
			}
			checkPayload := map[string]interface{}{}
			putStringPayload(checkPayload, "name", check.GetName())
			putStringPayload(checkPayload, "status", check.GetStatus())
			putStringPayload(checkPayload, "detail", check.GetDetail())
			checks = append(checks, checkPayload)
		}
		if len(checks) > 0 {
			payload["checks"] = checks
		}
		if gate.GetBlocking() {
			payload["blocking"] = true
		}
		payloads = append(payloads, payload)
	}
	return payloads
}

func putStringPayload(payload map[string]interface{}, key string, value string) {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		payload[key] = trimmed
	}
}

func putStringSlicePayload(payload map[string]interface{}, key string, values []string) {
	if len(values) == 0 {
		return
	}
	items := make([]interface{}, 0, len(values))
	for _, value := range values {
		items = append(items, strings.TrimSpace(value))
	}
	payload[key] = items
}

func isBlockingGateFailure(payload map[string]interface{}) bool {
	blocking, ok := payload["blocking"].(bool)
	if !ok || !blocking {
		return false
	}
	switch strings.ToLower(firstPayloadString(payload, "status")) {
	case "passed", "success", "accepted":
		return false
	default:
		return true
	}
}

func gateDecisionFromPayload(payload map[string]interface{}) nodeResultGateDecision {
	if !isBlockingGateFailure(payload) {
		return nodeResultGateDecision{}
	}
	return nodeResultGateDecision{
		Blocked: true,
		GateID:  firstPayloadString(payload, "gate_id", "gateId"),
		Summary: firstPayloadString(payload, "summary", "result_summary"),
	}
}

func acceptanceVerdictMetaValue(verdict model.AcceptanceVerdict) string {
	switch verdict {
	case model.AcceptanceVerdict_ACCEPTANCE_VERDICT_ACCEPTED:
		return "accepted"
	case model.AcceptanceVerdict_ACCEPTANCE_VERDICT_REJECTED:
		return "rejected"
	case model.AcceptanceVerdict_ACCEPTANCE_VERDICT_PENDING:
		return "pending"
	default:
		return "unspecified"
	}
}

func normalNodeStatusCounts(nodes []persistence.CollaborationTaskNode) (completed int, failed int, skipped int, total int) {
	for index := range nodes {
		node := &nodes[index]
		if isSynthesisNode(node) {
			continue
		}
		total++
		switch node.Status {
		case int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED):
			completed++
		case int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED):
			failed++
		case int32(model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED):
			skipped++
		}
	}
	return completed, failed, skipped, total
}

func isParallelCollaborationEngine(engine model.CollaborationEngineType) bool {
	return enginePolicyScheduleForEngine(engine).Parallel
}

func readyCollaborationNodes(nodes []persistence.CollaborationTaskNode) []int {
	ready := make([]int, 0, len(nodes))
	for index := range nodes {
		node := &nodes[index]
		if isSynthesisNode(node) || node.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING) {
			continue
		}
		if collaborationPrerequisitesSatisfied(node, nodes) {
			ready = append(ready, index)
		}
	}
	return ready
}

func hasPendingCollaborationNodes(nodes []persistence.CollaborationTaskNode) bool {
	for index := range nodes {
		if !isSynthesisNode(&nodes[index]) && nodes[index].Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING) {
			return true
		}
	}
	return false
}

func hasRunningCollaborationNodes(nodes []persistence.CollaborationTaskNode) bool {
	for index := range nodes {
		if nodes[index].Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
			return true
		}
	}
	return false
}

func collaborationPrerequisitesSatisfied(node *persistence.CollaborationTaskNode, nodes []persistence.CollaborationTaskNode) bool {
	if node == nil {
		return false
	}
	for _, prerequisiteID := range parseMetaList(node.PrerequisiteNodeIDs) {
		prerequisite := collaborationNodeByID(nodes, prerequisiteID)
		if prerequisite == nil {
			return false
		}
		switch prerequisite.Status {
		case int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
			int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED):
			continue
		default:
			return false
		}
	}
	return true
}

func collaborationContextsForPrerequisites(node *persistence.CollaborationTaskNode, nodes []persistence.CollaborationTaskNode) []collaborationNodeContext {
	if node == nil {
		return nil
	}
	contexts := make([]collaborationNodeContext, 0)
	for _, prerequisiteID := range parseMetaList(node.PrerequisiteNodeIDs) {
		prerequisite := collaborationNodeByID(nodes, prerequisiteID)
		if prerequisite == nil {
			continue
		}
		switch prerequisite.Status {
		case int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED):
			contexts = append(contexts, collaborationContextFromNode(prerequisite, false))
		case int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED):
			contexts = append(contexts, collaborationContextFromNode(prerequisite, true))
		}
	}
	return contexts
}

func collaborationNodeByID(nodes []persistence.CollaborationTaskNode, nodeID string) *persistence.CollaborationTaskNode {
	nodeID = strings.TrimSpace(nodeID)
	if nodeID == "" {
		return nil
	}
	for index := range nodes {
		if nodes[index].ID == nodeID {
			return &nodes[index]
		}
	}
	return nil
}

func collaborationContextFromNode(node *persistence.CollaborationTaskNode, failed bool) collaborationNodeContext {
	if node == nil {
		return collaborationNodeContext{}
	}
	return collaborationNodeContext{
		AgentID: node.AgentID,
		Role:    node.Role,
		Summary: node.ResultSummary,
		Failed:  failed,
	}
}

func (s *OrchestrationService) isTaskCancelled(ctx context.Context, db *gorm.DB, task *persistence.CollaborationTask) bool {
	if task == nil {
		return false
	}
	var status int32
	if err := db.WithContext(ctx).Model(&persistence.CollaborationTask{}).Select("status").Where("id = ?", task.ID).Scan(&status).Error; err != nil {
		logger.Errorf(ctx, "failed to check collaboration cancellation: task_id=%s err=%v", task.ID, err)
		return false
	}
	if status != int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED) {
		return false
	}
	task.Status = status
	task.EndedAt = time.Now()
	return true
}

func (s *OrchestrationService) failTaskIfTimeBudgetExceeded(ctx context.Context, db *gorm.DB, task *persistence.CollaborationTask, nodes []persistence.CollaborationTaskNode) bool {
	if !taskTimeBudgetExceeded(task, time.Now()) {
		return false
	}
	summary := taskTimeBudgetExceededSummary(task)
	s.skipPendingNodesWithSummary(ctx, db, nodes, summary)
	s.updateTaskMeta(ctx, db, task, map[string]string{
		"circuit_breaker_state": "open",
		"failure_reason":        "time_budget_exceeded",
		"budget_time_ms":        fmt.Sprintf("%d", task.BudgetTimeMs),
		"budget_elapsed_ms":     fmt.Sprintf("%d", taskElapsedMs(task, time.Now())),
	})
	s.updateTaskStatus(ctx, db, task, model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED)
	return true
}

func (s *OrchestrationService) skipPendingNodes(ctx context.Context, db *gorm.DB, task *persistence.CollaborationTask, nodes []persistence.CollaborationTaskNode) {
	_ = task
	s.skipPendingNodesWithSummary(ctx, db, nodes, "Task cancelled.")
}

func (s *OrchestrationService) skipBlockedNodes(ctx context.Context, db *gorm.DB, nodes []persistence.CollaborationTaskNode) {
	s.skipPendingNodesWithSummary(ctx, db, nodes, "Node skipped because prerequisite nodes did not complete.")
}

func (s *OrchestrationService) skipPendingNodesWithSummary(ctx context.Context, db *gorm.DB, nodes []persistence.CollaborationTaskNode, summary string) {
	for index := range nodes {
		node := &nodes[index]
		if node.Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED) || node.Status == int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED) {
			continue
		}
		s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED, summary)
	}
}

func taskTimeBudgetExceeded(task *persistence.CollaborationTask, now time.Time) bool {
	return task != nil && task.BudgetTimeMs > 0 && taskElapsedMs(task, now) >= task.BudgetTimeMs
}

func taskElapsedMs(task *persistence.CollaborationTask, now time.Time) int64 {
	if task == nil || task.StartedAt.IsZero() {
		return 0
	}
	if now.Before(task.StartedAt) {
		return 0
	}
	return now.Sub(task.StartedAt).Milliseconds()
}

func taskTimeBudgetExceededSummary(task *persistence.CollaborationTask) string {
	return fmt.Sprintf("Time budget exceeded after %dms (budget %dms).", taskElapsedMs(task, time.Now()), task.BudgetTimeMs)
}

func (s *OrchestrationService) updateNode(ctx context.Context, db *gorm.DB, node *persistence.CollaborationTaskNode, status model.TaskNodeStatus, resultSummary string) {
	now := time.Now()
	updates := map[string]interface{}{
		"status": int32(status),
	}
	node.Status = int32(status)
	if status == model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING {
		updates["started_at"] = now
		node.StartedAt = now
	}
	if status == model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED || status == model.TaskNodeStatus_TASK_NODE_STATUS_FAILED || status == model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED {
		updates["ended_at"] = now
		updates["result_summary"] = resultSummary
		node.EndedAt = now
		node.ResultSummary = resultSummary
	}
	if err := db.WithContext(ctx).Model(&persistence.CollaborationTaskNode{}).Where("id = ?", node.ID).Updates(updates).Error; err != nil {
		logger.Errorf(ctx, "failed to update collaboration node: node_id=%s status=%d err=%v", node.ID, status, err)
	}
}

func (s *OrchestrationService) ensureNodeConversation(
	ctx context.Context,
	db *gorm.DB,
	actorID string,
	task *persistence.CollaborationTask,
	node *persistence.CollaborationTaskNode,
	agent *domain.Agent,
	runtimeProvider collaborationRuntimeProviderOverride,
) error {
	var existing persistence.Conversation
	if err := db.WithContext(ctx).Where("id = ?", node.ID).First(&existing).Error; err == nil {
		return nil
	} else if err != gorm.ErrRecordNotFound {
		return err
	}

	now := time.Now()
	providerID := firstNonEmptyString(runtimeProvider.ProviderID, strings.TrimSpace(agent.ProviderID))
	modelName := firstNonEmptyString(runtimeProvider.Model, strings.TrimSpace(agent.ModelName))
	meta, _ := json.Marshal(map[string]string{
		"source":               "agent_canvas",
		"task_id":              task.ID,
		"node_id":              node.ID,
		"role":                 node.Role,
		"provider_plan_source": runtimeProvider.Source,
	})
	conversation := persistence.Conversation{
		ID:          node.ID,
		AgentID:     agent.AgentID,
		UserID:      actorID,
		Title:       task.Title,
		ProviderID:  providerID,
		ModelName:   &modelName,
		Status:      "active",
		ConfigJSON:  json.RawMessage(agent.ConfigJSON),
		Meta:        json.RawMessage(meta),
		CreatedAt:   now,
		UpdatedAt:   now,
		Description: &task.Description,
	}
	return db.WithContext(ctx).Create(&conversation).Error
}

func (s *OrchestrationService) updateTaskStatus(ctx context.Context, db *gorm.DB, task *persistence.CollaborationTask, status model.CollaborationTaskStatus) {
	now := time.Now()
	task.Status = int32(status)
	task.EndedAt = now
	if err := db.WithContext(ctx).Model(&persistence.CollaborationTask{}).Where("id = ?", task.ID).Updates(map[string]interface{}{
		"status":   int32(status),
		"ended_at": now,
	}).Error; err != nil {
		logger.Errorf(ctx, "failed to update collaboration task: task_id=%s status=%d err=%v", task.ID, status, err)
	}
}

func (s *OrchestrationService) turnConfigForNode(task *persistence.CollaborationTask, node *persistence.CollaborationTaskNode, agent *domain.Agent, runtimeProvider collaborationRuntimeProviderOverride) *TurnConfig {
	agentPrompt, workspaceRoot := agentRuntimeConfig(agent)
	availableTools := []string{}
	if s.toolRegistry != nil {
		availableTools = s.toolRegistry.ToolNames()
	}
	providerID := firstNonEmptyString(runtimeProvider.ProviderID, strings.TrimSpace(agent.ProviderID))
	modelName := firstNonEmptyString(runtimeProvider.Model, strings.TrimSpace(agent.ModelName))
	effort := firstNonEmptyString(runtimeProvider.ReasoningEffort, strings.TrimSpace(agent.Effort))
	return &TurnConfig{
		AgentID:           agent.AgentID,
		ConversationID:    node.ID,
		Identity:          agent.Name,
		AgentConfigPrompt: agentPrompt,
		Platform:          "agent_canvas",
		AvailableTools:    availableTools,
		ContextWindowSize: 128000,
		MaxRetries:        3,
		Provider:          providerID,
		Model:             modelName,
		Effort:            effort,
		WorkspaceRoot:     workspaceRoot,
		TaskID:            task.ID,
		StepID:            node.ID,
	}
}

func loadRuntimeProviderOverrideForNode(ctx context.Context, db *gorm.DB, task *persistence.CollaborationTask, node *persistence.CollaborationTaskNode) (collaborationRuntimeProviderOverride, error) {
	if db == nil || task == nil || node == nil {
		return collaborationRuntimeProviderOverride{}, nil
	}
	var record persistence.TaskProviderPlan
	err := db.WithContext(ctx).
		Where("task_id = ? AND status = ?", strings.TrimSpace(task.ID), "active").
		Order("updated_at DESC, created_at DESC").
		First(&record).Error
	if err == gorm.ErrRecordNotFound {
		return collaborationRuntimeProviderOverride{}, nil
	}
	if err != nil {
		return collaborationRuntimeProviderOverride{}, err
	}
	var plan model.TaskProviderPlan
	if err := protojson.Unmarshal([]byte(record.PlanJSON), &plan); err != nil {
		return collaborationRuntimeProviderOverride{}, err
	}
	spec := providerSpecForNode(&plan, node)
	if spec == nil {
		return collaborationRuntimeProviderOverride{Source: strings.TrimSpace(plan.GetSource())}, nil
	}
	return collaborationRuntimeProviderOverride{
		ProviderID:      strings.TrimSpace(spec.GetProviderId()),
		Model:           strings.TrimSpace(spec.GetModel()),
		ReasoningEffort: strings.TrimSpace(spec.GetReasoningEffort()),
		Source:          strings.TrimSpace(plan.GetSource()),
	}, nil
}

func providerSpecForNode(plan *model.TaskProviderPlan, node *persistence.CollaborationTaskNode) *model.TaskProviderSpec {
	if plan == nil || node == nil {
		return nil
	}
	nodeAgentID := strings.TrimSpace(node.AgentID)
	nodeRole := strings.TrimSpace(node.Role)
	for _, provider := range plan.GetProviders() {
		if provider == nil {
			continue
		}
		if strings.TrimSpace(provider.GetAgentId()) == nodeAgentID {
			return provider
		}
	}
	for _, provider := range plan.GetProviders() {
		if provider == nil {
			continue
		}
		role, _ := normalizeAtelierAgentRole(provider.GetRole())
		if role != "" && role == nodeRole {
			return provider
		}
	}
	return nil
}

func agentRuntimeConfig(agent *domain.Agent) (string, string) {
	if agent == nil {
		return "", ""
	}
	var config map[string]interface{}
	_ = json.Unmarshal([]byte(agent.ConfigJSON), &config)
	systemPrompt := firstConfigString(config, "systemPrompt", "system_prompt", "prompt")
	soul := firstConfigString(config, "soulMd", "soul_md")
	agents := firstConfigString(config, "agentsMd", "agents_md")
	parts := compactStrings([]string{systemPrompt, soul, agents})
	if len(parts) == 0 {
		parts = compactStrings([]string{agent.Description})
	}
	workspaceRoot := firstConfigString(config, "rootfsPath", "rootfs_path", "workspaceRoot", "workspace_root")
	return strings.Join(parts, "\n\n"), workspaceRoot
}

func agentExecutorKind(agent *domain.Agent) model.ExecutorKind {
	if agent == nil {
		return model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED
	}
	var config map[string]interface{}
	_ = json.Unmarshal([]byte(agent.ConfigJSON), &config)
	executorKind := strings.ToLower(firstConfigString(config, "executorKind", "executor_kind"))
	switch executorKind {
	case "desktop_device", strings.ToLower(model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE.String()):
		return model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE
	case "station_hosted", strings.ToLower(model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED.String()):
		return model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED
	}
	runtimeKind := strings.ToLower(firstConfigString(config, "runtimeKind", "runtime_kind", "protocol"))
	if runtimeKind == "cli" || firstConfigString(config, "cliCommand", "cli_command") != "" {
		return model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE
	}
	return model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED
}

func desktopExecutorRequiredSummary(agent *domain.Agent) string {
	agentID := ""
	if agent != nil {
		agentID = strings.TrimSpace(agent.AgentID)
	}
	if agentID == "" {
		agentID = "unknown"
	}
	return fmt.Sprintf("Desktop device executor required for CLI agent %s; Station hosted orchestration cannot run local CLI commands yet.", agentID)
}

func desktopExecutorAwaitingSummary(agent *domain.Agent) string {
	agentID := ""
	if agent != nil {
		agentID = strings.TrimSpace(agent.AgentID)
	}
	if agentID == "" {
		agentID = "unknown"
	}
	return fmt.Sprintf("Awaiting desktop device executor result for CLI agent %s.", agentID)
}

func firstConfigString(config map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value, ok := config[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstConfigMap(config map[string]interface{}, keys ...string) (map[string]interface{}, string) {
	for _, key := range keys {
		if value, ok := config[key].(map[string]interface{}); ok {
			return value, key
		}
	}
	return nil, ""
}

func firstConfigFloat(config map[string]interface{}, keys ...string) float64 {
	for _, key := range keys {
		switch value := config[key].(type) {
		case float64:
			return value
		case int:
			return float64(value)
		case int64:
			return float64(value)
		case json.Number:
			parsed, err := value.Float64()
			if err == nil {
				return parsed
			}
		case string:
			parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err == nil {
				return parsed
			}
		}
	}
	return 0
}

func collaborationNodePrompt(task *persistence.CollaborationTask, node *persistence.CollaborationTaskNode, priorResults []collaborationNodeContext) string {
	prompt := fmt.Sprintf(
		"Collaboration goal:\n%s\n\nNode role: %s\nNode description:\n%s",
		task.Description,
		node.Role,
		node.Description,
	)
	if len(priorResults) == 0 {
		return strings.TrimSpace(prompt)
	}
	var contextLines []string
	for _, result := range priorResults {
		summary := strings.TrimSpace(result.Summary)
		if summary == "" {
			continue
		}
		status := "completed"
		if result.Failed {
			status = "failed"
		}
		contextLines = append(contextLines, fmt.Sprintf("- Agent %s (%s, %s): %s", result.AgentID, result.Role, status, summary))
	}
	if len(contextLines) == 0 {
		return strings.TrimSpace(prompt)
	}
	return strings.TrimSpace(fmt.Sprintf(
		"%s\n\nPrevious collaboration results:\n%s\n\nUse these prior results as context. Build on useful findings, call out disagreements, and avoid repeating completed work.",
		prompt,
		strings.Join(contextLines, "\n"),
	))
}

func loadCollaborationResumeContext(ctx context.Context, db *gorm.DB, taskID string) (*collaborationResumeContext, error) {
	taskID = strings.TrimSpace(taskID)
	if db == nil || taskID == "" {
		return nil, nil
	}
	var interrupt persistence.InterruptRequest
	err := db.WithContext(ctx).
		Where("task_id = ? AND status = ? AND consumed_at IS NULL AND resume_payload_json <> ?", taskID, int32(model.InterruptStatus_INTERRUPT_STATUS_RESOLVED), "").
		Order("resolved_at ASC, created_at ASC").
		First(&interrupt).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &collaborationResumeContext{
		InterruptID:       strings.TrimSpace(interrupt.InterruptID),
		InterruptType:     strings.TrimSpace(interrupt.InterruptType),
		PayloadJSON:       strings.TrimSpace(interrupt.PayloadJSON),
		ResumePayloadJSON: strings.TrimSpace(interrupt.ResumePayloadJSON),
	}, nil
}

func appendCollaborationResumeContext(prompt string, resumeContext *collaborationResumeContext) string {
	if resumeContext == nil || strings.TrimSpace(resumeContext.ResumePayloadJSON) == "" {
		return strings.TrimSpace(prompt)
	}
	lines := []string{
		strings.TrimSpace(prompt),
		"",
		"Resolved human interrupt context:",
		fmt.Sprintf("- interrupt_id: %s", strings.TrimSpace(resumeContext.InterruptID)),
	}
	if strings.TrimSpace(resumeContext.InterruptType) != "" {
		lines = append(lines, fmt.Sprintf("- interrupt_type: %s", strings.TrimSpace(resumeContext.InterruptType)))
	}
	if strings.TrimSpace(resumeContext.PayloadJSON) != "" {
		lines = append(lines, fmt.Sprintf("- original_payload_json: %s", strings.TrimSpace(resumeContext.PayloadJSON)))
	}
	lines = append(lines,
		fmt.Sprintf("- resume_payload_json: %s", strings.TrimSpace(resumeContext.ResumePayloadJSON)),
		"",
		"Treat this Station-owned resolved interrupt as authoritative input for this resumed turn. Continue from the decision and do not ask the user to repeat it.",
	)
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func markCollaborationResumeContextConsumed(ctx context.Context, db *gorm.DB, interruptID string, stepID string, turnID string) error {
	interruptID = strings.TrimSpace(interruptID)
	if db == nil || interruptID == "" {
		return nil
	}
	now := time.Now()
	result := db.WithContext(ctx).
		Model(&persistence.InterruptRequest{}).
		Where("interrupt_id = ? AND consumed_at IS NULL", interruptID).
		Updates(map[string]interface{}{
			"consumed_at":      now,
			"consumed_step_id": strings.TrimSpace(stepID),
			"consumed_turn_id": strings.TrimSpace(turnID),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, "resume context was already consumed", nil)
	}
	return nil
}

func collaborationSynthesisPrompt(task *persistence.CollaborationTask, nodes []persistence.CollaborationTaskNode) string {
	var lines []string
	for _, node := range nodes {
		if isSynthesisNode(&node) {
			continue
		}
		summary := strings.TrimSpace(node.ResultSummary)
		if summary == "" {
			continue
		}
		status := model.TaskNodeStatus(node.Status).String()
		lines = append(lines, fmt.Sprintf("- Agent %s (%s, %s): %s", node.AgentID, node.Role, status, summary))
	}
	if len(lines) == 0 {
		lines = append(lines, "- No node produced a usable summary.")
	}
	return strings.TrimSpace(fmt.Sprintf(
		"Collaboration goal:\n%s\n\nAgent node results:\n%s\n\nProduce the final collaboration result. Include: 1) final answer, 2) key contributions, 3) risks or disagreements, 4) concrete next steps. Be concise and do not invent results that are not supported by the node outputs.",
		task.Description,
		strings.Join(lines, "\n"),
	))
}

func isSynthesisNode(node *persistence.CollaborationTaskNode) bool {
	return node != nil && strings.EqualFold(strings.TrimSpace(node.Role), collaborationRoleIntegrator)
}

func (s *OrchestrationService) publishTaskCreated(ctx context.Context, task *model.CollaborationTask, nodes []*model.TaskNode) {
	if task == nil {
		return
	}
	for _, node := range nodes {
		if node == nil || strings.TrimSpace(node.GetAgentId()) == "" {
			continue
		}
		s.publishEvent(ctx, node.GetAgentId(), string(domain.EventTypeCollaborationTaskCreated), map[string]interface{}{
			"task_id":     task.GetTaskId(),
			"agent_id":    node.GetAgentId(),
			"title":       task.GetTitle(),
			"description": task.GetDescription(),
			"engine_type": int32(task.GetEngineType()),
			"status":      int32(task.GetStatus()),
		}, task.GetTaskId(), "")
	}
}

func (s *OrchestrationService) publishTaskFinished(ctx context.Context, task *model.CollaborationTask, nodes []*model.TaskNode, eventType domain.EventType) {
	if task == nil {
		return
	}
	for _, node := range nodes {
		if node == nil || strings.TrimSpace(node.GetAgentId()) == "" {
			continue
		}
		s.publishEvent(ctx, node.GetAgentId(), string(eventType), map[string]interface{}{
			"task_id":     task.GetTaskId(),
			"agent_id":    node.GetAgentId(),
			"title":       task.GetTitle(),
			"engine_type": int32(task.GetEngineType()),
			"status":      int32(task.GetStatus()),
		}, task.GetTaskId(), "")
	}
}

func (s *OrchestrationService) publishNodeEvent(ctx context.Context, task *persistence.CollaborationTask, node *persistence.CollaborationTaskNode, eventType domain.EventType, turnID, resultSummary string) {
	if task == nil || node == nil {
		return
	}
	s.publishEvent(ctx, node.AgentID, string(eventType), nodeEventPayload(task, node, turnID, resultSummary, nil), task.ID, node.ID)
}

func (s *OrchestrationService) publishExecutorLeaseEvent(ctx context.Context, task *persistence.CollaborationTask, node *persistence.CollaborationTaskNode, lease *persistence.ExecutorLease, eventType domain.EventType, reason string) {
	if task == nil || node == nil || lease == nil {
		return
	}
	s.publishEvent(ctx, node.AgentID, string(eventType), executorLeaseEventPayload(task, node, lease, reason), task.ID, node.ID)
}

func appendNodeResultTaskEventsTx(
	ctx context.Context,
	tx *gorm.DB,
	writer *TaskEventWriter,
	task *persistence.CollaborationTask,
	node *persistence.CollaborationTaskNode,
	lease *persistence.ExecutorLease,
	nodeEventType domain.EventType,
	turnID string,
	resultSummary string,
	resultStatus string,
	enginePolicyTurn *model.EnginePolicyTurn,
	projectionEvents []collaborationProjectionEvent,
) ([]committedTaskEvent, error) {
	if task == nil || node == nil || lease == nil || writer == nil {
		return nil, nil
	}
	events := make([]committedTaskEvent, 0, 2+len(projectionEvents))
	if event, err := appendCommittedTaskEventTx(ctx, tx, writer, node.AgentID, string(nodeEventType), nodeEventPayload(task, node, turnID, resultSummary, enginePolicyTurn), task.ID, node.ID); err != nil {
		return nil, err
	} else {
		events = append(events, event)
	}
	for _, projectionEvent := range projectionEvents {
		if projectionEvent.Payload == nil {
			continue
		}
		event, err := appendCommittedTaskEventTx(ctx, tx, writer, node.AgentID, string(projectionEvent.EventType), projectionEvent.Payload, task.ID, node.ID)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if event, err := appendCommittedTaskEventTx(ctx, tx, writer, node.AgentID, string(domain.EventTypeCollaborationExecutorReleased), executorLeaseEventPayload(task, node, lease, resultStatus), task.ID, node.ID); err != nil {
		return nil, err
	} else {
		events = append(events, event)
	}
	return events, nil
}

func runActiveTaskGatePlanTx(
	ctx context.Context,
	tx *gorm.DB,
	task *persistence.CollaborationTask,
	node *persistence.CollaborationTaskNode,
) ([]collaborationProjectionEvent, nodeResultGateDecision, error) {
	if tx == nil || task == nil || node == nil {
		return nil, nodeResultGateDecision{}, nil
	}
	var record persistence.TaskGatePlan
	err := tx.Where(
		"task_id = ? AND step_id = ? AND status = ?",
		task.ID,
		node.ID,
		"active",
	).Order("updated_at DESC, created_at DESC").First(&record).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nodeResultGateDecision{}, nil
		}
		return nil, nodeResultGateDecision{}, err
	}
	plan, err := GatePlanFromPersistence(record)
	if err != nil {
		return nil, nodeResultGateDecision{}, err
	}
	results, err := NewGateRunner(nil).RunPlan(ctx, GatePlanRunRequest{
		Task:       task,
		Node:       node,
		ProducedBy: "station.gate_runner",
		Plan:       plan,
	})
	if err != nil {
		return nil, nodeResultGateDecision{}, err
	}
	events := make([]collaborationProjectionEvent, 0, len(results))
	decision := nodeResultGateDecision{}
	for _, result := range results {
		if result.Event.Payload == nil {
			continue
		}
		events = append(events, result.Event)
		if result.Decision.Blocked && !decision.Blocked {
			decision = result.Decision
		}
	}
	status := "executed"
	if decision.Blocked {
		status = "blocked"
	}
	if err := tx.Model(&persistence.TaskGatePlan{}).Where("gate_plan_id = ?", record.GatePlanID).Updates(map[string]interface{}{
		"status":     status,
		"updated_at": time.Now(),
	}).Error; err != nil {
		return nil, nodeResultGateDecision{}, err
	}
	return events, decision, nil
}

func appendCommittedTaskEventTx(ctx context.Context, tx *gorm.DB, writer *TaskEventWriter, agentID string, eventType string, payload interface{}, taskID string, nodeID string) (committedTaskEvent, error) {
	record, err := writer.appendTx(ctx, tx, "", taskID, nodeID, "", eventType, payload)
	if err != nil {
		return committedTaskEvent{}, err
	}
	return committedTaskEvent{
		AgentID:   strings.TrimSpace(agentID),
		EventType: eventType,
		Payload:   payload,
		Record:    record,
	}, nil
}

func nodeEventPayload(task *persistence.CollaborationTask, node *persistence.CollaborationTaskNode, turnID, resultSummary string, typedEnginePolicyTurn *model.EnginePolicyTurn) map[string]interface{} {
	payload := map[string]interface{}{
		"task_id":  task.ID,
		"node_id":  node.ID,
		"agent_id": node.AgentID,
		"role":     node.Role,
		"status":   node.Status,
	}
	if strings.TrimSpace(turnID) != "" {
		payload["turn_id"] = turnID
	}
	if strings.TrimSpace(resultSummary) != "" {
		payload["result_summary"] = resultSummary
	}
	if turn, ok := enginePolicyTurnFromProto(typedEnginePolicyTurn); ok {
		payload["engine_policy_turn"] = enginePolicyTurnPayloadFromTurn(turn)
	} else if strings.TrimSpace(resultSummary) != "" {
		if turn, ok := enginePolicyTurnFromSummary(node.Role, resultSummary); ok {
			payload["engine_policy_turn"] = enginePolicyTurnPayloadFromTurn(turn)
		}
	}
	return payload
}

func executorLeaseEventPayload(task *persistence.CollaborationTask, node *persistence.CollaborationTaskNode, lease *persistence.ExecutorLease, reason string) map[string]interface{} {
	payload := map[string]interface{}{
		"task_id":       task.ID,
		"node_id":       node.ID,
		"agent_id":      node.AgentID,
		"lease_id":      lease.LeaseID,
		"executor_id":   lease.ExecutorID,
		"executor_kind": lease.ExecutorKind,
		"lease_status":  lease.Status,
	}
	if strings.TrimSpace(reason) != "" {
		payload["reason"] = reason
	}
	return payload
}

func (s *OrchestrationService) publishEvent(ctx context.Context, agentID, eventType string, payload interface{}, taskID, nodeID string) {
	writer := s.eventWriter
	if writer == nil {
		writer = NewTaskEventWriter(s.eventBus)
	}
	var extraMeta map[string]string
	if strings.TrimSpace(nodeID) != "" {
		extraMeta = map[string]string{"node_id": nodeID}
	}
	writer.Publish(ctx, agentID, eventType, payload, taskID, nodeID, "", extraMeta)
}

func (s *OrchestrationService) publishCommittedTaskEvents(ctx context.Context, events []committedTaskEvent) {
	writer := s.eventWriter
	if writer == nil {
		writer = NewTaskEventWriter(s.eventBus)
	}
	if writer.eventBus == nil {
		return
	}
	for _, event := range events {
		if event.Record == nil {
			continue
		}
		metadata := map[string]string{
			"agent_id":  strings.TrimSpace(event.AgentID),
			"task_id":   event.Record.TaskID,
			"event_id":  event.Record.ID,
			"event_seq": fmt.Sprintf("%d", event.Record.EventSeq),
		}
		if strings.TrimSpace(event.Record.StepID) != "" {
			metadata["node_id"] = strings.TrimSpace(event.Record.StepID)
		}
		_ = writer.eventBus.Publish(ctx, domain.DomainEvent{
			EventID:   event.Record.ID,
			EventType: event.EventType,
			ActorID:   strings.TrimSpace(event.AgentID),
			Payload:   event.Payload,
			Metadata:  metadata,
		})
	}
}

func taskEventRecordToProto(record *persistence.TaskEvent) *model.TaskEvent {
	if record == nil {
		return nil
	}
	return &model.TaskEvent{
		EventId:                   record.ID,
		TaskId:                    record.TaskID,
		StepId:                    record.StepID,
		TurnId:                    record.TurnID,
		EventSeq:                  record.EventSeq,
		Type:                      model.TaskEventType(record.EventType),
		PayloadJson:               record.Payload,
		CreatedAt:                 timestamppb.New(record.CreatedAt),
		EnginePolicyTurn:          enginePolicyTurnProtoFromTaskEventPayload(record.Payload),
		CollaborationSessionEvent: collaborationSessionEventProtoFromTaskEventPayload(record.Payload),
	}
}

func taskEventTypeForDomainEvent(eventType string) model.TaskEventType {
	switch domain.EventType(eventType) {
	case domain.EventTypeCollaborationTaskCreated:
		return model.TaskEventType_TASK_EVENT_TYPE_TASK_CREATED
	case domain.EventTypeCollaborationTaskCompleted, domain.EventTypeCollaborationTaskFailed, domain.EventTypeCollaborationTaskCancelled:
		return model.TaskEventType_TASK_EVENT_TYPE_TASK_STATUS_CHANGED
	case domain.EventTypeCollaborationNodeRunning:
		return model.TaskEventType_TASK_EVENT_TYPE_STEP_STARTED
	case domain.EventTypeCollaborationNodeCompleted:
		return model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED
	case domain.EventTypeCollaborationNodeFailed:
		return model.TaskEventType_TASK_EVENT_TYPE_STEP_FAILED
	case domain.EventTypeCollaborationExecutorLeased:
		return model.TaskEventType_TASK_EVENT_TYPE_EXECUTOR_LEASED
	case domain.EventTypeCollaborationExecutorReleased:
		return model.TaskEventType_TASK_EVENT_TYPE_EXECUTOR_RELEASED
	case domain.EventTypeCollaborationArtifactCreated:
		return model.TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED
	case domain.EventTypeCollaborationGateResult:
		return model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT
	case domain.EventTypeCollaborationInterruptRequested:
		return model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED
	case domain.EventTypeCollaborationInterruptResolved:
		return model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED
	case domain.EventTypeCollaborationFeedbackRecorded:
		return model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED
	case domain.EventTypeAgentTurnStarted, domain.EventTypeAgentTurnCompleted, domain.EventTypeAgentTurnFailed:
		return model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT
	default:
		return model.TaskEventType_TASK_EVENT_TYPE_UNSPECIFIED
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func mergeStringMapJSON(raw string, updates map[string]string) string {
	meta := map[string]string{}
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &meta)
	}
	for key, value := range updates {
		if strings.TrimSpace(key) == "" {
			continue
		}
		meta[key] = strings.TrimSpace(value)
	}
	encoded, _ := json.Marshal(meta)
	return string(encoded)
}

func normalizeExecutorLeaseTTL(ttlMs int64) time.Duration {
	if ttlMs <= 0 {
		return defaultExecutorLeaseTTL
	}
	ttl := time.Duration(ttlMs) * time.Millisecond
	if ttl > maxExecutorLeaseTTL {
		return maxExecutorLeaseTTL
	}
	return ttl
}

func normalizeEngineType(engine model.CollaborationEngineType) model.CollaborationEngineType {
	if engine == model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_UNSPECIFIED {
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH
	}
	return engine
}

func copyStringMap(source map[string]string) map[string]string {
	result := make(map[string]string, len(source)+2)
	for key, value := range source {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		result[key] = strings.TrimSpace(value)
	}
	return result
}

func providerPlanFromCreateTaskRequest(req *model.CreateCollaborationTaskRequest, meta map[string]string) (*model.TaskProviderPlan, []string, error) {
	if req == nil {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	legacyAgentIDs := parseMetaList(meta["agent_ids"])
	plan := req.GetProviderPlan()
	if plan != nil && len(plan.GetProviders()) > 0 {
		normalized := cloneProviderPlan(plan)
		agentIDs := providerPlanAgentIDs(normalized)
		if len(agentIDs) == 0 {
			return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider_plan.providers.agent_id is required", nil)
		}
		if err := normalizeProviderPlanRoles(normalized); err != nil {
			return nil, nil, err
		}
		if len(legacyAgentIDs) > 0 && !sameStringList(legacyAgentIDs, agentIDs) {
			return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider_plan.providers.agent_id conflicts with meta.agent_ids", nil)
		}
		if strings.TrimSpace(normalized.GetSource()) == "" {
			normalized.Source = "typed_request"
		}
		return normalized, agentIDs, nil
	}
	if len(legacyAgentIDs) == 0 {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider_plan.providers or meta.agent_ids is required", nil)
	}
	return legacyProviderPlanFromMeta(legacyAgentIDs, meta), legacyAgentIDs, nil
}

func normalizeProviderPlanRoles(plan *model.TaskProviderPlan) error {
	if plan == nil {
		return nil
	}
	for _, provider := range plan.GetProviders() {
		if provider == nil {
			continue
		}
		role, err := normalizeAtelierAgentRole(provider.GetRole())
		if err != nil {
			return err
		}
		provider.Role = role
	}
	return nil
}

func normalizeAtelierAgentRole(raw string) (string, error) {
	role := strings.ToLower(strings.TrimSpace(raw))
	role = strings.ReplaceAll(role, "-", "_")
	switch role {
	case "":
		return "", nil
	case "lead":
		role = "planner"
	case "collaborator", "implementer", "developer", "worker":
		role = "executor"
	case "reviewer", "qa":
		role = "verifier"
	case "risk_reviewer", "policy_reviewer":
		role = "risk"
	case "synthesizer", "judge":
		role = "integrator"
	}
	if _, ok := atelierAgentRoles[role]; ok {
		return role, nil
	}
	return "", errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider_plan.providers.role must be a known Atelier AgentRole", nil)
}

func applyCollaborationPlanConstraints(
	meta map[string]string,
	engine model.CollaborationEngineType,
	providerPlan *model.TaskProviderPlan,
	workspaceID string,
) error {
	if meta == nil {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task meta is required", nil)
	}
	meta["supervisor_loop"] = collaborationSupervisorLoopEventBus
	meta["replan_policy"] = collaborationReplanPolicyBeforeB10
	meta["resume_anchor_policy"] = collaborationResumeAnchorLatestAccepted
	if workspaceID = strings.TrimSpace(workspaceID); workspaceID != "" {
		meta["workspace_ref"] = workspaceID
	}
	policy := &model.TaskOrchestrationPolicy{
		SupervisorLoop:     model.SupervisorLoopKind_SUPERVISOR_LOOP_KIND_STATION_EVENT_BUS,
		ReplanPolicy:       model.ReplanPolicyKind_REPLAN_POLICY_KIND_BEFORE_B10_FROM_RESUME_ANCHOR,
		ResumeAnchorPolicy: model.ResumeAnchorPolicyKind_RESUME_ANCHOR_POLICY_KIND_LATEST_ACCEPTED_CHECKPOINT,
		WorkspaceRef:       workspaceID,
	}
	if isParallelCollaborationEngine(engine) {
		integratorAgentID := ""
		if providerPlan != nil {
			integratorAgentID = strings.TrimSpace(providerPlan.GetSynthesizerAgentId())
		}
		if integratorAgentID == "" {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "parallel collaboration engine requires provider_plan.synthesizer_agent_id as integrator", nil)
		}
		meta["task_graph_parallel_policy"] = collaborationParallelPolicyIntegratorRequired
		meta["integrator_required"] = "true"
		meta["integrator_agent_id"] = integratorAgentID
		policy.TaskGraphParallelPolicy = model.TaskGraphParallelPolicy_TASK_GRAPH_PARALLEL_POLICY_INTEGRATOR_REQUIRED
		policy.IntegratorAgentId = integratorAgentID
		if providerPlan != nil {
			providerPlan.OrchestrationPolicy = policy
		}
		return nil
	}
	meta["task_graph_parallel_policy"] = collaborationParallelPolicySerialOnly
	meta["integrator_required"] = "false"
	delete(meta, "integrator_agent_id")
	policy.TaskGraphParallelPolicy = model.TaskGraphParallelPolicy_TASK_GRAPH_PARALLEL_POLICY_SERIAL_ONLY
	if providerPlan != nil {
		providerPlan.OrchestrationPolicy = policy
	}
	return nil
}

func cloneProviderPlan(plan *model.TaskProviderPlan) *model.TaskProviderPlan {
	if plan == nil {
		return &model.TaskProviderPlan{}
	}
	cloned := &model.TaskProviderPlan{
		SynthesizerAgentId: strings.TrimSpace(plan.GetSynthesizerAgentId()),
		Source:             strings.TrimSpace(plan.GetSource()),
		Providers:          make([]*model.TaskProviderSpec, 0, len(plan.GetProviders())),
	}
	if policy := plan.GetOrchestrationPolicy(); policy != nil {
		cloned.OrchestrationPolicy = &model.TaskOrchestrationPolicy{
			TaskGraphParallelPolicy: policy.GetTaskGraphParallelPolicy(),
			IntegratorAgentId:       strings.TrimSpace(policy.GetIntegratorAgentId()),
			SupervisorLoop:          policy.GetSupervisorLoop(),
			ReplanPolicy:            policy.GetReplanPolicy(),
			ResumeAnchorPolicy:      policy.GetResumeAnchorPolicy(),
			WorkspaceRef:            strings.TrimSpace(policy.GetWorkspaceRef()),
		}
	}
	for _, provider := range plan.GetProviders() {
		if provider == nil {
			continue
		}
		options := map[string]string{}
		for key, value := range provider.GetOptions() {
			key = strings.TrimSpace(key)
			if key == "" {
				continue
			}
			options[key] = strings.TrimSpace(value)
		}
		cloned.Providers = append(cloned.Providers, &model.TaskProviderSpec{
			ProviderId:           strings.TrimSpace(provider.GetProviderId()),
			Model:                strings.TrimSpace(provider.GetModel()),
			ReasoningEffort:      strings.TrimSpace(provider.GetReasoningEffort()),
			RequiredCapabilities: compactStrings(provider.GetRequiredCapabilities()),
			Options:              options,
			AgentId:              strings.TrimSpace(provider.GetAgentId()),
			Role:                 strings.TrimSpace(provider.GetRole()),
		})
	}
	return cloned
}

func providerPlanAgentIDs(plan *model.TaskProviderPlan) []string {
	if plan == nil {
		return nil
	}
	agentIDs := make([]string, 0, len(plan.GetProviders()))
	for _, provider := range plan.GetProviders() {
		if provider == nil {
			continue
		}
		agentIDs = append(agentIDs, provider.GetAgentId())
	}
	return compactStrings(agentIDs)
}

func legacyProviderPlanFromMeta(agentIDs []string, meta map[string]string) *model.TaskProviderPlan {
	modelName := strings.TrimSpace(meta["run_model"])
	providers := make([]*model.TaskProviderSpec, 0, len(agentIDs))
	for index, agentID := range agentIDs {
		providers = append(providers, &model.TaskProviderSpec{
			AgentId: strings.TrimSpace(agentID),
			Model:   modelName,
			Role:    roleForIndex(index),
		})
	}
	return &model.TaskProviderPlan{
		Providers:          providers,
		SynthesizerAgentId: strings.TrimSpace(meta["synthesizer_agent_id"]),
		Source:             "legacy_meta",
	}
}

func taskProviderPlanRecordFromProto(taskID string, plan *model.TaskProviderPlan, now time.Time) (*persistence.TaskProviderPlan, error) {
	if plan == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider_plan is required", nil)
	}
	planJSON, err := protojson.Marshal(plan)
	if err != nil {
		return nil, err
	}
	return &persistence.TaskProviderPlan{
		ProviderPlanID: generateID("provider_plan"),
		TaskID:         strings.TrimSpace(taskID),
		Source:         strings.TrimSpace(plan.GetSource()),
		Status:         "active",
		PlanJSON:       string(planJSON),
		CreatedAt:      now,
		UpdatedAt:      now,
	}, nil
}

func buildDirectRunInputSnapshot(task *persistence.CollaborationTask, actorID, providerID, modelIntent string, plan *model.TaskProviderPlan, meta map[string]string) ([]byte, error) {
	attachments, err := normalizeDirectRunInputSnapshotAttachments(meta)
	if err != nil {
		return nil, err
	}
	return json.Marshal(directRunInputSnapshot{
		ActorID:      strings.TrimSpace(actorID),
		TaskID:       strings.TrimSpace(task.ID),
		Title:        strings.TrimSpace(task.Title),
		Description:  strings.TrimSpace(task.Description),
		WorkspaceID:  strings.TrimSpace(task.WorkspaceID),
		ProviderID:   strings.TrimSpace(providerID),
		ModelIntent:  strings.TrimSpace(modelIntent),
		ProviderPlan: plan,
		Meta:         copyStringMap(meta),
		Attachments:  attachments,
	})
}

func normalizeDirectRunInputSnapshotAttachments(meta map[string]string) ([]directRunInputSnapshotAttachment, error) {
	raw := strings.TrimSpace(meta[directRunHostStorageAttachmentsMetaKey])
	if raw == "" {
		return []directRunInputSnapshotAttachment{}, nil
	}
	var entries []map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun input_snapshot attachments must be a JSON array", nil)
	}
	attachments := make([]directRunInputSnapshotAttachment, 0, len(entries))
	for _, entry := range entries {
		attachment, err := normalizeDirectRunInputSnapshotAttachment(entry)
		if err != nil {
			return nil, err
		}
		attachments = append(attachments, attachment)
	}
	return attachments, nil
}

func normalizeDirectRunInputSnapshotAttachment(entry map[string]interface{}) (directRunInputSnapshotAttachment, error) {
	for key := range entry {
		if isForbiddenDirectRunAttachmentField(key) {
			return directRunInputSnapshotAttachment{}, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun input_snapshot attachments must not include raw path, URL, body, base64, or write intent fields", nil)
		}
	}
	hostStorageRef := strings.TrimSpace(stringField(entry, "host_storage_ref"))
	mime := strings.TrimSpace(stringField(entry, "mime"))
	sha256 := strings.TrimSpace(stringField(entry, "sha256"))
	size, ok := int64Field(entry, "size")
	if hostStorageRef == "" || !strings.HasPrefix(hostStorageRef, directRunHostStorageRefPrefix) || strings.TrimPrefix(hostStorageRef, directRunHostStorageRefPrefix) == "" {
		return directRunInputSnapshotAttachment{}, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun input_snapshot attachments require opaque host_storage_ref", nil)
	}
	if mime == "" || strings.ContainsAny(mime, " \t\r\n") {
		return directRunInputSnapshotAttachment{}, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun input_snapshot attachments require mime metadata", nil)
	}
	if !ok || size < 0 {
		return directRunInputSnapshotAttachment{}, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun input_snapshot attachments require non-negative size metadata", nil)
	}
	if !strings.HasPrefix(sha256, "sha256:") || strings.TrimPrefix(sha256, "sha256:") == "" {
		return directRunInputSnapshotAttachment{}, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun input_snapshot attachments require sha256 metadata", nil)
	}
	return directRunInputSnapshotAttachment{
		HostStorageRef: hostStorageRef,
		Mime:           mime,
		Size:           size,
		Sha256:         sha256,
	}, nil
}

func isForbiddenDirectRunAttachmentField(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "path", "raw_path", "local_path", "file_path", "url", "src", "href", "uri", "base64", "data", "data_uri", "content", "body", "bytes", "write", "write_intent", "host_storage_write", "hoststorage.write", "input_snapshot_write", "inputsnapshotwrite":
		return true
	default:
		return false
	}
}

func stringField(entry map[string]interface{}, key string) string {
	value, ok := entry[key].(string)
	if !ok {
		return ""
	}
	return value
}

func int64Field(entry map[string]interface{}, key string) (int64, bool) {
	switch value := entry[key].(type) {
	case float64:
		if value != float64(int64(value)) {
			return 0, false
		}
		return int64(value), true
	case int64:
		return value, true
	default:
		return 0, false
	}
}

func directRunRecordFromProviderPlan(task *persistence.CollaborationTask, actorID string, plan *model.TaskProviderPlan, meta map[string]string, now time.Time) (*persistence.DirectRun, error) {
	if plan == nil || strings.TrimSpace(plan.GetSource()) != collaborationProviderPlanSourceDirectRun {
		return nil, nil
	}
	if task == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task is required for DirectRun", nil)
	}
	spec := firstProviderSpec(plan.GetProviders())
	if spec == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun provider spec is required", nil)
	}
	providerID := firstNonEmptyString(strings.TrimSpace(spec.GetProviderId()), strings.TrimSpace(spec.GetAgentId()), strings.TrimSpace(meta["direct_run_provider_id"]))
	modelIntent := firstNonEmptyString(strings.TrimSpace(spec.GetModel()), strings.TrimSpace(meta["direct_run_model_intent"]), strings.TrimSpace(meta["run_model"]))
	if providerID == "" || modelIntent == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun provider and model intent are required", nil)
	}
	directRunID := generateID("direct_run")
	inputSnapshot, err := buildDirectRunInputSnapshot(task, actorID, providerID, modelIntent, plan, meta)
	if err != nil {
		return nil, err
	}
	return &persistence.DirectRun{
		DirectRunID:       directRunID,
		TaskID:            strings.TrimSpace(task.ID),
		ProviderID:        providerID,
		ModelIntent:       modelIntent,
		InputSnapshotJSON: string(inputSnapshot),
		BudgetRef:         firstNonEmptyString(strings.TrimSpace(meta["budget_ref"]), fmt.Sprintf("task:%s:budget", strings.TrimSpace(task.ID))),
		PolicyRef:         firstNonEmptyString(strings.TrimSpace(meta["policy_ref"]), fmt.Sprintf("task:%s:policy", strings.TrimSpace(task.ID))),
		TraceID:           firstNonEmptyString(strings.TrimSpace(meta["trace_id"]), fmt.Sprintf("trace:%s", directRunID)),
		State:             firstNonEmptyString(strings.TrimSpace(meta["direct_run_state"]), "pending_station_runtime"),
		Source:            collaborationProviderPlanSourceDirectRun,
		CreatedAt:         now,
		UpdatedAt:         now,
	}, nil
}

func directRunLifecycleRecordsFromProviderPlan(task *persistence.CollaborationTask, actorID string, plan *model.TaskProviderPlan, meta map[string]string, now time.Time) (*directRunLifecycleRecords, error) {
	record, err := directRunRecordFromProviderPlan(task, actorID, plan, meta, now)
	if err != nil || record == nil {
		return nil, err
	}
	spec := firstProviderSpec(plan.GetProviders())
	if spec == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun provider spec is required", nil)
	}
	stepAgentID := firstNonEmptyString(strings.TrimSpace(spec.GetAgentId()), record.ProviderID)
	stepID := generateID("direct_run_step")
	taskMetaJSON, err := json.Marshal(map[string]string{
		"direct_run_id":        record.DirectRunID,
		"direct_run_state":     record.State,
		"provider_id":          record.ProviderID,
		"model_intent":         record.ModelIntent,
		"budget_ref":           record.BudgetRef,
		"policy_ref":           record.PolicyRef,
		"trace_id":             record.TraceID,
		"provider_plan_source": record.Source,
		"runtime_kind":         "direct_run_no_session",
	})
	if err != nil {
		return nil, err
	}
	records := &directRunLifecycleRecords{
		Run: record,
		Task: &persistence.TaskRun{
			TaskID:         strings.TrimSpace(task.ID),
			Title:          strings.TrimSpace(task.Title),
			Description:    strings.TrimSpace(task.Description),
			Surface:        int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
			Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
			OwnerActorID:   strings.TrimSpace(actorID),
			WorkspaceID:    strings.TrimSpace(task.WorkspaceID),
			ConversationID: "",
			MetaJSON:       string(taskMetaJSON),
			CreatedAt:      now,
			StartedAt:      now,
			UpdatedAt:      now,
		},
		Step: &persistence.ExecutionStep{
			StepID:            stepID,
			TaskID:            strings.TrimSpace(task.ID),
			AgentID:           stepAgentID,
			Role:              firstNonEmptyString(strings.TrimSpace(spec.GetRole()), "executor"),
			Description:       "Station-owned DirectRun no-session runtime marker",
			Status:            int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
			Attempt:           1,
			EligibleExecutors: model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED.String(),
			StartedAt:         now,
		},
	}
	if err := validateDirectRunRuntimePreflight(records); err != nil {
		return nil, err
	}
	return records, nil
}

func directRunCreatedEventPayload(records *directRunLifecycleRecords) map[string]interface{} {
	if records == nil || records.Run == nil || records.Task == nil || records.Step == nil {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"task_id":            records.Task.TaskID,
		"step_id":            records.Step.StepID,
		"direct_run_id":      records.Run.DirectRunID,
		"surface":            int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
		"surface_name":       model.TaskSurface_TASK_SURFACE_DIRECT_RUN.String(),
		"status":             records.Task.Status,
		"step_status":        records.Step.Status,
		"provider_id":        records.Run.ProviderID,
		"model_intent":       records.Run.ModelIntent,
		"budget_ref":         records.Run.BudgetRef,
		"policy_ref":         records.Run.PolicyRef,
		"trace_id":           records.Run.TraceID,
		"source":             records.Run.Source,
		"runtime_kind":       "direct_run_no_session",
		"runtime_preflight":  "passed",
		"provider_execution": "not_started",
		"eligible_executors": []string{records.Step.EligibleExecutors},
	}
}

func collaborationTaskCreatedEventPayload(task *persistence.CollaborationTask, nodes []persistence.CollaborationTaskNode, providerPlan *model.TaskProviderPlan) map[string]interface{} {
	if task == nil {
		return map[string]interface{}{}
	}
	agentIDs := make([]string, 0, len(nodes))
	nodeIDs := make([]string, 0, len(nodes))
	for _, node := range nodes {
		agentID := strings.TrimSpace(node.AgentID)
		if agentID != "" {
			agentIDs = append(agentIDs, agentID)
		}
		nodeID := strings.TrimSpace(node.ID)
		if nodeID != "" {
			nodeIDs = append(nodeIDs, nodeID)
		}
	}
	payload := map[string]interface{}{
		"task_id":              task.ID,
		"title":                task.Title,
		"description":          task.Description,
		"status":               task.Status,
		"engine_type":          task.EngineType,
		"workspace_id":         task.WorkspaceID,
		"goal_owner_id":        task.GoalOwnerID,
		"node_ids":             nodeIDs,
		"agent_ids":            agentIDs,
		"runtime_kind":         "collaboration",
		"provider_execution":   "not_started",
		"orchestration_source": "create_collaboration_task",
	}
	if providerPlan != nil {
		payload["provider_plan_source"] = strings.TrimSpace(providerPlan.GetSource())
		payload["synthesizer_agent_id"] = strings.TrimSpace(providerPlan.GetSynthesizerAgentId())
	}
	return payload
}

func validateDirectRunRuntimePreflight(records *directRunLifecycleRecords) error {
	if records == nil || records.Run == nil || records.Task == nil || records.Step == nil {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun runtime records are required", nil)
	}
	run := records.Run
	task := records.Task
	step := records.Step
	if strings.TrimSpace(run.DirectRunID) == "" ||
		strings.TrimSpace(run.TaskID) == "" ||
		strings.TrimSpace(run.ProviderID) == "" ||
		strings.TrimSpace(run.ModelIntent) == "" ||
		strings.TrimSpace(run.BudgetRef) == "" ||
		strings.TrimSpace(run.PolicyRef) == "" ||
		strings.TrimSpace(run.TraceID) == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun runtime preflight requires provider, model, budget, policy and trace refs", nil)
	}
	if strings.TrimSpace(run.Source) != collaborationProviderPlanSourceDirectRun {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun runtime preflight requires Station-owned source", nil)
	}
	if strings.TrimSpace(task.TaskID) != strings.TrimSpace(run.TaskID) ||
		strings.TrimSpace(step.TaskID) != strings.TrimSpace(run.TaskID) {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun runtime preflight task references must match", nil)
	}
	if task.Surface != int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN) || strings.TrimSpace(task.ConversationID) != "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun runtime preflight requires no-session TaskRun surface", nil)
	}
	if step.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING) || strings.TrimSpace(step.TurnID) != "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun runtime preflight requires pending step without turn", nil)
	}
	if strings.TrimSpace(step.EligibleExecutors) != model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED.String() {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "DirectRun runtime preflight requires Station-hosted executor", nil)
	}
	return nil
}

func firstProviderSpec(providers []*model.TaskProviderSpec) *model.TaskProviderSpec {
	for _, provider := range providers {
		if provider != nil {
			return provider
		}
	}
	return nil
}

func sameStringList(left []string, right []string) bool {
	left = compactStrings(left)
	right = compactStrings(right)
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func selectSynthesizerAgentID(meta map[string]string, agentIDs []string) string {
	for _, key := range []string{"synthesizer_agent_id", "judge_agent_id", "synthesis_agent_id"} {
		value := strings.TrimSpace(meta[key])
		if value != "" {
			return value
		}
	}
	if len(agentIDs) == 0 {
		return ""
	}
	return agentIDs[0]
}

func parseMetaList(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var values []string
	if strings.HasPrefix(raw, "[") && json.Unmarshal([]byte(raw), &values) == nil {
		return compactStrings(values)
	}
	return compactStrings(strings.Split(raw, ","))
}

func compactStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func mustJSONString(value interface{}) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func roleForIndex(index int) string {
	if index == 0 {
		return "planner"
	}
	return "executor"
}

func taskRecordToProto(record *persistence.CollaborationTask) *model.CollaborationTask {
	if record == nil {
		return nil
	}
	meta := map[string]string{}
	_ = json.Unmarshal([]byte(record.MetaJSON), &meta)
	return &model.CollaborationTask{
		TaskId:       record.ID,
		Title:        record.Title,
		Description:  record.Description,
		EngineType:   model.CollaborationEngineType(record.EngineType),
		Status:       model.CollaborationTaskStatus(record.Status),
		GoalOwnerId:  record.GoalOwnerID,
		WorkspaceId:  record.WorkspaceID,
		BudgetTokens: record.BudgetTokens,
		BudgetMoney:  record.BudgetMoney,
		BudgetTimeMs: record.BudgetTimeMs,
		CreatedAt:    timestamppb.New(record.CreatedAt),
		StartedAt:    timestamppb.New(record.StartedAt),
		EndedAt:      timestamppb.New(record.EndedAt),
		Meta:         meta,
	}
}

func nodeRecordsToProto(records []persistence.CollaborationTaskNode) []*model.TaskNode {
	nodes := make([]*model.TaskNode, 0, len(records))
	for i := range records {
		nodes = append(nodes, nodeRecordToProto(&records[i]))
	}
	return nodes
}

func nodeRecordToProto(record *persistence.CollaborationTaskNode) *model.TaskNode {
	if record == nil {
		return nil
	}
	return &model.TaskNode{
		NodeId:              record.ID,
		TaskId:              record.TaskID,
		ParentNodeId:        record.ParentNodeID,
		AgentId:             record.AgentID,
		Role:                record.Role,
		Description:         record.Description,
		Status:              model.TaskNodeStatus(record.Status),
		PrerequisiteNodeIds: parseMetaList(record.PrerequisiteNodeIDs),
		ResultSummary:       record.ResultSummary,
		StartedAt:           timestamppb.New(record.StartedAt),
		EndedAt:             timestamppb.New(record.EndedAt),
	}
}

func leaseRecordToProto(record *persistence.ExecutorLease) *model.ExecutorLease {
	if record == nil {
		return nil
	}
	return &model.ExecutorLease{
		LeaseId:      record.LeaseID,
		TaskId:       record.TaskID,
		StepId:       record.StepID,
		ExecutorId:   record.ExecutorID,
		ExecutorKind: model.ExecutorKind(record.ExecutorKind),
		Status:       record.Status,
		AcquiredAt:   timestamppb.New(record.AcquiredAt),
		HeartbeatAt:  timestamppb.New(record.HeartbeatAt),
		ExpiresAt:    timestamppb.New(record.ExpiresAt),
	}
}
