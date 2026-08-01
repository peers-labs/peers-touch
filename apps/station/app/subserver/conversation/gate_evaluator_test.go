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
