package infrastructure

import (
	"context"
	"encoding/binary"

	conversationdelivery "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

// DeviceInbox appends local DKX envelopes to the canonical device inbox.
type DeviceInbox struct {
	repository     conversationdelivery.Repository
	clock          application.Clock
	localStationID string
}

// NewDeviceInbox constructs the Key Exchange delivery adapter.
func NewDeviceInbox(
	repository conversationdelivery.Repository,
	clock application.Clock,
	localStationID string,
) (*DeviceInbox, error) {
	if repository == nil || clock == nil || localStationID == "" {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"key_exchange.new_device_inbox",
			"dependencies",
			"repository, clock, and local Station are required",
		)
	}
	return &DeviceInbox{
		repository:     repository,
		clock:          clock,
		localStationID: localStationID,
	}, nil
}

// EnqueueDirectKeyExchange persists one exact, opaque Station envelope.
func (i *DeviceInbox) EnqueueDirectKeyExchange(
	ctx context.Context,
	envelope domain.DirectKeyExchangeEnvelope,
) (string, error) {
	payload := &chatmodel.DirectKeyExchangePayload{
		SessionId:         envelope.SessionID,
		Kind:              directKeyExchangeKind(envelope.Kind),
		OpaqueKeyMaterial: append([]byte(nil), envelope.OpaqueKeyMaterial...),
	}
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		return "", domain.WrapError(
			domain.ErrorCodeInternal,
			"key_exchange.enqueue_direct_key_exchange",
			err,
		)
	}
	wireEnvelope := &chatmodel.StationEnvelope{
		EnvelopeId:                 envelope.EnvelopeID,
		ConversationId:             envelope.ConversationID,
		IdempotencyKey:             envelope.IdempotencyKey,
		SenderPtid:                 envelope.Sender.ActorPTID,
		SenderDeviceId:             envelope.Sender.DeviceID,
		SenderHomeStationPeerId:    i.localStationID,
		RecipientPtid:              envelope.Recipient.ActorPTID,
		RecipientDeviceId:          envelope.Recipient.DeviceID,
		RecipientHomeStationPeerId: envelope.RecipientHomeStation,
		PayloadType: chatmodel.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_DIRECT_KEY_EXCHANGE,
		PayloadBytes: payloadBytes,
	}
	opaque, err := proto.MarshalOptions{Deterministic: true}.Marshal(wireEnvelope)
	if err != nil {
		return "", domain.WrapError(
			domain.ErrorCodeInternal,
			"key_exchange.enqueue_direct_key_exchange",
			err,
		)
	}
	payloadHash := valueobject.HashBytes(opaque)
	queueIdentity := valueobject.HashBytes([]byte(envelope.IdempotencyKey))
	sequence := binary.BigEndian.Uint64(queueIdentity.Bytes()[:8]) & uint64(^uint64(0)>>1)
	if sequence == 0 {
		sequence = 1
	}
	item, err := i.repository.Enqueue(ctx, conversationdelivery.EnqueueRequest{
		ItemID: envelope.EnvelopeID,
		Recipient: valueobject.Endpoint{
			Actor:  valueobject.PTID(envelope.Recipient.ActorPTID),
			Device: valueobject.DeviceID(envelope.Recipient.DeviceID),
		},
		EventID:        valueobject.EventID(envelope.EnvelopeID),
		EventSequence:  valueobject.Sequence(sequence),
		ConversationID: valueobject.ConversationID(envelope.ConversationID),
		IdempotencyKey: queueIdentity.String(),
		PayloadType:    conversationdelivery.PayloadTypeDirectSessionInit,
		OpaquePayload:  opaque,
		PayloadHash:    payloadHash,
		CreatedAt:      i.clock.Now().UTC(),
	})
	if err != nil {
		return "", domain.WrapError(
			domain.ErrorCodeDependency,
			"key_exchange.enqueue_direct_key_exchange",
			err,
		)
	}
	if item.ItemID == "" {
		return "", domain.NewError(
			domain.ErrorCodeDependency,
			"key_exchange.enqueue_direct_key_exchange",
			"item_id",
			"canonical inbox returned an empty identifier",
		)
	}
	return item.ItemID, nil
}

func directKeyExchangeKind(
	kind domain.DirectKeyExchangeKind,
) chatmodel.DirectKeyExchangeKind {
	switch kind {
	case domain.DirectKeyExchangeKindPreKeyBundle:
		return chatmodel.DirectKeyExchangeKind_DIRECT_KEY_EXCHANGE_KIND_PREKEY_BUNDLE
	case domain.DirectKeyExchangeKindInitialMessage:
		return chatmodel.DirectKeyExchangeKind_DIRECT_KEY_EXCHANGE_KIND_INITIAL_MESSAGE
	case domain.DirectKeyExchangeKindRatchetKeyUpdate:
		return chatmodel.DirectKeyExchangeKind_DIRECT_KEY_EXCHANGE_KIND_RATCHET_KEY_UPDATE
	default:
		return chatmodel.DirectKeyExchangeKind_DIRECT_KEY_EXCHANGE_KIND_UNSPECIFIED
	}
}

var _ application.DeviceInboxPort = (*DeviceInbox)(nil)
