package infrastructure

import (
	"bytes"
	"context"
	"io"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
)

func TestSocialPrivateObjectResetOwnerRejectsPreDeleteBlobDrift(t *testing.T) {
	ctx := context.Background()
	backend := storage.NewLocalBackend(t.TempDir())
	storageKey := "social-private/post/object"
	original := []byte("frozen-object-bytes")
	if _, err := backend.Save(ctx, storageKey, bytes.NewReader(original)); err != nil {
		t.Fatal(err)
	}
	owner, err := NewSocialPrivateObjectResetOwner(backend)
	if err != nil {
		t.Fatal(err)
	}
	target := ResolvedResetObjectTarget{
		OwnerDomain:        ResetObjectDomainSocial,
		Backend:            "social-private",
		StorageKey:         storageKey,
		ExpectedBlobDigest: sha256Hex(original),
	}
	if _, err := owner.InspectResetObject(ctx, target); err != nil {
		t.Fatal(err)
	}

	drifted := []byte("drifted-object-bytes")
	if _, err := backend.Save(ctx, storageKey, bytes.NewReader(drifted)); err != nil {
		t.Fatal(err)
	}
	err = owner.DeleteResetObject(ctx, target)
	if ResetCodeOf(err) != ResetCodeObjectDigestMismatch {
		t.Fatalf("DeleteResetObject() error = %v", err)
	}

	reader, _, _, err := backend.Open(ctx, storageKey, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = reader.Close()
	}()
	actual, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual, drifted) {
		t.Fatalf("object bytes = %q, want drifted bytes retained", actual)
	}
}
