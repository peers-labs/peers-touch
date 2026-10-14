package actor

import (
	"context"
	"errors"
	"testing"

	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestProfileCollectionsReplaceAndClearThroughWireCAS(t *testing.T) {
	rds, err := gorm.Open(sqlite.Open("file:profile-collections?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := rds.AutoMigrate(&db.Actor{}, &db.ActorTouchMeta{}, &db.ActorFederationVisibility{}); err != nil {
		t.Fatal(err)
	}
	record := db.Actor{
		PTID: "ptid:collections", Namespace: "peers",
		PreferredUsername: "collections", Name: "Collections", Origin: OriginRemoteCached,
	}
	if err := rds.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	if err := rds.Create(&db.ActorTouchMeta{ActorID: record.ID, ProfileRevision: 1}).Error; err != nil {
		t.Fatal(err)
	}
	mutate := func(request *modelpb.UpdateProfileRequest) *ProfileUpdateResult {
		t.Helper()
		wire, err := proto.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		var decoded modelpb.UpdateProfileRequest
		if err := proto.Unmarshal(wire, &decoded); err != nil {
			t.Fatal(err)
		}
		input, err := UpdateProfileRequestFromProto(&decoded)
		if err != nil {
			t.Fatal(err)
		}
		result, err := updateProfileInternal(context.Background(), rds, record.ID, "https://station.test", input)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	replaced := mutate(&modelpb.UpdateProfileRequest{
		Tags:                 []string{"native-proof"},
		Links:                []*modelpb.UserLink{{Label: "Proof", Url: "https://example.com/proof"}},
		CollectionUpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"tags", "links"}},
		ObservedRevision:     1,
	})
	if replaced.Profile.ProfileRevision != 2 || len(replaced.Profile.Tags) != 1 || len(replaced.Profile.Links) != 1 {
		t.Fatalf("replacement did not persist: %#v", replaced.Profile)
	}
	cleared := mutate(&modelpb.UpdateProfileRequest{
		CollectionUpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"tags"}},
		ObservedRevision:     2,
	})
	if cleared.Profile.ProfileRevision != 3 || len(cleared.Profile.Tags) != 0 || len(cleared.Profile.Links) != 1 {
		t.Fatalf("tag clear changed the wrong fields: %#v", cleared.Profile)
	}
	conflict := mutate(&modelpb.UpdateProfileRequest{
		CollectionUpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"links"}},
		ObservedRevision:     2,
	})
	if conflict.Outcome != modelpb.ProfileUpdateOutcome_PROFILE_UPDATE_OUTCOME_CONFLICT || len(conflict.Profile.Links) != 1 {
		t.Fatalf("stale clear overwrote links: %#v", conflict)
	}
	cleared = mutate(&modelpb.UpdateProfileRequest{
		CollectionUpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"tags", "links"}},
		ObservedRevision:     3,
	})
	if cleared.Profile.ProfileRevision != 4 || len(cleared.Profile.Tags) != 0 || len(cleared.Profile.Links) != 0 {
		t.Fatalf("collection clear did not persist: %#v", cleared.Profile)
	}
	var meta db.ActorTouchMeta
	if err := rds.Where("actor_id = ?", record.ID).First(&meta).Error; err != nil {
		t.Fatal(err)
	}
	if meta.Tags != "[]" || meta.Links != "[]" {
		t.Fatalf("empty collections must persist as arrays: tags=%s links=%s", meta.Tags, meta.Links)
	}
	unchanged := mutate(&modelpb.UpdateProfileRequest{
		CollectionUpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"tags", "links"}},
		ObservedRevision:     4,
	})
	if unchanged.Outcome != modelpb.ProfileUpdateOutcome_PROFILE_UPDATE_OUTCOME_UNCHANGED || unchanged.Profile.ProfileRevision != 4 {
		t.Fatalf("equal clear advanced revision: %#v", unchanged)
	}
}

func TestProfileCollectionMaskRejectsAmbiguousPayloads(t *testing.T) {
	for name, request := range map[string]*modelpb.UpdateProfileRequest{
		"unmasked tags":  {Tags: []string{"tag"}},
		"unmasked links": {Links: []*modelpb.UserLink{{Url: "https://example.com"}}},
		"unknown path":   {CollectionUpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"avatar"}}},
		"nested path":    {CollectionUpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"links.url"}}},
		"duplicate path": {CollectionUpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"tags", "tags"}}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := UpdateProfileRequestFromProto(request); !errors.Is(err, ErrInvalidProfileCollectionMask) {
				t.Fatalf("invalid collection update accepted: %v", err)
			}
		})
	}
}
