package infrastructure_test

import (
	"testing"
	"time"

	identitydb "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	loginapproval "github.com/peers-labs/peers-touch/station/app/subserver/login_approval"
	db "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// CountEnrolledDevices must exclude revoked rows and devices belonging to
// other Actors.
func TestCountEnrolledDevicesExcludesRevokedAndOtherActors(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := database.AutoMigrate(
		&db.Actor{},
		&identitydb.ActorDeviceModel{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	now := time.Now().UTC()
	if err := database.Create(&db.Actor{
		ID: 7, PTID: "ptid-alice", PreferredUsername: "alice",
		Email: "alice@example.test", HomeStationPeerID: "station-test",
	}).Error; err != nil {
		t.Fatal(err)
	}

	devices := []*identitydb.ActorDeviceModel{
		{PTID: "ptid-alice", ActorAccount: "alice", DeviceID: "alice-1", Label: "alice-1", HomeStationPeerID: "station-test", SigningKeyID: "key-1", PublicKey: make([]byte, 32), ProfileVersion: 1, CreatedAt: now},
		{PTID: "ptid-alice", ActorAccount: "alice", DeviceID: "alice-2", Label: "alice-2", HomeStationPeerID: "station-test", SigningKeyID: "key-2", PublicKey: make([]byte, 32), ProfileVersion: 1, Revoked: true, CreatedAt: now},
	}
	for _, device := range devices {
		if err := database.Create(device).Error; err != nil {
			t.Fatal(err)
		}
	}

	count, err := loginapproval.CountEnrolledDevices(database, "ptid-alice")
	if err != nil {
		t.Fatalf("count enrolled devices: %v", err)
	}
	if count != 1 {
		t.Fatalf("enrolled devices = %d, want 1 (the revoked row must be excluded)", count)
	}

	// An unknown Actor has no enrolled devices and never matches alice's rows.
	other, err := loginapproval.CountEnrolledDevices(database, "ptid-unknown")
	if err != nil {
		t.Fatalf("count unknown actor devices: %v", err)
	}
	if other != 0 {
		t.Fatalf("unknown actor count = %d, want 0", other)
	}
}
