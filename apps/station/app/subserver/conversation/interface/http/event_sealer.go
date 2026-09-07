package http

import (
	"bytes"
	"crypto/ed25519"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type ProtobufEventSealer struct{}

type ProtobufConversationStateEncoder struct{}
type ProtobufDeviceEventEncoder struct{}
type ProtobufReadCursorEncoder struct{}
type ProtobufLeaveIntentSigningEncoder struct{}
type ProtobufCommandProposalSigningEncoder struct{}

func (ProtobufConversationStateEncoder) EncodeConversationStateMarker(
	conversationID valueobject.ConversationID,
	eventID valueobject.EventID,
) ([]byte, error) {
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.ConversationStateMarker{
			ConversationId: string(conversationID),
			EventId:        string(eventID),
		},
	)
	if err != nil {
		return nil, fmt.Errorf(
			"conversation interface: encode conversation state marker: %w",
			err,
		)
	}
	return encoded, nil
}

func (ProtobufDeviceEventEncoder) EncodeDeviceEvent(
	event domainevent.Record,
	delivery valueobject.PreparedDelivery,
	commitment valueobject.Hash,
	senderActorIdentityPublicKey []byte,
) ([]byte, error) {
	if len(senderActorIdentityPublicKey) != ed25519.PublicKeySize ||
		commitment.IsZero() {
		return nil, fmt.Errorf(
			"conversation interface: complete sender identity and delivery commitment are required",
		)
	}
	payloadHash := valueobject.HashBytes(delivery.Opaque)
	if !bytes.Equal(payloadHash[:], delivery.PayloadHash[:]) {
		return nil, fmt.Errorf(
			"conversation interface: endpoint payload hash does not match payload",
		)
	}
	kind := deliveryKindToProto(delivery.Kind)
	if kind == chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_UNSPECIFIED {
		return nil, fmt.Errorf("conversation interface: unsupported endpoint payload kind")
	}
	wireEvent, err := MapEvent(event)
	if err != nil {
		return nil, err
	}
	return proto.MarshalOptions{Deterministic: true}.Marshal(&chat.DeviceEventDelivery{
		Event:                        wireEvent,
		Recipient:                    endpointToProto(delivery.Recipient),
		PayloadKind:                  kind,
		EndpointPayload:              append([]byte(nil), delivery.Opaque...),
		EndpointPayloadSha256:        delivery.PayloadHash.Bytes(),
		DeliveryCommitment:           commitment.Bytes(),
		SenderActorIdentityPublicKey: append([]byte(nil), senderActorIdentityPublicKey...),
	})
}

func (ProtobufReadCursorEncoder) EncodeReadCursor(
	cursor repository.ReadCursor,
) ([]byte, error) {
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(&chat.ActorReadCursor{
		ConversationId:   string(cursor.ConversationID),
		ReaderPtid:       string(cursor.Actor),
		LastReadSequence: int64(cursor.Sequence),
		UpdatedAt:        timestamppb.New(cursor.UpdatedAt),
	})
	if err != nil {
		return nil, fmt.Errorf("conversation interface: encode read cursor: %w", err)
	}
	return encoded, nil
}

func (ProtobufLeaveIntentSigningEncoder) EncodeLeaveIntentSigningInput(
	input ports.LeaveIntentSigningInput,
) ([]byte, error) {
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.MlsLeaveIntentSigningInput{
			Version:                 input.Version,
			IntentId:                input.IntentID,
			FederationId:            string(input.FederationID),
			AuthorityStationPeerId:  string(input.AuthorityStation),
			AuthorityEpoch:          int64(input.AuthorityEpoch),
			HomeStationPeerId:       string(input.HomeStation),
			ConversationId:          string(input.ConversationID),
			ActorPtid:               string(input.Actor.Actor),
			ActorDeviceId:           string(input.Actor.Device),
			ActorSigningKeyId:       input.SigningKeyID,
			ObservedMembershipEpoch: int64(input.AuthorityHead.MembershipEpoch),
			ObservedMlsEpoch:        int64(input.AuthorityHead.MLSEpoch),
			CreatedAtUnixMs:         input.CreatedAtUnixMillis,
			ExpiresAtUnixMs:         input.ExpiresAtUnixMillis,
			AuthoritySequence:       int64(input.AuthorityHead.Sequence),
			AuthorityHash:           input.AuthorityHead.EventHash.Bytes(),
		},
	)
	if err != nil {
		return nil, fmt.Errorf(
			"conversation interface: encode leave intent signing input: %w",
			err,
		)
	}
	return encoded, nil
}

func (ProtobufCommandProposalSigningEncoder) EncodeCommandProposalSigningInput(
	input ports.CommandProposalSigningInput,
) ([]byte, error) {
	commandKind := commandKindToProto(input.CommandKind)
	if commandKind == chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED {
		return nil, fmt.Errorf(
			"conversation interface: unsupported command proposal kind %q",
			input.CommandKind,
		)
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.ConversationCommandProposalSigningInput{
			Version:                input.Version,
			FederationId:           string(input.FederationID),
			AuthorityStationPeerId: string(input.AuthorityStation),
			AuthorityEpoch:         int64(input.AuthorityEpoch),
			HomeStationPeerId:      string(input.HomeStation),
			ConversationId:         string(input.ConversationID),
			CommandId:              string(input.CommandID),
			CommandKind:            commandKind,
			ActorPtid:              string(input.Actor.Actor),
			ActorDeviceId:          string(input.Actor.Device),
			ActorSigningKeyId:      input.SigningKeyID,
			CommandSha256:          input.CommandHash.Bytes(),
			CreatedAtUnixMs:        input.CreatedAtUnixMillis,
			ExpiresAtUnixMs:        input.ExpiresAtUnixMillis,
		},
	)
	if err != nil {
		return nil, fmt.Errorf(
			"conversation interface: encode command proposal signing input: %w",
			err,
		)
	}
	return encoded, nil
}

func (ProtobufEventSealer) Seal(
	input domainevent.RecordInput,
) (domainevent.Record, error) {
	provisional, err := domainevent.CanonicalSealer{}.Seal(input)
	if err != nil {
		return domainevent.Record{}, err
	}
	wire, err := MapEvent(provisional)
	if err != nil {
		return domainevent.Record{}, err
	}
	wire.EventHash = nil
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(wire)
	if err != nil {
		return domainevent.Record{}, fmt.Errorf(
			"conversation interface: encode event hash input: %w",
			err,
		)
	}
	hash := valueobject.HashBytes(canonical)
	wire.EventHash = hash.Bytes()
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(wire)
	if err != nil {
		return domainevent.Record{}, fmt.Errorf(
			"conversation interface: encode committed event: %w",
			err,
		)
	}
	return domainevent.SealTransportRecord(
		input,
		hash,
		encoded,
	)
}

func deliveryKindToProto(kind valueobject.DeliveryKind) chat.PreparedEndpointPayloadKind {
	switch kind {
	case valueobject.DeliveryKindDirectCiphertext:
		return chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_CIPHERTEXT
	case valueobject.DeliveryKindMLSApplication:
		return chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_APPLICATION
	case valueobject.DeliveryKindMLSCommit:
		return chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_COMMIT
	case valueobject.DeliveryKindMLSWelcome:
		return chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_WELCOME
	case valueobject.DeliveryKindPublicEvent:
		return chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT
	case valueobject.DeliveryKindConversation:
		return chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_CONVERSATION_STATE
	case valueobject.DeliveryKindMLSRetirement:
		return chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_RETIREMENT
	default:
		return chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_UNSPECIFIED
	}
}

func commandKindToProto(kind domainevent.Kind) chat.ConversationCommandKind {
	switch kind {
	case domainevent.KindMessageCommitted:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_SEND_MESSAGE
	case domainevent.KindMessageEdited:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_EDIT_MESSAGE
	case domainevent.KindMessageRetracted:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_RETRACT_MESSAGE
	case domainevent.KindConversationDissolved:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_DISSOLVE
	case domainevent.KindConversationSettings:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UPDATE_SETTINGS
	case domainevent.KindReactionCommitted:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_REACT
	case domainevent.KindMessagePinCommitted:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_PIN_MESSAGE
	case domainevent.KindMembershipCommitted:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MEMBERSHIP_TRANSITION
	default:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED
	}
}
