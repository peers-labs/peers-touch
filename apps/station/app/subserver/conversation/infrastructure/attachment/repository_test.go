package attachment_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	attachmentapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/attachment"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/attachment"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRepositoryOwnsOnlyCanonicalAttachmentTablesWithoutPlaintextColumns(t *testing.T) {
	database := newRepositoryDatabase(t)
	repository, err := attachment.NewRepository(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}

	canonical := []any{
		&attachment.UploadModel{},
		&attachment.UploadPartModel{},
		&attachment.ObjectModel{},
		&attachment.GrantModel{},
		&attachment.AuditModel{},
	}
	for _, model := range canonical {
		if !database.Migrator().HasTable(model) {
			t.Fatalf("canonical table for %T is missing", model)
		}
		for _, forbidden := range []string{
			"filename",
			"mime_type",
			"plaintext_size",
			"plaintext_sha256",
			"object_key",
			"base_nonce",
			"plaintext",
		} {
			if database.Migrator().HasColumn(model, forbidden) {
				t.Fatalf("%T exposes forbidden plaintext column %q", model, forbidden)
			}
		}
	}
	for _, retired := range []string{
		"messaging_attachment_uploads",
		"messaging_attachment_upload_parts",
		"messaging_attachment_objects",
		"messaging_attachment_grants",
		"messaging_attachment_audit",
	} {
		if database.Migrator().HasTable(retired) {
			t.Fatalf("retired attachment table %q was created", retired)
		}
	}
}

func TestRepositoryGrantIsImmutableAndIdempotent(t *testing.T) {
	database := newRepositoryDatabase(t)
	repository, err := attachment.NewRepository(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.September, 6, 15, 0, 0, 0, time.UTC)
	hash := valueobject.HashBytes([]byte("ciphertext"))
	commitment := valueobject.HashBytes([]byte("descriptor"))
	if err := database.Create(&attachment.ObjectModel{
		ObjectID:                   "object-1",
		StorageRef:                 "storage-1",
		StorageKey:                 "conversation-attachments/objects/storage-1",
		ConversationID:             "conversation-1",
		MessageID:                  "message-1",
		AttachmentID:               "attachment-1",
		UploaderPTID:               "ptid:alice",
		CiphertextSize:             uint64(attachmentapp.TagSize + 1),
		CiphertextSHA256:           hash.Bytes(),
		MediaType:                  "application/octet-stream",
		ChunkSize:                  attachmentapp.ChunkSize,
		ChunkCount:                 1,
		EncryptionSuite:            int32(attachmentapp.EncryptionSuiteAES256GCMChunked),
		TagSize:                    attachmentapp.TagSize,
		NonceStrategy:              int32(attachmentapp.NonceStrategyCounter32BE),
		ChunkCiphertextSHA256:      hash.Bytes(),
		DescriptorCommitmentSHA256: commitment.Bytes(),
		State:                      string(attachmentapp.ObjectStateCompleteUnattached),
		CreatedAt:                  now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	grant := ports.ObjectGrant{
		ObjectID:       "object-1",
		ConversationID: "conversation-1",
		EventID:        "event-1",
		Recipient:      "ptid:bob",
		GrantedAt:      now,
	}
	for range 2 {
		if err := repository.Grant(context.Background(), grant); err != nil {
			t.Fatal(err)
		}
	}
	conflict := grant
	conflict.EventID = "event-2"
	if err := repository.Grant(context.Background(), conflict); !attachmentapp.IsCode(
		err,
		attachmentapp.ErrorCodeInvalidState,
	) && !attachmentapp.IsCode(err, attachmentapp.ErrorCodePartConflict) {
		t.Fatalf("conflicting grant error = %v", err)
	}
	granted, err := repository.GetGrantedObject(
		context.Background(),
		"conversation-1",
		"object-1",
		"ptid:bob",
	)
	if err != nil {
		t.Fatal(err)
	}
	if granted.EventID != "event-1" ||
		granted.State != attachmentapp.ObjectStateAttached {
		t.Fatalf("granted object = %+v", granted)
	}
}

func newRepositoryDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(
		sqlite.Open(
			"file:conversation-attachment-repository-"+uuid.NewString()+
				"?mode=memory&cache=shared&_busy_timeout=5000",
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
	sqlDatabase.SetMaxOpenConns(1)
	t.Cleanup(func() {
		_ = sqlDatabase.Close()
	})

	return database
}
