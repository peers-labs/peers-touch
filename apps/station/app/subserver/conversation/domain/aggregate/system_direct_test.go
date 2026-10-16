package aggregate_test

import (
	"testing"
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

func mustSystemCreateInput(
	t *testing.T,
	bot, owner valueobject.Endpoint,
) aggregate.CreateInput {
	t.Helper()
	station := valueobject.StationID("station-a")
	devices := []entity.MemberDevice{
		mustMemberDevice(t, bot, station),
		mustMemberDevice(t, owner, station),
	}
	routes := []valueobject.Endpoint{bot, owner}
	genesisDeliveries := make([]valueobject.PreparedDelivery, 0, len(routes))
	// System genesis delivers only to the owner device.
	delivery, err := valueobject.NewPreparedDelivery(
		owner,
		station,
		valueobject.DeliveryKindConversation,
		[]byte("system-direct-genesis"),
	)
	if err != nil {
		t.Fatalf("genesis delivery: %v", err)
	}
	genesisDeliveries = append(genesisDeliveries, delivery)
	return aggregate.CreateInput{
		AuthorityStation: station,
		FederationID:     testFederationID,
		AuthorityEpoch:   testAuthorityEpoch,
		Participants: []aggregate.Participant{
			{Actor: bot.Actor, HomeStation: station},
			{Actor: owner.Actor, HomeStation: station},
		},
		Devices:      devices,
		CommandID:    "system-direct-create",
		Creator:      bot,
		Deliveries:   genesisDeliveries,
		EventPayload: []byte("system-direct-created"),
		CreatedAt:    testTime,
		EventSealer:  testEventSealer{},
	}
}

// System genesis uses the reserved station-system device but queues the state
// marker only for real owner endpoints.
func TestCreateSystemDirectDeliversGenesisOnlyToOwner(t *testing.T) {
	bot := mustEndpoint(t, "ptid:bot-claude", string(valueobject.SystemStationDeviceID))
	owner := mustEndpoint(t, "ptid:owner-alice", "owner-device")

	conversation, transition, err := aggregate.CreateSystemDirect(mustSystemCreateInput(t, bot, owner))
	if err != nil {
		t.Fatalf("aggregate.CreateSystemDirect() error = %v", err)
	}
	if conversation.Kind() == "" || transition.Event.Sequence != 1 {
		t.Fatalf("unexpected genesis: %+v", transition.Event)
	}
	if len(transition.Deliveries) != 1 {
		t.Fatalf("genesis deliveries = %d, want 1 (owner only)", len(transition.Deliveries))
	}
	if transition.Deliveries[0].Recipient != owner {
		t.Fatalf("genesis recipient = %+v, want owner device", transition.Deliveries[0].Recipient)
	}
	if transition.Event.Actor != bot {
		t.Fatalf("genesis actor = %+v, want bot system sender", transition.Event.Actor)
	}
	if transition.Event.Fact.Kind != domainevent.KindConversationCreated {
		t.Fatalf("fact kind = %q, want conversation created", transition.Event.Fact.Kind)
	}
}

func TestCreateSystemDirectRejectsHumanCreatorDevice(t *testing.T) {
	bot := mustEndpoint(t, "ptid:bot-claude", "bot-real-device")
	owner := mustEndpoint(t, "ptid:owner-alice", "owner-device")

	_, _, err := aggregate.CreateSystemDirect(mustSystemCreateInput(t, bot, owner))
	assertErrorCode(t, err, conversationdomain.ErrorCodeInvalidArgument)
}

func TestCreateSystemDirectRejectsDeliveryToSystemDevice(t *testing.T) {
	bot := mustEndpoint(t, "ptid:bot-claude", string(valueobject.SystemStationDeviceID))
	owner := mustEndpoint(t, "ptid:owner-alice", "owner-device")
	input := mustSystemCreateInput(t, bot, owner)
	extra, err := valueobject.NewPreparedDelivery(
		bot,
		"station-a",
		valueobject.DeliveryKindConversation,
		[]byte("to-system"),
	)
	if err != nil {
		t.Fatalf("extra delivery: %v", err)
	}
	input.Deliveries = append(input.Deliveries, extra)
	_, _, err = aggregate.CreateSystemDirect(input)
	if err == nil {
		t.Fatal("expected rejection of genesis delivery set containing the system device")
	}
}

func TestCreateSystemDirectRequiresOwnerDevice(t *testing.T) {
	bot := mustEndpoint(t, "ptid:bot-claude", string(valueobject.SystemStationDeviceID))
	owner := mustEndpoint(t, "ptid:owner-alice", "owner-device")
	input := mustSystemCreateInput(t, bot, owner)
	input.Deliveries = nil
	_, _, err := aggregate.CreateSystemDirect(input)
	if err == nil {
		t.Fatal("expected rejection when no owner device is delivered to")
	}
}

var _ = time.Time{}
