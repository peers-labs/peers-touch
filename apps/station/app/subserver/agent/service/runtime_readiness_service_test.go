package service

import (
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestBuildRuntimeReadinessSnapshotReady(t *testing.T) {
	now := time.Date(2026, 8, 25, 8, 0, 0, 0, time.UTC)
	agent := &domain.Agent{AgentID: "agent-1", Version: 3}
	admission := &AdmissionSnapshot{
		SnapshotID:   "runtime-snapshot-1",
		Capabilities: &model.RuntimeCapabilitySnapshot{},
	}
	snapshot := buildRuntimeReadinessSnapshot(
		"ptid:actor-1",
		agent,
		admission,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		"runtime_ready",
		&model.ClientCapabilitySession{
			SessionId:    "session-1",
			ConnectionId: "connection-1",
		},
		now,
	)

	if snapshot.GetRuntimeSnapshotId() != admission.SnapshotID ||
		snapshot.GetModelCapabilities().GetSnapshotId() != admission.SnapshotID {
		t.Fatalf("runtime snapshot identity mismatch: %+v", snapshot)
	}
	if snapshot.GetSelectedClientSessionId() != "session-1" {
		t.Fatalf("selected client session missing: %+v", snapshot)
	}
	if len(snapshot.GetBindingRevisions()) != 2 ||
		snapshot.GetBindingRevisions()[1] != "capability-session:session-1" ||
		len(snapshot.GetConnectionRevisions()) != 1 ||
		snapshot.GetConnectionRevisions()[0] != "client-connection:connection-1" {
		t.Fatalf("selected client session revisions missing: %+v", snapshot)
	}
	readiness := snapshot.GetCapabilities()
	if len(readiness) != 1 ||
		readiness[0].GetState() != model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY ||
		readiness[0].GetBindingRevision() != 3 {
		t.Fatalf("unexpected readiness projection: %+v", readiness)
	}
	if !snapshot.GetExpiresAt().AsTime().Equal(now.Add(5 * time.Minute)) {
		t.Fatalf("unexpected readiness expiry: %v", snapshot.GetExpiresAt())
	}
}

func TestBuildRuntimeReadinessSnapshotBlocked(t *testing.T) {
	now := time.Date(2026, 8, 25, 8, 0, 0, 0, time.UTC)
	snapshot := buildRuntimeReadinessSnapshot(
		"ptid:actor-1",
		&domain.Agent{AgentID: "agent-1", Version: 1},
		nil,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
		"runtime_config_missing",
		nil,
		now,
	)

	if snapshot.GetRuntimeSnapshotId() != "" ||
		snapshot.GetModelCapabilities() != nil ||
		snapshot.GetSelectedClientSessionId() != "" {
		t.Fatalf("blocked readiness invented runtime authority: %+v", snapshot)
	}
	readiness := snapshot.GetCapabilities()
	if len(readiness) != 1 ||
		readiness[0].GetState() != model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED ||
		readiness[0].GetReasonCode() != "runtime_config_missing" {
		t.Fatalf("unexpected blocked readiness: %+v", readiness)
	}
}

func TestReadinessSnapshotIdentityChangesWithVersion(t *testing.T) {
	first := readinessSnapshotIdentity(
		"actor",
		"agent",
		1,
		"runtime",
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		"runtime_ready",
		"",
	)
	second := readinessSnapshotIdentity(
		"actor",
		"agent",
		2,
		"runtime",
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		"runtime_ready",
		"",
	)
	if first == second {
		t.Fatal("readiness snapshot must change with Agent revision")
	}
}
