package persistence_test

import (
	"context"
	"crypto/sha256"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCanonicalRecoveryRevisionSchema(t *testing.T) {
	db, repository := openRepository(t)
	if got := (&persistence.RecoveryRevisionModel{}).TableName(); got != "recovery_revisions" {
		t.Fatalf("table name = %q", got)
	}
	for _, column := range []string{
		"revision_id",
		"ptid",
		"format_version",
		"encrypted_archive",
		"encrypted_archive_sha256",
		"created_by_device_id",
		"created_at",
	} {
		if !db.Migrator().HasColumn(&persistence.RecoveryRevisionModel{}, column) {
			t.Fatalf("canonical column %q is missing", column)
		}
	}
	if repository == nil {
		t.Fatal("repository is nil")
	}
}

func TestRepositoryEnforcesImmutableReplayConflictAndLatestPerActor(t *testing.T) {
	_, repository := openRepository(t)
	ctx := context.Background()
	first := revision(
		t,
		"revision-1",
		"ptid:alice",
		"alice-device",
		"opaque-1",
		time.Second,
	)
	second := revision(
		t,
		"revision-2",
		"ptid:alice",
		"alice-device",
		"opaque-2",
		2*time.Second,
	)
	bob := revision(
		t,
		"revision-bob",
		"ptid:bob",
		"bob-device",
		"opaque-bob",
		3*time.Second,
	)

	created, err := repository.StoreRecoveryRevision(ctx, first)
	if err != nil {
		t.Fatal(err)
	}
	if created.Replay {
		t.Fatal("first insert was reported as a replay")
	}
	replayed, err := repository.StoreRecoveryRevision(ctx, revision(
		t,
		"revision-1",
		"ptid:alice",
		"alice-device",
		"opaque-1",
		99*time.Second,
	))
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.Replay || !replayed.Revision.CreatedAt.Equal(first.CreatedAt) {
		t.Fatalf("replay result = %+v", replayed)
	}
	conflicting := revision(
		t,
		"revision-1",
		"ptid:alice",
		"alice-device",
		"different",
		4*time.Second,
	)
	if _, err := repository.StoreRecoveryRevision(
		ctx,
		conflicting,
	); !domain.IsCode(err, domain.ErrorCodeRevisionConflict) {
		t.Fatalf("conflict error = %v", err)
	}

	for _, candidate := range []domain.Revision{second, bob} {
		if _, err := repository.StoreRecoveryRevision(ctx, candidate); err != nil {
			t.Fatal(err)
		}
	}
	latest, err := repository.ReadLatestRecoveryRevision(ctx, "ptid:alice")
	if err != nil {
		t.Fatal(err)
	}
	if latest.RevisionID != second.RevisionID {
		t.Fatalf("latest revision = %q", latest.RevisionID)
	}
	if _, err := repository.ReadLatestRecoveryRevision(
		ctx,
		"ptid:unknown",
	); !domain.IsCode(err, domain.ErrorCodeRevisionNotFound) {
		t.Fatalf("not-found error = %v", err)
	}
}

func TestRepositoryConcurrentExactReplayPersistsOneImmutableRow(t *testing.T) {
	db, repository := openRepository(t)
	ctx := context.Background()
	candidate := revision(
		t,
		"revision-race",
		"ptid:alice",
		"alice-device",
		"opaque-race",
		time.Second,
	)

	const writers = 32
	results := make(chan bool, writers)
	errors := make(chan error, writers)
	var waitGroup sync.WaitGroup
	for range writers {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			result, err := repository.StoreRecoveryRevision(ctx, candidate)
			if err != nil {
				errors <- err
				return
			}
			results <- result.Replay
		}()
	}
	waitGroup.Wait()
	close(results)
	close(errors)

	for err := range errors {
		t.Errorf("concurrent store: %v", err)
	}
	var inserts int
	var replays int
	for replay := range results {
		if replay {
			replays++
		} else {
			inserts++
		}
	}
	if inserts != 1 || replays != writers-1 {
		t.Fatalf("inserts=%d replays=%d", inserts, replays)
	}
	var rows int64
	if err := db.Model(&persistence.RecoveryRevisionModel{}).Count(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("recovery revision rows = %d", rows)
	}
}

func TestRepositoryConcurrentConflictingReplayKeepsOneWinner(t *testing.T) {
	db, repository := openRepository(t)
	ctx := context.Background()
	first := revision(
		t,
		"revision-conflict-race",
		"ptid:alice",
		"alice-device",
		"opaque-a",
		time.Second,
	)
	second := revision(
		t,
		"revision-conflict-race",
		"ptid:alice",
		"alice-device",
		"opaque-b",
		time.Second,
	)

	const writersPerPayload = 16
	type storeAttempt struct {
		replay bool
		err    error
	}
	attempts := make(chan storeAttempt, writersPerPayload*2)
	var waitGroup sync.WaitGroup
	for _, candidate := range []domain.Revision{first, second} {
		for range writersPerPayload {
			waitGroup.Add(1)
			go func(candidate domain.Revision) {
				defer waitGroup.Done()
				result, err := repository.StoreRecoveryRevision(ctx, candidate)
				attempts <- storeAttempt{replay: result.Replay, err: err}
			}(candidate)
		}
	}
	waitGroup.Wait()
	close(attempts)

	var inserts int
	var replays int
	var conflicts int
	for attempt := range attempts {
		switch {
		case attempt.err == nil && attempt.replay:
			replays++
		case attempt.err == nil:
			inserts++
		case domain.IsCode(attempt.err, domain.ErrorCodeRevisionConflict):
			conflicts++
		default:
			t.Errorf("concurrent conflicting store: %v", attempt.err)
		}
	}
	if inserts != 1 ||
		replays != writersPerPayload-1 ||
		conflicts != writersPerPayload {
		t.Fatalf(
			"inserts=%d replays=%d conflicts=%d",
			inserts,
			replays,
			conflicts,
		)
	}
	var rows int64
	if err := db.Model(&persistence.RecoveryRevisionModel{}).Count(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("recovery revision rows = %d", rows)
	}
}

func TestStoreRecoveryRevisionRejectsRevokedDeviceInsideTransaction(t *testing.T) {
	db, repository := openRepository(t)
	if err := db.Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where("ptid = ? AND device_id = ?", "ptid:alice", "alice-device").
		Update("revoked", true).Error; err != nil {
		t.Fatal(err)
	}

	candidate := revision(
		t,
		"revision-after-revoke",
		"ptid:alice",
		"alice-device",
		"opaque",
		time.Second,
	)
	if _, err := repository.StoreRecoveryRevision(
		context.Background(),
		candidate,
	); !domain.IsCode(err, domain.ErrorCodeUnauthorized) {
		t.Fatalf("post-revoke store error = %v", err)
	}

	var rows int64
	if err := db.Model(&persistence.RecoveryRevisionModel{}).
		Count(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatalf("post-revoke store persisted %d revisions", rows)
	}
}

func openRepository(t *testing.T) (*gorm.DB, *persistence.Repository) {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared&_busy_timeout=5000"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close recovery test database: %v", err)
		}
	})
	repository, err := persistence.NewRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&actoridentitypersistence.ActorDeviceModel{}); err != nil {
		t.Fatal(err)
	}
	for _, device := range []actoridentitypersistence.ActorDeviceModel{
		activeActorDevice("ptid:alice", "alice-device"),
		activeActorDevice("ptid:bob", "bob-device"),
	} {
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
	}
	return db, repository
}

func activeActorDevice(
	ptid string,
	deviceID string,
) actoridentitypersistence.ActorDeviceModel {
	return actoridentitypersistence.ActorDeviceModel{
		PTID:               ptid,
		ActorAccount:       ptid + "@example.test",
		ActorKind:          1,
		DeviceID:           deviceID,
		Label:              deviceID,
		HomeStationPeerID:  "station-local",
		SigningKeyID:       deviceID + "-signing-key",
		PublicKey:          make([]byte, 32),
		ProfileVersion:     1,
		VerificationSource: 1,
		CreatedAt:          time.Unix(1_700_000_000, 0).UTC(),
	}
}

func revision(
	t *testing.T,
	revisionID string,
	ptid string,
	deviceID string,
	archive string,
	createdOffset time.Duration,
) domain.Revision {
	t.Helper()
	policy, err := domain.NewArchivePolicy(1024)
	if err != nil {
		t.Fatal(err)
	}
	archiveBytes := []byte(archive)
	hash := sha256.Sum256(archiveBytes)
	result, err := domain.NewRevision(
		revisionID,
		ptid,
		1,
		archiveBytes,
		hash[:],
		deviceID,
		time.Unix(1_700_000_000, 0).Add(createdOffset),
		policy,
	)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
