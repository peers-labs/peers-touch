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
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type TurnHandlers struct {
	turnService     *service.TurnService
	toolRegistry    *service.ToolRegistryService
	chatTaskService *service.ChatTaskService
	convService     *service.ConversationService
}

type localToolResultRequest struct {
	TurnID  string `json:"turn_id"`
	CallID  string `json:"call_id"`
	Content string `json:"content"`
	IsError bool   `json:"is_error"`
}

func NewTurnHandlers(turnService *service.TurnService, toolRegistry *service.ToolRegistryService, chatTaskService *service.ChatTaskService, convService *service.ConversationService) *TurnHandlers {
	return &TurnHandlers{turnService: turnService, toolRegistry: toolRegistry, chatTaskService: chatTaskService, convService: convService}
}

// beginChatTaskStep ensures the Station-owned Chat root task for the conversation
// and opens an execution step for the incoming user message. It returns the
// task/step ids so the caller can bind them to the turn and close them out.
func (h *TurnHandlers) beginChatTaskStep(ctx context.Context, req *model.ExecuteTurnRequest) (taskID, stepID string) {
	if h.chatTaskService == nil {
		return "", ""
	}
	actorPTID := subjectActorPTID(ctx)
	if actorPTID == "" {
		return "", ""
	}
	taskID, err := h.chatTaskService.EnsureChatTask(ctx, actorPTID, req.GetAgentId(), req.GetConversationId(), req.GetUserInput())
	if err != nil {
		return "", ""
	}
	stepID, err = h.chatTaskService.BeginChatStep(ctx, taskID, req.GetAgentId(), req.GetUserInput())
	if err != nil {
		return taskID, ""
	}
	return taskID, stepID
}

func (h *TurnHandlers) HandleExecuteTurn(ctx context.Context, req *model.ExecuteTurnRequest) (*model.ExecuteTurnResponse, error) {
	if req.GetAgentId() == "" || req.GetUserInput() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400,
			"agent_id and user_input are required", nil))
	}

	if strings.TrimSpace(req.GetConversationId()) == "" && h.convService != nil {
		actorPTID := subjectActorPTID(ctx)
		conv, err := h.convService.CreateConversation(ctx, req.GetAgentId(), actorPTID, truncateForTitle(req.GetUserInput()), "", req.GetModel(), req.GetProvider())
		if err != nil {
			return nil, toHandlerError(err)
		}
		req.ConversationId = conv.ConversationID
	}

	if req.GetConversationId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400,
			"conversation_id is required", nil))
	}

	config := h.turnConfigFromRequest(ctx, req, nil)
	taskID, stepID := h.beginChatTaskStep(ctx, req)
	config.TaskID = taskID
	config.StepID = stepID

	turn, err := h.turnService.ExecuteTurn(ctx, config, req.GetUserInput())
	if err != nil {
		if h.chatTaskService != nil && stepID != "" {
			_ = h.chatTaskService.FailChatStep(ctx, taskID, stepID, err.Error())
		}
		return nil, toHandlerError(err)
	}

	if h.chatTaskService != nil && stepID != "" {
		turnID := ""
		if turn != nil {
			turnID = turn.TurnID
		}
		_ = h.chatTaskService.FinishChatStep(ctx, taskID, stepID, turnID, "")
	}

	return &model.ExecuteTurnResponse{
		Turn:   domainTurnToProto(turn),
		TaskId: taskID,
	}, nil
}

func (h *TurnHandlers) HandleListTurnTraces(ctx context.Context, req *model.ListTurnTracesRequest) (*model.ListTurnTracesResponse, error) {
	entries, total, err := h.turnService.ListTurnTraces(ctx, domain.TurnTraceListOptions{
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
	entry, err := h.turnService.GetTurnTrace(ctx, req.GetTraceId(), req.GetTurnId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetTurnTraceResponse{Entry: domainTurnTraceEntryToProto(entry)}, nil
}

func (h *TurnHandlers) HandleExecuteTurnStream(ctx context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "text/event-stream")
	resp.SetHeader("Cache-Control", "no-cache")
	resp.SetHeader("Connection", "keep-alive")
	resp.SetHeader("X-Accel-Buffering", "no")

	var input model.ExecuteTurnRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
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

	if strings.TrimSpace(input.GetConversationId()) == "" && h.convService != nil {
		actorPTID := subjectActorPTID(ctx)
		conv, err := h.convService.CreateConversation(ctx, input.GetAgentId(), actorPTID, truncateForTitle(input.GetUserInput()), "", input.GetModel(), input.GetProvider())
		if err != nil {
			_ = writeTurnStreamEvent(resp, "error", map[string]any{"type": "error", "error": err.Error()})
			return nil
		}
		input.ConversationId = conv.ConversationID
		_ = writeTurnStreamEvent(resp, "conversation_created", map[string]any{
			"type":            "conversation_created",
			"conversation_id": conv.ConversationID,
		})
	} else if h.convService != nil {
		actorPTID := subjectActorPTID(ctx)
		existing, getErr := h.convService.GetConversation(ctx, input.GetConversationId())
		if getErr != nil || existing == nil {
			conv, err := h.convService.CreateConversationWithID(ctx, input.GetConversationId(), input.GetAgentId(), actorPTID, truncateForTitle(input.GetUserInput()), "", input.GetModel(), input.GetProvider())
			if err != nil {
				_ = writeTurnStreamEvent(resp, "error", map[string]any{"type": "error", "error": err.Error()})
				return nil
			}
			_ = writeTurnStreamEvent(resp, "conversation_created", map[string]any{
				"type":            "conversation_created",
				"conversation_id": conv.ConversationID,
			})
		}
	}

	if input.GetConversationId() == "" {
		_ = writeTurnStreamEvent(resp, "error", map[string]any{
			"type":  "error",
			"error": "conversation_id is required",
		})
		return nil
	}

	events := make(chan service.TurnEvent, 32)
	done := make(chan turnStreamResult, 1)
	config := h.turnConfigFromRequest(ctx, &input, func(eventCtx context.Context, event service.TurnEvent) {
		select {
		case events <- event:
		case <-eventCtx.Done():
		}
	})
	taskID, stepID := h.beginChatTaskStep(ctx, &input)
	config.TaskID = taskID
	config.StepID = stepID

	go func() {
		turn, err := h.turnService.ExecuteTurn(ctx, config, input.GetUserInput())
		if h.chatTaskService != nil && stepID != "" {
			if err != nil {
				_ = h.chatTaskService.FailChatStep(ctx, taskID, stepID, err.Error())
			} else {
				turnID := ""
				if turn != nil {
					turnID = turn.TurnID
				}
				_ = h.chatTaskService.FinishChatStep(ctx, taskID, stepID, turnID, "")
			}
		}
		var suggestions []string
		if err == nil && turn != nil {
			suggestions = h.turnService.GenerateFollowUpSuggestions(ctx, config, input.GetUserInput(), turn.FinalResponse)
		}
		done <- turnStreamResult{turn: domainTurnToProto(turn), taskID: taskID, err: err, suggestions: suggestions}
		close(events)
	}()

	for {
		select {
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			_ = writeTurnStreamEvent(resp, event.Type, event)
		case result := <-done:
			if result.err != nil {
				_ = writeTurnStreamEvent(resp, "error", map[string]any{
					"type":  "error",
					"error": result.err.Error(),
				})
				return nil
			}
			_ = writeTurnStreamEvent(resp, "done", map[string]any{
				"type":        "done",
				"turn":        result.turn,
				"task_id":     result.taskID,
				"suggestions": result.suggestions,
			})
			return nil
		case <-ctx.Done():
			return nil
		}
	}
}

func (h *TurnHandlers) HandleLocalToolResult(ctx context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "application/json")

	var input localToolResultRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		resp.WriteHeader(400)
		_, _ = resp.Write([]byte(`{"ok":false,"error":"invalid local tool result request"}`))
		return nil
	}
	if input.TurnID == "" || input.CallID == "" {
		resp.WriteHeader(400)
		_, _ = resp.Write([]byte(`{"ok":false,"error":"turn_id and call_id are required"}`))
		return nil
	}
	if err := h.turnService.SubmitLocalToolResult(service.LocalToolResult{
		TurnID:  input.TurnID,
		CallID:  input.CallID,
		Content: input.Content,
		IsError: input.IsError,
	}); err != nil {
		resp.WriteHeader(404)
		_, _ = resp.Write([]byte(`{"ok":false,"error":"local tool waiter not found"}`))
		return nil
	}

	_, _ = resp.Write([]byte(`{"ok":true}`))
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

	config := h.turnConfigFromRequest(ctx, &model.ExecuteTurnRequest{
		AgentId: input.AgentID,
	}, nil)

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
	turn        *model.Turn
	taskID      string
	err         error
	suggestions []string
}

func (h *TurnHandlers) turnConfigFromRequest(ctx context.Context, req *model.ExecuteTurnRequest, sink service.TurnEventSink) *service.TurnConfig {
	contextWindowSize := int(req.GetContextWindowSize())
	if contextWindowSize <= 0 {
		contextWindowSize = 128000
	}

	maxRetries := int(req.GetMaxRetries())
	if maxRetries <= 0 {
		maxRetries = 3
	}

	actorPTID := subjectActorPTID(ctx)

	return &service.TurnConfig{
		AgentID:            req.GetAgentId(),
		ActorPTID:          actorPTID,
		ConversationID:     req.GetConversationId(),
		Identity:           req.GetIdentity(),
		AgentConfigPrompt:  req.GetAgentConfigPrompt(),
		Platform:           req.GetPlatform(),
		AvailableTools:     h.toolRegistry.ToolNames(),
		ContextWindowSize:  contextWindowSize,
		MaxRetries:         maxRetries,
		Provider:           req.GetProvider(),
		Model:              req.GetModel(),
		Effort:             req.GetEffort(),
		WorkspaceRoot:      req.GetWorkspaceRoot(),
		KnowledgeResources: knowledgeResourcesFromRequest(req),
		EventSink:          sink,
		// CLI execution fields — pass through from proto request.
		CliCommand:     req.GetCliCommand(),
		RuntimeBackend: req.GetRuntimeBackend(),
		AllowedRoots:   req.GetAllowedRoots(),
		MemoryDisabled: req.GetMemoryDisabled(),
	}
}

func knowledgeResourcesFromRequest(req *model.ExecuteTurnRequest) []domain.KnowledgeResource {
	resources := req.GetKnowledgeResources()
	if len(resources) == 0 {
		return nil
	}
	out := make([]domain.KnowledgeResource, 0, len(resources))
	for _, resource := range resources {
		if resource.GetSource() == "" {
			continue
		}
		out = append(out, domain.KnowledgeResource{
			ResourceID: resource.GetResourceId(),
			AgentID:    resource.GetAgentId(),
			Type:       knowledgeResourceTypeFromProto(resource.GetType()),
			Title:      resource.GetTitle(),
			Source:     resource.GetSource(),
			Policy:     knowledgeResourcePolicyFromProto(resource.GetPolicy()),
			Status:     resource.GetStatus().String(),
		})
	}
	return out
}

func knowledgeResourceTypeFromProto(value model.KnowledgeResourceType) domain.KnowledgeResourceType {
	switch value {
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_FOLDER:
		return domain.KnowledgeResourceTypeFolder
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_PROJECT:
		return domain.KnowledgeResourceTypeProject
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_URL:
		return domain.KnowledgeResourceTypeURL
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_NOTEBOOK:
		return domain.KnowledgeResourceTypeNotebook
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_WORKSPACE:
		return domain.KnowledgeResourceTypeWorkspace
	default:
		return domain.KnowledgeResourceTypeDocument
	}
}

func knowledgeResourcePolicyFromProto(value model.KnowledgeResourcePolicy) domain.KnowledgeResourcePolicy {
	switch value {
	case model.KnowledgeResourcePolicy_KNOWLEDGE_RESOURCE_POLICY_AUTO:
		return domain.KnowledgeResourcePolicyAuto
	case model.KnowledgeResourcePolicy_KNOWLEDGE_RESOURCE_POLICY_ALWAYS:
		return domain.KnowledgeResourcePolicyAlways
	case model.KnowledgeResourcePolicy_KNOWLEDGE_RESOURCE_POLICY_DISABLED:
		return domain.KnowledgeResourcePolicyDisabled
	default:
		return domain.KnowledgeResourcePolicyManual
	}
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
	return nil
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
	case domain.TurnStatusRunning:
		return model.TurnStatus_TURN_STATUS_RUNNING
	case domain.TurnStatusCompleted:
		return model.TurnStatus_TURN_STATUS_COMPLETED
	case domain.TurnStatusFailed:
		return model.TurnStatus_TURN_STATUS_FAILED
	case domain.TurnStatusInterrupted:
		return model.TurnStatus_TURN_STATUS_INTERRUPTED
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
