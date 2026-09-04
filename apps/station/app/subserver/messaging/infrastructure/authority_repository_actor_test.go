package infrastructure

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	actordb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestActorHomeStationIDUsesActorFederationDirectory(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&actordb.Actor{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&actordb.Actor{
		PTID:              "ptid:bob",
		Namespace:         "peers",
		PreferredUsername: "bob",
		Email:             "bob@remote.invalid",
		PasswordHash:      "not-used",
		HomeStationPeerID: "station:remote",
		Origin:            "remote_cached",
	}).Error; err != nil {
		t.Fatal(err)
	}

	homeStationID, err := NewDeviceDirectory(db).ActorHomeStationID(
		context.Background(),
		"ptid:bob",
	)
	if err != nil {
		t.Fatal(err)
	}
	if homeStationID != "station:remote" {
		t.Fatalf("home station = %q, want station:remote", homeStationID)
	}
}

func TestActorHomeStationIDRejectsInvalidActorRoute(t *testing.T) {
	for _, test := range []struct {
		name   string
		actor  *actordb.Actor
		wantIs error
	}{
		{
			name:   "missing actor",
			wantIs: messaging.ErrNotFound,
		},
		{
			name: "missing home station",
			actor: &actordb.Actor{
				PTID:              "ptid:bob",
				Namespace:         "peers",
				PreferredUsername: "bob",
				Email:             "bob@remote.invalid",
				PasswordHash:      "not-used",
				Origin:            "remote_cached",
			},
			wantIs: messaging.ErrNotFound,
		},
		{
			name: "unknown origin",
			actor: &actordb.Actor{
				PTID:              "ptid:bob",
				Namespace:         "peers",
				PreferredUsername: "bob",
				Email:             "bob@remote.invalid",
				PasswordHash:      "not-used",
				HomeStationPeerID: "station:remote",
				Origin:            "unknown",
			},
			wantIs: messaging.ErrEndpointManifestConflict,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, err := gorm.Open(
				sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
				&gorm.Config{},
			)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.AutoMigrate(&actordb.Actor{}); err != nil {
				t.Fatal(err)
			}
			if test.actor != nil {
				if err := db.Create(test.actor).Error; err != nil {
					t.Fatal(err)
				}
			}

			_, err = NewDeviceDirectory(db).ActorHomeStationID(
				context.Background(),
				"ptid:bob",
			)
			if !errors.Is(err, test.wantIs) {
				t.Fatalf("error = %v, want %v", err, test.wantIs)
			}
		})
	}
}
