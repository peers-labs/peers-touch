package conversation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestKeyPackageUploadIsIdempotentByDeviceAndPayload(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:keypackage-idempotency?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	store := NewKeyPackageStore(db)
	if err := store.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	payload := []byte("exact-openmls-keypackage")
	if err := store.Upload(ctx, "ptid:alice", "device-a", "station-a", payload); err != nil {
		t.Fatal(err)
	}
	if err := store.Upload(ctx, "ptid:alice", "device-a", "station-a", payload); err != nil {
		t.Fatal(err)
	}
	count, err := store.CountAvailable(ctx, "ptid:alice")
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("available KeyPackages = %d, want 1", count)
	}
	keyPackage, err := store.FetchAndConsume(ctx, "ptid:alice")
	if err != nil {
		t.Fatal(err)
	}
	if keyPackage == nil || !bytes.Equal(keyPackage.Data, payload) {
		t.Fatalf("consumed KeyPackage = %+v", keyPackage)
	}
}

func TestKeyPackageMigrationRestoresHashIntegrity(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:keypackage-hash-migration?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	store := NewKeyPackageStore(db)
	if err := store.AutoMigrate(); err != nil {
		t.Fatal(err)
	}

	duplicatePayload := []byte("duplicate-keypackage")
	duplicateHash := sha256.Sum256(duplicatePayload)
	uniquePayload := []byte("unique-keypackage")
	for _, keyPackage := range []KeyPackage{
		{
			Ptid:      "ptid:alice",
			DeviceID:  "device-a",
			StationID: "station-a",
			Data:      duplicatePayload,
		},
		{
			Ptid:       "ptid:alice",
			DeviceID:   "device-a",
			StationID:  "station-a",
			Data:       duplicatePayload,
			DataSHA256: duplicateHash[:],
		},
		{
			Ptid:      "ptid:alice",
			DeviceID:  "device-a",
			StationID: "station-a",
			Data:      uniquePayload,
		},
		{
			Ptid:      "ptid:alice",
			DeviceID:  "device-a",
			StationID: "station-a",
		},
	} {
		if err := db.Create(&keyPackage).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := store.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	var keyPackages []KeyPackage
	if err := db.Order("id ASC").Find(&keyPackages).Error; err != nil {
		t.Fatal(err)
	}
	if len(keyPackages) != 2 {
		t.Fatalf("KeyPackages after migration = %d, want 2", len(keyPackages))
	}
	for _, keyPackage := range keyPackages {
		expected := sha256.Sum256(keyPackage.Data)
		if len(keyPackage.Data) == 0 || !bytes.Equal(keyPackage.DataSHA256, expected[:]) {
			t.Fatalf("invalid migrated KeyPackage = %+v", keyPackage)
		}
	}
}
