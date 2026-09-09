package delivery_test

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"google.golang.org/protobuf/types/known/wrapperspb"
	"gorm.io/gorm/clause"
)

func TestReceiverAtomicallyDispatchesAndDeduplicates(t *testing.T) {
	fixture := newFrameFixture(t)
	db, repository := newSQLiteRepository(t, fixture.clock)
	if err := db.AutoMigrate(&domainRecord{}); err != nil {
		t.Fatalf("migrate domain test table: %v", err)
	}
	outgoing := fixture.stringFrame(t, "result-frame", "result-idempotency", "result")

	registry := delivery.NewRegistry()
	if err := delivery.RegisterProtoReceiver(
		registry,
		delivery.PayloadKindSocialFriendRequestCommand,
		func() *wrapperspb.StringValue { return &wrapperspb.StringValue{} },
		func(
			ctx context.Context,
			tx delivery.Transaction,
			payload *wrapperspb.StringValue,
			frame *delivery.Frame,
		) (delivery.Result, error) {
			result := tx.DB().WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&domainRecord{
				ID:    frame.PayloadId,
				Value: payload.Value,
			})
			if result.Error != nil {
				return delivery.Result{}, result.Error
			}
			if _, err := tx.Outbox().Enqueue(ctx, outgoing, fixture.clock.Now()); err != nil {
				return delivery.Result{}, err
			}
			return delivery.AcceptedResult(), nil
		},
	); err != nil {
		t.Fatalf("register typed receiver: %v", err)
	}
	receiver, err := delivery.NewReceiver(delivery.ReceiverConfig{
		Policy: fixture.policy,
		Verifier: ed25519Verifier{
			sourceStationPeerID: targetStation,
			keyID:               fixture.verifier.keyID,
			publicKey:           fixture.verifier.publicKey,
		},
		Registry:   registry,
		UnitOfWork: repository,
		Clock:      fixture.clock,
	})
	if err != nil {
		t.Fatalf("create receiver: %v", err)
	}
	local, err := delivery.NewLocalTransport(receiver)
	if err != nil {
		t.Fatalf("create local transport: %v", err)
	}
	frame := fixture.stringFrame(t, "frame-1", "idempotency-1", "friend-request")
	frame.SourceStationPeerId = targetStation
	if err := delivery.SignFrame(
		context.Background(),
		frame,
		fixture.policy,
		fixture.signer,
	); err != nil {
		t.Fatalf("resign same-Station frame: %v", err)
	}

	first, err := local.Deliver(context.Background(), frame)
	if err != nil {
		t.Fatalf("first delivery: %v", err)
	}
	if first != delivery.AcceptedResult() {
		t.Fatalf("first result = %+v", first)
	}
	replay, err := local.Deliver(context.Background(), frame)
	if err != nil {
		t.Fatalf("replay delivery: %v", err)
	}
	if replay != delivery.DuplicateResult() {
		t.Fatalf("replay result = %+v", replay)
	}

	var inboxCount, outboxCount int64
	if err := db.Model(&delivery.InboxRecord{}).Count(&inboxCount).Error; err != nil {
		t.Fatalf("count inbox: %v", err)
	}
	if err := db.Model(&delivery.OutboxRecord{}).Count(&outboxCount).Error; err != nil {
		t.Fatalf("count outbox: %v", err)
	}
	var domainRows []domainRecord
	if err := db.Find(&domainRows).Error; err != nil {
		t.Fatalf("load domain rows: %v", err)
	}
	if inboxCount != 1 ||
		outboxCount != 1 ||
		len(domainRows) != 1 ||
		domainRows[0].Value != "friend-request" {
		t.Fatalf(
			"unexpected persisted state: inbox=%d outbox=%d domain=%+v",
			inboxCount,
			outboxCount,
			domainRows,
		)
	}
}

func TestReceiverRejectsPayloadAndFrameIdentityConflictsBeforeDispatch(t *testing.T) {
	fixture := newFrameFixture(t)
	db, repository := newSQLiteRepository(t, fixture.clock)
	if err := db.AutoMigrate(&domainRecord{}); err != nil {
		t.Fatalf("migrate domain test table: %v", err)
	}

	dispatchCount := 0
	registry := delivery.NewRegistry()
	if err := registry.Register(
		delivery.PayloadKindSocialFriendRequestCommand,
		delivery.ReceiverFunc(func(
			ctx context.Context,
			tx delivery.Transaction,
			frame *delivery.Frame,
		) (delivery.Result, error) {
			dispatchCount++
			if err := tx.DB().WithContext(ctx).Create(&domainRecord{
				ID:    frame.FrameId,
				Value: frame.PayloadId,
			}).Error; err != nil {
				return delivery.Result{}, err
			}
			return delivery.AcceptedResult(), nil
		}),
	); err != nil {
		t.Fatalf("register receiver: %v", err)
	}
	receiver, err := delivery.NewReceiver(delivery.ReceiverConfig{
		Policy:     fixture.policy,
		Verifier:   fixture.verifier,
		Registry:   registry,
		UnitOfWork: repository,
		Clock:      fixture.clock,
	})
	if err != nil {
		t.Fatalf("create receiver: %v", err)
	}

	first := fixture.stringFrame(t, "frame-1", "idempotency-1", "first")
	if result, err := receiver.Receive(context.Background(), first); err != nil ||
		result != delivery.AcceptedResult() {
		t.Fatalf("first delivery = %+v, %v", result, err)
	}
	conflict := fixture.stringFrame(t, "frame-2", "idempotency-1", "different")
	result, err := receiver.Receive(context.Background(), conflict)
	if err != nil {
		t.Fatalf("conflict delivery: %v", err)
	}
	if result != delivery.PayloadHashConflictResult() {
		t.Fatalf("conflict result = %+v", result)
	}
	frameIDConflict := fixture.stringFrame(t, "frame-1", "idempotency-2", "different-frame-id")
	result, err = receiver.Receive(context.Background(), frameIDConflict)
	if err != nil {
		t.Fatalf("frame-id conflict delivery: %v", err)
	}
	if result != delivery.PayloadHashConflictResult() {
		t.Fatalf("frame-id conflict result = %+v", result)
	}
	if dispatchCount != 1 {
		t.Fatalf("dispatch count = %d, want 1", dispatchCount)
	}
}

func TestReceiverRollsBackReceiptAndDomainMutationOnRetryableOrError(t *testing.T) {
	tests := []struct {
		name      string
		result    delivery.Result
		returnErr error
		wantError bool
	}{
		{
			name:   "retryable result",
			result: delivery.RetryableResult(delivery.FrameErrorOverloaded),
		},
		{
			name:      "receiver error",
			returnErr: errors.New("domain storage unavailable"),
			wantError: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newFrameFixture(t)
			db, repository := newSQLiteRepository(t, fixture.clock)
			if err := db.AutoMigrate(&domainRecord{}); err != nil {
				t.Fatalf("migrate domain test table: %v", err)
			}
			outgoing := fixture.stringFrame(
				t,
				"rollback-result-frame",
				"rollback-result-idempotency",
				"rollback-result",
			)
			registry := delivery.NewRegistry()
			if err := registry.Register(
				delivery.PayloadKindSocialFriendRequestCommand,
				delivery.ReceiverFunc(func(
					ctx context.Context,
					tx delivery.Transaction,
					frame *delivery.Frame,
				) (delivery.Result, error) {
					if err := tx.DB().WithContext(ctx).Create(&domainRecord{
						ID:    frame.FrameId,
						Value: frame.PayloadId,
					}).Error; err != nil {
						return delivery.Result{}, err
					}
					if _, err := tx.Outbox().Enqueue(ctx, outgoing, fixture.clock.Now()); err != nil {
						return delivery.Result{}, err
					}
					return test.result, test.returnErr
				}),
			); err != nil {
				t.Fatalf("register receiver: %v", err)
			}
			receiver, err := delivery.NewReceiver(delivery.ReceiverConfig{
				Policy:     fixture.policy,
				Verifier:   fixture.verifier,
				Registry:   registry,
				UnitOfWork: repository,
				Clock:      fixture.clock,
			})
			if err != nil {
				t.Fatalf("create receiver: %v", err)
			}

			result, err := receiver.Receive(
				context.Background(),
				fixture.stringFrame(t, "frame-rollback", "idempotency-rollback", "rollback"),
			)
			if test.wantError && err == nil {
				t.Fatal("receiver error was swallowed")
			}
			if !test.wantError && (err != nil || result != test.result) {
				t.Fatalf("retryable result = %+v, %v", result, err)
			}
			var inboxCount, outboxCount, domainCount int64
			if err := db.Model(&delivery.InboxRecord{}).Count(&inboxCount).Error; err != nil {
				t.Fatalf("count inbox: %v", err)
			}
			if err := db.Model(&delivery.OutboxRecord{}).Count(&outboxCount).Error; err != nil {
				t.Fatalf("count outbox: %v", err)
			}
			if err := db.Model(&domainRecord{}).Count(&domainCount).Error; err != nil {
				t.Fatalf("count domain rows: %v", err)
			}
			if inboxCount != 0 || outboxCount != 0 || domainCount != 0 {
				t.Fatalf(
					"partial transaction persisted: inbox=%d outbox=%d domain=%d",
					inboxCount,
					outboxCount,
					domainCount,
				)
			}
		})
	}
}

func TestReceiverPersistsUnsupportedPayloadAsTerminalReceipt(t *testing.T) {
	fixture := newFrameFixture(t)
	db, repository := newSQLiteRepository(t, fixture.clock)
	receiver, err := delivery.NewReceiver(delivery.ReceiverConfig{
		Policy:     fixture.policy,
		Verifier:   fixture.verifier,
		Registry:   delivery.NewRegistry(),
		UnitOfWork: repository,
		Clock:      fixture.clock,
	})
	if err != nil {
		t.Fatalf("create receiver: %v", err)
	}
	frame := fixture.stringFrame(t, "unsupported-frame", "unsupported-idempotency", "unsupported")

	result, err := receiver.Receive(context.Background(), frame)
	if err != nil {
		t.Fatalf("deliver unsupported frame: %v", err)
	}
	want := delivery.TerminalResult(delivery.FrameErrorUnsupportedPayload)
	if result != want {
		t.Fatalf("unsupported result = %+v, want %+v", result, want)
	}
	replay, err := receiver.Receive(context.Background(), frame)
	if err != nil {
		t.Fatalf("replay unsupported frame: %v", err)
	}
	if replay != want {
		t.Fatalf("unsupported replay = %+v", replay)
	}

	var receipt delivery.InboxRecord
	if err := db.First(&receipt).Error; err != nil {
		t.Fatalf("load receipt: %v", err)
	}
	if receipt.Disposition != delivery.DispositionTerminal ||
		receipt.ErrorCode != delivery.FrameErrorUnsupportedPayload {
		t.Fatalf("terminal receipt = %+v", receipt)
	}
}

func TestRegistryRejectsDuplicateKind(t *testing.T) {
	registry := delivery.NewRegistry()
	receiver := delivery.ReceiverFunc(func(
		context.Context,
		delivery.Transaction,
		*delivery.Frame,
	) (delivery.Result, error) {
		return delivery.AcceptedResult(), nil
	})
	if err := registry.Register(delivery.PayloadKindSocialFriendRequestCommand, receiver); err != nil {
		t.Fatalf("first registration: %v", err)
	}
	if err := registry.Register(
		delivery.PayloadKindSocialFriendRequestCommand,
		receiver,
	); !errors.Is(err, delivery.ErrInvalidArgument) {
		t.Fatalf("duplicate registration error = %v", err)
	}
	if err := registry.Register(delivery.PayloadKindUnspecified, receiver); !errors.Is(
		err,
		delivery.ErrInvalidArgument,
	) {
		t.Fatalf("unspecified registration error = %v", err)
	}
	if err := registry.Register(delivery.PayloadKind(999), receiver); !errors.Is(
		err,
		delivery.ErrInvalidArgument,
	) {
		t.Fatalf("unknown registration error = %v", err)
	}
}

func TestLocalTransportRejectsCrossStationFrame(t *testing.T) {
	transport, err := delivery.NewLocalTransport(delivery.FrameReceiver(
		deliveryReceiverFunc(func(
			context.Context,
			*delivery.Frame,
		) (delivery.Result, error) {
			t.Fatal("cross-Station frame reached local receiver")
			return delivery.Result{}, nil
		}),
	))
	if err != nil {
		t.Fatalf("create local transport: %v", err)
	}
	result, err := transport.Deliver(context.Background(), &delivery.Frame{
		SourceStationPeerId: sourceStation,
		TargetStationPeerId: targetStation,
	})
	if err != nil {
		t.Fatalf("deliver cross-Station frame: %v", err)
	}
	if result != delivery.TerminalResult(delivery.FrameErrorWrongTarget) {
		t.Fatalf("cross-Station local result = %+v", result)
	}
}

type deliveryReceiverFunc func(context.Context, *delivery.Frame) (delivery.Result, error)

func (f deliveryReceiverFunc) Receive(
	ctx context.Context,
	frame *delivery.Frame,
) (delivery.Result, error) {
	return f(ctx, frame)
}
