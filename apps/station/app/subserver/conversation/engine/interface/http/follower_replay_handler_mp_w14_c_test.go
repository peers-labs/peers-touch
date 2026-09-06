package httpinterface

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type mpW14CReplayPageServiceSpy struct {
	calls                   int
	requestingHomeStationID string
	request                 *chat.GetMessagingFollowerEventsRequest
	response                *chat.MessagingFollowerEventsPage
}

func (s *mpW14CReplayPageServiceSpy) GetPage(
	_ context.Context,
	requestingHomeStationID string,
	request *chat.GetMessagingFollowerEventsRequest,
) (*chat.MessagingFollowerEventsPage, error) {
	s.calls++
	s.requestingHomeStationID = requestingHomeStationID
	s.request = request
	return s.response, nil
}

func TestFollowerReplayHandlerBindsVerifiedClaims(t *testing.T) {
	request := mpW14CReplayHandlerRequest()
	response := &chat.MessagingFollowerEventsPage{
		ConversationId: request.ConversationId,
	}
	spy := &mpW14CReplayPageServiceSpy{response: response}
	handler, err := NewFollowerReplayHandler(spy)
	if err != nil {
		t.Fatal(err)
	}
	token := mpW14CMintReplayToken(t, request, nil)

	var got *chat.MessagingFollowerEventsPage
	var handlerErr error
	wrapped := mpW14CReplayMiddleware(http.HandlerFunc(
		func(writer http.ResponseWriter, httpRequest *http.Request) {
			got, handlerErr = handler.GetAuthenticated(
				httpRequest.Context(),
				request,
			)
			writer.WriteHeader(http.StatusOK)
		},
	))
	httpRequest := httptest.NewRequest(
		http.MethodPost,
		"/federation/conversation/follower/events",
		nil,
	)
	httpRequest.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()

	wrapped.ServeHTTP(recorder, httpRequest)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	if handlerErr != nil {
		t.Fatal(handlerErr)
	}
	if got != response ||
		spy.calls != 1 ||
		spy.request != request ||
		spy.requestingHomeStationID != "station:follower" {
		t.Fatalf(
			"response=%v calls=%d requester=%q request=%p",
			got,
			spy.calls,
			spy.requestingHomeStationID,
			spy.request,
		)
	}
}

func TestFollowerReplayHandlerRejectsBindingMismatchBeforeService(t *testing.T) {
	tests := []struct {
		name          string
		mutateRequest func(*chat.GetMessagingFollowerEventsRequest)
		mutateClaims  func(*authfed.MintRequest)
	}{
		{
			name: "request nonce",
			mutateRequest: func(request *chat.GetMessagingFollowerEventsRequest) {
				request.RequestNonce[0] ^= 1
			},
		},
		{
			name: "request authority",
			mutateRequest: func(request *chat.GetMessagingFollowerEventsRequest) {
				request.AuthorityStationId = "station:other"
			},
		},
		{
			name: "request target",
			mutateRequest: func(request *chat.GetMessagingFollowerEventsRequest) {
				request.TargetHomeStationId = "station:other"
			},
		},
		{
			name: "claims subject",
			mutateClaims: func(request *authfed.MintRequest) {
				request.Subject = "station:other"
			},
		},
		{
			name: "claims conversation",
			mutateClaims: func(request *authfed.MintRequest) {
				request.Custom[messaging.FederationClaimConversationID] = "conversation:other"
			},
		},
		{
			name: "claims source",
			mutateClaims: func(request *authfed.MintRequest) {
				request.Custom[messaging.FederationClaimSourceStationID] = "station:other"
			},
		},
		{
			name: "claims target",
			mutateClaims: func(request *authfed.MintRequest) {
				request.Custom[messaging.FederationClaimTargetStationID] = "station:other"
			},
		},
		{
			name: "claims request hash",
			mutateClaims: func(request *authfed.MintRequest) {
				request.Custom[messaging.FederationClaimRequestSHA256] =
					hex.EncodeToString(make([]byte, sha256.Size))
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			signedRequest := mpW14CReplayHandlerRequest()
			token := mpW14CMintReplayToken(t, signedRequest, test.mutateClaims)
			deliveredRequest := proto.Clone(signedRequest).(*chat.GetMessagingFollowerEventsRequest)
			if test.mutateRequest != nil {
				test.mutateRequest(deliveredRequest)
			}
			spy := &mpW14CReplayPageServiceSpy{}
			handler, err := NewFollowerReplayHandler(spy)
			if err != nil {
				t.Fatal(err)
			}

			var handlerErr error
			wrapped := mpW14CReplayMiddleware(http.HandlerFunc(
				func(writer http.ResponseWriter, httpRequest *http.Request) {
					_, handlerErr = handler.GetAuthenticated(
						httpRequest.Context(),
						deliveredRequest,
					)
					writer.WriteHeader(http.StatusOK)
				},
			))
			httpRequest := httptest.NewRequest(
				http.MethodPost,
				"/federation/conversation/follower/events",
				nil,
			)
			httpRequest.Header.Set("Authorization", "Bearer "+token)
			recorder := httptest.NewRecorder()

			wrapped.ServeHTTP(recorder, httpRequest)

			if recorder.Code != http.StatusOK {
				t.Fatalf("middleware status=%d body=%q", recorder.Code, recorder.Body.String())
			}
			if !errors.Is(handlerErr, ErrFollowerReplayBinding) {
				t.Fatalf("handler error = %v", handlerErr)
			}
			if spy.calls != 0 {
				t.Fatalf("mismatched binding reached service %d times", spy.calls)
			}
		})
	}
}

func mpW14CReplayHandlerRequest() *chat.GetMessagingFollowerEventsRequest {
	return &chat.GetMessagingFollowerEventsRequest{
		FormatVersion:       application.MessagingFollowerReplayFormatVersion,
		ConversationId:      "conversation:mp-w14-c",
		AuthorityStationId:  "station:authority",
		TargetHomeStationId: "station:follower",
		RequestNonce:        make([]byte, sha256.Size),
		PageLimit:           32,
	}
}

func mpW14CMintReplayToken(
	t *testing.T,
	request *chat.GetMessagingFollowerEventsRequest,
	mutate func(*authfed.MintRequest),
) string {
	t.Helper()
	scope.ResetForTest()
	scope.MustRegister(scope.Scope{
		Name: messaging.FollowerReplayScope,
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				messaging.FederationClaimConversationID,
				messaging.FederationClaimRequestSHA256,
				messaging.FederationClaimSourceStationID,
				messaging.FederationClaimTargetStationID,
			},
		},
	})
	requestHash, err := application.FollowerReplayRequestSHA256(request)
	if err != nil {
		t.Fatal(err)
	}
	mintRequest := authfed.MintRequest{
		Scope:    messaging.FollowerReplayScope,
		Issuer:   "station:follower",
		Audience: "station:authority",
		Subject:  "station:follower",
		TTL:      time.Minute,
		Custom: map[string]string{
			messaging.FederationClaimConversationID:  request.ConversationId,
			messaging.FederationClaimRequestSHA256:   hex.EncodeToString(requestHash),
			messaging.FederationClaimSourceStationID: "station:follower",
			messaging.FederationClaimTargetStationID: "station:authority",
		},
	}
	if mutate != nil {
		mutate(&mintRequest)
	}
	token, err := authfed.Mint(
		context.Background(),
		authfed.NewKeyCache(
			authfed.NewInMemoryKeyStore(),
			authfed.WithRecheckTTL(0),
		),
		mintRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func mpW14CReplayMiddleware(next http.Handler) http.Handler {
	return httpadapter.RequireFederationToken(
		messaging.FollowerReplayScope,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience("station:authority"),
		false,
	)(context.Background(), next)
}
