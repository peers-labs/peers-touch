package infrastructure_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newFederationRepository(t *testing.T) *infrastructure.FederationRepository {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	repository := infrastructure.NewFederationRepository(db)
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	return repository
}

func signedFederationFrame(t *testing.T, frameID, idempotencyKey string, now time.Time) *chat.MessagingFederationFrame {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("opaque batch " + frameID)
	hash := sha256.Sum256(payload)
	frame := &chat.MessagingFederationFrame{
		FrameId:         frameID,
		SourceStationId: "station-a",
		TargetStationId: "station-b",
		IdempotencyKey:  idempotencyKey,
		PayloadType:     chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_DEVICE_QUEUE_BATCH,
		OpaquePayload:   payload,
		PayloadSha256:   hash[:],
		IssuedAt:        timestamppb.New(now),
		ExpiresAt:       timestamppb.New(now.Add(time.Hour)),
	}
	if err := application.SignFederationFrame(frame, "key-1", privateKey); err != nil {
		t.Fatal(err)
	}
	return frame
}

func TestFederationOutboxIdempotencyAndLeaseFencing(t *testing.T) {
	repository := newFederationRepository(t)
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	frame := signedFederationFrame(t, "frame-1", "idempotency-1", now)
	if err := repository.EnqueueFederationFrame(ctx, frame, now); err != nil {
		t.Fatal(err)
	}
	if err := repository.EnqueueFederationFrame(ctx, frame, now); err != nil {
		t.Fatalf("exact replay: %v", err)
	}
	conflict := signedFederationFrame(t, "frame-2", "idempotency-1", now)
	if err := repository.EnqueueFederationFrame(ctx, conflict, now); !errors.Is(
		err,
		messaging.ErrFederationFrameConflict,
	) {
		t.Fatalf("conflict error = %v", err)
	}

	first, err := repository.ClaimFederationFrames(
		ctx,
		"dispatcher-1",
		10,
		now,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 || first[0].LeaseGeneration != 1 {
		t.Fatalf("first claim = %+v", first)
	}
	if err := repository.MarkFederationDelivered(
		ctx,
		"frame-1",
		"dispatcher-2",
		first[0].LeaseGeneration,
		now,
	); !errors.Is(err, messaging.ErrFederationDispatcherFenced) {
		t.Fatalf("wrong owner error = %v", err)
	}
	if err := repository.MarkFederationDelivered(
		ctx,
		"frame-1",
		"dispatcher-1",
		first[0].LeaseGeneration,
		now,
	); err != nil {
		t.Fatal(err)
	}
}

func TestFederationExpiredLeaseCanBeReclaimedAndOldGenerationIsFenced(t *testing.T) {
	repository := newFederationRepository(t)
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	frame := signedFederationFrame(t, "frame-1", "idempotency-1", now)
	if err := repository.EnqueueFederationFrame(ctx, frame, now); err != nil {
		t.Fatal(err)
	}
	first, err := repository.ClaimFederationFrames(
		ctx,
		"dispatcher-1",
		1,
		now,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	second, err := repository.ClaimFederationFrames(
		ctx,
		"dispatcher-2",
		1,
		now.Add(time.Minute),
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 1 || second[0].LeaseGeneration != 2 {
		t.Fatalf("reclaim = %+v", second)
	}
	if err := repository.ScheduleFederationRetry(
		ctx,
		"frame-1",
		"dispatcher-1",
		first[0].LeaseGeneration,
		now.Add(time.Hour),
		"late_failure",
	); !errors.Is(err, messaging.ErrFederationDispatcherFenced) {
		t.Fatalf("stale generation error = %v", err)
	}
	if err := repository.ScheduleFederationRetry(
		ctx,
		"frame-1",
		"dispatcher-2",
		second[0].LeaseGeneration,
		now.Add(2*time.Minute),
		"network",
	); err != nil {
		t.Fatal(err)
	}
	early, err := repository.ClaimFederationFrames(
		ctx,
		"dispatcher-3",
		1,
		now.Add(90*time.Second),
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(early) != 0 {
		t.Fatalf("retry claimed early: %+v", early)
	}
}

func TestFederationDeliveredClearsPreviousRetryError(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	repository := infrastructure.NewFederationRepository(db)
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	frame := signedFederationFrame(t, "frame-1", "idempotency-1", now)
	if err := repository.EnqueueFederationFrame(ctx, frame, now); err != nil {
		t.Fatal(err)
	}
	first, err := repository.ClaimFederationFrames(
		ctx,
		"dispatcher-1",
		1,
		now,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.ScheduleFederationRetry(
		ctx,
		"frame-1",
		"dispatcher-1",
		first[0].LeaseGeneration,
		now.Add(time.Minute),
		"network",
	); err != nil {
		t.Fatal(err)
	}
	second, err := repository.ClaimFederationFrames(
		ctx,
		"dispatcher-2",
		1,
		now.Add(time.Minute),
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.MarkFederationDelivered(
		ctx,
		"frame-1",
		"dispatcher-2",
		second[0].LeaseGeneration,
		now.Add(time.Minute),
	); err != nil {
		t.Fatal(err)
	}
	var persisted infrastructure.FederationOutboxModel
	if err := db.Where("frame_id = ?", "frame-1").First(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.State != "delivered" || persisted.LastErrorCode != "" {
		t.Fatalf("delivered frame retained stale error: %+v", persisted)
	}
}

func TestFederationOutboxFencesConversationAuthoritySequence(t *testing.T) {
	repository := newFederationRepository(t)
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	second := signedFederationFrame(t, "frame-2", "event-2", now)
	second.ConversationId = "conversation-1"
	second.AuthoritySequence = 2
	first := signedFederationFrame(t, "frame-1", "event-1", now)
	first.ConversationId = "conversation-1"
	first.AuthoritySequence = 1
	if err := repository.EnqueueFederationFrame(ctx, second, now); err != nil {
		t.Fatal(err)
	}
	if err := repository.EnqueueFederationFrame(ctx, first, now); err != nil {
		t.Fatal(err)
	}

	firstClaims, err := repository.ClaimFederationFrames(
		ctx,
		"dispatcher-1",
		10,
		now,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(firstClaims) != 1 || firstClaims[0].Frame.AuthoritySequence != 1 {
		t.Fatalf("first claims = %+v", firstClaims)
	}
	if err := repository.MarkFederationDelivered(
		ctx,
		firstClaims[0].Frame.FrameId,
		"dispatcher-1",
		firstClaims[0].LeaseGeneration,
		now,
	); err != nil {
		t.Fatal(err)
	}
	secondClaims, err := repository.ClaimFederationFrames(
		ctx,
		"dispatcher-2",
		10,
		now,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(secondClaims) != 1 || secondClaims[0].Frame.AuthoritySequence != 2 {
		t.Fatalf("second claims = %+v", secondClaims)
	}
}
