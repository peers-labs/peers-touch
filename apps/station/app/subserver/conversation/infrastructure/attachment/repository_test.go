package attachment_test

import (
	"bytes"
	"context"
	"fmt"
	"sync"
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
	for _, column := range []string{
		"expires_at",
		"cleanup_lease_owner",
		"cleanup_lease_expires_at",
		"cleanup_attempt_count",
		"cleanup_next_attempt_at",
		"cleanup_completed_at",
	} {
		if !database.Migrator().HasColumn(&attachment.ObjectModel{}, column) {
			t.Fatalf("attachment object lifecycle column %q is missing", column)
		}
	}
	for _, column := range []string{
		"verification_token",
		"verification_storage_key",
		"verification_started_at",
		"verification_lease_expires_at",
		"verification_attempt_count",
		"cleanup_lease_owner",
		"cleanup_lease_expires_at",
		"cleanup_attempt_count",
		"cleanup_next_attempt_at",
		"cleanup_completed_at",
	} {
		if !database.Migrator().HasColumn(&attachment.UploadModel{}, column) {
			t.Fatalf("attachment upload lifecycle column %q is missing", column)
		}
	}
	if !database.Migrator().HasColumn(&attachment.GrantModel{}, "uploader_ptid") {
		t.Fatal("attachment grant uploader binding is missing")
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

func TestRepositoryGrantBatchIsAtomicExactAndIdempotent(t *testing.T) {
	database := newRepositoryDatabase(t)
	repository, err := attachment.NewRepository(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.September, 6, 15, 0, 0, 0, time.UTC)
	first := seedGrantObject(t, database, now, "first", "message-1", "ptid:alice", 32)
	second := seedGrantObject(t, database, now, "second", "message-1", "ptid:alice", 48)
	grant := ports.ObjectGrantBatch{
		ConversationID: "conversation-1",
		MessageID:      "message-1",
		Uploader:       "ptid:alice",
		EventID:        "event-1",
		ObjectIDs:      []valueobject.ObjectID{second.ObjectID, first.ObjectID},
		Recipients:     []valueobject.PTID{"ptid:carol", "ptid:bob"},
		GrantedAt:      now,
	}
	for range 2 {
		if err := repository.GrantBatch(context.Background(), grant); err != nil {
			t.Fatal(err)
		}
	}
	conflict := grant
	conflict.EventID = "event-2"
	if err := repository.GrantBatch(context.Background(), conflict); !attachmentapp.IsCode(
		err,
		attachmentapp.ErrorCodePartConflict,
	) {
		t.Fatalf("conflicting grant error = %v", err)
	}
	granted, err := repository.GetGrantedObject(
		context.Background(),
		"conversation-1",
		first.ObjectID,
		"ptid:bob",
	)
	if err != nil {
		t.Fatal(err)
	}
	if granted.EventID != "event-1" ||
		granted.State != attachmentapp.ObjectStateAttached {
		t.Fatalf("granted object = %+v", granted)
	}
	var grantCount int64
	if err := database.Model(&attachment.GrantModel{}).
		Where("event_id = ?", "event-1").
		Count(&grantCount).Error; err != nil {
		t.Fatal(err)
	}
	if grantCount != 4 {
		t.Fatalf("exact grant rows = %d, want 4", grantCount)
	}

	expired := seedGrantObject(
		t,
		database,
		now.Add(-time.Hour),
		"expired",
		"message-expired",
		"ptid:alice",
		1,
	)
	if err := database.Model(&attachment.ObjectModel{}).
		Where("object_id = ?", string(expired.ObjectID)).
		Updates(map[string]any{
			"expires_at":              now,
			"cleanup_next_attempt_at": now,
		}).Error; err != nil {
		t.Fatal(err)
	}
	expiredGrant := grant
	expiredGrant.MessageID = "message-expired"
	expiredGrant.ObjectIDs = []valueobject.ObjectID{expired.ObjectID}
	expiredGrant.Recipients = []valueobject.PTID{"ptid:bob"}
	expiredGrant.EventID = "event-expired"
	expiredGrant.GrantedAt = now
	if err := repository.GrantBatch(
		context.Background(),
		expiredGrant,
	); !attachmentapp.IsCode(err, attachmentapp.ErrorCodeUploadExpired) {
		t.Fatalf("expired object grant error = %v", err)
	}

	atomic := seedGrantObject(t, database, now, "atomic", "message-atomic", "ptid:alice", 8)
	mismatch := seedGrantObject(t, database, now, "mismatch", "message-other", "ptid:alice", 8)
	atomicGrant := ports.ObjectGrantBatch{
		ConversationID: "conversation-1",
		MessageID:      "message-atomic",
		Uploader:       "ptid:alice",
		EventID:        "event-atomic",
		ObjectIDs:      []valueobject.ObjectID{atomic.ObjectID, mismatch.ObjectID},
		Recipients:     []valueobject.PTID{"ptid:bob"},
		GrantedAt:      now,
	}
	if err := repository.GrantBatch(
		context.Background(),
		atomicGrant,
	); !attachmentapp.IsCode(err, attachmentapp.ErrorCodePartConflict) {
		t.Fatalf("mixed-message grant error = %v", err)
	}
	var partialCount int64
	if err := database.Model(&attachment.GrantModel{}).
		Where("event_id = ?", "event-atomic").
		Count(&partialCount).Error; err != nil {
		t.Fatal(err)
	}
	if partialCount != 0 {
		t.Fatalf("failed batch left %d partial grants", partialCount)
	}
	var unchanged attachment.ObjectModel
	if err := database.First(&unchanged, "object_id = ?", string(atomic.ObjectID)).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.State != string(attachmentapp.ObjectStateCompleteUnattached) ||
		unchanged.EventID != "" {
		t.Fatalf("failed batch mutated valid object: %+v", unchanged)
	}

	recipientMismatch := grant
	recipientMismatch.Recipients = []valueobject.PTID{"ptid:bob"}
	if err := repository.GrantBatch(
		context.Background(),
		recipientMismatch,
	); !attachmentapp.IsCode(err, attachmentapp.ErrorCodePartConflict) {
		t.Fatalf("non-exact recipient replay error = %v", err)
	}

	largeA := seedGrantObject(
		t,
		database,
		now,
		"large-a",
		"message-large",
		"ptid:alice",
		attachmentapp.MaximumPlaintextSize/2+1,
	)
	largeB := seedGrantObject(
		t,
		database,
		now,
		"large-b",
		"message-large",
		"ptid:alice",
		attachmentapp.MaximumPlaintextSize/2+1,
	)
	if err := repository.GrantBatch(context.Background(), ports.ObjectGrantBatch{
		ConversationID: "conversation-1",
		MessageID:      "message-large",
		Uploader:       "ptid:alice",
		EventID:        "event-large",
		ObjectIDs:      []valueobject.ObjectID{largeA.ObjectID, largeB.ObjectID},
		Recipients:     []valueobject.PTID{"ptid:bob"},
		GrantedAt:      now,
	}); !attachmentapp.IsCode(err, attachmentapp.ErrorCodeQuotaExceeded) {
		t.Fatalf("aggregate plaintext quota error = %v", err)
	}

	tooMany := make([]valueobject.ObjectID, attachmentapp.MaximumMessageObjects+1)
	for index := range tooMany {
		tooMany[index] = valueobject.ObjectID(fmt.Sprintf("too-many-%02d", index))
	}
	if err := repository.GrantBatch(context.Background(), ports.ObjectGrantBatch{
		ConversationID: "conversation-1",
		MessageID:      "message-too-many",
		Uploader:       "ptid:alice",
		EventID:        "event-too-many",
		ObjectIDs:      tooMany,
		Recipients:     []valueobject.PTID{"ptid:bob"},
		GrantedAt:      now,
	}); !attachmentapp.IsCode(err, attachmentapp.ErrorCodeInvalidArgument) {
		t.Fatalf("object count bound error = %v", err)
	}
}

func TestRepositoryCleanupLeaseFencingRetryAndReplay(t *testing.T) {
	database := newRepositoryDatabase(t)
	repository, err := attachment.NewRepository(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.September, 6, 16, 0, 0, 0, time.UTC)
	cleanupObjectID := seedCleanupObject(t, database, now)

	type claimResult struct {
		claims []attachmentapp.CleanupClaim
		err    error
	}
	start := make(chan struct{})
	results := make(chan claimResult, 8)
	var workers sync.WaitGroup
	for index := 0; index < 8; index++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			<-start
			claims, claimErr := repository.ClaimExpiredUnattachedObjects(
				context.Background(),
				now,
				fmt.Sprintf("cleanup-worker-%d", index),
				time.Minute,
				1,
			)
			results <- claimResult{claims: claims, err: claimErr}
		}(index)
	}
	close(start)
	workers.Wait()
	close(results)

	var first attachmentapp.CleanupClaim
	var claimed int
	for result := range results {
		if result.err != nil {
			t.Fatal(result.err)
		}
		claimed += len(result.claims)
		if len(result.claims) == 1 {
			first = result.claims[0]
		}
	}
	if claimed != 1 || first.Attempt != 1 {
		t.Fatalf("concurrent cleanup claims=%d first=%+v", claimed, first)
	}

	retryAt := now.Add(attachmentapp.MinimumCleanupRetryDelay)
	retry, err := repository.RetryObjectCleanup(
		context.Background(),
		first,
		now,
		retryAt,
	)
	if err != nil || retry.Replay || retry.Terminal {
		t.Fatalf("first retry transition result=%+v error=%v", retry, err)
	}
	retry, err = repository.RetryObjectCleanup(
		context.Background(),
		first,
		now,
		retryAt,
	)
	if err != nil || !retry.Replay || retry.Terminal {
		t.Fatalf("retry replay result=%+v error=%v", retry, err)
	}
	early, err := repository.ClaimExpiredUnattachedObjects(
		context.Background(),
		retryAt.Add(-time.Nanosecond),
		"cleanup-worker-reclaim",
		time.Minute,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(early) != 0 {
		t.Fatalf("cleanup retry was claimed early: %+v", early)
	}
	reclaimed, err := repository.ClaimExpiredUnattachedObjects(
		context.Background(),
		retryAt,
		"cleanup-worker-reclaim",
		time.Minute,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(reclaimed) != 1 || reclaimed[0].Attempt != 2 {
		t.Fatalf("reclaimed cleanup = %+v", reclaimed)
	}
	if _, err := repository.FinalizeObjectCleanup(
		context.Background(),
		first,
		retryAt.Add(time.Second),
	); !attachmentapp.IsCode(err, attachmentapp.ErrorCodeRetryLater) {
		t.Fatalf("stale cleanup finalize error = %v", err)
	}
	replayed, err := repository.FinalizeObjectCleanup(
		context.Background(),
		reclaimed[0],
		retryAt.Add(time.Second),
	)
	if err != nil || replayed {
		t.Fatalf("cleanup finalize replay=%t error=%v", replayed, err)
	}
	replayed, err = repository.FinalizeObjectCleanup(
		context.Background(),
		reclaimed[0],
		retryAt.Add(time.Second),
	)
	if err != nil || !replayed {
		t.Fatalf("cleanup finalize replay replay=%t error=%v", replayed, err)
	}
	object, err := repository.GetObject(context.Background(), cleanupObjectID)
	if err != nil {
		t.Fatal(err)
	}
	if object.State != attachmentapp.ObjectStateGarbageCollected ||
		object.StorageKey != "" ||
		object.CleanupCompletedAt.IsZero() {
		t.Fatalf("finalized object = %+v", object)
	}

	seedCleanupObjectWithID(t, database, now, "object-abandoned")
	abandoned, err := repository.ClaimExpiredUnattachedObjects(
		context.Background(),
		now,
		"cleanup-worker-abandoned",
		time.Minute,
		1,
	)
	if err != nil || len(abandoned) != 1 {
		t.Fatalf("abandoned cleanup claim = %+v, error=%v", abandoned, err)
	}
	beforeExpiry, err := repository.ClaimExpiredUnattachedObjects(
		context.Background(),
		abandoned[0].LeaseExpiresAt.Add(-time.Nanosecond),
		"cleanup-worker-after-abandon",
		time.Minute,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(beforeExpiry) != 0 {
		t.Fatalf("active cleanup lease was stolen: %+v", beforeExpiry)
	}
	afterExpiry, err := repository.ClaimExpiredUnattachedObjects(
		context.Background(),
		abandoned[0].LeaseExpiresAt,
		"cleanup-worker-after-abandon",
		time.Minute,
		1,
	)
	if err != nil || len(afterExpiry) != 1 || afterExpiry[0].Attempt != 2 {
		t.Fatalf("expired cleanup lease was not reclaimed: %+v, error=%v", afterExpiry, err)
	}

	seedIncompleteUpload(t, database, now, "upload-incomplete")
	uploadClaims, err := repository.ClaimExpiredUploads(
		context.Background(),
		now,
		"upload-cleanup-worker",
		time.Minute,
		1,
	)
	if err != nil || len(uploadClaims) != 1 || len(uploadClaims[0].StorageKeys) != 1 {
		t.Fatalf("incomplete upload claim = %+v, error=%v", uploadClaims, err)
	}
	staleUploadClaim := uploadClaims[0]
	reclaimedUploads, err := repository.ClaimExpiredUploads(
		context.Background(),
		staleUploadClaim.LeaseExpiresAt,
		"upload-cleanup-reclaimer",
		time.Minute,
		1,
	)
	if err != nil || len(reclaimedUploads) != 1 || reclaimedUploads[0].Attempt != 2 {
		t.Fatalf("expired upload lease was not reclaimed: %+v, error=%v", reclaimedUploads, err)
	}
	if _, err := repository.FinalizeUploadCleanup(
		context.Background(),
		staleUploadClaim,
		staleUploadClaim.LeaseExpiresAt,
	); !attachmentapp.IsCode(err, attachmentapp.ErrorCodeRetryLater) {
		t.Fatalf("stale upload cleanup finalize error = %v", err)
	}
	replayed, err = repository.FinalizeUploadCleanup(
		context.Background(),
		reclaimedUploads[0],
		staleUploadClaim.LeaseExpiresAt.Add(time.Second),
	)
	if err != nil || replayed {
		t.Fatalf("upload cleanup finalize replay=%t error=%v", replayed, err)
	}
	replayed, err = repository.FinalizeUploadCleanup(
		context.Background(),
		reclaimedUploads[0],
		staleUploadClaim.LeaseExpiresAt.Add(time.Second),
	)
	if err != nil || !replayed {
		t.Fatalf("upload cleanup replay replay=%t error=%v", replayed, err)
	}
	cleanedUpload, err := repository.GetUpload(
		context.Background(),
		"upload-incomplete",
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if cleanedUpload.State != attachmentapp.TransferStateTerminal ||
		cleanedUpload.VerificationStorageKey != "" ||
		cleanedUpload.CleanupCompletedAt.IsZero() {
		t.Fatalf("finalized incomplete upload = %+v", cleanedUpload)
	}

	seedIncompleteUpload(t, database, now, "upload-terminal")
	if err := database.Model(&attachment.UploadModel{}).
		Where("upload_id = ?", "upload-terminal").
		Update(
			"cleanup_attempt_count",
			attachmentapp.MaximumCleanupAttemptCount-1,
		).Error; err != nil {
		t.Fatal(err)
	}
	terminalClaims, err := repository.ClaimExpiredUploads(
		context.Background(),
		now,
		"upload-cleanup-terminal",
		time.Minute,
		1,
	)
	if err != nil || len(terminalClaims) != 1 ||
		terminalClaims[0].Attempt != attachmentapp.MaximumCleanupAttemptCount {
		t.Fatalf("terminal cleanup claim = %+v, error=%v", terminalClaims, err)
	}
	terminalRetry, err := repository.RetryUploadCleanup(
		context.Background(),
		terminalClaims[0],
		now,
		now.Add(attachmentapp.MaximumCleanupRetryDelay),
	)
	if err != nil || !terminalRetry.Terminal {
		t.Fatalf("terminal cleanup retry = %+v, error=%v", terminalRetry, err)
	}
	terminalUpload, err := repository.GetUpload(
		context.Background(),
		"upload-terminal",
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if terminalUpload.State != attachmentapp.TransferStateCleanupFailed ||
		!terminalUpload.CleanupCompletedAt.IsZero() {
		t.Fatalf("terminal cleanup state = %+v", terminalUpload)
	}

	for index := 0; index < 3; index++ {
		seedIncompleteUpload(
			t,
			database,
			now,
			fmt.Sprintf("upload-bounded-%d", index),
		)
	}
	bounded, err := repository.ClaimExpiredUploads(
		context.Background(),
		now,
		"upload-cleanup-bounded",
		time.Minute,
		2,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(bounded) != 2 {
		t.Fatalf("bounded cleanup claimed %d uploads", len(bounded))
	}
}

func seedGrantObject(
	t *testing.T,
	database *gorm.DB,
	now time.Time,
	suffix string,
	messageID valueobject.MessageID,
	uploader valueobject.PTID,
	plaintextSize uint64,
) attachmentapp.Object {
	t.Helper()
	uploadID := "upload-" + suffix
	commitment := valueobject.HashBytes([]byte("descriptor-" + suffix))
	hash := valueobject.HashBytes(bytes.Repeat([]byte{byte(len(suffix) + 1)}, 32))
	objectID, storageRef, _ := attachmentapp.ImmutableObjectIdentity(
		uploadID,
		commitment,
	)
	chunkCount := uint32(
		(plaintextSize + uint64(attachmentapp.ChunkSize) - 1) /
			uint64(attachmentapp.ChunkSize),
	)
	if chunkCount == 0 {
		chunkCount = 1
	}
	ciphertextSize := plaintextSize + uint64(chunkCount)*uint64(attachmentapp.TagSize)
	chunkHashes := make([]valueobject.Hash, chunkCount)
	encodedChunkHashes := make([]byte, 0, int(chunkCount)*len(hash))
	for index := range chunkHashes {
		chunkHashes[index] = hash
		encodedChunkHashes = append(encodedChunkHashes, hash.Bytes()...)
	}
	createdAt := now.Add(-time.Minute)
	expiresAt := now.Add(time.Hour)
	verificationExpiresAt := createdAt.Add(10 * time.Minute)
	verificationToken := attachmentapp.VerificationToken(
		uploadID,
		1,
		commitment,
		1,
	)
	storageKey := attachmentapp.VerificationObjectStorageKey(
		storageRef,
		verificationToken,
	)
	if err := database.Create(&attachment.UploadModel{
		UploadID:                   uploadID,
		Generation:                 1,
		ConversationID:             "conversation-1",
		MessageID:                  string(messageID),
		AttachmentID:               "attachment-" + suffix,
		UploaderPTID:               string(uploader),
		UploaderDeviceID:           "device-1",
		CiphertextSize:             ciphertextSize,
		CiphertextSHA256:           hash.Bytes(),
		MediaType:                  "application/octet-stream",
		ChunkSize:                  attachmentapp.ChunkSize,
		ChunkCount:                 chunkCount,
		EncryptionSuite:            int32(attachmentapp.EncryptionSuiteAES256GCMChunked),
		TagSize:                    attachmentapp.TagSize,
		NonceStrategy:              int32(attachmentapp.NonceStrategyCounter32BE),
		ChunkCiphertextSHA256:      encodedChunkHashes,
		DescriptorCommitmentSHA256: commitment.Bytes(),
		IdempotencyKey:             "idempotency-" + suffix,
		State:                      int32(attachmentapp.TransferStateComplete),
		ReceivedChunkBitmap:        make([]byte, (chunkCount+7)/8),
		ObjectID:                   string(objectID),
		StorageRef:                 storageRef,
		VerificationToken:          verificationToken,
		VerificationStorageKey:     storageKey,
		VerificationStartedAt:      &createdAt,
		VerificationLeaseExpiresAt: &verificationExpiresAt,
		VerificationAttemptCount:   1,
		ExpiresAt:                  expiresAt,
		CleanupNextAttemptAt:       expiresAt,
		CreatedAt:                  createdAt,
		UpdatedAt:                  createdAt,
	}).Error; err != nil {
		t.Fatal(err)
	}
	model := attachment.ObjectModel{
		ObjectID:                   string(objectID),
		StorageRef:                 storageRef,
		StorageKey:                 storageKey,
		ConversationID:             "conversation-1",
		MessageID:                  string(messageID),
		AttachmentID:               "attachment-" + suffix,
		UploaderPTID:               string(uploader),
		CiphertextSize:             ciphertextSize,
		CiphertextSHA256:           hash.Bytes(),
		MediaType:                  "application/octet-stream",
		ChunkSize:                  attachmentapp.ChunkSize,
		ChunkCount:                 chunkCount,
		EncryptionSuite:            int32(attachmentapp.EncryptionSuiteAES256GCMChunked),
		TagSize:                    attachmentapp.TagSize,
		NonceStrategy:              int32(attachmentapp.NonceStrategyCounter32BE),
		ChunkCiphertextSHA256:      encodedChunkHashes,
		DescriptorCommitmentSHA256: commitment.Bytes(),
		State:                      string(attachmentapp.ObjectStateCompleteUnattached),
		ExpiresAt:                  expiresAt,
		CleanupNextAttemptAt:       expiresAt,
		CreatedAt:                  createdAt,
	}
	if err := database.Create(&model).Error; err != nil {
		t.Fatal(err)
	}

	return attachmentapp.Object{
		ObjectID:       objectID,
		StorageRef:     storageRef,
		StorageKey:     storageKey,
		ConversationID: "conversation-1",
		MessageID:      messageID,
		AttachmentID:   model.AttachmentID,
		Uploader:       uploader,
		Spec: attachmentapp.UploadSpec{
			CiphertextSize: ciphertextSize,
			CiphertextHash: hash,
			MediaType:      "application/octet-stream",
			ChunkSize:      attachmentapp.ChunkSize,
			ChunkCount:     chunkCount,
			Encryption:     attachmentapp.EncryptionSuiteAES256GCMChunked,
			TagSize:        attachmentapp.TagSize,
			NonceStrategy:  attachmentapp.NonceStrategyCounter32BE,
			ChunkHashes:    chunkHashes,
		},
		DescriptorCommitment: commitment,
		State:                attachmentapp.ObjectStateCompleteUnattached,
		ExpiresAt:            expiresAt,
		CleanupNextAttemptAt: expiresAt,
		CreatedAt:            createdAt,
	}
}

func seedCleanupObject(
	t *testing.T,
	database *gorm.DB,
	now time.Time,
) valueobject.ObjectID {
	t.Helper()

	return seedCleanupObjectWithID(t, database, now, "cleanup")
}

func seedCleanupObjectWithID(
	t *testing.T,
	database *gorm.DB,
	now time.Time,
	suffix string,
) valueobject.ObjectID {
	t.Helper()
	hash := valueobject.HashBytes([]byte("cleanup-ciphertext"))
	commitment := valueobject.HashBytes([]byte("cleanup-descriptor-" + suffix))
	uploadID := "upload-" + suffix
	objectID, storageRef, _ := attachmentapp.ImmutableObjectIdentity(
		uploadID,
		commitment,
	)
	expiresAt := now.Add(-time.Minute)
	verificationStartedAt := now.Add(-time.Hour)
	verificationExpiresAt := verificationStartedAt.Add(10 * time.Minute)
	verificationToken := attachmentapp.VerificationToken(
		uploadID,
		1,
		commitment,
		1,
	)
	objectStorageKey := attachmentapp.VerificationObjectStorageKey(
		storageRef,
		verificationToken,
	)
	if err := database.Create(&attachment.UploadModel{
		UploadID:                   uploadID,
		Generation:                 1,
		ConversationID:             "conversation-1",
		MessageID:                  "message-cleanup",
		AttachmentID:               "attachment-cleanup",
		UploaderPTID:               "ptid:alice",
		UploaderDeviceID:           "device-1",
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
		IdempotencyKey:             "idempotency-" + string(objectID),
		State:                      int32(attachmentapp.TransferStateComplete),
		ReceivedChunkBitmap:        []byte{1},
		ObjectID:                   string(objectID),
		StorageRef:                 storageRef,
		VerificationToken:          verificationToken,
		VerificationStorageKey:     objectStorageKey,
		VerificationStartedAt:      &verificationStartedAt,
		VerificationLeaseExpiresAt: &verificationExpiresAt,
		VerificationAttemptCount:   1,
		ExpiresAt:                  expiresAt,
		CleanupNextAttemptAt:       expiresAt,
		CreatedAt:                  now.Add(-time.Hour),
		UpdatedAt:                  now.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&attachment.UploadPartModel{
		UploadID:         uploadID,
		Generation:       1,
		ChunkIndex:       0,
		ByteOffset:       0,
		CiphertextSize:   uint64(attachmentapp.TagSize + 1),
		CiphertextSHA256: hash.Bytes(),
		StorageKey: attachmentapp.ImmutablePartStorageKey(
			uploadID,
			1,
			0,
			hash,
		),
		CreatedAt: now.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&attachment.ObjectModel{
		ObjectID:                   string(objectID),
		StorageRef:                 storageRef,
		StorageKey:                 objectStorageKey,
		ConversationID:             "conversation-1",
		MessageID:                  "message-cleanup",
		AttachmentID:               "attachment-cleanup",
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
		ExpiresAt:                  expiresAt,
		CleanupNextAttemptAt:       expiresAt,
		CreatedAt:                  now.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}

	return objectID
}

func seedIncompleteUpload(
	t *testing.T,
	database *gorm.DB,
	now time.Time,
	uploadID string,
) {
	t.Helper()
	hash := valueobject.HashBytes([]byte("incomplete-ciphertext"))
	expiresAt := now.Add(-time.Minute)
	if err := database.Create(&attachment.UploadModel{
		UploadID:                   uploadID,
		Generation:                 1,
		ConversationID:             "conversation-1",
		MessageID:                  "message-incomplete",
		AttachmentID:               "attachment-incomplete",
		UploaderPTID:               "ptid:alice",
		UploaderDeviceID:           "device-1",
		CiphertextSize:             uint64(attachmentapp.TagSize + 1),
		CiphertextSHA256:           hash.Bytes(),
		MediaType:                  "application/octet-stream",
		ChunkSize:                  attachmentapp.ChunkSize,
		ChunkCount:                 1,
		EncryptionSuite:            int32(attachmentapp.EncryptionSuiteAES256GCMChunked),
		TagSize:                    attachmentapp.TagSize,
		NonceStrategy:              int32(attachmentapp.NonceStrategyCounter32BE),
		ChunkCiphertextSHA256:      hash.Bytes(),
		DescriptorCommitmentSHA256: valueobject.HashBytes([]byte(uploadID)).Bytes(),
		IdempotencyKey:             "idempotency-" + uploadID,
		State:                      int32(attachmentapp.TransferStateTransferring),
		ReceivedChunkBitmap:        []byte{1},
		ExpiresAt:                  expiresAt,
		CleanupNextAttemptAt:       expiresAt,
		CreatedAt:                  now.Add(-time.Hour),
		UpdatedAt:                  now.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&attachment.UploadPartModel{
		UploadID:         uploadID,
		Generation:       1,
		ChunkIndex:       0,
		ByteOffset:       0,
		CiphertextSize:   uint64(attachmentapp.TagSize + 1),
		CiphertextSHA256: hash.Bytes(),
		StorageKey: attachmentapp.ImmutablePartStorageKey(
			uploadID,
			1,
			0,
			hash,
		),
		CreatedAt: now.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
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
