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

type botDirectFixture struct {
	conversation *aggregate.Conversation
	station      valueobject.StationID
	bot          valueobject.Endpoint
	owner        valueobject.Endpoint
}

func mustCreateBotDirect(
	t *testing.T,
	ownerHome valueobject.StationID,
) botDirectFixture {
	t.Helper()
	station := valueobject.StationID("station-a")
	bot := mustEndpoint(t, "ptid:bot-claude", string(valueobject.SystemStationDeviceID))
	owner := mustEndpoint(t, "ptid:owner-alice", "owner-device")
	devices := []entity.MemberDevice{
		mustMemberDevice(t, bot, station),
		mustMemberDevice(t, owner, ownerHome),
	}
	conversation, _, err := aggregate.CreateDirect(aggregate.CreateInput{
		AuthorityStation: station,
		FederationID:     testFederationID,
		AuthorityEpoch:   testAuthorityEpoch,
		Participants: []aggregate.Participant{
			{Actor: bot.Actor, HomeStation: station},
			{Actor: owner.Actor, HomeStation: ownerHome},
		},
		Devices:      devices,
		CommandID:    valueobject.CommandID("bot-direct-create"),
		Creator:      bot,
		Deliveries:   mustDeliveries(t, []valueobject.Endpoint{bot, owner}, station, "bot-genesis"),
		EventPayload: []byte("bot-direct-created"),
		CreatedAt:    testTime,
		EventSealer:  testEventSealer{},
	})
	if err != nil {
		t.Fatalf("CreateDirect(bot) error = %v", err)
	}
	return botDirectFixture{conversation: conversation, station: station, bot: bot, owner: owner}
}

func systemDelivery(
	t *testing.T,
	recipient valueobject.Endpoint,
	home valueobject.StationID,
) valueobject.PreparedDelivery {
	t.Helper()
	delivery, err := valueobject.NewPreparedDelivery(
		recipient,
		home,
		valueobject.DeliveryKindDirectServicePlaintext,
		[]byte("peers-touch.publisher-event.v1"),
	)
	if err != nil {
		t.Fatalf("NewPreparedDelivery: %v", err)
	}
	return delivery
}

func validSystemInput(
	fixture botDirectFixture,
	deliveries []valueobject.PreparedDelivery,
) aggregate.SystemServiceMessageInput {
	return aggregate.SystemServiceMessageInput{
		CommandID:   valueobject.CommandID("bot-command-1"),
		MessageID:   valueobject.MessageID("bot-message-1"),
		SenderActor: fixture.bot.Actor,
		Recipient:   fixture.owner.Actor,
		Sender:      fixture.bot,
		Deliveries:  deliveries,
		Payload:     []byte("peers-touch.publisher-event.v1"),
		CommittedAt: testTime.Add(time.Minute),
		EventSealer: testEventSealer{},
	}
}

// The internal system sender port commits service plaintext to the owner on a
// home-local direct Bot conversation.
func TestCommitSystemServiceMessageAccepted(t *testing.T) {
	fixture := mustCreateBotDirect(t, valueobject.StationID("station-a"))
	input := validSystemInput(fixture, []valueobject.PreparedDelivery{
		systemDelivery(t, fixture.owner, fixture.station),
	})

	transition, err := fixture.conversation.CommitSystemServiceMessage(input)
	if err != nil {
		t.Fatalf("CommitSystemServiceMessage() error = %v", err)
	}
	if transition.Event.Sequence != 2 || transition.Event.PreviousHash.IsZero() {
		t.Fatalf("event = %+v, want sequence 2 chained to genesis", transition.Event)
	}
	if transition.Event.Fact.Kind != domainevent.KindSystemServiceMessageCommitted {
		t.Fatalf("fact kind = %q, want system_service_message_committed", transition.Event.Fact.Kind)
	}
	if transition.Event.Actor.Actor != fixture.bot.Actor ||
		transition.Event.Actor.Device != valueobject.SystemStationDeviceID {
		t.Fatalf("event actor = %+v, want bot under reserved station device", transition.Event.Actor)
	}
	if len(transition.Deliveries) != 1 ||
		transition.Deliveries[0].Kind != valueobject.DeliveryKindDirectServicePlaintext ||
		transition.Deliveries[0].Recipient.Actor != fixture.owner.Actor {
		t.Fatalf("deliveries = %+v, want one owner service-plaintext delivery", transition.Deliveries)
	}
}

// A human device command presenting kind 8 through the ordinary ApplyCommand
// path is rejected, independent of the delivery-set matching.
func TestHumanDeviceServicePlaintextRejected(t *testing.T) {
	fixture := mustCreateBotDirect(t, valueobject.StationID("station-a"))
	preparation, err := fixture.conversation.PrepareCommand(
		fixture.owner,
		[]valueobject.Endpoint{fixture.bot, fixture.owner},
	)
	if err != nil {
		t.Fatalf("PrepareCommand: %v", err)
	}
	command := aggregate.Command{
		ID:                      valueobject.CommandID("human-command"),
		ConversationID:          fixture.conversation.ID(),
		AuthorityStation:        fixture.station,
		Sender:                  fixture.owner,
		ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
		ObservedMLSEpoch:        preparation.Head.MLSEpoch,
		DeliveryPlanHash:        preparation.DeliveryPlanHash,
		Kind:                    domainevent.KindMessageCommitted,
		MessageID:               valueobject.MessageID("human-message"),
		Payload:                 []byte("human"),
		RequiredEndpoints:       preparation.RequiredEndpoints,
		Deliveries: []valueobject.PreparedDelivery{
			// A well-formed exact set, but the non-self delivery smuggles the
			// system-only kind; that must be rejected before ciphertext match.
			systemDelivery(t, fixture.bot, fixture.station),
			systemDelivery(t, fixture.owner, fixture.station),
		},
		CommittedAt: testTime.Add(time.Minute),
		EventSealer: testEventSealer{},
	}
	_, err = fixture.conversation.ApplyCommand(command)
	assertErrorCode(t, err, conversationdomain.ErrorCodeUnauthorized)
}

// Owner-only delivery: targeting the bot itself (or anything that is not the
// owner) is rejected at the single system ingress point.
func TestSystemServiceMessageRejectsNonOwnerTarget(t *testing.T) {
	fixture := mustCreateBotDirect(t, valueobject.StationID("station-a"))
	input := validSystemInput(fixture, []valueobject.PreparedDelivery{
		systemDelivery(t, fixture.bot, fixture.station),
	})
	_, err := fixture.conversation.CommitSystemServiceMessage(input)
	assertErrorCode(t, err, conversationdomain.ErrorCodeUnauthorized)
}

// v1 forbids federation: an owner homed on a different Station is refused
// regardless of payload rather than relying on a federation adapter.
func TestSystemServiceMessageRejectsFederatedOwner(t *testing.T) {
	fixture := mustCreateBotDirect(t, valueobject.StationID("station-b"))
	input := validSystemInput(fixture, []valueobject.PreparedDelivery{
		systemDelivery(t, fixture.owner, valueobject.StationID("station-b")),
	})
	_, err := fixture.conversation.CommitSystemServiceMessage(input)
	assertErrorCode(t, err, conversationdomain.ErrorCodeUnauthorized)
}

// Service plaintext is direct-only: the port refuses a group conversation.
func TestSystemServiceMessageRejectsGroup(t *testing.T) {
	group := mustCreateGroup(t)
	_, err := group.conversation.CommitSystemServiceMessage(aggregate.SystemServiceMessageInput{
		CommandID:   "group-bot-command",
		MessageID:   "group-bot-message",
		SenderActor: group.owner.Actor,
		Recipient:   group.member.Actor,
		Sender:      group.owner,
		Deliveries: []valueobject.PreparedDelivery{
			systemDelivery(t, group.member, group.station),
		},
		Payload:     []byte("peers-touch.publisher-event.v1"),
		CommittedAt: testTime.Add(time.Minute),
		EventSealer: testEventSealer{},
	})
	assertErrorCode(t, err, conversationdomain.ErrorCodeDeliverySetMismatch)
}
