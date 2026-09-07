package persistence

import (
	"bytes"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAutoMigrateBackfillsLegacyActorDeviceMetadata(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open(
			fmt.Sprintf(
				"file:actor-identity-migration-%s?mode=memory&cache=shared",
				uuid.NewString(),
			),
		),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = sqlDatabase.Close()
	})

	for _, statement := range []string{
		`CREATE TABLE actor_devices (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ptid VARCHAR(255),
			device_id VARCHAR(255),
			label VARCHAR(255),
			home_station_peer_id VARCHAR(255),
			signing_key_id VARCHAR(255),
			public_key BLOB,
			profile_version BIGINT,
			verification_source INTEGER,
			revoked BOOLEAN,
			created_at DATETIME,
			revoked_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_device_ptid_device
			ON actor_devices (ptid, device_id)`,
		`CREATE TABLE touch_actor (
			ptid VARCHAR(255) PRIMARY KEY,
			preferred_username VARCHAR(100),
			federated_handle VARCHAR(256),
			kind VARCHAR(16)
		)`,
	} {
		if err := database.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	const actorPTID = "ptid:v1:actor:peers:p:alice:test"
	if err := database.Exec(
		`INSERT INTO touch_actor (
			ptid, preferred_username, federated_handle, kind
		) VALUES (?, ?, ?, ?)`,
		actorPTID,
		"alice",
		"@alice@example.test",
		"p",
	).Error; err != nil {
		t.Fatal(err)
	}
	publicKey := bytes.Repeat([]byte{0x42}, 32)
	if err := database.Exec(
		`INSERT INTO actor_devices (
			ptid, device_id, label, home_station_peer_id, signing_key_id,
			public_key, profile_version, verification_source, revoked, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		actorPTID,
		"alice-device",
		"Alice Desktop",
		"station-a",
		"alice-signing-key",
		publicKey,
		1,
		int32(
			actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION,
		),
		false,
		time.Date(2026, time.September, 7, 12, 0, 0, 0, time.UTC),
	).Error; err != nil {
		t.Fatal(err)
	}

	repository, err := NewRepository(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatalf("idempotent migration: %v", err)
	}

	var device ActorDeviceModel
	if err := database.First(&device, "ptid = ?", actorPTID).Error; err != nil {
		t.Fatal(err)
	}
	if device.ActorAccount != "alice@example.test" ||
		device.ActorKind != int32(actormodel.ActorKind_ACTOR_KIND_PERSON) ||
		!bytes.Equal(device.PublicKey, publicKey) {
		t.Fatalf("migrated actor device = %+v", device)
	}

	var incomplete int64
	if err := database.Model(&actorDeviceMetadataMigrationModel{}).
		Where("actor_acct IS NULL OR actor_kind IS NULL").
		Count(&incomplete).Error; err != nil {
		t.Fatal(err)
	}
	if incomplete != 0 {
		t.Fatalf("incomplete migrated actor devices = %d", incomplete)
	}
}
