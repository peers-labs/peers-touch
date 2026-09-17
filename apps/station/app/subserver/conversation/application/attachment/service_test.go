package attachment_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/attachment"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	attachmentinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/attachment"
	conversationpersistence "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var attachmentTestTime = time.Date(2026, time.September, 6, 14, 0, 0, 0, time.UTC)

type fixedClock struct {
	mu  sync.RWMutex
	now time.Time
}

func (c *fixedClock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return c.now
}

func (c *fixedClock) Set(now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = now
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

type deleteFaultBlobStore struct {
	delegate attachment.BlobStore
	mu       sync.Mutex
	failures int
	saveWait *verificationSaveWait
}

type verificationSaveWait struct {
	started chan struct{}
	release chan struct{}
}

func (s *deleteFaultBlobStore) Save(
	ctx context.Context,
	storageKey string,
	reader io.Reader,
) error {
	s.mu.Lock()
	wait := s.saveWait
	if wait != nil {
		if strings.HasPrefix(storageKey, "conversation-attachments/verifications/") {
			s.saveWait = nil
		} else {
			wait = nil
		}
	}
	s.mu.Unlock()
	if wait != nil {
		body, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		close(wait.started)
		<-wait.release

		return s.delegate.Save(ctx, storageKey, bytes.NewReader(body))
	}

	return s.delegate.Save(ctx, storageKey, reader)
}

func (s *deleteFaultBlobStore) Open(
	ctx context.Context,
	storageKey string,
	start int64,
	end int64,
) (io.ReadCloser, int64, error) {
	return s.delegate.Open(ctx, storageKey, start, end)
}

func (s *deleteFaultBlobStore) Delete(ctx context.Context, storageKey string) error {
	s.mu.Lock()
	if s.failures > 0 {
		s.failures--
		s.mu.Unlock()

		return errors.New("injected attachment blob deletion failure")
	}
	s.mu.Unlock()

	return s.delegate.Delete(ctx, storageKey)
}

func (s *deleteFaultBlobStore) FailNextDelete() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failures++
}

func (s *deleteFaultBlobStore) BlockNextVerificationSave() (<-chan struct{}, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	wait := &verificationSaveWait{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	s.saveWait = wait
	var once sync.Once

	return wait.started, func() {
		once.Do(func() {
			close(wait.release)
		})
	}
}

type attachmentRuntime struct {
	service       *attachment.Service
	repository    *attachmentinfra.Repository
	conversations *conversationReader
	activeDevices map[valueobject.Endpoint]bool
	database      *gorm.DB
	blobs         *deleteFaultBlobStore
	clock         *fixedClock
}

func TestServiceUploadGrantAndRangeDownload(t *testing.T) {
	ctx := context.Background()
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	bob := valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"}
	runtime := newAttachmentRuntime(
		t,
		validConversationSnapshot(alice, bob),
	)
	service := runtime.service
	repository := runtime.repository
	conversations := runtime.conversations
	ciphertext := bytes.Repeat([]byte{0x7a}, 32)
	ciphertextHash := valueobject.HashBytes(ciphertext)
	spec := attachment.UploadSpec{
		CiphertextSize: uint64(len(ciphertext)),
		CiphertextHash: ciphertextHash,
		MediaType:      "application/octet-stream",
		ChunkSize:      securecontent.ObjectChunkSize,
		ChunkCount:     1,
		Encryption:     securecontent.EncryptionSuiteAES256GCMChunked,
		TagSize:        securecontent.AES256GCMTagSize,
		NonceStrategy:  securecontent.NonceStrategyCounter32BE,
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
	if err := repository.GrantBatch(ctx, ports.ObjectGrantBatch{
		ConversationID: "conversation-1",
		MessageID:      "message-1",
		Uploader:       alice.Actor,
		EventID:        "event-1",
		ObjectIDs:      []valueobject.ObjectID{completed.Object.ObjectID},
		Recipients:     []valueobject.PTID{bob.Actor},
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

	runtime.activeDevices[bob] = false
	if _, err := service.Download(ctx, bob, attachment.DownloadRequest{
		ConversationID:   "conversation-1",
		ObjectID:         completed.Object.ObjectID,
		ExpectedETag:     ciphertextHash,
		AuthorityStation: "station:local",
		Start:            4,
		End:              9,
	}); !attachment.IsCode(err, attachment.ErrorCodeUnauthorized) {
		t.Fatalf("inactive local endpoint download error = %v", err)
	}
	remoteDownload, err := service.DownloadFromVerifiedHome(
		ctx,
		bob,
		"station:remote",
		attachment.DownloadRequest{
			ConversationID:   "conversation-1",
			ObjectID:         completed.Object.ObjectID,
			ExpectedETag:     ciphertextHash,
			AuthorityStation: "station:local",
			Start:            4,
			End:              9,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer remoteDownload.Body.Close()
	remoteBody, err := io.ReadAll(remoteDownload.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(remoteBody, ciphertext[4:10]) {
		t.Fatalf("remote download body = %x", remoteBody)
	}
	if _, err := service.DownloadFromVerifiedHome(
		ctx,
		bob,
		"station:local",
		attachment.DownloadRequest{
			ConversationID:   "conversation-1",
			ObjectID:         completed.Object.ObjectID,
			ExpectedETag:     ciphertextHash,
			AuthorityStation: "station:local",
			Start:            4,
			End:              9,
		},
	); !attachment.IsCode(err, attachment.ErrorCodeInvalidArgument) {
		t.Fatalf("local Station used verified-remote download path: %v", err)
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
		ChunkSize:      securecontent.ObjectChunkSize,
		ChunkCount:     1,
		Encryption:     securecontent.EncryptionSuiteAES256GCMChunked,
		TagSize:        securecontent.AES256GCMTagSize,
		NonceStrategy:  securecontent.NonceStrategyCounter32BE,
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
		if state != securecontent.TransferStateCancelled {
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
		ChunkSize:      securecontent.ObjectChunkSize,
		ChunkCount:     1,
		Encryption:     securecontent.EncryptionSuiteAES256GCMChunked,
		TagSize:        securecontent.AES256GCMTagSize,
		NonceStrategy:  securecontent.NonceStrategyCounter32BE,
		ChunkHashes:    []valueobject.Hash{hash},
	}
	for index := 0; index < securecontent.MaximumActiveUploadCount+1; index++ {
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
		if index < securecontent.MaximumActiveUploadCount && err != nil {
			t.Fatalf("upload %d failed before quota: %v", index, err)
		}
		if index == securecontent.MaximumActiveUploadCount &&
			!attachment.IsCode(err, attachment.ErrorCodeQuotaExceeded) {
			t.Fatalf("quota error = %v", err)
		}
	}
}

func TestPutChunkPreservesConversationErrorCodes(t *testing.T) {
	service, _, _ := newAttachmentFixture(t)
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	scenario := newUploadScenario(alice, "error-codes", "message-error-codes")
	begun, err := service.Begin(context.Background(), alice, scenario.begin)
	if err != nil {
		t.Fatal(err)
	}
	scenario.bindUpload(begun.Upload)

	cases := []struct {
		name string
		edit func(*attachment.PutChunkRequest)
		code attachment.ErrorCode
	}{
		{
			name: "chunk index",
			edit: func(request *attachment.PutChunkRequest) {
				request.ChunkIndex = 1
			},
			code: attachment.ErrorCodeInvalidArgument,
		},
		{
			name: "byte offset",
			edit: func(request *attachment.PutChunkRequest) {
				request.ByteOffset = 1
			},
			code: attachment.ErrorCodeInvalidArgument,
		},
		{
			name: "body size",
			edit: func(request *attachment.PutChunkRequest) {
				request.CiphertextSize++
			},
			code: attachment.ErrorCodeInvalidArgument,
		},
		{
			name: "commitment hash",
			edit: func(request *attachment.PutChunkRequest) {
				request.CiphertextHash = valueobject.HashBytes([]byte("different"))
			},
			code: attachment.ErrorCodePartConflict,
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request := scenario.chunk
			testCase.edit(&request)
			if _, err := service.PutChunk(
				context.Background(),
				alice,
				request,
				scenario.body,
			); !attachment.IsCode(err, testCase.code) {
				t.Fatalf("error = %v, want code %s", err, testCase.code)
			}
		})
	}
}

func TestServiceRevalidatesCanonicalAuthorizationInsideMutationTransaction(t *testing.T) {
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}

	t.Run("begin rejects a revoked canonical actor device", func(t *testing.T) {
		runtime := newAttachmentRuntime(t, validConversationSnapshot(
			alice,
			valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
		))
		if err := runtime.database.Model(&actoridentitypersistence.ActorDeviceModel{}).
			Where("ptid = ? AND device_id = ?", string(alice.Actor), string(alice.Device)).
			Update("revoked", true).Error; err != nil {
			t.Fatal(err)
		}

		scenario := newUploadScenario(alice, "transaction-begin", "message-transaction-begin")
		if _, err := runtime.service.Begin(
			context.Background(),
			alice,
			scenario.begin,
		); !attachment.IsCode(err, attachment.ErrorCodeUnauthorized) {
			t.Fatalf("begin after canonical device revoke error = %v", err)
		}
		var count int64
		if err := runtime.database.Model(&attachmentinfra.UploadModel{}).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("unauthorized begin persisted %d uploads", count)
		}
	})

	t.Run("begin fails closed without canonical actor identity", func(t *testing.T) {
		runtime := newAttachmentRuntime(t, validConversationSnapshot(
			alice,
			valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
		))
		if err := runtime.database.Delete(
			&actoridentitypersistence.ActorIdentityModel{},
			"ptid = ?",
			string(alice.Actor),
		).Error; err != nil {
			t.Fatal(err)
		}

		scenario := newUploadScenario(
			alice,
			"missing-actor-identity",
			"message-missing-actor-identity",
		)
		if _, err := runtime.service.Begin(
			context.Background(),
			alice,
			scenario.begin,
		); !attachment.IsCode(err, attachment.ErrorCodeUnauthorized) {
			t.Fatalf("begin without canonical actor identity error = %v", err)
		}
		var count int64
		if err := runtime.database.Model(&attachmentinfra.UploadModel{}).
			Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("missing actor identity persisted %d uploads", count)
		}
	})

	t.Run("put rejects a stale conversation device projection", func(t *testing.T) {
		runtime := newAttachmentRuntime(t, validConversationSnapshot(
			alice,
			valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
		))
		scenario := newUploadScenario(alice, "transaction-part", "message-transaction-part")
		begun, err := runtime.service.Begin(context.Background(), alice, scenario.begin)
		if err != nil {
			t.Fatal(err)
		}
		scenario.bindUpload(begun.Upload)
		if err := runtime.database.Model(&conversationpersistence.ConversationMemberDeviceModel{}).
			Where(
				"conversation_id = ? AND ptid = ? AND device_id = ?",
				string(begun.Upload.ConversationID),
				string(alice.Actor),
				string(alice.Device),
			).
			Update("active", false).Error; err != nil {
			t.Fatal(err)
		}

		if _, err := runtime.service.PutChunk(
			context.Background(),
			alice,
			scenario.chunk,
			scenario.body,
		); !attachment.IsCode(err, attachment.ErrorCodeUnauthorized) {
			t.Fatalf("put after canonical membership change error = %v", err)
		}
		var count int64
		if err := runtime.database.Model(&attachmentinfra.UploadPartModel{}).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("unauthorized put persisted %d parts", count)
		}
	})

	t.Run("complete rejects a revoked canonical actor device", func(t *testing.T) {
		runtime := newAttachmentRuntime(t, validConversationSnapshot(
			alice,
			valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
		))
		scenario := newUploadScenario(alice, "transaction-complete", "message-transaction-complete")
		begun, err := runtime.service.Begin(context.Background(), alice, scenario.begin)
		if err != nil {
			t.Fatal(err)
		}
		scenario.bindUpload(begun.Upload)
		if _, err := runtime.service.PutChunk(
			context.Background(),
			alice,
			scenario.chunk,
			scenario.body,
		); err != nil {
			t.Fatal(err)
		}
		if err := runtime.database.Model(&actoridentitypersistence.ActorDeviceModel{}).
			Where("ptid = ? AND device_id = ?", string(alice.Actor), string(alice.Device)).
			Update("revoked", true).Error; err != nil {
			t.Fatal(err)
		}

		if _, err := runtime.service.Complete(
			context.Background(),
			alice,
			scenario.complete,
		); !attachment.IsCode(err, attachment.ErrorCodeUnauthorized) {
			t.Fatalf("complete after canonical device revoke error = %v", err)
		}
		var count int64
		if err := runtime.database.Model(&attachmentinfra.ObjectModel{}).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("unauthorized complete persisted %d objects", count)
		}
	})

	t.Run("cancel rejects a non-writable canonical conversation", func(t *testing.T) {
		runtime := newAttachmentRuntime(t, validConversationSnapshot(
			alice,
			valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
		))
		scenario := newUploadScenario(alice, "transaction-cancel", "message-transaction-cancel")
		begun, err := runtime.service.Begin(context.Background(), alice, scenario.begin)
		if err != nil {
			t.Fatal(err)
		}
		scenario.bindUpload(begun.Upload)
		if err := runtime.database.Model(&conversationpersistence.ConversationModel{}).
			Where("conversation_id = ?", string(begun.Upload.ConversationID)).
			Update("status", string(valueobject.ConversationStatusDissolved)).Error; err != nil {
			t.Fatal(err)
		}

		if _, err := runtime.service.Cancel(
			context.Background(),
			alice,
			attachment.CancelRequest{
				UploadID:         begun.Upload.UploadID,
				Generation:       begun.Upload.Generation,
				ConversationID:   begun.Upload.ConversationID,
				AuthorityStation: "station:local",
			},
		); !attachment.IsCode(err, attachment.ErrorCodeUnauthorized) {
			t.Fatalf("cancel after canonical conversation closure error = %v", err)
		}
		persisted, err := runtime.repository.GetUpload(
			context.Background(),
			begun.Upload.UploadID,
			begun.Upload.Generation,
		)
		if err != nil {
			t.Fatal(err)
		}
		if persisted.State != securecontent.TransferStateQueued {
			t.Fatalf("unauthorized cancel changed upload state to %v", persisted.State)
		}
	})
}

func TestServiceEnforcesMaximumMessageObjectsUnderConcurrentAdmission(t *testing.T) {
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	runtime := newAttachmentRuntime(t, validConversationSnapshot(
		alice,
		valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
	))
	for index := 0; index < securecontent.MaximumObjectsPerResource-1; index++ {
		scenario := newUploadScenario(
			alice,
			fmt.Sprintf("message-existing-%02d", index),
			"message-concurrent-admission",
		)
		_ = completeScenario(t, runtime.service, alice, &scenario)
	}

	const contenders = 6
	type admissionResult struct {
		request attachment.BeginRequest
		result  attachment.BeginResult
		err     error
	}
	start := make(chan struct{})
	results := make(chan admissionResult, contenders)
	var workers sync.WaitGroup
	for index := 0; index < contenders; index++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			<-start
			scenario := newUploadScenario(
				alice,
				fmt.Sprintf("message-admission-%02d", index),
				"message-concurrent-admission",
			)
			result, err := runtime.service.Begin(context.Background(), alice, scenario.begin)
			results <- admissionResult{request: scenario.begin, result: result, err: err}
		}(index)
	}
	close(start)
	workers.Wait()
	close(results)

	var admitted int
	var rejected int
	var admittedResult admissionResult
	for result := range results {
		switch {
		case result.err == nil:
			admitted++
			admittedResult = result
		case attachment.IsCode(result.err, attachment.ErrorCodeQuotaExceeded):
			rejected++
		default:
			t.Fatalf("unexpected concurrent admission error = %v", result.err)
		}
	}
	if admitted != 1 || rejected != contenders-1 {
		t.Fatalf(
			"concurrent admission admitted=%d rejected=%d, want 1/%d",
			admitted,
			rejected,
			contenders-1,
		)
	}
	var persisted int64
	if err := runtime.database.Model(&attachmentinfra.UploadModel{}).
		Where("conversation_id = ? AND message_id = ?", "conversation-1", "message-concurrent-admission").
		Count(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if persisted != int64(securecontent.MaximumObjectsPerResource) {
		t.Fatalf("persisted message objects = %d", persisted)
	}
	replayed, err := runtime.service.Begin(
		context.Background(),
		alice,
		admittedResult.request,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.Duplicate ||
		replayed.Upload.UploadID != admittedResult.result.Upload.UploadID {
		t.Fatalf("full-message replay = %+v, first = %+v", replayed, admittedResult.result)
	}
}

func TestServiceSerializesActorUploadQuotaAcrossConcurrentBegins(t *testing.T) {
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	runtime := newAttachmentRuntime(t, validConversationSnapshot(
		alice,
		valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
	))

	const contenders = 12
	start := make(chan struct{})
	results := make(chan error, contenders)
	var workers sync.WaitGroup
	for index := 0; index < contenders; index++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			<-start
			scenario := newUploadScenario(
				alice,
				fmt.Sprintf("actor-quota-%02d", index),
				valueobject.MessageID(fmt.Sprintf("message-actor-quota-%02d", index)),
			)
			_, err := runtime.service.Begin(context.Background(), alice, scenario.begin)
			results <- err
		}(index)
	}
	close(start)
	workers.Wait()
	close(results)

	var admitted int
	var rejected int
	for err := range results {
		switch {
		case err == nil:
			admitted++
		case attachment.IsCode(err, attachment.ErrorCodeQuotaExceeded):
			rejected++
		default:
			t.Fatalf("unexpected actor-quota admission error = %v", err)
		}
	}
	if admitted != securecontent.MaximumActiveUploadCount ||
		rejected != contenders-securecontent.MaximumActiveUploadCount {
		t.Fatalf("actor quota admitted=%d rejected=%d", admitted, rejected)
	}
}

func TestServiceRecoversDurableVerifyingAfterFinalizeFailure(t *testing.T) {
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	runtime := newAttachmentRuntime(t, validConversationSnapshot(
		alice,
		valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
	))
	scenario := newUploadScenario(alice, "verifying-recovery", "message-verifying-recovery")
	begun, err := runtime.service.Begin(context.Background(), alice, scenario.begin)
	if err != nil {
		t.Fatal(err)
	}
	scenario.bindUpload(begun.Upload)
	if _, err := runtime.service.PutChunk(
		context.Background(),
		alice,
		scenario.chunk,
		scenario.body,
	); err != nil {
		t.Fatal(err)
	}

	failNextObjectCreate(t, runtime.database)
	if _, err := runtime.service.Complete(
		context.Background(),
		alice,
		scenario.complete,
	); !attachment.IsCode(err, attachment.ErrorCodePersistence) {
		t.Fatalf("injected finalization failure error = %v", err)
	}
	verifying, err := runtime.repository.GetUpload(
		context.Background(),
		begun.Upload.UploadID,
		begun.Upload.Generation,
	)
	if err != nil {
		t.Fatal(err)
	}
	if verifying.State != securecontent.TransferStateVerifying ||
		verifying.VerificationToken == "" ||
		verifying.VerificationStorageKey == "" ||
		verifying.VerificationStartedAt.IsZero() {
		t.Fatalf("durable VERIFYING state = %+v", verifying)
	}
	reader, size, err := runtime.blobs.Open(
		context.Background(),
		verifying.VerificationStorageKey,
		-1,
		-1,
	)
	if err != nil {
		t.Fatalf("staged verification blob is not recoverable: %v", err)
	}
	_ = reader.Close()
	if size != int64(len(scenario.body)) {
		t.Fatalf("staged verification blob size = %d", size)
	}

	if _, err := runtime.service.Complete(
		context.Background(),
		alice,
		scenario.complete,
	); !attachment.IsCode(err, attachment.ErrorCodeRetryLater) {
		t.Fatalf("active verification lease retry error = %v", err)
	}
	runtime.clock.Set(verifying.VerificationLeaseExpiresAt)
	completed, err := runtime.service.Complete(
		context.Background(),
		alice,
		scenario.complete,
	)
	if err != nil {
		t.Fatal(err)
	}
	if completed.Object.ObjectID != verifying.ObjectID ||
		completed.Object.StorageKey == verifying.VerificationStorageKey {
		t.Fatalf("recovered completion changed object identity: %+v", completed)
	}
}

func TestServiceVerificationLeaseProtectsAssemblyPastUploadExpiry(t *testing.T) {
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	runtime := newAttachmentRuntime(t, validConversationSnapshot(
		alice,
		valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
	))
	scenario := newUploadScenario(
		alice,
		"verification-upload-expiry-race",
		"message-verification-upload-expiry-race",
	)
	begun, err := runtime.service.Begin(context.Background(), alice, scenario.begin)
	if err != nil {
		t.Fatal(err)
	}
	scenario.bindUpload(begun.Upload)
	if _, err := runtime.service.PutChunk(
		context.Background(),
		alice,
		scenario.chunk,
		scenario.body,
	); err != nil {
		t.Fatal(err)
	}

	runtime.clock.Set(begun.Upload.ExpiresAt.Add(-time.Minute))
	saveStarted, releaseSave := runtime.blobs.BlockNextVerificationSave()
	defer releaseSave()
	completion := make(chan error, 1)
	go func() {
		_, completeErr := runtime.service.Complete(
			context.Background(),
			alice,
			scenario.complete,
		)
		completion <- completeErr
	}()
	<-saveStarted

	verifying, err := runtime.repository.GetUpload(
		context.Background(),
		begun.Upload.UploadID,
		begun.Upload.Generation,
	)
	if err != nil {
		t.Fatal(err)
	}
	if verifying.State != securecontent.TransferStateVerifying ||
		verifying.VerificationAttempt != 1 ||
		!verifying.VerificationLeaseExpiresAt.After(begun.Upload.ExpiresAt) {
		t.Fatalf("verification lease does not protect assembly: %+v", verifying)
	}
	if _, err := runtime.service.Complete(
		context.Background(),
		alice,
		scenario.complete,
	); !attachment.IsCode(err, attachment.ErrorCodeRetryLater) {
		t.Fatalf("concurrent verifier reused an active lease: %v", err)
	}

	runtime.clock.Set(begun.Upload.ExpiresAt)
	swept, err := runtime.service.SweepExpired(
		context.Background(),
		"verification-active-worker",
	)
	if err != nil {
		t.Fatal(err)
	}
	if swept.Claimed != 0 {
		t.Fatalf("cleanup claimed an active verification lease: %+v", swept)
	}

	releaseSave()
	if err := <-completion; err != nil {
		t.Fatalf("active verification failed after upload expiry: %v", err)
	}
	completed, err := runtime.repository.GetUpload(
		context.Background(),
		begun.Upload.UploadID,
		begun.Upload.Generation,
	)
	if err != nil {
		t.Fatal(err)
	}
	if completed.State != securecontent.TransferStateComplete {
		t.Fatalf("verification did not finalize: %+v", completed)
	}
}

func TestServiceExpiredVerificationCleanupFencesLateFinalization(t *testing.T) {
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	runtime := newAttachmentRuntime(t, validConversationSnapshot(
		alice,
		valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
	))
	scenario := newUploadScenario(
		alice,
		"verification-cleanup-race",
		"message-verification-cleanup-race",
	)
	begun, err := runtime.service.Begin(context.Background(), alice, scenario.begin)
	if err != nil {
		t.Fatal(err)
	}
	scenario.bindUpload(begun.Upload)
	if _, err := runtime.service.PutChunk(
		context.Background(),
		alice,
		scenario.chunk,
		scenario.body,
	); err != nil {
		t.Fatal(err)
	}

	runtime.clock.Set(begun.Upload.ExpiresAt.Add(-time.Minute))
	saveStarted, releaseSave := runtime.blobs.BlockNextVerificationSave()
	defer releaseSave()
	completion := make(chan error, 1)
	go func() {
		_, completeErr := runtime.service.Complete(
			context.Background(),
			alice,
			scenario.complete,
		)
		completion <- completeErr
	}()
	<-saveStarted

	verifying, err := runtime.repository.GetUpload(
		context.Background(),
		begun.Upload.UploadID,
		begun.Upload.Generation,
	)
	if err != nil {
		t.Fatal(err)
	}
	runtime.clock.Set(verifying.VerificationLeaseExpiresAt)
	swept, err := runtime.service.SweepExpired(
		context.Background(),
		"verification-expired-worker",
	)
	if err != nil {
		t.Fatal(err)
	}
	if swept.Claimed != 1 || swept.Finalized != 1 {
		t.Fatalf("expired verification cleanup result = %+v", swept)
	}

	releaseSave()
	if err := <-completion; !attachment.IsCode(err, attachment.ErrorCodeRetryLater) {
		t.Fatalf("late verification finalization error = %v", err)
	}
	if reader, _, openErr := runtime.blobs.Open(
		context.Background(),
		verifying.VerificationStorageKey,
		-1,
		-1,
	); openErr == nil {
		_ = reader.Close()
		t.Fatal("late verifier left an untracked object blob")
	}
	var objectCount int64
	if err := runtime.database.Model(&attachmentinfra.ObjectModel{}).
		Where("object_id = ?", string(verifying.ObjectID)).
		Count(&objectCount).Error; err != nil {
		t.Fatal(err)
	}
	if objectCount != 0 {
		t.Fatalf("late verifier persisted %d object rows", objectCount)
	}
	cleaned, err := runtime.repository.GetUpload(
		context.Background(),
		begun.Upload.UploadID,
		begun.Upload.Generation,
	)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned.State != securecontent.TransferStateTerminal ||
		cleaned.CleanupCompletedAt.IsZero() {
		t.Fatalf("cleanup did not retain final ownership: %+v", cleaned)
	}
}

func TestServiceBoundsVerificationLeaseAttempts(t *testing.T) {
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	runtime := newAttachmentRuntime(t, validConversationSnapshot(
		alice,
		valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
	))
	scenario := newUploadScenario(
		alice,
		"verification-attempt-bound",
		"message-verification-attempt-bound",
	)
	begun, err := runtime.service.Begin(context.Background(), alice, scenario.begin)
	if err != nil {
		t.Fatal(err)
	}
	scenario.bindUpload(begun.Upload)
	if _, err := runtime.service.PutChunk(
		context.Background(),
		alice,
		scenario.chunk,
		scenario.body,
	); err != nil {
		t.Fatal(err)
	}

	var previousToken string
	for attempt := uint32(1); attempt <= securecontent.MaximumVerificationAttemptCount; attempt++ {
		failNextObjectCreate(t, runtime.database)
		if _, err := runtime.service.Complete(
			context.Background(),
			alice,
			scenario.complete,
		); !attachment.IsCode(err, attachment.ErrorCodePersistence) {
			t.Fatalf("verification attempt %d error = %v", attempt, err)
		}
		verifying, err := runtime.repository.GetUpload(
			context.Background(),
			begun.Upload.UploadID,
			begun.Upload.Generation,
		)
		if err != nil {
			t.Fatal(err)
		}
		if verifying.VerificationAttempt != attempt ||
			verifying.VerificationToken == previousToken ||
			!verifying.VerificationLeaseExpiresAt.After(verifying.VerificationStartedAt) {
			t.Fatalf("verification attempt %d state = %+v", attempt, verifying)
		}
		previousToken = verifying.VerificationToken
		runtime.clock.Set(verifying.VerificationLeaseExpiresAt)
	}

	if _, err := runtime.service.Complete(
		context.Background(),
		alice,
		scenario.complete,
	); !attachment.IsCode(err, attachment.ErrorCodeInvalidState) {
		t.Fatalf("verification attempt overflow error = %v", err)
	}
	swept, err := runtime.service.SweepExpired(
		context.Background(),
		"verification-attempt-limit-worker",
	)
	if err != nil {
		t.Fatal(err)
	}
	if swept.Claimed != 1 || swept.Finalized != 1 {
		t.Fatalf("bounded verification cleanup result = %+v", swept)
	}
}

func TestServiceReclaimsTrackedVerificationBlobAfterFinalizeFailure(t *testing.T) {
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	runtime := newAttachmentRuntime(t, validConversationSnapshot(
		alice,
		valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
	))
	scenario := newUploadScenario(
		alice,
		"verifying-cleanup",
		"message-verifying-cleanup",
	)
	begun, err := runtime.service.Begin(context.Background(), alice, scenario.begin)
	if err != nil {
		t.Fatal(err)
	}
	scenario.bindUpload(begun.Upload)
	if _, err := runtime.service.PutChunk(
		context.Background(),
		alice,
		scenario.chunk,
		scenario.body,
	); err != nil {
		t.Fatal(err)
	}
	parts, err := runtime.repository.ListParts(
		context.Background(),
		begun.Upload.UploadID,
		begun.Upload.Generation,
	)
	if err != nil || len(parts) != 1 {
		t.Fatalf("persisted parts = %+v, error=%v", parts, err)
	}

	failNextObjectCreate(t, runtime.database)
	if _, err := runtime.service.Complete(
		context.Background(),
		alice,
		scenario.complete,
	); !attachment.IsCode(err, attachment.ErrorCodePersistence) {
		t.Fatalf("injected finalization failure error = %v", err)
	}
	verifying, err := runtime.repository.GetUpload(
		context.Background(),
		begun.Upload.UploadID,
		begun.Upload.Generation,
	)
	if err != nil {
		t.Fatal(err)
	}
	runtime.clock.Set(verifying.ExpiresAt)
	result, err := runtime.service.SweepExpired(
		context.Background(),
		"verification-cleanup-worker",
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Claimed != 1 || result.Finalized != 1 {
		t.Fatalf("verification cleanup result = %+v", result)
	}
	for _, key := range []string{
		verifying.VerificationStorageKey,
		parts[0].StorageKey,
	} {
		if reader, _, openErr := runtime.blobs.Open(
			context.Background(),
			key,
			-1,
			-1,
		); openErr == nil {
			_ = reader.Close()
			t.Fatalf("cleanup left tracked blob %q readable", key)
		}
	}
	cleaned, err := runtime.repository.GetUpload(
		context.Background(),
		begun.Upload.UploadID,
		begun.Upload.Generation,
	)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned.State != securecontent.TransferStateTerminal ||
		cleaned.VerificationStorageKey != "" ||
		cleaned.CleanupCompletedAt.IsZero() {
		t.Fatalf("reclaimed VERIFYING upload = %+v", cleaned)
	}
}

func TestServiceReclaimsExpiredIncompleteUploadAndPartBlobs(t *testing.T) {
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	runtime := newAttachmentRuntime(t, validConversationSnapshot(
		alice,
		valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
	))
	scenario := newUploadScenario(alice, "incomplete-cleanup", "message-incomplete-cleanup")
	begun, err := runtime.service.Begin(context.Background(), alice, scenario.begin)
	if err != nil {
		t.Fatal(err)
	}
	scenario.bindUpload(begun.Upload)
	if _, err := runtime.service.PutChunk(
		context.Background(),
		alice,
		scenario.chunk,
		scenario.body,
	); err != nil {
		t.Fatal(err)
	}
	parts, err := runtime.repository.ListParts(
		context.Background(),
		begun.Upload.UploadID,
		begun.Upload.Generation,
	)
	if err != nil || len(parts) != 1 {
		t.Fatalf("persisted parts = %+v, error=%v", parts, err)
	}

	runtime.clock.Set(begun.Upload.ExpiresAt)
	result, err := runtime.service.SweepExpired(context.Background(), "upload-cleanup-worker")
	if err != nil {
		t.Fatal(err)
	}
	if result.Claimed != 1 || result.Finalized != 1 {
		t.Fatalf("incomplete upload cleanup result = %+v", result)
	}
	cleaned, err := runtime.repository.GetUpload(
		context.Background(),
		begun.Upload.UploadID,
		begun.Upload.Generation,
	)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned.State != securecontent.TransferStateTerminal ||
		cleaned.CleanupCompletedAt.IsZero() {
		t.Fatalf("cleaned upload state = %+v", cleaned)
	}
	if reader, _, openErr := runtime.blobs.Open(
		context.Background(),
		parts[0].StorageKey,
		-1,
		-1,
	); openErr == nil {
		_ = reader.Close()
		t.Fatal("expired incomplete upload part remains readable")
	}
}

func TestServiceRetriesAndFinalizesExpiredUnattachedObjectCleanup(t *testing.T) {
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	runtime := newAttachmentRuntime(t, validConversationSnapshot(
		alice,
		valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
	))
	scenario := newUploadScenario(alice, "cleanup", "message-cleanup")
	completed := completeScenario(t, runtime.service, alice, &scenario)
	if !completed.ExpiresAt.Equal(attachmentTestTime.Add(time.Hour)) ||
		!completed.CleanupNextAttemptAt.Equal(completed.ExpiresAt) {
		t.Fatalf("unbounded unattached retention = %+v", completed)
	}
	storageKey := completed.StorageKey

	runtime.clock.Set(completed.ExpiresAt.Add(time.Second))
	runtime.blobs.FailNextDelete()
	first, err := runtime.service.SweepExpired(
		context.Background(),
		"cleanup-worker",
	)
	if err == nil {
		t.Fatal("injected blob deletion failure was not returned")
	}
	if first.Claimed != 1 || first.Finalized != 0 || first.Retried != 1 {
		t.Fatalf("first cleanup result = %+v", first)
	}
	retryObject, err := runtime.repository.GetObject(context.Background(), completed.ObjectID)
	if err != nil {
		t.Fatal(err)
	}
	if retryObject.State != securecontent.ObjectStateCompleteUnattached ||
		retryObject.CleanupAttempt != 1 ||
		!retryObject.CleanupNextAttemptAt.After(runtime.clock.Now()) ||
		retryObject.CleanupNextAttemptAt.Sub(runtime.clock.Now()) >
			securecontent.MaximumCleanupRetryDelay {
		t.Fatalf("retry lifecycle = %+v", retryObject)
	}

	immediate, err := runtime.service.SweepExpired(
		context.Background(),
		"cleanup-worker",
	)
	if err != nil {
		t.Fatal(err)
	}
	if immediate.Claimed != 0 {
		t.Fatalf("retry delay admitted cleanup early: %+v", immediate)
	}

	runtime.clock.Set(retryObject.CleanupNextAttemptAt)
	second, err := runtime.service.SweepExpired(
		context.Background(),
		"cleanup-worker",
	)
	if err != nil {
		t.Fatal(err)
	}
	if second.Claimed != 1 || second.Finalized != 1 || second.Retried != 0 {
		t.Fatalf("second cleanup result = %+v", second)
	}
	finalized, err := runtime.repository.GetObject(context.Background(), completed.ObjectID)
	if err != nil {
		t.Fatal(err)
	}
	if finalized.State != securecontent.ObjectStateGarbageCollected ||
		finalized.StorageKey != "" ||
		finalized.CleanupCompletedAt.IsZero() {
		t.Fatalf("finalized cleanup object = %+v", finalized)
	}
	if reader, _, openErr := runtime.blobs.Open(
		context.Background(),
		storageKey,
		-1,
		-1,
	); openErr == nil {
		_ = reader.Close()
		t.Fatal("garbage-collected ciphertext blob remains readable")
	}
	if _, err := runtime.service.Complete(
		context.Background(),
		alice,
		scenario.complete,
	); !attachment.IsCode(err, attachment.ErrorCodeInvalidState) {
		t.Fatalf("complete replay after garbage collection error = %v", err)
	}
}

func failNextObjectCreate(t *testing.T, database *gorm.DB) {
	t.Helper()
	name := "attachment_test:fail_object_create:" + uuid.NewString()
	var mu sync.Mutex
	armed := true
	if err := database.Callback().Create().Before("gorm:create").Register(
		name,
		func(transaction *gorm.DB) {
			mu.Lock()
			defer mu.Unlock()
			if !armed ||
				transaction.Statement.Schema == nil ||
				transaction.Statement.Schema.Table != (&attachmentinfra.ObjectModel{}).TableName() {
				return
			}
			armed = false
			transaction.AddError(errors.New("injected attachment object finalization failure"))
		},
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = database.Callback().Create().Remove(name)
	})
}

func TestServiceDirectAllowsCurrentDeviceOutsideGenesisProjection(t *testing.T) {
	aliceOriginal := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-original"}
	bobOriginal := valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-original"}
	aliceCurrent := valueobject.Endpoint{Actor: aliceOriginal.Actor, Device: "alice-current"}
	snapshot := directAttachmentConversationSnapshot(
		t,
		aliceOriginal,
		bobOriginal,
	)
	runtime := newAttachmentRuntime(t, snapshot)
	runtime.activeDevices[aliceCurrent] = true
	if err := runtime.database.Create(&actoridentitypersistence.ActorDeviceModel{
		PTID:               string(aliceCurrent.Actor),
		ActorAccount:       string(aliceCurrent.Actor),
		ActorKind:          1,
		DeviceID:           string(aliceCurrent.Device),
		Label:              "attachment-current-direct-device",
		HomeStationPeerID:  "station:local",
		SigningKeyID:       "attachment-current-direct-signing-key",
		PublicKey:          bytes.Repeat([]byte{0x44}, 32),
		ProfileVersion:     2,
		VerificationSource: 1,
		CreatedAt:          attachmentTestTime,
	}).Error; err != nil {
		t.Fatal(err)
	}
	ciphertext := bytes.Repeat([]byte{0x7a}, 32)
	ciphertextHash := valueobject.HashBytes(ciphertext)
	canonicalSpec := []byte("direct-current-device-spec")
	_, err := runtime.service.Begin(
		context.Background(),
		aliceCurrent,
		attachment.BeginRequest{
			ConversationID: snapshot.ID,
			MessageID:      "message-direct-current-device",
			AttachmentID:   "attachment-direct-current-device",
			Uploader:       aliceCurrent,
			Spec: attachment.UploadSpec{
				CiphertextSize: uint64(len(ciphertext)),
				CiphertextHash: ciphertextHash,
				MediaType:      "application/octet-stream",
				ChunkSize:      securecontent.ObjectChunkSize,
				ChunkCount:     1,
				Encryption:     securecontent.EncryptionSuiteAES256GCMChunked,
				TagSize:        securecontent.AES256GCMTagSize,
				NonceStrategy:  securecontent.NonceStrategyCounter32BE,
				ChunkHashes:    []valueobject.Hash{ciphertextHash},
			},
			CanonicalSpecBytes: canonicalSpec,
			DescriptorCommitment: attachment.UploadCommitment(
				snapshot.ID,
				"message-direct-current-device",
				"attachment-direct-current-device",
				"station:local",
				canonicalSpec,
			),
			IdempotencyKey:   "upload-direct-current-device",
			AuthorityStation: "station:local",
		},
	)
	if err != nil {
		t.Fatalf("current Direct endpoint begin upload: %v", err)
	}
}

func newAttachmentFixture(
	t *testing.T,
) (*attachment.Service, *attachmentinfra.Repository, *conversationReader) {
	t.Helper()
	runtime := newAttachmentRuntime(
		t,
		validConversationSnapshot(
			valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"},
			valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"},
		),
	)

	return runtime.service, runtime.repository, runtime.conversations
}

func newAttachmentRuntime(
	t *testing.T,
	snapshot aggregate.Snapshot,
) *attachmentRuntime {
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
	if err := database.AutoMigrate(
		&actoridentitypersistence.ActorIdentityModel{},
		&actoridentitypersistence.ActorDeviceModel{},
		&conversationpersistence.ConversationModel{},
		&conversationpersistence.ConversationMemberModel{},
		&conversationpersistence.ConversationMemberDeviceModel{},
	); err != nil {
		t.Fatal(err)
	}
	seedAttachmentAuthorization(t, database, snapshot)

	blobStore, err := attachmentinfra.NewBlobStore(storage.NewLocalBackend(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	blobs := &deleteFaultBlobStore{delegate: blobStore}
	conversations := &conversationReader{snapshot: snapshot}
	activeDevices := make(map[valueobject.Endpoint]bool, len(snapshot.Devices))
	for _, device := range snapshot.Devices {
		activeDevices[device.Endpoint] = device.Active
	}
	clock := &fixedClock{now: attachmentTestTime}
	service, err := attachment.NewService(
		repository,
		blobs,
		conversations,
		deviceDirectory{active: activeDevices},
		"station:local",
		attachment.Policy{
			UploadTTL:               time.Hour,
			UnattachedObjectTTL:     time.Hour,
			VerificationLeaseTTL:    10 * time.Minute,
			CleanupLeaseTTL:         time.Minute,
			MaximumActiveUploads:    4,
			MaximumConcurrentParts:  4,
			MaximumCleanupBatchSize: 16,
		},
		clock,
		&sequenceIDs{},
	)
	if err != nil {
		t.Fatal(err)
	}

	return &attachmentRuntime{
		service:       service,
		repository:    repository,
		conversations: conversations,
		activeDevices: activeDevices,
		database:      database,
		blobs:         blobs,
		clock:         clock,
	}
}

func seedAttachmentAuthorization(
	t *testing.T,
	database *gorm.DB,
	snapshot aggregate.Snapshot,
) {
	t.Helper()
	conversation := conversationpersistence.ConversationModel{
		ConversationID:         string(snapshot.ID),
		Kind:                   string(snapshot.Kind),
		Status:                 string(snapshot.Status),
		FederationID:           string(snapshot.FederationID),
		AuthorityStationPeerID: string(snapshot.AuthorityStation),
		AuthorityEpoch:         uint64(snapshot.AuthorityEpoch),
		OwnerPTID:              string(snapshot.Owner),
		CurrentSequence:        uint64(snapshot.Head.Sequence),
		CurrentEventHash:       append([]byte(nil), snapshot.Head.EventHash[:]...),
		MembershipEpoch:        uint64(snapshot.Head.MembershipEpoch),
		MLSEpoch:               uint64(snapshot.Head.MLSEpoch),
		CreatedAt:              snapshot.CreatedAt,
		UpdatedAt:              snapshot.UpdatedAt,
	}
	if err := database.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	seededActors := make(map[valueobject.PTID]struct{}, len(snapshot.Members))
	for _, member := range snapshot.Members {
		if _, exists := seededActors[member.Actor]; exists {
			continue
		}
		seededActors[member.Actor] = struct{}{}
		if err := database.Create(&actoridentitypersistence.ActorIdentityModel{
			PTID:           string(member.Actor),
			PublicKey:      bytes.Repeat([]byte{0x41}, 32),
			Fingerprint:    bytes.Repeat([]byte{0x43}, 32),
			ProfileVersion: 1,
			CreatedAt:      attachmentTestTime.Add(-time.Hour),
			UpdatedAt:      attachmentTestTime.Add(-time.Hour),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, member := range snapshot.Members {
		if err := database.Create(&conversationpersistence.ConversationMemberModel{
			ConversationID: string(snapshot.ID),
			PTID:           string(member.Actor),
			Role:           string(member.Role),
			Status:         string(member.Status),
			HomeStation:    string(member.HomeStation),
			JoinedSequence: uint64(member.JoinedAt),
			LeftSequence:   uint64(member.LeftAt),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, device := range snapshot.Devices {
		if err := database.Create(&conversationpersistence.ConversationMemberDeviceModel{
			ConversationID: string(snapshot.ID),
			PTID:           string(device.Endpoint.Actor),
			DeviceID:       string(device.Endpoint.Device),
			HomeStation:    string(device.HomeStation),
			Active:         device.Active,
			JoinedSequence: uint64(device.JoinedAt),
			LeftSequence:   uint64(device.LeftAt),
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := database.Create(&actoridentitypersistence.ActorDeviceModel{
			PTID:               string(device.Endpoint.Actor),
			ActorAccount:       string(device.Endpoint.Actor),
			ActorKind:          1,
			DeviceID:           string(device.Endpoint.Device),
			Label:              "attachment-test-device",
			HomeStationPeerID:  string(device.HomeStation),
			SigningKeyID:       "attachment-test-signing-key",
			PublicKey:          bytes.Repeat([]byte{0x42}, 32),
			ProfileVersion:     1,
			VerificationSource: 1,
			Revoked:            !device.Active,
			CreatedAt:          attachmentTestTime.Add(-time.Hour),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
}

type uploadScenario struct {
	body     []byte
	begin    attachment.BeginRequest
	chunk    attachment.PutChunkRequest
	complete attachment.CompleteRequest
}

func newUploadScenario(
	uploader valueobject.Endpoint,
	suffix string,
	messageID valueobject.MessageID,
) uploadScenario {
	body := bytes.Repeat([]byte{byte(len(suffix) + 1)}, 32)
	hash := valueobject.HashBytes(body)
	specBytes := []byte("canonical-spec-" + suffix)
	attachmentID := "attachment-" + suffix
	commitment := attachment.UploadCommitment(
		"conversation-1",
		messageID,
		attachmentID,
		"station:local",
		specBytes,
	)

	return uploadScenario{
		body: body,
		begin: attachment.BeginRequest{
			ConversationID: "conversation-1",
			MessageID:      messageID,
			AttachmentID:   attachmentID,
			Uploader:       uploader,
			Spec: attachment.UploadSpec{
				CiphertextSize: uint64(len(body)),
				CiphertextHash: hash,
				MediaType:      "application/octet-stream",
				ChunkSize:      securecontent.ObjectChunkSize,
				ChunkCount:     1,
				Encryption:     securecontent.EncryptionSuiteAES256GCMChunked,
				TagSize:        securecontent.AES256GCMTagSize,
				NonceStrategy:  securecontent.NonceStrategyCounter32BE,
				ChunkHashes:    []valueobject.Hash{hash},
			},
			CanonicalSpecBytes:   specBytes,
			DescriptorCommitment: commitment,
			IdempotencyKey:       "upload-" + suffix,
			AuthorityStation:     "station:local",
		},
		chunk: attachment.PutChunkRequest{
			ConversationID:   "conversation-1",
			AuthorityStation: "station:local",
			ChunkIndex:       0,
			ByteOffset:       0,
			CiphertextSize:   uint64(len(body)),
			CiphertextHash:   hash,
			IdempotencyKey:   "chunk-" + suffix,
		},
		complete: attachment.CompleteRequest{
			ConversationID:       "conversation-1",
			AuthorityStation:     "station:local",
			DescriptorCommitment: commitment,
		},
	}
}

func (s *uploadScenario) bindUpload(upload attachment.Upload) {
	s.chunk.UploadID = upload.UploadID
	s.chunk.Generation = upload.Generation
	s.complete.UploadID = upload.UploadID
	s.complete.Generation = upload.Generation
}

func completeScenario(
	t *testing.T,
	service *attachment.Service,
	uploader valueobject.Endpoint,
	scenario *uploadScenario,
) attachment.Object {
	t.Helper()
	begun, err := service.Begin(context.Background(), uploader, scenario.begin)
	if err != nil {
		t.Fatal(err)
	}
	scenario.bindUpload(begun.Upload)
	if _, err := service.PutChunk(
		context.Background(),
		uploader,
		scenario.chunk,
		scenario.body,
	); err != nil {
		t.Fatal(err)
	}
	completed, err := service.Complete(
		context.Background(),
		uploader,
		scenario.complete,
	)
	if err != nil {
		t.Fatal(err)
	}

	return completed.Object
}

func validConversationSnapshot(
	alice valueobject.Endpoint,
	bob valueobject.Endpoint,
) aggregate.Snapshot {
	return conversationSnapshotForEndpoints([]valueobject.Endpoint{alice, bob})
}

func directAttachmentConversationSnapshot(
	t *testing.T,
	alice valueobject.Endpoint,
	bob valueobject.Endpoint,
) aggregate.Snapshot {
	t.Helper()
	conversationID, err := valueobject.DirectConversationID(alice.Actor, bob.Actor)
	if err != nil {
		t.Fatal(err)
	}
	eventHash := sha256.Sum256([]byte("event-3"))
	owner := alice.Actor
	if bob.Actor < owner {
		owner = bob.Actor
	}
	return aggregate.Snapshot{
		ID:               conversationID,
		Kind:             valueobject.ConversationKindDirect,
		Status:           valueobject.ConversationStatusActive,
		FederationID:     "federation-1",
		AuthorityStation: "station:local",
		AuthorityEpoch:   1,
		Owner:            owner,
		Head: valueobject.AuthorityHead{
			Sequence:        3,
			EventHash:       eventHash,
			MembershipEpoch: 1,
			MLSEpoch:        0,
		},
		Members: []entity.Member{
			{
				Actor:       alice.Actor,
				Role:        valueobject.MemberRoleMember,
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

func conversationSnapshotForEndpoints(
	endpoints []valueobject.Endpoint,
) aggregate.Snapshot {
	eventHash := sha256.Sum256([]byte("event-3"))
	members := make([]entity.Member, 0, len(endpoints))
	devices := make([]entity.MemberDevice, 0, len(endpoints))
	for index, endpoint := range endpoints {
		role := valueobject.MemberRoleMember
		if index == 0 {
			role = valueobject.MemberRoleOwner
		}
		members = append(members, entity.Member{
			Actor:       endpoint.Actor,
			Role:        role,
			Status:      valueobject.MemberStatusActive,
			HomeStation: "station:local",
			JoinedAt:    1,
		})
		devices = append(devices, entity.MemberDevice{
			Endpoint:    endpoint,
			HomeStation: "station:local",
			Active:      true,
			JoinedAt:    1,
		})
	}

	return aggregate.Snapshot{
		ID:               "conversation-1",
		Kind:             valueobject.ConversationKindGroup,
		Status:           valueobject.ConversationStatusActive,
		FederationID:     "federation-1",
		AuthorityStation: "station:local",
		AuthorityEpoch:   1,
		Owner:            endpoints[0].Actor,
		Head: valueobject.AuthorityHead{
			Sequence:        3,
			EventHash:       eventHash,
			MembershipEpoch: 1,
			MLSEpoch:        1,
		},
		Members:   members,
		Devices:   devices,
		CreatedAt: attachmentTestTime.Add(-time.Hour),
		UpdatedAt: attachmentTestTime,
	}
}

func TestValidateUploadSpecRejectsPlaintextMetadataAndBounds(t *testing.T) {
	service, _, _ := newAttachmentFixture(t)
	uploader := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}

	valid := newUploadScenario(uploader, "validation-valid", "message-validation-valid")
	if _, err := service.Begin(context.Background(), uploader, valid.begin); err != nil {
		t.Fatal(err)
	}

	plaintextMedia := newUploadScenario(
		uploader,
		"validation-media",
		"message-validation-media",
	)
	plaintextMedia.begin.Spec.MediaType = "image/png"
	if _, err := service.Begin(
		context.Background(),
		uploader,
		plaintextMedia.begin,
	); err == nil {
		t.Fatal("plaintext media metadata reached the Station attachment descriptor")
	}

	tooManyParts := newUploadScenario(
		uploader,
		"validation-parts",
		"message-validation-parts",
	)
	tooManyParts.begin.Spec.ChunkCount = securecontent.MaximumObjectChunkCount + 1
	tooManyParts.begin.Spec.ChunkHashes = make(
		[]valueobject.Hash,
		tooManyParts.begin.Spec.ChunkCount,
	)
	if _, err := service.Begin(
		context.Background(),
		uploader,
		tooManyParts.begin,
	); !attachment.IsCode(
		err,
		attachment.ErrorCodeInvalidArgument,
	) {
		t.Fatalf("chunk bound error = %v", err)
	}
}
