package delivery_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	application "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	infrastructure "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type testClock struct {
	now time.Time
}

func (c *testClock) Now() time.Time {
	return c.now
}

type activeDeviceDirectory struct{}

func (activeDeviceDirectory) IsActive(
	_ context.Context,
	_ valueobject.Endpoint,
) (bool, error) {
	return true, nil
}

type deliveryFixture struct {
	db         *gorm.DB
	repository *infrastructure.Repository
	service    *application.Service
	clock      *testClock
	recipient  valueobject.Endpoint
}

func newDeliveryFixture(
	t *testing.T,
	limits application.QueueLimits,
	policy application.Policy,
) *deliveryFixture {
	t.Helper()

	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	repository, err := infrastructure.NewRepository(db, limits)
	if err != nil {
		t.Fatalf("new repository: %v", err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatalf("migrate repository: %v", err)
	}
	if err := db.AutoMigrate(&actoridentitypersistence.ActorDeviceModel{}); err != nil {
		t.Fatalf("migrate actor device authorization table: %v", err)
	}
	clock := &testClock{now: time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)}
	recipient := valueobject.Endpoint{
		Actor:  "ptid:bob",
		Device: "bob-device-1",
	}
	if err := db.Create(&actoridentitypersistence.ActorDeviceModel{
		PTID:               string(recipient.Actor),
		ActorAccount:       "bob@example.test",
		ActorKind:          1,
		DeviceID:           string(recipient.Device),
		Label:              "Bob Device",
		HomeStationPeerID:  "station-local",
		SigningKeyID:       "bob-signing-key",
		PublicKey:          make([]byte, 32),
		ProfileVersion:     1,
		VerificationSource: 1,
		CreatedAt:          clock.now,
	}).Error; err != nil {
		t.Fatalf("seed active actor device: %v", err)
	}
	service, err := application.NewService(
		repository,
		activeDeviceDirectory{},
		policy,
		clock,
	)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	return &deliveryFixture{
		db:         db,
		repository: repository,
		service:    service,
		clock:      clock,
		recipient:  recipient,
	}
}

func standardLimits() application.QueueLimits {
	return application.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1024 * 1024,
	}
}

func standardPolicy() application.Policy {
	return application.Policy{
		LeaseDuration:  time.Minute,
		MaxBatchSize:   10,
		MaxAttempts:    2,
		BaseRetryDelay: time.Minute,
		MaxRetryDelay:  time.Hour,
	}
}

func enqueueRequest(
	recipient valueobject.Endpoint,
	seed string,
	payload string,
) application.EnqueueRequest {
	payloadBytes := []byte(payload)

	return application.EnqueueRequest{
		ItemID:         digest(seed + ":item"),
		Recipient:      recipient,
		EventID:        valueobject.EventID(digest(seed + ":event")),
		EventSequence:  1,
		ConversationID: "conversation-1",
		IdempotencyKey: digest(seed + ":idempotency"),
		PayloadType:    application.PayloadTypeConversationEvent,
		OpaquePayload:  payloadBytes,
		PayloadHash:    valueobject.HashBytes(payloadBytes),
		CreatedAt:      time.Date(2026, time.September, 6, 11, 0, 0, 0, time.UTC),
	}
}

func digest(value string) string {
	hash := sha256.Sum256([]byte(value))

	return hex.EncodeToString(hash[:])
}

func TestWriterUsesCanonicalTablesAndPreservesIdempotency(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	writer, err := infrastructure.NewWriter(fixture.repository)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("opaque-conversation-event")
	intent := ports.DeviceInboxIntent{
		IntentID:       digest("intent-1"),
		ConversationID: "conversation-1",
		EventID:        valueobject.EventID(digest("event-1")),
		EventSequence:  1,
		Recipient:      fixture.recipient,
		IdempotencyKey: digest("event-1:bob-device-1"),
		PayloadKind:    ports.DeviceInboxPayloadConversationEvent,
		OpaquePayload:  payload,
		PayloadHash:    valueobject.HashBytes(payload),
		Commitment:     valueobject.HashBytes([]byte("delivery-commitment")),
		CreatedAt:      fixture.clock.now,
	}

	if err := writer.Enqueue(context.Background(), intent); err != nil {
		t.Fatal(err)
	}
	if err := writer.Enqueue(context.Background(), intent); err != nil {
		t.Fatalf("exact enqueue replay: %v", err)
	}

	var lanes int64
	if err := fixture.db.Model(&infrastructure.DeviceQueueLaneModel{}).Count(&lanes).Error; err != nil {
		t.Fatal(err)
	}
	var items int64
	if err := fixture.db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&items).Error; err != nil {
		t.Fatal(err)
	}
	stats, err := fixture.repository.Stats(context.Background(), fixture.recipient)
	if err != nil {
		t.Fatal(err)
	}
	if lanes != 1 || items != 1 || stats.NextSequence != 1 || stats.Pending != 1 {
		t.Fatalf(
			"canonical rows lanes=%d items=%d stats=%+v, want one queued item",
			lanes,
			items,
			stats,
		)
	}

	missingCommitment := intent
	missingCommitment.IntentID = digest("intent-without-commitment")
	missingCommitment.IdempotencyKey = digest("idempotency-without-commitment")
	missingCommitment.Commitment = valueobject.Hash{}
	if err := writer.Enqueue(
		context.Background(),
		missingCommitment,
	); !application.IsCode(err, application.ErrorCodeInvalidArgument) {
		t.Fatalf("missing commitment error = %v", err)
	}

	conflicting := intent
	conflicting.OpaquePayload = []byte("different-payload")
	conflicting.PayloadHash = valueobject.HashBytes(conflicting.OpaquePayload)
	if err := writer.Enqueue(
		context.Background(),
		conflicting,
	); !application.IsCode(err, application.ErrorCodeIdempotencyConflict) {
		t.Fatalf("idempotency conflict error = %v", err)
	}
}

func TestWriterParticipatesInTheConversationTransaction(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	rollback := errors.New("force outer transaction rollback")

	err := fixture.db.Transaction(func(tx *gorm.DB) error {
		transactionalRepository, err := infrastructure.NewRepository(tx, standardLimits())
		if err != nil {
			return err
		}
		writer, err := infrastructure.NewWriter(transactionalRepository)
		if err != nil {
			return err
		}
		payload := []byte("transactional-payload")
		err = writer.Enqueue(context.Background(), ports.DeviceInboxIntent{
			IntentID:       digest("transactional-item"),
			ConversationID: "conversation-1",
			EventID:        valueobject.EventID(digest("transactional-event")),
			EventSequence:  1,
			Recipient:      fixture.recipient,
			IdempotencyKey: digest("transactional-idempotency"),
			PayloadKind:    ports.DeviceInboxPayloadConversationEvent,
			OpaquePayload:  payload,
			PayloadHash:    valueobject.HashBytes(payload),
			Commitment:     valueobject.HashBytes([]byte("transactional-commitment")),
			CreatedAt:      fixture.clock.now,
		})
		if err != nil {
			return err
		}

		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("outer transaction error = %v", err)
	}

	var lanes int64
	if err := fixture.db.Model(&infrastructure.DeviceQueueLaneModel{}).Count(&lanes).Error; err != nil {
		t.Fatal(err)
	}
	var items int64
	if err := fixture.db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&items).Error; err != nil {
		t.Fatal(err)
	}
	if lanes != 0 || items != 0 {
		t.Fatalf("outer rollback retained lanes=%d items=%d", lanes, items)
	}
}

func TestConcurrentEnqueueAllocatesOneMonotonicLane(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	const itemCount = 24

	var waitGroup sync.WaitGroup
	results := make(chan application.Item, itemCount)
	errs := make(chan error, itemCount)
	for index := 0; index < itemCount; index++ {
		waitGroup.Add(1)
		go func(itemIndex int) {
			defer waitGroup.Done()

			item, err := fixture.repository.Enqueue(
				context.Background(),
				enqueueRequest(
					fixture.recipient,
					fmt.Sprintf("concurrent-%d", itemIndex),
					fmt.Sprintf("ciphertext-%d", itemIndex),
				),
			)
			if err != nil {
				errs <- err

				return
			}
			results <- item
		}(index)
	}
	waitGroup.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent enqueue: %v", err)
	}

	sequences := make([]int, 0, itemCount)
	for item := range results {
		sequences = append(sequences, int(item.LaneSequence))
	}
	sort.Ints(sequences)
	if len(sequences) != itemCount {
		t.Fatalf("enqueued items = %d, want %d", len(sequences), itemCount)
	}
	for index, sequence := range sequences {
		if sequence != index+1 {
			t.Fatalf("sequence[%d] = %d, want %d", index, sequence, index+1)
		}
	}
}

func TestClaimAndAcknowledgeEnforceExactHeadAndPayloadHash(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	first, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "first", "ciphertext-1"),
	)
	if err != nil {
		t.Fatal(err)
	}
	second, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "second", "ciphertext-2"),
	)
	if err != nil {
		t.Fatal(err)
	}

	claim, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		0,
		0,
		2,
	)
	if err != nil {
		t.Fatal(err)
	}
	if claim.ConsumerEpoch != 1 ||
		claim.LaneHead != 2 ||
		claim.AckedThrough != 0 ||
		len(claim.Items) != 2 {
		t.Fatalf("claim = %+v", claim)
	}

	if _, err := fixture.service.Acknowledge(context.Background(), application.AcknowledgeRequest{
		Recipient:     fixture.recipient,
		ItemID:        second.ItemID,
		LaneSequence:  second.LaneSequence,
		ConsumerEpoch: claim.ConsumerEpoch,
		PayloadHash:   second.PayloadHash,
	}); !application.IsCode(err, application.ErrorCodeItemNotHead) {
		t.Fatalf("out-of-order acknowledge error = %v", err)
	}
	if _, err := fixture.service.Acknowledge(context.Background(), application.AcknowledgeRequest{
		Recipient:     fixture.recipient,
		ItemID:        first.ItemID,
		LaneSequence:  first.LaneSequence,
		ConsumerEpoch: claim.ConsumerEpoch,
		PayloadHash:   valueobject.HashBytes([]byte("wrong")),
	}); !application.IsCode(err, application.ErrorCodePayloadHashMismatch) {
		t.Fatalf("payload mismatch error = %v", err)
	}

	ackedThrough, err := fixture.service.Acknowledge(
		context.Background(),
		application.AcknowledgeRequest{
			Recipient:     fixture.recipient,
			ItemID:        first.ItemID,
			LaneSequence:  first.LaneSequence,
			ConsumerEpoch: claim.ConsumerEpoch,
			PayloadHash:   first.PayloadHash,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if ackedThrough != 1 {
		t.Fatalf("acked through = %d, want 1", ackedThrough)
	}
	replayed, err := fixture.service.Acknowledge(
		context.Background(),
		application.AcknowledgeRequest{
			Recipient:     fixture.recipient,
			ItemID:        first.ItemID,
			LaneSequence:  first.LaneSequence,
			ConsumerEpoch: claim.ConsumerEpoch,
			PayloadHash:   first.PayloadHash,
		},
	)
	if err != nil {
		t.Fatalf("idempotent acknowledge replay: %v", err)
	}
	if replayed != 1 {
		t.Fatalf("replayed acked through = %d, want 1", replayed)
	}
}

func TestConsumerFencingLeaseExpiryAndRepositoryRestart(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	item, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "restart", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	first, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-before-restart",
		0,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}

	restartedRepository, err := infrastructure.NewRepository(fixture.db, standardLimits())
	if err != nil {
		t.Fatal(err)
	}
	restartedService, err := application.NewService(
		restartedRepository,
		activeDeviceDirectory{},
		standardPolicy(),
		fixture.clock,
	)
	if err != nil {
		t.Fatal(err)
	}
	takeover, err := restartedService.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-after-restart",
		first.ConsumerEpoch,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if takeover.ConsumerEpoch != first.ConsumerEpoch || len(takeover.Items) != 0 {
		t.Fatalf("early takeover = %+v", takeover)
	}

	fixture.clock.now = fixture.clock.now.Add(time.Minute + time.Nanosecond)
	recovered, err := restartedService.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-after-restart",
		takeover.ConsumerEpoch,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.ConsumerEpoch != takeover.ConsumerEpoch+1 ||
		len(recovered.Items) != 1 ||
		recovered.Items[0].AttemptCount != 2 {
		t.Fatalf("recovered claim = %+v", recovered)
	}
	if _, err := fixture.service.Acknowledge(context.Background(), application.AcknowledgeRequest{
		Recipient:     fixture.recipient,
		ItemID:        item.ItemID,
		LaneSequence:  item.LaneSequence,
		ConsumerEpoch: first.ConsumerEpoch,
		PayloadHash:   item.PayloadHash,
	}); !application.IsCode(err, application.ErrorCodeConsumerFenced) {
		t.Fatalf("stale consumer acknowledge error = %v", err)
	}

	fixture.clock.now = fixture.clock.now.Add(time.Minute + time.Nanosecond)
	if _, err := restartedService.Acknowledge(context.Background(), application.AcknowledgeRequest{
		Recipient:     fixture.recipient,
		ItemID:        item.ItemID,
		LaneSequence:  item.LaneSequence,
		ConsumerEpoch: recovered.ConsumerEpoch,
		PayloadHash:   item.PayloadHash,
	}); !application.IsCode(err, application.ErrorCodeLeaseExpired) {
		t.Fatalf("expired lease acknowledge error = %v", err)
	}
}

func TestEmptyClaimInitializesEpochWithoutTransferringLiveAttempt(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	empty, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		0,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if empty.ConsumerEpoch != 1 || len(empty.Items) != 0 {
		t.Fatalf("initial empty claim = %+v", empty)
	}

	item, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "live-attempt", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		empty.ConsumerEpoch,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if claimed.ConsumerEpoch != empty.ConsumerEpoch+1 || len(claimed.Items) != 1 {
		t.Fatalf("claimed attempt = %+v", claimed)
	}

	waiting, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-b",
		claimed.ConsumerEpoch,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if waiting.ConsumerEpoch != claimed.ConsumerEpoch || len(waiting.Items) != 0 {
		t.Fatalf("waiting consumer changed live attempt = %+v", waiting)
	}
	if _, err := fixture.service.Acknowledge(
		context.Background(),
		application.AcknowledgeRequest{
			Recipient:     fixture.recipient,
			ItemID:        item.ItemID,
			LaneSequence:  item.LaneSequence,
			ConsumerEpoch: claimed.ConsumerEpoch,
			PayloadHash:   item.PayloadHash,
		},
	); err != nil {
		t.Fatalf("live attempt was fenced by empty competing claim: %v", err)
	}
}

func TestExpiredSameConsumerReclaimFencesDelayedReject(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	item, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "same-consumer-reclaim", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	first, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		0,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}

	fixture.clock.now = fixture.clock.now.Add(time.Minute + time.Nanosecond)
	reclaimed, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		first.ConsumerEpoch,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if reclaimed.ConsumerEpoch != first.ConsumerEpoch+1 ||
		len(reclaimed.Items) != 1 ||
		reclaimed.Items[0].AttemptCount != 2 {
		t.Fatalf("same-consumer reclaim = %+v", reclaimed)
	}

	if _, err := fixture.service.Reject(
		context.Background(),
		application.RejectRequest{
			Recipient:     fixture.recipient,
			ItemID:        item.ItemID,
			LaneSequence:  item.LaneSequence,
			ConsumerEpoch: first.ConsumerEpoch,
			Code:          application.RejectCodeRetryLater,
		},
	); !application.IsCode(err, application.ErrorCodeConsumerFenced) {
		t.Fatalf("delayed reject error = %v", err)
	}

	var persisted infrastructure.DeviceQueueItemModel
	if err := fixture.db.First(&persisted, "item_id = ?", item.ItemID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.State != 2 ||
		persisted.LeaseConsumerEpoch != reclaimed.ConsumerEpoch ||
		persisted.LastErrorCode != "" {
		t.Fatalf("delayed reject mutated reclaimed attempt: %+v", persisted)
	}
	if _, err := fixture.service.Acknowledge(
		context.Background(),
		application.AcknowledgeRequest{
			Recipient:     fixture.recipient,
			ItemID:        item.ItemID,
			LaneSequence:  item.LaneSequence,
			ConsumerEpoch: reclaimed.ConsumerEpoch,
			PayloadHash:   item.PayloadHash,
		},
	); err != nil {
		t.Fatalf("reclaimed attempt acknowledge: %v", err)
	}
}

func TestRetryDeadLetterAndHeadBlocking(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	first, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "retry-first", "ciphertext-1"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "retry-second", "ciphertext-2"),
	); err != nil {
		t.Fatal(err)
	}
	claim, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		0,
		0,
		2,
	)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := fixture.service.Reject(context.Background(), application.RejectRequest{
		Recipient:     fixture.recipient,
		ItemID:        first.ItemID,
		LaneSequence:  first.LaneSequence,
		ConsumerEpoch: claim.ConsumerEpoch,
		Code:          application.RejectCodeCryptoStateUnavailable,
	})
	if err != nil {
		t.Fatal(err)
	}
	if retry.State != application.ItemStateRetryWait ||
		retry.NextAttemptAt == nil ||
		!retry.NextAttemptAt.Equal(fixture.clock.now.Add(time.Minute)) {
		t.Fatalf("retry result = %+v", retry)
	}
	replayedRetry, err := fixture.service.Reject(
		context.Background(),
		application.RejectRequest{
			Recipient:     fixture.recipient,
			ItemID:        first.ItemID,
			LaneSequence:  first.LaneSequence,
			ConsumerEpoch: claim.ConsumerEpoch,
			Code:          application.RejectCodeCryptoStateUnavailable,
		},
	)
	if err != nil {
		t.Fatalf("replay retry rejection: %v", err)
	}
	if replayedRetry.State != retry.State ||
		replayedRetry.NextAttemptAt == nil ||
		!replayedRetry.NextAttemptAt.Equal(*retry.NextAttemptAt) {
		t.Fatalf("retry replay changed persisted outcome: %+v", replayedRetry)
	}
	if _, err := fixture.service.Reject(
		context.Background(),
		application.RejectRequest{
			Recipient:     fixture.recipient,
			ItemID:        first.ItemID,
			LaneSequence:  first.LaneSequence,
			ConsumerEpoch: claim.ConsumerEpoch,
			Code:          application.RejectCodeRetryLater,
		},
	); !application.IsCode(err, application.ErrorCodeIdempotencyConflict) {
		t.Fatalf("conflicting retry replay error = %v", err)
	}

	early, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		claim.ConsumerEpoch,
		0,
		2,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(early.Items) != 0 {
		t.Fatalf("retry wait allowed later lane item: %+v", early.Items)
	}

	fixture.clock.now = fixture.clock.now.Add(time.Minute)
	secondAttempt, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		claim.ConsumerEpoch,
		0,
		2,
	)
	if err != nil {
		t.Fatal(err)
	}
	if secondAttempt.ConsumerEpoch != claim.ConsumerEpoch+1 ||
		len(secondAttempt.Items) != 2 ||
		secondAttempt.Items[0].AttemptCount != 2 {
		t.Fatalf("second attempt claim = %+v", secondAttempt)
	}
	if _, err := fixture.service.Reject(
		context.Background(),
		application.RejectRequest{
			Recipient:     fixture.recipient,
			ItemID:        first.ItemID,
			LaneSequence:  first.LaneSequence,
			ConsumerEpoch: claim.ConsumerEpoch,
			Code:          application.RejectCodeCryptoStateUnavailable,
		},
	); !application.IsCode(err, application.ErrorCodeConsumerFenced) {
		t.Fatalf("delayed first-attempt reject error = %v", err)
	}
	deadLetter, err := fixture.service.Reject(context.Background(), application.RejectRequest{
		Recipient:     fixture.recipient,
		ItemID:        first.ItemID,
		LaneSequence:  first.LaneSequence,
		ConsumerEpoch: secondAttempt.ConsumerEpoch,
		Code:          application.RejectCodeRetryLater,
	})
	if err != nil {
		t.Fatal(err)
	}
	if deadLetter.State != application.ItemStateDeadLetter || deadLetter.NextAttemptAt != nil {
		t.Fatalf("dead-letter result = %+v", deadLetter)
	}
	replayedDeadLetter, err := fixture.service.Reject(
		context.Background(),
		application.RejectRequest{
			Recipient:     fixture.recipient,
			ItemID:        first.ItemID,
			LaneSequence:  first.LaneSequence,
			ConsumerEpoch: secondAttempt.ConsumerEpoch,
			Code:          application.RejectCodeRetryLater,
		},
	)
	if err != nil {
		t.Fatalf("replay dead-letter rejection: %v", err)
	}
	if replayedDeadLetter.State != deadLetter.State ||
		replayedDeadLetter.NextAttemptAt != nil {
		t.Fatalf(
			"dead-letter replay changed persisted outcome: %+v",
			replayedDeadLetter,
		)
	}
	if _, err := fixture.service.Reject(
		context.Background(),
		application.RejectRequest{
			Recipient:     fixture.recipient,
			ItemID:        first.ItemID,
			LaneSequence:  first.LaneSequence,
			ConsumerEpoch: secondAttempt.ConsumerEpoch + 1,
			Code:          application.RejectCodeRetryLater,
		},
	); !application.IsCode(err, application.ErrorCodeIdempotencyConflict) {
		t.Fatalf("conflicting dead-letter replay error = %v", err)
	}

	fixture.clock.now = fixture.clock.now.Add(2 * time.Minute)
	blocked, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		secondAttempt.ConsumerEpoch,
		0,
		2,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(blocked.Items) != 0 {
		t.Fatalf("dead-letter head allowed later item: %+v", blocked.Items)
	}
	stats, err := fixture.repository.Stats(context.Background(), fixture.recipient)
	if err != nil {
		t.Fatal(err)
	}
	if stats.DeadLetter != 1 || stats.AckedThrough != 0 {
		t.Fatalf("dead-letter stats = %+v", stats)
	}
}

func TestRepositoryPreservesCanonicalPersistedStateNumbers(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	request := enqueueRequest(fixture.recipient, "persisted-states", "ciphertext")
	item, err := fixture.repository.Enqueue(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	assertPersistedItemState(t, fixture.db, item.ItemID, 1)

	_, err = fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		0,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	assertPersistedItemState(t, fixture.db, item.ItemID, 2)

	if err := fixture.db.Model(&infrastructure.DeviceQueueItemModel{}).
		Where("item_id = ?", item.ItemID).
		Updates(map[string]any{
			"state":                4,
			"consumed_at":          fixture.clock.now,
			"lease_consumer_id":    "",
			"lease_consumer_epoch": 0,
			"lease_expires_at":     nil,
		}).Error; err != nil {
		t.Fatal(err)
	}
	replayed, err := fixture.repository.Enqueue(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.State != application.ItemStateConsumed {
		t.Fatalf("persisted state 4 mapped to %q", replayed.State)
	}
	stats, err := fixture.repository.Stats(context.Background(), fixture.recipient)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Consumed != 1 {
		t.Fatalf("consumed state count = %d, want 1", stats.Consumed)
	}

	ackedFixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	ackedItem, err := ackedFixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(ackedFixture.recipient, "acked-state", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	ackedClaim, err := ackedFixture.service.Claim(
		context.Background(),
		ackedFixture.recipient,
		"consumer-a",
		0,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ackedFixture.service.Acknowledge(
		context.Background(),
		application.AcknowledgeRequest{
			Recipient:     ackedFixture.recipient,
			ItemID:        ackedItem.ItemID,
			LaneSequence:  ackedItem.LaneSequence,
			ConsumerEpoch: ackedClaim.ConsumerEpoch,
			PayloadHash:   ackedItem.PayloadHash,
		},
	); err != nil {
		t.Fatal(err)
	}
	assertPersistedItemState(t, ackedFixture.db, ackedItem.ItemID, 5)

	deadFixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	deadItem, err := deadFixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(deadFixture.recipient, "dead-state", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	deadClaim, err := deadFixture.service.Claim(
		context.Background(),
		deadFixture.recipient,
		"consumer-a",
		0,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := deadFixture.service.Reject(
		context.Background(),
		application.RejectRequest{
			Recipient:     deadFixture.recipient,
			ItemID:        deadItem.ItemID,
			LaneSequence:  deadItem.LaneSequence,
			ConsumerEpoch: deadClaim.ConsumerEpoch,
			Code:          application.RejectCodeIntegrityFailed,
		},
	); err != nil {
		t.Fatal(err)
	}
	assertPersistedItemState(t, deadFixture.db, deadItem.ItemID, 6)
}

func TestInboxMutationsReauthorizeInsideTheirTransactions(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	item, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "revoke-race", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	claim, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		0,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where(
			"ptid = ? AND device_id = ?",
			string(fixture.recipient.Actor),
			string(fixture.recipient.Device),
		).
		Update("revoked", true).Error; err != nil {
		t.Fatal(err)
	}

	if _, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		claim.ConsumerEpoch,
		0,
		1,
	); !application.IsCode(err, application.ErrorCodeUnauthorized) {
		t.Fatalf("post-revoke claim error = %v", err)
	}
	if _, err := fixture.service.Acknowledge(
		context.Background(),
		application.AcknowledgeRequest{
			Recipient:     fixture.recipient,
			ItemID:        item.ItemID,
			LaneSequence:  item.LaneSequence,
			ConsumerEpoch: claim.ConsumerEpoch,
			PayloadHash:   item.PayloadHash,
		},
	); !application.IsCode(err, application.ErrorCodeUnauthorized) {
		t.Fatalf("post-revoke acknowledge error = %v", err)
	}
	if _, err := fixture.service.Reject(
		context.Background(),
		application.RejectRequest{
			Recipient:     fixture.recipient,
			ItemID:        item.ItemID,
			LaneSequence:  item.LaneSequence,
			ConsumerEpoch: claim.ConsumerEpoch,
			Code:          application.RejectCodeRetryLater,
		},
	); !application.IsCode(err, application.ErrorCodeUnauthorized) {
		t.Fatalf("post-revoke reject error = %v", err)
	}
	if _, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "post-revoke", "ciphertext-2"),
	); !application.IsCode(err, application.ErrorCodeUnauthorized) {
		t.Fatalf("post-revoke enqueue error = %v", err)
	}

	assertPersistedItemState(t, fixture.db, item.ItemID, 2)
	var items int64
	if err := fixture.db.Model(&infrastructure.DeviceQueueItemModel{}).
		Count(&items).Error; err != nil {
		t.Fatal(err)
	}
	if items != 1 {
		t.Fatalf("post-revoke mutation persisted %d items, want 1", items)
	}
}

func TestQueueQuotaFailsBeforeLaneMutationAndAckReleasesCapacity(t *testing.T) {
	fixture := newDeliveryFixture(
		t,
		application.QueueLimits{MaxUnackedItems: 1, MaxUnackedBytes: 64},
		standardPolicy(),
	)
	first, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "quota-first", "ciphertext-1"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "quota-second", "ciphertext-2"),
	); !application.IsCode(err, application.ErrorCodeQuotaExceeded) {
		t.Fatalf("quota error = %v", err)
	}
	stats, err := fixture.repository.Stats(context.Background(), fixture.recipient)
	if err != nil {
		t.Fatal(err)
	}
	if stats.NextSequence != 1 || stats.Pending != 1 {
		t.Fatalf("quota failure mutated lane: %+v", stats)
	}

	claim, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		0,
		0,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.Acknowledge(context.Background(), application.AcknowledgeRequest{
		Recipient:     fixture.recipient,
		ItemID:        first.ItemID,
		LaneSequence:  first.LaneSequence,
		ConsumerEpoch: claim.ConsumerEpoch,
		PayloadHash:   first.PayloadHash,
	}); err != nil {
		t.Fatal(err)
	}
	second, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "quota-second", "ciphertext-2"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if second.LaneSequence != 2 {
		t.Fatalf("second lane sequence = %d, want 2", second.LaneSequence)
	}
}

func TestCorruptPersistedPayloadDeadLettersWithoutDelivery(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	item, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "corrupt", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&infrastructure.DeviceQueueItemModel{}).
		Where("item_id = ?", item.ItemID).
		Update("opaque_payload", []byte("tampered")).Error; err != nil {
		t.Fatal(err)
	}

	if _, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		0,
		0,
		1,
	); !application.IsCode(err, application.ErrorCodePayloadHashMismatch) {
		t.Fatalf("corrupt payload claim error = %v", err)
	}
	stats, err := fixture.repository.Stats(context.Background(), fixture.recipient)
	if err != nil {
		t.Fatal(err)
	}
	if stats.DeadLetter != 1 || stats.Claimed != 0 {
		t.Fatalf("corrupt payload stats = %+v", stats)
	}
}

func TestClaimRejectsCursorThatSkipsTheLaneHead(t *testing.T) {
	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	if _, err := fixture.repository.Enqueue(
		context.Background(),
		enqueueRequest(fixture.recipient, "head", "ciphertext"),
	); err != nil {
		t.Fatal(err)
	}

	if _, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		0,
		1,
		1,
	); !application.IsCode(err, application.ErrorCodeItemNotHead) {
		t.Fatalf("skipping cursor error = %v", err)
	}
}

func assertPersistedItemState(
	t *testing.T,
	db *gorm.DB,
	itemID string,
	expected int32,
) {
	t.Helper()

	var model infrastructure.DeviceQueueItemModel
	if err := db.Where("item_id = ?", itemID).First(&model).Error; err != nil {
		t.Fatal(err)
	}
	if model.State != expected {
		t.Fatalf("persisted item state = %d, want %d", model.State, expected)
	}
}
