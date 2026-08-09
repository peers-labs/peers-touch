package infrastructure_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
)

func TestPostgresCompetingFederationDispatchersDoNotDuplicateClaims(t *testing.T) {
	db := openIsolatedPostgres(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(8)
	repository := infrastructure.NewFederationRepository(db)
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	suffix := uuid.NewString()
	for index := 0; index < 20; index++ {
		frame := signedFederationFrame(
			t,
			"pg-frame-"+suffix+fmt.Sprintf("-%02d", index),
			"pg-idempotency-"+suffix+fmt.Sprintf("-%02d", index),
			now,
		)
		if err := repository.EnqueueFederationFrame(context.Background(), frame, now); err != nil {
			t.Fatal(err)
		}
	}

	claimed := make([]map[string]struct{}, 2)
	errs := make([]error, 2)
	var wait sync.WaitGroup
	for index := range claimed {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			claims, err := repository.ClaimFederationFrames(
				context.Background(),
				fmt.Sprintf("pg-dispatcher-%d", index),
				20,
				now,
				time.Minute,
			)
			errs[index] = err
			claimed[index] = make(map[string]struct{}, len(claims))
			for _, claim := range claims {
				claimed[index][claim.Frame.FrameId] = struct{}{}
			}
		}(index)
	}
	wait.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	union := make(map[string]struct{}, 20)
	for _, dispatcherClaims := range claimed {
		for frameID := range dispatcherClaims {
			if _, duplicate := union[frameID]; duplicate {
				t.Fatalf("frame %s was claimed by competing dispatchers", frameID)
			}
			union[frameID] = struct{}{}
		}
	}
	if len(union) != 20 {
		t.Fatalf("claimed frame count = %d, want 20", len(union))
	}
}
