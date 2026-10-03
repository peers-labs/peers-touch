package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"testing"
	"time"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestPrivateAudienceAuthorityUsesAcceptedProjectionOnly(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open("file:private_audience?mode=memory&cache=shared"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(
		&federatedRelationshipProjectionModel{},
		&friendshipModel{},
		&socialDirectionalRelationshipModel{},
	); err != nil {
		t.Fatal(err)
	}
	acceptedAt := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	if err := database.Create([]federatedRelationshipProjectionModel{
		{
			OwnerPTID:         "ptid:alice",
			PeerPTID:          "ptid:bob",
			RequestID:         "request-bob",
			AcceptedEventID:   "event-bob",
			AcceptedEventHash: []byte("event-hash-bob"),
			AcceptedAt:        acceptedAt,
		},
		{
			OwnerPTID:         "ptid:alice",
			PeerPTID:          "ptid:eve",
			RequestID:         "request-eve",
			AcceptedEventID:   "event-eve",
			AcceptedEventHash: []byte("event-hash-eve"),
			AcceptedAt:        acceptedAt,
		},
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create([]friendshipModel{
		{
			ActorPTID: "ptid:alice",
			PeerPTID:  "ptid:mallory",
			Status:    friendRequestPolicyRelationshipAccepted,
		},
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create([]socialDirectionalRelationshipModel{
		{
			ActorPTID:       "ptid:alice",
			TargetActorPTID: "ptid:eve",
			Blocked:         true,
			Revision:        1,
			UpdatedAt:       acceptedAt,
		},
	}).Error; err != nil {
		t.Fatal(err)
	}

	authority, err := NewGORMPrivateAudienceAuthority(database)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := authority.ResolveFriendsPostSnapshot(
		context.Background(),
		nil,
		"ptid:alice",
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SourceRevision != 2 ||
		len(snapshot.SourceHeadSHA256) != 32 ||
		len(snapshot.RecipientPTIDs) != 1 ||
		snapshot.RecipientPTIDs[0] != "ptid:bob" {
		t.Fatalf("unexpected FRIENDS snapshot: %+v", snapshot)
	}
}

func TestPrivateRepostSourceAuthorityBindsCanonicalPublicSnapshot(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open("file:private_repost_public?mode=memory&cache=shared"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(
		&dbmodel.Actor{},
		&dbmodel.SocialPublicPost{},
		&socialDirectionalRelationshipModel{},
	); err != nil {
		t.Fatal(err)
	}
	author := dbmodel.Actor{
		ID:                101,
		PTID:              "ptid:source",
		Namespace:         "peers",
		PreferredUsername: "source",
		Email:             "source@example.test",
		PasswordHash:      "test",
		Kind:              "p",
		FederatedHandle:   "@source@station.test",
	}
	if err := database.Create(&author).Error; err != nil {
		t.Fatal(err)
	}
	createdAt := time.Date(2026, 9, 24, 1, 0, 0, 0, time.UTC)
	row := dbmodel.SocialPublicPost{
		ID:           701,
		AuthorID:     author.ID,
		Type:         actormodel.PostType_TEXT.String(),
		AudienceKind: actormodel.Audience_PUBLIC.String(),
		TextBody:     "public source",
		CreatedAt:    createdAt,
		UpdatedAt:    createdAt,
	}
	if err := database.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	authorRef := touchactor.ProtoActorRef(&author)
	snapshot, err := publicRenderedSourceSnapshot(&row, authorRef)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := socialdomain.CanonicalProtoBytes(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	authority := &privatecontentpb.PrivateRepostAuthority{
		Source:       &privatecontentpb.SocialPostSourceRef{PostId: "701"},
		SourceAuthor: authorRef,
		RenderedSourceCommitment: bytes.Repeat(
			[]byte{0x41},
			sha256.Size,
		),
		SourceProof: &privatecontentpb.PrivateRepostAuthority_PublicSource{
			PublicSource: &privatecontentpb.PublicRepostSourceProof{
				CanonicalPublicPostSha256: privateAuthorityDigest(canonical),
			},
		},
	}
	reposts, err := NewGORMPrivateAudienceAuthority(database)
	if err != nil {
		t.Fatal(err)
	}
	target := socialdomain.FriendsSnapshot{
		Audience:       &actormodel.Audience{Kind: actormodel.Audience_FRIENDS},
		RecipientPTIDs: []string{"ptid:bob"},
	}
	if err := reposts.ValidatePrepare(
		context.Background(),
		"ptid:reposter",
		target,
		authority,
	); err != nil {
		t.Fatal(err)
	}
	authority.GetPublicSource().CanonicalPublicPostSha256[0] ^= 1
	if err := reposts.ValidatePrepare(
		context.Background(),
		"ptid:reposter",
		target,
		authority,
	); !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentIntegrityFailed,
	) {
		t.Fatalf("tampered public source error = %v", err)
	}
}

func TestPrivateRepostSourceAuthorityRejectsGrantWideningAndSubmitDeletion(
	t *testing.T,
) {
	database, err := gorm.Open(
		sqlite.Open("file:private_repost_private?mode=memory&cache=shared"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	store, err := NewGORMPrivateContentStore(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(
		&dbmodel.Actor{},
		&federatedRelationshipProjectionModel{},
		&socialDirectionalRelationshipModel{},
	); err != nil {
		t.Fatal(err)
	}
	author := dbmodel.Actor{
		ID:                201,
		PTID:              "ptid:alice",
		Namespace:         "peers",
		PreferredUsername: "alice",
		Email:             "alice@example.test",
		PasswordHash:      "test",
		Kind:              "p",
		FederatedHandle:   "@alice@station.test",
	}
	if err := database.Create(&author).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&federatedRelationshipProjectionModel{
		OwnerPTID:         author.PTID,
		PeerPTID:          "ptid:bob",
		RequestID:         "request-source-bob",
		AcceptedEventID:   "event-source-bob",
		AcceptedEventHash: privateAuthorityDigest([]byte("event-source-bob")),
		AcceptedAt:        time.Date(2026, 9, 24, 0, 30, 0, 0, time.UTC),
	}).Error; err != nil {
		t.Fatal(err)
	}
	sourceSnapshotHash := bytes.Repeat([]byte{0x11}, sha256.Size)
	sourcePayloadHash := bytes.Repeat([]byte{0x22}, sha256.Size)
	sourceProofHash := bytes.Repeat([]byte{0x33}, sha256.Size)
	now := time.Date(2026, 9, 24, 1, 0, 0, 0, time.UTC)
	sourceAudience := &actormodel.Audience{
		Kind: actormodel.Audience_FRIENDS,
	}
	sourceAudienceBytes, err := socialdomain.CanonicalProtoBytes(
		sourceAudience,
	)
	if err != nil {
		t.Fatal(err)
	}
	sourceAudienceHash := privateAuthorityDigest(sourceAudienceBytes)
	emptyHash := privateAuthorityDigest(nil)
	if err := database.Create(&dbmodel.SocialPrivateContentPlan{
		PlanID:                        "private-source-plan",
		AuthorPTID:                    author.PTID,
		PrepareCommandID:              "private-source-prepare",
		ContentID:                     "private-source-content",
		Generation:                    1,
		ResourceKind:                  string(socialdomain.PrivateContentResourcePost),
		AudienceKind:                  sourceAudience.GetKind().String(),
		AuthorDeviceID:                "source-device",
		AuthorHomeStationPeerID:       "station-local",
		AudienceSnapshotID:            "private-source-snapshot",
		AuthorizationSnapshotSHA256:   sourceSnapshotHash,
		CanonicalPrepareBytes:         []byte{1},
		CanonicalPrepareSHA256:        bytes.Repeat([]byte{0x61}, sha256.Size),
		AudienceBytes:                 sourceAudienceBytes,
		AudienceSHA256:                sourceAudienceHash,
		GroupRecipientSnapshotSHA256:  emptyHash,
		SubtypePrepareAuthoritySHA256: emptyHash,
		ClaimRequestBytes:             []byte{2},
		ClaimRequestSHA256:            bytes.Repeat([]byte{0x62}, sha256.Size),
		State:                         dbmodel.SocialPrivatePlanStateConsumed,
		DomainCommitID:                "private-source",
		ExpiresAt:                     now.Add(time.Hour),
		CreatedAt:                     now,
		UpdatedAt:                     now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	post := dbmodel.SocialPrivateContentPost{
		PostID:                    "private-source",
		ContentID:                 "private-source-content",
		AuthorPTID:                author.PTID,
		Generation:                1,
		AudienceSnapshotID:        "private-source-snapshot",
		Kind:                      actormodel.PostType_TEXT.String(),
		EncryptedPayloadBytes:     []byte{1},
		EncryptedPayloadSHA256:    sourcePayloadHash,
		ObjectDescriptorSetSHA256: bytes.Repeat([]byte{0x44}, sha256.Size),
		LifecycleState:            privateContentLifecycleActive,
		CreatedAt:                 now,
		UpdatedAt:                 now,
	}
	if err := database.Create(&post).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(
		&dbmodel.SocialPrivateAudienceSnapshot{
			SnapshotID:              post.AudienceSnapshotID,
			ResourceKind:            string(socialdomain.PrivateContentResourcePost),
			ResourceID:              post.ContentID,
			PostID:                  post.PostID,
			AudienceKind:            actormodel.Audience_FRIENDS.String(),
			SourceRevision:          1,
			CanonicalSnapshotSHA256: sourceSnapshotHash,
			CreatedAt:               now,
		},
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&dbmodel.SocialPrivateRecipientGrant{
		SnapshotID:    post.AudienceSnapshotID,
		RecipientPTID: "ptid:bob",
		GrantedAt:     now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&dbmodel.SocialPrivateCommitProof{
		ContentID:            post.ContentID,
		Generation:           post.Generation,
		DomainCommitID:       post.PostID,
		ResourceKind:         string(socialdomain.PrivateContentResourcePost),
		CanonicalProofBytes:  []byte{2},
		CanonicalProofSHA256: sourceProofHash,
		StationSigningKeyID:  "station-key",
		CommittedAt:          now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	authority := &privatecontentpb.PrivateRepostAuthority{
		Source: &privatecontentpb.SocialPostSourceRef{
			PostId:            post.PostID,
			PrivateContentId:  post.ContentID,
			PrivateGeneration: post.Generation,
		},
		SourceAuthor: touchactor.ProtoActorRef(&author),
		RenderedSourceCommitment: bytes.Repeat(
			[]byte{0x55},
			sha256.Size,
		),
		SourceProof: &privatecontentpb.PrivateRepostAuthority_PrivateSource{
			PrivateSource: &privatecontentpb.PrivateRepostSourceProof{
				SourceResource: &securecontentpb.SecureResourceRef{
					OwnerDomain: securecontentpb.
						SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
					ContentId:  post.ContentID,
					Generation: post.Generation,
				},
				SourceAuthorizationSnapshotSha256: sourceSnapshotHash,
				SourceEncryptedPayloadSha256:      sourcePayloadHash,
				SourceCommitProofSha256:           sourceProofHash,
			},
		},
	}
	reposts, err := NewGORMPrivateAudienceAuthority(database)
	if err != nil {
		t.Fatal(err)
	}
	target := socialdomain.FriendsSnapshot{
		Audience:       &actormodel.Audience{Kind: actormodel.Audience_FRIENDS},
		RecipientPTIDs: []string{"ptid:bob"},
	}
	if err := reposts.ValidatePrepare(
		context.Background(),
		author.PTID,
		target,
		authority,
	); err != nil {
		t.Fatal(err)
	}
	widened := target
	widened.RecipientPTIDs = []string{"ptid:bob", "ptid:eve"}
	if err := reposts.ValidatePrepare(
		context.Background(),
		author.PTID,
		widened,
		authority,
	); !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentUnauthorized,
	) {
		t.Fatalf("widened private repost error = %v", err)
	}
	if err := database.Model(&dbmodel.SocialPrivateContentPost{}).
		Where("post_id = ?", post.PostID).
		Update("deleted_at", now).Error; err != nil {
		t.Fatal(err)
	}
	if err := reposts.ValidateSubmit(
		context.Background(),
		privateContentValidationTransaction{db: database},
		author.PTID,
		target,
		authority,
	); !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentStalePlan,
	) {
		t.Fatalf("deleted private repost source error = %v", err)
	}
}

func privateAuthorityDigest(value []byte) []byte {
	digest := sha256.Sum256(value)
	return digest[:]
}
