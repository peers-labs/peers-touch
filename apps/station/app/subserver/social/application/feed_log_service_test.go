package application

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type feedIdentityFixture struct {
	home string
	root []byte
	key  *model.VerifiedActorDeviceSigningKey
}

func (i *feedIdentityFixture) ResolveActorHomeStationPeerID(context.Context, string) (string, error) {
	return i.home, nil
}
func (i *feedIdentityFixture) ResolveRetainedActorIdentityPublicKey(context.Context, delivery.Transaction, string) ([]byte, error) {
	return i.root, nil
}
func (i *feedIdentityFixture) ResolveVerifiedActorDeviceSigningKey(context.Context, delivery.Transaction, string, string, string, string) (*model.VerifiedActorDeviceSigningKey, error) {
	return i.key, nil
}

func feedServiceFixture(t *testing.T) (*FeedLogService, *gorm.DB, *feedIdentityFixture, *model.SubmitFeedEventRequest) {
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
	root, _ := hex.DecodeString(vector.Root)
	encoded, _ := hex.DecodeString(vector.Bundle)
	bundle := &model.FeedBundle{}
	if err := signedlog.Decode(encoded, bundle); err != nil {
		t.Fatal(err)
	}
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ := database.DB()
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = conn.Close() })
	store, err := infrastructure.NewFeedLogStore(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	w := bundle.WriterGrant.Statement
	identity := &feedIdentityFixture{home: "station-a", root: root,
		key: &model.VerifiedActorDeviceSigningKey{ActorPtid: w.ActorPtid, ActorDeviceId: w.DeviceId,
			HomeStationPeerId: "station-a", SigningKeyId: w.SigningKeyId, Ed25519PublicKey: w.DevicePublicKey,
			ValidFromUnixMs: 1, VerificationSource: model.ActorSigningKeyVerificationSource(1)}}
	service, err := NewFeedLogService(store, identity, "station-a",
		func(context.Context, *gorm.DB, *model.FeedEvent) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	return service, database, identity, &model.SubmitFeedEventRequest{Bundle: bundle}
}

func TestFeedServiceRejectsUntrustedIdentityBeforePersistence(t *testing.T) {
	for _, scenario := range []string{"wrong-device", "wrong-home", "wrong-root", "wrong-key", "unverified-key", "revoked-key", "before-enrollment"} {
		t.Run(scenario, func(t *testing.T) {
			s, database, identity, request := feedServiceFixture(t)
			device := identity.key.ActorDeviceId
			switch scenario {
			case "wrong-device":
				device = "other-device"
			case "wrong-home":
				identity.home = "station-b"
			case "wrong-root":
				identity.root = bytes.Repeat([]byte{9}, 32)
			case "wrong-key":
				identity.key.Ed25519PublicKey = bytes.Repeat([]byte{9}, 32)
			case "unverified-key":
				identity.key.VerificationSource = 0
			case "revoked-key":
				identity.key.RevokedAtUnixMs = request.Bundle.Events[0].Statement.CreatedAtUnixMs + 1
			case "before-enrollment":
				identity.key.ValidFromUnixMs = request.Bundle.Events[0].Statement.CreatedAtUnixMs + 1
			}
			if _, err := s.Submit(context.Background(), identity.key.ActorPtid, device, request); !errors.Is(err, domain.ErrFeedWriter) {
				t.Fatalf("expected authorization rejection: %v", err)
			}
			var count int64
			if err := database.Model(&infrastructure.FeedChainRecord{}).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("unauthorized request persisted state: %d %v", count, err)
			}
		})
	}
}

func TestFeedServiceExactRetryAndHistoricalRevocationBoundary(t *testing.T) {
	s, _, identity, request := feedServiceFixture(t)
	ctx := context.Background()
	response, err := s.Submit(ctx, identity.key.ActorPtid, identity.key.ActorDeviceId, request)
	if err != nil || response.Duplicate {
		t.Fatal(response, err)
	}
	response, err = s.Submit(ctx, identity.key.ActorPtid, identity.key.ActorDeviceId, request)
	if err != nil || !response.Duplicate {
		t.Fatal(response, err)
	}
	s.localStation = "station-b"
	identity.key.RevokedAtUnixMs = request.Bundle.Events[0].Statement.CreatedAtUnixMs + 1
	if err := s.Import(ctx, identity.key.ActorPtid, "station-a", request.Bundle); err != nil {
		t.Fatalf("historical valid signature rejected after revocation: %v", err)
	}
	identity.key.RevokedAtUnixMs--
	if err := s.Import(ctx, identity.key.ActorPtid, "station-a", request.Bundle); !errors.Is(err, domain.ErrFeedWriter) {
		t.Fatalf("signature at revocation boundary accepted: %v", err)
	}
}

func TestFeedServiceReadUsesRetainedRoot(t *testing.T) {
	s, _, identity, request := feedServiceFixture(t)
	if _, err := s.Submit(context.Background(), identity.key.ActorPtid, identity.key.ActorDeviceId, request); err != nil {
		t.Fatal(err)
	}
	read := &model.ReadFeedRequest{ActorPtid: identity.key.ActorPtid, ChainId: domain.PublicFeedChainID}
	before := proto.Clone(request.Bundle).(*model.FeedBundle)
	identity.root = bytes.Repeat([]byte{9}, 32)
	if _, err := s.Read(context.Background(), read); !errors.Is(err, domain.ErrFeedWriter) {
		t.Fatalf("read trusted Station-selected genesis root: %v", err)
	}
	if !proto.Equal(before, request.Bundle) {
		t.Fatal("caller bundle mutated")
	}
}
