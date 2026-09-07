package conversation

import (
	"context"
	"strings"
	"testing"
	"time"

	interactionapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
)

func TestProductionRealtimeNotifyCommittedPublishesTypedDeviceWake(t *testing.T) {
	ctx := context.Background()
	bus := events.NewEventBus()
	defer bus.Close()

	target := valueobject.Endpoint{
		Actor:  "ptid:alice",
		Device: "alice-device",
	}
	targetSubscription, cancelTarget, err := bus.Subscribe(
		ctx,
		string(target.Actor),
		string(target.Device),
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelTarget()
	siblingSubscription, cancelSibling, err := bus.Subscribe(
		ctx,
		string(target.Actor),
		"alice-phone",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelSibling()

	adapter := newProductionRealtimeAdapter(func() events.EventBus {
		return bus
	})
	delivery := ports.CommittedDelivery{
		Recipient: target,
		EventID:   "event-1",
	}
	if err := adapter.NotifyCommitted(
		ctx,
		[]ports.CommittedDelivery{delivery, delivery},
	); err != nil {
		t.Fatal(err)
	}

	event := receiveProductionRealtimeEvent(t, targetSubscription.Events)
	delivered := event.GetEnvelopeDelivered()
	if delivered == nil {
		t.Fatalf("event kind = %T, want EnvelopeDelivered", event.GetKind())
	}
	if delivered.GetInboxItemId() != string(delivery.EventID) ||
		delivered.GetEnvelopeId() != string(delivery.EventID) ||
		delivered.GetRecipientDeviceId() != string(target.Device) ||
		delivered.GetPayloadType() != int32(
			chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_UNSPECIFIED,
		) {
		t.Fatalf("delivery wake = %+v", delivered)
	}

	var wake chatmodel.DeviceInboxWakeHint
	if err := proto.Unmarshal(delivered.GetPayloadBytes(), &wake); err != nil {
		t.Fatalf("decode DeviceInboxWakeHint: %v", err)
	}
	if wake.GetDevice().GetActor().GetPtid() != string(target.Actor) ||
		wake.GetDevice().GetDeviceId() != string(target.Device) ||
		wake.GetLaneHeadSequence() != 0 {
		t.Fatalf("wake hint = %+v", &wake)
	}
	assertNoProductionRealtimeEvent(t, siblingSubscription.Events)

	stats := bus.Stats()
	if stats.BufferedEvents != 1 {
		t.Fatalf("buffered events = %d, want one durable wake", stats.BufferedEvents)
	}
}

func TestProductionRealtimePublishTypingUsesEphemeralActorFanout(t *testing.T) {
	ctx := context.Background()
	bus := events.NewEventBus()
	defer bus.Close()

	first, cancelFirst, err := bus.Subscribe(ctx, "ptid:bob", "bob-device", "")
	if err != nil {
		t.Fatal(err)
	}
	defer cancelFirst()
	second, cancelSecond, err := bus.Subscribe(ctx, "ptid:bob", "bob-phone", "")
	if err != nil {
		t.Fatal(err)
	}
	defer cancelSecond()

	adapter := newProductionRealtimeAdapter(func() events.EventBus {
		return bus
	})
	pulse := interactionapp.TypingPulse{
		ConversationID: "conversation-1",
		Sender: valueobject.Endpoint{
			Actor:  "ptid:alice",
			Device: "alice-device",
		},
		Generation: 1,
		ExpiresAt:  time.Now().UTC().Add(time.Second),
		IsTyping:   true,
	}
	if err := adapter.PublishTyping(ctx, "ptid:bob", pulse); err != nil {
		t.Fatal(err)
	}

	for _, subscription := range []*events.Subscription{first, second} {
		event := receiveProductionRealtimeEvent(t, subscription.Events)
		typing := event.GetTyping()
		if typing == nil {
			t.Fatalf("event kind = %T, want TypingState", event.GetKind())
		}
		if typing.GetSessionUlid() != string(pulse.ConversationID) ||
			typing.GetFromActorPtid() != string(pulse.Sender.Actor) ||
			!typing.GetTyping() {
			t.Fatalf("typing event = %+v", typing)
		}
	}

	stats := bus.Stats()
	if stats.BufferedEvents != 0 {
		t.Fatalf("buffered events = %d, want ephemeral typing", stats.BufferedEvents)
	}
}

func TestProductionRealtimePublishDeliveryAggregateUsesTypedDurableProjection(
	t *testing.T,
) {
	ctx := context.Background()
	bus := events.NewEventBus()
	defer bus.Close()

	target := valueobject.Endpoint{
		Actor:  "ptid:alice",
		Device: "alice-device",
	}
	targetSubscription, cancelTarget, err := bus.Subscribe(
		ctx,
		string(target.Actor),
		string(target.Device),
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelTarget()
	siblingSubscription, cancelSibling, err := bus.Subscribe(
		ctx,
		string(target.Actor),
		"alice-phone",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelSibling()

	adapter := newProductionRealtimeAdapter(func() events.EventBus {
		return bus
	})
	aggregate := interactionapp.DeliveryAggregate{
		ConversationID:      "conversation-1",
		EventID:             "event-1",
		EventSequence:       7,
		RequiredDeviceCount: 2,
		ConsumedDeviceCount: 1,
		Delivered:           true,
	}
	const idempotencyKey = "delivery-receipt-event-1-alice-device"
	if err := adapter.PublishDeliveryAggregate(
		ctx,
		target,
		aggregate,
		idempotencyKey,
	); err != nil {
		t.Fatal(err)
	}

	event := receiveProductionRealtimeEvent(t, targetSubscription.Events)
	delivered := event.GetEnvelopeDelivered()
	if delivered == nil {
		t.Fatalf("event kind = %T, want EnvelopeDelivered", event.GetKind())
	}
	if delivered.GetInboxItemId() != idempotencyKey ||
		delivered.GetEnvelopeId() != string(aggregate.EventID) ||
		delivered.GetConversationId() != string(aggregate.ConversationID) ||
		delivered.GetPayloadType() != int32(
			chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_DEVICE_RECEIPT,
		) ||
		delivered.GetRecipientDeviceId() != string(target.Device) {
		t.Fatalf("delivery aggregate envelope = %+v", delivered)
	}

	var payload chatmodel.MessageDeliveryAggregate
	if err := proto.Unmarshal(delivered.GetPayloadBytes(), &payload); err != nil {
		t.Fatalf("decode MessageDeliveryAggregate: %v", err)
	}
	expected := &chatmodel.MessageDeliveryAggregate{
		ConversationId:      string(aggregate.ConversationID),
		EventId:             string(aggregate.EventID),
		EventSequence:       int64(aggregate.EventSequence),
		RequiredDeviceCount: aggregate.RequiredDeviceCount,
		ConsumedDeviceCount: aggregate.ConsumedDeviceCount,
		RevokedDeviceCount:  aggregate.RevokedDeviceCount,
		Delivered:           aggregate.Delivered,
		FullyDelivered:      aggregate.FullyDelivered,
		Read:                aggregate.Read,
	}
	if !proto.Equal(&payload, expected) {
		t.Fatalf("delivery aggregate = %+v, want %+v", &payload, expected)
	}
	assertNoProductionRealtimeEvent(t, siblingSubscription.Events)

	stats := bus.Stats()
	if stats.BufferedEvents != 1 {
		t.Fatalf("buffered events = %d, want one durable projection", stats.BufferedEvents)
	}
}

func TestProductionRealtimeFailsClosedWithoutEventBus(t *testing.T) {
	adapter := newProductionRealtimeAdapter(func() events.EventBus {
		return nil
	})
	ctx := context.Background()
	endpoint := valueobject.Endpoint{
		Actor:  "ptid:alice",
		Device: "alice-device",
	}
	aggregate := interactionapp.DeliveryAggregate{
		ConversationID:      "conversation-1",
		EventID:             "event-1",
		EventSequence:       1,
		RequiredDeviceCount: 1,
		ConsumedDeviceCount: 1,
		Delivered:           true,
		FullyDelivered:      true,
	}

	tests := []struct {
		name string
		run  func() error
	}{
		{
			name: "delivery wake",
			run: func() error {
				return adapter.NotifyCommitted(ctx, []ports.CommittedDelivery{{
					Recipient: endpoint,
					EventID:   "event-1",
				}})
			},
		},
		{
			name: "typing",
			run: func() error {
				return adapter.PublishTyping(ctx, "ptid:bob", interactionapp.TypingPulse{
					ConversationID: "conversation-1",
					Sender:         endpoint,
					Generation:     1,
					ExpiresAt:      time.Now().UTC().Add(time.Second),
					IsTyping:       true,
				})
			},
		},
		{
			name: "delivery aggregate",
			run: func() error {
				return adapter.PublishDeliveryAggregate(
					ctx,
					endpoint,
					aggregate,
					"delivery-aggregate-1",
				)
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			err := testCase.run()
			if err == nil || !strings.Contains(err.Error(), "event bus is unavailable") {
				t.Fatalf("error = %v, want unavailable EventBus failure", err)
			}
		})
	}
}

func receiveProductionRealtimeEvent(
	t *testing.T,
	events <-chan *realtime.StreamEvent,
) *realtime.StreamEvent {
	t.Helper()

	select {
	case event := <-events:
		if event == nil {
			t.Fatal("received nil realtime event")
		}

		return event
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for realtime event")

		return nil
	}
}

func assertNoProductionRealtimeEvent(
	t *testing.T,
	events <-chan *realtime.StreamEvent,
) {
	t.Helper()

	select {
	case event := <-events:
		t.Fatalf("unexpected realtime event: %+v", event)
	default:
	}
}
