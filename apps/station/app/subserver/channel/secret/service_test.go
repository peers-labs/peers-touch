package secret

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
)

func openTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", name)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func newTestService(t *testing.T, kek string) (*Service, *gorm.DB) {
	t.Helper()
	db := openTestDB(t, "channel-secret-"+t.Name())
	svc := NewService(db, StaticKEKProvider{Material: []byte(kek)})
	return svc, db
}

func TestPutGetRoundTrip(t *testing.T) {
	svc, _ := newTestService(t, "unit-test-kek-0123456789abcdef")
	ctx := context.Background()

	id, err := svc.Put(ctx, PutInput{
		ActorPTID: "actor-a",
		Purpose:   PurposeChannel,
		Name:      "lark-app",
		Plaintext: []byte("super-secret"),
	})
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	got, err := svc.Get(ctx, "actor-a", PurposeChannel, id)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if string(got) != "super-secret" {
		t.Fatalf("plaintext mismatch: %q", string(got))
	}
}

func TestAtRestIsCiphertextOnly(t *testing.T) {
	svc, db := newTestService(t, "unit-test-kek-0123456789abcdef")
	secret := []byte("plaintext-marker-xyz")
	if _, err := svc.Put(context.Background(), PutInput{
		ActorPTID: "actor-a", Purpose: PurposeChannel, Name: "n", Plaintext: secret,
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	var row persistence.ChannelSecret
	if err := db.First(&row).Error; err != nil {
		t.Fatalf("load row: %v", err)
	}
	for _, blob := range [][]byte{row.Ciphertext, row.WrappedDEK} {
		if strings.Contains(string(blob), string(secret)) {
			t.Fatal("secret plaintext leaked into encrypted columns")
		}
	}
	if len(row.Nonce) == 0 || row.KEKVersion == "" {
		t.Fatal("nonce and KEK version must be persisted")
	}
}

func TestActorIsolation(t *testing.T) {
	svc, _ := newTestService(t, "unit-test-kek-0123456789abcdef")
	ctx := context.Background()
	id, err := svc.Put(ctx, PutInput{
		ActorPTID: "actor-a", Purpose: PurposeAgentRuntime, Name: "codex", Plaintext: []byte("a-key"),
	})
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if _, err := svc.Get(ctx, "actor-b", PurposeAgentRuntime, id); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("cross-actor read must be ErrSecretNotFound, got %v", err)
	}
	if err := svc.Delete(ctx, "actor-b", PurposeAgentRuntime, id); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("cross-actor delete must be ErrSecretNotFound, got %v", err)
	}
}

func TestPurposeIsolation(t *testing.T) {
	svc, _ := newTestService(t, "unit-test-kek-0123456789abcdef")
	ctx := context.Background()
	id, err := svc.Put(ctx, PutInput{
		ActorPTID: "actor-a", Purpose: PurposeChannel, Name: "x", Plaintext: []byte("c"),
	})
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if _, err := svc.Get(ctx, "actor-a", PurposeAgentRuntime, id); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("cross-purpose read must fail, got %v", err)
	}
}

func TestRestartSurvivesNewServiceInstance(t *testing.T) {
	db := openTestDB(t, "channel-secret-restart")
	kek := StaticKEKProvider{Material: []byte("unit-test-kek-0123456789abcdef")}
	ctx := context.Background()

	id, err := NewService(db, kek).Put(ctx, PutInput{
		ActorPTID: "actor-a", Purpose: PurposeChannel, Name: "n", Plaintext: []byte("persisted"),
	})
	if err != nil {
		t.Fatalf("Put: %v", err)
	}

	// Simulate Station restart: brand-new service over the same DB and KEK.
	got, err := NewService(db, kek).Get(ctx, "actor-a", PurposeChannel, id)
	if err != nil {
		t.Fatalf("Get after restart: %v", err)
	}
	if string(got) != "persisted" {
		t.Fatalf("plaintext mismatch after restart: %q", string(got))
	}
}

func TestPutUpsertKeepsActorIsolation(t *testing.T) {
	svc, db := newTestService(t, "unit-test-kek-0123456789abcdef")
	ctx := context.Background()
	in := PutInput{ActorPTID: "actor-a", Purpose: PurposeChannel, Name: "dup", Plaintext: []byte("v1")}
	id1, err := svc.Put(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	in.Plaintext = []byte("v2")
	id2, err := svc.Put(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if id1 != id2 {
		t.Fatal("re-put must update the same record")
	}
	var count int64
	db.Model(&persistence.ChannelSecret{}).Count(&count)
	if count != 1 {
		t.Fatalf("expected one row, got %d", count)
	}
	got, _ := svc.Get(ctx, "actor-a", PurposeChannel, id1)
	if string(got) != "v2" {
		t.Fatalf("expected updated value v2, got %q", string(got))
	}
}

func TestRotateKEKReWrapsAllRows(t *testing.T) {
	db := openTestDB(t, "channel-secret-rotate")
	old := StaticKEKProvider{Material: []byte("unit-test-kek-0123456789abcdef")}
	next := StaticKEKProvider{Material: []byte("unit-test-kek-fedcba9876543210")}
	ctx := context.Background()
	svc := NewService(db, old)

	in := PutInput{ActorPTID: "actor-a", Purpose: PurposeChannel, Name: "n", Plaintext: []byte("rotate-me")}
	id, err := svc.Put(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	n, err := svc.RotateKEK(ctx, next)
	if err != nil {
		t.Fatalf("RotateKEK: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 rotated row, got %d", n)
	}

	// Old KEK can no longer open the record; new KEK can.
	rotated := NewService(db, next)
	got, err := rotated.Get(ctx, "actor-a", PurposeChannel, id)
	if err != nil {
		t.Fatalf("Get with new KEK: %v", err)
	}
	if string(got) != "rotate-me" {
		t.Fatalf("plaintext mismatch: %q", string(got))
	}
	if _, err := NewService(db, old).Get(ctx, "actor-a", PurposeChannel, id); !errors.Is(err, ErrKEKVersionMismatch) {
		t.Fatalf("old KEK must fail after rotation, got %v", err)
	}

	// Rotation is idempotent when already on the target KEK.
	n2, err := rotated.RotateKEK(ctx, next)
	if err != nil || n2 != 0 {
		t.Fatalf("re-run rotation should be a no-op, got n=%d err=%v", n2, err)
	}
}

func TestListOmitsCiphertext(t *testing.T) {
	svc, _ := newTestService(t, "unit-test-kek-0123456789abcdef")
	ctx := context.Background()
	if _, err := svc.Put(ctx, PutInput{
		ActorPTID: "actor-a", Purpose: PurposeChannel, Name: "n", Plaintext: []byte("secret"),
	}); err != nil {
		t.Fatal(err)
	}
	metas, err := svc.List(ctx, "actor-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(metas) != 1 || metas[0].Name != "n" || metas[0].Purpose != PurposeChannel {
		t.Fatalf("unexpected metadata: %+v", metas)
	}
}
