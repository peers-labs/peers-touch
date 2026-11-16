package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	authscope "github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	federation "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"google.golang.org/protobuf/proto"
)

func TestPrivateDeliveryReplayTransportMintsFromFreshRegistry(t *testing.T) {
	authscope.ResetForTest()
	t.Cleanup(authscope.ResetForTest)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	key, err := authfed.MintLocalKey(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	store := authfed.NewInMemoryKeyStore()
	if err := store.PutCurrent(ctx, key); err != nil {
		t.Fatal(err)
	}
	frame := &delivery.Frame{
		FrameId: "original-post-frame", IdempotencyKey: "original-post-command",
		SourceStationPeerId: "source", TargetStationPeerId: "receiver",
		PayloadKind:   delivery.PayloadKindSocialPrivateResource,
		OpaquePayload: []byte("retained-private-wire"),
	}
	original := proto.Clone(frame)
	expectedClaims := map[string]string{
		federation.ClaimFrameID:             frame.FrameId,
		federation.ClaimIdempotencyKey:      frame.IdempotencyKey,
		federation.ClaimSourceStationPeerID: frame.SourceStationPeerId,
		federation.ClaimTargetStationPeerID: frame.TargetStationPeerId,
	}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != http.MethodPost || r.URL.Path != federation.DeliveryRoute ||
			r.Header.Get("Content-Type") != "application/protobuf" {
			t.Error("replay did not use the canonical delivery route")
		}
		claims := &authfed.Claims{}
		token, err := jwt.ParseWithClaims(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "),
			claims, func(*jwt.Token) (any, error) { return key.Pub, nil },
			jwt.WithValidMethods([]string{"EdDSA"}), jwt.WithIssuer("source"),
			jwt.WithAudience("receiver"), jwt.WithExpirationRequired())
		if err != nil || token == nil || !token.Valid {
			t.Error("replay did not mint a valid source-signed peer token")
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		if claims.Scope != federation.DeliveryScope || claims.Subject != "source" ||
			!reflect.DeepEqual(claims.Custom, expectedClaims) {
			t.Error("peer token lost the original frame bindings")
		}
		body, err := io.ReadAll(r.Body)
		var request federationmodel.DeliverFederatedDomainFrameRequest
		if err != nil || proto.Unmarshal(body, &request) != nil || !proto.Equal(request.Frame, original) {
			t.Error("HTTP replay changed the retained frame")
		}
		wire, err := proto.Marshal(&federationmodel.DeliverFederatedDomainFrameResponse{
			Disposition: delivery.DispositionDuplicate,
		})
		if err != nil {
			t.Error(err)
			http.Error(w, "encode response", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/protobuf")
		if _, err := w.Write(wire); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()

	// First construction has no Station initialization. The second must also
	// work after the same canonical registry has been sealed.
	for attempt := 0; attempt < 2; attempt++ {
		transport, err := newReplayTransport(server.Client(), readonlyKeys{store}, "source", server.URL)
		if err != nil {
			t.Fatal(err)
		}
		authscope.Seal()
		result, err := transport.Deliver(ctx, frame)
		if err != nil {
			t.Fatal(err)
		}
		if result.Disposition != delivery.DispositionDuplicate || result.ErrorCode != 0 {
			t.Fatalf("typed receiver disposition changed: %v", result)
		}
	}
	if requests.Load() != 2 || !proto.Equal(frame, original) {
		t.Fatal("replay did not deliver twice with an unchanged original frame")
	}
}

func TestPrivateDeliveryReplayTransportRejectsConflictingPolicy(t *testing.T) {
	authscope.ResetForTest()
	t.Cleanup(authscope.ResetForTest)
	if err := authscope.Register(authscope.Scope{
		Name: federation.DeliveryScope, Policy: authscope.Policy{TTLMax: time.Hour},
	}); err != nil {
		t.Fatal(err)
	}
	transport, err := newReplayTransport(&http.Client{}, authfed.NewInMemoryKeyStore(),
		"source", "http://127.0.0.1:1")
	if err == nil || transport != nil {
		t.Fatal("standalone replay accepted a conflicting peer policy")
	}
}
