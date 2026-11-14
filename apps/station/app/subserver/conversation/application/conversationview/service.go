// Package conversationview resolves which locally persisted representation
// of a conversation a Station holds: the writable authority aggregate on the
// authority Station, or the follower read projection on a member's own Home
// Station for a cross-Station conversation. It also provides the shared
// active-membership test used to authorize reads and actor-local writes
// against either representation.
package conversationview

import (
	"context"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

type Source string

const (
	SourceAuthority Source = "authority"
	SourceFollower  Source = "follower"
)

// View is the conversation representation this Station locally holds.
// Exactly one representation exists per Station: the authority aggregate or
// the follower projection, never both.
type View struct {
	Conversation   aggregate.Snapshot
	Source         Source
	FollowerStatus repository.FollowerStatus
}

// Load resolves the local conversation representation: authority aggregate
// first, follower projection when no local authority aggregate exists.
// Finding both is a conflict because a Station is either the authority or a
// follower for a conversation, never both.
func Load(
	ctx context.Context,
	repositories repository.Repositories,
	conversationID valueobject.ConversationID,
) (View, error) {
	authority, authorityErr := repositories.Authority.Get(ctx, conversationID)
	follower, followerErr := repositories.Followers.Get(ctx, conversationID)
	if authorityErr == nil && followerErr == nil {
		return View{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"application.conversation_view",
			"conversation_id",
			"appears as both authority and follower projection",
		)
	}
	if authorityErr != nil &&
		!conversationdomain.IsCode(authorityErr, conversationdomain.ErrorCodeNotFound) {
		return View{}, authorityErr
	}
	if followerErr != nil &&
		!conversationdomain.IsCode(followerErr, conversationdomain.ErrorCodeNotFound) {
		return View{}, followerErr
	}
	if authorityErr == nil {
		return View{Conversation: authority, Source: SourceAuthority}, nil
	}
	if followerErr != nil {
		return View{}, followerErr
	}
	return View{
		Conversation:   follower.Conversation,
		Source:         SourceFollower,
		FollowerStatus: follower.Status,
	}, nil
}

// HasActiveMember reports whether the snapshot lists the actor as a currently
// active conversation member.
func HasActiveMember(snapshot aggregate.Snapshot, actor valueobject.PTID) bool {
	for _, member := range snapshot.Members {
		if member.Actor == actor && member.Active() {
			return true
		}
	}
	return false
}
