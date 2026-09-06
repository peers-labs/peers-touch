package attachment

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

const attachmentCommitmentDomain = "peers-touch:attachment:upload-commitment:1"

// Service owns Conversation-authority attachment transfer policy.
type Service struct {
	repository    Repository
	blobs         BlobStore
	conversations ConversationReader
	devices       DeviceAccess
	localStation  valueobject.StationID
	policy        Policy
	clock         Clock
	ids           IDGenerator

	partMu      sync.Mutex
	activeParts map[string]int
}

func NewService(
	repository Repository,
	blobs BlobStore,
	conversations ConversationReader,
	devices DeviceAccess,
	localStation valueobject.StationID,
	policy Policy,
	clock Clock,
	ids IDGenerator,
) (*Service, error) {
	if repository == nil || blobs == nil || conversations == nil || devices == nil ||
		localStation == "" || clock == nil || ids == nil {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"attachment.new_service",
			"dependencies",
			"repository, blob store, Conversation reader, device access, local Station, clock, and ID generator are required",
		)
	}
	if policy.UploadTTL <= 0 ||
		policy.UploadTTL > MaximumUploadTTL ||
		policy.MaximumActiveUploads <= 0 ||
		policy.MaximumActiveUploads > MaximumActiveUploadCount ||
		policy.MaximumConcurrentParts <= 0 ||
		policy.MaximumConcurrentParts > MaximumConcurrentPartCount {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"attachment.new_service",
			"policy",
			"upload TTL and concurrency limits must be positive",
		)
	}

	return &Service{
		repository:    repository,
		blobs:         blobs,
		conversations: conversations,
		devices:       devices,
		localStation:  localStation,
		policy:        policy,
		clock:         clock,
		ids:           ids,
		activeParts:   make(map[string]int),
	}, nil
}

func (s *Service) Begin(
	ctx context.Context,
	authenticated valueobject.Endpoint,
	request BeginRequest,
) (BeginResult, error) {
	if err := s.validateAuthorityRequest(
		"attachment.begin",
		request.ConversationID,
		request.AuthorityStation,
	); err != nil {
		return BeginResult{}, err
	}
	if authenticated.Validate() != nil ||
		request.Uploader != authenticated ||
		request.MessageID == "" ||
		!validIdentifier(request.AttachmentID, 128) ||
		!validIdentifier(request.IdempotencyKey, 128) ||
		len(request.CanonicalSpecBytes) == 0 ||
		request.DescriptorCommitment.IsZero() {
		return BeginResult{}, NewError(
			ErrorCodeInvalidArgument,
			"attachment.begin",
			"request",
			"must bind a complete upload identity to the authenticated endpoint",
		)
	}
	if err := ValidateUploadSpec(request.Spec); err != nil {
		return BeginResult{}, err
	}
	expectedCommitment := UploadCommitment(
		request.ConversationID,
		request.MessageID,
		request.AttachmentID,
		request.AuthorityStation,
		request.CanonicalSpecBytes,
	)
	if expectedCommitment != request.DescriptorCommitment {
		return BeginResult{}, NewError(
			ErrorCodeInvalidArgument,
			"attachment.begin",
			"descriptor_commitment_sha256",
			"does not match the canonical upload descriptor",
		)
	}
	if err := s.authorizeMemberEndpoint(
		ctx,
		request.ConversationID,
		authenticated,
		"attachment.begin",
	); err != nil {
		return BeginResult{}, err
	}

	now := s.clock.Now().UTC()
	uploadID, err := s.newIdentifier("attachment.begin", "upload_id")
	if err != nil {
		return BeginResult{}, err
	}
	upload := Upload{
		UploadID:             uploadID,
		Generation:           1,
		ConversationID:       request.ConversationID,
		MessageID:            request.MessageID,
		AttachmentID:         request.AttachmentID,
		Uploader:             request.Uploader,
		Spec:                 CloneUploadSpec(request.Spec),
		DescriptorCommitment: request.DescriptorCommitment,
		IdempotencyKey:       request.IdempotencyKey,
		State:                TransferStateQueued,
		ReceivedChunkBitmap:  make([]byte, (request.Spec.ChunkCount+7)/8),
		ExpiresAt:            now.Add(s.policy.UploadTTL),
		CreatedAt:            now,
		UpdatedAt:            now,
	}
	audit, err := s.audit(
		AuditActionBegin,
		AuditOutcomeCommitted,
		upload,
		Object{},
		0,
		upload.Spec.CiphertextSize,
		now,
	)
	if err != nil {
		return BeginResult{}, err
	}
	persisted, inserted, err := s.repository.CreateUpload(
		ctx,
		upload,
		s.policy.MaximumActiveUploads,
		audit,
	)
	if err != nil {
		return BeginResult{}, err
	}

	return BeginResult{Upload: CloneUpload(persisted), Duplicate: !inserted}, nil
}

func (s *Service) Status(
	ctx context.Context,
	authenticated valueobject.Endpoint,
	request StatusRequest,
) (Upload, error) {
	if err := s.validateUploadReference(
		"attachment.status",
		request.UploadID,
		request.Generation,
		request.ConversationID,
		request.AuthorityStation,
	); err != nil {
		return Upload{}, err
	}
	if err := s.authorizeMemberEndpoint(
		ctx,
		request.ConversationID,
		authenticated,
		"attachment.status",
	); err != nil {
		return Upload{}, err
	}
	upload, err := s.repository.GetUpload(ctx, request.UploadID, request.Generation)
	if err != nil {
		return Upload{}, err
	}
	if upload.ConversationID != request.ConversationID || upload.Uploader != authenticated {
		return Upload{}, NewError(
			ErrorCodeUnauthorized,
			"attachment.status",
			"upload",
			"is not owned by the authenticated conversation endpoint",
		)
	}

	return CloneUpload(upload), nil
}

func (s *Service) PutChunk(
	ctx context.Context,
	authenticated valueobject.Endpoint,
	request PutChunkRequest,
	body []byte,
) (PutChunkResult, error) {
	if err := s.validateUploadReference(
		"attachment.put_chunk",
		request.UploadID,
		request.Generation,
		request.ConversationID,
		request.AuthorityStation,
	); err != nil {
		return PutChunkResult{}, err
	}
	if !validIdentifier(request.IdempotencyKey, 128) || request.CiphertextHash.IsZero() {
		return PutChunkResult{}, NewError(
			ErrorCodeInvalidArgument,
			"attachment.put_chunk",
			"request",
			"requires an idempotency key and ciphertext hash",
		)
	}
	if !s.acquirePart(request.UploadID) {
		return PutChunkResult{}, NewRetryError(
			"attachment.put_chunk",
			time.Second,
			"the upload has reached its concurrent part limit",
		)
	}
	defer s.releasePart(request.UploadID)

	if err := s.authorizeMemberEndpoint(
		ctx,
		request.ConversationID,
		authenticated,
		"attachment.put_chunk",
	); err != nil {
		return PutChunkResult{}, err
	}
	upload, err := s.repository.GetUpload(ctx, request.UploadID, request.Generation)
	if err != nil {
		return PutChunkResult{}, err
	}
	now := s.clock.Now().UTC()
	if err := validateChunk(upload, authenticated, request, body, now); err != nil {
		return PutChunkResult{}, err
	}

	storageKey := partStorageKey(upload, request)
	if err := s.blobs.Save(ctx, storageKey, bytes.NewReader(body)); err != nil {
		return PutChunkResult{}, WrapError(
			ErrorCodePersistence,
			"attachment.put_chunk.save_blob",
			err,
		)
	}
	audit, err := s.audit(
		AuditActionPart,
		AuditOutcomeCommitted,
		upload,
		Object{},
		request.ChunkIndex,
		request.CiphertextSize,
		now,
	)
	if err != nil {
		return PutChunkResult{}, err
	}
	duplicate, bitmap, err := s.repository.PutPart(ctx, Part{
		UploadID:       upload.UploadID,
		Generation:     upload.Generation,
		ChunkIndex:     request.ChunkIndex,
		ByteOffset:     request.ByteOffset,
		CiphertextSize: request.CiphertextSize,
		CiphertextHash: request.CiphertextHash,
		StorageKey:     storageKey,
		CreatedAt:      now,
	}, now, audit)
	if err != nil {
		return PutChunkResult{}, err
	}

	return PutChunkResult{
		ChunkIndex:          request.ChunkIndex,
		Duplicate:           duplicate,
		ReceivedChunkBitmap: append([]byte(nil), bitmap...),
	}, nil
}

func (s *Service) Complete(
	ctx context.Context,
	authenticated valueobject.Endpoint,
	request CompleteRequest,
) (CompleteResult, error) {
	if err := s.validateUploadReference(
		"attachment.complete",
		request.UploadID,
		request.Generation,
		request.ConversationID,
		request.AuthorityStation,
	); err != nil {
		return CompleteResult{}, err
	}
	if request.DescriptorCommitment.IsZero() {
		return CompleteResult{}, NewError(
			ErrorCodeInvalidArgument,
			"attachment.complete",
			"descriptor_commitment_sha256",
			"is required",
		)
	}
	if err := s.authorizeMemberEndpoint(
		ctx,
		request.ConversationID,
		authenticated,
		"attachment.complete",
	); err != nil {
		return CompleteResult{}, err
	}
	upload, err := s.repository.GetUpload(ctx, request.UploadID, request.Generation)
	if err != nil {
		return CompleteResult{}, err
	}
	if upload.ConversationID != request.ConversationID || upload.Uploader != authenticated {
		return CompleteResult{}, NewError(
			ErrorCodeUnauthorized,
			"attachment.complete",
			"upload",
			"is not owned by the authenticated conversation endpoint",
		)
	}
	if upload.DescriptorCommitment != request.DescriptorCommitment {
		return CompleteResult{}, NewError(
			ErrorCodePartConflict,
			"attachment.complete",
			"descriptor_commitment_sha256",
			"does not match the upload",
		)
	}
	if upload.State == TransferStateComplete {
		return s.completedReplay(ctx, upload)
	}
	if upload.State != TransferStateTransferring {
		return CompleteResult{}, NewError(
			ErrorCodeInvalidState,
			"attachment.complete",
			"state",
			"is not receiving chunks",
		)
	}
	now := s.clock.Now().UTC()
	if !upload.ExpiresAt.After(now) {
		return CompleteResult{}, NewError(
			ErrorCodeUploadExpired,
			"attachment.complete",
			"expires_at",
			"has elapsed",
		)
	}
	parts, err := s.repository.ListParts(ctx, upload.UploadID, upload.Generation)
	if err != nil {
		return CompleteResult{}, err
	}
	if err := validateCompleteParts(upload, parts); err != nil {
		return CompleteResult{}, err
	}

	object := objectFromUpload(upload, now)
	sequenceReader := &partSequenceReader{ctx: ctx, blobs: s.blobs, parts: parts}
	defer sequenceReader.Close()
	wholeHash := sha256.New()
	counting := &countingReader{reader: io.TeeReader(sequenceReader, wholeHash)}
	if err := s.blobs.Save(ctx, object.StorageKey, counting); err != nil {
		return CompleteResult{}, WrapError(
			ErrorCodePersistence,
			"attachment.complete.save_object",
			err,
		)
	}
	if counting.read != upload.Spec.CiphertextSize ||
		!bytes.Equal(wholeHash.Sum(nil), upload.Spec.CiphertextHash.Bytes()) {
		return CompleteResult{}, errors.Join(
			NewError(
				ErrorCodeIntegrityFailed,
				"attachment.complete",
				"ciphertext_sha256",
				"does not match the immutable upload commitment",
			),
			s.blobs.Delete(ctx, object.StorageKey),
		)
	}
	audit, err := s.audit(
		AuditActionComplete,
		AuditOutcomeCommitted,
		upload,
		object,
		0,
		object.Spec.CiphertextSize,
		now,
	)
	if err != nil {
		return CompleteResult{}, err
	}
	duplicate, err := s.repository.CompleteUpload(
		ctx,
		upload.UploadID,
		upload.Generation,
		object,
		now,
		audit,
	)
	if err != nil {
		return CompleteResult{}, err
	}
	if duplicate {
		return CompleteResult{Object: CloneObject(object), Duplicate: true}, nil
	}
	for _, part := range parts {
		if err := s.blobs.Delete(ctx, part.StorageKey); err != nil {
			return CompleteResult{Object: CloneObject(object)}, WrapError(
				ErrorCodePersistence,
				"attachment.complete.delete_part",
				err,
			)
		}
	}

	return CompleteResult{Object: CloneObject(object)}, nil
}

func (s *Service) Cancel(
	ctx context.Context,
	authenticated valueobject.Endpoint,
	request CancelRequest,
) (TransferState, error) {
	if err := s.validateUploadReference(
		"attachment.cancel",
		request.UploadID,
		request.Generation,
		request.ConversationID,
		request.AuthorityStation,
	); err != nil {
		return 0, err
	}
	if err := s.authorizeMemberEndpoint(
		ctx,
		request.ConversationID,
		authenticated,
		"attachment.cancel",
	); err != nil {
		return 0, err
	}
	upload, err := s.repository.GetUpload(ctx, request.UploadID, request.Generation)
	if err != nil {
		return 0, err
	}
	if upload.ConversationID != request.ConversationID || upload.Uploader != authenticated {
		return 0, NewError(
			ErrorCodeUnauthorized,
			"attachment.cancel",
			"upload",
			"is not owned by the authenticated conversation endpoint",
		)
	}
	now := s.clock.Now().UTC()
	audit, err := s.audit(
		AuditActionCancel,
		AuditOutcomeCommitted,
		upload,
		Object{},
		0,
		0,
		now,
	)
	if err != nil {
		return 0, err
	}
	parts, _, err := s.repository.CancelUpload(
		ctx,
		upload.UploadID,
		upload.Generation,
		now,
		audit,
	)
	if err != nil {
		return 0, err
	}
	for _, part := range parts {
		if err := s.blobs.Delete(ctx, part.StorageKey); err != nil {
			return TransferStateCancelled, WrapError(
				ErrorCodePersistence,
				"attachment.cancel.delete_part",
				err,
			)
		}
	}

	return TransferStateCancelled, nil
}

// Download authorizes through the immutable event-time grant. Current
// membership is intentionally not consulted, so removed members retain access
// to objects granted while they were recipients.
func (s *Service) Download(
	ctx context.Context,
	authenticated valueobject.Endpoint,
	request DownloadRequest,
) (DownloadResult, error) {
	if err := s.validateAuthorityRequest(
		"attachment.download",
		request.ConversationID,
		request.AuthorityStation,
	); err != nil {
		return DownloadResult{}, err
	}
	if authenticated.Validate() != nil ||
		request.ObjectID == "" ||
		request.ExpectedETag.IsZero() {
		return DownloadResult{}, NewError(
			ErrorCodeInvalidArgument,
			"attachment.download",
			"request",
			"requires endpoint, object, and immutable ETag",
		)
	}
	active, err := s.devices.IsActive(ctx, authenticated)
	if err != nil {
		return DownloadResult{}, WrapError(
			ErrorCodePersistence,
			"attachment.download.authorize_device",
			err,
		)
	}
	if !active {
		return DownloadResult{}, NewError(
			ErrorCodeUnauthorized,
			"attachment.download",
			"device",
			"is not active for the authenticated actor",
		)
	}
	object, err := s.repository.GetGrantedObject(
		ctx,
		request.ConversationID,
		request.ObjectID,
		authenticated.Actor,
	)
	if err != nil {
		return DownloadResult{}, err
	}
	if object.Spec.CiphertextHash != request.ExpectedETag {
		return DownloadResult{}, NewError(
			ErrorCodeETagMismatch,
			"attachment.download",
			"expected_etag_sha256",
			"does not match the immutable object",
		)
	}
	start, end, err := normalizeRange(
		request.Start,
		request.End,
		object.Spec.CiphertextSize,
	)
	if err != nil {
		return DownloadResult{}, err
	}
	reader, totalSize, err := s.blobs.Open(ctx, object.StorageKey, start, end)
	if err != nil {
		return DownloadResult{}, err
	}
	if uint64(totalSize) != object.Spec.CiphertextSize {
		_ = reader.Close()
		return DownloadResult{}, NewError(
			ErrorCodeIntegrityFailed,
			"attachment.download",
			"ciphertext_size",
			"blob size does not match the immutable descriptor",
		)
	}
	now := s.clock.Now().UTC()
	audit, auditErr := s.audit(
		AuditActionDownload,
		AuditOutcomeCommitted,
		Upload{
			ConversationID: object.ConversationID,
			MessageID:      object.MessageID,
			AttachmentID:   object.AttachmentID,
			Uploader: valueobject.Endpoint{
				Actor:  authenticated.Actor,
				Device: authenticated.Device,
			},
		},
		object,
		0,
		uint64(end-start+1),
		now,
	)
	if auditErr != nil {
		_ = reader.Close()
		return DownloadResult{}, auditErr
	}
	if err := s.repository.AppendAudit(ctx, audit); err != nil {
		_ = reader.Close()
		return DownloadResult{}, err
	}

	return DownloadResult{
		Object:    CloneObject(object),
		Body:      reader,
		TotalSize: totalSize,
		Start:     start,
		End:       end,
	}, nil
}

func ValidateUploadSpec(spec UploadSpec) error {
	if strings.TrimSpace(spec.MediaType) != spec.MediaType ||
		spec.MediaType != "application/octet-stream" ||
		spec.ChunkSize != ChunkSize ||
		spec.ChunkCount == 0 ||
		spec.ChunkCount > MaximumChunkCount ||
		spec.TagSize != TagSize ||
		spec.Encryption != EncryptionSuiteAES256GCMChunked ||
		spec.NonceStrategy != NonceStrategyCounter32BE ||
		uint32(len(spec.ChunkHashes)) != spec.ChunkCount {
		return NewError(
			ErrorCodeInvalidArgument,
			"attachment.validate_upload_spec",
			"object",
			"does not satisfy the canonical encrypted-object profile",
		)
	}
	minimumSize := uint64(spec.ChunkCount-1)*uint64(spec.ChunkSize+spec.TagSize) +
		uint64(spec.TagSize) + 1
	maximumSize := uint64(spec.ChunkCount) * uint64(spec.ChunkSize+spec.TagSize)
	if spec.CiphertextSize < minimumSize || spec.CiphertextSize > maximumSize {
		return NewError(
			ErrorCodeInvalidArgument,
			"attachment.validate_upload_spec",
			"ciphertext_size",
			"does not match the fixed chunk geometry",
		)
	}
	plaintextSize := spec.CiphertextSize - uint64(spec.ChunkCount)*uint64(spec.TagSize)
	if plaintextSize > MaximumPlaintextSize {
		return NewError(
			ErrorCodeQuotaExceeded,
			"attachment.validate_upload_spec",
			"ciphertext_size",
			"exceeds the attachment size policy",
		)
	}

	return nil
}

func UploadCommitment(
	conversationID valueobject.ConversationID,
	messageID valueobject.MessageID,
	attachmentID string,
	authorityStation valueobject.StationID,
	canonicalSpecBytes []byte,
) valueobject.Hash {
	hash := sha256.New()
	for _, value := range [][]byte{
		[]byte(attachmentCommitmentDomain),
		[]byte(conversationID),
		[]byte(messageID),
		[]byte(attachmentID),
		[]byte(authorityStation),
		canonicalSpecBytes,
	} {
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(len(value)))
		_, _ = hash.Write(size[:])
		_, _ = hash.Write(value)
	}
	result, _ := valueobject.NewHash(hash.Sum(nil))

	return result
}

func CloneUploadSpec(spec UploadSpec) UploadSpec {
	cloned := spec
	cloned.ChunkHashes = append([]valueobject.Hash(nil), spec.ChunkHashes...)

	return cloned
}

func CloneUpload(upload Upload) Upload {
	cloned := upload
	cloned.Spec = CloneUploadSpec(upload.Spec)
	cloned.ReceivedChunkBitmap = append([]byte(nil), upload.ReceivedChunkBitmap...)

	return cloned
}

func CloneObject(object Object) Object {
	cloned := object
	cloned.Spec = CloneUploadSpec(object.Spec)

	return cloned
}

func (s *Service) completedReplay(
	ctx context.Context,
	upload Upload,
) (CompleteResult, error) {
	object, err := s.repository.GetObject(ctx, upload.ObjectID)
	if err != nil {
		return CompleteResult{}, err
	}
	audit, err := s.audit(
		AuditActionComplete,
		AuditOutcomeReplay,
		upload,
		object,
		0,
		object.Spec.CiphertextSize,
		s.clock.Now().UTC(),
	)
	if err != nil {
		return CompleteResult{}, err
	}
	if err := s.repository.AppendAudit(ctx, audit); err != nil {
		return CompleteResult{}, err
	}

	return CompleteResult{Object: CloneObject(object), Duplicate: true}, nil
}

func (s *Service) validateAuthorityRequest(
	operation string,
	conversationID valueobject.ConversationID,
	authorityStation valueobject.StationID,
) error {
	if conversationID == "" || authorityStation == "" ||
		authorityStation != s.localStation {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"authority",
			"must identify this Conversation Authority Station",
		)
	}

	return nil
}

func (s *Service) validateUploadReference(
	operation string,
	uploadID string,
	generation uint64,
	conversationID valueobject.ConversationID,
	authorityStation valueobject.StationID,
) error {
	if err := s.validateAuthorityRequest(operation, conversationID, authorityStation); err != nil {
		return err
	}
	if !validIdentifier(uploadID, 64) || generation == 0 {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"upload",
			"requires an upload ID and positive generation",
		)
	}

	return nil
}

func (s *Service) authorizeMemberEndpoint(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	endpoint valueobject.Endpoint,
	operation string,
) error {
	if endpoint.Validate() != nil {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"endpoint",
			"must contain a PTID and device ID",
		)
	}
	view, err := s.conversations.Get(ctx, conversationID, endpoint.Actor)
	if err != nil {
		if conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
			return NewError(
				ErrorCodeUnauthorized,
				operation,
				"membership",
				"actor is not an active Conversation member",
			)
		}
		return err
	}
	conversation, err := aggregate.Rehydrate(view.Conversation)
	if err != nil {
		return err
	}
	if !conversation.Status().Writable() || !containsEndpoint(conversation.ActiveEndpoints(), endpoint) {
		return NewError(
			ErrorCodeUnauthorized,
			operation,
			"membership",
			"endpoint is not active in the Conversation",
		)
	}
	active, err := s.devices.IsActive(ctx, endpoint)
	if err != nil {
		return WrapError(ErrorCodePersistence, operation+".authorize_device", err)
	}
	if !active {
		return NewError(
			ErrorCodeUnauthorized,
			operation,
			"device",
			"is not active for the authenticated actor",
		)
	}

	return nil
}

func validateChunk(
	upload Upload,
	authenticated valueobject.Endpoint,
	request PutChunkRequest,
	body []byte,
	now time.Time,
) error {
	if upload.Uploader != authenticated ||
		upload.ConversationID != request.ConversationID {
		return NewError(
			ErrorCodeUnauthorized,
			"attachment.put_chunk",
			"upload",
			"is not owned by the authenticated conversation endpoint",
		)
	}
	if upload.State != TransferStateQueued && upload.State != TransferStateTransferring {
		return NewError(
			ErrorCodeInvalidState,
			"attachment.put_chunk",
			"state",
			"is not receiving chunks",
		)
	}
	if !upload.ExpiresAt.After(now) {
		return NewError(
			ErrorCodeUploadExpired,
			"attachment.put_chunk",
			"expires_at",
			"has elapsed",
		)
	}
	if request.ChunkIndex >= upload.Spec.ChunkCount ||
		request.CiphertextSize != uint64(len(body)) ||
		request.ByteOffset != uint64(request.ChunkIndex)*uint64(upload.Spec.ChunkSize+upload.Spec.TagSize) {
		return NewError(
			ErrorCodeInvalidArgument,
			"attachment.put_chunk",
			"chunk",
			"index, offset, or size does not match the immutable upload",
		)
	}
	expectedSize := uint64(upload.Spec.ChunkSize + upload.Spec.TagSize)
	if request.ChunkIndex == upload.Spec.ChunkCount-1 {
		expectedSize = upload.Spec.CiphertextSize -
			uint64(upload.Spec.ChunkCount-1)*uint64(upload.Spec.ChunkSize+upload.Spec.TagSize)
	}
	actualHash := valueobject.HashBytes(body)
	if request.CiphertextSize != expectedSize ||
		request.CiphertextHash != actualHash ||
		request.CiphertextHash != upload.Spec.ChunkHashes[request.ChunkIndex] {
		return NewError(
			ErrorCodePartConflict,
			"attachment.put_chunk",
			"ciphertext_sha256",
			"does not match the immutable chunk commitment",
		)
	}

	return nil
}

func validateCompleteParts(upload Upload, parts []Part) error {
	if len(parts) != int(upload.Spec.ChunkCount) {
		return NewError(
			ErrorCodeInvalidState,
			"attachment.complete",
			"parts",
			"are incomplete",
		)
	}
	sort.Slice(parts, func(left int, right int) bool {
		return parts[left].ChunkIndex < parts[right].ChunkIndex
	})
	for index, part := range parts {
		if part.ChunkIndex != uint32(index) ||
			part.CiphertextHash != upload.Spec.ChunkHashes[index] {
			return NewError(
				ErrorCodePartConflict,
				"attachment.complete",
				"parts",
				"do not match the immutable chunk commitments",
			)
		}
	}

	return nil
}

func objectFromUpload(upload Upload, createdAt time.Time) Object {
	objectHash := valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("conversation-attachment-object"),
		[]byte(upload.UploadID),
		upload.DescriptorCommitment.Bytes(),
	))
	storageHash := valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("conversation-attachment-storage"),
		[]byte(upload.UploadID),
		upload.DescriptorCommitment.Bytes(),
	))
	storageRef := storageHash.String()

	return Object{
		ObjectID:             valueobject.ObjectID(objectHash.String()),
		StorageRef:           storageRef,
		StorageKey:           objectStorageKey(storageRef),
		ConversationID:       upload.ConversationID,
		MessageID:            upload.MessageID,
		AttachmentID:         upload.AttachmentID,
		Uploader:             upload.Uploader.Actor,
		Spec:                 CloneUploadSpec(upload.Spec),
		DescriptorCommitment: upload.DescriptorCommitment,
		State:                ObjectStateCompleteUnattached,
		CreatedAt:            createdAt,
	}
}

func partStorageKey(upload Upload, request PutChunkRequest) string {
	return fmt.Sprintf(
		"conversation-attachments/uploads/%s/%d/%d/%s",
		upload.UploadID,
		upload.Generation,
		request.ChunkIndex,
		request.CiphertextHash.String(),
	)
}

func objectStorageKey(storageRef string) string {
	return "conversation-attachments/objects/" + storageRef
}

func normalizeRange(start int64, end int64, size uint64) (int64, int64, error) {
	if size == 0 {
		return 0, 0, NewError(
			ErrorCodeIntegrityFailed,
			"attachment.download",
			"ciphertext_size",
			"must be positive",
		)
	}
	if start == -1 && end == -1 {
		return 0, int64(size) - 1, nil
	}
	if start < 0 || end < start || uint64(end) >= size {
		return 0, 0, NewError(
			ErrorCodeRangeInvalid,
			"attachment.download",
			"range",
			"is outside the immutable object",
		)
	}

	return start, end, nil
}

func (s *Service) audit(
	action AuditAction,
	outcome AuditOutcome,
	upload Upload,
	object Object,
	chunkIndex uint32,
	byteCount uint64,
	createdAt time.Time,
) (AuditRecord, error) {
	auditID, err := s.newIdentifier("attachment.audit", "audit_id")
	if err != nil {
		return AuditRecord{}, err
	}

	return AuditRecord{
		AuditID:        auditID,
		Action:         action,
		Outcome:        outcome,
		ConversationID: upload.ConversationID,
		MessageID:      upload.MessageID,
		AttachmentID:   upload.AttachmentID,
		UploadID:       upload.UploadID,
		ObjectID:       object.ObjectID,
		EventID:        object.EventID,
		Actor:          upload.Uploader.Actor,
		Device:         upload.Uploader.Device,
		ChunkIndex:     chunkIndex,
		ByteCount:      byteCount,
		CreatedAt:      createdAt,
	}, nil
}

func (s *Service) newIdentifier(operation string, field string) (string, error) {
	value := s.ids.NewID()
	if !validIdentifier(value, 64) {
		return "", NewError(
			ErrorCodePersistence,
			operation,
			field,
			"generator returned an invalid identifier",
		)
	}

	return value, nil
}

func validIdentifier(value string, maximumLength int) bool {
	return value != "" &&
		len(value) <= maximumLength &&
		strings.TrimSpace(value) == value &&
		!strings.ContainsAny(value, `/\`)
}

func containsEndpoint(endpoints []valueobject.Endpoint, expected valueobject.Endpoint) bool {
	for _, endpoint := range endpoints {
		if endpoint == expected {
			return true
		}
	}

	return false
}

func (s *Service) acquirePart(uploadID string) bool {
	s.partMu.Lock()
	defer s.partMu.Unlock()
	if s.activeParts[uploadID] >= s.policy.MaximumConcurrentParts {
		return false
	}
	s.activeParts[uploadID]++

	return true
}

func (s *Service) releasePart(uploadID string) {
	s.partMu.Lock()
	defer s.partMu.Unlock()
	if s.activeParts[uploadID] <= 1 {
		delete(s.activeParts, uploadID)
		return
	}
	s.activeParts[uploadID]--
}

type countingReader struct {
	reader io.Reader
	read   uint64
}

func (r *countingReader) Read(buffer []byte) (int, error) {
	count, err := r.reader.Read(buffer)
	r.read += uint64(count)

	return count, err
}

type partSequenceReader struct {
	ctx     context.Context
	blobs   BlobStore
	parts   []Part
	index   int
	current io.ReadCloser
}

func (r *partSequenceReader) Read(buffer []byte) (int, error) {
	for {
		if r.current == nil {
			if r.index >= len(r.parts) {
				return 0, io.EOF
			}
			reader, _, err := r.blobs.Open(r.ctx, r.parts[r.index].StorageKey, -1, -1)
			if err != nil {
				return 0, err
			}
			r.current = reader
		}
		count, err := r.current.Read(buffer)
		if err == io.EOF {
			if closeErr := r.current.Close(); closeErr != nil {
				return count, closeErr
			}
			r.current = nil
			r.index++
			if count > 0 {
				return count, nil
			}
			continue
		}

		return count, err
	}
}

func (r *partSequenceReader) Close() error {
	if r.current == nil {
		return nil
	}

	return r.current.Close()
}
