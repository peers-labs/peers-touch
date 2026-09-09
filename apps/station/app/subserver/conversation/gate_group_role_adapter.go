package conversation

import (
	"context"
	"errors"
	"fmt"

	enginedomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
)

// ConversationGroupRoleAdapter resolves policy state from the Conversation
// authority used by canonical command routes.
type ConversationGroupRoleAdapter struct {
	authority conversationAuthorityReader
}

// NewConversationGroupRoleAdapter creates a role querier backed by the canonical
// Conversation authority.
func NewConversationGroupRoleAdapter(authority conversationAuthorityReader) *ConversationGroupRoleAdapter {
	return &ConversationGroupRoleAdapter{authority: authority}
}

// GetMemberStatus returns the role, status, and mute state for a member within
// a conversation. Values align with the chat.MemberRole and chat.MemberStatus
// proto enum int32 representations.
//
// If the member is not found, returns (0, 0, false, nil) — caller interprets
// a zero status as "not a member".
func (a *ConversationGroupRoleAdapter) GetMemberStatus(ctx context.Context, conversationID, ptid string) (role int32, status int32, muted bool, err error) {
	if a.authority == nil {
		return 0, 0, false, nil
	}
	authorityMember, err := a.authority.GetMember(ctx, conversationID, ptid)
	if errors.Is(err, enginedomain.ErrNotFound) {
		return 0, 0, false, nil
	}
	if err != nil {
		return 0, 0, false, fmt.Errorf("gate: get authority member failed: %w", err)
	}
	if authorityMember == nil || !authorityMember.Active {
		return 0, 0, false, nil
	}
	return authorityMemberRole(authorityMember.Role), statusActive, false, nil
}

func authorityMemberRole(role string) int32 {
	switch role {
	case "owner":
		return roleOwner
	case "admin":
		return roleAdmin
	default:
		return roleMember
	}
}

// Compile-time interface conformance check.
var _ interface {
	GetMemberStatus(ctx context.Context, conversationID, ptid string) (int32, int32, bool, error)
} = (*ConversationGroupRoleAdapter)(nil)
