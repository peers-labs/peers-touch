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
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const atelierProjectionVersion = "atelier-projection/v0"

type AtelierProjectionService struct {
	orchestrationService *OrchestrationService
}

type LoadAtelierWorkspaceRequest struct {
	SelectedTaskID string `json:"selectedTaskId,omitempty"`
	PageSize       int    `json:"pageSize,omitempty"`
	EventPageSize  int    `json:"eventPageSize,omitempty"`
}

type CreateAtelierProjectFromGoalRequest struct {
	Goal     string                  `json:"goal,omitempty"`
	Project  string                  `json:"project,omitempty"`
	Run      AtelierRunTargetRequest `json:"run,omitempty"`
	AgentIDs []string                `json:"agentIds,omitempty"`
}

type SendAtelierMessageRequest struct {
	TaskID string                  `json:"taskId,omitempty"`
	Text   string                  `json:"text,omitempty"`
	Run    AtelierRunTargetRequest `json:"run,omitempty"`
}

type ResolveAtelierDecisionRequest struct {
	TaskID  string `json:"taskId,omitempty"`
	BlockID string `json:"blockId,omitempty"`
	Choice  string `json:"choice,omitempty"`
}

type SetAtelierTaskStatusRequest struct {
	TaskID string `json:"taskId,omitempty"`
	Status string `json:"status,omitempty"`
}

type PurgeAtelierTaskRequest struct {
	TaskID string `json:"taskId,omitempty"`
}

type AtelierRunTargetRequest struct {
	Kind     string   `json:"kind,omitempty"`
	Model    string   `json:"model,omitempty"`
	FlowID   string   `json:"flowId,omitempty"`
	AgentIDs []string `json:"agentIds,omitempty"`
}

func NewAtelierProjectionService(orchestrationService *OrchestrationService) *AtelierProjectionService {
	return &AtelierProjectionService{orchestrationService: orchestrationService}
}

type AtelierProjectionSnapshot struct {
	Version        string                     `json:"version"`
	Workspace      AtelierWorkspaceProjection `json:"workspace"`
	SelectedTaskID string                     `json:"selectedTaskId"`
}

type AtelierWorkspaceProjection struct {
	BudgetSpent float64                         `json:"budgetSpent"`
	BudgetCap   float64                         `json:"budgetCap"`
	Model       string                          `json:"model"`
	Tasks       []AtelierTaskProjection         `json:"tasks"`
	Streams     map[string][]AtelierBlock       `json:"streams"`
	Todos       map[string][]AtelierTodoItem    `json:"todos"`
	Contexts    map[string]AtelierTaskContext   `json:"contexts"`
	Artifacts   map[string][]AtelierArtifactRef `json:"artifacts"`
	Gates       map[string][]AtelierGateResult  `json:"gates,omitempty"`
}

type AtelierTaskProjection struct {
	ID      string `json:"id"`
	Project string `json:"project"`
	Title   string `json:"title"`
	Status  string `json:"status"`
	Running bool   `json:"running,omitempty"`
	Branch  string `json:"branch,omitempty"`
}

type AtelierBlock struct {
	Kind           string                  `json:"kind"`
	ID             string                  `json:"id"`
	Text           string                  `json:"text,omitempty"`
	At             string                  `json:"at,omitempty"`
	Done           bool                    `json:"done,omitempty"`
	Summary        string                  `json:"summary,omitempty"`
	AgentCount     int                     `json:"agentCount,omitempty"`
	Converged      bool                    `json:"converged,omitempty"`
	Voices         []AtelierNegoVoice      `json:"voices,omitempty"`
	Consensus      string                  `json:"consensus,omitempty"`
	Question       string                  `json:"question,omitempty"`
	SpentSoFar     string                  `json:"spentSoFar,omitempty"`
	Options        []AtelierDecisionOption `json:"options,omitempty"`
	RollbackImpact string                  `json:"rollbackImpact,omitempty"`
	Chosen         string                  `json:"chosen,omitempty"`
	Name           string                  `json:"name,omitempty"`
	FileKind       string                  `json:"fileKind,omitempty"`
	ProducedBy     string                  `json:"producedBy,omitempty"`
	Meta           map[string]interface{}  `json:"meta,omitempty"`
}

type AtelierNegoVoice struct {
	Role        string `json:"role"`
	Stance      string `json:"stance"`
	Text        string `json:"text"`
	EvidenceRef string `json:"evidenceRef,omitempty"`
}

type AtelierDecisionOption struct {
	Text        string `json:"text"`
	Recommended bool   `json:"recommended,omitempty"`
}

type AtelierTodoItem struct {
	ID     string `json:"id"`
	Text   string `json:"text"`
	Status string `json:"status"`
}

type AtelierTaskContext struct {
	UsedPct int                  `json:"usedPct"`
	Files   []AtelierContextFile `json:"files"`
}

type AtelierContextFile struct {
	Name  string `json:"name"`
	Group string `json:"group"`
}

type AtelierArtifactRef struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`
	Meta     string   `json:"meta"`
	Markdown string   `json:"markdown,omitempty"`
	URL      string   `json:"url,omitempty"`
	Paths    []string `json:"paths,omitempty"`
	Src      string   `json:"src,omitempty"`
	Size     string   `json:"size,omitempty"`
}

type AtelierGateResult struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Status      string             `json:"status"`
	Summary     string             `json:"summary"`
	Checks      []AtelierGateCheck `json:"checks"`
	ArtifactIDs []string           `json:"artifactIds,omitempty"`
	At          string             `json:"at,omitempty"`
}

type AtelierGateCheck struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type AtelierProjectionEvent struct {
	ID         string                 `json:"id"`
	Seq        int64                  `json:"seq"`
	TaskID     string                 `json:"taskId,omitempty"`
	Patch      AtelierProjectionPatch `json:"patch"`
	ReceivedAt string                 `json:"receivedAt"`
}

type AtelierProjectionPatch struct {
	Kind     string                     `json:"kind"`
	Snapshot *AtelierProjectionSnapshot `json:"snapshot,omitempty"`
	Task     *AtelierTaskProjection     `json:"task,omitempty"`
	Select   bool                       `json:"select,omitempty"`
	TaskID   string                     `json:"taskId,omitempty"`
	BlockID  string                     `json:"blockId,omitempty"`
	Choice   string                     `json:"choice,omitempty"`
	Blocks   []AtelierBlock             `json:"blocks,omitempty"`
	Status   string                     `json:"status,omitempty"`
	Artifact *AtelierArtifactRef        `json:"artifact,omitempty"`
	Gate     *AtelierGateResult         `json:"gate,omitempty"`
}

func (s *AtelierProjectionService) LoadWorkspace(
	ctx context.Context,
	actorID string,
	req *LoadAtelierWorkspaceRequest,
) (*AtelierProjectionSnapshot, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_id is required", nil)
	}
	if req == nil {
		req = &LoadAtelierWorkspaceRequest{}
	}
	pageSize := req.PageSize
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 50
	}
	eventPageSize := req.EventPageSize
	if eventPageSize <= 0 || eventPageSize > 200 {
		eventPageSize = 100
	}

	var taskRecords []persistence.CollaborationTask
	if err := db.WithContext(ctx).
		Where("goal_owner_id = ?", actorID).
		Order("created_at DESC").
		Limit(pageSize).
		Find(&taskRecords).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier tasks", err)
	}

	taskIDs := make([]string, 0, len(taskRecords))
	tasks := make([]*model.CollaborationTask, 0, len(taskRecords))
	for i := range taskRecords {
		taskIDs = append(taskIDs, taskRecords[i].ID)
		tasks = append(tasks, taskRecordToProto(&taskRecords[i]))
	}

	nodesByTask, err := loadAtelierNodesByTask(ctx, db, taskIDs)
	if err != nil {
		return nil, err
	}
	eventsByTask, err := loadAtelierEventsByTask(ctx, db, taskIDs, eventPageSize)
	if err != nil {
		return nil, err
	}

	snapshot := BuildAtelierProjectionSnapshot(tasks, nodesByTask, eventsByTask, req.SelectedTaskID)
	return &snapshot, nil
}

func (s *AtelierProjectionService) CreateProjectFromGoal(
	ctx context.Context,
	actorID string,
	req *CreateAtelierProjectFromGoalRequest,
) (*AtelierProjectionSnapshot, error) {
	if s.orchestrationService == nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "orchestration service is not configured", nil)
	}
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_id is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	goal := strings.TrimSpace(req.Goal)
	if goal == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "goal is required", nil)
	}
	agentIDs := compactStrings(append(req.AgentIDs, req.Run.AgentIDs...))
	if len(agentIDs) == 0 {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "agentIds is required for Atelier project creation", nil)
	}
	project := atelierFirstNonEmpty(req.Project, "peers-touch")
	meta := map[string]string{
		"agent_ids":         mustJSON(agentIDs),
		"atelier_status":    "active",
		"project":           project,
		"source":            "atelier.project.createFromGoal",
		"run_kind":          strings.TrimSpace(req.Run.Kind),
		"run_model":         strings.TrimSpace(req.Run.Model),
		"run_flow_id":       strings.TrimSpace(req.Run.FlowID),
		"desktop_agent_ids": mustJSON(agentIDs),
	}
	task, _, err := s.orchestrationService.CreateCollaborationTask(ctx, actorID, &model.CreateCollaborationTaskRequest{
		Title:       goal,
		Description: goal,
		EngineType:  model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH,
		WorkspaceId: &project,
		Meta:        meta,
	})
	if err != nil {
		return nil, err
	}
	return s.LoadWorkspace(ctx, actorID, &LoadAtelierWorkspaceRequest{SelectedTaskID: task.GetTaskId()})
}

func (s *AtelierProjectionService) SendMessage(
	ctx context.Context,
	actorID string,
	req *SendAtelierMessageRequest,
) (*AtelierProjectionSnapshot, error) {
	if s.orchestrationService == nil || s.orchestrationService.eventWriter == nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "orchestration event writer is not configured", nil)
	}
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_id is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "taskId is required", nil)
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "text is required", nil)
	}

	task, err := loadOwnedAtelierTask(ctx, actorID, taskID)
	if err != nil {
		return nil, err
	}
	agentID := atelierFirstNonEmpty(firstAgentID(taskRecordToProto(task).GetMeta()), actorID)
	payload := map[string]interface{}{
		"source":         "atelier.message.send",
		"block_kind":     "user",
		"text":           text,
		"result_summary": text,
		"task_id":        taskID,
		"actor_id":       actorID,
		"run_kind":       strings.TrimSpace(req.Run.Kind),
		"run_model":      strings.TrimSpace(req.Run.Model),
		"run_flow_id":    strings.TrimSpace(req.Run.FlowID),
	}
	s.orchestrationService.eventWriter.Publish(
		ctx,
		agentID,
		string(domain.EventTypeAgentTurnCompleted),
		payload,
		taskID,
		"",
		"",
		map[string]string{"atelier_source": "message.send"},
	)
	return s.LoadWorkspace(ctx, actorID, &LoadAtelierWorkspaceRequest{SelectedTaskID: taskID})
}

func (s *AtelierProjectionService) ResolveDecision(
	ctx context.Context,
	actorID string,
	req *ResolveAtelierDecisionRequest,
) (*AtelierProjectionSnapshot, error) {
	if s.orchestrationService == nil || s.orchestrationService.eventWriter == nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "orchestration event writer is not configured", nil)
	}
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_id is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "taskId is required", nil)
	}
	blockID := strings.TrimSpace(req.BlockID)
	if blockID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "blockId is required", nil)
	}
	choice := strings.TrimSpace(req.Choice)
	if choice == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "choice is required", nil)
	}
	task, err := loadOwnedAtelierTask(ctx, actorID, taskID)
	if err != nil {
		return nil, err
	}
	agentID := atelierFirstNonEmpty(firstAgentID(taskRecordToProto(task).GetMeta()), actorID)
	payload := map[string]interface{}{
		"source":      "atelier.escalation.resolve",
		"block_kind":  "decision_resolved",
		"block_id":    blockID,
		"choice":      choice,
		"task_id":     taskID,
		"actor_id":    actorID,
		"description": fmt.Sprintf("用户选择：%s", choice),
	}
	s.orchestrationService.eventWriter.Publish(
		ctx,
		agentID,
		string(domain.EventTypeAgentTurnCompleted),
		payload,
		taskID,
		"",
		"",
		map[string]string{"atelier_source": "escalation.resolve"},
	)
	return s.LoadWorkspace(ctx, actorID, &LoadAtelierWorkspaceRequest{SelectedTaskID: taskID})
}

func (s *AtelierProjectionService) SetTaskStatus(
	ctx context.Context,
	actorID string,
	req *SetAtelierTaskStatusRequest,
) (*AtelierProjectionSnapshot, error) {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_id is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "taskId is required", nil)
	}
	status := normalizeAtelierTaskStatus(req.Status)
	if status != strings.TrimSpace(req.Status) {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "status must be active, archived, or deleted", nil)
	}
	task, err := loadOwnedAtelierTask(ctx, actorID, taskID)
	if err != nil {
		return nil, err
	}
	meta := decodeStringMap(task.MetaJSON)
	meta["atelier_status"] = status
	nextMeta, _ := json.Marshal(meta)

	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	if err := db.WithContext(ctx).
		Model(&persistence.CollaborationTask{}).
		Where("id = ? AND goal_owner_id = ?", taskID, actorID).
		Update("meta_json", string(nextMeta)).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to update Atelier task status", err)
	}
	return s.LoadWorkspace(ctx, actorID, &LoadAtelierWorkspaceRequest{SelectedTaskID: taskID})
}

func (s *AtelierProjectionService) PurgeTask(
	ctx context.Context,
	actorID string,
	req *PurgeAtelierTaskRequest,
) (*AtelierProjectionSnapshot, error) {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_id is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "taskId is required", nil)
	}
	task, err := loadOwnedAtelierTask(ctx, actorID, taskID)
	if err != nil {
		return nil, err
	}
	if normalizeAtelierTaskStatus(decodeStringMap(task.MetaJSON)["atelier_status"]) != "deleted" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task must be deleted before purge", nil)
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("task_id = ?", taskID).Delete(&persistence.TaskEvent{}).Error; err != nil {
			return err
		}
		if err := tx.Where("task_id = ?", taskID).Delete(&persistence.CollaborationTaskNode{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND goal_owner_id = ?", taskID, actorID).Delete(&persistence.CollaborationTask{}).Error
	}); err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to purge Atelier task", err)
	}
	return s.LoadWorkspace(ctx, actorID, &LoadAtelierWorkspaceRequest{})
}

func BuildAtelierProjectionSnapshot(
	tasks []*model.CollaborationTask,
	nodesByTask map[string][]*model.TaskNode,
	eventsByTask map[string][]*model.TaskEvent,
	selectedTaskID string,
) AtelierProjectionSnapshot {
	workspace := AtelierWorkspaceProjection{
		Model:     "openrouter-3o",
		Tasks:     make([]AtelierTaskProjection, 0, len(tasks)),
		Streams:   map[string][]AtelierBlock{},
		Todos:     map[string][]AtelierTodoItem{},
		Contexts:  map[string]AtelierTaskContext{},
		Artifacts: map[string][]AtelierArtifactRef{},
		Gates:     map[string][]AtelierGateResult{},
	}

	for _, task := range tasks {
		if task == nil {
			continue
		}
		projectedTask := projectCollaborationTask(task)
		workspace.Tasks = append(workspace.Tasks, projectedTask)
		workspace.BudgetCap += task.GetBudgetMoney()

		taskID := task.GetTaskId()
		nodes := nodesByTask[taskID]
		workspace.Todos[taskID] = projectTaskNodesToTodos(nodes)
		workspace.Contexts[taskID] = AtelierTaskContext{UsedPct: estimateContextUse(nodes, eventsByTask[taskID]), Files: []AtelierContextFile{}}
		workspace.Artifacts[taskID] = projectTaskEventsToArtifacts(eventsByTask[taskID])
		workspace.Gates[taskID] = projectTaskEventsToGates(eventsByTask[taskID])
		workspace.Streams[taskID] = buildTaskStream(task, nodes, eventsByTask[taskID])
	}

	if strings.TrimSpace(selectedTaskID) == "" && len(workspace.Tasks) > 0 {
		selectedTaskID = workspace.Tasks[0].ID
	}

	return AtelierProjectionSnapshot{
		Version:        atelierProjectionVersion,
		Workspace:      workspace,
		SelectedTaskID: selectedTaskID,
	}
}

func BuildAtelierProjectionEvent(event *model.TaskEvent) (AtelierProjectionEvent, bool) {
	if event == nil {
		return AtelierProjectionEvent{}, false
	}
	payload := decodePayload(event.GetPayloadJson())
	if artifact, ok := projectTaskEventToArtifact(event); ok {
		return AtelierProjectionEvent{
			ID:     event.GetEventId(),
			Seq:    event.GetEventSeq(),
			TaskID: event.GetTaskId(),
			Patch: AtelierProjectionPatch{
				Kind:     "artifact.upsert",
				TaskID:   event.GetTaskId(),
				Artifact: &artifact,
			},
			ReceivedAt: timestampRFC3339(event.GetCreatedAt()),
		}, true
	}
	if gate, ok := projectTaskEventToGate(event); ok {
		return AtelierProjectionEvent{
			ID:     event.GetEventId(),
			Seq:    event.GetEventSeq(),
			TaskID: event.GetTaskId(),
			Patch: AtelierProjectionPatch{
				Kind:   "gate.upsert",
				TaskID: event.GetTaskId(),
				Gate:   &gate,
			},
			ReceivedAt: timestampRFC3339(event.GetCreatedAt()),
		}, true
	}
	if atelierStringValue(payload, "block_kind") == "decision_resolved" {
		blockID := atelierFirstNonEmpty(atelierStringValue(payload, "block_id"), atelierStringValue(payload, "blockId"))
		choice := atelierStringValue(payload, "choice")
		if blockID == "" || choice == "" {
			return AtelierProjectionEvent{}, false
		}
		return AtelierProjectionEvent{
			ID:     event.GetEventId(),
			Seq:    event.GetEventSeq(),
			TaskID: event.GetTaskId(),
			Patch: AtelierProjectionPatch{
				Kind:    "decision.resolved",
				TaskID:  event.GetTaskId(),
				BlockID: blockID,
				Choice:  choice,
			},
			ReceivedAt: timestampRFC3339(event.GetCreatedAt()),
		}, true
	}
	block := projectTaskEventToBlock(event)
	if block.ID == "" {
		return AtelierProjectionEvent{}, false
	}
	return AtelierProjectionEvent{
		ID:     event.GetEventId(),
		Seq:    event.GetEventSeq(),
		TaskID: event.GetTaskId(),
		Patch: AtelierProjectionPatch{
			Kind:   "stream.append",
			TaskID: event.GetTaskId(),
			Blocks: []AtelierBlock{block},
		},
		ReceivedAt: timestampRFC3339(event.GetCreatedAt()),
	}, true
}

func loadAtelierNodesByTask(ctx context.Context, db *gorm.DB, taskIDs []string) (map[string][]*model.TaskNode, error) {
	result := map[string][]*model.TaskNode{}
	if len(taskIDs) == 0 {
		return result, nil
	}
	var records []persistence.CollaborationTaskNode
	if err := db.WithContext(ctx).
		Where("task_id IN ?", taskIDs).
		Order("started_at ASC").
		Find(&records).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier task nodes", err)
	}
	for i := range records {
		node := &model.TaskNode{
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
		}
		result[node.GetTaskId()] = append(result[node.GetTaskId()], node)
	}
	return result, nil
}

func loadOwnedAtelierTask(ctx context.Context, actorID, taskID string) (*persistence.CollaborationTask, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	var task persistence.CollaborationTask
	if err := db.WithContext(ctx).
		Where("id = ? AND goal_owner_id = ?", taskID, actorID).
		First(&task).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "Atelier task not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get Atelier task", err)
	}
	return &task, nil
}

func loadAtelierEventsByTask(ctx context.Context, db *gorm.DB, taskIDs []string, perTaskLimit int) (map[string][]*model.TaskEvent, error) {
	result := map[string][]*model.TaskEvent{}
	if len(taskIDs) == 0 {
		return result, nil
	}
	for _, taskID := range taskIDs {
		var records []persistence.TaskEvent
		if err := db.WithContext(ctx).
			Where("task_id = ?", taskID).
			Order("event_seq ASC").
			Limit(perTaskLimit).
			Find(&records).Error; err != nil {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier task events", err)
		}
		events := make([]*model.TaskEvent, 0, len(records))
		for i := range records {
			events = append(events, taskEventRecordToProto(&records[i]))
		}
		result[taskID] = events
	}
	return result, nil
}

func projectCollaborationTask(task *model.CollaborationTask) AtelierTaskProjection {
	meta := task.GetMeta()
	return AtelierTaskProjection{
		ID:      task.GetTaskId(),
		Project: atelierFirstNonEmpty(meta["project"], task.GetWorkspaceId(), "peers-touch"),
		Title:   atelierFirstNonEmpty(task.GetTitle(), "Untitled task"),
		Status:  normalizeAtelierTaskStatus(meta["atelier_status"]),
		Running: isCollaborationTaskRunning(task.GetStatus()),
		Branch:  meta["branch"],
	}
}

func buildTaskStream(task *model.CollaborationTask, nodes []*model.TaskNode, events []*model.TaskEvent) []AtelierBlock {
	blocks := []AtelierBlock{
		{
			Kind: "agent",
			ID:   fmt.Sprintf("%s-summary", task.GetTaskId()),
			Text: atelierFirstNonEmpty(task.GetDescription(), task.GetTitle()),
			At:   timestampHHMM(task.GetCreatedAt()),
			Done: !isCollaborationTaskRunning(task.GetStatus()),
		},
	}

	if len(nodes) > 0 {
		blocks = append(blocks, projectNodesToNegotiationBlock(task, nodes))
	}
	for _, event := range events {
		if applyDecisionResolvedEvent(blocks, event) {
			continue
		}
		block := projectTaskEventToBlock(event)
		if block.ID != "" {
			blocks = append(blocks, block)
		}
	}
	return blocks
}

func projectNodesToNegotiationBlock(task *model.CollaborationTask, nodes []*model.TaskNode) AtelierBlock {
	voices := make([]AtelierNegoVoice, 0, len(nodes))
	completed := 0
	for _, node := range nodes {
		if node == nil {
			continue
		}
		if node.GetStatus() == model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED {
			completed++
		}
		voices = append(voices, AtelierNegoVoice{
			Role:   atelierFirstNonEmpty(node.GetRole(), "Executor"),
			Stance: stanceForNode(node.GetStatus()),
			Text:   atelierFirstNonEmpty(node.GetResultSummary(), node.GetDescription(), "等待执行"),
		})
	}
	return AtelierBlock{
		Kind:       "nego",
		ID:         fmt.Sprintf("%s-negotiation", task.GetTaskId()),
		Summary:    fmt.Sprintf("%d 个 Agent 节点已进入协作编排", len(voices)),
		AgentCount: len(voices),
		Converged:  completed == len(voices) && len(voices) > 0,
		Voices:     voices,
		Consensus:  consensusForNodes(completed, len(voices)),
	}
}

func projectTaskNodesToTodos(nodes []*model.TaskNode) []AtelierTodoItem {
	todos := make([]AtelierTodoItem, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}
		todos = append(todos, AtelierTodoItem{
			ID:     node.GetNodeId(),
			Text:   atelierFirstNonEmpty(node.GetDescription(), node.GetRole(), node.GetAgentId()),
			Status: todoStatusForNode(node.GetStatus()),
		})
	}
	return todos
}

func projectTaskEventsToArtifacts(events []*model.TaskEvent) []AtelierArtifactRef {
	artifacts := []AtelierArtifactRef{}
	for _, event := range events {
		artifact, ok := projectTaskEventToArtifact(event)
		if ok {
			artifacts = upsertAtelierArtifact(artifacts, artifact)
		}
	}
	return artifacts
}

func projectTaskEventsToGates(events []*model.TaskEvent) []AtelierGateResult {
	gates := []AtelierGateResult{}
	for _, event := range events {
		gate, ok := projectTaskEventToGate(event)
		if ok {
			gates = upsertAtelierGate(gates, gate)
		}
	}
	return gates
}

func projectTaskEventToBlock(event *model.TaskEvent) AtelierBlock {
	if event == nil {
		return AtelierBlock{}
	}
	payload := decodePayload(event.GetPayloadJson())
	blockKind := atelierStringValue(payload, "block_kind")
	if blockKind == "decision_resolved" || blockKind == "gate_result" {
		return AtelierBlock{}
	}
	if artifact, ok := projectTaskEventToArtifact(event); ok {
		return AtelierBlock{
			Kind:       "artifact",
			ID:         event.GetEventId(),
			Name:       artifact.Name,
			FileKind:   artifactBlockFileKind(artifact.Kind),
			ProducedBy: atelierFirstNonEmpty(atelierStringValue(payload, "produced_by"), atelierStringValue(payload, "role"), "Agent"),
			Meta:       payload,
		}
	}
	if stringValue := atelierStringValue(payload, "block_kind"); stringValue == "user" {
		return AtelierBlock{
			Kind: "user",
			ID:   event.GetEventId(),
			Text: atelierFirstNonEmpty(atelierStringValue(payload, "text"), eventText(event.GetType(), payload)),
			At:   timestampHHMM(event.GetCreatedAt()),
			Meta: payload,
		}
	}
	return AtelierBlock{
		Kind: "agent",
		ID:   event.GetEventId(),
		Text: eventText(event.GetType(), payload),
		At:   timestampHHMM(event.GetCreatedAt()),
		Done: event.GetType() != model.TaskEventType_TASK_EVENT_TYPE_STEP_STARTED,
		Meta: payload,
	}
}

func projectTaskEventToArtifact(event *model.TaskEvent) (AtelierArtifactRef, bool) {
	if event == nil {
		return AtelierArtifactRef{}, false
	}
	payload := decodePayload(event.GetPayloadJson())
	if atelierStringValue(payload, "block_kind") != "artifact" {
		return AtelierArtifactRef{}, false
	}
	id := atelierFirstNonEmpty(atelierStringValue(payload, "artifact_id"), atelierStringValue(payload, "artifactId"), event.GetEventId())
	name := atelierFirstNonEmpty(atelierStringValue(payload, "name"), atelierStringValue(payload, "title"), "artifact")
	kind := normalizeAtelierArtifactKind(atelierFirstNonEmpty(atelierStringValue(payload, "kind"), atelierStringValue(payload, "file_kind"), atelierStringValue(payload, "fileKind")))
	return AtelierArtifactRef{
		ID:       id,
		Name:     name,
		Kind:     kind,
		Meta:     atelierFirstNonEmpty(atelierStringValue(payload, "meta"), atelierStringValue(payload, "produced_by"), "Artifact"),
		Markdown: atelierStringValue(payload, "markdown"),
		URL:      atelierStringValue(payload, "url"),
		Paths:    atelierStringList(payload, "paths"),
		Src:      atelierStringValue(payload, "src"),
		Size:     atelierStringValue(payload, "size"),
	}, true
}

func projectTaskEventToGate(event *model.TaskEvent) (AtelierGateResult, bool) {
	if event == nil {
		return AtelierGateResult{}, false
	}
	payload := decodePayload(event.GetPayloadJson())
	if atelierStringValue(payload, "block_kind") != "gate_result" {
		return AtelierGateResult{}, false
	}
	id := atelierFirstNonEmpty(atelierStringValue(payload, "gate_id"), atelierStringValue(payload, "gateId"), event.GetEventId())
	return AtelierGateResult{
		ID:          id,
		Name:        atelierFirstNonEmpty(atelierStringValue(payload, "name"), "Gate"),
		Status:      normalizeAtelierGateStatus(atelierStringValue(payload, "status")),
		Summary:     atelierFirstNonEmpty(atelierStringValue(payload, "summary"), atelierStringValue(payload, "result_summary"), "Gate result updated"),
		Checks:      atelierGateChecks(payload),
		ArtifactIDs: atelierStringList(payload, "artifact_ids", "artifactIds"),
		At:          timestampHHMM(event.GetCreatedAt()),
	}, true
}

func applyDecisionResolvedEvent(blocks []AtelierBlock, event *model.TaskEvent) bool {
	payload := decodePayload(event.GetPayloadJson())
	if atelierStringValue(payload, "block_kind") != "decision_resolved" {
		return false
	}
	blockID := atelierFirstNonEmpty(atelierStringValue(payload, "block_id"), atelierStringValue(payload, "blockId"))
	choice := atelierStringValue(payload, "choice")
	if blockID == "" || choice == "" {
		return true
	}
	for i := range blocks {
		if blocks[i].Kind == "decision" && blocks[i].ID == blockID {
			blocks[i].Chosen = choice
		}
	}
	return true
}

func eventText(eventType model.TaskEventType, payload map[string]interface{}) string {
	role := atelierStringValue(payload, "role")
	summary := atelierFirstNonEmpty(atelierStringValue(payload, "result_summary"), atelierStringValue(payload, "title"))
	switch eventType {
	case model.TaskEventType_TASK_EVENT_TYPE_TASK_CREATED:
		return atelierFirstNonEmpty(summary, "已创建协作任务")
	case model.TaskEventType_TASK_EVENT_TYPE_STEP_STARTED:
		return fmt.Sprintf("%s 开始执行", atelierFirstNonEmpty(role, "Agent"))
	case model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED:
		return atelierFirstNonEmpty(summary, fmt.Sprintf("%s 已完成执行", atelierFirstNonEmpty(role, "Agent")))
	case model.TaskEventType_TASK_EVENT_TYPE_STEP_FAILED:
		return atelierFirstNonEmpty(summary, fmt.Sprintf("%s 执行失败", atelierFirstNonEmpty(role, "Agent")))
	case model.TaskEventType_TASK_EVENT_TYPE_TASK_STATUS_CHANGED:
		return atelierFirstNonEmpty(summary, "协作任务状态已更新")
	default:
		return atelierFirstNonEmpty(summary, "收到协作编排事件")
	}
}

func decodePayload(raw string) map[string]interface{} {
	payload := map[string]interface{}{}
	if strings.TrimSpace(raw) == "" {
		return payload
	}
	_ = json.Unmarshal([]byte(raw), &payload)
	return payload
}

func estimateContextUse(nodes []*model.TaskNode, events []*model.TaskEvent) int {
	estimate := len(nodes)*6 + len(events)*3
	if estimate < 0 {
		return 0
	}
	if estimate > 95 {
		return 95
	}
	return estimate
}

func normalizeAtelierTaskStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "archived", "deleted":
		return strings.TrimSpace(status)
	default:
		return "active"
	}
}

func isCollaborationTaskRunning(status model.CollaborationTaskStatus) bool {
	return status == model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING ||
		status == model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING
}

func todoStatusForNode(status model.TaskNodeStatus) string {
	switch status {
	case model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED:
		return "done"
	case model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING:
		return "running"
	default:
		return "todo"
	}
}

func normalizeAtelierArtifactKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case "web", "image", "diff":
		return strings.TrimSpace(kind)
	default:
		return "markdown"
	}
}

func artifactBlockFileKind(kind string) string {
	switch normalizeAtelierArtifactKind(kind) {
	case "diff":
		return "diff"
	case "markdown":
		return "report"
	default:
		return "data"
	}
}

func normalizeAtelierGateStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "running", "passed", "failed", "blocked":
		return strings.TrimSpace(status)
	default:
		return "pending"
	}
}

func normalizeAtelierGateCheckStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "passed", "failed":
		return strings.TrimSpace(status)
	default:
		return "pending"
	}
}

func atelierGateChecks(payload map[string]interface{}) []AtelierGateCheck {
	value, ok := payload["checks"]
	if !ok {
		summary := atelierFirstNonEmpty(atelierStringValue(payload, "summary"), atelierStringValue(payload, "result_summary"))
		if summary == "" {
			return []AtelierGateCheck{}
		}
		return []AtelierGateCheck{{Name: "summary", Status: normalizeAtelierGateCheckStatus(atelierStringValue(payload, "status")), Detail: summary}}
	}
	items, ok := value.([]interface{})
	if !ok {
		return []AtelierGateCheck{}
	}
	checks := make([]AtelierGateCheck, 0, len(items))
	for _, item := range items {
		raw, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		name := atelierFirstNonEmpty(atelierStringValue(raw, "name"), "check")
		checks = append(checks, AtelierGateCheck{
			Name:   name,
			Status: normalizeAtelierGateCheckStatus(atelierStringValue(raw, "status")),
			Detail: atelierStringValue(raw, "detail"),
		})
	}
	return checks
}

func upsertAtelierArtifact(current []AtelierArtifactRef, incoming AtelierArtifactRef) []AtelierArtifactRef {
	for i := range current {
		if current[i].ID == incoming.ID {
			current[i] = incoming
			return current
		}
	}
	return append(current, incoming)
}

func upsertAtelierGate(current []AtelierGateResult, incoming AtelierGateResult) []AtelierGateResult {
	for i := range current {
		if current[i].ID == incoming.ID {
			current[i] = incoming
			return current
		}
	}
	return append(current, incoming)
}

func stanceForNode(status model.TaskNodeStatus) string {
	switch status {
	case model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED:
		return "signoff"
	case model.TaskNodeStatus_TASK_NODE_STATUS_FAILED:
		return "objection"
	case model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING:
		return "proposal"
	default:
		return "counter"
	}
}

func consensusForNodes(completed, total int) string {
	if total == 0 {
		return ""
	}
	if completed == total {
		return "全部协作节点已完成，等待 Gate / Artifact 投影。"
	}
	return fmt.Sprintf("%d/%d 个协作节点已完成，仍在等待后续 projection event。", completed, total)
}

func atelierFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func atelierStringValue(payload map[string]interface{}, key string) string {
	if payload == nil {
		return ""
	}
	value, ok := payload[key]
	if !ok {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprint(typed)
	}
}

func atelierStringList(payload map[string]interface{}, keys ...string) []string {
	if payload == nil {
		return nil
	}
	for _, key := range keys {
		value, ok := payload[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case []string:
			return atelierCompactStrings(typed)
		case []interface{}:
			values := make([]string, 0, len(typed))
			for _, item := range typed {
				values = append(values, atelierFirstNonEmpty(fmt.Sprint(item)))
			}
			return atelierCompactStrings(values)
		case string:
			if strings.TrimSpace(typed) == "" {
				return nil
			}
			return atelierCompactStrings(strings.Split(typed, ","))
		default:
			if strings.TrimSpace(fmt.Sprint(typed)) == "" {
				return nil
			}
			return []string{strings.TrimSpace(fmt.Sprint(typed))}
		}
	}
	return nil
}

func atelierCompactStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, strings.TrimSpace(value))
		}
	}
	return result
}

func mustJSON(value interface{}) string {
	data, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(data)
}

func decodeStringMap(raw string) map[string]string {
	result := map[string]string{}
	if strings.TrimSpace(raw) == "" {
		return result
	}
	_ = json.Unmarshal([]byte(raw), &result)
	return result
}

func firstAgentID(meta map[string]string) string {
	if meta == nil {
		return ""
	}
	for _, key := range []string{"agent_ids", "desktop_agent_ids"} {
		var ids []string
		if err := json.Unmarshal([]byte(meta[key]), &ids); err == nil {
			for _, id := range ids {
				if strings.TrimSpace(id) != "" {
					return strings.TrimSpace(id)
				}
			}
		}
	}
	return ""
}

func timestampHHMM(ts *timestamppb.Timestamp) string {
	if ts == nil || !ts.IsValid() {
		return ""
	}
	return ts.AsTime().Format("15:04")
}

func timestampRFC3339(ts *timestamppb.Timestamp) string {
	if ts == nil || !ts.IsValid() {
		return time.Now().UTC().Format(time.RFC3339)
	}
	return ts.AsTime().UTC().Format(time.RFC3339)
}
