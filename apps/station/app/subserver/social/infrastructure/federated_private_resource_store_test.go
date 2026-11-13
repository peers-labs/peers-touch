package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestRemotePrivateResourceSchemaMatchesViewerProjectionContract(
	t *testing.T,
) {
	database, err := gorm.Open(
		sqlite.Open(
			fmt.Sprintf(
				"file:%s?mode=memory&cache=shared",
				t.Name(),
			),
		),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := migrateRemotePrivateResources(database); err != nil {
		t.Fatal(err)
	}

	columns, err := database.Migrator().ColumnTypes(
		&remotePrivateResourceModel{},
	)
	if err != nil {
		t.Fatal(err)
	}
	got := make(map[string]struct{}, len(columns))
	for _, column := range columns {
		got[column.Name()] = struct{}{}
	}
	for _, name := range []string{
		"viewer_metadata_bytes",
		"encrypted_payload_bytes",
		"object_descriptor_set_bytes",
		"verification_bytes",
		"audience_explanation_bytes",
	} {
		if _, ok := got[name]; !ok {
			t.Fatalf("remote private resource column %q is missing", name)
		}
	}
	if _, ok := got["projection_bytes"]; ok {
		t.Fatal("legacy aggregate projection_bytes column remains")
	}

	now := time.Date(2026, 10, 3, 20, 0, 0, 0, time.UTC)
	first := remotePrivateResourceModel{
		SourceStationPeerID:   "station-a",
		ContentID:             "post-a",
		Generation:            1,
		TargetActorPTID:       "ptid:bob",
		FederationID:          "federation-one",
		DeliveryID:            "delivery-shared",
		TargetStationPeerID:   "station-b",
		LifecycleRevision:     1,
		ResourceKind:          1,
		ViewerMetadataBytes:   []byte{1},
		EncryptedPayloadBytes: []byte{1},
		ObjectDescriptorBytes: []byte{1},
		VerificationBytes:     []byte{1},
		AudienceBytes:         []byte{1},
		CanonicalDeliveryHash: []byte{1},
		State:                 remotePrivateResourceStateActive,
		CommittedAt:           now,
		UpdatedAt:             now,
	}
	if err := database.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	anotherSource := first
	anotherSource.SourceStationPeerID = "station-c"
	anotherSource.ContentID = "post-c"
	if err := database.Create(&anotherSource).Error; err != nil {
		t.Fatalf("same delivery ID from another source must coexist: %v", err)
	}
	anotherTarget := first
	anotherTarget.ContentID = "post-d"
	anotherTarget.TargetActorPTID = "ptid:dave"
	if err := database.Create(&anotherTarget).Error; err != nil {
		t.Fatalf("same delivery ID for another target must coexist: %v", err)
	}
	conflict := first
	conflict.ContentID = "post-conflict"
	if err := database.Create(&conflict).Error; err == nil {
		t.Fatal("same source, target, and delivery ID must conflict")
	}
}

func TestPrivateReactionProjectionMigrationPreservesRowsAndWidensActualKey(t *testing.T) {
	for _, columnAlreadyAdded := range []bool{false, true} {
		t.Run(fmt.Sprintf("column-added-%t", columnAlreadyAdded), func(t *testing.T) {
			database, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			connection, err := database.DB()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = connection.Close() })
			if err := database.Exec(`CREATE TABLE social_private_reaction_projections (
				source_station_peer_id TEXT NOT NULL, post_id TEXT NOT NULL, viewer_ptid TEXT NOT NULL,
				projection_revision INTEGER NOT NULL, command_id TEXT NOT NULL,
				projection_bytes BLOB NOT NULL, updated_at DATETIME NOT NULL,
				PRIMARY KEY (source_station_peer_id, post_id, viewer_ptid)
			)`).Error; err != nil {
				t.Fatal(err)
			}
			if columnAlreadyAdded {
				if err := database.Exec("ALTER TABLE social_private_reaction_projections ADD COLUMN comment_id TEXT NOT NULL DEFAULT ''").Error; err != nil {
					t.Fatal(err)
				}
			}
			legacy, err := proto.MarshalOptions{Deterministic: true}.Marshal(&actormodel.Post{
				Id: "post-1", Reactions: []*actormodel.ReactionSummary{
					{Kind: actormodel.ReactionKind_REACTION_LIKE, Count: 3, ReactedByViewer: true},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			now := time.Now().UTC()
			if err := database.Exec(`INSERT INTO social_private_reaction_projections
				(source_station_peer_id, post_id, viewer_ptid, projection_revision, command_id, projection_bytes, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`, "source-1", "post-1", "ptid:bob", 7, "old-command", legacy, now).Error; err != nil {
				t.Fatal(err)
			}
			if err := migrateRemotePrivateResources(database); err != nil {
				t.Fatal(err)
			}
			if err := migrateRemotePrivateResources(database); err != nil {
				t.Fatalf("repeat migration: %v", err)
			}
			store, err := NewGORMPrivateContentStore(database)
			if err != nil {
				t.Fatal(err)
			}
			preserved, err := store.LoadFederatedPrivateReactionProjection(context.Background(), nil,
				"source-1", "post-1", "", "ptid:bob")
			if err != nil || preserved == nil || preserved.ProjectionRevision != 7 ||
				preserved.CommandID != "old-command" || len(preserved.Reactions) != 1 ||
				preserved.Reactions[0].GetCount() != 3 {
				t.Fatalf("preserved projection = %+v, %v", preserved, err)
			}
			for _, commentID := range []string{"comment-1", "comment-2"} {
				projection := *preserved
				projection.CommentID = commentID
				projection.CommandID = "command-" + commentID
				projection.ProjectionRevision = 1
				if applied, err := store.PutFederatedPrivateReactionProjection(context.Background(), nil, projection); err != nil || !applied {
					t.Fatalf("insert distinct typed target %s = %t, %v", commentID, applied, err)
				}
			}
			var count int64
			if err := database.Model(&federatedPrivateReactionProjectionModel{}).Count(&count).Error; err != nil || count != 3 {
				t.Fatalf("typed projection row count = %d, %v", count, err)
			}
		})
	}
}

func TestRemotePrivateResourceDeliveryIdentityIsSourceAndViewerScoped(
	t *testing.T,
) {
	database, err := gorm.Open(
		sqlite.Open(
			fmt.Sprintf(
				"file:%s?mode=memory&cache=shared",
				t.Name(),
			),
		),
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
	apply := func(
		message *privatecontentpb.FederatedPrivateResourceDelivery,
	) (bool, error) {
		canonical, marshalErr := proto.MarshalOptions{
			Deterministic: true,
		}.Marshal(message)
		if marshalErr != nil {
			return false, marshalErr
		}
		var duplicate bool
		transactionErr := database.Transaction(func(tx *gorm.DB) error {
			var applyErr error
			duplicate, applyErr = store.ApplyRemotePrivateResource(
				context.Background(),
				remotePrivateStoreTransaction{database: tx},
				message,
				canonical,
			)
			return applyErr
		})
		return duplicate, transactionErr
	}

	first := remotePrivateDeliveryFixture(
		"station-a",
		"ptid:bob",
		"post-a",
		"delivery-shared",
	)
	if duplicate, err := apply(first); err != nil || duplicate {
		t.Fatalf("first delivery duplicate=%t err=%v", duplicate, err)
	}
	if duplicate, err := apply(
		proto.Clone(first).(*privatecontentpb.FederatedPrivateResourceDelivery),
	); err != nil || !duplicate {
		t.Fatalf("exact replay duplicate=%t err=%v", duplicate, err)
	}

	deliveryConflict := remotePrivateDeliveryFixture(
		"station-a",
		"ptid:bob",
		"post-conflict",
		"delivery-shared",
	)
	if _, err := apply(deliveryConflict); !errors.Is(
		err,
		ErrPrivateContentConflict,
	) {
		t.Fatalf("delivery identity conflict error = %v", err)
	}
	anotherSource := remotePrivateDeliveryFixture(
		"station-c",
		"ptid:bob",
		"post-c",
		"delivery-shared",
	)
	if _, err := apply(anotherSource); err != nil {
		t.Fatalf("another source delivery collision: %v", err)
	}
	anotherViewer := remotePrivateDeliveryFixture(
		"station-a",
		"ptid:dave",
		"post-d",
		"delivery-shared",
	)
	if _, err := apply(anotherViewer); err != nil {
		t.Fatalf("another viewer delivery collision: %v", err)
	}
}

func TestRemotePrivatePostCommentCountIsCompleteScopedAndReadOnly(t *testing.T) {
	ctx := context.Background()
	database, store := newPrivateRevocationStore(t)
	connection, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	friends, err := NewGORMFederatedFriendRequestStore(database, federationdelivery.SystemClock{})
	if err != nil {
		t.Fatal(err)
	}
	if err := friends.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	parent := remotePrivateDeliveryFixture("station-a", "ptid:bob", "post-count", "delivery-parent")
	parent.GetPost().Stats = &actormodel.PostStats{CommentsCount: 77}
	parent.Verification.CommitProof = &securecontentpb.ViewerContentCommitProof{
		FormatVersion: 1, DomainCommitId: parent.Resource.ContentId, Resource: parent.Resource,
	}
	parent.AudienceExplanation.ViewerIsMember = true
	applyRemotePrivateDelivery(t, database, store, parent)
	var retained remotePrivateResourceModel
	if err := database.Where("content_id = ?", "post-count").First(&retained).Error; err != nil {
		t.Fatal(err)
	}
	comment := func(id string) *privatecontentpb.FederatedPrivateResourceDelivery {
		message := remotePrivateDeliveryFixture("station-a", "ptid:bob", id, "delivery-"+id)
		message.ResourceKind = privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT
		message.Verification.CommitProof = &securecontentpb.ViewerContentCommitProof{
			FormatVersion: 1, DomainCommitId: id, Resource: message.Resource,
		}
		message.AudienceExplanation.ViewerIsMember = true
		message.Metadata = &privatecontentpb.FederatedPrivateResourceDelivery_Comment{
			Comment: &privatecontentpb.CommentMetadata{
				PostId: "post-count", CommentId: id, ContentId: id,
				Author: &actormodel.ActorRef{Ptid: "ptid:charlie", Kind: actormodel.ActorKind_ACTOR_KIND_PERSON},
			},
		}
		return message
	}
	assertCount := func(want int64) {
		t.Helper()
		err := store.ReadRemotePrivatePost(ctx, "post-count", "ptid:bob", "device-one",
			func(_ federationdelivery.Transaction, read *RemotePrivatePostReadModel) error {
				if read.CommentsCount != want {
					t.Fatalf("authorized parent comments = %d, want %d", read.CommentsCount, want)
				}
				if read.Delivery.GetPost().GetStats().GetCommentsCount() != 77 {
					t.Fatal("parent read mutated retained delivery metadata")
				}
				return nil
			})
		if err != nil {
			t.Fatal(err)
		}
	}
	assertCount(0)
	for index := 0; index < 105; index++ {
		applyRemotePrivateDelivery(t, database, store, comment(fmt.Sprintf("comment-%03d", index)))
	}
	assertCount(105)
	applyRemotePrivateDelivery(t, database, store, comment("comment-000"))
	newGeneration := comment("comment-000")
	newGeneration.Resource.Generation = 2
	newGeneration.DeliveryId = "delivery-comment-000-generation-two"
	applyRemotePrivateDelivery(t, database, store, newGeneration)
	assertCount(105)

	for _, test := range []struct {
		name   string
		change func(*privatecontentpb.FederatedPrivateResourceDelivery)
	}{
		{"source", func(m *privatecontentpb.FederatedPrivateResourceDelivery) { m.SourceStationPeerId = "station-other" }},
		{"viewer", func(m *privatecontentpb.FederatedPrivateResourceDelivery) { m.TargetActor.Ptid = "ptid:eve" }},
		{"parent", func(m *privatecontentpb.FederatedPrivateResourceDelivery) { m.GetComment().PostId = "post-other" }},
		{"federation", func(m *privatecontentpb.FederatedPrivateResourceDelivery) { m.FederationId = "federation-other" }},
		{"station", func(m *privatecontentpb.FederatedPrivateResourceDelivery) { m.TargetStationPeerId = "station-other" }},
		{"other-device", func(m *privatecontentpb.FederatedPrivateResourceDelivery) {
			m.TargetActorEnvelopes[0].GetEndpoint().DeviceId = "device-other"
		}},
		{"recovery-only", func(m *privatecontentpb.FederatedPrivateResourceDelivery) {
			envelope := m.TargetActorEnvelopes[0]
			envelope.Binding.RecipientKeyKind = securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY
			envelope.Recipient = &securecontentpb.ViewerContentKeyEnvelope_RecoveryActor{RecoveryActor: m.TargetActor}
		}},
		{"ambiguous-envelope", func(m *privatecontentpb.FederatedPrivateResourceDelivery) {
			second := proto.Clone(m.TargetActorEnvelopes[0]).(*securecontentpb.ViewerContentKeyEnvelope)
			second.Binding.RecipientKeyId = "prekey-two"
			m.TargetActorEnvelopes = append(m.TargetActorEnvelopes, second)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			message := comment("excluded-" + test.name)
			test.change(message)
			applyRemotePrivateDelivery(t, database, store, message)
			assertCount(105)
		})
	}
	missingEnvelope := comment("excluded-no-envelope")
	applyRemotePrivateDelivery(t, database, store, missingEnvelope)
	if err := database.Where("content_id = ?", missingEnvelope.Resource.ContentId).
		Delete(&remotePrivateEnvelopeModel{}).Error; err != nil {
		t.Fatal(err)
	}
	assertCount(105)
	inactive := comment("excluded-inactive")
	applyRemotePrivateDelivery(t, database, store, inactive)
	if err := database.Model(&remotePrivateResourceModel{}).Where("content_id = ?", inactive.Resource.ContentId).
		Update("state", "REVOKED").Error; err != nil {
		t.Fatal(err)
	}
	assertCount(105)
	for index, direction := range [][2]string{
		{"ptid:bob", "ptid:blocked-out"}, {"ptid:blocked-in", "ptid:bob"},
	} {
		blocked := comment(fmt.Sprintf("excluded-blocked-%d", index))
		blocked.GetComment().Author.Ptid = direction[0]
		if direction[0] == "ptid:bob" {
			blocked.GetComment().Author.Ptid = direction[1]
		}
		applyRemotePrivateDelivery(t, database, store, blocked)
		if err := database.Create(&socialDirectionalRelationshipModel{
			ActorPTID: direction[0], TargetActorPTID: direction[1],
			ActorHomeStationPeerID: "station-b", TargetHomeStationPeerID: "station-a",
			Blocked: true, Revision: 1, UpdatedAt: parent.GetCommittedAt().AsTime(),
		}).Error; err != nil {
			t.Fatal(err)
		}
		assertCount(105)
	}
	invalidation := privateInvalidationFixture(2)
	invalidation.Resource = comment("comment-001").Resource
	if err := database.Transaction(func(tx *gorm.DB) error {
		_, err := store.ApplyRemotePrivateResourceInvalidation(ctx,
			remotePrivateStoreTransaction{database: tx}, invalidation, mustCanonicalPrivateInvalidation(t, invalidation))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	assertCount(104)
	var after remotePrivateResourceModel
	if err := database.Where("content_id = ?", "post-count").First(&after).Error; err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after.ViewerMetadataBytes, retained.ViewerMetadataBytes) ||
		!bytes.Equal(after.CanonicalDeliveryHash, retained.CanonicalDeliveryHash) ||
		!after.UpdatedAt.Equal(retained.UpdatedAt) {
		t.Fatal("aggregate read rewrote immutable parent delivery")
	}
	for _, viewer := range []struct{ actor, device string }{
		{"ptid:eve", "device-one"}, {"ptid:bob", "device-other"},
	} {
		called := false
		err := store.ReadRemotePrivatePost(ctx, "post-count", viewer.actor, viewer.device,
			func(_ federationdelivery.Transaction, _ *RemotePrivatePostReadModel) error { called = true; return nil })
		if err == nil || called {
			t.Fatalf("denied parent exposed aggregate for %+v: %v", viewer, err)
		}
	}
	block := &socialDirectionalRelationshipModel{
		ActorPTID: "ptid:bob", TargetActorPTID: "ptid:alice",
		ActorHomeStationPeerID: "station-b", TargetHomeStationPeerID: "station-a",
		Blocked: true, Revision: 1, UpdatedAt: parent.GetCommittedAt().AsTime(),
	}
	if err := database.Create(block).Error; err != nil {
		t.Fatal(err)
	}
	called := false
	if err := store.ReadRemotePrivatePost(ctx, "post-count", "ptid:bob", "device-one",
		func(_ federationdelivery.Transaction, _ *RemotePrivatePostReadModel) error { called = true; return nil },
	); !errors.Is(err, ErrPrivateContentNotFound) || called {
		t.Fatalf("blocked parent exposed aggregate: %v", err)
	}
	if err := database.Where("actor_ptid = ? AND target_actor_ptid = ?", "ptid:bob", "ptid:alice").
		Delete(&socialDirectionalRelationshipModel{}).Error; err != nil {
		t.Fatal(err)
	}
	invalidation.Resource = parent.Resource
	if err := database.Transaction(func(tx *gorm.DB) error {
		_, err := store.ApplyRemotePrivateResourceInvalidation(ctx,
			remotePrivateStoreTransaction{database: tx}, invalidation, mustCanonicalPrivateInvalidation(t, invalidation))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.ReadRemotePrivatePost(ctx, "post-count", "ptid:bob", "device-one",
		func(_ federationdelivery.Transaction, _ *RemotePrivatePostReadModel) error { called = true; return nil },
	); !errors.Is(err, ErrPrivateContentNotFound) || called {
		t.Fatalf("revoked parent exposed aggregate: %v", err)
	}
}

type remotePrivateStoreTransaction struct {
	database *gorm.DB
}

func (t remotePrivateStoreTransaction) DB() *gorm.DB {
	return t.database
}

func (remotePrivateStoreTransaction) Outbox() federationdelivery.OutboxWriter {
	return nil
}

func remotePrivateDeliveryFixture(
	sourceStationPeerID string,
	targetActorPTID string,
	contentID string,
	deliveryID string,
) *privatecontentpb.FederatedPrivateResourceDelivery {
	resource := &securecontentpb.SecureResourceRef{
		OwnerDomain: securecontentpb.
			SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
		ContentId:  contentID,
		Generation: 1,
	}
	target := &actormodel.ActorRef{
		Ptid: targetActorPTID,
		Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
	}
	return &privatecontentpb.FederatedPrivateResourceDelivery{
		FormatVersion:       1,
		FederationId:        "federation-one",
		DeliveryId:          deliveryID,
		SourceStationPeerId: sourceStationPeerID,
		TargetStationPeerId: "station-b",
		TargetActor:         target,
		ResourceKind: privatecontentpb.
			FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST,
		Resource:          resource,
		LifecycleRevision: 1,
		Metadata: &privatecontentpb.FederatedPrivateResourceDelivery_Post{
			Post: &privatecontentpb.PostMetadata{
				PostId:    contentID,
				ContentId: contentID,
				Author: &actormodel.ActorRef{
					Ptid: "ptid:alice",
					Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
				},
			},
		},
		Payload: &securecontentpb.EncryptedPayload{
			Resource: resource,
		},
		TargetActorEnvelopes: []*securecontentpb.ViewerContentKeyEnvelope{{
			Binding: &securecontentpb.ContentKeyEnvelopeBinding{
				RecipientKeyKind: securecontentpb.
					ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT,
				RecipientKeyId: "prekey-one",
			},
			Recipient: &securecontentpb.ViewerContentKeyEnvelope_Endpoint{
				Endpoint: &actormodel.ActorDeviceRef{
					Actor:    target,
					DeviceId: "device-one",
				},
			},
		}},
		Verification:        &privatecontentpb.PrivateContentVerification{},
		AudienceExplanation: &actormodel.AudienceExplanation{},
		CommittedAt: timestamppb.New(
			time.Date(2026, 10, 3, 20, 0, 0, 0, time.UTC),
		),
	}
}
