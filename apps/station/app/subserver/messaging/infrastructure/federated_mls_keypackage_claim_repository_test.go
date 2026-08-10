package infrastructure_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFederatedMlsKeyPackageClaimIsIrreversibleAndReplayable(t *testing.T) {
	db := federatedMlsClaimDatabase(t)
	store, err := infrastructure.NewFederatedMlsKeyPackageClaimStore(db)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	material := []byte("one-shot-key-package")
	hash := sha256.Sum256(material)
	if err := db.Create(&infrastructure.MlsKeyPackageModel{
		PTID:       "bob",
		DeviceID:   "bob-1",
		StationID:  "station-home",
		Data:       material,
		DataSHA256: hash[:],
		CreatedAt:  now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	request := federatedMlsClaimRequest("plan-1", now.Add(time.Minute))

	first, err := store.ClaimIrreversibly(
		context.Background(),
		request,
		"station-home",
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := store.ClaimIrreversibly(
		context.Background(),
		request,
		"station-home",
		now.Add(time.Second),
	)
	if err != nil {
		t.Fatal(err)
	}
	if first.PackageId != replay.PackageId ||
		!bytes.Equal(first.KeyPackage, replay.KeyPackage) ||
		!bytes.Equal(first.KeyPackageSha256, replay.KeyPackageSha256) ||
		!first.IrreversiblyConsumed ||
		!replay.IrreversiblyConsumed {
		t.Fatalf("claim replay mismatch: first=%+v replay=%+v", first, replay)
	}
	var packageCount, claimCount int64
	if err := db.Model(&infrastructure.MlsKeyPackageModel{}).Count(&packageCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&infrastructure.FederatedMlsKeyPackageClaimModel{}).
		Count(&claimCount).Error; err != nil {
		t.Fatal(err)
	}
	if packageCount != 0 || claimCount != 1 {
		t.Fatalf("packages=%d claims=%d, want 0/1", packageCount, claimCount)
	}
}

func TestFederatedMlsKeyPackageClaimRejectsExpiryWithoutConsumption(t *testing.T) {
	db := federatedMlsClaimDatabase(t)
	store, err := infrastructure.NewFederatedMlsKeyPackageClaimStore(db)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	material := []byte("unconsumed-key-package")
	hash := sha256.Sum256(material)
	if err := db.Create(&infrastructure.MlsKeyPackageModel{
		PTID:       "bob",
		DeviceID:   "bob-1",
		StationID:  "station-home",
		Data:       material,
		DataSHA256: hash[:],
		CreatedAt:  now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	_, err = store.ClaimIrreversibly(
		context.Background(),
		federatedMlsClaimRequest(
			"expired-plan",
			now.Add(-messaging.FederationClockSkewBudget),
		),
		"station-home",
		now,
	)
	if !errors.Is(err, messaging.ErrAuthorityPlanExpired) {
		t.Fatalf("error=%v, want ErrAuthorityPlanExpired", err)
	}
	var packageCount, claimCount int64
	db.Model(&infrastructure.MlsKeyPackageModel{}).Count(&packageCount)
	db.Model(&infrastructure.FederatedMlsKeyPackageClaimModel{}).Count(&claimCount)
	if packageCount != 1 || claimCount != 0 {
		t.Fatalf("packages=%d claims=%d, want 1/0", packageCount, claimCount)
	}
}

func TestFederatedMlsKeyPackageDistinctClaimsNeverReuseMaterial(t *testing.T) {
	db := federatedMlsClaimDatabase(t)
	store, err := infrastructure.NewFederatedMlsKeyPackageClaimStore(db)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	for index, material := range [][]byte{
		[]byte("key-package-1"),
		[]byte("key-package-2"),
	} {
		hash := sha256.Sum256(material)
		if err := db.Create(&infrastructure.MlsKeyPackageModel{
			PTID:       "bob",
			DeviceID:   "bob-1",
			StationID:  "station-home",
			Data:       material,
			DataSHA256: hash[:],
			CreatedAt:  now.Add(time.Duration(index) * time.Second),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}

	claimed := make([]*chat.ClaimFederatedMlsKeyPackageResponse, 0, 2)
	for _, planID := range []string{"plan-a", "plan-b"} {
		result, err := store.ClaimIrreversibly(
			context.Background(),
			federatedMlsClaimRequest(planID, now.Add(time.Minute)),
			"station-home",
			now,
		)
		if err != nil {
			t.Fatal(err)
		}
		claimed = append(claimed, result)
	}
	if len(claimed) != 2 ||
		claimed[0].PackageId == claimed[1].PackageId ||
		bytes.Equal(claimed[0].KeyPackageSha256, claimed[1].KeyPackageSha256) {
		t.Fatalf("concurrent claims reused package: %+v", claimed)
	}
}

func federatedMlsClaimDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:mls-claim-"+uuid.NewString()+"?mode=memory&cache=shared&_busy_timeout=5000"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	store, err := infrastructure.NewFederatedMlsKeyPackageClaimStore(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&infrastructure.MlsKeyPackageModel{}); err != nil {
		t.Fatal(err)
	}
	if err := store.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	return db
}

func federatedMlsClaimRequest(
	planID string,
	expiresAt time.Time,
) *chat.ClaimFederatedMlsKeyPackageRequest {
	return &chat.ClaimFederatedMlsKeyPackageRequest{
		AuthorityPlanId:    planID,
		AuthorityStationId: "station-authority",
		Target: &chat.CryptoEndpoint{
			Ptid:     "bob",
			DeviceId: "bob-1",
		},
		PlanExpiresAt: timestamppb.New(expiresAt),
	}
}
