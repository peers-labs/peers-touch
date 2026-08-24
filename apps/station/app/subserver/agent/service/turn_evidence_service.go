package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

func (s *TurnService) ExportTurnDiagnostics(
	ctx context.Context,
	ptid string,
	turnID string,
) (*model.TurnDiagnosticReplay, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	ptid = strings.TrimSpace(ptid)
	turnID = strings.TrimSpace(turnID)
	if ptid == "" || turnID == "" {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"diagnostic export requires actor and turn",
			nil,
		)
	}

	var turn persistence.AgentTurn
	if err := db.WithContext(ctx).
		Joins("JOIN agent_conversations ON agent_conversations.id = agent_turns.conversation_id").
		Where("agent_turns.id = ? AND agent_conversations.ptid = ?", turnID, ptid).
		First(&turn).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "turn diagnostics not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load diagnostic turn", err)
	}

	attempts, contextLedgers, err := loadDiagnosticAttempts(ctx, db, turnID)
	if err != nil {
		return nil, err
	}
	trace, err := loadDiagnosticTrace(ctx, db, turnID)
	if err != nil {
		return nil, err
	}
	toolCalls, err := loadDiagnosticToolCalls(ctx, db, ptid, turnID)
	if err != nil {
		return nil, err
	}
	feedback, err := loadDiagnosticFeedback(ctx, db, ptid, turnID)
	if err != nil {
		return nil, err
	}
	messages, err := loadDiagnosticMessageFacts(ctx, db, turnID)
	if err != nil {
		return nil, err
	}

	replay := &model.TurnDiagnosticReplay{
		TurnId:         turn.ID,
		ConversationId: turn.ConversationID,
		AgentId:        turn.AgentID,
		Status:         diagnosticTurnStatus(turn.Status),
		TerminalReason: redactDiagnosticText(turn.TerminalReason),
		Attempts:       attempts,
		ContextLedgers: contextLedgers,
		ToolCalls:      toolCalls,
		Feedback:       feedback,
		Messages:       messages,
		StartedAt:      timestamppb.New(turn.StartedAt),
		GeneratedAt:    timestamppb.New(time.Now().UTC()),
		Trace:          trace,
	}
	if turn.EndedAt != nil {
		replay.EndedAt = timestamppb.New(*turn.EndedAt)
	}
	return replay, nil
}

func loadDiagnosticTrace(
	ctx context.Context,
	db *gorm.DB,
	turnID string,
) (*model.TurnTrace, error) {
	var record persistence.TurnTrace
	if err := db.WithContext(ctx).Where("turn_id = ?", turnID).First(&record).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load diagnostic trace", err)
	}
	entry, err := persistenceTurnTraceToDomain(&record)
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "decode diagnostic trace", err)
	}
	trace := &model.TurnTrace{
		TraceId:            entry.Trace.TraceID,
		TurnId:             entry.Trace.TurnID,
		SystemPromptHash:   entry.Trace.SystemPromptHash,
		MemorySnapshotHash: entry.Trace.MemorySnapshotHash,
		SkillIndexHash:     entry.Trace.SkillIndexHash,
		SkillsLoaded:       append([]string(nil), entry.Trace.SkillsLoaded...),
		ReviewTriggered:    entry.Trace.ReviewTriggered,
		ToolCalls:          make([]*model.ToolCallRecord, 0, len(entry.Trace.ToolCalls)),
		ProviderCalls:      make([]*model.ProviderCallRecord, 0, len(entry.Trace.ProviderCalls)),
		KnowledgeChunks:    make([]*model.KnowledgeChunkReference, 0, len(entry.Trace.KnowledgeChunks)),
	}
	for _, call := range entry.Trace.ToolCalls {
		trace.ToolCalls = append(trace.ToolCalls, &model.ToolCallRecord{
			ToolName:   call.ToolName,
			Arguments:  redactDiagnosticText(call.Arguments),
			Result:     redactDiagnosticText(call.Result),
			DurationMs: call.Duration.Milliseconds(),
		})
	}
	for _, call := range entry.Trace.ProviderCalls {
		trace.ProviderCalls = append(trace.ProviderCalls, &model.ProviderCallRecord{
			Provider:     call.Provider,
			Model:        call.Model,
			InputTokens:  int32(call.InputTokens),
			OutputTokens: int32(call.OutputTokens),
			LatencyMs:    call.Latency.Milliseconds(),
			CacheHit:     call.CacheHit,
		})
	}
	for _, chunk := range entry.Trace.KnowledgeChunks {
		trace.KnowledgeChunks = append(trace.KnowledgeChunks, &model.KnowledgeChunkReference{
			ChunkId:       chunk.ChunkID,
			ResourceId:    chunk.ResourceID,
			ResourceTitle: redactDiagnosticText(chunk.ResourceTitle),
			Source:        redactDiagnosticText(chunk.Source),
			ChunkIndex:    int32(chunk.ChunkIndex),
			Score:         chunk.Score,
		})
	}
	if entry.Trace.CompressionTriggered {
		trace.CompressionEvent = &model.CompressionEvent{
			Triggered:    true,
			TokensBefore: int32(entry.Trace.CompressionBefore),
			TokensAfter:  int32(entry.Trace.CompressionAfter),
		}
	}
	return trace, nil
}

func loadDiagnosticAttempts(
	ctx context.Context,
	db *gorm.DB,
	turnID string,
) ([]*model.TurnAttempt, []*model.ContextLedger, error) {
	var records []persistence.TurnAttempt
	if err := db.WithContext(ctx).
		Where("turn_id = ?", turnID).
		Order("attempt_index ASC").
		Find(&records).Error; err != nil {
		return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load diagnostic attempts", err)
	}

	attempts := make([]*model.TurnAttempt, 0, len(records))
	ledgers := make([]*model.ContextLedger, 0, len(records))
	for index := range records {
		record := &records[index]
		usage, err := decodeTurnUsage(record.UsageJSON)
		if err != nil {
			return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "decode diagnostic usage", err)
		}
		contextLedger, err := diagnosticContextLedger(record)
		if err != nil {
			return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "decode diagnostic context ledger", err)
		}
		attempt := &model.TurnAttempt{
			AttemptId:                     record.ID,
			TurnId:                        record.TurnID,
			Index:                         record.AttemptIndex,
			ContextLedgerId:               contextLedger.GetContextLedgerId(),
			Status:                        diagnosticTurnStatus(record.Status),
			ErrorCode:                     redactDiagnosticText(record.ErrorCode),
			Usage:                         usage,
			ProviderRequestRef:            redactDiagnosticText(record.ProviderRequestRef),
			StartedAt:                     timestamppb.New(record.StartedAt),
			CapabilityReadinessSnapshotId: record.ReadinessSnapshotID,
		}
		if record.EndedAt != nil {
			attempt.EndedAt = timestamppb.New(*record.EndedAt)
		}
		attempts = append(attempts, attempt)
		ledgers = append(ledgers, contextLedger)
	}
	return attempts, ledgers, nil
}

func diagnosticContextLedger(record *persistence.TurnAttempt) (*model.ContextLedger, error) {
	ledger := &model.ContextLedger{
		ContextLedgerId: "context:" + record.ID,
		TurnId:          record.TurnID,
		AttemptId:       record.ID,
	}
	if strings.TrimSpace(record.ContextLedger) == "" {
		return ledger, nil
	}
	var segments []ContextSegment
	if err := json.Unmarshal([]byte(record.ContextLedger), &segments); err != nil {
		return nil, err
	}
	ledger.Segments = make([]*model.ContextSegment, 0, len(segments))
	for index, segment := range segments {
		ledger.Segments = append(ledger.Segments, &model.ContextSegment{
			SegmentId:       fmt.Sprintf("%s:%d", ledger.ContextLedgerId, index+1),
			Type:            segment.Type,
			SourceRefs:      redactDiagnosticRefs(segment.SourceRefs),
			ContentHash:     segment.ContentHash,
			EstimatedTokens: uint64(max(segment.EstimatedTokens, 0)),
			Decision:        segment.Decision,
			DecisionReason:  redactDiagnosticText(segment.DecisionReason),
		})
		ledger.EstimatedInputTokens += uint64(max(segment.EstimatedTokens, 0))
	}
	return ledger, nil
}

func decodeTurnUsage(encoded json.RawMessage) (*model.TurnUsage, error) {
	if len(encoded) == 0 {
		return nil, nil
	}
	var usage domain.TurnUsage
	if err := json.Unmarshal(encoded, &usage); err != nil {
		return nil, err
	}
	result := &model.TurnUsage{
		TurnId:               usage.TurnID,
		AttemptId:            usage.AttemptID,
		InputTokens:          usage.InputTokens,
		OutputTokens:         usage.OutputTokens,
		CacheTokens:          usage.CacheTokens,
		ReasoningTokens:      usage.ReasoningTokens,
		ToolDefinitionTokens: usage.ToolDefinitionTokens,
		ProviderCallCount:    usage.ProviderCallCount,
		ToolCallCount:        usage.ToolCallCount,
		ProviderLatencyMs:    uint64(max(usage.ProviderLatency.Milliseconds(), 0)),
		ToolLatencyMs:        uint64(max(usage.ToolLatency.Milliseconds(), 0)),
		Currency:             usage.Currency,
		ProviderId:           usage.ProviderID,
		ModelId:              usage.ModelID,
		ToolCallIds:          append([]string(nil), usage.ToolCallIDs...),
	}
	result.Cost = usage.Cost
	return result, nil
}

func loadDiagnosticToolCalls(
	ctx context.Context,
	db *gorm.DB,
	ptid string,
	turnID string,
) ([]*model.TurnDiagnosticToolFact, error) {
	var records []persistence.ToolCall
	if err := db.WithContext(ctx).
		Where("actor_id = ? AND turn_id = ?", ptid, turnID).
		Order("created_at ASC").
		Find(&records).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load diagnostic tool calls", err)
	}
	facts := make([]*model.TurnDiagnosticToolFact, 0, len(records))
	for index := range records {
		record := &records[index]
		fact := &model.TurnDiagnosticToolFact{
			ToolCallId:        record.ToolCallID,
			AttemptId:         record.AttemptID,
			ToolName:          record.ToolName,
			Status:            diagnosticToolCallStatus(record.Status),
			ExecutionOwner:    diagnosticToolExecutionOwner(record.ExecutionOwner),
			ArgumentsHash:     record.ArgumentsHash,
			RedactedArguments: redactDiagnosticText(record.RedactedArguments),
			ResultId:          record.ResultID,
			ErrorCode:         redactDiagnosticText(record.ErrorCode),
			FencingToken:      record.FencingToken,
		}
		if record.StartedAt != nil {
			fact.StartedAt = timestamppb.New(*record.StartedAt)
		}
		if record.EndedAt != nil {
			fact.EndedAt = timestamppb.New(*record.EndedAt)
		}
		facts = append(facts, fact)
	}
	return facts, nil
}

func loadDiagnosticFeedback(
	ctx context.Context,
	db *gorm.DB,
	ptid string,
	turnID string,
) ([]*model.TurnFeedback, error) {
	var records []persistence.UserFeedback
	if err := db.WithContext(ctx).
		Where("ptid = ? AND turn_id = ?", ptid, turnID).
		Order("created_at ASC").
		Find(&records).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load diagnostic feedback", err)
	}
	result := make([]*model.TurnFeedback, 0, len(records))
	for index := range records {
		record := &records[index]
		var categories []string
		if err := json.Unmarshal(record.Categories, &categories); err != nil && len(record.Categories) > 0 {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "decode diagnostic feedback categories", err)
		}
		for categoryIndex := range categories {
			categories[categoryIndex] = redactDiagnosticText(categories[categoryIndex])
		}
		result = append(result, &model.TurnFeedback{
			FeedbackId:         record.ID,
			TurnId:             record.TurnID,
			AssistantMessageId: record.AssistantMessageID,
			Ptid:               record.Ptid,
			Source:             record.Source,
			Rating:             record.Rating,
			Categories:         categories,
			Comment:            redactDiagnosticText(stringValue(record.Comment)),
			CreatedAt:          timestamppb.New(record.CreatedAt),
			UpdatedAt:          timestamppb.New(record.UpdatedAt),
			ConversationId:     record.ConversationID,
		})
	}
	return result, nil
}

func loadDiagnosticMessageFacts(
	ctx context.Context,
	db *gorm.DB,
	turnID string,
) ([]*model.TurnDiagnosticMessageFact, error) {
	var records []persistence.AgentMessage
	if err := db.WithContext(ctx).
		Where("turn_id = ?", turnID).
		Order("seq ASC").
		Find(&records).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load diagnostic message facts", err)
	}
	facts := make([]*model.TurnDiagnosticMessageFact, 0, len(records))
	for index := range records {
		record := &records[index]
		contentHash := sha256.Sum256([]byte(stringValue(record.Content)))
		facts = append(facts, &model.TurnDiagnosticMessageFact{
			MessageId:         record.ID,
			Role:              diagnosticMessageRole(record.Role),
			Status:            diagnosticMessageStatus(record.Status),
			ContentHash:       hex.EncodeToString(contentHash[:]),
			ParentMessageId:   stringValue(record.ParentMessageID),
			ReplacesMessageId: stringValue(record.ReplacesMessageID),
			CreatedAt:         timestamppb.New(record.CreatedAt),
		})
	}
	return facts, nil
}

func redactDiagnosticRefs(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, redactDiagnosticText(value))
	}
	return result
}

func diagnosticTurnStatus(status string) model.AgentTurnStatus {
	switch status {
	case "submitted":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_SUBMITTED
	case "queued":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_QUEUED
	case "admitted":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_ADMITTED
	case "context_building":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_CONTEXT_BUILDING
	case "running":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_RUNNING
	case "waiting_approval":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_WAITING_APPROVAL
	case "waiting_local_tool":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_WAITING_LOCAL_TOOL
	case "compressing":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_COMPRESSING
	case "retrying":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_RETRYING
	case "falling_back":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_FALLING_BACK
	case "completed":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_COMPLETED
	case "failed":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_FAILED
	case "cancelled":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_CANCELLED
	case "interrupted":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_INTERRUPTED
	case "rejected":
		return model.AgentTurnStatus_AGENT_TURN_STATUS_REJECTED
	default:
		return model.AgentTurnStatus_AGENT_TURN_STATUS_UNSPECIFIED
	}
}

func diagnosticMessageRole(role string) model.MessageRole {
	switch role {
	case "system":
		return model.MessageRole_MESSAGE_ROLE_SYSTEM
	case "user":
		return model.MessageRole_MESSAGE_ROLE_USER
	case "assistant":
		return model.MessageRole_MESSAGE_ROLE_ASSISTANT
	case "tool":
		return model.MessageRole_MESSAGE_ROLE_TOOL
	default:
		return model.MessageRole_MESSAGE_ROLE_UNSPECIFIED
	}
}

func diagnosticMessageStatus(status string) model.AgentMessageStatus {
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

func diagnosticToolExecutionOwner(owner string) model.ToolExecutionOwner {
	switch owner {
	case persistence.ToolOwnerStation:
		return model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION
	case persistence.ToolOwnerClientCapability:
		return model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY
	default:
		return model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_UNSPECIFIED
	}
}

func diagnosticToolCallStatus(status string) model.ToolCallStatus {
	switch status {
	case persistence.ToolCallStatusProposed:
		return model.ToolCallStatus_TOOL_CALL_STATUS_PROPOSED
	case persistence.ToolCallStatusWaitingApproval:
		return model.ToolCallStatus_TOOL_CALL_STATUS_WAITING_APPROVAL
	case persistence.ToolCallStatusApproved:
		return model.ToolCallStatus_TOOL_CALL_STATUS_APPROVED
	case persistence.ToolCallStatusDenied:
		return model.ToolCallStatus_TOOL_CALL_STATUS_DENIED
	case persistence.ToolCallStatusDispatchCommitted:
		return model.ToolCallStatus_TOOL_CALL_STATUS_CLAIMED
	case persistence.ToolCallStatusPrepared:
		return model.ToolCallStatus_TOOL_CALL_STATUS_RUNNING
	case persistence.ToolCallStatusSucceeded:
		return model.ToolCallStatus_TOOL_CALL_STATUS_SUCCEEDED
	case persistence.ToolCallStatusFailed:
		return model.ToolCallStatus_TOOL_CALL_STATUS_FAILED
	case persistence.ToolCallStatusCancelled:
		return model.ToolCallStatus_TOOL_CALL_STATUS_CANCELLED
	case persistence.ToolCallStatusExpired:
		return model.ToolCallStatus_TOOL_CALL_STATUS_EXPIRED
	case persistence.ToolCallStatusUnknownSideEffect:
		return model.ToolCallStatus_TOOL_CALL_STATUS_UNKNOWN_SIDE_EFFECT
	default:
		return model.ToolCallStatus_TOOL_CALL_STATUS_UNSPECIFIED
	}
}
