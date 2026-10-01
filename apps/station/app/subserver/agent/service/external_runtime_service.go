package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/externalruntime"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type externalRuntimeManager interface {
	Available() bool
	Execute(
		context.Context,
		externalruntime.ExecuteRequest,
		externalruntime.DeltaSink,
		externalruntime.SessionSink,
		externalruntime.ActivitySink,
	) (*externalruntime.ExecuteResult, error)
	Cleanup(context.Context, externalruntime.CleanupRequest) error
}

type ExternalRuntimeService struct {
	db            *gorm.DB
	manager       externalRuntimeManager
	evidence      *RuntimeEvidenceService
	conversations *ConversationService
	now           func() time.Time
	resetLocksMu  sync.Mutex
	resetLocks    map[string]*externalRuntimeResetLock
}

type externalRuntimeResetLock struct {
	mu   sync.Mutex
	refs int
}

type ExternalRuntimeTurnRequest struct {
	ActorPTID        string
	AgentID          string
	ConversationID   string
	AttemptID        string
	RuntimeProfileID string
	SystemPrompt     string
	UserInput        string
}

type externalRuntimeBindingTuple struct {
	RuntimeProfileID string
	SessionID        string
	SessionEpoch     uint64
	RuntimeHomeRef   string
}

func NewExternalRuntimeService(
	db *gorm.DB,
	manager externalRuntimeManager,
	evidence *RuntimeEvidenceService,
	conversations *ConversationService,
) *ExternalRuntimeService {
	return &ExternalRuntimeService{
		db:            db,
		manager:       manager,
		evidence:      evidence,
		conversations: conversations,
		now:           func() time.Time { return time.Now().UTC() },
		resetLocks:    make(map[string]*externalRuntimeResetLock),
	}
}

func (s *ExternalRuntimeService) acquireResetLock(
	actorPTID string,
	idempotencyKey string,
) func() {
	key := strings.TrimSpace(actorPTID) + "\x00" +
		strings.TrimSpace(idempotencyKey)
	s.resetLocksMu.Lock()
	entry := s.resetLocks[key]
	if entry == nil {
		entry = &externalRuntimeResetLock{}
		s.resetLocks[key] = entry
	}
	entry.refs++
	s.resetLocksMu.Unlock()

	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()
		s.resetLocksMu.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(s.resetLocks, key)
		}
		s.resetLocksMu.Unlock()
	}
}

func (s *ExternalRuntimeService) Available() bool {
	return s != nil && s.db != nil && s.manager != nil && s.manager.Available()
}

func (s *ExternalRuntimeService) ValidateTurnAdmission(
	ctx context.Context,
	actorPTID string,
	conversationID string,
	runtimeKind model.RuntimeKind,
) error {
	if runtimeKind != model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT ||
		strings.TrimSpace(conversationID) == "" {
		return nil
	}
	if !s.Available() {
		return errcode.NewRuntimeUnavailable("external_agent", "adapter_unavailable")
	}
	var row persistence.Conversation
	err := s.db.WithContext(ctx).
		Select("runtime_binding").
		Where("id = ? AND actor_ptid = ?", conversationID, actorPTID).
		Take(&row).Error
	if err == gorm.ErrRecordNotFound {
		return nil
	}
	if err != nil {
		return errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"load external runtime admission state",
			err,
		)
	}
	binding, err := persistence.UnmarshalConversationRuntimeBinding(row.RuntimeBinding)
	if err != nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"external runtime binding is invalid",
			err,
		)
	}
	if binding == nil {
		return nil
	}
	if binding.GetRuntimeKind() != model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT {
		return errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"conversation is bound to a different runtime",
			nil,
		)
	}
	return externalBindingAdmissionError(binding)
}

func (s *ExternalRuntimeService) ExecuteTurn(
	ctx context.Context,
	request ExternalRuntimeTurnRequest,
	deltaSink externalruntime.DeltaSink,
) (*externalruntime.ExecuteResult, error) {
	if !s.Available() {
		return nil, errcode.NewRuntimeUnavailable("external_agent", "adapter_unavailable")
	}
	binding, err := s.loadExecutionBinding(ctx, request)
	if err != nil {
		return nil, err
	}
	prompt := strings.TrimSpace(request.UserInput)
	if binding.SessionID == "" && strings.TrimSpace(request.SystemPrompt) != "" {
		prompt = strings.TrimSpace(request.SystemPrompt) + "\n\nUser:\n" + prompt
	}
	result, err := s.manager.Execute(
		ctx,
		externalruntime.ExecuteRequest{
			ActorPTID:        request.ActorPTID,
			AgentID:          request.AgentID,
			ConversationID:   request.ConversationID,
			RuntimeProfileID: request.RuntimeProfileID,
			RuntimeHomeRef:   binding.RuntimeHomeRef,
			SessionID:        binding.SessionID,
			SessionEpoch:     binding.SessionEpoch,
			Prompt:           prompt,
		},
		deltaSink,
		func(sessionCtx context.Context, sessionID string) error {
			return s.persistCreatedSession(sessionCtx, request, binding, sessionID)
		},
		func(activity externalruntime.ActivityKind) {
			s.recordActivity(request.ActorPTID, activity)
		},
	)
	if err == nil {
		return result, nil
	}
	if externalruntime.IsFailureKind(err, externalruntime.FailureResumeUnavailable) {
		if persistErr := s.persistResumeUnavailable(
			context.WithoutCancel(ctx),
			request.ActorPTID,
			request.ConversationID,
			binding,
		); persistErr != nil {
			return nil, errors.Join(err, persistErr)
		}
		return nil, errcode.NewRuntimeResumeUnavailable(
			request.RuntimeProfileID,
			"session_not_found",
		)
	}
	return nil, errcode.NewRuntimeUnavailable(
		"external_agent",
		externalRuntimeFailureReason(err),
	)
}

func (s *ExternalRuntimeService) loadExecutionBinding(
	ctx context.Context,
	request ExternalRuntimeTurnRequest,
) (externalRuntimeBindingTuple, error) {
	if strings.TrimSpace(request.ActorPTID) == "" ||
		strings.TrimSpace(request.AgentID) == "" ||
		strings.TrimSpace(request.ConversationID) == "" ||
		strings.TrimSpace(request.AttemptID) == "" ||
		strings.TrimSpace(request.RuntimeProfileID) == "" ||
		strings.TrimSpace(request.UserInput) == "" {
		return externalRuntimeBindingTuple{}, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"external runtime execution request is incomplete",
			nil,
		)
	}
	var row persistence.Conversation
	if err := s.db.WithContext(ctx).
		Where(
			"id = ? AND actor_ptid = ? AND agent_id = ?",
			request.ConversationID,
			request.ActorPTID,
			request.AgentID,
		).
		First(&row).Error; err != nil {
		return externalRuntimeBindingTuple{}, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"external runtime conversation binding is unavailable",
			err,
		)
	}
	binding, err := persistence.UnmarshalConversationRuntimeBinding(row.RuntimeBinding)
	if err != nil || binding == nil {
		return externalRuntimeBindingTuple{}, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"external runtime conversation binding is invalid",
			err,
		)
	}
	if err := validateExternalBindingReady(binding, request.RuntimeProfileID); err != nil {
		return externalRuntimeBindingTuple{}, err
	}
	return bindingTuple(binding), nil
}

func (s *ExternalRuntimeService) validatePinnedBinding(
	ctx context.Context,
	actorPTID string,
	conversationID string,
	snapshot *model.RuntimeSnapshot,
) error {
	if !s.Available() || snapshot == nil {
		return errcode.NewRuntimeUnavailable("external_agent", "adapter_unavailable")
	}
	var row persistence.Conversation
	if err := s.db.WithContext(ctx).
		Select("runtime_binding").
		Where("id = ? AND actor_ptid = ?", conversationID, actorPTID).
		Take(&row).Error; err != nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"external runtime binding is unavailable",
			err,
		)
	}
	binding, err := persistence.UnmarshalConversationRuntimeBinding(row.RuntimeBinding)
	if err != nil || binding == nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"external runtime binding is invalid",
			err,
		)
	}
	if err := validateExternalBindingReady(
		binding,
		snapshot.GetRuntimeProfileId(),
	); err != nil {
		return err
	}
	if binding.GetProviderId() != snapshot.GetProviderId() ||
		binding.GetModelId() != snapshot.GetModelId() ||
		binding.GetExternalSessionId() != snapshot.GetExternalSessionId() ||
		binding.GetExternalSessionEpoch() != snapshot.GetExternalSessionEpoch() {
		return errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"external runtime snapshot differs from its conversation binding",
			nil,
		)
	}
	return nil
}

func (s *ExternalRuntimeService) persistCreatedSession(
	ctx context.Context,
	request ExternalRuntimeTurnRequest,
	expected externalRuntimeBindingTuple,
	sessionID string,
) error {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"external runtime returned an empty session",
			nil,
		)
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		conversation, binding, err := loadExternalBindingForUpdate(
			tx,
			request.ActorPTID,
			request.ConversationID,
		)
		if err != nil {
			return err
		}
		if err := validateExternalBindingTuple(binding, expected); err != nil {
			return err
		}
		if binding.GetExternalSessionId() != "" {
			if binding.GetExternalSessionId() == sessionID {
				return nil
			}
			return errcode.New(
				errcode.AgentVersionConflict,
				http.StatusConflict,
				"external runtime session changed during creation",
				nil,
			)
		}

		var attempt persistence.TurnAttempt
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"id = ? AND turn_id IN (?)",
				request.AttemptID,
				tx.Model(&persistence.AgentTurn{}).
					Select("id").
					Where("conversation_id = ?", request.ConversationID),
			).
			First(&attempt).Error; err != nil {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"external runtime attempt is unavailable",
				err,
			)
		}
		snapshot, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
		if err != nil || snapshot == nil ||
			snapshot.GetRuntimeKind() != model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT ||
			snapshot.GetExternalSessionEpoch() != expected.SessionEpoch {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"external runtime attempt snapshot is invalid",
				err,
			)
		}

		now := s.now()
		binding.ExternalSessionId = sessionID
		binding.LastErrorCode = ""
		binding.UpdatedAt = timestamppb.New(now)
		encodedBinding, err := persistence.MarshalConversationRuntimeBinding(binding)
		if err != nil {
			return err
		}
		snapshot.ExternalSessionId = sessionID
		encodedSnapshot, err := persistence.MarshalRuntimeSnapshot(snapshot)
		if err != nil {
			return err
		}
		snapshotHash, err := runtimeSnapshotHash(snapshot)
		if err != nil {
			return err
		}
		if err := tx.Model(&persistence.TurnAttempt{}).
			Where("id = ?", attempt.ID).
			Updates(map[string]interface{}{
				"runtime_snapshot":      encodedSnapshot,
				"runtime_snapshot_hash": snapshotHash,
			}).Error; err != nil {
			return err
		}
		result := tx.Model(&persistence.Conversation{}).
			Where("id = ? AND actor_ptid = ?", conversation.ID, request.ActorPTID).
			Updates(map[string]interface{}{
				"runtime_binding": encodedBinding,
				"updated_at":      now,
				"version":         gorm.Expr("version + 1"),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errcode.New(
				errcode.AgentVersionConflict,
				http.StatusConflict,
				"external runtime session binding changed during creation",
				nil,
			)
		}
		return nil
	})
}

func (s *ExternalRuntimeService) persistResumeUnavailable(
	ctx context.Context,
	actorPTID string,
	conversationID string,
	expected externalRuntimeBindingTuple,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		conversation, binding, err := loadExternalBindingForUpdate(
			tx,
			actorPTID,
			conversationID,
		)
		if err != nil {
			return err
		}
		if err := validateExternalBindingTuple(binding, expected); err != nil {
			return err
		}
		now := s.now()
		binding.State = model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_RESUME_UNAVAILABLE
		binding.LastErrorCode = string(errcode.AgentRuntimeResumeUnavailable)
		binding.UpdatedAt = timestamppb.New(now)
		encoded, err := persistence.MarshalConversationRuntimeBinding(binding)
		if err != nil {
			return err
		}
		result := tx.Model(&persistence.Conversation{}).
			Where("id = ? AND actor_ptid = ?", conversation.ID, actorPTID).
			Updates(map[string]interface{}{
				"runtime_binding": encoded,
				"updated_at":      now,
				"version":         gorm.Expr("version + 1"),
			})
		return result.Error
	})
}

func loadExternalBindingForUpdate(
	tx *gorm.DB,
	actorPTID string,
	conversationID string,
) (*persistence.Conversation, *model.ConversationRuntimeBinding, error) {
	var conversation persistence.Conversation
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND actor_ptid = ?", conversationID, actorPTID).
		First(&conversation).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil, errcode.New(
				errcode.AgentNotFound,
				http.StatusNotFound,
				"conversation not found",
				err,
			)
		}
		return nil, nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"load external runtime conversation",
			err,
		)
	}
	binding, err := persistence.UnmarshalConversationRuntimeBinding(
		conversation.RuntimeBinding,
	)
	if err != nil || binding == nil {
		return nil, nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"external runtime binding is unavailable",
			err,
		)
	}
	return &conversation, binding, nil
}

func validateExternalBindingReady(
	binding *model.ConversationRuntimeBinding,
	runtimeProfileID string,
) error {
	if binding.GetRuntimeKind() != model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT ||
		binding.GetRuntimeProfileId() != strings.TrimSpace(runtimeProfileID) ||
		binding.GetExternalSessionEpoch() == 0 ||
		strings.TrimSpace(binding.GetRuntimeHomeRef()) == "" {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"external runtime binding is incomplete",
			nil,
		)
	}
	return externalBindingAdmissionError(binding)
}

func externalBindingAdmissionError(
	binding *model.ConversationRuntimeBinding,
) error {
	switch binding.GetState() {
	case model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_READY:
		return nil
	case model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_RESUME_UNAVAILABLE:
		return errcode.NewRuntimeResumeUnavailable(
			binding.GetRuntimeProfileId(),
			"reset_required",
		)
	case model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_RESET_PREPARED:
		return errcode.NewRuntimeUnavailable("external_agent", "reset_in_progress")
	case model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_CLEANUP_FAILED:
		return errcode.NewRuntimeUnavailable("external_agent", "cleanup_retry_required")
	default:
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"external runtime binding state is invalid",
			nil,
		)
	}
}

func validateExternalBindingTuple(
	binding *model.ConversationRuntimeBinding,
	expected externalRuntimeBindingTuple,
) error {
	if binding.GetRuntimeKind() != model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT ||
		(expected.RuntimeProfileID != "" &&
			binding.GetRuntimeProfileId() != expected.RuntimeProfileID) ||
		binding.GetExternalSessionId() != expected.SessionID ||
		binding.GetExternalSessionEpoch() != expected.SessionEpoch ||
		binding.GetRuntimeHomeRef() != expected.RuntimeHomeRef {
		return errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"external runtime binding changed",
			nil,
		)
	}
	return nil
}

func bindingTuple(
	binding *model.ConversationRuntimeBinding,
) externalRuntimeBindingTuple {
	return externalRuntimeBindingTuple{
		RuntimeProfileID: binding.GetRuntimeProfileId(),
		SessionID:        binding.GetExternalSessionId(),
		SessionEpoch:     binding.GetExternalSessionEpoch(),
		RuntimeHomeRef:   binding.GetRuntimeHomeRef(),
	}
}

func (s *ExternalRuntimeService) recordActivity(
	actorPTID string,
	activity externalruntime.ActivityKind,
) {
	if s == nil || s.evidence == nil {
		return
	}
	var kind RuntimeActivityKind
	switch activity {
	case externalruntime.ActivityRuntimeHomeCreated:
		kind = RuntimeActivityHomeCreated
	case externalruntime.ActivityProcessStarted:
		kind = RuntimeActivityProcessStarted
	case externalruntime.ActivitySessionCreated:
		kind = RuntimeActivityExternalSessionCreated
	default:
		return
	}
	_ = s.evidence.RecordActivity(
		actorPTID,
		model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT,
		runtimeIDExternalAgent,
		kind,
	)
}

func (s *ExternalRuntimeService) RecordBindingCreated(actorPTID string) {
	if s == nil || s.evidence == nil {
		return
	}
	_ = s.evidence.RecordActivity(
		actorPTID,
		model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT,
		runtimeIDExternalAgent,
		RuntimeActivityBindingCreated,
	)
}

func externalRuntimeFailureReason(err error) string {
	for kind, reason := range map[externalruntime.FailureKind]string{
		externalruntime.FailureUnavailable:   "adapter_unavailable",
		externalruntime.FailureInvalidConfig: "adapter_invalid_config",
		externalruntime.FailureStart:         "process_start_failed",
		externalruntime.FailureOutput:        "invalid_runtime_output",
		externalruntime.FailureTimeout:       "runtime_timeout",
		externalruntime.FailureExit:          "runtime_execution_failed",
		externalruntime.FailureEmptyResponse: "runtime_empty_response",
		externalruntime.FailureCleanup:       "cleanup_failed",
	} {
		if externalruntime.IsFailureKind(err, kind) {
			return reason
		}
	}
	return "runtime_execution_failed"
}
