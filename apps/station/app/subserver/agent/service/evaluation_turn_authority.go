package service

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
)

func (s *TurnService) resolveTurnRuntimeSnapshot(
	ctx context.Context,
	config *TurnConfig,
) (*AdmissionSnapshot, error) {
	if config.PinnedRuntimeSnapshot == nil {
		if s.admissionResolver == nil {
			return nil, errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"runtime admission authority is required",
				nil,
			)
		}
		return s.admissionResolver.Resolve(
			ctx,
			config.ActorID,
			config.Provider,
			config.Model,
		)
	}
	pinned := proto.Clone(config.PinnedRuntimeSnapshot).(*model.RuntimeSnapshot)
	if pinned.GetRuntimeKind() != model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL ||
		strings.TrimSpace(pinned.GetProviderId()) == "" ||
		strings.TrimSpace(pinned.GetModelId()) == "" ||
		strings.TrimSpace(pinned.GetRuntimeProfileId()) == "" ||
		pinned.GetCapabilities() == nil ||
		pinned.GetBudget() == nil {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"pinned evaluation runtime snapshot is incomplete",
			nil,
		)
	}
	if pinned.GetProviderId() != config.Provider ||
		pinned.GetModelId() != config.Model {
		return nil, errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"pinned evaluation runtime tuple differs from the Turn request",
			nil,
		)
	}
	if err := validateRuntimeCapabilityProvenance(
		pinned.GetCapabilities(),
		time.Now().UTC(),
	); err != nil {
		return nil, err
	}
	return &AdmissionSnapshot{
		SnapshotID:            pinned.GetCapabilities().GetSnapshotId(),
		ProviderID:            pinned.GetProviderId(),
		ModelID:               pinned.GetModelId(),
		ProviderConfigVersion: pinned.GetProviderConfigVersion(),
		Capabilities: proto.Clone(
			pinned.GetCapabilities(),
		).(*model.RuntimeCapabilitySnapshot),
		Budget: cloneRuntimeBudget(pinned.GetBudget()),
	}, nil
}

func (s *TurnService) resolveTurnReadiness(
	ctx context.Context,
	config *TurnConfig,
	runtimeSnapshot *AdmissionSnapshot,
) (*model.CapabilityReadinessSnapshot, uint64, error) {
	if config.PinnedReadinessSnapshot == nil {
		if s.capabilityReadiness == nil {
			return nil, 0, errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"capability readiness authority is required",
				nil,
			)
		}
		return s.capabilityReadiness.ResolveForTurn(
			ctx,
			config.ActorID,
			config.AgentID,
			config.ClientCapabilitySessionID,
			runtimeSnapshot,
		)
	}
	readiness := proto.Clone(
		config.PinnedReadinessSnapshot,
	).(*model.CapabilityReadinessSnapshot)
	if config.ExpectedAgentVersion == 0 ||
		readiness.GetPtid() != config.ActorID ||
		readiness.GetAgentId() != config.AgentID ||
		readiness.GetRuntimeSnapshotId() != runtimeSnapshot.SnapshotID {
		return nil, 0, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"pinned evaluation readiness does not match the admitted Turn",
			nil,
		)
	}
	if selectedSessionID := readiness.GetSelectedClientSessionId(); selectedSessionID != "" &&
		selectedSessionID != config.ClientCapabilitySessionID {
		return nil, 0, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"pinned evaluation client session does not match the admitted Turn",
			nil,
		)
	}
	return readiness, config.ExpectedAgentVersion, nil
}
