package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federation "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type feedIdentityFixture struct {
	home  string
	homes map[string]string
	root  []byte
	key   *model.VerifiedActorDeviceSigningKey
}

func (i *feedIdentityFixture) ResolveActorHomeStationPeerID(_ context.Context, actor string) (string, error) {
	if home, ok := i.homes[actor]; ok {
		return home, nil
	}
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

func TestFeedFederatedReadBindsRequesterHomeAndCanonicalIntent(t *testing.T) {
	s, database, identity, request := feedServiceFixture(t)
	ctx := context.Background()
	if _, err := s.Submit(ctx, identity.key.ActorPtid, identity.key.ActorDeviceId, request); err != nil {
		t.Fatal(err)
	}
	identity.homes = map[string]string{"viewer": "station-b"}
	if err := database.Create(&infrastructure.FeedSubscriptionRecord{
		AuthorPTID: identity.key.ActorPtid, ChainID: domain.PublicFeedChainID,
		SubscriberPTID: "viewer", SubscriberStation: "station-b",
		AuthorStation: "station-a", Enabled: true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	read := &model.ReadFeedRequest{ActorPtid: identity.key.ActorPtid, ChainId: domain.PublicFeedChainID, Limit: 32}
	wire, err := signedlog.Canonical(read)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(wire)
	claims := &authfed.VerifiedClaims{
		Issuer: "station-b", Subject: "viewer", Audience: "station-a",
		Scope: federation.SocialPublicFeedReadScope,
		Custom: map[string]string{
			federation.ClaimSourceStationPeerID:    "station-a",
			federation.ClaimTargetStationPeerID:    "station-b",
			federation.ClaimActorPTID:              "viewer",
			federation.ClaimFeedAuthorPTID:         read.ActorPtid,
			federation.ClaimFeedChainID:            read.ChainId,
			federation.ClaimCanonicalRequestSHA256: hex.EncodeToString(hash[:]),
		},
	}
	if _, err := s.ReadFederated(ctx, claims, read, wire); err != nil {
		t.Fatalf("valid retained subscriber rejected: %v", err)
	}
	identity.homes["viewer"] = "station-c"
	if _, err := s.ReadFederated(ctx, claims, read, wire); !errors.Is(err, domain.ErrFeedWriter) {
		t.Fatalf("Station could impersonate another Home's viewer: %v", err)
	}
	identity.homes["viewer"] = "station-b"
	read.ExplicitPublicRead = true
	changed, _ := signedlog.Canonical(read)
	if _, err := s.ReadFederated(ctx, claims, read, changed); !errors.Is(err, domain.ErrFeedWriter) {
		t.Fatalf("signed subscription request upgraded to explicit read: %v", err)
	}
}

func TestFeedExplicitReadRetainsBoundedPrefixAndRechecksExposure(t *testing.T) {
	for _, scenario := range []string{"continuation", "offline-after-import", "block-during-pull"} {
		t.Run(scenario, func(t *testing.T) {
			s, database, identity, submit := feedServiceFixture(t)
			ctx := context.Background()
			author, viewer := identity.key.ActorPtid, "viewer"
			if err := database.AutoMigrate(&db.Actor{}, &db.SocialStationModerationPolicy{}); err != nil {
				t.Fatal(err)
			}
			if err := infrastructure.MigrateIdentitySchema(database); err != nil {
				t.Fatal(err)
			}
			for index, ptid := range []string{author, viewer} {
				name := []string{"feed-author", "feed-viewer"}[index]
				if err := database.Create(&db.Actor{ID: uint64(index + 1), PTID: ptid,
					Namespace: "peers", PreferredUsername: name, Email: name + "@example.test",
					FederatedHandle: "@" + name + "@example.test",
					PasswordHash:    "test-only"}).Error; err != nil {
					t.Fatal(err)
				}
			}
			s.localStation = "station-b"
			identity.homes = map[string]string{author: "station-a", viewer: "station-b"}
			event := submit.Bundle.Events[len(submit.Bundle.Events)-1]
			hash, err := domain.FeedEventHash(event)
			if err != nil {
				t.Fatal(err)
			}
			source := &model.ReadFeedResponse{
				Bundle: proto.Clone(submit.Bundle).(*model.FeedBundle),
				Head: &model.FeedHead{ActorPtid: author, ChainId: domain.PublicFeedChainID,
					Sequence: event.Statement.Sequence, EventHash: hash},
			}
			if scenario == "continuation" {
				source.Head.Sequence++
				source.Head.EventHash = bytes.Repeat([]byte{7}, 32)
				source.HasMore = true
				source.ThreadHasMore = true
			}
			calls := 0
			offline := errors.New("source offline")
			s.pull = func(_ context.Context, home, subject string, request *model.ReadFeedRequest) (*model.ReadFeedResponse, error) {
				calls++
				if home != "station-a" || subject != viewer || !request.ExplicitPublicRead ||
					request.Limit != 32 || !request.IncludeThread || request.AfterThreadCursor != 0 {
					t.Fatalf("foreground read lost its authenticated bounded binding: %+v", request)
				}
				if calls == 1 && request.AfterSequence != 0 {
					t.Fatal("pull did not start at the replica checkpoint")
				}
				if calls > 1 {
					if request.AfterSequence != event.Statement.Sequence {
						t.Fatal("pull did not resume the verified prefix")
					}
					return nil, offline
				}
				if scenario == "block-during-pull" {
					if err := database.Exec(
						"INSERT INTO social_directional_relationships "+
							"(actor_ptid, target_actor_ptid, actor_home_station_peer_id, "+
							"target_home_station_peer_id, blocked, revision, updated_at) "+
							"VALUES (?, ?, '', '', ?, ?, CURRENT_TIMESTAMP)",
						author, viewer, true, 1,
					).Error; err != nil {
						t.Fatal(err)
					}
				}
				return proto.Clone(source).(*model.ReadFeedResponse), nil
			}
			read := &model.ReadFeedRequest{ActorPtid: author, ChainId: domain.PublicFeedChainID,
				Limit: 64, IncludeThread: true}
			response, err := s.ReadForViewer(ctx, viewer, read)
			if scenario == "block-during-pull" {
				if !errors.Is(err, domain.ErrFeedWriter) || response != nil {
					t.Fatalf("read exposed bytes after block: %v %v", response, err)
				}
				return
			}
			if err != nil || response == nil {
				t.Fatalf("explicit non-follower read failed: %v", err)
			}
			var subscriptions int64
			if err := database.Model(&infrastructure.FeedSubscriptionRecord{}).Count(&subscriptions).Error; err != nil ||
				subscriptions != 0 || calls != 1 {
				t.Fatalf("foreground read acquired a subscription or repeated its pull: %d %d %v",
					subscriptions, calls, err)
			}
			if scenario == "continuation" {
				if !proto.Equal(response.Head, source.Head) || !response.HasMore || !response.ThreadHasMore {
					t.Fatal("partial replica concealed the advertised continuation")
				}
				sequence, err := s.store.LocalSequence(ctx, author)
				if err != nil || sequence != event.Statement.Sequence {
					t.Fatalf("unverified advertised tail became a retained head: %d %v", sequence, err)
				}
				return
			}
			response, err = s.ReadForViewer(ctx, viewer, read)
			if !errors.Is(err, offline) || response != nil {
				t.Fatalf("offline foreground read downgraded to cached success: %v %v", response, err)
			}
		})
	}
}
