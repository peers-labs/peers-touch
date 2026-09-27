package federation_test

import (
	"testing"

	conversationfederation "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/federation"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func TestParseProposalCommandSupportsChatAndMemberAuthority(t *testing.T) {
	t.Run("chat", func(t *testing.T) {
		command := &chatmodel.ChatCommand{
			CommandId:              "chat-command",
			ConversationId:         "conversation-1",
			Sender:                 &chatmodel.CryptoEndpoint{Ptid: "ptid:alice", DeviceId: "alice-1"},
			AuthorityStationPeerId: "station-a",
			Payload: &chatmodel.ChatCommand_Reaction{
				Reaction: &chatmodel.ReactionIntent{MessageId: "message-1", Reaction: "ack"},
			},
		}
		parsed, err := conversationfederation.ParseProposalCommand(
			&chatmodel.ConversationCommandProposal{Command: command},
		)
		if err != nil {
			t.Fatal(err)
		}
		if parsed.Chat != command ||
			parsed.MemberAuthority != nil ||
			parsed.CommandID != command.GetCommandId() ||
			parsed.ConversationID != command.GetConversationId() ||
			parsed.Actor != command.GetSender() ||
			parsed.Kind != chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_REACT {
			t.Fatalf("parsed chat command = %+v", parsed)
		}
	})

	t.Run("member authority", func(t *testing.T) {
		command := &chatmodel.ConversationMemberAuthorityCommand{
			CommandId:              "member-command",
			ConversationId:         "conversation-1",
			Operator:               &chatmodel.CryptoEndpoint{Ptid: "ptid:alice", DeviceId: "alice-1"},
			AuthorityStationPeerId: "station-a",
			Action:                 chatmodel.ConversationMemberAuthorityAction_CONVERSATION_MEMBER_AUTHORITY_ACTION_UPDATE_MEMBER,
		}
		parsed, err := conversationfederation.ParseProposalCommand(
			&chatmodel.ConversationCommandProposal{MemberAuthorityCommand: command},
		)
		if err != nil {
			t.Fatal(err)
		}
		if parsed.Chat != nil ||
			parsed.MemberAuthority != command ||
			parsed.CommandID != command.GetCommandId() ||
			parsed.ConversationID != command.GetConversationId() ||
			parsed.Actor != command.GetOperator() ||
			parsed.Kind != chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MEMBER_AUTHORITY {
			t.Fatalf("parsed member-authority command = %+v", parsed)
		}
	})
}

func TestParseProposalCommandRejectsMissingOrAmbiguousPayload(t *testing.T) {
	if _, err := conversationfederation.ParseProposalCommand(
		&chatmodel.ConversationCommandProposal{},
	); err == nil {
		t.Fatal("missing proposal payload was accepted")
	}
	if _, err := conversationfederation.ParseProposalCommand(
		&chatmodel.ConversationCommandProposal{
			Command:                &chatmodel.ChatCommand{},
			MemberAuthorityCommand: &chatmodel.ConversationMemberAuthorityCommand{},
		},
	); err == nil {
		t.Fatal("ambiguous proposal payload was accepted")
	}
}
