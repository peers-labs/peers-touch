package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type postgresStateError struct {
	code string
}

func (e postgresStateError) Error() string {
	return "postgres test error"
}

func (e postgresStateError) SQLState() string {
	return e.code
}

func TestCanonicalDirectUploadRollsBackOnConflictingOneTimeKey(t *testing.T) {
	device := domain.Endpoint{
		ActorPTID: "ptid:rollback",
		DeviceID:  "device-1",
	}
	store := newCanonicalStoreForTest(t, device)
	ctx := context.Background()
	now := time.Unix(1_800_000_000, 0).UTC()
	initial := canonicalDirectBundle(device, 20)
	initial.OneTimePreKeys = []domain.DirectOneTimePreKey{{
		KeyID:     1,
		PublicKey: bytes.Repeat([]byte{31}, 32),
	}}
	if err := store.UploadDirectBundle(ctx, initial, now); err != nil {
		t.Fatalf("upload initial Direct bundle: %v", err)
	}

	conflicting := canonicalDirectBundle(device, 21)
	conflicting.OneTimePreKeys = []domain.DirectOneTimePreKey{
		{
			KeyID:     2,
			PublicKey: bytes.Repeat([]byte{32}, 32),
		},
		{
			KeyID:     1,
			PublicKey: bytes.Repeat([]byte{99}, 32),
		},
	}
	err := store.UploadDirectBundle(ctx, conflicting, now.Add(time.Second))
	if !domain.IsCode(err, domain.ErrorCodeConflict) {
		t.Fatalf("conflicting Direct upload error = %v", err)
	}
	count, err := store.CountDirectOneTimePreKeys(ctx, device)
	if err != nil {
		t.Fatalf("count Direct one-time pre-keys: %v", err)
	}
	if count != 1 {
		t.Fatalf("rolled-back Direct OPK count = %d, want 1", count)
	}
	bundles, err := store.FetchDirectBundles(
		ctx,
		device.ActorPTID,
		[]string{device.DeviceID},
	)
	if err != nil {
		t.Fatalf("fetch Direct bundle: %v", err)
	}
	if len(bundles) != 1 ||
		bundles[0].SignedPreKeyID != initial.SignedPreKeyID ||
		len(bundles[0].OneTimePreKeys) != 1 ||
		bundles[0].OneTimePreKeys[0].KeyID != 1 {
		t.Fatalf("Direct transaction was partially applied: %+v", bundles)
	}
}

func TestCanonicalDirectConcurrentFetchConsumesOneTimeKeyOnce(t *testing.T) {
	device := domain.Endpoint{
		ActorPTID: "ptid:direct-concurrent",
		DeviceID:  "device-1",
	}
	store := newCanonicalStoreForTest(t, device)
	ctx := context.Background()
	now := time.Unix(1_800_000_000, 0).UTC()
	bundle := canonicalDirectBundle(device, 20)
	bundle.OneTimePreKeys = []domain.DirectOneTimePreKey{{
		KeyID:     1,
		PublicKey: bytes.Repeat([]byte{31}, 32),
	}}
	if err := store.UploadDirectBundle(ctx, bundle, now); err != nil {
		t.Fatalf("upload Direct bundle: %v", err)
	}

	results := make(chan []domain.DirectKeyBundle, 2)
	errorsChannel := make(chan error, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			value, err := store.FetchDirectBundles(
				ctx,
				device.ActorPTID,
				[]string{device.DeviceID},
			)
			results <- value
			errorsChannel <- err
		}()
	}
	wait.Wait()
	close(results)
	close(errorsChannel)

	for err := range errorsChannel {
		if err != nil {
			t.Fatalf("concurrent Direct fetch: %v", err)
		}
	}
	consumed := 0
	for bundles := range results {
		if len(bundles) != 1 {
			t.Fatalf("Direct bundle count = %d, want 1", len(bundles))
		}
		consumed += len(bundles[0].OneTimePreKeys)
	}
	if consumed != 1 {
		t.Fatalf("concurrent Direct fetch returned one-time material %d times, want 1", consumed)
	}
}

func TestCanonicalMLSConcurrentFetchConsumesPackageOnce(t *testing.T) {
	device := domain.Endpoint{
		ActorPTID: "ptid:concurrent",
		DeviceID:  "device-1",
	}
	store := newCanonicalStoreForTest(t, device)
	ctx := context.Background()
	now := time.Unix(1_800_000_000, 0).UTC()
	material := []byte("one-time-mls-key-package")
	if _, err := store.UploadMLSKeyPackage(
		ctx,
		device,
		"station-local",
		material,
		now,
	); err != nil {
		t.Fatalf("upload MLS KeyPackage: %v", err)
	}

	results := make(chan *domain.MLSKeyPackage, 2)
	errorsChannel := make(chan error, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			value, err := store.FetchAndConsumeMLSKeyPackage(
				ctx,
				device.ActorPTID,
				[]string{device.DeviceID},
				now.Add(time.Second),
			)
			results <- value
			errorsChannel <- err
		}()
	}
	wait.Wait()
	close(results)
	close(errorsChannel)

	for err := range errorsChannel {
		if err != nil {
			t.Fatalf("concurrent MLS fetch: %v", err)
		}
	}
	consumed := 0
	for value := range results {
		if value != nil {
			consumed++
			if !bytes.Equal(value.KeyPackage, material) {
				t.Fatalf("consumed MLS bytes = %q", value.KeyPackage)
			}
		}
	}
	if consumed != 1 {
		t.Fatalf("concurrent MLS fetch returned material %d times, want 1", consumed)
	}

	_, err := store.UploadMLSKeyPackage(
		ctx,
		device,
		"station-local",
		material,
		now.Add(2*time.Second),
	)
	if !domain.IsCode(err, domain.ErrorCodeStaleMaterial) {
		t.Fatalf("republish consumed MLS package error = %v", err)
	}
}

func TestConcurrentMLSReserveReplaysPersistedWinner(t *testing.T) {
	device := domain.Endpoint{
		ActorPTID: "ptid:reserve-race",
		DeviceID:  "device-1",
	}
	store := newCanonicalStoreForTest(t, device)
	ctx := context.Background()
	now := time.Unix(1_800_000_000, 0).UTC()
	expiresAt := now.Add(time.Minute)
	for _, material := range [][]byte{
		[]byte("reserve-race-package-1"),
		[]byte("reserve-race-package-2"),
	} {
		if _, err := store.UploadMLSKeyPackage(
			ctx,
			device,
			"station-local",
			material,
			now,
		); err != nil {
			t.Fatal(err)
		}
	}

	results := make(chan domain.MLSKeyPackageReservation, 2)
	errorsChannel := make(chan error, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()

			result, err := store.ReserveMLSKeyPackage(
				ctx,
				"same-plan",
				device,
				"station-local",
				now,
				expiresAt,
			)
			results <- result
			errorsChannel <- err
		}()
	}
	wait.Wait()
	close(results)
	close(errorsChannel)

	for err := range errorsChannel {
		if err != nil {
			t.Fatalf("concurrent reserve: %v", err)
		}
	}
	var winner domain.MLSKeyPackageReservation
	for result := range results {
		if winner.PackageID == "" {
			winner = result
			continue
		}
		if result.PackageID != winner.PackageID ||
			result.PackageHash != winner.PackageHash ||
			!bytes.Equal(result.KeyPackage, winner.KeyPackage) {
			t.Fatalf("same-plan race returned different winners: %+v / %+v", winner, result)
		}
	}
	reconciled, err := store.reconcileMLSReservation(
		ctx,
		"same-plan",
		device,
		"station-local",
		now,
		expiresAt,
	)
	if err != nil ||
		reconciled.PackageID != winner.PackageID ||
		reconciled.PackageHash != winner.PackageHash {
		t.Fatalf("post-contention reservation reconciliation = %+v, err=%v", reconciled, err)
	}

	if _, err := store.ReserveMLSKeyPackage(
		ctx,
		"same-plan",
		device,
		"station-local",
		now,
		expiresAt.Add(time.Second),
	); !domain.IsCode(err, domain.ErrorCodeConflict) {
		t.Fatalf("conflicting reservation replay error = %v", err)
	}

	singlePackageStore := newCanonicalStoreForTest(t, device)
	if _, err := singlePackageStore.UploadMLSKeyPackage(
		ctx,
		device,
		"station-local",
		[]byte("single-reservation-package"),
		now,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := singlePackageStore.ReserveMLSKeyPackage(
		ctx,
		"winning-plan",
		device,
		"station-local",
		now,
		expiresAt,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := singlePackageStore.ReserveMLSKeyPackage(
		ctx,
		"different-plan",
		device,
		"station-local",
		now,
		expiresAt,
	); !domain.IsCode(err, domain.ErrorCodeStaleMaterial) {
		t.Fatalf("different reservation race error = %v", err)
	}
}

func TestConcurrentFederatedMLSClaimReplaysReceiptAndTypesConflicts(t *testing.T) {
	device := domain.Endpoint{
		ActorPTID: "ptid:claim-race",
		DeviceID:  "device-1",
	}
	store := newCanonicalStoreForTest(t, device)
	ctx := context.Background()
	now := time.Unix(1_800_000_000, 0).UTC()
	if _, err := store.UploadMLSKeyPackage(
		ctx,
		device,
		"station-local",
		[]byte("claim-race-package"),
		now,
	); err != nil {
		t.Fatal(err)
	}
	claim := domain.MLSKeyPackageClaim{
		AuthenticatedAuthorityStation: "station-authority",
		AuthorityPlanID:               "same-claim",
		AuthorityStationID:            "station-authority",
		Target:                        device,
		PlanExpiresAt:                 now.Add(time.Minute),
	}

	results := make(chan domain.MLSKeyPackageReservation, 2)
	errorsChannel := make(chan error, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()

			result, err := store.ClaimMLSKeyPackageIrreversibly(
				ctx,
				claim,
				"station-local",
				now,
			)
			results <- result
			errorsChannel <- err
		}()
	}
	wait.Wait()
	close(results)
	close(errorsChannel)

	for err := range errorsChannel {
		if err != nil {
			t.Fatalf("concurrent federated claim: %v", err)
		}
	}
	var winner domain.MLSKeyPackageReservation
	for result := range results {
		if winner.PackageID == "" {
			winner = result
			continue
		}
		if result.PackageID != winner.PackageID ||
			result.PackageHash != winner.PackageHash ||
			!bytes.Equal(result.KeyPackage, winner.KeyPackage) {
			t.Fatalf("same-claim race returned different receipts: %+v / %+v", winner, result)
		}
	}
	reconciled, err := store.reconcileFederatedMLSClaim(
		ctx,
		claim,
		"station-local",
	)
	if err != nil ||
		reconciled.PackageID != winner.PackageID ||
		reconciled.PackageHash != winner.PackageHash {
		t.Fatalf("post-contention claim reconciliation = %+v, err=%v", reconciled, err)
	}

	conflicting := claim
	conflicting.PlanExpiresAt = claim.PlanExpiresAt.Add(time.Second)
	if _, err := store.ClaimMLSKeyPackageIrreversibly(
		ctx,
		conflicting,
		"station-local",
		now,
	); !domain.IsCode(err, domain.ErrorCodeConflict) {
		t.Fatalf("same identity with conflicting claim error = %v", err)
	}

	different := claim
	different.AuthorityPlanID = "different-claim"
	if _, err := store.ClaimMLSKeyPackageIrreversibly(
		ctx,
		different,
		"station-local",
		now,
	); !domain.IsCode(err, domain.ErrorCodeStaleMaterial) {
		t.Fatalf("different claim race error = %v", err)
	}
}

func TestMLSContentionRecognizesPostgresAndCASTransitions(t *testing.T) {
	for _, err := range []error{
		errMLSStateContended,
		gorm.ErrDuplicatedKey,
		postgresStateError{code: "23505"},
		errors.Join(
			errors.New("wrapped persistence failure"),
			postgresStateError{code: "40001"},
		),
	} {
		if !isMLSStateContention(err) {
			t.Fatalf("contention error was not recognized: %v", err)
		}
	}
	if isMLSStateContention(postgresStateError{code: "22000"}) {
		t.Fatal("non-contention PostgreSQL error was accepted")
	}
}

func TestKeyMaterialMutationsReauthorizeInsideTransactions(t *testing.T) {
	device := domain.Endpoint{
		ActorPTID: "ptid:revoked-key-owner",
		DeviceID:  "device-1",
	}
	store := newCanonicalStoreForTest(t, device)
	ctx := context.Background()
	now := time.Unix(1_800_000_000, 0).UTC()
	bundle := canonicalDirectBundle(device, 20)
	bundle.OneTimePreKeys = []domain.DirectOneTimePreKey{{
		KeyID:     1,
		PublicKey: bytes.Repeat([]byte{31}, 32),
	}}
	if err := store.UploadDirectBundle(ctx, bundle, now); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UploadMLSKeyPackage(
		ctx,
		device,
		"station-local",
		[]byte("reserved-before-revoke"),
		now,
	); err != nil {
		t.Fatal(err)
	}
	reservation, err := store.ReserveMLSKeyPackage(
		ctx,
		"plan-before-revoke",
		device,
		"station-local",
		now,
		now.Add(time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UploadMLSKeyPackage(
		ctx,
		device,
		"station-local",
		[]byte("available-before-revoke"),
		now.Add(time.Second),
	); err != nil {
		t.Fatal(err)
	}
	if err := store.db.Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where("ptid = ? AND device_id = ?", device.ActorPTID, device.DeviceID).
		Update("revoked", true).Error; err != nil {
		t.Fatal(err)
	}

	assertUnauthorized := func(name string, err error) {
		t.Helper()
		if !domain.IsCode(err, domain.ErrorCodeUnauthorized) {
			t.Fatalf("%s error = %v", name, err)
		}
	}
	assertUnauthorized(
		"upload Direct",
		store.UploadDirectBundle(ctx, bundle, now.Add(2*time.Second)),
	)
	assertUnauthorized(
		"replenish Direct",
		store.ReplenishDirectOneTimePreKeys(
			ctx,
			device,
			[]domain.DirectOneTimePreKey{{
				KeyID:     2,
				PublicKey: bytes.Repeat([]byte{32}, 32),
			}},
		),
	)
	_, err = store.FetchDirectBundles(
		ctx,
		device.ActorPTID,
		[]string{device.DeviceID},
	)
	assertUnauthorized("fetch Direct", err)
	_, err = store.UploadMLSKeyPackage(
		ctx,
		device,
		"station-local",
		[]byte("upload-after-revoke"),
		now.Add(2*time.Second),
	)
	assertUnauthorized("upload MLS", err)
	_, err = store.FetchAndConsumeMLSKeyPackage(
		ctx,
		device.ActorPTID,
		[]string{device.DeviceID},
		now.Add(2*time.Second),
	)
	assertUnauthorized("fetch MLS", err)
	_, err = store.ReserveMLSKeyPackage(
		ctx,
		"plan-after-revoke",
		device,
		"station-local",
		now.Add(2*time.Second),
		now.Add(3*time.Minute),
	)
	assertUnauthorized("reserve MLS", err)
	assertUnauthorized(
		"consume MLS",
		store.ConsumeMLSKeyPackages(
			ctx,
			[]domain.MLSKeyPackageReservation{reservation},
			now.Add(2*time.Second),
		),
	)
	assertUnauthorized(
		"release MLS",
		store.ReleaseMLSKeyPackages(
			ctx,
			[]domain.MLSKeyPackageReservation{reservation},
			now.Add(2*time.Second),
		),
	)
	_, err = store.ClaimMLSKeyPackageIrreversibly(
		ctx,
		domain.MLSKeyPackageClaim{
			AuthenticatedAuthorityStation: "station-authority",
			AuthorityPlanID:               "claim-after-revoke",
			AuthorityStationID:            "station-authority",
			Target:                        device,
			PlanExpiresAt:                 now.Add(time.Minute),
		},
		"station-local",
		now,
	)
	assertUnauthorized("claim MLS", err)
}

func newCanonicalStoreForTest(
	t *testing.T,
	devices ...domain.Endpoint,
) *CanonicalStore {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open(
			"file:key-exchange-store-"+uuid.NewString()+
				"?mode=memory&cache=shared&_busy_timeout=5000",
		),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open canonical store database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open canonical store SQL database: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	store, err := NewCanonicalStore(db)
	if err != nil {
		t.Fatalf("create canonical store: %v", err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate canonical store schema: %v", err)
	}
	if err := db.AutoMigrate(&actoridentitypersistence.ActorDeviceModel{}); err != nil {
		t.Fatalf("migrate actor device authorization table: %v", err)
	}
	for _, device := range devices {
		if err := db.Create(&actoridentitypersistence.ActorDeviceModel{
			PTID:               device.ActorPTID,
			ActorAccount:       device.ActorPTID + "@example.test",
			ActorKind:          1,
			DeviceID:           device.DeviceID,
			Label:              device.DeviceID,
			HomeStationPeerID:  "station-local",
			SigningKeyID:       device.DeviceID + "-signing-key",
			PublicKey:          make([]byte, 32),
			ProfileVersion:     1,
			VerificationSource: 1,
			CreatedAt:          time.Unix(1_800_000_000, 0).UTC(),
		}).Error; err != nil {
			t.Fatalf("seed active actor device: %v", err)
		}
	}
	return store
}

func canonicalDirectBundle(
	device domain.Endpoint,
	signedPreKeyID int32,
) domain.DirectKeyBundle {
	return domain.DirectKeyBundle{
		Device:                device,
		IdentityKeyPublic:     bytes.Repeat([]byte{10}, 32),
		SignedPreKeyID:        signedPreKeyID,
		SignedPreKeyPublic:    bytes.Repeat([]byte{20}, 32),
		SignedPreKeySignature: bytes.Repeat([]byte{21}, 64),
		SupportedWireVersions: []uint32{0, 1},
	}
}
