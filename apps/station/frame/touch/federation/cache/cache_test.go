package cache

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	locatorpb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openCacheTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf(
		"file:federation_cache_%s?mode=memory&cache=shared",
		t.Name(),
	)
	rds, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := rds.AutoMigrate(&db.Actor{}); err != nil {
		t.Fatalf("migrate actor: %v", err)
	}
	return rds
}

func remoteProfile(
	handle string,
	ptid string,
	avatar string,
	displayName string,
	station string,
) UpsertInput {
	return UpsertInput{
		Envelope: &profilepb.ActorProfileEnvelope{
			FederatedHandle:   handle,
			HomeStationPeerId: station,
			HomeStationDomain: "remote.example",
			ExpiresAtUnixMs:   time.Now().Add(time.Hour).UnixMilli(),
			Profile: &modelpb.ActorProfile{
				DisplayName: displayName,
				Avatar:      avatar,
				PeersTouch: &modelpb.PeersTouchInfo{
					NetworkId: ptid,
				},
			},
		},
		Locator: &locatorpb.ActorLocatorRecord{
			FederatedHandle:   handle,
			HomeStationPeerId: station,
			HomeStationDomain: "remote.example",
			Seq:               2,
		},
		Now: time.Now(),
	}
}

func TestUpsertRefreshesHistoricalRemoteRowByPTID(t *testing.T) {
	rds := openCacheTestDB(t)
	historical := db.Actor{
		ID:                101,
		PTID:              "ptid:bob:remote",
		Namespace:         "peers",
		PreferredUsername: "bob@old.example",
		Name:              "Bob",
		Icon:              "data:image/svg+xml,stale",
		Email:             "remote+old-bob",
		PasswordHash:      "remote-cached",
		FederatedHandle:   "bob@old.example",
		HomeStationPeerID: "station-remote",
		HomeStationDomain: "old.example",
		Origin:            originRemoteCached,
		LocatorSeq:        1,
	}
	if err := rds.Create(&historical).Error; err != nil {
		t.Fatalf("seed historical row: %v", err)
	}

	input := remoteProfile(
		"@bob@remote.example",
		historical.PTID,
		"data:image/svg+xml,fresh",
		"Bob Remote",
		"station-remote",
	)
	if err := upsert(
		context.Background(),
		rds,
		"bob@remote.example",
		input,
		input.Now,
	); err != nil {
		t.Fatalf("refresh remote row: %v", err)
	}

	var actors []db.Actor
	if err := rds.Order("id").Find(&actors).Error; err != nil {
		t.Fatalf("list actors: %v", err)
	}
	if len(actors) != 1 {
		t.Fatalf("actor count = %d, want 1", len(actors))
	}
	refreshed := actors[0]
	if refreshed.ID != historical.ID {
		t.Fatalf("actor ID = %d, want %d", refreshed.ID, historical.ID)
	}
	if refreshed.FederatedHandle != "bob@remote.example" {
		t.Fatalf("federated handle = %q", refreshed.FederatedHandle)
	}
	if refreshed.Icon != "data:image/svg+xml,fresh" {
		t.Fatalf("avatar = %q", refreshed.Icon)
	}
	if refreshed.Name != "Bob Remote" {
		t.Fatalf("display name = %q", refreshed.Name)
	}
	if refreshed.HomeStationDomain != "remote.example" {
		t.Fatalf("home Station domain = %q", refreshed.HomeStationDomain)
	}
}

func TestUpsertKeepsSameNameActorsSeparatedByPTID(t *testing.T) {
	rds := openCacheTestDB(t)
	first := remoteProfile(
		"bob@station-a.example",
		"ptid:bob:a",
		"avatar-a",
		"Bob",
		"station-a",
	)
	second := remoteProfile(
		"bob@station-b.example",
		"ptid:bob:b",
		"avatar-b",
		"Bob",
		"station-b",
	)
	for _, input := range []UpsertInput{first, second} {
		if err := upsert(
			context.Background(),
			rds,
			input.Envelope.GetFederatedHandle(),
			input,
			input.Now,
		); err != nil {
			t.Fatalf("insert actor %s: %v", input.Envelope.GetFederatedHandle(), err)
		}
	}

	var actors []db.Actor
	if err := rds.Order("ptid").Find(&actors).Error; err != nil {
		t.Fatalf("list actors: %v", err)
	}
	if len(actors) != 2 {
		t.Fatalf("actor count = %d, want 2", len(actors))
	}
	if actors[0].PTID == actors[1].PTID ||
		actors[0].FederatedHandle == actors[1].FederatedHandle {
		t.Fatalf("same-name actors were merged: %+v", actors)
	}
}

func TestUpsertRejectsHandleAndPTIDOwnedByDifferentRows(t *testing.T) {
	rds := openCacheTestDB(t)
	for _, actor := range []db.Actor{
		{
			ID:                201,
			PTID:              "ptid:bob:a",
			Namespace:         "peers",
			PreferredUsername: "bob@station-a.example",
			Email:             "remote+bob-a",
			PasswordHash:      "remote-cached",
			FederatedHandle:   "bob@station-a.example",
			Origin:            originRemoteCached,
		},
		{
			ID:                202,
			PTID:              "ptid:bob:b",
			Namespace:         "peers",
			PreferredUsername: "bob@station-b.example",
			Email:             "remote+bob-b",
			PasswordHash:      "remote-cached",
			FederatedHandle:   "bob@station-b.example",
			Origin:            originRemoteCached,
		},
	} {
		if err := rds.Create(&actor).Error; err != nil {
			t.Fatalf("seed actor: %v", err)
		}
	}

	input := remoteProfile(
		"bob@station-a.example",
		"ptid:bob:b",
		"forged-avatar",
		"Bob",
		"station-a",
	)
	err := upsert(
		context.Background(),
		rds,
		input.Envelope.GetFederatedHandle(),
		input,
		input.Now,
	)
	if !errors.Is(err, ErrIdentityConflict) {
		t.Fatalf("error = %v, want ErrIdentityConflict", err)
	}
}

func TestUpsertRejectsLocalActorTakeover(t *testing.T) {
	rds := openCacheTestDB(t)
	local := db.Actor{
		ID:                301,
		PTID:              "ptid:bob:local",
		Namespace:         "peers",
		PreferredUsername: "bob",
		Email:             "bob@example.test",
		PasswordHash:      "local",
		FederatedHandle:   "bob@station.example",
		Origin:            originLocal,
	}
	if err := rds.Create(&local).Error; err != nil {
		t.Fatalf("seed local actor: %v", err)
	}

	input := remoteProfile(
		"bob@station.example",
		local.PTID,
		"forged-avatar",
		"Bob",
		"station-remote",
	)
	err := upsert(
		context.Background(),
		rds,
		input.Envelope.GetFederatedHandle(),
		input,
		input.Now,
	)
	if !errors.Is(err, ErrIdentityConflict) {
		t.Fatalf("error = %v, want ErrIdentityConflict", err)
	}
}
