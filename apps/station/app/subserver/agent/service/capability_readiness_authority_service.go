package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

type capabilitySessionResolver interface {
	GetActiveCapabilitySession(
		context.Context,
		string,
		string,
	) (*model.ClientCapabilitySession, error)
}

type CapabilityAuthorityReadinessService struct {
	authority          *CapabilityAuthorityService
	agents             *AgentService
	admission          *RuntimeAdmissionResolver
	capabilitySessions capabilitySessionResolver
	now                func() time.Time
}

const (
	bindingDisabledReasonCode              = "binding_disabled"
	manifestDegradedReasonCode             = "manifest_degraded"
	runtimeCapabilityUnavailableReasonCode = "runtime_capability_unavailable"
)

func NewCapabilityAuthorityReadinessService(
	authority *CapabilityAuthorityService,
	agents *AgentService,
	admission *RuntimeAdmissionResolver,
) *CapabilityAuthorityReadinessService {
	return &CapabilityAuthorityReadinessService{
		authority: authority,
		agents:    agents,
		admission: admission,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

func (s *CapabilityAuthorityReadinessService) SetCapabilitySessionResolver(
	resolver capabilitySessionResolver,
) {
	s.capabilitySessions = resolver
}

func (s *CapabilityAuthorityReadinessService) Get(
	ctx context.Context,
	ptid string,
	req *model.GetCapabilityReadinessRequest,
) (*model.CapabilityReadinessSnapshot, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil || strings.TrimSpace(req.GetAgentId()) == "" {
		return nil, capabilityInvalid("ptid and agent_id are required")
	}
	agent, err := s.agents.GetAgent(ctx, ptid, req.GetAgentId())
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(agent.ProviderID) == "" || strings.TrimSpace(agent.ModelName) == "" {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime configuration is required for capability readiness",
			nil,
		)
	}
	admission, err := s.admission.Resolve(
		ctx, ptid, agent.ProviderID, agent.ModelName,
	)
	if err != nil {
		return nil, err
	}
	runtimeSnapshotID := strings.TrimSpace(req.GetRuntimeSnapshotId())
	if runtimeSnapshotID != "" && runtimeSnapshotID != admission.SnapshotID {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime snapshot is stale",
			nil,
		)
	}
	return s.resolveForAdmission(
		ctx,
		ptid,
		agent,
		strings.TrimSpace(req.GetClientCapabilitySessionId()),
		admission,
	)
}

func (s *CapabilityAuthorityReadinessService) ResolveForTurn(
	ctx context.Context,
	ptid string,
	agentID string,
	clientSessionID string,
	admission *AdmissionSnapshot,
) (*model.CapabilityReadinessSnapshot, uint64, error) {
	ptid = strings.TrimSpace(ptid)
	agentID = strings.TrimSpace(agentID)
	if ptid == "" || agentID == "" || admission == nil ||
		strings.TrimSpace(admission.SnapshotID) == "" ||
		admission.Capabilities == nil {
		return nil, 0, capabilityInvalid(
			"ptid, agent_id and runtime admission are required",
		)
	}
	agent, err := s.agents.GetAgent(ctx, ptid, agentID)
	if err != nil {
		return nil, 0, err
	}
	snapshot, err := s.resolveForAdmission(
		ctx,
		ptid,
		agent,
		strings.TrimSpace(clientSessionID),
		admission,
	)
	if err != nil {
		return nil, 0, err
	}
	return snapshot, uint64(agent.Version), nil
}

func (s *CapabilityAuthorityReadinessService) resolveForAdmission(
	ctx context.Context,
	ptid string,
	agent *domain.Agent,
	clientSessionID string,
	admission *AdmissionSnapshot,
) (*model.CapabilityReadinessSnapshot, error) {
	var clientSession *model.ClientCapabilitySession
	var err error
	if clientSessionID != "" {
		if s.capabilitySessions == nil {
			return nil, errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"client capability session authority is unavailable",
				nil,
			)
		}
		clientSession, err = s.capabilitySessions.GetActiveCapabilitySession(
			ctx, ptid, clientSessionID,
		)
		if err != nil {
			return nil, err
		}
		if clientSession == nil {
			return nil, errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"client capability session is unavailable",
				nil,
			)
		}
	}
	return s.authority.ResolveReadiness(
		ctx,
		ptid,
		agent.AgentID,
		uint64(agent.Version),
		admission.SnapshotID,
		admission.Capabilities,
		clientSession,
		s.now(),
	)
}

func (s *CapabilityAuthorityService) ResolveReadiness(
	ctx context.Context,
	ptid string,
	agentID string,
	agentVersion uint64,
	runtimeSnapshotID string,
	modelCapabilities *model.RuntimeCapabilitySnapshot,
	clientSession *model.ClientCapabilitySession,
	now time.Time,
) (*model.CapabilityReadinessSnapshot, error) {
	ptid = strings.TrimSpace(ptid)
	agentID = strings.TrimSpace(agentID)
	runtimeSnapshotID = strings.TrimSpace(runtimeSnapshotID)
	if ptid == "" || agentID == "" || agentVersion == 0 || runtimeSnapshotID == "" ||
		modelCapabilities == nil {
		return nil, capabilityInvalid(
			"ptid, agent_id, agent_version, runtime_snapshot_id and model capabilities are required",
		)
	}
	var agent persistence.Agent
	if err := s.db.WithContext(ctx).
		Where("id = ? AND owner_actor_ptid = ? AND version = ?", agentID, ptid, agentVersion).
		First(&agent).Error; err != nil {
		return nil, capabilityRecordError("owned agent revision", err)
	}
	var bindings []persistence.AgentCapabilityBinding
	if err := s.db.WithContext(ctx).
		Where("ptid = ? AND agent_id = ? AND tombstoned_at IS NULL", ptid, agentID).
		Order("binding_id").
		Find(&bindings).Error; err != nil {
		return nil, capabilityInternal("failed to load capability bindings", err)
	}

	runtimeResolution := runtimeCapabilityResolution(modelCapabilities)
	clientCapabilities := selectedClientCapabilities(clientSession)
	readiness := make([]*model.CapabilityReadiness, 0, len(bindings))
	bindingRevisions := []string{fmt.Sprintf("agent:%s:%d", agentID, agentVersion)}
	connectionRevisionSet := make(map[string]struct{})
	for i := range bindings {
		binding := &bindings[i]
		state, reason, connectionRevision, err := s.resolveBindingReadiness(
			ctx, binding, agentVersion, runtimeResolution, clientCapabilities,
			clientSession != nil,
		)
		if err != nil {
			return nil, err
		}
		bindingRevisions = append(
			bindingRevisions,
			fmt.Sprintf("binding:%s:%d", binding.BindingID, binding.Revision),
		)
		if connectionRevision != "" {
			connectionRevisionSet[connectionRevision] = struct{}{}
		}
		readiness = append(readiness, &model.CapabilityReadiness{
			CapabilityId:      binding.CapabilityID,
			CapabilityVersion: binding.CapabilityVersion,
			BindingId:         binding.BindingID,
			BindingRevision:   binding.Revision,
			State:             state,
			Authority:         "station-capability-authority",
			ReasonCode:        reason,
		})
	}
	sort.Strings(bindingRevisions)
	sort.Slice(readiness, func(i, j int) bool {
		return readiness[i].GetCapabilityId() < readiness[j].GetCapabilityId()
	})
	connectionRevisions := make([]string, 0, len(connectionRevisionSet)+1)
	for revision := range connectionRevisionSet {
		connectionRevisions = append(connectionRevisions, revision)
	}

	capabilities := proto.Clone(modelCapabilities).(*model.RuntimeCapabilitySnapshot)
	capabilities.SnapshotId = runtimeSnapshotID
	snapshot := &model.CapabilityReadinessSnapshot{
		SnapshotId: readinessAuthoritySnapshotID(
			ptid, agentID, runtimeSnapshotID, bindingRevisions,
			connectionRevisions, readiness,
			clientSession.GetSessionId(), now,
		),
		Ptid:                ptid,
		AgentId:             agentID,
		RuntimeSnapshotId:   runtimeSnapshotID,
		ModelCapabilities:   capabilities,
		BindingRevisions:    bindingRevisions,
		ConnectionRevisions: connectionRevisions,
		Capabilities:        readiness,
		CreatedAt:           timestamppb.New(now),
		ExpiresAt:           timestamppb.New(now.Add(5 * time.Minute)),
	}
	if clientSession != nil {
		sessionID := clientSession.GetSessionId()
		snapshot.SelectedClientSessionId = &sessionID
		snapshot.ConnectionRevisions = append(
			snapshot.ConnectionRevisions,
			fmt.Sprintf(
				"client-session:%s:%d:%s",
				sessionID,
				clientSession.GetLeaseRevision(),
				clientSession.GetConnectionId(),
			),
		)
	}
	sort.Strings(snapshot.ConnectionRevisions)
	return s.StoreReadinessSnapshot(ctx, snapshot)
}

func (s *CapabilityAuthorityService) resolveBindingReadiness(
	ctx context.Context,
	binding *persistence.AgentCapabilityBinding,
	agentVersion uint64,
	runtimeResolution map[string]model.RuntimeCapabilityResolution,
	clientCapabilities map[string]model.CapabilityPermissionState,
	clientSessionSelected bool,
) (model.CapabilityReadinessState, string, string, error) {
	if binding.AgentVersion != agentVersion {
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			"binding_agent_revision_stale", "", nil
	}
	if !binding.Enabled {
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			bindingDisabledReasonCode, "", nil
	}
	var manifest persistence.CapabilityManifest
	err := s.db.WithContext(ctx).Where(
		"capability_id = ? AND version = ?",
		binding.CapabilityID,
		binding.CapabilityVersion,
	).First(&manifest).Error
	if err == gorm.ErrRecordNotFound {
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNKNOWN,
			"manifest_missing", "", nil
	}
	if err != nil {
		return 0, "", "", capabilityInternal("failed to load capability manifest", err)
	}
	connectionRevision := ""
	if model.CapabilitySourceKind(manifest.SourceKind) ==
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CONNECTOR {
		state, reason, revision, err := connectorReadinessForCapability(
			s.db.WithContext(ctx),
			binding.Ptid,
			binding.CapabilityID,
			binding.CapabilityVersion,
			s.now(),
		)
		if err != nil {
			return 0, "", "", err
		}
		connectionRevision = revision
		if state != model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY {
			return state, reason, revision, nil
		}
	}
	if manifest.RetiredAt != nil {
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			"manifest_retired", connectionRevision, nil
	}
	switch model.CapabilityAvailability(manifest.Availability) {
	case model.CapabilityAvailability_CAPABILITY_AVAILABILITY_UNSPECIFIED:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNKNOWN,
			"manifest_availability_unknown", connectionRevision, nil
	case model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			"manifest_blocked", connectionRevision, nil
	case model.CapabilityAvailability_CAPABILITY_AVAILABILITY_UNAVAILABLE:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
			"manifest_unavailable", connectionRevision, nil
	case model.CapabilityAvailability_CAPABILITY_AVAILABILITY_DEGRADED:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_DEGRADED,
			manifestDegradedReasonCode, connectionRevision, nil
	}
	var requiredCapabilities []string
	if err := json.Unmarshal(
		[]byte(manifest.RequiredCapabilitiesJSON),
		&requiredCapabilities,
	); err != nil {
		return 0, "", "", capabilityInternal("decode required runtime capabilities", err)
	}
	for _, required := range requiredCapabilities {
		resolution, ok := runtimeResolution[required]
		if !ok || (resolution != model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE &&
			resolution != model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_BRIDGED) {
			return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
				runtimeCapabilityUnavailableReasonCode, connectionRevision, nil
		}
	}
	if model.ToolExecutionOwner(manifest.ExecutionOwner) ==
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY {
		if !clientSessionSelected {
			return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
				"client_session_required", connectionRevision, nil
		}
		permission, ok := clientCapabilities[manifest.CapabilityID]
		if !ok {
			permission, ok = clientCapabilities[manifest.SourceInstanceID]
		}
		if !ok ||
			(permission != model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_GRANTED &&
				permission != model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_DENIED) {
			return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
				"client_capability_unavailable", connectionRevision, nil
		}
	}
	return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		"capability_ready", connectionRevision, nil
}

func capabilityReadinessAdmissionError(
	snapshot *model.CapabilityReadinessSnapshot,
) error {
	for _, readiness := range snapshot.GetCapabilities() {
		state := readiness.GetState()
		reasonCode := readiness.GetReasonCode()
		if state == model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY ||
			(state == model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED &&
				reasonCode == bindingDisabledReasonCode) ||
			(state == model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_DEGRADED &&
				reasonCode == manifestDegradedReasonCode) {
			continue
		}
		return errcode.NewRuntimeIncompatibleCapability(
			readiness.GetCapabilityId(),
			reasonCode,
		)
	}
	return nil
}

func runtimeCapabilityResolution(
	snapshot *model.RuntimeCapabilitySnapshot,
) map[string]model.RuntimeCapabilityResolution {
	result := make(map[string]model.RuntimeCapabilityResolution)
	for _, capability := range snapshot.GetResolution() {
		result[strings.TrimSpace(capability.GetCapabilityId())] = capability.GetResolution()
	}
	return result
}

func selectedClientCapabilities(
	session *model.ClientCapabilitySession,
) map[string]model.CapabilityPermissionState {
	result := make(map[string]model.CapabilityPermissionState)
	for _, capability := range session.GetTypedCapabilities() {
		result[strings.TrimSpace(capability.GetCapabilityId())] = capability.GetPermission()
	}
	return result
}

func readinessAuthoritySnapshotID(
	ptid string,
	agentID string,
	runtimeSnapshotID string,
	bindingRevisions []string,
	connectionRevisions []string,
	readiness []*model.CapabilityReadiness,
	clientSessionID string,
	now time.Time,
) string {
	parts := []string{
		ptid,
		agentID,
		runtimeSnapshotID,
		strings.Join(bindingRevisions, ","),
		strings.Join(connectionRevisions, ","),
		clientSessionID,
		now.UTC().Format(time.RFC3339Nano),
	}
	for _, capability := range readiness {
		parts = append(parts,
			capability.GetCapabilityId(),
			capability.GetCapabilityVersion(),
			capability.GetState().String(),
			capability.GetReasonCode(),
		)
	}
	return "capability-readiness-" + shortCapabilityHash(parts...)
}
