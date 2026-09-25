package gatekeeper

import (
	"context"
	"strings"
	"testing"
	"time"

	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	"google.golang.org/protobuf/encoding/protojson"
)

type passingGatekeeper struct {
	gateType pb.AccessGateType
	gateID   string
}

func (g passingGatekeeper) Type() pb.AccessGateType { return g.gateType }
func (g passingGatekeeper) GateID() string          { return g.gateID }
func (g passingGatekeeper) Evaluate(context.Context, *EvalContext) *pb.AccessGate {
	return &pb.AccessGate{
		GateId: g.gateID,
		Type:   g.gateType,
		State:  pb.AccessGateState_ACCESS_GATE_STATE_PASSED,
	}
}

func TestDecisionCarriesPTIDActorRefWithCanonicalJSON(t *testing.T) {
	const ptid = "ptid:v1:actor:peers:p:alice:fingerprint"
	registry := NewRegistry(func(string, *actormodel.ActorRef) string { return "grant-1" })

	decision := registry.Decide(context.Background(), &EvalContext{
		AttemptID: "attempt-1",
		Actor: &actormodel.ActorRef{
			Ptid: ptid,
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		ExpiresAt: time.Unix(1_800_000_000, 0),
	}, nil)

	if decision.GetActor().GetPtid() != ptid {
		t.Fatalf("actor PTID = %q, want %q", decision.GetActor().GetPtid(), ptid)
	}
	if decision.GetState() != pb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED {
		t.Fatalf("state = %v, want granted", decision.GetState())
	}

	encoded, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(decision)
	if err != nil {
		t.Fatalf("marshal AccessDecision: %v", err)
	}
	jsonBody := string(encoded)
	if !strings.Contains(jsonBody, `"attempt_id":"attempt-1"`) {
		t.Fatalf("AccessDecision did not use snake_case keys: %s", jsonBody)
	}
	if !strings.Contains(jsonBody, `"state":"ACCESS_DECISION_STATE_GRANTED"`) {
		t.Fatalf("AccessDecision did not use string enum: %s", jsonBody)
	}
	if strings.Contains(jsonBody, "actor_id") {
		t.Fatalf("AccessDecision leaked actor_id: %s", jsonBody)
	}
}

func TestDecideFailsClosedForUnregisteredGate(t *testing.T) {
	grantCalls := 0
	registry := NewRegistry(func(string, *actormodel.ActorRef) string {
		grantCalls++
		return "grant-1"
	})
	registry.Register(passingGatekeeper{
		gateType: pb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY,
		gateID:   "station.capability",
	})

	decision := registry.Decide(context.Background(), &EvalContext{
		AttemptID: "attempt-1",
		Actor: &actormodel.ActorRef{
			Ptid: "ptid:v1:actor:peers:p:alice:fingerprint",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		ExpiresAt: time.Unix(1_800_000_000, 0),
	}, []pb.AccessGateType{
		pb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY,
		pb.AccessGateType_ACCESS_GATE_TYPE_DEVICE_TRUST,
	})

	if decision.GetState() != pb.AccessDecisionState_ACCESS_DECISION_STATE_BLOCKED {
		t.Fatalf("state = %v, want blocked", decision.GetState())
	}
	if decision.GetAccessGrantId() != "" || grantCalls != 0 {
		t.Fatalf("unsupported gate minted access grant %q with %d grant calls", decision.GetAccessGrantId(), grantCalls)
	}
	if len(decision.GetGates()) != 1 {
		t.Fatalf("evaluated gates = %d, want only the registered predecessor", len(decision.GetGates()))
	}
}

func TestDecideFailsClosedForInvalidGateType(t *testing.T) {
	registry := NewRegistry(func(string, *actormodel.ActorRef) string {
		t.Fatal("invalid gate type must not mint an access grant")
		return ""
	})

	decision := registry.Decide(context.Background(), &EvalContext{
		AttemptID: "attempt-1",
		Actor: &actormodel.ActorRef{
			Ptid: "ptid:v1:actor:peers:p:alice:fingerprint",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		ExpiresAt: time.Unix(1_800_000_000, 0),
	}, []pb.AccessGateType{pb.AccessGateType(999)})

	if decision.GetState() != pb.AccessDecisionState_ACCESS_DECISION_STATE_BLOCKED {
		t.Fatalf("state = %v, want blocked", decision.GetState())
	}
	if decision.GetCurrentGateId() != "" {
		t.Fatalf("current gate id = %q, want empty for an unsupported gate", decision.GetCurrentGateId())
	}
}
