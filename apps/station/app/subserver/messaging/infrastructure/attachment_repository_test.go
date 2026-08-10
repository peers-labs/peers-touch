package infrastructure_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newAttachmentRepository(t *testing.T) *infrastructure.AttachmentRepository {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:messaging-attachment-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	repository := infrastructure.NewAttachmentRepository(db)
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	return repository
}

func attachmentUploadFixture(now time.Time) *messaging.AttachmentUpload {
	return &messaging.AttachmentUpload{
		UploadID:       "upload-1",
		Generation:     1,
		ConversationID: "conversation-1",
		MessageID:      "message-1",
		AttachmentID:   "attachment-1",
		Uploader:       &chat.CryptoEndpoint{Ptid: "alice", DeviceId: "alice-device"},
		Object: &chat.EncryptedObjectUploadSpec{
			CiphertextSize:   uint64(messaging.AttachmentChunkSize) + 33,
			CiphertextSha256: make([]byte, 32),
			MediaType:        "application/octet-stream",
			ChunkSize:        messaging.AttachmentChunkSize,
			ChunkCount:       2,
			EncryptionSuite:  chat.AttachmentEncryptionSuite_ATTACHMENT_ENCRYPTION_SUITE_AES_256_GCM_CHUNKED,
			TagSize:          messaging.AttachmentTagSize,
			NonceStrategy:    chat.AttachmentNonceStrategy_ATTACHMENT_NONCE_STRATEGY_COUNTER32_BE,
			ChunkCiphertextSha256: [][]byte{
				make([]byte, 32),
				make([]byte, 32),
			},
		},
		DescriptorCommitmentSHA256: make([]byte, 32),
		IdempotencyKey:             "idempotency-1",
		State:                      chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_QUEUED,
		ReceivedChunkBitmap:        []byte{0},
		ExpiresAt:                  now.Add(time.Hour),
		CreatedAt:                  now,
		UpdatedAt:                  now,
	}
}

func TestAttachmentRepositoryExactReplayConflictFinalizeAndGrant(t *testing.T) {
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	repository := newAttachmentRepository(t)
	upload := attachmentUploadFixture(now)

	created, inserted, err := repository.CreateUpload(ctx, upload)
	if err != nil || !inserted || created.UploadID != upload.UploadID {
		t.Fatalf("create upload: inserted=%v upload=%+v err=%v", inserted, created, err)
	}
	replayed, inserted, err := repository.CreateUpload(ctx, attachmentUploadFixture(now))
	if err != nil || inserted || replayed.UploadID != upload.UploadID {
		t.Fatalf("replay upload: inserted=%v upload=%+v err=%v", inserted, replayed, err)
	}
	conflicting := attachmentUploadFixture(now)
	conflicting.MessageID = "message-conflict"
	if _, _, err := repository.CreateUpload(ctx, conflicting); !errors.Is(err, messaging.ErrAttachmentConflict) {
		t.Fatalf("conflicting begin error = %v", err)
	}

	part := &messaging.AttachmentPart{
		UploadID:         upload.UploadID,
		Generation:       upload.Generation,
		ChunkIndex:       0,
		ByteOffset:       0,
		CiphertextSize:   uint64(messaging.AttachmentChunkSize + messaging.AttachmentTagSize),
		CiphertextSHA256: make([]byte, 32),
		StorageKey:       "uploads/part-0",
		CreatedAt:        now,
	}
	duplicate, err := repository.PutPart(ctx, part)
	if err != nil || duplicate {
		t.Fatalf("put part: duplicate=%v err=%v", duplicate, err)
	}
	duplicate, err = repository.PutPart(ctx, part)
	if err != nil || !duplicate {
		t.Fatalf("replay part: duplicate=%v err=%v", duplicate, err)
	}
	conflictingPart := *part
	conflictingPart.CiphertextSHA256 = make([]byte, 32)
	conflictingPart.CiphertextSHA256[0] = 1
	if _, err := repository.PutPart(ctx, &conflictingPart); !errors.Is(err, messaging.ErrAttachmentConflict) {
		t.Fatalf("conflicting part error = %v", err)
	}

	descriptor := &chat.EncryptedObjectDescriptor{
		ObjectId:              "object-1",
		StorageRef:            "opaque-ref-1",
		CiphertextSize:        upload.Object.CiphertextSize,
		CiphertextSha256:      upload.Object.CiphertextSha256,
		MediaType:             upload.Object.MediaType,
		ChunkSize:             upload.Object.ChunkSize,
		ChunkCount:            upload.Object.ChunkCount,
		EncryptionSuite:       upload.Object.EncryptionSuite,
		TagSize:               upload.Object.TagSize,
		NonceStrategy:         upload.Object.NonceStrategy,
		ChunkCiphertextSha256: upload.Object.ChunkCiphertextSha256,
	}
	object := &messaging.AttachmentObject{
		Descriptor:     descriptor,
		StorageKey:     "objects/opaque-ref-1",
		UploaderPTID:   "alice",
		ConversationID: upload.ConversationID,
		MessageID:      upload.MessageID,
		CreatedAt:      now,
	}
	if err := repository.CompleteUpload(ctx, upload.UploadID, upload.Generation, object, now); err != nil {
		t.Fatal(err)
	}
	if err := repository.GrantMessageObjects(
		ctx,
		upload.ConversationID,
		upload.MessageID,
		"alice",
		[]*chat.EncryptedObjectDescriptor{descriptor},
		[]string{"alice", "bob"},
		now,
	); err != nil {
		t.Fatal(err)
	}
	granted, err := repository.GetGrantedObject(ctx, upload.ConversationID, descriptor.ObjectId, "bob")
	if err != nil || granted.Descriptor.ObjectId != descriptor.ObjectId {
		t.Fatalf("granted object = %+v, err = %v", granted, err)
	}
	if _, err := repository.GetGrantedObject(
		ctx,
		upload.ConversationID,
		descriptor.ObjectId,
		"carol",
	); !errors.Is(err, messaging.ErrAttachmentNotGranted) {
		t.Fatalf("ungranted object error = %v", err)
	}
}

func TestAttachmentRepositoryEnforcesActiveUploadQuotaAfterExactReplay(t *testing.T) {
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	repository := newAttachmentRepository(t)
	var first *messaging.AttachmentUpload
	for index := 0; index < messaging.AttachmentMaxActiveUploads; index++ {
		upload := attachmentUploadFixture(now)
		upload.UploadID = uuid.NewString()
		upload.IdempotencyKey = uuid.NewString()
		upload.AttachmentID = uuid.NewString()
		created, inserted, err := repository.CreateUpload(ctx, upload)
		if err != nil || !inserted {
			t.Fatalf("upload %d inserted=%v err=%v", index, inserted, err)
		}
		if index == 0 {
			first = upload
			if created.UploadID != upload.UploadID {
				t.Fatal("created upload identity mismatch")
			}
		}
	}
	replayed, inserted, err := repository.CreateUpload(ctx, first)
	if err != nil || inserted || replayed.UploadID != first.UploadID {
		t.Fatalf("exact replay inserted=%v upload=%+v err=%v", inserted, replayed, err)
	}
	excess := attachmentUploadFixture(now)
	excess.UploadID = uuid.NewString()
	excess.IdempotencyKey = uuid.NewString()
	excess.AttachmentID = uuid.NewString()
	if _, _, err := repository.CreateUpload(ctx, excess); !errors.Is(err, messaging.ErrAttachmentQuota) {
		t.Fatalf("excess upload error = %v", err)
	}
}
