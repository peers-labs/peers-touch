package conversation

import (
	"bytes"
	"context"
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
