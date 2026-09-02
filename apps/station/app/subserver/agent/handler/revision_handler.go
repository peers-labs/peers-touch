package handler

import (
	"context"
	"encoding/json"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type RevisionHandlers struct {
	service *service.RevisionService
}

func NewRevisionHandlers(revisionService *service.RevisionService) *RevisionHandlers {
	return &RevisionHandlers{service: revisionService}
}

func revisionBase(ctx context.Context, conversationID, idempotencyKey string, version uint64) service.RevisionRequest {
	return service.RevisionRequest{
		Ptid:                        subjectActorID(ctx),
		ConversationID:              conversationID,
		IdempotencyKey:              idempotencyKey,
		ExpectedConversationVersion: version,
	}
}

func (h *RevisionHandlers) HandleRetryTurn(ctx context.Context, req *model.RetryTurnRequest) (*model.RetryTurnResponse, error) {
	input := revisionBase(ctx, req.GetConversationId(), req.GetClientIdempotencyKey(), req.GetExpectedConversationVersion())
	input.SourceTurnID = req.GetSourceTurnId()
	input.RequestedBudgetJSON, _ = json.Marshal(req.GetRequestedBudget())
	result, err := h.service.RetryTurn(ctx, input)
	if err != nil {
		return nil, toHandlerError(err)
	}
	attempt, err := revisionAttemptToProto(result.Attempt)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.RetryTurnResponse{
		Turn:         revisionTurnToProto(result.Turn, input.Ptid, input.IdempotencyKey, result.Message, result.AssistantMessage),
		Attempt:      attempt,
		Conversation: revisionConversationToProto(result.Conversation),
	}, nil
}

func (h *RevisionHandlers) HandleRegenerateTurn(ctx context.Context, req *model.RegenerateTurnRequest) (*model.RegenerateTurnResponse, error) {
	input := revisionBase(ctx, req.GetConversationId(), req.GetClientIdempotencyKey(), req.GetExpectedConversationVersion())
	input.SourceMessageID = req.GetSourceAssistantMessageId()
	input.RequestedBudgetJSON, _ = json.Marshal(req.GetRequestedBudget())
	result, err := h.service.RegenerateTurn(ctx, input)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.RegenerateTurnResponse{
		Turn:             revisionTurnToProto(result.Turn, input.Ptid, input.IdempotencyKey, nil, result.AssistantMessage),
		AssistantMessage: revisionMessageToProto(result.Message),
		Conversation:     revisionConversationToProto(result.Conversation),
	}, nil
}

func (h *RevisionHandlers) HandleEditAndResend(ctx context.Context, req *model.EditAndResendRequest) (*model.EditAndResendResponse, error) {
	input := revisionBase(ctx, req.GetConversationId(), req.GetClientIdempotencyKey(), req.GetExpectedConversationVersion())
	input.SourceMessageID = req.GetSourceUserMessageId()
	input.Content = req.GetRevisedContent()
	input.AttachmentsJSON, _ = json.Marshal(req.GetAttachments())
	input.RequestedBudgetJSON, _ = json.Marshal(req.GetRequestedBudget())
	result, err := h.service.EditAndResend(ctx, input)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.EditAndResendResponse{
		Turn:         revisionTurnToProto(result.Turn, input.Ptid, input.IdempotencyKey, result.Message, result.AssistantMessage),
		UserMessage:  revisionMessageToProto(result.Message),
		Conversation: revisionConversationToProto(result.Conversation),
	}, nil
}

func (h *RevisionHandlers) HandleSelectActiveBranch(ctx context.Context, req *model.SelectActiveBranchRequest) (*model.SelectActiveBranchResponse, error) {
	input := revisionBase(ctx, req.GetConversationId(), req.GetClientIdempotencyKey(), req.GetExpectedConversationVersion())
	input.SourceMessageID = req.GetActiveBranchMessageId()
	result, err := h.service.SelectActiveBranch(ctx, input)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.SelectActiveBranchResponse{Conversation: revisionConversationToProto(result.Conversation)}, nil
}

func (h *RevisionHandlers) HandleTombstoneMessage(ctx context.Context, req *model.TombstoneMessageRequest) (*model.TombstoneMessageResponse, error) {
	input := revisionBase(ctx, req.GetConversationId(), req.GetClientIdempotencyKey(), req.GetExpectedConversationVersion())
	input.SourceMessageID = req.GetMessageId()
	input.DestructiveConfirmed = req.GetDestructiveConfirmed()
	input.Reason = req.GetReason()
	result, err := h.service.TombstoneMessage(ctx, input)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.TombstoneMessageResponse{
		Conversation: revisionConversationToProto(result.Conversation),
		Message:      revisionMessageToProto(result.Message),
	}, nil
}

func revisionConversationToProto(conversation *domain.Conversation) *model.Conversation {
	if conversation == nil {
		return nil
	}
	return &model.Conversation{
		ConversationId:        conversation.ConversationID,
		AgentId:               conversation.AgentID,
		Ptid:                  conversation.Ptid,
		Title:                 conversation.Title,
		Description:           conversation.Description,
		ProviderId:            conversation.ProviderID,
		ModelName:             conversation.ModelName,
		Status:                string(conversation.Status),
		ParentId:              conversation.ParentID,
		Meta:                  conversation.Meta,
		ActiveBranchMessageId: conversation.ActiveBranchMessageID,
		RuntimeBinding:        conversation.RuntimeBinding,
		QueuedTurnCount:       conversation.QueuedTurnCount,
		Version:               conversation.Version,
		CreatedAt:             timestampOrNil(conversation.CreatedAt),
		UpdatedAt:             timestampOrNil(conversation.UpdatedAt),
	}
}

func revisionMessageToProto(message *domain.Message) *model.AgentMessage {
	if message == nil {
		return nil
	}
	out := &model.AgentMessage{
		MessageId:       message.MessageID,
		ConversationId:  message.ConversationID,
		TurnId:          message.TurnID,
		ModelName:       message.ModelName,
		Role:            revisionMessageRole(message.Role),
		Content:         message.Content,
		ReasoningJson:   string(message.ReasoningJSON),
		ToolCallsJson:   string(message.ToolCallsJSON),
		MetadataJson:    string(message.MetadataJSON),
		ErrorJson:       string(message.ErrorJSON),
		Seq:             message.Seq,
		MessageStatus:   revisionMessageStatus(message.Status),
		ParentMessageId: message.ParentMessageID,
		CreatedAt:       timestampOrNil(message.CreatedAt),
		UpdatedAt:       timestampOrNil(message.UpdatedAt),
	}
	if len(message.AttachmentsJSON) > 0 {
		_ = json.Unmarshal(message.AttachmentsJSON, &out.Attachments)
	}
	if message.BranchID != "" {
		out.BranchId = &message.BranchID
	}
	if message.ReplacesMessageID != "" {
		out.ReplacesMessageId = &message.ReplacesMessageID
	}
	if message.TombstonedAt != nil {
		out.TombstonedAt = timestampOrNil(*message.TombstonedAt)
		out.TombstonedByPtid = &message.TombstonedByPtid
		out.TombstoneReason = &message.TombstoneReason
	}
	return out
}

func revisionTurnToProto(
	turn *domain.Turn,
	ptid string,
	idempotencyKey string,
	userMessage *domain.Message,
	assistantMessage *domain.Message,
) *model.AgentTurn {
	if turn == nil {
		return nil
	}
	out := &model.AgentTurn{
		TurnId:               turn.TurnID,
		ConversationId:       turn.ConversationID,
		Ptid:                 ptid,
		AgentId:              turn.AgentID,
		ClientIdempotencyKey: idempotencyKey,
		Status:               revisionTurnStatus(turn.Status),
		StartedAt:            timestampOrNil(turn.StartedAt),
	}
	if userMessage != nil {
		out.UserMessageId = userMessage.MessageID
	}
	if assistantMessage != nil {
		out.AssistantMessageId = assistantMessage.MessageID
	}
	if turn.EndedAt != nil {
		out.EndedAt = timestampOrNil(*turn.EndedAt)
	}
	return out
}

func revisionAttemptToProto(attempt *persistence.TurnAttempt) (*model.TurnAttempt, error) {
	if attempt == nil {
		return nil, nil
	}
	runtimeSnapshot, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
	if err != nil {
		return nil, err
	}
	out := &model.TurnAttempt{
		AttemptId:                     attempt.ID,
		TurnId:                        attempt.TurnID,
		Index:                         attempt.AttemptIndex,
		RuntimeSnapshot:               runtimeSnapshot,
		Status:                        revisionTurnStatus(domain.TurnStatus(attempt.Status)),
		ErrorCode:                     attempt.ErrorCode,
		ProviderRequestRef:            attempt.ProviderRequestRef,
		CapabilityReadinessSnapshotId: attempt.ReadinessSnapshotID,
		StartedAt:                     timestampOrNil(attempt.StartedAt),
	}
	if attempt.EndedAt != nil {
		out.EndedAt = timestampOrNil(*attempt.EndedAt)
	}
	return out, nil
}

func revisionMessageRole(role domain.MessageRole) model.MessageRole {
	switch role {
	case domain.MessageRoleUser:
		return model.MessageRole_MESSAGE_ROLE_USER
	case domain.MessageRoleAssistant:
		return model.MessageRole_MESSAGE_ROLE_ASSISTANT
	case domain.MessageRoleTool:
		return model.MessageRole_MESSAGE_ROLE_TOOL
	case domain.MessageRoleSystem:
		return model.MessageRole_MESSAGE_ROLE_SYSTEM
	default:
		return model.MessageRole_MESSAGE_ROLE_UNSPECIFIED
	}
}

func revisionMessageStatus(status string) model.AgentMessageStatus {
	switch status {
	case "pending":
		return model.AgentMessageStatus_AGENT_MESSAGE_STATUS_PENDING
	case "streaming":
		return model.AgentMessageStatus_AGENT_MESSAGE_STATUS_STREAMING
	case "completed":
		return model.AgentMessageStatus_AGENT_MESSAGE_STATUS_COMPLETED
	case "partial":
		return model.AgentMessageStatus_AGENT_MESSAGE_STATUS_PARTIAL
	case "failed":
		return model.AgentMessageStatus_AGENT_MESSAGE_STATUS_FAILED
	case "cancelled":
		return model.AgentMessageStatus_AGENT_MESSAGE_STATUS_CANCELLED
	default:
		return model.AgentMessageStatus_AGENT_MESSAGE_STATUS_UNSPECIFIED
	}
}

func revisionTurnStatus(status domain.TurnStatus) model.AgentTurnStatus {
	switch status {
	case domain.TurnStatusRunning:
		return model.AgentTurnStatus_AGENT_TURN_STATUS_RUNNING
	case domain.TurnStatusCompleted:
		return model.AgentTurnStatus_AGENT_TURN_STATUS_COMPLETED
	case domain.TurnStatusFailed:
		return model.AgentTurnStatus_AGENT_TURN_STATUS_FAILED
	case domain.TurnStatusCancelled:
		return model.AgentTurnStatus_AGENT_TURN_STATUS_CANCELLED
	case domain.TurnStatusInterrupted:
		return model.AgentTurnStatus_AGENT_TURN_STATUS_INTERRUPTED
	default:
		return model.AgentTurnStatus_AGENT_TURN_STATUS_UNSPECIFIED
	}
}

func timestampOrNil(value time.Time) *timestamppb.Timestamp {
	if value.IsZero() {
		return nil
	}
	return timestamppb.New(value)
}
