package infrastructure

import (
	"context"
	"testing"

	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestMomentReadPolicyRemoteCommentRequiresCurrentDelivery(t *testing.T) {
	ctx := context.Background()
	database, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	store, err := NewGORMPrivateContentStore(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	friends, err := NewGORMFederatedFriendRequestStore(database, federationdelivery.SystemClock{})
	if err != nil {
		t.Fatal(err)
	}
	if err := friends.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	post := remotePrivateDeliveryFixture("station-a", "ptid:bob", "post-policy", "delivery-post")
	comment := remotePrivateDeliveryFixture("station-a", "ptid:bob", "comment-policy", "delivery-comment")
	comment.ResourceKind = privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT
	comment.Metadata = &privatecontentpb.FederatedPrivateResourceDelivery_Comment{
		Comment: &privatecontentpb.CommentMetadata{
			PostId: post.Resource.ContentId, CommentId: comment.Resource.ContentId,
			ContentId: comment.Resource.ContentId, Author: post.GetPost().Author,
		},
	}
	for _, message := range []*privatecontentpb.FederatedPrivateResourceDelivery{post, comment} {
		message.Verification.CommitProof = &securecontentpb.ViewerContentCommitProof{
			FormatVersion: 1, DomainCommitId: message.Resource.ContentId, Resource: message.Resource,
		}
		message.AudienceExplanation.ViewerIsMember = true
		canonical, err := proto.Marshal(message)
		if err != nil {
			t.Fatal(err)
		}
		if err := database.Transaction(func(tx *gorm.DB) error {
			_, err := store.ApplyRemotePrivateResource(ctx,
				remotePrivateStoreTransaction{database: tx}, message, canonical)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	targets := []*privatecontentpb.MomentReadPolicyTarget{
		{ItemId: "post", PostId: post.Resource.ContentId},
		{ItemId: "comment", PostId: post.Resource.ContentId, CommentId: comment.Resource.ContentId},
	}
	check := func(wantComment privatecontentpb.MomentReadDecision) {
		t.Helper()
		result, err := store.CheckMomentReadPolicy(ctx, "ptid:bob", "device-one", targets)
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Outcomes) != 2 ||
			result.Outcomes[0].Decision != privatecontentpb.MomentReadDecision_MOMENT_READ_DECISION_READABLE ||
			result.Outcomes[1].Decision != wantComment {
			t.Fatalf("current policy = %+v", result)
		}
	}
	check(privatecontentpb.MomentReadDecision_MOMENT_READ_DECISION_READABLE)
	if err := database.Where("content_id = ?", comment.Resource.ContentId).
		Delete(&remotePrivateEnvelopeModel{}).Error; err != nil {
		t.Fatal(err)
	}
	check(privatecontentpb.MomentReadDecision_MOMENT_READ_DECISION_UNAVAILABLE)
}
