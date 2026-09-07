package actor_identity

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	capabilityTestLocalStation  = "station-home"
	capabilityTestRemoteStation = "station-remote"
	capabilityTestRemoteActor   = "ptid:v1:actor:peers:p:remote:identity"
)

var capabilityTestTime = time.Date(
	2026,
	time.September,
	7,
	14,
	0,
	0,
	123456000,
	time.UTC,
)

type capabilityTestTransaction struct {
	db *gorm.DB
}

func (t capabilityTestTransaction) DB() *gorm.DB {
	return t.db
}

func (capabilityTestTransaction) Outbox() federationdelivery.OutboxWriter {
	return nil
}

type capabilityTestHydrator struct {
	keys  []*actormodel.VerifiedActorDeviceSigningKey
	err   error
	calls int
}

func (h *capabilityTestHydrator) Hydrate(
	_ context.Context,
	actorPTID string,
	claimedHomeStationPeerID string,
) ([]*actormodel.VerifiedActorDeviceSigningKey, error) {
	h.calls++
	if actorPTID != capabilityTestRemoteActor ||
		claimedHomeStationPeerID != capabilityTestRemoteStation {
		return nil, errors.New("unexpected Actor hydration binding")
	}
	if h.err != nil {
		return nil, h.err
	}

	return h.keys, nil
}

func TestActorCapabilitiesBuildSignedMonotonicEndpointManifest(t *testing.T) {
	database := openCapabilityTestDatabase(t)
	actorPrivateKey := ed25519.NewKeyFromSeed(
		bytes.Repeat([]byte{0x31}, ed25519.SeedSize),
	)
	actorPublicKey := actorPrivateKey.Public().(ed25519.PublicKey)
	actorFingerprint := sha256.Sum256(actorPublicKey)
	if err := database.Create(&persistence.ActorIdentityModel{
		PTID:           testActorPTID,
		PublicKey:      append([]byte(nil), actorPublicKey...),
		Fingerprint:    append([]byte(nil), actorFingerprint[:]...),
		ProfileVersion: 3,
		CreatedAt:      capabilityTestTime.Add(-time.Hour),
		UpdatedAt:      capabilityTestTime.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	firstDevicePublicKey := deterministicPublicKey(0x41)
	if err := database.Create(&persistence.ActorDeviceModel{
		PTID:               testActorPTID,
		ActorAccount:       "alice@example.test",
		ActorKind:          int32(actormodel.ActorKind_ACTOR_KIND_PERSON),
		DeviceID:           "alice-desktop",
		Label:              "Alice Desktop",
		HomeStationPeerID:  capabilityTestLocalStation,
		SigningKeyID:       signingKeyID(firstDevicePublicKey),
		PublicKey:          append([]byte(nil), firstDevicePublicKey...),
		ProfileVersion:     3,
		VerificationSource: int32(actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION),
		CreatedAt:          capabilityTestTime.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}

	stationPrivateKey := ed25519.NewKeyFromSeed(
		bytes.Repeat([]byte{0x51}, ed25519.SeedSize),
	)
	manifestService, err := application.NewEndpointManifestService(
		mustCapabilityRepository(t, database),
		application.EndpointManifestSignerFunc(func(
			_ context.Context,
			manifest *actormodel.ActorEndpointManifest,
		) error {
			return application.SignEndpointManifest(
				manifest,
				"station-signing-key",
				stationPrivateKey,
			)
		}),
		capabilityTestLocalStation,
		func() time.Time { return capabilityTestTime },
	)
	if err != nil {
		t.Fatal(err)
	}
	provider, err := newActorCapabilities(
		manifestService,
		capabilityTestLocalStation,
		func(*gorm.DB) (verifiedProfileDeviceKeyHydrator, error) {
			return nil, errors.New("remote hydration must not run")
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	subserver := &subServer{capabilities: provider}

	request := &actormodel.GetActorEndpointManifestRequest{
		Actor: &actormodel.ActorRef{
			Ptid: testActorPTID,
			Acct: "display-metadata-is-not-routing-truth@example.invalid",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
	}
	first, err := subserver.GetEndpointManifest(
		context.Background(),
		"station-requester",
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	assertEndpointManifest(
		t,
		first.GetManifest(),
		stationPrivateKey.Public().(ed25519.PublicKey),
		1,
		[]string{"alice-desktop"},
	)
	if first.GetManifest().GetActor().GetAcct() != "" {
		t.Fatalf(
			"manifest trusted peer-supplied display metadata: %q",
			first.GetManifest().GetActor().GetAcct(),
		)
	}

	replayed, err := subserver.GetEndpointManifest(
		context.Background(),
		"station-requester",
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.GetManifest().GetDirectoryVersion() != 1 ||
		replayed.GetManifest().GetManifestId() != first.GetManifest().GetManifestId() {
		t.Fatalf(
			"unchanged directory advanced: first=%+v replay=%+v",
			first.GetManifest(),
			replayed.GetManifest(),
		)
	}

	secondDevicePublicKey := deterministicPublicKey(0x42)
	if err := database.Create(&persistence.ActorDeviceModel{
		PTID:               testActorPTID,
		ActorAccount:       "alice@example.test",
		ActorKind:          int32(actormodel.ActorKind_ACTOR_KIND_PERSON),
		DeviceID:           "alice-mobile",
		Label:              "Alice Mobile",
		HomeStationPeerID:  capabilityTestLocalStation,
		SigningKeyID:       signingKeyID(secondDevicePublicKey),
		PublicKey:          append([]byte(nil), secondDevicePublicKey...),
		ProfileVersion:     3,
		VerificationSource: int32(actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION),
		CreatedAt:          capabilityTestTime.Add(-30 * time.Minute),
	}).Error; err != nil {
		t.Fatal(err)
	}
	advanced, err := subserver.GetEndpointManifest(
		context.Background(),
		"station-requester",
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	assertEndpointManifest(
		t,
		advanced.GetManifest(),
		stationPrivateKey.Public().(ed25519.PublicKey),
		2,
		[]string{"alice-desktop", "alice-mobile"},
	)
}

func TestActorCapabilitiesReturnRevokedLocalKeyForHistoricalVerification(t *testing.T) {
	database := openCapabilityTestDatabase(t)
	revokedAt := capabilityTestTime.Add(-time.Minute)
	devicePublicKey := deterministicPublicKey(0x61)
	if err := database.Create(&persistence.ActorDeviceModel{
		PTID:               testActorPTID,
		ActorAccount:       "alice@example.test",
		ActorKind:          int32(actormodel.ActorKind_ACTOR_KIND_PERSON),
		DeviceID:           testDeviceID,
		Label:              "Alice Desktop",
		HomeStationPeerID:  capabilityTestLocalStation,
		SigningKeyID:       signingKeyID(devicePublicKey),
		PublicKey:          append([]byte(nil), devicePublicKey...),
		ProfileVersion:     2,
		VerificationSource: int32(actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION),
		Revoked:            true,
		CreatedAt:          capabilityTestTime.Add(-time.Hour),
		RevokedAt:          &revokedAt,
	}).Error; err != nil {
		t.Fatal(err)
	}

	provider := newKeyOnlyCapabilityProvider(t, capabilityTestLocalStation, nil)
	subserver := &subServer{capabilities: provider}
	key, err := subserver.ResolveVerifiedActorDeviceSigningKey(
		context.Background(),
		capabilityTestTransaction{db: database},
		testActorPTID,
		testDeviceID,
		signingKeyID(devicePublicKey),
	)
	if err != nil {
		t.Fatal(err)
	}
	if key == nil ||
		key.GetVerificationSource() !=
			actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION ||
		key.GetRevokedAtUnixMs() != revokedAt.UnixMilli() ||
		!bytes.Equal(key.GetEd25519PublicKey(), devicePublicKey) {
		t.Fatalf("unexpected revoked key projection: %+v", key)
	}
}

func TestActorCapabilitiesHydrateRemoteKeyInsideCallerTransaction(t *testing.T) {
	database := openCapabilityTestDatabase(t)
	if err := database.Exec(`
		CREATE TABLE touch_actor (
			ptid TEXT PRIMARY KEY,
			home_station_peer_id TEXT NOT NULL,
			origin TEXT NOT NULL
		)
	`).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(
		`INSERT INTO touch_actor (ptid, home_station_peer_id, origin)
		 VALUES (?, ?, ?)`,
		capabilityTestRemoteActor,
		capabilityTestRemoteStation,
		"remote_cached",
	).Error; err != nil {
		t.Fatal(err)
	}

	devicePublicKey := deterministicPublicKey(0x71)
	key := &actormodel.VerifiedActorDeviceSigningKey{
		ActorPtid:          capabilityTestRemoteActor,
		ActorDeviceId:      "remote-device",
		HomeStationPeerId:  capabilityTestRemoteStation,
		SigningKeyId:       signingKeyID(devicePublicKey),
		Ed25519PublicKey:   append([]byte(nil), devicePublicKey...),
		ProfileVersion:     4,
		VerificationSource: actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
		ValidFromUnixMs:    capabilityTestTime.Add(-time.Hour).UnixMilli(),
	}
	hydrator := &capabilityTestHydrator{
		keys: []*actormodel.VerifiedActorDeviceSigningKey{key},
	}
	var factoryDatabase *gorm.DB
	provider := newKeyOnlyCapabilityProvider(
		t,
		capabilityTestLocalStation,
		func(db *gorm.DB) (verifiedProfileDeviceKeyHydrator, error) {
			factoryDatabase = db

			return hydrator, nil
		},
	)
	subserver := &subServer{capabilities: provider}
	rollback := errors.New("rollback Actor Identity projection")
	err := database.Transaction(func(transactionDB *gorm.DB) error {
		resolved, resolveErr := subserver.ResolveVerifiedActorDeviceSigningKey(
			context.Background(),
			capabilityTestTransaction{db: transactionDB},
			capabilityTestRemoteActor,
			key.GetActorDeviceId(),
			key.GetSigningKeyId(),
		)
		if resolveErr != nil {
			return resolveErr
		}
		if factoryDatabase != transactionDB {
			return errors.New("hydrator did not receive the caller transaction")
		}
		if resolved == nil ||
			!bytes.Equal(resolved.GetEd25519PublicKey(), key.GetEd25519PublicKey()) {
			return errors.New("hydrated key was not returned")
		}

		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("transaction result = %v, want rollback", err)
	}
	var count int64
	if err := database.Model(&persistence.ActorDeviceModel{}).
		Where("ptid = ?", capabilityTestRemoteActor).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("rolled-back hydration persisted %d device rows", count)
	}

	err = database.Transaction(func(transactionDB *gorm.DB) error {
		resolved, resolveErr := subserver.ResolveVerifiedActorDeviceSigningKey(
			context.Background(),
			capabilityTestTransaction{db: transactionDB},
			capabilityTestRemoteActor,
			key.GetActorDeviceId(),
			key.GetSigningKeyId(),
		)
		if resolveErr != nil {
			return resolveErr
		}
		if resolved == nil ||
			resolved.GetHomeStationPeerId() != capabilityTestRemoteStation ||
			resolved.GetVerificationSource() !=
				actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE {
			return fmt.Errorf("unexpected persisted key projection: %+v", resolved)
		}

		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if hydrator.calls != 2 {
		t.Fatalf("hydrator calls = %d, want 2", hydrator.calls)
	}
}

func TestActorCapabilitiesRevalidateRemoteProfileAndRejectMissingKey(t *testing.T) {
	database := openCapabilityTestDatabase(t)
	if err := database.Exec(`
		CREATE TABLE touch_actor (
			ptid TEXT PRIMARY KEY,
			home_station_peer_id TEXT NOT NULL,
			origin TEXT NOT NULL
		)
	`).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(
		`INSERT INTO touch_actor (ptid, home_station_peer_id, origin)
		 VALUES (?, ?, ?)`,
		capabilityTestRemoteActor,
		capabilityTestRemoteStation,
		"remote_cached",
	).Error; err != nil {
		t.Fatal(err)
	}

	hydrator := &capabilityTestHydrator{keys: []*actormodel.VerifiedActorDeviceSigningKey{}}
	provider := newKeyOnlyCapabilityProvider(
		t,
		capabilityTestLocalStation,
		func(*gorm.DB) (verifiedProfileDeviceKeyHydrator, error) {
			return hydrator, nil
		},
	)
	resolved, err := provider.ResolveVerifiedActorDeviceSigningKey(
		context.Background(),
		capabilityTestTransaction{db: database},
		capabilityTestRemoteActor,
		"missing-device",
		"missing-key",
	)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != nil {
		t.Fatalf("missing current profile key resolved as %+v", resolved)
	}
	if hydrator.calls != 1 {
		t.Fatalf("hydrator calls = %d, want 1", hydrator.calls)
	}
}

func openCapabilityTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()

	database, err := gorm.Open(
		sqlite.Open(
			"file:actor-identity-capabilities-"+uuid.NewString()+
				"?mode=memory&cache=shared&_busy_timeout=5000",
		),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if err := sqlDatabase.Close(); err != nil {
			t.Errorf("close Actor Identity capability database: %v", err)
		}
	})
	if err := mustCapabilityRepository(t, database).AutoMigrate(); err != nil {
		t.Fatal(err)
	}

	return database
}

func mustCapabilityRepository(
	t *testing.T,
	database *gorm.DB,
) *persistence.Repository {
	t.Helper()

	repository, err := persistence.NewRepository(database)
	if err != nil {
		t.Fatal(err)
	}

	return repository
}

func newKeyOnlyCapabilityProvider(
	t *testing.T,
	localStationPeerID string,
	hydratorFactory verifiedProfileDeviceKeyHydratorFactory,
) *actorCapabilities {
	t.Helper()

	if hydratorFactory == nil {
		hydratorFactory = func(*gorm.DB) (verifiedProfileDeviceKeyHydrator, error) {
			return nil, errors.New("remote hydration must not run")
		}
	}
	provider, err := newActorCapabilities(
		&application.EndpointManifestService{},
		localStationPeerID,
		hydratorFactory,
	)
	if err != nil {
		t.Fatal(err)
	}

	return provider
}

func assertEndpointManifest(
	t *testing.T,
	manifest *actormodel.ActorEndpointManifest,
	stationPublicKey ed25519.PublicKey,
	wantVersion uint64,
	wantDevices []string,
) {
	t.Helper()

	if manifest == nil {
		t.Fatal("endpoint manifest is nil")
	}
	if err := application.VerifyEndpointManifest(
		manifest,
		testActorPTID,
		capabilityTestLocalStation,
		"station-signing-key",
		stationPublicKey,
		capabilityTestTime,
	); err != nil {
		t.Fatal(err)
	}
	if manifest.GetDirectoryVersion() != wantVersion {
		t.Fatalf(
			"directory version = %d, want %d",
			manifest.GetDirectoryVersion(),
			wantVersion,
		)
	}
	if len(manifest.GetActiveEndpoints()) != len(wantDevices) {
		t.Fatalf(
			"active endpoints = %d, want %d",
			len(manifest.GetActiveEndpoints()),
			len(wantDevices),
		)
	}
	for index, deviceID := range wantDevices {
		entry := manifest.GetActiveEndpoints()[index]
		if entry.GetEndpoint().GetDeviceId() != deviceID {
			t.Fatalf(
				"endpoint[%d] = %q, want %q",
				index,
				entry.GetEndpoint().GetDeviceId(),
				deviceID,
			)
		}
		if len(entry.GetPublicMaterialSha256()) != 1 ||
			len(entry.GetPublicMaterialSha256()[0]) != sha256.Size {
			t.Fatalf("endpoint[%d] has invalid material hashes: %+v", index, entry)
		}
	}
}

func signingKeyID(publicKey ed25519.PublicKey) string {
	hash := sha256.Sum256(publicKey)

	return hex.EncodeToString(hash[:])
}

func deterministicPublicKey(seed byte) ed25519.PublicKey {
	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{seed}, ed25519.SeedSize))

	return privateKey.Public().(ed25519.PublicKey)
}
