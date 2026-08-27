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

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *TurnService) persistRuntimeAuthority(
	ctx context.Context,
	config *TurnConfig,
	admission *AdmissionSnapshot,
) error {
	if config == nil || admission == nil || strings.TrimSpace(config.AttemptID) == "" {
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"runtime authority requires turn config, admission, and attempt",
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
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var conversation persistence.Conversation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"id = ? AND ptid = ? AND agent_id = ?",
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

		agentConfigVersion, err := loadAgentConfigVersionTx(tx, config.ActorID, config.AgentID)
		if err != nil {
			return err
		}
		snapshot := newDirectRuntimeSnapshot(admission, agentConfigVersion)

		var binding *model.ConversationRuntimeBinding
		if len(conversation.RuntimeBinding) == 0 {
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
					"id = ? AND ptid = ? AND (runtime_binding IS NULL OR length(runtime_binding) = 0)",
					conversation.ID,
					conversation.Ptid,
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
		result := tx.Model(&persistence.TurnAttempt{}).
			Where(
				"id = ? AND turn_id IN (?)",
				config.AttemptID,
				tx.Model(&persistence.AgentTurn{}).
					Select("id").
					Where("conversation_id = ?", conversation.ID),
			).
			Updates(map[string]interface{}{
				"runtime_snapshot":      encodedSnapshot,
				"runtime_snapshot_hash": snapshotHash,
				"readiness_snapshot_id": admission.SnapshotID,
			})
		if result.Error != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"persist turn attempt runtime snapshot", result.Error)
		}
		if result.RowsAffected != 1 {
			return errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
				"turn attempt does not belong to the admitted conversation", nil)
		}
		return nil
	})
}

func loadAgentConfigVersionTx(tx *gorm.DB, ptid string, agentID string) (string, error) {
	var agent persistence.Agent
	if err := tx.Select("version").
		Where("id = ? AND owner_actor_id = ?", agentID, ptid).
		First(&agent).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return "", errcode.New(
				errcode.AgentSecurityViolation,
				http.StatusForbidden,
				"runtime snapshot requires the owned agent",
				err,
			)
		}
		return "", errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"load agent config version", err)
	}
	return fmt.Sprintf("%d", agent.Version), nil
}

func newDirectRuntimeSnapshot(
	admission *AdmissionSnapshot,
	agentConfigVersion string,
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
