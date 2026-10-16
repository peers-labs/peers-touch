package aggregate

import (
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

// SystemServiceMessageInput is the internal, Station-only command that commits
// a non-E2EE direct_service_plaintext message into a service Direct
// Conversation. It is constructed exclusively after the application port
// verifies the live publishing delegation.
//
// It is intentionally not an aggregate.Command: human device traffic flows
// through ApplyCommand, whose delivery validation rejects
// direct_service_plaintext. There is no path for a device to build this input.
type SystemServiceMessageInput struct {
	CommandID   valueobject.CommandID
	MessageID   valueobject.MessageID
	SenderActor valueobject.PTID
	Recipient   valueobject.PTID
	Sender      valueobject.Endpoint
	Deliveries  []valueobject.PreparedDelivery
	Payload     []byte
	CommittedAt time.Time
	EventSealer domainevent.Sealer
}

// CommitSystemServiceMessage appends a service-plaintext message to a direct
// service conversation. Fail-closed invariants:
//
//   - direct conversation only;
//   - exactly two active members, the delegated sender and recipient;
//   - both members are home-local (same authority Station): v1 forbids
//     federation rather than trusting a federation adapter to classify kinds;
//   - the sender acts under the reserved Station device;
//   - every delivery is direct_service_plaintext addressed only to current
//     recipient endpoints — a sender-self or third-party target is
//     rejected here, at the only system ingress point.
func (c *Conversation) CommitSystemServiceMessage(
	input SystemServiceMessageInput,
) (Transition, error) {
	if c.kind != valueobject.ConversationKindDirect {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeDeliverySetMismatch,
			"aggregate.commit_system_service_message",
			"conversation",
			"service plaintext is allowed only in a direct conversation",
		)
	}
	if !c.status.Writable() {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInactive,
			"aggregate.commit_system_service_message",
			"conversation",
			"is not writable",
		)
	}
	if input.SenderActor == "" || input.Recipient == "" ||
		input.SenderActor == input.Recipient {
		return Transition{}, invalid(
			"aggregate.commit_system_service_message",
			"sender_recipient",
			"two distinct sender and recipient actors are required",
		)
	}
	if input.Sender.Actor != input.SenderActor {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"aggregate.commit_system_service_message",
			"sender",
			"service plaintext must be authored by the delegated sender",
		)
	}
	if input.Sender.Device != valueobject.SystemStationDeviceID {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"aggregate.commit_system_service_message",
			"sender.device",
			"service plaintext must use the reserved Station system device",
		)
	}

	senderMember, senderOK := c.members[input.SenderActor]
	recipientMember, recipientOK := c.members[input.Recipient]
	if !senderOK || !senderMember.Active() ||
		!recipientOK || !recipientMember.Active() {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"aggregate.commit_system_service_message",
			"members",
			"the sender and recipient must both be active conversation members",
		)
	}
	if c.activeMemberCount() != 2 {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeDeliverySetMismatch,
			"aggregate.commit_system_service_message",
			"members",
			"a service-plaintext direct conversation has exactly two active members",
		)
	}
	// v1 home-local only: a cross-Station (federated) owner or bot is refused
	// regardless of payload, implementing "no federation" at the system port.
	if senderMember.HomeStation != c.authorityStation ||
		recipientMember.HomeStation != c.authorityStation {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"aggregate.commit_system_service_message",
			"home_station",
			"service plaintext v1 is forbidden across federated Stations",
		)
	}
	if err := c.requireWritableSender(input.Sender); err != nil {
		return Transition{}, err
	}

	if len(input.Deliveries) == 0 {
		return Transition{}, invalid(
			"aggregate.commit_system_service_message",
			"deliveries",
			"at least one owner delivery is required",
		)
	}
	for _, delivery := range input.Deliveries {
		if delivery.Kind != valueobject.DeliveryKindDirectServicePlaintext {
			return Transition{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"aggregate.commit_system_service_message",
				"delivery_kind",
				"system delivery must be direct_service_plaintext",
			)
		}
		if delivery.Recipient.Actor != input.Recipient {
			return Transition{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeUnauthorized,
				"aggregate.commit_system_service_message",
				"recipient",
				"service plaintext v1 may target only the authorized recipient",
			)
		}
	}

	fact := domainevent.NewSystemServiceMessageFact(input.MessageID, input.Payload)
	return c.commit(
		input.CommandID,
		input.Sender,
		fact,
		input.Deliveries,
		nil,
		input.CommittedAt,
		input.EventSealer,
	)
}

func (c *Conversation) activeMemberCount() int {
	count := 0
	for _, member := range c.members {
		if member.Active() {
			count++
		}
	}
	return count
}
