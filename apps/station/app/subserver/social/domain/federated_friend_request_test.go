package domain_test

import (
	"bytes"
	"crypto/ed25519"
	"testing"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestFriendRequestCommandCanonicalValidation(t *testing.T) {
	now := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	command := signedDomainFriendRequestCommand(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-send",
		"request-1",
		now,
	)
	first, err := domain.CanonicalFriendRequestCommandBytes(command)
	if err != nil {
		t.Fatal(err)
	}
	second, err := domain.CanonicalFriendRequestCommandBytes(
		proto.Clone(command).(*model.FriendRequestCommand),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, second) {
		t.Fatal("deterministic command bytes changed across an exact clone")
	}
	if err := domain.ValidateFriendRequestCommand(
		command,
		"station-b",
		"station-a",
		"station-b",
		now,
	); err != nil {
		t.Fatalf("validate signed SEND command: %v", err)
	}

	wrongSource := proto.Clone(command).(*model.FriendRequestCommand)
	if err := domain.ValidateFriendRequestCommand(
		wrongSource,
		"station-b",
		"station-c",
		"station-b",
		now,
	); domain.FederationErrorCodeOf(err) != domain.FederationErrorUnauthorized {
		t.Fatalf("wrong source error = %v", err)
	}

	expired := proto.Clone(command).(*model.FriendRequestCommand)
	if err := domain.ValidateFriendRequestCommand(
		expired,
		"station-b",
		"station-a",
		"station-b",
		now.Add(2*time.Hour),
	); domain.FederationErrorCodeOf(err) != domain.FederationErrorInvalidArgument {
		t.Fatalf("expired command error = %v", err)
	}
}

func TestFriendRequestEventHashChainAndExactReplay(t *testing.T) {
	now := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	send := signedDomainFriendRequestCommand(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-send",
		"request-1",
		now,
	)
	pending, pendingEvent, err := domain.ApplyFriendRequestCommand(
		nil,
		send,
		"station-b",
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if pending.Sequence != 1 ||
		pending.State != model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING ||
		len(pending.LastEventHash) != 32 {
		t.Fatalf("unexpected pending projection: %+v", pending)
	}
	if err := domain.ValidateFriendRequestEvent(pendingEvent); err != nil {
		t.Fatalf("validate pending event: %v", err)
	}

	accept := signedDomainFriendRequestCommand(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
		"command-accept",
		"request-1",
		now.Add(time.Minute),
	)
	accepted, acceptedEvent, err := domain.ApplyFriendRequestCommand(
		&pending,
		accept,
		"station-b",
		now.Add(time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Sequence != 2 ||
		accepted.State != model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED ||
		!bytes.Equal(acceptedEvent.GetPreviousHash(), pendingEvent.GetEventHash()) {
		t.Fatalf("unexpected accepted projection/event: %+v %+v", accepted, acceptedEvent)
	}
	replayed, duplicate, err := domain.ApplyFriendRequestEvent(&accepted, acceptedEvent)
	if err != nil {
		t.Fatal(err)
	}
	if !duplicate || !bytes.Equal(replayed.LastEventHash, accepted.LastEventHash) {
		t.Fatal("exact event replay did not preserve the authority head")
	}

	tampered := proto.Clone(acceptedEvent).(*model.FriendRequestEvent)
	tampered.PreviousHash[0] ^= 0xff
	if err := domain.ValidateFriendRequestEvent(tampered); domain.FederationErrorCodeOf(err) !=
		domain.FederationErrorIdempotencyConflict {
		t.Fatalf("tampered hash-chain error = %v", err)
	}
}

func signedDomainFriendRequestCommand(
	t *testing.T,
	action model.FriendRequestAction,
	commandID string,
	requestID string,
	createdAt time.Time,
) *model.FriendRequestCommand {
	t.Helper()
	sender := &model.ActorRef{
		Ptid: "ptid:p:alice",
		Acct: "alice@station-a",
		Kind: model.ActorKind_ACTOR_KIND_PERSON,
	}
	receiver := &model.ActorRef{
		Ptid: "ptid:p:bob",
		Acct: "bob@station-b",
		Kind: model.ActorKind_ACTOR_KIND_PERSON,
	}
	authorizer := sender
	observedState := model.FriendRequestState_FRIEND_REQUEST_STATE_UNSPECIFIED
	message := "hello"
	if action != model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND {
		authorizer = receiver
		observedState = model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING
		message = ""
	}
	command := &model.FriendRequestCommand{
		Body: &model.FriendRequestCommandBody{
			FormatVersion:             domain.FriendRequestCommandFormatVersion,
			CommandId:                 commandID,
			RequestId:                 requestID,
			Action:                    action,
			Sender:                    sender,
			Receiver:                  receiver,
			SenderHomeStationPeerId:   "station-a",
			ReceiverHomeStationPeerId: "station-b",
			Message:                   message,
			ObservedRequestState:      observedState,
			CreatedAt:                 timestamppb.New(createdAt),
			ExpiresAt:                 timestamppb.New(createdAt.Add(time.Hour)),
			AuthorizingDevice: &model.ActorDeviceRef{
				Actor:    authorizer,
				DeviceId: authorizer.GetPtid() + ":device",
			},
		},
		SigningKeyId: "device-key",
	}
	signingBytes, err := domain.FriendRequestCommandSigningBytes(command)
	if err != nil {
		t.Fatal(err)
	}
	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x42}, ed25519.SeedSize))
	command.ActorDeviceSignature = ed25519.Sign(privateKey, signingBytes)
	return command
}
