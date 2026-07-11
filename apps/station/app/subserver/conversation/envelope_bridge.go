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
			IdempotencyKey:             event.EventId + ":" + member.ActorDid,
			SenderActorDid:             event.CommittedByStationPeerId,
			RecipientActorDid:          member.ActorDid,
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

func (b *EnvelopeBridge) SubmitReceipt(ctx context.Context, receipt *chat.MessageReceipt, recipientDID, recipientStation string) error {
	receiptBytes, err := proto.Marshal(receipt)
	if err != nil {
		return err
	}

	env := &chat.StationEnvelope{
		EnvelopeId:                 uuid.NewString(),
		IdempotencyKey:             receipt.MessageId + ":" + receipt.ActorDid + ":" + receipt.ReceiptType.String(),
		SenderActorDid:             receipt.ActorDid,
		RecipientActorDid:          recipientDID,
		RecipientHomeStationPeerId: recipientStation,
		ConversationId:             receipt.ConversationId,
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_RECEIPT,
		PayloadBytes:               receiptBytes,
	}

	_, err = b.envelopeService.Submit(ctx, env)
	return err
}
