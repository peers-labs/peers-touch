package infrastructure

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func feedStoreFixture(t *testing.T) (*FeedLogStore, *gorm.DB, *model.FeedBundle, []byte) {
	t.Helper()
	wire, err := os.ReadFile("../../../../../../model/domain/social/testdata/feed_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		Root   string `json:"root_public_key"`
		Bundle string `json:"bundle"`
	}
	if err := json.Unmarshal(wire, &vector); err != nil {
		t.Fatal(err)
	}
	root, err := hex.DecodeString(vector.Root)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := hex.DecodeString(vector.Bundle)
	if err != nil {
		t.Fatal(err)
	}
	bundle := &model.FeedBundle{}
	if err := signedlog.Decode(encoded, bundle); err != nil {
		t.Fatal(err)
	}
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	store, err := NewFeedLogStore(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	return store, database, bundle, root
}

func signStoreEvent(t *testing.T, event *model.FeedEvent) {
	t.Helper()
	input, err := signedlog.SigningBytes(domain.FeedEventDomain, event.Statement)
	if err != nil {
		t.Fatal(err)
	}
	event.DeviceSignature = ed25519.Sign(ed25519.NewKeyFromSeed(bytes.Repeat([]byte{2}, 32)), input)
}

func TestFeedStoreAppendReplayAndTransactionalFailure(t *testing.T) {
	store, database, bundle, root := feedStoreFixture(t)
	ctx := context.Background()
	applied := 0
	apply := func(context.Context, *gorm.DB, *model.FeedEvent) error { applied++; return nil }
	var duplicate bool
	err := store.Transaction(ctx, func(tx *gorm.DB) error {
		_, duplicate, err := store.AppendTx(ctx, tx, bundle, "ptid:test:alice", "station-a", root, apply, true)
		if duplicate {
			t.Fatal("first append marked duplicate")
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	err = store.Transaction(ctx, func(tx *gorm.DB) error {
		var err error
		_, duplicate, err = store.AppendTx(ctx, tx, bundle, "ptid:test:alice", "station-a", root, apply, true)
		return err
	})
	if err != nil || !duplicate || applied != 1 {
		t.Fatal(err, duplicate, applied)
	}
	failed := proto.Clone(bundle).(*model.FeedBundle)
	firstHash, err := domain.FeedEventHash(bundle.Events[0])
	if err != nil {
		t.Fatal(err)
	}
	failed.Events[0].Statement.Sequence = 2
	failed.Events[0].Statement.PreviousHash = firstHash
	signStoreEvent(t, failed.Events[0])
	injected := errors.New("projection rejected")
	err = store.Transaction(ctx, func(tx *gorm.DB) error {
		_, _, err := store.AppendTx(ctx, tx, failed, "ptid:test:alice", "station-a", root,
			func(context.Context, *gorm.DB, *model.FeedEvent) error { return injected }, true)
		return err
	})
	if !errors.Is(err, injected) {
		t.Fatal(err)
	}
	var count int64
	if err := database.Model(&FeedEventRecord{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatal(count, err)
	}
	if err := database.Model(&FeedFanoutRecord{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatal(count, err)
	}
	response, err := store.Read(ctx, database, &model.ReadFeedRequest{ActorPtid: "ptid:test:alice", ChainId: domain.PublicFeedChainID, Limit: 1})
	if err != nil || response.Head.Sequence != 1 || len(response.Bundle.Events) != 1 {
		t.Fatal(response, err)
	}
}

func TestFeedStoreTailForkDoesNotCommitEarlierProjection(t *testing.T) {
	store, database, bundle, root := feedStoreFixture(t)
	ctx := context.Background()
	apply := func(context.Context, *gorm.DB, *model.FeedEvent) error { return nil }
	if err := store.Transaction(ctx, func(tx *gorm.DB) error {
		_, _, err := store.AppendTx(ctx, tx, bundle, "ptid:test:alice", "station-a", root, apply, true)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	next := proto.Clone(bundle.Events[0]).(*model.FeedEvent)
	next.Statement.Sequence = 2
	next.Statement.PreviousHash, _ = domain.FeedEventHash(bundle.Events[0])
	signStoreEvent(t, next)
	fork := proto.Clone(next).(*model.FeedEvent)
	fork.Statement.Sequence = 3
	fork.Statement.PreviousHash = bytes.Repeat([]byte{0}, 32)
	signStoreEvent(t, fork)
	batch := proto.Clone(bundle).(*model.FeedBundle)
	batch.Events = []*model.FeedEvent{next, fork}
	called := false
	var rejection error
	if err := store.Transaction(ctx, func(tx *gorm.DB) error {
		_, _, rejection = store.AppendTx(ctx, tx, batch, "ptid:test:alice", "station-a", root,
			func(context.Context, *gorm.DB, *model.FeedEvent) error { called = true; return nil }, true)
		if errors.Is(rejection, domain.ErrFeedFork) {
			return nil
		}
		return rejection
	}); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(rejection, domain.ErrFeedFork) || called {
		t.Fatal(rejection, called)
	}
	var chain FeedChainRecord
	if err := database.Take(&chain).Error; err != nil || !chain.Forked || chain.Sequence != 1 {
		t.Fatal(chain, err)
	}
	var count int64
	if err := database.Model(&FeedEventRecord{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatal(count, err)
	}
}

func TestFeedStoreAuthorPrefixCannotReplaceIndependentReceipt(t *testing.T) {
	store, database, bundle, root := feedStoreFixture(t)
	event := proto.Clone(bundle.Events[0]).(*model.FeedEvent)
	event.Statement.CreatedAtUnixMs++
	signStoreEvent(t, event)
	receipt := &model.FeedInteraction{Genesis: bundle.Genesis, WriterGrant: bundle.WriterGrant, Event: event}
	wire, err := signedlog.Canonical(receipt)
	if err != nil {
		t.Fatal(err)
	}
	hash, _ := domain.FeedEventHash(event)
	if err := database.Create(&FeedInteractionRecord{ActorPTID: event.Statement.ActorPtid,
		ChainID: event.Statement.ChainId, Sequence: event.Statement.Sequence,
		EventHash: hash, Interaction: wire, HomeStation: "station-a", TargetStation: "station-b"}).Error; err != nil {
		t.Fatal(err)
	}
	var rejection error
	called := false
	if err := store.Transaction(context.Background(), func(tx *gorm.DB) error {
		_, _, rejection = store.AppendTx(context.Background(), tx, bundle, "ptid:test:alice", "station-a", root,
			func(context.Context, *gorm.DB, *model.FeedEvent) error { called = true; return nil }, false)
		if errors.Is(rejection, domain.ErrFeedFork) {
			return nil
		}
		return rejection
	}); err != nil {
		t.Fatal(err)
	}
	var chain FeedChainRecord
	if err := database.Take(&chain).Error; err != nil || !chain.Forked || chain.Sequence != 0 || called ||
		!errors.Is(rejection, domain.ErrFeedFork) {
		t.Fatalf("receipt conflict not quarantined before projection: %+v %v %v", chain, rejection, err)
	}
}
