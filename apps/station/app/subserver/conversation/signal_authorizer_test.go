package conversation

import (
	"context"
	"testing"
	"time"
)

type sequencedSignalRelationshipStub struct {
	blocked      bool
	sharedAfter  int
	blockChecks  int
	sharedChecks int
}

func (*sequencedSignalRelationshipStub) AreMutualFollowers(
	context.Context,
	string,
	string,
) (bool, error) {
	return false, nil
}

func (s *sequencedSignalRelationshipStub) IsBlocked(
	context.Context,
	string,
	string,
) (bool, error) {
	s.blockChecks++
	return s.blocked, nil
}

func (s *sequencedSignalRelationshipStub) HaveSharedConversation(
	context.Context,
	string,
	string,
) (bool, error) {
	s.sharedChecks++
	return s.sharedAfter > 0 && s.sharedChecks >= s.sharedAfter, nil
}

func TestSignalAuthorizationWaitsForFollowerProjectionConvergence(t *testing.T) {
	relationships := &sequencedSignalRelationshipStub{sharedAfter: 2}
	authorizer := &conversationSignalAuthorizer{rel: relationships}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	allowed, err := authorizer.canSignal(ctx, "ptid:alice", "ptid:bob")
	if err != nil {
		t.Fatal(err)
	}
	if !allowed {
		t.Fatal("signal should be allowed after shared conversation converges")
	}
	if relationships.sharedChecks != 2 {
		t.Fatalf(
			"shared conversation checks = %d, want 2",
			relationships.sharedChecks,
		)
	}
}

func TestSignalAuthorizationRejectsBlockedPairWithoutWaiting(t *testing.T) {
	relationships := &sequencedSignalRelationshipStub{
		blocked:     true,
		sharedAfter: 1,
	}
	authorizer := &conversationSignalAuthorizer{rel: relationships}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	allowed, err := authorizer.canSignal(ctx, "ptid:alice", "ptid:bob")
	if err != nil {
		t.Fatal(err)
	}
	if allowed {
		t.Fatal("blocked actors must not be allowed to signal")
	}
	if relationships.sharedChecks != 0 {
		t.Fatalf(
			"shared conversation checks = %d, want 0",
			relationships.sharedChecks,
		)
	}
}

func TestSignalAuthorizationFailsClosedWhenProjectionDoesNotConverge(t *testing.T) {
	relationships := &sequencedSignalRelationshipStub{}
	authorizer := &conversationSignalAuthorizer{rel: relationships}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()

	allowed, err := authorizer.canSignal(ctx, "ptid:alice", "ptid:bob")
	if err != nil {
		t.Fatal(err)
	}
	if allowed {
		t.Fatal("missing shared conversation must remain denied")
	}
	if relationships.sharedChecks != 1 {
		t.Fatalf(
			"shared conversation checks = %d, want 1",
			relationships.sharedChecks,
		)
	}
}
