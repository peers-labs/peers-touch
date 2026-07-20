package conversation

import (
	"context"
	"fmt"
)

// ConversationGroupRoleAdapter adapts the conversation Repository to satisfy
// social_gate.GroupRoleQuerier by looking up member records from the store.
type ConversationGroupRoleAdapter struct {
	repo Repository
}

// NewConversationGroupRoleAdapter creates a role querier backed by the given repository.
func NewConversationGroupRoleAdapter(repo Repository) *ConversationGroupRoleAdapter {
	return &ConversationGroupRoleAdapter{repo: repo}
}

// GetMemberStatus returns the role, status, and mute state for a member within
// a conversation. Values align with the chat.MemberRole and chat.MemberStatus
// proto enum int32 representations.
//
// If the member is not found, returns (0, 0, false, nil) — caller interprets
// a zero status as "not a member".
func (a *ConversationGroupRoleAdapter) GetMemberStatus(ctx context.Context, conversationID, ptid string) (role int32, status int32, muted bool, err error) {
	member, err := a.repo.GetMember(ctx, conversationID, ptid)
	if err != nil {
		return 0, 0, false, fmt.Errorf("gate: get member failed: %w", err)
	}
	if member == nil {
		// Not found: not a member
		return 0, 0, false, nil
	}

	return int32(member.Role), int32(member.MemberStatus), member.Muted, nil
}

// Compile-time interface conformance check.
var _ interface {
	GetMemberStatus(ctx context.Context, conversationID, ptid string) (int32, int32, bool, error)
} = (*ConversationGroupRoleAdapter)(nil)
