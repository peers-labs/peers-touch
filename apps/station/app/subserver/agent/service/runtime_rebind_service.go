package service

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

// RuntimeRebindResult carries the conversation whose runtime binding was
// released so the next turn re-admits against the current default runtime.
type RuntimeRebindResult struct {
	Conversation *domain.Conversation
}

// RebindConversationRuntime releases the immutable conversation runtime
// binding for a DIRECT_MODEL conversation whose bound provider/model has been
// retired (RUNTIME_BINDING_STALE). It mirrors an explicit, user-confirmed model
// switch: the conversation-level "current runtime" pointer is cleared while
// every historical turn keeps its own immutable runtime_snapshot in
// agent_turn_attempts. The next turn re-admits through the same first-binding
// path used by a brand-new conversation. The change is audited as a
// runtime_rebind turn event recording the previous tuple.
//
// EXTERNAL_AGENT conversations intentionally reject this path: they own
// external session state and must use ResetConversationRuntime instead.
func (s *ConversationService) RebindConversationRuntime(
	ctx context.Context,
	actorPTID string,
	conversationID string,
	expectedVersion uint64,
) (*RuntimeRebindResult, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	conversationID = strings.TrimSpace(conversationID)
	if actorPTID == "" || conversationID == "" || expectedVersion == 0 {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"runtime rebind requires actor, conversation_id and expected_conversation_version",
			nil,
		)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var result RuntimeRebindResult
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var conversation persistence.Conversation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND actor_ptid = ?", conversationID, actorPTID).
			First(&conversation).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return errcode.New(
					errcode.AgentNotFound,
					http.StatusNotFound,
					"conversation not found for runtime rebind",
					err,
				)
			}
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"load conversation for runtime rebind", err)
		}
		if conversation.Status == string(domain.ConversationStatusDeleted) {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"deleted conversation cannot rebind its runtime",
				nil,
			)
		}
		if conversation.Version != expectedVersion {
			return errcode.NewLifecycleStaleVersion(
				conversation.ID,
				expectedVersion,
				conversation.Version,
			)
		}
		// Nothing bound yet: re-binding is a no-op success so retries are safe.
		if len(conversation.RuntimeBinding) == 0 {
			converted, convertErr := persistenceConversationToDomain(&conversation)
			if convertErr != nil {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
					"convert conversation after rebind no-op", convertErr)
			}
			result.Conversation = converted
			return nil
		}
		binding, decodeErr := persistence.UnmarshalConversationRuntimeBinding(
			conversation.RuntimeBinding,
		)
		if decodeErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"decode conversation runtime binding for rebind", decodeErr)
		}
		if binding.GetRuntimeKind() == model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"external runtime conversations must use runtime reset, not rebind",
				nil,
			)
		}

		previous := map[string]string{
			"runtime_kind": binding.GetRuntimeKind().String(),
			"provider_id":  binding.GetProviderId(),
			"model_id":     binding.GetModelId(),
		}
		now := time.Now().UTC()
		updateResult := tx.Model(&persistence.Conversation{}).
			Where(
				"id = ? AND actor_ptid = ? AND version = ?",
				conversation.ID,
				actorPTID,
				expectedVersion,
			).
			Updates(map[string]interface{}{
				"runtime_binding": nil,
				"version":         gorm.Expr("version + 1"),
				"updated_at":      now,
			})
		if updateResult.Error != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"release conversation runtime binding", updateResult.Error)
		}
		if updateResult.RowsAffected != 1 {
			return errcode.NewLifecycleStaleVersion(
				conversation.ID,
				expectedVersion,
				conversation.Version,
			)
		}

		payload, marshalErr := json.Marshal(map[string]interface{}{
			"event":    "runtime_rebind",
			"previous": previous,
			"reason":   "bound provider/model no longer present in the actor catalog",
		})
		if marshalErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"encode runtime rebind audit event", marshalErr)
		}
		if _, eventErr := s.persistTurnEventTx(
			tx,
			conversation.ID,
			"",
			"",
			"runtime_rebind",
			payload,
			now,
		); eventErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"persist runtime rebind audit event", eventErr)
		}

		if err := tx.Where("id = ?", conversation.ID).First(&conversation).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"reload conversation after runtime rebind", err)
		}
		converted, convertErr := persistenceConversationToDomain(&conversation)
		if convertErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"convert conversation after runtime rebind", convertErr)
		}
		result.Conversation = converted
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}
