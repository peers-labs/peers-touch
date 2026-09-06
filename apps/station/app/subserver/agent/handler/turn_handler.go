// Changelog:
// 2026-04-11 — Phase 3 integration: wired TurnService into TurnHandlers,
//   replaced 501 stub with actual ExecuteTurn call and response mapping.
// 2026-04-11 — Phase 4: added ToolRegistryService dependency for populating
//   AvailableTools from the registered tool names.
// 2026-04-15 — Use generated model.ExecuteTurnRequest / model.ExecuteTurnResponse;
//   map domain turn into model.Turn (proto JSON uses camelCase: finalResponse, turnId, …).
// 2026-06-17 — Agent rebuild P0-1: added local tool result ingress so Desktop
//   can return MCP execution results to a live Station turn stream.

package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type TurnHandlers struct {
	turnService     *service.TurnService
	toolRegistry    *service.ToolRegistryService
	chatTaskService *service.ChatTaskService
	convService     *service.ConversationService
	admission       *service.TurnAdmissionService
}

func RejectLegacyTurnKnowledge(next server.EndpointHandler) server.EndpointHandler {
	return func(ctx context.Context, req server.Request, resp server.Response) error {
		if hasLegacyTurnKnowledge(req.Header()["Content-Type"], req.Body()) {
			resp.SetHeader("Content-Type", "application/json")
			resp.WriteHeader(http.StatusBadRequest)
			_, _ = resp.Write([]byte(
				`{"code":"AGENT_4001","error":"request-supplied Knowledge resources are forbidden"}`,
			))
			return nil
		}
		return next(ctx, req, resp)
	}
}

func hasLegacyTurnKnowledge(contentType string, body []byte) bool {
	if strings.Contains(strings.ToLower(contentType), "protobuf") {
		for len(body) > 0 {
			number, wireType, tagSize := protowire.ConsumeTag(body)
			if tagSize < 0 {
				return false
			}
			body = body[tagSize:]
			fieldSize := protowire.ConsumeFieldValue(number, wireType, body)
			if fieldSize < 0 {
				return false
			}
			if number == 13 {
				return true
			}
			body = body[fieldSize:]
		}
		return false
	}

	var payload map[string]json.RawMessage
	if json.Unmarshal(body, &payload) != nil {
		return false
	}
	for _, key := range []string{"knowledge_resources", "knowledgeResources"} {
		raw, ok := payload[key]
		if !ok {
			continue
		}
		trimmed := strings.TrimSpace(string(raw))
		if trimmed != "" && trimmed != "null" && trimmed != "[]" {
			return true
		}
	}
	return false
}

type cancelTurnRequest struct {
	TurnID string `json:"turn_id"`
}

func NewTurnHandlers(turnService *service.TurnService, toolRegistry *service.ToolRegistryService, chatTaskService *service.ChatTaskService, convService *service.ConversationService) *TurnHandlers {
	return &TurnHandlers{turnService: turnService, toolRegistry: toolRegistry, chatTaskService: chatTaskService, convService: convService}
}

func (h *TurnHandlers) SetAdmissionService(admission *service.TurnAdmissionService) {
	h.admission = admission
}

// beginChatTaskStep ensures the Station-owned Chat root task for the conversation
// and opens an execution step for the incoming user message. It returns the
// task/step ids so the caller can bind them to the turn and close them out.
func (h *TurnHandlers) beginChatTaskStep(ctx context.Context, req *model.ExecuteTurnRequest) (taskID, stepID string, err error) {
	if h.chatTaskService == nil {
		return "", "", nil
	}
	actorID := subjectActorID(ctx)
	if actorID == "" {
		return "", "", nil
	}
	taskID, err = h.chatTaskService.EnsureChatTask(ctx, actorID, req.GetAgentId(), req.GetConversationId(), req.GetUserInput())
	if err != nil {
		return "", "", err
	}
	stepID, err = h.chatTaskService.BeginChatStep(ctx, taskID, req.GetAgentId(), req.GetUserInput())
	if err != nil {
		return taskID, "", err
	}
	return taskID, stepID, nil
}

func (h *TurnHandlers) HandleExecuteTurn(ctx context.Context, req *model.ExecuteTurnRequest) (*model.ExecuteTurnResponse, error) {
	if req.GetAgentId() == "" || req.GetUserInput() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400,
			"agent_id and user_input are required", nil))
	}
	if err := validateFrozenDirectModelRequest(req); err != nil {
		return nil, toHandlerError(err)
	}

	createdConversation := false
	if strings.TrimSpace(req.GetConversationId()) == "" && len(req.GetAttachments()) > 0 {
		return nil, toHandlerError(errcode.NewAttachmentRejected(
			firstTurnAttachmentID(req.GetAttachments()),
			"conversation_scope_required",
		))
	}
	if strings.TrimSpace(req.GetConversationId()) == "" && h.convService != nil {
		ptid := subjectActorID(ctx)
		if preflightErr := h.turnService.PreflightTurn(ctx, ptid, req); preflightErr != nil {
			return nil, toHandlerError(preflightErr)
		}
		conv, err := h.convService.CreateConversation(ctx, req.GetAgentId(), ptid, truncateForTitle(req.GetUserInput()), "", req.GetModel(), req.GetProvider())
		if err != nil {
			return nil, toHandlerError(err)
		}
		req.ConversationId = conv.ConversationID
		createdConversation = true
	} else if h.convService != nil {
		ptid := subjectActorID(ctx)
		existing, getErr := h.convService.GetConversation(ctx, ptid, req.GetConversationId())
		if getErr != nil || existing == nil {
			if preflightErr := h.turnService.PreflightTurn(ctx, ptid, req); preflightErr != nil {
				return nil, toHandlerError(preflightErr)
			}
			conv, createErr := h.convService.CreateConversationWithID(ctx, req.GetConversationId(), req.GetAgentId(), ptid, truncateForTitle(req.GetUserInput()), "", req.GetModel(), req.GetProvider())
			if createErr != nil {
				return nil, toHandlerError(createErr)
			}
			createdConversation = true
			req.ConversationId = conv.ConversationID
		}
	}

	if req.GetConversationId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400,
			"conversation_id is required", nil))
	}

	config, err := h.turnConfigFromRequest(ctx, req, nil)
	if err != nil {
		return nil, toHandlerError(err)
	}
	var admission *model.TurnAdmission
	if h.admission != nil {
		admissionResult, admissionErr := h.admission.Admit(ctx, subjectActorID(ctx), req)
		if admissionErr != nil {
			if createdConversation {
				if cleanupErr := h.convService.ArchiveConversation(
					ctx,
					subjectActorID(ctx),
					req.GetConversationId(),
					true,
					1,
				); cleanupErr != nil {
					logger.Errorf(ctx, "failed to remove unadmitted Agent conversation: conversation_id=%s err=%v", req.GetConversationId(), cleanupErr)
				}
			}
			return nil, toHandlerError(admissionErr)
		}
		admission = admissionResult
		if admission.GetStatus() != model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_STARTED {
			return &model.ExecuteTurnResponse{Admission: admission}, nil
		}
		config.PrecreatedTurnID = admission.GetTurnId()
		config.TurnID = admission.GetTurnId()
	}
	taskID, stepID, taskErr := h.beginChatTaskStep(ctx, req)
	config.TaskID = taskID
	config.StepID = stepID
	if taskErr != nil {
		if admission != nil {
			taskErr = h.turnService.SettleAdmittedTurnAfterError(
				context.WithoutCancel(ctx),
				config,
				admission.GetTurnId(),
				"failed to prepare admitted chat task",
				taskErr,
			)
		}
		return nil, toHandlerError(taskErr)
	}

	turn, err := h.turnService.ExecuteTurn(ctx, config, req.GetUserInput())
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.ExecuteTurnResponse{
		Turn:      domainTurnToProto(turn),
		TaskId:    taskID,
		Admission: admission,
	}, nil
}

func (h *TurnHandlers) HandleListTurnTraces(ctx context.Context, req *model.ListTurnTracesRequest) (*model.ListTurnTracesResponse, error) {
	entries, total, err := h.turnService.ListTurnTraces(ctx, domain.TurnTraceListOptions{
		Ptid:           subjectActorID(ctx),
		AgentID:        req.GetAgentId(),
		ConversationID: req.GetConversationId(),
		Page:           int(req.GetPage()),
		PageSize:       int(req.GetPageSize()),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}

	resp := &model.ListTurnTracesResponse{
		Entries: make([]*model.TurnTraceEntry, 0, len(entries)),
		Total:   int32(total),
	}
	for i := range entries {
		resp.Entries = append(resp.Entries, domainTurnTraceEntryToProto(&entries[i]))
	}
	return resp, nil
}

func (h *TurnHandlers) HandleGetTurnTrace(ctx context.Context, req *model.GetTurnTraceRequest) (*model.GetTurnTraceResponse, error) {
	entry, err := h.turnService.GetTurnTrace(ctx, subjectActorID(ctx), req.GetTraceId(), req.GetTurnId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetTurnTraceResponse{Entry: domainTurnTraceEntryToProto(entry)}, nil
}

func (h *TurnHandlers) HandleExportTurnDiagnostics(
	ctx context.Context,
	req *model.ExportTurnDiagnosticsRequest,
) (*model.ExportTurnDiagnosticsResponse, error) {
	replay, err := h.turnService.ExportTurnDiagnostics(ctx, subjectActorID(ctx), req.GetTurnId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ExportTurnDiagnosticsResponse{Replay: replay}, nil
}

func (h *TurnHandlers) HandleExecuteTurnStream(ctx context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "text/event-stream")
	resp.SetHeader("Cache-Control", "no-cache")
	resp.SetHeader("Connection", "keep-alive")
	resp.SetHeader("X-Accel-Buffering", "no")

	var input model.ExecuteTurnRequest
	if err := decodeExecuteTurnRequest(req.Body(), &input); err != nil {
		_ = writeTurnStreamEvent(resp, "error", map[string]any{
			"type":  "error",
			"error": "invalid turn stream request",
		})
		return nil
	}
	input.Stream = true
	if input.GetAgentId() == "" || input.GetUserInput() == "" {
		_ = writeTurnStreamEvent(resp, "error", map[string]any{
			"type":  "error",
			"error": "agent_id and user_input are required",
		})
		return nil
	}
	if err := validateFrozenDirectModelRequest(&input); err != nil {
		_ = writeTurnStreamEvent(resp, "error", map[string]any{
			"type":  "error",
			"error": err.Error(),
		})
		return nil
	}
	turnID := service.NewTurnID()

	createdConversation := false
	if strings.TrimSpace(input.GetConversationId()) == "" && len(input.GetAttachments()) > 0 {
		_ = writeTurnStreamError(resp, errcode.NewAttachmentRejected(
			firstTurnAttachmentID(input.GetAttachments()),
			"conversation_scope_required",
		))
		return nil
	}
	if strings.TrimSpace(input.GetConversationId()) == "" && h.convService != nil {
		ptid := subjectActorID(ctx)
		if preflightErr := h.turnService.PreflightTurn(ctx, ptid, &input); preflightErr != nil {
			_ = writeTurnStreamError(resp, preflightErr)
			return nil
		}
		conv, err := h.convService.CreateConversation(ctx, input.GetAgentId(), ptid, truncateForTitle(input.GetUserInput()), "", input.GetModel(), input.GetProvider())
		if err != nil {
			_ = writeTurnStreamEvent(resp, "error", map[string]any{"type": "error", "error": err.Error()})
			return nil
		}
		input.ConversationId = conv.ConversationID
		createdConversation = true
	} else if h.convService != nil {
		ptid := subjectActorID(ctx)
		existing, getErr := h.convService.GetConversation(ctx, ptid, input.GetConversationId())
		if getErr != nil || existing == nil {
			if preflightErr := h.turnService.PreflightTurn(ctx, ptid, &input); preflightErr != nil {
				_ = writeTurnStreamError(resp, preflightErr)
				return nil
			}
			conv, err := h.convService.CreateConversationWithID(ctx, input.GetConversationId(), input.GetAgentId(), ptid, truncateForTitle(input.GetUserInput()), "", input.GetModel(), input.GetProvider())
			if err != nil {
				_ = writeTurnStreamEvent(resp, "error", map[string]any{"type": "error", "error": err.Error()})
				return nil
			}
			input.ConversationId = conv.ConversationID
			createdConversation = true
		}
	}

	if input.GetConversationId() == "" {
		_ = writeTurnStreamEvent(resp, "error", map[string]any{
			"type":  "error",
			"error": "conversation_id is required",
		})
		return nil
	}

	var admission *model.TurnAdmission
	if h.admission != nil {
		var err error
		admission, err = h.admission.Admit(
			ctx,
			subjectActorID(ctx),
			&input,
			turnID,
		)
		if err != nil {
			if createdConversation {
				if cleanupErr := h.convService.ArchiveConversation(
					ctx,
					subjectActorID(ctx),
					input.GetConversationId(),
					true,
					1,
				); cleanupErr != nil {
					logger.Errorf(ctx, "failed to remove unadmitted Agent conversation: conversation_id=%s err=%v", input.GetConversationId(), cleanupErr)
				}
			}
			_ = writeTurnStreamError(resp, err)
			return nil
		}
		if admission.GetStatus() != model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_STARTED {
			event := "admission_replayed"
			if admission.GetStatus() == model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_QUEUED {
				event = "queued"
			}
			_ = writeTurnStreamEvent(resp, event, map[string]any{
				"type":      event,
				"admission": admission,
			})
			return nil
		}
		turnID = admission.GetTurnId()
	}
	if err := exposeTurnStreamIdentity(resp, turnID); err != nil {
		if admission == nil {
			return err
		}
		return h.turnService.SettleAdmittedTurnAfterError(
			context.WithoutCancel(ctx),
			&service.TurnConfig{
				AgentID:        input.GetAgentId(),
				ConversationID: input.GetConversationId(),
			},
			turnID,
			"failed to expose admitted turn stream identity",
			err,
		)
	}
	if createdConversation && admission != nil {
		if err := h.writePersistedTurnStreamEvent(ctx, resp, "conversation_created", turnID, input.GetConversationId(), input.GetAgentId(), map[string]any{
			"type":            "conversation_created",
			"conversation_id": input.GetConversationId(),
		}); err != nil {
			return h.turnService.SettleAdmittedTurnAfterError(
				context.WithoutCancel(ctx),
				&service.TurnConfig{
					AgentID:        input.GetAgentId(),
					ConversationID: input.GetConversationId(),
				},
				turnID,
				"failed to flush admitted conversation event",
				err,
			)
		}
	}

	events := make(chan service.TurnEvent, 32)
	done := make(chan turnStreamResult, 1)
	config, configErr := h.turnConfigFromRequest(ctx, &input, func(_ context.Context, event service.TurnEvent) {
		select {
		case events <- event:
		case <-ctx.Done():
		}
	})
	if configErr != nil {
		if admission != nil {
			configErr = h.turnService.SettleAdmittedTurnAfterError(
				context.WithoutCancel(ctx),
				&service.TurnConfig{
					AgentID:        input.GetAgentId(),
					ConversationID: input.GetConversationId(),
				},
				turnID,
				"failed to construct admitted turn configuration",
				configErr,
			)
		}
		if writeErr := writeTurnStreamEvent(resp, "error", map[string]any{
			"type":  "error",
			"error": configErr.Error(),
		}); writeErr != nil {
			return errors.Join(configErr, writeErr)
		}
		return nil
	}
	config.TurnID = turnID
	if admission != nil {
		config.PrecreatedTurnID = turnID
	}
	taskID, stepID, taskErr := h.beginChatTaskStep(ctx, &input)
	config.TaskID = taskID
	config.StepID = stepID
	if taskErr != nil {
		if admission != nil {
			taskErr = h.turnService.SettleAdmittedTurnAfterError(
				context.WithoutCancel(ctx),
				config,
				turnID,
				"failed to prepare admitted chat task",
				taskErr,
			)
		}
		if writeErr := writeTurnStreamEvent(resp, "error", map[string]any{
			"type":  "error",
			"error": taskErr.Error(),
		}); writeErr != nil {
			return errors.Join(taskErr, writeErr)
		}
		return nil
	}
	turnCtx, releaseTurn := h.turnService.RegisterTurn(context.WithoutCancel(ctx), turnID)
	config.ExecutionContext = turnCtx

	go func() {
		defer releaseTurn()

		turn, err := h.turnService.ExecuteTurn(turnCtx, config, input.GetUserInput())
		close(events)
		done <- turnStreamResult{turn: domainTurnToProto(turn), err: err}
	}()

	for {
		select {
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			if err := writeTurnStreamEvent(resp, event.Type, event); err != nil {
				return nil
			}
		case result := <-done:
			if err := drainTurnStreamEvents(resp, events); err != nil {
				return nil
			}
			if result.err != nil {
				return nil
			}
			if result.turn != nil && result.turn.GetStatus() == model.TurnStatus_TURN_STATUS_RUNNING {
				return nil
			}
			return nil
		case <-ctx.Done():
			return nil
		}
	}
}

func exposeTurnStreamIdentity(resp server.Response, turnID string) error {
	resp.SetHeader("X-Agent-Turn-ID", strings.TrimSpace(turnID))
	return resp.Flush()
}

func drainTurnStreamEvents(resp server.Response, events <-chan service.TurnEvent) error {
	for events != nil {
		select {
		case event, ok := <-events:
			if !ok {
				return nil
			}
			if err := writeTurnStreamEvent(resp, event.Type, event); err != nil {
				return err
			}
		default:
			return nil
		}
	}
	return nil
}

func (h *TurnHandlers) writePersistedTurnStreamEvent(
	ctx context.Context,
	resp server.Response,
	event string,
	turnID string,
	conversationID string,
	agentID string,
	payload map[string]any,
) error {
	payload["turnId"] = turnID
	payload["conversationId"] = conversationID
	payload["agentId"] = agentID
	if h.convService != nil && conversationID != "" && turnID != "" {
		seq, err := h.convService.PersistTurnEvent(ctx, conversationID, turnID, event, payload)
		if err != nil {
			return err
		}
		payload["seq"] = seq
	}
	return writeTurnStreamEvent(resp, event, payload)
}

func decodeExecuteTurnRequest(body []byte, request *model.ExecuteTurnRequest) error {
	return (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(body, request)
}

func (h *TurnHandlers) HandleCancelTurn(ctx context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "application/json")
	var input cancelTurnRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil || strings.TrimSpace(input.TurnID) == "" {
		resp.WriteHeader(400)
		_, _ = resp.Write([]byte(`{"ok":false,"error":"turn_id is required"}`))
		return nil
	}
	status, err := h.turnService.RequestCancelTurn(ctx, subjectActorID(ctx), input.TurnID)
	if err != nil {
		return toHandlerError(err)
	}
	out, _ := json.Marshal(map[string]any{"ok": true, "turn_id": input.TurnID, "status": status})
	_, _ = resp.Write(out)
	return nil
}

// HandleQuickCompletion performs a one-shot LLM call using the agent's provider.
// Used for lightweight tasks like translation that don't need conversation history.
func (h *TurnHandlers) HandleQuickCompletion(ctx context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "application/json")

	var input struct {
		AgentID string `json:"agent_id"`
		Prompt  string `json:"prompt"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil || input.AgentID == "" || input.Prompt == "" {
		resp.WriteHeader(400)
		_, _ = resp.Write([]byte(`{"ok":false,"error":"agent_id and prompt are required"}`))
		return nil
	}

	config, configErr := h.turnConfigFromRequest(ctx, &model.ExecuteTurnRequest{
		AgentId: input.AgentID,
	}, nil)
	if configErr != nil {
		resp.WriteHeader(http.StatusBadRequest)
		out, _ := json.Marshal(map[string]any{"ok": false, "error": configErr.Error()})
		_, _ = resp.Write(out)
		return nil
	}

	content, err := h.turnService.QuickCompletion(ctx, config, input.Prompt)
	if err != nil {
		resp.WriteHeader(500)
		out, _ := json.Marshal(map[string]any{"ok": false, "error": err.Error()})
		_, _ = resp.Write(out)
		return nil
	}

	out, _ := json.Marshal(map[string]any{"ok": true, "content": content})
	_, _ = resp.Write(out)
	return nil
}

type turnStreamResult struct {
	turn *model.Turn
	err  error
}

func (h *TurnHandlers) turnConfigFromRequest(
	ctx context.Context,
	req *model.ExecuteTurnRequest,
	sink service.TurnEventSink,
) (*service.TurnConfig, error) {
	contextWindowSize := int(req.GetContextWindowSize())
	if contextWindowSize <= 0 {
		contextWindowSize = 128000
	}

	maxRetries := int(req.GetMaxRetries())
	if maxRetries <= 0 {
		maxRetries = 3
	}

	actorID := subjectActorID(ctx)
	var requestedBudgetJSON json.RawMessage
	if req.GetRequestedBudget() != nil {
		encoded, err := protojson.Marshal(req.GetRequestedBudget())
		if err != nil {
			return nil, errcode.New(
				errcode.AgentInvalidRequest,
				http.StatusBadRequest,
				"encode requested runtime budget",
				err,
			)
		}
		requestedBudgetJSON = encoded
	}

	return &service.TurnConfig{
		AgentID:                   req.GetAgentId(),
		ActorID:                   actorID,
		ConversationID:            req.GetConversationId(),
		Identity:                  req.GetIdentity(),
		AgentConfigPrompt:         req.GetAgentConfigPrompt(),
		AvailableTools:            h.toolRegistry.ToolNames(),
		ContextWindowSize:         contextWindowSize,
		MaxRetries:                maxRetries,
		Provider:                  req.GetProvider(),
		Model:                     req.GetModel(),
		Effort:                    req.GetEffort(),
		ThinkingMode:              domain.ThinkingMode(req.GetThinkingMode()),
		ClientCapabilitySessionID: req.GetClientCapabilitySessionId(),
		RequestedBudgetJSON:       requestedBudgetJSON,
		Attachments:               req.GetAttachments(),
		EventSink:                 sink,
		MemoryDisabled:            req.GetMemoryDisabled(),
	}, nil
}

func validateFrozenDirectModelRequest(req *model.ExecuteTurnRequest) error {
	if req == nil {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"turn request is required", nil)
	}
	provider := strings.ToLower(strings.TrimSpace(req.GetProvider()))
	switch provider {
	case "trae-cli", "codex-cli", "claude-cli", "cursor-cli",
		"trae", "codex", "claude", "cursor":
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"CLI runtimes are not supported by the active Agent profile", nil)
	}
	return nil
}

func writeTurnStreamEvent(resp server.Response, event string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := resp.Write([]byte("event: " + event + "\n")); err != nil {
		return err
	}
	if _, err := resp.Write([]byte("data: " + string(data) + "\n\n")); err != nil {
		return err
	}
	return resp.Flush()
}

func writeTurnStreamError(resp server.Response, err error) error {
	return writeTurnStreamEvent(resp, "error", turnStreamErrorPayload(err))
}

func turnStreamErrorPayload(err error) map[string]any {
	payload := map[string]any{
		"type":  "error",
		"error": err.Error(),
	}
	var biz *errcode.BizError
	if !errors.As(err, &biz) || biz.Payload == nil {
		return payload
	}
	details := make(map[string]string, len(biz.Payload.GetDetails()))
	for key, value := range biz.Payload.GetDetails() {
		details[key] = value
	}
	payload["error"] = biz.Payload.GetError()
	payload["error_type"] = biz.Payload.GetErrorType()
	payload["locale_key"] = biz.Payload.GetLocaleKey()
	payload["retryable"] = biz.Payload.GetRetryable()
	payload["terminal"] = biz.Payload.GetTerminal()
	payload["details"] = details
	return payload
}

func firstTurnAttachmentID(attachments []*model.AgentAttachmentRef) string {
	for _, attachment := range attachments {
		if attachmentID := strings.TrimSpace(attachment.GetAttachmentId()); attachmentID != "" {
			return attachmentID
		}
	}
	return ""
}

func domainTurnToProto(t *domain.Turn) *model.Turn {
	if t == nil {
		return nil
	}
	out := &model.Turn{
		TurnId:         t.TurnID,
		ConversationId: t.ConversationID,
		AgentId:        t.AgentID,
		UserInput:      t.UserInput,
		FinalResponse:  t.FinalResponse,
		ToolIterations: int32(t.ToolIterations),
		Status:         domainTurnStatusToProto(t.Status),
	}
	if !t.StartedAt.IsZero() {
		out.StartedAt = timestamppb.New(t.StartedAt)
	}
	if t.EndedAt != nil && !t.EndedAt.IsZero() {
		out.EndedAt = timestamppb.New(*t.EndedAt)
	}
	return out
}

func domainTurnStatusToProto(s domain.TurnStatus) model.TurnStatus {
	switch s {
	case domain.TurnStatusRunning, domain.TurnStatusWaitingLocalTool:
		return model.TurnStatus_TURN_STATUS_RUNNING
	case domain.TurnStatusCompleted:
		return model.TurnStatus_TURN_STATUS_COMPLETED
	case domain.TurnStatusFailed:
		return model.TurnStatus_TURN_STATUS_FAILED
	case domain.TurnStatusInterrupted:
		return model.TurnStatus_TURN_STATUS_INTERRUPTED
	case domain.TurnStatusCancelled:
		return model.TurnStatus_TURN_STATUS_CANCELLED
	default:
		return model.TurnStatus_TURN_STATUS_UNSPECIFIED
	}
}

func domainTurnTraceEntryToProto(entry *domain.TurnTraceEntry) *model.TurnTraceEntry {
	if entry == nil {
		return nil
	}
	return &model.TurnTraceEntry{
		Turn:  domainTurnToProto(&entry.Turn),
		Trace: domainTurnTraceToProto(&entry.Trace),
	}
}

func domainTurnTraceToProto(trace *domain.TurnTrace) *model.TurnTrace {
	if trace == nil {
		return nil
	}
	out := &model.TurnTrace{
		TraceId:            trace.TraceID,
		TurnId:             trace.TurnID,
		SystemPromptHash:   trace.SystemPromptHash,
		MemorySnapshotHash: trace.MemorySnapshotHash,
		SkillIndexHash:     trace.SkillIndexHash,
		SkillsLoaded:       append([]string(nil), trace.SkillsLoaded...),
		ToolCalls:          make([]*model.ToolCallRecord, 0, len(trace.ToolCalls)),
		ProviderCalls:      make([]*model.ProviderCallRecord, 0, len(trace.ProviderCalls)),
		ReviewTriggered:    trace.ReviewTriggered,
		ErrorsClassified:   make([]*model.ClassifiedErrorEvent, 0, len(trace.ErrorClassified)),
		DelegationResults:  make([]*model.DelegationResult, 0, len(trace.DelegationResults)),
		KnowledgeChunks:    make([]*model.KnowledgeChunkReference, 0, len(trace.KnowledgeChunks)),
	}
	for i := range trace.ToolCalls {
		out.ToolCalls = append(out.ToolCalls, domainToolCallRecordToProto(&trace.ToolCalls[i]))
	}
	for i := range trace.ProviderCalls {
		out.ProviderCalls = append(out.ProviderCalls, domainProviderCallRecordToProto(&trace.ProviderCalls[i]))
	}
	for i := range trace.ErrorClassified {
		out.ErrorsClassified = append(out.ErrorsClassified, domainClassifiedErrorToProto(&trace.ErrorClassified[i]))
	}
	if trace.CompressionTriggered {
		out.CompressionEvent = &model.CompressionEvent{
			Triggered:    true,
			TokensBefore: int32(trace.CompressionBefore),
			TokensAfter:  int32(trace.CompressionAfter),
		}
	}
	for i := range trace.DelegationResults {
		out.DelegationResults = append(out.DelegationResults, domainDelegationResultToProto(&trace.DelegationResults[i]))
	}
	for i := range trace.KnowledgeChunks {
		out.KnowledgeChunks = append(out.KnowledgeChunks, domainKnowledgeChunkReferenceToProto(&trace.KnowledgeChunks[i]))
	}
	return out
}

func domainToolCallRecordToProto(record *domain.ToolCallRecord) *model.ToolCallRecord {
	return &model.ToolCallRecord{
		ToolName:   record.ToolName,
		Arguments:  record.Arguments,
		Result:     record.Result,
		DurationMs: record.Duration.Milliseconds(),
	}
}

func domainProviderCallRecordToProto(record *domain.ProviderCallRecord) *model.ProviderCallRecord {
	return &model.ProviderCallRecord{
		Provider:     record.Provider,
		Model:        record.Model,
		InputTokens:  int32(record.InputTokens),
		OutputTokens: int32(record.OutputTokens),
		LatencyMs:    record.Latency.Milliseconds(),
		CacheHit:     record.CacheHit,
		CredentialId: record.CredentialID,
	}
}

func domainClassifiedErrorToProto(event *domain.ClassifiedError) *model.ClassifiedErrorEvent {
	out := &model.ClassifiedErrorEvent{
		Reason:                 domainFailoverReasonToProto(event.Reason),
		Retryable:              event.Retryable,
		ShouldCompress:         event.ShouldCompress,
		ShouldRotateCredential: event.ShouldRotateCredential,
		ShouldFallback:         event.ShouldFallback,
		Provider:               event.Provider,
		Model:                  event.Model,
		HttpStatus:             int32(event.HTTPStatus),
		ErrorCode:              event.ErrorCode,
		ErrorMessage:           event.ErrorMessage,
	}
	if !event.ClassifiedAt.IsZero() {
		out.ClassifiedAt = timestamppb.New(event.ClassifiedAt)
	}
	return out
}

func domainFailoverReasonToProto(reason domain.FailoverReason) model.FailoverReason {
	switch reason {
	case domain.FailoverReasonAuth:
		return model.FailoverReason_FAILOVER_REASON_AUTH
	case domain.FailoverReasonAuthPermanent:
		return model.FailoverReason_FAILOVER_REASON_AUTH_PERMANENT
	case domain.FailoverReasonBilling:
		return model.FailoverReason_FAILOVER_REASON_BILLING
	case domain.FailoverReasonRateLimit:
		return model.FailoverReason_FAILOVER_REASON_RATE_LIMIT
	case domain.FailoverReasonOverloaded:
		return model.FailoverReason_FAILOVER_REASON_OVERLOADED
	case domain.FailoverReasonServerError:
		return model.FailoverReason_FAILOVER_REASON_SERVER_ERROR
	case domain.FailoverReasonTimeout:
		return model.FailoverReason_FAILOVER_REASON_TIMEOUT
	case domain.FailoverReasonContextOverflow:
		return model.FailoverReason_FAILOVER_REASON_CONTEXT_OVERFLOW
	case domain.FailoverReasonPayloadTooLarge:
		return model.FailoverReason_FAILOVER_REASON_PAYLOAD_TOO_LARGE
	case domain.FailoverReasonModelNotFound:
		return model.FailoverReason_FAILOVER_REASON_MODEL_NOT_FOUND
	case domain.FailoverReasonFormatError:
		return model.FailoverReason_FAILOVER_REASON_FORMAT_ERROR
	case domain.FailoverReasonThinkingSignature:
		return model.FailoverReason_FAILOVER_REASON_THINKING_SIGNATURE
	case domain.FailoverReasonLongContextTier:
		return model.FailoverReason_FAILOVER_REASON_LONG_CONTEXT_TIER
	default:
		return model.FailoverReason_FAILOVER_REASON_UNKNOWN
	}
}

func domainDelegationResultToProto(result *domain.DelegationResult) *model.DelegationResult {
	out := &model.DelegationResult{
		TaskId:          result.TaskID,
		ParentTurnId:    result.ParentTurnID,
		TaskDescription: result.TaskDescription,
		ChildToolset:    append([]string(nil), result.ChildToolset...),
		Status:          domainDelegationStatusToProto(result.Status),
		ResultSummary:   result.ResultSummary,
		ToolIterations:  int32(result.ToolIterations),
	}
	if !result.StartedAt.IsZero() {
		out.StartedAt = timestamppb.New(result.StartedAt)
	}
	if result.EndedAt != nil && !result.EndedAt.IsZero() {
		out.EndedAt = timestamppb.New(*result.EndedAt)
	}
	return out
}

func domainDelegationStatusToProto(status domain.DelegationStatus) model.DelegationStatus {
	switch status {
	case domain.DelegationStatusCompleted:
		return model.DelegationStatus_DELEGATION_STATUS_COMPLETED
	case domain.DelegationStatusFailed:
		return model.DelegationStatus_DELEGATION_STATUS_FAILED
	case domain.DelegationStatusTimeout:
		return model.DelegationStatus_DELEGATION_STATUS_TIMEOUT
	default:
		return model.DelegationStatus_DELEGATION_STATUS_UNSPECIFIED
	}
}

func domainKnowledgeChunkReferenceToProto(chunk *domain.KnowledgeChunkReference) *model.KnowledgeChunkReference {
	return &model.KnowledgeChunkReference{
		ChunkId:        chunk.ChunkID,
		ResourceId:     chunk.ResourceID,
		ResourceTitle:  chunk.ResourceTitle,
		Source:         chunk.Source,
		ChunkIndex:     int32(chunk.ChunkIndex),
		Score:          chunk.Score,
		ContentPreview: chunk.ContentPreview,
	}
}

func truncateForTitle(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 50 {
		return s[:50]
	}
	return s
}
