package conversation_test

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	deliveryinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

func selfDirectRoutes(endpoint valueobject.Endpoint, station string) []ports.EndpointRoute {
	return []ports.EndpointRoute{{
		Endpoint:    endpoint,
		HomeStation: valueobject.StationID(station),
	}}
}

// TestConversationDDDSelfDirectSingletonGenesis exercises the application
// service end to end: a one-member Direct creates one participant, delivers
// exactly one genesis marker to the creator endpoint, replays idempotently,
// and refuses a Federation-scope self creation.
func TestConversationDDDSelfDirectSingletonGenesis(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:self-alice", "alice-1")
	seedDDDDevices(t, fixture.db, dddDevice(alice, "station-a"))

	localScope, err := valueobject.LocalScope("station-a")
	if err != nil {
		t.Fatal(err)
	}
	expectedID, err := valueobject.SelfDirectConversationID(alice.Actor)
	if err != nil {
		t.Fatal(err)
	}

	created, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              alice.Actor,
			Scope:             localScope,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "self-direct-create",
			VerifiedRoutes:    selfDirectRoutes(alice, "station-a"),
			ExactCommandBytes: []byte("self-direct-create"),
		},
	)
	if err != nil {
		t.Fatalf("create self-direct: %v", err)
	}
	if created.Conversation.ID != expectedID {
		t.Fatalf("self-direct id = %q, want %q", created.Conversation.ID, expectedID)
	}
	if created.Replay {
		t.Fatal("first self-direct creation must not be reported as replay")
	}

	var persistedGenesis persistence.ConversationEventModel
	if err := fixture.db.First(
		&persistedGenesis,
		"event_id = ?",
		string(created.Event.ID),
	).Error; err != nil {
		t.Fatal(err)
	}
	var wireGenesis chat.ConversationEvent
	if err := proto.Unmarshal(persistedGenesis.EventBytes, &wireGenesis); err != nil {
		t.Fatalf("decode persisted genesis: %v", err)
	}
	postState := wireGenesis.GetConversationCreated().GetPostState()
	if postState == nil ||
		len(postState.GetActiveMembers()) != 1 ||
		len(postState.GetActiveEndpointRoutes()) != 1 {
		t.Fatalf("self-direct post-state must contain one member/route: %+v", postState)
	}
	if member := postState.GetActiveMembers()[0]; member.GetPtid() != string(alice.Actor) {
		t.Fatalf("sole self-direct member = %q, want %q", member.GetPtid(), alice.Actor)
	}
	assertCount(t, fixture.db, &deliveryinfra.AuthorityDeliveryCommitmentModel{}, 1)

	// Replaying the same command id is idempotent: no second event or delivery.
	replay, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              alice.Actor,
			Scope:             localScope,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "self-direct-create",
			VerifiedRoutes:    selfDirectRoutes(alice, "station-a"),
			ExactCommandBytes: []byte("self-direct-create"),
		},
	)
	if err != nil {
		t.Fatalf("replay self-direct: %v", err)
	}
	if replay.Conversation.ID != expectedID || !replay.Replay {
		t.Fatalf("replay must return the same conversation, got %+v", replay)
	}
	assertCount(t, fixture.db, &persistence.ConversationEventModel{}, 1)
	assertCount(t, fixture.db, &deliveryinfra.AuthorityDeliveryCommitmentModel{}, 1)

	// Self-direct is Local scope by invariant: a Federation claim is rejected.
	if _, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              alice.Actor,
			Scope:             valueobject.MustFederationScope(dddFederationID),
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "self-direct-federation",
			VerifiedRoutes:    selfDirectRoutes(alice, "station-a"),
			ExactCommandBytes: []byte("self-direct-federation"),
		},
	); err == nil {
		t.Fatal("federation-scope self-direct creation must be rejected")
	}
}

// TestConversationDDDSelfDirectFansOutToAllOwnDevices verifies that a
// multi-device actor still owns one participant while every own active
// endpoint receives a genesis delivery.
func TestConversationDDDSelfDirectFansOutToAllOwnDevices(t *testing.T) {
	fixture := newDDDComposition(t)
	first := dddEndpoint("ptid:self-multi", "alice-1")
	second := dddEndpoint("ptid:self-multi", "alice-2")
	seedDDDDevices(t, fixture.db,
		dddDevice(first, "station-a"),
		dddDevice(second, "station-a"),
	)
	localScope, err := valueobject.LocalScope("station-a")
	if err != nil {
		t.Fatal(err)
	}

	created, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           first,
			Peer:              first.Actor,
			Scope:             localScope,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "self-direct-multi",
			VerifiedRoutes:    dddDirectRoutes(first, "station-a", second, "station-a"),
			ExactCommandBytes: []byte("self-direct-multi"),
		},
	)
	if err != nil {
		t.Fatalf("create multi-device self-direct: %v", err)
	}
	if created.Conversation.Owner != first.Actor {
		t.Fatalf("self-direct owner = %q, want %q", created.Conversation.Owner, first.Actor)
	}

	var persistedGenesis persistence.ConversationEventModel
	if err := fixture.db.First(
		&persistedGenesis,
		"event_id = ?",
		string(created.Event.ID),
	).Error; err != nil {
		t.Fatal(err)
	}
	var wireGenesis chat.ConversationEvent
	if err := proto.Unmarshal(persistedGenesis.EventBytes, &wireGenesis); err != nil {
		t.Fatalf("decode persisted genesis: %v", err)
	}
	postState := wireGenesis.GetConversationCreated().GetPostState()
	if postState == nil ||
		len(postState.GetActiveMembers()) != 1 ||
		len(postState.GetActiveEndpointRoutes()) != 2 {
		t.Fatalf("multi-device post-state = %+v, want one member and two routes", postState)
	}
	assertCount(t, fixture.db, &deliveryinfra.AuthorityDeliveryCommitmentModel{}, 2)
}
