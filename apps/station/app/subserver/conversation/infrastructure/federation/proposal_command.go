package federation

import (
	"fmt"

	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

// ProposalCommand is the canonical command identity carried by one signed
// Conversation proposal.
type ProposalCommand struct {
	CommandID              string
	ConversationID         string
	AuthorityStationPeerID string
	Actor                  *chatmodel.CryptoEndpoint
	Kind                   chatmodel.ConversationCommandKind
	Chat                   *chatmodel.ChatCommand
	MemberAuthority        *chatmodel.ConversationMemberAuthorityCommand
	Message                proto.Message
}

// ParseProposalCommand requires exactly one canonical command payload.
func ParseProposalCommand(
	proposal *chatmodel.ConversationCommandProposal,
) (ProposalCommand, error) {
	if proposal == nil {
		return ProposalCommand{}, fmt.Errorf("Conversation proposal is required")
	}
	switch {
	case proposal.GetCommand() != nil && proposal.GetMemberAuthorityCommand() != nil:
		return ProposalCommand{}, fmt.Errorf(
			"Conversation proposal carries multiple command payloads",
		)
	case proposal.GetCommand() != nil:
		command := proposal.GetCommand()
		return ProposalCommand{
			CommandID:              command.GetCommandId(),
			ConversationID:         command.GetConversationId(),
			AuthorityStationPeerID: command.GetAuthorityStationPeerId(),
			Actor:                  command.GetSender(),
			Kind:                   authorityCommandKind(command),
			Chat:                   command,
			Message:                command,
		}, nil
	case proposal.GetMemberAuthorityCommand() != nil:
		command := proposal.GetMemberAuthorityCommand()
		return ProposalCommand{
			CommandID:              command.GetCommandId(),
			ConversationID:         command.GetConversationId(),
			AuthorityStationPeerID: command.GetAuthorityStationPeerId(),
			Actor:                  command.GetOperator(),
			Kind:                   chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MEMBER_AUTHORITY,
			MemberAuthority:        command,
			Message:                command,
		}, nil
	default:
		return ProposalCommand{}, fmt.Errorf(
			"Conversation proposal command payload is required",
		)
	}
}
