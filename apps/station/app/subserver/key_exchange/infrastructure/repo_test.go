package infrastructure

import (
	"strings"
	"testing"
	"time"

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
		Where("actor_ptid = ? AND device_id = ? AND opk_id = ?", did, deviceID, int32(1)).
		Update("consumed", true).Error; err != nil {
		t.Fatalf("mark consumed: %v", err)
	}
	if err := repo.UploadOneTimePreKeys(did, deviceID, keys); err != nil {
		t.Fatalf("duplicate upload should be idempotent: %v", err)
	}

	var count int64
	if err := repo.db.Model(&OneTimePreKeyModel{}).
		Where("actor_ptid = ? AND device_id = ?", did, deviceID).
		Count(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected duplicate upload to keep 2 rows, got %d", count)
	}
	var consumed bool
	if err := repo.db.Model(&OneTimePreKeyModel{}).
		Select("consumed").
		Where("actor_ptid = ? AND device_id = ? AND opk_id = ?", did, deviceID, int32(1)).
		Take(&consumed).Error; err != nil {
		t.Fatalf("read consumed: %v", err)
	}
	if !consumed {
		t.Fatalf("duplicate upload must not resurrect a consumed OPK")
	}
}

func TestAutoMigrateDeletesUnaddressedLegacyBundles(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&IdentityKeyModel{}, &SignedPreKeyModel{}, &OneTimePreKeyModel{}); err != nil {
		t.Fatalf("migrate fixture: %v", err)
	}
	now := time.Now()
	if err := db.Create(&IdentityKeyModel{
		ActorPtid:      "did:legacy",
		DeviceID:       "legacy",
		IdentityKeyPub: []byte("legacy-key"),
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed legacy identity: %v", err)
	}
	if err := db.Create(&SignedPreKeyModel{
		ActorPtid: "did:legacy",
		DeviceID:  "legacy",
		SPKID:     1,
		PublicKey: []byte("legacy-spk"),
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed legacy SPK: %v", err)
	}
	if err := db.Create(&OneTimePreKeyModel{
		ActorPtid: "did:legacy",
		DeviceID:  "legacy",
		OPKID:     1,
		PublicKey: []byte("legacy-opk"),
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed legacy OPK: %v", err)
	}

	if err := NewGormRepo(db).AutoMigrate(); err != nil {
		t.Fatalf("hard-cut migration: %v", err)
	}
	for _, model := range []any{
		&IdentityKeyModel{},
		&SignedPreKeyModel{},
		&OneTimePreKeyModel{},
	} {
		var count int64
		if err := db.Model(model).Where("device_id = ?", "legacy").Count(&count).Error; err != nil {
			t.Fatalf("count legacy rows: %v", err)
		}
		if count != 0 {
			t.Fatalf("legacy rows remain in %T: %d", model, count)
		}
	}
}

func TestMigrateKeyExchangeIdentityColumnsPreservesData(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:key_exchange_identity_preservation?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE key_exchange_identity_keys (
			actor_did TEXT,
			device_id TEXT,
			identity_key_pub BLOB,
			PRIMARY KEY (actor_did, device_id)
		)`,
		`CREATE TABLE key_exchange_signed_pre_keys (
			id INTEGER PRIMARY KEY,
			actor_did TEXT,
			device_id TEXT,
			spk_id INTEGER,
			public_key BLOB
		)`,
		`CREATE TABLE key_exchange_one_time_pre_keys (
			id INTEGER PRIMARY KEY,
			actor_did TEXT,
			device_id TEXT,
			opk_id INTEGER,
			public_key BLOB,
			consumed BOOLEAN
		)`,
		`INSERT INTO key_exchange_identity_keys
			(actor_did, device_id, identity_key_pub)
		 VALUES ('ptid:alice', 'device-1', X'01')`,
		`INSERT INTO key_exchange_signed_pre_keys
			(id, actor_did, device_id, spk_id, public_key)
		 VALUES (17, 'ptid:alice', 'device-1', 1, X'02')`,
		`INSERT INTO key_exchange_one_time_pre_keys
			(id, actor_did, device_id, opk_id, public_key, consumed)
		 VALUES (23, 'ptid:alice', 'device-1', 1, X'03', FALSE)`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("execute migration fixture: %v", err)
		}
	}

	if err := migrateKeyExchangeIdentityColumns(db); err != nil {
		t.Fatalf("migrate key exchange identities: %v", err)
	}

	for _, table := range []string{
		"key_exchange_identity_keys",
		"key_exchange_signed_pre_keys",
		"key_exchange_one_time_pre_keys",
	} {
		if db.Migrator().HasColumn(table, "actor_did") ||
			!db.Migrator().HasColumn(table, "actor_ptid") {
			t.Fatalf("%s identity column was not hard-cut", table)
		}
		var row struct {
			ActorPTID string `gorm:"column:actor_ptid"`
		}
		if err := db.Table(table).Select("actor_ptid").Where("device_id = ?", "device-1").Take(&row).Error; err != nil {
			t.Fatalf("read %s actor_ptid: %v", table, err)
		}
		if row.ActorPTID != "ptid:alice" {
			t.Fatalf("%s.actor_ptid = %q, want ptid:alice", table, row.ActorPTID)
		}
	}
}

func TestMigrateKeyExchangeIdentityColumnsRollsBackOnConflict(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:key_exchange_identity_rollback?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE key_exchange_identity_keys (
			actor_did TEXT,
			device_id TEXT,
			PRIMARY KEY (actor_did, device_id)
		)`,
		`CREATE TABLE key_exchange_signed_pre_keys (
			id INTEGER PRIMARY KEY,
			actor_did TEXT,
			actor_ptid TEXT,
			device_id TEXT
		)`,
		`INSERT INTO key_exchange_identity_keys
			(actor_did, device_id)
		 VALUES ('ptid:alice', 'device-1')`,
		`INSERT INTO key_exchange_signed_pre_keys
			(id, actor_did, actor_ptid, device_id)
		 VALUES (1, 'ptid:alice', 'ptid:mallory', 'device-1')`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("execute migration fixture: %v", err)
		}
	}

	err = migrateKeyExchangeIdentityColumns(db)
	if err == nil || !strings.Contains(err.Error(), "divergent") {
		t.Fatalf("expected divergent identity error, got %v", err)
	}
	if !db.Migrator().HasColumn("key_exchange_identity_keys", "actor_did") ||
		db.Migrator().HasColumn("key_exchange_identity_keys", "actor_ptid") {
		t.Fatal("key exchange identity migration was not rolled back as a set")
	}
	var row struct {
		ActorDID string `gorm:"column:actor_did"`
	}
	if err := db.Table("key_exchange_identity_keys").
		Select("actor_did").
		Where("device_id = ?", "device-1").
		Take(&row).Error; err != nil {
		t.Fatalf("read rolled-back identity: %v", err)
	}
	if row.ActorDID != "ptid:alice" {
		t.Fatalf("actor_did = %q, want ptid:alice", row.ActorDID)
	}
}
