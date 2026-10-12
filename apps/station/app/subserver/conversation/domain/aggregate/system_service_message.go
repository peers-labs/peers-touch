package aggregate

import (
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

// SystemServiceMessageInput is the internal, Station-only command that commits
// a non-E2EE direct_service_plaintext message into a bot direct conversation
// (BOT-D05/BOT-D06). It is constructed exclusively by the conversation system
// sender application port after that port verifies the explicit
// {bot, owner, bot-direct-conversation} grant and the ACTIVE registry state.
//
// It is intentionally not an aggregate.Command: human device traffic flows
// through ApplyCommand, whose delivery validation rejects
// direct_service_plaintext. There is no path for a device to build this input.
type SystemServiceMessageInput struct {
	CommandID   valueobject.CommandID
	MessageID   valueobject.MessageID
	Bot         valueobject.PTID
	Owner       valueobject.PTID
	Sender      valueobject.Endpoint
	Deliveries  []valueobject.PreparedDelivery
	Payload     []byte
	CommittedAt time.Time
	EventSealer domainevent.Sealer
}

// CommitSystemServiceMessage appends a service-plaintext message to a direct
// bot conversation. Fail-closed invariants (BOT-A21):
//
//   - direct conversation only;
//   - exactly two active members, the bot and its human owner;
//   - both members are home-local (same authority Station): v1 forbids
//     federation rather than trusting a federation adapter to classify kinds;
//   - the sender is the bot member acting under the reserved Station device;
//   - every delivery is direct_service_plaintext addressed only to the owner's
//     active endpoints — a non-owner, bot-self, or third-party target is
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
	if input.Bot == "" || input.Owner == "" || input.Bot == input.Owner {
		return Transition{}, invalid(
			"aggregate.commit_system_service_message",
			"bot_owner",
			"two distinct bot and owner actors are required",
		)
	}
	if input.Sender.Actor != input.Bot {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"aggregate.commit_system_service_message",
			"sender",
			"service plaintext must be authored by the bot member",
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

	botMember, botOK := c.members[input.Bot]
	ownerMember, ownerOK := c.members[input.Owner]
	if !botOK || !botMember.Active() || !ownerOK || !ownerMember.Active() {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"aggregate.commit_system_service_message",
			"members",
			"the bot and owner must both be active conversation members",
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
	if botMember.HomeStation != c.authorityStation ||
		ownerMember.HomeStation != c.authorityStation {
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
		if delivery.Recipient.Actor != input.Owner {
			return Transition{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeUnauthorized,
				"aggregate.commit_system_service_message",
				"recipient",
				"service plaintext v1 may target only the bot owner",
			)
		}
		if !c.IsActiveMemberEndpoint(delivery.Recipient) {
			return Transition{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"aggregate.commit_system_service_message",
				"recipient",
				"delivery recipient is not an active member endpoint",
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
