package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	keyexchangedomain "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestPrivateContentServicePrepareSubmitReplay(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	prepare := privateMomentPrepareRequest("prepare-1", "content-1")

	first, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture.clock.now = fixture.clock.now.Add(time.Minute)
	fixture.audiences.snapshot = socialdomain.FriendsSnapshot{
		SourceRevision:   2,
		SourceHeadSHA256: privateDigest("changed-friends"),
		RecipientPTIDs:   []string{"ptid:bob", "ptid:eve"},
	}
	replayedPrepare, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		proto.Clone(prepare).(*privatecontentpb.PreparePrivateMomentRequest),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(first.GetPlan(), replayedPrepare.GetPlan()) {
		t.Fatal("exact prepare replay changed the durable signed plan")
	}
	if fixture.audiences.postCalls != 1 {
		t.Fatalf(
			"prepare replay resolved current FRIENDS snapshot %d times",
			fixture.audiences.postCalls,
		)
	}

	fixture.audiences.snapshot = fixture.originalSnapshot
	submit := privateTextSubmitRequest(
		t,
		first.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-1",
		"ciphertext-1",
	)
	created, err := fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		submit,
	)
	if err != nil {
		t.Fatal(err)
	}
	if created.GetExactReplay() ||
		created.GetPost().GetPrivateContent() == nil ||
		created.GetPost().GetPrivateContent().GetViewerEnvelope() == nil {
		t.Fatalf("unexpected first private submit response: %+v", created)
	}
	if created.GetPost().GetPrivateContent().GetVerification().
		GetStationSigningKeyAttestation() != nil {
		t.Fatal("immutable submit receipt contains a short-lived key attestation")
	}
	bobRead, err := fixture.service.GetPrivateMoment(
		ctx,
		&actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:bob",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "bob-device",
		},
		first.GetPlan().GetResource().GetContentId(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if bobRead.GetResource().GetPrivateContent() == nil ||
		bobRead.GetResource().GetPrivateContent().GetViewerEnvelope().
			GetEndpoint().GetActor().GetPtid() != "ptid:bob" {
		t.Fatalf("Bob private read projection = %+v", bobRead)
	}
	attestation := bobRead.GetResource().GetPrivateContent().GetVerification().
		GetStationSigningKeyAttestation()
	if attestation.GetStationPeerId() != "station-local" ||
		attestation.GetProofSigningKeyId() != "station-key" ||
		attestation.GetAttestingSigningKeyId() != "station-key" ||
		!attestation.GetExpiresAt().AsTime().Equal(
			attestation.GetIssuedAt().AsTime().Add(5*time.Minute),
		) {
		t.Fatalf("Bob private read attestation = %+v", attestation)
	}
	_, err = fixture.service.GetPrivateMoment(
		ctx,
		&actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:eve",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "eve-device",
		},
		first.GetPlan().GetResource().GetContentId(),
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentNotFound,
	) {
		t.Fatalf("Eve private read error = %v", err)
	}
	fixture.clock.now = first.GetPlan().GetExpiresAt().AsTime().Add(time.Minute)
	replayed, err := fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		proto.Clone(submit).(*privatecontentpb.SubmitPrivateMomentRequest),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.GetExactReplay() ||
		!proto.Equal(created.GetPost(), replayed.GetPost()) {
		t.Fatalf("exact submit replay changed business result: %+v", replayed)
	}
	conflict := privateTextSubmitRequest(
		t,
		first.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-1",
		"different-ciphertext",
	)
	if _, err := fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		conflict,
	); !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentConflict,
	) {
		t.Fatalf("conflicting submit error = %v", err)
	}
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateContentPost{},
		1,
	)
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateCommandReceipt{},
		1,
	)
	if err := fixture.database.Exec(
		"DELETE FROM social_relationship_projections WHERE owner_ptid = ? AND peer_ptid = ?",
		"ptid:alice",
		"ptid:bob",
	).Error; err != nil {
		t.Fatal(err)
	}
	_, err = fixture.service.GetPrivateMoment(
		ctx,
		&actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:bob",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "bob-device",
		},
		first.GetPlan().GetResource().GetContentId(),
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentNotFound,
	) {
		t.Fatalf("removed FRIENDS read error = %v", err)
	}
}

func TestPrivateContentServiceReplayReverifiesStoredCommitProof(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		privateMomentPrepareRequest(
			"prepare-replay-proof",
			"content-replay-proof",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-replay-proof",
		"ciphertext-replay-proof",
	)
	if _, err := fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		submit,
	); err != nil {
		t.Fatal(err)
	}

	var receipt dbmodel.SocialPrivateCommandReceipt
	if err := fixture.database.Where(
		"author_ptid = ? AND command_id = ?",
		fixture.author.Endpoint.GetActor().GetPtid(),
		submit.GetCommandId(),
	).Take(&receipt).Error; err != nil {
		t.Fatal(err)
	}
	response := &privatecontentpb.SubmitPrivateMomentResponse{}
	if err := proto.Unmarshal(receipt.ResponseBytes, response); err != nil {
		t.Fatal(err)
	}
	proof := response.GetPost().GetPrivateContent().
		GetVerification().GetCommitProof()
	proof.StationSignature[0] ^= 0xff
	responseBytes, err := socialdomain.CanonicalProtoBytes(response)
	if err != nil {
		t.Fatal(err)
	}
	responseHash := sha256.Sum256(responseBytes)
	if err := fixture.database.Model(
		&dbmodel.SocialPrivateCommandReceipt{},
	).Where(
		"author_ptid = ? AND command_id = ?",
		receipt.AuthorPTID,
		receipt.CommandID,
	).Updates(map[string]any{
		"response_bytes":  responseBytes,
		"response_sha256": responseHash[:],
	}).Error; err != nil {
		t.Fatal(err)
	}

	_, err = fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		proto.Clone(submit).(*privatecontentpb.SubmitPrivateMomentRequest),
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentIntegrityFailed,
	) {
		t.Fatalf("forged replay proof error = %v", err)
	}
}

func TestPrivateContentServiceReplayFailsWhenProofKeyIsUnavailable(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		privateMomentPrepareRequest(
			"prepare-replay-missing-key",
			"content-replay-missing-key",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-replay-missing-key",
		"ciphertext-replay-missing-key",
	)
	if _, err := fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		submit,
	); err != nil {
		t.Fatal(err)
	}
	fixture.service.stationSigner = privateContentUnavailableVerifier{
		PrivateContentStationSigner: fixture.service.stationSigner,
	}

	response, err := fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		proto.Clone(submit).(*privatecontentpb.SubmitPrivateMomentRequest),
	)
	if response != nil {
		t.Fatalf("missing proof key exposed replay payload: %+v", response)
	}
	if !errors.Is(err, authfed.ErrContentProofKeyUnavailable) {
		t.Fatalf("missing replay proof key error = %v", err)
	}
}

func TestPrivateContentServiceRejectsStaleFriendsAtomically(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		privateMomentPrepareRequest("prepare-stale", "content-stale"),
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture.audiences.snapshot = socialdomain.FriendsSnapshot{
		SourceRevision:   2,
		SourceHeadSHA256: privateDigest("friends-advanced"),
		RecipientPTIDs:   []string{"ptid:bob"},
	}
	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-stale",
		"ciphertext-stale",
	)
	_, err = fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		submit,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentStalePlan,
	) {
		t.Fatalf("stale submit error = %v", err)
	}

	var plan dbmodel.SocialPrivateContentPlan
	if err := fixture.database.First(
		&plan,
		"plan_id = ?",
		prepared.GetPlan().GetPlanId(),
	).Error; err != nil {
		t.Fatal(err)
	}
	if plan.State != dbmodel.SocialPrivatePlanStateRejectedStale {
		t.Fatalf("stale plan state = %q", plan.State)
	}
	for _, model := range []any{
		&dbmodel.SocialPrivateContentPost{},
		&dbmodel.SocialPrivateAudienceSnapshot{},
		&dbmodel.SocialPrivateRecipientGrant{},
		&dbmodel.SocialPrivateContentEnvelope{},
		&dbmodel.SocialPrivateDeliveryIntent{},
		&dbmodel.SocialPrivateCommitProof{},
		&dbmodel.SocialPrivateCommandReceipt{},
	} {
		assertPrivateContentCount(t, fixture.database, model, 0)
	}
}

func TestPrivateContentServiceRejectsStalePreKeyClaimsAtomically(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		privateMomentPrepareRequest("prepare-key-stale", "content-key-stale"),
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture.keyExchange.stale = true
	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-key-stale",
		"ciphertext-key-stale",
	)
	_, err = fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		submit,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentStalePlan,
	) {
		t.Fatalf("stale Key Exchange submit error = %v", err)
	}
	var plan dbmodel.SocialPrivateContentPlan
	if err := fixture.database.First(
		&plan,
		"plan_id = ?",
		prepared.GetPlan().GetPlanId(),
	).Error; err != nil {
		t.Fatal(err)
	}
	if plan.State != dbmodel.SocialPrivatePlanStateRejectedStale {
		t.Fatalf("stale Key Exchange plan state = %q", plan.State)
	}
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateContentPost{},
		0,
	)
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateCommandReceipt{},
		0,
	)
}

func TestPrivateContentServiceExpiredPreparingDoesNotClaimPreKeys(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	request := privateMomentPrepareRequest(
		"prepare-expired",
		"content-expired",
	)
	material, err := socialdomain.CanonicalizePrivateMomentPrepare(request)
	if err != nil {
		t.Fatal(err)
	}
	_, snapshotHash, err := socialdomain.NormalizeFriendsSnapshot(
		"test.expired_prepare",
		fixture.author.Endpoint.GetActor().GetPtid(),
		fixture.originalSnapshot,
	)
	if err != nil {
		t.Fatal(err)
	}
	targets, err := privateContentTestRecipients{
		author: fixture.author.Endpoint,
	}.ResolveContentPreKeyTargets(
		ctx,
		fixture.author.Endpoint,
		fixture.originalSnapshot.RecipientPTIDs,
	)
	if err != nil {
		t.Fatal(err)
	}
	targets, err = normalizeClaimTargets(
		"test.expired_prepare",
		fixture.author.Endpoint,
		fixture.originalSnapshot.RecipientPTIDs,
		targets,
	)
	if err != nil {
		t.Fatal(err)
	}
	planID := deterministicPrivateID(
		"plan",
		fixture.author.Endpoint.GetActor().GetPtid(),
		material.CommandID,
	)
	claimRequest := &securecontentpb.ClaimContentPreKeysRequest{
		PlanId:            planID,
		PlanRequestSha256: material.CanonicalSHA256[:],
		Targets:           targets,
	}
	claimBytes, err := socialdomain.CanonicalProtoBytes(claimRequest)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.store.ClaimPreparing(
		ctx,
		dbmodel.SocialPrivateContentPlan{
			PlanID:                  planID,
			AuthorPTID:              fixture.author.Endpoint.GetActor().GetPtid(),
			PrepareCommandID:        material.CommandID,
			ContentID:               material.ContentID,
			Generation:              1,
			ResourceKind:            string(material.ResourceKind),
			AuthorDeviceID:          fixture.author.Endpoint.GetDeviceId(),
			AuthorHomeStationPeerID: fixture.author.HomeStationPeerID,
			AudienceSnapshotID: deterministicPrivateID(
				"snapshot",
				planID,
			),
			AuthorizationSnapshotSHA256: snapshotHash[:],
			CanonicalPrepareBytes:       material.CanonicalBytes,
			CanonicalPrepareSHA256:      material.CanonicalSHA256[:],
			ClaimRequestBytes:           claimBytes,
			ClaimRequestSHA256:          privateSHA256(claimBytes),
			State:                       dbmodel.SocialPrivatePlanStatePreparing,
			ExpiresAt: fixture.clock.now.Add(
				socialdomain.PrivateContentPlanLifetime,
			),
		},
	); err != nil {
		t.Fatal(err)
	}
	fixture.clock.now = fixture.clock.now.Add(
		socialdomain.PrivateContentPlanLifetime + time.Minute,
	)
	_, err = fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		request,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentExpiredPlan,
	) {
		t.Fatalf("expired prepare error = %v", err)
	}
	if fixture.keyExchange.claimCalls != 0 {
		t.Fatalf(
			"expired prepare claimed PreKeys %d times",
			fixture.keyExchange.claimCalls,
		)
	}
}

func TestPrivateContentServicePrepareSubmitComment(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	parentID := privateTestContentID("parent-post")
	prepared, err := fixture.service.PreparePrivateComment(
		ctx,
		fixture.author,
		&privatecontentpb.PreparePrivateCommentRequest{
			PostId:           parentID,
			CommentContentId: privateTestContentID("comment-content"),
			CommandId:        "prepare-comment",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	momentSubmit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-comment",
		"comment-ciphertext",
	)
	response, err := fixture.service.SubmitPrivateComment(
		ctx,
		fixture.author.Endpoint,
		&privatecontentpb.SubmitPrivateCommentRequest{
			Plan:      momentSubmit.GetPlan(),
			Payload:   momentSubmit.GetPayload(),
			Envelopes: momentSubmit.GetEnvelopes(),
			Objects:   momentSubmit.GetObjects(),
			CommandId: momentSubmit.GetCommandId(),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.GetExactReplay() ||
		response.GetComment().GetMetadata().GetPostId() != parentID ||
		response.GetComment().GetPrivateContent() == nil {
		t.Fatalf("private Comment response = %+v", response)
	}
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateContentComment{},
		1,
	)
}

func TestPrivateContentServiceReadRejectsPersistedTampering(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		privateMomentPrepareRequest("prepare-tamper", "content-tamper"),
	)
	if err != nil {
		t.Fatal(err)
	}
	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-tamper",
		"ciphertext-tamper",
	)
	if _, err := fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		submit,
	); err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.Model(
		&dbmodel.SocialPrivateContentPost{},
	).Where(
		"content_id = ?",
		prepared.GetPlan().GetResource().GetContentId(),
	).Update(
		"encrypted_payload_bytes",
		[]byte("tampered"),
	).Error; err != nil {
		t.Fatal(err)
	}
	_, err = fixture.service.GetPrivateMoment(
		ctx,
		&actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:bob",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "bob-device",
		},
		prepared.GetPlan().GetResource().GetContentId(),
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentIntegrityFailed,
	) {
		t.Fatalf("tampered read error = %v", err)
	}
}

func TestPrivateContentServiceReadRejectsForgedCommitProofSignature(
	t *testing.T,
) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		privateMomentPrepareRequest("prepare-proof-tamper", "content-proof-tamper"),
	)
	if err != nil {
		t.Fatal(err)
	}
	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-proof-tamper",
		"ciphertext-proof-tamper",
	)
	if _, err := fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		submit,
	); err != nil {
		t.Fatal(err)
	}

	var row dbmodel.SocialPrivateCommitProof
	if err := fixture.database.Where(
		"content_id = ?",
		prepared.GetPlan().GetResource().GetContentId(),
	).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	proof := &securecontentpb.ViewerContentCommitProof{}
	if err := proto.Unmarshal(row.CanonicalProofBytes, proof); err != nil {
		t.Fatal(err)
	}
	proof.StationSignature[0] ^= 0xff
	proofBytes, err := socialdomain.CanonicalProtoBytes(proof)
	if err != nil {
		t.Fatal(err)
	}
	proofHash := sha256.Sum256(proofBytes)
	if err := fixture.database.Model(
		&dbmodel.SocialPrivateCommitProof{},
	).Where(
		"content_id = ? AND generation = ?",
		row.ContentID,
		row.Generation,
	).Updates(map[string]any{
		"canonical_proof_bytes":  proofBytes,
		"canonical_proof_sha256": proofHash[:],
	}).Error; err != nil {
		t.Fatal(err)
	}

	_, err = fixture.service.GetPrivateMoment(
		ctx,
		&actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:bob",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "bob-device",
		},
		prepared.GetPlan().GetResource().GetContentId(),
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentIntegrityFailed,
	) {
		t.Fatalf("forged proof signature error = %v", err)
	}
}

type privateContentServiceFixture struct {
	database         *gorm.DB
	service          *PrivateContentService
	store            *infrastructure.GORMPrivateContentStore
	author           socialdomain.PrivateContentAuthor
	authorPrivateKey ed25519.PrivateKey
	audiences        *privateContentTestAudience
	originalSnapshot socialdomain.FriendsSnapshot
	clock            *privateContentTestClock
	keyExchange      *privateContentTestKeyExchange
}

func newPrivateContentServiceFixture(
	t *testing.T,
) *privateContentServiceFixture {
	t.Helper()
	database, err := gorm.Open(
		sqlite.Open(
			"file:"+t.Name()+"?mode=memory&cache=shared&_busy_timeout=5000",
		),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if closeErr := sqlDB.Close(); closeErr != nil {
			t.Errorf("close private-content database: %v", closeErr)
		}
	})
	store, err := infrastructure.NewGORMPrivateContentStore(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	friendStore, err := infrastructure.NewGORMFederatedFriendRequestStore(
		database,
		federationdelivery.SystemClock{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := friendStore.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(`
INSERT INTO social_relationship_projections (
  owner_ptid, peer_ptid, request_id, accepted_event_id,
  accepted_event_hash, accepted_at
) VALUES (?, ?, ?, ?, ?, ?)`,
		"ptid:alice",
		"ptid:bob",
		"request-alice-bob",
		"event-alice-bob",
		privateDigest("event-alice-bob"),
		time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC),
	).Error; err != nil {
		t.Fatal(err)
	}

	authorPublicKey, authorPrivateKey, err := ed25519.GenerateKey(
		bytes.NewReader(bytes.Repeat([]byte{0x41}, ed25519.SeedSize)),
	)
	if err != nil {
		t.Fatal(err)
	}
	_, stationPrivateKey, err := ed25519.GenerateKey(
		bytes.NewReader(bytes.Repeat([]byte{0x53}, ed25519.SeedSize)),
	)
	if err != nil {
		t.Fatal(err)
	}
	author := socialdomain.PrivateContentAuthor{
		Endpoint: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:alice",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "alice-device",
		},
		HomeStationPeerID: "station-local",
	}
	snapshot := socialdomain.FriendsSnapshot{
		SourceRevision:   1,
		SourceHeadSHA256: privateDigest("friends-v1"),
		RecipientPTIDs:   []string{"ptid:bob"},
	}
	audiences := &privateContentTestAudience{snapshot: snapshot}
	keyExchange := &privateContentTestKeyExchange{}
	clock := &privateContentTestClock{
		now: time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC),
	}
	service, err := NewPrivateContentService(
		store,
		audiences,
		privateContentTestRecipients{author: author.Endpoint},
		keyExchange,
		privateContentTestSigner{
			keyID:      "station-key",
			privateKey: stationPrivateKey,
		},
		privateContentTestAuthorVerifier{publicKey: authorPublicKey},
		clock,
	)
	if err != nil {
		t.Fatal(err)
	}
	return &privateContentServiceFixture{
		database:         database,
		service:          service,
		store:            store,
		author:           author,
		authorPrivateKey: authorPrivateKey,
		audiences:        audiences,
		originalSnapshot: snapshot,
		clock:            clock,
		keyExchange:      keyExchange,
	}
}

type privateContentTestAudience struct {
	snapshot  socialdomain.FriendsSnapshot
	postCalls int
}

func (a *privateContentTestAudience) ResolveFriendsPostSnapshot(
	context.Context,
	federationdelivery.Transaction,
	string,
) (socialdomain.FriendsSnapshot, error) {
	a.postCalls++
	return a.snapshot, nil
}

func (a *privateContentTestAudience) ResolvePrivateCommentSnapshot(
	context.Context,
	federationdelivery.Transaction,
	string,
	string,
	string,
) (socialdomain.FriendsSnapshot, error) {
	return a.snapshot, nil
}

type privateContentTestRecipients struct {
	author *actormodel.ActorDeviceRef
}

func (r privateContentTestRecipients) ResolveContentPreKeyTargets(
	_ context.Context,
	_ *actormodel.ActorDeviceRef,
	recipients []string,
) ([]*securecontentpb.ContentPreKeyClaimTarget, error) {
	actors := append([]string{r.author.GetActor().GetPtid()}, recipients...)
	targets := make(
		[]*securecontentpb.ContentPreKeyClaimTarget,
		0,
		len(actors)*2,
	)
	for _, actorPTID := range actors {
		deviceID := "bob-device"
		if actorPTID == r.author.GetActor().GetPtid() {
			deviceID = r.author.GetDeviceId()
		}
		targets = append(
			targets,
			privateContentEndpointTarget(actorPTID, deviceID),
			privateContentRecoveryTarget(actorPTID),
		)
	}
	return targets, nil
}

func (r privateContentTestRecipients) ValidateActiveEndpoint(
	_ context.Context,
	endpoint *actormodel.ActorDeviceRef,
) error {
	if endpoint == nil || endpoint.GetActor() == nil ||
		endpoint.GetDeviceId() == "revoked-device" {
		return fmt.Errorf("endpoint is inactive")
	}
	return nil
}

type privateContentTestKeyExchange struct {
	request    *securecontentpb.ClaimContentPreKeysRequest
	response   *securecontentpb.ClaimContentPreKeysResponse
	stale      bool
	claimCalls int
}

func (k *privateContentTestKeyExchange) ClaimContentPreKeys(
	_ context.Context,
	request *securecontentpb.ClaimContentPreKeysRequest,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	k.claimCalls++
	k.request = proto.Clone(
		request,
	).(*securecontentpb.ClaimContentPreKeysRequest)
	response := &securecontentpb.ClaimContentPreKeysResponse{}
	for index, target := range request.GetTargets() {
		prekey := &securecontentpb.ContentOneTimePreKey{
			Kind: target.GetKind(),
			KeyId: fmt.Sprintf(
				"prekey-%02d-%02d",
				k.claimCalls,
				index,
			),
			X25519PublicKey:        bytes.Repeat([]byte{byte(index + 1)}, 32),
			ProfileOrRecoveryEpoch: uint64(index + 1),
			IssuerSignature:        bytes.Repeat([]byte{byte(index + 11)}, 64),
		}
		switch target.GetKind() {
		case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
			prekey.Principal = &securecontentpb.ContentOneTimePreKey_Endpoint{
				Endpoint: proto.Clone(
					target.GetEndpoint(),
				).(*actormodel.ActorDeviceRef),
			}
		case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
			prekey.Principal = &securecontentpb.ContentOneTimePreKey_RecoveryActor{
				RecoveryActor: proto.Clone(
					target.GetRecoveryActor(),
				).(*actormodel.ActorRef),
			}
		}
		response.Claims = append(response.Claims, &securecontentpb.ClaimedContentPreKey{
			ClaimId: fmt.Sprintf(
				"claim-%02d-%02d",
				k.claimCalls,
				index,
			),
			Target: proto.Clone(
				target,
			).(*securecontentpb.ContentPreKeyClaimTarget),
			Prekey:               prekey,
			IrreversiblyConsumed: true,
		})
	}
	k.response = proto.Clone(
		response,
	).(*securecontentpb.ClaimContentPreKeysResponse)
	return response, nil
}

func (k *privateContentTestKeyExchange) ValidateContentPreKeyClaims(
	_ context.Context,
	transaction federationdelivery.Transaction,
	request *securecontentpb.ClaimContentPreKeysRequest,
	response *securecontentpb.ClaimContentPreKeysResponse,
) error {
	if transaction == nil || transaction.DB() == nil {
		return fmt.Errorf("validation transaction is missing")
	}
	if k.stale {
		return keyexchangedomain.NewError(
			keyexchangedomain.ErrorCodeStaleMaterial,
			"test.validate_content_prekey_claims",
			"claim",
			"is stale",
		)
	}
	if !proto.Equal(request, k.request) || !proto.Equal(response, k.response) {
		return fmt.Errorf("claim request or response changed")
	}
	return nil
}

type privateContentTestSigner struct {
	keyID      string
	privateKey ed25519.PrivateKey
}

func (s privateContentTestSigner) SigningKeyID(context.Context) (string, error) {
	return s.keyID, nil
}

func (s privateContentTestSigner) SigningKeyIDInTransaction(
	context.Context,
	federationdelivery.Transaction,
) (string, error) {
	return s.keyID, nil
}

func (s privateContentTestSigner) Sign(
	_ context.Context,
	keyID string,
	canonical []byte,
) ([]byte, error) {
	if keyID != s.keyID {
		return nil, fmt.Errorf("unexpected key ID")
	}
	return ed25519.Sign(s.privateKey, canonical), nil
}

func (s privateContentTestSigner) SignInTransaction(
	ctx context.Context,
	_ federationdelivery.Transaction,
	keyID string,
	canonical []byte,
) ([]byte, error) {
	return s.Sign(ctx, keyID, canonical)
}

func (s privateContentTestSigner) Verify(
	_ context.Context,
	keyID string,
	canonical []byte,
	signature []byte,
) error {
	if keyID != s.keyID ||
		!ed25519.Verify(s.privateKey.Public().(ed25519.PublicKey), canonical, signature) {
		return fmt.Errorf("invalid Station signature")
	}
	return nil
}

func (s privateContentTestSigner) VerifyInTransaction(
	ctx context.Context,
	_ federationdelivery.Transaction,
	keyID string,
	canonical []byte,
	signature []byte,
) error {
	return s.Verify(ctx, keyID, canonical, signature)
}

func (s privateContentTestSigner) AttestContentProofVerificationKey(
	_ context.Context,
	signingKeyID string,
	now time.Time,
) (*securecontentpb.StationContentSigningKeyAttestation, error) {
	if signingKeyID != s.keyID {
		return nil, fmt.Errorf("unexpected proof key ID")
	}
	publicKey := s.privateKey.Public().(ed25519.PublicKey)
	return &securecontentpb.StationContentSigningKeyAttestation{
		FormatVersion:         1,
		StationPeerId:         "station-local",
		ProofSigningKeyId:     signingKeyID,
		ProofEd25519PublicKey: append([]byte(nil), publicKey...),
		AttestingSigningKeyId: s.keyID,
		IssuedAt:              timestamppb.New(now),
		ExpiresAt:             timestamppb.New(now.Add(5 * time.Minute)),
		StationSignature:      ed25519.Sign(s.privateKey, []byte("test-attestation")),
	}, nil
}

type privateContentUnavailableVerifier struct {
	PrivateContentStationSigner
}

func (privateContentUnavailableVerifier) Verify(
	context.Context,
	string,
	[]byte,
	[]byte,
) error {
	return authfed.ErrContentProofKeyUnavailable
}

func (privateContentUnavailableVerifier) VerifyInTransaction(
	context.Context,
	federationdelivery.Transaction,
	string,
	[]byte,
	[]byte,
) error {
	return authfed.ErrContentProofKeyUnavailable
}

type privateContentTestAuthorVerifier struct {
	publicKey ed25519.PublicKey
}

func (v privateContentTestAuthorVerifier) Verify(
	_ context.Context,
	_ federationdelivery.Transaction,
	_ *actormodel.ActorDeviceRef,
	_ string,
	canonical []byte,
	signature []byte,
) error {
	if !ed25519.Verify(v.publicKey, canonical, signature) {
		return fmt.Errorf("invalid author signature")
	}
	return nil
}

type privateContentTestClock struct {
	now time.Time
}

func (c *privateContentTestClock) Now() time.Time {
	return c.now
}

func privateMomentPrepareRequest(
	commandID string,
	contentID string,
) *privatecontentpb.PreparePrivateMomentRequest {
	return &privatecontentpb.PreparePrivateMomentRequest{
		ContentId: privateTestContentID(contentID),
		Audience: &actormodel.Audience{
			Kind: actormodel.Audience_FRIENDS,
		},
		CommandId: commandID,
		Kind: privatecontentpb.
			PrivateMomentKind_PRIVATE_MOMENT_KIND_TEXT,
	}
}

func privateTestContentID(label string) string {
	entropy := sha256.Sum256([]byte(label))
	return ulid.MustNew(
		ulid.Timestamp(
			time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC),
		),
		bytes.NewReader(entropy[:]),
	).String()
}

func privateTextSubmitRequest(
	t *testing.T,
	plan *securecontentpb.ContentEncryptionPlan,
	author *actormodel.ActorDeviceRef,
	authorPrivateKey ed25519.PrivateKey,
	commandID string,
	ciphertext string,
) *privatecontentpb.SubmitPrivateMomentRequest {
	return privateMomentSubmitRequest(
		t,
		plan,
		author,
		authorPrivateKey,
		commandID,
		ciphertext,
		nil,
	)
}

func privateImageSubmitRequest(
	t *testing.T,
	plan *securecontentpb.ContentEncryptionPlan,
	author *actormodel.ActorDeviceRef,
	authorPrivateKey ed25519.PrivateKey,
	commandID string,
	ciphertext string,
	descriptor *securecontentpb.EncryptedObjectDescriptor,
) *privatecontentpb.SubmitPrivateMomentRequest {
	return privateMomentSubmitRequest(
		t,
		plan,
		author,
		authorPrivateKey,
		commandID,
		ciphertext,
		[]*securecontentpb.EncryptedObjectDescriptor{descriptor},
	)
}

func privateMomentSubmitRequest(
	t *testing.T,
	plan *securecontentpb.ContentEncryptionPlan,
	author *actormodel.ActorDeviceRef,
	authorPrivateKey ed25519.PrivateKey,
	commandID string,
	ciphertext string,
	objects []*securecontentpb.EncryptedObjectDescriptor,
) *privatecontentpb.SubmitPrivateMomentRequest {
	t.Helper()
	ciphertextBytes := []byte(ciphertext)
	if len(ciphertextBytes) < 16 {
		ciphertextBytes = append(
			ciphertextBytes,
			bytes.Repeat([]byte{0x7f}, 16-len(ciphertextBytes))...,
		)
	}
	ciphertextHash := sha256.Sum256(ciphertextBytes)
	payload := &securecontentpb.EncryptedPayload{
		FormatVersion: 1,
		Resource: proto.Clone(
			plan.GetResource(),
		).(*securecontentpb.SecureResourceRef),
		Suite: securecontentpb.
			PayloadEncryptionSuite_PAYLOAD_ENCRYPTION_SUITE_AES_256_GCM,
		Nonce:            bytes.Repeat([]byte{0x31}, 12),
		Ciphertext:       ciphertextBytes,
		CiphertextSha256: ciphertextHash[:],
		AadSha256: clonePrivateTestBytes(
			plan.GetDomainBindingSha256(),
		),
	}
	objectSetHash := sha256.Sum256(nil)
	if len(objects) != 0 {
		_, calculatedObjectSetHash, err :=
			socialdomain.CanonicalizePrivateObjects(
				"test.private_image_submit",
				plan,
				objects,
				securecontentkernel.DefaultPolicy(),
			)
		if err != nil {
			t.Fatal(err)
		}
		objectSetHash = calculatedObjectSetHash
	}
	envelopes := make(
		[]*securecontentpb.PreparedContentKeyEnvelope,
		0,
		len(plan.GetRequiredSlots()),
	)
	for index, slot := range plan.GetRequiredSlots() {
		binding := &securecontentpb.ContentKeyEnvelopeBinding{
			FormatVersion:               1,
			PlanId:                      plan.GetPlanId(),
			CanonicalPlanSha256:         clonePrivateTestBytes(plan.GetCanonicalPlanSha256()),
			Resource:                    proto.Clone(plan.GetResource()).(*securecontentpb.SecureResourceRef),
			RecipientSlotId:             slot.GetRecipientSlotId(),
			RecipientKeyKind:            slot.GetKeyKind(),
			RecipientKeyId:              slot.GetOneTimeKeyId(),
			PrincipalBindingSha256:      clonePrivateTestBytes(slot.GetPrincipalBindingSha256()),
			AuthorizationSnapshotSha256: clonePrivateTestBytes(plan.GetAuthorizationSnapshotSha256()),
			PayloadCiphertextSha256:     ciphertextHash[:],
			ObjectDescriptorSetSha256:   objectSetHash[:],
			PlanExpiresAt:               plan.GetExpiresAt(),
			Sender:                      proto.Clone(author).(*actormodel.ActorDeviceRef),
			SenderSigningKeyId:          "author-key",
		}
		bindingHash, err := securecontentkernel.EnvelopeBindingSHA256(binding)
		if err != nil {
			t.Fatal(err)
		}
		signingBytes, err := securecontentkernel.CanonicalEnvelopeBindingBytes(
			binding,
		)
		if err != nil {
			t.Fatal(err)
		}
		envelopes = append(envelopes, &securecontentpb.PreparedContentKeyEnvelope{
			Binding:       binding,
			BindingSha256: clonePrivateTestBytes(bindingHash[:]),
			HpkeEncapsulatedKey: bytes.Repeat(
				[]byte{byte(index + 21)},
				32,
			),
			HpkeCiphertext: bytes.Repeat([]byte{byte(index + 31)}, 32),
			SenderSignature: ed25519.Sign(
				authorPrivateKey,
				signingBytes,
			),
		})
	}
	return &privatecontentpb.SubmitPrivateMomentRequest{
		Plan:      proto.Clone(plan).(*securecontentpb.ContentEncryptionPlan),
		Payload:   payload,
		Envelopes: envelopes,
		Objects:   objects,
		CommandId: commandID,
	}
}

func privateContentEndpointTarget(
	actorPTID string,
	deviceID string,
) *securecontentpb.ContentPreKeyClaimTarget {
	return &securecontentpb.ContentPreKeyClaimTarget{
		Kind: securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT,
		Principal: &securecontentpb.ContentPreKeyClaimTarget_Endpoint{
			Endpoint: &actormodel.ActorDeviceRef{
				Actor:    &actormodel.ActorRef{Ptid: actorPTID},
				DeviceId: deviceID,
			},
		},
	}
}

func privateContentRecoveryTarget(
	actorPTID string,
) *securecontentpb.ContentPreKeyClaimTarget {
	return &securecontentpb.ContentPreKeyClaimTarget{
		Kind: securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY,
		Principal: &securecontentpb.ContentPreKeyClaimTarget_RecoveryActor{
			RecoveryActor: &actormodel.ActorRef{Ptid: actorPTID},
		},
	}
}

func privateDigest(value string) []byte {
	digest := sha256.Sum256([]byte(value))
	return clonePrivateTestBytes(digest[:])
}

func clonePrivateTestBytes(value []byte) []byte {
	return append([]byte(nil), value...)
}

func assertPrivateContentCount(
	t *testing.T,
	database *gorm.DB,
	model any,
	expected int64,
) {
	t.Helper()
	var actual int64
	if err := database.Model(model).Count(&actual).Error; err != nil {
		t.Fatal(err)
	}
	if actual != expected {
		t.Fatalf("%T row count = %d, want %d", model, actual, expected)
	}
}
