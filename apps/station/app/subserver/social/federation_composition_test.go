package social

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
)

type directConversationProviderFixture struct {
	request application.EnsureDirectConversationRequest
}

func (f *directConversationProviderFixture) EnsureAcceptedRelationshipDirectConversation(
	_ context.Context,
	effectID string,
	requestID string,
	federationID string,
	actorAPTID string,
	actorBPTID string,
) (string, error) {
	f.request = application.EnsureDirectConversationRequest{
		EffectID:     effectID,
		RequestID:    requestID,
		FederationID: federationID,
		ActorAPTID:   actorAPTID,
		ActorBPTID:   actorBPTID,
	}

	return "conversation-direct", nil
}

func TestConversationDirectPortThreadsFederationIdentity(t *testing.T) {
	provider := &directConversationProviderFixture{}
	request := application.EnsureDirectConversationRequest{
		EffectID:     "effect-1",
		RequestID:    "request-1",
		FederationID: "federation-1",
		ActorAPTID:   "ptid:alice",
		ActorBPTID:   "ptid:bob",
	}
	port := conversationDirectPort{
		resolve: func() (canonicalConversationDirectProvider, error) {
			return provider, nil
		},
	}
	conversationID, err := port.EnsureDirectConversation(
		context.Background(),
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	if conversationID != "conversation-direct" || provider.request != request {
		t.Fatalf(
			"conversation result = %q, request = %+v",
			conversationID,
			provider.request,
		)
	}
}

func TestConversationDirectPortAllowsLocalRelationshipWithoutFederationIdentity(t *testing.T) {
	provider := &directConversationProviderFixture{}
	request := application.EnsureDirectConversationRequest{
		EffectID:   "effect-1",
		RequestID:  "request-1",
		ActorAPTID: "ptid:alice",
		ActorBPTID: "ptid:bob",
	}
	port := conversationDirectPort{
		resolve: func() (canonicalConversationDirectProvider, error) {
			return provider, nil
		},
	}
	conversationID, err := port.EnsureDirectConversation(
		context.Background(),
		request,
	)
	if err != nil {
		t.Fatalf("same-station relationship without a Federation id must reach the provider: %v", err)
	}
	if conversationID != "conversation-direct" || provider.request != request {
		t.Fatalf(
			"conversation result = %q, request = %+v",
			conversationID,
			provider.request,
		)
	}
}

var _ canonicalConversationDirectProvider = (*directConversationProviderFixture)(nil)
