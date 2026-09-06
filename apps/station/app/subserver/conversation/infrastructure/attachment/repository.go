package attachment

import (
	"bytes"
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/attachment"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationpersistence "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Repository owns the canonical Conversation attachment metadata family.
type Repository struct {
	db               *gorm.DB
	sqliteMutex      sync.Mutex
	serializeSQLite  bool
	transactionBound bool
}

func NewRepository(db *gorm.DB) (*Repository, error) {
	if db == nil {
		return nil, attachment.NewError(
			attachment.ErrorCodeInvalidArgument,
			"attachment_repository.new",
			"database",
			"is required",
		)
	}

	return &Repository{
		db:              db,
		serializeSQLite: db.Dialector.Name() == "sqlite",
	}, nil
}

// AutoMigrate is test-only preparation. Production schema ownership remains at CA-W5.
func (r *Repository) AutoMigrate() error {
	if err := r.db.AutoMigrate(
		&UploadModel{},
		&UploadPartModel{},
		&ObjectModel{},
		&GrantModel{},
		&AuditModel{},
	); err != nil {
		return attachment.WrapError(
			attachment.ErrorCodePersistence,
			"attachment_repository.auto_migrate",
			err,
		)
	}

	return nil
}

func (r *Repository) ExecuteAuthorizedMutation(
	ctx context.Context,
	authorization attachment.MutationAuthorization,
	operation string,
	fn func(attachment.Repository) error,
) error {
	if authorization.ConversationID == "" ||
		authorization.Endpoint.Validate() != nil ||
		strings.TrimSpace(operation) == "" ||
		fn == nil {
		return invalid("execute_authorized_mutation", "authorization")
	}

	return r.transaction(ctx, operation, func(tx *gorm.DB) error {
		if err := requireMutationAuthorization(tx, authorization, operation); err != nil {
			return err
		}
		transaction := &Repository{
			db:               tx,
			transactionBound: true,
		}

		return fn(transaction)
	})
}

func (r *Repository) CreateUpload(
	ctx context.Context,
	upload attachment.Upload,
	maximumActiveUploads int,
	maximumMessageObjects int,
	audit attachment.AuditRecord,
) (attachment.Upload, bool, error) {
	if !r.transactionBound {
		return attachment.Upload{}, false, invalid("create_upload", "transaction")
	}
	if maximumActiveUploads <= 0 ||
		maximumActiveUploads > attachment.MaximumActiveUploadCount ||
		maximumMessageObjects <= 0 ||
		maximumMessageObjects > attachment.MaximumMessageObjects {
		return attachment.Upload{}, false, invalid("create_upload", "admission_limits")
	}
	model := uploadModel(upload)
	var persisted attachment.Upload
	var inserted bool
	err := r.transaction(ctx, "attachment_repository.create_upload", func(tx *gorm.DB) error {
		existing, found, err := findUploadByIdempotency(
			tx,
			upload.Uploader,
			upload.IdempotencyKey,
		)
		if err != nil {
			return err
		}
		if found {
			if !sameUpload(existing, model) {
				return attachment.NewError(
					attachment.ErrorCodePartConflict,
					"attachment_repository.create_upload",
					"idempotency_key",
					"already identifies a different upload",
				)
			}
			persisted, err = uploadFromModel(*existing)
			if err != nil {
				return err
			}
			audit.Outcome = attachment.AuditOutcomeReplay
			audit.UploadID = persisted.UploadID

			return appendAudit(tx, audit)
		}

		var messageObjects int64
		if err := tx.Model(&UploadModel{}).
			Where(
				"conversation_id = ? AND message_id = ? AND ("+
					"(state IN ? AND expires_at > ?) OR "+
					"(state = ? AND verification_lease_expires_at > ?) OR state = ?)",
				string(upload.ConversationID),
				string(upload.MessageID),
				[]int32{
					int32(attachment.TransferStateQueued),
					int32(attachment.TransferStateTransferring),
				},
				upload.CreatedAt,
				int32(attachment.TransferStateVerifying),
				upload.CreatedAt,
				int32(attachment.TransferStateComplete),
			).
			Count(&messageObjects).Error; err != nil {
			return err
		}
		if messageObjects >= int64(maximumMessageObjects) {
			return attachment.NewError(
				attachment.ErrorCodeQuotaExceeded,
				"attachment_repository.create_upload",
				"message_objects",
				"would exceed the per-message object limit",
			)
		}

		var active int64
		if err := tx.Model(&UploadModel{}).
			Where(
				"uploader_ptid = ? AND ("+
					"(state IN ? AND expires_at > ?) OR "+
					"(state = ? AND verification_lease_expires_at > ?))",
				string(upload.Uploader.Actor),
				[]int32{
					int32(attachment.TransferStateQueued),
					int32(attachment.TransferStateTransferring),
				},
				upload.CreatedAt,
				int32(attachment.TransferStateVerifying),
				upload.CreatedAt,
			).
			Count(&active).Error; err != nil {
			return err
		}
		if active >= int64(maximumActiveUploads) {
			return attachment.NewError(
				attachment.ErrorCodeQuotaExceeded,
				"attachment_repository.create_upload",
				"active_uploads",
				"would exceed the per-actor transfer limit",
			)
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			existing, found, err = findUploadByIdempotency(
				tx,
				upload.Uploader,
				upload.IdempotencyKey,
			)
			if err != nil {
				return err
			}
			if !found || !sameUpload(existing, model) {
				return attachment.NewError(
					attachment.ErrorCodePartConflict,
					"attachment_repository.create_upload",
					"idempotency_key",
					"raced with a different upload",
				)
			}
			persisted, err = uploadFromModel(*existing)
			if err != nil {
				return err
			}
			audit.Outcome = attachment.AuditOutcomeReplay
			audit.UploadID = persisted.UploadID

			return appendAudit(tx, audit)
		}
		inserted = true
		persisted, err = uploadFromModel(model)
		if err != nil {
			return err
		}

		return appendAudit(tx, audit)
	})
	if err != nil {
		return attachment.Upload{}, false, err
	}

	return persisted, inserted, nil
}

func (r *Repository) GetUpload(
	ctx context.Context,
	uploadID string,
	generation uint64,
) (attachment.Upload, error) {
	var model UploadModel
	err := r.db.WithContext(ctx).
		Where("upload_id = ? AND generation = ?", uploadID, generation).
		First(&model).Error
	if err != nil {
		return attachment.Upload{}, mapPersistenceError(
			"attachment_repository.get_upload",
			err,
		)
	}

	return uploadFromModel(model)
}

func (r *Repository) LockUpload(
	ctx context.Context,
	uploadID string,
	generation uint64,
) (attachment.Upload, error) {
	if !r.transactionBound {
		return attachment.Upload{}, invalid("lock_upload", "transaction")
	}
	model, err := lockUpload(r.db.WithContext(ctx), uploadID, generation)
	if err != nil {
		return attachment.Upload{}, err
	}

	return uploadFromModel(*model)
}

func (r *Repository) PutPart(
	ctx context.Context,
	part attachment.Part,
	updatedAt time.Time,
	audit attachment.AuditRecord,
) (bool, []byte, error) {
	if !r.transactionBound {
		return false, nil, invalid("put_part", "transaction")
	}
	var duplicate bool
	var bitmap []byte
	err := r.transaction(ctx, "attachment_repository.put_part", func(tx *gorm.DB) error {
		upload, err := lockUpload(tx, part.UploadID, part.Generation)
		if err != nil {
			return err
		}
		if upload.State != int32(attachment.TransferStateQueued) &&
			upload.State != int32(attachment.TransferStateTransferring) {
			return attachment.NewError(
				attachment.ErrorCodeInvalidState,
				"attachment_repository.put_part",
				"state",
				"is not receiving chunks",
			)
		}
		if !upload.ExpiresAt.After(updatedAt) {
			return attachment.NewError(
				attachment.ErrorCodeUploadExpired,
				"attachment_repository.put_part",
				"expires_at",
				"has elapsed",
			)
		}
		if part.ChunkIndex >= upload.ChunkCount {
			return invalid("put_part", "chunk_index")
		}

		var existing UploadPartModel
		findErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"upload_id = ? AND generation = ? AND chunk_index = ?",
				part.UploadID,
				part.Generation,
				part.ChunkIndex,
			).
			First(&existing).Error
		switch {
		case findErr == nil:
			if !samePart(existing, part) {
				return attachment.NewError(
					attachment.ErrorCodePartConflict,
					"attachment_repository.put_part",
					"chunk_index",
					"already identifies different bytes",
				)
			}
			duplicate = true
			bitmap = append([]byte(nil), upload.ReceivedChunkBitmap...)
			audit.Outcome = attachment.AuditOutcomeReplay

			return appendAudit(tx, audit)
		case !errors.Is(findErr, gorm.ErrRecordNotFound):
			return findErr
		}

		if err := tx.Create(&UploadPartModel{
			UploadID:         part.UploadID,
			Generation:       part.Generation,
			ChunkIndex:       part.ChunkIndex,
			ByteOffset:       part.ByteOffset,
			CiphertextSize:   part.CiphertextSize,
			CiphertextSHA256: part.CiphertextHash.Bytes(),
			StorageKey:       part.StorageKey,
			CreatedAt:        part.CreatedAt.UTC(),
		}).Error; err != nil {
			return err
		}
		bitmap = append([]byte(nil), upload.ReceivedChunkBitmap...)
		bitmap[part.ChunkIndex/8] |= 1 << (part.ChunkIndex % 8)
		result := tx.Model(&UploadModel{}).
			Where(
				"upload_id = ? AND generation = ? AND state IN ?",
				part.UploadID,
				part.Generation,
				[]int32{
					int32(attachment.TransferStateQueued),
					int32(attachment.TransferStateTransferring),
				},
			).
			Updates(map[string]any{
				"received_chunk_bitmap": bitmap,
				"state":                 int32(attachment.TransferStateTransferring),
				"updated_at":            updatedAt.UTC(),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return attachment.NewError(
				attachment.ErrorCodeInvalidState,
				"attachment_repository.put_part",
				"state",
				"changed before the part commit",
			)
		}

		return appendAudit(tx, audit)
	})
	if err != nil {
		return false, nil, err
	}

	return duplicate, bitmap, nil
}

func (r *Repository) ListParts(
	ctx context.Context,
	uploadID string,
	generation uint64,
) ([]attachment.Part, error) {
	var models []UploadPartModel
	if err := r.db.WithContext(ctx).
		Where("upload_id = ? AND generation = ?", uploadID, generation).
		Order("chunk_index ASC").
		Find(&models).Error; err != nil {
		return nil, attachment.WrapError(
			attachment.ErrorCodePersistence,
			"attachment_repository.list_parts",
			err,
		)
	}
	parts := make([]attachment.Part, 0, len(models))
	for _, model := range models {
		hash, err := valueobject.NewHash(model.CiphertextSHA256)
		if err != nil {
			return nil, attachment.WrapError(
				attachment.ErrorCodeIntegrityFailed,
				"attachment_repository.list_parts",
				err,
			)
		}
		parts = append(parts, attachment.Part{
			UploadID:       model.UploadID,
			Generation:     model.Generation,
			ChunkIndex:     model.ChunkIndex,
			ByteOffset:     model.ByteOffset,
			CiphertextSize: model.CiphertextSize,
			CiphertextHash: hash,
			StorageKey:     model.StorageKey,
			CreatedAt:      model.CreatedAt,
		})
	}

	return parts, nil
}

func (r *Repository) StageUploadVerification(
	ctx context.Context,
	uploadID string,
	generation uint64,
	lease attachment.VerificationLease,
	object attachment.Object,
	stagedAt time.Time,
) (attachment.Upload, error) {
	if !r.transactionBound {
		return attachment.Upload{}, invalid("stage_upload_verification", "transaction")
	}
	stagedAt = persistentTime(stagedAt)
	lease.ExpiresAt = persistentTime(lease.ExpiresAt)
	object.ExpiresAt = persistentTime(object.ExpiresAt)
	object.CleanupNextAttemptAt = persistentTime(object.CleanupNextAttemptAt)
	object.CreatedAt = persistentTime(object.CreatedAt)
	if !validIdentifier(lease.Token, 64) ||
		lease.Attempt == 0 ||
		lease.Attempt > attachment.MaximumVerificationAttemptCount ||
		stagedAt.IsZero() ||
		!lease.ExpiresAt.After(stagedAt) ||
		lease.ExpiresAt.Sub(stagedAt) > attachment.MaximumVerificationLeaseTTL ||
		object.State != attachment.ObjectStateCompleteUnattached ||
		!object.ExpiresAt.After(stagedAt) ||
		object.ExpiresAt.Sub(stagedAt) > attachment.MaximumUnattachedObjectTTL ||
		!object.CleanupNextAttemptAt.Equal(object.ExpiresAt) {
		return attachment.Upload{}, invalid("stage_upload_verification", "verification")
	}
	upload, err := lockUpload(r.db.WithContext(ctx), uploadID, generation)
	if err != nil {
		return attachment.Upload{}, err
	}
	expectedToken := attachment.VerificationToken(
		upload.UploadID,
		upload.Generation,
		object.DescriptorCommitment,
		lease.Attempt,
	)
	if lease.Token != expectedToken ||
		!bytes.Equal(
			upload.DescriptorCommitmentSHA256,
			object.DescriptorCommitment.Bytes(),
		) ||
		!objectMatchesUpload(object, upload) ||
		!verificationObjectIdentityMatchesUpload(object, upload, lease.Token) {
		return attachment.Upload{}, attachment.NewError(
			attachment.ErrorCodePartConflict,
			"attachment_repository.stage_upload_verification",
			"verification",
			"does not match the immutable upload and verification fence",
		)
	}

	previousState := upload.State
	previousToken := upload.VerificationToken
	previousAttempt := upload.VerificationAttemptCount
	if upload.State == int32(attachment.TransferStateVerifying) {
		commitment, commitmentErr := valueobject.NewHash(
			upload.DescriptorCommitmentSHA256,
		)
		if commitmentErr != nil {
			return attachment.Upload{}, commitmentErr
		}
		expectedExistingToken := attachment.VerificationToken(
			upload.UploadID,
			upload.Generation,
			commitment,
			upload.VerificationAttemptCount,
		)
		if upload.VerificationAttemptCount == 0 ||
			upload.VerificationAttemptCount >
				attachment.MaximumVerificationAttemptCount ||
			upload.VerificationToken != expectedExistingToken ||
			upload.VerificationStorageKey != attachment.VerificationObjectStorageKey(
				upload.StorageRef,
				expectedExistingToken,
			) ||
			upload.ObjectID != string(object.ObjectID) ||
			upload.StorageRef != object.StorageRef ||
			upload.VerificationStartedAt == nil ||
			upload.VerificationLeaseExpiresAt == nil {
			return attachment.Upload{}, attachment.NewError(
				attachment.ErrorCodeIntegrityFailed,
				"attachment_repository.stage_upload_verification",
				"verification",
				"durable verification state is incomplete",
			)
		}
		if upload.VerificationToken == lease.Token &&
			upload.VerificationAttemptCount == lease.Attempt &&
			upload.VerificationStorageKey == object.StorageKey &&
			upload.ObjectID == string(object.ObjectID) &&
			upload.StorageRef == object.StorageRef &&
			upload.VerificationStartedAt.Equal(stagedAt) &&
			upload.VerificationLeaseExpiresAt.Equal(lease.ExpiresAt) {
			return uploadFromModel(*upload)
		}
		if upload.VerificationLeaseExpiresAt.After(stagedAt) {
			return attachment.Upload{}, attachment.NewRetryError(
				"attachment_repository.stage_upload_verification",
				upload.VerificationLeaseExpiresAt.Sub(stagedAt),
				"another verifier owns the active upload lease",
			)
		}
		if upload.VerificationAttemptCount >= attachment.MaximumVerificationAttemptCount ||
			lease.Attempt != upload.VerificationAttemptCount+1 {
			return attachment.Upload{}, attachment.NewError(
				attachment.ErrorCodeInvalidState,
				"attachment_repository.stage_upload_verification",
				"verification_attempt",
				"has reached or skipped the bounded verification attempt limit",
			)
		}
	} else if upload.State == int32(attachment.TransferStateTransferring) {
		if upload.VerificationAttemptCount != 0 || lease.Attempt != 1 {
			return attachment.Upload{}, attachment.NewError(
				attachment.ErrorCodePartConflict,
				"attachment_repository.stage_upload_verification",
				"verification_attempt",
				"does not start at the first verification fence",
			)
		}
	} else {
		return attachment.Upload{}, attachment.NewError(
			attachment.ErrorCodeInvalidState,
			"attachment_repository.stage_upload_verification",
			"state",
			"is not ready for verification",
		)
	}
	parts, err := loadPartModels(r.db.WithContext(ctx), uploadID, generation)
	if err != nil {
		return attachment.Upload{}, err
	}
	if err := validateStoredParts(upload, parts); err != nil {
		return attachment.Upload{}, err
	}
	result := r.db.WithContext(ctx).
		Model(&UploadModel{}).
		Where(
			"upload_id = ? AND generation = ? AND state = ? "+
				"AND verification_token = ? AND verification_attempt_count = ?",
			uploadID,
			generation,
			previousState,
			previousToken,
			previousAttempt,
		).
		Updates(map[string]any{
			"state":                         int32(attachment.TransferStateVerifying),
			"object_id":                     string(object.ObjectID),
			"storage_ref":                   object.StorageRef,
			"verification_token":            lease.Token,
			"verification_storage_key":      object.StorageKey,
			"verification_started_at":       stagedAt,
			"verification_lease_expires_at": lease.ExpiresAt,
			"verification_attempt_count":    lease.Attempt,
			"cleanup_next_attempt_at":       lease.ExpiresAt,
			"updated_at":                    stagedAt,
		})
	if result.Error != nil {
		return attachment.Upload{}, result.Error
	}
	if result.RowsAffected != 1 {
		return attachment.Upload{}, attachment.NewError(
			attachment.ErrorCodeInvalidState,
			"attachment_repository.stage_upload_verification",
			"state",
			"changed before verification staging",
		)
	}
	upload.State = int32(attachment.TransferStateVerifying)
	upload.ObjectID = string(object.ObjectID)
	upload.StorageRef = object.StorageRef
	upload.VerificationToken = lease.Token
	upload.VerificationStorageKey = object.StorageKey
	upload.VerificationStartedAt = &stagedAt
	upload.VerificationLeaseExpiresAt = &lease.ExpiresAt
	upload.VerificationAttemptCount = lease.Attempt
	upload.CleanupNextAttemptAt = lease.ExpiresAt
	upload.UpdatedAt = stagedAt

	return uploadFromModel(*upload)
}

func (r *Repository) FinalizeUploadVerification(
	ctx context.Context,
	uploadID string,
	generation uint64,
	lease attachment.VerificationLease,
	object attachment.Object,
	finalizedAt time.Time,
	audit attachment.AuditRecord,
) (attachment.Object, bool, error) {
	if !r.transactionBound {
		return attachment.Object{}, false, invalid(
			"finalize_upload_verification",
			"transaction",
		)
	}
	finalizedAt = persistentTime(finalizedAt)
	lease.ExpiresAt = persistentTime(lease.ExpiresAt)
	object.ExpiresAt = persistentTime(object.ExpiresAt)
	object.CleanupNextAttemptAt = persistentTime(object.CleanupNextAttemptAt)
	object.CreatedAt = persistentTime(object.CreatedAt)
	if !validIdentifier(lease.Token, 64) ||
		lease.Attempt == 0 ||
		lease.Attempt > attachment.MaximumVerificationAttemptCount ||
		lease.ExpiresAt.IsZero() ||
		finalizedAt.IsZero() ||
		object.State != attachment.ObjectStateCompleteUnattached ||
		!object.ExpiresAt.After(object.CreatedAt) ||
		object.ExpiresAt.Sub(object.CreatedAt) > attachment.MaximumUnattachedObjectTTL ||
		!object.CleanupNextAttemptAt.Equal(object.ExpiresAt) {
		return attachment.Object{}, false, invalid(
			"finalize_upload_verification",
			"verification",
		)
	}

	upload, err := lockUpload(r.db.WithContext(ctx), uploadID, generation)
	if err != nil {
		return attachment.Object{}, false, err
	}
	if upload.State == int32(attachment.TransferStateComplete) {
		existing, objectErr := getObject(
			r.db.WithContext(ctx),
			valueobject.ObjectID(upload.ObjectID),
		)
		if objectErr != nil {
			return attachment.Object{}, false, objectErr
		}
		if upload.VerificationToken != lease.Token ||
			upload.VerificationAttemptCount != lease.Attempt ||
			upload.VerificationLeaseExpiresAt == nil ||
			!upload.VerificationLeaseExpiresAt.Equal(lease.ExpiresAt) ||
			!sameObject(existing, object) {
			return attachment.Object{}, false, attachment.NewError(
				attachment.ErrorCodeRetryLater,
				"attachment_repository.finalize_upload_verification",
				"verification_lease",
				"was superseded before this verifier finalized",
			)
		}
		audit.Outcome = attachment.AuditOutcomeReplay
		if err := appendAudit(r.db.WithContext(ctx), audit); err != nil {
			return attachment.Object{}, false, err
		}

		return existing, true, nil
	}
	if upload.State != int32(attachment.TransferStateVerifying) ||
		upload.VerificationToken != lease.Token ||
		upload.VerificationAttemptCount != lease.Attempt ||
		upload.VerificationStorageKey != object.StorageKey ||
		upload.ObjectID != string(object.ObjectID) ||
		upload.StorageRef != object.StorageRef ||
		upload.VerificationStartedAt == nil ||
		upload.VerificationLeaseExpiresAt == nil ||
		!upload.VerificationLeaseExpiresAt.Equal(lease.ExpiresAt) ||
		!lease.ExpiresAt.After(finalizedAt) ||
		!upload.VerificationStartedAt.Equal(object.CreatedAt) ||
		!bytes.Equal(
			upload.DescriptorCommitmentSHA256,
			object.DescriptorCommitment.Bytes(),
		) ||
		!objectMatchesUpload(object, upload) ||
		!verificationObjectIdentityMatchesUpload(object, upload, lease.Token) {
		return attachment.Object{}, false, attachment.NewError(
			attachment.ErrorCodeRetryLater,
			"attachment_repository.finalize_upload_verification",
			"verification_lease",
			"is expired, stale, or no longer owns the upload",
		)
	}
	parts, err := loadPartModels(r.db.WithContext(ctx), uploadID, generation)
	if err != nil {
		return attachment.Object{}, false, err
	}
	if err := validateStoredParts(upload, parts); err != nil {
		return attachment.Object{}, false, err
	}

	model := objectModel(object)
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model)
	if result.Error != nil {
		return attachment.Object{}, false, result.Error
	}
	existing, err := getObject(r.db.WithContext(ctx), object.ObjectID)
	if err != nil {
		return attachment.Object{}, false, err
	}
	if !sameObject(existing, object) {
		return attachment.Object{}, false, attachment.NewError(
			attachment.ErrorCodePartConflict,
			"attachment_repository.finalize_upload_verification",
			"object_id",
			"already identifies a different object",
		)
	}
	update := r.db.WithContext(ctx).
		Model(&UploadModel{}).
		Where(
			"upload_id = ? AND generation = ? AND state = ? "+
				"AND verification_token = ? AND verification_attempt_count = ? "+
				"AND verification_lease_expires_at = ?",
			uploadID,
			generation,
			int32(attachment.TransferStateVerifying),
			lease.Token,
			lease.Attempt,
			lease.ExpiresAt,
		).
		Updates(map[string]any{
			"state":      int32(attachment.TransferStateComplete),
			"updated_at": finalizedAt,
		})
	if update.Error != nil {
		return attachment.Object{}, false, update.Error
	}
	if update.RowsAffected != 1 {
		return attachment.Object{}, false, attachment.NewError(
			attachment.ErrorCodeRetryLater,
			"attachment_repository.finalize_upload_verification",
			"verification_lease",
			"was lost before verification finalization",
		)
	}
	if err := appendAudit(r.db.WithContext(ctx), audit); err != nil {
		return attachment.Object{}, false, err
	}

	return existing, false, nil
}

func (r *Repository) CancelUpload(
	ctx context.Context,
	uploadID string,
	generation uint64,
	cancelledAt time.Time,
	audit attachment.AuditRecord,
) ([]attachment.Part, bool, error) {
	if !r.transactionBound {
		return nil, false, invalid("cancel_upload", "transaction")
	}
	var parts []attachment.Part
	var duplicate bool
	err := r.transaction(ctx, "attachment_repository.cancel_upload", func(tx *gorm.DB) error {
		upload, err := lockUpload(tx, uploadID, generation)
		if err != nil {
			return err
		}
		switch attachment.TransferState(upload.State) {
		case attachment.TransferStateCancelled:
			duplicate = true
			audit.Outcome = attachment.AuditOutcomeReplay
		case attachment.TransferStateQueued, attachment.TransferStateTransferring:
			if err := tx.Model(&UploadModel{}).
				Where("upload_id = ? AND generation = ?", uploadID, generation).
				Updates(map[string]any{
					"state":      int32(attachment.TransferStateCancelled),
					"updated_at": cancelledAt.UTC(),
				}).Error; err != nil {
				return err
			}
		default:
			return attachment.NewError(
				attachment.ErrorCodeInvalidState,
				"attachment_repository.cancel_upload",
				"state",
				"cannot be cancelled",
			)
		}
		var models []UploadPartModel
		if err := tx.Where("upload_id = ? AND generation = ?", uploadID, generation).
			Order("chunk_index ASC").
			Find(&models).Error; err != nil {
			return err
		}
		for _, model := range models {
			hash, err := valueobject.NewHash(model.CiphertextSHA256)
			if err != nil {
				return err
			}
			parts = append(parts, attachment.Part{
				UploadID:       model.UploadID,
				Generation:     model.Generation,
				ChunkIndex:     model.ChunkIndex,
				ByteOffset:     model.ByteOffset,
				CiphertextSize: model.CiphertextSize,
				CiphertextHash: hash,
				StorageKey:     model.StorageKey,
				CreatedAt:      model.CreatedAt,
			})
		}

		return appendAudit(tx, audit)
	})
	if err != nil {
		return nil, false, err
	}

	return parts, duplicate, nil
}

func (r *Repository) GetObject(
	ctx context.Context,
	objectID valueobject.ObjectID,
) (attachment.Object, error) {
	return getObject(r.db.WithContext(ctx), objectID)
}

func (r *Repository) GetGrantedObject(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	objectID valueobject.ObjectID,
	recipient valueobject.PTID,
) (attachment.Object, error) {
	var model ObjectModel
	err := r.db.WithContext(ctx).
		Table("conversation_attachment_objects AS objects").
		Select("objects.*").
		Joins(
			"JOIN conversation_attachment_grants AS grants "+
				"ON grants.object_id = objects.object_id "+
				"AND grants.conversation_id = objects.conversation_id",
		).
		Where(
			"objects.object_id = ? AND objects.conversation_id = ? "+
				"AND objects.state = ? AND grants.recipient_ptid = ?",
			string(objectID),
			string(conversationID),
			string(attachment.ObjectStateAttached),
			string(recipient),
		).
		First(&model).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return attachment.Object{}, attachment.NewError(
			attachment.ErrorCodeNotGranted,
			"attachment_repository.get_granted_object",
			"grant",
			"does not authorize this actor and object",
		)
	}
	if err != nil {
		return attachment.Object{}, attachment.WrapError(
			attachment.ErrorCodePersistence,
			"attachment_repository.get_granted_object",
			err,
		)
	}

	return objectFromModel(model)
}

func (r *Repository) ClaimExpiredUnattachedObjects(
	ctx context.Context,
	now time.Time,
	leaseOwner string,
	leaseTTL time.Duration,
	limit int,
) ([]attachment.CleanupClaim, error) {
	now = persistentTime(now)
	if now.IsZero() ||
		!validIdentifier(leaseOwner, 128) ||
		leaseTTL <= 0 ||
		leaseTTL > attachment.MaximumCleanupLeaseTTL ||
		limit <= 0 ||
		limit > attachment.MaximumCleanupBatchSize {
		return nil, invalid("claim_expired_unattached_objects", "claim")
	}

	claims := make([]attachment.CleanupClaim, 0, limit)
	err := r.transaction(
		ctx,
		"attachment_repository.claim_expired_unattached_objects",
		func(tx *gorm.DB) error {
			var models []ObjectModel
			if err := tx.Clauses(clause.Locking{
				Strength: "UPDATE",
				Options:  "SKIP LOCKED",
			}).
				Where(
					"event_id = ? AND cleanup_completed_at IS NULL AND ("+
						"(state = ? AND expires_at <= ? AND cleanup_next_attempt_at <= ?) OR "+
						"(state = ? AND cleanup_lease_expires_at <= ?))",
					"",
					string(attachment.ObjectStateCompleteUnattached),
					now,
					now,
					string(attachment.ObjectStateCleanupClaimed),
					now,
				).
				Order("cleanup_next_attempt_at ASC, object_id ASC").
				Limit(limit).
				Find(&models).Error; err != nil {
				return err
			}

			leaseExpiresAt := persistentTime(now.Add(leaseTTL))
			for index := range models {
				model := &models[index]
				previousState := model.State
				previousAttempt := model.CleanupAttemptCount
				model.State = string(attachment.ObjectStateCleanupClaimed)
				model.CleanupLeaseOwner = leaseOwner
				model.CleanupLeaseExpiresAt = &leaseExpiresAt
				model.CleanupAttemptCount++
				result := tx.Model(&ObjectModel{}).
					Where(
						"object_id = ? AND event_id = ? AND cleanup_completed_at IS NULL "+
							"AND state = ? AND cleanup_attempt_count = ?",
						model.ObjectID,
						"",
						previousState,
						previousAttempt,
					).
					Updates(map[string]any{
						"state":                    model.State,
						"cleanup_lease_owner":      model.CleanupLeaseOwner,
						"cleanup_lease_expires_at": leaseExpiresAt,
						"cleanup_attempt_count":    model.CleanupAttemptCount,
					})
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					return attachment.NewError(
						attachment.ErrorCodeRetryLater,
						"attachment_repository.claim_expired_unattached_objects",
						"object",
						"changed before cleanup claim",
					)
				}
				object, err := objectFromModel(*model)
				if err != nil {
					return err
				}
				storageKeys, err := cleanupKeysForObject(tx, *model)
				if err != nil {
					return err
				}
				claim := attachment.CleanupClaim{
					Object:         object,
					StorageKeys:    storageKeys,
					LeaseOwner:     leaseOwner,
					Attempt:        model.CleanupAttemptCount,
					LeaseExpiresAt: leaseExpiresAt,
				}
				if err := appendAudit(
					tx,
					cleanupAudit(claim, attachment.AuditActionGCClaim, attachment.AuditOutcomeCommitted, now),
				); err != nil {
					return err
				}
				claims = append(claims, claim)
			}

			return nil
		},
	)
	if err != nil {
		return nil, err
	}

	return claims, nil
}

func (r *Repository) FinalizeObjectCleanup(
	ctx context.Context,
	claim attachment.CleanupClaim,
	completedAt time.Time,
) (bool, error) {
	completedAt = persistentTime(completedAt)
	if err := validateCleanupClaim(claim); err != nil || completedAt.IsZero() {
		return false, invalid("finalize_object_cleanup", "claim")
	}

	var replay bool
	err := r.transaction(ctx, "attachment_repository.finalize_object_cleanup", func(tx *gorm.DB) error {
		model, err := lockObject(tx, claim.Object.ObjectID)
		if err != nil {
			return err
		}
		if model.State == string(attachment.ObjectStateGarbageCollected) &&
			model.CleanupLeaseOwner == claim.LeaseOwner &&
			model.CleanupAttemptCount == claim.Attempt {
			replay = true

			return appendAudit(
				tx,
				cleanupAudit(claim, attachment.AuditActionGCFinish, attachment.AuditOutcomeReplay, completedAt),
			)
		}
		if model.State != string(attachment.ObjectStateCleanupClaimed) ||
			model.EventID != "" ||
			model.CleanupLeaseOwner != claim.LeaseOwner ||
			model.CleanupAttemptCount != claim.Attempt ||
			model.CleanupLeaseExpiresAt == nil ||
			!model.CleanupLeaseExpiresAt.After(completedAt) {
			return attachment.NewError(
				attachment.ErrorCodeRetryLater,
				"attachment_repository.finalize_object_cleanup",
				"lease",
				"is stale or no longer owns the object",
			)
		}

		completed := completedAt
		result := tx.Model(&ObjectModel{}).
			Where(
				"object_id = ? AND state = ? AND cleanup_lease_owner = ? "+
					"AND cleanup_attempt_count = ? AND event_id = ?",
				model.ObjectID,
				string(attachment.ObjectStateCleanupClaimed),
				claim.LeaseOwner,
				claim.Attempt,
				"",
			).
			Updates(map[string]any{
				"state":                string(attachment.ObjectStateGarbageCollected),
				"storage_key":          "",
				"cleanup_completed_at": completed,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return attachment.NewError(
				attachment.ErrorCodeRetryLater,
				"attachment_repository.finalize_object_cleanup",
				"lease",
				"lost cleanup ownership before finalization",
			)
		}
		if err := tx.Model(&UploadModel{}).
			Where(
				"object_id = ? AND state = ?",
				model.ObjectID,
				int32(attachment.TransferStateComplete),
			).
			Updates(map[string]any{
				"state":                    int32(attachment.TransferStateTerminal),
				"verification_storage_key": "",
				"cleanup_lease_expires_at": nil,
				"cleanup_completed_at":     completed,
				"updated_at":               completed,
			}).Error; err != nil {
			return err
		}

		return appendAudit(
			tx,
			cleanupAudit(claim, attachment.AuditActionGCFinish, attachment.AuditOutcomeCommitted, completedAt),
		)
	})

	return replay, err
}

func (r *Repository) RetryObjectCleanup(
	ctx context.Context,
	claim attachment.CleanupClaim,
	failedAt time.Time,
	nextAttemptAt time.Time,
) (attachment.CleanupRetryResult, error) {
	failedAt = persistentTime(failedAt)
	nextAttemptAt = persistentTime(nextAttemptAt)
	delay := nextAttemptAt.Sub(failedAt)
	if err := validateCleanupClaim(claim); err != nil ||
		failedAt.IsZero() ||
		delay < attachment.MinimumCleanupRetryDelay ||
		delay > attachment.MaximumCleanupRetryDelay {
		return attachment.CleanupRetryResult{}, invalid("retry_object_cleanup", "retry")
	}

	var result attachment.CleanupRetryResult
	err := r.transaction(ctx, "attachment_repository.retry_object_cleanup", func(tx *gorm.DB) error {
		model, err := lockObject(tx, claim.Object.ObjectID)
		if err != nil {
			return err
		}
		if ((model.State == string(attachment.ObjectStateCompleteUnattached) &&
			model.CleanupNextAttemptAt.Equal(nextAttemptAt)) ||
			model.State == string(attachment.ObjectStateCleanupFailed)) &&
			model.CleanupLeaseOwner == claim.LeaseOwner &&
			model.CleanupAttemptCount == claim.Attempt {
			result.Replay = true
			result.Terminal = model.State == string(attachment.ObjectStateCleanupFailed)

			return appendAudit(
				tx,
				cleanupAudit(claim, attachment.AuditActionGCRetry, attachment.AuditOutcomeReplay, failedAt),
			)
		}
		if model.State != string(attachment.ObjectStateCleanupClaimed) ||
			model.EventID != "" ||
			model.CleanupLeaseOwner != claim.LeaseOwner ||
			model.CleanupAttemptCount != claim.Attempt {
			return attachment.NewError(
				attachment.ErrorCodeRetryLater,
				"attachment_repository.retry_object_cleanup",
				"lease",
				"is stale or no longer owns the object",
			)
		}

		nextState := attachment.ObjectStateCompleteUnattached
		if claim.Attempt >= attachment.MaximumCleanupAttemptCount {
			nextState = attachment.ObjectStateCleanupFailed
			result.Terminal = true
		}
		result := tx.Model(&ObjectModel{}).
			Where(
				"object_id = ? AND state = ? AND cleanup_lease_owner = ? "+
					"AND cleanup_attempt_count = ? AND event_id = ?",
				model.ObjectID,
				string(attachment.ObjectStateCleanupClaimed),
				claim.LeaseOwner,
				claim.Attempt,
				"",
			).
			Updates(map[string]any{
				"state":                    string(nextState),
				"cleanup_lease_expires_at": nil,
				"cleanup_next_attempt_at":  nextAttemptAt,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return attachment.NewError(
				attachment.ErrorCodeRetryLater,
				"attachment_repository.retry_object_cleanup",
				"lease",
				"lost cleanup ownership before retry scheduling",
			)
		}

		return appendAudit(
			tx,
			cleanupAudit(claim, attachment.AuditActionGCRetry, attachment.AuditOutcomeCommitted, failedAt),
		)
	})

	return result, err
}

func (r *Repository) ClaimExpiredUploads(
	ctx context.Context,
	now time.Time,
	leaseOwner string,
	leaseTTL time.Duration,
	limit int,
) ([]attachment.UploadCleanupClaim, error) {
	now = persistentTime(now)
	if now.IsZero() ||
		!validIdentifier(leaseOwner, 128) ||
		leaseTTL <= 0 ||
		leaseTTL > attachment.MaximumCleanupLeaseTTL ||
		limit <= 0 ||
		limit > attachment.MaximumCleanupBatchSize {
		return nil, invalid("claim_expired_uploads", "claim")
	}

	claims := make([]attachment.UploadCleanupClaim, 0, limit)
	err := r.transaction(ctx, "attachment_repository.claim_expired_uploads", func(tx *gorm.DB) error {
		var models []UploadModel
		if err := tx.Clauses(clause.Locking{
			Strength: "UPDATE",
			Options:  "SKIP LOCKED",
		}).
			Where(
				"cleanup_completed_at IS NULL AND ("+
					"(state IN ? AND expires_at <= ? AND cleanup_next_attempt_at <= ?) OR "+
					"(state = ? AND verification_lease_expires_at IS NOT NULL "+
					"AND verification_lease_expires_at <= ?) OR "+
					"(state = ? AND cleanup_next_attempt_at <= ?) OR "+
					"(state = ? AND cleanup_lease_expires_at <= ?))",
				[]int32{
					int32(attachment.TransferStateQueued),
					int32(attachment.TransferStateTransferring),
					int32(attachment.TransferStateCancelled),
					int32(attachment.TransferStateTerminal),
				},
				now,
				now,
				int32(attachment.TransferStateVerifying),
				now,
				int32(attachment.TransferStateRetryWait),
				now,
				int32(attachment.TransferStateCleanupClaimed),
				now,
			).
			Order("cleanup_next_attempt_at ASC, upload_id ASC").
			Limit(limit).
			Find(&models).Error; err != nil {
			return err
		}

		leaseExpiresAt := persistentTime(now.Add(leaseTTL))
		for index := range models {
			model := &models[index]
			previousState := model.State
			previousAttempt := model.CleanupAttemptCount
			model.State = int32(attachment.TransferStateCleanupClaimed)
			model.CleanupLeaseOwner = leaseOwner
			model.CleanupLeaseExpiresAt = &leaseExpiresAt
			model.CleanupAttemptCount++
			result := tx.Model(&UploadModel{}).
				Where(
					"upload_id = ? AND generation = ? AND state = ? "+
						"AND cleanup_attempt_count = ? AND cleanup_completed_at IS NULL",
					model.UploadID,
					model.Generation,
					previousState,
					previousAttempt,
				).
				Updates(map[string]any{
					"state":                    model.State,
					"cleanup_lease_owner":      model.CleanupLeaseOwner,
					"cleanup_lease_expires_at": leaseExpiresAt,
					"cleanup_attempt_count":    model.CleanupAttemptCount,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return attachment.NewError(
					attachment.ErrorCodeRetryLater,
					"attachment_repository.claim_expired_uploads",
					"upload",
					"changed before cleanup claim",
				)
			}
			upload, err := uploadFromModel(*model)
			if err != nil {
				return err
			}
			storageKeys, err := cleanupKeysForUpload(tx, *model)
			if err != nil {
				return err
			}
			claim := attachment.UploadCleanupClaim{
				Upload:         upload,
				StorageKeys:    storageKeys,
				LeaseOwner:     leaseOwner,
				Attempt:        model.CleanupAttemptCount,
				LeaseExpiresAt: leaseExpiresAt,
			}
			if err := appendAudit(
				tx,
				uploadCleanupAudit(
					claim,
					attachment.AuditActionGCClaim,
					attachment.AuditOutcomeCommitted,
					now,
				),
			); err != nil {
				return err
			}
			claims = append(claims, claim)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return claims, nil
}

func (r *Repository) FinalizeUploadCleanup(
	ctx context.Context,
	claim attachment.UploadCleanupClaim,
	completedAt time.Time,
) (bool, error) {
	completedAt = persistentTime(completedAt)
	if err := validateUploadCleanupClaim(claim); err != nil || completedAt.IsZero() {
		return false, invalid("finalize_upload_cleanup", "claim")
	}

	var replay bool
	err := r.transaction(ctx, "attachment_repository.finalize_upload_cleanup", func(tx *gorm.DB) error {
		model, err := lockUpload(tx, claim.Upload.UploadID, claim.Upload.Generation)
		if err != nil {
			return err
		}
		if model.State == int32(attachment.TransferStateTerminal) &&
			model.CleanupCompletedAt != nil &&
			model.CleanupLeaseOwner == claim.LeaseOwner &&
			model.CleanupAttemptCount == claim.Attempt {
			replay = true

			return appendAudit(
				tx,
				uploadCleanupAudit(
					claim,
					attachment.AuditActionGCFinish,
					attachment.AuditOutcomeReplay,
					completedAt,
				),
			)
		}
		if model.State != int32(attachment.TransferStateCleanupClaimed) ||
			model.CleanupLeaseOwner != claim.LeaseOwner ||
			model.CleanupAttemptCount != claim.Attempt ||
			model.CleanupLeaseExpiresAt == nil ||
			!model.CleanupLeaseExpiresAt.After(completedAt) {
			return attachment.NewError(
				attachment.ErrorCodeRetryLater,
				"attachment_repository.finalize_upload_cleanup",
				"lease",
				"is stale or no longer owns the upload",
			)
		}

		completed := completedAt
		result := tx.Model(&UploadModel{}).
			Where(
				"upload_id = ? AND generation = ? AND state = ? "+
					"AND cleanup_lease_owner = ? AND cleanup_attempt_count = ?",
				model.UploadID,
				model.Generation,
				int32(attachment.TransferStateCleanupClaimed),
				claim.LeaseOwner,
				claim.Attempt,
			).
			Updates(map[string]any{
				"state":                    int32(attachment.TransferStateTerminal),
				"verification_storage_key": "",
				"cleanup_lease_expires_at": nil,
				"cleanup_completed_at":     completed,
				"updated_at":               completed,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return attachment.NewError(
				attachment.ErrorCodeRetryLater,
				"attachment_repository.finalize_upload_cleanup",
				"lease",
				"lost cleanup ownership before finalization",
			)
		}

		return appendAudit(
			tx,
			uploadCleanupAudit(
				claim,
				attachment.AuditActionGCFinish,
				attachment.AuditOutcomeCommitted,
				completedAt,
			),
		)
	})

	return replay, err
}

func (r *Repository) RetryUploadCleanup(
	ctx context.Context,
	claim attachment.UploadCleanupClaim,
	failedAt time.Time,
	nextAttemptAt time.Time,
) (attachment.CleanupRetryResult, error) {
	failedAt = persistentTime(failedAt)
	nextAttemptAt = persistentTime(nextAttemptAt)
	delay := nextAttemptAt.Sub(failedAt)
	if err := validateUploadCleanupClaim(claim); err != nil ||
		failedAt.IsZero() ||
		delay < attachment.MinimumCleanupRetryDelay ||
		delay > attachment.MaximumCleanupRetryDelay {
		return attachment.CleanupRetryResult{}, invalid("retry_upload_cleanup", "retry")
	}

	var retry attachment.CleanupRetryResult
	err := r.transaction(ctx, "attachment_repository.retry_upload_cleanup", func(tx *gorm.DB) error {
		model, err := lockUpload(tx, claim.Upload.UploadID, claim.Upload.Generation)
		if err != nil {
			return err
		}
		if ((model.State == int32(attachment.TransferStateRetryWait) &&
			model.CleanupNextAttemptAt.Equal(nextAttemptAt)) ||
			model.State == int32(attachment.TransferStateCleanupFailed)) &&
			model.CleanupLeaseOwner == claim.LeaseOwner &&
			model.CleanupAttemptCount == claim.Attempt {
			retry.Replay = true
			retry.Terminal = model.State == int32(attachment.TransferStateCleanupFailed)

			return appendAudit(
				tx,
				uploadCleanupAudit(
					claim,
					attachment.AuditActionGCRetry,
					attachment.AuditOutcomeReplay,
					failedAt,
				),
			)
		}
		if model.State != int32(attachment.TransferStateCleanupClaimed) ||
			model.CleanupLeaseOwner != claim.LeaseOwner ||
			model.CleanupAttemptCount != claim.Attempt {
			return attachment.NewError(
				attachment.ErrorCodeRetryLater,
				"attachment_repository.retry_upload_cleanup",
				"lease",
				"is stale or no longer owns the upload",
			)
		}

		nextState := attachment.TransferStateRetryWait
		if claim.Attempt >= attachment.MaximumCleanupAttemptCount {
			nextState = attachment.TransferStateCleanupFailed
			retry.Terminal = true
		}
		result := tx.Model(&UploadModel{}).
			Where(
				"upload_id = ? AND generation = ? AND state = ? "+
					"AND cleanup_lease_owner = ? AND cleanup_attempt_count = ?",
				model.UploadID,
				model.Generation,
				int32(attachment.TransferStateCleanupClaimed),
				claim.LeaseOwner,
				claim.Attempt,
			).
			Updates(map[string]any{
				"state":                    int32(nextState),
				"cleanup_lease_expires_at": nil,
				"cleanup_next_attempt_at":  nextAttemptAt,
				"updated_at":               failedAt,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return attachment.NewError(
				attachment.ErrorCodeRetryLater,
				"attachment_repository.retry_upload_cleanup",
				"lease",
				"lost cleanup ownership before retry scheduling",
			)
		}

		return appendAudit(
			tx,
			uploadCleanupAudit(
				claim,
				attachment.AuditActionGCRetry,
				attachment.AuditOutcomeCommitted,
				failedAt,
			),
		)
	})

	return retry, err
}

func (r *Repository) AppendAudit(
	ctx context.Context,
	record attachment.AuditRecord,
) error {
	return r.transaction(ctx, "attachment_repository.append_audit", func(tx *gorm.DB) error {
		return appendAudit(tx, record)
	})
}

// GrantBatch atomically binds an exact committed message object and recipient set.
func (r *Repository) GrantBatch(
	ctx context.Context,
	grant ports.ObjectGrantBatch,
) error {
	objectIDs, recipients, err := validateGrantBatch(grant)
	if err != nil {
		return err
	}
	grantedAt := persistentTime(grant.GrantedAt)

	return r.transaction(ctx, "attachment_repository.grant_batch", func(tx *gorm.DB) error {
		var objects []ObjectModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("object_id IN ?", objectIDs).
			Order("object_id ASC").
			Find(&objects).Error; err != nil {
			return err
		}
		if len(objects) != len(objectIDs) {
			return attachment.NewError(
				attachment.ErrorCodeNotFound,
				"attachment_repository.grant_batch",
				"objects",
				"the exact committed object set was not found",
			)
		}

		allUnattached := true
		allReplay := true
		var totalPlaintext uint64
		for index := range objects {
			object := &objects[index]
			if object.ObjectID != objectIDs[index] ||
				object.ConversationID != string(grant.ConversationID) ||
				object.MessageID != string(grant.MessageID) ||
				object.UploaderPTID != string(grant.Uploader) {
				return attachment.NewError(
					attachment.ErrorCodePartConflict,
					"attachment_repository.grant_batch",
					"objects",
					"do not match the committed conversation, message, and uploader",
				)
			}
			switch {
			case object.State == string(attachment.ObjectStateCompleteUnattached) &&
				object.EventID == "":
				allReplay = false
				if !object.ExpiresAt.After(grantedAt) {
					return attachment.NewError(
						attachment.ErrorCodeUploadExpired,
						"attachment_repository.grant_batch",
						"objects",
						"contain an expired unattached object",
					)
				}
			case object.State == string(attachment.ObjectStateAttached) &&
				object.EventID == string(grant.EventID):
				allUnattached = false
			case object.State == string(attachment.ObjectStateAttached):
				return attachment.NewError(
					attachment.ErrorCodePartConflict,
					"attachment_repository.grant_batch",
					"event_id",
					"object is already bound to a different event",
				)
			default:
				return attachment.NewError(
					attachment.ErrorCodeInvalidState,
					"attachment_repository.grant_batch",
					"objects",
					"are not uniformly grantable for the committed event",
				)
			}
			if grantedAt.Before(persistentTime(object.CreatedAt)) {
				return attachment.NewError(
					attachment.ErrorCodePartConflict,
					"attachment_repository.grant_batch",
					"granted_at",
					"precedes the completed object",
				)
			}
			upload, loadErr := loadCompletedUploadForObject(tx, object.ObjectID)
			if loadErr != nil {
				return loadErr
			}
			decoded, decodeErr := objectFromModel(*object)
			if decodeErr != nil {
				return decodeErr
			}
			if validationErr := attachment.ValidateUploadSpec(decoded.Spec); validationErr != nil {
				return validationErr
			}
			if !objectMatchesUpload(decoded, upload) ||
				!objectIdentityMatchesUpload(decoded, upload) {
				return attachment.NewError(
					attachment.ErrorCodePartConflict,
					"attachment_repository.grant_batch",
					"descriptor",
					"does not match the immutable completed upload",
				)
			}
			plaintextSize, sizeErr := plaintextSizeForObject(*object)
			if sizeErr != nil {
				return sizeErr
			}
			if plaintextSize > attachment.MaximumPlaintextSize-totalPlaintext {
				return attachment.NewError(
					attachment.ErrorCodeQuotaExceeded,
					"attachment_repository.grant_batch",
					"plaintext_size",
					"exceeds the per-message attachment limit",
				)
			}
			totalPlaintext += plaintextSize
		}
		if !allUnattached && !allReplay {
			return attachment.NewError(
				attachment.ErrorCodeInvalidState,
				"attachment_repository.grant_batch",
				"objects",
				"contain a partial prior grant",
			)
		}

		if err := validateExactExistingGrants(
			tx,
			grant,
			objectIDs,
			recipients,
			allReplay,
			grantedAt,
		); err != nil {
			return err
		}
		if allUnattached {
			grants := make([]GrantModel, 0, len(objectIDs)*len(recipients))
			for _, objectID := range objectIDs {
				for _, recipient := range recipients {
					grants = append(grants, GrantModel{
						ObjectID:       objectID,
						ConversationID: string(grant.ConversationID),
						RecipientPTID:  recipient,
						MessageID:      string(grant.MessageID),
						UploaderPTID:   string(grant.Uploader),
						EventID:        string(grant.EventID),
						GrantedAt:      grantedAt,
					})
				}
			}
			if err := tx.Create(&grants).Error; err != nil {
				return err
			}
			update := tx.Model(&ObjectModel{}).
				Where(
					"object_id IN ? AND conversation_id = ? AND message_id = ? "+
						"AND uploader_ptid = ? AND state = ? AND event_id = ?",
					objectIDs,
					string(grant.ConversationID),
					string(grant.MessageID),
					string(grant.Uploader),
					string(attachment.ObjectStateCompleteUnattached),
					"",
				).
				Updates(map[string]any{
					"event_id": string(grant.EventID),
					"state":    string(attachment.ObjectStateAttached),
				})
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != int64(len(objectIDs)) {
				return attachment.NewError(
					attachment.ErrorCodeRetryLater,
					"attachment_repository.grant_batch",
					"objects",
					"changed before the atomic grant",
				)
			}
		}

		outcome := attachment.AuditOutcomeCommitted
		if allReplay {
			outcome = attachment.AuditOutcomeReplay
		}
		for _, object := range objects {
			auditID := valueobject.HashBytes(valueobject.CanonicalTuple(
				[]byte("conversation-attachment-grant-batch-audit"),
				[]byte(object.ObjectID),
				[]byte(grant.ConversationID),
				[]byte(grant.MessageID),
				[]byte(grant.Uploader),
				[]byte(grant.EventID),
				[]byte(outcome),
			)).String()
			if err := appendAudit(tx, attachment.AuditRecord{
				AuditID:        auditID,
				Action:         attachment.AuditActionGrant,
				Outcome:        outcome,
				ConversationID: grant.ConversationID,
				MessageID:      grant.MessageID,
				AttachmentID:   object.AttachmentID,
				ObjectID:       valueobject.ObjectID(object.ObjectID),
				EventID:        grant.EventID,
				Actor:          grant.Uploader,
				ByteCount:      object.CiphertextSize,
				CreatedAt:      grantedAt,
			}); err != nil {
				return err
			}
		}

		return nil
	})
}

func (r *Repository) transaction(
	ctx context.Context,
	operation string,
	fn func(*gorm.DB) error,
) error {
	if r.transactionBound {
		err := fn(r.db.WithContext(ctx))
		if err == nil || attachment.CodeOf(err) != "" {
			return err
		}

		return attachment.WrapError(attachment.ErrorCodePersistence, operation, err)
	}
	if r.serializeSQLite {
		r.sqliteMutex.Lock()
		defer r.sqliteMutex.Unlock()
	}
	err := r.db.WithContext(ctx).Transaction(fn)
	if err == nil || attachment.CodeOf(err) != "" {
		return err
	}

	return attachment.WrapError(attachment.ErrorCodePersistence, operation, err)
}

func validateGrantBatch(
	grant ports.ObjectGrantBatch,
) ([]string, []string, error) {
	if grant.ConversationID == "" ||
		grant.MessageID == "" ||
		grant.Uploader == "" ||
		grant.EventID == "" ||
		grant.GrantedAt.IsZero() ||
		len(grant.ObjectIDs) == 0 ||
		len(grant.ObjectIDs) > attachment.MaximumMessageObjects ||
		len(grant.Recipients) == 0 {
		return nil, nil, invalid("grant_batch", "grant")
	}
	objectIDs := make([]string, 0, len(grant.ObjectIDs))
	seenObjects := make(map[string]struct{}, len(grant.ObjectIDs))
	for _, objectID := range grant.ObjectIDs {
		value := string(objectID)
		if !validIdentifier(value, 64) {
			return nil, nil, invalid("grant_batch", "object_ids")
		}
		if _, duplicate := seenObjects[value]; duplicate {
			return nil, nil, invalid("grant_batch", "object_ids")
		}
		seenObjects[value] = struct{}{}
		objectIDs = append(objectIDs, value)
	}
	recipients := make([]string, 0, len(grant.Recipients))
	seenRecipients := make(map[string]struct{}, len(grant.Recipients))
	for _, recipient := range grant.Recipients {
		value := string(recipient)
		if strings.TrimSpace(value) != value || value == "" {
			return nil, nil, invalid("grant_batch", "recipients")
		}
		if _, duplicate := seenRecipients[value]; duplicate {
			return nil, nil, invalid("grant_batch", "recipients")
		}
		seenRecipients[value] = struct{}{}
		recipients = append(recipients, value)
	}
	sort.Strings(objectIDs)
	sort.Strings(recipients)

	return objectIDs, recipients, nil
}

func validateExactExistingGrants(
	tx *gorm.DB,
	grant ports.ObjectGrantBatch,
	objectIDs []string,
	recipients []string,
	replay bool,
	grantedAt time.Time,
) error {
	var eventObjects []ObjectModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"conversation_id = ? AND event_id = ? AND state = ?",
			string(grant.ConversationID),
			string(grant.EventID),
			string(attachment.ObjectStateAttached),
		).
		Order("object_id ASC").
		Find(&eventObjects).Error; err != nil {
		return err
	}
	if replay {
		if len(eventObjects) != len(objectIDs) {
			return grantSetConflict("event object set is not exact")
		}
		for index := range eventObjects {
			if eventObjects[index].ObjectID != objectIDs[index] {
				return grantSetConflict("event object set is not exact")
			}
		}
	} else if len(eventObjects) != 0 {
		return grantSetConflict("event already owns a different object set")
	}

	var persisted []GrantModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"(conversation_id = ? AND event_id = ?) OR object_id IN ?",
			string(grant.ConversationID),
			string(grant.EventID),
			objectIDs,
		).
		Order("object_id ASC, recipient_ptid ASC").
		Find(&persisted).Error; err != nil {
		return err
	}
	if !replay {
		if len(persisted) != 0 {
			return grantSetConflict("objects or event already have grants")
		}

		return nil
	}
	if len(persisted) != len(objectIDs)*len(recipients) {
		return grantSetConflict("recipient grant set is not exact")
	}
	expected := make(map[string]struct{}, len(persisted))
	for _, objectID := range objectIDs {
		for _, recipient := range recipients {
			expected[objectID+"\x00"+recipient] = struct{}{}
		}
	}
	for _, existing := range persisted {
		if existing.ConversationID != string(grant.ConversationID) ||
			existing.MessageID != string(grant.MessageID) ||
			existing.UploaderPTID != string(grant.Uploader) ||
			existing.EventID != string(grant.EventID) ||
			!persistentTime(existing.GrantedAt).Equal(grantedAt) {
			return grantSetConflict("persisted grant binding differs")
		}
		key := existing.ObjectID + "\x00" + existing.RecipientPTID
		if _, ok := expected[key]; !ok {
			return grantSetConflict("recipient grant set is not exact")
		}
		delete(expected, key)
	}
	if len(expected) != 0 {
		return grantSetConflict("recipient grant set is incomplete")
	}

	return nil
}

func grantSetConflict(message string) error {
	return attachment.NewError(
		attachment.ErrorCodePartConflict,
		"attachment_repository.grant_batch",
		"grant_set",
		message,
	)
}

func loadCompletedUploadForObject(tx *gorm.DB, objectID string) (*UploadModel, error) {
	var uploads []UploadModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("object_id = ?", objectID).
		Limit(2).
		Find(&uploads).Error; err != nil {
		return nil, err
	}
	if len(uploads) != 1 ||
		uploads[0].State != int32(attachment.TransferStateComplete) {
		return nil, attachment.NewError(
			attachment.ErrorCodePartConflict,
			"attachment_repository.grant_batch",
			"upload",
			"object does not have exactly one completed upload",
		)
	}

	return &uploads[0], nil
}

func plaintextSizeForObject(object ObjectModel) (uint64, error) {
	tagBytes := uint64(object.ChunkCount) * uint64(object.TagSize)
	if object.ChunkCount == 0 ||
		object.TagSize != attachment.TagSize ||
		tagBytes >= object.CiphertextSize {
		return 0, attachment.NewError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.grant_batch",
			"ciphertext_size",
			"cannot derive a valid plaintext size",
		)
	}
	plaintextSize := object.CiphertextSize - tagBytes
	if plaintextSize > attachment.MaximumPlaintextSize {
		return 0, attachment.NewError(
			attachment.ErrorCodeQuotaExceeded,
			"attachment_repository.grant_batch",
			"plaintext_size",
			"exceeds the per-object attachment limit",
		)
	}

	return plaintextSize, nil
}

func cleanupKeysForObject(
	tx *gorm.DB,
	object ObjectModel,
) ([]string, error) {
	upload, err := loadCompletedUploadForObject(tx, object.ObjectID)
	if err != nil {
		return nil, err
	}
	decoded, err := objectFromModel(object)
	if err != nil {
		return nil, err
	}
	if !objectMatchesUpload(decoded, upload) ||
		!objectIdentityMatchesUpload(decoded, upload) {
		return nil, attachment.NewError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.cleanup_keys_for_object",
			"object",
			"does not match the immutable completed upload",
		)
	}
	keys, err := cleanupKeysForUpload(tx, *upload)
	if err != nil {
		return nil, err
	}
	keys = append(keys, object.StorageKey)

	return canonicalStorageKeys(keys)
}

func cleanupKeysForUpload(tx *gorm.DB, upload UploadModel) ([]string, error) {
	var parts []UploadPartModel
	if err := tx.Where(
		"upload_id = ? AND generation = ?",
		upload.UploadID,
		upload.Generation,
	).
		Order("chunk_index ASC").
		Find(&parts).Error; err != nil {
		return nil, err
	}
	if upload.VerificationAttemptCount > attachment.MaximumVerificationAttemptCount {
		return nil, attachment.NewError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.cleanup_keys_for_upload",
			"verification_attempt_count",
			"exceeds the bounded verification attempt limit",
		)
	}
	keys := make([]string, 0, len(parts)+int(upload.VerificationAttemptCount))
	if upload.VerificationAttemptCount > 0 {
		commitment, err := valueobject.NewHash(upload.DescriptorCommitmentSHA256)
		if err != nil {
			return nil, err
		}
		_, storageRef, _ := attachment.ImmutableObjectIdentity(
			upload.UploadID,
			commitment,
		)
		for attempt := uint32(1); attempt <= upload.VerificationAttemptCount; attempt++ {
			token := attachment.VerificationToken(
				upload.UploadID,
				upload.Generation,
				commitment,
				attempt,
			)
			keys = append(
				keys,
				attachment.VerificationObjectStorageKey(storageRef, token),
			)
		}
		if upload.VerificationStorageKey != keys[len(keys)-1] {
			return nil, attachment.NewError(
				attachment.ErrorCodeIntegrityFailed,
				"attachment_repository.cleanup_keys_for_upload",
				"verification_storage_key",
				"does not match the latest durable verification fence",
			)
		}
	} else if upload.VerificationStorageKey != "" {
		return nil, attachment.NewError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.cleanup_keys_for_upload",
			"verification_storage_key",
			"exists without a verification attempt",
		)
	}
	hashes, err := decodeHashes(upload.ChunkCiphertextSHA256, upload.ChunkCount)
	if err != nil {
		return nil, err
	}
	expected := make(map[uint32]string, len(hashes))
	for index, hash := range hashes {
		key := attachment.ImmutablePartStorageKey(
			upload.UploadID,
			upload.Generation,
			uint32(index),
			hash,
		)
		expected[uint32(index)] = key
		keys = append(keys, key)
	}
	for _, part := range parts {
		expectedKey, ok := expected[part.ChunkIndex]
		if !ok || part.StorageKey != expectedKey {
			return nil, attachment.NewError(
				attachment.ErrorCodeIntegrityFailed,
				"attachment_repository.cleanup_keys_for_upload",
				"part_storage_key",
				"does not match the immutable upload namespace",
			)
		}
	}

	return canonicalStorageKeys(keys)
}

func canonicalStorageKeys(keys []string) ([]string, error) {
	canonical := append([]string(nil), keys...)
	sort.Strings(canonical)
	result := canonical[:0]
	for _, key := range canonical {
		if key == "" || strings.TrimSpace(key) != key || strings.HasPrefix(key, "/") ||
			strings.Contains(key, `\`) || strings.Contains(key, "..") {
			return nil, attachment.NewError(
				attachment.ErrorCodeIntegrityFailed,
				"attachment_repository.cleanup_keys",
				"storage_key",
				"is outside the owned attachment namespace",
			)
		}
		if len(result) == 0 || result[len(result)-1] != key {
			result = append(result, key)
		}
	}

	return result, nil
}

func requireMutationAuthorization(
	tx *gorm.DB,
	authorization attachment.MutationAuthorization,
	operation string,
) error {
	var conversation conversationpersistence.ConversationModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("conversation_id", "status").
		Where("conversation_id = ?", string(authorization.ConversationID)).
		First(&conversation).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return attachment.NewError(
			attachment.ErrorCodeUnauthorized,
			operation,
			"conversation",
			"is not writable by the authenticated endpoint",
		)
	}
	if err != nil {
		return attachment.WrapError(
			attachment.ErrorCodePersistence,
			operation+".authorize_conversation",
			err,
		)
	}
	if conversation.Status != string(valueobject.ConversationStatusActive) {
		return attachment.NewError(
			attachment.ErrorCodeUnauthorized,
			operation,
			"conversation",
			"is not writable by the authenticated endpoint",
		)
	}

	var member conversationpersistence.ConversationMemberModel
	err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("conversation_id", "ptid").
		Where(
			"conversation_id = ? AND ptid = ? AND member_status = ?",
			string(authorization.ConversationID),
			string(authorization.Endpoint.Actor),
			string(valueobject.MemberStatusActive),
		).
		First(&member).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return attachment.NewError(
			attachment.ErrorCodeUnauthorized,
			operation,
			"membership",
			"actor is not an active Conversation member",
		)
	}
	if err != nil {
		return attachment.WrapError(
			attachment.ErrorCodePersistence,
			operation+".authorize_membership",
			err,
		)
	}

	var memberDevice conversationpersistence.ConversationMemberDeviceModel
	err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("conversation_id", "ptid", "device_id").
		Where(
			"conversation_id = ? AND ptid = ? AND device_id = ? AND active = ?",
			string(authorization.ConversationID),
			string(authorization.Endpoint.Actor),
			string(authorization.Endpoint.Device),
			true,
		).
		First(&memberDevice).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return attachment.NewError(
			attachment.ErrorCodeUnauthorized,
			operation,
			"membership",
			"endpoint is not active in the Conversation",
		)
	}
	if err != nil {
		return attachment.WrapError(
			attachment.ErrorCodePersistence,
			operation+".authorize_member_device",
			err,
		)
	}

	if err := lockActorIdentity(tx, authorization.Endpoint.Actor, operation); err != nil {
		return err
	}
	err = actoridentitypersistence.RequireActiveDeviceForMutation(
		tx,
		actoridentitypersistence.DeviceLocator{
			PTID:     string(authorization.Endpoint.Actor),
			DeviceID: string(authorization.Endpoint.Device),
		},
	)
	if err == nil {
		return nil
	}
	if actoridentitydomain.IsCode(err, actoridentitydomain.ErrorCodeUnauthorized) {
		return attachment.NewError(
			attachment.ErrorCodeUnauthorized,
			operation,
			"device",
			"is not an active verified actor device",
		)
	}

	return attachment.WrapError(
		attachment.ErrorCodePersistence,
		operation+".authorize_actor_device",
		err,
	)
}

func findUploadByIdempotency(
	tx *gorm.DB,
	uploader valueobject.Endpoint,
	idempotencyKey string,
) (*UploadModel, bool, error) {
	var model UploadModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"uploader_ptid = ? AND uploader_device_id = ? AND idempotency_key = ?",
			string(uploader.Actor),
			string(uploader.Device),
			idempotencyKey,
		).
		First(&model).Error
	switch {
	case err == nil:
		return &model, true, nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		return nil, false, nil
	default:
		return nil, false, err
	}
}

func lockActorIdentity(
	tx *gorm.DB,
	actor valueobject.PTID,
	operation string,
) error {
	var identity actoridentitypersistence.ActorIdentityModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("ptid").
		Where("ptid = ?", string(actor)).
		First(&identity).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return attachment.NewError(
			attachment.ErrorCodeUnauthorized,
			operation,
			"actor_identity",
			"canonical actor identity row is required for quota serialization",
		)
	}
	if err != nil {
		return attachment.WrapError(
			attachment.ErrorCodePersistence,
			operation+".lock_actor_identity",
			err,
		)
	}

	return nil
}

func lockUpload(tx *gorm.DB, uploadID string, generation uint64) (*UploadModel, error) {
	var model UploadModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("upload_id = ? AND generation = ?", uploadID, generation).
		First(&model).Error
	if err != nil {
		return nil, mapPersistenceError("attachment_repository.lock_upload", err)
	}

	return &model, nil
}

func loadPartModels(
	tx *gorm.DB,
	uploadID string,
	generation uint64,
) ([]UploadPartModel, error) {
	var parts []UploadPartModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("upload_id = ? AND generation = ?", uploadID, generation).
		Order("chunk_index ASC").
		Find(&parts).Error; err != nil {
		return nil, attachment.WrapError(
			attachment.ErrorCodePersistence,
			"attachment_repository.load_part_models",
			err,
		)
	}

	return parts, nil
}

func validateStoredParts(upload *UploadModel, parts []UploadPartModel) error {
	if len(parts) != int(upload.ChunkCount) {
		return attachment.NewError(
			attachment.ErrorCodeInvalidState,
			"attachment_repository.validate_stored_parts",
			"parts",
			"are incomplete",
		)
	}
	hashes, err := decodeHashes(upload.ChunkCiphertextSHA256, upload.ChunkCount)
	if err != nil {
		return err
	}
	var total uint64
	for index, part := range parts {
		expectedSize := uint64(upload.ChunkSize + upload.TagSize)
		if index == len(parts)-1 {
			expectedSize = upload.CiphertextSize -
				uint64(upload.ChunkCount-1)*uint64(upload.ChunkSize+upload.TagSize)
		}
		if part.UploadID != upload.UploadID ||
			part.Generation != upload.Generation ||
			part.ChunkIndex != uint32(index) ||
			part.ByteOffset != uint64(index)*uint64(upload.ChunkSize+upload.TagSize) ||
			part.CiphertextSize != expectedSize ||
			!bytes.Equal(part.CiphertextSHA256, hashes[index].Bytes()) ||
			part.StorageKey == "" {
			return attachment.NewError(
				attachment.ErrorCodePartConflict,
				"attachment_repository.validate_stored_parts",
				"parts",
				"do not match the immutable upload commitments",
			)
		}
		total += part.CiphertextSize
	}
	if total != upload.CiphertextSize {
		return attachment.NewError(
			attachment.ErrorCodePartConflict,
			"attachment_repository.validate_stored_parts",
			"ciphertext_size",
			"does not match the immutable upload",
		)
	}

	return nil
}

func lockObject(tx *gorm.DB, objectID valueobject.ObjectID) (*ObjectModel, error) {
	var model ObjectModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("object_id = ?", string(objectID)).
		First(&model).Error
	if err != nil {
		return nil, mapPersistenceError("attachment_repository.lock_object", err)
	}

	return &model, nil
}

func getObject(tx *gorm.DB, objectID valueobject.ObjectID) (attachment.Object, error) {
	var model ObjectModel
	if err := tx.Where("object_id = ?", string(objectID)).First(&model).Error; err != nil {
		return attachment.Object{}, mapPersistenceError(
			"attachment_repository.get_object",
			err,
		)
	}

	return objectFromModel(model)
}

func objectIdentityMatchesUpload(object attachment.Object, upload *UploadModel) bool {
	return verificationObjectIdentityMatchesUpload(
		object,
		upload,
		upload.VerificationToken,
	)
}

func verificationObjectIdentityMatchesUpload(
	object attachment.Object,
	upload *UploadModel,
	verificationToken string,
) bool {
	commitment, err := valueobject.NewHash(upload.DescriptorCommitmentSHA256)
	if err != nil {
		return false
	}
	objectID, storageRef, _ := attachment.ImmutableObjectIdentity(
		upload.UploadID,
		commitment,
	)
	storageKey := attachment.VerificationObjectStorageKey(
		storageRef,
		verificationToken,
	)

	return object.ObjectID == objectID &&
		object.StorageRef == storageRef &&
		object.StorageKey == storageKey
}

func validateCleanupClaim(claim attachment.CleanupClaim) error {
	if claim.Object.ObjectID == "" ||
		claim.Object.StorageKey == "" ||
		claim.Object.State != attachment.ObjectStateCleanupClaimed ||
		!validClaimStorageKeys(claim.StorageKeys, true) ||
		!validIdentifier(claim.LeaseOwner, 128) ||
		claim.Attempt == 0 ||
		claim.LeaseExpiresAt.IsZero() ||
		claim.Object.CleanupLeaseOwner != claim.LeaseOwner ||
		claim.Object.CleanupAttempt != claim.Attempt ||
		!claim.Object.CleanupLeaseExpiresAt.Equal(claim.LeaseExpiresAt) {
		return invalid("validate_cleanup_claim", "claim")
	}

	return nil
}

func validateUploadCleanupClaim(claim attachment.UploadCleanupClaim) error {
	if !validIdentifier(claim.Upload.UploadID, 64) ||
		claim.Upload.Generation == 0 ||
		claim.Upload.State != attachment.TransferStateCleanupClaimed ||
		!validClaimStorageKeys(claim.StorageKeys, false) ||
		!validIdentifier(claim.LeaseOwner, 128) ||
		claim.Attempt == 0 ||
		claim.LeaseExpiresAt.IsZero() ||
		claim.Upload.CleanupLeaseOwner != claim.LeaseOwner ||
		claim.Upload.CleanupAttempt != claim.Attempt ||
		!claim.Upload.CleanupLeaseExpiresAt.Equal(claim.LeaseExpiresAt) {
		return invalid("validate_upload_cleanup_claim", "claim")
	}

	return nil
}

func validClaimStorageKeys(keys []string, requireOne bool) bool {
	if requireOne && len(keys) == 0 {
		return false
	}
	canonical, err := canonicalStorageKeys(keys)
	if err != nil || len(canonical) != len(keys) {
		return false
	}
	for index := range keys {
		if keys[index] != canonical[index] {
			return false
		}
	}

	return true
}

func cleanupAudit(
	claim attachment.CleanupClaim,
	action attachment.AuditAction,
	outcome attachment.AuditOutcome,
	at time.Time,
) attachment.AuditRecord {
	auditID := valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("conversation-attachment-cleanup-audit"),
		[]byte(claim.Object.ObjectID),
		[]byte(claim.LeaseOwner),
		[]byte(strconv.FormatUint(uint64(claim.Attempt), 10)),
		[]byte(action),
		[]byte(outcome),
	)).String()

	return attachment.AuditRecord{
		AuditID:        auditID,
		Action:         action,
		Outcome:        outcome,
		ConversationID: claim.Object.ConversationID,
		MessageID:      claim.Object.MessageID,
		AttachmentID:   claim.Object.AttachmentID,
		ObjectID:       claim.Object.ObjectID,
		Actor:          claim.Object.Uploader,
		ByteCount:      claim.Object.Spec.CiphertextSize,
		CreatedAt:      at.UTC(),
	}
}

func uploadCleanupAudit(
	claim attachment.UploadCleanupClaim,
	action attachment.AuditAction,
	outcome attachment.AuditOutcome,
	at time.Time,
) attachment.AuditRecord {
	auditID := valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("conversation-attachment-upload-cleanup-audit"),
		[]byte(claim.Upload.UploadID),
		[]byte(claim.LeaseOwner),
		[]byte(strconv.FormatUint(uint64(claim.Attempt), 10)),
		[]byte(action),
		[]byte(outcome),
	)).String()

	return attachment.AuditRecord{
		AuditID:        auditID,
		Action:         action,
		Outcome:        outcome,
		ConversationID: claim.Upload.ConversationID,
		MessageID:      claim.Upload.MessageID,
		AttachmentID:   claim.Upload.AttachmentID,
		UploadID:       claim.Upload.UploadID,
		ObjectID:       claim.Upload.ObjectID,
		Actor:          claim.Upload.Uploader.Actor,
		Device:         claim.Upload.Uploader.Device,
		ByteCount:      claim.Upload.Spec.CiphertextSize,
		CreatedAt:      at.UTC(),
	}
}

func appendAudit(tx *gorm.DB, record attachment.AuditRecord) error {
	if strings.TrimSpace(record.AuditID) == "" ||
		!validAuditAction(record.Action) ||
		!validAuditOutcome(record.Outcome) ||
		record.CreatedAt.IsZero() {
		return invalid("append_audit", "record")
	}

	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&AuditModel{
		AuditID:        record.AuditID,
		Action:         string(record.Action),
		Outcome:        string(record.Outcome),
		ConversationID: string(record.ConversationID),
		MessageID:      string(record.MessageID),
		AttachmentID:   record.AttachmentID,
		UploadID:       record.UploadID,
		ObjectID:       string(record.ObjectID),
		EventID:        string(record.EventID),
		ActorPTID:      string(record.Actor),
		DeviceID:       string(record.Device),
		ChunkIndex:     record.ChunkIndex,
		ByteCount:      record.ByteCount,
		CreatedAt:      record.CreatedAt.UTC(),
	}).Error
}

func uploadModel(upload attachment.Upload) UploadModel {
	model := UploadModel{
		UploadID:                   upload.UploadID,
		Generation:                 upload.Generation,
		ConversationID:             string(upload.ConversationID),
		MessageID:                  string(upload.MessageID),
		AttachmentID:               upload.AttachmentID,
		UploaderPTID:               string(upload.Uploader.Actor),
		UploaderDeviceID:           string(upload.Uploader.Device),
		CiphertextSize:             upload.Spec.CiphertextSize,
		CiphertextSHA256:           upload.Spec.CiphertextHash.Bytes(),
		MediaType:                  upload.Spec.MediaType,
		ChunkSize:                  upload.Spec.ChunkSize,
		ChunkCount:                 upload.Spec.ChunkCount,
		EncryptionSuite:            int32(upload.Spec.Encryption),
		TagSize:                    upload.Spec.TagSize,
		NonceStrategy:              int32(upload.Spec.NonceStrategy),
		ChunkCiphertextSHA256:      encodeHashes(upload.Spec.ChunkHashes),
		DescriptorCommitmentSHA256: upload.DescriptorCommitment.Bytes(),
		IdempotencyKey:             upload.IdempotencyKey,
		State:                      int32(upload.State),
		ReceivedChunkBitmap:        append([]byte(nil), upload.ReceivedChunkBitmap...),
		ObjectID:                   string(upload.ObjectID),
		StorageRef:                 upload.StorageRef,
		VerificationToken:          upload.VerificationToken,
		VerificationStorageKey:     upload.VerificationStorageKey,
		VerificationAttemptCount:   upload.VerificationAttempt,
		ExpiresAt:                  upload.ExpiresAt.UTC(),
		CleanupLeaseOwner:          upload.CleanupLeaseOwner,
		CleanupAttemptCount:        upload.CleanupAttempt,
		CleanupNextAttemptAt:       upload.CleanupNextAttemptAt.UTC(),
		CreatedAt:                  upload.CreatedAt.UTC(),
		UpdatedAt:                  upload.UpdatedAt.UTC(),
	}
	if !upload.VerificationStartedAt.IsZero() {
		startedAt := upload.VerificationStartedAt.UTC()
		model.VerificationStartedAt = &startedAt
	}
	if !upload.VerificationLeaseExpiresAt.IsZero() {
		expiresAt := upload.VerificationLeaseExpiresAt.UTC()
		model.VerificationLeaseExpiresAt = &expiresAt
	}
	if !upload.CleanupLeaseExpiresAt.IsZero() {
		expiresAt := upload.CleanupLeaseExpiresAt.UTC()
		model.CleanupLeaseExpiresAt = &expiresAt
	}
	if !upload.CleanupCompletedAt.IsZero() {
		completedAt := upload.CleanupCompletedAt.UTC()
		model.CleanupCompletedAt = &completedAt
	}

	return model
}

func uploadFromModel(model UploadModel) (attachment.Upload, error) {
	ciphertextHash, err := valueobject.NewHash(model.CiphertextSHA256)
	if err != nil {
		return attachment.Upload{}, attachment.WrapError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.decode_upload_hash",
			err,
		)
	}
	commitment, err := valueobject.NewHash(model.DescriptorCommitmentSHA256)
	if err != nil {
		return attachment.Upload{}, attachment.WrapError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.decode_upload_commitment",
			err,
		)
	}
	chunkHashes, err := decodeHashes(model.ChunkCiphertextSHA256, model.ChunkCount)
	if err != nil {
		return attachment.Upload{}, err
	}

	upload := attachment.Upload{
		UploadID:       model.UploadID,
		Generation:     model.Generation,
		ConversationID: valueobject.ConversationID(model.ConversationID),
		MessageID:      valueobject.MessageID(model.MessageID),
		AttachmentID:   model.AttachmentID,
		Uploader: valueobject.Endpoint{
			Actor:  valueobject.PTID(model.UploaderPTID),
			Device: valueobject.DeviceID(model.UploaderDeviceID),
		},
		Spec: attachment.UploadSpec{
			CiphertextSize: model.CiphertextSize,
			CiphertextHash: ciphertextHash,
			MediaType:      model.MediaType,
			ChunkSize:      model.ChunkSize,
			ChunkCount:     model.ChunkCount,
			Encryption:     attachment.EncryptionSuite(model.EncryptionSuite),
			TagSize:        model.TagSize,
			NonceStrategy:  attachment.NonceStrategy(model.NonceStrategy),
			ChunkHashes:    chunkHashes,
		},
		DescriptorCommitment:   commitment,
		IdempotencyKey:         model.IdempotencyKey,
		State:                  attachment.TransferState(model.State),
		ReceivedChunkBitmap:    append([]byte(nil), model.ReceivedChunkBitmap...),
		ObjectID:               valueobject.ObjectID(model.ObjectID),
		StorageRef:             model.StorageRef,
		VerificationToken:      model.VerificationToken,
		VerificationStorageKey: model.VerificationStorageKey,
		VerificationAttempt:    model.VerificationAttemptCount,
		ExpiresAt:              model.ExpiresAt,
		CleanupLeaseOwner:      model.CleanupLeaseOwner,
		CleanupAttempt:         model.CleanupAttemptCount,
		CleanupNextAttemptAt:   model.CleanupNextAttemptAt,
		CreatedAt:              model.CreatedAt,
		UpdatedAt:              model.UpdatedAt,
	}
	if model.VerificationStartedAt != nil {
		upload.VerificationStartedAt = *model.VerificationStartedAt
	}
	if model.VerificationLeaseExpiresAt != nil {
		upload.VerificationLeaseExpiresAt = *model.VerificationLeaseExpiresAt
	}
	if model.CleanupLeaseExpiresAt != nil {
		upload.CleanupLeaseExpiresAt = *model.CleanupLeaseExpiresAt
	}
	if model.CleanupCompletedAt != nil {
		upload.CleanupCompletedAt = *model.CleanupCompletedAt
	}

	return upload, nil
}

func objectModel(object attachment.Object) ObjectModel {
	model := ObjectModel{
		ObjectID:                   string(object.ObjectID),
		StorageRef:                 object.StorageRef,
		StorageKey:                 object.StorageKey,
		ConversationID:             string(object.ConversationID),
		MessageID:                  string(object.MessageID),
		AttachmentID:               object.AttachmentID,
		UploaderPTID:               string(object.Uploader),
		CiphertextSize:             object.Spec.CiphertextSize,
		CiphertextSHA256:           object.Spec.CiphertextHash.Bytes(),
		MediaType:                  object.Spec.MediaType,
		ChunkSize:                  object.Spec.ChunkSize,
		ChunkCount:                 object.Spec.ChunkCount,
		EncryptionSuite:            int32(object.Spec.Encryption),
		TagSize:                    object.Spec.TagSize,
		NonceStrategy:              int32(object.Spec.NonceStrategy),
		ChunkCiphertextSHA256:      encodeHashes(object.Spec.ChunkHashes),
		DescriptorCommitmentSHA256: object.DescriptorCommitment.Bytes(),
		EventID:                    string(object.EventID),
		State:                      string(object.State),
		ExpiresAt:                  object.ExpiresAt.UTC(),
		CleanupLeaseOwner:          object.CleanupLeaseOwner,
		CleanupAttemptCount:        object.CleanupAttempt,
		CleanupNextAttemptAt:       object.CleanupNextAttemptAt.UTC(),
		CreatedAt:                  object.CreatedAt.UTC(),
	}
	if !object.CleanupLeaseExpiresAt.IsZero() {
		expiresAt := object.CleanupLeaseExpiresAt.UTC()
		model.CleanupLeaseExpiresAt = &expiresAt
	}
	if !object.CleanupCompletedAt.IsZero() {
		completedAt := object.CleanupCompletedAt.UTC()
		model.CleanupCompletedAt = &completedAt
	}

	return model
}

func objectFromModel(model ObjectModel) (attachment.Object, error) {
	ciphertextHash, err := valueobject.NewHash(model.CiphertextSHA256)
	if err != nil {
		return attachment.Object{}, attachment.WrapError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.decode_object_hash",
			err,
		)
	}
	commitment, err := valueobject.NewHash(model.DescriptorCommitmentSHA256)
	if err != nil {
		return attachment.Object{}, attachment.WrapError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.decode_object_commitment",
			err,
		)
	}
	chunkHashes, err := decodeHashes(model.ChunkCiphertextSHA256, model.ChunkCount)
	if err != nil {
		return attachment.Object{}, err
	}

	object := attachment.Object{
		ObjectID:       valueobject.ObjectID(model.ObjectID),
		StorageRef:     model.StorageRef,
		StorageKey:     model.StorageKey,
		ConversationID: valueobject.ConversationID(model.ConversationID),
		MessageID:      valueobject.MessageID(model.MessageID),
		AttachmentID:   model.AttachmentID,
		Uploader:       valueobject.PTID(model.UploaderPTID),
		Spec: attachment.UploadSpec{
			CiphertextSize: model.CiphertextSize,
			CiphertextHash: ciphertextHash,
			MediaType:      model.MediaType,
			ChunkSize:      model.ChunkSize,
			ChunkCount:     model.ChunkCount,
			Encryption:     attachment.EncryptionSuite(model.EncryptionSuite),
			TagSize:        model.TagSize,
			NonceStrategy:  attachment.NonceStrategy(model.NonceStrategy),
			ChunkHashes:    chunkHashes,
		},
		DescriptorCommitment: commitment,
		EventID:              valueobject.EventID(model.EventID),
		State:                attachment.ObjectState(model.State),
		ExpiresAt:            model.ExpiresAt,
		CleanupLeaseOwner:    model.CleanupLeaseOwner,
		CleanupAttempt:       model.CleanupAttemptCount,
		CleanupNextAttemptAt: model.CleanupNextAttemptAt,
		CreatedAt:            model.CreatedAt,
	}
	if model.CleanupLeaseExpiresAt != nil {
		object.CleanupLeaseExpiresAt = *model.CleanupLeaseExpiresAt
	}
	if model.CleanupCompletedAt != nil {
		object.CleanupCompletedAt = *model.CleanupCompletedAt
	}

	return object, nil
}

func sameUpload(left *UploadModel, right UploadModel) bool {
	return left.ConversationID == right.ConversationID &&
		left.MessageID == right.MessageID &&
		left.AttachmentID == right.AttachmentID &&
		left.UploaderPTID == right.UploaderPTID &&
		left.UploaderDeviceID == right.UploaderDeviceID &&
		left.CiphertextSize == right.CiphertextSize &&
		bytes.Equal(left.CiphertextSHA256, right.CiphertextSHA256) &&
		left.MediaType == right.MediaType &&
		left.ChunkSize == right.ChunkSize &&
		left.ChunkCount == right.ChunkCount &&
		left.EncryptionSuite == right.EncryptionSuite &&
		left.TagSize == right.TagSize &&
		left.NonceStrategy == right.NonceStrategy &&
		bytes.Equal(left.ChunkCiphertextSHA256, right.ChunkCiphertextSHA256) &&
		bytes.Equal(
			left.DescriptorCommitmentSHA256,
			right.DescriptorCommitmentSHA256,
		)
}

func samePart(model UploadPartModel, part attachment.Part) bool {
	return model.ByteOffset == part.ByteOffset &&
		model.CiphertextSize == part.CiphertextSize &&
		bytes.Equal(model.CiphertextSHA256, part.CiphertextHash.Bytes()) &&
		model.StorageKey == part.StorageKey
}

func sameObject(persisted attachment.Object, candidate attachment.Object) bool {
	return persisted.ObjectID == candidate.ObjectID &&
		persisted.StorageRef == candidate.StorageRef &&
		persisted.StorageKey == candidate.StorageKey &&
		persisted.ConversationID == candidate.ConversationID &&
		persisted.MessageID == candidate.MessageID &&
		persisted.AttachmentID == candidate.AttachmentID &&
		persisted.Uploader == candidate.Uploader &&
		persisted.DescriptorCommitment == candidate.DescriptorCommitment &&
		persisted.ExpiresAt.Equal(candidate.ExpiresAt) &&
		sameSpec(persisted.Spec, candidate.Spec)
}

func objectMatchesUpload(object attachment.Object, upload *UploadModel) bool {
	return string(object.ConversationID) == upload.ConversationID &&
		string(object.MessageID) == upload.MessageID &&
		object.AttachmentID == upload.AttachmentID &&
		string(object.Uploader) == upload.UploaderPTID &&
		object.Spec.CiphertextSize == upload.CiphertextSize &&
		bytes.Equal(object.Spec.CiphertextHash.Bytes(), upload.CiphertextSHA256) &&
		object.Spec.MediaType == upload.MediaType &&
		object.Spec.ChunkSize == upload.ChunkSize &&
		object.Spec.ChunkCount == upload.ChunkCount &&
		int32(object.Spec.Encryption) == upload.EncryptionSuite &&
		object.Spec.TagSize == upload.TagSize &&
		int32(object.Spec.NonceStrategy) == upload.NonceStrategy &&
		bytes.Equal(
			encodeHashes(object.Spec.ChunkHashes),
			upload.ChunkCiphertextSHA256,
		)
}

func sameSpec(left attachment.UploadSpec, right attachment.UploadSpec) bool {
	if left.CiphertextSize != right.CiphertextSize ||
		left.CiphertextHash != right.CiphertextHash ||
		left.MediaType != right.MediaType ||
		left.ChunkSize != right.ChunkSize ||
		left.ChunkCount != right.ChunkCount ||
		left.Encryption != right.Encryption ||
		left.TagSize != right.TagSize ||
		left.NonceStrategy != right.NonceStrategy ||
		len(left.ChunkHashes) != len(right.ChunkHashes) {
		return false
	}
	for index := range left.ChunkHashes {
		if left.ChunkHashes[index] != right.ChunkHashes[index] {
			return false
		}
	}

	return true
}

func encodeHashes(values []valueobject.Hash) []byte {
	encoded := make([]byte, 0, len(values)*32)
	for _, value := range values {
		encoded = append(encoded, value[:]...)
	}

	return encoded
}

func decodeHashes(encoded []byte, count uint32) ([]valueobject.Hash, error) {
	if len(encoded) != int(count)*32 {
		return nil, attachment.NewError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.decode_chunk_hashes",
			"chunk_ciphertext_sha256",
			"does not match the stored chunk count",
		)
	}
	hashes := make([]valueobject.Hash, count)
	for index := range hashes {
		copy(hashes[index][:], encoded[index*32:(index+1)*32])
	}

	return hashes, nil
}

func validAuditAction(action attachment.AuditAction) bool {
	switch action {
	case attachment.AuditActionBegin,
		attachment.AuditActionPart,
		attachment.AuditActionComplete,
		attachment.AuditActionCancel,
		attachment.AuditActionGrant,
		attachment.AuditActionDownload,
		attachment.AuditActionGCClaim,
		attachment.AuditActionGCRetry,
		attachment.AuditActionGCFinish:
		return true
	default:
		return false
	}
}

func validAuditOutcome(outcome attachment.AuditOutcome) bool {
	switch outcome {
	case attachment.AuditOutcomeCommitted, attachment.AuditOutcomeReplay:
		return true
	default:
		return false
	}
}

func mapPersistenceError(operation string, err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return attachment.NewError(
			attachment.ErrorCodeNotFound,
			operation,
			"record",
			"was not found",
		)
	}
	if attachment.CodeOf(err) != "" {
		return err
	}

	return attachment.WrapError(attachment.ErrorCodePersistence, operation, err)
}

func invalid(operation string, field string) error {
	return attachment.NewError(
		attachment.ErrorCodeInvalidArgument,
		"attachment_repository."+operation,
		field,
		"is invalid",
	)
}

func validIdentifier(value string, maximumLength int) bool {
	return value != "" &&
		len(value) <= maximumLength &&
		strings.TrimSpace(value) == value &&
		!strings.ContainsAny(value, `/\`)
}

func persistentTime(value time.Time) time.Time {
	return value.UTC().Truncate(time.Microsecond)
}

var _ attachment.Repository = (*Repository)(nil)
var _ ports.ObjectGrantWriter = (*Repository)(nil)
