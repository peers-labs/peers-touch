package interaction_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

var interactionTestTime = time.Date(2026, time.September, 6, 16, 0, 0, 0, time.UTC)

type testClock struct {
	mu  sync.RWMutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return c.now
}

func (c *testClock) Advance(delta time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(delta)
}

type testConversationReader struct {
	snapshot aggregate.Snapshot
}

func (r testConversationReader) Get(
	_ context.Context,
	_ valueobject.ConversationID,
	actor valueobject.PTID,
) (query.ConversationView, error) {
	for _, member := range r.snapshot.Members {
		if member.Actor == actor && member.Active() {
			return query.ConversationView{
				Conversation: r.snapshot,
				Source:       query.SourceAuthority,
			}, nil
		}
	}

	return query.ConversationView{}, conversationdomain.NewError(
		conversationdomain.ErrorCodeUnauthorized,
		"test.conversation_reader",
		"actor",
		"is not an active member",
	)
}

type testDeviceDirectory struct {
	active map[valueobject.Endpoint]bool
	routes map[valueobject.PTID][]interaction.EndpointRoute
}

func (d *testDeviceDirectory) IsActive(
	_ context.Context,
	endpoint valueobject.Endpoint,
) (bool, error) {
	return d.active[endpoint], nil
}

func (d *testDeviceDirectory) ListActiveEndpoints(
	_ context.Context,
	actors []valueobject.PTID,
) ([]interaction.EndpointRoute, error) {
	var routes []interaction.EndpointRoute
	for _, actor := range actors {
		routes = append(routes, d.routes[actor]...)
	}

	return routes, nil
}

type testReadCursorAdvancer struct {
	requests []interaction.ReadCursorRequest
}

func (a *testReadCursorAdvancer) AdvanceReadCursor(
	_ context.Context,
	conversationID valueobject.ConversationID,
	reader valueobject.Endpoint,
	sequence valueobject.Sequence,
) (command.ReadCursorResult, error) {
	a.requests = append(a.requests, interaction.ReadCursorRequest{
		ConversationID: conversationID,
		Reader:         reader,
		Sequence:       sequence,
	})

	return command.ReadCursorResult{
		Cursor: repository.ReadCursor{
			ConversationID: conversationID,
			Actor:          reader.Actor,
			Sequence:       sequence,
			UpdatedAt:      interactionTestTime,
		},
	}, nil
}

type testTypingPublisher struct {
	events []publishedTyping
}

type publishedTyping struct {
	recipient valueobject.PTID
	pulse     interaction.TypingPulse
}

func (p *testTypingPublisher) PublishTyping(
	_ context.Context,
	recipient valueobject.PTID,
	pulse interaction.TypingPulse,
) error {
	p.events = append(p.events, publishedTyping{recipient: recipient, pulse: pulse})

	return nil
}

type testReceiptRecorder struct {
	receipt *interaction.DeliveryReceipt
}

func (r *testReceiptRecorder) Record(
	_ context.Context,
	receipt interaction.DeliveryReceipt,
) (interaction.DeliveryRecordResult, error) {
	if r.receipt != nil {
		if *r.receipt != receipt {
			return interaction.DeliveryRecordResult{}, interaction.NewError(
				interaction.ErrorCodeIdempotencyConflict,
				"test.receipt_recorder",
				"receipt_id",
				"already identifies different receipt bytes",
			)
		}

		return deliveryRecordResult(true), nil
	}
	cloned := receipt
	r.receipt = &cloned

	return deliveryRecordResult(false), nil
}

func deliveryRecordResult(replay bool) interaction.DeliveryRecordResult {
	return interaction.DeliveryRecordResult{
		Aggregate: interaction.DeliveryAggregate{
			ConversationID:      "conversation-1",
			EventID:             "event-3",
			EventSequence:       3,
			RequiredDeviceCount: 1,
			ConsumedDeviceCount: 1,
			Delivered:           true,
			FullyDelivered:      true,
		},
		Originator: "ptid:alice",
		Replay:     replay,
	}
}

type testDeliveryPublisher struct {
	byKey map[string]valueobject.Endpoint
}

func (p *testDeliveryPublisher) PublishDeliveryAggregate(
	_ context.Context,
	recipient valueobject.Endpoint,
	_ interaction.DeliveryAggregate,
	idempotencyKey string,
) error {
	if existing, ok := p.byKey[idempotencyKey]; ok && existing != recipient {
		return errors.New("test delivery publisher: idempotency collision")
	}
	p.byKey[idempotencyKey] = recipient

	return nil
}

func TestServiceTypingIsMembershipBoundedEphemeralAndIdempotent(t *testing.T) {
	service, clock, devices, typing, _, _ := newInteractionFixture(t)
	bob := valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"}
	first := interaction.TypingPulse{
		ConversationID: "conversation-1",
		Sender:         bob,
		Generation:     1,
		ExpiresAt:      interactionTestTime.Add(6 * time.Second),
		IsTyping:       true,
	}
	result, err := service.SubmitTyping(context.Background(), first)
	if err != nil || !result.Accepted {
		t.Fatalf("first typing result=%+v err=%v", result, err)
	}
	if len(typing.events) != 1 ||
		typing.events[0].recipient != "ptid:alice" ||
		typing.events[0].pulse != first {
		t.Fatalf("typing events = %+v", typing.events)
	}
	replay, err := service.SubmitTyping(context.Background(), first)
	if err != nil || replay.Accepted || len(typing.events) != 1 {
		t.Fatalf("typing replay=%+v events=%d err=%v", replay, len(typing.events), err)
	}
	throttled := first
	throttled.Generation = 2
	throttled.ExpiresAt = first.ExpiresAt.Add(time.Second)
	result, err = service.SubmitTyping(context.Background(), throttled)
	if err != nil || result.Accepted || len(typing.events) != 1 {
		t.Fatalf("throttled result=%+v events=%d err=%v", result, len(typing.events), err)
	}
	stop := throttled
	stop.Generation = 3
	stop.IsTyping = false
	result, err = service.SubmitTyping(context.Background(), stop)
	if err != nil || !result.Accepted || len(typing.events) != 2 {
		t.Fatalf("stop result=%+v events=%d err=%v", result, len(typing.events), err)
	}
	if _, err := service.SubmitTyping(
		context.Background(),
		throttled,
	); !interaction.IsCode(err, interaction.ErrorCodeStalePulse) {
		t.Fatalf("stale pulse error = %v", err)
	}

	clock.Advance(10 * time.Second)
	devices.active[bob] = false
	restarted := first
	restarted.Generation = 1
	restarted.ExpiresAt = clock.Now().Add(6 * time.Second)
	if _, err := service.SubmitTyping(
		context.Background(),
		restarted,
	); !interaction.IsCode(err, interaction.ErrorCodeUnauthorized) {
		t.Fatalf("inactive endpoint error = %v", err)
	}
}

func TestServiceDelegatesReadCursorToCAW2Port(t *testing.T) {
	service, _, _, _, readCursors, _ := newInteractionFixture(t)
	request := interaction.ReadCursorRequest{
		ConversationID: "conversation-1",
		Reader:         valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
		Sequence:       3,
	}
	result, err := service.SubmitReadCursor(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(readCursors.requests) != 1 ||
		readCursors.requests[0] != request ||
		result.Result.Cursor.Sequence != request.Sequence {
		t.Fatalf("read cursor calls=%+v result=%+v", readCursors.requests, result)
	}
}

func TestServiceDeliveryReceiptValidatesAndPublishesIdempotently(t *testing.T) {
	service, _, devices, _, _, delivery := newInteractionFixture(t)
	receipt := interaction.DeliveryReceipt{
		ReceiptID:      "device-consumed:item-3",
		ConversationID: "conversation-1",
		EventID:        "event-3",
		Consumer:       valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
		EventSequence:  3,
		LaneSequence:   9,
		PayloadHash:    valueobject.HashBytes([]byte("opaque-payload")),
		ConsumedAt:     interactionTestTime,
	}
	for expectedReplay := false; ; expectedReplay = true {
		result, err := service.SubmitDeliveryReceipt(context.Background(), receipt)
		if err != nil {
			t.Fatal(err)
		}
		if result.Replay != expectedReplay ||
			!result.Aggregate.Delivered ||
			!result.Aggregate.FullyDelivered {
			t.Fatalf("receipt result = %+v, expected replay=%v", result, expectedReplay)
		}
		if expectedReplay {
			break
		}
	}
	if len(delivery.byKey) != 2 {
		t.Fatalf("delivery fan-out keys = %v", delivery.byKey)
	}
	for _, route := range devices.routes["ptid:alice"] {
		found := false
		for _, endpoint := range delivery.byKey {
			found = found || endpoint == route.Endpoint
		}
		if !found {
			t.Fatalf("originator endpoint %v did not receive aggregate", route.Endpoint)
		}
	}

	tampered := receipt
	tampered.PayloadHash = valueobject.HashBytes([]byte("tampered"))
	if _, err := service.SubmitDeliveryReceipt(
		context.Background(),
		tampered,
	); !interaction.IsCode(err, interaction.ErrorCodeIdempotencyConflict) {
		t.Fatalf("tampered exact-replay error = %v", err)
	}

	future := receipt
	future.ReceiptID = "device-consumed:item-future"
	future.ConsumedAt = interactionTestTime.Add(2 * time.Minute)
	if _, err := service.SubmitDeliveryReceipt(
		context.Background(),
		future,
	); !interaction.IsCode(err, interaction.ErrorCodeInvalidArgument) {
		t.Fatalf("future receipt error = %v", err)
	}
}

func newInteractionFixture(
	t *testing.T,
) (
	*interaction.Service,
	*testClock,
	*testDeviceDirectory,
	*testTypingPublisher,
	*testReadCursorAdvancer,
	*testDeliveryPublisher,
) {
	t.Helper()
	aliceOne := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	aliceTwo := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-2"}
	bob := valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"}
	reader := testConversationReader{
		snapshot: interactionConversationSnapshot(aliceOne, aliceTwo, bob),
	}
	devices := &testDeviceDirectory{
		active: map[valueobject.Endpoint]bool{
			aliceOne: true,
			aliceTwo: true,
			bob:      true,
		},
		routes: map[valueobject.PTID][]interaction.EndpointRoute{
			"ptid:alice": {
				{Endpoint: aliceOne, HomeStation: "station:local"},
				{Endpoint: aliceTwo, HomeStation: "station:local"},
			},
		},
	}
	readCursors := &testReadCursorAdvancer{}
	receipts := &testReceiptRecorder{}
	typing := &testTypingPublisher{}
	delivery := &testDeliveryPublisher{byKey: make(map[string]valueobject.Endpoint)}
	ledger, err := interaction.NewMemoryTypingPulseLedger(100)
	if err != nil {
		t.Fatal(err)
	}
	clock := &testClock{now: interactionTestTime}
	service, err := interaction.NewService(
		reader,
		devices,
		readCursors,
		receipts,
		typing,
		delivery,
		ledger,
		clock,
		interaction.Policy{
			MinimumPulseInterval:   3 * time.Second,
			MaximumTypingTTL:       10 * time.Second,
			MaximumFutureClockSkew: time.Minute,
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	return service, clock, devices, typing, readCursors, delivery
}

func interactionConversationSnapshot(
	aliceOne valueobject.Endpoint,
	aliceTwo valueobject.Endpoint,
	bob valueobject.Endpoint,
) aggregate.Snapshot {
	eventHash := sha256.Sum256([]byte("event-3"))

	return aggregate.Snapshot{
		ID:               "conversation-1",
		Kind:             valueobject.ConversationKindGroup,
		Status:           valueobject.ConversationStatusActive,
		FederationID:     "federation-1",
		AuthorityStation: "station:local",
		AuthorityEpoch:   1,
		Owner:            aliceOne.Actor,
		Head: valueobject.AuthorityHead{
			Sequence:        3,
			EventHash:       eventHash,
			MembershipEpoch: 1,
			MLSEpoch:        1,
		},
		Members: []entity.Member{
			{
				Actor:       aliceOne.Actor,
				Role:        valueobject.MemberRoleOwner,
				Status:      valueobject.MemberStatusActive,
				HomeStation: "station:local",
				JoinedAt:    1,
			},
			{
				Actor:       bob.Actor,
				Role:        valueobject.MemberRoleMember,
				Status:      valueobject.MemberStatusActive,
				HomeStation: "station:local",
				JoinedAt:    1,
			},
		},
		Devices: []entity.MemberDevice{
			{Endpoint: aliceOne, HomeStation: "station:local", Active: true, JoinedAt: 1},
			{Endpoint: aliceTwo, HomeStation: "station:local", Active: true, JoinedAt: 1},
			{Endpoint: bob, HomeStation: "station:local", Active: true, JoinedAt: 1},
		},
		CreatedAt: interactionTestTime.Add(-time.Hour),
		UpdatedAt: interactionTestTime,
	}
}
