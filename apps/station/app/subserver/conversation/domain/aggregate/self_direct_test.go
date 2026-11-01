package aggregate_test

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

func TestCreateSelfDirect(t *testing.T) {
	alice := mustEndpoint(t, "ptid:alice", "alice-device")
	station := valueobject.StationID("station-a")
	scope, err := valueobject.LocalScope(station)
	if err != nil {
		t.Fatalf("local scope: %v", err)
	}
	devices := []entity.MemberDevice{mustMemberDevice(t, alice, station)}
	deliveries := mustDeliveries(t, []valueobject.Endpoint{alice}, station, "self-direct-genesis")

	conversation, transition, err := aggregate.CreateDirect(aggregate.CreateInput{
		AuthorityStation: station,
		Scope:            scope,
		AuthorityEpoch:   testAuthorityEpoch,
		Participants: []aggregate.Participant{
			{Actor: alice.Actor, HomeStation: station},
		},
		Devices:      devices,
		CommandID:    valueobject.CommandID("self-direct-create"),
		Creator:      alice,
		Deliveries:   deliveries,
		EventPayload: []byte("self-direct-created"),
		CreatedAt:    testTime,
		EventSealer:  testEventSealer{},
	})
	if err != nil {
		t.Fatalf("CreateDirect(self) error = %v", err)
	}

	expectedID, err := valueobject.SelfDirectConversationID(alice.Actor)
	if err != nil {
		t.Fatalf("expected self id: %v", err)
	}
	if conversation.ID() != expectedID {
		t.Fatalf("self direct ID = %q, want %q", conversation.ID(), expectedID)
	}
	members := conversation.Members()
	if len(members) != 1 {
		t.Fatalf("self direct members = %d, want 1", len(members))
	}
	member := members[0]
	if member.Actor != alice.Actor || !member.Active() || member.Role != valueobject.MemberRoleMember {
		t.Fatalf("self direct sole member = %+v, want active member alice", member)
	}
	snapshot := conversation.Snapshot()
	if snapshot.Owner != alice.Actor {
		t.Fatalf("self direct owner = %q, want %q", snapshot.Owner, alice.Actor)
	}
	if snapshot.Head.MembershipEpoch != 1 ||
		snapshot.Head.MLSEpoch != 0 {
		t.Fatalf("self direct epochs = %+v, want membership 1 / mls 0", snapshot.Head)
	}
	if transition.Event.Fact.Kind != domainevent.KindConversationCreated {
		t.Fatalf("self direct genesis event kind = %q", transition.Event.Fact.Kind)
	}
}

func TestCreateSelfDirectRejectsMismatchedSoleParticipant(t *testing.T) {
	alice := mustEndpoint(t, "ptid:alice", "alice-device")
	station := valueobject.StationID("station-a")
	scope, err := valueobject.LocalScope(station)
	if err != nil {
		t.Fatalf("local scope: %v", err)
	}
	devices := []entity.MemberDevice{mustMemberDevice(t, alice, station)}
	deliveries := mustDeliveries(t, []valueobject.Endpoint{alice}, station, "self-direct-bad")

	if _, _, err := aggregate.CreateDirect(aggregate.CreateInput{
		AuthorityStation: station,
		Scope:            scope,
		AuthorityEpoch:   testAuthorityEpoch,
		Participants: []aggregate.Participant{
			{Actor: "ptid:bob", HomeStation: station},
		},
		Devices:      devices,
		CommandID:    valueobject.CommandID("self-direct-bad"),
		Creator:      alice,
		Deliveries:   deliveries,
		EventPayload: []byte("self-direct-bad"),
		CreatedAt:    testTime,
		EventSealer:  testEventSealer{},
	}); err == nil {
		t.Fatal("self-direct with sole participant != creator must be rejected")
	}
}

func TestCreateDirectRejectsZeroAndThreeParticipants(t *testing.T) {
	alice := mustEndpoint(t, "ptid:alice", "alice-device")
	station := valueobject.StationID("station-a")
	scope, err := valueobject.LocalScope(station)
	if err != nil {
		t.Fatalf("local scope: %v", err)
	}
	devices := []entity.MemberDevice{mustMemberDevice(t, alice, station)}
	deliveries := mustDeliveries(t, []valueobject.Endpoint{alice}, station, "direct-bad")

	base := aggregate.CreateInput{
		AuthorityStation: station,
		Scope:            scope,
		AuthorityEpoch:   testAuthorityEpoch,
		Devices:          devices,
		CommandID:        valueobject.CommandID("direct-bad"),
		Creator:          alice,
		Deliveries:       deliveries,
		EventPayload:     []byte("direct-bad"),
		CreatedAt:        testTime,
		EventSealer:      testEventSealer{},
	}
	zero := base
	if _, _, err := aggregate.CreateDirect(zero); err == nil {
		t.Fatal("CreateDirect with zero participants must be rejected")
	}
	three := base
	three.Participants = []aggregate.Participant{
		{Actor: "ptid:alice", HomeStation: station},
		{Actor: "ptid:bob", HomeStation: station},
		{Actor: "ptid:carol", HomeStation: station},
	}
	if _, _, err := aggregate.CreateDirect(three); err == nil {
		t.Fatal("CreateDirect with three participants must be rejected")
	}
}
