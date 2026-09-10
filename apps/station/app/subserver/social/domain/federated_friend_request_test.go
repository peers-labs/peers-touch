package domain_test

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
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

func TestReceiverFriendRequestPolicyMatchesActionSemantics(t *testing.T) {
	tests := []struct {
		name   string
		action model.FriendRequestAction
		policy domain.ReceiverFriendRequestPolicy
		code   domain.FederationErrorCode
	}{
		{
			name:   "receiver-local block takes precedence",
			action: model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
			policy: domain.ReceiverFriendRequestPolicy{
				Blocked:              true,
				ExistingRelationship: true,
			},
			code: domain.FederationErrorBlocked,
		},
		{
			name:   "existing relationship rejects duplicate request",
			action: model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
			policy: domain.ReceiverFriendRequestPolicy{
				ExistingRelationship: true,
			},
			code: domain.FederationErrorAlreadyFriends,
		},
		{
			name:   "accept rechecks block",
			action: model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
			policy: domain.ReceiverFriendRequestPolicy{Blocked: true},
			code:   domain.FederationErrorBlocked,
		},
		{
			name:   "accept ignores existing relationship send guard",
			action: model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
			policy: domain.ReceiverFriendRequestPolicy{ExistingRelationship: true},
		},
		{
			name:   "reject remains available while blocked",
			action: model.FriendRequestAction_FRIEND_REQUEST_ACTION_REJECT,
			policy: domain.ReceiverFriendRequestPolicy{Blocked: true},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := domain.ValidateReceiverFriendRequestPolicy(test.action, test.policy)
			if domain.FederationErrorCodeOf(err) != test.code {
				t.Fatalf("policy error = %v, want code %s", err, test.code)
			}
		})
	}
	if err := domain.ValidateReceiverFriendRequestPolicy(
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		domain.ReceiverFriendRequestPolicy{},
	); err != nil {
		t.Fatalf("clear receiver policy error = %v", err)
	}
}

func TestOutgoingFriendRequestResultRequiresExactPersistedCommandHash(t *testing.T) {
	now := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	send := signedDomainFriendRequestCommand(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-send",
		"request-1",
		now,
	)
	pending, _, err := domain.ApplyFriendRequestCommand(
		nil,
		send,
		"station-b",
		now,
	)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name    string
		command *model.FriendRequestCommand
		current *domain.FriendRequestProjection
	}{
		{name: "send", command: send},
		{
			name: "accept",
			command: signedDomainFriendRequestCommand(
				t,
				model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
				"command-accept",
				"request-1",
				now.Add(time.Minute),
			),
			current: &pending,
		},
		{
			name: "reject",
			command: signedDomainFriendRequestCommand(
				t,
				model.FriendRequestAction_FRIEND_REQUEST_ACTION_REJECT,
				"command-reject",
				"request-1",
				now.Add(time.Minute),
			),
			current: &pending,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			commandBytes, err := domain.CanonicalFriendRequestCommandBytes(test.command)
			if err != nil {
				t.Fatal(err)
			}
			commandHash := sha256.Sum256(commandBytes)
			_, event, err := domain.ApplyFriendRequestCommand(
				test.current,
				test.command,
				"station-b",
				now.Add(time.Minute),
			)
			if err != nil {
				t.Fatal(err)
			}
			record := domain.FriendRequestCommandRecord{
				Role:                   domain.FriendRequestCommandRoleOutgoing,
				AuthorityStationPeerID: "station-b",
				CommandID:              test.command.GetBody().GetCommandId(),
				RequestID:              test.command.GetBody().GetRequestId(),
				CommandBytes:           commandBytes,
				CommandPayloadSHA256:   commandHash[:],
				CreatedAt:              now,
			}
			result := &model.FriendRequestCommandResult{
				CommandId:            record.CommandID,
				RequestId:            record.RequestID,
				CommandPayloadSha256: append([]byte(nil), commandHash[:]...),
				Kind:                 model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_COMMITTED,
				Event:                event,
			}
			if err := domain.ValidateOutgoingFriendRequestCommandResult(
				record,
				result,
			); err != nil {
				t.Fatalf("exact outgoing result error = %v", err)
			}

			conflict := proto.Clone(result).(*model.FriendRequestCommandResult)
			conflict.CommandPayloadSha256[0] ^= 0xff
			if err := domain.ValidateOutgoingFriendRequestCommandResult(
				record,
				conflict,
			); domain.FederationErrorCodeOf(err) != domain.FederationErrorIdempotencyConflict {
				t.Fatalf("conflicting outgoing result error = %v", err)
			}

			wrongFederation := proto.Clone(result).(*model.FriendRequestCommandResult)
			wrongFederation.Event.FederationId = "federation:other"
			wrongFederation.Event.EventHash = nil
			if err := domain.SealFriendRequestEvent(wrongFederation.Event); err != nil {
				t.Fatal(err)
			}
			if err := domain.ValidateOutgoingFriendRequestCommandResult(
				record,
				wrongFederation,
			); domain.FederationErrorCodeOf(err) != domain.FederationErrorIdempotencyConflict {
				t.Fatalf("wrong-federation outgoing result error = %v", err)
			}
		})
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
			FederationId: "federation:test",
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
