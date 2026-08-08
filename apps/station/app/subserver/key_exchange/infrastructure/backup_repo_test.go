package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newBackupTestRepo(t *testing.T) (*GormRepo, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return repo, db
}

func validBackupInput(label string) domain.NewCryptoBackup {
	return domain.NewCryptoBackup{
		EncryptedBlob: []byte("opaque-" + label),
		Nonce:         make([]byte, domain.BackupNonceBytes),
		IntegrityTag:  make([]byte, domain.BackupIntegrityTagBytes),
		KDF: domain.BackupKDFParameters{
			Salt:          make([]byte, domain.MinBackupSaltBytes),
			MemoryCostKiB: 64 * 1024,
			TimeCost:      3,
			Parallelism:   1,
			OutputLength:  domain.BackupKeyOutputBytes,
		},
	}
}

func TestCryptoBackupRevisionsAreMonotonicAndRetained(t *testing.T) {
	repo, _ := newBackupTestRepo(t)
	ctx := context.Background()
	const ptid = "ptid:v1:actor:peers:p:alice"

	for revision := 1; revision <= 7; revision++ {
		stored, err := repo.PutCryptoBackup(
			ctx,
			ptid,
			validBackupInput(fmt.Sprintf("revision-%d", revision)),
		)
		if err != nil {
			t.Fatalf("put revision %d: %v", revision, err)
		}
		if stored.Revision != uint64(revision) {
			t.Fatalf("revision = %d, want %d", stored.Revision, revision)
		}
		if stored.Ptid != ptid || stored.BackupID == "" {
			t.Fatalf("invalid stored identity: %+v", stored)
		}
	}

	latest, err := repo.GetLatestCryptoBackup(ctx, ptid)
	if err != nil {
		t.Fatalf("latest: %v", err)
	}
	if latest.Revision != 7 || string(latest.EncryptedBlob) != "opaque-revision-7" {
		t.Fatalf("unexpected latest revision: %+v", latest)
	}

	backups, err := repo.ListCryptoBackups(ctx, ptid, domain.BackupRetentionLimit)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(backups) != domain.BackupRetentionLimit {
		t.Fatalf("retained revisions = %d, want %d", len(backups), domain.BackupRetentionLimit)
	}
	for index, backup := range backups {
		want := uint64(7 - index)
		if backup.Revision != want {
			t.Fatalf("backups[%d].revision = %d, want %d", index, backup.Revision, want)
		}
	}

	bob, err := repo.PutCryptoBackup(
		ctx,
		"ptid:v1:actor:peers:p:bob",
		validBackupInput("bob"),
	)
	if err != nil {
		t.Fatalf("put bob backup: %v", err)
	}
	if bob.Revision != 1 {
		t.Fatalf("Bob revision = %d, want independent revision 1", bob.Revision)
	}
}

func TestCryptoBackupRevisionCannotBeUpdated(t *testing.T) {
	repo, db := newBackupTestRepo(t)
	ctx := context.Background()
	stored, err := repo.PutCryptoBackup(
		ctx,
		"ptid:v1:actor:peers:p:alice",
		validBackupInput("immutable"),
	)
	if err != nil {
		t.Fatal(err)
	}

	err = db.Model(&CryptoBackupRevisionModel{}).
		Where("backup_id = ?", stored.BackupID).
		Update("encrypted_blob", []byte("replacement")).Error
	if !errors.Is(err, domain.ErrBackupImmutable) {
		t.Fatalf("update error = %v, want ErrBackupImmutable", err)
	}
	latest, err := repo.GetLatestCryptoBackup(ctx, stored.Ptid)
	if err != nil {
		t.Fatal(err)
	}
	if string(latest.EncryptedBlob) != "opaque-immutable" {
		t.Fatal("immutable backup ciphertext changed")
	}
}

func TestGetLatestCryptoBackupIsScopedByPTID(t *testing.T) {
	repo, _ := newBackupTestRepo(t)
	_, err := repo.GetLatestCryptoBackup(
		context.Background(),
		"ptid:v1:actor:peers:p:missing",
	)
	if !errors.Is(err, domain.ErrBackupNotFound) {
		t.Fatalf("error = %v, want ErrBackupNotFound", err)
	}
}
