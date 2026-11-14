package infrastructure

import (
	"context"
	"crypto/sha256"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

func TestFeedPollProjectionRetainsCreationAndRollsBackDefinitionChanges(t *testing.T) {
	store, database, bundle, root := feedStoreFixture(t)
	ctx := context.Background()
	if err := database.AutoMigrate(&db.Actor{}, &db.SocialPublicPost{}); err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&db.Actor{ID: 1, PTID: "ptid:test:alice",
		PreferredUsername: "alice", Email: "alice@example.test"}).Error; err != nil {
		t.Fatal(err)
	}
	request := &model.CreatePostRequest{Type: model.PostType_POLL, Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content: &model.CreatePostRequest_Poll{Poll: &model.CreatePollPostRequest{
			Text: "Original", Question: "Which route?", Options: []string{"Direct", "Relay"}, DurationHours: 1,
		}}}
	projector := NewFeedProjector("station-a")
	event := proto.Clone(bundle.Events[0]).(*model.FeedEvent)
	supply := func(event *model.FeedEvent, request *model.CreatePostRequest) {
		t.Helper()
		wire, err := signedlog.Canonical(request)
		if err != nil {
			t.Fatal(err)
		}
		event.Payload, err = signedlog.Canonical(&model.FeedPayload{Mutation: &model.FeedPayload_Post{
			Post: &model.FeedPostMutation{PostId: "101", CreateRequest: wire},
		}})
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(event.Payload)
		event.Statement.PayloadHash = digest[:]
		signStoreEvent(t, event)
	}
	appendEvent := func(event *model.FeedEvent) error {
		bundle.Events = []*model.FeedEvent{event}
		return store.Transaction(ctx, func(tx *gorm.DB) error {
			_, _, err := store.AppendTx(ctx, tx, bundle, "ptid:test:alice", "station-a", root, projector.Apply, true)
			return err
		})
	}
	event.Statement.Kind = model.FeedEventKind_FEED_EVENT_KIND_POST_CREATED
	supply(event, request)
	if err := appendEvent(event); err != nil {
		t.Fatal(err)
	}
	var object FeedObjectRecord
	if err := database.Take(&object).Error; err != nil {
		t.Fatal(err)
	}
	if object.CreatedSequence != 1 {
		t.Fatal("creation sequence not retained")
	}
	updated := proto.Clone(request).(*model.CreatePostRequest)
	updated.GetPoll().Text = "Edited after closure"
	edit := proto.Clone(event).(*model.FeedEvent)
	edit.Statement.Kind = model.FeedEventKind_FEED_EVENT_KIND_POST_UPDATED
	edit.Statement.Sequence = 2
	edit.Statement.PreviousHash, _ = domain.FeedEventHash(event)
	edit.Statement.CreatedAtUnixMs += 3_600_001
	supply(edit, updated)
	if err := appendEvent(edit); err != nil {
		t.Fatal("body edit after closure rejected", err)
	}
	var post db.SocialPublicPost
	if err := database.Take(&post).Error; err != nil {
		t.Fatal(err)
	}
	if post.TextBody != updated.GetPoll().Text || post.CreatedAt.UnixMilli() != event.Statement.CreatedAtUnixMs {
		t.Fatal("edit changed original creation")
	}
	// Populated pre-index rows are repaired from signed creation, never the edit.
	object.CreatedSequence = 0
	if err := database.Model(&object).Update("created_sequence", 0).Error; err != nil {
		t.Fatal(err)
	}
	original, created, err := OriginalFeedPostRequest(ctx, database, &object)
	if err != nil || original.GetPoll().Text != "Original" || created != event.Statement.CreatedAtUnixMs ||
		object.CreatedSequence != 1 {
		t.Fatal(original, created, object.CreatedSequence, err)
	}
	object.CreatedSequence = 3
	if _, _, err := OriginalFeedPostRequest(ctx, database, &object); err == nil {
		t.Fatal("creation beyond verified head accepted")
	}
	for _, mutate := range []func(*model.CreatePostRequest){
		func(r *model.CreatePostRequest) { r.GetPoll().Options[0] = "Changed" },
		func(r *model.CreatePostRequest) { r.GetPoll().DurationHours = 2 },
		func(r *model.CreatePostRequest) {
			r.Content = &model.CreatePostRequest_Text{Text: &model.CreateTextPostRequest{Text: "Replacement"}}
			r.Type = model.PostType_TEXT
		},
	} {
		changed := proto.Clone(updated).(*model.CreatePostRequest)
		mutate(changed)
		rejected := proto.Clone(edit).(*model.FeedEvent)
		rejected.Statement.Sequence = 3
		rejected.Statement.PreviousHash, _ = domain.FeedEventHash(edit)
		rejected.Statement.CreatedAtUnixMs++
		supply(rejected, changed)
		if err := appendEvent(rejected); err == nil {
			t.Fatal("definition replacement committed")
		}
		var chain FeedChainRecord
		if err := database.Take(&chain).Error; err != nil || chain.Sequence != 2 {
			t.Fatal("failed edit advanced head", chain.Sequence, err)
		}
		var events int64
		if err := database.Model(&FeedEventRecord{}).Count(&events).Error; err != nil || events != 2 {
			t.Fatal("failed edit left signed rows", events, err)
		}
	}
}
