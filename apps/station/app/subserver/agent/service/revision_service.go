package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	revisionRetry      = "retry_turn"
	revisionRegenerate = "regenerate_turn"
	revisionEditResend = "edit_and_resend"
	revisionSelect     = "select_active_branch"
	revisionTombstone  = "tombstone_message"
)

type RevisionRequest struct {
	Ptid                        string
	ConversationID              string
	SourceTurnID                string
	SourceMessageID             string
	Content                     string
	AttachmentsJSON             json.RawMessage
	RequestedBudgetJSON         json.RawMessage
	IdempotencyKey              string
	ExpectedConversationVersion uint64
	DestructiveConfirmed        bool
	Reason                      string
}

type RevisionResult struct {
	Turn             *domain.Turn
	Attempt          *persistence.TurnAttempt
	Message          *domain.Message
	AssistantMessage *domain.Message
	Conversation     *domain.Conversation
}

type revisionAdmission struct {
	TurnID             string `json:"turn_id,omitempty"`
	AttemptID          string `json:"attempt_id,omitempty"`
	MessageID          string `json:"message_id,omitempty"`
	AssistantMessageID string `json:"assistant_message_id,omitempty"`
}

type RevisionService struct {
	conversations *ConversationService
	turns         revisionTurnExecutor
}

type revisionTurnExecutor interface {
	ExecuteTurn(context.Context, *TurnConfig, string) (*domain.Turn, error)
}

func NewRevisionService(conversations *ConversationService, turns revisionTurnExecutor) *RevisionService {
	return &RevisionService{conversations: conversations, turns: turns}
}

func revisionPayloadHash(request RevisionRequest) string {
	encoded, _ := json.Marshal(request)
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

func validateRevisionRequest(request RevisionRequest) error {
	if strings.TrimSpace(request.Ptid) == "" ||
		strings.TrimSpace(request.ConversationID) == "" ||
		strings.TrimSpace(request.IdempotencyKey) == "" ||
		request.ExpectedConversationVersion == 0 {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"ptid, conversation_id, idempotency_key and expected_conversation_version are required", nil)
	}
	return nil
}

func loadOwnedConversationTx(tx *gorm.DB, request RevisionRequest) (*persistence.Conversation, error) {
	var conversation persistence.Conversation
	if err := tx.Where(
		"id = ? AND ptid = ? AND status != ?",
		request.ConversationID,
		request.Ptid,
		"deleted",
	).First(&conversation).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound,
				"conversation not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to load conversation", err)
	}
	if conversation.Version != request.ExpectedConversationVersion {
		return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
			"conversation version changed", nil)
	}
	return &conversation, nil
}

func loadRevisionSourceMessageTx(
	tx *gorm.DB,
	request RevisionRequest,
	expectedRole domain.MessageRole,
) (*persistence.AgentMessage, error) {
	var message persistence.AgentMessage
	if err := tx.Where(
		"id = ? AND conversation_id = ? AND tombstoned_at IS NULL",
		request.SourceMessageID,
		request.ConversationID,
	).First(&message).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound,
				"source message not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to load source message", err)
	}
	if message.Role != string(expectedRole) {
		return nil, errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
			"source message role is incompatible", nil)
	}
	return &message, nil
}

func loadRevisionSourceTurnTx(
	tx *gorm.DB,
	request RevisionRequest,
) (*persistence.AgentTurn, error) {
	var turn persistence.AgentTurn
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
		"id = ? AND conversation_id = ?",
		request.SourceTurnID,
		request.ConversationID,
	).First(&turn).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound,
				"source turn not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to load source turn", err)
	}
	if turn.Status != string(domain.TurnStatusFailed) &&
		turn.Status != string(domain.TurnStatusCancelled) &&
		turn.Status != string(domain.TurnStatusInterrupted) {
		return nil, errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
			"source turn is not retryable", nil)
	}
	return &turn, nil
}

func loadRevisionReplayTx(
	tx *gorm.DB,
	kind string,
	request RevisionRequest,
) (*revisionAdmission, bool, error) {
	var row persistence.RevisionCommand
	err := tx.Where(
		"ptid = ? AND command_kind = ? AND idempotency_key = ?",
		request.Ptid,
		kind,
		request.IdempotencyKey,
	).First(&row).Error
	if err == gorm.ErrRecordNotFound {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if row.PayloadHash != revisionPayloadHash(request) {
		return nil, false, errcode.New(errcode.AgentIdempotencyConflict, http.StatusConflict,
			"idempotency key payload mismatch", nil)
	}
	var admission revisionAdmission
	if err := json.Unmarshal([]byte(row.ResponseJSON), &admission); err != nil {
		return nil, false, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"stored revision result is invalid", err)
	}
	return &admission, true, nil
}

func storeRevisionAdmissionTx(
	tx *gorm.DB,
	kind string,
	request RevisionRequest,
	admission revisionAdmission,
) error {
	response, _ := json.Marshal(admission)
	return tx.Create(&persistence.RevisionCommand{
		ID:             generateID("revision"),
		Ptid:           request.Ptid,
		CommandKind:    kind,
		IdempotencyKey: request.IdempotencyKey,
		PayloadHash:    revisionPayloadHash(request),
		ResponseJSON:   string(response),
	}).Error
}

func nextMessageSeqTx(tx *gorm.DB, conversationID string) (int64, error) {
	var maxSeq struct{ MaxSeq int64 }
	if err := tx.Model(&persistence.AgentMessage{}).
		Where("conversation_id = ?", conversationID).
		Select("COALESCE(MAX(seq), 0) AS max_seq").
		Scan(&maxSeq).Error; err != nil {
		return 0, err
	}
	var maxEventSeq struct{ MaxSeq int64 }
	if err := tx.Model(&persistence.TurnEvent{}).
		Where("conversation_id = ?", conversationID).
		Select("COALESCE(MAX(event_seq), 0) AS max_seq").
		Scan(&maxEventSeq).Error; err != nil {
		return 0, err
	}
	if maxEventSeq.MaxSeq > maxSeq.MaxSeq {
		maxSeq.MaxSeq = maxEventSeq.MaxSeq
	}
	return maxSeq.MaxSeq + 1, nil
}

func storeRevisionEventTx(
	tx *gorm.DB,
	kind string,
	request RevisionRequest,
	admission revisionAdmission,
) error {
	seq, err := nextMessageSeqTx(tx, request.ConversationID)
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]string{
		"command_kind":         kind,
		"turn_id":              admission.TurnID,
		"attempt_id":           admission.AttemptID,
		"message_id":           admission.MessageID,
		"assistant_message_id": admission.AssistantMessageID,
	})
	return tx.Create(&persistence.TurnEvent{
		ID:             generateID("tevt"),
		ConversationID: request.ConversationID,
		TurnID:         admission.TurnID,
		AttemptID:      admission.AttemptID,
		EventSeq:       seq,
		EventType:      "message_revision",
		Payload:        string(payload),
		CreatedAt:      time.Now(),
	}).Error
}

func (s *RevisionService) RegenerateTurn(ctx context.Context, request RevisionRequest) (*RevisionResult, error) {
	return s.admitAndExecute(ctx, revisionRegenerate, request)
}

func (s *RevisionService) EditAndResend(ctx context.Context, request RevisionRequest) (*RevisionResult, error) {
	if strings.TrimSpace(request.Content) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"revised content is required", nil)
	}
	return s.admitAndExecute(ctx, revisionEditResend, request)
}

func (s *RevisionService) RetryTurn(ctx context.Context, request RevisionRequest) (*RevisionResult, error) {
	return s.admitAndExecute(ctx, revisionRetry, request)
}

func (s *RevisionService) admitAndExecute(
	ctx context.Context,
	kind string,
	request RevisionRequest,
) (*RevisionResult, error) {
	if err := validateRevisionRequest(request); err != nil {
		return nil, err
	}
	db, err := s.conversations.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var admission revisionAdmission
	var config TurnConfig
	var input string
	var replay bool
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if existing, found, err := loadRevisionReplayTx(tx, kind, request); err != nil {
			return err
		} else if found {
			admission = *existing
			replay = true
			return nil
		}
		conversation, err := loadOwnedConversationTx(tx, request)
		if err != nil {
			return err
		}
		now := time.Now()
		turnID := generateID("turn")
		branchID := generateID("branch")
		var parentMessage persistence.AgentMessage
		var retryAssistantMessage persistence.AgentMessage
		var reuseRetryAssistantMessage bool
		var createRetryAssistantMessage bool
		var retryActiveBranchMessageID string

		switch kind {
		case revisionRetry:
			sourceTurn, err := loadRevisionSourceTurnTx(tx, request)
			if err != nil {
				return err
			}
			if err := tx.Where(
				"conversation_id = ? AND turn_id = ? AND role = ?",
				request.ConversationID,
				request.SourceTurnID,
				string(domain.MessageRoleUser),
			).Order("seq DESC").First(&parentMessage).Error; err != nil {
				return errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
					"retry source user message is unavailable", err)
			}
			turnID = request.SourceTurnID
			input = revisionStringValue(parentMessage.Content)
			if err := tx.Where(
				"conversation_id = ? AND turn_id = ? AND role = ? AND tombstoned_at IS NULL",
				request.ConversationID,
				request.SourceTurnID,
				string(domain.MessageRoleAssistant),
			).Order("seq DESC").First(&retryAssistantMessage).Error; err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			if retryAssistantMessage.ID != "" {
				switch retryAssistantMessage.Status {
				case "failed", "cancelled", "interrupted", "partial":
					reuseRetryAssistantMessage = true
				case "completed":
					createRetryAssistantMessage = true
				default:
					return errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
						"retry assistant message is not terminal", nil)
				}
			}
			var count int64
			if err := tx.Model(&persistence.TurnAttempt{}).Where("turn_id = ?", turnID).Count(&count).Error; err != nil {
				return err
			}
			attemptID := generateID("attempt")
			if err := tx.Create(&persistence.TurnAttempt{
				ID:           attemptID,
				TurnID:       turnID,
				AttemptIndex: uint32(count + 1),
				Status:       string(domain.TurnStatusRunning),
				StartedAt:    now,
			}).Error; err != nil {
				return err
			}
			if err := tx.Model(sourceTurn).Updates(map[string]interface{}{
				"status":          string(domain.TurnStatusRunning),
				"started_at":      now,
				"ended_at":        nil,
				"final_response":  nil,
				"terminal_reason": "",
			}).Error; err != nil {
				return err
			}
			if reuseRetryAssistantMessage {
				if err := tx.Model(&retryAssistantMessage).Updates(map[string]interface{}{
					"status":     "pending",
					"updated_at": now,
				}).Error; err != nil {
					return err
				}
			} else if createRetryAssistantMessage {
				seq, err := nextMessageSeqTx(tx, request.ConversationID)
				if err != nil {
					return err
				}
				// Retry restarts provider context at the source user while
				// retaining the prior attempt artifact under the same branch.
				empty := ""
				retryParentID := parentMessage.ID
				retryAssistantMessage = persistence.AgentMessage{
					ID:              generateID("msg"),
					ConversationID:  request.ConversationID,
					TurnID:          &turnID,
					ModelName:       retryAssistantMessage.ModelName,
					Role:            string(domain.MessageRoleAssistant),
					Status:          "pending",
					Content:         &empty,
					Seq:             seq,
					BranchID:        retryAssistantMessage.BranchID,
					ParentMessageID: &retryParentID,
					CreatedAt:       now,
					UpdatedAt:       now,
				}
				if err := tx.Create(&retryAssistantMessage).Error; err != nil {
					return err
				}
				retryActiveBranchMessageID = retryAssistantMessage.ID
			}
			admission.AttemptID = attemptID
		case revisionRegenerate, revisionEditResend:
			expectedRole := domain.MessageRoleAssistant
			if kind == revisionEditResend {
				expectedRole = domain.MessageRoleUser
			}
			sourceMessage, err := loadRevisionSourceMessageTx(tx, request, expectedRole)
			if err != nil {
				return err
			}
			parentMessage = *sourceMessage
			if kind == revisionRegenerate {
				if parentMessage.Status != "completed" &&
					parentMessage.Status != "partial" &&
					parentMessage.Status != "failed" &&
					parentMessage.Status != "cancelled" {
					return errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
						"source assistant message is not terminal", nil)
				}
				var sourceUserMessage persistence.AgentMessage
				if err := tx.Where(
					"conversation_id = ? AND role = ? AND seq < ? AND tombstoned_at IS NULL",
					request.ConversationID,
					string(domain.MessageRoleUser),
					parentMessage.Seq,
				).Order("seq DESC").First(&sourceUserMessage).Error; err != nil {
					return errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
						"regenerate source user message is unavailable", err)
				}
				parentMessage = sourceUserMessage
				input = revisionStringValue(parentMessage.Content)
			} else {
				input = request.Content
				seq, err := nextMessageSeqTx(tx, request.ConversationID)
				if err != nil {
					return err
				}
				userID := generateID("msg")
				sourceID := request.SourceMessageID
				content := request.Content
				parentID := revisionStringValue(parentMessage.ParentMessageID)
				if err := tx.Create(&persistence.AgentMessage{
					ID:                userID,
					ConversationID:    request.ConversationID,
					TurnID:            &turnID,
					Role:              string(domain.MessageRoleUser),
					Status:            "completed",
					Content:           &content,
					AttachmentsJSON:   request.AttachmentsJSON,
					Seq:               seq,
					BranchID:          &branchID,
					ParentMessageID:   optionalString(parentID),
					ReplacesMessageID: &sourceID,
					CreatedAt:         now,
					UpdatedAt:         now,
				}).Error; err != nil {
					return err
				}
				parentMessage.ID = userID
				admission.MessageID = userID
			}
			if err := tx.Create(&persistence.AgentTurn{
				ID:             turnID,
				ConversationID: request.ConversationID,
				AgentID:        conversation.AgentID,
				UserInput:      &input,
				Status:         string(domain.TurnStatusRunning),
				StartedAt:      now,
			}).Error; err != nil {
				return err
			}
		default:
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "unknown revision command", nil)
		}

		updates := map[string]interface{}{
			"version":    gorm.Expr("version + 1"),
			"updated_at": now,
		}
		if retryActiveBranchMessageID != "" {
			updates["active_branch_message_id"] = retryActiveBranchMessageID
		}
		if kind != revisionRetry {
			assistantID := generateID("msg")
			seq, err := nextMessageSeqTx(tx, request.ConversationID)
			if err != nil {
				return err
			}
			empty := ""
			parentID := parentMessage.ID
			assistant := persistence.AgentMessage{
				ID:              assistantID,
				ConversationID:  request.ConversationID,
				TurnID:          &turnID,
				Role:            string(domain.MessageRoleAssistant),
				Status:          "pending",
				Content:         &empty,
				Seq:             seq,
				BranchID:        &branchID,
				ParentMessageID: &parentID,
				CreatedAt:       now,
				UpdatedAt:       now,
			}
			if kind == revisionRegenerate {
				sourceID := request.SourceMessageID
				assistant.ReplacesMessageID = &sourceID
			}
			if err := tx.Create(&assistant).Error; err != nil {
				return err
			}
			admission.AssistantMessageID = assistantID
			if kind == revisionRegenerate {
				admission.MessageID = assistantID
			}
			updates["active_branch_message_id"] = assistantID
			config = TurnConfig{
				PrecreatedTurnID:    turnID,
				AgentID:             conversation.AgentID,
				ActorID:             request.Ptid,
				ConversationID:      request.ConversationID,
				SkipUserMessage:     true,
				ContextBranchHeadID: parentMessage.ID,
				AssistantMessageID:  assistantID,
				AssistantBranchID:   branchID,
				AssistantParentID:   parentMessage.ID,
				RequestedBudgetJSON: request.RequestedBudgetJSON,
			}
			if kind == revisionRegenerate {
				config.AssistantReplacesID = request.SourceMessageID
			}
		} else {
			config = TurnConfig{
				ExistingTurnID:      turnID,
				AgentID:             conversation.AgentID,
				ActorID:             request.Ptid,
				ConversationID:      request.ConversationID,
				SkipUserMessage:     true,
				ContextBranchHeadID: parentMessage.ID,
				AssistantBranchID:   revisionStringValue(retryAssistantMessage.BranchID),
				AssistantParentID:   parentMessage.ID,
				RequestedBudgetJSON: request.RequestedBudgetJSON,
				AttemptID:           admission.AttemptID,
			}
			if retryAssistantMessage.ID != "" {
				config.AssistantMessageID = retryAssistantMessage.ID
				admission.MessageID = retryAssistantMessage.ID
				admission.AssistantMessageID = retryAssistantMessage.ID
			}
		}
		result := tx.Model(&persistence.Conversation{}).
			Where("id = ? AND ptid = ? AND version = ?", request.ConversationID, request.Ptid, request.ExpectedConversationVersion).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "conversation version changed", nil)
		}
		admission.TurnID = turnID
		if err := storeRevisionAdmissionTx(tx, kind, request, admission); err != nil {
			return err
		}
		return storeRevisionEventTx(tx, kind, request, admission)
	})
	if err != nil {
		return nil, err
	}
	if !replay {
		if _, err := s.turns.ExecuteTurn(ctx, &config, input); err != nil {
			return nil, err
		}
	}
	return s.loadRevisionResult(ctx, request.Ptid, request.ConversationID, admission)
}

func (s *RevisionService) SelectActiveBranch(ctx context.Context, request RevisionRequest) (*RevisionResult, error) {
	return s.mutateConversationOnly(ctx, revisionSelect, request)
}

func (s *RevisionService) TombstoneMessage(ctx context.Context, request RevisionRequest) (*RevisionResult, error) {
	if !request.DestructiveConfirmed {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"destructive confirmation is required", nil)
	}
	return s.mutateConversationOnly(ctx, revisionTombstone, request)
}

func (s *RevisionService) mutateConversationOnly(
	ctx context.Context,
	kind string,
	request RevisionRequest,
) (*RevisionResult, error) {
	if err := validateRevisionRequest(request); err != nil {
		return nil, err
	}
	db, err := s.conversations.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var admission revisionAdmission
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if existing, found, err := loadRevisionReplayTx(tx, kind, request); err != nil {
			return err
		} else if found {
			admission = *existing
			return nil
		}
		conversation, err := loadOwnedConversationTx(tx, request)
		if err != nil {
			return err
		}
		var message persistence.AgentMessage
		if err := tx.Where(
			"id = ? AND conversation_id = ? AND tombstoned_at IS NULL",
			request.SourceMessageID,
			request.ConversationID,
		).First(&message).Error; err != nil {
			return errcode.New(errcode.AgentNotFound, http.StatusNotFound, "message not found", err)
		}
		eventTurnID := strings.TrimSpace(revisionStringValue(message.TurnID))
		if eventTurnID == "" {
			return errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
				"revision source message has no owning turn", nil)
		}
		now := time.Now()
		updates := map[string]interface{}{
			"version":    gorm.Expr("version + 1"),
			"updated_at": now,
		}
		if kind == revisionSelect {
			var visibleChildren int64
			if err := tx.Model(&persistence.AgentMessage{}).
				Where(
					"conversation_id = ? AND parent_message_id = ? AND tombstoned_at IS NULL",
					request.ConversationID,
					message.ID,
				).
				Count(&visibleChildren).Error; err != nil {
				return err
			}
			if visibleChildren > 0 {
				return errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
					"active branch target is not a branch head", nil)
			}
			updates["active_branch_message_id"] = message.ID
		} else {
			if err := ensureTombstoneHasNoActiveDependencyTx(tx, conversation, message); err != nil {
				return err
			}
			if err := tx.Model(&message).Updates(map[string]interface{}{
				"tombstoned_at":      now,
				"tombstoned_by_ptid": request.Ptid,
				"tombstone_reason":   strings.TrimSpace(request.Reason),
				"updated_at":         now,
			}).Error; err != nil {
				return err
			}
			admission.MessageID = message.ID
			if activeBranchContainsMessageTx(tx, request.ConversationID, conversation.ActiveBranchMessageID, message.ID) {
				visibleAncestor, err := nearestVisibleAncestorTx(
					tx,
					request.ConversationID,
					revisionStringValue(message.ParentMessageID),
				)
				if err != nil {
					return err
				}
				updates["active_branch_message_id"] = visibleAncestor
			}
		}
		result := tx.Model(&persistence.Conversation{}).
			Where("id = ? AND ptid = ? AND version = ?", request.ConversationID, request.Ptid, request.ExpectedConversationVersion).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "conversation version changed", nil)
		}
		if err := storeRevisionAdmissionTx(tx, kind, request, admission); err != nil {
			return err
		}
		eventAdmission := admission
		eventAdmission.TurnID = eventTurnID
		eventAdmission.MessageID = message.ID
		return storeRevisionEventTx(tx, kind, request, eventAdmission)
	})
	if err != nil {
		return nil, err
	}
	return s.loadRevisionResult(ctx, request.Ptid, request.ConversationID, admission)
}

func ensureTombstoneHasNoActiveDependencyTx(
	tx *gorm.DB,
	conversation *persistence.Conversation,
	message persistence.AgentMessage,
) error {
	if conversation.QueuedTurnCount > 0 {
		return errcode.New(errcode.AgentActiveDependency, http.StatusConflict,
			"queued turn depends on conversation", nil)
	}
	var activeTurns int64
	if err := tx.Model(&persistence.AgentTurn{}).
		Where("conversation_id = ? AND status = ?", conversation.ID, string(domain.TurnStatusRunning)).
		Count(&activeTurns).Error; err != nil {
		return err
	}
	if activeTurns > 0 {
		return errcode.New(errcode.AgentActiveDependency, http.StatusConflict,
			"active turn depends on conversation", nil)
	}
	if messageHasRetentionLock(message.MetadataJSON) {
		return errcode.New(errcode.AgentActiveDependency, http.StatusConflict,
			"message retention lock is active", nil)
	}
	var messages []persistence.AgentMessage
	if err := tx.Select("tool_calls_json").
		Where("conversation_id = ? AND tombstoned_at IS NULL", conversation.ID).
		Find(&messages).Error; err != nil {
		return err
	}
	for _, candidate := range messages {
		if hasUnresolvedToolDependency(candidate.ToolCallsJSON) {
			return errcode.New(errcode.AgentActiveDependency, http.StatusConflict,
				"unresolved tool or approval depends on conversation", nil)
		}
	}
	return nil
}

func messageHasRetentionLock(metadata json.RawMessage) bool {
	if len(metadata) == 0 {
		return false
	}
	var values map[string]interface{}
	if json.Unmarshal(metadata, &values) != nil {
		return true
	}
	if locked, ok := values["retention_locked"].(bool); ok && locked {
		return true
	}
	reason, _ := values["retention_lock"].(string)
	return strings.TrimSpace(reason) != ""
}

func hasUnresolvedToolDependency(toolCalls json.RawMessage) bool {
	if len(toolCalls) == 0 {
		return false
	}
	var value interface{}
	if json.Unmarshal(toolCalls, &value) != nil {
		return true
	}
	unresolved := map[string]struct{}{
		"proposed":          {},
		"waiting_approval":  {},
		"approval_required": {},
		"approved":          {},
		"claimed":           {},
		"running":           {},
		"pending":           {},
	}
	var inspect func(interface{}) bool
	inspect = func(candidate interface{}) bool {
		switch typed := candidate.(type) {
		case []interface{}:
			for _, item := range typed {
				if inspect(item) {
					return true
				}
			}
		case map[string]interface{}:
			if status, ok := typed["status"].(string); ok {
				if _, found := unresolved[strings.ToLower(strings.TrimSpace(status))]; found {
					return true
				}
			}
			for _, item := range typed {
				if inspect(item) {
					return true
				}
			}
		}
		return false
	}
	return inspect(value)
}

func activeBranchContainsMessageTx(
	tx *gorm.DB,
	conversationID string,
	activeBranchHeadID string,
	messageID string,
) bool {
	for current := strings.TrimSpace(activeBranchHeadID); current != ""; {
		if current == messageID {
			return true
		}
		var row persistence.AgentMessage
		if err := tx.Select("parent_message_id").
			Where("id = ? AND conversation_id = ?", current, conversationID).
			First(&row).Error; err != nil {
			return false
		}
		current = revisionStringValue(row.ParentMessageID)
	}
	return false
}

func nearestVisibleAncestorTx(
	tx *gorm.DB,
	conversationID string,
	messageID string,
) (string, error) {
	for current := strings.TrimSpace(messageID); current != ""; {
		var row persistence.AgentMessage
		if err := tx.Select("id", "parent_message_id", "tombstoned_at").
			Where("id = ? AND conversation_id = ?", current, conversationID).
			First(&row).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return "", nil
			}
			return "", err
		}
		if row.TombstonedAt == nil {
			return row.ID, nil
		}
		current = revisionStringValue(row.ParentMessageID)
	}
	return "", nil
}

func (s *RevisionService) loadRevisionResult(
	ctx context.Context,
	ptid string,
	conversationID string,
	admission revisionAdmission,
) (*RevisionResult, error) {
	conversation, err := s.conversations.GetConversation(ctx, ptid, conversationID)
	if err != nil {
		return nil, err
	}
	result := &RevisionResult{Conversation: conversation}
	db, err := s.conversations.getDB(ctx)
	if err != nil {
		return nil, err
	}
	if admission.TurnID != "" {
		var row persistence.AgentTurn
		if err := db.WithContext(ctx).First(&row, "id = ?", admission.TurnID).Error; err != nil {
			return nil, err
		}
		result.Turn = persistenceTurnToDomain(&row)
	}
	if admission.AttemptID != "" {
		var attempt persistence.TurnAttempt
		if err := db.WithContext(ctx).First(&attempt, "id = ?", admission.AttemptID).Error; err != nil {
			return nil, err
		}
		result.Attempt = &attempt
	}
	if admission.MessageID != "" {
		var message persistence.AgentMessage
		if err := db.WithContext(ctx).First(&message, "id = ?", admission.MessageID).Error; err != nil {
			return nil, err
		}
		result.Message = persistenceAgentMessageToDomain(&message)
	}
	if admission.AssistantMessageID != "" {
		var message persistence.AgentMessage
		if err := db.WithContext(ctx).First(&message, "id = ?", admission.AssistantMessageID).Error; err != nil {
			return nil, err
		}
		result.AssistantMessage = persistenceAgentMessageToDomain(&message)
	}
	return result, nil
}

func persistenceTurnToDomain(row *persistence.AgentTurn) *domain.Turn {
	turn := &domain.Turn{
		TurnID:         row.ID,
		ConversationID: row.ConversationID,
		AgentID:        row.AgentID,
		ToolIterations: row.ToolIterations,
		Status:         domain.TurnStatus(row.Status),
		StartedAt:      row.StartedAt,
		EndedAt:        row.EndedAt,
	}
	if row.UserInput != nil {
		turn.UserInput = *row.UserInput
	}
	if row.FinalResponse != nil {
		turn.FinalResponse = *row.FinalResponse
	}
	return turn
}

func revisionStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
