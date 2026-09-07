package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"google.golang.org/protobuf/encoding/protojson"
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
	ConversationID        string            `json:"conversation_id"`
	Title                 string            `json:"title"`
	Description           string            `json:"description"`
	ModelName             string            `json:"model_name"`
	Meta                  map[string]string `json:"meta"`
	ExpectedVersion       uint64            `json:"expected_version"`
	ActiveBranchMessageID *string           `json:"active_branch_message_id"`
}

type conversationArchiveRequest struct {
	ConversationID  string `json:"conversation_id"`
	Permanent       bool   `json:"permanent"`
	ExpectedVersion uint64 `json:"expected_version"`
}

type conversationRestoreRequest struct {
	ConversationID  string `json:"conversation_id"`
	ExpectedVersion uint64 `json:"expected_version"`
}

type messageListRequest struct {
	ConversationID string `json:"conversation_id"`
	AfterSeq       int64  `json:"after_seq"`
	BeforeSeq      int64  `json:"before_seq"`
	Limit          int    `json:"limit"`
}

type messageTranslateRequest struct {
	MessageID   string `json:"message_id"`
	Translation string `json:"translation"`
}

func writeJSON(w server.Response, status int, v interface{}) {
	w.SetHeader("Content-Type", "application/json")
	w.WriteHeader(status)
	data, _ := json.Marshal(v)
	_, _ = w.Write(data)
}

func writeSSEEvent(w server.Response, event string, data interface{}) {
	_ = writeSSEEventChecked(w, event, data)
}

func writeSSEEventChecked(w server.Response, event string, data interface{}) error {
	payload, _ := json.Marshal(data)
	if _, err := w.Write([]byte("event: " + event + "\n")); err != nil {
		return err
	}
	if _, err := w.Write([]byte("data: " + string(payload) + "\n\n")); err != nil {
		return err
	}
	return w.Flush()
}

func (h *ConversationHandlers) HandleListConversations(ctx context.Context, req server.Request, resp server.Response) error {
	var input conversationListRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	ptid := subjectActorID(ctx)
	conversations, total, err := h.convService.ListConversations(ctx, input.AgentID, ptid, input.Status, input.Page, input.PageSize)
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
	conv, err := h.convService.GetConversation(ctx, subjectActorID(ctx), input.ConversationID)
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
	ptid := subjectActorID(ctx)
	conv, err := h.convService.CreateConversation(ctx, input.AgentID, ptid, input.Title, input.Description, input.ModelName, input.ProviderID)
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
	conv, err := h.convService.UpdateConversation(
		ctx,
		subjectActorID(ctx),
		input.ConversationID,
		input.ExpectedVersion,
		input.Title,
		input.Description,
		input.ModelName,
		input.Meta,
		input.ActiveBranchMessageID,
	)
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
	if err := h.convService.ArchiveConversation(
		ctx,
		subjectActorID(ctx),
		input.ConversationID,
		input.Permanent,
		input.ExpectedVersion,
	); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (h *ConversationHandlers) HandleRestoreConversation(ctx context.Context, req server.Request, resp server.Response) error {
	var input conversationRestoreRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ConversationID == "" || input.ExpectedVersion == 0 {
		writeJSON(
			resp,
			http.StatusBadRequest,
			map[string]any{"ok": false, "error": "conversation_id and expected_version are required"},
		)
		return nil
	}
	conversation, err := h.convService.RestoreConversation(
		ctx,
		subjectActorID(ctx),
		input.ConversationID,
		input.ExpectedVersion,
	)
	if err != nil {
		writeJSON(resp, http.StatusConflict, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{
		"ok":           true,
		"conversation": conversationToJSON(conversation),
	})
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
	messages, nextCursor, hasMore, err := h.convService.ListMessages(
		ctx,
		subjectActorID(ctx),
		input.ConversationID,
		input.AfterSeq,
		input.BeforeSeq,
		input.Limit,
	)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	messageItems, err := messagesToJSON(messages)
	if err != nil {
		logger.Errorf(ctx, "failed to decode persisted Agent message attachments: conversation_id=%s err=%v", input.ConversationID, err)
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to decode persisted message attachments"})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{
		"ok":          true,
		"messages":    messageItems,
		"next_cursor": nextCursor,
		"has_more":    hasMore,
	})
	return nil
}

func (h *ConversationHandlers) HandleSetMessageTranslation(ctx context.Context, req server.Request, resp server.Response) error {
	var input messageTranslateRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.MessageID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "message_id is required"})
		return nil
	}
	if err := h.convService.SetMessageTranslation(ctx, subjectActorID(ctx), input.MessageID, input.Translation); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (h *ConversationHandlers) HandleStreamConversationEvents(ctx context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "text/event-stream")
	resp.SetHeader("Cache-Control", "no-cache")
	resp.SetHeader("Connection", "keep-alive")
	resp.SetHeader("X-Accel-Buffering", "no")

	var input model.StreamTurnEventsRequest
	if err := decodeStreamTurnEventsRequest(req.Body(), &input); err != nil {
		writeTurnReplayFailure(resp, "invalid_request", err)
		return nil
	}
	if input.GetConversationId() == "" || input.GetTurnId() == "" {
		writeTurnReplayFailure(resp, "invalid_request", fmt.Errorf("conversation_id and turn_id are required"))
		return nil
	}
	if input.GetAfterSequence() > math.MaxInt64 {
		writeTurnReplayFailure(resp, "invalid_request", fmt.Errorf("after_sequence is out of range"))
		return nil
	}

	notifications, replayBoundary, replayFence, unsubscribe, err := h.convService.SubscribeTurnEvents(
		ctx,
		subjectActorID(ctx),
		input.GetConversationId(),
		input.GetTurnId(),
	)
	if err != nil {
		logger.Warnf(ctx, "failed to subscribe turn events: conv_id=%s err=%v", input.GetConversationId(), err)
		writeTurnReplayFailure(resp, "subscribe_failed", err)
		return nil
	}
	defer unsubscribe()

	lastSequence := int64(input.GetAfterSequence())
	replay := func(throughSequence int64) (bool, error) {
		events, replayErr := h.convService.ReplayTurnEventsThroughFence(
			ctx,
			subjectActorID(ctx),
			input.GetConversationId(),
			input.GetTurnId(),
			lastSequence,
			throughSequence,
			replayFence,
		)
		if replayErr != nil {
			return false, replayErr
		}
		terminal := false
		for _, ev := range events {
			var payload map[string]any
			if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
				return false, fmt.Errorf("decode persisted turn event seq=%d: %w", ev.EventSeq, err)
			}
			payload["seq"] = ev.EventSeq
			if err := writeSSEEventChecked(resp, ev.EventType, payload); err != nil {
				return false, err
			}
			lastSequence = ev.EventSeq
			terminal = terminal || isTerminalTurnEvent(ev.EventType)
		}
		return terminal, nil
	}

	terminal, err := replay(replayBoundary)
	if err != nil {
		logger.Warnf(ctx, "failed to replay turn events: conv_id=%s err=%v", input.GetConversationId(), err)
		writeTurnReplayFailure(resp, "replay_failed", err)
		return nil
	}
	snapshot, err := h.convService.GetTurnEventSnapshotAtFence(
		ctx,
		subjectActorID(ctx),
		input.GetConversationId(),
		input.GetTurnId(),
		replayBoundary,
		replayFence,
	)
	if err != nil {
		writeTurnReplayFailure(resp, "snapshot_failed", err)
		return nil
	}
	if err := writeSSEEventChecked(resp, "snapshot", map[string]any{
		"type":            "snapshot",
		"turnId":          snapshot.TurnID,
		"conversationId":  snapshot.ConversationID,
		"agentId":         snapshot.AgentID,
		"status":          snapshot.Status,
		"text":            snapshot.Text,
		"seq":             snapshot.LastSequence,
		"terminal_reason": snapshot.TerminalReason,
		"updated_at":      snapshot.UpdatedAt,
	}); err != nil {
		return nil
	}
	if err := writeSSEEventChecked(resp, "catchup_done", map[string]any{"type": "catchup_done", "seq": lastSequence}); err != nil {
		return nil
	}
	if shouldCloseInitialTurnReplay(terminal, snapshot.Status) {
		return nil
	}

	poll := time.NewTicker(time.Second)
	defer poll.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-notifications:
		case <-poll.C:
		case <-heartbeat.C:
			if _, err := resp.Write([]byte(": heartbeat\n\n")); err != nil {
				return nil
			}
			if err := resp.Flush(); err != nil {
				return nil
			}
			continue
		}
		terminal, err = replay(math.MaxInt64)
		if err != nil {
			logger.Warnf(ctx, "failed to tail turn events: turn_id=%s after_sequence=%d err=%v", input.GetTurnId(), lastSequence, err)
			writeTurnReplayFailure(resp, "tail_failed", err)
			return nil
		}
		if terminal {
			return nil
		}
	}
}

func shouldCloseInitialTurnReplay(replayedTerminal bool, snapshotStatus string) bool {
	return replayedTerminal || isTerminalTurnStatus(snapshotStatus)
}

func decodeStreamTurnEventsRequest(body []byte, request *model.StreamTurnEventsRequest) error {
	return (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(body, request)
}

func writeTurnReplayFailure(resp server.Response, reason string, err error) {
	writeSSEEvent(resp, "recovery_failed", map[string]any{
		"type":      "recovery_failed",
		"reason":    reason,
		"retryable": reason != "invalid_request",
		"error":     err.Error(),
	})
}

func isTerminalTurnEvent(eventType string) bool {
	switch eventType {
	case "done", "error", "cancelled":
		return true
	default:
		return false
	}
}

func isTerminalTurnStatus(status string) bool {
	switch domain.TurnStatus(status) {
	case domain.TurnStatusCompleted,
		domain.TurnStatusFailed,
		domain.TurnStatusCancelled,
		domain.TurnStatusInterrupted:
		return true
	default:
		return false
	}
}

func conversationToJSON(c *domain.Conversation) map[string]any {
	if c == nil {
		return nil
	}
	return map[string]any{
		"conversation_id":          c.ConversationID,
		"agent_id":                 c.AgentID,
		"ptid":                     c.Ptid,
		"title":                    c.Title,
		"description":              c.Description,
		"provider_id":              c.ProviderID,
		"model_name":               c.ModelName,
		"status":                   string(c.Status),
		"parent_id":                c.ParentID,
		"active_branch_message_id": c.ActiveBranchMessageID,
		"runtime_binding":          conversationRuntimeBindingToJSON(c.RuntimeBinding),
		"queued_turn_count":        c.QueuedTurnCount,
		"version":                  c.Version,
		"created_at":               c.CreatedAt,
		"updated_at":               c.UpdatedAt,
	}
}

func conversationRuntimeBindingToJSON(
	binding *model.ConversationRuntimeBinding,
) map[string]any {
	if binding == nil {
		return nil
	}
	return map[string]any{
		"runtime_kind":             binding.GetRuntimeKind(),
		"provider_id":              binding.GetProviderId(),
		"model_id":                 binding.GetModelId(),
		"runtime_profile_id":       binding.GetRuntimeProfileId(),
		"external_session_id":      binding.GetExternalSessionId(),
		"external_session_epoch":   binding.GetExternalSessionEpoch(),
		"runtime_home_ref":         binding.GetRuntimeHomeRef(),
		"capability_snapshot_hash": binding.GetCapabilitySnapshotHash(),
		"config_snapshot_hash":     binding.GetConfigSnapshotHash(),
		"bound_at":                 binding.GetBoundAt(),
	}
}

func conversationsToJSON(convs []*domain.Conversation) []map[string]any {
	out := make([]map[string]any, 0, len(convs))
	for _, c := range convs {
		out = append(out, conversationToJSON(c))
	}
	return out
}

func messagesToJSON(msgs []*domain.Message) ([]map[string]any, error) {
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		item := map[string]any{
			"message_id":      m.MessageID,
			"conversation_id": m.ConversationID,
			"turn_id":         m.TurnID,
			"role":            string(m.Role),
			"status":          m.Status,
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
		if len(m.MetadataJSON) > 0 {
			item["metadata_json"] = string(m.MetadataJSON)
		}
		if len(m.ErrorJSON) > 0 {
			item["error_json"] = string(m.ErrorJSON)
		}
		if len(m.AttachmentsJSON) > 0 {
			var attachments []*model.AgentAttachmentRef
			if err := json.Unmarshal(m.AttachmentsJSON, &attachments); err != nil {
				return nil, err
			}
			attachmentItems := make([]map[string]any, 0, len(attachments))
			for _, attachment := range attachments {
				if attachment == nil {
					continue
				}
				expiresAt := ""
				if attachment.GetExpiresAt() != nil && attachment.GetExpiresAt().IsValid() {
					expiresAt = attachment.GetExpiresAt().AsTime().UTC().Format(time.RFC3339Nano)
				}
				attachmentItems = append(attachmentItems, map[string]any{
					"attachment_id":         attachment.GetAttachmentId(),
					"object_ref":            attachment.GetObjectRef(),
					"mime_type":             attachment.GetMimeType(),
					"size_bytes":            attachment.GetSizeBytes(),
					"checksum":              attachment.GetChecksum(),
					"filename":              attachment.GetFilename(),
					"authorization_scope":   attachment.GetAuthorizationScope(),
					"expires_at":            expiresAt,
					"extracted_content_ref": attachment.GetExtractedContentRef(),
				})
			}
			item["attachments"] = attachmentItems
		}
		if m.BranchID != "" {
			item["branch_id"] = m.BranchID
		}
		if m.ParentMessageID != "" {
			item["parent_message_id"] = m.ParentMessageID
		}
		if m.ReplacesMessageID != "" {
			item["replaces_message_id"] = m.ReplacesMessageID
		}
		if m.ThreadID != "" {
			item["thread_id"] = m.ThreadID
		}
		out = append(out, item)
	}
	return out, nil
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
