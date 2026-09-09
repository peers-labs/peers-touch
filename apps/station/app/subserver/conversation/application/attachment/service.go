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
		policy.UnattachedObjectTTL <= 0 ||
		policy.UnattachedObjectTTL > MaximumUnattachedObjectTTL ||
		policy.VerificationLeaseTTL <= 0 ||
		policy.VerificationLeaseTTL > MaximumVerificationLeaseTTL ||
		policy.CleanupLeaseTTL <= 0 ||
		policy.CleanupLeaseTTL > MaximumCleanupLeaseTTL ||
		policy.MaximumActiveUploads <= 0 ||
		policy.MaximumActiveUploads > MaximumActiveUploadCount ||
		policy.MaximumConcurrentParts <= 0 ||
		policy.MaximumConcurrentParts > MaximumConcurrentPartCount ||
		policy.MaximumCleanupBatchSize <= 0 ||
		policy.MaximumCleanupBatchSize > MaximumCleanupBatchSize {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"attachment.new_service",
			"policy",
			"upload, verification, orphan cleanup, concurrency, and batch limits must be bounded",
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
		CleanupNextAttemptAt: now.Add(s.policy.UploadTTL),
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
	var persisted Upload
	var inserted bool
	err = s.repository.ExecuteAuthorizedMutation(
		ctx,
		mutationAuthorization(request.ConversationID, authenticated),
		"attachment.begin",
		func(transaction Repository) error {
			var createErr error
			persisted, inserted, createErr = transaction.CreateUpload(
				ctx,
				upload,
				s.policy.MaximumActiveUploads,
				MaximumMessageObjects,
				audit,
			)

			return createErr
		},
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

	now := s.clock.Now().UTC()
	var duplicate bool
	var bitmap []byte
	err := s.repository.ExecuteAuthorizedMutation(
		ctx,
		mutationAuthorization(request.ConversationID, authenticated),
		"attachment.put_chunk",
		func(transaction Repository) error {
			upload, lockErr := transaction.LockUpload(
				ctx,
				request.UploadID,
				request.Generation,
			)
			if lockErr != nil {
				return lockErr
			}
			if validateErr := validateChunk(upload, authenticated, request, body, now); validateErr != nil {
				return validateErr
			}

			storageKey := partStorageKey(upload, request)
			if saveErr := s.blobs.Save(ctx, storageKey, bytes.NewReader(body)); saveErr != nil {
				return WrapError(
					ErrorCodePersistence,
					"attachment.put_chunk.save_blob",
					saveErr,
				)
			}
			audit, auditErr := s.audit(
				AuditActionPart,
				AuditOutcomeCommitted,
				upload,
				Object{},
				request.ChunkIndex,
				request.CiphertextSize,
				now,
			)
			if auditErr != nil {
				return auditErr
			}
			var putErr error
			duplicate, bitmap, putErr = transaction.PutPart(ctx, Part{
				UploadID:       upload.UploadID,
				Generation:     upload.Generation,
				ChunkIndex:     request.ChunkIndex,
				ByteOffset:     request.ByteOffset,
				CiphertextSize: request.CiphertextSize,
				CiphertextHash: request.CiphertextHash,
				StorageKey:     storageKey,
				CreatedAt:      now,
			}, now, audit)

			return putErr
		},
	)
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

	verification, completed, err := s.stageVerification(
		ctx,
		authenticated,
		request,
	)
	if err != nil {
		return CompleteResult{}, err
	}
	if completed {
		if err := s.deletePartBlobs(ctx, verification.Parts); err != nil {
			return CompleteResult{
				Object:    CloneObject(verification.Object),
				Duplicate: true,
			}, err
		}

		return CompleteResult{Object: CloneObject(verification.Object), Duplicate: true}, nil
	}
	if err := s.deleteSupersededVerificationBlobs(ctx, verification); err != nil {
		return CompleteResult{}, err
	}

	if err := s.assembleVerificationObject(ctx, verification); err != nil {
		return CompleteResult{}, err
	}

	finalizedAt := s.clock.Now().UTC()
	audit, err := s.audit(
		AuditActionComplete,
		AuditOutcomeCommitted,
		verification.Upload,
		verification.Object,
		0,
		verification.Object.Spec.CiphertextSize,
		finalizedAt,
	)
	if err != nil {
		return CompleteResult{}, err
	}
	var object Object
	var duplicate bool
	err = s.repository.ExecuteAuthorizedMutation(
		ctx,
		mutationAuthorization(request.ConversationID, authenticated),
		"attachment.complete.finalize",
		func(transaction Repository) error {
			var finalizeErr error
			object, duplicate, finalizeErr = transaction.FinalizeUploadVerification(
				ctx,
				request.UploadID,
				request.Generation,
				verification.Lease,
				verification.Object,
				finalizedAt,
				audit,
			)

			return finalizeErr
		},
	)
	if err != nil {
		if IsCode(err, ErrorCodeRetryLater) {
			return CompleteResult{}, errors.Join(
				err,
				s.blobs.Delete(ctx, verification.Object.StorageKey),
			)
		}

		return CompleteResult{}, err
	}
	if err := s.deletePartBlobs(ctx, verification.Parts); err != nil {
		return CompleteResult{Object: CloneObject(object), Duplicate: duplicate}, err
	}

	return CompleteResult{Object: CloneObject(object), Duplicate: duplicate}, nil
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
	now := s.clock.Now().UTC()
	var parts []Part
	err := s.repository.ExecuteAuthorizedMutation(
		ctx,
		mutationAuthorization(request.ConversationID, authenticated),
		"attachment.cancel",
		func(transaction Repository) error {
			upload, lockErr := transaction.LockUpload(
				ctx,
				request.UploadID,
				request.Generation,
			)
			if lockErr != nil {
				return lockErr
			}
			if upload.ConversationID != request.ConversationID ||
				upload.Uploader != authenticated {
				return NewError(
					ErrorCodeUnauthorized,
					"attachment.cancel",
					"upload",
					"is not owned by the authenticated conversation endpoint",
				)
			}
			audit, auditErr := s.audit(
				AuditActionCancel,
				AuditOutcomeCommitted,
				upload,
				Object{},
				0,
				0,
				now,
			)
			if auditErr != nil {
				return auditErr
			}
			var cancelErr error
			parts, _, cancelErr = transaction.CancelUpload(
				ctx,
				upload.UploadID,
				upload.Generation,
				now,
				audit,
			)

			return cancelErr
		},
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

// SweepExpired runs the bounded, lease-fenced attachment reclamation lifecycle.
func (s *Service) SweepExpired(
	ctx context.Context,
	workerID string,
) (SweepResult, error) {
	if !validIdentifier(workerID, 128) {
		return SweepResult{}, NewError(
			ErrorCodeInvalidArgument,
			"attachment.sweep_expired",
			"worker_id",
			"is required",
		)
	}

	now := s.clock.Now().UTC()
	claims, err := s.repository.ClaimExpiredUnattachedObjects(
		ctx,
		now,
		workerID,
		s.policy.CleanupLeaseTTL,
		s.policy.MaximumCleanupBatchSize,
	)
	if err != nil {
		return SweepResult{}, err
	}
	remaining := s.policy.MaximumCleanupBatchSize - len(claims)
	var uploadClaims []UploadCleanupClaim
	if remaining > 0 {
		uploadClaims, err = s.repository.ClaimExpiredUploads(
			ctx,
			now,
			workerID,
			s.policy.CleanupLeaseTTL,
			remaining,
		)
		if err != nil {
			return SweepResult{}, err
		}
	}
	result := SweepResult{Claimed: len(claims) + len(uploadClaims)}
	failures := make([]error, 0)
	for _, claim := range claims {
		if deleteErr := s.deleteStorageKeys(ctx, claim.StorageKeys); deleteErr != nil {
			failedAt := s.clock.Now().UTC()
			failures = append(failures, WrapError(
				ErrorCodePersistence,
				"attachment.sweep_expired.delete_object_blobs",
				deleteErr,
			))
			retry, retryErr := s.retryObjectCleanup(ctx, claim, failedAt)
			if retryErr != nil {
				failures = append(failures, retryErr)
			} else if retry.Terminal {
				result.Terminal++
			} else {
				result.Retried++
			}
			continue
		}

		finalizedAt := s.clock.Now().UTC()
		if _, finalizeErr := s.repository.FinalizeObjectCleanup(
			ctx,
			claim,
			finalizedAt,
		); finalizeErr != nil {
			failures = append(failures, finalizeErr)
			retry, retryErr := s.retryObjectCleanup(ctx, claim, finalizedAt)
			if retryErr != nil {
				failures = append(failures, retryErr)
			} else if retry.Terminal {
				result.Terminal++
			} else {
				result.Retried++
			}
			continue
		}
		result.Finalized++
	}
	for _, claim := range uploadClaims {
		if deleteErr := s.deleteStorageKeys(ctx, claim.StorageKeys); deleteErr != nil {
			failedAt := s.clock.Now().UTC()
			failures = append(failures, WrapError(
				ErrorCodePersistence,
				"attachment.sweep_expired.delete_upload_blobs",
				deleteErr,
			))
			retry, retryErr := s.retryUploadCleanup(ctx, claim, failedAt)
			if retryErr != nil {
				failures = append(failures, retryErr)
			} else if retry.Terminal {
				result.Terminal++
			} else {
				result.Retried++
			}
			continue
		}

		finalizedAt := s.clock.Now().UTC()
		if _, finalizeErr := s.repository.FinalizeUploadCleanup(
			ctx,
			claim,
			finalizedAt,
		); finalizeErr != nil {
			failures = append(failures, finalizeErr)
			retry, retryErr := s.retryUploadCleanup(ctx, claim, finalizedAt)
			if retryErr != nil {
				failures = append(failures, retryErr)
			} else if retry.Terminal {
				result.Terminal++
			} else {
				result.Retried++
			}
			continue
		}
		result.Finalized++
	}

	return result, errors.Join(failures...)
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

func mutationAuthorization(
	conversationID valueobject.ConversationID,
	endpoint valueobject.Endpoint,
) MutationAuthorization {
	return MutationAuthorization{
		ConversationID: conversationID,
		Endpoint:       endpoint,
	}
}

func (s *Service) stageVerification(
	ctx context.Context,
	authenticated valueobject.Endpoint,
	request CompleteRequest,
) (Verification, bool, error) {
	now := s.clock.Now().UTC()
	var verification Verification
	var completed bool
	err := s.repository.ExecuteAuthorizedMutation(
		ctx,
		mutationAuthorization(request.ConversationID, authenticated),
		"attachment.complete.stage",
		func(transaction Repository) error {
			upload, lockErr := transaction.LockUpload(
				ctx,
				request.UploadID,
				request.Generation,
			)
			if lockErr != nil {
				return lockErr
			}
			if upload.ConversationID != request.ConversationID ||
				upload.Uploader != authenticated {
				return NewError(
					ErrorCodeUnauthorized,
					"attachment.complete",
					"upload",
					"is not owned by the authenticated conversation endpoint",
				)
			}
			if upload.DescriptorCommitment != request.DescriptorCommitment {
				return NewError(
					ErrorCodePartConflict,
					"attachment.complete",
					"descriptor_commitment_sha256",
					"does not match the upload",
				)
			}
			parts, listErr := transaction.ListParts(
				ctx,
				upload.UploadID,
				upload.Generation,
			)
			if listErr != nil {
				return listErr
			}
			stage := func(attempt uint32) error {
				lease := newVerificationLease(
					upload,
					attempt,
					now,
					s.policy.VerificationLeaseTTL,
				)
				object := objectFromUpload(
					upload,
					lease,
					now,
					now.Add(s.policy.UnattachedObjectTTL),
				)
				staged, stageErr := transaction.StageUploadVerification(
					ctx,
					upload.UploadID,
					upload.Generation,
					lease,
					object,
					now,
				)
				if stageErr != nil {
					return stageErr
				}
				stagedLease, leaseErr := verificationLeaseFromUpload(staged)
				if leaseErr != nil {
					return leaseErr
				}
				verification = Verification{
					Upload: staged,
					Parts:  parts,
					Object: objectFromUpload(
						staged,
						stagedLease,
						staged.VerificationStartedAt,
						staged.VerificationStartedAt.Add(s.policy.UnattachedObjectTTL),
					),
					Lease: stagedLease,
				}

				return nil
			}

			switch upload.State {
			case TransferStateComplete:
				object, objectErr := transaction.GetObject(ctx, upload.ObjectID)
				if objectErr != nil {
					return objectErr
				}
				if object.State != ObjectStateCompleteUnattached &&
					object.State != ObjectStateAttached {
					return NewError(
						ErrorCodeInvalidState,
						"attachment.complete",
						"object",
						"is no longer available for completion replay",
					)
				}
				audit, auditErr := s.audit(
					AuditActionComplete,
					AuditOutcomeReplay,
					upload,
					object,
					0,
					object.Spec.CiphertextSize,
					now,
				)
				if auditErr != nil {
					return auditErr
				}
				if auditErr = transaction.AppendAudit(ctx, audit); auditErr != nil {
					return auditErr
				}
				verification = Verification{
					Upload: upload,
					Parts:  parts,
					Object: object,
				}
				completed = true

				return nil
			case TransferStateTransferring:
				if !upload.ExpiresAt.After(now) {
					return NewError(
						ErrorCodeUploadExpired,
						"attachment.complete",
						"expires_at",
						"has elapsed",
					)
				}
				if validationErr := validateCompleteParts(upload, parts); validationErr != nil {
					return validationErr
				}

				return stage(1)
			case TransferStateVerifying:
				if validationErr := validateCompleteParts(upload, parts); validationErr != nil {
					return validationErr
				}
				lease, leaseErr := verificationLeaseFromUpload(upload)
				if leaseErr != nil {
					return leaseErr
				}
				if lease.ExpiresAt.After(now) {
					return NewRetryError(
						"attachment.complete",
						lease.ExpiresAt.Sub(now),
						"another verifier owns the active upload lease",
					)
				}
				if lease.Attempt >= MaximumVerificationAttemptCount {
					return NewError(
						ErrorCodeInvalidState,
						"attachment.complete",
						"verification_attempt",
						"has reached the bounded verification attempt limit",
					)
				}

				return stage(lease.Attempt + 1)
			default:
				return NewError(
					ErrorCodeInvalidState,
					"attachment.complete",
					"state",
					"is not eligible for completion",
				)
			}
		},
	)
	if err != nil {
		return Verification{}, false, err
	}

	return verification, completed, nil
}

func (s *Service) assembleVerificationObject(
	ctx context.Context,
	verification Verification,
) error {
	sequenceReader := &partSequenceReader{
		ctx:   ctx,
		blobs: s.blobs,
		parts: verification.Parts,
	}
	defer sequenceReader.Close()
	wholeHash := sha256.New()
	counting := &countingReader{reader: io.TeeReader(sequenceReader, wholeHash)}
	if err := s.blobs.Save(
		ctx,
		verification.Object.StorageKey,
		counting,
	); err != nil {
		return errors.Join(
			WrapError(
				ErrorCodePersistence,
				"attachment.complete.save_object",
				err,
			),
			s.blobs.Delete(ctx, verification.Object.StorageKey),
		)
	}
	if counting.read != verification.Upload.Spec.CiphertextSize ||
		!bytes.Equal(
			wholeHash.Sum(nil),
			verification.Upload.Spec.CiphertextHash.Bytes(),
		) {
		return errors.Join(
			NewError(
				ErrorCodeIntegrityFailed,
				"attachment.complete",
				"ciphertext_sha256",
				"does not match the immutable upload commitment",
			),
			s.blobs.Delete(ctx, verification.Object.StorageKey),
		)
	}

	return nil
}

func newVerificationLease(
	upload Upload,
	attempt uint32,
	startedAt time.Time,
	ttl time.Duration,
) VerificationLease {
	return VerificationLease{
		Token: VerificationToken(
			upload.UploadID,
			upload.Generation,
			upload.DescriptorCommitment,
			attempt,
		),
		Attempt:   attempt,
		ExpiresAt: startedAt.Add(ttl),
	}
}

func verificationLeaseFromUpload(upload Upload) (VerificationLease, error) {
	expectedToken := VerificationToken(
		upload.UploadID,
		upload.Generation,
		upload.DescriptorCommitment,
		upload.VerificationAttempt,
	)
	if upload.VerificationStartedAt.IsZero() ||
		upload.VerificationLeaseExpiresAt.IsZero() ||
		!upload.VerificationLeaseExpiresAt.After(upload.VerificationStartedAt) ||
		upload.VerificationLeaseExpiresAt.Sub(upload.VerificationStartedAt) >
			MaximumVerificationLeaseTTL ||
		upload.VerificationAttempt == 0 ||
		upload.VerificationAttempt > MaximumVerificationAttemptCount ||
		upload.VerificationToken != expectedToken {
		return VerificationLease{}, NewError(
			ErrorCodeIntegrityFailed,
			"attachment.complete",
			"verification_lease",
			"does not match the durable bounded verification fence",
		)
	}

	return VerificationLease{
		Token:     upload.VerificationToken,
		Attempt:   upload.VerificationAttempt,
		ExpiresAt: upload.VerificationLeaseExpiresAt,
	}, nil
}

// VerificationToken derives the durable fencing token for one bounded
// verification attempt.
func VerificationToken(
	uploadID string,
	generation uint64,
	descriptorCommitment valueobject.Hash,
	attempt uint32,
) string {
	objectID, storageRef, _ := ImmutableObjectIdentity(uploadID, descriptorCommitment)

	return valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("conversation-attachment-verification"),
		[]byte(uploadID),
		[]byte(fmt.Sprintf("%d", generation)),
		descriptorCommitment.Bytes(),
		[]byte(objectID),
		[]byte(storageRef),
		[]byte(fmt.Sprintf("%d", attempt)),
	)).String()
}

// VerificationObjectStorageKey isolates verifier attempts so a stale verifier
// cannot delete or overwrite the blob finalized by a newer fencing token.
func VerificationObjectStorageKey(storageRef string, token string) string {
	return fmt.Sprintf(
		"conversation-attachments/verifications/%s/%s",
		storageRef,
		token,
	)
}

func (s *Service) deleteSupersededVerificationBlobs(
	ctx context.Context,
	verification Verification,
) error {
	keys := make([]string, 0, verification.Lease.Attempt-1)
	for attempt := uint32(1); attempt < verification.Lease.Attempt; attempt++ {
		token := VerificationToken(
			verification.Upload.UploadID,
			verification.Upload.Generation,
			verification.Upload.DescriptorCommitment,
			attempt,
		)
		keys = append(
			keys,
			VerificationObjectStorageKey(verification.Object.StorageRef, token),
		)
	}
	if err := s.deleteStorageKeys(ctx, keys); err != nil {
		return WrapError(
			ErrorCodePersistence,
			"attachment.complete.delete_superseded_verifications",
			err,
		)
	}

	return nil
}

func (s *Service) deletePartBlobs(ctx context.Context, parts []Part) error {
	keys := make([]string, 0, len(parts))
	for _, part := range parts {
		keys = append(keys, part.StorageKey)
	}
	if err := s.deleteStorageKeys(ctx, keys); err != nil {
		return WrapError(
			ErrorCodePersistence,
			"attachment.complete.delete_parts",
			err,
		)
	}

	return nil
}

func (s *Service) deleteStorageKeys(ctx context.Context, keys []string) error {
	canonical := append([]string(nil), keys...)
	sort.Strings(canonical)
	previous := ""
	for _, key := range canonical {
		if key == previous {
			continue
		}
		if !validAttachmentStorageKey(key) {
			return NewError(
				ErrorCodeIntegrityFailed,
				"attachment.cleanup.delete",
				"storage_key",
				"is not owned by the cleanup claim",
			)
		}
		if err := s.blobs.Delete(ctx, key); err != nil {
			return err
		}
		previous = key
	}

	return nil
}

func (s *Service) retryObjectCleanup(
	ctx context.Context,
	claim CleanupClaim,
	failedAt time.Time,
) (CleanupRetryResult, error) {
	delay := cleanupRetryDelay(claim.Object.ObjectID, claim.Attempt)
	result, err := s.repository.RetryObjectCleanup(
		ctx,
		claim,
		failedAt,
		failedAt.Add(delay),
	)

	return result, err
}

func (s *Service) retryUploadCleanup(
	ctx context.Context,
	claim UploadCleanupClaim,
	failedAt time.Time,
) (CleanupRetryResult, error) {
	delay := cleanupRetryDelay(valueobject.ObjectID(claim.Upload.UploadID), claim.Attempt)
	result, err := s.repository.RetryUploadCleanup(
		ctx,
		claim,
		failedAt,
		failedAt.Add(delay),
	)

	return result, err
}

func cleanupRetryDelay(objectID valueobject.ObjectID, attempt uint32) time.Duration {
	exponent := uint32(0)
	if attempt > 0 {
		exponent = attempt - 1
	}
	if exponent > 8 {
		exponent = 8
	}
	delay := MinimumCleanupRetryDelay << exponent
	if delay >= MaximumCleanupRetryDelay {
		return MaximumCleanupRetryDelay
	}
	jitterRange := delay / 2
	if jitterRange <= 0 {
		return delay
	}
	hash := valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("conversation-attachment-cleanup-retry"),
		[]byte(objectID),
		[]byte(fmt.Sprintf("%d", attempt)),
	))
	jitter := time.Duration(binary.BigEndian.Uint64(hash[:8]) % uint64(jitterRange))
	if delay+jitter > MaximumCleanupRetryDelay {
		return MaximumCleanupRetryDelay
	}

	return delay + jitter
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
	var totalSize uint64
	for index, part := range parts {
		expectedSize := uint64(upload.Spec.ChunkSize + upload.Spec.TagSize)
		if index == len(parts)-1 {
			expectedSize = upload.Spec.CiphertextSize -
				uint64(upload.Spec.ChunkCount-1)*uint64(upload.Spec.ChunkSize+upload.Spec.TagSize)
		}
		if part.UploadID != upload.UploadID ||
			part.Generation != upload.Generation ||
			part.ChunkIndex != uint32(index) ||
			part.ByteOffset != uint64(index)*uint64(upload.Spec.ChunkSize+upload.Spec.TagSize) ||
			part.CiphertextSize != expectedSize ||
			part.CiphertextHash != upload.Spec.ChunkHashes[index] ||
			!validAttachmentStorageKey(part.StorageKey) {
			return NewError(
				ErrorCodePartConflict,
				"attachment.complete",
				"parts",
				"do not match the immutable chunk commitments",
			)
		}
		totalSize += part.CiphertextSize
	}
	if totalSize != upload.Spec.CiphertextSize {
		return NewError(
			ErrorCodePartConflict,
			"attachment.complete",
			"ciphertext_size",
			"does not match the immutable upload",
		)
	}

	return nil
}

func objectFromUpload(
	upload Upload,
	lease VerificationLease,
	createdAt time.Time,
	expiresAt time.Time,
) Object {
	objectID, storageRef, _ := ImmutableObjectIdentity(
		upload.UploadID,
		upload.DescriptorCommitment,
	)

	return Object{
		ObjectID:             objectID,
		StorageRef:           storageRef,
		StorageKey:           VerificationObjectStorageKey(storageRef, lease.Token),
		ConversationID:       upload.ConversationID,
		MessageID:            upload.MessageID,
		AttachmentID:         upload.AttachmentID,
		Uploader:             upload.Uploader.Actor,
		Spec:                 CloneUploadSpec(upload.Spec),
		DescriptorCommitment: upload.DescriptorCommitment,
		State:                ObjectStateCompleteUnattached,
		ExpiresAt:            expiresAt,
		CleanupNextAttemptAt: expiresAt,
		CreatedAt:            createdAt,
	}
}

// ImmutableObjectIdentity derives the only object and storage identity allowed
// for a completed upload.
func ImmutableObjectIdentity(
	uploadID string,
	descriptorCommitment valueobject.Hash,
) (valueobject.ObjectID, string, string) {
	objectHash := valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("conversation-attachment-object"),
		[]byte(uploadID),
		descriptorCommitment.Bytes(),
	))
	storageHash := valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("conversation-attachment-storage"),
		[]byte(uploadID),
		descriptorCommitment.Bytes(),
	))
	storageRef := storageHash.String()

	return valueobject.ObjectID(objectHash.String()), storageRef, objectStorageKey(storageRef)
}

func partStorageKey(upload Upload, request PutChunkRequest) string {
	return ImmutablePartStorageKey(
		upload.UploadID,
		upload.Generation,
		request.ChunkIndex,
		request.CiphertextHash,
	)
}

// ImmutablePartStorageKey derives the only blob key allowed for an upload part.
func ImmutablePartStorageKey(
	uploadID string,
	generation uint64,
	chunkIndex uint32,
	ciphertextHash valueobject.Hash,
) string {
	return fmt.Sprintf(
		"conversation-attachments/uploads/%s/%d/%d/%s",
		uploadID,
		generation,
		chunkIndex,
		ciphertextHash.String(),
	)
}

func objectStorageKey(storageRef string) string {
	return "conversation-attachments/objects/" + storageRef
}

func validAttachmentStorageKey(key string) bool {
	return key != "" &&
		len(key) <= 512 &&
		strings.TrimSpace(key) == key &&
		strings.HasPrefix(key, "conversation-attachments/") &&
		!strings.HasPrefix(key, "/") &&
		!strings.Contains(key, `\`) &&
		!strings.Contains(key, "..")
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
