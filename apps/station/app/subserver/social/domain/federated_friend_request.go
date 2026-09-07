package domain

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"time"

	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	// FriendRequestCommandFormatVersion is the only accepted Social command format.
	FriendRequestCommandFormatVersion uint32 = 1

	maxFriendRequestIdentifierBytes = 255
	maxFriendRequestMessageBytes    = 4096
	maxFriendRequestCommandLifetime = 24 * time.Hour
	friendRequestClockSkew          = 30 * time.Second
)

// FederationErrorCode identifies stable Social Federation failures.
type FederationErrorCode string

const (
	FederationErrorInvalidArgument     FederationErrorCode = "SOCIAL_FEDERATION_INVALID_ARGUMENT"
	FederationErrorUnauthorized        FederationErrorCode = "SOCIAL_FEDERATION_UNAUTHORIZED"
	FederationErrorInvalidSignature    FederationErrorCode = "SOCIAL_FEDERATION_INVALID_SIGNATURE"
	FederationErrorIdempotencyConflict FederationErrorCode = "SOCIAL_FEDERATION_IDEMPOTENCY_CONFLICT"
	FederationErrorStateConflict       FederationErrorCode = "SOCIAL_FEDERATION_STATE_CONFLICT"
	FederationErrorNotFound            FederationErrorCode = "SOCIAL_FEDERATION_NOT_FOUND"
	FederationErrorBlocked             FederationErrorCode = "SOCIAL_FEDERATION_BLOCKED"
	FederationErrorAlreadyFriends      FederationErrorCode = "SOCIAL_FEDERATION_ALREADY_FRIENDS"
	FederationErrorIdentityUnavailable FederationErrorCode = "SOCIAL_FEDERATION_IDENTITY_UNAVAILABLE"
	FederationErrorPersistence         FederationErrorCode = "SOCIAL_FEDERATION_PERSISTENCE"
)

// FederationError carries a typed failure without coupling Social to HTTP.
type FederationError struct {
	Code      FederationErrorCode
	Operation string
	Field     string
	Message   string
	Cause     error
}

func (e *FederationError) Error() string {
	switch {
	case e == nil:
		return ""
	case e.Field != "":
		return fmt.Sprintf("%s: %s: %s", e.Operation, e.Field, e.Message)
	case e.Operation != "":
		return fmt.Sprintf("%s: %s", e.Operation, e.Message)
	default:
		return e.Message
	}
}

func (e *FederationError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// NewFederationError creates a typed Social Federation error.
func NewFederationError(
	code FederationErrorCode,
	operation string,
	field string,
	message string,
) error {
	return &FederationError{
		Code:      code,
		Operation: operation,
		Field:     field,
		Message:   message,
	}
}

// WrapFederationError preserves an infrastructure cause under a stable domain code.
func WrapFederationError(
	code FederationErrorCode,
	operation string,
	cause error,
) error {
	if cause == nil {
		return nil
	}
	return &FederationError{
		Code:      code,
		Operation: operation,
		Message:   cause.Error(),
		Cause:     cause,
	}
}

// FederationErrorCodeOf extracts a Social Federation error code.
func FederationErrorCodeOf(err error) FederationErrorCode {
	var typed *FederationError
	if errors.As(err, &typed) {
		return typed.Code
	}
	return ""
}

// FriendRequestCommandRole separates sender-side durability from receiver authority.
type FriendRequestCommandRole string

const (
	FriendRequestCommandRoleOutgoing  FriendRequestCommandRole = "outgoing"
	FriendRequestCommandRoleAuthority FriendRequestCommandRole = "authority"
)

// FriendRequestCommandRecord preserves exact canonical command and terminal result bytes.
type FriendRequestCommandRecord struct {
	Role                   FriendRequestCommandRole
	AuthorityStationPeerID string
	CommandID              string
	RequestID              string
	CommandBytes           []byte
	CommandPayloadSHA256   []byte
	ResultBytes            []byte
	CreatedAt              time.Time
	ResolvedAt             *time.Time
}

// ReceiverFriendRequestPolicy is the receiver-local relationship policy snapshot.
type ReceiverFriendRequestPolicy struct {
	Blocked              bool
	ExistingRelationship bool
}

// FriendRequestProjection is one Station-local projection of canonical Social truth.
type FriendRequestProjection struct {
	RequestID                 string
	FederationID              string
	AuthorityStationPeerID    string
	Sender                    *model.ActorRef
	Receiver                  *model.ActorRef
	SenderHomeStationPeerID   string
	ReceiverHomeStationPeerID string
	Message                   string
	State                     model.FriendRequestState
	Sequence                  int64
	LastEventHash             []byte
	LastEventBytes            []byte
	AuthorityConfirmed        bool
	CreatedAt                 time.Time
	RespondedAt               *time.Time
}

// FriendRequestRelationshipProjection is the actor-local accepted relationship edge.
type FriendRequestRelationshipProjection struct {
	OwnerPTID         string
	PeerPTID          string
	RequestID         string
	AcceptedEventID   string
	AcceptedEventHash []byte
	AcceptedAt        time.Time
}

// DirectConversationEffect is a durable, idempotent post-accept integration effect.
type DirectConversationEffect struct {
	EffectID        string
	RequestID       string
	FederationID    string
	ActorAPTID      string
	ActorBPTID      string
	AcceptedEventID string
	CreatedAt       time.Time
}

// ValidateReceiverFriendRequestPolicy applies the same receiver-local block
// boundary as local Friend Request handling. Existing relationships reject only
// new SEND commands and never invalidate a pending request's receiver decision.
func ValidateReceiverFriendRequestPolicy(
	action model.FriendRequestAction,
	policy ReceiverFriendRequestPolicy,
) error {
	const operation = "social.validate_receiver_friend_request_policy"
	if policy.Blocked &&
		(action == model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND ||
			action == model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT) {
		return NewFederationError(
			FederationErrorBlocked,
			operation,
			"relationship",
			"is blocked by receiver-local policy",
		)
	}
	if action == model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND &&
		policy.ExistingRelationship {
		return NewFederationError(
			FederationErrorAlreadyFriends,
			operation,
			"relationship",
			"already exists at the receiver Home Station",
		)
	}
	switch action {
	case model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_REJECT:
		return nil
	default:
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"action",
			"is unspecified",
		)
	}
}

// CanonicalFriendRequestCommandBytes returns deterministic bytes for exact persistence.
func CanonicalFriendRequestCommandBytes(
	command *model.FriendRequestCommand,
) ([]byte, error) {
	const operation = "social.canonical_friend_request_command"
	if command == nil {
		return nil, NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command",
			"is required",
		)
	}
	if hasUnknownFields(command) {
		return nil, NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command",
			"contains unknown fields",
		)
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		return nil, WrapFederationError(FederationErrorInvalidArgument, operation, err)
	}
	return encoded, nil
}

// FriendRequestCommandPayloadSHA256 hashes the exact deterministic command bytes.
func FriendRequestCommandPayloadSHA256(
	command *model.FriendRequestCommand,
) ([]byte, error) {
	encoded, err := CanonicalFriendRequestCommandBytes(command)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(encoded)
	return append([]byte(nil), sum[:]...), nil
}

// FriendRequestCommandSigningBytes returns the exact actor-device signing input.
func FriendRequestCommandSigningBytes(
	command *model.FriendRequestCommand,
) ([]byte, error) {
	const operation = "social.friend_request_signing_bytes"
	if command == nil || command.GetBody() == nil {
		return nil, NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command.body",
			"is required",
		)
	}
	input := &model.FriendRequestCommandSigningInput{
		Body:         proto.Clone(command.GetBody()).(*model.FriendRequestCommandBody),
		SigningKeyId: command.GetSigningKeyId(),
	}
	if hasUnknownFields(input) || hasUnknownFields(input.GetBody()) {
		return nil, NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command",
			"contains unknown fields",
		)
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return nil, WrapFederationError(FederationErrorInvalidArgument, operation, err)
	}
	return encoded, nil
}

// ValidateFriendRequestCommand verifies canonical shape, authority, and frame binding.
func ValidateFriendRequestCommand(
	command *model.FriendRequestCommand,
	localStationPeerID string,
	frameSourceStationPeerID string,
	frameTargetStationPeerID string,
	now time.Time,
) error {
	const operation = "social.validate_friend_request_command"
	if command == nil || command.GetBody() == nil {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command.body",
			"is required",
		)
	}
	body := command.GetBody()
	if hasUnknownFields(command) ||
		hasUnknownFields(body) ||
		hasUnknownFields(body.GetSender()) ||
		hasUnknownFields(body.GetReceiver()) ||
		hasUnknownFields(body.GetAuthorizingDevice()) ||
		hasUnknownFields(body.GetAuthorizingDevice().GetActor()) {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command",
			"contains unknown fields",
		)
	}
	if body.GetFormatVersion() != FriendRequestCommandFormatVersion {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"format_version",
			"is unsupported",
		)
	}
	identifiers := []struct {
		field string
		value string
	}{
		{field: "command_id", value: body.GetCommandId()},
		{field: "request_id", value: body.GetRequestId()},
		{field: "federation_id", value: body.GetFederationId()},
		{field: "sender_home_station_peer_id", value: body.GetSenderHomeStationPeerId()},
		{field: "receiver_home_station_peer_id", value: body.GetReceiverHomeStationPeerId()},
		{field: "signing_key_id", value: command.GetSigningKeyId()},
		{field: "authorizing_device.device_id", value: body.GetAuthorizingDevice().GetDeviceId()},
		{field: "local_station_peer_id", value: localStationPeerID},
		{field: "frame_source_station_peer_id", value: frameSourceStationPeerID},
		{field: "frame_target_station_peer_id", value: frameTargetStationPeerID},
	}
	for _, identifier := range identifiers {
		if err := validateFriendRequestIdentifier(
			operation,
			identifier.field,
			identifier.value,
		); err != nil {
			return err
		}
	}
	if err := validateHumanActorRef(operation, "sender", body.GetSender()); err != nil {
		return err
	}
	if err := validateHumanActorRef(operation, "receiver", body.GetReceiver()); err != nil {
		return err
	}
	if body.GetSender().GetPtid() == body.GetReceiver().GetPtid() {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"receiver.ptid",
			"must differ from sender.ptid",
		)
	}
	if len(body.GetMessage()) > maxFriendRequestMessageBytes {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"message",
			"is too large",
		)
	}
	if body.GetMessage() != strings.TrimSpace(body.GetMessage()) {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"message",
			"must be canonical",
		)
	}
	if len(command.GetActorDeviceSignature()) != ed25519.SignatureSize {
		return NewFederationError(
			FederationErrorInvalidSignature,
			operation,
			"actor_device_signature",
			"has an invalid length",
		)
	}
	if err := validateCommandTimes(operation, body, now.UTC()); err != nil {
		return err
	}
	if localStationPeerID != body.GetReceiverHomeStationPeerId() ||
		frameTargetStationPeerID != body.GetReceiverHomeStationPeerId() {
		return NewFederationError(
			FederationErrorUnauthorized,
			operation,
			"receiver_home_station_peer_id",
			"does not bind the receiver authority",
		)
	}

	var authorizingPTID string
	var expectedSourceStation string
	switch body.GetAction() {
	case model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND:
		authorizingPTID = body.GetSender().GetPtid()
		expectedSourceStation = body.GetSenderHomeStationPeerId()
		if body.GetObservedRequestState() !=
			model.FriendRequestState_FRIEND_REQUEST_STATE_UNSPECIFIED {
			return NewFederationError(
				FederationErrorStateConflict,
				operation,
				"observed_request_state",
				"must be unspecified for SEND",
			)
		}
	case model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_REJECT:
		authorizingPTID = body.GetReceiver().GetPtid()
		expectedSourceStation = body.GetReceiverHomeStationPeerId()
		if body.GetObservedRequestState() !=
			model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING {
			return NewFederationError(
				FederationErrorStateConflict,
				operation,
				"observed_request_state",
				"must be pending for a decision",
			)
		}
		if body.GetMessage() != "" {
			return NewFederationError(
				FederationErrorInvalidArgument,
				operation,
				"message",
				"must be empty for a decision",
			)
		}
	default:
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"action",
			"is unspecified",
		)
	}
	if frameSourceStationPeerID != expectedSourceStation {
		return NewFederationError(
			FederationErrorUnauthorized,
			operation,
			"frame_source_station_peer_id",
			"does not match the authorizing actor Home Station",
		)
	}
	if body.GetAuthorizingDevice().GetActor().GetPtid() != authorizingPTID {
		return NewFederationError(
			FederationErrorUnauthorized,
			operation,
			"authorizing_device.actor.ptid",
			"does not match the action authority",
		)
	}
	if body.GetAuthorizingDevice().GetActor().GetKind() !=
		model.ActorKind_ACTOR_KIND_PERSON {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"authorizing_device.actor.kind",
			"must identify a Human actor",
		)
	}
	return nil
}

// NewOutgoingFriendRequestProjection creates the sender's durable unconfirmed projection.
func NewOutgoingFriendRequestProjection(
	command *model.FriendRequestCommand,
) (FriendRequestProjection, error) {
	const operation = "social.new_outgoing_friend_request_projection"
	if command == nil ||
		command.GetBody() == nil ||
		command.GetBody().GetAction() !=
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND {
		return FriendRequestProjection{}, NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command",
			"must be a SEND command",
		)
	}
	body := command.GetBody()
	return FriendRequestProjection{
		RequestID:                 body.GetRequestId(),
		FederationID:              body.GetFederationId(),
		AuthorityStationPeerID:    body.GetReceiverHomeStationPeerId(),
		Sender:                    cloneActorRef(body.GetSender()),
		Receiver:                  cloneActorRef(body.GetReceiver()),
		SenderHomeStationPeerID:   body.GetSenderHomeStationPeerId(),
		ReceiverHomeStationPeerID: body.GetReceiverHomeStationPeerId(),
		Message:                   body.GetMessage(),
		State:                     model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
		AuthorityConfirmed:        false,
		CreatedAt:                 body.GetCreatedAt().AsTime().UTC(),
	}, nil
}

// ApplyFriendRequestCommand commits the receiver-authority transition and hash-chain event.
func ApplyFriendRequestCommand(
	current *FriendRequestProjection,
	command *model.FriendRequestCommand,
	authorityStationPeerID string,
	committedAt time.Time,
) (FriendRequestProjection, *model.FriendRequestEvent, error) {
	const operation = "social.apply_friend_request_command"
	if command == nil || command.GetBody() == nil {
		return FriendRequestProjection{}, nil, NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command.body",
			"is required",
		)
	}
	body := command.GetBody()
	if authorityStationPeerID != body.GetReceiverHomeStationPeerId() {
		return FriendRequestProjection{}, nil, NewFederationError(
			FederationErrorUnauthorized,
			operation,
			"authority_station_peer_id",
			"must be the receiver Home Station",
		)
	}

	nextState := model.FriendRequestState_FRIEND_REQUEST_STATE_UNSPECIFIED
	sequence := int64(1)
	var previousHash []byte
	switch body.GetAction() {
	case model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND:
		nextState = model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING
		if current != nil &&
			(current.Sequence != 0 ||
				current.RequestID != body.GetRequestId() ||
				current.Sender.GetPtid() != body.GetSender().GetPtid() ||
				current.Receiver.GetPtid() != body.GetReceiver().GetPtid()) {
			return FriendRequestProjection{}, nil, NewFederationError(
				FederationErrorStateConflict,
				operation,
				"request_id",
				"already has authoritative state",
			)
		}
	case model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT:
		nextState = model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED
	case model.FriendRequestAction_FRIEND_REQUEST_ACTION_REJECT:
		nextState = model.FriendRequestState_FRIEND_REQUEST_STATE_REJECTED
	default:
		return FriendRequestProjection{}, nil, NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"action",
			"is unspecified",
		)
	}
	if body.GetAction() != model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND {
		if current == nil {
			return FriendRequestProjection{}, nil, NewFederationError(
				FederationErrorNotFound,
				operation,
				"request_id",
				"was not materialized at the receiver authority",
			)
		}
		if current.State != model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING ||
			current.Sequence != 1 ||
			!sameProjectionIdentity(*current, body) {
			return FriendRequestProjection{}, nil, NewFederationError(
				FederationErrorStateConflict,
				operation,
				"observed_request_state",
				"does not match the receiver authority",
			)
		}
		sequence = current.Sequence + 1
		previousHash = append([]byte(nil), current.LastEventHash...)
	}

	event := &model.FriendRequestEvent{
		EventId:                   friendRequestEventID(body.GetRequestId(), sequence),
		RequestId:                 body.GetRequestId(),
		CommandId:                 body.GetCommandId(),
		AuthorityStationPeerId:    authorityStationPeerID,
		State:                     nextState,
		Sender:                    cloneActorRef(body.GetSender()),
		Receiver:                  cloneActorRef(body.GetReceiver()),
		SenderHomeStationPeerId:   body.GetSenderHomeStationPeerId(),
		ReceiverHomeStationPeerId: body.GetReceiverHomeStationPeerId(),
		Sequence:                  sequence,
		CommittedAt:               timestamppb.New(committedAt.UTC()),
		PreviousHash:              previousHash,
		FederationId:              body.GetFederationId(),
	}
	if err := SealFriendRequestEvent(event); err != nil {
		return FriendRequestProjection{}, nil, err
	}
	projection, _, err := ApplyFriendRequestEvent(current, event)
	if err != nil {
		return FriendRequestProjection{}, nil, err
	}
	if body.GetAction() == model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND {
		projection.Message = body.GetMessage()
		projection.CreatedAt = body.GetCreatedAt().AsTime().UTC()
	}
	return projection, event, nil
}

// SealFriendRequestEvent computes the deterministic event hash over all prior fields.
func SealFriendRequestEvent(event *model.FriendRequestEvent) error {
	const operation = "social.seal_friend_request_event"
	if event == nil {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"event",
			"is required",
		)
	}
	if len(event.GetEventHash()) != 0 {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"event_hash",
			"must be empty before sealing",
		)
	}
	canonical, err := canonicalFriendRequestEventHashInput(event)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(canonical)
	event.EventHash = append([]byte(nil), sum[:]...)
	return nil
}

// ValidateFriendRequestEvent verifies authority, sequence shape, and hash integrity.
func ValidateFriendRequestEvent(event *model.FriendRequestEvent) error {
	const operation = "social.validate_friend_request_event"
	if event == nil {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"event",
			"is required",
		)
	}
	if hasUnknownFields(event) ||
		hasUnknownFields(event.GetSender()) ||
		hasUnknownFields(event.GetReceiver()) {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"event",
			"contains unknown fields",
		)
	}
	identifiers := []struct {
		field string
		value string
	}{
		{field: "event_id", value: event.GetEventId()},
		{field: "request_id", value: event.GetRequestId()},
		{field: "command_id", value: event.GetCommandId()},
		{field: "federation_id", value: event.GetFederationId()},
		{field: "authority_station_peer_id", value: event.GetAuthorityStationPeerId()},
		{field: "sender_home_station_peer_id", value: event.GetSenderHomeStationPeerId()},
		{field: "receiver_home_station_peer_id", value: event.GetReceiverHomeStationPeerId()},
	}
	for _, identifier := range identifiers {
		if err := validateFriendRequestIdentifier(
			operation,
			identifier.field,
			identifier.value,
		); err != nil {
			return err
		}
	}
	if err := validateHumanActorRef(operation, "sender", event.GetSender()); err != nil {
		return err
	}
	if err := validateHumanActorRef(operation, "receiver", event.GetReceiver()); err != nil {
		return err
	}
	if event.GetAuthorityStationPeerId() != event.GetReceiverHomeStationPeerId() {
		return NewFederationError(
			FederationErrorUnauthorized,
			operation,
			"authority_station_peer_id",
			"must be the receiver Home Station",
		)
	}
	if event.GetSequence() <= 0 ||
		event.GetCommittedAt() == nil ||
		event.GetCommittedAt().CheckValid() != nil ||
		len(event.GetEventHash()) != sha256.Size {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"event",
			"has invalid sequence, timestamp, or hash",
		)
	}
	switch event.GetState() {
	case model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING:
		if event.GetSequence() != 1 || len(event.GetPreviousHash()) != 0 {
			return NewFederationError(
				FederationErrorStateConflict,
				operation,
				"sequence",
				"pending must be the hash-chain genesis",
			)
		}
	case model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED,
		model.FriendRequestState_FRIEND_REQUEST_STATE_REJECTED:
		if event.GetSequence() != 2 || len(event.GetPreviousHash()) != sha256.Size {
			return NewFederationError(
				FederationErrorStateConflict,
				operation,
				"sequence",
				"a decision must follow the pending event",
			)
		}
	default:
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"state",
			"is unsupported",
		)
	}
	canonical, err := canonicalFriendRequestEventHashInput(event)
	if err != nil {
		return err
	}
	expected := sha256.Sum256(canonical)
	if !bytes.Equal(expected[:], event.GetEventHash()) {
		return NewFederationError(
			FederationErrorIdempotencyConflict,
			operation,
			"event_hash",
			"does not match deterministic event bytes",
		)
	}
	return nil
}

// ApplyFriendRequestEvent advances one Station-local projection exactly once.
func ApplyFriendRequestEvent(
	current *FriendRequestProjection,
	event *model.FriendRequestEvent,
) (FriendRequestProjection, bool, error) {
	const operation = "social.apply_friend_request_event"
	if err := ValidateFriendRequestEvent(event); err != nil {
		return FriendRequestProjection{}, false, err
	}
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
	if err != nil {
		return FriendRequestProjection{}, false, WrapFederationError(
			FederationErrorInvalidArgument,
			operation,
			err,
		)
	}
	if current != nil && current.Sequence == event.GetSequence() {
		if bytes.Equal(current.LastEventHash, event.GetEventHash()) &&
			bytes.Equal(current.LastEventBytes, eventBytes) {
			return cloneFriendRequestProjection(*current), true, nil
		}
		return FriendRequestProjection{}, false, NewFederationError(
			FederationErrorIdempotencyConflict,
			operation,
			"event_id",
			"was reused with different canonical bytes",
		)
	}
	if current == nil || current.Sequence == 0 {
		if event.GetSequence() != 1 ||
			event.GetState() != model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING {
			return FriendRequestProjection{}, false, NewFederationError(
				FederationErrorStateConflict,
				operation,
				"sequence",
				"must begin with pending sequence 1",
			)
		}
		createdAt := event.GetCommittedAt().AsTime().UTC()
		if current != nil && !current.CreatedAt.IsZero() {
			createdAt = current.CreatedAt.UTC()
		}
		projection := FriendRequestProjection{
			RequestID:                 event.GetRequestId(),
			FederationID:              event.GetFederationId(),
			AuthorityStationPeerID:    event.GetAuthorityStationPeerId(),
			Sender:                    cloneActorRef(event.GetSender()),
			Receiver:                  cloneActorRef(event.GetReceiver()),
			SenderHomeStationPeerID:   event.GetSenderHomeStationPeerId(),
			ReceiverHomeStationPeerID: event.GetReceiverHomeStationPeerId(),
			State:                     event.GetState(),
			Sequence:                  event.GetSequence(),
			LastEventHash:             append([]byte(nil), event.GetEventHash()...),
			LastEventBytes:            eventBytes,
			AuthorityConfirmed:        true,
			CreatedAt:                 createdAt,
		}
		if current != nil {
			projection.Message = current.Message
		}
		return projection, false, nil
	}
	if !sameEventProjectionIdentity(*current, event) ||
		current.State != model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING ||
		event.GetSequence() != current.Sequence+1 ||
		!bytes.Equal(event.GetPreviousHash(), current.LastEventHash) {
		return FriendRequestProjection{}, false, NewFederationError(
			FederationErrorStateConflict,
			operation,
			"event",
			"does not extend the current authority head",
		)
	}
	if event.GetState() != model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED &&
		event.GetState() != model.FriendRequestState_FRIEND_REQUEST_STATE_REJECTED {
		return FriendRequestProjection{}, false, NewFederationError(
			FederationErrorStateConflict,
			operation,
			"state",
			"is not a terminal receiver decision",
		)
	}
	next := cloneFriendRequestProjection(*current)
	next.State = event.GetState()
	next.Sequence = event.GetSequence()
	next.LastEventHash = append([]byte(nil), event.GetEventHash()...)
	next.LastEventBytes = eventBytes
	next.AuthorityConfirmed = true
	respondedAt := event.GetCommittedAt().AsTime().UTC()
	next.RespondedAt = &respondedAt
	return next, false, nil
}

// ValidateFriendRequestCommandResult verifies the exact command hash and embedded event.
func ValidateFriendRequestCommandResult(
	result *model.FriendRequestCommandResult,
) error {
	const operation = "social.validate_friend_request_command_result"
	if result == nil || hasUnknownFields(result) {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"result",
			"is required and must not contain unknown fields",
		)
	}
	if err := validateFriendRequestIdentifier(
		operation,
		"command_id",
		result.GetCommandId(),
	); err != nil {
		return err
	}
	if err := validateFriendRequestIdentifier(
		operation,
		"request_id",
		result.GetRequestId(),
	); err != nil {
		return err
	}
	if len(result.GetCommandPayloadSha256()) != sha256.Size {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command_payload_sha256",
			"must contain a SHA-256 digest",
		)
	}
	if result.GetRetryable() ||
		result.GetErrorCode() ==
			model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_RETRY_LATER {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"result",
			"retryable outcomes must retain and retry the original command frame",
		)
	}
	switch result.GetKind() {
	case model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_COMMITTED,
		model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_DUPLICATE:
		if result.GetErrorCode() !=
			model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_UNSPECIFIED ||
			result.GetEvent() == nil {
			return NewFederationError(
				FederationErrorInvalidArgument,
				operation,
				"result",
				"successful result has invalid failure fields",
			)
		}
		if result.GetEvent().GetRequestId() != result.GetRequestId() ||
			result.GetEvent().GetCommandId() != result.GetCommandId() {
			return NewFederationError(
				FederationErrorIdempotencyConflict,
				operation,
				"event",
				"does not match the command identity",
			)
		}
		return ValidateFriendRequestEvent(result.GetEvent())
	case model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_REJECTED,
		model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_CONFLICT:
		if result.GetErrorCode() ==
			model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_UNSPECIFIED ||
			result.GetEvent() != nil {
			return NewFederationError(
				FederationErrorInvalidArgument,
				operation,
				"result",
				"failure result has invalid fields",
			)
		}
		return nil
	default:
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"kind",
			"is unspecified",
		)
	}
}

// ValidateOutgoingFriendRequestCommandResult binds a result to the exact
// outgoing command bytes persisted by its authorizing Home Station.
func ValidateOutgoingFriendRequestCommandResult(
	record FriendRequestCommandRecord,
	result *model.FriendRequestCommandResult,
) error {
	const operation = "social.validate_outgoing_friend_request_command_result"
	if err := ValidateFriendRequestCommandResult(result); err != nil {
		return err
	}
	if record.Role != FriendRequestCommandRoleOutgoing ||
		record.AuthorityStationPeerID == "" ||
		record.CommandID == "" ||
		record.RequestID == "" ||
		len(record.CommandBytes) == 0 ||
		len(record.CommandPayloadSHA256) != sha256.Size {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command_record",
			"is not a complete outgoing command",
		)
	}
	if record.CommandID != result.GetCommandId() ||
		record.RequestID != result.GetRequestId() {
		return NewFederationError(
			FederationErrorIdempotencyConflict,
			operation,
			"command_id",
			"does not match the persisted outgoing command identity",
		)
	}
	persistedHash := sha256.Sum256(record.CommandBytes)
	if !bytes.Equal(persistedHash[:], record.CommandPayloadSHA256) ||
		!bytes.Equal(record.CommandPayloadSHA256, result.GetCommandPayloadSha256()) {
		return NewFederationError(
			FederationErrorIdempotencyConflict,
			operation,
			"command_payload_sha256",
			"does not match the exact persisted outgoing command bytes",
		)
	}

	command := &model.FriendRequestCommand{}
	if err := proto.Unmarshal(record.CommandBytes, command); err != nil {
		return WrapFederationError(FederationErrorPersistence, operation, err)
	}
	canonicalBytes, err := CanonicalFriendRequestCommandBytes(command)
	if err != nil {
		return err
	}
	body := command.GetBody()
	if !bytes.Equal(canonicalBytes, record.CommandBytes) ||
		body.GetCommandId() != record.CommandID ||
		body.GetRequestId() != record.RequestID ||
		body.GetReceiverHomeStationPeerId() != record.AuthorityStationPeerID {
		return NewFederationError(
			FederationErrorIdempotencyConflict,
			operation,
			"command_record",
			"does not contain the exact canonical Friend Request command",
		)
	}
	expectedState := model.FriendRequestState_FRIEND_REQUEST_STATE_UNSPECIFIED
	switch body.GetAction() {
	case model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND:
		expectedState = model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING
	case model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT:
		expectedState = model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED
	case model.FriendRequestAction_FRIEND_REQUEST_ACTION_REJECT:
		expectedState = model.FriendRequestState_FRIEND_REQUEST_STATE_REJECTED
	default:
		return NewFederationError(
			FederationErrorIdempotencyConflict,
			operation,
			"command_record",
			"contains an unsupported action",
		)
	}
	if event := result.GetEvent(); event != nil {
		if event.GetState() != expectedState {
			return NewFederationError(
				FederationErrorStateConflict,
				operation,
				"event.state",
				"does not match the exact outgoing command action",
			)
		}
		if event.GetAuthorityStationPeerId() != body.GetReceiverHomeStationPeerId() ||
			event.GetFederationId() != body.GetFederationId() ||
			event.GetSenderHomeStationPeerId() != body.GetSenderHomeStationPeerId() ||
			event.GetReceiverHomeStationPeerId() != body.GetReceiverHomeStationPeerId() ||
			!proto.Equal(event.GetSender(), body.GetSender()) ||
			!proto.Equal(event.GetReceiver(), body.GetReceiver()) {
			return NewFederationError(
				FederationErrorIdempotencyConflict,
				operation,
				"event",
				"does not bind the exact outgoing command actors and Stations",
			)
		}
	}
	return nil
}

// DirectConversationEffectID is stable across retries and Station restarts.
func DirectConversationEffectID(requestID string) string {
	return "social-friend-request-direct:" + requestID
}

func canonicalFriendRequestEventHashInput(
	event *model.FriendRequestEvent,
) ([]byte, error) {
	const operation = "social.canonical_friend_request_event_hash_input"
	if event == nil {
		return nil, NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"event",
			"is required",
		)
	}
	input := proto.Clone(event).(*model.FriendRequestEvent)
	input.EventHash = nil
	if hasUnknownFields(input) {
		return nil, NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"event",
			"contains unknown fields",
		)
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return nil, WrapFederationError(FederationErrorInvalidArgument, operation, err)
	}
	return encoded, nil
}

func validateCommandTimes(
	operation string,
	body *model.FriendRequestCommandBody,
	now time.Time,
) error {
	if body.GetCreatedAt() == nil || body.GetExpiresAt() == nil {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"created_at",
			"and expires_at are required",
		)
	}
	if body.GetCreatedAt().CheckValid() != nil ||
		body.GetExpiresAt().CheckValid() != nil ||
		hasUnknownFields(body.GetCreatedAt()) ||
		hasUnknownFields(body.GetExpiresAt()) {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"created_at",
			"or expires_at is invalid",
		)
	}
	createdAt := body.GetCreatedAt().AsTime().UTC()
	expiresAt := body.GetExpiresAt().AsTime().UTC()
	if createdAt.After(now.Add(friendRequestClockSkew)) ||
		!expiresAt.After(now) ||
		!expiresAt.After(createdAt) ||
		expiresAt.Sub(createdAt) > maxFriendRequestCommandLifetime {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"expires_at",
			"is outside the accepted command lifetime",
		)
	}
	return nil
}

func validateHumanActorRef(
	operation string,
	field string,
	actor *model.ActorRef,
) error {
	if actor == nil {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			field,
			"is required",
		)
	}
	if err := validateFriendRequestIdentifier(
		operation,
		field+".ptid",
		actor.GetPtid(),
	); err != nil {
		return err
	}
	if actor.GetKind() != model.ActorKind_ACTOR_KIND_PERSON {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			field+".kind",
			"must identify a Human actor",
		)
	}
	if actor.GetAcct() != strings.TrimSpace(actor.GetAcct()) ||
		len(actor.GetAcct()) > maxFriendRequestIdentifierBytes {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			field+".acct",
			"must be canonical",
		)
	}
	return nil
}

func validateFriendRequestIdentifier(
	operation string,
	field string,
	value string,
) error {
	if value == "" ||
		value != strings.TrimSpace(value) ||
		len(value) > maxFriendRequestIdentifierBytes ||
		strings.ContainsRune(value, '\x00') {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			field,
			"is required and must be canonical",
		)
	}
	return nil
}

func sameProjectionIdentity(
	current FriendRequestProjection,
	body *model.FriendRequestCommandBody,
) bool {
	return current.RequestID == body.GetRequestId() &&
		current.FederationID == body.GetFederationId() &&
		current.AuthorityStationPeerID == body.GetReceiverHomeStationPeerId() &&
		current.Sender.GetPtid() == body.GetSender().GetPtid() &&
		current.Receiver.GetPtid() == body.GetReceiver().GetPtid() &&
		current.SenderHomeStationPeerID == body.GetSenderHomeStationPeerId() &&
		current.ReceiverHomeStationPeerID == body.GetReceiverHomeStationPeerId()
}

func sameEventProjectionIdentity(
	current FriendRequestProjection,
	event *model.FriendRequestEvent,
) bool {
	return current.RequestID == event.GetRequestId() &&
		current.FederationID == event.GetFederationId() &&
		current.AuthorityStationPeerID == event.GetAuthorityStationPeerId() &&
		current.Sender.GetPtid() == event.GetSender().GetPtid() &&
		current.Receiver.GetPtid() == event.GetReceiver().GetPtid() &&
		current.SenderHomeStationPeerID == event.GetSenderHomeStationPeerId() &&
		current.ReceiverHomeStationPeerID == event.GetReceiverHomeStationPeerId()
}

func cloneFriendRequestProjection(
	projection FriendRequestProjection,
) FriendRequestProjection {
	cloned := projection
	cloned.Sender = cloneActorRef(projection.Sender)
	cloned.Receiver = cloneActorRef(projection.Receiver)
	cloned.LastEventHash = append([]byte(nil), projection.LastEventHash...)
	cloned.LastEventBytes = append([]byte(nil), projection.LastEventBytes...)
	if projection.RespondedAt != nil {
		respondedAt := projection.RespondedAt.UTC()
		cloned.RespondedAt = &respondedAt
	}
	return cloned
}

func cloneActorRef(actor *model.ActorRef) *model.ActorRef {
	if actor == nil {
		return nil
	}
	return proto.Clone(actor).(*model.ActorRef)
}

func friendRequestEventID(requestID string, sequence int64) string {
	return fmt.Sprintf("friend-request-event:%s:%d", requestID, sequence)
}

func hasUnknownFields(message proto.Message) bool {
	return message != nil && len(message.ProtoReflect().GetUnknown()) != 0
}
