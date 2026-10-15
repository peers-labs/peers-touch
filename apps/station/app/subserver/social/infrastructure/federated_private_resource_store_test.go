package infrastructure

import (
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
