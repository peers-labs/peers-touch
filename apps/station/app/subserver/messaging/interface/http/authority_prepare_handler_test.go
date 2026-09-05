package httpinterface

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type authorityPrepareServiceSpy struct {
	calls               int
	sourceHomeStationID string
	request             *chat.PrepareMessagingSendRequest
	response            *chat.PrepareMessagingSendResponse
}

func (s *authorityPrepareServiceSpy) PrepareFederatedSend(
	_ context.Context,
	sourceHomeStationID string,
	request *chat.PrepareMessagingSendRequest,
) (*chat.PrepareMessagingSendResponse, error) {
	s.calls++
	s.sourceHomeStationID = sourceHomeStationID
	s.request = request

	return s.response, nil
}

func TestAuthorityPrepareHandlerForwardsAuthenticatedHomeStation(t *testing.T) {
	const (
		conversationID  = "conversation-1"
		sourceStationID = "station:source"
		targetStationID = "station:target"
	)
	token := mintAuthorityPrepareToken(
		t,
		sourceStationID,
		targetStationID,
		conversationID,
	)
	response := &chat.PrepareMessagingSendResponse{ConversationId: conversationID}
	service := &authorityPrepareServiceSpy{response: response}
	handler, err := NewAuthorityPrepareHandler(service)
	if err != nil {
		t.Fatal(err)
	}
	wrapper := &chat.FederatedPrepareMessagingSendRequest{
		SourceHomeStationId: sourceStationID,
		Request: &chat.PrepareMessagingSendRequest{
			ConversationId: conversationID,
			Sender: &chat.CryptoEndpoint{
				Ptid:     "ptid:bob",
				DeviceId: "bob-desktop",
			},
			AuthorityStationId: targetStationID,
		},
	}

	var got *chat.PrepareMessagingSendResponse
	var prepareErr error
	next := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		got, prepareErr = handler.PrepareAuthenticated(request.Context(), wrapper)
		writer.WriteHeader(http.StatusOK)
	})
	wrapped := httpadapter.RequireFederationToken(
		messaging.AuthorityPrepareScope,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(targetStationID),
		false,
	)(context.Background(), next)
	request := httptest.NewRequest(http.MethodPost, "/messaging/federation/command/prepare", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()

	wrapped.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", recorder.Code, recorder.Body.String())
	}
	if prepareErr != nil {
		t.Fatal(prepareErr)
	}
	if got != response ||
		service.calls != 1 ||
		service.sourceHomeStationID != sourceStationID ||
		service.request != wrapper.Request {
		t.Fatalf(
			"response = %v, service = %+v",
			got,
			service,
		)
	}
}

func mintAuthorityPrepareToken(
	t *testing.T,
	sourceStationID string,
	targetStationID string,
	conversationID string,
) string {
	t.Helper()
	scope.ResetForTest()
	scope.MustRegister(scope.Scope{
		Name: messaging.AuthorityPrepareScope,
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				messaging.FederationClaimConversationID,
				messaging.FederationClaimSourceStationID,
				messaging.FederationClaimTargetStationID,
			},
		},
	})
	cache := authfed.NewKeyCache(
		authfed.NewInMemoryKeyStore(),
		authfed.WithRecheckTTL(0),
	)
	if _, err := cache.Get(context.Background()); err != nil {
		t.Fatal(err)
	}
	token, err := authfed.Mint(context.Background(), cache, authfed.MintRequest{
		Scope:    messaging.AuthorityPrepareScope,
		Issuer:   sourceStationID,
		Audience: targetStationID,
		Subject:  sourceStationID,
		TTL:      time.Minute,
		Custom: map[string]string{
			messaging.FederationClaimConversationID:  conversationID,
			messaging.FederationClaimSourceStationID: sourceStationID,
			messaging.FederationClaimTargetStationID: targetStationID,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	return token
}
