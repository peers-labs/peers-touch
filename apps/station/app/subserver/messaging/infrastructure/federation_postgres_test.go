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

func TestPostgresCompetingDispatchersFenceAuthoritySequence(t *testing.T) {
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
	for sequence := int64(3); sequence >= 1; sequence-- {
		frame := signedFederationFrame(
			t,
			fmt.Sprintf("ordered-frame-%d", sequence),
			fmt.Sprintf("ordered-event-%d", sequence),
			now,
		)
		frame.ConversationId = "ordered-conversation"
		frame.AuthoritySequence = sequence
		if err := repository.EnqueueFederationFrame(context.Background(), frame, now); err != nil {
			t.Fatal(err)
		}
	}

	claimed := make(chan int64, 2)
	errs := make(chan error, 2)
	var wait sync.WaitGroup
	for index := 0; index < 2; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			claims, err := repository.ClaimFederationFrames(
				context.Background(),
				fmt.Sprintf("ordered-dispatcher-%d", index),
				3,
				now,
				time.Minute,
			)
			if err != nil {
				errs <- err
				return
			}
			for _, claim := range claims {
				claimed <- claim.Frame.AuthoritySequence
			}
		}(index)
	}
	wait.Wait()
	close(claimed)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	var sequences []int64
	for sequence := range claimed {
		sequences = append(sequences, sequence)
	}
	if len(sequences) != 1 || sequences[0] != 1 {
		t.Fatalf("competing sequence claims = %v, want [1]", sequences)
	}
}
