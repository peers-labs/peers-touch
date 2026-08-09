package httpinterface

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"errors"
	"testing"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type federationFrameServiceSpy struct {
	calls       int
	frame       *chat.MessagingFederationFrame
	target      string
	publicKey   ed25519.PublicKey
	now         time.Time
	response    *chat.DeliverMessagingFederationFrameResponse
	responseErr error
}

func (s *federationFrameServiceSpy) Deliver(
	_ context.Context,
	frame *chat.MessagingFederationFrame,
	expectedTargetStationID string,
	sourceStationPublicKey ed25519.PublicKey,
	now time.Time,
) (*chat.DeliverMessagingFederationFrameResponse, error) {
	s.calls++
	s.frame = frame
	s.target = expectedTargetStationID
	s.publicKey = sourceStationPublicKey
	s.now = now
	return s.response, s.responseErr
}

func TestFederationHandlerBindsAuthenticatedPeerToFrame(t *testing.T) {
	publicKey, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.August, 9, 12, 30, 0, 0, time.FixedZone("test", 2*60*60))
	response := &chat.DeliverMessagingFederationFrameResponse{Accepted: true}
	spy := &federationFrameServiceSpy{response: response}
	handler, err := NewFederationHandler(spy, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	frame := validFederationFrame()
	peer := validAuthenticatedFederationPeer(publicKey)

	got, err := handler.Deliver(
		context.Background(),
		peer,
		&chat.DeliverMessagingFederationFrameRequest{Frame: frame},
	)
	if err != nil {
		t.Fatal(err)
	}
	if got != response {
		t.Fatal("handler did not return the service response")
	}
	if spy.calls != 1 {
		t.Fatalf("service calls=%d, want 1", spy.calls)
	}
	if spy.frame != frame {
		t.Fatal("handler did not pass the authenticated frame to the service")
	}
	if spy.target != peer.TargetStationID {
		t.Fatalf("service target=%q, want %q", spy.target, peer.TargetStationID)
	}
	if !bytes.Equal(spy.publicKey, publicKey) {
		t.Fatal("handler did not pass the authenticated source Station public key")
	}
	if !spy.now.Equal(now.UTC()) || spy.now.Location() != time.UTC {
		t.Fatalf("service time=%v, want UTC %v", spy.now, now.UTC())
	}
}

func TestFederationHandlerRejectsBindingMismatchBeforeService(t *testing.T) {
	publicKey, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		mutate func(*AuthenticatedFederationPeer, *chat.DeliverMessagingFederationFrameRequest)
	}{
		{
			name: "nil request",
			mutate: func(_ *AuthenticatedFederationPeer, request *chat.DeliverMessagingFederationFrameRequest) {
				*request = chat.DeliverMessagingFederationFrameRequest{}
			},
		},
		{
			name: "source Station",
			mutate: func(peer *AuthenticatedFederationPeer, _ *chat.DeliverMessagingFederationFrameRequest) {
				peer.SourceStationID = "station:mallory"
			},
		},
		{
			name: "target Station",
			mutate: func(peer *AuthenticatedFederationPeer, _ *chat.DeliverMessagingFederationFrameRequest) {
				peer.TargetStationID = "station:other"
			},
		},
		{
			name: "frame ID",
			mutate: func(peer *AuthenticatedFederationPeer, _ *chat.DeliverMessagingFederationFrameRequest) {
				peer.FrameID = "frame:other"
			},
		},
		{
			name: "idempotency key",
			mutate: func(peer *AuthenticatedFederationPeer, _ *chat.DeliverMessagingFederationFrameRequest) {
				peer.IdempotencyKey = "idempotency:other"
			},
		},
		{
			name: "signing key ID",
			mutate: func(peer *AuthenticatedFederationPeer, _ *chat.DeliverMessagingFederationFrameRequest) {
				peer.SigningKeyID = "key:other"
			},
		},
		{
			name: "invalid public key",
			mutate: func(peer *AuthenticatedFederationPeer, _ *chat.DeliverMessagingFederationFrameRequest) {
				peer.PublicKey = ed25519.PublicKey{1}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			spy := &federationFrameServiceSpy{}
			handler, handlerErr := NewFederationHandler(
				spy,
				func() time.Time { return time.Unix(1, 0) },
			)
			if handlerErr != nil {
				t.Fatal(handlerErr)
			}
			peer := validAuthenticatedFederationPeer(publicKey)
			request := &chat.DeliverMessagingFederationFrameRequest{
				Frame: validFederationFrame(),
			}
			test.mutate(&peer, request)

			if _, deliverErr := handler.Deliver(
				context.Background(),
				peer,
				request,
			); !errors.Is(deliverErr, ErrFederationBinding) {
				t.Fatalf("error=%v, want ErrFederationBinding", deliverErr)
			}
			if spy.calls != 0 {
				t.Fatalf("mismatched binding reached service %d times", spy.calls)
			}
		})
	}
}

func validFederationFrame() *chat.MessagingFederationFrame {
	return &chat.MessagingFederationFrame{
		FrameId:         "frame:1",
		SourceStationId: "station:source",
		TargetStationId: "station:target",
		IdempotencyKey:  "idempotency:1",
		SigningKeyId:    "key:source:1",
	}
}

func validAuthenticatedFederationPeer(publicKey ed25519.PublicKey) AuthenticatedFederationPeer {
	return AuthenticatedFederationPeer{
		SourceStationID: "station:source",
		TargetStationID: "station:target",
		FrameID:         "frame:1",
		IdempotencyKey:  "idempotency:1",
		SigningKeyID:    "key:source:1",
		PublicKey:       publicKey,
	}
}
