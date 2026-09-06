package infrastructure_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAuthorityPlanLifecycleAndKeyPackageReservation(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	plans := infrastructure.NewAuthorityPlanRepository(db)
	keyPackages := infrastructure.NewMlsKeyPackageStore(db)
	if err := plans.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	if err := keyPackages.AutoMigrate(); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	planHash := sha256.Sum256([]byte("plan"))
	plan := &messaging.AuthorityPlan{
		PlanID:              "plan-1",
		PlanKind:            1,
		ConversationID:      "group-1",
		RequesterPTID:       "alice",
		RequesterDeviceID:   "alice-device",
		IntentBytes:         []byte("intent"),
		SnapshotBytes:       []byte("snapshot"),
		AuthorityPlanSHA256: planHash[:],
		State:               messaging.AuthorityPlanStatePrepared,
		ExpiresAt:           now.Add(time.Minute),
	}
	if err := plans.Create(ctx, plan); err != nil {
		t.Fatal(err)
	}
	loaded, err := plans.Get(ctx, plan.PlanID)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(loaded.AuthorityPlanSHA256, planHash[:]) ||
		loaded.State != messaging.AuthorityPlanStatePrepared {
		t.Fatalf("loaded authority plan = %+v", loaded)
	}

	keyPackageBytes := []byte("key-package")
	keyPackageHash := sha256.Sum256(keyPackageBytes)
	if err := db.Create(&infrastructure.MlsKeyPackageModel{
		PTID:       "bob",
		DeviceID:   "bob-device",
		StationID:  "station-local",
		Data:       keyPackageBytes,
		DataSHA256: keyPackageHash[:],
		CreatedAt:  now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	endpoint := &chat.CryptoEndpoint{Ptid: "bob", DeviceId: "bob-device"}
	reserved, err := keyPackages.Reserve(ctx, plan.PlanID, endpoint, now, plan.ExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	if reserved.Target == nil ||
		reserved.Target.Ptid != endpoint.Ptid ||
		reserved.Target.DeviceId != endpoint.DeviceId ||
		!bytes.Equal(reserved.KeyPackageSha256, keyPackageHash[:]) {
		t.Fatalf("reserved KeyPackage = %+v", reserved)
	}
	if _, err := keyPackages.Reserve(
		ctx,
		"competing-plan",
		endpoint,
		now,
		plan.ExpiresAt,
	); !errors.Is(err, messaging.ErrNotFound) {
		t.Fatalf("competing reservation error = %v", err)
	}

	if err := plans.MarkConsumed(ctx, plan.PlanID, planHash[:], now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := keyPackages.ConsumeReservations(ctx, plan.PlanID); err != nil {
		t.Fatal(err)
	}
	var packageCount int64
	if err := db.Model(&infrastructure.MlsKeyPackageModel{}).Count(&packageCount).Error; err != nil {
		t.Fatal(err)
	}
	if packageCount != 0 {
		t.Fatalf("reserved KeyPackage count = %d, want 0", packageCount)
	}
	if err := plans.MarkConsumed(
		ctx,
		plan.PlanID,
		planHash[:],
		now.Add(2*time.Second),
	); !errors.Is(err, messaging.ErrAuthorityPlanStale) {
		t.Fatalf("replayed plan consumption error = %v", err)
	}
}

func TestExpiredAuthorityPlanCannotBeConsumed(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	plans := infrastructure.NewAuthorityPlanRepository(db)
	if err := plans.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	planHash := sha256.Sum256([]byte("expired-plan"))
	plan := &messaging.AuthorityPlan{
		PlanID:              "expired-plan",
		PlanKind:            1,
		ConversationID:      "group-1",
		RequesterPTID:       "alice",
		RequesterDeviceID:   "alice-device",
		IntentBytes:         []byte("intent"),
		SnapshotBytes:       []byte("snapshot"),
		AuthorityPlanSHA256: planHash[:],
		State:               messaging.AuthorityPlanStatePrepared,
		ExpiresAt:           now,
	}
	if err := plans.Create(context.Background(), plan); err != nil {
		t.Fatal(err)
	}
	if err := plans.MarkConsumed(
		context.Background(),
		plan.PlanID,
		planHash[:],
		now.Add(time.Second),
	); !errors.Is(err, messaging.ErrAuthorityPlanExpired) {
		t.Fatalf("expired plan consumption error = %v", err)
	}
}
