package infrastructure_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type recoveryDeviceAccess struct {
	active bool
}

func (a recoveryDeviceAccess) IsActiveDevice(
	_ context.Context,
	_ string,
	_ string,
) (bool, error) {
	return a.active, nil
}

func newRecoveryService(
	t *testing.T,
	active bool,
	maxBytes int,
) (*application.RecoveryService, *infrastructure.RecoveryRepository) {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	repository := infrastructure.NewRecoveryRepository(db)
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	service, err := application.NewRecoveryService(
		repository,
		recoveryDeviceAccess{active: active},
		application.RecoveryPolicy{MaxEncryptedArchiveBytes: maxBytes},
		func() time.Time { return time.Unix(1_700_000_000, 0) },
	)
	if err != nil {
		t.Fatal(err)
	}
	return service, repository
}

func recoveryRequest(revisionID string, bytes []byte) *chat.PutRecoveryRevisionRequest {
	hash := sha256.Sum256(bytes)
	return &chat.PutRecoveryRevisionRequest{
		RevisionId:             revisionID,
		FormatVersion:          1,
		EncryptedArchive:       bytes,
		EncryptedArchiveSha256: hash[:],
	}
}

func TestRecoveryServiceStoresOpaqueRevisionAndReturnsLatestPerActor(t *testing.T) {
	service, _ := newRecoveryService(t, true, 1024)
	ctx := context.Background()
	if _, err := service.Put(
		ctx,
		"ptid:alice",
		"alice-device",
		recoveryRequest("revision-1", []byte("opaque-1")),
	); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Put(
		ctx,
		"ptid:alice",
		"alice-device",
		recoveryRequest("revision-2", []byte("opaque-2")),
	); err != nil {
		t.Fatal(err)
	}
	latest, err := service.GetLatest(ctx, "ptid:alice")
	if err != nil {
		t.Fatal(err)
	}
	if latest.RevisionId != "revision-2" ||
		string(latest.EncryptedArchive) != "opaque-2" {
		t.Fatalf("latest recovery revision = %+v", latest)
	}
	if _, err := service.GetLatest(ctx, "ptid:bob"); !errors.Is(err, messaging.ErrNotFound) {
		t.Fatalf("cross-actor latest error = %v, want ErrNotFound", err)
	}
}

func TestRecoveryRevisionReplayMustBeByteIdentical(t *testing.T) {
	service, _ := newRecoveryService(t, true, 1024)
	ctx := context.Background()
	request := recoveryRequest("revision-1", []byte("opaque"))
	if _, err := service.Put(ctx, "ptid:alice", "alice-device", request); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Put(ctx, "ptid:alice", "alice-device", request); err != nil {
		t.Fatalf("exact replay failed: %v", err)
	}
	conflict := recoveryRequest("revision-1", []byte("different"))
	if _, err := service.Put(ctx, "ptid:alice", "alice-device", conflict); !errors.Is(
		err,
		messaging.ErrRecoveryIntegrity,
	) {
		t.Fatalf("conflicting replay error = %v, want ErrRecoveryIntegrity", err)
	}
}

func TestRecoveryAdmissionFailsClosed(t *testing.T) {
	inactive, _ := newRecoveryService(t, false, 1024)
	if _, err := inactive.Put(
		context.Background(),
		"ptid:alice",
		"revoked-device",
		recoveryRequest("revision-1", []byte("opaque")),
	); !errors.Is(err, application.ErrDeviceUnauthorized) {
		t.Fatalf("revoked device error = %v", err)
	}

	limited, _ := newRecoveryService(t, true, 3)
	if _, err := limited.Put(
		context.Background(),
		"ptid:alice",
		"alice-device",
		recoveryRequest("revision-1", []byte("too large")),
	); !errors.Is(err, messaging.ErrRecoveryTooLarge) {
		t.Fatalf("oversize error = %v", err)
	}

	corrupt := recoveryRequest("revision-2", []byte("opaque"))
	corrupt.EncryptedArchiveSha256[0] ^= 1
	integrity, _ := newRecoveryService(t, true, 1024)
	if _, err := integrity.Put(
		context.Background(),
		"ptid:alice",
		"alice-device",
		corrupt,
	); !errors.Is(err, messaging.ErrRecoveryIntegrity) {
		t.Fatalf("corrupt error = %v", err)
	}
}
