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
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

type OrchestrationService struct {
	agentService *AgentService
	turnService  *TurnService
	toolRegistry *ToolRegistryService
	eventBus     domain.EventBus
	eventWriter  *TaskEventWriter
	recoveryOnce sync.Once
}

const collaborationRoleSynthesizer = "synthesizer"

func NewOrchestrationService(agentService *AgentService, turnService *TurnService, toolRegistry *ToolRegistryService) *OrchestrationService {
	return &OrchestrationService{
		agentService: agentService,
		turnService:  turnService,
		toolRegistry: toolRegistry,
	}
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
	agentIDs := parseMetaList(req.GetMeta()["agent_ids"])
	if len(agentIDs) == 0 {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "meta.agent_ids is required", nil)
	}
	if s.agentService == nil || s.turnService == nil {
		return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "orchestration runtime is not configured", nil)
	}

	now := time.Now()
	meta := copyStringMap(req.GetMeta())
	synthesizerAgentID := selectSynthesizerAgentID(meta, agentIDs)
	meta["synthesizer_agent_id"] = synthesizerAgentID
	meta["synthesis_mode"] = "dedicated_node"
	metaJSON, _ := json.Marshal(meta)
	taskRecord := persistence.CollaborationTask{
		ID:           generateID("collab"),
		Title:        title,
		Description:  description,
		EngineType:   int32(normalizeEngineType(req.GetEngineType())),
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

	nodeRecords := make([]persistence.CollaborationTaskNode, 0, len(agentIDs)+1)
	prerequisiteNodeIDs := make([]string, 0, len(agentIDs))
	for index, agentID := range agentIDs {
		nodeID := generateID("node")
		prerequisiteNodeIDs = append(prerequisiteNodeIDs, nodeID)
		nodeRecords = append(nodeRecords, persistence.CollaborationTaskNode{
			ID:          nodeID,
			TaskID:      taskRecord.ID,
			AgentID:     agentID,
			Role:        roleForIndex(index),
			Description: description,
			Status:      int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
			StartedAt:   now.Add(time.Duration(index) * time.Millisecond),
			EndedAt:     now.Add(time.Duration(index) * time.Millisecond),
		})
	}
	nodeRecords = append(nodeRecords, persistence.CollaborationTaskNode{
		ID:                  generateID("node"),
		TaskID:              taskRecord.ID,
		AgentID:             synthesizerAgentID,
		Role:                collaborationRoleSynthesizer,
		Description:         "Synthesize the collaboration node outputs into the final result.",
		Status:              int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
		PrerequisiteNodeIDs: strings.Join(prerequisiteNodeIDs, ","),
		StartedAt:           now.Add(time.Duration(len(agentIDs)) * time.Millisecond),
		EndedAt:             now.Add(time.Duration(len(agentIDs)) * time.Millisecond),
	})

	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&taskRecord).Error; err != nil {
			return err
		}
		return tx.Create(&nodeRecords).Error
	}); err != nil {
		logger.Errorf(ctx, "failed to create collaboration task: actor_id=%s err=%v", actorID, err)
		return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to create collaboration task", err)
	}

	nodes := nodeRecordsToProto(nodeRecords)
	s.publishTaskCreated(ctx, taskRecordToProto(&taskRecord), nodes)
	s.startTaskExecution(actorID, taskRecord, nodeRecords, "create")

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
		var nodes []persistence.CollaborationTaskNode
		if err := db.WithContext(ctx).Where("task_id = ?", task.ID).Order("started_at ASC").Find(&nodes).Error; err != nil {
			logger.Errorf(ctx, "failed to list nodes for collaboration recovery: task_id=%s err=%v", task.ID, err)
			continue
		}
		s.startTaskExecution(task.GoalOwnerID, task, nodes, "recovery")
	}
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
	Summary   string
	Failed    bool
	Cancelled bool
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
		result := s.runCollaborationNode(ctx, db, actorID, task, node, priorResults)
		if result.Cancelled {
			s.skipPendingNodes(ctx, db, task, nodes[index+1:])
			s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskCancelled)
			return task, nodes
		}
		if result.Failed {
			hasFailure = true
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

	var wg sync.WaitGroup
	var mu sync.Mutex
	hasFailure := false
	cancelled := false
	for index := range nodes {
		node := &nodes[index]
		if isSynthesisNode(node) {
			continue
		}
		switch node.Status {
		case int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
			int32(model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED):
			continue
		case int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED):
			hasFailure = true
			continue
		}
		wg.Add(1)
		go func(node *persistence.CollaborationTaskNode) {
			defer wg.Done()
			taskCopy := *task
			result := s.runCollaborationNode(ctx, db, actorID, &taskCopy, node, nil)
			mu.Lock()
			if result.Failed {
				hasFailure = true
			}
			if result.Cancelled {
				cancelled = true
			}
			mu.Unlock()
		}(node)
	}
	wg.Wait()

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

	if err := s.ensureNodeConversation(ctx, db, actorID, task, node, agent); err != nil {
		summary := fmt.Sprintf("failed to create node conversation: %v", err)
		s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary)
		s.publishNodeEvent(ctx, task, node, domain.EventTypeCollaborationNodeFailed, "", summary)
		return collaborationNodeRunResult{Summary: summary, Failed: true}
	}

	turn, err := s.turnService.ExecuteTurn(ctx, s.turnConfigForNode(task, node, agent), collaborationNodePrompt(task, node, priorResults))
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
	s.updateNode(ctx, db, node, model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED, summary)
	s.publishNodeEvent(ctx, task, node, domain.EventTypeCollaborationNodeCompleted, turn.TurnID, summary)
	return collaborationNodeRunResult{Summary: summary}
}

func (s *OrchestrationService) finishExecutedTask(
	ctx context.Context,
	db *gorm.DB,
	actorID string,
	task *persistence.CollaborationTask,
	nodes []persistence.CollaborationTaskNode,
	hasFailure bool,
) (*persistence.CollaborationTask, []persistence.CollaborationTaskNode) {
	if s.isTaskCancelled(ctx, db, task) {
		s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskCancelled)
		return task, nodes
	}
	if s.failTaskIfTimeBudgetExceeded(ctx, db, task, nodes) {
		s.publishTaskFinished(ctx, taskRecordToProto(task), nodeRecordsToProto(nodes), domain.EventTypeCollaborationTaskFailed)
		return task, nodes
	}
	if summary, turnID, failed := s.synthesizeTaskResult(ctx, db, actorID, task, nodes); strings.TrimSpace(summary) != "" {
		s.updateTaskMeta(ctx, db, task, map[string]string{
			"final_summary":           summary,
			"final_synthesis_turn_id": turnID,
		})
	} else if failed {
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
	if err := s.ensureNodeConversation(ctx, db, actorID, task, synthNode, agent); err != nil {
		logger.Warnf(ctx, "failed to ensure synthesis conversation: task_id=%s node_id=%s err=%v", task.ID, synthNode.ID, err)
		if isSynthesisNode(synthNode) {
			summary := fmt.Sprintf("failed to create synthesis conversation: %v", err)
			s.updateNode(ctx, db, synthNode, model.TaskNodeStatus_TASK_NODE_STATUS_FAILED, summary)
			s.publishNodeEvent(ctx, task, synthNode, domain.EventTypeCollaborationNodeFailed, "", summary)
			return "", "", true
		}
		return "", "", false
	}
	turn, err := s.turnService.ExecuteTurn(ctx, s.turnConfigForNode(task, synthNode, agent), collaborationSynthesisPrompt(task, nodes))
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
		if isSynthesisNode(&nodes[index]) && nodes[index].Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED) {
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

func isParallelCollaborationEngine(engine model.CollaborationEngineType) bool {
	switch engine {
	case model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_ROUNDTABLE,
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_SWARM,
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH:
		return true
	default:
		return false
	}
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
) error {
	var existing persistence.Conversation
	if err := db.WithContext(ctx).Where("id = ?", node.ID).First(&existing).Error; err == nil {
		return nil
	} else if err != gorm.ErrRecordNotFound {
		return err
	}

	now := time.Now()
	modelName := strings.TrimSpace(agent.ModelName)
	meta, _ := json.Marshal(map[string]string{
		"source":  "agent_canvas",
		"task_id": task.ID,
		"node_id": node.ID,
		"role":    node.Role,
	})
	conversation := persistence.Conversation{
		ID:          node.ID,
		AgentID:     agent.AgentID,
		UserID:      actorID,
		Title:       task.Title,
		ProviderID:  strings.TrimSpace(agent.ProviderID),
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

func (s *OrchestrationService) turnConfigForNode(task *persistence.CollaborationTask, node *persistence.CollaborationTaskNode, agent *domain.Agent) *TurnConfig {
	agentPrompt, workspaceRoot := agentRuntimeConfig(agent)
	availableTools := []string{}
	if s.toolRegistry != nil {
		availableTools = s.toolRegistry.ToolNames()
	}
	return &TurnConfig{
		AgentID:           agent.AgentID,
		ConversationID:    node.ID,
		Identity:          agent.Name,
		AgentConfigPrompt: agentPrompt,
		Platform:          "agent_canvas",
		AvailableTools:    availableTools,
		ContextWindowSize: 128000,
		MaxRetries:        3,
		Provider:          agent.ProviderID,
		Model:             agent.ModelName,
		Effort:            agent.Effort,
		WorkspaceRoot:     workspaceRoot,
		TaskID:            task.ID,
		StepID:            node.ID,
	}
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

func firstConfigString(config map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value, ok := config[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
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
	return node != nil && strings.EqualFold(strings.TrimSpace(node.Role), collaborationRoleSynthesizer)
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
	s.publishEvent(ctx, node.AgentID, string(eventType), payload, task.ID, node.ID)
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

func taskEventRecordToProto(record *persistence.TaskEvent) *model.TaskEvent {
	if record == nil {
		return nil
	}
	return &model.TaskEvent{
		EventId:     record.ID,
		TaskId:      record.TaskID,
		StepId:      record.StepID,
		TurnId:      record.TurnID,
		EventSeq:    record.EventSeq,
		Type:        model.TaskEventType(record.EventType),
		PayloadJson: record.Payload,
		CreatedAt:   timestamppb.New(record.CreatedAt),
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
	case domain.EventTypeAgentTurnStarted, domain.EventTypeAgentTurnCompleted, domain.EventTypeAgentTurnFailed:
		return model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT
	default:
		return model.TaskEventType_TASK_EVENT_TYPE_UNSPECIFIED
	}
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

func roleForIndex(index int) string {
	if index == 0 {
		return "lead"
	}
	return "collaborator"
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
		nodes = append(nodes, &model.TaskNode{
			NodeId:              records[i].ID,
			TaskId:              records[i].TaskID,
			ParentNodeId:        records[i].ParentNodeID,
			AgentId:             records[i].AgentID,
			Role:                records[i].Role,
			Description:         records[i].Description,
			Status:              model.TaskNodeStatus(records[i].Status),
			PrerequisiteNodeIds: parseMetaList(records[i].PrerequisiteNodeIDs),
			ResultSummary:       records[i].ResultSummary,
			StartedAt:           timestamppb.New(records[i].StartedAt),
			EndedAt:             timestamppb.New(records[i].EndedAt),
		})
	}
	return nodes
}
