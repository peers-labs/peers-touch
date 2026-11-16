package main

import (
	"context"
	"crypto/ed25519"
	"errors"
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
	"google.golang.org/protobuf/types/known/timestamppb"
)

type sourceFrameVerifier struct{ key *authfed.LocalKey }

func (v sourceFrameVerifier) Verify(_ context.Context, source, kid string, wire, signature []byte) error {
	if source != "source" || kid != v.key.Kid || !ed25519.Verify(v.key.Pub, wire, signature) {
		return errors.New("untrusted source signature")
	}
	return nil
}

func TestPrivateDeliveryReplayTransportRejectsUntrustedFrameSignature(t *testing.T) {
	authscope.ResetForTest()
	t.Cleanup(authscope.ResetForTest)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	key, err := authfed.MintLocalKey(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	defer clear(key.Priv)
	store := authfed.NewInMemoryKeyStore()
	if err := store.PutCurrent(ctx, key); err != nil {
		t.Fatal(err)
	}
	frame := &delivery.Frame{
		FormatVersion: delivery.CurrentFormatVersion,
		FrameId:       "original-post-frame", IdempotencyKey: "original-post-command",
		SourceStationPeerId: "source", TargetStationPeerId: "receiver",
		PayloadKind: delivery.PayloadKindSocialPrivateResource,
		PayloadId:   "post-delivery", OrderingKey: "private-post", OrderingSequence: 1,
		OpaquePayload: []byte("retained-private-wire"),
		IssuedAt:      timestamppb.New(time.Now()), ExpiresAt: timestamppb.New(time.Now().Add(time.Hour)),
	}
	policy := delivery.DefaultFramePolicy("receiver")
	if err := delivery.SignFrame(ctx, frame, policy, signer{key}); err != nil {
		t.Fatal(err)
	}
	original := proto.Clone(frame)
	changed, issuer, err := replayFrame(ctx, frame,
		scope{Mutation: "untrusted-station", SourceStation: "source", TargetStation: "receiver"}, key)
	if err != nil {
		t.Fatal(err)
	}
	if issuer != "source" || changed.SourceStationPeerId != "source" ||
		changed.SigningKeyId != key.Kid || !proto.Equal(frame, original) {
		t.Fatal("untrusted signature fixture changed legitimate Station or original frame identity")
	}
	if err := delivery.VerifyFrame(ctx, frame, policy, time.Now(), sourceFrameVerifier{key}); err != nil {
		t.Fatal(err)
	}
	if err := delivery.VerifyFrame(ctx, changed, policy, time.Now(), sourceFrameVerifier{key}); !errors.Is(err, delivery.ErrUnauthenticated) {
		t.Fatalf("adversarial frame must fail signature verification: %v", err)
	}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		claims := &authfed.Claims{}
		token, err := jwt.ParseWithClaims(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "),
			claims, func(*jwt.Token) (any, error) { return key.Pub, nil },
			jwt.WithValidMethods([]string{"EdDSA"}), jwt.WithIssuer("source"),
			jwt.WithAudience("receiver"), jwt.WithExpirationRequired())
		if err != nil || token == nil || !token.Valid ||
			claims.Scope != federation.DeliveryScope || claims.Subject != "source" ||
			claims.Custom[federation.ClaimSourceStationPeerID] != "source" {
			t.Error("negative frame did not retain valid outer peer authentication")
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		body, err := io.ReadAll(r.Body)
		var request federationmodel.DeliverFederatedDomainFrameRequest
		if err != nil || proto.Unmarshal(body, &request) != nil || !proto.Equal(request.Frame, changed) {
			t.Error("negative replay changed its signed wire")
			http.Error(w, "invalid frame", http.StatusBadRequest)
			return
		}
		if err := delivery.VerifyFrame(ctx, request.Frame, policy, time.Now(), sourceFrameVerifier{key}); !errors.Is(err, delivery.ErrUnauthenticated) {
			t.Errorf("HTTP ingress did not reject the inner signature: %v", err)
		}
		wire, err := proto.Marshal(&federationmodel.DeliverFederatedDomainFrameResponse{
			Disposition: delivery.DispositionTerminal, ErrorCode: delivery.FrameErrorUnauthenticated,
		})
		if err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "application/protobuf")
		if _, err := w.Write(wire); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	transport, err := newReplayTransport(server.Client(), readonlyKeys{store}, issuer, server.URL)
	if err != nil {
		t.Fatal(err)
	}
	result, err := transport.Deliver(ctx, changed)
	if err != nil || result.Disposition != delivery.DispositionTerminal ||
		result.ErrorCode != delivery.FrameErrorUnauthenticated || requests.Load() != 1 {
		t.Fatalf("negative frame did not reach typed receiver rejection: %v, %v", result, err)
	}
}

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
