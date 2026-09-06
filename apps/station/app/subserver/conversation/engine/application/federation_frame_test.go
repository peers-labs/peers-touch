package application

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func federationFrame(now time.Time) *chat.MessagingFederationFrame {
	payload := []byte("opaque device queue batch")
	hash := sha256.Sum256(payload)
	return &chat.MessagingFederationFrame{
		FrameId:           "frame-1",
		SourceStationId:   "station-a",
		TargetStationId:   "station-b",
		IdempotencyKey:    "event-1:station-b",
		PayloadType:       chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_DEVICE_QUEUE_BATCH,
		ConversationId:    "conversation-1",
		EventId:           "event-1",
		AuthoritySequence: 7,
		OpaquePayload:     payload,
		PayloadSha256:     hash[:],
		IssuedAt:          timestamppb.New(now),
		ExpiresAt:         timestamppb.New(now.Add(time.Minute)),
	}
}

func TestFederationFrameSignatureBindsEveryRoutingAndPayloadField(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	frame := federationFrame(now)
	if err := SignFederationFrame(frame, "station-key-1", privateKey); err != nil {
		t.Fatal(err)
	}
	if err := VerifyFederationFrame(frame, "station-b", publicKey, now); err != nil {
		t.Fatal(err)
	}

	mutations := []func(*chat.MessagingFederationFrame){
		func(value *chat.MessagingFederationFrame) { value.SourceStationId = "station-c" },
		func(value *chat.MessagingFederationFrame) { value.TargetStationId = "station-c" },
		func(value *chat.MessagingFederationFrame) { value.EventId = "event-2" },
		func(value *chat.MessagingFederationFrame) { value.AuthoritySequence++ },
		func(value *chat.MessagingFederationFrame) { value.OpaquePayload[0] ^= 1 },
	}
	for index, mutate := range mutations {
		changed := proto.Clone(frame).(*chat.MessagingFederationFrame)
		mutate(changed)
		if err := VerifyFederationFrame(changed, changed.TargetStationId, publicKey, now); err == nil {
			t.Fatalf("mutation %d preserved verification", index)
		}
	}
}

func TestFederationFrameExpiryAndTargetFailClosed(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	frame := federationFrame(now)
	if err := SignFederationFrame(frame, "station-key-1", privateKey); err != nil {
		t.Fatal(err)
	}
	if err := VerifyFederationFrame(
		frame,
		"wrong-target",
		publicKey,
		now,
	); !errors.Is(err, messaging.ErrFederationFrameInvalid) {
		t.Fatalf("wrong target error = %v", err)
	}
	if err := VerifyFederationFrame(
		frame,
		"station-b",
		publicKey,
		now.Add(2*time.Minute),
	); !errors.Is(err, messaging.ErrFederationFrameExpired) {
		t.Fatalf("expired error = %v", err)
	}
}
