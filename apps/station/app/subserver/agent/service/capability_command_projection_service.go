package service

import (
	"context"
	"sort"
	"strconv"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
)

func (s *CapabilityAuthorityService) BuildCommandCapabilitySnapshot(
	ctx context.Context,
	ptid string,
	agentID string,
	readiness *model.CapabilityReadinessSnapshot,
) (*model.AgentCommandCapabilitySnapshot, error) {
	ptid = strings.TrimSpace(ptid)
	agentID = strings.TrimSpace(agentID)
	if readiness == nil ||
		readiness.GetPtid() != ptid ||
		readiness.GetAgentId() != agentID ||
		readiness.GetCreatedAt() == nil ||
		readiness.GetExpiresAt() == nil {
		return nil, capabilityInvalid(
			"command capability projection requires matching readiness authority",
		)
	}

	bindings, err := s.ListBindings(ctx, ptid, agentID)
	if err != nil {
		return nil, err
	}
	manifests, err := s.ListManifests(ctx, ptid, nil)
	if err != nil {
		return nil, err
	}

	var agent persistence.Agent
	if err := s.db.WithContext(ctx).
		Select("id", "version").
		Where("id = ? AND owner_actor_ptid = ?", agentID, ptid).
		First(&agent).Error; err != nil {
		return nil, capabilityRecordError("owned agent", err)
	}

	manifestByKey := make(map[string]*model.CapabilityManifest, len(manifests))
	for _, manifest := range manifests {
		if manifest == nil {
			continue
		}
		manifestByKey[authorizedCapabilityKey(
			manifest.GetCapabilityId(),
			manifest.GetVersion(),
		)] = manifest
	}
	readinessByBinding := make(map[string]*model.CapabilityReadiness)
	for _, item := range readiness.GetCapabilities() {
		if item == nil || strings.TrimSpace(item.GetBindingId()) == "" {
			continue
		}
		readinessByBinding[item.GetBindingId()] = item
	}

	items := make([]*model.AgentCommandCapabilityItem, 0, len(bindings))
	for _, binding := range bindings {
		if binding == nil || !binding.GetEnabled() {
			continue
		}
		manifest := manifestByKey[authorizedCapabilityKey(
			binding.GetCapabilityId(),
			binding.GetCapabilityVersion(),
		)]
		if manifest == nil {
			return nil, capabilityStateError(
				"command capability binding manifest is unavailable",
				nil,
			)
		}
		kind, visible := commandCapabilityKind(manifest.GetSourceKind())
		if !visible {
			continue
		}
		projectedReadiness := readinessByBinding[binding.GetBindingId()]
		if projectedReadiness == nil ||
			projectedReadiness.GetCapabilityId() != binding.GetCapabilityId() ||
			projectedReadiness.GetCapabilityVersion() != binding.GetCapabilityVersion() ||
			projectedReadiness.GetBindingRevision() != binding.GetRevision() {
			return nil, capabilityStateError(
				"command capability snapshot changed during projection",
				nil,
			)
		}
		items = append(items, &model.AgentCommandCapabilityItem{
			CapabilityId:      binding.GetCapabilityId(),
			CapabilityVersion: binding.GetCapabilityVersion(),
			BindingId:         binding.GetBindingId(),
			BindingRevision:   binding.GetRevision(),
			Kind:              kind,
			SourceKind:        manifest.GetSourceKind(),
			SourceInstanceId:  manifest.GetSourceInstanceId(),
			DisplayMetadata:   cloneCapabilityDisplayMetadata(manifest.GetDisplayMetadata()),
			Readiness:         projectedReadiness.GetState(),
			ReasonCode: safeProjectionReasonCode(
				projectedReadiness.GetReasonCode(),
			),
		})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].GetKind() != items[j].GetKind() {
			return items[i].GetKind() < items[j].GetKind()
		}
		if items[i].GetSourceInstanceId() != items[j].GetSourceInstanceId() {
			return items[i].GetSourceInstanceId() < items[j].GetSourceInstanceId()
		}
		return items[i].GetCapabilityId() < items[j].GetCapabilityId()
	})

	identityParts := []string{
		ptid,
		agentID,
		strconv.FormatInt(agent.Version, 10),
		readiness.GetSnapshotId(),
	}
	for _, item := range items {
		identityParts = append(
			identityParts,
			item.GetCapabilityId(),
			item.GetCapabilityVersion(),
			item.GetBindingId(),
			strconv.FormatUint(item.GetBindingRevision(), 10),
			item.GetReadiness().String(),
			item.GetReasonCode(),
		)
	}
	return &model.AgentCommandCapabilitySnapshot{
		SnapshotId:   "agent-command-capability-" + shortCapabilityHash(identityParts...),
		Ptid:         ptid,
		AgentId:      agentID,
		AgentVersion: uint64(agent.Version),
		Items:        items,
		CreatedAt:    readiness.GetCreatedAt(),
		ExpiresAt:    readiness.GetExpiresAt(),
	}, nil
}

func commandCapabilityKind(
	sourceKind model.CapabilitySourceKind,
) (model.AgentCommandCapabilityKind, bool) {
	switch sourceKind {
	case model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_SKILL:
		return model.AgentCommandCapabilityKind_AGENT_COMMAND_CAPABILITY_KIND_SKILL, true
	case model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL,
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_MCP,
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CONNECTOR,
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CLIENT_NATIVE:
		return model.AgentCommandCapabilityKind_AGENT_COMMAND_CAPABILITY_KIND_TOOL, true
	default:
		return model.AgentCommandCapabilityKind_AGENT_COMMAND_CAPABILITY_KIND_UNSPECIFIED, false
	}
}

func cloneCapabilityDisplayMetadata(
	metadata *model.CapabilityDisplayMetadata,
) *model.CapabilityDisplayMetadata {
	if metadata == nil {
		return nil
	}
	return proto.Clone(metadata).(*model.CapabilityDisplayMetadata)
}

func safeProjectionReasonCode(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if len(value) > 96 {
		return "projection_reason_unavailable"
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') ||
			(char >= '0' && char <= '9') ||
			char == '_' || char == '-' || char == '.' || char == ':' {
			continue
		}
		return "projection_reason_unavailable"
	}
	return value
}
