package http_test

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	touchmodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var interactionHandlerTestTime = time.Date(
	2026,
	time.September,
	6,
	17,
	0,
	0,
	0,
	time.UTC,
)

type interactionApplicationStub struct {
	typing     interaction.TypingPulse
	readCursor interaction.ReadCursorRequest
	receipt    interaction.DeliveryReceipt
	forwarded  bool
}

func (s *interactionApplicationStub) SubmitTyping(
	_ context.Context,
	pulse interaction.TypingPulse,
) (interaction.TypingResult, error) {
	s.typing = pulse

	return interaction.TypingResult{
		Accepted:  true,
		ExpiresAt: pulse.ExpiresAt,
	}, nil
}

func (s *interactionApplicationStub) SubmitReadCursor(
	_ context.Context,
	request interaction.ReadCursorRequest,
) (interaction.ReadCursorResult, error) {
	s.readCursor = request

	return interaction.ReadCursorResult{Result: command.ReadCursorResult{
		Cursor: repository.ReadCursor{
			ConversationID: request.ConversationID,
			Actor:          request.Reader.Actor,
			Sequence:       request.Sequence,
			UpdatedAt:      interactionHandlerTestTime,
		},
	}}, nil
}

func (s *interactionApplicationStub) SubmitDeliveryReceipt(
	_ context.Context,
	receipt interaction.DeliveryReceipt,
) (interaction.DeliveryRecordResult, error) {
	s.receipt = receipt
	if s.forwarded {
		return interaction.DeliveryRecordResult{Forwarded: true}, nil
	}

	return interaction.DeliveryRecordResult{
		Aggregate: interaction.DeliveryAggregate{
			ConversationID:      receipt.ConversationID,
			EventID:             receipt.EventID,
			EventSequence:       receipt.EventSequence,
			RequiredDeviceCount: 2,
			ConsumedDeviceCount: 1,
			Delivered:           true,
		},
		Originator: "ptid:alice",
	}, nil
}

func TestInteractionHandlerMapsCanonicalTypingAndReadCursorContracts(t *testing.T) {
	stub := &interactionApplicationStub{}
	handler, err := conversationhttp.NewInteractionHandler(stub)
	if err != nil {
		t.Fatal(err)
	}
	authenticated := conversationhttp.AuthenticatedActor{
		PTID:     "ptid:bob",
		DeviceID: "bob-1",
	}
	expiresAt := interactionHandlerTestTime.Add(6 * time.Second)
	typingResponse, err := handler.SubmitTyping(
		context.Background(),
		authenticated,
		&chat.SubmitConversationTypingRequest{
			ConversationId: "conversation-1",
			Sender: &touchmodel.ActorDeviceRef{
				Actor:    &touchmodel.ActorRef{Ptid: "ptid:bob"},
				DeviceId: "bob-1",
			},
			PulseGeneration: 7,
			ExpiresAt:       timestamppb.New(expiresAt),
			IsTyping:        true,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !typingResponse.GetAccepted() ||
		stub.typing.Sender != (valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"}) ||
		stub.typing.Generation != 7 ||
		!stub.typing.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("typing response=%+v mapped=%+v", typingResponse, stub.typing)
	}

	cursorResponse, err := handler.SubmitReadCursor(
		context.Background(),
		authenticated,
		&chat.SubmitConversationReadCursorRequest{
			Cursor: &chat.ActorReadCursor{
				ConversationId:   "conversation-1",
				ReaderPtid:       "ptid:bob",
				LastReadSequence: 3,
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if cursorResponse.GetCursor().GetReaderPtid() != "ptid:bob" ||
		stub.readCursor.Reader.Device != "bob-1" ||
		stub.readCursor.Sequence != 3 {
		t.Fatalf("cursor response=%+v mapped=%+v", cursorResponse, stub.readCursor)
	}

	_, err = handler.SubmitReadCursor(
		context.Background(),
		authenticated,
		&chat.SubmitConversationReadCursorRequest{
			Cursor: &chat.ActorReadCursor{
				ConversationId:   "conversation-1",
				ReaderPtid:       "ptid:mallory",
				LastReadSequence: 3,
			},
		},
	)
	if !interaction.IsCode(err, interaction.ErrorCodeUnauthorized) {
		t.Fatalf("reader binding error = %v", err)
	}
}

func TestInteractionHandlerMapsCanonicalDeliveryReceipt(t *testing.T) {
	stub := &interactionApplicationStub{}
	handler, err := conversationhttp.NewInteractionHandler(stub)
	if err != nil {
		t.Fatal(err)
	}
	payloadHash := valueobject.HashBytes([]byte("opaque"))
	response, err := handler.SubmitDeliveryReceipt(
		context.Background(),
		conversationhttp.AuthenticatedActor{
			PTID:     "ptid:bob",
			DeviceID: "bob-1",
		},
		&chat.SubmitConversationDeliveryReceiptRequest{
			Receipt: &chat.DeviceConsumptionReceipt{
				ReceiptId:      "device-consumed:item-3",
				ConversationId: "conversation-1",
				EventId:        "event-3",
				Consumer: &chat.CryptoEndpoint{
					Ptid:     "ptid:bob",
					DeviceId: "bob-1",
				},
				EventSequence: 3,
				LaneSequence:  9,
				PayloadSha256: payloadHash.Bytes(),
				ConsumedAt:    timestamppb.New(interactionHandlerTestTime),
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if stub.receipt.Consumer.Device != "bob-1" ||
		stub.receipt.PayloadHash != payloadHash ||
		response.GetDelivery().GetRequiredDeviceCount() != 2 ||
		!response.GetDelivery().GetDelivered() {
		t.Fatalf("receipt response=%+v mapped=%+v", response, stub.receipt)
	}
	stub.forwarded = true
	forwarded, err := handler.SubmitDeliveryReceipt(
		context.Background(),
		conversationhttp.AuthenticatedActor{
			PTID:     "ptid:bob",
			DeviceID: "bob-1",
		},
		&chat.SubmitConversationDeliveryReceiptRequest{
			Receipt: &chat.DeviceConsumptionReceipt{
				ReceiptId:      "device-consumed:item-3",
				ConversationId: "conversation-1",
				EventId:        "event-3",
				Consumer: &chat.CryptoEndpoint{
					Ptid:     "ptid:bob",
					DeviceId: "bob-1",
				},
				EventSequence: 3,
				LaneSequence:  9,
				PayloadSha256: payloadHash.Bytes(),
				ConsumedAt:    timestamppb.New(interactionHandlerTestTime),
			},
		},
	)
	if err != nil || forwarded.GetDelivery() != nil {
		t.Fatalf("forwarded receipt response=%+v error=%v", forwarded, err)
	}

	_, err = handler.SubmitDeliveryReceipt(
		context.Background(),
		conversationhttp.AuthenticatedActor{
			PTID:     "ptid:mallory",
			DeviceID: "mallory-1",
		},
		&chat.SubmitConversationDeliveryReceiptRequest{
			Receipt: &chat.DeviceConsumptionReceipt{
				Consumer: &chat.CryptoEndpoint{
					Ptid:     "ptid:bob",
					DeviceId: "bob-1",
				},
				ConsumedAt: timestamppb.New(interactionHandlerTestTime),
			},
		},
	)
	if !interaction.IsCode(err, interaction.ErrorCodeUnauthorized) {
		t.Fatalf("consumer binding error = %v", err)
	}
}
