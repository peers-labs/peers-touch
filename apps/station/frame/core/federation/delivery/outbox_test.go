package delivery_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func TestDeliverySchemaUsesExplicitTablesAndConflictIndexes(t *testing.T) {
	fixture := newFrameFixture(t)
	db, _ := newSQLiteRepository(t, fixture.clock)
	migrator := db.Migrator()
	if !migrator.HasTable("federation_delivery_inbox") ||
		!migrator.HasTable("federation_delivery_outbox") {
		t.Fatal("explicit Federation delivery tables are missing")
	}
	for _, index := range []struct {
		model interface{}
		name  string
	}{
		{model: &delivery.InboxRecord{}, name: "uidx_fdi_frame"},
		{model: &delivery.OutboxRecord{}, name: "uidx_fdo_source_idempotency"},
		{model: &delivery.OutboxRecord{}, name: "uidx_fdo_ordered_lane"},
	} {
		if !migrator.HasIndex(index.model, index.name) {
			t.Fatalf("required index %s is missing", index.name)
		}
	}
}

func TestOutboxEnqueueDetectsExactReplayAndIdentityConflicts(t *testing.T) {
	fixture := newFrameFixture(t)
	_, repository := newSQLiteRepository(t, fixture.clock)
	ctx := context.Background()
	frame := fixture.stringFrame(t, "frame-1", "idempotency-1", "first")

	first, err := repository.Enqueue(ctx, frame, fixture.clock.Now())
	if err != nil {
		t.Fatalf("enqueue frame: %v", err)
	}
	if first.Duplicate {
		t.Fatal("first enqueue reported duplicate")
	}
	replay, err := repository.Enqueue(ctx, frame, fixture.clock.Now())
	if err != nil {
		t.Fatalf("enqueue replay: %v", err)
	}
	if !replay.Duplicate {
		t.Fatal("exact replay was not reported as duplicate")
	}

	sameIdempotency := fixture.stringFrame(t, "frame-2", "idempotency-1", "second")
	if _, err := repository.Enqueue(
		ctx,
		sameIdempotency,
		fixture.clock.Now(),
	); !errors.Is(err, delivery.ErrPayloadHashConflict) {
		t.Fatalf("same-idempotency conflict error = %v", err)
	}
	sameFrameID := fixture.stringFrame(t, "frame-1", "idempotency-2", "third")
	if _, err := repository.Enqueue(
		ctx,
		sameFrameID,
		fixture.clock.Now(),
	); !errors.Is(err, delivery.ErrPayloadHashConflict) {
		t.Fatalf("same-frame conflict error = %v", err)
	}
	sameOrderedSlot := fixture.stringFrame(t, "frame-3", "idempotency-3", "fourth")
	sameOrderedSlot.OrderingKey = frame.OrderingKey
	sameOrderedSlot.OrderingSequence = frame.OrderingSequence
	if err := delivery.SignFrame(
		ctx,
		sameOrderedSlot,
		fixture.policy,
		fixture.signer,
	); err != nil {
		t.Fatalf("resign ordered conflict: %v", err)
	}
	if _, err := repository.Enqueue(
		ctx,
		sameOrderedSlot,
		fixture.clock.Now(),
	); !errors.Is(err, delivery.ErrPayloadHashConflict) {
		t.Fatalf("same-ordering-slot conflict error = %v", err)
	}
}

func TestOutboxLeaseReclaimFencesStaleWorker(t *testing.T) {
	fixture := newFrameFixture(t)
	_, repository := newSQLiteRepository(t, fixture.clock)
	ctx := context.Background()
	frame := fixture.stringFrame(t, "frame-1", "idempotency-1", "lease")
	if _, err := repository.Enqueue(ctx, frame, fixture.clock.Now()); err != nil {
		t.Fatalf("enqueue frame: %v", err)
	}

	first, err := repository.Claim(ctx, delivery.ClaimRequest{
		WorkerID:      "worker-1",
		Limit:         1,
		Now:           fixture.clock.Now(),
		LeaseDuration: time.Minute,
	})
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if len(first) != 1 || first[0].Lease.Generation != 1 {
		t.Fatalf("first claim = %+v", first)
	}
	fixture.clock.Advance(time.Minute)
	if err := repository.MarkDelivered(
		ctx,
		first[0].Lease,
		fixture.clock.Now(),
	); !errors.Is(err, delivery.ErrLeaseFenced) {
		t.Fatalf("expired lease error = %v", err)
	}
	second, err := repository.Claim(ctx, delivery.ClaimRequest{
		WorkerID:      "worker-2",
		Limit:         1,
		Now:           fixture.clock.Now(),
		LeaseDuration: time.Minute,
	})
	if err != nil {
		t.Fatalf("reclaim: %v", err)
	}
	if len(second) != 1 || second[0].Lease.Generation != 2 {
		t.Fatalf("second claim = %+v", second)
	}
	if err := repository.MarkDelivered(ctx, first[0].Lease, fixture.clock.Now()); !errors.Is(
		err,
		delivery.ErrLeaseFenced,
	) {
		t.Fatalf("stale generation error = %v", err)
	}
	if err := repository.MarkDelivered(
		ctx,
		second[0].Lease,
		fixture.clock.Now(),
	); err != nil {
		t.Fatalf("current lease delivery: %v", err)
	}
}

func TestOutboxPreservesOrderingAndCrossLaneFairness(t *testing.T) {
	fixture := newFrameFixture(t)
	_, repository := newSQLiteRepository(t, fixture.clock)
	ctx := context.Background()
	frames := []*delivery.Frame{
		fixture.stringFrame(t, "lane-a-2", "lane-a-2", "a2"),
		fixture.stringFrame(t, "lane-a-1", "lane-a-1", "a1"),
		fixture.stringFrame(t, "lane-b-1", "lane-b-1", "b1"),
	}
	frames[0].OrderingKey, frames[0].OrderingSequence = "lane-a", 2
	frames[1].OrderingKey, frames[1].OrderingSequence = "lane-a", 1
	frames[2].OrderingKey, frames[2].OrderingSequence = "lane-b", 1
	for _, frame := range frames {
		if err := delivery.SignFrame(
			ctx,
			frame,
			fixture.policy,
			fixture.signer,
		); err != nil {
			t.Fatalf("resign ordered frame: %v", err)
		}
		if _, err := repository.Enqueue(ctx, frame, fixture.clock.Now()); err != nil {
			t.Fatalf("enqueue ordered frame: %v", err)
		}
	}

	claims, err := repository.Claim(ctx, delivery.ClaimRequest{
		WorkerID:      "worker",
		Limit:         10,
		Now:           fixture.clock.Now(),
		LeaseDuration: time.Minute,
	})
	if err != nil {
		t.Fatalf("claim ordered frames: %v", err)
	}
	if len(claims) != 2 {
		t.Fatalf("initial claims = %+v, want one per lane", claims)
	}
	for _, claim := range claims {
		if claim.Frame.OrderingKey == "lane-a" && claim.Frame.OrderingSequence != 1 {
			t.Fatalf("claimed lane-a sequence %d before predecessor", claim.Frame.OrderingSequence)
		}
		if err := repository.MarkDelivered(
			ctx,
			claim.Lease,
			fixture.clock.Now(),
		); err != nil {
			t.Fatalf("mark ordered frame delivered: %v", err)
		}
	}
	next, err := repository.Claim(ctx, delivery.ClaimRequest{
		WorkerID:      "worker",
		Limit:         10,
		Now:           fixture.clock.Now(),
		LeaseDuration: time.Minute,
	})
	if err != nil {
		t.Fatalf("claim lane successor: %v", err)
	}
	if len(next) != 1 ||
		next[0].Frame.OrderingKey != "lane-a" ||
		next[0].Frame.OrderingSequence != 2 {
		t.Fatalf("successor claim = %+v", next)
	}
}

type failingTransport struct {
	mu    sync.Mutex
	calls int
}

func (t *failingTransport) Deliver(
	context.Context,
	*delivery.Frame,
) (delivery.Result, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.calls++
	return delivery.Result{}, errors.New("transport unavailable")
}

func (t *failingTransport) CallCount() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.calls
}

func TestDispatcherMapsReceiverDispositionsToDurableStates(t *testing.T) {
	tests := []struct {
		name      string
		result    delivery.Result
		wantState delivery.OutboxState
	}{
		{
			name:      "accepted",
			result:    delivery.AcceptedResult(),
			wantState: delivery.OutboxStateDelivered,
		},
		{
			name:      "duplicate",
			result:    delivery.DuplicateResult(),
			wantState: delivery.OutboxStateDelivered,
		},
		{
			name:      "retryable",
			result:    delivery.RetryableResult(delivery.FrameErrorOverloaded),
			wantState: delivery.OutboxStateRetryWait,
		},
		{
			name:      "terminal",
			result:    delivery.TerminalResult(delivery.FrameErrorDomainRejected),
			wantState: delivery.OutboxStateTerminal,
		},
		{
			name:      "hash conflict",
			result:    delivery.PayloadHashConflictResult(),
			wantState: delivery.OutboxStateTerminal,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newFrameFixture(t)
			db, repository := newSQLiteRepository(t, fixture.clock)
			transport := delivery.TransportFunc(func(
				context.Context,
				*delivery.Frame,
			) (delivery.Result, error) {
				return test.result, nil
			})
			dispatcher, err := delivery.NewDispatcher(
				repository,
				transport,
				delivery.DispatcherConfig{
					WorkerID:      "worker",
					BatchSize:     1,
					LeaseDuration: time.Minute,
					IdleDelay:     time.Millisecond,
					RetryBackoff: delivery.RetryBackoff{
						Initial: time.Second,
						Maximum: time.Minute,
					},
				},
				fixture.clock,
			)
			if err != nil {
				t.Fatalf("create dispatcher: %v", err)
			}
			frame := fixture.stringFrame(t, "frame-"+test.name, "idempotency-"+test.name, test.name)
			if _, err := repository.Enqueue(
				context.Background(),
				frame,
				fixture.clock.Now(),
			); err != nil {
				t.Fatalf("enqueue frame: %v", err)
			}
			if _, err := dispatcher.DispatchOnce(context.Background()); err != nil {
				t.Fatalf("dispatch once: %v", err)
			}
			var record delivery.OutboxRecord
			if err := db.First(&record, "frame_id = ?", frame.FrameId).Error; err != nil {
				t.Fatalf("load outbox record: %v", err)
			}
			if record.State != test.wantState {
				t.Fatalf("state = %s, want %s", record.State, test.wantState)
			}
		})
	}
}

func TestDispatcherRetriesWithoutAttemptCapUntilImmutableExpiry(t *testing.T) {
	fixture := newFrameFixture(t)
	db, repository := newSQLiteRepository(t, fixture.clock)
	transport := &failingTransport{}
	dispatcher, err := delivery.NewDispatcher(
		repository,
		transport,
		delivery.DispatcherConfig{
			WorkerID:      "worker",
			BatchSize:     1,
			LeaseDuration: 500 * time.Millisecond,
			IdleDelay:     time.Millisecond,
			RetryBackoff: delivery.RetryBackoff{
				Initial: time.Second,
				Maximum: time.Second,
			},
		},
		fixture.clock,
	)
	if err != nil {
		t.Fatalf("create dispatcher: %v", err)
	}
	frame := fixture.signedFrame(
		t,
		"retry-frame",
		"retry-idempotency",
		delivery.PayloadKindSocialFriendRequestCommand,
		"retry-payload",
		wrapperspb.String("retry"),
	)
	frame.ExpiresAt = timestamppbAt(fixture.clock.Now().Add(10 * time.Second))
	if err := delivery.SignFrame(
		context.Background(),
		frame,
		fixture.policy,
		fixture.signer,
	); err != nil {
		t.Fatalf("resign retry frame: %v", err)
	}
	if _, err := repository.Enqueue(
		context.Background(),
		frame,
		fixture.clock.Now(),
	); err != nil {
		t.Fatalf("enqueue retry frame: %v", err)
	}

	for attempt := 0; attempt < 6; attempt++ {
		report, err := dispatcher.DispatchOnce(context.Background())
		if err != nil {
			t.Fatalf("dispatch attempt %d: %v", attempt+1, err)
		}
		if report.Claimed != 1 || report.Retried != 1 {
			t.Fatalf("attempt %d report = %+v", attempt+1, report)
		}
		fixture.clock.Advance(time.Second)
	}
	var retrying delivery.OutboxRecord
	if err := db.First(&retrying, "frame_id = ?", frame.FrameId).Error; err != nil {
		t.Fatalf("load retrying row: %v", err)
	}
	if retrying.State != delivery.OutboxStateRetryWait ||
		retrying.AttemptCount != 6 ||
		transport.CallCount() != 6 {
		t.Fatalf("retrying row = %+v, calls=%d", retrying, transport.CallCount())
	}

	fixture.clock.Set(frame.ExpiresAt.AsTime())
	if _, err := dispatcher.DispatchOnce(context.Background()); err != nil {
		t.Fatalf("expire dispatch: %v", err)
	}
	var expired delivery.OutboxRecord
	if err := db.First(&expired, "frame_id = ?", frame.FrameId).Error; err != nil {
		t.Fatalf("load expired row: %v", err)
	}
	if expired.State != delivery.OutboxStateExpired || expired.AttemptCount != 6 {
		t.Fatalf("expired row = %+v", expired)
	}
}

func timestamppbAt(value time.Time) *timestamppb.Timestamp {
	return timestamppb.New(value.UTC())
}
