package actor

import (
	"context"
	"testing"

	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestProfileUpdateUsesDedicatedCASRevision(t *testing.T) {
	rds, err := gorm.Open(sqlite.Open("file:profile-cas?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := rds.AutoMigrate(&db.Actor{}, &db.ActorTouchMeta{}); err != nil {
		t.Fatalf("migrate profile schema: %v", err)
	}
	record := db.Actor{
		PTID:              "ptid:alice",
		Namespace:         "peers",
		PreferredUsername: "alice",
		Name:              "Alice",
		Email:             "alice@example.test",
		PasswordHash:      "hash",
		Origin:            OriginRemoteCached,
	}
	if err := rds.Create(&record).Error; err != nil {
		t.Fatalf("create actor: %v", err)
	}
	if err := rds.Create(&db.ActorTouchMeta{
		ActorID:           record.ID,
		ProfileRevision:   1,
		DefaultVisibility: "public",
		MessagePermission: "everyone",
	}).Error; err != nil {
		t.Fatalf("create actor metadata: %v", err)
	}

	displayName := "Alice Updated"
	applied, err := updateProfileInternal(context.Background(), rds, record.ID, "https://station.test", UpdateProfileRequest{
		DisplayName:      &displayName,
		ObservedRevision: 1,
	})
	if err != nil {
		t.Fatalf("apply profile update: %v", err)
	}
	if applied.Outcome != modelpb.ProfileUpdateOutcome_PROFILE_UPDATE_OUTCOME_APPLIED ||
		applied.Profile.ProfileRevision != 2 ||
		applied.Profile.DisplayName != displayName {
		t.Fatalf("applied result = %#v", applied)
	}

	staleName := "Stale"
	conflict, err := updateProfileInternal(context.Background(), rds, record.ID, "https://station.test", UpdateProfileRequest{
		DisplayName:      &staleName,
		ObservedRevision: 1,
	})
	if err != nil {
		t.Fatalf("resolve stale profile update: %v", err)
	}
	if conflict.Outcome != modelpb.ProfileUpdateOutcome_PROFILE_UPDATE_OUTCOME_CONFLICT ||
		conflict.Profile.ProfileRevision != 2 ||
		conflict.Profile.DisplayName != displayName {
		t.Fatalf("conflict result = %#v", conflict)
	}

	unchanged, err := updateProfileInternal(context.Background(), rds, record.ID, "https://station.test", UpdateProfileRequest{
		DisplayName:      &displayName,
		ObservedRevision: 2,
	})
	if err != nil {
		t.Fatalf("apply equal profile update: %v", err)
	}
	if unchanged.Outcome != modelpb.ProfileUpdateOutcome_PROFILE_UPDATE_OUTCOME_UNCHANGED ||
		unchanged.Profile.ProfileRevision != 2 {
		t.Fatalf("unchanged result = %#v", unchanged)
	}

	if err := rds.Model(&db.ActorTouchMeta{}).
		Where("actor_id = ?", record.ID).
		Update("followers_count", 9).Error; err != nil {
		t.Fatalf("update profile counter: %v", err)
	}
	var meta db.ActorTouchMeta
	if err := rds.Where("actor_id = ?", record.ID).First(&meta).Error; err != nil {
		t.Fatalf("read actor metadata: %v", err)
	}
	if meta.ProfileRevision != 2 {
		t.Fatalf("counter update changed profile revision to %d", meta.ProfileRevision)
	}
}

func TestProfileUpdateOwnsDiscoverability(t *testing.T) {
	rds, err := gorm.Open(sqlite.Open("file:profile-discoverability?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := rds.AutoMigrate(&db.Actor{}, &db.ActorTouchMeta{}); err != nil {
		t.Fatalf("migrate profile schema: %v", err)
	}
	record := db.Actor{
		PTID:              "ptid:alice",
		Namespace:         "peers",
		PreferredUsername: "alice",
		Name:              "Alice",
		Origin:            OriginLocal,
		FederatedHandle:   "alice@station.test",
		HomeStationPeerID: "station-peer",
		HomeStationDomain: "station.test",
		Visibility:        VisibilityByHandle,
	}
	if err := rds.Create(&record).Error; err != nil {
		t.Fatalf("create actor: %v", err)
	}
	if err := rds.Create(&db.ActorTouchMeta{ActorID: record.ID, ProfileRevision: 1}).Error; err != nil {
		t.Fatalf("create actor metadata: %v", err)
	}

	discoverability := int16(VisibilityIndexed)
	result, err := updateProfileInternal(context.Background(), rds, record.ID, "https://station.test", UpdateProfileRequest{
		Discoverability:  &discoverability,
		ObservedRevision: 1,
	})
	if err != nil {
		t.Fatalf("update discoverability: %v", err)
	}
	if result.Outcome != modelpb.ProfileUpdateOutcome_PROFILE_UPDATE_OUTCOME_APPLIED ||
		result.Profile.Discoverability != VisibilityIndexed ||
		result.Profile.HomeStationPeerID != "station-peer" {
		t.Fatalf("discoverability result = %#v", result)
	}
	var updated db.Actor
	if err := rds.First(&updated, record.ID).Error; err != nil {
		t.Fatalf("read updated actor: %v", err)
	}
	if updated.Visibility != VisibilityIndexed {
		t.Fatalf("persisted visibility = %d", updated.Visibility)
	}
}

func TestValidateProfileUpdateRequest(t *testing.T) {
	if err := ValidateProfileUpdateRequest(UpdateProfileRequest{}); err != ErrProfileRevisionRequired {
		t.Fatalf("missing revision error = %v", err)
	}
	if err := ValidateProfileUpdateRequest(UpdateProfileRequest{ObservedRevision: 1}); err != ErrEmptyProfileMutation {
		t.Fatalf("empty mutation error = %v", err)
	}
}
