package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

func TestFeedReadRejectsTamperedStoredEventAndHead(t *testing.T) {
	for _, field := range []string{"event", "event_hash", "head_hash"} {
		t.Run(field, func(t *testing.T) {
			store, database, bundle, root := feedStoreFixture(t)
			ctx := context.Background()
			if err := store.Transaction(ctx, func(tx *gorm.DB) error {
				_, _, err := store.AppendTx(ctx, tx, bundle, "ptid:test:alice", "station-a",
					root, func(context.Context, *gorm.DB, *model.FeedEvent) error { return nil }, false)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			target := database.Model(&FeedEventRecord{})
			if field == "head_hash" {
				target = database.Model(&FeedChainRecord{})
			}
			if err := target.Where("actor_ptid = ?", "ptid:test:alice").
				Update(field, bytes.Repeat([]byte{0}, 32)).Error; err != nil {
				t.Fatal(err)
			}
			if _, err := store.Read(ctx, database, &model.ReadFeedRequest{
				ActorPtid: "ptid:test:alice", ChainId: domain.PublicFeedChainID,
			}); err == nil {
				t.Fatal("tampered persisted material was served")
			}
		})
	}
}

func TestFeedPostProjectionPreservesSignedTimeAndBlocksResurrection(t *testing.T) {
	store, database, bundle, root := feedStoreFixture(t)
	ctx := context.Background()
	if err := database.AutoMigrate(&db.Actor{}, &db.SocialPublicPost{}); err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&db.Actor{ID: 1, PTID: "ptid:test:alice",
		PreferredUsername: "alice", Email: "alice@example.test"}).Error; err != nil {
		t.Fatal(err)
	}
	request, err := signedlog.Canonical(&model.CreatePostRequest{
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  &model.CreatePostRequest_Text{Text: &model.CreateTextPostRequest{Text: "signed text"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := signedlog.Canonical(&model.FeedPayload{Mutation: &model.FeedPayload_Post{
		Post: &model.FeedPostMutation{PostId: "101", CreateRequest: request},
	}})
	if err != nil {
		t.Fatal(err)
	}
	event := bundle.Events[0]
	event.Statement.Kind = model.FeedEventKind_FEED_EVENT_KIND_POST_CREATED
	event.Payload = payload
	digest := sha256.Sum256(payload)
	event.Statement.PayloadHash = digest[:]
	signStoreEvent(t, event)
	projector := NewFeedProjector("station-a")
	appendEvent := func() error {
		return store.Transaction(ctx, func(tx *gorm.DB) error {
			_, _, err := store.AppendTx(ctx, tx, bundle, "ptid:test:alice", "station-a", root, projector.Apply, true)
			return err
		})
	}
	if err := appendEvent(); err != nil {
		t.Fatal(err)
	}
	var row db.SocialPublicPost
	if err := database.First(&row, "id = ?", 101).Error; err != nil {
		t.Fatal(err)
	}
	if row.TextBody != "signed text" || row.CreatedAt.UnixMilli() != event.Statement.CreatedAtUnixMs {
		t.Fatal("projection changed signed body or creation time", row)
	}
	previous, _ := domain.FeedEventHash(event)
	event.Statement.Sequence = 2
	event.Statement.PreviousHash = previous
	event.Statement.Kind = model.FeedEventKind_FEED_EVENT_KIND_POST_TOMBSTONED
	event.Payload, err = signedlog.Canonical(&model.FeedPayload{Mutation: &model.FeedPayload_Post{
		Post: &model.FeedPostMutation{PostId: "101"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	digest = sha256.Sum256(event.Payload)
	event.Statement.PayloadHash = digest[:]
	signStoreEvent(t, event)
	if err := appendEvent(); err != nil {
		t.Fatal(err)
	}
	previous, _ = domain.FeedEventHash(event)
	event.Statement.Sequence = 3
	event.Statement.PreviousHash = previous
	event.Statement.Kind = model.FeedEventKind_FEED_EVENT_KIND_POST_UPDATED
	event.Payload = payload
	digest = sha256.Sum256(payload)
	event.Statement.PayloadHash = digest[:]
	signStoreEvent(t, event)
	if err := appendEvent(); !errors.Is(err, domain.ErrFeedInvalid) {
		t.Fatal("resurrected tombstone", err)
	}
	response, err := store.Read(ctx, database, &model.ReadFeedRequest{ActorPtid: "ptid:test:alice", ChainId: domain.PublicFeedChainID})
	if err != nil || response.Head.Sequence != 2 {
		t.Fatal(response, err)
	}
}
