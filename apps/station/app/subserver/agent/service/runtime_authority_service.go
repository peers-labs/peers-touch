package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// #region debug-point A-D:normal-send-runtime-authority
func reportNormalSendRuntimeAuthorityDebug(
	hypothesisID string,
	stage string,
	err error,
	data map[string]interface{},
) {
	eventData := map[string]interface{}{
		"failed": err != nil,
	}
	var businessError *errcode.BizError
	if errors.As(err, &businessError) {
		eventData["errorCode"] = string(businessError.Code)
		eventData["httpStatus"] = businessError.HTTPStatus
	}
	for key, value := range data {
		eventData[key] = value
	}
	event, marshalErr := json.Marshal(map[string]interface{}{
		"sessionId":    "normal-send-runtime-authority",
		"runId":        "pre-fix",
		"hypothesisId": hypothesisID,
		"location":     "runtime_authority_service.go:persistRuntimeAuthority",
		"msg":          "[DEBUG] " + stage,
		"data":         eventData,
		"ts":           time.Now().UnixMilli(),
	})
	if marshalErr != nil {
		return
	}
	go func() {
		request, requestErr := http.NewRequest(
			http.MethodPost,
			"http://10.4.41.27:7778/event",
			bytes.NewReader(event),
		)
		if requestErr != nil {
			return
		}
		request.Header.Set("Content-Type", "application/json")
		response, requestErr := (&http.Client{
			Timeout: 500 * time.Millisecond,
		}).Do(request)
		if requestErr == nil {
			_ = response.Body.Close()
		}
	}()
}

// #endregion

func MigrateRuntimeSnapshotThinkingModes(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("runtime snapshot thinking-mode migration requires database")
	}
	if !db.Migrator().HasTable(&persistence.TurnAttempt{}) {
		return nil
	}

	return db.Transaction(func(tx *gorm.DB) error {
		var attempts []persistence.TurnAttempt
		if err := tx.Where("runtime_snapshot IS NOT NULL").
			Find(&attempts).Error; err != nil {
			return fmt.Errorf("load runtime snapshots for thinking-mode migration: %w", err)
		}
		for index := range attempts {
			if len(attempts[index].RuntimeSnapshot) == 0 {
				continue
			}
			snapshot, err := persistence.UnmarshalRuntimeSnapshot(
				attempts[index].RuntimeSnapshot,
			)
			if err != nil {
				return fmt.Errorf(
					"decode runtime snapshot %s for thinking-mode migration: %w",
					attempts[index].ID,
					err,
				)
			}
			if strings.TrimSpace(snapshot.GetThinkingMode()) != "" {
				continue
			}
			snapshot.ThinkingMode = string(domain.ThinkingModeAuto)
			encoded, err := persistence.MarshalRuntimeSnapshot(snapshot)
			if err != nil {
				return fmt.Errorf(
					"encode runtime snapshot %s for thinking-mode migration: %w",
					attempts[index].ID,
					err,
				)
			}
			hash, err := runtimeSnapshotHash(snapshot)
			if err != nil {
				return fmt.Errorf(
					"hash runtime snapshot %s for thinking-mode migration: %w",
					attempts[index].ID,
					err,
				)
			}
			if err := tx.Model(&persistence.TurnAttempt{}).
				Where("id = ?", attempts[index].ID).
				Updates(map[string]interface{}{
					"runtime_snapshot":      encoded,
					"runtime_snapshot_hash": hash,
				}).Error; err != nil {
				return fmt.Errorf(
					"persist runtime snapshot %s thinking-mode migration: %w",
					attempts[index].ID,
					err,
				)
			}
		}
		return nil
	})
}

func (s *TurnService) persistRuntimeAuthority(
	ctx context.Context,
	config *TurnConfig,
	admission *AdmissionSnapshot,
	readiness *model.CapabilityReadinessSnapshot,
	expectedAgentVersion uint64,
) (resultErr error) {
	debugStage := "preflight"
	defer func() {
		reportNormalSendRuntimeAuthorityDebug(
			"A-D",
			debugStage,
			resultErr,
			map[string]interface{}{
				"completed": resultErr == nil,
			},
		)
	}()
	reportNormalSendRuntimeAuthorityDebug(
		"C",
		"preflight-shape",
		nil,
		map[string]interface{}{
			"configPresent":          config != nil,
			"admissionPresent":       admission != nil,
			"readinessPresent":       readiness != nil,
			"attemptPresent":         config != nil && strings.TrimSpace(config.AttemptID) != "",
			"readinessSnapshot":      readiness != nil && strings.TrimSpace(readiness.GetSnapshotId()) != "",
			"agentVersionPresent":    expectedAgentVersion != 0,
			"actorMatches":           config != nil && readiness != nil && readiness.GetPtid() == config.ActorID,
			"agentMatches":           config != nil && readiness != nil && readiness.GetAgentId() == config.AgentID,
			"runtimeSnapshotMatches": admission != nil && readiness != nil && readiness.GetRuntimeSnapshotId() == admission.SnapshotID,
			"clientSessionMatches": config != nil && readiness != nil &&
				(readiness.GetSelectedClientSessionId() == "" ||
					readiness.GetSelectedClientSessionId() == config.ClientCapabilitySessionID),
		},
	)
	if config == nil || admission == nil || readiness == nil ||
		strings.TrimSpace(config.AttemptID) == "" ||
		strings.TrimSpace(readiness.GetSnapshotId()) == "" ||
		expectedAgentVersion == 0 {
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"runtime authority requires turn config, admission, readiness, agent version, and attempt",
			nil,
		)
	}
	if admission.Capabilities == nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime admission returned no capability snapshot",
			nil,
		)
	}
	if err := validateRuntimeCapabilityProvenance(
		admission.Capabilities,
		time.Now().UTC(),
	); err != nil {
		return err
	}
	if readiness.GetPtid() != config.ActorID ||
		readiness.GetAgentId() != config.AgentID ||
		readiness.GetRuntimeSnapshotId() != admission.SnapshotID {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"capability readiness does not match the admitted turn",
			nil,
		)
	}
	if selectedSessionID := readiness.GetSelectedClientSessionId(); selectedSessionID != "" &&
		selectedSessionID != config.ClientCapabilitySessionID {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"capability readiness selected client session does not match the turn",
			nil,
		)
	}
	debugStage = "database-open"
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		debugStage = "conversation-load"
		var conversation persistence.Conversation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"id = ? AND actor_ptid = ? AND agent_id = ?",
				config.ConversationID,
				config.ActorID,
				config.AgentID,
			).
			First(&conversation).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return errcode.New(
					errcode.AgentSecurityViolation,
					http.StatusForbidden,
					"runtime binding requires the owned conversation",
					err,
				)
			}
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"load conversation runtime binding", err)
		}
		reportNormalSendRuntimeAuthorityDebug(
			"A",
			"conversation-loaded",
			nil,
			map[string]interface{}{
				"bindingPresent": len(conversation.RuntimeBinding) > 0,
			},
		)

		debugStage = "agent-version-check"
		agentVersion, err := loadAgentConfigVersionTx(tx, config.ActorID, config.AgentID)
		if err != nil {
			return err
		}
		reportNormalSendRuntimeAuthorityDebug(
			"B",
			"agent-version-loaded",
			nil,
			map[string]interface{}{
				"agentVersionMatches": uint64(agentVersion) == expectedAgentVersion,
			},
		)
		if uint64(agentVersion) != expectedAgentVersion {
			return errcode.New(
				errcode.AgentVersionConflict,
				http.StatusConflict,
				"agent revision changed during turn admission",
				nil,
			)
		}
		snapshot := newDirectRuntimeSnapshot(
			admission,
			fmt.Sprintf("%d", agentVersion),
			config.ThinkingMode,
		)
		snapshot.Budget = cloneRuntimeBudget(config.RuntimeBudget)
		if snapshot.Budget == nil {
			snapshot.Budget = cloneRuntimeBudget(admission.Budget)
		}
		if snapshot.Budget == nil {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"runtime admission returned no effective budget",
				nil,
			)
		}

		var binding *model.ConversationRuntimeBinding
		if len(conversation.RuntimeBinding) == 0 {
			debugStage = "binding-install"
			binding, err = newConversationRuntimeBinding(snapshot, time.Now().UTC())
			if err != nil {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
					"build conversation runtime binding", err)
			}
			encodedBinding, encodeErr := persistence.MarshalConversationRuntimeBinding(binding)
			if encodeErr != nil {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
					"encode conversation runtime binding", encodeErr)
			}
			result := tx.Model(&persistence.Conversation{}).
				Where(
					"id = ? AND actor_ptid = ? AND (runtime_binding IS NULL OR length(runtime_binding) = 0)",
					conversation.ID,
					conversation.ActorPTID,
				).
				Updates(map[string]interface{}{
					"runtime_binding": encodedBinding,
					"updated_at":      time.Now().UTC(),
				})
			if result.Error != nil {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
					"persist conversation runtime binding", result.Error)
			}
			if result.RowsAffected != 1 {
				return errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
					"conversation runtime binding changed during installation", nil)
			}
		} else {
			debugStage = "binding-reconcile"
			binding, err = persistence.UnmarshalConversationRuntimeBinding(conversation.RuntimeBinding)
			if err != nil {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
					"decode conversation runtime binding", err)
			}
			snapshot, err = reconcileBoundRuntimeSnapshotTx(tx, conversation.ID, binding, snapshot)
			if err != nil {
				return err
			}
		}

		debugStage = "attempt-snapshot-build"
		encodedSnapshot, err := persistence.MarshalRuntimeSnapshot(snapshot)
		if err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"encode turn attempt runtime snapshot", err)
		}
		snapshotHash, err := runtimeSnapshotHash(snapshot)
		if err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"hash turn attempt runtime snapshot", err)
		}
		var persistedAttempt persistence.TurnAttempt
		debugStage = "attempt-load"
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Table("agent_turn_attempts AS attempts").
			Select("attempts.*").
			Joins("JOIN agent_turns AS turns ON turns.id = attempts.turn_id").
			Where(
				"attempts.id = ? AND turns.conversation_id = ?",
				config.AttemptID,
				conversation.ID,
			).
			First(&persistedAttempt).Error; err != nil {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"turn attempt does not belong to the admitted conversation",
				err,
			)
		}
		reportNormalSendRuntimeAuthorityDebug(
			"D",
			"attempt-loaded",
			nil,
			map[string]interface{}{
				"runtimeSnapshotPresent": len(persistedAttempt.RuntimeSnapshot) > 0,
				"readinessSnapshotPresent": strings.TrimSpace(
					persistedAttempt.ReadinessSnapshotID,
				) != "",
			},
		)
		if len(persistedAttempt.RuntimeSnapshot) > 0 {
			debugStage = "attempt-immutability-check"
			persistedSnapshot, err := persistence.UnmarshalRuntimeSnapshot(
				persistedAttempt.RuntimeSnapshot,
			)
			if err != nil {
				return errcode.New(
					errcode.AgentInvalidSourceState,
					http.StatusConflict,
					"persisted turn attempt runtime authority is invalid",
					err,
				)
			}
			persistedHash, err := runtimeSnapshotHash(persistedSnapshot)
			if err != nil ||
				persistedAttempt.RuntimeSnapshotHash != persistedHash {
				return errcode.New(
					errcode.AgentInvalidSourceState,
					http.StatusConflict,
					"persisted turn attempt runtime authority failed integrity validation",
					err,
				)
			}
			reportNormalSendRuntimeAuthorityDebug(
				"D",
				"attempt-immutability-compared",
				nil,
				map[string]interface{}{
					"integrityMatches":         persistedAttempt.RuntimeSnapshotHash == persistedHash,
					"runtimeSnapshotMatches":   persistedHash == snapshotHash,
					"readinessSnapshotMatches": persistedAttempt.ReadinessSnapshotID == readiness.GetSnapshotId(),
				},
			)
			if persistedHash != snapshotHash ||
				persistedAttempt.ReadinessSnapshotID != readiness.GetSnapshotId() {
				return errcode.New(
					errcode.AgentVersionConflict,
					http.StatusConflict,
					"turn attempt runtime authority is immutable",
					nil,
				)
			}
			return nil
		}
		debugStage = "attempt-snapshot-insert"
		result := tx.Model(&persistence.TurnAttempt{}).
			Where("id = ? AND runtime_snapshot IS NULL", config.AttemptID).
			Updates(map[string]interface{}{
				"runtime_snapshot":      encodedSnapshot,
				"runtime_snapshot_hash": snapshotHash,
				"readiness_snapshot_id": readiness.GetSnapshotId(),
			})
		if result.Error != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"persist turn attempt runtime snapshot", result.Error)
		}
		reportNormalSendRuntimeAuthorityDebug(
			"D",
			"attempt-snapshot-inserted",
			nil,
			map[string]interface{}{
				"rowsAffected": result.RowsAffected,
			},
		)
		if result.RowsAffected != 1 {
			return errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
				"turn attempt does not belong to the admitted conversation", nil)
		}
		return nil
	})
}

func (s *TurnService) validatePinnedRuntimeAuthority(
	ctx context.Context,
	config *TurnConfig,
) error {
	if config == nil ||
		strings.TrimSpace(config.AttemptID) == "" ||
		strings.TrimSpace(config.ActorID) == "" ||
		strings.TrimSpace(config.Provider) == "" ||
		strings.TrimSpace(config.Model) == "" {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"provider execution requires a pinned runtime authority",
			nil,
		)
	}
	if s.admissionResolver == nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime admission authority is unavailable for provider execution",
			nil,
		)
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	var attempt persistence.TurnAttempt
	query := db.WithContext(ctx).
		Table("agent_turn_attempts AS attempts").
		Select("attempts.*").
		Joins("JOIN agent_turns AS turns ON turns.id = attempts.turn_id").
		Joins("JOIN agent_conversations AS conversations ON conversations.id = turns.conversation_id").
		Where(
			"attempts.id = ? AND attempts.turn_id = ? AND conversations.actor_ptid = ?",
			config.AttemptID,
			config.TurnID,
			config.ActorID,
		).
		First(&attempt)
	if query.Error != nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"pinned runtime attempt is unavailable for provider execution",
			query.Error,
		)
	}
	pinned, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
	if err != nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"pinned runtime snapshot is invalid",
			err,
		)
	}
	pinnedHash, err := runtimeSnapshotHash(pinned)
	if err != nil || strings.TrimSpace(attempt.RuntimeSnapshotHash) == "" ||
		attempt.RuntimeSnapshotHash != pinnedHash {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"pinned runtime snapshot integrity check failed",
			err,
		)
	}
	if err := validateRuntimeCapabilityProvenance(
		pinned.GetCapabilities(),
		time.Now().UTC(),
	); err != nil {
		return err
	}
	if pinned.GetRuntimeKind() != model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL ||
		pinned.GetProviderId() != config.Provider ||
		pinned.GetModelId() != config.Model ||
		pinned.GetRuntimeProfileId() != modernChatAgentProfileID {
		return errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"provider execution runtime tuple differs from the pinned snapshot",
			nil,
		)
	}
	if config.RuntimeBudget == nil ||
		!proto.Equal(config.RuntimeBudget, pinned.GetBudget()) {
		return errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"provider execution budget differs from the pinned snapshot",
			nil,
		)
	}

	current, err := s.admissionResolver.Resolve(
		ctx,
		config.ActorID,
		config.Provider,
		config.Model,
	)
	if err != nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime capability source is unavailable before provider execution",
			err,
		)
	}
	if err := validateRuntimeCapabilityProvenance(
		current.Capabilities,
		time.Now().UTC(),
	); err != nil {
		return err
	}
	pinnedSemanticHash, err := runtimeCapabilitySemanticHash(pinned.GetCapabilities())
	if err != nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"failed to hash pinned runtime capabilities",
			err,
		)
	}
	currentSemanticHash, err := runtimeCapabilitySemanticHash(current.Capabilities)
	if err != nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"failed to hash current runtime capabilities",
			err,
		)
	}
	if current.ProviderConfigVersion != pinned.GetProviderConfigVersion() ||
		current.SnapshotID != pinned.GetCapabilities().GetSnapshotId() ||
		currentSemanticHash != pinnedSemanticHash {
		return errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"runtime capability provenance is stale",
			nil,
		)
	}
	config.ProviderConfigVersion = pinned.GetProviderConfigVersion()
	config.CapabilitySourceVersion = pinned.GetCapabilities().GetProvenance().GetSourceVersion()
	return nil
}

func validateRuntimeCapabilityProvenance(
	snapshot *model.RuntimeCapabilitySnapshot,
	now time.Time,
) error {
	if snapshot == nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime capability provenance is incomplete",
			nil,
		)
	}
	provenance := snapshot.GetProvenance()
	if provenance == nil ||
		provenance.GetDiscoverySource() != runtimeCapabilityDiscoverySource ||
		strings.TrimSpace(provenance.GetSourceVersion()) == "" ||
		provenance.GetObservedAt() == nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime capability provenance is incomplete",
			nil,
		)
	}
	if err := provenance.GetObservedAt().CheckValid(); err != nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime capability observation timestamp is invalid",
			err,
		)
	}
	if provenance.GetObservedAt().AsTime().After(now) {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime capability observation timestamp is in the future",
			nil,
		)
	}
	return nil
}

func loadAgentConfigVersionTx(tx *gorm.DB, ptid string, agentID string) (int64, error) {
	var agent persistence.Agent
	if err := tx.Select("version").
		Where("id = ? AND owner_actor_ptid = ?", agentID, ptid).
		First(&agent).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return 0, errcode.New(
				errcode.AgentSecurityViolation,
				http.StatusForbidden,
				"runtime snapshot requires the owned agent",
				err,
			)
		}
		return 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"load agent config version", err)
	}
	return agent.Version, nil
}

func newDirectRuntimeSnapshot(
	admission *AdmissionSnapshot,
	agentConfigVersion string,
	thinkingMode domain.ThinkingMode,
) *model.RuntimeSnapshot {
	capabilities := proto.Clone(admission.Capabilities).(*model.RuntimeCapabilitySnapshot)
	return &model.RuntimeSnapshot{
		RuntimeKind:           model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
		ProviderId:            admission.ProviderID,
		ModelId:               admission.ModelID,
		RuntimeProfileId:      modernChatAgentProfileID,
		Capabilities:          capabilities,
		ProviderConfigVersion: admission.ProviderConfigVersion,
		AgentConfigVersion:    agentConfigVersion,
		ExternalSessionId:     "",
		ExternalSessionEpoch:  0,
		ThinkingMode:          string(thinkingMode),
		Budget:                cloneRuntimeBudget(admission.Budget),
	}
}

func newConversationRuntimeBinding(
	snapshot *model.RuntimeSnapshot,
	boundAt time.Time,
) (*model.ConversationRuntimeBinding, error) {
	capabilityHash, err := runtimeCapabilitySnapshotHash(snapshot.GetCapabilities())
	if err != nil {
		return nil, err
	}
	configHash, err := canonicalJSONHash(map[string]interface{}{
		"agentConfigVersion":    snapshot.GetAgentConfigVersion(),
		"providerConfigVersion": snapshot.GetProviderConfigVersion(),
	})
	if err != nil {
		return nil, err
	}
	return &model.ConversationRuntimeBinding{
		RuntimeKind:            snapshot.GetRuntimeKind(),
		ProviderId:             snapshot.GetProviderId(),
		ModelId:                snapshot.GetModelId(),
		RuntimeProfileId:       snapshot.GetRuntimeProfileId(),
		ExternalSessionId:      "",
		ExternalSessionEpoch:   0,
		RuntimeHomeRef:         "",
		CapabilitySnapshotHash: capabilityHash,
		ConfigSnapshotHash:     configHash,
		BoundAt:                timestamppb.New(boundAt),
	}, nil
}

func reconcileBoundRuntimeSnapshotTx(
	tx *gorm.DB,
	conversationID string,
	binding *model.ConversationRuntimeBinding,
	candidate *model.RuntimeSnapshot,
) (*model.RuntimeSnapshot, error) {
	boundSnapshot, err := loadBoundRuntimeSnapshotTx(tx, conversationID)
	if err != nil {
		return nil, err
	}
	boundConfigHash, err := canonicalJSONHash(map[string]interface{}{
		"agentConfigVersion":    boundSnapshot.GetAgentConfigVersion(),
		"providerConfigVersion": boundSnapshot.GetProviderConfigVersion(),
	})
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"hash persisted runtime config", err)
	}
	boundFullCapabilityHash, err := runtimeCapabilitySnapshotHash(boundSnapshot.GetCapabilities())
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"hash persisted runtime capabilities", err)
	}
	if binding.GetRuntimeKind() != boundSnapshot.GetRuntimeKind() ||
		binding.GetProviderId() != boundSnapshot.GetProviderId() ||
		binding.GetModelId() != boundSnapshot.GetModelId() ||
		binding.GetRuntimeProfileId() != boundSnapshot.GetRuntimeProfileId() ||
		binding.GetExternalSessionId() != boundSnapshot.GetExternalSessionId() ||
		binding.GetExternalSessionEpoch() != boundSnapshot.GetExternalSessionEpoch() ||
		binding.GetConfigSnapshotHash() != boundConfigHash ||
		binding.GetCapabilitySnapshotHash() != boundFullCapabilityHash {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"conversation runtime binding does not match its persisted snapshot",
			nil,
		)
	}
	candidateConfigHash, err := canonicalJSONHash(map[string]interface{}{
		"agentConfigVersion":    candidate.GetAgentConfigVersion(),
		"providerConfigVersion": candidate.GetProviderConfigVersion(),
	})
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"hash candidate runtime config", err)
	}
	boundCapabilityHash, err := runtimeCapabilitySemanticHash(boundSnapshot.GetCapabilities())
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"hash bound runtime capabilities", err)
	}
	candidateCapabilityHash, err := runtimeCapabilitySemanticHash(candidate.GetCapabilities())
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"hash candidate runtime capabilities", err)
	}
	if binding.GetRuntimeKind() != candidate.GetRuntimeKind() ||
		binding.GetProviderId() != candidate.GetProviderId() ||
		binding.GetModelId() != candidate.GetModelId() ||
		binding.GetRuntimeProfileId() != candidate.GetRuntimeProfileId() ||
		binding.GetExternalSessionId() != candidate.GetExternalSessionId() ||
		binding.GetExternalSessionEpoch() != candidate.GetExternalSessionEpoch() ||
		binding.GetConfigSnapshotHash() != candidateConfigHash ||
		boundCapabilityHash != candidateCapabilityHash {
		return nil, errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"conversation runtime binding conflicts with the admitted runtime tuple",
			nil,
		)
	}

	candidate.Capabilities = proto.Clone(boundSnapshot.GetCapabilities()).(*model.RuntimeCapabilitySnapshot)
	return candidate, nil
}

func loadBoundRuntimeSnapshotTx(tx *gorm.DB, conversationID string) (*model.RuntimeSnapshot, error) {
	var attempt persistence.TurnAttempt
	if err := tx.Table("agent_turn_attempts AS attempts").
		Select("attempts.*").
		Joins("JOIN agent_turns AS turns ON turns.id = attempts.turn_id").
		Where("turns.conversation_id = ? AND attempts.runtime_snapshot IS NOT NULL", conversationID).
		Order("attempts.started_at ASC").
		First(&attempt).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"conversation runtime binding has no persisted source snapshot",
				err,
			)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"load bound runtime snapshot", err)
	}
	snapshot, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"decode bound runtime snapshot", err)
	}
	return snapshot, nil
}

func runtimeSnapshotHash(snapshot *model.RuntimeSnapshot) (string, error) {
	return canonicalJSONHash(portableRuntimeSnapshot(snapshot))
}

func runtimeCapabilitySnapshotHash(snapshot *model.RuntimeCapabilitySnapshot) (string, error) {
	return canonicalJSONHash(portableRuntimeCapabilities(snapshot, true))
}

func runtimeCapabilitySemanticHash(snapshot *model.RuntimeCapabilitySnapshot) (string, error) {
	return canonicalJSONHash(portableRuntimeCapabilities(snapshot, false))
}

func canonicalJSONHash(value interface{}) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("marshal canonical JSON: %w", err)
	}
	var normalized interface{}
	if err := json.Unmarshal(encoded, &normalized); err != nil {
		return "", fmt.Errorf("normalize canonical JSON: %w", err)
	}
	canonical, err := json.Marshal(normalized)
	if err != nil {
		return "", fmt.Errorf("marshal normalized canonical JSON: %w", err)
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}

func portableRuntimeSnapshot(snapshot *model.RuntimeSnapshot) map[string]interface{} {
	return map[string]interface{}{
		"runtimeKind":           portableRuntimeKind(snapshot.GetRuntimeKind()),
		"providerId":            snapshot.GetProviderId(),
		"modelId":               snapshot.GetModelId(),
		"runtimeProfileId":      snapshot.GetRuntimeProfileId(),
		"capabilities":          portableRuntimeCapabilities(snapshot.GetCapabilities(), true),
		"providerConfigVersion": snapshot.GetProviderConfigVersion(),
		"agentConfigVersion":    snapshot.GetAgentConfigVersion(),
		"externalSessionId":     snapshot.GetExternalSessionId(),
		"externalSessionEpoch":  snapshot.GetExternalSessionEpoch(),
		"thinkingMode":          snapshot.GetThinkingMode(),
		"budget":                snapshot.GetBudget(),
	}
}

func portableRuntimeCapabilities(
	snapshot *model.RuntimeCapabilitySnapshot,
	includeObservation bool,
) map[string]interface{} {
	if snapshot == nil {
		return map[string]interface{}{}
	}
	resolution := make([]map[string]interface{}, 0, len(snapshot.GetResolution()))
	for _, capability := range snapshot.GetResolution() {
		resolution = append(resolution, map[string]interface{}{
			"capabilityId": capability.GetCapabilityId(),
			"resolution":   portableCapabilityResolution(capability.GetResolution()),
			"reasonCode":   capability.GetReasonCode(),
		})
	}
	provenance := map[string]interface{}{
		"discoverySource": snapshot.GetProvenance().GetDiscoverySource(),
		"sourceVersion":   snapshot.GetProvenance().GetSourceVersion(),
	}
	if includeObservation {
		observedAt := ""
		if snapshot.GetProvenance().GetObservedAt() != nil {
			observedAt = snapshot.GetProvenance().GetObservedAt().AsTime().UTC().
				Format("2006-01-02T15:04:05.000Z")
		}
		provenance["observedAt"] = observedAt
	}
	return map[string]interface{}{
		"input": map[string]interface{}{
			"text":  snapshot.GetInput().GetText(),
			"image": snapshot.GetInput().GetImage(),
			"file":  snapshot.GetInput().GetFile(),
			"audio": snapshot.GetInput().GetAudio(),
		},
		"output": map[string]interface{}{
			"text":       snapshot.GetOutput().GetText(),
			"image":      snapshot.GetOutput().GetImage(),
			"structured": snapshot.GetOutput().GetStructured(),
		},
		"runtime": map[string]interface{}{
			"streaming":      snapshot.GetRuntime().GetStreaming(),
			"reasoning":      snapshot.GetRuntime().GetReasoning(),
			"promptCache":    snapshot.GetRuntime().GetPromptCache(),
			"externalResume": snapshot.GetRuntime().GetExternalResume(),
		},
		"agentic": map[string]interface{}{
			"nativeTools":   snapshot.GetAgentic().GetNativeTools(),
			"parallelTools": snapshot.GetAgentic().GetParallelTools(),
			"localBridge":   snapshot.GetAgentic().GetLocalBridge(),
		},
		"limits": map[string]interface{}{
			"contextTokens":   snapshot.GetLimits().GetContextTokens(),
			"outputTokens":    snapshot.GetLimits().GetOutputTokens(),
			"attachmentCount": snapshot.GetLimits().GetAttachmentCount(),
			"attachmentBytes": snapshot.GetLimits().GetAttachmentBytes(),
		},
		"resolution": resolution,
		"provenance": provenance,
	}
}

func portableRuntimeKind(kind model.RuntimeKind) string {
	switch kind {
	case model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL:
		return "direct_model"
	case model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT:
		return "external_agent"
	default:
		return "unspecified"
	}
}

func portableCapabilityResolution(resolution model.RuntimeCapabilityResolution) string {
	switch resolution {
	case model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE:
		return "native"
	case model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_BRIDGED:
		return "bridged"
	case model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_DEGRADED:
		return "degraded"
	case model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_REJECTED:
		return "rejected"
	default:
		return "unspecified"
	}
}
