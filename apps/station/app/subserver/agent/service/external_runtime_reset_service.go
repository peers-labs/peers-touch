package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/externalruntime"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type ExternalRuntimeResetResult struct {
	Conversation *domain.Conversation
	ClosedEpoch  uint64
	Replayed     bool
}

func (s *ExternalRuntimeService) PrepareConversationDeletion(
	ctx context.Context,
	actorPTID string,
	conversationID string,
	expectedVersion uint64,
) (uint64, error) {
	if s == nil || s.db == nil {
		return expectedVersion, nil
	}
	var row persistence.Conversation
	if err := s.db.WithContext(ctx).
		Select("runtime_binding").
		Where(
			"id = ? AND actor_ptid = ?",
			strings.TrimSpace(conversationID),
			strings.TrimSpace(actorPTID),
		).
		Take(&row).Error; err != nil {
		return 0, errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			"conversation not found",
			err,
		)
	}
	binding, err := persistence.UnmarshalConversationRuntimeBinding(
		row.RuntimeBinding,
	)
	if err != nil {
		return 0, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"conversation runtime binding is invalid",
			err,
		)
	}
	if binding == nil ||
		binding.GetRuntimeKind() !=
			model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT {
		return expectedVersion, nil
	}
	result, err := s.ResetConversationRuntime(
		ctx,
		actorPTID,
		&model.ResetConversationRuntimeRequest{
			ConversationId:              conversationID,
			ExpectedConversationVersion: expectedVersion,
			ClientIdempotencyKey: "conversation-delete:" +
				conversationID + ":" +
				strconv.FormatUint(expectedVersion, 10),
			DestructiveConfirmed: true,
		},
	)
	if err != nil {
		return 0, err
	}
	return result.Conversation.Version, nil
}

func (s *ExternalRuntimeService) ResetConversationRuntime(
	ctx context.Context,
	actorPTID string,
	request *model.ResetConversationRuntimeRequest,
) (*ExternalRuntimeResetResult, error) {
	if request == nil ||
		strings.TrimSpace(actorPTID) == "" ||
		strings.TrimSpace(request.GetConversationId()) == "" ||
		request.GetExpectedConversationVersion() == 0 ||
		strings.TrimSpace(request.GetClientIdempotencyKey()) == "" {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"actor, conversation_id, expected_conversation_version and client_idempotency_key are required",
			nil,
		)
	}
	if !request.GetDestructiveConfirmed() {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"external runtime reset requires destructive confirmation",
			nil,
		)
	}
	if !s.Available() {
		return nil, errcode.NewRuntimeUnavailable("external_agent", "adapter_unavailable")
	}
	command, replay, err := s.prepareReset(ctx, actorPTID, request)
	if err != nil || replay != nil {
		return replay, err
	}
	cleanupErr := s.manager.Cleanup(ctx, externalruntime.CleanupRequest{
		RuntimeHomeRef: command.OldRuntimeHomeRef,
		SessionID:      command.OldSessionID,
	})
	if cleanupErr != nil {
		if err := s.persistCleanupFailure(
			context.WithoutCancel(ctx),
			command,
			externalRuntimeFailureReason(cleanupErr),
		); err != nil {
			return nil, errors.Join(cleanupErr, err)
		}
		return nil, errcode.NewRuntimeUnavailable(
			"external_agent",
			"cleanup_failed",
		)
	}
	return s.commitReset(context.WithoutCancel(ctx), command)
}

func (s *ExternalRuntimeService) RecoverPendingResets(ctx context.Context) error {
	if s == nil || s.db == nil {
		return nil
	}
	var commands []persistence.ExternalRuntimeResetCommand
	if err := s.db.WithContext(ctx).
		Where("state IN ?", []string{
			persistence.ExternalRuntimeResetPrepared,
			persistence.ExternalRuntimeResetCleanupFailed,
		}).
		Order("created_at ASC").
		Find(&commands).Error; err != nil {
		return fmt.Errorf("load pending external runtime resets: %w", err)
	}
	var recoveryErr error
	for index := range commands {
		command := &commands[index]
		if !s.Available() {
			recoveryErr = errors.Join(
				recoveryErr,
				s.persistCleanupFailure(
					context.WithoutCancel(ctx),
					command,
					"adapter_unavailable",
				),
			)
			continue
		}
		if err := s.reprepareReset(context.WithoutCancel(ctx), command); err != nil {
			recoveryErr = errors.Join(recoveryErr, err)
			continue
		}
		err := s.manager.Cleanup(ctx, externalruntime.CleanupRequest{
			RuntimeHomeRef: command.OldRuntimeHomeRef,
			SessionID:      command.OldSessionID,
		})
		if err != nil {
			recoveryErr = errors.Join(
				recoveryErr,
				s.persistCleanupFailure(
					context.WithoutCancel(ctx),
					command,
					externalRuntimeFailureReason(err),
				),
			)
			continue
		}
		if _, err := s.commitReset(context.WithoutCancel(ctx), command); err != nil {
			recoveryErr = errors.Join(recoveryErr, err)
		}
	}
	return recoveryErr
}

func (s *ExternalRuntimeService) prepareReset(
	ctx context.Context,
	actorPTID string,
	request *model.ResetConversationRuntimeRequest,
) (*persistence.ExternalRuntimeResetCommand, *ExternalRuntimeResetResult, error) {
	payloadHash := externalRuntimeResetPayloadHash(actorPTID, request)
	var command *persistence.ExternalRuntimeResetCommand
	var replay *ExternalRuntimeResetResult
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing persistence.ExternalRuntimeResetCommand
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"ptid = ? AND idempotency_key = ?",
				actorPTID,
				strings.TrimSpace(request.GetClientIdempotencyKey()),
			).
			First(&existing).Error
		if err == nil {
			if existing.PayloadHash != payloadHash {
				return errcode.NewAdmissionDuplicateConflict(
					request.GetClientIdempotencyKey(),
					existing.ID,
				)
			}
			if existing.State == persistence.ExternalRuntimeResetCommitted {
				restored, err := decodeExternalRuntimeResetResult(existing.ResponseJSON)
				if err != nil {
					return err
				}
				restored.Replayed = true
				replay = restored
				return nil
			}
			command = &existing
			return s.reprepareResetTx(tx, command)
		}
		if err != gorm.ErrRecordNotFound {
			return errcode.New(
				errcode.AgentInternal,
				http.StatusInternalServerError,
				"load external runtime reset command",
				err,
			)
		}
		return s.prepareNewResetTx(
			tx,
			actorPTID,
			request,
			payloadHash,
			&command,
		)
	})
	return command, replay, err
}

func (s *ExternalRuntimeService) prepareNewResetTx(
	tx *gorm.DB,
	actorPTID string,
	request *model.ResetConversationRuntimeRequest,
	payloadHash string,
	command **persistence.ExternalRuntimeResetCommand,
) error {
	conversation, binding, err := loadExternalBindingForUpdate(
		tx,
		actorPTID,
		request.GetConversationId(),
	)
	if err != nil {
		return err
	}
	if conversation.Status == string(domain.ConversationStatusDeleted) {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"deleted conversation cannot reset its runtime",
			nil,
		)
	}
	if conversation.Version != request.GetExpectedConversationVersion() {
		return errcode.NewLifecycleStaleVersion(
			conversation.ID,
			request.GetExpectedConversationVersion(),
			conversation.Version,
		)
	}
	if binding.GetRuntimeKind() != model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"conversation is not bound to an external runtime",
			nil,
		)
	}
	switch binding.GetState() {
	case model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_READY,
		model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_RESUME_UNAVAILABLE:
	default:
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"external runtime reset is already active",
			nil,
		)
	}
	if err := rejectExternalRuntimeResetDependencies(tx, conversation); err != nil {
		return err
	}

	now := s.now()
	binding.State = model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_RESET_PREPARED
	binding.LastErrorCode = ""
	binding.UpdatedAt = timestamppb.New(now)
	encoded, err := persistence.MarshalConversationRuntimeBinding(binding)
	if err != nil {
		return err
	}
	if err := tx.Model(&persistence.Conversation{}).
		Where("id = ? AND actor_ptid = ?", conversation.ID, actorPTID).
		Updates(map[string]interface{}{
			"runtime_binding": encoded,
			"updated_at":      now,
		}).Error; err != nil {
		return err
	}
	created := &persistence.ExternalRuntimeResetCommand{
		ID:                  generateID("runtime-reset"),
		Ptid:                actorPTID,
		ConversationID:      conversation.ID,
		IdempotencyKey:      strings.TrimSpace(request.GetClientIdempotencyKey()),
		PayloadHash:         payloadHash,
		State:               persistence.ExternalRuntimeResetPrepared,
		ResetFence:          generateID("runtime-fence"),
		OldSessionID:        binding.GetExternalSessionId(),
		OldSessionEpoch:     binding.GetExternalSessionEpoch(),
		OldRuntimeHomeRef:   binding.GetRuntimeHomeRef(),
		CleanupAttemptCount: 1,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if err := tx.Create(created).Error; err != nil {
		return errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"persist external runtime reset fence",
			err,
		)
	}
	*command = created
	return nil
}

func (s *ExternalRuntimeService) reprepareReset(
	ctx context.Context,
	command *persistence.ExternalRuntimeResetCommand,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return s.reprepareResetTx(tx, command)
	})
}

func (s *ExternalRuntimeService) reprepareResetTx(
	tx *gorm.DB,
	command *persistence.ExternalRuntimeResetCommand,
) error {
	if command.State != persistence.ExternalRuntimeResetPrepared &&
		command.State != persistence.ExternalRuntimeResetCleanupFailed {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"external runtime reset command is not recoverable",
			nil,
		)
	}
	conversation, binding, err := loadExternalBindingForUpdate(
		tx,
		command.Ptid,
		command.ConversationID,
	)
	if err != nil {
		return err
	}
	if err := validateExternalBindingTuple(binding, externalRuntimeBindingTuple{
		SessionID:      command.OldSessionID,
		SessionEpoch:   command.OldSessionEpoch,
		RuntimeHomeRef: command.OldRuntimeHomeRef,
	}); err != nil {
		return err
	}
	now := s.now()
	binding.State = model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_RESET_PREPARED
	binding.LastErrorCode = ""
	binding.UpdatedAt = timestamppb.New(now)
	encoded, err := persistence.MarshalConversationRuntimeBinding(binding)
	if err != nil {
		return err
	}
	if err := tx.Model(&persistence.Conversation{}).
		Where("id = ? AND actor_ptid = ?", conversation.ID, command.Ptid).
		Updates(map[string]interface{}{
			"runtime_binding": encoded,
			"updated_at":      now,
		}).Error; err != nil {
		return err
	}
	if err := tx.Model(&persistence.ExternalRuntimeResetCommand{}).
		Where("id = ? AND reset_fence = ?", command.ID, command.ResetFence).
		Updates(map[string]interface{}{
			"state":                 persistence.ExternalRuntimeResetPrepared,
			"safe_error_code":       "",
			"cleanup_attempt_count": gorm.Expr("cleanup_attempt_count + 1"),
			"updated_at":            now,
		}).Error; err != nil {
		return err
	}
	command.State = persistence.ExternalRuntimeResetPrepared
	command.SafeErrorCode = ""
	command.CleanupAttemptCount++
	command.UpdatedAt = now
	return nil
}

func (s *ExternalRuntimeService) persistCleanupFailure(
	ctx context.Context,
	command *persistence.ExternalRuntimeResetCommand,
	reasonCode string,
) error {
	if command == nil {
		return nil
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		conversation, binding, err := loadExternalBindingForUpdate(
			tx,
			command.Ptid,
			command.ConversationID,
		)
		if err != nil {
			return err
		}
		if err := validateExternalBindingTuple(binding, externalRuntimeBindingTuple{
			SessionID:      command.OldSessionID,
			SessionEpoch:   command.OldSessionEpoch,
			RuntimeHomeRef: command.OldRuntimeHomeRef,
		}); err != nil {
			return err
		}
		now := s.now()
		binding.State = model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_CLEANUP_FAILED
		binding.LastErrorCode = "RUNTIME_CLEANUP_FAILED"
		binding.UpdatedAt = timestamppb.New(now)
		encoded, err := persistence.MarshalConversationRuntimeBinding(binding)
		if err != nil {
			return err
		}
		if err := tx.Model(&persistence.Conversation{}).
			Where("id = ? AND actor_ptid = ?", conversation.ID, command.Ptid).
			Updates(map[string]interface{}{
				"runtime_binding": encoded,
				"updated_at":      now,
			}).Error; err != nil {
			return err
		}
		return tx.Model(&persistence.ExternalRuntimeResetCommand{}).
			Where("id = ? AND reset_fence = ?", command.ID, command.ResetFence).
			Updates(map[string]interface{}{
				"state":           persistence.ExternalRuntimeResetCleanupFailed,
				"safe_error_code": reasonCode,
				"updated_at":      now,
			}).Error
	})
}

func (s *ExternalRuntimeService) commitReset(
	ctx context.Context,
	command *persistence.ExternalRuntimeResetCommand,
) (*ExternalRuntimeResetResult, error) {
	var result *ExternalRuntimeResetResult
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var persistedCommand persistence.ExternalRuntimeResetCommand
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND reset_fence = ?", command.ID, command.ResetFence).
			First(&persistedCommand).Error; err != nil {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"external runtime reset fence is unavailable",
				err,
			)
		}
		if persistedCommand.State == persistence.ExternalRuntimeResetCommitted {
			replayed, err := decodeExternalRuntimeResetResult(
				persistedCommand.ResponseJSON,
			)
			if err != nil {
				return err
			}
			replayed.Replayed = true
			result = replayed
			return nil
		}
		if persistedCommand.State != persistence.ExternalRuntimeResetPrepared {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"external runtime cleanup has not completed",
				nil,
			)
		}
		committed, err := s.commitResetTx(tx, &persistedCommand)
		if err != nil {
			return err
		}
		result = committed
		return nil
	})
	if err == nil && result != nil && s.conversations != nil {
		s.conversations.notifyTurnEvent(
			result.Conversation.ConversationID,
			command.ID,
		)
	}
	return result, err
}

func (s *ExternalRuntimeService) commitResetTx(
	tx *gorm.DB,
	command *persistence.ExternalRuntimeResetCommand,
) (*ExternalRuntimeResetResult, error) {
	conversation, binding, err := loadExternalBindingForUpdate(
		tx,
		command.Ptid,
		command.ConversationID,
	)
	if err != nil {
		return nil, err
	}
	if err := validateExternalBindingTuple(binding, externalRuntimeBindingTuple{
		SessionID:      command.OldSessionID,
		SessionEpoch:   command.OldSessionEpoch,
		RuntimeHomeRef: command.OldRuntimeHomeRef,
	}); err != nil {
		return nil, err
	}
	nextEpoch := command.OldSessionEpoch + 1
	nextHomeRef, err := externalruntime.RuntimeHomeRef(
		command.Ptid,
		command.ConversationID,
		nextEpoch,
	)
	if err != nil {
		return nil, err
	}
	now := s.now()
	binding.ExternalSessionId = ""
	binding.ExternalSessionEpoch = nextEpoch
	binding.RuntimeHomeRef = nextHomeRef
	binding.State = model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_READY
	binding.LastErrorCode = ""
	binding.UpdatedAt = timestamppb.New(now)
	encoded, err := persistence.MarshalConversationRuntimeBinding(binding)
	if err != nil {
		return nil, err
	}
	if err := tx.Model(&persistence.Conversation{}).
		Where("id = ? AND actor_ptid = ?", conversation.ID, command.Ptid).
		Updates(map[string]interface{}{
			"runtime_binding": encoded,
			"updated_at":      now,
			"version":         gorm.Expr("version + 1"),
		}).Error; err != nil {
		return nil, err
	}
	if err := tx.Where("id = ?", conversation.ID).First(conversation).Error; err != nil {
		return nil, err
	}
	converted, err := persistenceConversationToDomain(conversation)
	if err != nil {
		return nil, err
	}
	result := &ExternalRuntimeResetResult{
		Conversation: converted,
		ClosedEpoch:  command.OldSessionEpoch,
	}
	responseJSON, err := encodeExternalRuntimeResetResult(result)
	if err != nil {
		return nil, err
	}
	if err := tx.Model(&persistence.ExternalRuntimeResetCommand{}).
		Where("id = ? AND reset_fence = ?", command.ID, command.ResetFence).
		Updates(map[string]interface{}{
			"state":           persistence.ExternalRuntimeResetCommitted,
			"safe_error_code": "",
			"response_json":   responseJSON,
			"updated_at":      now,
		}).Error; err != nil {
		return nil, err
	}
	if s.conversations != nil {
		payload, _ := json.Marshal(map[string]interface{}{
			"closed_external_session_epoch": command.OldSessionEpoch,
			"external_session_epoch":        nextEpoch,
			"runtime_profile_id":            binding.GetRuntimeProfileId(),
		})
		if _, err := s.conversations.persistTurnEventTx(
			tx,
			conversation.ID,
			command.ID,
			"",
			"runtime_reset",
			payload,
			now,
		); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func rejectExternalRuntimeResetDependencies(
	tx *gorm.DB,
	conversation *persistence.Conversation,
) error {
	if conversation.QueuedTurnCount > 0 {
		return errcode.New(
			errcode.AgentActiveDependency,
			http.StatusConflict,
			"conversation has queued turns",
			nil,
		)
	}
	var activeTurns int64
	if err := tx.Model(&persistence.AgentTurn{}).
		Where("conversation_id = ? AND status IN ?",
			conversation.ID,
			[]string{
				string(domain.TurnStatusRunning),
				string(domain.TurnStatusWaitingLocalTool),
			},
		).
		Count(&activeTurns).Error; err != nil {
		return err
	}
	var queuedTurns int64
	if err := tx.Model(&persistence.TurnQueueEntry{}).
		Where("conversation_id = ? AND status = ?", conversation.ID, queueStatusPending).
		Count(&queuedTurns).Error; err != nil {
		return err
	}
	var unresolvedTools int64
	if err := tx.Model(&persistence.ToolCall{}).
		Joins("JOIN agent_turns ON agent_turns.id = agent_tool_calls.turn_id").
		Where(
			"agent_turns.conversation_id = ? AND agent_tool_calls.status NOT IN ?",
			conversation.ID,
			[]string{
				persistence.ToolCallStatusSucceeded,
				persistence.ToolCallStatusFailed,
				persistence.ToolCallStatusCancelled,
				persistence.ToolCallStatusExpired,
				persistence.ToolCallStatusUnknownSideEffect,
				persistence.ToolCallStatusDenied,
			},
		).
		Count(&unresolvedTools).Error; err != nil {
		return err
	}
	if activeTurns > 0 || queuedTurns > 0 || unresolvedTools > 0 {
		return errcode.New(
			errcode.AgentActiveDependency,
			http.StatusConflict,
			"conversation has active runtime dependencies",
			nil,
		)
	}
	return nil
}
