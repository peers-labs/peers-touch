package application_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAttachmentServiceStreamsExactReplayAndFinalizes(t *testing.T) {
	ctx := context.Background()
	var lifecycleLog bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&lifecycleLog, nil)))
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})
	now := time.Unix(1_700_000_000, 0).UTC()
	db, err := gorm.Open(
		sqlite.Open("file:messaging-attachment-service-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&touchactor.ActorIdentityRecord{}, &touchactor.DeviceRecord{}); err != nil {
		t.Fatal(err)
	}
	uow, err := infrastructure.NewAuthorityUnitOfWork(db, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1024 * 1024,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := uow.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&touchactor.DeviceRecord{
		Ptid:               "alice",
		DeviceID:           "alice-device",
		HomeStationPeerID:  "station:local",
		PublicKey:          bytes.Repeat([]byte{1}, 32),
		VerificationSource: 1,
		Revoked:            false,
		CreatedAt:          now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&infrastructure.AuthorityConversationModel{
		ConversationID:  "conversation-1",
		Kind:            int32(messaging.AuthorityConversationKindDirect),
		MembershipEpoch: 1,
		Active:          true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&infrastructure.AuthorityMemberModel{
		ConversationID: "conversation-1",
		PTID:           "alice",
		Role:           "owner",
		Active:         true,
		JoinedSequence: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}

	blobStore, err := infrastructure.NewAttachmentBlobStore(
		storage.NewLocalBackend(t.TempDir()),
	)
	if err != nil {
		t.Fatal(err)
	}
	service, err := application.NewAttachmentService(
		uow,
		blobStore,
		"station:local",
		application.AttachmentPolicy{UploadTTL: time.Hour},
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := &chat.CryptoEndpoint{Ptid: "alice", DeviceId: "alice-device"}
	ciphertext := bytes.Repeat([]byte{7}, 32)
	ciphertextHash := sha256.Sum256(ciphertext)
	begin := &chat.BeginAttachmentUploadRequest{
		ConversationId: "conversation-1",
		MessageId:      "message-1",
		AttachmentId:   "attachment-1",
		Uploader:       endpoint,
		Object: &chat.EncryptedObjectUploadSpec{
			CiphertextSize:        uint64(len(ciphertext)),
			CiphertextSha256:      ciphertextHash[:],
			MediaType:             "application/octet-stream",
			ChunkSize:             messaging.AttachmentChunkSize,
			ChunkCount:            1,
			EncryptionSuite:       chat.AttachmentEncryptionSuite_ATTACHMENT_ENCRYPTION_SUITE_AES_256_GCM_CHUNKED,
			TagSize:               messaging.AttachmentTagSize,
			NonceStrategy:         chat.AttachmentNonceStrategy_ATTACHMENT_NONCE_STRATEGY_COUNTER32_BE,
			ChunkCiphertextSha256: [][]byte{ciphertextHash[:]},
		},
		IdempotencyKey:     "begin-1",
		AuthorityStationId: "station:local",
	}
	begin.DescriptorCommitmentSha256, err = application.AttachmentUploadCommitment(begin)
	if err != nil {
		t.Fatal(err)
	}
	started, err := service.Begin(ctx, endpoint, begin)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := service.Begin(ctx, endpoint, begin)
	if err != nil || replayed.UploadId != started.UploadId {
		t.Fatalf("begin replay = %+v, err = %v", replayed, err)
	}
	part := &chat.PutAttachmentChunkRequest{
		UploadId:           started.UploadId,
		Generation:         started.Generation,
		ChunkIndex:         0,
		ByteOffset:         0,
		CiphertextSize:     uint64(len(ciphertext)),
		CiphertextSha256:   ciphertextHash[:],
		IdempotencyKey:     "part-1",
		AuthorityStationId: "station:local",
		ConversationId:     "conversation-1",
	}
	written, err := service.PutChunk(ctx, endpoint, part, ciphertext)
	if err != nil || written.Duplicate {
		t.Fatalf("put part = %+v, err = %v", written, err)
	}
	written, err = service.PutChunk(ctx, endpoint, part, ciphertext)
	if err != nil || !written.Duplicate {
		t.Fatalf("part replay = %+v, err = %v", written, err)
	}
	tampered := append([]byte(nil), ciphertext...)
	tampered[0] ^= 1
	if _, err := service.PutChunk(ctx, endpoint, part, tampered); !errors.Is(err, messaging.ErrAttachmentConflict) {
		t.Fatalf("tampered part error = %v", err)
	}

	completed, err := service.Complete(ctx, endpoint, &chat.CompleteAttachmentUploadRequest{
		UploadId:                   started.UploadId,
		Generation:                 started.Generation,
		DescriptorCommitmentSha256: begin.DescriptorCommitmentSha256,
		AuthorityStationId:         "station:local",
		ConversationId:             "conversation-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	completedReplay, err := service.Complete(ctx, endpoint, &chat.CompleteAttachmentUploadRequest{
		UploadId:                   started.UploadId,
		Generation:                 started.Generation,
		DescriptorCommitmentSha256: begin.DescriptorCommitmentSha256,
		AuthorityStationId:         "station:local",
		ConversationId:             "conversation-1",
	})
	if err != nil || !completedReplay.Duplicate ||
		completedReplay.Object.ObjectId != completed.Object.ObjectId {
		t.Fatalf("complete replay = %+v, err = %v", completedReplay, err)
	}

	var object *messaging.AttachmentObject
	if err := uow.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		var err error
		object, err = repositories.Attachments.GetObject(ctx, completed.Object.ObjectId)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	reader, size, err := blobStore.Open(ctx, object.StorageKey, -1, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	stored, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if size != int64(len(ciphertext)) || !bytes.Equal(stored, ciphertext) {
		t.Fatalf("stored bytes size=%d body=%x", size, stored)
	}
	if err := uow.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		return repositories.Attachments.GrantMessageObjects(
			ctx,
			"conversation-1",
			"message-1",
			"event-1",
			"alice",
			[]*chat.EncryptedObjectDescriptor{completed.Object},
			[]string{"alice"},
			now,
		)
	}); err != nil {
		t.Fatal(err)
	}
	_, rangeReader, totalSize, err := service.OpenGrantedObject(
		ctx,
		endpoint,
		&chat.GetAttachmentObjectRequest{
			ConversationId:     "conversation-1",
			ObjectId:           completed.Object.ObjectId,
			ExpectedEtagSha256: completed.Object.CiphertextSha256,
			AuthorityStationId: "station:local",
		},
		4,
		9,
	)
	if err != nil {
		t.Fatal(err)
	}
	rangeBytes, err := io.ReadAll(rangeReader)
	_ = rangeReader.Close()
	if err != nil {
		t.Fatal(err)
	}
	if totalSize != int64(len(ciphertext)) || !bytes.Equal(rangeBytes, ciphertext[4:10]) {
		t.Fatalf("range size=%d body=%x", totalSize, rangeBytes)
	}
	wrongETag := append([]byte(nil), completed.Object.CiphertextSha256...)
	wrongETag[0] ^= 1
	if _, _, _, err := service.OpenGrantedObject(
		ctx,
		endpoint,
		&chat.GetAttachmentObjectRequest{
			ConversationId:     "conversation-1",
			ObjectId:           completed.Object.ObjectId,
			ExpectedEtagSha256: wrongETag,
			AuthorityStationId: "station:local",
		},
		0,
		-1,
	); !errors.Is(err, messaging.ErrAttachmentETag) {
		t.Fatalf("wrong ETag error = %v", err)
	}

	expiredBegin := proto.Clone(begin).(*chat.BeginAttachmentUploadRequest)
	expiredBegin.MessageId = "message-expired"
	expiredBegin.AttachmentId = "attachment-expired"
	expiredBegin.IdempotencyKey = "begin-expired"
	expiredBegin.DescriptorCommitmentSha256, err = application.AttachmentUploadCommitment(
		expiredBegin,
	)
	if err != nil {
		t.Fatal(err)
	}
	expired, err := service.Begin(ctx, endpoint, expiredBegin)
	if err != nil {
		t.Fatal(err)
	}
	expiredPart := proto.Clone(part).(*chat.PutAttachmentChunkRequest)
	expiredPart.UploadId = expired.UploadId
	expiredPart.Generation = expired.Generation
	expiredPart.IdempotencyKey = "part-expired"
	if _, err := service.PutChunk(ctx, endpoint, expiredPart, ciphertext); err != nil {
		t.Fatal(err)
	}
	var expiredParts []messaging.AttachmentPart
	if err := uow.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		var err error
		expiredParts, err = repositories.Attachments.ListParts(
			ctx,
			expired.UploadId,
			expired.Generation,
		)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&infrastructure.AttachmentUploadModel{}).
		Where("upload_id = ?", expired.UploadId).
		Update("expires_at", now.Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	deleted, err := service.SweepExpiredUploads(ctx, 100)
	if err != nil || deleted != 1 {
		t.Fatalf("cleanup deleted=%d err=%v", deleted, err)
	}
	if reader, _, err := blobStore.Open(
		ctx,
		expiredParts[0].StorageKey,
		-1,
		-1,
	); err == nil {
		_ = reader.Close()
		t.Fatal("expired temporary part still exists")
	}
	snapshot, err := service.MetricsSnapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.ActiveUploads != 0 ||
		snapshot.CompleteUnattachedObjects != 0 ||
		snapshot.AttachedObjects != 1 {
		t.Fatalf("attachment gauges = %+v", snapshot)
	}
	assertAttachmentMetric(
		t,
		snapshot,
		messaging.AttachmentAuditBegin,
		messaging.AttachmentAuditOutcomeCommitted,
		2,
		uint64(len(ciphertext))*2,
	)
	assertAttachmentMetric(
		t,
		snapshot,
		messaging.AttachmentAuditPart,
		messaging.AttachmentAuditOutcomeReplay,
		1,
		uint64(len(ciphertext)),
	)
	assertAttachmentMetric(
		t,
		snapshot,
		messaging.AttachmentAuditDownload,
		messaging.AttachmentAuditOutcomeCommitted,
		1,
		6,
	)
	assertAttachmentMetric(
		t,
		snapshot,
		messaging.AttachmentAuditExpire,
		messaging.AttachmentAuditOutcomeCommitted,
		1,
		0,
	)
	logged := lifecycleLog.String()
	for _, forbidden := range []string{
		"conversation-1",
		"message-1",
		"attachment-1",
		"alice-device",
		completed.Object.ObjectId,
		"filename",
		"object_key",
		"base_nonce",
		"plaintext_sha256",
	} {
		if strings.Contains(logged, forbidden) {
			t.Fatalf("private attachment metadata reached logs: %q", forbidden)
		}
	}
}

func assertAttachmentMetric(
	t *testing.T,
	snapshot *messaging.AttachmentMetricsSnapshot,
	action string,
	outcome string,
	count int64,
	bytes uint64,
) {
	t.Helper()
	for _, metric := range snapshot.Events {
		if metric.Action == action && metric.Outcome == outcome {
			if metric.Count != count || metric.Bytes != bytes {
				t.Fatalf(
					"metric %s/%s = %+v, want count=%d bytes=%d",
					action,
					outcome,
					metric,
					count,
					bytes,
				)
			}
			return
		}
	}
	t.Fatalf("metric %s/%s is absent: %+v", action, outcome, snapshot.Events)
}
