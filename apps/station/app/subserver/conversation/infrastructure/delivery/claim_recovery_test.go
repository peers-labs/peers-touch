package delivery_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	application "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	infrastructure "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	adapter "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	touchmodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

func TestClaimRecoversCommittedLostResponseWithoutReplayingLease(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	database, err := fixture.db.DB()
	if err != nil {
		t.Fatal(err)
	}
	database.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("close database: %v", err)
		}
	})
	handler, err := adapter.NewDeviceInboxHandler(fixture.service)
	if err != nil {
		t.Fatal(err)
	}
	authenticated := adapter.AuthenticatedActor{
		PTID: string(fixture.recipient.Actor), DeviceID: string(fixture.recipient.Device),
	}
	device := &touchmodel.ActorDeviceRef{
		Actor:    &touchmodel.ActorRef{Ptid: authenticated.PTID},
		DeviceId: authenticated.DeviceID,
	}
	var dropResponse atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		wire, err := io.ReadAll(request.Body)
		if err != nil {
			t.Errorf("read claim: %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		input := &chat.ClaimDeviceInboxRequest{}
		if err := proto.Unmarshal(wire, input); err != nil {
			t.Errorf("decode claim: %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		output, err := handler.Claim(request.Context(), authenticated, input)
		if err != nil {
			t.Errorf("claim: %v", err)
			writer.WriteHeader(http.StatusConflict)
			return
		}
		if dropResponse.Swap(false) {
			panic(http.ErrAbortHandler)
		}
		wire, err = proto.Marshal(output)
		if err != nil {
			t.Errorf("encode claim: %v", err)
			writer.WriteHeader(http.StatusInternalServerError)
			return
		}
		if _, err := writer.Write(wire); err != nil {
			t.Errorf("write claim: %v", err)
		}
	}))
	t.Cleanup(server.Close)
	client := &http.Client{Timeout: 2 * time.Second}
	claim := func(expected uint64) (*chat.ClaimDeviceInboxResponse, error) {
		t.Helper()
		wire, err := proto.Marshal(&chat.ClaimDeviceInboxRequest{
			Device: device, ConsumerId: "consumer-a", ExpectedConsumerEpoch: expected, BatchLimit: 1,
		})
		if err != nil {
			t.Fatal(err)
		}
		response, err := client.Post(server.URL, "application/protobuf", bytes.NewReader(wire))
		if err != nil {
			return nil, err
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("claim status = %d", response.StatusCode)
		}
		wire, err = io.ReadAll(response.Body)
		if err != nil {
			return nil, err
		}
		result := &chat.ClaimDeviceInboxResponse{}
		return result, proto.Unmarshal(wire, result)
	}
	initial, err := claim(0)
	if err != nil {
		t.Fatal(err)
	}
	if initial.ConsumerEpoch != 1 || len(initial.Items) != 0 {
		t.Fatalf("initial claim = %+v", initial)
	}
	if _, err := fixture.repository.Enqueue(
		context.Background(), enqueueRequest(fixture.recipient, "control", "control-ciphertext"),
	); err != nil {
		t.Fatal(err)
	}
	control, err := claim(initial.ConsumerEpoch)
	if err != nil {
		t.Fatal(err)
	}
	if len(control.Items) != 1 || control.ConsumerEpoch != 2 {
		t.Fatalf("control claim = %+v", control)
	}
	controlItem := control.Items[0]
	if _, err := handler.Acknowledge(context.Background(), authenticated, &chat.AcknowledgeDeviceInboxItemRequest{
		Device: device, ItemId: controlItem.ItemId, LaneSequence: controlItem.LaneSequence,
		ConsumerEpoch: control.ConsumerEpoch, PayloadSha256: controlItem.PayloadSha256,
	}); err != nil {
		t.Fatal(err)
	}
	item, err := fixture.repository.Enqueue(
		context.Background(), enqueueRequest(fixture.recipient, "lost-response", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	dropResponse.Store(true)
	if _, err := claim(control.ConsumerEpoch); !errors.Is(err, io.EOF) {
		t.Fatalf("committed response loss = %v, want network EOF", err)
	}
	beforeLane, beforeItem := claimRecoverySnapshot(t, fixture, item.ItemID)
	if beforeLane.ActiveConsumerEpoch != 3 || beforeItem.AttemptCount != 1 {
		t.Fatalf("lost response did not commit one lease: %+v %+v", beforeLane, beforeItem)
	}
	for _, expired := range []bool{false, true} {
		if expired {
			fixture.clock.now = fixture.clock.now.Add(time.Minute + time.Nanosecond)
		}
		metadata, err := claim(control.ConsumerEpoch)
		if err != nil {
			t.Fatal(err)
		}
		if metadata.ConsumerEpoch != beforeLane.ActiveConsumerEpoch || len(metadata.Items) != 0 ||
			metadata.LaneHeadSequence != 2 || metadata.AckedThroughSequence != 1 {
			t.Fatalf("recovery metadata expired=%v: %+v", expired, metadata)
		}
		afterLane, afterItem := claimRecoverySnapshot(t, fixture, item.ItemID)
		if !reflect.DeepEqual(beforeLane, afterLane) || !reflect.DeepEqual(beforeItem, afterItem) {
			t.Fatalf("metadata recovery mutated the lane or lease, expired=%v", expired)
		}
		if !expired {
			waiting, err := claim(metadata.ConsumerEpoch)
			if err != nil {
				t.Fatal(err)
			}
			if waiting.ConsumerEpoch != metadata.ConsumerEpoch || len(waiting.Items) != 0 {
				t.Fatalf("live lease was replayed: %+v", waiting)
			}
		}
	}
	reclaimed, err := claim(beforeLane.ActiveConsumerEpoch)
	if err != nil {
		t.Fatal(err)
	}
	if reclaimed.ConsumerEpoch != 4 || len(reclaimed.Items) != 1 || reclaimed.Items[0].AttemptCount != 2 {
		t.Fatalf("reclaimed attempt = %+v", reclaimed)
	}
	if _, err := fixture.service.Acknowledge(context.Background(), application.AcknowledgeRequest{
		Recipient: fixture.recipient, ItemID: item.ItemID, LaneSequence: item.LaneSequence,
		ConsumerEpoch: beforeLane.ActiveConsumerEpoch, PayloadHash: item.PayloadHash,
	}); !application.IsCode(err, application.ErrorCodeConsumerFenced) {
		t.Fatalf("old attempt ACK = %v", err)
	}
	if _, err := fixture.service.Reject(context.Background(), application.RejectRequest{
		Recipient: fixture.recipient, ItemID: item.ItemID, LaneSequence: item.LaneSequence,
		ConsumerEpoch: beforeLane.ActiveConsumerEpoch, Code: application.RejectCodeRetryLater,
	}); !application.IsCode(err, application.ErrorCodeConsumerFenced) {
		t.Fatalf("old attempt Reject = %v", err)
	}
	if _, err := fixture.service.Acknowledge(context.Background(), application.AcknowledgeRequest{
		Recipient: fixture.recipient, ItemID: item.ItemID, LaneSequence: item.LaneSequence,
		ConsumerEpoch: reclaimed.ConsumerEpoch, PayloadHash: item.PayloadHash,
	}); err != nil {
		t.Fatal(err)
	}
	final, err := claim(reclaimed.ConsumerEpoch)
	if err != nil {
		t.Fatal(err)
	}
	if final.AckedThroughSequence != 2 || len(final.Items) != 0 {
		t.Fatalf("recovered consumption did not advance exact head: %+v", final)
	}
}

func TestClaimMetadataRecoveryPreservesConsumerAndHeadFences(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	database, err := fixture.db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("close database: %v", err)
		}
	})
	initial, err := fixture.service.Claim(context.Background(), fixture.recipient, "consumer-a", 0, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	item, err := fixture.repository.Enqueue(
		context.Background(), enqueueRequest(fixture.recipient, "fences", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	current, err := fixture.service.Claim(
		context.Background(), fixture.recipient, "consumer-a", initial.ConsumerEpoch, 0, 1,
	)
	if err != nil {
		t.Fatal(err)
	}
	beforeLane, beforeItem := claimRecoverySnapshot(t, fixture, item.ItemID)
	for _, test := range []struct {
		name     string
		consumer string
		expected uint64
		cursor   int64
		code     application.ErrorCode
	}{
		{"different-consumer", "consumer-b", initial.ConsumerEpoch, 0, application.ErrorCodeConsumerFenced},
		{"future-epoch", "consumer-a", current.ConsumerEpoch + 1, 0, application.ErrorCodeConsumerFenced},
		{"skipped-head", "consumer-a", initial.ConsumerEpoch, 1, application.ErrorCodeItemNotHead},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := fixture.service.Claim(
				context.Background(), fixture.recipient, test.consumer, test.expected, test.cursor, 1,
			); !application.IsCode(err, test.code) {
				t.Fatalf("claim = %v, want %s", err, test.code)
			}
			afterLane, afterItem := claimRecoverySnapshot(t, fixture, item.ItemID)
			if !reflect.DeepEqual(beforeLane, afterLane) || !reflect.DeepEqual(beforeItem, afterItem) {
				t.Fatal("denied claim mutated lane or lease")
			}
		})
	}
	fixture.clock.now = fixture.clock.now.Add(time.Minute + time.Nanosecond)
	takeover, err := fixture.service.Claim(
		context.Background(), fixture.recipient, "consumer-b", current.ConsumerEpoch, 0, 1,
	)
	if err != nil || len(takeover.Items) != 1 || takeover.ConsumerEpoch != current.ConsumerEpoch+1 {
		t.Fatalf("takeover = %+v, %v", takeover, err)
	}
	if _, err := fixture.service.Claim(
		context.Background(), fixture.recipient, "consumer-a", current.ConsumerEpoch, 0, 1,
	); !application.IsCode(err, application.ErrorCodeConsumerFenced) {
		t.Fatalf("superseded consumer metadata recovery = %v", err)
	}
}

func claimRecoverySnapshot(
	t *testing.T, fixture *deliveryFixture, itemID string,
) (infrastructure.DeviceQueueLaneModel, infrastructure.DeviceQueueItemModel) {
	t.Helper()
	var lane infrastructure.DeviceQueueLaneModel
	if err := fixture.db.First(&lane, "recipient_ptid = ? AND recipient_device_id = ?",
		string(fixture.recipient.Actor), string(fixture.recipient.Device),
	).Error; err != nil {
		t.Fatal(err)
	}
	var item infrastructure.DeviceQueueItemModel
	if err := fixture.db.First(&item, "item_id = ?", itemID).Error; err != nil {
		t.Fatal(err)
	}
	return lane, item
}
