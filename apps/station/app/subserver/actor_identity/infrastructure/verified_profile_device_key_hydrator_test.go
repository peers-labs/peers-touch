package infrastructure

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	locatorpb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	fedprofile "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

const (
	testRemoteActorPTID = "ptid:v1:actor:peers:p:alice:identityfingerprint"
	testRemoteStationID = "station-a"
	testRemoteHandle    = "alice@station-a.example"
)

func TestVerifiedProfileDeviceKeyHydratorUsesPTIDAndPinnedHomeStation(t *testing.T) {
	now := time.Date(2026, time.September, 7, 12, 0, 0, 0, time.UTC)
	db := openVerifiedProfileTestDB(t)
	seedRemoteStationRoute(t, db, "https://station-a.example")

	stationKey, err := authfed.MintLocalKey(now)
	if err != nil {
		t.Fatal(err)
	}
	peerKeys := authfed.NewPeerKeyStoreGORMWithDB(db)
	if err := peerKeys.UpsertTOFU(context.Background(), authfed.PeerKey{
		StationID: testRemoteStationID,
		Kid:       stationKey.Kid,
		PubPEM:    stationKey.PubPEM,
	}); err != nil {
		t.Fatal(err)
	}

	devicePublicKey, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	deviceKeyHash := sha256.Sum256(devicePublicKey)
	deviceKey := &model.VerifiedActorDeviceSigningKey{
		ActorPtid:          testRemoteActorPTID,
		ActorDeviceId:      "alice-device",
		HomeStationPeerId:  testRemoteStationID,
		SigningKeyId:       hex.EncodeToString(deviceKeyHash[:]),
		Ed25519PublicKey:   append([]byte(nil), devicePublicKey...),
		ProfileVersion:     1,
		VerificationSource: model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
		ValidFromUnixMs:    now.UnixMilli(),
	}
	locatorRecord, _, err := locator.Sign(locator.SignInput{
		Handle:            testRemoteHandle,
		HomeStationPeerID: testRemoteStationID,
		HomeStationDomain: "station-a.example",
		Seq:               1,
		Now:               now,
		LocalKey:          stationKey,
	})
	if err != nil {
		t.Fatal(err)
	}
	envelope, _, err := fedprofile.Sign(fedprofile.SignInput{
		Handle:            testRemoteHandle,
		HomeStationPeerID: testRemoteStationID,
		HomeStationDomain: "station-a.example",
		Profile: &model.ActorProfile{
			PeersTouch: &model.PeersTouchInfo{NetworkId: testRemoteActorPTID},
		},
		DeviceSigningKeys: []*model.VerifiedActorDeviceSigningKey{deviceKey},
		Now:               now,
		LocalKey:          stationKey,
	})
	if err != nil {
		t.Fatal(err)
	}

	hydrator, err := NewVerifiedProfileDeviceKeyHydrator(db)
	if err != nil {
		t.Fatal(err)
	}
	profileLocator := &staticActorProfileLocator{
		expectedHandle: testRemoteHandle,
		record:         locatorRecord,
	}
	profileFetcher := &staticRemoteActorProfileFetcher{
		expectedHandle:  testRemoteHandle,
		expectedStation: testRemoteStationID,
		envelope:        envelope,
	}
	hydrator.locator = profileLocator
	hydrator.profiles = profileFetcher
	hydrator.clock = func() time.Time { return now }

	resolvedKeys, err := hydrator.Hydrate(
		context.Background(),
		testRemoteActorPTID,
		testRemoteStationID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if profileLocator.calls != 1 || profileFetcher.calls != 1 {
		t.Fatalf(
			"profile locator/fetcher calls = %d/%d, want 1/1",
			profileLocator.calls,
			profileFetcher.calls,
		)
	}
	if len(resolvedKeys) != 1 ||
		resolvedKeys[0].GetActorPtid() != testRemoteActorPTID ||
		resolvedKeys[0].GetHomeStationPeerId() != testRemoteStationID ||
		!bytes.Equal(resolvedKeys[0].GetEd25519PublicKey(), devicePublicKey) {
		t.Fatalf("resolved verified device keys = %+v", resolvedKeys)
	}
}

func TestVerifiedProfileDeviceKeyHydratorKeepsMissingRouteRetryable(t *testing.T) {
	db := openVerifiedProfileTestDB(t)
	hydrator, err := NewVerifiedProfileDeviceKeyHydrator(db)
	if err != nil {
		t.Fatal(err)
	}
	profileLocator := &staticActorProfileLocator{}
	profileFetcher := &staticRemoteActorProfileFetcher{}
	hydrator.locator = profileLocator
	hydrator.profiles = profileFetcher

	_, err = hydrator.Hydrate(
		context.Background(),
		testRemoteActorPTID,
		testRemoteStationID,
	)
	if !actoridentitydomain.IsCode(
		err,
		actoridentitydomain.ErrorCodeIdentityUnavailable,
	) {
		t.Fatalf("missing route error = %v", err)
	}
	if profileLocator.calls != 0 || profileFetcher.calls != 0 {
		t.Fatalf(
			"profile locator/fetcher calls = %d/%d, want 0/0",
			profileLocator.calls,
			profileFetcher.calls,
		)
	}
}

func TestVerifiedProfileDeviceKeyHydratorRejectsSelfSuppliedStationKey(t *testing.T) {
	now := time.Date(2026, time.September, 7, 12, 0, 0, 0, time.UTC)
	db := openVerifiedProfileTestDB(t)
	seedRemoteStationRoute(t, db, "https://station-a.example")

	pinnedKey, err := authfed.MintLocalKey(now)
	if err != nil {
		t.Fatal(err)
	}
	if err := authfed.NewPeerKeyStoreGORMWithDB(db).UpsertTOFU(
		context.Background(),
		authfed.PeerKey{
			StationID: testRemoteStationID,
			Kid:       pinnedKey.Kid,
			PubPEM:    pinnedKey.PubPEM,
		},
	); err != nil {
		t.Fatal(err)
	}
	selfSuppliedKey, err := authfed.MintLocalKey(now)
	if err != nil {
		t.Fatal(err)
	}
	locatorRecord, _, err := locator.Sign(locator.SignInput{
		Handle:            testRemoteHandle,
		HomeStationPeerID: testRemoteStationID,
		HomeStationDomain: "station-a.example",
		Seq:               1,
		Now:               now,
		LocalKey:          selfSuppliedKey,
	})
	if err != nil {
		t.Fatal(err)
	}

	hydrator, err := NewVerifiedProfileDeviceKeyHydrator(db)
	if err != nil {
		t.Fatal(err)
	}
	profileLocator := &staticActorProfileLocator{
		expectedHandle: testRemoteHandle,
		record:         locatorRecord,
	}
	profileFetcher := &staticRemoteActorProfileFetcher{}
	hydrator.locator = profileLocator
	hydrator.profiles = profileFetcher
	hydrator.clock = func() time.Time { return now }

	_, err = hydrator.Hydrate(
		context.Background(),
		testRemoteActorPTID,
		testRemoteStationID,
	)
	if !actoridentitydomain.IsCode(err, actoridentitydomain.ErrorCodeInvalidProof) {
		t.Fatalf("self-supplied Station key error = %v", err)
	}
	if profileFetcher.calls != 0 {
		t.Fatalf("profile fetcher calls = %d, want 0", profileFetcher.calls)
	}
}

func openVerifiedProfileTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:verified-profile-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&authfed.PeerKeyRow{}); err != nil {
		t.Fatal(err)
	}
	if err := touchactor.NewDeviceStore(db).AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	return db
}

func seedRemoteStationRoute(t *testing.T, db *gorm.DB, stationURL string) {
	t.Helper()
	if err := db.Exec(`
		CREATE TABLE federation_station_membership (
			station_peer_id TEXT NOT NULL,
			station_url TEXT NOT NULL,
			status TEXT NOT NULL
		)
	`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		`INSERT INTO federation_station_membership
			(station_peer_id, station_url, status) VALUES (?, ?, ?)`,
		testRemoteStationID,
		stationURL,
		"active",
	).Error; err != nil {
		t.Fatal(err)
	}
}

type staticActorProfileLocator struct {
	expectedHandle string
	record         *locatorpb.ActorLocatorRecord
	err            error
	calls          int
}

func (r *staticActorProfileLocator) Resolve(
	_ context.Context,
	canonicalHandle string,
) (*locatorpb.ActorLocatorRecord, error) {
	r.calls++
	if r.err != nil {
		return nil, r.err
	}
	if r.expectedHandle != "" && canonicalHandle != r.expectedHandle {
		return nil, errors.New("unexpected canonical handle")
	}
	return r.record, nil
}

type staticRemoteActorProfileFetcher struct {
	expectedHandle  string
	expectedStation string
	envelope        *profilepb.ActorProfileEnvelope
	err             error
	calls           int
}

func (f *staticRemoteActorProfileFetcher) Fetch(
	_ context.Context,
	canonicalHandle string,
	homeStationPeerID string,
) (*profilepb.ActorProfileEnvelope, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	if f.expectedHandle != "" && canonicalHandle != f.expectedHandle {
		return nil, errors.New("unexpected canonical handle")
	}
	if f.expectedStation != "" && homeStationPeerID != f.expectedStation {
		return nil, errors.New("unexpected Home Station")
	}
	return f.envelope, nil
}
