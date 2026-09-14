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
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
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
		mustCapabilityRepository(t, database),
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
	if err := subserver.AcceptVerifiedEndpointManifest(
		context.Background(),
		advanced.GetManifest(),
	); err != nil {
		t.Fatalf("accept current endpoint manifest: %v", err)
	}
	if err := subserver.AcceptVerifiedEndpointManifest(
		context.Background(),
		first.GetManifest(),
	); !domain.IsCode(err, domain.ErrorCodeIdentityConflict) {
		t.Fatalf("endpoint manifest rollback error = %v", err)
	}
}

func TestActorCapabilitiesAcceptVerifiedEndpointManifestPersistsIdentityAtomically(
	t *testing.T,
) {
	database := openCapabilityTestDatabase(t)
	repository := mustCapabilityRepository(t, database)
	manifestService, err := application.NewEndpointManifestService(
		repository,
		application.EndpointManifestSignerFunc(func(
			context.Context,
			*actormodel.ActorEndpointManifest,
		) error {
			return nil
		}),
		capabilityTestLocalStation,
		func() time.Time { return capabilityTestTime },
	)
	if err != nil {
		t.Fatal(err)
	}
	provider, err := newActorCapabilities(
		manifestService,
		repository,
		capabilityTestLocalStation,
		func(*gorm.DB) (verifiedProfileDeviceKeyHydrator, error) {
			return nil, errors.New("remote hydration must not run")
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	actorIdentityPublicKey := deterministicPublicKey(0x81)
	first := verifiedRemoteEndpointManifest(
		capabilityTestRemoteActor,
		"remote-device",
		actorIdentityPublicKey,
		1,
		4,
	)
	if err := provider.AcceptVerifiedEndpointManifest(
		context.Background(),
		first,
	); err != nil {
		t.Fatalf("accept first remote endpoint manifest: %v", err)
	}
	assertAcceptedManifestIdentity(
		t,
		database,
		capabilityTestRemoteActor,
		actorIdentityPublicKey,
		4,
		1,
	)
	if err := provider.AcceptVerifiedEndpointManifest(
		context.Background(),
		first,
	); err != nil {
		t.Fatalf("replay remote endpoint manifest: %v", err)
	}

	stale := verifiedRemoteEndpointManifest(
		capabilityTestRemoteActor,
		"remote-device",
		actorIdentityPublicKey,
		2,
		3,
	)
	if err := provider.AcceptVerifiedEndpointManifest(
		context.Background(),
		stale,
	); !domain.IsCode(err, domain.ErrorCodeStaleProfileVersion) {
		t.Fatalf("stale profile version error = %v", err)
	}
	assertAcceptedManifestIdentity(
		t,
		database,
		capabilityTestRemoteActor,
		actorIdentityPublicKey,
		4,
		1,
	)

	conflictingKey := verifiedRemoteEndpointManifest(
		capabilityTestRemoteActor,
		"remote-device",
		deterministicPublicKey(0x82),
		2,
		5,
	)
	if err := provider.AcceptVerifiedEndpointManifest(
		context.Background(),
		conflictingKey,
	); !domain.IsCode(err, domain.ErrorCodeIdentityConflict) {
		t.Fatalf("identity-key conflict error = %v", err)
	}
	assertAcceptedManifestIdentity(
		t,
		database,
		capabilityTestRemoteActor,
		actorIdentityPublicKey,
		4,
		1,
	)

	advanced := verifiedRemoteEndpointManifest(
		capabilityTestRemoteActor,
		"remote-device",
		actorIdentityPublicKey,
		2,
		5,
	)
	if err := provider.AcceptVerifiedEndpointManifest(
		context.Background(),
		advanced,
	); err != nil {
		t.Fatalf("advance remote endpoint manifest: %v", err)
	}
	assertAcceptedManifestIdentity(
		t,
		database,
		capabilityTestRemoteActor,
		actorIdentityPublicKey,
		5,
		2,
	)
}

func TestActorCapabilitiesRejectManifestAtomicallyWithIdentityProjection(
	t *testing.T,
) {
	database := openCapabilityTestDatabase(t)
	repository := mustCapabilityRepository(t, database)
	manifestService, err := application.NewEndpointManifestService(
		repository,
		application.EndpointManifestSignerFunc(func(
			context.Context,
			*actormodel.ActorEndpointManifest,
		) error {
			return nil
		}),
		capabilityTestLocalStation,
		func() time.Time { return capabilityTestTime },
	)
	if err != nil {
		t.Fatal(err)
	}
	provider, err := newActorCapabilities(
		manifestService,
		repository,
		capabilityTestLocalStation,
		func(*gorm.DB) (verifiedProfileDeviceKeyHydrator, error) {
			return nil, errors.New("remote hydration must not run")
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	actorPTID := "ptid:v1:actor:peers:p:remote-rollback:identity"
	if err := database.Create(&persistence.ActorEndpointDirectoryVersionModel{
		ActorPTID:   actorPTID,
		Version:     1,
		StateSHA256: bytes.Repeat([]byte{0x91}, sha256.Size),
		UpdatedAt:   capabilityTestTime.Add(-time.Minute),
	}).Error; err != nil {
		t.Fatal(err)
	}

	manifest := verifiedRemoteEndpointManifest(
		actorPTID,
		"remote-device",
		deterministicPublicKey(0x83),
		1,
		1,
	)
	if err := provider.AcceptVerifiedEndpointManifest(
		context.Background(),
		manifest,
	); !domain.IsCode(err, domain.ErrorCodeIdentityConflict) {
		t.Fatalf("directory conflict error = %v", err)
	}

	var identityCount int64
	if err := database.Model(&persistence.ActorIdentityModel{}).
		Where("ptid = ?", actorPTID).
		Count(&identityCount).Error; err != nil {
		t.Fatal(err)
	}
	if identityCount != 0 {
		t.Fatalf(
			"rejected manifest persisted %d Actor identity rows",
			identityCount,
		)
	}
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

func TestActorCapabilitiesReturnRetainedRemoteKeyWithoutHydration(t *testing.T) {
	database := openCapabilityTestDatabase(t)
	revokedAt := capabilityTestTime.Add(-time.Minute)
	devicePublicKey := deterministicPublicKey(0x62)
	if err := database.Create(&persistence.ActorDeviceModel{
		PTID:               capabilityTestRemoteActor,
		ActorAccount:       "remote@example.test",
		ActorKind:          int32(actormodel.ActorKind_ACTOR_KIND_PERSON),
		DeviceID:           testDeviceID,
		Label:              "Remote Desktop",
		HomeStationPeerID:  capabilityTestRemoteStation,
		SigningKeyID:       signingKeyID(devicePublicKey),
		PublicKey:          append([]byte(nil), devicePublicKey...),
		ProfileVersion:     2,
		VerificationSource: int32(actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE),
		Revoked:            true,
		CreatedAt:          capabilityTestTime.Add(-time.Hour),
		RevokedAt:          &revokedAt,
	}).Error; err != nil {
		t.Fatal(err)
	}

	provider := newKeyOnlyCapabilityProvider(t, capabilityTestLocalStation, nil)
	subserver := &subServer{capabilities: provider}
	key, err := subserver.ResolveRetainedActorDeviceSigningKey(
		context.Background(),
		capabilityTestTransaction{db: database},
		capabilityTestRemoteActor,
		testDeviceID,
		signingKeyID(devicePublicKey),
	)
	if err != nil {
		t.Fatal(err)
	}
	if key == nil ||
		key.GetVerificationSource() !=
			actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE ||
		key.GetRevokedAtUnixMs() != revokedAt.UnixMilli() ||
		!bytes.Equal(key.GetEd25519PublicKey(), devicePublicKey) {
		t.Fatalf("unexpected retained remote key projection: %+v", key)
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

func TestActorCapabilitiesResolveActorHomeStation(t *testing.T) {
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
	repository := mustCapabilityRepository(t, database)
	provider, err := newActorCapabilities(
		&application.EndpointManifestService{},
		repository,
		capabilityTestLocalStation,
		func(*gorm.DB) (verifiedProfileDeviceKeyHydrator, error) {
			return nil, errors.New("remote hydration must not run")
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	homeStation, err := provider.ResolveActorHomeStationPeerID(
		context.Background(),
		capabilityTestRemoteActor,
	)
	if err != nil {
		t.Fatal(err)
	}
	if homeStation != capabilityTestRemoteStation {
		t.Fatalf(
			"Home Station = %q, want %q",
			homeStation,
			capabilityTestRemoteStation,
		)
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
		mustCapabilityRepository(t, openCapabilityTestDatabase(t)),
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

func verifiedRemoteEndpointManifest(
	actorPTID string,
	deviceID string,
	actorIdentityPublicKey ed25519.PublicKey,
	directoryVersion uint64,
	profileVersion uint64,
) *actormodel.ActorEndpointManifest {
	devicePublicKey := deterministicPublicKey(0x91)
	materialHash := sha256.Sum256(devicePublicKey)
	actor := &actormodel.ActorRef{
		Ptid: actorPTID,
		Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
	}

	return &actormodel.ActorEndpointManifest{
		FormatVersion:     application.EndpointManifestFormatVersion,
		ManifestId:        fmt.Sprintf("remote-manifest-%d", directoryVersion),
		Actor:             actor,
		HomeStationPeerId: capabilityTestRemoteStation,
		DirectoryVersion:  directoryVersion,
		ActiveEndpoints: []*actormodel.ActorEndpointManifestEntry{{
			Endpoint: &actormodel.ActorDeviceRef{
				Actor:    proto.Clone(actor).(*actormodel.ActorRef),
				DeviceId: deviceID,
			},
			SigningKeyId: signingKeyID(devicePublicKey),
			PublicMaterialSha256: [][]byte{
				append([]byte(nil), materialHash[:]...),
			},
		}},
		IssuedAt:               timestamppb.New(capabilityTestTime.Add(-time.Minute)),
		ExpiresAt:              timestamppb.New(capabilityTestTime.Add(time.Minute)),
		SigningKeyId:           "remote-station-signing-key",
		StationSignature:       bytes.Repeat([]byte{0x92}, ed25519.SignatureSize),
		ActorIdentityPublicKey: append([]byte(nil), actorIdentityPublicKey...),
		ActorProfileVersion:    profileVersion,
	}
}

func assertAcceptedManifestIdentity(
	t *testing.T,
	database *gorm.DB,
	actorPTID string,
	actorIdentityPublicKey ed25519.PublicKey,
	wantProfileVersion int64,
	wantDirectoryVersion uint64,
) {
	t.Helper()

	var identity persistence.ActorIdentityModel
	if err := database.Where("ptid = ?", actorPTID).First(&identity).Error; err != nil {
		t.Fatal(err)
	}
	fingerprint := sha256.Sum256(actorIdentityPublicKey)
	if !bytes.Equal(identity.PublicKey, actorIdentityPublicKey) ||
		!bytes.Equal(identity.Fingerprint, fingerprint[:]) ||
		identity.ProfileVersion != wantProfileVersion {
		t.Fatalf("unexpected accepted Actor identity: %+v", identity)
	}

	var directory persistence.ActorEndpointDirectoryVersionModel
	if err := database.Where("actor_ptid = ?", actorPTID).
		First(&directory).Error; err != nil {
		t.Fatal(err)
	}
	if directory.Version != wantDirectoryVersion {
		t.Fatalf(
			"directory version = %d, want %d",
			directory.Version,
			wantDirectoryVersion,
		)
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
