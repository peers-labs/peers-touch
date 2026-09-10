package recovery

import (
	"context"
	"crypto/sha256"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/infrastructure/persistence"
	recoveryhttp "github.com/peers-labs/peers-touch/station/app/subserver/recovery/interface/http"
	recoverymodel "github.com/peers-labs/peers-touch/station/app/subserver/recovery/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type testOnlyComposition struct {
	DB          *gorm.DB
	Repository  *persistence.Repository
	Application *application.Service
	Contract    *recoveryhttp.ContractAdapter
}

type testAuthorization struct {
	actors  map[string]bool
	devices map[string]bool
}

func (a testAuthorization) IsActorAuthorizedForRecovery(
	_ context.Context,
	ptid string,
) (bool, error) {
	return a.actors[ptid], nil
}

func (a testAuthorization) IsDeviceAuthorizedForRecovery(
	_ context.Context,
	ptid string,
	deviceID string,
) (bool, error) {
	return a.devices[ptid+"\x00"+deviceID], nil
}

type advancingClock struct {
	mu   sync.Mutex
	next time.Time
}

func (c *advancingClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.next
	c.next = c.next.Add(time.Second)
	return now
}

func newTestOnlyComposition(
	t *testing.T,
	maxEncryptedArchiveBytes int,
) testOnlyComposition {
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
			t.Errorf("close Recovery composition database: %v", err)
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
	if err := db.Create(&actoridentitypersistence.ActorDeviceModel{
		PTID:               "ptid:alice",
		ActorAccount:       "alice@example.test",
		ActorKind:          1,
		DeviceID:           "alice-device",
		Label:              "Alice Device",
		HomeStationPeerID:  "station-local",
		SigningKeyID:       "alice-signing-key",
		PublicKey:          make([]byte, 32),
		ProfileVersion:     1,
		VerificationSource: 1,
		CreatedAt:          time.Unix(1_700_000_000, 0).UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	applicationService, err := application.NewService(
		repository,
		testAuthorization{
			actors: map[string]bool{
				"ptid:alice": true,
				"ptid:bob":   true,
			},
			devices: map[string]bool{
				"ptid:alice\x00alice-device": true,
			},
		},
		&advancingClock{next: time.Unix(1_700_000_000, 0).UTC()},
		maxEncryptedArchiveBytes,
	)
	if err != nil {
		t.Fatal(err)
	}
	contract, err := recoveryhttp.NewContractAdapter(applicationService)
	if err != nil {
		t.Fatal(err)
	}
	return testOnlyComposition{
		DB:          db,
		Repository:  repository,
		Application: applicationService,
		Contract:    contract,
	}
}

func TestCanonicalRecoveryContractsUseTestOnlyOwnerComposition(t *testing.T) {
	composition := newTestOnlyComposition(t, 1024)
	ctx := context.Background()
	alice := recoveryhttp.AuthenticatedActorDevice{
		PTID:     "ptid:alice",
		DeviceID: "alice-device",
	}
	firstRequest := storeRequest("revision-1", []byte{0x00, 0xff, 0x10})
	first, err := composition.Contract.StoreRecoveryRevision(ctx, alice, firstRequest)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := composition.Contract.StoreRecoveryRevision(ctx, alice, firstRequest)
	if err != nil {
		t.Fatal(err)
	}
	if first.GetRevisionId() != "revision-1" ||
		!first.GetCreatedAt().AsTime().Equal(replay.GetCreatedAt().AsTime()) {
		t.Fatalf("first=%+v replay=%+v", first, replay)
	}

	secondRequest := storeRequest("revision-2", []byte("opaque-latest"))
	if _, err := composition.Contract.StoreRecoveryRevision(
		ctx,
		alice,
		secondRequest,
	); err != nil {
		t.Fatal(err)
	}
	latest, err := composition.Contract.ReadLatestRecoveryRevision(
		ctx,
		alice,
		&recoverymodel.ReadLatestRecoveryRevisionRequest{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if latest.GetRevisionId() != "revision-2" ||
		string(latest.GetEncryptedArchive()) != "opaque-latest" {
		t.Fatalf("latest revision = %+v", latest)
	}
	latest.EncryptedArchive[0] ^= 0xff
	readAgain, err := composition.Contract.ReadLatestRecoveryRevision(
		ctx,
		alice,
		&recoverymodel.ReadLatestRecoveryRevisionRequest{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if string(readAgain.GetEncryptedArchive()) != "opaque-latest" {
		t.Fatal("response mutation changed persisted opaque archive")
	}

	conflict := storeRequest("revision-1", []byte("different"))
	if _, err := composition.Contract.StoreRecoveryRevision(
		ctx,
		alice,
		conflict,
	); !domain.IsCode(err, domain.ErrorCodeRevisionConflict) {
		t.Fatalf("conflict error = %v", err)
	}
	if _, err := composition.Contract.ReadLatestRecoveryRevision(
		ctx,
		recoveryhttp.AuthenticatedActorDevice{PTID: "ptid:bob"},
		&recoverymodel.ReadLatestRecoveryRevisionRequest{},
	); !domain.IsCode(err, domain.ErrorCodeRevisionNotFound) {
		t.Fatalf("actor-isolated latest error = %v", err)
	}
}

func TestRecoveryAdmissionFailsBeforeMutation(t *testing.T) {
	composition := newTestOnlyComposition(t, 8)
	ctx := context.Background()
	corruptAndOversize := storeRequest("revision-1", []byte("too-large"))
	corruptAndOversize.EncryptedArchiveSha256[0] ^= 0xff

	if _, err := composition.Contract.StoreRecoveryRevision(
		ctx,
		recoveryhttp.AuthenticatedActorDevice{
			PTID:     "ptid:alice",
			DeviceID: "revoked-device",
		},
		corruptAndOversize,
	); !domain.IsCode(err, domain.ErrorCodeUnauthorized) {
		t.Fatalf("unauthorized error = %v", err)
	}
	assertRevisionCount(t, composition.DB, 0)

	if _, err := composition.Contract.StoreRecoveryRevision(
		ctx,
		recoveryhttp.AuthenticatedActorDevice{
			PTID:     "ptid:alice",
			DeviceID: "alice-device",
		},
		corruptAndOversize,
	); !domain.IsCode(err, domain.ErrorCodeArchiveTooLarge) {
		t.Fatalf("bounded archive error = %v", err)
	}
	assertRevisionCount(t, composition.DB, 0)

	corrupt := storeRequest("revision-2", []byte("opaque"))
	corrupt.EncryptedArchiveSha256[0] ^= 0xff
	if _, err := composition.Contract.StoreRecoveryRevision(
		ctx,
		recoveryhttp.AuthenticatedActorDevice{
			PTID:     "ptid:alice",
			DeviceID: "alice-device",
		},
		corrupt,
	); !domain.IsCode(err, domain.ErrorCodeArchiveIntegrity) {
		t.Fatalf("archive integrity error = %v", err)
	}
	assertRevisionCount(t, composition.DB, 0)
}

func TestRecoveryStoreRechecksActiveDeviceInsideMutationTransaction(t *testing.T) {
	composition := newTestOnlyComposition(t, 1024)
	if err := composition.DB.Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where("ptid = ? AND device_id = ?", "ptid:alice", "alice-device").
		Update("revoked", true).Error; err != nil {
		t.Fatal(err)
	}

	_, err := composition.Contract.StoreRecoveryRevision(
		context.Background(),
		recoveryhttp.AuthenticatedActorDevice{
			PTID:     "ptid:alice",
			DeviceID: "alice-device",
		},
		storeRequest("revision-after-revoke", []byte("opaque")),
	)
	if !domain.IsCode(err, domain.ErrorCodeUnauthorized) {
		t.Fatalf("post-revoke store error = %v", err)
	}
	assertRevisionCount(t, composition.DB, 0)
}

func storeRequest(
	revisionID string,
	encryptedArchive []byte,
) *recoverymodel.StoreRecoveryRevisionRequest {
	hash := sha256.Sum256(encryptedArchive)
	return &recoverymodel.StoreRecoveryRevisionRequest{
		RevisionId:             revisionID,
		FormatVersion:          1,
		EncryptedArchive:       append([]byte(nil), encryptedArchive...),
		EncryptedArchiveSha256: hash[:],
	}
}

func assertRevisionCount(t *testing.T, db *gorm.DB, expected int64) {
	t.Helper()
	var count int64
	if err := db.Model(&persistence.RecoveryRevisionModel{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != expected {
		t.Fatalf("recovery revision rows = %d, want %d", count, expected)
	}
}
