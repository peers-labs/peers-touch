package service

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/externalruntime"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ConversationDeletionTarget binds a deletion to the revision the caller read.
type ConversationDeletionTarget struct {
	ConversationID  string `json:"conversation_id"`
	ExpectedVersion uint64 `json:"expected_version"`
}

// DeleteConversations commits the entire visible deletion in one transaction.
// External cleanup is irreversible: all reset fences are prepared atomically
// before cleanup, and failed cleanup retains recoverable fences rather than
// restoring bindings that may already refer to removed directories.
func (s *ConversationService) DeleteConversations(
	ctx context.Context,
	ptid string,
	targets []ConversationDeletionTarget,
	runtime *ExternalRuntimeService,
) error {
	return s.deleteConversations(ctx, ptid, targets, runtime, nil, nil)
}

func (s *ConversationService) deleteConversations(
	ctx context.Context,
	ptid string,
	targets []ConversationDeletionTarget,
	runtime *ExternalRuntimeService,
	before func(*gorm.DB) error,
	after func(*gorm.DB) error,
) error {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || (len(targets) == 0 && after == nil) || (len(targets) > 200 && after == nil) {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"actor and between 1 and 200 conversation targets are required", nil)
	}
	targets = append([]ConversationDeletionTarget(nil), targets...)
	for i := range targets {
		targets[i].ConversationID = strings.TrimSpace(targets[i].ConversationID)
	}
	sort.Slice(targets, func(i, j int) bool {
		return targets[i].ConversationID < targets[j].ConversationID
	})
	for i := range targets {
		if targets[i].ConversationID == "" || targets[i].ExpectedVersion == 0 ||
			(i > 0 && targets[i-1].ConversationID == targets[i].ConversationID) {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
				"unique conversation IDs and expected versions are required", nil)
		}
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	commands := make([]*persistence.ExternalRuntimeResetCommand, 0)
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Reset owners lock commands before conversations. Acquire every
		// existing command first so retries preserve that order across the batch.
		existingCommands := make(map[string]*persistence.ExternalRuntimeResetCommand)
		for _, target := range targets {
			if runtime == nil {
				break
			}
			key := deletionResetKey(target)
			var existing persistence.ExternalRuntimeResetCommand
			findErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("ptid = ? AND idempotency_key = ?", ptid, key).
				First(&existing).Error
			if findErr != nil && findErr != gorm.ErrRecordNotFound {
				return findErr
			}
			if findErr == nil {
				existingCommands[key] = &existing
			}
		}
		if before != nil {
			if err := before(tx); err != nil {
				return err
			}
		}
		for _, target := range targets {
			row, err := lockDeletionTarget(tx, ptid, target)
			if err != nil {
				return err
			}
			if err := rejectConversationDeletionDependencies(tx, row.ID); err != nil {
				return err
			}
			binding, err := persistence.UnmarshalConversationRuntimeBinding(row.RuntimeBinding)
			if err != nil {
				return err
			}
			if binding == nil || binding.GetRuntimeKind() != model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT {
				continue
			}
			if runtime == nil || !runtime.Available() {
				return errcode.NewRuntimeUnavailable("external_agent", "adapter_unavailable")
			}
			request := &model.ResetConversationRuntimeRequest{
				ConversationId:              row.ID,
				ExpectedConversationVersion: row.Version,
				ClientIdempotencyKey:        deletionResetKey(target),
				DestructiveConfirmed:        true,
			}
			var command *persistence.ExternalRuntimeResetCommand
			existing := existingCommands[request.ClientIdempotencyKey]
			if existing != nil {
				if existing.PayloadHash != externalRuntimeResetPayloadHash(ptid, request) {
					return errcode.NewAdmissionDuplicateConflict(request.ClientIdempotencyKey, existing.ID)
				}
				if err := runtime.reprepareResetTx(tx, existing); err != nil {
					return err
				}
				command = existing
			} else {
				if err := runtime.prepareNewResetTx(tx, ptid, request,
					externalRuntimeResetPayloadHash(ptid, request), &command); err != nil {
					return err
				}
			}
			commands = append(commands, command)
		}
		return nil
	})
	if err != nil {
		return err
	}
	for _, command := range commands {
		if err := runtime.manager.Cleanup(ctx, externalruntime.CleanupRequest{
			RuntimeHomeRef: command.OldRuntimeHomeRef,
			SessionID:      command.OldSessionID,
		}); err != nil {
			// Every external member remains fenced, including already cleaned
			// members. Recovery uses the existing reset command owner.
			for _, pending := range commands {
				if persistErr := runtime.persistCleanupFailure(context.WithoutCancel(ctx),
					pending, "batch_deletion_cleanup_incomplete"); persistErr != nil {
					return persistErr
				}
			}
			return errcode.NewRuntimeUnavailable("external_agent", "cleanup_failed")
		}
	}
	return db.WithContext(context.WithoutCancel(ctx)).Transaction(func(tx *gorm.DB) error {
		for _, command := range commands {
			var persisted persistence.ExternalRuntimeResetCommand
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ? AND state = ?", command.ID, persistence.ExternalRuntimeResetPrepared).
				First(&persisted).Error; err != nil {
				return err
			}
		}
		if before != nil {
			if err := before(tx); err != nil {
				return err
			}
		}
		for _, target := range targets {
			if _, err := lockDeletionTarget(tx, ptid, target); err != nil {
				return err
			}
			if err := rejectConversationDeletionDependencies(tx, target.ConversationID); err != nil {
				return err
			}
		}
		for _, command := range commands {
			if _, err := runtime.commitResetTx(tx, command); err != nil {
				return err
			}
		}
		ids := make([]string, len(targets))
		for i, target := range targets {
			ids[i] = target.ConversationID
		}
		if len(ids) > 0 {
			if err := tx.Model(&persistence.Conversation{}).
				Where("id IN ? AND actor_ptid = ?", ids, ptid).
				Updates(map[string]interface{}{
					"status":  string(domain.ConversationStatusDeleted),
					"version": gorm.Expr("version + 1"),
				}).Error; err != nil {
				return err
			}
		}
		if after != nil {
			return after(tx)
		}
		return nil
	})
}

func deletionResetKey(target ConversationDeletionTarget) string {
	return "conversation-delete:" + target.ConversationID + ":" +
		strconv.FormatUint(target.ExpectedVersion, 10)
}

func lockDeletionTarget(tx *gorm.DB, ptid string, target ConversationDeletionTarget) (*persistence.Conversation, error) {
	var row persistence.Conversation
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND actor_ptid = ? AND version = ?", target.ConversationID, ptid, target.ExpectedVersion).
		First(&row).Error; err != nil {
		return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
			"conversation missing, not owned, or version changed", err)
	}
	if row.Status == string(domain.ConversationStatusDeleted) {
		return nil, errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
			"deleted conversation cannot be mutated", nil)
	}
	return &row, nil
}

func getVisibleAgentForConversationTx(tx *gorm.DB, ptid, agentID string) (*persistence.Agent, error) {
	var agent persistence.Agent
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND (owner_actor_ptid = ? OR visibility = ?)", agentID, ptid,
			string(domain.AgentVisibilityWorkspace)).First(&agent).Error; err != nil {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound,
			"Agent is unavailable for conversation creation", err)
	}
	return &agent, nil
}
