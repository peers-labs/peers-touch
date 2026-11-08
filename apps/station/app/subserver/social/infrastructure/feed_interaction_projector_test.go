package infrastructure

import (
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

func interactionFixture(t *testing.T) (*FeedLogStore, *gorm.DB, *model.FeedBundle) {
	t.Helper()
	store, database, bundle, _ := feedStoreFixture(t)
	if err := database.AutoMigrate(&db.Actor{}, &db.SocialPublicPost{}, &db.SocialComment{}, &db.SocialReaction{}); err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&db.Actor{ID: 1, PTID: "ptid:test:alice",
		PreferredUsername: "alice", Email: "alice@example.test"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&FeedObjectRecord{HomeStation: "station-a", ObjectKind: "post",
		ObjectID: "101", ActorPTID: "ptid:test:alice", LocalID: 901, Sequence: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&db.SocialPublicPost{ID: 901, AuthorID: 1}).Error; err != nil {
		t.Fatal(err)
	}
	return store, database, bundle
}

func TestFeedCommentReactionsBindParentAndIsolateVersions(t *testing.T) {
	store, database, bundle := interactionFixture(t)
	ctx := context.Background()
	projector := NewFeedProjector("station-a")
	put := func(receipt *model.FeedInteraction) error {
		return store.Transaction(ctx, func(tx *gorm.DB) error {
			_, err := projector.StoreInteraction(ctx, tx, receipt, "station-b", true)
			return err
		})
	}
	target := "oss://station-a/post/101"
	commentRef := "oss://station-b/comment/102"
	reaction := func(sequence uint64, comment string, kind model.FeedEventKind) *model.FeedInteraction {
		return makeInteraction(t, bundle, sequence, kind, &model.FeedPayload{Mutation: &model.FeedPayload_Reaction{
			Reaction: &model.FeedReactionMutation{TargetPostRef: target, TargetCommentRef: comment, ReactionKind: 1}}})
	}
	// The comment is not here yet. Receipt survives without materializing a
	// reaction or occupying the parent's reaction version.
	deferred := reaction(8, commentRef, model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET)
	if err := put(deferred); err != nil {
		t.Fatal(err)
	}
	var count int64
	database.Model(&db.SocialReaction{}).Count(&count)
	if count != 0 {
		t.Fatal("missing comment became a post reaction")
	}
	request, _ := signedlog.Canonical(&model.CreateCommentRequest{PostId: target, Content: "root"})
	created := makeInteraction(t, bundle, 3, model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED,
		&model.FeedPayload{Mutation: &model.FeedPayload_Comment{Comment: &model.FeedCommentMutation{
			CommentId: "102", TargetPostRef: target, CreateRequest: request}}})
	for _, receipt := range []*model.FeedInteraction{created, deferred, deferred,
		reaction(7, "", model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET),
		reaction(10, commentRef, model.FeedEventKind_FEED_EVENT_KIND_REACTION_REMOVED),
		reaction(9, commentRef, model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET)} {
		if err := put(receipt); err != nil {
			t.Fatal(err)
		}
	}
	var comment db.SocialComment
	if err := database.Where("post_id = ?", 901).Take(&comment).Error; err != nil {
		t.Fatal("stale reaction resurrected comment like", comment, err)
	}
	var rows []db.SocialReaction
	if err := database.Find(&rows).Error; err != nil || len(rows) != 1 || rows[0].CommentID != "" {
		t.Fatal("comment removal affected parent reaction", rows, err)
	}
	if err := database.Create(&FeedObjectRecord{HomeStation: "station-a", ObjectKind: "post",
		ObjectID: "201", ActorPTID: "ptid:test:alice", LocalID: 902, Sequence: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&db.SocialPublicPost{ID: 902, AuthorID: 1}).Error; err != nil {
		t.Fatal(err)
	}
	wrongParent := reaction(11, commentRef, model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET)
	payload := &model.FeedPayload{}
	signedlog.Decode(wrongParent.Event.Payload, payload)
	payload.GetReaction().TargetPostRef = "oss://station-a/post/201"
	wrongParent = makeInteraction(t, bundle, 11, model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET, payload)
	if err := put(wrongParent); !errors.Is(err, domain.ErrFeedInvalid) {
		t.Fatal("wrong parent accepted", err)
	}
	now := time.Now().UTC()
	database.Model(&comment).Update("deleted_at", now)
	if err := put(reaction(12, commentRef, model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET)); err != nil {
		t.Fatal(err)
	}
	database.Model(&db.SocialReaction{}).Where("comment_id <> ''").Count(&count)
	if count != 0 {
		t.Fatal("deleted comment reaction resurrected")
	}
}

func makeInteraction(t *testing.T, bundle *model.FeedBundle, sequence uint64,
	kind model.FeedEventKind, payload *model.FeedPayload) *model.FeedInteraction {
	t.Helper()
	event := proto.Clone(bundle.Events[0]).(*model.FeedEvent)
	event.Statement.Sequence, event.Statement.Kind = sequence, kind
	var err error
	event.Payload, err = signedlog.Canonical(payload)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(event.Payload)
	event.Statement.PayloadHash = sum[:]
	signStoreEvent(t, event)
	if err := domain.VerifyFeedEvent(event, bundle.WriterGrant); err != nil {
		t.Fatal(err)
	}
	return &model.FeedInteraction{Genesis: bundle.Genesis, WriterGrant: bundle.WriterGrant, Event: event}
}

func TestFeedInteractionOutOfOrderReactionAndExactReplay(t *testing.T) {
	store, database, bundle := interactionFixture(t)
	ctx := context.Background()
	projector := NewFeedProjector("station-a")
	reaction := &model.FeedPayload{Mutation: &model.FeedPayload_Reaction{
		Reaction: &model.FeedReactionMutation{TargetPostRef: "oss://station-a/post/101", ReactionKind: 1}}}
	removed := makeInteraction(t, bundle, 9, model.FeedEventKind_FEED_EVENT_KIND_REACTION_REMOVED, reaction)
	set := makeInteraction(t, bundle, 8, model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET, reaction)
	for _, receipt := range []*model.FeedInteraction{removed, set, removed} {
		if err := store.Transaction(ctx, func(tx *gorm.DB) error {
			_, err := projector.StoreInteraction(ctx, tx, receipt, "station-b", true)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	var count int64
	if err := database.Model(&db.SocialReaction{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("stale set resurrected a removed reaction", count, err)
	}
	if err := database.Model(&FeedInteractionRecord{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatal("exact receipt replay duplicated storage", count, err)
	}
	changed := proto.Clone(removed).(*model.FeedInteraction)
	changed.Event.Statement.CreatedAtUnixMs++
	signStoreEvent(t, changed.Event)
	err := store.Transaction(ctx, func(tx *gorm.DB) error {
		_, err := projector.StoreInteraction(ctx, tx, changed, "station-b", true)
		return err
	})
	if !errors.Is(err, domain.ErrFeedFork) {
		t.Fatal("conflicting signed receipt accepted", err)
	}
	if err := database.Model(&FeedChainRecord{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("interaction authenticity fabricated chain continuity", count, err)
	}
}

func TestFeedInteractionCountsPreserveSignedParentTimestamps(t *testing.T) {
	store, database, bundle := interactionFixture(t)
	ctx := context.Background()
	authored := time.UnixMilli(bundle.Events[0].Statement.CreatedAtUnixMs).UTC()
	if err := database.Model(&db.SocialPublicPost{}).Where("id = ?", 901).
		Updates(map[string]interface{}{"created_at": authored, "updated_at": authored}).Error; err != nil {
		t.Fatal(err)
	}
	projector := NewFeedProjector("station-a")
	reaction := &model.FeedPayload{Mutation: &model.FeedPayload_Reaction{
		Reaction: &model.FeedReactionMutation{TargetPostRef: "oss://station-a/post/101", ReactionKind: 1}}}
	for index, kind := range []model.FeedEventKind{
		model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET,
		model.FeedEventKind_FEED_EVENT_KIND_REACTION_REMOVED,
	} {
		receipt := makeInteraction(t, bundle, uint64(index+2), kind, reaction)
		if err := store.Transaction(ctx, func(tx *gorm.DB) error {
			_, err := projector.StoreInteraction(ctx, tx, receipt, "station-b", true)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		var post db.SocialPublicPost
		if err := database.Where("id = ?", 901).Take(&post).Error; err != nil {
			t.Fatal(err)
		}
		if !post.CreatedAt.Equal(authored) || !post.UpdatedAt.Equal(authored) || post.EditedAt != nil {
			t.Fatalf("derived reaction count rewrote authored timestamps: created=%s updated=%s",
				post.CreatedAt, post.UpdatedAt)
		}
		expected := "{}"
		if index == 0 {
			expected = `{"REACTION_LIKE":1}`
		}
		if post.ReactionsCountJSON != expected {
			t.Fatalf("reaction count was not updated: got=%s want=%s", post.ReactionsCountJSON, expected)
		}
	}
}

func TestFeedInteractionDeferredCommentAndPortableReply(t *testing.T) {
	store, database, bundle := interactionFixture(t)
	ctx := context.Background()
	projector := NewFeedProjector("station-a")
	comment := func(object, content, parent string, sequence uint64, kind model.FeedEventKind) *model.FeedInteraction {
		request, err := signedlog.Canonical(&model.CreateCommentRequest{PostId: "oss://station-a/post/101",
			Content: content, ReplyToCommentId: parent})
		if err != nil {
			t.Fatal(err)
		}
		return makeInteraction(t, bundle, sequence, kind, &model.FeedPayload{Mutation: &model.FeedPayload_Comment{
			Comment: &model.FeedCommentMutation{CommentId: object, TargetPostRef: "oss://station-a/post/101", CreateRequest: request}}})
	}
	updated := comment("102", "updated", "", 4, model.FeedEventKind_FEED_EVENT_KIND_COMMENT_UPDATED)
	created := comment("102", "created", "", 3, model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED)
	storeReceipt := func(receipt *model.FeedInteraction) {
		t.Helper()
		if err := store.Transaction(ctx, func(tx *gorm.DB) error {
			_, err := projector.StoreInteraction(ctx, tx, receipt, "station-b", true)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	storeReceipt(updated)
	storeReceipt(created)
	storeReceipt(updated)
	reply := comment("103", "reply", "oss://station-b/comment/102", 5, model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED)
	storeReceipt(reply)
	var object FeedObjectRecord
	if err := database.Where("object_kind = 'comment' AND object_id = '102'").Take(&object).Error; err != nil {
		t.Fatal(err)
	}
	var parent db.SocialComment
	if err := database.First(&parent, "id = ?", object.LocalID).Error; err != nil ||
		parent.ID == 102 || parent.PostID != 901 || parent.TextBody != "updated" {
		t.Fatal("remote object IDs were not translated or deferred edit was lost", parent, err)
	}
	var child db.SocialComment
	if err := database.Where("parent_comment_id = ?", parent.ID).Take(&child).Error; err != nil || child.TextBody != "reply" {
		t.Fatal("portable reply lost its target", child, err)
	}
	var post db.SocialPublicPost
	if err := database.First(&post, "id = ?", 901).Error; err != nil || post.CommentsCount != 2 {
		t.Fatal("comment count not derived from projected objects", post, err)
	}
}
