package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"reflect"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type legacyFederatedMLSKeyPackageClaimModel struct {
	AuthorityStationID string    `gorm:"column:authority_station_id;primaryKey"`
	AuthorityPlanID    string    `gorm:"column:authority_plan_id;primaryKey"`
	TargetPTID         string    `gorm:"column:target_ptid;primaryKey"`
	TargetDeviceID     string    `gorm:"column:target_device_id;primaryKey"`
	HomeStationID      string    `gorm:"column:home_station_id;not null"`
	PackageID          string    `gorm:"column:package_id;not null"`
	KeyPackage         []byte    `gorm:"column:key_package;not null"`
	KeyPackageSHA256   []byte    `gorm:"column:key_package_sha256;not null"`
	PlanExpiresAt      time.Time `gorm:"column:plan_expires_at;not null"`
	ClaimedAt          time.Time `gorm:"column:claimed_at;not null"`
}

func (*legacyFederatedMLSKeyPackageClaimModel) TableName() string {
	return "federated_mls_key_package_claims"
}

type postgresStateError struct {
	code string
}

func (e postgresStateError) Error() string {
	return "postgres test error"
}

func (e postgresStateError) SQLState() string {
	return e.code
}

func TestMigrateReplacesEmptyLegacyFederatedClaimIdentity(t *testing.T) {
	db := openCanonicalStoreDatabase(t)
	if err := db.AutoMigrate(&legacyFederatedMLSKeyPackageClaimModel{}); err != nil {
		t.Fatalf("migrate legacy claim schema: %v", err)
	}
	store, err := NewCanonicalStore(db)
	if err != nil {
		t.Fatalf("create canonical store: %v", err)
	}

	if err := store.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate empty legacy claim schema: %v", err)
	}

	columnTypes, err := db.Migrator().ColumnTypes(
		&FederatedMLSKeyPackageClaimModel{},
	)
	if err != nil {
		t.Fatalf("inspect canonical claim schema: %v", err)
	}
	primary := map[string]bool{}
	for _, columnType := range columnTypes {
		if isPrimary, ok := columnType.PrimaryKey(); ok && isPrimary {
			primary[columnType.Name()] = true
		}
	}
	if len(primary) != 2 ||
		!primary["authority_station_id"] ||
		!primary["request_id"] {
		t.Fatalf("canonical claim primary key = %v", primary)
	}
}

func TestMigrateRejectsNonEmptyLegacyFederatedClaimIdentity(t *testing.T) {
	db := openCanonicalStoreDatabase(t)
	if err := db.AutoMigrate(&legacyFederatedMLSKeyPackageClaimModel{}); err != nil {
		t.Fatalf("migrate legacy claim schema: %v", err)
	}
	legacy := legacyFederatedMLSKeyPackageClaimModel{
		AuthorityStationID: "station-1",
		AuthorityPlanID:    "plan-1",
		TargetPTID:         "ptid:target",
		TargetDeviceID:     "device-1",
		HomeStationID:      "station-2",
		PackageID:          "package-1",
		KeyPackage:         []byte("package"),
		KeyPackageSHA256:   []byte("hash"),
		PlanExpiresAt:      time.Unix(1_800_000_000, 0).UTC(),
		ClaimedAt:          time.Unix(1_799_999_000, 0).UTC(),
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatalf("seed legacy claim: %v", err)
	}
	store, err := NewCanonicalStore(db)
	if err != nil {
		t.Fatalf("create canonical store: %v", err)
	}

	if err := store.Migrate(context.Background()); err == nil {
		t.Fatal("migration accepted a non-empty legacy claim schema")
	}
	var count int64
	if err := db.Model(&legacyFederatedMLSKeyPackageClaimModel{}).
		Count(&count).Error; err != nil {
		t.Fatalf("count preserved legacy claims: %v", err)
	}
	if count != 1 {
		t.Fatalf("legacy claim count = %d, want 1", count)
	}
}

func TestCanonicalDirectInventoryRequiresCompleteBundle(t *testing.T) {
	device := domain.Endpoint{
		ActorPTID: "ptid:missing-bundle",
		DeviceID:  "device-1",
	}
	store := newCanonicalStoreForTest(t, device)
	ctx := context.Background()

	if _, err := store.CountDirectOneTimePreKeys(ctx, device); !domain.IsCode(
		err,
		domain.ErrorCodeNotFound,
	) {
		t.Fatalf("missing bundle count error = %v", err)
	}
	if err := store.ReplenishDirectOneTimePreKeys(
		ctx,
		device,
		[]domain.DirectOneTimePreKey{{
			KeyID:     1,
			PublicKey: bytes.Repeat([]byte{31}, 32),
		}},
	); !domain.IsCode(err, domain.ErrorCodeNotFound) {
		t.Fatalf("missing bundle replenish error = %v", err)
	}

	if err := store.db.Create(&IdentityKeyModel{
		ActorPtid:         device.ActorPTID,
		DeviceID:          device.DeviceID,
		IdentityKeyPub:    bytes.Repeat([]byte{10}, 32),
		KeyFingerprint:    "identity",
		PublishedAtUnixMs: 1,
		SupportedVersions: "1",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := store.CountDirectOneTimePreKeys(ctx, device); !domain.IsCode(
		err,
		domain.ErrorCodeNotFound,
	) {
		t.Fatalf("bundle without signed pre-key count error = %v", err)
	}
}

func TestCanonicalDirectReplenishmentReplayDoesNotReactivateConsumedKey(t *testing.T) {
	device := domain.Endpoint{
		ActorPTID: "ptid:replenishment-replay",
		DeviceID:  "device-1",
	}
	store := newCanonicalStoreForTest(t, device)
	ctx := context.Background()
	now := time.Unix(1_800_000_000, 0).UTC()
	bundle := canonicalDirectBundle(device, 20)
	bundle.OneTimePreKeys = []domain.DirectOneTimePreKey{
		{KeyID: 1, PublicKey: bytes.Repeat([]byte{31}, 32)},
		{KeyID: 2, PublicKey: bytes.Repeat([]byte{32}, 32)},
	}
	if err := store.UploadDirectBundle(ctx, bundle, now); err != nil {
		t.Fatalf("upload Direct bundle: %v", err)
	}
	fetched, err := store.FetchDirectBundles(
		ctx,
		testDestructiveReadIdentity("consume-before-replenishment-replay", device),
		device.ActorPTID,
		[]string{device.DeviceID},
		now.Add(time.Second),
	)
	if err != nil {
		t.Fatalf("consume Direct one-time pre-key: %v", err)
	}
	if len(fetched) != 1 ||
		len(fetched[0].OneTimePreKeys) != 1 ||
		fetched[0].OneTimePreKeys[0].KeyID != 1 {
		t.Fatalf("unexpected consumed Direct bundle: %+v", fetched)
	}

	replenishment := []domain.DirectOneTimePreKey{
		{KeyID: 1, PublicKey: bytes.Repeat([]byte{31}, 32)},
		{KeyID: 3, PublicKey: bytes.Repeat([]byte{33}, 32)},
	}
	for attempt := range 2 {
		if err := store.ReplenishDirectOneTimePreKeys(
			ctx,
			device,
			replenishment,
		); err != nil {
			t.Fatalf("replay Direct replenishment attempt %d: %v", attempt+1, err)
		}
	}

	var consumed OneTimePreKeyModel
	if err := store.db.Where(
		"actor_ptid = ? AND device_id = ? AND opk_id = ?",
		device.ActorPTID,
		device.DeviceID,
		1,
	).First(&consumed).Error; err != nil {
		t.Fatalf("read consumed Direct one-time pre-key: %v", err)
	}
	if !consumed.Consumed {
		t.Fatal("replayed Direct replenishment reactivated a consumed one-time pre-key")
	}
	if count, err := store.CountDirectOneTimePreKeys(ctx, device); err != nil {
		t.Fatalf("count Direct one-time pre-keys after replay: %v", err)
	} else if count != 2 {
		t.Fatalf("available Direct one-time pre-key count = %d, want 2", count)
	}
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
		testDestructiveReadIdentity("direct-fetch", device),
		device.ActorPTID,
		[]string{device.DeviceID},
		now.Add(2*time.Second),
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
	for index := range 2 {
		wait.Add(1)
		go func(requestIndex int) {
			defer wait.Done()
			value, err := store.FetchDirectBundles(
				ctx,
				testDestructiveReadIdentity(
					"direct-concurrent-"+strconv.Itoa(requestIndex),
					device,
				),
				device.ActorPTID,
				[]string{device.DeviceID},
				now.Add(time.Second),
			)
			results <- value
			errorsChannel <- err
		}(index)
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

func TestCanonicalDirectFetchReplaysExactResponseAndRejectsHashConflict(t *testing.T) {
	device := domain.Endpoint{
		ActorPTID: "ptid:direct-replay",
		DeviceID:  "device-1",
	}
	store := newCanonicalStoreForTest(t, device)
	ctx := context.Background()
	now := time.Unix(1_800_000_000, 0).UTC()
	bundle := canonicalDirectBundle(device, 20)
	bundle.OneTimePreKeys = []domain.DirectOneTimePreKey{
		{KeyID: 1, PublicKey: bytes.Repeat([]byte{31}, 32)},
		{KeyID: 2, PublicKey: bytes.Repeat([]byte{32}, 32)},
	}
	if err := store.UploadDirectBundle(ctx, bundle, now); err != nil {
		t.Fatalf("upload Direct bundle: %v", err)
	}

	identity := testDestructiveReadIdentity("direct-replay-request", device)
	first, err := store.FetchDirectBundles(
		ctx,
		identity,
		device.ActorPTID,
		[]string{device.DeviceID},
		now.Add(time.Second),
	)
	if err != nil {
		t.Fatalf("first Direct fetch: %v", err)
	}
	replayed, err := store.FetchDirectBundles(
		ctx,
		identity,
		device.ActorPTID,
		[]string{device.DeviceID},
		now.Add(2*time.Second),
	)
	if err != nil {
		t.Fatalf("replay Direct fetch: %v", err)
	}
	if !reflect.DeepEqual(replayed, first) {
		t.Fatalf("Direct replay changed response: first=%+v replay=%+v", first, replayed)
	}
	if count, err := store.CountDirectOneTimePreKeys(ctx, device); err != nil {
		t.Fatalf("count Direct pre-keys after replay: %v", err)
	} else if count != 1 {
		t.Fatalf("Direct replay consumed another pre-key, count=%d", count)
	}

	conflicting := identity
	conflicting.RequestSHA256 = sha256.Sum256([]byte("different-request-bytes"))
	if _, err := store.FetchDirectBundles(
		ctx,
		conflicting,
		device.ActorPTID,
		[]string{device.DeviceID},
		now.Add(3*time.Second),
	); !domain.IsCode(err, domain.ErrorCodeConflict) {
		t.Fatalf("Direct request ID hash conflict error = %v", err)
	}
	if count, err := store.CountDirectOneTimePreKeys(ctx, device); err != nil {
		t.Fatalf("count Direct pre-keys after conflict: %v", err)
	} else if count != 1 {
		t.Fatalf("Direct hash conflict mutated pre-keys, count=%d", count)
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
	for index := range 2 {
		wait.Add(1)
		go func(requestIndex int) {
			defer wait.Done()
			value, err := store.FetchAndConsumeMLSKeyPackage(
				ctx,
				testDestructiveReadIdentity(
					"mls-concurrent-"+strconv.Itoa(requestIndex),
					device,
				),
				device.ActorPTID,
				[]string{device.DeviceID},
				"station-local",
				now.Add(time.Second),
			)
			results <- value
			errorsChannel <- err
		}(index)
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

func TestCanonicalMLSFetchReplaysExactResponseAndRejectsHashConflict(t *testing.T) {
	device := domain.Endpoint{
		ActorPTID: "ptid:mls-replay",
		DeviceID:  "device-1",
	}
	store := newCanonicalStoreForTest(t, device)
	ctx := context.Background()
	now := time.Unix(1_800_000_000, 0).UTC()
	for _, material := range [][]byte{
		[]byte("mls-replay-package-1"),
		[]byte("mls-replay-package-2"),
	} {
		if _, err := store.UploadMLSKeyPackage(
			ctx,
			device,
			"station-local",
			material,
			now,
		); err != nil {
			t.Fatalf("upload MLS KeyPackage: %v", err)
		}
	}

	identity := testDestructiveReadIdentity("mls-replay-request", device)
	first, err := store.FetchAndConsumeMLSKeyPackage(
		ctx,
		identity,
		device.ActorPTID,
		[]string{device.DeviceID},
		"station-local",
		now.Add(time.Second),
	)
	if err != nil {
		t.Fatalf("first MLS fetch: %v", err)
	}
	replayed, err := store.FetchAndConsumeMLSKeyPackage(
		ctx,
		identity,
		device.ActorPTID,
		[]string{device.DeviceID},
		"station-local",
		now.Add(2*time.Second),
	)
	if err != nil {
		t.Fatalf("replay MLS fetch: %v", err)
	}
	if replayed == nil ||
		first == nil ||
		replayed.PackageID != first.PackageID ||
		replayed.Device != first.Device ||
		replayed.HomeStation != first.HomeStation ||
		replayed.PackageHash != first.PackageHash ||
		!bytes.Equal(replayed.KeyPackage, first.KeyPackage) {
		t.Fatalf("MLS replay changed response: first=%+v replay=%+v", first, replayed)
	}
	if count, err := store.CountMLSKeyPackages(ctx, device); err != nil {
		t.Fatalf("count MLS packages after replay: %v", err)
	} else if count != 1 {
		t.Fatalf("MLS replay consumed another package, count=%d", count)
	}

	conflicting := identity
	conflicting.RequestSHA256 = sha256.Sum256([]byte("different-request-bytes"))
	if _, err := store.FetchAndConsumeMLSKeyPackage(
		ctx,
		conflicting,
		device.ActorPTID,
		[]string{device.DeviceID},
		"station-local",
		now.Add(3*time.Second),
	); !domain.IsCode(err, domain.ErrorCodeConflict) {
		t.Fatalf("MLS request ID hash conflict error = %v", err)
	}
	if count, err := store.CountMLSKeyPackages(ctx, device); err != nil {
		t.Fatalf("count MLS packages after conflict: %v", err)
	} else if count != 1 {
		t.Fatalf("MLS hash conflict mutated packages, count=%d", count)
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
		RequestID:                     "claim-request",
		RequestSHA256:                 sha256.Sum256([]byte("claim-request-v1")),
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
	conflicting.RequestSHA256 = sha256.Sum256([]byte("claim-request-v2"))
	if _, err := store.ClaimMLSKeyPackageIrreversibly(
		ctx,
		conflicting,
		"station-local",
		now,
	); !domain.IsCode(err, domain.ErrorCodeConflict) {
		t.Fatalf("same identity with conflicting claim error = %v", err)
	}

	different := claim
	different.RequestID = "different-claim-request"
	different.RequestSHA256 = sha256.Sum256([]byte("different-claim-request"))
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
		testDestructiveReadIdentity("direct-after-revoke", device),
		device.ActorPTID,
		[]string{device.DeviceID},
		now.Add(2*time.Second),
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
		testDestructiveReadIdentity("mls-after-revoke", device),
		device.ActorPTID,
		[]string{device.DeviceID},
		"station-local",
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
			RequestID:                     "claim-after-revoke-request",
			RequestSHA256: sha256.Sum256(
				[]byte("claim-after-revoke-request"),
			),
			AuthorityPlanID:    "claim-after-revoke",
			AuthorityStationID: "station-authority",
			Target:             device,
			PlanExpiresAt:      now.Add(time.Minute),
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
	db := openCanonicalStoreDatabase(t)
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

func openCanonicalStoreDatabase(t *testing.T) *gorm.DB {
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
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close canonical store SQL database: %v", err)
		}
	})
	return db
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

func testDestructiveReadIdentity(
	requestID string,
	requester domain.Endpoint,
) domain.DestructiveReadIdentity {
	return domain.DestructiveReadIdentity{
		RequestID:     requestID,
		Requester:     requester,
		RequestSHA256: sha256.Sum256([]byte(requestID)),
	}
}
