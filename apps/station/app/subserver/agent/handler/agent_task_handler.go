package handler

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// AgentTaskHandlers exposes the user-created single-agent task lifecycle (O3),
// backing the Desktop Tasks page. Station-owned truth replaces the prior
// Desktop localStorage store.
type AgentTaskHandlers struct {
	svc *service.AgentTaskService
}

func NewAgentTaskHandlers(svc *service.AgentTaskService) *AgentTaskHandlers {
	return &AgentTaskHandlers{svc: svc}
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
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.Title == "" || input.AgentID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "title and agent_id are required"})
		return nil
	}
	task, err := h.svc.CreateTask(ctx, subjectActorID(ctx), input.Title, input.Description, input.AgentID, input.Priority, input.TopicKey)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "task": taskToJSON(task)})
	return nil
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
