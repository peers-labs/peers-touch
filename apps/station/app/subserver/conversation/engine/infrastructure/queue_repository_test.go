package infrastructure

import (
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newQueueRepository(t *testing.T) (*QueueRepository, *gorm.DB) {
	t.Helper()

	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	repository, err := NewQueueRepository(db, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1024 * 1024,
	})
	if err != nil {
		t.Fatalf("create queue repository: %v", err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatalf("migrate queue repository: %v", err)
	}

	return repository, db
}

func queueItem(
	ptid string,
	deviceID string,
	idempotencyKey string,
	eventID string,
	payload string,
) *chat.DeviceQueueItem {
	payloadBytes := []byte(payload)
	payloadHash := sha256.Sum256(payloadBytes)

	return &chat.DeviceQueueItem{
		Recipient: &chat.CryptoEndpoint{
			Ptid:     ptid,
			DeviceId: deviceID,
		},
		EventId:        eventID,
		ConversationId: "conversation-1",
		IdempotencyKey: idempotencyKey,
		PayloadType:    chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_CONVERSATION_EVENT,
		OpaquePayload:  payloadBytes,
		PayloadSha256:  payloadHash[:],
	}
}

func TestEnqueueAllocatesIndependentDeviceLanesForOneLogicalEvent(t *testing.T) {
	repository, _ := newQueueRepository(t)
	ctx := context.Background()

	bob1First, err := repository.Enqueue(
		ctx,
		queueItem("bob", "bob-device-1", "bob1-event-1", "event-1", "ciphertext-bob1"),
	)
	if err != nil {
		t.Fatal(err)
	}
	bob2First, err := repository.Enqueue(
		ctx,
		queueItem("bob", "bob-device-2", "bob2-event-1", "event-1", "ciphertext-bob2"),
	)
	if err != nil {
		t.Fatal(err)
	}
	bob1Second, err := repository.Enqueue(
		ctx,
		queueItem("bob", "bob-device-1", "bob1-event-2", "event-2", "ciphertext-bob1-2"),
	)
	if err != nil {
		t.Fatal(err)
	}

	if bob1First.EventId != bob2First.EventId {
		t.Fatalf("logical event IDs differ: %q != %q", bob1First.EventId, bob2First.EventId)
	}
	if bob1First.ItemId == bob2First.ItemId {
		t.Fatalf("device deliveries share item ID %q", bob1First.ItemId)
	}
	if bob1First.LaneSequence != 1 || bob2First.LaneSequence != 1 {
		t.Fatalf(
			"first lane sequences = (%d, %d), want (1, 1)",
			bob1First.LaneSequence,
			bob2First.LaneSequence,
		)
	}
	if bob1Second.LaneSequence != 2 {
		t.Fatalf("second bob-device-1 sequence = %d, want 2", bob1Second.LaneSequence)
	}
}

func TestEnqueueIsIdempotentWithoutAdvancingLane(t *testing.T) {
	repository, _ := newQueueRepository(t)
	ctx := context.Background()
	firstInput := queueItem("bob", "device-1", "event-1:device-1", "event-1", "ciphertext")

	first, err := repository.Enqueue(ctx, firstInput)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := repository.Enqueue(ctx, firstInput)
	if err != nil {
		t.Fatal(err)
	}
	next, err := repository.Enqueue(
		ctx,
		queueItem("bob", "device-1", "event-2:device-1", "event-2", "ciphertext-2"),
	)
	if err != nil {
		t.Fatal(err)
	}

	if repeated.ItemId != first.ItemId || repeated.LaneSequence != first.LaneSequence {
		t.Fatalf("idempotent enqueue returned a different item: first=%+v repeated=%+v", first, repeated)
	}
	if next.LaneSequence != 2 {
		t.Fatalf("lane advanced across idempotent replay: next sequence = %d, want 2", next.LaneSequence)
	}
}

func TestClaimAndAcknowledgeRequireLaneOrderAndPayloadHash(t *testing.T) {
	repository, _ := newQueueRepository(t)
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	first, err := repository.Enqueue(
		ctx,
		queueItem("bob", "device-1", "event-1:device-1", "event-1", "ciphertext-1"),
	)
	if err != nil {
		t.Fatal(err)
	}
	second, err := repository.Enqueue(
		ctx,
		queueItem("bob", "device-1", "event-2:device-1", "event-2", "ciphertext-2"),
	)
	if err != nil {
		t.Fatal(err)
	}

	claim, err := repository.Claim(
		ctx,
		"bob",
		"device-1",
		"consumer-1",
		0,
		0,
		10,
		now,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if claim.ConsumerEpoch != 1 || len(claim.Items) != 2 {
		t.Fatalf(
			"claim = epoch %d, %d items; want epoch 1, 2 items",
			claim.ConsumerEpoch,
			len(claim.Items),
		)
	}
	if claim.LaneHead != 2 || claim.AckedThrough != 0 {
		t.Fatalf("claim lane state = head %d, acked %d; want 2, 0", claim.LaneHead, claim.AckedThrough)
	}

	if _, err := repository.Acknowledge(
		ctx,
		"bob",
		"device-1",
		second.ItemId,
		second.LaneSequence,
		claim.ConsumerEpoch,
		second.PayloadSha256,
		now,
	); !errors.Is(err, messaging.ErrQueueItemOrder) {
		t.Fatalf("out-of-order ACK error = %v, want ErrQueueItemOrder", err)
	}

	wrongHash := sha256.Sum256([]byte("wrong"))
	if _, err := repository.Acknowledge(
		ctx,
		"bob",
		"device-1",
		first.ItemId,
		first.LaneSequence,
		claim.ConsumerEpoch,
		wrongHash[:],
		now,
	); !errors.Is(err, messaging.ErrPayloadHash) {
		t.Fatalf("wrong-hash ACK error = %v, want ErrPayloadHash", err)
	}

	ackedThrough, err := repository.Acknowledge(
		ctx,
		"bob",
		"device-1",
		first.ItemId,
		first.LaneSequence,
		claim.ConsumerEpoch,
		first.PayloadSha256,
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if ackedThrough != 1 {
		t.Fatalf("acked through = %d, want 1", ackedThrough)
	}
}

func TestConsumerEpochFencesOldConsumerAndLeaseExpiryAllowsRecovery(t *testing.T) {
	repository, _ := newQueueRepository(t)
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	item, err := repository.Enqueue(
		ctx,
		queueItem("bob", "device-1", "event-1:device-1", "event-1", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}

	firstClaim, err := repository.Claim(
		ctx,
		"bob",
		"device-1",
		"consumer-1",
		0,
		0,
		1,
		now,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if firstClaim.ConsumerEpoch != 1 || len(firstClaim.Items) != 1 {
		t.Fatalf("first claim = epoch %d, %d items", firstClaim.ConsumerEpoch, len(firstClaim.Items))
	}

	earlyClaim, err := repository.Claim(
		ctx,
		"bob",
		"device-1",
		"consumer-2",
		firstClaim.ConsumerEpoch,
		0,
		1,
		now.Add(30*time.Second),
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if earlyClaim.ConsumerEpoch != 2 || len(earlyClaim.Items) != 0 {
		t.Fatalf(
			"early replacement claim = epoch %d, %d items; want epoch 2, 0 items",
			earlyClaim.ConsumerEpoch,
			len(earlyClaim.Items),
		)
	}

	if _, err := repository.Acknowledge(
		ctx,
		"bob",
		"device-1",
		item.ItemId,
		item.LaneSequence,
		firstClaim.ConsumerEpoch,
		item.PayloadSha256,
		now.Add(30*time.Second),
	); !errors.Is(err, messaging.ErrConsumerFenced) {
		t.Fatalf("stale ACK error = %v, want ErrConsumerFenced", err)
	}

	recovered, err := repository.Claim(
		ctx,
		"bob",
		"device-1",
		"consumer-2",
		earlyClaim.ConsumerEpoch,
		0,
		1,
		now.Add(61*time.Second),
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.ConsumerEpoch != earlyClaim.ConsumerEpoch || len(recovered.Items) != 1 {
		t.Fatalf(
			"lease recovery = epoch %d, %d items; want epoch %d, 1 item",
			recovered.ConsumerEpoch,
			len(recovered.Items),
			earlyClaim.ConsumerEpoch,
		)
	}
}

func TestAcknowledgeRejectsWrongEndpoint(t *testing.T) {
	repository, _ := newQueueRepository(t)
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	item, err := repository.Enqueue(
		ctx,
		queueItem("bob", "device-1", "event-1:device-1", "event-1", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	bobClaim, err := repository.Claim(
		ctx,
		"bob",
		"device-1",
		"bob-consumer",
		0,
		0,
		1,
		now,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	aliceClaim, err := repository.Claim(
		ctx,
		"alice",
		"device-1",
		"alice-consumer",
		0,
		0,
		1,
		now,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if aliceClaim.ConsumerEpoch != bobClaim.ConsumerEpoch {
		t.Fatalf(
			"test setup epochs differ: alice=%d bob=%d",
			aliceClaim.ConsumerEpoch,
			bobClaim.ConsumerEpoch,
		)
	}

	if _, err := repository.Acknowledge(
		ctx,
		"alice",
		"device-1",
		item.ItemId,
		item.LaneSequence,
		aliceClaim.ConsumerEpoch,
		item.PayloadSha256,
		now,
	); !errors.Is(err, messaging.ErrQueueItemOwner) {
		t.Fatalf("wrong-owner ACK error = %v, want ErrQueueItemOwner", err)
	}
}

func TestRetryWaitIsNotClaimedBeforeNextAttempt(t *testing.T) {
	repository, db := newQueueRepository(t)
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	item, err := repository.Enqueue(
		ctx,
		queueItem("bob", "device-1", "event-1:device-1", "event-1", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	nextAttemptAt := now.Add(time.Minute)
	if err := db.Model(&DeviceQueueItemModel{}).
		Where("item_id = ?", item.ItemId).
		Updates(map[string]any{
			"state":           int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_RETRY_WAIT),
			"next_attempt_at": nextAttemptAt,
		}).Error; err != nil {
		t.Fatal(err)
	}

	early, err := repository.Claim(
		ctx,
		"bob",
		"device-1",
		"consumer-1",
		0,
		0,
		1,
		now,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(early.Items) != 0 {
		t.Fatalf("claimed retry-wait item early: %+v", early.Items)
	}

	due, err := repository.Claim(
		ctx,
		"bob",
		"device-1",
		"consumer-1",
		early.ConsumerEpoch,
		0,
		1,
		nextAttemptAt,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(due.Items) != 1 || due.Items[0].ItemId != item.ItemId {
		t.Fatalf("due retry claim = %+v, want item %q", due.Items, item.ItemId)
	}
}

func TestRejectSchedulesRetryThenDeadLettersAtAttemptLimit(t *testing.T) {
	repository, _ := newQueueRepository(t)
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	item, err := repository.Enqueue(
		ctx,
		queueItem("bob", "device-1", "event-1:device-1", "event-1", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	claim, err := repository.Claim(
		ctx,
		"bob",
		"device-1",
		"consumer-1",
		0,
		0,
		1,
		now,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}

	retryAt := now.Add(time.Minute)
	rejected, err := repository.Reject(
		ctx,
		"bob",
		"device-1",
		item.ItemId,
		item.LaneSequence,
		claim.ConsumerEpoch,
		messaging.RejectDecision{
			Retryable:      true,
			ErrorCode:      "storage_locked",
			MaxAttempts:    2,
			BaseRetryDelay: time.Minute,
			MaxRetryDelay:  time.Hour,
		},
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if rejected.State != chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_RETRY_WAIT {
		t.Fatalf("first rejection state = %v, want RETRY_WAIT", rejected.State)
	}

	claimed, err := repository.Claim(
		ctx,
		"bob",
		"device-1",
		"consumer-1",
		claim.ConsumerEpoch,
		0,
		1,
		retryAt,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(claimed.Items) != 1 || claimed.Items[0].AttemptCount != 2 {
		t.Fatalf("second claim = %+v, want attempt count 2", claimed.Items)
	}

	deadLetter, err := repository.Reject(
		ctx,
		"bob",
		"device-1",
		item.ItemId,
		item.LaneSequence,
		claim.ConsumerEpoch,
		messaging.RejectDecision{
			Retryable:      true,
			ErrorCode:      "bad_ciphertext",
			MaxAttempts:    2,
			BaseRetryDelay: time.Minute,
			MaxRetryDelay:  time.Hour,
		},
		retryAt,
	)
	if err != nil {
		t.Fatal(err)
	}
	if deadLetter.State != chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_DEAD_LETTER {
		t.Fatalf("second rejection state = %v, want DEAD_LETTER", deadLetter.State)
	}
	if deadLetter.LastErrorCode != "bad_ciphertext" {
		t.Fatalf("dead-letter error code = %q, want bad_ciphertext", deadLetter.LastErrorCode)
	}

	stats, err := repository.Stats(ctx, "bob", "device-1")
	if err != nil {
		t.Fatal(err)
	}
	if stats.DeadLetter != 1 || stats.AckedThrough != 0 {
		t.Fatalf("dead-letter stats = %+v, want one blocked item at lane head", stats)
	}
}

func TestQueueQuotaFailsClosedWithoutAdvancingLane(t *testing.T) {
	_, db := newQueueRepository(t)
	repository, err := NewQueueRepository(db, messaging.QueueLimits{
		MaxUnackedItems: 1,
		MaxUnackedBytes: 64,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	first, err := repository.Enqueue(
		ctx,
		queueItem("bob", "device-1", "event-1:device-1", "event-1", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}

	_, err = repository.Enqueue(
		ctx,
		queueItem("bob", "device-1", "event-2:device-1", "event-2", "ciphertext-2"),
	)
	if !errors.Is(err, messaging.ErrQueueQuotaExceeded) {
		t.Fatalf("over-quota enqueue error = %v, want ErrQueueQuotaExceeded", err)
	}
	stats, err := repository.Stats(ctx, "bob", "device-1")
	if err != nil {
		t.Fatal(err)
	}
	if stats.NextSequence != first.LaneSequence || stats.Pending != 1 {
		t.Fatalf("quota failure mutated lane: %+v", stats)
	}
}

func TestAcknowledgedItemsReleaseQueueQuota(t *testing.T) {
	_, db := newQueueRepository(t)
	repository, err := NewQueueRepository(db, messaging.QueueLimits{
		MaxUnackedItems: 1,
		MaxUnackedBytes: 64,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	first, err := repository.Enqueue(
		ctx,
		queueItem("bob", "device-1", "event-1:device-1", "event-1", "ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	claim, err := repository.Claim(
		ctx,
		"bob",
		"device-1",
		"consumer-1",
		0,
		0,
		1,
		now,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.Acknowledge(
		ctx,
		"bob",
		"device-1",
		first.ItemId,
		first.LaneSequence,
		claim.ConsumerEpoch,
		first.PayloadSha256,
		now,
	); err != nil {
		t.Fatal(err)
	}

	second, err := repository.Enqueue(
		ctx,
		queueItem("bob", "device-1", "event-2:device-1", "event-2", "ciphertext-2"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if second.LaneSequence != 2 {
		t.Fatalf("second sequence = %d, want 2", second.LaneSequence)
	}
	stats, err := repository.Stats(ctx, "bob", "device-1")
	if err != nil {
		t.Fatal(err)
	}
	if stats.Acked != 1 || stats.Pending != 1 {
		t.Fatalf("queue stats = %+v, want one ACKED and one PENDING", stats)
	}
}
