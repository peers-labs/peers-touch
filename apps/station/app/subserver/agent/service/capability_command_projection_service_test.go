package service

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestCommandCapabilitySnapshotPinsBindingManifestAndReadiness(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "command_snapshot")
	ctx := context.Background()
	seedCapabilityAuthorityAgent(
		t,
		authority.db,
		"agent-1",
		"ptid:person:owner",
		4,
	)
	manifest := capabilityAuthorityTestManifest()
	manifest.DisplayMetadata = &model.CapabilityDisplayMetadata{
		Name:        "Workspace Search",
		Description: "Search the governed workspace.",
	}
	if _, err := authority.RegisterManifest(ctx, manifest); err != nil {
		t.Fatalf("register manifest: %v", err)
	}
	binding, err := authority.UpsertBinding(
		ctx,
		"ptid:person:owner",
		capabilityAuthorityBindingRequest("", 0, 4, "command-binding"),
	)
	if err != nil {
		t.Fatalf("create binding: %v", err)
	}
	now := time.Date(2026, time.October, 20, 12, 0, 0, 0, time.UTC)
	readiness := &model.CapabilityReadinessSnapshot{
		SnapshotId: "readiness-command",
		Ptid:       "ptid:person:owner",
		AgentId:    "agent-1",
		Capabilities: []*model.CapabilityReadiness{{
			CapabilityId:      binding.GetCapabilityId(),
			CapabilityVersion: binding.GetCapabilityVersion(),
			BindingId:         binding.GetBindingId(),
			BindingRevision:   binding.GetRevision(),
			State:             model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
			Authority:         "station",
		}},
		CreatedAt: timestamppb.New(now),
		ExpiresAt: timestamppb.New(now.Add(time.Minute)),
	}

	snapshot, err := authority.BuildCommandCapabilitySnapshot(
		ctx,
		"ptid:person:owner",
		"agent-1",
		readiness,
	)
	if err != nil {
		t.Fatalf("build command snapshot: %v", err)
	}
	if snapshot.GetAgentVersion() != 4 ||
		snapshot.GetSnapshotId() == "" ||
		len(snapshot.GetItems()) != 1 {
		t.Fatalf("unexpected command snapshot: %+v", snapshot)
	}
	item := snapshot.GetItems()[0]
	if item.GetKind() !=
		model.AgentCommandCapabilityKind_AGENT_COMMAND_CAPABILITY_KIND_TOOL ||
		item.GetCapabilityVersion() != "1" ||
		item.GetBindingRevision() != binding.GetRevision() ||
		item.GetReadiness() !=
			model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY ||
		item.GetDisplayMetadata().GetName() != "Workspace Search" {
		t.Fatalf("command item lost authority lineage: %+v", item)
	}
}

func TestCommandCapabilitySnapshotRejectsMismatchedAuthority(t *testing.T) {
	authority := newCapabilityAuthorityTestService(t, "command_snapshot_mismatch")
	_, err := authority.BuildCommandCapabilitySnapshot(
		context.Background(),
		"ptid:person:owner",
		"agent-1",
		&model.CapabilityReadinessSnapshot{
			Ptid:      "ptid:person:other",
			AgentId:   "agent-1",
			CreatedAt: timestamppb.Now(),
			ExpiresAt: timestamppb.New(time.Now().Add(time.Minute)),
		},
	)
	if err == nil {
		t.Fatal("mismatched actor readiness must fail closed")
	}
}
