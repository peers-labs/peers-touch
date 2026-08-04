package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type ConversationHandlers struct {
	convService *service.ConversationService
	turnService *service.TurnService
}

func NewConversationHandlers(convService *service.ConversationService, turnService *service.TurnService) *ConversationHandlers {
	return &ConversationHandlers{convService: convService, turnService: turnService}
}

type conversationListRequest struct {
	AgentID  string `json:"agent_id"`
	Status   string `json:"status"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
}

type conversationCreateRequest struct {
	AgentID     string `json:"agent_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	ModelName   string `json:"model_name"`
	ProviderID  string `json:"provider_id"`
}

type conversationUpdateRequest struct {
	ConversationID string            `json:"conversation_id"`
	Title          string            `json:"title"`
	Description    string            `json:"description"`
	ModelName      string            `json:"model_name"`
	Meta           map[string]string `json:"meta"`
}

type conversationArchiveRequest struct {
	ConversationID string `json:"conversation_id"`
	Permanent      bool   `json:"permanent"`
}

type messageListRequest struct {
	ConversationID string `json:"conversation_id"`
	AfterSeq       int64  `json:"after_seq"`
	BeforeSeq      int64  `json:"before_seq"`
	Limit          int    `json:"limit"`
}

type streamEventsRequest struct {
	ConversationID string `json:"conversation_id"`
	AfterSeq       int64  `json:"after_seq"`
}

func writeJSON(w server.Response, status int, v interface{}) {
	w.SetHeader("Content-Type", "application/json")
	w.WriteHeader(status)
	data, _ := json.Marshal(v)
	_, _ = w.Write(data)
}

func writeSSEEvent(w server.Response, event string, data interface{}) {
	payload, _ := json.Marshal(data)
	_, _ = w.Write([]byte("event: " + event + "\n"))
	_, _ = w.Write([]byte("data: " + string(payload) + "\n\n"))
}

func (h *ConversationHandlers) HandleListConversations(ctx context.Context, req server.Request, resp server.Response) error {
	var input conversationListRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	actorID := subjectActorID(ctx)
	conversations, total, err := h.convService.ListConversations(ctx, input.AgentID, actorID, input.Status, input.Page, input.PageSize)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{
		"ok":            true,
		"conversations": conversationsToJSON(conversations),
		"total":         total,
	})
	return nil
}

func (h *ConversationHandlers) HandleGetConversation(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		ConversationID string `json:"conversation_id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ConversationID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "conversation_id is required"})
		return nil
	}
	conv, err := h.convService.GetConversation(ctx, input.ConversationID)
	if err != nil {
		writeJSON(resp, http.StatusNotFound, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{
		"ok":           true,
		"conversation": conversationToJSON(conv),
	})
	return nil
}

func (h *ConversationHandlers) HandleCreateConversation(ctx context.Context, req server.Request, resp server.Response) error {
	var input conversationCreateRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.AgentID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "agent_id is required"})
		return nil
	}
	actorID := subjectActorID(ctx)
	conv, err := h.convService.CreateConversation(ctx, input.AgentID, actorID, input.Title, input.Description, input.ModelName, input.ProviderID)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{
		"ok":           true,
		"conversation": conversationToJSON(conv),
	})
	return nil
}

func (h *ConversationHandlers) HandleUpdateConversation(ctx context.Context, req server.Request, resp server.Response) error {
	var input conversationUpdateRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ConversationID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "conversation_id is required"})
		return nil
	}
	conv, err := h.convService.UpdateConversation(ctx, input.ConversationID, input.Title, input.Description, input.ModelName, input.Meta)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{
		"ok":           true,
		"conversation": conversationToJSON(conv),
	})
	return nil
}

func (h *ConversationHandlers) HandleArchiveConversation(ctx context.Context, req server.Request, resp server.Response) error {
	var input conversationArchiveRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ConversationID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "conversation_id is required"})
		return nil
	}
	if err := h.convService.ArchiveConversation(ctx, input.ConversationID, input.Permanent); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (h *ConversationHandlers) HandleListMessages(ctx context.Context, req server.Request, resp server.Response) error {
	var input messageListRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ConversationID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "conversation_id is required"})
		return nil
	}
	messages, nextCursor, hasMore, err := h.convService.ListMessages(ctx, input.ConversationID, input.AfterSeq, input.BeforeSeq, input.Limit)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{
		"ok":          true,
		"messages":    messagesToJSON(messages),
		"next_cursor": nextCursor,
		"has_more":    hasMore,
	})
	return nil
}

func (h *ConversationHandlers) HandleStreamConversationEvents(ctx context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "text/event-stream")
	resp.SetHeader("Cache-Control", "no-cache")
	resp.SetHeader("Connection", "keep-alive")
	resp.SetHeader("X-Accel-Buffering", "no")

	var input streamEventsRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeSSEEvent(resp, "error", map[string]any{"type": "error", "error": "invalid request"})
		return nil
	}
	if input.ConversationID == "" {
		writeSSEEvent(resp, "error", map[string]any{"type": "error", "error": "conversation_id is required"})
		return nil
	}

	events, err := h.convService.ReplayTurnEvents(ctx, input.ConversationID, input.AfterSeq)
	if err != nil {
		logger.Warnf(ctx, "failed to replay turn events: conv_id=%s err=%v", input.ConversationID, err)
		writeSSEEvent(resp, "error", map[string]any{"type": "error", "error": err.Error()})
		return nil
	}

	for _, ev := range events {
		var payload map[string]any
		if err := json.Unmarshal([]byte(ev.Payload), &payload); err == nil {
			payload["seq"] = ev.EventSeq
			writeSSEEvent(resp, ev.EventType, payload)
		}
	}

	writeSSEEvent(resp, "catchup_done", map[string]any{"type": "catchup_done", "seq": input.AfterSeq})

	<-ctx.Done()
	return nil
}

func conversationToJSON(c *domain.Conversation) map[string]any {
	if c == nil {
		return nil
	}
	return map[string]any{
		"conversation_id": c.ConversationID,
		"agent_id":        c.AgentID,
		"user_id":         c.UserID,
		"title":           c.Title,
		"description":     c.Description,
		"provider_id":     c.ProviderID,
		"model_name":      c.ModelName,
		"status":          string(c.Status),
		"parent_id":       c.ParentID,
		"created_at":      c.CreatedAt,
		"updated_at":      c.UpdatedAt,
	}
}

func conversationsToJSON(convs []*domain.Conversation) []map[string]any {
	out := make([]map[string]any, 0, len(convs))
	for _, c := range convs {
		out = append(out, conversationToJSON(c))
	}
	return out
}

func messagesToJSON(msgs []*domain.Message) []map[string]any {
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		item := map[string]any{
			"message_id":      m.MessageID,
			"conversation_id": m.ConversationID,
			"turn_id":         m.TurnID,
			"role":            string(m.Role),
			"content":         m.Content,
			"seq":             m.Seq,
			"created_at":      m.CreatedAt,
			"updated_at":      m.UpdatedAt,
		}
		if m.ModelName != "" {
			item["model_name"] = m.ModelName
		}
		if len(m.ReasoningJSON) > 0 {
			item["reasoning_json"] = string(m.ReasoningJSON)
		}
		if len(m.ToolCallsJSON) > 0 {
			item["tool_calls_json"] = string(m.ToolCallsJSON)
		}
		if m.BranchID != "" {
			item["branch_id"] = m.BranchID
		}
		if m.ReplacesMessageID != "" {
			item["replaces_message_id"] = m.ReplacesMessageID
		}
		out = append(out, item)
	}
	return out
}

func mustParseInt64(s string, def int64) int64 {
	if s == "" {
		return def
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return def
	}
	return v
}
