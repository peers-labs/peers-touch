package social

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

const (
	friendRequestEffectPollInterval = time.Second
	friendRequestEffectLease        = 30 * time.Second
	friendRequestEffectRetryInitial = time.Second
	friendRequestEffectRetryMaximum = time.Minute
)

type canonicalConversationDirectProvider interface {
	EnsureAcceptedRelationshipDirectConversation(
		ctx context.Context,
		effectID string,
		requestID string,
		federationID string,
		actorAPTID string,
		actorBPTID string,
	) (conversationID string, err error)
}

type canonicalConversationDirectResolver func() (
	canonicalConversationDirectProvider,
	error,
)

type conversationDirectPort struct {
	resolve canonicalConversationDirectResolver
}

func newConversationDirectPort() conversationDirectPort {
	return conversationDirectPort{resolve: resolveCanonicalConversationDirectProvider}
}

func (p conversationDirectPort) EnsureDirectConversation(
	ctx context.Context,
	request application.EnsureDirectConversationRequest,
) (string, error) {
	if request.FederationID == "" {
		return "", errors.New(
			"ensure accepted-relationship Direct Conversation: federation ID is required",
		)
	}
	if p.resolve == nil {
		return "", errors.New(
			"ensure accepted-relationship Direct Conversation: provider resolver is unavailable",
		)
	}
	provider, err := p.resolve()
	if err != nil {
		return "", err
	}

	conversationID, err := provider.EnsureAcceptedRelationshipDirectConversation(
		ctx,
		request.EffectID,
		request.RequestID,
		request.FederationID,
		request.ActorAPTID,
		request.ActorBPTID,
	)
	if err != nil {
		return "", fmt.Errorf(
			"ensure accepted-relationship Direct Conversation: %w",
			err,
		)
	}
	if conversationID == "" {
		return "", errors.New(
			"ensure accepted-relationship Direct Conversation: empty conversation ID",
		)
	}

	return conversationID, nil
}

func resolveCanonicalConversationDirectProvider() (
	canonicalConversationDirectProvider,
	error,
) {
	instance := server.GetOptions().SubserverInstances["conversation"]
	provider, ok := instance.(canonicalConversationDirectProvider)
	if !ok || provider == nil {
		return nil, errors.New(
			"canonical Conversation direct-creation provider is unavailable",
		)
	}

	return provider, nil
}

func sharedFederationRuntime() (*federationruntime.Runtime, error) {
	instance := server.GetOptions().SubserverInstances["federation"]
	provider, ok := instance.(federationruntime.RuntimeProvider)
	if !ok || provider == nil {
		return nil, errors.New("shared Federation delivery provider is unavailable")
	}
	runtime := provider.FederationDeliveryRuntime()
	if runtime == nil {
		return nil, errors.New("shared Federation delivery runtime is unavailable")
	}

	return runtime, nil
}

var _ application.DirectConversationPort = conversationDirectPort{}
