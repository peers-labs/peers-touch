package key_exchange_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/infrastructure"
	httpinterface "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/interface/http"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	testLocalStation  = "station-local"
	testRemoteStation = "station-remote"
)

type canonicalFixture struct {
	db         *gorm.DB
	api        *httpinterface.CanonicalAPI
	service    *application.CanonicalService
	store      *infrastructure.CanonicalStore
	clock      *testClock
	devices    *testDeviceDirectory
	inbox      *recordingDeviceInbox
	federation *recordingFederation
}

func TestCanonicalDirectBundleLifecycleAndBinding(t *testing.T) {
	fixture := newCanonicalFixture(t)
	ctx := context.Background()
	bob := endpoint("ptid:bob", "bob-1")

	if _, err := fixture.api.UploadDirectKeyBundle(
		ctx,
		bob.GetActor().GetPtid(),
		bob.GetDeviceId(),
		directUploadRequest(bob, 20, 1, 2),
	); err != nil {
		t.Fatalf("upload Direct bundle: %v", err)
	}
	count := countDirect(t, fixture, bob)
	if count != 2 {
		t.Fatalf("Direct OPK count = %d, want 2", count)
	}

	first := fetchDirect(t, fixture, bob.GetActor(), bob.GetDeviceId())
	second := fetchDirect(t, fixture, bob.GetActor(), bob.GetDeviceId())
	third := fetchDirect(t, fixture, bob.GetActor(), bob.GetDeviceId())
	if len(first.GetOneTimePreKeys()) != 1 ||
		len(second.GetOneTimePreKeys()) != 1 ||
		len(third.GetOneTimePreKeys()) != 0 {
		t.Fatalf(
			"one-time consumption counts = %d/%d/%d, want 1/1/0",
			len(first.GetOneTimePreKeys()),
			len(second.GetOneTimePreKeys()),
			len(third.GetOneTimePreKeys()),
		)
	}
	if first.GetOneTimePreKeys()[0].GetKeyId() ==
		second.GetOneTimePreKeys()[0].GetKeyId() {
		t.Fatal("Direct fetch reused a one-time pre-key")
	}

	if _, err := fixture.api.ReplenishDirectOneTimePreKeys(
		ctx,
		bob.GetActor().GetPtid(),
		bob.GetDeviceId(),
		&kemodel.ReplenishDirectOneTimePreKeysRequest{
			Device: bob,
			OneTimePreKeys: []*kemodel.DirectOneTimePreKey{{
				KeyId:     1,
				PublicKey: directKey(31),
			}},
		},
	); err != nil {
		t.Fatalf("idempotent replenish: %v", err)
	}
	if got := countDirect(t, fixture, bob); got != 0 {
		t.Fatalf("consumed Direct OPK was resurrected, count=%d", got)
	}

	if _, err := fixture.api.ReplenishDirectOneTimePreKeys(
		ctx,
		bob.GetActor().GetPtid(),
		bob.GetDeviceId(),
		&kemodel.ReplenishDirectOneTimePreKeysRequest{
			Device: bob,
			OneTimePreKeys: []*kemodel.DirectOneTimePreKey{{
				KeyId:     3,
				PublicKey: directKey(33),
			}},
		},
	); err != nil {
		t.Fatalf("replenish fresh Direct OPK: %v", err)
	}
	if got := countDirect(t, fixture, bob); got != 1 {
		t.Fatalf("Direct OPK count after replenish = %d, want 1", got)
	}

	_, err := fixture.api.UploadDirectKeyBundle(
		ctx,
		bob.GetActor().GetPtid(),
		bob.GetDeviceId(),
		directUploadRequest(bob, 19),
	)
	if !domain.IsCode(err, domain.ErrorCodeStaleMaterial) {
		t.Fatalf("stale signed pre-key error = %v", err)
	}
	_, err = fixture.api.UploadDirectKeyBundle(
		ctx,
		"ptid:alice",
		"alice-1",
		directUploadRequest(bob, 21),
	)
	if !domain.IsCode(err, domain.ErrorCodeUnauthorized) {
		t.Fatalf("actor/device mismatch error = %v", err)
	}
	missing := endpoint("ptid:bob", "bob-missing")
	_, err = fixture.api.UploadDirectKeyBundle(
		ctx,
		missing.GetActor().GetPtid(),
		missing.GetDeviceId(),
		directUploadRequest(missing, 21),
	)
	if !domain.IsCode(err, domain.ErrorCodeUnauthorized) {
		t.Fatalf("inactive endpoint error = %v", err)
	}
	if !strings.Contains(err.Error(), "endpoint is not active") {
		t.Fatalf("inactive endpoint reason = %v", err)
	}
}

func TestCanonicalDirectFetchExactReplayAndRequestConflict(t *testing.T) {
	fixture := newCanonicalFixture(t)
	ctx := context.Background()
	alice := endpoint("ptid:alice", "alice-1")
	bob := endpoint("ptid:bob", "bob-1")
	if _, err := fixture.api.UploadDirectKeyBundle(
		ctx,
		bob.GetActor().GetPtid(),
		bob.GetDeviceId(),
		directUploadRequest(bob, 20, 1, 2),
	); err != nil {
		t.Fatalf("upload Direct bundle: %v", err)
	}
	request := &kemodel.FetchDirectKeyBundlesRequest{
		Actor:          bob.GetActor(),
		TargetDeviceId: bob.GetDeviceId(),
		RequestId:      "direct-api-replay",
		Requester:      alice,
	}

	first, err := fixture.api.FetchDirectKeyBundles(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		request,
	)
	if err != nil {
		t.Fatalf("first Direct fetch: %v", err)
	}
	replayed, err := fixture.api.FetchDirectKeyBundles(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		proto.Clone(request).(*kemodel.FetchDirectKeyBundlesRequest),
	)
	if err != nil {
		t.Fatalf("replay Direct fetch: %v", err)
	}
	if !proto.Equal(first, replayed) {
		t.Fatalf("Direct replay changed exact response: first=%+v replay=%+v", first, replayed)
	}
	if got := countDirect(t, fixture, bob); got != 1 {
		t.Fatalf("Direct replay consumed another one-time pre-key, count=%d", got)
	}

	conflicting := proto.Clone(request).(*kemodel.FetchDirectKeyBundlesRequest)
	conflicting.HomeStationPeerId = testLocalStation
	if _, err := fixture.api.FetchDirectKeyBundles(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		conflicting,
	); !domain.IsCode(err, domain.ErrorCodeConflict) {
		t.Fatalf("Direct request ID hash conflict error = %v", err)
	}
	if got := countDirect(t, fixture, bob); got != 1 {
		t.Fatalf("Direct request conflict mutated one-time pre-keys, count=%d", got)
	}
}

func TestCanonicalDestructiveFetchRejectsRequesterMismatchBeforeMutation(t *testing.T) {
	fixture := newCanonicalFixture(t)
	ctx := context.Background()
	alice := endpoint("ptid:alice", "alice-1")
	bob := endpoint("ptid:bob", "bob-1")
	if _, err := fixture.api.UploadDirectKeyBundle(
		ctx,
		bob.GetActor().GetPtid(),
		bob.GetDeviceId(),
		directUploadRequest(bob, 20, 1),
	); err != nil {
		t.Fatalf("upload Direct bundle: %v", err)
	}

	_, err := fixture.api.FetchDirectKeyBundles(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		&kemodel.FetchDirectKeyBundlesRequest{
			Actor:          bob.GetActor(),
			TargetDeviceId: bob.GetDeviceId(),
			RequestId:      "direct-requester-mismatch",
			Requester:      bob,
		},
	)
	if !domain.IsCode(err, domain.ErrorCodeUnauthorized) {
		t.Fatalf("Direct requester mismatch error = %v", err)
	}
	if got := countDirect(t, fixture, bob); got != 1 {
		t.Fatalf("requester mismatch consumed a Direct pre-key, count=%d", got)
	}

	for _, requestID := range []string{"", " non-canonical "} {
		_, err := fixture.api.FetchDirectKeyBundles(
			ctx,
			alice.GetActor().GetPtid(),
			alice.GetDeviceId(),
			&kemodel.FetchDirectKeyBundlesRequest{
				Actor:          bob.GetActor(),
				TargetDeviceId: bob.GetDeviceId(),
				RequestId:      requestID,
				Requester:      alice,
			},
		)
		if !domain.IsCode(err, domain.ErrorCodeInvalidArgument) {
			t.Fatalf("invalid request ID %q error = %v", requestID, err)
		}
	}
	if got := countDirect(t, fixture, bob); got != 1 {
		t.Fatalf("invalid request identity mutated Direct pre-keys, count=%d", got)
	}
}

func TestCanonicalMLSFetchReservationAndClaimAreOneTime(t *testing.T) {
	fixture := newCanonicalFixture(t)
	ctx := context.Background()
	bob := endpoint("ptid:bob", "bob-1")
	alice := endpoint("ptid:alice", "alice-1")

	firstMaterial := []byte("mls-key-package-first")
	secondMaterial := []byte("mls-key-package-second")
	uploadFirst := uploadMLS(t, fixture, bob, firstMaterial)
	uploadMLS(t, fixture, bob, secondMaterial)
	if bytes.Equal(uploadFirst.GetKeyPackageSha256(), make([]byte, 32)) {
		t.Fatal("MLS upload did not return the package commitment")
	}

	fetched, err := fixture.api.FetchMLSKeyPackage(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		mlsFetchRequest("mls-fetch-first", alice, bob.GetActor(), ""),
	)
	if err != nil {
		t.Fatalf("fetch MLS KeyPackage: %v", err)
	}
	if !fetched.GetAvailable() ||
		fetched.GetReservation().GetTarget().GetDeviceId() != bob.GetDeviceId() {
		t.Fatalf("unexpected MLS fetch response: %+v", fetched)
	}
	if got := countMLS(t, fixture, bob); got != 1 {
		t.Fatalf("MLS count after one-time fetch = %d, want 1", got)
	}

	_, err = fixture.api.UploadMLSKeyPackage(
		ctx,
		bob.GetActor().GetPtid(),
		bob.GetDeviceId(),
		&kemodel.UploadMlsKeyPackageRequest{
			Device:     bob,
			KeyPackage: firstMaterial,
		},
	)
	if !domain.IsCode(err, domain.ErrorCodeStaleMaterial) {
		t.Fatalf("republished consumed MLS package error = %v", err)
	}

	planOneExpiry := fixture.clock.Now().Add(time.Minute)
	reservationOne, err := fixture.service.ReserveMLSKeyPackage(
		ctx,
		"reserve-plan-one-request",
		"plan-one",
		domain.Endpoint{
			ActorPTID: bob.GetActor().GetPtid(),
			DeviceID:  bob.GetDeviceId(),
		},
		planOneExpiry,
	)
	if err != nil {
		t.Fatalf("reserve MLS KeyPackage: %v", err)
	}
	reservationReplay, err := fixture.service.ReserveMLSKeyPackage(
		ctx,
		"reserve-plan-one-request",
		"plan-one",
		domain.Endpoint{
			ActorPTID: bob.GetActor().GetPtid(),
			DeviceID:  bob.GetDeviceId(),
		},
		planOneExpiry,
	)
	if err != nil {
		t.Fatalf("replay MLS KeyPackage reservation: %v", err)
	}
	if reservationReplay.PackageID != reservationOne.PackageID ||
		!bytes.Equal(
			reservationReplay.KeyPackage,
			reservationOne.KeyPackage,
		) {
		t.Fatal("reservation replay changed the reserved MLS KeyPackage")
	}
	unavailable, err := fixture.api.FetchMLSKeyPackage(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		mlsFetchRequest("mls-fetch-unavailable", alice, bob.GetActor(), ""),
	)
	if err != nil {
		t.Fatalf("fetch while reserved: %v", err)
	}
	if unavailable.GetAvailable() {
		t.Fatal("reserved MLS KeyPackage was exposed by fetch")
	}

	fixture.clock.Set(fixture.clock.Now().Add(2 * time.Minute))
	reservationTwo, err := fixture.service.ReserveMLSKeyPackage(
		ctx,
		"reserve-plan-two-request",
		"plan-two",
		domain.Endpoint{
			ActorPTID: bob.GetActor().GetPtid(),
			DeviceID:  bob.GetDeviceId(),
		},
		fixture.clock.Now().Add(time.Minute),
	)
	if err != nil {
		t.Fatalf("reserve expired package for next plan: %v", err)
	}
	err = fixture.service.ConsumeMLSKeyPackages(
		ctx,
		[]domain.MLSKeyPackageReservation{reservationOne},
	)
	if !domain.IsCode(err, domain.ErrorCodeStaleMaterial) {
		t.Fatalf("stale reservation consume error = %v", err)
	}
	if err := fixture.service.ConsumeMLSKeyPackages(
		ctx,
		[]domain.MLSKeyPackageReservation{reservationTwo},
	); err != nil {
		t.Fatalf("consume current reservation: %v", err)
	}
	if got := countMLS(t, fixture, bob); got != 0 {
		t.Fatalf("MLS count after reservation consumption = %d, want 0", got)
	}

	releasableMaterial := []byte("mls-key-package-for-release")
	uploadMLS(t, fixture, bob, releasableMaterial)
	releasable, err := fixture.service.ReserveMLSKeyPackage(
		ctx,
		"reserve-release-request",
		"plan-release",
		domain.Endpoint{
			ActorPTID: bob.GetActor().GetPtid(),
			DeviceID:  bob.GetDeviceId(),
		},
		fixture.clock.Now().Add(time.Minute),
	)
	if err != nil {
		t.Fatalf("reserve releasable MLS KeyPackage: %v", err)
	}
	if err := fixture.service.ReleaseMLSKeyPackages(
		ctx,
		[]domain.MLSKeyPackageReservation{releasable},
	); err != nil {
		t.Fatalf("release MLS KeyPackage: %v", err)
	}
	releasedFetch, err := fixture.api.FetchMLSKeyPackage(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		mlsFetchRequest("mls-fetch-released", alice, bob.GetActor(), ""),
	)
	if err != nil {
		t.Fatalf("fetch released MLS KeyPackage: %v", err)
	}
	if !releasedFetch.GetAvailable() ||
		!bytes.Equal(
			releasedFetch.GetReservation().GetKeyPackage(),
			releasableMaterial,
		) {
		t.Fatalf("released MLS KeyPackage was not reusable: %+v", releasedFetch)
	}

	claimMaterial := []byte("mls-key-package-for-remote-plan")
	uploadMLS(t, fixture, bob, claimMaterial)
	claim := &kemodel.ClaimMlsKeyPackageRequest{
		AuthorityPlanId:        "federated-plan",
		AuthorityStationPeerId: "station-authority",
		Target:                 bob,
		RequestId:              "federated-claim-request",
		PlanExpiresAt: timestamppb.New(
			fixture.clock.Now().Add(time.Minute),
		),
	}
	firstClaim, err := fixture.api.ClaimMLSKeyPackage(
		ctx,
		"station-authority",
		claim,
	)
	if err != nil {
		t.Fatalf("claim MLS KeyPackage: %v", err)
	}
	replayedClaim, err := fixture.api.ClaimMLSKeyPackage(
		ctx,
		"station-authority",
		claim,
	)
	if err != nil {
		t.Fatalf("replay MLS claim: %v", err)
	}
	if firstClaim.GetReservation().GetPackageId() !=
		replayedClaim.GetReservation().GetPackageId() ||
		!bytes.Equal(
			firstClaim.GetReservation().GetKeyPackageSha256(),
			replayedClaim.GetReservation().GetKeyPackageSha256(),
		) ||
		!firstClaim.GetIrreversiblyConsumed() ||
		!replayedClaim.GetIrreversiblyConsumed() {
		t.Fatalf(
			"claim replay changed the exact-once result: first=%+v replay=%+v",
			firstClaim,
			replayedClaim,
		)
	}
	if got := countMLS(t, fixture, bob); got != 0 {
		t.Fatalf("claimed MLS KeyPackage remains available, count=%d", got)
	}

	conflictingClaim := proto.Clone(claim).(*kemodel.ClaimMlsKeyPackageRequest)
	conflictingClaim.PlanExpiresAt = timestamppb.New(
		fixture.clock.Now().Add(2 * time.Minute),
	)
	_, err = fixture.api.ClaimMLSKeyPackage(
		ctx,
		"station-authority",
		conflictingClaim,
	)
	if !domain.IsCode(err, domain.ErrorCodeConflict) {
		t.Fatalf("conflicting claim replay error = %v", err)
	}
}

func TestCanonicalMLSFetchExactReplayAndRequestConflict(t *testing.T) {
	fixture := newCanonicalFixture(t)
	ctx := context.Background()
	alice := endpoint("ptid:alice", "alice-1")
	bob := endpoint("ptid:bob", "bob-1")
	for _, material := range [][]byte{
		[]byte("mls-api-replay-package-1"),
		[]byte("mls-api-replay-package-2"),
	} {
		uploadMLS(t, fixture, bob, material)
	}
	request := mlsFetchRequest(
		"mls-api-replay",
		alice,
		bob.GetActor(),
		"",
	)

	first, err := fixture.api.FetchMLSKeyPackage(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		request,
	)
	if err != nil {
		t.Fatalf("first MLS fetch: %v", err)
	}
	replayed, err := fixture.api.FetchMLSKeyPackage(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		proto.Clone(request).(*kemodel.FetchMlsKeyPackageRequest),
	)
	if err != nil {
		t.Fatalf("replay MLS fetch: %v", err)
	}
	if !proto.Equal(first, replayed) {
		t.Fatalf("MLS replay changed exact response: first=%+v replay=%+v", first, replayed)
	}
	if got := countMLS(t, fixture, bob); got != 1 {
		t.Fatalf("MLS replay consumed another package, count=%d", got)
	}

	conflicting := proto.Clone(request).(*kemodel.FetchMlsKeyPackageRequest)
	conflicting.HomeStationPeerId = testLocalStation
	if _, err := fixture.api.FetchMLSKeyPackage(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		conflicting,
	); !domain.IsCode(err, domain.ErrorCodeConflict) {
		t.Fatalf("MLS request ID hash conflict error = %v", err)
	}
	if got := countMLS(t, fixture, bob); got != 1 {
		t.Fatalf("MLS request conflict mutated KeyPackages, count=%d", got)
	}
}

func TestCanonicalMLSClaimRejectsPeerAndExpiryBeforeConsumption(t *testing.T) {
	fixture := newCanonicalFixture(t)
	ctx := context.Background()
	bob := endpoint("ptid:bob", "bob-1")
	uploadMLS(t, fixture, bob, []byte("claim-validation-package"))

	request := &kemodel.ClaimMlsKeyPackageRequest{
		AuthorityPlanId:        "claim-validation",
		AuthorityStationPeerId: "station-authority",
		Target:                 bob,
		RequestId:              "claim-validation-request",
		PlanExpiresAt: timestamppb.New(
			fixture.clock.Now().Add(time.Minute),
		),
	}
	_, err := fixture.api.ClaimMLSKeyPackage(
		ctx,
		"station-impostor",
		request,
	)
	if !domain.IsCode(err, domain.ErrorCodeUnauthorized) {
		t.Fatalf("peer binding error = %v", err)
	}
	if got := countMLS(t, fixture, bob); got != 1 {
		t.Fatalf("peer mismatch consumed package, count=%d", got)
	}

	request.PlanExpiresAt = timestamppb.New(
		fixture.clock.Now().Add(-2 * time.Minute),
	)
	_, err = fixture.api.ClaimMLSKeyPackage(
		ctx,
		"station-authority",
		request,
	)
	if !domain.IsCode(err, domain.ErrorCodePlanExpired) {
		t.Fatalf("expired plan error = %v", err)
	}
	if got := countMLS(t, fixture, bob); got != 1 {
		t.Fatalf("expired plan consumed package, count=%d", got)
	}
}

func TestCanonicalPayloadBoundsRejectBeforeStoreMutation(t *testing.T) {
	fixture := newCanonicalFixture(t)
	ctx := context.Background()
	bob := endpoint("ptid:bob", "bob-1")

	oneTimePreKeyIDs := make(
		[]int32,
		domain.MaxDirectOneTimePreKeys+1,
	)
	for index := range oneTimePreKeyIDs {
		oneTimePreKeyIDs[index] = int32(index + 1)
	}
	_, err := fixture.api.UploadDirectKeyBundle(
		ctx,
		bob.GetActor().GetPtid(),
		bob.GetDeviceId(),
		directUploadRequest(bob, 20, oneTimePreKeyIDs...),
	)
	if !domain.IsCode(err, domain.ErrorCodePayloadTooLarge) {
		t.Fatalf("oversized Direct bundle error = %v", err)
	}
	var directRows int64
	if err := fixture.db.Model(&infrastructure.OneTimePreKeyModel{}).
		Where(
			"actor_ptid = ? AND device_id = ?",
			bob.GetActor().GetPtid(),
			bob.GetDeviceId(),
		).
		Count(&directRows).Error; err != nil {
		t.Fatal(err)
	}
	if directRows != 0 {
		t.Fatalf("oversized Direct bundle mutated OPKs, count=%d", directRows)
	}

	_, err = fixture.api.UploadMLSKeyPackage(
		ctx,
		bob.GetActor().GetPtid(),
		bob.GetDeviceId(),
		&kemodel.UploadMlsKeyPackageRequest{
			Device: bob,
			KeyPackage: make(
				[]byte,
				domain.MaxMLSKeyPackageBytes+1,
			),
		},
	)
	if !domain.IsCode(err, domain.ErrorCodePayloadTooLarge) {
		t.Fatalf("oversized MLS KeyPackage error = %v", err)
	}
	if got := countMLS(t, fixture, bob); got != 0 {
		t.Fatalf("oversized MLS package mutated storage, count=%d", got)
	}
}

func TestCanonicalDKXUsesExactlyOneTypedDeliveryPort(t *testing.T) {
	fixture := newCanonicalFixture(t)
	ctx := context.Background()
	alice := endpoint("ptid:alice", "alice-1")
	bob := endpoint("ptid:bob", "bob-1")
	carol := endpoint("ptid:carol", "carol-1")

	localRequest := directKeyExchangeRequest(bob, testLocalStation)
	localResponse, err := fixture.api.SendDirectKeyExchange(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		localRequest,
	)
	if err != nil {
		t.Fatalf("send local DKX: %v", err)
	}
	if localResponse.GetEnvelopeId() == "" ||
		fixture.inbox.Len() != 1 ||
		fixture.federation.DKXLen() != 0 {
		t.Fatalf(
			"local DKX routing inbox=%d federation=%d response=%+v",
			fixture.inbox.Len(),
			fixture.federation.DKXLen(),
			localResponse,
		)
	}

	remoteRequest := directKeyExchangeRequest(carol, testRemoteStation)
	firstRemote, err := fixture.api.SendDirectKeyExchange(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		remoteRequest,
	)
	if err != nil {
		t.Fatalf("send remote DKX: %v", err)
	}
	secondRemote, err := fixture.api.SendDirectKeyExchange(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		remoteRequest,
	)
	if err != nil {
		t.Fatalf("retry remote DKX: %v", err)
	}
	remoteEnvelopes := fixture.federation.DKX()
	if firstRemote.GetEnvelopeId() == "" ||
		secondRemote.GetEnvelopeId() == "" ||
		len(remoteEnvelopes) != 2 ||
		fixture.inbox.Len() != 1 {
		t.Fatalf(
			"remote DKX routing inbox=%d federation=%d",
			fixture.inbox.Len(),
			len(remoteEnvelopes),
		)
	}
	if remoteEnvelopes[0].IdempotencyKey !=
		remoteEnvelopes[1].IdempotencyKey {
		t.Fatal("identical DKX retry did not preserve its idempotency identity")
	}
	if remoteEnvelopes[0].Sender.ActorPTID !=
		alice.GetActor().GetPtid() ||
		remoteEnvelopes[0].Sender.DeviceID != alice.GetDeviceId() {
		t.Fatalf(
			"DKX sender was not bound to authentication: %+v",
			remoteEnvelopes[0].Sender,
		)
	}

	beforeInbox := fixture.inbox.Len()
	beforeFederation := fixture.federation.DKXLen()
	oversized := directKeyExchangeRequest(bob, testLocalStation)
	oversized.OpaqueKeyMaterial = make(
		[]byte,
		domain.MaxDirectKeyExchangePayload+1,
	)
	_, err = fixture.api.SendDirectKeyExchange(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		oversized,
	)
	if !domain.IsCode(err, domain.ErrorCodePayloadTooLarge) {
		t.Fatalf("oversized DKX error = %v", err)
	}
	if fixture.inbox.Len() != beforeInbox ||
		fixture.federation.DKXLen() != beforeFederation {
		t.Fatal("oversized DKX mutated a delivery port")
	}

	wrongStation := directKeyExchangeRequest(carol, testLocalStation)
	_, err = fixture.api.SendDirectKeyExchange(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		wrongStation,
	)
	if !domain.IsCode(err, domain.ErrorCodeConflict) {
		t.Fatalf("recipient Home Station mismatch error = %v", err)
	}
}

func TestCanonicalRemoteFetchUsesTypedFederationPort(t *testing.T) {
	fixture := newCanonicalFixture(t)
	ctx := context.Background()
	alice := endpoint("ptid:alice", "alice-1")
	carol := endpoint("ptid:carol", "carol-1")
	remoteRouteKey := domain.Endpoint{
		ActorPTID: carol.GetActor().GetPtid(),
		DeviceID:  carol.GetDeviceId(),
	}.Key()
	remoteRoute := fixture.devices.routes[remoteRouteKey]
	delete(fixture.devices.routes, remoteRouteKey)
	fixture.federation.directBundles = []domain.DirectKeyBundle{
		directDomainBundle(
			domain.Endpoint{
				ActorPTID: carol.GetActor().GetPtid(),
				DeviceID:  carol.GetDeviceId(),
			},
			30,
		),
	}
	remoteMLS := []byte("remote-mls-key-package")
	fixture.federation.mlsReservation = &domain.MLSKeyPackageReservation{
		Target: domain.Endpoint{
			ActorPTID: carol.GetActor().GetPtid(),
			DeviceID:  carol.GetDeviceId(),
		},
		PackageID:            "remote-package",
		KeyPackage:           remoteMLS,
		PackageHash:          domain.HashMLSKeyPackage(remoteMLS),
		HomeStation:          testRemoteStation,
		IrreversiblyConsumed: true,
	}

	directResponse, err := fixture.api.FetchDirectKeyBundles(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		&kemodel.FetchDirectKeyBundlesRequest{
			Actor:             carol.GetActor(),
			TargetDeviceId:    carol.GetDeviceId(),
			HomeStationPeerId: testRemoteStation,
			RequestId:         "remote-direct-fetch",
			Requester:         alice,
		},
	)
	if err != nil {
		t.Fatalf("fetch remote Direct bundle: %v", err)
	}
	if len(directResponse.GetBundles()) != 1 ||
		fixture.federation.DirectFetchLen() != 1 {
		t.Fatalf(
			"remote Direct fetch response=%+v calls=%d",
			directResponse,
			fixture.federation.DirectFetchLen(),
		)
	}
	fixture.devices.routes[remoteRouteKey] = remoteRoute

	mlsResponse, err := fixture.api.FetchMLSKeyPackage(
		ctx,
		alice.GetActor().GetPtid(),
		alice.GetDeviceId(),
		&kemodel.FetchMlsKeyPackageRequest{
			Actor:             carol.GetActor(),
			HomeStationPeerId: testRemoteStation,
			RequestId:         "remote-mls-fetch",
			Requester:         alice,
		},
	)
	if err != nil {
		t.Fatalf("fetch remote MLS KeyPackage: %v", err)
	}
	if !mlsResponse.GetAvailable() ||
		mlsResponse.GetReservation().GetPackageId() != "remote-package" ||
		fixture.federation.MLSFetchLen() != 1 {
		t.Fatalf(
			"remote MLS fetch response=%+v calls=%d",
			mlsResponse,
			fixture.federation.MLSFetchLen(),
		)
	}
	reserved, err := fixture.service.ReserveMLSKeyPackage(
		ctx,
		"remote-claim-request",
		"remote-authority-plan",
		domain.Endpoint{
			ActorPTID: carol.GetActor().GetPtid(),
			DeviceID:  carol.GetDeviceId(),
		},
		fixture.clock.Now().Add(time.Minute),
	)
	if err != nil {
		t.Fatalf("claim remote MLS KeyPackage for reservation: %v", err)
	}
	if !reserved.IrreversiblyConsumed ||
		reserved.HomeStation != testRemoteStation ||
		fixture.federation.MLSClaimLen() != 1 ||
		fixture.federation.LastMLSClaim().RequestID != "remote-claim-request" {
		t.Fatalf(
			"remote reservation=%+v claim calls=%d claim=%+v",
			reserved,
			fixture.federation.MLSClaimLen(),
			fixture.federation.LastMLSClaim(),
		)
	}

	manifestOnlyTarget := domain.Endpoint{
		ActorPTID: "ptid:manifest-only",
		DeviceID:  "manifest-device",
	}
	manifestOnly, err := fixture.service.ReserveMLSKeyPackageForVerifiedRoute(
		ctx,
		"manifest-route-claim",
		"manifest-route-plan",
		manifestOnlyTarget,
		testRemoteStation,
		fixture.clock.Now().Add(time.Minute),
	)
	if err != nil {
		t.Fatalf("reserve from verified remote route: %v", err)
	}
	if manifestOnly.Target != manifestOnlyTarget ||
		manifestOnly.HomeStation != testRemoteStation ||
		!manifestOnly.IrreversiblyConsumed ||
		fixture.federation.MLSClaimLen() != 2 {
		t.Fatalf(
			"verified-route reservation=%+v claim calls=%d",
			manifestOnly,
			fixture.federation.MLSClaimLen(),
		)
	}
}

func newCanonicalFixture(t *testing.T) *canonicalFixture {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open(
			"file:key-exchange-canonical-"+uuid.NewString()+
				"?mode=memory&cache=shared&_busy_timeout=5000",
		),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open canonical key exchange database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open canonical SQL database: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)

	store, err := infrastructure.NewCanonicalStore(db)
	if err != nil {
		t.Fatalf("create canonical key exchange store: %v", err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate canonical key exchange test schema: %v", err)
	}
	if err := db.AutoMigrate(&actoridentitypersistence.ActorDeviceModel{}); err != nil {
		t.Fatalf("migrate actor device authorization table: %v", err)
	}
	directory := &testDeviceDirectory{
		routes:       map[string]domain.DeviceRoute{},
		homeStations: map[string]string{},
	}
	for _, route := range []domain.DeviceRoute{
		{
			Endpoint: domain.Endpoint{
				ActorPTID: "ptid:alice",
				DeviceID:  "alice-1",
			},
			HomeStationID: testLocalStation,
		},
		{
			Endpoint: domain.Endpoint{
				ActorPTID: "ptid:bob",
				DeviceID:  "bob-1",
			},
			HomeStationID: testLocalStation,
		},
		{
			Endpoint: domain.Endpoint{
				ActorPTID: "ptid:carol",
				DeviceID:  "carol-1",
			},
			HomeStationID: testRemoteStation,
		},
	} {
		directory.routes[route.Endpoint.Key()] = route
		directory.homeStations[route.Endpoint.ActorPTID] = route.HomeStationID
		if route.HomeStationID == testLocalStation {
			if err := db.Create(&actoridentitypersistence.ActorDeviceModel{
				PTID:               route.Endpoint.ActorPTID,
				ActorAccount:       route.Endpoint.ActorPTID + "@example.test",
				ActorKind:          1,
				DeviceID:           route.Endpoint.DeviceID,
				Label:              route.Endpoint.DeviceID,
				HomeStationPeerID:  route.HomeStationID,
				SigningKeyID:       route.Endpoint.DeviceID + "-signing-key",
				PublicKey:          make([]byte, 32),
				ProfileVersion:     1,
				VerificationSource: 1,
				CreatedAt:          time.Unix(1_800_000_000, 0).UTC(),
			}).Error; err != nil {
				t.Fatalf("seed active actor device: %v", err)
			}
		}
	}
	clock := &testClock{
		now: time.Unix(1_800_000_000, 123_456_000).UTC(),
	}
	inbox := &recordingDeviceInbox{}
	federation := &recordingFederation{}
	service, err := application.NewCanonicalService(
		store,
		store,
		directory,
		directory,
		inbox,
		federation,
		clock,
		&sequenceIDGenerator{},
		testLocalStation,
	)
	if err != nil {
		t.Fatalf("create canonical key exchange service: %v", err)
	}
	api, err := httpinterface.NewCanonicalAPI(service)
	if err != nil {
		t.Fatalf("create canonical key exchange API: %v", err)
	}
	return &canonicalFixture{
		db:         db,
		api:        api,
		service:    service,
		store:      store,
		clock:      clock,
		devices:    directory,
		inbox:      inbox,
		federation: federation,
	}
}

func endpoint(actorPTID string, deviceID string) *actormodel.ActorDeviceRef {
	return &actormodel.ActorDeviceRef{
		Actor:    &actormodel.ActorRef{Ptid: actorPTID},
		DeviceId: deviceID,
	}
}

func mlsFetchRequest(
	requestID string,
	requester *actormodel.ActorDeviceRef,
	actor *actormodel.ActorRef,
	homeStationID string,
) *kemodel.FetchMlsKeyPackageRequest {
	return &kemodel.FetchMlsKeyPackageRequest{
		Actor:             actor,
		HomeStationPeerId: homeStationID,
		RequestId:         requestID,
		Requester:         requester,
	}
}

func directUploadRequest(
	device *actormodel.ActorDeviceRef,
	signedPreKeyID int32,
	oneTimePreKeyIDs ...int32,
) *kemodel.UploadDirectKeyBundleRequest {
	keys := make(
		[]*kemodel.DirectOneTimePreKey,
		0,
		len(oneTimePreKeyIDs),
	)
	for _, keyID := range oneTimePreKeyIDs {
		keys = append(keys, &kemodel.DirectOneTimePreKey{
			KeyId:     keyID,
			PublicKey: directKey(byte(30 + keyID)),
		})
	}
	return &kemodel.UploadDirectKeyBundleRequest{
		Device:             device,
		IdentityKeyPublic:  directKey(10),
		SignedPreKeyId:     signedPreKeyID,
		SignedPreKeyPublic: directKey(20),
		SignedPreKeySignature: base64.StdEncoding.EncodeToString(
			bytes.Repeat([]byte{21}, domain.DirectSignedPreKeySignatureLen),
		),
		OneTimePreKeys:        keys,
		SupportedWireVersions: []uint32{1, 0, 1},
	}
}

func directDomainBundle(
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
		PublishedAt:           time.Unix(1_800_000_000, 0).UTC(),
	}
}

func directKey(value byte) string {
	return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{value}, 32))
}

func countDirect(
	t *testing.T,
	fixture *canonicalFixture,
	device *actormodel.ActorDeviceRef,
) int64 {
	t.Helper()
	response, err := fixture.api.CountDirectOneTimePreKeys(
		context.Background(),
		device.GetActor().GetPtid(),
		device.GetDeviceId(),
		&kemodel.CountDirectOneTimePreKeysRequest{Device: device},
	)
	if err != nil {
		t.Fatalf("count Direct one-time pre-keys: %v", err)
	}
	return response.GetCount()
}

func fetchDirect(
	t *testing.T,
	fixture *canonicalFixture,
	actor *actormodel.ActorRef,
	targetDeviceID string,
) *kemodel.DirectKeyBundle {
	t.Helper()
	response, err := fixture.api.FetchDirectKeyBundles(
		context.Background(),
		"ptid:alice",
		"alice-1",
		&kemodel.FetchDirectKeyBundlesRequest{
			Actor:          actor,
			TargetDeviceId: targetDeviceID,
			RequestId:      uuid.NewString(),
			Requester:      endpoint("ptid:alice", "alice-1"),
		},
	)
	if err != nil {
		t.Fatalf("fetch Direct bundle: %v", err)
	}
	if len(response.GetBundles()) != 1 {
		t.Fatalf("Direct bundle count = %d, want 1", len(response.GetBundles()))
	}
	return response.GetBundles()[0]
}

func uploadMLS(
	t *testing.T,
	fixture *canonicalFixture,
	device *actormodel.ActorDeviceRef,
	material []byte,
) *kemodel.UploadMlsKeyPackageResponse {
	t.Helper()
	response, err := fixture.api.UploadMLSKeyPackage(
		context.Background(),
		device.GetActor().GetPtid(),
		device.GetDeviceId(),
		&kemodel.UploadMlsKeyPackageRequest{
			Device:     device,
			KeyPackage: append([]byte(nil), material...),
		},
	)
	if err != nil {
		t.Fatalf("upload MLS KeyPackage: %v", err)
	}
	return response
}

func countMLS(
	t *testing.T,
	fixture *canonicalFixture,
	device *actormodel.ActorDeviceRef,
) int64 {
	t.Helper()
	response, err := fixture.api.CountMLSKeyPackages(
		context.Background(),
		device.GetActor().GetPtid(),
		device.GetDeviceId(),
		&kemodel.CountMlsKeyPackagesRequest{Device: device},
	)
	if err != nil {
		t.Fatalf("count MLS KeyPackages: %v", err)
	}
	return response.GetCount()
}

func directKeyExchangeRequest(
	recipient *actormodel.ActorDeviceRef,
	homeStationID string,
) *kemodel.SendDirectKeyExchangeRequest {
	return &kemodel.SendDirectKeyExchangeRequest{
		Recipient:                  recipient,
		RecipientHomeStationPeerId: homeStationID,
		SessionId:                  "session-1",
		Kind:                       kemodel.DirectKeyExchangePayloadKind_DIRECT_KEY_EXCHANGE_PAYLOAD_KIND_INITIAL_MESSAGE,
		OpaqueKeyMaterial:          []byte("opaque-direct-key-exchange"),
		ConversationId:             "conversation-1",
	}
}

type testDeviceDirectory struct {
	routes       map[string]domain.DeviceRoute
	homeStations map[string]string
}

func (d *testDeviceDirectory) ResolveActiveDevice(
	_ context.Context,
	endpoint domain.Endpoint,
) (domain.DeviceRoute, error) {
	route, ok := d.routes[endpoint.Key()]
	if !ok {
		return domain.DeviceRoute{}, domain.NewError(
			domain.ErrorCodeNotFound,
			"test.resolve_active_device",
			"endpoint",
			"is not active",
		)
	}
	return route, nil
}

func (d *testDeviceDirectory) ListActiveDevices(
	_ context.Context,
	actorPTID string,
) ([]domain.DeviceRoute, error) {
	routes := make([]domain.DeviceRoute, 0)
	for _, route := range d.routes {
		if route.Endpoint.ActorPTID == actorPTID {
			routes = append(routes, route)
		}
	}
	return routes, nil
}

func (d *testDeviceDirectory) ResolveActorHomeStationPeerID(
	_ context.Context,
	actorPTID string,
) (string, error) {
	homeStationID, ok := d.homeStations[actorPTID]
	if !ok {
		return "", domain.NewError(
			domain.ErrorCodeNotFound,
			"test.resolve_actor_home_station",
			"actor",
			"has no Home Station",
		)
	}
	return homeStationID, nil
}

type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *testClock) Set(value time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = value
}

type sequenceIDGenerator struct {
	mu   sync.Mutex
	next int
}

func (g *sequenceIDGenerator) NewID() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.next++
	return fmt.Sprintf("envelope-%d", g.next)
}

type recordingDeviceInbox struct {
	mu        sync.Mutex
	envelopes []domain.DirectKeyExchangeEnvelope
}

func (p *recordingDeviceInbox) EnqueueDirectKeyExchange(
	_ context.Context,
	envelope domain.DirectKeyExchangeEnvelope,
) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.envelopes = append(p.envelopes, envelope.Clone())
	return envelope.EnvelopeID, nil
}

func (p *recordingDeviceInbox) Len() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.envelopes)
}

type recordingFederation struct {
	mu               sync.Mutex
	directBundles    []domain.DirectKeyBundle
	mlsReservation   *domain.MLSKeyPackageReservation
	directFetchCalls int
	mlsFetchCalls    int
	mlsClaimCalls    int
	lastMLSClaim     domain.MLSKeyPackageClaim
	dkxEnvelopes     []domain.DirectKeyExchangeEnvelope
}

func (p *recordingFederation) FetchDirectKeyBundles(
	_ context.Context,
	_ string,
	_ domain.DestructiveReadIdentity,
	_ string,
	_ string,
) ([]domain.DirectKeyBundle, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.directFetchCalls++
	result := make([]domain.DirectKeyBundle, 0, len(p.directBundles))
	for _, bundle := range p.directBundles {
		result = append(result, bundle.Clone())
	}
	return result, nil
}

func (p *recordingFederation) FetchMLSKeyPackage(
	_ context.Context,
	_ string,
	_ domain.DestructiveReadIdentity,
	_ string,
) (*domain.MLSKeyPackageReservation, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.mlsFetchCalls++
	if p.mlsReservation == nil {
		return nil, nil
	}
	result := p.mlsReservation.Clone()
	return &result, nil
}

func (p *recordingFederation) ClaimMLSKeyPackage(
	_ context.Context,
	targetStationID string,
	claim domain.MLSKeyPackageClaim,
) (domain.MLSKeyPackageReservation, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.mlsClaimCalls++
	p.lastMLSClaim = claim
	return domain.MLSKeyPackageReservation{
		PlanID:               claim.AuthorityPlanID,
		Target:               claim.Target,
		PackageID:            "remote-claim",
		KeyPackage:           []byte("remote-claimed-key-package"),
		PackageHash:          domain.HashMLSKeyPackage([]byte("remote-claimed-key-package")),
		HomeStation:          targetStationID,
		PlanExpiresAt:        claim.PlanExpiresAt,
		IrreversiblyConsumed: true,
	}, nil
}

func (p *recordingFederation) EnqueueDirectKeyExchange(
	_ context.Context,
	_ string,
	envelope domain.DirectKeyExchangeEnvelope,
) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.dkxEnvelopes = append(p.dkxEnvelopes, envelope.Clone())
	return envelope.EnvelopeID, nil
}

func (p *recordingFederation) DKX() []domain.DirectKeyExchangeEnvelope {
	p.mu.Lock()
	defer p.mu.Unlock()
	result := make([]domain.DirectKeyExchangeEnvelope, 0, len(p.dkxEnvelopes))
	for _, envelope := range p.dkxEnvelopes {
		result = append(result, envelope.Clone())
	}
	return result
}

func (p *recordingFederation) DKXLen() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.dkxEnvelopes)
}

func (p *recordingFederation) DirectFetchLen() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.directFetchCalls
}

func (p *recordingFederation) MLSFetchLen() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.mlsFetchCalls
}

func (p *recordingFederation) MLSClaimLen() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.mlsClaimCalls
}

func (p *recordingFederation) LastMLSClaim() domain.MLSKeyPackageClaim {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.lastMLSClaim
}
