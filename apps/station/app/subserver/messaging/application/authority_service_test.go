package application

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"testing"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func preparedPayload(ptid, deviceID, value string) *chat.PreparedEndpointPayload {
	payload := []byte(value)
	hash := sha256.Sum256(payload)
	return &chat.PreparedEndpointPayload{
		Recipient:     &chat.CryptoEndpoint{Ptid: ptid, DeviceId: deviceID},
		Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_CIPHERTEXT,
		OpaquePayload: payload,
		PayloadSha256: hash[:],
	}
}

func TestValidateDeliverySetRequiresExactActiveEndpoints(t *testing.T) {
	required := []*chat.CryptoEndpoint{
		{Ptid: "alice", DeviceId: "alice-2"},
		{Ptid: "bob", DeviceId: "bob-1"},
	}
	valid := []*chat.PreparedEndpointPayload{
		preparedPayload("bob", "bob-1", "bob ciphertext"),
		preparedPayload("alice", "alice-2", "sender sync ciphertext"),
	}
	if err := validateDeliverySet(required, valid); err != nil {
		t.Fatalf("valid delivery set: %v", err)
	}

	cases := map[string][]*chat.PreparedEndpointPayload{
		"missing":   valid[:1],
		"duplicate": {valid[0], valid[0]},
		"unknown": {
			valid[0],
			preparedPayload("mallory", "device-1", "ciphertext"),
		},
		"tampered": {
			valid[0],
			{
				Recipient:     valid[1].Recipient,
				Kind:          valid[1].Kind,
				OpaquePayload: []byte("tampered"),
				PayloadSha256: valid[1].PayloadSha256,
			},
		},
	}
	for name, payloads := range cases {
		t.Run(name, func(t *testing.T) {
			if err := validateDeliverySet(required, payloads); !errors.Is(err, messaging.ErrDeliverySet) {
				t.Fatalf("error = %v, want ErrDeliverySet", err)
			}
		})
	}
}

func TestDeliveryCommitmentBindsEventEndpointKindAndPayloadHash(t *testing.T) {
	base := preparedPayload("bob", "device-1", "ciphertext")
	first := deliveryCommitment("event-1", "conversation-1", base)
	repeated := deliveryCommitment("event-1", "conversation-1", base)
	if !bytes.Equal(first, repeated) || len(first) != sha256.Size {
		t.Fatalf("commitment is not deterministic SHA-256: %x != %x", first, repeated)
	}

	changes := [][]byte{
		deliveryCommitment("event-2", "conversation-1", base),
		deliveryCommitment("event-1", "conversation-2", base),
		deliveryCommitment(
			"event-1",
			"conversation-1",
			preparedPayload("bob", "device-2", "ciphertext"),
		),
		deliveryCommitment(
			"event-1",
			"conversation-1",
			preparedPayload("bob", "device-1", "different ciphertext"),
		),
	}
	for index, changed := range changes {
		if bytes.Equal(first, changed) {
			t.Fatalf("change %d did not alter commitment", index)
		}
	}
}

func TestHashAuthorityEventExcludesOnlyEventHash(t *testing.T) {
	event := &chat.ConversationEvent{
		EventId:             "event-1",
		ConversationId:      "conversation-1",
		Sequence:            1,
		DeliveryCommitments: [][]byte{bytes.Repeat([]byte{1}, sha256.Size)},
	}
	first, err := hashAuthorityEvent(event)
	if err != nil {
		t.Fatal(err)
	}
	event.EventHash = bytes.Repeat([]byte{9}, sha256.Size)
	repeated, err := hashAuthorityEvent(event)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, repeated) {
		t.Fatal("event hash field affected its own hash input")
	}
	event.DeliveryCommitments[0][0] = 2
	changed, err := hashAuthorityEvent(event)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first, changed) {
		t.Fatal("delivery commitment was not bound by event hash")
	}
}
