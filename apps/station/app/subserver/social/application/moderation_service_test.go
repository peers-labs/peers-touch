package application

import (
	"context"
	"testing"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestModerationServiceUpsertStationBlock(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open("file:moderation_service?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.AutoMigrate(&db.Actor{}, &db.SocialStationModerationPolicy{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	bindApplicationActorStore(t, gdb)
	seedFixtureActors(t, gdb)
	repos := &infrastructure.Repos{
		Moderation: infrastructure.NewStationModerationRepository(gdb),
	}
	svc := NewModerationService(repos)

	got, err := svc.UpsertStationPolicy(context.Background(), &model.UpsertStationModerationPolicyRequest{
		Policy: &model.StationModerationPolicy{
			StationDomain: "station-b.example",
			Kind:          model.StationModerationPolicy_STATION_MODERATION_POLICY_BLOCK,
			Reason:        "spam wave",
		},
	}, fixturePTID(100))
	if err != nil {
		t.Fatalf("upsert station policy: %v", err)
	}
	if got.GetStationDomain() != "station-b.example" {
		t.Fatalf("station domain mismatch: %q", got.GetStationDomain())
	}
	if got.GetKind() != model.StationModerationPolicy_STATION_MODERATION_POLICY_BLOCK {
		t.Fatalf("unexpected policy kind: %v", got.GetKind())
	}

	blocked, err := repos.Moderation.ListBlockedStations(context.Background())
	if err != nil {
		t.Fatalf("list blocked stations: %v", err)
	}
	if blocked["station-b.example"] == nil {
		t.Fatal("station-b.example should be blocked")
	}
}

func TestModerationRepositoryBlocksPeerOnlyPolicy(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open("file:moderation_peer_policy?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.AutoMigrate(&db.SocialStationModerationPolicy{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	repo := infrastructure.NewStationModerationRepository(gdb)

	if err := repo.Upsert(context.Background(), &domain.StationModerationPolicy{
		StationPeerID: "peer-b",
		Kind:          domain.StationModerationPolicyKindBlock,
	}); err != nil {
		t.Fatalf("upsert peer-only policy: %v", err)
	}
	if err := repo.Upsert(context.Background(), &domain.StationModerationPolicy{
		StationPeerID: "peer-c",
		Kind:          domain.StationModerationPolicyKindBlock,
	}); err != nil {
		t.Fatalf("upsert second peer-only policy: %v", err)
	}

	blocked, err := repo.IsBlockedStation(context.Background(), "", "peer-b")
	if err != nil {
		t.Fatalf("check blocked peer: %v", err)
	}
	if !blocked {
		t.Fatal("peer-b should be blocked")
	}
}

func TestFilterStationBlockedFeedPosts(t *testing.T) {
	posts := []*model.Post{
		{
			Id: "p1",
			Author: &model.PostAuthor{
				HomeStationDomain: "station-a.example",
			},
		},
		{
			Id: "p2",
			Author: &model.PostAuthor{
				HomeStationDomain: "station-b.example",
			},
		},
	}
	filtered := filterStationBlockedFeedPosts(posts, map[string]*domain.StationModerationPolicy{
		"station-b.example": {StationDomain: "station-b.example", Kind: domain.StationModerationPolicyKindBlock},
	})
	if len(filtered) != 1 {
		t.Fatalf("expected one visible post, got %d", len(filtered))
	}
	if filtered[0].GetId() != "p1" {
		t.Fatalf("expected p1 to remain, got %q", filtered[0].GetId())
	}
}
