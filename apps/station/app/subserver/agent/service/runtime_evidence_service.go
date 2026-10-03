package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

const (
	modernChatAgentProfileID       = "modern-chat-agent-v1"
	modernChatAgentProfileRevision = uint64(1)
	runtimeIDDirectModel           = "direct-model"
	runtimeIDExternalAgent         = "external-agent"
	runtimeIDTraeCLI               = "trae-cli"
)

type RuntimeActivityKind int

const (
	RuntimeActivityBindingCreated RuntimeActivityKind = iota + 1
	RuntimeActivityExternalSessionCreated
	RuntimeActivityHomeCreated
	RuntimeActivityProcessStarted
	RuntimeActivityWorkspaceCreated
)

type runtimeActivityKey struct {
	actorID   string
	runtimeID string
}

type runtimeActivityCounters struct {
	runtimeBindingsCreated  uint64
	externalSessionsCreated uint64
	runtimeHomesCreated     uint64
	processesStarted        uint64
	workspacesCreated       uint64
}

type RuntimeEvidenceService struct {
	mu              sync.RWMutex
	ownerInstanceID string
	counterEpoch    string
	counters        map[runtimeActivityKey]runtimeActivityCounters
	now             func() time.Time
	externalReady   func() bool
}

func NewRuntimeEvidenceService() *RuntimeEvidenceService {
	return &RuntimeEvidenceService{
		ownerInstanceID: uuid.NewString(),
		counterEpoch:    uuid.NewString(),
		counters:        make(map[runtimeActivityKey]runtimeActivityCounters),
		now:             func() time.Time { return time.Now().UTC() },
	}
}

func (s *RuntimeEvidenceService) SetExternalRuntimeAvailability(available func() bool) {
	s.externalReady = available
}

func (s *RuntimeEvidenceService) EffectiveProfile(
	_ context.Context,
	actorID string,
	agentID string,
) (*model.EffectiveRuntimeProfileSnapshot, error) {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"authenticated actor is required",
			nil,
		)
	}
	agentID = strings.TrimSpace(agentID)
	externalState := model.RuntimeAdvertisementState_RUNTIME_ADVERTISEMENT_STATE_NOT_ADVERTISED
	externalReason := "external_adapter_unavailable"
	if s.externalReady != nil && s.externalReady() {
		externalState = model.RuntimeAdvertisementState_RUNTIME_ADVERTISEMENT_STATE_READY
		externalReason = "session_adapter_ready"
	}
	readinessID := runtimeProfileIdentity(actorID, agentID, externalState)
	return &model.EffectiveRuntimeProfileSnapshot{
		SnapshotId:          "runtime-profile-" + uuid.NewString(),
		Ptid:                actorID,
		AgentId:             agentID,
		ProfileId:           modernChatAgentProfileID,
		ProfileRevision:     modernChatAgentProfileRevision,
		ReadinessSnapshotId: readinessID,
		Runtimes: []*model.EffectiveRuntimeAdvertisement{
			{
				RuntimeKind: model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
				RuntimeId:   runtimeIDDirectModel,
				State:       model.RuntimeAdvertisementState_RUNTIME_ADVERTISEMENT_STATE_READY,
				ReasonCode:  "frozen_profile_required_runtime",
			},
			{
				RuntimeKind: model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
				RuntimeId:   runtimeIDTraeCLI,
				State:       model.RuntimeAdvertisementState_RUNTIME_ADVERTISEMENT_STATE_NOT_ADVERTISED,
				ReasonCode:  "frozen_profile_cli_excluded",
			},
			{
				RuntimeKind: model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT,
				RuntimeId:   runtimeIDExternalAgent,
				State:       externalState,
				ReasonCode:  externalReason,
			},
		},
		ObservedAt: timestamppb.New(s.now()),
	}, nil
}

func (s *RuntimeEvidenceService) Activity(
	_ context.Context,
	actorID string,
	runtimeKind model.RuntimeKind,
	runtimeID string,
) (*model.RuntimeActivitySnapshot, error) {
	actorID = strings.TrimSpace(actorID)
	runtimeID = strings.TrimSpace(runtimeID)
	if actorID == "" {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"authenticated actor is required",
			nil,
		)
	}
	if !knownConditionalRuntime(runtimeKind, runtimeID) {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"runtime activity requires a known conditional runtime",
			nil,
		)
	}

	s.mu.RLock()
	counters := s.counters[runtimeActivityKey{actorID: actorID, runtimeID: runtimeID}]
	s.mu.RUnlock()

	return &model.RuntimeActivitySnapshot{
		SnapshotId:      "runtime-activity-" + uuid.NewString(),
		Owner:           "station",
		OwnerInstanceId: s.ownerInstanceID,
		Ptid:            actorID,
		RuntimeKind:     runtimeKind,
		RuntimeId:       runtimeID,
		CounterEpoch:    s.counterEpoch,
		Counters:        cloneRuntimeActivityCounters(counters),
		ObservedAt:      timestamppb.New(s.now()),
	}, nil
}

func (s *RuntimeEvidenceService) RecordActivity(
	actorID string,
	runtimeKind model.RuntimeKind,
	runtimeID string,
	activity RuntimeActivityKind,
) error {
	actorID = strings.TrimSpace(actorID)
	runtimeID = strings.TrimSpace(runtimeID)
	if actorID == "" || !knownConditionalRuntime(runtimeKind, runtimeID) {
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"runtime activity requires actor and known conditional runtime",
			nil,
		)
	}

	key := runtimeActivityKey{actorID: actorID, runtimeID: runtimeID}
	s.mu.Lock()
	defer s.mu.Unlock()
	counters := s.counters[key]
	switch activity {
	case RuntimeActivityBindingCreated:
		counters.runtimeBindingsCreated++
	case RuntimeActivityExternalSessionCreated:
		counters.externalSessionsCreated++
	case RuntimeActivityHomeCreated:
		counters.runtimeHomesCreated++
	case RuntimeActivityProcessStarted:
		counters.processesStarted++
	case RuntimeActivityWorkspaceCreated:
		counters.workspacesCreated++
	default:
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"runtime activity kind is invalid",
			nil,
		)
	}
	s.counters[key] = counters
	return nil
}

func runtimeProfileIdentity(
	actorID string,
	agentID string,
	externalState model.RuntimeAdvertisementState,
) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		actorID,
		agentID,
		modernChatAgentProfileID,
		"1",
		runtimeIDDirectModel + ":ready",
		runtimeIDTraeCLI + ":not-advertised",
		runtimeIDExternalAgent + ":" + externalState.String(),
	}, "\x00")))
	return "runtime-readiness-" + hex.EncodeToString(sum[:16])
}

func knownConditionalRuntime(runtimeKind model.RuntimeKind, runtimeID string) bool {
	switch runtimeID {
	case runtimeIDTraeCLI:
		return runtimeKind == model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL
	case runtimeIDExternalAgent:
		return runtimeKind == model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT
	default:
		return false
	}
}

func cloneRuntimeActivityCounters(
	counters runtimeActivityCounters,
) *model.RuntimeActivityCounters {
	return &model.RuntimeActivityCounters{
		RuntimeBindingsCreated:  counters.runtimeBindingsCreated,
		ExternalSessionsCreated: counters.externalSessionsCreated,
		RuntimeHomesCreated:     counters.runtimeHomesCreated,
		ProcessesStarted:        counters.processesStarted,
		WorkspacesCreated:       counters.workspacesCreated,
	}
}
