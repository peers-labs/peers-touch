package attachment_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/attachment"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	attachmentinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/attachment"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var attachmentTestTime = time.Date(2026, time.September, 6, 14, 0, 0, 0, time.UTC)

type fixedClock struct {
	now time.Time
}

func (c *fixedClock) Now() time.Time {
	return c.now
}

type sequenceIDs struct {
	mu   sync.Mutex
	next int
}

func (g *sequenceIDs) NewID() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.next++

	return fmt.Sprintf("generated-%d", g.next)
}

type conversationReader struct {
	mu       sync.RWMutex
	snapshot aggregate.Snapshot
	denied   bool
}

func (r *conversationReader) Get(
	_ context.Context,
	_ valueobject.ConversationID,
	actor valueobject.PTID,
) (query.ConversationView, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.denied || actor == "ptid:mallory" {
		return query.ConversationView{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"test.conversation_reader",
			"actor",
			"is not a member",
		)
	}

	return query.ConversationView{
		Conversation: r.snapshot,
		Source:       query.SourceAuthority,
	}, nil
}

func (r *conversationReader) denyMembership() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.denied = true
}

type deviceDirectory struct {
	active map[valueobject.Endpoint]bool
}

func (d deviceDirectory) IsActive(
	_ context.Context,
	endpoint valueobject.Endpoint,
) (bool, error) {
	return d.active[endpoint], nil
}

func TestServiceUploadGrantAndRangeDownload(t *testing.T) {
	ctx := context.Background()
	service, repository, conversations := newAttachmentFixture(t)
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	bob := valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"}
	ciphertext := bytes.Repeat([]byte{0x7a}, 32)
	ciphertextHash := valueobject.HashBytes(ciphertext)
	spec := attachment.UploadSpec{
		CiphertextSize: uint64(len(ciphertext)),
		CiphertextHash: ciphertextHash,
		MediaType:      "application/octet-stream",
		ChunkSize:      attachment.ChunkSize,
		ChunkCount:     1,
		Encryption:     attachment.EncryptionSuiteAES256GCMChunked,
		TagSize:        attachment.TagSize,
		NonceStrategy:  attachment.NonceStrategyCounter32BE,
		ChunkHashes:    []valueobject.Hash{ciphertextHash},
	}
	canonicalSpec := []byte("canonical-encrypted-object-spec")
	commitment := attachment.UploadCommitment(
		"conversation-1",
		"message-1",
		"attachment-1",
		"station:local",
		canonicalSpec,
	)
	beginRequest := attachment.BeginRequest{
		ConversationID:       "conversation-1",
		MessageID:            "message-1",
		AttachmentID:         "attachment-1",
		Uploader:             alice,
		Spec:                 spec,
		CanonicalSpecBytes:   canonicalSpec,
		DescriptorCommitment: commitment,
		IdempotencyKey:       "upload-request-1",
		AuthorityStation:     "station:local",
	}

	begun, err := service.Begin(ctx, alice, beginRequest)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := service.Begin(ctx, alice, beginRequest)
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.Duplicate || replayed.Upload.UploadID != begun.Upload.UploadID {
		t.Fatalf("begin replay = %+v, first = %+v", replayed, begun)
	}
	conflictingBegin := beginRequest
	conflictingBegin.MessageID = "message-conflict"
	conflictingBegin.DescriptorCommitment = attachment.UploadCommitment(
		conflictingBegin.ConversationID,
		conflictingBegin.MessageID,
		conflictingBegin.AttachmentID,
		conflictingBegin.AuthorityStation,
		conflictingBegin.CanonicalSpecBytes,
	)
	if _, err := service.Begin(
		ctx,
		alice,
		conflictingBegin,
	); !attachment.IsCode(err, attachment.ErrorCodePartConflict) {
		t.Fatalf("conflicting begin replay error = %v", err)
	}

	chunkRequest := attachment.PutChunkRequest{
		UploadID:         begun.Upload.UploadID,
		Generation:       begun.Upload.Generation,
		ConversationID:   begun.Upload.ConversationID,
		AuthorityStation: "station:local",
		ChunkIndex:       0,
		ByteOffset:       0,
		CiphertextSize:   uint64(len(ciphertext)),
		CiphertextHash:   ciphertextHash,
		IdempotencyKey:   "chunk-request-1",
	}
	part, err := service.PutChunk(ctx, alice, chunkRequest, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if part.Duplicate || len(part.ReceivedChunkBitmap) != 1 ||
		part.ReceivedChunkBitmap[0] != 1 {
		t.Fatalf("first part = %+v", part)
	}
	partReplay, err := service.PutChunk(ctx, alice, chunkRequest, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if !partReplay.Duplicate {
		t.Fatalf("part replay = %+v", partReplay)
	}
	tampered := append([]byte(nil), ciphertext...)
	tampered[0] ^= 1
	if _, err := service.PutChunk(ctx, alice, chunkRequest, tampered); !attachment.IsCode(
		err,
		attachment.ErrorCodePartConflict,
	) {
		t.Fatalf("tampered part error = %v", err)
	}

	completed, err := service.Complete(ctx, alice, attachment.CompleteRequest{
		UploadID:             begun.Upload.UploadID,
		Generation:           begun.Upload.Generation,
		ConversationID:       begun.Upload.ConversationID,
		AuthorityStation:     "station:local",
		DescriptorCommitment: commitment,
	})
	if err != nil {
		t.Fatal(err)
	}
	completedReplay, err := service.Complete(ctx, alice, attachment.CompleteRequest{
		UploadID:             begun.Upload.UploadID,
		Generation:           begun.Upload.Generation,
		ConversationID:       begun.Upload.ConversationID,
		AuthorityStation:     "station:local",
		DescriptorCommitment: commitment,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !completedReplay.Duplicate ||
		completedReplay.Object.ObjectID != completed.Object.ObjectID {
		t.Fatalf("complete replay = %+v, first = %+v", completedReplay, completed)
	}

	if _, err := service.Download(ctx, bob, attachment.DownloadRequest{
		ConversationID:   "conversation-1",
		ObjectID:         completed.Object.ObjectID,
		ExpectedETag:     ciphertextHash,
		AuthorityStation: "station:local",
		Start:            -1,
		End:              -1,
	}); !attachment.IsCode(err, attachment.ErrorCodeNotGranted) {
		t.Fatalf("download without grant error = %v", err)
	}
	if err := repository.Grant(ctx, ports.ObjectGrant{
		ObjectID:       completed.Object.ObjectID,
		ConversationID: "conversation-1",
		EventID:        "event-1",
		Recipient:      bob.Actor,
		GrantedAt:      attachmentTestTime,
	}); err != nil {
		t.Fatal(err)
	}

	// Historical access is grant-based, not current-membership based.
	conversations.denyMembership()
	download, err := service.Download(ctx, bob, attachment.DownloadRequest{
		ConversationID:   "conversation-1",
		ObjectID:         completed.Object.ObjectID,
		ExpectedETag:     ciphertextHash,
		AuthorityStation: "station:local",
		Start:            4,
		End:              9,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer download.Body.Close()
	body, err := io.ReadAll(download.Body)
	if err != nil {
		t.Fatal(err)
	}
	if download.TotalSize != int64(len(ciphertext)) ||
		!bytes.Equal(body, ciphertext[4:10]) {
		t.Fatalf("download size=%d body=%x", download.TotalSize, body)
	}

	wrongETag := valueobject.HashBytes([]byte("wrong"))
	if _, err := service.Download(ctx, bob, attachment.DownloadRequest{
		ConversationID:   "conversation-1",
		ObjectID:         completed.Object.ObjectID,
		ExpectedETag:     wrongETag,
		AuthorityStation: "station:local",
		Start:            -1,
		End:              -1,
	}); !attachment.IsCode(err, attachment.ErrorCodeETagMismatch) {
		t.Fatalf("wrong ETag error = %v", err)
	}
}

func TestServiceRejectsNonMemberAndCancelsIdempotently(t *testing.T) {
	ctx := context.Background()
	service, _, _ := newAttachmentFixture(t)
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	mallory := valueobject.Endpoint{Actor: "ptid:mallory", Device: "mallory-1"}
	ciphertext := bytes.Repeat([]byte{0x11}, 32)
	hash := valueobject.HashBytes(ciphertext)
	spec := attachment.UploadSpec{
		CiphertextSize: uint64(len(ciphertext)),
		CiphertextHash: hash,
		MediaType:      "application/octet-stream",
		ChunkSize:      attachment.ChunkSize,
		ChunkCount:     1,
		Encryption:     attachment.EncryptionSuiteAES256GCMChunked,
		TagSize:        attachment.TagSize,
		NonceStrategy:  attachment.NonceStrategyCounter32BE,
		ChunkHashes:    []valueobject.Hash{hash},
	}
	canonicalSpec := []byte("cancel-spec")
	request := attachment.BeginRequest{
		ConversationID:       "conversation-1",
		MessageID:            "message-cancel",
		AttachmentID:         "attachment-cancel",
		Uploader:             alice,
		Spec:                 spec,
		CanonicalSpecBytes:   canonicalSpec,
		DescriptorCommitment: attachment.UploadCommitment("conversation-1", "message-cancel", "attachment-cancel", "station:local", canonicalSpec),
		IdempotencyKey:       "cancel-upload",
		AuthorityStation:     "station:local",
	}
	if _, err := service.Begin(ctx, mallory, request); !attachment.IsCode(
		err,
		attachment.ErrorCodeInvalidArgument,
	) {
		t.Fatalf("mismatched authenticated uploader error = %v", err)
	}
	begun, err := service.Begin(ctx, alice, request)
	if err != nil {
		t.Fatal(err)
	}
	cancel := attachment.CancelRequest{
		UploadID:         begun.Upload.UploadID,
		Generation:       begun.Upload.Generation,
		ConversationID:   begun.Upload.ConversationID,
		AuthorityStation: "station:local",
	}
	for range 2 {
		state, err := service.Cancel(ctx, alice, cancel)
		if err != nil {
			t.Fatal(err)
		}
		if state != attachment.TransferStateCancelled {
			t.Fatalf("cancel state = %v", state)
		}
	}
	if _, err := service.PutChunk(ctx, alice, attachment.PutChunkRequest{
		UploadID:         begun.Upload.UploadID,
		Generation:       begun.Upload.Generation,
		ConversationID:   begun.Upload.ConversationID,
		AuthorityStation: "station:local",
		ChunkIndex:       0,
		CiphertextSize:   uint64(len(ciphertext)),
		CiphertextHash:   hash,
		IdempotencyKey:   "after-cancel",
	}, ciphertext); !attachment.IsCode(err, attachment.ErrorCodeInvalidState) {
		t.Fatalf("part after cancel error = %v", err)
	}
}

func TestServiceEnforcesPerActorActiveUploadQuota(t *testing.T) {
	service, _, _ := newAttachmentFixture(t)
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	ciphertext := bytes.Repeat([]byte{0x22}, 32)
	hash := valueobject.HashBytes(ciphertext)
	spec := attachment.UploadSpec{
		CiphertextSize: uint64(len(ciphertext)),
		CiphertextHash: hash,
		MediaType:      "application/octet-stream",
		ChunkSize:      attachment.ChunkSize,
		ChunkCount:     1,
		Encryption:     attachment.EncryptionSuiteAES256GCMChunked,
		TagSize:        attachment.TagSize,
		NonceStrategy:  attachment.NonceStrategyCounter32BE,
		ChunkHashes:    []valueobject.Hash{hash},
	}
	for index := 0; index < attachment.MaximumActiveUploadCount+1; index++ {
		messageID := valueobject.MessageID(fmt.Sprintf("message-%d", index))
		attachmentID := fmt.Sprintf("attachment-%d", index)
		specBytes := []byte(fmt.Sprintf("quota-spec-%d", index))
		_, err := service.Begin(context.Background(), alice, attachment.BeginRequest{
			ConversationID:     "conversation-1",
			MessageID:          messageID,
			AttachmentID:       attachmentID,
			Uploader:           alice,
			Spec:               spec,
			CanonicalSpecBytes: specBytes,
			DescriptorCommitment: attachment.UploadCommitment(
				"conversation-1",
				messageID,
				attachmentID,
				"station:local",
				specBytes,
			),
			IdempotencyKey:   fmt.Sprintf("quota-upload-%d", index),
			AuthorityStation: "station:local",
		})
		if index < attachment.MaximumActiveUploadCount && err != nil {
			t.Fatalf("upload %d failed before quota: %v", index, err)
		}
		if index == attachment.MaximumActiveUploadCount &&
			!attachment.IsCode(err, attachment.ErrorCodeQuotaExceeded) {
			t.Fatalf("quota error = %v", err)
		}
	}
}

func newAttachmentFixture(
	t *testing.T,
) (*attachment.Service, *attachmentinfra.Repository, *conversationReader) {
	t.Helper()
	database, err := gorm.Open(
		sqlite.Open(
			"file:conversation-attachment-"+uuid.NewString()+
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
	repository, err := attachmentinfra.NewRepository(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	blobs, err := attachmentinfra.NewBlobStore(storage.NewLocalBackend(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	bob := valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"}
	conversations := &conversationReader{snapshot: validConversationSnapshot(alice, bob)}
	service, err := attachment.NewService(
		repository,
		blobs,
		conversations,
		deviceDirectory{active: map[valueobject.Endpoint]bool{
			alice: true,
			bob:   true,
			{Actor: "ptid:mallory", Device: "mallory-1"}: true,
		}},
		"station:local",
		attachment.Policy{
			UploadTTL:              time.Hour,
			MaximumActiveUploads:   4,
			MaximumConcurrentParts: 4,
		},
		&fixedClock{now: attachmentTestTime},
		&sequenceIDs{},
	)
	if err != nil {
		t.Fatal(err)
	}

	return service, repository, conversations
}

func validConversationSnapshot(
	alice valueobject.Endpoint,
	bob valueobject.Endpoint,
) aggregate.Snapshot {
	eventHash := sha256.Sum256([]byte("event-3"))

	return aggregate.Snapshot{
		ID:               "conversation-1",
		Kind:             valueobject.ConversationKindGroup,
		Status:           valueobject.ConversationStatusActive,
		FederationID:     "federation-1",
		AuthorityStation: "station:local",
		AuthorityEpoch:   1,
		Owner:            alice.Actor,
		Head: valueobject.AuthorityHead{
			Sequence:        3,
			EventHash:       eventHash,
			MembershipEpoch: 1,
			MLSEpoch:        1,
		},
		Members: []entity.Member{
			{
				Actor:       alice.Actor,
				Role:        valueobject.MemberRoleOwner,
				Status:      valueobject.MemberStatusActive,
				HomeStation: "station:local",
				JoinedAt:    1,
			},
			{
				Actor:       bob.Actor,
				Role:        valueobject.MemberRoleMember,
				Status:      valueobject.MemberStatusActive,
				HomeStation: "station:local",
				JoinedAt:    1,
			},
		},
		Devices: []entity.MemberDevice{
			{Endpoint: alice, HomeStation: "station:local", Active: true, JoinedAt: 1},
			{Endpoint: bob, HomeStation: "station:local", Active: true, JoinedAt: 1},
		},
		CreatedAt: attachmentTestTime.Add(-time.Hour),
		UpdatedAt: attachmentTestTime,
	}
}

func TestValidateUploadSpecRejectsPlaintextMetadataAndBounds(t *testing.T) {
	hash := valueobject.HashBytes([]byte("ciphertext"))
	valid := attachment.UploadSpec{
		CiphertextSize: uint64(attachment.TagSize + 1),
		CiphertextHash: hash,
		MediaType:      "application/octet-stream",
		ChunkSize:      attachment.ChunkSize,
		ChunkCount:     1,
		Encryption:     attachment.EncryptionSuiteAES256GCMChunked,
		TagSize:        attachment.TagSize,
		NonceStrategy:  attachment.NonceStrategyCounter32BE,
		ChunkHashes:    []valueobject.Hash{hash},
	}
	if err := attachment.ValidateUploadSpec(valid); err != nil {
		t.Fatal(err)
	}
	plaintextMedia := valid
	plaintextMedia.MediaType = "image/png"
	if err := attachment.ValidateUploadSpec(plaintextMedia); err == nil {
		t.Fatal("plaintext media metadata reached the Station attachment descriptor")
	}
	tooManyParts := valid
	tooManyParts.ChunkCount = attachment.MaximumChunkCount + 1
	tooManyParts.ChunkHashes = make([]valueobject.Hash, tooManyParts.ChunkCount)
	if err := attachment.ValidateUploadSpec(tooManyParts); !attachment.IsCode(
		err,
		attachment.ErrorCodeInvalidArgument,
	) {
		t.Fatalf("chunk bound error = %v", err)
	}
}
