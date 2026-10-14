package actor

import (
	"context"
	"errors"
	"testing"

	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestProfileUpdateUsesDedicatedCASRevision(t *testing.T) {
	rds, err := gorm.Open(sqlite.Open("file:profile-cas?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := rds.AutoMigrate(
		&db.Actor{},
		&db.ActorTouchMeta{},
		&db.ActorFederationVisibility{},
	); err != nil {
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
		ActorID:              record.ID,
		ProfileRevision:      1,
		DefaultVisibility:    "public",
		ContactRequestPolicy: "anyone",
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
	if err := rds.AutoMigrate(
		&db.Actor{},
		&db.ActorTouchMeta{},
		&db.ActorFederationVisibility{},
	); err != nil {
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

	discoverability := modelpb.ActorVisibility_ACTOR_VISIBILITY_INDEXED
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

func TestProfileUpdatePersistsTypedPoliciesAsOneCASMutation(t *testing.T) {
	rds, err := gorm.Open(
		sqlite.Open("file:profile-policies?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := rds.AutoMigrate(
		&db.Actor{},
		&db.ActorTouchMeta{},
		&db.ActorFederationVisibility{},
	); err != nil {
		t.Fatalf("migrate profile schema: %v", err)
	}
	mustCreateFederationPolicyTables(t, rds)
	if err := rds.Exec(`
		INSERT INTO federation (federation_id, status)
		VALUES ('fed_active', 'active'), ('fed_left', 'active')
	`).Error; err != nil {
		t.Fatalf("create Federation fixtures: %v", err)
	}
	if err := rds.Exec(`
		INSERT INTO federation_station_membership (
			federation_id, station_peer_id, status
		) VALUES
			('fed_active', 'station-peer', 'active'),
			('fed_left', 'station-peer', 'left')
	`).Error; err != nil {
		t.Fatalf("create Federation membership fixtures: %v", err)
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
		Visibility:        VisibilityIndexed,
	}
	if err := rds.Create(&record).Error; err != nil {
		t.Fatalf("create actor: %v", err)
	}
	if err := rds.Create(&db.ActorTouchMeta{
		ActorID:              record.ID,
		ProfileRevision:      1,
		ContactRequestPolicy: "anyone",
	}).Error; err != nil {
		t.Fatalf("create actor metadata: %v", err)
	}

	contactPolicy := modelpb.ActorContactPolicy_ACTOR_CONTACT_POLICY_FEDERATIONS
	result, err := updateProfileInternal(
		context.Background(),
		rds,
		record.ID,
		"https://station.test",
		UpdateProfileRequest{
			ContactPolicy: &contactPolicy,
			FederationVisibility: &modelpb.FederationVisibilityPolicy{
				VisibilityByFederation: map[string]modelpb.ActorVisibility{
					"fed_active": modelpb.ActorVisibility_ACTOR_VISIBILITY_HIDDEN,
				},
			},
			ObservedRevision: 1,
		},
	)
	if err != nil {
		t.Fatalf("update profile policies: %v", err)
	}
	if result.Outcome != modelpb.ProfileUpdateOutcome_PROFILE_UPDATE_OUTCOME_APPLIED ||
		result.Profile.ProfileRevision != 2 ||
		result.Profile.ContactPolicy != contactPolicy ||
		result.Profile.FederationVisibility["fed_active"] !=
			modelpb.ActorVisibility_ACTOR_VISIBILITY_HIDDEN {
		t.Fatalf("profile policy result = %#v", result)
	}

	var meta db.ActorTouchMeta
	if err := rds.Where("actor_id = ?", record.ID).First(&meta).Error; err != nil {
		t.Fatalf("read actor metadata: %v", err)
	}
	if meta.ContactRequestPolicy != "federations" {
		t.Fatalf("persisted contact policy = %q", meta.ContactRequestPolicy)
	}
	var row db.ActorFederationVisibility
	if err := rds.Where(
		"actor_id = ? AND federation_id = ?",
		record.ID,
		"fed_active",
	).First(&row).Error; err != nil {
		t.Fatalf("read Federation visibility: %v", err)
	}
	if row.StationPeerID != "station-peer" ||
		row.UpdatedByActorPTID != "ptid:alice" ||
		row.Visibility != VisibilityHidden {
		t.Fatalf("persisted Federation visibility = %#v", row)
	}
	var actorRef modelpb.ActorRef
	if err := proto.Unmarshal(row.ActorRefBytes, &actorRef); err != nil {
		t.Fatalf("decode persisted actor ref: %v", err)
	}
	if actorRef.Ptid != record.PTID || actorRef.Acct != record.FederatedHandle {
		t.Fatalf("persisted actor ref = %#v", actorRef)
	}

	cleared, err := updateProfileInternal(
		context.Background(),
		rds,
		record.ID,
		"https://station.test",
		UpdateProfileRequest{
			FederationVisibility: &modelpb.FederationVisibilityPolicy{
				VisibilityByFederation: map[string]modelpb.ActorVisibility{},
			},
			ObservedRevision: 2,
		},
	)
	if err != nil {
		t.Fatalf("clear Federation visibility: %v", err)
	}
	if cleared.Outcome != modelpb.ProfileUpdateOutcome_PROFILE_UPDATE_OUTCOME_APPLIED ||
		cleared.Profile.ProfileRevision != 3 ||
		len(cleared.Profile.FederationVisibility) != 0 {
		t.Fatalf("cleared policy result = %#v", cleared)
	}
	var rows int64
	if err := rds.Model(&db.ActorFederationVisibility{}).
		Where("actor_id = ?", record.ID).
		Count(&rows).Error; err != nil {
		t.Fatalf("count cleared visibility rows: %v", err)
	}
	if rows != 0 {
		t.Fatalf("Federation visibility rows = %d, want 0", rows)
	}
}

func TestProfileUpdateRejectsInactiveOrWiderFederationVisibility(t *testing.T) {
	rds, err := gorm.Open(
		sqlite.Open("file:profile-policy-validation?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := rds.AutoMigrate(
		&db.Actor{},
		&db.ActorTouchMeta{},
		&db.ActorFederationVisibility{},
	); err != nil {
		t.Fatalf("migrate profile schema: %v", err)
	}
	mustCreateFederationPolicyTables(t, rds)
	if err := rds.Exec(`
		INSERT INTO federation (federation_id, status) VALUES ('fed_active', 'active');
	`).Error; err != nil {
		t.Fatalf("create Federation fixture: %v", err)
	}
	if err := rds.Exec(`
		INSERT INTO federation_station_membership (
			federation_id, station_peer_id, status
		) VALUES ('fed_active', 'station-peer', 'active');
	`).Error; err != nil {
		t.Fatalf("create Federation membership fixture: %v", err)
	}
	record := db.Actor{
		PTID:              "ptid:alice",
		Namespace:         "peers",
		PreferredUsername: "alice",
		Origin:            OriginLocal,
		FederatedHandle:   "alice@station.test",
		HomeStationPeerID: "station-peer",
		Visibility:        VisibilityByHandle,
	}
	if err := rds.Create(&record).Error; err != nil {
		t.Fatalf("create actor: %v", err)
	}
	if err := rds.Create(&db.ActorTouchMeta{
		ActorID:              record.ID,
		ProfileRevision:      1,
		ContactRequestPolicy: "anyone",
	}).Error; err != nil {
		t.Fatalf("create actor metadata: %v", err)
	}

	_, err = updateProfileInternal(
		context.Background(),
		rds,
		record.ID,
		"https://station.test",
		UpdateProfileRequest{
			FederationVisibility: &modelpb.FederationVisibilityPolicy{
				VisibilityByFederation: map[string]modelpb.ActorVisibility{
					"fed_active": modelpb.ActorVisibility_ACTOR_VISIBILITY_INDEXED,
				},
			},
			ObservedRevision: 1,
		},
	)
	if !errors.Is(err, ErrInvalidFederationScope) {
		t.Fatalf("wider Federation visibility error = %v", err)
	}
	if err := replaceFederationVisibility(
		rds,
		&record,
		map[string]modelpb.ActorVisibility{
			"fed_active": modelpb.ActorVisibility_ACTOR_VISIBILITY_BY_HANDLE,
		},
	); err != nil {
		t.Fatalf("seed scoped visibility: %v", err)
	}
	hidden := modelpb.ActorVisibility_ACTOR_VISIBILITY_HIDDEN
	_, err = updateProfileInternal(
		context.Background(),
		rds,
		record.ID,
		"https://station.test",
		UpdateProfileRequest{
			Discoverability:  &hidden,
			ObservedRevision: 1,
		},
	)
	if !errors.Is(err, ErrInvalidFederationScope) {
		t.Fatalf("lowered global visibility error = %v", err)
	}

	_, err = updateProfileInternal(
		context.Background(),
		rds,
		record.ID,
		"https://station.test",
		UpdateProfileRequest{
			FederationVisibility: &modelpb.FederationVisibilityPolicy{
				VisibilityByFederation: map[string]modelpb.ActorVisibility{
					"fed_missing": modelpb.ActorVisibility_ACTOR_VISIBILITY_HIDDEN,
				},
			},
			ObservedRevision: 1,
		},
	)
	if !errors.Is(err, ErrInvalidFederationScope) {
		t.Fatalf("inactive Federation visibility error = %v", err)
	}
}

func TestValidateProfileUpdateRequest(t *testing.T) {
	if err := ValidateProfileUpdateRequest(UpdateProfileRequest{}); err != ErrProfileRevisionRequired {
		t.Fatalf("missing revision error = %v", err)
	}
	if err := ValidateProfileUpdateRequest(UpdateProfileRequest{ObservedRevision: 1}); err != ErrEmptyProfileMutation {
		t.Fatalf("empty mutation error = %v", err)
	}
	invalidDiscoverability := modelpb.ActorVisibility(65538)
	request := UpdateProfileRequestFromProto(&modelpb.UpdateProfileRequest{
		Discoverability:  &invalidDiscoverability,
		ObservedRevision: 1,
	})
	if err := ValidateProfileUpdateRequest(request); !errors.Is(err, ErrInvalidDiscoverability) {
		t.Fatalf("wrapped discoverability error = %v", err)
	}

	invalidContactPolicy := modelpb.ActorContactPolicy(99)
	if err := ValidateProfileUpdateRequest(UpdateProfileRequest{
		ContactPolicy:    &invalidContactPolicy,
		ObservedRevision: 1,
	}); !errors.Is(err, ErrInvalidContactPolicy) {
		t.Fatalf("wrapped contact policy error = %v", err)
	}

	if err := ValidateProfileUpdateRequest(UpdateProfileRequest{
		FederationVisibility: &modelpb.FederationVisibilityPolicy{
			VisibilityByFederation: map[string]modelpb.ActorVisibility{
				" fed_active": modelpb.ActorVisibility_ACTOR_VISIBILITY_HIDDEN,
			},
		},
		ObservedRevision: 1,
	}); !errors.Is(err, ErrInvalidFederationScope) {
		t.Fatalf("wrapped Federation visibility error = %v", err)
	}
}

func mustCreateFederationPolicyTables(t *testing.T, rds *gorm.DB) {
	t.Helper()
	for _, statement := range []string{
		`CREATE TABLE federation (
			federation_id TEXT PRIMARY KEY,
			status TEXT NOT NULL
		)`,
		`CREATE TABLE federation_station_membership (
			federation_id TEXT NOT NULL,
			station_peer_id TEXT NOT NULL,
			status TEXT NOT NULL,
			PRIMARY KEY (federation_id, station_peer_id)
		)`,
	} {
		if err := rds.Exec(statement).Error; err != nil {
			t.Fatalf("create Federation policy table: %v", err)
		}
	}
}
