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
