package infrastructure_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func TestPostgresConcurrentFederatedMlsClaimsNeverReuseMaterial(t *testing.T) {
	db := openIsolatedPostgres(t)
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
	now := time.Unix(1_700_000_000, 0).UTC()
	for index, material := range [][]byte{
		[]byte("postgres-key-package-1"),
		[]byte("postgres-key-package-2"),
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

	start := make(chan struct{})
	results := make(chan *chat.ClaimFederatedMlsKeyPackageResponse, 2)
	errorsCh := make(chan error, 2)
	var wait sync.WaitGroup
	for _, planID := range []string{"plan-a", "plan-b"} {
		wait.Add(1)
		go func(planID string) {
			defer wait.Done()
			<-start
			result, err := store.ClaimIrreversibly(
				context.Background(),
				federatedMlsClaimRequest(planID, now.Add(time.Minute)),
				"station-home",
				now,
			)
			if err != nil {
				errorsCh <- err
				return
			}
			results <- result
		}(planID)
	}
	close(start)
	wait.Wait()
	close(results)
	close(errorsCh)
	for err := range errorsCh {
		t.Fatal(err)
	}
	claimed := make([]*chat.ClaimFederatedMlsKeyPackageResponse, 0, 2)
	for result := range results {
		claimed = append(claimed, result)
	}
	if len(claimed) != 2 ||
		claimed[0].PackageId == claimed[1].PackageId ||
		bytes.Equal(claimed[0].KeyPackageSha256, claimed[1].KeyPackageSha256) {
		t.Fatalf("concurrent claims reused package: %+v", claimed)
	}
}
