package conversation

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
)

// conversationSignalAuthorizer implements events.SignalAuthorizer by delegating
// to the same RelationshipQuerier used for conversation gating: deny if blocked,
// allow if the two actors share at least one active conversation.
type conversationSignalAuthorizer struct {
	rel social_gate.RelationshipQuerier
}

func (a *conversationSignalAuthorizer) CanSignal(senderActorID, recipientActorID string) (bool, error) {
	ctx := context.Background()

	blocked, err := a.rel.IsBlocked(ctx, recipientActorID, senderActorID)
	if err != nil {
		return false, err
	}
	if blocked {
		return false, nil
	}

	blockedReverse, err := a.rel.IsBlocked(ctx, senderActorID, recipientActorID)
	if err != nil {
		return false, err
	}
	if blockedReverse {
		return false, nil
	}

	shared, err := a.rel.HaveSharedConversation(ctx, senderActorID, recipientActorID)
	if err != nil {
		return false, err
	}
	return shared, nil
}

func registerSignalAuthorizer(rel social_gate.RelationshipQuerier) {
	if rel == nil {
		events.RegisterSignalAuthorizer(nil)
		return
	}
	events.RegisterSignalAuthorizer(&conversationSignalAuthorizer{rel: rel})
}
