package handler

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// ThreadHandlers exposes the durable Thread (sub-conversation) HTTP surface.
// Backs the Desktop ThreadView (R11), replacing the prior in-memory projection.
type ThreadHandlers struct {
	threadService *service.ThreadService
}

func NewThreadHandlers(threadService *service.ThreadService) *ThreadHandlers {
	return &ThreadHandlers{threadService: threadService}
}

type threadCreateRequest struct {
	ConversationID  string `json:"conversation_id"`
	SourceMessageID string `json:"source_message_id"`
	Title           string `json:"title"`
}

type threadListRequest struct {
	ConversationID string `json:"conversation_id"`
}

type threadMessagesRequest struct {
	ThreadID string `json:"thread_id"`
	AfterSeq int64  `json:"after_seq"`
}

func (h *ThreadHandlers) HandleCreateThread(ctx context.Context, req server.Request, resp server.Response) error {
	var input threadCreateRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ConversationID == "" || input.SourceMessageID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "conversation_id and source_message_id are required"})
		return nil
	}
	thread, err := h.threadService.CreateThread(ctx, input.ConversationID, input.SourceMessageID, input.Title)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "thread": threadToJSON(thread)})
	return nil
}

func (h *ThreadHandlers) HandleListThreads(ctx context.Context, req server.Request, resp server.Response) error {
	var input threadListRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ConversationID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "conversation_id is required"})
		return nil
	}
	threads, err := h.threadService.ListThreads(ctx, input.ConversationID)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	items := make([]map[string]any, 0, len(threads))
	for _, t := range threads {
		items = append(items, threadToJSON(t))
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "threads": items})
	return nil
}

func (h *ThreadHandlers) HandleListThreadMessages(ctx context.Context, req server.Request, resp server.Response) error {
	var input threadMessagesRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ThreadID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "thread_id is required"})
		return nil
	}
	messages, err := h.threadService.ListThreadMessages(ctx, input.ThreadID, input.AfterSeq)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "messages": messagesToJSON(messages)})
	return nil
}

func threadToJSON(t *domain.Thread) map[string]any {
	if t == nil {
		return nil
	}
	return map[string]any{
		"thread_id":         t.ThreadID,
		"conversation_id":   t.ConversationID,
		"source_message_id": t.SourceMessageID,
		"title":             t.Title,
		"source_seq":        t.SourceSeq,
		"created_at":        t.CreatedAt,
		"updated_at":        t.UpdatedAt,
	}
}
