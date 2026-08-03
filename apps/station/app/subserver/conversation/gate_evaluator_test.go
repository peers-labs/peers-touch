package conversation

import (
	"context"
	"net/http"
	"testing"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
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

type memberLookupService struct {
	Service
	member *chat.ConversationMember
}

func (s memberLookupService) GetMember(context.Context, string, string) (*chat.ConversationMember, error) {
	return s.member, nil
}

func TestRequireActiveMembershipRejectsRemovedMember(t *testing.T) {
	ctx := coreauth.WithSubject(context.Background(), &coreauth.Subject{ID: "alice"})
	subserver := &subServer{service: memberLookupService{
		member: &chat.ConversationMember{
			ConversationId: "group-1",
			Ptid:           "alice",
			MemberStatus:   chat.MemberStatus_MEMBER_STATUS_REMOVED,
		},
	}}

	err := subserver.requireActiveMembership(ctx, "group-1")
	handlerErr, ok := err.(*server.HandlerError)
	if !ok || handlerErr.Code != http.StatusForbidden {
		t.Fatalf("removed member should receive HTTP 403, got %v", err)
	}
}

func TestRequireActiveMembershipAllowsActiveMember(t *testing.T) {
	ctx := coreauth.WithSubject(context.Background(), &coreauth.Subject{ID: "alice"})
	subserver := &subServer{service: memberLookupService{
		member: &chat.ConversationMember{
			ConversationId: "group-1",
			Ptid:           "alice",
			MemberStatus:   chat.MemberStatus_MEMBER_STATUS_ACTIVE,
		},
	}}

	if err := subserver.requireActiveMembership(ctx, "group-1"); err != nil {
		t.Fatalf("active member should be allowed, got %v", err)
	}
}
