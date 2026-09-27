package domain_test

import (
	"testing"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestSocialRelationshipEventFormsDirectionalHashChain(t *testing.T) {
	now := time.Date(2026, time.September, 19, 6, 0, 0, 0, time.UTC)
	block := relationshipCommand(
		model.SocialRelationshipAction_SOCIAL_RELATIONSHIP_ACTION_BLOCK,
		"command-block",
		0,
		now,
	)
	event, duplicate, err := domain.NewSocialRelationshipEvent(nil, block, now)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate || !event.GetBlocked() || event.GetRevision() != 1 {
		t.Fatalf("block event = %+v duplicate=%v", event, duplicate)
	}
	if len(event.GetInvalidationClasses()) != 4 {
		t.Fatalf(
			"block invalidation count = %d, want 4",
			len(event.GetInvalidationClasses()),
		)
	}
	if err := domain.ValidateSocialRelationshipEvent(event); err != nil {
		t.Fatal(err)
	}
	state, duplicate, err := domain.ApplySocialRelationshipEvent(nil, event)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate || !state.Blocked || state.Revision != 1 {
		t.Fatalf("block state = %+v duplicate=%v", state, duplicate)
	}
	if _, duplicate, err := domain.ApplySocialRelationshipEvent(&state, event); err != nil ||
		!duplicate {
		t.Fatalf("event replay duplicate=%v error=%v", duplicate, err)
	}

	unblock := relationshipCommand(
		model.SocialRelationshipAction_SOCIAL_RELATIONSHIP_ACTION_UNBLOCK,
		"command-unblock",
		1,
		now.Add(time.Minute),
	)
	unblockEvent, duplicate, err :=
		domain.NewSocialRelationshipEvent(&state, unblock, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if duplicate ||
		unblockEvent.GetBlocked() ||
		unblockEvent.GetRevision() != 2 ||
		len(unblockEvent.GetInvalidationClasses()) != 0 {
		t.Fatalf("unblock event = %+v duplicate=%v", unblockEvent, duplicate)
	}
	next, duplicate, err :=
		domain.ApplySocialRelationshipEvent(&state, unblockEvent)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate || next.Blocked || next.Revision != 2 {
		t.Fatalf("unblock state = %+v duplicate=%v", next, duplicate)
	}
}

func TestSocialRelationshipCommandRejectsStaleRevision(t *testing.T) {
	now := time.Date(2026, time.September, 19, 6, 0, 0, 0, time.UTC)
	current := &domain.DirectionalRelationshipState{
		ActorPTID:               relationshipAlicePTID,
		TargetActorPTID:         relationshipBobPTID,
		ActorHomeStationPeerID:  "station-a",
		TargetHomeStationPeerID: "station-b",
		Blocked:                 true,
		Revision:                2,
		LastEventHash:           make([]byte, 32),
		UpdatedAt:               now,
	}
	command := relationshipCommand(
		model.SocialRelationshipAction_SOCIAL_RELATIONSHIP_ACTION_UNBLOCK,
		"command-stale",
		1,
		now,
	)
	if _, _, err := domain.NewSocialRelationshipEvent(
		current,
		command,
		now,
	); domain.FederationErrorCodeOf(err) != domain.FederationErrorStateConflict {
		t.Fatalf("stale revision error = %v", err)
	}
}

const (
	relationshipAlicePTID = "ptid:v1:actor:peers:p:alice:fingerprint-a"
	relationshipBobPTID   = "ptid:v1:actor:peers:p:bob:fingerprint-b"
)

func relationshipCommand(
	action model.SocialRelationshipAction,
	commandID string,
	observedRevision int64,
	createdAt time.Time,
) *model.SocialRelationshipCommand {
	actor := &model.ActorRef{
		Ptid: relationshipAlicePTID,
		Kind: model.ActorKind_ACTOR_KIND_PERSON,
	}
	return &model.SocialRelationshipCommand{
		Body: &model.SocialRelationshipCommandBody{
			FormatVersion:           domain.SocialRelationshipCommandFormatVersion,
			CommandId:               commandID,
			Action:                  action,
			Actor:                   actor,
			TargetActor:             &model.ActorRef{Ptid: relationshipBobPTID, Kind: model.ActorKind_ACTOR_KIND_PERSON},
			ActorHomeStationPeerId:  "station-a",
			TargetHomeStationPeerId: "station-b",
			ObservedRevision:        observedRevision,
			CreatedAt:               timestamppb.New(createdAt),
			ExpiresAt:               timestamppb.New(createdAt.Add(time.Hour)),
			AuthorizingDevice:       &model.ActorDeviceRef{Actor: actor, DeviceId: "alice-device"},
		},
		SigningKeyId:         "relationship-test-key",
		ActorDeviceSignature: make([]byte, 64),
	}
}
