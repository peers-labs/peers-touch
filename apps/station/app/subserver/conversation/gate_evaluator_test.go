package conversation

import (
	"context"
	"testing"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
)

type relationshipStub struct {
	mutual bool
	shared bool
}

func (s relationshipStub) AreMutualFollowers(context.Context, string, string) (bool, error) {
	return s.mutual, nil
}

func (relationshipStub) IsBlocked(context.Context, string, string) (bool, error) {
	return false, nil
}

func (s relationshipStub) HaveSharedConversation(context.Context, string, string) (bool, error) {
	return s.shared, nil
}

func TestCreateDirectAllowsMutualFollowers(t *testing.T) {
	evaluator := NewConversationGateEvaluator(
		relationshipStub{mutual: true},
		nil,
		nil,
	)
	ctx := coreauth.WithSubject(context.Background(), &coreauth.Subject{ID: "alice"})

	err := evaluator.Evaluate(ctx, social_gate.Operation{
		Action:     "create_direct",
		TargetPtid: "bob",
	})
	if err != nil {
		t.Fatalf("mutual followers should be allowed to create a direct conversation: %v", err)
	}
}

func TestCreateDirectRejectsActorsWithoutRelationship(t *testing.T) {
	evaluator := NewConversationGateEvaluator(relationshipStub{}, nil, nil)
	ctx := coreauth.WithSubject(context.Background(), &coreauth.Subject{ID: "alice"})

	err := evaluator.Evaluate(ctx, social_gate.Operation{
		Action:     "create_direct",
		TargetPtid: "bob",
	})
	if err == nil {
		t.Fatal("actors without a mutual follow or shared conversation must be rejected")
	}
	denied, ok := err.(*social_gate.PolicyDeniedError)
	if !ok || denied.Code != "RELATIONSHIP_REQUIRED" {
		t.Fatalf("unexpected policy error: %v", err)
	}
}

type crossAuthorizerStub struct {
	called bool
	deny   bool
	last   social_gate.CrossStationOperation
}

func (s *crossAuthorizerStub) AuthorizeCrossStation(_ context.Context, op social_gate.CrossStationOperation) error {
	s.called = true
	s.last = op
	if s.deny {
		return &social_gate.PolicyDeniedError{Code: "NOT_MEMBER"}
	}
	return nil
}

func gateSubject() context.Context {
	return coreauth.WithSubject(context.Background(), &coreauth.Subject{ID: "alice"})
}

// Same-station Direct creation needs no Federation and must never invoke the
// cross-station authorizer, even without a relationship open-mode querier.
func TestCreateDirectSameStationUsesLocalScopeWithoutCrossAuthorization(t *testing.T) {
	cross := &crossAuthorizerStub{}
	evaluator := NewConversationGateEvaluator(nil, nil, cross)

	err := evaluator.Evaluate(gateSubject(), social_gate.Operation{
		Action:               "create_direct",
		TargetPtid:           "bob",
		ScopeKind:            social_gate.ScopeKindLocal,
		SubjectStationPeerID: "12D3KooWStation",
		TargetStationPeerID:  "12D3KooWStation",
	})
	if err != nil {
		t.Fatalf("same-station local scope must be allowed: %v", err)
	}
	if cross.called {
		t.Fatal("cross-station authorizer must not be called for a same-station operation")
	}
}

// A Federation scope on a same-station operation is rejected fail-closed.
func TestCreateDirectSameStationRejectsFederationScope(t *testing.T) {
	cross := &crossAuthorizerStub{}
	evaluator := NewConversationGateEvaluator(nil, nil, cross)

	err := evaluator.Evaluate(gateSubject(), social_gate.Operation{
		Action:               "create_direct",
		TargetPtid:           "bob",
		ScopeKind:            social_gate.ScopeKindFederation,
		Scope:                "fed_01J0other",
		SubjectStationPeerID: "12D3KooWStation",
		TargetStationPeerID:  "12D3KooWStation",
	})
	if err == nil {
		t.Fatal("federation scope on a same-station action must be rejected")
	}
	if denied, ok := err.(*social_gate.PolicyDeniedError); !ok || denied.Code != "SCOPE_STATION_MISMATCH" {
		t.Fatalf("want SCOPE_STATION_MISMATCH, got %v", err)
	}
	if cross.called {
		t.Fatal("cross authorizer must not be called on a scope mismatch")
	}
}

// A local scope may never span two different Home Stations.
func TestCreateDirectLocalScopeRejectedAcrossStations(t *testing.T) {
	cross := &crossAuthorizerStub{}
	evaluator := NewConversationGateEvaluator(nil, nil, cross)

	err := evaluator.Evaluate(gateSubject(), social_gate.Operation{
		Action:               "create_direct",
		TargetPtid:           "bob",
		ScopeKind:            social_gate.ScopeKindLocal,
		SubjectStationPeerID: "12D3KooWStationA",
		TargetStationPeerID:  "12D3KooWStationB",
	})
	if err == nil {
		t.Fatal("local scope across stations must be rejected")
	}
	if denied, ok := err.(*social_gate.PolicyDeniedError); !ok || denied.Code != "SCOPE_STATION_MISMATCH" {
		t.Fatalf("want SCOPE_STATION_MISMATCH, got %v", err)
	}
}

// Cross-station creation delegates to the federation authorizer under scope.
func TestCreateDirectCrossStationInvokesAuthorizer(t *testing.T) {
	cross := &crossAuthorizerStub{}
	evaluator := NewConversationGateEvaluator(nil, nil, cross)

	err := evaluator.Evaluate(gateSubject(), social_gate.Operation{
		Action:               "create_direct",
		TargetPtid:           "bob",
		ScopeKind:            social_gate.ScopeKindFederation,
		Scope:                "fed_01J0network",
		SubjectStationPeerID: "12D3KooWStationA",
		TargetStationPeerID:  "12D3KooWStationB",
	})
	if err != nil {
		t.Fatalf("authorized cross-station action must pass: %v", err)
	}
	if !cross.called || cross.last.Scope != "fed_01J0network" ||
		cross.last.SubjectStationPeerID != "12D3KooWStationA" ||
		cross.last.TargetStationPeerID != "12D3KooWStationB" {
		t.Fatalf("authorizer received wrong operation: %+v", cross.last)
	}
}

func TestCreateDirectCrossStationDeniedByAuthorizer(t *testing.T) {
	evaluator := NewConversationGateEvaluator(nil, nil, &crossAuthorizerStub{deny: true})

	err := evaluator.Evaluate(gateSubject(), social_gate.Operation{
		Action:               "create_direct",
		TargetPtid:           "bob",
		ScopeKind:            social_gate.ScopeKindFederation,
		Scope:                "fed_01J0network",
		SubjectStationPeerID: "12D3KooWStationA",
		TargetStationPeerID:  "12D3KooWStationB",
	})
	if err == nil {
		t.Fatal("denied cross-station authorization must fail the gate")
	}
	if denied, ok := err.(*social_gate.PolicyDeniedError); !ok || denied.Code != "FEDERATION_UNAUTHORIZED" {
		t.Fatalf("want FEDERATION_UNAUTHORIZED, got %v", err)
	}
}
