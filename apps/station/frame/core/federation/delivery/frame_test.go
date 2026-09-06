package delivery_test

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func TestFrameCanonicalSigningAndVerification(t *testing.T) {
	fixture := newFrameFixture(t)
	frame := fixture.stringFrame(t, "frame-1", "idempotency-1", "friend-request")

	first, err := delivery.SigningBytes(frame)
	if err != nil {
		t.Fatalf("first canonical encoding: %v", err)
	}
	frame.StationSignature = append([]byte(nil), frame.StationSignature...)
	second, err := delivery.SigningBytes(frame)
	if err != nil {
		t.Fatalf("second canonical encoding: %v", err)
	}
	if !bytes.Equal(first, second) {
		t.Fatal("canonical signing bytes changed without a signed-field change")
	}
	if err := delivery.VerifyFrame(
		context.Background(),
		frame,
		fixture.policy,
		fixture.clock.Now(),
		fixture.verifier,
	); err != nil {
		t.Fatalf("verify signed frame: %v", err)
	}

	canonicalHash, err := delivery.CanonicalFrameSHA256(frame)
	if err != nil {
		t.Fatalf("canonical frame hash: %v", err)
	}
	if len(canonicalHash) != 32 {
		t.Fatalf("canonical hash length = %d, want 32", len(canonicalHash))
	}
}

func TestFrameValidationFailsClosed(t *testing.T) {
	fixture := newFrameFixture(t)
	base := fixture.stringFrame(t, "frame-1", "idempotency-1", "friend-request")

	tests := []struct {
		name      string
		mutate    func(*delivery.Frame, *delivery.FramePolicy)
		wantError error
	}{
		{
			name: "payload tamper",
			mutate: func(frame *delivery.Frame, _ *delivery.FramePolicy) {
				frame.OpaquePayload = []byte("tampered")
			},
			wantError: delivery.ErrInvalidFrame,
		},
		{
			name: "signature tamper",
			mutate: func(frame *delivery.Frame, _ *delivery.FramePolicy) {
				frame.StationSignature[0] ^= 0xff
			},
			wantError: delivery.ErrUnauthenticated,
		},
		{
			name: "wrong source station",
			mutate: func(frame *delivery.Frame, _ *delivery.FramePolicy) {
				frame.SourceStationPeerId = "wrong-source"
			},
			wantError: delivery.ErrUnauthenticated,
		},
		{
			name: "wrong target",
			mutate: func(_ *delivery.Frame, policy *delivery.FramePolicy) {
				policy.LocalStationPeerID = "another-station"
			},
			wantError: delivery.ErrWrongTarget,
		},
		{
			name: "expired",
			mutate: func(frame *delivery.Frame, _ *delivery.FramePolicy) {
				fixture.clock.Set(frame.ExpiresAt.AsTime())
			},
			wantError: delivery.ErrExpired,
		},
		{
			name: "unspecified kind",
			mutate: func(frame *delivery.Frame, _ *delivery.FramePolicy) {
				frame.PayloadKind = delivery.PayloadKindUnspecified
			},
			wantError: delivery.ErrInvalidFrame,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture.clock.Set(time.Unix(1_800_000_000, 123_000_000).UTC())
			frame := cloneFrame(t, base)
			policy := fixture.policy
			test.mutate(frame, &policy)
			err := delivery.VerifyFrame(
				context.Background(),
				frame,
				policy,
				fixture.clock.Now(),
				fixture.verifier,
			)
			if !errors.Is(err, test.wantError) {
				t.Fatalf("error = %v, want %v", err, test.wantError)
			}
		})
	}
}

func TestSignFrameRejectsNilAndOversizedPayload(t *testing.T) {
	fixture := newFrameFixture(t)
	if err := delivery.SignFrame(
		context.Background(),
		nil,
		fixture.policy,
		fixture.signer,
	); !errors.Is(err, delivery.ErrInvalidFrame) {
		t.Fatalf("nil frame error = %v", err)
	}

	frame := fixture.signedFrame(
		t,
		"frame-oversized",
		"idempotency-oversized",
		delivery.PayloadKindSocialFriendRequestCommand,
		"payload-oversized",
		wrapperspb.String("payload"),
	)
	frame.OpaquePayload = bytes.Repeat([]byte{1}, fixture.policy.MaxPayloadBytes+1)
	if err := delivery.SignFrame(
		context.Background(),
		frame,
		fixture.policy,
		fixture.signer,
	); !errors.Is(err, delivery.ErrInvalidFrame) {
		t.Fatalf("oversized frame error = %v", err)
	}
}
