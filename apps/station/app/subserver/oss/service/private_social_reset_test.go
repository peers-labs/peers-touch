package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"path/filepath"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPrivateSocialResetOwnerReleasesExclusiveLegacyClaim(t *testing.T) {
	fixture := newPrivateSocialResetFixture(t, []string{"alice"}, true)
	target := fixture.auditedTarget(t, "alice")

	if target.ReferenceClassification !=
		infrastructure.ResetReferenceExclusiveLegacy {
		t.Fatalf(
			"classification = %q, want %q",
			target.ReferenceClassification,
			infrastructure.ResetReferenceExclusiveLegacy,
		)
	}
	if err := fixture.owner.DeleteResetObject(
		context.Background(),
		target,
	); err != nil {
		t.Fatal(err)
	}
	if err := fixture.owner.DeleteResetObject(
		context.Background(),
		target,
	); err != nil {
		t.Fatalf("idempotent release: %v", err)
	}
	if err := fixture.owner.VerifyResetObjectDeleted(
		context.Background(),
		target,
	); err != nil {
		t.Fatal(err)
	}

	var metadata ossmodel.FileMeta
	if err := fixture.database.
		Where("owner_ptid = ? AND key = ?", "alice", fixture.key).
		First(&metadata).Error; err != nil {
		t.Fatal(err)
	}
	if metadata.DeletedAt == nil {
		t.Fatal("legacy OSS metadata remains live")
	}
	var blob ossmodel.Blob
	if err := fixture.database.
		Where("backend = ? AND key = ?", "local", fixture.key).
		First(&blob).Error; err != nil {
		t.Fatal(err)
	}
	if blob.RefCount != 0 {
		t.Fatalf("blob ref_count = %d, want 0", blob.RefCount)
	}
	if _, err := fixture.backend.Stat(
		context.Background(),
		fixture.key,
	); err != nil {
		t.Fatalf("BlobGC, not the reset owner, owns physical deletion: %v", err)
	}
}

func TestPrivateSocialResetOwnerPreservesSharedCASBytes(t *testing.T) {
	fixture := newPrivateSocialResetFixture(t, []string{"alice", "bob"}, true)
	target := fixture.auditedTarget(t, "alice")

	if target.ReferenceClassification !=
		infrastructure.ResetReferenceSharedCASSafe {
		t.Fatalf(
			"classification = %q, want %q",
			target.ReferenceClassification,
			infrastructure.ResetReferenceSharedCASSafe,
		)
	}
	if err := fixture.owner.DeleteResetObject(
		context.Background(),
		target,
	); err != nil {
		t.Fatal(err)
	}
	if err := fixture.owner.VerifyResetObjectDeleted(
		context.Background(),
		target,
	); err != nil {
		t.Fatal(err)
	}

	var retained ossmodel.FileMeta
	if err := fixture.database.
		Where("owner_ptid = ? AND key = ? AND deleted_at IS NULL", "bob", fixture.key).
		First(&retained).Error; err != nil {
		t.Fatalf("shared CAS metadata was removed: %v", err)
	}
	var blob ossmodel.Blob
	if err := fixture.database.
		Where("backend = ? AND key = ?", "local", fixture.key).
		First(&blob).Error; err != nil {
		t.Fatal(err)
	}
	if blob.RefCount != 1 {
		t.Fatalf("blob ref_count = %d, want 1", blob.RefCount)
	}
	if _, err := fixture.backend.Stat(
		context.Background(),
		fixture.key,
	); err != nil {
		t.Fatalf("shared CAS bytes were removed: %v", err)
	}
}

func TestPrivateSocialResetOwnerRejectsMetadataDrift(t *testing.T) {
	fixture := newPrivateSocialResetFixture(t, []string{"alice"}, true)
	target := fixture.auditedTarget(t, "alice")

	if err := fixture.database.Model(&ossmodel.FileMeta{}).
		Where("owner_ptid = ? AND key = ?", "alice", fixture.key).
		Update("name", "changed-after-audit.bin").Error; err != nil {
		t.Fatal(err)
	}
	err := fixture.owner.DeleteResetObject(context.Background(), target)
	if infrastructure.ResetCodeOf(err) !=
		infrastructure.ResetCodeObjectDigestMismatch {
		t.Fatalf("DeleteResetObject() error = %v", err)
	}

	var metadata ossmodel.FileMeta
	if err := fixture.database.
		Where("owner_ptid = ? AND key = ?", "alice", fixture.key).
		First(&metadata).Error; err != nil {
		t.Fatal(err)
	}
	if metadata.DeletedAt != nil {
		t.Fatal("metadata drift must block deletion")
	}
	var blob ossmodel.Blob
	if err := fixture.database.
		Where("backend = ? AND key = ?", "local", fixture.key).
		First(&blob).Error; err != nil {
		t.Fatal(err)
	}
	if blob.RefCount != 1 {
		t.Fatalf("blob ref_count = %d, want 1", blob.RefCount)
	}
}

func TestPrivateSocialResetOwnerRejectsBlobByteDrift(t *testing.T) {
	fixture := newPrivateSocialResetFixture(t, []string{"alice"}, true)
	target := fixture.auditedTarget(t, "alice")
	if _, err := fixture.backend.Save(
		context.Background(),
		fixture.key,
		bytes.NewReader([]byte("changed-after-audit")),
	); err != nil {
		t.Fatal(err)
	}

	err := fixture.owner.DeleteResetObject(context.Background(), target)
	if infrastructure.ResetCodeOf(err) !=
		infrastructure.ResetCodeObjectDigestMismatch {
		t.Fatalf("DeleteResetObject() error = %v", err)
	}
	var metadata ossmodel.FileMeta
	if err := fixture.database.
		Where("owner_ptid = ? AND key = ?", "alice", fixture.key).
		First(&metadata).Error; err != nil {
		t.Fatal(err)
	}
	if metadata.DeletedAt != nil {
		t.Fatal("blob byte drift must block metadata deletion")
	}
	var blob ossmodel.Blob
	if err := fixture.database.
		Where("backend = ? AND key = ?", "local", fixture.key).
		First(&blob).Error; err != nil {
		t.Fatal(err)
	}
	if blob.RefCount != 1 {
		t.Fatalf("blob ref_count = %d, want 1", blob.RefCount)
	}
}

func TestPrivateSocialResetOwnerRejectsSharedNonCASKey(t *testing.T) {
	fixture := newPrivateSocialResetFixture(t, []string{"alice", "bob"}, false)
	_, err := fixture.owner.InspectResetObject(
		context.Background(),
		infrastructure.ResolvedResetObjectTarget{
			OwnerDomain: infrastructure.ResetObjectDomainOSS,
			OwnerPTID:   "alice",
			Backend:     resetLogicalOSSBackend,
			StorageKey:  fixture.key,
		},
	)
	if infrastructure.ResetCodeOf(err) !=
		infrastructure.ResetCodeObjectReferenceAmbiguous {
		t.Fatalf("InspectResetObject() error = %v", err)
	}
}

type privateSocialResetFixture struct {
	database *gorm.DB
	backend  storage.Backend
	owner    *PrivateSocialResetOwner
	key      string
	digest   string
}

func newPrivateSocialResetFixture(
	t *testing.T,
	owners []string,
	useCASKey bool,
) privateSocialResetFixture {
	t.Helper()

	database, err := gorm.Open(
		sqlite.Open(
			"file:"+filepath.Join(t.TempDir(), "oss.db")+
				"?_fk=1&_busy_timeout=10000",
		),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(
		&ossmodel.Blob{},
		&ossmodel.FileMeta{},
	); err != nil {
		t.Fatal(err)
	}

	body := []byte("shared legacy private Social object")
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	key := "legacy/private-social.bin"
	if useCASKey {
		key = "cas/" + digest[:2] + "/" + digest + ".bin"
	}
	backend := storage.NewLocalBackend(t.TempDir())
	if _, err := backend.Save(
		context.Background(),
		key,
		bytes.NewReader(body),
	); err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	for index, ownerPTID := range owners {
		metadata := ossmodel.FileMeta{
			ID:         ownerPTID + "-file",
			Key:        key,
			Name:       "private-social.bin",
			Size:       int64(len(body)),
			Mime:       "application/octet-stream",
			Backend:    "local",
			Path:       filepath.Join("objects", key),
			Sha256:     digest,
			BucketID:   ownerPTID + "-moments",
			OwnerPTID:  ownerPTID,
			Visibility: ossmodel.VisibilityPrivate,
			CreatedAt:  now.Add(time.Duration(index) * time.Second),
			UpdatedAt:  now.Add(time.Duration(index) * time.Second),
		}
		if err := database.Create(&metadata).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := database.Create(&ossmodel.Blob{
		Backend:    "local",
		Key:        key,
		Size:       int64(len(body)),
		Sha256:     digest,
		RefCount:   int64(len(owners)),
		LastSeenAt: now,
		CreatedAt:  now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	owner, err := NewPrivateSocialResetOwner(
		PrivateSocialResetOwnerConfig{
			Database:    database,
			Backend:     backend,
			BackendName: "local",
			Clock:       func() time.Time { return now.Add(time.Hour) },
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	return privateSocialResetFixture{
		database: database,
		backend:  backend,
		owner:    owner,
		key:      key,
		digest:   digest,
	}
}

func (f privateSocialResetFixture) auditedTarget(
	t *testing.T,
	ownerPTID string,
) infrastructure.ResolvedResetObjectTarget {
	t.Helper()

	target := infrastructure.ResolvedResetObjectTarget{
		ResetID:     "reset-four-1",
		OwnerDomain: infrastructure.ResetObjectDomainOSS,
		OwnerPTID:   ownerPTID,
		Backend:     resetLogicalOSSBackend,
		StorageKey:  f.key,
	}
	inspection, err := f.owner.InspectResetObject(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	target.Backend = inspection.Backend
	target.ExpectedMetadataDigest = inspection.MetadataDigest
	target.ExpectedBlobDigest = inspection.BlobDigest
	target.ReferenceClassification = inspection.ReferenceClassification

	return target
}

func TestPrivateSocialResetOwnerRejectsWrongBackend(t *testing.T) {
	fixture := newPrivateSocialResetFixture(t, []string{"alice"}, true)
	target := fixture.auditedTarget(t, "alice")
	target.Backend = "s3"

	err := fixture.owner.DeleteResetObject(context.Background(), target)
	var resetErr *infrastructure.ResetError
	if !errors.As(err, &resetErr) ||
		resetErr.Code != infrastructure.ResetCodeObjectReferenceAmbiguous {
		t.Fatalf("DeleteResetObject() error = %v", err)
	}
}
