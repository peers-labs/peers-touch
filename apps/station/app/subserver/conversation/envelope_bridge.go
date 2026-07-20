package conversation

import (
	"context"

	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	envpkg "github.com/peers-labs/peers-touch/station/app/subserver/envelope"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// EnvelopeBridge routes committed events through the envelope service.
type EnvelopeBridge struct {
	envelopeService envpkg.Service
}

func NewEnvelopeBridge(envelopeService envpkg.Service) *EnvelopeBridge {
	return &EnvelopeBridge{envelopeService: envelopeService}
}

func (b *EnvelopeBridge) SubmitEvent(ctx context.Context, conv *chat.Conversation, members []*chat.ConversationMember, event *chat.CommittedConversationEvent) error {
	eventBytes, err := proto.Marshal(event)
	if err != nil {
		return err
	}

	for _, member := range members {
		if member.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			continue
		}

		env := &chat.StationEnvelope{
			EnvelopeId:                 uuid.NewString(),
			IdempotencyKey:             event.EventId + ":" + member.Ptid,
			SenderPtid:                 event.CommittedByStationPeerId,
			RecipientPtid:              member.Ptid,
			RecipientHomeStationPeerId: member.ActorHomeStationPeerId,
			ConversationId:             conv.ConversationId,
			PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
			PayloadBytes:               eventBytes,
		}

		if _, err := b.envelopeService.Submit(ctx, env); err != nil {
			return err
		}
	}
	return nil
}

func (b *EnvelopeBridge) SubmitReceipt(ctx context.Context, receipt *chat.MessageReceipt, recipientPtid, recipientStation string) error {
	receiptBytes, err := proto.Marshal(receipt)
	if err != nil {
		return err
	}

	env := &chat.StationEnvelope{
		EnvelopeId:                 uuid.NewString(),
		IdempotencyKey:             receipt.MessageId + ":" + receipt.Ptid + ":" + receipt.ReceiptType.String(),
		SenderPtid:                 receipt.Ptid,
		RecipientPtid:              recipientPtid,
		RecipientHomeStationPeerId: recipientStation,
		ConversationId:             receipt.ConversationId,
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_RECEIPT,
		PayloadBytes:               receiptBytes,
	}

	_, err = b.envelopeService.Submit(ctx, env)
	return err
}
