package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// AgentTaskHandlers keeps legacy read and mutation endpoints available for
// migrated rows while routing every new work command to canonical TaskRun
// execution state.
type AgentTaskHandlers struct {
	svc    *service.AgentTaskService
	writer *service.TaskRunCommandService
}

func NewAgentTaskHandlers(
	svc *service.AgentTaskService,
	writer *service.TaskRunCommandService,
) *AgentTaskHandlers {
	return &AgentTaskHandlers{svc: svc, writer: writer}
}

// taskToJSON serializes a persisted task, decoding the subtasks JSON column so
// the client receives a structured array instead of an embedded string.
func taskToJSON(t *persistence.AgentTask) map[string]any {
	var subtasks []map[string]any
	if t.SubtasksJSON != "" {
		_ = json.Unmarshal([]byte(t.SubtasksJSON), &subtasks)
	}
	if subtasks == nil {
		subtasks = []map[string]any{}
	}
	item := map[string]any{
		"id":          t.ID,
		"title":       t.Title,
		"description": t.Description,
		"agent_id":    t.AgentID,
		"status":      t.Status,
		"priority":    t.Priority,
		"progress":    t.Progress,
		"subtasks":    subtasks,
		"topic_key":   t.TopicKey,
		"result":      t.Result,
		"error":       t.Error,
		"created_at":  t.CreatedAt,
		"updated_at":  t.UpdatedAt,
	}
	if t.CompletedAt != nil {
		item["completed_at"] = *t.CompletedAt
	}
	return item
}

func (h *AgentTaskHandlers) HandleCreateTask(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		AgentID     string `json:"agent_id"`
		Priority    string `json:"priority"`
		TopicKey    string `json:"topic_key"`
		Idempotency string `json:"client_idempotency_key"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.Title == "" || input.AgentID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "title and agent_id are required"})
		return nil
	}
	if h.writer == nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": "TaskRun writer is unavailable"})
		return nil
	}
	idempotencyKey := strings.TrimSpace(input.Idempotency)
	if idempotencyKey == "" && strings.TrimSpace(input.TopicKey) != "" {
		idempotencyKey = "chat-promotion:" + strings.TrimSpace(input.TopicKey)
	}
	if idempotencyKey == "" {
		idempotencyKey = "task-create:" + uuid.NewString()
	}
	entrypoint := "task_page"
	if strings.TrimSpace(input.TopicKey) != "" {
		entrypoint = "chat_promotion"
	}
	priority := strings.TrimSpace(input.Priority)
	if priority == "" {
		priority = "medium"
	}
	payloadHash := canonicalTaskCommandHash(
		input.Title,
		input.Description,
		input.AgentID,
		priority,
		input.TopicKey,
	)
	result, err := h.writer.Create(ctx, subjectActorID(ctx), &model.CreateTaskRunRequest{
		Title:                input.Title,
		Description:          input.Description,
		AgentId:              input.AgentID,
		Surface:              model.TaskSurface_TASK_SURFACE_API,
		InitialStatus:        model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING,
		ClientIdempotencyKey: idempotencyKey,
		CommandPayloadHash:   payloadHash,
		SourceRef:            input.TopicKey,
		Meta: map[string]string{
			"entrypoint": entrypoint,
			"priority":   priority,
		},
	})
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	if result.GetTask() == nil || result.GetRootStep() == nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": "TaskRun writer returned incomplete identity"})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{
		"ok":      true,
		"task":    taskRunCommandToJSON(result),
		"created": result.GetCreated(),
	})
	return nil
}

func canonicalTaskCommandHash(values ...string) string {
	normalized := make([]string, len(values))
	for index := range values {
		normalized[index] = strings.TrimSpace(values[index])
	}
	sum := sha256.Sum256([]byte(strings.Join(normalized, "\x00")))
	return hex.EncodeToString(sum[:])
}

func taskRunCommandToJSON(result *model.CreateTaskRunResponse) map[string]any {
	if result == nil || result.GetTask() == nil || result.GetRootStep() == nil {
		return map[string]any{}
	}
	task := result.GetTask()
	step := result.GetRootStep()
	status := "pending"
	progress := 0
	switch task.GetStatus() {
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING:
		status = "running"
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED:
		status = "paused"
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED:
		status = "completed"
		progress = 100
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED:
		status = "failed"
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED:
		status = "cancelled"
	}
	item := map[string]any{
		"id":          task.GetTaskId(),
		"title":       task.GetTitle(),
		"description": task.GetDescription(),
		"agent_id":    step.GetAgentId(),
		"status":      status,
		"priority":    firstTaskMeta(task.GetMeta(), "priority", "medium"),
		"progress":    progress,
		"subtasks":    []map[string]any{},
		"topic_key":   firstTaskMeta(task.GetMeta(), "source_ref", ""),
		"result":      step.GetResultSummary(),
		"error":       "",
		"created_at":  task.GetCreatedAt().AsTime(),
		"updated_at":  task.GetUpdatedAt().AsTime(),
	}
	if task.GetEndedAt() != nil {
		item["completed_at"] = task.GetEndedAt().AsTime()
	}
	return item
}

func firstTaskMeta(meta map[string]string, key string, fallback string) string {
	if value := strings.TrimSpace(meta[key]); value != "" {
		return value
	}
	return fallback
}

func (h *AgentTaskHandlers) HandleListTasks(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		AgentID string `json:"agent_id"`
	}
	_ = json.Unmarshal(req.Body(), &input)
	tasks, err := h.svc.ListTasks(ctx, subjectActorID(ctx), input.AgentID)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	items := make([]map[string]any, 0, len(tasks))
	for _, t := range tasks {
		items = append(items, taskToJSON(t))
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "tasks": items})
	return nil
}

func (h *AgentTaskHandlers) HandleUpdateTaskStatus(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Result string `json:"result"`
		Error  string `json:"error"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ID == "" || input.Status == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "id and status are required"})
		return nil
	}
	task, err := h.svc.UpdateStatus(ctx, subjectActorID(ctx), input.ID, input.Status, input.Result, input.Error)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "task": taskToJSON(task)})
	return nil
}

func (h *AgentTaskHandlers) HandleDeleteTask(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "id is required"})
		return nil
	}
	if err := h.svc.DeleteTask(ctx, subjectActorID(ctx), input.ID); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (h *AgentTaskHandlers) HandleAddSubtask(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		TaskID string `json:"task_id"`
		Title  string `json:"title"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.TaskID == "" || input.Title == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "task_id and title are required"})
		return nil
	}
	task, err := h.svc.AddSubtask(ctx, subjectActorID(ctx), input.TaskID, input.Title)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "task": taskToJSON(task)})
	return nil
}

func (h *AgentTaskHandlers) HandleCompleteSubtask(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		TaskID    string `json:"task_id"`
		SubtaskID string `json:"subtask_id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.TaskID == "" || input.SubtaskID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "task_id and subtask_id are required"})
		return nil
	}
	task, err := h.svc.CompleteSubtask(ctx, subjectActorID(ctx), input.TaskID, input.SubtaskID)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "task": taskToJSON(task)})
	return nil
}
