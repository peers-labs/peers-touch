package infrastructure_test

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSQLiteCompetingAttachmentPartFinalizeAndGrant(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open(
			"file:messaging-attachment-concurrency-"+uuid.NewString()+
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
	// Native Station serializes SQLite writes through one connection.
	sqlDatabase.SetMaxOpenConns(1)
	t.Cleanup(func() {
		_ = sqlDatabase.Close()
	})

	exerciseCompetingAttachmentTransactions(t, database)
}

func exerciseCompetingAttachmentTransactions(t *testing.T, database *gorm.DB) {
	t.Helper()
	repository := infrastructure.NewAttachmentRepository(database)
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	upload := attachmentUploadFixture(now)
	upload.UploadID = uuid.NewString()
	upload.IdempotencyKey = uuid.NewString()
	upload.AttachmentID = uuid.NewString()
	if _, inserted, err := repository.CreateUpload(context.Background(), upload); err != nil ||
		!inserted {
		t.Fatalf("create upload: inserted=%v err=%v", inserted, err)
	}

	part := &messaging.AttachmentPart{
		UploadID:         upload.UploadID,
		Generation:       upload.Generation,
		ChunkIndex:       0,
		ByteOffset:       0,
		CiphertextSize:   uint64(messaging.AttachmentChunkSize + messaging.AttachmentTagSize),
		CiphertextSHA256: bytes.Repeat([]byte{1}, 32),
		StorageKey:       "uploads/" + upload.UploadID + "/0",
		CreatedAt:        now,
	}
	type partResult struct {
		duplicate bool
		err       error
	}
	partResults := make(chan partResult, 8)
	var wait sync.WaitGroup
	start := make(chan struct{})
	for range 8 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			duplicate, err := repository.PutPart(context.Background(), part)
			partResults <- partResult{duplicate: duplicate, err: err}
		}()
	}
	close(start)
	wait.Wait()
	close(partResults)
	insertedParts := 0
	duplicateParts := 0
	for result := range partResults {
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.duplicate {
			duplicateParts++
		} else {
			insertedParts++
		}
	}
	if insertedParts != 1 || duplicateParts != 7 {
		t.Fatalf(
			"competing exact parts inserted=%d duplicate=%d",
			insertedParts,
			duplicateParts,
		)
	}

	descriptor := &chat.EncryptedObjectDescriptor{
		ObjectId:              uuid.NewString(),
		StorageRef:            uuid.NewString(),
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
		StorageKey:     "objects/" + descriptor.StorageRef,
		UploaderPTID:   upload.Uploader.Ptid,
		ConversationID: upload.ConversationID,
		MessageID:      upload.MessageID,
		CreatedAt:      now,
	}
	finalizeErrors := make(chan error, 2)
	start = make(chan struct{})
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			finalizeErrors <- repository.CompleteUpload(
				context.Background(),
				upload.UploadID,
				upload.Generation,
				object,
				now,
			)
		}()
	}
	close(start)
	wait.Wait()
	close(finalizeErrors)
	for err := range finalizeErrors {
		if err != nil {
			t.Fatal(err)
		}
	}

	grantErrors := make(chan error, 2)
	start = make(chan struct{})
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			grantErrors <- repository.GrantMessageObjects(
				context.Background(),
				upload.ConversationID,
				upload.MessageID,
				"event-1",
				upload.Uploader.Ptid,
				[]*chat.EncryptedObjectDescriptor{descriptor},
				[]string{"alice", "bob"},
				now,
			)
		}()
	}
	close(start)
	wait.Wait()
	close(grantErrors)
	for err := range grantErrors {
		if err != nil {
			t.Fatal(err)
		}
	}

	var partCount int64
	if err := database.Model(&infrastructure.AttachmentUploadPartModel{}).
		Count(&partCount).Error; err != nil {
		t.Fatal(err)
	}
	var objectCount int64
	if err := database.Model(&infrastructure.AttachmentObjectModel{}).
		Count(&objectCount).Error; err != nil {
		t.Fatal(err)
	}
	var grantCount int64
	if err := database.Model(&infrastructure.AttachmentGrantModel{}).
		Count(&grantCount).Error; err != nil {
		t.Fatal(err)
	}
	if partCount != 1 || objectCount != 1 || grantCount != 2 {
		t.Fatalf(
			"persisted rows parts=%d objects=%d grants=%d",
			partCount,
			objectCount,
			grantCount,
		)
	}
	var attachmentAudits []infrastructure.AttachmentAuditModel
	if err := database.
		Where("action = ?", messaging.AttachmentAuditAttach).
		Find(&attachmentAudits).Error; err != nil {
		t.Fatal(err)
	}
	outcomes := make(map[string]int)
	for _, audit := range attachmentAudits {
		outcomes[audit.Outcome]++
	}
	if outcomes[messaging.AttachmentAuditOutcomeCommitted] != 1 ||
		outcomes[messaging.AttachmentAuditOutcomeReplay] != 1 {
		t.Fatalf("competing attachment audit outcomes=%v", outcomes)
	}
	for _, recipient := range []string{"alice", "bob"} {
		granted, err := repository.GetGrantedObject(
			context.Background(),
			upload.ConversationID,
			descriptor.ObjectId,
			recipient,
		)
		if err != nil || granted.Descriptor.ObjectId != descriptor.ObjectId {
			t.Fatalf("recipient %s grant=%+v err=%v", recipient, granted, err)
		}
	}
	if _, err := repository.GetGrantedObject(
		context.Background(),
		upload.ConversationID,
		descriptor.ObjectId,
		"carol",
	); !errors.Is(err, messaging.ErrAttachmentNotGranted) {
		t.Fatalf("ungranted recipient error=%v", err)
	}
}
