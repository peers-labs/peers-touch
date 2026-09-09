package conversation

import (
	"context"
	"testing"

	enginedomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
)

type authorityReaderStub struct {
	member        *enginedomain.AuthorityMember
	conversations []enginedomain.AuthorityConversationView
}

func (s authorityReaderStub) GetConversation(
	context.Context,
	string,
) (*enginedomain.AuthorityConversation, error) {
	return nil, enginedomain.ErrNotFound
}

func (s authorityReaderStub) GetMember(
	context.Context,
	string,
	string,
) (*enginedomain.AuthorityMember, error) {
	if s.member == nil {
		return nil, enginedomain.ErrNotFound
	}
	return s.member, nil
}

func (s authorityReaderStub) ListConversationsForActor(
	context.Context,
	string,
) ([]enginedomain.AuthorityConversationView, error) {
	return s.conversations, nil
}

func TestConversationGroupRoleAdapterFallsBackToModernAuthority(t *testing.T) {
	adapter := NewConversationGroupRoleAdapter(
		authorityReaderStub{member: &enginedomain.AuthorityMember{
			PTID:   "alice",
			Role:   "owner",
			Active: true,
		}},
	)

	role, status, muted, err := adapter.GetMemberStatus(
		context.Background(),
		"conversation-1",
		"alice",
	)
	if err != nil {
		t.Fatalf("get modern authority member: %v", err)
	}
	if role != roleOwner || status != statusActive || muted {
		t.Fatalf("unexpected role projection: role=%d status=%d muted=%t", role, status, muted)
	}
}

func TestConversationRelationshipAdapterFindsModernSharedConversation(t *testing.T) {
	adapter := NewConversationRelationshipAdapter(
		nil,
		authorityReaderStub{conversations: []enginedomain.AuthorityConversationView{{
			Conversation: &enginedomain.AuthorityConversation{
				ConversationID: "conversation-1",
				Active:         true,
			},
			MemberPTIDs: []string{"alice", "bob"},
		}}},
	)

	shared, err := adapter.HaveSharedConversation(context.Background(), "alice", "bob")
	if err != nil {
		t.Fatalf("find modern shared conversation: %v", err)
	}
	if !shared {
		t.Fatal("modern authority membership should satisfy the shared-conversation policy")
	}
}
