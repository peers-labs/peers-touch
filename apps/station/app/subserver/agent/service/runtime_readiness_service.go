package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

const directModelCapabilityID = "runtime.direct-model"

type capabilitySessionResolver interface {
	GetActiveCapabilitySession(
		context.Context,
		string,
		string,
	) (*model.ClientCapabilitySession, error)
}

type RuntimeReadinessService struct {
	agents             *AgentService
	admission          *RuntimeAdmissionResolver
	capabilitySessions capabilitySessionResolver
	now                func() time.Time
}

func NewRuntimeReadinessService(
	agents *AgentService,
	admission *RuntimeAdmissionResolver,
) *RuntimeReadinessService {
	return &RuntimeReadinessService{
		agents:    agents,
		admission: admission,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

func (s *RuntimeReadinessService) SetCapabilitySessionResolver(
	resolver capabilitySessionResolver,
) {
	s.capabilitySessions = resolver
}

func (s *RuntimeReadinessService) Get(
	ctx context.Context,
	actorID string,
	req *model.GetCapabilityReadinessRequest,
) (*model.CapabilityReadinessSnapshot, error) {
	actorID = strings.TrimSpace(actorID)
	agentID := strings.TrimSpace(req.GetAgentId())
	if actorID == "" || agentID == "" {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"authenticated actor and agent_id are required",
			nil,
		)
	}
	agent, err := s.agents.GetAgent(ctx, actorID, agentID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	clientSessionID := strings.TrimSpace(req.GetClientCapabilitySessionId())
	var clientSession *model.ClientCapabilitySession
	if clientSessionID != "" {
		if s.capabilitySessions == nil {
			return buildRuntimeReadinessSnapshot(
				actorID,
				agent,
				nil,
				model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
				"client_capability_session_authority_unavailable",
				nil,
				now,
			), nil
		}
		clientSession, err = s.capabilitySessions.GetActiveCapabilitySession(
			ctx,
			actorID,
			clientSessionID,
		)
		if err != nil {
			return nil, err
		}
		if clientSession == nil {
			return buildRuntimeReadinessSnapshot(
				actorID,
				agent,
				nil,
				model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
				"client_capability_session_unavailable",
				nil,
				now,
			), nil
		}
	}
	if strings.TrimSpace(agent.ProviderID) == "" || strings.TrimSpace(agent.ModelName) == "" {
		return buildRuntimeReadinessSnapshot(
			actorID,
			agent,
			nil,
			model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			"runtime_config_missing",
			clientSession,
			now,
		), nil
	}

	admission, admissionErr := s.admission.Resolve(
		ctx,
		actorID,
		agent.ProviderID,
		agent.ModelName,
	)
	if admissionErr != nil {
		return buildRuntimeReadinessSnapshot(
			actorID,
			agent,
			nil,
			model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			"runtime_admission_rejected",
			clientSession,
			now,
		), nil
	}
	return buildRuntimeReadinessSnapshot(
		actorID,
		agent,
		admission,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		"runtime_ready",
		clientSession,
		now,
	), nil
}

func buildRuntimeReadinessSnapshot(
	actorID string,
	agent *domain.Agent,
	admission *AdmissionSnapshot,
	state model.CapabilityReadinessState,
	reasonCode string,
	clientSession *model.ClientCapabilitySession,
	now time.Time,
) *model.CapabilityReadinessSnapshot {
	runtimeSnapshotID := ""
	var capabilities *model.RuntimeCapabilitySnapshot
	if admission != nil {
		runtimeSnapshotID = admission.SnapshotID
		capabilities = admission.Capabilities
		if capabilities != nil {
			capabilities.SnapshotId = admission.SnapshotID
		}
	}
	snapshotID := readinessSnapshotIdentity(
		actorID,
		agent.AgentID,
		agent.Version,
		runtimeSnapshotID,
		state,
		reasonCode,
		clientSession.GetSessionId(),
	)
	snapshot := &model.CapabilityReadinessSnapshot{
		SnapshotId:        snapshotID,
		Ptid:              actorID,
		AgentId:           agent.AgentID,
		RuntimeSnapshotId: runtimeSnapshotID,
		ModelCapabilities: capabilities,
		BindingRevisions: []string{
			fmt.Sprintf("agent:%s:%d", agent.AgentID, agent.Version),
		},
		Capabilities: []*model.CapabilityReadiness{
			{
				CapabilityId:      directModelCapabilityID,
				CapabilityVersion: "1",
				BindingId:         "agent:" + agent.AgentID,
				BindingRevision:   uint64(max(agent.Version, 0)),
				State:             state,
				Authority:         "station-runtime-admission",
				ReasonCode:        reasonCode,
			},
		},
		CreatedAt: timestamppb.New(now),
		ExpiresAt: timestamppb.New(now.Add(5 * time.Minute)),
	}
	if clientSession != nil {
		clientSessionID := clientSession.GetSessionId()
		snapshot.SelectedClientSessionId = &clientSessionID
		snapshot.BindingRevisions = append(
			snapshot.BindingRevisions,
			"capability-session:"+clientSessionID,
		)
		snapshot.ConnectionRevisions = append(
			snapshot.ConnectionRevisions,
			"client-connection:"+clientSession.GetConnectionId(),
		)
	}
	return snapshot
}

func readinessSnapshotIdentity(
	actorID string,
	agentID string,
	agentVersion int64,
	runtimeSnapshotID string,
	state model.CapabilityReadinessState,
	reasonCode string,
	clientSessionID string,
) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		actorID,
		agentID,
		strconv.FormatInt(agentVersion, 10),
		runtimeSnapshotID,
		state.String(),
		reasonCode,
		clientSessionID,
	}, "\x00")))
	return "capability-readiness-" + hex.EncodeToString(sum[:16])
}
