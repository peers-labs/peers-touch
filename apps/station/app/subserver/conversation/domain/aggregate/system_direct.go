package aggregate

import (
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

// CreateSystemDirect creates the internal, system-authored Direct
// Conversation between a non-human bot actor and its human owner. It differs
// from CreateDirect in two deliberate ways:
//
//   - the creator is the reserved keyless station-system device, which is a
//     member device but never receives a genesis queue item (no consumer);
//   - the exact genesis delivery set is narrowed to the owner devices.
//
// It produces no social friendship edge; the bot edge records the explicit
// {bot, owner, conversation} grant in the same delivery transaction.
func CreateSystemDirect(input CreateInput) (*Conversation, Transition, error) {
	input.Kind = valueobject.ConversationKindDirect
	if len(input.Participants) != 2 {
		return nil, Transition{}, invalid("aggregate.create_system_direct", "participants", "system direct conversation requires two participants")
	}
	if input.Creator.Device != valueobject.SystemStationDeviceID {
		return nil, Transition{}, invalid(
			"aggregate.create_system_direct",
			"creator",
			"system direct conversation creator must use the reserved station-system device",
		)
	}
	computedID, err := valueobject.DirectConversationID(
		input.Participants[0].Actor,
		input.Participants[1].Actor,
	)
	if err != nil {
		return nil, Transition{}, err
	}
	input.ID = computedID

	// The creator endpoint stays an active member device (required to author
	// the genesis fact) but is excluded from the genesis delivery set; only
	// real owner devices receive a queue item.
	ownerRecipients := make([]valueobject.Endpoint, 0, len(input.Devices))
	systemDeviceSeen := false
	for _, device := range input.Devices {
		if device.Endpoint == input.Creator {
			systemDeviceSeen = true
			continue
		}
		ownerRecipients = append(ownerRecipients, device.Endpoint)
	}
	if !systemDeviceSeen || len(ownerRecipients) == 0 {
		return nil, Transition{}, invalid(
			"aggregate.create_system_direct",
			"devices",
			"system device and at least one owner device are required",
		)
	}
	input.GenesisRecipients = ownerRecipients

	input.Owner = input.Participants[0].Actor
	if input.Participants[1].Actor < input.Owner {
		input.Owner = input.Participants[1].Actor
	}
	for index := range input.Participants {
		input.Participants[index].Role = valueobject.MemberRoleMember
	}

	return create(input, valueobject.Epoch(1), 0)
}
