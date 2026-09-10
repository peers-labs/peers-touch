package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type AuthorizedCapability struct {
	Manifest  *model.CapabilityManifest
	Binding   *model.AgentCapabilityBinding
	Readiness *model.CapabilityReadiness
}

type AuthorizedCapabilitySet struct {
	SnapshotID                string
	ActorID                   string
	AgentID                   string
	ClientCapabilitySessionID string
	byCapability              map[string]AuthorizedCapability
	bySource                  map[string]AuthorizedCapability
}

func LoadAuthorizedCapabilitySet(
	ctx context.Context,
	db *gorm.DB,
	config *TurnConfig,
) (*AuthorizedCapabilitySet, error) {
	if db == nil || config == nil ||
		strings.TrimSpace(config.AttemptID) == "" ||
		strings.TrimSpace(config.TurnID) == "" ||
		strings.TrimSpace(config.ActorID) == "" ||
		strings.TrimSpace(config.AgentID) == "" {
		return nil, capabilityInvalid(
			"database, attempt, turn, actor and agent are required for capability authorization",
		)
	}

	var attempt persistence.TurnAttempt
	if err := db.WithContext(ctx).
		Table("agent_turn_attempts AS attempts").
		Select("attempts.*").
		Joins("JOIN agent_turns AS turns ON turns.id = attempts.turn_id").
		Joins("JOIN agent_conversations AS conversations ON conversations.id = turns.conversation_id").
		Where(
			"attempts.id = ? AND attempts.turn_id = ? AND turns.agent_id = ? AND conversations.actor_ptid = ? AND conversations.agent_id = ?",
			config.AttemptID,
			config.TurnID,
			config.AgentID,
			config.ActorID,
			config.AgentID,
		).
		First(&attempt).Error; err != nil {
		return nil, capabilityStateError(
			"turn attempt does not belong to the actor, agent, and turn",
			err,
		)
	}
	snapshotID := strings.TrimSpace(attempt.ReadinessSnapshotID)
	if snapshotID == "" {
		return nil, capabilityStateError(
			"turn attempt has no persisted readiness snapshot",
			nil,
		)
	}

	var record persistence.CapabilityReadinessSnapshot
	if err := db.WithContext(ctx).Where(
		"snapshot_id = ? AND ptid = ? AND agent_id = ?",
		snapshotID,
		config.ActorID,
		config.AgentID,
	).First(&record).Error; err != nil {
		return nil, capabilityStateError("persisted readiness snapshot is unavailable", err)
	}
	now := time.Now().UTC()
	if !record.ExpiresAt.After(now) {
		return nil, capabilityStateError("persisted readiness snapshot has expired", nil)
	}
	sum := sha256.Sum256(record.Payload)
	if !strings.EqualFold(record.PayloadHash, hex.EncodeToString(sum[:])) {
		return nil, capabilityStateError("readiness snapshot payload hash mismatch", nil)
	}

	var snapshot model.CapabilityReadinessSnapshot
	if err := proto.Unmarshal(record.Payload, &snapshot); err != nil {
		return nil, capabilityInternal("failed to decode readiness snapshot", err)
	}
	if snapshot.GetSnapshotId() != snapshotID ||
		snapshot.GetPtid() != config.ActorID ||
		snapshot.GetAgentId() != config.AgentID {
		return nil, capabilityStateError("readiness snapshot authority mismatch", nil)
	}
	if snapshot.GetExpiresAt() == nil ||
		!snapshot.GetExpiresAt().AsTime().After(now) ||
		!snapshot.GetExpiresAt().AsTime().Equal(record.ExpiresAt) {
		return nil, capabilityStateError("readiness snapshot expiry mismatch", nil)
	}
	selectedSessionID := strings.TrimSpace(snapshot.GetSelectedClientSessionId())
	if selectedSessionID != strings.TrimSpace(config.ClientCapabilitySessionID) {
		return nil, capabilityStateError("readiness snapshot client session mismatch", nil)
	}

	set := &AuthorizedCapabilitySet{
		SnapshotID:                snapshotID,
		ActorID:                   config.ActorID,
		AgentID:                   config.AgentID,
		ClientCapabilitySessionID: selectedSessionID,
		byCapability:              make(map[string]AuthorizedCapability),
		bySource:                  make(map[string]AuthorizedCapability),
	}
	for _, ready := range snapshot.GetCapabilities() {
		if ready.GetState() !=
			model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY {
			continue
		}
		capability, err := loadAuthorizedCapability(ctx, db, config, ready)
		if err != nil {
			return nil, err
		}
		key := authorizedCapabilityKey(
			capability.Manifest.GetCapabilityId(),
			capability.Manifest.GetVersion(),
		)
		if _, exists := set.byCapability[key]; exists {
			return nil, capabilityStateError("readiness snapshot contains duplicate READY capability", nil)
		}
		set.byCapability[key] = capability
		sourceKey := authorizedSourceKey(
			capability.Manifest.GetSourceKind(),
			capability.Manifest.GetSourceInstanceId(),
		)
		if _, exists := set.bySource[sourceKey]; exists {
			return nil, capabilityStateError("readiness snapshot contains ambiguous READY source", nil)
		}
		set.bySource[sourceKey] = capability
	}
	return set, nil
}

func loadAuthorizedCapability(
	ctx context.Context,
	db *gorm.DB,
	config *TurnConfig,
	ready *model.CapabilityReadiness,
) (AuthorizedCapability, error) {
	if ready == nil ||
		strings.TrimSpace(ready.GetBindingId()) == "" ||
		strings.TrimSpace(ready.GetCapabilityId()) == "" ||
		strings.TrimSpace(ready.GetCapabilityVersion()) == "" ||
		ready.GetBindingRevision() == 0 {
		return AuthorizedCapability{}, capabilityStateError(
			"READY capability has incomplete binding lineage",
			nil,
		)
	}
	var binding persistence.AgentCapabilityBinding
	if err := db.WithContext(ctx).Where(
		"binding_id = ? AND ptid = ? AND agent_id = ? AND revision = ? AND capability_id = ? AND capability_version = ? AND enabled = ? AND tombstoned_at IS NULL",
		ready.GetBindingId(),
		config.ActorID,
		config.AgentID,
		ready.GetBindingRevision(),
		ready.GetCapabilityId(),
		ready.GetCapabilityVersion(),
		true,
	).First(&binding).Error; err != nil {
		return AuthorizedCapability{}, capabilityStateError(
			"READY capability binding is stale or unavailable",
			err,
		)
	}

	var manifest persistence.CapabilityManifest
	if err := db.WithContext(ctx).Where(
		"capability_id = ? AND version = ? AND retired_at IS NULL",
		ready.GetCapabilityId(),
		ready.GetCapabilityVersion(),
	).First(&manifest).Error; err != nil {
		return AuthorizedCapability{}, capabilityStateError(
			"READY capability manifest is stale or unavailable",
			err,
		)
	}
	if manifest.OwnerPtid != "" && manifest.OwnerPtid != config.ActorID {
		return AuthorizedCapability{}, capabilityStateError(
			"READY capability manifest is not owned by the actor",
			nil,
		)
	}
	if model.CapabilitySourceKind(manifest.SourceKind) ==
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_KNOWLEDGE &&
		manifest.OwnerPtid != config.ActorID {
		return AuthorizedCapability{}, capabilityStateError(
			"READY Knowledge manifest must be owned by the actor",
			nil,
		)
	}
	if model.CapabilityAvailability(manifest.Availability) !=
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE {
		return AuthorizedCapability{}, capabilityStateError(
			"READY capability manifest is not active",
			nil,
		)
	}
	return AuthorizedCapability{
		Manifest:  capabilityManifestModel(&manifest),
		Binding:   capabilityBindingModel(&binding),
		Readiness: proto.Clone(ready).(*model.CapabilityReadiness),
	}, nil
}

func (s *AuthorizedCapabilitySet) Capability(
	capabilityID string,
	version string,
) (AuthorizedCapability, bool) {
	if s == nil {
		return AuthorizedCapability{}, false
	}
	value, ok := s.byCapability[authorizedCapabilityKey(capabilityID, version)]
	return value, ok
}

func (s *AuthorizedCapabilitySet) Source(
	kind model.CapabilitySourceKind,
	sourceInstanceID string,
) (AuthorizedCapability, bool) {
	if s == nil {
		return AuthorizedCapability{}, false
	}
	value, ok := s.bySource[authorizedSourceKey(kind, sourceInstanceID)]
	return value, ok
}

func (s *AuthorizedCapabilitySet) Sources(
	kind model.CapabilitySourceKind,
) []AuthorizedCapability {
	if s == nil {
		return nil
	}
	result := make([]AuthorizedCapability, 0)
	for _, capability := range s.byCapability {
		if capability.Manifest.GetSourceKind() == kind {
			result = append(result, capability)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		left := result[i].Manifest
		right := result[j].Manifest
		return authorizedCapabilityKey(left.GetCapabilityId(), left.GetVersion()) <
			authorizedCapabilityKey(right.GetCapabilityId(), right.GetVersion())
	})
	return result
}

func (s *AuthorizedCapabilitySet) Tool(toolName string) (AuthorizedCapability, bool) {
	for _, kind := range []model.CapabilitySourceKind{
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL,
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_MCP,
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CONNECTOR,
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CLIENT_NATIVE,
	} {
		if capability, ok := s.Source(kind, toolName); ok {
			return capability, true
		}
	}
	return AuthorizedCapability{}, false
}

func (s *AuthorizedCapabilitySet) ToolNames() []string {
	if s == nil {
		return nil
	}
	result := make([]string, 0)
	for _, capability := range s.byCapability {
		switch capability.Manifest.GetSourceKind() {
		case model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL,
			model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_MCP,
			model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CONNECTOR,
			model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CLIENT_NATIVE:
			result = append(result, capability.Manifest.GetSourceInstanceId())
		}
	}
	sort.Strings(result)
	return result
}

func (s *AuthorizedCapabilitySet) KnowledgeRevision(
	capability AuthorizedCapability,
) (uint64, error) {
	revision, err := strconv.ParseUint(capability.Manifest.GetVersion(), 10, 64)
	if err != nil || revision == 0 {
		return 0, capabilityStateError("Knowledge manifest version is not a descriptor revision", err)
	}
	return revision, nil
}

func authorizedCapabilityKey(capabilityID string, version string) string {
	return strings.TrimSpace(capabilityID) + "\x00" + strings.TrimSpace(version)
}

func authorizedSourceKey(kind model.CapabilitySourceKind, sourceInstanceID string) string {
	return strconv.Itoa(int(kind)) + "\x00" + strings.TrimSpace(sourceInstanceID)
}

func capabilityStateError(message string, cause error) error {
	if errors.Is(cause, gorm.ErrRecordNotFound) {
		cause = nil
	}
	return errcode.New(
		errcode.AgentInvalidSourceState,
		http.StatusConflict,
		message,
		cause,
	)
}
