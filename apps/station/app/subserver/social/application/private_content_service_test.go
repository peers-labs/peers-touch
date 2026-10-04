package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
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
		Audience:         &actormodel.Audience{Kind: actormodel.Audience_FRIENDS},
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
	metadata := created.GetPost().GetMetadata()
	proof := created.GetPost().GetPrivateContent().GetVerification().GetCommitProof()
	if metadata.GetPostId() == "" ||
		metadata.GetPostId() != metadata.GetContentId() ||
		proof.GetDomainCommitId() != metadata.GetPostId() ||
		proof.GetResource().GetContentId() != metadata.GetPostId() {
		t.Fatalf(
			"private Moment commit identity is not the resource identity: metadata=%+v proof=%+v",
			metadata,
			proof,
		)
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
	if !proto.Equal(
		bobRead.GetResource().GetMetadata().GetAuthor(),
		bobRead.GetResource().GetPrivateContent().GetVerification().
			GetCommitProof().GetAuthor().GetActor(),
	) {
		t.Fatal("Bob private read metadata does not preserve the proven author identity")
	}
	attestation := bobRead.GetResource().GetPrivateContent().GetVerification().
		GetStationSigningKeyAttestation()
	if attestation.GetStationPeerId() != "station-local" ||
		attestation.GetProofSigningKeyId() != proof.GetStationSigningKeyId() ||
		attestation.GetAttestingSigningKeyId() != proof.GetStationSigningKeyId() ||
		!attestation.GetExpiresAt().AsTime().Equal(
			attestation.GetIssuedAt().AsTime().Add(5*time.Minute),
		) {
		t.Fatalf("Bob private read attestation = %+v", attestation)
	}
	if err := fixture.database.Where(
		"content_id = ? AND key_kind = ? AND recipient_ptid = ? AND recipient_device_id = ?",
		first.GetPlan().GetResource().GetContentId(),
		infrastructure.PrivateContentKeyKindEndpoint,
		"ptid:bob",
		"bob-device",
	).Delete(&dbmodel.SocialPrivateContentEnvelope{}).Error; err != nil {
		t.Fatal(err)
	}
	recoveryPointRead, err := fixture.service.GetPrivateMoment(
		ctx,
		&actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:bob",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "bob-recovered-device",
		},
		first.GetPlan().GetResource().GetContentId(),
	)
	if err != nil {
		t.Fatal(err)
	}
	privatePointRead := recoveryPointRead.GetResource().GetPrivateContent()
	if privatePointRead == nil ||
		privatePointRead.GetViewerEnvelope() != nil ||
		privatePointRead.GetPayload() == nil ||
		privatePointRead.GetVerification().GetCommitProof() == nil {
		t.Fatalf(
			"recovery point read did not preserve ciphertext/proof without an endpoint envelope: %+v",
			recoveryPointRead,
		)
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

func TestPrivateContentServicePrepareSubmitSelfWithoutRecipientRows(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	prepare := privateMomentPrepareRequest(
		"prepare-self",
		"content-self",
	)
	prepare.Audience = &actormodel.Audience{
		Kind: actormodel.Audience_SELF,
	}
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(prepared.GetPlan().GetRequiredSlots()) != 2 {
		t.Fatalf(
			"SELF required slots = %d, want author endpoint and recovery slots",
			len(prepared.GetPlan().GetRequiredSlots()),
		)
	}

	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-self",
		"self-ciphertext",
	)
	created, err := fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		submit,
	)
	if err != nil {
		t.Fatal(err)
	}
	if created.GetPost().GetMetadata().GetAudienceKind() !=
		actormodel.Audience_SELF ||
		created.GetPost().GetPrivateContent().GetViewerEnvelope().
			GetEndpoint().GetActor().GetPtid() != "ptid:alice" {
		t.Fatalf("unexpected SELF submit response: %+v", created)
	}

	read, err := fixture.service.GetPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		prepared.GetPlan().GetResource().GetContentId(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if read.GetResource().GetMetadata().GetAudienceKind() !=
		actormodel.Audience_SELF ||
		read.GetResource().GetPrivateContent().GetViewerEnvelope().
			GetEndpoint().GetActor().GetPtid() != "ptid:alice" {
		t.Fatalf("unexpected SELF author read: %+v", read)
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
		socialdomain.PrivateContentNotFound,
	) {
		t.Fatalf("SELF non-author read error = %v", err)
	}

	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateRecipientGrant{},
		0,
	)
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateDeliveryIntent{},
		0,
	)
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateContentEnvelope{},
		2,
	)
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
		Audience:         &actormodel.Audience{Kind: actormodel.Audience_FRIENDS},
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

func TestPrivateContentServiceClassifiesPreKeyValidationFailures(t *testing.T) {
	tests := []struct {
		name      string
		slug      string
		code      keyexchangedomain.ErrorCode
		wantState string
	}{
		{
			name:      "invalid material is terminal",
			slug:      "invalid-material",
			code:      keyexchangedomain.ErrorCodeInvalidMaterial,
			wantState: dbmodel.SocialPrivatePlanStateRejectedStale,
		},
		{
			name:      "dependency failure is retryable",
			slug:      "dependency",
			code:      keyexchangedomain.ErrorCodeDependency,
			wantState: dbmodel.SocialPrivatePlanStatePrepared,
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newPrivateContentServiceFixture(t)
			ctx := context.Background()
			prepared, err := fixture.service.PreparePrivateMoment(
				ctx,
				fixture.author,
				privateMomentPrepareRequest(
					"prepare-validation-"+testCase.slug,
					"content-validation-"+testCase.slug,
				),
			)
			if err != nil {
				t.Fatal(err)
			}
			fixture.keyExchange.validationError = keyexchangedomain.NewError(
				testCase.code,
				"test.validate_content_prekey_claims",
				"claim",
				"validation failed",
			)
			submit := privateTextSubmitRequest(
				t,
				prepared.GetPlan(),
				fixture.author.Endpoint,
				fixture.authorPrivateKey,
				"submit-validation-"+testCase.slug,
				"ciphertext-validation-"+testCase.slug,
			)
			if _, err := fixture.service.SubmitPrivateMoment(
				ctx,
				fixture.author.Endpoint,
				submit,
			); err == nil {
				t.Fatal("validation failure unexpectedly committed")
			}
			var plan dbmodel.SocialPrivateContentPlan
			if err := fixture.database.First(
				&plan,
				"plan_id = ?",
				prepared.GetPlan().GetPlanId(),
			).Error; err != nil {
				t.Fatal(err)
			}
			if plan.State != testCase.wantState {
				t.Fatalf(
					"validation failure plan state = %q, want %q",
					plan.State,
					testCase.wantState,
				)
			}
			assertPrivateContentCount(
				t,
				fixture.database,
				&dbmodel.SocialPrivateContentPost{},
				0,
			)
		})
	}
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
	audienceBytes, err := socialdomain.CanonicalProtoBytes(request.GetAudience())
	if err != nil {
		t.Fatal(err)
	}
	audienceHash := sha256.Sum256(audienceBytes)
	recipientLocalitiesBytes, err :=
		socialdomain.CanonicalRecipientLocalitiesBytes(
			fixture.audiences.snapshot.RecipientLocalities,
		)
	if err != nil {
		t.Fatal(err)
	}
	recipientLocalitiesHash := sha256.Sum256(recipientLocalitiesBytes)
	emptyGroupSnapshotHash := sha256.Sum256(nil)
	emptySubtypeHash := sha256.Sum256(nil)
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
		infrastructure.PrivatePrepareBinding{
			AudienceBytes:                 audienceBytes,
			AudienceSHA256:                audienceHash[:],
			RecipientLocalitiesBytes:      recipientLocalitiesBytes,
			RecipientLocalitiesSHA256:     recipientLocalitiesHash[:],
			GroupRecipientSnapshotSHA256:  emptyGroupSnapshotHash[:],
			SubtypePrepareAuthoritySHA256: emptySubtypeHash[:],
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
	if err := fixture.database.Create(
		&dbmodel.SocialPrivateContentPost{
			PostID:                    parentID,
			ContentID:                 parentID,
			AuthorPTID:                fixture.author.Endpoint.GetActor().GetPtid(),
			Generation:                1,
			AudienceSnapshotID:        "parent-snapshot",
			Kind:                      privateContentPostKindText,
			EncryptedPayloadBytes:     []byte("parent"),
			EncryptedPayloadSHA256:    privateDigest("parent"),
			ObjectDescriptorSetSHA256: privateDigest("parent-objects"),
			LifecycleState:            privateContentActiveState,
			CreatedAt:                 fixture.clock.now,
			UpdatedAt:                 fixture.clock.now,
		},
	).Error; err != nil {
		t.Fatal(err)
	}
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
	var parent dbmodel.SocialPrivateContentPost
	if err := fixture.database.First(
		&parent,
		"post_id = ?",
		parentID,
	).Error; err != nil {
		t.Fatal(err)
	}
	if parent.CommentsCount != 1 {
		t.Fatalf("private parent CommentsCount = %d, want 1", parent.CommentsCount)
	}
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

func TestPrivateContentServiceReadRejectsMismatchedCommitIdentity(
	t *testing.T,
) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		privateMomentPrepareRequest(
			"prepare-commit-identity-tamper",
			"content-commit-identity-tamper",
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
		"submit-commit-identity-tamper",
		"ciphertext-commit-identity-tamper",
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
	forgedCommitID := privateTestContentID("forged-domain-commit")
	proof.DomainCommitId = forgedCommitID
	signingBytes, err := socialdomain.CanonicalCommitProofSigningBytes(proof)
	if err != nil {
		t.Fatal(err)
	}
	proof.StationSignature, err = fixture.service.stationSigner.Sign(
		ctx,
		proof.GetStationSigningKeyId(),
		signingBytes,
	)
	if err != nil {
		t.Fatal(err)
	}
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
		"domain_commit_id":       forgedCommitID,
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
		t.Fatalf("mismatched commit identity error = %v", err)
	}
}

func TestPrivateContentServiceGetPrivateMomentDistinguishesEndpointFailure(
	t *testing.T,
) {
	fixture := newPrivateContentServiceFixture(t)
	viewer := &actormodel.ActorDeviceRef{
		Actor: &actormodel.ActorRef{
			Ptid: "ptid:bob",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		DeviceId: "bob-device",
	}
	tests := []struct {
		name       string
		validation error
		wantCode   socialdomain.PrivateContentErrorCode
	}{
		{
			name: "proven inactive endpoint stays private",
			validation: fmt.Errorf(
				"test endpoint inactive: %w",
				ErrPrivateContentInactiveEndpoint,
			),
			wantCode: socialdomain.PrivateContentNotFound,
		},
		{
			name: "missing actor identity device stays private",
			validation: actoridentitydomain.NewError(
				actoridentitydomain.ErrorCodeDeviceNotFound,
				"actor_identity.get_endpoint_manifest",
				"active_endpoints",
				"has no active locally verified device",
			),
			wantCode: socialdomain.PrivateContentNotFound,
		},
		{
			name: "revoked actor identity device stays private",
			validation: actoridentitydomain.NewError(
				actoridentitydomain.ErrorCodeDeviceRevoked,
				"actor_identity.get_endpoint_manifest",
				"device",
				"is revoked",
			),
			wantCode: socialdomain.PrivateContentNotFound,
		},
		{
			name:       "directory outage remains dependency failure",
			validation: errors.New("endpoint directory unavailable"),
			wantCode:   socialdomain.PrivateContentDependency,
		},
		{
			name: "upstream not-found is not trusted endpoint absence",
			validation: socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentNotFound,
				"test.endpoint_lookup",
				"",
				"manifest lookup failed",
			),
			wantCode: socialdomain.PrivateContentDependency,
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			fixture.service.recipients = privateContentTestRecipients{
				author:        fixture.author.Endpoint,
				validationErr: testCase.validation,
			}
			response, err := fixture.service.GetPrivateMoment(
				context.Background(),
				viewer,
				privateTestContentID("endpoint-validation"),
			)
			if response != nil {
				t.Fatalf("endpoint validation exposed response: %+v", response)
			}
			if !socialdomain.IsPrivateContentCode(err, testCase.wantCode) {
				t.Fatalf(
					"endpoint validation error = %v, want %s",
					err,
					testCase.wantCode,
				)
			}
		})
	}
}

func TestPrivateContentServiceRejectsRepostSourceBeforePreKeyClaim(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	fixture.audiences.repostPrepareErr =
		socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnauthorized,
			"test.repost_source",
			"target.recipients",
			"must be a subset of the source grant",
		)
	request := privateMomentPrepareRequest(
		"prepare-repost-source",
		"content-repost-source",
	)
	request.Kind = privatecontentpb.
		PrivateMomentKind_PRIVATE_MOMENT_KIND_REPOST
	request.RepostAuthority = &privatecontentpb.PrivateRepostAuthority{
		Source: &privatecontentpb.SocialPostSourceRef{
			PostId: "source-post",
		},
		SourceAuthor: &actormodel.ActorRef{
			Ptid: "ptid:source",
			Acct: "source@station.test",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		RenderedSourceCommitment: bytes.Repeat(
			[]byte{0x33},
			sha256.Size,
		),
		SourceProof: &privatecontentpb.PrivateRepostAuthority_PublicSource{
			PublicSource: &privatecontentpb.PublicRepostSourceProof{
				CanonicalPublicPostSha256: bytes.Repeat(
					[]byte{0x44},
					sha256.Size,
				),
			},
		},
	}

	_, err := fixture.service.PreparePrivateMoment(
		context.Background(),
		fixture.author,
		request,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentUnauthorized,
	) {
		t.Fatalf("repost source rejection error = %v", err)
	}
	if fixture.audiences.repostPrepareCalls != 1 {
		t.Fatalf(
			"repost source prepare calls = %d",
			fixture.audiences.repostPrepareCalls,
		)
	}
	if fixture.keyExchange.claimCalls != 0 {
		t.Fatalf(
			"repost source rejection claimed PreKeys %d times",
			fixture.keyExchange.claimCalls,
		)
	}
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateContentPlan{},
		0,
	)
}

func TestPrivateContentServiceMentionRoutingPersistsAndRejectsGrantWidening(
	t *testing.T,
) {
	t.Run("persists exact signed routing for receiver verification", func(t *testing.T) {
		fixture := newPrivateContentServiceFixture(t)
		prepared, err := fixture.service.PreparePrivateMoment(
			context.Background(),
			fixture.author,
			privateMomentPrepareRequest("prepare-mention", "content-mention"),
		)
		if err != nil {
			t.Fatal(err)
		}
		submit := privateTextSubmitRequest(
			t,
			prepared.GetPlan(),
			fixture.author.Endpoint,
			fixture.authorPrivateKey,
			"submit-mention",
			"mention ciphertext",
		)
		routing := privateMentionRouting(
			t,
			submit.GetPlan(),
			submit.GetPayload(),
			fixture.author.Endpoint,
			fixture.authorPrivateKey,
			&actormodel.ActorRef{
				Ptid: "ptid:bob",
				Acct: "bob@station.test",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
		)
		submit.MentionRouting = routing

		created, err := fixture.service.SubmitPrivateMoment(
			context.Background(),
			fixture.author.Endpoint,
			submit,
		)
		if err != nil {
			t.Fatal(err)
		}
		if !proto.Equal(
			created.GetPost().GetPrivateContent().GetVerification().
				GetMentionRouting(),
			routing,
		) {
			t.Fatal("submit response changed the signed mention routing")
		}

		read, err := fixture.service.GetPrivateMoment(
			context.Background(),
			&actormodel.ActorDeviceRef{
				Actor: &actormodel.ActorRef{
					Ptid: "ptid:bob",
					Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
				},
				DeviceId: "bob-device",
			},
			prepared.GetPlan().GetResource().GetContentId(),
		)
		if err != nil {
			t.Fatal(err)
		}
		if !proto.Equal(
			read.GetResource().GetPrivateContent().GetVerification().
				GetMentionRouting(),
			routing,
		) {
			t.Fatal("point read changed the signed mention routing")
		}

		var row dbmodel.SocialPrivateContentPost
		if err := fixture.database.Where(
			"post_id = ?",
			prepared.GetPlan().GetResource().GetContentId(),
		).First(&row).Error; err != nil {
			t.Fatal(err)
		}
		routingBytes, err := socialdomain.CanonicalProtoBytes(routing)
		if err != nil {
			t.Fatal(err)
		}
		routingHash := sha256.Sum256(routingBytes)
		if !bytes.Equal(row.MentionRoutingBytes, routingBytes) ||
			!bytes.Equal(row.MentionRoutingSHA256, routingHash[:]) {
			t.Fatal("persisted mention routing does not match the submit bundle")
		}
	})

	t.Run("rejects a mentioned actor outside the frozen grant", func(t *testing.T) {
		fixture := newPrivateContentServiceFixture(t)
		prepared, err := fixture.service.PreparePrivateMoment(
			context.Background(),
			fixture.author,
			privateMomentPrepareRequest(
				"prepare-mention-widened",
				"content-mention-widened",
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
			"submit-mention-widened",
			"mention widened ciphertext",
		)
		submit.MentionRouting = privateMentionRouting(
			t,
			submit.GetPlan(),
			submit.GetPayload(),
			fixture.author.Endpoint,
			fixture.authorPrivateKey,
			&actormodel.ActorRef{
				Ptid: "ptid:eve",
				Acct: "eve@station.test",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
		)

		_, err = fixture.service.SubmitPrivateMoment(
			context.Background(),
			fixture.author.Endpoint,
			submit,
		)
		if !socialdomain.IsPrivateContentCode(
			err,
			socialdomain.PrivateContentUnauthorized,
		) {
			t.Fatalf("grant-widening mention error = %v", err)
		}
		assertPrivateContentCount(
			t,
			fixture.database,
			&dbmodel.SocialPrivateContentPost{},
			0,
		)
	})

	t.Run("persists exact signed routing for private Comments", func(t *testing.T) {
		fixture := newPrivateContentServiceFixture(t)
		postID := publishPrivateCommentParent(t, fixture, "mention-routing")
		prepared, err := fixture.service.PreparePrivateComment(
			context.Background(),
			fixture.author,
			&privatecontentpb.PreparePrivateCommentRequest{
				PostId:           postID,
				CommentContentId: privateTestContentID("comment-mention-routing"),
				CommandId:        "prepare-comment-mention-routing",
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
			"submit-comment-mention-routing",
			"private Comment mention ciphertext",
		)
		submit := &privatecontentpb.SubmitPrivateCommentRequest{
			Plan:      momentSubmit.GetPlan(),
			Payload:   momentSubmit.GetPayload(),
			Envelopes: momentSubmit.GetEnvelopes(),
			Objects:   momentSubmit.GetObjects(),
			CommandId: momentSubmit.GetCommandId(),
			PostId:    postID,
		}
		routing := privateMentionRouting(
			t,
			submit.GetPlan(),
			submit.GetPayload(),
			fixture.author.Endpoint,
			fixture.authorPrivateKey,
			&actormodel.ActorRef{
				Ptid: "ptid:bob",
				Acct: "bob@station.test",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
		)
		submit.MentionRouting = routing

		created, err := fixture.service.SubmitPrivateComment(
			context.Background(),
			fixture.author.Endpoint,
			submit,
		)
		if err != nil {
			t.Fatal(err)
		}
		if !proto.Equal(
			created.GetComment().GetPrivateContent().GetVerification().
				GetMentionRouting(),
			routing,
		) {
			t.Fatal("Comment submit response changed the signed mention routing")
		}

		read, err := fixture.service.GetPrivateComment(
			context.Background(),
			&actormodel.ActorDeviceRef{
				Actor: &actormodel.ActorRef{
					Ptid: "ptid:bob",
					Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
				},
				DeviceId: "bob-device",
			},
			postID,
			created.GetComment().GetMetadata().GetCommentId(),
		)
		if err != nil {
			t.Fatal(err)
		}
		if !proto.Equal(
			read.GetComment().GetPrivateContent().GetVerification().
				GetMentionRouting(),
			routing,
		) {
			t.Fatal("Comment point read changed the signed mention routing")
		}

		var row dbmodel.SocialPrivateContentComment
		if err := fixture.database.Where(
			"comment_id = ?",
			created.GetComment().GetMetadata().GetCommentId(),
		).First(&row).Error; err != nil {
			t.Fatal(err)
		}
		routingBytes, err := socialdomain.CanonicalProtoBytes(routing)
		if err != nil {
			t.Fatal(err)
		}
		routingHash := sha256.Sum256(routingBytes)
		if !bytes.Equal(row.MentionRoutingBytes, routingBytes) ||
			!bytes.Equal(row.MentionRoutingSHA256, routingHash[:]) {
			t.Fatal("persisted Comment mention routing does not match the submit bundle")
		}
	})
}

func TestPrivateReactionUsesCanonicalPrivatePostIdentityAndCurrentGrant(
	t *testing.T,
) {
	fixture := newPrivateContentServiceFixture(t)
	prepared, err := fixture.service.PreparePrivateMoment(
		context.Background(),
		fixture.author,
		privateMomentPrepareRequest("prepare-reaction", "content-reaction"),
	)
	if err != nil {
		t.Fatal(err)
	}
	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-reaction",
		"reaction ciphertext",
	)
	if _, err := fixture.service.SubmitPrivateMoment(
		context.Background(),
		fixture.author.Endpoint,
		submit,
	); err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.AutoMigrate(
		&dbmodel.Actor{},
		&dbmodel.SocialReaction{},
		&dbmodel.Follow{},
	); err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.Create(&dbmodel.Actor{
		ID:                2,
		PTID:              "ptid:bob",
		Namespace:         "peers",
		PreferredUsername: "bob",
		Email:             "bob@station.test",
		PasswordHash:      "test",
	}).Error; err != nil {
		t.Fatal(err)
	}
	reactions := NewReactionService(
		fixture.database,
		infrastructure.NewRepos(fixture.database),
	)
	postID := prepared.GetPlan().GetResource().GetContentId()
	summaries, err := reactions.React(
		context.Background(),
		postID,
		"ptid:bob",
		actormodel.ReactionKind_REACTION_LIKE,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 1 ||
		summaries[0].GetKind() != actormodel.ReactionKind_REACTION_LIKE ||
		summaries[0].GetCount() != 1 ||
		!summaries[0].GetReactedByViewer() {
		t.Fatalf("private reaction summaries = %+v", summaries)
	}
	read, err := fixture.service.GetPrivateMoment(
		context.Background(),
		&actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:bob",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "bob-device",
		},
		postID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if read.GetResource().GetMetadata().GetStats().GetLikesCount() != 1 {
		t.Fatalf(
			"private reaction count = %d",
			read.GetResource().GetMetadata().GetStats().GetLikesCount(),
		)
	}
	summaries, err = reactions.Unreact(
		context.Background(),
		postID,
		"ptid:bob",
		actormodel.ReactionKind_REACTION_LIKE,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 0 {
		t.Fatalf("private unreact summaries = %+v", summaries)
	}
	read, err = fixture.service.GetPrivateMoment(
		context.Background(),
		&actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:bob",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "bob-device",
		},
		postID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if read.GetResource().GetMetadata().GetStats().GetLikesCount() != 0 {
		t.Fatalf(
			"private reaction count after unreact = %d",
			read.GetResource().GetMetadata().GetStats().GetLikesCount(),
		)
	}
	if _, err := reactions.React(
		context.Background(),
		postID,
		"ptid:bob",
		actormodel.ReactionKind_REACTION_LIKE,
	); err != nil {
		t.Fatal(err)
	}

	if err := fixture.database.Exec(
		"DELETE FROM social_relationship_projections WHERE owner_ptid = ? AND peer_ptid = ?",
		"ptid:alice",
		"ptid:bob",
	).Error; err != nil {
		t.Fatal(err)
	}
	_, err = reactions.React(
		context.Background(),
		postID,
		"ptid:bob",
		actormodel.ReactionKind_REACTION_LOVE,
	)
	if socialdomain.PrivateContentCodeOf(err) !=
		socialdomain.PrivateContentNotFound {
		t.Fatalf("revoked private reaction error = %v", err)
	}
	_, err = reactions.Unreact(
		context.Background(),
		postID,
		"ptid:bob",
		actormodel.ReactionKind_REACTION_LIKE,
	)
	if socialdomain.PrivateContentCodeOf(err) !=
		socialdomain.PrivateContentNotFound {
		t.Fatalf("revoked private unreact error = %v", err)
	}
	var count int64
	if err := fixture.database.Model(&dbmodel.SocialReaction{}).
		Where("post_id = ?", postID).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("revoked private reaction wrote %d rows", count)
	}
}

func TestPrivateContentServiceDeletePrivateMomentRevokesFutureAccess(
	t *testing.T,
) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	postID := publishPrivateCommentParent(t, fixture, "private-delete")
	fixture.clock.now = fixture.clock.now.Add(time.Minute)
	commentID := publishPrivateComment(
		t,
		fixture,
		postID,
		"private-delete-comment",
	)

	var post dbmodel.SocialPrivateContentPost
	if err := fixture.database.First(&post, "post_id = ?", postID).Error; err != nil {
		t.Fatal(err)
	}
	var comment dbmodel.SocialPrivateContentComment
	if err := fixture.database.First(
		&comment,
		"comment_id = ?",
		commentID,
	).Error; err != nil {
		t.Fatal(err)
	}
	objectID := "private-delete-object"
	if err := fixture.database.Create(
		&dbmodel.SocialPrivateObjectAttachment{
			ObjectID:                 objectID,
			UploadID:                 "private-delete-upload",
			UploadGeneration:         1,
			ContentID:                post.ContentID,
			UploaderPTID:             post.AuthorPTID,
			UploaderDeviceID:         "alice-device",
			CanonicalDescriptorBytes: []byte("private-delete-descriptor"),
			DescriptorSHA256:         privateDigest("private-delete-descriptor"),
			StorageKey:               "private/private-delete-object",
			TotalCiphertextSize:      1,
			CiphertextSHA256:         privateDigest("private-delete-ciphertext"),
			State:                    dbmodel.SocialPrivateObjectAttached,
			DomainCommitID:           postID,
			CreatedAt:                fixture.clock.now,
			UpdatedAt:                fixture.clock.now,
			ExpiresAt:                fixture.clock.now.Add(time.Hour),
			AttachedAt:               &fixture.clock.now,
		},
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.Create(&dbmodel.SocialPrivateObjectGrant{
		ObjectID:          objectID,
		PrincipalKind:     infrastructure.PrivateContentKeyKindEndpoint,
		PrincipalPTID:     "ptid:bob",
		PrincipalDeviceID: "bob-device",
		DomainCommitID:    postID,
		GrantedAt:         fixture.clock.now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.AutoMigrate(&dbmodel.SocialReaction{}); err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.Create(&dbmodel.SocialReaction{
		PostID:    postID,
		ActorID:   42,
		Kind:      actormodel.ReactionKind_REACTION_LIKE.String(),
		PostClass: "private",
		CreatedAt: fixture.clock.now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	deleted, err := fixture.service.DeletePrivateMoment(
		ctx,
		postID,
		"ptid:eve",
	)
	if err != nil || deleted {
		t.Fatalf("non-author delete = %v, %v", deleted, err)
	}
	deleted, err = fixture.service.DeletePrivateMoment(
		ctx,
		postID,
		"ptid:alice",
	)
	if err != nil || !deleted {
		t.Fatalf("author delete = %v, %v", deleted, err)
	}
	replayed, err := fixture.service.DeletePrivateMoment(
		ctx,
		postID,
		"ptid:alice",
	)
	if err != nil || replayed {
		t.Fatalf("delete replay = %v, %v", replayed, err)
	}

	if err := fixture.database.First(&post, "post_id = ?", postID).Error; err != nil {
		t.Fatal(err)
	}
	if post.LifecycleState != "DELETED" || post.DeletedAt == nil {
		t.Fatalf("deleted private Post = %+v", post)
	}
	if err := fixture.database.First(
		&comment,
		"comment_id = ?",
		commentID,
	).Error; err != nil {
		t.Fatal(err)
	}
	if comment.LifecycleState != "DELETED" || comment.DeletedAt == nil {
		t.Fatalf("deleted private Comment = %+v", comment)
	}
	for name, query := range map[string]*gorm.DB{
		"recipient grants": fixture.database.
			Model(&dbmodel.SocialPrivateRecipientGrant{}).
			Where("revoked_at IS NULL"),
		"object grants": fixture.database.
			Model(&dbmodel.SocialPrivateObjectGrant{}).
			Where("revoked_at IS NULL"),
		"pending deliveries": fixture.database.
			Model(&dbmodel.SocialPrivateDeliveryIntent{}).
			Where(
				"state = ?",
				dbmodel.SocialPrivateDeliveryIntentStatePending,
			),
		"private reactions": fixture.database.
			Model(&dbmodel.SocialReaction{}).
			Where("post_id = ? AND post_class = ?", postID, "private"),
	} {
		var count int64
		if err := query.Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s remain after private Post delete: %d", name, count)
		}
	}
	if _, err := fixture.service.GetPrivateMoment(
		ctx,
		privateCommentBobViewer(),
		postID,
	); !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentNotFound,
	) {
		t.Fatalf("deleted private Post read error = %v", err)
	}
}

type privateContentServiceFixture struct {
	database         *gorm.DB
	service          *PrivateContentService
	store            *infrastructure.GORMPrivateContentStore
	author           socialdomain.PrivateContentAuthor
	authorPrivateKey ed25519.PrivateKey
	stationSigner    privateContentTestSigner
	audiences        *privateContentTestAudience
	originalSnapshot socialdomain.FriendsSnapshot
	clock            *privateContentTestClock
	keyExchange      *privateContentTestKeyExchange
}

func newPrivateContentServiceFixture(
	t *testing.T,
) *privateContentServiceFixture {
	return newPrivateContentServiceFixtureWithStoreOptions(t)
}

func newPrivateContentServiceFixtureWithStoreOptions(
	t *testing.T,
	options ...infrastructure.PrivateContentStoreOption,
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
	store, err := infrastructure.NewGORMPrivateContentStore(database, options...)
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
	deliveryStore, err := federationdelivery.NewGORMRepository(
		database,
		federationdelivery.SystemClock{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := deliveryStore.Migrate(context.Background()); err != nil {
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
	stationPublicDER, err := x509.MarshalPKIXPublicKey(
		stationPrivateKey.Public(),
	)
	if err != nil {
		t.Fatal(err)
	}
	stationKeyID := authfed.KidFromPubDER(stationPublicDER)
	author := socialdomain.PrivateContentAuthor{
		Endpoint: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:alice",
				Acct: "alice@station.test",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "alice-device",
		},
		HomeStationPeerID: "station-local",
	}
	snapshot := socialdomain.FriendsSnapshot{
		Audience:         &actormodel.Audience{Kind: actormodel.Audience_FRIENDS},
		SourceRevision:   1,
		SourceHeadSHA256: privateDigest("friends-v1"),
		RecipientPTIDs:   []string{"ptid:bob"},
		RecipientLocalities: []socialdomain.RecipientLocality{{
			ActorPTID:         "ptid:bob",
			HomeStationPeerID: "station-local",
		}},
	}
	audiences := &privateContentTestAudience{snapshot: snapshot}
	keyExchange := &privateContentTestKeyExchange{}
	clock := &privateContentTestClock{
		now: time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC),
	}
	stationSigner := privateContentTestSigner{
		stationID:  "station-local",
		keyID:      stationKeyID,
		privateKey: stationPrivateKey,
	}
	service, err := NewPrivateContentService(
		store,
		audiences,
		audiences,
		privateContentTestGroups{},
		privateContentTestRecipients{author: author.Endpoint},
		keyExchange,
		stationSigner,
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
		stationSigner:    stationSigner,
		audiences:        audiences,
		originalSnapshot: snapshot,
		clock:            clock,
		keyExchange:      keyExchange,
	}
}

type privateContentTestAudience struct {
	snapshot           socialdomain.FriendsSnapshot
	postCalls          int
	lastPostAuthorPTID string
	repostPrepareCalls int
	repostSubmitCalls  int
	repostPrepareErr   error
	repostSubmitErr    error
}

func (a *privateContentTestAudience) ResolveFriendsPostSnapshot(
	_ context.Context,
	_ federationdelivery.Transaction,
	authorPTID string,
) (socialdomain.FriendsSnapshot, error) {
	a.postCalls++
	a.lastPostAuthorPTID = authorPTID
	return a.snapshot, nil
}

func (a *privateContentTestAudience) ResolveFollowersPostSnapshot(
	context.Context,
	federationdelivery.Transaction,
	string,
) (socialdomain.FriendsSnapshot, error) {
	a.postCalls++
	return a.snapshot, nil
}

func (a *privateContentTestAudience) ResolveCirclePostSnapshot(
	context.Context,
	federationdelivery.Transaction,
	string,
	uint64,
) (socialdomain.FriendsSnapshot, error) {
	a.postCalls++
	return a.snapshot, nil
}

func (a *privateContentTestAudience) ResolveGroupPostSnapshot(
	context.Context,
	federationdelivery.Transaction,
	string,
	socialdomain.GroupRecipientSnapshot,
) (socialdomain.FriendsSnapshot, error) {
	a.postCalls++
	return a.snapshot, nil
}

func (a *privateContentTestAudience) ResolveCustomAllowPostSnapshot(
	context.Context,
	federationdelivery.Transaction,
	string,
	[]string,
) (socialdomain.FriendsSnapshot, error) {
	a.postCalls++
	return a.snapshot, nil
}

func (a *privateContentTestAudience) ResolveCustomDenyPostSnapshot(
	_ context.Context,
	_ federationdelivery.Transaction,
	_ string,
	_ []string,
	_ actormodel.Audience_Kind,
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

func (a *privateContentTestAudience) ValidatePrepare(
	context.Context,
	string,
	socialdomain.FriendsSnapshot,
	*privatecontentpb.PrivateRepostAuthority,
) error {
	a.repostPrepareCalls++
	return a.repostPrepareErr
}

func (a *privateContentTestAudience) ValidateSubmit(
	context.Context,
	federationdelivery.Transaction,
	string,
	socialdomain.FriendsSnapshot,
	*privatecontentpb.PrivateRepostAuthority,
) error {
	a.repostSubmitCalls++
	return a.repostSubmitErr
}

type privateContentTestRecipients struct {
	author        *actormodel.ActorDeviceRef
	devices       map[string]string
	validationErr error
}

func (r privateContentTestRecipients) ResolveRecipientLocalities(
	_ context.Context,
	_ string,
	localStationPeerID string,
	recipients []string,
) ([]socialdomain.RecipientLocality, error) {
	localities := make(
		[]socialdomain.RecipientLocality,
		0,
		len(recipients),
	)
	for _, actorPTID := range recipients {
		localities = append(localities, socialdomain.RecipientLocality{
			ActorPTID:         actorPTID,
			HomeStationPeerID: localStationPeerID,
		})
	}

	return localities, nil
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
		deviceID := r.devices[actorPTID]
		if deviceID == "" {
			deviceID = "bob-device"
		}
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
	if r.validationErr != nil {
		return r.validationErr
	}
	if endpoint == nil || endpoint.GetActor() == nil ||
		endpoint.GetDeviceId() == "revoked-device" {
		return fmt.Errorf(
			"endpoint is inactive: %w",
			ErrPrivateContentInactiveEndpoint,
		)
	}
	return nil
}

type privateContentTestGroups struct{}

func (privateContentTestGroups) PrepareSnapshot(
	context.Context,
	string,
	string,
) (socialdomain.GroupRecipientSnapshot, error) {
	return socialdomain.GroupRecipientSnapshot{},
		fmt.Errorf("unexpected Group snapshot request")
}

func (privateContentTestGroups) WithSubmitFence(
	_ context.Context,
	_ socialdomain.GroupRecipientSnapshot,
	_ func(socialdomain.GroupRecipientSnapshot) error,
) error {
	return fmt.Errorf("unexpected Group submit fence")
}

type privateContentTestKeyExchange struct {
	request                                   *securecontentpb.ClaimContentPreKeysRequest
	response                                  *securecontentpb.ClaimContentPreKeysResponse
	sourceStationPeerID                       string
	recipientLocalities                       []socialdomain.RecipientLocality
	publicKeysByTarget                        map[string][]byte
	claimError                                error
	validationError                           error
	remoteValidationError                     error
	remoteValidationCalls                     int
	submitTransactionStarted                  *bool
	remoteValidationObservedSubmitTransaction bool
	stale                                     bool
	claimCalls                                int
}

func (k *privateContentTestKeyExchange) ClaimContentPreKeys(
	_ context.Context,
	sourceStationPeerID string,
	recipientLocalities []socialdomain.RecipientLocality,
	request *securecontentpb.ClaimContentPreKeysRequest,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	k.claimCalls++
	k.sourceStationPeerID = sourceStationPeerID
	k.recipientLocalities = append(
		[]socialdomain.RecipientLocality(nil),
		recipientLocalities...,
	)
	if k.claimError != nil {
		return nil, k.claimError
	}
	k.request = proto.Clone(
		request,
	).(*securecontentpb.ClaimContentPreKeysRequest)
	response := &securecontentpb.ClaimContentPreKeysResponse{}
	for index, target := range request.GetTargets() {
		publicKey := bytes.Repeat([]byte{byte(index + 1)}, 32)
		targetKey := fmt.Sprintf(
			"%d:%s:%s",
			target.GetKind(),
			target.GetEndpoint().GetActor().GetPtid()+
				target.GetRecoveryActor().GetPtid(),
			target.GetEndpoint().GetDeviceId(),
		)
		if fixed := k.publicKeysByTarget[targetKey]; len(fixed) != 0 {
			publicKey = clonePrivateTestBytes(fixed)
		}
		prekey := &securecontentpb.ContentOneTimePreKey{
			Kind: target.GetKind(),
			KeyId: fmt.Sprintf(
				"prekey-%02d-%02d",
				k.claimCalls,
				index,
			),
			X25519PublicKey:        publicKey,
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

func (k *privateContentTestKeyExchange) ValidateRemoteContentPreKeyClaims(
	_ context.Context,
	sourceStationPeerID string,
	recipientLocalities []socialdomain.RecipientLocality,
	_ *securecontentpb.ClaimContentPreKeysRequest,
	_ *securecontentpb.ClaimContentPreKeysResponse,
) error {
	k.remoteValidationCalls++
	if k.submitTransactionStarted != nil &&
		*k.submitTransactionStarted {
		k.remoteValidationObservedSubmitTransaction = true
	}
	for _, locality := range recipientLocalities {
		if locality.HomeStationPeerID != sourceStationPeerID {
			return k.remoteValidationError
		}
	}
	return nil
}

func (k *privateContentTestKeyExchange) ValidateContentPreKeyClaims(
	_ context.Context,
	transaction federationdelivery.Transaction,
	_ string,
	_ []socialdomain.RecipientLocality,
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
	if k.validationError != nil {
		return k.validationError
	}
	if !proto.Equal(request, k.request) || !proto.Equal(response, k.response) {
		return fmt.Errorf("claim request or response changed")
	}
	return nil
}

type privateContentTestSigner struct {
	stationID         string
	keyID             string
	privateKey        ed25519.PrivateKey
	importedProofKeys map[string][]byte
	trustImportedErr  error
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
	attestation := &securecontentpb.StationContentSigningKeyAttestation{
		FormatVersion:         1,
		StationPeerId:         s.stationID,
		ProofSigningKeyId:     signingKeyID,
		ProofEd25519PublicKey: append([]byte(nil), publicKey...),
		AttestingSigningKeyId: s.keyID,
		IssuedAt:              timestamppb.New(now),
		ExpiresAt:             timestamppb.New(now.Add(5 * time.Minute)),
	}
	signingBytes, err := authfed.ContentProofKeyAttestationSigningBytes(
		attestation,
	)
	if err != nil {
		return nil, err
	}
	attestation.StationSignature = ed25519.Sign(s.privateKey, signingBytes)
	return attestation, nil
}

func (s privateContentTestSigner) AttestContentProofVerificationKeyInTransaction(
	ctx context.Context,
	_ federationdelivery.Transaction,
	signingKeyID string,
	now time.Time,
) (*securecontentpb.StationContentSigningKeyAttestation, error) {
	return s.AttestContentProofVerificationKey(ctx, signingKeyID, now)
}

func (s privateContentTestSigner) AttestImportedContentProofVerificationKey(
	ctx context.Context,
	sourceStationPeerID string,
	signingKeyID string,
	now time.Time,
) (*securecontentpb.StationContentSigningKeyAttestation, error) {
	proofKey := s.importedProofKeys[sourceStationPeerID+"\x00"+signingKeyID]
	if len(proofKey) == 0 {
		return nil, fmt.Errorf("imported proof key is unavailable")
	}
	attestation, err := s.AttestContentProofVerificationKey(
		ctx,
		s.keyID,
		now,
	)
	if err != nil {
		return nil, err
	}
	attestation.ProofSigningKeyId = signingKeyID
	attestation.ProofEd25519PublicKey = clonePrivateTestBytes(proofKey)
	signingBytes, err := authfed.ContentProofKeyAttestationSigningBytes(
		attestation,
	)
	if err != nil {
		return nil, err
	}
	attestation.StationSignature = ed25519.Sign(
		s.privateKey,
		signingBytes,
	)
	return attestation, nil
}

func (s privateContentTestSigner) TrustImportedContentProofVerificationKeyInTransaction(
	_ context.Context,
	_ federationdelivery.Transaction,
	sourceStationPeerID string,
	signingKeyID string,
	proofKey []byte,
	_ time.Time,
) error {
	if s.trustImportedErr != nil {
		return s.trustImportedErr
	}
	if s.importedProofKeys == nil {
		return fmt.Errorf("imported proof-key history is unavailable")
	}
	identity := sourceStationPeerID + "\x00" + signingKeyID
	if existing := s.importedProofKeys[identity]; len(existing) != 0 &&
		!bytes.Equal(existing, proofKey) {
		return fmt.Errorf("imported proof-key history conflict")
	}
	s.importedProofKeys[identity] = clonePrivateTestBytes(proofKey)
	return nil
}

func (s privateContentTestSigner) AttestImportedContentProofVerificationKeyInTransaction(
	ctx context.Context,
	_ federationdelivery.Transaction,
	sourceStationPeerID string,
	signingKeyID string,
	now time.Time,
) (*securecontentpb.StationContentSigningKeyAttestation, error) {
	return s.AttestImportedContentProofVerificationKey(
		ctx,
		sourceStationPeerID,
		signingKeyID,
		now,
	)
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
	_ string,
	canonical []byte,
	signature []byte,
	_ time.Time,
) error {
	if !ed25519.Verify(v.publicKey, canonical, signature) {
		return fmt.Errorf("invalid author signature")
	}
	return nil
}

func (v privateContentTestAuthorVerifier) ResolveRetained(
	_ context.Context,
	_ federationdelivery.Transaction,
	sender *actormodel.ActorDeviceRef,
	expectedHomeStationPeerID string,
	signingKeyID string,
	committedAt time.Time,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	if sender == nil || sender.GetActor() == nil || committedAt.IsZero() {
		return nil, fmt.Errorf("invalid retained author key request")
	}
	return &actormodel.VerifiedActorDeviceSigningKey{
		ActorPtid:         sender.GetActor().GetPtid(),
		ActorDeviceId:     sender.GetDeviceId(),
		HomeStationPeerId: expectedHomeStationPeerID,
		SigningKeyId:      signingKeyID,
		Ed25519PublicKey:  append([]byte(nil), v.publicKey...),
		ProfileVersion:    1,
		VerificationSource: actormodel.
			ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
		ValidFromUnixMs: committedAt.Add(-time.Minute).UnixMilli(),
	}, nil
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

func privateMentionRouting(
	t *testing.T,
	plan *securecontentpb.ContentEncryptionPlan,
	payload *securecontentpb.EncryptedPayload,
	author *actormodel.ActorDeviceRef,
	authorPrivateKey ed25519.PrivateKey,
	mentionedActor *actormodel.ActorRef,
) *privatecontentpb.SignedMentionRouting {
	t.Helper()
	payloadBytes, err := socialdomain.CanonicalProtoBytes(payload)
	if err != nil {
		t.Fatal(err)
	}
	payloadHash := sha256.Sum256(payloadBytes)
	routing := &privatecontentpb.SignedMentionRouting{
		FormatVersion: 1,
		Resource: proto.Clone(
			plan.GetResource(),
		).(*securecontentpb.SecureResourceRef),
		AuthorizationSnapshotSha256: clonePrivateTestBytes(
			plan.GetAuthorizationSnapshotSha256(),
		),
		EncryptedPayloadSha256: payloadHash[:],
		Facts: []*privatecontentpb.MentionRoutingFact{{
			MentionedActor: proto.Clone(
				mentionedActor,
			).(*actormodel.ActorRef),
			MentionCommitment: privateDigest(
				"mention:" + mentionedActor.GetPtid(),
			),
		}},
		Sender:             proto.Clone(author).(*actormodel.ActorDeviceRef),
		SenderSigningKeyId: "author-key",
	}
	signingBytes, err := socialdomain.CanonicalProtoBytes(routing)
	if err != nil {
		t.Fatal(err)
	}
	signingDigest := sha256.Sum256(signingBytes)
	routing.CanonicalFactsSha256 = signingDigest[:]
	routing.SenderSignature = ed25519.Sign(
		authorPrivateKey,
		routing.GetCanonicalFactsSha256(),
	)
	return routing
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
