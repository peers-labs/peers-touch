package infrastructure

import (
	"context"
	"crypto/sha256"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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

func interactionBatch(t *testing.T, bundle *model.FeedBundle, targets ...string) *model.FeedBundle {
	t.Helper()
	batch := proto.Clone(bundle).(*model.FeedBundle)
	batch.Events = nil
	previous, err := signedlog.Hash(domain.FeedGenesisDomain, bundle.Genesis)
	if err != nil {
		t.Fatal(err)
	}
	for i, target := range targets {
		receipt := makeInteraction(t, bundle, uint64(i+1), model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET,
			&model.FeedPayload{Mutation: &model.FeedPayload_Reaction{
				Reaction: &model.FeedReactionMutation{TargetPostRef: target, ReactionKind: 1}}})
		receipt.Event.Statement.PreviousHash = previous
		signStoreEvent(t, receipt.Event)
		previous, err = domain.FeedEventHash(receipt.Event)
		if err != nil {
			t.Fatal(err)
		}
		batch.Events = append(batch.Events, receipt.Event)
	}
	return batch
}

func TestFeedAppendLocksWholeBatchBeforeReceiptAndThread(t *testing.T) {
	for _, multiAuthor := range []bool{false, true} {
		t.Run(map[bool]string{false: "same-author", true: "multiple-authors"}[multiAuthor], func(t *testing.T) {
			store, database, bundle := interactionFixture(t)
			secondAuthor := "ptid:test:alice"
			if multiAuthor {
				secondAuthor = "ptid:test:bob"
			}
			if err := database.Create(&FeedObjectRecord{HomeStation: "station-a", ObjectKind: "post",
				ObjectID: "201", ActorPTID: secondAuthor, LocalID: 902, Sequence: 1}).Error; err != nil {
				t.Fatal(err)
			}
			if err := database.Create(&db.SocialPublicPost{ID: 902, AuthorID: 1}).Error; err != nil {
				t.Fatal(err)
			}
			// Reverse both target/author order and repeat a parent. The lock
			// set must still be complete, sorted and deduplicated.
			batch := interactionBatch(t, bundle, "oss://station-a/post/201",
				"oss://station-a/post/101", "oss://station-a/post/201")
			var objects, posts []uint64
			var authors []string
			query := "test:feed-batch-locks"
			if err := database.Callback().Query().After("gorm:query").Register(query, func(tx *gorm.DB) {
				if _, locked := tx.Statement.Clauses["FOR"]; !locked || tx.Error != nil {
					return
				}
				switch row := tx.Statement.Dest.(type) {
				case *FeedObjectRecord:
					objects = append(objects, row.LocalID)
				case *db.SocialPublicPost:
					posts = append(posts, row.ID)
				case *FeedThreadHead:
					authors = append(authors, row.AuthorPTID)
				}
			}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = database.Callback().Query().Remove(query) })
			create := "test:feed-batch-write-boundary"
			receipts := 0
			if err := database.Callback().Create().Before("gorm:create").Register(create, func(tx *gorm.DB) {
				switch tx.Statement.Dest.(type) {
				case *FeedThreadHead:
					if !reflect.DeepEqual(objects, []uint64{901, 902}) || !reflect.DeepEqual(posts, []uint64{901, 902}) {
						t.Errorf("thread lock before complete parent set: objects=%v posts=%v", objects, posts)
					}
				case *FeedInteractionRecord:
					wantAuthors := []string{"ptid:test:alice"}
					if multiAuthor {
						wantAuthors = append(wantAuthors, "ptid:test:bob")
					}
					if !reflect.DeepEqual(authors, wantAuthors) {
						t.Errorf("receipt before sorted thread-head set: got=%v want=%v", authors, wantAuthors)
					}
					receipts++
				}
			}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = database.Callback().Create().Remove(create) })
			projector := NewFeedProjector("station-a")
			if err := store.Transaction(context.Background(), func(tx *gorm.DB) error {
				_, _, err := store.AppendTx(context.Background(), tx, batch, "ptid:test:alice", "station-b",
					bundle.Genesis.Statement.ActorIdentityPublicKey, projector.Apply, false)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			if receipts != 3 {
				t.Fatalf("regression did not exercise the append batch: %d receipts", receipts)
			}
		})
	}
}

func TestFeedInteractionBatchKeepsAbsentParentSnapshot(t *testing.T) {
	store, database, bundle := interactionFixture(t)
	projector := NewFeedProjector("station-a")
	batch := interactionBatch(t, bundle, "oss://station-a/post/101", "oss://station-a/post/201")
	ctx := context.Background()
	if err := store.Transaction(ctx, func(tx *gorm.DB) error {
		bound, err := projector.LockInteractions(ctx, tx, batch.Events)
		if err != nil {
			return err
		}
		// Simulate the parent arriving after the transaction's lock snapshot.
		if err := tx.Create(&FeedObjectRecord{HomeStation: "station-a", ObjectKind: "post",
			ObjectID: "201", ActorPTID: "ptid:test:alice", LocalID: 902, Sequence: 1}).Error; err != nil {
			return err
		}
		if err := tx.Create(&db.SocialPublicPost{ID: 902, AuthorID: 1}).Error; err != nil {
			return err
		}
		for _, event := range batch.Events {
			if _, err := projector.StoreInteraction(bound, tx, &model.FeedInteraction{
				Genesis: bundle.Genesis, WriterGrant: bundle.WriterGrant, Event: event}, "station-b", true); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var receipt FeedInteractionRecord
	if err := database.Where("sequence = 2").Take(&receipt).Error; err != nil || receipt.Projected {
		t.Fatalf("late parent was not deferred: %+v %v", receipt, err)
	}
	var head FeedThreadHead
	if err := database.Take(&head).Error; err != nil || head.Cursor != 1 {
		t.Fatalf("late parent advanced the thread: %+v %v", head, err)
	}
	event := batch.Events[1]
	if err := store.Transaction(ctx, func(tx *gorm.DB) error {
		_, err := projector.StoreInteraction(ctx, tx, &model.FeedInteraction{
			Genesis: bundle.Genesis, WriterGrant: bundle.WriterGrant, Event: event}, "station-b", true)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := database.Where("sequence = 2").Take(&receipt).Error; err != nil || !receipt.Projected {
		t.Fatalf("next transaction did not project deferred receipt: %+v %v", receipt, err)
	}
}

func TestFeedInteractionLockSnapshotRejectsDifferentTransaction(t *testing.T) {
	store, database, bundle := interactionFixture(t)
	projector := NewFeedProjector("station-a")
	batch := interactionBatch(t, bundle, "oss://station-a/post/101")
	if err := store.Transaction(context.Background(), func(tx *gorm.DB) error {
		bound, err := projector.LockInteractions(context.Background(), tx, batch.Events)
		if err != nil {
			return err
		}
		_, err = feedProjectionLocksFromContext(bound, database)
		if !errors.Is(err, domain.ErrFeedInvalid) {
			t.Fatalf("lock snapshot escaped its SQL transaction: %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestFeedAppendNewParentStaysDeferredThroughRepeatedAuthoredUpdates(t *testing.T) {
	store, database, bundle, root := feedStoreFixture(t)
	if err := database.AutoMigrate(&db.Actor{}, &db.SocialPublicPost{}, &db.SocialReaction{}); err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&db.Actor{ID: 1, PTID: "ptid:test:alice",
		PreferredUsername: "alice", Email: "alice@example.test"}).Error; err != nil {
		t.Fatal(err)
	}
	batch := proto.Clone(bundle).(*model.FeedBundle)
	request, err := signedlog.Canonical(&model.CreatePostRequest{
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  &model.CreatePostRequest_Text{Text: &model.CreateTextPostRequest{Text: "signed text"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	batch.Events[0].Statement.Kind = model.FeedEventKind_FEED_EVENT_KIND_POST_CREATED
	batch.Events[0].Payload, err = signedlog.Canonical(&model.FeedPayload{Mutation: &model.FeedPayload_Post{
		Post: &model.FeedPostMutation{PostId: "101", CreateRequest: request},
	}})
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(batch.Events[0].Payload)
	batch.Events[0].Statement.PayloadHash = digest[:]
	signStoreEvent(t, batch.Events[0])
	target := "oss://station-a/post/101"
	for sequence := uint64(2); sequence <= 3; sequence++ {
		update := proto.Clone(batch.Events[0]).(*model.FeedEvent)
		update.Statement.Sequence, update.Statement.Kind = sequence, model.FeedEventKind_FEED_EVENT_KIND_POST_UPDATED
		update.Statement.CreatedAtUnixMs += int64(sequence)
		var err error
		update.Statement.PreviousHash, err = domain.FeedEventHash(batch.Events[len(batch.Events)-1])
		if err != nil {
			t.Fatal(err)
		}
		signStoreEvent(t, update)
		batch.Events = append(batch.Events, update)
	}
	reaction := makeInteraction(t, bundle, 4, model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET,
		&model.FeedPayload{Mutation: &model.FeedPayload_Reaction{
			Reaction: &model.FeedReactionMutation{TargetPostRef: target, ReactionKind: 1}}})
	reaction.Event.Statement.PreviousHash, _ = domain.FeedEventHash(batch.Events[2])
	signStoreEvent(t, reaction.Event)
	batch.Events = append(batch.Events, reaction.Event)
	projector := NewFeedProjector("station-a")
	ctx := context.Background()
	if err := store.Transaction(ctx, func(tx *gorm.DB) error {
		_, _, err := store.AppendTx(ctx, tx, batch, "ptid:test:alice", "station-a", root, projector.Apply, false)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	var post db.SocialPublicPost
	if err := database.Take(&post).Error; err != nil ||
		post.UpdatedAt.UnixMilli() != batch.Events[2].Statement.CreatedAtUnixMs {
		t.Fatalf("repeated authored updates were lost: %+v %v", post, err)
	}
	var row FeedInteractionRecord
	if err := database.Take(&row).Error; err != nil || row.Projected {
		t.Fatalf("same-batch parent joined the frozen interaction snapshot: %+v %v", row, err)
	}
	var heads int64
	if err := database.Model(&FeedThreadHead{}).Count(&heads).Error; err != nil || heads != 0 {
		t.Fatalf("deferred same-batch parent acquired a thread head: %d %v", heads, err)
	}
	if err := store.Transaction(ctx, func(tx *gorm.DB) error {
		_, err := projector.StoreInteraction(ctx, tx, reaction, "station-a", true)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := database.Take(&row).Error; err != nil || !row.Projected {
		t.Fatalf("later transaction did not project the new parent receipt: %+v %v", row, err)
	}
}

// SQLite tests above verify the production lock boundary, not SQL deadlocks.
// This isolated PostgreSQL case checks an overlapping singleton transaction.
func TestFeedInteractionBatchConcurrentSinglePostgres(t *testing.T) {
	database, _ := openPrivateContentStorePostgres(t)
	_, _, bundle, _ := feedStoreFixture(t)
	store, err := NewFeedLogStore(database)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(&db.Actor{}, &db.SocialPublicPost{}, &db.SocialReaction{}); err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&db.Actor{ID: 1, PTID: "ptid:test:alice",
		PreferredUsername: "alice", Email: "alice@example.test"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, object := range []FeedObjectRecord{
		{HomeStation: "station-a", ObjectKind: "post", ObjectID: "101", ActorPTID: "ptid:test:alice", LocalID: 901, Sequence: 1},
		{HomeStation: "station-a", ObjectKind: "post", ObjectID: "201", ActorPTID: "ptid:test:alice", LocalID: 902, Sequence: 1},
	} {
		if err := database.Create(&object).Error; err != nil {
			t.Fatal(err)
		}
		if err := database.Create(&db.SocialPublicPost{ID: object.LocalID, AuthorID: 1}).Error; err != nil {
			t.Fatal(err)
		}
	}
	batch := interactionBatch(t, bundle, "oss://station-a/post/101", "oss://station-a/post/201")
	single := makeInteraction(t, bundle, 9, model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET,
		&model.FeedPayload{Mutation: &model.FeedPayload_Reaction{
			Reaction: &model.FeedReactionMutation{TargetPostRef: "oss://station-a/post/201", ReactionKind: 1}}})
	firstProjected, resume := make(chan struct{}), make(chan struct{})
	projector := NewFeedProjector("station-a")
	projector.SetObserver(func(ctx context.Context, _ *gorm.DB, event *model.FeedEvent, _ uint64, _ string) error {
		if event.Statement.Sequence != 1 {
			return nil
		}
		close(firstProjected)
		select {
		case <-resume:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	})
	batchDone := make(chan error, 1)
	go func() {
		batchDone <- store.Transaction(ctx, func(tx *gorm.DB) error {
			_, _, err := store.AppendTx(ctx, tx, batch, "ptid:test:alice", "station-b",
				bundle.Genesis.Statement.ActorIdentityPublicKey, projector.Apply, false)
			return err
		})
	}()
	select {
	case <-firstProjected:
	case err := <-batchDone:
		t.Fatalf("batch did not reach first projection: %v", err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	// NOWAIT proves the second parent is held at the first projection boundary.
	// Without batch locking this succeeds, enabling the confirmed wait cycle.
	probeErr := store.Transaction(ctx, func(tx *gorm.DB) error {
		var post db.SocialPublicPost
		return tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "NOWAIT"}).
			Where("id = ?", 902).Take(&post).Error
	})
	singleDone := make(chan error, 1)
	singleStarted := make(chan struct{})
	go func() {
		singleDone <- store.Transaction(ctx, func(tx *gorm.DB) error {
			close(singleStarted)
			_, err := NewFeedProjector("station-a").StoreInteraction(ctx, tx, single, "station-b", true)
			return err
		})
	}()
	select {
	case <-singleStarted:
	case <-ctx.Done():
		cancel()
		close(resume)
		<-batchDone
		<-singleDone
		t.Fatal(ctx.Err())
	}
	close(resume)
	if err := <-batchDone; err != nil {
		t.Fatal(err)
	}
	if err := <-singleDone; err != nil {
		t.Fatal(err)
	}
	var lockError interface{ SQLState() string }
	if !errors.As(probeErr, &lockError) || lockError.SQLState() != "55P03" {
		t.Fatalf("second batch parent was not proven locked before first thread/receipt: %v", probeErr)
	}
	var receipts int64
	if err := database.Model(&FeedInteractionRecord{}).Where("projected = ?", true).Count(&receipts).Error; err != nil || receipts != 3 {
		t.Fatalf("concurrent receipts did not commit: %d %v", receipts, err)
	}
}
