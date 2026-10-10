package infrastructure

import (
	"context"
	"testing"
	"time"

	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFederatedPrivateReconcileListsOnlyActiveViewerScopedMoments(
	t *testing.T,
) {
	database, err := gorm.Open(
		sqlite.Open("file:federated_private_reconcile?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateIdentitySchema(database); err != nil {
		t.Fatal(err)
	}
	store, err := NewGORMPrivateContentStore(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !database.Migrator().HasIndex(
		&remotePrivateResourceModel{},
		"idx_social_remote_private_reconcile",
	) {
		t.Fatal("remote private Moment reconcile index is missing")
	}
	now := time.Unix(1_800_000_000, 0).UTC()
	rows := []remotePrivateResourceModel{
		{
			SourceStationPeerID: "station-a",
			ContentID:           "01REMOTEPOST00000000000001",
			Generation:          1,
			TargetActorPTID:     "ptid:bob",
			FederationID:        "federation-one",
			DeliveryID:          "delivery-1",
			TargetStationPeerID: "station-b",
			AuthorPTID:          "ptid:alice",
			LifecycleRevision:   1,
			ResourceKind: int32(
				privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST,
			),
			State:       remotePrivateResourceStateActive,
			CommittedAt: now,
			UpdatedAt:   now,
		},
		{
			SourceStationPeerID: "station-a",
			ContentID:           "01REMOTEPOST00000000000002",
			Generation:          1,
			TargetActorPTID:     "ptid:eve",
			FederationID:        "federation-one",
			DeliveryID:          "delivery-2",
			TargetStationPeerID: "station-b",
			AuthorPTID:          "ptid:alice",
			LifecycleRevision:   1,
			ResourceKind: int32(
				privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST,
			),
			State:       remotePrivateResourceStateActive,
			CommittedAt: now.Add(-time.Second),
			UpdatedAt:   now.Add(-time.Second),
		},
		{
			SourceStationPeerID: "station-a",
			ContentID:           "01REMOTECOMMENT00000000001",
			Generation:          1,
			TargetActorPTID:     "ptid:bob",
			FederationID:        "federation-one",
			DeliveryID:          "delivery-3",
			TargetStationPeerID: "station-b",
			AuthorPTID:          "ptid:alice",
			LifecycleRevision:   1,
			ResourceKind: int32(
				privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT,
			),
			State:       remotePrivateResourceStateActive,
			CommittedAt: now.Add(-2 * time.Second),
			UpdatedAt:   now.Add(-2 * time.Second),
		},
		{
			SourceStationPeerID: "station-c",
			ContentID:           "01REMOTEBLOCKED00000000001",
			Generation:          1,
			TargetActorPTID:     "ptid:bob",
			FederationID:        "federation-one",
			DeliveryID:          "delivery-4",
			TargetStationPeerID: "station-b",
			AuthorPTID:          "ptid:charlie",
			LifecycleRevision:   1,
			ResourceKind: int32(
				privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST,
			),
			State:       remotePrivateResourceStateActive,
			CommittedAt: now.Add(-3 * time.Second),
			UpdatedAt:   now.Add(-3 * time.Second),
		},
	}
	for index := range rows {
		rows[index].ViewerMetadataBytes = []byte{1}
		rows[index].EncryptedPayloadBytes = []byte{1}
		rows[index].ObjectDescriptorBytes = []byte{1}
		rows[index].VerificationBytes = []byte{1}
		rows[index].AudienceBytes = []byte{1}
		rows[index].CanonicalDeliveryHash = []byte{1}
	}
	if err := database.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&socialDirectionalRelationshipModel{
		ActorPTID:               "ptid:bob",
		TargetActorPTID:         "ptid:charlie",
		ActorHomeStationPeerID:  "station-b",
		TargetHomeStationPeerID: "station-c",
		Blocked:                 true,
		Revision:                1,
		UpdatedAt:               now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	references, err := store.ListRemotePrivateMomentReferences(
		context.Background(),
		RemotePrivateMomentReferenceQuery{
			ActorPTID: "ptid:bob",
			Limit:     10,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(references) != 1 ||
		references[0].PostID != "01REMOTEPOST00000000000001" ||
		references[0].LifecycleRevision != 1 {
		t.Fatalf("remote references = %+v", references)
	}
}
