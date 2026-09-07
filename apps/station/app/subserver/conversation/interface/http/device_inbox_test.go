package http_test

import (
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	touchmodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type deviceInboxApplicationSpy struct {
	claims         int
	acknowledges   int
	rejects        int
	claimRecipient valueobject.Endpoint
	ackRequest     delivery.AcknowledgeRequest
	rejectRequest  delivery.RejectRequest
	claimResult    delivery.ClaimResult
	rejectResult   delivery.RejectResult
}

func (s *deviceInboxApplicationSpy) Claim(
	_ context.Context,
	recipient valueobject.Endpoint,
	_ string,
	_ uint64,
	_ int64,
	_ uint32,
) (delivery.ClaimResult, error) {
	s.claims++
	s.claimRecipient = recipient

	return s.claimResult, nil
}

func (s *deviceInboxApplicationSpy) Acknowledge(
	_ context.Context,
	request delivery.AcknowledgeRequest,
) (int64, error) {
	s.acknowledges++
	s.ackRequest = request

	return 7, nil
}

func (s *deviceInboxApplicationSpy) Reject(
	_ context.Context,
	request delivery.RejectRequest,
) (delivery.RejectResult, error) {
	s.rejects++
	s.rejectRequest = request

	return s.rejectResult, nil
}

func actorDevice(ptid string, deviceID string) *touchmodel.ActorDeviceRef {
	return &touchmodel.ActorDeviceRef{
		Actor:    &touchmodel.ActorRef{Ptid: ptid},
		DeviceId: deviceID,
	}
}

func TestDeviceInboxHandlerMapsCanonicalClaimContract(t *testing.T) {
	now := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	payload := []byte("opaque")
	payloadHash := valueobject.HashBytes(payload)
	spy := &deviceInboxApplicationSpy{
		claimResult: delivery.ClaimResult{
			ConsumerEpoch: 4,
			LaneHead:      9,
			AckedThrough:  7,
			Items: []delivery.Item{{
				ItemID: "item-8",
				Recipient: valueobject.Endpoint{
					Actor:  "ptid:alice",
					Device: "alice-device",
				},
				LaneSequence:   8,
				EventID:        "event-8",
				ConversationID: "conversation-1",
				IdempotencyKey: "idempotency-8",
				PayloadType:    delivery.PayloadTypeConversationEvent,
				OpaquePayload:  payload,
				PayloadHash:    payloadHash,
				State:          delivery.ItemStateClaimed,
				AttemptCount:   2,
				Lease: &delivery.Lease{
					ConsumerID:    "consumer-a",
					ConsumerEpoch: 4,
					ExpiresAt:     now.Add(time.Minute),
				},
				FirstQueuedAt: now.Add(-time.Hour),
				NextAttemptAt: now.Add(-time.Hour),
			}},
		},
	}
	handler, err := conversationhttp.NewDeviceInboxHandler(spy)
	if err != nil {
		t.Fatal(err)
	}

	response, err := handler.Claim(
		context.Background(),
		conversationhttp.AuthenticatedActor{
			PTID:     "ptid:alice",
			DeviceID: "alice-device",
		},
		&chat.ClaimDeviceInboxRequest{
			Device:            actorDevice("ptid:alice", "alice-device"),
			ConsumerId:        "consumer-a",
			BatchLimit:        10,
			AfterLaneSequence: 7,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if spy.claims != 1 ||
		spy.claimRecipient.Actor != "ptid:alice" ||
		spy.claimRecipient.Device != "alice-device" {
		t.Fatalf("claim binding calls=%d recipient=%+v", spy.claims, spy.claimRecipient)
	}
	if response.ConsumerEpoch != 4 ||
		response.LaneHeadSequence != 9 ||
		response.AckedThroughSequence != 7 ||
		len(response.Items) != 1 {
		t.Fatalf("claim response = %+v", response)
	}
	item := response.Items[0]
	if item.GetRecipient().GetActor().GetPtid() != "ptid:alice" ||
		item.GetRecipient().GetDeviceId() != "alice-device" ||
		item.GetPayloadType() != chat.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_CONVERSATION_EVENT ||
		item.GetState() != chat.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_CLAIMED ||
		item.GetLease().GetConsumerEpoch() != 4 {
		t.Fatalf("mapped item = %+v", item)
	}
}

func TestDeviceInboxHandlerRejectsEndpointMismatchBeforeApplication(t *testing.T) {
	spy := &deviceInboxApplicationSpy{}
	handler, err := conversationhttp.NewDeviceInboxHandler(spy)
	if err != nil {
		t.Fatal(err)
	}
	authenticated := conversationhttp.AuthenticatedActor{
		PTID:     "ptid:alice",
		DeviceID: "alice-device",
	}

	if _, err := handler.Claim(
		context.Background(),
		authenticated,
		&chat.ClaimDeviceInboxRequest{
			Device:     actorDevice("ptid:mallory", "alice-device"),
			ConsumerId: "consumer-a",
			BatchLimit: 1,
		},
	); !delivery.IsCode(err, delivery.ErrorCodeUnauthorized) {
		t.Fatalf("claim mismatch error = %v", err)
	}
	if _, err := handler.Acknowledge(
		context.Background(),
		authenticated,
		&chat.AcknowledgeDeviceInboxItemRequest{
			Device:        actorDevice("ptid:alice", "other-device"),
			ItemId:        "item-1",
			LaneSequence:  1,
			ConsumerEpoch: 1,
			PayloadSha256: make([]byte, sha256.Size),
		},
	); !delivery.IsCode(err, delivery.ErrorCodeUnauthorized) {
		t.Fatalf("acknowledge mismatch error = %v", err)
	}
	if _, err := handler.Reject(
		context.Background(),
		authenticated,
		&chat.RejectDeviceInboxItemRequest{
			Device:        nil,
			ItemId:        "item-1",
			LaneSequence:  1,
			ConsumerEpoch: 1,
			ErrorCode:     chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_RETRY_LATER,
		},
	); !delivery.IsCode(err, delivery.ErrorCodeUnauthorized) {
		t.Fatalf("reject mismatch error = %v", err)
	}
	if spy.claims != 0 || spy.acknowledges != 0 || spy.rejects != 0 {
		t.Fatalf(
			"mismatched request reached application: claim=%d ack=%d reject=%d",
			spy.claims,
			spy.acknowledges,
			spy.rejects,
		)
	}
}

func TestDeviceInboxHandlerMapsAcknowledgeAndRejectContracts(t *testing.T) {
	nextAttemptAt := time.Date(2026, time.September, 6, 12, 1, 0, 0, time.UTC)
	spy := &deviceInboxApplicationSpy{
		rejectResult: delivery.RejectResult{
			State:         delivery.ItemStateRetryWait,
			NextAttemptAt: &nextAttemptAt,
		},
	}
	handler, err := conversationhttp.NewDeviceInboxHandler(spy)
	if err != nil {
		t.Fatal(err)
	}
	authenticated := conversationhttp.AuthenticatedActor{
		PTID:     "ptid:alice",
		DeviceID: "alice-device",
	}
	payloadHash := sha256.Sum256([]byte("opaque"))

	acknowledged, err := handler.Acknowledge(
		context.Background(),
		authenticated,
		&chat.AcknowledgeDeviceInboxItemRequest{
			Device:        actorDevice("ptid:alice", "alice-device"),
			ItemId:        "item-7",
			LaneSequence:  7,
			ConsumerEpoch: 3,
			PayloadSha256: payloadHash[:],
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if acknowledged.GetAckedThroughSequence() != 7 ||
		spy.ackRequest.Recipient.Actor != "ptid:alice" ||
		spy.ackRequest.PayloadHash != valueobject.Hash(payloadHash) {
		t.Fatalf("acknowledge response=%+v request=%+v", acknowledged, spy.ackRequest)
	}

	rejected, err := handler.Reject(
		context.Background(),
		authenticated,
		&chat.RejectDeviceInboxItemRequest{
			Device:        actorDevice("ptid:alice", "alice-device"),
			ItemId:        "item-8",
			LaneSequence:  8,
			ConsumerEpoch: 3,
			ErrorCode:     chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_CRYPTO_STATE_UNAVAILABLE,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if spy.rejectRequest.Code != delivery.RejectCodeCryptoStateUnavailable ||
		rejected.GetState() != chat.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_RETRY_WAIT ||
		!rejected.GetNextAttemptAt().AsTime().Equal(nextAttemptAt) {
		t.Fatalf("reject response=%+v request=%+v", rejected, spy.rejectRequest)
	}
}

func TestDeviceInboxHandlerRejectsInvalidCanonicalValues(t *testing.T) {
	spy := &deviceInboxApplicationSpy{}
	handler, err := conversationhttp.NewDeviceInboxHandler(spy)
	if err != nil {
		t.Fatal(err)
	}
	authenticated := conversationhttp.AuthenticatedActor{
		PTID:     "ptid:alice",
		DeviceID: "alice-device",
	}

	if _, err := handler.Acknowledge(
		context.Background(),
		authenticated,
		&chat.AcknowledgeDeviceInboxItemRequest{
			Device:        actorDevice("ptid:alice", "alice-device"),
			ItemId:        "item-1",
			LaneSequence:  1,
			ConsumerEpoch: 1,
			PayloadSha256: []byte("short"),
		},
	); !delivery.IsCode(err, delivery.ErrorCodeInvalidArgument) {
		t.Fatalf("invalid payload hash error = %v", err)
	}
	if _, err := handler.Reject(
		context.Background(),
		authenticated,
		&chat.RejectDeviceInboxItemRequest{
			Device:        actorDevice("ptid:alice", "alice-device"),
			ItemId:        "item-1",
			LaneSequence:  1,
			ConsumerEpoch: 1,
			ErrorCode:     chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_UNSPECIFIED,
		},
	); !delivery.IsCode(err, delivery.ErrorCodeInvalidArgument) {
		t.Fatalf("invalid reject code error = %v", err)
	}
	if spy.acknowledges != 0 || spy.rejects != 0 {
		t.Fatalf("invalid request reached application: ack=%d reject=%d", spy.acknowledges, spy.rejects)
	}
}
