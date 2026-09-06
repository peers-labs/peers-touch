package httpinterface

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func TestAuthenticatedFederationPeerFromVerifiedClaims(t *testing.T) {
	claims, signingKey := verifiedMessagingFederationClaims(t)

	peer, err := AuthenticatedFederationPeerFromClaims(claims)
	if err != nil {
		t.Fatal(err)
	}
	if peer.SourceStationID != "station:source" ||
		peer.TargetStationID != "station:target" ||
		peer.FrameID != "frame:1" ||
		peer.IdempotencyKey != "idempotency:1" ||
		peer.SigningKeyID != signingKey.Kid ||
		!bytes.Equal(peer.PublicKey, signingKey.Pub) {
		t.Fatalf("unexpected authenticated peer: %+v", peer)
	}
}

func TestAuthenticatedFederationPeerRejectsClaimMismatch(t *testing.T) {
	if _, err := AuthenticatedFederationPeerFromClaims(nil); !errors.Is(err, ErrFederationBinding) {
		t.Fatalf("nil claims error=%v, want ErrFederationBinding", err)
	}

	tests := []struct {
		name   string
		mutate func(*authfed.VerifiedClaims)
	}{
		{
			name: "scope",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Scope = "other-scope"
			},
		},
		{
			name: "issuer",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Issuer = "station:mallory"
			},
		},
		{
			name: "subject",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Subject = "station:mallory"
			},
		},
		{
			name: "audience",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Audience = "station:other"
			},
		},
		{
			name: "source claim",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimSourceStationID] = "station:mallory"
			},
		},
		{
			name: "target claim",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimTargetStationID] = "station:other"
			},
		},
		{
			name: "frame ID",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimFrameID] = ""
			},
		},
		{
			name: "idempotency key",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimIdempotencyKey] = ""
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			claims, _ := verifiedMessagingFederationClaims(t)
			test.mutate(claims)
			if _, err := AuthenticatedFederationPeerFromClaims(claims); !errors.Is(err, ErrFederationBinding) {
				t.Fatalf("error=%v, want ErrFederationBinding", err)
			}
		})
	}
}

func TestFederationPeerJWTWrapperReachesAuthenticatedHandler(t *testing.T) {
	token, signingKey := mintMessagingFederationToken(t)
	response := &chat.DeliverMessagingFederationFrameResponse{Accepted: true}
	spy := &federationFrameServiceSpy{response: response}
	handler, err := NewFederationHandler(spy, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	frame := validFederationFrame()
	frame.SigningKeyId = signingKey.Kid

	var got *chat.DeliverMessagingFederationFrameResponse
	var deliverErr error
	next := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		got, deliverErr = handler.DeliverAuthenticated(
			request.Context(),
			&chat.DeliverMessagingFederationFrameRequest{Frame: frame},
		)
		writer.WriteHeader(http.StatusOK)
	})
	wrapped := httpadapter.RequireFederationToken(
		messaging.FederationScope,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience("station:target"),
		false,
	)(context.Background(), next)
	request := httptest.NewRequest(http.MethodPost, "/federation/delivery", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()

	wrapped.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	if deliverErr != nil {
		t.Fatal(deliverErr)
	}
	if got != response || spy.calls != 1 {
		t.Fatalf("response=%v service calls=%d", got, spy.calls)
	}
	if spy.target != "station:target" ||
		!bytes.Equal(spy.publicKey, signingKey.Pub) {
		t.Fatal("verified peer JWT evidence did not reach federation service")
	}
}

func verifiedMessagingFederationClaims(
	t *testing.T,
) (*authfed.VerifiedClaims, *authfed.LocalKey) {
	t.Helper()
	token, signingKey := mintMessagingFederationToken(t)
	claims, err := authfed.Verify(
		context.Background(),
		authfed.NewInMemoryPeerKeyStore(),
		token,
		messaging.FederationScope,
		"station:target",
	)
	if err != nil {
		t.Fatal(err)
	}
	return claims, signingKey
}

func mintMessagingFederationToken(
	t *testing.T,
) (string, *authfed.LocalKey) {
	t.Helper()
	scope.ResetForTest()
	scope.MustRegister(scope.Scope{
		Name: messaging.FederationScope,
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				messaging.FederationClaimFrameID,
				messaging.FederationClaimIdempotencyKey,
				messaging.FederationClaimSourceStationID,
				messaging.FederationClaimTargetStationID,
			},
		},
	})
	cache := authfed.NewKeyCache(
		authfed.NewInMemoryKeyStore(),
		authfed.WithRecheckTTL(0),
	)
	signingKey, err := cache.Get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	token, err := authfed.Mint(context.Background(), cache, authfed.MintRequest{
		Scope:    messaging.FederationScope,
		Issuer:   "station:source",
		Audience: "station:target",
		Subject:  "station:source",
		TTL:      time.Minute,
		Custom: map[string]string{
			messaging.FederationClaimFrameID:         "frame:1",
			messaging.FederationClaimIdempotencyKey:  "idempotency:1",
			messaging.FederationClaimSourceStationID: "station:source",
			messaging.FederationClaimTargetStationID: "station:target",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return token, signingKey
}
