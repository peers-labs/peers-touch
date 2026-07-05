package infrastructure

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFetchKeyBundles_MultiDeviceCompositeKey(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	repo := NewGormRepo(db)
	if err := repo.db.Migrator().DropTable(&OneTimePreKeyModel{}, &SignedPreKeyModel{}, &IdentityKeyModel{}); err != nil {
		t.Fatalf("pre-drop: %v", err)
	}
	if err := repo.db.AutoMigrate(&IdentityKeyModel{}, &SignedPreKeyModel{}, &OneTimePreKeyModel{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	did := "did:peer:test-actor"
	devA := "dev-a"
	devB := "dev-b"
	ikA := []byte("identity-key-public-material-a______")
	ikB := []byte("identity-key-public-material-b______")

	if err := repo.UpsertIdentityKey(did, devA, ikA, "fp-a", 100, []uint32{0}); err != nil {
		t.Fatalf("ik a: %v", err)
	}
	if err := repo.UpsertSignedPreKey(did, devA, domain.SignedPreKey{ID: 1, PublicKey: []byte("spk-a___________________________"), Signature: []byte("spk-sig-a_______________________")}); err != nil {
		t.Fatalf("spk a: %v", err)
	}
	if err := repo.UploadOneTimePreKeys(did, devA, []domain.OneTimePreKey{{ID: 10, PublicKey: []byte("opk-a1__________________________")}}); err != nil {
		t.Fatalf("opk a: %v", err)
	}

	if err := repo.UpsertIdentityKey(did, devB, ikB, "fp-b", 200, []uint32{0, 1}); err != nil {
		t.Fatalf("ik b: %v", err)
	}
	if err := repo.UpsertSignedPreKey(did, devB, domain.SignedPreKey{ID: 2, PublicKey: []byte("spk-b___________________________"), Signature: []byte("spk-sig-b_______________________")}); err != nil {
		t.Fatalf("spk b: %v", err)
	}
	if err := repo.UploadOneTimePreKeys(did, devB, []domain.OneTimePreKey{{ID: 20, PublicKey: []byte("opk-b1__________________________")}}); err != nil {
		t.Fatalf("opk b: %v", err)
	}

	bundles, err := repo.FetchKeyBundles(did, "")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(bundles) != 2 {
		t.Fatalf("expected 2 bundles, got %d", len(bundles))
	}
	// published_at desc => devB first
	if bundles[0].DeviceID != devB || bundles[1].DeviceID != devA {
		t.Fatalf("unexpected order/devices: %#v, %#v", bundles[0].DeviceID, bundles[1].DeviceID)
	}
	if len(bundles[0].OneTimePreKeys) != 1 || len(bundles[1].OneTimePreKeys) != 1 {
		t.Fatalf("expected one consumed opk per bundle")
	}
	if got := bundles[0].SupportedVersions; len(got) != 2 || got[0] != 0 || got[1] != 1 {
		t.Fatalf("expected devB to preserve supported versions [0 1], got %#v", got)
	}
}

func TestUploadOneTimePreKeys_IsIdempotentForDuplicateIDs(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	repo := NewGormRepo(db)
	if err := repo.db.AutoMigrate(&IdentityKeyModel{}, &SignedPreKeyModel{}, &OneTimePreKeyModel{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	did := "did:peer:test-actor"
	deviceID := "device-a"
	keys := []domain.OneTimePreKey{
		{ID: 1, PublicKey: []byte("opk-1___________________________")},
		{ID: 2, PublicKey: []byte("opk-2___________________________")},
	}
	if err := repo.UploadOneTimePreKeys(did, deviceID, keys); err != nil {
		t.Fatalf("first upload: %v", err)
	}
	if err := repo.db.Model(&OneTimePreKeyModel{}).
		Where("actor_did = ? AND device_id = ? AND opk_id = ?", did, deviceID, int32(1)).
		Update("consumed", true).Error; err != nil {
		t.Fatalf("mark consumed: %v", err)
	}
	if err := repo.UploadOneTimePreKeys(did, deviceID, keys); err != nil {
		t.Fatalf("duplicate upload should be idempotent: %v", err)
	}

	var count int64
	if err := repo.db.Model(&OneTimePreKeyModel{}).
		Where("actor_did = ? AND device_id = ?", did, deviceID).
		Count(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected duplicate upload to keep 2 rows, got %d", count)
	}
	var consumed bool
	if err := repo.db.Model(&OneTimePreKeyModel{}).
		Select("consumed").
		Where("actor_did = ? AND device_id = ? AND opk_id = ?", did, deviceID, int32(1)).
		Take(&consumed).Error; err != nil {
		t.Fatalf("read consumed: %v", err)
	}
	if !consumed {
		t.Fatalf("duplicate upload must not resurrect a consumed OPK")
	}
}
