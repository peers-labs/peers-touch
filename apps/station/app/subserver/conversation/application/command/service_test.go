package command

import (
	"errors"
	"testing"

	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
)

func TestForwardableCommandKindIncludesMemberAuthority(t *testing.T) {
	if !forwardableCommandKind(domainevent.KindMemberAuthority) {
		t.Fatal("member-authority command is not admitted by SubmitForwarded")
	}
}

func TestDirectCreationFailureStagePreservesCause(t *testing.T) {
	cause := errors.New("private persistence failure")
	staged := directCreationStage("persist_transition", cause)

	stage, ok := DirectCreationFailureStage(staged)
	if !ok || stage != "persist_transition" {
		t.Fatalf("stage = %q, ok = %v", stage, ok)
	}
	if !errors.Is(staged, cause) {
		t.Fatal("staged error did not retain its cause")
	}
	if stage, ok := DirectCreationFailureStage(cause); ok || stage != "" {
		t.Fatalf("unstaged error returned stage = %q, ok = %v", stage, ok)
	}

	persisted := directPersistTransitionStage(
		transitionPersistenceStage("enqueue_device_inbox", cause),
	)
	stage, ok = DirectCreationFailureStage(persisted)
	if !ok || stage != "persist_transition_enqueue_device_inbox" {
		t.Fatalf("persistence stage = %q, ok = %v", stage, ok)
	}
	if !errors.Is(persisted, cause) {
		t.Fatal("persistence stage did not retain its cause")
	}
}
