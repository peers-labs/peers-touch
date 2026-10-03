package service

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestRuntimeEvidenceFrozenProfileIsExplicit(t *testing.T) {
	svc := NewRuntimeEvidenceService()
	snapshot, err := svc.EffectiveProfile(context.Background(), "actor-1", "agent-1")
	if err != nil {
		t.Fatalf("effective profile: %v", err)
	}
	if snapshot.GetProfileId() != modernChatAgentProfileID ||
		snapshot.GetProfileRevision() != modernChatAgentProfileRevision {
		t.Fatalf("unexpected profile identity: %+v", snapshot)
	}

	states := make(map[string]model.RuntimeAdvertisementState)
	for _, runtime := range snapshot.GetRuntimes() {
		states[runtime.GetRuntimeId()] = runtime.GetState()
	}
	if states[runtimeIDDirectModel] != model.RuntimeAdvertisementState_RUNTIME_ADVERTISEMENT_STATE_READY {
		t.Fatalf("Direct Model must be ready: %+v", states)
	}
	for _, runtimeID := range []string{runtimeIDTraeCLI, runtimeIDExternalAgent} {
		if states[runtimeID] != model.RuntimeAdvertisementState_RUNTIME_ADVERTISEMENT_STATE_NOT_ADVERTISED {
			t.Fatalf("%s must be explicitly not advertised: %+v", runtimeID, states)
		}
	}
}

func TestRuntimeEvidenceAdvertisesHealthyExternalAdapter(t *testing.T) {
	svc := NewRuntimeEvidenceService()
	svc.SetExternalRuntimeAvailability(func() bool { return true })
	snapshot, err := svc.EffectiveProfile(
		context.Background(),
		"actor-1",
		"agent-1",
	)
	if err != nil {
		t.Fatalf("effective profile: %v", err)
	}
	for _, runtime := range snapshot.GetRuntimes() {
		if runtime.GetRuntimeId() != runtimeIDExternalAgent {
			continue
		}
		if runtime.GetState() !=
			model.RuntimeAdvertisementState_RUNTIME_ADVERTISEMENT_STATE_READY ||
			runtime.GetReasonCode() != "session_adapter_ready" {
			t.Fatalf("external runtime advertisement = %+v", runtime)
		}
		return
	}
	t.Fatal("external runtime advertisement is missing")
}

func TestRuntimeActivityIsMonotonicAndActorScoped(t *testing.T) {
	svc := NewRuntimeEvidenceService()
	runtimeKind := model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT

	before, err := svc.Activity(context.Background(), "actor-1", runtimeKind, runtimeIDExternalAgent)
	if err != nil {
		t.Fatalf("before activity: %v", err)
	}
	if err := svc.RecordActivity(
		"actor-1",
		runtimeKind,
		runtimeIDExternalAgent,
		RuntimeActivityProcessStarted,
	); err != nil {
		t.Fatalf("record activity: %v", err)
	}
	after, err := svc.Activity(context.Background(), "actor-1", runtimeKind, runtimeIDExternalAgent)
	if err != nil {
		t.Fatalf("after activity: %v", err)
	}
	if before.GetCounterEpoch() != after.GetCounterEpoch() ||
		before.GetOwnerInstanceId() != after.GetOwnerInstanceId() {
		t.Fatal("counter identity changed within one Station process")
	}
	if after.GetCounters().GetProcessesStarted() !=
		before.GetCounters().GetProcessesStarted()+1 {
		t.Fatalf("process counter did not advance: before=%+v after=%+v", before, after)
	}

	otherActor, err := svc.Activity(context.Background(), "actor-2", runtimeKind, runtimeIDExternalAgent)
	if err != nil {
		t.Fatalf("other actor activity: %v", err)
	}
	if otherActor.GetCounters().GetProcessesStarted() != 0 {
		t.Fatalf("activity leaked across actors: %+v", otherActor)
	}
}

func TestRuntimeActivityRejectsUnknownCandidate(t *testing.T) {
	svc := NewRuntimeEvidenceService()
	if _, err := svc.Activity(
		context.Background(),
		"actor-1",
		model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
		"unknown-runtime",
	); err == nil {
		t.Fatal("unknown runtime activity must fail closed")
	}
}
