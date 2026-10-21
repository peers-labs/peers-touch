package conversation

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
)

const (
	signalAuthorizationConvergenceTimeout = 2 * time.Second
	signalAuthorizationRetryInterval      = 100 * time.Millisecond
)

// conversationSignalAuthorizer implements events.SignalAuthorizer by delegating
// to the same RelationshipQuerier used for conversation gating: deny if blocked,
// allow if the two actors share at least one active conversation.
type conversationSignalAuthorizer struct {
	rel social_gate.RelationshipQuerier
}

func (a *conversationSignalAuthorizer) CanSignal(senderPTID, recipientPTID string) (bool, error) {
	ctx, cancel := context.WithTimeout(
		context.Background(),
		signalAuthorizationConvergenceTimeout,
	)
	defer cancel()

	return a.canSignal(ctx, senderPTID, recipientPTID)
}

func (a *conversationSignalAuthorizer) canSignal(
	ctx context.Context,
	senderPTID string,
	recipientPTID string,
) (bool, error) {
	blocked, err := a.rel.IsBlocked(ctx, recipientPTID, senderPTID)
	if err != nil {
		return false, err
	}
	if blocked {
		return false, nil
	}

	blockedReverse, err := a.rel.IsBlocked(ctx, senderPTID, recipientPTID)
	if err != nil {
		return false, err
	}
	if blockedReverse {
		return false, nil
	}

	// Ephemeral cross-Station signaling can overtake the durable follower
	// event that materializes the shared Conversation on the recipient Home
	// Station. Re-read only that projection for a bounded window.
	ticker := time.NewTicker(signalAuthorizationRetryInterval)
	defer ticker.Stop()

	for {
		shared, err := a.rel.HaveSharedConversation(
			ctx,
			senderPTID,
			recipientPTID,
		)
		if err != nil {
			return false, err
		}
		if shared {
			return true, nil
		}

		select {
		case <-ctx.Done():
			return false, nil
		case <-ticker.C:
		}
	}
}

func registerSignalAuthorizer(rel social_gate.RelationshipQuerier) {
	if rel == nil {
		events.RegisterSignalAuthorizer(nil)
		return
	}
	events.RegisterSignalAuthorizer(&conversationSignalAuthorizer{rel: rel})
}
