package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestFederatedPrivateTombstoneRejectsStaleDeliveryWithoutResurrection(
	t *testing.T,
) {
	database, store := newPrivateRevocationStore(t)
	ctx := context.Background()
	deliveryMessage := remotePrivateDeliveryFixture(
		"station-a",
		"ptid:bob",
		"post-a",
		"delivery-a",
	)
	applyRemotePrivateDelivery(t, database, store, deliveryMessage)

	invalidation := privateInvalidationFixture(2)
	canonical := mustCanonicalPrivateInvalidation(t, invalidation)
	var result RemotePrivateInvalidationResult
	if err := database.Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = store.ApplyRemotePrivateResourceInvalidation(
			ctx,
			remotePrivateStoreTransaction{database: tx},
			invalidation,
			canonical,
		)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if result.Duplicate || result.PostID != "post-a" {
		t.Fatalf("first invalidation result = %+v", result)
	}
	assertPrivateRevocationTableCount(
		t,
		database,
		"social_remote_private_resources",
		0,
	)
	assertPrivateRevocationTableCount(
		t,
		database,
		"social_remote_private_envelopes",
		0,
	)
	assertPrivateRevocationTableCount(
		t,
		database,
		"social_remote_private_tombstones",
		1,
	)

	staleCanonical := mustCanonicalRemoteDelivery(t, deliveryMessage)
	if err := database.Transaction(func(tx *gorm.DB) error {
		_, err := store.ApplyRemotePrivateResource(
			ctx,
			remotePrivateStoreTransaction{database: tx},
			deliveryMessage,
			staleCanonical,
		)
		return err
	}); !errors.Is(err, ErrPrivateContentStaleRevision) {
		t.Fatalf("stale delivery error = %v", err)
	}

	newer := proto.Clone(
		deliveryMessage,
	).(*privatecontentpb.FederatedPrivateResourceDelivery)
	newer.LifecycleRevision = 3
	newer.CommittedAt = timestamppb.New(
		invalidation.GetCommittedAt().AsTime().Add(time.Minute),
	)
	applyRemotePrivateDelivery(t, database, store, newer)
	assertPrivateRevocationTableCount(
		t,
		database,
		"social_remote_private_resources",
		1,
	)
}

func TestFederatedPrivateInvalidationIsMonotonicAndHashBound(
	t *testing.T,
) {
	database, store := newPrivateRevocationStore(t)
	ctx := context.Background()
	newer := privateInvalidationFixture(3)
	if err := database.Transaction(func(tx *gorm.DB) error {
		_, err := store.ApplyRemotePrivateResourceInvalidation(
			ctx,
			remotePrivateStoreTransaction{database: tx},
			newer,
			mustCanonicalPrivateInvalidation(t, newer),
		)
		return err
	}); err != nil {
		t.Fatal(err)
	}

	older := privateInvalidationFixture(2)
	var olderResult RemotePrivateInvalidationResult
	if err := database.Transaction(func(tx *gorm.DB) error {
		var err error
		olderResult, err = store.ApplyRemotePrivateResourceInvalidation(
			ctx,
			remotePrivateStoreTransaction{database: tx},
			older,
			mustCanonicalPrivateInvalidation(t, older),
		)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if !olderResult.Duplicate {
		t.Fatalf("older invalidation result = %+v", olderResult)
	}

	conflict := proto.Clone(
		newer,
	).(*privatecontentpb.FederatedPrivateResourceInvalidation)
	conflict.Reason = privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_RECIPIENT_BLOCKED
	err := database.Transaction(func(tx *gorm.DB) error {
		_, applyErr := store.ApplyRemotePrivateResourceInvalidation(
			ctx,
			remotePrivateStoreTransaction{database: tx},
			conflict,
			mustCanonicalPrivateInvalidation(t, conflict),
		)
		return applyErr
	})
	if !errors.Is(err, ErrPrivateContentConflict) {
		t.Fatalf("same-revision hash conflict error = %v", err)
	}

	var tombstone remotePrivateTombstoneModel
	if err := database.First(&tombstone).Error; err != nil {
		t.Fatal(err)
	}
	if tombstone.LifecycleRevision != 3 ||
		tombstone.Reason != int32(
			privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_RESOURCE_DELETED,
		) {
		t.Fatalf("monotonic tombstone = %+v", tombstone)
	}
}

func TestFederatedPrivateTombstoneLocalBlockSuppressesImmediately(
	t *testing.T,
) {
	database, store := newPrivateRevocationStore(t)
	ctx := context.Background()
	message := remotePrivateDeliveryFixture(
		"station-a",
		"ptid:bob",
		"post-a",
		"delivery-a",
	)
	message.GetPost().Author = &actormodel.ActorRef{
		Ptid: "ptid:alice",
		Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
	}
	message.GetPost().AudienceKind = actormodel.Audience_FRIENDS
	applyRemotePrivateDelivery(t, database, store, message)

	var suppressed []string
	if err := database.Transaction(func(tx *gorm.DB) error {
		var err error
		suppressed, err = store.SuppressRemotePrivateResources(
			ctx,
			remotePrivateStoreTransaction{database: tx},
			RemotePrivateSuppressionRequest{
				ViewerPTID: "ptid:bob",
				AuthorPTID: "ptid:alice",
				Reason:     privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_RECIPIENT_BLOCKED,
				CommittedAt: time.Date(
					2026,
					10,
					4,
					11,
					0,
					0,
					0,
					time.UTC,
				),
			},
		)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if len(suppressed) != 1 || suppressed[0] != "post-a" {
		t.Fatalf("suppressed private posts = %v", suppressed)
	}
	assertPrivateRevocationTableCount(
		t,
		database,
		"social_remote_private_resources",
		0,
	)
	var tombstone remotePrivateTombstoneModel
	if err := database.First(&tombstone).Error; err != nil {
		t.Fatal(err)
	}
	if tombstone.LifecycleRevision != message.GetLifecycleRevision() ||
		tombstone.Reason != int32(
			privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_RECIPIENT_BLOCKED,
		) {
		t.Fatalf("local block tombstone = %+v", tombstone)
	}
}

func newPrivateRevocationStore(
	t *testing.T,
) (*gorm.DB, *GORMPrivateContentStore) {
	t.Helper()
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
	if err := MigrateIdentitySchema(database); err != nil {
		t.Fatal(err)
	}
	return database, store
}

func privateInvalidationFixture(
	revision uint64,
) *privatecontentpb.FederatedPrivateResourceInvalidation {
	deliveryMessage := remotePrivateDeliveryFixture(
		"station-a",
		"ptid:bob",
		"post-a",
		"delivery-a",
	)
	return &privatecontentpb.FederatedPrivateResourceInvalidation{
		FormatVersion:       1,
		FederationId:        deliveryMessage.GetFederationId(),
		SourceStationPeerId: deliveryMessage.GetSourceStationPeerId(),
		TargetStationPeerId: deliveryMessage.GetTargetStationPeerId(),
		TargetActor:         deliveryMessage.GetTargetActor(),
		Resource:            deliveryMessage.GetResource(),
		LifecycleRevision:   revision,
		Reason:              privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_RESOURCE_DELETED,
		CommittedAt: timestamppb.New(
			time.Date(2026, 10, 4, 10, 0, 0, 0, time.UTC),
		),
	}
}

func applyRemotePrivateDelivery(
	t *testing.T,
	database *gorm.DB,
	store *GORMPrivateContentStore,
	message *privatecontentpb.FederatedPrivateResourceDelivery,
) {
	t.Helper()
	canonical := mustCanonicalRemoteDelivery(t, message)
	if err := database.Transaction(func(tx *gorm.DB) error {
		_, err := store.ApplyRemotePrivateResource(
			context.Background(),
			remotePrivateStoreTransaction{database: tx},
			message,
			canonical,
		)
		return err
	}); err != nil {
		t.Fatal(err)
	}
}

func mustCanonicalRemoteDelivery(
	t *testing.T,
	message *privatecontentpb.FederatedPrivateResourceDelivery,
) []byte {
	t.Helper()
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func mustCanonicalPrivateInvalidation(
	t *testing.T,
	message *privatecontentpb.FederatedPrivateResourceInvalidation,
) []byte {
	t.Helper()
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func assertPrivateRevocationTableCount(
	t *testing.T,
	database *gorm.DB,
	table string,
	want int64,
) {
	t.Helper()
	var count int64
	if err := database.Table(table).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("%s count = %d, want %d", table, count, want)
	}
}

var _ federationdelivery.Transaction = remotePrivateStoreTransaction{}
